import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { ParsedEditRecord } from "./claudeEditLog";
import { createUsageCounts, type UsageCounts } from "./claudeUsageStats";
import {
  emptyDshAnalyticsSnapshot,
  type DshAnalyticsSnapshot,
  type DshSessionMetric,
  type DshToolMetric,
  type DshTrajectoryDay
} from "../shared/dshAnalytics";
import { resolveDshHome } from "./dshPaths";

type JsonObject = Record<string, unknown>;

export function isDshSessionLogPath(filePath: string, dshHome = resolveDshHome()): boolean {
  if (typeof filePath !== "string" || !filePath) return false;
  const sessionRoot = resolve(dshHome, "sessions");
  const target = resolve(filePath);
  const fromRoot = relative(sessionRoot, target);
  const filename = basename(target).toLowerCase();
  return (filename === "session.jsonl" || filename === "session.jsonl.zstd")
    && fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

export type DshScannedTokenRequest = {
  id: string;
  sessionId: string;
  filePath: string;
  projectPath?: string;
  projectName: string;
  provider?: string;
  model: string;
  timestamp: number;
  durationMs?: number;
  entrypoint: "dsh";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

export type DshSessionScanResult = {
  requests: DshScannedTokenRequest[];
  edits: ParsedEditRecord[];
  rankings: Array<{ usage: UsageCounts; project: { path?: string; name: string } }>;
  analytics: DshAnalyticsSnapshot;
  requestIds: Set<string>;
  signature: string;
};

type ProjectionRecord = {
  title?: string;
  stats?: Partial<Pick<DshSessionMetric, "turns" | "steps" | "llmMs" | "toolMs" | "ttftMs" | "ttftSteps" | "decodeMs" | "decodeTokens">>;
  tokens?: Partial<Pick<DshSessionMetric, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">>;
  context?: Partial<Pick<DshSessionMetric, "contextWindow" | "pressureTokens" | "projectedTokens" | "systemTokens" | "toolsTokens" | "messageTokens">>;
};

type ToolCall = {
  name: string;
  time: number;
  args: JsonObject | null;
};

type DayState = Omit<DshTrajectoryDay, "sessions" | "ttftMs" | "ttftSteps" | "decodeMs" | "decodeTokens"> & {
  sessionIds: Set<string>;
  hourlyActivity: number[];
  toolUsage: Record<string, number>;
  toolMetrics: Record<string, DshToolMetric>;
};

type RawSessionScan = {
  session: DshSessionMetric;
  requests: DshScannedTokenRequest[];
  edits: ParsedEditRecord[];
  usage: UsageCounts;
  days: Map<string, DayState>;
  tools: Map<string, DshToolMetric>;
};

type SessionFile = { filePath: string; mtimeMs: number; size: number };

type ByteRange = { start: number; end: number };

const ZSTD_MAGIC = 0xFD2FB528;

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function countValue(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function finiteValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function projectName(projectPath: string | undefined): string {
  return projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? "DeepSeek Harness";
}

function parseArguments(value: unknown): JsonObject | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function lineCount(value: string): number {
  if (!value) return 0;
  const content = value.endsWith("\n") ? value.slice(0, -1) : value;
  return content ? content.split("\n").length : 1;
}

function changedLineCounts(oldText: string | null, newText: string): { added: number; removed: number } {
  if (oldText === null) return { added: lineCount(newText), removed: 0 };
  const before = oldText.split("\n");
  const after = newText.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return {
    added: Math.max(0, after.length - prefix - suffix),
    removed: Math.max(0, before.length - prefix - suffix)
  };
}

function bump(record: Record<string, number>, name: string): void {
  if (name) record[name] = (record[name] ?? 0) + 1;
}

function agentLabel(name: string, args: JsonObject | null): string {
  for (const key of ["subagent_type", "agentType", "label", "name"]) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return name;
}

function skillLabel(args: JsonObject | null): string {
  for (const key of ["skill", "name", "command"]) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) return value.trim().replace(/^\//, "");
  }
  return "";
}

function createDay(date: string): DayState {
  return {
    date,
    events: 0,
    sessionIds: new Set(),
    turns: 0,
    steps: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    permissionRequests: 0,
    permissionApproved: 0,
    permissionDenied: 0,
    totalTokens: 0,
    llmMs: 0,
    toolMs: 0,
    hourlyActivity: new Array(24).fill(0),
    toolUsage: {},
    toolMetrics: {}
  };
}

class SessionAccumulator {
  private sessionId = "";
  private createdAt = 0;
  private projectPath: string | undefined;
  private title = "";
  private provider = "unknown";
  private model = "unknown";
  private lastActivity = 0;
  private turns = 0;
  private steps = 0;
  private llmMs = 0;
  private toolMs = 0;
  private failedToolCalls = 0;
  private readonly stepStarts = new Map<string, number>();
  private readonly calls = new Map<string, ToolCall>();
  private readonly requests: DshScannedTokenRequest[] = [];
  private readonly edits: ParsedEditRecord[] = [];
  private readonly usage = createUsageCounts();
  private readonly days = new Map<string, DayState>();
  private readonly tools = new Map<string, DshToolMetric>();

  constructor(private readonly filePath: string) {}

  consume(row: JsonObject): void {
    const type = stringValue(row.type);
    if (type === "session") {
      this.sessionId = stringValue(row.id);
      this.createdAt = finiteValue(row.createdAt);
      const cwd = stringValue(row.cwd);
      if (cwd) this.projectPath = cwd;
      return;
    }

    const time = finiteValue(row.time);
    if (time > 0) {
      this.lastActivity = Math.max(this.lastActivity, time);
      if (this.sessionId) {
        const day = this.day(time);
        day.sessionIds.add(this.sessionId);
        if (type !== "assistant/chunk") {
          day.events++;
          day.hourlyActivity[new Date(time).getHours()]++;
        }
      }
    }
    const data = objectValue(row.data);
    if (!data) return;

    if (type === "session/title") {
      const title = stringValue(data.title).trim();
      if (title) this.title = title;
      return;
    }
    if (type === "request/context") {
      this.provider = stringValue(data.provider) || this.provider;
      this.model = stringValue(data.model) || this.model;
      return;
    }
    if (type === "turn/end") {
      this.turns++;
      if (time > 0) this.day(time).turns++;
      return;
    }
    if (type === "step/start") {
      this.stepStarts.set(`${countValue(data.turn)}:${countValue(data.step)}`, time);
      return;
    }
    if (type === "step/end") {
      this.steps++;
      if (time > 0) this.day(time).steps++;
      return;
    }
    if (type === "assistant/message") {
      this.consumeAssistant(row, data, time);
      return;
    }
    if (type === "command/run") {
      const name = stringValue(data.name).replace(/^\//, "");
      bump(this.usage.skills, name);
      return;
    }
    if (type === "approval/asked") {
      if (time > 0) this.day(time).permissionRequests++;
      return;
    }
    if (type === "approval/decided") {
      if (time > 0) {
        const outcome = stringValue(data.outcome);
        if (outcome === "allowed-once") this.day(time).permissionApproved++;
        else this.day(time).permissionDenied++;
      }
      return;
    }
    if (type === "tool/call") {
      this.consumeToolCall(data, time);
      return;
    }
    if (type === "tool/result") this.consumeToolResult(row, data, time);
  }

  finish(): RawSessionScan | null {
    if (!this.sessionId) return null;
    const fallbackStats = {
      turns: this.turns,
      steps: this.steps,
      llmMs: this.llmMs,
      toolMs: this.toolMs,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0
    };
    const requestTokens = this.requests.reduce((totals, request) => ({
      inputTokens: totals.inputTokens + request.inputTokens,
      outputTokens: totals.outputTokens + request.outputTokens,
      cacheReadTokens: totals.cacheReadTokens + request.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens + request.cacheCreationTokens
    }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const createdAt = this.createdAt || this.lastActivity;
    const session: DshSessionMetric = {
      sessionId: this.sessionId,
      title: this.title || this.sessionId,
      filePath: this.filePath,
      ...(this.projectPath ? { projectPath: this.projectPath } : {}),
      projectName: projectName(this.projectPath),
      provider: this.provider,
      model: this.model,
      createdAt,
      lastActivity: this.lastActivity || createdAt,
      durationMs: Math.max(0, (this.lastActivity || createdAt) - createdAt),
      turns: fallbackStats.turns,
      steps: fallbackStats.steps,
      toolCalls: [...this.tools.values()].reduce((sum, tool) => sum + tool.calls, 0),
      failedToolCalls: this.failedToolCalls,
      llmMs: fallbackStats.llmMs,
      toolMs: fallbackStats.toolMs,
      ttftMs: fallbackStats.ttftMs,
      ttftSteps: fallbackStats.ttftSteps,
      decodeMs: fallbackStats.decodeMs,
      decodeTokens: fallbackStats.decodeTokens,
      inputTokens: requestTokens.inputTokens,
      outputTokens: requestTokens.outputTokens,
      cacheReadTokens: requestTokens.cacheReadTokens,
      cacheWriteTokens: requestTokens.cacheWriteTokens
    };
    return { session, requests: this.requests, edits: this.edits, usage: this.usage, days: this.days, tools: this.tools };
  }

  private day(timestamp: number): DayState {
    const key = dateKey(timestamp);
    const day = this.days.get(key) ?? createDay(key);
    this.days.set(key, day);
    return day;
  }

  private consumeAssistant(row: JsonObject, data: JsonObject, time: number): void {
    const usage = objectValue(data.usage);
    if (!usage || !this.sessionId) return;
    const inputTokens = countValue(usage.inputTokens);
    const outputTokens = countValue(usage.outputTokens);
    const cacheReadTokens = countValue(usage.cacheReadTokens);
    const cacheCreationTokens = countValue(usage.cacheWriteTokens);
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    if (totalTokens === 0) return;
    const turn = countValue(data.turn);
    const step = countValue(data.step);
    const startedAt = this.stepStarts.get(`${turn}:${step}`);
    const durationMs = startedAt !== undefined && time >= startedAt ? time - startedAt : undefined;
    if (durationMs !== undefined) this.llmMs += durationMs;
    const request: DshScannedTokenRequest = {
      id: `${this.sessionId}:${countValue(row.seq)}`,
      sessionId: this.sessionId,
      filePath: this.filePath,
      ...(this.projectPath ? { projectPath: this.projectPath } : {}),
      projectName: projectName(this.projectPath),
      provider: this.provider,
      model: this.model,
      timestamp: time || this.lastActivity || this.createdAt,
      ...(durationMs === undefined ? {} : { durationMs }),
      entrypoint: "dsh",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens
    };
    this.requests.push(request);
    if (time > 0) {
      const day = this.day(time);
      day.totalTokens += totalTokens;
      day.llmMs += durationMs ?? 0;
    }
  }

  private consumeToolCall(data: JsonObject, time: number): void {
    const callId = stringValue(data.callId);
    const name = stringValue(data.name) || "unknown";
    const args = parseArguments(data.arguments);
    if (callId) this.calls.set(callId, { name, time, args });
    bump(this.usage.tools, name);
    if (name === "skill") bump(this.usage.skills, skillLabel(args));
    if (["agent", "ralph", "subagent", "subagent_fork", "workflow"].includes(name)) {
      bump(this.usage.agents, agentLabel(name, args));
    }
    const metric = this.tools.get(name) ?? { name, calls: 0, errors: 0, durationMs: 0 };
    metric.calls++;
    this.tools.set(name, metric);
    if (time > 0) {
      const day = this.day(time);
      day.toolCalls++;
      bump(day.toolUsage, name);
      const dayMetric = day.toolMetrics[name] ?? { name, calls: 0, errors: 0, durationMs: 0 };
      dayMetric.calls++;
      day.toolMetrics[name] = dayMetric;
    }
  }

  private consumeToolResult(row: JsonObject, data: JsonObject, time: number): void {
    const message = objectValue(data.message);
    const source = objectValue(message?.source);
    const callId = stringValue(source?.callId);
    const call = this.calls.get(callId);
    const failed = data.error !== undefined || message?.isError === true;
    if (call) {
      const durationMs = Math.max(0, time - call.time);
      this.toolMs += durationMs;
      const metric = this.tools.get(call.name);
      if (metric) {
        metric.durationMs += durationMs;
        if (failed) metric.errors++;
      }
      if (time > 0 || call.time > 0) {
        const day = this.day(call.time || time);
        day.toolMs += durationMs;
        if (failed) day.failedToolCalls++;
        const dayMetric = day.toolMetrics[call.name] ?? { name: call.name, calls: 0, errors: 0, durationMs: 0 };
        dayMetric.durationMs += durationMs;
        if (failed) dayMetric.errors++;
        day.toolMetrics[call.name] = dayMetric;
      }
    }
    if (failed) this.failedToolCalls++;
    this.extractEdits(row, data, time);
  }

  private extractEdits(row: JsonObject, data: JsonObject, time: number): void {
    const meta = objectValue(data.meta);
    if (!Array.isArray(meta?.diffs)) return;
    meta.diffs.forEach((rawDiff, index) => {
      const diff = objectValue(rawDiff);
      if (!diff) return;
      const rawPath = stringValue(diff.path);
      const newText = typeof diff.newText === "string" ? diff.newText : null;
      const oldText = typeof diff.oldText === "string" || diff.oldText === null ? diff.oldText as string | null : undefined;
      if (!rawPath || newText === null || oldText === undefined) return;
      const filePath = isAbsolute(rawPath) || !this.projectPath ? rawPath : resolve(this.projectPath, rawPath);
      const lines = changedLineCounts(oldText, newText);
      this.edits.push({
        id: `${this.sessionId}:${countValue(row.seq)}:${index}`,
        filePath,
        op: oldText === null ? "create" : "edit",
        addedLines: lines.added,
        removedLines: lines.removed,
        timestamp: time || this.lastActivity || this.createdAt,
        sessionId: this.sessionId,
        sessionFilePath: this.filePath,
        ...(this.projectPath ? { projectPath: this.projectPath } : {}),
        projectName: projectName(this.projectPath)
      });
    });
  }
}

function projectionValue(row: unknown): unknown {
  return objectValue(row)?.val;
}

export function parseDshProjectionCache(value: unknown): Map<string, ProjectionRecord> {
  const root = objectValue(value);
  const sessions = objectValue(objectValue(root?.tables)?.sessions);
  const result = new Map<string, ProjectionRecord>();
  if (!sessions) return result;
  for (const [sessionId, rawRecord] of Object.entries(sessions)) {
    const rows = objectValue(objectValue(rawRecord)?.rows);
    if (!rows) continue;
    const title = stringValue(projectionValue(rows.title));
    const rawStats = objectValue(projectionValue(rows.sessionStats));
    const tokenState = objectValue(projectionValue(rows.tokenUsage));
    const rawTokens = objectValue(tokenState?.totals) ?? tokenState;
    const pressure = objectValue(projectionValue(rows.contextPressure));
    const breakdown = objectValue(projectionValue(rows.contextBreakdown));
    const pressureTokens = pressure?.pressureTokens === undefined ? undefined : countValue(pressure.pressureTokens);
    const contextWindow = pressure?.contextWindow === undefined ? undefined : countValue(pressure.contextWindow);
    const surfaceTokens = pressure?.surfaceTokens === undefined ? undefined : countValue(pressure.surfaceTokens);
    const sampledSurfaceTokens = pressure?.sampledSurfaceTokens === undefined ? undefined : countValue(pressure.sampledSurfaceTokens);
    const projectedTokens = pressureTokens === undefined || surfaceTokens === undefined || sampledSurfaceTokens === undefined
      ? undefined
      : Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens);
    result.set(sessionId, {
      ...(title ? { title } : {}),
      ...(rawStats ? { stats: {
        turns: countValue(rawStats.turns),
        steps: countValue(rawStats.steps),
        llmMs: finiteValue(rawStats.llmMs),
        toolMs: finiteValue(rawStats.toolMs),
        ttftMs: finiteValue(rawStats.ttftMs),
        ttftSteps: countValue(rawStats.ttftSteps),
        decodeMs: finiteValue(rawStats.decodeMs),
        decodeTokens: countValue(rawStats.decodeTokens)
      } } : {}),
      ...(rawTokens ? { tokens: {
        inputTokens: countValue(rawTokens.uncachedInputTokens),
        outputTokens: countValue(rawTokens.outputTokens),
        cacheReadTokens: countValue(rawTokens.cacheReadTokens),
        cacheWriteTokens: countValue(rawTokens.cacheWriteTokens)
      } } : {}),
      ...((pressure || breakdown) ? { context: {
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(pressureTokens === undefined ? {} : { pressureTokens }),
        ...(projectedTokens === undefined ? {} : { projectedTokens }),
        ...(breakdown?.systemTokens === undefined ? {} : { systemTokens: countValue(breakdown.systemTokens) }),
        ...(breakdown?.toolsTokens === undefined ? {} : { toolsTokens: countValue(breakdown.toolsTokens) }),
        ...(breakdown?.messageTokens === undefined ? {} : { messageTokens: countValue(breakdown.messageTokens) })
      } } : {})
    });
  }
  return result;
}

export function parseDshSessionRows(rows: readonly unknown[], filePath: string, projection?: ProjectionRecord): RawSessionScan | null {
  const accumulator = new SessionAccumulator(filePath);
  for (const row of rows) {
    const record = objectValue(row);
    if (record) accumulator.consume(record);
  }
  const scan = accumulator.finish();
  return scan ? applyProjection(scan, projection) : null;
}

async function collectSessionFiles(root: string): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name === "session.jsonl.zstd")) {
        try {
          const metadata = await stat(fullPath);
          files.push({ filePath: fullPath, mtimeMs: metadata.mtimeMs, size: metadata.size });
        } catch {
          // A session can disappear between directory enumeration and stat.
        }
      }
    }
  };
  await visit(root, 0);
  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

// DSH appends independently compressed Zstandard frames. Node's streaming
// decoder stops after the first frame, so locate each complete frame first.
function completeZstdFrames(buffer: Buffer): ByteRange[] {
  const frames: ByteRange[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`Invalid Zstandard frame at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset++);
    if ((descriptor & 0x18) !== 0) throw new Error(`Invalid Zstandard frame descriptor at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;

    let complete = false;
    for (;;) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      if (blockType === 0x03) throw new Error(`Invalid Zstandard block at byte ${offset - 3}`);
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) break;
      offset += payloadBytes;
      if (!lastBlock) continue;
      if (checksum) {
        if (buffer.length - offset < 4) break;
        offset += 4;
      }
      complete = true;
      break;
    }
    if (!complete) break;
    frames.push({ start, end: offset });
  }
  return frames;
}

async function scanFile(filePath: string): Promise<RawSessionScan | null> {
  const accumulator = new SessionAccumulator(filePath);
  const buffer = await readFile(filePath);
  const plaintext = filePath.endsWith(".zstd")
    ? completeZstdFrames(buffer).map(frame => zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString("utf8"))
    : [buffer.toString("utf8")];
  for (const chunk of plaintext) {
    for (const rawLine of chunk.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const row = objectValue(JSON.parse(line));
        if (row) accumulator.consume(row);
      } catch {
        // Ignore a torn or malformed row; DSH's append-only log keeps later rows independent.
      }
    }
  }
  return accumulator.finish();
}

function applyProjection(scan: RawSessionScan, projection: ProjectionRecord | undefined): RawSessionScan {
  if (!projection) return scan;
  return {
    ...scan,
    session: {
      ...scan.session,
      ...(projection.title ? { title: projection.title } : {}),
      ...projection.stats,
      ...projection.tokens,
      ...projection.context
    }
  };
}

function mergeTool(target: Map<string, DshToolMetric>, incoming: DshToolMetric): void {
  const current = target.get(incoming.name) ?? { name: incoming.name, calls: 0, errors: 0, durationMs: 0 };
  current.calls += incoming.calls;
  current.errors += incoming.errors;
  current.durationMs += incoming.durationMs;
  target.set(incoming.name, current);
}

function mergeDay(target: Map<string, DayState>, incoming: DayState): void {
  const current = target.get(incoming.date) ?? createDay(incoming.date);
  for (const id of incoming.sessionIds) current.sessionIds.add(id);
  current.turns += incoming.turns;
  current.events += incoming.events;
  current.steps += incoming.steps;
  current.toolCalls += incoming.toolCalls;
  current.failedToolCalls += incoming.failedToolCalls;
  current.permissionRequests += incoming.permissionRequests;
  current.permissionApproved += incoming.permissionApproved;
  current.permissionDenied += incoming.permissionDenied;
  current.totalTokens += incoming.totalTokens;
  current.llmMs += incoming.llmMs;
  current.toolMs += incoming.toolMs;
  incoming.hourlyActivity.forEach((count, hour) => { current.hourlyActivity[hour] += count; });
  for (const [tool, count] of Object.entries(incoming.toolUsage)) {
    current.toolUsage[tool] = (current.toolUsage[tool] ?? 0) + count;
  }
  for (const metric of Object.values(incoming.toolMetrics)) {
    const currentMetric = current.toolMetrics[metric.name] ?? { name: metric.name, calls: 0, errors: 0, durationMs: 0 };
    currentMetric.calls += metric.calls;
    currentMetric.errors += metric.errors;
    currentMetric.durationMs += metric.durationMs;
    current.toolMetrics[metric.name] = currentMetric;
  }
  target.set(incoming.date, current);
}

function analyticsFrom(scans: RawSessionScan[], sessionRoot: string, scannedAt: number): DshAnalyticsSnapshot {
  if (scans.length === 0) return emptyDshAnalyticsSnapshot(sessionRoot, scannedAt);
  const days = new Map<string, DayState>();
  const tools = new Map<string, DshToolMetric>();
  for (const scan of scans) {
    for (const day of scan.days.values()) mergeDay(days, day);
    for (const tool of scan.tools.values()) mergeTool(tools, tool);
  }
  const sessions = scans.map(scan => scan.session).sort((left, right) => right.lastActivity - left.lastActivity);
  const sessionMetricsByDay = new Map<string, {
    sessions: number;
    ttftMs: number;
    ttftSteps: number;
    decodeMs: number;
    decodeTokens: number;
  }>();
  for (const session of sessions) {
    const key = dateKey(session.lastActivity);
    const metrics = sessionMetricsByDay.get(key) ?? {
      sessions: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0
    };
    metrics.sessions++;
    metrics.ttftMs += session.ttftMs;
    metrics.ttftSteps += session.ttftSteps;
    metrics.decodeMs += session.decodeMs;
    metrics.decodeTokens += session.decodeTokens;
    sessionMetricsByDay.set(key, metrics);
    if (!days.has(key)) days.set(key, createDay(key));
  }
  const daily = [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
  const hourlyActivity = new Array(24).fill(0);
  daily.forEach(day => day.hourlyActivity.forEach((count, hour) => { hourlyActivity[hour] += count; }));
  return {
    totals: sessions.reduce((total, session) => ({
      events: total.events,
      sessions: total.sessions + 1,
      turns: total.turns + session.turns,
      steps: total.steps + session.steps,
      toolCalls: total.toolCalls + session.toolCalls,
      failedToolCalls: total.failedToolCalls + session.failedToolCalls,
      permissionRequests: total.permissionRequests,
      permissionApproved: total.permissionApproved,
      permissionDenied: total.permissionDenied,
      llmMs: total.llmMs + session.llmMs,
      toolMs: total.toolMs + session.toolMs,
      ttftMs: total.ttftMs + session.ttftMs,
      ttftSteps: total.ttftSteps + session.ttftSteps,
      decodeMs: total.decodeMs + session.decodeMs,
      decodeTokens: total.decodeTokens + session.decodeTokens
    }), {
      events: daily.reduce((sum, day) => sum + day.events, 0),
      sessions: 0,
      turns: 0,
      steps: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      permissionRequests: daily.reduce((sum, day) => sum + day.permissionRequests, 0),
      permissionApproved: daily.reduce((sum, day) => sum + day.permissionApproved, 0),
      permissionDenied: daily.reduce((sum, day) => sum + day.permissionDenied, 0),
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0
    }),
    daily: daily.map(day => {
      const sessionMetrics = sessionMetricsByDay.get(day.date);
      return {
        date: day.date,
        events: day.events,
        sessions: sessionMetrics?.sessions ?? 0,
        turns: day.turns,
        steps: day.steps,
        toolCalls: day.toolCalls,
        failedToolCalls: day.failedToolCalls,
        permissionRequests: day.permissionRequests,
        permissionApproved: day.permissionApproved,
        permissionDenied: day.permissionDenied,
        totalTokens: day.totalTokens,
        llmMs: day.llmMs,
        toolMs: day.toolMs,
        ttftMs: sessionMetrics?.ttftMs ?? 0,
        ttftSteps: sessionMetrics?.ttftSteps ?? 0,
        decodeMs: sessionMetrics?.decodeMs ?? 0,
        decodeTokens: sessionMetrics?.decodeTokens ?? 0
      };
    }),
    tools: [...tools.values()].sort((left, right) => right.calls - left.calls || right.durationMs - left.durationMs || left.name.localeCompare(right.name)),
    sessions: sessions.slice(0, 100),
    hourlyActivity,
    dailyHourlyActivity: Object.fromEntries(daily.map(day => [day.date, day.hourlyActivity])),
    dailyToolUsage: Object.fromEntries(daily.map(day => [day.date, day.toolUsage])),
    dailyTools: Object.fromEntries(daily.map(day => [day.date, Object.values(day.toolMetrics).sort((left, right) => right.calls - left.calls || right.durationMs - left.durationMs || left.name.localeCompare(right.name))])),
    sessionRoot,
    lastScannedAt: scannedAt
  };
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export class DshSessionScanner {
  private readonly fileCache = new Map<string, { mtimeMs: number; size: number; scan: RawSessionScan | null }>();
  private lastSignature = "";
  private lastResult: DshSessionScanResult | null = null;

  constructor(private readonly dshHome = resolveDshHome()) {}

  async scan(force = false): Promise<DshSessionScanResult> {
    const sessionRoot = join(this.dshHome, "sessions");
    const projectionPath = join(this.dshHome, "storages", "session_projcache.json");
    const files = await collectSessionFiles(sessionRoot);
    let projectionText = "";
    let projectionSignature = "missing";
    try {
      const [text, metadata] = await Promise.all([readFile(projectionPath, "utf8"), stat(projectionPath)]);
      projectionText = text;
      projectionSignature = `${metadata.mtimeMs}:${metadata.size}`;
    } catch {
      // Projection cache is optional; raw logs remain authoritative.
    }
    const signature = `${projectionSignature}|${files.map(file => `${file.filePath}:${file.mtimeMs}:${file.size}`).join("|")}`;
    if (!force && signature === this.lastSignature && this.lastResult) {
      return { ...this.lastResult, analytics: { ...this.lastResult.analytics, lastScannedAt: Date.now() } };
    }
    let projections = new Map<string, ProjectionRecord>();
    if (projectionText) {
      try {
        projections = parseDshProjectionCache(JSON.parse(projectionText));
      } catch {
        // A malformed cache costs richer summaries, never the raw session scan.
      }
    }
    const livePaths = new Set(files.map(file => file.filePath));
    for (const path of this.fileCache.keys()) {
      if (!livePaths.has(path)) this.fileCache.delete(path);
    }
    const scans = await mapWithConcurrency(files, 4, async file => {
      const cached = this.fileCache.get(file.filePath);
      let rawScan: RawSessionScan | null;
      if (!force && cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
        rawScan = cached.scan;
      } else {
        rawScan = null;
        try {
          rawScan = await scanFile(file.filePath);
        } catch {
          // One unreadable session must not hide the rest of the local history.
        }
        this.fileCache.set(file.filePath, { mtimeMs: file.mtimeMs, size: file.size, scan: rawScan });
      }
      if (!rawScan) return null;
      const sessionId = rawScan.session.sessionId || file.filePath.split(/[\\/]/).at(-2) || "";
      return applyProjection(rawScan, projections.get(sessionId));
    });
    const valid = scans.filter((scan): scan is RawSessionScan => scan !== null);
    const scannedAt = Date.now();
    const requests = valid.flatMap(scan => scan.requests);
    const result: DshSessionScanResult = {
      requests,
      edits: valid.flatMap(scan => scan.edits),
      rankings: valid.map(scan => ({ usage: scan.usage, project: { path: scan.session.projectPath, name: scan.session.projectName } })),
      analytics: analyticsFrom(valid, sessionRoot, scannedAt),
      requestIds: new Set(requests.map(request => request.id)),
      signature
    };
    this.lastSignature = signature;
    this.lastResult = result;
    return result;
  }
}

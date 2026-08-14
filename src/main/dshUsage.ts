import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type DshUsageRecord = {
  id: string;
  sessionId: string;
  seq: number;
  timestamp: number;
  provider: string;
  model: string;
  cwd?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function normalizeDshUsageRecord(value: unknown): DshUsageRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isBoundedString(record.id, 512)) return null;
  if (!isBoundedString(record.sessionId, 128)) return null;
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 0) return null;
  if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp) || record.timestamp <= 0) return null;
  if (!isBoundedString(record.provider, 200) || !isBoundedString(record.model, 500)) return null;
  if (record.cwd !== undefined && !isBoundedString(record.cwd, 4096)) return null;
  if (!isTokenCount(record.inputTokens)
    || !isTokenCount(record.outputTokens)
    || !isTokenCount(record.cacheReadTokens)
    || !isTokenCount(record.cacheWriteTokens)
    || !isTokenCount(record.reasoningTokens)) return null;
  if ((record.inputTokens as number)
    + (record.outputTokens as number)
    + (record.cacheReadTokens as number)
    + (record.cacheWriteTokens as number) <= 0) return null;
  return {
    id: record.id,
    sessionId: record.sessionId,
    seq: record.seq as number,
    timestamp: record.timestamp,
    provider: record.provider,
    model: record.model,
    ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
    inputTokens: record.inputTokens as number,
    outputTokens: record.outputTokens as number,
    cacheReadTokens: record.cacheReadTokens as number,
    cacheWriteTokens: record.cacheWriteTokens as number,
    reasoningTokens: record.reasoningTokens as number
  };
}

export function isDshUsageRecord(value: unknown): value is DshUsageRecord {
  return normalizeDshUsageRecord(value) !== null;
}

export function parseDshUsageLog(contents: string): DshUsageRecord[] {
  const records = new Map<string, DshUsageRecord>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      const record = normalizeDshUsageRecord(value);
      if (record) records.set(record.id, record);
    } catch {
      // Preserve valid records around an incomplete or corrupt line.
    }
  }
  return [...records.values()];
}

export class DshUsageStore {
  private readonly byId: Map<string, DshUsageRecord>;

  constructor(private readonly filePath: string) {
    let contents = "";
    try {
      if (existsSync(filePath)) contents = readFileSync(filePath, "utf8");
    } catch {
      // A temporarily unreadable analytics file should not block the desktop app.
    }
    this.byId = new Map(parseDshUsageLog(contents).map(record => [record.id, record]));
  }

  add(record: DshUsageRecord): boolean {
    if (this.byId.has(record.id)) return false;
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    this.byId.set(record.id, record);
    return true;
  }

  records(): DshUsageRecord[] {
    return [...this.byId.values()];
  }

  signature(): string {
    const records = [...this.byId.values()];
    const last = records[records.length - 1];
    return `${this.byId.size}:${last?.id ?? ""}`;
  }
}

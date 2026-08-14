import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DshSessionScanner, parseDshProjectionCache, parseDshSessionRows } from "../src/main/dshSessionScanner";

const rows = [
  { type: "session", version: 0, id: "session-one", createdAt: 1_000, cwd: "C:\\work\\demo", delegationDepth: 0 },
  { type: "session/title", seq: 0, time: 1_010, data: { title: "Investigate tools" } },
  { type: "request/context", seq: 1, time: 1_020, data: { provider: "deepseek-official", model: "deepseek-v4-flash", contextWindow: 1_000_000 } },
  { type: "turn/start", seq: 2, time: 1_030, data: { turn: 1 } },
  { type: "step/start", seq: 3, time: 1_100, data: { turn: 1, step: 1 } },
  { type: "tool/call", seq: 4, time: 1_200, data: { turn: 1, step: 1, callId: "call-1", name: "edit", arguments: JSON.stringify({ file_path: "src/a.ts", old_string: "old", new_string: "new" }) } },
  { type: "tool/result", seq: 5, time: 1_500, data: { turn: 1, step: 1, message: { source: { kind: "tool-result", callId: "call-1" }, content: [], role: "user", id: "result-1" }, meta: { diffs: [{ path: "src/a.ts", oldText: "a\nold\nz", newText: "a\nnew\nz" }] } } },
  { type: "assistant/message", seq: 6, time: 2_100, data: { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 8 } } },
  { type: "step/end", seq: 7, time: 2_110, data: { turn: 1, step: 1 } },
  { type: "turn/end", seq: 8, time: 2_120, data: { turn: 1, reason: { kind: "completed" } } }
];

function projectionCache() {
  return {
    unit: { version: 3 },
    global: null,
    tables: {
      sessions: {
        "session-one": {
          identity: { createdAt: 1_000, cwd: "C:\\work\\demo" },
          rows: {
            title: { ver: 1, seq: 8, val: "Projected title" },
            sessionStats: { ver: 1, seq: 8, val: { turns: 1, steps: 1, llmMs: 1_000, toolMs: 300, ttftMs: 200, ttftSteps: 1, decodeMs: 800, decodeTokens: 20, lastTurn: 1, openStep: null, pendingCalls: {} } },
            tokenUsage: { ver: 1, seq: 8, val: { totals: { uncachedInputTokens: 50, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0 }, last: null } },
            contextPressure: { ver: 4, seq: 8, val: { contextWindow: 1_000_000, pressureTokens: 150, surfaceTokens: 80, sampledSurfaceTokens: 50 } },
            contextBreakdown: { ver: 2, seq: 8, val: { systemTokens: 10, toolsTokens: 20, messageTokens: 30 } }
          }
        }
      }
    }
  };
}

describe("DSH native session scanning", () => {
  it("pairs DSH events without reading message content", () => {
    const scan = parseDshSessionRows(rows, "C:\\logs\\session.jsonl");
    expect(scan?.session).toMatchObject({
      sessionId: "session-one",
      title: "Investigate tools",
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      turns: 1,
      steps: 1,
      toolCalls: 1,
      failedToolCalls: 0,
      llmMs: 1_000,
      toolMs: 300
    });
    expect(scan?.requests).toEqual([expect.objectContaining({ id: "session-one:6", inputTokens: 50, outputTokens: 20, cacheReadTokens: 100, totalTokens: 170 })]);
    expect(scan?.edits).toEqual([expect.objectContaining({ filePath: "C:\\work\\demo\\src\\a.ts", op: "edit", addedLines: 1, removedLines: 1 })]);
    expect(scan?.usage.tools).toEqual({ edit: 1 });
  });

  it("reads DSH projection totals and projected context pressure", () => {
    const projections = parseDshProjectionCache(projectionCache());
    const projected = projections.get("session-one");
    expect(projected).toMatchObject({
      title: "Projected title",
      stats: { ttftMs: 200, decodeTokens: 20 },
      tokens: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 100 },
      context: { contextWindow: 1_000_000, pressureTokens: 150, projectedTokens: 180, systemTokens: 10, toolsTokens: 20, messageTokens: 30 }
    });
    expect(parseDshSessionRows(rows, "C:\\logs\\session.jsonl", projected)?.session.title).toBe("Projected title");
  });

  it("streams session.jsonl.zstd and aggregates trajectory metrics", async () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-desk-scanner-"));
    const sessionDir = join(dshHome, "sessions", "--demo--", "session-one");
    const storageDir = join(dshHome, "storages");
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(storageDir, { recursive: true });
    const frames = [
      zstdCompressSync(Buffer.from(`${JSON.stringify(rows[0])}\n`)),
      zstdCompressSync(Buffer.from(`${rows.slice(1).map(row => JSON.stringify(row)).join("\n")}\n`))
    ];
    writeFileSync(join(sessionDir, "session.jsonl.zstd"), Buffer.concat(frames));
    writeFileSync(join(storageDir, "session_projcache.json"), JSON.stringify(projectionCache()));

    const result = await new DshSessionScanner(dshHome).scan();

    expect(result.analytics.totals).toMatchObject({ sessions: 1, turns: 1, steps: 1, toolCalls: 1, llmMs: 1_000, toolMs: 300, ttftSteps: 1 });
    expect(result.analytics.sessions[0]).toMatchObject({ title: "Projected title", projectedTokens: 180 });
    expect(result.analytics.tools).toEqual([expect.objectContaining({ name: "edit", calls: 1, durationMs: 300 })]);
    expect(result.analytics.daily).toEqual([expect.objectContaining({ sessions: 1, turns: 1, steps: 1, toolCalls: 1, totalTokens: 170 })]);
    expect(result.requestIds.has("session-one:6")).toBe(true);
  });

  it("refreshes projections without reparsing an unchanged session log", async () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-desk-projection-"));
    const sessionDir = join(dshHome, "sessions", "--demo--", "session-one");
    const storageDir = join(dshHome, "storages");
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(join(sessionDir, "session.jsonl"), `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);
    const projectionPath = join(storageDir, "session_projcache.json");
    writeFileSync(projectionPath, JSON.stringify(projectionCache()));
    const scanner = new DshSessionScanner(dshHome);

    expect((await scanner.scan()).analytics.sessions[0].title).toBe("Projected title");
    const updated = projectionCache();
    updated.tables.sessions["session-one"].rows.title.val = "Updated projected title";
    writeFileSync(projectionPath, JSON.stringify(updated));

    expect((await scanner.scan()).analytics.sessions[0].title).toBe("Updated projected title");
  });
});

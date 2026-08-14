import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DshSessionScanner, isDshSessionLogPath, parseDshProjectionCache, parseDshSessionRows } from "../src/main/dshSessionScanner";

const rows = [
  { type: "session", version: 0, id: "session-one", createdAt: 1_000, cwd: "C:\\work\\demo", delegationDepth: 0 },
  { type: "session/title", seq: 0, time: 1_010, data: { title: "Investigate tools" } },
  { type: "request/context", seq: 1, time: 1_020, data: { provider: "deepseek-official", model: "deepseek-v4-flash", contextWindow: 1_000_000 } },
  { type: "turn/start", seq: 2, time: 1_030, data: { turn: 1 } },
  { type: "step/start", seq: 3, time: 1_100, data: { turn: 1, step: 1 } },
  { type: "tool/call", seq: 4, time: 1_200, data: { turn: 1, step: 1, callId: "call-1", name: "edit", arguments: JSON.stringify({ file_path: "src/a.ts", old_string: "old", new_string: "new" }) } },
  { type: "assistant/chunk", seq: 5, time: 1_300, data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "answer" } } },
  { type: "approval/asked", seq: 6, time: 1_300, data: { id: "approval-1", toolName: "edit", callId: "call-1" } },
  { type: "approval/decided", seq: 7, time: 1_400, data: { id: "approval-1", outcome: "allowed-once" } },
  { type: "tool/result", seq: 8, time: 1_500, data: { turn: 1, step: 1, message: { source: { kind: "tool-result", callId: "call-1" }, content: [], role: "user", id: "result-1" }, meta: { diffs: [{ path: "src/a.ts", oldText: "a\nold\nz", newText: "a\nnew\nz" }] } } },
  { type: "assistant/message", seq: 9, time: 2_100, data: { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 8 } } },
  { type: "step/end", seq: 10, time: 2_110, data: { turn: 1, step: 1 } },
  { type: "turn/end", seq: 11, time: 2_120, data: { turn: 1, reason: { kind: "completed" } } }
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
            title: { ver: 1, seq: 9, val: "Projected title" },
            sessionStats: { ver: 1, seq: 9, val: { turns: 1, steps: 1, llmMs: 1_000, toolMs: 300, ttftMs: 200, ttftSteps: 1, decodeMs: 800, decodeTokens: 20, lastTurn: 1, openStep: null, pendingCalls: {} } },
            tokenUsage: { ver: 1, seq: 9, val: { totals: { uncachedInputTokens: 50, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0 }, last: null } },
            contextPressure: { ver: 4, seq: 9, val: { contextWindow: 1_000_000, pressureTokens: 150, surfaceTokens: 80, sampledSurfaceTokens: 50 } },
            contextBreakdown: { ver: 2, seq: 9, val: { systemTokens: 10, toolsTokens: 20, messageTokens: 30 } }
          }
        }
      }
    }
  };
}

describe("DSH native session scanning", () => {
  it("accepts plaintext and compressed session logs only below the DSH session root", () => {
    const dshHome = join(tmpdir(), "dsh-desk-path-check");
    expect(isDshSessionLogPath(join(dshHome, "sessions", "--demo--", "session-one", "session.jsonl.zstd"), dshHome)).toBe(true);
    expect(isDshSessionLogPath(join(dshHome, "sessions", "--demo--", "session-one", "session.jsonl"), dshHome)).toBe(true);
    expect(isDshSessionLogPath(join(dshHome, "storages", "session.jsonl.zstd"), dshHome)).toBe(false);
    expect(isDshSessionLogPath(join(dshHome, "sessions", "..", "outside", "session.jsonl.zstd"), dshHome)).toBe(false);
  });

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
    expect(scan?.requests).toEqual([expect.objectContaining({ id: "session-one:9", inputTokens: 50, outputTokens: 20, cacheReadTokens: 100, totalTokens: 170 })]);
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

    expect(result.analytics.totals).toMatchObject({ events: 11, sessions: 1, turns: 1, steps: 1, toolCalls: 1, permissionRequests: 1, permissionApproved: 1, permissionDenied: 0, llmMs: 1_000, toolMs: 300, ttftSteps: 1 });
    expect(result.analytics.sessions[0]).toMatchObject({ title: "Projected title", projectedTokens: 180 });
    expect(result.analytics.tools).toEqual([expect.objectContaining({ name: "edit", calls: 1, durationMs: 300 })]);
    expect(result.analytics.daily).toEqual([expect.objectContaining({ sessions: 1, turns: 1, steps: 1, toolCalls: 1, totalTokens: 170, ttftMs: 200, ttftSteps: 1, decodeMs: 800, decodeTokens: 20 })]);
    expect(result.analytics.hourlyActivity.reduce((sum, count) => sum + count, 0)).toBe(11);
    expect(Object.values(result.analytics.dailyToolUsage)[0]).toEqual({ edit: 1 });
    expect(Object.values(result.analytics.dailyTools)[0]).toEqual([expect.objectContaining({ name: "edit", calls: 1, errors: 0, durationMs: 300 })]);
    expect(result.requestIds.has("session-one:9")).toBe(true);
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

  it("keeps complete range aggregates while limiting session details to 100 rows", async () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-desk-range-"));
    const storageDir = join(dshHome, "storages");
    mkdirSync(storageDir, { recursive: true });
    const now = Date.now();
    const projectedSessions: Record<string, unknown> = {};
    for (let index = 0; index < 101; index++) {
      const sessionId = `session-${index}`;
      const sessionDir = join(dshHome, "sessions", "--demo--", sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, "session.jsonl"), [
        JSON.stringify({ type: "session", id: sessionId, createdAt: now, cwd: "C:\\work\\demo" }),
        JSON.stringify({ type: "session/title", seq: 0, time: now + index, data: { title: sessionId } }),
        JSON.stringify({ type: "step/start", seq: 1, time: now + 1_000 + index, data: { turn: 1, step: 1 } }),
        JSON.stringify({ type: "assistant/chunk", seq: 2, time: now + 1_100 + index, data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "answer" } } }),
        JSON.stringify({ type: "assistant/message", seq: 3, time: now + 1_300 + index, data: { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: { outputTokens: 10 } } }),
        ""
      ].join("\n"));
      projectedSessions[sessionId] = {
        rows: {
          sessionStats: { val: { ttftMs: 100, ttftSteps: 1, decodeMs: 200, decodeTokens: 10 } }
        }
      };
    }
    writeFileSync(join(storageDir, "session_projcache.json"), JSON.stringify({ tables: { sessions: projectedSessions } }));

    const analytics = (await new DshSessionScanner(dshHome).scan()).analytics;
    expect(analytics.sessions).toHaveLength(100);
    expect(analytics.totals.sessions).toBe(101);
    expect(analytics.daily).toEqual([expect.objectContaining({
      sessions: 101,
      ttftMs: 10_100,
      ttftSteps: 101,
      decodeMs: 20_200,
      decodeTokens: 1_010
    })]);
  });

  it("attributes cross-day performance samples to each assistant completion day", async () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-desk-cross-day-"));
    const sessionDir = join(dshHome, "sessions", "--demo--", "cross-day");
    const storageDir = join(dshHome, "storages");
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(storageDir, { recursive: true });
    const oldDay = new Date(2026, 0, 1, 12).getTime();
    const recentDay = new Date(2026, 0, 11, 12).getTime();
    const sessionRows = [
      { type: "session", id: "cross-day", createdAt: oldDay, cwd: "C:\\work\\demo" },
      { type: "step/start", seq: 0, time: oldDay, data: { turn: 1, step: 1 } },
      { type: "assistant/chunk", seq: 1, time: oldDay + 100, data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "old" } } },
      { type: "assistant/message", seq: 2, time: oldDay + 300, data: { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: { outputTokens: 10 } } },
      { type: "step/start", seq: 3, time: recentDay, data: { turn: 2, step: 1 } },
      { type: "assistant/chunk", seq: 4, time: recentDay + 200, data: { turn: 2, step: 1, chunk: { type: "reasoning-delta", text: "recent" } } },
      { type: "assistant/message", seq: 5, time: recentDay + 600, data: { turn: 2, step: 1, message: { role: "assistant", content: [] }, usage: { outputTokens: 20 } } }
    ];
    writeFileSync(join(sessionDir, "session.jsonl"), `${sessionRows.map(row => JSON.stringify(row)).join("\n")}\n`);
    writeFileSync(join(storageDir, "session_projcache.json"), JSON.stringify({
      tables: {
        sessions: {
          "cross-day": {
            rows: {
              sessionStats: { val: { ttftMs: 300, ttftSteps: 2, decodeMs: 600, decodeTokens: 30 } }
            }
          }
        }
      }
    }));

    const analytics = (await new DshSessionScanner(dshHome).scan()).analytics;
    expect(analytics.daily).toEqual([
      expect.objectContaining({ date: "2026-01-01", ttftMs: 100, ttftSteps: 1, decodeMs: 200, decodeTokens: 10 }),
      expect.objectContaining({ date: "2026-01-11", ttftMs: 200, ttftSteps: 1, decodeMs: 400, decodeTokens: 20 })
    ]);
    expect(analytics.totals).toMatchObject({ ttftMs: 300, ttftSteps: 2, decodeMs: 600, decodeTokens: 30 });
  });
});

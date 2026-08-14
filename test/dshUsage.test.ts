import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DshUsageStore, isDshUsageRecord, normalizeDshUsageRecord, parseDshUsageLog, type DshUsageRecord } from "../src/main/dshUsage";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function usage(overrides: Partial<DshUsageRecord> = {}): DshUsageRecord {
  return {
    id: "session-1:12",
    sessionId: "session-1",
    seq: 12,
    timestamp: 1_700_000_000_000,
    provider: "deepseek",
    model: "deepseek-chat",
    cwd: "C:\\work\\repo",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 5,
    reasoningTokens: 7,
    ...overrides
  };
}

describe("DeepSeek Harness usage validation", () => {
  it("accepts numeric metadata without model content", () => {
    expect(isDshUsageRecord(usage())).toBe(true);
    expect(normalizeDshUsageRecord({ ...usage(), output: "private response" }))
      .toEqual(usage());
  });

  it("rejects invalid and all-zero token records", () => {
    expect(isDshUsageRecord(usage({ inputTokens: -1 }))).toBe(false);
    expect(isDshUsageRecord(usage({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    }))).toBe(false);
  });
});

describe("DeepSeek Harness usage persistence", () => {
  it("loads valid lines around corruption and keeps the latest duplicate", () => {
    const first = usage({ inputTokens: 10 });
    const replacement = usage({ inputTokens: 20 });
    expect(parseDshUsageLog(`${JSON.stringify(first)}\n{broken\n${JSON.stringify(replacement)}\n`))
      .toEqual([replacement]);
  });

  it("appends records durably and ignores replayed event ids", () => {
    const root = mkdtempSync(join(tmpdir(), "chara-dsh-usage-"));
    tempRoots.push(root);
    const filePath = join(root, "dsh-usage.ndjson");
    writeFileSync(filePath, "{incomplete\n", "utf8");

    const store = new DshUsageStore(filePath);
    expect(store.add(usage())).toBe(true);
    expect(store.add(usage())).toBe(false);
    expect(store.records()).toEqual([usage()]);
    expect(readFileSync(filePath, "utf8").match(/session-1/g)).toHaveLength(2);

    const reloaded = new DshUsageStore(filePath);
    expect(reloaded.records()).toEqual([usage()]);
    expect(reloaded.signature()).toBe("1:session-1:12");
  });
});

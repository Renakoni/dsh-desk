import { describe, expect, it } from "vitest";
import { mergeRuntimeStats, type RuntimeStatsShape } from "../src/main/runtimeStatsMerge";

function stats(overrides: Partial<RuntimeStatsShape> = {}): RuntimeStatsShape {
  return {
    toolUsage: {}, eventTypeCounts: {}, totalSessions: 0, dailyStats: {},
    errorCount: 0, permissionRequests: 0, permissionApproved: 0, permissionDenied: 0,
    totalRuntime: 0, hourlyActivity: new Array(24).fill(0), dailyHourlyActivity: {}, dailyToolUsage: {},
    firstStartTime: 0, lastEventTime: 0, ...overrides
  };
}

describe("mergeRuntimeStats", () => {
  it("sums scalar counters and record maps across installs", () => {
    const a = stats({ totalSessions: 3, errorCount: 1, totalRuntime: 1000, toolUsage: { Read: 2, Edit: 1 }, eventTypeCounts: { done: 5 }, permissionRequests: 4, permissionApproved: 3, permissionDenied: 1 });
    const b = stats({ totalSessions: 2, errorCount: 4, totalRuntime: 500, toolUsage: { Read: 10, Bash: 7 }, eventTypeCounts: { done: 2, error: 1 }, permissionRequests: 6, permissionApproved: 5, permissionDenied: 2 });
    const m = mergeRuntimeStats(a, b);
    expect(m.totalSessions).toBe(5);
    expect(m.errorCount).toBe(5);
    expect(m.totalRuntime).toBe(1500);
    expect(m.toolUsage).toEqual({ Read: 12, Edit: 1, Bash: 7 });
    expect(m.eventTypeCounts).toEqual({ done: 7, error: 1 });
    expect(m.permissionRequests).toBe(10);
    expect(m.permissionApproved).toBe(8);
    expect(m.permissionDenied).toBe(3);
  });

  it("unions daily maps and sums an overlapping day (the rename day, split across installs)", () => {
    const a = stats({ dailyStats: { "2026-07-12": { events: 3, toolCalls: 2, sessions: 1 } } });
    const b = stats({ dailyStats: { "2026-07-12": { events: 4, toolCalls: 1, sessions: 0, errors: 2 }, "2026-06-24": { events: 9, toolCalls: 8, sessions: 2 } } });
    const m = mergeRuntimeStats(a, b);
    expect(m.dailyStats["2026-06-24"]).toEqual({ events: 9, toolCalls: 8, sessions: 2, errors: 0, permissionRequests: 0 });
    expect(m.dailyStats["2026-07-12"]).toEqual({ events: 7, toolCalls: 3, sessions: 1, errors: 2, permissionRequests: 0 });
  });

  it("sums hourly buckets element-wise (top-level and per-day, unioning dates)", () => {
    const ha = new Array(24).fill(0); ha[3] = 5; ha[10] = 2;
    const hb = new Array(24).fill(0); hb[3] = 1; hb[23] = 4;
    const a = stats({ hourlyActivity: ha, dailyHourlyActivity: { "2026-07-12": ha } });
    const b = stats({ hourlyActivity: hb, dailyHourlyActivity: { "2026-07-12": hb, "2026-06-24": hb } });
    const m = mergeRuntimeStats(a, b);
    expect(m.hourlyActivity[3]).toBe(6);
    expect(m.hourlyActivity[10]).toBe(2);
    expect(m.hourlyActivity[23]).toBe(4);
    expect(m.dailyHourlyActivity["2026-07-12"][3]).toBe(6);
    expect(m.dailyHourlyActivity["2026-06-24"][23]).toBe(4);
  });

  it("sums per-day tool usage, unioning tools and dates", () => {
    const a = stats({ dailyToolUsage: { "2026-07-12": { Read: 2, Edit: 1 } } });
    const b = stats({ dailyToolUsage: { "2026-07-12": { Read: 3, Bash: 5 }, "2026-06-24": { Grep: 1 } } });
    const m = mergeRuntimeStats(a, b);
    expect(m.dailyToolUsage["2026-07-12"]).toEqual({ Read: 5, Edit: 1, Bash: 5 });
    expect(m.dailyToolUsage["2026-06-24"]).toEqual({ Grep: 1 });
  });

  it("takes the earliest firstStartTime (ignoring 0) and the latest lastEventTime", () => {
    const a = stats({ firstStartTime: 1783905008513, lastEventTime: 1785926920676 });
    const b = stats({ firstStartTime: 1782036526643, lastEventTime: 1783910835785 });
    const m = mergeRuntimeStats(a, b);
    expect(m.firstStartTime).toBe(1782036526643);
    expect(m.lastEventTime).toBe(1785926920676);
    expect(mergeRuntimeStats(stats({ firstStartTime: 0 }), stats({ firstStartTime: 100 })).firstStartTime).toBe(100);
    expect(mergeRuntimeStats(stats({ firstStartTime: 0 }), stats({ firstStartTime: 0 })).firstStartTime).toBe(0);
  });

  it("does not mutate its inputs", () => {
    const a = stats({ toolUsage: { Read: 1 }, dailyStats: { d: { events: 1, toolCalls: 0, sessions: 0 } } });
    const b = stats({ toolUsage: { Read: 2 }, dailyStats: { d: { events: 5, toolCalls: 0, sessions: 0 } } });
    mergeRuntimeStats(a, b);
    expect(a.toolUsage).toEqual({ Read: 1 });
    expect(a.dailyStats.d.events).toBe(1);
    expect(b.toolUsage).toEqual({ Read: 2 });
  });
});

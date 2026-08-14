import { describe, expect, it } from "vitest";
import { historyToSortedArray, mergeTokenDailyHistory, normalizeTokenDailyHistory } from "../src/main/tokenHistory";

type Entry = { date: string; requestCount: number; totalTokens: number };
const e = (date: string, requestCount: number, totalTokens = requestCount * 10): Entry => ({ date, requestCount, totalTokens });

describe("mergeTokenDailyHistory", () => {
  it("overwrites when the fresh scan is a superset — more (or equal) requests AND tokens (today growing)", () => {
    const merged = mergeTokenDailyHistory({ "2026-07-10": e("2026-07-10", 3, 30) }, [e("2026-07-10", 8, 80)]);
    expect(merged["2026-07-10"]).toEqual(e("2026-07-10", 8, 80));
    // Equal on both → fresh wins (harmless: re-scanning a complete day yields the same value).
    expect(mergeTokenDailyHistory({ d: e("d", 5, 50) }, [e("d", 5, 999)]).d.totalTokens).toBe(999);
  });

  it("keeps the persisted entry when a fresh scan under-counts a day whose logs were rotated away", () => {
    const merged = mergeTokenDailyHistory({ "2026-06-24": e("2026-06-24", 40, 4000) }, [e("2026-06-24", 0, 0)]);
    expect(merged["2026-06-24"]).toEqual(e("2026-06-24", 40, 4000));
  });

  it("keeps the fuller record when fresh has MORE requests but FEWER tokens (requestCount alone is not proof)", () => {
    // Log rotation dropped 2 high-token requests and added 3 small ones: 6 > 5 requests but
    // 2,300 < 10,000 tokens — must not overwrite the fuller stored record.
    const merged = mergeTokenDailyHistory({ "2026-07-10": e("2026-07-10", 5, 10000) }, [e("2026-07-10", 6, 2300)]);
    expect(merged["2026-07-10"]).toEqual(e("2026-07-10", 5, 10000));
  });

  it("adds new days and retains persisted-only days a fresh scan no longer sees", () => {
    const merged = mergeTokenDailyHistory({ "2026-06-24": e("2026-06-24", 40) }, [e("2026-08-05", 12)]);
    expect(Object.keys(merged).sort()).toEqual(["2026-06-24", "2026-08-05"]);
  });

  it("does not mutate its inputs", () => {
    const persisted = { d: e("d", 1) };
    mergeTokenDailyHistory(persisted, [e("d", 9)]);
    expect(persisted.d.requestCount).toBe(1);
  });
});

describe("historyToSortedArray", () => {
  it("returns entries in ascending date order", () => {
    const arr = historyToSortedArray({
      "2026-08-05": e("2026-08-05", 1),
      "2026-06-24": e("2026-06-24", 1),
      "2026-07-10": e("2026-07-10", 1)
    });
    expect(arr.map(x => x.date)).toEqual(["2026-06-24", "2026-07-10", "2026-08-05"]);
  });
});

describe("normalizeTokenDailyHistory", () => {
  it("reads the { version, days } envelope", () => {
    const h = normalizeTokenDailyHistory({ version: 1, days: { "2026-07-10": { date: "2026-07-10", requestCount: 3, totalTokens: 30 } } });
    expect(h["2026-07-10"]).toEqual({ date: "2026-07-10", requestCount: 3, totalTokens: 30 });
  });

  it("reads a bare map, dropping bad dates / non-objects and coercing a corrupt requestCount", () => {
    const h = normalizeTokenDailyHistory({
      "2026-07-10": { requestCount: 5 },
      "not-a-date": { requestCount: 9 },
      "2026-07-11": 42,
      "2026-07-12": { requestCount: "oops" }
    });
    expect(Object.keys(h).sort()).toEqual(["2026-07-10", "2026-07-12"]);
    expect(h["2026-07-10"]).toMatchObject({ date: "2026-07-10", requestCount: 5 });
    expect(h["2026-07-12"].requestCount).toBe(0);
  });

  it("returns {} for junk input", () => {
    expect(normalizeTokenDailyHistory(null)).toEqual({});
    expect(normalizeTokenDailyHistory([1, 2])).toEqual({});
    expect(normalizeTokenDailyHistory("nope")).toEqual({});
  });
});

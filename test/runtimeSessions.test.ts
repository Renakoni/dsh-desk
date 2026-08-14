import { describe, expect, it } from "vitest";
import { MAX_DAILY_SESSION_IDS, noteDailySession, recordSessionSighting } from "../src/main/runtimeSessions";

describe("noteDailySession (distinct-session-per-day counting)", () => {
  it("counts a brand-new session id and records it", () => {
    const seen: string[] = [];
    expect(noteDailySession(seen, "sess-A")).toBe(true);
    expect(seen).toEqual(["sess-A"]);
  });

  it("counts two concurrent sessions as two — the core fix (SessionStart-only counting gave 1)", () => {
    const seen: string[] = [];
    expect(noteDailySession(seen, "sess-A")).toBe(true);
    expect(noteDailySession(seen, "sess-B")).toBe(true);
    expect(seen.length).toBe(2); // dailyStats[day].sessions is set to this
  });

  it("does not double-count a session on its later events (any event marks it, once)", () => {
    const seen = ["sess-A"];
    expect(noteDailySession(seen, "sess-A")).toBe(false);
    expect(seen).toEqual(["sess-A"]);
  });

  it("ignores a missing/empty id — internal pet events carry none and must not inflate the count", () => {
    const seen: string[] = [];
    expect(noteDailySession(seen, undefined)).toBe(false);
    expect(noteDailySession(seen, null)).toBe(false);
    expect(noteDailySession(seen, "")).toBe(false);
    expect(seen).toEqual([]);
  });

  it("stops counting past the per-day cap so a pathological day can't grow unbounded", () => {
    const seen = Array.from({ length: MAX_DAILY_SESSION_IDS }, (_, index) => `s${index}`);
    expect(noteDailySession(seen, "one-more")).toBe(false);
    expect(seen.length).toBe(MAX_DAILY_SESSION_IDS);
  });
});

describe("recordSessionSighting (day-row update, upgrade-safe)", () => {
  it("counts up from a fresh day (row starts at 0 → exact distinct count)", () => {
    const row = { sessions: 0 };
    const ledger: string[] = [];
    recordSessionSighting(row, ledger, "A");
    recordSessionSighting(row, ledger, "B");
    expect(row.sessions).toBe(2);
    expect(ledger).toEqual(["A", "B"]);
  });

  it("never drops an already-recorded count when the id ledger is absent — the upgrade path", () => {
    // Upgrade state: today already had 3 sessions (A,B,C) from the old SessionStart tally, but
    // dailySessionIds was normalized to an empty ledger. Only A is still running. A's next event
    // must NOT collapse the day's count from 3 to 1; B/C already ended and can't re-emit.
    const row = { sessions: 3 };
    const ledger: string[] = [];
    recordSessionSighting(row, ledger, "A");
    expect(row.sessions).toBe(3); // max(3, 1) — not overwritten to 1
  });

  it("still grows past the preserved tally once new distinct ids exceed it", () => {
    const row = { sessions: 3 };
    const ledger: string[] = [];
    for (const id of ["A", "B", "C", "D"]) recordSessionSighting(row, ledger, id);
    expect(row.sessions).toBe(4); // max(3, 4)
  });

  it("does not move the count on a repeat sighting of a known id", () => {
    const row = { sessions: 2 };
    const ledger = ["A", "B"];
    recordSessionSighting(row, ledger, "A");
    expect(row.sessions).toBe(2);
    expect(ledger).toEqual(["A", "B"]);
  });
});

// Distinct-session-per-day bookkeeping for the runtime stats "会话" metric.
//
// Counting Claude Code sessions from the SessionStart hook alone undercounts: that
// hook fires once, at a session's start, so a session that was already running when
// the pet launched never re-announces itself and is missed — even though its later
// tool/prompt events keep flowing. Instead we key on the Claude session id that now
// rides on every forwarded event: the FIRST time an id is seen on a given day marks
// that session, so a pre-existing session is counted the moment any of its events
// arrives, and two concurrent sessions both count regardless of who started first.

/** Cap the per-day id list so a pathological day can't grow it without bound. Real
 *  usage is a handful to a few dozen sessions/day; this only guards against garbage. */
export const MAX_DAILY_SESSION_IDS = 500;

/**
 * Record a session sighting for a day. `seen` is the persisted per-day id list and is
 * mutated in place. Returns true only when `sessionId` is a new id for that day (the
 * caller then refreshes the day's session count to `seen.length`), false for a missing
 * id, a repeat sighting, or once the per-day cap is reached.
 */
export function noteDailySession(seen: string[], sessionId: string | null | undefined): boolean {
  if (typeof sessionId !== "string" || !sessionId) return false;
  if (seen.includes(sessionId)) return false;
  if (seen.length >= MAX_DAILY_SESSION_IDS) return false;
  seen.push(sessionId);
  return true;
}

/**
 * Fold a session sighting into a day's row: record the id in `ledger` and refresh
 * `dayRow.sessions`. The count is the MAX of what the day already held and the distinct-id
 * total — never a plain overwrite. On the upgrade to id-counting the ledger starts empty while
 * `dayRow.sessions` may already carry the day's earlier tally (from the old SessionStart count),
 * and sessions that ended before the upgrade won't re-emit an event to be re-counted; taking the
 * max lets the day only ever grow as new distinct ids arrive instead of collapsing to just the
 * still-running ones. On a fresh day the row starts at 0, so max degrades to the exact count.
 */
export function recordSessionSighting(dayRow: { sessions: number }, ledger: string[], sessionId: string | null | undefined): void {
  if (!noteDailySession(ledger, sessionId)) return;
  dayRow.sessions = Math.max(dayRow.sessions ?? 0, ledger.length);
}

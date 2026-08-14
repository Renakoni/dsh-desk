// Durable per-day token history for the request heatmap.
//
// The heatmap is otherwise derived from a live scan of ~/.claude/projects, so a day's
// data vanishes once Claude Code rotates away that day's session logs. Past days are
// immutable, though: once a day is over and its logs were complete, re-scanning yields
// the same totals. So we persist each day's totals and merge every fresh scan into that
// history, keeping the FULLER entry per day so the stored history survives log rotation.

export interface DatedTokenEntry {
  date: string;
  requestCount: number;
  totalTokens: number;
}

/**
 * Merge freshly-scanned day totals into the persisted history, overwriting a day only when
 * the fresh scan is a clear superset of what we stored — MORE (or equal) requests AND tokens.
 *
 * requestCount alone is not proof of completeness: log rotation can drop a few high-token
 * requests from a day while new small ones are added, giving a higher request count but
 * fewer tokens; overwriting there would lose real history. A day that legitimately grows
 * (today, append-only) rises on both counts, so it still wins; a day whose logs were
 * (partly) rotated away drops on tokens, so the stored fuller value is kept.
 */
export function mergeTokenDailyHistory<T extends DatedTokenEntry>(
  persisted: Record<string, T>,
  fresh: readonly T[]
): Record<string, T> {
  const out: Record<string, T> = { ...persisted };
  for (const entry of fresh) {
    if (!entry || typeof entry.date !== "string") continue;
    const existing = out[entry.date];
    const freshWins = !existing
      || ((Number(entry.requestCount) || 0) >= (Number(existing.requestCount) || 0)
        && (Number(entry.totalTokens) || 0) >= (Number(existing.totalTokens) || 0));
    if (freshWins) out[entry.date] = entry;
  }
  return out;
}

/** History map → date-ascending array (the shape the renderer's heatmap consumes). */
export function historyToSortedArray<T extends { date: string }>(history: Record<string, T>): T[] {
  return Object.values(history).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parse a persisted history file back into a map. Tolerates the `{ version, days }`
 * envelope or a bare map, drops anything that isn't a YYYY-MM-DD → object entry, and
 * coerces requestCount/totalTokens so a corrupt field can't poison the merge.
 */
export function normalizeTokenDailyHistory(raw: unknown): Record<string, DatedTokenEntry & Record<string, unknown>> {
  const envelope = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const source = envelope && envelope.days && typeof envelope.days === "object" && !Array.isArray(envelope.days)
    ? envelope.days as Record<string, unknown>
    : envelope;
  const out: Record<string, DatedTokenEntry & Record<string, unknown>> = {};
  if (!source) return out;
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
  for (const [date, value] of Object.entries(source)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    out[date] = {
      ...entry,
      date,
      requestCount: finite(entry.requestCount),
      totalTokens: finite(entry.totalTokens)
    };
  }
  return out;
}

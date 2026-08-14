// Pure merge of two runtime-stats snapshots. Used to fold a previous app-name's
// runtime-stats.json into the current one (the app has been renamed over time, and
// Electron keys userData by app name, so each rename orphaned the prior history).
//
// Every count is additive: each app instance recorded its OWN events/runtime, so the
// all-time totals are the sum across versions. Per-day maps are unioned by date and
// summed where a date appears in both (e.g. the day of the rename, split across the
// old and new install). firstStartTime takes the earliest, lastEventTime the latest.

export interface DailyRow {
  events: number;
  toolCalls: number;
  sessions: number;
  errors?: number;
  permissionRequests?: number;
}

export interface RuntimeStatsShape {
  toolUsage: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  totalSessions: number;
  dailyStats: Record<string, DailyRow>;
  errorCount: number;
  permissionRequests: number;
  permissionApproved: number;
  permissionDenied: number;
  totalRuntime: number;
  hourlyActivity: number[];
  dailyHourlyActivity: Record<string, number[]>;
  dailyToolUsage: Record<string, Record<string, number>>;
  firstStartTime: number;
  lastEventTime: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sumRecords(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = num(out[key]) + num(value);
  return out;
}

function sumHourly(a: number[], b: number[]): number[] {
  return Array.from({ length: 24 }, (_, hour) => num(a?.[hour]) + num(b?.[hour]));
}

function sumDailyRow(a: DailyRow | undefined, b: DailyRow | undefined): DailyRow {
  return {
    events: num(a?.events) + num(b?.events),
    toolCalls: num(a?.toolCalls) + num(b?.toolCalls),
    sessions: num(a?.sessions) + num(b?.sessions),
    errors: num(a?.errors) + num(b?.errors),
    permissionRequests: num(a?.permissionRequests) + num(b?.permissionRequests)
  };
}

function mergeByDate<T>(a: Record<string, T>, b: Record<string, T>, combine: (x: T | undefined, y: T | undefined) => T): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const day of Object.keys(b)) out[day] = combine(a[day], b[day]);
  return out;
}

/** Merge `incoming` (usually an older install's stats) into `base`, returning a new object. */
export function mergeRuntimeStats(base: RuntimeStatsShape, incoming: RuntimeStatsShape): RuntimeStatsShape {
  // Earliest first start across installs, ignoring 0/unset; 0 when neither has one.
  const starts = [base.firstStartTime, incoming.firstStartTime].filter(t => num(t) > 0);
  return {
    toolUsage: sumRecords(base.toolUsage, incoming.toolUsage),
    eventTypeCounts: sumRecords(base.eventTypeCounts, incoming.eventTypeCounts),
    totalSessions: num(base.totalSessions) + num(incoming.totalSessions),
    dailyStats: mergeByDate(base.dailyStats, incoming.dailyStats, sumDailyRow),
    errorCount: num(base.errorCount) + num(incoming.errorCount),
    permissionRequests: num(base.permissionRequests) + num(incoming.permissionRequests),
    permissionApproved: num(base.permissionApproved) + num(incoming.permissionApproved),
    permissionDenied: num(base.permissionDenied) + num(incoming.permissionDenied),
    totalRuntime: num(base.totalRuntime) + num(incoming.totalRuntime),
    hourlyActivity: sumHourly(base.hourlyActivity, incoming.hourlyActivity),
    dailyHourlyActivity: mergeByDate(base.dailyHourlyActivity, incoming.dailyHourlyActivity, (x, y) => sumHourly(x ?? [], y ?? [])),
    dailyToolUsage: mergeByDate(base.dailyToolUsage, incoming.dailyToolUsage, (x, y) => sumRecords(x ?? {}, y ?? {})),
    firstStartTime: starts.length ? Math.min(...starts) : 0,
    lastEventTime: Math.max(num(base.lastEventTime), num(incoming.lastEventTime))
  };
}

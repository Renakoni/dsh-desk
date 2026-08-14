// @ts-nocheck
import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AppStats } from "../../shared/events";
import { useI18n } from "../useI18n";

type StatsRange = "today" | "7d" | "all";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function localDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftLocalDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKeyToLocalDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function recentDateKeys(days: number): string[] {
  const today = dateKeyToLocalDate(localDateKey());
  return Array.from({ length: days }, (_, index) => localDateKey(shiftLocalDate(today, index - days + 1).getTime()));
}

function formatHourRange(hour: number): string {
  const label = String(hour).padStart(2, "0");
  return `${label}:00-${label}:59`;
}

function formatCount(value: number, locale: string): string {
  return Math.round(value || 0).toLocaleString(locale);
}

function sumRecord(record: Record<string, number> | undefined): number {
  return Object.values(record ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
}

function sortCounts(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
}

function topHoursFromBuckets(buckets: number[]): Array<{ hour: number; count: number }> {
  return buckets
    .map((value, hour) => ({ hour, count: value || 0 }))
    .filter(hour => hour.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function mergeHourlyBuckets(stats: AppStats, keys: string[]): number[] {
  const buckets = new Array(24).fill(0);
  for (const key of keys) {
    const daily = stats.dailyHourlyActivity?.[key];
    if (!Array.isArray(daily)) continue;
    daily.forEach((count, hour) => { buckets[hour] += count || 0; });
  }
  return buckets;
}

function mergeToolUsage(stats: AppStats, keys: string[]): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const key of keys) {
    const daily = stats.dailyToolUsage?.[key];
    if (!daily) continue;
    for (const [tool, count] of Object.entries(daily)) {
      usage[tool] = (usage[tool] ?? 0) + (Number(count) || 0);
    }
  }
  return usage;
}

function sumDailyRows(stats: AppStats, keys: string[]) {
  return keys.reduce((total, key) => {
    const row = stats.dailyStats?.[key];
    if (!row) return total;
    total.events += row.events ?? 0;
    total.toolCalls += row.toolCalls ?? 0;
    total.sessions += row.sessions ?? 0;
    total.errors += row.errors ?? 0;
    total.permissionRequests += row.permissionRequests ?? 0;
    total.activeDays += row.events > 0 || row.toolCalls > 0 || row.sessions > 0 ? 1 : 0;
    return total;
  }, { events: 0, toolCalls: 0, sessions: 0, errors: 0, permissionRequests: 0, activeDays: 0 });
}

function activeDayKeys(stats: AppStats): string[] {
  return Object.entries(stats.dailyStats ?? {})
    .filter(([, row]) => (row.events ?? 0) > 0 || (row.toolCalls ?? 0) > 0 || (row.sessions ?? 0) > 0)
    .map(([key]) => key);
}

export function StatsPanel({ stats }: { stats: AppStats }) {
  const { t, locale } = useI18n();
  const numberLocale = locale === "zh" ? "zh-CN" : "en-US";
  const [range, setRange] = useState<StatsRange>("7d");
  const [toolsExpanded, setToolsExpanded] = useState(false);

  // These aggregates feed the rangeData memo below. Recomputing them into fresh
  // objects/arrays on every render (the parent re-renders StatsPanel on the 5s stats
  // tick and on unrelated state changes) hands rangeData new dependency identities
  // each time, so it recomputes every render despite being memoized. Key them to
  // `stats` so they — and rangeData — stay stable until the data actually changes.
  // avgDaily is a trivial derived value used only for display, so it stays inline.
  const allToolUsage = useMemo(() => stats.toolUsage ?? {}, [stats]);
  const totalToolCalls = useMemo(() => sumRecord(allToolUsage), [allToolUsage]);
  const totalEvents = useMemo(() => sumRecord(stats.eventTypeCounts), [stats]);
  const days = useMemo(() => Object.keys(stats.dailyStats ?? {}).length, [stats]);
  const activeDays = useMemo(() => activeDayKeys(stats), [stats]);
  const avgDaily = days > 0 ? Math.round(totalToolCalls / days) : 0;
  const allMetrics = useMemo(() => ({
    events: totalEvents,
    toolCalls: totalToolCalls,
    sessions: stats.totalSessions ?? 0,
    errors: stats.errorCount ?? 0,
    permissionRequests: stats.permissionRequests ?? 0,
    activeDays: days
  }), [stats, totalEvents, totalToolCalls, days]);
  const rangeOptions: Array<{ value: StatsRange; label: string }> = [
    { value: "today", label: t("stats.rangeToday", "今日") },
    { value: "7d", label: t("stats.range7d", "近 7 日") },
    { value: "all", label: t("stats.rangeAll", "全部") }
  ];

  const rangeData = useMemo(() => {
    if (range === "all") {
      return {
        label: t("stats.rangeAll", "全部"),
        metrics: allMetrics,
        topHours: topHoursFromBuckets(stats.hourlyActivity ?? new Array(24).fill(0)),
        tools: sortCounts(allToolUsage),
        hasHourlyDetail: (stats.hourlyActivity ?? []).some(count => count > 0),
        hasToolDetail: totalToolCalls > 0
      };
    }

    const keys = range === "today" ? [localDateKey()] : recentDateKeys(7);
    const dailyTotals = sumDailyRows(stats, keys);
    const rangeCoversAllRecordedDays = activeDays.length > 0 && activeDays.every(key => keys.includes(key));
    const hourlyBuckets = rangeCoversAllRecordedDays ? stats.hourlyActivity ?? new Array(24).fill(0) : mergeHourlyBuckets(stats, keys);
    const toolUsage = rangeCoversAllRecordedDays ? allToolUsage : mergeToolUsage(stats, keys);
    const rangeLabel = range === "today" ? t("stats.rangeToday", "今日") : t("stats.range7d", "近 7 日");
    return {
      label: rangeLabel,
      metrics: rangeCoversAllRecordedDays ? allMetrics : dailyTotals,
      topHours: topHoursFromBuckets(hourlyBuckets),
      tools: sortCounts(toolUsage),
      hasHourlyDetail: hourlyBuckets.some(count => count > 0),
      hasToolDetail: Object.keys(toolUsage).length > 0
    };
  }, [activeDays, allMetrics, allToolUsage, range, stats, t, totalToolCalls]);

  const rangeRows = [
    { label: t("stats.events", "事件"), value: formatCount(rangeData.metrics.events, numberLocale) },
    { label: t("stats.toolCalls", "工具调用"), value: formatCount(rangeData.metrics.toolCalls, numberLocale) },
    { label: t("stats.sessions", "会话"), value: formatCount(rangeData.metrics.sessions, numberLocale) },
    { label: t("stats.permissionRequests", "权限请求"), value: formatCount(rangeData.metrics.permissionRequests, numberLocale) },
    { label: t("stats.errors", "错误次数"), value: formatCount(rangeData.metrics.errors, numberLocale) }
  ];
  const topToolCount = rangeData.tools[0]?.[1] ?? 1;
  const toolSummary = rangeData.tools.length > 0
    ? `${rangeData.label} · ${formatCount(rangeData.tools.length, numberLocale)} ${t("stats.tools", "个工具")}`
    : `${rangeData.label} · ${t("stats.noData", "无数据")}`;
  const hoursTitle = range === "all"
    ? t("stats.historicalActiveHours", "历史高频时段")
    : range === "today"
      ? t("stats.todayActiveHours", "今日高频时段")
      : t("stats.sevenDayActiveHours", "7日高频时段");

  return (
    <div className="stats-workbench">
      <section className="stats-activity-board">
        <header className="stats-board-head">
          <div className="stats-runtime-inline">
            <span>{t("stats.totalRuntime", "累计运行")}</span>
            <strong>{formatDuration(stats.totalRuntime ?? 0)}</strong>
            <small>{days > 0 ? `${formatCount(days, numberLocale)} ${t("stats.activeDays", "活跃天数")} · ${t("stats.dailyAvg", "日均调用")} ${formatCount(avgDaily, numberLocale)}` : t("stats.noData", "无数据")}</small>
          </div>
        </header>

        <div className="stats-range-block">
          <header className="stats-range-bar">
            <h3>{t("stats.rangeMetricsTitle", "统计范围")}</h3>
            <div className="stats-range-switch" role="tablist" aria-label={t("stats.timeRange", "时间范围")}>
              {rangeOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={range === option.value ? "active" : ""}
                  onClick={() => setRange(option.value)}
                  role="tab"
                  aria-selected={range === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </header>

          <div className="stats-range-metrics">
            {rangeRows.map(row => (
              <article key={row.label} className="stats-range-metric">
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </article>
            ))}
          </div>
        </div>

        <div className="stats-hours-section">
          <header>
            <h3>{hoursTitle}</h3>
            <span>{t("stats.eventTop3", "事件 Top3")}</span>
          </header>
          <div className="stats-hours-list">
            {rangeData.topHours.length > 0 ? rangeData.topHours.map(hour => (
              <div key={hour.hour} className="stats-line-row">
                <span>{formatHourRange(hour.hour)}</span>
                <strong>{formatCount(hour.count, numberLocale)} {t("stats.eventTimes", "次事件")}</strong>
              </div>
            )) : (
              <div className="stats-line-row stats-empty-row">
                <span>{rangeData.hasHourlyDetail ? t("stats.noData", "无数据") : t("stats.noHourlyDetail", "暂无时段明细")}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={`stats-table-section stats-disclosure ${toolsExpanded ? "open" : ""}`}>
        <button className="stats-disclosure-trigger" type="button" aria-expanded={toolsExpanded} onClick={() => setToolsExpanded(value => !value)}>
          <ChevronDown size={15} className="stats-disclosure-chevron" />
          <span>
            <strong>{t("stats.toolRanking", "工具使用排行")}</strong>
            <small>{toolSummary}</small>
          </span>
        </button>
        {toolsExpanded ? (
          rangeData.tools.length > 0 ? (
            <div className="tool-rank-list">
              {rangeData.tools.map(([tool, count], index) => (
                <div key={tool} className="tool-rank-row">
                  <span className="tool-rank-pos">{index + 1}</span>
                  <span className="tool-rank-name">{tool}</span>
                  <div className="tool-rank-bar">
                    <div className="tool-rank-fill" style={{ width: `${(count / topToolCount) * 100}%` }} />
                  </div>
                  <span className="tool-rank-count">{formatCount(count, numberLocale)}</span>
                </div>
              ))}
            </div>
          ) : <p className="note">{rangeData.hasToolDetail ? t("stats.noData", "无数据") : t("stats.noToolDetail", "暂无工具明细")}</p>
        ) : null}
      </section>
    </div>
  );
}

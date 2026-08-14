// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import type { DshAnalyticsSnapshot, DshSessionMetric } from "../../../shared/dshAnalytics";
import type { AppStats } from "../../shared/events";
import { useI18n } from "../useI18n";

type StatsRange = "today" | "7d" | "all";

function formatDuration(ms: number, zh: boolean): string {
  const seconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return zh ? `${hours} 小时 ${minutes % 60} 分` : `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return zh ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes}m ${seconds % 60}s`;
  return zh ? `${seconds} 秒` : `${seconds}s`;
}

function formatPreciseDuration(value: number, zh: boolean): string {
  if (!value) return zh ? "0 秒" : "0s";
  if (value < 1_000) return `${Math.round(value)} ms`;
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return zh ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return zh ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return zh ? `${hours} 小时 ${minutes % 60} 分` : `${hours}h ${minutes % 60}m`;
}

function formatMilliseconds(value: number, locale: string): string {
  return value > 0 ? `${Math.round(value).toLocaleString(locale)} ms` : "—";
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

function topHoursFromBuckets(buckets: number[]): Array<{ hour: number; count: number }> {
  return buckets
    .map((value, hour) => ({ hour, count: value || 0 }))
    .filter(hour => hour.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
}

function mergeHourlyBuckets(dailyHourlyActivity: Record<string, number[]> | undefined, keys: string[]): number[] {
  const buckets = new Array(24).fill(0);
  for (const key of keys) {
    const daily = dailyHourlyActivity?.[key];
    if (!Array.isArray(daily)) continue;
    daily.forEach((count, hour) => { buckets[hour] += count || 0; });
  }
  return buckets;
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

function rangeSessionMetrics(sessions: DshSessionMetric[]) {
  return sessions.reduce((total, session) => ({
    ttftMs: total.ttftMs + session.ttftMs,
    ttftSteps: total.ttftSteps + session.ttftSteps,
    decodeMs: total.decodeMs + session.decodeMs,
    decodeTokens: total.decodeTokens + session.decodeTokens
  }), { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 });
}

export function StatsPanel({ stats, snapshot = null }: {
  stats: AppStats;
  snapshot?: DshAnalyticsSnapshot | null;
}) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const numberLocale = zh ? "zh-CN" : "en-US";
  const [range, setRange] = useState<StatsRange>("7d");
  const runtimeAnchor = useMemo(() => ({ value: stats.totalRuntime ?? 0, capturedAt: Date.now() }), [stats]);
  const [runtimeNow, setRuntimeNow] = useState(runtimeAnchor.capturedAt);

  useEffect(() => {
    setRuntimeNow(Date.now());
    const timer = window.setInterval(() => setRuntimeNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runtimeAnchor]);

  const liveTotalRuntime = runtimeAnchor.value + Math.max(0, runtimeNow - runtimeAnchor.capturedAt);
  const persistedToolCalls = useMemo(() => sumRecord(stats.toolUsage), [stats]);
  const totalEvents = useMemo(() => sumRecord(stats.eventTypeCounts), [stats]);
  const days = useMemo(() => snapshot
    ? snapshot.daily.filter(day => day.events > 0 || day.toolCalls > 0 || day.sessions > 0).length
    : Object.keys(stats.dailyStats ?? {}).length, [snapshot, stats]);
  const totalToolCalls = snapshot?.totals.toolCalls ?? persistedToolCalls;
  const avgDaily = days > 0 ? Math.round(totalToolCalls / days) : 0;
  const persistedAllMetrics = useMemo(() => ({
    events: totalEvents,
    toolCalls: persistedToolCalls,
    sessions: stats.totalSessions ?? 0,
    errors: stats.errorCount ?? 0,
    permissionRequests: stats.permissionRequests ?? 0
  }), [persistedToolCalls, stats, totalEvents]);
  const rangeOptions: Array<{ value: StatsRange; label: string }> = [
    { value: "today", label: t("stats.rangeToday", "今日") },
    { value: "7d", label: t("stats.range7d", "近 7 日") },
    { value: "all", label: t("stats.rangeAll", "全部") }
  ];

  const rangeData = useMemo(() => {
    if (snapshot) {
      if (range === "all") {
        return {
          metrics: snapshot.totals,
          topHours: topHoursFromBuckets(snapshot.hourlyActivity),
          hasHourlyDetail: snapshot.hourlyActivity.some(count => count > 0)
        };
      }
      const keyList = range === "today" ? [localDateKey()] : recentDateKeys(7);
      const keys = new Set(keyList);
      const selectedDays = snapshot.daily.filter(day => keys.has(day.date));
      const selectedSessions = snapshot.sessions.filter(session => keys.has(localDateKey(session.lastActivity)));
      const performance = rangeSessionMetrics(selectedSessions);
      const metrics = selectedDays.reduce((total, day) => ({
        ...total,
        events: total.events + day.events,
        turns: total.turns + day.turns,
        steps: total.steps + day.steps,
        toolCalls: total.toolCalls + day.toolCalls,
        failedToolCalls: total.failedToolCalls + day.failedToolCalls,
        permissionRequests: total.permissionRequests + day.permissionRequests,
        llmMs: total.llmMs + day.llmMs,
        toolMs: total.toolMs + day.toolMs
      }), {
        events: 0,
        sessions: selectedSessions.length,
        turns: 0,
        steps: 0,
        toolCalls: 0,
        failedToolCalls: 0,
        permissionRequests: 0,
        llmMs: 0,
        toolMs: 0,
        ...performance
      });
      const hourlyBuckets = mergeHourlyBuckets(snapshot.dailyHourlyActivity, keyList);
      return {
        metrics,
        topHours: topHoursFromBuckets(hourlyBuckets),
        hasHourlyDetail: hourlyBuckets.some(count => count > 0)
      };
    }

    if (range === "all") {
      return {
        metrics: persistedAllMetrics,
        topHours: topHoursFromBuckets(stats.hourlyActivity ?? new Array(24).fill(0)),
        hasHourlyDetail: (stats.hourlyActivity ?? []).some(count => count > 0)
      };
    }
    const keys = range === "today" ? [localDateKey()] : recentDateKeys(7);
    const dailyTotals = sumDailyRows(stats, keys);
    const activeDays = activeDayKeys(stats);
    const rangeCoversAllRecordedDays = activeDays.length > 0 && activeDays.every(key => keys.includes(key));
    const hourlyBuckets = rangeCoversAllRecordedDays ? stats.hourlyActivity ?? new Array(24).fill(0) : mergeHourlyBuckets(stats.dailyHourlyActivity, keys);
    return {
      metrics: rangeCoversAllRecordedDays ? persistedAllMetrics : dailyTotals,
      topHours: topHoursFromBuckets(hourlyBuckets),
      hasHourlyDetail: hourlyBuckets.some(count => count > 0)
    };
  }, [persistedAllMetrics, range, snapshot, stats]);

  const hoursTitle = range === "all"
    ? t("stats.historicalActiveHours", "历史高频时段")
    : range === "today"
      ? t("stats.todayActiveHours", "今日高频时段")
      : t("stats.sevenDayActiveHours", "7日高频时段");
  const dshMetrics = snapshot ? rangeData.metrics : null;
  const averageTtft = dshMetrics?.ttftSteps ? dshMetrics.ttftMs / dshMetrics.ttftSteps : 0;
  const decodeRate = dshMetrics?.decodeMs ? dshMetrics.decodeTokens / (dshMetrics.decodeMs / 1_000) : 0;
  const countRows = [
    { label: t("stats.events", "事件"), value: formatCount(rangeData.metrics.events, numberLocale) },
    { label: t("stats.toolCalls", "工具调用"), value: formatCount(rangeData.metrics.toolCalls, numberLocale) },
    { label: t("stats.sessions", "会话"), value: formatCount(rangeData.metrics.sessions, numberLocale) },
    { label: t("stats.permissionRequests", "权限请求"), value: formatCount(rangeData.metrics.permissionRequests, numberLocale) },
    { label: t("stats.errors", "错误次数"), value: formatCount(rangeData.metrics.failedToolCalls ?? rangeData.metrics.errors, numberLocale) }
  ];
  const performancePairs = dshMetrics ? [
    [
      { label: zh ? "对话轮次" : "Conversation turns", value: formatCount(dshMetrics.turns, numberLocale) },
      { label: zh ? "执行步骤" : "Execution steps", value: formatCount(dshMetrics.steps, numberLocale) }
    ],
    [
      { label: zh ? "处理总耗时" : "Total processing time", value: formatPreciseDuration(dshMetrics.llmMs + dshMetrics.toolMs, zh) },
      { label: zh ? "模型响应耗时" : "Model response time", value: formatPreciseDuration(dshMetrics.llmMs, zh) }
    ],
    [
      { label: zh ? "平均首字延迟" : "Average first-token latency", value: formatMilliseconds(averageTtft, numberLocale), meta: zh ? `${dshMetrics.ttftSteps} 次采样` : `${dshMetrics.ttftSteps} samples` },
      { label: zh ? "生成速度" : "Generation speed", value: decodeRate ? (zh ? `${decodeRate.toFixed(1)} token/秒` : `${decodeRate.toFixed(1)} tok/s`) : "—" }
    ]
  ] : [];

  return (
    <div className="stats-workbench dsh-runtime-panel">
      <section className="stats-activity-board">
        <header className="stats-board-head">
          <div className="stats-runtime-inline">
            <span>{t("stats.totalRuntime", "累计运行")}</span>
            <strong>{formatDuration(liveTotalRuntime, zh)}</strong>
            <small>{days > 0 ? `${formatCount(days, numberLocale)} ${t("stats.activeDays", "活跃天数")} · ${t("stats.dailyAvg", "日均调用")} ${formatCount(avgDaily, numberLocale)}` : t("stats.noData", "无数据")}</small>
          </div>
        </header>

        <div className="stats-range-block">
          <header className="stats-range-bar">
            <h3>{t("stats.rangeMetricsTitle", "统计范围")}</h3>
            <div className="stats-range-switch" role="tablist" aria-label={t("stats.timeRange", "时间范围")}>
              {rangeOptions.map(option => (
                <button key={option.value} type="button" className={range === option.value ? "active" : ""} onClick={() => setRange(option.value)} role="tab" aria-selected={range === option.value}>{option.label}</button>
              ))}
            </div>
          </header>
          <div className="stats-range-dashboard">
            <div className="stats-range-metrics stats-count-metrics">
              {countRows.map(row => <article key={row.label} className="stats-range-metric"><span>{row.label}</span><strong>{row.value}</strong></article>)}
            </div>
            {performancePairs.length > 0 ? (
              <div className="stats-performance-metrics">
                {performancePairs.map((pair, index) => (
                  <article className="stats-performance-pair" key={index}>
                    {pair.map(metric => <div className="stats-performance-value" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.meta ? <small>{metric.meta}</small> : null}</div>)}
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="stats-hours-section">
          <header><h3>{hoursTitle}</h3><span>{t("stats.eventTop3", "事件 Top3")}</span></header>
          <div className="stats-hours-list">
            {rangeData.topHours.length > 0 ? rangeData.topHours.map(hour => (
              <div key={hour.hour} className="stats-line-row"><span>{formatHourRange(hour.hour)}</span><strong>{formatCount(hour.count, numberLocale)} {t("stats.eventTimes", "次事件")}</strong></div>
            )) : <div className="stats-line-row stats-empty-row"><span>{rangeData.hasHourlyDetail ? t("stats.noData", "无数据") : t("stats.noHourlyDetail", "暂无时段明细")}</span></div>}
          </div>
        </div>
      </section>

    </div>
  );
}

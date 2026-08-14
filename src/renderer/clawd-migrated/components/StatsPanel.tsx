// @ts-nocheck
import React, { useMemo, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import type { DshAnalyticsSnapshot, DshSessionMetric } from "../../../shared/dshAnalytics";
import { useI18n } from "../useI18n";

type StatsRange = "today" | "7d" | "all";

const COLLAPSED_SESSIONS = 8;

function localDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recentDateKeys(days: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() + index - days + 1);
    return localDateKey(date.getTime());
  });
}

function formatDuration(value: number, zh: boolean): string {
  if (!value) return "0s";
  if (value < 1_000) return `${Math.round(value)}ms`;
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return zh ? `${hours}小时 ${minutes % 60}分` : `${hours}h ${minutes % 60}m`;
}

function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function formatWhen(timestamp: number, zh: boolean): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return zh ? "刚刚" : "now";
  if (delta < 3_600_000) return zh ? `${Math.floor(delta / 60_000)} 分钟前` : `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return zh ? `${Math.floor(delta / 3_600_000)} 小时前` : `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit" });
}

function mergeHourly(snapshot: DshAnalyticsSnapshot, keys: Set<string>): number[] {
  const hours = new Array(24).fill(0);
  for (const key of keys) {
    const day = snapshot.dailyHourlyActivity[key];
    if (Array.isArray(day)) day.forEach((count, hour) => { hours[hour] += count || 0; });
  }
  return hours;
}

function topHours(hours: number[]): Array<{ hour: number; count: number }> {
  return hours
    .map((count, hour) => ({ hour, count: count || 0 }))
    .filter(item => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
}

function rangeSessionMetrics(sessions: DshSessionMetric[]) {
  return sessions.reduce((total, session) => ({
    ttftMs: total.ttftMs + session.ttftMs,
    ttftSteps: total.ttftSteps + session.ttftSteps,
    decodeMs: total.decodeMs + session.decodeMs,
    decodeTokens: total.decodeTokens + session.decodeTokens
  }), { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 });
}

export function StatsPanel({ snapshot, loading = false, error = null, onRefresh, hideSensitiveContent = false, onRevealSession }: {
  snapshot: DshAnalyticsSnapshot | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: (force: boolean) => void;
  hideSensitiveContent?: boolean;
  onRevealSession?: (filePath: string) => void;
}) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const numberLocale = zh ? "zh-CN" : "en-US";
  const [range, setRange] = useState<StatsRange>("7d");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rangeOptions: Array<{ value: StatsRange; label: string }> = [
    { value: "today", label: t("stats.rangeToday", "今日") },
    { value: "7d", label: t("stats.range7d", "近 7 日") },
    { value: "all", label: t("stats.rangeAll", "全部") }
  ];

  const rangeData = useMemo(() => {
    if (!snapshot) return null;
    if (range === "all") {
      return {
        label: t("stats.rangeAll", "全部"),
        metrics: snapshot.totals,
        sessions: snapshot.sessions,
        hours: snapshot.hourlyActivity,
        activeDays: snapshot.daily.filter(day => day.events > 0).length
      };
    }
    const keys = new Set(range === "today" ? [localDateKey()] : recentDateKeys(7));
    const days = snapshot.daily.filter(day => keys.has(day.date));
    const sessions = snapshot.sessions.filter(session => keys.has(localDateKey(session.lastActivity)));
    const performance = rangeSessionMetrics(sessions);
    return {
      label: range === "today" ? t("stats.rangeToday", "今日") : t("stats.range7d", "近 7 日"),
      metrics: days.reduce((total, day) => ({
        ...total,
        events: total.events + day.events,
        turns: total.turns + day.turns,
        steps: total.steps + day.steps,
        toolCalls: total.toolCalls + day.toolCalls,
        failedToolCalls: total.failedToolCalls + day.failedToolCalls,
        permissionRequests: total.permissionRequests + day.permissionRequests,
        permissionApproved: total.permissionApproved + day.permissionApproved,
        permissionDenied: total.permissionDenied + day.permissionDenied,
        llmMs: total.llmMs + day.llmMs,
        toolMs: total.toolMs + day.toolMs
      }), {
        events: 0,
        sessions: sessions.length,
        turns: 0,
        steps: 0,
        toolCalls: 0,
        failedToolCalls: 0,
        permissionRequests: 0,
        permissionApproved: 0,
        permissionDenied: 0,
        llmMs: 0,
        toolMs: 0,
        ...performance
      }),
      sessions,
      hours: mergeHourly(snapshot, keys),
      activeDays: days.filter(day => day.events > 0).length
    };
  }, [range, snapshot, t]);

  if (!snapshot && loading) return <p className="note">{zh ? "正在扫描 DSH 数据…" : "Scanning DSH data…"}</p>;
  if (!snapshot || !rangeData) return <p className="note">{error ? `${zh ? "扫描失败" : "Scan failed"}: ${error}` : (zh ? "暂无本地运行数据" : "No local runtime data")}</p>;

  const metrics = rangeData.metrics;
  const averageTtft = metrics.ttftSteps ? metrics.ttftMs / metrics.ttftSteps : 0;
  const decodeRate = metrics.decodeMs ? metrics.decodeTokens / (metrics.decodeMs / 1_000) : 0;
  const activeMs = metrics.llmMs + metrics.toolMs;
  const frequentHours = topHours(rangeData.hours);
  const visibleSessions = (expanded ? rangeData.sessions : rangeData.sessions.slice(0, COLLAPSED_SESSIONS));
  const runtimeRows = [
    { label: zh ? "会话" : "Sessions", value: metrics.sessions.toLocaleString(numberLocale), meta: `${rangeData.activeDays} ${zh ? "个活跃日" : "active days"}` },
    { label: "Turns", value: metrics.turns.toLocaleString(numberLocale) },
    { label: "Steps", value: metrics.steps.toLocaleString(numberLocale) },
    { label: zh ? "活跃耗时" : "Active time", value: formatDuration(activeMs, zh), meta: "LLM + Tools" },
    { label: zh ? "模型耗时" : "Model time", value: formatDuration(metrics.llmMs, zh), meta: `${decodeRate.toFixed(1)} tok/s` },
    { label: zh ? "平均首字" : "Average TTFT", value: formatDuration(averageTtft, zh), meta: `${metrics.ttftSteps} samples` }
  ];

  return (
    <div className="stats-workbench dsh-runtime-panel">
      <div className="trajectory-toolbar">
        <p className="note">{snapshot.totals.sessions.toLocaleString(numberLocale)} {zh ? "个会话" : "sessions"} · {formatWhen(snapshot.lastScannedAt, zh)}</p>
        <button className="ghost-btn" onClick={() => onRefresh?.(true)} disabled={loading}>{loading ? (zh ? "扫描中…" : "Scanning…") : (zh ? "刷新" : "Refresh")}</button>
      </div>

      <section className="stats-activity-board">
        <div className="stats-range-block">
          <header className="stats-range-bar">
            <h3>{t("stats.rangeMetricsTitle", "统计范围")}</h3>
            <div className="stats-range-switch" role="tablist" aria-label={t("stats.timeRange", "时间范围")}>
              {rangeOptions.map(option => (
                <button key={option.value} type="button" className={range === option.value ? "active" : ""} onClick={() => { setRange(option.value); setExpanded(false); }} role="tab" aria-selected={range === option.value}>{option.label}</button>
              ))}
            </div>
          </header>
          <div className="stats-range-metrics runtime-range-metrics">
            {runtimeRows.map(row => (
              <article key={row.label} className="stats-range-metric">
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                {row.meta ? <small>{row.meta}</small> : null}
              </article>
            ))}
          </div>
        </div>

        <div className="stats-hours-section">
          <header><h3>{zh ? "高频时段" : "Active hours"}</h3><span>{rangeData.label} · Top 3</span></header>
          <div className="stats-hours-list">
            {frequentHours.length > 0 ? frequentHours.map(item => (
              <div key={item.hour} className="stats-line-row"><span>{String(item.hour).padStart(2, "0")}:00-{String(item.hour).padStart(2, "0")}:59</span><strong>{item.count.toLocaleString(numberLocale)} {zh ? "次事件" : "events"}</strong></div>
            )) : <div className="stats-line-row stats-empty-row"><span>{zh ? "暂无时段明细" : "No hourly detail"}</span></div>}
          </div>
        </div>
      </section>

      <section className={`trajectory-sessions-section stats-disclosure ${sessionsOpen ? "open" : ""}`}>
        <button type="button" className="stats-disclosure-trigger" aria-expanded={sessionsOpen} onClick={() => setSessionsOpen(value => !value)}>
          <ChevronDown size={15} className="stats-disclosure-chevron" aria-hidden="true" />
          <span><strong>{zh ? "最近会话" : "Recent sessions"}</strong><small>{rangeData.label} · {rangeData.sessions.length}</small></span>
        </button>
        {sessionsOpen ? (
          <>
            <div className="trajectory-session-table">
              <div className="trajectory-session-header" aria-hidden="true"><span>{zh ? "会话" : "Session"}</span><span>{zh ? "路由" : "Route"}</span><span>{zh ? "工作量" : "Workload"}</span><span>{zh ? "性能" : "Performance"}</span><span>{zh ? "最近" : "Latest"}</span><span /></div>
              {visibleSessions.map((session, index) => (
                <div className="trajectory-session-row" key={session.sessionId}>
                  <div className="trajectory-session-title"><strong title={hideSensitiveContent ? undefined : session.title}>{hideSensitiveContent ? `${zh ? "会话" : "Session"} ${index + 1}` : session.title}</strong><small title={hideSensitiveContent ? undefined : session.projectPath}>{hideSensitiveContent ? (zh ? "详情已隐藏" : "Details hidden") : session.projectName}</small></div>
                  <div className="trajectory-session-route"><strong>{session.model}</strong><small>{session.provider}</small></div>
                  <div className="trajectory-session-numbers"><strong>{session.steps} steps · {session.toolCalls} calls</strong><small>{session.turns} turns · {formatCompact(session.inputTokens + session.outputTokens + session.cacheReadTokens + session.cacheWriteTokens, numberLocale)} tok</small></div>
                  <div className="trajectory-session-numbers"><strong>LLM {formatDuration(session.llmMs, zh)}</strong><small>Tools {formatDuration(session.toolMs, zh)} · TTFT {formatDuration(session.ttftSteps ? session.ttftMs / session.ttftSteps : 0, zh)}</small></div>
                  <time>{formatWhen(session.lastActivity, zh)}</time>
                  {onRevealSession ? <button type="button" className="trajectory-session-reveal" title={zh ? "定位会话日志" : "Reveal session log"} aria-label={zh ? "定位会话日志" : "Reveal session log"} onClick={() => onRevealSession(session.filePath)}><FolderOpen size={14} /></button> : <span />}
                </div>
              ))}
            </div>
            {rangeData.sessions.length > COLLAPSED_SESSIONS ? <button type="button" className="trajectory-expand" onClick={() => setExpanded(value => !value)}><ChevronDown size={14} className={expanded ? "rotated" : undefined} />{expanded ? (zh ? "收起" : "Collapse") : `${zh ? "查看全部" : "Show all"} ${rangeData.sessions.length}`}</button> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

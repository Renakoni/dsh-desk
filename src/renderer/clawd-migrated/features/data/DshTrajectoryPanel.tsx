// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import type { DshAnalyticsSnapshot, DshSessionMetric, DshTrajectoryDay } from "../../../../shared/dshAnalytics";
import { useI18n } from "../../useI18n";

const DAY_MS = 86_400_000;
const HEATMAP_DAYS = 84;
const COLLAPSED_SESSIONS = 8;

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
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

function formatWhen(timestamp: number, zh: boolean): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return zh ? "刚刚" : "now";
  if (delta < 3_600_000) return zh ? `${Math.floor(delta / 60_000)} 分钟前` : `${Math.floor(delta / 60_000)}m ago`;
  if (delta < DAY_MS) return zh ? `${Math.floor(delta / 3_600_000)} 小时前` : `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit" });
}

function sessionContext(session: DshSessionMetric): { value: number; percent: number } {
  const value = session.projectedTokens ?? session.pressureTokens ?? 0;
  return { value, percent: session.contextWindow ? Math.min(100, (value / session.contextWindow) * 100) : 0 };
}

function heatmapDays(daily: DshTrajectoryDay[]): Array<DshTrajectoryDay & { level: number }> {
  const byDate = new Map(daily.map(day => [day.date, day]));
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const values = Array.from({ length: HEATMAP_DAYS }, (_, index) => {
    const timestamp = end.getTime() - (HEATMAP_DAYS - 1 - index) * DAY_MS;
    return byDate.get(localDateKey(timestamp)) ?? { date: localDateKey(timestamp), sessions: 0, turns: 0, steps: 0, toolCalls: 0, failedToolCalls: 0, totalTokens: 0, llmMs: 0, toolMs: 0 };
  });
  const max = Math.max(1, ...values.map(day => day.steps + day.toolCalls));
  return values.map(day => {
    const activity = day.steps + day.toolCalls;
    const ratio = activity / max;
    const level = activity === 0 ? 0 : ratio <= 0.2 ? 1 : ratio <= 0.45 ? 2 : ratio <= 0.7 ? 3 : 4;
    return { ...day, level };
  });
}

function ContextComposition({ session, zh, locale }: { session: DshSessionMetric; zh: boolean; locale: string }) {
  const parts = [
    { key: "system", label: zh ? "系统" : "System", value: session.systemTokens ?? 0 },
    { key: "tools", label: zh ? "工具" : "Tools", value: session.toolsTokens ?? 0 },
    { key: "messages", label: zh ? "消息" : "Messages", value: session.messageTokens ?? 0 }
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="trajectory-context-composition">
      <div className="trajectory-context-bar" aria-label={zh ? "上下文构成" : "Context composition"}>
        {parts.map(part => part.value > 0 ? <i key={part.key} className={part.key} style={{ width: `${(part.value / total) * 100}%` }} /> : null)}
      </div>
      <div className="trajectory-context-legend">
        {parts.map(part => <span key={part.key}><i className={part.key} />{part.label}<b>{formatCompact(part.value, locale)}</b></span>)}
      </div>
    </div>
  );
}

export function DshTrajectoryPanel({ hideSensitiveContent = false }: { hideSensitiveContent?: boolean }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const numberLocale = zh ? "zh-CN" : "en-US";
  const [snapshot, setSnapshot] = useState<DshAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await window.companion.getDshAnalytics(force));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(false); }, []);

  const days = useMemo(() => heatmapDays(snapshot?.daily ?? []), [snapshot]);
  const recentDays = days.slice(-14);
  const maxRecentActivity = Math.max(1, ...recentDays.map(day => day.steps + day.toolCalls));
  const totals = snapshot?.totals;
  const averageTtft = totals?.ttftSteps ? totals.ttftMs / totals.ttftSteps : 0;
  const decodeRate = totals?.decodeMs ? totals.decodeTokens / (totals.decodeMs / 1_000) : 0;
  const errorRate = totals?.toolCalls ? totals.failedToolCalls / totals.toolCalls : 0;
  const latestContextSession = snapshot?.sessions.find(session => session.contextWindow && (session.projectedTokens ?? session.pressureTokens));
  const latestContext = latestContextSession ? sessionContext(latestContextSession) : { value: 0, percent: 0 };
  const visibleSessions = expanded ? snapshot?.sessions ?? [] : (snapshot?.sessions ?? []).slice(0, COLLAPSED_SESSIONS);
  const activeMs = (totals?.llmMs ?? 0) + (totals?.toolMs ?? 0);

  if (!snapshot && loading) return <div className="dsh-trajectory-panel"><p className="note">{zh ? "正在扫描 DSH 轨迹…" : "Scanning DSH trajectories…"}</p></div>;

  return (
    <div className="dsh-trajectory-panel">
      <div className="trajectory-toolbar">
        <p className="note">
          {error ? `${zh ? "扫描失败" : "Scan failed"}: ${error}` : snapshot
            ? `${snapshot.totals.sessions.toLocaleString(numberLocale)} ${zh ? "个会话" : "sessions"} · ${formatWhen(snapshot.lastScannedAt, zh)}`
            : (zh ? "暂无本地轨迹" : "No local trajectories")}
        </p>
        <button className="ghost-btn" onClick={() => void load(true)} disabled={loading}>{loading ? (zh ? "扫描中…" : "Scanning…") : (zh ? "刷新" : "Refresh")}</button>
      </div>

      {snapshot && totals && totals.sessions > 0 ? (
        <>
          <div className="trajectory-kpi-strip">
            <div><span>{zh ? "会话" : "Sessions"}</span><strong>{totals.sessions.toLocaleString(numberLocale)}</strong></div>
            <div><span>Turns</span><strong>{totals.turns.toLocaleString(numberLocale)}</strong></div>
            <div><span>Steps</span><strong>{totals.steps.toLocaleString(numberLocale)}</strong></div>
            <div><span>{zh ? "工具调用" : "Tool calls"}</span><strong>{totals.toolCalls.toLocaleString(numberLocale)}</strong><small className={totals.failedToolCalls ? "bad" : ""}>{totals.failedToolCalls} {zh ? "失败" : "failed"}</small></div>
            <div><span>{zh ? "活跃耗时" : "Active time"}</span><strong>{formatDuration(activeMs, zh)}</strong><small>LLM + Tools</small></div>
            <div><span>{zh ? "平均首字" : "Average TTFT"}</span><strong>{formatDuration(averageTtft, zh)}</strong><small>{totals.ttftSteps} samples</small></div>
          </div>

          <div className="trajectory-visual-grid">
            <section className="trajectory-activity-section">
              <header><h3>{zh ? "活跃轨迹" : "Activity"}</h3><span>{zh ? "近 12 周" : "Last 12 weeks"}</span></header>
              <div className="trajectory-heatmap" role="img" aria-label={zh ? "近 12 周轨迹活跃度" : "Trajectory activity over 12 weeks"}>
                {days.map(day => <i key={day.date} className={`level-${day.level}`} title={`${day.date} · ${day.steps} steps · ${day.toolCalls} calls`} />)}
              </div>
              <div className="trajectory-bars" aria-label={zh ? "近 14 日 step 与工具调用" : "Steps and tool calls over 14 days"}>
                {recentDays.map(day => {
                  const activity = day.steps + day.toolCalls;
                  return (
                    <div key={day.date} className="trajectory-bar-column" title={`${day.date} · ${day.steps} steps · ${day.toolCalls} calls`}>
                      <div className="trajectory-bar-track">
                        <i className="calls" style={{ height: `${activity ? Math.max(4, (day.toolCalls / maxRecentActivity) * 100) : 0}%` }} />
                        <i className="steps" style={{ height: `${activity ? Math.max(4, (day.steps / maxRecentActivity) * 100) : 0}%` }} />
                      </div>
                      <span>{day.date.slice(8)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="trajectory-performance-section">
              <header><h3>{zh ? "执行质量" : "Execution quality"}</h3><span>{zh ? "全部轨迹" : "All trajectories"}</span></header>
              <dl className="trajectory-performance-list">
                <div><dt>{zh ? "解码速度" : "Decode rate"}</dt><dd>{decodeRate.toFixed(1)} tok/s</dd></div>
                <div><dt>{zh ? "工具失败率" : "Tool error rate"}</dt><dd className={errorRate > 0.05 ? "bad" : ""}>{(errorRate * 100).toFixed(1)}%</dd></div>
                <div><dt>{zh ? "模型耗时" : "Model time"}</dt><dd>{formatDuration(totals.llmMs, zh)}</dd></div>
                <div><dt>{zh ? "工具耗时" : "Tool time"}</dt><dd>{formatDuration(totals.toolMs, zh)}</dd></div>
              </dl>
              {latestContextSession ? (
                <div className="trajectory-context-block">
                  <div className="trajectory-context-head">
                    <span>{zh ? "最新上下文压力" : "Latest context pressure"}</span>
                    <b>{latestContext.percent.toFixed(1)}%</b>
                  </div>
                  <div className="trajectory-pressure-track"><i style={{ width: `${latestContext.percent}%` }} /></div>
                  <small>{formatCompact(latestContext.value, numberLocale)} / {formatCompact(latestContextSession.contextWindow ?? 0, numberLocale)}</small>
                  <ContextComposition session={latestContextSession} zh={zh} locale={numberLocale} />
                </div>
              ) : null}
            </section>
          </div>

          <section className="trajectory-tools-section">
            <header><h3>{zh ? "工具性能" : "Tool performance"}</h3><span>{snapshot.tools.length} tools</span></header>
            <div className="trajectory-tool-list">
              {snapshot.tools.slice(0, 8).map(tool => (
                <div className="trajectory-tool-row" key={tool.name}>
                  <code>{tool.name}</code>
                  <span>{tool.calls.toLocaleString(numberLocale)} {zh ? "次" : "calls"}</span>
                  <span>{zh ? "平均" : "avg"} {formatDuration(tool.calls ? tool.durationMs / tool.calls : 0, zh)}</span>
                  <b className={tool.errors ? "bad" : ""}>{tool.errors ? <AlertCircle size={12} /> : null}{tool.errors}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="trajectory-sessions-section">
            <header><h3>{zh ? "最近轨迹" : "Recent trajectories"}</h3><span>{snapshot.sessions.length}</span></header>
            <div className="trajectory-session-table">
              <div className="trajectory-session-header" aria-hidden="true">
                <span>{zh ? "会话" : "Session"}</span><span>{zh ? "路由" : "Route"}</span><span>{zh ? "工作量" : "Workload"}</span><span>{zh ? "性能" : "Performance"}</span><span>{zh ? "上下文" : "Context"}</span><span>{zh ? "最近" : "Latest"}</span>
              </div>
              {visibleSessions.map((session, index) => {
                const context = sessionContext(session);
                return (
                  <div className="trajectory-session-row" key={session.sessionId}>
                    <div className="trajectory-session-title">
                      <strong title={hideSensitiveContent ? undefined : session.title}>{hideSensitiveContent ? `${zh ? "轨迹" : "Trajectory"} ${index + 1}` : session.title}</strong>
                      <small title={hideSensitiveContent ? undefined : session.projectPath}>{hideSensitiveContent ? (zh ? "详情已隐藏" : "Details hidden") : session.projectName}</small>
                    </div>
                    <div className="trajectory-session-route"><strong>{session.model}</strong><small>{session.provider}</small></div>
                    <div className="trajectory-session-numbers"><strong>{session.steps} steps · {session.toolCalls} calls</strong><small>{session.turns} turns · {formatCompact(session.inputTokens + session.outputTokens + session.cacheReadTokens + session.cacheWriteTokens, numberLocale)} tok</small></div>
                    <div className="trajectory-session-numbers"><strong>LLM {formatDuration(session.llmMs, zh)}</strong><small>Tools {formatDuration(session.toolMs, zh)} · TTFT {formatDuration(session.ttftSteps ? session.ttftMs / session.ttftSteps : 0, zh)}</small></div>
                    <div className="trajectory-session-context"><strong>{session.contextWindow ? `${context.percent.toFixed(1)}%` : "n/a"}</strong><span><i style={{ width: `${context.percent}%` }} /></span></div>
                    <time>{formatWhen(session.lastActivity, zh)}</time>
                  </div>
                );
              })}
            </div>
            {snapshot.sessions.length > COLLAPSED_SESSIONS ? (
              <button type="button" className="trajectory-expand" onClick={() => setExpanded(value => !value)}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? (zh ? "收起" : "Collapse") : `${zh ? "查看全部" : "Show all"} ${snapshot.sessions.length}`}
              </button>
            ) : null}
          </section>
        </>
      ) : !loading && !error ? <p className="note trajectory-empty">{zh ? "暂无本地轨迹" : "No local trajectories"}</p> : null}
    </div>
  );
}

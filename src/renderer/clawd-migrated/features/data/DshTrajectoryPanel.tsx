// @ts-nocheck
import React, { useMemo, useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import type { DshAnalyticsSnapshot, DshToolMetric } from "../../../../shared/dshAnalytics";
import { useI18n } from "../../useI18n";

type StatsRange = "today" | "7d" | "all";

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
  return zh ? `${minutes}分 ${seconds % 60}秒` : `${minutes}m ${seconds % 60}s`;
}

function mergeTools(snapshot: DshAnalyticsSnapshot, keys: string[]): DshToolMetric[] {
  const tools = new Map<string, DshToolMetric>();
  for (const key of keys) {
    const daily = snapshot.dailyTools?.[key] ?? Object.entries(snapshot.dailyToolUsage?.[key] ?? {}).map(([name, calls]) => ({ name, calls, errors: 0, durationMs: 0 }));
    for (const tool of daily) {
      const current = tools.get(tool.name) ?? { name: tool.name, calls: 0, errors: 0, durationMs: 0 };
      current.calls += tool.calls;
      current.errors += tool.errors;
      current.durationMs += tool.durationMs;
      tools.set(tool.name, current);
    }
  }
  return [...tools.values()].sort((left, right) => right.calls - left.calls || right.durationMs - left.durationMs || left.name.localeCompare(right.name));
}

export function DshToolStatsPanel({ snapshot, loading = false, error = null }: { snapshot: DshAnalyticsSnapshot | null; loading?: boolean; error?: string | null }) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const numberLocale = zh ? "zh-CN" : "en-US";
  const [range, setRange] = useState<StatsRange>("7d");
  const [rankingOpen, setRankingOpen] = useState(false);
  const rangeOptions: Array<{ value: StatsRange; label: string }> = [
    { value: "today", label: t("stats.rangeToday", "今日") },
    { value: "7d", label: t("stats.range7d", "近 7 日") },
    { value: "all", label: t("stats.rangeAll", "全部") }
  ];
  const rangeData = useMemo(() => {
    if (!snapshot) return null;
    const label = range === "today" ? t("stats.rangeToday", "今日") : range === "7d" ? t("stats.range7d", "近 7 日") : t("stats.rangeAll", "全部");
    const tools = range === "all" ? snapshot.tools : mergeTools(snapshot, range === "today" ? [localDateKey()] : recentDateKeys(7));
    const totals = tools.reduce((total, tool) => ({ calls: total.calls + tool.calls, errors: total.errors + tool.errors, durationMs: total.durationMs + tool.durationMs }), { calls: 0, errors: 0, durationMs: 0 });
    return { label, tools, totals };
  }, [range, snapshot, t]);

  if (!snapshot && loading) return <p className="note">{zh ? "正在扫描工具数据…" : "Scanning tool data…"}</p>;
  if (!snapshot || !rangeData) return <p className="note">{error ? `${zh ? "扫描失败" : "Scan failed"}: ${error}` : (zh ? "暂无工具数据" : "No tool data")}</p>;

  const { totals } = rangeData;
  const successRate = totals.calls ? (totals.calls - totals.errors) / totals.calls : 0;
  const toolRows = [
    { label: zh ? "工具调用" : "Tool calls", value: totals.calls.toLocaleString(numberLocale) },
    { label: zh ? "失败调用" : "Failed calls", value: totals.errors.toLocaleString(numberLocale), bad: totals.errors > 0 },
    { label: zh ? "成功率" : "Success rate", value: totals.calls ? `${(successRate * 100).toFixed(1)}%` : "—" },
    { label: zh ? "工具耗时" : "Tool time", value: formatDuration(totals.durationMs, zh) },
    { label: zh ? "平均耗时" : "Average time", value: totals.calls ? formatDuration(totals.durationMs / totals.calls, zh) : "—" }
  ];

  return (
    <div className="dsh-tool-stats-panel">
      <section className="stats-activity-board">
        <div className="stats-range-block">
          <header className="stats-range-bar">
            <h3>{t("stats.rangeMetricsTitle", "统计范围")}</h3>
            <div className="stats-range-switch" role="tablist" aria-label={t("stats.timeRange", "时间范围")}>
              {rangeOptions.map(option => <button key={option.value} type="button" className={range === option.value ? "active" : ""} onClick={() => setRange(option.value)} role="tab" aria-selected={range === option.value}>{option.label}</button>)}
            </div>
          </header>
          <div className="stats-range-metrics">
            {toolRows.map(row => <article key={row.label} className="stats-range-metric"><span>{row.label}</span><strong className={row.bad ? "bad" : undefined}>{row.value}</strong></article>)}
          </div>
        </div>
      </section>

      <section className={`trajectory-tools-section stats-disclosure ${rankingOpen ? "open" : ""}`}>
        <button type="button" className="stats-disclosure-trigger" aria-expanded={rankingOpen} onClick={() => setRankingOpen(value => !value)}>
          <ChevronDown size={15} className="stats-disclosure-chevron" aria-hidden="true" />
          <span><strong>{zh ? "工具使用排行" : "Tool usage ranking"}</strong><small>{rangeData.label} · {rangeData.tools.length} {zh ? "个工具" : "tools"}</small></span>
        </button>
        {rankingOpen ? (
          rangeData.tools.length > 0 ? <div className="trajectory-tool-list">
            {rangeData.tools.map((tool, index) => (
              <div className="trajectory-tool-row" key={tool.name}>
                <span className="tool-rank-pos">{index + 1}</span>
                <code>{tool.name}</code>
                <span>{tool.calls.toLocaleString(numberLocale)} {zh ? "次" : "calls"}</span>
                <span>{zh ? "平均" : "avg"} {formatDuration(tool.calls ? tool.durationMs / tool.calls : 0, zh)}</span>
                <b className={tool.errors ? "bad" : ""}>{tool.errors ? <AlertCircle size={12} /> : null}{tool.errors}</b>
              </div>
            ))}
          </div> : <p className="note">{zh ? "当前范围暂无工具调用" : "No tool calls in this range"}</p>
        ) : null}
      </section>
    </div>
  );
}

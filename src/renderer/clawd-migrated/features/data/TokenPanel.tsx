// @ts-nocheck
import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { EMBEDDED_CURRENCY_RATES, formatUsdInCurrency, isDisplayCurrency, type DisplayCurrency } from "../../../../shared/currency";
import { useI18n } from "../../useI18n";

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function TokenDisclosure({ title, summary, defaultOpen = false, children }: { title: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`token-disclosure ${open ? "open" : ""}`}>
      <button className="token-disclosure-trigger" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <ChevronDown size={15} className="token-disclosure-chevron" />
        <span>
          <strong>{title}</strong>
          {summary ? <small>{summary}</small> : null}
        </span>
      </button>
      {open ? <div className="token-disclosure-body">{children}</div> : null}
    </section>
  );
}

type TokenOverviewMetric = {
  label: string;
  value: string;
  meta?: string;
};

function TokenOverviewBlock({
  primaryLabel,
  primaryValue,
  primaryMeta,
  periodMetrics,
  breakdownMetrics,
  loading = false
}: {
  primaryLabel: string;
  primaryValue: string;
  primaryMeta: string;
  periodMetrics: TokenOverviewMetric[];
  breakdownMetrics: TokenOverviewMetric[];
  loading?: boolean;
}) {
  // While the first scan runs we show a shimmer WHERE each number will be rather than a fabricated
  // "$0 / 0 tokens" — the static labels stay, so the layout is identical when the values resolve.
  const val = (value: string, size = "") => (loading ? <span className={`token-skeleton ${size}`} /> : value);
  return (
    <section className="token-overview-block">
      <div className="token-overview-main">
        <span>{primaryLabel}</span>
        <strong>{val(primaryValue, "wide")}</strong>
        <small>{val(primaryMeta)}</small>
      </div>

      <div className="token-overview-metrics">
        {periodMetrics.map(metric => (
          <div className="token-overview-metric" key={metric.label}>
            <span>{metric.label}</span>
            <b>{val(metric.value)}</b>
            {loading || metric.meta ? <small>{val(metric.meta ?? "", "narrow")}</small> : null}
          </div>
        ))}
      </div>

      <div className="token-overview-breakdown">
        {breakdownMetrics.map(metric => (
          <span key={metric.label}>
            <small>{metric.label}</small>
            <b>{val(metric.value, "narrow")}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

type TokenHeatmapDaily = {
  date: string;
  requestCount?: number;
  totalTokens?: number;
  costUsd?: number;
};

type TokenHeatmapCell = {
  date: string;
  week: number;
  day: number;
  future: boolean;
  requests: number;
  tokens: number;
  costUsd: number;
};

function dateKeyToLocalDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function shiftLocalDate(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function tokenHeatLevel(value: number, maxValue: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maxValue <= 0) return 0;
  const ratio = value / maxValue;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

function buildTokenHeatmap(dailyTotals: TokenHeatmapDaily[], zh: boolean) {
  const weekCount = 53;
  const today = dateKeyToLocalDate(localDateKey());
  const start = shiftLocalDate(today, -((weekCount - 1) * 7 + today.getDay()));
  const dailyMap = new Map<string, TokenHeatmapDaily>((dailyTotals ?? []).map(entry => [entry.date, entry]));
  const cells: TokenHeatmapCell[] = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = shiftLocalDate(start, index);
    const dateKey = localDateKey(date.getTime());
    const future = date.getTime() > today.getTime();
    const entry = dailyMap.get(dateKey);
    return {
      date: dateKey,
      week: Math.floor(index / 7),
      day: date.getDay(),
      future,
      requests: future ? 0 : entry?.requestCount ?? 0,
      tokens: future ? 0 : entry?.totalTokens ?? 0,
      costUsd: future ? 0 : entry?.costUsd ?? 0
    };
  });
  const maxRequests = Math.max(0, ...cells.map(cell => cell.requests));
  const activeCells = cells.filter(cell => !cell.future && cell.requests > 0);
  const monthLabels: Array<{ week: number; label: string }> = [];
  const seenMonths = new Set<string>();
  for (let week = 0; week < weekCount; week++) {
    const weekCells = cells.slice(week * 7, week * 7 + 7).filter(cell => !cell.future);
    const firstOfMonth = weekCells.find(cell => dateKeyToLocalDate(cell.date).getDate() === 1);
    if (!firstOfMonth) continue;
    const date = dateKeyToLocalDate(firstOfMonth.date);
    const monthId = `${date.getFullYear()}-${date.getMonth()}`;
    if (seenMonths.has(monthId)) continue;
    seenMonths.add(monthId);
    monthLabels.push({ week, label: zh ? `${date.getMonth() + 1}月` : date.toLocaleString("en-US", { month: "short" }) });
  }
  const bestDay = activeCells.reduce((best, cell) => {
    if (!best || cell.requests > best.requests || (cell.requests === best.requests && cell.tokens > best.tokens)) return cell;
    return best;
  }, null as null | (typeof cells)[number]);
  return {
    cells: cells.map(cell => ({ ...cell, level: tokenHeatLevel(cell.requests, maxRequests) })),
    monthLabels,
    activeDays: activeCells.length,
    totalRequests: activeCells.reduce((sum, cell) => sum + cell.requests, 0),
    bestDay
  };
}

const TOKEN_STATS_CACHE_KEY = "clawd-token-stats-cache-v1";

function readCachedTokenStats() {
  try {
    const raw = localStorage.getItem(TOKEN_STATS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: unknown };
    return parsed && typeof parsed.data === "object" && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCachedTokenStats(data: unknown) {
  try {
    localStorage.setItem(TOKEN_STATS_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // Best-effort cache only. Token scans still work without localStorage.
  }
}

export function TokenPanel({ hideSensitiveContent = false, displayCurrency = "CNY" }: { hideSensitiveContent?: boolean; displayCurrency?: DisplayCurrency }) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const [stats, setStats] = useState<any | null>(() => readCachedTokenStats());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const load = async (force = false) => {
    setError(null);
    setLoading(true);
    if (force) setRefreshing(true);
    try {
      const result = await window.companion.getTokenStats(force);
      setStats(result);
      writeCachedTokenStats(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(false); }, []);

  const currency = isDisplayCurrency(displayCurrency) ? displayCurrency : "CNY";
  const exchangeRates = stats?.exchangeRates?.rates ?? EMBEDDED_CURRENCY_RATES;
  const fmtTok = (n: number) => n >= 1_000_000_000 ? (n / 1_000_000_000).toFixed(2) + "B" : n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1_000 ? (n / 1_000).toFixed(1) + "K" : String(Math.round(n || 0));
  const fmtCost = (n: number) => formatUsdInCurrency(n, currency, exchangeRates, zh ? "zh-CN" : "en-US");
  const fmtPct = (n: number) => `${Math.round((n || 0) * 100)}%`;
  const fmtCount = (n: number) => Math.round(n || 0).toLocaleString(zh ? "zh-CN" : "en-US");

  if (error && !stats) return <div className="note" style={{ color: "var(--coral)" }}>{t("stats.scanFailed", "加载失败")}: {error}</div>;
  if (!stats) {
    return (
      <div key="token-loading" className="token-panel token-panel-rich token-panel-loading">
        <div className="token-header">
          <div>
            <p className="note">{t("stats.scanning", "扫描中…")} {t("stats.scanningDshUsage", "Reading DeepSeek Harness usage from DSH Desk")}</p>
          </div>
        </div>
        <TokenOverviewBlock
          loading
          primaryLabel={t("stats.totalSpend", "Total spend")}
          primaryValue=""
          primaryMeta=""
          periodMetrics={[
            { label: t("stats.tokenToday", "Today"), value: "", meta: "" },
            { label: t("stats.token30d", "30 days"), value: "", meta: "" },
            { label: t("stats.cacheHit", "Cache hit"), value: "" }
          ]}
          breakdownMetrics={[
            { label: t("stats.inputTokens", "input"), value: "" },
            { label: t("stats.outputTokens", "output"), value: "" },
            { label: t("stats.cacheRead", "cache read"), value: "" },
            { label: t("stats.cacheWrite", "cache write"), value: "" }
          ]}
        />
        <p className="note">{t("stats.cacheSnapshotHint", "After the first scan, a snapshot is kept so this page can show the last result immediately.")}</p>
      </div>
    );
  }

  const todayStr = localDateKey();
  const todayEntry = stats.dailyTotals?.find((d: any) => d.date === todayStr);
  const todayTokens = todayEntry?.totalTokens ?? 0;
  const todayCost = todayEntry?.costUsd ?? 0;
  const thirtyDaysAgo = localDateKey(shiftLocalDate(dateKeyToLocalDate(todayStr), -29).getTime());
  const last30Entries = (stats.dailyTotals ?? []).filter((d: any) => d.date >= thirtyDaysAgo).sort((a: any, b: any) => b.date.localeCompare(a.date));
  const last30 = last30Entries.reduce((s: number, d: any) => s + (d.totalTokens ?? 0), 0);
  const last30Cost = last30Entries.reduce((s: number, d: any) => s + (d.costUsd ?? 0), 0);
  const inputTokens = (stats.dailyTotals ?? []).reduce((s: number, d: any) => s + (d.inputTokens ?? 0), 0);
  const outputTokens = (stats.dailyTotals ?? []).reduce((s: number, d: any) => s + (d.outputTokens ?? 0), 0);
  const cacheReadTokens = (stats.dailyTotals ?? []).reduce((s: number, d: any) => s + (d.cacheReadTokens ?? 0), 0);
  const cacheCreationTokens = (stats.dailyTotals ?? []).reduce((s: number, d: any) => s + (d.cacheCreationTokens ?? 0), 0);
  const maxDailyTokens = Math.max(1, ...last30Entries.map((d: any) => d.totalTokens ?? 0));
  const modelRows = showAllModels ? stats.modelTotals ?? [] : (stats.modelTotals ?? []).slice(0, 8);
  const projectRows = showAllProjects ? stats.projectTotals ?? [] : (stats.projectTotals ?? []).slice(0, 8);
  const highRequestRows = (stats.recentRequests ?? []).slice(0, 10);
  // The heatmap uses the durable long-term history (survives log rotation); everything
  // else stays on the live dailyTotals so the totals/breakdowns remain consistent.
  const heatmap = buildTokenHeatmap(stats.heatmapDailyTotals ?? stats.dailyTotals ?? [], zh);
  const trendSummary = last30Entries.length > 0
    ? `${last30Entries.length} ${zh ? "天" : "days"} · ${fmtTok(last30)}`
    : t("stats.noData", "无数据");
  const projectSummary = (stats.projectTotals ?? []).length > 0
    ? `${stats.projectTotals.length} ${zh ? "个项目" : "projects"} · ${fmtTok((stats.projectTotals ?? []).reduce((sum: number, project: any) => sum + (project.totalTokens ?? 0), 0))}`
    : t("stats.noData", "无数据");
  const highRequestSummary = highRequestRows.length > 0
    ? `${highRequestRows.length} ${zh ? "条请求" : "requests"} · ${fmtTok(highRequestRows.reduce((sum: number, request: any) => sum + (request.totalTokens ?? 0), 0))} · ${fmtCost(highRequestRows.reduce((sum: number, request: any) => sum + (request.costUsd ?? 0), 0))}`
    : t("stats.noData", "无数据");
  const scannedAt = Number.isFinite(Number(stats.lastScannedAt)) ? Number(stats.lastScannedAt) : Date.now();
  const scanSummary = Object.entries({ sessions: stats.totalSessions ?? 0, requests: stats.totalRequests ?? 0, time: new Date(scannedAt).toLocaleString(zh ? "zh-CN" : "en-US") }).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), t("stats.scanSummary", "Scanned {sessions} sessions · {requests} requests · {time}"));
  const scanNote = `${loading ? `${t("stats.scanning", "扫描中…")} · ` : ""}${scanSummary}${error ? ` · ${t("stats.scanFailed", "加载失败")}: ${error}` : ""}`;
  const pricing = stats.pricing ?? { source: "embedded", sources: ["embedded"], updatedAt: 0, stale: true };
  const pricingSourceNames: Record<string, string> = {
    "deepseek-official": t("stats.pricingOfficial", "DeepSeek 官方"),
    litellm: "LiteLLM",
    "models.dev": "models.dev",
    embedded: t("stats.pricingEmbedded", "内置兜底")
  };
  const pricingUpdated = pricing.updatedAt > 0
    ? new Date(pricing.updatedAt).toLocaleString(zh ? "zh-CN" : "en-US")
    : t("stats.pricingBundled", "随应用提供");
  const exchange = stats.exchangeRates;
  const exchangeUpdated = exchange?.updatedAt > 0 ? new Date(exchange.updatedAt).toLocaleString(zh ? "zh-CN" : "en-US") : t("stats.pricingBundled", "随应用提供");
  const exchangeNote = currency === "USD" ? "" : ` · ${zh ? "汇率" : "FX"} ${exchange?.source === "exchange-api" ? "Exchange API" : (zh ? "内置兜底" : "bundled fallback")} · ${exchangeUpdated}${exchange?.stale ? ` · ${t("stats.pricingStale", "使用最后可用价格")}` : ""}`;
  const pricingNote = `${t("stats.pricing", "价格")} · ${pricingSourceNames[pricing.source] ?? pricing.source} · ${pricingUpdated}${pricing.stale ? ` · ${t("stats.pricingStale", "使用最后可用价格")}` : ""} · ${currency}${exchangeNote}`;

  return (
    <div key="token-loaded" className="token-panel token-panel-rich">
      <div className="token-header">
        <div>
          <p className="note">{scanNote}</p>
          <p className={`note token-pricing-note${pricing.stale ? " stale" : ""}`} title={(pricing.sources ?? []).map((source: string) => pricingSourceNames[source] ?? source).join(" + ")}>{pricingNote}</p>
        </div>
        <button className="ghost-btn" onClick={() => load(true)} disabled={loading || refreshing}>{loading || refreshing ? t("stats.scanning", "扫描中…") : t("common.refresh", "刷新")}</button>
      </div>

      <TokenOverviewBlock
        primaryLabel={t("stats.totalSpend", "Total spend")}
        primaryValue={fmtCost(stats.totalCostUsd ?? 0)}
        primaryMeta={`${fmtTok(stats.totalTokens ?? 0)} ${t("stats.tokens", "Tokens")} · ${fmtCount(stats.totalRequests ?? 0)} ${t("stats.requests", "Requests")}`}
        periodMetrics={[
          { label: t("stats.tokenToday", "Today"), value: fmtTok(todayTokens), meta: fmtCost(todayCost) },
          { label: t("stats.token30d", "30 days"), value: fmtTok(last30), meta: fmtCost(last30Cost) },
          { label: t("stats.cacheHit", "Cache hit"), value: fmtPct(stats.cacheHitRatio ?? 0) }
        ]}
        breakdownMetrics={[
          { label: t("stats.inputTokens", "input"), value: fmtTok(inputTokens) },
          { label: t("stats.outputTokens", "output"), value: fmtTok(outputTokens) },
          { label: t("stats.cacheRead", "cache read"), value: fmtTok(cacheReadTokens) },
          { label: t("stats.cacheWrite", "cache write"), value: fmtTok(cacheCreationTokens) }
        ]}
      />

      <section className="token-heatmap-panel">
        <div className="token-heatmap-head">
          <div>
            <h3 className="panel-subtitle">{t("stats.requestHeatmap", "Request heatmap")}</h3>
            <p className="note">{t("stats.requestHeatmapSubtitle", "Last 12 months · request heatmap")}</p>
          </div>
          <div className="token-heatmap-summary">
            <span><small>{t("stats.activeDaysShort", "active days")}</small><b>{fmtCount(heatmap.activeDays)}</b></span>
            <span><small>{t("stats.requests", "requests")}</small><b>{fmtCount(heatmap.totalRequests)}</b></span>
            <span><small>{t("stats.peak", "peak")}</small><b>{heatmap.bestDay ? heatmap.bestDay.date.slice(5) : "—"}</b></span>
          </div>
        </div>
        <div className="token-heatmap-scroll" aria-label={t("stats.requestHeatmapAria", "Request heatmap for the last 12 months")}>
          <div className="token-heatmap">
            <div className="token-heatmap-months">
              {heatmap.monthLabels.map(label => <span key={`${label.week}-${label.label}`} style={{ gridColumn: `${label.week + 1}` }}>{label.label}</span>)}
            </div>
            <div className="token-heatmap-body">
              <div className="token-heatmap-weekdays" aria-hidden="true">
                <span style={{ gridRow: "2" }}>{zh ? "一" : "Mon"}</span>
                <span style={{ gridRow: "4" }}>{zh ? "三" : "Wed"}</span>
                <span style={{ gridRow: "6" }}>{zh ? "五" : "Fri"}</span>
              </div>
              <div className="token-heatmap-cells">
                {heatmap.cells.map(cell => (
                  <span
                    key={cell.date}
                    className={`token-heat-cell level-${cell.level}${cell.future ? " future" : ""}`}
                    style={{ gridColumn: `${cell.week + 1}`, gridRow: `${cell.day + 1}` }}
                    title={cell.future ? undefined : `${cell.date}: ${cell.requests} ${zh ? "次请求" : "requests"} · ${fmtTok(cell.tokens)} · ${fmtCost(cell.costUsd)}`}
                    aria-label={cell.future ? undefined : `${cell.date}: ${cell.requests} ${zh ? "次请求" : "requests"}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="token-heatmap-legend">
          <span>{zh ? "少" : "Less"}</span>
          {[0, 1, 2, 3, 4].map(level => <i key={level} className={`token-heat-cell level-${level}`} />)}
          <span>{zh ? "多" : "More"}</span>
        </div>
      </section>

      <TokenDisclosure title={t("stats.last30Trend", "Last 30 days")} summary={trendSummary}>
        {last30Entries.length === 0 ? <p className="note">{t("stats.noData", "无数据")}</p> : (
          <div className="token-daily-bars">
            {last30Entries.slice(0, 30).map((d: any) => (
              <div key={d.date} className="token-daily-bar-row" title={`${d.date}: ${fmtTok(d.totalTokens)} · ${fmtCost(d.costUsd ?? 0)}`}>
                <time>{d.date.slice(5)}</time>
                <div><span style={{ width: `${Math.max(3, ((d.totalTokens ?? 0) / maxDailyTokens) * 100)}%` }} /></div>
                <b>{fmtTok(d.totalTokens ?? 0)}</b>
                <em>{fmtCost(d.costUsd ?? 0)}</em>
              </div>
            ))}
          </div>
        )}
      </TokenDisclosure>

      <section className="token-flat-section">
        <header className="token-section-head">
          <h3 className="panel-subtitle">{t("stats.byModel", "按模型拆分")}</h3>
          <span>{fmtCount((stats.modelTotals ?? []).length)}</span>
        </header>
        {(stats.modelTotals ?? []).length === 0 ? <p className="note">{t("stats.noData", "无数据")}</p> : (
          <div className="token-table token-table-wide">
            <div className="token-table-header"><span>{t("stats.model", "模型")}</span><span>{t("stats.tokens", "Tokens")}</span><span>{t("stats.cost", "Cost")}</span><span>{t("stats.req", "Req")}</span><span>Cache</span></div>
            {modelRows.map((m: any) => (
              <div key={m.model} className="token-table-row">
                <span className="token-model-name" title={m.model}>{m.model}</span>
                <span>{fmtTok(m.totalTokens)}</span>
                <span>{m.priced ? fmtCost(m.costUsd) : "—"}</span>
                <span>{m.requestCount}</span>
                <span>{fmtPct(m.cacheHitRatio)}</span>
              </div>
            ))}
            {(stats.modelTotals ?? []).length > 8 && <button className="ghost-btn token-more-btn" onClick={() => setShowAllModels(v => !v)}>{showAllModels ? t("stats.collapse", "收起") : `${t("stats.showMore", "查看更多")} (${stats.modelTotals.length - 8})`}</button>}
          </div>
        )}
      </section>

      <TokenDisclosure title={t("stats.projectRanking", "Projects")} summary={projectSummary}>
        {(stats.projectTotals ?? []).length === 0 ? <p className="note">{t("stats.noData", "无数据")}</p> : (
          <div className="token-project-list">
            {projectRows.map((p: any, index: number) => (
              <article key={p.projectPath} className="token-project-row">
                <div><strong title={hideSensitiveContent ? undefined : p.projectName}>{hideSensitiveContent ? `${t("stats.project", "项目")} ${index + 1}` : p.projectName}</strong><p title={hideSensitiveContent ? undefined : p.projectPath}>{hideSensitiveContent ? t("privacy.detailsHidden", "详情已隐藏") : p.projectPath}</p></div>
                <span>{fmtTok(p.totalTokens)}</span>
                <span>{fmtCost(p.costUsd)}</span>
                <time>{p.lastActivity ? new Date(p.lastActivity).toLocaleDateString(zh ? "zh-CN" : "en-US") : "—"}</time>
              </article>
            ))}
            {(stats.projectTotals ?? []).length > 8 && <button className="ghost-btn token-more-btn" onClick={() => setShowAllProjects(v => !v)}>{showAllProjects ? t("stats.collapse", "收起") : `${t("stats.showMore", "查看更多")} (${stats.projectTotals.length - 8})`}</button>}
          </div>
        )}
      </TokenDisclosure>

      <TokenDisclosure title={t("stats.largestRequests", "Largest requests")} summary={highRequestSummary}>
        {highRequestRows.length === 0 ? <p className="note">{t("stats.noData", "无数据")}</p> : (
          <div className="token-table token-table-requests">
            <div className="token-table-header"><span>{t("stats.timeProject", "Time / Project")}</span><span>{t("stats.model", "Model")}</span><span>{t("stats.tokens", "Tokens")}</span><span>{t("stats.cost", "Cost")}</span></div>
            {highRequestRows.map((r: any) => (
              <div key={r.id} className="token-table-row">
                <span><b>{new Date(r.timestamp).toLocaleString(zh ? "zh-CN" : "en-US")}</b><small title={hideSensitiveContent ? undefined : r.projectName}>{hideSensitiveContent ? t("privacy.detailsHidden", "详情已隐藏") : r.projectName}</small></span>
                <span className="token-model-name" title={r.model}>{r.model}</span>
                <span>{fmtTok(r.totalTokens)}</span>
                <span>{r.priced ? fmtCost(r.costUsd) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </TokenDisclosure>
    </div>
  );
}

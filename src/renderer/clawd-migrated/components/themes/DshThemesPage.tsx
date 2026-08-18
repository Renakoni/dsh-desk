import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  ImageOff,
  Palette,
  Power,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X
} from "lucide-react";
import type {
  DshSkinAction,
  DshSkinCatalogEntry,
  DshSkinMarketplaceSnapshot,
  DshSkinRuntimeState
} from "../../../../shared/dshSkins";
import { useI18n } from "../../useI18n";

type DshThemesPageProps = { active: boolean };
type SortMode = "stars" | "latest";
type FilterMode = "all" | "installed";

function runtimeFor(snapshot: DshSkinMarketplaceSnapshot, skinId: string): DshSkinRuntimeState | undefined {
  return snapshot.host.skins.find(item => item.skinId === skinId);
}

function previewUrl(skin: DshSkinCatalogEntry): string | undefined {
  return skin.listScreenshot ?? skin.screenshots[0];
}

function ThemePreview({ skin, className, eager = false }: { skin: DshSkinCatalogEntry; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const source = previewUrl(skin);
  if (!source || failed) {
    return <div className={`dsh-theme-preview-fallback ${className ?? ""}`} role="img" aria-label={`${skin.name.zh} 暂无预览`}><ImageOff size={24} /><span>{skin.author}</span></div>;
  }
  return <img className={className} src={source} alt={`${skin.name.zh} 界面预览`} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />;
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" }).format(date);
}

export function DshThemesPage({ active }: DshThemesPageProps) {
  const { t, locale } = useI18n();
  const [snapshot, setSnapshot] = useState<DshSkinMarketplaceSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("stars");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shotIndex, setShotIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(force = false) {
    setLoading(true);
    setNotice(null);
    try {
      const next = await window.companion.getDshSkinMarketplace(force);
      setSnapshot(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    void refresh(false);
  }, [active]);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLocaleLowerCase();
    return snapshot.skins
      .filter(skin => {
        const state = runtimeFor(snapshot, skin.id);
        if (filter === "installed" && state?.installation !== "installed") return false;
        if (!needle) return true;
        return `${skin.name.zh} ${skin.name.en} ${skin.author} ${skin.tags.join(" ")}`.toLocaleLowerCase().includes(needle);
      })
      .sort((left, right) => sort === "stars"
        ? right.stars - left.stars || left.name.zh.localeCompare(right.name.zh)
        : Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.name.zh.localeCompare(right.name.zh));
  }, [filter, query, snapshot, sort]);

  const selected = selectedId && snapshot ? snapshot.skins.find(skin => skin.id === selectedId) : undefined;
  const selectedRuntime = selected && snapshot ? runtimeFor(snapshot, selected.id) : undefined;

  async function installMarket() {
    setBusy("market");
    setNotice(null);
    try {
      const result = await window.companion.installDshSkinMarketplace();
      setSnapshot(result.snapshot);
      setNotice(result.ok
        ? t("dshThemes.marketInstalledRestart", "主题组件已安装，重启 DSH Web 后即可管理主题。")
        : result.error ?? t("dshThemes.operationFailed", "操作失败。"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function mutate(skin: DshSkinCatalogEntry, action: DshSkinAction) {
    if (skin.review?.installation === "manual-only" && action === "install") {
      await window.companion.openExternal(skin.repositoryUrl);
      return;
    }
    setBusy(`${skin.id}:${action}`);
    setNotice(null);
    try {
      const result = await window.companion.mutateDshSkin({ skinId: skin.id, action });
      setSnapshot(result.snapshot);
      if (!result.ok) setNotice(result.error ?? t("dshThemes.operationFailed", "操作失败。"));
      else if (result.restartRequested) setNotice(t("dshThemes.restarting", "DSH Web 正在重启。"));
      else if (result.browserRefreshRequired) setNotice(action === "activate" || action === "update"
        ? t("dshThemes.restartToApply", "主题状态已保存，重启 DSH Web 后生效。")
        : t("dshThemes.refreshToApply", "主题状态已保存，刷新 DSH Web 页面后完全生效。"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function openDetails(skin: DshSkinCatalogEntry) {
    setSelectedId(skin.id);
    setShotIndex(0);
  }

  const installedCount = snapshot?.host.skins.filter(item => item.installation === "installed").length ?? 0;
  return (
    <div className="settings-page dsh-themes-page">
      <header className="dsh-themes-header">
        <div>
          <span className="dsh-themes-eyebrow"><Palette size={15} />{t("dshThemes.eyebrow", "DSH Web")}</span>
          <h2>{t("dshThemes.title", "主题")}</h2>
          <p>{snapshot ? t("dshThemes.summary", "{count} 个主题 · {installed} 个已安装", { count: snapshot.skins.length, installed: installedCount }) : t("dshThemes.loading", "正在加载主题目录…")}</p>
        </div>
        <div className="dsh-themes-header-actions">
          <button type="button" className="dsh-theme-icon-button" onClick={() => void window.companion.openExternal("https://kingofsoysauce.github.io/dsh-skin-market/")} title={t("dshThemes.openMarket", "打开在线主题市场")} aria-label={t("dshThemes.openMarket", "打开在线主题市场")}><ExternalLink size={17} /></button>
          <button type="button" className="dsh-theme-icon-button" onClick={() => void refresh(true)} disabled={loading} title={t("dshThemes.refresh", "刷新")} aria-label={t("dshThemes.refresh", "刷新")}><RefreshCw size={17} className={loading ? "spinning" : undefined} /></button>
        </div>
      </header>

      {snapshot && !snapshot.host.marketInstalled ? (
        <div className="dsh-theme-state-band warning">
          <Palette size={18} />
          <div><strong>{t("dshThemes.marketMissing", "尚未安装主题组件")}</strong><span>{t("dshThemes.marketMissingDetail", "安装到 DSH Web 后即可直接切换主题。")}</span></div>
          <button type="button" className="dsh-theme-primary-button" onClick={() => void installMarket()} disabled={busy !== null}><Download size={15} />{busy === "market" ? t("dshThemes.installing", "安装中…") : t("dshThemes.installMarket", "安装组件")}</button>
        </div>
      ) : null}
      {snapshot?.host.marketInstalled && !snapshot.host.connected ? (
        <div className="dsh-theme-state-band offline"><Power size={18} /><div><strong>{t("dshThemes.webOffline", "DSH Web 未连接")}</strong><span>{t("dshThemes.webOfflineDetail", "目录仍可浏览；启动或重启 DSH Web 后可管理主题。")}</span></div></div>
      ) : null}
      {snapshot?.catalogError ? <div className="dsh-theme-state-band compact"><span>{snapshot.skins.length > 0
        ? t("dshThemes.cachedCatalog", "正在显示上次成功加载的主题目录。")
        : t("dshThemes.catalogUnavailable", "主题目录暂时无法加载。")}</span></div> : null}
      {notice ? <div className="dsh-theme-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label={t("dshThemes.dismiss", "关闭")}><X size={14} /></button></div> : null}

      <section className="dsh-themes-toolbar" aria-label={t("dshThemes.filters", "主题筛选") }>
        <label className="dsh-theme-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("dshThemes.search", "搜索主题或作者")} /></label>
        <div className="dsh-theme-segmented">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{t("dshThemes.all", "全部")}</button>
          <button type="button" className={filter === "installed" ? "active" : ""} onClick={() => setFilter("installed")}>{t("dshThemes.installed", "已安装")}</button>
        </div>
        <div className="dsh-theme-sort" aria-label={t("dshThemes.sort", "排序") }>
          <button type="button" className={sort === "stars" ? "active" : ""} onClick={() => setSort("stars")} title={t("dshThemes.sortStars", "按 Stars 排序")}><Star size={15} />{t("dshThemes.stars", "Stars")}</button>
          <button type="button" className={sort === "latest" ? "active" : ""} onClick={() => setSort("latest")} title={t("dshThemes.sortLatest", "按更新时间排序")}><Clock3 size={15} />{t("dshThemes.latest", "最近更新")}</button>
        </div>
      </section>

      <section className="dsh-theme-grid" aria-live="polite">
        {loading && !snapshot ? <div className="dsh-theme-empty">{t("dshThemes.loading", "正在加载主题目录…")}</div> : null}
        {!loading && snapshot && rows.length === 0 ? <div className="dsh-theme-empty">{t("dshThemes.noMatches", "没有匹配的主题")}</div> : null}
        {snapshot ? rows.map(skin => {
          const state = runtimeFor(snapshot, skin.id);
          const isBusy = busy?.startsWith(`${skin.id}:`) === true;
          const activeTheme = state?.activation === "active";
          const installed = state?.installation === "installed";
          const cardAction: DshSkinAction | null = state?.activation === "restart-required"
            ? snapshot.host.restartAvailable ? "restart" : null
            : installed ? state?.updateAvailable ? "update" : "activate" : "install";
          const status = activeTheme
            ? t("dshThemes.inUse", "使用中")
            : state?.activation === "restart-required"
              ? t("dshThemes.restartRequired", "需要重启")
              : state?.updateAvailable
                ? t("dshThemes.updateAvailable", "可更新")
                : installed
                  ? t("dshThemes.installed", "已安装")
                  : skin.review?.installation === "manual-only"
                    ? t("dshThemes.manual", "手动安装")
                    : "";
          return (
            <article key={skin.id} className={`dsh-theme-card ${activeTheme ? "active" : ""}`} data-testid="dsh-theme-card">
              <button type="button" className="dsh-theme-card-preview" onClick={() => openDetails(skin)} aria-label={t("dshThemes.openDetails", "查看 {name}", { name: locale === "zh" ? skin.name.zh : skin.name.en })}>
                <ThemePreview skin={skin} />
                {status ? <span className={`dsh-theme-status ${activeTheme ? "active" : state?.updateAvailable ? "update" : ""}`}>{activeTheme ? <Check size={12} /> : null}{status}</span> : null}
              </button>
              <div className="dsh-theme-card-copy">
                <div><strong title={locale === "zh" ? skin.name.zh : skin.name.en}>{locale === "zh" ? skin.name.zh : skin.name.en}</strong><span title={skin.author}>{skin.author}</span></div>
                <span className="dsh-theme-stars"><Star size={12} fill="currentColor" />{skin.stars.toLocaleString()}</span>
              </div>
              <div className="dsh-theme-card-actions">
                <button type="button" onClick={() => openDetails(skin)}>{t("dshThemes.details", "详情")}</button>
                {snapshot.host.connected && !activeTheme && cardAction ? (
                  <button type="button" className="primary" disabled={isBusy} onClick={() => void mutate(skin, cardAction)}>
                    {isBusy ? t("dshThemes.working", "处理中…") : cardAction === "restart" ? t("dshThemes.restartWeb", "重启 DSH Web") : installed ? state?.updateAvailable ? t("dshThemes.update", "更新") : t("dshThemes.use", "使用") : skin.review?.installation === "manual-only" ? t("dshThemes.repository", "查看仓库") : t("dshThemes.install", "安装")}
                  </button>
                ) : null}
              </div>
            </article>
          );
        }) : null}
      </section>

      {selected && snapshot ? (
        <div className="dsh-theme-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null); }}>
          <section className="dsh-theme-dialog" role="dialog" aria-modal="true" aria-label={locale === "zh" ? selected.name.zh : selected.name.en}>
            <button type="button" className="dsh-theme-dialog-close" onClick={() => setSelectedId(null)} aria-label={t("dshThemes.closeDetails", "关闭详情")}><X size={18} /></button>
            <div className="dsh-theme-dialog-media">
              {selected.screenshots.length > 0 ? <ThemePreview key={`${selected.id}:${shotIndex}`} skin={{ ...selected, listScreenshot: selected.screenshots[shotIndex] }} eager /> : <ThemePreview skin={selected} eager />}
              {selected.screenshots.length > 1 ? <>
                <button type="button" className="previous" onClick={() => setShotIndex(index => (index - 1 + selected.screenshots.length) % selected.screenshots.length)} aria-label={t("dshThemes.previousImage", "上一张预览")}><ChevronLeft size={20} /></button>
                <button type="button" className="next" onClick={() => setShotIndex(index => (index + 1) % selected.screenshots.length)} aria-label={t("dshThemes.nextImage", "下一张预览")}><ChevronRight size={20} /></button>
                <span className="dsh-theme-image-count">{shotIndex + 1} / {selected.screenshots.length}</span>
              </> : null}
            </div>
            <div className="dsh-theme-dialog-copy">
              <div className="dsh-theme-dialog-title"><div><span>{selected.author}</span><h3>{locale === "zh" ? selected.name.zh : selected.name.en}</h3></div><span className="dsh-theme-stars"><Star size={13} fill="currentColor" />{selected.stars.toLocaleString()}</span></div>
              <p>{selected.description}</p>
              <div className="dsh-theme-tags">{selected.tags.slice(0, 8).map(tag => <span key={tag}>{tag}</span>)}</div>
              <dl className="dsh-theme-metadata">
                <div><dt>{t("dshThemes.version", "版本")}</dt><dd>{selected.install.version}</dd></div>
                <div><dt>{t("dshThemes.updated", "更新")}</dt><dd>{formatDate(selected.updatedAt, locale)}</dd></div>
                <div><dt>{t("dshThemes.mode", "模式")}</dt><dd>{selected.modes.join(" / ")}</dd></div>
                <div><dt>{t("dshThemes.compatibility", "DSH")}</dt><dd>{selected.compatibility.dsh}</dd></div>
              </dl>
              {selectedRuntime?.error ? <p className="dsh-theme-error">{selectedRuntime.error}</p> : null}
              {selected.review?.installation === "manual-only" ? <p className="dsh-theme-manual-note">{t("dshThemes.manualDetail", "该主题暂不支持一键安装，请按仓库说明操作。")}</p> : null}
              {selectedRuntime?.activation === "restart-required" && !snapshot.host.restartAvailable ? <p className="dsh-theme-manual-note">{t("dshThemes.manualRestart", "请手动重启 DSH Web 以应用这个主题。")}</p> : null}
              <div className="dsh-theme-dialog-actions">
                <button type="button" className="dsh-theme-icon-button" onClick={() => void window.companion.openExternal(selected.repositoryUrl)} title={t("dshThemes.openRepository", "打开仓库")} aria-label={t("dshThemes.openRepository", "打开仓库")}><ExternalLink size={17} /></button>
                {snapshot.host.connected ? <>
                  {selectedRuntime?.installation === "installed" ? (
                    <button type="button" className="danger-quiet" disabled={busy !== null} onClick={() => void mutate(selected, "uninstall")}><Trash2 size={15} />{t("dshThemes.uninstall", "卸载")}</button>
                  ) : null}
                  {selectedRuntime?.activation === "active" ? (
                    <button type="button" disabled={busy !== null} onClick={() => void mutate(selected, "deactivate")}><Power size={15} />{t("dshThemes.deactivate", "停用")}</button>
                  ) : null}
                  {selectedRuntime?.activation === "restart-required" ? snapshot.host.restartAvailable ? (
                    <button type="button" className="primary" disabled={busy !== null} onClick={() => void mutate(selected, "restart")}><RefreshCw size={15} />{t("dshThemes.restartWeb", "重启 DSH Web")}</button>
                  ) : null : selectedRuntime?.installation === "installed" && selectedRuntime.activation !== "active" ? (
                    <button type="button" className="primary" disabled={busy !== null} onClick={() => void mutate(selected, selectedRuntime.updateAvailable ? "update" : "activate")}>
                      {selectedRuntime.updateAvailable ? t("dshThemes.update", "更新") : t("dshThemes.use", "使用")}
                    </button>
                  ) : selectedRuntime?.installation !== "installed" ? (
                    <button type="button" className="primary" disabled={busy !== null} onClick={() => void mutate(selected, "install")}><Download size={15} />{selected.review?.installation === "manual-only" ? t("dshThemes.repository", "查看仓库") : t("dshThemes.install", "安装")}</button>
                  ) : null}
                </> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock3, Download, ExternalLink, ImageOff, Power, RefreshCw, Search, Star, Trash2, X } from "lucide-react";
import type { DshSkinAction, DshSkinCatalogEntry, DshSkinMarketplaceSnapshot, DshSkinOperationProgress, DshSkinRuntimeState } from "../../../../shared/dshSkins";
import { useI18n } from "../../useI18n";

type SortMode = "stars" | "latest";
const PAGE_SIZE = 30;

export function runtimeFor(snapshot: DshSkinMarketplaceSnapshot, skinId: string): DshSkinRuntimeState | undefined {
  return snapshot.host.skins.find(item => item.skinId === skinId);
}

function remotePreviewUrl(skin: DshSkinCatalogEntry): string | undefined {
  return skin.listScreenshot ?? skin.screenshots[0];
}

export function ThemePreview({ skin, eager = false }: { skin: DshSkinCatalogEntry; eager?: boolean }) {
  const remoteSource = remotePreviewUrl(skin);
  const localSource = skin.previewLocalUrl;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => setFailedSource(null), [skin.id, localSource, remoteSource]);
  const source = localSource && failedSource !== localSource ? localSource : remoteSource;
  if (!source || failedSource === source) return <div className="dsh-theme-preview-fallback" role="img" aria-label={`${skin.name.zh} 暂无预览`}><ImageOff size={24} /><span>{skin.author}</span></div>;
  return <img src={source} alt={`${skin.name.zh} 界面预览`} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailedSource(source)} />;
}

function shortCommit(value: string) {
  return value.length > 12 ? value.slice(0, 12) : value;
}

export function DshThemeOperationProgress({ progress, t }: {
  progress: DshSkinOperationProgress;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const label = progress.phase === "queued"
    ? t("dshThemes.progressPreparing", "准备操作…")
    : progress.phase === "downloading"
      ? t("dshThemes.progressDownloading", "下载主题…")
      : progress.phase === "installing"
        ? t("dshThemes.progressInstalling", "安装主题…")
        : progress.phase === "registering"
          ? t("dshThemes.progressRegistering", "注册主题入口…")
          : progress.phase === "activating"
            ? t("dshThemes.progressActivating", "启用主题…")
            : progress.phase === "deactivating"
              ? t("dshThemes.progressDeactivating", "停用主题…")
              : progress.phase === "uninstalling"
                ? t("dshThemes.progressUninstalling", "卸载主题…")
                : progress.message ?? t("dshThemes.working", "处理中…");
  const determinate = typeof progress.progress === "number" && Number.isFinite(progress.progress);
  const percent = determinate ? Math.round(progress.progress!) : null;
  return <div className="dsh-theme-operation-progress" role="status" aria-live="polite">
    <div className="dsh-theme-operation-progress-label"><span>{label}</span><strong>{percent === null ? t("dshThemes.progressIndeterminate", "处理中…") : `${percent}%`}</strong></div>
    <div className={`dsh-theme-operation-progress-track ${determinate ? "determinate" : "indeterminate"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} {...(percent === null ? { "aria-valuetext": t("dshThemes.progressIndeterminate", "处理中…") } : { "aria-valuenow": percent })}>
      <span style={determinate ? { width: `${percent}%` } : undefined} />
    </div>
  </div>;
}

export function DshThemeMarketPanel({ initialSnapshot, onBack, onChanged }: {
  initialSnapshot: DshSkinMarketplaceSnapshot | null;
  onBack: () => void;
  onChanged: (snapshot: DshSkinMarketplaceSnapshot) => void;
}) {
  const { locale, t } = useI18n();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("stars");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shotIndex, setShotIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [operationProgress, setOperationProgress] = useState<DshSkinOperationProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);

  async function refresh(force = false) {
    setLoading(true);
    setNotice(null);
    try {
      const next = await window.companion.getDshSkinMarketplace(force);
      setSnapshot(next);
      onChanged(next);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!initialSnapshot) void refresh(false); }, []);
  useEffect(() => setVisibleCount(PAGE_SIZE), [query, sort]);
  useEffect(() => {
    const subscribe = window.companion.onDshSkinProgress;
    return subscribe ? subscribe(setOperationProgress) : undefined;
  }, []);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLocaleLowerCase();
    return snapshot.skins.filter(skin => !needle || `${skin.name.zh} ${skin.name.en} ${skin.author} ${skin.tags.join(" ")}`.toLocaleLowerCase().includes(needle)).sort((left, right) => sort === "stars"
      ? (right.stars ?? -1) - (left.stars ?? -1) || left.name.zh.localeCompare(right.name.zh)
      : Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.name.zh.localeCompare(right.name.zh));
  }, [query, snapshot, sort]);

  const selected = selectedId && snapshot ? snapshot.skins.find(skin => skin.id === selectedId) : undefined;
  const selectedRuntime = selected && snapshot ? runtimeFor(snapshot, selected.id) : undefined;

  async function mutate(skin: DshSkinCatalogEntry, action: DshSkinAction) {
    if (skin.review?.installation === "manual-only" && action === "install") {
      if (skin.repositoryUrl) await window.companion.openExternal(skin.repositoryUrl);
      return;
    }
    const wasActive = snapshot !== null && runtimeFor(snapshot, skin.id)?.activation === "active";
    setBusy(`${skin.id}:${action}`);
    setOperationProgress({ skinId: skin.id, action, phase: "queued", progress: null });
    setNotice(null);
    try {
      const result = await window.companion.mutateDshSkin({ skinId: skin.id, action });
      setSnapshot(result.snapshot);
      onChanged(result.snapshot);
      if (result.supportPrepared) setNotice(t("dshThemes.supportPrepared", "主题管理已准备好。重启 DSH 后再次安装这个主题。"));
      else if (!result.ok) setNotice(result.error ?? t("dshThemes.operationFailed", "操作失败。"));
      else if (result.restartRequested) setNotice(t("dshThemes.restarting", "DSH 正在重启。"));
      else if (action === "activate" || ((action === "deactivate" || action === "uninstall") && wasActive)) {
        const override = action === "deactivate" || action === "uninstall"
          ? { mode: "disabled" as const }
          : { mode: "temporary" as const, themeId: skin.id };
        const overrideResult = await window.companion.setDshThemeOverride(override).catch(() => null);
        if (!overrideResult?.ok) setNotice(t("dshThemes.operationFailed", "操作失败。"));
        else {
          const nextSnapshot = await window.companion.getDshSkinMarketplace().catch(() => null);
          if (nextSnapshot) {
            setSnapshot(nextSnapshot);
            onChanged(nextSnapshot);
          }
          setNotice(t("dshThemes.restartToApply", "主题状态已保存，重启 DSH 后生效。"));
        }
      } else if (result.browserRefreshRequired) setNotice(t("dshThemes.restartToApply", "主题状态已保存，重启 DSH 后生效。"));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); setOperationProgress(null); }
  }

  function openDetails(skin: DshSkinCatalogEntry, trigger?: HTMLButtonElement) {
    detailsTriggerRef.current = trigger ?? null;
    setSelectedId(skin.id);
    setShotIndex(0);
  }

  function closeDetails() {
    setSelectedId(null);
    window.requestAnimationFrame(() => detailsTriggerRef.current?.focus());
  }

  return (
    <div className="settings-page dsh-themes-page dsh-theme-market">
      <header className="dsh-theme-market-header">
        <button type="button" className="dsh-theme-icon-button" onClick={onBack} aria-label={t("common.back", "返回")}><ArrowLeft size={17} /></button>
        <div><h2>{t("dshThemes.marketTitle", "主题市场")}</h2><p>{snapshot ? t("dshThemes.marketSummary", "{count} 个主题", { count: snapshot.skins.length }) : t("dshThemes.loading", "正在加载主题…")}</p></div>
        <div className="dsh-theme-header-actions">
          <button type="button" className="dsh-theme-icon-button" onClick={() => void window.companion.openExternal("https://github.com/Renakoni/awesome-dsh-themes")} title={t("dshThemes.openOnlineMarket", "打开主题目录仓库")} aria-label={t("dshThemes.openOnlineMarket", "打开主题目录仓库")}><ExternalLink size={17} /></button>
          <button type="button" className="dsh-theme-icon-button" onClick={() => void refresh(true)} disabled={loading} title={t("dshThemes.refresh", "刷新")} aria-label={t("dshThemes.refresh", "刷新")}><RefreshCw size={17} className={loading ? "spinning" : undefined} /></button>
        </div>
      </header>

      {snapshot?.catalogError ? <div className="dsh-theme-catalog-note">{snapshot.skins.length > 0 ? t("dshThemes.cachedCatalog", "正在显示上次成功加载的主题目录。") : t("dshThemes.catalogUnavailable", "主题目录暂时无法加载。")}</div> : null}
      {notice ? <div className="dsh-theme-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label={t("dshThemes.dismiss", "关闭")}><X size={14} /></button></div> : null}
      {operationProgress ? <DshThemeOperationProgress progress={operationProgress} t={t} /> : null}

      <section className="dsh-theme-market-toolbar" aria-label={t("dshThemes.filters", "主题筛选")}>
        <label className="dsh-theme-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("dshThemes.search", "搜索主题或作者")} /></label>
        <div className="dsh-theme-sort" aria-label={t("dshThemes.sort", "排序")}>
          <button type="button" className={sort === "stars" ? "active" : ""} aria-pressed={sort === "stars"} onClick={() => setSort("stars")}><Star size={14} />{t("dshThemes.stars", "Stars")}</button>
          <button type="button" className={sort === "latest" ? "active" : ""} aria-pressed={sort === "latest"} onClick={() => setSort("latest")}><Clock3 size={14} />{t("dshThemes.latest", "最近更新")}</button>
        </div>
      </section>

      <section className="dsh-theme-market-scroll" aria-live="polite">
        {loading && !snapshot ? <div className="dsh-theme-empty"><RefreshCw size={20} className="spinning" /><span>{t("dshThemes.loading", "正在加载主题…")}</span></div> : null}
        {!loading && snapshot && rows.length === 0 ? <div className="dsh-theme-empty"><span>{t("dshThemes.noMatches", "没有匹配的主题")}</span></div> : null}
        {snapshot && rows.length > 0 ? <div className="dsh-theme-market-grid">{rows.slice(0, visibleCount).map(skin => {
          const state = runtimeFor(snapshot, skin.id);
          const installed = state?.installation === "installed";
          const activeTheme = state?.activation === "active";
          const manual = skin.review?.installation === "manual-only";
          const isBusy = busy?.startsWith(`${skin.id}:`) === true;
          const canManage = snapshot.host.connected;
          return (
            <article key={skin.id} className={`dsh-theme-market-card ${activeTheme ? "active" : ""}`} data-testid="dsh-theme-card">
              <button type="button" className="dsh-theme-market-preview" onClick={event => openDetails(skin, event.currentTarget)} aria-label={t("dshThemes.openDetails", "查看 {name}", { name: locale === "zh" ? skin.name.zh : skin.name.en })}><ThemePreview skin={skin} />{activeTheme ? <span className="dsh-theme-status active"><Check size={12} />{t("dshThemes.inUse", "使用中")}</span> : state?.updateAvailable ? <span className="dsh-theme-status update">{t("dshThemes.updateAvailable", "可更新")}</span> : installed ? <span className="dsh-theme-status">{t("dshThemes.installed", "已安装")}</span> : null}</button>
              <div className="dsh-theme-market-copy"><div><strong title={locale === "zh" ? skin.name.zh : skin.name.en}>{locale === "zh" ? skin.name.zh : skin.name.en}</strong><span>{skin.author}</span></div><span className="dsh-theme-stars"><Star size={12} fill="currentColor" />{skin.stars === null ? "-" : skin.stars.toLocaleString()}</span></div>
              <p className="dsh-theme-market-description" title={skin.description}>{skin.description}</p>
              <div className="dsh-theme-market-card-footer"><button type="button" className="text" onClick={event => openDetails(skin, event.currentTarget)}>{t("dshThemes.details", "详情")}</button>{installed ? state?.updateAvailable ? <button type="button" className="primary" disabled={!canManage || isBusy} onClick={() => void mutate(skin, "update")}>{isBusy ? t("dshThemes.working", "处理中…") : t("dshThemes.update", "更新")}</button> : <button type="button" disabled>{activeTheme ? t("dshThemes.inUse", "使用中") : t("dshThemes.installed", "已安装")}</button> : <button type="button" className="primary" disabled={!canManage || isBusy} onClick={() => void mutate(skin, "install")} title={!canManage ? t("dshThemes.startDshToManage", "启动 DSH 后可安装主题") : undefined}>{isBusy ? t("dshThemes.working", "处理中…") : manual ? t("dshThemes.repository", "查看仓库") : t("dshThemes.install", "安装")}</button>}</div>
            </article>
          );
        })}</div> : null}
        {rows.length > visibleCount ? <button type="button" className="dsh-theme-load-more" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>{t("dshThemes.loadMore", "加载更多")}<span>{Math.min(PAGE_SIZE, rows.length - visibleCount)}</span></button> : null}
      </section>

      {selected && snapshot ? <ThemeDetailsDialog skin={selected} runtime={selectedRuntime} snapshot={snapshot} shotIndex={shotIndex} busy={busy !== null} locale={locale} t={t} onShotIndex={setShotIndex} onClose={closeDetails} onMutate={mutate} /> : null}
    </div>
  );
}

export function ThemeDetailsDialog({ skin, runtime, snapshot, shotIndex, busy, locale, t, onShotIndex, onClose, onMutate }: {
  skin: DshSkinCatalogEntry;
  runtime?: DshSkinRuntimeState;
  snapshot: DshSkinMarketplaceSnapshot;
  shotIndex: number;
  busy: boolean;
  locale: string;
  t: ReturnType<typeof useI18n>["t"];
  onShotIndex: (index: number) => void;
  onClose: () => void;
  onMutate: (skin: DshSkinCatalogEntry, action: DshSkinAction) => void;
}) {
  const canManage = snapshot.host.connected;
  const manual = skin.review?.installation === "manual-only";
  const installed = runtime?.installation === "installed";
  const active = runtime?.activation === "active";
  const restartRequired = runtime?.activation === "restart-required" && snapshot.host.restartAvailable;
  const updateAvailable = runtime?.updateAvailable === true;
  const status = runtime?.installation === "broken" ? t("dshThemes.broken", "安装不完整") : active ? t("dshThemes.inUse", "使用中") : installed ? t("dshThemes.installed", "已安装") : t("dshThemes.notInstalled", "未安装");
  const updateLabel = t("dshThemes.updateAvailable", "可更新");
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const dialogElement = dialog;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialogElement.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    dialogElement.addEventListener("keydown", onKeyDown);
    return () => dialogElement.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="dsh-theme-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="dsh-theme-dialog" role="dialog" aria-modal="true" aria-label={locale === "zh" ? skin.name.zh : skin.name.en}>
    <button ref={closeRef} type="button" className="dsh-theme-dialog-close" onClick={onClose} aria-label={t("dshThemes.closeDetails", "关闭详情")}><X size={18} /></button>
    <div className="dsh-theme-dialog-media"><ThemePreview key={`${skin.id}:${shotIndex}`} skin={{ ...skin, previewLocalUrl: undefined, listScreenshot: skin.screenshots[shotIndex] ?? skin.listScreenshot }} eager />{skin.screenshots.length > 1 ? <><button type="button" className="previous" onClick={() => onShotIndex((shotIndex - 1 + skin.screenshots.length) % skin.screenshots.length)} aria-label={t("dshThemes.previousImage", "上一张预览")}><ChevronLeft size={20} /></button><button type="button" className="next" onClick={() => onShotIndex((shotIndex + 1) % skin.screenshots.length)} aria-label={t("dshThemes.nextImage", "下一张预览")}><ChevronRight size={20} /></button><span className="dsh-theme-image-count">{shotIndex + 1} / {skin.screenshots.length}</span></> : null}</div>
    <div className="dsh-theme-dialog-copy"><div className="dsh-theme-dialog-title"><div><span>{skin.author}</span><h3>{locale === "zh" ? skin.name.zh : skin.name.en}</h3></div><span className="dsh-theme-stars"><Star size={13} fill="currentColor" />{skin.stars === null ? "-" : skin.stars.toLocaleString()}</span></div><p>{skin.description}</p><div className="dsh-theme-tags">{skin.tags.slice(0, 8).map(tag => <span key={tag}>{tag}</span>)}</div><dl className="dsh-theme-metadata"><div><dt>{t("dshThemes.status", "状态")}</dt><dd><span>{status}</span>{updateAvailable ? <><span aria-hidden="true"> / </span><span>{updateLabel}</span></> : null}</dd></div><div><dt>{t("dshThemes.version", "版本")}</dt><dd title={t("dshThemes.versionDetail", "已安装版本 / 目录版本")}><span>{runtime?.installedVersion ?? "-"}</span><span aria-hidden="true"> / </span><span>{skin.install.version}</span></dd></div><div><dt>{t("dshThemes.catalogCommit", "目录 commit")}</dt><dd title={skin.install.commit}>{skin.install.commit ? shortCommit(skin.install.commit) : "-"}</dd></div><div><dt>{t("dshThemes.compatibility", "兼容性")}</dt><dd>{skin.compatibility.dsh} / {skin.modes.join(" / ")}</dd></div></dl>
      {runtime?.error ? <p className="dsh-theme-error">{runtime.error}</p> : null}{manual ? <p className="dsh-theme-manual-note">{t("dshThemes.manualDetail", "该主题暂不支持一键安装，请按仓库说明操作。")}</p> : null}{snapshot.host.marketInstalled && !snapshot.host.connected ? <p className="dsh-theme-manual-note">{t("dshThemes.startDshToManage", "启动 DSH 后可管理主题。")}</p> : null}
      <div className="dsh-theme-dialog-actions">{skin.repositoryUrl ? <button type="button" className="dsh-theme-icon-button" onClick={() => void window.companion.openExternal(skin.repositoryUrl!)} title={t("dshThemes.openRepository", "打开仓库")} aria-label={t("dshThemes.openRepository", "打开仓库")}><ExternalLink size={17} /></button> : null}{installed ? <button type="button" className="danger-quiet" disabled={!canManage || busy} onClick={() => void onMutate(skin, "uninstall")}><Trash2 size={15} />{t("dshThemes.uninstall", "卸载")}</button> : null}{active ? <button type="button" disabled={!canManage || busy} onClick={() => void onMutate(skin, "deactivate")}><Power size={15} />{t("dshThemes.deactivate", "停用")}</button> : restartRequired ? <button type="button" className="primary" disabled={busy} onClick={() => void onMutate(skin, "restart")}><RefreshCw size={15} />{t("dshThemes.restartWeb", "重启 DSH")}</button> : null}{installed && updateAvailable ? <button type="button" className="primary" disabled={!canManage || busy} onClick={() => void onMutate(skin, "update")}>{t("dshThemes.update", "更新")}</button> : installed && !active && !restartRequired ? <button type="button" className="primary" disabled={!canManage || busy} onClick={() => void onMutate(skin, "activate")}>{t("dshThemes.use", "使用")}</button> : !installed ? <button type="button" className="primary" disabled={!canManage || busy} onClick={() => void onMutate(skin, "install")}><Download size={15} />{manual ? t("dshThemes.repository", "查看仓库") : t("dshThemes.install", "安装")}</button> : null}</div>
    </div>
  </section></div>;
}

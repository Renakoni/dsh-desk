import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Info, Palette, Power, RefreshCw, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { DshSkinAction, DshSkinCatalogEntry, DshSkinMarketplaceSnapshot, DshSkinOperationProgress } from "../../../../shared/dshSkins";
import { useI18n } from "../../useI18n";
import { DshThemeFeedback, DshThemeMarketPanel, ThemeDetailsDialog, ThemePreview, runtimeFor } from "./DshThemeMarketPanel";

type DshThemesPageProps = { active: boolean };

export function DshThemesPage({ active }: DshThemesPageProps) {
  const { locale, t } = useI18n();
  const [snapshot, setSnapshot] = useState<DshSkinMarketplaceSnapshot | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketBusy, setMarketBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [operationProgress, setOperationProgress] = useState<DshSkinOperationProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeFading, setNoticeFading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shotIndex, setShotIndex] = useState(0);
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef<string | null>(null);

  async function refresh(force = false) {
    setLoading(true);
    try {
      const next = await window.companion.getDshSkinMarketplace(force);
      setSnapshot(next);
      setOperationProgress(next.host.operation ?? null);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (active) void refresh(false);
  }, [active]);

  useEffect(() => {
    if (!active) setMarketOpen(false);
  }, [active]);

  useEffect(() => {
    if (!active) setSelectedId(null);
  }, [active]);

  useEffect(() => {
    const subscribe = window.companion.onDshSkinProgress;
    return subscribe ? subscribe(progress => {
      if (progress === null && busyRef.current !== null) return;
      setOperationProgress(progress);
    }) : undefined;
  }, []);

  useEffect(() => {
    if (!notice) {
      setNoticeFading(false);
      return undefined;
    }
    setNoticeFading(false);
    const fadeTimer = window.setTimeout(() => setNoticeFading(true), 9_700);
    const clearTimer = window.setTimeout(() => setNotice(null), 10_000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [notice]);

  const installed = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.skins.filter(skin => {
      const state = runtimeFor(snapshot, skin.id);
      return state?.installation === "installed" || state?.installation === "broken";
    }).sort((left, right) => {
      const leftActive = runtimeFor(snapshot, left.id)?.activation === "active" ? 0 : 1;
      const rightActive = runtimeFor(snapshot, right.id)?.activation === "active" ? 0 : 1;
      return leftActive - rightActive || left.name.zh.localeCompare(right.name.zh);
    });
  }, [snapshot]);
  const localInstalled = snapshot?.localSkins ?? [];
  const canManageThemes = snapshot?.host.connected === true;
  const managerInstalled = snapshot?.host.marketInstalled === true;
  const selected = selectedId && snapshot ? snapshot.skins.find(skin => skin.id === selectedId) : undefined;
  const selectedRuntime = selected && snapshot ? runtimeFor(snapshot, selected.id) : undefined;
  const operationLocked = busy !== null || marketBusy || operationProgress !== null;

  function openDetails(skin: DshSkinCatalogEntry, trigger?: HTMLButtonElement) {
    detailsTriggerRef.current = trigger ?? null;
    setSelectedId(skin.id);
    setShotIndex(0);
  }

  function closeDetails() {
    setSelectedId(null);
    window.requestAnimationFrame(() => detailsTriggerRef.current?.focus());
  }

  async function mutate(skin: Pick<DshSkinCatalogEntry, "id">, action: DshSkinAction) {
    if (snapshot?.host.marketInstalled !== true) {
      toast.warning(t("dshThemes.managerUnavailable", "DSH 主题管理组件不可用。"), { id: "dsh-theme-manager-unavailable", className: "dsh-theme-warning-toast" });
      return;
    }
    if (snapshot?.host.connected !== true) {
      toast.warning(t("dshThemes.dshOnlineRequired", "该操作需 DSH 在线。"), { id: "dsh-theme-dsh-offline", className: "dsh-theme-warning-toast" });
      return;
    }
    if (busyRef.current !== null || marketBusy || operationProgress !== null) {
      toast.warning(t("dshThemes.operationBusy", "另一个主题操作正在进行，请完成后再试。"), { id: "dsh-theme-operation-busy", className: "dsh-theme-warning-toast" });
      return;
    }
    if (action === "update" && selectedId !== null) closeDetails();
    const wasActive = snapshot !== null && (
      runtimeFor(snapshot, skin.id)?.activation === "active"
      || snapshot.localSkins?.some(item => item.id === skin.id && item.active) === true
    );
    const operationKey = `${skin.id}:${action}`;
    busyRef.current = operationKey;
    setBusy(operationKey);
    setOperationProgress({ skinId: skin.id, action, phase: "queued", progress: null });
    setNotice(null);
    try {
      const result = await window.companion.mutateDshSkin({ skinId: skin.id, action });
      const appliesOverride = result.ok && (action === "activate" || ((action === "deactivate" || action === "uninstall") && wasActive));
      if (!appliesOverride) setSnapshot(result.snapshot);
      if (result.supportPrepared) {
        setOperationProgress(null);
        setNotice(t("dshThemes.supportPrepared", "主题管理已准备好。重启 DSH 后继续操作。"));
      } else if (!result.ok) {
        setOperationProgress(null);
        setNotice(result.error ?? t("dshThemes.operationFailed", "操作失败。"));
      } else if (result.restartRequested) {
        setOperationProgress(null);
        setNotice(t("dshThemes.restarting", "DSH 正在重启。"));
      } else if (appliesOverride) {
        setOperationProgress({ skinId: skin.id, action, phase: "done", progress: 100 });
        const override = action === "deactivate" || action === "uninstall"
          ? { mode: "disabled" as const }
          : { mode: "temporary" as const, themeId: skin.id };
        const overrideResult = await window.companion.setDshThemeOverride(override).catch(() => null);
        const nextSnapshot = await window.companion.getDshSkinMarketplace().catch(() => null);
        setSnapshot(nextSnapshot ?? result.snapshot);
        setOperationProgress(null);
        if (!overrideResult?.ok) {
          setNotice(t("dshThemes.operationFailed", "操作失败。"));
        } else {
          setNotice(t("dshThemes.restartToApply", "主题状态已保存，部分功能可能需要重启 DSH。"));
        }
      } else {
        setOperationProgress(null);
        if (result.browserRefreshRequired) setNotice(t("dshThemes.restartToApply", "主题状态已保存，部分功能可能需要重启 DSH。"));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setOperationProgress(null);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  if (marketOpen) {
    return <DshThemeMarketPanel
      initialSnapshot={snapshot}
      onBack={() => setMarketOpen(false)}
      onChanged={setSnapshot}
      onBusyChange={setMarketBusy}
    />;
  }

  return (
    <div className="settings-page dsh-themes-page dsh-theme-library">
      <header className="dsh-theme-library-header">
        <div>
          <h2>{t("dshThemes.libraryTitle", "主题库")}</h2>
          <p>{snapshot
            ? t("dshThemes.librarySummary", "{count} 个已安装主题", { count: installed.length + localInstalled.length })
            : t("dshThemes.loadingLibrary", "正在读取本机主题…")}</p>
        </div>
        <div className="dsh-theme-header-actions">
          <button type="button" className="dsh-theme-icon-button" onClick={() => setMarketOpen(true)} disabled={operationLocked} title={t("dshThemes.marketTitle", "主题市场")} aria-label={t("dshThemes.marketTitle", "主题市场")}><Store size={17} /></button>
          <button type="button" className="dsh-theme-icon-button" onClick={() => void refresh(true)} disabled={loading || operationLocked} title={t("dshThemes.refresh", "刷新")} aria-label={t("dshThemes.refresh", "刷新")}><RefreshCw size={17} className={loading ? "spinning" : undefined} /></button>
        </div>
      </header>

      <DshThemeFeedback notice={notice} noticeFading={noticeFading} operationProgress={operationProgress} finalizing={busy !== null} onDismiss={() => setNotice(null)} t={t} />
      {snapshot && (!snapshot.host.marketInstalled || !snapshot.host.connected) ? (
        <div className="dsh-theme-connection-note" id="dsh-theme-host-status" role="status">
          <Info size={14} aria-hidden="true" />
          <span>{snapshot.host.marketInstalled
            ? t("dshThemes.startDshToManage", "启动 DSH 后可管理主题。")
            : t("dshThemes.managerUnavailable", "DSH 主题管理组件不可用。")}</span>
        </div>
      ) : null}

      <section className="dsh-theme-library-content" aria-live="polite" tabIndex={0} aria-label={t("dshThemes.libraryContent", "已安装主题")}>
        {loading && !snapshot ? <div className="dsh-theme-empty"><RefreshCw size={20} className="spinning" /><span>{t("dshThemes.loadingLibrary", "正在读取本机主题…")}</span></div> : null}
        {!loading && snapshot && installed.length === 0 && localInstalled.length === 0 ? (
          <div className="dsh-theme-empty">
            <span className="dsh-theme-empty-icon"><Palette size={24} /></span>
            <strong>{t("dshThemes.emptyLibrary", "还没有安装主题")}</strong>
            <p>{t("dshThemes.emptyLibraryDetail", "从主题市场选择喜欢的外观。")}</p>
            <button type="button" className="dsh-theme-primary-button" onClick={() => setMarketOpen(true)}><Store size={15} />{t("dshThemes.browseMarket", "浏览主题市场")}</button>
          </div>
        ) : null}
        {snapshot && installed.length > 0 ? <div className="dsh-theme-library-grid">{installed.map(skin => {
          const state = runtimeFor(snapshot, skin.id)!;
          const activeTheme = state.activation === "active";
          const canManage = snapshot.host.connected;
          const managerAvailable = snapshot.host.marketInstalled;
          const isBusy = operationLocked;
          const activating = busy === `${skin.id}:activate`;
          const deactivating = busy === `${skin.id}:deactivate`;
          return (
            <article key={skin.id} className={`dsh-theme-library-card ${activeTheme || deactivating ? "active" : ""}`}>
              <button type="button" className="dsh-theme-library-preview" onClick={event => openDetails(skin, event.currentTarget)} aria-label={t("dshThemes.openDetails", "查看 {name}", { name: locale === "zh" ? skin.name.zh : skin.name.en })}><ThemePreview skin={skin} />{activeTheme ? <span className="dsh-theme-status active"><Check size={12} />{t("dshThemes.inUse", "使用中")}{state.updateAvailable ? <><span aria-hidden="true"> · </span>{t("dshThemes.updateAvailable", "可更新")}</> : null}</span> : state.updateAvailable ? <span className="dsh-theme-status update">{t("dshThemes.updateAvailable", "可更新")}</span> : null}</button>
              <div className="dsh-theme-library-copy">
                <div><strong title={locale === "zh" ? skin.name.zh : skin.name.en}>{locale === "zh" ? skin.name.zh : skin.name.en}</strong><span title={skin.author}>{skin.author}</span></div>
                {skin.repositoryUrl ? <button type="button" className="dsh-theme-repository-button" onClick={() => void window.companion.openExternal(skin.repositoryUrl!)} title={t("dshThemes.openRepository", "打开仓库")} aria-label={t("dshThemes.openRepository", "打开仓库")}><ExternalLink size={15} /></button> : null}
              </div>
              {activeTheme && state.compatibility?.status === "adapted" ? <p className="dsh-theme-compatibility-note">{t("dshThemes.compatibilityAdapted", "已启用兼容适配：这个旧版主题正在使用 Desk 的 keyed slot 兼容层。")}</p> : activeTheme && state.compatibility?.status === "unverified" ? <p className="dsh-theme-compatibility-note">{t("dshThemes.compatibilityUnverified", "暂未确认该主题兼容当前 DSH，启用前会阻止应用并提示原因。")}</p> : null}
              <div className="dsh-theme-library-actions">
                {state.installation === "broken" ? <span className="dsh-theme-broken">{t("dshThemes.broken", "安装不完整")}</span> : null}
                {activeTheme || deactivating ? <button type="button" disabled={!managerAvailable || isBusy} aria-disabled={managerAvailable && !canManage || undefined} aria-describedby={!canManage ? "dsh-theme-host-status" : undefined} onClick={() => void mutate(skin, "deactivate")}><Power size={14} />{deactivating ? t("dshThemes.deactivatingAction", "停用中…") : t("dshThemes.deactivate", "停用")}</button> : state.installation === "installed" ? <button type="button" className="primary" disabled={!managerAvailable || isBusy} aria-disabled={managerAvailable && !canManage || undefined} aria-describedby={!canManage ? "dsh-theme-host-status" : undefined} onClick={() => void mutate(skin, "activate")}>{activating ? t("dshThemes.activatingAction", "启用中…") : t("dshThemes.use", "使用")}</button> : null}
                <button type="button" className="icon danger" disabled={!managerAvailable || isBusy} aria-disabled={managerAvailable && !canManage || undefined} aria-describedby={!canManage ? "dsh-theme-host-status" : undefined} onClick={() => void mutate(skin, "uninstall")} title={t("dshThemes.uninstall", "卸载")} aria-label={t("dshThemes.uninstall", "卸载")}><Trash2 size={15} /></button>
              </div>
            </article>
          );
        })}</div> : null}
        {localInstalled.length > 0 ? <>
          <div className="dsh-theme-local-heading"><strong>{t("dshThemes.localThemes", "本地未收录主题")}</strong><span>{t("dshThemes.localThemesDetail", "这些主题保留在本机，不属于当前目录。", { count: localInstalled.length })}</span></div>
          <div className="dsh-theme-library-grid">{localInstalled.map(skin => (
            <article key={skin.id} className={`dsh-theme-library-card dsh-theme-local-card ${skin.active ? "active" : ""}`}>
              <div className="dsh-theme-library-preview"><div className="dsh-theme-preview-fallback"><Palette size={24} /><span>{t("dshThemes.notCatalogued", "未收录")}</span></div>{skin.active ? <span className="dsh-theme-status active"><Check size={12} />{t("dshThemes.inUse", "使用中")}</span> : null}</div>
              <div className="dsh-theme-library-copy"><div><strong title={skin.name.en}>{locale === "zh" ? skin.name.zh : skin.name.en}</strong><span title={skin.author}>{skin.author}</span></div>{skin.repositoryUrl ? <button type="button" className="dsh-theme-repository-button" onClick={() => void window.companion.openExternal(skin.repositoryUrl!)} title={t("dshThemes.openRepository", "打开仓库")} aria-label={t("dshThemes.openRepository", "打开仓库")}><ExternalLink size={15} /></button> : null}</div>
              <div className="dsh-theme-library-actions">
                <span className={skin.broken || !skin.rowId ? "dsh-theme-broken" : "dsh-theme-local-label"}>{skin.broken ? t("dshThemes.broken", "安装不完整") : !skin.rowId ? t("dshThemes.registrationMissing", "未找到主题入口") : t("dshThemes.keptLocally", "仅保留在本机")}</span>
                {!skin.broken && skin.rowId ? skin.active || busy === `${skin.id}:deactivate`
                  ? <button type="button" disabled={!managerInstalled || operationLocked} aria-disabled={managerInstalled && !canManageThemes || undefined} aria-describedby={!canManageThemes ? "dsh-theme-host-status" : undefined} onClick={() => void mutate(skin, "deactivate")}><Power size={14} />{busy === `${skin.id}:deactivate` ? t("dshThemes.deactivatingAction", "停用中…") : t("dshThemes.deactivate", "停用")}</button>
                  : <button type="button" className="primary" disabled={!managerInstalled || operationLocked} aria-disabled={managerInstalled && !canManageThemes || undefined} aria-describedby={!canManageThemes ? "dsh-theme-host-status" : undefined} onClick={() => void mutate(skin, "activate")}>{busy === `${skin.id}:activate` ? t("dshThemes.activatingAction", "启用中…") : t("dshThemes.use", "使用")}</button>
                  : null}
              </div>
            </article>
          ))}</div>
        </> : null}
      </section>
      {selected && snapshot ? <ThemeDetailsDialog skin={selected} runtime={selectedRuntime} snapshot={snapshot} shotIndex={shotIndex} busy={operationLocked} pendingAction={busy?.startsWith(`${selected.id}:`) ? busy.slice(selected.id.length + 1) as DshSkinAction : undefined} locale={locale} t={t} onShotIndex={setShotIndex} onClose={closeDetails} onMutate={mutate} /> : null}
    </div>
  );
}

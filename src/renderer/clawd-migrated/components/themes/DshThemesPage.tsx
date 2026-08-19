import React, { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Palette, Power, RefreshCw, Store, Trash2, X } from "lucide-react";
import type { DshSkinAction, DshSkinCatalogEntry, DshSkinMarketplaceSnapshot } from "../../../../shared/dshSkins";
import { useI18n } from "../../useI18n";
import { DshThemeMarketPanel, ThemePreview, runtimeFor } from "./DshThemeMarketPanel";

type DshThemesPageProps = { active: boolean };

export function DshThemesPage({ active }: DshThemesPageProps) {
  const { locale, t } = useI18n();
  const [snapshot, setSnapshot] = useState<DshSkinMarketplaceSnapshot | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(force = false) {
    setLoading(true);
    try { setSnapshot(await window.companion.getDshSkinMarketplace(force)); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (active) void refresh(false);
  }, [active]);

  useEffect(() => {
    if (!active) setMarketOpen(false);
  }, [active]);

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

  async function mutate(skin: Pick<DshSkinCatalogEntry, "id">, action: DshSkinAction) {
    setBusy(`${skin.id}:${action}`);
    setNotice(null);
    try {
      const result = await window.companion.mutateDshSkin({ skinId: skin.id, action });
      setSnapshot(result.snapshot);
      if (result.supportPrepared) setNotice(t("dshThemes.supportPrepared", "主题管理已准备好。重启 DSH 后继续操作。"));
      else if (!result.ok) setNotice(result.error ?? t("dshThemes.operationFailed", "操作失败。"));
      else if (result.restartRequested) setNotice(t("dshThemes.restarting", "DSH 正在重启。"));
      else if (result.browserRefreshRequired) setNotice(action === "activate" || action === "update"
        ? t("dshThemes.restartToApply", "主题状态已保存，重启 DSH 后生效。")
        : t("dshThemes.refreshToApply", "主题状态已保存，刷新 DSH 页面后完全生效。"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  }

  if (marketOpen) {
    return <DshThemeMarketPanel
      initialSnapshot={snapshot}
      onBack={() => setMarketOpen(false)}
      onChanged={setSnapshot}
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
          <button type="button" className="dsh-theme-icon-button" onClick={() => setMarketOpen(true)} title={t("dshThemes.marketTitle", "主题市场")} aria-label={t("dshThemes.marketTitle", "主题市场")}><Store size={17} /></button>
          <button type="button" className="dsh-theme-icon-button" onClick={() => void refresh(true)} disabled={loading} title={t("dshThemes.refresh", "刷新")} aria-label={t("dshThemes.refresh", "刷新")}><RefreshCw size={17} className={loading ? "spinning" : undefined} /></button>
        </div>
      </header>

      {notice ? <div className="dsh-theme-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label={t("dshThemes.dismiss", "关闭")}><X size={14} /></button></div> : null}

      <section className="dsh-theme-library-content" aria-live="polite">
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
          const isBusy = busy?.startsWith(`${skin.id}:`) === true;
          return (
            <article key={skin.id} className={`dsh-theme-library-card ${activeTheme ? "active" : ""}`}>
              <div className="dsh-theme-library-preview"><ThemePreview skin={skin} />{activeTheme ? <span className="dsh-theme-status active"><Check size={12} />{t("dshThemes.inUse", "使用中")}</span> : state.updateAvailable ? <span className="dsh-theme-status update">{t("dshThemes.updateAvailable", "可更新")}</span> : null}</div>
              <div className="dsh-theme-library-copy">
                <div><strong title={locale === "zh" ? skin.name.zh : skin.name.en}>{locale === "zh" ? skin.name.zh : skin.name.en}</strong><span title={skin.author}>{skin.author}</span></div>
                {skin.repositoryUrl ? <button type="button" className="dsh-theme-repository-button" onClick={() => void window.companion.openExternal(skin.repositoryUrl!)} title={t("dshThemes.openRepository", "打开仓库")} aria-label={t("dshThemes.openRepository", "打开仓库")}><ExternalLink size={15} /></button> : null}
              </div>
              <div className="dsh-theme-library-actions">
                {state.installation === "broken" ? <span className="dsh-theme-broken">{t("dshThemes.broken", "安装不完整")}</span> : null}
                {activeTheme ? <button type="button" disabled={!canManage || isBusy} onClick={() => void mutate(skin, "deactivate")}><Power size={14} />{t("dshThemes.deactivate", "停用")}</button> : state.installation === "installed" ? <button type="button" className="primary" disabled={!canManage || isBusy} onClick={() => void mutate(skin, state.updateAvailable ? "update" : "activate")}>{state.updateAvailable ? t("dshThemes.update", "更新") : t("dshThemes.use", "使用")}</button> : null}
                <button type="button" className="icon danger" disabled={!canManage || isBusy} onClick={() => void mutate(skin, "uninstall")} title={t("dshThemes.uninstall", "卸载")} aria-label={t("dshThemes.uninstall", "卸载")}><Trash2 size={15} /></button>
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
                {!skin.broken && skin.rowId ? skin.active
                  ? <button type="button" disabled={!canManageThemes || busy?.startsWith(`${skin.id}:`) === true} onClick={() => void mutate(skin, "deactivate")}><Power size={14} />{t("dshThemes.deactivate", "停用")}</button>
                  : <button type="button" className="primary" disabled={!canManageThemes || busy?.startsWith(`${skin.id}:`) === true} onClick={() => void mutate(skin, "activate")}>{t("dshThemes.use", "使用")}</button>
                  : null}
              </div>
            </article>
          ))}</div>
        </> : null}
      </section>
    </div>
  );
}

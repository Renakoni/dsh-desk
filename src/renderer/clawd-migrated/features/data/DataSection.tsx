// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { Code2, FolderOpen, Gauge, HardDrive, History, Trash2, Wrench } from "lucide-react";
import type { DshAnalyticsSnapshot } from "../../../../shared/dshAnalytics";
import type { DisplayCurrency } from "../../../../shared/currency";
import { useI18n } from "../../useI18n";
import { StatsPanel } from "../../components/StatsPanel";
import { TokenPanel } from "./TokenPanel";
import { DshToolStatsPanel } from "./DshTrajectoryPanel";
import { RecentEditsPanel } from "./RecentEditsPanel";
import { ConfirmDialog } from "../../components/dsh-routing/ConfirmDialog";

function DataSectionInner({ persistedStats, hideSensitiveContent, displayCurrency = "CNY", onResetStats }: {
  persistedStats: any;
  hideSensitiveContent: boolean;
  displayCurrency?: DisplayCurrency;
  onResetStats: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const [dataDirectory, setDataDirectory] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [dshAnalytics, setDshAnalytics] = useState<DshAnalyticsSnapshot | null>(null);
  const [dshAnalyticsLoading, setDshAnalyticsLoading] = useState(false);
  const [dshAnalyticsError, setDshAnalyticsError] = useState<string | null>(null);
  const totalStatEvents = useMemo(() => Object.values(persistedStats?.eventTypeCounts ?? {}).reduce((sum: number, count) => sum + Number(count || 0), 0), [persistedStats]);

  useEffect(() => {
    void window.companion.getDataDirectory().then(setDataDirectory).catch(() => setDataDirectory(""));
    void loadDshAnalytics(false);
  }, []);

  async function loadDshAnalytics(force = false) {
    setDshAnalyticsLoading(true);
    setDshAnalyticsError(null);
    try {
      setDshAnalytics(await window.companion.getDshAnalytics(force));
    } catch (error) {
      setDshAnalyticsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDshAnalyticsLoading(false);
    }
  }

  async function performReset() {
    setBusyAction("stats");
    setActionError(null);
    try {
      await onResetStats();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function openDataDirectory() {
    setBusyAction("directory");
    setActionError(null);
    try {
      const result = await window.companion.openDataDirectory();
      if (!result?.ok) setActionError(result?.error ?? t("data.openDirectoryFailed", "无法打开数据目录"));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function revealDshSession(filePath: string) {
    setActionError(null);
    try {
      const revealed = await window.companion.revealDshSession(filePath);
      if (!revealed) setActionError(zh ? "无法定位该 DSH 会话日志" : "Unable to reveal this DSH session log");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="data-workbench">
      <section className="workbench-section data-runtime-section">
        <header className="workbench-section-head">
          <div>
            <span>Runtime</span>
            <h2>{t("sections.runtimeStats", "运行统计")}</h2>
          </div>
          <Gauge size={18} />
        </header>
        <StatsPanel
          snapshot={dshAnalytics}
          loading={dshAnalyticsLoading}
          error={dshAnalyticsError}
          onRefresh={force => void loadDshAnalytics(force)}
          hideSensitiveContent={hideSensitiveContent}
          onRevealSession={filePath => void revealDshSession(filePath)}
        />
      </section>

      <section className="workbench-section data-token-section">
        <header className="workbench-section-head">
          <div>
            <h2>{t("sections.tokenUsage", "Token 用量")}</h2>
          </div>
          <Code2 size={18} />
        </header>
        <TokenPanel hideSensitiveContent={hideSensitiveContent} displayCurrency={displayCurrency} />
      </section>

      <section className="workbench-section data-tool-stats-section">
        <header className="workbench-section-head">
          <div>
            <h2>{zh ? "工具统计" : "Tool stats"}</h2>
          </div>
          <Wrench size={18} />
        </header>
        <DshToolStatsPanel
          snapshot={dshAnalytics}
          loading={dshAnalyticsLoading}
          error={dshAnalyticsError}
        />
      </section>

      <section className="workbench-section data-edits-section">
        <header className="workbench-section-head">
          <div>
            <h2>{t("sections.recentEdits", "最近编辑")}</h2>
          </div>
          <History size={18} />
        </header>
        <RecentEditsPanel hideSensitiveContent={hideSensitiveContent} onOpenSession={filePath => void revealDshSession(filePath)} />
      </section>

      <section className="workbench-section data-local-section">
        <header className="workbench-section-head">
          <div>
            <span>Local</span>
            <h2>{t("sections.localData", "本地数据")}</h2>
          </div>
          <HardDrive size={18} />
        </header>
        <div className="local-data-list" aria-busy={busyAction !== null}>
          <div className="local-data-row">
            <Gauge size={17} />
            <div><strong>{t("data.usageStats", "使用统计")}</strong><span>{totalStatEvents} {t("common.items", "条")}</span></div>
            <button type="button" className="local-data-action danger" title={t("data.clearStats", "清空统计数据")} aria-label={t("data.clearStats", "清空统计数据")} disabled={busyAction !== null || totalStatEvents === 0} onClick={() => setConfirmingReset(true)}><Trash2 size={16} /></button>
          </div>
          <div className="local-data-row">
            <FolderOpen size={17} />
            <div><strong>{t("data.dataDirectory", "数据目录")}</strong><code title={hideSensitiveContent ? undefined : dataDirectory || undefined}>{hideSensitiveContent && dataDirectory ? t("privacy.detailsHidden", "详情已隐藏") : dataDirectory === null ? t("common.loading", "加载中...") : dataDirectory || t("data.directoryUnavailable", "不可用")}</code></div>
            <button type="button" className="local-data-action" title={t("data.openDataDirectory", "打开数据目录")} aria-label={t("data.openDataDirectory", "打开数据目录")} disabled={busyAction !== null || !dataDirectory} onClick={() => void openDataDirectory()}><FolderOpen size={16} /></button>
          </div>
        </div>
        {actionError ? <p className="local-data-error" role="status">{actionError}</p> : null}
      </section>

      {confirmingReset ? (
        <ConfirmDialog
          title={t("data.clearStats", "清空统计数据")}
          cancelLabel={zh ? "取消" : "Cancel"}
          confirmLabel={zh ? "清空" : "Clear"}
          danger
          onCancel={() => setConfirmingReset(false)}
          onConfirm={() => { setConfirmingReset(false); void performReset(); }}
        >
          <p>{t("data.clearStatsNote", "永久删除所有累计统计数据，此操作不可恢复。")}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

// Keep-mounted under the tab container: memoized so an unrelated settings change
// or a tab switch doesn't re-render the token panel (heatmap + tables).
export const DataSection = React.memo(DataSectionInner);

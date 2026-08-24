// @ts-nocheck
import React from "react";
import { useI18n } from "../../useI18n";
import { HooksManager, type HookStatus } from "../../components/hooks/HooksManager";
import { hookOutcomeMessage, type HookOperationOutcome } from "../../components/hooks/hookOutcome";
import { ConnectionRow } from "../overview/OverviewSection";
import { deriveConnectionState } from "../overview/connectionState";
import { timeAgo } from "../../utils/format";

// The full connection picture plus the destructive Remove, moved out of the
// Overview so that surface stays compact. Same parent-owned data flow as the
// Overview: status/checking/outcome live in the panel root, operations report
// back via onOperationComplete and trigger the authoritative full-chain recheck.
export function ConnectionManagement({
  hideSensitive,
  connection,
  now,
  hookStatus,
  checkError = false,
  actionOutcome = null,
  onRecheck,
  onOperationComplete
}: {
  hideSensitive: boolean;
  connection: any;
  now: number;
  hookStatus: HookStatus | null;
  checkError?: boolean;
  actionOutcome?: HookOperationOutcome | null;
  onRecheck?: () => void;
  onOperationComplete?: (outcome: HookOperationOutcome) => void;
}) {
  const { t } = useI18n();
  const facts = deriveConnectionState(hookStatus, connection, checkError);
  const webProfile = hookStatus?.profiles?.find(profile => profile.name === "web");
  const headlessProfile = hookStatus?.profiles?.find(profile => profile.name === "headless");
  const profileValue = (installed: boolean | undefined) => installed ? t("connection.profileReady", "已安装") : t("connection.profileMissing", "未安装");

  return (
    <div className="connection-management">
      {facts.mode === "loading" ? (
        <div className="connection-loading">{t("status.checking", "检查中…")}</div>
      ) : facts.mode === "error" ? (
        <div className="connection-check-error">
          <p>{facts.errorReason === "settings-unreadable"
            ? t("connection.settingsUnreadable", "无法读取 DeepSeek Harness profile 配置。请检查 ~/.dsh/profiles。")
            : t("connection.checkFailed", "无法刷新连接，请重试。")}</p>
          {onRecheck ? (
            <button type="button" className="connection-recheck" onClick={onRecheck}>
              {t("connection.recheck", "重新检查")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="connection-rows">
          <ConnectionRow
            label={t("connection.webProfile", "Web profile")}
            value={profileValue(webProfile?.installed)}
            state={webProfile?.installed ? "healthy" : "repair"}
          />
          <ConnectionRow
            label={t("connection.headlessProfile", "Headless profile")}
            value={profileValue(headlessProfile?.installed)}
            state={headlessProfile?.installed ? "healthy" : "repair"}
          />
          <ConnectionRow
            label={t("connection.pluginBundle", "插件安装包")}
            value={facts.bundleOk ? t("connection.available", "可用") : t("doctor.fileMissing", "文件不存在")}
            state={facts.bundleState}
          />
          <ConnectionRow
            label="pnpm"
            value={facts.pnpmAvailable ? t("connection.available", "可用") : t("connection.pnpmMissing", "未找到")}
            state={facts.pnpmState}
          />
          <ConnectionRow
            label={t("status.localServer", "本地监听")}
            value={facts.listening ? `127.0.0.1:${connection.port}` : t("status.notListening", "未监听")}
            state={facts.listenerState}
          />
          <ConnectionRow
            label={t("status.recentEvent", "最近事件")}
            value={connection.lastEventAt ? timeAgo(connection.lastEventAt, now) : t("connection.waitingFirstEvent", "等待首个事件")}
            state={facts.recentEventState}
          />
        </div>
      )}

      {/* Repair is shown only for a partial installation with both prerequisites
          available. Fresh setup uses Install; Remove keeps two-step confirmation. */}
      <HooksManager actionsOnly showRepair={facts.mode === "workbench" && facts.canRepair} status={hookStatus} onOperationComplete={onOperationComplete} />

      {/* Same parent-owned outcome as the Overview, derived at render time so it
          stays reactive to the current locale and hide setting. */}
      {actionOutcome ? <p className="hooks-result connection-action-result">{hookOutcomeMessage(actionOutcome, t, hideSensitive)}</p> : null}
    </div>
  );
}

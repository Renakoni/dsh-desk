// @ts-nocheck
import React from "react";
import { Wrench, RefreshCw } from "lucide-react";
import { useI18n } from "../../useI18n";
import { DshRoutingPanel } from "../../components/dsh-routing/DshRoutingPanel";
import { HooksManager, type HookStatus } from "../../components/hooks/HooksManager";
import { hookOutcomeMessage, type HookOperationOutcome } from "../../components/hooks/hookOutcome";
import { deriveConnectionState } from "./connectionState";
import { redactSensitiveText } from "../../../../shared/privacy";

type ConnectionRowState = "healthy" | "waiting" | "partial" | "repair" | "unavailable";

export function ConnectionRow({ label, value, state }: { label: string; value: string; state: ConnectionRowState }) {
  return (
    <div className={`connection-row state-${state}`}>
      <span className="connection-row-dot" aria-hidden="true" />
      <span className="connection-row-label">{label}</span>
      <span className="connection-row-value" title={value}>{value}</span>
    </div>
  );
}

// The Overview connection area is a single surface that changes state over the
// product lifecycle. The states are mutually exclusive (loading / check-error /
// not-configured onboarding / factual workbench) and it never re-shows first-run
// onboarding for an installed-but-broken config — that keeps the workbench with a
// contextual Repair. The Overview stays compact with one row per required DSH
// profile; installer, pnpm, listener, and destructive Remove details live in
// Settings.
export function OverviewSection({
  settings,
  connection,
  hookStatus,
  checkError = false,
  checking = false,
  actionOutcome = null,
  onRecheck,
  onOperationComplete
}: {
  settings: any;
  updateSettings?: (settings: any) => void;
  connection: any;
  hookStatus: HookStatus | null;
  checkError?: boolean;
  checking?: boolean;
  actionOutcome?: HookOperationOutcome | null;
  onRecheck?: () => void;
  onOperationComplete?: (outcome: HookOperationOutcome) => void;
}) {
  const { t, locale } = useI18n();
  const hideSensitive = settings.hideSensitiveContent === true;
  const facts = deriveConnectionState(hookStatus, connection, checkError);
  const {
    mode,
    errorReason,
    listening,
    healthy,
    canRepair,
    bundleMissing,
    listenerDown
  } = facts;
  const webProfile = hookStatus?.profiles?.find(profile => profile.name === "web");
  const headlessProfile = hookStatus?.profiles?.find(profile => profile.name === "headless");
  const profileValue = (installed: boolean | undefined) => installed ? t("connection.profileReady", "已安装") : t("connection.profileMissing", "未安装");
  const profileState = (installed: boolean | undefined): ConnectionRowState => installed ? "healthy" : "repair";

  const recheckButton = onRecheck ? (
    <button type="button" className="connection-recheck" onClick={onRecheck} disabled={checking}>
      <RefreshCw size={13} className={checking ? "spin" : undefined} />
      {checking ? t("connection.rechecking", "检查中…") : t("connection.recheck", "重新检查")}
    </button>
  ) : null;

  return (
    <section className="overview-workbench">
      <DshRoutingPanel />
      {connection.error ? <section className="connection-error"><Wrench size={18} />{hideSensitive ? redactSensitiveText(connection.error, locale) : connection.error}</section> : null}

      <section className="overview-connection">
        <header className="workbench-section-head">
          <h2>{t("sections.dshConnection", "DeepSeek Harness 连接")}</h2>
          {mode === "workbench" ? (
            <div className="connection-head-actions">
              {onRecheck ? (
                <button
                  type="button"
                  className="connection-recheck icon-only"
                  onClick={onRecheck}
                  disabled={checking}
                  title={t("connection.recheck", "重新检查")}
                  aria-label={t("connection.recheck", "重新检查")}
                >
                  <RefreshCw size={13} className={checking ? "spin" : undefined} />
                </button>
              ) : null}
              <span className={`overview-state-badge ${healthy ? "good" : listening ? "wait" : "bad"}`}>
                {healthy ? t("status.ready", "已就绪") : listening ? t("status.needsAttention", "需要处理") : t("status.notListening", "未监听")}
              </span>
            </div>
          ) : null}
        </header>

        {mode === "loading" ? (
          <div className="connection-loading">{t("status.checking", "检查中…")}</div>
        ) : mode === "error" ? (
          <div className="connection-check-error">
            <p>{errorReason === "settings-unreadable"
              ? t("connection.settingsUnreadable", "无法读取 DeepSeek Harness profile 配置。请检查 ~/.dsh/profiles。")
              : t("connection.checkFailed", "无法刷新连接，请重试。")}</p>
            {recheckButton}
          </div>
        ) : mode === "notConfigured" ? (
          <div className="connection-onboarding">
            <HooksManager compact status={hookStatus} onOperationComplete={onOperationComplete} />
            {/* Discover an externally-installed config without leaving this view. */}
            {recheckButton}
          </div>
        ) : (
          <>
            <div className="connection-rows">
              <ConnectionRow
                label={t("connection.webProfile", "Web profile")}
                value={profileValue(webProfile?.installed)}
                state={profileState(webProfile?.installed)}
              />
              <ConnectionRow
                label={t("connection.headlessProfile", "Headless profile")}
                value={profileValue(headlessProfile?.installed)}
                state={profileState(headlessProfile?.installed)}
              />
            </div>

            {/* Repair shows only when it can actually fix the problem; the
                destructive Remove lives in Settings → Connection details.
                Forwarder/listener failures get their own guidance. */}
            {canRepair ? <HooksManager actionsOnly showRepair showRemove={false} status={hookStatus} onOperationComplete={onOperationComplete} /> : null}
            {bundleMissing ? (
              <div className="connection-guidance">
                <p>{t("connection.bundleMissingGuidance", "DSH 插件安装包缺失。请重新安装 DSH Desk 后再检查。")}</p>
              </div>
            ) : null}
            {listenerDown ? (
              <div className="connection-guidance">
                <p>{t("connection.listenerDownGuidance", "本地监听未运行，无法接收事件。请重启桌宠应用；监听恢复后此处会自动更新。")}</p>
              </div>
            ) : null}
          </>
        )}

        {/* Parent-owned action feedback: rendered outside the mode branches so a
            success message (e.g. the install restart guidance) survives the
            notConfigured <-> workbench transition that unmounts the HooksManager.
            The message is derived HERE from the structured outcome using the
            current locale + hide setting, so it never leaks a path stored earlier
            when hiding was off. */}
        {actionOutcome ? <p className="hooks-result connection-action-result">{hookOutcomeMessage(actionOutcome, t, hideSensitive)}</p> : null}
      </section>
    </section>
  );
}

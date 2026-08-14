// @ts-nocheck
import React, { useState } from "react";
import { CheckCircle2, Plug, Wrench } from "lucide-react";
import { useI18n } from "../../useI18n";
import { StatusCard } from "../workbench/Primitives";
import type { HookStatus } from "../../../../shared/hooks";
import type { HookOperationOutcome } from "./hookOutcome";

export type { HookStatus };
export type { HookOperationOutcome };

// The parent (Overview) owns hook STATUS, the loading/error state, AND the action
// outcome. HooksManager reports each completed operation as STRUCTURED data via
// onOperationComplete — never a pre-rendered message — so the parent can derive
// the localized, privacy-correct text at render time (keeping it reactive to the
// current hide setting and locale). HooksManager renders the supplied status and
// performs install/repair/remove; it does NOT fetch status on mount.
export function HooksManager({ compact = false, actionsOnly = false, success = false, showRepair = true, showRemove = true, status = null, onOperationComplete }: { compact?: boolean; actionsOnly?: boolean; success?: boolean; showRepair?: boolean; showRemove?: boolean; status?: HookStatus | null; onOperationComplete?: (outcome: HookOperationOutcome) => void } = {}) {
  const { t } = useI18n();
  const formatText = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
  const [action, setAction] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function handleInstall() {
    setAction("installing");
    try {
      const res = await window.companion.installHooks();
      onOperationComplete?.({ operation: "install", success: !!res.success, installed: !!res.success && !!res.status?.installed, status: res.status ?? null, error: res.error, errorKind: res.errorKind, bundlePath: res.bundlePath });
    } catch (error) {
      onOperationComplete?.({ operation: "install", success: false, installed: false, status: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction(null);
    }
  }

  async function handleRepair() {
    setAction("repairing");
    try {
      const res = await window.companion.repairHooks();
      onOperationComplete?.({ operation: "repair", success: !!res.success, installed: false, status: res.status ?? null, error: res.error, errorKind: res.errorKind, bundlePath: res.bundlePath });
    } catch (error) {
      onOperationComplete?.({ operation: "repair", success: false, installed: false, status: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction(null);
    }
  }

  async function handleRemove() {
    setAction("removing");
    try {
      const res = await window.companion.removeHooks();
      onOperationComplete?.({ operation: "remove", success: !!res.success, installed: false, status: res.status ?? null, error: res.error, errorKind: res.errorKind, bundlePath: res.bundlePath });
    } catch (error) {
      onOperationComplete?.({ operation: "remove", success: false, installed: false, status: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction(null);
      setConfirmingRemove(false);
    }
  }

  const configuredLabel = formatText(t("doctor.configuredCount", "已安装 {count} / {total} 个 profiles"), { count: status?.hookCount ?? 0, total: status?.requiredCount ?? 2 });
  const missingLabel = status?.missingEvents && status.missingEvents.length > 0 ? formatText(t("doctor.missingPrefix", "缺少: {events}"), { events: status.missingEvents.join(", ") }) : undefined;
  const mismatchLabel = status && !status.commandMatches && status.configExists ? t("doctor.mismatchHint", "DSH 插件注册不完整，建议修复") : undefined;
  const hookMeta = [missingLabel, mismatchLabel].filter(Boolean).join(" · ");
  const showManage = !compact || actionsOnly;

  return (
    <div className={`hooks-manager ${compact ? "compact" : ""} ${actionsOnly ? "actions-only" : ""} ${success ? "install-success" : ""}`}>
      {!actionsOnly && <StatusCard
        icon={success ? <CheckCircle2 size={18} /> : <Plug size={18} />}
        label={success ? t("doctor.hooksReady", "DSH 插件已就绪") : t("doctor.status", "DSH 插件状态")}
        value={success ? t("doctor.installSuccessValue", "安装成功") : compact ? configuredLabel : status?.installed ? t("hooks.installed", "已安装") : status?.configExists ? t("doctor.partial", "部分安装") : t("hooks.notInstalled", "未安装")}
        meta={success ? undefined : compact && hookMeta ? hookMeta : undefined}
        tone={success ? "good" : status?.installed ? "good" : status?.configExists ? "wait" : "bad"}
      />}

      {!compact && !actionsOnly && <div className="hooks-detail">
        <span>{configuredLabel}</span>
        {missingLabel && <span className="hooks-missing">{missingLabel}</span>}
        {mismatchLabel && <span className="hooks-mismatch">{mismatchLabel}</span>}
      </div>}

      {(!actionsOnly || showRepair) && <div className="hooks-actions">
        {!actionsOnly && <button onClick={handleInstall} disabled={!!action || success}>
          {success ? <><CheckCircle2 size={16} />{t("doctor.installed", "已安装")}</> : action === "installing" ? t("doctor.installing", "安装中...") : t("doctor.oneClickInstall", "一键安装")}
        </button>}
        {showManage && showRepair && <button onClick={handleRepair} disabled={!!action}>
          <Wrench size={13} aria-hidden="true" />
          <span>{action === "repairing" ? t("doctor.repairing", "修复中...") : t("doctor.repairConfig", "修复配置")}</span>
        </button>}
      </div>}

      {/* Remove edits both DSH profile manifests, so it lives in a
          de-emphasized zone and requires an explicit confirmation. Surfaces that
          shouldn't carry a destructive action (the Overview) opt out via
          showRemove; the management card in Settings keeps it. */}
      {showManage && showRemove && <div className="hooks-danger-zone">
        {confirmingRemove ? (
          <>
            <span className="hooks-danger-prompt">{t("doctor.removeConfirm", "确定从 DSH 的 Web 和 Headless profiles 中移除插件？")}</span>
            <button className="danger" onClick={handleRemove} disabled={!!action}>
              {action === "removing" ? t("doctor.removing", "移除中...") : t("doctor.removeConfirmYes", "确认移除")}
            </button>
            <button onClick={() => setConfirmingRemove(false)} disabled={!!action}>{t("common.cancel", "取消")}</button>
          </>
        ) : (
          <button className="danger ghost" onClick={() => setConfirmingRemove(true)} disabled={!!action}>{t("doctor.removeHooks", "移除 DSH 插件")}</button>
        )}
      </div>}

      {!compact && !actionsOnly && <p className="note">{t("doctor.note", "安装后，新启动的 DSH Web 和 Headless 进程会把事件发送到 DSH Desk。")}</p>}
    </div>
  );
}

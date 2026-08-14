// Structured result of a completed hook operation, plus the pure render-time
// message derivation. Storing the STRUCTURE (not a pre-rendered string) keeps the
// displayed message reactive to the CURRENT "hide paths and content" setting and
// locale: the privacy decision is made every render, so a message produced while
// hiding was off is re-evaluated (and hidden) once hiding is turned on.
import { describeHookOperationError, type HookOperationErrorKind, type HookStatus } from "../../../../shared/hooks";

export type HookOpKind = "install" | "repair" | "remove";

export interface HookOperationOutcome {
  operation: HookOpKind;
  success: boolean;
  /** Fully installed (install only). */
  installed: boolean;
  /** Fresh status from the operation result, or null if the call threw. */
  status: HookStatus | null;
  error?: string;
  errorKind?: HookOperationErrorKind;
  bundlePath?: string;
}

const SUCCESS_KEY: Record<HookOpKind, string> = { install: "doctor.installDone", repair: "doctor.repairDone", remove: "doctor.removeDone" };
const SUCCESS_FALLBACK: Record<HookOpKind, string> = { install: "安装成功！重启 DSH 进程后生效。", repair: "DSH 插件配置已修复。", remove: "已从 DSH profiles 移除插件。" };
const HIDDEN_KEY: Record<HookOpKind, string> = { install: "doctor.installFailedHidden", repair: "doctor.repairFailedHidden", remove: "doctor.removeFailedHidden" };
const HIDDEN_FALLBACK: Record<HookOpKind, string> = { install: "DSH 插件安装失败，详情已隐藏。", repair: "DSH 插件修复失败，详情已隐藏。", remove: "DSH 插件移除失败，详情已隐藏。" };
const FAILED_KEY: Record<HookOpKind, string> = { install: "doctor.installFailed", repair: "doctor.repairFailed", remove: "doctor.removeFailed" };
const FAILED_FALLBACK: Record<HookOpKind, string> = { install: "安装失败: {error}", repair: "修复失败: {error}", remove: "移除失败: {error}" };

type Translate = (key: string, fallback: string) => string;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(value), template);
}

// Derive the localized, privacy-correct message for an outcome using the CURRENT
// translate function and hide setting — never a value captured at operation time.
export function hookOutcomeMessage(outcome: HookOperationOutcome, t: Translate, hide: boolean): string {
  if (outcome.success) {
    if (outcome.operation === "install" && !outcome.installed) return t("doctor.installIncomplete", "安装完成，但仍有 DSH profile 未配置完整。");
    return t(SUCCESS_KEY[outcome.operation], SUCCESS_FALLBACK[outcome.operation]);
  }

  const display = describeHookOperationError(outcome, hide);
  if (display.kind === "bundle-missing") {
    return display.path
      ? fill(t("doctor.bundleMissingPath", "找不到 DSH 插件安装包：{path}"), { path: display.path })
      : t("doctor.bundleMissing", "找不到 DSH 插件安装包，请重新安装应用。");
  }
  if (display.kind === "npx-missing") return t("doctor.npxMissing", "未找到 npx。请先安装 Node.js/npm 并重新启动 DSH Desk。");
  if (display.kind === "hidden") return t(HIDDEN_KEY[outcome.operation], HIDDEN_FALLBACK[outcome.operation]);
  return fill(t(FAILED_KEY[outcome.operation], FAILED_FALLBACK[outcome.operation]), { error: display.text });
}

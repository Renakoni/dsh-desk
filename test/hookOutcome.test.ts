import { describe, it, expect } from "vitest";
import { hookOutcomeMessage, type HookOperationOutcome } from "../src/renderer/clawd-migrated/components/hooks/hookOutcome";

// A translate stub that returns the fallback verbatim; the wording is irrelevant
// to these assertions — what matters is whether a path/raw error appears.
const t = (_key: string, fallback: string) => fallback;

describe("hookOutcomeMessage: privacy is decided at render, not stored", () => {
  it("re-hides a raw error when hiding is enabled AFTER the failure was recorded", () => {
    // This is the P1 regression: the outcome is captured while hiding is off, then
    // rendered again once the user enables hiding — it must not leak the path.
    const outcome: HookOperationOutcome = {
      operation: "install",
      success: false,
      installed: false,
      status: null,
      error: "EACCES: could not write /secret/user/hook-forwarder.js"
    };

    const shown = hookOutcomeMessage(outcome, t, false);
    expect(shown).toContain("/secret/user");

    const hidden = hookOutcomeMessage(outcome, t, true);
    expect(hidden).not.toContain("/secret/user");
    expect(hidden).not.toContain("EACCES");
  });

  it("reveals a structured bundle path only when hiding is off", () => {
    const outcome: HookOperationOutcome = {
      operation: "install",
      success: false,
      installed: false,
      status: null,
      errorKind: "bundle-missing",
      bundlePath: "C:\\Users\\jane\\dsh-desk-plugin.tgz"
    };
    expect(hookOutcomeMessage(outcome, t, false)).toContain("C:\\Users\\jane\\dsh-desk-plugin.tgz");
    expect(hookOutcomeMessage(outcome, t, true)).not.toContain("Users\\jane");
  });

  it("renders success messages independent of the hide setting", () => {
    expect(hookOutcomeMessage({ operation: "install", success: true, installed: true, status: null }, t, true))
      .toBe("安装成功！重启 DSH 进程后生效。");
    expect(hookOutcomeMessage({ operation: "install", success: true, installed: false, status: null }, t, false))
      .toBe("安装完成，但仍有 DSH profile 未配置完整。");
    expect(hookOutcomeMessage({ operation: "remove", success: true, installed: false, status: null }, t, false))
      .toBe("已从 DSH profiles 移除插件。");
    expect(hookOutcomeMessage({ operation: "repair", success: true, installed: false, status: null }, t, false))
      .toBe("DSH 插件配置已修复。");
  });
});

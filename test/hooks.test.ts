import { describe, it, expect } from "vitest";
import { describeHookOperationError } from "../src/shared/hooks";

describe("describeHookOperationError", () => {
  it("hides the plugin bundle path when hiding is on, reveals it when off", () => {
    const res = { errorKind: "bundle-missing" as const, bundlePath: "C:\\Users\\jane\\dsh-desk-plugin.tgz", error: "Plugin bundle not found" };
    expect(describeHookOperationError(res, true)).toEqual({ kind: "bundle-missing" });
    expect(describeHookOperationError(res, false)).toEqual({ kind: "bundle-missing", path: "C:\\Users\\jane\\dsh-desk-plugin.tgz" });
  });

  it("never displays unknown error text (which may embed arbitrary absolute paths) when hiding", () => {
    // These roots are outside any path whitelist — the only safe answer is to hide.
    const res = { error: "EPERM writing /workspace/private/hook-forwarder.js and /nix/store/abc/x and /data/y" };
    const display = describeHookOperationError(res, true);
    expect(display).toEqual({ kind: "hidden" });
    expect(JSON.stringify(display)).not.toContain("/workspace");
    expect(JSON.stringify(display)).not.toContain("/nix");
  });

  it("shows the raw unknown error when hiding is off (useful for troubleshooting)", () => {
    expect(describeHookOperationError({ error: "EACCES: permission denied" }, false)).toEqual({ kind: "raw", text: "EACCES: permission denied" });
  });

  it("hides even a missing/empty result rather than showing nothing revealing", () => {
    expect(describeHookOperationError(undefined, true)).toEqual({ kind: "hidden" });
  });
});

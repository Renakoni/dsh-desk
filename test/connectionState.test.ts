import { describe, expect, it } from "vitest";
import { deriveConnectionState, isConnectionSurfaceVisible, resolveRecheck, type HookStatusInput } from "../src/renderer/clawd-migrated/features/overview/connectionState";

const healthyPlugin: HookStatusInput = {
  installed: true,
  hookCount: 2,
  requiredCount: 2,
  missingEvents: [],
  commandMatches: true,
  configReadError: false,
  bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: true },
  npxAvailable: true
};

describe("deriveConnectionState: DSH plugin modes", () => {
  it("loads before status arrives and reports fetch/config errors distinctly", () => {
    expect(deriveConnectionState(null, { serverListening: true }).mode).toBe("loading");
    expect(deriveConnectionState(healthyPlugin, { serverListening: true }, true).errorReason).toBe("check-failed");
    expect(deriveConnectionState({ ...healthyPlugin, configReadError: true }, { serverListening: true }).errorReason)
      .toBe("settings-unreadable");
  });

  it("uses onboarding only when neither DSH profile has the plugin", () => {
    const facts = deriveConnectionState({
      ...healthyPlugin,
      installed: false,
      hookCount: 0,
      missingEvents: ["web", "headless"],
      commandMatches: false
    }, { serverListening: true });
    expect(facts.mode).toBe("notConfigured");
  });

  it("keeps a partial profile installation in the repairable workbench", () => {
    const facts = deriveConnectionState({
      ...healthyPlugin,
      installed: false,
      hookCount: 1,
      missingEvents: ["headless"],
      commandMatches: false
    }, { serverListening: true });
    expect(facts.mode).toBe("workbench");
    expect(facts.configState).toBe("partial");
    expect(facts.canRepair).toBe(true);
  });
});

describe("deriveConnectionState: repair prerequisites", () => {
  const needsRepair: HookStatusInput = { ...healthyPlugin, installed: false, hookCount: 1, missingEvents: ["headless"], commandMatches: false };

  it("offers repair when the bundle and npx are available", () => {
    const facts = deriveConnectionState(needsRepair, { serverListening: true });
    expect(facts.needsHookRepair).toBe(true);
    expect(facts.canRepair).toBe(true);
  });

  it("does not offer repair for a listener-only failure", () => {
    const facts = deriveConnectionState(healthyPlugin, { serverListening: false });
    expect(facts.needsHookRepair).toBe(false);
    expect(facts.canRepair).toBe(false);
    expect(facts.listenerDown).toBe(true);
  });

  it("blocks repair when the bundled plugin or npx is missing", () => {
    const missingBundle = deriveConnectionState({
      ...needsRepair,
      bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: false }
    }, { serverListening: true });
    expect(missingBundle.bundleMissing).toBe(true);
    expect(missingBundle.canRepair).toBe(false);

    const missingNpx = deriveConnectionState({ ...needsRepair, npxAvailable: false }, { serverListening: true });
    expect(missingNpx.npxState).toBe("unavailable");
    expect(missingNpx.canRepair).toBe(false);
  });
});

describe("deriveConnectionState: listener and event history", () => {
  it("is healthy while listening even before the first event", () => {
    const facts = deriveConnectionState(healthyPlugin, { serverListening: true, lastEventAt: null });
    expect(facts.healthy).toBe(true);
    expect(facts.recentEventState).toBe("waiting");
  });

  it("does not use a past event as proof the listener is live", () => {
    const facts = deriveConnectionState(healthyPlugin, { serverListening: false, lastEventAt: 1_000 });
    expect(facts.healthy).toBe(false);
    expect(facts.listenerState).toBe("unavailable");
    expect(facts.recentEventState).toBe("healthy");
  });

  it("does not require the installer bundle after the plugin is active", () => {
    const facts = deriveConnectionState({
      ...healthyPlugin,
      bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: false }
    }, { serverListening: true });
    expect(facts.healthy).toBe(true);
  });
});

describe("isConnectionSurfaceVisible", () => {
  it("shows only on Overview and Settings General", () => {
    expect(isConnectionSurfaceVisible("general", "about")).toBe(true);
    expect(isConnectionSurfaceVisible("settings", "general")).toBe(true);
    expect(isConnectionSurfaceVisible("settings", "pet")).toBe(false);
    expect(isConnectionSurfaceVisible("data", "general")).toBe(false);
  });
});

describe("resolveRecheck", () => {
  const ok = (value: string) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<string>;
  const fail = () => ({ status: "rejected", reason: new Error("boom") }) as PromiseRejectedResult;

  it("applies fulfilled halves and reports any rejected half", () => {
    expect(resolveRecheck(ok("S"), ok("C"))).toEqual({ status: "S", connection: "C", error: false });
    expect(resolveRecheck(fail(), ok("C"))).toEqual({ status: undefined, connection: "C", error: true });
    expect(resolveRecheck(ok("S"), fail())).toEqual({ status: "S", connection: undefined, error: true });
    expect(resolveRecheck(fail(), fail())).toEqual({ status: undefined, connection: undefined, error: true });
  });
});

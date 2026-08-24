// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { HookStatus } from "../src/shared/hooks";
import { connectionSurfaceKey } from "../src/renderer/clawd-migrated/features/overview/connectionState";
import { useConnectionSurface } from "../src/renderer/clawd-migrated/features/overview/useConnectionSurface";
import { hookOutcomeMessage, type HookOperationOutcome } from "../src/renderer/clawd-migrated/components/hooks/hookOutcome";

// Regression harness for the connection-surface controller shared by the
// Overview card and Settings → General → Connection details. Navigation is
// driven through the REAL connectionSurfaceKey predicate, so a regression in
// either the predicate or the hook's effect wiring fails these tests.

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function status(marker: string): HookStatus {
  // settingsPath doubles as a marker so tests can tell WHICH request's result
  // ended up applied.
  return {
    installed: true,
    configExists: true,
    configReadError: false,
    hookCount: 2,
    requiredCount: 2,
    missingEvents: [],
    commandMatches: true,
    settingsPath: marker,
    bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: true },
    pnpmAvailable: true,
    profiles: ["web", "headless"].map(name => ({
      name: name as "web" | "headless",
      configExists: true,
      configReadError: false,
      dependencyRegistered: true,
      bundleRegistered: true,
      installed: true
    }))
  };
}

// Each navigation state is expressed as (section, subsection) and converted
// through the real predicate — exactly what main.tsx passes to the hook.
const OVERVIEW = connectionSurfaceKey("general", "general");
const SETTINGS_GENERAL = connectionSurfaceKey("settings", "general");
const SETTINGS_PET = connectionSurfaceKey("settings", "pet");
const SETTINGS_NOTIFICATIONS = connectionSurfaceKey("settings", "notifications");
const SETTINGS_ABOUT = connectionSurfaceKey("settings", "about");

function harness(initialKey: string | null) {
  const checks: Array<Deferred<HookStatus>> = [];
  const conns: Array<Deferred<{ serverListening: boolean }>> = [];
  const applied: Array<{ serverListening: boolean }> = [];
  const checkHooks = vi.fn(() => { const d = deferred<HookStatus>(); checks.push(d); return d.promise; });
  const getConnectionStatus = vi.fn(() => { const d = deferred<{ serverListening: boolean }>(); conns.push(d); return d.promise; });
  const view = renderHook(
    ({ surfaceKey }: { surfaceKey: string | null }) =>
      useConnectionSurface({ surfaceKey, checkHooks, getConnectionStatus, applyConnection: connection => applied.push(connection) }),
    { initialProps: { surfaceKey: initialKey } }
  );
  const settle = async (index: number, hookStatus: HookStatus, connection = { serverListening: true }) => {
    await act(async () => {
      checks[index].resolve(hookStatus);
      conns[index].resolve(connection);
    });
  };
  const fail = async (index: number) => {
    await act(async () => {
      checks[index].reject(new Error("boom"));
      conns[index].reject(new Error("boom"));
    });
  };
  const navigate = async (surfaceKey: string | null) => {
    await act(async () => { view.rerender({ surfaceKey }); });
  };
  return { view, checks, conns, applied, checkHooks, settle, fail, navigate };
}

describe("navigation: recheck exactly when a connection surface becomes visible", () => {
  it("rechecks on mounting the Overview and applies the settled chain", async () => {
    const h = harness(OVERVIEW);
    expect(h.checkHooks).toHaveBeenCalledTimes(1);
    expect(h.view.result.current.checking).toBe(true);

    await h.settle(0, status("initial"), { serverListening: true });
    expect(h.view.result.current.hookStatus?.settingsPath).toBe("initial");
    expect(h.view.result.current.checkError).toBe(false);
    expect(h.view.result.current.checking).toBe(false);
    expect(h.applied).toEqual([{ serverListening: true }]);
  });

  it("Settings/Pet → Settings/General triggers the authoritative recheck", async () => {
    const h = harness(SETTINGS_PET);
    expect(h.checkHooks).toHaveBeenCalledTimes(0);

    await h.navigate(SETTINGS_GENERAL);
    expect(h.checkHooks).toHaveBeenCalledTimes(1);
  });

  it("Overview → Settings/General rechecks again (distinct surface keys)", async () => {
    const h = harness(OVERVIEW);
    await h.settle(0, status("from-overview"));

    await h.navigate(SETTINGS_GENERAL);
    expect(h.checkHooks).toHaveBeenCalledTimes(2);
  });

  it("leaving for or moving between non-General subsections never rechecks", async () => {
    const h = harness(SETTINGS_GENERAL);
    await h.settle(0, status("initial"));
    expect(h.checkHooks).toHaveBeenCalledTimes(1);

    await h.navigate(SETTINGS_PET);          // Settings/General → Settings/Pet
    expect(h.checkHooks).toHaveBeenCalledTimes(1);

    await h.navigate(SETTINGS_ABOUT);        // Settings/Pet → Settings/About
    expect(h.checkHooks).toHaveBeenCalledTimes(1);

    await h.navigate(SETTINGS_NOTIFICATIONS);
    expect(h.checkHooks).toHaveBeenCalledTimes(1);
  });
});

describe("async ordering: the newest request owns the state", () => {
  it("a newer recheck result wins over an older request that resolves later", async () => {
    const h = harness(OVERVIEW); // request 0 pending
    await act(async () => { void h.view.result.current.recheck(); }); // request 1

    await h.settle(1, status("newer"));
    expect(h.view.result.current.hookStatus?.settingsPath).toBe("newer");
    expect(h.view.result.current.checking).toBe(false);

    // The OLDER request resolves afterwards with different data — it must be
    // discarded entirely (state, connection, checking).
    await h.settle(0, status("stale"), { serverListening: false });
    expect(h.view.result.current.hookStatus?.settingsPath).toBe("newer");
    expect(h.applied).toEqual([{ serverListening: true }]);
    expect(h.view.result.current.checkError).toBe(false);
  });

  it("an older failure does not overwrite a newer success", async () => {
    const h = harness(OVERVIEW); // request 0 pending (will fail)
    await act(async () => { void h.view.result.current.recheck(); }); // request 1

    await h.settle(1, status("good"));
    expect(h.view.result.current.checkError).toBe(false);

    await h.fail(0);
    expect(h.view.result.current.checkError).toBe(false);
    expect(h.view.result.current.hookStatus?.settingsPath).toBe("good");
    expect(h.view.result.current.checking).toBe(false);
  });

  it("a failed newest request sets the error; older in-flight data cannot clear it", async () => {
    const h = harness(OVERVIEW); // request 0 pending
    await act(async () => { void h.view.result.current.recheck(); }); // request 1

    await h.fail(1);
    expect(h.view.result.current.checkError).toBe(true);

    await h.settle(0, status("stale"));
    expect(h.view.result.current.checkError).toBe(true);
    expect(h.view.result.current.hookStatus).toBeNull();
  });
});

describe("action outcomes: preserved by their own recheck, cleared by any other", () => {
  const repairOutcome: HookOperationOutcome = {
    operation: "repair",
    success: true,
    installed: false,
    status: status("from-operation")
  };

  it("a completed operation applies its status, keeps its outcome, and triggers a newer authoritative recheck", async () => {
    const h = harness(OVERVIEW);
    await h.settle(0, status("initial"));

    await act(async () => { h.view.result.current.handleOperation(repairOutcome); });
    // Fresh status from the operation result applies immediately…
    expect(h.view.result.current.hookStatus?.settingsPath).toBe("from-operation");
    expect(h.view.result.current.actionOutcome).toEqual(repairOutcome);
    // …and a NEW full-chain recheck is already in flight.
    expect(h.checkHooks).toHaveBeenCalledTimes(2);

    await h.settle(1, status("post-action"));
    expect(h.view.result.current.hookStatus?.settingsPath).toBe("post-action");
    // The post-action recheck preserves the just-produced outcome.
    expect(h.view.result.current.actionOutcome).toEqual(repairOutcome);
  });

  it("a manual recheck clears historical action feedback", async () => {
    const h = harness(OVERVIEW);
    await h.settle(0, status("initial"));
    await act(async () => { h.view.result.current.handleOperation(repairOutcome); });
    await h.settle(1, status("post-action"));

    await act(async () => { void h.view.result.current.recheck(); });
    expect(h.view.result.current.actionOutcome).toBeNull();
  });

  it("a navigation-triggered recheck clears historical action feedback", async () => {
    const h = harness(OVERVIEW);
    await h.settle(0, status("initial"));
    await act(async () => { h.view.result.current.handleOperation(repairOutcome); });
    await h.settle(1, status("post-action"));
    expect(h.view.result.current.actionOutcome).toEqual(repairOutcome);

    await h.navigate(SETTINGS_GENERAL);
    expect(h.view.result.current.actionOutcome).toBeNull();
  });

  it("stores the STRUCTURED outcome so the message stays locale- and privacy-reactive at render time", async () => {
    const h = harness(OVERVIEW);
    await h.settle(0, status("initial"));

    const failure: HookOperationOutcome = {
      operation: "install",
      success: false,
      installed: false,
      status: null,
      error: "EACCES: could not write /secret/user/hook-forwarder.js"
    };
    await act(async () => { h.view.result.current.handleOperation(failure); });

    // The hook must store the structure, never a pre-rendered string…
    const stored = h.view.result.current.actionOutcome;
    expect(stored).toEqual(failure);

    // …so the SAME stored outcome renders differently as hide/locale change.
    const t = (_key: string, fallback: string) => fallback;
    expect(hookOutcomeMessage(stored!, t, false)).toContain("/secret/user");
    expect(hookOutcomeMessage(stored!, t, true)).not.toContain("/secret/user");
  });
});

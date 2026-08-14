import { describe, expect, it } from "vitest";
import { createTrayMenuController, type TrayMenuEffects } from "../src/main/trayMenuController";

// The tray popup's presentation state machine, exercised without Electron.
// Its whole reason to exist is surviving the open/dismiss/ready/paint races,
// so the tests drive those transitions and assert both the effects fired and
// the resulting state.

function makeController() {
  const calls: string[] = [];
  const effects: TrayMenuEffects = {
    present: () => calls.push("present"),
    reveal: () => calls.push("reveal"),
    conceal: () => calls.push("conceal"),
    clearPresentFallback: () => calls.push("clearPresentFallback"),
    clearBlurHide: () => calls.push("clearBlurHide")
  };
  return { controller: createTrayMenuController(effects), calls };
}

describe("createTrayMenuController", () => {
  it("queues a cold-start show until the renderer is ready, then presents and reveals", () => {
    const { controller, calls } = makeController();

    controller.requestShow();
    expect(controller.snapshot().showPending).toBe(true);
    expect(calls).not.toContain("present");

    controller.notifyRendererReady();
    expect(calls).toContain("present");
    expect(controller.snapshot()).toMatchObject({ showPending: false, presentPending: true, open: false });

    controller.onPresentSettled();
    expect(calls).toContain("reveal");
    expect(controller.snapshot()).toMatchObject({ presentPending: false, open: true });
  });

  it("REGRESSION: a dismissal before readiness cancels the queued cold-open", () => {
    // Right-click during cold start (queued), then a tray left-click dismisses
    // before the ready handshake. The handshake must NOT reopen the menu.
    const { controller, calls } = makeController();

    controller.requestShow();
    expect(controller.snapshot().showPending).toBe(true);

    controller.dismiss();
    expect(controller.snapshot().showPending).toBe(false);

    controller.notifyRendererReady();
    expect(calls).not.toContain("present");
    expect(calls).not.toContain("reveal");
    expect(controller.snapshot().open).toBe(false);
  });

  it("presents immediately when the renderer is already ready", () => {
    const { controller, calls } = makeController();
    controller.notifyRendererReady();

    controller.requestShow();
    expect(calls).toContain("present");
    expect(controller.snapshot()).toMatchObject({ showPending: false, presentPending: true });
  });

  it("a dismissal cancels an in-flight presentation so a late paint signal never reveals", () => {
    const { controller, calls } = makeController();
    controller.notifyRendererReady();
    controller.requestShow(); // present in flight, not yet revealed

    controller.dismiss();
    expect(calls).toContain("clearPresentFallback");
    expect(controller.snapshot().presentPending).toBe(false);

    controller.onPresentSettled(); // the late fallback / paint signal
    expect(calls).not.toContain("reveal");
    expect(controller.snapshot().open).toBe(false);
  });

  it("refreshes an already-open menu in place on reopen", () => {
    const { controller, calls } = makeController();
    controller.notifyRendererReady();
    controller.requestShow();
    controller.onPresentSettled();
    expect(controller.snapshot().open).toBe(true);

    controller.requestShow(); // right-click while open
    expect(calls.filter(call => call === "present")).toHaveLength(2);
    expect(controller.snapshot()).toMatchObject({ open: true, presentPending: true });

    controller.onPresentSettled();
    expect(calls.filter(call => call === "reveal")).toHaveLength(2);
  });

  it("conceals an open menu on dismissal", () => {
    const { controller, calls } = makeController();
    controller.notifyRendererReady();
    controller.requestShow();
    controller.onPresentSettled();

    controller.dismiss();
    expect(calls).toContain("conceal");
    expect(controller.snapshot().open).toBe(false);
  });

  it("ignores a settle with nothing pending", () => {
    const { controller, calls } = makeController();
    controller.onPresentSettled();
    expect(calls).not.toContain("reveal");
  });

  it("resets all state and cancels timers when the window is destroyed", () => {
    const { controller, calls } = makeController();
    controller.notifyRendererReady();
    controller.requestShow();
    controller.onPresentSettled();

    controller.reset();
    expect(calls).toContain("clearBlurHide");
    expect(calls).toContain("clearPresentFallback");
    expect(controller.snapshot()).toEqual({ rendererReady: false, showPending: false, presentPending: false, open: false });

    // After a reset the renderer must re-handshake before a show presents.
    controller.requestShow();
    expect(controller.snapshot().showPending).toBe(true);
  });

  it("re-queues after a reload invalidates the renderer subscription", () => {
    const { controller, calls } = makeController();
    controller.notifyRendererReady();
    controller.notifyReloading();

    controller.requestShow();
    expect(calls).not.toContain("present");
    expect(controller.snapshot().showPending).toBe(true);

    controller.notifyRendererReady();
    expect(calls).toContain("present");
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationRulesPanel } from "../src/renderer/clawd-migrated/components/NotificationRulesPanel";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultSettings } from "../src/renderer/shared/events";

beforeEach(() => {
  Reflect.set(window, "companion", {
    getDefaultSoundPaths: vi.fn(async () => ({ done: null, error: null, permission: null })),
    previewSound: vi.fn(async () => ({ ok: true, dataUrl: "data:audio/wav;base64,dGVzdA==" })),
    previewSoundFile: vi.fn(async () => ({ ok: true, dataUrl: "data:audio/wav;base64,dGVzdA==" }))
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("NotificationRulesPanel concurrent edits", () => {
  it("builds rapid rule and sound updates from the latest local snapshot", () => {
    const updateSettings = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <NotificationRulesPanel settings={structuredClone(defaultSettings)} updateSettings={updateSettings} />
      </I18nProvider>
    );

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[2]);
    fireEvent.click(switches[3]);
    const rules = updateSettings.mock.calls.at(-1)?.[0].notificationRules;
    expect(rules.find((rule: { eventType: string }) => rule.eventType === "done").playSound).toBe(false);
    expect(rules.find((rule: { eventType: string }) => rule.eventType === "error").playSound).toBe(false);

    fireEvent.click(switches[1]);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.2" } });
    expect(updateSettings.mock.calls.at(-1)?.[0].sound).toMatchObject({ enabled: false, volume: 0.2 });
  });

  it("stops sound previews and clears status timers on unmount", async () => {
    vi.useFakeTimers();
    const pause = vi.fn();
    const play = vi.fn(async () => undefined);
    vi.stubGlobal("Audio", class {
      volume = 1;
      currentTime = 0;
      pause = pause;
      play = play;
      addEventListener = vi.fn();
    });
    const view = render(
      <I18nProvider initialLocale="en">
        <NotificationRulesPanel settings={structuredClone(defaultSettings)} updateSettings={vi.fn()} />
      </I18nProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    view.unmount();

    expect(pause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("NotificationRulesPanel accessibility", () => {
  it("names each per-event sound switch so screen readers can tell them apart", () => {
    render(
      <I18nProvider initialLocale="en">
        <NotificationRulesPanel settings={structuredClone(defaultSettings)} updateSettings={vi.fn()} />
      </I18nProvider>
    );

    // The visibly-labelled toggles are named from their label via aria-labelledby...
    expect(screen.getByRole("switch", { name: "Windows notification" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Enable sound" })).toBeTruthy();
    // ...and the per-rule toggles (label="") are named by the explicit ariaLabel.
    expect(screen.getByRole("switch", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Error" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Permission request" })).toBeTruthy();

    // No switch should be left unnamed.
    for (const sw of screen.getAllByRole("switch")) {
      expect(sw.getAttribute("aria-label") || sw.getAttribute("aria-labelledby")).toBeTruthy();
    }
  });
});

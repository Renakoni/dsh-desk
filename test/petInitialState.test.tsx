// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { defaultSettings } from "../src/renderer/shared/events";
import { petPackThemeId } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
  vi.useRealTimers();
});

describe("floating pet initial state", () => {
  it("renders the persisted custom pet on the first frame, then starts background warmup", async () => {
    const pack = makePackManifest();
    const settings = { ...defaultSettings, petTheme: petPackThemeId(pack.id) };
    const notifyPetRendered = vi.fn();
    Reflect.set(window, "companion", {
      initialState: { settings, petPacks: [pack] },
      notifyPetRendered,
      getSettings: () => new Promise(() => {}),
      onSettings: vi.fn(() => vi.fn()),
      onPreviewPetAnimation: vi.fn(() => vi.fn())
    });

    render(<App />);

    expect(screen.getByRole("img").getAttribute("style")).toContain("pet-asset://");
    await waitFor(() => expect(notifyPetRendered).toHaveBeenCalledOnce());
  });

  it("pauses idle rotation during a preview and selects again when it ends", () => {
    vi.useFakeTimers();
    const settings = {
      ...defaultSettings,
      idleAnim: {
        enabled: true,
        selectedSprites: ["extra_action_7"],
        intervalMin: 5,
        intervalMax: 5
      }
    };
    let previewListener: ((animationKey: string) => void) | null = null;
    Reflect.set(window, "companion", {
      initialState: { settings, petPacks: [] },
      getSettings: () => new Promise(() => {}),
      onSettings: vi.fn(() => vi.fn()),
      onPreviewPetAnimation: vi.fn(callback => {
        previewListener = callback;
        return vi.fn();
      })
    });

    render(<App />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("extra_action_7");

    act(() => { previewListener?.("extra_action_8"); });
    expect(screen.getByRole("img").getAttribute("alt")).toBe("extra_action_8");
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole("img").getAttribute("alt")).toBe("extra_action_8");

    act(() => { previewListener?.("__clear_preview"); });
    expect(screen.getByRole("img").getAttribute("alt")).toBe("extra_action_7");
  });

  it("pauses idle rotation while an imported pet is being dragged", () => {
    vi.useFakeTimers();
    const pack = makePackManifest();
    const settings = {
      ...defaultSettings,
      petTheme: petPackThemeId(pack.id),
      idleAnim: {
        enabled: true,
        selectedSprites: ["waving"],
        intervalMin: 5,
        intervalMax: 5
      }
    };
    let dragListener: ((direction: "left" | "right" | null) => void) | null = null;
    Reflect.set(window, "companion", {
      initialState: { settings, petPacks: [pack] },
      getSettings: () => new Promise(() => {}),
      onSettings: vi.fn(() => vi.fn()),
      onPreviewPetAnimation: vi.fn(() => vi.fn()),
      onPetDragDirection: vi.fn(callback => {
        dragListener = callback;
        return vi.fn();
      })
    });

    render(<App />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("waving");

    act(() => { dragListener?.("right"); });
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("running_right");
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("running_right");

    act(() => { dragListener?.(null); });
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("waving");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationSection } from "../src/renderer/clawd-migrated/features/animation/AnimationSection";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultSettings } from "../src/renderer/shared/events";
import { catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

const packCatalog = catalogFromPetPack(makePackManifest());

const settings = {
  ...defaultSettings,
  idleAnim: { enabled: true, selectedSprites: ["idle"], intervalMin: 10, intervalMax: 20, repeatMin: 1, repeatMax: 2 },
  stateAnimations: {}
};

function renderSection(locale: "en" | "zh", active = true) {
  return render(
    <I18nProvider initialLocale={locale}>
      <AnimationSection active={active} settings={settings} updateSettings={vi.fn()} catalog={packCatalog} spritesheet={null} />
    </I18nProvider>
  );
}

beforeEach(() => {
  Reflect.set(window, "companion", { previewPetAnimation: vi.fn(async () => true) });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

describe("imported-theme Animation page localization", () => {
  it("renders English copy end to end under the English locale", () => {
    const view = renderSection("en");
    expect(screen.getByText("Pool")).toBeTruthy();
    expect(screen.getByText("Stop preview")).toBeTruthy();
    // The imported catalog's dedicated error mapping row.
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("Error and failure events")).toBeTruthy();
    // Pack vocabulary labels resolve to real English entries.
    expect(screen.getAllByText("Run right").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dejected").length).toBeGreaterThan(0);
    // Drag-only locomotion rows appear in the Animation Test grid only —
    // the idle pool never offers them as standalone actions.
    const poolGrid = view.container.querySelector(".idle-sprite-grid:not(.animation-test-grid)");
    expect(poolGrid?.textContent).not.toContain("Run right");
    expect(poolGrid?.textContent).toContain("Waving");
    const testGrid = view.container.querySelector(".animation-test-grid");
    expect(testGrid?.textContent).toContain("Run right");
    expect(testGrid?.textContent).toContain("Run left");
  });

  it("renders Chinese copy under the Chinese locale", () => {
    renderSection("zh");
    expect(screen.getByText("动画池")).toBeTruthy();
    expect(screen.getByText("停止测试")).toBeTruthy();
    expect(screen.getByText("运行出错")).toBeTruthy();
    expect(screen.getAllByText("向右跑").length).toBeGreaterThan(0);
  });

  it("clears a test animation when the page unmounts", () => {
    const view = renderSection("en");
    const testButton = view.container.querySelector<HTMLButtonElement>(".animation-test-grid button");
    expect(testButton).toBeTruthy();
    fireEvent.click(testButton!);
    expect(window.companion.previewPetAnimation).toHaveBeenCalledWith(expect.not.stringMatching("__clear_preview"));

    view.unmount();

    expect(window.companion.previewPetAnimation).toHaveBeenLastCalledWith("__clear_preview");
  });

  it("clears a test animation when the retained page becomes hidden", () => {
    const view = renderSection("en");
    const testButton = view.container.querySelector<HTMLButtonElement>(".animation-test-grid button");
    fireEvent.click(testButton!);

    view.rerender(
      <I18nProvider initialLocale="en">
        <AnimationSection active={false} settings={settings} updateSettings={vi.fn()} catalog={packCatalog} spritesheet={null} />
      </I18nProvider>
    );

    expect(window.companion.previewPetAnimation).toHaveBeenLastCalledWith("__clear_preview");
  });

  it("aligns range fills to the slider thumb travel area", () => {
    const view = renderSection("en");
    const tracks = view.container.querySelectorAll<HTMLElement>(".range-track");
    const repeatTrack = tracks[1];

    expect(repeatTrack.style.getPropertyValue("--range-left")).toBe("0%");
    expect(repeatTrack.style.getPropertyValue("--range-width")).toBe("25%");
    expect(repeatTrack.querySelector(".range-fill-boundary > .range-fill")).toBeTruthy();
  });
});

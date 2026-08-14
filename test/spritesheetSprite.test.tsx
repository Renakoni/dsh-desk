// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpritesheetSprite } from "../src/renderer/components/SpritesheetSprite";
import { spriteFramePosition } from "../src/shared/spriteFrame";

const SHEET = {
  sheetUrl: "pet-asset://packs/yuexinmiao/spritesheet.webp",
  columns: 8,
  rows: 9,
  width: 192,
  height: 208
};

function expectedPosition(column: number, row: number): string {
  const position = spriteFramePosition(column, row, SHEET.columns, SHEET.rows);
  return `${position.xPercent}% ${position.yPercent}%`;
}

function spriteStyle(): CSSStyleDeclaration {
  return (screen.getByRole("img") as HTMLElement).style;
}

// Controllable matchMedia stub with change-event support; jsdom has none.
type MediaQueryChangeListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<MediaQueryChangeListener>();
  let matches = initialMatches;
  const mediaQueryList = {
    get matches() { return matches; },
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener(_type: string, listener: MediaQueryChangeListener) { listeners.add(listener); },
    removeEventListener(_type: string, listener: MediaQueryChangeListener) { listeners.delete(listener); },
    addListener(listener: MediaQueryChangeListener) { listeners.add(listener); },
    removeListener(listener: MediaQueryChangeListener) { listeners.delete(listener); },
    dispatchEvent() { return true; }
  } as unknown as MediaQueryList;
  window.matchMedia = () => mediaQueryList;
  return {
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next, media: "(prefers-reduced-motion: reduce)" } as MediaQueryListEvent;
      listeners.forEach(listener => listener(event));
    }
  };
}

// Controllable Image stub so sheet load success/failure is deterministic.
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    FakeImage.instances.push(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeImage.instances = [];
  Reflect.deleteProperty(window, "matchMedia");
});

describe("SpritesheetSprite", () => {
  it("renders frame 0 of the requested row with the sheet mapped onto one cell", () => {
    render(<SpritesheetSprite {...SHEET} row={6} frameCount={8} frameDurationMs={160} alt="waiting_permission" />);
    const style = spriteStyle();
    expect(style.backgroundImage).toContain(SHEET.sheetUrl);
    expect(style.backgroundSize).toBe("800% 900%");
    expect(style.backgroundPosition).toBe(expectedPosition(0, 6));
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("waiting_permission");
  });

  it("steps frames on the configured interval and wraps at the row's frame count", () => {
    render(<SpritesheetSprite {...SHEET} row={0} frameCount={3} frameDurationMs={160} alt="idle" />);

    act(() => vi.advanceTimersByTime(160));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(1, 0));

    act(() => vi.advanceTimersByTime(160));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(2, 0));

    // Wraps back to the first frame instead of sliding into unused cells.
    act(() => vi.advanceTimersByTime(160));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 0));
  });

  it("honors a per-pack frame duration override", () => {
    render(<SpritesheetSprite {...SHEET} row={1} frameCount={8} frameDurationMs={500} alt="running_right" />);

    act(() => vi.advanceTimersByTime(480));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 1));

    act(() => vi.advanceTimersByTime(20));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(1, 1));
  });

  it("stays static for single-frame rows", () => {
    render(<SpritesheetSprite {...SHEET} row={3} frameCount={1} frameDurationMs={160} alt="waving" />);
    act(() => vi.advanceTimersByTime(2000));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 3));
  });

  it("restarts from frame 0 when the animation row changes", () => {
    const { rerender } = render(<SpritesheetSprite {...SHEET} row={0} frameCount={6} frameDurationMs={160} alt="idle" />);
    act(() => vi.advanceTimersByTime(320));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(2, 0));

    rerender(<SpritesheetSprite {...SHEET} row={7} frameCount={8} frameDurationMs={160} alt="running" />);
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 7));

    act(() => vi.advanceTimersByTime(160));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(1, 7));
  });
});

describe("SpritesheetSprite reduced motion", () => {
  it("stays on frame 0 while reduced motion is preferred", () => {
    installMatchMedia(true);
    render(<SpritesheetSprite {...SHEET} row={0} frameCount={6} frameDurationMs={160} alt="idle" />);
    act(() => vi.advanceTimersByTime(2000));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 0));
  });

  it("still advances frames when reduced motion is not preferred", () => {
    installMatchMedia(false);
    render(<SpritesheetSprite {...SHEET} row={0} frameCount={6} frameDurationMs={160} alt="idle" />);
    act(() => vi.advanceTimersByTime(160));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(1, 0));
  });

  it("stops and restarts playback when the preference changes while mounted", () => {
    const media = installMatchMedia(false);
    render(<SpritesheetSprite {...SHEET} row={0} frameCount={6} frameDurationMs={160} alt="idle" />);
    act(() => vi.advanceTimersByTime(320));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(2, 0));

    // Turning reduction ON resets to frame 0 and freezes.
    act(() => media.setMatches(true));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 0));
    act(() => vi.advanceTimersByTime(2000));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(0, 0));

    // Turning it back OFF resumes playback from frame 0.
    act(() => media.setMatches(false));
    act(() => vi.advanceTimersByTime(160));
    expect(spriteStyle().backgroundPosition).toBe(expectedPosition(1, 0));
  });
});

describe("SpritesheetSprite sheet load failure", () => {
  it("keeps the layout box while loading and swaps to the single fallback image on error", () => {
    vi.stubGlobal("Image", FakeImage);
    render(<SpritesheetSprite {...SHEET} row={0} frameCount={6} frameDurationMs={160} alt="idle" errorFallbackUrl="builtin-idle.png" />);

    // Still loading: the sprite box is present with its dimensions intact.
    let sprite = screen.getByRole("img") as HTMLElement;
    expect(sprite.style.width).toBe("192px");
    expect(sprite.style.height).toBe("208px");

    const image = FakeImage.instances.at(-1);
    expect(image).toBeDefined();
    act(() => { image?.onerror?.(); });

    // The pet is never blank: the explicit fallback replaces the sheet at
    // the same dimensions.
    const fallback = screen.getByRole("img") as HTMLImageElement;
    expect(fallback.tagName).toBe("IMG");
    expect(fallback.getAttribute("src")).toBe("builtin-idle.png");
    expect(fallback.style.width).toBe("192px");
    expect(fallback.style.height).toBe("208px");

    // Playback stops with the fallback showing: no interval is left ticking.
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect((screen.getByRole("img") as HTMLImageElement).getAttribute("src")).toBe("builtin-idle.png");
  });

  it("keeps playing the sheet when it loads successfully", () => {
    vi.stubGlobal("Image", FakeImage);
    render(<SpritesheetSprite {...SHEET} row={0} frameCount={6} frameDurationMs={160} alt="idle" errorFallbackUrl="builtin-idle.png" />);

    const image = FakeImage.instances.at(-1);
    act(() => { image?.onload?.(); });

    act(() => vi.advanceTimersByTime(160));
    const sprite = screen.getByRole("img") as HTMLElement;
    expect(sprite.tagName).toBe("DIV");
    expect(sprite.style.backgroundPosition).toBe(expectedPosition(1, 0));
  });
});

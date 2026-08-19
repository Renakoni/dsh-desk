import { afterEach, describe, expect, it, vi } from "vitest";
import { createPetLookWatcher, PET_LOOK_SAMPLE_MS } from "../src/main/petLookWatcher";

afterEach(() => vi.useRealTimers());

describe("pet look watcher", () => {
  it("reports cursor points relative to the native pet window", () => {
    vi.useFakeTimers();
    let cursor = { x: 460, y: 380 };
    let bounds = { x: 300, y: 200, width: 240, height: 260 };
    const onPoint = vi.fn();
    const watcher = createPetLookWatcher({
      readCursor: () => cursor,
      readWindowBounds: () => bounds,
      onPoint
    });

    watcher.setEnabled(true);
    expect(onPoint).toHaveBeenLastCalledWith({ x: 160, y: 180 });

    cursor = { x: 500, y: 420 };
    vi.advanceTimersByTime(PET_LOOK_SAMPLE_MS);
    expect(onPoint).toHaveBeenLastCalledWith({ x: 200, y: 220 });

    bounds = { ...bounds, x: 320 };
    vi.advanceTimersByTime(PET_LOOK_SAMPLE_MS);
    expect(onPoint).toHaveBeenLastCalledWith({ x: 180, y: 220 });

    watcher.dispose();
  });

  it("samples only while enabled and skips duplicate points", () => {
    vi.useFakeTimers();
    const onPoint = vi.fn();
    const watcher = createPetLookWatcher({
      readCursor: () => ({ x: 30, y: 40 }),
      readWindowBounds: () => ({ x: 10, y: 10, width: 100, height: 100 }),
      onPoint
    });

    watcher.setEnabled(true);
    vi.advanceTimersByTime(PET_LOOK_SAMPLE_MS * 3);
    expect(onPoint).toHaveBeenCalledTimes(1);

    watcher.setEnabled(false);
    vi.advanceTimersByTime(PET_LOOK_SAMPLE_MS * 3);
    expect(onPoint).toHaveBeenCalledTimes(1);
  });
});

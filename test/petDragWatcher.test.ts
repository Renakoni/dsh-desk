import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_END_FALLBACK_MS, createPetDragWatcher } from "../src/main/petDragWatcher";
import type { DragDirection } from "../src/shared/petDrag";

// The watcher turns the pet window's native-drag move stream into walk
// directions. The regressions it guards: spurious walks from programmatic
// repositions, duplicate emissions, and a missed `moved` event leaving the
// pet walking in place forever.

function makeWatcher(endFallbackMs?: number) {
  const emitted: Array<DragDirection | null> = [];
  const watcher = createPetDragWatcher({
    initial: { x: 100, y: 100 },
    onDirection: direction => emitted.push(direction),
    endFallbackMs
  });
  return { watcher, emitted };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPetDragWatcher", () => {
  it("emits the walk direction from window movement, only on change", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(106, 100); // +6px right
    watcher.onMove(114, 101); // still right — no duplicate emission
    watcher.onMove(108, 101); // -6px: flips left
    expect(emitted).toEqual(["right", "left"]);
  });

  it("holds the direction through sub-threshold and vertical movement", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(110, 100); // right
    watcher.onMove(112, 100); // +2px: under threshold, hold
    watcher.onMove(113, 130); // vertical sample, tiny horizontal: hold
    expect(emitted).toEqual(["right"]);
  });

  it("ends the gesture on the moved event, emitting null exactly once", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(110, 100);
    watcher.onMoveEnd();
    watcher.onMoveEnd(); // idempotent — no second null
    expect(emitted).toEqual(["right", null]);
  });

  it("does not emit for gestures that never picked a direction", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(102, 100);
    watcher.onMoveEnd();
    expect(emitted).toEqual([]);
  });

  it("falls back to ending the gesture when no move arrives for the timeout", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(110, 100);
    vi.advanceTimersByTime(DRAG_END_FALLBACK_MS - 1);
    expect(emitted).toEqual(["right"]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual(["right", null]);
    watcher.onMoveEnd(); // already ended — still no duplicate
    expect(emitted).toEqual(["right", null]);
  });

  it("keeps the fallback alive while movement continues", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(110, 100);
    for (let step = 1; step <= 5; step++) {
      vi.advanceTimersByTime(DRAG_END_FALLBACK_MS - 100);
      watcher.onMove(110 + step * 6, 100);
    }
    expect(emitted).toEqual(["right"]);
  });

  it("swallows programmatic repositions and re-anchors instead of walking", () => {
    const { watcher, emitted } = makeWatcher();
    // Bubble expansion / show(): a large jump that is NOT a user drag.
    watcher.noteProgrammaticMove();
    watcher.onMove(600, 300);
    expect(emitted).toEqual([]);
    // Tracking is re-anchored at the new position: small real moves from
    // there compute small deltas, not a delta from the pre-jump position.
    watcher.onMove(601, 300); // consumed by the second skip sample
    watcher.onMove(603, 300); // +2px: under threshold
    expect(emitted).toEqual([]);
    watcher.onMove(609, 300); // +6px: a real drag begins
    expect(emitted).toEqual(["right"]);
  });

  it("dispose cancels the pending fallback", () => {
    const { watcher, emitted } = makeWatcher();
    watcher.onMove(110, 100);
    watcher.dispose();
    vi.advanceTimersByTime(DRAG_END_FALLBACK_MS * 2);
    expect(emitted).toEqual(["right"]);
  });
});

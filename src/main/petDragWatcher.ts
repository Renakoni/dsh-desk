import { nextDragDirection, type DragDirection } from "../shared/petDrag";

// Walk-direction tracking for native OS window drags.
//
// The OS owns the movement itself (-webkit-app-region: drag on the pet
// element) — the compositor moves the window at input rate, which no
// app-driven loop can match, and no pointer capture exists to corrupt.
// Main only watches the window's `move` stream, derives the horizontal
// direction with the reference player's threshold, and reports changes.
// The `moved` event (native move loop exited) ends the gesture; the idle
// fallback below is the safety net so a missed end event can never leave
// the pet walking in place forever.

/** Gesture is considered over after this long without any move event. */
export const DRAG_END_FALLBACK_MS = 2000;

// One programmatic reposition usually emits a single move event; skipping
// two costs at most one extra 4px sample at the start of the next real drag.
const PROGRAMMATIC_MOVE_SKIP = 2;

export interface PetDragWatcher {
  /** Feed a window `move` event (current window position, DIPs). */
  onMove(x: number, y: number): void;
  /** Feed the window `moved` event — the native move loop ended. */
  onMoveEnd(): void;
  /** Call before repositioning the window from code (bubble expansion): the
   *  resulting move events re-anchor the tracker but never emit a walk. */
  noteProgrammaticMove(): void;
  dispose(): void;
}

export function createPetDragWatcher(options: {
  initial: { x: number; y: number };
  onDirection: (direction: DragDirection | null) => void;
  endFallbackMs?: number;
}): PetDragWatcher {
  const endFallbackMs = options.endFallbackMs ?? DRAG_END_FALLBACK_MS;
  let last = { ...options.initial };
  let direction: DragDirection | null = null;
  let skipSamples = 0;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  function clearEndTimer() {
    if (endTimer !== null) {
      clearTimeout(endTimer);
      endTimer = null;
    }
  }

  function endGesture() {
    clearEndTimer();
    if (direction !== null) {
      direction = null;
      options.onDirection(null);
    }
  }

  return {
    onMove(x, y) {
      const deltaX = x - last.x;
      const deltaY = y - last.y;
      last = { x, y };
      if (skipSamples > 0) {
        skipSamples -= 1;
        return;
      }
      const next = nextDragDirection(direction, deltaX, deltaY);
      if (next !== direction) {
        direction = next;
        options.onDirection(next);
      }
      clearEndTimer();
      if (direction !== null) endTimer = setTimeout(endGesture, endFallbackMs);
    },
    onMoveEnd: endGesture,
    noteProgrammaticMove() {
      skipSamples = PROGRAMMATIC_MOVE_SKIP;
    },
    dispose: clearEndTimer
  };
}

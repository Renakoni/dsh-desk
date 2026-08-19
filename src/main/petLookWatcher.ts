export interface PetLookPoint {
  x: number;
  y: number;
}

interface PetLookBounds extends PetLookPoint {
  width: number;
  height: number;
}

export const PET_LOOK_SAMPLE_MS = 50;

export interface PetLookWatcher {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/**
 * Poll Electron's global cursor position while v2 look is active. Native
 * app-region drag areas do not emit renderer pointer events, so main is the
 * only reliable source for points over the pet itself.
 */
export function createPetLookWatcher(options: {
  readCursor: () => PetLookPoint;
  readWindowBounds: () => PetLookBounds | null;
  onPoint: (point: PetLookPoint) => void;
  sampleMs?: number;
}): PetLookWatcher {
  const sampleMs = options.sampleMs ?? PET_LOOK_SAMPLE_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let previous: PetLookPoint | null = null;

  function sample() {
    const bounds = options.readWindowBounds();
    if (!bounds) return;
    const cursor = options.readCursor();
    const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (previous?.x === point.x && previous.y === point.y) return;
    previous = point;
    options.onPoint(point);
  }

  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    previous = null;
  }

  return {
    setEnabled(enabled) {
      if (!enabled) {
        stop();
        return;
      }
      if (timer !== null) return;
      sample();
      timer = setInterval(sample, Math.max(16, sampleMs));
    },
    dispose: stop
  };
}

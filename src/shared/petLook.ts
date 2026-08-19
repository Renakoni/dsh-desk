/** Legacy v2 pointer-look target. The current Desk runtime does not produce it. */
export type PetLookTarget = "neutral" | number | null;

export interface PetLookRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PetLookFrame {
  row: number;
  column: number;
}

const LOOK_DIRECTION_COUNT = 16;
const LOOK_DIRECTION_STEP = Math.PI * 2 / LOOK_DIRECTION_COUNT;
const DIRECTION_HYSTERESIS = LOOK_DIRECTION_STEP * 0.15;

function circularDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % (Math.PI * 2);
  return Math.min(distance, Math.PI * 2 - distance);
}

/**
 * Map a pointer vector to v2's 16 clockwise directions; direction 0 is up.
 * The previous target adds hysteresis at both the center and sector borders,
 * preventing tiny cursor/window movements from alternating adjacent frames.
 *
 * @deprecated Kept as a legacy integration helper. Desk does not invoke it in
 * the default desktop runtime or expose it in the current UI.
 */
export function lookTargetForPointer(clientX: number, clientY: number, rect: PetLookRect, previous: PetLookTarget = null): PetLookTarget {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || rect.width <= 0 || rect.height <= 0) return null;
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const size = Math.min(rect.width, rect.height);
  const distance = Math.hypot(dx, dy);
  const centerEnterRadius = Math.max(8, size * 0.13);
  const centerExitRadius = Math.max(14, size * 0.2);

  if (previous === "neutral" && distance <= centerExitRadius) return "neutral";
  if (distance <= centerEnterRadius) return "neutral";
  if (typeof previous === "number" && distance < centerExitRadius) return previous;

  const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
  const candidate = Math.round(angle / LOOK_DIRECTION_STEP) % LOOK_DIRECTION_COUNT;
  if (typeof previous === "number" && candidate !== previous) {
    const previousCenter = previous * LOOK_DIRECTION_STEP;
    if (circularDistance(angle, previousCenter) <= LOOK_DIRECTION_STEP / 2 + DIRECTION_HYSTERESIS) {
      return previous;
    }
  }
  return candidate;
}

export function lookFrameForTarget(target: PetLookTarget, startRow = 9, columns = 8, neutralFrame: PetLookFrame = { row: 0, column: 6 }): PetLookFrame | null {
  if (target === null) return null;
  if (target === "neutral") return neutralFrame;
  const direction = Math.max(0, Math.min(15, Math.trunc(target)));
  return { row: startRow + Math.floor(direction / columns), column: direction % columns };
}

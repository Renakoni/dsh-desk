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

/** Map a pointer vector to v2's 16 clockwise directions; direction 0 is up. */
export function lookTargetForPointer(clientX: number, clientY: number, rect: PetLookRect): PetLookTarget {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || rect.width <= 0 || rect.height <= 0) return null;
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const deadzone = Math.max(8, Math.min(rect.width, rect.height) * 0.16);
  if (Math.hypot(dx, dy) <= deadzone) return "neutral";
  const clockwiseDegrees = Math.atan2(dx, -dy) * 180 / Math.PI;
  return Math.round((clockwiseDegrees + 360) / 22.5) % 16;
}

export function lookFrameForTarget(target: PetLookTarget, startRow = 9, columns = 8, neutralFrame: PetLookFrame = { row: 0, column: 6 }): PetLookFrame | null {
  if (target === null) return null;
  if (target === "neutral") return neutralFrame;
  const direction = Math.max(0, Math.min(15, Math.trunc(target)));
  return { row: startRow + Math.floor(direction / columns), column: direction % columns };
}

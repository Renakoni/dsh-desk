// Placement for the custom tray popup. The window holds the main menu column
// plus a submenu column beside it (Switch pet flyout); it is sized to contain
// both, positioned so the main menu sits above the cursor, and the submenu
// opens to whichever horizontal side has room — for a bottom-right tray that
// is almost always the left. Exact pixels aren't load-bearing: the renderer
// lays the cards out with flexbox inside the (possibly larger) window and the
// spare area is transparent + dismiss-on-click.

export interface TrayMenuPoint {
  x: number;
  y: number;
}

export interface TrayMenuWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrayMenuMetrics {
  /** Width of the main menu column. */
  mainWidth: number;
  /** Width of the submenu column beside it. */
  submenuWidth: number;
  /** Window height (holds the main menu; the submenu scrolls within it). */
  height: number;
}

export type TraySubmenuSide = "left" | "right";

export interface TrayMenuLayoutResult {
  bounds: { x: number; y: number; width: number; height: number };
  submenuSide: TraySubmenuSide;
}

const EDGE_MARGIN_PX = 4;

function clamp(value: number, min: number, max: number): number {
  // When the window is wider/taller than the work area (max < min), min wins,
  // so the top-left stays on-screen rather than being pushed off the leading
  // edge (plain Math.min(Math.max(...)) would return max, i.e. negative).
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** Whether a screen point lies inside a bounds rect (empty rects match nothing). */
export function pointInBounds(point: TrayMenuPoint, bounds: TrayMenuWorkArea): boolean {
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

/**
 * Window bounds + the side the submenu opens on. The main menu column is
 * centered on the cursor horizontally and sits just above it; the submenu
 * takes the free side, flipping to the left when the right would overflow the
 * work area (the usual case near a bottom-right tray). The whole window is
 * then clamped on-screen.
 */
export function trayMenuLayout(
  cursor: TrayMenuPoint,
  metrics: TrayMenuMetrics,
  workArea: TrayMenuWorkArea
): TrayMenuLayoutResult {
  const width = metrics.mainWidth + metrics.submenuWidth;
  const height = metrics.height;

  const mainLeftIfRight = cursor.x - metrics.mainWidth / 2;
  const fitsRight = mainLeftIfRight + metrics.mainWidth + metrics.submenuWidth
    <= workArea.x + workArea.width - EDGE_MARGIN_PX;
  const submenuSide: TraySubmenuSide = fitsRight ? "right" : "left";

  // Keep the main menu column centered on the cursor; the submenu extends to
  // its chosen side, so a left-side submenu shifts the window origin left.
  const rawX = submenuSide === "right"
    ? cursor.x - metrics.mainWidth / 2
    : cursor.x - metrics.mainWidth / 2 - metrics.submenuWidth;

  const x = clamp(rawX, workArea.x + EDGE_MARGIN_PX, workArea.x + workArea.width - width - EDGE_MARGIN_PX);
  const y = clamp(
    cursor.y - EDGE_MARGIN_PX - height,
    workArea.y + EDGE_MARGIN_PX,
    workArea.y + workArea.height - height - EDGE_MARGIN_PX
  );

  return { bounds: { x: Math.round(x), y: Math.round(y), width, height }, submenuSide };
}

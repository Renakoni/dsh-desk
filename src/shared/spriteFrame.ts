/**
 * Pure frame math for spritesheet playback.
 *
 * A sprite renders one cell of the sheet by using percentage background
 * positioning: with background-size set to (columns*100)% x (rows*100)%, the
 * alignment point for column c is c * 100/(columns-1) percent — fully
 * display-size independent, so the same math serves the pet window and any
 * preview regardless of how large the cell is drawn.
 */

export interface SpriteFramePosition {
  xPercent: number;
  yPercent: number;
}

/** Background-position percentages that show cell (column, row). */
export function spriteFramePosition(column: number, row: number, columns: number, rows: number): SpriteFramePosition {
  return {
    xPercent: columns > 1 ? (column * 100) / (columns - 1) : 0,
    yPercent: rows > 1 ? (row * 100) / (rows - 1) : 0
  };
}

/** background-size that maps one cell onto the full container. */
export function spriteBackgroundSize(columns: number, rows: number): string {
  return `${columns * 100}% ${rows * 100}%`;
}

/** Advance a looping animation by one frame. */
export function nextSpriteFrame(current: number, frameCount: number): number {
  return frameCount > 0 ? (current + 1) % frameCount : 0;
}

/**
 * Height a sprite cell occupies when drawn at displayWidth, preserving the
 * cell's aspect ratio (codex-pet cells are 192x208 — taller than square).
 */
export function displayedSpriteHeight(cellWidth: number, cellHeight: number, displayWidth: number): number {
  return Math.round((cellHeight * displayWidth) / cellWidth);
}

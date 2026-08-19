/**
 * Per-row visible-frame detection for codex-pet spritesheets.
 *
 * The format's convention is "used cells are non-empty and unused cells are
 * fully transparent", with variable frame counts per row. This scan runs on
 * decoded RGBA pixels (the renderer decodes with Chromium — the same decoder
 * that will display the pet) and reports row playback counts plus exact cell
 * visibility for v2's 16-direction look grid.
 */

import type { SheetGeometry } from "./petPack";

export interface RgbaImageLike {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major — the ImageData layout. */
  data: Uint8Array | Uint8ClampedArray;
}

/**
 * Alpha at or above this counts as visible. Small but nonzero so stray
 * near-transparent residue in "empty" cells does not extend an animation.
 */
export const VISIBLE_ALPHA_THRESHOLD = 8;

export interface PetPackScanResult {
  rowFrameCounts: number[];
  /** Bit mask of visible cells, least-significant bit is column 0. */
  visibleCellMasks: number[];
}

function cellHasVisiblePixel(image: RgbaImageLike, geometry: SheetGeometry, row: number, column: number): boolean {
  const startX = column * geometry.cellWidth;
  const startY = row * geometry.cellHeight;
  for (let y = startY; y < startY + geometry.cellHeight; y++) {
    const rowOffset = y * image.width;
    for (let x = startX; x < startX + geometry.cellWidth; x++) {
      if (image.data[(rowOffset + x) * 4 + 3] >= VISIBLE_ALPHA_THRESHOLD) return true;
    }
  }
  return false;
}

/**
 * Count playable frames per row: the last visible cell index plus one, so a
 * malformed gap mid-row never truncates the animation. Fully empty rows
 * report 0. Throws when the pixel buffer does not match the geometry — both
 * derive from the same file, so a mismatch is a caller bug.
 */
export function scanRowFrameCounts(image: RgbaImageLike, geometry: SheetGeometry): number[] {
  return scanPetPackSheet(image, geometry).rowFrameCounts;
}

/** Scan row counts and the per-cell visibility needed by v2's look grid. */
export function scanPetPackSheet(image: RgbaImageLike, geometry: SheetGeometry): PetPackScanResult {
  if (image.width !== geometry.width || image.height !== geometry.height) {
    throw new Error(`spritesheet pixels are ${image.width}x${image.height} but geometry says ${geometry.width}x${geometry.height}`);
  }
  if (image.data.length < image.width * image.height * 4) {
    throw new Error("spritesheet pixel buffer is shorter than width*height*4");
  }

  const counts: number[] = [];
  const visibleCellMasks: number[] = [];
  for (let row = 0; row < geometry.rows; row++) {
    let lastVisible = -1;
    let mask = 0;
    for (let column = 0; column < geometry.columns; column++) {
      if (cellHasVisiblePixel(image, geometry, row, column)) {
        mask |= 1 << column;
        lastVisible = column;
      }
    }
    counts.push(lastVisible + 1);
    visibleCellMasks.push(mask);
  }
  return { rowFrameCounts: counts, visibleCellMasks };
}

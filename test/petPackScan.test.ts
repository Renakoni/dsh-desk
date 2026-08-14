import { describe, expect, it } from "vitest";
import type { SheetGeometry } from "../src/shared/petPack";
import { VISIBLE_ALPHA_THRESHOLD, scanRowFrameCounts, type RgbaImageLike } from "../src/shared/petPackScan";

// Small synthetic sheet: 8x9 grid of 4x4 cells (32x36 pixels). Geometry is
// built literally — the scanner trusts the shape, not the size bounds.
const CELL = 4;
const GEOMETRY: SheetGeometry = { width: 32, height: 36, columns: 8, rows: 9, cellWidth: CELL, cellHeight: CELL };

function makeSheet(): RgbaImageLike {
  return { width: GEOMETRY.width, height: GEOMETRY.height, data: new Uint8Array(GEOMETRY.width * GEOMETRY.height * 4) };
}

function paintCell(image: RgbaImageLike, row: number, column: number, alpha: number, pixel: "full" | "single" = "full") {
  const data = image.data;
  const startX = column * CELL;
  const startY = row * CELL;
  if (pixel === "single") {
    data[((startY * image.width) + startX) * 4 + 3] = alpha;
    return;
  }
  for (let y = startY; y < startY + CELL; y++) {
    for (let x = startX; x < startX + CELL; x++) {
      data[((y * image.width) + x) * 4 + 3] = alpha;
    }
  }
}

describe("scanRowFrameCounts", () => {
  it("counts contiguous visible frames per row and reports empty rows as 0", () => {
    const image = makeSheet();
    for (let column = 0; column < 6; column++) paintCell(image, 0, column, 255); // idle: 6 frames
    for (let column = 0; column < 8; column++) paintCell(image, 1, column, 255); // full row
    paintCell(image, 3, 0, 255); // single frame
    // rows 2, 4..8 stay empty

    expect(scanRowFrameCounts(image, GEOMETRY)).toEqual([6, 8, 0, 1, 0, 0, 0, 0, 0]);
  });

  it("uses the last visible cell so a malformed mid-row gap never truncates playback", () => {
    const image = makeSheet();
    paintCell(image, 2, 0, 255);
    paintCell(image, 2, 4, 255); // gap at 1..3
    expect(scanRowFrameCounts(image, GEOMETRY)[2]).toBe(5);
  });

  it("detects visibility from a single pixel at exactly the alpha threshold", () => {
    const image = makeSheet();
    paintCell(image, 5, 2, VISIBLE_ALPHA_THRESHOLD, "single");
    expect(scanRowFrameCounts(image, GEOMETRY)[5]).toBe(3);
  });

  it("ignores near-transparent residue below the threshold", () => {
    const image = makeSheet();
    paintCell(image, 6, 7, VISIBLE_ALPHA_THRESHOLD - 1);
    expect(scanRowFrameCounts(image, GEOMETRY)[6]).toBe(0);
  });

  it("throws when the pixel buffer does not match the geometry", () => {
    const image = makeSheet();
    expect(() => scanRowFrameCounts(image, { ...GEOMETRY, width: 64 })).toThrow(/geometry/);
    expect(() => scanRowFrameCounts({ ...image, data: new Uint8Array(4) }, GEOMETRY)).toThrow(/shorter/);
  });
});

// Shared stubs for exercising the import dialog's decode + scan path in
// jsdom: a controllable Image, a canvas 2D context that returns real RGBA
// pixels, and the staged-package fixture they describe.

import { vi } from "vitest";
import type { StagedPetPack } from "../../src/shared/petPackTransport";

export const IMPORT_GEOMETRY = { width: 256, height: 288, columns: 8, rows: 9, cellWidth: 32, cellHeight: 32 };
export const IMPORT_SHEET_COUNTS = [4, 0, 0, 3, 5, 8, 6, 6, 6];
export const IMPORT_DIGEST = "a".repeat(64);

export function stagedFixture(): StagedPetPack {
  return {
    manifest: { id: "boba", displayName: "Boba", description: "A QA pack.", spritesheetPath: "sheet.png" },
    geometry: IMPORT_GEOMETRY,
    sheetMime: "image/png",
    packageSha256: IMPORT_DIGEST,
    sheetDataUrl: "data:image/png;base64,QUJD"
  };
}

/** RGBA pixels matching IMPORT_SHEET_COUNTS so the real scanner runs. */
export function sheetPixels() {
  const data = new Uint8ClampedArray(IMPORT_GEOMETRY.width * IMPORT_GEOMETRY.height * 4);
  IMPORT_SHEET_COUNTS.forEach((count, row) => {
    for (let column = 0; column < count; column++) {
      const x = column * IMPORT_GEOMETRY.cellWidth + 1;
      const y = row * IMPORT_GEOMETRY.cellHeight + 1;
      data[((y * IMPORT_GEOMETRY.width) + x) * 4 + 3] = 255;
    }
  });
  return { data, width: IMPORT_GEOMETRY.width, height: IMPORT_GEOMETRY.height };
}

export class FakeSheetImage {
  static instances: FakeSheetImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = IMPORT_GEOMETRY.width;
  naturalHeight = IMPORT_GEOMETRY.height;
  set src(_value: string) {
    FakeSheetImage.instances.push(this);
  }
}

/** Install the Image + canvas stubs; pair with unstubAllGlobals/restoreAllMocks. */
export function stubSheetDecoding(): void {
  FakeSheetImage.instances = [];
  vi.stubGlobal("Image", FakeSheetImage);
  const context = { drawImage: vi.fn(), getImageData: vi.fn(() => sheetPixels()) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
}

// Shared pet-pack manifest fixture built through the real domain layer, so
// catalog tests exercise the same construction path as the import pipeline.

import { buildPetPackManifest, deriveSheetGeometry, parseCodexPetManifest, type PetPackManifest } from "../../src/shared/petPack";

export function makePackManifest(rowFrameCounts: number[] = [6, 8, 7, 5, 8, 8, 8, 8, 6], id = "yuexinmiao"): PetPackManifest {
  const manifest = parseCodexPetManifest({
    id,
    displayName: "月薪喵",
    description: "A small white office cat mascot adapted as a Codex pet.",
    spritesheetPath: "spritesheet.webp"
  });
  const geometry = deriveSheetGeometry(1536, 1872);
  if (!manifest.ok || !geometry.ok) throw new Error("pack fixture inputs must be valid");
  const built = buildPetPackManifest({ manifest: manifest.value, geometry: geometry.value, rowFrameCounts });
  if (!built.ok) throw new Error("pack fixture must build");
  return built.value;
}

export function makeV2PackManifest(id = "dpsk-girl"): PetPackManifest {
  const manifest = parseCodexPetManifest({ id, displayName: "DPSK Girl", spriteVersionNumber: 2 });
  const geometry = deriveSheetGeometry(1536, 2288, 2);
  if (!manifest.ok || !geometry.ok) throw new Error("v2 pack fixture inputs must be valid");
  const built = buildPetPackManifest({
    manifest: manifest.value,
    geometry: geometry.value,
    rowFrameCounts: {
      rowFrameCounts: [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8],
      visibleCellMasks: [127, 255, 255, 15, 31, 255, 63, 63, 63, 255, 255]
    }
  });
  if (!built.ok) throw new Error("v2 pack fixture must build");
  return built.value;
}

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

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PetPackAnimationKey, PetPackManifest } from "../shared/petPack";

const LEGACY_SEED_MARKER = "bundled-pets-v1.seeded";
const PREVIOUS_SEED_MARKER = "bundled-pets-v2.seeded";
const SEED_MARKER = "bundled-pets-v3.seeded";
const ANIMATION_KEYS: readonly PetPackAnimationKey[] = [
  "idle",
  "running_right",
  "running_left",
  "waving",
  "jumping",
  "failed",
  "waiting_permission",
  "running",
  "review"
];

interface BundledPetPack {
  id: string;
  rows: 9 | 11;
  height: number;
  displayName: string;
  description: string;
  frameCounts: readonly number[];
  look: boolean;
  displayOffset?: { x: number; y: number };
}

const BUNDLED_PET_PACKS: readonly BundledPetPack[] = [
  {
    id: "yuexinmiao",
    rows: 9,
    height: 1872,
    displayName: "月薪喵",
    description: "A small white office cat mascot.",
    frameCounts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    look: false
  },
  {
    id: "maid-deepseek-whale",
    rows: 11,
    height: 2288,
    displayName: "Maid-DeepSeek-Whale",
    description: "A tiny chibi blue-haired whale maid.",
    frameCounts: [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8],
    look: true,
    displayOffset: { x: 9, y: 0 }
  }
];

function manifestFor(pack: BundledPetPack, legacy = false, includeDisplayOffset = true): PetPackManifest {
  return {
    formatVersion: 1,
    sourceFormat: pack.rows === 11 ? "codex-pet-v2" : "codex-pet-v1",
    spriteVersionNumber: pack.rows === 11 ? 2 : 1,
    id: pack.id,
    displayName: pack.displayName,
    description: pack.description,
    spritesheetFile: "spritesheet.webp",
    sheet: {
      width: 1536,
      height: pack.height,
      columns: 8,
      rows: pack.rows,
      cellWidth: 192,
      cellHeight: pack.height / pack.rows
    },
    animations: ANIMATION_KEYS.map((key, row) => ({
      key,
      row,
      frameCount: legacy ? 8 : pack.frameCounts[row],
      frameDurationMs: 160
    })),
    roleDefaults: {
      idle: "idle",
      running: "running",
      waiting_permission: "waiting_permission",
      done: "jumping",
      error: "failed"
    },
    ...(includeDisplayOffset && pack.displayOffset ? { displayOffset: pack.displayOffset } : {}),
    ...(pack.look ? {
      look: {
        directions: 16,
        startRow: 9,
        columns: 8,
        neutralFrame: { row: 0, column: 6 }
      }
    } : {})
  };
}

function isLegacySeededPack(targetDir: string, sourceSheet: string, pack: BundledPetPack): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(targetDir, "pack.manifest.json"), "utf8"));
    const legacyManifest = manifestFor(pack, true, false);
    delete legacyManifest.look;
    return JSON.stringify(manifest) === JSON.stringify(legacyManifest)
      && readFileSync(join(targetDir, "spritesheet.webp")).equals(readFileSync(sourceSheet));
  } catch {
    return false;
  }
}

function isPreviousSeededPack(targetDir: string, sourceSheet: string, pack: BundledPetPack): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(targetDir, "pack.manifest.json"), "utf8"));
    return JSON.stringify(manifest) === JSON.stringify(manifestFor(pack, false, false))
      && readFileSync(join(targetDir, "spritesheet.webp")).equals(readFileSync(sourceSheet));
  } catch {
    return false;
  }
}

function writeManifest(targetDir: string, pack: BundledPetPack) {
  writeFileSync(join(targetDir, "pack.manifest.json"), `${JSON.stringify(manifestFor(pack), null, 2)}\n`, "utf8");
}

export function seedBundledPetPacks(userDataDir: string, bundledRoot: string) {
  if (existsSync(join(userDataDir, SEED_MARKER))) return;
  if (BUNDLED_PET_PACKS.some(pack => !existsSync(join(bundledRoot, pack.id, "spritesheet.webp")))) return;

  const targetRoot = join(userDataDir, "pets");
  const legacySeeded = existsSync(join(userDataDir, LEGACY_SEED_MARKER));
  const previouslySeeded = existsSync(join(userDataDir, PREVIOUS_SEED_MARKER));
  mkdirSync(targetRoot, { recursive: true });

  for (const pack of BUNDLED_PET_PACKS) {
    const targetDir = join(targetRoot, pack.id);
    const sourceSheet = join(bundledRoot, pack.id, "spritesheet.webp");
    if (existsSync(targetDir)) {
      if ((legacySeeded && isLegacySeededPack(targetDir, sourceSheet, pack))
        || (previouslySeeded && isPreviousSeededPack(targetDir, sourceSheet, pack))) writeManifest(targetDir, pack);
      continue;
    }
    if (legacySeeded || previouslySeeded) continue;

    mkdirSync(targetDir, { recursive: true });
    copyFileSync(sourceSheet, join(targetDir, "spritesheet.webp"));
    writeManifest(targetDir, pack);
  }

  writeFileSync(join(userDataDir, SEED_MARKER), "bundled-pets-v3\n", "utf8");
}

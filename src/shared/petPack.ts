/**
 * Codex-pet package domain model.
 *
 * A codex-pet package (`<id>.codex-pet.zip`) contains a minimal `pet.json`
 * and one spritesheet image. v1 uses an 8x9 grid; v2 keeps those nine action
 * rows and adds two rows for 16 clockwise pointer-look directions. Sheet
 * sizes vary in the wild, so cell size is derived from image dimensions.
 * v2 look rows are optional at runtime: Desk currently plays the standard
 * nine action rows, and older/third-party v2 sheets may omit the neutral
 * pointer frame while still being valid pets.
 *
 * This module is the pure domain layer: manifest parsing, sheet geometry,
 * vocabulary translation, and construction of the app's internal
 * PetPackManifest. File IO and image decoding live in the main-process
 * import pipeline, which feeds the per-row visible frame counts in here.
 */

import type { PetAnimationKey } from "./petAnimationKeys";
import type { PetPackScanResult } from "./petPackScan";

export const CODEX_PET_COLUMNS = 8;
export const CODEX_PET_STANDARD_ROWS = 9;
export const CODEX_PET_V2_ROWS = 11;
export const CODEX_PET_LOOK_START_ROW = 9;
export const CODEX_PET_LOOK_DIRECTIONS = 16;
export const CODEX_PET_IDLE_FRAMES = 6;

export type CodexPetSpriteVersion = 1 | 2;

/** Official row order of the v1 spritesheet contract, top to bottom. */
export const CODEX_PET_ROWS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review"
] as const;

const CODEX_PET_ROW_COUNT: Record<CodexPetSpriteVersion, number> = {
  1: CODEX_PET_STANDARD_ROWS,
  2: CODEX_PET_V2_ROWS
};

export type CodexPetRow = (typeof CODEX_PET_ROWS)[number];

/**
 * Animation vocabulary of an imported pack — the subset of the canonical
 * PetAnimationKey superset that codex-pet spritesheets can provide. Extract
 * keeps this bound to shared/petAnimationKeys.ts by construction.
 */
export type PetPackAnimationKey = Extract<
  PetAnimationKey,
  | "idle"
  | "running"
  | "waiting_permission"
  | "running_right"
  | "running_left"
  | "waving"
  | "jumping"
  | "failed"
  | "review"
>;

/** One-time vocabulary translation at the import boundary; never aliased at runtime. */
export const CODEX_ROW_TO_ANIMATION_KEY: Record<CodexPetRow, PetPackAnimationKey> = {
  idle: "idle",
  "running-right": "running_right",
  "running-left": "running_left",
  waving: "waving",
  jumping: "jumping",
  failed: "failed",
  waiting: "waiting_permission",
  running: "running",
  review: "review"
};

/** Pet states the runtime must resolve to an animation for every theme. */
export interface PetPackRoleDefaults {
  idle: PetPackAnimationKey;
  running: PetPackAnimationKey;
  waiting_permission: PetPackAnimationKey;
  done: PetPackAnimationKey;
  error: PetPackAnimationKey;
}

// Preference order per role when a pack does not provide the primary key.
// Every chain ends in `idle`, which buildPetPackManifest requires, so
// resolution always terminates.
const ROLE_FALLBACK_CHAINS: Record<keyof PetPackRoleDefaults, PetPackAnimationKey[]> = {
  idle: ["idle"],
  // running_right/left are drag feedback in the reference player, never a
  // work state — they are not fallbacks for any role.
  running: ["running", "idle"],
  waiting_permission: ["waiting_permission", "idle"],
  // The format has no dedicated "done" row; the celebration jump is the
  // closest match, then the greeting wave.
  done: ["jumping", "waving", "idle"],
  error: ["failed", "running", "idle"]
};

/**
 * Default per-frame duration. The format carries no timing; the reference
 * player loops a row in ~1100ms at ~6 frames, so 160ms/frame sits in the
 * middle of observed packs.
 */
export const CODEX_PET_FRAME_DURATION_MS = 160;

const MIN_CELL_PX = 16;
const MAX_CELL_PX = 1024;
/**
 * Cap on the DECODED sheet area. The compressed-byte limits cannot bound
 * decoded memory: a highly compressible sheet at the 1024px cell bound would
 * decode to ~75M pixels (~302MB as RGBA) inside the renderer during the
 * import scan. 16M pixels keeps the worst-case ImageData at ~64MB while
 * leaving room for sheets several times the 1536x1872 reference.
 */
export const MAX_SHEET_DECODED_PIXELS = 16_000_000;
const MAX_ID_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export interface PetPackProblem {
  field: string;
  message: string;
}

/** Raw pet.json shape after validation (id already sanitized). */
export interface CodexPetManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  spriteVersionNumber: CodexPetSpriteVersion;
  displayOffset?: PetDisplayOffset;
}

export interface PetDisplayOffset {
  x: number;
  y: number;
}

export interface PetLookCapability {
  directions: typeof CODEX_PET_LOOK_DIRECTIONS;
  startRow: typeof CODEX_PET_LOOK_START_ROW;
  columns: typeof CODEX_PET_COLUMNS;
  /** v2's centered pointer state, kept out of the idle animation loop. */
  neutralFrame: { row: 0; column: typeof CODEX_PET_IDLE_FRAMES };
}

export interface SheetGeometry {
  width: number;
  height: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

export interface PetPackAnimation {
  key: PetPackAnimationKey;
  /** 0-based row index in the spritesheet. */
  row: number;
  /** Visible (non-transparent) frames in the row, 1..columns. */
  frameCount: number;
  frameDurationMs: number;
}

/**
 * The app's internal pack manifest, generated once at import and stored next
 * to the spritesheet. Runtime code reads only this, never raw pet.json.
 */
export interface PetPackManifest {
  formatVersion: 1;
  sourceFormat: "codex-pet-v1" | "codex-pet-v2";
  spriteVersionNumber: CodexPetSpriteVersion;
  id: string;
  displayName: string;
  description: string;
  spritesheetFile: string;
  sheet: SheetGeometry;
  /** Only rows with at least one visible frame. */
  animations: PetPackAnimation[];
  roleDefaults: PetPackRoleDefaults;
  look?: PetLookCapability;
  /** Optional visual alignment for art whose character body is off-center in its cell. */
  displayOffset?: PetDisplayOffset;
}

export type PetPackResult<T> =
  | { ok: true; value: T }
  | { ok: false; problems: PetPackProblem[] };

// Windows reserves these device names as file/directory basenames, with or
// without an extension (CON, CON.webp, com1.png, ...). Pack ids become
// userData/pets/<id>/ directory names, so they must never collide with one.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function hasWindowsReservedBasename(name: string): boolean {
  return WINDOWS_RESERVED_NAME.test(name.split(".")[0]);
}

/**
 * Normalize a raw id to a filesystem- and settings-safe slug. Returns null
 * when nothing usable remains (e.g. an id without any latin letters/digits)
 * or when the result is a Windows-reserved device name such as CON or COM1 —
 * reserved ids are rejected rather than silently renamed.
 */
export function sanitizePetPackId(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!slug || slug.length > MAX_ID_LENGTH) return null;
  if (hasWindowsReservedBasename(slug)) return null;
  return slug;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The spritesheet reference must be a bare file name inside the package,
// never a path, one of the two image formats the ecosystem uses, and not a
// Windows-reserved basename (CON.webp cannot be used as a regular file).
// Exported because the store re-checks persisted manifests at read time.
export function isValidSpritesheetFileName(value: string): boolean {
  if (value.includes("..")) return false;
  if (!/^[a-z0-9._-]+\.(webp|png)$/i.test(value)) return false;
  return !hasWindowsReservedBasename(value);
}

/** Validate a parsed pet.json value into a normalized CodexPetManifest. */
export function parseCodexPetManifest(value: unknown): PetPackResult<CodexPetManifest> {
  const problems: PetPackProblem[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, problems: [{ field: "manifest", message: "pet.json must be a JSON object" }] };
  }

  let id = "";
  if (typeof value.id !== "string" || value.id.trim() === "") {
    problems.push({ field: "id", message: "id is required and must be a non-empty string" });
  } else {
    const slug = sanitizePetPackId(value.id);
    if (!slug) {
      problems.push({
        field: "id",
        message: "id must contain latin letters or digits, be at most 64 characters, and not be a Windows-reserved device name"
      });
    } else {
      id = slug;
    }
  }

  let displayName = "";
  if (typeof value.displayName !== "string" || value.displayName.trim() === "") {
    problems.push({ field: "displayName", message: "displayName is required and must be a non-empty string" });
  } else if (value.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    problems.push({ field: "displayName", message: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters` });
  } else {
    displayName = value.displayName.trim();
  }

  let description = "";
  if (value.description !== undefined) {
    if (typeof value.description !== "string") {
      problems.push({ field: "description", message: "description must be a string when present" });
    } else {
      description = value.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
    }
  }

  let spritesheetPath = "spritesheet.webp";
  if (value.spritesheetPath !== undefined) {
    if (typeof value.spritesheetPath !== "string" || !isValidSpritesheetFileName(value.spritesheetPath)) {
      problems.push({
        field: "spritesheetPath",
        message: "spritesheetPath must be a bare .webp or .png file name without path separators"
      });
    } else {
      spritesheetPath = value.spritesheetPath;
    }
  }

  let spriteVersionNumber: CodexPetSpriteVersion = 1;
  if (value.spriteVersionNumber !== undefined) {
    if (value.spriteVersionNumber !== 1 && value.spriteVersionNumber !== 2) {
      problems.push({ field: "spriteVersionNumber", message: "spriteVersionNumber must be 1 or 2" });
    } else {
      spriteVersionNumber = value.spriteVersionNumber;
    }
  }

  let displayOffset: PetDisplayOffset | undefined;
  if (value.displayOffset !== undefined) {
    const offset = value.displayOffset;
    if (!isPlainObject(offset)
      || typeof offset.x !== "number" || !Number.isInteger(offset.x) || Math.abs(offset.x) > 48
      || typeof offset.y !== "number" || !Number.isInteger(offset.y) || Math.abs(offset.y) > 48) {
      problems.push({ field: "displayOffset", message: "displayOffset x and y must be integers between -48 and 48" });
    } else {
      displayOffset = { x: offset.x, y: offset.y };
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { id, displayName, description, spritesheetPath, spriteVersionNumber, ...(displayOffset ? { displayOffset } : {}) } };
}

/**
 * Derive the cell grid from the sheet's pixel dimensions. The v1 grid is
 * fixed at 8x9; dimensions must divide exactly so frames never drift.
 */
export function deriveSheetGeometry(width: number, height: number, spriteVersionNumber: CodexPetSpriteVersion = 1): PetPackResult<SheetGeometry> {
  const problems: PetPackProblem[] = [];
  if (!Number.isInteger(width) || width <= 0) {
    problems.push({ field: "width", message: "sheet width must be a positive integer" });
  }
  if (!Number.isInteger(height) || height <= 0) {
    problems.push({ field: "height", message: "sheet height must be a positive integer" });
  }
  if (problems.length > 0) return { ok: false, problems };

  if (width % CODEX_PET_COLUMNS !== 0) {
    problems.push({ field: "width", message: `sheet width must be divisible by ${CODEX_PET_COLUMNS} columns` });
  }
  const rows = CODEX_PET_ROW_COUNT[spriteVersionNumber];
  if (height % rows !== 0) {
    problems.push({ field: "height", message: `sheet height must be divisible by ${rows} rows` });
  }
  if (problems.length > 0) return { ok: false, problems };

  const cellWidth = width / CODEX_PET_COLUMNS;
  const cellHeight = height / rows;
  if (cellWidth < MIN_CELL_PX || cellHeight < MIN_CELL_PX) {
    problems.push({ field: "size", message: `cells must be at least ${MIN_CELL_PX}px on each side` });
  }
  if (cellWidth > MAX_CELL_PX || cellHeight > MAX_CELL_PX) {
    problems.push({ field: "size", message: `cells must be at most ${MAX_CELL_PX}px on each side` });
  }
  if (width * height > MAX_SHEET_DECODED_PIXELS) {
    problems.push({ field: "size", message: `the sheet must decode to at most ${MAX_SHEET_DECODED_PIXELS.toLocaleString("en-US")} pixels` });
  }
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    value: { width, height, columns: CODEX_PET_COLUMNS, rows, cellWidth, cellHeight }
  };
}

function resolveRole(role: keyof PetPackRoleDefaults, available: ReadonlySet<PetPackAnimationKey>): PetPackAnimationKey {
  for (const key of ROLE_FALLBACK_CHAINS[role]) {
    if (available.has(key)) return key;
  }
  return "idle";
}

/**
 * Combine a validated manifest, derived geometry, and per-row visible frame
 * counts (from the import-time alpha scan) into the internal pack manifest.
 */
export function buildPetPackManifest(input: {
  manifest: CodexPetManifest;
  geometry: SheetGeometry;
  rowFrameCounts: number[] | PetPackScanResult;
}): PetPackResult<PetPackManifest> {
  const { manifest, geometry } = input;
  const scanInput = input.rowFrameCounts;
  const rowFrameCounts = Array.isArray(scanInput)
    ? scanInput
    : scanInput && typeof scanInput === "object" && Array.isArray(scanInput.rowFrameCounts)
      ? scanInput.rowFrameCounts
      : [];
  const visibleCellMasks = !Array.isArray(scanInput) && scanInput && typeof scanInput === "object" && Array.isArray(scanInput.visibleCellMasks)
    ? scanInput.visibleCellMasks
    : undefined;
  const problems: PetPackProblem[] = [];

  if (geometry.rows !== CODEX_PET_ROW_COUNT[manifest.spriteVersionNumber]) {
    return { ok: false, problems: [{ field: "geometry", message: `geometry does not match spriteVersionNumber ${manifest.spriteVersionNumber}` }] };
  }
  if (rowFrameCounts.length !== geometry.rows) {
    return {
      ok: false,
      problems: [{ field: "rowFrameCounts", message: `expected ${geometry.rows} row frame counts, got ${rowFrameCounts.length}` }]
    };
  }
  // Index-based loop on purpose: forEach would skip sparse-array holes and
  // let an undefined frame count slip through validation.
  for (let row = 0; row < geometry.rows; row++) {
    const count = rowFrameCounts[row];
    if (!Number.isInteger(count) || count < 0 || count > geometry.columns) {
      problems.push({ field: `rowFrameCounts[${row}]`, message: `frame count must be an integer between 0 and ${geometry.columns}` });
    }
  }
  if (manifest.spriteVersionNumber === 2) {
    if (!visibleCellMasks || visibleCellMasks.length !== geometry.rows) {
      return { ok: false, problems: [{ field: "visibleCellMasks", message: "v2 requires visibility for every spritesheet cell" }] };
    }
    for (let row = 0; row < geometry.rows; row++) {
      const mask = visibleCellMasks[row];
      if (!Number.isInteger(mask) || mask < 0 || mask >= (1 << geometry.columns)) {
        problems.push({ field: `visibleCellMasks[${row}]`, message: "cell visibility mask is invalid" });
      }
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const animations: PetPackAnimation[] = [];
  CODEX_PET_ROWS.forEach((rowName, row) => {
    const frameCount = manifest.spriteVersionNumber === 2 && row === 0
      ? Math.min(rowFrameCounts[row], CODEX_PET_IDLE_FRAMES)
      : rowFrameCounts[row];
    if (frameCount < 1) return;
    animations.push({
      key: CODEX_ROW_TO_ANIMATION_KEY[rowName],
      row,
      frameCount,
      frameDurationMs: CODEX_PET_FRAME_DURATION_MS
    });
  });

  const available = new Set(animations.map(animation => animation.key));
  if (!available.has("idle")) {
    return { ok: false, problems: [{ field: "idle", message: "the idle row must contain at least one visible frame" }] };
  }

  return {
    ok: true,
    value: {
      formatVersion: 1,
      sourceFormat: manifest.spriteVersionNumber === 2 ? "codex-pet-v2" : "codex-pet-v1",
      spriteVersionNumber: manifest.spriteVersionNumber,
      id: manifest.id,
      displayName: manifest.displayName,
      description: manifest.description,
      spritesheetFile: manifest.spritesheetPath,
      sheet: geometry,
      animations,
      roleDefaults: {
        idle: resolveRole("idle", available),
        running: resolveRole("running", available),
        waiting_permission: resolveRole("waiting_permission", available),
        done: resolveRole("done", available),
        error: resolveRole("error", available)
      },
      ...(manifest.displayOffset ? { displayOffset: manifest.displayOffset } : {}),
      ...(manifest.spriteVersionNumber === 2
        && visibleCellMasks?.[CODEX_PET_LOOK_START_ROW] === (1 << CODEX_PET_COLUMNS) - 1
        && visibleCellMasks?.[CODEX_PET_LOOK_START_ROW + 1] === (1 << CODEX_PET_COLUMNS) - 1
        && ((visibleCellMasks?.[0] ?? 0) & (1 << CODEX_PET_IDLE_FRAMES)) !== 0 ? {
        look: {
          directions: CODEX_PET_LOOK_DIRECTIONS,
          startRow: CODEX_PET_LOOK_START_ROW,
          columns: CODEX_PET_COLUMNS,
          neutralFrame: { row: 0 as const, column: CODEX_PET_IDLE_FRAMES }
        }
      } : {})
    }
  };
}

// Calm, positive states that make sense while nothing is happening. The sad
// `failed` row and the state-reserved waiting/running rows are excluded.
const IDLE_POOL_CANDIDATES: readonly PetPackAnimationKey[] = ["idle", "waving", "jumping", "review"];

/** Suggested idle-rotation pool for an imported pack: calm states it provides. */
export function defaultIdlePool(animations: readonly PetPackAnimation[]): PetPackAnimationKey[] {
  const available = new Set(animations.map(animation => animation.key));
  return IDLE_POOL_CANDIDATES.filter(key => available.has(key));
}

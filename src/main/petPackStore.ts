/**
 * Pet-pack store: reads .codex-pet.zip packages, validates them through the
 * pure domain layer, and manages the installed packs under a pets directory
 * (userData/pets/<id>/ in the app; injected here so tests use temp dirs).
 *
 * Safety model:
 * - Zip entries are never extracted by name to paths; the store writes only
 *   fixed, validated file names, so zip-slip is structurally impossible.
 * - Inflation is targeted: a metadata-only pass first enforces entry-count
 *   and aggregate uncompressed-size caps without inflating anything, then
 *   exactly two entries are inflated — pet.json and the single spritesheet
 *   it references. A compressed bomb can therefore never expand beyond one
 *   capped manifest plus one capped image.
 * - Packs contain nothing executable: one manifest, one image.
 *
 * Decode/trust model: Electron's nativeImage cannot decode WebP — the format
 * nearly every real pack uses — so the main process never decodes pixels.
 * Chromium in the renderer is this app's single image decoder (the same
 * decoder that will display the pet). Import is therefore two-phase:
 * inspect() stages the package and returns the SHA-256 of the ENTIRE raw
 * archive; the renderer decodes the sheet and alpha-scans the frame counts;
 * install() requires that digest back and re-hashes the archive, so any
 * change to the package after inspection — sheet or manifest — is rejected,
 * and the submitted counts only ever apply to the bytes the user previewed.
 * The digest does NOT itself prove that decoding succeeded: the import UI
 * must never call install after a failed decode/scan, and main refuses any
 * install without the digest of a completed inspection.
 */

import { unzipSync, type UnzipFileInfo } from "fflate";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  CODEX_ROW_TO_ANIMATION_KEY,
  buildPetPackManifest,
  deriveSheetGeometry,
  isValidSpritesheetFileName,
  parseCodexPetManifest,
  sanitizePetPackId,
  type CodexPetManifest,
  type PetPackManifest,
  type PetPackProblem
} from "../shared/petPack";
import { parseImageDimensions } from "../shared/imageDimensions";
import type { PetPackInspectResult, PetPackInstallResult, PetPackRemoveResult, StagedPetPack } from "../shared/petPackTransport";

const MAX_ZIP_BYTES = 30 * 1024 * 1024;
const MAX_SHEET_BYTES = 25 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ZIP_ENTRIES = 64;
/** Sum of declared uncompressed sizes across ALL entries in the archive. */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
/** Accept pet.json at the zip root or nested at most this deep (id-folder zips). */
const MAX_ENTRY_DEPTH = 2;

export const PACK_MANIFEST_FILE = "pack.manifest.json";

function problem(field: string, message: string): PetPackProblem {
  return { field, message };
}

function fail(field: string, message: string): { ok: false; problems: PetPackProblem[] } {
  return { ok: false, problems: [problem(field, message)] };
}

function entryDepth(name: string): number {
  return name.split("/").length - 1;
}

function directoryOf(entryName: string): string {
  const index = entryName.lastIndexOf("/");
  return index === -1 ? "" : entryName.slice(0, index + 1);
}

function readZipBytes(zipPath: string): Uint8Array | { error: PetPackProblem } {
  try {
    if (statSync(zipPath).size > MAX_ZIP_BYTES) {
      return { error: problem("zip", `package is larger than ${MAX_ZIP_BYTES / (1024 * 1024)}MB`) };
    }
    return new Uint8Array(readFileSync(zipPath));
  } catch {
    return { error: problem("zip", "package file could not be read") };
  }
}

/** Inflate nothing; collect every entry's metadata for the cap checks. */
function scanZipMetadata(raw: Uint8Array): { entries: UnzipFileInfo[] } | { error: PetPackProblem } {
  const entries: UnzipFileInfo[] = [];
  try {
    unzipSync(raw, {
      filter: file => {
        entries.push(file);
        return false;
      }
    });
  } catch {
    return { error: problem("zip", "package is not a readable zip archive") };
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    return { error: problem("zip", `package contains more than ${MAX_ZIP_ENTRIES} entries`) };
  }
  const totalUncompressed = entries.reduce((sum, entry) => sum + entry.originalSize, 0);
  if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    return { error: problem("zip", `package would decompress to more than ${MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)}MB`) };
  }
  return { entries };
}

/** Inflate exactly one entry by its full name. */
function inflateEntry(raw: Uint8Array, entryName: string): Uint8Array | null {
  try {
    const unzipped = unzipSync(raw, { filter: file => file.name === entryName });
    return unzipped[entryName] ?? null;
  } catch {
    return null;
  }
}

interface StagedInternal {
  staged: StagedPetPack;
  sheetBytes: Uint8Array;
}

function stagePetPackZip(zipPath: string): { ok: true; value: StagedInternal } | { ok: false; problems: PetPackProblem[] } {
  const raw = readZipBytes(zipPath);
  if ("error" in raw) return { ok: false, problems: [raw.error] };

  const metadata = scanZipMetadata(raw);
  if ("error" in metadata) return { ok: false, problems: [metadata.error] };

  // The shallowest pet.json anchors the package; its directory must also
  // contain the referenced spritesheet.
  const manifestEntry = metadata.entries
    .filter(entry => !entry.name.endsWith("/")
      && entryDepth(entry.name) <= MAX_ENTRY_DEPTH
      && basename(entry.name).toLowerCase() === "pet.json"
      && entry.originalSize <= MAX_MANIFEST_BYTES)
    .sort((a, b) => entryDepth(a.name) - entryDepth(b.name) || a.name.localeCompare(b.name))[0];
  if (!manifestEntry) return fail("pet.json", "package does not contain a usable pet.json manifest");

  const manifestBytes = inflateEntry(raw, manifestEntry.name);
  if (!manifestBytes) return fail("pet.json", "pet.json could not be extracted");

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes));
  } catch {
    return fail("pet.json", "pet.json is not valid JSON");
  }
  const parsed = parseCodexPetManifest(manifestJson);
  if (!parsed.ok) return parsed;
  const manifest: CodexPetManifest = parsed.value;

  const packDir = directoryOf(manifestEntry.name);
  const sheetEntry = metadata.entries.find(entry =>
    directoryOf(entry.name) === packDir
    && basename(entry.name).toLowerCase() === manifest.spritesheetPath.toLowerCase()
    && entry.originalSize <= MAX_SHEET_BYTES);
  if (!sheetEntry) {
    return fail("spritesheetPath", `package does not contain "${manifest.spritesheetPath}" next to pet.json`);
  }
  const sheetBytes = inflateEntry(raw, sheetEntry.name);
  if (!sheetBytes) return fail("spritesheetPath", "spritesheet could not be extracted");

  const dimensions = parseImageDimensions(sheetBytes);
  if (!dimensions) return fail("spritesheet", "spritesheet is not a readable PNG or WebP image");
  const geometry = deriveSheetGeometry(dimensions.width, dimensions.height);
  if (!geometry.ok) return geometry;

  const sheetMime = dimensions.format === "png" ? "image/png" : "image/webp";
  return {
    ok: true,
    value: {
      staged: {
        manifest,
        geometry: geometry.value,
        sheetMime,
        packageSha256: createHash("sha256").update(raw).digest("hex"),
        sheetDataUrl: `data:${sheetMime};base64,${Buffer.from(sheetBytes).toString("base64")}`
      },
      sheetBytes
    }
  };
}

/** Phase 1: validate a package and stage everything the import preview needs. */
export function inspectPetPackZip(zipPath: string): PetPackInspectResult {
  const staged = stagePetPackZip(zipPath);
  if (!staged.ok) return staged;
  return { ok: true, staged: staged.value.staged };
}

/**
 * Phase 3: revalidate the same package (import is stateless between phases)
 * and persist it as userData/pets/<id>/. expectedPackageSha256 must be the
 * digest returned by inspect — it proves the whole archive (manifest AND
 * sheet) is byte-identical to what the user previewed and scanned.
 */
export function installPetPack(
  zipPath: string,
  rowFrameCounts: number[],
  expectedPackageSha256: string,
  petsDir: string,
  options: { overwrite?: boolean } = {}
): PetPackInstallResult {
  if (typeof expectedPackageSha256 !== "string" || expectedPackageSha256.length === 0) {
    return fail("package", "install requires the package digest from a completed inspection");
  }

  const staged = stagePetPackZip(zipPath);
  if (!staged.ok) return staged;
  const { manifest, geometry, packageSha256 } = staged.value.staged;

  if (packageSha256 !== expectedPackageSha256.toLowerCase()) {
    return fail("package", "the package changed after inspection; import it again");
  }

  const built = buildPetPackManifest({
    manifest,
    geometry,
    rowFrameCounts: Array.isArray(rowFrameCounts) ? rowFrameCounts : []
  });
  if (!built.ok) return built;
  const pack = built.value;

  const targetDir = join(petsDir, pack.id);
  if (existsSync(targetDir) && !options.overwrite) {
    return fail("id", `a pet pack with id "${pack.id}" is already installed`);
  }

  // Recoverable swap: stage into a temp dir, move any existing pack aside as
  // a backup, then rename into place. On failure the backup is restored, so
  // a failed overwrite never loses the installed pack.
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const tempDir = join(petsDir, `.tmp-${pack.id}-${suffix}`);
  const backupDir = join(petsDir, `.backup-${pack.id}-${suffix}`);
  let backedUp = false;
  try {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, pack.spritesheetFile), staged.value.sheetBytes);
    writeFileSync(join(tempDir, PACK_MANIFEST_FILE), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    if (existsSync(targetDir)) {
      renameSync(targetDir, backupDir);
      backedUp = true;
    }
    renameSync(tempDir, targetDir);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    if (backedUp && !existsSync(targetDir)) {
      try { renameSync(backupDir, targetDir); } catch { /* backup stays on disk for manual recovery */ }
    }
    return fail("install", error instanceof Error ? error.message : String(error));
  }
  // The swap is committed; backup cleanup is best-effort and must never turn
  // a successful install into a reported failure.
  if (backedUp) {
    try {
      rmSync(backupDir, { recursive: true, force: true });
    } catch {
      return { ok: true, pack, warning: `installed, but the previous version's backup could not be removed (${backupDir})` };
    }
  }
  return { ok: true, pack };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// Persisted geometry must satisfy the SAME codex-pet v1 contract the import
// enforces — one source of truth, not a second looser one. Everything is
// re-derived from width and height, so a manifest with a forged grid (wrong
// column/row count, oversized cells, inconsistent cell dimensions) is
// rejected even when it is internally coherent.
function isValidPersistedSheet(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sheet = value as Record<string, unknown>;
  if (!isPositiveInteger(sheet.width) || !isPositiveInteger(sheet.height)) return false;
  const derived = deriveSheetGeometry(sheet.width, sheet.height);
  if (!derived.ok) return false;
  return sheet.columns === derived.value.columns
    && sheet.rows === derived.value.rows
    && sheet.cellWidth === derived.value.cellWidth
    && sheet.cellHeight === derived.value.cellHeight;
}

const PET_PACK_ANIMATION_KEYS: ReadonlySet<string> = new Set(Object.values(CODEX_ROW_TO_ANIMATION_KEY));

const ROLE_NAMES = ["idle", "running", "waiting_permission", "done", "error"] as const;

/**
 * Full runtime-shape validation of a persisted pack.manifest.json. The
 * renderer plays these animations and the main process sizes BrowserWindows
 * from the sheet geometry, so a corrupt manifest must be skipped entirely —
 * never partially accepted.
 */
function isPetPackManifest(value: unknown): value is PetPackManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.formatVersion !== 1 || record.sourceFormat !== "codex-pet-v1") return false;
  if (typeof record.id !== "string" || sanitizePetPackId(record.id) !== record.id) return false;
  if (typeof record.displayName !== "string" || record.displayName.trim() === "") return false;
  if (typeof record.description !== "string") return false;
  if (typeof record.spritesheetFile !== "string" || !isValidSpritesheetFileName(record.spritesheetFile)) return false;
  if (!isValidPersistedSheet(record.sheet)) return false;
  const sheet = record.sheet as { columns: number; rows: number };

  if (!Array.isArray(record.animations) || record.animations.length === 0) return false;
  const seenKeys = new Set<string>();
  for (const entry of record.animations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const animation = entry as Record<string, unknown>;
    if (typeof animation.key !== "string" || !PET_PACK_ANIMATION_KEYS.has(animation.key)) return false;
    if (seenKeys.has(animation.key)) return false;
    seenKeys.add(animation.key);
    if (typeof animation.row !== "number" || !Number.isInteger(animation.row) || animation.row < 0 || animation.row >= sheet.rows) return false;
    if (!isPositiveInteger(animation.frameCount) || animation.frameCount > sheet.columns) return false;
    if (typeof animation.frameDurationMs !== "number" || !Number.isFinite(animation.frameDurationMs) || animation.frameDurationMs <= 0) return false;
  }
  // The idle fallback invariant every pack build guarantees.
  if (!seenKeys.has("idle")) return false;

  if (!record.roleDefaults || typeof record.roleDefaults !== "object" || Array.isArray(record.roleDefaults)) return false;
  const roleDefaults = record.roleDefaults as Record<string, unknown>;
  for (const role of ROLE_NAMES) {
    const target = roleDefaults[role];
    if (typeof target !== "string" || !seenKeys.has(target)) return false;
  }
  return true;
}

/** Installed packs, sorted by id. Corrupt entries are skipped, never fatal. */
export function listPetPacks(petsDir: string): PetPackManifest[] {
  if (!existsSync(petsDir)) return [];
  const packs: PetPackManifest[] = [];
  for (const entry of readdirSync(petsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const pack = readPetPack(petsDir, entry.name);
    if (pack) packs.push(pack);
  }
  return packs.sort((a, b) => a.id.localeCompare(b.id));
}

/** Read one installed pack without enumerating every pack directory. */
export function readPetPack(petsDir: string, id: string): PetPackManifest | undefined {
  if (sanitizePetPackId(id) !== id) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(petsDir, id, PACK_MANIFEST_FILE), "utf8"));
    return isPetPackManifest(parsed) && parsed.id === id ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Delete an installed pack. The id must be an exact, already-sanitized slug. */
export function removePetPack(id: string, petsDir: string): PetPackRemoveResult {
  if (sanitizePetPackId(id) !== id) return { ok: false, error: "invalid pet pack id" };
  const targetDir = join(petsDir, id);
  if (!existsSync(targetDir)) return { ok: false, error: `pet pack "${id}" is not installed` };
  try {
    rmSync(targetDir, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Resolve a pet-asset:// URL to a file inside the pets directory, or null.
 * Expected shape: pet-asset://packs/<id>/<file> where <file> is a bare image
 * name. Anything else — bad host, invalid id, path-y file names, foreign
 * extensions, malformed percent-encoding, escapes from the pets dir —
 * resolves to null.
 */
export function resolvePetAssetPath(urlString: string, petsDir: string): string | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (url.protocol !== "pet-asset:" || url.hostname !== "packs") return null;

  const segments = url.pathname.split("/").filter(segment => segment.length > 0);
  if (segments.length !== 2) return null;
  let id: string;
  let file: string;
  try {
    [id, file] = segments.map(decodeURIComponent);
  } catch {
    return null;
  }
  if (sanitizePetPackId(id) !== id) return null;
  if (file.includes("..") || !/^[a-z0-9._-]+\.(webp|png)$/i.test(file)) return null;

  const resolved = resolve(petsDir, id, file);
  const root = resolve(petsDir) + sep;
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

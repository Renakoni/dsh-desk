/**
 * One-click network install: resolve a codex-pet.org gallery slug to its two
 * package files and repackage them as a local .codex-pet.zip.
 *
 * The resolution mirrors the official `codex-pet-installer` npm package
 * (v0.1.1): GET /api/pets/<slug> for the row, then
 * /api/pets/<slug>/files/pet.json and /files/spritesheet.webp for the
 * assets. This module ONLY produces a zip on disk — installation still goes
 * through the exact same inspect → scan → digest-bound install pipeline as a
 * hand-picked file, so a gallery endpoint change can never weaken import
 * validation, and removing this module cannot affect file import.
 */

import { zipSync } from "fflate";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { isValidSpritesheetFileName } from "../shared/petPack";
import { CODEX_PET_GALLERY_URL, type PetPackDownloadCode, type PetPackDownloadResult } from "../shared/petPackTransport";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MANIFEST_DOWNLOAD_BYTES = 64 * 1024;
const MAX_SHEET_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

export interface PetPackDownloadOptions {
  fetchImpl?: typeof fetch;
  siteUrl?: string;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

function fail(code: PetPackDownloadCode, detail?: string): PetPackDownloadResult {
  return { ok: false, code, detail };
}

/** Read a response body while enforcing a hard byte cap, reporting progress. */
async function readBodyWithCap(
  response: Response,
  cap: number,
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void
): Promise<Uint8Array | { tooLarge: true }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (totalBytes !== null && totalBytes > cap) return { tooLarge: true };

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > cap) return { tooLarge: true };
    onProgress?.(bytes.byteLength, totalBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > cap) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
    onProgress?.(received, totalBytes);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloaded archives are lifecycle-owned temp files: the UI discards them
 * after a successful install or when the import dialog is dismissed. The
 * deletion is hard-confined to the downloads directory, so it can never
 * touch a user-selected zip anywhere else on disk.
 */
export function discardDownloadedPetPack(zipPath: string, downloadsDir: string): { ok: boolean } {
  try {
    const resolved = resolve(String(zipPath ?? ""));
    const root = resolve(downloadsDir) + sep;
    if (!resolved.startsWith(root)) return { ok: false };
    rmSync(resolved, { force: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Startup cleanup: anything in the downloads directory is by definition a
 * temporary archive, so crash leftovers are wiped wholesale. The directory
 * is recreated on the next download.
 */
export function cleanupPetDownloads(downloadsDir: string): void {
  try {
    rmSync(downloadsDir, { recursive: true, force: true });
  } catch { /* best effort — a locked leftover is retried next startup */ }
}

export async function downloadPetPack(
  petSlug: string,
  downloadsDir: string,
  options: PetPackDownloadOptions = {}
): Promise<PetPackDownloadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const siteUrl = options.siteUrl ?? CODEX_PET_GALLERY_URL;

  const slug = String(petSlug ?? "").trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return fail("invalid-slug");

  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return fail("network", "invalid gallery URL");
  }

  // 1. Resolve the gallery row.
  let row: Record<string, unknown>;
  try {
    const response = await fetchImpl(`${origin}/api/pets/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.status === 404) return fail("not-found");
    if (!response.ok) return fail("network", `pet lookup failed with status ${response.status}`);
    const body = await response.json() as { pet?: Record<string, unknown> };
    if (!body?.pet || typeof body.pet !== "object") return fail("not-found");
    row = body.pet;
  } catch (error) {
    return fail("network", error instanceof Error ? error.message : String(error));
  }

  // Same sanity rule as the official installer: the row must point at a
  // spritesheet package.
  const imageUrl = String(row.image_url ?? "");
  const assetPath = String(row.asset_path ?? "");
  if (!imageUrl || !(assetPath.endsWith("/spritesheet.webp") || imageUrl.toLowerCase().endsWith("/spritesheet.webp"))) {
    return fail("invalid-package", "gallery entry does not include spritesheet.webp");
  }

  // 2. Download both package files, capped.
  let manifestBytes: Uint8Array;
  let sheetBytes: Uint8Array;
  try {
    const [manifestResponse, sheetResponse] = await Promise.all([
      fetchImpl(`${origin}/api/pets/${encodeURIComponent(slug)}/files/pet.json`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
      fetchImpl(`${origin}/api/pets/${encodeURIComponent(slug)}/files/spritesheet.webp`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    ]);
    if (!manifestResponse.ok || !sheetResponse.ok) return fail("network", "could not download the pet package files");

    const manifest = await readBodyWithCap(manifestResponse, MAX_MANIFEST_DOWNLOAD_BYTES);
    if ("tooLarge" in manifest) return fail("too-large");
    const sheet = await readBodyWithCap(sheetResponse, MAX_SHEET_DOWNLOAD_BYTES, options.onProgress);
    if ("tooLarge" in sheet) return fail("too-large");
    manifestBytes = manifest;
    sheetBytes = sheet;
  } catch (error) {
    return fail("network", error instanceof Error ? error.message : String(error));
  }

  // 3. Repackage as a standard .codex-pet.zip for the trusted import
  // pipeline. The zip entry name must match the manifest's sheet reference.
  let sheetFileName = "spritesheet.webp";
  let displayName = String(row.name ?? slug);
  try {
    const manifestJson = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes)) as Record<string, unknown>;
    if (typeof manifestJson.displayName === "string" && manifestJson.displayName.trim()) displayName = manifestJson.displayName;
    if (manifestJson.spritesheetPath !== undefined) {
      if (typeof manifestJson.spritesheetPath !== "string" || !isValidSpritesheetFileName(manifestJson.spritesheetPath)) {
        return fail("invalid-package", "downloaded pet.json has an invalid spritesheet reference");
      }
      sheetFileName = manifestJson.spritesheetPath;
    }
  } catch {
    return fail("invalid-package", "downloaded pet.json is not valid JSON");
  }

  try {
    mkdirSync(downloadsDir, { recursive: true });
    const zipPath = join(downloadsDir, `${slug}.codex-pet.zip`);
    writeFileSync(zipPath, zipSync({ "pet.json": manifestBytes, [sheetFileName]: sheetBytes }));
    return {
      ok: true,
      zipPath,
      slug,
      displayName,
      creator: String(row.creator ?? ""),
      galleryUrl: `${origin}/pets/${encodeURIComponent(slug)}`
    };
  } catch (error) {
    return fail("network", error instanceof Error ? error.message : String(error));
  }
}

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupPetDownloads, discardDownloadedPetPack, downloadPetPack } from "../src/main/petPackDownload";
import { inspectPetPackZip } from "../src/main/petPackStore";
import { makeVp8lHeader } from "./helpers/imageFixtures";

const MANIFEST = { id: "boba", displayName: "Boba", description: "A gallery pet.", spritesheetPath: "spritesheet.webp" };
const ROW = {
  slug: "boba",
  name: "Boba",
  creator: "qa-user",
  image_url: "https://assets.example/x/boba/spritesheet.webp",
  asset_path: "x/boba/spritesheet.webp"
};

let downloadsDir: string;

beforeEach(() => {
  downloadsDir = mkdtempSync(join(tmpdir(), "pet-download-"));
});

afterEach(() => {
  rmSync(downloadsDir, { recursive: true, force: true });
});

type RouteMap = Record<string, () => Response | Promise<Response>>;

function makeFetch(routes: RouteMap) {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    for (const [suffix, make] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return make();
    }
    return new Response("not routed", { status: 404 });
  };
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// undici's BodyInit typing rejects generic Uint8Arrays; hand it a plain buffer.
function bytesBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function happyRoutes(overrides: Partial<RouteMap> = {}): RouteMap {
  return {
    "/api/pets/boba": () => jsonResponse({ pet: ROW }),
    "/files/pet.json": () => new Response(JSON.stringify(MANIFEST), { status: 200 }),
    "/files/spritesheet.webp": () => new Response(bytesBody(makeVp8lHeader(1536, 1872)), { status: 200 }),
    ...overrides
  };
}

describe("downloadPetPack", () => {
  it("resolves a slug like the official installer and produces a zip the trusted pipeline accepts", async () => {
    const { impl } = makeFetch(happyRoutes());
    const progress: number[] = [];
    const result = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: impl,
      onProgress: received => progress.push(received)
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("boba");
    expect(result.displayName).toBe("Boba");
    expect(result.creator).toBe("qa-user");
    expect(result.galleryUrl).toBe("https://codex-pet.org/pets/boba");
    expect(existsSync(result.zipPath)).toBe(true);
    expect(progress.length).toBeGreaterThan(0);

    // Full loop: the downloaded package goes through the SAME inspection as
    // a hand-picked file and must pass it.
    const inspected = inspectPetPackZip(result.zipPath);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.staged.manifest.id).toBe("boba");
      expect(inspected.staged.geometry.cellWidth).toBe(192);
    }
  });

  it("rejects malformed slugs without touching the network", async () => {
    const { impl, calls } = makeFetch(happyRoutes());
    // Note: uppercase input is legitimate — it normalizes to lowercase, the
    // same as the official installer.
    for (const slug of ["", "Happy Dog", "a/b", "a_b", "-lead", "trail-"]) {
      const result = await downloadPetPack(slug, downloadsDir, { fetchImpl: impl });
      expect(result.ok, slug).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid-slug");
    }
    expect(calls).toEqual([]);
  });

  it("maps gallery responses to clear failure codes", async () => {
    const notFound = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch({ "/api/pets/boba": () => new Response("", { status: 404 }) }).impl
    });
    expect(notFound).toMatchObject({ ok: false, code: "not-found" });

    const emptyRow = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch({ "/api/pets/boba": () => jsonResponse({}) }).impl
    });
    expect(emptyRow).toMatchObject({ ok: false, code: "not-found" });

    const serverError = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch({ "/api/pets/boba": () => new Response("", { status: 500 }) }).impl
    });
    expect(serverError).toMatchObject({ ok: false, code: "network" });

    const offline = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: async () => { throw new Error("offline"); }
    });
    expect(offline).toMatchObject({ ok: false, code: "network" });
  });

  it("rejects gallery rows that do not point at a spritesheet package", async () => {
    const { impl } = makeFetch(happyRoutes({
      "/api/pets/boba": () => jsonResponse({ pet: { ...ROW, image_url: "https://assets.example/x/boba/cover.png", asset_path: "x/boba/cover.png" } })
    }));
    const result = await downloadPetPack("boba", downloadsDir, { fetchImpl: impl });
    expect(result).toMatchObject({ ok: false, code: "invalid-package" });
  });

  it("enforces the download size caps by header and by stream", async () => {
    const declaredTooBig = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch(happyRoutes({
        "/files/spritesheet.webp": () => new Response(bytesBody(makeVp8lHeader(1536, 1872)), { status: 200, headers: { "content-length": String(26 * 1024 * 1024) } })
      })).impl
    });
    expect(declaredTooBig).toMatchObject({ ok: false, code: "too-large" });

    // No content-length: an unbounded stream must still hit the cap.
    const chunk = new Uint8Array(32 * 1024);
    const streamed = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch(happyRoutes({
        "/files/pet.json": () => new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 3; i++) controller.enqueue(chunk); // 96KB > 64KB manifest cap
            controller.close();
          }
        }), { status: 200 })
      })).impl
    });
    expect(streamed).toMatchObject({ ok: false, code: "too-large" });
  });

  it("discards downloaded archives, hard-confined to the downloads directory", async () => {
    const { impl } = makeFetch(happyRoutes());
    const result = await downloadPetPack("boba", downloadsDir, { fetchImpl: impl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A user-selected zip elsewhere must never be deletable through this
    // endpoint, even via traversal.
    const userDir = mkdtempSync(join(tmpdir(), "user-zips-"));
    const userZip = join(userDir, "precious.codex-pet.zip");
    writeFileSync(userZip, "user data");
    expect(discardDownloadedPetPack(userZip, downloadsDir)).toEqual({ ok: false });
    expect(discardDownloadedPetPack(join(downloadsDir, "..", "escape.zip"), downloadsDir)).toEqual({ ok: false });
    expect(existsSync(userZip)).toBe(true);

    // The downloaded archive itself is removed.
    expect(discardDownloadedPetPack(result.zipPath, downloadsDir)).toEqual({ ok: true });
    expect(existsSync(result.zipPath)).toBe(false);
    rmSync(userDir, { recursive: true, force: true });
  });

  it("wipes crash leftovers at startup and downloads fine afterwards", async () => {
    mkdirSync(downloadsDir, { recursive: true });
    const leftover = join(downloadsDir, "stale.codex-pet.zip");
    writeFileSync(leftover, "leftover");
    cleanupPetDownloads(downloadsDir);
    expect(existsSync(leftover)).toBe(false);

    // The directory is recreated on demand by the next download.
    const { impl } = makeFetch(happyRoutes());
    const result = await downloadPetPack("boba", downloadsDir, { fetchImpl: impl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(existsSync(result.zipPath)).toBe(true);
  });

  it("rejects unusable downloaded manifests", async () => {
    const badJson = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch(happyRoutes({ "/files/pet.json": () => new Response("{ nope", { status: 200 }) })).impl
    });
    expect(badJson).toMatchObject({ ok: false, code: "invalid-package" });

    const traversal = await downloadPetPack("boba", downloadsDir, {
      fetchImpl: makeFetch(happyRoutes({
        "/files/pet.json": () => new Response(JSON.stringify({ ...MANIFEST, spritesheetPath: "../escape.webp" }), { status: 200 })
      })).impl
    });
    expect(traversal).toMatchObject({ ok: false, code: "invalid-package" });
  });
});

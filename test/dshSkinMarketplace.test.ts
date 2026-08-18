import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DshSkinMarketplace, DSH_SKIN_CATALOG_URL } from "../src/main/dshSkinMarketplace";

function response(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name === "content-length" ? String(Buffer.byteLength(text)) : null },
    text: async () => text
  };
}

function skinCatalog(generatedAt = "2026-08-17T00:00:00.000Z") {
  return {
    schemaVersion: 1,
    generatedAt,
    skins: [{
      id: "demo.skin",
      name: { zh: "演示主题", en: "Demo theme" },
      author: "demo",
      description: "A visual theme",
      repo: "https://github.com/demo/skin",
      package: "demo-skin",
      tags: ["dark"],
      modes: ["dark"],
      install: { target: "github:demo/skin#1234567890123456789012345678901234567890", version: "1.0.0", commit: "1234567890123456789012345678901234567890" },
      compatibility: { dsh: "^0.1.0", platform: ["web"] },
      screenshots: ["https://example.com/theme.png"],
      review: { compatibility: "verified", preview: "verified", installation: "verified" },
      license: { code: "MIT", commercialUse: true },
      starsSnapshot: 42,
      releaseUpdatedAt: "2026-08-16T00:00:00.000Z"
    }]
  };
}

describe("DshSkinMarketplace", () => {
  it("caches a validated catalog and retains it when a later refresh fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skins-"));
    const cachePath = join(root, "catalog.json");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(skinCatalog()))
      .mockResolvedValueOnce(response({ error: "offline" }, 503));
    const market = new DshSkinMarketplace({ cachePath, marketInstalled: () => false, fetcher, now: () => 100 });

    const fresh = await market.snapshot();
    expect(fetcher).toHaveBeenCalledWith(DSH_SKIN_CATALOG_URL, expect.anything());
    expect(fresh).toMatchObject({ catalogSource: "remote", skins: [{ id: "demo.skin", stars: 42 }], host: { marketInstalled: false, connected: false } });
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toMatchObject({ version: 1, skins: [{ id: "demo.skin" }] });

    const diskCacheFetcher = vi.fn();
    const reloaded = new DshSkinMarketplace({ cachePath, marketInstalled: () => false, fetcher: diskCacheFetcher, now: () => 101 });
    expect(await reloaded.snapshot()).toMatchObject({ catalogSource: "cache", skins: [{ id: "demo.skin", stars: 42 }] });
    expect(diskCacheFetcher).not.toHaveBeenCalled();

    const cached = await market.snapshot(true);
    expect(cached.catalogSource).toBe("cache");
    expect(cached.catalogError).toContain("HTTP 503");
    expect(cached.skins).toHaveLength(1);
  });

  it("keeps installed and runtime-connected states separate", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skins-host-"));
    const fetcher = vi.fn(async (url: string) => url === DSH_SKIN_CATALOG_URL
      ? response(skinCatalog())
      : response({ skins: [{ skinId: "demo.skin", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }], restartAvailable: true, runningAgentCount: 0 }));
    const market = new DshSkinMarketplace({ cachePath: join(root, "catalog.json"), marketInstalled: () => true, fetcher });

    const snapshot = await market.snapshot();
    expect(snapshot.host).toMatchObject({ connected: true, marketInstalled: true, restartAvailable: true, skins: [{ skinId: "demo.skin", activation: "active" }] });
  });

  it("forwards a same-origin mutation and polls it to completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skins-mutate-"));
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === DSH_SKIN_CATALOG_URL) return response(skinCatalog());
      if (url.endsWith("/install")) {
        expect(init?.headers).toMatchObject({ origin: "http://127.0.0.1:3080" });
        return response({ operationId: "op-1" }, 202);
      }
      if (url.endsWith("/operations/op-1")) return response({ phase: "done" });
      return response({ skins: [], restartAvailable: false });
    });
    const market = new DshSkinMarketplace({ cachePath: join(root, "catalog.json"), marketInstalled: () => true, fetcher, pollDelay: async () => undefined });

    const result = await market.mutate({ skinId: "demo.skin", action: "install" });
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3080/dsh-skin-market/operations/op-1", expect.anything());
  });

  it("marks external activation as restart-required because Desk cannot drive the browser loader", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skins-activate-"));
    const fetcher = vi.fn(async (url: string) => {
      if (url === DSH_SKIN_CATALOG_URL) return response(skinCatalog());
      if (url.endsWith("/activate")) return response({ operationId: "op-2" }, 202);
      if (url.endsWith("/operations/op-2")) return response({ phase: "done" });
      return response({ skins: [{ skinId: "demo.skin", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }], restartAvailable: true });
    });
    const market = new DshSkinMarketplace({ cachePath: join(root, "catalog.json"), marketInstalled: () => true, fetcher, pollDelay: async () => undefined });

    const result = await market.mutate({ skinId: "demo.skin", action: "activate" });
    expect(result).toMatchObject({ ok: true, browserRefreshRequired: true, snapshot: { host: { skins: [{ activation: "restart-required" }] } } });
  });

  it("installs the market into the Web profile only", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skins-install-"));
    const installPlugin = vi.fn(async () => ({ ok: true, restartRequired: true }));
    const market = new DshSkinMarketplace({
      cachePath: join(root, "catalog.json"),
      marketInstalled: () => false,
      fetcher: async () => response(skinCatalog()),
      installPlugin
    });

    const result = await market.installMarket();
    expect(result).toMatchObject({ ok: true, restartRequired: true });
    expect(installPlugin).toHaveBeenCalledWith({ installSpec: "github:kingOfSoySauce/dsh-skin-market", profiles: ["web"] });
  });
});

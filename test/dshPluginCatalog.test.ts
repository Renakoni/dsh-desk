import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DshPluginCatalog, type DshPluginCatalogOptions } from "../src/main/dshPluginCatalog";
import type { DshCommandRunner } from "../src/main/dshPluginManager";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(run?: DshCommandRunner) {
  const root = mkdtempSync(join(tmpdir(), "dsh-plugin-catalog-"));
  roots.push(root);
  const dshHome = join(root, "dsh");
  const options: DshPluginCatalogOptions = {
    dshHome,
    pnpmPath: "C:\\node\\pnpm.cmd",
    marketplaceCachePath: join(root, "marketplace.json"),
    ...(run ? { commandRunner: run } : {})
  };
  return { root, dshHome, options };
}

function writeProfile(dshHome: string, name: string, dependencies: Record<string, string>, bundles: string[]) {
  const profileRoot = join(dshHome, "profiles", name);
  mkdirSync(profileRoot, { recursive: true });
  writeFileSync(join(profileRoot, "package.json"), `${JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies,
    dsh: { profile: { bundles } }
  }, null, 2)}\n`);
  for (const packageName of Object.keys(dependencies)) {
    const packageRoot = join(profileRoot, "node_modules", packageName);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
      name: packageName,
      version: "1.2.3",
      description: `${packageName} description`,
      dsh: { bundle: { patch: "./cordis.patch.yml" } }
    }));
  }
}

describe("DSH plugin catalog", () => {
  it("aggregates profile state and protects DSH and Desk bundles", () => {
    const { dshHome, options } = fixture();
    mkdirSync(join(dshHome, "profiles", "node_modules"), { recursive: true });
    writeProfile(dshHome, "web", { "demo-plugin": "1.2.3", "dsh-desk-plugin": "link:desk" }, [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "demo-plugin",
      "dsh-desk-plugin"
    ]);
    writeProfile(dshHome, "headless", { "demo-plugin": "1.2.3", "dsh-desk-plugin": "link:desk" }, [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-headless",
      "dsh-desk-plugin"
    ]);

    const snapshot = new DshPluginCatalog(options).snapshot();
    expect(snapshot.profiles.map(profile => profile.name)).toEqual(["web", "headless"]);
    expect(snapshot.plugins.find(plugin => plugin.packageName === "@deepseek-ai/dsh-base")).toMatchObject({ kind: "builtin", protected: true });
    expect(snapshot.plugins.find(plugin => plugin.packageName === "dsh-desk-plugin")).toMatchObject({ kind: "desk", protected: true });
    expect(snapshot.plugins.find(plugin => plugin.packageName === "demo-plugin")).toMatchObject({
      kind: "plugin",
      protected: false,
      version: "1.2.3",
      states: [
        expect.objectContaining({ profile: "web", enabled: true, dependencySpec: "1.2.3", bundleCapable: true }),
        expect.objectContaining({ profile: "headless", enabled: false, dependencySpec: "1.2.3", bundleCapable: true })
      ]
    });
  });

  it("discovers custom profile names accepted by DSH", () => {
    const { dshHome, options } = fixture();
    writeProfile(dshHome, "team profile", { "demo-plugin": "1" }, ["demo-plugin"]);

    const catalog = new DshPluginCatalog(options);
    expect(catalog.snapshot().profiles.map(profile => profile.name)).toEqual(["web", "headless", "team profile"]);
    expect(catalog.setEnabled({ packageName: "demo-plugin", profile: "team profile", enabled: false })).toMatchObject({
      ok: true,
      changedProfiles: ["team profile"]
    });
  });

  it("disables without removing dependencies and restores dependency order", () => {
    const { dshHome, options } = fixture();
    writeProfile(dshHome, "web", { "first-plugin": "1", "second-plugin": "1" }, [
      "@deepseek-ai/dsh-base",
      "first-plugin",
      "second-plugin"
    ]);
    const catalog = new DshPluginCatalog(options);

    expect(catalog.setEnabled({ packageName: "first-plugin", profile: "web", enabled: false })).toMatchObject({ ok: true, changedProfiles: ["web"], restartRequired: true });
    let manifest = JSON.parse(readFileSync(join(dshHome, "profiles", "web", "package.json"), "utf8"));
    expect(manifest.dependencies).toEqual({ "first-plugin": "1", "second-plugin": "1" });
    expect(manifest.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "second-plugin"]);

    expect(catalog.setEnabled({ packageName: "first-plugin", profile: "web", enabled: true })).toMatchObject({ ok: true, changedProfiles: ["web"] });
    manifest = JSON.parse(readFileSync(join(dshHome, "profiles", "web", "package.json"), "utf8"));
    expect(manifest.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "first-plugin", "second-plugin"]);
  });

  it("refuses protected and non-bundle state changes", () => {
    const { dshHome, options } = fixture();
    writeProfile(dshHome, "web", { "plain-package": "1" }, ["@deepseek-ai/dsh-base"]);
    const plainManifest = join(dshHome, "profiles", "web", "node_modules", "plain-package", "package.json");
    writeFileSync(plainManifest, JSON.stringify({ name: "plain-package", version: "1" }));
    const catalog = new DshPluginCatalog(options);

    expect(catalog.setEnabled({ packageName: "@deepseek-ai/dsh-base", profile: "web", enabled: false })).toMatchObject({ ok: false, code: "protected-plugin" });
    expect(catalog.setEnabled({ packageName: "plain-package", profile: "web", enabled: true })).toMatchObject({ ok: false, code: "not-a-bundle" });
  });

  it("constructs fixed dsh arguments and rejects unsafe install specs", async () => {
    const calls: string[][] = [];
    const run: DshCommandRunner = vi.fn(async (_command, args) => { calls.push(args); });
    const { options } = fixture(run);
    const catalog = new DshPluginCatalog(options);

    const installed = await catalog.install({ installSpec: "github:owner/dsh-plugin", profiles: ["web", "headless"] });
    expect(installed).toMatchObject({ ok: true, changedProfiles: ["web", "headless"], restartRequired: true });
    expect(calls).toEqual([
      ["dlx", "@deepseek-ai/dsh", "plugin", "--profile", "web", "add", "github:owner/dsh-plugin"],
      ["dlx", "@deepseek-ai/dsh", "plugin", "--profile", "headless", "add", "github:owner/dsh-plugin"]
    ]);

    expect(await catalog.install({ installSpec: "plugin; Remove-Item C:\\", profiles: ["web"] })).toMatchObject({ ok: false, code: "invalid-input" });
    expect(calls).toHaveLength(2);
  });

  it("reports profiles changed before a partial install failure", async () => {
    const run: DshCommandRunner = vi.fn(async (_command, args) => {
      if (args.includes("headless")) throw new Error("headless failed");
    });
    const { options } = fixture(run);

    expect(await new DshPluginCatalog(options).install({ installSpec: "demo-plugin", profiles: ["web", "headless"] })).toMatchObject({
      ok: false,
      changedProfiles: ["web"],
      restartRequired: true,
      error: "headless failed"
    });
  });

  it("keeps disabled bundles disabled when the DSH CLI reconciles a profile", async () => {
    let dshHome = "";
    const setup = fixture(async () => {
      writeProfile(dshHome, "web", { "disabled-plugin": "1", "new-plugin": "1" }, [
        "@deepseek-ai/dsh-base",
        "disabled-plugin",
        "new-plugin"
      ]);
    });
    dshHome = setup.dshHome;
    writeProfile(dshHome, "web", { "disabled-plugin": "1" }, ["@deepseek-ai/dsh-base"]);

    expect(await new DshPluginCatalog(setup.options).install({ installSpec: "new-plugin", profiles: ["web"] })).toMatchObject({ ok: true });
    const manifest = JSON.parse(readFileSync(join(dshHome, "profiles", "web", "package.json"), "utf8"));
    expect(manifest.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "new-plugin"]);
  });

  it("uninstalls dependencies and removes orphaned bundle entries", async () => {
    const calls: string[][] = [];
    const { dshHome, options } = fixture(async (_command, args) => {
      calls.push(args);
      const profile = args[args.indexOf("--profile") + 1];
      if (profile === "web") writeProfile(dshHome, "web", {}, ["@deepseek-ai/dsh-base"]);
    });
    writeProfile(dshHome, "web", { "demo-plugin": "1" }, ["@deepseek-ai/dsh-base", "demo-plugin"]);
    writeProfile(dshHome, "headless", {}, ["@deepseek-ai/dsh-base", "demo-plugin"]);

    const result = await new DshPluginCatalog(options).remove({ packageName: "demo-plugin", profiles: ["web", "headless"] });
    expect(result).toMatchObject({ ok: true, changedProfiles: ["web", "headless"], restartRequired: true });
    expect(calls).toEqual([["dlx", "@deepseek-ai/dsh", "plugin", "--profile", "web", "remove", "demo-plugin"]]);
    expect(result.snapshot.plugins.some(plugin => plugin.packageName === "demo-plugin")).toBe(false);
  });
});

describe("awesome-dsh-plugin marketplace", () => {
  it("validates remote entries, caches them, and falls back to the cache", async () => {
    const catalogPayload = {
      name: "awesome-dsh-plugin",
      url: "https://awesome-dsh-plugin.com/plugins.json",
      updated: "2026-08-14",
      categories: { tool: { en: "Tool", zh: "工具" } },
      plugins: [{
        name: "dsh-demo",
        owner: "demo",
        url: "https://github.com/demo/dsh-demo",
        category: "tool",
        description: { en: "Demo plugin", zh: "演示插件" },
        npm: null,
        stars: 12,
        install: "dsh plugin --profile web add github:demo/dsh-demo",
        added: "2026-08-14"
      }, {
        name: "unsafe",
        owner: "bad",
        url: "https://github.com/bad/unsafe",
        category: "tool",
        description: { en: "Unsafe", zh: "不安全" },
        npm: null,
        install: "dsh plugin --profile web add unsafe;echo-owned",
        added: "2026-08-14"
      }]
    };
    const { options } = fixture();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(catalogPayload), { status: 200 }));
    const remote = await new DshPluginCatalog({ ...options, fetcher, now: () => 100 }).marketplace();
    expect(remote).toMatchObject({ source: "remote", updatedAt: "2026-08-14" });
    expect(remote.plugins).toEqual([expect.objectContaining({ name: "dsh-demo", installSpec: "github:demo/dsh-demo" })]);

    const unavailable = vi.fn(async () => { throw new Error("offline"); });
    const cached = await new DshPluginCatalog({ ...options, fetcher: unavailable, now: () => 200 }).marketplace(true);
    expect(cached).toMatchObject({ source: "cache", error: "offline" });
    expect(cached.plugins).toHaveLength(1);
  });

  it("keeps a valid remote catalog when the cache cannot be written", async () => {
    const { root, options } = fixture();
    const blockedParent = join(root, "blocked");
    writeFileSync(blockedParent, "not a directory");
    const payload = {
      plugins: [{
        name: "dsh-demo",
        owner: "demo",
        url: "https://github.com/demo/dsh-demo",
        category: "tool",
        description: { en: "Demo", zh: "演示" },
        npm: null,
        install: "dsh plugin --profile web add github:demo/dsh-demo",
        added: "2026-08-14"
      }]
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const result = await new DshPluginCatalog({ ...options, marketplaceCachePath: join(blockedParent, "cache.json"), fetcher }).marketplace();
    expect(result).toMatchObject({ source: "remote", plugins: [expect.objectContaining({ name: "dsh-demo" })] });
  });
});

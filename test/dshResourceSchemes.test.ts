import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DshResourceSchemeManager, dshDesiredPluginStates, inheritDshPluginPackageStates } from "../src/main/dshResourceSchemes";
import { dshSkillResources, scanDshSkills } from "../src/main/dshSkillCatalog";
import type { DshResourceInventory } from "../src/shared/dshResources";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function writeSkill(root: string, name: string) {
  const directory = join(root, "skills", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
}

describe("DSH resource schemes", () => {
  it("retains package aliases when the live Loader inventory arrives", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-runtime-"));
    roots.push(root);
    let live = false;
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({
        skills: [],
      plugins: live
          ? [{ id: "plugin:runtime-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: true }]
          : [{ id: "plugin:package:demo", kind: "plugin", name: "demo", enabled: true, manageable: false, schemeSelectable: true }],
        scannedAt: 1,
        runtimeConnected: live
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:demo"]);
    live = true;
    const projectedPlugins = manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins ?? [];
    expect(projectedPlugins).toEqual(["plugin:package:demo"]);
    let persisted = JSON.parse(readFileSync(join(root, "schemes.json"), "utf8"));
    expect(persisted.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);
    expect(manager.save({ id: "default", name: "Default", skills: [], plugins: projectedPlugins }).ok).toBe(true);
    persisted = JSON.parse(readFileSync(join(root, "schemes.json"), "utf8"));
    expect(persisted.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);
  });

  it("canonicalizes a legacy alias plus runtime pair when its mapping becomes available", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-legacy-pair-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        { id: "default", name: "Default", skills: [], plugins: ["plugin:package:demo", "plugin:runtime-entry"], isProtected: true, createdAt: 1, updatedAt: 1 },
        { id: "all", name: "All", skills: [], plugins: ["plugin:package:demo", "plugin:runtime-entry"], isProtected: true, createdAt: 1, updatedAt: 1 }
      ],
      appliedSchemeId: "default"
    }));
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [{ id: "plugin:runtime-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: true }],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:demo"]);
    const persisted = JSON.parse(readFileSync(storePath, "utf8"));
    expect(persisted.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);
    expect(persisted.pluginRuntimePackages).toEqual({ "plugin:runtime-entry": "demo" });
  });

  it("does not assign one protected profile component to an arbitrary runtime package", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-shared-profile-component-"));
    roots.push(root);
    const packageNames = ["@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-headless"];
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({
        skills: [],
        plugins: packageNames.map(packageName => ({
          id: `plugin:package:${packageName}`,
          kind: "plugin" as const,
          name: packageName,
          packageName,
          enabled: true,
          manageable: false,
          schemeSelectable: true,
          required: true,
          sourceIds: ["plugin:include:code-runtime"]
        })),
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    const current = manager.snapshot();
    expect(current.pluginRuntimePackages).toEqual({});
    expect(current.schemes.find(scheme => scheme.id === "all")?.plugins).toEqual(
      packageNames.map(packageName => `plugin:package:${packageName}`)
    );
  });

  it("migrates a legacy runtime-only selection back to package semantics", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-legacy-runtime-only-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        { id: "default", name: "Default", skills: [], plugins: ["plugin:web-entry"], isProtected: true, createdAt: 1, updatedAt: 1 },
        { id: "all", name: "All", skills: [], plugins: ["plugin:web-entry"], isProtected: true, createdAt: 1, updatedAt: 1 }
      ],
      appliedSchemeId: "default"
    }));
    type Phase = "offline" | "headless" | "web" | "both";
    let phase: Phase = "offline";
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: phase === "offline"
          ? [{ id: "plugin:package:demo", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: false, schemeSelectable: true }]
          : phase === "headless"
            ? [{ id: "plugin:headless-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: false, manageable: true }]
          : [
            { id: "plugin:web-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: true },
            ...(phase === "both"
              ? [{ id: "plugin:headless-entry", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: false, manageable: true }]
              : [])
          ],
        scannedAt: 1,
        runtimeConnected: phase !== "offline"
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:web-entry"]);
    const pending = JSON.parse(readFileSync(storePath, "utf8"));
    expect(pending.legacyRuntimePluginIds).toEqual(["plugin:web-entry"]);

    phase = "headless";
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({});

    phase = "web";
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:demo"]);
    const migrated = JSON.parse(readFileSync(storePath, "utf8"));
    expect(migrated.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);
    expect(migrated.legacyRuntimePluginIds).toEqual([]);

    phase = "both";
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({ "web-entry": true, "headless-entry": true });
  });

  it("migrates a runtime-only baseline already stamped with package metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-stamped-runtime-only-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        { id: "default", name: "Default", skills: [], plugins: ["plugin:web-entry"], isProtected: true, createdAt: 1, updatedAt: 1 },
        { id: "all", name: "All", skills: [], plugins: ["plugin:web-entry"], isProtected: true, createdAt: 1, updatedAt: 1 }
      ],
      pluginRuntimePackages: { "plugin:web-entry": "demo" },
      appliedSchemeId: "default"
    }));
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [{ id: "plugin:web-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: true }],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    manager.snapshot();
    const migrated = JSON.parse(readFileSync(storePath, "utf8"));
    expect(migrated.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);
    expect(migrated.legacyRuntimePluginIds).toEqual([]);
  });

  it("initializes a live Web runtime with package-level selection", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-live-initial-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    let headlessConnected = false;
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [
          { id: "plugin:web-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: true },
          ...(headlessConnected
            ? [{ id: "plugin:headless-entry", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: false, manageable: true }]
            : [])
        ],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    const projectedPlugins = manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins ?? [];
    expect(projectedPlugins).toEqual(["plugin:package:demo"]);
    expect(manager.save({ id: "default", name: "Default", skills: [], plugins: projectedPlugins }).ok).toBe(true);
    const persisted = JSON.parse(readFileSync(storePath, "utf8"));
    expect(persisted.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);

    headlessConnected = true;
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({ "web-entry": true, "headless-entry": true });
  });

  for (const departure of ["web-only", "offline"] as const) {
    it(`keeps alias-derived runtime IDs out of persisted schemes after Headless becomes ${departure}`, () => {
      const root = mkdtempSync(join(tmpdir(), `dsh-schemes-canonical-${departure}-`));
      roots.push(root);
      const storePath = join(root, "schemes.json");
      type Phase = "offline" | "headless" | "web-only";
      let phase: Phase = "offline";
      const desired: Array<Record<string, boolean>> = [];
      const manager = new DshResourceSchemeManager({
        storePath,
        inventory: () => ({
          skills: [],
          plugins: phase === "offline"
            ? [{ id: "plugin:package:headless-plugin", kind: "plugin", name: "headless-plugin", packageName: "headless-plugin", enabled: true, manageable: false, schemeSelectable: true }]
            : phase === "headless"
              ? [{ id: "plugin:headless-entry", kind: "plugin", name: "headless-plugin", packageName: "headless-plugin", enabled: true, manageable: true }]
              : [{ id: "plugin:web-entry", kind: "plugin", name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: true }],
          scannedAt: 1,
          runtimeConnected: phase !== "offline"
        }),
        setDesiredSkills: () => undefined,
        setDesiredPlugins: states => desired.push(states),
        now: () => 10
      });

      expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:headless-plugin"]);
      phase = "headless";
      expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:headless-plugin"]);
      const liveStore = JSON.parse(readFileSync(storePath, "utf8"));
      expect(liveStore.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:headless-plugin"]);
      expect(liveStore.pluginRuntimePackages).toMatchObject({ "plugin:headless-entry": "headless-plugin" });

      phase = departure === "offline" ? "offline" : "web-only";
      expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:headless-plugin"]);
      const departedStore = JSON.parse(readFileSync(storePath, "utf8"));
      expect(departedStore.pluginRuntimePackages).toMatchObject({ "plugin:headless-entry": "headless-plugin" });
      expect(manager.save({ id: "default", name: "Default", skills: [], plugins: [] }).ok).toBe(true);
      const removedStore = JSON.parse(readFileSync(storePath, "utf8"));
      expect(removedStore.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual([]);
      expect(removedStore.pluginRuntimePackages).toMatchObject({ "plugin:headless-entry": "headless-plugin" });

      phase = "headless";
      expect(manager.apply("default").ok).toBe(true);
      expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([]);
      expect(desired.at(-1)).toEqual({ "headless-entry": false });
    });
  }

  it("canonicalizes every runtime selection to one package-level switch", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-explicit-runtime-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    let live = false;
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: live ? [
          { id: "plugin:runtime-a", kind: "plugin", name: "demo-a", packageName: "demo", enabled: true, manageable: true },
          { id: "plugin:runtime-b", kind: "plugin", name: "demo-b", packageName: "demo", enabled: true, manageable: true }
        ] : [
          { id: "plugin:package:demo", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: false, schemeSelectable: true }
        ],
        scannedAt: 1,
        runtimeConnected: live
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    manager.snapshot();
    live = true;
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:demo"]);
    expect(manager.save({ id: "default", name: "Default", skills: [], plugins: ["plugin:runtime-b"] }).ok).toBe(true);
    const store = JSON.parse(readFileSync(storePath, "utf8"));
    expect(store.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual(["plugin:package:demo"]);
    expect(store.pluginRuntimePackages).toMatchObject({
      "plugin:runtime-a": "demo",
      "plugin:runtime-b": "demo"
    });

    live = false;
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:demo"]);
    live = true;
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({ "runtime-a": true, "runtime-b": true });
    expect(manager.setResourceState({ schemeId: "default", resourceId: "plugin:package:demo", enabled: false }).ok).toBe(true);
    expect(desired.at(-1)).toEqual({ "runtime-a": false, "runtime-b": false });
  });

  it("keeps one package baseline across later profiles and runtime disconnects", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-runtime-baseline-"));
    roots.push(root);
    type Phase = "offline" | "web" | "web-headless";
    let phase: Phase = "offline";
    const desired: Array<Record<string, boolean>> = [];
    const offlinePlugins: DshResourceInventory["plugins"] = [
      { id: "plugin:package:@deepseek-ai/dsh-base", kind: "plugin", name: "DSH Base", packageName: "@deepseek-ai/dsh-base", enabled: true, manageable: false, schemeSelectable: true, required: true },
      { id: "plugin:package:third-party", kind: "plugin", name: "third-party", packageName: "third-party", enabled: true, manageable: false, schemeSelectable: true },
      { id: "plugin:package:other-plugin", kind: "plugin", name: "other-plugin", packageName: "other-plugin", enabled: false, manageable: false, schemeSelectable: true }
    ];
    const webPlugins: DshResourceInventory["plugins"] = [
      { id: "plugin:web:third", kind: "plugin", name: "third-party", packageName: "third-party", enabled: true, manageable: true },
      { id: "plugin:web:other", kind: "plugin", name: "other-plugin", packageName: "other-plugin", enabled: true, manageable: true }
    ];
    const inventory = (): DshResourceInventory => ({
      skills: [],
      plugins: phase === "offline"
        ? offlinePlugins
        : phase === "web"
          ? webPlugins
          : [...webPlugins, { id: "plugin:headless:third", kind: "plugin", name: "third-party", packageName: "third-party", enabled: false, manageable: true }],
      scannedAt: 1,
      runtimeConnected: phase !== "offline"
    });
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory,
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:@deepseek-ai/dsh-base",
      "plugin:package:third-party"
    ]);

    phase = "web";
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:@deepseek-ai/dsh-base",
      "plugin:package:third-party"
    ]);
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({
      "web:third": true,
      "web:other": false
    });

    phase = "web-headless";
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toContain("plugin:package:third-party");
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({
      "web:third": true,
      "web:other": false,
      "headless:third": true
    });

    phase = "offline";
    const disconnected = manager.snapshot();
    expect(disconnected.schemes.find(scheme => scheme.id === "all")?.plugins).toEqual([
      "plugin:package:@deepseek-ai/dsh-base",
      "plugin:package:third-party",
      "plugin:package:other-plugin"
    ]);
    expect(disconnected.pluginRuntimePackages).toMatchObject({
      "plugin:web:third": "third-party",
      "plugin:headless:third": "third-party",
      "plugin:web:other": "other-plugin"
    });
    expect(disconnected.schemes.find(scheme => scheme.id === "default")?.plugins).toContain("plugin:package:third-party");
  });

  it("keeps unresolved package placeholders instead of expanding a precise scheme", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-unresolved-runtime-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        { id: "default", name: "Default", skills: [], plugins: ["plugin:package:unknown-bundle", "plugin:known-runtime"], isProtected: true, createdAt: 1, updatedAt: 1 },
        { id: "all", name: "All", skills: [], plugins: ["plugin:package:unknown-bundle", "plugin:known-runtime"], isProtected: true, createdAt: 1, updatedAt: 1 }
      ],
      appliedSchemeId: "default"
    }));
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [
          { id: "plugin:known-runtime", kind: "plugin", name: "known", enabled: true, manageable: true },
          { id: "plugin:new-runtime", kind: "plugin", name: "new", enabled: true, manageable: true }
        ],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    expect(manager.apply("default").ok).toBe(true);
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:unknown-bundle",
      "plugin:package:known"
    ]);
    expect(desired.at(-1)).toEqual({ "known-runtime": true, "new-runtime": false });
  });

  it("removes legacy internal-module aliases when package inventory becomes authoritative", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-package-migration-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        {
          id: "default",
          name: "Default",
          skills: [],
          plugins: ["plugin:package:aggregate-bundle", "plugin:package:internal-helper", "plugin:package:removed-bundle"],
          isProtected: true,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: "all",
          name: "All",
          skills: [],
          plugins: ["plugin:package:aggregate-bundle", "plugin:package:internal-helper"],
          isProtected: true,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      pluginRuntimePackages: { "plugin:include:helper": "internal-helper" },
      legacyRuntimePluginIds: [],
      appliedSchemeId: "default"
    }));
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [{
          id: "plugin:package:aggregate-bundle",
          kind: "plugin",
          name: "aggregate-bundle",
          packageName: "aggregate-bundle",
          enabled: true,
          manageable: true,
          schemeSelectable: true,
          sourceIds: ["plugin:include:helper"]
        }],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    const snapshot = manager.snapshot();
    expect(snapshot.schemes.find(scheme => scheme.id === "all")?.plugins).toEqual([
      "plugin:package:aggregate-bundle"
    ]);
    expect(snapshot.schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:aggregate-bundle",
      "plugin:package:removed-bundle"
    ]);
    expect(snapshot.pluginRuntimePackages).toEqual({ "plugin:include:helper": "aggregate-bundle" });
  });

  it("publishes one desired state per top-level package alias", () => {
    const resources: DshResourceInventory["plugins"] = [
      { id: "plugin:package:aggregate-bundle", kind: "plugin", name: "Aggregate", packageName: "aggregate-bundle", enabled: true, manageable: true },
      { id: "plugin:package:other-bundle", kind: "plugin", name: "Other", packageName: "other-bundle", enabled: true, manageable: true }
    ];
    expect(dshDesiredPluginStates(
      resources,
      new Set(["plugin:package:aggregate-bundle"]),
      new Set(["aggregate-bundle", "other-bundle"])
    )).toEqual({ "aggregate-bundle": true, "other-bundle": false });
  });

  it("recovers a non-active scheme package selection when Headless connects after Web", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-late-headless-non-active-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    type Phase = "offline" | "web" | "both";
    let phase: Phase = "offline";
    const inventory = (): DshResourceInventory => ({
      skills: [],
      plugins: phase === "offline" ? [
        { id: "plugin:package:web-plugin", kind: "plugin", name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: false, schemeSelectable: true },
        { id: "plugin:package:headless-plugin", kind: "plugin", name: "headless-plugin", packageName: "headless-plugin", enabled: true, manageable: false, schemeSelectable: true }
      ] : [
        { id: "plugin:web", kind: "plugin", name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: true },
        ...(phase === "both" ? [{ id: "plugin:headless", kind: "plugin" as const, name: "headless-plugin", packageName: "headless-plugin", enabled: true, manageable: true }] : [])
      ],
      scannedAt: 1,
      runtimeConnected: phase !== "offline"
    });
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory,
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });
    const created = manager.save({ name: "Headless only", skills: [], plugins: ["plugin:package:headless-plugin"] });
    expect(created.ok).toBe(true);
    const schemeId = created.ok ? created.schemeId : "";

    phase = "web";
    expect(manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.plugins).toEqual([
      "plugin:package:headless-plugin"
    ]);
    const persistedAfterWeb = JSON.parse(readFileSync(storePath, "utf8"));
    expect(persistedAfterWeb.schemes.find((scheme: { id: string }) => scheme.id === schemeId).plugins).toContain("plugin:package:headless-plugin");

    phase = "both";
    expect(manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.plugins).toEqual(["plugin:package:headless-plugin"]);
  });

  it("enables a selected Headless plugin even when it first appears disabled", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-late-headless-disabled-"));
    roots.push(root);
    type Phase = "offline" | "web" | "both";
    let phase: Phase = "offline";
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({
        skills: [],
        plugins: phase === "offline" ? [
          { id: "plugin:package:web-plugin", kind: "plugin", name: "web-plugin", packageName: "web-plugin", enabled: false, manageable: false, schemeSelectable: true },
          { id: "plugin:package:headless-plugin", kind: "plugin", name: "headless-plugin", packageName: "headless-plugin", enabled: true, manageable: false, schemeSelectable: true }
        ] : [
          { id: "plugin:web", kind: "plugin", name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: true },
          ...(phase === "both" ? [{ id: "plugin:headless", kind: "plugin" as const, name: "headless-plugin", packageName: "headless-plugin", enabled: false, manageable: true }] : [])
        ],
        scannedAt: 1,
        runtimeConnected: phase !== "offline"
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    manager.snapshot();
    phase = "web";
    manager.snapshot();
    phase = "both";
    expect(manager.apply("default").ok).toBe(true);
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toContain("plugin:package:headless-plugin");
    expect(desired.at(-1)).toEqual({ web: false, headless: true });
  });

  it("applies Skill membership without deletion and publishes manageable plugin state", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    const agentsHome = join(root, "agents");
    writeSkill(dshHome, "first-skill");
    writeSkill(dshHome, "second-skill");
    const desired: Array<Record<string, boolean>> = [];
    const desiredSkills: Array<Record<string, boolean>> = [];
    const desiredSkillDefaults: boolean[] = [];
    let desiredSkillStates: Record<string, boolean> = {};
    const inventory = (): DshResourceInventory => ({
      skills: dshSkillResources(scanDshSkills(dshHome, agentsHome), desiredSkillStates),
      plugins: [
        { id: "plugin:core", kind: "plugin", name: "core", enabled: true, manageable: false, required: true },
        { id: "plugin:third", kind: "plugin", name: "third", enabled: true, manageable: true }
      ],
      scannedAt: 1,
      runtimeConnected: true
    });
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory,
      setDesiredSkills: (states, defaultEnabled) => {
        desiredSkills.push(states);
        desiredSkillDefaults.push(defaultEnabled);
        desiredSkillStates = { ...states };
      },
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });
    const created = manager.save({ name: "Focused", skills: ["skill:name:first-skill"], plugins: ["plugin:core" ] });
    expect(created.ok).toBe(true);
    const schemeId = created.ok ? created.schemeId : "";
    expect(manager.apply(schemeId).ok).toBe(true);
    expect(existsSync(join(dshHome, "skills", "first-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dshHome, "skills", "second-skill", "SKILL.md"))).toBe(true);
    expect(desired.at(-1)).toEqual({ third: false });
    expect(desiredSkills.at(-1)).toEqual({ "first-skill": true, "second-skill": false });
    expect(desiredSkillDefaults.at(-1)).toBe(false);
    expect(manager.snapshot().inventory.skills.find(skill => skill.id === "skill:name:second-skill")?.enabled).toBe(false);

    const memberSkills = manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.skills;
    expect(manager.setResourceState({ schemeId, resourceId: "skill:name:second-skill", enabled: true }).ok).toBe(true);
    expect(manager.snapshot().inventory.skills.find(skill => skill.id === "skill:name:second-skill")?.enabled).toBe(true);
    expect(manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.skills).toEqual(memberSkills);
    expect(manager.setResourceState({ schemeId, resourceId: "skill:name:second-skill", enabled: false }).ok).toBe(true);

    expect(manager.setResourceState({ schemeId, resourceId: "skill:name:first-skill", enabled: false }).ok).toBe(true);
    expect(manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.skills).toEqual(memberSkills);
    expect(manager.snapshot().inventory.skills.find(skill => skill.id === "skill:name:first-skill")?.enabled).toBe(false);
    expect(existsSync(join(dshHome, "skills", "first-skill", "SKILL.md"))).toBe(true);

    desiredSkillStates = {};
    const restarted = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory,
      setDesiredSkills: states => { desiredSkills.push(states); desiredSkillStates = { ...states }; },
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });
    expect(restarted.snapshot().schemes.find(scheme => scheme.id === schemeId)?.skills).toEqual(memberSkills);
    expect(restarted.snapshot().inventory.skills.find(skill => skill.id === "skill:name:first-skill")?.enabled).toBe(true);
    expect(existsSync(join(dshHome, "skills", "first-skill", "SKILL.md"))).toBe(true);

    expect(manager.apply(schemeId).ok).toBe(true);
    expect(manager.snapshot().inventory.skills.find(skill => skill.id === "skill:name:first-skill")?.enabled).toBe(true);
    expect(manager.setResourceState({ schemeId, resourceId: "plugin:core", enabled: false }).ok).toBe(false);
    expect(manager.apply("all").ok).toBe(true);
    expect(desiredSkillDefaults.at(-1)).toBe(true);
  });

  it("treats same-name Skill sources as one runtime capability", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-shared-skill-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    const agentsHome = join(root, "agents");
    writeSkill(dshHome, "shared-skill");
    writeSkill(agentsHome, "shared-skill");
    let desiredSkillStates: Record<string, boolean> = {};
    const published: Array<Record<string, boolean>> = [];
    const inventory = (): DshResourceInventory => ({
      skills: dshSkillResources(scanDshSkills(dshHome, agentsHome), desiredSkillStates),
      plugins: [],
      scannedAt: 1,
      runtimeConnected: true
    });
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory,
      setDesiredSkills: states => { published.push(states); desiredSkillStates = { ...states }; },
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    expect(manager.snapshot().inventory.skills).toEqual([
      expect.objectContaining({ id: "skill:name:shared-skill", sourceIds: ["skill:user-dsh:shared-skill", "skill:user-agents:shared-skill"] })
    ]);
    const created = manager.save({ name: "No shared Skill", skills: [], plugins: [] });
    expect(created.ok).toBe(true);
    const schemeId = created.ok ? created.schemeId : "";
    expect(manager.apply(schemeId).ok).toBe(true);
    expect(published.at(-1)).toEqual({ "shared-skill": false });
    expect(existsSync(join(dshHome, "skills", "shared-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(agentsHome, "skills", "shared-skill", "SKILL.md"))).toBe(true);
  });

  it("migrates source-specific Skill IDs to the logical name ID", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-skill-migration-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    const agentsHome = join(root, "agents");
    const storePath = join(root, "schemes.json");
    writeSkill(dshHome, "shared-skill");
    writeSkill(agentsHome, "shared-skill");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        { id: "default", name: "Default", skills: ["skill:user-dsh:shared-skill"], plugins: [], isProtected: true, createdAt: 1, updatedAt: 1 },
        { id: "all", name: "All", skills: ["skill:user-dsh:shared-skill", "skill:user-agents:shared-skill"], plugins: [], isProtected: true, createdAt: 1, updatedAt: 1 }
      ],
      appliedSchemeId: "default"
    }));
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: dshSkillResources(scanDshSkills(dshHome, agentsHome), {}),
        plugins: [],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    const migrated = manager.snapshot();
    expect(migrated.schemes.find(scheme => scheme.id === "default")?.skills).toEqual(["skill:name:shared-skill"]);
    expect(migrated.schemes.find(scheme => scheme.id === "all")?.skills).toEqual(["skill:name:shared-skill"]);
  });

  it("maps package aliases in every custom scheme without rebuilding selections", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-custom-runtime-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    let live = false;
    const inventory = () => ({
      skills: [],
      plugins: live
        ? [
          { id: "plugin:runtime-a", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: true, manageable: true },
          { id: "plugin:runtime-b", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: true, manageable: true },
          { id: "plugin:runtime-other", kind: "plugin" as const, name: "other", packageName: "other", enabled: true, manageable: true }
        ]
        : [
          { id: "plugin:package:demo", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: true, manageable: false, schemeSelectable: true },
          { id: "plugin:package:other", kind: "plugin" as const, name: "other", packageName: "other", enabled: true, manageable: false, schemeSelectable: true }
        ],
      scannedAt: 1,
      runtimeConnected: live
    });
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory,
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });
    const created = manager.save({ name: "Focused", skills: [], plugins: ["plugin:package:demo"] });
    expect(created.ok).toBe(true);
    const schemeId = created.ok ? created.schemeId : "";
    live = true;

    const snapshot = manager.snapshot();
    expect(snapshot.schemes.find(scheme => scheme.id === schemeId)?.plugins).toEqual(["plugin:package:demo"]);
    expect(snapshot.schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:demo",
      "plugin:package:other"
    ]);
    const persisted = JSON.parse(readFileSync(storePath, "utf8"));
    expect(persisted.schemes.find((scheme: { id: string }) => scheme.id === schemeId).plugins).toEqual(["plugin:package:demo"]);
    expect(persisted.schemes.find((scheme: { id: string }) => scheme.id === "default").plugins).toEqual([
      "plugin:package:demo",
      "plugin:package:other"
    ]);
    expect(manager.apply(schemeId).ok).toBe(true);
    expect(desired.at(-1)).toEqual({ "runtime-a": true, "runtime-b": true, "runtime-other": false });
    const persistedAfterApply = JSON.parse(readFileSync(storePath, "utf8"));
    expect(persistedAfterApply.schemes.find((scheme: { id: string }) => scheme.id === schemeId).plugins).toEqual(["plugin:package:demo"]);
  });

  it("inherits one package state when another runtime entry appears", () => {
    const resources: DshResourceInventory["plugins"] = [
      { id: "plugin:web-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: false, manageable: true },
      { id: "plugin:headless-entry", kind: "plugin", name: "demo", packageName: "demo", enabled: true, manageable: true }
    ];
    expect(inheritDshPluginPackageStates(
      resources,
      { "web-entry": true, "headless-entry": true },
      { "web-entry": false },
      { "plugin:web-entry": "demo", "plugin:headless-entry": "demo" }
    )).toEqual({ "web-entry": false, "headless-entry": false });
    expect(inheritDshPluginPackageStates(
      resources,
      { "web-entry": false, "headless-entry": false },
      { "web-entry": true },
      { "plugin:web-entry": "demo", "plugin:headless-entry": "demo" }
    )).toEqual({ "web-entry": true, "headless-entry": true });
  });

  it("keeps live component changes temporary and restores the active scheme baseline", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-components-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    const published: Array<Record<string, Record<string, boolean>>> = [];
    let desiredComponents: Record<string, Record<string, boolean>> = {};
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [{
          id: "plugin:package:@deepseek-ai/dsh-base",
          kind: "plugin",
          name: "@deepseek-ai/dsh-base",
          packageName: "@deepseek-ai/dsh-base",
          enabled: true,
          manageable: false,
          required: true,
          components: [{
            key: "include:timer",
            name: "timer",
            moduleName: "@deepseek-ai/cordis-plugin-timer",
            baselineEnabled: true,
            enabled: true,
            manageable: true,
            fiberPhase: "active"
          }]
        }],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      setDesiredPluginComponents: states => {
        desiredComponents = states;
        published.push(states);
      },
      getDesiredPluginComponents: () => desiredComponents,
      now: () => 10
    });

    expect(manager.setPluginComponentState({
      schemeId: "default",
      packageName: "@deepseek-ai/dsh-base",
      componentKey: "include:timer",
      state: "disabled"
    }).ok).toBe(true);
    expect(published.at(-1)).toEqual({ "@deepseek-ai/dsh-base": { "include:timer": false } });
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.pluginComponentOverrides).toEqual([]);
    expect(JSON.parse(readFileSync(storePath, "utf8")).schemes
      .find((scheme: { id: string }) => scheme.id === "default").pluginComponentOverrides).toEqual([]);

    expect(manager.setPluginComponentState({
      schemeId: "default",
      packageName: "@deepseek-ai/dsh-base",
      componentKey: "include:timer",
      state: "default"
    }).ok).toBe(true);
    expect(published.at(-1)).toEqual({});
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.pluginComponentOverrides).toEqual([]);
  });

  it("persists component policy in a scheme and publishes it when the scheme is applied", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-component-policy-"));
    roots.push(root);
    const published: Array<Record<string, Record<string, boolean>>> = [];
    let desiredComponents: Record<string, Record<string, boolean>> = {};
    const packageName = "@deepseek-ai/dsh-base";
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({
        skills: [],
        plugins: [{
          id: `plugin:package:${packageName}`,
          kind: "plugin",
          name: packageName,
          packageName,
          enabled: true,
          manageable: false,
          required: true,
          components: [{ key: "include:timer", name: "timer", moduleName: "timer", baselineEnabled: true, enabled: true, manageable: true, fiberPhase: "active" }]
        }],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      setDesiredPluginComponents: states => {
        desiredComponents = states;
        published.push(states);
      },
      getDesiredPluginComponents: () => desiredComponents,
      now: () => 10
    });

    expect(manager.save({
      id: "default",
      name: "Default",
      skills: [],
      plugins: [`plugin:package:${packageName}`],
      pluginComponentOverrides: [{ packageName, componentKey: "include:timer", state: "disabled" }]
    }).ok).toBe(true);
    expect(manager.apply("default").ok).toBe(true);
    expect(published.at(-1)).toEqual({ [packageName]: { "include:timer": false } });
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.pluginComponentOverrides).toEqual([{
      packageName,
      componentKey: "include:timer",
      state: "disabled"
    }]);

    expect(manager.setPluginComponentState({
      schemeId: "default",
      packageName,
      componentKey: "include:timer",
      state: "enabled"
    }).ok).toBe(true);
    expect(published.at(-1)).toEqual({ [packageName]: { "include:timer": true } });
    expect(manager.setPluginComponentState({
      schemeId: "default",
      packageName,
      componentKey: "include:timer",
      state: "default"
    }).ok).toBe(true);
    expect(published.at(-1)).toEqual({ [packageName]: { "include:timer": false } });
  });

  it("rejects component changes for the Desk bridge and drops overrides for packages removed from a scheme", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-component-guard-"));
    roots.push(root);
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({
        skills: [],
        plugins: [{
          id: "plugin:package:dsh-desk-plugin",
          kind: "plugin",
          name: "dsh-desk-plugin",
          packageName: "dsh-desk-plugin",
          enabled: true,
          manageable: false,
          required: true,
          components: [{ key: "include:dsh-desk", name: "dsh-desk", moduleName: "dsh-desk-plugin", baselineEnabled: true, enabled: true, manageable: false, fiberPhase: "active" }]
        }, {
          id: "plugin:package:demo",
          kind: "plugin",
          name: "demo",
          packageName: "demo",
          enabled: true,
          manageable: true,
          components: [{ key: "include:demo", name: "demo", moduleName: "demo", baselineEnabled: true, enabled: true, manageable: true, fiberPhase: "active" }]
        }],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      setDesiredPluginComponents: () => undefined,
      now: () => 10
    });

    expect(manager.setPluginComponentState({ schemeId: "default", packageName: "dsh-desk-plugin", componentKey: "include:dsh-desk", state: "disabled" }).ok).toBe(false);
    const created = manager.save({
      name: "Fine",
      skills: [],
      plugins: ["plugin:package:demo"],
      pluginComponentOverrides: [{ packageName: "demo", componentKey: "include:demo", state: "disabled" }]
    });
    expect(created.ok).toBe(true);
    const schemeId = created.ok ? created.schemeId : "";
    const removed = manager.save({ id: schemeId, name: "Fine", skills: [], plugins: [] });
    expect(removed.ok).toBe(true);
    expect(manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.pluginComponentOverrides).toEqual([]);
  });

  it("keeps a missing resource record when an existing scheme is saved", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-missing-"));
    roots.push(root);
    const missingId = "plugin:package:dsh-chara-desk";
    let installed = true;
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({
        skills: [],
        plugins: installed ? [{ id: missingId, kind: "plugin", name: "dsh-chara-desk", enabled: true, manageable: false }] : [],
        scannedAt: 1,
        runtimeConnected: false
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([missingId]);
    installed = false;
    const result = manager.save({ id: "default", name: "Default", skills: [], plugins: [missingId] });

    expect(result.ok).toBe(true);
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([missingId]);
  });

  it("keeps base themes out of plugin state and enforces one theme per scheme", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-themes-"));
    roots.push(root);
    const themes: DshResourceInventory["plugins"] = [
      {
        id: "plugin:package:theme-a",
        kind: "plugin",
        name: "Theme A",
        packageName: "theme-a",
        enabled: true,
        manageable: true,
        appearance: { kind: "theme-bundle", components: ["base-theme", "wallpaper"], themeId: "theme-a", active: true }
      },
      {
        id: "plugin:package:theme-b",
        kind: "plugin",
        name: "Theme B",
        packageName: "theme-b",
        enabled: false,
        manageable: true,
        appearance: { kind: "theme-bundle", components: ["base-theme"], themeId: "theme-b", active: false }
      },
      { id: "plugin:package:feature", kind: "plugin", name: "Feature", packageName: "feature", enabled: true, manageable: true }
    ];
    const desired: Array<Record<string, boolean>> = [];
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({ skills: [], plugins: themes, scannedAt: 1, runtimeConnected: true }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });

    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")).toMatchObject({ themeId: "theme-a", plugins: ["plugin:package:feature"] });
    expect(dshDesiredPluginStates(themes, new Set(["plugin:package:theme-a", "plugin:package:feature"]), new Set())).toEqual({ feature: true });
    expect(manager.save({ name: "Two themes", skills: [], plugins: ["plugin:package:theme-a", "plugin:package:theme-b"] })).toMatchObject({ ok: false, issues: [{ code: "multiple-themes" }] });

    const created = manager.save({ name: "Theme B scheme", skills: [], plugins: [], themeId: "theme-b" });
    expect(created).toMatchObject({ ok: true });
    const schemeId = created.ok ? created.schemeId : "";
    const order: string[] = [];
    const asyncManager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory: () => ({ skills: [], plugins: themes, scannedAt: 1, runtimeConnected: true }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: states => desired.push(states),
      applyTheme: async themeId => { order.push(`theme:${themeId}`); return undefined; },
      now: () => 10
    });
    await expect(asyncManager.applyAsync(schemeId)).resolves.toMatchObject({ ok: true, schemeId });
    expect(order).toEqual(["theme:theme-b"]);
  });

  it("migrates legacy theme package selections into the scheme theme slot", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-theme-migration-"));
    roots.push(root);
    const storePath = join(root, "schemes.json");
    writeFileSync(storePath, JSON.stringify({
      schemaVersion: 1,
      schemes: [
        { id: "default", name: "Default", skills: [], plugins: ["plugin:package:theme-a", "plugin:package:theme-b"], isProtected: true, createdAt: 1, updatedAt: 1 },
        { id: "all", name: "All", skills: [], plugins: ["plugin:package:theme-a", "plugin:package:theme-b"], isProtected: true, createdAt: 1, updatedAt: 1 }
      ],
      appliedSchemeId: "default"
    }));
    const manager = new DshResourceSchemeManager({
      storePath,
      inventory: () => ({
        skills: [],
        plugins: [
          { id: "plugin:package:theme-a", kind: "plugin", name: "Theme A", packageName: "theme-a", enabled: true, manageable: true, appearance: { kind: "theme", components: ["base-theme"], themeId: "theme-a", active: false } },
          { id: "plugin:package:theme-b", kind: "plugin", name: "Theme B", packageName: "theme-b", enabled: true, manageable: true, appearance: { kind: "theme", components: ["base-theme"], themeId: "theme-b", active: true } }
        ],
        scannedAt: 1,
        runtimeConnected: true
      }),
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });

    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")).toMatchObject({ themeId: "theme-b", plugins: [] });
    expect(JSON.parse(readFileSync(storePath, "utf8")).schemes[0].themeId).toBe("theme-b");
  });

  it("persists a temporary theme override without downloading a package", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-theme-override-"));
    roots.push(root);
    const inventory = (): DshResourceInventory => ({
      skills: [],
      plugins: [{
        id: "plugin:package:theme-a",
        kind: "plugin",
        name: "Theme A",
        packageName: "theme-a",
        enabled: true,
        manageable: true,
        appearance: { kind: "theme", components: ["base-theme"], themeId: "theme-a", active: true }
      }],
      scannedAt: 1,
      runtimeConnected: true
    });
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      inventory,
      setDesiredSkills: () => undefined,
      setDesiredPlugins: () => undefined,
      now: () => 10
    });
    expect(manager.setThemeOverride({ mode: "temporary", themeId: "not-installed" })).toMatchObject({ ok: false, issues: [{ code: "missing-theme" }] });
    expect(manager.setThemeOverride({ mode: "disabled" })).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(join(root, "schemes.json"), "utf8")).themeOverride).toEqual({ mode: "disabled" });
  });
});

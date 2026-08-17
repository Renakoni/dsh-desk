import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DshResourceSchemeManager } from "../src/main/dshResourceSchemes";
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
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:demo",
      "plugin:runtime-entry"
    ]);
  });

  it("builds a safe live baseline for bundle entries, later profiles, and runtime disconnects", () => {
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
      { id: "plugin:web:include", kind: "plugin", name: "include", packageName: "include", enabled: true, manageable: true },
      { id: "plugin:web:third", kind: "plugin", name: "third-party", packageName: "third-party", enabled: true, manageable: true },
      { id: "plugin:web:other", kind: "plugin", name: "other-plugin", packageName: "other-plugin", enabled: true, manageable: true }
    ];
    const inventory = (): DshResourceInventory => ({
      skills: [],
      plugins: phase === "offline"
        ? offlinePlugins
        : phase === "web"
          ? webPlugins
          : [...webPlugins, { id: "plugin:headless:timer", kind: "plugin", name: "timer", packageName: "timer", enabled: true, manageable: true }],
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
      "plugin:package:third-party",
      "plugin:web:third"
    ]);
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).toEqual({
      "web:third": true,
      "web:other": false
    });

    phase = "web-headless";
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).not.toContain("plugin:headless:timer");
    expect(manager.apply("default").ok).toBe(true);
    expect(desired.at(-1)).not.toHaveProperty("headless:timer");

    const liveAll = manager.snapshot().schemes.find(scheme => scheme.id === "all")?.plugins;
    phase = "offline";
    const disconnected = manager.snapshot();
    expect(disconnected.schemes.find(scheme => scheme.id === "all")?.plugins).toEqual(liveAll);
    expect(disconnected.schemes.find(scheme => scheme.id === "default")?.plugins).not.toContain("plugin:headless:timer");
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
      "plugin:known-runtime"
    ]);
    expect(Object.values(desired.at(-1) ?? {})).not.toContain(false);
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
    expect(manager.snapshot().schemes.find(scheme => scheme.id === schemeId)?.plugins).toEqual([
      "plugin:package:headless-plugin",
      "plugin:headless"
    ]);
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
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toContain("plugin:headless");
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
      storePath: join(root, "schemes.json"),
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
    expect(snapshot.schemes.find(scheme => scheme.id === schemeId)?.plugins).toEqual(["plugin:package:demo", "plugin:runtime-a", "plugin:runtime-b"]);
    expect(snapshot.schemes.find(scheme => scheme.id === "default")?.plugins).toEqual([
      "plugin:package:demo",
      "plugin:runtime-a",
      "plugin:runtime-b",
      "plugin:package:other",
      "plugin:runtime-other"
    ]);
    expect(manager.apply(schemeId).ok).toBe(true);
    expect(desired.at(-1)).toEqual({ "runtime-a": true, "runtime-b": true, "runtime-other": false });
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
});

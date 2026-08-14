import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DshResourceSchemeManager } from "../src/main/dshResourceSchemes";
import { scanDshSkills } from "../src/main/dshSkillCatalog";
import type { DshResourceInventory } from "../src/shared/dshResources";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function writeSkill(root: string, name: string) {
  const directory = join(root, "skills", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
}

describe("DSH resource schemes", () => {
  it("replaces package placeholders when the live Loader inventory arrives", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-runtime-"));
    roots.push(root);
    let live = false;
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      dshHome: join(root, "dsh"),
      inventory: () => ({
        skills: [],
        plugins: live
          ? [{ id: "plugin:runtime-entry", kind: "plugin", name: "runtime", enabled: true, manageable: true }]
          : [{ id: "plugin:package:demo", kind: "plugin", name: "demo", enabled: true, manageable: false }],
        scannedAt: 1,
        runtimeConnected: live
      }),
      setDesiredPlugins: () => undefined,
      now: () => 10
    });
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:package:demo"]);
    live = true;
    expect(manager.snapshot().schemes.find(scheme => scheme.id === "default")?.plugins).toEqual(["plugin:runtime-entry"]);
  });

  it("applies Skill membership without deletion and publishes manageable plugin state", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-schemes-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    const agentsHome = join(root, "agents");
    writeSkill(dshHome, "first-skill");
    writeSkill(dshHome, "second-skill");
    const desired: Array<Record<string, boolean>> = [];
    const inventory = (): DshResourceInventory => ({
      skills: scanDshSkills(dshHome, agentsHome).skills.map(skill => ({ id: skill.id, kind: "skill", name: skill.name, enabled: skill.enabled && skill.active, manageable: skill.manageable })),
      plugins: [
        { id: "plugin:core", kind: "plugin", name: "core", enabled: true, manageable: false },
        { id: "plugin:third", kind: "plugin", name: "third", enabled: true, manageable: true }
      ],
      scannedAt: 1,
      runtimeConnected: true
    });
    const manager = new DshResourceSchemeManager({
      storePath: join(root, "schemes.json"),
      dshHome,
      inventory,
      setDesiredPlugins: states => desired.push(states),
      now: () => 10
    });
    const created = manager.save({ name: "Focused", skills: ["skill:user-dsh:first-skill"], plugins: ["plugin:core" ] });
    expect(created.ok).toBe(true);
    const schemeId = created.ok ? created.schemeId : "";
    expect(manager.apply(schemeId).ok).toBe(true);
    expect(existsSync(join(dshHome, "skills", "first-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dshHome, ".dsh-desk", "disabled-skills", "second-skill", "SKILL.md"))).toBe(true);
    expect(desired.at(-1)).toEqual({ third: false });
    expect(manager.snapshot().inventory.skills.find(skill => skill.id === "skill:user-dsh:second-skill")?.enabled).toBe(false);
  });
});

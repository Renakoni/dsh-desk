import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canRevealDshSkillPath, dshSkillResources, restoreLegacyDisabledDshSkills, scanDshSkills } from "../src/main/dshSkillCatalog";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function skill(root: string, directory: string, frontmatter: string) {
  const path = join(root, directory);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `---\n${frontmatter}\n---\nBody\n`);
  return path;
}

describe("DSH skill inventory", () => {
  it("scans real-world PDF and frontend Skill frontmatter without losing the resources", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skills-real-frontmatter-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    const agentsHome = join(root, "agents");
    skill(join(dshHome, "skills"), "pdf", [
      "name: pdf",
      "description: Use this skill whenever the user wants to do anything with PDF files.",
      "license: Proprietary. LICENSE.txt has complete terms",
    ].join("\n"));
    skill(join(dshHome, "skills"), "impeccable", [
      "name: impeccable",
      'description: "Use when the user wants to design, redesign, or audit a frontend interface."',
      'argument-hint: "[{{command_hint}}] [target]"',
      "allowed-tools:",
      "  - Bash(npx impeccable *)",
      "license: Apache 2.0",
    ].join("\n"));

    const snapshot = scanDshSkills(dshHome, agentsHome);
    expect(snapshot.skills.filter(skill => skill.active).map(skill => skill.name)).toEqual(["impeccable", "pdf"]);
    expect(dshSkillResources(snapshot, {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "skill:name:impeccable", name: "impeccable", enabled: true }),
      expect.objectContaining({ id: "skill:name:pdf", name: "pdf", enabled: true })
    ]));
  });

  it("matches user-root precedence and invocation frontmatter", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skills-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    const agentsHome = join(root, "agents");
    const activeDirectory = skill(join(dshHome, "skills"), "shared-skill", "name: shared-skill\ndescription: DSH copy\ndisable-model-invocation: true");
    skill(join(agentsHome, "skills"), "shared-skill", "name: shared-skill\ndescription: Agents copy");
    const flatRoot = join(agentsHome, "skills");
    mkdirSync(flatRoot, { recursive: true });
    writeFileSync(join(flatRoot, "flat-skill.md"), "---\nname: flat-skill\ndescription: Flat skill\nuser-invocable: false\n---\nBody\n");
    skill(join(dshHome, "skills", ".system"), "hidden", "name: hidden\ndescription: Hidden");

    const snapshot = scanDshSkills(dshHome, agentsHome);
    expect(snapshot.skills).toEqual([
      expect.objectContaining({ name: "flat-skill", source: "user-agents", active: true, manageable: false, userInvocable: false }),
      expect.objectContaining({ name: "shared-skill", source: "user-dsh", active: true, modelInvocable: false }),
      expect.objectContaining({ name: "shared-skill", source: "user-agents", active: false })
    ]);
    expect(canRevealDshSkillPath(activeDirectory, dshHome, agentsHome)).toBe(true);
    expect(canRevealDshSkillPath(join(dshHome, "settings.yaml"), dshHome, agentsHome)).toBe(false);

    const resources = dshSkillResources(snapshot, {});
    expect(resources).toHaveLength(2);
    expect(resources.find(resource => resource.name === "shared-skill")).toMatchObject({
      id: "skill:name:shared-skill",
      manageable: true,
      sourceIds: ["skill:user-dsh:shared-skill", "skill:user-agents:shared-skill"]
    });
    expect(dshSkillResources(snapshot, { "shared-skill": false }).find(resource => resource.name === "shared-skill")?.enabled).toBe(false);
  });

  it("restores legacy hidden Skills without overwriting an active collision", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skills-restore-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    skill(join(dshHome, "skills"), "shared-skill", "name: shared-skill\ndescription: Active copy");
    skill(join(dshHome, ".dsh-desk", "disabled-skills"), "shared-skill", "name: shared-skill\ndescription: Hidden copy");
    skill(join(dshHome, ".dsh-desk", "disabled-skills"), "hidden-only", "name: hidden-only\ndescription: Hidden only");
    writeFileSync(join(dshHome, "skills", "flat-skill.md"), "---\nname: flat-skill\ndescription: Active flat copy\n---\n");
    writeFileSync(join(dshHome, ".dsh-desk", "disabled-skills", "flat-skill.md"), "---\nname: flat-skill\ndescription: Hidden flat copy\n---\n");

    expect(restoreLegacyDisabledDshSkills(dshHome)).toBe(3);
    const snapshot = scanDshSkills(dshHome, join(root, "agents"));
    expect(snapshot.skills.filter(item => item.name === "shared-skill")).toHaveLength(2);
    expect(snapshot.skills.filter(item => item.name === "flat-skill")).toHaveLength(2);
    expect(snapshot.skills.find(item => item.name === "hidden-only")?.enabled).toBe(true);
    expect(restoreLegacyDisabledDshSkills(dshHome)).toBe(0);
  });
});

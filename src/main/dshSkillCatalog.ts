import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DshSkillItem, DshSkillSnapshot, DshSkillSource } from "../shared/dshPlugins";
import { resolveDshHome } from "./dshPaths";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;

type SkillRoot = {
  source: DshSkillSource;
  path: string;
  rank: number;
  skipSystem: boolean;
};

type Frontmatter = Record<string, unknown>;

export function resolveDshAgentsHome(): string {
  return resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents"));
}

export function dshSkillRoots(dshHome = resolveDshHome(), agentsHome = resolveDshAgentsHome()): SkillRoot[] {
  return [
    { source: "user-dsh", path: join(dshHome, "skills"), rank: 400, skipSystem: true },
    { source: "user-agents", path: join(agentsHome, "skills"), rank: 500, skipSystem: false }
  ];
}

function entryKind(filePath: string, directory: boolean, file: boolean, symbolicLink: boolean): "directory" | "file" | null {
  if (directory) return "directory";
  if (file) return "file";
  if (!symbolicLink) return null;
  try {
    const info = statSync(filePath);
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
  } catch {
    // Match DSH discovery: a broken or unreadable symlink is not a skill.
  }
  return null;
}

function frontmatter(raw: string): Frontmatter | null {
  const normalized = raw.replace(/^\uFEFF/, "");
  const firstBreak = normalized.indexOf("\n");
  if (firstBreak < 0 || normalized.slice(0, firstBreak).replace(/\r$/, "") !== "---") return null;
  let lineStart = firstBreak + 1;
  while (lineStart <= normalized.length) {
    const nextBreak = normalized.indexOf("\n", lineStart);
    const lineEnd = nextBreak < 0 ? normalized.length : nextBreak;
    if (normalized.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      const parsed = parseYaml(normalized.slice(firstBreak + 1, lineStart));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Frontmatter : null;
    }
    if (nextBreak < 0) return null;
    lineStart = nextBreak + 1;
  }
  return null;
}

function frontmatterBoolean(data: Frontmatter, key: string): boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    if (["true", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "no", "off"].includes(value.toLowerCase())) return false;
  }
  throw new Error(`${key} must be a boolean`);
}

function readSkill(filePath: string, directory: string, root: SkillRoot): DshSkillItem | null {
  try {
    const info = statSync(filePath);
    if (!info.isFile() || info.size > MAX_SKILL_FILE_BYTES) return null;
    const data = frontmatter(readFileSync(filePath, "utf8"));
    if (!data) return null;
    const name = typeof data.name === "string" ? data.name : "";
    const description = typeof data.description === "string" ? data.description : "";
    if (!SKILL_NAME.test(name) || !description) return null;
    const modelInvocable = frontmatterBoolean(data, "disable-model-invocation") !== true;
    const userInvocable = frontmatterBoolean(data, "user-invocable") !== false;
    return {
      id: `${root.source}:${resolve(filePath)}`,
      name,
      description,
      path: resolve(filePath),
      directory: resolve(directory),
      source: root.source,
      active: true,
      modelInvocable,
      userInvocable
    };
  } catch {
    return null;
  }
}

function scanRoot(root: SkillRoot): DshSkillItem[] {
  if (!existsSync(root.path)) return [];
  const skills: DshSkillItem[] = [];
  let entries;
  try {
    entries = readdirSync(root.path, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (root.skipSystem && entry.name === ".system") continue;
    const fullPath = join(root.path, entry.name);
    const kind = entryKind(fullPath, entry.isDirectory(), entry.isFile(), entry.isSymbolicLink());
    const filePath = kind === "directory"
      ? join(fullPath, "SKILL.md")
      : kind === "file" && extname(entry.name).toLowerCase() === ".md"
        ? fullPath
        : null;
    if (!filePath) continue;
    const skill = readSkill(filePath, kind === "directory" ? fullPath : dirname(fullPath), root);
    if (skill) skills.push(skill);
  }
  return skills;
}

export function scanDshSkills(dshHome = resolveDshHome(), agentsHome = resolveDshAgentsHome()): DshSkillSnapshot {
  const roots = dshSkillRoots(dshHome, agentsHome);
  const ranked = roots.flatMap(root => scanRoot(root).map(skill => ({ skill, rank: root.rank })));
  ranked.sort((left, right) => left.skill.name.localeCompare(right.skill.name) || left.rank - right.rank || left.skill.path.localeCompare(right.skill.path));
  const activeNames = new Set<string>();
  const skills = ranked.map(({ skill }) => {
    const active = !activeNames.has(skill.name);
    activeNames.add(skill.name);
    return active ? skill : { ...skill, active: false };
  });
  return {
    skills,
    roots: roots.map(root => ({ source: root.source, path: root.path })),
    scannedAt: Date.now()
  };
}

export function canRevealDshSkillPath(filePath: string, dshHome = resolveDshHome(), agentsHome = resolveDshAgentsHome()): boolean {
  if (typeof filePath !== "string" || !filePath) return false;
  const target = resolve(filePath);
  return scanDshSkills(dshHome, agentsHome).skills.some(skill => skill.path === target || skill.directory === target);
}

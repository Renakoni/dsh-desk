import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import type {
  DshMarketplaceSkill,
  DshSkillInstallResult,
  DshSkillMarketplaceSnapshot,
  DshSkillRepo,
  DshSkillRepoMutationResult
} from "../shared/dshPlugins";
import { writeTextFileAtomic } from "./filePersistence";
import { scanDshSkills } from "./dshSkillCatalog";

const REPO_PART = /^[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const DEFAULT_REPOS: DshSkillRepo[] = [
  { owner: "anthropics", name: "skills", branch: "main", enabled: true },
  { owner: "ComposioHQ", name: "awesome-claude-skills", branch: "master", enabled: true },
  { owner: "cexll", name: "myclaude", branch: "master", enabled: true },
  { owner: "JimLiu", name: "baoyu-skills", branch: "main", enabled: true }
];

type Archive = { branch: string; files: Record<string, Uint8Array> };

export type DshSkillMarketplaceOptions = {
  dshHome: string;
  storePath: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

function validRepo(repo: DshSkillRepo): boolean {
  return REPO_PART.test(repo.owner) && REPO_PART.test(repo.name) && BRANCH.test(repo.branch) && !repo.branch.includes("..") && typeof repo.enabled === "boolean";
}

function loadRepos(path: string): DshSkillRepo[] {
  if (!existsSync(path)) {
    writeTextFileAtomic(path, `${JSON.stringify({ repos: DEFAULT_REPOS }, null, 2)}\n`);
    return DEFAULT_REPOS.map(repo => ({ ...repo }));
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { repos?: unknown };
  if (!Array.isArray(parsed.repos)) throw new Error("Skill repository settings are invalid.");
  const repos = parsed.repos.filter((repo): repo is DshSkillRepo => Boolean(repo) && typeof repo === "object" && validRepo(repo as DshSkillRepo));
  if (repos.length !== parsed.repos.length) throw new Error("Skill repository settings are invalid.");
  return repos;
}

function saveRepos(path: string, repos: DshSkillRepo[]): void {
  writeTextFileAtomic(path, `${JSON.stringify({ repos }, null, 2)}\n`);
}

function safeArchivePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === "..")) return null;
  return parts.join("/");
}

function stripArchiveRoot(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const output: Record<string, Uint8Array> = {};
  for (const [rawPath, contents] of Object.entries(files)) {
    if (rawPath.endsWith("/")) continue;
    const safe = safeArchivePath(rawPath);
    if (!safe) throw new Error("Repository archive contains an unsafe path.");
    const slash = safe.indexOf("/");
    if (slash < 0 || slash === safe.length - 1) continue;
    output[safe.slice(slash + 1)] = contents;
  }
  return output;
}

function frontmatter(raw: string): Record<string, unknown> | null {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const parsed = parseYaml(match[1]);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

export function discoverSkillsInArchive(repo: DshSkillRepo, archive: Archive, installedNames: ReadonlySet<string>): DshMarketplaceSkill[] {
  const skillFiles = Object.keys(archive.files)
    .filter(path => posix.basename(path).toLocaleLowerCase() === "skill.md")
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
  const acceptedDirectories: string[] = [];
  const skills: DshMarketplaceSkill[] = [];
  for (const filePath of skillFiles) {
    const directory = posix.dirname(filePath) === "." ? "" : posix.dirname(filePath);
    if (acceptedDirectories.some(parent => directory === parent || directory.startsWith(`${parent}/`))) continue;
    let data: Record<string, unknown> | null;
    try { data = frontmatter(strFromU8(archive.files[filePath])); } catch { data = null; }
    const name = typeof data?.name === "string" ? data.name : "";
    const description = typeof data?.description === "string" ? data.description : "";
    if (!SKILL_NAME.test(name) || !description) continue;
    acceptedDirectories.push(directory);
    skills.push({
      key: `${repo.owner}/${repo.name}:${directory || "."}`,
      name,
      description,
      directory,
      repoOwner: repo.owner,
      repoName: repo.name,
      repoBranch: archive.branch,
      installed: installedNames.has(name.toLocaleLowerCase())
    });
  }
  return skills;
}

export class DshSkillMarketplace {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: DshSkillMarketplaceOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private async download(repo: DshSkillRepo): Promise<Archive> {
    const branches = [...new Set([repo.branch, "main", "master"])];
    let lastError = "Repository could not be downloaded.";
    for (const branch of branches) {
      try {
        const response = await this.fetcher(`https://codeload.github.com/${repo.owner}/${repo.name}/zip/refs/heads/${branch}`, {
          headers: { accept: "application/zip" }
        });
        if (!response.ok) {
          lastError = `${repo.owner}/${repo.name} ${branch}: HTTP ${response.status}`;
          continue;
        }
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_ARCHIVE_BYTES) throw new Error("Repository archive is too large.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Repository archive is too large.");
        const files = stripArchiveRoot(unzipSync(bytes));
        const unpacked = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
        if (unpacked > MAX_UNPACKED_BYTES) throw new Error("Repository archive expands beyond the allowed size.");
        return { branch, files };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(lastError);
  }

  async snapshot(): Promise<DshSkillMarketplaceSnapshot> {
    const repos = loadRepos(this.options.storePath);
    const installedNames = new Set(scanDshSkills(this.options.dshHome).skills.map(skill => skill.name.toLocaleLowerCase()));
    const results = await Promise.all(repos.filter(repo => repo.enabled).map(async repo => {
      try {
        const archive = await this.download(repo);
        return { skills: discoverSkillsInArchive(repo, archive, installedNames), error: null };
      } catch (error) {
        return { skills: [], error: `${repo.owner}/${repo.name}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }));
    const byKey = new Map<string, DshMarketplaceSkill>();
    for (const result of results) for (const skill of result.skills) byKey.set(skill.key, skill);
    return {
      repos,
      skills: [...byKey.values()].sort((left, right) => left.name.toLocaleLowerCase().localeCompare(right.name.toLocaleLowerCase()) || left.key.localeCompare(right.key)),
      scannedAt: this.now(),
      errors: results.flatMap(result => result.error ? [result.error] : [])
    };
  }

  async addRepo(repo: DshSkillRepo): Promise<DshSkillRepoMutationResult> {
    const normalized = { ...repo, owner: repo.owner.trim(), name: repo.name.trim(), branch: repo.branch.trim() || "main", enabled: true };
    if (!validRepo(normalized)) return { ok: false, error: "GitHub repository settings are invalid." };
    const repos = loadRepos(this.options.storePath);
    if (repos.some(item => item.owner.toLocaleLowerCase() === normalized.owner.toLocaleLowerCase() && item.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
      return { ok: false, error: "Repository already exists." };
    }
    saveRepos(this.options.storePath, [...repos, normalized]);
    return { ok: true, snapshot: await this.snapshot() };
  }

  async removeRepo(owner: string, name: string): Promise<DshSkillRepoMutationResult> {
    const repos = loadRepos(this.options.storePath);
    const next = repos.filter(repo => !(repo.owner === owner && repo.name === name));
    if (next.length === repos.length) return { ok: false, error: "Repository no longer exists." };
    saveRepos(this.options.storePath, next);
    return { ok: true, snapshot: await this.snapshot() };
  }

  async install(skill: DshMarketplaceSkill): Promise<DshSkillInstallResult> {
    try {
      const repo: DshSkillRepo = { owner: skill.repoOwner, name: skill.repoName, branch: skill.repoBranch, enabled: true };
      if (!validRepo(repo) || !SKILL_NAME.test(skill.name) || skill.key !== `${repo.owner}/${repo.name}:${skill.directory || "."}`) {
        throw new Error("Skill installation request is invalid.");
      }
      const archive = await this.download(repo);
      const discovered = discoverSkillsInArchive(repo, archive, new Set()).find(item => item.key === skill.key && item.name === skill.name);
      if (!discovered) throw new Error("Skill no longer exists in the repository.");
      const destination = resolve(this.options.dshHome, "skills", discovered.name);
      const skillsRoot = resolve(this.options.dshHome, "skills");
      if (dirname(destination) !== skillsRoot || existsSync(destination)) throw new Error("A Skill with this name is already installed.");
      const prefix = discovered.directory ? `${discovered.directory}/` : "";
      const entries = Object.entries(archive.files).filter(([path]) => path === `${discovered.directory}/SKILL.md` || path.startsWith(prefix));
      mkdirSync(skillsRoot, { recursive: true });
      mkdirSync(destination, { recursive: false });
      try {
        for (const [path, contents] of entries) {
          const entryRelative = prefix ? path.slice(prefix.length) : path;
          const safe = safeArchivePath(entryRelative);
          if (!safe) throw new Error("Skill contains an unsafe path.");
          const target = resolve(destination, ...safe.split("/"));
          const relativeTarget = relative(destination, target);
          if (!relativeTarget || isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith(`..\\`) || relativeTarget.startsWith("../")) {
            throw new Error("Skill contains an unsafe path.");
          }
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, contents);
        }
      } catch (error) {
        rmSync(destination, { recursive: true, force: true });
        throw error;
      }
      return { ok: true, snapshot: scanDshSkills(this.options.dshHome) };
    } catch (error) {
      return { ok: false, snapshot: scanDshSkills(this.options.dshHome), error: error instanceof Error ? error.message : String(error) };
    }
  }
}

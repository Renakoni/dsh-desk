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
const ARCHIVE_TIMEOUT_MS = 10_000;
const STARS_TIMEOUT_MS = 5_000;
const CACHE_REFRESH_MS = 12 * 60 * 60 * 1000;
const MARKETPLACE_CACHE_VERSION = 1;
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
  cachePath?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

type CachedSkill = Omit<DshMarketplaceSkill, "installed">;
type CachedRepo = { key: string; fetchedAt: number; skills: CachedSkill[] };
type MarketplaceCache = { version: number; repos: CachedRepo[] };

class MarketplaceTimeoutError extends Error {
  constructor() {
    super("The request timed out.");
    this.name = "MarketplaceTimeoutError";
  }
}

function repoCacheKey(repo: DshSkillRepo): string {
  return `${repo.owner}/${repo.name}:${repo.branch}`;
}

function isCachedSkill(value: unknown): value is CachedSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const skill = value as Partial<CachedSkill>;
  return typeof skill.key === "string"
    && typeof skill.name === "string"
    && typeof skill.description === "string"
    && typeof skill.directory === "string"
    && typeof skill.readmeUrl === "string"
    && typeof skill.repoOwner === "string"
    && typeof skill.repoName === "string"
    && typeof skill.repoBranch === "string"
    && (skill.stars === null || (typeof skill.stars === "number" && Number.isFinite(skill.stars) && skill.stars >= 0));
}

function readMarketplaceCache(path: string): MarketplaceCache {
  if (!existsSync(path)) return { version: MARKETPLACE_CACHE_VERSION, repos: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MarketplaceCache>;
    if (parsed.version !== MARKETPLACE_CACHE_VERSION || !Array.isArray(parsed.repos)) return { version: MARKETPLACE_CACHE_VERSION, repos: [] };
    const repos = parsed.repos.filter(item => Boolean(item) && typeof item === "object" && typeof item.key === "string" && typeof item.fetchedAt === "number" && Number.isFinite(item.fetchedAt) && Array.isArray(item.skills) && item.skills.every(isCachedSkill)) as CachedRepo[];
    return { version: MARKETPLACE_CACHE_VERSION, repos };
  } catch {
    return { version: MARKETPLACE_CACHE_VERSION, repos: [] };
  }
}

function saveMarketplaceCache(path: string, cache: MarketplaceCache): void {
  try { writeTextFileAtomic(path, `${JSON.stringify(cache, null, 2)}\n`); } catch { /* A read-only cache must not hide live results. */ }
}

function hydrateSkills(skills: CachedSkill[], installedNames: ReadonlySet<string>): DshMarketplaceSkill[] {
  return skills.map(skill => ({ ...skill, installed: installedNames.has(skill.name.toLocaleLowerCase()) }));
}

function withoutInstalled(skill: DshMarketplaceSkill): CachedSkill {
  const { installed: _installed, ...cached } = skill;
  return cached;
}

async function withTimeout<T>(promise: Promise<T>, controller: AbortController, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new MarketplaceTimeoutError());
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function unzipDshSkillArchive(bytes: Uint8Array, maxUnpackedBytes = MAX_UNPACKED_BYTES): Record<string, Uint8Array> {
  let unpacked = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      unpacked += file.originalSize;
      if (unpacked > maxUnpackedBytes) throw new Error("Repository archive expands beyond the allowed size.");
      return true;
    }
  });
  return stripArchiveRoot(files);
}

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

export function discoverSkillsInArchive(
  repo: DshSkillRepo,
  archive: Archive,
  installedNames: ReadonlySet<string>,
  stars: number | null = null
): DshMarketplaceSkill[] {
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
      readmeUrl: `https://github.com/${repo.owner}/${repo.name}/blob/${archive.branch}/${directory ? `${directory}/` : ""}SKILL.md`,
      repoOwner: repo.owner,
      repoName: repo.name,
      repoBranch: archive.branch,
      stars,
      installed: installedNames.has(name.toLocaleLowerCase())
    });
  }
  return skills;
}

export class DshSkillMarketplace {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly cachePath: string;
  private refreshPromise: Promise<DshSkillMarketplaceSnapshot> | null = null;

  constructor(private readonly options: DshSkillMarketplaceOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.cachePath = options.cachePath ?? `${options.storePath}.cache.json`;
  }

  private async download(repo: DshSkillRepo): Promise<Archive> {
    const branches = [...new Set([repo.branch, "main", "master"])];
    let lastError = "Repository could not be downloaded.";
    for (const branch of branches) {
      const controller = new AbortController();
      try {
        const response = await withTimeout(this.fetcher(`https://codeload.github.com/${repo.owner}/${repo.name}/zip/refs/heads/${branch}`, {
          signal: controller.signal,
          headers: { accept: "application/zip" }
        }), controller, ARCHIVE_TIMEOUT_MS);
        if (!response.ok) {
          lastError = `${repo.owner}/${repo.name} ${branch}: HTTP ${response.status}`;
          continue;
        }
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_ARCHIVE_BYTES) throw new Error("Repository archive is too large.");
        const bytes = new Uint8Array(await withTimeout(response.arrayBuffer(), controller, ARCHIVE_TIMEOUT_MS));
        if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Repository archive is too large.");
        const files = unzipDshSkillArchive(bytes);
        const unpacked = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
        if (unpacked > MAX_UNPACKED_BYTES) throw new Error("Repository archive expands beyond the allowed size.");
        return { branch, files };
      } catch (error) {
        if (error instanceof MarketplaceTimeoutError) throw error;
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        controller.abort();
      }
    }
    throw new Error(lastError);
  }

  private async repositoryStars(repo: DshSkillRepo): Promise<number | null> {
    const controller = new AbortController();
    try {
      const response = await withTimeout(this.fetcher(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
        signal: controller.signal,
        headers: { accept: "application/vnd.github+json" }
      }), controller, STARS_TIMEOUT_MS);
      if (!response.ok) return null;
      const data = await withTimeout(response.json() as Promise<{ stargazers_count?: unknown }>, controller, STARS_TIMEOUT_MS);
      return typeof data.stargazers_count === "number" && Number.isFinite(data.stargazers_count) && data.stargazers_count >= 0
        ? data.stargazers_count
        : null;
    } catch {
      return null;
    } finally {
      controller.abort();
    }
  }

  private composeSnapshot(repos: DshSkillRepo[], results: Array<{ skills: DshMarketplaceSkill[]; error: string | null }>): DshSkillMarketplaceSnapshot {
    const byKey = new Map<string, DshMarketplaceSkill>();
    for (const result of results) for (const skill of result.skills) byKey.set(skill.key, skill);
    return {
      repos,
      skills: [...byKey.values()].sort((left, right) => left.name.toLocaleLowerCase().localeCompare(right.name.toLocaleLowerCase()) || left.key.localeCompare(right.key)),
      scannedAt: this.now(),
      errors: results.flatMap(result => result.error ? [result.error] : [])
    };
  }

  private async refresh(repos: DshSkillRepo[], installedNames: ReadonlySet<string>): Promise<DshSkillMarketplaceSnapshot> {
    if (this.refreshPromise) return this.refreshPromise;
    const promise = this.fetchSnapshot(repos, installedNames).finally(() => { this.refreshPromise = null; });
    this.refreshPromise = promise;
    return promise;
  }

  private async fetchSnapshot(repos: DshSkillRepo[], installedNames: ReadonlySet<string>): Promise<DshSkillMarketplaceSnapshot> {
    const cache = readMarketplaceCache(this.cachePath);
    const cachedByKey = new Map(cache.repos.map(item => [item.key, item]));
    const results = await Promise.all(repos.filter(repo => repo.enabled).map(async repo => {
      const key = repoCacheKey(repo);
      const cached = cachedByKey.get(key);
      try {
        const [archive, stars] = await Promise.all([this.download(repo), this.repositoryStars(repo)]);
        const skills = discoverSkillsInArchive(repo, archive, installedNames, stars);
        cachedByKey.set(key, { key, fetchedAt: this.now(), skills: skills.map(withoutInstalled) });
        return { skills, error: null };
      } catch (error) {
        return {
          skills: cached ? hydrateSkills(cached.skills, installedNames) : [],
          error: `${repo.owner}/${repo.name}: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }));
    saveMarketplaceCache(this.cachePath, { version: MARKETPLACE_CACHE_VERSION, repos: [...cachedByKey.values()] });
    return this.composeSnapshot(repos, results);
  }

  async snapshot(force = false): Promise<DshSkillMarketplaceSnapshot> {
    const repos = loadRepos(this.options.storePath);
    const installedNames = new Set(scanDshSkills(this.options.dshHome).skills.map(skill => skill.name.toLocaleLowerCase()));
    const enabledRepos = repos.filter(repo => repo.enabled);
    const cache = readMarketplaceCache(this.cachePath);
    const cachedByKey = new Map(cache.repos.map(item => [item.key, item]));
    const cachedResults = enabledRepos.map(repo => {
      const cached = cachedByKey.get(repoCacheKey(repo));
      return { cached, skills: cached ? hydrateSkills(cached.skills, installedNames) : [] };
    });
    if (!force && cachedResults.length > 0 && cachedResults.every(result => result.cached)) {
      if (cachedResults.some(result => this.now() - result.cached!.fetchedAt >= CACHE_REFRESH_MS)) void this.refresh(repos, installedNames).catch(() => undefined);
      return this.composeSnapshot(repos, cachedResults.map(result => ({ skills: result.skills, error: null })));
    }
    if (force && this.refreshPromise) await this.refreshPromise;
    return this.refresh(repos, installedNames);
  }

  async addRepo(repo: DshSkillRepo): Promise<DshSkillRepoMutationResult> {
    const normalized = { ...repo, owner: repo.owner.trim(), name: repo.name.trim(), branch: repo.branch.trim() || "main", enabled: true };
    if (!validRepo(normalized)) return { ok: false, error: "GitHub repository settings are invalid." };
    const repos = loadRepos(this.options.storePath);
    if (repos.some(item => item.owner.toLocaleLowerCase() === normalized.owner.toLocaleLowerCase() && item.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
      return { ok: false, error: "Repository already exists." };
    }
    saveRepos(this.options.storePath, [...repos, normalized]);
    return { ok: true, snapshot: await this.snapshot(true) };
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

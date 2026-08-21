import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  DshSkinAction,
  DshSkinCatalogEntry,
  DshLocalSkin,
  DshSkinHostState,
  DshSkinMarketInstallResult,
  DshSkinMarketplaceSnapshot,
  DshSkinMutationInput,
  DshSkinMutationResult,
  DshSkinOperationPhase,
  DshSkinOperationProgress,
  DshSkinRuntimeState
} from "../shared/dshSkins";
import type { DshAppearanceComponent, DshAppearanceKind, DshAppearanceMetadata } from "../shared/dshResources";
import { writeTextFileAtomic } from "./filePersistence";

export const DSH_SKIN_CATALOG_URL = "https://raw.githubusercontent.com/Renakoni/awesome-dsh-themes/main/data/catalog.json";
export const DSH_SKIN_MARKET_INSTALL_SPEC = "";
export const DSH_SKIN_MARKET_PACKAGE = "dsh-desk-plugin";
export const DSH_SKIN_MARKET_REFRESH_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_DSH_WEB_ORIGIN = "http://127.0.0.1:3080";
const MAX_CATALOG_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
export const OPERATION_TIMEOUT_MS = 10 * 60 * 1000;
const CACHE_VERSION = 1;

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<FetchResponse>;

type CatalogCache = {
  version: 1;
  fetchedAt: number;
  generatedAt: string;
  skins: DshSkinCatalogEntry[];
};

type RuntimePayload = {
  skins?: unknown;
  localSkins?: unknown;
  restartAvailable?: unknown;
  runningAgentCount?: unknown;
};

type OperationPayload = {
  phase?: unknown;
  message?: unknown;
  progress?: unknown;
  receivedBytes?: unknown;
  totalBytes?: unknown;
};

type WebProfileManifest = {
  dependencies?: Record<string, string>;
};

type PersistedSkinState = {
  activeSkinId?: unknown;
  skins?: Record<string, { active?: unknown; packageName?: unknown; themeId?: unknown; activationGroup?: unknown; appearance?: unknown }>;
};

export type DshSkinMarketplaceOptions = {
  cachePath: string;
  webProfileDir: string;
  marketInstalled: () => boolean;
  fetcher?: Fetcher;
  now?: () => number;
  webOrigin?: string;
  pollDelay?: (milliseconds: number) => Promise<void>;
  installPlugin?: (input: { installSpec: string; profiles: string[] }) => Promise<{ ok: boolean; restartRequired: boolean; error?: string }>;
  authoritativeTheme?: () => string | null | undefined;
};

const APPEARANCE_KINDS: DshAppearanceKind[] = ["theme", "appearance-extension", "theme-bundle"];
const APPEARANCE_COMPONENTS: DshAppearanceComponent[] = ["base-theme", "wallpaper", "motion", "sound", "settings"];
const OPERATION_PHASES: DshSkinOperationPhase[] = ["queued", "downloading", "installing", "registering", "activating", "deactivating", "uninstalling", "done", "failed"];

function operationProgress(input: DshSkinMutationInput, operation: OperationPayload): DshSkinOperationProgress | null {
  if (typeof operation.phase !== "string" || !OPERATION_PHASES.includes(operation.phase as DshSkinOperationPhase)) return null;
  const rawProgress = typeof operation.progress === "number" && Number.isFinite(operation.progress)
    ? Math.max(0, Math.min(100, operation.progress))
    : operation.phase === "done" ? 100 : null;
  const receivedBytes = typeof operation.receivedBytes === "number" && Number.isFinite(operation.receivedBytes) && operation.receivedBytes >= 0
    ? Math.floor(operation.receivedBytes)
    : undefined;
  const totalBytes = typeof operation.totalBytes === "number" && Number.isFinite(operation.totalBytes) && operation.totalBytes > 0
    ? Math.floor(operation.totalBytes)
    : undefined;
  return {
    skinId: input.skinId,
    action: input.action,
    phase: operation.phase as DshSkinOperationPhase,
    progress: rawProgress,
    ...(typeof operation.message === "string" ? { message: operation.message } : {}),
    ...(receivedBytes !== undefined ? { receivedBytes } : {}),
    ...(totalBytes !== undefined ? { totalBytes } : {})
  };
}

function parseAppearance(value: unknown, themeId: string): DshAppearanceMetadata {
  const row = objectValue(value);
  const kind = APPEARANCE_KINDS.includes(row?.kind as DshAppearanceKind) ? row?.kind as DshAppearanceKind : "theme-bundle";
  const components = Array.isArray(row?.components)
    ? row.components.filter((item): item is DshAppearanceComponent => APPEARANCE_COMPONENTS.includes(item as DshAppearanceComponent))
    : ["base-theme" as const];
  return {
    kind,
    components: [...new Set(components.length > 0 ? components : ["base-theme" as const])],
    themeId,
    ...(typeof row?.activationGroup === "string" && row.activationGroup.trim() ? { activationGroup: row.activationGroup.trim() } : {}),
    ...(row?.active === true ? { active: true } : {})
  };
}

export function readManagedDshThemePackages(profileDir: string): Record<string, DshAppearanceMetadata> {
  const state = readJsonFile<PersistedSkinState>(join(profileDir, ".dsh-appearance-manager", "state.json"), {});
  return Object.entries(state.skins ?? {}).reduce<Record<string, DshAppearanceMetadata>>((result, [storedThemeId, value]) => {
    const row = objectValue(value);
    const packageName = typeof row?.packageName === "string" ? row.packageName : "";
    const themeId = typeof row?.themeId === "string" ? row.themeId : storedThemeId;
    if (!packageName || !themeId) return result;
    const packageManifest = readJsonFile<Record<string, unknown> | null>(join(packageDirectory(profileDir, packageName), "package.json"), null);
    result[packageName] = parseAppearance(objectValue(packageManifest?.dsh)?.appearance ?? row?.appearance, themeId);
    if (row?.active === true) result[packageName] = { ...result[packageName], active: true };
    return result;
  }, {});
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readJsonFile<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

function packageDirectory(profileDir: string, packageName: string): string {
  return join(profileDir, "node_modules", ...packageName.split("/"));
}

function collectPatchRows(value: unknown, rows: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const row = objectValue(value);
  if (!row) return rows;
  rows.push(row);
  if (Array.isArray(row.insert)) for (const child of row.insert) collectPatchRows(child, rows);
  return rows;
}

function readPatchRows(path: string): Record<string, unknown>[] {
  try {
    const value = parseYaml(readFileSync(path, "utf8"));
    return Array.isArray(value) ? value.flatMap(operation => collectPatchRows(operation)) : [];
  } catch { return []; }
}

function localThemeRegistration(profileDir: string, packageName: string, packageManifest: Record<string, unknown>): { rowId: string | null; active: boolean } {
  const dsh = objectValue(packageManifest.dsh);
  const bundle = objectValue(dsh?.bundle);
  const bundleRows = typeof bundle?.patch === "string"
    ? readPatchRows(join(packageDirectory(profileDir, packageName), bundle.patch))
    : [];
  const profileRows = readPatchRows(join(profileDir, "cordis.patch.yml"));
  const declared = bundleRows.find(row => row.name === packageName && typeof row.id === "string");
  const inserted = profileRows.find(row => row.name === packageName && typeof row.id === "string");
  const rowId = String(inserted?.id ?? declared?.id ?? "") || null;
  if (!rowId) return { rowId: null, active: false };
  const override = profileRows.find(row => row.id === rowId && (row.name === undefined || row.name === packageName));
  if (override) return { rowId, active: override.disabled !== true };
  const bundles = objectValue(readJsonFile<Record<string, unknown>>(join(profileDir, "package.json"), {}).dsh)?.profile;
  const profileBundles = objectValue(bundles)?.bundles;
  return { rowId, active: inserted !== undefined || Array.isArray(profileBundles) && profileBundles.includes(packageName) };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Invalid ${label}.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error(`Invalid ${label}.`);
  return [...value] as string[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function parseSkin(value: unknown, fallbackUpdatedAt?: string): DshSkinCatalogEntry {
  const source = objectValue(value);
  const name = objectValue(source?.name);
  const install = objectValue(source?.install);
  const compatibility = objectValue(source?.compatibility);
  const license = objectValue(source?.license);
  const review = objectValue(source?.review);
  if (!source || !name || !install || !compatibility || !license) throw new Error("Invalid skin catalog entry.");

  const id = requiredString(source.id, "skin id");
  const repositoryValue = source.repositoryUrl ?? source.repo;
  const repositoryUrl = repositoryValue === null || repositoryValue === undefined ? null : requiredString(repositoryValue, `${id} repository`);
  const screenshots = [...new Set([
    ...stringArray(source.marketScreenshots ?? [], `${id} market screenshots`),
    ...stringArray(source.screenshots, `${id} screenshots`)
  ])];
  const modes = stringArray(source.modes, `${id} modes`);
  if (repositoryUrl !== null && !/^https:\/\/github\.com\//i.test(repositoryUrl)
    || screenshots.some(url => !/^https:\/\//i.test(url))
    || modes.some(mode => mode !== "light" && mode !== "dark")) {
    throw new Error(`Invalid URLs or modes for ${id}.`);
  }
  const updatedAt = requiredString(source.releaseUpdatedAt ?? source.updatedAt ?? fallbackUpdatedAt, `${id} update time`);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error(`Invalid update time for ${id}.`);

  const reviewValue = review && review.compatibility !== undefined && review.preview !== undefined && review.installation !== undefined
    ? {
      compatibility: review.compatibility,
      preview: review.preview,
      installation: review.installation
    }
    : undefined;
  if (reviewValue && (
    !["verified", "unverified"].includes(String(reviewValue.compatibility))
    || !["verified", "repository-card"].includes(String(reviewValue.preview))
    || !["verified", "manual-only"].includes(String(reviewValue.installation))
  )) throw new Error(`Invalid review state for ${id}.`);

  const rawStars = source.stars ?? source.githubStars ?? source.starsSnapshot;
  const stars = rawStars === null || rawStars === undefined ? null : Number(rawStars);
  if (stars !== null && (!Number.isInteger(stars) || stars < 0)) throw new Error(`Invalid Stars count for ${id}.`);
  const activationGroup = source.activationGroup === undefined
    ? undefined
    : requiredString(source.activationGroup, `${id} activation group`).trim();
  return {
    id,
    name: { zh: requiredString(name.zh, `${id} Chinese name`), en: requiredString(name.en, `${id} English name`) },
    author: requiredString(source.author, `${id} author`),
    description: requiredString(source.description, `${id} description`),
    repositoryUrl,
    packageName: requiredString(source.packageName ?? source.package, `${id} package`),
    rowId: requiredString(source.rowId, `${id} row id`),
    ...(activationGroup ? { activationGroup } : {}),
    tags: stringArray(source.tags, `${id} tags`),
    modes: modes as DshSkinCatalogEntry["modes"],
    install: {
      target: requiredString(install.target, `${id} install target`),
      version: requiredString(install.version, `${id} version`),
      commit: requiredString(install.commit, `${id} commit`)
    },
    compatibility: {
      dsh: requiredString(compatibility.dsh, `${id} DSH compatibility`),
      platform: stringArray(compatibility.platform, `${id} platforms`)
    },
    screenshots,
    ...(optionalString(source.listScreenshot) ? { listScreenshot: String(source.listScreenshot) } : {}),
    ...(reviewValue ? { review: reviewValue as DshSkinCatalogEntry["review"] } : {}),
    ...(source.appearance ? { appearance: parseAppearance(source.appearance, id) } : {}),
    license: {
      code: requiredString(license.code, `${id} license`),
      commercialUse: license.commercialUse === true,
      ...(optionalString(license.notice) ? { notice: String(license.notice) } : {})
    },
    stars,
    updatedAt
  };
}

export function parseDshSkinCatalog(value: unknown): { generatedAt: string; skins: DshSkinCatalogEntry[] } {
  const source = objectValue(value);
  const entries = Array.isArray(source?.themes) ? source.themes : source?.skins;
  if (!source || source.schemaVersion !== 1 || !Array.isArray(entries) || entries.length > 5000) {
    throw new Error("Unsupported skin catalog.");
  }
  const generatedAt = requiredString(source.generatedAt, "catalog generation time");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Invalid catalog generation time.");
  const skins = entries.map(value => parseSkin(value, generatedAt));
  if (new Set(skins.map(skin => skin.id)).size !== skins.length) throw new Error("Duplicate skin id in catalog.");
  return { generatedAt, skins };
}

function parseRuntimeSkin(value: unknown): DshSkinRuntimeState | null {
  const source = objectValue(value);
  if (!source || typeof source.skinId !== "string"
    || !["missing", "installed", "updating", "broken"].includes(String(source.installation))
    || !["inactive", "active", "switching", "restart-required"].includes(String(source.activation))) return null;
  return {
    skinId: source.skinId,
    installation: source.installation as DshSkinRuntimeState["installation"],
    activation: source.activation as DshSkinRuntimeState["activation"],
    installedVersion: typeof source.installedVersion === "string" ? source.installedVersion : null,
    installedAt: typeof source.installedAt === "string" ? source.installedAt : null,
    updateAvailable: source.updateAvailable === true,
    ...(typeof source.error === "string" ? { error: source.error } : {})
  };
}

async function responseJson(response: FetchResponse, maxBytes = MAX_CATALOG_BYTES): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Response is too large.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Response is too large.");
  try { return JSON.parse(text); } catch { throw new Error("Service returned invalid JSON."); }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readCache(path: string): CatalogCache | null {
  if (!existsSync(path)) return null;
  try {
    const source = objectValue(JSON.parse(readFileSync(path, "utf8")));
    if (!source || source.version !== CACHE_VERSION || typeof source.fetchedAt !== "number") return null;
    if (!Array.isArray(source.skins)) return null;
    const catalog = parseDshSkinCatalog({
      schemaVersion: 1,
      generatedAt: source.generatedAt,
      skins: source.skins.map(value => {
        const skin = objectValue(value);
        return skin ? {
          ...skin,
          repo: skin.repositoryUrl,
          package: skin.packageName,
          starsSnapshot: skin.stars,
          releaseUpdatedAt: skin.updatedAt
        } : value;
      })
    });
    return { version: 1, fetchedAt: source.fetchedAt, ...catalog };
  } catch {
    return null;
  }
}

export class DshSkinMarketplace {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly webOrigin: string;
  private readonly pollDelay: (milliseconds: number) => Promise<void>;
  private catalog: CatalogCache | null;
  private catalogSource: "remote" | "cache" = "cache";
  private lastError?: string;
  private refreshing?: Promise<void>;

  constructor(private readonly options: DshSkinMarketplaceOptions) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
    this.webOrigin = (options.webOrigin ?? DEFAULT_DSH_WEB_ORIGIN).replace(/\/$/, "");
    this.pollDelay = options.pollDelay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.catalog = readCache(options.cachePath);
  }

  async snapshot(force = false): Promise<DshSkinMarketplaceSnapshot> {
    await this.refreshCatalog(force);
    const marketInstalled = this.options.marketInstalled();
    const host = marketInstalled ? await this.hostState() : this.offlineHost(false);
    return this.createSnapshot(host);
  }

  async mutate(input: DshSkinMutationInput, reportProgress?: (progress: DshSkinOperationProgress) => void): Promise<DshSkinMutationResult> {
    if (!input || typeof input.skinId !== "string" || input.skinId === ""
      || !["install", "activate", "deactivate", "update", "uninstall", "restart"].includes(input.action)) {
      return { ok: false, error: "Invalid theme operation.", snapshot: await this.snapshot() };
    }
    if (!this.options.marketInstalled()) {
      return { ok: false, error: "DSH 主题管理组件不可用，请先启动 DSH Desk 插件。", snapshot: await this.snapshot() };
    }
    try {
      await this.refreshCatalog(false);
      if (input.action === "restart") {
        await this.hostRequest("/dsh-appearance-manager/restart", {
          method: "POST",
          headers: { "content-type": "application/json", origin: this.webOrigin },
          body: JSON.stringify({ skinId: input.skinId })
        });
        return { ok: true, restartRequested: true, snapshot: this.createSnapshot(this.offlineHost(true)) };
      }
      const skin = this.catalog?.skins.find(item => item.id === input.skinId) ?? this.localSkinEntry(input.skinId);
      if (!skin) throw new Error("Theme is not present in the current catalog.");
      if (skin.id.startsWith("local:") && input.action !== "activate" && input.action !== "deactivate") {
        throw new Error("本地主题只能切换使用状态。");
      }
      const started = objectValue(await this.hostRequest(`/dsh-appearance-manager/${input.action}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: this.webOrigin },
        body: JSON.stringify({ skinId: input.skinId, skin, catalog: this.catalog?.skins ?? [] })
      }));
      const operationId = requiredString(started?.operationId, "operation id");
      const startedProgress = operationProgress(input, started as OperationPayload);
      if (startedProgress) reportProgress?.(startedProgress);
      const deadline = this.now() + OPERATION_TIMEOUT_MS;
      while (this.now() < deadline) {
        const operation = await this.hostRequest(`/dsh-appearance-manager/operations/${encodeURIComponent(operationId)}`) as OperationPayload;
        const currentProgress = operationProgress(input, operation);
        if (currentProgress) reportProgress?.(currentProgress);
        if (operation.phase === "done") {
          const snapshot = await this.snapshot();
          if (input.action === "activate" || input.action === "update") {
            snapshot.host.skins = snapshot.host.skins.map(state => state.skinId === input.skinId && state.installation === "installed"
              ? { ...state, activation: "restart-required" }
              : state);
          }
          return {
            ok: true,
            snapshot,
            ...(input.action === "activate" || input.action === "update" || input.action === "deactivate" || input.action === "uninstall"
              ? { browserRefreshRequired: true }
              : {})
          };
        }
        if (operation.phase === "failed") throw new Error(typeof operation.message === "string" ? operation.message : "Theme operation failed.");
        await this.pollDelay(600);
      }
      throw new Error("Theme operation timed out.");
    } catch (error) {
      return { ok: false, error: errorMessage(error), snapshot: await this.snapshot() };
    }
  }

  async installMarket(): Promise<DshSkinMarketInstallResult> {
    return { ok: false, restartRequired: false, error: "主题管理已内置于 dsh-desk-plugin，无需安装额外市场插件。", snapshot: await this.snapshot() };
  }

  private createSnapshot(host: DshSkinHostState): DshSkinMarketplaceSnapshot {
    return {
      skins: this.catalog?.skins ?? [],
      localSkins: this.localSkins(),
      generatedAt: this.catalog?.generatedAt ?? null,
      catalogSource: this.catalog ? this.catalogSource : "unavailable",
      catalogCheckedAt: this.catalog?.fetchedAt ?? 0,
      ...(this.lastError ? { catalogError: this.lastError } : {}),
      host
    };
  }

  private offlineHost(marketInstalled: boolean): DshSkinHostState {
    return { connected: false, marketInstalled, skins: this.localSkinStates(), restartAvailable: false, runningAgentCount: null };
  }

  private localSkinStates(): DshSkinRuntimeState[] {
    const manifest = readJsonFile<WebProfileManifest>(join(this.options.webProfileDir, "package.json"), {});
    const dependencies = manifest.dependencies ?? {};
    const state = readJsonFile<PersistedSkinState>(join(this.options.webProfileDir, ".dsh-appearance-manager", "state.json"),
      readJsonFile<PersistedSkinState>(join(this.options.webProfileDir, ".dsh-skin-market", "state.json"), {}));
    const authoritativeTheme = this.options.authoritativeTheme?.();
    return (this.catalog?.skins ?? []).flatMap(skin => {
      const spec = dependencies[skin.packageName];
      if (typeof spec !== "string") return [];
      const packagePath = join(this.options.webProfileDir, "node_modules", ...skin.packageName.split("/"), "package.json");
      const packageManifest = readJsonFile<Record<string, unknown> | null>(packagePath, null);
      const installedVersion = typeof packageManifest?.version === "string" ? packageManifest.version : null;
      let installedAt: string | null = null;
      try { installedAt = statSync(packagePath).mtime.toISOString(); } catch { /* Broken installations are reported below. */ }
      const installed = packageManifest !== null
        && typeof packageManifest.dsh === "object"
        && packageManifest.dsh !== null
        && Object.prototype.hasOwnProperty.call(packageManifest.dsh, "client");
      return [{
        skinId: skin.id,
        installation: installed ? "installed" : "broken",
        activation: authoritativeTheme !== undefined
          ? authoritativeTheme === skin.id ? "active" : "inactive"
          : state.activeSkinId === skin.id || state.skins?.[skin.id]?.active === true ? "active" : "inactive",
        installedVersion,
        installedAt,
        updateAvailable: installed && (installedVersion !== skin.install.version || !spec.includes(skin.install.commit)),
        ...(!installed ? { error: "Installed package is incomplete." } : {})
      } satisfies DshSkinRuntimeState];
    });
  }

  private localSkins(): DshLocalSkin[] {
    const manifest = readJsonFile<WebProfileManifest>(join(this.options.webProfileDir, "package.json"), {});
    const dependencies = manifest.dependencies ?? {};
    const known = new Set((this.catalog?.skins ?? []).map(skin => skin.packageName));
    const state = readJsonFile<PersistedSkinState>(join(this.options.webProfileDir, ".dsh-appearance-manager", "state.json"), {});
    const authoritativeTheme = this.options.authoritativeTheme?.();
    // dsh.client is shared by themes and ordinary Web features. Only Desk's
    // appearance state proves that an uncatalogued package is a local theme.
    const managed = new Map(Object.values(state.skins ?? {}).flatMap(skin => typeof skin.packageName === "string"
      ? [[skin.packageName, typeof skin.activationGroup === "string" ? skin.activationGroup : undefined] as const]
      : []));
    return Object.keys(dependencies).filter(packageName => !known.has(packageName)
      && managed.has(packageName)).flatMap(packageName => {
      const packagePath = join(this.options.webProfileDir, "node_modules", ...packageName.split("/"), "package.json");
      const packageManifest = readJsonFile<Record<string, unknown> | null>(packagePath, null);
      const dsh = objectValue(packageManifest?.dsh);
      if (!dsh || dsh.client === undefined) return [];
      const repository = typeof packageManifest?.homepage === "string" && /^https:\/\//i.test(packageManifest.homepage)
        ? packageManifest.homepage
        : objectValue(packageManifest?.repository)?.url;
      const version = typeof packageManifest?.version === "string" ? packageManifest.version : null;
      const registration = localThemeRegistration(this.options.webProfileDir, packageName, packageManifest ?? {});
      const managedAppearance = parseAppearance(objectValue(dsh)?.appearance, `local:${packageName}`);
      return [{
        id: `local:${packageName}`,
        packageName,
        rowId: registration.rowId,
        name: { zh: packageName, en: packageName },
        author: typeof packageManifest?.author === "string" ? packageManifest.author : "本地主题",
        description: typeof packageManifest?.description === "string" ? packageManifest.description : "未收录到 DSH 主题目录的本地主题。",
        version,
        repositoryUrl: typeof repository === "string" && /^https:\/\//i.test(repository) ? repository.replace(/^git\+/, "").replace(/\.git$/, "") : null,
        ...(managed.get(packageName) ? { activationGroup: managed.get(packageName) } : {}),
        active: authoritativeTheme !== undefined
          ? authoritativeTheme === `local:${packageName}`
          : registration.active,
        broken: packageManifest === null,
        appearance: managedAppearance
      } satisfies DshLocalSkin];
    });
  }

  private localSkinEntry(skinId: string): DshSkinCatalogEntry | undefined {
    const local = this.localSkins().find(skin => skin.id === skinId);
    if (!local?.rowId) return undefined;
    return {
      id: local.id,
      name: local.name,
      author: local.author,
      description: local.description,
      repositoryUrl: local.repositoryUrl,
      packageName: local.packageName,
      rowId: local.rowId,
      ...(local.activationGroup ? { activationGroup: local.activationGroup } : {}),
      ...(local.appearance ? { appearance: local.appearance } : {}),
      tags: [],
      modes: ["light", "dark"],
      install: { target: "", version: local.version ?? "0.0.0", commit: "" },
      compatibility: { dsh: "unknown", platform: ["web"] },
      screenshots: [],
      license: { code: "unknown", commercialUse: false },
      stars: null,
      updatedAt: new Date(0).toISOString()
    };
  }

  private async refreshCatalog(force: boolean): Promise<void> {
    if (!force && this.catalog && this.now() - this.catalog.fetchedAt < DSH_SKIN_MARKET_REFRESH_MS) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.fetchCatalog();
    try { await this.refreshing; } finally { this.refreshing = undefined; }
  }

  private async fetchCatalog(): Promise<void> {
    const checkedAt = this.now();
    try {
      const response = await this.fetcher(DSH_SKIN_CATALOG_URL, {
        headers: { accept: "application/json", "user-agent": "dsh-desk/theme-market" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`Theme catalog returned HTTP ${response.status}.`);
      const catalog = parseDshSkinCatalog(await responseJson(response));
      this.catalog = { version: 1, fetchedAt: checkedAt, ...catalog };
      this.catalogSource = "remote";
      this.lastError = undefined;
      try { writeTextFileAtomic(this.options.cachePath, JSON.stringify(this.catalog)); } catch { /* Cache writes are best effort. */ }
    } catch (error) {
      this.lastError = errorMessage(error);
      if (this.catalog) this.catalogSource = "cache";
    }
  }

  private async hostState(): Promise<DshSkinHostState> {
    try {
      const payload = await this.hostRequest("/dsh-appearance-manager/state") as RuntimePayload;
      const states = new Map(this.localSkinStates().map(item => [item.skinId, item]));
      const liveStates = Array.isArray(payload.skins)
        ? payload.skins.map(parseRuntimeSkin).filter((item): item is DshSkinRuntimeState => item !== null)
        : [];
      for (const state of liveStates) {
        const local = states.get(state.skinId);
        states.set(state.skinId, local
          ? {
            ...state,
            // The profile scan validates the package on disk. A connected
            // runtime can add activation details, but cannot turn a broken
            // package into an installed one.
            installation: local.installation === "broken" ? "broken" : state.installation,
            // The Desk profile scan includes the pinned commit. A runtime
            // response has no catalog context and must not erase that flag.
            updateAvailable: local.updateAvailable || state.updateAvailable,
            installedVersion: state.installedVersion ?? local.installedVersion,
            installedAt: state.installedAt ?? local.installedAt,
            ...(local.installation === "broken" && local.error ? { error: local.error } : {})
          }
          : state);
      }
      const authoritativeTheme = this.options.authoritativeTheme?.();
      if (authoritativeTheme !== undefined) {
        for (const state of states.values()) {
          state.activation = state.skinId === authoritativeTheme ? "active" : "inactive";
        }
      }
      return {
        connected: true,
        marketInstalled: true,
        skins: [...states.values()],
        restartAvailable: payload.restartAvailable === true,
        runningAgentCount: typeof payload.runningAgentCount === "number" && Number.isInteger(payload.runningAgentCount)
          ? payload.runningAgentCount
          : null
      };
    } catch {
      return this.offlineHost(true);
    }
  }

  private async hostRequest(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetcher(`${this.webOrigin}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const body = objectValue(await responseJson(response, 2 * 1024 * 1024));
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `DSH Web returned HTTP ${response.status}.`);
    return body;
  }
}

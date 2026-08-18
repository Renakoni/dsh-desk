import { existsSync, readFileSync } from "node:fs";
import type {
  DshSkinAction,
  DshSkinCatalogEntry,
  DshSkinHostState,
  DshSkinMarketInstallResult,
  DshSkinMarketplaceSnapshot,
  DshSkinMutationInput,
  DshSkinMutationResult,
  DshSkinRuntimeState
} from "../shared/dshSkins";
import { writeTextFileAtomic } from "./filePersistence";

export const DSH_SKIN_CATALOG_URL = "https://kingofsoysauce.github.io/dsh-skin-market/catalog.json";
export const DSH_SKIN_MARKET_INSTALL_SPEC = "github:kingOfSoySauce/dsh-skin-market";
export const DSH_SKIN_MARKET_PACKAGE = "dsh-skin-market";
export const DSH_SKIN_MARKET_REFRESH_MS = 12 * 60 * 60 * 1000;
const DEFAULT_DSH_WEB_ORIGIN = "http://127.0.0.1:3080";
const MAX_CATALOG_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 120_000;
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
  restartAvailable?: unknown;
  runningAgentCount?: unknown;
};

type OperationPayload = {
  phase?: unknown;
  message?: unknown;
};

export type DshSkinMarketplaceOptions = {
  cachePath: string;
  marketInstalled: () => boolean;
  fetcher?: Fetcher;
  now?: () => number;
  webOrigin?: string;
  pollDelay?: (milliseconds: number) => Promise<void>;
  installPlugin?: (input: { installSpec: string; profiles: string[] }) => Promise<{ ok: boolean; restartRequired: boolean; error?: string }>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

function parseSkin(value: unknown): DshSkinCatalogEntry {
  const source = objectValue(value);
  const name = objectValue(source?.name);
  const install = objectValue(source?.install);
  const compatibility = objectValue(source?.compatibility);
  const license = objectValue(source?.license);
  const review = objectValue(source?.review);
  if (!source || !name || !install || !compatibility || !license) throw new Error("Invalid skin catalog entry.");

  const id = requiredString(source.id, "skin id");
  const repositoryUrl = requiredString(source.repo, `${id} repository`);
  const screenshots = [...new Set([
    ...stringArray(source.marketScreenshots ?? [], `${id} market screenshots`),
    ...stringArray(source.screenshots, `${id} screenshots`)
  ])];
  const modes = stringArray(source.modes, `${id} modes`);
  if (!/^https:\/\/github\.com\//i.test(repositoryUrl)
    || screenshots.some(url => !/^https:\/\//i.test(url))
    || modes.some(mode => mode !== "light" && mode !== "dark")) {
    throw new Error(`Invalid URLs or modes for ${id}.`);
  }
  const updatedAt = requiredString(source.releaseUpdatedAt ?? source.updatedAt, `${id} update time`);
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

  const stars = Number(source.githubStars ?? source.starsSnapshot ?? 0);
  if (!Number.isInteger(stars) || stars < 0) throw new Error(`Invalid Stars count for ${id}.`);
  return {
    id,
    name: { zh: requiredString(name.zh, `${id} Chinese name`), en: requiredString(name.en, `${id} English name`) },
    author: requiredString(source.author, `${id} author`),
    description: requiredString(source.description, `${id} description`),
    repositoryUrl,
    packageName: requiredString(source.package, `${id} package`),
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
  if (!source || source.schemaVersion !== 1 || !Array.isArray(source.skins) || source.skins.length > 5000) {
    throw new Error("Unsupported skin catalog.");
  }
  const generatedAt = requiredString(source.generatedAt, "catalog generation time");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Invalid catalog generation time.");
  const skins = source.skins.map(parseSkin);
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

  async mutate(input: DshSkinMutationInput): Promise<DshSkinMutationResult> {
    if (!input || typeof input.skinId !== "string" || input.skinId === ""
      || !["install", "activate", "deactivate", "update", "uninstall", "restart"].includes(input.action)) {
      return { ok: false, error: "Invalid theme operation.", snapshot: await this.snapshot() };
    }
    try {
      if (input.action === "restart") {
        await this.hostRequest("/dsh-skin-market/restart", {
          method: "POST",
          headers: { "content-type": "application/json", origin: this.webOrigin },
          body: JSON.stringify({ skinId: input.skinId })
        });
        return { ok: true, restartRequested: true, snapshot: this.createSnapshot(this.offlineHost(true)) };
      }
      const started = objectValue(await this.hostRequest(`/dsh-skin-market/${input.action}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: this.webOrigin },
        body: JSON.stringify({ skinId: input.skinId })
      }));
      const operationId = requiredString(started?.operationId, "operation id");
      const deadline = this.now() + OPERATION_TIMEOUT_MS;
      while (this.now() < deadline) {
        const operation = await this.hostRequest(`/dsh-skin-market/operations/${encodeURIComponent(operationId)}`) as OperationPayload;
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
    if (!this.options.installPlugin) {
      return { ok: false, restartRequired: false, error: "Theme market installation is unavailable.", snapshot: await this.snapshot() };
    }
    const result = await this.options.installPlugin({ installSpec: DSH_SKIN_MARKET_INSTALL_SPEC, profiles: ["web"] });
    return {
      ok: result.ok,
      restartRequired: result.restartRequired,
      snapshot: await this.snapshot(),
      ...(result.error ? { error: result.error } : {})
    };
  }

  private createSnapshot(host: DshSkinHostState): DshSkinMarketplaceSnapshot {
    return {
      skins: this.catalog?.skins ?? [],
      generatedAt: this.catalog?.generatedAt ?? null,
      catalogSource: this.catalog ? this.catalogSource : "unavailable",
      catalogCheckedAt: this.catalog?.fetchedAt ?? 0,
      ...(this.lastError ? { catalogError: this.lastError } : {}),
      host
    };
  }

  private offlineHost(marketInstalled: boolean): DshSkinHostState {
    return { connected: false, marketInstalled, skins: [], restartAvailable: false, runningAgentCount: null };
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
      const payload = await this.hostRequest("/dsh-skin-market/state") as RuntimePayload;
      return {
        connected: true,
        marketInstalled: true,
        skins: Array.isArray(payload.skins) ? payload.skins.map(parseRuntimeSkin).filter((item): item is DshSkinRuntimeState => item !== null) : [],
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

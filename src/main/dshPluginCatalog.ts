import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DshInstalledPlugin,
  DshMarketplaceCategory,
  DshMarketplacePlugin,
  DshMarketplaceSnapshot,
  DshPluginInstallInput,
  DshPluginMutationCode,
  DshPluginMutationResult,
  DshPluginProfile,
  DshPluginProfileState,
  DshPluginRemoveInput,
  DshPluginSnapshot,
  DshPluginStateInput
} from "../shared/dshPlugins";
import { writeTextFileAtomic } from "./filePersistence";
import { runDshCommand, type DshCommandRunner } from "./dshPluginManager";

const MARKETPLACE_URL = "https://awesome-dsh-plugin.com/plugins.json";
const MARKETPLACE_MAX_BYTES = 5 * 1024 * 1024;
const MARKETPLACE_REFRESH_MS = 12 * 60 * 60 * 1000;
const MARKETPLACE_CACHE_VERSION = 1;
const KNOWN_PROFILES = ["web", "headless"];
const PROTECTED_BUNDLES = new Set([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-headless",
  "dsh-desk-plugin"
]);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;
const INSTALL_SPEC = /^(?:github:[a-z0-9_.-]+\/[a-z0-9_.@/-]+(?:#[a-z0-9._/-]+)?|(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@[a-z0-9._-]+)?)$/i;

type JsonObject = Record<string, unknown>;

type ProfileRecord = {
  profile: DshPluginProfile;
  packagePath: string;
  raw?: string;
  manifest?: JsonObject;
  dependencies: Record<string, string>;
  bundles: string[];
};

type InstalledMetadata = {
  materialized: boolean;
  bundleCapable: boolean | null;
  name?: string;
  description?: string;
  version?: string;
  homepage?: string;
};

type MarketplaceCache = {
  fetchedAt: number;
  catalog: unknown;
};

export type DshPluginCatalogOptions = {
  dshHome: string;
  pnpmPath: string | null;
  marketplaceCachePath: string;
  commandRunner?: DshCommandRunner;
  fetcher?: typeof fetch;
  now?: () => number;
};

class CatalogError extends Error {
  constructor(readonly code: DshPluginMutationCode, message: string) {
    super(message);
  }
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function profileLabel(name: string): string {
  if (name === "web") return "Web";
  if (name === "headless") return "Headless";
  return name;
}

function isProfileName(value: unknown): value is string {
  return typeof value === "string"
    && value !== ""
    && value !== "."
    && value !== ".."
    && value !== "node_modules"
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0");
}

function repositoryUrl(value: unknown): string | undefined {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  const object = objectValue(value);
  const url = stringValue(object?.url);
  if (!url) return undefined;
  const normalized = url.replace(/^git\+/, "").replace(/\.git$/, "");
  return /^https?:\/\//i.test(normalized) ? normalized : undefined;
}

function parseProfile(name: string, profilesRoot: string): ProfileRecord {
  const packagePath = join(profilesRoot, name, "package.json");
  const profile: DshPluginProfile = { name, label: profileLabel(name), exists: existsSync(packagePath) };
  if (!profile.exists) return { profile, packagePath, dependencies: {}, bundles: [] };
  try {
    const raw = readFileSync(packagePath, "utf8");
    const manifest = objectValue(JSON.parse(raw));
    if (!manifest) throw new Error("package.json must contain a JSON object");
    const dependencyObject = manifest.dependencies === undefined ? {} : objectValue(manifest.dependencies);
    if (!dependencyObject) throw new Error("dependencies must be an object");
    const dependencies: Record<string, string> = {};
    for (const [packageName, spec] of Object.entries(dependencyObject)) {
      if (typeof spec !== "string") throw new Error(`dependency ${packageName} must be a string`);
      dependencies[packageName] = spec;
    }
    const dsh = manifest.dsh === undefined ? null : objectValue(manifest.dsh);
    if (manifest.dsh !== undefined && !dsh) throw new Error("dsh must be an object");
    const profileSection = dsh?.profile === undefined ? null : objectValue(dsh.profile);
    if (dsh?.profile !== undefined && !profileSection) throw new Error("dsh.profile must be an object");
    const rawBundles = profileSection?.bundles;
    if (rawBundles !== undefined && (!Array.isArray(rawBundles) || rawBundles.some(bundle => typeof bundle !== "string"))) {
      throw new Error("dsh.profile.bundles must be a string array");
    }
    return { profile, packagePath, raw, manifest, dependencies, bundles: rawBundles ? [...rawBundles] as string[] : [] };
  } catch (error) {
    profile.readError = error instanceof Error ? error.message : String(error);
    return { profile, packagePath, dependencies: {}, bundles: [] };
  }
}

function discoverProfiles(dshHome: string): ProfileRecord[] {
  const profilesRoot = join(dshHome, "profiles");
  const names = new Set(KNOWN_PROFILES);
  try {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && isProfileName(entry.name)) names.add(entry.name);
    }
  } catch {
    // A new DSH install may not have initialized profiles yet.
  }
  return [...names]
    .sort((left, right) => {
      const leftKnown = KNOWN_PROFILES.indexOf(left);
      const rightKnown = KNOWN_PROFILES.indexOf(right);
      if (leftKnown >= 0 || rightKnown >= 0) return (leftKnown < 0 ? 99 : leftKnown) - (rightKnown < 0 ? 99 : rightKnown);
      return left.localeCompare(right);
    })
    .map(name => parseProfile(name, profilesRoot));
}

function installedMetadata(profileRoot: string, packageName: string, builtin: boolean): InstalledMetadata {
  if (builtin) return { materialized: true, bundleCapable: true };
  const packagePath = join(profileRoot, "node_modules", packageName, "package.json");
  if (!existsSync(packagePath)) return { materialized: false, bundleCapable: null };
  try {
    const manifest = objectValue(JSON.parse(readFileSync(packagePath, "utf8")));
    if (!manifest) return { materialized: true, bundleCapable: null };
    const dsh = objectValue(manifest.dsh);
    const bundle = objectValue(dsh?.bundle);
    return {
      materialized: true,
      bundleCapable: typeof bundle?.patch === "string",
      name: stringValue(manifest.displayName) ?? stringValue(manifest.name),
      description: stringValue(manifest.description),
      version: stringValue(manifest.version),
      homepage: stringValue(manifest.homepage) ?? repositoryUrl(manifest.repository)
    };
  } catch {
    return { materialized: true, bundleCapable: null };
  }
}

function aggregatePlugins(records: ProfileRecord[], dshHome: string): DshInstalledPlugin[] {
  const packageNames = new Set<string>();
  for (const record of records) {
    Object.keys(record.dependencies).forEach(name => packageNames.add(name));
    record.bundles.forEach(name => packageNames.add(name));
  }
  const plugins: DshInstalledPlugin[] = [];
  for (const packageName of packageNames) {
    const builtin = packageName !== "dsh-desk-plugin" && PROTECTED_BUNDLES.has(packageName);
    const desk = packageName === "dsh-desk-plugin";
    let metadata: InstalledMetadata | undefined;
    const states: DshPluginProfileState[] = records.map(record => {
      const profileRoot = join(dshHome, "profiles", record.profile.name);
      const currentMetadata = installedMetadata(profileRoot, packageName, builtin);
      if (!metadata || (!metadata.materialized && currentMetadata.materialized)) metadata = currentMetadata;
      return {
        profile: record.profile.name,
        ...(record.dependencies[packageName] ? { dependencySpec: record.dependencies[packageName] } : {}),
        enabled: record.bundles.includes(packageName),
        materialized: currentMetadata.materialized,
        bundleCapable: currentMetadata.bundleCapable
      };
    });
    const unresolvedEnabled = states.some(state => state.enabled && !state.materialized && !builtin);
    const dependencyOnly = states.some(state => state.dependencySpec !== undefined)
      && states.every(state => state.bundleCapable === false || (!state.enabled && state.bundleCapable !== true));
    plugins.push({
      packageName,
      name: metadata?.name ?? packageName,
      ...(metadata?.description ? { description: metadata.description } : {}),
      ...(metadata?.version ? { version: metadata.version } : {}),
      ...(metadata?.homepage ? { homepage: metadata.homepage } : {}),
      kind: builtin ? "builtin" : desk ? "desk" : unresolvedEnabled ? "broken" : dependencyOnly ? "dependency" : "plugin",
      protected: builtin || desk,
      states
    });
  }
  return plugins.sort((left, right) => {
    if (left.protected !== right.protected) return left.protected ? -1 : 1;
    const leftEnabled = left.states.some(state => state.enabled);
    const rightEnabled = right.states.some(state => state.enabled);
    if (leftEnabled !== rightEnabled) return leftEnabled ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function mutationFailure(snapshot: DshPluginSnapshot, code: DshPluginMutationCode, error: string, changedProfiles: string[] = []): DshPluginMutationResult {
  return { ok: false, snapshot, changedProfiles, restartRequired: changedProfiles.length > 0, code, error };
}

function normalizeProfiles(value: unknown, available: Set<string>): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new CatalogError("invalid-input", "Select at least one DSH profile.");
  const profiles = [...new Set(value.map(item => typeof item === "string" ? item : ""))];
  if (profiles.some(profile => !isProfileName(profile) || !available.has(profile))) {
    throw new CatalogError("profile-not-found", "One or more DSH profiles no longer exist.");
  }
  return profiles;
}

function setBundleState(record: ProfileRecord, packageName: string, enabled: boolean): boolean {
  if (!record.raw || !record.manifest || record.profile.readError) {
    throw new CatalogError("profile-not-found", `DSH profile ${record.profile.name} is not readable.`);
  }
  const alreadyEnabled = record.bundles.includes(packageName);
  if (alreadyEnabled === enabled) return false;
  if (readFileSync(record.packagePath, "utf8") !== record.raw) {
    throw new CatalogError("concurrent-change", `DSH profile ${record.profile.name} changed while it was being edited.`);
  }
  let bundles = record.bundles.filter(bundle => bundle !== packageName);
  if (enabled) {
    const dependencyOrder = Object.keys(record.dependencies);
    const targetIndex = dependencyOrder.indexOf(packageName);
    const insertBefore = bundles.findIndex(bundle => {
      const bundleIndex = dependencyOrder.indexOf(bundle);
      return bundleIndex >= 0 && bundleIndex > targetIndex;
    });
    if (insertBefore >= 0) bundles.splice(insertBefore, 0, packageName);
    else bundles.push(packageName);
  }
  const dsh = objectValue(record.manifest.dsh) ?? {};
  const profile = objectValue(dsh.profile) ?? {};
  const next = { ...record.manifest, dsh: { ...dsh, profile: { ...profile, bundles } } };
  writeTextFileAtomic(record.packagePath, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

function disabledBundleDependencies(record: ProfileRecord, dshHome: string): string[] {
  const profileRoot = join(dshHome, "profiles", record.profile.name);
  return Object.keys(record.dependencies).filter(packageName =>
    !record.bundles.includes(packageName)
    && installedMetadata(profileRoot, packageName, false).bundleCapable === true);
}

function restoreDisabledBundles(record: ProfileRecord, packageNames: readonly string[], dshHome: string): void {
  for (const packageName of packageNames) {
    if (record.bundles.includes(packageName)) {
      setBundleState(record, packageName, false);
      record = parseProfile(record.profile.name, join(dshHome, "profiles"));
    }
  }
}

function parseMarketplaceCatalog(value: unknown, source: "remote" | "cache", fetchedAt: number): DshMarketplaceSnapshot | null {
  const root = objectValue(value);
  const rawPlugins = root?.plugins;
  if (!root || !Array.isArray(rawPlugins)) return null;
  const categories: DshMarketplaceCategory[] = [];
  const categoryObject = objectValue(root.categories) ?? {};
  for (const [id, rawCategory] of Object.entries(categoryObject)) {
    const category = objectValue(rawCategory);
    const en = stringValue(category?.en);
    const zh = stringValue(category?.zh);
    if (en && zh) categories.push({ id, en, zh });
  }
  const plugins: DshMarketplacePlugin[] = [];
  const ids = new Set<string>();
  for (const rawPlugin of rawPlugins.slice(0, 5000)) {
    const plugin = objectValue(rawPlugin);
    if (!plugin) continue;
    const name = stringValue(plugin.name);
    const owner = stringValue(plugin.owner);
    const url = stringValue(plugin.url);
    const category = stringValue(plugin.category);
    const description = objectValue(plugin.description);
    const en = stringValue(description?.en);
    const zh = stringValue(description?.zh);
    const install = stringValue(plugin.install);
    const installMatch = install ? /^dsh plugin --profile web add (\S+)$/.exec(install) : null;
    const installSpec = installMatch?.[1];
    const npmName = plugin.npm === null ? undefined : stringValue(plugin.npm);
    const packageName = npmName && PACKAGE_NAME.test(npmName) ? npmName : name;
    const id = url ?? (name && owner ? `${owner}/${name}` : undefined);
    if (!name || !owner || !id || ids.has(id) || !url || !/^https:\/\//i.test(url) || !category || !en || !zh
      || !installSpec || !INSTALL_SPEC.test(installSpec) || !packageName || !PACKAGE_NAME.test(packageName)) continue;
    ids.add(id);
    plugins.push({
      id,
      name,
      owner,
      packageName,
      repositoryUrl: url,
      category,
      description: { en, zh },
      installSpec,
      stars: typeof plugin.stars === "number" && Number.isFinite(plugin.stars) && plugin.stars >= 0 ? plugin.stars : null,
      added: stringValue(plugin.added) ?? ""
    });
  }
  if (rawPlugins.length > 0 && plugins.length === 0) return null;
  return {
    source,
    sourceName: stringValue(root.name) ?? "awesome-dsh-plugin",
    sourceUrl: stringValue(root.url) ?? MARKETPLACE_URL,
    ...(stringValue(root.updated) ? { updatedAt: stringValue(root.updated) } : {}),
    fetchedAt,
    categories: categories.sort((left, right) => left.en.localeCompare(right.en)),
    plugins
  };
}

function readMarketplaceCache(cachePath: string): MarketplaceCache | null {
  if (!existsSync(cachePath)) return null;
  try {
    const value = objectValue(JSON.parse(readFileSync(cachePath, "utf8")));
    if (value?.version !== MARKETPLACE_CACHE_VERSION || typeof value.fetchedAt !== "number") return null;
    return { fetchedAt: value.fetchedAt, catalog: value.catalog };
  } catch {
    return null;
  }
}

export class DshPluginCatalog {
  private readonly commandRunner: DshCommandRunner;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: DshPluginCatalogOptions) {
    this.commandRunner = options.commandRunner ?? runDshCommand;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  snapshot(): DshPluginSnapshot {
    const records = discoverProfiles(this.options.dshHome);
    return {
      profiles: records.map(record => record.profile),
      plugins: aggregatePlugins(records, this.options.dshHome),
      dshHome: this.options.dshHome,
      pnpmAvailable: this.options.pnpmPath !== null,
      scannedAt: this.now()
    };
  }

  setEnabled(input: DshPluginStateInput): DshPluginMutationResult {
    const before = this.snapshot();
    try {
      if (!input || !PACKAGE_NAME.test(input.packageName) || !isProfileName(input.profile) || typeof input.enabled !== "boolean") {
        throw new CatalogError("invalid-input", "Invalid DSH plugin state request.");
      }
      const plugin = before.plugins.find(item => item.packageName === input.packageName);
      if (!plugin) throw new CatalogError("plugin-not-found", "The DSH plugin is no longer installed.");
      if (plugin.protected) throw new CatalogError("protected-plugin", "This bundle is required by DSH or DSH Desk and cannot be disabled.");
      const records = discoverProfiles(this.options.dshHome);
      const record = records.find(item => item.profile.name === input.profile);
      if (!record?.profile.exists || record.profile.readError) throw new CatalogError("profile-not-found", "The selected DSH profile is not readable.");
      const state = plugin.states.find(item => item.profile === input.profile);
      if (input.enabled && (!state?.dependencySpec || state.bundleCapable !== true)) {
        throw new CatalogError("not-a-bundle", "The package is not an installed DSH bundle in this profile.");
      }
      const changed = setBundleState(record, input.packageName, input.enabled);
      return { ok: true, snapshot: this.snapshot(), changedProfiles: changed ? [input.profile] : [], restartRequired: changed };
    } catch (error) {
      const code = error instanceof CatalogError ? error.code : "operation-failed";
      return mutationFailure(this.snapshot(), code, error instanceof Error ? error.message : String(error));
    }
  }

  async install(input: DshPluginInstallInput): Promise<DshPluginMutationResult> {
    const before = this.snapshot();
    const changedProfiles: string[] = [];
    try {
      if (!input || typeof input.installSpec !== "string" || !INSTALL_SPEC.test(input.installSpec)) {
        throw new CatalogError("invalid-input", "The marketplace install specification is not supported.");
      }
      if (!this.options.pnpmPath) throw new CatalogError("pnpm-missing", "pnpm was not found on PATH.");
      const profiles = normalizeProfiles(input.profiles, new Set(before.profiles.map(profile => profile.name)));
      const records = discoverProfiles(this.options.dshHome);
      for (const profile of profiles) {
        const disabledBundles = records.find(item => item.profile.name === profile);
        const preserveDisabled = disabledBundles ? disabledBundleDependencies(disabledBundles, this.options.dshHome) : [];
        await this.commandRunner(this.options.pnpmPath, ["dlx", "@deepseek-ai/dsh", "plugin", "--profile", profile, "add", input.installSpec]);
        changedProfiles.push(profile);
        const refreshed = discoverProfiles(this.options.dshHome).find(item => item.profile.name === profile);
        if (refreshed) restoreDisabledBundles(refreshed, preserveDisabled, this.options.dshHome);
      }
      return { ok: true, snapshot: this.snapshot(), changedProfiles, restartRequired: changedProfiles.length > 0 };
    } catch (error) {
      const code = error instanceof CatalogError ? error.code : "operation-failed";
      return mutationFailure(this.snapshot(), code, error instanceof Error ? error.message : String(error), changedProfiles);
    }
  }

  async remove(input: DshPluginRemoveInput): Promise<DshPluginMutationResult> {
    const before = this.snapshot();
    const changedProfiles: string[] = [];
    try {
      if (!input || !PACKAGE_NAME.test(input.packageName)) throw new CatalogError("invalid-input", "Invalid DSH package name.");
      const plugin = before.plugins.find(item => item.packageName === input.packageName);
      if (!plugin) throw new CatalogError("plugin-not-found", "The DSH plugin is no longer installed.");
      if (plugin.protected) throw new CatalogError("protected-plugin", "This bundle is required by DSH or DSH Desk and cannot be removed.");
      if (!this.options.pnpmPath) throw new CatalogError("pnpm-missing", "pnpm was not found on PATH.");
      const profiles = normalizeProfiles(input.profiles, new Set(before.profiles.map(profile => profile.name)));
      const records = discoverProfiles(this.options.dshHome);
      for (const profile of profiles) {
        const state = plugin.states.find(item => item.profile === profile);
        if (state?.dependencySpec) {
          const record = records.find(item => item.profile.name === profile);
          const preserveDisabled = record ? disabledBundleDependencies(record, this.options.dshHome) : [];
          await this.commandRunner(this.options.pnpmPath, ["dlx", "@deepseek-ai/dsh", "plugin", "--profile", profile, "remove", input.packageName]);
          changedProfiles.push(profile);
          const refreshed = discoverProfiles(this.options.dshHome).find(item => item.profile.name === profile);
          if (refreshed) restoreDisabledBundles(refreshed, preserveDisabled, this.options.dshHome);
        } else if (state?.enabled) {
          const record = records.find(item => item.profile.name === profile);
          if (!record) throw new CatalogError("profile-not-found", `DSH profile ${profile} no longer exists.`);
          setBundleState(record, input.packageName, false);
          changedProfiles.push(profile);
        } else {
          continue;
        }
      }
      return { ok: true, snapshot: this.snapshot(), changedProfiles, restartRequired: changedProfiles.length > 0 };
    } catch (error) {
      const code = error instanceof CatalogError ? error.code : "operation-failed";
      return mutationFailure(this.snapshot(), code, error instanceof Error ? error.message : String(error), changedProfiles);
    }
  }

  async marketplace(force = false): Promise<DshMarketplaceSnapshot> {
    const cache = readMarketplaceCache(this.options.marketplaceCachePath);
    const cachedSnapshot = cache ? parseMarketplaceCatalog(cache.catalog, "cache", cache.fetchedAt) : null;
    if (!force && cachedSnapshot && this.now() - cache!.fetchedAt < MARKETPLACE_REFRESH_MS) return cachedSnapshot;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await this.fetcher(MARKETPLACE_URL, { signal: controller.signal, headers: { Accept: "application/json" } });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`Marketplace returned HTTP ${response.status}.`);
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MARKETPLACE_MAX_BYTES) throw new Error("Marketplace response is too large.");
      const catalog: unknown = JSON.parse(text);
      const fetchedAt = this.now();
      const snapshot = parseMarketplaceCatalog(catalog, "remote", fetchedAt);
      if (!snapshot) throw new Error("Marketplace response has an invalid format.");
      try {
        writeTextFileAtomic(this.options.marketplaceCachePath, JSON.stringify({ version: MARKETPLACE_CACHE_VERSION, fetchedAt, catalog }));
      } catch {
        // A read-only cache directory must not discard a valid live catalog.
      }
      return snapshot;
    } catch (error) {
      if (cachedSnapshot) return { ...cachedSnapshot, error: error instanceof Error ? error.message : String(error) };
      return {
        source: "unavailable",
        sourceName: "awesome-dsh-plugin",
        sourceUrl: MARKETPLACE_URL,
        categories: [],
        plugins: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

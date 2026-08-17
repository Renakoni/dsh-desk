import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DshPluginComponent, DshResourceItem } from "../shared/dshResources";

type JsonObject = Record<string, unknown>;

const KNOWN_PROFILES = ["web", "headless"];
const JS_YAML_TAG = { tag: "tag:yaml.org,2002:js", resolve: (value: string) => ({ __jsExpr: value }) };
const scanCache = new Map<string, {
  sources: Map<string, string | null>;
  value: Record<string, DshPluginComponent[]>;
}>();

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function sourceStamp(path: string): string | null {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.isDirectory() ? "d" : "f"}`;
  } catch {
    return null;
  }
}

function cacheIsCurrent(sources: ReadonlyMap<string, string | null>): boolean {
  return [...sources].every(([path, stamp]) => sourceStamp(path) === stamp);
}

function profileNames(profilesRoot: string, sources: Set<string>): string[] {
  const names = new Set(KNOWN_PROFILES);
  sources.add(profilesRoot);
  try {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "node_modules") names.add(entry.name);
    }
  } catch {
    // Profiles are created lazily by DSH.
  }
  return [...names];
}

function packageDirectory(profileDir: string, packageName: string, sources: Set<string>): string | null {
  const anchor = join(profileDir, "package.json");
  for (const modulesDir of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(modulesDir, ...packageName.split("/"));
    const manifestPath = join(candidate, "package.json");
    sources.add(manifestPath);
    try {
      const manifest = objectValue(JSON.parse(readFileSync(manifestPath, "utf8")));
      if (manifest?.name === packageName) return candidate;
    } catch {
      // Continue through Node's ordinary profile fallback paths.
    }
  }
  return null;
}

function baselineEnabled(entry: JsonObject): boolean | null {
  if (entry.disabled === undefined) return true;
  return typeof entry.disabled === "boolean" ? !entry.disabled : null;
}

function recordInsertedComponents(
  value: unknown,
  packageName: string,
  prefix: string[],
  claimed: Set<string>,
  components: Map<string, DshPluginComponent>
): void {
  if (!Array.isArray(value)) return;
  for (const candidate of value) {
    const entry = objectValue(candidate);
    if (!entry || typeof entry.id !== "string" || !entry.id) continue;
    const path = [...prefix, entry.id];
    const key = `include:${path.join(":")}`;
    if (entry.group === true) {
      recordInsertedComponents(entry.config, packageName, path, claimed, components);
      continue;
    }
    if (typeof entry.name !== "string" || !entry.name || claimed.has(key)) continue;
    claimed.add(key);
    components.set(key, {
      key,
      name: entry.id,
      moduleName: entry.name,
      baselineEnabled: baselineEnabled(entry),
      enabled: false,
      manageable: packageName !== "dsh-desk-plugin",
      fiberPhase: null,
      runtimeObserved: false
    });
  }
}

function profileComponents(profileDir: string, output: Map<string, Map<string, DshPluginComponent>>, sources: Set<string>): void {
  let bundles: string[];
  const profilePath = join(profileDir, "package.json");
  sources.add(profilePath);
  try {
    const profile = objectValue(JSON.parse(readFileSync(profilePath, "utf8")));
    const dsh = objectValue(profile?.dsh);
    const profileConfig = objectValue(dsh?.profile);
    bundles = Array.isArray(profileConfig?.bundles)
      ? profileConfig.bundles.filter((bundle): bundle is string => typeof bundle === "string" && Boolean(bundle))
      : [];
  } catch {
    return;
  }
  for (const packageName of bundles) {
    const packageDir = packageDirectory(profileDir, packageName, sources);
    if (!packageDir) continue;
    try {
      const manifestPath = join(packageDir, "package.json");
      sources.add(manifestPath);
      const manifest = objectValue(JSON.parse(readFileSync(manifestPath, "utf8")));
      const dsh = objectValue(manifest?.dsh);
      const bundle = objectValue(dsh?.bundle);
      if (typeof bundle?.patch !== "string" || !bundle.patch) continue;
      const patchPath = resolve(packageDir, bundle.patch);
      sources.add(patchPath);
      const patches = parseYaml(readFileSync(patchPath, "utf8"), { customTags: [JS_YAML_TAG] });
      if (!Array.isArray(patches)) continue;
      const components = output.get(packageName) ?? new Map<string, DshPluginComponent>();
      const claimed = new Set(components.keys());
      for (const candidate of patches) {
        const patch = objectValue(candidate);
        if (patch) recordInsertedComponents(patch.insert, packageName, [], claimed, components);
      }
      output.set(packageName, components);
    } catch {
      // One malformed or unavailable bundle must not hide the rest of the catalog.
    }
  }
}

export function scanDshStaticPluginComponents(dshHome: string): Record<string, DshPluginComponent[]> {
  const cached = scanCache.get(dshHome);
  if (cached && cacheIsCurrent(cached.sources)) return cached.value;

  const profilesRoot = join(dshHome, "profiles");
  const output = new Map<string, Map<string, DshPluginComponent>>();
  const sources = new Set<string>();
  for (const name of profileNames(profilesRoot, sources)) {
    const profileDir = join(profilesRoot, name);
    sources.add(profileDir);
    if (existsSync(join(profileDir, "package.json"))) profileComponents(profileDir, output, sources);
  }
  const value = Object.fromEntries([...output.entries()].map(([packageName, components]) => [
    packageName,
    [...components.values()].sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key))
  ]));
  scanCache.set(dshHome, {
    sources: new Map([...sources].map(path => [path, sourceStamp(path)])),
    value
  });
  return value;
}

export function mergeDshPluginComponents(
  staticComponents: DshPluginComponent[] | undefined,
  runtimeComponents: DshPluginComponent[] | undefined
): DshPluginComponent[] {
  const merged = new Map((staticComponents ?? []).map(component => [component.key, component]));
  for (const component of runtimeComponents ?? []) merged.set(component.key, component);
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
}

export function deduplicateDshProfileComponents(resources: DshResourceItem[]): DshResourceItem[] {
  const preferred = resources
    .map((resource, index) => ({ resource, index }))
    .sort((left, right) => {
      const rank = (resource: DshResourceItem) => resource.packageName === "@deepseek-ai/dsh-web-app" ? 0
        : resource.packageName === "@deepseek-ai/dsh-headless" ? 1 : 2;
      return rank(left.resource) - rank(right.resource) || left.index - right.index;
    });
  const ownerIds = new Map<string, string>();
  const ownerKeys = new Map<string, string[]>();
  const components = new Map<string, DshPluginComponent>();
  for (const { resource } of preferred) {
    for (const component of resource.components ?? []) {
      if (!ownerIds.has(component.key)) {
        ownerIds.set(component.key, resource.id);
        ownerKeys.set(resource.id, [...(ownerKeys.get(resource.id) ?? []), component.key]);
      }
      const current = components.get(component.key);
      if (!current || current.runtimeObserved === false && component.runtimeObserved !== false) {
        components.set(component.key, component);
      }
    }
  }
  return resources.map(resource => ({
    ...resource,
    ...(ownerKeys.get(resource.id)?.length
      ? { components: ownerKeys.get(resource.id)?.map(key => components.get(key) as DshPluginComponent) }
      : { components: undefined })
  }));
}

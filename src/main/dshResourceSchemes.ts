import { existsSync, readFileSync } from "node:fs";
import type {
  DshResourceDrift,
  DshResourceInventory,
  DshResourceIssue,
  DshResourceMutationResult,
  DshResourceScheme,
  DshResourceSchemeSaveInput,
  DshResourceSchemesSnapshot,
  DshResourceSchemeStore,
  DshResourceStateInput
} from "../shared/dshResources";
import {
  ALL_DSH_SCHEME_ID,
  DEFAULT_DSH_SCHEME_ID,
  DSH_RESOURCE_SCHEME_VERSION,
  isDshResourceSchemeSelectable
} from "../shared/dshResources";
import { writeTextFileAtomic } from "./filePersistence";

type JsonObject = Record<string, unknown>;
const PACKAGE_PLUGIN_PREFIX = "plugin:package:";

export type DshResourceSchemeManagerOptions = {
  storePath: string;
  inventory: () => DshResourceInventory;
  setDesiredSkills: (states: Record<string, boolean>, defaultEnabled: boolean) => void;
  setDesiredPlugins: (states: Record<string, boolean>) => void;
  now?: () => number;
};

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) return null;
  return [...new Set(value)];
}

function pluginRuntimePackageRecord(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  const record = objectValue(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (entries.some(([id, packageName]) => !id.startsWith("plugin:")
    || id.startsWith("plugin:package:") || typeof packageName !== "string" || !packageName)) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function issue(code: string, message: string, resourceId?: string): DshResourceIssue {
  return { code, message, ...(resourceId ? { resourceId } : {}) };
}

function parseScheme(value: unknown): DshResourceScheme | null {
  const row = objectValue(value);
  const skills = stringArray(row?.skills);
  const plugins = stringArray(row?.plugins);
  if (!row || typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name.trim()
    || skills === null || plugins === null || typeof row.isProtected !== "boolean"
    || typeof row.createdAt !== "number" || typeof row.updatedAt !== "number") return null;
  if (row.description !== undefined && typeof row.description !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    skills,
    plugins,
    isProtected: row.isProtected,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseLegacyRuntimePluginIds(
  row: JsonObject,
  schemes: DshResourceScheme[],
  pluginRuntimePackages: Readonly<Record<string, string>>
): string[] | null {
  if (row.legacyRuntimePluginIds !== undefined) {
    const parsed = stringArray(row.legacyRuntimePluginIds);
    if (parsed === null || parsed.some(id => !id.startsWith("plugin:") || id.startsWith(PACKAGE_PLUGIN_PREFIX))) return null;
    return parsed;
  }
  if (row.pluginRuntimePackages === undefined) {
    return [...new Set(schemes.flatMap(scheme => scheme.plugins
      .filter(id => id.startsWith("plugin:") && !id.startsWith(PACKAGE_PLUGIN_PREFIX))))];
  }
  const all = schemes.find(scheme => scheme.id === ALL_DSH_SCHEME_ID);
  const selectedPackages = new Set((all?.plugins ?? [])
    .filter(id => id.startsWith(PACKAGE_PLUGIN_PREFIX))
    .map(id => id.slice(PACKAGE_PLUGIN_PREFIX.length)));
  return (all?.plugins ?? []).filter(id => {
    if (!id.startsWith("plugin:") || id.startsWith(PACKAGE_PLUGIN_PREFIX)) return false;
    const packageName = pluginRuntimePackages[id];
    return !packageName || !selectedPackages.has(packageName);
  });
}

function parseStore(value: unknown): DshResourceSchemeStore | null {
  const row = objectValue(value);
  if (!row || row.schemaVersion !== DSH_RESOURCE_SCHEME_VERSION || !Array.isArray(row.schemes)) return null;
  const pluginRuntimePackages = pluginRuntimePackageRecord(row.pluginRuntimePackages);
  if (pluginRuntimePackages === null) return null;
  const schemes = row.schemes.map(parseScheme);
  if (schemes.some(scheme => scheme === null)) return null;
  const typed = schemes as DshResourceScheme[];
  if (new Set(typed.map(scheme => scheme.id)).size !== typed.length) return null;
  if (!typed.some(scheme => scheme.id === DEFAULT_DSH_SCHEME_ID) || !typed.some(scheme => scheme.id === ALL_DSH_SCHEME_ID)) return null;
  const legacyRuntimePluginIds = parseLegacyRuntimePluginIds(row, typed, pluginRuntimePackages);
  if (legacyRuntimePluginIds === null) return null;
  if (row.appliedSchemeId !== null && typeof row.appliedSchemeId !== "string") return null;
  return {
    schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
    schemes: typed,
    pluginRuntimePackages,
    legacyRuntimePluginIds,
    appliedSchemeId: row.appliedSchemeId as string | null
  };
}

function initialStore(inventory: DshResourceInventory, now: number): DshResourceSchemeStore {
  const enabled = (kind: "skills" | "plugins") => inventory[kind].filter(item => item.enabled).map(item => item.id);
  const all = (kind: "skills" | "plugins") => inventory[kind].map(item => item.id);
  const pluginRuntimePackages = runtimePluginPackages(inventory);
  const pluginAliases = (enabledOnly: boolean) => [...new Set(inventory.plugins
    .filter(item => !enabledOnly || item.enabled)
    .map(item => item.id.startsWith(PACKAGE_PLUGIN_PREFIX)
      ? item.id
      : `${PACKAGE_PLUGIN_PREFIX}${item.packageName ?? item.name}`))];
  return {
    schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
    schemes: [{
      id: DEFAULT_DSH_SCHEME_ID,
      name: "Default",
      skills: enabled("skills"),
      plugins: pluginAliases(true),
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }, {
      id: ALL_DSH_SCHEME_ID,
      name: "All",
      skills: all("skills"),
      plugins: pluginAliases(false),
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }],
    pluginRuntimePackages,
    legacyRuntimePluginIds: [],
    appliedSchemeId: DEFAULT_DSH_SCHEME_ID
  };
}

function saveStore(path: string, store: DshResourceSchemeStore): void {
  writeTextFileAtomic(path, `${JSON.stringify(store, null, 2)}\n`);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function runtimePluginPackages(inventory: DshResourceInventory): Record<string, string> {
  return Object.fromEntries(inventory.plugins
    .filter(resource => resource.id.startsWith("plugin:") && !resource.id.startsWith(PACKAGE_PLUGIN_PREFIX))
    .map(resource => [resource.id, resource.packageName ?? resource.name]));
}

function synchronizeRuntimePluginPackages(
  current: Readonly<Record<string, string>>,
  inventory: DshResourceInventory
): Record<string, string> {
  const merged = { ...current, ...runtimePluginPackages(inventory) };
  if (inventory.runtimeConnected) return merged;
  const installedPackages = dshPluginPackageNames(inventory.plugins.map(resource => resource.id));
  return Object.fromEntries(Object.entries(merged).filter(([, packageName]) => installedPackages.has(packageName)));
}

function canonicalPluginIds(ids: string[], pluginRuntimePackages: Readonly<Record<string, string>>): string[] {
  return [...new Set(ids.map(id => {
    const packageName = pluginRuntimePackages[id];
    return packageName ? `${PACKAGE_PLUGIN_PREFIX}${packageName}` : id;
  }))];
}

function retainedLegacyRuntimePluginIds(schemes: DshResourceScheme[], legacyRuntimePluginIds: string[]): string[] {
  const retainedPluginIds = new Set(schemes.flatMap(scheme => scheme.plugins));
  return legacyRuntimePluginIds.filter(id => retainedPluginIds.has(id));
}

function recordsEqual(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const entries = Object.entries(left);
  return entries.length === Object.keys(right).length && entries.every(([key, value]) => right[key] === value);
}

function migrateSkillIds(ids: string[], inventory: DshResourceInventory): string[] {
  const currentBySourceId = new Map<string, string>();
  for (const resource of inventory.skills) {
    currentBySourceId.set(resource.id, resource.id);
    for (const sourceId of resource.sourceIds ?? []) currentBySourceId.set(sourceId, resource.id);
  }
  return [...new Set(ids.map(id => currentBySourceId.get(id) ?? id))];
}

function driftFor(store: DshResourceSchemeStore, inventory: DshResourceInventory): DshResourceDrift {
  const schemeId = store.appliedSchemeId;
  const scheme = store.schemes.find(item => item.id === schemeId);
  if (!scheme) return { schemeId, isDrifted: schemeId !== null, skills: schemeId !== null, plugins: schemeId !== null };
  const selectedSkills = new Set(scheme.skills);
  const skills = inventory.skills.some(item => item.manageable && selectedSkills.has(item.id) !== item.enabled);
  const selectedPlugins = new Set(scheme.plugins);
  const all = store.schemes.find(item => item.id === ALL_DSH_SCHEME_ID);
  const allowPluginDisable = !scheme.plugins.some(id => store.legacyRuntimePluginIds.includes(id));
  const desiredPlugins = dshDesiredPluginStates(inventory.plugins, selectedPlugins, dshPluginPackageNames(all?.plugins ?? []), allowPluginDisable);
  const plugins = inventory.plugins.some(item => {
    if (!item.manageable) return false;
    const entryId = item.id.replace(/^plugin:/, "");
    return Object.prototype.hasOwnProperty.call(desiredPlugins, entryId) && desiredPlugins[entryId] !== item.enabled;
  });
  return { schemeId, isDrifted: skills || plugins, skills, plugins };
}

function nextId(name: string, schemes: DshResourceScheme[]): string {
  const base = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scheme";
  let id = base;
  let suffix = 2;
  while (schemes.some(scheme => scheme.id === id)) id = `${base}-${suffix++}`;
  return id;
}

export class DshResourceSchemeManager {
  private readonly now: () => number;

  constructor(private readonly options: DshResourceSchemeManagerOptions) {
    this.now = options.now ?? Date.now;
  }

  private load(inventory: DshResourceInventory): DshResourceSchemeStore {
    if (!existsSync(this.options.storePath)) {
      const created = initialStore(inventory, this.now());
      saveStore(this.options.storePath, created);
      return created;
    }
    try {
      const store = parseStore(JSON.parse(readFileSync(this.options.storePath, "utf8")));
      if (!store) throw new Error("invalid DSH resource scheme store");
      return store;
    } catch {
      throw new Error("DSH resource schemes could not be read safely.");
    }
  }

  private synchronizeStore(store: DshResourceSchemeStore, inventory: DshResourceInventory): DshResourceSchemeStore {
    const all = store.schemes.find(scheme => scheme.id === ALL_DSH_SCHEME_ID);
    if (!all) return store;
    const pluginRuntimePackages = synchronizeRuntimePluginPackages(store.pluginRuntimePackages, inventory);
    const canonicalize = (ids: string[]) => canonicalPluginIds(ids, pluginRuntimePackages);
    const skills = inventory.skills.map(item => item.id);
    const runtimePlugins = inventory.plugins.map(item => item.id);
    const offlinePackageIds = inventory.plugins.filter(item => item.id.startsWith(PACKAGE_PLUGIN_PREFIX)).map(item => item.id);
    const offlinePackageSet = new Set(offlinePackageIds);
    const canonicalAllPlugins = canonicalize(all.plugins);
    const plugins = inventory.runtimeConnected
      ? canonicalPluginIds([...canonicalAllPlugins, ...runtimePlugins], pluginRuntimePackages)
      : canonicalPluginIds([
        ...canonicalAllPlugins.filter(id => !id.startsWith(PACKAGE_PLUGIN_PREFIX) || offlinePackageSet.has(id)),
        ...offlinePackageIds
      ], pluginRuntimePackages);
    const timestamp = this.now();
    const schemes = store.schemes.map(scheme => {
      const nextSkills = migrateSkillIds(scheme.skills, inventory);
      const nextPlugins = canonicalize(scheme.plugins);
      if (scheme.id === ALL_DSH_SCHEME_ID) {
        if (arraysEqual(scheme.skills, skills) && arraysEqual(scheme.plugins, plugins)) return scheme;
        return { ...scheme, skills, plugins, updatedAt: timestamp };
      }
      if (arraysEqual(scheme.skills, nextSkills) && arraysEqual(scheme.plugins, nextPlugins)) return scheme;
      return { ...scheme, skills: nextSkills, plugins: nextPlugins, updatedAt: timestamp };
    });
    const pendingLegacyRuntimePluginIds = retainedLegacyRuntimePluginIds(schemes, store.legacyRuntimePluginIds);
    const next = {
      ...store,
      pluginRuntimePackages,
      legacyRuntimePluginIds: pendingLegacyRuntimePluginIds,
      schemes
    };
    if (recordsEqual(pluginRuntimePackages, store.pluginRuntimePackages)
      && arraysEqual(pendingLegacyRuntimePluginIds, store.legacyRuntimePluginIds)
      && next.schemes.every((scheme, index) => scheme === store.schemes[index])) return store;
    saveStore(this.options.storePath, next);
    return next;
  }

  private state(): { store: DshResourceSchemeStore; inventory: DshResourceInventory } {
    const inventory = this.options.inventory();
    const store = this.synchronizeStore(this.load(inventory), inventory);
    return { store, inventory };
  }

  private projectSnapshot(store: DshResourceSchemeStore, inventory: DshResourceInventory): DshResourceSchemesSnapshot {
    return {
      ...store,
      inventory,
      drift: driftFor(store, inventory)
    };
  }

  snapshot(): DshResourceSchemesSnapshot {
    const { store, inventory } = this.state();
    return this.projectSnapshot(store, inventory);
  }

  save(input: DshResourceSchemeSaveInput): DshResourceMutationResult {
    const { store: currentStore, inventory } = this.state();
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const requestedSkills = stringArray(input.skills);
    const requestedPlugins = stringArray(input.plugins);
    if (!name || requestedSkills === null || requestedPlugins === null) return { ok: false, issues: [issue("invalid-scheme-input", "Scheme content is invalid.")] };
    const withFixed = (requested: string[], kind: "skills" | "plugins") => [...new Set([
      ...inventory[kind].filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id),
      ...requested
    ])];
    const skills = withFixed(requestedSkills, "skills");
    const plugins = canonicalPluginIds(withFixed(requestedPlugins, "plugins"), currentStore.pluginRuntimePackages);
    const existing = input.id ? currentStore.schemes.find(scheme => scheme.id === input.id) : undefined;
    if (input.id && !existing) return { ok: false, issues: [issue("scheme-not-found", "Scheme no longer exists.")] };
    if (existing?.id === ALL_DSH_SCHEME_ID) return { ok: false, issues: [issue("protected-scheme", "The All scheme updates automatically.")] };
    if (currentStore.schemes.some(scheme => scheme.id !== input.id && scheme.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return { ok: false, issues: [issue("duplicate-scheme-name", "A scheme with this name already exists.")] };
    }
    const invalid = skills.find(id => !id.startsWith("skill:")) ?? plugins.find(id => !id.startsWith("plugin:"));
    if (invalid) return { ok: false, issues: [issue("invalid-scheme-input", "Scheme contains an invalid resource ID.", invalid)] };
    const timestamp = this.now();
    const scheme: DshResourceScheme = existing ? {
      ...existing,
      name: existing.isProtected ? existing.name : name,
      ...(input.description?.trim() ? { description: input.description.trim() } : { description: undefined }),
      skills,
      plugins,
      updatedAt: timestamp
    } : {
      id: nextId(name, currentStore.schemes),
      name,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      skills,
      plugins,
      isProtected: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const store: DshResourceSchemeStore = {
      schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
      schemes: existing ? currentStore.schemes.map(item => item.id === scheme.id ? scheme : item) : [...currentStore.schemes, scheme],
      pluginRuntimePackages: currentStore.pluginRuntimePackages,
      legacyRuntimePluginIds: currentStore.legacyRuntimePluginIds,
      appliedSchemeId: currentStore.appliedSchemeId
    };
    saveStore(this.options.storePath, store);
    return { ok: true, schemeId: scheme.id, snapshot: this.snapshot() };
  }

  delete(schemeId: string): DshResourceMutationResult {
    const { store, inventory } = this.state();
    const scheme = store.schemes.find(item => item.id === schemeId);
    if (!scheme) return { ok: false, issues: [issue("scheme-not-found", "Scheme no longer exists.")] };
    if (scheme.isProtected || store.appliedSchemeId === schemeId) return { ok: false, issues: [issue("protected-scheme", "This scheme cannot be deleted.")] };
    const schemes = store.schemes.filter(item => item.id !== schemeId);
    const nextStore = {
      ...store,
      schemes,
      legacyRuntimePluginIds: retainedLegacyRuntimePluginIds(schemes, store.legacyRuntimePluginIds)
    };
    saveStore(this.options.storePath, nextStore);
    return { ok: true, schemeId, snapshot: this.projectSnapshot(nextStore, inventory) };
  }

  private applyRuntime(
    scheme: DshResourceScheme,
    inventory: DshResourceInventory,
    allPlugins: string[],
    allowPluginDisable: boolean
  ): void {
    const selectedSkills = new Set(scheme.skills);
    this.options.setDesiredSkills(
      dshDesiredSkillStates(inventory.skills, selectedSkills),
      scheme.id === ALL_DSH_SCHEME_ID
    );
    const selectedPlugins = new Set(scheme.plugins);
    this.options.setDesiredPlugins(inventory.runtimeConnected
      ? dshDesiredPluginStates(inventory.plugins, selectedPlugins, dshPluginPackageNames(allPlugins), allowPluginDisable)
      : {});
  }

  apply(schemeId: string): DshResourceMutationResult {
    const { store, inventory } = this.state();
    const scheme = store.schemes.find(item => item.id === schemeId);
    if (!scheme) return { ok: false, issues: [issue("scheme-not-found", "Scheme no longer exists.")] };
    try {
      this.applyRuntime(
        scheme,
        inventory,
        store.schemes.find(item => item.id === ALL_DSH_SCHEME_ID)?.plugins ?? [],
        !scheme.plugins.some(id => store.legacyRuntimePluginIds.includes(id))
      );
      const appliedStore = { ...store, appliedSchemeId: scheme.id };
      saveStore(this.options.storePath, appliedStore);
      return { ok: true, schemeId: scheme.id, snapshot: this.snapshot() };
    } catch (error) {
      return { ok: false, issues: [issue("scheme-apply-failed", error instanceof Error ? error.message : String(error))] };
    }
  }

  setResourceState(input: DshResourceStateInput): DshResourceMutationResult {
    const { store, inventory } = this.state();
    const scheme = store.schemes.find(item => item.id === input.schemeId);
    if (!scheme || scheme.id === ALL_DSH_SCHEME_ID) return { ok: false, issues: [issue("protected-scheme", "This scheme cannot be changed.")] };
    if (store.appliedSchemeId !== scheme.id) return { ok: false, issues: [issue("inactive-scheme", "Apply this scheme before changing a live resource.")] };
    const skill = inventory.skills.find(item => item.id === input.resourceId);
    const requestedPackage = input.resourceId.startsWith(PACKAGE_PLUGIN_PREFIX)
      ? input.resourceId.slice(PACKAGE_PLUGIN_PREFIX.length)
      : store.pluginRuntimePackages[input.resourceId]
        ?? inventory.plugins.find(item => item.id === input.resourceId)?.packageName;
    const pluginResources = requestedPackage
      ? inventory.plugins.filter(item => (item.packageName ?? item.name) === requestedPackage)
      : [];
    if (!skill && pluginResources.length === 0) return { ok: false, issues: [issue("missing-resource", "Resource no longer exists.", input.resourceId)] };
    if (skill ? !skill.manageable || skill.required : pluginResources.some(item => item.required) || !pluginResources.some(item => item.manageable)) {
      return { ok: false, issues: [issue("protected-resource", "This DSH resource is required.", input.resourceId)] };
    }
    try {
      if (skill) {
        const enabled = new Set(inventory.skills.filter(item => item.enabled).map(item => item.id));
        if (input.enabled) enabled.add(skill.id); else enabled.delete(skill.id);
        this.options.setDesiredSkills(dshDesiredSkillStates(inventory.skills, enabled), false);
      } else {
        this.options.setDesiredPlugins(Object.fromEntries(inventory.plugins
          .filter(item => item.manageable)
          .map(item => [
            item.id.replace(/^plugin:/, ""),
            (item.packageName ?? item.name) === requestedPackage ? input.enabled : item.enabled
          ])));
      }
    } catch (error) {
      return { ok: false, issues: [issue("resource-state-failed", error instanceof Error ? error.message : String(error), input.resourceId)] };
    }
    return { ok: true, schemeId: scheme.id, snapshot: this.snapshot() };
  }
}

export function dshDesiredSkillStates(resources: DshResourceInventory["skills"], selected: ReadonlySet<string>): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const resource of resources.filter(item => item.manageable)) {
    states[resource.name] = Boolean(states[resource.name]) || selected.has(resource.id);
  }
  return states;
}

export function dshPluginPackageNames(ids: Iterable<string>): Set<string> {
  return new Set([...ids]
    .filter(id => id.startsWith(PACKAGE_PLUGIN_PREFIX))
    .map(id => id.slice(PACKAGE_PLUGIN_PREFIX.length)));
}

export function dshDesiredPluginStates(
  resources: DshResourceInventory["plugins"],
  selected: ReadonlySet<string>,
  installedPackages: ReadonlySet<string>,
  allowDisable = true
): Record<string, boolean> {
  const selectedPackages = dshPluginPackageNames(selected);
  const states: Record<string, boolean> = {};
  for (const resource of resources.filter(item => item.manageable)) {
    const packageName = resource.packageName ?? resource.name;
    const explicitlySelected = selected.has(resource.id) || selectedPackages.has(packageName);
    if (!explicitlySelected && !allowDisable) continue;
    if (!explicitlySelected && installedPackages.size > 0 && !installedPackages.has(packageName)) continue;
    states[resource.id.replace(/^plugin:/, "")] = explicitlySelected;
  }
  return states;
}

export function inheritDshPluginPackageStates(
  resources: DshResourceInventory["plugins"],
  baseline: Readonly<Record<string, boolean>>,
  previous: Readonly<Record<string, boolean>>,
  pluginRuntimePackages: Readonly<Record<string, string>>
): Record<string, boolean> {
  const currentPackages = new Map(resources.map(resource => [
    resource.id,
    resource.packageName ?? resource.name
  ]));
  const packageStates = new Map<string, boolean>();
  for (const [entryId, enabled] of Object.entries(previous)) {
    const resourceId = `plugin:${entryId}`;
    const packageName = pluginRuntimePackages[resourceId] ?? currentPackages.get(resourceId);
    if (!packageName) continue;
    packageStates.set(packageName, (packageStates.get(packageName) ?? true) && enabled);
  }
  const next = { ...baseline };
  for (const resource of resources.filter(item => item.manageable)) {
    const packageState = packageStates.get(resource.packageName ?? resource.name);
    if (packageState !== undefined) next[resource.id.replace(/^plugin:/, "")] = packageState;
  }
  return next;
}

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

function parseStore(value: unknown): DshResourceSchemeStore | null {
  const row = objectValue(value);
  if (!row || row.schemaVersion !== DSH_RESOURCE_SCHEME_VERSION || !Array.isArray(row.schemes)) return null;
  const schemes = row.schemes.map(parseScheme);
  if (schemes.some(scheme => scheme === null)) return null;
  const typed = schemes as DshResourceScheme[];
  if (new Set(typed.map(scheme => scheme.id)).size !== typed.length) return null;
  if (!typed.some(scheme => scheme.id === DEFAULT_DSH_SCHEME_ID) || !typed.some(scheme => scheme.id === ALL_DSH_SCHEME_ID)) return null;
  if (row.appliedSchemeId !== null && typeof row.appliedSchemeId !== "string") return null;
  return { schemaVersion: DSH_RESOURCE_SCHEME_VERSION, schemes: typed, appliedSchemeId: row.appliedSchemeId as string | null };
}

function initialStore(inventory: DshResourceInventory, now: number): DshResourceSchemeStore {
  const enabled = (kind: "skills" | "plugins") => inventory[kind].filter(item => item.enabled).map(item => item.id);
  const all = (kind: "skills" | "plugins") => inventory[kind].map(item => item.id);
  return {
    schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
    schemes: [{
      id: DEFAULT_DSH_SCHEME_ID,
      name: "Default",
      skills: enabled("skills"),
      plugins: enabled("plugins"),
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }, {
      id: ALL_DSH_SCHEME_ID,
      name: "All",
      skills: all("skills"),
      plugins: all("plugins"),
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }],
    appliedSchemeId: DEFAULT_DSH_SCHEME_ID
  };
}

function saveStore(path: string, store: DshResourceSchemeStore): void {
  writeTextFileAtomic(path, `${JSON.stringify(store, null, 2)}\n`);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const PACKAGE_PLUGIN_PREFIX = "plugin:package:";

function migrateRuntimePluginIds(
  ids: string[],
  inventory: DshResourceInventory,
  installedPackages: ReadonlySet<string>
): string[] {
  const runtimeIdsByPackage = new Map<string, string[]>();
  for (const resource of inventory.plugins) {
    if (!resource.manageable && !resource.required) continue;
    if (!resource.id.startsWith("plugin:") || resource.id.startsWith(PACKAGE_PLUGIN_PREFIX)) continue;
    const packageName = resource.packageName ?? resource.name;
    const entries = runtimeIdsByPackage.get(packageName) ?? [];
    entries.push(resource.id);
    runtimeIdsByPackage.set(packageName, entries);
  }
  let unresolved = false;
  const migrated = ids.flatMap(id => {
    if (!id.startsWith(PACKAGE_PLUGIN_PREFIX)) return [id];
    const runtimeIds = runtimeIdsByPackage.get(id.slice(PACKAGE_PLUGIN_PREFIX.length));
    if (runtimeIds) return runtimeIds;
    unresolved = true;
    return [];
  });
  if (unresolved) {
    for (const resource of inventory.plugins) {
      if (resource.enabled && !installedPackages.has(resource.packageName ?? resource.name)) migrated.push(resource.id);
    }
  }
  return [...new Set(migrated)];
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
  const differs = (kind: "skills" | "plugins") => {
    const selected = new Set(scheme[kind]);
    return inventory[kind].some(item => item.manageable && selected.has(item.id) !== item.enabled);
  };
  const skills = differs("skills");
  const plugins = differs("plugins");
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

  private synchronizeAll(store: DshResourceSchemeStore, inventory: DshResourceInventory): DshResourceSchemeStore {
    const all = store.schemes.find(scheme => scheme.id === ALL_DSH_SCHEME_ID);
    if (!all) return store;
    const skills = inventory.skills.map(item => item.id);
    const installedPackages = new Set(all.plugins
      .filter(id => id.startsWith(PACKAGE_PLUGIN_PREFIX))
      .map(id => id.slice(PACKAGE_PLUGIN_PREFIX.length)));
    const knownRuntimePlugins = all.plugins.filter(id => !id.startsWith(PACKAGE_PLUGIN_PREFIX));
    const knownRuntimePluginSet = new Set(knownRuntimePlugins);
    const runtimePlugins = inventory.plugins.map(item => item.id);
    const runtimeWasResolved = installedPackages.size === 0;
    // A newly connected profile starts from its live state; subsequent explicit scheme actions own it.
    const newlyDiscoveredPlugins = runtimeWasResolved
      ? inventory.plugins.filter(item => !knownRuntimePluginSet.has(item.id) && item.enabled).map(item => item.id)
      : [];
    const plugins = inventory.runtimeConnected
      ? [...new Set([...knownRuntimePlugins, ...runtimePlugins])]
      : all.plugins;
    const migrateRuntimePlugins = inventory.runtimeConnected;
    const timestamp = this.now();
    const next = {
      ...store,
      schemes: store.schemes.map(scheme => {
        const nextSkills = migrateSkillIds(scheme.skills, inventory);
        let nextPlugins = migrateRuntimePlugins
          ? migrateRuntimePluginIds(scheme.plugins, inventory, installedPackages)
          : scheme.plugins;
        if (scheme.id === ALL_DSH_SCHEME_ID) {
          if (arraysEqual(scheme.skills, skills) && arraysEqual(scheme.plugins, plugins)) return scheme;
          return { ...scheme, skills, plugins, updatedAt: timestamp };
        }
        if (scheme.id === store.appliedSchemeId && newlyDiscoveredPlugins.length > 0) {
          nextPlugins = [...new Set([...nextPlugins, ...newlyDiscoveredPlugins])];
        }
        if (arraysEqual(scheme.skills, nextSkills) && arraysEqual(scheme.plugins, nextPlugins)) return scheme;
        return { ...scheme, skills: nextSkills, plugins: nextPlugins, updatedAt: timestamp };
      })
    };
    if (next.schemes.every((scheme, index) => scheme === store.schemes[index])) return store;
    saveStore(this.options.storePath, next);
    return next;
  }

  snapshot(): DshResourceSchemesSnapshot {
    const inventory = this.options.inventory();
    const store = this.synchronizeAll(this.load(inventory), inventory);
    return { ...store, inventory, drift: driftFor(store, inventory) };
  }

  save(input: DshResourceSchemeSaveInput): DshResourceMutationResult {
    const snapshot = this.snapshot();
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const requestedSkills = stringArray(input.skills);
    const requestedPlugins = stringArray(input.plugins);
    if (!name || requestedSkills === null || requestedPlugins === null) return { ok: false, issues: [issue("invalid-scheme-input", "Scheme content is invalid.")] };
    const withFixed = (requested: string[], kind: "skills" | "plugins") => [...new Set([
      ...snapshot.inventory[kind].filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id),
      ...requested
    ])];
    const skills = withFixed(requestedSkills, "skills");
    const plugins = withFixed(requestedPlugins, "plugins");
    const existing = input.id ? snapshot.schemes.find(scheme => scheme.id === input.id) : undefined;
    if (input.id && !existing) return { ok: false, issues: [issue("scheme-not-found", "Scheme no longer exists.")] };
    if (existing?.id === ALL_DSH_SCHEME_ID) return { ok: false, issues: [issue("protected-scheme", "The All scheme updates automatically.")] };
    if (snapshot.schemes.some(scheme => scheme.id !== input.id && scheme.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
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
      id: nextId(name, snapshot.schemes),
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
      schemes: existing ? snapshot.schemes.map(item => item.id === scheme.id ? scheme : item) : [...snapshot.schemes, scheme],
      appliedSchemeId: snapshot.appliedSchemeId
    };
    saveStore(this.options.storePath, store);
    return { ok: true, schemeId: scheme.id, snapshot: this.snapshot() };
  }

  delete(schemeId: string): DshResourceMutationResult {
    const snapshot = this.snapshot();
    const scheme = snapshot.schemes.find(item => item.id === schemeId);
    if (!scheme) return { ok: false, issues: [issue("scheme-not-found", "Scheme no longer exists.")] };
    if (scheme.isProtected || snapshot.appliedSchemeId === schemeId) return { ok: false, issues: [issue("protected-scheme", "This scheme cannot be deleted.")] };
    saveStore(this.options.storePath, {
      schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
      schemes: snapshot.schemes.filter(item => item.id !== schemeId),
      appliedSchemeId: snapshot.appliedSchemeId
    });
    return { ok: true, schemeId, snapshot: this.snapshot() };
  }

  private applyRuntime(scheme: DshResourceScheme, inventory: DshResourceInventory): void {
    const selectedSkills = new Set(scheme.skills);
    this.options.setDesiredSkills(
      dshDesiredSkillStates(inventory.skills, selectedSkills),
      scheme.id === ALL_DSH_SCHEME_ID
    );
    const selectedPlugins = new Set(scheme.plugins);
    this.options.setDesiredPlugins(inventory.runtimeConnected
      ? dshDesiredPluginStates(inventory.plugins, selectedPlugins)
      : {});
  }

  apply(schemeId: string): DshResourceMutationResult {
    const snapshot = this.snapshot();
    const scheme = snapshot.schemes.find(item => item.id === schemeId);
    if (!scheme) return { ok: false, issues: [issue("scheme-not-found", "Scheme no longer exists.")] };
    try {
      this.applyRuntime(scheme, snapshot.inventory);
      saveStore(this.options.storePath, {
        schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
        schemes: snapshot.schemes,
        appliedSchemeId: scheme.id
      });
      return { ok: true, schemeId: scheme.id, snapshot: this.snapshot() };
    } catch (error) {
      return { ok: false, issues: [issue("scheme-apply-failed", error instanceof Error ? error.message : String(error))] };
    }
  }

  setResourceState(input: DshResourceStateInput): DshResourceMutationResult {
    const snapshot = this.snapshot();
    const scheme = snapshot.schemes.find(item => item.id === input.schemeId);
    if (!scheme || scheme.id === ALL_DSH_SCHEME_ID) return { ok: false, issues: [issue("protected-scheme", "This scheme cannot be changed.")] };
    if (snapshot.appliedSchemeId !== scheme.id) return { ok: false, issues: [issue("inactive-scheme", "Apply this scheme before changing a live resource.")] };
    const resource = [...snapshot.inventory.skills, ...snapshot.inventory.plugins].find(item => item.id === input.resourceId);
    if (!resource) return { ok: false, issues: [issue("missing-resource", "Resource no longer exists.", input.resourceId)] };
    if (!resource.manageable || resource.required) return { ok: false, issues: [issue("protected-resource", "This DSH resource is required.", input.resourceId)] };
    try {
      if (resource.kind === "skill") {
        const enabled = new Set(snapshot.inventory.skills.filter(item => item.enabled).map(item => item.id));
        if (input.enabled) enabled.add(resource.id); else enabled.delete(resource.id);
        this.options.setDesiredSkills(dshDesiredSkillStates(snapshot.inventory.skills, enabled), false);
      } else {
        this.options.setDesiredPlugins(Object.fromEntries(snapshot.inventory.plugins
          .filter(item => item.manageable)
          .map(item => [item.id.replace(/^plugin:/, ""), item.id === resource.id ? input.enabled : item.enabled])));
      }
    } catch (error) {
      return { ok: false, issues: [issue("resource-state-failed", error instanceof Error ? error.message : String(error), resource.id)] };
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

export function dshDesiredPluginStates(resources: DshResourceInventory["plugins"], selected: ReadonlySet<string>): Record<string, boolean> {
  const unresolved = [...selected].some(id => id.startsWith(PACKAGE_PLUGIN_PREFIX));
  return Object.fromEntries(resources
    .filter(item => item.manageable && (!unresolved || selected.has(item.id)))
    .map(item => [item.id.replace(/^plugin:/, ""), selected.has(item.id)]));
}

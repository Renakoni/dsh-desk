import type { DshRuntimePluginEntry, DshRuntimePluginPhase, DshRuntimePluginSnapshot, DshRuntimeSkillEntry } from "../shared/dshPlugins";
import type { DshResourceItem } from "../shared/dshResources";

const PHASES = new Set<DshRuntimePluginPhase>(["pending", "loading", "active", "failed", "unloading", null]);
const MAX_RUNTIME_ENTRIES = 2048;
const MAX_RUNTIME_SKILLS = 4096;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DSH_RUNTIME_PLUGIN_TTL_MS = 15_000;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

export function normalizeDshRuntimePluginSnapshot(value: unknown, receivedAt = Date.now()): DshRuntimePluginSnapshot | null {
  const payload = objectValue(value);
  if (!payload || !Array.isArray(payload.entries) || payload.entries.length > MAX_RUNTIME_ENTRIES
    || (payload.skills !== undefined && (!Array.isArray(payload.skills) || payload.skills.length > MAX_RUNTIME_SKILLS))) return null;
  const instanceId = payload.instanceId === undefined ? "legacy" : boundedString(payload.instanceId, 128);
  if (!instanceId) return null;
  const entries: DshRuntimePluginEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of payload.entries) {
    const entry = objectValue(candidate);
    if (!entry) return null;
    const entryId = boundedString(entry.entryId, 512);
    const configId = boundedString(entry.configId, 256);
    const moduleName = boundedString(entry.moduleName, 512);
    const ownerPackage = entry.ownerPackage === undefined ? undefined : boundedString(entry.ownerPackage, 512);
    const componentKey = entry.componentKey === undefined ? undefined : boundedString(entry.componentKey, 512);
    const baselineEnabled = entry.baselineEnabled;
    const fiberPhase = entry.fiberPhase as DshRuntimePluginPhase;
    if (!entryId || !configId || !moduleName || entry.ownerPackage !== undefined && !ownerPackage
      || entry.componentKey !== undefined && !componentKey
      || (componentKey === undefined) !== (baselineEnabled === undefined)
      || baselineEnabled !== undefined && baselineEnabled !== null && typeof baselineEnabled !== "boolean"
      || typeof entry.enabled !== "boolean" || !PHASES.has(fiberPhase) || ids.has(entryId)) return null;
    ids.add(entryId);
    entries.push({
      entryId,
      configId,
      moduleName,
      ...(ownerPackage ? { ownerPackage } : {}),
      ...(componentKey ? { componentKey, baselineEnabled: baselineEnabled as boolean | null } : {}),
      enabled: entry.enabled,
      fiberPhase
    });
  }
  const skills: DshRuntimeSkillEntry[] = [];
  for (const candidate of payload.skills ?? []) {
    const skill = objectValue(candidate);
    if (!skill) return null;
    const name = boundedString(skill.name, 256);
    const description = boundedString(skill.description, 4000);
    const source = boundedString(skill.source, 256);
    const provider = boundedString(skill.provider, 512);
    if (!name || !SKILL_NAME.test(name) || !description || !source || !provider
      || typeof skill.modelInvocable !== "boolean" || typeof skill.userInvocable !== "boolean"
      || typeof skill.enabled !== "boolean") return null;
    skills.push({
      name,
      description,
      source,
      provider,
      modelInvocable: skill.modelInvocable,
      userInvocable: skill.userInvocable,
      enabled: skill.enabled
    });
  }
  return { instanceId, entries, skills, receivedAt };
}

export function isDshRuntimePluginSnapshotFresh(
  snapshot: DshRuntimePluginSnapshot | null,
  now = Date.now(),
  ttl = DSH_RUNTIME_PLUGIN_TTL_MS
): boolean {
  if (!snapshot || !Number.isFinite(snapshot.receivedAt) || !Number.isFinite(now) || !Number.isFinite(ttl) || ttl <= 0) return false;
  return now - snapshot.receivedAt < ttl;
}

function aggregateDshRuntimeSnapshots(snapshots: DshRuntimePluginSnapshot[]): DshRuntimePluginSnapshot | null {
  if (snapshots.length === 0) return null;
  const entries = new Map<string, DshRuntimePluginEntry>();
  const skills: DshRuntimeSkillEntry[] = [];
  let receivedAt = 0;
  for (const snapshot of snapshots) {
    receivedAt = Math.max(receivedAt, snapshot.receivedAt);
    skills.push(...snapshot.skills);
    for (const entry of snapshot.entries) {
      const existing = entries.get(entry.entryId);
      const sameOwner = existing?.ownerPackage === entry.ownerPackage;
      const sameComponent = sameOwner && existing?.componentKey === entry.componentKey;
      entries.set(entry.entryId, existing ? {
        ...existing,
        ...(sameOwner ? {} : { ownerPackage: undefined }),
        ...(sameComponent && entry.componentKey ? {
          componentKey: entry.componentKey,
          baselineEnabled: existing.baselineEnabled === entry.baselineEnabled ? entry.baselineEnabled : null
        } : { componentKey: undefined, baselineEnabled: undefined }),
        enabled: existing.enabled && entry.enabled
      } : entry);
    }
  }
  return { instanceId: "aggregate", entries: [...entries.values()], skills, receivedAt };
}

export class DshRuntimeSnapshotSet {
  private readonly snapshots = new Map<string, DshRuntimePluginSnapshot>();

  update(snapshot: DshRuntimePluginSnapshot): void {
    this.snapshots.set(snapshot.instanceId, snapshot);
  }

  current(now = Date.now()): DshRuntimePluginSnapshot | null {
    for (const [instanceId, snapshot] of this.snapshots) {
      if (!isDshRuntimePluginSnapshotFresh(snapshot, now)) this.snapshots.delete(instanceId);
    }
    return aggregateDshRuntimeSnapshots([...this.snapshots.values()]);
  }
}

export function dshRuntimePluginResources(snapshot: DshRuntimePluginSnapshot | null): DshResourceItem[] {
  if (!snapshot) return [];
  const grouped = new Map<string, DshRuntimePluginEntry[]>();
  for (const entry of snapshot.entries) {
    if (!entry.ownerPackage) continue;
    const owned = grouped.get(entry.ownerPackage) ?? [];
    owned.push(entry);
    grouped.set(entry.ownerPackage, owned);
  }
  const protectedPackages = new Set([
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "@deepseek-ai/dsh-headless",
    "dsh-desk-plugin"
  ]);
  return [...grouped.entries()].map(([packageName, entries]) => {
    const protectedPackage = protectedPackages.has(packageName);
    const components = entries
      .filter(entry => entry.componentKey)
      .map(entry => ({
        key: entry.componentKey as string,
        name: entry.configId,
        moduleName: entry.moduleName,
        baselineEnabled: entry.baselineEnabled ?? null,
        enabled: entry.enabled,
        manageable: packageName !== "dsh-desk-plugin",
        fiberPhase: entry.fiberPhase
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
    return {
      id: `plugin:package:${packageName}`,
      kind: "plugin" as const,
      name: packageName,
      packageName,
      description: "DSH plugin bundle",
      enabled: entries.some(entry => entry.enabled),
      manageable: !protectedPackage,
      schemeSelectable: true,
      sourceIds: entries.map(entry => `plugin:${entry.entryId}`),
      components,
      required: protectedPackage
    };
  });
}

export function dshRuntimeSkillResources(snapshot: DshRuntimePluginSnapshot | null): DshResourceItem[] {
  if (!snapshot) return [];
  const grouped = new Map<string, DshRuntimeSkillEntry[]>();
  for (const skill of snapshot.skills) {
    const entries = grouped.get(skill.name) ?? [];
    entries.push(skill);
    grouped.set(skill.name, entries);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entries]) => {
      const visible = entries.find(skill => skill.enabled) ?? entries[0];
      const sources = [...new Set(entries.map(skill => `${skill.source} - ${skill.provider}`))];
      return {
        id: `skill:name:${name}`,
        kind: "skill" as const,
        name,
        description: visible.description,
        detail: sources.join(" + "),
        enabled: entries.every(skill => skill.enabled),
        manageable: true
      };
    });
}

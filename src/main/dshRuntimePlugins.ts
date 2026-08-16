import type { DshRuntimePluginEntry, DshRuntimePluginPhase, DshRuntimePluginSnapshot } from "../shared/dshPlugins";
import type { DshResourceItem } from "../shared/dshResources";

const PHASES = new Set<DshRuntimePluginPhase>(["pending", "loading", "active", "failed", "unloading", null]);
const MAX_RUNTIME_ENTRIES = 2048;
export const DSH_RUNTIME_PLUGIN_TTL_MS = 15_000;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

export function normalizeDshRuntimePluginSnapshot(value: unknown, receivedAt = Date.now()): DshRuntimePluginSnapshot | null {
  const payload = objectValue(value);
  if (!payload || !Array.isArray(payload.entries) || payload.entries.length > MAX_RUNTIME_ENTRIES) return null;
  const entries: DshRuntimePluginEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of payload.entries) {
    const entry = objectValue(candidate);
    if (!entry) return null;
    const entryId = boundedString(entry.entryId, 512);
    const configId = boundedString(entry.configId, 256);
    const moduleName = boundedString(entry.moduleName, 512);
    const fiberPhase = entry.fiberPhase as DshRuntimePluginPhase;
    if (!entryId || !configId || !moduleName || typeof entry.enabled !== "boolean" || !PHASES.has(fiberPhase) || ids.has(entryId)) return null;
    ids.add(entryId);
    entries.push({ entryId, configId, moduleName, enabled: entry.enabled, fiberPhase });
  }
  return { entries, receivedAt };
}

export function isDshRuntimePluginSnapshotFresh(
  snapshot: DshRuntimePluginSnapshot | null,
  now = Date.now(),
  ttl = DSH_RUNTIME_PLUGIN_TTL_MS
): boolean {
  if (!snapshot || !Number.isFinite(snapshot.receivedAt) || !Number.isFinite(now) || !Number.isFinite(ttl) || ttl <= 0) return false;
  return now - snapshot.receivedAt < ttl;
}

export function dshRuntimePluginResources(snapshot: DshRuntimePluginSnapshot | null): DshResourceItem[] {
  if (!snapshot) return [];
  return snapshot.entries.map(entry => {
    const protectedEntry = entry.moduleName.startsWith("@deepseek-ai/") || entry.moduleName === "dsh-desk-plugin" || entry.configId === "dsh-desk";
    return {
      id: `plugin:${entry.entryId}`,
      kind: "plugin" as const,
      name: entry.moduleName,
      packageName: entry.moduleName,
      detail: entry.entryId,
      description: entry.fiberPhase === null ? "DSH Loader" : `DSH Loader - ${entry.fiberPhase}`,
      enabled: entry.enabled,
      manageable: !protectedEntry,
      required: protectedEntry
    };
  });
}

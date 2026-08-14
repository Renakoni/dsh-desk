/** Main-process-only preservation store for full global MCP definitions. */
import { existsSync, readFileSync } from "node:fs";
import type { ClaudeProfileMcpStatus, ClaudeProfileResource } from "../shared/claudeProfiles";
import { quarantineInvalidJsonFile, writeTextFileAtomic } from "./filePersistence";

type JsonObject = Record<string, unknown>;

export const CLAUDE_MCP_INVENTORY_SCHEMA_VERSION = 1 as const;

export type ClaudeMcpDefinition = JsonObject;

export type ClaudeMcpInventoryData = {
  schemaVersion: typeof CLAUDE_MCP_INVENTORY_SCHEMA_VERSION;
  servers: Record<string, ClaudeMcpDefinition>;
  updatedAt: number;
};

export type ClaudeMcpLiveConfig = {
  config: JsonObject;
  servers: Record<string, ClaudeMcpDefinition>;
};

class InvalidClaudeMcpInventoryError extends Error {}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && jsonValuesEqual(left[key], right[key]));
}

function parseDefinitions(value: unknown, label: string) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const entries: Array<[string, ClaudeMcpDefinition]> = [];
  for (const [name, definition] of Object.entries(value)) {
    if (!name.trim() || !isPlainObject(definition)) throw new Error(`Invalid MCP server definition: ${name || "unnamed"}`);
    entries.push([name, { ...definition }]);
  }
  return Object.fromEntries(entries);
}

export function parseClaudeMcpInventory(value: unknown): ClaudeMcpInventoryData {
  try {
    if (!isPlainObject(value) || value.schemaVersion !== CLAUDE_MCP_INVENTORY_SCHEMA_VERSION) {
      throw new Error("Unsupported or invalid Claude MCP inventory");
    }
    if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) {
      throw new Error("Invalid Claude MCP inventory timestamp");
    }
    return {
      schemaVersion: CLAUDE_MCP_INVENTORY_SCHEMA_VERSION,
      servers: parseDefinitions(value.servers, "Claude MCP inventory servers"),
      updatedAt: value.updatedAt
    };
  } catch (error) {
    if (error instanceof InvalidClaudeMcpInventoryError) throw error;
    throw new InvalidClaudeMcpInventoryError(error instanceof Error ? error.message : "Invalid Claude MCP inventory");
  }
}

export function readClaudeMcpLiveConfig(filePath: string): ClaudeMcpLiveConfig {
  if (!existsSync(filePath)) return { config: {}, servers: {} };
  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Claude configuration contains malformed JSON");
  }
  if (!isPlainObject(parsed)) throw new Error("Claude configuration must be a JSON object");
  return {
    config: parsed,
    servers: parsed.mcpServers === undefined ? {} : parseDefinitions(parsed.mcpServers, "Claude mcpServers")
  };
}

export function loadClaudeMcpInventory(filePath: string): ClaudeMcpInventoryData | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidClaudeMcpInventoryError("Claude MCP inventory contains malformed JSON");
  }
  return parseClaudeMcpInventory(parsed);
}

export function mergeClaudeMcpInventory(
  current: ClaudeMcpInventoryData | null,
  liveServers: Record<string, ClaudeMcpDefinition>,
  now = Date.now()
) {
  const servers = new Map(Object.entries(current?.servers ?? {}));
  let changed = current === null;
  for (const [name, definition] of Object.entries(liveServers)) {
    if (!jsonValuesEqual(servers.get(name), definition)) changed = true;
    servers.set(name, { ...definition });
  }
  if (!changed && current) return { changed: false, data: current };
  const mergedServers = Object.fromEntries(servers);
  return {
    changed: true,
    data: { schemaVersion: CLAUDE_MCP_INVENTORY_SCHEMA_VERSION, servers: mergedServers, updatedAt: now } as ClaudeMcpInventoryData
  };
}

export function saveClaudeMcpInventory(filePath: string, data: ClaudeMcpInventoryData) {
  const validated = parseClaudeMcpInventory(data);
  writeTextFileAtomic(filePath, `${JSON.stringify(validated, null, 2)}\n`);
}

export function synchronizeClaudeMcpInventory(
  filePath: string,
  liveServers: Record<string, ClaudeMcpDefinition>,
  now = Date.now()
) {
  let current: ClaudeMcpInventoryData | null;
  try {
    current = loadClaudeMcpInventory(filePath);
  } catch (error) {
    if (!(error instanceof InvalidClaudeMcpInventoryError)) throw error;
    quarantineInvalidJsonFile(filePath, now, "Claude MCP inventory");
    current = null;
  }
  const merged = mergeClaudeMcpInventory(current, liveServers, now);
  if (merged.changed) saveClaudeMcpInventory(filePath, merged.data);
  return merged.data;
}

export function buildSafeClaudeMcpResources(
  inventory: ClaudeMcpInventoryData,
  activeNames: Iterable<string>
): ClaudeProfileResource[] {
  const active = new Set(activeNames);
  return Object.keys(inventory.servers)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      id: `mcp:${name}`,
      kind: "mcp" as const,
      name,
      description: "Claude Code MCP server",
      enabled: active.has(name)
    }));
}

export type ClaudeMcpProfileResourcesSnapshot = {
  resources: ClaudeProfileResource[];
  status: ClaudeProfileMcpStatus;
};

export function synchronizeClaudeMcpProfileResources(
  claudeJsonPath: string,
  inventoryPath: string,
  fallbackResources: ClaudeProfileResource[]
): ClaudeMcpProfileResourcesSnapshot {
  let live: ClaudeMcpLiveConfig;
  try {
    live = readClaudeMcpLiveConfig(claudeJsonPath);
  } catch {
    try {
      const inventory = loadClaudeMcpInventory(inventoryPath);
      if (inventory) {
        const fallbackActiveNames = fallbackResources.filter(item => item.enabled).map(item => item.name);
        return {
          resources: buildSafeClaudeMcpResources(inventory, fallbackActiveNames),
          status: "config-unreadable"
        };
      }
    } catch {
      // The read snapshot remains available even if both MCP sources are unreadable.
    }
    return { resources: fallbackResources, status: "config-unreadable" };
  }

  try {
    const inventory = synchronizeClaudeMcpInventory(inventoryPath, live.servers);
    return {
      resources: buildSafeClaudeMcpResources(inventory, Object.keys(live.servers)),
      status: "ready"
    };
  } catch {
    const liveOnly = mergeClaudeMcpInventory(null, live.servers).data;
    return {
      resources: buildSafeClaudeMcpResources(liveOnly, Object.keys(live.servers)),
      status: "inventory-unreadable"
    };
  }
}

import { existsSync, readFileSync } from "node:fs";
import type { ClaudeProfileOperationIssue, ClaudeProfileResource } from "../shared/claudeProfiles";
import {
  loadClaudeMcpInventory,
  mergeClaudeMcpInventory,
  readClaudeMcpLiveConfig,
  saveClaudeMcpInventory
} from "./claudeMcpInventory";
import { backupJsonFile, writeTextFileAtomic } from "./filePersistence";

type JsonObject = Record<string, unknown>;

export type ClaudeProfileRuntimePaths = {
  settingsPath: string;
  claudeJsonPath: string;
  mcpInventoryPath: string;
};

export type ClaudeProfileRuntimeResult =
  | { ok: true }
  | { ok: false; issues: ClaudeProfileOperationIssue[] };

function issue(code: string, message: string, resourceId?: string, target?: "settings" | "mcp"): ClaudeProfileOperationIssue {
  return { code, message, ...(resourceId ? { resourceId } : {}), ...(target ? { target } : {}) };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettings(settingsPath: string):
  | { ok: true; settings: JsonObject }
  | { ok: false; issues: ClaudeProfileOperationIssue[] } {
  if (!existsSync(settingsPath)) return { ok: true, settings: {} };
  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch {
    return { ok: false, issues: [issue("settings-read-failed", "Claude settings could not be read.", undefined, "settings")] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) throw new Error("not an object");
    return { ok: true, settings: parsed };
  } catch {
    return { ok: false, issues: [issue("invalid-settings", "Claude settings contain malformed or invalid JSON.", undefined, "settings")] };
  }
}

function setSettingsResourceEnabled(
  resource: ClaudeProfileResource,
  enabled: boolean,
  settingsPath: string
): ClaudeProfileRuntimeResult {
  const live = readSettings(settingsPath);
  if (!live.ok) return live;
  const settings = live.settings;
  const field = resource.kind === "skill" ? "skillOverrides" : "enabledPlugins";
  const current = settings[field];
  if (current !== undefined && !isPlainObject(current)) {
    return { ok: false, issues: [issue("invalid-settings", `Claude settings ${field} must be an object.`, resource.id, "settings")] };
  }

  const values = { ...((current as JsonObject | undefined) ?? {}) };
  if (resource.kind === "skill") {
    if (enabled) {
      if (values[resource.name] === "off") delete values[resource.name];
    } else {
      values[resource.name] = "off";
    }
  } else {
    values[resource.name] = enabled;
  }

  const nextSettings = { ...settings };
  if (Object.keys(values).length > 0 || Object.prototype.hasOwnProperty.call(settings, field)) nextSettings[field] = values;
  else delete nextSettings[field];

  try {
    backupJsonFile(settingsPath);
  } catch {
    return { ok: false, issues: [issue("settings-backup-failed", "Claude settings could not be backed up.", resource.id, "settings")] };
  }
  try {
    writeTextFileAtomic(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
  } catch {
    return { ok: false, issues: [issue("settings-write-failed", "Claude settings could not be replaced.", resource.id, "settings")] };
  }
  return { ok: true };
}

function setMcpServerEnabled(
  resource: ClaudeProfileResource,
  enabled: boolean,
  paths: ClaudeProfileRuntimePaths
): ClaudeProfileRuntimeResult {
  let live;
  try {
    live = readClaudeMcpLiveConfig(paths.claudeJsonPath);
  } catch {
    return { ok: false, issues: [issue("invalid-claude-config", "Claude MCP configuration could not be read safely.", resource.id, "mcp")] };
  }

  let inventory;
  try {
    inventory = loadClaudeMcpInventory(paths.mcpInventoryPath);
  } catch {
    return { ok: false, issues: [issue("invalid-mcp-inventory", "The preserved Claude MCP inventory is invalid.", resource.id, "mcp")] };
  }
  const merged = mergeClaudeMcpInventory(inventory, live.servers);
  const definition = merged.data.servers[resource.name];
  if (enabled && !definition) {
    return { ok: false, issues: [issue("missing-mcp-server", `Claude profile references missing MCP server ${resource.id}.`, resource.id, "mcp")] };
  }
  if (merged.changed) {
    try {
      saveClaudeMcpInventory(paths.mcpInventoryPath, merged.data);
    } catch {
      return { ok: false, issues: [issue("mcp-inventory-write-failed", "The Claude MCP inventory could not be updated.", resource.id, "mcp")] };
    }
  }

  const nextServers = { ...live.servers };
  if (enabled) nextServers[resource.name] = definition;
  else delete nextServers[resource.name];
  const nextConfig = { ...live.config, mcpServers: nextServers };

  try {
    backupJsonFile(paths.claudeJsonPath);
  } catch {
    return { ok: false, issues: [issue("mcp-backup-failed", "Claude MCP configuration could not be backed up.", resource.id, "mcp")] };
  }
  try {
    writeTextFileAtomic(paths.claudeJsonPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  } catch {
    return { ok: false, issues: [issue("mcp-write-failed", "Claude MCP configuration could not be replaced.", resource.id, "mcp")] };
  }
  return { ok: true };
}

export function setClaudeProfileResourceEnabled(
  resource: ClaudeProfileResource,
  enabled: boolean,
  paths: ClaudeProfileRuntimePaths
): ClaudeProfileRuntimeResult {
  return resource.kind === "mcp"
    ? setMcpServerEnabled(resource, enabled, paths)
    : setSettingsResourceEnabled(resource, enabled, paths.settingsPath);
}

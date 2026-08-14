/** Main-process-only coordinator for one all-or-nothing Unified Profile apply. */
import { existsSync, readFileSync, rmSync } from "node:fs";
import type {
  ClaudeProfileChanges,
  ClaudeProfileInventory,
  ClaudeProfilePreviewResult,
  ClaudeProfileResource,
  ClaudeProfileStoreData
} from "../shared/claudeProfiles";
import {
  buildSafeClaudeMcpResources,
  loadClaudeMcpInventory,
  mergeClaudeMcpInventory,
  readClaudeMcpLiveConfig,
  saveClaudeMcpInventory,
  type ClaudeMcpInventoryData
} from "./claudeMcpInventory";
import {
  previewClaudeProfileSettingsFile,
  type ClaudeProfileSettingsIssue,
  type ClaudeProfileSettingsPreview
} from "./claudeProfileSettings";
import { saveClaudeProfileStore } from "./claudeProfileStore";
import { backupJsonFile, writeFileAtomic, writeTextFileAtomic } from "./filePersistence";

type JsonObject = Record<string, unknown>;

export type ClaudeProfileCoordinatorIssueCode =
  | ClaudeProfileSettingsIssue["code"]
  | "invalid-claude-config"
  | "invalid-mcp-inventory"
  | "missing-mcp-server"
  | "mcp-inventory-write-failed"
  | "settings-backup-failed"
  | "mcp-backup-failed"
  | "settings-write-failed"
  | "mcp-write-failed"
  | "profile-pointer-write-failed"
  | "rollback-failed";

export type ClaudeProfileCoordinatorIssue = {
  code: ClaudeProfileCoordinatorIssueCode;
  message: string;
  resourceId?: string;
  target?: "settings" | "mcp";
};

export type ClaudeProfileCoordinatorPaths = {
  settingsPath: string;
  claudeJsonPath: string;
  profileStorePath: string;
  mcpInventoryPath: string;
};

export type ClaudeProfileCoordinatorInput = {
  profileId: string;
  store: ClaudeProfileStoreData;
  inventory: ClaudeProfileInventory;
  paths: ClaudeProfileCoordinatorPaths;
};

type SuccessfulSettingsPreview = Extract<ClaudeProfileSettingsPreview, { ok: true }>;

type PreparedClaudeProfileApply =
  | {
      ok: true;
      profileId: string;
      settings: SuccessfulSettingsPreview;
      nextClaudeConfig: JsonObject;
      mcpInventory: ClaudeMcpInventoryData;
      mcpInventoryChanged: boolean;
      inventory: ClaudeProfileInventory;
    }
  | { ok: false; issues: ClaudeProfileCoordinatorIssue[] };

export type ClaudeProfileCoordinatorResult =
  | {
      ok: true;
      profileId: string;
      settingsBackupPath: string | null;
      mcpBackupPath: string | null;
    }
  | {
      ok: false;
      issues: ClaudeProfileCoordinatorIssue[];
      settingsBackupPath?: string | null;
      mcpBackupPath?: string | null;
    };

function issue(
  code: ClaudeProfileCoordinatorIssueCode,
  message: string,
  options: Pick<ClaudeProfileCoordinatorIssue, "resourceId" | "target"> = {}
): ClaudeProfileCoordinatorIssue {
  return { code, message, ...options };
}

function prepareClaudeProfileApply(input: ClaudeProfileCoordinatorInput): PreparedClaudeProfileApply {
  let liveMcp;
  try {
    liveMcp = readClaudeMcpLiveConfig(input.paths.claudeJsonPath);
  } catch {
    return { ok: false, issues: [issue("invalid-claude-config", "Claude MCP configuration could not be read safely.")] };
  }

  let currentMcpInventory;
  try {
    currentMcpInventory = loadClaudeMcpInventory(input.paths.mcpInventoryPath);
  } catch {
    return { ok: false, issues: [issue("invalid-mcp-inventory", "The preserved Claude MCP inventory is invalid.")] };
  }
  const mergedMcp = mergeClaudeMcpInventory(currentMcpInventory, liveMcp.servers);
  const safeMcpResources = buildSafeClaudeMcpResources(mergedMcp.data, Object.keys(liveMcp.servers));
  const inventory = { ...input.inventory, mcpServers: safeMcpResources };

  const settings = previewClaudeProfileSettingsFile({
    profileId: input.profileId,
    store: input.store,
    inventory,
    settingsPath: input.paths.settingsPath
  });
  const issues: ClaudeProfileCoordinatorIssue[] = settings.ok ? [] : [...settings.issues];

  const profile = input.store.profiles.find(item => item.id === input.profileId);
  const definitions = new Map(
    Object.entries(mergedMcp.data.servers).map(([name, definition]) => [`mcp:${name}`, { name, definition }])
  );
  const selectedServers: Array<[string, JsonObject]> = [];
  if (profile) {
    for (const resourceId of profile.mcpServers) {
      const server = definitions.get(resourceId);
      if (!server) {
        issues.push(issue(
          "missing-mcp-server",
          `Claude profile references missing MCP server ${resourceId}.`,
          { resourceId }
        ));
      } else {
        selectedServers.push([server.name, server.definition]);
      }
    }
  }

  if (!settings.ok || !profile || issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    profileId: profile.id,
    settings,
    nextClaudeConfig: { ...liveMcp.config, mcpServers: Object.fromEntries(selectedServers) },
    mcpInventory: mergedMcp.data,
    mcpInventoryChanged: mergedMcp.changed,
    inventory
  };
}

function profileChanges(selectedIds: string[], resources: ClaudeProfileResource[]): ClaudeProfileChanges {
  const selected = new Set(selectedIds);
  return {
    enable: resources.filter(resource => selected.has(resource.id) && !resource.enabled).map(resource => resource.id),
    disable: resources.filter(resource => !selected.has(resource.id) && resource.enabled).map(resource => resource.id)
  };
}

export function previewClaudeProfileApply(input: ClaudeProfileCoordinatorInput): ClaudeProfilePreviewResult {
  const prepared = prepareClaudeProfileApply(input);
  if (!prepared.ok) return prepared;
  const profile = input.store.profiles.find(item => item.id === prepared.profileId)!;
  return {
    ok: true,
    profileId: prepared.profileId,
    changes: {
      skills: profileChanges(profile.skills, prepared.inventory.skills),
      plugins: profileChanges(profile.plugins, prepared.inventory.plugins),
      mcpServers: profileChanges(profile.mcpServers, prepared.inventory.mcpServers)
    }
  };
}

type FileBackup = { existed: boolean; backupPath: string | null };

function createBackup(filePath: string): FileBackup {
  const existed = existsSync(filePath);
  const backupPath = backupJsonFile(filePath);
  if (existed && backupPath === null) throw new Error("Backup was not created");
  return { existed, backupPath };
}

function restoreBackup(filePath: string, backup: FileBackup) {
  if (backup.existed) {
    if (!backup.backupPath) throw new Error("Backup is unavailable");
    writeFileAtomic(filePath, readFileSync(backup.backupPath));
  } else {
    rmSync(filePath, { force: true });
  }
}

function rollbackCompletedWrites(
  paths: ClaudeProfileCoordinatorPaths,
  settingsBackup: FileBackup,
  mcpBackup: FileBackup,
  settingsWritten: boolean,
  mcpWritten: boolean
) {
  const issues: ClaudeProfileCoordinatorIssue[] = [];
  if (settingsWritten) {
    try {
      restoreBackup(paths.settingsPath, settingsBackup);
    } catch {
      issues.push(issue("rollback-failed", "Claude settings rollback failed.", { target: "settings" }));
    }
  }
  if (mcpWritten) {
    try {
      restoreBackup(paths.claudeJsonPath, mcpBackup);
    } catch {
      issues.push(issue("rollback-failed", "Claude MCP configuration rollback failed.", { target: "mcp" }));
    }
  }
  return issues;
}

export function applyClaudeProfile(input: ClaudeProfileCoordinatorInput): ClaudeProfileCoordinatorResult {
  const preview = prepareClaudeProfileApply(input);
  if (!preview.ok) return preview;

  if (preview.mcpInventoryChanged) {
    // This preservation-only write intentionally sits outside the two-file
    // transaction. Keeping additive definitions after rollback prevents an
    // outgoing MCP definition from losing its only preserved copy.
    try {
      saveClaudeMcpInventory(input.paths.mcpInventoryPath, preview.mcpInventory);
    } catch {
      return { ok: false, issues: [issue("mcp-inventory-write-failed", "The Claude MCP inventory could not be updated.")] };
    }
  }

  let settingsBackup: FileBackup;
  try {
    settingsBackup = createBackup(input.paths.settingsPath);
  } catch {
    return { ok: false, issues: [issue("settings-backup-failed", "Claude settings could not be backed up.")] };
  }

  let mcpBackup: FileBackup;
  try {
    mcpBackup = createBackup(input.paths.claudeJsonPath);
  } catch {
    return {
      ok: false,
      issues: [issue("mcp-backup-failed", "Claude MCP configuration could not be backed up.")],
      settingsBackupPath: settingsBackup.backupPath
    };
  }

  let settingsWritten = false;
  let mcpWritten = false;
  try {
    writeTextFileAtomic(input.paths.settingsPath, `${JSON.stringify(preview.settings.nextSettings, null, 2)}\n`);
    settingsWritten = true;
  } catch {
    return {
      ok: false,
      issues: [issue("settings-write-failed", "Claude settings could not be replaced.")],
      settingsBackupPath: settingsBackup.backupPath,
      mcpBackupPath: mcpBackup.backupPath
    };
  }

  try {
    writeTextFileAtomic(input.paths.claudeJsonPath, `${JSON.stringify(preview.nextClaudeConfig, null, 2)}\n`);
    mcpWritten = true;
  } catch {
    return {
      ok: false,
      issues: [
        issue("mcp-write-failed", "Claude MCP configuration could not be replaced."),
        ...rollbackCompletedWrites(input.paths, settingsBackup, mcpBackup, settingsWritten, mcpWritten)
      ],
      settingsBackupPath: settingsBackup.backupPath,
      mcpBackupPath: mcpBackup.backupPath
    };
  }

  try {
    saveClaudeProfileStore(input.paths.profileStorePath, {
      ...input.store,
      appliedProfileId: input.profileId
    });
  } catch {
    return {
      ok: false,
      issues: [
        issue("profile-pointer-write-failed", "The applied Claude profile pointer could not be saved."),
        ...rollbackCompletedWrites(input.paths, settingsBackup, mcpBackup, settingsWritten, mcpWritten)
      ],
      settingsBackupPath: settingsBackup.backupPath,
      mcpBackupPath: mcpBackup.backupPath
    };
  }

  return {
    ok: true,
    profileId: input.profileId,
    settingsBackupPath: settingsBackup.backupPath,
    mcpBackupPath: mcpBackup.backupPath
  };
}

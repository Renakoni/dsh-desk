/**
 * Main-process-only Skills and Plugins leg of Unified Profiles.
 *
 * This module deliberately does not touch MCP configuration or the applied
 * profile pointer. The unified coordinator added later must preflight every
 * leg before calling this writer.
 */
import { existsSync, readFileSync } from "node:fs";
import type { ClaudeProfileInventory, ClaudeProfileStoreData } from "../shared/claudeProfiles";
import { backupJsonFile, writeTextFileAtomic } from "./filePersistence";

type JsonObject = Record<string, unknown>;

export type ClaudeProfileSettingsIssueCode =
  | "invalid-profile-reference"
  | "missing-skill"
  | "missing-plugin"
  | "invalid-settings"
  | "settings-read-failed"
  | "settings-backup-failed"
  | "settings-write-failed";

export type ClaudeProfileSettingsIssue = {
  code: ClaudeProfileSettingsIssueCode;
  message: string;
  resourceId?: string;
};

export type ClaudeProfileSettingsEngineInput = {
  profileId: string;
  store: ClaudeProfileStoreData;
  inventory: ClaudeProfileInventory;
};

export type ClaudeProfileSettingsFileInput = ClaudeProfileSettingsEngineInput & {
  settingsPath: string;
};

export type ClaudeProfileSettingsPreview =
  | {
      ok: true;
      profileId: string;
      nextSettings: JsonObject;
      nextSkillOverrides: JsonObject;
      nextEnabledPlugins: JsonObject;
    }
  | { ok: false; issues: ClaudeProfileSettingsIssue[] };

export type ClaudeProfileSettingsApplyResult =
  | { ok: true; profileId: string; settingsPath: string; backupPath: string | null }
  | { ok: false; issues: ClaudeProfileSettingsIssue[]; backupPath?: string | null };

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: ClaudeProfileSettingsIssueCode, message: string, resourceId?: string): ClaudeProfileSettingsIssue {
  return { code, message, ...(resourceId ? { resourceId } : {}) };
}

export function previewClaudeProfileSettings(
  input: ClaudeProfileSettingsEngineInput & { liveSettings: unknown }
): ClaudeProfileSettingsPreview {
  const issues: ClaudeProfileSettingsIssue[] = [];
  const settings = isPlainObject(input.liveSettings) ? input.liveSettings : null;
  if (!settings) {
    issues.push(issue("invalid-settings", "Claude settings must be a JSON object."));
  } else {
    if (settings.skillOverrides !== undefined && !isPlainObject(settings.skillOverrides)) {
      issues.push(issue("invalid-settings", "Claude settings skillOverrides must be an object."));
    }
    if (settings.enabledPlugins !== undefined && !isPlainObject(settings.enabledPlugins)) {
      issues.push(issue("invalid-settings", "Claude settings enabledPlugins must be an object."));
    }
  }

  const profile = input.store.profiles.find(item => item.id === input.profileId);
  if (!profile) {
    issues.push(issue("invalid-profile-reference", `Claude profile ${input.profileId} does not exist.`));
  }

  if (profile) {
    const knownSkills = new Set(input.inventory.skills.map(item => item.id));
    const knownPlugins = new Set(input.inventory.plugins.map(item => item.id));
    for (const resourceId of profile.skills) {
      if (!knownSkills.has(resourceId)) {
        issues.push(issue("missing-skill", `Claude profile references missing Skill ${resourceId}.`, resourceId));
      }
    }
    for (const resourceId of profile.plugins) {
      if (!knownPlugins.has(resourceId)) {
        issues.push(issue("missing-plugin", `Claude profile references missing Plugin ${resourceId}.`, resourceId));
      }
    }
  }

  if (!settings || !profile || issues.length > 0) return { ok: false, issues };

  const nextSkillOverrides = {
    ...((settings.skillOverrides as JsonObject | undefined) ?? {})
  };
  const selectedSkills = new Set(profile.skills);
  for (const resource of input.inventory.skills) {
    if (selectedSkills.has(resource.id)) {
      if (nextSkillOverrides[resource.name] === "off") delete nextSkillOverrides[resource.name];
    } else {
      nextSkillOverrides[resource.name] = "off";
    }
  }

  const nextEnabledPlugins = {
    ...((settings.enabledPlugins as JsonObject | undefined) ?? {})
  };
  const selectedPlugins = new Set(profile.plugins);
  for (const resource of input.inventory.plugins) {
    nextEnabledPlugins[resource.name] = selectedPlugins.has(resource.id);
  }

  const nextSettings = { ...settings };
  const hadSkillOverrides = Object.prototype.hasOwnProperty.call(settings, "skillOverrides");
  if (hadSkillOverrides || Object.keys(nextSkillOverrides).length > 0) nextSettings.skillOverrides = nextSkillOverrides;
  else delete nextSettings.skillOverrides;

  const hadEnabledPlugins = Object.prototype.hasOwnProperty.call(settings, "enabledPlugins");
  if (hadEnabledPlugins || Object.keys(nextEnabledPlugins).length > 0) nextSettings.enabledPlugins = nextEnabledPlugins;
  else delete nextSettings.enabledPlugins;

  return {
    ok: true,
    profileId: profile.id,
    nextSettings,
    nextSkillOverrides,
    nextEnabledPlugins
  };
}

function readClaudeSettingsFile(settingsPath: string):
  | { ok: true; liveSettings: unknown }
  | { ok: false; issues: ClaudeProfileSettingsIssue[] } {
  let liveSettings: unknown = {};
  if (existsSync(settingsPath)) {
    let raw: string;
    try {
      raw = readFileSync(settingsPath, "utf8");
    } catch {
      return { ok: false, issues: [issue("settings-read-failed", "Claude settings could not be read.")] };
    }
    try {
      liveSettings = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, issues: [issue("invalid-settings", "Claude settings contain malformed JSON.")] };
    }
  }
  return { ok: true, liveSettings };
}

export function previewClaudeProfileSettingsFile(input: ClaudeProfileSettingsFileInput): ClaudeProfileSettingsPreview {
  const live = readClaudeSettingsFile(input.settingsPath);
  if (!live.ok) return live;
  return previewClaudeProfileSettings({ ...input, liveSettings: live.liveSettings });
}

export function applyClaudeProfileSettings(input: ClaudeProfileSettingsFileInput): ClaudeProfileSettingsApplyResult {
  const preview = previewClaudeProfileSettingsFile(input);
  if (!preview.ok) return preview;

  let backupPath: string | null;
  try {
    backupPath = backupJsonFile(input.settingsPath);
  } catch {
    return { ok: false, issues: [issue("settings-backup-failed", "Claude settings could not be backed up.")] };
  }

  try {
    writeTextFileAtomic(input.settingsPath, `${JSON.stringify(preview.nextSettings, null, 2)}\n`);
  } catch {
    return {
      ok: false,
      issues: [issue("settings-write-failed", "Claude settings could not be replaced.")],
      backupPath
    };
  }

  return {
    ok: true,
    profileId: input.profileId,
    settingsPath: input.settingsPath,
    backupPath
  };
}

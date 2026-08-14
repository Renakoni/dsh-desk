import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyClaudeProfileSettings,
  previewClaudeProfileSettings,
  previewClaudeProfileSettingsFile
} from "../src/main/claudeProfileSettings";
import { CLAUDE_PROFILE_SCHEMA_VERSION, type ClaudeProfileInventory, type ClaudeProfileStoreData } from "../src/shared/claudeProfiles";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempSettingsPath() {
  const root = mkdtempSync(join(tmpdir(), "chara-profile-settings-"));
  tempRoots.push(root);
  return join(root, ".claude", "settings.json");
}

function inventory(): ClaudeProfileInventory {
  return {
    skills: [
      { id: "skill:alpha", kind: "skill", name: "alpha", enabled: false },
      { id: "skill:beta", kind: "skill", name: "beta", enabled: true }
    ],
    plugins: [
      { id: "plugin:alpha@market", kind: "plugin", name: "alpha@market", enabled: false },
      { id: "plugin:beta@market", kind: "plugin", name: "beta@market", enabled: true }
    ],
    mcpServers: [],
    scannedAt: 123
  };
}

function store(overrides: Partial<ClaudeProfileStoreData["profiles"][number]> = {}): ClaudeProfileStoreData {
  return {
    schemaVersion: CLAUDE_PROFILE_SCHEMA_VERSION,
    appliedProfileId: "default",
    profiles: [
      {
        id: "default",
        name: "Default",
        skills: [],
        plugins: [],
        mcpServers: [],
        isProtected: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: "all",
        name: "All",
        skills: ["skill:alpha", "skill:beta"],
        plugins: ["plugin:alpha@market", "plugin:beta@market"],
        mcpServers: [],
        isProtected: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: "focused",
        name: "Focused",
        skills: ["skill:alpha"],
        plugins: ["plugin:alpha@market"],
        mcpServers: [],
        isProtected: false,
        createdAt: 2,
        updatedAt: 2,
        ...overrides
      }
    ]
  };
}

describe("Claude profile settings preview", () => {
  it("owns recognized Skills and user Plugins while preserving every unrelated setting", () => {
    const liveSettings = {
      model: "sonnet",
      theme: "dark",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "third-party" }] }] },
      env: { ANTHROPIC_BASE_URL: "https://provider.example" },
      skillOverrides: { alpha: "off", external: "ask" },
      enabledPlugins: { "alpha@market": false, "project@market": true }
    };
    const original = JSON.stringify(liveSettings);

    const result = previewClaudeProfileSettings({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      liveSettings
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextSkillOverrides).toEqual({ external: "ask", beta: "off" });
    expect(result.nextEnabledPlugins).toEqual({
      "alpha@market": true,
      "beta@market": false,
      "project@market": true
    });
    expect(result.nextSettings).toEqual({
      ...liveSettings,
      skillOverrides: { external: "ask", beta: "off" },
      enabledPlugins: {
        "alpha@market": true,
        "beta@market": false,
        "project@market": true
      }
    });
    expect(JSON.stringify(liveSettings)).toBe(original);
  });

  it("removes selected recognized Skill overrides without creating an empty map", () => {
    const result = previewClaudeProfileSettings({
      profileId: "focused",
      store: store({ skills: ["skill:alpha", "skill:beta"], plugins: [] }),
      inventory: { ...inventory(), plugins: [] },
      liveSettings: {}
    });

    expect(result).toEqual({
      ok: true,
      profileId: "focused",
      nextSettings: {},
      nextSkillOverrides: {},
      nextEnabledPlugins: {}
    });
  });

  it("preserves non-off visibility states for selected Skills", () => {
    const liveSettings = { skillOverrides: { alpha: "name" } };
    const result = previewClaudeProfileSettings({
      profileId: "focused",
      store: store({ skills: ["skill:alpha", "skill:beta"], plugins: [] }),
      inventory: { ...inventory(), plugins: [] },
      liveSettings
    });

    expect(result).toEqual({
      ok: true,
      profileId: "focused",
      nextSettings: liveSettings,
      nextSkillOverrides: { alpha: "name" },
      nextEnabledPlugins: {}
    });
  });

  it("reports an invalid profile reference", () => {
    const result = previewClaudeProfileSettings({
      profileId: "missing",
      store: store(),
      inventory: inventory(),
      liveSettings: {}
    });

    expect(result).toEqual({
      ok: false,
      issues: [{
        code: "invalid-profile-reference",
        message: "Claude profile missing does not exist."
      }]
    });
  });

  it("reports every missing Skill and Plugin before writing", () => {
    const result = previewClaudeProfileSettings({
      profileId: "focused",
      store: store({ skills: ["skill:missing"], plugins: ["plugin:missing@market"] }),
      inventory: inventory(),
      liveSettings: {}
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(item => [item.code, item.resourceId])).toEqual([
      ["missing-skill", "skill:missing"],
      ["missing-plugin", "plugin:missing@market"]
    ]);
  });

  it("rejects malformed managed settings maps", () => {
    const result = previewClaudeProfileSettings({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      liveSettings: { skillOverrides: [], enabledPlugins: "enabled" }
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(item => item.code)).toEqual(["invalid-settings", "invalid-settings"]);
  });

  it("previews the live settings file without writing or backing it up", () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(dirname(settingsPath), { recursive: true });
    const original = '{"model":"sonnet","skillOverrides":{"alpha":"off"}}\n';
    writeFileSync(settingsPath, original, "utf8");

    const result = previewClaudeProfileSettingsFile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      settingsPath
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    expect(readdirSync(dirname(settingsPath)).filter(name => name.includes(".clawd-backup-"))).toEqual([]);
  });
});

describe("Claude profile settings apply", () => {
  it("backs up the exact original bytes and atomically replaces only managed fields", () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(dirname(settingsPath), { recursive: true });
    const original = '{\n  "model": "opus",\n  "hooks": { "Stop": [] },\n  "skillOverrides": { "external": "ask" },\n  "enabledPlugins": { "project@market": true }\n}\n';
    writeFileSync(settingsPath, original, "utf8");

    const result = applyClaudeProfileSettings({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      settingsPath
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backupPath).not.toBeNull();
    expect(readFileSync(result.backupPath!, "utf8")).toBe(original);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      model: "opus",
      hooks: { Stop: [] },
      skillOverrides: { external: "ask", beta: "off" },
      enabledPlugins: {
        "project@market": true,
        "alpha@market": true,
        "beta@market": false
      }
    });
    expect(readdirSync(dirname(settingsPath)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not write or back up when preflight fails", () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(dirname(settingsPath), { recursive: true });
    const original = '{"model":"sonnet"}\n';
    writeFileSync(settingsPath, original, "utf8");

    const result = applyClaudeProfileSettings({
      profileId: "focused",
      store: store({ skills: ["skill:missing"] }),
      inventory: inventory(),
      settingsPath
    });

    expect(result.ok).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    expect(readdirSync(dirname(settingsPath)).filter(name => name.includes(".clawd-backup-"))).toEqual([]);
  });

  it("rejects malformed JSON without modifying the live file", () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(dirname(settingsPath), { recursive: true });
    const malformed = '{"model":';
    writeFileSync(settingsPath, malformed, "utf8");

    const result = applyClaudeProfileSettings({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      settingsPath
    });

    expect(result).toEqual({
      ok: false,
      issues: [{ code: "invalid-settings", message: "Claude settings contain malformed JSON." }]
    });
    expect(readFileSync(settingsPath, "utf8")).toBe(malformed);
    expect(readdirSync(dirname(settingsPath)).filter(name => name.includes(".clawd-backup-"))).toEqual([]);
  });

  it("creates a missing settings file without reporting a backup", () => {
    const settingsPath = tempSettingsPath();
    const result = applyClaudeProfileSettings({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      settingsPath
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backupPath).toBeNull();
    expect(statSync(settingsPath).isFile()).toBe(true);
  });

  it("reports read failures without moving the settings path", () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(settingsPath, { recursive: true });

    const result = applyClaudeProfileSettings({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      settingsPath
    });

    expect(result).toEqual({
      ok: false,
      issues: [{ code: "settings-read-failed", message: "Claude settings could not be read." }]
    });
    expect(statSync(settingsPath).isDirectory()).toBe(true);
  });
});

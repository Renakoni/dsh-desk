import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadClaudeMcpInventory, saveClaudeMcpInventory } from "../src/main/claudeMcpInventory";
import { applyClaudeProfile, previewClaudeProfileApply, type ClaudeProfileCoordinatorPaths } from "../src/main/claudeProfileCoordinator";
import { parseClaudeProfileStore, saveClaudeProfileStore } from "../src/main/claudeProfileStore";
import { CLAUDE_PROFILE_SCHEMA_VERSION, type ClaudeProfileInventory, type ClaudeProfileStoreData } from "../src/shared/claudeProfiles";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempPaths(): ClaudeProfileCoordinatorPaths {
  const root = mkdtempSync(join(tmpdir(), "chara-profile-coordinator-"));
  tempRoots.push(root);
  return {
    settingsPath: join(root, ".claude", "settings.json"),
    claudeJsonPath: join(root, ".claude.json"),
    profileStorePath: join(root, "user-data", "claude-profiles.json"),
    mcpInventoryPath: join(root, "user-data", "claude-mcp-inventory.json")
  };
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

function store(mcpServers = ["mcp:inactive"]): ClaudeProfileStoreData {
  return {
    schemaVersion: CLAUDE_PROFILE_SCHEMA_VERSION,
    appliedProfileId: "default",
    profiles: [
      {
        id: "default",
        name: "Default",
        skills: ["skill:beta"],
        plugins: ["plugin:beta@market"],
        mcpServers: ["mcp:active"],
        isProtected: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: "all",
        name: "All",
        skills: ["skill:alpha", "skill:beta"],
        plugins: ["plugin:alpha@market", "plugin:beta@market"],
        mcpServers: ["mcp:active", "mcp:inactive"],
        isProtected: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: "focused",
        name: "Focused",
        skills: ["skill:alpha"],
        plugins: ["plugin:alpha@market"],
        mcpServers,
        isProtected: false,
        createdAt: 2,
        updatedAt: 2
      }
    ]
  };
}

function seedFiles(paths: ClaudeProfileCoordinatorPaths, profileStore = store()) {
  mkdirSync(dirname(paths.settingsPath), { recursive: true });
  const settingsText = '{\n  "model": "sonnet",\n  "hooks": { "Stop": [] },\n  "skillOverrides": { "alpha": "off", "external": "name" },\n  "enabledPlugins": { "project@market": true }\n}\n';
  const claudeText = `${JSON.stringify({
    theme: "dark",
    mcpServers: {
      active: { command: "active-server", env: { TOKEN: "active-secret" } }
    },
    projects: {
      "C:/project": { mcpServers: { project: { command: "project-server", env: { TOKEN: "project-secret" } } } }
    }
  }, null, 2)}\n`;
  writeFileSync(paths.settingsPath, settingsText, "utf8");
  writeFileSync(paths.claudeJsonPath, claudeText, "utf8");
  saveClaudeProfileStore(paths.profileStorePath, profileStore);
  saveClaudeMcpInventory(paths.mcpInventoryPath, {
    schemaVersion: 1,
    servers: {
      inactive: { url: "https://inactive.example.test", headers: { Authorization: "inactive-secret" } }
    },
    updatedAt: 1
  });
  return { settingsText, claudeText };
}

describe("Unified Claude profile coordinator", () => {
  it("applies Skills, Plugins, and only the top-level MCP map before updating the pointer", () => {
    const paths = tempPaths();
    const original = seedFiles(paths);

    const result = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(result.settingsBackupPath!, "utf8")).toBe(original.settingsText);
    expect(readFileSync(result.mcpBackupPath!, "utf8")).toBe(original.claudeText);
    expect(JSON.parse(readFileSync(paths.settingsPath, "utf8"))).toEqual({
      model: "sonnet",
      hooks: { Stop: [] },
      skillOverrides: { external: "name", beta: "off" },
      enabledPlugins: {
        "project@market": true,
        "alpha@market": true,
        "beta@market": false
      }
    });
    expect(JSON.parse(readFileSync(paths.claudeJsonPath, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: {
        inactive: { url: "https://inactive.example.test", headers: { Authorization: "inactive-secret" } }
      },
      projects: {
        "C:/project": { mcpServers: { project: { command: "project-server", env: { TOKEN: "project-secret" } } } }
      }
    });
    expect(loadClaudeMcpInventory(paths.mcpInventoryPath)?.servers).toEqual({
      inactive: { url: "https://inactive.example.test", headers: { Authorization: "inactive-secret" } },
      active: { command: "active-server", env: { TOKEN: "active-secret" } }
    });
    expect(parseClaudeProfileStore(JSON.parse(readFileSync(paths.profileStorePath, "utf8"))).appliedProfileId).toBe("focused");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("blocks a missing MCP definition without persisting the outgoing inventory", () => {
    const paths = tempPaths();
    mkdirSync(dirname(paths.settingsPath), { recursive: true });
    writeFileSync(paths.settingsPath, "{}\n", "utf8");
    writeFileSync(paths.claudeJsonPath, JSON.stringify({
      mcpServers: { active: { command: "server", env: { TOKEN: "secret-value" } } }
    }), "utf8");

    const result = previewClaudeProfileApply({
      profileId: "focused",
      store: store(["mcp:missing"]),
      inventory: inventory(),
      paths
    });

    expect(result).toEqual({
      ok: false,
      issues: [{
        code: "missing-mcp-server",
        message: "Claude profile references missing MCP server mcp:missing.",
        resourceId: "mcp:missing"
      }]
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(existsSync(paths.mcpInventoryPath)).toBe(false);
  });

  it("exports only resource deltas from a successful preview", () => {
    const paths = tempPaths();
    seedFiles(paths);
    const settings = JSON.parse(readFileSync(paths.settingsPath, "utf8")) as Record<string, unknown>;
    settings.env = { ANTHROPIC_AUTH_TOKEN: "settings-secret" };
    writeFileSync(paths.settingsPath, JSON.stringify(settings), "utf8");

    const result = previewClaudeProfileApply({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(result).toEqual({
      ok: true,
      profileId: "focused",
      changes: {
        skills: { enable: ["skill:alpha"], disable: ["skill:beta"] },
        plugins: { enable: ["plugin:alpha@market"], disable: ["plugin:beta@market"] },
        mcpServers: { enable: ["mcp:inactive"], disable: ["mcp:active"] }
      }
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("settings-secret");
    expect(serialized).not.toContain("active-secret");
    expect(serialized).not.toContain("inactive-secret");
    expect(serialized).not.toContain("project-secret");
    expect(serialized).not.toContain("inactive.example.test");
  });

  it("re-reads live files on apply and preserves changes made after preview", () => {
    const paths = tempPaths();
    seedFiles(paths);

    const preview = previewClaudeProfileApply({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });
    expect(preview.ok).toBe(true);

    const settings = JSON.parse(readFileSync(paths.settingsPath, "utf8")) as Record<string, unknown>;
    settings.futureSetting = { nested: ["preserve-me"] };
    writeFileSync(paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    const claude = JSON.parse(readFileSync(paths.claudeJsonPath, "utf8")) as Record<string, unknown>;
    claude.futureClaudeField = { enabled: true };
    writeFileSync(paths.claudeJsonPath, `${JSON.stringify(claude, null, 2)}\n`, "utf8");

    const result = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(paths.settingsPath, "utf8"))).toMatchObject({
      futureSetting: { nested: ["preserve-me"] }
    });
    expect(JSON.parse(readFileSync(paths.claudeJsonPath, "utf8"))).toMatchObject({
      futureClaudeField: { enabled: true },
      projects: {
        "C:/project": { mcpServers: { project: { command: "project-server", env: { TOKEN: "project-secret" } } } }
      }
    });
  });

  it("rejects malformed Claude JSON before creating backups or inventory", () => {
    const paths = tempPaths();
    mkdirSync(dirname(paths.settingsPath), { recursive: true });
    const settingsText = '{"model":"sonnet"}\n';
    const malformed = '{"mcpServers":';
    writeFileSync(paths.settingsPath, settingsText, "utf8");
    writeFileSync(paths.claudeJsonPath, malformed, "utf8");

    const result = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(result).toEqual({
      ok: false,
      issues: [{ code: "invalid-claude-config", message: "Claude MCP configuration could not be read safely." }]
    });
    expect(readFileSync(paths.settingsPath, "utf8")).toBe(settingsText);
    expect(readFileSync(paths.claudeJsonPath, "utf8")).toBe(malformed);
    expect(existsSync(paths.mcpInventoryPath)).toBe(false);
    expect(readdirSync(dirname(paths.settingsPath)).some(name => name.includes(".clawd-backup-"))).toBe(false);
  });

  it("rolls settings back when the MCP target write fails", () => {
    const paths = tempPaths();
    const original = seedFiles(paths);
    const blocker = join(dirname(paths.claudeJsonPath), "blocked-parent");
    writeFileSync(blocker, "not a directory", "utf8");
    paths.claudeJsonPath = join(blocker, ".claude.json");

    const result = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(item => item.code)).toEqual(["mcp-write-failed"]);
    expect(readFileSync(paths.settingsPath, "utf8")).toBe(original.settingsText);
    expect(parseClaudeProfileStore(JSON.parse(readFileSync(paths.profileStorePath, "utf8"))).appliedProfileId).toBe("default");
  });

  it("can retry successfully after a target write failure", () => {
    const paths = tempPaths();
    const original = seedFiles(paths);
    const claudeJsonPath = paths.claudeJsonPath;
    const blocker = join(dirname(claudeJsonPath), "blocked-parent");
    writeFileSync(blocker, "not a directory", "utf8");
    paths.claudeJsonPath = join(blocker, ".claude.json");

    const failed = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });
    expect(failed.ok).toBe(false);
    expect(readFileSync(paths.settingsPath, "utf8")).toBe(original.settingsText);

    paths.claudeJsonPath = claudeJsonPath;
    const retried = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(retried.ok).toBe(true);
    expect(parseClaudeProfileStore(JSON.parse(readFileSync(paths.profileStorePath, "utf8"))).appliedProfileId).toBe("focused");
    expect(Object.keys((JSON.parse(readFileSync(paths.claudeJsonPath, "utf8")) as { mcpServers: object }).mcpServers)).toEqual(["inactive"]);
  });

  it("converges after restart from a one-target partial apply", () => {
    const paths = tempPaths();
    const original = seedFiles(paths);
    const first = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });
    expect(first.ok).toBe(true);
    const focusedSettings = JSON.parse(readFileSync(paths.settingsPath, "utf8"));
    const focusedClaude = JSON.parse(readFileSync(paths.claudeJsonPath, "utf8"));

    // Simulate process exit after settings replacement but before the MCP and
    // pointer writes completed.
    writeFileSync(paths.claudeJsonPath, original.claudeText, "utf8");
    saveClaudeProfileStore(paths.profileStorePath, store());

    const recovered = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(recovered.ok).toBe(true);
    expect(JSON.parse(readFileSync(paths.settingsPath, "utf8"))).toEqual(focusedSettings);
    expect(JSON.parse(readFileSync(paths.claudeJsonPath, "utf8"))).toEqual(focusedClaude);
    expect(parseClaudeProfileStore(JSON.parse(readFileSync(paths.profileStorePath, "utf8"))).appliedProfileId).toBe("focused");
  });

  it("rolls both Claude files back when the applied pointer cannot be saved", () => {
    const paths = tempPaths();
    const original = seedFiles(paths);
    const blocker = join(dirname(paths.profileStorePath), "blocked-parent");
    writeFileSync(blocker, "not a directory", "utf8");
    paths.profileStorePath = join(blocker, "claude-profiles.json");

    const result = applyClaudeProfile({
      profileId: "focused",
      store: store(),
      inventory: inventory(),
      paths
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(item => item.code)).toEqual(["profile-pointer-write-failed"]);
    expect(readFileSync(paths.settingsPath, "utf8")).toBe(original.settingsText);
    expect(readFileSync(paths.claudeJsonPath, "utf8")).toBe(original.claudeText);
  });
});

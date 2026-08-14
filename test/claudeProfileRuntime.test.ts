import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadClaudeMcpInventory, saveClaudeMcpInventory } from "../src/main/claudeMcpInventory";
import { setClaudeProfileResourceEnabled, type ClaudeProfileRuntimePaths } from "../src/main/claudeProfileRuntime";
import type { ClaudeProfileResource } from "../src/shared/claudeProfiles";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function paths(): ClaudeProfileRuntimePaths {
  const root = mkdtempSync(join(tmpdir(), "chara-profile-runtime-"));
  tempRoots.push(root);
  return {
    settingsPath: join(root, ".claude", "settings.json"),
    claudeJsonPath: join(root, ".claude.json"),
    mcpInventoryPath: join(root, "user-data", "claude-mcp-inventory.json")
  };
}

function resource(kind: ClaudeProfileResource["kind"], name: string, enabled: boolean): ClaudeProfileResource {
  return { id: `${kind}:${name}`, kind, name, enabled };
}

describe("temporary Claude profile resource state", () => {
  it("disables and restores one Skill without changing unrelated settings", () => {
    const target = paths();
    mkdirSync(dirname(target.settingsPath), { recursive: true });
    writeFileSync(target.settingsPath, `${JSON.stringify({
      model: "sonnet",
      skillOverrides: { alpha: "name", external: "ask" },
      enabledPlugins: { "review@market": true }
    }, null, 2)}\n`, "utf8");
    const alpha = resource("skill", "alpha", true);

    expect(setClaudeProfileResourceEnabled(alpha, false, target)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(target.settingsPath, "utf8"))).toEqual({
      model: "sonnet",
      skillOverrides: { alpha: "off", external: "ask" },
      enabledPlugins: { "review@market": true }
    });

    expect(setClaudeProfileResourceEnabled({ ...alpha, enabled: false }, true, target)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(target.settingsPath, "utf8"))).toEqual({
      model: "sonnet",
      skillOverrides: { external: "ask" },
      enabledPlugins: { "review@market": true }
    });
    expect(readdirSync(dirname(target.settingsPath)).some(name => name.includes(".clawd-backup-"))).toBe(true);
  });

  it("changes only the selected user Plugin flag", () => {
    const target = paths();
    mkdirSync(dirname(target.settingsPath), { recursive: true });
    writeFileSync(target.settingsPath, '{"enabledPlugins":{"review@market":true,"project@market":true}}\n', "utf8");

    const result = setClaudeProfileResourceEnabled(resource("plugin", "review@market", true), false, target);

    expect(result).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(target.settingsPath, "utf8"))).toEqual({
      enabledPlugins: { "review@market": false, "project@market": true }
    });
  });

  it("preserves an MCP definition while disabled and restores it from inventory", () => {
    const target = paths();
    mkdirSync(dirname(target.mcpInventoryPath), { recursive: true });
    const activeDefinition = { command: "active-server", env: { TOKEN: "active-secret" } };
    const inactiveDefinition = { url: "https://inactive.example", headers: { Authorization: "inactive-secret" } };
    writeFileSync(target.claudeJsonPath, `${JSON.stringify({ theme: "dark", mcpServers: { active: activeDefinition } }, null, 2)}\n`, "utf8");
    saveClaudeMcpInventory(target.mcpInventoryPath, {
      schemaVersion: 1,
      servers: { inactive: inactiveDefinition },
      updatedAt: 1
    });

    expect(setClaudeProfileResourceEnabled(resource("mcp", "active", true), false, target)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(target.claudeJsonPath, "utf8"))).toEqual({ theme: "dark", mcpServers: {} });
    expect(loadClaudeMcpInventory(target.mcpInventoryPath)?.servers.active).toEqual(activeDefinition);

    expect(setClaudeProfileResourceEnabled(resource("mcp", "inactive", false), true, target)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(target.claudeJsonPath, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: { inactive: inactiveDefinition }
    });
  });

  it("does not replace malformed live settings", () => {
    const target = paths();
    mkdirSync(dirname(target.settingsPath), { recursive: true });
    const malformed = '{"skillOverrides":';
    writeFileSync(target.settingsPath, malformed, "utf8");

    const result = setClaudeProfileResourceEnabled(resource("skill", "alpha", true), false, target);

    expect(result).toMatchObject({ ok: false, issues: [{ code: "invalid-settings" }] });
    expect(readFileSync(target.settingsPath, "utf8")).toBe(malformed);
  });
});

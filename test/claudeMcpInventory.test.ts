import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSafeClaudeMcpResources,
  loadClaudeMcpInventory,
  readClaudeMcpLiveConfig,
  synchronizeClaudeMcpInventory,
  synchronizeClaudeMcpProfileResources
} from "../src/main/claudeMcpInventory";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempFile(name: string) {
  const root = mkdtempSync(join(tmpdir(), "chara-mcp-inventory-"));
  tempRoots.push(root);
  return join(root, name);
}

describe("Claude MCP inventory", () => {
  it("preserves outgoing definitions while exposing only safe identities", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    const first = synchronizeClaudeMcpInventory(inventoryPath, {
      filesystem: {
        command: "mcp-filesystem",
        env: { ACCESS_TOKEN: "top-secret" },
        headers: { Authorization: "Bearer secret" }
      }
    }, 100);

    expect(first.servers.filesystem).toEqual({
      command: "mcp-filesystem",
      env: { ACCESS_TOKEN: "top-secret" },
      headers: { Authorization: "Bearer secret" }
    });
    expect(readFileSync(inventoryPath, "utf8")).toContain("top-secret");

    const second = synchronizeClaudeMcpInventory(inventoryPath, {
      browser: { url: "https://mcp.example.test", headers: { "X-Token": "new-secret" } }
    }, 200);
    expect(Object.keys(second.servers).sort()).toEqual(["browser", "filesystem"]);

    const safe = buildSafeClaudeMcpResources(second, ["browser"]);
    expect(safe).toEqual([
      { id: "mcp:browser", kind: "mcp", name: "browser", description: "Claude Code MCP server", enabled: true },
      { id: "mcp:filesystem", kind: "mcp", name: "filesystem", description: "Claude Code MCP server", enabled: false }
    ]);
    expect(JSON.stringify(safe)).not.toContain("secret");
    expect(JSON.stringify(safe)).not.toContain("Authorization");
  });

  it("backfills a changed live definition before it becomes inactive", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    synchronizeClaudeMcpInventory(inventoryPath, {
      server: { url: "https://old.example.test", headers: { Authorization: "old" } }
    }, 100);

    const updated = synchronizeClaudeMcpInventory(inventoryPath, {
      server: { url: "https://new.example.test", headers: { Authorization: "new" } }
    }, 200);

    expect(updated.servers.server).toEqual({
      url: "https://new.example.test",
      headers: { Authorization: "new" }
    });
    expect(updated.updatedAt).toBe(200);
  });

  it("does not rewrite an unchanged definition whose object keys were reordered", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    synchronizeClaudeMcpInventory(inventoryPath, {
      server: { command: "mcp-server", env: { TOKEN: "secret", MODE: "safe" } }
    }, 100);
    const original = readFileSync(inventoryPath, "utf8");

    const unchanged = synchronizeClaudeMcpInventory(inventoryPath, {
      server: { env: { MODE: "safe", TOKEN: "secret" }, command: "mcp-server" }
    }, 200);

    expect(unchanged.updatedAt).toBe(100);
    expect(readFileSync(inventoryPath, "utf8")).toBe(original);
  });

  it("reads only the top-level global MCP map", () => {
    const claudeJsonPath = tempFile(".claude.json");
    mkdirSync(dirname(claudeJsonPath), { recursive: true });
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { global: { command: "global-server" } },
      projects: {
        "C:/project": { mcpServers: { project: { command: "project-server" } } }
      }
    }), "utf8");

    const live = readClaudeMcpLiveConfig(claudeJsonPath);
    expect(live.servers).toEqual({ global: { command: "global-server" } });
    expect(live.config.projects).toEqual({
      "C:/project": { mcpServers: { project: { command: "project-server" } } }
    });
  });

  it("preserves an unsupported inventory before rebuilding it from live servers", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    const unsupported = '{"schemaVersion":2,"servers":{"old":{"command":"old"}},"updatedAt":1}\n';
    writeFileSync(inventoryPath, unsupported, "utf8");

    const recovered = synchronizeClaudeMcpInventory(inventoryPath, {
      filesystem: { command: "mcp-filesystem" }
    }, 300);
    const preserved = readdirSync(dirname(inventoryPath))
      .filter(name => name.startsWith("claude-mcp-inventory.invalid-") && name.endsWith(".json"));

    expect(recovered).toEqual({
      schemaVersion: 1,
      servers: { filesystem: { command: "mcp-filesystem" } },
      updatedAt: 300
    });
    expect(loadClaudeMcpInventory(inventoryPath)).toEqual(recovered);
    expect(preserved).toHaveLength(1);
    expect(readFileSync(join(dirname(inventoryPath), preserved[0]), "utf8")).toBe(unsupported);
  });

  it("propagates inventory read failures without quarantining the path", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    mkdirSync(inventoryPath);

    expect(() => synchronizeClaudeMcpInventory(inventoryPath, {
      filesystem: { command: "mcp-filesystem" }
    })).toThrow();
    expect(statSync(inventoryPath).isDirectory()).toBe(true);
    expect(readdirSync(dirname(inventoryPath)).filter(name => name.startsWith("claude-mcp-inventory.invalid-"))).toEqual([]);
  });

  it("returns last-known safe identities when the live MCP config is malformed", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    const claudeJsonPath = join(dirname(inventoryPath), ".claude.json");
    synchronizeClaudeMcpInventory(inventoryPath, {
      filesystem: { command: "mcp-filesystem", env: { TOKEN: "preserved-secret" } }
    }, 100);
    writeFileSync(claudeJsonPath, '{"mcpServers":', "utf8");

    const snapshot = synchronizeClaudeMcpProfileResources(claudeJsonPath, inventoryPath, []);

    expect(snapshot).toEqual({
      status: "config-unreadable",
      resources: [{
        id: "mcp:filesystem",
        kind: "mcp",
        name: "filesystem",
        description: "Claude Code MCP server",
        enabled: false
      }]
    });
    expect(JSON.stringify(snapshot)).not.toContain("preserved-secret");
  });

  it("preserves a malformed inventory and rebuilds live safe identities", () => {
    const inventoryPath = tempFile("claude-mcp-inventory.json");
    const claudeJsonPath = join(dirname(inventoryPath), ".claude.json");
    const malformed = '{"schemaVersion":1,"servers":';
    writeFileSync(inventoryPath, malformed, "utf8");
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { browser: { url: "https://mcp.example.test", headers: { Authorization: "live-secret" } } }
    }), "utf8");

    const snapshot = synchronizeClaudeMcpProfileResources(claudeJsonPath, inventoryPath, []);

    expect(snapshot).toEqual({
      status: "ready",
      resources: [{
        id: "mcp:browser",
        kind: "mcp",
        name: "browser",
        description: "Claude Code MCP server",
        enabled: true
      }]
    });
    expect(JSON.stringify(snapshot)).not.toContain("live-secret");
    expect(loadClaudeMcpInventory(inventoryPath)?.servers.browser).toEqual({
      url: "https://mcp.example.test",
      headers: { Authorization: "live-secret" }
    });
    const preserved = readdirSync(dirname(inventoryPath))
      .filter(name => name.startsWith("claude-mcp-inventory.invalid-") && name.endsWith(".json"));
    expect(preserved).toHaveLength(1);
    expect(readFileSync(join(dirname(inventoryPath), preserved[0]), "utf8")).toBe(malformed);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDshPluginStatus, installDshPlugin, removeDshPlugin, resolveBundledDshPluginPath, resolveNpxInvocation, type DshCommandRunner } from "../src/main/dshPluginManager";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-desk-plugin-"));
  roots.push(root);
  const profilesRoot = join(root, "profiles");
  const pluginPath = join(root, "dsh-desk-plugin.tgz");
  writeFileSync(pluginPath, "package", "utf8");
  return { root, profilesRoot, pluginPath, npxPath: "C:\\node\\npx.cmd" };
}

function writeProfile(profilesRoot: string, name: "web" | "headless", installed: boolean) {
  const root = join(profilesRoot, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: installed ? { "dsh-desk-plugin": "file:plugin.tgz" } : {},
    dsh: { profile: { bundles: installed ? ["dsh-desk-plugin"] : [] } }
  }), "utf8");
  if (installed) {
    mkdirSync(join(root, "node_modules", "dsh-desk-plugin"), { recursive: true });
    writeFileSync(join(root, "node_modules", "dsh-desk-plugin", "package.json"), "{}", "utf8");
  }
}

describe("DSH plugin status", () => {
  it("requires both web and headless registrations to be materialized", () => {
    const options = fixture();
    writeProfile(options.profilesRoot, "web", true);
    writeProfile(options.profilesRoot, "headless", false);
    expect(getDshPluginStatus(options)).toMatchObject({
      installed: false,
      hookCount: 1,
      requiredCount: 2,
      missingEvents: ["headless"],
      npxAvailable: true
    });
  });

  it("resolves source and packaged plugin locations", () => {
    expect(resolveBundledDshPluginPath("C:\\repo", "C:\\app\\resources", false)).toBe(join("C:\\repo", "dsh-plugin"));
    expect(resolveBundledDshPluginPath("C:\\repo", "C:\\app\\resources", true)).toBe(join("C:\\app\\resources", "dsh-plugin", "dsh-desk-plugin.tgz"));
  });

  it("runs npx.cmd through node without shell command construction", () => {
    const root = mkdtempSync(join(tmpdir(), "chara-npx-"));
    roots.push(root);
    const npxPath = join(root, "npx.cmd");
    const nodePath = join(root, "node.exe");
    const cliPath = join(root, "node_modules", "npm", "bin", "npx-cli.js");
    mkdirSync(join(root, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(npxPath, "", "utf8");
    writeFileSync(nodePath, "", "utf8");
    writeFileSync(cliPath, "", "utf8");
    expect(resolveNpxInvocation(npxPath, ["--yes", "@deepseek-ai/dsh"], "win32"))
      .toEqual({ command: nodePath, args: [cliPath, "--yes", "@deepseek-ai/dsh"] });
  });
});

describe("DSH plugin operations", () => {
  it("installs the bundled plugin into web and headless profiles", async () => {
    const options = fixture();
    const calls: string[][] = [];
    const run: DshCommandRunner = async (_command, args) => {
      calls.push(args);
      const profile = args[args.indexOf("--profile") + 1] as "web" | "headless";
      writeProfile(options.profilesRoot, profile, true);
    };
    const result = await installDshPlugin(options, run);
    expect(result.success).toBe(true);
    expect(calls.map(args => args.slice(-3))).toEqual([
      ["web", "add", options.pluginPath],
      ["headless", "add", options.pluginPath]
    ]);
  });

  it("removes the legacy bridge before installing the unified plugin", async () => {
    const options = fixture();
    for (const profile of ["web", "headless"] as const) {
      const root = join(options.profilesRoot, profile);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({
        dependencies: { "dsh-chara-desk": "file:legacy.tgz" },
        dsh: { profile: { bundles: ["dsh-chara-desk"] } }
      }), "utf8");
    }
    const calls: string[][] = [];
    const run: DshCommandRunner = async (_command, args) => {
      calls.push(args);
      const profile = args[args.indexOf("--profile") + 1] as "web" | "headless";
      if (args.at(-2) === "add") writeProfile(options.profilesRoot, profile, true);
    };

    expect((await installDshPlugin(options, run)).success).toBe(true);
    expect(calls.map(args => args.slice(-3))).toEqual([
      ["web", "remove", "dsh-chara-desk"],
      ["web", "add", options.pluginPath],
      ["headless", "remove", "dsh-chara-desk"],
      ["headless", "add", options.pluginPath]
    ]);
  });

  it("removes only registered profiles", async () => {
    const options = fixture();
    writeProfile(options.profilesRoot, "web", true);
    writeProfile(options.profilesRoot, "headless", false);
    const run: DshCommandRunner = async (_command, args) => {
      const profile = args[args.indexOf("--profile") + 1] as "web" | "headless";
      writeProfile(options.profilesRoot, profile, false);
    };
    const result = await removeDshPlugin(options, run);
    expect(result).toMatchObject({ success: true, removed: 1 });
  });
});

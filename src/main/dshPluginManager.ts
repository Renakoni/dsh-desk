import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { DshProfileName, DshProfilePluginStatus, HookOperationResult, HookStatus } from "../shared/hooks";

const PLUGIN_NAME = "dsh-desk-plugin";
const PROFILES: DshProfileName[] = ["web", "headless"];

type JsonObject = Record<string, unknown>;

export type DshPluginManagerOptions = {
  profilesRoot: string;
  pluginPath: string;
  npxPath: string | null;
};

export type DshCommandRunner = (command: string, args: string[]) => Promise<void>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function readProfileStatus(profilesRoot: string, name: DshProfileName): DshProfilePluginStatus {
  const root = join(profilesRoot, name);
  const packagePath = join(root, "package.json");
  const configExists = existsSync(packagePath);
  if (!configExists) {
    return { name, configExists: false, configReadError: false, dependencyRegistered: false, bundleRegistered: false, installed: false };
  }
  try {
    const pkg = asObject(JSON.parse(readFileSync(packagePath, "utf8")));
    if (pkg === null) throw new Error("profile package.json is not an object");
    const dependencies = asObject(pkg.dependencies);
    const dsh = asObject(pkg.dsh);
    const profile = asObject(dsh?.profile);
    const bundles = Array.isArray(profile?.bundles) ? profile.bundles : [];
    const dependencyRegistered = typeof dependencies?.[PLUGIN_NAME] === "string";
    const bundleRegistered = bundles.includes(PLUGIN_NAME);
    const materialized = existsSync(join(root, "node_modules", PLUGIN_NAME, "package.json"));
    return {
      name,
      configExists: true,
      configReadError: false,
      dependencyRegistered,
      bundleRegistered,
      installed: dependencyRegistered && bundleRegistered && materialized
    };
  } catch {
    return { name, configExists: true, configReadError: true, dependencyRegistered: false, bundleRegistered: false, installed: false };
  }
}

export function getDshPluginStatus(options: DshPluginManagerOptions): HookStatus {
  const profiles = PROFILES.map(name => readProfileStatus(options.profilesRoot, name));
  const hookCount = profiles.filter(profile => profile.installed).length;
  return {
    installed: hookCount === PROFILES.length,
    configExists: profiles.every(profile => profile.configExists),
    configReadError: profiles.some(profile => profile.configReadError),
    hookCount,
    requiredCount: PROFILES.length,
    missingEvents: profiles.filter(profile => !profile.installed).map(profile => profile.name),
    commandMatches: profiles.every(profile => profile.dependencyRegistered && profile.bundleRegistered),
    settingsPath: options.profilesRoot,
    bundle: { expectedPath: options.pluginPath, exists: existsSync(options.pluginPath) },
    npxAvailable: options.npxPath !== null,
    profiles
  };
}

export function runDshCommand(command: string, args: string[]): Promise<void> {
  const invocation = resolveNpxInvocation(command, args);
  return new Promise((resolve, reject) => {
    execFile(invocation.command, invocation.args, { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 }, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function resolveNpxInvocation(npxPath: string, args: string[], platform = process.platform): { command: string; args: string[] } {
  if (platform !== "win32" || !npxPath.toLowerCase().endsWith(".cmd")) {
    return { command: npxPath, args };
  }
  const root = dirname(npxPath);
  const nodePath = join(root, "node.exe");
  const cliPath = join(root, "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(nodePath) || !existsSync(cliPath)) {
    throw new Error("The npx installation is incomplete (node.exe or npx-cli.js is missing).");
  }
  return { command: nodePath, args: [cliPath, ...args] };
}

function operationPreflight(options: DshPluginManagerOptions): HookOperationResult | null {
  const status = getDshPluginStatus(options);
  if (!status.bundle.exists) {
    return { success: false, errorKind: "bundle-missing", bundlePath: options.pluginPath, error: `DSH plugin bundle not found: ${options.pluginPath}`, status };
  }
  if (!options.npxPath) {
    return { success: false, errorKind: "npx-missing", error: "npx was not found on PATH", status };
  }
  return null;
}

export async function installDshPlugin(options: DshPluginManagerOptions, run: DshCommandRunner = runDshCommand): Promise<HookOperationResult> {
  const preflight = operationPreflight(options);
  if (preflight) return preflight;
  try {
    for (const profile of PROFILES) {
      await run(options.npxPath!, ["--yes", "@deepseek-ai/dsh", "plugin", "--profile", profile, "add", options.pluginPath]);
    }
    const status = getDshPluginStatus(options);
    return { success: status.installed, error: status.installed ? undefined : "The DSH plugin was not active in every required profile.", status };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), status: getDshPluginStatus(options) };
  }
}

export async function removeDshPlugin(options: DshPluginManagerOptions, run: DshCommandRunner = runDshCommand): Promise<HookOperationResult> {
  const statusBefore = getDshPluginStatus(options);
  if (!options.npxPath) {
    return { success: false, errorKind: "npx-missing", error: "npx was not found on PATH", status: statusBefore };
  }
  let removed = 0;
  try {
    for (const profile of statusBefore.profiles) {
      if (!profile.dependencyRegistered && !profile.bundleRegistered) continue;
      await run(options.npxPath, ["--yes", "@deepseek-ai/dsh", "plugin", "--profile", profile.name, "remove", PLUGIN_NAME]);
      removed += 1;
    }
    const status = getDshPluginStatus(options);
    const removedEverywhere = status.profiles.every(profile => !profile.dependencyRegistered && !profile.bundleRegistered && !profile.installed);
    return { success: removedEverywhere && !status.configReadError, removed, status };
  } catch (error) {
    return { success: false, removed, error: error instanceof Error ? error.message : String(error), status: getDshPluginStatus(options) };
  }
}

export function findNpxExecutable(pathValue = process.env.PATH ?? "", executablePath = process.execPath): string | null {
  const names = process.platform === "win32" ? ["npx.cmd", "npx.exe"] : ["npx"];
  const directories = [dirname(executablePath), ...pathValue.split(delimiter)].filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function resolveBundledDshPluginPath(appPath: string, resourcesPath: string, packaged: boolean): string {
  return packaged
    ? join(resourcesPath, "dsh-plugin", "dsh-desk-plugin.tgz")
    : join(appPath, "dsh-plugin");
}

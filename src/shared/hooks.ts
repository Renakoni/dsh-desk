export type DshProfileName = "web" | "headless";

export interface DshProfilePluginStatus {
  name: DshProfileName;
  configExists: boolean;
  configReadError: boolean;
  dependencyRegistered: boolean;
  bundleRegistered: boolean;
  installed: boolean;
}

// The method names remain `checkHooks` / `installHooks` in the compatibility IPC
// surface for now, but the contract is exclusively about the DSH plugin.
export interface HookStatus {
  installed: boolean;
  configExists: boolean;
  configReadError: boolean;
  hookCount: number;
  requiredCount: number;
  missingEvents: DshProfileName[];
  commandMatches: boolean;
  settingsPath: string;
  bundle: { expectedPath: string; exists: boolean };
  npxAvailable: boolean;
  profiles: DshProfilePluginStatus[];
}

export type HookOperationErrorKind = "bundle-missing" | "npx-missing";

export interface HookOperationResult {
  success: boolean;
  error?: string;
  errorKind?: HookOperationErrorKind;
  bundlePath?: string;
  removed?: number;
  status: HookStatus;
}

export type HookErrorDisplay =
  | { kind: "bundle-missing"; path?: string }
  | { kind: "npx-missing" }
  | { kind: "hidden" }
  | { kind: "raw"; text: string };

export function describeHookOperationError(
  result: Pick<HookOperationResult, "error" | "errorKind" | "bundlePath"> | undefined,
  hide: boolean
): HookErrorDisplay {
  if (result?.errorKind === "bundle-missing") {
    return hide || !result.bundlePath ? { kind: "bundle-missing" } : { kind: "bundle-missing", path: result.bundlePath };
  }
  if (result?.errorKind === "npx-missing") return { kind: "npx-missing" };
  if (hide) return { kind: "hidden" };
  return { kind: "raw", text: result?.error ?? "" };
}

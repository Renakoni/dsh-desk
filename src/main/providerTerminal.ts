// PowerShell terminal launch for a Claude provider or a session resume.
//
// DSH Desk opens a normal, standalone Windows PowerShell window and Claude runs
// INSIDE PowerShell — never inside cmd. `cmd /c start` is used ONLY as the launcher
// (how Windows opens a new console): `start` gives PowerShell its own visible,
// interactive console and returns, then cmd exits. The user's provider env
// (ANTHROPIC_BASE_URL, tokens, ...) is passed through spawn's `env` (never argv, never
// disk). The trusted Claude executable path and the validated session id ride in
// dedicated child-only env vars, invoked by a FIXED PowerShell call-operator command,
// so no dynamic value is ever interpolated into a command string or the argv — cmd's
// static command line likewise holds no secret or dynamic value. PowerShell loads the
// user's normal profile (so Conda init etc. work) and stays open after Claude exits
// (-NoExit).

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

/** The provider's env as a plain string map: string values kept, finite numbers
 *  stringified, everything else dropped. */
export function providerTerminalEnv(settingsConfig: unknown): Record<string, string> {
  const env = settingsConfig && typeof settingsConfig === "object" && !Array.isArray(settingsConfig)
    ? (settingsConfig as Record<string, unknown>).env
    : undefined;
  const out: Record<string, string> = {};
  if (env && typeof env === "object" && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      // PATH controls both which Claude entry point is found and any native
      // commands used by a PowerShell Claude shim. Provider records may be
      // imported or shared, so they must never replace the user's trusted PATH.
      if (key.toLowerCase() === "path") continue;
      if (typeof value === "string") out[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
    }
  }
  return out;
}

/**
 * Overlay `overlay` onto `baseEnv`, case-insensitively. spawn's `env` replaces the
 * environment wholesale, so start from the inherited one (PATH, SystemRoot, ...) and
 * layer the provider's routing (and our child-only vars) on top. Windows env keys are
 * case-insensitive, so an inherited "Path" and an overlaid "PATH" collapse to a single
 * key with the overlay's value — otherwise the OS would arbitrate between duplicates.
 * Credentials live only here, never on the command line.
 */
export function mergeTerminalEnv(
  overlay: Record<string, string>,
  baseEnv: Record<string, string | undefined>
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(overlay)) {
    // Drop every case-variant of this key (the OS normally collapses e.g. Path/PATH, but
    // be robust if the inherited env ever holds more than one) before setting the winner.
    for (const existing of Object.keys(env)) {
      if (existing !== key && existing.toLowerCase() === key.toLowerCase()) delete env[existing];
    }
    env[key] = value;
  }
  return env;
}

/**
 * True only for a genuinely fully-qualified Windows path — drive-absolute (`C:\...`)
 * or UNC (`\\server\share...`). Rejects relative (`.`, `tools`, `.\bin`),
 * drive-root-relative (`\tools`, which resolves against the current drive) and
 * drive-relative (`C:tools`, which resolves against the drive's current directory).
 * `path.win32.isAbsolute` is NOT sufficient: it returns true for `\tools`.
 */
export function isFullyQualifiedWindowsPath(candidate: string): boolean {
  const value = candidate.trim();
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/][\\/]/.test(value);
}

/** Read a variable from an env map case-insensitively (Windows keys vary in case). */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * The trusted Windows PowerShell executable
 * (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`), resolved from
 * SystemRoot only — never PATH or the selected project — so a project-local
 * `powershell.exe` can never shadow the trusted shell. Returns null if it is absent.
 */
export function trustedPowerShellPath(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = existsSync
): string | null {
  const systemRoot = envValue(env, "SystemRoot") || envValue(env, "windir") || "C:\\Windows";
  const candidate = pathWin32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fileExists(candidate) ? candidate : null;
}

/**
 * The trusted Windows command processor (`%SystemRoot%\System32\cmd.exe`), resolved
 * from SystemRoot only — never PATH or the selected project — so a project-local
 * `cmd.exe` can never shadow it. It is used ONLY as `cmd /c start` to open a normal,
 * standalone PowerShell console window (the way Windows shells always have): `start`
 * gives PowerShell its own visible, interactive console and returns immediately, then
 * cmd exits. The command line is fully static — `start "DSH Desk" <powershell>
 * -NoExit -Command <fixed call-operator command>` — so cmd/start never parse any
 * dynamic or secret value (see buildPowerShellLaunch). Returns null if it is absent.
 */
export function trustedCmdPath(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = existsSync
): string | null {
  const systemRoot = envValue(env, "SystemRoot") || envValue(env, "windir") || "C:\\Windows";
  const candidate = pathWin32.join(systemRoot, "System32", "cmd.exe");
  return fileExists(candidate) ? candidate : null;
}

export type ClaudeResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "not-found" | "batch-only" };

/**
 * Resolve `claude` to a trusted, fully-qualified NATIVE entry point from PATH only —
 * `claude.exe` or PowerShell-native `claude.ps1`. It deliberately never resolves
 * `claude.cmd`/`claude.bat`, because PowerShell delegates batch files to cmd.exe;
 * if only a batch shim exists it reports `batch-only` instead of silently falling
 * back to cmd. It never searches the working directory and only accepts genuinely
 * fully-qualified PATH entries, so a project-local shim can't shadow the CLI or
 * receive the provider credentials. The same absolute path is validated here and
 * executed later, so they always identify the same file.
 */
export function resolveClaudeExecutable(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = existsSync
): ClaudeResolution {
  const dirs = (envValue(env, "PATH") ?? "")
    .split(";")
    .map(dir => dir.trim().replace(/^"|"$/g, ""))
    .filter(dir => isFullyQualifiedWindowsPath(dir));
  for (const dir of dirs) {
    for (const ext of [".exe", ".ps1"]) {
      const candidate = pathWin32.join(dir, `claude${ext}`);
      if (isFullyQualifiedWindowsPath(candidate) && fileExists(candidate)) return { ok: true, path: candidate };
    }
  }
  // A batch shim on its own is not usable without cmd.exe — report it specifically.
  for (const dir of dirs) {
    for (const ext of [".cmd", ".bat"]) {
      if (fileExists(pathWin32.join(dir, `claude${ext}`))) return { ok: false, reason: "batch-only" };
    }
  }
  return { ok: false, reason: "not-found" };
}

/**
 * Decide the working directory for a session resume. Only fall back to the home
 * directory when the session recorded NO cwd at all; a recorded-but-unavailable cwd
 * (offline share, deleted/moved project) fails with the path so the caller can format
 * an actionable, copyable error instead of silently resuming in the home directory.
 * No cmd-era UNC/extended rejection: PowerShell can open those, and an unusable form
 * fails at spawn rather than launching elsewhere.
 */
export function resolveSessionCwd(
  projectPath: string | undefined,
  homeDir: string,
  isDir: (path: string) => boolean = isExistingDirectory
): { ok: true; cwd: string } | { ok: false; path: string } {
  const requested = typeof projectPath === "string" ? projectPath.trim() : "";
  if (!requested) return { ok: true, cwd: homeDir };
  if (!isDir(requested)) return { ok: false, path: requested };
  return { ok: true, cwd: requested };
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Make a working directory usable by the `cmd /c start` launcher, or reject it. cmd.exe
 * CANNOT take a UNC or extended-length cwd: handed `\\server\share` or `\\?\...` it prints
 * "UNC paths are not supported. Defaulting to Windows directory.", silently switches its
 * cwd to C:\Windows, and STILL exits 0 — so `start` would open PowerShell in C:\Windows
 * while we report success in the wrong folder. So, before spawning:
 *  - normalize an extended-length LOCAL drive path (`\\?\E:\proj` → `E:\proj`), which cmd
 *    handles fine once the `\\?\` prefix is gone; and
 *  - reject any UNC path — plain (`\\server\share`) or extended (`\\?\UNC\server\share`) —
 *    so the caller can surface an actionable error instead of a silent C:\Windows launch.
 * Ordinary drive-absolute paths pass through unchanged. (Minimal for v0.1.0 — no pushd /
 * drive-mapping / broader `\\?\` support.)
 */
export function normalizeCmdCwd(cwd: string): { ok: true; cwd: string } | { ok: false } {
  const value = cwd.trim();
  // Extended-length LOCAL drive path: strip `\\?\`, keeping `X:\...` (cmd can use that).
  const extendedLocal = value.match(/^\\\\\?\\([a-zA-Z]:(?:[\\/].*)?)$/);
  if (extendedLocal) return { ok: true, cwd: extendedLocal[1] };
  // Any remaining extended-length form (incl. `\\?\UNC\...`, device paths) — reject.
  if (/^\\\\\?\\/.test(value)) return { ok: false };
  // Plain UNC (`\\server\share` or `//server/share`) — cmd can't use it. Reject.
  if (/^[\\/]{2}/.test(value)) return { ok: false };
  // Ordinary local drive-absolute path — cmd can use it as-is.
  return { ok: true, cwd: value };
}

// Child-only env vars carrying the trusted Claude path and validated session id.
export const CHARA_DESK_CLAUDE_ENV = "CHARA_DESK_CLAUDE";
export const CHARA_DESK_RESUME_ID_ENV = "CHARA_DESK_RESUME_ID";

// FIXED PowerShell commands — the call operator runs the scalar path/id from the
// child environment, so spaces or `& ( ) ^ %` in the Claude path never re-parse and
// no dynamic value is interpolated into the command string.
export const PS_RUN_CLAUDE = `& $env:${CHARA_DESK_CLAUDE_ENV}`;
export const PS_RESUME_CLAUDE = `& $env:${CHARA_DESK_CLAUDE_ENV} --resume $env:${CHARA_DESK_RESUME_ID_ENV}`;

export interface PowerShellLaunch {
  file: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Build the launch: `cmd /c start "DSH Desk" <powershell> -NoExit -Command <fixed>`.
 * cmd is ONLY the launcher — `start` opens a normal, standalone Windows PowerShell
 * console window (its own visible, interactive console) and returns; cmd exits. Claude
 * then runs *inside PowerShell*, never inside cmd, via the fixed call-operator command.
 * `-NoExit` keeps the window open after Claude exits; the user's normal profile loads
 * (no `-NoProfile` / `-NonInteractive` / `-ExecutionPolicy` override) so Conda etc. work.
 * The claude path, session id and provider secrets never appear on the command line —
 * they ride in `env` and PowerShell reads them at runtime (`& $env:CHARA_DESK_CLAUDE`),
 * so the command string is fixed and nothing dynamic is interpolated. The command arg's
 * `&` and spaces sit inside one quoted token, so cmd hands it to PowerShell verbatim.
 * The explicit quoted "DSH Desk" title stops `start` reading the program path as a
 * title (the spawn layer also quotes the path, so even a spaced path would be safe).
 */
export function buildPowerShellLaunch(cmdExe: string, powershellExe: string, command: string, env: Record<string, string>): PowerShellLaunch {
  return { file: cmdExe, args: ["/c", "start", "DSH Desk", powershellExe, "-NoExit", "-Command", command], env };
}

/** "Not a folder" message, path omitted when paths are hidden. */
export function notAFolderMessage(path: string, hidePaths: boolean): string {
  if (hidePaths) return "That folder can't be used.";
  return `Not a folder: ${path || "(none selected)"}`;
}

/** Session-cwd-unavailable message, path omitted when paths are hidden. */
export function sessionFolderUnavailableMessage(path: string, hidePaths: boolean): string {
  if (hidePaths) return "This session's folder isn't available. Reconnect or reopen the project, or run the copied command there.";
  return `This session's folder isn't available (${path}). Reconnect or reopen the project, or run the copied command there.`;
}

/** Async launch-failure message, reason omitted when paths are hidden (it may embed the cwd). */
export function launchFailedMessage(reason: string | undefined, hidePaths: boolean): string {
  if (hidePaths) return "Couldn't open the terminal — check the folder and try again.";
  return `Couldn't open the terminal: ${reason ?? "unknown error"}`;
}

/** UNC-cwd rejection message (cmd can't open a terminal there), path omitted when hidden. */
export function uncNotSupportedMessage(path: string, hidePaths: boolean): string {
  if (hidePaths) return "That folder is a network (UNC) path, which can't be used to open a terminal here. Use a folder on a local drive, or map it to a drive letter first.";
  return `Network (UNC) folders can't be used to open a terminal here (${path}). Use a folder on a local drive, or map it to a drive letter first.`;
}

/**
 * Resolve once the terminal process has actually spawned; reject if it fails to
 * launch. child_process.spawn reports launch failures asynchronously through the
 * 'error' event instead of throwing, so a caller that returns right after spawn()
 * would claim a false success — and the unhandled 'error' event would crash the
 * main process. Awaiting this collapses both outcomes into a normal resolve/reject.
 */
function awaitTerminalLaunch(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (error) => reject(error));
  });
}

export interface TerminalLaunchResult {
  ok: boolean;
  error?: string;
}

/**
 * Spawn the `cmd /c start` launcher and resolve once IT has launched. Both the provider
 * terminal and session resume go through here, so a failure to spawn cmd (reported
 * asynchronously via 'error', not by throwing) becomes a clean { ok:false, error } for
 * the renderer instead of a false success plus an unhandled ChildProcess 'error' that
 * could take down the main process.
 *
 * Success signal, honestly: `ok:true` means the cmd launcher started — NOT that the
 * PowerShell window is confirmed open. `cmd /c start` hands off to `start` and exits 0
 * at once, so if PowerShell itself fails to launch (e.g. AppLocker/WDAC blocks it) that
 * surfaces only in the detached child console, not here. trustedPowerShellPath's
 * existsSync rules out a missing shell up front; a present-but-unrunnable shell is the
 * residual gap (a stronger signal would need a PowerShell-side readiness handshake).
 *
 * stdio is "ignore": `start` gives the PowerShell it launches a brand-new console of its
 * own, so this short-lived cmd needs no usable std handles — it just fires `start` and
 * exits. (Spawning powershell.exe directly with "ignore" behaves differently: with NUL
 * std handles and no console it exits before running anything — which is exactly why the
 * launch goes through `start`, to get a real, visible console window.) detached + unref
 * so the PowerShell window lives independently of the app.
 */
export async function launchDetachedTerminal(
  file: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> },
  spawnFn: typeof spawn = spawn
): Promise<TerminalLaunchResult> {
  try {
    const child = spawnFn(file, args, { ...options, detached: true, windowsHide: false, stdio: "ignore" });
    await awaitTerminalLaunch(child);
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

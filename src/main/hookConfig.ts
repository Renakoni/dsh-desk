// Pure hook-configuration evaluation, extracted from the Electron main process so
// it can be unit-tested without booting the app or touching the filesystem.
//
// The delivery-chain model reports independent facts about the Claude Code
// settings: which required events reference our forwarder (configuration) and
// whether each is a single, canonical, CURRENT command (command correctness).
// "Current" means every argument that affects operation matches — forwarder
// path, event port, settings path, app path/root, and the PreToolUse timeout —
// not just the script name. A duplicate or stale Clawd command for an event is
// NOT healthy: Claude Code would run both, so the event needs to be de-duplicated
// down to one canonical command.
import { resolve } from "node:path";

export function extractHookForwarderPath(command: string): string {
  const match = command.match(/(?:"([^"]*hook-forwarder\.js)"|'([^']*hook-forwarder\.js)'|([^\s"']*hook-forwarder\.js))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

export function normalizeComparablePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

// Extract the value of a `--flag value` / `--flag "value"` / `--flag 'value'`
// argument from a command string.
function extractFlag(command: string, flag: string): string | undefined {
  const match = command.match(new RegExp(`${flag}\\s+(?:"([^"]*)"|'([^']*)'|(\\S+))`));
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

function pathArgMatches(command: string, flag: string, expected: string): boolean {
  const value = extractFlag(command, flag);
  return value !== undefined && normalizeComparablePath(value) === normalizeComparablePath(expected);
}

// How many times a `--flag` token appears. The forwarder's runtime parser keeps
// the LAST occurrence of a duplicated flag, so a first-match validation could
// wrongly pass; a canonical command must contain each critical flag exactly once.
function flagOccurrences(command: string, flag: string): number {
  return (command.match(new RegExp(`(?:^|\\s)${flag}(?=\\s|$)`, "g")) ?? []).length;
}

const CRITICAL_FLAGS = ["--port", "--settings", "--app-path", "--app-root"];

export interface ExpectedHookCommand {
  /** Absolute path of the current hook-forwarder.js. */
  forwarderPath: string;
  /** Current Claude settings path passed via --settings. */
  settingsPath: string;
  /** Current app executable path passed via --app-path. */
  appPath: string;
  /** Current app root passed via --app-root. */
  appRoot: string;
  /** Current local event port passed via --port. */
  port: number;
}

// A command is one of ours when it invokes hook-forwarder.js for `eventName`.
// This is the loose "is this a Clawd command at all" test used for detection,
// de-duplication, and removal — it does NOT assert the command is current.
export function isClawdHookCommand(command: unknown, eventName?: string): boolean {
  if (typeof command !== "string") return false;
  const normalized = command.replace(/\\/g, "/");
  if (!normalized.includes("hook-forwarder.js")) return false;
  if (!eventName) return true;
  return new RegExp(`(^|[\\s"'])${eventName}($|[\\s"'])`).test(normalized);
}

// Whether a command is the CURRENT canonical command for `eventName`: it is a
// Clawd command AND every operation-affecting argument matches the current
// values (forwarder path, port, settings path, app path/root). The PreToolUse
// timeout lives on the hook entry, not the command string, so it is checked by
// the caller.
export function isCurrentClawdCommand(command: unknown, eventName: string, expected: ExpectedHookCommand): boolean {
  if (!isClawdHookCommand(command, eventName)) return false;
  const cmd = command as string;
  // A duplicated critical flag is non-canonical — the runtime would use the last
  // occurrence, so require each to appear exactly once and be repaired otherwise.
  if (CRITICAL_FLAGS.some(flag => flagOccurrences(cmd, flag) !== 1)) return false;
  if (normalizeComparablePath(extractHookForwarderPath(cmd)) !== normalizeComparablePath(expected.forwarderPath)) return false;
  if (Number(extractFlag(cmd, "--port")) !== expected.port) return false;
  if (!pathArgMatches(cmd, "--settings", expected.settingsPath)) return false;
  if (!pathArgMatches(cmd, "--app-path", expected.appPath)) return false;
  if (!pathArgMatches(cmd, "--app-root", expected.appRoot)) return false;
  return true;
}

export interface HookConfigEvaluationOptions {
  requiredEvents: string[];
  expected: ExpectedHookCommand;
  preToolUseEvent?: string;
  preToolUseTimeout?: number;
}

export interface HookConfigEvaluation {
  /** Required events with no Clawd command at all. */
  missingEvents: string[];
  /** Configured events whose command is stale, duplicated, or wrong-timeout. */
  staleEvents: string[];
  /** How many required events have at least one Clawd command. */
  hookCount: number;
  /** Every configured event has exactly ONE current, canonical command. */
  commandMatches: boolean;
  /** Config complete AND every command current — the settings-side "installed" fact. */
  installed: boolean;
}

// Remove every Clawd command from an event's entry list, preserving unrelated
// third-party hooks and their matchers, and dropping entries left with no hooks.
export function stripClawdCommands(entries: any): any[] {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return entry;
      return { ...entry, hooks: entry.hooks.filter((hook: any) => !isClawdHookCommand(hook?.command)) };
    })
    .filter(entry => !entry || typeof entry !== "object" || !Array.isArray(entry.hooks) || entry.hooks.length > 0);
}

// De-duplicate an event down to exactly one canonical Clawd entry: strip all
// existing Clawd commands (any number, current or stale) and append the single
// canonical one, leaving third-party hooks untouched.
export function canonicalizeEventEntries(entries: any, canonicalEntry: any): any[] {
  return [...stripClawdCommands(entries), canonicalEntry];
}

function clawdHooksFor(settings: Record<string, any> | null | undefined, eventName: string): Array<{ command: unknown; timeout?: unknown }> {
  const eventConfig = settings?.hooks?.[eventName];
  if (!Array.isArray(eventConfig)) return [];
  const out: Array<{ command: unknown; timeout?: unknown }> = [];
  for (const entry of eventConfig) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (hook?.type === "command" && isClawdHookCommand(hook?.command, eventName)) {
        out.push({ command: hook.command, timeout: hook.timeout });
      }
    }
  }
  return out;
}

export function evaluateHookConfig(settings: Record<string, any> | null | undefined, options: HookConfigEvaluationOptions): HookConfigEvaluation {
  const { requiredEvents, expected, preToolUseEvent = "PreToolUse", preToolUseTimeout } = options;

  const missingEvents: string[] = [];
  const staleEvents: string[] = [];

  for (const eventName of requiredEvents) {
    const clawd = clawdHooksFor(settings, eventName);
    if (clawd.length === 0) {
      missingEvents.push(eventName);
      continue;
    }
    // Exactly one Clawd command, and it must be current (incl. PreToolUse timeout).
    const timeoutOk = eventName !== preToolUseEvent || preToolUseTimeout === undefined || clawd[0].timeout === preToolUseTimeout;
    const clean = clawd.length === 1 && isCurrentClawdCommand(clawd[0].command, eventName, expected) && timeoutOk;
    if (!clean) staleEvents.push(eventName);
  }

  const hookCount = requiredEvents.length - missingEvents.length;
  const commandMatches = hookCount > 0 && staleEvents.length === 0;

  return {
    missingEvents,
    staleEvents,
    hookCount,
    commandMatches,
    installed: missingEvents.length === 0 && commandMatches
  };
}

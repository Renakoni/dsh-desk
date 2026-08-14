#!/usr/bin/env node

const http = require("node:http");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync, statSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const cli = parseArgs(process.argv.slice(2));
const eventPort = Number(cli.port ?? process.env.CHARA_DESK_PORT ?? 17321);
const hookName = cli.hookName;

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--settings") result.settingsPath = args[++index];
    else if (arg === "--app-path") result.appPath = args[++index];
    else if (arg === "--app-root") result.appRoot = args[++index];
    else if (arg === "--port") result.port = args[++index];
    else if (!arg.startsWith("--") && !result.hookName) result.hookName = arg;
  }

  return result;
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve(null);

  return new Promise(resolve => {
    let body = "";
    let done = false;

    function finish(value) {
      if (done) return;
      done = true;
      resolve(value);
    }

    const timer = setTimeout(() => finish(body || null), 250);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        body = body.slice(0, 1024 * 1024);
        process.stdin.destroy();
      }
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      finish(body);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}

function parsePayload(input) {
  if (!input || !input.trim()) return {};

  try {
    const value = JSON.parse(input);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function pickHookName(payload) {
  return (
    hookName ||
    payload.hook_event_name ||
    payload.hookEventName ||
    payload.hook_name ||
    payload.hookName ||
    payload.event ||
    "Unknown"
  );
}

function pickToolName(payload) {
  const tool = payload.tool;
  if (typeof payload.tool_name === "string") return payload.tool_name;
  if (typeof payload.toolName === "string") return payload.toolName;
  if (typeof tool === "string") return tool;
  if (tool && typeof tool === "object" && typeof tool.name === "string") return tool.name;
  return undefined;
}

// Claude Code stamps every hook payload with the session id; forward it on every
// event so the app can count distinct sessions from any event, not just SessionStart
// (which a session already running when the pet launches never re-sends). Capped to
// the app's PetEvent validation limit.
function pickSessionId(payload) {
  const id = payload.session_id ?? payload.sessionId;
  return typeof id === "string" && id ? id.slice(0, 128) : undefined;
}

function shorten(value, maxLength = 500) {
  if (value === undefined || value === null) return undefined;

  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function pickDetail(payload) {
  return (
    shorten(payload.tool_input) ||
    shorten(payload.toolInput) ||
    shorten(payload.message) ||
    shorten(payload.prompt) ||
    undefined
  );
}

/**
 * A clean, human-readable detail for a tool — the salient field of tool_input
 * (the command, path, pattern, URL, …) rather than raw JSON, so both the
 * permission bubble and the status bubble show the thing being acted on.
 * Capped generously; the UI caps/scrolls further.
 */
function pickToolDetail(payload) {
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input
    : payload.toolInput && typeof payload.toolInput === "object" ? payload.toolInput : null;
  if (input) {
    const salient = input.command ?? input.file_path ?? input.path ?? input.pattern
      ?? input.url ?? input.query ?? input.prompt ?? input.notebook_path;
    if (typeof salient === "string" && salient.trim()) return shorten(salient, 1000);
  }
  return pickDetail(payload);
}

// Tools Claude Code auto-approves in acceptEdits mode — never a permission gate there.
const EDIT_FAMILY_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Update"]);

// Permission modes that never require manual confirmation (Claude auto-approves
// or does not execute), so the hook must not intercept them.
const AUTO_APPROVE_MODES = new Set(["bypassPermissions", "dontAsk", "auto", "plan"]);

/**
 * Decide whether a hook payload is a permission gate that needs human
 * authorization. Mirrors Claude Code's own logic: PreToolUse fires for EVERY
 * tool regardless of mode, so we rely on `permission_mode` to tell an
 * auto-approved call apart from one that genuinely blocks on the user.
 *
 * - Only PreToolUse can carry a permission decision back to Claude Code.
 * - When `permission_mode` is absent (e.g. subagent dispatch) we stay out of
 *   the way and let the CLI use its native flow.
 * - bypassPermissions / dontAsk / auto / plan are auto-approved → skip.
 * - acceptEdits auto-approves edit-family tools only → skip those, gate the rest.
 */
function isPermissionEvent(hook, payload) {
  if (hook !== "PreToolUse") return false;
  const permMode = typeof payload.permission_mode === "string"
    ? payload.permission_mode
    : typeof payload.permissionMode === "string" ? payload.permissionMode : "";
  if (!permMode) return false;
  if (AUTO_APPROVE_MODES.has(permMode)) return false;
  if (permMode === "acceptEdits" && EDIT_FAMILY_TOOLS.has(pickToolName(payload) ?? "")) return false;
  return true;
}

function formatPermissionDecision(decision, reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason ?? (decision === "allow" ? "Approved via DSH Desk" : "Denied via DSH Desk")
    },
    continue: true
  });
}

function nestedValue(payload, path) {
  let current = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function payloadIndicatesError(payload) {
  const statusValues = [
    payload.status,
    payload.result,
    payload.outcome,
    nestedValue(payload, ["tool_response", "status"]),
    nestedValue(payload, ["toolResponse", "status"])
  ].filter(value => typeof value === "string").map(value => value.toLowerCase());
  if (statusValues.some(value => /error|fail|failed|failure|exception/.test(value))) return true;

  const exitCodes = [
    payload.exit_code,
    payload.exitCode,
    nestedValue(payload, ["tool_response", "exit_code"]),
    nestedValue(payload, ["toolResponse", "exitCode"])
  ];
  if (exitCodes.some(value => Number.isFinite(Number(value)) && Number(value) !== 0)) return true;

  return Boolean(payload.error || payload.exception || nestedValue(payload, ["tool_response", "error"]) || nestedValue(payload, ["toolResponse", "error"]));
}

function readableError(value) {
  if (typeof value === "string" && value.trim()) return shorten(value.trim(), 2000);
  if (value && typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim()) return shorten(value.message.trim(), 2000);
    return shorten(value, 2000);
  }
  return undefined;
}

function pickErrorMessage(payload) {
  const candidates = [
    payload.error,
    payload.exception,
    nestedValue(payload, ["tool_response", "error"]),
    nestedValue(payload, ["toolResponse", "error"]),
    nestedValue(payload, ["tool_response", "stderr"]),
    nestedValue(payload, ["toolResponse", "stderr"]),
    payload.stderr,
    payload.message
  ];
  for (const candidate of candidates) {
    const message = readableError(candidate);
    if (message) return message;
  }

  const exitCode = [
    payload.exit_code,
    payload.exitCode,
    nestedValue(payload, ["tool_response", "exit_code"]),
    nestedValue(payload, ["toolResponse", "exitCode"])
  ].find(value => Number.isFinite(Number(value)) && Number(value) !== 0);
  return exitCode === undefined ? undefined : `Exited with code ${Number(exitCode)}`;
}

/**
 * Classify a Notification hook by intent. Current Claude Code payloads carry a
 * structured `notification_type`; the human-readable `message` is the fallback
 * for older or unknown payloads.
 *
 *   - "idle"      Claude finished and is waiting for the user's next message
 *                 ("Claude is waiting for your input"). NOT active work.
 *   - "attention" Claude needs the user to act now (a permission / elicitation
 *                 prompt that reached the native fallback rather than the app's
 *                 own permission card).
 *   - "info"      any other transient notice.
 *
 * A Notification does not itself prove that Claude is executing a tool. Tool
 * activity comes through PreToolUse/PostToolUse, so informational notices must
 * not overwrite that independently tracked state.
 */
function classifyNotification(payload) {
  // Prefer the documented matcher type when present.
  const explicit = (typeof payload.notification_type === "string" ? payload.notification_type
    : typeof payload.notificationType === "string" ? payload.notificationType
    : typeof payload.type === "string" ? payload.type : "").toLowerCase();
  if (explicit) {
    if (explicit === "idle_prompt") return "idle";
    if (explicit === "permission_prompt" || explicit === "elicitation_dialog") return "attention";
    if (explicit === "auth_success" || explicit === "elicitation_complete" || explicit === "elicitation_response") return "info";
  }

  const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
  if (!message) return "info";
  // Permission / elicitation prompts, including the native "needs your input"
  // fallback. Check these before idle wording because a message can contain both.
  if (/needs? (your )?(permission|approval|input|response|reply)|permission to use|waiting for your (permission|approval)|approve|elicit|confirm/.test(message)) return "attention";
  // Idle prompt, e.g. "Claude is done and waiting for your next prompt" /
  // "Claude is waiting for your input" — the session is paused for the user.
  if (/waiting for (your |the )?(next )?(prompt|input|response|reply|message)|is (done|idle)|ready for your|awaiting (your )?(input|prompt)/.test(message)) return "idle";
  return "info";
}

function mapHookToPetEvent(hook, payload) {
  const tool = pickToolName(payload);
  const detail = pickToolDetail(payload);
  const isError = payloadIndicatesError(payload);
  const errorMessage = isError ? pickErrorMessage(payload) : undefined;

  switch (hook) {
    case "SessionStart":
      return { event: "idle", title: "Claude session started", message: "Ready" };
    case "UserPromptSubmit":
      return { event: "running", title: "Working", message: "Handling prompt" };
    case "PreToolUse":
      // Permission gates are handled by the blocking /permission flow before
      // we get here; a PreToolUse that reaches this point is just tool activity.
      return { event: "running", title: "Using tool", tool, detail };
    case "PostToolUse":
      if (isError) {
        return { event: "error", title: "Tool failed", message: errorMessage ?? "Claude Code reported a tool error.", tool, detail };
      }
      return { event: "running", title: "Tool completed", tool, detail };
    case "Notification": {
      // Tool activity is tracked by PreToolUse/PostToolUse. Idle and attention
      // notifications pause the pet; informational notices are tagged so the
      // renderers can display them without replacing the active state. Real
      // tool-permission gates are owned by the blocking /permission flow.
      const kind = classifyNotification(payload);
      if (kind === "attention") {
        return { event: "idle", notificationKind: "attention", title: "Claude needs your attention", message: detail ?? "Claude is waiting for your response" };
      }
      if (kind === "info") {
        return { event: "idle", notificationKind: "info", title: "Claude Code notification", message: detail };
      }
      return { event: "idle", notificationKind: "idle", title: "Waiting for you" };
    }
    case "Stop":
      if (isError) {
        return { event: "error", title: "Claude Code error", message: errorMessage ?? "Claude Code reported an error.", tool, detail };
      }
      return { event: "completed", title: "Completed", message: "Task finished" };
    default:
      if (isError) {
        return { event: "error", title: hook ? `${hook} failed` : "Claude Code error", message: errorMessage ?? "Claude Code reported an error.", tool, detail };
      }
      return { event: "running", title: hook || "Claude Code event", tool, detail };
  }
}

function postPetEvent(event, timeout = 800) {
  const body = JSON.stringify({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    ...event
  });

  return new Promise(resolve => {
    let settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      resolve(ok);
    }

    const req = http.request(
      {
        host: "127.0.0.1",
        port: eventPort,
        path: "/event",
        method: "POST",
        timeout,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body)
        }
      },
      res => {
        res.resume();
        res.on("end", () => finish(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300)));
      }
    );

    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.on("error", () => finish(false));
    req.end(body);
  });
}

function httpJson(options, body, timeout) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const req = http.request({ host: "127.0.0.1", port: eventPort, timeout, ...options }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { finish(JSON.parse(data)); } catch { finish(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); finish(null); });
    req.on("error", () => finish(null));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * Ask the companion app for a permission decision and block until the user
 * responds (or it times out). Returns "allow" | "deny", or null to fall back
 * to Claude Code's native permission prompt.
 */
async function requestPermissionDecision(payload) {
  const body = JSON.stringify({
    toolName: pickToolName(payload) ?? "Unknown",
    toolDetail: pickToolDetail(payload),
    sessionId: payload.session_id ?? payload.sessionId,
    rawPayload: {}
  });

  const created = await httpJson(
    { path: "/permission", method: "POST", headers: { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) } },
    body,
    5000
  );
  if (!created || typeof created.id !== "string") return null;

  // Block Claude Code on the pet's decision. The GET resolves as soon as the broker
  // settles (a decision, or its dynamic 5-60s expiry), so a fixed poll only needs
  // to outlast the max window: 65s covers the 60s ceiling and keeps the broker the
  // single source of truth for the window — re-reading the setting here would race
  // the in-memory value the broker already baked in. Stays under the 75s hook
  // timeout (5s POST + 65s poll = 70s).
  const result = await httpJson({ path: `/permission/${created.id}`, method: "GET" }, undefined, 65000);
  if (result && (result.decision === "allow" || result.decision === "deny")) {
    return { decision: result.decision, reason: result.reason };
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function candidateSettingsPaths() {
  // The app's userData folder (productName). Settings live under this name.
  const appNames = ["DSH Desk"];
  const candidates = [cli.settingsPath, process.env.CHARA_DESK_SETTINGS_PATH];

  if (process.env.APPDATA) {
    for (const appName of appNames) candidates.push(join(process.env.APPDATA, appName, "companion-settings.json"));
  }

  if (process.platform === "darwin") {
    for (const appName of appNames) candidates.push(join(homedir(), "Library", "Application Support", appName, "companion-settings.json"));
  } else if (process.platform !== "win32") {
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    for (const appName of appNames) candidates.push(join(configHome, appName, "companion-settings.json"));
  }

  return unique(candidates);
}

function readCompanionSettings() {
  for (const candidate of candidateSettingsPaths()) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore corrupt or inaccessible settings. Hooks must never block Claude Code.
    }
  }

  return {};
}

function shouldAutoStartWithCli() {
  return readCompanionSettings().autoStartWithCli === true;
}

function directoryIfUsable(candidate) {
  try {
    return candidate && existsSync(candidate) && statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function appRoot() {
  return directoryIfUsable(cli.appRoot || process.env.CHARA_DESK_APP_ROOT) || directoryIfUsable(resolve(__dirname, "..")) || process.cwd();
}

function isElectronBinary(command) {
  const normalized = command.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/node_modules/electron/") || /(^|\/)electron(\.exe)?$/.test(normalized);
}

function launcherFromAppPath(root) {
  const command = cli.appPath || process.env.CHARA_DESK_APP_PATH;
  if (!command || !existsSync(command)) return null;

  return {
    command,
    args: isElectronBinary(command) ? [root] : [],
    cwd: root,
    shell: false
  };
}

function launcherFromLocalElectron(root) {
  const binPath = process.platform === "win32"
    ? join(root, "node_modules", ".bin", "electron.cmd")
    : join(root, "node_modules", ".bin", "electron");
  if (existsSync(binPath)) {
    return {
      command: binPath,
      args: [root],
      cwd: root,
      shell: process.platform === "win32"
    };
  }

  const unpackedPath = process.platform === "win32"
    ? join(root, "node_modules", "electron", "dist", "electron.exe")
    : process.platform === "darwin"
      ? join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
      : join(root, "node_modules", "electron", "dist", "electron");
  if (!existsSync(unpackedPath)) return null;

  return {
    command: unpackedPath,
    args: [root],
    cwd: root,
    shell: false
  };
}

function launcherFromNpmStart(root) {
  if (!existsSync(join(root, "package.json"))) return null;

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "start"],
    cwd: root,
    shell: process.platform === "win32"
  };
}

function resolveLauncher() {
  const root = appRoot();
  return launcherFromAppPath(root) || launcherFromLocalElectron(root) || launcherFromNpmStart(root);
}

function startCompanionApp() {
  const launcher = resolveLauncher();
  if (!launcher) return false;

  try {
    const child = spawn(launcher.command, launcher.args, {
      cwd: launcher.cwd,
      detached: true,
      env: { ...process.env, CHARA_DESK_PORT: String(eventPort) },
      shell: launcher.shell,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryPostPetEvent(event) {
  for (const waitMs of [300, 600, 900, 1200]) {
    await delay(waitMs);
    if (await postPetEvent(event, 1000)) return true;
  }
  return false;
}

async function main() {
  const payload = parsePayload(await readStdin());
  const hook = pickHookName(payload);

  // A permission gate blocks Claude Code until the user decides in the app.
  // On any failure we write nothing to stdout, so the CLI uses its native flow.
  if (isPermissionEvent(hook, payload)) {
    const decision = await requestPermissionDecision(payload);
    if (decision) process.stdout.write(formatPermissionDecision(decision.decision, decision.reason));
    return;
  }

  const event = { ...mapHookToPetEvent(hook, payload), hook, sessionId: pickSessionId(payload) };
  if (await postPetEvent(event)) return;
  if (!shouldAutoStartWithCli()) return;

  startCompanionApp();
  await retryPostPetEvent(event);
}

// Pure helpers are exported for unit tests; the CLI side effects only run when
// this file is invoked directly as a hook (`node hook-forwarder.js`).
module.exports = {
  mapHookToPetEvent,
  classifyNotification,
  isPermissionEvent,
  payloadIndicatesError,
  pickErrorMessage,
  pickToolName,
  pickToolDetail,
  pickSessionId
};

if (require.main === module) {
  main().finally(() => process.exit(0));
}

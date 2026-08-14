import { describe, it, expect } from "vitest";
import {
  evaluateHookConfig,
  isClawdHookCommand,
  isCurrentClawdCommand,
  stripClawdCommands,
  canonicalizeEventEntries,
  type ExpectedHookCommand
} from "../src/main/hookConfig";

const REQUIRED = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop"];
const PRETOOLUSE_TIMEOUT = 75;

const EXPECTED: ExpectedHookCommand = {
  forwarderPath: "/app/scripts/hook-forwarder.js",
  settingsPath: "/home/user/.claude/settings.json",
  appPath: "/opt/app/pet",
  appRoot: "/opt/app/resources/app",
  port: 17321
};

type Overrides = Partial<ExpectedHookCommand> & { timeout?: number };

// The full canonical command the app generates: every argument that affects
// operation is present, so a stale port/settings/app path can be detected.
function commandFor(eventName: string, overrides: Overrides = {}) {
  const e = { ...EXPECTED, ...overrides };
  return `node "${e.forwarderPath}" ${eventName} --settings "${e.settingsPath}" --app-path "${e.appPath}" --app-root "${e.appRoot}" --port ${e.port}`;
}

function clawdHook(eventName: string, overrides: Overrides = {}) {
  const hook: Record<string, unknown> = { type: "command", command: commandFor(eventName, overrides) };
  if (eventName === "PreToolUse") hook.timeout = overrides.timeout ?? PRETOOLUSE_TIMEOUT;
  return hook;
}

const thirdPartyHook = { type: "command", command: "node /other/vendor/tool.js" };

function entriesFor(eventName: string, overrides: Overrides = {}) {
  return [{ matcher: "*", hooks: [clawdHook(eventName, overrides)] }];
}

function fullSettings(overridesByEvent: Record<string, Overrides> = {}) {
  const hooks: Record<string, unknown> = {};
  for (const eventName of REQUIRED) hooks[eventName] = entriesFor(eventName, overridesByEvent[eventName]);
  return { hooks };
}

const baseOptions = { requiredEvents: REQUIRED, expected: EXPECTED, preToolUseEvent: "PreToolUse", preToolUseTimeout: PRETOOLUSE_TIMEOUT };

describe("evaluateHookConfig: completeness and currentness", () => {
  it("reports a complete, current configuration as installed", () => {
    const result = evaluateHookConfig(fullSettings(), baseOptions);
    expect(result.missingEvents).toEqual([]);
    expect(result.staleEvents).toEqual([]);
    expect(result.hookCount).toBe(6);
    expect(result.commandMatches).toBe(true);
    expect(result.installed).toBe(true);
  });

  it("lists exactly the events that have no Clawd command", () => {
    const settings = fullSettings();
    delete (settings.hooks as any).Notification;
    delete (settings.hooks as any).Stop;
    const result = evaluateHookConfig(settings, baseOptions);
    expect(result.missingEvents).toEqual(["Notification", "Stop"]);
    expect(result.hookCount).toBe(4);
    expect(result.installed).toBe(false);
  });

  it("detects an outdated forwarder path", () => {
    const result = evaluateHookConfig(fullSettings({ Stop: { forwarderPath: "/old/hook-forwarder.js" } }), baseOptions);
    expect(result.missingEvents).toEqual([]);
    expect(result.staleEvents).toEqual(["Stop"]);
    expect(result.commandMatches).toBe(false);
  });

  it("detects a wrong --port even when the forwarder path is current", () => {
    const result = evaluateHookConfig(fullSettings({ Stop: { port: 9999 } }), baseOptions);
    expect(result.missingEvents).toEqual([]);
    expect(result.staleEvents).toEqual(["Stop"]);
    expect(result.commandMatches).toBe(false);
  });

  it("detects a wrong --settings path", () => {
    const result = evaluateHookConfig(fullSettings({ PostToolUse: { settingsPath: "/wrong/settings.json" } }), baseOptions);
    expect(result.staleEvents).toEqual(["PostToolUse"]);
    expect(result.commandMatches).toBe(false);
  });

  it("detects an incorrect PreToolUse timeout", () => {
    const result = evaluateHookConfig(fullSettings({ PreToolUse: { timeout: 60 } }), baseOptions);
    expect(result.staleEvents).toEqual(["PreToolUse"]);
    expect(result.commandMatches).toBe(false);
  });

  it("treats empty or hookless settings as fully unconfigured", () => {
    expect(evaluateHookConfig({}, baseOptions)).toMatchObject({ hookCount: 0, commandMatches: false, installed: false });
    expect(evaluateHookConfig({ hooks: {} }, baseOptions).missingEvents).toEqual(REQUIRED);
    expect(evaluateHookConfig(null, baseOptions).installed).toBe(false);
  });
});

describe("evaluateHookConfig: duplicate / stale entries are not healthy", () => {
  it("flags an event that has a current AND a stale Clawd command", () => {
    const settings = fullSettings();
    (settings.hooks as any).Stop = [
      { matcher: "*", hooks: [clawdHook("Stop")] },
      { matcher: "*", hooks: [clawdHook("Stop", { forwarderPath: "/old/scripts/hook-forwarder.js" })] }
    ];
    const result = evaluateHookConfig(settings, baseOptions);
    expect(result.missingEvents).toEqual([]);
    expect(result.staleEvents).toEqual(["Stop"]);
    expect(result.commandMatches).toBe(false);
    expect(result.installed).toBe(false);
  });

  it("flags an event with two duplicate current Clawd commands", () => {
    const settings = fullSettings();
    (settings.hooks as any).Stop = [
      { matcher: "*", hooks: [clawdHook("Stop"), clawdHook("Stop")] }
    ];
    expect(evaluateHookConfig(settings, baseOptions).staleEvents).toEqual(["Stop"]);
  });

  it("ignores unrelated third-party hooks alongside a single current Clawd command", () => {
    const settings = fullSettings();
    (settings.hooks as any).Stop = [
      { matcher: "Bash", hooks: [thirdPartyHook] },
      { matcher: "*", hooks: [clawdHook("Stop")] }
    ];
    const result = evaluateHookConfig(settings, baseOptions);
    expect(result.staleEvents).toEqual([]);
    expect(result.commandMatches).toBe(true);
  });
});

describe("isCurrentClawdCommand", () => {
  it("accepts the current canonical command and rejects each drifted argument", () => {
    expect(isCurrentClawdCommand(commandFor("Stop"), "Stop", EXPECTED)).toBe(true);
    expect(isCurrentClawdCommand(commandFor("Stop", { port: 1 }), "Stop", EXPECTED)).toBe(false);
    expect(isCurrentClawdCommand(commandFor("Stop", { settingsPath: "/x/y.json" }), "Stop", EXPECTED)).toBe(false);
    expect(isCurrentClawdCommand(commandFor("Stop", { appPath: "/x/pet" }), "Stop", EXPECTED)).toBe(false);
    expect(isCurrentClawdCommand(commandFor("Stop", { appRoot: "/x/root" }), "Stop", EXPECTED)).toBe(false);
    expect(isCurrentClawdCommand(commandFor("Stop", { forwarderPath: "/x/hook-forwarder.js" }), "Stop", EXPECTED)).toBe(false);
    // Wrong event name entirely.
    expect(isCurrentClawdCommand(commandFor("Stop"), "PreToolUse", EXPECTED)).toBe(false);
  });
});

describe("isCurrentClawdCommand: duplicate critical flags are non-canonical", () => {
  // The forwarder runtime keeps the LAST occurrence of a duplicated flag, so a
  // first-match check could wrongly pass. A duplicate must require repair.
  function dupPort(first: number, last: number) {
    return `node "${EXPECTED.forwarderPath}" Stop --settings "${EXPECTED.settingsPath}" --app-path "${EXPECTED.appPath}" --app-root "${EXPECTED.appRoot}" --port ${first} --port ${last}`;
  }

  it("rejects a duplicated --port regardless of which value is correct", () => {
    expect(isCurrentClawdCommand(dupPort(17321, 9999), "Stop", EXPECTED)).toBe(false); // first correct, last wrong
    expect(isCurrentClawdCommand(dupPort(9999, 17321), "Stop", EXPECTED)).toBe(false); // first wrong, last correct
    expect(isCurrentClawdCommand(dupPort(17321, 17321), "Stop", EXPECTED)).toBe(false); // same value duplicated
  });

  it("surfaces a duplicated flag as a stale event in evaluateHookConfig", () => {
    const settings = fullSettings();
    (settings.hooks as any).Stop = [{ matcher: "*", hooks: [{ type: "command", command: dupPort(17321, 9999) }] }];
    expect(evaluateHookConfig(settings, baseOptions).staleEvents).toEqual(["Stop"]);
  });
});

describe("repair de-duplication (canonicalizeEventEntries / stripClawdCommands)", () => {
  it("strips every Clawd command while preserving third-party hooks and dropping empty entries", () => {
    const entries = [
      { matcher: "Bash", hooks: [thirdPartyHook, clawdHook("Stop")] },
      { matcher: "*", hooks: [clawdHook("Stop", { forwarderPath: "/old/hook-forwarder.js" })] }
    ];
    const stripped = stripClawdCommands(entries);
    expect(stripped).toEqual([{ matcher: "Bash", hooks: [thirdPartyHook] }]);
  });

  it("repairs an event to exactly one canonical Clawd command, keeping third-party hooks", () => {
    const canonical = { matcher: "*", hooks: [clawdHook("Stop")] };
    const entries = [
      { matcher: "Bash", hooks: [thirdPartyHook, clawdHook("Stop")] },
      { matcher: "*", hooks: [clawdHook("Stop", { port: 1 })] }
    ];
    const repaired = canonicalizeEventEntries(entries, canonical);

    // Third-party hook survives.
    const thirdPartyStillThere = repaired.some((e: any) => e.hooks.includes(thirdPartyHook));
    expect(thirdPartyStillThere).toBe(true);

    // Exactly one Clawd command remains, and the whole event now evaluates clean.
    const clawdCount = repaired.flatMap((e: any) => e.hooks).filter((h: any) => isClawdHookCommand(h?.command)).length;
    expect(clawdCount).toBe(1);
    expect(evaluateHookConfig({ hooks: { Stop: repaired } }, { ...baseOptions, requiredEvents: ["Stop"] }).commandMatches).toBe(true);
  });
});

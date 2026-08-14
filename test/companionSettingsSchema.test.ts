import { describe, expect, it } from "vitest";
import {
  CANONICAL_SETTINGS_KEYS,
  DEFAULT_COMPANION_SETTINGS,
  createDefaultCompanionSettings,
  pickCanonicalSettings
} from "../src/main/companionSettingsSchema";
import { defaultSettings } from "../src/renderer/shared/events";

// The canonical schema, spelled out. This list is the contract for what a
// persisted companion-settings.json may contain — adding or removing a
// settings field must update it deliberately.
const EXPECTED_CANONICAL_KEYS = [
  "hideSensitiveContent",
  "showBubbles",
  "editPosition",
  "alwaysOnTop",
  "clickThrough",
  "petEnabled",
  "petScale",
  "viewScale",
  "clawdScale",
  "clawdOpacity",
  "feedbackScale",
  "feedbackOpacity",
  "bubbleDuration",
  "permissionScale",
  "toolStreamMinDuration",
  "showStatusProp",
  "permissionDialogEnabled",
  "permissionWaitSeconds",
  "mainClawdIdleAnimation",
  "launchAtLogin",
  "openSettingsOnStart",
  "autoStartWithCli",
  "autoUpdateEnabled",
  "petTheme",
  "enabledSources",
  "notificationsEnabled",
  "theme",
  "uiStyle",
  "language",
  "displayCurrency",
  "notificationRules",
  "customPlugins",
  "sound",
  "eventHistoryLimit",
  "claudeProviders",
  "currentClaudeProviderId",
  "idleAnim",
  "stateAnimations",
  "themeAnimationProfiles",
  "positionOffsets"
];

describe("canonical settings schema", () => {
  it("matches the expected canonical key list exactly", () => {
    expect([...CANONICAL_SETTINGS_KEYS].sort()).toEqual([...EXPECTED_CANONICAL_KEYS].sort());
  });

  it("keeps the defaults fully canonical (filtering them is a no-op)", () => {
    expect(pickCanonicalSettings(createDefaultCompanionSettings())).toEqual(DEFAULT_COMPANION_SETTINGS);
  });

  it("covers every key the renderer defaults can persist", () => {
    const unknownRendererKeys = Object.keys(defaultSettings).filter(key => !CANONICAL_SETTINGS_KEYS.has(key));
    expect(unknownRendererKeys).toEqual([]);
  });

  it("hands out independent default copies", () => {
    const copy = createDefaultCompanionSettings();
    copy.sound.volume = 0;
    copy.notificationRules.push({ eventType: "heartbeat", enabled: false, playSound: false });
    expect(DEFAULT_COMPANION_SETTINGS.sound.volume).toBe(0.6);
    expect(DEFAULT_COMPANION_SETTINGS.notificationRules).toHaveLength(4);
  });
});

describe("pickCanonicalSettings", () => {
  it("drops unknown top-level keys so they are never re-persisted", () => {
    expect(pickCanonicalSettings({ petScale: 1.2, mysteryKnob: true, obsoleteField: "x" })).toEqual({ petScale: 1.2 });
  });

  it("keeps runtime-persisted keys that have no seeded default", () => {
    const picked = pickCanonicalSettings({
      positionOffsets: { clawd: { x: 1, y: 2 } },
      claudeProviders: { demo: { id: "demo", name: "Demo", settingsConfig: {} } },
      currentClaudeProviderId: "demo"
    });
    expect(picked).toEqual({
      positionOffsets: { clawd: { x: 1, y: 2 } },
      claudeProviders: { demo: { id: "demo", name: "Demo", settingsConfig: {} } },
      currentClaudeProviderId: "demo"
    });
  });

  it("reduces the sound object to its known keys while keeping custom event audio", () => {
    const picked = pickCanonicalSettings({
      sound: {
        enabled: true,
        volume: 0.4,
        fileDone: null,
        fileError: "err.mp3",
        filePermission: null,
        eventFiles: { done: "done.mp3", session_start: "start.mp3" },
        extraChannel: "x"
      }
    });
    expect(picked.sound).toEqual({
      enabled: true,
      volume: 0.4,
      fileDone: null,
      fileError: "err.mp3",
      filePermission: null,
      eventFiles: { done: "done.mp3", session_start: "start.mp3" }
    });
  });

  it("reduces notification rules to their known keys without dropping entries", () => {
    const picked = pickCanonicalSettings({
      notificationRules: [
        { eventType: "done", enabled: true, playSound: false, extraFlag: 1 },
        "malformed-entry"
      ]
    });
    expect(picked.notificationRules).toEqual([
      { eventType: "done", enabled: true, playSound: false },
      "malformed-entry"
    ]);
  });
});

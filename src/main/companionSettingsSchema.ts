/**
 * Canonical companion-settings schema.
 *
 * DEFAULT_COMPANION_SETTINGS is the single source of truth for which fields
 * exist in the settings model. A persisted companion-settings.json may only
 * contain canonical keys: pickCanonicalSettings() ignores everything else on
 * load and on save-merge, so unknown keys are never re-persisted.
 */

export const DEFAULT_COMPANION_SETTINGS: Record<string, any> = {
  hideSensitiveContent: false,
  showBubbles: true,
  editPosition: false,
  alwaysOnTop: true,
  clickThrough: false,
  petEnabled: true,
  petScale: 1,
  viewScale: 1,
  clawdScale: 0.8,
  clawdOpacity: 1,
  feedbackScale: 1,
  feedbackOpacity: 1,
  bubbleDuration: 8,
  permissionScale: 0.9,
  toolStreamMinDuration: 0.8,
  showStatusProp: true,
  permissionDialogEnabled: true,
  permissionWaitSeconds: 30,
  mainClawdIdleAnimation: "random",
  launchAtLogin: false,
  openSettingsOnStart: true,
  autoStartWithCli: false,
  autoUpdateEnabled: false,
  petTheme: "minato-aqua",
  enabledSources: ["deepseek-harness"],
  notificationsEnabled: true,
  theme: "system",
  uiStyle: "classic",
  language: "zh",
  displayCurrency: "CNY",
  notificationRules: [
    { eventType: "done", enabled: true, playSound: true },
    { eventType: "error", enabled: true, playSound: true },
    { eventType: "permission_wait", enabled: true, playSound: true },
    { eventType: "notification", enabled: true, playSound: false }
  ],
  customPlugins: [],
  sound: {
    enabled: true,
    volume: 0.6,
    fileDone: null,
    fileError: null,
    filePermission: null,
    eventFiles: {}
  },
  eventHistoryLimit: 100,
  claudeProviders: {
    "claude-official": {
      id: "claude-official",
      name: "Claude Official",
      category: "official",
      websiteUrl: "https://www.anthropic.com/claude-code",
      icon: "anthropic",
      iconColor: "#d97757",
      sortIndex: 0,
      settingsConfig: { env: {} }
    },
    "anyrouter": {
      id: "anyrouter",
      name: "anyrouter",
      category: "third_party",
      websiteUrl: "https://anyrouter.top",
      iconColor: "#f97316",
      sortIndex: 1,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://anyrouter.top" } }
    },
    "hkc": {
      id: "hkc",
      name: "神秘大佬",
      category: "third_party",
      websiteUrl: "https://hkcn2.dpdns.org/api",
      iconColor: "#f97316",
      sortIndex: 2,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://hkcn2.dpdns.org/api" } }
    },
    "micuai-free2": {
      id: "micuai-free2",
      name: "米醋_free2",
      category: "third_party",
      websiteUrl: "https://api-slb.micuapi.ai",
      iconColor: "#f97316",
      sortIndex: 3,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://api-slb.micuapi.ai" } }
    },
    "micuai-max": {
      id: "micuai-max",
      name: "米醋_max",
      category: "third_party",
      websiteUrl: "https://www.openclaudecode.cn",
      iconColor: "#f97316",
      sortIndex: 4,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://www.openclaudecode.cn" } }
    }
  },
  currentClaudeProviderId: "claude-official",
  idleAnim: {
    enabled: true,
    selectedSprites: ["idle", "running", "waiting_permission", "done", "extra_action_7", "extra_action_8", "extra_action_aqua_bocchi"],
    intervalMin: 12,
    intervalMax: 28
  },
  stateAnimations: {},
  // Per-theme snapshots of stateAnimations + idleAnim, keyed by theme id.
  // The active fields above stay the single runtime source; switching themes
  // swaps them through this store (src/main/themeProfiles.ts).
  themeAnimationProfiles: {}
};

// Keys that may legitimately appear in a persisted settings file. Everything
// in the defaults is canonical, plus fields the renderer persists at runtime
// without having a main-process default.
export const CANONICAL_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(DEFAULT_COMPANION_SETTINGS),
  "positionOffsets"
]);

const SOUND_SETTINGS_KEYS = new Set(["enabled", "volume", "fileDone", "fileError", "filePermission", "eventFiles"]);
const NOTIFICATION_RULE_KEYS = new Set(["eventType", "enabled", "playSound"]);
const IDLE_ANIMATION_KEYS = new Set(["enabled", "selectedSprites", "intervalMin", "intervalMax"]);

function pickIdleAnimation(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => IDLE_ANIMATION_KEYS.has(key))
  );
}

/**
 * Reduce a parsed settings object to the canonical schema. Unknown top-level
 * keys are dropped, and nested structures with fixed shapes are reduced to
 * their known keys. Values are not
 * validated here — numeric display fields go through
 * normalizePetDisplaySettings and everything else is read defensively at its
 * point of use.
 */
export function pickCanonicalSettings(parsed: Record<string, unknown>): Record<string, unknown> {
  const canonical = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => CANONICAL_SETTINGS_KEYS.has(key))
  );
  const sound = canonical.sound;
  if (sound && typeof sound === "object" && !Array.isArray(sound)) {
    canonical.sound = Object.fromEntries(
      Object.entries(sound as Record<string, unknown>).filter(([key]) => SOUND_SETTINGS_KEYS.has(key))
    );
  }
  if (Array.isArray(canonical.notificationRules)) {
    canonical.notificationRules = canonical.notificationRules.map(rule =>
      rule && typeof rule === "object" && !Array.isArray(rule)
        ? Object.fromEntries(Object.entries(rule as Record<string, unknown>).filter(([key]) => NOTIFICATION_RULE_KEYS.has(key)))
        : rule
    );
  }
  if ("idleAnim" in canonical) canonical.idleAnim = pickIdleAnimation(canonical.idleAnim);
  if (canonical.themeAnimationProfiles && typeof canonical.themeAnimationProfiles === "object" && !Array.isArray(canonical.themeAnimationProfiles)) {
    canonical.themeAnimationProfiles = Object.fromEntries(
      Object.entries(canonical.themeAnimationProfiles as Record<string, unknown>).map(([themeId, profile]) => {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return [themeId, profile];
        const next = { ...(profile as Record<string, unknown>) };
        if ("idleAnim" in next) next.idleAnim = pickIdleAnimation(next.idleAnim);
        return [themeId, next];
      })
    );
  }
  return canonical;
}

/** Fresh deep copy so runtime mutation never leaks into the shared defaults. */
export function createDefaultCompanionSettings(): Record<string, any> {
  return JSON.parse(JSON.stringify(DEFAULT_COMPANION_SETTINGS)) as Record<string, any>;
}

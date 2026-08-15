import { isSessionStartEvent, type PetEvent } from "../shared/events";
import {
  createEmptyClaudeProfilesSnapshot,
  getClaudeProfileDrift,
  snapshotAfterClaudeProfileApply,
  snapshotAfterClaudeProfileResourceState,
  type ClaudeProfileMutationResult,
  type ClaudeProfilePreviewResult,
  type ClaudeProfileResourceStateInput,
  type ClaudeProfileSaveInput,
  type ClaudeProfilesSnapshot,
  type ClaudeResourcesSnapshot
} from "../shared/claudeProfiles";
import type { HookStatus, HookOperationResult } from "../shared/hooks";
import type { PetPackManifest } from "../shared/petPack";
import type { PetPackDownloadProgress, PetPackDownloadResult, PetPackInspectResult, PetPackInstallResult, PetPackRemoveResult } from "../shared/petPackTransport";
import type { DshProvider, DshProviderListResult, DshProviderMutationResult, DshProviderProbeResult, DshProviderProtocol, DshProviderSaveInput, DshProviderSwitchResult } from "../shared/dshProviders";
import type { DshAnalyticsSnapshot } from "../shared/dshAnalytics";
import type {
  DshMarketplaceSnapshot,
  DshMarketplaceSkill,
  DshPluginInstallInput,
  DshPluginMutationResult,
  DshPluginRemoveInput,
  DshPluginSnapshot,
  DshPluginStateInput,
  DshSkillInstallResult,
  DshSkillMarketplaceSnapshot,
  DshSkillRepo,
  DshSkillRepoMutationResult,
  DshSkillSnapshot
} from "../shared/dshPlugins";
import type {
  DshResourceMutationResult,
  DshResourceSchemeSaveInput,
  DshResourceSchemesSnapshot,
  DshResourceStateInput
} from "../shared/dshResources";
import { createEmptyDshResourceSchemesSnapshot } from "../shared/dshResources";
import {
  defaultSettings,
  defaultStats,
  type AppStats,
  type ClaudeProviderConfig,
  type ClaudeProviderListResult,
  type ClaudeProviderSaveResult,
  type ClaudeProviderSwitchResult,
  type ClaudeProviderTestResult,
  type ClaudeProviderModelsResult,
  type CompanionConnectionStatus,
  type CompanionEvent,
  type CompanionEventType,
  type CompanionInitialState,
  type CompanionSettings,
  type EventHistoryEntry,
  type PermissionRequest,
  type PluginMarketIndex,
  type PluginRunRecord,
  type ProviderId,
  type SessionHistory,
  type TokenStats,
  type ToolName,
  type UpdateStatus
} from "./shared/events";

type Unsubscribe = () => void;
type Listener<T> = (payload: T) => void;

type PetApi = NonNullable<Window["petAPI"]>;

type CompanionApi = {
  initialState: CompanionInitialState;
  notifyPetRendered?: () => void;
  getSettings: () => Promise<CompanionSettings>;
  saveSettings: (next: Partial<CompanionSettings>) => Promise<CompanionSettings>;
  getConnectionStatus: () => Promise<CompanionConnectionStatus>;
  checkHooks: (provider?: ProviderId) => Promise<HookStatus>;
  installHooks: (provider?: ProviderId) => Promise<HookOperationResult>;
  repairHooks: (provider?: ProviderId) => Promise<HookOperationResult>;
  removeHooks: (provider?: ProviderId) => Promise<HookOperationResult>;
  openSettings: () => Promise<void>;
  minimizeSettings: () => Promise<void>;
  toggleMaximizeSettings: () => Promise<void>;
  closeSettings: () => Promise<void>;
  onEvent: (callback: Listener<CompanionEvent>) => Unsubscribe;
  onSettings: (callback: Listener<CompanionSettings>) => Unsubscribe;
  onConnection: (callback: Listener<CompanionConnectionStatus>) => Unsubscribe;
  setPetInteractive: (interactive: boolean) => Promise<void>;
  updatePermissionCardRect: (rect: unknown) => Promise<void>;
  onPetDragDirection: (callback: Listener<"left" | "right" | null>) => Unsubscribe;
  onTrayMenuState: (callback: Listener<unknown>) => Unsubscribe;
  trayMenuReady: () => Promise<unknown>;
  trayMenuRendered: () => Promise<void>;
  trayMenuAction: (action: string) => Promise<void>;
  onPermissionRequest: (callback: Listener<PermissionRequest>) => Unsubscribe;
  onPermissionResolved: (callback: Listener<{ id: string }>) => Unsubscribe;
  respondPermission: (response: { id: string; decision: "allow" | "deny"; reason?: string }) => Promise<void>;
  checkForUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<void>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  getAppVersion: () => Promise<string>;
  getTokenStats: (force?: boolean) => Promise<TokenStats>;
  getDshAnalytics: (force?: boolean) => Promise<DshAnalyticsSnapshot>;
  getRecentEdits: (force?: boolean) => Promise<unknown>;
  getUsageRankings: (force?: boolean) => Promise<unknown>;
  previewSound: (name: "done" | "error" | "permission") => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  getDefaultSoundPaths: () => Promise<Record<string, string | null>>;
  previewSoundFile: (path: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  pickSoundFile: () => Promise<string | null>;
  previewPetAnimation: (animationKey: string) => Promise<boolean>;
  syncIdleBubble: (payload: unknown) => Promise<void>;
  onIdleBubbleSync: (callback: Listener<unknown>) => Unsubscribe;
  onPreviewPetAnimation: (callback: Listener<string>) => Unsubscribe;
  getEventHistory: () => Promise<EventHistoryEntry[]>;
  getSessionHistory: () => Promise<SessionHistory[]>;
  clearEventHistory: () => Promise<void>;
  exportEventHistoryFile: () => Promise<void>;
  getDataDirectory: () => Promise<string>;
  openDataDirectory: () => Promise<{ ok: boolean; error?: string }>;
  revealDshSession: (filePath: string) => Promise<boolean>;
  getMonitors: () => Promise<unknown[]>;
  getPlugins: () => Promise<unknown[]>;
  listDshPlugins: () => Promise<DshPluginSnapshot>;
  getDshPluginMarketplace: (force?: boolean) => Promise<DshMarketplaceSnapshot>;
  setDshPluginEnabled: (input: DshPluginStateInput) => Promise<DshPluginMutationResult>;
  installDshMarketplacePlugin: (input: DshPluginInstallInput) => Promise<DshPluginMutationResult>;
  removeDshPluginPackage: (input: DshPluginRemoveInput) => Promise<DshPluginMutationResult>;
  listDshSkills: () => Promise<DshSkillSnapshot>;
  getDshResourceSchemes: () => Promise<DshResourceSchemesSnapshot>;
  saveDshResourceScheme: (input: DshResourceSchemeSaveInput) => Promise<DshResourceMutationResult>;
  deleteDshResourceScheme: (schemeId: string) => Promise<DshResourceMutationResult>;
  applyDshResourceScheme: (schemeId: string) => Promise<DshResourceMutationResult>;
  setDshResourceState: (input: DshResourceStateInput) => Promise<DshResourceMutationResult>;
  onDshResourcesUpdated: (callback: Listener<void>) => Unsubscribe;
  getDshSkillMarketplace: (force?: boolean) => Promise<DshSkillMarketplaceSnapshot>;
  addDshSkillRepo: (repo: DshSkillRepo) => Promise<DshSkillRepoMutationResult>;
  removeDshSkillRepo: (owner: string, name: string) => Promise<DshSkillRepoMutationResult>;
  installDshSkill: (skill: DshMarketplaceSkill) => Promise<DshSkillInstallResult>;
  revealDshSkill: (path: string) => Promise<boolean>;
  getClaudeResources: (force?: boolean) => Promise<ClaudeResourcesSnapshot>;
  getClaudeProfiles: (force?: boolean) => Promise<ClaudeProfilesSnapshot>;
  saveClaudeProfile: (input: ClaudeProfileSaveInput) => Promise<ClaudeProfileMutationResult>;
  deleteClaudeProfile: (profileId: string) => Promise<ClaudeProfileMutationResult>;
  previewClaudeProfile: (profileId: string) => Promise<ClaudeProfilePreviewResult>;
  applyClaudeProfile: (profileId: string) => Promise<ClaudeProfileMutationResult>;
  setClaudeProfileResourceState: (input: ClaudeProfileResourceStateInput) => Promise<ClaudeProfileMutationResult>;
  getClaudeSessions: (force?: boolean) => Promise<unknown>;
  onSessionsUpdated: (callback: Listener<unknown>) => Unsubscribe;
  getClaudeSessionDetail: (filePath: string) => Promise<unknown>;
  resumeClaudeSession: (sessionId: string, projectPath?: string) => Promise<unknown>;
  openClaudeResource: (path: string) => Promise<void>;
  getPluginRuns: () => Promise<PluginRunRecord[]>;
  runPluginNow: (pluginId: string) => Promise<void>;
  openPluginDataDir: (pluginId: string) => Promise<void>;
  getPluginMarket: () => Promise<PluginMarketIndex>;
  installMarketPlugin: (pluginId: string) => Promise<void>;
  savePlugins: (plugins: unknown[]) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getStats: () => Promise<AppStats>;
  resetStats: () => Promise<void>;
  exportSettingsFile: () => Promise<void>;
  importSettingsFile: () => Promise<CompanionSettings | null>;
  exportStatsFile: () => Promise<void>;
  importStatsFile: () => Promise<AppStats | null>;
  onUpdateStatus: (callback: Listener<UpdateStatus>) => Unsubscribe;
  onPlaySound: (callback: Listener<string>) => Unsubscribe;
  onOpenSection: (callback: Listener<string>) => Unsubscribe;
  listClaudeProviders: () => Promise<ClaudeProviderListResult>;
  saveClaudeProvider: (provider: ClaudeProviderConfig, originalId?: string) => Promise<ClaudeProviderSaveResult>;
  deleteClaudeProvider: (id: string) => Promise<{ ok: boolean; error?: string }>;
  duplicateClaudeProvider: (id: string) => Promise<ClaudeProviderSaveResult>;
  reorderClaudeProviders: (orderedIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  switchClaudeProvider: (id: string) => Promise<ClaudeProviderSwitchResult>;
  testClaudeProvider: (payload: { id?: string; baseUrl?: string }) => Promise<ClaudeProviderTestResult>;
  fetchClaudeProviderModels: (payload: { baseUrl?: string; apiKey?: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }) => Promise<ClaudeProviderModelsResult>;
  listDshProviders: () => Promise<DshProviderListResult>;
  saveDshProvider: (provider: DshProviderSaveInput) => Promise<DshProviderMutationResult>;
  deleteDshProvider: (id: string) => Promise<DshProviderMutationResult>;
  duplicateDshProvider: (id: string) => Promise<DshProviderMutationResult>;
  reorderDshProviders: (ids: string[]) => Promise<DshProviderMutationResult>;
  setDshProviderEnabled: (id: string, enabled: boolean) => Promise<DshProviderMutationResult>;
  switchDshProvider: (id: string, model?: string) => Promise<DshProviderSwitchResult>;
  probeDshProvider: (payload: { id?: string; baseUrl?: string; protocol?: DshProviderProtocol | "deepseek-chat-completions"; apiKey?: string; mode?: "connectivity" | "models" }) => Promise<DshProviderProbeResult>;
  openClaudeProviderTerminal: (providerId: string, cwd: string) => Promise<{ ok: boolean; command: string; error?: string }>;
  pickTerminalDirectory: () => Promise<string | null>;
  onCcSwitchChanged: (callback: Listener<unknown>) => Unsubscribe;
  pickPetPackFile: () => Promise<string | null>;
  inspectPetPack: (zipPath: string) => Promise<PetPackInspectResult>;
  installPetPack: (zipPath: string, rowFrameCounts: number[], packageSha256: string, overwrite?: boolean) => Promise<PetPackInstallResult>;
  listPetPacks: () => Promise<PetPackManifest[]>;
  removePetPack: (id: string) => Promise<PetPackRemoveResult>;
  onPetPacksChanged: (callback: Listener<unknown>) => Unsubscribe;
  /** Absolute path of a dropped File (Electron webUtils); "" in the browser. */
  getPetPackFilePath: (file: File) => string;
  downloadPetPack: (petSlug: string) => Promise<PetPackDownloadResult>;
  discardPetPackDownload: (zipPath: string) => Promise<{ ok: boolean }>;
  onPetPackDownloadProgress: (callback: Listener<PetPackDownloadProgress>) => Unsubscribe;
};

declare global {
  interface Window {
    companion: CompanionApi;
  }
}

const sessionId = "local-pet-session";
const missingHookEvents = ["web", "headless"] as const;
const currentSettings: CompanionSettings = {
  ...defaultSettings,
  language: "zh",
  enabledSources: ["deepseek-harness"],
  petTheme: "minato-aqua",
  openSettingsOnStart: true
};

let mockClaudeProfiles: ClaudeProfilesSnapshot = createEmptyClaudeProfilesSnapshot(Date.now());

function updateMockClaudeDrift() {
  mockClaudeProfiles = {
    ...mockClaudeProfiles,
    drift: getClaudeProfileDrift(mockClaudeProfiles, mockClaudeProfiles.inventory, mockClaudeProfiles.mcpStatus)
  };
}

function sameProfileMembership(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const members = new Set(right);
  return left.every(id => members.has(id));
}

let eventHistory: EventHistoryEntry[] = [];
let statsHistory: EventHistoryEntry[] = [];
let startedAt = Date.now();
let eventPort = 17321;
let lastEvent: CompanionEvent | null = null;

const mockProviders: Record<string, ClaudeProviderConfig> = {
  "claude-official": {
    id: "claude-official",
    name: "Claude Official",
    category: "official",
    websiteUrl: "https://www.anthropic.com/claude-code",
    icon: "anthropic",
    iconColor: "#D4915D",
    sortIndex: 0,
    settingsConfig: { env: {} }
  },
  "demo-third-party": {
    id: "demo-third-party",
    name: "Demo Router",
    category: "third_party",
    websiteUrl: "https://example.com",
    sortIndex: 1,
    settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://api.example.com", ANTHROPIC_AUTH_TOKEN: "sk-demo" } }
  }
};
let mockCurrentProviderId = "claude-official";
const mockDshProviders: DshProvider[] = [{
  id: "deepseek-official",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  protocol: "deepseek-chat-completions",
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1_000_000 },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1_000_000 }
  ],
  modelsInherited: true,
  catalogProvider: true,
  enabled: true,
  runtimeActive: true,
  credentialRef: "DEEPSEEK_API_KEY",
  hasCredential: false,
  isOfficial: true,
  isDefault: true,
  defaultModel: "deepseek-v4-flash"
}];
let mockDshPluginSnapshot: DshPluginSnapshot = {
  profiles: [
    { name: "web", label: "Web", exists: true },
    { name: "headless", label: "Headless", exists: true }
  ],
  plugins: [{
    packageName: "@deepseek-ai/dsh-base",
    name: "DSH Base",
    description: "DeepSeek Harness core services",
    kind: "builtin",
    protected: true,
    states: [
      { profile: "web", enabled: true, materialized: true, bundleCapable: true },
      { profile: "headless", enabled: true, materialized: true, bundleCapable: true }
    ]
  }, {
    packageName: "dsh-desk-plugin",
    name: "DSH Desk Bridge",
    description: "Connects DeepSeek Harness events to DSH Desk",
    version: "0.1.0",
    kind: "desk",
    protected: true,
    states: [
      { profile: "web", dependencySpec: "link:dsh-plugin", enabled: true, materialized: true, bundleCapable: true },
      { profile: "headless", dependencySpec: "link:dsh-plugin", enabled: true, materialized: true, bundleCapable: true }
    ]
  }, {
    packageName: "dsh-plugin-hub",
    name: "dsh-plugin-hub",
    description: "Browse and manage community extensions inside DSH Web",
    version: "1.4.2",
    homepage: "https://github.com/Noob-stupid/dsh-plugin-hub",
    kind: "plugin",
    protected: false,
    states: [
      { profile: "web", dependencySpec: "github:Noob-stupid/dsh-plugin-hub", enabled: true, materialized: true, bundleCapable: true },
      { profile: "headless", enabled: false, materialized: false, bundleCapable: null }
    ]
  }],
  dshHome: "~/.dsh",
  npxAvailable: true,
  scannedAt: Date.now()
};
const mockDshMarketplace: DshMarketplaceSnapshot = {
  source: "remote",
  sourceName: "awesome-dsh-plugin",
  sourceUrl: "https://awesome-dsh-plugin.com/plugins.json",
  updatedAt: "2026-08-14",
  fetchedAt: Date.now(),
  categories: [
    { id: "tool", en: "Tools", zh: "工具" },
    { id: "ui", en: "Interface", zh: "界面" },
    { id: "skill", en: "Skills", zh: "技能" }
  ],
  plugins: [{
    id: "https://github.com/omdsh-dev/dsh-at-file",
    name: "dsh-at-file",
    owner: "omdsh-dev",
    packageName: "dsh-at-file",
    repositoryUrl: "https://github.com/omdsh-dev/dsh-at-file",
    category: "tool",
    description: { en: "Reference files naturally with @ mentions.", zh: "使用 @ 快速引用工作区文件。" },
    installSpec: "github:omdsh-dev/dsh-at-file",
    stars: 128,
    added: "2026-08-13"
  }, {
    id: "https://github.com/Nagi-ovo/dsh-visualize",
    name: "dsh-visualize",
    owner: "Nagi-ovo",
    packageName: "dsh-visualize",
    repositoryUrl: "https://github.com/Nagi-ovo/dsh-visualize",
    category: "ui",
    description: { en: "Visualize tool execution and agent progress.", zh: "可视化工具执行与 Agent 进度。" },
    installSpec: "github:Nagi-ovo/dsh-visualize",
    stars: 84,
    added: "2026-08-13"
  }, {
    id: "https://github.com/demo/dsh-skill-kit",
    name: "dsh-skill-kit",
    owner: "demo",
    packageName: "dsh-skill-kit",
    repositoryUrl: "https://github.com/demo/dsh-skill-kit",
    category: "skill",
    description: { en: "Reusable skill workflows for DSH.", zh: "适用于 DSH 的可复用 Skill 工作流。" },
    installSpec: "github:demo/dsh-skill-kit",
    stars: 37,
    added: "2026-08-12"
  }]
};
const mockDshSkills: DshSkillSnapshot = {
  roots: [
    { source: "user-dsh", path: "~/.dsh/skills" },
    { source: "user-agents", path: "~/.agents/skills" }
  ],
  skills: [{
    id: "user-dsh:review",
    name: "review",
    description: "Review changes for correctness and regression risk.",
    path: "~/.dsh/skills/review/SKILL.md",
    directory: "~/.dsh/skills/review",
    source: "user-dsh",
    active: true,
    enabled: true,
    manageable: true,
    storageName: "review",
    storagePath: "~/.dsh/skills/review",
    modelInvocable: true,
    userInvocable: true
  }, {
    id: "user-agents:release-notes",
    name: "release-notes",
    description: "Prepare concise release notes from repository history.",
    path: "~/.agents/skills/release-notes/SKILL.md",
    directory: "~/.agents/skills/release-notes",
    source: "user-agents",
    active: true,
    enabled: true,
    manageable: false,
    storageName: "release-notes",
    storagePath: "~/.agents/skills/release-notes",
    modelInvocable: false,
    userInvocable: true
  }],
  scannedAt: Date.now()
};
let mockDshResourceSchemes: DshResourceSchemesSnapshot = {
  ...createEmptyDshResourceSchemesSnapshot(Date.now()),
  schemes: createEmptyDshResourceSchemesSnapshot().schemes.map(scheme => ({
    ...scheme,
    skills: mockDshSkills.skills.map(skill => skill.id),
    plugins: mockDshPluginSnapshot.plugins.map(plugin => `plugin:package:${plugin.packageName}`)
  })),
  inventory: {
    skills: mockDshSkills.skills.map(skill => ({ id: skill.id, kind: "skill", name: skill.name, description: skill.description, enabled: skill.active, manageable: skill.manageable })),
    plugins: mockDshPluginSnapshot.plugins.map(plugin => ({ id: `plugin:package:${plugin.packageName}`, kind: "plugin", name: plugin.name, description: plugin.description, enabled: plugin.states.some(state => state.enabled), manageable: false })),
    scannedAt: Date.now(),
    runtimeConnected: false
  }
};
let mockDshSkillMarketplace: DshSkillMarketplaceSnapshot = {
  repos: [{ owner: "anthropics", name: "skills", branch: "main", enabled: true }],
  skills: [{
    key: "anthropics/skills:skills/frontend-design",
    name: "frontend-design",
    description: "Build polished frontend interfaces.",
    directory: "skills/frontend-design",
    readmeUrl: "https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md",
    repoOwner: "anthropics",
    repoName: "skills",
    repoBranch: "main",
    stars: 0,
    installed: false
  }],
  scannedAt: Date.now(),
  errors: []
};

const settingsListeners = new Set<Listener<CompanionSettings>>();
const connectionListeners = new Set<Listener<CompanionConnectionStatus>>();
const companionEventListeners = new Set<Listener<CompanionEvent>>();
const permissionRequestListeners = new Set<Listener<PermissionRequest>>();
const permissionResolvedListeners = new Set<Listener<{ id: string }>>();
const idleBubbleSyncListeners = new Set<Listener<unknown>>();
const previewPetAnimationListeners = new Set<Listener<string>>();
const updateStatusListeners = new Set<Listener<UpdateStatus>>();
const playSoundListeners = new Set<Listener<string>>();
const openSectionListeners = new Set<Listener<string>>();

function subscribe<T>(listeners: Set<Listener<T>>, callback: Listener<T>): Unsubscribe {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit<T>(listeners: Set<Listener<T>>, payload: T) {
  listeners.forEach(listener => listener(payload));
}

function normalizeTool(tool?: string): ToolName {
  if (!tool) return "Unknown";
  const normalized = tool.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("pwsh") || normalized.includes("powershell")) return "Bash";
  if (normalized.includes("edit") || normalized.includes("replace")) return "Edit";
  if (normalized.includes("write")) return "Write";
  if (normalized.includes("read")) return "Read";
  if (normalized.includes("grep")) return "Grep";
  if (normalized.includes("glob")) return "Glob";
  if (normalized.includes("webfetch")) return "WebFetch";
  if (normalized.includes("websearch") || normalized.includes("search")) return "WebSearch";
  if (normalized.includes("notebook")) return "Notebook";
  if (normalized.includes("agent")) return "Agent";
  if (normalized.includes("skill")) return "Skill";
  if (normalized.includes("task") || normalized.includes("todo")) return "Task";
  if (normalized.includes("mcp")) return "MCP";
  return "Unknown";
}

function localDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toCompanionEvent(event: PetEvent): CompanionEvent {
  const mappedEvent: CompanionEventType = event.notificationKind === "attention" || event.notificationKind === "info"
    // Display-only "notification" events; the panel treats "info" as transient.
    ? "notification"
    : event.event === "idle"
    // Only the SessionStart hook's idle marks a real session; an idle-prompt
    // Notification must not be counted as a new session.
    ? (isSessionStartEvent(event) ? "session_start" : "heartbeat")
    : event.event === "permission-prompt"
      ? "permission_wait"
    : event.event === "completed"
      ? "done"
      : event.event === "error"
        ? "error"
        : event.tool
          ? "tool_start"
          : "prompt_submit";

  return {
    id: event.id,
    source: event.source ?? "manual",
    event: mappedEvent,
    sessionId: event.sessionId ?? sessionId,
    clientType: event.source === "deepseek-harness" ? "cli" : "desktop",
    clientLabel: event.source === "deepseek-harness" ? "DeepSeek Harness" : "DSH Desk",
    tool: event.tool ? normalizeTool(event.tool) : undefined,
    notificationKind: event.notificationKind,
    title: event.title ?? event.event,
    message: event.message ?? event.detail ?? event.title ?? event.event,
    detail: event.detail,
    timestamp: event.timestamp
  };
}

function currentConnection(): CompanionConnectionStatus {
  return {
    port: eventPort,
    serverListening: true,
    activeSessionId: sessionId,
    activeClientType: "desktop",
    activeClientLabel: "DSH Desk",
    lastEventAt: lastEvent?.timestamp,
    lastEventTitle: lastEvent?.title,
    lastEventType: lastEvent?.event,
    lastEventSource: lastEvent?.source
  };
}

function applyCompanionEvent(event: CompanionEvent) {
  lastEvent = event;
  const entry = { id: event.id, event, timestamp: event.timestamp };
  eventHistory = [entry, ...eventHistory].slice(0, currentSettings.eventHistoryLimit);
  statsHistory = [entry, ...statsHistory].slice(0, currentSettings.eventHistoryLimit);
  emit(companionEventListeners, event);
  emit(connectionListeners, currentConnection());

  if (event.event === "permission_wait") {
    emit(permissionRequestListeners, {
      id: event.id,
      toolName: event.tool ?? "Unknown",
      toolDetail: event.detail ?? event.message,
      sessionId,
      timestamp: event.timestamp,
      rawPayload: {}
    });
  }
}

function buildStats(): AppStats {
  const stats: AppStats = {
    ...defaultStats,
    toolUsage: {},
    eventTypeCounts: {},
    dailyStats: {},
    hourlyActivity: new Array(24).fill(0),
    dailyHourlyActivity: {},
    dailyToolUsage: {},
    firstStartTime: startedAt,
    lastEventTime: lastEvent?.timestamp ?? 0,
    totalRuntime: Math.max(0, Date.now() - startedAt)
  };

  for (const entry of statsHistory) {
    const event = entry.event;
    stats.eventTypeCounts[event.event] = (stats.eventTypeCounts[event.event] ?? 0) + 1;
    if (event.tool) stats.toolUsage[event.tool] = (stats.toolUsage[event.tool] ?? 0) + 1;
    if (event.event === "error") stats.errorCount++;
    if (event.event === "permission_wait") stats.permissionRequests++;
    const date = new Date(event.timestamp);
    const day = localDateKey(event.timestamp);
    const hour = date.getHours();
    stats.hourlyActivity[hour]++;
    stats.dailyHourlyActivity[day] ??= new Array(24).fill(0);
    stats.dailyHourlyActivity[day][hour]++;
    stats.dailyStats[day] ??= { events: 0, toolCalls: 0, sessions: 0, errors: 0, permissionRequests: 0 };
    stats.dailyStats[day].events++;
    if (event.tool) {
      stats.dailyStats[day].toolCalls++;
      stats.dailyToolUsage[day] ??= {};
      stats.dailyToolUsage[day][event.tool] = (stats.dailyToolUsage[day][event.tool] ?? 0) + 1;
    }
    if (event.event === "session_start") stats.dailyStats[day].sessions++;
    if (event.event === "error") stats.dailyStats[day].errors = (stats.dailyStats[day].errors ?? 0) + 1;
    if (event.event === "permission_wait") stats.dailyStats[day].permissionRequests = (stats.dailyStats[day].permissionRequests ?? 0) + 1;
  }

  stats.totalSessions = statsHistory.some(entry => entry.event.event === "session_start") ? 1 : 0;
  return stats;
}

function sessionHistory(): SessionHistory[] {
  return [{
    sessionId,
    title: "DSH Desk",
    clientLabel: "DSH Desk",
    startedAt,
    lastEventAt: lastEvent?.timestamp ?? startedAt,
    eventCount: eventHistory.length,
    status: lastEvent?.event === "error" ? "error" : lastEvent?.event === "done" ? "done" : "active",
    events: [...eventHistory].reverse()
  }];
}

function updateStatus(): UpdateStatus {
  return {
    checking: false,
    available: false,
    upToDate: true,
    downloading: false,
    downloaded: false,
    error: undefined,
    version: undefined,
    progress: undefined
  };
}

function hooksStatus(): HookStatus {
  return {
    installed: false,
    configExists: false,
    configReadError: false,
    hookCount: 0,
    requiredCount: 2,
    missingEvents: [...missingHookEvents],
    commandMatches: false,
    settingsPath: "",
    bundle: { expectedPath: "dsh-plugin", exists: false },
    npxAvailable: false,
    profiles: missingHookEvents.map(name => ({
      name,
      configExists: false,
      configReadError: false,
      dependencyRegistered: false,
      bundleRegistered: false,
      installed: false
    }))
  };
}


function bindPetApi(petApi: PetApi) {
  void petApi.getSnapshot().then(snapshot => {
    startedAt = snapshot.startedAt;
    eventPort = snapshot.eventPort;
    eventHistory = snapshot.events.map(event => {
      const companionEvent = toCompanionEvent(event);
      lastEvent = lastEvent ?? companionEvent;
      return { id: companionEvent.id, event: companionEvent, timestamp: companionEvent.timestamp };
    });
    if (statsHistory.length === 0) statsHistory = [...eventHistory];
    if (snapshot.events[0]) lastEvent = toCompanionEvent(snapshot.events[0]);
    emit(connectionListeners, currentConnection());
  });

  petApi.onPetEvent(event => applyCompanionEvent(toCompanionEvent(event)));
  petApi.onSnapshot(snapshot => {
    startedAt = snapshot.startedAt;
    eventPort = snapshot.eventPort;
    eventHistory = snapshot.events.map(event => {
      const companionEvent = toCompanionEvent(event);
      return { id: companionEvent.id, event: companionEvent, timestamp: companionEvent.timestamp };
    });
    lastEvent = eventHistory[0]?.event ?? null;
    emit(connectionListeners, currentConnection());
  });
}

export function installClawdCompat() {
  if (window.companion) return;

  const petApi = window.petAPI;
  if (petApi) bindPetApi(petApi);

  window.companion = {
    initialState: { settings: currentSettings, petPacks: [] },
    getSettings: async () => currentSettings,
    saveSettings: async next => {
      Object.assign(currentSettings, next);
      emit(settingsListeners, currentSettings);
      emit(connectionListeners, currentConnection());
      return currentSettings;
    },
    getConnectionStatus: async () => currentConnection(),
    checkHooks: async () => hooksStatus(),
    installHooks: async () => ({ success: false, error: "Hook installation is only available in the desktop app.", status: hooksStatus() }),
    repairHooks: async () => ({ success: false, error: "Hook repair is only available in the desktop app.", status: hooksStatus() }),
    removeHooks: async () => ({ success: true, removed: 0, status: hooksStatus() }),
    openSettings: async () => undefined,
    minimizeSettings: async () => petApi?.minimizePanel(),
    toggleMaximizeSettings: async () => petApi?.toggleMaximizePanel(),
    closeSettings: async () => petApi?.closePanel(),
    onEvent: callback => subscribe(companionEventListeners, callback),
    onSettings: callback => subscribe(settingsListeners, callback),
    onConnection: callback => subscribe(connectionListeners, callback),
    setPetInteractive: async () => undefined,
    updatePermissionCardRect: async () => undefined,
    onPetDragDirection: () => () => undefined,
    onTrayMenuState: () => () => undefined,
    trayMenuReady: async () => null,
    trayMenuRendered: async () => undefined,
    trayMenuAction: async () => undefined,
    onPermissionRequest: callback => subscribe(permissionRequestListeners, callback),
    onPermissionResolved: callback => subscribe(permissionResolvedListeners, callback),
    respondPermission: async response => emit(permissionResolvedListeners, { id: response.id }),
    checkForUpdates: async () => updateStatus(),
    installUpdate: async () => undefined,
    getUpdateStatus: async () => updateStatus(),
    getAppVersion: async () => "0.0.0-dev",
    getTokenStats: async () => ({ sessions: [], daily: [], modelTotals: [], dailyTotals: [], projectTotals: [], recentRequests: [], totalTokens: 0, totalCostUsd: 0, totalSessions: 0, totalRequests: 0, cacheHitRatio: 0, pricing: { source: "embedded", sources: ["embedded"], updatedAt: 0, stale: true }, exchangeRates: { base: "USD", rates: { CNY: 7, USD: 1, EUR: 0.9 }, source: "embedded", updatedAt: 0, stale: true }, lastScannedAt: Date.now(), scanning: false }),
    getDshAnalytics: async () => ({
      totals: { events: 171, sessions: 7, turns: 9, steps: 42, toolCalls: 78, failedToolCalls: 2, permissionRequests: 3, permissionApproved: 2, permissionDenied: 1, llmMs: 409_422, toolMs: 665_000, ttftMs: 103_000, ttftSteps: 42, decodeMs: 306_422, decodeTokens: 42_117 },
      daily: Array.from({ length: 28 }, (_, index) => ({
        date: new Date(Date.now() - (27 - index) * 86_400_000).toISOString().slice(0, 10),
        events: index % 5 === 0 ? 0 : 7 + (index % 11),
        sessions: index % 5 === 0 ? 0 : 1 + (index % 3),
        turns: index % 5 === 0 ? 0 : 1 + (index % 4),
        steps: index % 5 === 0 ? 0 : 3 + (index % 8),
        toolCalls: index % 5 === 0 ? 0 : 4 + (index % 13),
        failedToolCalls: index === 19 ? 1 : 0,
        permissionRequests: index === 22 ? 3 : 0,
        permissionApproved: index === 22 ? 2 : 0,
        permissionDenied: index === 22 ? 1 : 0,
        totalTokens: index % 5 === 0 ? 0 : 12_000 + index * 1_700,
        llmMs: index % 5 === 0 ? 0 : 18_000 + index * 400,
        toolMs: index % 5 === 0 ? 0 : 9_000 + index * 700,
        ttftMs: index % 5 === 0 ? 0 : 1_800 + index * 25,
        ttftSteps: index % 5 === 0 ? 0 : 3 + (index % 8),
        decodeMs: index % 5 === 0 ? 0 : 16_200 + index * 375,
        decodeTokens: index % 5 === 0 ? 0 : 1_500 + index * 120
      })),
      tools: [
        { name: "pwsh", calls: 21, errors: 0, durationMs: 87_000 },
        { name: "read", calls: 14, errors: 0, durationMs: 4_200 },
        { name: "grep", calls: 12, errors: 1, durationMs: 8_300 },
        { name: "edit", calls: 9, errors: 0, durationMs: 3_100 },
        { name: "subagent_fork", calls: 5, errors: 0, durationMs: 166_000 }
      ],
      sessions: [
        { sessionId: "demo-1", title: "调用全部工具能力排查", filePath: "Development session", projectPath: "E:\\claude-plugins\\pet\\deepseek-harness", projectName: "deepseek-harness", provider: "deepseek-official", model: "deepseek-v4-flash", createdAt: Date.now() - 12_000_000, lastActivity: Date.now() - 90_000, durationMs: 11_999_150, turns: 1, steps: 16, toolCalls: 46, failedToolCalls: 2, llmMs: 228_611, toolMs: 646_116, ttftMs: 42_147, ttftSteps: 16, decodeMs: 186_464, decodeTokens: 24_725, inputTokens: 35_290, outputTokens: 24_725, cacheReadTokens: 540_032, cacheWriteTokens: 0, contextWindow: 1_000_000, pressureTokens: 48_067, projectedTokens: 48_515, systemTokens: 1_559, toolsTokens: 6_670, messageTokens: 36_874 },
        { sessionId: "demo-2", title: "Provider route smoke test", filePath: "Development session", projectPath: "E:\\claude-plugins\\pet\\deepseek-harness", projectName: "deepseek-harness", provider: "deepseek-official", model: "deepseek-v4-pro", createdAt: Date.now() - 3_600_000, lastActivity: Date.now() - 900_000, durationMs: 2_700_000, turns: 2, steps: 3, toolCalls: 4, failedToolCalls: 0, llmMs: 10_817, toolMs: 17, ttftMs: 7_632, ttftSteps: 3, decodeMs: 3_185, decodeTokens: 500, inputTokens: 1_200, outputTokens: 500, cacheReadTokens: 8_400, cacheWriteTokens: 0, contextWindow: 1_000_000, pressureTokens: 9_600, projectedTokens: 10_200, systemTokens: 1_500, toolsTokens: 6_600, messageTokens: 2_100 }
      ],
      hourlyActivity: new Array(24).fill(0),
      dailyHourlyActivity: {},
      dailyToolUsage: {},
      dailyTools: {},
      sessionRoot: "Development sessions",
      lastScannedAt: Date.now()
    }),
    getRecentEdits: async () => ({ edits: [], totalEdits: 0, totalFiles: 0, lastScannedAt: Date.now() }),
    getUsageRankings: async () => ({ global: { tools: [], skills: [], agents: [], totalToolUses: 0 }, projects: [], lastScannedAt: Date.now() }),
    previewSound: async () => ({ ok: false, error: "Sound preview is only available in the desktop app." }),
    getDefaultSoundPaths: async () => ({ done: null, error: null, permission: null }),
    previewSoundFile: async () => ({ ok: false, error: "Sound preview is only available in the desktop app." }),
    pickSoundFile: async () => null,
    previewPetAnimation: async animationKey => {
      emit(previewPetAnimationListeners, animationKey);
      return true;
    },
    syncIdleBubble: async payload => emit(idleBubbleSyncListeners, payload),
    onIdleBubbleSync: callback => subscribe(idleBubbleSyncListeners, callback),
    onPreviewPetAnimation: callback => subscribe(previewPetAnimationListeners, callback),
    getEventHistory: async () => eventHistory,
    getSessionHistory: async () => sessionHistory(),
    clearEventHistory: async () => { eventHistory = []; },
    exportEventHistoryFile: async () => undefined,
    getDataDirectory: async () => "Development data",
    openDataDirectory: async () => ({ ok: true }),
    revealDshSession: async () => false,
    getMonitors: async () => [],
    getPlugins: async () => [],
    listDshPlugins: async () => mockDshPluginSnapshot,
    getDshPluginMarketplace: async () => mockDshMarketplace,
    setDshPluginEnabled: async input => {
      mockDshPluginSnapshot = {
        ...mockDshPluginSnapshot,
        plugins: mockDshPluginSnapshot.plugins.map(plugin => plugin.packageName !== input.packageName ? plugin : {
          ...plugin,
          states: plugin.states.map(state => state.profile === input.profile ? { ...state, enabled: input.enabled } : state)
        }),
        scannedAt: Date.now()
      };
      return { ok: true, snapshot: mockDshPluginSnapshot, changedProfiles: [input.profile], restartRequired: true };
    },
    installDshMarketplacePlugin: async input => ({ ok: true, snapshot: mockDshPluginSnapshot, changedProfiles: input.profiles, restartRequired: true }),
    removeDshPluginPackage: async input => ({ ok: true, snapshot: mockDshPluginSnapshot, changedProfiles: input.profiles, restartRequired: true }),
    listDshSkills: async () => mockDshSkills,
    getDshResourceSchemes: async () => mockDshResourceSchemes,
    saveDshResourceScheme: async input => {
      const existing = input.id ? mockDshResourceSchemes.schemes.find(scheme => scheme.id === input.id) : undefined;
      const now = Date.now();
      const scheme = existing
        ? { ...existing, ...input, id: existing.id, isProtected: existing.isProtected, updatedAt: now }
        : { ...input, id: `scheme-${now}`, isProtected: false, createdAt: now, updatedAt: now };
      mockDshResourceSchemes = {
        ...mockDshResourceSchemes,
        schemes: existing ? mockDshResourceSchemes.schemes.map(item => item.id === scheme.id ? scheme : item) : [...mockDshResourceSchemes.schemes, scheme]
      };
      return { ok: true, schemeId: scheme.id, snapshot: mockDshResourceSchemes };
    },
    deleteDshResourceScheme: async schemeId => {
      mockDshResourceSchemes = { ...mockDshResourceSchemes, schemes: mockDshResourceSchemes.schemes.filter(scheme => scheme.id !== schemeId) };
      return { ok: true, schemeId, snapshot: mockDshResourceSchemes };
    },
    applyDshResourceScheme: async schemeId => {
      mockDshResourceSchemes = { ...mockDshResourceSchemes, appliedSchemeId: schemeId };
      return { ok: true, schemeId, snapshot: mockDshResourceSchemes };
    },
    setDshResourceState: async input => {
      const resource = [...mockDshResourceSchemes.inventory.skills, ...mockDshResourceSchemes.inventory.plugins].find(item => item.id === input.resourceId);
      const field = resource?.kind === "plugin" ? "plugins" : "skills";
      mockDshResourceSchemes = {
        ...mockDshResourceSchemes,
        inventory: {
          ...mockDshResourceSchemes.inventory,
          [field]: mockDshResourceSchemes.inventory[field].map(item => item.id === input.resourceId ? { ...item, enabled: input.enabled } : item)
        }
      };
      return { ok: true, schemeId: input.schemeId, snapshot: mockDshResourceSchemes };
    },
    onDshResourcesUpdated: () => () => undefined,
    getDshSkillMarketplace: async () => mockDshSkillMarketplace,
    addDshSkillRepo: async repo => {
      mockDshSkillMarketplace = { ...mockDshSkillMarketplace, repos: [...mockDshSkillMarketplace.repos, repo] };
      return { ok: true, snapshot: mockDshSkillMarketplace };
    },
    removeDshSkillRepo: async (owner, name) => {
      mockDshSkillMarketplace = { ...mockDshSkillMarketplace, repos: mockDshSkillMarketplace.repos.filter(repo => repo.owner !== owner || repo.name !== name) };
      return { ok: true, snapshot: mockDshSkillMarketplace };
    },
    installDshSkill: async skill => {
      mockDshSkillMarketplace = { ...mockDshSkillMarketplace, skills: mockDshSkillMarketplace.skills.map(item => item.key === skill.key ? { ...item, installed: true } : item) };
      return { ok: true, snapshot: mockDshSkills };
    },
    revealDshSkill: async () => true,
    getClaudeResources: async () => ({ summary: { skills: 0, plugins: 0, mcp: 0 }, skills: [], plugins: [], mcp: [], scannedAt: Date.now(), paths: { claudeDir: "~/.claude", claudeJson: "~/.claude.json" } }),
    getClaudeProfiles: async () => mockClaudeProfiles,
    saveClaudeProfile: async input => {
      const existing = input.id ? mockClaudeProfiles.profiles.find(profile => profile.id === input.id) : undefined;
      if (input.id && !existing) return { ok: false, issues: [{ code: "invalid-profile-reference", message: "Profile not found." }] };
      if (existing?.isProtected && input.name.trim() !== existing.name) {
        return { ok: false, issues: [{ code: "protected-profile", message: "Built-in profiles cannot be renamed." }] };
      }
      if (existing?.id === "all" && (
        !sameProfileMembership(existing.skills, input.skills)
        || !sameProfileMembership(existing.plugins, input.plugins)
        || !sameProfileMembership(existing.mcpServers, input.mcpServers)
      )) {
        return { ok: false, issues: [{ code: "protected-profile", message: "The All profile updates automatically." }] };
      }
      if (mockClaudeProfiles.profiles.some(profile => profile.id !== input.id && profile.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) {
        return { ok: false, issues: [{ code: "duplicate-profile-name", message: "A profile with this name already exists." }] };
      }
      const now = Date.now();
      const profile = {
        id: existing?.id ?? `profile-${now.toString(36)}`,
        name: existing?.isProtected ? existing.name : input.name.trim(),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        skills: [...input.skills],
        plugins: [...input.plugins],
        mcpServers: [...input.mcpServers],
        isProtected: existing?.isProtected ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      mockClaudeProfiles = {
        ...mockClaudeProfiles,
        profiles: existing
          ? mockClaudeProfiles.profiles.map(item => item.id === profile.id ? profile : item)
          : [...mockClaudeProfiles.profiles, profile]
      };
      updateMockClaudeDrift();
      return { ok: true, profileId: profile.id, snapshot: mockClaudeProfiles };
    },
    deleteClaudeProfile: async profileId => {
      const profile = mockClaudeProfiles.profiles.find(item => item.id === profileId);
      if (!profile || profile.isProtected || mockClaudeProfiles.appliedProfileId === profileId) {
        return { ok: false, issues: [{ code: "profile-delete-blocked", message: "This profile cannot be deleted." }] };
      }
      mockClaudeProfiles = { ...mockClaudeProfiles, profiles: mockClaudeProfiles.profiles.filter(item => item.id !== profileId) };
      return { ok: true, profileId, snapshot: mockClaudeProfiles };
    },
    previewClaudeProfile: async profileId => mockClaudeProfiles.profiles.some(profile => profile.id === profileId)
      ? { ok: true, profileId, changes: { skills: { enable: [], disable: [] }, plugins: { enable: [], disable: [] }, mcpServers: { enable: [], disable: [] } } }
      : { ok: false, issues: [{ code: "invalid-profile-reference", message: "Profile not found." }] },
    applyClaudeProfile: async profileId => {
      const profile = mockClaudeProfiles.profiles.find(item => item.id === profileId);
      if (!profile) {
        return { ok: false, issues: [{ code: "invalid-profile-reference", message: "Profile not found." }] };
      }
      mockClaudeProfiles = snapshotAfterClaudeProfileApply(mockClaudeProfiles, profileId);
      return { ok: true, profileId, snapshot: mockClaudeProfiles };
    },
    setClaudeProfileResourceState: async input => {
      if (mockClaudeProfiles.mcpStatus !== "ready") {
        return { ok: false, issues: [{ code: "mcp-state-unavailable", message: "Claude MCP state is temporarily unavailable." }] };
      }
      const profile = mockClaudeProfiles.profiles.find(item => item.id === input.profileId);
      const resource = [
        ...mockClaudeProfiles.inventory.skills,
        ...mockClaudeProfiles.inventory.plugins,
        ...mockClaudeProfiles.inventory.mcpServers
      ].find(item => item.id === input.resourceId);
      if (!profile || mockClaudeProfiles.appliedProfileId !== input.profileId || !resource) {
        return { ok: false, issues: [{ code: "invalid-profile-reference", message: "Profile resource not found." }] };
      }
      const membership = resource.kind === "skill" ? profile.skills : resource.kind === "plugin" ? profile.plugins : profile.mcpServers;
      if (!membership.includes(resource.id)) {
        return { ok: false, issues: [{ code: "invalid-profile-reference", message: "Resource is not selected by this profile." }] };
      }
      mockClaudeProfiles = snapshotAfterClaudeProfileResourceState(mockClaudeProfiles, resource.id, input.enabled);
      return { ok: true, profileId: profile.id, snapshot: mockClaudeProfiles };
    },
    getClaudeSessions: async () => ({ sessions: [], scannedAt: Date.now(), projectsDir: "~/.claude/projects" }),
    onSessionsUpdated: () => () => {},
    getClaudeSessionDetail: async () => null,
    resumeClaudeSession: async sessionId => ({ ok: false, command: `claude --resume ${sessionId}` }),
    openClaudeResource: async () => undefined,
    getPluginRuns: async () => [],
    runPluginNow: async () => undefined,
    openPluginDataDir: async () => undefined,
    getPluginMarket: async () => ({ version: 1, plugins: [] }),
    installMarketPlugin: async () => undefined,
    savePlugins: async () => undefined,
    openExternal: async url => {
      if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener,noreferrer");
    },
    getStats: async () => buildStats(),
    resetStats: async () => { statsHistory = []; },
    exportSettingsFile: async () => undefined,
    importSettingsFile: async () => null,
    exportStatsFile: async () => undefined,
    importStatsFile: async () => null,
    onUpdateStatus: callback => subscribe(updateStatusListeners, callback),
    onPlaySound: callback => subscribe(playSoundListeners, callback),
    onOpenSection: callback => subscribe(openSectionListeners, callback),
    listClaudeProviders: async () => ({
      ok: true,
      source: "local",
      providers: Object.values(mockProviders),
      currentId: mockCurrentProviderId,
      hasCommonConfig: false
    }),
    saveClaudeProvider: async (provider, originalId) => {
      const record = { ...provider, id: provider.id?.trim() || `provider-${Date.now().toString(36)}` };
      if (originalId && originalId !== record.id) delete mockProviders[originalId];
      mockProviders[record.id] = record;
      if (originalId && mockCurrentProviderId === originalId) mockCurrentProviderId = record.id;
      return { ok: true, provider: record };
    },
    deleteClaudeProvider: async id => {
      if (id === mockCurrentProviderId) return { ok: false, error: "Cannot delete the provider currently in use" };
      delete mockProviders[id];
      return { ok: true };
    },
    duplicateClaudeProvider: async id => {
      const source = mockProviders[id];
      if (!source) return { ok: false, error: `Provider ${id} not found` };
      const copy = { ...JSON.parse(JSON.stringify(source)) as ClaudeProviderConfig, id: `provider-${Date.now().toString(36)}`, name: `${source.name} copy`, sortIndex: Object.keys(mockProviders).length };
      mockProviders[copy.id] = copy;
      return { ok: true, provider: copy };
    },
    reorderClaudeProviders: async orderedIds => {
      orderedIds.forEach((id, index) => {
        if (mockProviders[id]) mockProviders[id] = { ...mockProviders[id], sortIndex: index };
      });
      return { ok: true };
    },
    switchClaudeProvider: async id => {
      if (!mockProviders[id]) return { ok: false, error: `Provider ${id} not found`, warnings: [] };
      mockCurrentProviderId = id;
      return { ok: true, path: "~/.claude/settings.json", backupPath: null, warnings: [] };
    },
    testClaudeProvider: async payload => ({
      status: "failed",
      success: false,
      url: payload.baseUrl ?? "",
      message: "Connectivity tests are only available in the desktop app."
    }),
    fetchClaudeProviderModels: async () => ({ ok: false, models: [], errorCode: "failed" }),
    listDshProviders: async () => ({
      ok: true,
      providers: mockDshProviders,
      catalogProviders: [],
      runtimeAvailable: false,
      defaultProvider: mockDshProviders.find(provider => provider.isDefault)?.id ?? "deepseek-official",
      defaultModel: mockDshProviders.find(provider => provider.isDefault)?.defaultModel ?? "deepseek-v4-flash"
    }),
    saveDshProvider: async input => {
      const id = input.id?.trim() || `route-${Date.now().toString(36)}`;
      const next: DshProvider = {
        ...input,
        id,
        baseUrl: input.baseUrl ?? "",
        models: input.models ?? [],
        modelsInherited: input.inheritModels === true || input.models === undefined,
        catalogProvider: input.catalogProvider === true,
        enabled: input.enabled !== false,
        runtimeActive: input.enabled !== false,
        credentialRef: id === "deepseek-official" ? "DEEPSEEK_API_KEY" : `CHARA_DSH_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        hasCredential: !!input.apiKey,
        isOfficial: id === "deepseek-official",
        isDefault: mockDshProviders.some(provider => provider.id === id && provider.isDefault)
      };
      const index = mockDshProviders.findIndex(provider => provider.id === id);
      if (index >= 0) mockDshProviders[index] = {
        ...mockDshProviders[index],
        ...next,
        apiKey: next.apiKey || mockDshProviders[index].apiKey,
        hasCredential: next.hasCredential || mockDshProviders[index].hasCredential
      };
      else mockDshProviders.push(next);
      return { ok: true, provider: index >= 0 ? mockDshProviders[index] : next };
    },
    deleteDshProvider: async id => {
      const index = mockDshProviders.findIndex(provider => provider.id === id);
      if (index < 0 || mockDshProviders[index].isOfficial) return { ok: false, error: "Provider cannot be deleted" };
      mockDshProviders.splice(index, 1);
      return { ok: true };
    },
    duplicateDshProvider: async id => {
      const source = mockDshProviders.find(provider => provider.id === id);
      if (!source || source.isOfficial) return { ok: false, error: "Provider cannot be copied" };
      const copy = { ...structuredClone(source), id: `${id}-copy`, name: `${source.name} Copy`, isDefault: false };
      mockDshProviders.push(copy);
      return { ok: true, provider: copy };
    },
    reorderDshProviders: async ids => {
      mockDshProviders.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
      return { ok: true };
    },
    setDshProviderEnabled: async (id, enabled) => {
      const provider = mockDshProviders.find(item => item.id === id);
      if (!provider) return { ok: false, error: "Provider not found" };
      provider.enabled = enabled;
      provider.runtimeActive = enabled;
      if (!enabled && provider.isDefault) {
        const fallback = mockDshProviders.find(item => item.id !== id && item.enabled);
        provider.isDefault = false;
        provider.defaultModel = undefined;
        if (fallback) {
          fallback.isDefault = true;
          fallback.defaultModel = fallback.models[0]?.id;
        }
      }
      return { ok: true, provider };
    },
    switchDshProvider: async (id, model) => {
      const provider = mockDshProviders.find(item => item.id === id);
      if (!provider || !provider.enabled) return { ok: false, error: "Provider not found or disabled" };
      const selectedModel = model || provider.models[0]?.id;
      mockDshProviders.forEach(item => { item.isDefault = item.id === id; item.defaultModel = item.id === id ? selectedModel : undefined; });
      return { ok: true, provider: id, model: selectedModel };
    },
    probeDshProvider: async () => ({ ok: false, error: "Connectivity tests are only available in the desktop app." }),
    openClaudeProviderTerminal: async () => ({ ok: false, command: "", error: "Terminal launch is only available in the desktop app." }),
    pickTerminalDirectory: async () => null,
    onCcSwitchChanged: () => () => undefined,
    pickPetPackFile: async () => null,
    inspectPetPack: async () => ({ ok: false, problems: [{ field: "app", message: "Pet import is only available in the desktop app." }] }),
    installPetPack: async () => ({ ok: false, problems: [{ field: "app", message: "Pet import is only available in the desktop app." }] }),
    listPetPacks: async () => [],
    removePetPack: async () => ({ ok: false, error: "Pet import is only available in the desktop app." }),
    onPetPacksChanged: () => () => undefined,
    getPetPackFilePath: () => "",
    downloadPetPack: async () => ({ ok: false, code: "unavailable" }),
    discardPetPackDownload: async () => ({ ok: false }),
    onPetPackDownloadProgress: () => () => undefined
  };
}

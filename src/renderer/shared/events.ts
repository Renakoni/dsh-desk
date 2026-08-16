// @ts-nocheck
import type { PetPackManifest } from "../../shared/petPack";
import type { CurrencyRatesStatus, DisplayCurrency } from "../../shared/currency";

export interface ClaudeSessionIndexItem {
  sessionId: string;
  title: string;
  firstPrompt?: string;
  projectName: string;
  projectPath?: string;
  encodedProject: string;
  filePath: string;
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
  status: "valid" | "empty" | "corrupt";
  model?: string;
  branch?: string;
}

export interface ClaudeSessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  timestamp?: number;
  model?: string;
  toolName?: string;
}

export interface ClaudeSessionSnapshot {
  sessions: ClaudeSessionIndexItem[];
  scannedAt: number;
  projectsDir: string;
}

export interface ClaudeSessionDetail {
  session: ClaudeSessionIndexItem;
  messages: ClaudeSessionMessage[];
  totalMessages: number;
}

export interface AppStats {
  toolUsage: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  totalSessions: number;
  dailyStats: Record<string, { events: number; toolCalls: number; sessions: number; errors?: number; permissionRequests?: number }>;
  errorCount: number;
  permissionRequests: number;
  permissionApproved: number;
  permissionDenied: number;
  totalRuntime: number;
  hourlyActivity: number[];
  dailyHourlyActivity: Record<string, number[]>;
  dailyToolUsage: Record<string, Record<string, number>>;
  firstStartTime: number;
  lastEventTime: number;
}

export const defaultStats: AppStats = {
  toolUsage: {},
  eventTypeCounts: {},
  totalSessions: 0,
  dailyStats: {},
  errorCount: 0,
  permissionRequests: 0,
  permissionApproved: 0,
  permissionDenied: 0,
  totalRuntime: 0,
  hourlyActivity: new Array(24).fill(0),
  dailyHourlyActivity: {},
  dailyToolUsage: {},
  firstStartTime: Date.now(),
  lastEventTime: 0
};

export type ToolName =
  | "Read"
  | "Edit"
  | "Write"
  | "Bash"
  | "Grep"
  | "Glob"
  | "WebFetch"
  | "WebSearch"
  | "Notebook"
  | "Agent"
  | "Skill"
  | "Task"
  | "TaskCreate"
  | "TaskUpdate"
  | "AskUserQuestion"
  | "MCP"
  // Codex-specific tools (no-op for Claude-Code-only users)
  | "Shell"
  | "UpdatePlan"
  | "ApplyPatch"
  | "ViewImage"
  | "Unknown";

export type CompanionEventType =
  | "session_start"
  | "prompt_submit"
  | "tool_start"
  | "tool_end"
  | "notification"
  | "permission_wait"
  | "done"
  | "error"
  | "heartbeat"
  | "git_operation";

export type PetState =
  | "idle"
  | "thinking"
  | "tool_read"
  | "tool_edit"
  | "tool_bash"
  | "tool_search"
  | "tool_mcp"
  | "skill"
  | "task"
  | "agent"
  | "waiting_permission"
  | "done"
  | "error";

export type FeedbackMode = "thought" | "card" | "ribbon";
// Theme ids are dynamic since imported pet packs became selectable themes;
// values are validated against the theme registry (utils/petThemes.ts), with
// the built-in theme as the fallback for unknown ids.
export type PetThemeId = string;

export type ClientType = "cli" | "desktop" | "vscode" | "unknown";

export type ProviderId = "claude-code" | "deepseek-harness" | "codex";

export type PermissionDecision = "allow" | "deny";

export interface PermissionRequest {
  id: string;
  toolName: ToolName;
  toolDetail?: string;
  sessionId?: string;
  timestamp: number;
  rawPayload: Record<string, unknown>;
}

export interface PermissionPollResult {
  status: "approved" | "denied" | "expired" | "error";
  decision?: PermissionDecision;
  reason?: string;
}

export interface PermissionResponse {
  id: string;
  decision: PermissionDecision;
  reason?: string;
}

export interface CompanionEvent {
  id: string;
  source: ProviderId | "cc-haha" | "manual";
  event: CompanionEventType;
  sessionId?: string;
  clientType?: ClientType;
  clientLabel?: string;
  tool?: ToolName;
  notificationKind?: "idle" | "attention" | "info";
  cwd?: string;
  title: string;
  message: string;
  detail?: string;
  timestamp: number;
}

/** Environment block of a Claude provider, mirroring cc-switch's settingsConfig.env. */
export interface ClaudeProviderEnv {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_FABLE_MODEL?: string;
  // Per-role /model menu display names (cc-switch parity). The actual request
  // model stays in the *_MODEL keys above; the "[1M]" marker rides on that value.
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_FABLE_MODEL_NAME?: string;
  [key: string]: string | undefined;
}

/** Provider metadata, cc-switch ProviderMeta compatible (camelCase JSON keys). */
export interface ClaudeProviderMeta {
  commonConfigEnabled?: boolean;
  apiFormat?: "anthropic" | "openai_chat" | "openai_responses" | "gemini_native" | string;
  apiKeyField?: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" | string;
  customUserAgent?: string;
  [key: string]: unknown;
}

/**
 * A Claude provider record, schema-compatible with cc-switch's Provider.
 * settingsConfig is a full ~/.claude/settings.json snapshot; unknown keys
 * must be preserved round-trip.
 */
export interface ClaudeProviderConfig {
  id: string;
  name: string;
  settingsConfig: { env?: ClaudeProviderEnv; [key: string]: unknown };
  websiteUrl?: string;
  category?: "official" | "cn_official" | "aggregator" | "third_party" | "custom" | "cloud_provider" | string;
  createdAt?: number;
  sortIndex?: number;
  notes?: string;
  icon?: string;
  iconColor?: string;
  meta?: ClaudeProviderMeta;
  inFailoverQueue?: boolean;
  isCurrent?: boolean;
}

export interface ClaudeProviderListResult {
  ok: boolean;
  source: "cc-switch" | "local";
  dbPath?: string;
  readError?: string;
  providers: ClaudeProviderConfig[];
  currentId: string;
  hasCommonConfig?: boolean;
  error?: string;
}

export interface ClaudeProviderSwitchResult {
  ok: boolean;
  path?: string;
  backupPath?: string | null;
  warnings?: string[];
  error?: string;
}

/** Reachability probe result, cc-switch StreamCheckResult compatible. */
export interface ClaudeProviderTestResult {
  status: "operational" | "degraded" | "failed";
  success: boolean;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  url: string;
}

export interface ClaudeProviderSaveResult {
  ok: boolean;
  provider?: ClaudeProviderConfig;
  warnings?: string[];
  error?: string;
}

export type ClaudeProviderModelsErrorCode = "config" | "auth" | "notFound" | "timeout" | "unsupported" | "unsupportedFormat" | "failed";

/** Request to query a provider's models endpoint. apiFormat/apiKeyField pick the
 *  endpoint + auth convention; a format without an OpenAI-style /v1/models is
 *  rejected with errorCode "unsupportedFormat". */
export interface ClaudeProviderModelsRequest {
  baseUrl: string;
  apiKey: string;
  apiFormat?: string;
  apiKeyField?: string;
  userAgent?: string;
}

/** Result of querying a provider's models endpoint for available model ids. */
export interface ClaudeProviderModelsResult {
  ok: boolean;
  models: string[];
  errorCode?: ClaudeProviderModelsErrorCode;
}

export interface CompanionSettings {
  claudeProviders?: Record<string, ClaudeProviderConfig>;
  currentClaudeProviderId?: string;
  hideSensitiveContent: boolean;
  showBubbles: boolean;
  editPosition: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  petEnabled: boolean;
  petScale: number;
  viewScale: number;
  clawdScale: number;
  clawdOpacity: number;
  feedbackScale: number;
  feedbackOpacity: number;
  bubbleDuration: number;
  permissionScale: number;
  toolStreamMinDuration: number;
  showStatusProp: boolean;
  permissionDialogEnabled: boolean;
  permissionWaitSeconds: number;
  mainClawdIdleAnimation: string;
  launchAtLogin: boolean;
  openSettingsOnStart: boolean;
  autoStartWithCli: boolean;
  autoUpdateEnabled: boolean;
  petTheme: PetThemeId;
  enabledSources: ProviderId[];
  notificationsEnabled: boolean;
  theme: "light" | "dark" | "system";
  uiStyle: "classic" | "liquid";
  language: "auto" | "zh" | "en";
  displayCurrency: DisplayCurrency;
  notificationRules: NotificationRule[];
  customPlugins: CustomPlugin[];
  sound: SoundSettings;
  eventHistoryLimit: number;
  positionOffsets?: {
    clawd?: { x: number; y: number };
    bubble?: { x: number; y: number };
    ribbon?: { x: number; y: number };
    permission?: { x: number; y: number };
    view?: { x: number; y: number };
    gitToast?: { x: number; y: number };
  };
  idleAnim?: IdleAnimConfig;
  stateAnimations?: Record<string, string>;
}

export interface CompanionInitialState {
  settings: CompanionSettings;
  petPacks: PetPackManifest[];
}

export interface IdleAnimConfig {
  enabled: boolean;
  selectedSprites: string[];
  intervalMin: number;
  intervalMax: number;
  repeatMin: number;
  repeatMax: number;
}

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  fileDone: string | null;
  fileError: string | null;
  filePermission: string | null;
  eventFiles?: Partial<Record<CompanionEventType, string | null>>;
}

export interface SessionTokenInfo {
  sessionId: string;
  project: string;
  cwd: string;
  startTime: number;
  endTime: number;
  model: string;
  entrypoint: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd?: number;
  requestCount?: number;
  messageCount: number;
}

export interface DailyTokenEntry {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd?: number;
  sessionCount: number;
  requestCount?: number;
  messageCount: number;
}

export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface TokenCostBreakdown extends TokenBreakdown {
  costUsd: number;
}

export interface ModelTokenTotal extends TokenCostBreakdown {
  model: string;
  requestCount: number;
  sessionCount: number;
  messageCount: number;
  cacheHitRatio: number;
  priced: boolean;
}

export interface ProjectTokenTotal extends TokenCostBreakdown {
  projectPath: string;
  projectName: string;
  requestCount: number;
  sessionCount: number;
  lastActivity: number;
  models: string[];
  cacheHitRatio: number;
}

export interface RequestTokenRecord extends TokenCostBreakdown {
  id: string;
  sessionId: string;
  filePath: string;
  projectPath?: string;
  projectName: string;
  model: string;
  timestamp: number;
  durationMs?: number;
  priced: boolean;
}

export interface TokenStats {
  sessions: SessionTokenInfo[];
  daily: DailyTokenEntry[];
  modelTotals: ModelTokenTotal[];
  dailyTotals: (TokenCostBreakdown & { date: string; sessionCount: number; requestCount: number; messageCount: number })[];
  /** Durable long-term per-day totals for the heatmap only (survives log rotation). */
  heatmapDailyTotals?: (TokenCostBreakdown & { date: string; sessionCount: number; requestCount: number; messageCount: number })[];
  projectTotals: ProjectTokenTotal[];
  recentRequests: RequestTokenRecord[];
  totalTokens: number;
  totalCostUsd: number;
  totalSessions: number;
  totalRequests: number;
  cacheHitRatio: number;
  pricing: {
    source: "deepseek-official" | "litellm" | "models.dev" | "embedded";
    sources: ("deepseek-official" | "litellm" | "models.dev" | "embedded")[];
    updatedAt: number;
    stale: boolean;
  };
  exchangeRates: CurrencyRatesStatus;
  lastScannedAt: number;
  scanning: boolean;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  upToDate: boolean;
  version?: string;
  downloaded: boolean;
  downloading: boolean;
  progress?: number;
  error?: string;
  lastCheckedAt?: number;
}

export interface CompanionSession {
  sessionId: string;
  title: string;
  state: PetState;
  lastEvent: CompanionEvent | null;
  lastEventTime: number;
  isActive: boolean;
  eventCount: number;
}

export interface EventHistoryEntry {
  id: string;
  event: CompanionEvent;
  timestamp: number;
}

export interface NotificationRule {
  eventType: CompanionEventType;
  enabled: boolean;
  playSound: boolean;
}

export type PluginPermission = "event" | "network" | "filesystem" | "shell";

export type PluginSettingType = "text" | "number" | "toggle" | "select" | "color" | "filepath";

export interface PluginSettingField {
  key: string;
  label: string;
  labelZh?: string;
  type: PluginSettingType;
  default?: unknown;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

export interface PluginAssets {
  sprites?: string;
}

export interface PluginManifest {
  name?: string;
  nameZh?: string;
  description?: string;
  descriptionZh?: string;
  events: string[];
  permissions: PluginPermission[];
  timeoutMs?: number;
  settings?: PluginSettingField[];
  assets?: PluginAssets;
  readme?: string;
  readmeZh?: string;
  devBadge?: boolean;
}

export interface PluginRunRecord {
  id: string;
  pluginId: string;
  pluginName: string;
  eventType: CompanionEventType;
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface CustomPlugin {
  id: string;
  name: string;
  scriptPath: string;
  enabled: boolean;
  events: string[];
  trusted?: boolean;
  permissions?: PluginPermission[];
  manifest?: PluginManifest;
  manifestError?: string;
  settings?: Record<string, unknown>;
  resolvedAssets?: { spritesCss?: string };
  resolvedDataDir?: string;
  marketId?: string;
  version?: string;
  author?: string;
  readme?: string;
  readmeZh?: string;
  devBadge?: boolean;
}

export interface PluginMarketItem {
  id: string;
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
  details?: string;
  detailsZh?: string;
  readme?: string;
  readmeZh?: string;
  author: string;
  version: string;
  entry: string;
  manifest: string;
  events: string[];
  permissions: PluginPermission[];
  tags: string[];
  devBadge?: boolean;
}

export interface PluginMarketIndex {
  version: number;
  updatedAt?: string;
  plugins: PluginMarketItem[];
}

export interface SessionHistory {
  sessionId: string;
  title: string;
  cwd?: string;
  clientLabel?: string;
  startedAt: number;
  endedAt?: number;
  lastEventAt: number;
  eventCount: number;
  status: "active" | "done" | "error";
  events: EventHistoryEntry[];
}

export interface CompanionConnectionStatus {
  port: number;
  serverListening: boolean;
  activeSessionId?: string;
  activeClientType?: ClientType;
  activeClientLabel?: string;
  lastEventAt?: number;
  lastEventTitle?: string;
  lastEventType?: CompanionEventType;
  lastEventSource?: CompanionEvent["source"];
  error?: string;
}

export const defaultSettings: CompanionSettings = {
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
  openSettingsOnStart: false,
  autoStartWithCli: false,
  autoUpdateEnabled: true,
  petTheme: "minato-aqua",
  enabledSources: ["deepseek-harness"],
  notificationsEnabled: true,
  theme: "system",
  uiStyle: "classic",
  language: "auto",
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
    volume: 0.5,
    fileDone: null,
    fileError: null,
    filePermission: null,
    eventFiles: {}
  },
  eventHistoryLimit: 40,
  positionOffsets: {
    clawd: { x: 707, y: -61 },
    bubble: { x: 682, y: -71 },
    ribbon: { x: 677, y: -80 },
    permission: { x: 407, y: 83 },
    view: { x: 41, y: -13 },
    gitToast: { x: 676, y: 39 }
  },
  idleAnim: {
    enabled: true,
    selectedSprites: ["idle", "running", "waiting_permission", "done", "extra_action_7", "extra_action_8", "extra_action_aqua_bocchi"],
    intervalMin: 15,
    intervalMax: 40,
    repeatMin: 2,
    repeatMax: 3
  },
  stateAnimations: {}
};

export function stateFromEvent(event: CompanionEvent): PetState {
  if (event.event === "error") return "error";
  if (event.event === "permission_wait") return "waiting_permission";
  if (event.event === "done") return "done";
  if (event.event === "git_operation") return "thinking";
  if (event.event === "prompt_submit" || event.event === "session_start") return "thinking";
  if (event.event === "tool_start") {
    if (event.tool === "Read" || event.tool === "Notebook" || event.tool === "ViewImage") return "tool_read";
    if (event.tool === "Edit" || event.tool === "Write" || event.tool === "ApplyPatch") return "tool_edit";
    if (event.tool === "Bash" || event.tool === "Shell") return "tool_bash";
    if (event.tool === "Grep" || event.tool === "Glob" || event.tool === "WebFetch" || event.tool === "WebSearch") return "tool_search";
    if (event.tool === "MCP") return "tool_mcp";
    if (event.tool === "Skill") return "skill";
    if (event.tool === "Task" || event.tool === "TaskCreate" || event.tool === "TaskUpdate" || event.tool === "UpdatePlan") return "task";
    if (event.tool === "Agent") return "agent";
    return "thinking";
  }
  if (event.event === "notification") return "waiting_permission";
  return "idle";
}


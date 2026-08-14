export const DSH_PROVIDER_PROTOCOLS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages"
] as const;

export type DshProviderProtocol = typeof DSH_PROVIDER_PROTOCOLS[number];

export const DSH_REASONING_EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;

export type DshReasoningEffort = typeof DSH_REASONING_EFFORTS[number];
export type DshReasoningEfforts = Partial<Record<DshReasoningEffort, string | null>>;

export const DEFAULT_DSH_REASONING_EFFORTS: DshReasoningEfforts = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};

export type DshProviderModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoningEfforts?: DshReasoningEfforts | false;
};

export type DshProviderUiMeta = {
  websiteUrl?: string;
  apiKeyUrl?: string;
  category?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  createdAt?: number;
  sortIndex?: number;
  preferredModel?: string;
};

export type DshCatalogProvider = {
  id: string;
  name: string;
  active: boolean;
  declared?: boolean;
};

export type DshProvider = DshProviderUiMeta & {
  id: string;
  name: string;
  baseUrl: string;
  protocol?: DshProviderProtocol | "deepseek-chat-completions";
  models: DshProviderModel[];
  modelsInherited: boolean;
  catalogProvider: boolean;
  enabled: boolean;
  runtimeActive: boolean;
  credentialRef?: string;
  hasCredential: boolean;
  isOfficial: boolean;
  isDefault: boolean;
  defaultModel?: string;
};

export type DshProviderListResult = {
  ok: boolean;
  providers: DshProvider[];
  catalogProviders: DshCatalogProvider[];
  runtimeAvailable: boolean;
  defaultProvider: string;
  defaultModel: string;
  settingsPath?: string;
  credentialsPath?: string;
  error?: string;
};

export type DshProviderSaveInput = DshProviderUiMeta & {
  id?: string;
  name: string;
  baseUrl?: string;
  protocol?: DshProviderProtocol | "deepseek-chat-completions";
  models?: DshProviderModel[];
  inheritModels?: boolean;
  catalogProvider?: boolean;
  enabled?: boolean;
  reasoningEnabled?: boolean;
  apiKey?: string;
};

export type DshProviderMutationResult = {
  ok: boolean;
  provider?: DshProvider;
  error?: string;
};

export type DshProviderSwitchResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  error?: string;
};

export type DshProviderProbeResult = {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  models?: DshProviderModel[];
  error?: string;
};

export type DshProviderProbeInput = {
  id?: string;
  baseUrl?: string;
  protocol?: DshProviderProtocol | "deepseek-chat-completions";
  apiKey?: string;
  mode?: "connectivity" | "models";
};

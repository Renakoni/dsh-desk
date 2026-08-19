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

export type DshProviderModelReasoning = {
  efforts: Array<{
    id: string;
    name: string;
  }>;
  defaultEffort?: string;
};

export type DshProviderModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoningEfforts?: DshReasoningEfforts | false;
  reasoning?: DshProviderModelReasoning;
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
  apiKey?: string;
  hasCredential: boolean;
  isOfficial: boolean;
  isDefault: boolean;
  defaultModel?: string;
  reasoningDefault?: DshReasoningEffort;
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
  reasoningDefault?: DshReasoningEffort;
  apiKey?: string;
};

export type DshProviderMutationResult = {
  ok: boolean;
  provider?: DshProvider;
  sessionSyncFailed?: boolean;
  error?: string;
};

export type DshProviderSwitchResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  sessionSyncFailed?: boolean;
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

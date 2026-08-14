import type { DshCatalogProvider, DshProviderModel, DshProviderProtocol } from "../../../../shared/dshProviders";
import { inferIconForPreset } from "./iconInference";
import { legacyProviderPresets, type LegacyProviderPreset } from "./legacyPresets";

export type DshProviderPreset = {
  id: string;
  providerId?: string;
  name: string;
  category: string;
  protocol?: DshProviderProtocol;
  baseUrl?: string;
  websiteUrl?: string;
  apiKeyUrl?: string;
  icon?: string;
  iconColor?: string;
  models: DshProviderModel[];
  preferredModel?: string;
  catalogProvider: boolean;
  inheritModels: boolean;
};

const MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL"
] as const;

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "");
}

function matchingCatalogProvider(preset: LegacyProviderPreset, catalog: DshCatalogProvider[]) {
  const target = normalizedName(preset.name);
  return catalog.find(provider => normalizedName(provider.id) === target || normalizedName(provider.name) === target);
}

function protocolForPreset(preset: LegacyProviderPreset): DshProviderProtocol | undefined {
  switch (preset.apiFormat ?? "anthropic") {
    case "anthropic": return "anthropic-messages";
    case "openai_chat": return "openai-completions";
    case "openai_responses": return "openai-responses";
    default: return undefined;
  }
}

function modelsForPreset(preset: LegacyProviderPreset): DshProviderModel[] {
  const env = preset.settingsConfig.env ?? {};
  const seen = new Set<string>();
  return MODEL_ENV_KEYS.flatMap(key => {
    const id = env[key]?.replace(/\s*\[1m\]\s*$/i, "").trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id }];
  });
}

export function dshProviderPresets(catalog: DshCatalogProvider[]): DshProviderPreset[] {
  return legacyProviderPresets.flatMap((preset, index) => {
    if (preset.name === "DeepSeek") return [];
    const protocol = protocolForPreset(preset);
    if (!protocol) return [];
    const catalogProvider = matchingCatalogProvider(preset, catalog);
    const inferredIcon = inferIconForPreset(`${preset.name} ${catalogProvider?.id ?? ""}`);
    const common = {
      id: `legacy-${index}`,
      name: preset.name,
      category: preset.category ?? "custom",
      websiteUrl: preset.websiteUrl,
      apiKeyUrl: preset.apiKeyUrl,
      icon: preset.icon ?? inferredIcon.icon,
      iconColor: preset.iconColor ?? inferredIcon.iconColor
    };
    if (catalogProvider) {
      return [{
        ...common,
        providerId: catalogProvider.id,
        models: [],
        catalogProvider: true,
        inheritModels: true
      }];
    }
    const models = modelsForPreset(preset);
    return [{
      ...common,
      baseUrl: preset.settingsConfig.env?.ANTHROPIC_BASE_URL,
      protocol,
      models,
      preferredModel: models[0]?.id,
      catalogProvider: false,
      inheritModels: false
    }];
  });
}

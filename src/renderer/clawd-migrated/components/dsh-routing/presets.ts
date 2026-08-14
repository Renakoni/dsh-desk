import type { DshCatalogProvider, DshProviderProtocol } from "../../../../shared/dshProviders";
import { inferIconForPreset } from "./iconInference";

export type DshProviderPreset = {
  id: string;
  name: string;
  category: "catalog" | "custom";
  protocol?: DshProviderProtocol;
  baseUrl?: string;
  websiteUrl?: string;
  apiKeyUrl?: string;
  icon?: string;
  iconColor?: string;
  inheritModels: boolean;
};

export function catalogProviderPresets(catalog: DshCatalogProvider[]): DshProviderPreset[] {
  return catalog.map(provider => ({
    id: provider.id,
    name: provider.name,
    category: "catalog",
    inheritModels: true,
    ...inferIconForPreset(`${provider.id} ${provider.name}`)
  }));
}

import type { ClaudeProfileResource } from "../../../../shared/claudeProfiles";

export type ClaudeProfileResourceTab = "skills" | "plugins" | "mcpServers";

export function unavailableProfileResources(
  resourceIds: string[],
  availableResources: ClaudeProfileResource[],
  tab: ClaudeProfileResourceTab,
  zh: boolean
): ClaudeProfileResource[] {
  const availableIds = new Set(availableResources.map(resource => resource.id));
  const kind = tab === "skills" ? "skill" as const : tab === "plugins" ? "plugin" as const : "mcp" as const;
  return resourceIds
    .filter(resourceId => !availableIds.has(resourceId))
    .map(resourceId => ({
      id: resourceId,
      kind,
      name: resourceId.replace(/^[^:]+:/, ""),
      description: zh ? "当前环境中已不存在" : "No longer available in the current environment",
      enabled: false
    }));
}

export function filterProfileResources(
  resources: ClaudeProfileResource[],
  query: string,
  hideSensitiveContent: boolean
) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return resources;
  return resources.filter(resource => [
    resource.name,
    ...(hideSensitiveContent ? [] : [resource.description, resource.detail])
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle));
}

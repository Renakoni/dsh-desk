import type { DshResourceItem } from "../../../../shared/dshResources";

export type DshResourceTab = "skills" | "plugins";

export function unavailableDshResources(
  resourceIds: string[],
  availableResources: DshResourceItem[],
  tab: DshResourceTab,
  zh: boolean
): DshResourceItem[] {
  const availableIds = new Set(availableResources.map(resource => resource.id));
  return resourceIds
    .filter(resourceId => !availableIds.has(resourceId))
    .map(resourceId => ({
      id: resourceId,
      kind: tab === "skills" ? "skill" : "plugin",
      name: resourceId.replace(/^[^:]+:/, ""),
      description: zh ? "当前环境中已不存在" : "No longer available in the current environment",
      enabled: false,
      manageable: false
    }));
}

export function filterDshResources(resources: DshResourceItem[], query: string, hideSensitiveContent: boolean) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return resources;
  return resources.filter(resource => [
    resource.name,
    ...(hideSensitiveContent ? [] : [resource.description, resource.detail])
  ].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
}

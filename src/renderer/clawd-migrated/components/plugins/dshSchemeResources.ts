import type { DshResourceItem } from "../../../../shared/dshResources";

export type DshResourceTab = "skills" | "plugins";

export function unavailableDshResources(
  resourceIds: string[],
  availableResources: DshResourceItem[],
  tab: DshResourceTab,
  missingDescription: string
): DshResourceItem[] {
  const availableIds = new Set(availableResources.map(resource => resource.id));
  return resourceIds
    .filter(resourceId => !availableIds.has(resourceId))
    .map(resourceId => ({
      id: resourceId,
      kind: tab === "skills" ? "skill" : "plugin",
      name: resourceId.replace(/^[^:]+:/, ""),
      description: missingDescription,
      enabled: false,
      manageable: false,
      missing: true
    }));
}

export function dshResourcePresentation(resource: DshResourceItem, hideSensitiveContent: boolean, hiddenDescription: string) {
  if (hideSensitiveContent) return { description: hiddenDescription };
  const name = resource.name.trim().toLocaleLowerCase();
  const description = resource.description?.trim();
  const visibleDescription = description && description.toLocaleLowerCase() !== name ? description : undefined;
  const detail = resource.detail?.trim();
  const visibleDetail = detail
    && detail.toLocaleLowerCase() !== name
    && detail.toLocaleLowerCase() !== visibleDescription?.toLocaleLowerCase()
    ? detail
    : undefined;
  return {
    ...(visibleDescription ? { description: visibleDescription } : {}),
    ...(visibleDetail ? { detail: visibleDetail } : {})
  };
}

export function filterDshResources(resources: DshResourceItem[], query: string, hideSensitiveContent: boolean) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return resources;
  return resources.filter(resource => [
    resource.name,
    ...(hideSensitiveContent ? [] : [resource.description, resource.detail])
  ].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
}

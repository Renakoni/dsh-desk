import type { DshResourceItem } from "../../../../shared/dshResources";

export type DshResourceTab = "skills" | "plugins";

export function visibleDshSchemeResourceIds(
  resourceIds: string[],
  runtimeConnected: boolean,
  allPluginIds: string[],
  tab: DshResourceTab,
  availableResources: DshResourceItem[]
): string[] {
  if (tab === "skills") return resourceIds;
  const known = new Set(allPluginIds);
  const available = new Set(availableResources.map(resource => resource.id));
  const runtimePackages = new Set(availableResources
    .filter(resource => !resource.id.startsWith("plugin:package:"))
    .map(resource => resource.packageName ?? resource.name));
  return resourceIds.filter(id => {
    const packageAlias = id.startsWith("plugin:package:");
    if (!known.has(id) || available.has(id)) return true;
    if (!runtimeConnected) return packageAlias;
    return packageAlias
      ? !runtimePackages.has(id.slice("plugin:package:".length))
      : true;
  });
}

export function unavailableDshResources(
  resourceIds: string[],
  availableResources: DshResourceItem[],
  tab: DshResourceTab,
  missingDescription: string,
  knownResourceIds: string[] = []
): DshResourceItem[] {
  const availableIds = new Set(availableResources.map(resource => resource.id));
  const knownIds = new Set(knownResourceIds);
  return resourceIds
    .filter(resourceId => !availableIds.has(resourceId))
    .map(resourceId => {
      const knownPackage = tab === "plugins"
        && resourceId.startsWith("plugin:package:")
        && knownIds.has(resourceId);
      return {
        id: resourceId,
        kind: tab === "skills" ? "skill" as const : "plugin" as const,
        name: tab === "skills" ? resourceId.split(":").at(-1) ?? resourceId : resourceId.replace(/^[^:]+:/, ""),
        ...(knownPackage ? {} : { description: missingDescription }),
        enabled: knownPackage,
        manageable: false,
        ...(knownPackage ? { schemeSelectable: true } : { missing: true })
      };
    });
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

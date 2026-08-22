import type { DshResourceItem } from "../../../../shared/dshResources";

export type DshResourceTab = "skills" | "plugins";
const PACKAGE_PLUGIN_PREFIX = "plugin:package:";

export function isBaseThemeResource(resource: DshResourceItem): boolean {
  return resource.appearance?.components.includes("base-theme") === true;
}

export function logicalDshResources(resources: DshResourceItem[], tab: DshResourceTab): DshResourceItem[] {
  if (tab === "skills") return resources;
  const grouped = new Map<string, DshResourceItem[]>();
  for (const resource of resources) {
    const packageName = resource.id.startsWith(PACKAGE_PLUGIN_PREFIX)
      ? resource.id.slice(PACKAGE_PLUGIN_PREFIX.length)
      : resource.packageName ?? resource.name;
    const entries = grouped.get(packageName) ?? [];
    entries.push(resource);
    grouped.set(packageName, entries);
  }
  return [...grouped.entries()].map(([packageName, entries]) => {
    const representative = entries.find(item => item.id === `${PACKAGE_PLUGIN_PREFIX}${packageName}`)
      ?? entries.find(item => item.description)
      ?? entries[0];
    const required = entries.some(item => item.required);
    const components = [...new Map(entries.flatMap(item => item.components ?? []).map(component => [component.key, component])).values()];
    return {
      ...representative,
      id: `${PACKAGE_PLUGIN_PREFIX}${packageName}`,
      packageName,
      detail: packageName,
      enabled: entries.every(item => item.enabled),
      manageable: !required && entries.some(item => item.manageable),
      schemeSelectable: entries.some(item => item.schemeSelectable ?? item.manageable),
      ...(components.length > 0 ? { components } : {}),
      required
    };
  });
}

export function visibleDshSchemeResourceIds(
  resourceIds: string[]
): string[] {
  return [...new Set(resourceIds)];
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
      const knownPlugin = tab === "plugins" && knownIds.has(resourceId);
      return {
        id: resourceId,
        kind: tab === "skills" ? "skill" as const : "plugin" as const,
        name: tab === "skills" ? resourceId.split(":").at(-1) ?? resourceId : resourceId.replace(/^[^:]+:/, ""),
        ...(knownPlugin ? {} : { description: missingDescription }),
        enabled: knownPlugin,
        manageable: false,
        ...(knownPlugin ? { schemeSelectable: true } : { missing: true })
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
    ...(hideSensitiveContent ? [] : [
      resource.description,
      resource.detail,
      ...(resource.components ?? []).flatMap(component => [component.name, component.moduleName])
    ])
  ].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
}

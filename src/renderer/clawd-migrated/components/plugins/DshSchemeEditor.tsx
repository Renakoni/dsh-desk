import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Code2, Package, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { isDshResourceSchemeSelectable, type DshPluginComponentOverrideState, type DshResourceInventory, type DshResourceItem, type DshResourceSchemeSaveInput } from "../../../../shared/dshResources";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";
import { dshResourcePresentation, filterDshResources, logicalDshResources, unavailableDshResources, visibleDshSchemeResourceIds, type DshResourceTab } from "./dshSchemeResources";
import { useVirtualRows } from "./useVirtualRows";

const ROW_HEIGHT = 64;
const OVERSCAN = 5;
type SchemeEditorTab = DshResourceTab | "components";

export function DshSchemeEditor({
  initial,
  inventory,
  knownPluginIds,
  protectedScheme,
  canDelete,
  busy,
  hideSensitiveContent,
  onCancel,
  onSave,
  onDelete
}: {
  initial: DshResourceSchemeSaveInput;
  inventory: DshResourceInventory;
  knownPluginIds: string[];
  protectedScheme: boolean;
  canDelete: boolean;
  busy: boolean;
  hideSensitiveContent: boolean;
  onCancel: () => void;
  onSave: (input: DshResourceSchemeSaveInput) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const logicalInventory = useMemo(() => ({
    skills: logicalDshResources(inventory.skills, "skills"),
    plugins: logicalDshResources(inventory.plugins, "plugins")
  }), [inventory.plugins, inventory.skills]);
  const [draft, setDraft] = useState<DshResourceSchemeSaveInput>(() => ({
    ...initial,
    pluginComponentOverrides: [...(initial.pluginComponentOverrides ?? [])],
    skills: [...new Set([...logicalInventory.skills.filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id), ...initial.skills])],
    plugins: [...new Set([...logicalInventory.plugins.filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id), ...initial.plugins])]
  }));
  const [activeTab, setActiveTab] = useState<SchemeEditorTab>("plugins");
  const [query, setQuery] = useState("");
  const [missingRemoval, setMissingRemoval] = useState<DshResourceItem | null>(null);
  const [componentWarning, setComponentWarning] = useState<{
    resource: DshResourceItem;
    componentKey: string;
    componentName: string;
    state: DshPluginComponentOverrideState;
  } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const tabs = [
    { id: "plugins" as const, label: t("dshResources.pluginTab", "Plugins"), icon: Package },
    { id: "skills" as const, label: t("dshResources.skillTab", "Skills"), icon: Code2 },
    { id: "components" as const, label: t("dshResources.componentTab", "Components"), icon: SlidersHorizontal }
  ];
  const resourceTab: DshResourceTab = activeTab === "components" ? "plugins" : activeTab;
  const availableResources = logicalInventory[resourceTab];
  const visibleDraftIds = useMemo(
    () => visibleDshSchemeResourceIds(draft[resourceTab]),
    [draft, resourceTab]
  );
  const visibleKnownCandidateIds = useMemo(
    () => resourceTab === "plugins"
      ? visibleDshSchemeResourceIds(
        [...new Set([
          ...knownPluginIds.filter(id => id.startsWith("plugin:package:")),
          ...initial.plugins.filter(id => knownPluginIds.includes(id))
        ])]
      )
      : [],
    [initial.plugins, knownPluginIds, resourceTab]
  );
  const candidateIds = useMemo(
    () => [...new Set([...visibleDraftIds, ...visibleKnownCandidateIds])],
    [visibleDraftIds, visibleKnownCandidateIds]
  );
  const resources = useMemo<DshResourceItem[]>(() => [
    ...availableResources,
    ...unavailableDshResources(candidateIds, availableResources, resourceTab, t("dshResources.noLongerInstalled", "No longer installed"), knownPluginIds)
  ], [availableResources, candidateIds, knownPluginIds, resourceTab, t]);
  const selected = useMemo(() => new Set(visibleDraftIds), [visibleDraftIds]);
  const filtered = useMemo(() => filterDshResources(resources, deferredQuery, hideSensitiveContent), [deferredQuery, hideSensitiveContent, resources]);
  const unselected = useMemo(() => filtered.filter(resource => !selected.has(resource.id)), [filtered, selected]);
  const selectedItems = useMemo(() => filtered.filter(resource => selected.has(resource.id)), [filtered, selected]);
  const componentBundles = useMemo(() => {
    const selectedPlugins = new Set(visibleDshSchemeResourceIds(draft.plugins));
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return logicalInventory.plugins
      .filter(resource => selectedPlugins.has(resource.id) && (resource.components?.length ?? 0) > 0)
      .map(resource => ({
        resource,
        components: (resource.components ?? []).filter(component => !needle || [resource.name, component.name, component.moduleName]
          .some(value => value.toLocaleLowerCase().includes(needle)))
      }))
      .filter(bundle => bundle.components.length > 0);
  }, [deferredQuery, draft.plugins, logicalInventory.plugins]);

  useEffect(() => setQuery(""), [activeTab]);

  function moveResource(resource: DshResourceItem) {
    const next = new Set(selected);
    if (next.has(resource.id)) next.delete(resource.id); else next.add(resource.id);
    setDraft(current => {
      const visible = new Set(visibleDshSchemeResourceIds(current[resourceTab]));
      const hidden = current[resourceTab].filter(id => !visible.has(id));
      return { ...current, [resourceTab]: [...hidden, ...resources.filter(item => next.has(item.id)).map(item => item.id)] };
    });
  }

  function applyComponentState(resource: DshResourceItem, componentKey: string, state: DshPluginComponentOverrideState | "default") {
    if (!resource.packageName) return;
    setDraft(current => {
      const overrides = (current.pluginComponentOverrides ?? []).filter(item => item.componentKey !== componentKey);
      if (state !== "default") overrides.push({ packageName: resource.packageName as string, componentKey, state });
      return { ...current, pluginComponentOverrides: overrides };
    });
  }

  function requestComponentState(resource: DshResourceItem, componentKey: string, componentName: string, state: DshPluginComponentOverrideState | "default") {
    if (resource.required && state !== "default") {
      setComponentWarning({ resource, componentKey, componentName, state });
      return;
    }
    applyComponentState(resource, componentKey, state);
  }

  function toggleResource(resource: DshResourceItem) {
    if (resource.required || !isDshResourceSchemeSelectable(resource)) return;
    if (selected.has(resource.id) && resource.missing) {
      setMissingRemoval(resource);
      return;
    }
    moveResource(resource);
  }

  const title = t(initial.id ? "dshResources.editScheme" : "dshResources.newScheme", initial.id ? "Edit scheme" : "New scheme");

  return (
    <div className="claude-profile-editor dsh-scheme-editor">
      <header className="claude-profile-editor-header">
        <button type="button" className="claude-profile-icon-button" onClick={onCancel} disabled={busy} aria-label={t("common.back", "Back")}><ArrowLeft size={17} /></button>
        <h2>{title}</h2>
        <div className="claude-profile-name-field">
          <input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={t("dshResources.schemeName", "Name")} aria-label={t("dshResources.schemeName", "Name")} maxLength={64} disabled={busy || protectedScheme} />
        </div>
        <div className="claude-profile-editor-actions">
          {initial.id && !protectedScheme ? <button type="button" className="claude-profile-text-button danger" onClick={onDelete} disabled={busy || !canDelete}><Trash2 size={15} /> {t("common.delete", "Delete")}</button> : null}
          <button type="button" className="claude-profile-text-button" onClick={onCancel} disabled={busy}>{t("common.cancel", "Cancel")}</button>
          <button type="button" className="claude-profile-primary-button" onClick={() => onSave({ ...draft, name: draft.name.trim(), description: draft.description?.trim() || undefined })} disabled={busy || !draft.name.trim()}>{busy ? t("dshResources.saving", "Saving...") : t("common.save", "Save")}</button>
        </div>
      </header>

      <nav className="claude-resource-subtabs compact claude-profile-editor-tabs dsh-scheme-editor-tabs" aria-label={t("dshResources.resourceType", "Resource type")}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          return <button type="button" key={tab.id} className={`claude-resource-subtab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}><Icon size={16} /><span><b>{tab.label}</b></span></button>;
        })}
      </nav>

      <section className="claude-profile-editor-toolbar"><div className="claude-resource-search dark dsh-plugin-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t(activeTab === "plugins" ? "dshResources.searchPlugins" : activeTab === "skills" ? "dshResources.searchSkills" : "dshResources.searchComponents", activeTab === "plugins" ? "Search plugins" : activeTab === "skills" ? "Search skills" : "Search components")} /></div></section>
      {activeTab === "components" ? <SchemeComponentList bundles={componentBundles} draft={draft} busy={busy} hideSensitiveContent={hideSensitiveContent} onState={requestComponentState} /> : <section className="claude-profile-transfer" aria-busy={busy}>
        <TransferColumn title={t("dshResources.unselected", "Not included")} side="unselected" items={unselected} hideSensitiveContent={hideSensitiveContent} busy={busy} resetKey={`${activeTab}:${deferredQuery}:unselected`} onMove={toggleResource} />
        <TransferColumn title={t("dshResources.selected", "Included")} side="selected" items={selectedItems} hideSensitiveContent={hideSensitiveContent} busy={busy} resetKey={`${activeTab}:${deferredQuery}:selected`} onMove={toggleResource} />
      </section>}
      {missingRemoval ? (
        <ConfirmDialog
          title={t("dshResources.removeMissingTitle", "Remove missing entry?")}
          cancelLabel={t("common.cancel", "Cancel")}
          confirmLabel={t("dshResources.removeRecord", "Remove entry")}
          danger
          onCancel={() => setMissingRemoval(null)}
          onConfirm={() => { const resource = missingRemoval; setMissingRemoval(null); moveResource(resource); }}
        >
          <p>{t("dshResources.removeMissingMessage", "\"{name}\" is no longer installed. Remove this entry from the current scheme?", { name: missingRemoval.name })}</p>
        </ConfirmDialog>
      ) : null}
      {componentWarning ? <ConfirmDialog
        title={t("dshResources.componentWarningTitle", "Override a required component?")}
        cancelLabel={t("common.cancel", "Cancel")}
        confirmLabel={t("dshResources.componentWarningConfirm", "Apply override")}
        onCancel={() => setComponentWarning(null)}
        onConfirm={() => {
          const pending = componentWarning;
          setComponentWarning(null);
          applyComponentState(pending.resource, pending.componentKey, pending.state);
        }}
      ><p>{t("dshResources.componentWarningMessage", "{component} belongs to the required bundle {package}. Forcing its state may affect DSH startup or features.", { component: componentWarning.componentName, package: componentWarning.resource.packageName ?? componentWarning.resource.name })}</p></ConfirmDialog> : null}
    </div>
  );
}

function SchemeComponentList({ bundles, draft, busy, hideSensitiveContent, onState }: {
  bundles: Array<{ resource: DshResourceItem; components: NonNullable<DshResourceItem["components"]> }>;
  draft: DshResourceSchemeSaveInput;
  busy: boolean;
  hideSensitiveContent: boolean;
  onState: (resource: DshResourceItem, componentKey: string, componentName: string, state: DshPluginComponentOverrideState | "default") => void;
}) {
  const { t } = useI18n();
  if (bundles.length === 0) return <section className="dsh-scheme-component-list"><div className="claude-profile-transfer-empty">{t("dshResources.noComponents", "No components in the selected plugins")}</div></section>;
  return <section className="dsh-scheme-component-list" aria-busy={busy}>{bundles.map(({ resource, components }) => (
    <div className="dsh-scheme-component-bundle" key={resource.id}>
      <header><strong>{resource.name}</strong>{resource.required ? <span>{t("dshResources.required", "Required")}</span> : null}</header>
      {components.map(component => {
        const override = [...(draft.pluginComponentOverrides ?? [])].reverse().find(item => item.componentKey === component.key)?.state ?? "default";
        return <div className="dsh-scheme-component-row" key={component.key}>
          <span className="dsh-component-copy"><strong>{component.name}</strong><code title={component.moduleName}>{hideSensitiveContent ? t("dshResources.detailsHidden", "Resource details hidden") : component.moduleName}</code></span>
          {component.manageable ? <div className="dsh-component-segments" role="group" aria-label={t("dshResources.componentMode", "{name} mode", { name: component.name })}>{([
            ["default", t("dshResources.componentDefault", "Default")],
            ["enabled", t("dshResources.componentEnable", "Enable")],
            ["disabled", t("dshResources.componentDisable", "Disable")]
          ] as const).map(([state, label]) => <button type="button" key={state} className={override === state ? "selected" : ""} disabled={busy} aria-pressed={override === state} aria-label={`${label} ${component.name}`} onClick={() => onState(resource, component.key, component.name, state)}>{label}</button>)}</div> : <span className="dsh-component-locked">{t("dshResources.componentRequired", "Required")}</span>}
        </div>;
      })}
    </div>
  ))}</section>;
}

function TransferColumn({ title, side, items, hideSensitiveContent, busy, resetKey, onMove }: {
  title: string;
  side: "unselected" | "selected";
  items: DshResourceItem[];
  hideSensitiveContent: boolean;
  busy: boolean;
  resetKey: string;
  onMove: (resource: DshResourceItem) => void;
}) {
  const { t } = useI18n();
  const virtual = useVirtualRows(items, ROW_HEIGHT, resetKey, OVERSCAN);
  return (
    <div className="claude-profile-transfer-column" data-transfer-side={side}>
      <header>{title}</header>
      <div ref={virtual.viewportRef} className="claude-profile-virtual-list" onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
        {items.length === 0 ? <div className="claude-profile-transfer-empty">{t("dshResources.noMatches", "No matches")}</div> : (
          <div className="claude-profile-virtual-space" style={{ height: virtual.totalHeight }}>
            {virtual.visible.map((resource, offset) => {
              const index = virtual.start + offset;
              const presentation = dshResourcePresentation(resource, hideSensitiveContent, t("dshResources.detailsHidden", "Resource details hidden"));
              const description = resource.packageName === "dsh-desk-plugin"
                ? t("dshResources.bridgeDescription", "Local bridge between DSH Desk and DeepSeek Harness")
                : presentation.description ?? presentation.detail;
              return (
                <button type="button" key={resource.id} className={`claude-profile-transfer-option ${resource.required || !isDshResourceSchemeSelectable(resource) ? "required" : ""}`} style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }} disabled={busy || resource.required || !isDshResourceSchemeSelectable(resource)} onClick={() => onMove(resource)}>
                  <span className="claude-profile-resource-copy"><strong>{resource.name}</strong>{description ? <small title={description}>{description}</small> : null}</span>
                  <span className={`claude-profile-live-state ${resource.missing ? "missing" : resource.enabled ? "active" : "idle"}`}>{t(resource.missing ? "dshResources.missing" : resource.required ? "dshResources.required" : resource.enabled ? "dshResources.enabled" : "dshResources.disabled", resource.missing ? "Missing" : resource.required ? "Required" : resource.enabled ? "Enabled" : "Disabled")}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

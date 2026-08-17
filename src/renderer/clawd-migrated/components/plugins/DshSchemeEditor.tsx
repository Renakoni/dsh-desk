import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Code2, Package, Search, Trash2 } from "lucide-react";
import { isDshResourceSchemeSelectable, type DshResourceInventory, type DshResourceItem, type DshResourceSchemeSaveInput } from "../../../../shared/dshResources";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";
import { dshResourcePresentation, filterDshResources, logicalDshResources, unavailableDshResources, visibleDshSchemeResourceIds, type DshResourceTab } from "./dshSchemeResources";
import { useVirtualRows } from "./useVirtualRows";

const ROW_HEIGHT = 64;
const OVERSCAN = 5;

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
    skills: [...new Set([...logicalInventory.skills.filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id), ...initial.skills])],
    plugins: [...new Set([...logicalInventory.plugins.filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id), ...initial.plugins])]
  }));
  const [activeTab, setActiveTab] = useState<DshResourceTab>("plugins");
  const [query, setQuery] = useState("");
  const [missingRemoval, setMissingRemoval] = useState<DshResourceItem | null>(null);
  const deferredQuery = useDeferredValue(query);
  const tabs = [
    { id: "plugins" as const, label: t("dshResources.pluginTab", "Plugins"), icon: Package },
    { id: "skills" as const, label: t("dshResources.skillTab", "Skills"), icon: Code2 }
  ];
  const availableResources = logicalInventory[activeTab];
  const visibleDraftIds = useMemo(
    () => visibleDshSchemeResourceIds(draft[activeTab]),
    [activeTab, draft]
  );
  const visibleKnownCandidateIds = useMemo(
    () => activeTab === "plugins"
      ? visibleDshSchemeResourceIds(
        [...new Set([
          ...knownPluginIds.filter(id => id.startsWith("plugin:package:")),
          ...initial.plugins.filter(id => knownPluginIds.includes(id))
        ])]
      )
      : [],
    [activeTab, initial.plugins, knownPluginIds]
  );
  const candidateIds = useMemo(
    () => [...new Set([...visibleDraftIds, ...visibleKnownCandidateIds])],
    [visibleDraftIds, visibleKnownCandidateIds]
  );
  const resources = useMemo<DshResourceItem[]>(() => [
    ...availableResources,
    ...unavailableDshResources(candidateIds, availableResources, activeTab, t("dshResources.noLongerInstalled", "No longer installed"), knownPluginIds)
  ], [activeTab, availableResources, candidateIds, knownPluginIds, t]);
  const selected = useMemo(() => new Set(visibleDraftIds), [visibleDraftIds]);
  const filtered = useMemo(() => filterDshResources(resources, deferredQuery, hideSensitiveContent), [deferredQuery, hideSensitiveContent, resources]);
  const unselected = useMemo(() => filtered.filter(resource => !selected.has(resource.id)), [filtered, selected]);
  const selectedItems = useMemo(() => filtered.filter(resource => selected.has(resource.id)), [filtered, selected]);

  useEffect(() => setQuery(""), [activeTab]);

  function moveResource(resource: DshResourceItem) {
    const next = new Set(selected);
    if (next.has(resource.id)) next.delete(resource.id); else next.add(resource.id);
    setDraft(current => {
      const visible = new Set(visibleDshSchemeResourceIds(current[activeTab]));
      const hidden = current[activeTab].filter(id => !visible.has(id));
      return { ...current, [activeTab]: [...hidden, ...resources.filter(item => next.has(item.id)).map(item => item.id)] };
    });
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
    <div className="claude-profile-editor">
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

      <section className="claude-profile-editor-toolbar"><div className="claude-resource-search dark"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t(activeTab === "plugins" ? "dshResources.searchPlugins" : "dshResources.searchSkills", activeTab === "plugins" ? "Search plugins" : "Search skills")} /></div></section>
      <section className="claude-profile-transfer" aria-busy={busy}>
        <TransferColumn title={t("dshResources.unselected", "Not included")} side="unselected" items={unselected} hideSensitiveContent={hideSensitiveContent} busy={busy} resetKey={`${activeTab}:${deferredQuery}:unselected`} onMove={toggleResource} />
        <TransferColumn title={t("dshResources.selected", "Included")} side="selected" items={selectedItems} hideSensitiveContent={hideSensitiveContent} busy={busy} resetKey={`${activeTab}:${deferredQuery}:selected`} onMove={toggleResource} />
      </section>
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
    </div>
  );
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
              const description = presentation.description ?? presentation.detail;
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

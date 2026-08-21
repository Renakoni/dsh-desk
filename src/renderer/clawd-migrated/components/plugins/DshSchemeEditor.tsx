import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Code2, Minus, Package, Palette, Search, Trash2, X } from "lucide-react";
import { isDshResourceSchemeSelectable, type DshPluginComponentOverrideState, type DshResourceInventory, type DshResourceItem, type DshResourceSchemeSaveInput } from "../../../../shared/dshResources";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";
import { dshResourcePresentation, filterDshResources, logicalDshResources, unavailableDshResources, visibleDshSchemeResourceIds, type DshResourceTab } from "./dshSchemeResources";
import { RequiredComponentWarningDialog, shouldWarnRequiredComponent } from "./RequiredComponentWarningDialog";
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
    plugins: logicalDshResources(inventory.plugins, "plugins").filter(item => !item.appearance?.components.includes("base-theme"))
  }), [inventory.plugins, inventory.skills]);
  const themes = useMemo(
    () => logicalDshResources(inventory.plugins, "plugins").filter(item => item.appearance?.components.includes("base-theme") && item.appearance.themeId),
    [inventory.plugins]
  );
  const [draft, setDraft] = useState<DshResourceSchemeSaveInput>(() => ({
    ...initial,
    ...(initial.themeId ? { themeId: initial.themeId } : {}),
    pluginComponentOverrides: [...(initial.pluginComponentOverrides ?? [])],
    skills: [...new Set([...logicalInventory.skills.filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id), ...initial.skills])],
    plugins: [...new Set([...logicalInventory.plugins.filter(item => item.required || (!isDshResourceSchemeSelectable(item) && item.enabled)).map(item => item.id), ...initial.plugins])]
  }));
  const [activeTab, setActiveTab] = useState<DshResourceTab>("plugins");
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
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

  function applyComponentState(resource: DshResourceItem, componentKey: string, state: DshPluginComponentOverrideState | "default") {
    if (!resource.packageName) return;
    setDraft(current => {
      const overrides = (current.pluginComponentOverrides ?? []).filter(item => item.componentKey !== componentKey);
      if (state !== "default") overrides.push({ packageName: resource.packageName as string, componentKey, state });
      return { ...current, pluginComponentOverrides: overrides };
    });
  }

  function requestComponentState(resource: DshResourceItem, componentKey: string, componentName: string, state: DshPluginComponentOverrideState | "default") {
    if (resource.required && state !== "default" && shouldWarnRequiredComponent()) {
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
        <div className="dsh-theme-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setThemeMenuOpen(false); }}>
          <button
            type="button"
            className="dsh-theme-picker-trigger"
            aria-haspopup="listbox"
            aria-expanded={themeMenuOpen}
            onClick={() => setThemeMenuOpen(value => !value)}
            disabled={busy}
          >
            <Palette size={16} />
            <span>
              <b>{themes.find(theme => theme.appearance?.themeId === draft.themeId)?.name ?? (draft.themeId || t("dshResources.defaultTheme", "默认主题"))}</b>
              <small>{t("dshResources.baseTheme", "基础主题")}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {themeMenuOpen ? <div className="dsh-theme-picker-menu" role="listbox" aria-label={t("dshResources.themeSlot", "基础主题")}>
            <button type="button" role="option" aria-selected={!draft.themeId} className={!draft.themeId ? "selected" : ""} onClick={() => { setDraft(current => ({ ...current, themeId: undefined })); setThemeMenuOpen(false); }}>
              <span><b>{t("dshResources.noTheme", "默认主题")}</b><small>{t("dshResources.noThemeHint", "使用 DSH 默认外观")}</small></span>
              {!draft.themeId ? <Check size={14} /> : null}
            </button>
            {draft.themeId && !themes.some(theme => theme.appearance?.themeId === draft.themeId) ? <button type="button" role="option" aria-selected className="selected" onClick={() => setThemeMenuOpen(false)}>
              <span><b>{draft.themeId}</b><small>{t("dshResources.missingThemeOption", "主题未安装")}</small></span>
              <Check size={14} />
            </button> : null}
            {themes.map(theme => {
              const themeId = theme.appearance?.themeId as string;
              const selectedTheme = themeId === draft.themeId;
              return <button type="button" role="option" aria-selected={selectedTheme} className={selectedTheme ? "selected" : ""} key={themeId} onClick={() => { setDraft(current => ({ ...current, themeId })); setThemeMenuOpen(false); }}>
                <span><b>{theme.name}</b><small>{theme.packageName ?? themeId}</small></span>
                {selectedTheme ? <Check size={14} /> : null}
              </button>;
            })}
            {themes.length === 0 && !draft.themeId ? <p className="dsh-theme-picker-empty">{t("dshResources.noInstalledThemes", "尚未安装主题")}</p> : null}
          </div> : null}
        </div>
      </nav>

      <section className="claude-profile-editor-toolbar"><div className="claude-resource-search dark dsh-plugin-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t(activeTab === "plugins" ? "dshResources.searchPlugins" : "dshResources.searchSkills", activeTab === "plugins" ? "Search plugins" : "Search skills")} /></div></section>
      <section className="claude-profile-transfer" aria-busy={busy}>
        <TransferColumn title={t("dshResources.unselected", "Not included")} side="unselected" items={unselected} hideSensitiveContent={hideSensitiveContent} busy={busy} resetKey={`${activeTab}:${deferredQuery}:unselected`} onMove={toggleResource} />
        {activeTab === "plugins" ? <SelectedPluginTreeColumn
          title={t("dshResources.selected", "Included")}
          items={selectedItems}
          draft={draft}
          hideSensitiveContent={hideSensitiveContent}
          busy={busy}
          onMove={toggleResource}
          onComponentState={requestComponentState}
        /> : <TransferColumn title={t("dshResources.selected", "Included")} side="selected" items={selectedItems} hideSensitiveContent={hideSensitiveContent} busy={busy} resetKey={`${activeTab}:${deferredQuery}:selected`} onMove={toggleResource} />}
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
      {componentWarning ? <RequiredComponentWarningDialog
        componentName={componentWarning.componentName}
        packageName={componentWarning.resource.packageName ?? componentWarning.resource.name}
        onCancel={() => setComponentWarning(null)}
        onConfirm={() => {
          const pending = componentWarning;
          setComponentWarning(null);
          applyComponentState(pending.resource, pending.componentKey, pending.state);
        }}
      /> : null}
    </div>
  );
}

function SelectedPluginTreeColumn({ title, items, draft, hideSensitiveContent, busy, onMove, onComponentState }: {
  title: string;
  items: DshResourceItem[];
  draft: DshResourceSchemeSaveInput;
  hideSensitiveContent: boolean;
  busy: boolean;
  onMove: (resource: DshResourceItem) => void;
  onComponentState: (resource: DshResourceItem, componentKey: string, componentName: string, state: DshPluginComponentOverrideState | "default") => void;
}) {
  const { t } = useI18n();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return <div className="claude-profile-transfer-column dsh-scheme-tree-column" data-transfer-side="selected">
    <header>{title}</header>
    <div className="dsh-scheme-tree-list">
      {items.length === 0 ? <div className="claude-profile-transfer-empty">{t("dshResources.noMatches", "No matches")}</div> : items.map(resource => {
        const presentation = dshResourcePresentation(resource, hideSensitiveContent, t("dshResources.detailsHidden", "Resource details hidden"));
        const description = resource.packageName === "dsh-desk-plugin"
          ? t("dshResources.bridgeDescription", "Local bridge between DSH Desk and DeepSeek Harness")
          : presentation.description ?? presentation.detail;
        const components = resource.packageName === "dsh-desk-plugin" ? [] : resource.components ?? [];
        const expanded = components.length === 1 || expandedId === resource.id;
        const fixed = resource.required || !isDshResourceSchemeSelectable(resource);
        return <div className={`dsh-scheme-tree-package ${expanded ? "expanded" : ""}`} key={resource.id}>
          <div className={`dsh-scheme-tree-package-summary ${components.length > 1 ? "has-disclosure" : ""}`}>
            <button type="button" className={`claude-profile-transfer-option dsh-scheme-tree-package-action ${fixed ? "required" : ""}`} disabled={busy || fixed} onClick={() => onMove(resource)}>
              <span className="claude-profile-resource-copy"><strong title={resource.name}>{resource.name}</strong>{description ? <small title={description}>{description}</small> : null}</span>
              <span className={`claude-profile-live-state ${resource.missing ? "missing" : resource.enabled ? "active" : "idle"}`}>{t(resource.missing ? "dshResources.missing" : resource.required ? "dshResources.required" : resource.enabled ? "dshResources.enabled" : "dshResources.disabled", resource.missing ? "Missing" : resource.required ? "Required" : resource.enabled ? "Enabled" : "Disabled")}</span>
            </button>
            {components.length > 1 ? <button
              type="button"
              className="dsh-scheme-tree-disclosure"
              aria-expanded={expanded}
              aria-label={t("dshResources.showComponents", "View {count} components", { count: components.length })}
              disabled={busy}
              onClick={() => setExpandedId(current => current === resource.id ? null : resource.id)}
            >{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{t("dshResources.componentCount", "{count} components", { count: components.length })}</span></button> : null}
          </div>
          {expanded ? <div className="dsh-scheme-tree-components">{components.map(component => {
            const override = [...(draft.pluginComponentOverrides ?? [])].reverse().find(item => item.componentKey === component.key)?.state ?? "default";
            const fullName = hideSensitiveContent ? t("dshResources.detailsHidden", "Resource details hidden") : component.moduleName || component.name;
            return <div className="dsh-scheme-tree-component" key={component.key}>
              <span className="dsh-scheme-tree-branch" aria-hidden="true" />
              <span className="dsh-scheme-tree-component-name" title={fullName}>{fullName}</span>
              {component.manageable ? <div className="dsh-scheme-tree-modes" role="group" aria-label={t("dshResources.componentMode", "{name} mode", { name: component.name })}>{([
                ["default", t("dshResources.componentDefault", "Default"), Minus],
                ["enabled", t("dshResources.componentEnable", "Enable"), Check],
                ["disabled", t("dshResources.componentDisable", "Disable"), X]
              ] as const).map(([state, label, Icon]) => <button
                type="button"
                key={state}
                className={`${state} ${override === state ? "selected" : ""}`}
                title={label}
                disabled={busy}
                aria-pressed={override === state}
                aria-label={`${label} ${component.name}`}
                onClick={() => onComponentState(resource, component.key, component.name, state)}
              ><Icon size={14} /></button>)}</div> : <span className="dsh-scheme-tree-component-locked">{t("dshResources.componentRequired", "Required")}</span>}
            </div>;
          })}</div> : null}
        </div>;
      })}
    </div>
  </div>;
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

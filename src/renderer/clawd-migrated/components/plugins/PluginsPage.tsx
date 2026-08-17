import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Code2, Copy, Package, Pencil, Plus, Power, PowerOff, RefreshCw, Search, Store } from "lucide-react";
import { toast } from "sonner";
import {
  ALL_DSH_SCHEME_ID,
  DEFAULT_DSH_SCHEME_ID,
  createEmptyDshResourceSchemesSnapshot,
  type DshResourceItem,
  type DshResourceScheme,
  type DshResourceSchemeSaveInput,
  type DshResourceSchemesSnapshot
} from "../../../../shared/dshResources";
import { type I18nTranslate, useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";
import { RoutingToaster } from "../dsh-routing/RoutingToaster";
import { DshMarketPanel } from "./DshMarketPanel";
import { DshSchemeEditor } from "./DshSchemeEditor";
import { dshResourcePresentation, filterDshResources, logicalDshResources, unavailableDshResources, visibleDshSchemeResourceIds, type DshResourceTab } from "./dshSchemeResources";
import { useVirtualRows } from "./useVirtualRows";

type BusyAction = "refresh" | "save" | "delete" | "apply" | "resource" | null;
type EditorState = { key: string; initial: DshResourceSchemeSaveInput; protectedScheme: boolean };

const emptySnapshot = createEmptyDshResourceSchemesSnapshot();
const ROW_HEIGHT = 76;

function PluginsPageInner({ hideSensitiveContent, active = true }: { hideSensitiveContent: boolean; active?: boolean }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<DshResourceTab>("plugins");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [snapshot, setSnapshot] = useState<DshResourceSchemesSnapshot>(emptySnapshot);
  const [selectedSchemeId, setSelectedSchemeId] = useState(DEFAULT_DSH_SCHEME_ID);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [schemeMenuOpen, setSchemeMenuOpen] = useState(false);
  const [schemeQuery, setSchemeQuery] = useState("");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const newTriggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef<BusyAction>(null);

  const refresh = useCallback(async () => {
    setBusyAction("refresh");
    setLoadError(null);
    try { setSnapshot(await window.companion.getDshResourceSchemes()); }
    catch { setLoadError(t("dshResources.loadSchemesFailed", "Couldn't load the schemes.")); }
    finally { setLoading(false); setBusyAction(null); }
  }, [t]);

  useEffect(() => { busyRef.current = busyAction; }, [busyAction]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => window.companion.onDshResourcesUpdated(() => { if (active && busyRef.current === null) void refresh(); }), [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (busyRef.current === null) void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);
  useEffect(() => {
    const applied = snapshot.appliedSchemeId;
    setSelectedSchemeId(applied && snapshot.schemes.some(scheme => scheme.id === applied)
      ? applied
      : snapshot.schemes[0]?.id ?? "");
  }, [snapshot.appliedSchemeId, snapshot.schemes]);
  useEffect(() => setQuery(""), [activeTab]);

  const selectedScheme = snapshot.schemes.find(scheme => scheme.id === selectedSchemeId) ?? snapshot.schemes[0];
  const knownPluginIds = useMemo(() => [...new Set([
    ...(snapshot.schemes.find(scheme => scheme.id === ALL_DSH_SCHEME_ID)?.plugins ?? []),
    ...Object.values(snapshot.pluginRuntimePackages).map(packageName => `plugin:package:${packageName}`)
  ])], [snapshot.pluginRuntimePackages, snapshot.schemes]);
  const editorScheme = editor?.initial.id ? snapshot.schemes.find(scheme => scheme.id === editor.initial.id) : undefined;
  const schemeOptions = useMemo(() => {
    const needle = schemeQuery.trim().toLocaleLowerCase();
    return snapshot.schemes.filter(scheme => !needle || [scheme.name, schemeDisplayName(scheme, t)].some(name => name.toLocaleLowerCase().includes(needle))).sort((left, right) => {
      if (left.id === selectedScheme?.id) return -1;
      if (right.id === selectedScheme?.id) return 1;
      return schemeSortGroup(left.id) - schemeSortGroup(right.id) || left.name.localeCompare(right.name);
    });
  }, [schemeQuery, selectedScheme?.id, snapshot.schemes, t]);
  const tabs = [
    { id: "plugins" as const, label: t("dshResources.pluginTab", "Plugins"), icon: Package },
    { id: "skills" as const, label: t("dshResources.skillTab", "Skills"), icon: Code2 }
  ];
  const availableResources = useMemo(
    () => logicalDshResources(snapshot.inventory[activeTab], activeTab),
    [activeTab, snapshot.inventory]
  );
  const items = useMemo(() => {
    const memberIds = visibleDshSchemeResourceIds(selectedScheme?.[activeTab] ?? []);
    const members = new Set(memberIds);
    return [
      ...availableResources.filter(item => members.has(item.id)),
      ...unavailableDshResources(memberIds, availableResources, activeTab, t("dshResources.noLongerInstalled", "No longer installed"), knownPluginIds)
    ];
  }, [activeTab, availableResources, knownPluginIds, selectedScheme, t]);
  const filteredItems = useMemo(() => filterDshResources(items, deferredQuery, hideSensitiveContent), [deferredQuery, hideSensitiveContent, items]);

  function startEdit(scheme: DshResourceScheme) {
    setActionError(null);
    setEditor({ key: `edit:${scheme.id}:${scheme.updatedAt}`, initial: schemeInput(scheme, t), protectedScheme: scheme.isProtected });
  }

  function startCreate(copyCurrent: boolean) {
    const source = copyCurrent ? selectedScheme : undefined;
    setNewMenuOpen(false);
    setEditor({
      key: `create:${source?.id ?? "empty"}:${Date.now()}`,
      initial: {
        name: source ? nextCopyName(schemeDisplayName(source, t), snapshot.schemes, t) : "",
        ...(source?.description ? { description: source.description } : {}),
        skills: source ? [...source.skills] : [],
        plugins: source ? [...source.plugins] : []
      },
      protectedScheme: false
    });
  }

  async function saveScheme(input: DshResourceSchemeSaveInput) {
    setBusyAction("save"); setActionError(null);
    const result = await window.companion.saveDshResourceScheme(input).catch(() => null);
    setBusyAction(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, t) : t("dshResources.saveSchemeFailed", "Couldn't save the scheme."); setActionError(message); toast.error(message); return; }
    setSnapshot(result.snapshot); setEditor(null);
    const saved = result.snapshot.schemes.find(scheme => scheme.id === result.schemeId);
    await switchScheme(result.schemeId, saved ? schemeDisplayName(saved, t) : input.name);
  }

  async function switchScheme(schemeId: string, name: string, notify = true) {
    setBusyAction("apply"); setActionError(null);
    const result = await window.companion.applyDshResourceScheme(schemeId).catch(() => null);
    setBusyAction(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, t) : t("dshResources.applySchemeFailed", "Couldn't apply the scheme."); setActionError(message); toast.error(message); return false; }
    setSnapshot(result.snapshot); setSelectedSchemeId(schemeId); setSchemeMenuOpen(false);
    if (notify) toast.success(t("dshResources.switchedTo", "Switched to \"{name}\".", { name }));
    return true;
  }

  async function deleteScheme(schemeId: string) {
    const scheme = snapshot.schemes.find(item => item.id === schemeId);
    if (!scheme) return;
    setDeleteConfirm(false);
    const defaultScheme = snapshot.schemes.find(item => item.id === DEFAULT_DSH_SCHEME_ID);
    if (scheme.id === snapshot.appliedSchemeId && !await switchScheme(DEFAULT_DSH_SCHEME_ID, defaultScheme ? schemeDisplayName(defaultScheme, t) : t("dshResources.defaultScheme", "Default"), false)) return;
    setBusyAction("delete");
    const result = await window.companion.deleteDshResourceScheme(schemeId).catch(() => null);
    setBusyAction(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, t) : t("dshResources.deleteSchemeFailed", "Couldn't delete the scheme."); setActionError(message); return; }
    setSnapshot(result.snapshot); setEditor(null); setSelectedSchemeId(result.snapshot.appliedSchemeId ?? DEFAULT_DSH_SCHEME_ID);
  }

  async function changeResourceState(resource: DshResourceItem, enabled: boolean) {
    if (!selectedScheme) return;
    setBusyAction("resource"); setBusyResourceId(resource.id);
    const result = await window.companion.setDshResourceState({ schemeId: selectedScheme.id, resourceId: resource.id, enabled }).catch(() => null);
    setBusyAction(null); setBusyResourceId(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, t) : t("dshResources.updateStateFailed", "Couldn't update the resource."); setActionError(message); toast.error(message); return; }
    setSnapshot(result.snapshot);
  }

  if (marketOpen) return <div className="claude-resources-page claude-resources-page-dark claude-profiles-page"><DshMarketPanel onBack={() => setMarketOpen(false)} onChanged={() => void refresh()} /></div>;

  if (editor) return (
    <div className="claude-resources-page claude-resources-page-dark claude-profiles-page">
      <RoutingToaster />
      <DshSchemeEditor key={editor.key} initial={editor.initial} inventory={snapshot.inventory} knownPluginIds={knownPluginIds} protectedScheme={editor.protectedScheme} canDelete={Boolean(editor.initial.id && !editor.protectedScheme)} busy={busyAction !== null} hideSensitiveContent={hideSensitiveContent} onCancel={() => setEditor(null)} onSave={input => void saveScheme(input)} onDelete={() => setDeleteConfirm(true)} />
      {deleteConfirm && editorScheme ? <ConfirmDialog title={t("dshResources.deleteSchemeTitle", "Delete scheme?")} cancelLabel={t("common.cancel", "Cancel")} confirmLabel={t("common.delete", "Delete")} danger onCancel={() => setDeleteConfirm(false)} onConfirm={() => void deleteScheme(editorScheme.id)}><p>{t("dshResources.deleteSchemeMessage", "Delete \"{name}\" permanently?", { name: schemeDisplayName(editorScheme, t) })}</p></ConfirmDialog> : null}
    </div>
  );

  return (
    <div className="claude-resources-page claude-resources-page-dark claude-profiles-page">
      <RoutingToaster />
      <div className="claude-profile-top-row">
        <section className="claude-profile-toolbar">
          <div className="claude-profile-picker"><span>{t("dshResources.scheme", "Scheme")}</span><div className="claude-profile-dropdown" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSchemeMenuOpen(false); }}>
            <button ref={triggerRef} type="button" className="claude-profile-select-button" onClick={() => { setNewMenuOpen(false); setSchemeQuery(""); setSchemeMenuOpen(value => !value); }} disabled={loading || busyAction !== null} aria-haspopup="listbox" aria-expanded={schemeMenuOpen}><span>{selectedScheme ? schemeDisplayName(selectedScheme, t) : t("dshResources.noScheme", "No scheme")}</span><ChevronDown size={14} /></button>
            {schemeMenuOpen ? <div className="claude-profile-options"><label className="claude-profile-options-search"><Search size={13} /><input autoFocus value={schemeQuery} onChange={event => setSchemeQuery(event.target.value)} placeholder={t("dshResources.searchSchemes", "Search schemes")} /></label><div className="claude-profile-options-list" role="listbox">{schemeOptions.map(scheme => { const name = schemeDisplayName(scheme, t); return <button type="button" key={scheme.id} className={scheme.id === selectedScheme?.id ? "current" : ""} onClick={() => void switchScheme(scheme.id, name)}><span>{name}</span>{scheme.id === snapshot.appliedSchemeId ? <Check size={13} /> : null}</button>; })}</div></div> : null}
          </div></div>
          <div className="claude-profile-toolbar-actions">
            <button type="button" className="claude-profile-icon-button" onClick={() => selectedScheme && startEdit(selectedScheme)} disabled={!selectedScheme || selectedScheme.id === ALL_DSH_SCHEME_ID || busyAction !== null} title={t("common.edit", "Edit")}><Pencil size={16} /></button>
            <div className="claude-profile-new-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setNewMenuOpen(false); }}>
              <button ref={newTriggerRef} type="button" className="claude-profile-icon-button" onClick={() => { setSchemeMenuOpen(false); setNewMenuOpen(value => !value); }} disabled={busyAction !== null} title={t("dshResources.newScheme", "New scheme")}><Plus size={17} /></button>
              {newMenuOpen ? <div className="claude-profile-new-options"><button type="button" onClick={() => startCreate(false)}><Plus size={15} /><span><b>{t("dshResources.blankScheme", "Blank scheme")}</b><small>{t("dshResources.blankSchemeHint", "Choose resources from scratch")}</small></span></button><button type="button" onClick={() => startCreate(true)}><Copy size={15} /><span><b>{t("dshResources.copyCurrentScheme", "Duplicate current scheme")}</b><small>{selectedScheme ? schemeDisplayName(selectedScheme, t) : ""}</small></span></button></div> : null}
            </div>
          </div>
        </section>

        <nav className="claude-resource-subtabs compact claude-profile-resource-tabs dsh-resource-tabs" aria-label={t("dshResources.resourceType", "Resource type")}>
          {tabs.map(tab => { const Icon = tab.icon; const count = visibleDshSchemeResourceIds(selectedScheme?.[tab.id] ?? []).length; return <button type="button" key={tab.id} className={`claude-resource-subtab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}><Icon size={16} /><span><b>{tab.label}</b></span><small>{count}</small></button>; })}
          <button type="button" className="claude-resource-subtab claude-resource-refresh-tab dsh-market-button" onClick={() => setMarketOpen(true)} aria-label={t("dshResources.marketplace", "Marketplace")} title={t("dshResources.marketplace", "Marketplace")}><Store size={17} /></button>
        </nav>
      </div>

      {loadError || actionError ? <section className="connection-error">{loadError ?? actionError}</section> : null}
      <section className="claude-resource-list-toolbar"><div className="claude-resource-search dark"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t(activeTab === "plugins" ? "dshResources.searchPlugins" : "dshResources.searchSkills", activeTab === "plugins" ? "Search plugins" : "Search skills")} /></div><button type="button" className="claude-resource-search-refresh" onClick={() => void refresh()} disabled={busyAction !== null} aria-label={t("dshResources.refresh", "Refresh")}><RefreshCw size={17} className={busyAction === "refresh" ? "spinning" : undefined} /></button></section>
      <ResourceTable items={filteredItems} loading={loading} busyResourceId={busyResourceId} hideSensitiveContent={hideSensitiveContent} onState={changeResourceState} />
    </div>
  );
}

function ResourceTable({ items, loading, busyResourceId, hideSensitiveContent, onState }: { items: DshResourceItem[]; loading: boolean; busyResourceId: string | null; hideSensitiveContent: boolean; onState: (resource: DshResourceItem, enabled: boolean) => void }) {
  const { t } = useI18n();
  const virtual = useVirtualRows(items, ROW_HEIGHT, `${items.map(item => item.id).join("|")}:${loading}`, 5);
  return (
    <section ref={virtual.viewportRef} className="claude-resource-table" onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
      <header className="claude-resource-table-head"><span>{t("dshResources.resource", "Resource")}</span><span>{t("dshResources.status", "Status")}</span><span>{t("dshResources.action", "Action")}</span></header>
      {loading && items.length === 0 ? <div className="claude-resource-empty">{t("dshResources.scanning", "Scanning...")}</div> : items.length === 0 ? <div className="claude-resource-empty">{t("dshResources.noResources", "This scheme has no resources of this type.")}</div> : (
        <div className="claude-profile-readonly-space" style={{ height: virtual.totalHeight }}>
          {virtual.visible.map((resource, offset) => {
            const index = virtual.start + offset;
            const presentation = dshResourcePresentation(resource, hideSensitiveContent, t("dshResources.detailsHidden", "Resource details hidden"));
            const busy = busyResourceId === resource.id;
            return (
              <article key={resource.id} className="claude-resource-row claude-profile-readonly-row" style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }}>
                <div className="claude-resource-row-main"><div className="claude-resource-name-line"><strong>{resource.name}</strong></div>{presentation.description ? <p title={presentation.description}>{presentation.description}</p> : null}{presentation.detail ? <code title={presentation.detail}>{presentation.detail}</code> : null}</div>
                <span className={`claude-resource-status ${resource.missing ? "missing" : resource.enabled ? "active" : "idle"}`}>{t(resource.missing ? "dshResources.missing" : resource.enabled ? "dshResources.enabled" : "dshResources.disabled", resource.missing ? "Missing" : resource.enabled ? "Enabled" : "Disabled")}</span>
                {resource.manageable && !resource.required ? <button type="button" className="claude-profile-resource-action" onClick={() => onState(resource, !resource.enabled)} disabled={busyResourceId !== null}>{resource.enabled ? <PowerOff size={13} /> : <Power size={13} />}{busy ? "..." : t(resource.enabled ? "dshResources.disable" : "dshResources.enable", resource.enabled ? "Disable" : "Enable")}</button> : <span className="claude-profile-resource-unavailable">{t(resource.missing ? "dshResources.needsAttention" : resource.required ? "dshResources.required" : "dshResources.unavailable", resource.missing ? "Needs attention" : resource.required ? "Required" : "Unavailable")}</span>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function schemeInput(scheme: DshResourceScheme, t: I18nTranslate): DshResourceSchemeSaveInput { return { id: scheme.id, name: schemeDisplayName(scheme, t), ...(scheme.description ? { description: scheme.description } : {}), skills: [...scheme.skills], plugins: [...scheme.plugins] }; }
function nextCopyName(name: string, schemes: DshResourceScheme[], t: I18nTranslate) { let index = 1; let value = t("dshResources.copyName", "{name} Copy", { name }); while (schemes.some(scheme => scheme.name.toLocaleLowerCase() === value.toLocaleLowerCase())) value = t("dshResources.copyNameNumbered", "{name} Copy {index}", { name, index: ++index }); return value; }
function schemeDisplayName(scheme: DshResourceScheme, t: I18nTranslate) { return scheme.id === DEFAULT_DSH_SCHEME_ID ? t("dshResources.defaultScheme", "Default") : scheme.id === ALL_DSH_SCHEME_ID ? t("dshResources.allScheme", "All") : scheme.name; }
function schemeSortGroup(id: string) { return id === DEFAULT_DSH_SCHEME_ID ? 0 : id === ALL_DSH_SCHEME_ID ? 1 : 2; }
function issueMessage(issues: Array<{ code: string; message: string }>, t: I18nTranslate) {
  const keys: Record<string, string> = {
    "invalid-scheme-input": "invalidScheme",
    "scheme-not-found": "schemeNotFound",
    "protected-scheme": "protectedScheme",
    "duplicate-scheme-name": "duplicateSchemeName",
    "inactive-scheme": "inactiveScheme",
    "missing-resource": "missingResource",
    "protected-resource": "requiredResource",
    "scheme-apply-failed": "applySchemeFailed",
    "resource-state-failed": "updateStateFailed"
  };
  const key = keys[issues[0]?.code];
  return key ? t(`dshResources.${key}`, issues[0]?.message) : t("dshResources.operationFailed", "The operation failed.");
}

export const PluginsPage = React.memo(PluginsPageInner);

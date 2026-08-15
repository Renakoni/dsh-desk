import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Code2, Copy, Package, Pencil, Plus, Power, PowerOff, RefreshCw, Search, Store } from "lucide-react";
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
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";
import { RoutingToaster } from "../dsh-routing/RoutingToaster";
import { DshMarketPanel } from "./DshMarketPanel";
import { DshSchemeEditor } from "./DshSchemeEditor";
import { filterDshResources, unavailableDshResources, type DshResourceTab } from "./dshSchemeResources";
import { useVirtualRows } from "./useVirtualRows";

type BusyAction = "refresh" | "save" | "delete" | "apply" | "resource" | null;
type EditorState = { key: string; initial: DshResourceSchemeSaveInput; protectedScheme: boolean };

const emptySnapshot = createEmptyDshResourceSchemesSnapshot();
const ROW_HEIGHT = 76;

function PluginsPageInner({ hideSensitiveContent, active = true }: { hideSensitiveContent: boolean; active?: boolean }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
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
    catch { setLoadError(zh ? "无法读取配置方案。" : "Resource schemes could not be loaded."); }
    finally { setLoading(false); setBusyAction(null); }
  }, [zh]);

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
    setSelectedSchemeId(current => snapshot.schemes.some(scheme => scheme.id === current)
      ? current
      : applied && snapshot.schemes.some(scheme => scheme.id === applied) ? applied : snapshot.schemes[0]?.id ?? "");
  }, [snapshot.appliedSchemeId, snapshot.schemes]);
  useEffect(() => setQuery(""), [activeTab]);

  const selectedScheme = snapshot.schemes.find(scheme => scheme.id === selectedSchemeId) ?? snapshot.schemes[0];
  const editorScheme = editor?.initial.id ? snapshot.schemes.find(scheme => scheme.id === editor.initial.id) : undefined;
  const schemeOptions = useMemo(() => {
    const needle = schemeQuery.trim().toLocaleLowerCase();
    return snapshot.schemes.filter(scheme => !needle || scheme.name.toLocaleLowerCase().includes(needle)).sort((left, right) => {
      if (left.id === selectedScheme?.id) return -1;
      if (right.id === selectedScheme?.id) return 1;
      return schemeSortGroup(left.id) - schemeSortGroup(right.id) || left.name.localeCompare(right.name);
    });
  }, [schemeQuery, selectedScheme?.id, snapshot.schemes]);
  const tabs = [
    { id: "plugins" as const, label: "Plugins", icon: Package },
    { id: "skills" as const, label: "Skills", icon: Code2 }
  ];
  const activeLabel = tabs.find(tab => tab.id === activeTab)?.label ?? activeTab;
  const items = useMemo(() => {
    const available = snapshot.inventory[activeTab];
    const memberIds = selectedScheme?.[activeTab] ?? [];
    const members = new Set(memberIds);
    return [...available.filter(item => members.has(item.id)), ...unavailableDshResources(memberIds, available, activeTab, zh)];
  }, [activeTab, selectedScheme, snapshot.inventory, zh]);
  const filteredItems = useMemo(() => filterDshResources(items, deferredQuery, hideSensitiveContent), [deferredQuery, hideSensitiveContent, items]);

  function startEdit(scheme: DshResourceScheme) {
    setActionError(null);
    setEditor({ key: `edit:${scheme.id}:${scheme.updatedAt}`, initial: schemeInput(scheme), protectedScheme: scheme.isProtected });
  }

  function startCreate(copyCurrent: boolean) {
    const source = copyCurrent ? selectedScheme : undefined;
    setNewMenuOpen(false);
    setEditor({
      key: `create:${source?.id ?? "empty"}:${Date.now()}`,
      initial: {
        name: source ? nextCopyName(source.name, snapshot.schemes) : "",
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
    if (!result?.ok) { const message = result ? issueMessage(result.issues, zh) : (zh ? "无法保存配置方案。" : "Scheme could not be saved."); setActionError(message); toast.error(message); return; }
    setSnapshot(result.snapshot); setEditor(null);
    await switchScheme(result.schemeId, result.snapshot.schemes.find(scheme => scheme.id === result.schemeId)?.name ?? input.name);
  }

  async function switchScheme(schemeId: string, name: string, notify = true) {
    setBusyAction("apply"); setActionError(null);
    const result = await window.companion.applyDshResourceScheme(schemeId).catch(() => null);
    setBusyAction(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, zh) : (zh ? "无法应用配置方案。" : "Scheme could not be applied."); setActionError(message); toast.error(message); return false; }
    setSnapshot(result.snapshot); setSelectedSchemeId(schemeId); setSchemeMenuOpen(false);
    if (notify) toast.success(zh ? `已切换：${name}` : `Switched to: ${name}`);
    return true;
  }

  async function deleteScheme(schemeId: string) {
    const scheme = snapshot.schemes.find(item => item.id === schemeId);
    if (!scheme) return;
    setDeleteConfirm(false);
    if (scheme.id === snapshot.appliedSchemeId && !await switchScheme(DEFAULT_DSH_SCHEME_ID, "Default", false)) return;
    setBusyAction("delete");
    const result = await window.companion.deleteDshResourceScheme(schemeId).catch(() => null);
    setBusyAction(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, zh) : (zh ? "无法删除配置方案。" : "Scheme could not be deleted."); setActionError(message); return; }
    setSnapshot(result.snapshot); setEditor(null); setSelectedSchemeId(result.snapshot.appliedSchemeId ?? DEFAULT_DSH_SCHEME_ID);
  }

  async function changeResourceState(resource: DshResourceItem, enabled: boolean) {
    if (!selectedScheme) return;
    setBusyAction("resource"); setBusyResourceId(resource.id);
    const result = await window.companion.setDshResourceState({ schemeId: selectedScheme.id, resourceId: resource.id, enabled }).catch(() => null);
    setBusyAction(null); setBusyResourceId(null);
    if (!result?.ok) { const message = result ? issueMessage(result.issues, zh) : (zh ? "无法更新资源状态。" : "Resource could not be changed."); setActionError(message); toast.error(message); return; }
    setSnapshot(result.snapshot);
  }

  if (marketOpen) return <div className="claude-resources-page claude-resources-page-dark claude-profiles-page"><DshMarketPanel zh={zh} onBack={() => setMarketOpen(false)} onChanged={() => void refresh()} /></div>;

  if (editor) return (
    <div className="claude-resources-page claude-resources-page-dark claude-profiles-page">
      <RoutingToaster />
      <DshSchemeEditor key={editor.key} initial={editor.initial} inventory={snapshot.inventory} protectedScheme={editor.protectedScheme} canDelete={Boolean(editor.initial.id && !editor.protectedScheme)} busy={busyAction !== null} hideSensitiveContent={hideSensitiveContent} zh={zh} onCancel={() => setEditor(null)} onSave={input => void saveScheme(input)} onDelete={() => setDeleteConfirm(true)} />
      {deleteConfirm && editorScheme ? <ConfirmDialog title={zh ? "删除配置方案？" : "Delete scheme?"} cancelLabel={zh ? "取消" : "Cancel"} confirmLabel={zh ? "删除" : "Delete"} danger onCancel={() => setDeleteConfirm(false)} onConfirm={() => void deleteScheme(editorScheme.id)}><p>{zh ? `“${editorScheme.name}”将被永久删除。` : `“${editorScheme.name}” will be permanently deleted.`}</p></ConfirmDialog> : null}
    </div>
  );

  return (
    <div className="claude-resources-page claude-resources-page-dark claude-profiles-page">
      <RoutingToaster />
      <div className="claude-profile-top-row">
        <section className="claude-profile-toolbar">
          <div className="claude-profile-picker"><span>{zh ? "方案" : "Scheme"}</span><div className="claude-profile-dropdown" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSchemeMenuOpen(false); }}>
            <button ref={triggerRef} type="button" className="claude-profile-select-button" onClick={() => { setNewMenuOpen(false); setSchemeQuery(""); setSchemeMenuOpen(value => !value); }} disabled={loading || busyAction !== null} aria-haspopup="listbox" aria-expanded={schemeMenuOpen}><span>{selectedScheme?.name ?? (zh ? "无方案" : "No scheme")}</span><ChevronDown size={14} /></button>
            {schemeMenuOpen ? <div className="claude-profile-options"><label className="claude-profile-options-search"><Search size={13} /><input autoFocus value={schemeQuery} onChange={event => setSchemeQuery(event.target.value)} placeholder={zh ? "搜索方案" : "Search schemes"} /></label><div className="claude-profile-options-list" role="listbox">{schemeOptions.map(scheme => <button type="button" key={scheme.id} className={scheme.id === selectedScheme?.id ? "current" : ""} onClick={() => void switchScheme(scheme.id, scheme.name)}><span>{scheme.name}</span>{scheme.id === snapshot.appliedSchemeId ? <Check size={13} /> : null}</button>)}</div></div> : null}
          </div></div>
          <div className="claude-profile-toolbar-actions">
            <button type="button" className="claude-profile-icon-button" onClick={() => selectedScheme && startEdit(selectedScheme)} disabled={!selectedScheme || selectedScheme.id === ALL_DSH_SCHEME_ID || busyAction !== null} title={zh ? "编辑" : "Edit"}><Pencil size={16} /></button>
            <div className="claude-profile-new-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setNewMenuOpen(false); }}>
              <button ref={newTriggerRef} type="button" className="claude-profile-icon-button" onClick={() => { setSchemeMenuOpen(false); setNewMenuOpen(value => !value); }} disabled={busyAction !== null} title={zh ? "新建" : "New"}><Plus size={17} /></button>
              {newMenuOpen ? <div className="claude-profile-new-options"><button type="button" onClick={() => startCreate(false)}><Plus size={15} /><span><b>{zh ? "空白方案" : "Empty scheme"}</b><small>{zh ? "从零开始选择" : "Start with no resources"}</small></span></button><button type="button" onClick={() => startCreate(true)}><Copy size={15} /><span><b>{zh ? "复制当前方案" : "Copy selected"}</b><small>{selectedScheme?.name}</small></span></button></div> : null}
            </div>
          </div>
        </section>

        <nav className="claude-resource-subtabs compact claude-profile-resource-tabs dsh-resource-tabs" aria-label={zh ? "资源类型" : "Resource type"}>
          {tabs.map(tab => { const Icon = tab.icon; return <button type="button" key={tab.id} className={`claude-resource-subtab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}><Icon size={16} /><span><b>{tab.label}</b></span><small>{selectedScheme?.[tab.id].length ?? 0}</small></button>; })}
          <button type="button" className="claude-resource-subtab claude-resource-refresh-tab dsh-market-button" onClick={() => setMarketOpen(true)} aria-label={zh ? "资源市场" : "Resource market"} title={zh ? "资源市场" : "Resource market"}><Store size={17} /></button>
        </nav>
      </div>

      {!snapshot.inventory.runtimeConnected && activeTab === "plugins" ? <section className="claude-profile-unavailable"><AlertTriangle size={16} />{zh ? "完整插件列表暂不可用，当前仅显示已安装插件。" : "The complete plugin list is unavailable; only installed plugins are shown."}</section> : null}
      {loadError || actionError ? <section className="connection-error">{loadError ?? actionError}</section> : null}
      <section className="claude-resource-list-toolbar"><div className="claude-resource-search dark"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? `搜索 ${activeLabel}` : `Search ${activeLabel}`} /></div><button type="button" className="claude-resource-search-refresh" onClick={() => void refresh()} disabled={busyAction !== null} aria-label={zh ? "刷新" : "Refresh"}><RefreshCw size={17} className={busyAction === "refresh" ? "spinning" : undefined} /></button></section>
      <ResourceTable items={filteredItems} loading={loading} selected={new Set(selectedScheme?.[activeTab] ?? [])} busyResourceId={busyResourceId} hideSensitiveContent={hideSensitiveContent} zh={zh} onState={changeResourceState} />
    </div>
  );
}

function ResourceTable({ items, loading, selected, busyResourceId, hideSensitiveContent, zh, onState }: { items: DshResourceItem[]; loading: boolean; selected: Set<string>; busyResourceId: string | null; hideSensitiveContent: boolean; zh: boolean; onState: (resource: DshResourceItem, enabled: boolean) => void }) {
  const virtual = useVirtualRows(items, ROW_HEIGHT, `${items.map(item => item.id).join("|")}:${loading}`, 5);
  return (
    <section ref={virtual.viewportRef} className="claude-resource-table" onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
      <header className="claude-resource-table-head"><span>{zh ? "资源" : "Resource"}</span><span>{zh ? "状态" : "Status"}</span></header>
      {loading && items.length === 0 ? <div className="claude-resource-empty">{zh ? "正在扫描..." : "Scanning..."}</div> : items.length === 0 ? <div className="claude-resource-empty">{zh ? "当前方案没有此类资源" : "No resources in this scheme"}</div> : (
        <div className="claude-profile-readonly-space" style={{ height: virtual.totalHeight }}>
          {virtual.visible.map((resource, offset) => {
            const index = virtual.start + offset;
            const member = selected.has(resource.id);
            const description = hideSensitiveContent ? (zh ? "资源详情已隐藏" : "Resource details hidden") : resource.description ?? resource.detail ?? (zh ? "DSH 资源" : "DSH resource");
            return (
              <article key={resource.id} className="claude-resource-row claude-profile-readonly-row" style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }}>
                <div className="claude-resource-row-main"><div className="claude-resource-name-line"><strong>{resource.name}</strong></div><p title={description}>{description}</p>{resource.detail && !hideSensitiveContent ? <code>{resource.detail}</code> : null}</div>
                {resource.manageable ? <button type="button" className="claude-profile-resource-action" onClick={() => onState(resource, !member)} disabled={busyResourceId !== null}>{member ? <PowerOff size={13} /> : <Power size={13} />}{member ? (zh ? "停用" : "Disable") : (zh ? "启用" : "Enable")}</button> : <span className={`claude-resource-status ${resource.enabled ? "active" : ""}`}>{resource.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "未启用" : "Disabled")}</span>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function schemeInput(scheme: DshResourceScheme): DshResourceSchemeSaveInput { return { id: scheme.id, name: scheme.name, ...(scheme.description ? { description: scheme.description } : {}), skills: [...scheme.skills], plugins: [...scheme.plugins] }; }
function nextCopyName(name: string, schemes: DshResourceScheme[]) { let value = `${name} Copy`; let index = 2; while (schemes.some(scheme => scheme.name.toLocaleLowerCase() === value.toLocaleLowerCase())) value = `${name} Copy ${index++}`; return value; }
function schemeSortGroup(id: string) { return id === DEFAULT_DSH_SCHEME_ID ? 0 : id === ALL_DSH_SCHEME_ID ? 1 : 2; }
function issueMessage(issues: Array<{ message: string }>, zh: boolean) { return issues[0]?.message || (zh ? "操作失败。" : "Operation failed."); }

export const PluginsPage = React.memo(PluginsPageInner);

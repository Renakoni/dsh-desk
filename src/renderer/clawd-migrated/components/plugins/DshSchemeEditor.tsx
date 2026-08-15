import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Code2, Package, Search, Trash2 } from "lucide-react";
import type { DshResourceInventory, DshResourceItem, DshResourceSchemeSaveInput } from "../../../../shared/dshResources";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";
import { dshResourcePresentation, filterDshResources, unavailableDshResources, type DshResourceTab } from "./dshSchemeResources";
import { useVirtualRows } from "./useVirtualRows";

const ROW_HEIGHT = 64;
const OVERSCAN = 5;

export function DshSchemeEditor({
  initial,
  inventory,
  protectedScheme,
  canDelete,
  busy,
  hideSensitiveContent,
  zh,
  onCancel,
  onSave,
  onDelete
}: {
  initial: DshResourceSchemeSaveInput;
  inventory: DshResourceInventory;
  protectedScheme: boolean;
  canDelete: boolean;
  busy: boolean;
  hideSensitiveContent: boolean;
  zh: boolean;
  onCancel: () => void;
  onSave: (input: DshResourceSchemeSaveInput) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<DshResourceSchemeSaveInput>(() => ({
    ...initial,
    skills: [...new Set([...inventory.skills.filter(item => item.required).map(item => item.id), ...initial.skills])],
    plugins: [...new Set([...inventory.plugins.filter(item => item.required).map(item => item.id), ...initial.plugins])]
  }));
  const [activeTab, setActiveTab] = useState<DshResourceTab>("plugins");
  const [query, setQuery] = useState("");
  const [missingRemoval, setMissingRemoval] = useState<DshResourceItem | null>(null);
  const deferredQuery = useDeferredValue(query);
  const tabs = [
    { id: "plugins" as const, label: "Plugins", icon: Package },
    { id: "skills" as const, label: "Skills", icon: Code2 }
  ];
  const availableResources = inventory[activeTab];
  const availableIds = useMemo(() => new Set(availableResources.map(resource => resource.id)), [availableResources]);
  const resources = useMemo<DshResourceItem[]>(() => [
    ...availableResources,
    ...unavailableDshResources(draft[activeTab], availableResources, activeTab, zh)
  ], [activeTab, availableResources, draft, zh]);
  const selected = useMemo(() => new Set(draft[activeTab]), [activeTab, draft]);
  const filtered = useMemo(() => filterDshResources(resources, deferredQuery, hideSensitiveContent), [deferredQuery, hideSensitiveContent, resources]);
  const unselected = useMemo(() => filtered.filter(resource => !selected.has(resource.id)), [filtered, selected]);
  const selectedItems = useMemo(() => filtered.filter(resource => selected.has(resource.id)), [filtered, selected]);

  useEffect(() => setQuery(""), [activeTab]);

  function moveResource(resource: DshResourceItem) {
    const next = new Set(selected);
    if (next.has(resource.id)) next.delete(resource.id); else next.add(resource.id);
    setDraft(current => ({ ...current, [activeTab]: resources.filter(item => next.has(item.id)).map(item => item.id) }));
  }

  function toggleResource(resource: DshResourceItem) {
    if (resource.required) return;
    if (selected.has(resource.id) && resource.missing) {
      setMissingRemoval(resource);
      return;
    }
    moveResource(resource);
  }

  const title = initial.id ? (zh ? "编辑配置方案" : "Edit scheme") : (zh ? "新建配置方案" : "New scheme");
  const activeLabel = tabs.find(tab => tab.id === activeTab)?.label ?? activeTab;

  return (
    <div className="claude-profile-editor">
      <header className="claude-profile-editor-header">
        <button type="button" className="claude-profile-icon-button" onClick={onCancel} disabled={busy} aria-label={zh ? "返回" : "Back"}><ArrowLeft size={17} /></button>
        <h2>{title}</h2>
        <div className="claude-profile-name-field">
          <input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={zh ? "名称" : "Name"} aria-label={zh ? "名称" : "Name"} maxLength={64} disabled={busy || protectedScheme} />
        </div>
        <div className="claude-profile-editor-actions">
          {initial.id && !protectedScheme ? <button type="button" className="claude-profile-text-button danger" onClick={onDelete} disabled={busy || !canDelete}><Trash2 size={15} /> {zh ? "删除" : "Delete"}</button> : null}
          <button type="button" className="claude-profile-text-button" onClick={onCancel} disabled={busy}>{zh ? "取消" : "Cancel"}</button>
          <button type="button" className="claude-profile-primary-button" onClick={() => onSave({ ...draft, name: draft.name.trim(), description: draft.description?.trim() || undefined })} disabled={busy || !draft.name.trim()}>{busy ? (zh ? "保存中..." : "Saving...") : (zh ? "保存" : "Save")}</button>
        </div>
      </header>

      <nav className="claude-resource-subtabs compact claude-profile-editor-tabs dsh-scheme-editor-tabs" aria-label={zh ? "资源类型" : "Resource type"}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          return <button type="button" key={tab.id} className={`claude-resource-subtab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}><Icon size={16} /><span><b>{tab.label}</b></span></button>;
        })}
      </nav>

      <section className="claude-profile-editor-toolbar"><div className="claude-resource-search dark"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? `搜索 ${activeLabel}` : `Search ${activeLabel}`} /></div></section>
      <section className="claude-profile-transfer" aria-busy={busy}>
        <TransferColumn title={zh ? "未选择" : "Unselected"} side="unselected" items={unselected} availableIds={availableIds} hideSensitiveContent={hideSensitiveContent} zh={zh} busy={busy} resetKey={`${activeTab}:${deferredQuery}:unselected`} onMove={toggleResource} />
        <TransferColumn title={zh ? "已选择" : "Selected"} side="selected" items={selectedItems} availableIds={availableIds} hideSensitiveContent={hideSensitiveContent} zh={zh} busy={busy} resetKey={`${activeTab}:${deferredQuery}:selected`} onMove={toggleResource} />
      </section>
      {missingRemoval ? (
        <ConfirmDialog
          title={zh ? "删除缺失记录？" : "Remove missing record?"}
          cancelLabel={zh ? "取消" : "Cancel"}
          confirmLabel={zh ? "删除记录" : "Remove record"}
          danger
          onCancel={() => setMissingRemoval(null)}
          onConfirm={() => { const resource = missingRemoval; setMissingRemoval(null); moveResource(resource); }}
        >
          <p>{zh ? `“${missingRemoval.name}”已不在当前环境中。是否从此方案移除该记录？` : `“${missingRemoval.name}” is no longer available. Remove its record from this scheme?`}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function TransferColumn({ title, side, items, availableIds, hideSensitiveContent, zh, busy, resetKey, onMove }: {
  title: string;
  side: "unselected" | "selected";
  items: DshResourceItem[];
  availableIds: Set<string>;
  hideSensitiveContent: boolean;
  zh: boolean;
  busy: boolean;
  resetKey: string;
  onMove: (resource: DshResourceItem) => void;
}) {
  const virtual = useVirtualRows(items, ROW_HEIGHT, resetKey, OVERSCAN);
  return (
    <div className="claude-profile-transfer-column" data-transfer-side={side}>
      <header>{title}</header>
      <div ref={virtual.viewportRef} className="claude-profile-virtual-list" onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
        {items.length === 0 ? <div className="claude-profile-transfer-empty">{zh ? "没有匹配项" : "No matches"}</div> : (
          <div className="claude-profile-virtual-space" style={{ height: virtual.totalHeight }}>
            {virtual.visible.map((resource, offset) => {
              const index = virtual.start + offset;
              const available = availableIds.has(resource.id);
              const presentation = dshResourcePresentation(resource, hideSensitiveContent, zh);
              const description = presentation.description ?? presentation.detail;
              return (
                <button type="button" key={resource.id} className={`claude-profile-transfer-option ${resource.required ? "required" : ""}`} style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }} disabled={busy || resource.required} onClick={() => onMove(resource)}>
                  <span className="claude-profile-resource-copy"><strong>{resource.name}</strong>{description ? <small title={description}>{description}</small> : null}</span>
                  <span className={`claude-profile-live-state ${!available ? "missing" : resource.enabled ? "active" : "idle"}`}>{!available ? (zh ? "缺失" : "Missing") : resource.required ? (zh ? "必装" : "Required") : resource.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已禁用" : "Disabled")}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Code2, Package, Search, Server, Trash2 } from "lucide-react";
import type {
  ClaudeProfileInventory,
  ClaudeProfileResource,
  ClaudeProfileSaveInput
} from "../../../../shared/claudeProfiles";
import {
  filterProfileResources,
  unavailableProfileResources,
  type ClaudeProfileResourceTab
} from "./claudeProfileResources";
import { useVirtualRows } from "./useVirtualRows";

type ResourceTab = ClaudeProfileResourceTab;

const ROW_HEIGHT = 64;
const OVERSCAN = 5;

export function ClaudeProfileEditor({
  initial,
  inventory,
  protectedProfile,
  canDelete,
  busy,
  hideSensitiveContent,
  zh,
  onCancel,
  onSave,
  onDelete
}: {
  initial: ClaudeProfileSaveInput;
  inventory: ClaudeProfileInventory;
  protectedProfile: boolean;
  canDelete: boolean;
  busy: boolean;
  hideSensitiveContent: boolean;
  zh: boolean;
  onCancel: () => void;
  onSave: (input: ClaudeProfileSaveInput) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ClaudeProfileSaveInput>(() => ({
    ...initial,
    skills: [...initial.skills],
    plugins: [...initial.plugins],
    mcpServers: [...initial.mcpServers]
  }));
  const [activeTab, setActiveTab] = useState<ResourceTab>("skills");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const tabs = [
    { id: "skills" as const, label: "Skills", icon: Code2 },
    { id: "plugins" as const, label: "Plugins", icon: Package },
    { id: "mcpServers" as const, label: "MCP", icon: Server }
  ];
  const availableResources = inventory[activeTab];
  const availableIds = useMemo(() => new Set(availableResources.map(resource => resource.id)), [availableResources]);
  const resources = useMemo<ClaudeProfileResource[]>(() => [
    ...availableResources,
    ...unavailableProfileResources(draft[activeTab], availableResources, activeTab, zh)
  ], [activeTab, availableResources, draft, zh]);
  const selected = useMemo(() => new Set(draft[activeTab]), [activeTab, draft]);
  const filtered = useMemo(
    () => filterProfileResources(resources, deferredQuery, hideSensitiveContent),
    [deferredQuery, hideSensitiveContent, resources]
  );
  const unselectedResources = useMemo(
    () => filtered.filter(resource => !selected.has(resource.id)),
    [filtered, selected]
  );
  const selectedResources = useMemo(
    () => filtered.filter(resource => selected.has(resource.id)),
    [filtered, selected]
  );

  useEffect(() => setQuery(""), [activeTab]);

  function setMembership(ids: string[]) {
    setDraft(current => ({ ...current, [activeTab]: ids }));
  }

  function toggleResource(resourceId: string) {
    const next = new Set(selected);
    if (next.has(resourceId)) next.delete(resourceId);
    else next.add(resourceId);
    setMembership(resources.filter(resource => next.has(resource.id)).map(resource => resource.id));
  }

  const title = initial.id ? (zh ? "编辑配置方案" : "Edit profile") : (zh ? "新建配置方案" : "New profile");
  const activeTabLabel = tabs.find(tab => tab.id === activeTab)?.label ?? activeTab;

  return (
    <div className="claude-profile-editor">
      <header className="claude-profile-editor-header">
        <button type="button" className="claude-profile-icon-button" onClick={onCancel} disabled={busy} aria-label={zh ? "返回" : "Back"}>
          <ArrowLeft size={17} />
        </button>
        <h2>{title}</h2>
        <div className="claude-profile-name-field">
          <input
            value={draft.name}
            onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
            placeholder={zh ? "名称" : "Name"}
            aria-label={zh ? "名称" : "Name"}
            maxLength={64}
            disabled={busy || protectedProfile}
          />
        </div>
        <div className="claude-profile-editor-actions">
          {initial.id && !protectedProfile ? (
            <button type="button" className="claude-profile-text-button danger" onClick={onDelete} disabled={busy || !canDelete} title={!canDelete ? (zh ? "先应用其他方案" : "Apply another profile first") : undefined}>
              <Trash2 size={15} /> {zh ? "删除" : "Delete"}
            </button>
          ) : null}
          <button type="button" className="claude-profile-text-button" onClick={onCancel} disabled={busy}>{zh ? "取消" : "Cancel"}</button>
          <button
            type="button"
            className="claude-profile-primary-button"
            onClick={() => onSave({ ...draft, name: draft.name.trim(), description: draft.description?.trim() || undefined })}
            disabled={busy || !draft.name.trim()}
          >
            {busy ? (zh ? "保存中..." : "Saving...") : (zh ? "保存" : "Save")}
          </button>
        </div>
      </header>

      <nav className="claude-resource-subtabs compact claude-profile-editor-tabs" aria-label={zh ? "资源类型" : "Resource type"}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button type="button" key={tab.id} className={`claude-resource-subtab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
              <Icon size={16} />
              <span><b>{tab.label}</b></span>
            </button>
          );
        })}
      </nav>

      <section className="claude-profile-editor-toolbar">
        <div className="claude-resource-search dark">
          <Search size={16} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? `搜索 ${activeTabLabel}` : `Search ${activeTabLabel}`} />
        </div>
      </section>

      <section className="claude-profile-transfer" aria-busy={busy}>
        <TransferColumn
          title={zh ? "未选择" : "Unselected"}
          side="unselected"
          items={unselectedResources}
          availableIds={availableIds}
          hideSensitiveContent={hideSensitiveContent}
          zh={zh}
          busy={busy}
          resetKey={`${activeTab}:${deferredQuery}:unselected`}
          onMove={toggleResource}
        />
        <TransferColumn
          title={zh ? "已选择" : "Selected"}
          side="selected"
          items={selectedResources}
          availableIds={availableIds}
          hideSensitiveContent={hideSensitiveContent}
          zh={zh}
          busy={busy}
          resetKey={`${activeTab}:${deferredQuery}:selected`}
          onMove={toggleResource}
        />
      </section>
    </div>
  );
}

function TransferColumn({
  title,
  side,
  items,
  availableIds,
  hideSensitiveContent,
  zh,
  busy,
  resetKey,
  onMove
}: {
  title: string;
  side: "unselected" | "selected";
  items: ClaudeProfileResource[];
  availableIds: Set<string>;
  hideSensitiveContent: boolean;
  zh: boolean;
  busy: boolean;
  resetKey: string;
  onMove: (resourceId: string) => void;
}) {
  const virtual = useVirtualRows(items, ROW_HEIGHT, resetKey, OVERSCAN);

  return (
    <div className="claude-profile-transfer-column" data-transfer-side={side}>
      <header>{title}</header>
      <div ref={virtual.viewportRef} className="claude-profile-virtual-list" onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
        {items.length === 0 ? (
          <div className="claude-profile-transfer-empty">{zh ? "没有匹配项" : "No matches"}</div>
        ) : (
          <div className="claude-profile-virtual-space" style={{ height: virtual.totalHeight }}>
            {virtual.visible.map((resource, offset) => {
              const index = virtual.start + offset;
              const available = availableIds.has(resource.id);
              const description = hideSensitiveContent
                ? (zh ? "资源详情已隐藏" : "Resource details hidden")
                : resource.description ?? resource.detail ?? (zh ? "Claude Code 资源" : "Claude Code resource");
              return (
                <button
                  type="button"
                  key={resource.id}
                  className="claude-profile-transfer-option"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${index * ROW_HEIGHT}px)` }}
                  data-resource-id={resource.id}
                  disabled={busy}
                  aria-label={side === "unselected" ? `${zh ? "选择" : "Select"} ${resource.name}` : `${zh ? "移除" : "Remove"} ${resource.name}`}
                  onClick={() => onMove(resource.id)}
                >
                  <span className="claude-profile-resource-copy">
                    <strong>{resource.name}</strong>
                    <small title={description}>{description}</small>
                  </span>
                  <span className={`claude-profile-live-state ${!available ? "missing" : resource.enabled ? "active" : "idle"}`}>
                    {!available ? (zh ? "缺失" : "Missing") : resource.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已禁用" : "Disabled")}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

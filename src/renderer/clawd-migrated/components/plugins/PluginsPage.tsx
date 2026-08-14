import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Package,
  Pencil,
  Plus,
  PlugZap,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Server
} from "lucide-react";
import { toast } from "sonner";
import {
  ALL_CLAUDE_PROFILE_ID,
  createEmptyClaudeProfilesSnapshot,
  DEFAULT_CLAUDE_PROFILE_ID,
  type ClaudeProfile,
  type ClaudeProfileResource,
  type ClaudeProfileSaveInput,
  type ClaudeProfilesSnapshot
} from "../../../../shared/claudeProfiles";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../claude-routing/ConfirmDialog";
import { RoutingToaster } from "../claude-routing/RoutingToaster";
import { ClaudeProfileEditor } from "./ClaudeProfileEditor";
import {
  filterProfileResources,
  unavailableProfileResources,
  type ClaudeProfileResourceTab
} from "./claudeProfileResources";
import { useVirtualRows } from "./useVirtualRows";

type ResourceTab = ClaudeProfileResourceTab;
type BusyAction = "refresh" | "save" | "delete" | "apply" | "resource" | null;

const PROFILE_STATUS_REFRESH_MS = 10 * 60 * 1000;

const emptySnapshot: ClaudeProfilesSnapshot = createEmptyClaudeProfilesSnapshot();

type EditorState = {
  key: string;
  initial: ClaudeProfileSaveInput;
  protectedProfile: boolean;
};

// Only `hideSensitiveContent` is read from settings here, so take that slice
// directly instead of the whole `settings` object. A settings save (e.g. an
// animation-slider drag) mints a fresh `settings` reference every time; passing
// the object would defeat React.memo on every such change, while a primitive
// boolean lets it bail unless the flag itself actually flips.
function PluginsPageInner({ hideSensitiveContent, active = true }: { hideSensitiveContent: boolean; active?: boolean }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [activeTab, setActiveTab] = useState<ResourceTab>("skills");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [snapshot, setSnapshot] = useState<ClaudeProfilesSnapshot>(emptySnapshot);
  const [selectedProfileId, setSelectedProfileId] = useState(DEFAULT_CLAUDE_PROFILE_ID);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileQuery, setProfileQuery] = useState("");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profileOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreProfileFocusRef = useRef(false);
  const newProfileTriggerRef = useRef<HTMLButtonElement>(null);
  const busyActionRef = useRef<BusyAction>(null);
  const wasActiveRef = useRef(active);
  const initiallyActiveRef = useRef(active);

  const refresh = useCallback(async (force = false) => {
    setBusyAction("refresh");
    setLoadError(null);
    try {
      const next = await window.companion.getClaudeProfiles(force);
      setSnapshot(next ?? emptySnapshot);
    } catch {
      setLoadError(zh ? "无法读取配置方案。" : "Claude profiles could not be loaded.");
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  }, [zh]);

  useEffect(() => { busyActionRef.current = busyAction; }, [busyAction]);

  useEffect(() => {
    void refresh(initiallyActiveRef.current);
  }, [refresh]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      if (busyActionRef.current === null) void refresh(true);
    }, PROFILE_STATUS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (active && !wasActive && busyActionRef.current === null) void refresh(true);
  }, [active, refresh]);

  useEffect(() => {
    const appliedProfileId = snapshot.appliedProfileId;
    setSelectedProfileId(appliedProfileId && snapshot.profiles.some(profile => profile.id === appliedProfileId)
      ? appliedProfileId
      : snapshot.profiles[0]?.id ?? "");
  }, [snapshot.appliedProfileId, snapshot.profiles]);

  useEffect(() => setQuery(""), [activeTab]);

  useEffect(() => {
    if (profileMenuOpen || busyAction !== null || !restoreProfileFocusRef.current) return;
    restoreProfileFocusRef.current = false;
    profileTriggerRef.current?.focus();
  }, [busyAction, profileMenuOpen, selectedProfileId]);

  const selectedProfile = snapshot.profiles.find(profile => profile.id === selectedProfileId) ?? snapshot.profiles[0];
  const editorProfile = editor?.initial.id
    ? snapshot.profiles.find(profile => profile.id === editor.initial.id)
    : undefined;
  const profileActionsAvailable = snapshot.mcpStatus === "ready" && !loading && !loadError;
  const selectedProfileEditable = selectedProfile?.id !== ALL_CLAUDE_PROFILE_ID;
  const profileOptions = useMemo(() => {
    const needle = profileQuery.trim().toLocaleLowerCase();
    return snapshot.profiles
      .filter(profile => !needle || profile.name.toLocaleLowerCase().includes(needle))
      .sort((left, right) => {
        if (left.id === selectedProfile?.id) return -1;
        if (right.id === selectedProfile?.id) return 1;
        const groupDelta = profileNameSortGroup(left.name) - profileNameSortGroup(right.name);
        return groupDelta || left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" });
      });
  }, [profileQuery, selectedProfile?.id, snapshot.profiles]);

  const tabs = [
    { id: "skills" as const, label: "Skills", icon: Code2 },
    { id: "plugins" as const, label: "Plugins", icon: Package },
    { id: "mcpServers" as const, label: "MCP", icon: Server }
  ];
  const activeTabLabel = tabs.find(tab => tab.id === activeTab)?.label ?? activeTab;
  const items = useMemo(() => {
    const availableResources = snapshot.inventory[activeTab];
    const memberIds = selectedProfile?.[activeTab] ?? [];
    const members = new Set(memberIds);
    return [
      ...availableResources.filter(item => members.has(item.id)),
      ...unavailableProfileResources(memberIds, availableResources, activeTab, zh)
    ];
  }, [activeTab, selectedProfile, snapshot.inventory, zh]);
  const filteredItems = useMemo(
    () => filterProfileResources(items, deferredQuery, hideSensitiveContent),
    [deferredQuery, items, hideSensitiveContent]
  );

  function closeProfileMenu(restoreFocus = false) {
    setProfileMenuOpen(false);
    if (restoreFocus) profileTriggerRef.current?.focus();
  }

  function selectProfileOption(profile: ClaudeProfile) {
    const current = profile.id === selectedProfile?.id;
    closeProfileMenu();
    if (!current || snapshot.drift.isDrifted) {
      restoreProfileFocusRef.current = true;
      void switchProfile(profile.id, profile.name);
    } else {
      profileTriggerRef.current?.focus();
    }
  }

  function handleProfileMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!profileMenuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeProfileMenu(true);
      return;
    }

    const currentIndex = profileOptionRefs.current.findIndex(option => option === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (profileOptions.length === 0) return;
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (offset > 0 ? 0 : profileOptions.length - 1)
        : (currentIndex + offset + profileOptions.length) % profileOptions.length;
      profileOptionRefs.current[nextIndex]?.focus();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && currentIndex >= 0) {
      event.preventDefault();
      profileOptionRefs.current[currentIndex]?.click();
    }
  }

  function startEdit(profile: ClaudeProfile) {
    setActionError(null);
    setEditor({
      key: `edit:${profile.id}:${profile.updatedAt}`,
      initial: profileInput(profile),
      protectedProfile: profile.isProtected
    });
  }

  function startCreate(copyCurrent: boolean) {
    const source = copyCurrent ? selectedProfile : undefined;
    setNewMenuOpen(false);
    setActionError(null);
    setEditor({
      key: `create:${copyCurrent ? source?.id ?? "empty" : "empty"}:${Date.now()}`,
      initial: {
        name: source ? nextCopyName(source.name, snapshot.profiles) : "",
        ...(source?.description ? { description: source.description } : {}),
        skills: source ? [...source.skills] : [],
        plugins: source ? [...source.plugins] : [],
        mcpServers: source ? [...source.mcpServers] : []
      },
      protectedProfile: false
    });
  }

  async function saveProfile(input: ClaudeProfileSaveInput) {
    setBusyAction("save");
    setActionError(null);
    let result;
    try {
      result = await window.companion.saveClaudeProfile(input);
    } catch {
      const message = actionFailureMessage("save", zh);
      setBusyAction(null);
      setActionError(message);
      toast.error(message);
      return;
    }
    if (!result.ok) {
      setBusyAction(null);
      const message = issueMessage(result.issues, zh);
      setActionError(message);
      toast.error(message);
      return;
    }
    setSnapshot(result.snapshot);
    setEditor(null);
    const profileName = result.snapshot.profiles.find(profile => profile.id === result.profileId)?.name ?? input.name;
    await switchProfile(result.profileId, profileName);
  }

  async function deleteProfile(profileId: string) {
    const profile = snapshot.profiles.find(item => item.id === profileId);
    if (!profile) return;
    setDeleteConfirm(false);
    if (profile.id === snapshot.appliedProfileId) {
      const fallback = snapshot.profiles.find(item => item.id === DEFAULT_CLAUDE_PROFILE_ID);
      if (!fallback || !await switchProfile(fallback.id, fallback.name, false)) return;
    }
    setBusyAction("delete");
    setActionError(null);
    let result;
    try {
      result = await window.companion.deleteClaudeProfile(profile.id);
    } catch {
      const message = actionFailureMessage("delete", zh);
      setBusyAction(null);
      setActionError(message);
      toast.error(message);
      return;
    }
    setBusyAction(null);
    if (!result.ok) {
      const message = issueMessage(result.issues, zh);
      setActionError(message);
      toast.error(message);
      return;
    }
    setSnapshot(result.snapshot);
    setSelectedProfileId(result.snapshot.appliedProfileId ?? result.snapshot.profiles[0]?.id ?? "");
    setEditor(null);
    toast.success(zh ? "配置方案已删除" : "Profile deleted");
  }

  async function switchProfile(profileId: string, profileName: string, notify = true) {
    setBusyAction("apply");
    setActionError(null);
    let result;
    try {
      result = await window.companion.applyClaudeProfile(profileId);
    } catch {
      const message = actionFailureMessage("apply", zh);
      setBusyAction(null);
      setActionError(message);
      toast.error(message);
      return false;
    }
    setBusyAction(null);
    if (!result.ok) {
      const message = issueMessage(result.issues, zh);
      setActionError(message);
      toast.error(message);
      return false;
    }
    setSnapshot(result.snapshot);
    setSelectedProfileId(result.profileId);
    if (notify) toast.success(zh ? `已成功切换：${profileName}` : `Switched to: ${profileName}`);
    return true;
  }

  async function changeResourceState(item: ClaudeProfileResource, enabled: boolean) {
    if (!selectedProfile) return;
    setBusyAction("resource");
    setBusyResourceId(item.id);
    setActionError(null);
    let result;
    try {
      result = await window.companion.setClaudeProfileResourceState({
        profileId: selectedProfile.id,
        resourceId: item.id,
        enabled
      });
    } catch {
      const message = zh ? "无法更新资源状态。" : "The resource state could not be changed.";
      setBusyAction(null);
      setBusyResourceId(null);
      setActionError(message);
      toast.error(message);
      return;
    }
    setBusyAction(null);
    setBusyResourceId(null);
    if (!result.ok) {
      const message = issueMessage(result.issues, zh);
      setActionError(message);
      toast.error(message);
      return;
    }
    setSnapshot(result.snapshot);
    toast.success(enabled
      ? (zh ? `已启用：${item.name}` : `Enabled: ${item.name}`)
      : (zh ? `已禁用：${item.name}` : `Disabled: ${item.name}`));
  }

  if (editor) {
    return (
      <div className="claude-resources-page claude-resources-page-dark claude-profiles-page">
        <RoutingToaster />
        <ClaudeProfileEditor
          key={editor.key}
          initial={editor.initial}
          inventory={snapshot.inventory}
          protectedProfile={editor.protectedProfile}
          canDelete={Boolean(editor.initial.id && !editor.protectedProfile)}
          busy={busyAction === "save" || busyAction === "delete" || busyAction === "apply"}
          hideSensitiveContent={hideSensitiveContent}
          zh={zh}
          onCancel={() => setEditor(null)}
          onSave={input => void saveProfile(input)}
          onDelete={() => setDeleteConfirm(true)}
        />
        {actionError ? <section className="connection-error"><PlugZap size={18} />{actionError}</section> : null}
        {deleteConfirm && editorProfile ? (
          <ConfirmDialog
            title={zh ? "删除配置方案？" : "Delete profile?"}
            cancelLabel={zh ? "取消" : "Cancel"}
            confirmLabel={zh ? "删除" : "Delete"}
            danger
            onCancel={() => setDeleteConfirm(false)}
            onConfirm={() => void deleteProfile(editorProfile.id)}
          >
            <p>{editorProfile.id === snapshot.appliedProfileId
              ? (zh ? `将先切换到 Default，然后永久删除“${editorProfile.name}”。` : `Default will become current, then “${editorProfile.name}” will be permanently deleted.`)
              : (zh ? `“${editorProfile.name}”将被永久删除。` : `“${editorProfile.name}” will be permanently deleted.`)}</p>
          </ConfirmDialog>
        ) : null}
      </div>
    );
  }

  return (
    <div className="claude-resources-page claude-resources-page-dark claude-profiles-page">
      <RoutingToaster />
      <div className="claude-profile-top-row">
        <section className="claude-profile-toolbar">
          <div className="claude-profile-picker">
            <span>{zh ? "方案" : "Profile"}</span>
            <div className="claude-profile-dropdown" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeProfileMenu();
            }} onKeyDown={handleProfileMenuKeyDown}>
              <button
                ref={profileTriggerRef}
                type="button"
                className="claude-profile-select-button"
                onClick={() => {
                  setNewMenuOpen(false);
                  if (!profileMenuOpen) setProfileQuery("");
                  setProfileMenuOpen(!profileMenuOpen);
                }}
                disabled={!profileActionsAvailable || busyAction !== null}
                aria-haspopup="listbox"
                aria-expanded={profileMenuOpen}
                aria-label={zh ? `方案：${selectedProfile?.name ?? ""}` : `Profile: ${selectedProfile?.name ?? ""}`}
              >
                <span>{selectedProfile?.name ?? ""}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {profileMenuOpen ? (
                <div className="claude-profile-options">
                  <label className="claude-profile-options-search">
                    <Search size={13} aria-hidden="true" />
                    <input
                      value={profileQuery}
                      onChange={event => setProfileQuery(event.target.value)}
                      placeholder={zh ? "搜索方案" : "Search profiles"}
                      aria-label={zh ? "搜索方案" : "Search profiles"}
                    />
                  </label>
                  <div className="claude-profile-options-list" role="listbox" aria-label={zh ? "配置方案" : "Profiles"}>
                    {profileOptions.length === 0 ? (
                      <span className="claude-profile-options-empty">{zh ? "没有匹配方案" : "No matching profiles"}</span>
                    ) : profileOptions.map((profile, index) => {
                      const current = profile.id === selectedProfile?.id;
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={current}
                          key={profile.id}
                          className={current ? "current" : undefined}
                          ref={node => { profileOptionRefs.current[index] = node; }}
                          onClick={() => selectProfileOption(profile)}
                        >
                          <span>{profile.name}</span>
                          {current ? <Check size={13} aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="claude-profile-toolbar-actions">
            <button type="button" className="claude-profile-icon-button" onClick={() => selectedProfile && startEdit(selectedProfile)} disabled={!profileActionsAvailable || !selectedProfile || !selectedProfileEditable || busyAction !== null} aria-label={zh ? "编辑配置方案" : "Edit profile"} title={!selectedProfileEditable ? (zh ? "All 方案自动更新" : "All updates automatically") : (zh ? "编辑" : "Edit")}>
              <Pencil size={16} />
            </button>
            <div className="claude-profile-new-menu" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setNewMenuOpen(false);
            }} onKeyDown={event => {
              if (event.key !== "Escape" || !newMenuOpen) return;
              event.preventDefault();
              setNewMenuOpen(false);
              newProfileTriggerRef.current?.focus();
            }}>
              <button ref={newProfileTriggerRef} type="button" className="claude-profile-icon-button" onClick={() => {
                setProfileMenuOpen(false);
                setNewMenuOpen(open => !open);
              }} disabled={!profileActionsAvailable || busyAction !== null} aria-label={zh ? "新建配置方案" : "New profile"} aria-haspopup="menu" aria-expanded={newMenuOpen} title={zh ? "新建" : "New"}>
                <Plus size={17} />
              </button>
              {newMenuOpen ? (
                <div className="claude-profile-new-options" role="menu">
                  <button type="button" role="menuitem" onClick={() => startCreate(false)}><Plus size={15} /><span><b>{zh ? "空白方案" : "Empty profile"}</b><small>{zh ? "从零开始选择" : "Start with no resources"}</small></span></button>
                  <button type="button" role="menuitem" onClick={() => startCreate(true)} disabled={!selectedProfile}><Copy size={15} /><span><b>{zh ? "复制当前方案" : "Copy selected"}</b><small>{selectedProfile?.name}</small></span></button>
                </div>
              ) : null}
            </div>
          </div>

        </section>

        <nav className="claude-resource-subtabs compact claude-profile-resource-tabs" aria-label={zh ? "资源类型" : "Resource type"}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button type="button" key={tab.id} className={`claude-resource-subtab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                <Icon size={16} />
                <span><b>{tab.label}</b></span>
                <small>{selectedProfile?.[tab.id].length ?? 0}</small>
              </button>
            );
          })}
        </nav>
      </div>

      {snapshot.mcpStatus !== "ready" ? (
        <section className="claude-profile-unavailable"><AlertTriangle size={16} />{snapshot.mcpStatus === "config-unreadable" ? (zh ? "暂时无法读取 ~/.claude.json，方案操作已暂停。" : "~/.claude.json is temporarily unreadable. Profile actions are paused.") : (zh ? "MCP 保全清单暂时不可用，方案操作已暂停。" : "The MCP preservation inventory is unavailable. Profile actions are paused.")}</section>
      ) : null}
      {loadError || actionError ? <section className="connection-error"><PlugZap size={18} />{loadError ?? actionError}</section> : null}

      <section className="claude-resource-list-toolbar">
        <div className="claude-resource-search dark">
          <Search size={16} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={zh ? `搜索 ${activeTabLabel}` : `Search ${activeTabLabel}`} />
        </div>
        <button type="button" className="claude-resource-search-refresh" onClick={() => void refresh(true)} disabled={busyAction !== null} aria-label={zh ? "刷新" : "Refresh"} title={zh ? "刷新" : "Refresh"}>
          <RefreshCw size={17} className={busyAction === "refresh" ? "spinning" : undefined} />
        </button>
      </section>

      <ProfileResourceTable
        items={filteredItems}
        availableIds={new Set(snapshot.inventory[activeTab].map(item => item.id))}
        loading={loading}
        emptyLabel={deferredQuery.trim() ? (zh ? "没有匹配项" : "No matches") : emptyText(activeTab, zh)}
        hideSensitiveContent={hideSensitiveContent}
        zh={zh}
        actionsAvailable={profileActionsAvailable && busyAction === null}
        busyResourceId={busyResourceId}
        resetKey={`${activeTab}:${deferredQuery}:${selectedProfileId}`}
        onSetEnabled={(item, enabled) => void changeResourceState(item, enabled)}
      />

      <p className="note claude-resource-path-note dark">
        {zh ? "全局用户范围" : "Global user scope"}
        {snapshot.inventory.scannedAt ? ` · ${new Date(snapshot.inventory.scannedAt).toLocaleTimeString()}` : ""}
      </p>

    </div>
  );
}

function ProfileResourceTable({
  items,
  availableIds,
  loading,
  emptyLabel,
  hideSensitiveContent,
  zh,
  actionsAvailable,
  busyResourceId,
  resetKey,
  onSetEnabled
}: {
  items: ClaudeProfileResource[];
  availableIds: Set<string>;
  loading: boolean;
  emptyLabel: string;
  hideSensitiveContent: boolean;
  zh: boolean;
  actionsAvailable: boolean;
  busyResourceId: string | null;
  resetKey: string;
  onSetEnabled: (item: ClaudeProfileResource, enabled: boolean) => void;
}) {
  const rowHeight = 76;
  const virtual = useVirtualRows(items, rowHeight, resetKey);
  return (
    <section ref={virtual.viewportRef} className="claude-resource-table" aria-busy={loading} onScroll={event => virtual.onScroll(event.currentTarget.scrollTop)}>
      {loading ? (
        <div className="claude-resource-empty">{zh ? "正在读取 Claude Code 配置方案..." : "Loading Claude Code profiles..."}</div>
      ) : items.length === 0 ? (
        <div className="claude-resource-empty">{emptyLabel}</div>
      ) : (
        <>
          <div className="claude-resource-table-head">
            <span>{zh ? "资源" : "Resource"}</span>
            <span>{zh ? "状态" : "Status"}</span>
            <span>{zh ? "操作" : "Action"}</span>
          </div>
          <div className="claude-profile-readonly-space" style={{ height: virtual.totalHeight }}>
            {virtual.visible.map((item, offset) => {
              const index = virtual.start + offset;
              return (
                <ResourceRow
                  key={item.id}
                  item={item}
                  available={availableIds.has(item.id)}
                  hideSensitiveContent={hideSensitiveContent}
                  zh={zh}
                  actionsAvailable={actionsAvailable}
                  busy={busyResourceId === item.id}
                  style={{ height: rowHeight, transform: `translateY(${index * rowHeight}px)` }}
                  onSetEnabled={onSetEnabled}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ResourceRow({ item, available, hideSensitiveContent, zh, actionsAvailable, busy, style, onSetEnabled }: {
  item: ClaudeProfileResource;
  available: boolean;
  hideSensitiveContent: boolean;
  zh: boolean;
  actionsAvailable: boolean;
  busy: boolean;
  style?: React.CSSProperties;
  onSetEnabled: (item: ClaudeProfileResource, enabled: boolean) => void;
}) {
  const description = hideSensitiveContent
    ? fallbackDescription(item.kind, zh)
    : item.description ?? item.detail ?? fallbackDescription(item.kind, zh);
  return (
    <article className="claude-resource-row claude-profile-readonly-row" style={style} data-resource-id={item.id}>
      <div className="claude-resource-row-main">
        <div className="claude-resource-name-line"><strong>{item.name}</strong></div>
        <p title={description}>{description}</p>
      </div>
      <div className={`claude-resource-status ${!available ? "missing" : item.enabled ? "active" : "idle"}`}>
        <span>{!available ? (zh ? "缺失" : "Missing") : item.enabled ? (zh ? "已启用" : "Enabled") : (zh ? "已禁用" : "Disabled")}</span>
      </div>
      {available ? (
        <button
          type="button"
          className="claude-profile-resource-action"
          disabled={!actionsAvailable || busy}
          onClick={() => onSetEnabled(item, !item.enabled)}
          aria-label={`${item.enabled ? (zh ? "禁用" : "Disable") : (zh ? "启用" : "Enable")} ${item.name}`}
        >
          {item.enabled ? <PowerOff size={13} aria-hidden="true" /> : <Power size={13} aria-hidden="true" />}
          {busy ? "..." : item.enabled ? (zh ? "禁用" : "Disable") : (zh ? "启用" : "Enable")}
        </button>
      ) : <span className="claude-profile-resource-unavailable">{zh ? "不可操作" : "Unavailable"}</span>}
    </article>
  );
}

function profileInput(profile: ClaudeProfile): ClaudeProfileSaveInput {
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    skills: [...profile.skills],
    plugins: [...profile.plugins],
    mcpServers: [...profile.mcpServers]
  };
}

function nextCopyName(sourceName: string, profiles: ClaudeProfile[]) {
  const names = new Set(profiles.map(profile => profile.name.toLocaleLowerCase()));
  let candidate = `${sourceName} copy`;
  let index = 2;
  while (names.has(candidate.toLocaleLowerCase())) candidate = `${sourceName} copy ${index++}`;
  return candidate;
}

function profileNameSortGroup(name: string) {
  const first = name.trim().charAt(0);
  if (!first || /^[0-9]$/.test(first) || !/^\p{L}$/u.test(first)) return 0;
  if (/^[A-Za-z]$/.test(first)) return 1;
  return 2;
}

function issueMessage(issues: Array<{ code: string; message: string; resourceId?: string }>, zh: boolean) {
  const first = issues.find(item => item.code === "rollback-failed") ?? issues[0];
  if (!first) return zh ? "操作失败。" : "The operation failed.";
  if (!zh) return first.message;
  const localized = ZH_ISSUE_MESSAGES[first.code];
  if (!localized) return first.message || "操作失败。";
  return first.resourceId ? `${localized} (${first.resourceId})` : localized;
}

const ZH_ISSUE_MESSAGES: Record<string, string> = {
  "invalid-profile-input": "方案内容无效。",
  "invalid-profile-reference": "配置方案不存在或已失效。",
  "duplicate-profile-name": "方案名称已存在。",
  "duplicate-profile-id": "生成的方案 ID 已存在，请重试。",
  "protected-profile": "内置方案受保护，无法执行此操作。",
  "applied-profile": "请先应用其他方案，再删除此方案。",
  "profile-delete-blocked": "该方案当前无法删除。",
  "missing-skill": "方案引用的 Skill 已不存在。",
  "missing-plugin": "方案引用的 Plugin 已不存在。",
  "missing-mcp-server": "方案引用的 MCP Server 已不存在。",
  "mcp-state-unavailable": "MCP 状态暂时不可用，请刷新后重试。",
  "invalid-settings": "Claude settings.json 格式无效。",
  "settings-read-failed": "无法读取 Claude settings.json。",
  "invalid-claude-config": "无法安全读取 ~/.claude.json。",
  "invalid-mcp-inventory": "MCP 保全清单无效。",
  "mcp-inventory-write-failed": "无法更新 MCP 保全清单。",
  "settings-backup-failed": "无法备份 Claude settings.json。",
  "mcp-backup-failed": "无法备份 ~/.claude.json。",
  "settings-write-failed": "无法更新 Claude settings.json。",
  "mcp-write-failed": "无法更新 ~/.claude.json。",
  "profile-pointer-write-failed": "配置已恢复，但无法保存当前方案。",
  "rollback-failed": "应用失败，且自动恢复未完全成功，请检查备份文件。",
  "profile-store-write-failed": "无法保存配置方案。",
  "profile-preview-failed": "无法生成方案预览。",
  "profile-apply-failed": "无法应用配置方案。",
  "resource-state-failed": "无法更新资源状态。"
};

function actionFailureMessage(action: "save" | "delete" | "apply", zh: boolean) {
  if (zh) {
    if (action === "save") return "无法保存配置方案。";
    if (action === "delete") return "无法删除配置方案。";
    return "无法应用配置方案。";
  }
  if (action === "save") return "The profile could not be saved.";
  if (action === "delete") return "The profile could not be deleted.";
  return "The profile could not be applied.";
}

function fallbackDescription(kind: ClaudeProfileResource["kind"], zh: boolean) {
  if (kind === "skill") return "Claude Code Skill";
  if (kind === "plugin") return "Claude Code Plugin";
  return zh ? "Claude Code MCP 服务器" : "Claude Code MCP server";
}

function emptyText(tab: ResourceTab, zh: boolean) {
  if (tab === "skills") return zh ? "当前方案未启用 Skills。" : "No Skills are enabled in this profile.";
  if (tab === "plugins") return zh ? "当前方案未启用 Plugins。" : "No Plugins are enabled in this profile.";
  return zh ? "当前方案未启用 MCP。" : "No MCP servers are enabled in this profile.";
}

// Keep-mounted under the tab container: memoized so an unrelated settings change
// or a tab switch doesn't re-render the profile + resource lists. Props are all
// primitives (a boolean flag), so the default shallow compare bails on every
// settings save that doesn't flip `hideSensitiveContent`.
export const PluginsPage = React.memo(PluginsPageInner);

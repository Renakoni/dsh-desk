import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { ClaudeProviderListResult, ClaudeProviderTestResult } from "../../../shared/events";
import { useI18n } from "../../useI18n";
import { redactSensitiveText, type DisplayLanguage } from "../../../../shared/privacy";
import { ConfirmDialog } from "./ConfirmDialog";
import { PANEL_EXIT_MS, ProviderEditPanel } from "./ProviderEditPanel";
import { RoutingToaster } from "./RoutingToaster";
import { SortableClaudeProviderCard } from "./ProviderCard";
import type { ClaudeProvider } from "./types";

type ProviderListProps = {
  providers: ClaudeProvider[];
  currentId: string;
  testingId: string | null;
  loaded: boolean;
  emptyLabel: string;
  onDragEnd: (event: DragEndEvent) => void;
  onSwitch: (provider: ClaudeProvider) => void;
  onEdit: (provider: ClaudeProvider) => void;
  onDuplicate: (provider: ClaudeProvider) => void;
  onTest: (provider: ClaudeProvider) => void;
  onTerminal: (provider: ClaudeProvider) => void;
  onRemove: (provider: ClaudeProvider) => void;
};

const ProviderList = memo(function ProviderList({
  providers,
  currentId,
  testingId,
  loaded,
  emptyLabel,
  onDragEnd,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onTerminal,
  onRemove
}: ProviderListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const providerIds = useMemo(() => providers.map(provider => provider.id), [providers]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={providerIds} strategy={verticalListSortingStrategy}>
        <div className="ccs-provider-list">
          {providers.map(provider => (
            <SortableClaudeProviderCard
              key={provider.id}
              provider={provider}
              isCurrent={provider.id === currentId}
              canRemove={providers.length > 1 && provider.id !== currentId}
              testing={testingId === provider.id}
              onSwitch={onSwitch}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onTest={onTest}
              onTerminal={onTerminal}
              onRemove={onRemove}
            />
          ))}
          {providers.length === 0 && loaded ? <div className="ccs-provider-empty">{emptyLabel}</div> : null}
        </div>
      </SortableContext>
    </DndContext>
  );
});

function formatI18n(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

// Turn a structured "<key>:<detail>" provider warning (emitted by the cc-switch store)
// into a localized, user-facing message. When "hide sensitive content" is on, the detail
// (a file path or an error message that may embed one) is redacted, and the backup-path
// variant is skipped entirely — honoring the app's promise to hide paths in the UI.
// Unknown keys fall back to the (redacted) raw string, so a warning is never hidden.
function formatProviderWarning(warning: string, t: (key: string, fallback: string) => string, hideSensitive: boolean, locale: DisplayLanguage): string {
  const redact = (text: string) => (hideSensitive ? redactSensitiveText(text, locale) : text);
  const sep = warning.indexOf(":");
  const key = sep === -1 ? warning : warning.slice(0, sep);
  const detail = sep === -1 ? "" : warning.slice(sep + 1);
  switch (key) {
    case "cc_switch_settings_unreadable":
      return !hideSensitive && detail && detail !== "no_backup"
        ? formatI18n(t("routing.warnings.settingsUnreadableBackup", "cc-switch 设置文件无法读取，未更新当前项指针（数据库记录仍正确）。已备份到 {detail}"), { detail })
        : t("routing.warnings.settingsUnreadable", "cc-switch 设置文件无法读取，未更新当前项指针（数据库记录仍正确）");
    case "current_pointer_update_failed":
      return formatI18n(t("routing.warnings.pointerUpdateFailed", "更新当前项指针失败（改动已通过数据库生效）：{detail}"), { detail: redact(detail) });
    case "backfill_failed":
      return formatI18n(t("routing.warnings.backfillFailed", "回填上一个供应商的实时配置失败（{detail}）"), { detail: redact(detail) });
    case "common_config_strip_failed":
      return formatI18n(t("routing.warnings.commonConfigStripFailed", "移除公共配置片段失败（{detail}）"), { detail: redact(detail) });
    default:
      return redact(warning);
  }
}

function createEmptyProvider(sortIndex: number, name: string): ClaudeProvider {
  return {
    id: "",
    name,
    category: "custom",
    createdAt: Date.now(),
    sortIndex,
    iconColor: "#f97316",
    settingsConfig: { env: { ANTHROPIC_BASE_URL: "", ANTHROPIC_AUTH_TOKEN: "" } }
  };
}

export function ClaudeRoutingPanel({ hideSensitive = false }: { settings?: unknown; updateSettings?: unknown; connection?: unknown; hideSensitive?: boolean } = {}) {
  const { t, locale } = useI18n();
  const companion = window.companion;
  const [listing, setListing] = useState<ClaudeProviderListResult | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [editingProvider, setEditingProvider] = useState<ClaudeProvider | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClaudeProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  // Bumped to force a fresh form instance: after the Add form closes (rebuilt
  // off the visible path so the prewarm stays instant) and on each Edit open.
  const [addSessionKey, setAddSessionKey] = useState(0);
  const [editSessionKey, setEditSessionKey] = useState(0);
  const addResetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (addResetTimerRef.current !== null) window.clearTimeout(addResetTimerRef.current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await companion.listClaudeProviders();
      setListing(result);
      setOrderOverride(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [companion]);

  useEffect(() => {
    void refresh();
    const unsubscribe = companion.onCcSwitchChanged?.(() => { void refresh(); });
    return () => { unsubscribe?.(); };
  }, [companion, refresh]);

  const providers = useMemo(() => listing?.providers ?? [], [listing]);
  const currentId = listing?.currentId ?? "";
  const isCcSwitch = listing?.source === "cc-switch";

  const sortedProviders = useMemo(() => {
    const base = [...providers].sort((a, b) => {
      if (a.sortIndex !== undefined && b.sortIndex !== undefined && a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      if (a.sortIndex !== undefined && b.sortIndex === undefined) return -1;
      if (a.sortIndex === undefined && b.sortIndex !== undefined) return 1;
      const timeA = a.createdAt ?? 0;
      const timeB = b.createdAt ?? 0;
      if (timeA && timeB && timeA !== timeB) return timeA - timeB;
      return a.name.localeCompare(b.name, locale === "zh" ? "zh-CN" : "en-US");
    });
    if (!orderOverride) return base;
    const byId = new Map(base.map(provider => [provider.id, provider]));
    const ordered = orderOverride.map(id => byId.get(id)).filter((provider): provider is ClaudeProvider => Boolean(provider));
    for (const provider of base) if (!orderOverride.includes(provider.id)) ordered.push(provider);
    return ordered;
  }, [providers, orderOverride, locale]);

  const currentProvider = providers.find(provider => provider.id === currentId) ?? sortedProviders[0];
  const providerSummary = currentProvider
    ? formatI18n(t("routing.providerCountCurrent", "{count} 个供应商 · 当前 {name}"), { count: sortedProviders.length, name: currentProvider.name })
    : formatI18n(t("routing.providerCount", "{count} 个供应商"), { count: sortedProviders.length });

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedProviders.findIndex(provider => provider.id === active.id);
    const newIndex = sortedProviders.findIndex(provider => provider.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sortedProviders, oldIndex, newIndex).map(provider => provider.id);
    setOrderOverride(reordered);
    void companion.reorderClaudeProviders(reordered).then(result => {
      if (!result?.ok) toast.error(result?.error ?? t("routing.orderFailed", "排序保存失败"));
      void refresh();
    });
  }, [companion, refresh, sortedProviders, t]);

  const closeAddEditor = useCallback(() => {
    setCreating(false);
    // Once the fade-out has finished, rebuild a fresh empty Add form off the
    // visible path so the next open is both instant (prewarmed) and clean.
    if (addResetTimerRef.current !== null) window.clearTimeout(addResetTimerRef.current);
    addResetTimerRef.current = window.setTimeout(() => {
      addResetTimerRef.current = null;
      setAddSessionKey(key => key + 1);
    }, PANEL_EXIT_MS);
  }, []);

  const closeEditEditor = useCallback(() => {
    setEditingProvider(null);
  }, []);

  const mergeSavedProvider = useCallback((provider: ClaudeProvider, originalId?: string) => {
    setListing(current => {
      if (!current) return current;
      const previousId = originalId ?? provider.id;
      const exists = current.providers.some(item => item.id === previousId);
      const nextProviders = exists
        ? current.providers.map(item => item.id === previousId ? provider : item)
        : [...current.providers, provider];
      const nextCurrentId = !current.currentId || current.currentId === previousId ? provider.id : current.currentId;
      return { ...current, providers: nextProviders, currentId: nextCurrentId };
    });
    setOrderOverride(null);
  }, []);

  const saveProvider = useCallback(async (provider: ClaudeProvider, originalId?: string) => {
    const result = await companion.saveClaudeProvider(provider, originalId);
    if (!result.ok) {
      toast.error(result.error ?? t("routing.saveFailed", "保存失败"));
      return;
    }
    toast.success(originalId ? t("routing.providerUpdated", "供应商已更新") : t("routing.providerAdded", "供应商已添加"));
    if (result.warnings && result.warnings.length > 0) toast.warning(result.warnings.map(w => formatProviderWarning(w, t, hideSensitive, locale)).join(" · "));
    if (result.provider) mergeSavedProvider(result.provider, originalId);
    else void refresh();
    if (originalId) closeEditEditor();
    else closeAddEditor();
  }, [closeAddEditor, closeEditEditor, companion, hideSensitive, locale, mergeSavedProvider, refresh, t]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const result = await companion.deleteClaudeProvider(pendingDelete.id);
    if (result.ok) toast.success(t("routing.providerDeleted", "供应商已删除"));
    else toast.error(result.error ?? t("routing.deleteFailed", "删除失败"));
    setPendingDelete(null);
    void refresh();
  }

  const handleDuplicate = useCallback(async (provider: ClaudeProvider) => {
    const result = await companion.duplicateClaudeProvider(provider.id);
    if (result.ok) toast.success(t("routing.providerDuplicated", "已复制供应商"));
    else toast.error(result.error ?? t("routing.duplicateFailed", "复制失败"));
    void refresh();
  }, [companion, refresh, t]);

  const handleSwitch = useCallback(async (provider: ClaudeProvider) => {
    const result = await companion.switchClaudeProvider(provider.id);
    if (!result.ok) {
      // Any other error is a raw OS message that can carry an absolute path (username), so
      // redact it when "hide sensitive content" is on.
      const message = result.error === "cc_switch_settings_pointer_unwritable"
        ? t("routing.switchAbortedUnreadable", "无法写入 cc-switch 设置文件，已取消切换以避免当前项与实际配置不一致。请检查或删除该文件后重试。")
        : result.error
          ? (hideSensitive ? redactSensitiveText(result.error, locale) : result.error)
          : t("routing.applyFailed", "切换失败");
      toast.error(message);
      return;
    }
    toast.success(formatI18n(t("routing.switchedTo", "已切换到 {name}，已写入 Claude Code 全局配置"), { name: provider.name }));
    if (result.warnings && result.warnings.length > 0) {
      toast.warning(result.warnings.map(w => formatProviderWarning(w, t, hideSensitive, locale)).join(" · "));
    }
    void refresh();
  }, [companion, hideSensitive, locale, refresh, t]);

  // Toast pattern ported from cc-switch's useStreamCheck: success with
  // latency, warning when reachable but slow, error with a network hint.
  const handleTest = useCallback(async (provider: ClaudeProvider) => {
    setTestingId(provider.id);
    try {
      const result: ClaudeProviderTestResult = await companion.testClaudeProvider({ id: provider.id });
      const latency = typeof result.responseTimeMs === "number" ? ` (${result.responseTimeMs}ms)` : "";
      if (result.status === "operational") {
        toast.success(`${provider.name} ${t("routing.testOk", "连通正常")}${latency}`, { closeButton: true });
      } else if (result.status === "degraded") {
        toast.warning(`${provider.name} ${t("routing.testSlow", "连通但较慢")}${latency}`);
      } else {
        toast.error(`${provider.name} ${t("routing.testUnreachable", "无法连通")}: ${result.message}`, {
          description: t("routing.testUnreachableHint", "无法建立连接（DNS / 连接 / TLS / 超时）。请检查 base_url 与网络。"),
          duration: 8000,
          closeButton: true
        });
      }
    } finally {
      setTestingId(null);
    }
  }, [companion, t]);

  const handleTerminal = useCallback(async (provider: ClaudeProvider) => {
    // Ask which folder to open the terminal in first, like cc-switch: the terminal
    // runs `claude` against that project, so the folder is the point. Cancelling
    // the picker cancels the whole action — no toast, nothing launched.
    const cwd = await companion.pickTerminalDirectory();
    if (!cwd) return;
    const result = await companion.openClaudeProviderTerminal(provider.id, cwd);
    if (result.ok) toast.success(t("routing.terminalOpened", "终端已打开"));
    else toast.error(result.error ?? t("routing.terminalFailed", "打开终端失败"));
  }, [companion, t]);

  const openNewProvider = useCallback(() => {
    // If the post-close rebuild hasn't fired yet, flush it now so a fast reopen
    // still gets a fresh form instead of the previous cancelled one.
    if (addResetTimerRef.current !== null) {
      window.clearTimeout(addResetTimerRef.current);
      addResetTimerRef.current = null;
      setAddSessionKey(key => key + 1);
    }
    setCreating(true);
    setEditingProvider(null);
  }, []);

  const openEditProvider = useCallback((provider: ClaudeProvider) => {
    // New instance each open so a reopen during the exit fade never reuses the
    // previous edit's in-progress input.
    setEditSessionKey(key => key + 1);
    setEditingProvider(provider);
  }, []);
  const emptyProvider = useMemo(
    () => createEmptyProvider(sortedProviders.length, t("routing.newProvider", "新供应商")),
    [sortedProviders.length, t]
  );
  const saveEditorProvider = useCallback((provider: ClaudeProvider, originalId?: string) => {
    void saveProvider(provider, originalId);
  }, [saveProvider]);
  const testEditorEndpoint = useCallback(
    (baseUrl: string) => companion.testClaudeProvider({ baseUrl }),
    [companion]
  );
  const fetchEditorModels = useCallback(
    (payload: { baseUrl: string; apiKey: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }) => companion.fetchClaudeProviderModels(payload),
    [companion]
  );

  return (
    <section className="ccs-provider-board">
      <header className="ccs-provider-board-header">
        <div className="ccs-provider-board-title">
          <h3>
            {t("routing.title", "Claude Code 路由")}
            {isCcSwitch ? (
              <em className="ccs-source-badge" title={listing?.dbPath ?? ""}>cc-switch</em>
            ) : null}
          </h3>
          <p>{providerSummary}</p>
        </div>
        <button
          className="cc-switch-add"
          onClick={openNewProvider}
          title={t("routing.addProvider", "添加供应商")}
          aria-label={t("routing.addProvider", "添加供应商")}
        ><Plus size={18} /></button>
      </header>

      <RoutingToaster />
      {listing?.readError ? <div className="ccs-provider-status">{t("routing.dbReadError", "读取 cc-switch 数据库失败")}: {listing.readError}</div> : null}

      <ProviderList
        providers={sortedProviders}
        currentId={currentId}
        testingId={testingId}
        loaded={Boolean(listing)}
        emptyLabel={t("routing.noProviders", "还没有供应商，点击右上角添加")}
        onDragEnd={handleDragEnd}
        onSwitch={handleSwitch}
        onEdit={openEditProvider}
        onDuplicate={handleDuplicate}
        onTest={handleTest}
        onTerminal={handleTerminal}
        onRemove={setPendingDelete}
      />

      <ProviderEditPanel
        provider={emptyProvider}
        mode="add"
        prewarm
        open={creating}
        sessionKey={addSessionKey}
        onSave={saveEditorProvider}
        onClose={closeAddEditor}
        onTestEndpoint={testEditorEndpoint}
        onFetchModels={fetchEditorModels}
      />

      <ProviderEditPanel
        provider={editingProvider}
        mode="edit"
        open={Boolean(editingProvider)}
        sessionKey={editSessionKey}
        onSave={saveEditorProvider}
        onClose={closeEditEditor}
        onTestEndpoint={testEditorEndpoint}
        onFetchModels={fetchEditorModels}
      />

      {pendingDelete ? (
        <ConfirmDialog
          title={t("routing.deleteProvider", "删除供应商")}
          cancelLabel={t("common.cancel", "取消")}
          confirmLabel={t("common.delete", "删除")}
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { void confirmDelete(); }}
        >
          <p>{formatI18n(t("routing.deleteProviderMessage", '确定要删除供应商 "{name}" 吗？此操作无法撤销。'), { name: pendingDelete.name })}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

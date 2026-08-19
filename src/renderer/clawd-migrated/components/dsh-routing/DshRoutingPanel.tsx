import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { DshProvider, DshProviderListResult, DshProviderSaveInput } from "../../../../shared/dshProviders";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { PANEL_EXIT_MS, ProviderEditPanel } from "./ProviderEditPanel";
import { RoutingToaster } from "./RoutingToaster";
import { SortableDshProviderCard } from "./ProviderCard";

type ProviderListProps = {
  providers: DshProvider[];
  currentId: string;
  testingId: string | null;
  loaded: boolean;
  emptyLabel: string;
  onDragEnd: (event: DragEndEvent) => void;
  onToggle: (provider: DshProvider) => void;
  onSwitch: (provider: DshProvider) => void;
  onEdit: (provider: DshProvider) => void;
  onDuplicate: (provider: DshProvider) => void;
  onTest: (provider: DshProvider) => void;
  onRemove: (provider: DshProvider) => void;
};

const ProviderList = memo(function ProviderList({
  providers,
  currentId,
  testingId,
  loaded,
  emptyLabel,
  onDragEnd,
  onToggle,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
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
            <SortableDshProviderCard
              key={provider.id}
              provider={provider}
              isCurrent={provider.id === currentId}
              canRemove={!provider.isOfficial && provider.id !== currentId}
              testing={testingId === provider.id}
              onToggle={onToggle}
              onSwitch={onSwitch}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onTest={onTest}
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

function createEmptyProvider(name: string): DshProviderSaveInput {
  return {
    id: "",
    name,
    baseUrl: "",
    protocol: "openai-completions",
    models: [],
    inheritModels: false,
    catalogProvider: false,
    enabled: true,
    category: "custom",
    createdAt: Date.now(),
    iconColor: "#f97316"
  };
}

function editDraft(provider: DshProvider): DshProviderSaveInput {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    models: provider.models.map(model => ({ ...model })),
    inheritModels: provider.modelsInherited,
    catalogProvider: provider.catalogProvider,
    enabled: provider.enabled,
    reasoningDefault: provider.reasoningDefault,
    apiKey: provider.apiKey,
    websiteUrl: provider.websiteUrl,
    apiKeyUrl: provider.apiKeyUrl,
    category: provider.category,
    notes: provider.notes,
    icon: provider.icon,
    iconColor: provider.iconColor,
    createdAt: provider.createdAt,
    sortIndex: provider.sortIndex
  };
}

export function DshRoutingPanel() {
  const { t } = useI18n();
  const companion = window.companion;
  const [listing, setListing] = useState<DshProviderListResult | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [editingProvider, setEditingProvider] = useState<DshProvider | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DshProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [addSessionKey, setAddSessionKey] = useState(0);
  const [editSessionKey, setEditSessionKey] = useState(0);
  const addResetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (addResetTimerRef.current !== null) window.clearTimeout(addResetTimerRef.current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await companion.listDshProviders();
      setListing(result);
      setOrderOverride(null);
      if (!result.ok) toast.error(result.error ?? t("dshProviders.loadFailed", "无法读取 DSH 供应商"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [companion, t]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const providers = useMemo(() => listing?.providers ?? [], [listing]);
  const currentId = listing?.defaultProvider ?? "";
  const sortedProviders = useMemo(() => {
    if (!orderOverride) return providers;
    const byId = new Map(providers.map(provider => [provider.id, provider]));
    const ordered = orderOverride.map(id => byId.get(id)).filter((provider): provider is DshProvider => Boolean(provider));
    for (const provider of providers) if (!orderOverride.includes(provider.id)) ordered.push(provider);
    return ordered;
  }, [orderOverride, providers]);
  const currentProvider = providers.find(provider => provider.id === currentId) ?? sortedProviders[0];
  const enabledCount = providers.filter(provider => provider.enabled).length;
  const providerSummary = currentProvider
    ? formatI18n(t("dshProviders.providerSummary", "{count} 个供应商 · {enabled} 个已启用 · 默认 {name}"), { count: sortedProviders.length, enabled: enabledCount, name: currentProvider.name })
    : formatI18n(t("routing.providerCount", "{count} 个供应商"), { count: sortedProviders.length });

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedProviders.findIndex(provider => provider.id === active.id);
    const newIndex = sortedProviders.findIndex(provider => provider.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sortedProviders, oldIndex, newIndex).map(provider => provider.id);
    setOrderOverride(reordered);
    void companion.reorderDshProviders(reordered).then(result => {
      if (!result.ok) toast.error(result.error ?? t("routing.orderFailed", "排序保存失败"));
      void refresh();
    });
  }, [companion, refresh, sortedProviders, t]);

  const closeAddEditor = useCallback(() => {
    setCreating(false);
    if (addResetTimerRef.current !== null) window.clearTimeout(addResetTimerRef.current);
    addResetTimerRef.current = window.setTimeout(() => {
      addResetTimerRef.current = null;
      setAddSessionKey(key => key + 1);
    }, PANEL_EXIT_MS);
  }, []);

  const closeEditEditor = useCallback(() => setEditingProvider(null), []);

  const saveProvider = useCallback(async (provider: DshProviderSaveInput, originalId?: string) => {
    const result = await companion.saveDshProvider(provider);
    if (!result.ok) {
      toast.error(result.error ?? t("routing.saveFailed", "保存失败"));
      return;
    }
    toast.success(originalId ? t("routing.providerUpdated", "供应商已更新") : t("routing.providerAdded", "供应商已添加"));
    if (originalId) closeEditEditor();
    else closeAddEditor();
    await refresh();
  }, [closeAddEditor, closeEditEditor, companion, refresh, t]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const result = await companion.deleteDshProvider(pendingDelete.id);
    if (result.ok) toast.success(t("routing.providerDeleted", "供应商已删除"));
    else toast.error(result.error ?? t("routing.deleteFailed", "删除失败"));
    setPendingDelete(null);
    await refresh();
  }

  const handleDuplicate = useCallback(async (provider: DshProvider) => {
    const result = await companion.duplicateDshProvider(provider.id);
    if (result.ok) toast.success(t("routing.providerDuplicated", "已复制供应商"));
    else toast.error(result.error ?? t("routing.duplicateFailed", "复制失败"));
    await refresh();
  }, [companion, refresh, t]);

  const handleToggle = useCallback(async (provider: DshProvider) => {
    const enabled = !provider.enabled;
    const result = await companion.setDshProviderEnabled(provider.id, enabled);
    if (!result.ok) {
      toast.error(result.error ?? t("dshProviders.toggleFailed", "供应商状态更新失败"));
      return;
    }
    toast.success(enabled
      ? t("dshProviders.providerEnabled", "供应商已启用")
      : t("dshProviders.providerDisabled", "供应商已停用"));
    await refresh();
  }, [companion, refresh, t]);

  const handleSwitch = useCallback(async (provider: DshProvider) => {
    const result = await companion.switchDshProvider(provider.id);
    if (!result.ok) {
      toast.error(result.error ?? t("routing.applyFailed", "切换失败"));
      return;
    }
    toast.success(formatI18n(t("dshProviders.switchedToProvider", "默认供应商已切换为 {name}"), { name: provider.name }));
    await refresh();
  }, [companion, refresh, t]);

  const handleTest = useCallback(async (provider: DshProvider) => {
    setTestingId(provider.id);
    try {
      const result = await companion.probeDshProvider({ id: provider.id, mode: "connectivity" });
      if (result.ok) {
        const latency = result.latencyMs ?? 0;
        const detail = `${latency} ms${result.status ? ` · HTTP ${result.status}` : ""}`;
        if (latency >= 800) {
          toast.warning(`${provider.name} · ${t("routing.testSlow", "连接成功，响应较慢")}`, { description: detail, closeButton: true });
        } else {
          toast.info(`${provider.name} · ${t("routing.testOk", "连接成功")}`, { description: detail, closeButton: true });
        }
      } else {
        toast.error(`${provider.name} · ${t("routing.testUnreachable", "连接失败")}`, {
          description: result.error ?? t("routing.testUnreachableHint", "请检查请求地址与网络"),
          duration: 8000,
          closeButton: true
        });
      }
    } finally {
      setTestingId(null);
    }
  }, [companion, t]);

  const openNewProvider = useCallback(() => {
    if (addResetTimerRef.current !== null) {
      window.clearTimeout(addResetTimerRef.current);
      addResetTimerRef.current = null;
      setAddSessionKey(key => key + 1);
    }
    setCreating(true);
    setEditingProvider(null);
  }, []);

  const openEditProvider = useCallback((provider: DshProvider) => {
    setEditSessionKey(key => key + 1);
    setEditingProvider(provider);
  }, []);

  const emptyProvider = useMemo(() => createEmptyProvider(t("routing.newProvider", "新供应商")), [t]);

  return (
    <section className="ccs-provider-board">
      <header className="ccs-provider-board-header">
        <div className="ccs-provider-board-title">
          <h3>{t("dshProviders.title", "DSH 模型路由")}</h3>
          <p>{providerSummary}</p>
        </div>
        <button className="cc-switch-add" onClick={openNewProvider} title={t("routing.addProvider", "添加供应商")} aria-label={t("routing.addProvider", "添加供应商")}><Plus size={18} /></button>
      </header>

      <RoutingToaster />
      {listing && !listing.ok ? <div className="ccs-provider-status">{listing.error}</div> : null}

      <ProviderList
        providers={sortedProviders}
        currentId={currentId}
        testingId={testingId}
        loaded={Boolean(listing)}
        emptyLabel={t("routing.noProviders", "还没有供应商，点击右上角添加")}
        onDragEnd={handleDragEnd}
        onToggle={provider => { void handleToggle(provider); }}
        onSwitch={handleSwitch}
        onEdit={openEditProvider}
        onDuplicate={handleDuplicate}
        onTest={handleTest}
        onRemove={setPendingDelete}
      />

      <ProviderEditPanel
        provider={emptyProvider}
        catalogProviders={listing?.catalogProviders ?? []}
        mode="add"
        prewarm
        open={creating}
        sessionKey={addSessionKey}
        onSave={(provider, originalId) => { void saveProvider(provider, originalId); }}
        onClose={closeAddEditor}
        onProbe={payload => companion.probeDshProvider(payload)}
      />

      <ProviderEditPanel
        provider={editingProvider ? editDraft(editingProvider) : null}
        catalogProviders={listing?.catalogProviders ?? []}
        mode="edit"
        open={Boolean(editingProvider)}
        sessionKey={editSessionKey}
        onSave={(provider, originalId) => { void saveProvider(provider, originalId); }}
        onClose={closeEditEditor}
        onProbe={payload => companion.probeDshProvider(payload)}
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
          <p>{formatI18n(t("routing.deleteProviderMessage", "确定要删除供应商 {name} 吗？此操作无法撤销。"), { name: pendingDelete.name })}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

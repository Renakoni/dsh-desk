import React from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Activity, Check, Copy, GripVertical, Loader2, Pencil, Play, Terminal, Trash2 } from "lucide-react";
import { useI18n } from "../../useI18n";
import { ProviderIcon } from "./ProviderIcon";
import type { ClaudeProvider, DragHandleProps } from "./types";

type ProviderActionHandlers = {
  onSwitch: (provider: ClaudeProvider) => void;
  onEdit: (provider: ClaudeProvider) => void;
  onDuplicate: (provider: ClaudeProvider) => void;
  onTest: (provider: ClaudeProvider) => void;
  onTerminal: (provider: ClaudeProvider) => void;
  onRemove: (provider: ClaudeProvider) => void;
};

function ProviderIconBlock({ provider }: { provider: ClaudeProvider }) {
  return (
    <div className="ccs-provider-icon">
      <ProviderIcon icon={provider.icon} name={provider.name} color={provider.iconColor} size={20} />
    </div>
  );
}

/** Display URL priority ported from cc-switch's extractApiUrl: notes > websiteUrl > base URL. */
function extractDisplayUrl(provider: ClaudeProvider, fallbackText: string) {
  const notes = provider.notes?.trim();
  if (notes) return { text: notes, clickable: false };
  if (provider.websiteUrl) return { text: provider.websiteUrl, clickable: true };
  const envBase = provider.settingsConfig?.env?.ANTHROPIC_BASE_URL;
  if (typeof envBase === "string" && envBase.trim()) return { text: envBase, clickable: true };
  return { text: fallbackText, clickable: false };
}

function ClaudeProviderActions({
  provider,
  isCurrent,
  canRemove,
  testing,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onTerminal,
  onRemove
}: {
  provider: ClaudeProvider;
  isCurrent: boolean;
  canRemove: boolean;
  testing?: boolean;
} & ProviderActionHandlers) {
  const { t } = useI18n();
  // cc-switch hides connectivity checks for official providers: their
  // base_url is intentionally empty, so there is nothing to probe.
  const canTest = provider.category !== "official";

  return (
    <div className="ccs-provider-actions-inner">
      <span className={isCurrent ? "ccs-provider-action-wrap disabled" : "ccs-provider-action-wrap"}>
        <button className={`ccs-provider-main-action ${isCurrent ? "current" : ""}`} onClick={() => onSwitch(provider)} disabled={isCurrent} title={isCurrent ? t("routing.currentRoute", "当前供应商") : t("routing.switchRoute", "切换到此供应商")}>
          {isCurrent ? <Check size={16} /> : <Play size={16} />}
          <span>{isCurrent ? t("routing.inUse", "已在用") : t("routing.switch", "启用")}</span>
        </button>
      </span>
      <div className="ccs-provider-icon-actions">
        <button onClick={() => onEdit(provider)} title={t("common.edit", "编辑")}><Pencil size={16} /></button>
        <button onClick={() => onDuplicate(provider)} title={t("routing.duplicate", "复制")}><Copy size={16} /></button>
        <button
          onClick={() => { if (canTest) onTest(provider); }}
          disabled={testing || !canTest}
          title={canTest ? t("routing.testConnection", "检测连通") : t("routing.testOfficialHidden", "官方供应商无需检测")}
        >
          {testing ? <Loader2 size={16} className="ccs-spin" /> : <Activity size={16} />}
        </button>
        <button onClick={() => onTerminal(provider)} title={t("routing.openTerminal", "打开终端")}><Terminal size={16} /></button>
        <button className="ccs-provider-delete" onClick={() => onRemove(provider)} disabled={!canRemove} title={t("common.delete", "删除")}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function ClaudeProviderCard({
  provider,
  isCurrent,
  canRemove,
  testing,
  dragHandleProps,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onTerminal,
  onRemove
}: {
  provider: ClaudeProvider;
  isCurrent: boolean;
  canRemove: boolean;
  testing?: boolean;
  dragHandleProps?: DragHandleProps;
} & ProviderActionHandlers) {
  const { t } = useI18n();
  const env = provider.settingsConfig?.env ?? {};
  const isOfficial = provider.category === "official";
  const { text: displayUrl, clickable: urlClickable } = extractDisplayUrl(provider, t("routing.noEndpoint", "未配置请求地址"));
  const categoryLabel = isOfficial
    ? t("routing.categoryOfficial", "官方")
    : provider.category === "cn_official"
      ? t("routing.categoryCnOfficial", "国产官方")
      : provider.category === "aggregator"
        ? t("routing.categoryAggregator", "聚合平台")
        : env.ANTHROPIC_BASE_URL
          ? t("routing.categoryThirdParty", "第三方中转")
          : t("routing.categoryUnconfigured", "未配置");

  return (
    <div className={`ccs-provider-card ${isCurrent ? "active" : ""} ${dragHandleProps?.isDragging ? "dragging" : ""}`}>
      <div className="ccs-provider-gradient" />
      <div className="ccs-provider-content">
        <div className="ccs-provider-left">
          <button className="ccs-drag-handle" aria-label={t("routing.dragSort", "拖拽排序")} {...(dragHandleProps?.attributes ?? {})} {...(dragHandleProps?.listeners ?? {})}>
            <GripVertical size={16} />
          </button>
          <ProviderIconBlock provider={provider} />
          <div className="ccs-provider-main">
            <div className="ccs-provider-titleline">
              <h3>{provider.name}</h3>
              <span>{categoryLabel}</span>
            </div>
            <button
              className={`ccs-provider-url ${urlClickable ? "clickable" : ""}`}
              type="button"
              title={displayUrl}
              disabled={!urlClickable}
              onClick={() => { if (urlClickable) void window.companion.openExternal(displayUrl); }}
            >{displayUrl}</button>
          </div>
        </div>
        <div className="ccs-provider-actions">
          <ClaudeProviderActions
            provider={provider}
            isCurrent={isCurrent}
            canRemove={canRemove}
            testing={testing}
            onSwitch={onSwitch}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onTest={onTest}
            onTerminal={onTerminal}
            onRemove={onRemove}
          />
        </div>
      </div>
    </div>
  );
}

export const SortableClaudeProviderCard = React.memo(function SortableClaudeProviderCard({
  provider,
  isCurrent,
  canRemove,
  testing,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onTerminal,
  onRemove
}: {
  provider: ClaudeProvider;
  isCurrent: boolean;
  canRemove: boolean;
  testing?: boolean;
} & ProviderActionHandlers) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: provider.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ClaudeProviderCard
        provider={provider}
        isCurrent={isCurrent}
        canRemove={canRemove}
        testing={testing}
        dragHandleProps={{ attributes, listeners, isDragging }}
        onSwitch={onSwitch}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onTest={onTest}
        onTerminal={onTerminal}
        onRemove={onRemove}
      />
    </div>
  );
});

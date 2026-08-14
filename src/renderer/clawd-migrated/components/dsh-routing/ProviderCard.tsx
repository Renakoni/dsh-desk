import React from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Activity, Check, Copy, GripVertical, Loader2, Pencil, Play, Power, Trash2 } from "lucide-react";
import { useI18n } from "../../useI18n";
import { ProviderIcon } from "./ProviderIcon";
import type { DragHandleProps, DshRouteProvider } from "./types";

type ProviderActionHandlers = {
  onToggle: (provider: DshRouteProvider) => void;
  onSwitch: (provider: DshRouteProvider) => void;
  onEdit: (provider: DshRouteProvider) => void;
  onDuplicate: (provider: DshRouteProvider) => void;
  onTest: (provider: DshRouteProvider) => void;
  onRemove: (provider: DshRouteProvider) => void;
};

function ProviderIconBlock({ provider }: { provider: DshRouteProvider }) {
  return (
    <div className="ccs-provider-icon">
      <ProviderIcon icon={provider.icon} name={provider.name} color={provider.iconColor} size={20} />
    </div>
  );
}

function extractDisplayUrl(provider: DshRouteProvider, fallbackText: string) {
  const notes = provider.notes?.trim();
  if (notes) return { text: notes, url: "" };
  if (provider.websiteUrl) return { text: provider.websiteUrl, url: provider.websiteUrl };
  if (provider.baseUrl) return { text: provider.baseUrl, url: provider.baseUrl };
  return { text: fallbackText, url: "" };
}

function protocolLabel(provider: DshRouteProvider, t: (key: string, fallback: string) => string) {
  if (provider.isOfficial) return t("dshProviders.official", "官方");
  if (provider.modelsInherited) return t("dshProviders.catalog", "DSH 目录");
  if (provider.protocol === "anthropic-messages") return "Anthropic Messages";
  if (provider.protocol === "openai-responses") return "OpenAI Responses";
  if (provider.protocol === "openai-completions") return "OpenAI Chat Completions";
  return t("dshProviders.custom", "自定义");
}

function DshProviderActions({
  provider,
  isCurrent,
  canRemove,
  testing,
  onToggle,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onRemove
}: {
  provider: DshRouteProvider;
  isCurrent: boolean;
  canRemove: boolean;
  testing?: boolean;
} & ProviderActionHandlers) {
  const { t } = useI18n();
  const canTest = Boolean(provider.baseUrl);

  return (
    <div className="ccs-provider-actions-inner">
      <span className="ccs-provider-action-wrap">
        <button
          className={`ccs-provider-main-action ${provider.enabled ? "disable" : "enable"}`}
          onClick={() => onToggle(provider)}
          title={provider.enabled
            ? t("dshProviders.disable", "停用")
            : t("dshProviders.enable", "启用")}
        >
          <Power size={16} />
          <span>{provider.enabled
            ? t("dshProviders.disable", "停用")
            : t("dshProviders.enable", "启用")}</span>
        </button>
      </span>
      <div className="ccs-provider-icon-actions">
        <button
          onClick={() => onSwitch(provider)}
          disabled={!provider.enabled || isCurrent}
          title={isCurrent ? t("routing.currentRoute", "当前供应商") : t("routing.switchRoute", "设为当前供应商")}
          aria-label={isCurrent ? t("routing.currentRoute", "当前供应商") : t("routing.switchRoute", "设为当前供应商")}
        >{isCurrent ? <Check size={16} /> : <Play size={16} />}</button>
        <button onClick={() => onEdit(provider)} title={t("common.edit", "编辑")} aria-label={t("common.edit", "编辑")}><Pencil size={16} /></button>
        <button onClick={() => onDuplicate(provider)} disabled={provider.isOfficial} title={t("routing.duplicate", "复制")} aria-label={t("routing.duplicate", "复制")}><Copy size={16} /></button>
        <button
          onClick={() => { if (canTest) onTest(provider); }}
          disabled={testing || !canTest}
          title={canTest ? t("routing.testConnection", "检测连通") : t("dshProviders.noEndpointToTest", "此目录路由没有自定义端点")}
          aria-label={t("routing.testConnection", "检测连通")}
        >
          {testing ? <Loader2 size={16} className="ccs-spin" /> : <Activity size={16} />}
        </button>
        <button className="ccs-provider-delete" onClick={() => onRemove(provider)} disabled={!canRemove} title={t("common.delete", "删除")} aria-label={t("common.delete", "删除")}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function DshProviderCard({
  provider,
  isCurrent,
  canRemove,
  testing,
  dragHandleProps,
  onToggle,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onRemove
}: {
  provider: DshRouteProvider;
  isCurrent: boolean;
  canRemove: boolean;
  testing?: boolean;
  dragHandleProps?: DragHandleProps;
} & ProviderActionHandlers) {
  const { t } = useI18n();
  const display = extractDisplayUrl(provider, t("routing.noEndpoint", "使用 DSH 内置配置"));

  return (
    <div className={`ccs-provider-card ${isCurrent ? "active" : ""} ${provider.enabled ? "" : "provider-disabled"} ${dragHandleProps?.isDragging ? "dragging" : ""}`}>
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
              <span>{protocolLabel(provider, t)}</span>
              {isCurrent ? <span className="ccs-provider-state current">{t("dshProviders.current", "当前")}</span> : null}
              {!provider.enabled ? <span className="ccs-provider-state disabled">{t("dshProviders.disabled", "已停用")}</span> : null}
            </div>
            <button
              className={`ccs-provider-url ${display.url ? "clickable" : ""}`}
              type="button"
              title={display.text}
              disabled={!display.url}
              onClick={() => { if (display.url) void window.companion.openExternal(display.url); }}
            >{display.text}</button>
          </div>
        </div>
        <div className="ccs-provider-actions">
          <DshProviderActions
            provider={provider}
            isCurrent={isCurrent}
            canRemove={canRemove}
            testing={testing}
            onToggle={onToggle}
            onSwitch={onSwitch}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onTest={onTest}
            onRemove={onRemove}
          />
        </div>
      </div>
    </div>
  );
}

export const SortableDshProviderCard = React.memo(function SortableDshProviderCard({
  provider,
  isCurrent,
  canRemove,
  testing,
  onToggle,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onRemove
}: {
  provider: DshRouteProvider;
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
      <DshProviderCard
        provider={provider}
        isCurrent={isCurrent}
        canRemove={canRemove}
        testing={testing}
        dragHandleProps={{ attributes, listeners, isDragging }}
        onToggle={onToggle}
        onSwitch={onSwitch}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onTest={onTest}
        onRemove={onRemove}
      />
    </div>
  );
});

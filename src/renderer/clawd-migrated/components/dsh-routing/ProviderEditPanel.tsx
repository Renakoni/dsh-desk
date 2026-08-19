import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Loader2,
  Plus,
  Save,
  TriangleAlert,
  Trash2
} from "lucide-react";
import type {
  DshCatalogProvider,
  DshProviderModel,
  DshProviderProbeInput,
  DshProviderProbeResult,
  DshProviderProtocol,
  DshProviderSaveInput,
  DshReasoningEffort,
  DshReasoningEfforts
} from "../../../../shared/dshProviders";
import { DSH_REASONING_EFFORTS } from "../../../../shared/dshProviders";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPicker } from "./IconPicker";
import { getIconMetadata } from "./icons/metadata";
import { ProviderIcon } from "./ProviderIcon";
import { dshProviderPresets, type DshProviderPreset } from "./presets";

type EditorMode = "add" | "edit";

type ProviderEditPanelProps = {
  provider: DshProviderSaveInput | null;
  catalogProviders: DshCatalogProvider[];
  mode: EditorMode;
  open: boolean;
  prewarm?: boolean;
  sessionKey?: number;
  onSave: (provider: DshProviderSaveInput, originalId?: string) => void;
  onClose: () => void;
  onProbe: (payload: DshProviderProbeInput) => Promise<DshProviderProbeResult>;
};

type ProviderEditContentProps = Omit<ProviderEditPanelProps, "open" | "prewarm" | "sessionKey"> & {
  provider: DshProviderSaveInput;
};

type ReasoningMode = "inherit" | "none" | "custom";

function reasoningMode(model: DshProviderModel, catalogProvider: boolean): ReasoningMode {
  if (model.reasoningEfforts === false) return "none";
  if (model.reasoningEfforts !== undefined) return "custom";
  return catalogProvider ? "inherit" : "none";
}

function reasoningEffortLabel(effort: string) {
  return effort === "xhigh" ? "XHigh" : effort.charAt(0).toUpperCase() + effort.slice(1);
}

function parsePositiveInteger(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return undefined;
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const result = Number(match[1]) * multiplier;
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function compactInteger(value?: number) {
  if (!value) return "";
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1_000 === 0) return `${value / 1_000}K`;
  return String(value);
}

function probeTone(result: DshProviderProbeResult): "info" | "warning" | "error" {
  if (!result.ok) return "error";
  return (result.latencyMs ?? 0) >= 800 ? "warning" : "info";
}

const PresetGrid = memo(function PresetGrid({
  catalogProviders,
  activeId,
  onSelectCustom,
  onSelect
}: {
  catalogProviders: DshCatalogProvider[];
  activeId: string;
  onSelectCustom: () => void;
  onSelect: (preset: DshProviderPreset) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [sorted, setSorted] = useState(false);
  const presets = useMemo(() => dshProviderPresets(catalogProviders), [catalogProviders]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? presets.filter(preset => `${preset.name} ${preset.id}`.toLowerCase().includes(needle))
      : presets;
    return sorted ? [...filtered].sort((left, right) => left.name.localeCompare(right.name)) : filtered;
  }, [presets, query, sorted]);

  return (
    <section className="ccs-form-card">
      <div className="ccs-preset-head">
        <span className="ccs-field-label">{t("routing.presetLabel", "预设供应商")}</span>
        <div className="ccs-preset-tools">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t("routing.presetSearch", "搜索预设…")}
            aria-label={t("routing.presetSearch", "搜索预设…")}
          />
          <button
            type="button"
            className={sorted ? "active" : ""}
            onClick={() => setSorted(value => !value)}
            title={t("routing.presetSort", "按名称排序")}
          >A-Z</button>
        </div>
      </div>
      <div className="ccs-preset-grid">
        <button
          type="button"
          className={`ccs-preset-item ${activeId === "custom" ? "active" : ""}`}
          onClick={onSelectCustom}
        >{t("routing.presetCustom", "自定义")}</button>
        {visible.map(preset => (
          <button
            key={preset.id}
            type="button"
            className={`ccs-preset-item ${activeId === preset.id ? "active" : ""}`}
            onClick={() => onSelect(preset)}
            title={preset.id}
          >
            <ProviderIcon icon={preset.icon} name={preset.name} color={preset.iconColor} size={16} />
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
});

const ProviderEditPanelContent = memo(function ProviderEditPanelContent({
  provider,
  catalogProviders,
  mode,
  onSave,
  onClose,
  onProbe
}: ProviderEditContentProps) {
  const { t } = useI18n();
  const originalId = provider.id;
  const [id, setId] = useState(provider.id ?? "");
  const [name, setName] = useState(provider.name);
  const [notes, setNotes] = useState(provider.notes ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(provider.websiteUrl ?? "");
  const [apiKeyUrl, setApiKeyUrl] = useState(provider.apiKeyUrl ?? "");
  const [category, setCategory] = useState(provider.category ?? (provider.catalogProvider ? "catalog" : "custom"));
  const [icon, setIcon] = useState(provider.icon);
  const [iconColor, setIconColor] = useState(provider.iconColor ?? "");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [protocol, setProtocol] = useState<DshProviderProtocol | "deepseek-chat-completions" | undefined>(provider.protocol);
  const [apiKey, setApiKey] = useState(provider.apiKey ?? "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [catalogProvider, setCatalogProvider] = useState(provider.catalogProvider === true);
  const [inheritModels, setInheritModels] = useState(provider.inheritModels === true);
  const [models, setModels] = useState<DshProviderModel[]>(() => (provider.models ?? []).map(model => ({ ...model })));
  const [catalogModels, setCatalogModels] = useState<DshProviderModel[]>(() => (provider.models ?? []).map(model => ({ ...model })));
  const [reasoningDefault, setReasoningDefault] = useState<DshReasoningEffort | undefined>(provider.reasoningDefault);
  const [activePreset, setActivePreset] = useState(mode === "add" && provider.catalogProvider ? provider.id ?? "custom" : "custom");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<DshProviderProbeResult | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [hardError, setHardError] = useState("");
  const [softIssues, setSoftIssues] = useState<string[] | null>(null);
  const official = id === "deepseek-official";
  const canConfigureModelReasoning = !official && (catalogProvider
    || protocol === "openai-completions"
    || protocol === "openai-responses");
  const officialReasoning = (inheritModels ? catalogModels : models).find(model => model.reasoning)?.reasoning;
  const officialReasoningLevels = officialReasoning?.efforts.filter(effort => DSH_REASONING_EFFORTS.includes(effort.id as DshReasoningEffort)) ?? [];
  const officialEffectiveDefault = officialReasoning?.efforts.find(effort => effort.id === officialReasoning.defaultEffort)?.name
    ?? officialReasoning?.defaultEffort
    ?? "High";
  const formId = `dsh-provider-${mode}-${originalId || "new"}`;

  function applyPreset(preset: DshProviderPreset) {
    setActivePreset(preset.id);
    setId(preset.providerId ?? "");
    setName(preset.name);
    setCategory(preset.category);
    setCatalogProvider(preset.catalogProvider);
    setInheritModels(preset.inheritModels);
    setModels(preset.models.map(model => ({ ...model })));
    setCatalogModels([]);
    setReasoningDefault(undefined);
    setBaseUrl(preset.baseUrl ?? "");
    setProtocol(preset.protocol);
    setWebsiteUrl(preset.websiteUrl ?? "");
    setApiKeyUrl(preset.apiKeyUrl ?? "");
    setIcon(preset.icon);
    setIconColor(preset.iconColor ?? "");
    setProbeResult(null);
    setDiscoveryError("");
  }

  function selectCustom() {
    setActivePreset("custom");
    setId("");
    setName(t("routing.newProvider", "新供应商"));
    setCategory("custom");
    setCatalogProvider(false);
    setInheritModels(false);
    setModels([]);
    setCatalogModels([]);
    setReasoningDefault(undefined);
    setBaseUrl("");
    setProtocol("openai-completions");
    setWebsiteUrl("");
    setApiKeyUrl("");
    setIcon(undefined);
    setIconColor("");
  }

  async function testEndpoint() {
    setProbing(true);
    setProbeResult(null);
    try {
      setProbeResult(await onProbe({
        ...(mode === "edit" ? { id } : {}),
        baseUrl,
        protocol,
        apiKey,
        mode: "connectivity"
      }));
    } finally {
      setProbing(false);
    }
  }

  async function discoverModels() {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const result = await onProbe({ id: id || undefined, baseUrl, protocol, apiKey, mode: "models" });
      if (!result.ok) throw new Error(result.error || t("dshProviders.discoveryFailed", "模型目录加载失败"));
      const discovered = result.models ?? [];
      setCatalogModels(discovered);
      if (!inheritModels && models.length === 0) setModels(discovered.map(model => ({ ...model })));
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscovering(false);
    }
  }

  function updateModel(index: number, patch: Partial<DshProviderModel>) {
    setModels(current => current.map((model, at) => at === index ? { ...model, ...patch } : model));
  }

  function setModelReasoningMode(index: number, nextMode: ReasoningMode) {
    setModels(current => current.map((model, at) => {
      if (at !== index) return model;
      const { reasoningEfforts: _currentEfforts, ...withoutEfforts } = model;
      if (nextMode === "inherit") return withoutEfforts;
      if (nextMode === "none") return { ...withoutEfforts, reasoningEfforts: false };
      return {
        ...withoutEfforts,
        reasoningEfforts: model.reasoningEfforts !== undefined && model.reasoningEfforts !== false
          ? model.reasoningEfforts
          : { high: "high" }
      };
    }));
  }

  function toggleModelReasoningEffort(index: number, effort: DshReasoningEffort, checked: boolean) {
    setModels(current => current.map((model, at) => {
      if (at !== index || model.reasoningEfforts === undefined || model.reasoningEfforts === false) return model;
      const next: DshReasoningEfforts = { ...model.reasoningEfforts };
      if (checked) next[effort] = effort === "off" ? null : effort;
      else delete next[effort];
      return { ...model, reasoningEfforts: next };
    }));
  }

  function updateModelReasoningWireValue(index: number, effort: DshReasoningEffort, value: string) {
    setModels(current => current.map((model, at) => {
      if (at !== index || model.reasoningEfforts === undefined || model.reasoningEfforts === false) return model;
      return {
        ...model,
        reasoningEfforts: {
          ...model.reasoningEfforts,
          [effort]: effort === "off" && !value ? null : value
        }
      };
    }));
  }

  function buildDraft(): DshProviderSaveInput {
    const normalizedModels = models.map(model => {
      const { reasoning: _runtimeReasoning, ...configuredModel } = model;
      return { ...configuredModel, id: model.id.trim() };
    }).filter(model => model.id);
    return {
      id: id.trim() || undefined,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      protocol,
      ...(inheritModels ? {} : { models: normalizedModels }),
      inheritModels,
      catalogProvider,
      enabled: provider.enabled !== false,
      reasoningDefault,
      apiKey,
      notes: notes.trim() || undefined,
      websiteUrl: websiteUrl.trim() || undefined,
      apiKeyUrl: apiKeyUrl.trim() || undefined,
      category,
      icon,
      iconColor: iconColor || undefined,
      createdAt: provider.createdAt,
      sortIndex: provider.sortIndex
    };
  }

  function submit(force = false) {
    setHardError("");
    if (!name.trim()) {
      setHardError(t("routing.nameRequired", "请填写供应商名称"));
      return;
    }
    if (baseUrl.trim()) {
      try {
        const parsed = new URL(baseUrl.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        setHardError(t("routing.endpointInvalid", "请求地址必须是有效的 HTTP(S) URL"));
        return;
      }
    }
    const invalidReasoningModel = models.find(model => {
      if (model.reasoningEfforts === undefined || model.reasoningEfforts === false) return false;
      const entries = Object.entries(model.reasoningEfforts);
      return !entries.some(([effort]) => effort !== "off")
        || entries.some(([effort, wireValue]) => effort !== "off" && (typeof wireValue !== "string" || !wireValue.trim()));
    });
    if (invalidReasoningModel) {
      setHardError(t("dshProviders.reasoningInvalid", "请为 {model} 至少选择一个非关闭档位，并填写协议值")
        .replace("{model}", invalidReasoningModel.name || invalidReasoningModel.id || t("dshProviders.unnamedModel", "未命名模型")));
      return;
    }
    const issues: string[] = [];
    if (!official && !catalogProvider && !baseUrl.trim()) issues.push(t("dshProviders.customNeedsEndpoint", "手工声明的路由通常需要请求地址"));
    if (!official && !catalogProvider && !protocol) issues.push(t("dshProviders.customNeedsProtocol", "手工声明的路由通常需要指定上游协议"));
    if (!force && issues.length > 0) {
      setSoftIssues(issues);
      return;
    }
    onSave(buildDraft(), mode === "edit" ? originalId : undefined);
  }

  return (
    <>
      <header className="ccs-fullscreen-header">
        <button className="ccs-back-button" type="button" onClick={onClose} aria-label={t("common.back", "返回")} title={t("common.back", "返回")}><ArrowLeft size={18} /></button>
        <div className="ccs-fullscreen-title">
          <h2>{mode === "edit" ? t("routing.editProvider", "编辑供应商") : t("routing.addProvider", "添加供应商")}</h2>
          <span>{t("dshProviders.editorSubtitle", "DeepSeek Harness 模型路由")}</span>
        </div>
      </header>

      <main className="ccs-fullscreen-body">
        <form id={formId} className="ccs-provider-form" onSubmit={event => { event.preventDefault(); submit(); }}>
          {mode === "add" ? (
            <PresetGrid
              catalogProviders={catalogProviders}
              activeId={activePreset}
              onSelectCustom={selectCustom}
              onSelect={applyPreset}
            />
          ) : null}

          <section className="ccs-form-card">
            <div className="ccs-icon-block">
              <button type="button" onClick={() => setIconPickerOpen(true)} title={t("routing.iconClickToChange", "点击更换图标")} aria-label={t("routing.iconPickerTitle", "选择图标")}>
                <ProviderIcon icon={icon} name={name || "Provider"} color={iconColor} size={48} />
              </button>
            </div>
            <div className="ccs-form-grid two">
              <label>
                <span>{t("routing.providerName", "供应商名称")}</span>
                <input value={name} disabled={official} onChange={event => setName(event.target.value)} placeholder="OpenRouter" />
              </label>
              <label>
                <span>{t("routing.notes", "备注")}</span>
                <input value={notes} onChange={event => setNotes(event.target.value)} placeholder={t("routing.notesPlaceholder", "例如：公司专用账号")} />
              </label>
              <label>
                <span>{t("routing.websiteUrl", "官网链接")}</span>
                <input value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder="https://example.com" />
              </label>
            </div>
          </section>

          <section className="ccs-form-card">
            <div className="ccs-form-grid">
              <label>
                <span>API Key</span>
                <div className="ccs-apikey-row">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={event => { setApiKey(event.target.value); setProbeResult(null); }}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {apiKey ? (
                    <button type="button" className="ccs-apikey-toggle" onClick={() => setShowApiKey(value => !value)} aria-label={showApiKey ? t("routing.hideApiKey", "隐藏 API Key") : t("routing.showApiKey", "显示 API Key")}>
                      {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  ) : null}
                </div>
                {apiKeyUrl || websiteUrl ? <button type="button" className="ccs-get-key" onClick={() => void window.companion.openExternal(apiKeyUrl || websiteUrl)}>{t("routing.getApiKey", "获取 API Key")}</button> : null}
              </label>

              <div className="ccs-endpoint-field">
                <div className="ccs-field-head">
                  <span className="ccs-field-label">{t("routing.apiEndpoint", "请求地址")}</span>
                  <button type="button" className="ccs-endpoint-manage" disabled={!baseUrl.trim() || probing} onClick={() => void testEndpoint()}>
                    {probing ? <Loader2 size={13} className="ccs-spin" /> : <Gauge size={13} />}
                    {t("routing.speedTest", "测速")}
                  </button>
                </div>
                <input value={baseUrl} disabled={official || catalogProvider} onChange={event => { setBaseUrl(event.target.value); setProbeResult(null); }} placeholder={catalogProvider ? t("dshProviders.catalogEndpoint", "使用 DSH 目录默认端点") : "https://api.example.com/v1"} spellCheck={false} />
                {probeResult ? (() => {
                  const tone = probeTone(probeResult);
                  const slow = tone === "warning";
                  const title = probeResult.ok
                    ? slow ? t("routing.testSlow", "连接成功，响应较慢") : t("routing.testOk", "连接成功")
                    : t("routing.testUnreachable", "连接失败");
                  const detail = probeResult.ok
                    ? `${probeResult.latencyMs ?? 0} ms${probeResult.status ? ` · HTTP ${probeResult.status}` : ""}`
                    : probeResult.error ?? t("routing.testUnreachableHint", "请检查请求地址与网络");
                  return (
                    <div className={`dsh-probe-result ${tone}`} role="status">
                      {tone === "info" ? <CircleCheck size={15} /> : tone === "warning" ? <TriangleAlert size={15} /> : <CircleX size={15} />}
                      <strong>{title}</strong>
                      <span>{detail}</span>
                    </div>
                  );
                })() : null}
              </div>
            </div>
          </section>

          <section className="ccs-form-card">
            <button type="button" className="ccs-advanced-toggle" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>
              {advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span>{t("routing.advancedOptions", "高级选项")}</span>
            </button>
            {advancedOpen ? (
              <div className="ccs-advanced-body">
                {!catalogProvider && !official ? <div className="ccs-form-grid">
                  <label>
                    <span>{t("dshProviders.protocol", "接口协议")}</span>
                    <select value={protocol ?? ""} onChange={event => setProtocol((event.target.value || undefined) as DshProviderProtocol | undefined)}>
                      <option value="openai-completions">OpenAI Chat Completions</option>
                      <option value="openai-responses">OpenAI Responses</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                    </select>
                  </label>
                </div> : null}

                <div className="ccs-model-mapping">
                  <div className="ccs-model-mapping-head">
                    <div>
                      <span className="ccs-field-label">{t("dshProviders.models", "模型列表")}</span>
                      <small className="ccs-field-hint">{inheritModels
                        ? t("dshProviders.catalogInherited", "自动使用 DSH 已知的模型和能力，不写入 models 配置")
                        : catalogProvider
                          ? t("dshProviders.catalogExplicit", "只保存下面列出的模型；未声明的能力继续使用 DSH 目录")
                          : t("dshProviders.manualModelsHint", "为当前接口逐个填写模型；推理能力也按模型配置")}</small>
                    </div>
                    <div className="ccs-model-mapping-actions">
                      <button type="button" className="ccs-model-quickset" disabled={discovering || (!id && !baseUrl)} onClick={() => void discoverModels()}>
                        {discovering ? <Loader2 size={13} className="ccs-spin" /> : <Download size={13} />}
                        {t("routing.fetchModels", "获取模型目录")}
                      </button>
                      {!inheritModels ? <button type="button" className="ccs-model-quickset" onClick={() => setModels(current => [...current, { id: "" }])}><Plus size={13} />{t("common.add", "添加")}</button> : null}
                    </div>
                  </div>

                  {catalogProvider ? (
                    <div className="dsh-model-source" role="radiogroup" aria-label={t("dshProviders.modelSource", "模型来源")}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={inheritModels}
                        className={inheritModels ? "active" : ""}
                        onClick={() => setInheritModels(true)}
                      >{t("dshProviders.builtInModels", "DSH 内置模型")}</button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={!inheritModels}
                        className={!inheritModels ? "active" : ""}
                        onClick={() => {
                          setInheritModels(false);
                          if (models.length === 0) setModels(catalogModels.map(model => ({ ...model })));
                        }}
                      >{t("dshProviders.customModels", "自定义模型列表")}</button>
                    </div>
                  ) : null}

                  {official && officialReasoningLevels.length > 0 ? (
                    <label className="dsh-reasoning-default">
                      <span>{t("dshProviders.requestReasoningDefault", "请求默认强度")}</span>
                      <select
                        value={reasoningDefault ?? ""}
                        aria-label={t("dshProviders.requestReasoningDefault", "请求默认强度")}
                        onChange={event => setReasoningDefault((event.target.value || undefined) as DshReasoningEffort | undefined)}
                      >
                        <option value="">{t("dshProviders.useDshDefault", "DSH 默认（{level}）").replace("{level}", officialEffectiveDefault)}</option>
                        {officialReasoningLevels.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
                      </select>
                      <small>{t("dshProviders.requestReasoningHint", "只设置新请求的默认档位，不改变模型支持的档位。")}</small>
                    </label>
                  ) : null}

                  {!inheritModels && canConfigureModelReasoning ? (
                    <small className="ccs-field-hint">{t("dshProviders.reasoningPerModel", "每个模型分别配置推理能力。")}</small>
                  ) : null}

                  {discoveryError ? <small className="ccs-field-error">{discoveryError}</small> : null}
                  {inheritModels ? (
                    catalogModels.length > 0 ? (
                      <div className="dsh-catalog-preview">
                        {catalogModels.map(model => {
                          const runtimeReasoning = model.reasoning ?? (official ? {
                            efforts: [
                              { id: "off", name: "Off" },
                              { id: "high", name: "High" },
                              { id: "max", name: "Max" }
                            ],
                            defaultEffort: "high"
                          } : undefined);
                          const defaultName = runtimeReasoning?.efforts.find(effort => effort.id === runtimeReasoning.defaultEffort)?.name
                            ?? runtimeReasoning?.defaultEffort;
                          return (
                            <div className="dsh-catalog-model" key={model.id}>
                              <strong title={model.id}>{model.name || model.id}</strong>
                              <span>{runtimeReasoning
                                ? runtimeReasoning.efforts.map(effort => effort.name).join(" · ")
                                : t("dshProviders.noReasoning", "无推理档位")}</span>
                              {defaultName ? <em>{t("dshProviders.reasoningDefault", "默认：{level}").replace("{level}", defaultName)}</em> : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : <small className="ccs-field-hint">{t("dshProviders.catalogLoadHint", "保存后 DSH 会解析该供应商目录，也可以先点击获取模型目录。")}</small>
                  ) : (
                    <div className="ccs-model-table dsh-model-table">
                      <div className={`ccs-model-row ccs-model-row-head ${canConfigureModelReasoning ? "with-reasoning" : ""}`} aria-hidden="true">
                        <span>Model ID</span>
                        <span>{t("dshProviders.displayName", "显示名称")}</span>
                        <span>{t("dshProviders.context", "上下文")}</span>
                        <span>{t("dshProviders.output", "最大输出")}</span>
                        {canConfigureModelReasoning ? <span>{t("dshProviders.reasoningCapability", "推理能力")}</span> : null}
                        <span />
                      </div>
                      {models.map((model, index) => {
                        const modelLabel = model.name || model.id || t("dshProviders.unnamedModel", "未命名模型");
                        const modelReasoningMode = reasoningMode(model, catalogProvider);
                        const configuredEfforts = model.reasoningEfforts !== undefined && model.reasoningEfforts !== false
                          ? model.reasoningEfforts
                          : undefined;
                        return (
                          <div className="dsh-model-entry" key={`${index}:${model.id}`}>
                            <div className={`ccs-model-row ${canConfigureModelReasoning ? "with-reasoning" : ""}`}>
                              <input value={model.id} onChange={event => updateModel(index, { id: event.target.value })} placeholder="model-id" spellCheck={false} />
                              <input value={model.name ?? ""} onChange={event => updateModel(index, { name: event.target.value || undefined })} placeholder={t("dshProviders.displayName", "显示名称")} />
                              <input value={compactInteger(model.contextWindow)} onChange={event => updateModel(index, { contextWindow: parsePositiveInteger(event.target.value) })} placeholder="128K" />
                              <input value={compactInteger(model.maxTokens)} onChange={event => updateModel(index, { maxTokens: parsePositiveInteger(event.target.value) })} placeholder="32K" />
                              {canConfigureModelReasoning ? (
                                <select
                                  value={modelReasoningMode}
                                  aria-label={t("dshProviders.reasoningForModel", "{model} 的推理能力").replace("{model}", modelLabel)}
                                  onChange={event => setModelReasoningMode(index, event.target.value as ReasoningMode)}
                                >
                                  {catalogProvider ? <option value="inherit">{t("dshProviders.reasoningInherit", "跟随 DSH 目录")}</option> : null}
                                  <option value="none">{t("dshProviders.reasoningNone", "不支持")}</option>
                                  <option value="custom">{t("dshProviders.reasoningCustom", "自定义档位")}</option>
                                </select>
                              ) : null}
                              <button type="button" className="dsh-model-delete" onClick={() => setModels(current => current.filter((_, at) => at !== index))} aria-label={t("common.delete", "删除")}><Trash2 size={14} /></button>
                            </div>
                            {canConfigureModelReasoning && modelReasoningMode === "custom" && configuredEfforts ? (
                              <div className="dsh-reasoning-editor" role="group" aria-label={t("dshProviders.reasoningForModel", "{model} 的推理能力").replace("{model}", modelLabel)}>
                                <div className="dsh-reasoning-editor-head">
                                  <span>{t("dshProviders.reasoningLevels", "可用档位")}</span>
                                  <span>{t("dshProviders.wireValue", "协议值")}</span>
                                </div>
                                <div className="dsh-reasoning-grid">
                                  {DSH_REASONING_EFFORTS.map(effort => {
                                    const selected = Object.prototype.hasOwnProperty.call(configuredEfforts, effort);
                                    const label = reasoningEffortLabel(effort);
                                    const wireValue = selected ? configuredEfforts[effort] : undefined;
                                    return (
                                      <div className="dsh-reasoning-effort" key={effort}>
                                        <label className="dsh-reasoning-toggle">
                                          <input
                                            type="checkbox"
                                            checked={selected}
                                            aria-label={t("dshProviders.effortForModel", "{level}（{model}）")
                                              .replace("{level}", label)
                                              .replace("{model}", modelLabel)}
                                            onChange={event => toggleModelReasoningEffort(index, effort, event.target.checked)}
                                          />
                                          <span>{label}</span>
                                        </label>
                                        <input
                                          value={wireValue ?? ""}
                                          disabled={!selected}
                                          aria-label={t("dshProviders.wireForModel", "{model} 的 {level} 协议值")
                                            .replace("{model}", modelLabel)
                                            .replace("{level}", label)}
                                          placeholder={effort === "off" ? t("dshProviders.noWireValue", "不发送") : effort}
                                          onChange={event => updateModelReasoningWireValue(index, effort, event.target.value)}
                                          spellCheck={false}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        </form>
      </main>

      <footer className="ccs-fullscreen-footer">
        {hardError ? <span className="ccs-form-error">{hardError}</span> : null}
        <button className="ccs-panel-cancel" type="button" onClick={onClose}>{t("common.cancel", "取消")}</button>
        <button className="ccs-save-button" type="submit" form={formId}>
          {mode === "edit" ? <Save size={16} /> : <Plus size={16} />}
          {mode === "edit" ? t("common.save", "保存") : t("common.add", "添加")}
        </button>
      </footer>

      {iconPickerOpen ? (
        <IconPicker
          value={icon}
          onSelect={nextIcon => {
            setIcon(nextIcon);
            setIconColor(getIconMetadata(nextIcon)?.defaultColor ?? "");
          }}
          onClose={() => setIconPickerOpen(false)}
        />
      ) : null}

      {softIssues ? (
        <ConfirmDialog
          title={t("routing.softValidationTitle", "配置存在以下问题")}
          cancelLabel={t("common.cancel", "取消")}
          confirmLabel={t("routing.saveAnyway", "仍要保存")}
          onCancel={() => setSoftIssues(null)}
          onConfirm={() => { setSoftIssues(null); submit(true); }}
        >
          <ul>{softIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
        </ConfirmDialog>
      ) : null}
    </>
  );
});

export const PANEL_EXIT_MS = 220;

export const ProviderEditPanel = memo(function ProviderEditPanel({
  open,
  prewarm = false,
  sessionKey = 0,
  provider,
  onClose,
  ...contentProps
}: ProviderEditPanelProps) {
  const [rendered, setRendered] = useState(prewarm || open);
  const [shown, setShown] = useState(false);
  const providerRef = useRef(provider);
  if (open && provider) providerRef.current = provider;
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    if (prewarm) return undefined;
    const timer = window.setTimeout(() => setRendered(false), PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, prewarm]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) openerRef.current = document.activeElement as HTMLElement | null;
    else if (!open && wasOpen) {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && typeof opener.focus === "function") requestAnimationFrame(() => opener.focus());
    }
  }, [open]);

  const activeProvider = providerRef.current;
  if (!rendered || !activeProvider) return null;

  return createPortal(
    <div className={`ccs-fullscreen-panel${shown ? "" : " ccs-fullscreen-hidden"}`} inert={!open}>
      <ProviderEditPanelContent
        key={sessionKey}
        provider={activeProvider}
        onClose={onClose}
        {...contentProps}
      />
    </div>,
    document.body
  );
});

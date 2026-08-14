import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronDown, ChevronRight, Download, Eye, EyeOff, Gauge, Loader2, Plus, Save, Zap } from "lucide-react";
import { useI18n } from "../../useI18n";
import type { ClaudeProviderModelsResult, ClaudeProviderTestResult } from "../../../shared/events";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPicker } from "./IconPicker";
import { ProviderIcon } from "./ProviderIcon";
import { getIconMetadata } from "./icons/metadata";
import { addIconsToPresets } from "./iconInference";
import { claudeProviderPresets, type ClaudeProviderPreset } from "./presets";
import type { ClaudeProvider } from "./types";
import { hasClaudeOneMMarker, setClaudeOneMMarker, stripClaudeOneMMarker } from "./claudeModelMarkers";

const presetsWithIcons = addIconsToPresets(claudeProviderPresets);
const JsonConfigEditor = lazy(() => import("./JsonConfigEditor").then(module => ({ default: module.JsonConfigEditor })));

type SettingsConfig = ClaudeProvider["settingsConfig"];

const AUTH_FIELDS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
type AuthField = (typeof AUTH_FIELDS)[number];

// Haiku has no 1M toggle: it does not offer a 1M context window in Claude's
// lineup, so cc-switch omits the marker for it too.
const MODEL_ROLES = [
  { role: "Sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", nameKey: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", supportsOneM: true },
  { role: "Opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL", nameKey: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", supportsOneM: true },
  { role: "Fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL", nameKey: "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME", supportsOneM: true },
  { role: "Haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL", nameKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", supportsOneM: false }
] as const;

function parseConfig(text: string): SettingsConfig | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as SettingsConfig : null;
  } catch {
    return null;
  }
}

function serializeConfig(config: SettingsConfig): string {
  return JSON.stringify(config, null, 2);
}

function envOf(config: SettingsConfig | null): Record<string, string> {
  const env = config?.env;
  return env && typeof env === "object" ? env as Record<string, string> : {};
}

function substituteTemplate(text: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.split(`\${${key}}`).join(value),
    text
  );
}

function isValidHttpEndpoint(value: string) {
  if (/\$\{[^}]+\}/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

// The preset grid is the heaviest part of the form: ~60 buttons, each with a
// ProviderIcon that parses an inline SVG. cc-switch keeps this in its own
// ProviderPresetSelector with search/sort state held locally so typing in the
// provider fields never touches it. We mirror that: search/sort/filtering live
// here, and the component is memoized on { activeIndex, onSelect } — both stable
// while editing other fields — so a keystroke in API Key / Base URL / model
// inputs no longer reconciles the grid.
type PresetGridProps = {
  activeIndex: number | "custom";
  onSelect: (index: number | "custom") => void;
};

const PresetGrid = memo(function PresetGrid({ activeIndex, onSelect }: PresetGridProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [sorted, setSorted] = useState(false);

  const visiblePresets = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = presetsWithIcons.map((preset, index) => ({ preset, index }));
    if (query) list = list.filter(({ preset }) => preset.name.toLowerCase().includes(query));
    if (sorted) list = [...list].sort((a, b) => a.preset.name.localeCompare(b.preset.name, "zh-CN"));
    return list;
  }, [search, sorted]);

  return (
    <section className="ccs-form-card">
      <div className="ccs-preset-head">
        <span className="ccs-field-label">{t("routing.presetLabel", "预设供应商")}</span>
        <div className="ccs-preset-tools">
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t("routing.presetSearch", "搜索预设…")}
            aria-label={t("routing.presetSearch", "搜索预设…")}
          />
          <button
            type="button"
            className={sorted ? "active" : ""}
            onClick={() => setSorted(current => !current)}
            title={t("routing.presetSort", "按名称排序")}
          >A-Z</button>
        </div>
      </div>
      <div className="ccs-preset-grid">
        <button
          type="button"
          className={`ccs-preset-item ${activeIndex === "custom" ? "active" : ""}`}
          onClick={() => onSelect("custom")}
        >{t("routing.presetCustom", "自定义")}</button>
        {visiblePresets.map(({ preset, index }) => (
          <button
            key={`${preset.name}-${index}`}
            type="button"
            className={`ccs-preset-item ${activeIndex === index ? "active" : ""}`}
            onClick={() => onSelect(index)}
            title={preset.websiteUrl}
          >
            <ProviderIcon icon={preset.icon} name={preset.name} color={preset.iconColor} size={16} />
            <span>{preset.name}</span>
            {preset.isPartner ? <em title={t("routing.presetPartner", "合作伙伴")}>★</em> : null}
          </button>
        ))}
      </div>
    </section>
  );
});

type ProviderEditPanelProps = {
  // Null while closed (the parent clears its selection); the panel retains the
  // last non-null provider so the exit fade still has something to render.
  provider: ClaudeProvider | null;
  mode: "add" | "edit";
  open: boolean;
  // Add uses prewarm=true: the heavy form (~60 preset icons) stays mounted and
  // hidden so opening never pays the ~85ms mount on the click. Edit leaves it
  // false and mounts on demand (it has no preset grid, so the mount is cheap).
  prewarm?: boolean;
  // Bumped by the parent to force a fresh ProviderEditPanelContent instance —
  // after close for the prewarmed Add form (off the visible path), and on each
  // open for Edit — so a reopen never shows stale, cancelled input.
  sessionKey?: number;
  onSave: (provider: ClaudeProvider, originalId?: string) => void;
  onClose: () => void;
  onTestEndpoint?: (baseUrl: string) => Promise<ClaudeProviderTestResult>;
  onFetchModels?: (payload: { baseUrl: string; apiKey: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }) => Promise<ClaudeProviderModelsResult>;
};

type ProviderEditPanelContentProps = {
  provider: ClaudeProvider;
  mode: "add" | "edit";
  onSave: (provider: ClaudeProvider, originalId?: string) => void;
  onClose: () => void;
  onTestEndpoint?: (baseUrl: string) => Promise<ClaudeProviderTestResult>;
  onFetchModels?: (payload: { baseUrl: string; apiKey: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }) => Promise<ClaudeProviderModelsResult>;
};

const ProviderEditPanelContent = memo(function ProviderEditPanelContent({
  provider,
  mode,
  onSave,
  onClose,
  onTestEndpoint,
  onFetchModels
}: ProviderEditPanelContentProps) {
  const { t } = useI18n();

  const [name, setName] = useState(provider.name);
  const [notes, setNotes] = useState(provider.notes ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(provider.websiteUrl ?? "");
  const [apiKeyUrl, setApiKeyUrl] = useState("");
  const [category, setCategory] = useState<string>(provider.category ?? "custom");
  const [iconColor, setIconColor] = useState(provider.iconColor ?? "");
  const [icon, setIcon] = useState(provider.icon);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [configText, setConfigText] = useState(serializeConfig(provider.settingsConfig ?? { env: {} }));
  const [apiFormat, setApiFormat] = useState<string>(String(provider.meta?.apiFormat ?? "anthropic"));
  const [apiKeyField, setApiKeyField] = useState<AuthField>(
    provider.meta?.apiKeyField === "ANTHROPIC_API_KEY" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [endpointManageOpen, setEndpointManageOpen] = useState(false);
  const [presetIndex, setPresetIndex] = useState<number | "custom">("custom");
  const [templateBase, setTemplateBase] = useState<string | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [endpointCandidates, setEndpointCandidates] = useState<string[]>([]);
  const [endpointResults, setEndpointResults] = useState<Record<string, ClaudeProviderTestResult | "testing">>({});
  const [softIssues, setSoftIssues] = useState<string[] | null>(null);
  const [hardError, setHardError] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelFetchLoading, setModelFetchLoading] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const activePreset: ClaudeProviderPreset | null = presetIndex === "custom" ? null : presetsWithIcons[presetIndex] ?? null;
  const parsedConfig = useMemo(() => parseConfig(configText), [configText]);
  const configInvalid = parsedConfig === null;
  const env = envOf(parsedConfig);
  const baseUrl = env.ANTHROPIC_BASE_URL ?? "";
  const apiKey = env[apiKeyField] ?? "";
  const isOfficial = category === "official";

  function updateConfig(mutate: (config: SettingsConfig) => void) {
    if (!parsedConfig) return;
    const next = JSON.parse(JSON.stringify(parsedConfig)) as SettingsConfig;
    mutate(next);
    setConfigText(serializeConfig(next));
  }

  function setEnvValue(key: string, value: string) {
    updateConfig(config => {
      const envBlock = (config.env && typeof config.env === "object" ? config.env : {}) as Record<string, string>;
      if (value) envBlock[key] = value;
      else delete envBlock[key];
      config.env = envBlock;
    });
  }

  function handleAuthFieldChange(nextField: AuthField) {
    if (nextField === apiKeyField) return;
    const currentKey = apiKey;
    updateConfig(config => {
      const envBlock = (config.env && typeof config.env === "object" ? config.env : {}) as Record<string, string>;
      delete envBlock[apiKeyField];
      if (currentKey) envBlock[nextField] = currentKey;
      config.env = envBlock;
    });
    setApiKeyField(nextField);
  }

  // Stable identity so the memoized PresetGrid doesn't re-render when unrelated
  // form fields change — it only closes over stable setters and module data.
  const applyPreset = useCallback((index: number | "custom") => {
    setPresetIndex(index);
    setEndpointResults({});
    if (index === "custom") {
      setTemplateBase(null);
      setTemplateValues({});
      setEndpointCandidates([]);
      return;
    }
    const preset = presetsWithIcons[index];
    if (!preset) return;
    setName(preset.name);
    setWebsiteUrl(preset.websiteUrl ?? "");
    setApiKeyUrl(preset.apiKeyUrl ?? "");
    setCategory(preset.category ?? (preset.isOfficial ? "official" : "third_party"));
    if (preset.iconColor) setIconColor(preset.iconColor);
    if (preset.icon) setIcon(preset.icon);
    setApiFormat(preset.apiFormat ?? "anthropic");
    setApiKeyField(preset.apiKeyField === "ANTHROPIC_API_KEY" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN");
    setEndpointCandidates(preset.endpointCandidates ?? []);
    const baseText = serializeConfig(preset.settingsConfig ?? { env: {} });
    if (preset.templateValues && Object.keys(preset.templateValues).length > 0) {
      const defaults = Object.fromEntries(
        Object.entries(preset.templateValues).map(([key, config]) => [key, config.defaultValue ?? ""])
      );
      setTemplateBase(baseText);
      setTemplateValues(defaults);
      setConfigText(substituteTemplate(baseText, defaults));
    } else {
      setTemplateBase(null);
      setTemplateValues({});
      setConfigText(baseText);
    }
  }, []);

  function handleTemplateValue(key: string, value: string) {
    const nextValues = { ...templateValues, [key]: value };
    setTemplateValues(nextValues);
    if (templateBase) setConfigText(substituteTemplate(templateBase, nextValues));
  }

  async function testEndpoint(url: string) {
    if (!onTestEndpoint || !url) return;
    setEndpointResults(current => ({ ...current, [url]: "testing" }));
    const result = await onTestEndpoint(url);
    setEndpointResults(current => ({ ...current, [url]: result }));
  }

  function fetchModelsErrorText(code?: ClaudeProviderModelsResult["errorCode"]) {
    switch (code) {
      case "config": return t("routing.fetchModelsNeedConfig", "请先填写请求地址和 API Key");
      case "auth": return t("routing.fetchModelsAuthFailed", "鉴权失败，请检查 API Key");
      case "notFound": return t("routing.fetchModelsNotFound", "该端点没有模型列表接口");
      case "timeout": return t("routing.fetchModelsTimeout", "获取超时，请稍后重试");
      case "unsupportedFormat": return t("routing.fetchModelsFormatUnsupported", "当前 API 格式暂不支持获取模型列表");
      case "unsupported": return t("routing.fetchModelsUnsupported", "该端点未返回模型列表");
      default: return t("routing.fetchModelsFailed", "获取模型列表失败");
    }
  }

  async function runFetchModels() {
    if (!onFetchModels) return;
    fetchSeqRef.current += 1;
    const seq = fetchSeqRef.current;
    setModelFetchError(null);
    setModelFetchLoading(true);
    try {
      const savedUserAgent = typeof provider.meta?.customUserAgent === "string" ? provider.meta.customUserAgent.trim() : "";
      const result = await onFetchModels({ baseUrl: baseUrl.trim(), apiKey, apiFormat, apiKeyField, userAgent: savedUserAgent || undefined });
      // A newer fetch — or a provider/address/key/format change — superseded this
      // one: drop the stale response so it can't overwrite the current state.
      if (seq !== fetchSeqRef.current) return;
      if (result.ok) {
        setFetchedModels(result.models);
        if (result.models.length === 0) setModelFetchError(t("routing.fetchModelsEmpty", "该端点未返回可用模型"));
      } else {
        setFetchedModels([]);
        setModelFetchError(fetchModelsErrorText(result.errorCode));
      }
    } catch {
      if (seq === fetchSeqRef.current) setModelFetchError(fetchModelsErrorText("failed"));
    } finally {
      if (seq === fetchSeqRef.current) setModelFetchLoading(false);
    }
  }

  // Fetched suggestions belong to one provider identity. When the address, key,
  // auth field, or API format changes (including via a preset), drop the stale
  // suggestions and invalidate any in-flight fetch so a slow old response can't
  // overwrite the new provider's state.
  useEffect(() => {
    fetchSeqRef.current += 1;
    setFetchedModels([]);
    setModelFetchError(null);
    setModelFetchLoading(false);
  }, [baseUrl, apiKey, apiKeyField, apiFormat]);

  // Only Anthropic / OpenAI-compatible formats expose an OpenAI-style /v1/models
  // list; gemini_native (and anything unknown) does not, so the fetch button is
  // disabled for them rather than offering an action that always fails.
  const fetchSupported = apiFormat === "anthropic" || apiFormat === "openai_chat" || apiFormat === "openai_responses";

  function buildProviderRecord(): ClaudeProvider {
    const settingsConfig = parseConfig(configText) ?? { env: {} };
    const meta: ClaudeProvider["meta"] = { ...(provider.meta ?? {}) };
    if (apiFormat && apiFormat !== "anthropic") meta.apiFormat = apiFormat;
    else delete meta.apiFormat;
    if (apiKeyField !== "ANTHROPIC_AUTH_TOKEN") meta.apiKeyField = apiKeyField;
    else delete meta.apiKeyField;
    // customUserAgent / commonConfigEnabled: no UI anymore, but preserve whatever
    // the record already had (carried by the `...provider.meta` spread above).
    return {
      ...provider,
      id: mode === "edit" ? provider.id : "",
      name: name.trim(),
      notes: notes.trim() || undefined,
      websiteUrl: websiteUrl.trim() || undefined,
      category,
      icon,
      iconColor: iconColor || undefined,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
      settingsConfig
    };
  }

  function collectSoftIssues(): string[] {
    const issues: string[] = [];
    if (!isOfficial && !baseUrl.trim()) issues.push(t("routing.issueNoEndpoint", "未填写请求地址（ANTHROPIC_BASE_URL）"));
    if (!isOfficial && !apiKey.trim()) issues.push(t("routing.issueNoApiKey", "未填写 API Key"));
    const unfilled = Object.entries(templateValues).filter(([, value]) => !value.trim());
    if (templateBase && unfilled.length > 0) {
      issues.push(`${t("routing.issueTemplateUnfilled", "参数未填写")}: ${unfilled.map(([key]) => key).join(", ")}`);
    }
    return issues;
  }

  function submit(force = false) {
    setHardError(null);
    if (!name.trim()) {
      setHardError(t("routing.nameRequired", "请填写供应商名称"));
      return;
    }
    if (parseConfig(configText) === null) {
      setHardError(t("routing.configInvalid", "配置不是合法的 JSON 对象"));
      return;
    }
    if (baseUrl.trim() && !isValidHttpEndpoint(baseUrl.trim())) {
      setHardError(t("routing.endpointInvalid", "请求地址必须是有效的 HTTP(S) URL，且不能包含未填写的模板参数"));
      return;
    }
    if (!force) {
      const issues = collectSoftIssues();
      if (issues.length > 0) {
        setSoftIssues(issues);
        return;
      }
    }
    onSave(buildProviderRecord(), mode === "edit" ? provider.id : undefined);
  }

  const apiKeyPlaceholder = isOfficial
    ? t("routing.officialNoApiKey", "官方供应商无需 API Key，直接保存即可")
    : t("routing.apiKeyAutoFill", "只需要填这里，下方配置会自动填充");

  const endpointHint = apiFormat === "openai_chat"
    ? t("routing.endpointHintOpenaiChat", "💡 填写兼容 OpenAI Chat Completions 的服务端点地址，不要以斜杠结尾")
    : apiFormat === "openai_responses"
      ? t("routing.endpointHintOpenaiResponses", "💡 填写兼容 OpenAI Responses API 的服务端点地址，不要以斜杠结尾")
      : t("routing.endpointHintAnthropic", "💡 填写兼容 Claude API 的服务端点地址，不要以斜杠结尾");

  const advancedActive = apiFormat !== "anthropic"
    || apiKeyField !== "ANTHROPIC_AUTH_TOKEN"
    || MODEL_ROLES.some(({ envKey }) => Boolean(env[envKey]))
    || Boolean(env.ANTHROPIC_MODEL);
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);

  // Portal to <body>: ancestors with backdrop-filter/transform would otherwise
  // trap position:fixed and the footer could scroll out of view.
  const formId = mode === "add" ? "claude-provider-add-form" : "claude-provider-edit-form";
  // Unique per instance: the Add form stays prewarmed/mounted alongside Edit, so a
  // shared datalist id would collide in the DOM.
  const modelsListId = `${formId}-models`;

  // Config quick-toggles (cc-switch parity): each is DERIVED from the JSON (the
  // source of truth) and mutates it. On -> the key/value below; off -> the key is
  // removed. All but "hide attribution" live under env.
  const attribution = (parsedConfig as { attribution?: { commit?: unknown; pr?: unknown } } | null)?.attribution;
  const configToggles = [
    {
      id: "hideAttribution",
      label: t("routing.toggleHideAttribution", "隐藏 AI 署名"),
      checked: attribution?.commit === "" && attribution?.pr === "",
      onToggle: (checked: boolean) => updateConfig(config => {
        const c = config as { attribution?: { commit: string; pr: string } };
        if (checked) c.attribution = { commit: "", pr: "" };
        else delete c.attribution;
      })
    },
    {
      id: "teammates",
      label: t("routing.toggleTeammates", "Teammates 模式"),
      checked: env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1",
      onToggle: (checked: boolean) => setEnvValue("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", checked ? "1" : "")
    },
    {
      id: "toolSearch",
      label: t("routing.toggleToolSearch", "启用 Tool Search"),
      checked: env.ENABLE_TOOL_SEARCH === "true" || env.ENABLE_TOOL_SEARCH === "1",
      onToggle: (checked: boolean) => setEnvValue("ENABLE_TOOL_SEARCH", checked ? "true" : "")
    },
    {
      id: "effortMax",
      label: t("routing.toggleEffortMax", "最大强度思考"),
      checked: env.CLAUDE_CODE_EFFORT_LEVEL === "max",
      onToggle: (checked: boolean) => setEnvValue("CLAUDE_CODE_EFFORT_LEVEL", checked ? "max" : "")
    },
    {
      id: "disableAutoUpgrade",
      label: t("routing.toggleDisableAutoUpgrade", "禁用自动升级"),
      checked: env.DISABLE_AUTOUPDATER === "1",
      onToggle: (checked: boolean) => setEnvValue("DISABLE_AUTOUPDATER", checked ? "1" : "")
    }
  ];

  return (
    <>
      <header className="ccs-fullscreen-header">
        <button className="ccs-back-button" type="button" onClick={onClose} aria-label={t("common.back", "返回")} title={t("common.back", "返回")}><ArrowLeft size={18} /></button>
        <div className="ccs-fullscreen-title">
          <h2>{mode === "edit" ? t("routing.editProvider", "编辑供应商") : t("routing.addProvider", "添加供应商")}</h2>
          <span>Claude Code</span>
        </div>
      </header>

      <main className="ccs-fullscreen-body">
        <form
          id={formId}
          className="ccs-provider-form"
          onSubmit={event => { event.preventDefault(); submit(); }}
        >
          {mode === "add" ? (
            <PresetGrid activeIndex={presetIndex} onSelect={applyPreset} />
          ) : null}

          <section className="ccs-form-card">
            <div className="ccs-icon-block">
              <button
                type="button"
                onClick={() => setIconPickerOpen(true)}
                title={icon ? t("routing.iconClickToChange", "点击更换图标") : t("routing.iconClickToSelect", "点击选择图标")}
                aria-label={t("routing.iconPickerTitle", "选择图标")}
              >
                <ProviderIcon icon={icon} name={name || "Provider"} color={iconColor} size={48} />
              </button>
            </div>
            <div className="ccs-form-grid two">
              <label>
                <span>{t("routing.providerName", "供应商名称")}</span>
                <input value={name} onChange={event => setName(event.target.value)} placeholder={t("routing.namePlaceholder", "例如：Claude 官方")} />
              </label>
              <label>
                <span>{t("routing.notes", "备注")}</span>
                <input value={notes} onChange={event => setNotes(event.target.value)} placeholder={t("routing.notesPlaceholder", "例如：公司专用账号")} />
              </label>
            </div>
            <label>
              <span>{t("routing.websiteUrl", "官网链接")}</span>
              <input value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder={t("routing.websitePlaceholder", "https://example.com（可选）")} />
            </label>
          </section>

          {templateBase && activePreset?.templateValues ? (
            <section className="ccs-form-card">
              <div className="ccs-form-section-heading">
                <div>
                  <h3>{`${t("routing.templateConfig", "参数配置")} - ${activePreset.name} *`}</h3>
                </div>
              </div>
              <div className="ccs-form-grid two">
                {Object.entries(activePreset.templateValues).map(([key, config]) => (
                  <label key={key}>
                    <span>{config.label || key}</span>
                    <input
                      value={templateValues[key] ?? ""}
                      onChange={event => handleTemplateValue(key, event.target.value)}
                      placeholder={config.placeholder}
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <section className="ccs-form-card">
            <div className="ccs-form-grid">
              <label>
                <span>API Key{isOfficial ? "" : " *"}</span>
                <div className="ccs-apikey-row">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    disabled={configInvalid}
                    onChange={event => setEnvValue(apiKeyField, event.target.value)}
                    placeholder={apiKeyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {apiKey ? (
                    <button
                      type="button"
                      className="ccs-apikey-toggle"
                      onClick={() => setShowApiKey(current => !current)}
                      title={showApiKey ? t("routing.hideApiKey", "隐藏 API Key") : t("routing.showApiKey", "显示 API Key")}
                      aria-label={showApiKey ? t("routing.hideApiKey", "隐藏 API Key") : t("routing.showApiKey", "显示 API Key")}
                    >{showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  ) : null}
                </div>
                {(apiKeyUrl || websiteUrl) && !isOfficial ? (
                  <button
                    type="button"
                    className="ccs-getkey-link"
                    onClick={() => window.companion.openExternal(apiKeyUrl || websiteUrl)}
                  >{t("routing.getApiKey", "获取 API Key")}</button>
                ) : null}
              </label>

              <div className="ccs-endpoint-field">
                <div className="ccs-field-head">
                  <span className="ccs-field-label">{t("routing.apiEndpoint", "请求地址")}</span>
                  {endpointCandidates.length > 0 ? (
                    <button
                      type="button"
                      className="ccs-endpoint-manage"
                      onClick={() => setEndpointManageOpen(open => !open)}
                      aria-expanded={endpointManageOpen}
                    ><Zap size={13} />{t("routing.manageEndpoints", "管理与测速")}</button>
                  ) : null}
                </div>
                <input
                  value={baseUrl}
                  disabled={configInvalid}
                  onChange={event => setEnvValue("ANTHROPIC_BASE_URL", event.target.value)}
                  placeholder="https://your-api-endpoint.com"
                  aria-label={t("routing.apiEndpoint", "请求地址")}
                  spellCheck={false}
                />
                <small className="ccs-field-hint ccs-hint-callout">{endpointHint}</small>
                {endpointCandidates.length > 0 && endpointManageOpen ? (
                  <div className="ccs-endpoint-candidates">
                    {endpointCandidates.map(candidate => {
                      const result = endpointResults[candidate];
                      const ms = result && result !== "testing" && result.success ? result.responseTimeMs ?? 0 : null;
                      const latencyClass = ms == null ? "" : ms < 300 ? "good" : ms < 600 ? "ok" : ms < 900 ? "slow" : "bad";
                      return (
                        <div key={candidate} className={`ccs-endpoint-row ${baseUrl === candidate ? "active" : ""}`}>
                          <button type="button" className="ccs-endpoint-url" onClick={() => setEnvValue("ANTHROPIC_BASE_URL", candidate)} title={candidate}>{candidate}</button>
                          <span className={`ccs-endpoint-latency ${latencyClass}`}>
                            {result === "testing"
                              ? t("routing.testing", "测速中…")
                              : result
                                ? result.success ? `${result.responseTimeMs} ms` : t("routing.unreachable", "不可达")
                                : ""}
                          </span>
                          <button type="button" className="ccs-endpoint-test" onClick={() => void testEndpoint(candidate)} disabled={result === "testing"}>
                            <Gauge size={13} />{t("routing.speedTest", "测速")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="ccs-form-card">
            <button type="button" className="ccs-advanced-toggle" onClick={() => setAdvancedOpen(current => !current)} aria-expanded={advancedOpen}>
              {advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span>{t("routing.advancedOptions", "高级选项")}</span>
            </button>
            {advancedOpen ? (
              <div className="ccs-advanced-body">
                <div className="ccs-form-grid">
                  <label>
                    <span>{t("routing.apiFormat", "API 格式")}</span>
                    <select value={apiFormat} onChange={event => setApiFormat(event.target.value)}>
                      <option value="anthropic">{t("routing.apiFormatAnthropic", "Anthropic Messages（原生）")}</option>
                      <option value="openai_chat">{t("routing.apiFormatOpenaiChat", "OpenAI Chat Completions（需网关转换）")}</option>
                      <option value="openai_responses">{t("routing.apiFormatOpenaiResponses", "OpenAI Responses API（需网关转换）")}</option>
                      <option value="gemini_native">{t("routing.apiFormatGemini", "Gemini Native generateContent（需网关转换）")}</option>
                    </select>
                  </label>
                  <label>
                    <span>{t("routing.authField", "认证字段")}</span>
                    <select value={apiKeyField} onChange={event => handleAuthFieldChange(event.target.value as AuthField)}>
                      <option value="ANTHROPIC_AUTH_TOKEN">ANTHROPIC_AUTH_TOKEN（{t("routing.default", "默认")}）</option>
                      <option value="ANTHROPIC_API_KEY">ANTHROPIC_API_KEY</option>
                    </select>
                    <small className="ccs-field-hint">{t("routing.authFieldHint", "选择写入配置的认证环境变量名")}</small>
                  </label>
                </div>

                <div className="ccs-model-mapping">
                  <div className="ccs-model-mapping-head">
                    <span className="ccs-field-label">{t("routing.modelMapping", "模型映射")}</span>
                    <div className="ccs-model-mapping-actions">
                      <button
                        type="button"
                        className="ccs-model-quickset"
                        disabled={configInvalid || (!env.ANTHROPIC_MODEL && !MODEL_ROLES.some(({ envKey }) => env[envKey]))}
                        onClick={() => {
                          // cc-switch parity: propagate the first model found (the
                          // fallback first, then the role slots) to every role —
                          // keeping the [1M] marker for 1M-capable roles, stripping it
                          // for Haiku — and set each display name to the base id.
                          const seedRaw = env.ANTHROPIC_MODEL || MODEL_ROLES.map(({ envKey }) => env[envKey]).find(Boolean) || "";
                          if (!stripClaudeOneMMarker(seedRaw).trim()) return;
                          updateConfig(config => {
                            const envBlock = (config.env && typeof config.env === "object" ? config.env : {}) as Record<string, string>;
                            for (const { envKey, nameKey, supportsOneM } of MODEL_ROLES) {
                              const roleValue = supportsOneM ? seedRaw : stripClaudeOneMMarker(seedRaw);
                              envBlock[envKey] = roleValue;
                              envBlock[nameKey] = stripClaudeOneMMarker(roleValue);
                            }
                            config.env = envBlock;
                          });
                        }}
                      >{t("routing.quickSetModels", "一键设置")}</button>
                      {onFetchModels ? (
                        <button
                          type="button"
                          className="ccs-model-quickset"
                          disabled={modelFetchLoading || configInvalid || !fetchSupported || !baseUrl.trim() || !apiKey.trim()}
                          onClick={() => void runFetchModels()}
                          title={!fetchSupported ? t("routing.fetchModelsFormatUnsupported", "当前 API 格式暂不支持获取模型列表") : undefined}
                        >
                          {modelFetchLoading ? <Loader2 size={13} className="ccs-spin" /> : <Download size={13} />}
                          {t("routing.fetchModels", "获取模型列表")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <small className="ccs-field-hint">{t("routing.modelMappingHint2", "显示名称只影响 /model 菜单；1M 只是给 Claude Code 声明 1M 上下文能力。")}</small>
                  {onFetchModels && !fetchSupported ? (
                    <small className="ccs-field-hint">{t("routing.fetchModelsFormatUnsupported", "当前 API 格式暂不支持获取模型列表")}</small>
                  ) : null}
                  <div className="ccs-model-table">
                    <div className="ccs-model-row ccs-model-row-head" aria-hidden="true">
                      <span>{t("routing.modelRole", "模型角色")}</span>
                      <span>{t("routing.modelDisplayName", "显示名称")}</span>
                      <span>{t("routing.modelActual", "实际请求模型")}</span>
                      <span>{t("routing.modelOneM", "声明支持 1M")}</span>
                    </div>
                    {MODEL_ROLES.map(({ role, envKey, nameKey, supportsOneM }) => {
                      const raw = env[envKey] ?? "";
                      const base = stripClaudeOneMMarker(raw);
                      const oneM = supportsOneM && hasClaudeOneMMarker(raw);
                      return (
                        <div className="ccs-model-row" key={envKey}>
                          <div className="ccs-model-role">{role}</div>
                          <input
                            value={env[nameKey] ?? ""}
                            disabled={configInvalid}
                            onChange={event => setEnvValue(nameKey, event.target.value)}
                            placeholder={t("routing.modelNamePlaceholder", "例如 DeepSeek V4 Pro")}
                            aria-label={`${role} ${t("routing.modelDisplayName", "显示名称")}`}
                            spellCheck={false}
                          />
                          <input
                            value={base}
                            disabled={configInvalid}
                            onChange={event => setEnvValue(envKey, setClaudeOneMMarker(event.target.value, oneM))}
                            placeholder={t("routing.modelPlaceholder", "实际请求模型，可留空")}
                            aria-label={`${role} ${t("routing.modelActual", "实际请求模型")}`}
                            list={fetchedModels.length > 0 ? modelsListId : undefined}
                            spellCheck={false}
                          />
                          {supportsOneM ? (
                            <label className="ccs-model-onem">
                              <input
                                type="checkbox"
                                checked={oneM}
                                disabled={configInvalid || !base}
                                onChange={event => setEnvValue(envKey, setClaudeOneMMarker(base, event.target.checked))}
                                aria-label={`${role} 1M`}
                              />
                              <span>1M</span>
                            </label>
                          ) : <span className="ccs-model-onem-empty" aria-hidden="true" />}
                        </div>
                      );
                    })}
                  </div>
                  <label className="ccs-model-fallback">
                    <span>{t("routing.fallbackModel", "默认兜底模型")}</span>
                    <input
                      value={env.ANTHROPIC_MODEL ?? ""}
                      disabled={configInvalid}
                      onChange={event => setEnvValue("ANTHROPIC_MODEL", event.target.value)}
                      placeholder={t("routing.fallbackModelPlaceholder", "未命中角色映射时使用")}
                      list={fetchedModels.length > 0 ? modelsListId : undefined}
                      spellCheck={false}
                    />
                  </label>
                  {modelFetchError ? <small className="ccs-field-error">{modelFetchError}</small> : null}
                  {fetchedModels.length > 0 ? (
                    <datalist id={modelsListId}>
                      {fetchedModels.map(model => <option key={model} value={model} />)}
                    </datalist>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="ccs-form-card">
            <div className="ccs-form-section-heading">
              <div>
                <h3>{t("routing.configLabel", "配置（settings.json）")}</h3>
                <p>{t("routing.configDesc", "切换到此供应商时写入 ~/.claude/settings.json 的完整内容")}</p>
              </div>
            </div>
            <div className="ccs-config-toggles">
              {configToggles.map(toggle => (
                <label key={toggle.id} className="ccs-config-toggle">
                  <input type="checkbox" checked={toggle.checked} disabled={configInvalid} onChange={event => toggle.onToggle(event.target.checked)} />
                  <span>{toggle.label}</span>
                </label>
              ))}
            </div>
            {/* cc-switch parity: the settings.json editor is always shown (no
                show/hide toggle). It stays a lazy chunk, so the CodeMirror bundle
                still code-splits and only loads with the form. */}
            <Suspense fallback={<div className="ccs-json-editor ccs-json-editor-loading" aria-hidden="true" />}>
              <JsonConfigEditor value={configText} onChange={setConfigText} ariaLabel={t("routing.configLabel", "配置（settings.json）")} />
            </Suspense>
            {configInvalid ? <small className="ccs-field-error">{t("routing.configInvalid", "配置不是合法的 JSON 对象")}</small> : null}
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
          <ul>
            {softIssues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        </ConfirmDialog>
      ) : null}
    </>
  );
});

// Matches the CSS opacity/transform transition on .ccs-fullscreen-panel; a
// mount-on-demand (Edit) form stays mounted this long after close so the exit
// fade can play, and the parent waits at least this long before resetting the
// prewarmed (Add) form.
export const PANEL_EXIT_MS = 220;

export const ProviderEditPanel = memo(function ProviderEditPanel({
  open,
  prewarm = false,
  sessionKey = 0,
  provider,
  onClose,
  ...contentProps
}: ProviderEditPanelProps) {
  // Two lifecycles share this shell (see the `prewarm` prop doc):
  //  - Add (prewarm): the heavy form stays mounted+hidden so opening is instant;
  //    the parent bumps `sessionKey` after close to rebuild it off the visible
  //    path. This restores the #69 prewarm that v3 regressed to an ~85ms mount.
  //  - Edit (on demand): cheap to mount, so it mounts on open and unmounts after
  //    the exit fade; the parent bumps `sessionKey` on each open.
  //
  //  - `rendered` keeps content in the DOM: always when prewarmed, else across
  //    the exit fade only.
  //  - `shown` drives the visual fade; it dips false for the pre-enter frame and
  //    during exit. a11y visibility tracks `open`, not the animation frame.
  const [rendered, setRendered] = useState(prewarm || open);
  const [shown, setShown] = useState(false);
  const providerRef = useRef(provider);
  if (open && provider) providerRef.current = provider;

  // Remember whoever opened us (the Add / row Edit trigger) so focus can return
  // there on close. Once the panel goes inert, a keyboard user whose focus is
  // still inside it would otherwise be dropped on <body>.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    if (prewarm) return undefined; // stay mounted (hidden) for an instant reopen
    const timer = window.setTimeout(() => setRendered(false), PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, prewarm]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      // Capture the trigger the moment we open, before focus moves into the form.
      openerRef.current = document.activeElement as HTMLElement | null;
    } else if (!open && wasOpen) {
      const opener = openerRef.current;
      openerRef.current = null;
      // Restore after the panel is inert so the browser doesn't fight us for the
      // active element.
      if (opener && typeof opener.focus === "function") {
        requestAnimationFrame(() => opener.focus());
      }
    }
  }, [open]);

  const activeProvider = providerRef.current;
  if (!rendered || !activeProvider) return null;

  return createPortal(
    <div
      className={`ccs-fullscreen-panel${shown ? "" : " ccs-fullscreen-hidden"}`}
      // `inert` when not open removes the whole subtree from the tab order, from
      // pointer/focus, and from the accessibility tree. The prewarmed Add form
      // stays mounted+hidden, so without this every field, preset button and the
      // footer stayed keyboard-focusable behind `opacity:0` — and `aria-hidden`
      // over focusable descendants is itself invalid. `inert` supersedes both.
      inert={!open}
    >
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

// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import type { DshProvider, DshProviderModel, DshProviderProtocol, DshProviderSaveInput } from "../../../../shared/dshProviders";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../../components/claude-routing/ConfirmDialog";

const EMPTY_MODELS: DshProviderModel[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1_000_000 },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1_000_000 }
];

function cloneModels(models: DshProviderModel[]) {
  return models.map(model => ({ ...model }));
}

function emptyDraft(): DshProviderSaveInput {
  return {
    id: "",
    name: "",
    baseUrl: "https://",
    protocol: "openai-completions",
    models: cloneModels(EMPTY_MODELS),
    apiKey: ""
  };
}

function providerDraft(provider: DshProvider): DshProviderSaveInput {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    models: cloneModels(provider.models.length > 0 ? provider.models : EMPTY_MODELS),
    apiKey: ""
  };
}

function protocolLabel(protocol: DshProvider["protocol"], t: (key: string, fallback: string) => string) {
  if (protocol === "deepseek-chat-completions") return t("dshProviders.protocolDeepSeek", "DeepSeek Chat Completions");
  if (protocol === "openai-responses") return t("dshProviders.protocolResponses", "OpenAI Responses");
  if (protocol === "anthropic-messages") return t("dshProviders.protocolAnthropic", "Anthropic Messages");
  return t("dshProviders.protocolCompletions", "OpenAI Chat Completions");
}

function compactCapacity(value?: number) {
  if (!value) return "";
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1_000 === 0) return `${value / 1_000}K`;
  return String(value);
}

function parseCapacity(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!match) return undefined;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function DshProviderEditor({ initial, isNew, onClose, onSaved }: {
  initial: DshProviderSaveInput;
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const official = draft.id === "deepseek-official";

  const setField = (key: keyof DshProviderSaveInput, value: unknown) => setDraft(current => ({ ...current, [key]: value }));
  const updateModel = (index: number, patch: Partial<DshProviderModel>) => setDraft(current => ({
    ...current,
    models: current.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model)
  }));
  const removeModel = (index: number) => setDraft(current => ({ ...current, models: current.models.filter((_, modelIndex) => modelIndex !== index) }));

  async function discoverModels() {
    setDiscovering(true);
    setError("");
    try {
      const result = await window.companion.probeDshProvider({
        ...(isNew ? {} : { id: draft.id }),
        baseUrl: draft.baseUrl,
        protocol: draft.protocol,
        apiKey: draft.apiKey
      });
      if (!result.ok) throw new Error(result.error || t("dshProviders.discoveryFailed", "模型发现失败"));
      if (!result.models?.length) throw new Error(t("dshProviders.noModels", "端点未返回模型"));
      setDraft(current => {
        const existing = new Map(current.models.map(model => [model.id, model]));
        return { ...current, models: result.models.map(model => existing.get(model.id) ?? model) };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiscovering(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await window.companion.saveDshProvider(draft);
      if (!result.ok) throw new Error(result.error || t("dshProviders.saveFailed", "保存失败"));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
      <section className="dsh-provider-editor" aria-label={isNew ? t("dshProviders.add", "添加供应商") : t("dshProviders.edit", "编辑供应商")}>
        <header className="dsh-provider-editor-head">
          <button type="button" onClick={onClose} title={t("common.back", "返回")} aria-label={t("common.back", "返回")}><ArrowLeft size={18} /></button>
          <div className="dsh-provider-editor-mark"><Server size={20} /></div>
          <div>
            <h3>{isNew ? t("dshProviders.add", "添加供应商") : t("dshProviders.edit", "编辑供应商")}</h3>
            <span>{t("dshProviders.editorSubtitle", "写入 DeepSeek Harness 的本地配置")}</span>
          </div>
        </header>

        <form id="dsh-provider-form" className="dsh-provider-form" onSubmit={submit}>
          <div className="dsh-provider-form-grid two">
            <label>
              <span>{t("dshProviders.name", "供应商名称")}</span>
              <input value={draft.name} disabled={official} onChange={event => setField("name", event.target.value)} placeholder="DeepSeek Gateway" />
            </label>
            <label>
              <span>{t("dshProviders.id", "Provider ID")}</span>
              <input value={draft.id} disabled={!isNew} onChange={event => setField("id", event.target.value.toLowerCase())} placeholder="my-gateway" spellCheck={false} />
            </label>
          </div>

          <label>
            <span>{t("dshProviders.endpoint", "API 端点")}</span>
            <input value={draft.baseUrl} onChange={event => setField("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} />
          </label>

          <div className="dsh-provider-form-grid two">
            <label>
              <span>{t("dshProviders.protocol", "接口转换")}</span>
              <div className="dsh-provider-select-wrap">
                <select value={draft.protocol} disabled={official} onChange={event => setField("protocol", event.target.value as DshProviderProtocol)}>
                  {official ? <option value="deepseek-chat-completions">DeepSeek Chat Completions</option> : null}
                  {!official ? <>
                    <option value="openai-completions">OpenAI Chat Completions</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                  </> : null}
                </select>
                <ChevronDown size={15} />
              </div>
              <small>{draft.protocol === "anthropic-messages"
                ? t("dshProviders.protocolAnthropicNote", "DSH 转换为 Anthropic Messages；此协议没有 OpenAI /models 发现接口。")
                : t("dshProviders.protocolNote", "DSH 会把统一会话请求转换为此上游协议。")}</small>
            </label>
            <label>
              <span>API Key</span>
              <div className="dsh-provider-key-field">
                <input type={showKey ? "text" : "password"} value={draft.apiKey ?? ""} onChange={event => setField("apiKey", event.target.value)} placeholder={isNew ? "sk-..." : t("dshProviders.keepKey", "留空则保留现有密钥")} autoComplete="off" spellCheck={false} />
                <button type="button" onClick={() => setShowKey(value => !value)} title={showKey ? t("routing.hideApiKey", "隐藏 API Key") : t("routing.showApiKey", "显示 API Key")} aria-label={showKey ? t("routing.hideApiKey", "隐藏 API Key") : t("routing.showApiKey", "显示 API Key")}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </label>
          </div>

          <section className="dsh-provider-models-editor">
            <header>
              <div>
                <h4>{t("dshProviders.models", "模型")}</h4>
                <span>{draft.models.length}</span>
              </div>
              <div>
                <button type="button" onClick={() => void discoverModels()} disabled={discovering || draft.protocol === "anthropic-messages"} title={draft.protocol === "anthropic-messages" ? t("dshProviders.discoverUnsupported", "Anthropic Messages 不支持 /models 发现") : t("dshProviders.discover", "从端点发现模型")}>{discovering ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}<span>{t("dshProviders.discover", "发现模型")}</span></button>
                <button type="button" onClick={() => setDraft(current => ({ ...current, models: [...current.models, { id: "" }] }))}><Plus size={15} /><span>{t("common.add", "添加")}</span></button>
              </div>
            </header>
            {draft.models.map((model, index) => (
              <div className={`dsh-provider-model-entry${expandedModels.has(index) ? " expanded" : ""}`} key={`${index}:${model.id}`}>
                <div className="dsh-provider-model-row">
                  <input value={model.id} onChange={event => updateModel(index, { id: event.target.value })} placeholder="deepseek-v4-pro" spellCheck={false} aria-label="Model ID" />
                  <input value={model.name ?? ""} onChange={event => updateModel(index, { name: event.target.value || undefined })} placeholder={t("dshProviders.displayName", "显示名称")} aria-label={t("dshProviders.displayName", "显示名称")} />
                  <button type="button" className="capacity" onClick={() => setExpandedModels(current => {
                    const next = new Set(current);
                    if (!next.delete(index)) next.add(index);
                    return next;
                  })} title={t("dshProviders.capacity", "模型容量")} aria-label={t("dshProviders.capacity", "模型容量")} aria-expanded={expandedModels.has(index)}><SlidersHorizontal size={15} /></button>
                  <button type="button" onClick={() => removeModel(index)} disabled={draft.models.length <= 1} title={t("common.delete", "删除")} aria-label={t("common.delete", "删除")}><Trash2 size={15} /></button>
                </div>
                {expandedModels.has(index) ? <div className="dsh-provider-model-capacity">
                  <label><span>{t("dshProviders.context", "上下文")}</span><input value={compactCapacity(model.contextWindow)} onChange={event => updateModel(index, { contextWindow: parseCapacity(event.target.value) })} placeholder="1M" inputMode="numeric" /></label>
                  <label><span>{t("dshProviders.output", "最大输出")}</span><input value={compactCapacity(model.maxTokens)} onChange={event => updateModel(index, { maxTokens: parseCapacity(event.target.value) })} placeholder="384K" inputMode="numeric" /></label>
                </div> : null}
              </div>
            ))}
          </section>
          {error ? <p className="dsh-provider-form-error">{error}</p> : null}
        </form>

        <footer className="dsh-provider-editor-footer">
          <button type="button" onClick={onClose}>{t("common.cancel", "取消")}</button>
          <button type="submit" form="dsh-provider-form" className="primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{t("common.save", "保存")}</button>
        </footer>
      </section>
  );
}

export function DshProvidersPanel() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<DshProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ draft: DshProviderSaveInput; isNew: boolean } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DshProvider | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await window.companion.listDshProviders();
      if (!result.ok) throw new Error(result.error || t("dshProviders.loadFailed", "无法读取 DSH 供应商"));
      setProviders(result.providers);
      setSelectedModels(current => Object.fromEntries(result.providers.map(provider => [provider.id, current[provider.id] || provider.defaultModel || provider.models[0]?.id || ""])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  const defaultProvider = useMemo(() => providers.find(provider => provider.isDefault), [providers]);

  async function switchProvider(provider: DshProvider) {
    setSwitching(provider.id);
    setNotice("");
    try {
      const result = await window.companion.switchDshProvider(provider.id, selectedModels[provider.id]);
      if (!result.ok) throw new Error(result.error || t("dshProviders.switchFailed", "切换失败"));
      setNotice(t("dshProviders.switched", "默认供应商已更新"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitching(null);
    }
  }

  async function testProvider(provider: DshProvider) {
    setTesting(provider.id);
    setNotice("");
    try {
      const result = await window.companion.probeDshProvider({ id: provider.id });
      if (!result.ok) throw new Error(result.error || t("dshProviders.testFailed", "连通性检测失败"));
      setNotice(`${provider.name} · ${result.latencyMs ?? 0} ms · ${result.models?.length ?? 0} ${t("dshProviders.models", "模型")}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(null);
    }
  }

  async function removeProvider() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const result = await window.companion.deleteDshProvider(target.id);
    if (!result.ok) setError(result.error || t("dshProviders.deleteFailed", "删除失败"));
    else {
      setNotice(t("dshProviders.deleted", "供应商已删除"));
      await load();
    }
  }

  if (editor) {
    return <div className="dsh-providers-page"><DshProviderEditor initial={editor.draft} isNew={editor.isNew} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice(t("dshProviders.saved", "供应商已保存")); void load(); }} /></div>;
  }

  return (
    <div className="dsh-providers-page">
      <header className="dsh-providers-toolbar">
        <div>
          <span className="dsh-providers-kicker">DeepSeek Harness</span>
          <h3>{t("dshProviders.title", "模型与供应商")}</h3>
          <p>{defaultProvider ? `${defaultProvider.name} · ${defaultProvider.defaultModel ?? ""}` : t("dshProviders.noDefault", "尚未设置默认模型")}</p>
        </div>
        <button className="dsh-provider-add" type="button" onClick={() => setEditor({ draft: emptyDraft(), isNew: true })}><Plus size={16} />{t("dshProviders.add", "添加供应商")}</button>
      </header>

      {error ? <div className="dsh-provider-banner error"><span>{error}</span><button onClick={() => setError("")} aria-label={t("common.close", "关闭")}><X size={14} /></button></div> : null}
      {notice ? <div className="dsh-provider-banner success"><Check size={15} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label={t("common.close", "关闭")}><X size={14} /></button></div> : null}

      {loading && providers.length === 0 ? (
        <div className="dsh-providers-loading"><Loader2 size={18} className="spin" />{t("common.loading", "加载中…")}</div>
      ) : (
        <div className="dsh-provider-list">
          {providers.map(provider => (
            <article key={provider.id} className={`dsh-provider-card${provider.isDefault ? " active" : ""}`}>
              <div className={`dsh-provider-avatar${provider.isOfficial ? " official" : ""}`}><Server size={20} /></div>
              <div className="dsh-provider-identity">
                <div className="dsh-provider-titleline">
                  <h4>{provider.name}</h4>
                  {provider.isOfficial ? <span>{t("dshProviders.official", "官方")}</span> : null}
                  {provider.isDefault ? <span className="current"><Check size={11} />{t("dshProviders.default", "默认")}</span> : null}
                </div>
                <button type="button" className="dsh-provider-url" title={provider.baseUrl} onClick={() => { if (provider.baseUrl) void window.companion.openExternal(provider.baseUrl); }}>{provider.baseUrl || t("dshProviders.noEndpoint", "未配置端点")}</button>
                <div className="dsh-provider-facts">
                  <span>{t("dshProviders.adapter", "DSH 转换")} · {protocolLabel(provider.protocol, t)}</span>
                  {provider.credentialRef ? <span className={provider.hasCredential ? "credential ready" : "credential"}><KeyRound size={12} />{provider.hasCredential ? t("dshProviders.keyReady", "密钥已配置") : t("dshProviders.keyMissing", "缺少密钥")}</span> : <span className="credential native"><KeyRound size={12} />{t("dshProviders.providerAuth", "供应商认证")}</span>}
                  <span>{provider.models.length} {t("dshProviders.models", "模型")}</span>
                </div>
              </div>
              <div className="dsh-provider-default-control">
                <div className="dsh-provider-select-wrap">
                  <select value={selectedModels[provider.id] ?? ""} disabled={provider.models.length === 0} onChange={event => setSelectedModels(current => ({ ...current, [provider.id]: event.target.value }))} aria-label={t("dshProviders.defaultModel", "默认模型")}>
                    {provider.models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <button type="button" className={`dsh-provider-power${provider.isDefault ? " current" : ""}`} disabled={provider.isDefault || switching === provider.id || provider.models.length === 0} onClick={() => void switchProvider(provider)} title={provider.isDefault ? t("dshProviders.default", "默认供应商") : t("dshProviders.makeDefault", "设为默认供应商")}>
                  {switching === provider.id ? <Loader2 size={16} className="spin" /> : provider.isDefault ? <Check size={16} /> : <Power size={16} />}
                </button>
              </div>
              <div className="dsh-provider-actions">
                <button type="button" onClick={() => void testProvider(provider)} disabled={testing === provider.id || !provider.baseUrl || provider.protocol === "anthropic-messages"} title={provider.protocol === "anthropic-messages" ? t("dshProviders.discoverUnsupported", "Anthropic Messages 不支持 /models 发现") : t("dshProviders.test", "检测连通性")} aria-label={t("dshProviders.test", "检测连通性")}>{testing === provider.id ? <Loader2 size={16} className="spin" /> : <Activity size={16} />}</button>
                <button type="button" onClick={() => setEditor({ draft: providerDraft(provider), isNew: false })} title={t("common.edit", "编辑")} aria-label={t("common.edit", "编辑")}><Pencil size={16} /></button>
                <button type="button" className="danger" onClick={() => setPendingDelete(provider)} disabled={provider.isOfficial} title={t("common.delete", "删除")} aria-label={t("common.delete", "删除")}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog title={t("dshProviders.deleteTitle", "删除供应商")} cancelLabel={t("common.cancel", "取消")} confirmLabel={t("common.delete", "删除")} onCancel={() => setPendingDelete(null)} onConfirm={() => void removeProvider()}>
          <p>{t("dshProviders.deleteMessage", "确定删除这个供应商及其由 DSH Desk 管理的密钥吗？").replace("{name}", pendingDelete.name)}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

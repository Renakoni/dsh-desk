import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Document, parseDocument } from "yaml";
import {
  DSH_PROVIDER_PROTOCOLS,
  type DshProvider,
  type DshProviderListResult,
  type DshProviderModel,
  type DshProviderMutationResult,
  type DshProviderProbeInput,
  type DshProviderProbeResult,
  type DshProviderProtocol,
  type DshProviderSaveInput,
  type DshProviderSwitchResult
} from "../shared/dshProviders";

const OFFICIAL_PROVIDER = "deepseek-official";
const OFFICIAL_BASE_URL = "https://api.deepseek.com";
const OFFICIAL_CREDENTIAL = "DEEPSEEK_API_KEY";
const DEFAULT_MODELS: DshProviderModel[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1_000_000 },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1_000_000 }
];

type JsonObject = Record<string, unknown>;
type DshProviderStoreOptions = {
  dshHome?: string;
  fetchImpl?: typeof fetch;
};

function dshHome(options?: DshProviderStoreOptions) {
  return options?.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

function settingsPath(options?: DshProviderStoreOptions) {
  return join(dshHome(options), "settings.yaml");
}

function credentialsPath(options?: DshProviderStoreOptions) {
  return join(dshHome(options), ".credentials.yaml");
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readOptional(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function parseYaml(text: string | undefined, filePath: string, secret = false) {
  const document = text === undefined ? new Document({}) : parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(secret
      ? `DeepSeek Harness credentials file is invalid at ${filePath}`
      : `DeepSeek Harness settings file is invalid at ${filePath}: ${document.errors[0]?.code ?? "YAML_ERROR"}`);
  }
  const root = document.toJS() ?? {};
  if (!isObject(root)) throw new Error(`DeepSeek Harness YAML root must be a mapping at ${filePath}`);
  return { document, root };
}

async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(filePath), { recursive: true });
  const deadline = Date.now() + 2_000;
  let delay = 20;
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for the DeepSeek Harness writer lock at ${lockPath}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 200);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

async function writeAtomic(filePath: string, contents: string) {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, contents, { mode: 0o600 });
    await rename(tempPath, filePath);
    try { await chmod(filePath, 0o600); } catch { /* Windows uses ACLs rather than POSIX modes. */ }
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function mutateYaml(filePath: string, mutate: (document: ReturnType<typeof parseDocument>) => void, secret = false) {
  await withFileLock(filePath, async () => {
    const { document } = parseYaml(await readOptional(filePath), filePath, secret);
    mutate(document as ReturnType<typeof parseDocument>);
    await writeAtomic(filePath, document.toString());
  });
}

function modelList(value: unknown, fallback: DshProviderModel[] = []): DshProviderModel[] {
  if (!Array.isArray(value)) return fallback.map(model => ({ ...model }));
  const models: DshProviderModel[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    models.push({
      id: item.id.trim(),
      ...(typeof item.name === "string" && item.name.trim() ? { name: item.name.trim() } : {}),
      ...(typeof item.contextWindow === "number" && Number.isSafeInteger(item.contextWindow) && item.contextWindow > 0 ? { contextWindow: item.contextWindow } : {}),
      ...(typeof item.maxTokens === "number" && Number.isSafeInteger(item.maxTokens) && item.maxTokens > 0 ? { maxTokens: item.maxTokens } : {})
    });
  }
  return models;
}

function credentialMap(root: JsonObject, filePath: string) {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(root)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || !value) {
      throw new Error(`DeepSeek Harness credentials file is invalid at ${filePath}`);
    }
    values.set(key, value);
  }
  return values;
}

export function deriveDshCredentialRef(providerId: string) {
  return `CHARA_DSH_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

function providerFromProfile(id: string, profile: JsonObject, credentials: Map<string, string>, defaultProvider: string, defaultModel: string): DshProvider {
  const protocol = typeof profile.api === "string" && DSH_PROVIDER_PROTOCOLS.includes(profile.api as DshProviderProtocol)
    ? profile.api as DshProviderProtocol
    : "openai-completions";
  const credentialRef = typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : undefined;
  return {
    id,
    name: typeof profile.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : id,
    baseUrl: typeof profile.baseURL === "string" ? profile.baseURL : "",
    protocol,
    models: modelList(profile.models),
    ...(credentialRef ? { credentialRef } : {}),
    hasCredential: credentialRef ? !!(process.env[credentialRef] || credentials.get(credentialRef)) : false,
    isOfficial: false,
    isDefault: defaultProvider === id,
    ...(defaultProvider === id ? { defaultModel } : {})
  };
}

export async function listDshProviders(options?: DshProviderStoreOptions): Promise<DshProviderListResult> {
  const settingsFile = settingsPath(options);
  const credentialsFile = credentialsPath(options);
  try {
    const [{ root }, credentialDocument] = await Promise.all([
      readOptional(settingsFile).then(text => parseYaml(text, settingsFile)),
      readOptional(credentialsFile).then(text => parseYaml(text, credentialsFile, true))
    ]);
    const credentials = credentialMap(credentialDocument.root, credentialsFile);
    const selection = asObject(root["agent-default-model"]);
    const defaultProvider = typeof selection.provider === "string" ? selection.provider : OFFICIAL_PROVIDER;
    const defaultModel = typeof selection.model === "string" ? selection.model : DEFAULT_MODELS[0].id;
    const deepseek = asObject(root["llm-deepseek"]);
    const officialRef = typeof deepseek.apiKeyEnv === "string" ? deepseek.apiKeyEnv : OFFICIAL_CREDENTIAL;
    const providers: DshProvider[] = [{
      id: OFFICIAL_PROVIDER,
      name: "DeepSeek",
      baseUrl: typeof deepseek.baseURL === "string" ? deepseek.baseURL : OFFICIAL_BASE_URL,
      protocol: "deepseek-chat-completions",
      models: modelList(deepseek.models, DEFAULT_MODELS),
      credentialRef: officialRef,
      hasCredential: !!(process.env[officialRef] || credentials.get(officialRef)),
      isOfficial: true,
      isDefault: defaultProvider === OFFICIAL_PROVIDER,
      ...(defaultProvider === OFFICIAL_PROVIDER ? { defaultModel } : {})
    }];
    const piProviders = asObject(asObject(root["llm-pi-ai"]).providers);
    for (const [id, value] of Object.entries(piProviders)) {
      if (isObject(value)) providers.push(providerFromProfile(id, value, credentials, defaultProvider, defaultModel));
    }
    providers.sort((left, right) => Number(right.isOfficial) - Number(left.isOfficial) || left.name.localeCompare(right.name));
    return { ok: true, providers, defaultProvider, defaultModel, settingsPath: settingsFile, credentialsPath: credentialsFile };
  } catch (error) {
    return { ok: false, providers: [], defaultProvider: OFFICIAL_PROVIDER, defaultModel: DEFAULT_MODELS[0].id, error: errorMessage(error) };
  }
}

function normalizeSaveInput(input: DshProviderSaveInput) {
  const id = input.id.trim();
  if (id !== OFFICIAL_PROVIDER && !/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error("Provider ID must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens");
  }
  const name = input.name.trim();
  if (!name) throw new Error("Provider name is required");
  let baseUrl: string;
  try {
    const parsed = new URL(input.baseUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Provider endpoint must be a valid HTTP(S) URL");
  }
  if (id === OFFICIAL_PROVIDER && input.protocol !== "deepseek-chat-completions") throw new Error("The official route uses the DeepSeek Chat Completions adapter");
  if (id !== OFFICIAL_PROVIDER && !DSH_PROVIDER_PROTOCOLS.includes(input.protocol as DshProviderProtocol)) throw new Error("Unsupported DeepSeek Harness provider protocol");
  const models = modelList(input.models);
  if (models.length === 0) throw new Error("At least one model is required");
  if (new Set(models.map(model => model.id)).size !== models.length) throw new Error("Model IDs must be unique");
  const apiKey = input.apiKey?.trim();
  if (apiKey && (!/^[\x21-\x7E]+$/.test(apiKey) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(apiKey))) {
    throw new Error("API key must be a printable value, not an environment assignment");
  }
  return { id, name, baseUrl, protocol: input.protocol, models, apiKey };
}

function serializeModels(models: DshProviderModel[]) {
  return models.map(model => ({
    id: model.id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {})
  }));
}

async function setCredential(ref: string, value: string, options?: DshProviderStoreOptions) {
  const filePath = credentialsPath(options);
  await mutateYaml(filePath, document => document.setIn([ref], value), true);
}

export async function saveDshProvider(input: DshProviderSaveInput, options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  try {
    const normalized = normalizeSaveInput(input);
    const settingsFile = settingsPath(options);
    const { root } = parseYaml(await readOptional(settingsFile), settingsFile);
    const existing = normalized.id === OFFICIAL_PROVIDER
      ? asObject(root["llm-deepseek"])
      : asObject(asObject(asObject(root["llm-pi-ai"]).providers)[normalized.id]);
    const existingRef = typeof existing.apiKeyEnv === "string" && existing.apiKeyEnv ? existing.apiKeyEnv : undefined;
    const credentialRef = existingRef
      ?? (normalized.id === OFFICIAL_PROVIDER ? OFFICIAL_CREDENTIAL : normalized.apiKey ? deriveDshCredentialRef(normalized.id) : undefined);
    await mutateYaml(settingsPath(options), document => {
      const currentRoot = asObject(document.toJS());
      if (normalized.id === OFFICIAL_PROVIDER) {
        const current = asObject(currentRoot["llm-deepseek"]);
        document.setIn(["llm-deepseek"], {
          ...current,
          apiKeyEnv: credentialRef,
          baseURL: normalized.baseUrl,
          models: serializeModels(normalized.models)
        });
        return;
      }
      const current = asObject(asObject(asObject(currentRoot["llm-pi-ai"]).providers)[normalized.id]);
      document.setIn(["llm-pi-ai", "providers", normalized.id], {
        ...current,
        displayName: normalized.name,
        ...(credentialRef ? { apiKeyEnv: credentialRef } : {}),
        api: normalized.protocol,
        baseURL: normalized.baseUrl,
        models: serializeModels(normalized.models)
      });
    });
    if (normalized.apiKey && credentialRef) await setCredential(credentialRef, normalized.apiKey, options);
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === normalized.id);
    return provider ? { ok: true, provider } : { ok: false, error: listing.error ?? "Provider was saved but could not be reloaded" };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteDshProvider(id: string, options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  if (id === OFFICIAL_PROVIDER) return { ok: false, error: "The official DeepSeek route cannot be deleted" };
  try {
    const listing = await listDshProviders(options);
    if (!listing.ok) throw new Error(listing.error);
    const provider = listing.providers.find(item => item.id === id);
    if (!provider) throw new Error("Provider not found");
    await mutateYaml(settingsPath(options), document => {
      document.deleteIn(["llm-pi-ai", "providers", id]);
      if (listing.defaultProvider === id) {
        document.setIn(["agent-default-model"], { provider: OFFICIAL_PROVIDER, model: DEFAULT_MODELS[0].id });
      }
    });
    const ownedRef = deriveDshCredentialRef(id);
    if (provider.credentialRef === ownedRef) {
      await mutateYaml(credentialsPath(options), document => document.deleteIn([ownedRef]), true);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function switchDshProvider(id: string, model?: string, options?: DshProviderStoreOptions): Promise<DshProviderSwitchResult> {
  try {
    const listing = await listDshProviders(options);
    if (!listing.ok) throw new Error(listing.error);
    const provider = listing.providers.find(item => item.id === id);
    if (!provider) throw new Error("Provider not found");
    const selectedModel = model?.trim() || provider.models[0]?.id;
    if (!selectedModel) throw new Error("Select a model before making this provider the default");
    if (provider.models.length > 0 && !provider.models.some(item => item.id === selectedModel)) throw new Error("The selected model does not belong to this provider");
    await mutateYaml(settingsPath(options), document => {
      document.setIn(["agent-default-model"], { provider: id, model: selectedModel });
    });
    return { ok: true, provider: id, model: selectedModel };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function modelsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  return url.toString();
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function discoveredModels(body: unknown): DshProviderModel[] {
  const data = isObject(body) && Array.isArray(body.data) ? body.data : [];
  return data.flatMap(item => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    const name = typeof item.name === "string" && item.name.trim()
      ? item.name.trim()
      : typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : undefined;
    const contextWindow = positiveInteger(item.context_window) ?? positiveInteger(item.context_length);
    const maxTokens = positiveInteger(item.max_tokens) ?? positiveInteger(item.max_output_tokens);
    return [{
      id: item.id.trim(),
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {})
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export async function probeDshProvider(payload: DshProviderProbeInput, options?: DshProviderStoreOptions): Promise<DshProviderProbeResult> {
  try {
    let baseUrl = payload.baseUrl?.trim() ?? "";
    let apiKey = payload.apiKey?.trim();
    let protocol = payload.protocol;
    if (payload.id) {
      const listing = await listDshProviders(options);
      if (!listing.ok) throw new Error(listing.error);
      const provider = listing.providers.find(item => item.id === payload.id);
      if (!provider) throw new Error("Provider not found");
      baseUrl ||= provider.baseUrl;
      protocol = provider.protocol;
      if (!apiKey && provider.credentialRef) {
        const filePath = credentialsPath(options);
        const { root } = parseYaml(await readOptional(filePath), filePath, true);
        apiKey = process.env[provider.credentialRef] || credentialMap(root, filePath).get(provider.credentialRef);
      }
    }
    if (!baseUrl) throw new Error("Provider endpoint is required");
    if (protocol === "anthropic-messages") throw new Error("Anthropic Messages providers do not expose the OpenAI /models endpoint");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const startedAt = Date.now();
    try {
      const response = await (options?.fetchImpl ?? fetch)(modelsUrl(baseUrl), {
        signal: controller.signal,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) return { ok: false, latencyMs, status: response.status, error: `Provider returned HTTP ${response.status}` };
      const body: unknown = await response.json();
      return { ok: true, latencyMs, status: response.status, models: discoveredModels(body) };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { ok: false, error: (error as Error)?.name === "AbortError" ? "Provider request timed out" : errorMessage(error) };
  }
}

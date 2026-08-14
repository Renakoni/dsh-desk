import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Document, parseDocument } from "yaml";
import {
  DSH_PROVIDER_PROTOCOLS,
  type DshCatalogProvider,
  type DshProvider,
  type DshProviderListResult,
  type DshProviderModel,
  type DshProviderMutationResult,
  type DshProviderProbeInput,
  type DshProviderProbeResult,
  type DshProviderProtocol,
  type DshProviderSaveInput,
  type DshProviderSwitchResult,
  type DshProviderUiMeta
} from "../shared/dshProviders";

const OFFICIAL_PROVIDER = "deepseek-official";
const OFFICIAL_BASE_URL = "https://api.deepseek.com";
const OFFICIAL_CREDENTIAL = "DEEPSEEK_API_KEY";
const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3080";
const DSH_DESK_STATE_FILE = ".dsh-desk-providers.json";
const DEFAULT_MODELS: DshProviderModel[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1_000_000 },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1_000_000 }
];

type JsonObject = Record<string, unknown>;
type DshProviderStoreOptions = {
  dshHome?: string;
  fetchImpl?: typeof fetch;
  runtimeFetchImpl?: typeof fetch;
  runtimeUrl?: string | false;
};

type DshDeskState = {
  version: 1;
  order: string[];
  providers: Record<string, DshProviderUiMeta>;
};

type RuntimeProvider = {
  provider: string;
  displayName: string;
  active: boolean;
  declared?: boolean;
};

type RuntimeModelGroup = {
  id: string;
  name: string;
  models: DshProviderModel[];
};

type RuntimeSnapshot = {
  available: boolean;
  providers: RuntimeProvider[];
  groups: RuntimeModelGroup[];
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

function deskStatePath(options?: DshProviderStoreOptions) {
  return join(dshHome(options), DSH_DESK_STATE_FILE);
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
    await mkdir(dirname(filePath), { recursive: true });
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

function emptyDeskState(): DshDeskState {
  return { version: 1, order: [], providers: {} };
}

async function readDeskState(options?: DshProviderStoreOptions): Promise<DshDeskState> {
  const text = await readOptional(deskStatePath(options));
  if (!text) return emptyDeskState();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) return emptyDeskState();
    const order = Array.isArray(parsed.order) ? parsed.order.filter((value): value is string => typeof value === "string") : [];
    const providers = isObject(parsed.providers) ? parsed.providers as Record<string, DshProviderUiMeta> : {};
    return { version: 1, order, providers };
  } catch {
    return emptyDeskState();
  }
}

async function mutateDeskState(options: DshProviderStoreOptions | undefined, mutate: (state: DshDeskState) => void) {
  const filePath = deskStatePath(options);
  await withFileLock(filePath, async () => {
    const state = await readDeskState(options);
    mutate(state);
    await writeAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
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

function runtimeEnabled(options?: DshProviderStoreOptions) {
  if (options?.runtimeUrl === false) return false;
  return options?.runtimeUrl !== undefined || options?.dshHome === undefined;
}

function runtimeUrl(options?: DshProviderStoreOptions) {
  const configured = typeof options?.runtimeUrl === "string" ? options.runtimeUrl : process.env.DSH_WEB_URL ?? DEFAULT_RUNTIME_URL;
  return configured.replace(/\/+$/, "");
}

async function runtimeRpc(method: string, payload: JsonObject, options?: DshProviderStoreOptions): Promise<JsonObject> {
  if (!runtimeEnabled(options)) throw new Error("DSH runtime discovery is disabled");
  const base = runtimeUrl(options);
  const rpcId = `dsh-desk-${randomUUID()}`;
  const response = await (options?.runtimeFetchImpl ?? fetch)(`${base}/api/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      referer: `${base}/`
    },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    signal: AbortSignal.timeout(3_000)
  });
  if (!response.ok) throw new Error(`DSH runtime returned HTTP ${response.status}`);
  const envelope = await response.json() as unknown;
  if (!isObject(envelope) || envelope.rpcId !== rpcId) throw new Error("DSH runtime returned an invalid response");
  const result = asObject(envelope.result);
  if (result.ok !== true) {
    const failure = asObject(result.error);
    throw new Error(typeof failure.message === "string" ? failure.message : "DSH runtime rejected the request");
  }
  return asObject(result.value);
}

async function runtimeSnapshot(options?: DshProviderStoreOptions): Promise<RuntimeSnapshot> {
  if (!runtimeEnabled(options)) return { available: false, providers: [], groups: [] };
  try {
    const [providerValue, modelValue] = await Promise.all([
      runtimeRpc("llm.providers", {}, options),
      runtimeRpc("llm.models", {}, options)
    ]);
    const providers = Array.isArray(providerValue.providers)
      ? providerValue.providers.flatMap(item => {
        if (!isObject(item) || typeof item.provider !== "string") return [];
        return [{
          provider: item.provider,
          displayName: typeof item.displayName === "string" ? item.displayName : item.provider,
          active: item.active === true,
          ...(typeof item.declared === "boolean" ? { declared: item.declared } : {})
        }];
      })
      : [];
    const groups = Array.isArray(modelValue.groups)
      ? modelValue.groups.flatMap(item => {
        if (!isObject(item) || typeof item.id !== "string") return [];
        return [{
          id: item.id,
          name: typeof item.name === "string" ? item.name : item.id,
          models: modelList(item.models)
        }];
      })
      : [];
    return { available: true, providers, groups };
  } catch {
    return { available: false, providers: [], groups: [] };
  }
}

export function deriveDshCredentialRef(providerId: string) {
  return `CHARA_DSH_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

function providerFromProfile(
  id: string,
  profile: JsonObject,
  credentials: Map<string, string>,
  defaultProvider: string,
  defaultModel: string,
  meta: DshProviderUiMeta,
  runtime?: RuntimeProvider,
  runtimeGroup?: RuntimeModelGroup
): DshProvider {
  const protocol = typeof profile.api === "string" && DSH_PROVIDER_PROTOCOLS.includes(profile.api as DshProviderProtocol)
    ? profile.api as DshProviderProtocol
    : undefined;
  const credentialRef = typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : undefined;
  const modelsInherited = !Array.isArray(profile.models);
  const configuredModels = modelList(profile.models);
  return {
    ...meta,
    id,
    name: typeof profile.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : runtime?.displayName ?? id,
    baseUrl: typeof profile.baseURL === "string" ? profile.baseURL : "",
    ...(protocol ? { protocol } : {}),
    models: modelsInherited && runtimeGroup ? runtimeGroup.models : configuredModels,
    modelsInherited,
    catalogProvider: runtime?.declared === false,
    runtimeActive: runtime?.active ?? false,
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
    const [{ root }, credentialDocument, deskState, runtime] = await Promise.all([
      readOptional(settingsFile).then(text => parseYaml(text, settingsFile)),
      readOptional(credentialsFile).then(text => parseYaml(text, credentialsFile, true)),
      readDeskState(options),
      runtimeSnapshot(options)
    ]);
    const credentials = credentialMap(credentialDocument.root, credentialsFile);
    const selection = asObject(root["agent-default-model"]);
    const defaultProvider = typeof selection.provider === "string" ? selection.provider : OFFICIAL_PROVIDER;
    const defaultModel = typeof selection.model === "string" ? selection.model : DEFAULT_MODELS[0].id;
    const runtimeById = new Map(runtime.providers.map(provider => [provider.provider, provider]));
    const groupById = new Map(runtime.groups.map(group => [group.id, group]));
    const deepseek = asObject(root["llm-deepseek"]);
    const officialRef = typeof deepseek.apiKeyEnv === "string" ? deepseek.apiKeyEnv : OFFICIAL_CREDENTIAL;
    const officialGroup = groupById.get(OFFICIAL_PROVIDER);
    const officialMeta = deskState.providers[OFFICIAL_PROVIDER] ?? {};
    const providers: DshProvider[] = [{
      ...officialMeta,
      id: OFFICIAL_PROVIDER,
      name: "DeepSeek",
      baseUrl: typeof deepseek.baseURL === "string" ? deepseek.baseURL : OFFICIAL_BASE_URL,
      protocol: "deepseek-chat-completions",
      models: Array.isArray(deepseek.models) ? modelList(deepseek.models) : officialGroup?.models ?? DEFAULT_MODELS,
      modelsInherited: !Array.isArray(deepseek.models),
      catalogProvider: true,
      runtimeActive: runtimeById.get(OFFICIAL_PROVIDER)?.active ?? true,
      credentialRef: officialRef,
      hasCredential: !!(process.env[officialRef] || credentials.get(officialRef)),
      isOfficial: true,
      isDefault: defaultProvider === OFFICIAL_PROVIDER,
      ...(defaultProvider === OFFICIAL_PROVIDER ? { defaultModel } : {})
    }];
    const piProviders = asObject(asObject(root["llm-pi-ai"]).providers);
    for (const [id, value] of Object.entries(piProviders)) {
      if (!isObject(value)) continue;
      providers.push(providerFromProfile(
        id,
        value,
        credentials,
        defaultProvider,
        defaultModel,
        deskState.providers[id] ?? {},
        runtimeById.get(id),
        groupById.get(id)
      ));
    }
    const order = new Map(deskState.order.map((id, index) => [id, index]));
    providers.sort((left, right) => {
      const leftOrder = order.get(left.id);
      const rightOrder = order.get(right.id);
      if (leftOrder !== undefined || rightOrder !== undefined) return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      return Number(right.isOfficial) - Number(left.isOfficial) || (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.name.localeCompare(right.name);
    });
    const catalogProviders: DshCatalogProvider[] = runtime.providers
      .filter(provider => provider.provider !== OFFICIAL_PROVIDER && provider.declared !== true)
      .map(provider => ({
        id: provider.provider,
        name: provider.displayName,
        active: provider.active,
        ...(provider.declared !== undefined ? { declared: provider.declared } : {})
      }));
    return {
      ok: true,
      providers,
      catalogProviders,
      runtimeAvailable: runtime.available,
      defaultProvider,
      defaultModel,
      settingsPath: settingsFile,
      credentialsPath: credentialsFile
    };
  } catch (error) {
    return {
      ok: false,
      providers: [],
      catalogProviders: [],
      runtimeAvailable: false,
      defaultProvider: OFFICIAL_PROVIDER,
      defaultModel: DEFAULT_MODELS[0].id,
      error: errorMessage(error)
    };
  }
}

function normalizeOptionalUrl(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Provider endpoint must be a valid HTTP(S) URL");
  }
}

function normalizeSaveInput(input: DshProviderSaveInput) {
  const id = input.id?.trim() || `route-${randomUUID()}`;
  const name = input.name.trim();
  if (!name) throw new Error("Provider name is required");
  const catalogProvider = input.catalogProvider === true && id !== OFFICIAL_PROVIDER;
  const baseUrl = catalogProvider ? "" : normalizeOptionalUrl(input.baseUrl);
  const protocol = catalogProvider ? undefined : input.protocol;
  if (id === OFFICIAL_PROVIDER && protocol !== undefined && protocol !== "deepseek-chat-completions") {
    throw new Error("The official route uses the DeepSeek Chat Completions adapter");
  }
  if (id !== OFFICIAL_PROVIDER && protocol !== undefined && !DSH_PROVIDER_PROTOCOLS.includes(protocol as DshProviderProtocol)) {
    throw new Error("Unsupported DeepSeek Harness provider protocol");
  }
  const models = catalogProvider ? [] : modelList(input.models);
  if (new Set(models.map(model => model.id)).size !== models.length) throw new Error("Model IDs must be unique");
  const apiKey = input.apiKey?.trim();
  if (apiKey && (!/^[\x21-\x7E]+$/.test(apiKey) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(apiKey))) {
    throw new Error("API key must be a printable value, not an environment assignment");
  }
  const meta: DshProviderUiMeta = {
    ...(input.websiteUrl?.trim() ? { websiteUrl: input.websiteUrl.trim() } : {}),
    ...(input.apiKeyUrl?.trim() ? { apiKeyUrl: input.apiKeyUrl.trim() } : {}),
    ...(input.category?.trim() ? { category: input.category.trim() } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}),
    ...(input.iconColor?.trim() ? { iconColor: input.iconColor.trim() } : {}),
    ...(typeof input.createdAt === "number" ? { createdAt: input.createdAt } : {}),
    ...(typeof input.sortIndex === "number" ? { sortIndex: input.sortIndex } : {}),
    ...(input.preferredModel?.trim() ? { preferredModel: input.preferredModel.trim() } : {})
  };
  return {
    id,
    name,
    baseUrl,
    protocol,
    models,
    inheritModels: catalogProvider || input.inheritModels === true || input.models === undefined,
    apiKey,
    meta
  };
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
  await mutateYaml(credentialsPath(options), document => document.setIn([ref], value), true);
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
    await mutateYaml(settingsFile, document => {
      const currentRoot = asObject(document.toJS());
      if (normalized.id === OFFICIAL_PROVIDER) {
        const current = asObject(currentRoot["llm-deepseek"]);
        const next: JsonObject = {
          ...current,
          apiKeyEnv: credentialRef,
          ...(normalized.baseUrl ? { baseURL: normalized.baseUrl } : {})
        };
        if (normalized.inheritModels) delete next.models;
        else next.models = serializeModels(normalized.models);
        document.setIn(["llm-deepseek"], next);
        return;
      }
      const current = asObject(asObject(asObject(currentRoot["llm-pi-ai"]).providers)[normalized.id]);
      const next: JsonObject = {
        ...current,
        displayName: normalized.name,
        ...(credentialRef ? { apiKeyEnv: credentialRef } : {})
      };
      if (normalized.protocol) next.api = normalized.protocol;
      else delete next.api;
      if (normalized.baseUrl) next.baseURL = normalized.baseUrl;
      else delete next.baseURL;
      if (normalized.inheritModels) delete next.models;
      else next.models = serializeModels(normalized.models);
      document.setIn(["llm-pi-ai", "providers", normalized.id], next);
    });
    if (normalized.apiKey && credentialRef) await setCredential(credentialRef, normalized.apiKey, options);
    await mutateDeskState(options, state => {
      const existingMeta = state.providers[normalized.id] ?? {};
      state.providers[normalized.id] = {
        ...existingMeta,
        ...normalized.meta,
        createdAt: normalized.meta.createdAt ?? existingMeta.createdAt ?? Date.now()
      };
      if (!state.order.includes(normalized.id)) state.order.push(normalized.id);
    });
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === normalized.id);
    return provider ? { ok: true, provider } : { ok: false, error: listing.error ?? "Provider was saved but could not be reloaded" };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteDshProvider(id: string, options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  try {
    if (id === OFFICIAL_PROVIDER) throw new Error("The official DeepSeek provider cannot be deleted");
    const listing = await listDshProviders(options);
    const target = listing.providers.find(provider => provider.id === id);
    if (!target) throw new Error("Provider not found");
    await mutateYaml(settingsPath(options), document => {
      document.deleteIn(["llm-pi-ai", "providers", id]);
      if (listing.defaultProvider === id) {
        document.setIn(["agent-default-model"], { provider: OFFICIAL_PROVIDER, model: DEFAULT_MODELS[0].id });
      }
    });
    const ownedRef = target.credentialRef === deriveDshCredentialRef(id) ? target.credentialRef : undefined;
    if (ownedRef) await mutateYaml(credentialsPath(options), document => document.deleteIn([ownedRef]), true);
    await mutateDeskState(options, state => {
      delete state.providers[id];
      state.order = state.order.filter(providerId => providerId !== id);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function copyId(id: string, occupied: Set<string>) {
  const stem = `${id.replace(/-copy(?:-\d+)?$/, "")}-copy`.slice(0, 64);
  if (!occupied.has(stem)) return stem;
  for (let index = 2; index < 10_000; index++) {
    const suffix = `-${index}`;
    const candidate = `${stem.slice(0, 64 - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate a provider copy ID");
}

export async function duplicateDshProvider(id: string, options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  try {
    if (id === OFFICIAL_PROVIDER) throw new Error("The official DeepSeek provider is already available through its native route");
    const filePath = settingsPath(options);
    const { root } = parseYaml(await readOptional(filePath), filePath);
    const providers = asObject(asObject(root["llm-pi-ai"]).providers);
    const source = asObject(providers[id]);
    if (Object.keys(source).length === 0) throw new Error("Provider not found");
    const nextId = copyId(id, new Set(Object.keys(providers)));
    const sourceName = typeof source.displayName === "string" && source.displayName ? source.displayName : id;
    await mutateYaml(filePath, document => {
      document.setIn(["llm-pi-ai", "providers", nextId], { ...source, displayName: `${sourceName} Copy` });
    });
    await mutateDeskState(options, state => {
      const sourceMeta = state.providers[id] ?? {};
      state.providers[nextId] = { ...sourceMeta, createdAt: Date.now() };
      const sourceIndex = state.order.indexOf(id);
      state.order.splice(sourceIndex >= 0 ? sourceIndex + 1 : state.order.length, 0, nextId);
    });
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === nextId);
    return provider ? { ok: true, provider } : { ok: false, error: listing.error ?? "Provider was copied but could not be reloaded" };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function reorderDshProviders(ids: string[], options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  try {
    const listing = await listDshProviders(options);
    const known = new Set(listing.providers.map(provider => provider.id));
    const unique = ids.filter((id, index) => known.has(id) && ids.indexOf(id) === index);
    for (const provider of listing.providers) if (!unique.includes(provider.id)) unique.push(provider.id);
    await mutateDeskState(options, state => {
      state.order = unique;
      unique.forEach((id, sortIndex) => {
        state.providers[id] = { ...(state.providers[id] ?? {}), sortIndex };
      });
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function switchDshProvider(id: string, model?: string, options?: DshProviderStoreOptions): Promise<DshProviderSwitchResult> {
  try {
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === id);
    if (!provider) throw new Error("Provider not found");
    const selectedModel = model?.trim() || provider.preferredModel || provider.defaultModel || provider.models[0]?.id || listing.defaultModel;
    if (!selectedModel) throw new Error("No model is selected. Enter a model ID or choose one from the DSH catalog first");
    await mutateYaml(settingsPath(options), document => {
      document.setIn(["agent-default-model"], { provider: id, model: selectedModel });
    });
    await mutateDeskState(options, state => {
      state.providers[id] = { ...(state.providers[id] ?? {}), preferredModel: selectedModel };
    });
    return { ok: true, provider: id, model: selectedModel };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function discoveredModels(body: unknown): DshProviderModel[] {
  if (!isObject(body) || !Array.isArray(body.data)) throw new Error("Provider returned an invalid model catalog");
  return body.data.flatMap(item => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    const name = typeof item.display_name === "string" ? item.display_name : typeof item.name === "string" ? item.name : undefined;
    const contextWindow = positiveInteger(item.context_window) ?? positiveInteger(item.context_length);
    const maxTokens = positiveInteger(item.max_output_tokens) ?? positiveInteger(item.max_tokens);
    return [{
      id: item.id.trim(),
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {})
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function runtimeDiscoverModels(payload: DshProviderProbeInput, options?: DshProviderStoreOptions) {
  const request: JsonObject = {
    settingsNs: payload.id === OFFICIAL_PROVIDER ? "llm-deepseek" : "llm-pi-ai",
    ...(payload.id ? { provider: payload.id } : {}),
    ...(payload.baseUrl?.trim() ? { baseURL: payload.baseUrl.trim() } : {}),
    ...(payload.protocol && payload.protocol !== "deepseek-chat-completions" ? { api: payload.protocol } : {}),
    ...(payload.apiKey?.trim() ? { apiKey: payload.apiKey.trim() } : {})
  };
  const value = await runtimeRpc("llm.discoverModels", request, options);
  return modelList(value.models);
}

async function resolvedProbe(payload: DshProviderProbeInput, options?: DshProviderStoreOptions) {
  let baseUrl = payload.baseUrl?.trim() ?? "";
  let protocol = payload.protocol;
  let apiKey = payload.apiKey?.trim() ?? "";
  if (payload.id) {
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === payload.id);
    if (!provider) throw new Error("Provider not found");
    baseUrl ||= provider.baseUrl;
    protocol ||= provider.protocol;
    if (!apiKey && provider.credentialRef) {
      apiKey = process.env[provider.credentialRef] ?? "";
      if (!apiKey) {
        const filePath = credentialsPath(options);
        const { root } = parseYaml(await readOptional(filePath), filePath, true);
        apiKey = credentialMap(root, filePath).get(provider.credentialRef) ?? "";
      }
    }
  }
  return { baseUrl, protocol, apiKey };
}

export async function probeDshProvider(payload: DshProviderProbeInput, options?: DshProviderStoreOptions): Promise<DshProviderProbeResult> {
  const startedAt = Date.now();
  try {
    if ((payload.mode ?? "models") === "models" && runtimeEnabled(options)) {
      try {
        const models = await runtimeDiscoverModels(payload, options);
        return { ok: true, latencyMs: Date.now() - startedAt, models };
      } catch {
        // The npx web runtime is optional; direct endpoint discovery remains available.
      }
    }
    const resolved = await resolvedProbe(payload, options);
    if (!resolved.baseUrl) throw new Error("Provider endpoint is required when the DSH catalog is unavailable");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      if ((payload.mode ?? "models") === "connectivity") {
        const response = await (options?.fetchImpl ?? fetch)(resolved.baseUrl, {
          method: "GET",
          headers: {
            accept: "*/*",
            "accept-encoding": "identity",
            ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {})
          },
          signal: controller.signal
        });
        return { ok: true, latencyMs: Date.now() - startedAt, status: response.status };
      }
      if (resolved.protocol === "anthropic-messages") {
        throw new Error("Anthropic Messages providers do not expose the OpenAI /models endpoint");
      }
      const response = await (options?.fetchImpl ?? fetch)(`${resolved.baseUrl.replace(/\/+$/, "")}/models`, {
        headers: resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : undefined,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        status: response.status,
        models: discoveredModels(await response.json())
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: errorMessage(error) };
  }
}

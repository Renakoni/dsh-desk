import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Document, parseDocument } from "yaml";
import {
  DSH_PROVIDER_PROTOCOLS,
  DSH_REASONING_EFFORTS,
  type DshCatalogProvider,
  type DshProvider,
  type DshProviderListResult,
  type DshProviderModel,
  type DshProviderMutationResult,
  type DshProviderProbeInput,
  type DshProviderProbeResult,
  type DshProviderProtocol,
  type DshReasoningEffort,
  type DshProviderSaveInput,
  type DshProviderSwitchResult,
  type DshProviderUiMeta
} from "../shared/dshProviders";
import { resolveDshHome } from "./dshPaths";

const OFFICIAL_PROVIDER = "deepseek-official";
const OFFICIAL_BASE_URL = "https://api.deepseek.com";
const OFFICIAL_CREDENTIAL = "DEEPSEEK_API_KEY";
const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3080";
const DSH_DESK_STATE_FILE = ".dsh-desk-providers.json";
const DSH_HOME_PATCH_FILE = "cordis.patch.yml";
const OFFICIAL_PLUGIN_ROW = "llm-deepseek";
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

type DshStoredProvider = {
  profile: JsonObject;
  catalogProvider?: boolean;
};

type DshDeskState = {
  version: 2;
  order: string[];
  providers: Record<string, DshProviderUiMeta>;
  disabledProviders: Record<string, DshStoredProvider>;
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
  return resolveDshHome(options?.dshHome);
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

function homePatchPath(options?: DshProviderStoreOptions) {
  return join(dshHome(options), DSH_HOME_PATCH_FILE);
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function hasOwn(object: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(object, key);
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

function parsePatchYaml(text: string | undefined, filePath: string) {
  const document = text === undefined ? new Document([]) : parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`DeepSeek Harness patch file is invalid at ${filePath}: ${document.errors[0]?.code ?? "YAML_ERROR"}`);
  }
  const root = document.toJS() ?? [];
  if (!Array.isArray(root)) throw new Error(`DeepSeek Harness patch root must be a sequence at ${filePath}`);
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

async function mutatePatchYaml(filePath: string, mutate: (document: ReturnType<typeof parseDocument>, rows: unknown[]) => void) {
  await withFileLock(filePath, async () => {
    const { document, root } = parsePatchYaml(await readOptional(filePath), filePath);
    mutate(document as ReturnType<typeof parseDocument>, root);
    await writeAtomic(filePath, document.toString());
  });
}

function officialProviderEnabled(patchRows: unknown[]) {
  let disabled: boolean | undefined;
  for (const row of patchRows) {
    if (!isObject(row) || row.id !== OFFICIAL_PLUGIN_ROW || typeof row.disabled !== "boolean") continue;
    disabled = row.disabled;
  }
  return disabled !== true;
}

function setOfficialProviderPatch(document: ReturnType<typeof parseDocument>, rows: unknown[], enabled: boolean) {
  let targetIndex = -1;
  rows.forEach((row, index) => {
    if (isObject(row) && row.id === OFFICIAL_PLUGIN_ROW) targetIndex = index;
  });
  if (targetIndex >= 0) document.setIn([targetIndex, "disabled"], !enabled);
  else document.add({ id: OFFICIAL_PLUGIN_ROW, disabled: !enabled });
}

function emptyDeskState(): DshDeskState {
  return { version: 2, order: [], providers: {}, disabledProviders: {} };
}

async function readDeskState(options?: DshProviderStoreOptions): Promise<DshDeskState> {
  const text = await readOptional(deskStatePath(options));
  if (!text) return emptyDeskState();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) return emptyDeskState();
    const order = Array.isArray(parsed.order) ? parsed.order.filter((value): value is string => typeof value === "string") : [];
    const providers = isObject(parsed.providers) ? parsed.providers as Record<string, DshProviderUiMeta> : {};
    const disabledProviders: Record<string, DshStoredProvider> = {};
    if (isObject(parsed.disabledProviders)) {
      for (const [id, stored] of Object.entries(parsed.disabledProviders)) {
        if (!isObject(stored) || !isObject(stored.profile)) continue;
        disabledProviders[id] = {
          profile: stored.profile,
          ...(stored.catalogProvider === true ? { catalogProvider: true } : {})
        };
      }
    }
    return { version: 2, order, providers, disabledProviders };
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
    const configuredEfforts = item.reasoningEfforts;
    const reasoningEfforts = configuredEfforts === false
      ? false
      : isObject(configuredEfforts)
        ? Object.fromEntries(DSH_REASONING_EFFORTS.flatMap(effort => {
          const wireValue = configuredEfforts[effort];
          return typeof wireValue === "string" || (effort === "off" && wireValue === null)
            ? [[effort, wireValue]]
            : [];
        }))
        : undefined;
    const runtimeReasoningValue = isObject(item.reasoning) ? item.reasoning : undefined;
    const runtimeEfforts = Array.isArray(runtimeReasoningValue?.efforts)
      ? runtimeReasoningValue.efforts.flatMap(effort => isObject(effort)
        && typeof effort.id === "string"
        && effort.id
        ? [{
            id: effort.id,
            name: typeof effort.name === "string" && effort.name ? effort.name : effort.id
          }]
        : [])
      : [];
    const reasoning = runtimeEfforts.length > 0
      ? {
          efforts: runtimeEfforts,
          ...(typeof runtimeReasoningValue?.defaultEffort === "string"
            ? { defaultEffort: runtimeReasoningValue.defaultEffort }
            : {})
        }
      : undefined;
    models.push({
      id: item.id.trim(),
      ...(typeof item.name === "string" && item.name.trim() ? { name: item.name.trim() } : {}),
      ...(typeof item.contextWindow === "number" && Number.isSafeInteger(item.contextWindow) && item.contextWindow > 0 ? { contextWindow: item.contextWindow } : {}),
      ...(typeof item.maxTokens === "number" && Number.isSafeInteger(item.maxTokens) && item.maxTokens > 0 ? { maxTokens: item.maxTokens } : {}),
      ...(reasoningEfforts === false || (reasoningEfforts && Object.keys(reasoningEfforts).length > 0) ? { reasoningEfforts } : {}),
      ...(reasoning ? { reasoning } : {})
    });
  }
  return models;
}

function configuredReasoningEffort(value: unknown): DshReasoningEffort | undefined {
  return typeof value === "string" && DSH_REASONING_EFFORTS.includes(value as DshReasoningEffort)
    ? value as DshReasoningEffort
    : undefined;
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

async function runtimeRpc(
  method: string,
  payload: JsonObject,
  options?: DshProviderStoreOptions,
  timeoutMs = 3_000
): Promise<JsonObject> {
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
    signal: AbortSignal.timeout(timeoutMs)
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

type DshModelSelection = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

function selectionMatches(value: unknown, expected: DshModelSelection, requireReasoningEffortCleared: boolean) {
  const selected = asObject(asObject(value).selected);
  const actualReasoningEffort = typeof selected.reasoningEffort === "string"
    ? selected.reasoningEffort
    : undefined;
  const reasoningEffortMatches = expected.reasoningEffort !== undefined
    ? actualReasoningEffort === expected.reasoningEffort
    : !requireReasoningEffortCleared || actualReasoningEffort === undefined;
  return selected.provider === expected.provider
    && selected.model === expected.model
    && reasoningEffortMatches;
}

async function selectBlankSessionModel(
  sessionId: string,
  selection: DshModelSelection,
  options?: DshProviderStoreOptions,
  requireReasoningEffortCleared = false
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const value = await runtimeRpc("session.selectModel", {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {})
      }, options, 500);
      if (selectionMatches(value, selection, requireReasoningEffortCleared)) return true;
    } catch {
      // DSH may still be reloading the provider patch after Desk wrote it.
    }
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

async function syncBlankSessionModels(
  selection: DshModelSelection,
  options?: DshProviderStoreOptions,
  requireReasoningEffortCleared = false
) {
  try {
    const value = await runtimeRpc("session.list", {}, options);
    const sessions = Array.isArray(value.items) ? value.items : [];
    const blankSessionIds = sessions.flatMap(item => isObject(item)
      && item.blank === true
      && typeof item.sessionId === "string"
      ? [item.sessionId]
      : []);
    const results = await Promise.all(blankSessionIds.map(sessionId => selectBlankSessionModel(
      sessionId,
      selection,
      options,
      requireReasoningEffortCleared
    )));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

async function readDefaultSelection(options?: DshProviderStoreOptions): Promise<DshModelSelection> {
  const { root } = await readOptional(settingsPath(options)).then(text => parseYaml(text, settingsPath(options)));
  const selection = asObject(root["agent-default-model"]);
  const reasoningEffort = typeof selection.reasoningEffort === "string" && selection.reasoningEffort.trim()
    ? selection.reasoningEffort
    : undefined;
  return {
    provider: typeof selection.provider === "string" ? selection.provider : OFFICIAL_PROVIDER,
    model: typeof selection.model === "string" ? selection.model : DEFAULT_MODELS[0].id,
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

async function syncSavedDefaultSelection(options?: DshProviderStoreOptions) {
  const selection = await readDefaultSelection(options);
  return syncBlankSessionModels(selection, options, selection.provider !== OFFICIAL_PROVIDER);
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
  enabled: boolean,
  runtime?: RuntimeProvider,
  runtimeGroup?: RuntimeModelGroup,
  catalogProviderHint = false
): DshProvider {
  const protocol = typeof profile.api === "string" && DSH_PROVIDER_PROTOCOLS.includes(profile.api as DshProviderProtocol)
    ? profile.api as DshProviderProtocol
    : undefined;
  const credentialRef = typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : undefined;
  const apiKey = credentialRef ? process.env[credentialRef] || credentials.get(credentialRef) : undefined;
  const modelsInherited = !Array.isArray(profile.models);
  const configuredModels = modelList(profile.models);
  const reasoningDefault = configuredReasoningEffort(profile.reasoning);
  return {
    ...meta,
    id,
    name: typeof profile.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : runtime?.displayName ?? id,
    baseUrl: typeof profile.baseURL === "string" ? profile.baseURL : "",
    ...(protocol ? { protocol } : {}),
    models: modelsInherited && runtimeGroup ? runtimeGroup.models : configuredModels,
    modelsInherited,
    catalogProvider: catalogProviderHint || runtime?.declared === false,
    enabled,
    runtimeActive: enabled && (runtime?.active ?? false),
    ...(credentialRef ? { credentialRef } : {}),
    ...(apiKey ? { apiKey } : {}),
    hasCredential: !!apiKey,
    isOfficial: false,
    isDefault: defaultProvider === id,
    ...(defaultProvider === id ? { defaultModel } : {}),
    ...(reasoningDefault ? { reasoningDefault } : {})
  };
}

export async function listDshProviders(options?: DshProviderStoreOptions): Promise<DshProviderListResult> {
  const settingsFile = settingsPath(options);
  const credentialsFile = credentialsPath(options);
  const patchFile = homePatchPath(options);
  try {
    const [{ root }, credentialDocument, patchDocument, deskState, runtime] = await Promise.all([
      readOptional(settingsFile).then(text => parseYaml(text, settingsFile)),
      readOptional(credentialsFile).then(text => parseYaml(text, credentialsFile, true)),
      readOptional(patchFile).then(text => parsePatchYaml(text, patchFile)),
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
    const officialApiKey = process.env[officialRef] || credentials.get(officialRef);
    const officialGroup = groupById.get(OFFICIAL_PROVIDER);
    const officialModels = Array.isArray(deepseek.models)
      ? modelList(deepseek.models)
      : officialGroup?.models ?? DEFAULT_MODELS;
    const officialReasoningDefault = configuredReasoningEffort(deepseek.reasoningEffort);
    const officialMeta = deskState.providers[OFFICIAL_PROVIDER] ?? {};
    const officialEnabled = officialProviderEnabled(patchDocument.root);
    const providers: DshProvider[] = [{
      ...officialMeta,
      id: OFFICIAL_PROVIDER,
      name: "DeepSeek",
      baseUrl: typeof deepseek.baseURL === "string" ? deepseek.baseURL : OFFICIAL_BASE_URL,
      protocol: "deepseek-chat-completions",
      models: officialModels,
      modelsInherited: !Array.isArray(deepseek.models),
      catalogProvider: true,
      enabled: officialEnabled,
      runtimeActive: officialEnabled && (runtimeById.get(OFFICIAL_PROVIDER)?.active ?? true),
      credentialRef: officialRef,
      ...(officialApiKey ? { apiKey: officialApiKey } : {}),
      hasCredential: !!officialApiKey,
      isOfficial: true,
      icon: "deepseek",
      iconColor: "#4D6BFE",
      isDefault: defaultProvider === OFFICIAL_PROVIDER,
      ...(officialReasoningDefault ? { reasoningDefault: officialReasoningDefault } : {}),
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
        true,
        runtimeById.get(id),
        groupById.get(id)
      ));
    }
    for (const [id, stored] of Object.entries(deskState.disabledProviders)) {
      if (id in piProviders) continue;
      providers.push(providerFromProfile(
        id,
        stored.profile,
        credentials,
        defaultProvider,
        defaultModel,
        deskState.providers[id] ?? {},
        false,
        runtimeById.get(id),
        groupById.get(id),
        stored.catalogProvider === true
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
  const models = modelList(input.models);
  if (new Set(models.map(model => model.id)).size !== models.length) throw new Error("Model IDs must be unique");
  const inheritModels = input.inheritModels === true || input.models === undefined;
  const reasoningDefault = id !== OFFICIAL_PROVIDER && !catalogProvider && !inheritModels && input.reasoningDefault
    ? "medium"
    : input.reasoningDefault;
  const apiKey = input.apiKey?.trim();
  if (apiKey && (!/^[\x21-\x7E]+$/.test(apiKey) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(apiKey))) {
    throw new Error("API key must be a printable value, not an environment assignment");
  }
  const meta: DshProviderUiMeta = {};
  if (hasOwn(input, "websiteUrl")) meta.websiteUrl = input.websiteUrl?.trim() || undefined;
  if (hasOwn(input, "apiKeyUrl")) meta.apiKeyUrl = input.apiKeyUrl?.trim() || undefined;
  if (hasOwn(input, "category")) meta.category = input.category?.trim() || undefined;
  if (hasOwn(input, "notes")) meta.notes = input.notes?.trim() || undefined;
  if (hasOwn(input, "icon")) meta.icon = input.icon?.trim() || undefined;
  if (hasOwn(input, "iconColor")) meta.iconColor = input.iconColor?.trim() || undefined;
  if (typeof input.createdAt === "number") meta.createdAt = input.createdAt;
  if (typeof input.sortIndex === "number") meta.sortIndex = input.sortIndex;
  return {
    id,
    name,
    baseUrl,
    protocol,
    models,
    inheritModels,
    catalogProvider,
    enabled: input.enabled !== false,
    reasoningDefault,
    apiKey,
    meta
  };
}

function serializeModels(models: DshProviderModel[]) {
  return models.map(model => {
    const reasoningEfforts = model.reasoningEfforts;
    return {
      id: model.id,
      ...(model.name ? { name: model.name } : {}),
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      ...(reasoningEfforts === undefined
        ? {}
        : { reasoningEfforts: reasoningEfforts === false ? false : { ...reasoningEfforts } })
    };
  });
}

function piProviderProfile(
  current: JsonObject,
  normalized: ReturnType<typeof normalizeSaveInput>,
  credentialRef: string | undefined
) {
  const next: JsonObject = {
    ...current,
    displayName: normalized.name,
    ...(credentialRef ? { apiKeyEnv: credentialRef } : {})
  };
  if (!credentialRef) delete next.apiKeyEnv;
  if (normalized.protocol) next.api = normalized.protocol;
  else delete next.api;
  if (normalized.baseUrl) next.baseURL = normalized.baseUrl;
  else delete next.baseURL;
  if (normalized.reasoningDefault) next.reasoning = normalized.reasoningDefault;
  else delete next.reasoning;
  if (normalized.inheritModels) delete next.models;
  else next.models = serializeModels(normalized.models);
  return next;
}

function updateDeskProviderMeta(state: DshDeskState, id: string, meta: DshProviderUiMeta) {
  const existingMeta = state.providers[id] ?? {};
  state.providers[id] = {
    ...existingMeta,
    ...meta,
    createdAt: meta.createdAt ?? existingMeta.createdAt ?? Date.now()
  };
  if (!state.order.includes(id)) state.order.push(id);
}

function providerSelection(provider: DshProvider): DshModelSelection | undefined {
  const model = provider.models[0]?.id;
  if (!model) return undefined;
  const configuredEfforts = provider.models[0]?.reasoningEfforts;
  const reasoningEffort = provider.reasoningDefault
    && configuredEfforts
    && hasOwn(configuredEfforts, provider.reasoningDefault)
    ? provider.reasoningDefault
    : undefined;
  return {
    provider: provider.id,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

function fallbackSelection(providers: DshProvider[], excludingId: string) {
  for (const provider of providers) {
    if (provider.id === excludingId || !provider.enabled) continue;
    const selection = providerSelection(provider);
    if (selection) return selection;
  }
  return undefined;
}

async function setCredential(ref: string, value: string, options?: DshProviderStoreOptions) {
  await mutateYaml(credentialsPath(options), document => document.setIn([ref], value), true);
}

export async function saveDshProvider(input: DshProviderSaveInput, options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  try {
    const normalized = normalizeSaveInput(input);
    const settingsFile = settingsPath(options);
    const [{ root }, deskState] = await Promise.all([
      readOptional(settingsFile).then(text => parseYaml(text, settingsFile)),
      readDeskState(options)
    ]);
    const configured = asObject(asObject(asObject(root["llm-pi-ai"]).providers)[normalized.id]);
    const disabled = deskState.disabledProviders[normalized.id];
    const existing = normalized.id === OFFICIAL_PROVIDER
      ? asObject(root["llm-deepseek"])
      : Object.keys(configured).length > 0 ? configured : disabled?.profile ?? {};
    const configuredDefaultProvider = asObject(root["agent-default-model"]).provider;
    const defaultProvider = typeof configuredDefaultProvider === "string" ? configuredDefaultProvider : OFFICIAL_PROVIDER;
    const existingRef = typeof existing.apiKeyEnv === "string" && existing.apiKeyEnv ? existing.apiKeyEnv : undefined;
    const credentialRef = existingRef
      ?? (normalized.id === OFFICIAL_PROVIDER ? OFFICIAL_CREDENTIAL : normalized.apiKey ? deriveDshCredentialRef(normalized.id) : undefined);
    if (normalized.apiKey && credentialRef) await setCredential(credentialRef, normalized.apiKey, options);
    if (normalized.id === OFFICIAL_PROVIDER) {
      await mutateYaml(settingsFile, document => {
        const currentRoot = asObject(document.toJS());
        const current = asObject(currentRoot["llm-deepseek"]);
        const next: JsonObject = {
          ...current,
          apiKeyEnv: credentialRef,
          ...(normalized.baseUrl ? { baseURL: normalized.baseUrl } : {})
        };
        if (normalized.inheritModels) delete next.models;
        else next.models = serializeModels(normalized.models);
        document.setIn(["llm-deepseek"], next);
      });
      await mutateDeskState(options, state => {
        updateDeskProviderMeta(state, normalized.id, normalized.meta);
        delete state.disabledProviders[normalized.id];
      });
    } else {
      const next = piProviderProfile(existing, normalized, credentialRef);
      const catalogProvider = normalized.catalogProvider || disabled?.catalogProvider === true;
      if (normalized.enabled) {
        await mutateYaml(settingsFile, document => {
          document.setIn(["llm-pi-ai", "providers", normalized.id], next);
          if (normalized.catalogProvider || normalized.inheritModels) return;
          const selection = asObject(asObject(document.toJS())["agent-default-model"]);
          if (selection.provider !== normalized.id) return;
          if (!normalized.reasoningDefault) {
            document.deleteIn(["agent-default-model", "reasoningEffort"]);
            return;
          }
          if (typeof selection.reasoningEffort !== "string" || !selection.reasoningEffort.trim()) {
            document.setIn(["agent-default-model", "reasoningEffort"], "medium");
          }
        });
        await mutateDeskState(options, state => {
          updateDeskProviderMeta(state, normalized.id, normalized.meta);
          delete state.disabledProviders[normalized.id];
        });
      } else {
        await mutateDeskState(options, state => {
          updateDeskProviderMeta(state, normalized.id, normalized.meta);
          state.disabledProviders[normalized.id] = {
            profile: next,
            ...(catalogProvider ? { catalogProvider: true } : {})
          };
        });
        await mutateYaml(settingsFile, document => {
          document.deleteIn(["llm-pi-ai", "providers", normalized.id]);
          const selection = asObject(asObject(document.toJS())["agent-default-model"]);
          if (selection.provider === normalized.id) {
            document.setIn(["agent-default-model"], { provider: OFFICIAL_PROVIDER, model: DEFAULT_MODELS[0].id });
          }
        });
      }
    }
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === normalized.id);
    if (!provider) return { ok: false, error: listing.error ?? "Provider was saved but could not be reloaded" };
    const sessionSyncFailed = defaultProvider === normalized.id && listing.runtimeAvailable
      ? !await syncSavedDefaultSelection(options)
      : false;
    return { ok: true, provider, ...(sessionSyncFailed ? { sessionSyncFailed: true } : {}) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function setDshProviderEnabled(id: string, enabled: boolean, options?: DshProviderStoreOptions): Promise<DshProviderMutationResult> {
  try {
    const listing = await listDshProviders(options);
    const target = listing.providers.find(provider => provider.id === id);
    if (!target) throw new Error("Provider not found");
    if (target.enabled === enabled) return { ok: true, provider: target };
    const fallback = !enabled && listing.defaultProvider === id
      ? fallbackSelection(listing.providers, id)
      : undefined;
    if (!enabled && listing.defaultProvider === id && !fallback) {
      throw new Error("Cannot disable the default provider because no other enabled provider has a usable model");
    }
    const settingsFile = settingsPath(options);
    if (id === OFFICIAL_PROVIDER) {
      if (fallback) await mutateYaml(settingsFile, document => document.setIn(["agent-default-model"], fallback));
      await mutatePatchYaml(homePatchPath(options), (document, rows) => {
        setOfficialProviderPatch(document, rows, enabled);
      });
      const updated = await listDshProviders(options);
      const provider = updated.providers.find(item => item.id === id);
      if (!provider) return { ok: false, error: "Provider state changed but could not be reloaded" };
      const sessionSyncFailed = fallback && updated.runtimeAvailable
        ? !await syncBlankSessionModels(fallback, options)
        : false;
      return { ok: true, provider, ...(sessionSyncFailed ? { sessionSyncFailed: true } : {}) };
    }
    const [{ root }, deskState] = await Promise.all([
      readOptional(settingsFile).then(text => parseYaml(text, settingsFile)),
      readDeskState(options)
    ]);
    if (enabled) {
      const stored = deskState.disabledProviders[id];
      if (!stored) throw new Error("Disabled provider profile not found");
      await mutateYaml(settingsFile, document => document.setIn(["llm-pi-ai", "providers", id], stored.profile));
      await mutateDeskState(options, state => { delete state.disabledProviders[id]; });
    } else {
      const profile = asObject(asObject(asObject(root["llm-pi-ai"]).providers)[id]);
      if (Object.keys(profile).length === 0) throw new Error("Configured provider profile not found");
      await mutateDeskState(options, state => {
        state.disabledProviders[id] = {
          profile,
          ...(target.catalogProvider ? { catalogProvider: true } : {})
        };
      });
      await mutateYaml(settingsFile, document => {
        document.deleteIn(["llm-pi-ai", "providers", id]);
        if (fallback) document.setIn(["agent-default-model"], fallback);
      });
    }
    const updated = await listDshProviders(options);
    const provider = updated.providers.find(item => item.id === id);
    if (!provider) return { ok: false, error: "Provider state changed but could not be reloaded" };
    const sessionSyncFailed = fallback && updated.runtimeAvailable
      ? !await syncBlankSessionModels(fallback, options)
      : false;
    return { ok: true, provider, ...(sessionSyncFailed ? { sessionSyncFailed: true } : {}) };
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
    const fallback = listing.defaultProvider === id ? fallbackSelection(listing.providers, id) : undefined;
    if (listing.defaultProvider === id && !fallback) {
      throw new Error("Cannot delete the default provider because no other enabled provider has a usable model");
    }
    await mutateYaml(settingsPath(options), document => {
      document.deleteIn(["llm-pi-ai", "providers", id]);
      if (fallback) document.setIn(["agent-default-model"], fallback);
    });
    const ownedRef = target.credentialRef === deriveDshCredentialRef(id) ? target.credentialRef : undefined;
    const credentialStillUsed = ownedRef
      ? listing.providers.some(provider => provider.id !== id && provider.credentialRef === ownedRef)
      : false;
    if (ownedRef && !credentialStillUsed) {
      await mutateYaml(credentialsPath(options), document => document.deleteIn([ownedRef]), true);
    }
    await mutateDeskState(options, state => {
      delete state.providers[id];
      delete state.disabledProviders[id];
      state.order = state.order.filter(providerId => providerId !== id);
    });
    const sessionSyncFailed = fallback && listing.runtimeAvailable
      ? !await syncBlankSessionModels(fallback, options)
      : false;
    return { ok: true, ...(sessionSyncFailed ? { sessionSyncFailed: true } : {}) };
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
    const credentialFile = credentialsPath(options);
    const [{ root }, deskState, credentialDocument] = await Promise.all([
      readOptional(filePath).then(text => parseYaml(text, filePath)),
      readDeskState(options),
      readOptional(credentialFile).then(text => parseYaml(text, credentialFile, true))
    ]);
    const credentials = credentialMap(credentialDocument.root, credentialFile);
    const providers = asObject(asObject(root["llm-pi-ai"]).providers);
    const configured = asObject(providers[id]);
    const stored = deskState.disabledProviders[id];
    const sourceEnabled = Object.keys(configured).length > 0;
    const source = sourceEnabled ? configured : stored?.profile ?? {};
    if (Object.keys(source).length === 0) throw new Error("Provider not found");
    const nextId = copyId(id, new Set([...Object.keys(providers), ...Object.keys(deskState.disabledProviders)]));
    const sourceName = typeof source.displayName === "string" && source.displayName ? source.displayName : id;
    const nextProfile: JsonObject = { ...source, displayName: `${sourceName} Copy` };
    const sourceRef = typeof source.apiKeyEnv === "string" ? source.apiKeyEnv : undefined;
    const storedCredential = sourceRef === deriveDshCredentialRef(id) ? credentials.get(sourceRef) : undefined;
    if (storedCredential) {
      const nextRef = deriveDshCredentialRef(nextId);
      nextProfile.apiKeyEnv = nextRef;
      await setCredential(nextRef, storedCredential, options);
    }
    if (sourceEnabled) {
      await mutateYaml(filePath, document => {
        document.setIn(["llm-pi-ai", "providers", nextId], nextProfile);
      });
    }
    await mutateDeskState(options, state => {
      const sourceMeta = state.providers[id] ?? {};
      state.providers[nextId] = { ...sourceMeta, createdAt: Date.now() };
      if (!sourceEnabled && stored) {
        state.disabledProviders[nextId] = {
          profile: nextProfile,
          ...(stored.catalogProvider ? { catalogProvider: true } : {})
        };
      }
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

export async function switchDshProvider(id: string, options?: DshProviderStoreOptions): Promise<DshProviderSwitchResult> {
  try {
    const listing = await listDshProviders(options);
    const provider = listing.providers.find(item => item.id === id);
    if (!provider) throw new Error("Provider not found");
    if (!provider.enabled) throw new Error("Provider is disabled");
    const selection = providerSelection(provider);
    if (!selection) throw new Error("This provider has no available models. Start DSH to load its catalog or configure a model first");
    await mutateYaml(settingsPath(options), document => {
      document.setIn(["agent-default-model"], selection);
    });
    const sessionSyncFailed = listing.runtimeAvailable
      ? !await syncBlankSessionModels(selection, options)
      : false;
    return {
      ok: true,
      provider: id,
      model: selection.model,
      ...(sessionSyncFailed ? { sessionSyncFailed: true } : {})
    };
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

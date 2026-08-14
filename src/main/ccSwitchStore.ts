/**
 * cc-switch compatibility store.
 *
 * Reads and writes the same on-disk state as cc-switch (v3.15+):
 *   ~/.cc-switch/cc-switch.db      SQLite SSOT for provider records
 *   ~/.cc-switch/settings.json     device-level current-provider pointer
 *   ~/.claude/settings.json        live Claude Code config (replaced on switch)
 *
 * Switch semantics mirror cc-switch's ProviderService::switch for Claude:
 *   1. Backfill: the live settings.json is captured into the outgoing
 *      provider's record (minus the common-config snippet if it uses one).
 *   2. The incoming provider's settingsConfig (plus common-config snippet,
 *      deep-merged) replaces the live file entirely.
 *   3. Both the settings.json pointer and the db is_current flags update.
 *
 * API keys live in plaintext inside settings_config JSON (cc-switch stores
 * them the same way). They must never be logged or written anywhere except
 * the db, the live Claude settings file, and the bounded local backup set.
 *
 * SQLite access uses node:sqlite (bundled with Electron's Node 22) so no
 * native module is required. Connections are opened per operation and closed
 * immediately to avoid holding locks against a running cc-switch instance.
 */

import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { backupJsonFile, readJsonObjectFile, writeTextFileAtomic } from "./filePersistence";
import { commitPointerPlan, planCurrentPointerWrite, planPointerRename, resolveBackfillProviderId } from "./ccSwitchPointer";

type JsonObject = Record<string, unknown>;

export interface CcSwitchProvider {
  id: string;
  name: string;
  settingsConfig: JsonObject;
  websiteUrl?: string;
  category?: string;
  createdAt?: number;
  sortIndex?: number;
  notes?: string;
  icon?: string;
  iconColor?: string;
  meta?: JsonObject;
  inFailoverQueue?: boolean;
  isCurrent?: boolean;
}

export interface CcSwitchStatus {
  available: boolean;
  dbPath: string;
  reason?: string;
}

export interface SwitchOutcome {
  ok: boolean;
  path?: string;
  backupPath?: string | null;
  warnings: string[];
  error?: string;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

type DatabaseCtor = new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;

let DatabaseSync: DatabaseCtor | null = null;
let sqliteLoadError = "";
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DatabaseSync = (require("node:sqlite") as { DatabaseSync: DatabaseCtor }).DatabaseSync;
} catch (error) {
  sqliteLoadError = error instanceof Error ? error.message : String(error);
}

const APP_TYPE = "claude";

export function getCcSwitchDir() {
  return join(homedir(), ".cc-switch");
}

export function getCcSwitchDbPath() {
  return join(getCcSwitchDir(), "cc-switch.db");
}

export function getCcSwitchSettingsPath() {
  return join(getCcSwitchDir(), "settings.json");
}

function getClaudeSettingsPath() {
  return join(homedir(), ".claude", "settings.json");
}

export function getCcSwitchStatus(): CcSwitchStatus {
  const dbPath = getCcSwitchDbPath();
  if (!DatabaseSync) return { available: false, dbPath, reason: `node:sqlite unavailable: ${sqliteLoadError}` };
  if (!existsSync(dbPath)) return { available: false, dbPath, reason: "cc-switch database not found" };
  return { available: true, dbPath };
}

function openDb(readOnly: boolean): SqliteDatabase {
  if (!DatabaseSync) throw new Error(`node:sqlite unavailable: ${sqliteLoadError}`);
  const db = new DatabaseSync(getCcSwitchDbPath(), { readOnly });
  try {
    db.exec("PRAGMA busy_timeout = 3000");
  } catch {
    /* older builds may reject pragmas in readonly mode; busy retries still apply */
  }
  return db;
}

function withDb<T>(readOnly: boolean, run: (db: SqliteDatabase) => T): T {
  const db = openDb(readOnly);
  try {
    return run(db);
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

function parseJsonObject(raw: unknown): JsonObject {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function rowToProvider(row: JsonObject): CcSwitchProvider {
  const meta = parseJsonObject(row.meta);
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    settingsConfig: parseJsonObject(row.settings_config),
    websiteUrl: typeof row.website_url === "string" && row.website_url ? row.website_url : undefined,
    category: typeof row.category === "string" && row.category ? row.category : undefined,
    createdAt: typeof row.created_at === "number" ? row.created_at : undefined,
    sortIndex: typeof row.sort_index === "number" ? row.sort_index : undefined,
    notes: typeof row.notes === "string" && row.notes ? row.notes : undefined,
    icon: typeof row.icon === "string" && row.icon ? row.icon : undefined,
    iconColor: typeof row.icon_color === "string" && row.icon_color ? row.icon_color : undefined,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
    inFailoverQueue: row.in_failover_queue === 1 || row.in_failover_queue === true,
    isCurrent: row.is_current === 1 || row.is_current === true
  };
}

export function listCcSwitchProviders(): CcSwitchProvider[] {
  return withDb(true, db => {
    const rows = db.prepare(
      "SELECT id, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue FROM providers WHERE app_type = ?"
    ).all(APP_TYPE) as JsonObject[];
    return rows.map(rowToProvider);
  });
}

function readCcSwitchSettings(): JsonObject {
  try {
    return readJsonObjectFile(getCcSwitchSettingsPath());
  } catch {
    return {};
  }
}

/**
 * Device-level pointer wins over the db is_current flag — same priority
 * order as cc-switch's get_effective_current_provider.
 */
export function getCurrentCcSwitchProviderId(providers?: CcSwitchProvider[]): string {
  const list = providers ?? listCcSwitchProviders();
  const pointer = readCcSwitchSettings().currentProviderClaude;
  if (typeof pointer === "string" && list.some(provider => provider.id === pointer)) return pointer;
  return list.find(provider => provider.isCurrent)?.id ?? "";
}

export function getCommonConfigSnippet(): string {
  try {
    return withDb(true, db => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("common_config_claude") as JsonObject | undefined;
      return typeof row?.value === "string" ? row.value : "";
    });
  } catch {
    return "";
  }
}

/* ---------- JSON helpers ported from cc-switch live.rs ---------- */

function jsonIsSubset(target: unknown, source: unknown): boolean {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) return false;
    return Object.entries(source as JsonObject).every(([key, sourceValue]) =>
      key in (target as JsonObject) && jsonIsSubset((target as JsonObject)[key], sourceValue)
    );
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return false;
    return jsonArrayContainsSubset(target, source);
  }
  return JSON.stringify(target) === JSON.stringify(source);
}

function jsonArrayContainsSubset(targetArr: unknown[], sourceArr: unknown[]): boolean {
  const matched = new Array(targetArr.length).fill(false);
  return sourceArr.every(sourceItem => {
    const index = targetArr.findIndex((targetItem, i) => !matched[i] && jsonIsSubset(targetItem, sourceItem));
    if (index < 0) return false;
    matched[index] = true;
    return true;
  });
}

function jsonRemoveArrayItems(targetArr: unknown[], sourceArr: unknown[]) {
  for (const sourceItem of sourceArr) {
    const index = targetArr.findIndex(targetItem => jsonIsSubset(targetItem, sourceItem));
    if (index >= 0) targetArr.splice(index, 1);
  }
}

function jsonDeepMerge(target: JsonObject, source: JsonObject) {
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    if (
      sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) &&
      targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)
    ) {
      jsonDeepMerge(targetValue as JsonObject, sourceValue as JsonObject);
    } else {
      target[key] = structuredClone(sourceValue);
    }
  }
}

function jsonDeepRemove(target: JsonObject, source: JsonObject) {
  for (const [key, sourceValue] of Object.entries(source)) {
    let removeKey = false;
    const targetValue = target[key];
    if (key in target) {
      if (
        sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) &&
        targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)
      ) {
        jsonDeepRemove(targetValue as JsonObject, sourceValue as JsonObject);
        removeKey = Object.keys(targetValue as JsonObject).length === 0;
      } else if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
        jsonRemoveArrayItems(targetValue, sourceValue);
        removeKey = targetValue.length === 0;
      } else if (jsonIsSubset(targetValue, sourceValue)) {
        removeKey = true;
      }
    }
    if (removeKey) delete target[key];
  }
}

function providerUsesCommonConfig(provider: CcSwitchProvider, snippet: string): boolean {
  const trimmed = snippet.trim();
  const explicit = provider.meta?.commonConfigEnabled;
  if (typeof explicit === "boolean") return explicit && trimmed.length > 0;
  if (!trimmed) return false;
  try {
    return jsonIsSubset(provider.settingsConfig, JSON.parse(trimmed));
  } catch {
    return false;
  }
}

function sanitizeClaudeSettingsForLive(settings: JsonObject): JsonObject {
  const next = structuredClone(settings);
  delete next.api_format;
  delete next.apiFormat;
  delete next.openrouter_compat_mode;
  delete next.openrouterCompatMode;
  return next;
}

function buildEffectiveSettings(provider: CcSwitchProvider, snippet: string): JsonObject {
  const effective = structuredClone(provider.settingsConfig);
  if (providerUsesCommonConfig(provider, snippet)) {
    try {
      jsonDeepMerge(effective, JSON.parse(snippet.trim()) as JsonObject);
    } catch {
      /* invalid snippet: cc-switch logs a warning and continues without it */
    }
  }
  return sanitizeClaudeSettingsForLive(effective);
}

/* ---------- CRUD ---------- */

const PROVIDER_UPDATE_SQL =
  "UPDATE providers SET id = ?, name = ?, settings_config = ?, website_url = ?, category = ?, created_at = ?, sort_index = ?, notes = ?, icon = ?, icon_color = ?, meta = ? WHERE id = ? AND app_type = ?";

const PROVIDER_INSERT_SQL =
  "INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)";

function providerWriteParams(provider: CcSwitchProvider) {
  return [
    provider.name,
    JSON.stringify(provider.settingsConfig ?? {}),
    provider.websiteUrl ?? null,
    provider.category ?? null,
    provider.createdAt ?? Date.now(),
    provider.sortIndex ?? null,
    provider.notes ?? null,
    provider.icon ?? null,
    provider.iconColor ?? null,
    JSON.stringify(provider.meta ?? {})
  ];
}

export function addCcSwitchProvider(provider: CcSwitchProvider): CcSwitchProvider {
  const record: CcSwitchProvider = {
    ...provider,
    id: provider.id?.trim() || randomUUID(),
    createdAt: provider.createdAt ?? Date.now()
  };
  withDb(false, db => {
    if (record.sortIndex === undefined) {
      const row = db.prepare("SELECT MAX(sort_index) AS maxIndex, COUNT(*) AS total FROM providers WHERE app_type = ?").get(APP_TYPE) as JsonObject;
      const maxIndex = typeof row?.maxIndex === "number" ? row.maxIndex : null;
      record.sortIndex = maxIndex !== null ? maxIndex + 1 : Number(row?.total ?? 0);
    }
    db.prepare(PROVIDER_INSERT_SQL).run(record.id, APP_TYPE, ...providerWriteParams(record));
  });
  return record;
}

export function updateCcSwitchProvider(provider: CcSwitchProvider, originalId?: string): string[] {
  const previousId = originalId?.trim() || provider.id;
  const warnings: string[] = [];
  const renaming = previousId !== provider.id;
  // Whether the renamed provider is the EFFECTIVE current one BEFORE the rename — the
  // device pointer wins, else db is_current, the same priority getCurrentCcSwitchProviderId
  // enforces. Used ONLY as a fallback when the live settings pointer can't be read after
  // the rename; the live pointer, re-read post-rename, is otherwise authoritative (so an
  // external switch is respected, not clobbered). Capturing the db flag alone would miss
  // the case where the *file* pointer names previousId while db is_current does not, and a
  // transient unreadable read would then silently skip the retry/backup/warning and let
  // the effective current flip away.
  let wasCurrentBefore = false;
  if (renaming) {
    try { wasCurrentBefore = getCurrentCcSwitchProviderId() === previousId; } catch { /* db read failed; the rename below will surface it */ }
  }
  withDb(false, db => {
    const result = db.prepare(PROVIDER_UPDATE_SQL).run(provider.id, ...providerWriteParams(provider), previousId, APP_TYPE) as { changes?: number };
    if (!result || Number(result.changes ?? 0) === 0) {
      throw new Error(`Provider ${previousId} not found in cc-switch database`);
    }
  });
  if (renaming) {
    // Best-effort pointer migration; must not escape (the rename already succeeded, and
    // db is_current — preserved on the new id — is the authoritative fallback).
    // renameCurrentPointer re-reads the live pointer, migrates only if it still names the
    // old id (or is unreadable/absent with the db saying it was current), and surfaces a
    // warning if the file is unreadable (PRODUCT.md: read failures must be visible).
    try {
      const pointer = renameCurrentPointer(previousId, provider.id, wasCurrentBefore);
      if (pointer.refused) {
        warnings.push(`cc_switch_settings_unreadable:${pointer.backupPath ?? "no_backup"}`);
      }
    } catch (error) {
      warnings.push(`current_pointer_update_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return warnings;
}

export function deleteCcSwitchProvider(id: string): void {
  const currentId = getCurrentCcSwitchProviderId();
  if (id === currentId) throw new Error("Cannot delete the provider currently in use");
  withDb(false, db => {
    db.prepare("DELETE FROM providers WHERE id = ? AND app_type = ?").run(id, APP_TYPE);
  });
}

/**
 * Duplicate mirrors cc-switch's handleDuplicateProvider: the copy lands
 * directly below the original (sortIndex + 1) and every later provider
 * shifts down by one; a source without sortIndex appends at the end.
 */
export function duplicateCcSwitchProvider(id: string): CcSwitchProvider {
  const source = listCcSwitchProviders().find(provider => provider.id === id);
  if (!source) throw new Error(`Provider ${id} not found in cc-switch database`);
  const record: CcSwitchProvider = {
    ...structuredClone(source),
    id: randomUUID(),
    name: `${source.name} copy`,
    createdAt: Date.now(),
    sortIndex: source.sortIndex !== undefined ? source.sortIndex + 1 : undefined,
    isCurrent: false
  };
  withDb(false, db => {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (record.sortIndex !== undefined) {
        db.prepare("UPDATE providers SET sort_index = sort_index + 1 WHERE app_type = ? AND sort_index >= ? AND id != ?")
          .run(APP_TYPE, record.sortIndex, source.id);
      } else {
        const row = db.prepare("SELECT MAX(sort_index) AS maxIndex, COUNT(*) AS total FROM providers WHERE app_type = ?").get(APP_TYPE) as JsonObject;
        const maxIndex = typeof row?.maxIndex === "number" ? row.maxIndex : null;
        record.sortIndex = maxIndex !== null ? maxIndex + 1 : Number(row?.total ?? 0);
      }
      db.prepare(PROVIDER_INSERT_SQL).run(record.id, APP_TYPE, ...providerWriteParams(record));
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw error;
    }
  });
  return record;
}

export function reorderCcSwitchProviders(orderedIds: string[]): void {
  withDb(false, db => {
    const statement = db.prepare("UPDATE providers SET sort_index = ? WHERE id = ? AND app_type = ?");
    orderedIds.forEach((id, index) => statement.run(index, id, APP_TYPE));
  });
}

/* ---------- switching ---------- */

function readLiveJsonObject(path: string): JsonObject {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

interface PointerWriteResult {
  /** True when the pointer was actually written to settings.json. */
  written: boolean;
  /** True when the file was unreadable/unwritable and left intact — the caller should warn. */
  refused: boolean;
  /** A backup of an unreadable file we refused to overwrite (for recovery), if any. */
  backupPath: string | null;
  /** The content committed over (null if missing) — lets the switch read the pointer it replaced. */
  committedRaw?: string | null;
}

// Brief synchronous pause without extra deps — used only on the rare unreadable-settings
// retry path, so the short main-thread block is acceptable.
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable — skip the pause and just re-read immediately */
  }
}

const POINTER_MAX_ATTEMPTS = 4;
const POINTER_READ_RETRY_MS = 40;

// Read the shared cc-switch settings file. Missing → null (a genuine fresh start). A
// transient read error (e.g. a Windows sharing lock while cc-switch rewrites it) → ""
// so the caller's retry waits it out and then refuses safely rather than throwing.
function readPointerFileRaw(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// Commit a plan to the shared cc-switch settings file with optimistic concurrency — the
// re-read-before-write and retry/refuse logic lives in the pure commitPointerPlan (tested);
// here we just wire the real filesystem I/O.
function commitPointerWrite(makePlan: (raw: string | null) => { action: "write"; content: string } | { action: "skip" } | { action: "refuse" }): PointerWriteResult {
  const path = getCcSwitchSettingsPath();
  return commitPointerPlan(makePlan, {
    read: () => readPointerFileRaw(path),
    write: content => writeTextFileAtomic(path, content),
    backup: () => backupJsonFile(path),
    pause: () => sleepSync(POINTER_READ_RETRY_MS)
  }, POINTER_MAX_ATTEMPTS);
}

function writeCurrentPointer(id: string): PointerWriteResult {
  return commitPointerWrite(raw => planCurrentPointerWrite(raw, id));
}

// Migrate the device pointer after a rename. `wasCurrentBefore` (previousId was the
// EFFECTIVE current — file pointer, else db is_current — before the rename) is only the
// fallback for an unreadable pointer. See planPointerRename for the full decision.
function renameCurrentPointer(previousId: string, newId: string, wasCurrentBefore: boolean): PointerWriteResult {
  return commitPointerWrite(raw => planPointerRename(raw, previousId, newId, wasCurrentBefore));
}

export function switchCcSwitchProvider(id: string): SwitchOutcome {
  const warnings: string[] = [];
  const providers = listCcSwitchProviders();
  const target = providers.find(provider => provider.id === id);
  if (!target) return { ok: false, warnings, error: `Provider ${id} not found in cc-switch database` };

  const livePath = getClaudeSettingsPath();
  const snippet = getCommonConfigSnippet();
  // Resolve the effective current provider (device pointer wins, else db is_current) BEFORE the
  // gate rewrites the pointer to `id`. This is the fallback backfill target when the committed
  // pointer can't name one — e.g. the settings file is missing (a corrupt-pointer recovery
  // deletes it) or has no Claude pointer, yet db is_current still names a provider whose live
  // edits must not be lost.
  const effectiveCurrentBeforeGate = getCurrentCcSwitchProviderId(providers);
  // Commit the shared device pointer FIRST, as a gate. If it can't be written — the settings
  // file is unreadable/unwritable, or under constant external contention — abort BEFORE
  // touching anything else, and return a localized cancellation rather than a stable success on
  // top of an inconsistent state (the switch simply didn't happen). Otherwise
  // ~/.claude/settings.json would hold `id`'s config while the pointer still names the old
  // provider, and because the file pointer outranks db is_current, the next switch would
  // backfill id's live config into the old provider and corrupt it.
  const pointer = writeCurrentPointer(id);
  if (!pointer.written) {
    warnings.push(`cc_switch_settings_unreadable:${pointer.backupPath ?? "no_backup"}`);
    return { ok: false, warnings, error: "cc_switch_settings_pointer_unwritable" };
  }

  // The provider that owns the current live config is whoever the pointer named JUST BEFORE we
  // replaced it — commitPointerPlan may have re-planned against a concurrent external switch, so
  // this can differ from the pre-gate current. Backfill into THAT provider, never a stale
  // snapshot (which would corrupt an unrelated provider's config); but when the committed pointer
  // can't name an existing provider, fall back to the pre-gate effective current so a db-current
  // provider's live edits aren't silently dropped. Capture its live config now, before the live
  // file is overwritten below.
  const outgoingId = resolveBackfillProviderId(
    pointer.committedRaw ?? null,
    effectiveCurrentBeforeGate,
    providerId => providers.some(provider => provider.id === providerId),
    id
  );
  const outgoing = outgoingId ? providers.find(provider => provider.id === outgoingId) : undefined;
  const outgoingLive = outgoing ? readLiveJsonObject(livePath) : null;

  // Replace the live file with the incoming provider's effective settings RIGHT AWAY, so the
  // pointer (already `id`) and the live config agree with minimal delay — no possibly-blocking
  // DB work sits in the pointer=id/live=old window (a busy SQLite UPDATE can wait seconds).
  let backupPath: string | null = null;
  try {
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    backupPath = backupJsonFile(livePath);
    const effective = buildEffectiveSettings(target, snippet);
    writeTextFileAtomic(livePath, `${JSON.stringify(effective, null, 2)}\n`);
  } catch (error) {
    return { ok: false, warnings, error: error instanceof Error ? error.message : String(error) };
  }

  // Pointer and live config are now consistent. Do the (possibly slow) bookkeeping: backfill the
  // outgoing provider's captured live config into its record, then point db is_current at `id`.
  if (outgoing && outgoingLive && Object.keys(outgoingLive).length > 0) {
    try {
      const backfill = structuredClone(outgoingLive);
      if (providerUsesCommonConfig(outgoing, snippet)) {
        try {
          jsonDeepRemove(backfill, JSON.parse(snippet.trim()) as JsonObject);
        } catch {
          warnings.push(`common_config_strip_failed:${outgoing.id}`);
        }
      }
      withDb(false, db => {
        db.prepare("UPDATE providers SET settings_config = ? WHERE id = ? AND app_type = ?")
          .run(JSON.stringify(backfill), outgoing.id, APP_TYPE);
      });
    } catch {
      warnings.push(`backfill_failed:${outgoing.id}`);
    }
  }
  try {
    withDb(false, db => {
      db.prepare("UPDATE providers SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE app_type = ?").run(id, APP_TYPE);
    });
  } catch (error) {
    warnings.push(`db_current_update_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  return { ok: true, path: livePath, backupPath, warnings };
}

/* ---------- connectivity check (cc-switch stream_check semantics) ---------- */

/**
 * Reachability-only probe, ported from cc-switch's StreamCheckService:
 * GET the base_url itself — any HTTP response (200/4xx/5xx) counts as
 * reachable; only network-level failures (DNS, refused, TLS, timeout)
 * fail. Deliberately no auth validation: reachable != correctly
 * configured, and auth walls must not read as "down". Latency is TTFB.
 * Timeout-class failures retry once; hard failures return immediately.
 */
export interface EndpointTestResult {
  status: "operational" | "degraded" | "failed";
  success: boolean;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  url: string;
}

export interface EndpointProbeOptions {
  timeoutMs?: number;
  degradedThresholdMs?: number;
  maxRetries?: number;
  userAgent?: string;
}

function isTimeoutMessage(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("timeout") || lower.includes("timed out") || lower.includes("abort");
}

async function probeOnce(url: string, timeoutMs: number, userAgent?: string): Promise<{ httpStatus: number } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: "*/*", "accept-encoding": "identity" };
    if (userAgent) headers["user-agent"] = userAgent;
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    return { httpStatus: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { error: "timeout" };
    const causeValue = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const cause = causeValue instanceof Error ? `: ${causeValue.message}` : "";
    return { error: error instanceof Error ? `${error.message}${cause}` : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeClaudeEndpoint(baseUrl: string, options: EndpointProbeOptions = {}): Promise<EndpointTestResult> {
  const url = (baseUrl ?? "").trim();
  const timeoutMs = options.timeoutMs ?? 8000;
  const degradedThresholdMs = options.degradedThresholdMs ?? 6000;
  const maxRetries = options.maxRetries ?? 1;
  if (!url) return { status: "failed", success: false, message: "base_url 为空", url };

  let last: EndpointTestResult = { status: "failed", success: false, message: "Check failed", url };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();
    const result = await probeOnce(url, timeoutMs, options.userAgent);
    const responseTimeMs = Date.now() - startedAt;
    if ("httpStatus" in result) {
      return {
        status: responseTimeMs > degradedThresholdMs ? "degraded" : "operational",
        success: true,
        message: "Reachable",
        responseTimeMs,
        httpStatus: result.httpStatus,
        url
      };
    }
    last = { status: "failed", success: false, message: result.error, responseTimeMs, url };
    if (!isTimeoutMessage(result.error)) return last;
  }
  return last;
}

/* ---------- model list fetch (cc-switch parity) ---------- */

export interface FetchProviderModelsResult {
  ok: boolean;
  models: string[];
  errorCode?: "config" | "auth" | "notFound" | "timeout" | "unsupported" | "unsupportedFormat" | "failed";
}

// Given a provider base URL, produce the /models URLs to try in order, matching
// cc-switch: a base that already ends in a version segment (…/v1) just needs
// /models; otherwise try /v1/models first, then a bare /models fallback.
export function buildModelsUrlCandidates(baseUrl: string): string[] {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return [];
  if (/\/v\d+$/i.test(trimmed)) return [`${trimmed}/models`];
  return [`${trimmed}/v1/models`, `${trimmed}/models`];
}

// Formats that expose an OpenAI-style /v1/models list. gemini_native (and any
// unknown format) uses a different endpoint + auth, so we don't pretend to
// support it — the caller disables the button and we hard-stop here as a backstop.
const MODELS_FETCH_FORMATS = new Set(["anthropic", "openai_chat", "openai_responses"]);

export async function fetchProviderModels(payload: { baseUrl?: string; apiKey?: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }): Promise<FetchProviderModelsResult> {
  const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : "";
  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  const apiFormat = typeof payload?.apiFormat === "string" && payload.apiFormat ? payload.apiFormat : "anthropic";
  if (!baseUrl || !apiKey) return { ok: false, models: [], errorCode: "config" };
  if (!MODELS_FETCH_FORMATS.has(apiFormat)) return { ok: false, models: [], errorCode: "unsupportedFormat" };
  const candidates = buildModelsUrlCandidates(baseUrl);
  if (!candidates.length) return { ok: false, models: [], errorCode: "config" };

  // Match the provider's own auth convention: an Anthropic-native provider keyed
  // by ANTHROPIC_API_KEY uses `x-api-key`; everything else (relays, OpenAI
  // gateways, ANTHROPIC_AUTH_TOKEN) uses a bearer token. The key rides in the
  // header only — never the URL, and it is never logged.
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiFormat === "anthropic" && payload.apiKeyField === "ANTHROPIC_API_KEY") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["authorization"] = `Bearer ${apiKey}`;
  }
  if (payload.userAgent && payload.userAgent.trim()) headers["user-agent"] = payload.userAgent.trim();

  let lastError: FetchProviderModelsResult["errorCode"] = "failed";
  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) return { ok: false, models: [], errorCode: "auth" };
      if (response.status === 404 || response.status === 405) { lastError = "notFound"; continue; }
      if (!response.ok) { lastError = "failed"; continue; }
      let json: unknown;
      try { json = await response.json(); } catch { lastError = "unsupported"; continue; }
      const rows = Array.isArray(json)
        ? json
        : Array.isArray((json as { data?: unknown } | null)?.data)
          ? (json as { data: unknown[] }).data
          : null;
      if (!rows) { lastError = "unsupported"; continue; }
      const models = Array.from(new Set(
        rows
          .map(item => (typeof item === "string" ? item : typeof (item as { id?: unknown })?.id === "string" ? (item as { id: string }).id : ""))
          .filter(Boolean)
      )).sort();
      return { ok: true, models };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { ok: false, models: [], errorCode: "timeout" };
      lastError = "failed";
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, models: [], errorCode: lastError };
}

/* ---------- external change watching ---------- */

let watcher: FSWatcher | null = null;
let watchDebounce: NodeJS.Timeout | null = null;

/**
 * Watch the cc-switch data directory so edits made inside cc-switch itself
 * show up in the pet UI without a restart. cc-switch has no watcher of its
 * own, so writes from this app appear there only after its restart — that
 * matches cc-switch's documented behavior.
 */
export function watchCcSwitch(onChange: () => void): () => void {
  stopWatchingCcSwitch();
  const dir = getCcSwitchDir();
  if (!existsSync(dir)) return () => undefined;
  try {
    watcher = watch(dir, (_event, filename) => {
      if (!filename) return;
      const name = String(filename);
      if (!name.startsWith("cc-switch.db") && name !== "settings.json") return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        watchDebounce = null;
        onChange();
      }, 400);
    });
  } catch {
    return () => undefined;
  }
  return stopWatchingCcSwitch;
}

export function stopWatchingCcSwitch() {
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
  if (watcher) {
    try { watcher.close(); } catch { /* already closed */ }
    watcher = null;
  }
  return undefined;
}

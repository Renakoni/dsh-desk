import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function quarantineInvalidJsonFile(filePath: string, now: number, label: string) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const basePath = filePath.toLowerCase().endsWith(".json") ? filePath.slice(0, -5) : filePath;
  const preservedPath = `${basePath}.invalid-${stamp}-${randomUUID()}.json`;
  renameSync(filePath, preservedPath);
  console.warn(`Invalid ${label} preserved at ${preservedPath}`);
}

const MAX_JSON_BACKUPS = 5;

export function readJsonObjectFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) throw new Error(`Expected a JSON object in ${filePath}`);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function pruneJsonBackups(filePath: string) {
  const parent = dirname(filePath);
  const basePath = filePath.toLowerCase().endsWith(".json") ? filePath.slice(0, -5) : filePath;
  const prefix = `${basename(basePath)}.clawd-backup-`;
  const backups = readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left));
  for (const name of backups.slice(MAX_JSON_BACKUPS)) rmSync(join(parent, name), { force: true });
}

export function backupJsonFile(filePath: string, now = Date.now()) {
  if (!existsSync(filePath)) return null;
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const basePath = filePath.toLowerCase().endsWith(".json") ? filePath.slice(0, -5) : filePath;
  const backupPath = `${basePath}.clawd-backup-${stamp}.json`;
  copyFileSync(filePath, backupPath);
  try { chmodSync(backupPath, 0o600); } catch { /* best-effort on platforms without POSIX modes */ }
  try { pruneJsonBackups(filePath); } catch { /* a valid new backup must not block the operation */ }
  return backupPath;
}

export function writeFileAtomic(filePath: string, contents: string | Uint8Array) {
  const parent = dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const tempPath = join(parent, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, contents);
    renameSync(tempPath, filePath);
  } finally {
    try { rmSync(tempPath, { force: true }); } catch { /* best-effort temp cleanup */ }
  }
}

export function writeTextFileAtomic(filePath: string, contents: string) {
  writeFileAtomic(filePath, contents);
}

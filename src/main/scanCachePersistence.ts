// Durable sidecar for a per-file scan cache: `path -> { mtimeMs, size, payload }`.
//
// The token/session scanners already reuse a file's parsed result in memory when its
// (mtimeMs, size) are unchanged; that cache is lost on quit, so a cold start re-streams every
// ~/.claude/projects/**/*.jsonl from scratch. Persisting the cache trades a few MB of disk for a
// near-instant cold start: only files that actually changed get re-parsed.
//
// Correctness rests ENTIRELY on the (mtimeMs, size) key. Claude Code's session logs are
// append-only, so any change flips the size and/or mtime and forces a re-parse — a persisted
// entry is only ever reused for a byte-identical file. A version mismatch (scan logic/payload
// shape changed), a corrupt line, or any read error makes the loader ignore the sidecar and the
// scan runs in full — i.e. it degrades to today's behavior, never to wrong numbers.

import { existsSync, readFileSync } from "node:fs";
import { writeTextFileAtomic } from "./filePersistence";

export interface CachedScan<T> {
  mtimeMs: number;
  size: number;
  payload: T;
}

/** Serialize a cache to versioned NDJSON: a `{v}` header line, then one compact line per file. */
export function serializeScanCache<T>(version: number, entries: Iterable<[string, CachedScan<T>]>): string {
  const parts = [JSON.stringify({ v: version })];
  for (const [path, entry] of entries) {
    parts.push(JSON.stringify({ p: path, m: entry.mtimeMs, s: entry.size, d: entry.payload }));
  }
  return parts.join("\n") + "\n";
}

/**
 * Parse versioned NDJSON back into a Map. Returns an EMPTY map when the header is missing/bad or
 * its version differs (so a schema bump silently forces a full rescan); skips individual malformed
 * lines. Never throws.
 */
export function parseScanCache<T>(text: string, version: number): Map<string, CachedScan<T>> {
  const out = new Map<string, CachedScan<T>>();
  let headerSeen = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      if (!headerSeen) return new Map(); // a corrupt header line invalidates the whole sidecar
      continue; // a corrupt data line is just skipped (that file gets re-parsed)
    }
    if (!headerSeen) {
      headerSeen = true;
      if (!obj || obj.v !== version) return new Map();
      continue;
    }
    if (typeof obj.p === "string" && typeof obj.m === "number" && typeof obj.s === "number" && "d" in obj) {
      out.set(obj.p, { mtimeMs: obj.m, size: obj.s, payload: obj.d as T });
    }
  }
  return headerSeen ? out : new Map();
}

/** Read a sidecar from disk into a Map. Any failure (missing, corrupt, version mismatch) → empty. */
export function loadScanCache<T>(sidecarPath: string, version: number): Map<string, CachedScan<T>> {
  try {
    if (!existsSync(sidecarPath)) return new Map();
    return parseScanCache<T>(readFileSync(sidecarPath, "utf8"), version);
  } catch {
    return new Map();
  }
}

/** Atomically write a cache to its sidecar. Best-effort: a failed write just means the next start rescans. */
export function saveScanCache<T>(sidecarPath: string, version: number, entries: Iterable<[string, CachedScan<T>]>): void {
  try {
    writeTextFileAtomic(sidecarPath, serializeScanCache(version, entries));
  } catch {
    /* durability is a nice-to-have, not a hard requirement */
  }
}

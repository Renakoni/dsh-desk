export type JsonObject = Record<string, unknown>;

export interface PointerBase {
  /** The object to merge the new pointer into — existing fields are preserved. */
  base: JsonObject;
  /**
   * True when the existing file could not be read back as a JSON object — corrupt,
   * a partial concurrent write, a non-object/array, OR present-but-empty. The caller
   * should back the original up and warn before overwriting so it never *silently*
   * drops sibling fields such as other apps' pointers (currentProviderCodex /
   * currentProviderGemini) or unrelated cc-switch settings.
   */
  corrupt: boolean;
}

/**
 * Decide the base object for a cc-switch settings write on the WRITE path.
 *
 * A resilient read that collapses every failure to {} is fine when *reading* a
 * pointer (a missing pointer just falls back to the db is_current flag), but on the
 * write path it is dangerous: rewriting the whole file from {} erases every other
 * key. This keeps the cases distinct — a genuinely absent file (fresh start) vs an
 * unreadable existing one (corrupt) — so the caller preserves the original before
 * healing rather than reducing it to a single pointer without warning.
 *
 * Only a truly missing file (`raw === null`) is a fresh start. An existing but empty
 * file is treated as corrupt: cc-switch never leaves settings.json empty, so an empty
 * read is an anomaly (e.g. observing the file mid-write, right after a truncate) and
 * must not be mistaken for a clean slate to overwrite.
 */
export function resolveCurrentPointerBase(raw: string | null): PointerBase {
  if (raw === null) return { base: {}, corrupt: false }; // missing file → genuinely new
  if (!raw.trim()) return { base: {}, corrupt: true };   // exists but empty → anomalous read
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { base: parsed as JsonObject, corrupt: false }; // preserve every field
    }
    return { base: {}, corrupt: true }; // valid JSON but not an object (e.g. an array)
  } catch {
    return { base: {}, corrupt: true }; // corrupt or partially-written JSON
  }
}

export type PointerWritePlan =
  | { action: "write"; content: string }
  | { action: "refuse" };

/**
 * Decide what to do with the shared settings file when setting the Claude pointer.
 *
 * - Readable object (or a genuinely missing file → {}): merge the pointer in, keeping
 *   every existing field, and return the serialized content to write.
 * - Unreadable (empty/corrupt/partial/non-object): REFUSE. Rebuilding from {} would
 *   drop sibling pointers (currentProviderCodex / currentProviderGemini) and could
 *   clobber a concurrent cc-switch write. The caller preserves the file (backup) and
 *   relies on the db is_current flag, which is authoritative when the pointer is
 *   unreadable — so the switch/rename still takes effect without destroying data.
 */
export function planCurrentPointerWrite(raw: string | null, id: string): PointerWritePlan {
  const { base, corrupt } = resolveCurrentPointerBase(raw);
  if (corrupt) return { action: "refuse" };
  base.currentProviderClaude = id;
  return { action: "write", content: JSON.stringify(base, null, 2) };
}

export type PointerRenamePlan =
  | { action: "write"; content: string }
  | { action: "skip" }
  | { action: "refuse" };

/**
 * Decide how to migrate the device pointer after renaming `previousId` -> `newId`.
 *
 * Reads the LIVE settings content (post-rename) so an external switch — e.g. cc-switch
 * itself moving the current provider between our db snapshot and this write — is
 * respected instead of clobbered:
 *   - pointer === previousId: migrate it to newId.
 *   - pointer names another provider: skip; that switch is newer, don't overwrite it.
 *   - pointer absent, but previousId was the current provider: migrate (write newId).
 *   - file unreadable: refuse (caller backs up + warns) only when previousId was the
 *     current provider; otherwise skip and leave the file untouched.
 *
 * `wasCurrentBefore` is whether previousId was the EFFECTIVE current provider BEFORE the
 * rename (device pointer wins, else db is_current) — a fallback used only when the live
 * pointer can't be read. It must NOT be a db-only flag: the file pointer can name
 * previousId while db is_current names another provider, and a db-only flag would then
 * skip an unreadable read instead of retrying/warning, silently dropping the pointer. The
 * live pointer, when readable, is authoritative (it reflects the newest switch).
 */
export function planPointerRename(raw: string | null, previousId: string, newId: string, wasCurrentBefore: boolean): PointerRenamePlan {
  if (newId === previousId) return { action: "skip" };
  const { base, corrupt } = resolveCurrentPointerBase(raw);
  if (corrupt) return wasCurrentBefore ? { action: "refuse" } : { action: "skip" };
  const pointer = base.currentProviderClaude;
  const pointsToOther = typeof pointer === "string" && pointer !== "" && pointer !== previousId;
  if (pointsToOther) return { action: "skip" }; // a newer external switch — never clobber it
  if (pointer === previousId || wasCurrentBefore) {
    base.currentProviderClaude = newId;
    return { action: "write", content: JSON.stringify(base, null, 2) };
  }
  return { action: "skip" };
}

export interface PointerCommitResult {
  /** True when the content was actually written. */
  written: boolean;
  /** True when the file was unreadable/unwritable and left intact — the caller should warn. */
  refused: boolean;
  /** A backup of an unreadable file we refused to overwrite, if any. */
  backupPath: string | null;
  /** The exact content we committed over (null if the file was missing). Lets a caller read
   *  the pointer it actually replaced — e.g. a switch that re-planned against an external
   *  change must backfill the provider that now owns the live config, not a stale snapshot. */
  committedRaw?: string | null;
}

/** The currentProviderClaude a settings snapshot names, or "" when missing/unreadable. */
export function currentPointerFromRaw(raw: string | null): string {
  const { base, corrupt } = resolveCurrentPointerBase(raw);
  return !corrupt && typeof base.currentProviderClaude === "string" ? base.currentProviderClaude : "";
}

/**
 * Which provider owns the live config a switch is about to overwrite — i.e. the one whose
 * settings must be backfilled before we replace them.
 *
 * Prefer the pointer we actually committed over (`committedRaw`): commitPointerPlan may have
 * re-planned against a concurrent external switch, so the committed pointer — not the pre-gate
 * snapshot — is what owned the live config. BUT only trust it when it still names an existing
 * provider. When the committed file was missing, carried no Claude pointer, or named a
 * since-deleted provider, fall back to `effectiveCurrentBeforeGate` — the effective current
 * resolved before the gate (device pointer wins, else db is_current). Skipping that fallback
 * (as an earlier revision did) silently drops the db-current provider's live edits when the
 * settings pointer is absent — a real path, since a corrupt-pointer recovery deletes that file.
 *
 * Returns "" when there is nothing valid to backfill (resolved provider is the incoming one, is
 * empty, or does not exist).
 */
export function resolveBackfillProviderId(
  committedRaw: string | null,
  effectiveCurrentBeforeGate: string,
  providerExists: (id: string) => boolean,
  incomingId: string
): string {
  const committed = currentPointerFromRaw(committedRaw);
  const resolved = committed && providerExists(committed) ? committed : effectiveCurrentBeforeGate;
  if (!resolved || resolved === incomingId || !providerExists(resolved)) return "";
  return resolved;
}

export interface PointerCommitIo {
  /** Read the shared file: null when missing, "" on a transient read error. */
  read: () => string | null;
  write: (content: string) => void;
  backup: () => string | null;
  /** Brief pause before re-reading an unreadable file. */
  pause: () => void;
}

/**
 * Commit a plan to the shared cc-switch settings file with optimistic concurrency.
 *
 * Read → decide → and, crucially, RE-READ right before writing: only write when the file
 * is still exactly what the plan was built against. If cc-switch rewrote it in between (an
 * external switch, or new Codex/Gemini pointers), re-read and re-plan against the new
 * content instead of clobbering it. A refuse (unreadable file) pauses and retries a few
 * times; a persistently unreadable file is backed up and reported as refused. This isn't
 * lock-tight — the tiny re-read→write window remains — but it closes the wide
 * read→build→write window a plain write leaves open.
 */
export function commitPointerPlan(
  makePlan: (raw: string | null) => { action: "write"; content: string } | { action: "skip" } | { action: "refuse" },
  io: PointerCommitIo,
  maxAttempts = 4
): PointerCommitResult {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = io.read();
    const plan = makePlan(raw);
    if (plan.action === "skip") return { written: false, refused: false, backupPath: null };
    if (plan.action === "refuse") { io.pause(); continue; }
    if (io.read() === raw) {
      try {
        io.write(plan.content);
        return { written: true, refused: false, backupPath: null, committedRaw: raw };
      } catch {
        // The write itself failed (read-only file, ACL, or a rename error). Treat it like an
        // unwritable file so the caller reports the localized cancellation, not a raw error.
        return { written: false, refused: true, backupPath: null };
      }
    }
    // The file changed under us — loop, re-read, and re-plan against the new content.
  }
  // Exhausted: back up + report refused if still unreadable; otherwise leave it untouched
  // (a decided skip, or constant external contention — never clobber).
  if (makePlan(io.read()).action === "refuse") {
    let backupPath: string | null = null;
    try { backupPath = io.backup(); } catch { /* backup itself failed — still report refused */ }
    return { written: false, refused: true, backupPath };
  }
  return { written: false, refused: false, backupPath: null };
}

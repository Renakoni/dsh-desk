// Extraction of Claude's file edits from session JSONL rows.
//
// Claude Code records every applied Edit / Write in the tool-result row (type "user") as a
// structured `toolUseResult` object. The token scanner already JSON-parses those rows for
// timestamps and session metadata, so extracting edits piggybacks on that same pass — no
// extra IO, no extra JSON.parse, just one more field read on an object the scan already holds.

export type ClaudeEditOp = "edit" | "create";

export type ParsedEditRecord = {
  /** JSONL row uuid when present — dedups rows copied into resumed session transcripts. */
  id: string;
  /** Absolute path of the file Claude modified. */
  filePath: string;
  op: ClaudeEditOp;
  addedLines: number;
  removedLines: number;
  timestamp: number;
  sessionId: string;
  /** Transcript path — the sessions page selects rows by this, so it doubles as the jump target. */
  sessionFilePath: string;
  projectPath?: string;
  projectName: string;
};

export type RecentEditsSnapshot = {
  edits: ParsedEditRecord[];
  totalEdits: number;
  totalFiles: number;
  lastScannedAt: number;
};

export type EditContext = {
  id: string;
  timestamp: number;
  sessionId: string;
  sessionFilePath: string;
  projectPath?: string;
  projectName: string;
};

export function emptyRecentEditsSnapshot(): RecentEditsSnapshot {
  return { edits: [], totalEdits: 0, totalFiles: 0, lastScannedAt: 0 };
}

// Line counts come from `structuredPatch` when Claude Code recorded one (exact), otherwise from
// the old/new string shapes (close enough for a timeline). Returns null when the hunks carry no
// usable lines so the caller can fall back.
function countStructuredPatch(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch) || patch.length === 0) return null;
  let added = 0;
  let removed = 0;
  let sawLines = false;
  for (const hunk of patch) {
    if (!hunk || typeof hunk !== "object") continue;
    const lines = (hunk as Record<string, unknown>).lines;
    if (!Array.isArray(lines)) continue;
    sawLines = true;
    for (const line of lines) {
      if (typeof line !== "string") continue;
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return sawLines ? { added, removed } : null;
}

// Written files end with a terminating newline; splitting on "\n" would count that terminator
// as a phantom extra line ("a\n" → 2), so strip exactly one before counting.
function countLines(text: string): number {
  if (!text) return 0;
  const withoutTerminator = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTerminator ? withoutTerminator.split("\n").length : 1;
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

/**
 * Recognize an Edit / MultiEdit / Write result and turn it into one timeline record.
 * Only those tool results carry a top-level `filePath` together with a create/update type,
 * an oldString/newString pair, or an `edits` array — Read nests its path under `file` and
 * Bash/Grep results have no `filePath` at all, so nothing else can slip in.
 */
export function editFromToolUseResult(result: unknown, context: EditContext): ParsedEditRecord | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = result as Record<string, unknown>;
  const filePath = typeof value.filePath === "string" ? value.filePath : "";
  if (!filePath) return null;
  const isCreate = value.type === "create";
  const isOverwrite = value.type === "update";
  const isSingleEdit = typeof value.oldString === "string" && typeof value.newString === "string";
  const multiEdits = Array.isArray(value.edits) ? value.edits : null;
  if (!isCreate && !isOverwrite && !isSingleEdit && !multiEdits) return null;

  const patchCounts = countStructuredPatch(value.structuredPatch);
  let addedLines = patchCounts?.added ?? 0;
  let removedLines = patchCounts?.removed ?? 0;
  if (!patchCounts) {
    if (isSingleEdit) {
      addedLines = countLines(value.newString as string);
      removedLines = countLines(value.oldString as string);
    } else if (multiEdits) {
      for (const entry of multiEdits) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const pair = entry as Record<string, unknown>;
        addedLines += countLines(stringField(pair, "new_string", "newString"));
        removedLines += countLines(stringField(pair, "old_string", "oldString"));
      }
    } else if (typeof value.content === "string") {
      addedLines = countLines(value.content);
    }
  }

  return {
    id: context.id,
    filePath,
    op: isCreate ? "create" : "edit",
    addedLines,
    removedLines,
    timestamp: context.timestamp,
    sessionId: context.sessionId,
    sessionFilePath: context.sessionFilePath,
    projectPath: context.projectPath,
    projectName: context.projectName
  };
}

export const RECENT_EDITS_LIMIT = 300;

/**
 * Merge per-file edit lists into the timeline the renderer shows. Resumed sessions copy earlier
 * rows verbatim into a new transcript, and the row uuid survives that copy — deduping on it keeps
 * one entry per real edit. Rows without a uuid get per-transcript fallback ids that never collide
 * across files, so they simply never dedup (better than merging strangers).
 */
export function aggregateRecentEdits(edits: ParsedEditRecord[], scannedAt: number, limit = RECENT_EDITS_LIMIT): RecentEditsSnapshot {
  const byId = new Map<string, ParsedEditRecord>();
  for (const edit of edits) {
    if (!byId.has(edit.id)) byId.set(edit.id, edit);
  }
  const deduped = [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  const files = new Set<string>();
  for (const edit of deduped) files.add(edit.filePath);
  return {
    edits: deduped.slice(0, limit),
    totalEdits: deduped.length,
    totalFiles: files.size,
    lastScannedAt: scannedAt
  };
}

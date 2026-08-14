import { describe, expect, it } from "vitest";
import { aggregateRecentEdits, editFromToolUseResult, RECENT_EDITS_LIMIT, type ParsedEditRecord } from "../src/main/claudeEditLog";

const context = {
  id: "row-uuid-1",
  timestamp: 1_700_000_000_000,
  sessionId: "session-a",
  sessionFilePath: "C:/Users/me/.claude/projects/proj/session-a.jsonl",
  projectPath: "C:/repo",
  projectName: "repo"
};

function record(overrides: Partial<ParsedEditRecord>): ParsedEditRecord {
  return {
    id: "id",
    filePath: "C:/repo/a.ts",
    op: "edit",
    addedLines: 1,
    removedLines: 1,
    timestamp: 1,
    sessionId: "s",
    sessionFilePath: "t.jsonl",
    projectName: "repo",
    ...overrides
  };
}

describe("editFromToolUseResult", () => {
  it("extracts a single Edit with exact counts from structuredPatch", () => {
    const edit = editFromToolUseResult({
      filePath: "C:/repo/src/app.ts",
      oldString: "const a = 1;",
      newString: "const a = 2;\nconst b = 3;",
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ["-const a = 1;", "+const a = 2;", "+const b = 3;"] }
      ]
    }, context);
    expect(edit).toMatchObject({
      id: "row-uuid-1",
      filePath: "C:/repo/src/app.ts",
      op: "edit",
      addedLines: 2,
      removedLines: 1,
      sessionId: "session-a",
      sessionFilePath: context.sessionFilePath,
      projectName: "repo"
    });
  });

  it("falls back to old/new string line counts when there is no patch", () => {
    const edit = editFromToolUseResult({
      filePath: "C:/repo/a.ts",
      oldString: "one\ntwo",
      newString: "one\ntwo\nthree\nfour"
    }, context);
    expect(edit).toMatchObject({ op: "edit", addedLines: 4, removedLines: 2 });
  });

  it("treats a Write create as op create and counts content lines", () => {
    const edit = editFromToolUseResult({
      type: "create",
      filePath: "C:/repo/new.ts",
      content: "line1\nline2\nline3"
    }, context);
    expect(edit).toMatchObject({ op: "create", addedLines: 3, removedLines: 0 });
  });

  it("does not count the file's terminating newline as an extra line", () => {
    // Real Write results end with an EOF newline — "a\n" is ONE line, not two.
    const eof = editFromToolUseResult({ type: "create", filePath: "C:/repo/eof.ts", content: "line1\nline2\nline3\n" }, context);
    expect(eof).toMatchObject({ op: "create", addedLines: 3, removedLines: 0 });
    const single = editFromToolUseResult({ type: "create", filePath: "C:/repo/one.ts", content: "a\n" }, context);
    expect(single).toMatchObject({ addedLines: 1 });
    const bareNewline = editFromToolUseResult({ type: "create", filePath: "C:/repo/nl.ts", content: "\n" }, context);
    expect(bareNewline).toMatchObject({ addedLines: 1 });
    const withEofStrings = editFromToolUseResult({ filePath: "C:/repo/e.ts", oldString: "one\ntwo\n", newString: "one\n" }, context);
    expect(withEofStrings).toMatchObject({ addedLines: 1, removedLines: 2 });
  });

  it("treats a Write overwrite (type update) as an edit", () => {
    const edit = editFromToolUseResult({
      type: "update",
      filePath: "C:/repo/existing.ts",
      content: "x",
      structuredPatch: [{ lines: ["-old", "+new", "+more"] }]
    }, context);
    expect(edit).toMatchObject({ op: "edit", addedLines: 2, removedLines: 1 });
  });

  it("sums a MultiEdit's pairs when no patch is present", () => {
    const edit = editFromToolUseResult({
      filePath: "C:/repo/multi.ts",
      edits: [
        { old_string: "a", new_string: "a1\na2" },
        { old_string: "b\nc", new_string: "b1" }
      ]
    }, context);
    expect(edit).toMatchObject({ op: "edit", addedLines: 3, removedLines: 3 });
  });

  it("ignores Read results (path nested under file), Bash results, and string results", () => {
    expect(editFromToolUseResult({ type: "text", file: { filePath: "C:/repo/read.ts", content: "x", numLines: 1 } }, context)).toBeNull();
    expect(editFromToolUseResult({ stdout: "ok", stderr: "" }, context)).toBeNull();
    expect(editFromToolUseResult("plain text result", context)).toBeNull();
    expect(editFromToolUseResult(null, context)).toBeNull();
  });

  it("ignores objects with a filePath but no edit marker", () => {
    expect(editFromToolUseResult({ filePath: "C:/repo/x.ts", somethingElse: true }, context)).toBeNull();
  });
});

describe("aggregateRecentEdits", () => {
  it("dedups rows copied into resumed transcripts by uuid and sorts newest first", () => {
    const original = record({ id: "uuid-1", timestamp: 100, sessionFilePath: "a.jsonl" });
    const copied = record({ id: "uuid-1", timestamp: 100, sessionFilePath: "b.jsonl" });
    const newer = record({ id: "uuid-2", timestamp: 200, filePath: "C:/repo/b.ts" });
    const snapshot = aggregateRecentEdits([original, copied, newer], 999);
    expect(snapshot.totalEdits).toBe(2);
    expect(snapshot.totalFiles).toBe(2);
    expect(snapshot.edits.map(edit => edit.id)).toEqual(["uuid-2", "uuid-1"]);
    expect(snapshot.lastScannedAt).toBe(999);
  });

  it("caps the timeline at the limit but reports full totals", () => {
    const edits = Array.from({ length: RECENT_EDITS_LIMIT + 50 }, (_, index) =>
      record({ id: `uuid-${index}`, timestamp: index, filePath: `C:/repo/f${index % 7}.ts` })
    );
    const snapshot = aggregateRecentEdits(edits, 1);
    expect(snapshot.edits.length).toBe(RECENT_EDITS_LIMIT);
    expect(snapshot.totalEdits).toBe(RECENT_EDITS_LIMIT + 50);
    expect(snapshot.totalFiles).toBe(7);
    expect(snapshot.edits[0].timestamp).toBe(RECENT_EDITS_LIMIT + 49);
  });
});

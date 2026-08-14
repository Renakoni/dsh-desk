import { describe, expect, it } from "vitest";
import { commitPointerPlan, currentPointerFromRaw, planCurrentPointerWrite, planPointerRename, resolveBackfillProviderId, resolveCurrentPointerBase } from "../src/main/ccSwitchPointer";

describe("resolveCurrentPointerBase (cc-switch write path)", () => {
  it("treats a genuinely missing file (null) as a fresh, non-corrupt base", () => {
    expect(resolveCurrentPointerBase(null)).toEqual({ base: {}, corrupt: false });
  });

  it("treats an existing but empty/whitespace file as an anomalous (corrupt) read, not a fresh start", () => {
    // cc-switch never leaves settings.json empty; an empty read is a mid-write truncation
    // race, so it must go through the backup/warn path rather than silently reset config.
    expect(resolveCurrentPointerBase("")).toEqual({ base: {}, corrupt: true });
    expect(resolveCurrentPointerBase("   \n  ")).toEqual({ base: {}, corrupt: true });
  });

  it("preserves every existing field so writing the Claude pointer keeps sibling apps' pointers", () => {
    const raw = JSON.stringify({
      currentProviderClaude: "old-claude",
      currentProviderCodex: "cdx",
      currentProviderGemini: "gem",
      theme: "dark"
    });
    const { base, corrupt } = resolveCurrentPointerBase(raw);
    expect(corrupt).toBe(false);

    // Simulate the writeCurrentPointer merge: only the Claude pointer changes.
    base.currentProviderClaude = "new-claude";
    expect(base).toEqual({
      currentProviderClaude: "new-claude",
      currentProviderCodex: "cdx",
      currentProviderGemini: "gem",
      theme: "dark"
    });
  });

  it("flags corrupt / partially-written JSON so the caller backs it up instead of clobbering it", () => {
    // A truncated concurrent write.
    expect(resolveCurrentPointerBase('{"currentProviderClaude":"x","currentProvi')).toEqual({ base: {}, corrupt: true });
    // Not JSON at all.
    expect(resolveCurrentPointerBase("not json at all")).toEqual({ base: {}, corrupt: true });
  });

  it("flags valid JSON that is not an object (array / scalar) as corrupt rather than merging into it", () => {
    expect(resolveCurrentPointerBase('["a","b"]')).toEqual({ base: {}, corrupt: true });
    expect(resolveCurrentPointerBase("42")).toEqual({ base: {}, corrupt: true });
  });
});

describe("planCurrentPointerWrite (write vs refuse)", () => {
  it("creates a fresh file for a genuinely missing settings file", () => {
    const plan = planCurrentPointerWrite(null, "prov-1");
    expect(plan.action).toBe("write");
    expect(JSON.parse(plan.action === "write" ? plan.content : "{}")).toEqual({ currentProviderClaude: "prov-1" });
  });

  it("merges into a valid object, keeping every sibling field", () => {
    const raw = JSON.stringify({ currentProviderClaude: "old", currentProviderCodex: "cdx", currentProviderGemini: "gem", theme: "dark" });
    const plan = planCurrentPointerWrite(raw, "new");
    expect(plan.action).toBe("write");
    expect(JSON.parse(plan.action === "write" ? plan.content : "{}")).toEqual({
      currentProviderClaude: "new",
      currentProviderCodex: "cdx",
      currentProviderGemini: "gem",
      theme: "dark"
    });
  });

  it("REFUSES (never rebuilds from {}) when the existing file is empty, partial, corrupt or non-object", () => {
    // The empty-file race: rebuilding from {} here would drop sibling pointers.
    expect(planCurrentPointerWrite("", "x").action).toBe("refuse");
    expect(planCurrentPointerWrite("   \n ", "x").action).toBe("refuse");
    expect(planCurrentPointerWrite('{"currentProviderClaude":"x","currentProvi', "x").action).toBe("refuse");
    expect(planCurrentPointerWrite("not json", "x").action).toBe("refuse");
    expect(planCurrentPointerWrite('["a"]', "x").action).toBe("refuse");
  });
});

describe("planPointerRename (external-switch aware)", () => {
  const A = "prov-A";
  const A2 = "prov-A2";
  const B = "prov-B";

  it("migrates the pointer when the live pointer still names the renamed provider (keeps siblings)", () => {
    const plan = planPointerRename(JSON.stringify({ currentProviderClaude: A, currentProviderCodex: "cdx" }), A, A2, true);
    expect(plan.action).toBe("write");
    expect(JSON.parse(plan.action === "write" ? plan.content : "{}")).toEqual({ currentProviderClaude: A2, currentProviderCodex: "cdx" });
  });

  it("skips when the live pointer already names another provider — a newer external switch is never clobbered", () => {
    // Even though the db said A was current before the rename, the live pointer is B now.
    expect(planPointerRename(JSON.stringify({ currentProviderClaude: B }), A, A2, true).action).toBe("skip");
  });

  it("falls back to wasCurrentBefore when the pointer is absent: migrate iff it was the current provider", () => {
    // wasCurrentBefore is the EFFECTIVE current (file pointer wins, else db is_current),
    // captured pre-rename — not a db-only flag.
    expect(planPointerRename(JSON.stringify({ theme: "dark" }), A, A2, true).action).toBe("write");
    expect(planPointerRename(JSON.stringify({ theme: "dark" }), A, A2, false).action).toBe("skip");
  });

  it("refuses (so the caller retries then backs up + warns) only when unreadable AND it was the current provider", () => {
    // The file-pointer-is-current-but-db-is-not case relies on this: with the correct
    // effective-current capture the flag is true, so a transient unreadable read refuses
    // (and retries) rather than silently skipping.
    expect(planPointerRename("", A, A2, true).action).toBe("refuse");
    expect(planPointerRename("garbage{", A, A2, true).action).toBe("refuse");
    expect(planPointerRename("", A, A2, false).action).toBe("skip"); // not current → leave the unreadable file alone
  });

  it("skips a no-op (not actually a rename)", () => {
    expect(planPointerRename(JSON.stringify({ currentProviderClaude: A }), A, A, true).action).toBe("skip");
  });
});

describe("commitPointerPlan (optimistic concurrency)", () => {
  const A = JSON.stringify({ currentProviderClaude: "A", currentProviderCodex: "cdx" });
  const B = JSON.stringify({ currentProviderClaude: "B" });

  // Scripted I/O: `reads` are returned in order (repeating the last), writes/backups/pauses counted.
  function scriptedIo(reads: (string | null)[]) {
    let i = 0;
    const writes: string[] = [];
    const counts = { backups: 0, pauses: 0 };
    return {
      writes,
      counts,
      io: {
        read: () => reads[Math.min(i++, reads.length - 1)],
        write: (content: string) => { writes.push(content); },
        backup: () => { counts.backups++; return "/backup/path"; },
        pause: () => { counts.pauses++; }
      }
    };
  }

  it("writes when the file is unchanged between the plan and the commit (preserving siblings)", () => {
    const h = scriptedIo([A, A]);
    const res = commitPointerPlan(raw => planCurrentPointerWrite(raw, "B"), h.io);
    expect(res.written).toBe(true);
    expect(h.writes).toHaveLength(1);
    expect(JSON.parse(h.writes[0])).toEqual({ currentProviderClaude: "B", currentProviderCodex: "cdx" });
  });

  it("re-plans and does NOT clobber when an external switch lands between the plan and the write", () => {
    // read #1 = A (plan: migrate A→A2); re-read = B (cc-switch switched under us) → changed →
    // loop; read #2 = B → planPointerRename now sees another provider → skip. Nothing is written.
    const h = scriptedIo([A, B, B]);
    const res = commitPointerPlan(raw => planPointerRename(raw, "A", "A2", true), h.io);
    expect(res.written).toBe(false);
    expect(res.refused).toBe(false);
    expect(h.writes).toHaveLength(0);
  });

  it("retries an unreadable file, then backs up and reports refused", () => {
    const h = scriptedIo([""]);
    const res = commitPointerPlan(raw => planCurrentPointerWrite(raw, "B"), h.io, 3);
    expect(res).toEqual({ written: false, refused: true, backupPath: "/backup/path" });
    expect(h.writes).toHaveLength(0);
    expect(h.counts.pauses).toBe(3);
  });

  it("recovers when a transiently unreadable file becomes readable on a retry", () => {
    const h = scriptedIo(["", A, A]);
    const res = commitPointerPlan(raw => planCurrentPointerWrite(raw, "B"), h.io);
    expect(res.written).toBe(true);
    expect(h.writes).toHaveLength(1);
    expect(h.counts.pauses).toBe(1);
  });

  it("returns skip without reading twice or backing up for a no-op rename", () => {
    const h = scriptedIo([A]);
    const res = commitPointerPlan(raw => planPointerRename(raw, "A", "A", true), h.io);
    expect(res).toEqual({ written: false, refused: false, backupPath: null });
    expect(h.writes).toHaveLength(0);
    expect(h.counts.backups).toBe(0);
  });

  it("reports committedRaw = the LATEST content after re-planning past an external switch", () => {
    // A switch must backfill the provider that OWNS the live config now, not the pre-gate one.
    // read #1 = A (plan write B); re-read = C (external switch to C) → changed → loop;
    // read #2 = C → plan write B; re-read = C (unchanged) → write B over C.
    const C = JSON.stringify({ currentProviderClaude: "C", currentProviderCodex: "cdx" });
    const h = scriptedIo([A, C, C, C]);
    const res = commitPointerPlan(raw => planCurrentPointerWrite(raw, "B"), h.io);
    expect(res.written).toBe(true);
    expect(res.committedRaw).toBe(C);
    expect(currentPointerFromRaw(res.committedRaw ?? null)).toBe("C"); // switch backfills C, not stale A
  });

  it("reports refused (never throws) when the write itself fails — the switch then cancels cleanly", () => {
    const res = commitPointerPlan(raw => planCurrentPointerWrite(raw, "B"), {
      read: () => A,
      write: () => { throw new Error("EACCES: read-only file"); },
      backup: () => "/backup/path",
      pause: () => {}
    });
    expect(res).toEqual({ written: false, refused: true, backupPath: null });
  });

  it("still reports refused when the backup itself throws on a persistently unreadable file", () => {
    const res = commitPointerPlan(raw => planCurrentPointerWrite(raw, "B"), {
      read: () => "",
      write: () => {},
      backup: () => { throw new Error("sharing lock"); },
      pause: () => {}
    }, 2);
    expect(res).toEqual({ written: false, refused: true, backupPath: null });
  });
});

describe("resolveBackfillProviderId (which provider's live config to preserve)", () => {
  // The switch overwrites ~/.claude/settings.json with the incoming provider; whichever provider
  // OWNED that live config must first be backfilled or its manual edits are lost on switch-back.
  const exists = (ids: string[]) => (id: string) => ids.includes(id);
  const providers = exists(["A", "B", "C"]);

  it("prefers the committed pointer when it names an existing provider (re-planned past a switch)", () => {
    // committedRaw = C means cc-switch switched to C and we committed B over C: C owns the live
    // config now, not the pre-gate A. Backfill C, never the stale pre-gate snapshot.
    const committed = JSON.stringify({ currentProviderClaude: "C" });
    expect(resolveBackfillProviderId(committed, "A", providers, "B")).toBe("C");
  });

  it("falls back to the pre-gate effective current when the settings file was missing", () => {
    // The regression: a corrupt-pointer recovery deletes ~/.cc-switch/settings.json, so the next
    // switch commits over a missing file (committedRaw = null). db is_current still names A — its
    // live edits must be backfilled, not silently dropped.
    expect(resolveBackfillProviderId(null, "A", providers, "B")).toBe("A");
  });

  it("falls back to the effective current when the committed file carries no Claude pointer", () => {
    // Only Codex/Gemini pointers present — no currentProviderClaude — but db is_current = A.
    const committed = JSON.stringify({ currentProviderCodex: "cdx" });
    expect(resolveBackfillProviderId(committed, "A", providers, "B")).toBe("A");
  });

  it("falls back to the effective current when the committed pointer names a since-deleted provider", () => {
    // The pointer still names X, but X no longer exists; back the (existing) effective current A.
    const committed = JSON.stringify({ currentProviderClaude: "X" });
    expect(resolveBackfillProviderId(committed, "A", providers, "B")).toBe("A");
  });

  it("returns '' when the resolved provider is the incoming one (nothing to backfill)", () => {
    // First switch ever: db is_current already = B (the target). No outgoing provider to save.
    expect(resolveBackfillProviderId(null, "B", providers, "B")).toBe("");
  });

  it("returns '' when nothing valid resolves (no committed pointer, no effective current)", () => {
    expect(resolveBackfillProviderId(null, "", providers, "B")).toBe("");
    // A stale effective-current id that no longer exists must not become a backfill target.
    expect(resolveBackfillProviderId(null, "gone", providers, "B")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateUsageRankings,
  countToolUseBlocks,
  countUserCommands,
  createUsageCounts,
  mergeUsageCounts,
  rankUsageCounts
} from "../src/main/claudeUsageStats";

function block(overrides: Record<string, unknown>) {
  return { type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, ...overrides };
}

describe("countToolUseBlocks", () => {
  it("counts named tool_use blocks and ignores everything else", () => {
    const counts = createUsageCounts();
    countToolUseBlocks([
      block({ name: "Bash", id: "t1" }),
      block({ name: "Read", id: "t2" }),
      block({ name: "Read", id: "t3" }),
      { type: "text", text: "hello" },
      { type: "tool_use", id: "t4" }, // no name
      "not-an-object",
      null
    ], counts, new Set());
    expect(counts.tools).toEqual({ Bash: 1, Read: 2 });
  });

  it("dedups repeated rows of the same message by tool_use id", () => {
    const counts = createUsageCounts();
    const seen = new Set<string>();
    // Streamed transcripts repeat the same assistant message across rows; the
    // block id is identical every time, so the second pass must not double count.
    countToolUseBlocks([block({ name: "Bash", id: "t1" })], counts, seen);
    countToolUseBlocks([block({ name: "Bash", id: "t1" }), block({ name: "Grep", id: "t2" })], counts, seen);
    expect(counts.tools).toEqual({ Bash: 1, Grep: 1 });
  });

  it("attributes Skill calls by skill name (current and legacy input shapes)", () => {
    const counts = createUsageCounts();
    countToolUseBlocks([
      block({ name: "Skill", id: "s1", input: { skill: "graphify", args: "" } }),
      block({ name: "Skill", id: "s2", input: { command: "review" } }),
      block({ name: "Skill", id: "s3", input: {} })
    ], counts, new Set());
    expect(counts.tools.Skill).toBe(3);
    expect(counts.skills).toEqual({ graphify: 1, review: 1 });
  });

  it("attributes Task/Agent calls by subagent type", () => {
    const counts = createUsageCounts();
    countToolUseBlocks([
      block({ name: "Task", id: "a1", input: { subagent_type: "Explore", prompt: "x" } }),
      block({ name: "Agent", id: "a2", input: { subagent_type: "Explore" } }),
      block({ name: "Task", id: "a3", input: { prompt: "no type" } })
    ], counts, new Set());
    expect(counts.agents).toEqual({ Explore: 2 });
  });
});

describe("countUserCommands", () => {
  it("counts user-typed slash commands into the skills map, without the slash", () => {
    const counts = createUsageCounts();
    countUserCommands("<command-name>/review</command-name><command-message>review</command-message>", counts);
    countUserCommands("<command-name>/review</command-name>", counts);
    countUserCommands([{ type: "text", text: "<command-name>/graphify</command-name>" }], counts);
    expect(counts.skills).toEqual({ review: 2, graphify: 1 });
    expect(counts.tools).toEqual({});
  });

  it("merges typed commands with tool-invoked skills under one name", () => {
    const counts = createUsageCounts();
    countToolUseBlocks([block({ name: "Skill", id: "s1", input: { skill: "review" } })], counts, new Set());
    countUserCommands("<command-name>/review</command-name>", counts);
    expect(counts.skills.review).toBe(2);
  });

  it("ignores plain prompts and command-output rows", () => {
    const counts = createUsageCounts();
    countUserCommands("just a normal prompt with a /slash word", counts);
    countUserCommands("<local-command-stdout>done</local-command-stdout>", counts);
    countUserCommands([{ type: "tool_result", content: "x" }], counts);
    countUserCommands(undefined, counts);
    expect(counts.skills).toEqual({});
  });
});

describe("rankUsageCounts", () => {
  it("sorts by count desc with alphabetical ties and honors the limit", () => {
    const rows = rankUsageCounts({ Read: 5, Bash: 9, Edit: 5, Grep: 1 }, 3);
    expect(rows).toEqual([
      { name: "Bash", count: 9 },
      { name: "Edit", count: 5 },
      { name: "Read", count: 5 }
    ]);
  });
});

describe("aggregateUsageRankings", () => {
  it("merges per-file counts into global and per-project rankings", () => {
    const fileA = createUsageCounts();
    countToolUseBlocks([block({ name: "Bash", id: "1" }), block({ name: "Read", id: "2" })], fileA, new Set());
    const fileB = createUsageCounts();
    countToolUseBlocks([block({ name: "Bash", id: "3" })], fileB, new Set());
    const empty = createUsageCounts();

    const snapshot = aggregateUsageRankings([
      { usage: fileA, project: { path: "C:/repo-a", name: "repo-a" } },
      { usage: fileB, project: { path: "C:/repo-b", name: "repo-b" } },
      { usage: empty, project: { path: "C:/repo-c", name: "repo-c" } }
    ], 777);

    expect(snapshot.global.totalToolUses).toBe(3);
    expect(snapshot.global.tools[0]).toEqual({ name: "Bash", count: 2 });
    expect(snapshot.projects.map(project => project.projectKey)).toEqual(["C:/repo-a", "C:/repo-b"]);
    expect(snapshot.projects[0].totalToolUses).toBe(2);
    expect(snapshot.lastScannedAt).toBe(777);
  });

  it("accumulates multiple transcripts of the same project under one entry", () => {
    const one = createUsageCounts();
    const two = createUsageCounts();
    countToolUseBlocks([block({ name: "Edit", id: "e1" })], one, new Set());
    countToolUseBlocks([block({ name: "Edit", id: "e2" })], two, new Set());
    const merged = createUsageCounts();
    mergeUsageCounts(merged, one);
    mergeUsageCounts(merged, two);
    expect(merged.tools.Edit).toBe(2);

    const snapshot = aggregateUsageRankings([
      { usage: one, project: { path: "C:/repo", name: "repo" } },
      { usage: two, project: { path: "C:/repo", name: "repo" } }
    ], 1);
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.projects[0].tools).toEqual([{ name: "Edit", count: 2 }]);
  });
});

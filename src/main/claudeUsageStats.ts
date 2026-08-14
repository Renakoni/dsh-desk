// Tool / Skill / Subagent usage counting from session JSONL rows.
//
// tool_use blocks live in the assistant rows the token scanner already JSON-parses, so the
// rankings ride the same pass as token stats and recent edits: no extra IO, no extra parsing.
// Counting is keyed by the tool_use block id — transcripts can repeat an assistant message
// across several rows (the token scanner's dedup exists for the same reason), and the block id
// survives every repeat, so each real invocation is counted exactly once per file.

export type UsageCounts = {
  tools: Record<string, number>;
  skills: Record<string, number>;
  agents: Record<string, number>;
};

export type UsageRankRow = { name: string; count: number };

export type UsageScopeRankings = {
  tools: UsageRankRow[];
  skills: UsageRankRow[];
  agents: UsageRankRow[];
};

export type UsageProjectRankings = UsageScopeRankings & {
  projectKey: string;
  projectName: string;
  totalToolUses: number;
};

export type UsageRankingsSnapshot = {
  global: UsageScopeRankings & { totalToolUses: number };
  projects: UsageProjectRankings[];
  lastScannedAt: number;
};

export const USAGE_RANK_LIMIT = 20;
export const USAGE_PROJECT_LIMIT = 20;

export function createUsageCounts(): UsageCounts {
  return { tools: {}, skills: {}, agents: {} };
}

export function emptyUsageRankingsSnapshot(): UsageRankingsSnapshot {
  return { global: { tools: [], skills: [], agents: [], totalToolUses: 0 }, projects: [], lastScannedAt: 0 };
}

function bump(record: Record<string, number>, name: string) {
  record[name] = (record[name] ?? 0) + 1;
}

/**
 * Count the tool_use blocks of one assistant message's content. `seenToolUseIds` is per-file
 * state that dedups repeated rows of the same message; blocks without an id (never seen in
 * real transcripts) are counted unconditionally rather than dropped.
 */
export function countToolUseBlocks(content: unknown, counts: UsageCounts, seenToolUseIds: Set<string>): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const value = block as Record<string, unknown>;
    if (value.type !== "tool_use" || typeof value.name !== "string" || !value.name) continue;
    if (typeof value.id === "string" && value.id) {
      if (seenToolUseIds.has(value.id)) continue;
      seenToolUseIds.add(value.id);
    }
    bump(counts.tools, value.name);
    const input = value.input && typeof value.input === "object" && !Array.isArray(value.input)
      ? value.input as Record<string, unknown>
      : null;
    if (value.name === "Skill") {
      // Current Claude Code passes { skill, args }; older builds used { command }.
      const skillName = typeof input?.skill === "string" && input.skill ? input.skill
        : typeof input?.command === "string" && input.command ? input.command
        : "";
      if (skillName) bump(counts.skills, skillName);
    }
    if (value.name === "Task" || value.name === "Agent") {
      const agentType = typeof input?.subagent_type === "string" && input.subagent_type ? input.subagent_type : "";
      if (agentType) bump(counts.agents, agentType);
    }
  }
}

const COMMAND_NAME_PATTERN = /<command-name>([^<]+)<\/command-name>/g;

/**
 * Count user-typed slash commands from a user row's message content. In CLI transcripts a
 * typed `/review` is NOT a tool_use — it lands as `<command-name>/review</command-name>` in
 * the user message — so without this the skills ranking only sees the (rare) model-invoked
 * Skill tool calls and misses how people actually run their skills. Names are normalized
 * without the leading slash so both invocation paths merge under one entry.
 */
export function countUserCommands(content: unknown, counts: UsageCounts): void {
  const text = typeof content === "string" ? content
    : Array.isArray(content)
      ? content.map(block => {
          if (!block || typeof block !== "object" || Array.isArray(block)) return "";
          const value = block as Record<string, unknown>;
          return typeof value.text === "string" ? value.text : "";
        }).join("\n")
      : "";
  if (!text || !text.includes("<command-name>")) return;
  for (const match of text.matchAll(COMMAND_NAME_PATTERN)) {
    const name = match[1].trim().replace(/^\//, "");
    if (name) bump(counts.skills, name);
  }
}

export function mergeUsageCounts(target: UsageCounts, source: UsageCounts): void {
  for (const [name, count] of Object.entries(source.tools)) target.tools[name] = (target.tools[name] ?? 0) + count;
  for (const [name, count] of Object.entries(source.skills)) target.skills[name] = (target.skills[name] ?? 0) + count;
  for (const [name, count] of Object.entries(source.agents)) target.agents[name] = (target.agents[name] ?? 0) + count;
}

export function rankUsageCounts(record: Record<string, number>, limit = USAGE_RANK_LIMIT): UsageRankRow[] {
  return Object.entries(record)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function totalOf(record: Record<string, number>): number {
  let total = 0;
  for (const count of Object.values(record)) total += count;
  return total;
}

function rankScope(counts: UsageCounts): UsageScopeRankings {
  return {
    tools: rankUsageCounts(counts.tools),
    skills: rankUsageCounts(counts.skills),
    agents: rankUsageCounts(counts.agents)
  };
}

/**
 * Merge per-file counts into the global and per-project rankings the renderer shows.
 * Projects are keyed by path (name as fallback), ranked by total tool invocations, and
 * capped — the UI's project scope selector doesn't need the long tail.
 */
export function aggregateUsageRankings(
  perFile: Array<{ usage: UsageCounts; project: { path?: string; name: string } }>,
  scannedAt: number
): UsageRankingsSnapshot {
  const globalCounts = createUsageCounts();
  const byProject = new Map<string, { projectName: string; counts: UsageCounts }>();
  for (const file of perFile) {
    mergeUsageCounts(globalCounts, file.usage);
    if (totalOf(file.usage.tools) === 0) continue;
    const projectKey = file.project.path || file.project.name;
    if (!projectKey) continue;
    const project = byProject.get(projectKey) ?? { projectName: file.project.name, counts: createUsageCounts() };
    mergeUsageCounts(project.counts, file.usage);
    byProject.set(projectKey, project);
  }
  const projects = [...byProject.entries()]
    .map(([projectKey, entry]) => ({
      projectKey,
      projectName: entry.projectName,
      totalToolUses: totalOf(entry.counts.tools),
      ...rankScope(entry.counts)
    }))
    .sort((a, b) => b.totalToolUses - a.totalToolUses || a.projectName.localeCompare(b.projectName))
    .slice(0, USAGE_PROJECT_LIMIT);
  return {
    global: { ...rankScope(globalCounts), totalToolUses: totalOf(globalCounts.tools) },
    projects,
    lastScannedAt: scannedAt
  };
}

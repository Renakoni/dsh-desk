/**
 * Human-facing presentation for a tool, shared by the permission bubble and
 * the status panel so both name a tool the same way. `actionForTool` gives a
 * plain-language headline ("Read a file"); `toolLabel` gives a short chip name.
 */

export function toolLabel(tool: string | undefined | null): string {
  if (!tool) return "Tool";
  if (tool.startsWith("mcp__")) return "MCP";
  return tool;
}

export function actionForTool(tool: string | undefined | null): string {
  const t = (tool ?? "").toLowerCase();
  if (t.startsWith("mcp__") || t === "mcp") return "Use an MCP tool";
  if (t === "bash" || t === "shell") return "Run a command";
  if (t === "edit" || t === "write" || t === "multiedit" || t === "update") return "Edit a file";
  if (t === "notebookedit") return "Edit a notebook";
  if (t === "read") return "Read a file";
  if (t === "grep" || t === "glob") return "Search files";
  if (t === "webfetch") return "Fetch a URL";
  if (t === "websearch") return "Search the web";
  if (t === "applypatch") return "Apply a patch";
  if (t === "task" || t === "agent") return "Run a subagent";
  return tool ? `Use ${toolLabel(tool)}` : "Working";
}

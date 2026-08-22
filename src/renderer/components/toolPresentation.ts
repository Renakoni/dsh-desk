/**
 * Human-facing presentation for a tool, shared by the permission bubble and
 * the status panel so both name a tool the same way. `actionForTool` gives a
 * plain-language headline ("Read a file"); `toolLabel` gives a short chip name.
 */

function humanizeIdentifier(value: string, titleCase: boolean): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (lower === "github") return "GitHub";
    if (lower === "api") return "API";
    if (!titleCase && index > 0) return lower;
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join(" ");
}

export function parseMcpTool(tool: string | undefined | null): { server: string; action: string } | null {
  if (!tool?.startsWith("mcp__")) return null;
  const [serverName, ...rawNameParts] = tool.slice(5).split("__");
  const rawName = rawNameParts.join("__");
  if (!serverName || !rawName) return null;
  const server = humanizeIdentifier(serverName, true);
  const action = humanizeIdentifier(rawName, false);
  return server && action ? { server, action } : null;
}

export function toolLabel(tool: string | undefined | null): string {
  if (!tool) return "Tool";
  const mcp = parseMcpTool(tool);
  if (mcp) return mcp.server;
  if (tool.startsWith("mcp__")) return "MCP";
  if (tool.toLowerCase().replace(/[^a-z0-9]+/g, "") === "askuserquestion") return "question";
  return tool;
}

export function actionForTool(tool: string | undefined | null): string {
  const mcp = parseMcpTool(tool);
  if (mcp) return mcp.action;
  const raw = (tool ?? "").toLowerCase();
  const t = raw.replace(/[^a-z0-9]+/g, "");
  if (raw.startsWith("mcp__") || t === "mcp") return "Use an MCP tool";
  if (t === "bash" || t === "shell" || t === "shellcommand" || t === "powershell" || t === "pwsh") return "Run a command";
  if (t === "edit" || t === "write" || t === "multiedit" || t === "update") return "Edit a file";
  if (t === "notebookedit") return "Edit a notebook";
  if (t === "read" || t === "readfile") return "Read a file";
  if (t === "grep" || t === "glob") return "Search files";
  if (t === "webfetch") return "Fetch a URL";
  if (t === "websearch") return "Search the web";
  if (t === "applypatch") return "Apply a patch";
  if (t === "task" || t === "agent") return "Run a subagent";
  if (t === "askuserquestion") return "Ask for input";
  return tool ? "Use a tool" : "Working";
}

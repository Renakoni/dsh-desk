// cc-switch parity: Claude Code declares 1M-token context support for a role by
// appending a literal "[1M]" marker to that role's model value, e.g.
//   ANTHROPIC_DEFAULT_SONNET_MODEL = "some-model[1M]"
// These helpers add / strip / detect the marker exactly like cc-switch's
// useModelState, so provider configs round-trip byte-for-byte between the two
// apps. The comparison is case-insensitive on the marker; the canonical form we
// write is upper-case "[1M]".
export const CLAUDE_ONE_M_MARKER = "[1M]";

export function hasClaudeOneMMarker(model: string): boolean {
  return model.trimEnd().toLowerCase().endsWith("[1m]");
}

export function stripClaudeOneMMarker(model: string): string {
  const trimmedEnd = model.trimEnd();
  if (!trimmedEnd.toLowerCase().endsWith("[1m]")) return model;
  return trimmedEnd.slice(0, -CLAUDE_ONE_M_MARKER.length).trimEnd();
}

export function setClaudeOneMMarker(model: string, enabled: boolean): string {
  const base = stripClaudeOneMMarker(model).trim();
  if (!base) return "";
  return enabled ? `${base}${CLAUDE_ONE_M_MARKER}` : base;
}

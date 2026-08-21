import type { DshResourceScheme, DshThemeOverride } from "./dshResources";

/** Resolve the single effective base theme for the active DSH scheme. */
export function resolveDshThemeId(
  scheme: Pick<DshResourceScheme, "themeId"> | undefined,
  override: DshThemeOverride | undefined
): string | null {
  if (override?.mode === "disabled") return null;
  if (override?.mode === "temporary") return override.themeId;
  return scheme?.themeId ?? null;
}

export function normalizeDshThemeOverride(value: unknown): DshThemeOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.mode === "follow-scheme") return { mode: "follow-scheme" };
  if (row.mode === "disabled") return { mode: "disabled" };
  if (row.mode === "temporary" && typeof row.themeId === "string" && row.themeId.trim()) {
    return { mode: "temporary", themeId: row.themeId.trim() };
  }
  return null;
}

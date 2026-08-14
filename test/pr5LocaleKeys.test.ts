import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Structural en/zh parity is not enough: both files can omit the same key
// and the UI silently falls back to hard-coded Chinese. This test collects
// every translation key the PR 5 surfaces actually use and requires a REAL
// entry in BOTH locales.

const ROOT = join(__dirname, "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, unknown>;
}

function deepGet(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function scan(path: string, pattern: RegExp): string[] {
  const source = readFileSync(join(ROOT, path), "utf8");
  const keys: string[] = [];
  for (const match of source.matchAll(pattern)) keys.push(match[1]);
  return keys;
}

const T_CALL = /\bt\(\s*"([^"]+)"/g;

const usedKeys = new Set<string>([
  // Literal t("...") calls in the PR 5 surfaces.
  ...scan("src/renderer/clawd-migrated/features/settings/PetThemeGrid.tsx", T_CALL),
  ...scan("src/renderer/clawd-migrated/features/settings/PetImportDialog.tsx", T_CALL),
  ...scan("src/renderer/clawd-migrated/features/animation/AnimationSection.tsx", T_CALL),
  // Label tables resolved through t() at render time.
  ...scan("src/renderer/clawd-migrated/utils/stateMappingRows.ts", /"(animation\.(?:state|stateMeta)\.[a-zA-Z]+)"/g),
  ...scan("src/renderer/clawd-migrated/utils/petAnimations.ts", /"(animation\.sprite\.[a-zA-Z0-9]+)"/g)
]);

describe("PR 5 translation keys", () => {
  const en = readJson("src/renderer/clawd-migrated/locales/en.json");
  const zh = readJson("src/renderer/clawd-migrated/locales/zh.json");

  it("collected a meaningful key set", () => {
    expect(usedKeys.size).toBeGreaterThan(40);
    expect(usedKeys.has("petImport.importCard")).toBe(true);
    expect(usedKeys.has("animation.sprite.failed")).toBe(true);
    expect(usedKeys.has("animation.state.error")).toBe(true);
  });

  it("every key used by the PR 5 UI exists in BOTH locales", () => {
    const missing: string[] = [];
    for (const key of usedKeys) {
      if (typeof deepGet(en, key) !== "string") missing.push(`en: ${key}`);
      if (typeof deepGet(zh, key) !== "string") missing.push(`zh: ${key}`);
    }
    expect(missing).toEqual([]);
  });
});

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupJsonFile, readJsonObjectFile, writeTextFileAtomic } from "../src/main/filePersistence";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("JSON backup retention", () => {
  it("keeps only the five newest backups for a settings file", () => {
    const root = mkdtempSync(join(tmpdir(), "chara-backup-retention-"));
    tempRoots.push(root);
    const filePath = join(root, "settings.json");
    const start = Date.UTC(2026, 0, 1);

    for (let index = 0; index < 7; index += 1) {
      writeFileSync(filePath, JSON.stringify({ token: `secret-${index}` }), "utf8");
      backupJsonFile(filePath, start + index * 1000);
    }

    const backups = readdirSync(root)
      .filter(name => name.startsWith("settings.clawd-backup-") && name.endsWith(".json"))
      .sort();
    expect(backups).toHaveLength(5);
    expect(backups.some(name => readFileSync(join(root, name), "utf8").includes("secret-0"))).toBe(false);
    expect(backups.some(name => readFileSync(join(root, name), "utf8").includes("secret-1"))).toBe(false);
    expect(backups.some(name => readFileSync(join(root, name), "utf8").includes("secret-6"))).toBe(true);
  });
});

describe("JSON object persistence", () => {
  it("reads missing and valid JSON object files", () => {
    const root = mkdtempSync(join(tmpdir(), "chara-json-object-"));
    tempRoots.push(root);
    const filePath = join(root, "settings.json");

    expect(readJsonObjectFile(filePath)).toEqual({});
    writeTextFileAtomic(filePath, JSON.stringify({ currentProviderClaude: "provider-a", theme: "dark" }));
    expect(readJsonObjectFile(filePath)).toEqual({ currentProviderClaude: "provider-a", theme: "dark" });
    expect(readdirSync(root).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["", "{broken", "[]", "null"])("rejects invalid settings content without replacing it: %s", raw => {
    const root = mkdtempSync(join(tmpdir(), "chara-json-object-invalid-"));
    tempRoots.push(root);
    const filePath = join(root, "settings.json");
    writeFileSync(filePath, raw, "utf8");

    expect(() => readJsonObjectFile(filePath)).toThrow();
    expect(readFileSync(filePath, "utf8")).toBe(raw);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isReadableRegularFile } from "../src/main/fsAccess";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "clawd-fsaccess-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isReadableRegularFile", () => {
  it("returns false for a missing path or empty input", () => {
    expect(isReadableRegularFile(join(dir, "does-not-exist.js"))).toBe(false);
    expect(isReadableRegularFile("")).toBe(false);
  });

  it("returns true for an existing readable regular file", () => {
    const file = join(dir, "hook-forwarder.js");
    writeFileSync(file, "// forwarder");
    expect(isReadableRegularFile(file)).toBe(true);
  });

  it("returns false for a directory that has the expected filename", () => {
    const asDir = join(dir, "hook-forwarder.js.dir");
    mkdirSync(asDir);
    expect(isReadableRegularFile(asDir)).toBe(false);
  });
});

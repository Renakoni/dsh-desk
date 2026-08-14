import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { visitJsonlTail } from "../src/main/jsonlTail";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("visitJsonlTail", () => {
  it("visits the whole file when it fits within the byte limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "chara-jsonl-tail-"));
    tempRoots.push(root);
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, "one\ntwo\nthree\n", "utf8");
    const lines: string[] = [];

    const result = await visitJsonlTail(filePath, 1024, line => lines.push(line));

    expect(result).toEqual({ truncated: false, linesRead: 3 });
    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("bounds reads to the tail and discards the leading partial row", async () => {
    const root = mkdtempSync(join(tmpdir(), "chara-jsonl-tail-bounded-"));
    tempRoots.push(root);
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, "first-row-is-outside\nsecond\nthird\n", "utf8");
    const lines: string[] = [];

    const result = await visitJsonlTail(filePath, 16, line => lines.push(line));

    expect(result.truncated).toBe(true);
    expect(lines).toEqual(["second", "third"]);
  });
});

// Every line carries multibyte (CJK) text so a byte cut can land mid-character.
const cjkLines = [
  JSON.stringify({ i: 1, text: "汉字内容一二三四五六" }),
  JSON.stringify({ i: 2, text: "第二行更多的汉字内容啊" }),
  JSON.stringify({ i: 3, text: "third line 混合 content 你好" }),
  JSON.stringify({ i: 4, text: "末尾行结束" })
];
const cjkContent = cjkLines.join("\n") + "\n";
const cjkTotal = Buffer.byteLength(cjkContent, "utf8");
const cjkLine0 = Buffer.byteLength(cjkLines[0] + "\n", "utf8");

function writeCjk(): string {
  const root = mkdtempSync(join(tmpdir(), "chara-jsonl-utf8-"));
  tempRoots.push(root);
  const filePath = join(root, "session.jsonl");
  writeFileSync(filePath, cjkContent, "utf8");
  return filePath;
}

async function collect(filePath: string, maxBytes: number): Promise<string[]> {
  const out: string[] = [];
  await visitJsonlTail(filePath, maxBytes, line => out.push(line));
  return out;
}

describe("visitJsonlTail — UTF-8 boundary safety", () => {
  it("returns every line intact when maxBytes covers the whole file", async () => {
    expect(await collect(writeCjk(), cjkTotal)).toEqual(cjkLines);
    expect(await collect(writeCjk(), cjkTotal * 4)).toEqual(cjkLines);
  });

  it("never yields corrupted (replacement-char / unparseable) lines at any cut offset", async () => {
    const filePath = writeCjk();
    for (let maxBytes = 1; maxBytes <= cjkTotal; maxBytes++) {
      for (const line of await collect(filePath, maxBytes)) {
        expect(line).not.toContain("�"); // no mojibake from a split multibyte char
        expect(() => JSON.parse(line)).not.toThrow(); // still valid JSON
      }
    }
  });

  it("keeps a complete line when the cut lands exactly on its boundary (no false drop)", async () => {
    // The old code unconditionally dropped the first line here, losing a whole record.
    expect(await collect(writeCjk(), cjkTotal - cjkLine0)).toEqual([cjkLines[1], cjkLines[2], cjkLines[3]]);
  });

  it("drops only the partial first line when the cut lands mid-line", async () => {
    expect(await collect(writeCjk(), cjkTotal - (cjkLine0 + 8))).toEqual([cjkLines[2], cjkLines[3]]);
  });

  it("yields nothing when the tail window has no complete line", async () => {
    expect(await collect(writeCjk(), 2)).toEqual([]);
  });
});

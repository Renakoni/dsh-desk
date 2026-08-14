import { describe, expect, it } from "vitest";
import { parseScanCache, serializeScanCache, type CachedScan } from "../src/main/scanCachePersistence";

const V = 3;
function entry<T>(mtimeMs: number, size: number, payload: T): CachedScan<T> {
  return { mtimeMs, size, payload };
}

describe("scanCache serialize/parse (durable per-file scan cache)", () => {
  it("round-trips entries with arbitrary payloads (the token cache stores request arrays)", () => {
    const input: Array<[string, CachedScan<unknown>]> = [
      ["/a.jsonl", entry(111, 22, [{ id: "r1", totalTokens: 5 }, { id: "r2", totalTokens: 9 }])],
      ["/b.jsonl", entry(333, 44, { sessionId: "s", messageCount: 3 })]
    ];
    const text = serializeScanCache(V, input);
    const out = parseScanCache(text, V);
    expect(out.size).toBe(2);
    expect(out.get("/a.jsonl")).toEqual(entry(111, 22, [{ id: "r1", totalTokens: 5 }, { id: "r2", totalTokens: 9 }]));
    expect(out.get("/b.jsonl")).toEqual(entry(333, 44, { sessionId: "s", messageCount: 3 }));
  });

  it("writes a version header line so a schema bump can invalidate the whole cache", () => {
    const text = serializeScanCache(V, [["/a.jsonl", entry(1, 2, { x: 1 })]]);
    expect(text.split("\n")[0]).toBe(JSON.stringify({ v: V }));
  });

  it("returns an EMPTY map on a version mismatch — forces a full rescan, never serves stale data", () => {
    const text = serializeScanCache(V, [["/a.jsonl", entry(1, 2, { x: 1 })]]);
    expect(parseScanCache(text, V + 1).size).toBe(0);
  });

  it("returns empty when the header line is corrupt (whole sidecar is untrusted)", () => {
    expect(parseScanCache("not json\n" + JSON.stringify({ p: "/a", m: 1, s: 2, d: 1 }) + "\n", V).size).toBe(0);
  });

  it("skips a corrupt DATA line but keeps the valid entries around it", () => {
    const text = [
      JSON.stringify({ v: V }),
      JSON.stringify({ p: "/a.jsonl", m: 1, s: 2, d: { ok: true } }),
      "{ broken json",
      JSON.stringify({ p: "/c.jsonl", m: 3, s: 4, d: { ok: true } })
    ].join("\n");
    const out = parseScanCache(text, V);
    expect([...out.keys()]).toEqual(["/a.jsonl", "/c.jsonl"]);
  });

  it("drops entries missing required fields", () => {
    const text = [
      JSON.stringify({ v: V }),
      JSON.stringify({ p: "/a.jsonl", m: 1, s: 2, d: {} }),
      JSON.stringify({ p: "/bad.jsonl", m: "nope", s: 2, d: {} }), // m not a number
      JSON.stringify({ p: "/nod.jsonl", m: 1, s: 2 })              // no payload key
    ].join("\n");
    expect([...parseScanCache(text, V).keys()]).toEqual(["/a.jsonl"]);
  });

  it("treats empty/whitespace text as an empty (headerless) cache", () => {
    expect(parseScanCache("", V).size).toBe(0);
    expect(parseScanCache("   \n\n  ", V).size).toBe(0);
  });
});

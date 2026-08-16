import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSkillsInArchive, DshSkillMarketplace, unzipDshSkillArchive } from "../src/main/dshSkillMarketplace";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function archive() {
  return zipSync({
    "demo-main/tool/SKILL.md": strToU8("---\nname: root-tool\ndescription: Root tool\n---\n"),
    "demo-main/tool/nested/SKILL.md": strToU8("---\nname: nested-tool\ndescription: Must be ignored\n---\n"),
    "demo-main/other/SKILL.md": strToU8("---\nname: other-tool\ndescription: Other tool\n---\n"),
    "demo-main/other/script.js": strToU8("export default true\n")
  });
}

describe("DSH Skill repository marketplace", () => {
  it("treats a repository-root Skill as the nested discovery boundary", () => {
    const skills = discoverSkillsInArchive(
      { owner: "owner", name: "root-skill", branch: "main", enabled: true },
      {
        branch: "main",
        files: {
          "SKILL.md": strToU8("---\nname: root-skill\ndescription: Root Skill\n---\n"),
          "nested/SKILL.md": strToU8("---\nname: nested-skill\ndescription: Nested Skill\n---\n"),
          "scripts/run.js": strToU8("export default true\n")
        }
      },
      new Set()
    );
    expect(skills).toEqual([
      expect.objectContaining({
        key: "owner/root-skill:.",
        name: "root-skill",
        directory: ".",
        readmeUrl: "https://github.com/owner/root-skill/blob/main/SKILL.md"
      })
    ]);
  });

  it("falls back to main, stops below a discovered Skill, and installs its directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skill-market-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    mkdirSync(dshHome, { recursive: true });
    const storePath = join(root, "repos.json");
    writeFileSync(storePath, JSON.stringify({ repos: [{ owner: "owner", name: "demo", branch: "develop", enabled: true }] }));
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).startsWith("https://api.github.com/")) {
        return Response.json({ stargazers_count: 4321 });
      }
      return String(url).endsWith("/develop")
        ? new Response("missing", { status: 404 })
        : new Response(archive(), { status: 200, headers: { "content-type": "application/zip" } });
    });
    const market = new DshSkillMarketplace({ dshHome, storePath, fetcher: fetcher as typeof fetch, now: () => 20 });
    const snapshot = await market.snapshot();
    expect(calls.filter(url => url.startsWith("https://codeload.github.com/")).map(url => url.split("/").at(-1))).toEqual(["develop", "main"]);
    expect(snapshot.skills.map(skill => skill.name)).toEqual(["other-tool", "root-tool"]);
    expect(snapshot.skills.find(skill => skill.name === "other-tool")).toMatchObject({
      readmeUrl: "https://github.com/owner/demo/blob/main/other/SKILL.md",
      stars: 4321
    });
    const installed = await market.install(snapshot.skills.find(skill => skill.name === "other-tool")!);
    expect(installed.ok).toBe(true);
    expect(installed.snapshot.skills.find(skill => skill.name === "other-tool")).toMatchObject({ enabled: true, manageable: true });
  });

  it("rejects an archive before extracting beyond the configured unpacked limit", () => {
    const bytes = zipSync({ "demo-main/large.txt": strToU8("1234567890") });
    expect(() => unzipDshSkillArchive(bytes, 5)).toThrow("expands beyond the allowed size");
  });

  it("serves cached metadata immediately and recomputes installed state", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-skill-market-cache-"));
    roots.push(root);
    const dshHome = join(root, "dsh");
    mkdirSync(dshHome, { recursive: true });
    const storePath = join(root, "repos.json");
    writeFileSync(storePath, JSON.stringify({ repos: [{ owner: "owner", name: "demo", branch: "main", enabled: true }] }));
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).startsWith("https://api.github.com/")
      ? Response.json({ stargazers_count: 12 })
      : new Response(archive(), { status: 200 }));
    const options = { dshHome, storePath, fetcher: fetcher as typeof fetch, now: () => 20 };
    const first = await new DshSkillMarketplace(options).snapshot();
    expect(first.skills).toHaveLength(2);
    const callCount = fetcher.mock.calls.length;
    mkdirSync(join(dshHome, "skills", "other-tool"), { recursive: true });
    writeFileSync(join(dshHome, "skills", "other-tool", "SKILL.md"), "---\nname: other-tool\ndescription: installed\n---\n");
    const unavailable = vi.fn(async () => { throw new Error("offline"); });
    const cached = await new DshSkillMarketplace({ ...options, fetcher: unavailable as typeof fetch }).snapshot();
    expect(unavailable).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(callCount);
    expect(cached.errors).toEqual([]);
    expect(cached.skills.find(skill => skill.name === "other-tool")?.installed).toBe(true);
  });

  it("turns a hung repository request into a visible market error", async () => {
    vi.useFakeTimers();
    try {
      const root = mkdtempSync(join(tmpdir(), "dsh-skill-market-timeout-"));
      roots.push(root);
      const storePath = join(root, "repos.json");
      writeFileSync(storePath, JSON.stringify({ repos: [{ owner: "owner", name: "demo", branch: "main", enabled: true }] }));
      const fetcher = vi.fn(async () => await new Promise<Response>(() => undefined));
      const pending = new DshSkillMarketplace({ dshHome: join(root, "dsh"), storePath, fetcher: fetcher as typeof fetch }).snapshot(true);
      await vi.advanceTimersByTimeAsync(10_000);
      const snapshot = await pending;
      expect(snapshot.skills).toEqual([]);
      expect(snapshot.errors[0]).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });
});

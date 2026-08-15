import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DshSkillMarketplace } from "../src/main/dshSkillMarketplace";

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
});

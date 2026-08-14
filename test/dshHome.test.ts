import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDshProviders, saveDshProvider } from "../src/main/dshProviderStore";
import { DshSessionScanner, isDshSessionLogPath } from "../src/main/dshSessionScanner";

describe("DSH_HOME resolution", () => {
  it("uses one custom root for providers, analytics, and session reveal validation", async () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-desk-home-"));
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = dshHome;
    try {
      expect((await saveDshProvider({
        id: "team-gateway",
        name: "Team",
        baseUrl: "https://gateway.example/v1",
        protocol: "openai-completions",
        models: [{ id: "team-model" }]
      }, { runtimeUrl: false })).ok).toBe(true);
      expect((await listDshProviders({ runtimeUrl: false })).settingsPath).toBe(join(dshHome, "settings.yaml"));

      const sessionDir = join(dshHome, "sessions", "--demo--", "session-one");
      mkdirSync(sessionDir, { recursive: true });
      const sessionPath = join(sessionDir, "session.jsonl");
      writeFileSync(sessionPath, `${JSON.stringify({ type: "session", id: "session-one", createdAt: Date.now() })}\n`);
      expect((await new DshSessionScanner().scan()).analytics.sessionRoot).toBe(join(dshHome, "sessions"));
      expect(isDshSessionLogPath(sessionPath)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    }
  });
});

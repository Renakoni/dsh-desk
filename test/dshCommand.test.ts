import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command: string, _args: string[], _options: object, callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void) => {
    const error = Object.assign(new Error("command failed"), { code: "1" }) as unknown as NodeJS.ErrnoException;
    callback(error, "", "pnpm: profile installation failed\nallowBuilds is required");
  })
}));

import { runDshCommand } from "../src/main/dshPluginManager";

describe("DSH CLI command execution", () => {
  it("returns the CLI stderr instead of leaving callers with a generic pending operation", async () => {
    await expect(runDshCommand("pnpm", ["dlx", "@deepseek-ai/dsh", "plugin"]))
      .rejects.toThrow("allowBuilds is required");
  });
});

import { describe, expect, it } from "vitest";
import { dshProviderPresets } from "../src/renderer/clawd-migrated/components/dsh-routing/presets";

describe("DSH provider preset adapter", () => {
  it("converts the original provider presets to DSH routes", () => {
    const presets = dshProviderPresets([]);
    const names = presets.map(preset => preset.name);

    expect(names).toContain("胜算云");
    expect(names).toContain("PatewayAI");
    expect(names).toContain("OpenRouter");
    expect(names).not.toContain("Claude Official");
    expect(names).not.toContain("DeepSeek");
    expect(names).not.toContain("Gemini Native");
    expect(names.some(name => name.startsWith("AWS Bedrock"))).toBe(false);

    expect(presets.find(preset => preset.name === "胜算云")).toEqual(expect.objectContaining({
      baseUrl: "https://router.shengsuanyun.com/api",
      protocol: "anthropic-messages",
      catalogProvider: false,
      inheritModels: false,
      models: [
        { id: "anthropic/claude-sonnet-4.6" },
        { id: "anthropic/claude-opus-4.8" },
        { id: "anthropic/claude-haiku-4.5" }
      ]
    }));
    expect(presets.find(preset => preset.name === "OpenCode Go")?.protocol).toBe("openai-completions");
  });

  it("uses a matching DSH catalog route without copying adapter fields", () => {
    const preset = dshProviderPresets([{
      id: "openrouter",
      name: "OpenRouter",
      active: false,
      declared: false
    }]).find(item => item.name === "OpenRouter");

    expect(preset).toEqual(expect.objectContaining({
      providerId: "openrouter",
      catalogProvider: true,
      inheritModels: true,
      models: []
    }));
    expect(preset).not.toHaveProperty("baseUrl");
    expect(preset).not.toHaveProperty("protocol");
  });
});

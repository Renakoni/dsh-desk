import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteDshProvider,
  deriveDshCredentialRef,
  duplicateDshProvider,
  listDshProviders,
  probeDshProvider,
  reorderDshProviders,
  saveDshProvider,
  switchDshProvider
} from "../src/main/dshProviderStore";

const homes: string[] = [];

function home() {
  const path = mkdtempSync(join(tmpdir(), "chara-dsh-provider-"));
  homes.push(path);
  return path;
}

function runtimeFetch(values: Record<string, unknown>): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    return new Response(JSON.stringify({
      rpcId: request.rpcId,
      result: { ok: true, value: values[request.method] ?? {} }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("DSH provider settings", () => {
  it("projects the official DSH route when the user files are absent", async () => {
    const result = await listDshProviders({ dshHome: home() });
    expect(result.ok).toBe(true);
    expect(result.defaultProvider).toBe("deepseek-official");
    expect(result.providers).toEqual([
      expect.objectContaining({
        id: "deepseek-official",
        baseUrl: "https://api.deepseek.com",
        protocol: "deepseek-chat-completions",
        isDefault: true,
        hasCredential: false,
        models: [
          expect.objectContaining({ id: "deepseek-v4-flash" }),
          expect.objectContaining({ id: "deepseek-v4-pro" })
        ]
      })
    ]);
  });

  it("stores a custom route in DSH settings and its secret only in the credential store", async () => {
    const dshHome = home();
    const result = await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1/",
      protocol: "openai-completions",
      apiKey: "sk-private",
      models: [{ id: "deepseek-v4-flash", name: "V4 Flash", contextWindow: 1_000_000, maxTokens: 262_144 }]
    }, { dshHome });
    expect(result).toEqual(expect.objectContaining({ ok: true }));

    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    const credentials = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
    expect(settings).toContain("llm-pi-ai:");
    expect(settings).toContain("api: openai-completions");
    expect(settings).toContain("baseURL: https://gateway.example/v1");
    expect(settings).not.toContain("sk-private");
    expect(credentials).toContain(`${deriveDshCredentialRef("team-gateway")}: sk-private`);

    const listing = await listDshProviders({ dshHome });
    expect(listing.providers).toContainEqual(expect.objectContaining({
      id: "team-gateway",
      name: "Team Gateway",
      hasCredential: true
    }));
  });

  it("preserves sibling settings and advanced provider fields", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "# keep this comment",
      "ui-onboarding:",
      "  welcomeNoticeVersion: current",
      "llm-pi-ai:",
      "  providers:",
      "    team-gateway:",
      "      displayName: Old",
      "      api: openai-completions",
      "      baseURL: https://old.example/v1",
      "      timeoutMs: 1234",
      "      models:",
      "        - id: old",
      ""
    ].join("\n"));

    const result = await saveDshProvider({
      id: "team-gateway",
      name: "New",
      baseUrl: "https://new.example/v1",
      protocol: "openai-responses",
      models: [{ id: "deepseek-v4-pro" }]
    }, { dshHome });
    expect(result.ok).toBe(true);
    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).toContain("# keep this comment");
    expect(settings).toContain("welcomeNoticeVersion: current");
    expect(settings).toContain("timeoutMs: 1234");
    expect(settings).toContain("api: openai-responses");
  });

  it("preserves an existing credential reference when replacing its key", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "llm-pi-ai:",
      "  providers:",
      "    team-gateway:",
      "      displayName: Team",
      "      apiKeyEnv: TEAM_EXISTING_KEY",
      "      api: openai-completions",
      "      baseURL: https://gateway.example/v1",
      "      models:",
      "        - id: old",
      ""
    ].join("\n"));
    writeFileSync(join(dshHome, ".credentials.yaml"), "TEAM_EXISTING_KEY: old-secret\n");

    const result = await saveDshProvider({
      id: "team-gateway",
      name: "Team",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      apiKey: "new-secret",
      models: [{ id: "deepseek-v4-pro" }]
    }, { dshHome });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).toContain("apiKeyEnv: TEAM_EXISTING_KEY");
    const credentials = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
    expect(credentials).toContain("TEAM_EXISTING_KEY: new-secret");
    expect(credentials).not.toContain(deriveDshCredentialRef("team-gateway"));
  });

  it("leaves a keyless custom route reference-free for provider-native authentication", async () => {
    const dshHome = home();
    const result = await saveDshProvider({
      id: "bedrock-route",
      name: "Bedrock Route",
      baseUrl: "https://bedrock.example/v1",
      protocol: "openai-completions",
      models: [{ id: "deepseek-v4-pro" }]
    }, { dshHome });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).not.toContain("apiKeyEnv");
    expect(result.provider).toEqual(expect.objectContaining({ hasCredential: false }));
    expect(result.provider).not.toHaveProperty("credentialRef");
  });

  it("stores a catalog route without forcing endpoint, protocol, or model mappings", async () => {
    const dshHome = home();
    const result = await saveDshProvider({
      id: "openai",
      name: "OpenAI",
      inheritModels: true,
      catalogProvider: true
    }, { dshHome });

    expect(result.ok).toBe(true);
    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).toContain("openai:");
    expect(settings).not.toContain("baseURL:");
    expect(settings).not.toContain("api:");
    expect(settings).not.toContain("models:");
    expect(result.provider).toEqual(expect.objectContaining({
      id: "openai",
      modelsInherited: true,
      models: []
    }));
  });

  it("merges DSH runtime catalog metadata and inherited models", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "llm-pi-ai:",
      "  providers:",
      "    openai:",
      "      displayName: OpenAI Team",
      ""
    ].join("\n"));
    const result = await listDshProviders({
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: runtimeFetch({
        "llm.providers": { providers: [
          { provider: "deepseek-official", displayName: "DeepSeek", active: true },
          { provider: "openai", displayName: "OpenAI", active: true, declared: false },
          { provider: "anthropic", displayName: "Anthropic", active: false, declared: false }
        ] },
        "llm.models": { groups: [
          { id: "openai", name: "OpenAI", models: [{ id: "gpt-runtime", name: "Runtime GPT" }] }
        ] }
      })
    });

    expect(result.runtimeAvailable).toBe(true);
    expect(result.catalogProviders).toContainEqual(expect.objectContaining({ id: "anthropic", active: false }));
    expect(result.providers).toContainEqual(expect.objectContaining({
      id: "openai",
      catalogProvider: true,
      runtimeActive: true,
      modelsInherited: true,
      models: [{ id: "gpt-runtime", name: "Runtime GPT" }]
    }));
  });

  it("persists provider order and duplicates a route next to its source", async () => {
    const dshHome = home();
    for (const [id, name] of [["alpha", "Alpha"], ["beta", "Beta"]] as const) {
      expect((await saveDshProvider({
        id,
        name,
        baseUrl: `https://${id}.example/v1`,
        protocol: "openai-completions",
        models: [{ id: `${id}-model` }]
      }, { dshHome })).ok).toBe(true);
    }

    expect((await reorderDshProviders(["beta", "deepseek-official", "alpha"], { dshHome })).ok).toBe(true);
    expect((await listDshProviders({ dshHome })).providers.map(provider => provider.id)).toEqual([
      "beta",
      "deepseek-official",
      "alpha"
    ]);

    const duplicated = await duplicateDshProvider("beta", { dshHome });
    expect(duplicated).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({ id: "beta-copy", name: "Beta Copy" })
    }));
    expect((await listDshProviders({ dshHome })).providers.map(provider => provider.id)).toEqual([
      "beta",
      "beta-copy",
      "deepseek-official",
      "alpha"
    ]);
  });

  it("keeps the current DSH model when switching to an inherited catalog route", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: previous-route",
      "  model: current-unlisted-model",
      ""
    ].join("\n"));
    await saveDshProvider({ id: "openai", name: "OpenAI", inheritModels: true, catalogProvider: true }, { dshHome });

    expect(await switchDshProvider("openai", undefined, { dshHome })).toEqual({
      ok: true,
      provider: "openai",
      model: "current-unlisted-model"
    });
  });

  it("switches the DSH default selection and resets it when that route is deleted", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      apiKey: "sk-private",
      models: [{ id: "deepseek-v4-pro" }]
    }, { dshHome });
    expect(await switchDshProvider("team-gateway", "deepseek-v4-pro", { dshHome })).toEqual({
      ok: true,
      provider: "team-gateway",
      model: "deepseek-v4-pro"
    });
    expect(await listDshProviders({ dshHome })).toEqual(expect.objectContaining({
      defaultProvider: "team-gateway",
      defaultModel: "deepseek-v4-pro"
    }));

    expect((await deleteDshProvider("team-gateway", { dshHome })).ok).toBe(true);
    const listing = await listDshProviders({ dshHome });
    expect(listing.defaultProvider).toBe("deepseek-official");
    expect(listing.providers.map(item => item.id)).toEqual(["deepseek-official"]);
    expect(readFileSync(join(dshHome, ".credentials.yaml"), "utf8")).not.toContain("TEAM_GATEWAY");
  });

  it("probes the standard models endpoint without exposing the stored key", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      apiKey: "sk-private",
      models: [{ id: "configured" }]
    }, { dshHome });
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://gateway.example/v1/models");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-private");
      return new Response(JSON.stringify({ data: [
        { id: "deepseek-v4-pro", display_name: "V4 Pro", context_window: 1_000_000, max_output_tokens: 384_000 },
        { id: "deepseek-v4-flash" }
      ] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const result = await probeDshProvider({ id: "team-gateway" }, { dshHome, fetchImpl: fetchImpl as typeof fetch });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 200,
      models: [
        { id: "deepseek-v4-flash" },
        { id: "deepseek-v4-pro", name: "V4 Pro", contextWindow: 1_000_000, maxTokens: 384_000 }
      ]
    }));
  });

  it("does not pretend Anthropic Messages has an OpenAI model listing", async () => {
    const fetchImpl = async () => { throw new Error("must not fetch"); };
    const result = await probeDshProvider({
      baseUrl: "https://anthropic.example/v1",
      protocol: "anthropic-messages"
    }, { dshHome: home(), fetchImpl: fetchImpl as typeof fetch });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "Anthropic Messages providers do not expose the OpenAI /models endpoint" }));
  });
});

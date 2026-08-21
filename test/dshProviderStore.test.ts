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
  setDshProviderEnabled,
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

function recordedRuntime({
  providers,
  groups,
  sessions,
  select
}: {
  providers: unknown[];
  groups: unknown[];
  sessions: unknown[];
  select?: (payload: Record<string, unknown>, attempt: number) => Record<string, unknown>;
}) {
  const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let selectAttempt = 0;
  const runtimeFetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: Record<string, unknown> };
    requests.push({ method: request.method, payload: request.payload });
    const value = request.method === "llm.providers"
      ? { providers }
      : request.method === "llm.models"
        ? { groups }
        : request.method === "session.list"
          ? { items: sessions }
          : request.method === "session.selectModel"
            ? select?.(request.payload, selectAttempt++) ?? { selected: request.payload }
            : {};
    return new Response(JSON.stringify({ rpcId: request.rpcId, result: { ok: true, value } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  return { requests, runtimeFetchImpl };
}

afterEach(() => {
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("DSH provider settings", () => {
  it("reads DSH versioned credentials documents", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, ".credentials.yaml"), [
      "version: 1",
      "refs:",
      "  DEEPSEEK_API_KEY: test-secret",
      "records:",
      "  llm-pi-ai/example:",
      "    kind: api-key",
      ""
    ].join("\n"));

    const result = await listDshProviders({ dshHome });
    expect(result.ok).toBe(true);
    expect(result.providers[0]).toEqual(expect.objectContaining({ credentialRef: "DEEPSEEK_API_KEY", apiKey: "test-secret", hasCredential: true }));
  });

  it("writes provider credentials under refs without dropping DSH records", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, ".credentials.yaml"), [
      "version: 1",
      "refs:",
      "  DEEPSEEK_API_KEY: existing-secret",
      "records:",
      "  llm-pi-ai/example:",
      "    kind: api-key",
      ""
    ].join("\n"));

    const result = await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      apiKey: "new-secret"
    }, { dshHome });
    expect(result.ok).toBe(true);
    const credentials = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
    expect(credentials).toContain("version: 1");
    expect(credentials).toContain("refs:");
    expect(credentials).toContain("CHARA_DSH_TEAM_GATEWAY_API_KEY: new-secret");
    expect(credentials).toContain("records:");
  });

  it("projects the official DSH route when the user files are absent", async () => {
    const result = await listDshProviders({ dshHome: home() });
    expect(result.ok).toBe(true);
    expect(result.defaultProvider).toBe("deepseek-official");
    expect(result.providers).toEqual([
      expect.objectContaining({
        id: "deepseek-official",
        baseUrl: "https://api.deepseek.com",
        protocol: "deepseek-chat-completions",
        icon: "deepseek",
        iconColor: "#4D6BFE",
        enabled: true,
        isDefault: true,
        hasCredential: false,
        models: [
          expect.objectContaining({ id: "deepseek-v4-flash" }),
          expect.objectContaining({ id: "deepseek-v4-pro" })
        ]
      })
    ]);
    expect(result.providers[0]?.models.every(model => model.reasoning === undefined)).toBe(true);
  });

  it("preserves the DSH-managed official reasoning setting while editing the route", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "llm-deepseek:",
      "  reasoningEffort: high",
      ""
    ].join("\n"));
    const result = await saveDshProvider({
      id: "deepseek-official",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      protocol: "deepseek-chat-completions",
      inheritModels: true,
      catalogProvider: true
    }, { dshHome });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).toContain("reasoningEffort: high");
    expect((await listDshProviders({ dshHome })).providers[0]).toEqual(expect.objectContaining({ reasoningDefault: "high" }));
  });

  it("stores a custom route without inventing reasoning capabilities", async () => {
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
    expect(settings).not.toContain("reasoning:");
    expect(settings).not.toContain("reasoningEfforts:");
    expect(settings).not.toContain("sk-private");
    expect(credentials).toContain(`${deriveDshCredentialRef("team-gateway")}: sk-private`);

    const listing = await listDshProviders({ dshHome });
    expect(listing.providers).toContainEqual(expect.objectContaining({
      id: "team-gateway",
      name: "Team Gateway",
      apiKey: "sk-private",
      hasCredential: true
    }));
  });

  it("allocates an internal route ID when the UI does not provide one", async () => {
    const dshHome = home();
    const result = await saveDshProvider({
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({
        id: expect.stringMatching(/^route-[0-9a-f-]{36}$/),
        name: "Team Gateway"
      })
    }));
    const id = result.provider?.id;
    expect(id).toBeTruthy();
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).toContain(`${id}:`);
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

  it("preserves model compatibility settings while editing a provider", async () => {
    const dshHome = home();
    const compat = {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      thinkingFormat: "qwen-chat-template",
      requiresToolResultName: true,
      requiresAssistantAfterToolResult: true,
      chatTemplateKwargs: {
        enable_thinking: { $var: "thinking.enabled", omitWhenOff: false }
      }
    };
    writeFileSync(join(dshHome, "settings.yaml"), [
      "llm-pi-ai:",
      "  providers:",
      "    team-gateway:",
      "      displayName: Team",
      "      apiKeyEnv: TEAM_GATEWAY_KEY",
      "      api: openai-completions",
      "      baseURL: https://gateway.example/v1",
      "      models:",
      "        - id: team-model",
      "          maxTokens: 8192",
      "          compat:",
      "            supportsDeveloperRole: false",
      "            supportsStore: false",
      "            supportsUsageInStreaming: false",
      "            maxTokensField: max_tokens",
      "            thinkingFormat: qwen-chat-template",
      "            requiresToolResultName: true",
      "            requiresAssistantAfterToolResult: true",
      "            chatTemplateKwargs:",
      "              enable_thinking:",
      "                $var: thinking.enabled",
      "                omitWhenOff: false",
      ""
    ].join("\n"));
    writeFileSync(join(dshHome, ".credentials.yaml"), [
      "version: 1",
      "refs:",
      "  TEAM_GATEWAY_KEY: old-secret",
      "records: {}",
      ""
    ].join("\n"));

    const existing = (await listDshProviders({ dshHome })).providers.find(provider => provider.id === "team-gateway");
    expect(existing?.models[0]?.compat).toEqual(compat);

    const result = await saveDshProvider({
      ...existing!,
      name: "Team renamed",
      apiKey: "new-secret",
      inheritModels: existing!.modelsInherited
    }, { dshHome });

    expect(result.ok).toBe(true);
    const saved = (await listDshProviders({ dshHome })).providers.find(provider => provider.id === "team-gateway");
    expect(saved?.name).toBe("Team renamed");
    expect(saved?.models[0]?.compat).toEqual(compat);
    expect(readFileSync(join(dshHome, ".credentials.yaml"), "utf8")).toContain("TEAM_GATEWAY_KEY: new-secret");
  });

  it("preserves the current reasoning effort selected in DSH Web", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: team-gateway",
      "  model: gpt-5.6-sol",
      "  reasoningEffort: high",
      "llm-pi-ai:",
      "  providers:",
      "    team-gateway:",
      "      displayName: Team",
      "      api: openai-responses",
      "      baseURL: https://gateway.example/v1",
      "      reasoning: medium",
      "      models:",
      "        - id: gpt-5.6-sol",
      "          reasoningEfforts:",
      "            low: low",
      "            medium: medium",
      "            high: high",
      "            xhigh: xhigh",
      "            max: max",
      ""
    ].join("\n"));

    const existing = (await listDshProviders({ dshHome })).providers.find(provider => provider.id === "team-gateway");
    expect(existing).toEqual(expect.objectContaining({ reasoningDefault: "medium" }));

    const result = await saveDshProvider({
      ...existing!,
      name: "Team renamed",
      inheritModels: existing!.modelsInherited
    }, { dshHome });

    expect(result.ok).toBe(true);
    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).toContain("displayName: Team renamed");
    expect(settings).toContain("reasoning: medium");
    expect(settings).toContain("reasoningEffort: high");
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

  it("stores common reasoning levels and initializes the selected route at medium", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: reasoning-gateway",
      "  model: reasoning-model",
      ""
    ].join("\n"));
    const reasoningEfforts = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } as const;
    await saveDshProvider({
      id: "reasoning-gateway",
      name: "Reasoning Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      reasoningDefault: "medium",
      models: [
        { id: "reasoning-model", reasoningEfforts },
        { id: "second-model", reasoningEfforts }
      ]
    }, { dshHome });

    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).toContain("reasoning: medium");
    expect(settings).toContain("reasoningEffort: medium");
    expect(settings.match(/reasoningEfforts:/g)).toHaveLength(2);
    const listing = await listDshProviders({ dshHome });
    expect(listing.providers.find(provider => provider.id === "reasoning-gateway")?.models).toEqual([
      expect.objectContaining({ id: "reasoning-model", reasoningEfforts }),
      expect.objectContaining({ id: "second-model", reasoningEfforts })
    ]);
  });

  it("clears the selected route's reasoning effort when capability is disabled", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: plain-gateway",
      "  model: plain-model",
      "  reasoningEffort: high",
      "llm-pi-ai:",
      "  providers:",
      "    plain-gateway:",
      "      displayName: Plain Gateway",
      "      reasoning: medium",
      "      models:",
      "        - id: plain-model",
      "          reasoningEfforts:",
      "            low: low",
      "            medium: medium",
      "            high: high",
      "            xhigh: xhigh",
      "            max: max",
      ""
    ].join("\n"));
    await saveDshProvider({
      id: "plain-gateway",
      name: "Plain Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "plain-model" }]
    }, { dshHome });

    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).not.toContain("reasoningEfforts:");
    expect(settings).not.toContain("reasoning:");
    expect(settings).not.toContain("reasoningEffort:");
  });

  it("clears stale reasoning from blank sessions after editing the current route", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: team-gateway",
      "  model: team-model",
      "  reasoningEffort: high",
      "llm-pi-ai:",
      "  providers:",
      "    team-gateway:",
      "      displayName: Team Gateway",
      "      reasoning: medium",
      "      models:",
      "        - id: team-model",
      "          reasoningEfforts:",
      "            low: low",
      "            medium: medium",
      "            high: high",
      "            xhigh: xhigh",
      "            max: max",
      ""
    ].join("\n"));
    const runtime = recordedRuntime({
      providers: [{ provider: "team-gateway", displayName: "Team Gateway", active: true }],
      groups: [{ id: "team-gateway", name: "Team Gateway", models: [{ id: "team-model" }] }],
      sessions: [
        { sessionId: "blank-session", blank: true },
        { sessionId: "completed-session", blank: false }
      ],
      select: (payload, attempt) => attempt === 0
        ? { selected: { ...payload, reasoningEffort: "high" } }
        : { selected: payload }
    });

    const result = await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome, runtimeUrl: "http://dsh.test", runtimeFetchImpl: runtime.runtimeFetchImpl });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(result).not.toHaveProperty("sessionSyncFailed");
    expect(runtime.requests.filter(request => request.method === "session.selectModel")).toEqual([
      { method: "session.selectModel", payload: { sessionId: "blank-session", provider: "team-gateway", model: "team-model" } },
      { method: "session.selectModel", payload: { sessionId: "blank-session", provider: "team-gateway", model: "team-model" } }
    ]);
  });

  it("moves blank sessions to the fallback when disabling the current route", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });
    await switchDshProvider("team-gateway", { dshHome });
    const runtime = recordedRuntime({
      providers: [
        { provider: "deepseek-official", displayName: "DeepSeek", active: true },
        { provider: "team-gateway", displayName: "Team Gateway", active: true }
      ],
      groups: [{ id: "team-gateway", name: "Team Gateway", models: [{ id: "team-model" }] }],
      sessions: [
        { sessionId: "blank-session", blank: true },
        { sessionId: "completed-session", blank: false }
      ],
      select: payload => ({ selected: { ...payload, reasoningEffort: "high" } })
    });

    const result = await setDshProviderEnabled("team-gateway", false, {
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: runtime.runtimeFetchImpl
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(result).not.toHaveProperty("sessionSyncFailed");
    expect(runtime.requests.filter(request => request.method === "session.selectModel")).toEqual([{
      method: "session.selectModel",
      payload: { sessionId: "blank-session", provider: "deepseek-official", model: "deepseek-v4-flash" }
    }]);
  });

  it("moves blank sessions to the fallback when deleting the current route", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });
    await switchDshProvider("team-gateway", { dshHome });
    const runtime = recordedRuntime({
      providers: [
        { provider: "deepseek-official", displayName: "DeepSeek", active: true },
        { provider: "team-gateway", displayName: "Team Gateway", active: true }
      ],
      groups: [{ id: "team-gateway", name: "Team Gateway", models: [{ id: "team-model" }] }],
      sessions: [{ sessionId: "blank-session", blank: true }]
    });

    const result = await deleteDshProvider("team-gateway", {
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: runtime.runtimeFetchImpl
    });

    expect(result).toEqual({ ok: true });
    expect(runtime.requests.filter(request => request.method === "session.selectModel")).toEqual([{
      method: "session.selectModel",
      payload: { sessionId: "blank-session", provider: "deepseek-official", model: "deepseek-v4-flash" }
    }]);
  });

  it("keeps disabled providers in DSH Desk while removing them from DSH", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      apiKey: "sk-private",
      models: [{ id: "team-model" }]
    }, { dshHome });
    await switchDshProvider("team-gateway", { dshHome });

    const disabled = await setDshProviderEnabled("team-gateway", false, { dshHome });
    expect(disabled).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({ id: "team-gateway", enabled: false, runtimeActive: false })
    }));
    const disabledSettings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(disabledSettings).not.toContain("team-gateway:");
    expect(disabledSettings).toContain("provider: deepseek-official");
    expect(readFileSync(join(dshHome, ".credentials.yaml"), "utf8")).toContain("sk-private");
    const deskState = JSON.parse(readFileSync(join(dshHome, ".dsh-desk-providers.json"), "utf8")) as {
      disabledProviders: Record<string, { profile: { baseURL?: string } }>;
    };
    expect(deskState.disabledProviders["team-gateway"]?.profile.baseURL).toBe("https://gateway.example/v1");

    const enabled = await setDshProviderEnabled("team-gateway", true, { dshHome });
    expect(enabled).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({ id: "team-gateway", enabled: true })
    }));
    const enabledSettings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(enabledSettings).toContain("team-gateway:");
    expect(enabledSettings).toContain("baseURL: https://gateway.example/v1");
    const restoredState = JSON.parse(readFileSync(join(dshHome, ".dsh-desk-providers.json"), "utf8")) as {
      disabledProviders: Record<string, unknown>;
    };
    expect(restoredState.disabledProviders).not.toHaveProperty("team-gateway");
  });

  it("disables the official adapter through the shared Cordis patch", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "cordis.patch.yml"), [
      "# keep this user patch",
      "- id: session-telemetry-otel",
      "  disabled: true",
      "- id: llm-deepseek",
      "  disabled: false",
      "  config:",
      "    thinking: enabled",
      ""
    ].join("\n"));
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });

    const disabled = await setDshProviderEnabled("deepseek-official", false, { dshHome });
    expect(disabled).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({ id: "deepseek-official", enabled: false, runtimeActive: false })
    }));
    const disabledPatch = readFileSync(join(dshHome, "cordis.patch.yml"), "utf8");
    expect(disabledPatch).toContain("# keep this user patch");
    expect(disabledPatch).toContain("id: session-telemetry-otel");
    expect(disabledPatch).toContain("thinking: enabled");
    expect(disabledPatch).toMatch(/id: llm-deepseek[\s\S]*disabled: true/);
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).toContain("provider: team-gateway");

    const enabled = await setDshProviderEnabled("deepseek-official", true, { dshHome });
    expect(enabled).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({ id: "deepseek-official", enabled: true })
    }));
    expect(readFileSync(join(dshHome, "cordis.patch.yml"), "utf8")).toMatch(/id: llm-deepseek[\s\S]*disabled: false/);
  });

  it("rejects disabling the default provider when no usable fallback exists", async () => {
    const dshHome = home();
    const result = await setDshProviderEnabled("deepseek-official", false, { dshHome });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining("no other enabled provider")
    }));
    expect((await listDshProviders({ dshHome })).providers[0]).toEqual(expect.objectContaining({
      id: "deepseek-official",
      enabled: true,
      isDefault: true
    }));
  });

  it("skips enabled providers without usable models when selecting a fallback", async () => {
    const dshHome = home();
    await saveDshProvider({ id: "empty-catalog", name: "Empty", inheritModels: true, catalogProvider: true }, { dshHome });
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });
    await reorderDshProviders(["empty-catalog", "team-gateway", "deepseek-official"], { dshHome });

    expect((await setDshProviderEnabled("deepseek-official", false, { dshHome })).ok).toBe(true);
    expect(await listDshProviders({ dshHome })).toEqual(expect.objectContaining({
      defaultProvider: "team-gateway",
      defaultModel: "team-model"
    }));
  });

  it("edits a disabled provider without enabling it", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://old.example/v1",
      protocol: "openai-completions",
      models: [{ id: "old-model" }]
    }, { dshHome });
    await setDshProviderEnabled("team-gateway", false, { dshHome });

    const saved = await saveDshProvider({
      id: "team-gateway",
      name: "Dormant Gateway",
      baseUrl: "https://new.example/v1",
      protocol: "openai-responses",
      models: [{ id: "new-model" }],
      enabled: false
    }, { dshHome });

    expect(saved).toEqual(expect.objectContaining({
      ok: true,
      provider: expect.objectContaining({
        name: "Dormant Gateway",
        baseUrl: "https://new.example/v1",
        protocol: "openai-responses",
        enabled: false
      })
    }));
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).not.toContain("team-gateway:");
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
      baseUrl: "https://stale.example/v1",
      protocol: "openai-completions",
      models: [{ id: "stale-model" }],
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

  it("allows a catalog route to replace the built-in model list explicitly", async () => {
    const dshHome = home();
    const result = await saveDshProvider({
      id: "openai",
      name: "OpenAI",
      inheritModels: false,
      catalogProvider: true,
      models: [{ id: "gpt-5.6-sol", reasoningEfforts: { off: null, high: "high", max: "ultimate" } }]
    }, { dshHome });

    expect(result.ok).toBe(true);
    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).toContain("models:");
    expect(settings).toContain("id: gpt-5.6-sol");
    expect(settings).toContain("max: ultimate");
    expect(result.provider).toEqual(expect.objectContaining({
      id: "openai",
      modelsInherited: false,
      models: [expect.objectContaining({ id: "gpt-5.6-sol" })]
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
          { id: "openai", name: "OpenAI", models: [{
            id: "gpt-runtime",
            name: "Runtime GPT",
            reasoning: {
              efforts: [
                { id: "off", name: "Off" },
                { id: "high", name: "High" },
                { id: "max", name: "Max" }
              ],
              defaultEffort: "high"
            }
          }] }
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
      models: [{
        id: "gpt-runtime",
        name: "Runtime GPT",
        reasoning: {
          efforts: [
            { id: "off", name: "Off" },
            { id: "high", name: "High" },
            { id: "max", name: "Max" }
          ],
          defaultEffort: "high"
        }
      }]
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

  it("keeps a duplicated provider credential after deleting its source", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "beta",
      name: "Beta",
      baseUrl: "https://beta.example/v1",
      protocol: "openai-completions",
      apiKey: "sk-beta",
      models: [{ id: "beta-model" }]
    }, { dshHome });

    expect((await duplicateDshProvider("beta", { dshHome })).provider).toEqual(expect.objectContaining({
      id: "beta-copy",
      credentialRef: deriveDshCredentialRef("beta-copy"),
      hasCredential: true
    }));
    expect((await deleteDshProvider("beta", { dshHome })).ok).toBe(true);
    expect((await listDshProviders({ dshHome })).providers).toContainEqual(expect.objectContaining({
      id: "beta-copy",
      hasCredential: true
    }));
    const credentials = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
    expect(credentials).toContain(`${deriveDshCredentialRef("beta-copy")}: sk-beta`);
    expect(credentials).not.toContain(`${deriveDshCredentialRef("beta")}:`);
  });

  it("preserves an existing provider without reasoning declarations on a no-op save", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "llm-pi-ai:",
      "  providers:",
      "    legacy-gateway:",
      "      displayName: Legacy",
      "      api: openai-completions",
      "      baseURL: https://legacy.example/v1",
      "      models:",
      "        - id: legacy-model",
      ""
    ].join("\n"));

    expect((await saveDshProvider({
      id: "legacy-gateway",
      name: "Legacy",
      baseUrl: "https://legacy.example/v1",
      protocol: "openai-completions",
      models: [{ id: "legacy-model" }]
    }, { dshHome })).ok).toBe(true);

    const settings = readFileSync(join(dshHome, "settings.yaml"), "utf8");
    expect(settings).not.toContain("reasoning: high");
    expect(settings).not.toContain("reasoningEfforts");
  });

  it("clears optional provider metadata when the editor submits empty values", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }],
      notes: "Internal route",
      websiteUrl: "https://example.com",
      apiKeyUrl: "https://example.com/key",
      icon: "server",
      iconColor: "#123456"
    }, { dshHome });

    await saveDshProvider({
      id: "team-gateway",
      name: "Team",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }],
      notes: "",
      websiteUrl: "",
      apiKeyUrl: "",
      icon: "",
      iconColor: ""
    }, { dshHome });

    const provider = (await listDshProviders({ dshHome })).providers.find(item => item.id === "team-gateway");
    expect(provider).not.toHaveProperty("notes");
    expect(provider).not.toHaveProperty("websiteUrl");
    expect(provider).not.toHaveProperty("apiKeyUrl");
    expect(provider).not.toHaveProperty("icon");
    expect(provider).not.toHaveProperty("iconColor");
  });

  it("uses the target provider's first model when switching to an inherited catalog route", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: previous-route",
      "  model: current-unlisted-model",
      ""
    ].join("\n"));
    await saveDshProvider({ id: "openai", name: "OpenAI", inheritModels: true, catalogProvider: true }, { dshHome });

    const runtimeOptions = {
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: runtimeFetch({
        "llm.providers": { providers: [{ provider: "openai", displayName: "OpenAI", active: true, declared: false }] },
        "llm.models": { groups: [{
          id: "openai",
          name: "OpenAI",
          models: [{ id: "first-runtime-model" }, { id: "second-runtime-model" }]
        }] }
      })
    };
    expect(await switchDshProvider("openai", runtimeOptions)).toEqual({
      ok: true,
      provider: "openai",
      model: "first-runtime-model"
    });
  });

  it("updates reusable blank sessions without changing completed sessions", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      reasoningDefault: "medium",
      models: [{
        id: "team-model",
        reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }
      }]
    }, { dshHome });
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
    const runtimeOptions = {
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: Record<string, unknown> };
        requests.push({ method: request.method, payload: request.payload });
        const value = request.method === "llm.providers"
          ? { providers: [{ provider: "team-gateway", displayName: "Team Gateway", active: true }] }
          : request.method === "llm.models"
            ? { groups: [{ id: "team-gateway", name: "Team Gateway", models: [{ id: "team-model" }] }] }
            : request.method === "session.list"
              ? { items: [
                { sessionId: "blank-session", blank: true },
                { sessionId: "completed-session", blank: false }
              ] }
              : { selected: request.payload };
        return new Response(JSON.stringify({ rpcId: request.rpcId, result: { ok: true, value } }), { status: 200 });
      }) as typeof fetch
    };

    await expect(switchDshProvider("team-gateway", runtimeOptions)).resolves.toEqual({
      ok: true,
      provider: "team-gateway",
      model: "team-model"
    });
    expect(requests.filter(request => request.method === "session.selectModel")).toEqual([{
      method: "session.selectModel",
      payload: { sessionId: "blank-session", provider: "team-gateway", model: "team-model", reasoningEffort: "medium" }
    }]);
    expect(readFileSync(join(dshHome, "settings.yaml"), "utf8")).toContain("reasoningEffort: medium");
  });

  it("accepts the official adapter reasoning default when switching blank sessions", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });
    await switchDshProvider("team-gateway", { dshHome });
    const runtime = recordedRuntime({
      providers: [
        { provider: "deepseek-official", displayName: "DeepSeek", active: true },
        { provider: "team-gateway", displayName: "Team Gateway", active: true }
      ],
      groups: [{ id: "team-gateway", name: "Team Gateway", models: [{ id: "team-model" }] }],
      sessions: [{ sessionId: "blank-session", blank: true }],
      select: payload => ({ selected: { ...payload, reasoningEffort: "high" } })
    });

    const result = await switchDshProvider("deepseek-official", {
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: runtime.runtimeFetchImpl
    });

    expect(result).toEqual({
      ok: true,
      provider: "deepseek-official",
      model: "deepseek-v4-flash"
    });
    expect(runtime.requests.filter(request => request.method === "session.selectModel")).toEqual([{
      method: "session.selectModel",
      payload: { sessionId: "blank-session", provider: "deepseek-official", model: "deepseek-v4-flash" }
    }]);
  });

  it("keeps the saved default when a blank session cannot be synchronized", async () => {
    const dshHome = home();
    await saveDshProvider({
      id: "team-gateway",
      name: "Team Gateway",
      baseUrl: "https://gateway.example/v1",
      protocol: "openai-completions",
      models: [{ id: "team-model" }]
    }, { dshHome });
    const runtimeOptions = {
      dshHome,
      runtimeUrl: "http://dsh.test",
      runtimeFetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
        const value = request.method === "llm.providers"
          ? { providers: [{ provider: "team-gateway", displayName: "Team Gateway", active: true }] }
          : request.method === "llm.models"
            ? { groups: [{ id: "team-gateway", name: "Team Gateway", models: [{ id: "team-model" }] }] }
            : request.method === "session.list"
              ? { items: [{ sessionId: "blank-session", blank: true }] }
              : { selected: { provider: "team-gateway", model: "team-model" } };
        if (request.method === "session.selectModel") {
          return new Response(JSON.stringify({ rpcId: request.rpcId, result: { ok: false, error: { message: "session unavailable" } } }), { status: 200 });
        }
        return new Response(JSON.stringify({ rpcId: request.rpcId, result: { ok: true, value } }), { status: 200 });
      }) as typeof fetch
    };

    await expect(switchDshProvider("team-gateway", runtimeOptions)).resolves.toEqual({
      ok: true,
      provider: "team-gateway",
      model: "team-model",
      sessionSyncFailed: true
    });
    expect(await listDshProviders({ dshHome })).toEqual(expect.objectContaining({
      defaultProvider: "team-gateway",
      defaultModel: "team-model"
    }));
  });

  it("does not reuse another provider's model when the target has no models", async () => {
    const dshHome = home();
    writeFileSync(join(dshHome, "settings.yaml"), [
      "agent-default-model:",
      "  provider: deepseek-official",
      "  model: deepseek-v4-flash",
      "llm-pi-ai:",
      "  providers:",
      "    empty-route:",
      "      displayName: Empty",
      "      models: []",
      ""
    ].join("\n"));

    expect(await switchDshProvider("empty-route", { dshHome })).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining("no available models")
    }));
    expect(await listDshProviders({ dshHome })).toEqual(expect.objectContaining({
      defaultProvider: "deepseek-official",
      defaultModel: "deepseek-v4-flash"
    }));
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
    expect(await switchDshProvider("team-gateway", { dshHome })).toEqual({
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

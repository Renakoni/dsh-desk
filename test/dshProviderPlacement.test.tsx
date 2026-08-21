// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewSection } from "../src/renderer/clawd-migrated/features/overview/OverviewSection";
import { SettingsSection } from "../src/renderer/clawd-migrated/features/settings/SettingsSection";
import { ProviderEditPanel } from "../src/renderer/clawd-migrated/components/dsh-routing/ProviderEditPanel";
import { RoutingToaster } from "../src/renderer/clawd-migrated/components/dsh-routing/RoutingToaster";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultSettings } from "../src/renderer/shared/events";

beforeEach(() => {
  Reflect.set(window, "companion", {
    listDshProviders: vi.fn(async () => ({
      ok: true,
      providers: [{
        id: "deepseek-official",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        protocol: "deepseek-chat-completions",
        models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
        defaultModel: "deepseek-v4-flash",
        modelsInherited: true,
        catalogProvider: true,
        enabled: true,
        runtimeActive: true,
        icon: "deepseek",
        iconColor: "#4D6BFE",
        isDefault: true,
        isOfficial: true,
        apiKey: "sk-visible",
        hasCredential: true
      }],
      catalogProviders: [],
      runtimeAvailable: true,
      defaultProvider: "deepseek-official",
      defaultModel: "deepseek-v4-flash"
    })),
    probeDshProvider: vi.fn(async () => ({ ok: true, latencyMs: 180, status: 200 }))
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

describe("DSH model routing placement", () => {
  it("keeps the connection recheck icon visible for a complete turn", () => {
    const onHookRecheck = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <SettingsSection
          settings={defaultSettings}
          updateSettings={vi.fn()}
          connection={{ serverListening: false, error: null }}
          now={Date.now()}
          hookStatus={null}
          onHookRecheck={onHookRecheck}
          activeSettingsSubsection="general"
          setActiveSettingsSubsection={vi.fn()}
          sectionContentRef={React.createRef<HTMLDivElement>()}
          locale="en"
          setLocale={vi.fn()}
          appVersion="0.1.0"
          updateStatus={{}}
          checkingUpdate={false}
          handleCheckUpdate={vi.fn()}
        />
      </I18nProvider>
    );

    const button = screen.getByRole("button", { name: "Recheck" });
    fireEvent.click(button);
    expect(onHookRecheck).toHaveBeenCalledTimes(1);
    expect(button.classList.contains("is-checking")).toBe(true);
    expect(button.querySelector(".spin")).not.toBeNull();

    expect(button.querySelector(".spin")).not.toBeNull();
    fireEvent.animationEnd(button.querySelector(".spin")!);
    expect(button.querySelector(".spin")).toBeNull();
  });

  it("renders routing before connection on Overview", async () => {
    const view = render(
      <I18nProvider initialLocale="en">
        <OverviewSection
          settings={{ hideSensitiveContent: false }}
          connection={{ serverListening: false, error: null }}
          hookStatus={{
            installed: false,
            configExists: false,
            configReadError: false,
            hookCount: 0,
            requiredCount: 2,
            missingEvents: ["web", "headless"],
            commandMatches: false,
            settingsPath: "C:/users/test/.dsh/profiles",
            bundle: { expectedPath: "C:/app/dsh-desk-plugin.tgz", exists: true },
            npxAvailable: true,
            profiles: []
          }}
        />
      </I18nProvider>
    );

    expect(Array.from(view.container.querySelectorAll("h2, h3"), heading => heading.textContent).slice(0, 2)).toEqual([
      "DSH model routing",
      "DeepSeek Harness connection"
    ]);
    expect(await screen.findByText("1 providers · 1 enabled · Default DeepSeek")).toBeTruthy();
    expect(view.container.querySelector(".ccs-brand-icon:not(.ccs-brand-icon-fallback)")).toBeTruthy();
    expect(screen.getByText("DSH plugin status")).toBeTruthy();
    expect(screen.getByRole("button", { name: "One-click install" })).toBeTruthy();
    expect(screen.queryByText("Install DSH Desk into the DSH Web and Headless profiles.")).toBeNull();
  });

  it("shows latency without exposing the HTTP status for card connectivity checks", async () => {
    render(
      <I18nProvider initialLocale="en">
        <RoutingToaster />
        <OverviewSection
          settings={{ hideSensitiveContent: false }}
          connection={{ serverListening: false, error: null }}
          hookStatus={null}
        />
      </I18nProvider>
    );

    vi.mocked(window.companion.probeDshProvider).mockResolvedValueOnce({ ok: true, latencyMs: 600, status: 404 });
    fireEvent.click(await screen.findByRole("button", { name: "Connectivity check" }));
    await waitFor(() => expect(document.querySelector("[data-sonner-toast]")?.textContent).toContain("600 ms"));
    const toast = document.querySelector("[data-sonner-toast]");
    expect(toast?.classList.contains("dsh-probe-toast")).toBe(true);
    expect(toast?.querySelector("[data-title]")?.textContent).toBe("DeepSeek");
    expect(toast?.querySelector("[data-description]")?.textContent).toBe("Reachable · 600 ms");
    expect(toast?.textContent).not.toContain("HTTP");
    expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
  });

  it("does not expose a Models subsection under Settings", () => {
    render(
      <I18nProvider initialLocale="en">
        <SettingsSection
          settings={defaultSettings}
          updateSettings={vi.fn()}
          connection={{ serverListening: false, error: null }}
          now={Date.now()}
          hookStatus={null}
          activeSettingsSubsection="general"
          setActiveSettingsSubsection={vi.fn()}
          sectionContentRef={React.createRef<HTMLDivElement>()}
          locale="en"
          setLocale={vi.fn()}
          appVersion="0.0.0"
          updateStatus={{}}
          checkingUpdate={false}
          handleCheckUpdate={vi.fn()}
        />
      </I18nProvider>
    );

    expect(screen.queryByRole("button", { name: "Models" })).toBeNull();
  });

  it("uses the DSH Desk alarm-clock icon on the About page", () => {
    const view = render(
      <I18nProvider initialLocale="en">
        <SettingsSection
          settings={defaultSettings}
          updateSettings={vi.fn()}
          connection={{ serverListening: false, error: null }}
          now={Date.now()}
          hookStatus={null}
          activeSettingsSubsection="about"
          setActiveSettingsSubsection={vi.fn()}
          sectionContentRef={React.createRef<HTMLDivElement>()}
          locale="en"
          setLocale={vi.fn()}
          appVersion="0.1.0"
          updateStatus={{}}
          checkingUpdate={false}
          handleCheckUpdate={vi.fn()}
        />
      </I18nProvider>
    );

    const icon = view.container.querySelector(".settings-about-app-icon") as HTMLImageElement | null;
    expect(icon?.getAttribute("src")).toContain("kuaclock.png");
    expect(screen.getByText("v0.1.0")).toBeTruthy();
  });

  it("keeps internal route details out of the add-provider form", async () => {
    render(
      <I18nProvider initialLocale="en">
        <OverviewSection
          settings={{ hideSensitiveContent: false }}
          connection={{ serverListening: false, error: null }}
          hookStatus={null}
        />
      </I18nProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Add Provider/i }));
    expect(await screen.findByRole("heading", { name: /Add Provider/i })).toBeTruthy();
    expect(screen.getByText("PatewayAI")).toBeTruthy();
    expect(screen.queryByText("Provider ID")).toBeNull();
    expect(screen.queryByText("Default model")).toBeNull();
    expect(screen.queryByText("Upstream protocol")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced Options" }));
    expect(screen.getByRole("switch", { name: "Enable reasoning effort selection" }).getAttribute("aria-checked")).toBe("false");
  });

  it("keeps model compatibility settings when submitting provider edits", () => {
    const onSave = vi.fn();
    const compat = {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
      chatTemplateKwargs: {
        enable_thinking: { $var: "thinking.enabled", omitWhenOff: false }
      }
    };
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          open
          mode="edit"
          provider={{
            id: "manual-gateway",
            name: "Manual Gateway",
            baseUrl: "https://gateway.example/v1",
            protocol: "openai-completions",
            models: [{ id: "reasoning-model", compat }],
            inheritModels: false,
            catalogProvider: false,
            enabled: true
          }}
          catalogProviders={[]}
          onSave={onSave}
          onClose={vi.fn()}
          onProbe={vi.fn(async () => ({ ok: true }))}
        />
      </I18nProvider>
    );

    fireEvent.change(screen.getByDisplayValue("Manual Gateway"), { target: { value: "Manual Gateway renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: "Manual Gateway renamed",
      models: [expect.objectContaining({ id: "reasoning-model", compat })]
    }), "manual-gateway");
  });

  it("enables the common reasoning efforts for every model on a manual route", () => {
    const onSave = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          open
          mode="edit"
          provider={{
            id: "manual-gateway",
            name: "Manual Gateway",
            baseUrl: "https://gateway.example/v1",
            protocol: "openai-completions",
            models: [
              { id: "reasoning-model" },
              { id: "plain-model" }
            ],
            inheritModels: false,
            catalogProvider: false,
            enabled: true
          }}
          catalogProviders={[]}
          onSave={onSave}
          onClose={vi.fn()}
          onProbe={vi.fn(async () => ({ ok: true }))}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced Options" }));
    const reasoningSwitch = screen.getByRole("switch", { name: "Enable reasoning effort selection" });
    expect(reasoningSwitch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(reasoningSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      reasoningDefault: "medium",
      models: [
        expect.objectContaining({
          id: "reasoning-model",
          reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }
        }),
        expect.objectContaining({
          id: "plain-model",
          reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }
        })
      ]
    }), "manual-gateway");
  });

  it("removes reasoning metadata from every model when the route switch is disabled", () => {
    const onSave = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          open
          mode="edit"
          provider={{
            id: "manual-gateway",
            name: "Manual Gateway",
            baseUrl: "https://gateway.example/v1",
            protocol: "openai-responses",
            models: [
              { id: "gpt-5.6", reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } },
              { id: "gpt-5.5", reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } }
            ],
            inheritModels: false,
            catalogProvider: false,
            enabled: true,
            reasoningDefault: "medium"
          }}
          catalogProviders={[]}
          onSave={onSave}
          onClose={vi.fn()}
          onProbe={vi.fn(async () => ({ ok: true }))}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced Options" }));
    const reasoningSwitch = screen.getByRole("switch", { name: "Enable reasoning effort selection" });
    expect(reasoningSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(reasoningSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const draft = onSave.mock.calls[0][0];
    expect(draft.reasoningDefault).toBeUndefined();
    expect(draft.models).toEqual([
      expect.not.objectContaining({ reasoningEfforts: expect.anything() }),
      expect.not.objectContaining({ reasoningEfforts: expect.anything() })
    ]);
  });

  it("shows runtime reasoning levels for a built-in DSH catalog", () => {
    const onSave = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          open
          mode="edit"
          provider={{
            id: "openai",
            name: "OpenAI",
            models: [{
              id: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              reasoning: {
                efforts: [
                  { id: "off", name: "Off" },
                  { id: "low", name: "Low" },
                  { id: "high", name: "High" },
                  { id: "max", name: "Max" }
                ],
                defaultEffort: "high"
              }
            }],
            inheritModels: true,
            catalogProvider: true,
            enabled: true
          }}
          catalogProviders={[]}
          onSave={onSave}
          onClose={vi.fn()}
          onProbe={vi.fn(async () => ({ ok: true }))}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced Options" }));
    expect(screen.getByRole("radio", { name: "DSH built-in models" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("switch", { name: "Enable reasoning effort selection" })).toBeNull();
    expect(screen.getByText("GPT-5.6 Sol")).toBeTruthy();
    expect(screen.getByText("Off · Low · High · Max")).toBeTruthy();
    expect(screen.getByText("Default: High")).toBeTruthy();
  });

  it("does not expose reasoning controls for the official DeepSeek adapter", () => {
    const onSave = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          open
          mode="edit"
          provider={{
            id: "deepseek-official",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com",
            protocol: "deepseek-chat-completions",
            models: [{ id: "deepseek-v4-flash" }],
            inheritModels: true,
            catalogProvider: true,
            enabled: true
          }}
          catalogProviders={[]}
          onSave={onSave}
          onClose={vi.fn()}
          onProbe={vi.fn(async () => ({ ok: true }))}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced Options" }));
    expect(screen.queryByRole("switch", { name: "Enable reasoning effort selection" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Default reasoning effort" })).toBeNull();
    expect(screen.getByText("No reasoning levels")).toBeTruthy();
  });

  it("reveals the stored key and classifies connection feedback", async () => {
    render(
      <I18nProvider initialLocale="en">
        <OverviewSection
          settings={{ hideSensitiveContent: false }}
          connection={{ serverListening: false, error: null }}
          hookStatus={null}
        />
      </I18nProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const apiKey = screen.getAllByLabelText("API Key").find(input => (input as HTMLInputElement).value === "sk-visible") as HTMLInputElement;
    expect(apiKey).toBeTruthy();
    expect(apiKey.value).toBe("sk-visible");
    expect(apiKey.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show API Key" }));
    expect(apiKey.type).toBe("text");

    const speedTest = () => screen.getAllByRole("button", { name: "Test" }).find(button => !(button as HTMLButtonElement).disabled) as HTMLButtonElement;
    fireEvent.click(speedTest());
    await waitFor(() => expect(document.querySelector(".dsh-probe-result.info")?.textContent).toContain("180 ms"));
    expect(document.querySelector(".dsh-probe-result.info")?.textContent).not.toContain("HTTP");

    vi.mocked(window.companion.probeDshProvider).mockResolvedValueOnce({ ok: true, latencyMs: 900, status: 200 });
    fireEvent.click(speedTest());
    await waitFor(() => expect(document.querySelector(".dsh-probe-result.warning")?.textContent).toContain("900 ms"));
    expect(document.querySelector(".dsh-probe-result.warning")?.textContent).not.toContain("HTTP");

    vi.mocked(window.companion.probeDshProvider).mockResolvedValueOnce({ ok: false, error: "timeout" });
    fireEvent.click(speedTest());
    await waitFor(() => expect(document.querySelector(".dsh-probe-result.error")?.textContent).toContain("timeout"));
  });

  it("separates multi-provider enablement from the current provider", async () => {
    const setEnabled = vi.fn(async () => ({ ok: true }));
    Reflect.set(window, "companion", {
      listDshProviders: vi.fn(async () => ({
        ok: true,
        providers: [
          {
            id: "deepseek-official",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com",
            protocol: "deepseek-chat-completions",
            models: [{ id: "deepseek-v4-flash" }],
            modelsInherited: true,
            catalogProvider: true,
            enabled: true,
            runtimeActive: true,
            hasCredential: true,
            isDefault: true,
            isOfficial: true,
            icon: "deepseek",
            defaultModel: "deepseek-v4-flash"
          },
          {
            id: "team-gateway",
            name: "Team Gateway",
            baseUrl: "https://gateway.example/v1",
            protocol: "openai-completions",
            models: [{ id: "team-model" }],
            modelsInherited: false,
            catalogProvider: false,
            enabled: false,
            runtimeActive: false,
            hasCredential: true,
            isDefault: false,
            isOfficial: false
          }
        ],
        catalogProviders: [],
        runtimeAvailable: true,
        defaultProvider: "deepseek-official",
        defaultModel: "deepseek-v4-flash"
      })),
      setDshProviderEnabled: setEnabled
    });

    render(
      <I18nProvider initialLocale="en">
        <OverviewSection
          settings={{ hideSensitiveContent: false }}
          connection={{ serverListening: false, error: null }}
          hookStatus={null}
        />
      </I18nProvider>
    );

    expect(await screen.findByText("2 providers · 1 enabled · Default DeepSeek")).toBeTruthy();
    const enableButton = screen.getByRole("button", { name: "Enable" });
    fireEvent.click(enableButton);
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith("team-gateway", true));
    expect(screen.getByRole("button", { name: "Make default provider" }).hasAttribute("disabled")).toBe(true);
    const disableButtons = screen.getAllByRole("button", { name: "Disable" });
    expect(disableButtons).toHaveLength(1);
    fireEvent.click(disableButtons[0]);
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith("deepseek-official", false));
  });
});

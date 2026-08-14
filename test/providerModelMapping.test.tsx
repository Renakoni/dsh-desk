// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderEditPanel } from "../src/renderer/clawd-migrated/components/claude-routing/ProviderEditPanel";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

// Renders the real edit form (advanced options auto-open because a role model is
// set) to exercise the cc-switch model-mapping table: display name, actual model,
// and the 1M marker round-trip.

function renderPanel(env: Record<string, string>, onSave = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <ProviderEditPanel
        provider={{ id: "p1", name: "Provider 1", category: "custom", settingsConfig: { env } }}
        mode="edit"
        open
        onSave={onSave}
        onClose={vi.fn()}
      />
    </I18nProvider>
  );
  return onSave;
}

const baseEnv = { ANTHROPIC_BASE_URL: "https://api.example.test", ANTHROPIC_AUTH_TOKEN: "sk-token" };

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
  document.documentElement.setAttribute("data-theme", "light");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("provider model mapping (cc-switch parity)", () => {
  it("parses a stored [1M] marker back into a checked toggle + base model, and populates the display name", () => {
    renderPanel({
      ...baseEnv,
      ANTHROPIC_DEFAULT_SONNET_MODEL: "my-sonnet[1M]",
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "My Sonnet"
    });

    expect((screen.getByRole("textbox", { name: "Sonnet Actual Request Model" }) as HTMLInputElement).value).toBe("my-sonnet");
    expect((screen.getByRole("textbox", { name: "Sonnet Display Name" }) as HTMLInputElement).value).toBe("My Sonnet");
    expect((screen.getByRole("checkbox", { name: "Sonnet 1M" }) as HTMLInputElement).checked).toBe(true);
  });

  it("omits the 1M toggle for Haiku (no 1M context in the lineup)", () => {
    renderPanel({ ...baseEnv, ANTHROPIC_DEFAULT_HAIKU_MODEL: "my-haiku" });
    expect(screen.getByRole("checkbox", { name: "Sonnet 1M" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Haiku 1M" })).toBeNull();
  });

  it("appends the [1M] marker to the role model when the toggle is switched on", () => {
    const onSave = renderPanel({ ...baseEnv, ANTHROPIC_DEFAULT_SONNET_MODEL: "plain-sonnet" });

    const toggle = screen.getByRole("checkbox", { name: "Sonnet 1M" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.settingsConfig.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("plain-sonnet[1M]");
  });

  it("writes the display name to the *_MODEL_NAME env key on save", () => {
    const onSave = renderPanel({ ...baseEnv, ANTHROPIC_DEFAULT_OPUS_MODEL: "opus-real" });

    fireEvent.change(screen.getByRole("textbox", { name: "Opus Display Name" }), { target: { value: "Fancy Opus" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = onSave.mock.calls[0][0];
    expect(saved.settingsConfig.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBe("Fancy Opus");
    // Editing the display name must not disturb the actual model value.
    expect(saved.settingsConfig.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("opus-real");
  });

  it("fetches models with the form's base url + key and offers them as input suggestions", async () => {
    const onFetchModels = vi.fn(async () => ({ ok: true, models: ["prov-a", "prov-b"] }));
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          provider={{ id: "p1", name: "Provider 1", category: "custom", settingsConfig: { env: { ...baseEnv, ANTHROPIC_DEFAULT_SONNET_MODEL: "seed" } } }}
          mode="edit"
          open
          onSave={vi.fn()}
          onClose={vi.fn()}
          onFetchModels={onFetchModels}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fetch Models" }));
    await waitFor(() => expect(onFetchModels).toHaveBeenCalledTimes(1));
    const [payload] = onFetchModels.mock.calls[0] as unknown as [{ baseUrl?: string; apiKey?: string }];
    expect(payload).toMatchObject({ baseUrl: "https://api.example.test", apiKey: "sk-token" });

    await waitFor(() => expect(document.querySelector("datalist#claude-provider-edit-form-models")).not.toBeNull());
    const options = Array.from(document.querySelectorAll("datalist#claude-provider-edit-form-models option")).map(node => (node as HTMLOptionElement).value);
    expect(options).toEqual(["prov-a", "prov-b"]);
    // A model input bound to a datalist reports role "combobox", not "textbox".
    expect((screen.getByRole("combobox", { name: "Sonnet Actual Request Model" }) as HTMLInputElement).getAttribute("list")).toBe("claude-provider-edit-form-models");
  });

  it("surfaces a localized error when the fetch fails", async () => {
    const onFetchModels = vi.fn(async () => ({ ok: false, models: [], errorCode: "auth" as const }));
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          provider={{ id: "p1", name: "Provider 1", category: "custom", settingsConfig: { env: { ...baseEnv, ANTHROPIC_DEFAULT_SONNET_MODEL: "seed" } } }}
          mode="edit"
          open
          onSave={vi.fn()}
          onClose={vi.fn()}
          onFetchModels={onFetchModels}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fetch Models" }));
    await screen.findByText("Authentication failed — check the API key");
  });

  it("Quick Set propagates the seed to every role, keeps [1M] except Haiku, and fills display names", () => {
    const onSave = renderPanel({ ...baseEnv, ANTHROPIC_MODEL: "seed-model[1M]" });
    fireEvent.click(screen.getByRole("button", { name: "Quick Set" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const env = onSave.mock.calls[0][0].settingsConfig.env;
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("seed-model[1M]");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("seed-model[1M]");
    expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("seed-model[1M]");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("seed-model");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBe("seed-model");
  });

  it("disables Quick Set when no model is entered anywhere", () => {
    renderPanel({ ...baseEnv, ANTHROPIC_DEFAULT_SONNET_MODEL: "x" });
    // Clear the one model so nothing remains to propagate.
    fireEvent.change(screen.getByRole("textbox", { name: "Sonnet Actual Request Model" }), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Quick Set" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("config quick-toggles write the exact cc-switch config keys", () => {
    const onSave = renderPanel(baseEnv);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Tool Search" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Max Effort Thinking" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide AI Attribution" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const config = onSave.mock.calls[0][0].settingsConfig;
    expect(config.env.ENABLE_TOOL_SEARCH).toBe("true");
    expect(config.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
    expect(config.attribution).toEqual({ commit: "", pr: "" });
  });

  it("unchecking a config toggle deletes its key", () => {
    const onSave = renderPanel({ ...baseEnv, ENABLE_TOOL_SEARCH: "true" });
    const toggle = screen.getByRole("checkbox", { name: "Enable Tool Search" }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0][0].settingsConfig.env.ENABLE_TOOL_SEARCH).toBeUndefined();
  });

  it("disables Fetch Models for an unsupported API format and explains why", () => {
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          provider={{ id: "p1", name: "Provider 1", category: "custom", meta: { apiFormat: "gemini_native" }, settingsConfig: { env: { ...baseEnv, ANTHROPIC_DEFAULT_SONNET_MODEL: "seed" } } }}
          mode="edit"
          open
          onSave={vi.fn()}
          onClose={vi.fn()}
          onFetchModels={vi.fn()}
        />
      </I18nProvider>
    );
    expect((screen.getByRole("button", { name: "Fetch Models" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This API format doesn't support fetching a model list")).toBeTruthy();
  });

  it("clears stale model suggestions when the endpoint changes", async () => {
    const onFetchModels = vi.fn(async () => ({ ok: true, models: ["prov-a"] }));
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          provider={{ id: "p1", name: "Provider 1", category: "custom", settingsConfig: { env: { ...baseEnv, ANTHROPIC_DEFAULT_SONNET_MODEL: "seed" } } }}
          mode="edit"
          open
          onSave={vi.fn()}
          onClose={vi.fn()}
          onFetchModels={onFetchModels}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fetch Models" }));
    await waitFor(() => expect(document.querySelector("datalist#claude-provider-edit-form-models")).not.toBeNull());

    fireEvent.change(screen.getByRole("textbox", { name: "API Endpoint" }), { target: { value: "https://api.other.test" } });
    await waitFor(() => expect(document.querySelector("datalist#claude-provider-edit-form-models")).toBeNull());
  });
});

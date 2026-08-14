// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeRoutingPanel } from "../src/renderer/clawd-migrated/components/claude-routing/ClaudeRoutingPanel";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

// Renders the REAL ProviderEditPanel (not mocked) so it exercises the actual
// mount cost, the prewarm, and the close/reopen lifecycle — the things the
// mocked performance test cannot see.

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
  Reflect.set(window, "companion", {
    listClaudeProviders: vi.fn(async () => ({
      ok: true,
      source: "local",
      providers: [
        { id: "p1", name: "Provider 1", category: "custom", sortIndex: 0, settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://p1.example.test" } } }
      ],
      currentId: "p1",
      hasCommonConfig: false
    })),
    onCcSwitchChanged: vi.fn(() => vi.fn()),
    reorderClaudeProviders: vi.fn(async () => ({ ok: true })),
    saveClaudeProvider: vi.fn(async () => ({ ok: true })),
    deleteClaudeProvider: vi.fn(),
    duplicateClaudeProvider: vi.fn(),
    switchClaudeProvider: vi.fn(),
    testClaudeProvider: vi.fn(),
    pickTerminalDirectory: vi.fn(),
    openClaudeProviderTerminal: vi.fn(),
    openExternal: vi.fn()
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

const visiblePanel = () => document.querySelector(".ccs-fullscreen-panel:not(.ccs-fullscreen-hidden)");
const apiKeyInput = () => visiblePanel()?.querySelector('input[type="password"]') as HTMLInputElement | null | undefined;

describe("Claude provider Add form lifecycle", () => {
  it("prewarms the Add form so opening pays no mount cost", async () => {
    render(
      <I18nProvider initialLocale="en">
        <ClaudeRoutingPanel />
      </I18nProvider>
    );
    await screen.findByText("Provider 1");

    // The Add form is mounted but hidden before the user ever clicks Add — the
    // heavy preset grid is already in the DOM, so opening is just a fade.
    const addPanel = document.querySelector(".ccs-fullscreen-panel");
    expect(addPanel).not.toBeNull();
    expect(addPanel?.classList.contains("ccs-fullscreen-hidden")).toBe(true);
    expect(addPanel?.querySelector(".ccs-preset-grid")).not.toBeNull();
    // ...and it is `inert` while hidden, so its ~60 preset buttons and every
    // form field stay out of the keyboard tab order until the form is opened.
    expect(addPanel?.hasAttribute("inert")).toBe(true);
  });

  it("leaves the tab order on open and returns focus to the Add trigger on close", async () => {
    render(
      <I18nProvider initialLocale="en">
        <ClaudeRoutingPanel />
      </I18nProvider>
    );
    await screen.findByText("Provider 1");

    // The stable outer panel node persists across open/close (only its content
    // is rebuilt), so we can watch its `inert` state through the whole cycle.
    const panel = document.querySelector(".ccs-fullscreen-panel") as HTMLElement;
    expect(panel.hasAttribute("inert")).toBe(true);

    // Open from a focused Add trigger — the panel becomes interactive.
    const addButton = screen.getByRole("button", { name: /Add provider/i }) as HTMLButtonElement;
    addButton.focus();
    fireEvent.click(addButton);
    await waitFor(() => expect(visiblePanel()).not.toBeNull());
    expect(panel.hasAttribute("inert")).toBe(false);

    // Move focus into the form, then cancel.
    const input = apiKeyInput()!;
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.click(visiblePanel()!.querySelector(".ccs-panel-cancel") as HTMLButtonElement);

    // Focus is handed back to the Add trigger, and the hidden form goes inert
    // again instead of stranding the keyboard user on <body>.
    await waitFor(() => expect(document.activeElement).toBe(addButton));
    await waitFor(() => expect(panel.hasAttribute("inert")).toBe(true));
  });

  it("gives a fresh form on reopen after cancel (no stale input)", async () => {
    render(
      <I18nProvider initialLocale="en">
        <ClaudeRoutingPanel />
      </I18nProvider>
    );
    await screen.findByText("Provider 1");

    // Open, type a value, then cancel.
    fireEvent.click(screen.getByRole("button", { name: /Add provider/i }));
    await waitFor(() => expect(apiKeyInput()).toBeTruthy());
    const input = apiKeyInput()!;
    fireEvent.change(input, { target: { value: "cancelled-secret" } });
    expect(apiKeyInput()!.value).toBe("cancelled-secret");

    const cancel = visiblePanel()!.querySelector(".ccs-panel-cancel") as HTMLButtonElement;
    fireEvent.click(cancel);

    // Let the fade-out + post-close rebuild run.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });

    // Reopen — the rebuilt form must be empty, not the cancelled value.
    fireEvent.click(screen.getByRole("button", { name: /Add provider/i }));
    await waitFor(() => expect(visiblePanel()).not.toBeNull());
    await waitFor(() => expect(apiKeyInput()!.value).toBe(""));
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const providerIconRender = vi.hoisted(() => vi.fn());
const providerEditorRender = vi.hoisted(() => vi.fn());

vi.mock("../src/renderer/clawd-migrated/components/claude-routing/ProviderIcon", () => ({
  ProviderIcon: (props: { name: string }) => {
    providerIconRender(props.name);
    return null;
  }
}));

vi.mock("../src/renderer/clawd-migrated/components/claude-routing/ProviderEditPanel", () => ({
  PANEL_EXIT_MS: 220,
  ProviderEditPanel: (props: unknown) => {
    providerEditorRender(props);
    return null;
  }
}));

import { ClaudeRoutingPanel } from "../src/renderer/clawd-migrated/components/claude-routing/ClaudeRoutingPanel";

afterEach(() => {
  cleanup();
  providerIconRender.mockReset();
  providerEditorRender.mockReset();
  Reflect.deleteProperty(window, "companion");
});

describe("Claude routing render isolation", () => {
  it("opens the provider editor without re-rendering the sortable provider cards", async () => {
    const providers = Array.from({ length: 40 }, (_, index) => ({
      id: `provider-${index}`,
      name: `Provider ${index}`,
      category: "custom",
      sortIndex: index,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: `https://provider-${index}.example.test` } }
    }));
    Reflect.set(window, "companion", {
      listClaudeProviders: vi.fn(async () => ({
        ok: true,
        source: "local",
        providers,
        currentId: providers[0].id,
        hasCommonConfig: false
      })),
      onCcSwitchChanged: vi.fn(() => vi.fn()),
      reorderClaudeProviders: vi.fn(async () => ({ ok: true })),
      saveClaudeProvider: vi.fn(),
      deleteClaudeProvider: vi.fn(),
      duplicateClaudeProvider: vi.fn(),
      switchClaudeProvider: vi.fn(),
      testClaudeProvider: vi.fn(),
      pickTerminalDirectory: vi.fn(),
      openClaudeProviderTerminal: vi.fn()
    });

    render(
      <I18nProvider initialLocale="en">
        <ClaudeRoutingPanel />
      </I18nProvider>
    );

    await screen.findByText("Provider 39");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    // The add editor is prewarmed (always rendered, `open` toggles visibility);
    // the edit editor mounts on demand. Pick the add editor's latest props.
    const lastAddProps = () =>
      providerEditorRender.mock.calls
        .map(call => call[0])
        .filter((props: { mode: string }) => props.mode === "add")
        .at(-1) as { open: boolean; onClose: () => void } | undefined;
    expect(lastAddProps()).toEqual(expect.objectContaining({ mode: "add", open: false }));
    providerIconRender.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Add provider/i }));
    await waitFor(() => expect(lastAddProps()).toEqual(expect.objectContaining({ mode: "add", open: true })));

    // Opening the editor must not re-render the sortable provider cards.
    expect(providerIconRender).not.toHaveBeenCalled();

    act(() => lastAddProps()!.onClose());
    await waitFor(() => expect(lastAddProps()).toEqual(expect.objectContaining({ mode: "add", open: false })));
    // Close schedules a post-fade rebuild (sessionKey bump); flush it inside act.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
  });

  it("merges a saved provider without re-reading the full provider list", async () => {
    const provider = {
      id: "provider-1",
      name: "Provider 1",
      category: "custom",
      sortIndex: 0,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://provider-1.example.test" } }
    };
    const savedProvider = {
      ...provider,
      id: "provider-2",
      name: "Provider 2",
      sortIndex: 1
    };
    const listClaudeProviders = vi.fn(async () => ({
      ok: true,
      source: "local",
      providers: [provider],
      currentId: provider.id,
      hasCommonConfig: false
    }));
    const saveClaudeProvider = vi.fn(async () => ({ ok: true, provider: savedProvider }));
    Reflect.set(window, "companion", {
      listClaudeProviders,
      onCcSwitchChanged: vi.fn(() => vi.fn()),
      reorderClaudeProviders: vi.fn(async () => ({ ok: true })),
      saveClaudeProvider,
      deleteClaudeProvider: vi.fn(),
      duplicateClaudeProvider: vi.fn(),
      switchClaudeProvider: vi.fn(),
      testClaudeProvider: vi.fn(),
      pickTerminalDirectory: vi.fn(),
      openClaudeProviderTerminal: vi.fn()
    });

    render(
      <I18nProvider initialLocale="en">
        <ClaudeRoutingPanel />
      </I18nProvider>
    );

    await screen.findByText("Provider 1");
    fireEvent.click(screen.getByRole("button", { name: /Add provider/i }));
    await waitFor(() => expect(providerEditorRender).toHaveBeenCalled());
    const editorProps = providerEditorRender.mock.calls
      .map(call => call[0])
      .filter((props: { mode: string }) => props.mode === "add")
      .at(-1) as { onSave: (provider: typeof savedProvider) => void };

    act(() => editorProps.onSave(savedProvider));

    await screen.findByText("Provider 2");
    expect(saveClaudeProvider).toHaveBeenCalledTimes(1);
    expect(listClaudeProviders).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { fireEvent, cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "codemirror";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderEditPanel } from "../src/renderer/clawd-migrated/components/claude-routing/ProviderEditPanel";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const SECRET = "sk-should-not-be-visible";

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
  document.documentElement.setAttribute("data-theme", "light");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("provider config editor", () => {
  it("shows the settings.json editor by default (cc-switch parity) with no show/hide toggle", async () => {
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          provider={{
            id: "private-provider",
            name: "Private provider",
            category: "custom",
            settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: SECRET, ANTHROPIC_BASE_URL: "https://api.example.test" } }
          }}
          mode="edit"
          open
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>
    );

    // The API Key field itself is still masked behind its own reveal toggle...
    const passwordField = screen.getByDisplayValue(SECRET) as HTMLInputElement;
    expect(passwordField.type).toBe("password");

    // ...but the raw settings.json editor is mounted on open (lazy CodeMirror
    // chunk) and shows the full config — matching cc-switch, which never gates
    // the JSON behind an eye toggle. (User-chosen: the secret is visible here.)
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
    const editor = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    expect(editor).not.toBeNull();
    if (!editor) return;
    expect(editor.state.doc.toString()).toContain(SECRET);

    // The show/hide config toggle is gone.
    expect(screen.queryByRole("button", { name: "Show config" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide config" })).toBeNull();
  });

  it.each(["ftp://api.example.test", "https://api.example.test/${ENDPOINT_ID}"])("blocks an unroutable API endpoint: %s", endpoint => {
    const onSave = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ProviderEditPanel
          provider={{
            id: "invalid-endpoint-provider",
            name: "Invalid endpoint provider",
            category: "custom",
            settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: SECRET, ANTHROPIC_BASE_URL: endpoint } }
          }}
          mode="edit"
          open
          onSave={onSave}
          onClose={vi.fn()}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("API endpoint must be a valid HTTP(S) URL without unfilled template parameters")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

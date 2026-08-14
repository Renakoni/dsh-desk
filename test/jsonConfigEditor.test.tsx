// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { EditorView } from "codemirror";
import { EditorSelection } from "@codemirror/state";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonConfigEditor } from "../src/renderer/clawd-migrated/components/claude-routing/JsonConfigEditor";

// CodeMirror defers layout measurement to requestAnimationFrame, which jsdom
// lacks; a setTimeout shim lets the view construct. The assertions below are
// on EditorState (selection, doc) and view identity — none need real layout.
function installRafShim() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
}

function liveView(container: HTMLElement): EditorView | null {
  const dom = container.querySelector(".cm-editor");
  return dom ? EditorView.findFromDOM(dom as HTMLElement) : null;
}

beforeEach(() => {
  installRafShim();
  document.documentElement.setAttribute("data-theme", "light");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("JsonConfigEditor theme flip", () => {
  it("reconfigures in place on a data-theme flip, preserving the editing context", async () => {
    const value = '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://example.com"\n  }\n}';
    const { container } = render(<JsonConfigEditor value={value} onChange={() => undefined} />);

    const view = liveView(container);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.state.facet(EditorView.darkTheme)).toBe(false);

    // Put the cursor/selection mid-document — this is the editing context a
    // full rebuild would throw away.
    view.dispatch({ selection: EditorSelection.single(10, 20) });
    expect(view.state.selection.main.anchor).toBe(10);
    expect(view.state.selection.main.head).toBe(20);

    // Flip the app theme; the component observes data-theme and must
    // reconfigure the theme compartment on the SAME view, not rebuild it.
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => expect(view.state.facet(EditorView.darkTheme)).toBe(true));

    // The facet proves the reconfiguration actually ran. A rebuild would
    // have replaced the view and reset selection to 0; the live view keeps
    // its identity, selection, and document intact.
    const after = liveView(container)!;
    expect(after).toBe(view);
    expect(after.state.selection.main.anchor).toBe(10);
    expect(after.state.selection.main.head).toBe(20);
    expect(after.state.doc.toString()).toBe(value);
  });
});

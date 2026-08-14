// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsPage } from "../src/renderer/clawd-migrated/components/sessions/SessionsPage";

const SESSION_ROW_HEIGHT = 97;

// Enough sessions that the focused row (index 30) sits well below the virtual fold.
const sessions = Array.from({ length: 40 }, (_, index) => ({
  filePath: `C:\\project\\session-${index}.jsonl`,
  sessionId: `session-${index}`,
  projectPath: "C:\\project",
  projectName: "project",
  title: `Session ${index}`,
  firstPrompt: "hello",
  model: "claude-sonnet",
  branch: "main",
  status: "idle",
  messageCount: 3,
  lastMessageAt: 0
}));

const FOCUS_PATH = "C:\\project\\session-30.jsonl";

beforeEach(() => {
  // jsdom has no Element.scrollTo; the component calls it on the virtual viewport.
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
  Reflect.deleteProperty(Element.prototype, "scrollTo");
});

describe("SessionsPage focus jump (recent edits → sessions)", () => {
  it("keeps the focus pending until a late snapshot arrives, then selects and scrolls", async () => {
    let resolveScan!: (value: unknown) => void;
    const scan = new Promise(resolve => { resolveScan = resolve; });
    Reflect.set(window, "companion", {
      getClaudeSessions: () => scan,
      getClaudeSessionDetail: async () => ({ messages: [], totalMessages: 0 }),
      resumeClaudeSession: vi.fn()
    });
    const onHandled = vi.fn();
    render(<SessionsPage focusSessionPath={FOCUS_PATH} onFocusSessionHandled={onHandled} />);

    // The parent's one-shot request is consumed immediately, but nothing can scroll yet.
    expect(onHandled).toHaveBeenCalled();
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();

    await act(async () => {
      resolveScan({ sessions, scannedAt: 1, projectsDir: "~/.claude/projects" });
      await scan;
    });

    // Once the list contains the target: detail header shows it and the list scrolled to it.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session 30" })).toBeTruthy());
    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 29 * SESSION_ROW_HEIGHT })
    ));
  });

  it("selects and scrolls immediately when the snapshot is already loaded", async () => {
    Reflect.set(window, "companion", {
      getClaudeSessions: async () => ({ sessions, scannedAt: 1, projectsDir: "~/.claude/projects" }),
      getClaudeSessionDetail: async () => ({ messages: [], totalMessages: 0 }),
      resumeClaudeSession: vi.fn()
    });
    const view = render(<SessionsPage />);
    await screen.findAllByText("Session 0");

    view.rerender(<SessionsPage focusSessionPath={FOCUS_PATH} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Session 30" })).toBeTruthy());
    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 29 * SESSION_ROW_HEIGHT })
    ));
  });
});

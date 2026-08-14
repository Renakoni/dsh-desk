// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionsPage } from "../src/renderer/clawd-migrated/components/sessions/SessionsPage";

const session = {
  filePath: "C:\\project\\session.jsonl",
  sessionId: "abc123def456",
  projectPath: "C:\\project",
  projectName: "project",
  title: "Test session",
  firstPrompt: "hello",
  model: "claude-sonnet",
  branch: "main",
  status: "idle",
  messageCount: 3,
  lastMessageAt: 0
};

function installCompanion(resumeResult: unknown) {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  Reflect.set(window, "companion", {
    getClaudeSessions: async () => ({ sessions: [session], scannedAt: 0, projectsDir: "~/.claude/projects" }),
    getClaudeSessionDetail: async () => ({ messages: [], totalMessages: 0 }),
    resumeClaudeSession: vi.fn(async () => resumeResult)
  });
  return { writeText };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

describe("SessionsPage resume", () => {
  it("surfaces the actionable error and copies nothing when claude is missing (not copyable)", async () => {
    const notOnPath = "Claude Code (claude) isn't on PATH. Install it — or restart DSH Desk if you just installed it — then try again.";
    const { writeText } = installCompanion({ ok: false, command: "claude --resume abc123def456", error: notOnPath });
    render(<SessionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));

    // The install/restart guidance reaches the UI instead of a useless copied command.
    await waitFor(() => expect(screen.getByText(/isn't on PATH/)).toBeTruthy());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("surfaces the error and copies the command on an async launch failure (copyable)", async () => {
    const { writeText } = installCompanion({ ok: false, command: "claude --resume abc123def456", error: "spawn cmd.exe ENOENT", copyable: true });
    render(<SessionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));

    await waitFor(() => expect(screen.getByText(/ENOENT/)).toBeTruthy());
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("claude --resume abc123def456"));
  });

  it("keeps existing content visible while a retained page refreshes", async () => {
    let resolveRefresh!: (value: unknown) => void;
    const refresh = new Promise(resolve => { resolveRefresh = resolve; });
    const getClaudeSessions = vi.fn()
      .mockResolvedValueOnce({ sessions: [session], scannedAt: 1, projectsDir: "~/.claude/projects" })
      .mockReturnValueOnce(refresh);
    Reflect.set(window, "companion", {
      getClaudeSessions,
      getClaudeSessionDetail: async () => ({ messages: [], totalMessages: 0 }),
      resumeClaudeSession: vi.fn()
    });
    const view = render(<SessionsPage active />);
    await screen.findAllByText("Test session");

    view.rerender(<SessionsPage active={false} />);
    view.rerender(<SessionsPage active />);

    expect(screen.getAllByText("Test session").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Scanning/)).toBeNull();
    expect(getClaudeSessions).toHaveBeenLastCalledWith(false);
    await act(async () => {
      resolveRefresh({ sessions: [session], scannedAt: 2, projectsDir: "~/.claude/projects" });
      await refresh;
    });
  });

  it("preloads the first session detail while hidden", async () => {
    const getClaudeSessionDetail = vi.fn(async () => ({
      session,
      messages: [{ id: "message-1", role: "assistant", text: "Already warmed", timestamp: 1 }],
      totalMessages: 1
    }));
    Reflect.set(window, "companion", {
      getClaudeSessions: async () => ({ sessions: [session], scannedAt: 1, projectsDir: "~/.claude/projects" }),
      getClaudeSessionDetail,
      resumeClaudeSession: vi.fn()
    });

    const view = render(<SessionsPage active={false} />);
    await waitFor(() => expect(getClaudeSessionDetail).toHaveBeenCalledWith(session.filePath));
    await screen.findByText("Already warmed");

    view.rerender(<SessionsPage active />);
    expect(screen.queryByText(/加载消息中|Loading messages/)).toBeNull();
    expect(screen.getByText("Already warmed")).toBeTruthy();
  });

  it("keeps refreshed detail stable without stacking a loading row above it", async () => {
    let resolveRefreshDetail!: (value: unknown) => void;
    const refreshDetail = new Promise(resolve => { resolveRefreshDetail = resolve; });
    const getClaudeSessionDetail = vi.fn()
      .mockResolvedValueOnce({
        session,
        messages: [{ id: "message-1", role: "assistant", text: "Existing detail", timestamp: 1 }],
        totalMessages: 1
      })
      .mockReturnValueOnce(refreshDetail);
    Reflect.set(window, "companion", {
      getClaudeSessions: async () => ({ sessions: [session], scannedAt: Date.now(), projectsDir: "~/.claude/projects" }),
      getClaudeSessionDetail,
      resumeClaudeSession: vi.fn()
    });

    const view = render(<SessionsPage active />);
    await screen.findByText("Existing detail");
    view.rerender(<SessionsPage active={false} />);
    view.rerender(<SessionsPage active />);
    await waitFor(() => expect(getClaudeSessionDetail).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/加载消息中|Loading messages/)).toBeNull();
    expect(screen.getByText("Existing detail")).toBeTruthy();

    await act(async () => {
      resolveRefreshDetail({
        session,
        messages: [{ id: "message-2", role: "assistant", text: "Fresh detail", timestamp: 2 }],
        totalMessages: 1
      });
      await refreshDetail;
    });
    await screen.findByText("Fresh detail");
  });

  it("virtualizes large session inventories", async () => {
    const sessions = Array.from({ length: 500 }, (_, index) => ({
      ...session,
      filePath: `C:\\project\\session-${index}.jsonl`,
      sessionId: `session-${index}`,
      title: `Session ${index}`
    }));
    Reflect.set(window, "companion", {
      getClaudeSessions: async () => ({ sessions, scannedAt: 1, projectsDir: "~/.claude/projects" }),
      getClaudeSessionDetail: async () => ({ messages: [], totalMessages: 0 }),
      resumeClaudeSession: vi.fn()
    });
    const view = render(<SessionsPage />);
    await screen.findAllByText("Session 0");

    expect(view.container.querySelectorAll(".session-viewer-row").length).toBeLessThan(30);
    expect(view.container.querySelector<HTMLElement>(".session-viewer-virtual-space")?.style.height).toBe("48500px");
  });
});

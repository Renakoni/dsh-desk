// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionsPage } from "../src/renderer/clawd-migrated/components/sessions/SessionsPage";

const session = {
  filePath: "C:\\Users\\me\\.claude\\projects\\proj\\session.jsonl",
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

type SnapshotListener = (snapshot: unknown) => void;

function installCompanion() {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const listeners: SnapshotListener[] = [];
  const getClaudeSessions = vi.fn(async () => ({ sessions: [session], scannedAt: 1, projectsDir: "~/.claude/projects" }));
  const getClaudeSessionDetail = vi.fn(async () => ({ messages: [], totalMessages: 0 }));
  const openClaudeResource = vi.fn(async () => true);
  Reflect.set(window, "companion", {
    getClaudeSessions,
    getClaudeSessionDetail,
    resumeClaudeSession: vi.fn(),
    openClaudeResource,
    onSessionsUpdated: (listener: SnapshotListener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    }
  });
  return { writeText, getClaudeSessions, getClaudeSessionDetail, openClaudeResource, push: (snapshot: unknown) => listeners.forEach(listener => listener(snapshot)) };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "companion");
});

describe("SessionsPage quick actions", () => {
  it("copies the resume command with a cd prefix that Windows PowerShell 5.1 accepts", async () => {
    const { writeText } = installCompanion();
    render(<SessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /复制恢复命令/ }));
    // ";" not "&&": PS 5.1 (the shell the Resume button opens) rejects "&&".
    expect(writeText).toHaveBeenCalledWith('cd "C:\\project"; claude --resume abc123def456');
  });

  it("copies the bare session id", async () => {
    const { writeText } = installCompanion();
    render(<SessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /复制会话 ID/ }));
    expect(writeText).toHaveBeenCalledWith("abc123def456");
  });

  it("reveals the transcript through the existing allow-listed IPC", async () => {
    const { openClaudeResource } = installCompanion();
    render(<SessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /在资源管理器中显示日志/ }));
    expect(openClaudeResource).toHaveBeenCalledWith(session.filePath);
  });
});

describe("SessionsPage live refresh (pushed snapshots)", () => {
  it("repaints from a pushed snapshot without pulling the stale cache", async () => {
    const { getClaudeSessions, push } = installCompanion();
    render(<SessionsPage active />);
    await screen.findAllByText("Test session");
    expect(getClaudeSessions).toHaveBeenCalledTimes(1);

    // Main finished a hook-triggered forced rescan and pushes the fresh snapshot.
    const newSession = { ...session, filePath: "C:\\project\\fresh.jsonl", sessionId: "fresh123", title: "Fresh session", lastMessageAt: 9 };
    act(() => {
      push({ sessions: [newSession, session], scannedAt: 2, projectsDir: "~/.claude/projects" });
    });

    // The new session appears without any additional getClaudeSessions pull —
    // pulling would only return the stale snapshot stale-while-revalidate serves.
    await screen.findAllByText("Fresh session");
    expect(getClaudeSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps the current selection when a pushed snapshot arrives", async () => {
    const { push } = installCompanion();
    render(<SessionsPage active />);
    await screen.findAllByText("Test session");

    const newSession = { ...session, filePath: "C:\\project\\fresh.jsonl", sessionId: "fresh123", title: "Fresh session", lastMessageAt: 9 };
    act(() => {
      push({ sessions: [newSession, session], scannedAt: 2, projectsDir: "~/.claude/projects" });
    });

    // Detail header still shows the originally selected session, not the new list head.
    expect(screen.getByRole("heading", { name: "Test session" })).toBeTruthy();
  });

  it("does not refetch the open detail from pushes while the tab is hidden", async () => {
    const { getClaudeSessionDetail, push } = installCompanion();
    render(<SessionsPage active={false} />);
    await waitFor(() => expect(getClaudeSessionDetail).toHaveBeenCalledTimes(1)); // initial preload

    // The page stays mounted for the app's lifetime and pushes arrive after every Claude
    // turn — a hidden tab must not re-parse the transcript on each one.
    act(() => {
      push({ sessions: [session], scannedAt: 2, projectsDir: "~/.claude/projects" });
      push({ sessions: [session], scannedAt: 3, projectsDir: "~/.claude/projects" });
    });
    await act(async () => {});
    expect(getClaudeSessionDetail).toHaveBeenCalledTimes(1);
  });
});

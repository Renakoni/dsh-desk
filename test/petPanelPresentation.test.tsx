// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Panel } from "../src/renderer/components/Panel";
import { actionForTool, parseMcpTool, toolLabel } from "../src/renderer/components/toolPresentation";

afterEach(cleanup);

describe("pet status panel presentation", () => {
  it("presents DSH user questions as concise prose", () => {
    const question = "May I show you the plan before proceeding?";
    const view = render(<Panel
      state="running"
      event={{
        id: "question-1",
        event: "running",
        source: "deepseek-harness",
        tool: "ask_user_question",
        detail: question,
        timestamp: 1
      }}
    />);

    expect(screen.getByText("Ask for input")).toBeTruthy();
    expect(screen.getByText("question")).toBeTruthy();
    expect(screen.getByText(question).classList.contains("panel-note-prose")).toBe(true);
    expect(view.container.querySelector(".panel-path")).toBeNull();
  });

  it("keeps unknown technical names in the chip instead of repeating them in the headline", () => {
    expect(actionForTool("custom_dsh_tool")).toBe("Use a tool");
    expect(toolLabel("custom_dsh_tool")).toBe("custom_dsh_tool");
  });

  it("separates the MCP server from its humanized tool action", () => {
    expect(parseMcpTool("mcp__playwright__browser_snapshot")).toEqual({ server: "Playwright", action: "Browser snapshot" });
    expect(toolLabel("mcp__filesystem__read_file")).toBe("Filesystem");
    expect(actionForTool("mcp__github__create_pull_request_review_comment")).toBe("Create pull request review comment");
    expect(parseMcpTool("mcp__incomplete")).toBeNull();
    expect(actionForTool("mcp__incomplete")).toBe("Use an MCP tool");
  });

  it("shows a two-level connection state without the redundant ready line", () => {
    render(<Panel
      state="idle"
      event={{
        id: "connected-1",
        event: "idle",
        source: "deepseek-harness",
        hook: "agent/session-start",
        title: "DSH is online",
        message: "Ready",
        timestamp: 1
      }}
    />);

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("DeepSeek Harness")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("DSH is online")).toBeNull();
  });

  it("removes generic completion copy but preserves an actionable completion reason", () => {
    const view = render(<Panel
      state="completed"
      event={{ id: "done-1", event: "completed", title: "Completed", message: "Task finished", timestamp: 1 }}
    />);
    expect(screen.queryByText("Task finished")).toBeNull();

    view.rerender(<Panel
      state="completed"
      event={{ id: "done-2", event: "completed", title: "Token limit reached", message: "The turn reached its output limit.", timestamp: 2 }}
    />);
    expect(screen.getByText("The turn reached its output limit.")).toBeTruthy();
  });
});

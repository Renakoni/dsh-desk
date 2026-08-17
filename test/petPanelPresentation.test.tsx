// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Panel } from "../src/renderer/components/Panel";
import { actionForTool, toolLabel } from "../src/renderer/components/toolPresentation";

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
    expect(screen.getByText(question).classList.contains("panel-note")).toBe(true);
    expect(view.container.querySelector(".panel-path")).toBeNull();
  });

  it("keeps unknown technical names in the chip instead of repeating them in the headline", () => {
    expect(actionForTool("custom_dsh_tool")).toBe("Use a tool");
    expect(toolLabel("custom_dsh_tool")).toBe("custom_dsh_tool");
  });
});

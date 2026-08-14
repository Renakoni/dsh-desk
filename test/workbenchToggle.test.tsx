// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "../src/renderer/clawd-migrated/components/workbench/Primitives";

afterEach(cleanup);

describe("workbench Toggle accessibility", () => {
  it("exposes a switch role whose aria-checked tracks the checked state", () => {
    const { rerender } = render(<Toggle label="启用桌宠" checked={false} onChange={vi.fn()} />);
    const control = screen.getByRole("switch", { name: "启用桌宠" });
    expect(control.getAttribute("aria-checked")).toBe("false");

    rerender(<Toggle label="启用桌宠" checked onChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "启用桌宠" }).getAttribute("aria-checked")).toBe("true");
  });

  it("is a real button typed 'button' so it gets native keyboard/focus and never submits a form", () => {
    render(<Toggle label="始终置顶" checked={false} onChange={vi.fn()} />);
    const control = screen.getByRole("switch", { name: "始终置顶" });
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("type")).toBe("button");
  });

  it("toggles to the negated value when activated", () => {
    const onChange = vi.fn();
    render(<Toggle label="显示气泡" checked onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "显示气泡" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

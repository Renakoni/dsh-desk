// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../src/renderer/clawd-migrated/components/claude-routing/ConfirmDialog";

afterEach(cleanup);

function renderDialog(overrides: Record<string, unknown> = {}) {
  const props = {
    title: "删除供应商",
    cancelLabel: "取消",
    confirmLabel: "删除",
    danger: true,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides
  };
  const view = render(
    <ConfirmDialog {...(props as any)}>
      <p>确定要删除吗？</p>
    </ConfirmDialog>
  );
  return { view, props };
}

describe("ConfirmDialog modal behavior", () => {
  it("moves focus to the safe Cancel action on open", () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("traps Tab within the dialog, wrapping at both ends", () => {
    renderDialog();
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "删除" });

    // Forward Tab off the last focusable wraps back to the first.
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab off the first wraps to the last.
    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("returns focus to the opener when it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { view } = renderDialog();
    expect(document.activeElement).not.toBe(opener); // dialog took focus

    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("still cancels when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(document.querySelector(".ccs-confirm-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

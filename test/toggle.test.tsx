// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "../src/renderer/clawd-migrated/components/ui/Toggle";

afterEach(cleanup);

describe("ui/Toggle naming contract", () => {
  it("uses the visible label as the switch's accessible name", () => {
    // A wrapping <label> does not name a div[role="switch"]; the component wires the
    // visible text via aria-labelledby so screen readers announce it.
    render(<Toggle label="Enable sound" checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Enable sound" })).toBeTruthy();
  });

  it("lets ariaLabel provide the name when the visible label is empty/decorative", () => {
    render(<Toggle label="" ariaLabel="Done" checked onChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Done" })).toBeTruthy();
  });

  it("prefers ariaLabel over the visible label when both are present", () => {
    render(<Toggle label="Visible" ariaLabel="Override" checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Override" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Visible" })).toBeNull();
  });
});

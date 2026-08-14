// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { toast } from "sonner";
import { ROUTING_TOASTER_TOP_OFFSET_PX, RoutingToaster } from "../src/renderer/clawd-migrated/components/claude-routing/RoutingToaster";

afterEach(cleanup);

describe("RoutingToaster", () => {
  it("keeps toasts clear of the frameless window's 52px titlebar drag strip", async () => {
    render(<RoutingToaster />);
    act(() => {
      toast("connectivity result");
    });
    await waitFor(() => {
      const toaster = document.querySelector("[data-sonner-toaster]") as HTMLElement | null;
      expect(toaster).not.toBeNull();
      // The titlebar is a -webkit-app-region drag strip: a toast rendered
      // inside it (sonner's default 32px offset) has an unclickable close
      // button, because Electron's drag hit-testing beats the DOM.
      expect(toaster!.style.getPropertyValue("--offset-top")).toBe(`${ROUTING_TOASTER_TOP_OFFSET_PX}px`);
    });
  });
});

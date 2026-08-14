// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { defaultSettings } from "../src/renderer/shared/events";
import { petPackThemeId } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

describe("floating pet initial state", () => {
  it("renders the persisted custom pet on the first frame, then starts background warmup", async () => {
    const pack = makePackManifest();
    const settings = { ...defaultSettings, petTheme: petPackThemeId(pack.id) };
    const notifyPetRendered = vi.fn();
    Reflect.set(window, "companion", {
      initialState: { settings, petPacks: [pack] },
      notifyPetRendered,
      getSettings: () => new Promise(() => {}),
      onSettings: vi.fn(() => vi.fn()),
      onPreviewPetAnimation: vi.fn(() => vi.fn())
    });

    render(<App />);

    expect(screen.getByRole("img").getAttribute("style")).toContain("pet-asset://");
    await waitFor(() => expect(notifyPetRendered).toHaveBeenCalledOnce());
  });
});

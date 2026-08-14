// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Pet } from "../src/renderer/components/Pet";
import { spritesheetAssetsFromPack } from "../src/shared/petPackAssets";
import { catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

const pack = makePackManifest();
const catalog = catalogFromPetPack(pack);
const spritesheet = spritesheetAssetsFromPack(pack);

afterEach(cleanup);

describe("Pet drag playback", () => {
  it("plays the locomotion row over the state animation while dragging", () => {
    render(<Pet state="running" catalog={catalog} spritesheet={spritesheet} dragAnimation="running_left" />);
    expect(screen.getByRole("img", { name: "running_left" })).toBeTruthy();
  });

  it("returns to the state animation when the drag transient clears", () => {
    render(<Pet state="running" catalog={catalog} spritesheet={spritesheet} dragAnimation={null} />);
    expect(screen.getByRole("img", { name: "running" })).toBeTruthy();
  });

  it("keeps the built-in clips unchanged while dragged (no locomotion assets)", () => {
    // No spritesheet: the clip theme renders its state image even if a drag
    // transient were ever passed in.
    render(<Pet state="running" dragAnimation="running_left" />);
    expect((screen.getByAltText("running") as HTMLImageElement).tagName).toBe("IMG");
  });
});

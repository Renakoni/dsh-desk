// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Pet } from "../src/renderer/components/Pet";
import { spritesheetAssetsFromPack } from "../src/shared/petPackAssets";
import { catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { spriteFramePosition } from "../src/shared/spriteFrame";
import { makeV2PackManifest } from "./helpers/packFixtures";

const pack = makeV2PackManifest();
const catalog = catalogFromPetPack(pack);
const spritesheet = spritesheetAssetsFromPack(pack);

afterEach(cleanup);

function position(column: number, row: number) {
  const value = spriteFramePosition(column, row, 8, 11);
  return `${value.xPercent}% ${value.yPercent}%`;
}

describe("Pet v2 pointer look precedence", () => {
  it("renders the requested look cell while idle", () => {
    render(<Pet state="idle" catalog={catalog} spritesheet={spritesheet} lookTarget={4} />);
    expect((screen.getByRole("img") as HTMLElement).style.backgroundPosition).toBe(position(4, 9));
  });

  it("drag and DSH states override pointer look", () => {
    const { rerender } = render(<Pet state="idle" catalog={catalog} spritesheet={spritesheet} lookTarget={4} dragAnimation="running_left" />);
    expect((screen.getByRole("img") as HTMLElement).style.backgroundPosition).toBe(position(0, 2));
    rerender(<Pet state="running" catalog={catalog} spritesheet={spritesheet} lookTarget={4} />);
    expect((screen.getByRole("img") as HTMLElement).style.backgroundPosition).toBe(position(0, 7));
  });

  it("manual preview overrides pointer look", () => {
    render(<Pet state="idle" catalog={catalog} spritesheet={spritesheet} lookTarget={4} previewAnimation={{ key: "waving", nonce: 1 }} />);
    expect((screen.getByRole("img") as HTMLElement).style.backgroundPosition).toBe(position(0, 3));
  });
});

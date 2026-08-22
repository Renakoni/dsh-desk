import { describe, expect, it } from "vitest";
import { spritesheetAssetsFromPack } from "../src/shared/petPackAssets";
import { makePackManifest, makeV2PackManifest } from "./helpers/packFixtures";

describe("spritesheetAssetsFromPack", () => {
  it("builds the pet-asset URL and the by-key animation lookup", () => {
    const assets = spritesheetAssetsFromPack(makePackManifest());
    expect(assets.kind).toBe("spritesheet");
    expect(assets.sheetUrl).toBe("pet-asset://packs/yuexinmiao/spritesheet.webp");
    expect(assets.columns).toBe(8);
    expect(assets.rows).toBe(9);
    expect(assets.cellWidth).toBe(192);
    expect(assets.cellHeight).toBe(208);
    expect(assets.animations.waiting_permission).toMatchObject({ row: 6, frameCount: 8 });
    expect(assets.animations.idle).toMatchObject({ row: 0, frameCount: 6 });
    expect(assets.animations.extra_action_7).toBeUndefined();
  });

  it("only exposes rows the pack provides", () => {
    const assets = spritesheetAssetsFromPack(makePackManifest([4, 0, 0, 5, 0, 0, 0, 0, 0]));
    expect(Object.keys(assets.animations).sort()).toEqual(["idle", "waving"]);
  });

  it("exposes v2 look capability separately from action animations", () => {
    const assets = spritesheetAssetsFromPack({ ...makeV2PackManifest(), displayOffset: { x: 9, y: 0 } });
    expect(assets.rows).toBe(11);
    expect(assets.look).toMatchObject({ directions: 16, startRow: 9, columns: 8 });
    expect(assets.displayOffset).toEqual({ x: 9, y: 0 });
    expect(Object.keys(assets.animations)).not.toContain("look");
  });
});

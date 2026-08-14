import { describe, expect, it } from "vitest";
import { DRAG_SAMPLE_THRESHOLD_PX, dragAnimationForDirection, nextDragDirection } from "../src/shared/petDrag";
import { MINATO_AQUA_CATALOG, catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

describe("nextDragDirection: the reference player's per-sample decision", () => {
  it("picks the direction from horizontal deltas at the 4px threshold", () => {
    expect(nextDragDirection(null, DRAG_SAMPLE_THRESHOLD_PX, 0)).toBe("right");
    expect(nextDragDirection(null, -DRAG_SAMPLE_THRESHOLD_PX, 0)).toBe("left");
    expect(nextDragDirection(null, 40, -3)).toBe("right");
    expect(nextDragDirection(null, -17, 22)).toBe("left");
  });

  it("holds the previous direction below the threshold", () => {
    expect(nextDragDirection("right", 3, 0)).toBe("right");
    expect(nextDragDirection("left", -3, -3)).toBe("left");
    expect(nextDragDirection(null, 2, 1)).toBeNull();
  });

  it("holds the previous direction on mostly-vertical accepted samples", () => {
    // The sample is accepted (deltaY over threshold) but the horizontal
    // motion is too small to pick a side — the stock player keeps the
    // current direction rather than flipping or clearing it.
    expect(nextDragDirection("right", 1, 30)).toBe("right");
    expect(nextDragDirection("left", -2, -30)).toBe("left");
    expect(nextDragDirection(null, 0, 12)).toBeNull();
  });

  it("flips when the drag reverses", () => {
    expect(nextDragDirection("right", -6, 0)).toBe("left");
    expect(nextDragDirection("left", 6, 0)).toBe("right");
  });
});

describe("dragAnimationForDirection: catalog-gated locomotion", () => {
  const packCatalog = catalogFromPetPack(makePackManifest());

  it("selects the pack's locomotion rows while dragging", () => {
    expect(dragAnimationForDirection(packCatalog, "right")).toBe("running_right");
    expect(dragAnimationForDirection(packCatalog, "left")).toBe("running_left");
  });

  it("returns null when not dragging", () => {
    expect(dragAnimationForDirection(packCatalog, null)).toBeNull();
  });

  it("returns null for themes without the requested locomotion row", () => {
    // The built-in clip theme has no locomotion rows at all.
    expect(dragAnimationForDirection(MINATO_AQUA_CATALOG, "right")).toBeNull();
    expect(dragAnimationForDirection(MINATO_AQUA_CATALOG, "left")).toBeNull();
    // A sparse pack can provide one direction and not the other.
    const sparse = catalogFromPetPack(makePackManifest([4, 6, 0, 5, 0, 0, 0, 0, 0]));
    expect(dragAnimationForDirection(sparse, "right")).toBe("running_right");
    expect(dragAnimationForDirection(sparse, "left")).toBeNull();
  });
});

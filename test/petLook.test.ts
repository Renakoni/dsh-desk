import { describe, expect, it } from "vitest";
import { lookFrameForTarget, lookTargetForPointer } from "../src/shared/petLook";

const RECT = { left: 100, top: 100, width: 200, height: 200 };

describe("codex-pet v2 pointer look", () => {
  it("maps cardinal pointer positions to clockwise directions", () => {
    expect(lookTargetForPointer(200, 100, RECT)).toBe(0);
    expect(lookTargetForPointer(300, 200, RECT)).toBe(4);
    expect(lookTargetForPointer(200, 300, RECT)).toBe(8);
    expect(lookTargetForPointer(100, 200, RECT)).toBe(12);
  });

  it("uses the neutral frame inside the center deadzone", () => {
    expect(lookTargetForPointer(200, 200, RECT)).toBe("neutral");
    expect(lookFrameForTarget("neutral")).toEqual({ row: 0, column: 6 });
  });

  it("maps all 16 directions across the two v2 look rows", () => {
    expect(lookFrameForTarget(0)).toEqual({ row: 9, column: 0 });
    expect(lookFrameForTarget(7)).toEqual({ row: 9, column: 7 });
    expect(lookFrameForTarget(8)).toEqual({ row: 10, column: 0 });
    expect(lookFrameForTarget(15)).toEqual({ row: 10, column: 7 });
    expect(lookFrameForTarget(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { lookFrameForTarget, lookTargetForPointer } from "../src/shared/petLook";

const RECT = { left: 100, top: 100, width: 200, height: 200 };

function pointAt(degrees: number, distance: number) {
  const radians = degrees * Math.PI / 180;
  return {
    x: 200 + Math.sin(radians) * distance,
    y: 200 - Math.cos(radians) * distance
  };
}

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

  it("holds the previous direction around a sector boundary", () => {
    const justAcross = pointAt(102, 100);
    expect(lookTargetForPointer(justAcross.x, justAcross.y, RECT)).toBe(5);
    expect(lookTargetForPointer(justAcross.x, justAcross.y, RECT, 4)).toBe(4);

    const committed = pointAt(107, 100);
    expect(lookTargetForPointer(committed.x, committed.y, RECT, 4)).toBe(5);
  });

  it("uses separate center entry and exit thresholds", () => {
    const transition = pointAt(90, 34);
    expect(lookTargetForPointer(transition.x, transition.y, RECT, "neutral")).toBe("neutral");
    expect(lookTargetForPointer(transition.x, transition.y, RECT, 4)).toBe(4);

    const center = pointAt(90, 20);
    expect(lookTargetForPointer(center.x, center.y, RECT, 4)).toBe("neutral");
  });
});

import { describe, expect, it } from "vitest";
import { displayedSpriteHeight, nextSpriteFrame, spriteBackgroundSize, spriteFramePosition } from "../src/shared/spriteFrame";

describe("spriteFramePosition", () => {
  it("maps grid cells to percentage alignment points", () => {
    expect(spriteFramePosition(0, 0, 8, 9)).toEqual({ xPercent: 0, yPercent: 0 });
    expect(spriteFramePosition(7, 8, 8, 9)).toEqual({ xPercent: 100, yPercent: 100 });
    expect(spriteFramePosition(3, 4, 8, 9)).toEqual({ xPercent: (3 * 100) / 7, yPercent: 50 });
  });

  it("degrades safely for single-column or single-row sheets", () => {
    expect(spriteFramePosition(0, 0, 1, 1)).toEqual({ xPercent: 0, yPercent: 0 });
    expect(spriteFramePosition(0, 3, 1, 9)).toEqual({ xPercent: 0, yPercent: 37.5 });
  });
});

describe("spriteBackgroundSize", () => {
  it("scales the sheet so one cell fills the container", () => {
    expect(spriteBackgroundSize(8, 9)).toBe("800% 900%");
    expect(spriteBackgroundSize(1, 1)).toBe("100% 100%");
  });
});

describe("nextSpriteFrame", () => {
  it("advances and wraps within the frame count", () => {
    expect(nextSpriteFrame(0, 6)).toBe(1);
    expect(nextSpriteFrame(4, 6)).toBe(5);
    expect(nextSpriteFrame(5, 6)).toBe(0);
    expect(nextSpriteFrame(0, 1)).toBe(0);
    expect(nextSpriteFrame(0, 0)).toBe(0);
  });
});

describe("displayedSpriteHeight", () => {
  it("preserves the cell aspect ratio at the display width", () => {
    expect(displayedSpriteHeight(192, 208, 192)).toBe(208); // codex-pet reference cells
    expect(displayedSpriteHeight(32, 32, 192)).toBe(192); // square cells stay square
    expect(displayedSpriteHeight(192, 208, 96)).toBe(104);
    expect(displayedSpriteHeight(30, 20, 192)).toBe(128);
  });
});

import { describe, expect, it } from "vitest";
import { pointInBounds, trayMenuLayout } from "../src/main/trayMenuPosition";

const METRICS = { mainWidth: 184, submenuWidth: 184, height: 188 };
const WIDTH = METRICS.mainWidth + METRICS.submenuWidth; // 368
// A 1920x1032 work area: a bottom taskbar owns the remaining 48px.
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1032 };

describe("trayMenuLayout", () => {
  it("opens the submenu on the left near a bottom-right tray", () => {
    const { bounds, submenuSide } = trayMenuLayout({ x: 1890, y: 1030 }, METRICS, WORK_AREA);
    expect(submenuSide).toBe("left");
    // The whole window stays on-screen.
    expect(bounds.width).toBe(WIDTH);
    expect(bounds.height).toBe(METRICS.height);
    expect(bounds.x).toBeGreaterThanOrEqual(WORK_AREA.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width);
    // Sits just above the cursor.
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1030);
  });

  it("opens the submenu on the right when there is room", () => {
    const { bounds, submenuSide } = trayMenuLayout({ x: 200, y: 1030 }, METRICS, WORK_AREA);
    expect(submenuSide).toBe("right");
    // Main column centered on the cursor; submenu extends right from there.
    expect(bounds.x).toBe(200 - METRICS.mainWidth / 2);
  });

  it("clamps at the left screen edge instead of going off-screen", () => {
    const { bounds } = trayMenuLayout({ x: 20, y: 1030 }, METRICS, WORK_AREA);
    expect(bounds.x).toBe(WORK_AREA.x + 4);
  });

  it("clamps at the right edge of a secondary display's work area", () => {
    const secondary = { x: -1920, y: 0, width: 1920, height: 1032 };
    const { bounds } = trayMenuLayout({ x: -30, y: 1030 }, METRICS, secondary);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(secondary.x + secondary.width);
  });

  it("clamps to the top for a menu taller than the space above the cursor", () => {
    const topTaskbar = { x: 0, y: 48, width: 1920, height: 1032 };
    const { bounds } = trayMenuLayout({ x: 960, y: 60 }, METRICS, topTaskbar);
    expect(bounds.y).toBe(topTaskbar.y + 4);
  });

  it("keeps the top-left on-screen when the window is larger than the work area", () => {
    // A work area smaller than the 368x160 window: the leading edge must win,
    // not a negative right/bottom-derived maximum.
    const tiny = { x: 0, y: 0, width: 300, height: 120 };
    const { bounds } = trayMenuLayout({ x: 150, y: 110 }, METRICS, tiny);
    expect(bounds.x).toBe(tiny.x + 4);
    expect(bounds.y).toBe(tiny.y + 4);
  });
});

describe("pointInBounds", () => {
  const trayIcon = { x: 1500, y: 1040, width: 24, height: 24 };

  it("matches points inside and on the leading edges only", () => {
    expect(pointInBounds({ x: 1500, y: 1040 }, trayIcon)).toBe(true);
    expect(pointInBounds({ x: 1512, y: 1052 }, trayIcon)).toBe(true);
    expect(pointInBounds({ x: 1524, y: 1052 }, trayIcon)).toBe(false); // exclusive right edge
    expect(pointInBounds({ x: 1499, y: 1052 }, trayIcon)).toBe(false);
    expect(pointInBounds({ x: 1512, y: 1064 }, trayIcon)).toBe(false); // exclusive bottom edge
  });

  it("matches nothing for an empty rect (tray bounds unavailable)", () => {
    expect(pointInBounds({ x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });
});

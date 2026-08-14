import { describe, expect, it } from "vitest";
import {
  WM_LBUTTONDOWN,
  WM_PARENTNOTIFY,
  createDoubleClickDetector,
  decodeParentNotify,
  installPetParentNotifyWatcher,
  parseRegInt,
  readSystemDoubleClickMetrics,
  trustedRegExePath
} from "../src/main/petDoubleClick";

// Build the (wParam, lParam) Buffers Windows delivers for a WM_PARENTNOTIFY carrying
// `message` at client point (x, y).
function parentNotify(message: number, x: number, y: number): [Buffer, Buffer] {
  const wParam = Buffer.alloc(8);
  wParam.writeUInt16LE(message, 0);
  const lParam = Buffer.alloc(8);
  lParam.writeInt16LE(x, 0);
  lParam.writeInt16LE(y, 2);
  return [wParam, lParam];
}

describe("decodeParentNotify", () => {
  it("reads the child mouse message and client point from wParam/lParam", () => {
    const [wParam, lParam] = parentNotify(WM_LBUTTONDOWN, 123, 45);
    expect(decodeParentNotify(wParam, lParam)).toEqual({ message: WM_LBUTTONDOWN, x: 123, y: 45 });
  });

  it("reads negative coordinates (multi-monitor) as signed", () => {
    const [wParam, lParam] = parentNotify(WM_LBUTTONDOWN, -10, -3);
    expect(decodeParentNotify(wParam, lParam)).toMatchObject({ x: -10, y: -3 });
  });
});

describe("createDoubleClickDetector", () => {
  function clock() {
    let t = 1000;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
  }

  it("detects two downs within the time + distance window", () => {
    const c = clock();
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: c.now });
    expect(detector.push(100, 100)).toBeNull(); // first down
    c.advance(200);
    expect(detector.push(103, 98)).toEqual({ x: 103, y: 98 }); // within 500ms and 8px
  });

  it("rejects a second down that is too slow", () => {
    const c = clock();
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: c.now });
    detector.push(100, 100);
    c.advance(600); // past the double-click time
    expect(detector.push(100, 100)).toBeNull();
  });

  it("rejects a second down that is too far (a move, not a double-click)", () => {
    const c = clock();
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: c.now });
    detector.push(100, 100);
    c.advance(100);
    expect(detector.push(140, 100)).toBeNull(); // 40px away
  });

  it("consumes the pair so a triple-click is one double-click, not two", () => {
    const c = clock();
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: c.now });
    detector.push(50, 50);
    c.advance(100);
    expect(detector.push(50, 50)).toEqual({ x: 50, y: 50 }); // double
    c.advance(100);
    expect(detector.push(50, 50)).toBeNull(); // third starts a fresh pair
  });

  it("cancels the pending click on reset — a native drag moves the window, so a quick click at the same client-relative point isn't a double-click", () => {
    const c = clock();
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: c.now });
    expect(detector.push(96, 160)).toBeNull(); // first down
    detector.reset(); // the pet window moved (native drag) — index.ts calls this on 'move'
    c.advance(200);
    expect(detector.push(96, 160)).toBeNull(); // same client point, but the drag reset the pending click
  });

  it("uses the per-axis half-extents (the Windows double-click rectangle), not a single radius", () => {
    const c = clock();
    // Narrow-x, tall-y rectangle: ±1 on x, ±5 on y.
    const near = () => createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 1, maxDistanceY: 5, now: c.now });
    const withinBoth = near();
    withinBoth.push(100, 100);
    c.advance(50);
    expect(withinBoth.push(101, 104)).toEqual({ x: 101, y: 104 }); // dx=1 (<=1), dy=4 (<=5) -> pair
    const beyondX = near();
    beyondX.push(100, 100);
    c.advance(50);
    expect(beyondX.push(102, 100)).toBeNull(); // dx=2 (>1), even though dy=0
    const beyondY = near();
    beyondY.push(100, 100);
    c.advance(50);
    expect(beyondY.push(100, 106)).toBeNull(); // dy=6 (>5), even though dx=0
  });
});

describe("installPetParentNotifyWatcher", () => {
  it("hooks only WM_PARENTNOTIFY and reports the point for two left-button-downs", () => {
    const hooks = new Map<number, (w: Buffer, l: Buffer) => void>();
    const window = { hookWindowMessage: (m: number, cb: (w: Buffer, l: Buffer) => void) => { hooks.set(m, cb); } };
    let t = 0;
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: () => t });
    const points: Array<{ x: number; y: number }> = [];
    installPetParentNotifyWatcher(window, detector, (x, y) => points.push({ x, y }));

    expect([...hooks.keys()]).toEqual([WM_PARENTNOTIFY]);
    const fire = hooks.get(WM_PARENTNOTIFY)!;
    fire(...parentNotify(WM_LBUTTONDOWN, 70, 80));
    t = 150;
    fire(...parentNotify(WM_LBUTTONDOWN, 72, 80));
    expect(points).toEqual([{ x: 72, y: 80 }]);
  });

  it("ignores WM_PARENTNOTIFY messages that aren't a left-button-down", () => {
    const hooks = new Map<number, (w: Buffer, l: Buffer) => void>();
    const window = { hookWindowMessage: (m: number, cb: (w: Buffer, l: Buffer) => void) => { hooks.set(m, cb); } };
    const detector = createDoubleClickDetector({ doubleClickMs: 500, maxDistanceX: 8, maxDistanceY: 8, now: () => 0 });
    let opened = 0;
    installPetParentNotifyWatcher(window, detector, () => { opened += 1; });

    const fire = hooks.get(WM_PARENTNOTIFY)!;
    const WM_CREATE = 0x0001;
    fire(...parentNotify(WM_CREATE, 10, 10)); // child created, not a click
    fire(...parentNotify(WM_CREATE, 10, 10));
    expect(opened).toBe(0);
  });
});

describe("trustedRegExePath", () => {
  it("resolves the System32 reg.exe from SystemRoot only (never a bare name / cwd)", () => {
    const found = (p: string) => p === "C:\\Windows\\System32\\reg.exe";
    expect(trustedRegExePath({ SystemRoot: "C:\\Windows" }, found)).toBe("C:\\Windows\\System32\\reg.exe");
    // Reads SystemRoot case-insensitively and falls back to C:\Windows.
    expect(trustedRegExePath({ systemroot: "D:\\Win" }, p => p === "D:\\Win\\System32\\reg.exe")).toBe("D:\\Win\\System32\\reg.exe");
  });
  it("returns null when reg.exe is absent", () => {
    expect(trustedRegExePath({ SystemRoot: "C:\\Windows" }, () => false)).toBeNull();
  });
});

describe("parseRegInt", () => {
  it("parses a named REG value (decimal), clamps out-of-range, and falls back when absent", () => {
    const out = "    DoubleClickSpeed    REG_SZ    350\r\n    DoubleClickWidth    REG_SZ    12\r\n";
    expect(parseRegInt(out, "DoubleClickSpeed", 500, 100, 2000)).toBe(350);
    expect(parseRegInt(out, "DoubleClickWidth", 4, 1, 200)).toBe(12);
    expect(parseRegInt(out, "DoubleClickHeight", 4, 1, 200)).toBe(4); // absent -> fallback
    expect(parseRegInt("DoubleClickWidth REG_SZ 0", "DoubleClickWidth", 4, 1, 200)).toBe(4); // below min
    expect(parseRegInt("DoubleClickWidth REG_SZ 9999", "DoubleClickWidth", 4, 1, 200)).toBe(4); // above max
  });
});

describe("readSystemDoubleClickMetrics", () => {
  const REG_OUTPUT = [
    "HKEY_CURRENT_USER\\Control Panel\\Mouse",
    "    DoubleClickSpeed    REG_SZ    350",
    "    DoubleClickWidth    REG_SZ    10",
    "    DoubleClickHeight    REG_SZ    12"
  ].join("\r\n");

  it("reads speed + rectangle via the TRUSTED absolute reg.exe, never a bare name (a cwd-local reg.exe can't win)", () => {
    let invokedWith: string | null = null;
    const metrics = readSystemDoubleClickMetrics(
      { SystemRoot: "C:\\Windows" },
      regExe => { invokedWith = regExe; return REG_OUTPUT; },
      () => true
    );
    expect(metrics).toEqual({ speedMs: 350, width: 10, height: 12 });
    // The regression guard: the runner is handed the fully-qualified System32 path.
    expect(invokedWith).toBe("C:\\Windows\\System32\\reg.exe");
    expect(invokedWith).not.toBe("reg");
  });

  it("returns Windows defaults (500ms, 4x4) when reg.exe is absent or returns nothing usable", () => {
    const defaults = { speedMs: 500, width: 4, height: 4 };
    expect(readSystemDoubleClickMetrics({ SystemRoot: "C:\\Windows" }, () => "nope", () => true)).toEqual(defaults);
    expect(readSystemDoubleClickMetrics({ SystemRoot: "C:\\Windows" }, () => null, () => true)).toEqual(defaults);
    // reg.exe absent: the runner is never invoked.
    let invoked = false;
    expect(readSystemDoubleClickMetrics({ SystemRoot: "C:\\Windows" }, () => { invoked = true; return REG_OUTPUT; }, () => false)).toEqual(defaults);
    expect(invoked).toBe(false);
  });

  it("honors a customized (larger accessibility) double-click rectangle", () => {
    const out = "    DoubleClickWidth    REG_SZ    16\r\n    DoubleClickHeight    REG_SZ    20";
    const metrics = readSystemDoubleClickMetrics({ SystemRoot: "C:\\Windows" }, () => out, () => true);
    expect(metrics.width).toBe(16);
    expect(metrics.height).toBe(20);
    expect(metrics.speedMs).toBe(500); // absent speed -> default
  });
});

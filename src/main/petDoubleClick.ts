// Detect a double-click on the pet from WM_PARENTNOTIFY.
//
// In Electron (39+) a click on the pet's `-webkit-app-region: drag` element is
// delivered to Chromium's child render-widget HWND, not the outer BrowserWindow —
// so hookWindowMessage on the outer window never sees WM_NCLBUTTONDBLCLK, or even
// WM_LBUTTONDOWN. The one message the outer window does receive is WM_PARENTNOTIFY,
// emitted once per real child WM_LBUTTONDOWN. We reconstruct a double-click from two
// of those (within the system double-click time and a small distance) and hand the
// click point to the renderer, which hit-tests it against the actual pet element
// (document.elementFromPoint). That excludes the status/notification bubble, the
// permission card and its Allow/Deny buttons, and the transparent background for
// free, and native dragging (one down then movement, never two quick stationary
// downs) is preserved.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

export const WM_PARENTNOTIFY = 0x0210;
export const WM_LBUTTONDOWN = 0x0201;

export interface ParentNotifyEvent {
  /** The child mouse message (low word of wParam), e.g. WM_LBUTTONDOWN. */
  message: number;
  /** Cursor position in the parent's client area, in physical pixels. */
  x: number;
  y: number;
}

/** Decode a WM_PARENTNOTIFY (wParam, lParam) pair into the child mouse event. */
export function decodeParentNotify(wParam: Buffer, lParam: Buffer): ParentNotifyEvent {
  return {
    message: wParam.readUInt16LE(0),
    x: lParam.readInt16LE(0),
    y: lParam.readInt16LE(2)
  };
}

export interface DoubleClickPoint {
  x: number;
  y: number;
}

export interface DoubleClickDetectorOptions {
  /** System double-click time in ms (GetDoubleClickTime / registry DoubleClickSpeed). */
  doubleClickMs: number;
  /** Half-extent (physical px) of the Windows double-click rectangle, per axis —
   *  SM_CXDOUBLECLK/2 and SM_CYDOUBLECLK/2, DPI-scaled, so the second down must land
   *  within the same rectangle Windows would use. */
  maxDistanceX: number;
  maxDistanceY: number;
  /** Injected clock (Date.now). */
  now: () => number;
}

export interface DoubleClickDetector {
  /** Feed a left-button-down point; returns the point iff it completes a double-click. */
  push(x: number, y: number): DoubleClickPoint | null;
  /** Cancel the pending first click — e.g. when a native drag has moved the window, so
   *  the client-relative point can no longer be trusted as "the same spot". */
  reset(): void;
}

export function createDoubleClickDetector(options: DoubleClickDetectorOptions): DoubleClickDetector {
  let previous: { t: number; x: number; y: number } | null = null;
  return {
    push(x, y) {
      const t = options.now();
      const isPair = previous !== null
        && t - previous.t <= options.doubleClickMs
        && Math.abs(x - previous.x) <= options.maxDistanceX
        && Math.abs(y - previous.y) <= options.maxDistanceY;
      if (isPair) {
        previous = null; // consume the pair, so a triple-click isn't two double-clicks
        return { x, y };
      }
      previous = { t, x, y };
      return null;
    },
    reset() {
      previous = null;
    }
  };
}

export interface ParentNotifyHookWindow {
  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
}

/**
 * Hook WM_PARENTNOTIFY on the pet window and call `onDoubleClick(x, y)` (physical
 * client px) when two child left-button-downs form a double-click. Register once per
 * pet window (createPetWindow's single-instance guard ensures that); the hook is
 * released when the window is destroyed, so recreations don't accumulate handlers.
 */
export function installPetParentNotifyWatcher(
  window: ParentNotifyHookWindow,
  detector: DoubleClickDetector,
  onDoubleClick: (x: number, y: number) => void
): void {
  window.hookWindowMessage(WM_PARENTNOTIFY, (wParam, lParam) => {
    const event = decodeParentNotify(wParam, lParam);
    if (event.message !== WM_LBUTTONDOWN) return;
    const hit = detector.push(event.x, event.y);
    if (hit) onDoubleClick(hit.x, hit.y);
  });
}

// --- System double-click settings (read from the registry via a TRUSTED reg.exe) ---

/** Read a variable from an env map case-insensitively (Windows keys vary in case). */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * The trusted `reg.exe` — `%SystemRoot%\System32\reg.exe`, resolved from SystemRoot
 * only. A bare "reg" would be searched in the process cwd first, so a project-local
 * reg.exe could run arbitrary code as soon as the pet window is created; a
 * fully-qualified absolute path can't be shadowed. Returns null if it isn't there.
 */
export function trustedRegExePath(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = existsSync
): string | null {
  const systemRoot = envValue(env, "SystemRoot") || envValue(env, "windir") || "C:\\Windows";
  const candidate = pathWin32.join(systemRoot, "System32", "reg.exe");
  return pathWin32.isAbsolute(candidate) && fileExists(candidate) ? candidate : null;
}

/** Parse a REG_* integer named `name` (decimal) from `reg query` output, clamped to
 *  [min, max]; returns `fallback` when it's absent or out of range. */
export function parseRegInt(regOutput: string, name: string, fallback: number, min: number, max: number): number {
  const match = regOutput.match(new RegExp(`\\b${name}\\s+REG_[A-Z_]+\\s+(\\d+)`, "i"));
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= min && value <= max) return value;
  }
  return fallback;
}

export interface DoubleClickMetrics {
  /** DoubleClickSpeed (ms). */
  speedMs: number;
  /** The double-click rectangle (DoubleClickWidth / DoubleClickHeight,
   *  i.e. SM_CXDOUBLECLK / SM_CYDOUBLECLK), in logical px. */
  width: number;
  height: number;
}

function runReg(regExe: string): string | null {
  try {
    // Dump the whole Mouse key in one call; short timeout so a wedged reg.exe can't
    // block pet-window creation indefinitely.
    const out = spawnSync(regExe, ["query", "HKCU\\Control Panel\\Mouse"], {
      encoding: "utf8", windowsHide: true, timeout: 2000
    });
    return typeof out.stdout === "string" ? out.stdout : null;
  } catch {
    return null;
  }
}

/**
 * The user's Windows double-click settings — speed (GetDoubleClickTime) and the
 * double-click rectangle (DoubleClickWidth/Height) — read from the registry via the
 * TRUSTED absolute reg.exe (never a cwd-local one), clamped, with Windows defaults.
 * `runRegQuery` / `fileExists` are injectable for tests.
 */
export function readSystemDoubleClickMetrics(
  env: Record<string, string | undefined>,
  runRegQuery: (regExe: string) => string | null = runReg,
  fileExists: (path: string) => boolean = existsSync
): DoubleClickMetrics {
  const defaults: DoubleClickMetrics = { speedMs: 500, width: 4, height: 4 };
  const regExe = trustedRegExePath(env, fileExists);
  if (!regExe) return defaults;
  const output = runRegQuery(regExe);
  if (output === null) return defaults;
  return {
    speedMs: parseRegInt(output, "DoubleClickSpeed", 500, 100, 2000),
    width: parseRegInt(output, "DoubleClickWidth", 4, 1, 200),
    height: parseRegInt(output, "DoubleClickHeight", 4, 1, 200)
  };
}

import { useEffect, useState } from "react";
import { nextSpriteFrame, spriteBackgroundSize, spriteFramePosition } from "../../shared/spriteFrame";

interface SpritesheetSpriteProps {
  sheetUrl: string;
  columns: number;
  rows: number;
  /** 0-based row of the animation to play. */
  row: number;
  /** Playable frames in that row (1..columns). */
  frameCount: number;
  frameDurationMs: number;
  width: number;
  height: number;
  alt: string;
  /**
   * Shown when the sheet fails to load or decode, so a broken pack never
   * leaves an invisible pet. One consistent image for every animation —
   * imported themes must not mix in arbitrary built-in action clips.
   */
  errorFallbackUrl?: string;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Tracks the OS-level reduced-motion preference, including changes made
// while the component is mounted. Environments without matchMedia (tests,
// very old shells) default to normal motion.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);

  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query) return;
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

type SheetLoadState = "loading" | "ready" | "error";

// CSS backgrounds fail silently, so the sheet is probed with an Image to
// detect 404s and decode failures explicitly.
function useSheetLoadState(sheetUrl: string): SheetLoadState {
  const [state, setState] = useState<SheetLoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const image = new Image();
    image.onload = () => { if (!cancelled) setState("ready"); };
    image.onerror = () => { if (!cancelled) setState("error"); };
    image.src = sheetUrl;
    return () => { cancelled = true; };
  }, [sheetUrl]);

  return state;
}

/**
 * Plays one spritesheet row by stepping the background position on a fixed
 * per-frame interval. Remount (via a changed React key) restarts from frame
 * 0, mirroring how the clip <img> path restarts previews. Reduced-motion
 * users see the first frame as a still image.
 */
export function SpritesheetSprite({ sheetUrl, columns, rows, row, frameCount, frameDurationMs, width, height, alt, errorFallbackUrl }: SpritesheetSpriteProps) {
  const [frame, setFrame] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const sheetState = useSheetLoadState(sheetUrl);

  useEffect(() => {
    setFrame(0);
    // No interval for stills, reduced motion, or after a load failure — the
    // static fallback is showing and frame updates would be wasted work.
    if (reducedMotion || frameCount <= 1 || sheetState === "error") return;
    const timer = setInterval(() => {
      setFrame(current => nextSpriteFrame(current, frameCount));
    }, Math.max(16, frameDurationMs));
    return () => clearInterval(timer);
  }, [sheetUrl, row, frameCount, frameDurationMs, reducedMotion, sheetState]);

  // The layout box keeps its dimensions in every state so the pet window
  // math never shifts while the sheet loads or after a failure.
  if (sheetState === "error" && errorFallbackUrl) {
    return (
      <img
        className="pet-sprite pet-sprite-fallback"
        src={errorFallbackUrl}
        alt={alt}
        draggable={false}
        style={{ width, height, objectFit: "contain" }}
      />
    );
  }

  const column = Math.min(frame, Math.max(frameCount - 1, 0));
  const position = spriteFramePosition(column, row, columns, rows);

  return (
    <div
      className="pet-sprite"
      role="img"
      aria-label={alt}
      style={{
        width,
        height,
        backgroundImage: `url("${sheetUrl}")`,
        backgroundRepeat: "no-repeat",
        backgroundSize: spriteBackgroundSize(columns, rows),
        backgroundPosition: `${position.xPercent}% ${position.yPercent}%`
      }}
    />
  );
}

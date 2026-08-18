import { PetAnimationKey } from "../../shared/petAnimationKeys";
import { MINATO_AQUA_CATALOG, normalizeMappableAnimationKeys, type PetThemeCatalog } from "../../shared/petThemeCatalog";

// Random idle-animation rotation shared by the floating pet and settings
// preview: wait in the theme's normal idle pose, play one pool member for a
// random number of complete cycles, then return to normal idle before the
// next batch.
//
// The scheduler is React-free with injectable timers/rng so the choreography
// is unit-testable with fake timers.

export const IDLE_SPRITE_SHOW_MS = 2500;

export interface IdleAnimationConfig {
  enabled?: boolean;
  selectedSprites?: string[];
  intervalMin?: number;
  intervalMax?: number;
  repeatMin?: number;
  repeatMax?: number;
}

export interface IdleAnimationPlan {
  pool: PetAnimationKey[];
  intervalMinMs: number;
  intervalMaxMs: number;
  repeatMin: number;
  repeatMax: number;
  /** Complete cycle durations for spritesheet-backed animations. */
  animationDurationsMs?: Partial<Record<PetAnimationKey, number>>;
}

export function keepIdleAnimationConfigReference(
  previous: IdleAnimationConfig | null,
  next: IdleAnimationConfig | null
): IdleAnimationConfig | null {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

function toSeconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function toRepeat(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// Turn the persisted config into a runnable plan, or null when rotation should
// not run at all. Pool entries are validated against the active theme's
// catalog: invalid, theme-foreign, and drag-only locomotion values are
// dropped, and an empty pool disables rotation rather than inventing sprites.
export function planIdleAnimation(
  config: IdleAnimationConfig | null | undefined,
  catalog: PetThemeCatalog = MINATO_AQUA_CATALOG,
  animationDurationsMs?: Partial<Record<PetAnimationKey, number>>
): IdleAnimationPlan | null {
  if (!config?.enabled) return null;
  const pool = normalizeMappableAnimationKeys(catalog, config.selectedSprites);
  if (pool.length === 0) return null;
  const intervalMin = toSeconds(config.intervalMin, 20);
  const intervalMax = Math.max(intervalMin, toSeconds(config.intervalMax, intervalMin));
  const repeatMin = toRepeat(config.repeatMin, 1);
  const repeatMax = Math.max(repeatMin, toRepeat(config.repeatMax, repeatMin));
  const plan: IdleAnimationPlan = {
    pool,
    intervalMinMs: intervalMin * 1000,
    intervalMaxMs: intervalMax * 1000,
    repeatMin,
    repeatMax
  };
  const durations = Object.fromEntries(
    pool
      .filter(key => {
        const duration = animationDurationsMs?.[key];
        return typeof duration === "number" && Number.isFinite(duration) && duration > 0;
      })
      .map(key => [key, animationDurationsMs![key]])
  ) as Partial<Record<PetAnimationKey, number>>;
  if (Object.keys(durations).length > 0) plan.animationDurationsMs = durations;
  return plan;
}

// Start the rotation. A shuffle bag visits every selected sprite before a new
// bag starts, without repeating the last sprite across the boundary. Returns a
// stop function that cancels pending work and restores the normal idle pose.
export function startIdleAnimator(
  plan: IdleAnimationPlan,
  onAnimation: (key: PetAnimationKey | null) => void,
  rng: () => number = Math.random
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let displayedSprite: PetAnimationKey | null | undefined;
  let lastSprite: PetAnimationKey | null = null;
  let remainingSprites = [...plan.pool];

  function display(sprite: PetAnimationKey | null) {
    if (displayedSprite === sprite) return;
    displayedSprite = sprite;
    onAnimation(sprite);
  }

  function schedule(fn: () => void, delayMs: number) {
    timer = setTimeout(() => { if (!stopped) fn(); }, delayMs);
  }

  function scheduleNext() {
    schedule(playBatch, plan.intervalMinMs + rng() * (plan.intervalMaxMs - plan.intervalMinMs));
  }

  function takeNextSprite(): PetAnimationKey {
    if (remainingSprites.length === 0) {
      remainingSprites = [...plan.pool];
    }
    let index = Math.floor(rng() * remainingSprites.length);
    if (remainingSprites.length > 1 && remainingSprites[index] === lastSprite) {
      index = (index + 1) % remainingSprites.length;
    }
    const sprite = remainingSprites.splice(index, 1)[0];
    lastSprite = sprite;
    return sprite;
  }

  function playBatch() {
    const sprite = takeNextSprite();
    const span = plan.repeatMax - plan.repeatMin;
    const repeats = plan.repeatMin + (span > 0 ? Math.floor(rng() * (span + 1)) : 0);
    // Keep the same animation mounted for the entire batch. A spritesheet or
    // GIF can then complete each loop naturally instead of being interrupted
    // by an artificial idle gap between repeats.
    display(sprite);
    const cycleDuration = plan.animationDurationsMs?.[sprite] ?? IDLE_SPRITE_SHOW_MS;
    schedule(() => {
      display(null);
      scheduleNext();
    }, cycleDuration * repeats);
  }

  display(null);
  scheduleNext();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    display(null);
  };
}

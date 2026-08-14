import { PetAnimationKey } from "../../shared/petAnimationKeys";
import { MINATO_AQUA_CATALOG, normalizeMappableAnimationKeys, type PetThemeCatalog } from "../../shared/petThemeCatalog";

// Random idle-animation rotation shared by the floating pet and settings
// preview: hold the current sprite for a random interval, play the next pool
// member for a random number of beats, then keep it as the new current sprite.
//
// The scheduler is React-free with injectable timers/rng so the choreography
// is unit-testable with fake timers.

export const IDLE_SPRITE_SHOW_MS = 2500;
export const IDLE_SPRITE_GAP_MS = 1500;

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
  catalog: PetThemeCatalog = MINATO_AQUA_CATALOG
): IdleAnimationPlan | null {
  if (!config?.enabled) return null;
  const pool = normalizeMappableAnimationKeys(catalog, config.selectedSprites);
  if (pool.length === 0) return null;
  const intervalMin = toSeconds(config.intervalMin, 20);
  const intervalMax = Math.max(intervalMin, toSeconds(config.intervalMax, intervalMin));
  const repeatMin = toRepeat(config.repeatMin, 1);
  const repeatMax = Math.max(repeatMin, toRepeat(config.repeatMax, repeatMin));
  return {
    pool,
    intervalMinMs: intervalMin * 1000,
    intervalMaxMs: intervalMax * 1000,
    repeatMin,
    repeatMax
  };
}

// Start the rotation. The selected pool is the complete set of animations the
// idle pet may show. Each batch promotes its sprite to the resting pose for the
// next interval, and a shuffle bag visits every other selected sprite before
// any can repeat. Returns a stop function that cancels pending work and clears
// the current sprite when rotation itself stops.
export function startIdleAnimator(
  plan: IdleAnimationPlan,
  onAnimation: (key: PetAnimationKey | null) => void,
  rng: () => number = Math.random
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let currentSprite = plan.pool[Math.floor(rng() * plan.pool.length)];
  let remainingSprites = plan.pool.filter(sprite => sprite !== currentSprite);

  function schedule(fn: () => void, delayMs: number) {
    timer = setTimeout(() => { if (!stopped) fn(); }, delayMs);
  }

  function scheduleNext() {
    schedule(playBatch, plan.intervalMinMs + rng() * (plan.intervalMaxMs - plan.intervalMinMs));
  }

  function takeNextSprite(): PetAnimationKey {
    if (remainingSprites.length === 0) {
      remainingSprites = plan.pool.filter(sprite => sprite !== currentSprite);
    }
    const index = Math.floor(rng() * remainingSprites.length);
    return remainingSprites.splice(index, 1)[0];
  }

  function playBatch() {
    const previousSprite = currentSprite;
    const sprite = takeNextSprite();
    const span = plan.repeatMax - plan.repeatMin;
    const repeats = plan.repeatMin + (span > 0 ? Math.floor(rng() * (span + 1)) : 0);
    let count = 0;
    function show() {
      onAnimation(sprite);
      schedule(() => {
        count++;
        if (count < repeats) {
          onAnimation(previousSprite);
          schedule(show, IDLE_SPRITE_GAP_MS);
        } else {
          currentSprite = sprite;
          scheduleNext();
        }
      }, IDLE_SPRITE_SHOW_MS);
    }
    show();
  }

  onAnimation(currentSprite);
  if (plan.pool.length > 1) scheduleNext();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    onAnimation(null);
  };
}

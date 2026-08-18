import { PetAnimationKey } from "../../shared/petAnimationKeys";
import { MINATO_AQUA_CATALOG, normalizeMappableAnimationKeys, type PetThemeCatalog } from "../../shared/petThemeCatalog";

// Random idle-animation rotation shared by the floating pet and settings
// preview: choose one pool member immediately, keep it running for a random
// interval, then switch directly to the next pool member.
//
// The scheduler is React-free with injectable timers/rng so the choreography
// is unit-testable with fake timers.

export interface IdleAnimationConfig {
  enabled?: boolean;
  selectedSprites?: string[];
  intervalMin?: number;
  intervalMax?: number;
}

export interface IdleAnimationPlan {
  pool: PetAnimationKey[];
  intervalMinMs: number;
  intervalMaxMs: number;
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
  return {
    pool,
    intervalMinMs: intervalMin * 1000,
    intervalMaxMs: intervalMax * 1000
  };
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

  function playNext() {
    display(takeNextSprite());
    const duration = plan.intervalMinMs + rng() * (plan.intervalMaxMs - plan.intervalMinMs);
    schedule(playNext, duration);
  }

  playNext();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    display(null);
  };
}

import { describe, expect, it } from "vitest";
import { normalizeAnimationKeys, petAnimationOptions, toggleIdlePoolSprite } from "../src/renderer/clawd-migrated/utils/petAnimations";
import { planIdleAnimation } from "../src/renderer/state/petIdleAnimator";

describe("normalizeAnimationKeys: one empty-pool rule for UI, preview, and pet", () => {
  it("keeps canonical entries and dedupes", () => {
    expect(normalizeAnimationKeys(["idle", "extra_action_7", "extra_action_7"])).toEqual(["idle", "extra_action_7"]);
  });

  it("drops invalid entries without translating aliases", () => {
    expect(normalizeAnimationKeys(["retired-action", "thinking", "extra_action_8"])).toEqual(["extra_action_8"]);
  });

  it("returns an empty pool as empty — no fallback to 'all' or 'idle'", () => {
    // The old fallbacks made the settings UI show an empty pool as
    // all-selected while the preview rotated "idle"; both now see [] and
    // halt, matching the live pet.
    expect(normalizeAnimationKeys([])).toEqual([]);
    expect(normalizeAnimationKeys(undefined)).toEqual([]);
    expect(normalizeAnimationKeys(["bogus", "retired-action"])).toEqual([]);
  });

  it("agrees with the live pet: an empty persisted pool halts rotation everywhere", () => {
    const persisted = { enabled: true, selectedSprites: [] as string[], intervalMin: 10, intervalMax: 20 };
    expect(normalizeAnimationKeys(persisted.selectedSprites)).toEqual([]);
    expect(planIdleAnimation(persisted)).toBeNull();
  });
});

describe("toggleIdlePoolSprite: the pool never drops below one sprite", () => {
  it("adds and removes sprites normally", () => {
    expect(toggleIdlePoolSprite(["idle"], "extra_action_7")).toEqual(["idle", "extra_action_7"]);
    expect(toggleIdlePoolSprite(["idle", "extra_action_7"], "idle")).toEqual(["extra_action_7"]);
  });

  it("refuses to deselect the last remaining sprite, returning the same array", () => {
    // Disabling rotation is the master switch's job; the pool can no longer
    // reach the ambiguous empty state through the UI.
    const pool = ["extra_action_7"] as ReturnType<typeof normalizeAnimationKeys>;
    expect(toggleIdlePoolSprite(pool, "extra_action_7")).toBe(pool);
  });

  it("can walk down to exactly one sprite and back up to the full set", () => {
    let pool = petAnimationOptions.map(option => option.key);
    for (const option of petAnimationOptions.slice(1)) {
      pool = toggleIdlePoolSprite(pool, option.key);
    }
    expect(pool).toEqual([petAnimationOptions[0].key]);
    expect(toggleIdlePoolSprite(pool, petAnimationOptions[0].key)).toBe(pool);
  });
});

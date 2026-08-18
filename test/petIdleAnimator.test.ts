import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_SPRITE_GAP_MS,
  IDLE_SPRITE_SHOW_MS,
  keepIdleAnimationConfigReference,
  planIdleAnimation,
  startIdleAnimator,
  type IdleAnimationPlan
} from "../src/renderer/state/petIdleAnimator";
import { catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

// Deterministic rng: yields the given values in order, then 0.
function rngSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("planIdleAnimation: config → runnable plan", () => {
  const baseConfig = {
    enabled: true,
    selectedSprites: ["extra_action_7", "extra_action_8"],
    intervalMin: 10,
    intervalMax: 20,
    repeatMin: 1,
    repeatMax: 2
  };

  it("returns null when disabled or missing", () => {
    expect(planIdleAnimation(null)).toBeNull();
    expect(planIdleAnimation(undefined)).toBeNull();
    expect(planIdleAnimation({ ...baseConfig, enabled: false })).toBeNull();
  });

  it("builds the plan with seconds converted to milliseconds", () => {
    expect(planIdleAnimation(baseConfig)).toEqual({
      pool: ["extra_action_7", "extra_action_8"],
      intervalMinMs: 10_000,
      intervalMaxMs: 20_000,
      repeatMin: 1,
      repeatMax: 2
    });
  });

  it("drops non-canonical pool entries (canonical-only, no alias translation) and dedupes", () => {
    const plan = planIdleAnimation({
      ...baseConfig,
      selectedSprites: ["retired-action", "thinking", "extra_action_8", "extra_action_8", "bogus"]
    });
    expect(plan?.pool).toEqual(["extra_action_8"]);
  });

  it("disables rotation entirely when no valid sprite remains", () => {
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: [] })).toBeNull();
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["retired-action", "nope"] })).toBeNull();
  });

  it("keeps the interval ordered and the repeat counts sane", () => {
    const plan = planIdleAnimation({ ...baseConfig, intervalMin: 30, intervalMax: 10, repeatMin: 0, repeatMax: -2 });
    expect(plan).toMatchObject({ intervalMinMs: 30_000, intervalMaxMs: 30_000, repeatMin: 1, repeatMax: 1 });
  });

  it("scopes the pool to the active theme's catalog", () => {
    const packCatalog = catalogFromPetPack(makePackManifest());
    const mixed = { ...baseConfig, selectedSprites: ["idle", "jumping", "extra_action_7"] };
    // Under the pack catalog the built-in-only key drops out; under the
    // default built-in catalog the pack-only key drops out instead.
    expect(planIdleAnimation(mixed, packCatalog)?.pool).toEqual(["idle", "jumping"]);
    expect(planIdleAnimation(mixed)?.pool).toEqual(["idle", "extra_action_7"]);
    // A pool of purely foreign keys halts rotation, same as an empty pool.
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["extra_action_7"] }, packCatalog)).toBeNull();
    // Drag-only locomotion keys drop out of the pool exactly like foreign
    // keys — a stationary idle pet must never walk in place.
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["running_left", "running_right", "waving"] }, packCatalog)?.pool)
      .toEqual(["waving"]);
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["running_left"] }, packCatalog)).toBeNull();
  });
});

describe("keepIdleAnimationConfigReference", () => {
  const config = {
    enabled: true,
    selectedSprites: ["extra_action_7", "extra_action_8"],
    intervalMin: 10,
    intervalMax: 20,
    repeatMin: 1,
    repeatMax: 2
  };

  it("keeps the stable reference for an equivalent settings broadcast", () => {
    const equivalent = { ...config, selectedSprites: [...config.selectedSprites] };
    expect(keepIdleAnimationConfigReference(config, equivalent)).toBe(config);
  });

  it("uses the new reference when the idle configuration changes", () => {
    const changed = { ...config, selectedSprites: ["extra_action_8"] };
    expect(keepIdleAnimationConfigReference(config, changed)).toBe(changed);
  });
});

describe("startIdleAnimator: selected-pool choreography", () => {
  const plan: IdleAnimationPlan = {
    pool: ["extra_action_7", "extra_action_8"],
    intervalMinMs: 10_000,
    intervalMaxMs: 20_000,
    repeatMin: 2,
    repeatMax: 2
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("waits in the normal idle pose, then returns to it between repeats", () => {
    const seen: Array<string | null> = [];
    // rng: 0.5 -> delay 15s; 0.9 -> sprite 1.
    const stop = startIdleAnimator(plan, key => seen.push(key), rngSequence([0.5, 0.9]));

    expect(seen).toEqual([null]);

    vi.advanceTimersByTime(14_999);
    expect(seen).toEqual([null]);

    vi.advanceTimersByTime(1);
    expect(seen).toEqual([null, "extra_action_8"]);

    vi.advanceTimersByTime(IDLE_SPRITE_SHOW_MS);
    expect(seen).toEqual([null, "extra_action_8", null]);

    // The same action restarts after a normal-idle gap.
    vi.advanceTimersByTime(IDLE_SPRITE_GAP_MS);
    expect(seen).toEqual([null, "extra_action_8", null, "extra_action_8"]);

    vi.advanceTimersByTime(IDLE_SPRITE_SHOW_MS);
    expect(seen).toEqual([null, "extra_action_8", null, "extra_action_8", null]);

    // The next interval is entirely normal idle.
    vi.advanceTimersByTime(9_999);
    expect(seen.at(-1)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBe("extra_action_7");

    stop();
  });

  it("plays a single selected sprite as a temporary action on every interval", () => {
    const seen: Array<string | null> = [];
    const singleSprite: IdleAnimationPlan = {
      ...plan,
      pool: ["extra_action_8"],
      intervalMinMs: 10_000,
      intervalMaxMs: 10_000,
      repeatMin: 1,
      repeatMax: 1
    };
    const stop = startIdleAnimator(singleSprite, key => seen.push(key), rngSequence([0, 0, 0]));

    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual([null, "extra_action_8"]);
    vi.advanceTimersByTime(IDLE_SPRITE_SHOW_MS);
    expect(seen).toEqual([null, "extra_action_8", null]);
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual([null, "extra_action_8", null, "extra_action_8"]);

    stop();
    expect(seen.at(-1)).toBeNull();
  });

  it("clears a deselected active sprite when the plan restarts", () => {
    const seen: Array<string | null> = [];
    const fixed = { ...plan, intervalMinMs: 10_000, intervalMaxMs: 10_000, repeatMin: 1, repeatMax: 1 };
    const stopA = startIdleAnimator({ ...fixed, pool: ["extra_action_7"] }, key => seen.push(key), rngSequence([0, 0]));
    vi.advanceTimersByTime(10_000);
    expect(seen.at(-1)).toBe("extra_action_7");

    stopA();
    const stopRemaining = startIdleAnimator({ ...fixed, pool: ["extra_action_aqua_bocchi", "extra_action_8"] }, key => seen.push(key), rngSequence([0, 0.99]));
    expect(seen.at(-1)).toBeNull();

    stopRemaining();
  });

  it("schedules the next transition after the completed batch's full interval", () => {
    const seen: Array<string | null> = [];
    const singleRepeat: IdleAnimationPlan = {
      ...plan,
      intervalMinMs: 10_000,
      intervalMaxMs: 10_000,
      repeatMin: 1,
      repeatMax: 1
    };
    const stop = startIdleAnimator(singleRepeat, key => seen.push(key), rngSequence([0, 0.9, 0]));

    vi.advanceTimersByTime(10_000 + IDLE_SPRITE_SHOW_MS);
    expect(seen).toEqual([null, "extra_action_8", null]);

    vi.advanceTimersByTime(9_999);
    expect(seen).toEqual([null, "extra_action_8", null]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([null, "extra_action_8", null, "extra_action_7"]);

    stop();
  });

  it("visits every selected sprite before repeating one", () => {
    const seen: Array<string | null> = [];
    const threeSprites: IdleAnimationPlan = {
      ...plan,
      pool: ["extra_action_7", "extra_action_aqua_bocchi", "extra_action_8"],
      intervalMinMs: 10_000,
      intervalMaxMs: 10_000,
      repeatMin: 1,
      repeatMax: 1
    };
    // Take 7, 8 and Aqua from the first shuffle bag. Only after all three have
    // appeared may the refilled bag select 7 again.
    const stop = startIdleAnimator(threeSprites, key => seen.push(key), rngSequence([
      0, 0.99, 0,
      0.99, 0,
      0, 0,
      0.99
    ]));

    vi.advanceTimersByTime(3 * (10_000 + IDLE_SPRITE_SHOW_MS));
    expect(seen).toEqual([
      null,
      "extra_action_8", null,
      "extra_action_aqua_bocchi", null,
      "extra_action_7", null
    ]);

    vi.advanceTimersByTime(10_000);
    expect(seen.at(-1)).toBe("extra_action_8");

    stop();
  });

  it("rolls the repeat count within repeatMin..repeatMax", () => {
    const seen: Array<string | null> = [];
    const variable: IdleAnimationPlan = { ...plan, repeatMin: 1, repeatMax: 3 };
    // delay rng 0 -> 10s; sprite rng 0.9 -> extra_action_8; repeat rng 0.99
    // -> 1 + floor(0.99*3) = 3.
    const stop = startIdleAnimator(variable, key => seen.push(key), rngSequence([0, 0.9, 0.99]));

    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(3 * IDLE_SPRITE_SHOW_MS + 2 * IDLE_SPRITE_GAP_MS);
    expect(seen).toEqual([
      null,
      "extra_action_8", null,
      "extra_action_8", null,
      "extra_action_8", null
    ]);

    stop();
  });

  it("stop() cancels pending work and clears the current sprite", () => {
    const seen: Array<string | null> = [];
    const stop = startIdleAnimator(plan, key => seen.push(key), rngSequence([0, 0, 0]));

    expect(seen).toEqual([null]);

    stop();
    expect(seen).toEqual([null]);

    // Nothing fires after stop, even across a long horizon.
    vi.advanceTimersByTime(600_000);
    expect(seen).toEqual([null]);
  });
});

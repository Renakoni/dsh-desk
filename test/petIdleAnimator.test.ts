import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepIdleAnimationConfigReference,
  planIdleAnimation,
  startIdleAnimator,
  type IdleAnimationPlan
} from "../src/renderer/state/petIdleAnimator";
import { catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

function rngSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("planIdleAnimation: config to runnable plan", () => {
  const baseConfig = {
    enabled: true,
    selectedSprites: ["extra_action_7", "extra_action_8"],
    intervalMin: 10,
    intervalMax: 20
  };

  it("returns null when disabled or missing", () => {
    expect(planIdleAnimation(null)).toBeNull();
    expect(planIdleAnimation(undefined)).toBeNull();
    expect(planIdleAnimation({ ...baseConfig, enabled: false })).toBeNull();
  });

  it("builds a switch interval in milliseconds", () => {
    expect(planIdleAnimation(baseConfig)).toEqual({
      pool: ["extra_action_7", "extra_action_8"],
      intervalMinMs: 10_000,
      intervalMaxMs: 20_000
    });
  });

  it("drops invalid entries and disables an empty pool", () => {
    expect(planIdleAnimation({
      ...baseConfig,
      selectedSprites: ["retired-action", "extra_action_8", "extra_action_8", "bogus"]
    })?.pool).toEqual(["extra_action_8"]);
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: [] })).toBeNull();
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["retired-action", "nope"] })).toBeNull();
  });

  it("keeps the switch interval ordered", () => {
    expect(planIdleAnimation({ ...baseConfig, intervalMin: 30, intervalMax: 10 })).toMatchObject({
      intervalMinMs: 30_000,
      intervalMaxMs: 30_000
    });
  });

  it("scopes the pool to the active theme catalog", () => {
    const packCatalog = catalogFromPetPack(makePackManifest());
    const mixed = { ...baseConfig, selectedSprites: ["idle", "jumping", "extra_action_7"] };
    expect(planIdleAnimation(mixed, packCatalog)?.pool).toEqual(["idle", "jumping"]);
    expect(planIdleAnimation(mixed)?.pool).toEqual(["idle", "extra_action_7"]);
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["extra_action_7"] }, packCatalog)).toBeNull();
    expect(planIdleAnimation({ ...baseConfig, selectedSprites: ["running_left", "running_right", "waving"] }, packCatalog)?.pool)
      .toEqual(["waving"]);
  });
});

describe("keepIdleAnimationConfigReference", () => {
  const config = {
    enabled: true,
    selectedSprites: ["extra_action_7", "extra_action_8"],
    intervalMin: 10,
    intervalMax: 20
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

describe("startIdleAnimator: continuous pool rotation", () => {
  const plan: IdleAnimationPlan = {
    pool: ["extra_action_7", "extra_action_8"],
    intervalMinMs: 10_000,
    intervalMaxMs: 20_000
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("selects immediately and switches directly without inserting idle", () => {
    const seen: Array<string | null> = [];
    // Sprite 8 for 15 seconds, then sprite 7 for 10 seconds.
    const stop = startIdleAnimator(plan, key => seen.push(key), rngSequence([0.9, 0.5, 0, 0]));

    expect(seen).toEqual(["extra_action_8"]);
    vi.advanceTimersByTime(14_999);
    expect(seen).toEqual(["extra_action_8"]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["extra_action_8", "extra_action_7"]);
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual(["extra_action_8", "extra_action_7", "extra_action_8"]);

    stop();
    expect(seen.at(-1)).toBeNull();
  });

  it("keeps a single selected animation mounted continuously", () => {
    const seen: Array<string | null> = [];
    const stop = startIdleAnimator({ ...plan, pool: ["extra_action_8"] }, key => seen.push(key), rngSequence([0, 0]));

    expect(seen).toEqual(["extra_action_8"]);
    vi.advanceTimersByTime(600_000);
    expect(seen).toEqual(["extra_action_8"]);

    stop();
    expect(seen).toEqual(["extra_action_8", null]);
  });

  it("treats idle as a normal pool member instead of a forced gap", () => {
    const seen: Array<string | null> = [];
    const withIdle: IdleAnimationPlan = {
      pool: ["extra_action_8", "idle"],
      intervalMinMs: 10_000,
      intervalMaxMs: 10_000
    };
    const stop = startIdleAnimator(withIdle, key => seen.push(key), rngSequence([0, 0, 0, 0]));

    expect(seen).toEqual(["extra_action_8"]);
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual(["extra_action_8", "idle"]);

    stop();
  });

  it("visits every selected sprite before repeating one", () => {
    const seen: Array<string | null> = [];
    const threeSprites: IdleAnimationPlan = {
      pool: ["extra_action_7", "extra_action_aqua_bocchi", "extra_action_8"],
      intervalMinMs: 10_000,
      intervalMaxMs: 10_000
    };
    const stop = startIdleAnimator(threeSprites, key => seen.push(key), rngSequence([
      0.99, 0,
      0.99, 0,
      0, 0,
      0.99, 0
    ]));

    expect(seen).toEqual(["extra_action_8"]);
    vi.advanceTimersByTime(20_000);
    expect(seen).toEqual(["extra_action_8", "extra_action_aqua_bocchi", "extra_action_7"]);
    vi.advanceTimersByTime(10_000);
    expect(seen.at(-1)).toBe("extra_action_8");

    stop();
  });

  it("stop cancels pending switches and restores the normal idle pose", () => {
    const seen: Array<string | null> = [];
    const stop = startIdleAnimator(plan, key => seen.push(key), rngSequence([0, 0]));

    expect(seen).toEqual(["extra_action_7"]);
    stop();
    expect(seen).toEqual(["extra_action_7", null]);
    vi.advanceTimersByTime(600_000);
    expect(seen).toEqual(["extra_action_7", null]);
  });
});

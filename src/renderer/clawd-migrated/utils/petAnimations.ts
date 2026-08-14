import type { PetState } from "../../shared/events";
import { isPetAnimationKey, type PetAnimationKey } from "../../../shared/petAnimationKeys";
import {
  MINATO_AQUA_CATALOG,
  mappableCatalogKeys,
  normalizeMappableAnimationKeys,
  type PetThemeCatalog
} from "../../../shared/petThemeCatalog";

export type { PetAnimationKey } from "../../../shared/petAnimationKeys";

// Labels are keyed by the shared canonical superset, so adding a key there
// forces a label here and no theme's picker can ever miss one. Which subset a
// picker actually shows comes from the active theme's catalog.
const animationLabels: Record<PetAnimationKey, { labelKey: string; fallback: string }> = {
  idle: { labelKey: "animation.sprite.idle", fallback: "待机" },
  running: { labelKey: "animation.sprite.running", fallback: "运行中" },
  waiting_permission: { labelKey: "animation.sprite.permission", fallback: "权限请求" },
  done: { labelKey: "animation.sprite.done", fallback: "完成" },
  extra_action_5: { labelKey: "animation.sprite.extra5", fallback: "附加动作 5" },
  extra_action_7: { labelKey: "animation.sprite.extra7", fallback: "附加动作 7" },
  extra_action_8: { labelKey: "animation.sprite.extra8", fallback: "附加动作 8" },
  extra_action_9: { labelKey: "animation.sprite.extra9", fallback: "附加动作 9" },
  extra_action_aqua_bocchi: { labelKey: "animation.sprite.aquaBocchi", fallback: "Aqua 趴姿" },
  extra_action_aqua_pixel: { labelKey: "animation.sprite.aquaPixel", fallback: "Aqua 像素" },
  running_right: { labelKey: "animation.sprite.runningRight", fallback: "向右跑" },
  running_left: { labelKey: "animation.sprite.runningLeft", fallback: "向左跑" },
  waving: { labelKey: "animation.sprite.waving", fallback: "挥手" },
  jumping: { labelKey: "animation.sprite.jumping", fallback: "跳跃" },
  failed: { labelKey: "animation.sprite.failed", fallback: "沮丧" },
  review: { labelKey: "animation.sprite.review", fallback: "审阅" }
};

export interface PetAnimationOption {
  key: PetAnimationKey;
  labelKey: string;
  fallback: string;
}

/** Picker options for one theme, in the catalog's display order. */
export function petAnimationOptionsForCatalog(catalog: PetThemeCatalog): PetAnimationOption[] {
  return catalog.keys.map(key => ({ key, ...animationLabels[key] }));
}

/**
 * Options usable as standalone actions (mapping slots, idle pool). The
 * drag-only locomotion keys stay out — they are drag feedback in the
 * codex-pet template, not actions; the Animation Test keeps the full list.
 */
export function petAnimationMappableOptionsForCatalog(catalog: PetThemeCatalog): PetAnimationOption[] {
  return mappableCatalogKeys(catalog).map(key => ({ key, ...animationLabels[key] }));
}

// The panel currently always shows the built-in theme's options; the active
// catalog gets threaded through with the theme picker UI.
export const petAnimationOptions: PetAnimationOption[] = petAnimationOptionsForCatalog(MINATO_AQUA_CATALOG);

// Validation only, against the canonical superset: a canonical key passes
// through unchanged; anything else — including historical alias names — is
// invalid and yields the fallback. (Pool and mapping values go through the
// catalog-scoped helpers instead.)
export function normalizeAnimationKey(value: string | null | undefined, fallback: PetAnimationKey = "running"): PetAnimationKey {
  return isPetAnimationKey(value) ? value : fallback;
}

export function normalizeAnimationKeys(values: string[] | undefined, catalog: PetThemeCatalog = MINATO_AQUA_CATALOG): PetAnimationKey[] {
  // Validation only: invalid and drag-only entries are dropped, never
  // translated, and an empty result stays empty. An empty pool means rotation
  // cannot run — the same rule for the settings UI, the panel preview, and
  // the live pet.
  return normalizeMappableAnimationKeys(catalog, values);
}

// Toggle a sprite in the idle pool. The pool never drops below one sprite:
// turning rotation off is the master switch's job, not an implicit side
// effect of emptying the pool. Returns the SAME array when the toggle is
// blocked so callers can skip saving.
export function toggleIdlePoolSprite(pool: PetAnimationKey[], key: PetAnimationKey): PetAnimationKey[] {
  if (pool.includes(key)) {
    return pool.length === 1 ? pool : pool.filter(sprite => sprite !== key);
  }
  return [...pool, key];
}

export function animationKeyForPetState(state: PetState): PetAnimationKey {
  if (state === "idle") return "idle";
  if (state === "waiting_permission") return "waiting_permission";
  if (state === "done") return "done";
  return "running";
}

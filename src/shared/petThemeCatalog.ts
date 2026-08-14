/**
 * Per-theme animation catalogs.
 *
 * PET_ANIMATION_KEYS is the closed canonical superset; a catalog says which
 * of those keys the active theme actually provides, plus which key each pet
 * STATE plays by default (role defaults). All animation validation is scoped
 * to the active catalog: a key that is canonical but not provided by the
 * theme is just as invalid as an unknown string — callers fall back, never
 * translate.
 *
 * Role defaults are where per-theme behavior differences live: the built-in
 * clip theme has a dedicated `done` clip and reuses `running` for errors,
 * while imported codex-pet packs celebrate completion with `jumping` and
 * show `failed` on errors (resolved with fallback chains at import time).
 */

import { isPetAnimationKey, type PetAnimationKey } from "./petAnimationKeys";
import type { PetPackManifest } from "./petPack";

export type PetThemeSource = "builtin-clips" | "codex-pet-pack";

/** The five pet states every theme must resolve to some animation. */
export interface PetThemeRoleDefaults {
  idle: PetAnimationKey;
  running: PetAnimationKey;
  waiting_permission: PetAnimationKey;
  done: PetAnimationKey;
  error: PetAnimationKey;
}

export interface PetThemeCatalog {
  themeId: string;
  source: PetThemeSource;
  /** Keys this theme provides, in picker display order. */
  keys: readonly PetAnimationKey[];
  roleDefaults: PetThemeRoleDefaults;
}

export const BUILTIN_PET_THEME_ID = "minato-aqua";
/** Display name of the built-in theme (shared by the theme registry and the tray). */
export const BUILTIN_PET_THEME_NAME = "Minato Aqua";

/**
 * Theme-identity namespace for imported packs. Pack ids are sanitized slugs
 * ([a-z0-9-_], no colon), so the prefixed form can never collide with a
 * built-in theme id — even for a pack whose own id IS "minato-aqua". The
 * filesystem/store keeps using the bare pack id; only theme identity (the
 * registry, catalogs, and settings.petTheme) uses the namespaced form.
 */
export const PET_PACK_THEME_PREFIX = "codex-pet:";

/** Theme id for an installed pack: codex-pet:<packId>. */
export function petPackThemeId(packId: string): string {
  return `${PET_PACK_THEME_PREFIX}${packId}`;
}

/** The bare pack id inside a namespaced theme id, or null for anything else. */
export function packIdFromThemeId(themeId: unknown): string | null {
  if (typeof themeId !== "string" || !themeId.startsWith(PET_PACK_THEME_PREFIX)) return null;
  const packId = themeId.slice(PET_PACK_THEME_PREFIX.length);
  return packId.length > 0 ? packId : null;
}

export const MINATO_AQUA_CATALOG: PetThemeCatalog = {
  themeId: BUILTIN_PET_THEME_ID,
  source: "builtin-clips",
  keys: [
    "idle",
    "running",
    "waiting_permission",
    "done",
    "extra_action_5",
    "extra_action_7",
    "extra_action_8",
    "extra_action_9",
    "extra_action_aqua_bocchi",
    "extra_action_aqua_pixel"
  ],
  roleDefaults: {
    idle: "idle",
    running: "running",
    waiting_permission: "waiting_permission",
    done: "done",
    error: "running"
  }
};

/** Catalog view of an installed codex-pet pack manifest. */
export function catalogFromPetPack(pack: PetPackManifest): PetThemeCatalog {
  return {
    themeId: petPackThemeId(pack.id),
    source: "codex-pet-pack",
    keys: pack.animations.map(animation => animation.key),
    roleDefaults: pack.roleDefaults
  };
}

/**
 * The active theme's catalog: an installed pack when the theme id carries the
 * pack namespace and names an installed pack, otherwise the built-in theme
 * (also the fallback for unknown or un-namespaced ids).
 */
export function resolveThemeCatalog(themeId: unknown, packs: readonly PetPackManifest[] = []): PetThemeCatalog {
  const packId = packIdFromThemeId(themeId);
  if (packId) {
    const pack = packs.find(candidate => candidate.id === packId);
    if (pack) return catalogFromPetPack(pack);
  }
  return MINATO_AQUA_CATALOG;
}

/**
 * Interaction-reserved keys: the codex-pet template's drag-direction
 * locomotion rows. The official player only ever plays them while the pet is
 * being dragged horizontally, so they are not standalone actions: mapping
 * slots and the idle pool exclude them. They stay playback-valid — the
 * Animation Test can preview them, and drag feedback will consume them.
 */
export const INTERACTION_ANIMATION_KEYS: readonly PetAnimationKey[] = ["running_right", "running_left"];

/** Keys offered as standalone actions: the catalog minus interaction keys. */
export function mappableCatalogKeys(catalog: PetThemeCatalog): PetAnimationKey[] {
  return catalog.keys.filter(key => !INTERACTION_ANIMATION_KEYS.includes(key));
}

/** Canonical AND provided by this theme. */
export function isCatalogAnimationKey(catalog: PetThemeCatalog, value: unknown): value is PetAnimationKey {
  return isPetAnimationKey(value) && catalog.keys.includes(value);
}

/** Provided by this theme AND usable as a standalone action. */
export function isMappableCatalogAnimationKey(catalog: PetThemeCatalog, value: unknown): value is PetAnimationKey {
  return isCatalogAnimationKey(catalog, value) && !INTERACTION_ANIMATION_KEYS.includes(value);
}

/** Mapping-slot validation: interaction keys fall back like foreign keys. */
export function normalizeMappableAnimationKey(
  catalog: PetThemeCatalog,
  value: string | null | undefined,
  fallback: PetAnimationKey
): PetAnimationKey {
  return isMappableCatalogAnimationKey(catalog, value) ? value : fallback;
}

/** Pool validation: interaction keys are dropped like foreign keys. */
export function normalizeMappableAnimationKeys(catalog: PetThemeCatalog, values: string[] | undefined): PetAnimationKey[] {
  return [...new Set((values ?? []).filter(value => isMappableCatalogAnimationKey(catalog, value)))];
}

/** Validation only: a provided key passes through; anything else falls back. */
export function normalizeCatalogAnimationKey(
  catalog: PetThemeCatalog,
  value: string | null | undefined,
  fallback: PetAnimationKey
): PetAnimationKey {
  return isCatalogAnimationKey(catalog, value) ? value : fallback;
}

/** Validation only: invalid or theme-foreign entries are dropped, never translated. */
export function normalizeCatalogAnimationKeys(catalog: PetThemeCatalog, values: string[] | undefined): PetAnimationKey[] {
  return [...new Set((values ?? []).filter(value => isCatalogAnimationKey(catalog, value)))];
}

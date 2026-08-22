/**
 * Per-theme animation profile switching.
 *
 * settings.stateAnimations and settings.idleAnim stay the single runtime
 * source every consumer already reads; themeAnimationProfiles is the
 * per-theme store behind them. When the active theme changes, the outgoing
 * theme's values are snapshotted into the store and the incoming theme's
 * stored values (or its first-activation defaults) are swapped in — so
 * remapping under one theme can never corrupt another's setup.
 */

import { defaultIdlePool, type PetPackManifest } from "../shared/petPack";
import { packIdFromThemeId } from "../shared/petThemeCatalog";

interface ThemeAnimationProfile {
  stateAnimations: Record<string, string>;
  idleAnim: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultIdleAnimFor(theme: string, packs: readonly PetPackManifest[]): unknown {
  const packId = packIdFromThemeId(theme);
  const pack = packId ? packs.find(candidate => candidate.id === packId) : undefined;
  if (pack) {
    return {
      enabled: true,
      selectedSprites: defaultIdlePool(pack.animations),
      intervalMin: 12,
      intervalMax: 28
    };
  }
  // The schema default follows the bundled whale because that is the first
  // pet on a fresh install. Aqua keeps its own built-in action pool when it is
  // selected later.
  return {
    enabled: true,
    selectedSprites: ["idle", "running", "waiting_permission", "done", "extra_action_7", "extra_action_8", "extra_action_aqua_bocchi"],
    intervalMin: 12,
    intervalMax: 28
  };
}

/**
 * Apply a theme change to a merged settings object: snapshot the previous
 * theme's animation fields and activate the next theme's profile. Returns
 * the settings unchanged when the theme did not actually change.
 */
export function applyThemeAnimationProfileSwitch(
  settings: Record<string, any>,
  previousTheme: string,
  packs: readonly PetPackManifest[]
): Record<string, any> {
  const nextTheme = typeof settings.petTheme === "string" ? settings.petTheme : "";
  if (!nextTheme || nextTheme === previousTheme) return settings;

  const profiles: Record<string, ThemeAnimationProfile> = isPlainObject(settings.themeAnimationProfiles)
    ? { ...(settings.themeAnimationProfiles as Record<string, ThemeAnimationProfile>) }
    : {};

  profiles[previousTheme] = {
    stateAnimations: isPlainObject(settings.stateAnimations) ? settings.stateAnimations as Record<string, string> : {},
    idleAnim: settings.idleAnim ?? null
  };

  const stored = profiles[nextTheme];
  const stateAnimations = stored && isPlainObject(stored.stateAnimations) ? stored.stateAnimations : {};
  const idleAnim = stored && stored.idleAnim ? stored.idleAnim : defaultIdleAnimFor(nextTheme, packs);

  return { ...settings, themeAnimationProfiles: profiles, stateAnimations, idleAnim };
}

import { describe, expect, it } from "vitest";
import { DEFAULT_COMPANION_SETTINGS } from "../src/main/companionSettingsSchema";
import { applyThemeAnimationProfileSwitch } from "../src/main/themeProfiles";
import { makePackManifest } from "./helpers/packFixtures";

const PACK_THEME = "codex-pet:yuexinmiao";
const BUILTIN = "minato-aqua";
const packs = [makePackManifest()];

const aquaMappings = { running: "extra_action_5" };
const aquaIdle = { enabled: true, selectedSprites: ["idle", "extra_action_9"], intervalMin: 10, intervalMax: 20, repeatMin: 1, repeatMax: 2 };

function builtinSettings() {
  return {
    petTheme: BUILTIN,
    stateAnimations: { ...aquaMappings },
    idleAnim: { ...aquaIdle },
    themeAnimationProfiles: {}
  };
}

describe("applyThemeAnimationProfileSwitch", () => {
  it("returns the settings unchanged when the theme did not change", () => {
    const settings = builtinSettings();
    expect(applyThemeAnimationProfileSwitch(settings, BUILTIN, packs)).toBe(settings);
  });

  it("snapshots the outgoing theme and activates pack defaults on first activation", () => {
    const settings = { ...builtinSettings(), petTheme: PACK_THEME };
    const switched = applyThemeAnimationProfileSwitch(settings, BUILTIN, packs);

    // The built-in setup is preserved in the store, untouched.
    expect(switched.themeAnimationProfiles[BUILTIN]).toEqual({ stateAnimations: aquaMappings, idleAnim: aquaIdle });
    // The pack starts clean: role defaults apply, idle pool = its calm rows.
    expect(switched.stateAnimations).toEqual({});
    expect(switched.idleAnim).toMatchObject({ enabled: true, selectedSprites: ["idle", "waving", "jumping", "review"] });
  });

  it("restores a stored profile instead of defaults", () => {
    const packMappings = { jumping: "review" };
    const packIdle = { enabled: false, selectedSprites: ["waving"], intervalMin: 5, intervalMax: 9, repeatMin: 2, repeatMax: 3 };
    const settings = {
      ...builtinSettings(),
      petTheme: PACK_THEME,
      themeAnimationProfiles: { [PACK_THEME]: { stateAnimations: packMappings, idleAnim: packIdle } }
    };
    const switched = applyThemeAnimationProfileSwitch(settings, BUILTIN, packs);
    expect(switched.stateAnimations).toEqual(packMappings);
    expect(switched.idleAnim).toEqual(packIdle);
  });

  it("round-trips: switching away and back restores the exact setup", () => {
    const toPack = applyThemeAnimationProfileSwitch({ ...builtinSettings(), petTheme: PACK_THEME }, BUILTIN, packs);
    const backToBuiltin = applyThemeAnimationProfileSwitch({ ...toPack, petTheme: BUILTIN }, PACK_THEME, packs);
    expect(backToBuiltin.stateAnimations).toEqual(aquaMappings);
    expect(backToBuiltin.idleAnim).toEqual(aquaIdle);
    // And the pack's (default) profile is now stored for its next activation.
    expect(backToBuiltin.themeAnimationProfiles[PACK_THEME]).toEqual({
      stateAnimations: {},
      idleAnim: toPack.idleAnim
    });
  });

  it("falls back to the built-in defaults for an unknown or uninstalled pack theme", () => {
    const settings = { ...builtinSettings(), petTheme: "codex-pet:ghost" };
    const switched = applyThemeAnimationProfileSwitch(settings, BUILTIN, packs);
    expect(switched.stateAnimations).toEqual({});
    expect(switched.idleAnim).toEqual(DEFAULT_COMPANION_SETTINGS.idleAnim);
    // Deep copy, never the shared defaults object itself.
    expect(switched.idleAnim).not.toBe(DEFAULT_COMPANION_SETTINGS.idleAnim);
  });

  it("activating the built-in for the first time uses the schema default idle config", () => {
    const settings = {
      petTheme: BUILTIN,
      stateAnimations: { jumping: "review" },
      idleAnim: { enabled: true, selectedSprites: ["jumping"] },
      themeAnimationProfiles: {}
    };
    const switched = applyThemeAnimationProfileSwitch(settings, PACK_THEME, packs);
    expect(switched.stateAnimations).toEqual({});
    expect(switched.idleAnim).toEqual(DEFAULT_COMPANION_SETTINGS.idleAnim);
    expect(switched.themeAnimationProfiles[PACK_THEME]).toEqual({
      stateAnimations: { jumping: "review" },
      idleAnim: { enabled: true, selectedSprites: ["jumping"] }
    });
  });
});

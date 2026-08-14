import { describe, expect, it } from "vitest";
import { PET_ANIMATION_KEYS } from "../src/shared/petAnimationKeys";
import {
  BUILTIN_PET_THEME_ID,
  MINATO_AQUA_CATALOG,
  catalogFromPetPack,
  isCatalogAnimationKey,
  isMappableCatalogAnimationKey,
  mappableCatalogKeys,
  normalizeCatalogAnimationKey,
  normalizeCatalogAnimationKeys,
  normalizeMappableAnimationKey,
  normalizeMappableAnimationKeys,
  packIdFromThemeId,
  petPackThemeId,
  resolveThemeCatalog,
  type PetThemeCatalog
} from "../src/shared/petThemeCatalog";
import { petAnimationOptionsForCatalog } from "../src/renderer/clawd-migrated/utils/petAnimations";
import { getPetTheme, listPetThemes, petThemeFromPack } from "../src/renderer/clawd-migrated/utils/petThemes";
import { makePackManifest } from "./helpers/packFixtures";

describe("built-in catalog contract", () => {
  it("pins the built-in theme's keys and role defaults", () => {
    expect(MINATO_AQUA_CATALOG.themeId).toBe(BUILTIN_PET_THEME_ID);
    expect(MINATO_AQUA_CATALOG.source).toBe("builtin-clips");
    expect(MINATO_AQUA_CATALOG.keys).toEqual([
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
    ]);
    // The built-in theme has no dedicated error clip; errors reuse running.
    expect(MINATO_AQUA_CATALOG.roleDefaults).toEqual({
      idle: "idle",
      running: "running",
      waiting_permission: "waiting_permission",
      done: "done",
      error: "running"
    });
  });
});

describe("pack theme identity", () => {
  it("namespaces pack theme ids and parses them back", () => {
    expect(petPackThemeId("yuexinmiao")).toBe("codex-pet:yuexinmiao");
    expect(packIdFromThemeId("codex-pet:yuexinmiao")).toBe("yuexinmiao");
    expect(packIdFromThemeId("yuexinmiao")).toBeNull();
    expect(packIdFromThemeId(BUILTIN_PET_THEME_ID)).toBeNull();
    expect(packIdFromThemeId("codex-pet:")).toBeNull();
    expect(packIdFromThemeId(42)).toBeNull();
  });
});

describe("catalogFromPetPack", () => {
  it("exposes the pack's animations and role defaults", () => {
    const catalog = catalogFromPetPack(makePackManifest());
    expect(catalog.themeId).toBe("codex-pet:yuexinmiao");
    expect(catalog.source).toBe("codex-pet-pack");
    expect(catalog.keys).toEqual([
      "idle",
      "running_right",
      "running_left",
      "waving",
      "jumping",
      "failed",
      "waiting_permission",
      "running",
      "review"
    ]);
    expect(catalog.roleDefaults).toEqual({
      idle: "idle",
      running: "running",
      waiting_permission: "waiting_permission",
      done: "jumping",
      error: "failed"
    });
  });

  it("omits rows the pack does not provide", () => {
    // Only idle, waving, and running-right have visible frames.
    const catalog = catalogFromPetPack(makePackManifest([4, 6, 0, 5, 0, 0, 0, 0, 0]));
    expect(catalog.keys).toEqual(["idle", "running_right", "waving"]);
    expect(catalog.roleDefaults.done).toBe("waving");
  });
});

describe("resolveThemeCatalog", () => {
  const packs = [makePackManifest()];

  it("returns the pack catalog for a namespaced installed pack id", () => {
    expect(resolveThemeCatalog("codex-pet:yuexinmiao", packs).source).toBe("codex-pet-pack");
  });

  it("falls back to the built-in catalog for built-in, bare, unknown, or uninstalled ids", () => {
    expect(resolveThemeCatalog(BUILTIN_PET_THEME_ID, packs)).toBe(MINATO_AQUA_CATALOG);
    // A bare pack id is not a theme id: only the namespaced form selects a pack.
    expect(resolveThemeCatalog("yuexinmiao", packs)).toBe(MINATO_AQUA_CATALOG);
    expect(resolveThemeCatalog("codex-pet:not-installed", packs)).toBe(MINATO_AQUA_CATALOG);
    expect(resolveThemeCatalog(undefined, packs)).toBe(MINATO_AQUA_CATALOG);
    expect(resolveThemeCatalog("codex-pet:yuexinmiao", [])).toBe(MINATO_AQUA_CATALOG);
  });

  it("keeps an imported pack named minato-aqua distinct and selectable", () => {
    const collidingPacks = [makePackManifest(undefined, "minato-aqua")];
    // The plain id still means the built-in theme...
    expect(resolveThemeCatalog("minato-aqua", collidingPacks)).toBe(MINATO_AQUA_CATALOG);
    // ...while the namespaced id selects the imported pack.
    const packCatalog = resolveThemeCatalog("codex-pet:minato-aqua", collidingPacks);
    expect(packCatalog.source).toBe("codex-pet-pack");
    expect(packCatalog.themeId).toBe("codex-pet:minato-aqua");
    expect(packCatalog.roleDefaults.error).toBe("failed");
  });
});

describe("catalog-scoped validation", () => {
  const packCatalog = catalogFromPetPack(makePackManifest());

  it("treats canonical-but-foreign keys exactly like unknown strings", () => {
    // extra_action_5 is canonical but the pack does not provide it.
    expect(isCatalogAnimationKey(packCatalog, "extra_action_5")).toBe(false);
    expect(isCatalogAnimationKey(MINATO_AQUA_CATALOG, "jumping")).toBe(false);
    expect(normalizeCatalogAnimationKey(packCatalog, "extra_action_5", "idle")).toBe("idle");
    expect(normalizeCatalogAnimationKey(MINATO_AQUA_CATALOG, "jumping", "running")).toBe("running");
  });

  it("filters pools to the theme's keys and dedupes", () => {
    expect(normalizeCatalogAnimationKeys(packCatalog, ["idle", "jumping", "extra_action_5", "jumping", "bogus"]))
      .toEqual(["idle", "jumping"]);
    expect(normalizeCatalogAnimationKeys(MINATO_AQUA_CATALOG, ["idle", "jumping", "extra_action_5"]))
      .toEqual(["idle", "extra_action_5"]);
  });
});

describe("interaction-reserved keys", () => {
  const packCatalog = catalogFromPetPack(makePackManifest());

  it("keeps drag-only locomotion keys in the catalog but out of the mappable set", () => {
    // Playback-valid (animation test, drag feedback)...
    expect(isCatalogAnimationKey(packCatalog, "running_right")).toBe(true);
    expect(isCatalogAnimationKey(packCatalog, "running_left")).toBe(true);
    // ...but never offered or accepted as a standalone action.
    expect(isMappableCatalogAnimationKey(packCatalog, "running_right")).toBe(false);
    expect(isMappableCatalogAnimationKey(packCatalog, "running_left")).toBe(false);
    expect(mappableCatalogKeys(packCatalog)).toEqual([
      "idle", "waving", "jumping", "failed", "waiting_permission", "running", "review"
    ]);
  });

  it("normalizes interaction keys away exactly like foreign keys", () => {
    expect(normalizeMappableAnimationKey(packCatalog, "running_left", "idle")).toBe("idle");
    expect(normalizeMappableAnimationKey(packCatalog, "waving", "idle")).toBe("waving");
    expect(normalizeMappableAnimationKeys(packCatalog, ["idle", "running_right", "jumping", "running_left"]))
      .toEqual(["idle", "jumping"]);
  });

  it("leaves the built-in theme's mappable set identical to its catalog", () => {
    expect(mappableCatalogKeys(MINATO_AQUA_CATALOG)).toEqual([...MINATO_AQUA_CATALOG.keys]);
  });
});

describe("picker options per catalog", () => {
  it("provides a label for every canonical key", () => {
    const everythingCatalog: PetThemeCatalog = {
      themeId: "all-keys",
      source: "codex-pet-pack",
      keys: PET_ANIMATION_KEYS,
      roleDefaults: MINATO_AQUA_CATALOG.roleDefaults
    };
    for (const option of petAnimationOptionsForCatalog(everythingCatalog)) {
      expect(option.labelKey.startsWith("animation.sprite.")).toBe(true);
      expect(option.fallback.length).toBeGreaterThan(0);
    }
  });

  it("shows only the active theme's keys, in catalog order", () => {
    const packCatalog = catalogFromPetPack(makePackManifest([4, 0, 0, 5, 8, 0, 0, 0, 0]));
    expect(petAnimationOptionsForCatalog(packCatalog).map(option => option.key)).toEqual(["idle", "waving", "jumping"]);
  });
});

describe("theme registry", () => {
  const packs = [makePackManifest()];

  it("lists built-ins first, then installed packs under namespaced ids", () => {
    expect(listPetThemes(packs).map(theme => theme.id)).toEqual([BUILTIN_PET_THEME_ID, "codex-pet:yuexinmiao"]);
  });

  it("keeps registry ids unique even when a pack id shadows the built-in", () => {
    const ids = listPetThemes([makePackManifest(undefined, "minato-aqua")]).map(theme => theme.id);
    expect(ids).toEqual([BUILTIN_PET_THEME_ID, "codex-pet:minato-aqua"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds a theme card from a pack manifest", () => {
    const theme = petThemeFromPack(makePackManifest());
    expect(theme).toMatchObject({ id: "codex-pet:yuexinmiao", displayName: "月薪喵", interfaceTheme: "pet", source: "codex-pet-pack" });
  });

  it("resolves the active theme with the built-in as fallback", () => {
    expect(getPetTheme("codex-pet:yuexinmiao", packs).id).toBe("codex-pet:yuexinmiao");
    expect(getPetTheme("codex-pet:yuexinmiao", []).id).toBe(BUILTIN_PET_THEME_ID);
    expect(getPetTheme("yuexinmiao", packs).id).toBe(BUILTIN_PET_THEME_ID);
    expect(getPetTheme("garbage", packs).id).toBe(BUILTIN_PET_THEME_ID);
    expect(getPetTheme(undefined).id).toBe(BUILTIN_PET_THEME_ID);
  });
});

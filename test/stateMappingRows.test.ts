import { describe, expect, it } from "vitest";
import { resolvePetAnimation } from "../src/renderer/state/petAnimations";
import { displayedMappingKey, mappingRowMeta, stateMappingRowsFor } from "../src/renderer/clawd-migrated/utils/stateMappingRows";
import { MINATO_AQUA_CATALOG, catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

const packCatalog = catalogFromPetPack(makePackManifest());
const passthroughT = (key: string, fallback?: string) => fallback ?? key;

describe("stateMappingRowsFor", () => {
  it("keeps the built-in theme at three rows, with errors merged into running", () => {
    const rows = stateMappingRowsFor(MINATO_AQUA_CATALOG);
    expect(rows.map(row => row.key)).toEqual(["running", "waiting_permission", "done"]);
    const runningRow = rows[0];
    expect(runningRow.roles).toEqual(["running", "error"]);
    // The merged meta still tells the user this slot covers errors.
    expect(mappingRowMeta(runningRow, passthroughT)).toContain("错误");
  });

  it("gives a full imported catalog a dedicated error row mapped to failed", () => {
    const rows = stateMappingRowsFor(packCatalog);
    expect(rows.map(row => row.key)).toEqual(["running", "waiting_permission", "jumping", "failed"]);
    const errorRow = rows[3];
    expect(errorRow.roles).toEqual(["error"]);
    expect(errorRow.labelKey).toBe("animation.state.error");
    // Running no longer claims to include errors for this theme.
    expect(mappingRowMeta(rows[0], passthroughT)).not.toContain("错误");
  });

  it("renders no editable row for roles that collapsed onto idle", () => {
    // Only idle, running-right, and waving rows exist. running_right is drag
    // feedback and never a role default, so running, waiting_permission, and
    // error all collapse onto idle — and an idle-keyed row would let "remap
    // Running" silently restyle the genuinely idle pet, so none is rendered.
    const sparseCatalog = catalogFromPetPack(makePackManifest([4, 6, 0, 5, 0, 0, 0, 0, 0]));
    const rows = stateMappingRowsFor(sparseCatalog);
    expect(rows.map(row => row.key)).toEqual(["waving"]);
    expect(rows[0].roles).toEqual(["done"]);
  });

  it("never exposes a slot keyed by idle for any theme", () => {
    const catalogs = [
      MINATO_AQUA_CATALOG,
      packCatalog,
      catalogFromPetPack(makePackManifest([4, 6, 0, 5, 0, 0, 0, 0, 0])),
      catalogFromPetPack(makePackManifest([4, 0, 0, 0, 0, 0, 0, 0, 0])) // idle-only pack: nothing to map
    ];
    for (const catalog of catalogs) {
      expect(stateMappingRowsFor(catalog).some(row => row.key === "idle")).toBe(false);
    }
  });
});

describe("displayedMappingKey agrees with runtime resolution", () => {
  it("shows the row default for stale built-in mappings under an imported theme", () => {
    // A stored profile can reference an animation the (re)imported pack no
    // longer provides, or a built-in key that never existed in the pack.
    const stale = { running: "extra_action_5", jumping: "extra_action_9" };
    const rows = stateMappingRowsFor(packCatalog);
    for (const row of rows) {
      expect(displayedMappingKey(packCatalog, stale, row)).toBe(row.key);
    }
  });

  it("matches resolvePetAnimation for every state, valid or stale", () => {
    const cases = [
      { catalog: MINATO_AQUA_CATALOG, mappings: { running: "extra_action_7", done: "extra_action_9" } },
      { catalog: MINATO_AQUA_CATALOG, mappings: { running: "jumping" } }, // foreign canonical key
      { catalog: packCatalog, mappings: { running: "waving", jumping: "review", failed: "waving" } },
      { catalog: packCatalog, mappings: { running: "extra_action_5", failed: "bogus" } }, // stale + junk
      { catalog: packCatalog, mappings: { running: "running_left", jumping: "running_right" } } // drag-only keys
    ] as const;

    const stateForRole = { running: "running", waiting_permission: "permission-prompt", done: "completed", error: "error" } as const;

    for (const { catalog, mappings } of cases) {
      for (const row of stateMappingRowsFor(catalog)) {
        for (const role of row.roles) {
          const state = stateForRole[role as keyof typeof stateForRole];
          const displayed = displayedMappingKey(catalog, mappings, row);
          const resolved = resolvePetAnimation(state, mappings, null, null, catalog).animationKey;
          expect(displayed, `${catalog.themeId} ${role}`).toBe(resolved);
        }
      }
    }
  });

  it("ignores a stale idle-slot mapping everywhere it could leak", () => {
    // Settings written by the old UI (or by hand) may still carry an idle
    // entry. It must restyle neither the genuinely idle pet nor the sparse
    // roles that collapsed onto idle — there is no UI slot for it anymore.
    const sparseCatalog = catalogFromPetPack(makePackManifest([4, 6, 0, 5, 0, 0, 0, 0, 0]));
    const stale = { idle: "waving" };
    expect(resolvePetAnimation("idle", stale, null, null, sparseCatalog).animationKey).toBe("idle");
    expect(resolvePetAnimation("running", stale, null, null, sparseCatalog).animationKey).toBe("idle");
    expect(resolvePetAnimation("permission-prompt", stale, null, null, sparseCatalog).animationKey).toBe("idle");
    expect(resolvePetAnimation("error", stale, null, null, sparseCatalog).animationKey).toBe("idle");
  });
});

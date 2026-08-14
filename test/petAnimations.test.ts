import { describe, it, expect } from "vitest";
import { resolvePetAnimation } from "../src/renderer/state/petAnimations";
import { MINATO_AQUA_CATALOG, catalogFromPetPack } from "../src/shared/petThemeCatalog";
import { makePackManifest } from "./helpers/packFixtures";

describe("resolvePetAnimation: action mapping reaches the real pet", () => {
  it("uses the built-in animation for each state when no mapping exists", () => {
    expect(resolvePetAnimation("idle", {}, null).animationKey).toBe("idle");
    expect(resolvePetAnimation("running", {}, null).animationKey).toBe("running");
    expect(resolvePetAnimation("permission-prompt", {}, null).animationKey).toBe("waiting_permission");
    expect(resolvePetAnimation("completed", {}, null).animationKey).toBe("done");
    expect(resolvePetAnimation("error", {}, null).animationKey).toBe("running");
  });

  it("applies the user's mapping for the running state", () => {
    // The regression this file exists for: a mapping saved in the panel must
    // change what the desktop pet shows, not just the panel's preview.
    const resolved = resolvePetAnimation("running", { running: "extra_action_5" }, null);
    expect(resolved.animationKey).toBe("extra_action_5");
    expect(resolved.imageKey).toBe("extra_action_5");
  });

  it("maps pet states onto the picker's vocabulary (completed→done, permission-prompt→waiting_permission)", () => {
    expect(resolvePetAnimation("completed", { done: "extra_action_aqua_bocchi" }, null).animationKey)
      .toBe("extra_action_aqua_bocchi");
    expect(resolvePetAnimation("permission-prompt", { waiting_permission: "extra_action_9" }, null).animationKey)
      .toBe("extra_action_9");
  });

  it("routes the error state through the running mapping, like the panel preview does", () => {
    expect(resolvePetAnimation("error", { running: "extra_action_7" }, null).animationKey).toBe("extra_action_7");
  });

  it("leaves unmapped states on their defaults", () => {
    expect(resolvePetAnimation("idle", { running: "extra_action_5" }, null).animationKey).toBe("idle");
    expect(resolvePetAnimation("completed", { running: "extra_action_5" }, null).animationKey).toBe("done");
  });

  it("accepts every animation the active theme provides in a mapping slot", () => {
    for (const key of MINATO_AQUA_CATALOG.keys) {
      expect(resolvePetAnimation("running", { running: key }, null).animationKey).toBe(key);
    }
  });

  it("rejects canonical keys the active theme does not provide", () => {
    // "jumping" is canonical (codex-pet vocabulary) but not a built-in clip.
    expect(resolvePetAnimation("running", { running: "jumping" }, null).animationKey).toBe("running");
    expect(resolvePetAnimation("idle", {}, null, "jumping").animationKey).toBe("idle");
  });

  it("rejects legacy alias names instead of translating them", () => {
    // Each case picks a state whose default differs from what alias
    // translation would have produced, so a translation bug cannot pass.
    expect(resolvePetAnimation("running", { running: "extra-action-5" }, null).animationKey).toBe("running");
    expect(resolvePetAnimation("completed", { done: "thinking" }, null).animationKey).toBe("done");
    expect(resolvePetAnimation("running", { running: "permission" }, null).animationKey).toBe("running");
    expect(resolvePetAnimation("permission-prompt", { waiting_permission: "aqua-pixel" }, null).animationKey)
      .toBe("waiting_permission");
    expect(resolvePetAnimation("completed", { done: "action_9" }, null).animationKey).toBe("done");
  });

  it("falls back to the state default when a mapping value is unknown", () => {
    expect(resolvePetAnimation("running", { running: "not-a-real-animation" }, null).animationKey).toBe("running");
  });

  it("tolerates a missing mapping object entirely", () => {
    expect(resolvePetAnimation("running", null, null).animationKey).toBe("running");
    expect(resolvePetAnimation("running", undefined, null).animationKey).toBe("running");
  });

  it("shows the idle-rotation sprite while idling", () => {
    expect(resolvePetAnimation("idle", {}, null, "extra_action_5").animationKey).toBe("extra_action_5");
  });

  it("ignores mappings stored under the idle slot", () => {
    // idle is the universal fallback slot; there is no mapping row for it,
    // so a persisted entry must not restyle the idle pet.
    expect(resolvePetAnimation("idle", { idle: "extra_action_5" }, null).animationKey).toBe("idle");
  });

  it("ignores an idle-rotation sprite outside the idle state", () => {
    expect(resolvePetAnimation("running", {}, null, "extra_action_5").animationKey).toBe("running");
    expect(resolvePetAnimation("permission-prompt", {}, null, "extra_action_5").animationKey).toBe("waiting_permission");
  });

  it("applies the user's mapping on top of the rotation base key, like the panel preview", () => {
    expect(resolvePetAnimation("idle", { running: "extra_action_7" }, null, "running").animationKey)
      .toBe("extra_action_7");
  });

  it("lets a preview beat the idle rotation", () => {
    const resolved = resolvePetAnimation("idle", {}, { key: "extra_action_9", nonce: 3 }, "extra_action_5");
    expect(resolved.animationKey).toBe("extra_action_9");
    expect(resolved.imageKey).toBe("extra_action_9:3");
  });

  it("lets a preview override the mapping and stamps the nonce for restarts", () => {
    const resolved = resolvePetAnimation("running", { running: "extra_action_5" }, { key: "extra_action_9", nonce: 42 });
    expect(resolved.animationKey).toBe("extra_action_9");
    expect(resolved.imageKey).toBe("extra_action_9:42");
  });

  it("keeps the mapped animation when a preview key is invalid", () => {
    const resolved = resolvePetAnimation("running", { running: "extra_action_5" }, { key: "bogus", nonce: 7 });
    expect(resolved.animationKey).toBe("extra_action_5");
    expect(resolved.imageKey).toBe("extra_action_5:7");
  });
});

describe("resolvePetAnimation with an imported pack catalog", () => {
  const packCatalog = catalogFromPetPack(makePackManifest());

  it("uses the pack's role defaults, including a real error animation", () => {
    expect(resolvePetAnimation("idle", {}, null, null, packCatalog).animationKey).toBe("idle");
    expect(resolvePetAnimation("running", {}, null, null, packCatalog).animationKey).toBe("running");
    expect(resolvePetAnimation("permission-prompt", {}, null, null, packCatalog).animationKey).toBe("waiting_permission");
    expect(resolvePetAnimation("completed", {}, null, null, packCatalog).animationKey).toBe("jumping");
    expect(resolvePetAnimation("error", {}, null, null, packCatalog).animationKey).toBe("failed");
  });

  it("follows the pack's fallback chains when rows are missing", () => {
    // No jumping/failed rows: done falls back to waving, error to running.
    const sparseCatalog = catalogFromPetPack(makePackManifest([4, 0, 0, 5, 0, 0, 0, 8, 0]));
    expect(resolvePetAnimation("completed", {}, null, null, sparseCatalog).animationKey).toBe("waving");
    expect(resolvePetAnimation("error", {}, null, null, sparseCatalog).animationKey).toBe("running");
  });

  it("validates mappings against the pack's keys, not the global superset", () => {
    expect(resolvePetAnimation("running", { running: "waving" }, null, null, packCatalog).animationKey).toBe("waving");
    // Canonical but built-in-only: rejected under the pack catalog.
    expect(resolvePetAnimation("running", { running: "extra_action_5" }, null, null, packCatalog).animationKey).toBe("running");
  });

  it("applies mappings on top of the pack's role defaults", () => {
    // The completed state resolves to the pack's jumping key; the user remaps
    // that slot to review.
    expect(resolvePetAnimation("completed", { jumping: "review" }, null, null, packCatalog).animationKey).toBe("review");
  });

  it("validates idle-rotation sprites and previews against the pack catalog", () => {
    expect(resolvePetAnimation("idle", {}, null, "review", packCatalog).animationKey).toBe("review");
    expect(resolvePetAnimation("idle", {}, null, "extra_action_9", packCatalog).animationKey).toBe("idle");
    const preview = resolvePetAnimation("idle", {}, { key: "extra_action_9", nonce: 5 }, null, packCatalog);
    expect(preview.animationKey).toBe("idle");
    expect(preview.imageKey).toBe("idle:5");
  });

  it("rejects drag-only locomotion keys in mapping slots and the idle rotation", () => {
    // running_right/left are drag feedback in the codex-pet template, not
    // standalone actions: a stationary state may never resolve to them.
    expect(resolvePetAnimation("running", { running: "running_left" }, null, null, packCatalog).animationKey).toBe("running");
    expect(resolvePetAnimation("completed", { jumping: "running_right" }, null, null, packCatalog).animationKey).toBe("jumping");
    expect(resolvePetAnimation("idle", {}, null, "running_right", packCatalog).animationKey).toBe("idle");
  });

  it("still lets the animation test preview locomotion rows", () => {
    const preview = resolvePetAnimation("idle", {}, { key: "running_left", nonce: 2 }, null, packCatalog);
    expect(preview.animationKey).toBe("running_left");
    expect(preview.imageKey).toBe("running_left:2");
  });
});

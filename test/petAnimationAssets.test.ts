import { describe, expect, it } from "vitest";
import { petAnimationAssets } from "../src/renderer/clawd-migrated/utils/petAnimationAssets";

describe("built-in Aqua animation assets", () => {
  it("uses the Aqua wiggle clip for idle and the former idle clip for Calm", () => {
    expect(petAnimationAssets.idle).toContain("extra-action-aqua-bocchi");
    expect(petAnimationAssets.extra_action_aqua_bocchi).toContain("idle");
    expect(petAnimationAssets.idle).not.toBe(petAnimationAssets.extra_action_aqua_bocchi);
  });
});

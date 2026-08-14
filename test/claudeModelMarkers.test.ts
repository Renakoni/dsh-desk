import { describe, expect, it } from "vitest";
import {
  CLAUDE_ONE_M_MARKER,
  hasClaudeOneMMarker,
  setClaudeOneMMarker,
  stripClaudeOneMMarker
} from "../src/renderer/clawd-migrated/components/claude-routing/claudeModelMarkers";

describe("claude 1M model markers", () => {
  it("detects the marker case-insensitively and ignoring trailing space", () => {
    expect(hasClaudeOneMMarker("deepseek-v4-pro[1M]")).toBe(true);
    expect(hasClaudeOneMMarker("deepseek-v4-pro[1m]")).toBe(true);
    expect(hasClaudeOneMMarker("deepseek-v4-pro [1M]  ")).toBe(true);
    expect(hasClaudeOneMMarker("deepseek-v4-pro")).toBe(false);
    expect(hasClaudeOneMMarker("")).toBe(false);
  });

  it("strips the marker back to the base model name", () => {
    expect(stripClaudeOneMMarker("deepseek-v4-pro[1M]")).toBe("deepseek-v4-pro");
    expect(stripClaudeOneMMarker("deepseek-v4-pro [1M]  ")).toBe("deepseek-v4-pro");
    expect(stripClaudeOneMMarker("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("adds/removes the marker and normalizes to the canonical upper-case form", () => {
    expect(setClaudeOneMMarker("deepseek-v4-pro", true)).toBe(`deepseek-v4-pro${CLAUDE_ONE_M_MARKER}`);
    expect(setClaudeOneMMarker("deepseek-v4-pro[1m]", true)).toBe("deepseek-v4-pro[1M]");
    expect(setClaudeOneMMarker("deepseek-v4-pro[1M]", false)).toBe("deepseek-v4-pro");
    // Toggling on an unmarked model twice is idempotent (no double marker).
    expect(setClaudeOneMMarker(setClaudeOneMMarker("m", true), true)).toBe("m[1M]");
  });

  it("never marks an empty base", () => {
    expect(setClaudeOneMMarker("", true)).toBe("");
    expect(setClaudeOneMMarker("   ", true)).toBe("");
    expect(setClaudeOneMMarker("[1M]", true)).toBe("");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyCompanionAppearance } from "../src/renderer/clawd-migrated/appearance";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-pet-theme");
  document.documentElement.removeAttribute("data-ui-style");
});

describe("initial companion appearance", () => {
  it("applies the persisted dark and UI modes before React renders", () => {
    applyCompanionAppearance({ theme: "dark", petTheme: "minato-aqua", uiStyle: "liquid" });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-pet-theme")).toBe("minato-aqua");
    expect(document.documentElement.getAttribute("data-ui-style")).toBe("liquid");
  });
});

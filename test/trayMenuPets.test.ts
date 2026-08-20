import { describe, expect, it } from "vitest";
import { buildTrayMenuPets, isRemovedBuiltinPetTheme } from "../src/main/trayMenuPets";

describe("tray pet registry", () => {
  const installed = [{ id: "codex-pet:yuexinmiao", name: "月薪喵" }];

  it("filters a removed built-in Aqua from the switcher", () => {
    expect(buildTrayMenuPets("codex-pet:yuexinmiao", installed, ["minato-aqua"]))
      .toEqual([{ id: "codex-pet:yuexinmiao", name: "月薪喵", active: true }]);
  });

  it("falls back to the first available pet when the stored theme is unavailable", () => {
    expect(buildTrayMenuPets("minato-aqua", installed, ["minato-aqua"]))
      .toEqual([{ id: "codex-pet:yuexinmiao", name: "月薪喵", active: true }]);
  });

  it("identifies only the removed built-in theme as blocked", () => {
    expect(isRemovedBuiltinPetTheme("minato-aqua", ["minato-aqua"])).toBe(true);
    expect(isRemovedBuiltinPetTheme("codex-pet:yuexinmiao", ["minato-aqua"])).toBe(false);
  });
});

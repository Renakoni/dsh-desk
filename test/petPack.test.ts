import { describe, expect, it } from "vitest";
import {
  CODEX_PET_COLUMNS,
  CODEX_PET_FRAME_DURATION_MS,
  CODEX_PET_ROWS,
  CODEX_ROW_TO_ANIMATION_KEY,
  buildPetPackManifest,
  defaultIdlePool,
  deriveSheetGeometry,
  parseCodexPetManifest,
  sanitizePetPackId,
  type CodexPetManifest,
  type SheetGeometry
} from "../src/shared/petPack";

// Reference sheet: 1536x1872 = 8 columns x 9 rows of 192x208 cells.
function referenceGeometry(): SheetGeometry {
  const derived = deriveSheetGeometry(1536, 1872);
  if (!derived.ok) throw new Error("reference geometry must derive");
  return derived.value;
}

function validManifest(): CodexPetManifest {
  const parsed = parseCodexPetManifest({
    id: "yuexinmiao",
    displayName: "月薪喵",
    description: "A small white office cat mascot adapted as a Codex pet.",
    spritesheetPath: "spritesheet.webp"
  });
  if (!parsed.ok) throw new Error("fixture manifest must parse");
  return parsed.value;
}

describe("codex-pet row contract", () => {
  it("pins the official row order of the v1 spritesheet", () => {
    expect(CODEX_PET_ROWS).toEqual([
      "idle",
      "running-right",
      "running-left",
      "waving",
      "jumping",
      "failed",
      "waiting",
      "running",
      "review"
    ]);
    expect(CODEX_PET_COLUMNS).toBe(8);
  });

  it("translates every row to a distinct app animation key", () => {
    const keys = CODEX_PET_ROWS.map(row => CODEX_ROW_TO_ANIMATION_KEY[row]);
    expect(keys).toHaveLength(CODEX_PET_ROWS.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(CODEX_ROW_TO_ANIMATION_KEY.waiting).toBe("waiting_permission");
    expect(CODEX_ROW_TO_ANIMATION_KEY["running-right"]).toBe("running_right");
  });
});

describe("sanitizePetPackId", () => {
  it("normalizes to a lowercase slug", () => {
    expect(sanitizePetPackId("Happy Dog!")).toBe("happy-dog");
    expect(sanitizePetPackId("  My_Pet-2  ")).toBe("my_pet-2");
    expect(sanitizePetPackId("a--b")).toBe("a-b");
  });

  it("rejects ids with no usable characters", () => {
    expect(sanitizePetPackId("月薪喵")).toBeNull();
    expect(sanitizePetPackId("---")).toBeNull();
    expect(sanitizePetPackId("")).toBeNull();
    expect(sanitizePetPackId("x".repeat(65))).toBeNull();
  });

  it("rejects Windows-reserved device names case-insensitively", () => {
    for (const reserved of ["con", "CON", "Prn", "aux", "NUL", "com1", "COM9", "lpt1", "LPT9"]) {
      expect(sanitizePetPackId(reserved), reserved).toBeNull();
    }
    // Reserved names embedded in a longer slug are fine.
    expect(sanitizePetPackId("con-cat")).toBe("con-cat");
    expect(sanitizePetPackId("falcon")).toBe("falcon");
    expect(sanitizePetPackId("com10")).toBe("com10");
  });
});

describe("parseCodexPetManifest", () => {
  it("accepts the verified sample manifest shape", () => {
    const parsed = parseCodexPetManifest({
      id: "yuexinmiao",
      displayName: "月薪喵",
      description: "A small white office cat mascot adapted as a Codex pet.",
      spritesheetPath: "spritesheet.webp"
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        id: "yuexinmiao",
        displayName: "月薪喵",
        description: "A small white office cat mascot adapted as a Codex pet.",
        spritesheetPath: "spritesheet.webp"
      }
    });
  });

  it("applies defaults for the optional fields", () => {
    const parsed = parseCodexPetManifest({ id: "boba", displayName: "Boba" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.description).toBe("");
    expect(parsed.value.spritesheetPath).toBe("spritesheet.webp");
  });

  it("sanitizes the id and accepts .png sheets", () => {
    const parsed = parseCodexPetManifest({ id: "Happy Dog!", displayName: "Happy Dog", spritesheetPath: "Sheet_v2.PNG" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe("happy-dog");
    expect(parsed.value.spritesheetPath).toBe("Sheet_v2.PNG");
  });

  it("rejects non-object input", () => {
    expect(parseCodexPetManifest(null).ok).toBe(false);
    expect(parseCodexPetManifest([]).ok).toBe(false);
    expect(parseCodexPetManifest("pet").ok).toBe(false);
  });

  it("collects problems for missing or unusable required fields", () => {
    const parsed = parseCodexPetManifest({ id: "月薪喵", description: 42 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const fields = parsed.problems.map(problem => problem.field).sort();
    expect(fields).toEqual(["description", "displayName", "id"]);
  });

  it("rejects spritesheet references that are paths or foreign formats", () => {
    for (const spritesheetPath of ["../sheet.webp", "assets/sheet.webp", "a\\b.webp", "sheet.gif", "sheet"]) {
      const parsed = parseCodexPetManifest({ id: "pet", displayName: "Pet", spritesheetPath });
      expect(parsed.ok, spritesheetPath).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.problems.some(problem => problem.field === "spritesheetPath")).toBe(true);
    }
  });

  it("rejects spritesheet names with Windows-reserved basenames, regardless of case or extension", () => {
    for (const spritesheetPath of ["CON.webp", "con.png", "AUX.PNG", "nul.webp", "Com1.webp", "lpt9.png", "con.sheet.webp"]) {
      const parsed = parseCodexPetManifest({ id: "pet", displayName: "Pet", spritesheetPath });
      expect(parsed.ok, spritesheetPath).toBe(false);
    }
    // Reserved names as a substring of a longer basename are fine.
    const parsed = parseCodexPetManifest({ id: "pet", displayName: "Pet", spritesheetPath: "falcon.webp" });
    expect(parsed.ok).toBe(true);
  });
});

describe("deriveSheetGeometry", () => {
  it("derives the reference 192x208 grid", () => {
    expect(deriveSheetGeometry(1536, 1872)).toEqual({
      ok: true,
      value: { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 }
    });
  });

  it("supports smaller sheets as long as the grid divides exactly", () => {
    const derived = deriveSheetGeometry(256, 288);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.cellWidth).toBe(32);
    expect(derived.value.cellHeight).toBe(32);
  });

  it("rejects dimensions that do not divide into the fixed grid", () => {
    const badHeight = deriveSheetGeometry(1536, 1871);
    expect(badHeight.ok).toBe(false);
    if (!badHeight.ok) expect(badHeight.problems[0].field).toBe("height");

    const badWidth = deriveSheetGeometry(1004, 900);
    expect(badWidth.ok).toBe(false);
    if (!badWidth.ok) expect(badWidth.problems[0].field).toBe("width");
  });

  it("rejects cells outside the sane size bounds", () => {
    expect(deriveSheetGeometry(64, 72).ok).toBe(false); // 8x8 cells
    expect(deriveSheetGeometry(16384, 18432).ok).toBe(false); // 2048px cells
  });

  it("caps the decoded pixel area even when the cells are individually legal", () => {
    // 4000x3996 = 15.984M pixels: divisible, 500x444 cells, under the cap.
    expect(deriveSheetGeometry(4000, 3996).ok).toBe(true);
    // 4096x4104 = 16.8M pixels: divisible, 512x456 cells, over the cap.
    const oversized = deriveSheetGeometry(4096, 4104);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.problems[0].message).toContain("pixels");
    // The verified reference sheet stays comfortably valid.
    expect(deriveSheetGeometry(1536, 1872).ok).toBe(true);
  });

  it("rejects non-integer or non-positive dimensions", () => {
    expect(deriveSheetGeometry(1536.5, 1872).ok).toBe(false);
    expect(deriveSheetGeometry(0, 1872).ok).toBe(false);
    expect(deriveSheetGeometry(1536, -9).ok).toBe(false);
  });
});

describe("buildPetPackManifest", () => {
  it("builds the internal manifest for a full pack", () => {
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [6, 8, 7, 5, 8, 8, 8, 8, 6]
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const pack = built.value;
    expect(pack.formatVersion).toBe(1);
    expect(pack.sourceFormat).toBe("codex-pet-v1");
    expect(pack.id).toBe("yuexinmiao");
    expect(pack.spritesheetFile).toBe("spritesheet.webp");
    expect(pack.animations).toHaveLength(9);
    expect(pack.animations[0]).toEqual({ key: "idle", row: 0, frameCount: 6, frameDurationMs: CODEX_PET_FRAME_DURATION_MS });
    expect(pack.animations[6]).toEqual({ key: "waiting_permission", row: 6, frameCount: 8, frameDurationMs: CODEX_PET_FRAME_DURATION_MS });
    expect(pack.roleDefaults).toEqual({
      idle: "idle",
      running: "running",
      waiting_permission: "waiting_permission",
      done: "jumping",
      error: "failed"
    });
  });

  it("omits empty rows and falls back through the role chains", () => {
    // Only idle, waving, and running-right rows have visible frames.
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [4, 6, 0, 5, 0, 0, 0, 0, 0]
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.value.animations.map(animation => animation.key)).toEqual(["idle", "running_right", "waving"]);
    expect(built.value.roleDefaults).toEqual({
      idle: "idle",
      running: "idle", // no plain running row; running_right is drag-only, never a role default
      waiting_permission: "idle", // no waiting row
      done: "waving", // no jumping row
      error: "idle" // neither failed nor running rows
    });
  });

  it("requires a visible idle row", () => {
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [0, 8, 8, 8, 8, 8, 8, 8, 8]
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.problems[0].field).toBe("idle");
  });

  it("rejects malformed frame-count input", () => {
    const wrongLength = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [8, 8, 8]
    });
    expect(wrongLength.ok).toBe(false);

    const overColumns = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [8, 9, 8, 8, 8, 8, 8, 8, 8]
    });
    expect(overColumns.ok).toBe(false);
    if (!overColumns.ok) expect(overColumns.problems[0].field).toBe("rowFrameCounts[1]");

    const fractional = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [8, 7.5, 8, 8, 8, 8, 8, 8, 8]
    });
    expect(fractional.ok).toBe(false);
  });

  it("rejects sparse frame-count arrays instead of emitting undefined frame counts", () => {
    const fullySparse = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: new Array(9)
    });
    expect(fullySparse.ok).toBe(false);
    if (!fullySparse.ok) expect(fullySparse.problems).toHaveLength(9);

    const partiallySparse: number[] = new Array(9);
    partiallySparse[0] = 4;
    partiallySparse[3] = 6;
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: partiallySparse
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.problems.map(problem => problem.field)).toContain("rowFrameCounts[1]");
      expect(built.problems.map(problem => problem.field)).not.toContain("rowFrameCounts[0]");
    }
  });

  it("only ever emits animations with integer frame counts between 1 and the column count", () => {
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [6, 8, 7, 5, 8, 8, 8, 8, 6]
    });
    if (!built.ok) throw new Error("fixture pack must build");
    for (const animation of built.value.animations) {
      expect(Number.isInteger(animation.frameCount)).toBe(true);
      expect(animation.frameCount).toBeGreaterThanOrEqual(1);
      expect(animation.frameCount).toBeLessThanOrEqual(CODEX_PET_COLUMNS);
    }
  });
});

describe("defaultIdlePool", () => {
  it("suggests the calm states a full pack provides", () => {
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [6, 8, 7, 5, 8, 8, 8, 8, 6]
    });
    if (!built.ok) throw new Error("fixture pack must build");
    expect(defaultIdlePool(built.value.animations)).toEqual(["idle", "waving", "jumping", "review"]);
  });

  it("never suggests failed or state-reserved rows", () => {
    // idle + failed + waiting + running only.
    const built = buildPetPackManifest({
      manifest: validManifest(),
      geometry: referenceGeometry(),
      rowFrameCounts: [4, 0, 0, 0, 0, 6, 6, 6, 0]
    });
    if (!built.ok) throw new Error("fixture pack must build");
    expect(defaultIdlePool(built.value.animations)).toEqual(["idle"]);
  });
});

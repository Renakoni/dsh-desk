import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedBundledPetPacks } from "../src/main/bundledPetPacks";
import { listPetPacks } from "../src/main/petPackStore";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-bundled-pets-"));
  roots.push(root);
  const userData = join(root, "user-data");
  const bundled = join(root, "bundled");
  for (const id of ["yuexinmiao", "maid-deepseek-whale"]) {
    const dir = join(bundled, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spritesheet.webp"), `sheet:${id}`);
  }
  return { userData, bundled };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bundled pet packs", () => {
  it("seeds scanned frame counts and v2 look support", () => {
    const { userData, bundled } = fixture();
    seedBundledPetPacks(userData, bundled);

    const packs = listPetPacks(join(userData, "pets"));
    expect(packs.find(pack => pack.id === "yuexinmiao")?.animations.map(animation => animation.frameCount))
      .toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
    expect(packs.find(pack => pack.id === "maid-deepseek-whale")?.look).toBeDefined();
  });

  it("does not restore a bundled pet deleted after seeding", () => {
    const { userData, bundled } = fixture();
    seedBundledPetPacks(userData, bundled);
    rmSync(join(userData, "pets", "yuexinmiao"), { recursive: true, force: true });

    seedBundledPetPacks(userData, bundled);

    expect(listPetPacks(join(userData, "pets")).some(pack => pack.id === "yuexinmiao")).toBe(false);
  });

  it("repairs only the legacy manifest paired with the original bundled sheet", () => {
    const { userData, bundled } = fixture();
    seedBundledPetPacks(userData, bundled);
    const manifestPath = join(userData, "pets", "yuexinmiao", "pack.manifest.json");
    const legacy = JSON.parse(readFileSync(manifestPath, "utf8"));
    legacy.animations = legacy.animations.map((animation: Record<string, unknown>) => ({ ...animation, frameCount: 8 }));
    writeFileSync(manifestPath, JSON.stringify(legacy, null, 2));
    writeFileSync(join(userData, "bundled-pets-v1.seeded"), "bundled-pets-v1\n");
    unlinkSync(join(userData, "bundled-pets-v2.seeded"));

    seedBundledPetPacks(userData, bundled);

    const repaired = listPetPacks(join(userData, "pets")).find(pack => pack.id === "yuexinmiao");
    expect(repaired?.animations.map(animation => animation.frameCount)).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
  });

  it("does not rewrite a same-name pack whose spritesheet was replaced", () => {
    const { userData, bundled } = fixture();
    seedBundledPetPacks(userData, bundled);
    const petDir = join(userData, "pets", "yuexinmiao");
    const manifestPath = join(petDir, "pack.manifest.json");
    const legacy = JSON.parse(readFileSync(manifestPath, "utf8"));
    legacy.animations = legacy.animations.map((animation: Record<string, unknown>) => ({ ...animation, frameCount: 8 }));
    writeFileSync(manifestPath, JSON.stringify(legacy, null, 2));
    writeFileSync(join(petDir, "spritesheet.webp"), "user replacement");
    writeFileSync(join(userData, "bundled-pets-v1.seeded"), "bundled-pets-v1\n");
    unlinkSync(join(userData, "bundled-pets-v2.seeded"));

    seedBundledPetPacks(userData, bundled);

    const untouched = listPetPacks(join(userData, "pets")).find(pack => pack.id === "yuexinmiao");
    expect(untouched?.animations.every(animation => animation.frameCount === 8)).toBe(true);
    expect(readFileSync(join(petDir, "spritesheet.webp"), "utf8")).toBe("user replacement");
  });
});

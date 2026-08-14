import { strToU8, zipSync } from "fflate";
import type { PathLike } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDecodablePng } from "./helpers/imageFixtures";

// Failure injection for the overwrite swap: renameSync throws once when the
// destination ends with the configured suffix, and rmSync throws once when
// the target contains the configured fragment. Everything else is real fs.
const fsFailure = vi.hoisted(() => ({
  failRenameWhenDestinationEndsWith: null as string | null,
  failRemovalWhenPathContains: null as string | null
}));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (oldPath: PathLike, newPath: PathLike): void => {
      const suffix = fsFailure.failRenameWhenDestinationEndsWith;
      if (suffix && String(newPath).endsWith(suffix)) {
        fsFailure.failRenameWhenDestinationEndsWith = null;
        throw new Error("injected rename failure");
      }
      actual.renameSync(oldPath, newPath);
    },
    rmSync: (target: PathLike, options?: Parameters<typeof actual.rmSync>[1]): void => {
      const fragment = fsFailure.failRemovalWhenPathContains;
      if (fragment && String(target).includes(fragment)) {
        fsFailure.failRemovalWhenPathContains = null;
        throw new Error("injected removal failure");
      }
      actual.rmSync(target, options);
    }
  };
});

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PACK_MANIFEST_FILE, inspectPetPackZip, installPetPack } from "../src/main/petPackStore";

const FULL_COUNTS = [6, 8, 7, 5, 8, 8, 8, 8, 6];

let workDir: string;
let petsDir: string;

beforeEach(() => {
  fsFailure.failRenameWhenDestinationEndsWith = null;
  fsFailure.failRemovalWhenPathContains = null;
  workDir = mkdtempSync(join(tmpdir(), "pet-pack-overwrite-"));
  petsDir = join(workDir, "pets");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function bobaZip(displayName: string, alpha = 255): string {
  const zipPath = join(workDir, `${displayName}.zip`);
  writeFileSync(zipPath, zipSync({
    "pet.json": strToU8(JSON.stringify({ id: "boba", displayName, spritesheetPath: "sheet.png" })),
    "sheet.png": makeDecodablePng(256, 288, alpha)
  }));
  return zipPath;
}

function digestOf(zipPath: string): string {
  const inspected = inspectPetPackZip(zipPath);
  if (!inspected.ok) throw new Error("fixture zip must inspect cleanly");
  return inspected.staged.packageSha256;
}

function installedDisplayName(): string {
  return JSON.parse(readFileSync(join(petsDir, "boba", PACK_MANIFEST_FILE), "utf8")).displayName;
}

describe("installPetPack overwrite rollback", () => {
  it("restores the existing pack when the final rename fails mid-overwrite", () => {
    const v1 = bobaZip("Boba v1");
    expect(installPetPack(v1, FULL_COUNTS, digestOf(v1), petsDir).ok).toBe(true);
    expect(installedDisplayName()).toBe("Boba v1");

    // Fail the temp -> target rename (its destination is the pack dir); the
    // preceding target -> backup rename has a different destination suffix.
    fsFailure.failRenameWhenDestinationEndsWith = `${sep}boba`;
    const v2 = bobaZip("Boba v2", 128);
    const failed = installPetPack(v2, FULL_COUNTS, digestOf(v2), petsDir, { overwrite: true });

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.problems[0].field).toBe("install");
      expect(failed.problems[0].message).toContain("injected");
    }
    // The original pack survived the failed overwrite intact...
    expect(existsSync(join(petsDir, "boba"))).toBe(true);
    expect(installedDisplayName()).toBe("Boba v1");
    // ...and no temp or backup residue is left behind.
    expect(readdirSync(petsDir).filter(name => name.startsWith("."))).toEqual([]);

    // With the injection cleared, the same overwrite succeeds.
    const retried = installPetPack(v2, FULL_COUNTS, digestOf(v2), petsDir, { overwrite: true });
    expect(retried.ok).toBe(true);
    expect(installedDisplayName()).toBe("Boba v2");
  });

  it("reports success with a warning when only the post-commit backup cleanup fails", () => {
    const v1 = bobaZip("Boba v1");
    expect(installPetPack(v1, FULL_COUNTS, digestOf(v1), petsDir).ok).toBe(true);

    // The swap succeeds; removing the .backup-* directory afterwards fails.
    fsFailure.failRemovalWhenPathContains = ".backup-boba";
    const v2 = bobaZip("Boba v2", 128);
    const result = installPetPack(v2, FULL_COUNTS, digestOf(v2), petsDir, { overwrite: true });

    // The result must be consistent with the installed target: success.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toContain("backup");
      expect(result.pack.displayName).toBe("Boba v2");
    }
    expect(installedDisplayName()).toBe("Boba v2");
    // The undeletable backup stays on disk as documented residue.
    expect(readdirSync(petsDir).some(name => name.startsWith(".backup-boba"))).toBe(true);
  });
});

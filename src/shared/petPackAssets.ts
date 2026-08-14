/**
 * Renderer-facing asset view of an installed pet pack: the pet-asset://
 * protocol URL for its spritesheet plus a by-key lookup of its animations.
 * Pure string/shape building so both renderer entries (and tests) share the
 * exact same rule for where pack assets live.
 */

import type { PetAnimationKey } from "./petAnimationKeys";
import type { PetPackAnimation, PetPackManifest } from "./petPack";

export interface SpritesheetAssets {
  kind: "spritesheet";
  sheetUrl: string;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  animations: Partial<Record<PetAnimationKey, PetPackAnimation>>;
}

export function spritesheetAssetsFromPack(pack: PetPackManifest): SpritesheetAssets {
  return {
    kind: "spritesheet",
    sheetUrl: `pet-asset://packs/${pack.id}/${pack.spritesheetFile}`,
    columns: pack.sheet.columns,
    rows: pack.sheet.rows,
    cellWidth: pack.sheet.cellWidth,
    cellHeight: pack.sheet.cellHeight,
    animations: Object.fromEntries(pack.animations.map(animation => [animation.key, animation]))
  };
}

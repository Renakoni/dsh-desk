import type { CompanionSettings } from "../../shared/events";
import type { PetPackManifest } from "../../../shared/petPack";
import { BUILTIN_PET_THEME_ID, petPackThemeId, type PetThemeSource } from "../../../shared/petThemeCatalog";

export type PetThemeDefinition = {
  id: string;
  characterName: string;
  displayName: string;
  subtitle: string;
  interfaceTheme: "pet" | Extract<CompanionSettings["theme"], "light" | "dark">;
  source: PetThemeSource;
};

export const builtinPetThemes: PetThemeDefinition[] = [
  {
    id: BUILTIN_PET_THEME_ID,
    characterName: "Aqua",
    displayName: "Minato Aqua",
    subtitle: "Aqua workbench",
    interfaceTheme: "pet",
    source: "builtin-clips"
  }
];

// Kept as the built-in list for callers that render before installed packs
// are known; the full registry comes from listPetThemes(packs).
export const petThemes: PetThemeDefinition[] = builtinPetThemes;

/** Theme card for an installed codex-pet pack (namespaced theme identity). */
export function petThemeFromPack(pack: PetPackManifest): PetThemeDefinition {
  return {
    id: petPackThemeId(pack.id),
    characterName: pack.displayName,
    displayName: pack.displayName,
    subtitle: pack.description || "Imported codex-pet",
    interfaceTheme: "pet",
    source: "codex-pet-pack"
  };
}

/** Built-in themes first, then installed packs in their listed order. */
export function listPetThemes(packs: readonly PetPackManifest[] = []): PetThemeDefinition[] {
  return [...builtinPetThemes, ...packs.map(petThemeFromPack)];
}

function normalizePetThemeId(value: unknown, packs: readonly PetPackManifest[] = []): string {
  if (typeof value === "string" && listPetThemes(packs).some(theme => theme.id === value)) return value;
  return BUILTIN_PET_THEME_ID;
}

export function getPetTheme(value: unknown, packs: readonly PetPackManifest[] = []): PetThemeDefinition {
  const id = normalizePetThemeId(value, packs);
  return listPetThemes(packs).find(theme => theme.id === id) ?? builtinPetThemes[0];
}

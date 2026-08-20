import { BUILTIN_PET_THEME_ID, BUILTIN_PET_THEME_NAME } from "../shared/petThemeCatalog";

export interface TrayPetEntry {
  id: string;
  name: string;
}

export function isRemovedBuiltinPetTheme(themeId: unknown, removedBuiltinPetThemes: unknown): boolean {
  return themeId === BUILTIN_PET_THEME_ID
    && Array.isArray(removedBuiltinPetThemes)
    && removedBuiltinPetThemes.includes(BUILTIN_PET_THEME_ID);
}

export function buildTrayMenuPets(
  activeThemeId: unknown,
  installedPets: readonly TrayPetEntry[],
  removedBuiltinPetThemes: unknown
): Array<TrayPetEntry & { active: boolean }> {
  const pets = [
    ...(isRemovedBuiltinPetTheme(BUILTIN_PET_THEME_ID, removedBuiltinPetThemes)
      ? []
      : [{ id: BUILTIN_PET_THEME_ID, name: BUILTIN_PET_THEME_NAME }]),
    ...installedPets
  ];
  const active = typeof activeThemeId === "string" ? activeThemeId : "";
  const activeExists = pets.some(pet => pet.id === active);
  const fallbackId = pets[0]?.id;
  return pets.map(pet => ({ ...pet, active: activeExists ? pet.id === active : pet.id === fallbackId }));
}

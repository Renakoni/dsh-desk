import type { CompanionSettings } from "../shared/events";
import { defaultSettings } from "../shared/events";
import { getPetTheme } from "./utils/petThemes";

export function applyCompanionAppearance(settings: Pick<CompanionSettings, "theme" | "petTheme" | "uiStyle">) {
  const activePetTheme = getPetTheme(settings.petTheme ?? defaultSettings.petTheme);
  document.documentElement.setAttribute("data-pet-theme", activePetTheme.id);
  document.documentElement.setAttribute("data-ui-style", settings.uiStyle || "classic");

  if (settings.theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (settings.theme === "system") {
    document.documentElement.setAttribute("data-theme", activePetTheme.interfaceTheme);
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

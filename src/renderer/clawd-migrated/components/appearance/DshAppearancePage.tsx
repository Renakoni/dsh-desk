// @ts-nocheck
import React, { useEffect, useState } from "react";
import { Bot, Palette } from "lucide-react";
import { useI18n } from "../../useI18n";
import { DshThemesPage } from "../themes/DshThemesPage";
import { PetThemeGrid } from "../../features/settings/PetThemeGrid";

type DshAppearancePageProps = {
  active: boolean;
  settings: any;
  updateSettings: (settings: any) => void;
  petPacks?: any[];
  refreshPetPacks?: () => void;
};

/** The appearance workbench keeps DSH skins and desktop-pet packs separate. */
export function DshAppearancePage({ active, settings, updateSettings, petPacks = [], refreshPetPacks }: DshAppearancePageProps) {
  const { t } = useI18n();
  const [subsection, setSubsection] = useState<"themes" | "pet">("themes");

  useEffect(() => {
    if (!active) setSubsection("themes");
  }, [active]);

  function selectSubsection(next: "themes" | "pet") {
    setSubsection(next);
    window.requestAnimationFrame(() => document.querySelector(".section-content")?.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  return (
    <section className="settings-page appearance-page">
      <header className="settings-page-head appearance-page-head">
        <div>
          <span>{t("appearance.eyebrow", "Appearance")}</span>
          <h2>{t("settings.tabs.themes", "外观")}</h2>
        </div>
        <nav className="settings-subtabs" aria-label={t("appearance.navigation", "外观分类")}>
          <button type="button" className={`settings-subtab ${subsection === "themes" ? "active" : ""}`} onClick={() => selectSubsection("themes")}>
            <Palette size={14} />
            <span>{t("appearance.dshThemes", "DSH 主题")}</span>
          </button>
          <button type="button" className={`settings-subtab ${subsection === "pet" ? "active" : ""}`} onClick={() => selectSubsection("pet")}>
            <Bot size={14} />
            <span>{t("appearance.desktopPet", "桌宠")}</span>
          </button>
        </nav>
      </header>

      <div className="appearance-page-content">
        {subsection === "themes" ? (
          <DshThemesPage active={active && subsection === "themes"} />
        ) : (
          <section className="appearance-pet-library settings-page" aria-label={t("appearance.desktopPet", "桌宠")}>
            <header className="appearance-library-header">
              <div>
                <h2>{t("appearance.petLibraryTitle", "桌宠库")}</h2>
                <p>{t("appearance.petLibrarySummary", "选择角色、导入宠物包或从图库获取新的桌宠。")}</p>
              </div>
            </header>
            <PetThemeGrid
              activeThemeId={settings.petTheme}
              petPacks={petPacks}
              onSelectTheme={themeId => updateSettings({ petTheme: themeId })}
              refreshPetPacks={() => refreshPetPacks?.()}
            />
          </section>
        )}
      </div>
    </section>
  );
}

// @ts-nocheck
import React, { useEffect, useRef, useState } from "react";
import { Bot, Palette } from "lucide-react";
import type { DshSkinOperationProgress } from "../../../../shared/dshSkins";
import { useI18n } from "../../useI18n";
import { DshThemesPage } from "../themes/DshThemesPage";
import type { DshThemeOperationNotice } from "../themes/DshThemeMarketPanel";
import { PetThemeGrid } from "../../features/settings/PetThemeGrid";

type DshAppearancePageProps = {
  active: boolean;
  settings: any;
  updateSettings: (settings: any) => Promise<void> | void;
  petPacks?: any[];
  refreshPetPacks?: () => void;
};

/** The appearance workbench keeps DSH skins and desktop-pet packs separate. */
export function DshAppearancePage({ active, settings, updateSettings, petPacks = [], refreshPetPacks }: DshAppearancePageProps) {
  const { t } = useI18n();
  const [subsection, setSubsection] = useState<"themes" | "pet">("themes");
  const [themeOperationKey, setThemeOperationKeyState] = useState<string | null>(null);
  const [themeOperationProgress, setThemeOperationProgress] = useState<DshSkinOperationProgress | null>(null);
  const [themeNotice, setThemeNotice] = useState<DshThemeOperationNotice | null>(null);
  const [themeNoticeFading, setThemeNoticeFading] = useState(false);
  const themeOperationKeyRef = useRef<string | null>(null);

  function setThemeOperationKey(key: string | null) {
    themeOperationKeyRef.current = key;
    setThemeOperationKeyState(key);
  }

  useEffect(() => {
    const subscribe = window.companion.onDshSkinProgress;
    if (!subscribe) return undefined;
    return subscribe(progress => {
      // The host emits null before the temporary override finishes. Keep the
      // visible progress rail until the operation releases its shared lock.
      if (progress === null && themeOperationKeyRef.current !== null) return;
      setThemeOperationProgress(progress);
    });
  }, []);

  useEffect(() => {
    if (!themeNotice || themeNotice.persistent) {
      setThemeNoticeFading(false);
      return undefined;
    }
    setThemeNoticeFading(false);
    const fadeTimer = window.setTimeout(() => setThemeNoticeFading(true), 9_700);
    const clearTimer = window.setTimeout(() => {
      setThemeNotice(null);
      setThemeNoticeFading(false);
    }, 10_000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [themeNotice]);

  useEffect(() => {
    if (!active) setSubsection("themes");
  }, [active]);

  function selectSubsection(next: "themes" | "pet") {
    setSubsection(next);
    window.requestAnimationFrame(() => document.querySelector(".section-content")?.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  async function removeBuiltinPetTheme(themeId: string, nextThemeId: string | null) {
    const removed = Array.isArray(settings.removedBuiltinPetThemes) ? settings.removedBuiltinPetThemes : [];
    await updateSettings({
      removedBuiltinPetThemes: [...new Set([...removed, themeId])],
      ...(nextThemeId ? { petTheme: nextThemeId } : {})
    });
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
          <DshThemesPage
            active={active && subsection === "themes"}
            operationKey={themeOperationKey}
            operationProgress={themeOperationProgress}
            notice={themeNotice}
            noticeFading={themeNoticeFading}
            onBusyChange={setThemeOperationKey}
            onProgressChange={setThemeOperationProgress}
            onNoticeChange={setThemeNotice}
          />
        ) : (
          <section className="appearance-pet-library settings-page" aria-label={t("appearance.desktopPet", "桌宠")} tabIndex={0}>
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
              removedBuiltinThemeIds={settings.removedBuiltinPetThemes ?? []}
              onRemoveBuiltinTheme={removeBuiltinPetTheme}
              refreshPetPacks={() => refreshPetPacks?.()}
            />
          </section>
        )}
      </div>
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Plus, Terminal, Trash2 } from "lucide-react";
import { useI18n } from "../../useI18n";
import { SpritesheetSprite } from "../../../components/SpritesheetSprite";
import minatoAquaCover from "../../../assets/themes/minato-aqua-cover.png";
import type { PetPackManifest } from "../../../../shared/petPack";
import { spritesheetAssetsFromPack } from "../../../../shared/petPackAssets";
import { parsePetInstallCommand } from "../../../../shared/petInstallCommand";
import { CODEX_PET_GALLERY_URL, type PetPackDownloadCode } from "../../../../shared/petPackTransport";
import { BUILTIN_PET_THEME_ID, packIdFromThemeId } from "../../../../shared/petThemeCatalog";
import { displayedSpriteHeight } from "../../../../shared/spriteFrame";
import { listPetThemes, type PetThemeDefinition } from "../../utils/petThemes";
import { PetImportDialog } from "./PetImportDialog";

const REMOVE_ARM_TIMEOUT_MS = 4000;

const builtinCovers: Record<string, string> = {
  [BUILTIN_PET_THEME_ID]: minatoAquaCover
};

/**
 * Theme picker for Settings → Desktop Pet: built-in themes, installed pet
 * packs (with a safely two-step remove), and the import entry (file picker
 * and drag-drop). Selection and removal are separate sibling buttons; the
 * armed remove state shows visible confirmation text, is announced via a
 * live region, disarms on blur/Escape/timeout, and the active theme only
 * changes after a deletion actually succeeded.
 */
export function PetThemeGrid({ activeThemeId, petPacks, onSelectTheme, refreshPetPacks }: {
  activeThemeId: string;
  petPacks: PetPackManifest[];
  onSelectTheme: (themeId: string) => void;
  refreshPetPacks: () => void;
}) {
  const { t } = useI18n();
  const [importZipPath, setImportZipPath] = useState<string | null>(null);
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Visible notices lead with a localized headline; raw main-process strings
  // (filesystem errors, cleanup warnings) are technical detail only.
  const [notice, setNotice] = useState<{ headline: string; detail?: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  // One-click gallery install: the pasted install command (or a bare slug),
  // a single in-flight download, and the attribution the dialog shows for a
  // downloaded package. The command is parsed, never executed.
  const [installCommand, setInstallCommand] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [downloadedAttribution, setDownloadedAttribution] = useState<{ galleryUrl: string; creator: string } | null>(null);

  useEffect(() => {
    return window.companion.onPetPackDownloadProgress?.(payload => {
      const { receivedBytes, totalBytes } = payload;
      setDownloadPercent(totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null);
    });
  }, []);

  function downloadFailureHeadline(code: PetPackDownloadCode): string {
    if (code === "invalid-slug") return t("petImport.errInvalidSlug", "请输入宠物 ID，例如 happy-dog");
    if (code === "not-found") return t("petImport.errNotFound", "图库中没有这个宠物");
    if (code === "too-large") return t("petImport.errTooLarge", "宠物包过大");
    if (code === "invalid-package") return t("petImport.errInvalidPackage", "图库条目不是有效的宠物包");
    if (code === "unavailable") return t("petImport.errUnavailable", "仅桌面应用支持下载");
    return t("petImport.errNetwork", "下载失败，请检查网络");
  }

  async function beginInstallFromCommand() {
    if (!installCommand.trim() || downloading) return;
    const parsed = parsePetInstallCommand(installCommand);
    if (!parsed.ok) {
      const headline = parsed.code === "unsupported-installer"
        ? t("petImport.errUnsupportedInstaller", "暂不支持 {installer} 安装器，目前仅支持 codex-pet.org 的命令").split("{installer}").join(parsed.installer ?? "")
        : t("petImport.errUnrecognizedCommand", "无法识别该命令，请粘贴宠物页面上的安装命令，例如 npx codex-pet-installer add happy-dog");
      setNotice({ headline });
      setStatusMessage(headline);
      return;
    }
    setDownloading(true);
    setDownloadPercent(null);
    setNotice(null);
    setStatusMessage(t("petImport.downloading", "下载中…"));
    try {
      const result = await window.companion.downloadPetPack(parsed.slug);
      if (result.ok) {
        setDownloadedAttribution({ galleryUrl: result.galleryUrl, creator: result.creator });
        setImportZipPath(result.zipPath);
        setInstallCommand("");
        setStatusMessage("");
      } else {
        setNotice({ headline: downloadFailureHeadline(result.code), detail: result.detail });
        setStatusMessage(downloadFailureHeadline(result.code));
      }
    } catch {
      setNotice({ headline: t("petImport.ipcFailed", "导入服务不可用，请重试") });
      setStatusMessage(t("petImport.ipcFailed", "导入服务不可用，请重试"));
    } finally {
      setDownloading(false);
      setDownloadPercent(null);
    }
  }

  // A stale first click must never turn a later stray click into a deletion.
  useEffect(() => {
    if (!armedRemoveId) return;
    const timer = setTimeout(() => setArmedRemoveId(null), REMOVE_ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armedRemoveId]);

  function disarm() {
    setArmedRemoveId(null);
  }

  async function handleRemove(theme: PetThemeDefinition) {
    if (removingId) return;
    if (armedRemoveId !== theme.id) {
      setArmedRemoveId(theme.id);
      setStatusMessage(t("petImport.removeConfirm", "再次点击确认移除"));
      return;
    }
    setArmedRemoveId(null);
    setRemovingId(theme.id);
    try {
      const packId = packIdFromThemeId(theme.id);
      const result = packId
        ? await window.companion.removePetPack(packId)
        : { ok: false as const, error: t("petImport.removeFailed", "移除失败") };
      if (result.ok) {
        // Only a successful deletion may change the selection; the pet
        // window falls back gracefully during the refresh.
        if (activeThemeId === theme.id) onSelectTheme(BUILTIN_PET_THEME_ID);
        setNotice(null);
        setStatusMessage(t("petImport.removed", "已移除"));
      } else {
        setNotice({ headline: t("petImport.removeFailed", "移除失败"), detail: result.error });
        setStatusMessage(t("petImport.removeFailed", "移除失败"));
      }
    } catch {
      setNotice({ headline: t("petImport.removeFailed", "移除失败") });
      setStatusMessage(t("petImport.removeFailed", "移除失败"));
    } finally {
      setRemovingId(null);
      refreshPetPacks();
    }
  }

  async function beginImportFromPicker() {
    try {
      const zipPath = await window.companion.pickPetPackFile();
      if (zipPath) {
        setDownloadedAttribution(null);
        setImportZipPath(zipPath);
      }
    } catch {
      setNotice({ headline: t("petImport.ipcFailed", "导入服务不可用，请重试") });
      setStatusMessage(t("petImport.ipcFailed", "导入服务不可用，请重试"));
    }
  }

  function beginImportFromDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const zipPath = window.companion.getPetPackFilePath(file);
    if (zipPath) {
      setDownloadedAttribution(null);
      setImportZipPath(zipPath);
    }
  }

  // Downloaded archives are lifecycle-owned temp files: discard them when
  // the import finishes or is dismissed. File-picked zips belong to the
  // user and are never deleted (main confines deletion to pet-downloads
  // regardless).
  function discardDownloadedArchive() {
    if (downloadedAttribution && importZipPath) {
      void window.companion.discardPetPackDownload(importZipPath);
    }
  }

  function handleImported(themeId: string, warning?: string) {
    discardDownloadedArchive();
    setImportZipPath(null);
    setDownloadedAttribution(null);
    setNotice(warning ? { headline: t("petImport.installedWithWarning", "已安装，但有警告"), detail: warning } : null);
    setStatusMessage(warning ? t("petImport.installedWithWarning", "已安装，但有警告") : t("petImport.installedStatus", "已安装"));
    refreshPetPacks();
    onSelectTheme(themeId);
  }

  function handleDialogClosed() {
    discardDownloadedArchive();
    setImportZipPath(null);
    setDownloadedAttribution(null);
  }

  return (
    <>
      <div className="pet-theme-grid" onDragOver={event => event.preventDefault()} onDrop={beginImportFromDrop}>
        {listPetThemes(petPacks).map(theme => {
          const packId = packIdFromThemeId(theme.id);
          const pack = packId ? petPacks.find(candidate => candidate.id === packId) : undefined;
          const armed = armedRemoveId === theme.id;
          return (
            <div
              key={theme.id}
              className="pet-theme-card-wrap"
              onKeyDown={event => { if (event.key === "Escape") disarm(); }}
            >
              <button
                type="button"
                className={`pet-theme-card ${activeThemeId === theme.id ? "active" : ""}`}
                onClick={() => { disarm(); onSelectTheme(theme.id); }}
              >
                {pack ? <PackThemeCover pack={pack} /> : <img src={builtinCovers[theme.id]} alt="" draggable={false} />}
                <span className="pet-theme-card-copy">
                  <strong>{theme.displayName}</strong>
                  <small>{pack ? t("petImport.importedTheme", "导入宠物") : theme.characterName}</small>
                </span>
              </button>
              {pack ? (
                <button
                  type="button"
                  className={`pet-theme-remove ${armed ? "armed" : ""}`}
                  disabled={removingId !== null}
                  aria-label={armed ? t("petImport.removeConfirm", "再次点击确认移除") : t("petImport.remove", "移除")}
                  onClick={() => void handleRemove(theme)}
                  onBlur={() => { if (armed) disarm(); }}
                >
                  {armed ? <span className="pet-theme-remove-label">{t("petImport.removeArmedLabel", "确认移除")}</span> : <Trash2 size={13} />}
                </button>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="pet-theme-card pet-theme-import-card" onClick={() => void beginImportFromPicker()}>
          <span className="pet-theme-import-mark"><Plus size={22} /></span>
          <span className="pet-theme-card-copy">
            <strong>{t("petImport.importCard", "导入宠物")}</strong>
            <small>{t("petImport.importHint", "codex-pet 宠物包 (.zip)")}</small>
          </span>
        </button>
      </div>
      <div className="pet-install-by-id">
        <span className="pet-install-command">
          <Terminal size={13} aria-hidden="true" />
          <input
            type="text"
            value={installCommand}
            onChange={event => setInstallCommand(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") void beginInstallFromCommand(); }}
            placeholder={t("petImport.commandPlaceholder", "npx codex-pet-installer add happy-dog")}
            aria-label={t("petImport.installCommand", "安装命令")}
            disabled={downloading}
            spellCheck={false}
          />
        </span>
        <button
          type="button"
          className="pet-install-by-id-get"
          onClick={() => void beginInstallFromCommand()}
          disabled={downloading || !installCommand.trim()}
        >
          <Download size={13} />
          {downloading
            ? downloadPercent !== null
              ? `${t("petImport.downloading", "下载中…")} ${downloadPercent}%`
              : t("petImport.downloading", "下载中…")
            : t("petImport.download", "获取")}
        </button>
        <button
          type="button"
          className="pet-install-by-id-gallery"
          onClick={() => void window.companion.openExternal(CODEX_PET_GALLERY_URL)}
        >
          <ExternalLink size={13} />
          {t("petImport.openGallery", "打开宠物图库")}
        </button>
      </div>
      <p className="pet-theme-status" role="status" aria-live="polite">{statusMessage}</p>
      {notice ? (
        <p className="pet-theme-notice">
          {notice.headline}
          {notice.detail ? <small className="pet-theme-notice-detail">{notice.detail}</small> : null}
        </p>
      ) : null}
      {importZipPath ? (
        <PetImportDialog
          zipPath={importZipPath}
          galleryUrl={downloadedAttribution?.galleryUrl}
          creator={downloadedAttribution?.creator}
          onClose={handleDialogClosed}
          onInstalled={handleImported}
        />
      ) : null}
    </>
  );
}

// Theme-card cover for an imported pack: the sheet's first idle frame,
// rendered statically through the same sprite component the pet uses.
function PackThemeCover({ pack }: { pack: PetPackManifest }) {
  const assets = spritesheetAssetsFromPack(pack);
  const idle = assets.animations.idle;
  const width = 96;
  const height = displayedSpriteHeight(assets.cellWidth, assets.cellHeight, width);
  if (!idle) return <span className="pet-theme-cover-sprite" style={{ width, height }} />;
  return (
    <span className="pet-theme-cover-sprite" style={{ width, height }}>
      <SpritesheetSprite
        sheetUrl={assets.sheetUrl}
        columns={assets.columns}
        rows={assets.rows}
        row={idle.row}
        frameCount={1}
        frameDurationMs={160}
        width={width}
        height={height}
        alt=""
      />
    </span>
  );
}

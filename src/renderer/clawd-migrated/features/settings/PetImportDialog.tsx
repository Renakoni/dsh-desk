import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "../../useI18n";
import { SpritesheetSprite } from "../../../components/SpritesheetSprite";
import { scanRowFrameCounts } from "../../../../shared/petPackScan";
import type { PetPackProblem } from "../../../../shared/petPack";
import type { StagedPetPack } from "../../../../shared/petPackTransport";
import { petPackThemeId } from "../../../../shared/petThemeCatalog";
import { displayedSpriteHeight } from "../../../../shared/spriteFrame";

type ImportPhase = "inspecting" | "scanning" | "ready" | "installing" | "failed";

const PREVIEW_WIDTH = 128;

const MANIFEST_PROBLEM_FIELDS = new Set(["pet.json", "id", "displayName", "description", "spritesheetPath"]);
const SHEET_PROBLEM_FIELDS = new Set(["spritesheet", "width", "height", "size"]);

// Package problems arrive with stable field names from the main process; the
// user-facing headline is localized per field group, and the raw English
// messages stay visible as technical detail only.
function problemHeadline(t: (key: string, fallback?: string) => string, problems: PetPackProblem[]): string {
  const field = problems[0]?.field ?? "";
  if (field === "zip") return t("petImport.problemZip", "宠物包无法读取或超出大小限制");
  if (MANIFEST_PROBLEM_FIELDS.has(field)) return t("petImport.problemManifest", "pet.json 清单无效");
  if (SHEET_PROBLEM_FIELDS.has(field)) return t("petImport.problemSheet", "精灵图不符合 codex-pet 规格");
  if (field === "package") return t("petImport.problemChanged", "宠物包在检查后被修改，请重新导入");
  return t("petImport.invalidPackage", "无法导入该宠物包");
}

/**
 * Import flow for one .codex-pet.zip: inspect (main validates and stages),
 * decode + alpha-scan the sheet here in Chromium, preview the pet, then
 * install bound to the inspected package digest. Install stays disabled
 * until the scan succeeds — an undecodable sheet can never be installed.
 * Closing is blocked while an install is in flight (there is no cancel
 * contract for it), and results arriving after unmount are dropped.
 */
export function PetImportDialog({ zipPath, galleryUrl, creator, onClose, onInstalled }: {
  zipPath: string;
  /** Gallery page of a downloaded package, for creator attribution. */
  galleryUrl?: string;
  creator?: string;
  onClose: () => void;
  onInstalled: (themeId: string, warning?: string) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<ImportPhase>("inspecting");
  const [staged, setStaged] = useState<StagedPetPack | null>(null);
  const [rowFrameCounts, setRowFrameCounts] = useState<number[] | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [needsOverwrite, setNeedsOverwrite] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Initial focus into the dialog; focus returns to the import trigger on
  // unmount.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase("inspecting");
    setStaged(null);
    setRowFrameCounts(null);
    setHeadline(null);
    setDetails([]);
    setNeedsOverwrite(false);

    const failWith = (message: string, extra: string[] = []) => {
      if (cancelled) return;
      setHeadline(message);
      setDetails(extra);
      setPhase("failed");
    };

    window.companion.inspectPetPack(zipPath).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        failWith(problemHeadline(t, result.problems), result.problems.map(problem => problem.message));
        return;
      }
      setStaged(result.staged);
      setPhase("scanning");

      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("no 2d context");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const counts = scanRowFrameCounts(pixels, result.staged.geometry);
          if (counts[0] < 1) throw new Error("idle row is empty");
          setRowFrameCounts(counts);
          setPhase("ready");
        } catch {
          failWith(t("petImport.decodeFailed", "精灵图无法解析，无法导入"));
        }
      };
      image.onerror = () => failWith(t("petImport.decodeFailed", "精灵图无法解析，无法导入"));
      image.src = result.staged.sheetDataUrl;
    }).catch(() => failWith(t("petImport.ipcFailed", "导入服务不可用，请重试")));

    return () => { cancelled = true; };
  }, [zipPath, t]);

  async function install(overwrite: boolean) {
    if (!staged || !rowFrameCounts) return;
    setPhase("installing");
    try {
      const result = await window.companion.installPetPack(zipPath, rowFrameCounts, staged.packageSha256, overwrite);
      if (!mountedRef.current) return;
      if (result.ok) {
        onInstalled(petPackThemeId(result.pack.id), result.warning);
        return;
      }
      if (!overwrite && result.problems.some(problem => problem.field === "id")) {
        setNeedsOverwrite(true);
        setPhase("ready");
        return;
      }
      setHeadline(problemHeadline(t, result.problems));
      setDetails(result.problems.map(problem => problem.message));
      setPhase("failed");
    } catch {
      if (!mountedRef.current) return;
      setHeadline(t("petImport.ipcFailed", "导入服务不可用，请重试"));
      setDetails([]);
      setPhase("failed");
    }
  }

  const closable = phase !== "installing";

  function requestClose() {
    if (closable) onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    // Simple focus containment: cycle within the dialog's focusable controls.
    // Initial focus sits on the dialog container itself, so backwards Tab
    // from there must wrap to the last control instead of leaving the modal.
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const previewHeight = staged ? displayedSpriteHeight(staged.geometry.cellWidth, staged.geometry.cellHeight, PREVIEW_WIDTH) : PREVIEW_WIDTH;
  const canInstall = phase === "ready" && staged !== null && rowFrameCounts !== null;

  const statusText = phase === "inspecting" ? t("petImport.inspecting", "读取宠物包…")
    : phase === "scanning" ? t("petImport.scanning", "扫描动画帧…")
    : phase === "installing" ? t("petImport.installing", "安装中…")
    : phase === "failed" ? headline ?? t("petImport.invalidPackage", "无法导入该宠物包")
    : needsOverwrite ? t("petImport.overwriteConfirm", "已安装同名宠物，覆盖安装？")
    : "";

  // Portaled to <body> like every other modal (ConfirmDialog, ProviderEditPanel,
  // IconPicker): the overlay is position:fixed, and any transformed ancestor
  // would become its containing block — the settings group-card lifts 1px on
  // hover (80-settings-animations.css), which re-anchored the "fixed" overlay
  // from the viewport to the card and made the dialog jump on mouse-enter.
  return createPortal(
    <div className="pet-import-overlay" role="dialog" aria-modal="true" aria-label={t("petImport.dialogTitle", "导入宠物")}>
      <div className="pet-import-dialog" ref={dialogRef} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="pet-import-head">
          <h3>{t("petImport.dialogTitle", "导入宠物")}</h3>
          <button type="button" className="pet-import-close" onClick={requestClose} disabled={!closable} aria-label={t("common.close", "关闭")}><X size={16} /></button>
        </header>

        <p className="pet-import-status" role="status" aria-live="polite">{statusText}</p>

        {phase === "failed" ? (
          <div className="pet-import-problems">
            <strong>{headline ?? t("petImport.invalidPackage", "无法导入该宠物包")}</strong>
            {details.map((message, index) => <span key={index}>{message}</span>)}
          </div>
        ) : (
          <div className="pet-import-body">
            <div className="pet-import-preview" style={{ width: PREVIEW_WIDTH, height: previewHeight }}>
              {staged && rowFrameCounts ? (
                <SpritesheetSprite
                  sheetUrl={staged.sheetDataUrl}
                  columns={staged.geometry.columns}
                  rows={staged.geometry.rows}
                  row={0}
                  frameCount={rowFrameCounts[0]}
                  frameDurationMs={160}
                  width={PREVIEW_WIDTH}
                  height={previewHeight}
                  alt={staged.manifest.displayName}
                />
              ) : (
                <span className="pet-import-loading">
                  {phase === "inspecting" ? t("petImport.inspecting", "读取宠物包…") : t("petImport.scanning", "扫描动画帧…")}
                </span>
              )}
            </div>
            <div className="pet-import-info">
              <strong>{staged?.manifest.displayName ?? "…"}</strong>
              <code>{staged?.manifest.id ?? ""}</code>
              {staged?.manifest.description ? <p>{staged.manifest.description}</p> : null}
              {rowFrameCounts ? (
                <small>{t("petImport.animationsFound", "识别动画：")} {rowFrameCounts.filter(count => count > 0).length}</small>
              ) : null}
              {creator ? <small className="pet-import-creator">{t("petImport.byCreator", "作者：")}{creator}</small> : null}
              {galleryUrl ? (
                <button type="button" className="pet-import-gallery-link" onClick={() => void window.companion.openExternal(galleryUrl)}>
                  {t("petImport.viewOnGallery", "在 codex-pet.org 查看")}
                </button>
              ) : null}
              {needsOverwrite ? <em className="pet-import-overwrite-note">{t("petImport.overwriteConfirm", "已安装同名宠物，覆盖安装？")}</em> : null}
            </div>
          </div>
        )}

        <footer className="pet-import-actions">
          <button type="button" className="pet-import-cancel" onClick={requestClose} disabled={!closable}>{t("petImport.cancel", "取消")}</button>
          {phase !== "failed" ? (
            <button
              type="button"
              className="pet-import-install"
              disabled={!canInstall}
              onClick={() => void install(needsOverwrite)}
            >
              {phase === "installing"
                ? t("petImport.installing", "安装中…")
                : needsOverwrite
                  ? t("petImport.overwrite", "覆盖安装")
                  : t("petImport.install", "安装")}
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body
  );
}

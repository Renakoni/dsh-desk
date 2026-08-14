// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetImportDialog } from "../src/renderer/clawd-migrated/features/settings/PetImportDialog";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import type { PetPackInspectResult, PetPackInstallResult } from "../src/shared/petPackTransport";
import { FakeSheetImage, IMPORT_DIGEST as DIGEST, IMPORT_SHEET_COUNTS as SHEET_COUNTS, stagedFixture, stubSheetDecoding } from "./helpers/importStubs";

const ZIP = "C:/qa/boba.codex-pet.zip";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface CompanionMock {
  inspectPetPack: ReturnType<typeof vi.fn>;
  installPetPack: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
}

let companion: CompanionMock;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onInstalled: ReturnType<typeof vi.fn<(themeId: string, warning?: string) => void>>;

function renderDialog() {
  return render(
    <I18nProvider initialLocale="en">
      <PetImportDialog zipPath={ZIP} onClose={onClose} onInstalled={onInstalled} />
    </I18nProvider>
  );
}

async function renderReadyDialog() {
  const view = renderDialog();
  await waitFor(() => expect(FakeSheetImage.instances.length).toBe(1));
  act(() => { FakeSheetImage.instances[0].onload?.(); });
  await screen.findByRole("button", { name: "Install" });
  return view;
}

beforeEach(() => {
  companion = {
    inspectPetPack: vi.fn(async (): Promise<PetPackInspectResult> => ({ ok: true, staged: stagedFixture() })),
    installPetPack: vi.fn(async (): Promise<PetPackInstallResult> => ({ ok: false, problems: [{ field: "install", message: "unset" }] })),
    openExternal: vi.fn(async () => undefined)
  };
  Reflect.set(window, "companion", companion);
  onClose = vi.fn<() => void>();
  onInstalled = vi.fn<(themeId: string, warning?: string) => void>();
  stubSheetDecoding();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "companion");
});

describe("PetImportDialog", () => {
  it("recovers into a localized failure state when the inspect IPC rejects", async () => {
    companion.inspectPetPack.mockRejectedValueOnce(new Error("ipc down"));
    renderDialog();
    await screen.findAllByText("The import service is unavailable — try again");
    // Recoverable: closing stays possible, installing is not offered.
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("maps manifest problems to a localized headline with raw detail", async () => {
    companion.inspectPetPack.mockResolvedValueOnce({ ok: false, problems: [{ field: "pet.json", message: "pet.json is not valid JSON" }] });
    renderDialog();
    await screen.findAllByText("The pet.json manifest is invalid");
    expect(screen.getByText("pet.json is not valid JSON")).toBeTruthy();
    expect(companion.installPetPack).not.toHaveBeenCalled();
  });

  it("never enables install when the sheet cannot be decoded", async () => {
    renderDialog();
    await waitFor(() => expect(FakeSheetImage.instances.length).toBe(1));
    act(() => { FakeSheetImage.instances[0].onerror?.(); });
    await screen.findAllByText("The spritesheet could not be decoded");
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(companion.installPetPack).not.toHaveBeenCalled();
  });

  it("submits exactly the scanned frame counts and the inspected digest", async () => {
    companion.installPetPack.mockResolvedValueOnce({ ok: true, pack: { id: "boba" } });
    await renderReadyDialog();
    expect(screen.getByText(/Animations found:/).parentElement?.textContent).toContain("7");

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith("codex-pet:boba", undefined));
    expect(companion.installPetPack).toHaveBeenCalledWith(ZIP, SHEET_COUNTS, DIGEST, false);
  });

  it("turns a duplicate id into an explicit overwrite step", async () => {
    companion.installPetPack
      .mockResolvedValueOnce({ ok: false, problems: [{ field: "id", message: "already installed" }] })
      .mockResolvedValueOnce({ ok: true, pack: { id: "boba" }, warning: "leftover backup" });
    await renderReadyDialog();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    const overwriteButton = await screen.findByRole("button", { name: "Overwrite" });
    fireEvent.click(overwriteButton);

    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith("codex-pet:boba", "leftover backup"));
    expect(companion.installPetPack).toHaveBeenNthCalledWith(2, ZIP, SHEET_COUNTS, DIGEST, true);
  });

  it("recovers when the install IPC rejects", async () => {
    companion.installPetPack.mockRejectedValueOnce(new Error("ipc down"));
    await renderReadyDialog();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await screen.findAllByText("The import service is unavailable — try again");
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("blocks closing while an install is in flight", async () => {
    const pending = deferred<PetPackInstallResult>();
    companion.installPetPack.mockReturnValueOnce(pending.promise);
    await renderReadyDialog();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await screen.findByRole("button", { name: "Installing…" });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog").firstElementChild as HTMLElement, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { pending.resolve({ ok: true, pack: { id: "boba" } } as PetPackInstallResult); });
    expect(onInstalled).toHaveBeenCalled();
  });

  it("drops results that arrive after unmount", async () => {
    const pending = deferred<PetPackInstallResult>();
    companion.installPetPack.mockReturnValueOnce(pending.promise);
    const view = await renderReadyDialog();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    view.unmount();
    await act(async () => { pending.resolve({ ok: true, pack: { id: "boba" } } as PetPackInstallResult); });
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("closes on Escape while idle and restores nothing surprising", async () => {
    await renderReadyDialog();
    fireEvent.keyDown(screen.getByRole("dialog").firstElementChild as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Tab inside the dialog from the initial focus position", async () => {
    await renderReadyDialog();
    const dialog = screen.getByRole("dialog").firstElementChild as HTMLElement;
    // Initial focus sits on the dialog container itself.
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).textContent).toBe("Install");
  });

  it("shows creator attribution and the gallery link for downloaded packages", async () => {
    render(
      <I18nProvider initialLocale="en">
        <PetImportDialog
          zipPath={ZIP}
          galleryUrl="https://codex-pet.org/pets/boba"
          creator="qa-user"
          onClose={onClose}
          onInstalled={onInstalled}
        />
      </I18nProvider>
    );
    await waitFor(() => expect(FakeSheetImage.instances.length).toBe(1));
    act(() => { FakeSheetImage.instances[0].onload?.(); });
    await screen.findByRole("button", { name: "Install" });

    expect(screen.getByText(/Creator:/).textContent).toContain("qa-user");
    fireEvent.click(screen.getByRole("button", { name: "View on codex-pet.org" }));
    expect(companion.openExternal).toHaveBeenCalledWith("https://codex-pet.org/pets/boba");
  });
});

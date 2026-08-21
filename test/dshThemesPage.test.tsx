/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshSkinMarketplaceSnapshot } from "../src/shared/dshSkins";
import { ThemePreview } from "../src/renderer/clawd-migrated/components/themes/DshThemeMarketPanel";
import { DshThemesPage } from "../src/renderer/clawd-migrated/components/themes/DshThemesPage";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const themes: DshSkinMarketplaceSnapshot["skins"] = [{
  id: "ocean.theme",
  name: { zh: "海洋主题", en: "Ocean Theme" },
  author: "ocean-author",
  description: "Ocean interface",
  repositoryUrl: "https://github.com/demo/ocean",
  packageName: "ocean-theme",
  rowId: "ocean-theme",
  tags: ["ocean"],
  modes: ["dark"],
  install: { target: "github:demo/ocean#1234567890123456789012345678901234567890", version: "1.0.0", commit: "1234567890123456789012345678901234567890" },
  compatibility: { dsh: "^0.1.0", platform: ["web"] },
  screenshots: ["https://example.com/ocean.png"],
  review: { compatibility: "verified", preview: "verified", installation: "verified" },
  license: { code: "MIT", commercialUse: true },
  stars: 12,
  updatedAt: "2026-08-17T00:00:00.000Z"
}, {
  id: "paper.theme",
  name: { zh: "纸张主题", en: "Paper Theme" },
  author: "paper-author",
  description: "Paper interface",
  repositoryUrl: "https://github.com/demo/paper",
  packageName: "paper-theme",
  rowId: "paper-theme",
  tags: ["light"],
  modes: ["light"],
  install: { target: "github:demo/paper#1234567890123456789012345678901234567890", version: "2.0.0", commit: "1234567890123456789012345678901234567890" },
  compatibility: { dsh: "^0.1.0", platform: ["web"] },
  screenshots: ["https://example.com/paper.png"],
  review: { compatibility: "verified", preview: "verified", installation: "verified" },
  license: { code: "MIT", commercialUse: true },
  stars: 120,
  updatedAt: "2026-08-01T00:00:00.000Z"
}];

function snapshot(host: Partial<DshSkinMarketplaceSnapshot["host"]> = {}): DshSkinMarketplaceSnapshot {
  return {
    skins: themes,
    generatedAt: "2026-08-17T00:00:00.000Z",
    catalogSource: "remote",
    catalogCheckedAt: 1,
    host: { connected: true, marketInstalled: true, skins: [], restartAvailable: true, runningAgentCount: 0, ...host }
  };
}

function renderPage(value = snapshot()) {
  const api = {
    getDshSkinMarketplace: vi.fn(async () => value),
    installDshSkinMarketplace: vi.fn(async () => ({ ok: true, restartRequired: true, snapshot: value })),
    mutateDshSkin: vi.fn(async (): Promise<{ ok: boolean; snapshot: DshSkinMarketplaceSnapshot; supportPrepared?: boolean }> => ({ ok: true, snapshot: value })),
    setDshThemeOverride: vi.fn(async () => ({ ok: true })),
    openExternal: vi.fn(async () => undefined)
  };
  Object.assign(window, { companion: api });
  render(<I18nProvider initialLocale="zh"><DshThemesPage active /></I18nProvider>);
  return api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DshThemesPage", () => {
  it("uses a local installed thumbnail and falls back to the catalog image", async () => {
    const skin = { ...themes[0], previewLocalUrl: "dsh-theme-asset://previews/local.png" };
    render(<ThemePreview skin={skin} />);
    const image = screen.getByRole("img", { name: "海洋主题 界面预览" });
    expect(image.getAttribute("src")).toBe("dsh-theme-asset://previews/local.png");

    fireEvent.error(image);

    await waitFor(() => expect(screen.getByRole("img", { name: "海洋主题 界面预览" }).getAttribute("src")).toBe("https://example.com/ocean.png"));
  });

  it("keeps the local library separate from the visual market", async () => {
    renderPage();
    await screen.findByText("还没有安装主题");
    expect(screen.queryByText("海洋主题")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    await screen.findByText("主题市场");
    expect(screen.getAllByTestId("dsh-theme-card").map(card => card.querySelector("strong")?.textContent)).toEqual(["纸张主题", "海洋主题"]);
    expect(screen.getByRole("button", { name: "Stars" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "最近更新" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "最近更新" }));
    expect(screen.getByRole("button", { name: "Stars" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "最近更新" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByTestId("dsh-theme-card").map(card => card.querySelector("strong")?.textContent)).toEqual(["海洋主题", "纸张主题"]);
    fireEvent.change(screen.getByPlaceholderText("搜索主题或作者"), { target: { value: "paper-author" } });
    expect(screen.queryByText("海洋主题")).toBeNull();
    expect(screen.getByText("纸张主题")).not.toBeNull();
  });

  it("does not expose the internal market component as a user-facing install", async () => {
    const api = renderPage(snapshot({ connected: false, marketInstalled: false }));
    expect(await screen.findByText("还没有安装主题")).not.toBeNull();
    expect(screen.queryByText("安装组件")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    await screen.findByText("海洋主题");
    const oceanCard = screen.getAllByTestId("dsh-theme-card").find(card => within(card).queryByText("海洋主题"));
    expect(within(oceanCard!).getByRole("button", { name: "安装" })).toHaveProperty("disabled", true);
    expect(api.mutateDshSkin).not.toHaveBeenCalled();
    expect(api.installDshSkinMarketplace).not.toHaveBeenCalled();
  });

  it("shows installed themes in the library and keeps their controls there", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }));
    await screen.findByText("海洋主题");
    expect(screen.queryByText("纸张主题")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "使用" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "activate" }));
    expect(api.setDshThemeOverride).toHaveBeenCalledWith({ mode: "temporary", themeId: "ocean.theme" });
  });

  it("shows the active legacy compatibility adapter above the theme actions", async () => {
    renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "0.9.0", installedAt: null, updateAvailable: false, compatibility: { status: "adapted", code: "legacy-keyed-settings-item" } }] }));
    const card = await screen.findByText("海洋主题");
    expect(within(card.closest("article")!).getByText("已启用兼容适配：这个旧版主题正在使用 Desk 的 keyed slot 兼容层。")).not.toBeNull();
  });

  it("shows an unverified compatibility warning above the active theme actions", async () => {
    renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false, compatibility: { status: "unverified", code: "settings-slot-registration-unreadable" } }] }));
    const card = await screen.findByText("海洋主题");
    expect(within(card.closest("article")!).getByText("未能安全确认该主题的兼容性，因此暂不启用。请更新主题或从仓库确认它是否支持当前 DSH。")).not.toBeNull();
  });

  it("opens installed library theme details with runtime and catalog metadata", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "0.9.0", installedAt: "2026-08-18T00:00:00.000Z", updateAvailable: true }] }));
    await screen.findByText("海洋主题");
    const libraryCard = screen.getByText("海洋主题").closest("article");
    expect(within(libraryCard!).getByRole("button", { name: "更新" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看 海洋主题" }));

    const dialog = await screen.findByRole("dialog", { name: "海洋主题" });
    expect(within(dialog).getByText("使用中")).not.toBeNull();
    expect(within(dialog).getByText("可更新")).not.toBeNull();
    expect(within(dialog).getByText("0.9.0")).not.toBeNull();
    expect(within(dialog).getByText("1.0.0")).not.toBeNull();
    expect(within(dialog).getByText("123456789012")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "停用" })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "更新" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "update" }));
  });

  it("keeps the active theme when uninstalling an inactive library theme", async () => {
    const value = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false },
      { skinId: "paper.theme", installation: "installed", activation: "inactive", installedVersion: "2.0.0", installedAt: null, updateAvailable: false }
    ] });
    const api = renderPage(value);
    await screen.findByText("纸张主题");
    const paperCard = screen.getByText("纸张主题").closest("article");

    fireEvent.click(within(paperCard!).getByRole("button", { name: "卸载" }));

    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "paper.theme", action: "uninstall" }));
    expect(api.setDshThemeOverride).not.toHaveBeenCalled();
    expect(within(screen.getByText("海洋主题").closest("article")!).getByText("使用中")).not.toBeNull();
  });

  it("disables the override when uninstalling the active library theme", async () => {
    const api = renderPage(snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }
    ] }));
    await screen.findByText("海洋主题");

    fireEvent.click(screen.getByRole("button", { name: "卸载" }));

    await waitFor(() => expect(api.setDshThemeOverride).toHaveBeenCalledWith({ mode: "disabled" }));
  });

  it("keeps the active theme when uninstalling an inactive theme from market details", async () => {
    const value = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false },
      { skinId: "paper.theme", installation: "installed", activation: "inactive", installedVersion: "2.0.0", installedAt: null, updateAvailable: false }
    ] });
    const api = renderPage(value);
    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    const paperCard = (await screen.findByText("纸张主题")).closest("article");
    fireEvent.click(within(paperCard!).getByRole("button", { name: "详情" }));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "卸载" }));

    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "paper.theme", action: "uninstall" }));
    expect(api.setDshThemeOverride).not.toHaveBeenCalled();
  });

  it("does not offer lifecycle actions while the built-in manager is offline", async () => {
    const api = renderPage(snapshot({
      connected: false,
      marketInstalled: true,
      skins: [{ skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }]
    }));
    await screen.findByText("海洋主题");
    const deactivate = screen.getByRole("button", { name: "停用" });
    const uninstall = screen.getByRole("button", { name: "卸载" });
    expect(deactivate).toHaveProperty("disabled", true);
    expect(uninstall).toHaveProperty("disabled", true);
    expect(api.mutateDshSkin).not.toHaveBeenCalled();
  });

  it("can activate an installed theme outside the catalog without offering uninstall", async () => {
    const api = renderPage({ ...snapshot(), localSkins: [{ id: "local:custom", packageName: "custom-theme", rowId: "custom-theme", name: { zh: "本地主题", en: "Local theme" }, author: "local", description: "local", version: "1.0.0", repositoryUrl: null, active: false, broken: false }] });
    await screen.findByText("本地未收录主题");
    expect(screen.getAllByText("本地主题").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "使用" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "local:custom", action: "activate" }));
    expect(screen.queryByRole("button", { name: "卸载" })).toBeNull();
  });
});

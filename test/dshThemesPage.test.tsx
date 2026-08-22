/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshSkinMarketplaceSnapshot } from "../src/shared/dshSkins";
import { ThemePreview } from "../src/renderer/clawd-migrated/components/themes/DshThemeMarketPanel";
import { DshThemesPage } from "../src/renderer/clawd-migrated/components/themes/DshThemesPage";
import { DshAppearancePage } from "../src/renderer/clawd-migrated/components/appearance/DshAppearancePage";
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
  const view = render(<I18nProvider initialLocale="zh"><DshThemesPage active /></I18nProvider>);
  return Object.assign(api, {
    rerenderActive(active: boolean) {
      view.rerender(<I18nProvider initialLocale="zh"><DshThemesPage active={active} /></I18nProvider>);
    }
  });
}

function renderAppearance(value = snapshot()) {
  const api = {
    getDshSkinMarketplace: vi.fn(async () => value),
    mutateDshSkin: vi.fn(async (): Promise<{ ok: boolean; snapshot: DshSkinMarketplaceSnapshot }> => ({ ok: true, snapshot: value })),
    setDshThemeOverride: vi.fn(async () => ({ ok: true })),
    openExternal: vi.fn(async () => undefined),
    onDshSkinProgress: vi.fn(() => () => undefined)
  };
  Object.assign(window, { companion: api });
  const view = render(<I18nProvider initialLocale="zh"><DshAppearancePage active settings={{ petTheme: "" }} updateSettings={vi.fn()} petPacks={[]} /></I18nProvider>);
  return Object.assign(api, {
    selectSubsection(name: "DSH 主题" | "桌宠") {
      fireEvent.click(screen.getByRole("button", { name }));
    },
    view
  });
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

  it("keeps activation pending until the authoritative theme state is refreshed", async () => {
    const initial = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false },
      { skinId: "paper.theme", installation: "installed", activation: "inactive", installedVersion: "2.0.0", installedAt: null, updateAvailable: false }
    ] });
    const final = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false },
      { skinId: "paper.theme", installation: "installed", activation: "inactive", installedVersion: "2.0.0", installedAt: null, updateAvailable: false }
    ] });
    const api = renderPage(initial);
    let finishOverride!: (value: { ok: boolean }) => void;
    api.mutateDshSkin.mockResolvedValueOnce({
      ok: true,
      snapshot: snapshot({ skins: [
        { skinId: "ocean.theme", installation: "installed", activation: "restart-required", installedVersion: "1.0.0", installedAt: null, updateAvailable: false },
        { skinId: "paper.theme", installation: "installed", activation: "inactive", installedVersion: "2.0.0", installedAt: null, updateAvailable: false }
      ] })
    });
    api.setDshThemeOverride.mockImplementationOnce(() => new Promise(resolve => { finishOverride = resolve; }));
    api.getDshSkinMarketplace.mockResolvedValueOnce(final);

    await screen.findByText("海洋主题");
    fireEvent.click(within(screen.getByText("海洋主题").closest("article")!).getByRole("button", { name: "使用" }));

    await waitFor(() => expect(api.setDshThemeOverride).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "启用中…" })).toHaveProperty("disabled", true);
    expect(within(screen.getByText("纸张主题").closest("article")!).getByRole("button", { name: "使用" })).toHaveProperty("disabled", true);
    expect(document.querySelector(".dsh-theme-feedback")?.getAttribute("data-state")).toBe("progress");
    expect(screen.getByText("正在同步主题状态…")).not.toBeNull();
    expect(screen.queryByText("activate completed")).toBeNull();

    finishOverride({ ok: true });
    await waitFor(() => expect(within(screen.getByText("海洋主题").closest("article")!).getByRole("button", { name: "停用" })).not.toBeNull());
    expect(screen.getByText("主题状态已保存，部分功能可能需要重启 DSH。")).not.toBeNull();
    expect(document.querySelector(".dsh-theme-feedback")?.getAttribute("data-state")).toBe("notice");
  });

  it("keeps deactivation pending until the authoritative theme state is refreshed", async () => {
    const initial = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }
    ] });
    const final = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }
    ] });
    const api = renderPage(initial);
    let finishOverride!: (value: { ok: boolean }) => void;
    api.mutateDshSkin.mockResolvedValueOnce({ ok: true, snapshot: final });
    api.setDshThemeOverride.mockImplementationOnce(() => new Promise(resolve => { finishOverride = resolve; }));
    api.getDshSkinMarketplace.mockResolvedValueOnce(final);

    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "停用" }));

    await waitFor(() => expect(api.setDshThemeOverride).toHaveBeenCalled());
    expect(screen.getByText("使用中")).not.toBeNull();
    expect(screen.getByRole("button", { name: "停用中…" })).toHaveProperty("disabled", true);

    finishOverride({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "使用" })).not.toBeNull());
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
    expect(within(libraryCard!).queryByRole("button", { name: "更新" })).toBeNull();
    expect(libraryCard?.textContent).toContain("可更新");

    fireEvent.click(screen.getByRole("button", { name: "查看 海洋主题" }));

    const dialog = await screen.findByRole("dialog", { name: "海洋主题" });
    expect(within(dialog).getByText("使用中")).not.toBeNull();
    expect(within(dialog).getByText("可更新")).not.toBeNull();
    expect(within(dialog).getByText("0.9.0")).not.toBeNull();
    expect(within(dialog).getByText("1.0.0")).not.toBeNull();
    expect(within(dialog).getByText("123456789012")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "停用" })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "更新" }));
    expect(screen.queryByRole("dialog", { name: "海洋主题" })).toBeNull();
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "update" }));
  });

  it("reports a second update request while another theme operation is running", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "0.9.0", installedAt: null, updateAvailable: true }] }));
    const toastWarning = vi.spyOn(toast, "warning");
    api.mutateDshSkin.mockImplementationOnce(() => new Promise(() => undefined));
    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "查看 海洋主题" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "海洋主题" })).getByRole("button", { name: "更新" }));
    fireEvent.click(screen.getByRole("button", { name: "查看 海洋主题" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "海洋主题" })).getByRole("button", { name: "更新" }));
    expect(toastWarning.mock.calls.at(-1)).toEqual(["另一个主题操作正在进行，请完成后再试。", {
      id: "dsh-theme-operation-busy",
      className: "dsh-theme-warning-toast"
    }]);
    expect(api.mutateDshSkin).toHaveBeenCalledTimes(1);
  });

  it("keeps market navigation locked until theme activation finishes syncing", async () => {
    const value = snapshot({ skins: [
      { skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }
    ] });
    const api = renderPage(value);
    let finishOverride!: (value: { ok: boolean }) => void;
    api.mutateDshSkin.mockResolvedValueOnce({ ok: true, snapshot: value });
    api.setDshThemeOverride.mockImplementationOnce(() => new Promise(resolve => { finishOverride = resolve; }));

    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    const marketCard = (await screen.findByText("海洋主题")).closest("article");
    fireEvent.click(within(marketCard!).getByRole("button", { name: "使用" }));

    await waitFor(() => expect(screen.getByText("正在同步主题状态…")).not.toBeNull());
    const back = screen.getByRole("button", { name: "返回" });
    expect(back).toHaveProperty("disabled", true);
    fireEvent.click(back);
    expect(screen.getByRole("heading", { name: "主题市场" })).not.toBeNull();

    api.rerenderActive(false);
    await screen.findByRole("heading", { name: "主题库" });
    expect(screen.getByRole("button", { name: "使用" })).toHaveProperty("disabled", true);

    finishOverride({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "使用" })).toHaveProperty("disabled", false));
  });

  it("locks the empty-library market entry during an existing host operation", async () => {
    renderPage(snapshot({ skins: [], operation: { skinId: "ocean.theme", action: "install", phase: "downloading", progress: 42 } }));
    const browse = await screen.findByRole("button", { name: "浏览主题市场" });
    expect(browse).toHaveProperty("disabled", true);
  });

  it("keeps the shared operation lock when the appearance child page is replaced", async () => {
    const value = snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] });
    const api = renderAppearance(value);
    let finishOverride!: (result: { ok: boolean }) => void;
    api.mutateDshSkin.mockResolvedValueOnce({ ok: true, snapshot: value });
    api.setDshThemeOverride.mockImplementationOnce(() => new Promise(resolve => { finishOverride = resolve; }));

    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    fireEvent.click(within((await screen.findByText("海洋主题")).closest("article")!).getByRole("button", { name: "使用" }));
    await screen.findByText("正在同步主题状态…");

    api.selectSubsection("桌宠");
    expect(await screen.findByRole("heading", { name: "桌宠库" })).not.toBeNull();
    api.selectSubsection("DSH 主题");
    expect(await screen.findByRole("heading", { name: "主题库" })).not.toBeNull();
    expect(screen.getByText("正在同步主题状态…")).not.toBeNull();
    expect(screen.getByRole("button", { name: "启用中…" })).toHaveProperty("disabled", true);

    finishOverride({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "使用" })).toHaveProperty("disabled", false));
  });

  it("keeps the library locked until an off-screen install refreshes authoritative state", async () => {
    const empty = snapshot({ skins: [] });
    const installed: DshSkinMarketplaceSnapshot = { ...snapshot(), host: { ...snapshot().host, skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] } };
    const api = renderAppearance(empty);
    let currentSnapshot = empty;
    let snapshotRequest = 0;
    let finishStaleRefresh!: () => void;
    let finishAuthoritativeRefresh!: () => void;
    api.getDshSkinMarketplace.mockImplementation(() => {
      snapshotRequest += 1;
      if (snapshotRequest === 1) return new Promise(resolve => { finishStaleRefresh = () => resolve(empty); });
      if (snapshotRequest === 2) return new Promise(resolve => { finishAuthoritativeRefresh = () => resolve(currentSnapshot); });
      return Promise.resolve(currentSnapshot);
    });
    let finishInstall!: () => void;
    api.mutateDshSkin.mockImplementationOnce(() => new Promise(resolve => {
      finishInstall = () => {
        currentSnapshot = installed;
        resolve({ ok: true, snapshot: installed });
      };
    }));

    await screen.findByRole("button", { name: "浏览主题市场" });
    fireEvent.click(screen.getByRole("button", { name: "浏览主题市场" }));
    fireEvent.click(within((await screen.findByText("海洋主题")).closest("article")!).getByRole("button", { name: "安装" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "install" }));

    api.selectSubsection("桌宠");
    await screen.findByRole("heading", { name: "桌宠库" });
    api.selectSubsection("DSH 主题");
    await screen.findByRole("heading", { name: "主题库" });
    expect(screen.getByRole("button", { name: "主题市场" })).toHaveProperty("disabled", true);
    await waitFor(() => expect(api.getDshSkinMarketplace.mock.calls.length).toBeGreaterThanOrEqual(1));

    finishInstall();
    await waitFor(() => expect(api.getDshSkinMarketplace.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("button", { name: "主题市场" })).toHaveProperty("disabled", true);
    expect(screen.getByText("正在同步主题状态…")).not.toBeNull();

    finishAuthoritativeRefresh();
    await waitFor(() => expect(screen.getByText("海洋主题")).not.toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "主题市场" })).toHaveProperty("disabled", false));
    finishStaleRefresh();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("海洋主题")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "浏览主题市场" })).toBeNull();
    expect(screen.getByRole("button", { name: "使用" })).not.toBeNull();
  });

  it("keeps a failed market operation visible after switching appearance pages", async () => {
    const value = snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] });
    const api = renderAppearance(value);
    const error = `pnpm failed ${"dependency output ".repeat(80)}`;
    api.mutateDshSkin.mockRejectedValueOnce(new Error(error));

    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    fireEvent.click(within((await screen.findByText("海洋主题")).closest("article")!).getByRole("button", { name: "使用" }));
    await screen.findByText(content => content.startsWith("pnpm failed") && content.length > 1_000);

    api.selectSubsection("桌宠");
    await screen.findByRole("heading", { name: "桌宠库" });
    api.selectSubsection("DSH 主题");
    await screen.findByRole("heading", { name: "主题库" });
    expect(screen.getByText(content => content.startsWith("pnpm failed") && content.length > 1_000)).not.toBeNull();
    expect(screen.getByRole("button", { name: "关闭" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText(content => content.startsWith("pnpm failed") && content.length > 1_000)).toBeNull();
  });

  it("does not expire a failed operation notice after ten seconds", async () => {
    vi.useFakeTimers();
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }));
    api.mutateDshSkin.mockRejectedValueOnce(new Error("theme install failed"));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "使用" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("theme install failed")).not.toBeNull();
    vi.useRealTimers();
  });

  it("restores an in-flight host operation after switching to the market", async () => {
    renderPage(snapshot({ operation: { skinId: "ocean.theme", action: "install", phase: "downloading", progress: 42, receivedBytes: 420, totalBytes: 1000 } }));
    expect(await screen.findByText("42%")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    expect(await screen.findByText("42%")).not.toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  });

  it("clears the local progress indicator when the mutation IPC call rejects", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }));
    api.mutateDshSkin.mockRejectedValueOnce(new Error("connection lost"));
    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "使用" }));
    await waitFor(() => expect(screen.getByText("connection lost")).not.toBeNull());
    expect(document.querySelector(".dsh-theme-operation-progress")).toBeNull();
  });

  it("keeps long operation errors inside a scrollable feedback message", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }));
    const error = `pnpm failed ${"dependency output ".repeat(100)}`;
    api.mutateDshSkin.mockRejectedValueOnce(new Error(error));

    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "使用" }));

    const message = await screen.findByText(content => content.startsWith("pnpm failed") && content.length > 1_000);
    expect(message.classList.contains("dsh-theme-notice-message")).toBe(true);
    expect(message.getAttribute("tabindex")).toBe("0");
    expect(message.closest(".dsh-theme-feedback")?.getAttribute("data-state")).toBe("notice");
  });

  it("fades the saved-state notice after ten seconds", async () => {
    vi.useFakeTimers();
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.setDshThemeOverride).toHaveBeenCalledWith({ mode: "disabled" });
    const notice = document.querySelector(".dsh-theme-notice");
    expect(notice?.textContent).toContain("部分功能可能需要重启 DSH");
    act(() => vi.advanceTimersByTime(9_700));
    expect(notice?.classList.contains("fading")).toBe(true);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector(".dsh-theme-notice")).toBeNull();
    expect(document.querySelector(".dsh-theme-feedback")?.getAttribute("data-state")).toBe("idle");
    vi.useRealTimers();
  });

  it("keeps use and update as separate actions for an inactive update", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "0.9.0", installedAt: null, updateAvailable: true }] }));
    await screen.findByText("海洋主题");
    const libraryCard = screen.getByText("海洋主题").closest("article");
    expect(within(libraryCard!).getByRole("button", { name: "使用" })).not.toBeNull();
    expect(within(libraryCard!).queryByRole("button", { name: "更新" })).toBeNull();
    fireEvent.click(within(libraryCard!).getByRole("button", { name: "查看 海洋主题" }));
    const dialog = await screen.findByRole("dialog", { name: "海洋主题" });
    expect(within(dialog).getByRole("button", { name: "使用" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "更新" })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "使用" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "activate" }));
  });

  it("keeps the market card focused on use when an installed theme has an update", async () => {
    renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "0.9.0", installedAt: null, updateAvailable: true }] }));
    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    const card = (await screen.findByText("海洋主题")).closest("article");
    expect(within(card!).getByRole("button", { name: "使用" })).not.toBeNull();
    expect(within(card!).queryByRole("button", { name: "更新" })).toBeNull();
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

  it("explains that lifecycle actions require an online DSH manager", async () => {
    const api = renderPage(snapshot({
      connected: false,
      marketInstalled: true,
      skins: [{ skinId: "ocean.theme", installation: "installed", activation: "active", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }]
    }));
    const toastWarning = vi.spyOn(toast, "warning");
    await screen.findByText("海洋主题");
    const deactivate = screen.getByRole("button", { name: "停用" });
    const uninstall = screen.getByRole("button", { name: "卸载" });
    expect(deactivate).toHaveProperty("disabled", false);
    expect(uninstall).toHaveProperty("disabled", false);
    expect(deactivate.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("启动 DSH 后可管理主题。").closest(".dsh-theme-status-rail")).not.toBeNull();
    expect(deactivate.getAttribute("aria-describedby")).toBe("dsh-theme-host-status");
    fireEvent.click(deactivate);
    fireEvent.click(deactivate);
    expect(toastWarning).toHaveBeenCalledTimes(2);
    expect(toastWarning.mock.calls.at(-1)).toEqual(["该操作需 DSH 在线。", {
      id: "dsh-theme-dsh-offline",
      className: "dsh-theme-warning-toast"
    }]);
    expect(api.mutateDshSkin).not.toHaveBeenCalled();
  });

  it("shows the offline toast from market details without sending a request", async () => {
    const api = renderPage(snapshot({
      connected: false,
      marketInstalled: true,
      skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }]
    }));
    const toastWarning = vi.spyOn(toast, "warning");
    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    const card = (await screen.findByText("海洋主题")).closest("article");
    fireEvent.click(within(card!).getByRole("button", { name: "详情" }));
    const dialog = await screen.findByRole("dialog", { name: "海洋主题" });
    fireEvent.click(within(dialog).getByRole("button", { name: "使用" }));
    expect(toastWarning.mock.calls.at(-1)).toEqual(["该操作需 DSH 在线。", {
      id: "dsh-theme-dsh-offline",
      className: "dsh-theme-warning-toast"
    }]);
    expect(api.mutateDshSkin).not.toHaveBeenCalled();
  });

  it("uses the cached local image for detail screenshots", async () => {
    const api = renderPage({
      ...snapshot({ connected: true, marketInstalled: true, skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }),
      skins: [{ ...themes[0], previewLocalUrls: ["dsh-theme-asset://previews/detail-1.png"] }]
    });
    await screen.findByText("海洋主题");
    fireEvent.click(screen.getByRole("button", { name: "查看 海洋主题" }));
    const image = within(await screen.findByRole("dialog", { name: "海洋主题" })).getByRole("img", { name: "海洋主题 界面预览" });
    expect(image.getAttribute("src")).toBe("dsh-theme-asset://previews/detail-1.png");
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

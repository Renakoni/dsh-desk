/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshSkinMarketplaceSnapshot } from "../src/shared/dshSkins";
import { DshThemesPage } from "../src/renderer/clawd-migrated/components/themes/DshThemesPage";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const themes: DshSkinMarketplaceSnapshot["skins"] = [{
  id: "ocean.theme",
  name: { zh: "海洋主题", en: "Ocean Theme" },
  author: "ocean-author",
  description: "Ocean interface",
  repositoryUrl: "https://github.com/demo/ocean",
  packageName: "ocean-theme",
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
  it("keeps the local library separate from the visual market", async () => {
    renderPage();
    await screen.findByText("还没有安装主题");
    expect(screen.queryByText("海洋主题")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "主题市场" }));
    await screen.findByText("主题市场");
    expect(screen.getAllByTestId("dsh-theme-card").map(card => card.querySelector("strong")?.textContent)).toEqual(["纸张主题", "海洋主题"]);

    fireEvent.click(screen.getByRole("button", { name: "最近更新" }));
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
    api.mutateDshSkin.mockResolvedValueOnce({ ok: false, supportPrepared: true, snapshot: snapshot({ connected: false, marketInstalled: true }) });
    const oceanCard = screen.getAllByTestId("dsh-theme-card").find(card => within(card).queryByText("海洋主题"));
    fireEvent.click(within(oceanCard!).getByRole("button", { name: "安装" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "install" }));
    expect(await screen.findByText("主题管理已准备好。重启 DSH 后继续操作。")).not.toBeNull();
    expect(api.installDshSkinMarketplace).not.toHaveBeenCalled();
  });

  it("shows installed themes in the library and keeps their controls there", async () => {
    const api = renderPage(snapshot({ skins: [{ skinId: "ocean.theme", installation: "installed", activation: "inactive", installedVersion: "1.0.0", installedAt: null, updateAvailable: false }] }));
    await screen.findByText("海洋主题");
    expect(screen.queryByText("纸张主题")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "使用" }));
    await waitFor(() => expect(api.mutateDshSkin).toHaveBeenCalledWith({ skinId: "ocean.theme", action: "activate" }));
  });
});

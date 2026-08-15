/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshResourceSchemesSnapshot } from "../src/shared/dshResources";
import { PluginsPage } from "../src/renderer/clawd-migrated/components/plugins/PluginsPage";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const plugins = Array.from({ length: 160 }, (_, index) => ({
  id: `plugin:entry-${index}`,
  kind: "plugin" as const,
  name: `@deepseek-ai/plugin-${index}`,
  description: "DSH Loader - active",
  detail: `entry-${index}`,
  enabled: true,
  manageable: index === 159
}));

const snapshot: DshResourceSchemesSnapshot = {
  schemaVersion: 1,
  schemes: [{
    id: "default",
    name: "Default",
    skills: ["skill:user-dsh:review"],
    plugins: plugins.map(plugin => plugin.id),
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  }, {
    id: "all",
    name: "All",
    skills: ["skill:user-dsh:review"],
    plugins: plugins.map(plugin => plugin.id),
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  }],
  appliedSchemeId: "default",
  inventory: {
    skills: [{ id: "skill:user-dsh:review", kind: "skill", name: "review", description: "Review repository changes", enabled: true, manageable: true }],
    plugins,
    runtimeConnected: true,
    scannedAt: 1
  },
  drift: { schemeId: "default", isDrifted: false, skills: false, plugins: false }
};

function api(resourceSnapshot = snapshot) {
  return {
    getDshResourceSchemes: vi.fn(async () => resourceSnapshot),
    saveDshResourceScheme: vi.fn(),
    deleteDshResourceScheme: vi.fn(),
    applyDshResourceScheme: vi.fn(async (schemeId: string) => ({ ok: true, schemeId, snapshot: { ...snapshot, appliedSchemeId: schemeId } })),
    setDshResourceState: vi.fn(async () => ({ ok: true, schemeId: "default", snapshot })),
    onDshResourcesUpdated: vi.fn(() => () => undefined),
    getDshPluginMarketplace: vi.fn(async () => ({ source: "remote", sourceName: "market", sourceUrl: "https://example.com", categories: [], plugins: [{ id: "demo", name: "DSH Demo", owner: "AcidGr", packageName: "dsh-demo", repositoryUrl: "https://github.com/demo/dsh-demo", category: "tools", description: { en: "Demo plugin", zh: "示例插件" }, installSpec: "github:demo/dsh-demo", stars: 1234, added: "2026-08-01" }] })),
    listDshPlugins: vi.fn(async () => ({ profiles: [], plugins: [], dshHome: "C:\\.dsh", npxAvailable: true, scannedAt: 1 })),
    installDshMarketplacePlugin: vi.fn(),
    getDshSkillMarketplace: vi.fn(async () => ({ repos: [{ owner: "ComposioHQ", name: "awesome-claude-skills", branch: "master", enabled: true }], skills: [{ key: "ComposioHQ/awesome-claude-skills:review", name: "market-review", description: "Review changes", directory: "review", repoOwner: "ComposioHQ", repoName: "awesome-claude-skills", repoBranch: "master", installed: false }], scannedAt: 1, errors: [] })),
    addDshSkillRepo: vi.fn(),
    removeDshSkillRepo: vi.fn(),
    installDshSkill: vi.fn(),
    openExternal: vi.fn()
  };
}

function renderPage(mockApi = api()) {
  Object.assign(window, { companion: mockApi });
  render(<I18nProvider initialLocale="zh"><PluginsPage active hideSensitiveContent={false} /></I18nProvider>);
  return mockApi;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DSH resource schemes page", () => {
  it("keeps the original scheme layout and exposes the full runtime inventory", async () => {
    renderPage();
    expect(await screen.findByText("@deepseek-ai/plugin-0")).not.toBeNull();
    expect(screen.getByText("方案")).not.toBeNull();
    expect(screen.queryByText("Web")).toBeNull();
    expect(screen.queryByText("Headless")).toBeNull();
    expect(screen.queryByText("来源")).toBeNull();
    expect(screen.queryByText("DSH 运行时")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("搜索 Plugins"), { target: { value: "plugin-159" } });
    expect(await screen.findByText("@deepseek-ai/plugin-159")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(await screen.findByText("review")).not.toBeNull();
  });

  it("changes a manageable scheme resource through the DSH scheme API", async () => {
    const mockApi = renderPage();
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    await screen.findByText("review");
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(mockApi.setDshResourceState).toHaveBeenCalledWith({ schemeId: "default", resourceId: "skill:user-dsh:review", enabled: false }));
  });

  it("uses one market entry and separates plugin and Skill markets inside it", async () => {
    const mockApi = renderPage();
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    expect(await screen.findByRole("button", { name: "插件市场" })).not.toBeNull();
    expect(await screen.findByText("1,234")).not.toBeNull();
    expect(screen.queryByText("AcidGr")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开仓库" }));
    expect(mockApi.openExternal).toHaveBeenLastCalledWith("https://github.com/demo/dsh-demo");

    fireEvent.click(screen.getByRole("button", { name: "Skill 市场" }));
    await waitFor(() => expect(mockApi.getDshSkillMarketplace).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("market-review")).not.toBeNull();
    expect(screen.queryByText("ComposioHQ/awesome-claude-skills · master")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开仓库" }));
    expect(mockApi.openExternal).toHaveBeenLastCalledWith("https://github.com/ComposioHQ/awesome-claude-skills");
  });

  it("explains the installed-only fallback without runtime jargon", async () => {
    const disconnected = { ...snapshot, inventory: { ...snapshot.inventory, runtimeConnected: false } };
    renderPage(api(disconnected));
    expect(await screen.findByText("完整插件列表暂不可用，当前仅显示已安装插件。")).not.toBeNull();
    expect(screen.queryByText(/DSH 运行时/)).toBeNull();
  });
});

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

function api() {
  return {
    getDshResourceSchemes: vi.fn(async () => snapshot),
    saveDshResourceScheme: vi.fn(),
    deleteDshResourceScheme: vi.fn(),
    applyDshResourceScheme: vi.fn(async (schemeId: string) => ({ ok: true, schemeId, snapshot: { ...snapshot, appliedSchemeId: schemeId } })),
    setDshResourceState: vi.fn(async () => ({ ok: true, schemeId: "default", snapshot })),
    onDshResourcesUpdated: vi.fn(() => () => undefined),
    getDshPluginMarketplace: vi.fn(async () => ({ source: "remote", sourceName: "market", sourceUrl: "https://example.com", categories: [], plugins: [] })),
    listDshPlugins: vi.fn(async () => ({ profiles: [], plugins: [], dshHome: "C:\\.dsh", npxAvailable: true, scannedAt: 1 })),
    installDshMarketplacePlugin: vi.fn(),
    getDshSkillMarketplace: vi.fn(async () => ({ repos: [], skills: [], scannedAt: 1, errors: [] })),
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
    expect(await screen.findByText("review")).not.toBeNull();
    expect(screen.getByText("方案")).not.toBeNull();
    expect(screen.queryByText("Web")).toBeNull();
    expect(screen.queryByText("Headless")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Plugins/ }));
    fireEvent.change(screen.getByPlaceholderText("搜索 Plugins"), { target: { value: "plugin-159" } });
    expect(await screen.findByText("@deepseek-ai/plugin-159")).not.toBeNull();
  });

  it("changes a manageable scheme resource through the DSH scheme API", async () => {
    const mockApi = renderPage();
    await screen.findByText("review");
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(mockApi.setDshResourceState).toHaveBeenCalledWith({ schemeId: "default", resourceId: "skill:user-dsh:review", enabled: false }));
  });

  it("uses one market entry and separates plugin and Skill markets inside it", async () => {
    const mockApi = renderPage();
    await screen.findByText("review");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    expect(await screen.findByRole("button", { name: "插件市场" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skill 市场" }));
    await waitFor(() => expect(mockApi.getDshSkillMarketplace).toHaveBeenCalledTimes(1));
  });
});

/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshResourceSchemesSnapshot } from "../src/shared/dshResources";
import { PluginsPage } from "../src/renderer/clawd-migrated/components/plugins/PluginsPage";
import { dshResourcePresentation } from "../src/renderer/clawd-migrated/components/plugins/dshSchemeResources";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const plugins = Array.from({ length: 160 }, (_, index) => ({
  id: `plugin:entry-${index}`,
  kind: "plugin" as const,
  name: `@deepseek-ai/plugin-${index}`,
  description: "DSH Loader - active",
  detail: `entry-${index}`,
  enabled: true,
  manageable: index === 159,
  required: index !== 159
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
    saveDshResourceScheme: vi.fn(async () => ({ ok: false as const, issues: [{ code: "test", message: "test" }] })),
    deleteDshResourceScheme: vi.fn(),
    applyDshResourceScheme: vi.fn(async (schemeId: string) => ({ ok: true, schemeId, snapshot: { ...snapshot, appliedSchemeId: schemeId } })),
    setDshResourceState: vi.fn(async () => ({ ok: true, schemeId: "default", snapshot })),
    onDshResourcesUpdated: vi.fn(() => () => undefined),
    getDshPluginMarketplace: vi.fn(async () => ({ source: "remote", sourceName: "market", sourceUrl: "https://example.com", categories: [], plugins: [{ id: "demo", name: "DSH Demo", owner: "AcidGr", packageName: "dsh-demo", repositoryUrl: "https://github.com/demo/dsh-demo", category: "tools", description: { en: "Demo plugin", zh: "示例插件" }, installSpec: "github:demo/dsh-demo", stars: 1234, added: "2026-08-01" }, { id: "zulu", name: "Zulu Plugin", owner: "Example", packageName: "zulu-plugin", repositoryUrl: "https://github.com/example/zulu-plugin", category: "tools", description: { en: "Zulu plugin", zh: "Zulu 插件" }, installSpec: "github:example/zulu-plugin", stars: 50, added: "2026-08-02" }] })),
    listDshPlugins: vi.fn(async () => ({ profiles: [], plugins: [], dshHome: "C:\\.dsh", npxAvailable: true, scannedAt: 1 })),
    installDshMarketplacePlugin: vi.fn(),
    getDshSkillMarketplace: vi.fn(async () => ({ repos: [{ owner: "ComposioHQ", name: "awesome-claude-skills", branch: "master", enabled: true }], skills: [{ key: "ComposioHQ/awesome-claude-skills:composio-skills/ably-automation", name: "ably-automation", description: "Automate Ably workflows with a complete description", directory: "composio-skills/ably-automation", readmeUrl: "https://github.com/ComposioHQ/awesome-claude-skills/blob/master/composio-skills/ably-automation/SKILL.md", repoOwner: "ComposioHQ", repoName: "awesome-claude-skills", repoBranch: "master", stars: 4321, installed: false }], scannedAt: 1, errors: [] })),
    addDshSkillRepo: vi.fn(),
    removeDshSkillRepo: vi.fn(),
    installDshSkill: vi.fn(),
    openExternal: vi.fn()
  };
}

function renderPage(mockApi = api(), initialLocale: "zh" | "en" = "zh") {
  Object.assign(window, { companion: mockApi });
  render(<I18nProvider initialLocale={initialLocale}><PluginsPage active hideSensitiveContent={false} /></I18nProvider>);
  return mockApi;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DSH resource schemes page", () => {
  it("omits descriptions and identifiers that repeat the resource name", () => {
    expect(dshResourcePresentation({ id: "plugin:demo", kind: "plugin", name: "demo", description: "demo", detail: "demo", enabled: true, manageable: true }, false, "Details hidden")).toEqual({});
    expect(dshResourcePresentation({ id: "plugin:desk", kind: "plugin", name: "dsh-desk-plugin", description: "DSH Desk bridge", detail: "dsh-desk-plugin", enabled: true, manageable: false }, false, "Details hidden")).toEqual({ description: "DSH Desk bridge" });
  });

  it("keeps the original scheme layout and exposes the full runtime inventory", async () => {
    renderPage();
    expect(await screen.findByText("@deepseek-ai/plugin-0")).not.toBeNull();
    expect(screen.getByText("方案")).not.toBeNull();
    expect(screen.queryByText("Web")).toBeNull();
    expect(screen.queryByText("Headless")).toBeNull();
    expect(screen.queryByText("来源")).toBeNull();
    expect(screen.queryByText("DSH 运行时")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "plugin-159" } });
    expect(await screen.findByText("@deepseek-ai/plugin-159")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(await screen.findByText("review")).not.toBeNull();
  });

  it("changes a manageable scheme resource through the DSH scheme API", async () => {
    const mockApi = renderPage();
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    await screen.findByText("review");
    fireEvent.click(screen.getByRole("button", { name: "禁用" }));
    await waitFor(() => expect(mockApi.setDshResourceState).toHaveBeenCalledWith({ schemeId: "default", resourceId: "skill:user-dsh:review", enabled: false }));
  });

  it("uses one market entry and separates plugin and Skill markets inside it", async () => {
    const mockApi = renderPage();
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    expect(await screen.findByRole("button", { name: "插件市场" })).not.toBeNull();
    expect(await screen.findByText("1,234")).not.toBeNull();
    expect(screen.queryByText("AcidGr")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "打开仓库" })[0]);
    expect(mockApi.openExternal).toHaveBeenLastCalledWith("https://github.com/demo/dsh-demo");

    fireEvent.click(screen.getByRole("button", { name: "Skill 市场" }));
    await waitFor(() => expect(mockApi.getDshSkillMarketplace).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("ably-automation")).not.toBeNull();
    expect(await screen.findByText("4,321")).not.toBeNull();
    expect(screen.queryByText("ComposioHQ/awesome-claude-skills · master")).toBeNull();
    expect(screen.getByText("Automate Ably workflows with a complete description").getAttribute("title")).toBe("Automate Ably workflows with a complete description");
    fireEvent.click(screen.getByRole("button", { name: "打开 Skill 文档" }));
    expect(mockApi.openExternal).toHaveBeenLastCalledWith("https://github.com/ComposioHQ/awesome-claude-skills/blob/master/composio-skills/ably-automation/SKILL.md");
  });

  it("lets a scheme remove a normal Skill but keeps required plugins selected", async () => {
    const mockApi = renderPage();
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByTitle("编辑"));
    const requiredPlugin = await screen.findByRole("button", { name: /@deepseek-ai\/plugin-0/ });
    expect((requiredPlugin as HTMLButtonElement).disabled).toBe(true);
    expect(requiredPlugin.textContent).toContain("必装");

    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    fireEvent.click(await screen.findByRole("button", { name: /review/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mockApi.saveDshResourceScheme).toHaveBeenCalledWith(expect.objectContaining({
      skills: [],
      plugins: expect.arrayContaining(["plugin:entry-0"])
    }));
  });

  it("keeps missing distinct from disabled and confirms before removing its scheme record", async () => {
    const missingId = "plugin:package:dsh-chara-desk";
    const missingSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => scheme.id === "default"
        ? { ...scheme, plugins: [...scheme.plugins, missingId] }
        : scheme)
    };
    const mockApi = renderPage(api(missingSnapshot));
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "dsh-chara-desk" } });
    expect(await screen.findByText("package:dsh-chara-desk")).not.toBeNull();
    expect(screen.getByText("缺失")).not.toBeNull();
    expect(screen.queryByText("已禁用")).toBeNull();

    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "dsh-chara-desk" } });
    fireEvent.click(await screen.findByRole("button", { name: /package:dsh-chara-desk/ }));
    const dialog = screen.getByRole("alertdialog", { name: "删除缺失记录？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: /package:dsh-chara-desk/ })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /package:dsh-chara-desk/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    expect(screen.queryByRole("button", { name: /package:dsh-chara-desk/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mockApi.saveDshResourceScheme).toHaveBeenLastCalledWith(expect.objectContaining({
      plugins: expect.not.arrayContaining([missingId])
    }));
  });

  it("does not add a disconnected-runtime warning above installed plugins", async () => {
    const disconnected = { ...snapshot, inventory: { ...snapshot.inventory, runtimeConnected: false } };
    renderPage(api(disconnected));
    expect(await screen.findByText("@deepseek-ai/plugin-0")).not.toBeNull();
    expect(screen.queryByText(/完整插件列表暂不可用/)).toBeNull();
  });

  it("renders natural English resource copy from the locale catalog", async () => {
    renderPage(api(), "en");
    expect(await screen.findByText("Default")).not.toBeNull();
    expect(screen.getByPlaceholderText("Search plugins")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    expect(await screen.findByRole("button", { name: "Plugin marketplace" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sort by Stars" })).not.toBeNull();
  });

  it("sorts market rows by repository Stars in both directions", async () => {
    renderPage();
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    await screen.findByText("DSH Demo");
    const stars = screen.getByRole("button", { name: "按 Stars 排序" });
    fireEvent.click(stars);
    expect(screen.getAllByRole("article")[0].textContent).toContain("DSH Demo");
    fireEvent.click(stars);
    expect(screen.getAllByRole("article")[0].textContent).toContain("Zulu Plugin");
  });

  it("shows repository errors instead of presenting a failed Skill market as empty", async () => {
    const mockApi = api();
    mockApi.getDshSkillMarketplace = vi.fn(async () => ({
      repos: [{ owner: "owner", name: "demo", branch: "main", enabled: true }],
      skills: [],
      scannedAt: 1,
      errors: ["owner/demo: The request timed out."]
    })) as unknown as typeof mockApi.getDshSkillMarketplace;
    renderPage(mockApi);
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    fireEvent.click(screen.getByRole("button", { name: "Skill 市场" }));
    expect(await screen.findByText(/市场内容暂时无法加载/)).not.toBeNull();
    expect(screen.queryByText("没有匹配项")).toBeNull();
  });
});

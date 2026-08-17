/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshResourceSchemeSaveInput, DshResourceSchemesSnapshot } from "../src/shared/dshResources";
import { PluginsPage } from "../src/renderer/clawd-migrated/components/plugins/PluginsPage";
import { dshResourcePresentation, logicalDshResources, visibleDshSchemeResourceIds } from "../src/renderer/clawd-migrated/components/plugins/dshSchemeResources";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const plugins = Array.from({ length: 160 }, (_, index) => ({
  id: `plugin:entry-${index}`,
  kind: "plugin" as const,
  name: `@deepseek-ai/plugin-${index}`,
  packageName: `@deepseek-ai/plugin-${index}`,
  description: "DSH Loader - active",
  detail: `entry-${index}`,
  enabled: true,
  manageable: index === 159,
  required: index !== 159
}));
const pluginAliases = plugins.map(plugin => `plugin:package:${plugin.packageName}`);

const snapshot: DshResourceSchemesSnapshot = {
  schemaVersion: 1,
  pluginRuntimePackages: Object.fromEntries(plugins.map(plugin => [plugin.id, plugin.packageName])),
  legacyRuntimePluginIds: [],
  schemes: [{
    id: "default",
    name: "Default",
    skills: ["skill:name:review"],
    plugins: pluginAliases,
    pluginComponentOverrides: [],
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  }, {
    id: "all",
    name: "All",
    skills: ["skill:name:review"],
    plugins: pluginAliases,
    pluginComponentOverrides: [],
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  }],
  appliedSchemeId: "default",
  inventory: {
    skills: [{ id: "skill:name:review", kind: "skill", name: "review", description: "Review repository changes", enabled: true, manageable: true, sourceIds: ["skill:user-dsh:review"] }],
    plugins,
    runtimeConnected: true,
    scannedAt: 1
  },
  drift: { schemeId: "default", isDrifted: false, skills: false, plugins: false }
};

function api(resourceSnapshot = snapshot) {
  return {
    getDshResourceSchemes: vi.fn(async () => resourceSnapshot),
    saveDshResourceScheme: vi.fn(async (_input: DshResourceSchemeSaveInput) => ({ ok: false as const, issues: [{ code: "test", message: "test" }] })),
    deleteDshResourceScheme: vi.fn(),
    applyDshResourceScheme: vi.fn(async (schemeId: string) => ({ ok: true, schemeId, snapshot: { ...snapshot, appliedSchemeId: schemeId } })),
    setDshResourceState: vi.fn(async () => ({ ok: true, schemeId: "default", snapshot })),
    setDshPluginComponentState: vi.fn(async () => ({ ok: true, schemeId: "default", snapshot })),
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
  it("groups runtime entries under one package identity without losing missing records", () => {
    const ids = ["plugin:package:demo", "plugin:package:removed"];
    const liveResources = logicalDshResources([
      { id: "plugin:runtime-web", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: true, manageable: true },
      { id: "plugin:runtime-headless", kind: "plugin" as const, name: "demo", packageName: "demo", enabled: false, manageable: true }
    ], "plugins");
    expect(liveResources).toEqual([
      expect.objectContaining({ id: "plugin:package:demo", enabled: false, manageable: true })
    ]);
    expect(visibleDshSchemeResourceIds(ids)).toEqual(ids);
  });

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
    await waitFor(() => expect(mockApi.setDshResourceState).toHaveBeenCalledWith({ schemeId: "default", resourceId: "skill:name:review", enabled: false }));
  });

  it("reveals bundle components inline and saves a scheme-level override", async () => {
    const packageId = "plugin:package:@deepseek-ai/dsh-base";
    const componentSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [packageId] })),
      inventory: {
        ...snapshot.inventory,
        plugins: [{
          id: packageId,
          kind: "plugin",
          name: "@deepseek-ai/dsh-base",
          packageName: "@deepseek-ai/dsh-base",
          enabled: true,
          manageable: false,
          required: true,
          components: [{
            key: "include:timer",
            name: "timer",
            moduleName: "@deepseek-ai/cordis-plugin-timer",
            baselineEnabled: true,
            enabled: true,
            manageable: true,
            fiberPhase: "active"
          }]
        }]
      }
    };
    const mockApi = renderPage(api(componentSnapshot));
    await screen.findByText("@deepseek-ai/dsh-base");
    fireEvent.click(screen.getByRole("button", { name: "查看 1 个运行组件" }));
    expect(await screen.findByText("timer")).not.toBeNull();
    expect(screen.getByText("@deepseek-ai/cordis-plugin-timer")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "禁用 timer" }));
    await waitFor(() => expect(mockApi.setDshPluginComponentState).toHaveBeenCalledWith({
      schemeId: "default",
      packageName: "@deepseek-ai/dsh-base",
      componentKey: "include:timer",
      state: "disabled"
    }));
  });

  it("shows one component override consistently under different runtime bundle owners", async () => {
    const packageNames = ["@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-headless"];
    const component = {
      key: "include:code-runtime",
      name: "code-runtime",
      moduleName: "@deepseek-ai/dsh-code-runtime-worker-thread",
      baselineEnabled: true,
      enabled: false,
      manageable: true,
      fiberPhase: null
    } as const;
    const componentSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({
        ...scheme,
        plugins: packageNames.map(packageName => `plugin:package:${packageName}`),
        pluginComponentOverrides: scheme.id === "default" ? [{
          packageName: "@deepseek-ai/dsh-web-app",
          componentKey: component.key,
          state: "disabled"
        }] : []
      })),
      inventory: {
        ...snapshot.inventory,
        plugins: packageNames.map(packageName => ({
          id: `plugin:package:${packageName}`,
          kind: "plugin" as const,
          name: packageName,
          packageName,
          enabled: true,
          manageable: false,
          required: true,
          components: [component]
        }))
      }
    };

    renderPage(api(componentSnapshot));
    await screen.findByText("@deepseek-ai/dsh-web-app");
    for (const disclosure of screen.getAllByRole("button", { name: "查看 1 个运行组件" })) fireEvent.click(disclosure);
    expect(screen.getAllByRole("button", { name: "禁用 code-runtime" })).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: "禁用 code-runtime" })) {
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }
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
      plugins: expect.arrayContaining(["plugin:package:@deepseek-ai/plugin-0"])
    }));
  });

  it("keeps a live resource that cannot be selected locked inside the scheme", async () => {
    const fixedPlugin = { id: "plugin:fixed", kind: "plugin" as const, name: "fixed-plugin", enabled: true, manageable: false, schemeSelectable: false };
    const fixedSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      inventory: { ...snapshot.inventory, plugins: [...snapshot.inventory.plugins, fixedPlugin] }
    };
    const mockApi = renderPage(api(fixedSnapshot));
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "fixed-plugin" } });
    const fixed = await screen.findByRole("button", { name: /fixed-plugin/ });
    expect((fixed as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mockApi.saveDshResourceScheme).toHaveBeenCalledWith(expect.objectContaining({
      plugins: expect.arrayContaining(["plugin:package:fixed-plugin"])
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

  it("shows an installed package once and preserves other package selections while editing", async () => {
    const aliasId = "plugin:package:@deepseek-ai/plugin-0";
    const aliasSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [aliasId, ...scheme.plugins] }))
    };
    const mockApi = renderPage(api(aliasSnapshot));
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "package:@deepseek-ai/plugin-0" } });
    expect(screen.queryByText("package:@deepseek-ai/plugin-0")).toBeNull();

    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "plugin-159" } });
    fireEvent.click(await screen.findByRole("button", { name: /@deepseek-ai\/plugin-159/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mockApi.saveDshResourceScheme).toHaveBeenCalledWith(expect.objectContaining({
      plugins: expect.arrayContaining([aliasId])
    }));
  });

  it("removes a mapped package selection as one unit", async () => {
    const runtimeId = "plugin:entry-159";
    const aliasId = "plugin:package:@deepseek-ai/plugin-159";
    const mappedSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [aliasId, ...scheme.plugins] }))
    };
    const mockApi = renderPage(api(mappedSnapshot));
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "plugin-159" } });
    fireEvent.click(await screen.findByRole("button", { name: /@deepseek-ai\/plugin-159/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = mockApi.saveDshResourceScheme.mock.calls[0][0];
    expect(saved.plugins).not.toContain(aliasId);
    expect(saved.plugins).not.toContain(runtimeId);
  });

  it("restores package selection when removal is undone", async () => {
    const runtimeId = "plugin:entry-159";
    const aliasId = "plugin:package:@deepseek-ai/plugin-159";
    const mappedSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [aliasId, ...scheme.plugins] }))
    };
    const mockApi = renderPage(api(mappedSnapshot));
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.change(screen.getByPlaceholderText("搜索插件"), { target: { value: "plugin-159" } });
    fireEvent.click(await screen.findByRole("button", { name: /@deepseek-ai\/plugin-159/ }));
    const removed = await screen.findByRole("button", { name: /@deepseek-ai\/plugin-159/ });
    expect(removed.closest("[data-transfer-side]")?.getAttribute("data-transfer-side")).toBe("unselected");
    fireEvent.click(removed);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = mockApi.saveDshResourceScheme.mock.calls[0][0];
    expect(saved.plugins).toContain(aliasId);
    expect(saved.plugins).not.toContain(runtimeId);
  });

  it("renders same-package runtime entries as one removable package", async () => {
    const aliasId = "plugin:package:demo-package";
    const mappedPlugins = [
      { id: "plugin:runtime-a", kind: "plugin" as const, name: "demo-a", packageName: "demo-package", enabled: true, manageable: true },
      { id: "plugin:runtime-b", kind: "plugin" as const, name: "demo-b", packageName: "demo-package", enabled: true, manageable: true }
    ];
    const mappedSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      pluginRuntimePackages: Object.fromEntries(mappedPlugins.map(plugin => [plugin.id, plugin.packageName])),
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [aliasId] })),
      inventory: { ...snapshot.inventory, plugins: mappedPlugins }
    };
    const mockApi = renderPage(api(mappedSnapshot));
    await screen.findByText("demo-a");
    expect(screen.queryByText("demo-b")).toBeNull();
    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.click(await screen.findByRole("button", { name: /demo-a/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = mockApi.saveDshResourceScheme.mock.calls[0][0];
    expect(saved.plugins).not.toContain(aliasId);
    expect(saved.plugins).not.toContain("plugin:runtime-a");
    expect(saved.plugins).not.toContain("plugin:runtime-b");
  });

  it("uses the package alias for a live state change", async () => {
    const aliasId = "plugin:package:demo-package";
    const mappedPlugins = [
      { id: "plugin:runtime-a", kind: "plugin" as const, name: "demo-a", packageName: "demo-package", enabled: false, manageable: true },
      { id: "plugin:runtime-b", kind: "plugin" as const, name: "demo-b", packageName: "demo-package", enabled: true, manageable: true }
    ];
    const mappedSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      pluginRuntimePackages: Object.fromEntries(mappedPlugins.map(plugin => [plugin.id, plugin.packageName])),
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [aliasId] })),
      inventory: { ...snapshot.inventory, plugins: mappedPlugins }
    };
    const mockApi = renderPage(api(mappedSnapshot));
    await screen.findByText("demo-a");
    fireEvent.click(screen.getByRole("button", { name: "启用" }));
    await waitFor(() => expect(mockApi.setDshResourceState).toHaveBeenCalledWith({
      schemeId: "default",
      resourceId: aliasId,
      enabled: true
    }));
  });

  it("keeps an unresolved Headless-only alias visible and removable while only Web is online", async () => {
    const aliasId = "plugin:package:headless-only";
    const webPlugin = { id: "plugin:web", kind: "plugin" as const, name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: true };
    const webAlias = "plugin:package:web-plugin";
    const partialSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({ ...scheme, plugins: [aliasId, webAlias] })),
      inventory: { ...snapshot.inventory, plugins: [webPlugin] }
    };
    const mockApi = renderPage(api(partialSnapshot));
    const alias = await screen.findByText("package:headless-only");
    const row = alias.closest("article");
    expect(row?.textContent).not.toContain("缺失");
    expect(row?.textContent).not.toContain("本机上已不存在");
    expect(row?.textContent).not.toContain("待处理");
    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.click(await screen.findByRole("button", { name: /package:headless-only/ }));
    expect(screen.queryByRole("alertdialog", { name: "删除缺失记录？" })).toBeNull();
    const unselectedAlias = await screen.findByRole("button", { name: /package:headless-only/ });
    expect(unselectedAlias.closest("[data-transfer-side]")?.getAttribute("data-transfer-side")).toBe("unselected");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = mockApi.saveDshResourceScheme.mock.calls[0][0];
    expect(saved.plugins).not.toContain(aliasId);
  });

  it("can add an installed alias whose Headless runtime is not online", async () => {
    const aliasId = "plugin:package:headless-only";
    const webPlugin = { id: "plugin:web", kind: "plugin" as const, name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: true };
    const webAlias = "plugin:package:web-plugin";
    const partialSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      schemes: snapshot.schemes.map(scheme => ({
        ...scheme,
        plugins: scheme.id === "all" ? [aliasId, webAlias] : [webAlias]
      })),
      inventory: { ...snapshot.inventory, plugins: [webPlugin] }
    };
    const mockApi = renderPage(api(partialSnapshot));
    await screen.findByText("web-plugin");
    fireEvent.click(screen.getByTitle("编辑"));
    const alias = await screen.findByRole("button", { name: /package:headless-only/ });
    expect(alias.closest("[data-transfer-side]")?.getAttribute("data-transfer-side")).toBe("unselected");
    fireEvent.click(alias);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = mockApi.saveDshResourceScheme.mock.calls[0][0];
    expect(saved.plugins).toContain(aliasId);
  });

  it("does not render a historical runtime ID beside its package", async () => {
    const runtimeId = "plugin:headless-entry";
    const aliasId = "plugin:package:headless-plugin";
    const webPlugin = { id: "plugin:web", kind: "plugin" as const, name: "web-plugin", packageName: "web-plugin", enabled: true, manageable: true };
    const webAlias = "plugin:package:web-plugin";
    const partialSnapshot: DshResourceSchemesSnapshot = {
      ...snapshot,
      pluginRuntimePackages: { [runtimeId]: "headless-plugin" },
      schemes: snapshot.schemes.map(scheme => ({
        ...scheme,
        plugins: [aliasId, webAlias]
      })),
      inventory: { ...snapshot.inventory, plugins: [webPlugin] }
    };
    const mockApi = renderPage(api(partialSnapshot));
    const alias = await screen.findByText("package:headless-plugin");
    const row = alias.closest("article");
    expect(screen.queryByText("headless-entry")).toBeNull();
    expect(row?.textContent).not.toContain("缺失");
    expect(row?.textContent).not.toContain("本机上已不存在");
    expect(row?.textContent).not.toContain("待处理");

    fireEvent.click(screen.getByTitle("编辑"));
    fireEvent.click(await screen.findByRole("button", { name: /package:headless-plugin/ }));
    expect(screen.queryByRole("alertdialog", { name: "删除缺失记录？" })).toBeNull();
    const unselectedAlias = await screen.findByRole("button", { name: /package:headless-plugin/ });
    expect(unselectedAlias.closest("[data-transfer-side]")?.getAttribute("data-transfer-side")).toBe("unselected");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = mockApi.saveDshResourceScheme.mock.calls[0][0];
    expect(saved.plugins).not.toContain(aliasId);
    expect(saved.plugins).not.toContain(runtimeId);
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

  it("keeps the install action available when a plugin is missing from one profile", async () => {
    const mockApi = api();
    mockApi.listDshPlugins = vi.fn(async () => ({
      profiles: [
        { name: "web", label: "Web", exists: true },
        { name: "headless", label: "Headless", exists: true }
      ],
      plugins: [{
        packageName: "dsh-demo",
        name: "DSH Demo",
        kind: "plugin" as const,
        protected: false,
        states: [
          { profile: "web", enabled: true, materialized: true, bundleCapable: true },
          { profile: "headless", enabled: false, materialized: false, bundleCapable: null }
        ]
      }],
      dshHome: "C:\\.dsh",
      npxAvailable: true,
      scannedAt: 1
    })) as unknown as typeof mockApi.listDshPlugins;
    mockApi.installDshMarketplacePlugin = vi.fn(async () => ({
      ok: true,
      changedProfiles: ["web", "headless"],
      restartRequired: true,
      snapshot: await mockApi.listDshPlugins()
    })) as unknown as typeof mockApi.installDshMarketplacePlugin;
    renderPage(mockApi);
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    const demoRow = (await screen.findByText("DSH Demo")).closest("article");
    expect(demoRow).not.toBeNull();
    const install = within(demoRow as HTMLElement).getByRole("button", { name: "安装" });
    expect((install as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(install);
    await waitFor(() => expect(mockApi.installDshMarketplacePlugin).toHaveBeenCalledWith({
      installSpec: "github:demo/dsh-demo",
      profiles: ["web", "headless"]
    }));
  });

  it("keeps the backend snapshot and reports profiles changed before an install failure", async () => {
    const mockApi = api();
    const profiles = [
      { name: "web", label: "Web", exists: true },
      { name: "headless", label: "Headless", exists: true }
    ];
    mockApi.listDshPlugins = vi.fn(async () => ({ profiles, plugins: [], dshHome: "C:\\.dsh", npxAvailable: true, scannedAt: 1 })) as unknown as typeof mockApi.listDshPlugins;
    mockApi.installDshMarketplacePlugin = vi.fn(async () => ({
      ok: false,
      changedProfiles: ["web"],
      restartRequired: true,
      error: "Headless installation failed.",
      snapshot: {
        profiles,
        plugins: [{
          packageName: "dsh-demo",
          name: "DSH Demo",
          kind: "plugin" as const,
          protected: false,
          states: [
            { profile: "web", enabled: true, materialized: true, bundleCapable: true },
            { profile: "headless", enabled: false, materialized: false, bundleCapable: null }
          ]
        }],
        dshHome: "C:\\.dsh",
        npxAvailable: true,
        scannedAt: 2
      }
    })) as unknown as typeof mockApi.installDshMarketplacePlugin;
    renderPage(mockApi);
    await screen.findByText("@deepseek-ai/plugin-0");
    fireEvent.click(screen.getByRole("button", { name: "资源市场" }));
    const demoRow = (await screen.findByText("DSH Demo")).closest("article");
    fireEvent.click(within(demoRow as HTMLElement).getByRole("button", { name: "安装" }));
    expect(await screen.findByText(/已安装到 web，但其他配置安装失败/)).not.toBeNull();
    expect(screen.getByText(/已完成的配置需重启 DSH 后生效/)).not.toBeNull();
    await waitFor(() => expect(mockApi.getDshResourceSchemes).toHaveBeenCalledTimes(2));
    expect(within(demoRow as HTMLElement).getByRole("button", { name: "安装" })).not.toBeNull();
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

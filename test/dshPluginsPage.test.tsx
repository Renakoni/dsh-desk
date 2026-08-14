/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshMarketplaceSnapshot, DshPluginInstallInput, DshPluginSnapshot, DshPluginStateInput, DshSkillSnapshot } from "../src/shared/dshPlugins";
import { PluginsPage } from "../src/renderer/clawd-migrated/components/plugins/PluginsPage";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const pluginSnapshot: DshPluginSnapshot = {
  profiles: [
    { name: "web", label: "Web", exists: true },
    { name: "headless", label: "Headless", exists: true }
  ],
  plugins: [{
    packageName: "@deepseek-ai/dsh-base",
    name: "DSH Base",
    kind: "builtin",
    protected: true,
    states: [
      { profile: "web", enabled: true, materialized: true, bundleCapable: true },
      { profile: "headless", enabled: true, materialized: true, bundleCapable: true }
    ]
  }, {
    packageName: "demo-plugin",
    name: "Demo",
    description: "Demo extension",
    version: "1.0.0",
    kind: "plugin",
    protected: false,
    states: [
      { profile: "web", dependencySpec: "1.0.0", enabled: true, materialized: true, bundleCapable: true },
      { profile: "headless", dependencySpec: "1.0.0", enabled: false, materialized: true, bundleCapable: true }
    ]
  }, {
    packageName: "broken-plugin",
    name: "Broken",
    kind: "broken",
    protected: false,
    states: [
      { profile: "web", enabled: true, materialized: false, bundleCapable: null },
      { profile: "headless", enabled: false, materialized: false, bundleCapable: null }
    ]
  }],
  dshHome: "C:\\Users\\demo\\.dsh",
  npxAvailable: true,
  scannedAt: Date.now()
};

const marketplace: DshMarketplaceSnapshot = {
  source: "remote",
  sourceName: "awesome-dsh-plugin",
  sourceUrl: "https://awesome-dsh-plugin.com/plugins.json",
  updatedAt: "2026-08-14",
  fetchedAt: Date.now(),
  categories: [
    { id: "tool", en: "Tools", zh: "工具" },
    { id: "ui", en: "Interface", zh: "界面" }
  ],
  plugins: [{
    id: "demo/market-tool",
    name: "market-tool",
    owner: "demo",
    packageName: "market-tool",
    repositoryUrl: "https://github.com/demo/market-tool",
    category: "tool",
    description: { en: "Useful tool", zh: "实用工具" },
    installSpec: "github:demo/market-tool",
    stars: 42,
    added: "2026-08-14"
  }, {
    id: "demo/theme",
    name: "theme-plugin",
    owner: "demo",
    packageName: "theme-plugin",
    repositoryUrl: "https://github.com/demo/theme",
    category: "ui",
    description: { en: "Theme", zh: "主题插件" },
    installSpec: "github:demo/theme",
    stars: 12,
    added: "2026-08-13"
  }]
};

const skills: DshSkillSnapshot = {
  roots: [
    { source: "user-dsh", path: "C:\\Users\\demo\\.dsh\\skills" },
    { source: "user-agents", path: "C:\\Users\\demo\\.agents\\skills" }
  ],
  skills: [{
    id: "user-dsh:review",
    name: "review",
    description: "Review repository changes",
    path: "C:\\Users\\demo\\.dsh\\skills\\review\\SKILL.md",
    directory: "C:\\Users\\demo\\.dsh\\skills\\review",
    source: "user-dsh",
    active: true,
    modelInvocable: false,
    userInvocable: true
  }],
  scannedAt: Date.now()
};

function api() {
  const setDshPluginEnabled = vi.fn(async ({ packageName, profile, enabled }: DshPluginStateInput) => ({
    ok: true,
    snapshot: {
      ...pluginSnapshot,
      plugins: pluginSnapshot.plugins.map(plugin => plugin.packageName !== packageName ? plugin : {
        ...plugin,
        states: plugin.states.map(state => state.profile === profile ? { ...state, enabled } : state)
      })
    },
    changedProfiles: [profile],
    restartRequired: true
  }));
  const installDshMarketplacePlugin = vi.fn(async (input: DshPluginInstallInput) => ({
    ok: true,
    snapshot: pluginSnapshot,
    changedProfiles: input.profiles,
    restartRequired: true
  }));
  const revealDshSkill = vi.fn(async () => true);
  return {
    listDshPlugins: vi.fn(async () => pluginSnapshot),
    listDshSkills: vi.fn(async () => skills),
    getDshPluginMarketplace: vi.fn(async () => marketplace),
    setDshPluginEnabled,
    installDshMarketplacePlugin,
    removeDshPluginPackage: vi.fn(),
    revealDshSkill,
    openExternal: vi.fn()
  };
}

function renderPage(mockApi = api(), hideSensitiveContent = false) {
  Object.assign(window, { companion: mockApi });
  render(<I18nProvider initialLocale="zh"><PluginsPage active hideSensitiveContent={hideSensitiveContent} /></I18nProvider>);
  return mockApi;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DSH plugin resources page", () => {
  it("locks core bundles and toggles third-party profile state", async () => {
    const mockApi = renderPage();
    const demo = await screen.findByText("Demo");
    const demoRow = demo.closest("article")!;
    const coreRow = screen.getByText("DSH Base").closest("article")!;
    expect((within(coreRow).getByRole("button", { name: "禁用 DSH Base Web" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(demoRow).getByRole("button", { name: "启用 Demo Headless" }));
    await waitFor(() => expect(mockApi.setDshPluginEnabled).toHaveBeenCalledWith({ packageName: "demo-plugin", profile: "headless", enabled: true }));
    expect(await screen.findByText("重启 headless profile 后生效")).not.toBeNull();

    const brokenRow = screen.getByText("Broken").closest("article")!;
    fireEvent.click(within(brokenRow).getByRole("button", { name: "禁用 Broken Web" }));
    await waitFor(() => expect(mockApi.setDshPluginEnabled).toHaveBeenCalledWith({ packageName: "broken-plugin", profile: "web", enabled: false }));
  });

  it("filters the marketplace and installs into the selected profiles", async () => {
    const mockApi = renderPage();
    await screen.findByText("Demo");
    fireEvent.click(screen.getByRole("button", { name: /插件市场/ }));
    expect(await screen.findByText("market-tool")).not.toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "插件分类" }), { target: { value: "ui" } });
    expect(await screen.findByText("theme-plugin")).not.toBeNull();
    expect(screen.queryByText("market-tool")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "插件分类" }), { target: { value: "all" } });
    fireEvent.click(screen.getByLabelText("Headless"));
    fireEvent.click(within(screen.getByText("market-tool").closest("article")!).getByRole("button", { name: "安装" }));

    await waitFor(() => expect(mockApi.installDshMarketplacePlugin).toHaveBeenCalledWith({
      installSpec: "github:demo/market-tool",
      profiles: ["web", "headless"]
    }));
  });

  it("shows DSH Skills independently and hides paths in privacy mode", async () => {
    const mockApi = renderPage(api(), true);
    await screen.findByText("Demo");
    fireEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(await screen.findByText("/review")).not.toBeNull();
    expect(screen.queryByText(skills.skills[0].path)).toBeNull();
    expect(screen.getByText("模型").className).toContain("disabled");
    fireEvent.click(screen.getByRole("button", { name: "打开 review 所在目录" }));
    expect(mockApi.revealDshSkill).toHaveBeenCalledWith(skills.skills[0].directory);
  });

  it("serializes marketplace installs for a profile", async () => {
    const mockApi = api();
    let finishInstall: (() => void) | undefined;
    mockApi.installDshMarketplacePlugin.mockImplementation(async input => {
      await new Promise<void>(resolve => { finishInstall = resolve; });
      return { ok: true, snapshot: pluginSnapshot, changedProfiles: input.profiles, restartRequired: true };
    });
    renderPage(mockApi);
    await screen.findByText("Demo");
    fireEvent.click(screen.getByRole("button", { name: /插件市场/ }));
    const firstRow = (await screen.findByText("market-tool")).closest("article")!;
    const secondRow = screen.getByText("theme-plugin").closest("article")!;
    fireEvent.click(within(firstRow).getByRole("button", { name: "安装" }));

    await waitFor(() => expect((within(secondRow).getByRole("button", { name: "安装" }) as HTMLButtonElement).disabled).toBe(true));
    finishInstall?.();
    await waitFor(() => expect(mockApi.installDshMarketplacePlugin).toHaveBeenCalledTimes(1));
  });

  it("renders a useful empty state", async () => {
    const mockApi = api();
    mockApi.listDshPlugins.mockResolvedValue({ ...pluginSnapshot, plugins: [] });
    renderPage(mockApi);
    expect(await screen.findByText("尚未发现插件")).not.toBeNull();
  });
});

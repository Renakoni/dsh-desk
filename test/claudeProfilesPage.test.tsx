// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsPage } from "../src/renderer/clawd-migrated/components/plugins/PluginsPage";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";
import { defaultSettings } from "../src/renderer/shared/events";
import {
  CLAUDE_PROFILE_SCHEMA_VERSION,
  type ClaudeProfile,
  type ClaudeProfileResourceStateInput,
  type ClaudeProfileSaveInput,
  type ClaudeProfilesSnapshot
} from "../src/shared/claudeProfiles";

let currentSnapshot: ClaudeProfilesSnapshot;
const saveClaudeProfile = vi.fn<(input: ClaudeProfileSaveInput) => Promise<unknown>>();
const previewClaudeProfile = vi.fn();
const applyClaudeProfile = vi.fn<(profileId: string) => Promise<unknown>>();
const deleteClaudeProfile = vi.fn<(profileId: string) => Promise<unknown>>();
const setClaudeProfileResourceState = vi.fn<(input: ClaudeProfileResourceStateInput) => Promise<unknown>>();
const getClaudeProfiles = vi.fn(async (_force?: boolean) => currentSnapshot);

function makeSnapshot(mcpStatus: ClaudeProfilesSnapshot["mcpStatus"] = "ready"): ClaudeProfilesSnapshot {
  const skills = Array.from({ length: 2000 }, (_, index) => ({
    id: `skill:skill-${index}`,
    kind: "skill" as const,
    name: `skill-${index}`,
    description: `Skill ${index}`,
    enabled: index < 10
  }));
  const defaultProfile: ClaudeProfile = {
    id: "default",
    name: "Default",
    skills: skills.map(skill => skill.id),
    plugins: ["plugin:review@market"],
    mcpServers: ["mcp:filesystem"],
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  };
  const focusedProfile: ClaudeProfile = {
    id: "focused",
    name: "Focused",
    description: "Frontend work",
    skills: ["skill:skill-100"],
    plugins: [],
    mcpServers: [],
    isProtected: false,
    createdAt: 2,
    updatedAt: 2
  };
  const allProfile: ClaudeProfile = {
    id: "all",
    name: "All",
    skills: skills.map(skill => skill.id),
    plugins: ["plugin:review@market"],
    mcpServers: ["mcp:filesystem"],
    isProtected: true,
    createdAt: 1,
    updatedAt: 1
  };
  return {
    schemaVersion: CLAUDE_PROFILE_SCHEMA_VERSION,
    profiles: [defaultProfile, allProfile, focusedProfile],
    appliedProfileId: "default",
    inventory: {
      skills,
      plugins: [{ id: "plugin:review@market", kind: "plugin", name: "review@market", enabled: true }],
      mcpServers: [{ id: "mcp:filesystem", kind: "mcp", name: "filesystem", enabled: true }],
      scannedAt: 123
    },
    drift: { profileId: "default", isDrifted: false, skills: false, plugins: false, mcpServers: false },
    mcpStatus
  };
}

function installCompanionMock() {
  saveClaudeProfile.mockImplementation(async input => {
    const existing = currentSnapshot.profiles.find(profile => profile.id === input.id);
    const profile: ClaudeProfile = {
      id: existing?.id ?? "created",
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      skills: [...input.skills],
      plugins: [...input.plugins],
      mcpServers: [...input.mcpServers],
      isProtected: existing?.isProtected ?? false,
      createdAt: existing?.createdAt ?? 3,
      updatedAt: 4
    };
    currentSnapshot = {
      ...currentSnapshot,
      profiles: existing
        ? currentSnapshot.profiles.map(item => item.id === profile.id ? profile : item)
        : [...currentSnapshot.profiles, profile],
      drift: profile.id === currentSnapshot.appliedProfileId
        ? { profileId: profile.id, isDrifted: true, skills: true, plugins: false, mcpServers: false }
        : currentSnapshot.drift
    };
    return { ok: true, profileId: profile.id, snapshot: currentSnapshot };
  });
  applyClaudeProfile.mockImplementation(async profileId => {
    const profile = currentSnapshot.profiles.find(item => item.id === profileId)!;
    currentSnapshot = {
      ...currentSnapshot,
      appliedProfileId: profileId,
      inventory: {
        ...currentSnapshot.inventory,
        skills: currentSnapshot.inventory.skills.map(item => ({ ...item, enabled: profile.skills.includes(item.id) })),
        plugins: currentSnapshot.inventory.plugins.map(item => ({ ...item, enabled: profile.plugins.includes(item.id) })),
        mcpServers: currentSnapshot.inventory.mcpServers.map(item => ({ ...item, enabled: profile.mcpServers.includes(item.id) }))
      },
      drift: { profileId, isDrifted: false, skills: false, plugins: false, mcpServers: false }
    };
    return { ok: true, profileId, snapshot: currentSnapshot };
  });
  deleteClaudeProfile.mockImplementation(async profileId => {
    if (profileId === currentSnapshot.appliedProfileId) return { ok: false, issues: [] };
    currentSnapshot = {
      ...currentSnapshot,
      profiles: currentSnapshot.profiles.filter(profile => profile.id !== profileId)
    };
    return { ok: true, profileId, snapshot: currentSnapshot };
  });
  setClaudeProfileResourceState.mockImplementation(async input => {
    const update = (items: typeof currentSnapshot.inventory.skills) => items.map(item => item.id === input.resourceId
      ? { ...item, enabled: input.enabled }
      : item);
    currentSnapshot = {
      ...currentSnapshot,
      inventory: {
        ...currentSnapshot.inventory,
        skills: update(currentSnapshot.inventory.skills),
        plugins: update(currentSnapshot.inventory.plugins),
        mcpServers: update(currentSnapshot.inventory.mcpServers)
      },
      drift: { profileId: input.profileId, isDrifted: true, skills: true, plugins: false, mcpServers: false }
    };
    return { ok: true, profileId: input.profileId, snapshot: currentSnapshot };
  });
  Reflect.set(window, "companion", {
    getClaudeProfiles,
    saveClaudeProfile,
    deleteClaudeProfile,
    previewClaudeProfile,
    applyClaudeProfile,
    setClaudeProfileResourceState
  });
}

function renderPage(settings = defaultSettings, locale: "en" | "zh" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <PluginsPage hideSensitiveContent={settings.hideSensitiveContent} />
    </I18nProvider>
  );
}

beforeEach(() => {
  currentSnapshot = makeSnapshot();
  vi.clearAllMocks();
  installCompanionMock();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

describe("Unified Claude Profiles page", () => {
  it("forces a live scan on entry and schedules a ten-minute status refresh", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    renderPage();

    await screen.findByRole("button", { name: "Profile: Default" });
    expect(getClaudeProfiles).toHaveBeenCalledWith(true);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
    intervalSpy.mockRestore();
  });

  it("uses the cache while prewarming, then refreshes live when opened", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const view = render(
      <I18nProvider initialLocale="en">
        <PluginsPage active={false} hideSensitiveContent={defaultSettings.hideSensitiveContent} />
      </I18nProvider>
    );

    await screen.findByRole("button", { name: "Profile: Default" });
    expect(getClaudeProfiles).toHaveBeenCalledWith(false);
    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);

    view.rerender(
      <I18nProvider initialLocale="en">
        <PluginsPage active hideSensitiveContent={defaultSettings.hideSensitiveContent} />
      </I18nProvider>
    );
    await waitFor(() => expect(getClaudeProfiles).toHaveBeenLastCalledWith(true));
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
    intervalSpy.mockRestore();
  });

  it("refreshes a retained page when it becomes active again", async () => {
    const view = render(
      <I18nProvider initialLocale="en">
        <PluginsPage active hideSensitiveContent={defaultSettings.hideSensitiveContent} />
      </I18nProvider>
    );
    await screen.findByRole("button", { name: "Profile: Default" });
    const callsAfterMount = getClaudeProfiles.mock.calls.length;

    view.rerender(
      <I18nProvider initialLocale="en">
        <PluginsPage active={false} hideSensitiveContent={defaultSettings.hideSensitiveContent} />
      </I18nProvider>
    );
    view.rerender(
      <I18nProvider initialLocale="en">
        <PluginsPage active hideSensitiveContent={defaultSettings.hideSensitiveContent} />
      </I18nProvider>
    );

    expect(screen.getByRole("button", { name: "Profile: Default" })).toBeTruthy();
    await waitFor(() => expect(getClaudeProfiles.mock.calls.length).toBeGreaterThan(callsAfterMount));
    expect(getClaudeProfiles).toHaveBeenLastCalledWith(true);
  });

  it("keeps the resource page compact and moves resources between two virtualized editor columns", async () => {
    const view = renderPage();

    expect(await screen.findByRole("button", { name: "Profile: Default" })).toBeTruthy();
    expect(view.container.querySelector(".claude-profile-picker select")).toBeNull();
    expect(screen.queryByText("Currently applied")).toBeNull();
    expect(screen.queryByText("Only new Claude Code sessions read an applied profile. Running sessions stay unchanged.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(view.container.querySelector(".claude-profile-toolbar")).toBeTruthy();
    expect(view.container.querySelector(".claude-resource-list-toolbar .claude-resource-search-refresh")).toBeTruthy();
    expect(view.container.querySelector(".claude-resource-list-toolbar > span")).toBeNull();
    expect(view.container.querySelector(".claude-resource-subtab")?.textContent).toBe("Skills2000");
    expect(view.container.textContent).not.toMatch(/\d+\/\d+/);
    expect(view.container.querySelectorAll(".claude-profile-readonly-row").length).toBeLessThan(40);
    expect(view.container.querySelector('[data-resource-id="skill:skill-1999"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(await screen.findByRole("heading", { name: "Edit profile" })).toBeTruthy();
    expect(screen.getByText("Unselected")).toBeTruthy();
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(screen.queryByText("Saving updates the profile only. Claude Code is unchanged.")).toBeNull();
    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.queryByText("Select filtered")).toBeNull();
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(view.container.querySelectorAll(".claude-profile-transfer-column")).toHaveLength(2);
    expect(view.container.querySelectorAll(".claude-profile-transfer-option").length).toBeLessThan(40);

    fireEvent.change(screen.getByPlaceholderText("Search Skills"), { target: { value: "skill-1999" } });
    const remove = await screen.findByRole("button", { name: "Remove skill-1999" });
    fireEvent.click(remove);
    const select = await screen.findByRole("button", { name: "Select skill-1999" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveClaudeProfile).toHaveBeenCalledTimes(1));
    expect(saveClaudeProfile.mock.calls[0][0].skills).toContain("skill:skill-1999");
    expect(previewClaudeProfile).not.toHaveBeenCalled();
    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("default"));
  });

  it("separates live status from temporary resource actions", async () => {
    const view = renderPage();
    await screen.findByRole("button", { name: "Profile: Default" });

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy();
    const firstRow = view.container.querySelector<HTMLElement>('[data-resource-id="skill:skill-0"]')!;
    expect(within(firstRow).getByText("Enabled")).toBeTruthy();
    expect(within(firstRow).getByText("Enabled").closest(".claude-resource-status")?.classList.contains("active")).toBe(true);
    fireEvent.click(within(firstRow).getByRole("button", { name: "Disable skill-0" }));

    await waitFor(() => expect(setClaudeProfileResourceState).toHaveBeenCalledWith({
      profileId: "default",
      resourceId: "skill:skill-0",
      enabled: false
    }));
    await waitFor(() => {
      const updatedRow = view.container.querySelector<HTMLElement>('[data-resource-id="skill:skill-0"]')!;
      expect(within(updatedRow).getByText("Disabled")).toBeTruthy();
      expect(within(updatedRow).getByText("Disabled").closest(".claude-resource-status")?.classList.contains("idle")).toBe(true);
      expect(within(updatedRow).getByRole("button", { name: "Enable skill-0" })).toBeTruthy();
    });
    expect(currentSnapshot.profiles.find(profile => profile.id === "default")?.skills).toContain("skill:skill-0");
  });

  it("keeps the dynamic All profile read-only", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Profile: Default" }));
    fireEvent.click(screen.getByRole("option", { name: "All" }));

    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("all"));
    const edit = screen.getByRole("button", { name: "Edit profile" }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("All updates automatically");
  });

  it("applies a selected profile immediately and confirms the switch with a toast", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Profile: Default" }));

    fireEvent.click(screen.getByRole("option", { name: "Focused" }));

    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("focused"));
    expect(previewClaudeProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(await screen.findByText("Switched to: Focused")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Profile: Focused" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills 1" })).toBeTruthy();
    expect(document.querySelectorAll(".claude-profile-readonly-row")).toHaveLength(1);
  });

  it("uses a searchable in-app profile menu with current-first natural ordering", async () => {
    const focused = currentSnapshot.profiles.find(profile => profile.id === "focused")!;
    currentSnapshot = {
      ...currentSnapshot,
      profiles: [
        ...currentSnapshot.profiles,
        { ...focused, id: "hash", name: "#Archive" },
        { ...focused, id: "alpha", name: "alpha" },
        { ...focused, id: "cable", name: "cABle" },
        { ...focused, id: "zulu", name: "Zulu" }
      ]
    };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Profile: Default" }));
    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual([
      "Default",
      "#Archive",
      "All",
      "alpha",
      "cABle",
      "Focused",
      "Zulu"
    ]);

    fireEvent.change(screen.getByRole("textbox", { name: "Search profiles" }), { target: { value: "ab" } });
    expect(await screen.findByRole("option", { name: "cABle" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("supports keyboard navigation and restores focus to the profile trigger", async () => {
    renderPage();
    const trigger = await screen.findByRole("button", { name: "Profile: Default" });
    trigger.focus();
    fireEvent.click(trigger);
    const search = screen.getByRole("textbox", { name: "Search profiles" });
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(search);

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const defaultOption = screen.getByRole("option", { name: "Default" });
    expect(document.activeElement).toBe(defaultOption);
    fireEvent.keyDown(defaultOption, { key: "ArrowDown" });
    const allOption = screen.getByRole("option", { name: "All" });
    expect(document.activeElement).toBe(allOption);
    fireEvent.keyDown(allOption, { key: "ArrowDown" });
    const focusedOption = screen.getByRole("option", { name: "Focused" });
    expect(document.activeElement).toBe(focusedOption);
    fireEvent.keyDown(focusedOption, { key: "Enter" });

    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("focused"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Profile: Focused" })));

    const focusedTrigger = screen.getByRole("button", { name: "Profile: Focused" });
    focusedTrigger.focus();
    fireEvent.click(focusedTrigger);
    const reopenedSearch = screen.getByRole("textbox", { name: "Search profiles" });
    fireEvent.keyDown(reopenedSearch, { key: "Escape" });
    expect(document.activeElement).toBe(focusedTrigger);
    expect(screen.queryByRole("listbox", { name: "Profiles" })).toBeNull();

    const newProfile = screen.getByRole("button", { name: "New profile" });
    fireEvent.click(newProfile);
    const emptyProfile = screen.getByRole("menuitem", { name: /Empty profile/ });
    emptyProfile.focus();
    fireEvent.keyDown(emptyProfile, { key: "Escape" });
    expect(document.activeElement).toBe(newProfile);
    expect(screen.queryByRole("menuitem", { name: /Empty profile/ })).toBeNull();
  });

  it("reapplies a drifted current profile and reports Plugin enablement consistently", async () => {
    currentSnapshot = {
      ...currentSnapshot,
      inventory: {
        ...currentSnapshot.inventory,
        plugins: currentSnapshot.inventory.plugins.map(plugin => ({ ...plugin, enabled: false }))
      },
      drift: { profileId: "default", isDrifted: true, skills: false, plugins: true, mcpServers: false }
    };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Profile: Default" }));
    fireEvent.click(screen.getByRole("option", { name: "Default" }));
    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("default"));
    fireEvent.click(screen.getByRole("button", { name: "Plugins 1" }));

    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.queryByText("Included")).toBeNull();
  });

  it("shows unavailable profile members in both the tab count and read-only list", async () => {
    const defaultProfile = currentSnapshot.profiles[0];
    currentSnapshot = {
      ...currentSnapshot,
      profiles: currentSnapshot.profiles.map(profile => profile.id === defaultProfile.id
        ? { ...profile, skills: [...profile.skills, "skill:retired-skill"] }
        : profile)
    };
    renderPage();

    expect(await screen.findByRole("button", { name: "Skills 2001" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search Skills"), { target: { value: "retired-skill" } });

    expect(await screen.findByText("No longer available in the current environment")).toBeTruthy();
    expect(screen.getByText("Missing").closest(".claude-resource-status")?.classList.contains("missing")).toBe(true);
    expect(screen.getByText("Unavailable")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(await screen.findByPlaceholderText("Search Skills"), { target: { value: "retired-skill" } });
    expect((await screen.findByText("Missing")).closest(".claude-profile-live-state")?.classList.contains("missing")).toBe(true);
  });

  it("does not search hidden resource details in the main list or editor", async () => {
    currentSnapshot = {
      ...currentSnapshot,
      inventory: {
        ...currentSnapshot.inventory,
        skills: currentSnapshot.inventory.skills.map((skill, index) => index === 0
          ? { ...skill, description: "private-only-token" }
          : skill)
      }
    };
    const view = renderPage({ ...defaultSettings, hideSensitiveContent: true });
    await screen.findByRole("button", { name: "Profile: Default" });

    fireEvent.change(screen.getByPlaceholderText("Search Skills"), { target: { value: "private-only-token" } });
    await waitFor(() => expect(view.container.querySelector('[data-resource-id="skill:skill-0"]')).toBeNull());
    expect(screen.getByText("No matches")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(await screen.findByPlaceholderText("Search Skills"), { target: { value: "private-only-token" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove skill-0" })).toBeNull());
  });

  it("localizes backend operation errors in the Chinese UI", async () => {
    applyClaudeProfile.mockResolvedValueOnce({
      ok: false,
      issues: [{ code: "settings-write-failed", message: "Claude settings could not be replaced." }]
    });
    const view = renderPage(defaultSettings, "zh");

    fireEvent.click(await screen.findByRole("button", { name: "方案：Default" }));
    fireEvent.click(screen.getByRole("option", { name: "Focused" }));

    const localized = "无法更新 Claude settings.json。";
    await screen.findAllByText(localized);
    expect(view.container.querySelector(".connection-error")?.textContent).toBe(localized);
    expect(document.querySelector("[data-sonner-toast] [data-title]")?.textContent).toBe(localized);
    expect(screen.queryByText("Claude settings could not be replaced.")).toBeNull();
    expect(screen.getByRole("button", { name: "方案：Default" })).toBeTruthy();
  });

  it("keeps store mutation errors actionable in the Chinese UI", async () => {
    deleteClaudeProfile.mockResolvedValueOnce({
      ok: false,
      issues: [{ code: "applied-profile", message: "Apply another profile before deleting this one." }]
    });
    const view = renderPage(defaultSettings, "zh");

    fireEvent.click(await screen.findByRole("button", { name: "方案：Default" }));
    fireEvent.click(screen.getByRole("option", { name: "Focused" }));
    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("focused"));
    fireEvent.click(screen.getByRole("button", { name: "编辑配置方案" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(screen.getAllByRole("button", { name: "删除" }).at(-1)!);

    const localized = "请先应用其他方案，再删除此方案。";
    await screen.findAllByText(localized);
    expect(view.container.querySelector(".connection-error")?.textContent).toBe(localized);
    expect(screen.queryByText("Apply another profile before deleting this one.")).toBeNull();
  });

  it("localizes duplicate profile id errors in the Chinese UI", async () => {
    saveClaudeProfile.mockResolvedValueOnce({
      ok: false,
      issues: [{ code: "duplicate-profile-id", message: "A generated Claude profile id already exists." }]
    });
    const view = renderPage(defaultSettings, "zh");

    await screen.findByRole("button", { name: "方案：Default" });
    fireEvent.click(screen.getByRole("button", { name: "新建配置方案" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /空白方案/ }));
    fireEvent.change(await screen.findByPlaceholderText("名称"), { target: { value: "生信" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const localized = "生成的方案 ID 已存在，请重试。";
    await screen.findAllByText(localized);
    expect(view.container.querySelector(".connection-error")?.textContent).toBe(localized);
    expect(screen.queryByText("A generated Claude profile id already exists.")).toBeNull();
  });

  it("clears the busy state and reports an unexpected apply rejection", async () => {
    applyClaudeProfile.mockRejectedValueOnce(new Error("IPC unavailable"));
    const view = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Profile: Default" }));
    fireEvent.click(screen.getByRole("option", { name: "Focused" }));

    const message = "The profile could not be applied.";
    await screen.findAllByText(message);
    expect(view.container.querySelector(".connection-error")?.textContent).toBe(message);
    expect(document.querySelector("[data-sonner-toast] [data-title]")?.textContent).toBe(message);
    expect((screen.getByRole("button", { name: "Profile: Default" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts an empty profile with every resource unselected", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Profile: Default" });

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Empty profile/ }));

    expect(await screen.findByRole("heading", { name: "New profile" })).toBeTruthy();
    const nameInput = screen.getByPlaceholderText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("");
    expect(document.activeElement).not.toBe(nameInput);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameInput, { target: { value: "Bioinformatics" } });
    fireEvent.change(screen.getByPlaceholderText("Search Skills"), { target: { value: "skill-1999" } });
    fireEvent.click(await screen.findByRole("button", { name: "Select skill-1999" }));
    expect(await screen.findByRole("button", { name: "Remove skill-1999" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveClaudeProfile).toHaveBeenCalledTimes(1));
    expect(saveClaudeProfile.mock.calls[0][0].skills).toEqual(["skill:skill-1999"]);
    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("created"));
  });

  it("creates a new profile by copying the selected membership", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Profile: Default" });

    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy selected/ }));

    expect(await screen.findByText("New profile")).toBeTruthy();
    expect(screen.getByDisplayValue("Default copy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveClaudeProfile).toHaveBeenCalledTimes(1));
    const input = saveClaudeProfile.mock.calls[0][0];
    expect(input.id).toBeUndefined();
    expect(input.skills).toHaveLength(2000);
    expect(input.plugins).toEqual(["plugin:review@market"]);
    expect(input.mcpServers).toEqual(["mcp:filesystem"]);
    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("created"));
  });

  it("switches to Default before deleting the current custom profile", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Profile: Default" }));

    fireEvent.click(screen.getByRole("option", { name: "Focused" }));
    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("focused"));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText('Default will become current, then “Focused” will be permanently deleted.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);

    await waitFor(() => expect(applyClaudeProfile).toHaveBeenCalledWith("default"));
    await waitFor(() => expect(deleteClaudeProfile).toHaveBeenCalledWith("focused"));
  });

  it("pauses profile mutations while MCP state is unreadable", async () => {
    currentSnapshot = makeSnapshot("config-unreadable");
    renderPage();

    expect(await screen.findByText("~/.claude.json is temporarily unreadable. Profile actions are paused.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Edit profile" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "New profile" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrayMenuApp, { resolveTrayLocale, type TrayMenuState } from "../src/renderer/TrayMenuApp";

let pushState: (state: TrayMenuState) => void;
let trayMenuAction: ReturnType<typeof vi.fn>;
let trayMenuReady: ReturnType<typeof vi.fn>;
let trayMenuRendered: ReturnType<typeof vi.fn>;
let saveSettings: ReturnType<typeof vi.fn>;

function baseState(overrides: Partial<TrayMenuState> = {}): TrayMenuState {
  return {
    petVisible: true,
    panelVisible: false,
    petEnabled: true,
    dark: true,
    language: "zh",
    pets: [
      { id: "minato-aqua", name: "Minato Aqua", active: true },
      { id: "codex-pet:boba", name: "Boba", active: false }
    ],
    submenuSide: "left",
    ...overrides
  };
}

function installCompanion(readyResult: TrayMenuState | null) {
  trayMenuAction = vi.fn(async () => undefined);
  trayMenuReady = vi.fn(async () => readyResult);
  trayMenuRendered = vi.fn(async () => undefined);
  saveSettings = vi.fn(async () => ({}));
  Reflect.set(window, "companion", {
    onTrayMenuState: (callback: (state: TrayMenuState) => void) => {
      pushState = state => act(() => callback(state));
      return () => undefined;
    },
    trayMenuReady,
    trayMenuRendered,
    trayMenuAction,
    saveSettings
  });
}

function overlay(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector(".tray-overlay") as HTMLElement;
}
function flyout(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector(".tray-flyout") as HTMLElement;
}
function menu(view: ReturnType<typeof render>): HTMLElement {
  return view.container.querySelector(".tray-menu") as HTMLElement;
}
function item(name: string): HTMLButtonElement {
  return screen.getByRole("menuitem", { name }) as HTMLButtonElement;
}

beforeEach(() => {
  installCompanion(null);
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "companion");
});

describe("TrayMenuApp state flow", () => {
  it("renders the cold first open from the ready handshake, without any push", async () => {
    installCompanion(baseState({ language: "en", petVisible: false }));
    render(<TrayMenuApp />);
    expect(await screen.findByRole("menuitem", { name: "Show pet" })).toBeTruthy();
    expect(trayMenuReady).toHaveBeenCalledTimes(1);
  });

  it("renders nothing until state arrives", () => {
    const view = render(<TrayMenuApp />);
    expect(view.container.querySelector(".tray-menu")).toBeNull();
    pushState(baseState());
    expect(view.container.querySelector(".tray-menu")).not.toBeNull();
  });

  it("labels the top-level items, localized (zh) with Switch pet first", () => {
    render(<TrayMenuApp />);
    pushState(baseState({ petVisible: true, panelVisible: false }));
    expect(screen.getByRole("menuitem", { name: "切换宠物" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "隐藏桌宠" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "显示面板" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "退出" })).toBeTruthy();
  });

  it("renders English labels under the English language setting", () => {
    render(<TrayMenuApp />);
    pushState(baseState({ language: "en", petVisible: false }));
    expect(screen.getByRole("menuitem", { name: "Switch pet" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Show pet" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Quit" })).toBeTruthy();
  });

  it("reports the clicked toggle action back to main", () => {
    render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    fireEvent.click(item("Hide pet"));
    fireEvent.click(item("Quit"));
    expect(trayMenuAction.mock.calls.map(call => call[0])).toEqual(["toggle-pet", "quit"]);
  });

  it("disables the pet item while the pet is disabled in settings", () => {
    render(<TrayMenuApp />);
    pushState(baseState({ language: "en", petEnabled: false }));
    expect((item("Hide pet")).disabled).toBe(true);
    fireEvent.click(item("Hide pet"));
    expect(trayMenuAction).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<TrayMenuApp />);
    pushState(baseState());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trayMenuAction).toHaveBeenCalledWith("close");
  });

  it("dismisses when the transparent backdrop is clicked", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState());
    fireEvent.click(overlay(view));
    expect(trayMenuAction).toHaveBeenCalledWith("close");
  });

  it("does not dismiss when a menu item area is clicked (not the backdrop)", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState());
    fireEvent.click(menu(view));
    expect(trayMenuAction).not.toHaveBeenCalledWith("close");
  });

  it("reports every fresh state as painted so main can un-hide the window", async () => {
    render(<TrayMenuApp />);
    pushState(baseState());
    await waitFor(() => expect(trayMenuRendered).toHaveBeenCalledTimes(1));
    pushState(baseState({ petVisible: false }));
    await waitFor(() => expect(trayMenuRendered).toHaveBeenCalledTimes(2));
  });

  it("uses dark and light surfaces per the OS theme, and the submenu-side class", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ dark: false, submenuSide: "right" }));
    expect(view.container.querySelector(".tray-overlay.light.submenu-right")).not.toBeNull();
    pushState(baseState({ dark: true, submenuSide: "left" }));
    expect(view.container.querySelector(".tray-overlay.dark.submenu-left")).not.toBeNull();
  });
});

describe("TrayMenuApp Switch pet submenu", () => {
  it("leads with the active pet (at the cursor row) with the rest below, checked", () => {
    render(<TrayMenuApp />);
    // Registry order is Minato then Boba, but Boba is the active one.
    pushState(baseState({
      pets: [
        { id: "minato-aqua", name: "Minato Aqua", active: false },
        { id: "codex-pet:boba", name: "Boba", active: true }
      ]
    }));
    const pets = screen.getAllByRole("menuitemradio");
    // Active pet leads so it lands on the trigger row; the rest keep order.
    expect(pets.map(pet => pet.textContent)).toEqual(["✓Boba", "Minato Aqua"]);
    expect(pets[0].getAttribute("aria-checked")).toBe("true");
    expect(pets[1].getAttribute("aria-checked")).toBe("false");
  });

  it("opens the flyout on trigger click and on hover", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    expect(flyout(view).classList.contains("open")).toBe(false);

    fireEvent.click(item("Switch pet"));
    expect(flyout(view).classList.contains("open")).toBe(true);
    expect(item("Switch pet").getAttribute("aria-expanded")).toBe("true");

    // Reopen state and hover instead.
    pushState(baseState({ language: "en" }));
    expect(flyout(view).classList.contains("open")).toBe(false);
    fireEvent.mouseEnter(flyout(view));
    expect(flyout(view).classList.contains("open")).toBe(true);
  });

  it("switches the pet via saveSettings then closes the menu", async () => {
    render(<TrayMenuApp />);
    pushState(baseState());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Boba/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ petTheme: "codex-pet:boba" }));
    await waitFor(() => expect(trayMenuAction).toHaveBeenCalledWith("close"));
  });

  it("shows an empty state when there are no pets", () => {
    render(<TrayMenuApp />);
    pushState(baseState({ language: "en", pets: [] }));
    expect(screen.getByText("No pets")).toBeTruthy();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });
});

describe("TrayMenuApp keyboard navigation", () => {
  it("preselects nothing on open: focus parks on the menu container", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    expect(document.activeElement).toBe(menu(view));
  });

  it("roves the top-level items, Switch pet first, on arrow keys", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    fireEvent.keyDown(menu(view), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Switch pet"));
    fireEvent.keyDown(menu(view), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Hide pet"));
    fireEvent.keyDown(menu(view), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Switch pet"));
    fireEvent.keyDown(menu(view), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Quit")); // wrap to last
  });

  it("skips the disabled pet item while roving", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en", petEnabled: false }));
    fireEvent.keyDown(menu(view), { key: "End" });
    expect(document.activeElement).toBe(item("Quit"));
    fireEvent.keyDown(menu(view), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Show panel"));
    fireEvent.keyDown(menu(view), { key: "ArrowUp" });
    // Hide pet is disabled and skipped, back to Switch pet.
    expect(document.activeElement).toBe(item("Switch pet"));
  });

  it("opens the submenu with ArrowRight and returns with ArrowLeft", async () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    item("Switch pet").focus();
    fireEvent.keyDown(menu(view), { key: "ArrowRight" });
    expect(flyout(view).classList.contains("open")).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: /Minato Aqua/ })));

    fireEvent.keyDown(menu(view), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Switch pet"));
  });

  it("activates a top-level item with Enter", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    item("Quit").focus();
    fireEvent.keyDown(menu(view), { key: "Enter" });
    expect(trayMenuAction).toHaveBeenCalledWith("quit");
  });

  it("Escape closes an open submenu first, then dismisses the popup", () => {
    const view = render(<TrayMenuApp />);
    pushState(baseState({ language: "en" }));
    fireEvent.click(item("Switch pet"));
    expect(flyout(view).classList.contains("open")).toBe(true);
    screen.getByRole("menuitemradio", { name: /Boba/ }).focus();

    // First Escape: submenu closes, focus returns to the trigger, popup stays.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(flyout(view).classList.contains("open")).toBe(false);
    expect(document.activeElement).toBe(item("Switch pet"));
    expect(trayMenuAction).not.toHaveBeenCalledWith("close");

    // Second Escape: the whole popup dismisses.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trayMenuAction).toHaveBeenCalledWith("close");
  });
});

describe("resolveTrayLocale", () => {
  it("honors an explicit language and falls back to the system for auto", () => {
    expect(resolveTrayLocale("zh", "en-US")).toBe("zh");
    expect(resolveTrayLocale("en", "zh-CN")).toBe("en");
    expect(resolveTrayLocale("auto", "zh-CN")).toBe("zh");
    expect(resolveTrayLocale(undefined, "en-US")).toBe("en");
  });
});

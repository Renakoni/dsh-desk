import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

// The custom tray popup: replaces the native Win32 context menu, whose
// reserved checkmark/accelerator gutters and OS-fixed item metrics cannot
// be styled.
//
// State flow: the mount effect subscribes to pushes FIRST, then performs the
// ready handshake — main defers presenting the window until the handshake,
// and its result doubles as the initial state, so a cold first right-click
// can never show an empty popup.
//
// Layout: main sizes the window to hold the main menu column plus a submenu
// column and tells us which side the "Switch pet" flyout opens on. The
// window is transparent; clicking its empty area (the backdrop) dismisses.

export interface TrayPet {
  id: string;
  name: string;
  active: boolean;
}

export interface TrayMenuState {
  petVisible: boolean;
  panelVisible: boolean;
  petEnabled: boolean;
  dark: boolean;
  language?: "auto" | "zh" | "en";
  pets: TrayPet[];
  submenuSide: "left" | "right";
}

type TrayMenuAction = "toggle-pet" | "toggle-panel" | "quit" | "close";

type TrayCompanionApi = {
  onTrayMenuState?: (callback: (state: TrayMenuState) => void) => () => void;
  trayMenuReady?: () => Promise<TrayMenuState | null | undefined>;
  trayMenuRendered?: () => Promise<void>;
  trayMenuAction?: (action: TrayMenuAction) => Promise<void>;
  saveSettings?: (next: { petTheme: string }) => Promise<unknown>;
};

function trayCompanion(): TrayCompanionApi | undefined {
  return (window as Window & { companion?: TrayCompanionApi }).companion;
}

const COPY = {
  zh: { switchPet: "切换宠物", showPet: "显示桌宠", hidePet: "隐藏桌宠", showPanel: "显示面板", hidePanel: "隐藏面板", quit: "退出", noPets: "暂无宠物" },
  en: { switchPet: "Switch pet", showPet: "Show pet", hidePet: "Hide pet", showPanel: "Show panel", hidePanel: "Hide panel", quit: "Quit", noPets: "No pets" }
} as const;

export function resolveTrayLocale(language: string | undefined, navigatorLanguage: string): "zh" | "en" {
  if (language === "zh" || language === "en") return language;
  return navigatorLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export default function TrayMenuApp() {
  const [state, setState] = useState<TrayMenuState | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // A short close delay bridges the pointer crossing from the trigger to the
  // submenu; re-entering either cancels it. submenuOpenRef lets the global
  // Escape handler know a submenu is open without re-subscribing.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submenuOpenRef = useRef(false);
  submenuOpenRef.current = submenuOpen;

  useEffect(() => {
    let mounted = true;
    const unsubscribe = trayCompanion()?.onTrayMenuState?.(setState);
    void trayCompanion()?.trayMenuReady?.().then(initial => {
      if (mounted && initial) setState(initial);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Nested-menu Escape: the first Escape closes an open submenu and
      // restores the trigger; only a second Escape dismisses the popup.
      if (submenuOpenRef.current) {
        setSubmenuOpen(false);
        triggerRef.current?.focus();
        return;
      }
      void trayCompanion()?.trayMenuAction?.("close");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Every (re)open pushes a fresh state object: park focus on the container so
  // keys work immediately but no item reads as preselected, close any stale
  // submenu, then report the frame is painted so main un-hides the window.
  useEffect(() => {
    if (!state) return;
    setSubmenuOpen(false);
    menuRef.current?.focus();
    const schedule: (callback: () => void) => number | ReturnType<typeof setTimeout> =
      typeof requestAnimationFrame === "function" ? requestAnimationFrame : callback => setTimeout(callback, 16);
    const cancel = typeof requestAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    let second: number | ReturnType<typeof setTimeout> | null = null;
    const first = schedule(() => {
      second = schedule(() => void trayCompanion()?.trayMenuRendered?.());
    });
    return () => {
      cancel(first as never);
      if (second !== null) cancel(second as never);
    };
  }, [state]);

  if (!state) return null;
  const copy = COPY[resolveTrayLocale(state.language, navigator.language)];
  const send = (action: TrayMenuAction) => () => void trayCompanion()?.trayMenuAction?.(action);
  // The active pet leads the list so it lands on the trigger row (at the
  // cursor) when the flyout top-aligns with the menu; the rest follow below.
  const orderedPets = [...state.pets.filter(pet => pet.active), ...state.pets.filter(pet => !pet.active)];

  function switchPet(id: string) {
    // Reuse the settings path so the theme swap runs its full pipeline
    // (per-theme animation profile, pet-window resize, broadcast to the pet).
    void trayCompanion()?.saveSettings?.({ petTheme: id }).then(() => trayCompanion()?.trayMenuAction?.("close"));
  }

  function topLevelItems(): HTMLButtonElement[] {
    return [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-tray-item="top"]:not([disabled])') ?? [])];
  }
  function submenuItems(): HTMLButtonElement[] {
    return [...(submenuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
  }
  const focusOnHover = (event: { currentTarget: HTMLButtonElement }) => event.currentTarget.focus();

  function cancelClose() {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }
  function openSubmenu(focusFirst: boolean) {
    cancelClose();
    setSubmenuOpen(true);
    if (focusFirst) requestAnimationFrame(() => submenuItems()[0]?.focus());
  }
  function scheduleCloseSubmenu() {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setSubmenuOpen(false);
      closeTimerRef.current = null;
    }, 220);
  }
  function closeSubmenu(focusTrigger: boolean) {
    cancelClose();
    setSubmenuOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Navigation inside the open submenu.
    if (submenuRef.current?.contains(document.activeElement)) {
      const items = submenuItems();
      const index = items.findIndex(item => item === document.activeElement);
      if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
      else if (event.key === "ArrowUp") items[(index <= 0 ? items.length : index) - 1]?.focus();
      else if (event.key === "Home") items[0]?.focus();
      else if (event.key === "End") items[items.length - 1]?.focus();
      else if (event.key === "ArrowLeft") closeSubmenu(true);
      else return;
      event.preventDefault();
      return;
    }

    // Top-level roving navigation (submenu items are excluded).
    const items = topLevelItems();
    if (items.length === 0) return;
    const index = items.findIndex(item => item === document.activeElement);
    if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(index <= 0 ? items.length : index) - 1]?.focus();
    else if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items[items.length - 1]?.focus();
    else if (event.key === "ArrowRight" && document.activeElement === triggerRef.current) openSubmenu(true);
    else if (event.key === "Enter" || event.key === " ") {
      if (document.activeElement === triggerRef.current) openSubmenu(true);
      else if (index >= 0) items[index]?.click();
    } else return;
    event.preventDefault();
  }

  return (
    <div
      className={`tray-overlay ${state.dark ? "dark" : "light"} submenu-${state.submenuSide}`}
      onClick={event => { if (event.target === event.currentTarget) void trayCompanion()?.trayMenuAction?.("close"); }}
    >
      <div className="tray-menu" role="menu" tabIndex={-1} ref={menuRef} onKeyDown={handleMenuKeyDown} onMouseLeave={() => menuRef.current?.focus()}>
        <div
          className={`tray-flyout ${submenuOpen ? "open" : ""}`}
          onMouseEnter={() => openSubmenu(false)}
          onMouseLeave={scheduleCloseSubmenu}
          onBlur={event => { if (submenuOpen && !event.currentTarget.contains(event.relatedTarget as Node)) closeSubmenu(false); }}
        >
          <button
            type="button"
            role="menuitem"
            data-tray-item="top"
            tabIndex={-1}
            ref={triggerRef}
            className="tray-menu-item tray-flyout-trigger"
            aria-haspopup="true"
            aria-expanded={submenuOpen}
            onClick={() => openSubmenu(false)}
            onMouseEnter={focusOnHover}
          >
            <span>{copy.switchPet}</span>
            <span className="tray-flyout-caret" aria-hidden="true">{state.submenuSide === "left" ? "‹" : "›"}</span>
          </button>
          <div className="tray-submenu" role="menu" ref={submenuRef} aria-label={copy.switchPet}>
            {orderedPets.length === 0 ? (
              <div className="tray-submenu-empty">{copy.noPets}</div>
            ) : orderedPets.map(pet => (
              <button
                key={pet.id}
                type="button"
                role="menuitemradio"
                aria-checked={pet.active}
                tabIndex={-1}
                className={`tray-menu-item tray-submenu-item ${pet.active ? "active" : ""}`}
                onClick={() => switchPet(pet.id)}
                onMouseEnter={focusOnHover}
              >
                <span className="tray-check" aria-hidden="true">{pet.active ? "✓" : ""}</span>
                <span className="tray-submenu-name">{pet.name}</span>
              </button>
            ))}
          </div>
        </div>

        <button type="button" role="menuitem" data-tray-item="top" tabIndex={-1} disabled={!state.petEnabled} className="tray-menu-item" onClick={send("toggle-pet")} onMouseEnter={focusOnHover}>
          {state.petVisible ? copy.hidePet : copy.showPet}
        </button>
        <button type="button" role="menuitem" data-tray-item="top" tabIndex={-1} className="tray-menu-item" onClick={send("toggle-panel")} onMouseEnter={focusOnHover}>
          {state.panelVisible ? copy.hidePanel : copy.showPanel}
        </button>
        <div className="tray-menu-separator" role="separator" />
        <button type="button" role="menuitem" data-tray-item="top" tabIndex={-1} className="tray-menu-item" onClick={send("quit")} onMouseEnter={focusOnHover}>
          {copy.quit}
        </button>
      </div>
    </div>
  );
}

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, Notification, protocol, screen, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isPetEvent, isSessionStartEvent, NotificationKind, PetEvent, PetState } from "../shared/events";
import type {
  ClaudePluginScope,
  ClaudeProfileMutationResult,
  ClaudeProfileOperationIssue,
  ClaudeProfilePreviewResult,
  ClaudeProfileResourceStateInput,
  ClaudeProfilesSnapshot,
  ClaudeResourceItem,
  ClaudeResourcesSnapshot
} from "../shared/claudeProfiles";
import { snapshotAfterClaudeProfileApply, snapshotAfterClaudeProfileResourceState } from "../shared/claudeProfiles";
import { PET_IMAGE_SIZE, getPetWindowHeight, getPetWindowWidth, normalizePetDisplaySettings } from "../shared/petDisplaySettings";
import { BUILTIN_PET_THEME_ID, BUILTIN_PET_THEME_NAME, packIdFromThemeId, petPackThemeId } from "../shared/petThemeCatalog";
import { displayedSpriteHeight } from "../shared/spriteFrame";
import { createDefaultCompanionSettings, pickCanonicalSettings } from "./companionSettingsSchema";
import { applyThemeAnimationProfileSwitch } from "./themeProfiles";
import { redactDisplayEvent } from "../shared/privacy";
import type { HookStatus, HookOperationResult } from "../shared/hooks";
import {
  addCcSwitchProvider,
  deleteCcSwitchProvider,
  duplicateCcSwitchProvider,
  getCcSwitchStatus,
  getCommonConfigSnippet,
  getCurrentCcSwitchProviderId,
  listCcSwitchProviders,
  reorderCcSwitchProviders,
  probeClaudeEndpoint,
  fetchProviderModels,
  switchCcSwitchProvider,
  updateCcSwitchProvider,
  type CcSwitchProvider
} from "./ccSwitchStore";
import {
  embeddedDeepSeekPricing,
  ModelPricingMemo,
  parseDeepSeekOfficialPricing,
  parseLiteLlmPricing,
  parseModelsDevPricing,
  pricingRatesSignature,
  type ModelPricingRates
} from "./claudePricing";
import { PermissionBroker, type PendingPermission, type PermissionPollResult } from "./permissionBroker";
import { inspectPetPackZip, installPetPack, listPetPacks, readPetPack, removePetPack, resolvePetAssetPath } from "./petPackStore";
import { cleanupPetDownloads, discardDownloadedPetPack, downloadPetPack } from "./petPackDownload";
import { createPetDragWatcher, type PetDragWatcher } from "./petDragWatcher";
import { createDoubleClickDetector, installPetParentNotifyWatcher, readSystemDoubleClickMetrics, type DoubleClickMetrics } from "./petDoubleClick";
import { pointInBounds, trayMenuLayout, type TrayMenuMetrics, type TraySubmenuSide } from "./trayMenuPosition";
import { createTrayMenuController } from "./trayMenuController";
import { buildPowerShellLaunch, CHARA_DESK_CLAUDE_ENV, CHARA_DESK_RESUME_ID_ENV, launchDetachedTerminal, launchFailedMessage, mergeTerminalEnv, normalizeCmdCwd, notAFolderMessage, PS_RESUME_CLAUDE, PS_RUN_CLAUDE, providerTerminalEnv, resolveClaudeExecutable, resolveSessionCwd, sessionFolderUnavailableMessage, trustedCmdPath, trustedPowerShellPath, uncNotSupportedMessage } from "./providerTerminal";
import {
  buildClaudeProfileInventory,
  createClaudeProfilesSnapshot,
  removeClaudeProfile,
  saveClaudeProfileStore,
  upsertClaudeProfile
} from "./claudeProfileStore";
import { synchronizeClaudeMcpProfileResources } from "./claudeMcpInventory";
import { applyClaudeProfile, previewClaudeProfileApply } from "./claudeProfileCoordinator";
import { setClaudeProfileResourceEnabled } from "./claudeProfileRuntime";
import { backupJsonFile, writeTextFileAtomic } from "./filePersistence";
import { EVENT_SERVER_DEV_ORIGIN, isAcceptedEventServerRequest } from "./eventServerSecurity";
import { visitJsonlTail } from "./jsonlTail";
import { historyToSortedArray, mergeTokenDailyHistory, normalizeTokenDailyHistory } from "./tokenHistory";
import { EMBEDDED_CURRENCY_RATES, parseExchangeApiRates, type CurrencyRatesStatus } from "../shared/currency";
import { recordSessionSighting } from "./runtimeSessions";
import { loadScanCache, saveScanCache, type CachedScan } from "./scanCachePersistence";
import { aggregateRecentEdits, editFromToolUseResult, emptyRecentEditsSnapshot, type ParsedEditRecord, type RecentEditsSnapshot } from "./claudeEditLog";
import { aggregateUsageRankings, countToolUseBlocks, countUserCommands, createUsageCounts, emptyUsageRankingsSnapshot, type UsageCounts, type UsageRankingsSnapshot } from "./claudeUsageStats";
import { DshUsageStore, normalizeDshUsageRecord } from "./dshUsage";
import { DshSessionScanner, isDshSessionLogPath } from "./dshSessionScanner";
import { resolveDshHome } from "./dshPaths";
import { findNpxExecutable, getDshPluginStatus, installDshPlugin, removeDshPlugin, resolveBundledDshPluginPath, type DshPluginManagerOptions } from "./dshPluginManager";
import {
  deleteDshProvider,
  duplicateDshProvider,
  listDshProviders,
  probeDshProvider,
  reorderDshProviders,
  saveDshProvider,
  setDshProviderEnabled,
  switchDshProvider
} from "./dshProviderStore";
import type { DshProviderSaveInput } from "../shared/dshProviders";
import type { DshMarketplaceSkill, DshPluginInstallInput, DshPluginRemoveInput, DshPluginStateInput, DshSkillRepo } from "../shared/dshPlugins";
import type { DshResourceInventory, DshResourceSchemeSaveInput, DshResourceStateInput } from "../shared/dshResources";
import { ALL_DSH_SCHEME_ID } from "../shared/dshResources";
import { emptyDshAnalyticsSnapshot, type DshAnalyticsSnapshot } from "../shared/dshAnalytics";
import type { CompanionInitialState } from "../renderer/shared/events";
import { DshPluginCatalog } from "./dshPluginCatalog";
import { canRevealDshSkillPath, dshSkillResources, restoreLegacyDisabledDshSkills, scanDshSkills } from "./dshSkillCatalog";
import { DshRuntimeSnapshotSet, dshRuntimePluginResources, dshRuntimeSkillResources, normalizeDshRuntimePluginSnapshot } from "./dshRuntimePlugins";
import { dshDesiredPluginStates, dshDesiredSkillStates, dshPluginPackageNames, DshResourceSchemeManager } from "./dshResourceSchemes";
import { DshSkillMarketplace } from "./dshSkillMarketplace";
import { DshDesiredResourceState } from "./dshDesiredResourceState";

type DailyRuntimeStats = {
  events: number;
  toolCalls: number;
  sessions: number;
  errors?: number;
  permissionRequests?: number;
};

type RuntimeStats = {
  toolUsage: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  totalSessions: number;
  dailyStats: Record<string, DailyRuntimeStats>;
  errorCount: number;
  permissionRequests: number;
  permissionApproved: number;
  permissionDenied: number;
  totalRuntime: number;
  hourlyActivity: number[];
  dailyHourlyActivity: Record<string, number[]>;
  dailyToolUsage: Record<string, Record<string, number>>;
  /** Distinct Claude session ids seen per day, so `dailyStats[day].sessions` counts real
   *  sessions (any event marks one) rather than only SessionStart hooks. Main-only; the
   *  raw ids are stripped before the stats leave the process. Pruned with the heavy maps. */
  dailySessionIds: Record<string, string[]>;
  firstStartTime: number;
  lastEventTime: number;
};

type UpdateStatus = {
  checking: boolean;
  available: boolean;
  upToDate: boolean;
  version?: string;
  downloaded: boolean;
  downloading: boolean;
  progress?: number;
  error?: string;
  lastCheckedAt?: number;
};

const eventPort = 17321;
const appStartedAt = Date.now();
const singleInstanceLock = app.requestSingleInstanceLock();
let petWindow: BrowserWindow | null = null;
let petDragWatcher: PetDragWatcher | null = null;
let panelWindow: BrowserWindow | null = null;
let trayMenuWindow: BrowserWindow | null = null;
// The transparent pet window grows upward for larger pets and permission
// cards while keeping the character anchored to the same desktop position.
let petExpanded = false;
let eventServer: ReturnType<typeof createServer> | null = null;
const dshRuntimeSnapshots = new DshRuntimeSnapshotSet();
const desiredDshResources = new DshDesiredResourceState();
let dshSkillMarketplaceInstance: DshSkillMarketplace | null = null;
let tray: Tray | null = null;
let startupWarmupTimer: ReturnType<typeof setTimeout> | null = null;
let startupWarmupStarted = false;
let currentState: PetState = "idle";
let eventHistory: PetEvent[] = [];
let runtimeStats: RuntimeStats | null = null;
let runtimeStatsDirty = false;
let runtimeStatsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let companionSettingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoUpdaterConfigured = false;
let updateStatus: UpdateStatus = {
  checking: false,
  available: false,
  upToDate: false,
  downloaded: false,
  downloading: false
};
let companionSettings: Record<string, any> = createDefaultCompanionSettings();

// pet-asset:// serves installed pet-pack spritesheets to the renderer. The
// scheme must be registered before app ready; the handler is installed in
// whenReady and only ever resolves files inside the pets directory.
protocol.registerSchemesAsPrivileged([
  { scheme: "pet-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showPetWindow();
    if (companionSettings.openSettingsOnStart) showPanelWindow();
  });
}

// Displayed image height of the active theme: pack cells keep the pet's
// width but may be taller than the built-in 192px square.
function activePetImageHeight(): number {
  const packId = packIdFromThemeId(companionSettings.petTheme);
  if (!packId) return PET_IMAGE_SIZE;
  const pack = readPetPack(petPacksDir(), packId);
  if (!pack) return PET_IMAGE_SIZE;
  return displayedSpriteHeight(pack.sheet.cellWidth, pack.sheet.cellHeight, PET_IMAGE_SIZE);
}

function getPetWindowBounds() {
  const width = getPetWindowWidth(companionSettings.feedbackScale, companionSettings.permissionScale);
  const height = getPetWindowHeight(companionSettings.petScale, false, companionSettings.feedbackScale, activePetImageHeight());
  const cursorPoint = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursorPoint).workArea;

  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24
  };
}

/**
 * Grow / shrink the pet window while keeping its bottom edge fixed, so the
 * character stays put and the extra height opens up above it for the bubble.
 */
function setPetWindowExpanded(expanded: boolean, force = false) {
  if (!petWindow || petWindow.isDestroyed()) {
    petExpanded = false;
    return;
  }
  if (expanded === petExpanded && !force) return;
  const bounds = petWindow.getBounds();
  const bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const width = getPetWindowWidth(companionSettings.feedbackScale, companionSettings.permissionScale);
  const activeBubbleScale = expanded ? companionSettings.permissionScale : companionSettings.feedbackScale;
  const height = getPetWindowHeight(companionSettings.petScale, expanded, activeBubbleScale, activePetImageHeight());
  const workArea = screen.getDisplayNearestPoint({ x: bounds.x, y: bottom }).workArea;
  const y = Math.max(workArea.y, bottom - height);
  // Keep the character put: pin the bottom edge and the horizontal centre while
  // the window grows for a scaled bubble, clamped so it stays on-screen.
  const x = Math.max(workArea.x, Math.min(Math.round(centerX - width / 2), workArea.x + workArea.width - width));
  petDragWatcher?.noteProgrammaticMove();
  petWindow.setBounds({ x, y, width, height });
  petExpanded = expanded;
}

function rendererUrl(view?: "panel" | "traymenu") {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (!devServerUrl) return null;
  return view ? `${devServerUrl}?view=${view}` : devServerUrl;
}

function loadRenderer(window: BrowserWindow, view?: "panel" | "traymenu") {
  const url = rendererUrl(view);
  if (url) {
    window.loadURL(url);
    return;
  }

  window.loadFile(join(__dirname, "../../dist/index.html"), view ? { query: { view } } : undefined);
}

function getAppIcon() {
  const candidates = [
    join(__dirname, "../../src/main/assets/kuaclock.png"),
    join(process.cwd(), "src/main/assets/kuaclock.png"),
    join(process.resourcesPath ?? "", "kuaclock.png")
  ];
  const iconPath = candidates.find(candidate => candidate && existsSync(candidate));
  if (!iconPath) return createTrayIcon();
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? createTrayIcon() : image;
}

function isPetEnabled() {
  return companionSettings.petEnabled !== false;
}

function isPetAlwaysOnTop() {
  return companionSettings.alwaysOnTop === true;
}

function applyPetAlwaysOnTopSetting() {
  if (!petWindow || petWindow.isDestroyed()) return;

  if (isPetAlwaysOnTop()) {
    petWindow.setAlwaysOnTop(true, "screen-saver");
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    return;
  }

  petWindow.setAlwaysOnTop(false);
  petWindow.setVisibleOnAllWorkspaces(false);
}

// The user's Windows double-click settings (speed + rectangle), read once via the
// trusted System32 reg.exe so the pet's reconstructed double-click matches the user's
// mouse settings (see readSystemDoubleClickMetrics — never a cwd-local reg.exe).
let cachedDoubleClickMetrics: DoubleClickMetrics | null = null;
function systemDoubleClickMetrics(): DoubleClickMetrics {
  if (cachedDoubleClickMetrics === null) cachedDoubleClickMetrics = readSystemDoubleClickMetrics(process.env);
  return cachedDoubleClickMetrics;
}

// Windows implements skipTaskbar as a one-shot ITaskbarList::DeleteTab, and the
// shell can silently re-add the tab later — most commonly when explorer.exe
// restarts and re-registers every top-level window. Electron never re-asserts
// the flag, so a resurrected tab would sit in the taskbar until the app quits.
// Re-asserting on the events ordinary interaction inevitably fires keeps the
// window self-healing; repeat calls are cheap no-ops.
function keepOutOfTaskbar(window: BrowserWindow) {
  const reassert = () => {
    if (!window.isDestroyed()) window.setSkipTaskbar(true);
  };
  window.on("show", reassert);
  window.on("focus", reassert);
  window.on("restore", reassert);
}

function createPetWindow() {
  if (!isPetEnabled()) return;
  if (petWindow && !petWindow.isDestroyed()) return;

  const bounds = getPetWindowBounds();
  const alwaysOnTop = isPetAlwaysOnTop();

  petWindow = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    alwaysOnTop,
    resizable: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    skipTaskbar: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.setBackgroundColor("#00000000");
  keepOutOfTaskbar(petWindow);
  applyPetAlwaysOnTopSetting();
  loadRenderer(petWindow);

  // Native OS drag moves the window (-webkit-app-region: drag on the pet
  // element); main only watches the move stream to derive the walk
  // direction for the codex-pet locomotion rows.
  petDragWatcher?.dispose();
  const [initialX, initialY] = petWindow.getPosition();
  petDragWatcher = createPetDragWatcher({
    initial: { x: initialX, y: initialY },
    onDirection: direction => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("companion:pet-drag-direction", direction);
      }
    }
  });
  petWindow.on("move", () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    petDragWatcher?.onMove(x, y);
  });
  petWindow.on("moved", () => petDragWatcher?.onMoveEnd());

  // Double-click the pet to summon the panel. Electron delivers the pet's
  // drag-region clicks to Chromium's child window, so the outer window only sees
  // WM_PARENTNOTIFY — reconstruct the double-click from two of those (system timing
  // + a small distance), then let the renderer hit-test the point against the actual
  // pet element so the bubble / card / Allow-Deny buttons / transparent background
  // are excluded and native dragging is preserved (see petDoubleClick.ts +
  // petHitTest.ts). Registered once per window; the hook is released when the window
  // is destroyed, so recreations don't stack handlers.
  if (process.platform === "win32") {
    // Match Windows' double-click rectangle (SM_CXDOUBLECLK/SM_CYDOUBLECLK): the
    // registry width/height are logical px, so scale to the window's display and use
    // the half-extent per axis. WM_PARENTNOTIFY coordinates are physical px.
    const metrics = systemDoubleClickMetrics();
    const scale = screen.getDisplayMatching(petWindow.getBounds()).scaleFactor || 1;
    const doubleClick = createDoubleClickDetector({
      doubleClickMs: metrics.speedMs,
      maxDistanceX: (metrics.width * scale) / 2,
      maxDistanceY: (metrics.height * scale) / 2,
      now: () => Date.now()
    });
    installPetParentNotifyWatcher(petWindow, doubleClick, (x, y) => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("companion:pet-doubleclick-probe", { x, y });
      }
    });
    // A native drag moves the window; cancel the pending first click so a post-drag
    // click isn't mis-paired into a double-click (during a drag the cursor can stay at
    // the same client-relative point over the moving window).
    petWindow.on("move", () => doubleClick.reset());
  }

  petWindow.on("closed", () => {
    petDragWatcher?.dispose();
    petDragWatcher = null;
    petWindow = null;
  });
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow;

  panelWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    show: false,
    paintWhenInitiallyHidden: true,
    title: "DSH Desk",
    frame: false,
    backgroundColor: panelWindowBackgroundColor(),
    autoHideMenuBar: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  loadRenderer(panelWindow, "panel");
  panelWindow.on("closed", () => {
    panelWindow = null;
  });

  return panelWindow;
}

function panelWindowBackgroundColor() {
  if (companionSettings.theme === "dark") return "#15110e";
  if (companionSettings.theme === "light") return "#f6efe1";
  return "#f3fbfd";
}

function companionInitialState(): CompanionInitialState {
  const activePackId = packIdFromThemeId(companionSettings.petTheme);
  const activePack = activePackId ? readPetPack(petPacksDir(), activePackId) : undefined;
  return {
    settings: companionSettings as CompanionInitialState["settings"],
    petPacks: activePack ? [activePack] : []
  };
}

function showPanelWindow() {
  const window = createPanelWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function hidePanelWindow() {
  panelWindow?.hide();
}

function warmPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) return;
  createPanelWindow();
}

function togglePanelWindow() {
  if (panelWindow?.isVisible()) {
    hidePanelWindow();
  } else {
    showPanelWindow();
  }
}

function createTrayIcon() {
  const size = 16;
  const center = (size - 1) / 2;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const distance = Math.hypot(x - center, y - center);
      const inside = distance <= 7;
      pixels[offset] = inside ? 255 : 0;
      pixels[offset + 1] = inside ? 190 : 0;
      pixels[offset + 2] = inside ? 72 : 0;
      pixels[offset + 3] = inside ? 255 : 0;
    }
  }

  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 });
}

function showPetWindow() {
  if (!isPetEnabled()) {
    hidePetWindow();
    return;
  }

  if (!petWindow) createPetWindow();
  if (!petWindow) return;

  petDragWatcher?.noteProgrammaticMove();
  petWindow.setBounds(getPetWindowBounds());
  petExpanded = false;
  if (permissionBroker.size > 0) setPetWindowExpanded(true);
  petWindow.setOpacity(1);
  petWindow.setIgnoreMouseEvents(false);
  if (petWindow.isMinimized()) petWindow.restore();
  petWindow.show();
  petWindow.focus();
  applyPetAlwaysOnTopSetting();
  if (isPetAlwaysOnTop()) petWindow.moveTop();
}

function hidePetWindow() {
  petWindow?.hide();
}

function togglePetWindow() {
  if (!isPetEnabled()) return;

  if (petWindow?.isVisible()) {
    hidePetWindow();
  } else {
    showPetWindow();
  }
}

// Custom tray popup instead of a native context menu: Win32 menus reserve
// checkmark/accelerator gutters and use OS-fixed item metrics, which reads
// as glitchy dead space next to two-character labels — and Electron exposes
// no control over any of it. This window is app-styled, localized, and reads
// its state fresh each time it opens.
// The window holds the main menu column plus a submenu column beside it (the
// Switch pet flyout). Sized generously and laid out with flexbox inside — the
// spare area is transparent + dismiss-on-click, so these needn't be pixel
// exact. The submenu scrolls within the fixed height rather than growing it.
const TRAY_MENU_METRICS: TrayMenuMetrics = { mainWidth: 184, submenuWidth: 184, height: 160 };

// The horizontal side the submenu opened on, chosen per-present by
// trayMenuLayout and forwarded to the renderer so its flyout matches.
let traySubmenuSide: TraySubmenuSide = "left";

// Electron-owned timers behind the tray popup's presentation state machine
// (trayMenuController). The controller holds the boolean state; these are the
// side-effect resources it cannot.
let trayMenuBlurHideTimer: ReturnType<typeof setTimeout> | null = null;
let trayMenuPresentFallback: ReturnType<typeof setTimeout> | null = null;

function cancelTrayMenuBlurHide() {
  if (trayMenuBlurHideTimer !== null) {
    clearTimeout(trayMenuBlurHideTimer);
    trayMenuBlurHideTimer = null;
  }
}

function clearTrayMenuPresentFallback() {
  if (trayMenuPresentFallback !== null) {
    clearTimeout(trayMenuPresentFallback);
    trayMenuPresentFallback = null;
  }
}

// The switchable pets for the tray submenu: the built-in theme plus every
// installed codex-pet pack, in registry order, with the active one flagged.
function trayMenuPets(): Array<{ id: string; name: string; active: boolean }> {
  const active = typeof companionSettings.petTheme === "string" ? companionSettings.petTheme : BUILTIN_PET_THEME_ID;
  const pets = [
    { id: BUILTIN_PET_THEME_ID, name: BUILTIN_PET_THEME_NAME },
    ...listPetPacks(petPacksDir()).map(pack => ({ id: petPackThemeId(pack.id), name: pack.displayName }))
  ];
  // If the stored theme no longer resolves (pack removed), the built-in is the
  // effective active one — mirror resolveThemeCatalog's fallback.
  const activeExists = pets.some(pet => pet.id === active);
  return pets.map(pet => ({ ...pet, active: activeExists ? pet.id === active : pet.id === BUILTIN_PET_THEME_ID }));
}

function trayMenuState() {
  return {
    petVisible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
    panelVisible: Boolean(panelWindow && !panelWindow.isDestroyed() && panelWindow.isVisible()),
    petEnabled: isPetEnabled(),
    dark: nativeTheme.shouldUseDarkColors,
    language: companionSettings.language,
    pets: trayMenuPets(),
    submenuSide: traySubmenuSide
  };
}

// Both the renderer's paint handshake and the fallback timer settle a pending
// presentation through here.
function completeTrayMenuPresent() {
  trayMenuController.onPresentSettled();
}

// Presentation state machine (src/main/trayMenuController.ts). Effects:
//  - present: position at the cursor, push fresh state, and arm the fallback
//    that reveals the window even if the renderer's paint signal is lost. The
//    window stays hidden here (present-on-painted) so a reopen never flashes
//    an evicted GPU surface.
//  - reveal / conceal: alpha the already-composited window in / out; conceal
//    never calls hide(), which would let Chromium evict the surface.
const trayMenuController = createTrayMenuController({
  present: () => {
    if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const workArea = screen.getDisplayNearestPoint(cursor).workArea;
    const layout = trayMenuLayout(cursor, TRAY_MENU_METRICS, workArea);
    traySubmenuSide = layout.submenuSide;
    trayMenuWindow.setBounds(layout.bounds);
    clearTrayMenuPresentFallback();
    trayMenuPresentFallback = setTimeout(completeTrayMenuPresent, 150);
    trayMenuWindow.webContents.send("companion:tray-menu-state", trayMenuState());
  },
  reveal: () => {
    if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
    trayMenuWindow.setIgnoreMouseEvents(false);
    trayMenuWindow.setOpacity(1);
    if (!trayMenuWindow.isVisible()) trayMenuWindow.show();
    trayMenuWindow.focus();
  },
  conceal: () => {
    if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
    trayMenuWindow.setOpacity(0);
    trayMenuWindow.setIgnoreMouseEvents(true);
    trayMenuWindow.blur();
  },
  clearPresentFallback: clearTrayMenuPresentFallback,
  clearBlurHide: cancelTrayMenuBlurHide
});

function createTrayMenuWindow() {
  if (trayMenuWindow && !trayMenuWindow.isDestroyed()) return;

  trayMenuWindow = new BrowserWindow({
    width: TRAY_MENU_METRICS.mainWidth + TRAY_MENU_METRICS.submenuWidth,
    height: TRAY_MENU_METRICS.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The popup paints WHILE HIDDEN: after a hide, Chromium treats the
      // window as occluded and evicts its frames, so a plain show() flashes
      // stale/empty pixels before the repaint lands (the reopen flicker).
      // With throttling off, the renderer keeps compositing and the
      // rendered-handshake below can complete before the window is shown.
      backgroundThrottling: false
    }
  });

  keepOutOfTaskbar(trayMenuWindow);
  loadRenderer(trayMenuWindow, "traymenu");
  // Any (re)load invalidates the renderer's subscription until it hands
  // shakes again.
  trayMenuWindow.webContents.on("did-start-loading", () => {
    trayMenuController.notifyReloading();
  });
  // A popup menu's contract: clicking anywhere else dismisses it. But a blur
  // caused by clicking the app's OWN tray icon is not "clicking away" — the
  // mousedown blurs the popup before the tray event fires, and hiding here
  // made the incoming right-click close-then-reopen the menu (a visible
  // flicker). For that case the hide is deferred: the tray event that
  // follows either refreshes the menu in place (right-click) or hides it
  // (left-click); the timer only fires if no tray event arrives at all
  // (mousedown dragged off the icon).
  trayMenuWindow.on("blur", () => {
    if (tray && pointInBounds(screen.getCursorScreenPoint(), tray.getBounds())) {
      cancelTrayMenuBlurHide();
      trayMenuBlurHideTimer = setTimeout(hideTrayMenu, 300);
      return;
    }
    hideTrayMenu();
  });
  trayMenuWindow.on("closed", () => {
    trayMenuController.reset();
    trayMenuWindow = null;
  });
}

function hideTrayMenu() {
  trayMenuController.dismiss();
}

function showTrayMenu() {
  createTrayMenuWindow();
  if (!trayMenuWindow) return;
  trayMenuController.requestShow();
}

function createTray() {
  const trayIcon = getAppIcon().resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip("DSH Desk");

  tray.on("click", () => {
    // A left-click while the menu is open (its deferred blur-hide pending)
    // dismisses the menu, then toggles the pet as usual.
    hideTrayMenu();
    showPetWindow();
  });
  tray.on("right-click", showTrayMenu);
}

function broadcastUpdateStatus() {
  petWindow?.webContents.send("companion:update-status", updateStatus);
  panelWindow?.webContents.send("companion:update-status", updateStatus);
}

function setUpdateStatus(next: UpdateStatus) {
  updateStatus = next;
  broadcastUpdateStatus();
}

function configureAutoUpdater() {
  if (autoUpdaterConfigured) return;
  autoUpdaterConfigured = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "Renakoni",
    repo: "dsh-desk",
    releaseType: "release"
  });

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({
      ...updateStatus,
      checking: true,
      error: undefined,
      lastCheckedAt: Date.now()
    });
  });

  autoUpdater.on("update-available", info => {
    setUpdateStatus({
      ...updateStatus,
      checking: false,
      available: true,
      upToDate: false,
      version: info.version
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({
      checking: false,
      available: false,
      upToDate: true,
      downloaded: false,
      downloading: false,
      progress: undefined,
      version: undefined,
      error: undefined,
      lastCheckedAt: Date.now()
    });
  });

  autoUpdater.on("download-progress", progress => {
    setUpdateStatus({
      ...updateStatus,
      checking: false,
      downloading: true,
      progress: progress.percent
    });
  });

  autoUpdater.on("update-downloaded", info => {
    setUpdateStatus({
      checking: false,
      available: true,
      upToDate: false,
      version: info.version,
      downloaded: true,
      downloading: false,
      progress: 100,
      error: undefined,
      lastCheckedAt: Date.now()
    });
  });

  autoUpdater.on("error", error => {
    setUpdateStatus({
      ...updateStatus,
      checking: false,
      downloading: false,
      error: error.message,
      lastCheckedAt: Date.now()
    });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    const error = "Update checks are only available in packaged builds.";
    setUpdateStatus({
      ...updateStatus,
      checking: false,
      downloading: false,
      error,
      lastCheckedAt: Date.now()
    });
    return { ok: false, error };
  }

  configureAutoUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    return result ? { ok: true } : { ok: false, error: "No update metadata was returned." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateStatus({
      ...updateStatus,
      checking: false,
      downloading: false,
      error: message,
      lastCheckedAt: Date.now()
    });
    return { ok: false, error: message };
  }
}

function installUpdate() {
  if (!app.isPackaged) {
    return { ok: false, error: "Update installation is only available in packaged builds." };
  }
  if (!updateStatus.downloaded) {
    return { ok: false, error: "No downloaded update is ready to install." };
  }

  try {
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function applyLaunchAtLoginSetting() {
  const openAtLogin = companionSettings.launchAtLogin === true;
  const options = app.isPackaged
    ? { openAtLogin, path: process.execPath }
    : { openAtLogin, path: process.execPath, args: [app.getAppPath()] };

  try {
    app.setLoginItemSettings(options);
  } catch {
    // Login item support is platform and build dependent.
  }
}

function runStartupBehaviors() {
  if (process.platform === "win32") {
    // Windows shell / taskbar / notification identity. When packaging is
    // configured, the installer's shortcut AppUserModelID (electron-builder
    // `appId`) MUST match this string, or toast notifications won't group
    // under the app.
    app.setAppUserModelId("DSHDesk");
  }
  applyLaunchAtLoginSetting();
  if (companionSettings.openSettingsOnStart) showPanelWindow();
  scheduleStartupWarmup();
  if (companionSettings.autoUpdateEnabled && app.isPackaged) {
    setTimeout(() => void checkForUpdates(), 1500);
  }
}

function scheduleStartupWarmup() {
  if (startupWarmupStarted || startupWarmupTimer) return;
  startupWarmupTimer = setTimeout(runStartupWarmup, isPetEnabled() ? 2000 : 150);
}

function runStartupWarmup() {
  if (startupWarmupStarted) return;
  startupWarmupStarted = true;
  if (startupWarmupTimer) {
    clearTimeout(startupWarmupTimer);
    startupWarmupTimer = null;
  }
  warmPanelWindow();
  setTimeout(() => void getStats(), 500);
  setTimeout(() => void getClaudeTokenStats(false).catch(() => {}), 5000);
  setInterval(() => void getClaudeTokenStats(false).catch(() => {}), 60 * 60 * 1000).unref();
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": EVENT_SERVER_DEV_ORIGIN,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function getSnapshot() {
  return {
    state: currentState,
    events: eventHistory,
    startedAt: appStartedAt,
    eventPort
  };
}

const sessionId = "local-pet-session";

type CompanionEventType = "session_start" | "prompt_submit" | "tool_start" | "tool_end" | "notification" | "permission_wait" | "done" | "error" | "heartbeat" | "git_operation";

type CompanionEvent = {
  id: string;
  source: "claude-code" | "deepseek-harness" | "codex" | "cc-haha" | "manual";
  event: CompanionEventType;
  sessionId?: string;
  clientType?: "cli" | "desktop" | "vscode" | "unknown";
  clientLabel?: string;
  tool?: string;
  notificationKind?: NotificationKind;
  cwd?: string;
  title: string;
  message: string;
  detail?: string;
  timestamp: number;
};

type ManagedNotificationEventType = "done" | "error" | "permission_wait" | "notification";
type SoundNotificationEventType = Exclude<ManagedNotificationEventType, "notification">;
type BuiltInSound = "done" | "error" | "permission";

type NotificationRule = {
  eventType: CompanionEventType;
  enabled: boolean;
  playSound: boolean;
};

function normalizeTool(tool?: string) {
  if (!tool) return "Unknown";
  const normalized = tool.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("pwsh") || normalized.includes("powershell")) return "Bash";
  if (normalized.includes("edit") || normalized.includes("replace")) return "Edit";
  if (normalized.includes("write")) return "Write";
  if (normalized.includes("read")) return "Read";
  if (normalized.includes("grep")) return "Grep";
  if (normalized.includes("glob")) return "Glob";
  if (normalized.includes("webfetch")) return "WebFetch";
  if (normalized.includes("websearch") || normalized.includes("search")) return "WebSearch";
  if (normalized.includes("notebook")) return "Notebook";
  if (normalized.includes("agent")) return "Agent";
  if (normalized.includes("skill")) return "Skill";
  if (normalized.includes("task") || normalized.includes("todo")) return "Task";
  if (normalized.includes("mcp")) return "MCP";
  return "Unknown";
}

function toCompanionEvent(event: PetEvent): CompanionEvent {
  const mappedEvent: CompanionEventType = event.notificationKind === "attention" || event.notificationKind === "info"
    // Both are display-only "notification" events; the toast is suppressed for
    // "info" in handleCompanionAlerts so only "attention" raises a system alert.
    ? "notification"
    : event.event === "idle"
    // Only the SessionStart hook's idle marks a real session; other idle events
    // (e.g. an idle-prompt Notification) must not inflate the session count.
    ? (isSessionStartEvent(event) ? "session_start" : "heartbeat")
    : event.event === "permission-prompt"
      ? "permission_wait"
      : event.event === "completed"
        ? "done"
        : event.event === "error"
          ? "error"
          : event.title === "Tool completed"
            ? "tool_end"
            : event.tool
              ? "tool_start"
              : "prompt_submit";

  return {
    id: event.id,
    source: event.source ?? "manual",
    event: mappedEvent,
    sessionId: event.sessionId ?? sessionId,
    clientType: event.source === "deepseek-harness" ? "cli" : "desktop",
    clientLabel: event.source === "deepseek-harness" ? "DeepSeek Harness" : "DSH Desk",
    tool: event.tool ? normalizeTool(event.tool) : undefined,
    notificationKind: event.notificationKind,
    title: event.title ?? event.event,
    message: event.message ?? event.detail ?? event.title ?? event.event,
    detail: event.detail,
    timestamp: event.timestamp
  };
}

const managedNotificationEventTypes: ManagedNotificationEventType[] = ["done", "error", "permission_wait", "notification"];
const soundNotificationEventTypes: SoundNotificationEventType[] = ["done", "error", "permission_wait"];
const defaultWindowsSoundNames: Record<BuiltInSound, string[]> = {
  done: ["Windows Notify Calendar.wav", "notify.wav"],
  error: ["Windows Error.wav", "Windows Critical Stop.wav"],
  permission: ["Windows Notify System Generic.wav", "Windows Exclamation.wav"]
};
const soundDataUrlCache = new Map<string, string>();

function isManagedNotificationEvent(eventType: CompanionEventType): eventType is ManagedNotificationEventType {
  return managedNotificationEventTypes.includes(eventType as ManagedNotificationEventType);
}

function isSoundNotificationEvent(eventType: CompanionEventType): eventType is SoundNotificationEventType {
  return soundNotificationEventTypes.includes(eventType as SoundNotificationEventType);
}

function defaultNotificationRule(eventType: ManagedNotificationEventType): NotificationRule {
  return {
    eventType,
    enabled: true,
    playSound: isSoundNotificationEvent(eventType)
  };
}

function getNotificationRule(eventType: ManagedNotificationEventType): NotificationRule {
  const rules = Array.isArray(companionSettings.notificationRules) ? companionSettings.notificationRules as NotificationRule[] : [];
  const rule = rules.find(item => item?.eventType === eventType);
  return rule ? { ...defaultNotificationRule(eventType), ...rule, eventType } : defaultNotificationRule(eventType);
}

function builtInSoundNameForEvent(eventType: SoundNotificationEventType): BuiltInSound {
  if (eventType === "permission_wait") return "permission";
  return eventType;
}

function isBuiltInSound(value: unknown): value is BuiltInSound {
  return value === "done" || value === "error" || value === "permission";
}

function windowsMediaSoundPath(name: BuiltInSound): string | null {
  if (process.platform !== "win32") return null;
  for (const fileName of defaultWindowsSoundNames[name]) {
    const candidate = join("C:\\Windows\\Media", fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isAudioPath(filePath: string): boolean {
  return /\.(wav|mp3)$/i.test(filePath);
}

function resolveSoundFile(override: string | null | undefined, name: BuiltInSound): string | null {
  if (override) {
    const candidate = isAbsolute(override) ? override : resolve(app.getAppPath(), override);
    return existsSync(candidate) && isAudioPath(candidate) ? candidate : null;
  }
  return windowsMediaSoundPath(name);
}

function fileToDataUrl(filePath: string): string | null {
  if (!isAudioPath(filePath) || !existsSync(filePath)) return null;
  const cached = soundDataUrlCache.get(filePath);
  if (cached) {
    soundDataUrlCache.delete(filePath);
    soundDataUrlCache.set(filePath, cached);
    return cached;
  }

  try {
    const buffer = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime = ext === ".mp3" ? "audio/mpeg" : "audio/wav";
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    if (soundDataUrlCache.size >= 8) {
      const oldest = soundDataUrlCache.keys().next().value;
      if (oldest) soundDataUrlCache.delete(oldest);
    }
    soundDataUrlCache.set(filePath, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

function soundOverrideForEvent(eventType: SoundNotificationEventType): string | null {
  const sound = companionSettings.sound ?? {};
  const eventOverride = sound.eventFiles?.[eventType];
  if (typeof eventOverride === "string" && eventOverride.trim()) return eventOverride;
  if (eventType === "done") return sound.fileDone ?? null;
  if (eventType === "error") return sound.fileError ?? null;
  if (eventType === "permission_wait") return sound.filePermission ?? null;
  return null;
}

function soundDataUrlForEvent(eventType: SoundNotificationEventType): string | null {
  const sound = companionSettings.sound ?? {};
  if (sound.enabled !== true) return null;
  const file = resolveSoundFile(soundOverrideForEvent(eventType), builtInSoundNameForEvent(eventType));
  return file ? fileToDataUrl(file) : null;
}

function previewSoundDataUrl(name: BuiltInSound) {
  const file = resolveSoundFile(null, name);
  const dataUrl = file ? fileToDataUrl(file) : null;
  return dataUrl ? { ok: true, dataUrl } : { ok: false, error: "Sound file not found." };
}

function previewSoundFile(filePath: string) {
  const dataUrl = fileToDataUrl(filePath);
  return dataUrl ? { ok: true, dataUrl } : { ok: false, error: "Unable to read audio file." };
}

function playSoundDataUrl(dataUrl: string) {
  const targetWindow = petWindow && !petWindow.isDestroyed() ? petWindow : panelWindow;
  targetWindow?.webContents.send("companion:play-sound", dataUrl);
}

function notificationBody(event: CompanionEvent): string {
  const lines = [event.message];
  if (event.tool) lines.push(`Tool: ${event.tool}`);
  if (event.detail && event.detail !== event.message) lines.push(event.detail);
  return lines.filter(Boolean).join("\n").slice(0, 300);
}

function showWindowsNotification(event: CompanionEvent) {
  if (process.platform !== "win32" || !Notification.isSupported()) return;
  new Notification({
    title: event.title || "DSH Desk",
    body: notificationBody(event),
    icon: getAppIcon(),
    silent: true
  }).show();
}

function handleCompanionAlerts(event: CompanionEvent) {
  if (!isManagedNotificationEvent(event.event)) return;

  const rule = getNotificationRule(event.event);

  // "info" notifications are transient bubble-only notices — surface them in the
  // pet, but never as a system toast. Only "attention" (and the other managed
  // events) raise a Windows notification.
  if (companionSettings.notificationsEnabled !== false && event.notificationKind !== "info") {
    const configuredLanguage = companionSettings.language;
    const displayLanguage = configuredLanguage === "zh" || (configuredLanguage === "auto" && app.getLocale().toLowerCase().startsWith("zh")) ? "zh" : "en";
    showWindowsNotification(companionSettings.hideSensitiveContent ? redactDisplayEvent(event, displayLanguage) : event);
  }

  if (isSoundNotificationEvent(event.event) && rule.enabled !== false && rule.playSound !== false) {
    const dataUrl = soundDataUrlForEvent(event.event);
    if (dataUrl) playSoundDataUrl(dataUrl);
  }
}

type ClaudeInstalledPluginEntry = Record<string, unknown> & {
  scope?: string;
  installPath?: string;
  path?: string;
  version?: string;
  description?: string;
  enabled?: boolean;
};

function getClaudePaths() {
  const home = homedir();
  return {
    claudeDir: join(home, ".claude"),
    claudeJson: join(home, ".claude.json"),
    projectsDir: join(home, ".claude", "projects")
  };
}

function claudeProfilesPath() {
  return join(app.getPath("userData"), "claude-profiles.json");
}

function claudeMcpInventoryPath() {
  return join(app.getPath("userData"), "claude-mcp-inventory.json");
}

function dshResourceSchemesPath() {
  return join(app.getPath("userData"), "dsh-resource-schemes.json");
}

function dshSkillRepositoriesPath() {
  return join(app.getPath("userData"), "dsh-skill-repositories.json");
}

const CLAUDE_RESOURCE_CACHE_TTL = 30 * 1000;
let claudeResourceCache: { data: ClaudeResourcesSnapshot; timestamp: number } | null = null;
let pendingClaudeResourceScan: Promise<ClaudeResourcesSnapshot> | null = null;
let queuedForcedClaudeResourceScan: {
  after: Promise<ClaudeResourcesSnapshot>;
  result: Promise<ClaudeResourcesSnapshot>;
} | null = null;

function readTextIfExists(filePath: string) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return "";
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const text = readTextIfExists(filePath);
    if (!text.trim()) return null;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isDirectoryPath(dirPath: string) {
  try {
    return statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function extractMarkdownDescription(markdown: string) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const description = frontmatter[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
    if (description) return description;
  }

  return markdown
    .replace(/^---[\s\S]*?---/, "")
    .split(/\n\s*\n/)
    .map(block => block.replace(/^#+\s*/gm, "").trim())
    .find(Boolean);
}

function readClaudeEnabledPlugins(claudeDir: string): Record<string, boolean> | null {
  const settings = readJsonObject(join(claudeDir, "settings.json"));
  const enabledPlugins = settings?.enabledPlugins;
  if (!enabledPlugins || typeof enabledPlugins !== "object" || Array.isArray(enabledPlugins)) return null;
  return enabledPlugins as Record<string, boolean>;
}

function readClaudeSkillOverrides(claudeDir: string): Record<string, unknown> {
  const settings = readJsonObject(join(claudeDir, "settings.json"));
  const overrides = settings?.skillOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return {};
  return overrides as Record<string, unknown>;
}

function readClaudeInstalledPlugins(claudeDir: string): Record<string, unknown> | null {
  const registry = readJsonObject(join(claudeDir, "plugins", "installed_plugins.json"));
  const plugins = registry?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return null;
  return plugins as Record<string, unknown>;
}

function normalizeInstalledPluginEntries(value: unknown): ClaudeInstalledPluginEntry[] {
  if (Array.isArray(value)) return value.filter(entry => entry && typeof entry === "object" && !Array.isArray(entry)) as ClaudeInstalledPluginEntry[];
  if (value && typeof value === "object") return [value as ClaudeInstalledPluginEntry];
  return [];
}

function scanSkillDirectory(
  skillDir: string,
  name: string,
  detail = "SKILL.md",
  skillSource: ClaudeResourceItem["skillSource"] = "personal",
  pluginId?: string,
  enabled = true
): ClaudeResourceItem | null {
  const skillFile = join(skillDir, "SKILL.md");
  const markdown = readTextIfExists(skillFile);
  if (!markdown) return null;
  return {
    id: `skill:${name}`,
    kind: "skill" as const,
    name,
    description: extractMarkdownDescription(markdown),
    path: skillDir,
    enabled,
    source: "claude" as const,
    detail,
    skillSource,
    ...(pluginId ? { pluginId } : {})
  };
}

function scanClaudeSkills(
  claudeDir: string,
  enabledPluginsInput?: Record<string, boolean> | null,
  installedPluginsInput?: Record<string, unknown> | null,
  skillOverridesInput?: Record<string, unknown>
): ClaudeResourceItem[] {
  const found = new Map<string, ClaudeResourceItem>();
  const skillsDir = join(claudeDir, "skills");
  try {
    const skillOverrides = skillOverridesInput ?? readClaudeSkillOverrides(claudeDir);
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        const skillDir = join(skillsDir, entry.name);
        if (!isDirectoryPath(skillDir)) continue;
        const item = scanSkillDirectory(skillDir, entry.name, "SKILL.md", "personal", undefined, skillOverrides[entry.name] !== "off");
        if (item) found.set(item.id, item);
      }
    }

    const enabledPlugins = enabledPluginsInput ?? readClaudeEnabledPlugins(claudeDir) ?? {};
    const installedPlugins = installedPluginsInput ?? readClaudeInstalledPlugins(claudeDir) ?? {};
    for (const [pluginName, enabled] of Object.entries(enabledPlugins)) {
      if (enabled !== true) continue;
      for (const entry of normalizeInstalledPluginEntries(installedPlugins[pluginName])) {
        const installPath = typeof entry.installPath === "string" ? entry.installPath : typeof entry.path === "string" ? entry.path : "";
        const pluginSkillsDir = installPath ? join(installPath, "skills") : "";
        if (!pluginSkillsDir || !isDirectoryPath(pluginSkillsDir)) continue;
        for (const skillEntry of readdirSync(pluginSkillsDir, { withFileTypes: true })) {
          const skillDir = join(pluginSkillsDir, skillEntry.name);
          if (!isDirectoryPath(skillDir)) continue;
          const item = scanSkillDirectory(skillDir, skillEntry.name, `plugin: ${pluginName}`, "plugin", pluginName);
          if (item && !found.has(item.id)) found.set(item.id, item);
        }
      }
    }
  } catch {
    // Return whatever was discovered before an unreadable plugin or skill directory.
  }

  return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePluginScope(value: unknown): ClaudePluginScope {
  return value === "user" || value === "project" || value === "local" ? value : "unknown";
}

function scanClaudePlugins(claudeDir: string, enabledPluginsInput?: Record<string, boolean> | null, registryPluginsInput?: Record<string, unknown> | null): ClaudeResourceItem[] {
  const pluginsDir = join(claudeDir, "plugins");
  const registryPlugins = registryPluginsInput ?? readClaudeInstalledPlugins(claudeDir);
  if (registryPlugins) {
    const enabledPlugins = enabledPluginsInput ?? readClaudeEnabledPlugins(claudeDir);
    return Object.entries(registryPlugins)
      .map(([name, value]) => {
        const entries = normalizeInstalledPluginEntries(value);
        const first = entries[0] ?? {};
        const version = entries.find(entry => typeof entry.version === "string")?.version;
        const scopes = Array.from(new Set(entries.map(entry => normalizePluginScope(entry.scope))));
        const visibleScopes = scopes.filter(scope => scope !== "unknown");
        const hasUserScope = entries.some(entry => entry.scope === "user");
        const enabledAtUserScope = enabledPlugins?.[name] === true;
        const path = typeof first.installPath === "string" ? first.installPath : typeof first.path === "string" ? first.path : pluginsDir;
        return {
          id: `plugin:${name}`,
          kind: "plugin" as const,
          name,
          description: typeof first.description === "string" ? first.description : undefined,
          path,
          enabled: hasUserScope
            ? enabledAtUserScope
            : (enabledPlugins ? enabledPlugins[name] === true : entries.every(entry => entry.enabled !== false)),
          source: "claude" as const,
          detail: [version ? `version ${version}` : "installed_plugins.json", visibleScopes.join("/")].filter(Boolean).join(" · "),
          scopes
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  try {
    if (!existsSync(pluginsDir)) return [];
    return readdirSync(pluginsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        id: `plugin:${entry.name}`,
        kind: "plugin" as const,
        name: entry.name,
        description: "Claude Code plugin directory",
        path: join(pluginsDir, entry.name),
        enabled: true,
        source: "claude" as const,
        detail: "directory"
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function scanClaudeMcp(claudeJson: string): ClaudeResourceItem[] {
  const config = readJsonObject(claudeJson);
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];

  return Object.entries(servers as Record<string, unknown>)
    .map(([name]) => ({
      id: `mcp:${name}`,
      kind: "mcp" as const,
      name,
      description: "Claude Code MCP server",
      path: claudeJson,
      enabled: true,
      source: "claude-json" as const,
      detail: "configured"
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanClaudeResourcesFresh(): ClaudeResourcesSnapshot {
  const paths = getClaudePaths();
  const enabledPlugins = readClaudeEnabledPlugins(paths.claudeDir);
  const installedPlugins = readClaudeInstalledPlugins(paths.claudeDir);
  const skillOverrides = readClaudeSkillOverrides(paths.claudeDir);
  const skills = scanClaudeSkills(paths.claudeDir, enabledPlugins, installedPlugins, skillOverrides);
  const plugins = scanClaudePlugins(paths.claudeDir, enabledPlugins, installedPlugins);
  const mcp = scanClaudeMcp(paths.claudeJson);
  return {
    summary: { skills: skills.length, plugins: plugins.length, mcp: mcp.length },
    skills,
    plugins,
    mcp,
    scannedAt: Date.now(),
    paths
  };
}

function getClaudeResourcesSnapshot(force = false): Promise<ClaudeResourcesSnapshot> {
  const now = Date.now();
  if (!force && claudeResourceCache && now - claudeResourceCache.timestamp < CLAUDE_RESOURCE_CACHE_TTL) {
    return Promise.resolve(claudeResourceCache.data);
  }
  if (pendingClaudeResourceScan) {
    if (!force) return pendingClaudeResourceScan;
    if (queuedForcedClaudeResourceScan?.after === pendingClaudeResourceScan) {
      return queuedForcedClaudeResourceScan.result;
    }

    // Forced readers that arrive during the same scan share one subsequent
    // fresh scan. Clear the marker before that scan starts so later readers
    // can still queue another generation when required.
    const currentScan = pendingClaudeResourceScan;
    const result = currentScan
      .then(() => {
        if (queuedForcedClaudeResourceScan?.after === currentScan) queuedForcedClaudeResourceScan = null;
        return getClaudeResourcesSnapshot(true);
      })
      .finally(() => {
        if (queuedForcedClaudeResourceScan?.after === currentScan) queuedForcedClaudeResourceScan = null;
      });
    queuedForcedClaudeResourceScan = { after: currentScan, result };
    return result;
  }

  pendingClaudeResourceScan = new Promise<ClaudeResourcesSnapshot>(resolve => {
    setImmediate(() => resolve(scanClaudeResourcesFresh()));
  })
    .then(data => {
      claudeResourceCache = { data, timestamp: Date.now() };
      return data;
    })
    .finally(() => { pendingClaudeResourceScan = null; });

  return pendingClaudeResourceScan;
}

async function getClaudeProfilesSnapshot(force = false) {
  const profilePath = claudeProfilesPath();
  const mcpInventoryPath = claudeMcpInventoryPath();
  // Default must capture the live global state, not a startup-warmup cache
  // that may predate an external Claude configuration change.
  const resources = await getClaudeResourcesSnapshot(force || !existsSync(profilePath) || !existsSync(mcpInventoryPath));
  const scannedMcpResources = buildClaudeProfileInventory(resources).mcpServers;
  const mcpSnapshot = synchronizeClaudeMcpProfileResources(
    resources.paths.claudeJson,
    mcpInventoryPath,
    scannedMcpResources
  );
  return createClaudeProfilesSnapshot(profilePath, resources, Date.now(), mcpSnapshot.resources, mcpSnapshot.status);
}

function profileIssue(code: string, message: string): ClaudeProfileOperationIssue {
  return { code, message };
}

function profileStoreFromSnapshot(snapshot: ClaudeProfilesSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    profiles: snapshot.profiles,
    appliedProfileId: snapshot.appliedProfileId
  };
}

function profileCoordinatorPaths() {
  const paths = getClaudePaths();
  return {
    settingsPath: join(paths.claudeDir, "settings.json"),
    claudeJsonPath: paths.claudeJson,
    profileStorePath: claudeProfilesPath(),
    mcpInventoryPath: claudeMcpInventoryPath()
  };
}

function unavailableProfileMutation(snapshot: ClaudeProfilesSnapshot): ClaudeProfileMutationResult | null {
  if (snapshot.mcpStatus === "ready") return null;
  return {
    ok: false,
    issues: [profileIssue("mcp-state-unavailable", "Claude MCP state is temporarily unavailable. Refresh before changing profiles.")]
  };
}

async function saveClaudeProfileFromRenderer(input: unknown): Promise<ClaudeProfileMutationResult> {
  try {
    const snapshot = await getClaudeProfilesSnapshot(true);
    const unavailable = unavailableProfileMutation(snapshot);
    if (unavailable) return unavailable;
    const mutation = upsertClaudeProfile(profileStoreFromSnapshot(snapshot), snapshot.inventory, input);
    if (!mutation.ok) return mutation;
    saveClaudeProfileStore(claudeProfilesPath(), mutation.store);
    return { ok: true, profileId: mutation.profileId, snapshot: await getClaudeProfilesSnapshot(false) };
  } catch {
    return { ok: false, issues: [profileIssue("profile-store-write-failed", "The Claude profile could not be saved.")] };
  }
}

async function deleteClaudeProfileFromRenderer(profileId: unknown): Promise<ClaudeProfileMutationResult> {
  try {
    const snapshot = await getClaudeProfilesSnapshot(true);
    const unavailable = unavailableProfileMutation(snapshot);
    if (unavailable) return unavailable;
    const mutation = removeClaudeProfile(profileStoreFromSnapshot(snapshot), profileId);
    if (!mutation.ok) return mutation;
    saveClaudeProfileStore(claudeProfilesPath(), mutation.store);
    return { ok: true, profileId: mutation.profileId, snapshot: await getClaudeProfilesSnapshot(false) };
  } catch {
    return { ok: false, issues: [profileIssue("profile-store-write-failed", "The Claude profile could not be deleted.")] };
  }
}

async function previewClaudeProfileFromRenderer(profileId: unknown): Promise<ClaudeProfilePreviewResult> {
  if (typeof profileId !== "string" || !profileId.trim()) {
    return { ok: false, issues: [profileIssue("invalid-profile-reference", "Claude profile id is invalid.")] };
  }
  try {
    const snapshot = await getClaudeProfilesSnapshot(true);
    if (snapshot.mcpStatus !== "ready") {
      return { ok: false, issues: [profileIssue("mcp-state-unavailable", "Claude MCP state is temporarily unavailable. Refresh before applying a profile.")] };
    }
    return previewClaudeProfileApply({
      profileId,
      store: profileStoreFromSnapshot(snapshot),
      inventory: snapshot.inventory,
      paths: profileCoordinatorPaths()
    });
  } catch {
    return { ok: false, issues: [profileIssue("profile-preview-failed", "The Claude profile preview could not be prepared.")] };
  }
}

async function applyClaudeProfileFromRenderer(profileId: unknown): Promise<ClaudeProfileMutationResult> {
  if (typeof profileId !== "string" || !profileId.trim()) {
    return { ok: false, issues: [profileIssue("invalid-profile-reference", "Claude profile id is invalid.")] };
  }
  try {
    const snapshot = await getClaudeProfilesSnapshot(true);
    if (snapshot.mcpStatus !== "ready") {
      return { ok: false, issues: [profileIssue("mcp-state-unavailable", "Claude MCP state is temporarily unavailable. Refresh before applying a profile.")] };
    }
    const result = applyClaudeProfile({
      profileId,
      store: profileStoreFromSnapshot(snapshot),
      inventory: snapshot.inventory,
      paths: profileCoordinatorPaths()
    });
    if (!result.ok) return result;
    claudeResourceCache = null;
    try {
      return { ok: true, profileId, snapshot: await getClaudeProfilesSnapshot(true) };
    } catch {
      return { ok: true, profileId, snapshot: snapshotAfterClaudeProfileApply(snapshot, profileId) };
    }
  } catch {
    return { ok: false, issues: [profileIssue("profile-apply-failed", "The Claude profile could not be applied.")] };
  }
}

async function setClaudeProfileResourceStateFromRenderer(input: unknown): Promise<ClaudeProfileMutationResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: [profileIssue("invalid-profile-input", "Claude profile resource state input is invalid.")] };
  }
  const { profileId, resourceId, enabled } = input as Partial<ClaudeProfileResourceStateInput>;
  if (typeof profileId !== "string" || !profileId.trim() || typeof resourceId !== "string" || !resourceId.trim() || typeof enabled !== "boolean") {
    return { ok: false, issues: [profileIssue("invalid-profile-input", "Claude profile resource state input is invalid.")] };
  }

  try {
    const snapshot = await getClaudeProfilesSnapshot(true);
    const unavailable = unavailableProfileMutation(snapshot);
    if (unavailable) return unavailable;
    if (snapshot.appliedProfileId !== profileId) {
      return { ok: false, issues: [profileIssue("invalid-profile-reference", "The selected Claude profile is no longer applied.")] };
    }
    const profile = snapshot.profiles.find(item => item.id === profileId);
    if (!profile) {
      return { ok: false, issues: [profileIssue("invalid-profile-reference", `Claude profile ${profileId} does not exist.`)] };
    }
    const resource = [
      ...snapshot.inventory.skills,
      ...snapshot.inventory.plugins,
      ...snapshot.inventory.mcpServers
    ].find(item => item.id === resourceId);
    if (!resource) {
      const code = resourceId.startsWith("skill:") ? "missing-skill" : resourceId.startsWith("plugin:") ? "missing-plugin" : "missing-mcp-server";
      return { ok: false, issues: [{ code, message: `Claude profile references missing resource ${resourceId}.`, resourceId }] };
    }
    const membership = resource.kind === "skill" ? profile.skills : resource.kind === "plugin" ? profile.plugins : profile.mcpServers;
    if (!membership.includes(resourceId)) {
      return { ok: false, issues: [profileIssue("invalid-profile-reference", `Resource ${resourceId} is not a member of profile ${profileId}.`)] };
    }
    if (resource.enabled === enabled) return { ok: true, profileId, snapshot };

    const paths = profileCoordinatorPaths();
    const result = setClaudeProfileResourceEnabled(resource, enabled, {
      settingsPath: paths.settingsPath,
      claudeJsonPath: paths.claudeJsonPath,
      mcpInventoryPath: paths.mcpInventoryPath
    });
    if (!result.ok) return result;
    claudeResourceCache = null;
    try {
      return { ok: true, profileId, snapshot: await getClaudeProfilesSnapshot(true) };
    } catch {
      return { ok: true, profileId, snapshot: snapshotAfterClaudeProfileResourceState(snapshot, resourceId, enabled) };
    }
  } catch {
    return { ok: false, issues: [profileIssue("resource-state-failed", "The Claude resource state could not be changed.")] };
  }
}

function isAllowedClaudeResourcePath(targetPath: string) {
  const paths = getClaudePaths();
  const resolvedTarget = resolve(targetPath);
  const resolvedClaudeDir = resolve(paths.claudeDir);
  const resolvedClaudeJson = resolve(paths.claudeJson);
  return resolvedTarget === resolvedClaudeJson || resolvedTarget === resolvedClaudeDir || resolvedTarget.startsWith(`${resolvedClaudeDir}\\`) || resolvedTarget.startsWith(`${resolvedClaudeDir}/`);
}

type ClaudeSessionStatus = "valid" | "empty" | "corrupt";

type ClaudeSessionIndexItem = {
  sessionId: string;
  title: string;
  firstPrompt?: string;
  projectName: string;
  projectPath?: string;
  encodedProject: string;
  filePath: string;
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
  status: ClaudeSessionStatus;
  model?: string;
  branch?: string;
};

type ClaudeSessionMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  timestamp?: number;
  model?: string;
  toolName?: string;
};

const CLAUDE_SESSION_CACHE_TTL = 60 * 1000;
const CLAUDE_SESSION_STALE_TTL = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_SESSION_SCAN_CONCURRENCY = 10;
const CLAUDE_SESSION_FILE_SCAN_CONCURRENCY = 4;
const CLAUDE_SESSION_DETAIL_MAX_BYTES = 16 * 1024 * 1024;
const CLAUDE_SESSION_DETAIL_MAX_MESSAGES = 240;
type ClaudeSessionSnapshotData = { sessions: ClaudeSessionIndexItem[]; scannedAt: number; projectsDir: string };
let claudeSessionCache: { data: ClaudeSessionSnapshotData; timestamp: number } | null = null;
let pendingClaudeSessionScan: Promise<ClaudeSessionSnapshotData> | null = null;
// Every fresh scan result goes through here: cache it AND push it to the panel. The push is
// what actually repaints an open sessions page after stale-while-revalidate served old data —
// without it a background scan's result would sit in this cache until the next manual refresh.
function commitClaudeSessionSnapshot(data: ClaudeSessionSnapshotData): ClaudeSessionSnapshotData {
  claudeSessionCache = { data, timestamp: Date.now() };
  panelWindow?.webContents.send("companion:sessions-updated", data);
  return data;
}
let claudeSessionFileCache = new Map<string, { mtimeMs: number; size: number; item: ClaudeSessionIndexItem }>();
// Bump when ClaudeSessionIndexItem's shape or scanSingleClaudeSessionStream's logic changes, so a
// stale on-disk cache is discarded rather than served.
const SESSION_INDEX_CACHE_VERSION = 1;
let sessionFileCacheLoaded = false;
function sessionIndexCachePath() {
  return join(app.getPath("userData"), "session-index-cache.ndjson");
}

async function mapInBatches<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const limit = Math.max(1, concurrency);
  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

function decodeClaudeProjectName(encodedProject: string) {
  if (!encodedProject) return "Claude Code";
  const decoded = encodedProject.replace(/-/g, "\\");
  return decoded.replace(/\\+$/g, "") || encodedProject;
}

async function collectClaudeProjectDirs(projectsDir: string) {
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => ({ encodedProject: entry.name, projectDir: join(projectsDir, entry.name) }));
  } catch {
    return [];
  }
}

async function scanClaudeProjectDirectory(projectDir: string, encodedProject: string) {
  try {
    const entries = await readdir(projectDir, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(entry => join(projectDir, entry.name));
    const sessions = await mapInBatches(files, CLAUDE_SESSION_FILE_SCAN_CONCURRENCY, async filePath => {
      try {
        return await scanSingleClaudeSessionStream(filePath, encodedProject);
      } catch {
        return null;
      }
    });
    return sessions.filter((session): session is ClaudeSessionIndexItem => Boolean(session));
  } catch {
    return [];
  }
}

async function scanSingleClaudeSessionStream(filePath: string, encodedProject: string): Promise<ClaudeSessionIndexItem> {
  const stat = statSync(filePath);
  const cached = claudeSessionFileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.item;
  const fallbackTime = stat.mtimeMs;
  let sessionId = sessionIdFromPath(filePath);
  let firstPrompt = "";
  let customTitle = "";
  let lastText = "";
  let lastMessageAt = fallbackTime;
  let createdAt = fallbackTime;
  let messageCount = 0;
  let corrupt = false;
  let model: string | undefined;
  let projectPath: string | undefined;
  let branch: string | undefined;
  let lineIndex = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const rawLine of reader) {
      const line = rawLine.replace(/^﻿/, "").trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const record = parsed as Record<string, unknown>;
        if (typeof record.sessionId === "string") sessionId = record.sessionId;
        if (typeof record.session_id === "string") sessionId = record.session_id;
        if (typeof record.cwd === "string") projectPath = record.cwd;
        if (typeof record.gitBranch === "string") branch = record.gitBranch;
        if (typeof record.customTitle === "string" && record.customTitle.trim()) customTitle = record.customTitle.trim();

        const message = record.message && typeof record.message === "object" && !Array.isArray(record.message)
          ? record.message as Record<string, unknown>
          : null;
        if (message && typeof message.model === "string") model = message.model;
        if (typeof record.model === "string") model = record.model;

        const role = roleFromRecord(record);
        if (role !== "user" && role !== "assistant") continue;
        const body = textFromRecord(record);
        if (!body) continue;
        messageCount++;
        if (!firstPrompt && role === "user") firstPrompt = body;
        lastText = body;
        const ts = timestampFromRecord(record, fallbackTime);
        if (messageCount === 1) createdAt = ts;
        lastMessageAt = Math.max(lastMessageAt, ts);
      } catch {
        corrupt = true;
      } finally {
        lineIndex++;
      }
    }
  } catch {
    corrupt = true;
  } finally {
    reader.close();
    stream.destroy();
  }

  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath : decodeClaudeProjectName(encodedProject);
  const title = customTitle || firstPrompt || lastText || sessionId;
  const item: ClaudeSessionIndexItem = {
    sessionId,
    title: title.slice(0, 180),
    firstPrompt: firstPrompt ? firstPrompt.slice(0, 240) : undefined,
    projectName,
    projectPath,
    encodedProject,
    filePath,
    messageCount,
    lastMessageAt,
    createdAt,
    status: corrupt && lineIndex > 1 ? "corrupt" : messageCount > 0 ? "valid" : "empty",
    model,
    branch
  };
  claudeSessionFileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, item });
  return item;
}

async function scanClaudeSessionsFresh() {
  const paths = getClaudePaths();
  // Warm the per-file cache from disk once so a cold start reuses unchanged sessions' parsed
  // items instead of re-streaming every jsonl (see scanCachePersistence for the safety model).
  if (!sessionFileCacheLoaded) {
    for (const [filePath, entry] of loadScanCache<ClaudeSessionIndexItem>(sessionIndexCachePath(), SESSION_INDEX_CACHE_VERSION)) {
      claudeSessionFileCache.set(filePath, { mtimeMs: entry.mtimeMs, size: entry.size, item: entry.payload });
    }
    sessionFileCacheLoaded = true;
  }
  const projectDirs = await collectClaudeProjectDirs(paths.projectsDir);
  const projectResults = await mapInBatches(projectDirs, CLAUDE_SESSION_SCAN_CONCURRENCY, project => scanClaudeProjectDirectory(project.projectDir, project.encodedProject));
  const sessions = projectResults.flat();
  const seenFiles = new Set(sessions.map(session => session.filePath));
  if (claudeSessionFileCache.size > sessions.length + 200) {
    for (const filePath of claudeSessionFileCache.keys()) {
      if (!seenFiles.has(filePath)) claudeSessionFileCache.delete(filePath);
    }
  }
  // Persist the refreshed cache (only entries for files that still exist) for the next cold start.
  saveScanCache<ClaudeSessionIndexItem>(
    sessionIndexCachePath(),
    SESSION_INDEX_CACHE_VERSION,
    [...claudeSessionFileCache.entries()]
      .filter(([filePath]) => seenFiles.has(filePath))
      .map(([filePath, entry]) => [filePath, { mtimeMs: entry.mtimeMs, size: entry.size, payload: entry.item }] as [string, CachedScan<ClaudeSessionIndexItem>])
  );

  return {
    sessions: sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt).slice(0, 500),
    scannedAt: Date.now(),
    projectsDir: paths.projectsDir
  };
}

async function getClaudeSessionSnapshot(force = false) {
  const now = Date.now();
  if (!force && claudeSessionCache && now - claudeSessionCache.timestamp < CLAUDE_SESSION_CACHE_TTL) {
    return claudeSessionCache.data;
  }

  if (!force && claudeSessionCache && now - claudeSessionCache.timestamp < CLAUDE_SESSION_STALE_TTL) {
    if (!pendingClaudeSessionScan) {
      pendingClaudeSessionScan = scanClaudeSessionsFresh()
        .then(commitClaudeSessionSnapshot)
        .finally(() => { pendingClaudeSessionScan = null; });
    }
    return claudeSessionCache.data;
  }

  if (pendingClaudeSessionScan) return pendingClaudeSessionScan;
  pendingClaudeSessionScan = scanClaudeSessionsFresh()
    .then(commitClaudeSessionSnapshot)
    .finally(() => { pendingClaudeSessionScan = null; });
  return pendingClaudeSessionScan;
}

type TokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
};

// The file-derived request: a pure function of the JSONL (tokens/model/ids/timestamp). This is the
// ONLY shape that gets cached to disk. Cost is deliberately NOT here — costUsd/priced depend on the
// pricing table (24h TTL, refreshed independently of the logs), so caching them would let an
// unchanged file keep a stale price after a rate refresh and mix two price sets in one aggregate.
// Cost is resolved from the CURRENT table at aggregation time instead (see aggregateClaudeTokenStats).
type ParsedTokenRequest = TokenBreakdown & {
  id: string;
  sessionId: string;
  filePath: string;
  projectPath?: string;
  projectName: string;
  model: string;
  provider?: string;
  timestamp: number;
  durationMs?: number;
  entrypoint?: string;
};

// A parsed request with its cost resolved against the current pricing table — the shape the
// renderer's "largest requests" list consumes.
type ClaudeTokenRequest = ParsedTokenRequest & {
  costUsd: number;
  priced: boolean;
};

type PricingSource = "deepseek-official" | "litellm" | "models.dev" | "embedded";
type PricingStatus = {
  source: PricingSource;
  sources: PricingSource[];
  updatedAt: number;
  stale: boolean;
};

type ClaudeTokenStats = {
  sessions: Array<TokenBreakdown & { sessionId: string; project: string; cwd: string; startTime: number; endTime: number; model: string; entrypoint: string; costUsd: number; requestCount: number; messageCount: number }>;
  daily: Array<TokenBreakdown & { date: string; model: string; costUsd: number; sessionCount: number; requestCount: number; messageCount: number }>;
  modelTotals: Array<TokenBreakdown & { model: string; costUsd: number; requestCount: number; sessionCount: number; messageCount: number; cacheHitRatio: number; priced: boolean }>;
  dailyTotals: Array<TokenBreakdown & { date: string; costUsd: number; sessionCount: number; requestCount: number; messageCount: number }>;
  // Durable long-term per-day totals for the heatmap only (survives log rotation), added
  // by applyDurableDailyHistory after aggregation. The live dailyTotals above still back
  // the today/30-day/breakdown numbers.
  heatmapDailyTotals?: Array<TokenBreakdown & { date: string; costUsd: number; sessionCount: number; requestCount: number; messageCount: number }>;
  projectTotals: Array<TokenBreakdown & { projectPath: string; projectName: string; costUsd: number; requestCount: number; sessionCount: number; lastActivity: number; models: string[]; cacheHitRatio: number }>;
  recentRequests: ClaudeTokenRequest[];
  totalTokens: number;
  totalCostUsd: number;
  totalSessions: number;
  totalRequests: number;
  cacheHitRatio: number;
  pricing: PricingStatus;
  lastScannedAt: number;
  scanning: boolean;
};

const CLAUDE_TOKEN_CACHE_TTL = 60 * 1000;
const CLAUDE_TOKEN_STALE_TTL = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_TOKEN_SCAN_CONCURRENCY = 10;
let claudeTokenStatsCache: { data: ClaudeTokenStats; timestamp: number } | null = null;
let pendingClaudeTokenStatsScan: Promise<ClaudeTokenStats> | null = null;
type TokenFileScanResult = {
  requests: ParsedTokenRequest[];
  edits: ParsedEditRecord[];
  usage: UsageCounts;
  project: { path?: string; name: string };
};
let claudeTokenFileCache = new Map<string, { mtimeMs: number; size: number } & TokenFileScanResult>();
// Bump when ParsedTokenRequest's shape or scanClaudeTokenFile's parse/dedup logic changes, so a
// stale on-disk cache is discarded rather than served. The cached payload is cost-free (cost is
// re-derived from the current pricing table every aggregation), so a rate refresh never invalidates it.
// v3: entries also carry the file's extracted edit records (recent-edits timeline).
// v4: entries also carry tool/skill/subagent usage counts and the file's resolved project.
// v5: skill counts additionally include user-typed slash commands (<command-name> rows).
const TOKEN_FILE_CACHE_VERSION = 5;
let tokenFileCacheLoaded = false;
// The (path:mtime:size) signature of the file set at the last full scan. When it is unchanged the
// aggregate is provably identical, so a background refresh can skip the whole re-parse+re-aggregate.
let lastTokenScanSignature = "";
function tokenFileCachePath() {
  return join(app.getPath("userData"), "token-file-cache.ndjson");
}
// Aggregated recent-edits timeline, rebuilt by the same full scan that rebuilds the token
// aggregate — the two are always derived from the same file set and share its freshness.
let claudeRecentEditsSnapshot: RecentEditsSnapshot = emptyRecentEditsSnapshot();
// Tool / Skill / Subagent usage rankings — same deal: a by-product of the token scan.
let claudeUsageRankingsSnapshot: UsageRankingsSnapshot = emptyUsageRankingsSnapshot();
let dshUsageStore: DshUsageStore | null = null;
let dshSessionScanner: DshSessionScanner | null = null;
let dshAnalyticsSnapshot: DshAnalyticsSnapshot = emptyDshAnalyticsSnapshot();

function dshUsageLogPath() {
  return join(app.getPath("userData"), "dsh-usage.ndjson");
}

function dshSessionScanCachePath() {
  return join(app.getPath("userData"), "dsh-session-scan-cache.ndjson");
}

function getDshUsageStore() {
  dshUsageStore ??= new DshUsageStore(dshUsageLogPath());
  return dshUsageStore;
}

function getDshSessionScanner() {
  dshSessionScanner ??= new DshSessionScanner(resolveDshHome(), dshSessionScanCachePath());
  return dshSessionScanner;
}

function dshTokenRequests(excludedIds: ReadonlySet<string> = new Set()): ParsedTokenRequest[] {
  return getDshUsageStore().records().filter(record => !excludedIds.has(record.id)).map(record => {
    const projectName = record.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? "DeepSeek Harness";
    const cacheCreationTokens = record.cacheWriteTokens;
    const totalTokens = record.inputTokens + record.outputTokens + record.cacheReadTokens + cacheCreationTokens;
    return {
      id: record.id,
      sessionId: record.sessionId,
      filePath: dshUsageLogPath(),
      projectPath: record.cwd,
      projectName,
      provider: record.provider,
      model: record.model,
      timestamp: record.timestamp,
      entrypoint: "dsh",
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheCreationTokens,
      totalTokens
    };
  });
}

// Durable per-day request/token history for the DSH usage heatmap.
type TokenDailyTotal = ClaudeTokenStats["dailyTotals"][number];
let tokenDailyHistory: Record<string, TokenDailyTotal> | null = null;
let tokenDailyHistoryUnreadable = false; // existing history file failed to read — never overwrite it

function tokenDailyHistoryPath() {
  return join(app.getPath("userData"), "dsh-token-daily-history.json");
}

function loadTokenDailyHistory(): Record<string, TokenDailyTotal> {
  if (tokenDailyHistory) return tokenDailyHistory;
  if (existsSync(tokenDailyHistoryPath())) {
    try {
      tokenDailyHistory = normalizeTokenDailyHistory(JSON.parse(readFileSync(tokenDailyHistoryPath(), "utf8"))) as unknown as Record<string, TokenDailyTotal>;
      return tokenDailyHistory;
    } catch {
      // The file exists but is corrupt / unreadable. Do NOT treat it as empty and let the
      // next save overwrite it — that would permanently drop rotated-away days that only
      // live here. Serve {} for this session (heatmap falls back to live) and refuse to
      // save over the original (the file is app-owned, so the failure is not a transient
      // cross-process lock; preserving it lets the user recover or delete it).
      tokenDailyHistoryUnreadable = true;
    }
  }
  tokenDailyHistory = {};
  return tokenDailyHistory;
}

function saveTokenDailyHistory(history: Record<string, TokenDailyTotal>) {
  tokenDailyHistory = history;
  if (tokenDailyHistoryUnreadable) return; // never clobber an existing-but-unreadable file
  try {
    // Machine-only file — skip pretty-printing to cut serialize cost and on-disk size.
    writeTextFileAtomic(tokenDailyHistoryPath(), JSON.stringify({ version: 1, days: history }));
  } catch { /* best effort — durability is a nice-to-have, not a hard requirement */ }
}

// Fold this scan's per-day totals into the persisted history and expose it as a SEPARATE
// heatmapDailyTotals field. dailyTotals (and the live totals derived from it — today,
// last-30-days, input/output/cache) stay from this scan so they remain internally
// consistent with totalTokens/totalRequests/totalCostUsd; only the long-term heatmap
// reads the durable set.
function applyDurableDailyHistory(stats: ClaudeTokenStats): ClaudeTokenStats {
  const before = loadTokenDailyHistory();
  const merged = mergeTokenDailyHistory(before, stats.dailyTotals);
  // Only rewrite the file when a day's stored + displayed totals actually changed (or a day was
  // added), so an idle refresh that re-derives identical past days doesn't re-serialize + fsync the
  // whole history. costUsd is included: a pricing-table refresh can change a day's cost while its
  // request/token counts are unchanged, and the heatmap tooltip shows that cost — skipping it would
  // strand the old price in the persisted history once the live logs rotate away.
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  let changed = Object.keys(merged).length !== Object.keys(before).length;
  if (!changed) {
    for (const date of Object.keys(merged)) {
      const next = merged[date] as Record<string, unknown>;
      const prev = before[date] as Record<string, unknown> | undefined;
      if (!prev
        || num(next.requestCount) !== num(prev.requestCount)
        || num(next.totalTokens) !== num(prev.totalTokens)
        || num(next.costUsd) !== num(prev.costUsd)) {
        changed = true;
        break;
      }
    }
  }
  if (changed) saveTokenDailyHistory(merged);
  return { ...stats, heatmapDailyTotals: historyToSortedArray(merged) };
}

function emptyClaudeTokenStats(scannedAt = Date.now()): ClaudeTokenStats {
  return {
    sessions: [],
    daily: [],
    modelTotals: [],
    dailyTotals: [],
    heatmapDailyTotals: [],
    projectTotals: [],
    recentRequests: [],
    totalTokens: 0,
    totalCostUsd: 0,
    totalSessions: 0,
    totalRequests: 0,
    cacheHitRatio: 0,
    pricing: currentPricingStatus(),
    lastScannedAt: scannedAt,
    scanning: false
  };
}

type PricingCacheFile = {
  version: 1;
  timestamp: number;
  source: PricingSource;
  sources: PricingSource[];
  rates: Record<string, ModelPricingRates>;
};
type DynamicPricingSnapshot = PricingStatus & {
  rates: Map<string, ModelPricingRates>;
  signature: string;
};

const PRICING_TTL_MS = 24 * 60 * 60 * 1000;
const PRICING_FETCH_TIMEOUT_MS = 5000;
const PRICING_SOURCE_PRIORITY: PricingSource[] = ["deepseek-official", "litellm", "models.dev"];
let dynamicPricingRates: Map<string, ModelPricingRates> | null = null;
let dynamicPricingSnapshot: DynamicPricingSnapshot | null = null;
let pendingDynamicPricingLoad: Promise<Map<string, ModelPricingRates>> | null = null;
// Memoizes per-model rate resolution so a cold token scan of thousands of records
// doesn't re-fuzzy-scan the ~1000-entry LiteLLM map per record.
const pricingMemo = new ModelPricingMemo();

const CURRENCY_RATES_TTL_MS = 12 * 60 * 60 * 1000;
const CURRENCY_RATES_FETCH_TIMEOUT_MS = 8_000;
const CURRENCY_RATES_URLS = [
  "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"
] as const;
let currencyRatesSnapshot: CurrencyRatesStatus | null = null;
let pendingCurrencyRatesLoad: Promise<CurrencyRatesStatus> | null = null;
let currencyRatesRefreshTimer: NodeJS.Timeout | null = null;

function currencyRatesCachePath() {
  return join(app.getPath("userData"), "dsh-currency-rates-cache.json");
}

function embeddedCurrencyRatesStatus(): CurrencyRatesStatus {
  return { base: "USD", rates: { ...EMBEDDED_CURRENCY_RATES }, source: "embedded", updatedAt: 0, stale: true };
}

function loadCachedCurrencyRates(): CurrencyRatesStatus | null {
  try {
    const parsed = JSON.parse(readFileSync(currencyRatesCachePath(), "utf8")) as { version?: unknown; timestamp?: unknown; rates?: unknown };
    const rates = parseExchangeApiRates({ usd: {
      cny: (parsed.rates as { CNY?: unknown } | undefined)?.CNY,
      eur: (parsed.rates as { EUR?: unknown } | undefined)?.EUR
    } });
    if (parsed.version !== 1 || typeof parsed.timestamp !== "number" || !Number.isFinite(parsed.timestamp) || parsed.timestamp <= 0 || !rates) return null;
    return {
      base: "USD",
      rates,
      source: "exchange-api",
      updatedAt: parsed.timestamp,
      stale: Date.now() - parsed.timestamp >= CURRENCY_RATES_TTL_MS
    };
  } catch {
    return null;
  }
}

async function fetchCurrencyRates(): Promise<CurrencyRatesStatus["rates"]> {
  for (const url of CURRENCY_RATES_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CURRENCY_RATES_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;
      const rates = parseExchangeApiRates(await response.json());
      if (rates) return rates;
    } catch {
      // Try the mirrored endpoint before falling back to the disk cache.
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("currency_rates_unavailable");
}

async function loadCurrencyRates(force = false): Promise<CurrencyRatesStatus> {
  if (!force && currencyRatesSnapshot && Date.now() - currencyRatesSnapshot.updatedAt < CURRENCY_RATES_TTL_MS) return currencyRatesSnapshot;
  if (pendingCurrencyRatesLoad) return pendingCurrencyRatesLoad;
  pendingCurrencyRatesLoad = (async () => {
    const cached = loadCachedCurrencyRates();
    if (!force && cached && !cached.stale) {
      currencyRatesSnapshot = cached;
      return cached;
    }
    try {
      const rates = await fetchCurrencyRates();
      const next: CurrencyRatesStatus = { base: "USD", rates, source: "exchange-api", updatedAt: Date.now(), stale: false };
      currencyRatesSnapshot = next;
      try {
        writeTextFileAtomic(currencyRatesCachePath(), JSON.stringify({ version: 1, timestamp: next.updatedAt, rates }));
      } catch { /* best effort */ }
      return next;
    } catch {
      const previous = cached ?? currencyRatesSnapshot;
      currencyRatesSnapshot = previous
        ? { ...previous, stale: Date.now() - previous.updatedAt >= CURRENCY_RATES_TTL_MS }
        : embeddedCurrencyRatesStatus();
      return currencyRatesSnapshot;
    }
  })().finally(() => { pendingCurrencyRatesLoad = null; });
  return pendingCurrencyRatesLoad;
}

function pricingCachePath() {
  return join(app.getPath("userData"), "dsh-pricing-cache.json");
}

function pricingSource(value: unknown): PricingSource | null {
  return value === "deepseek-official" || value === "litellm" || value === "models.dev" || value === "embedded" ? value : null;
}

function currentPricingStatus(): PricingStatus {
  return dynamicPricingSnapshot
    ? { source: dynamicPricingSnapshot.source, sources: [...dynamicPricingSnapshot.sources], updatedAt: dynamicPricingSnapshot.updatedAt, stale: dynamicPricingSnapshot.stale }
    : { source: "embedded", sources: ["embedded"], updatedAt: 0, stale: true };
}

function loadCachedDynamicPricing(): DynamicPricingSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(pricingCachePath(), "utf8")) as PricingCacheFile;
    const source = pricingSource(parsed?.source);
    const sources = Array.isArray(parsed?.sources) ? parsed.sources.map(pricingSource).filter((item): item is PricingSource => item !== null) : [];
    if (parsed?.version !== 1 || !Number.isFinite(parsed.timestamp) || parsed.timestamp <= 0 || !source || !parsed.rates || typeof parsed.rates !== "object") return null;
    const rates = new Map(Object.entries(parsed.rates).filter(([, rate]) => rate && Number.isFinite(rate.input) && rate.input > 0 && Number.isFinite(rate.output) && rate.output > 0));
    if (rates.size === 0) return null;
    return {
      rates,
      source,
      sources: sources.length > 0 ? sources : [source],
      updatedAt: parsed.timestamp,
      stale: Date.now() - parsed.timestamp >= PRICING_TTL_MS,
      signature: `${parsed.timestamp}:${pricingRatesSignature(rates)}`
    };
  } catch { /* ignore cache misses */ }
  return null;
}

async function fetchPricingText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRICING_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`pricing_fetch_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function mergePricingRates(base: ModelPricingRates | undefined, incoming: ModelPricingRates): ModelPricingRates {
  return {
    ...base,
    ...incoming,
    ...(incoming.timeOfUse ? { timeOfUse: incoming.timeOfUse } : base?.timeOfUse ? { timeOfUse: base.timeOfUse } : {})
  };
}

function usePricingSnapshot(snapshot: DynamicPricingSnapshot) {
  dynamicPricingSnapshot = snapshot;
  dynamicPricingRates = snapshot.rates;
  return snapshot.rates;
}

async function loadDynamicPricingRates(force = false) {
  if (!force && dynamicPricingSnapshot && Date.now() - dynamicPricingSnapshot.updatedAt < PRICING_TTL_MS) return dynamicPricingSnapshot.rates;
  if (pendingDynamicPricingLoad) return pendingDynamicPricingLoad;
  pendingDynamicPricingLoad = (async () => {
    const cached = loadCachedDynamicPricing();
    if (!force && cached && !cached.stale) {
      return usePricingSnapshot(cached);
    }

    const requests: Array<{ source: PricingSource; load: () => Promise<Map<string, ModelPricingRates>> }> = [
      {
        source: "deepseek-official",
        load: async () => parseDeepSeekOfficialPricing(await fetchPricingText("https://api-docs.deepseek.com/quick_start/pricing"))
      },
      {
        source: "litellm",
        load: async () => parseLiteLlmPricing(JSON.parse(await fetchPricingText("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json")))
      },
      {
        source: "models.dev",
        load: async () => parseModelsDevPricing(JSON.parse(await fetchPricingText("https://models.dev/api.json")))
      }
    ];
    const loaded = await Promise.all(requests.map(async request => {
      try {
        const rates = await request.load();
        return rates.size > 0 ? { source: request.source, rates } : null;
      } catch {
        return null;
      }
    }));
    const available = loaded.filter((item): item is NonNullable<typeof item> => item !== null);
    if (available.length > 0) {
      const rates = embeddedDeepSeekPricing();
      for (const source of [...PRICING_SOURCE_PRIORITY].reverse()) {
        const table = available.find(item => item.source === source)?.rates;
        if (!table) continue;
        for (const [model, incoming] of table) rates.set(model, mergePricingRates(rates.get(model), incoming));
      }
      const sources = PRICING_SOURCE_PRIORITY.filter(source => available.some(item => item.source === source));
      const timestamp = Date.now();
      const snapshot: DynamicPricingSnapshot = {
        rates,
        source: sources[0] ?? "embedded",
        sources,
        updatedAt: timestamp,
        stale: false,
        signature: `${timestamp}:${pricingRatesSignature(rates)}`
      };
      try {
        writeTextFileAtomic(pricingCachePath(), JSON.stringify({
          version: 1,
          timestamp,
          source: snapshot.source,
          sources,
          rates: Object.fromEntries(rates)
        } satisfies PricingCacheFile));
      } catch { /* best effort */ }
      return usePricingSnapshot(snapshot);
    }

    const previous = cached ?? dynamicPricingSnapshot;
    if (previous) return usePricingSnapshot({ ...previous, stale: true });
    const rates = embeddedDeepSeekPricing();
    return usePricingSnapshot({
      rates,
      source: "embedded",
      sources: ["embedded"],
      updatedAt: 0,
      stale: true,
      signature: `embedded:${pricingRatesSignature(rates)}`
    });
  })().finally(() => { pendingDynamicPricingLoad = null; });
  return pendingDynamicPricingLoad;
}

function addTokenBreakdown<T extends TokenBreakdown>(target: T, usage: TokenBreakdown) {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheCreationTokens += usage.cacheCreationTokens;
  target.totalTokens += usage.totalTokens;
}

function cacheHitRatio(usage: TokenBreakdown) {
  const denominator = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return denominator > 0 ? usage.cacheReadTokens / denominator : 0;
}

function createBreakdown(): TokenBreakdown {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };
}

function usageFromRecord(record: Record<string, unknown>): TokenBreakdown | null {
  const message = record.message && typeof record.message === "object" && !Array.isArray(record.message)
    ? record.message as Record<string, unknown>
    : null;
  const usage = message?.usage && typeof message.usage === "object" && !Array.isArray(message.usage)
    ? message.usage as Record<string, unknown>
    : null;
  if (!usage) return null;
  const inputTokens = positiveNumber(usage.input_tokens);
  const outputTokens = positiveNumber(usage.output_tokens);
  const cacheReadTokens = positiveNumber(usage.cache_read_input_tokens);
  const cacheCreationTokens = positiveNumber(usage.cache_creation_input_tokens);
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  return totalTokens > 0 ? { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens } : null;
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function claudeProjectName(projectPath: string | undefined, encodedProject: string) {
  return projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath : decodeClaudeProjectName(encodedProject);
}

type TokenScanFile = { filePath: string; encodedProject: string; mtimeMs: number; size: number };

// Async directory walk (no synchronous readdirSync on the main thread) that also stats each jsonl
// up front, so the caller can both build the change signature and skip re-stating in the scanner.
async function collectClaudeJsonlFilesRecursive(projectsDir: string): Promise<TokenScanFile[]> {
  const files: TokenScanFile[] = [];
  const visit = async (dir: string, encodedProject: string, depth: number) => {
    if (depth > 4) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) await visit(fullPath, encodedProject, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const st = await stat(fullPath);
          files.push({ filePath: fullPath, encodedProject, mtimeMs: st.mtimeMs, size: st.size });
        } catch { /* file vanished between readdir and stat — skip it */ }
      }
    }
  };
  try {
    if (!existsSync(projectsDir)) return files;
    for (const projectEntry of await readdir(projectsDir, { withFileTypes: true })) {
      if (projectEntry.isDirectory()) await visit(join(projectsDir, projectEntry.name), projectEntry.name, 0);
    }
  } catch {
    return files;
  }
  return files;
}

async function scanClaudeTokenFile(filePath: string, encodedProject: string, mtimeMs: number, size: number): Promise<TokenFileScanResult> {
  const cached = claudeTokenFileCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return { requests: cached.requests, edits: cached.edits, usage: cached.usage, project: cached.project };
  const fallbackTime = mtimeMs;
  let sessionId = sessionIdFromPath(filePath);
  // Pin the project to the session's ORIGIN cwd — the first cwd seen in the file. Claude Code
  // stamps the LIVE cwd on every row, and it drifts when a session is continued (`claude -c` /
  // resume) from a subdirectory, so trusting the latest cwd splits one session across bogus
  // sub-projects (…/android, …/logs/device-*, …/node_modules/…) that were never real project
  // roots. Setting it once keeps the session under where it began; a session genuinely started in
  // a subdir keeps that subdir as its origin (and Claude Code files it in its own project dir),
  // so real separate projects still stand apart.
  let projectPath: string | undefined;
  let pendingUserTimestamp: number | undefined;
  const byDedup = new Map<string, ParsedTokenRequest>();
  const requests: ParsedTokenRequest[] = [];
  const edits: ParsedEditRecord[] = [];
  const usageCounts = createUsageCounts();
  const seenToolUseIds = new Set<string>();
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const rawLine of reader) {
      const line = rawLine.replace(/^﻿/, "").trim();
      if (!line) continue;
      if (line.includes('"type":"user"') || line.includes('"type": "user"')) {
        try {
          const userRecord = JSON.parse(line) as Record<string, unknown>;
          pendingUserTimestamp = timestampFromRecord(userRecord, fallbackTime);
          if (typeof userRecord.sessionId === "string") sessionId = userRecord.sessionId;
          if (projectPath === undefined && typeof userRecord.cwd === "string") projectPath = userRecord.cwd;
          // User-typed slash commands land on user rows as <command-name> tags, not tool_use —
          // count them into the skills ranking here (the row is already parsed).
          const userMessage = userRecord.message && typeof userRecord.message === "object" && !Array.isArray(userRecord.message)
            ? userRecord.message as Record<string, unknown>
            : null;
          if (userMessage) countUserCommands(userMessage.content, usageCounts);
          // Applied Edit/Write results ride on these same user rows as `toolUseResult` — the
          // record is already parsed, so the recent-edits timeline costs no extra IO here.
          if (userRecord.toolUseResult) {
            const editRecord = editFromToolUseResult(userRecord.toolUseResult, {
              id: typeof userRecord.uuid === "string" && userRecord.uuid ? userRecord.uuid : `${filePath}#${edits.length}`,
              timestamp: pendingUserTimestamp,
              sessionId,
              sessionFilePath: filePath,
              projectPath,
              projectName: claudeProjectName(projectPath, encodedProject)
            });
            if (editRecord) edits.push(editRecord);
          }
        } catch { /* ignore bad user rows */ }
        continue;
      }
      if (!line.includes("assistant") || !line.includes("usage")) continue;
      let record: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        record = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      if (record.type !== "assistant") continue;
      if (typeof record.sessionId === "string") sessionId = record.sessionId;
      if (typeof record.session_id === "string") sessionId = record.session_id;
      if (projectPath === undefined && typeof record.cwd === "string") projectPath = record.cwd;
      const message = record.message && typeof record.message === "object" && !Array.isArray(record.message)
        ? record.message as Record<string, unknown>
        : null;
      // Usage rankings count every assistant row's tool_use blocks (dedup'd by block id across
      // repeated rows) BEFORE the model/usage gates below — a tool call happened regardless of
      // whether its row carries countable token usage.
      if (message) countToolUseBlocks(message.content, usageCounts, seenToolUseIds);
      const model = typeof message?.model === "string" ? message.model : "unknown";
      if (!model || model === "unknown") continue;
      const usage = usageFromRecord(record);
      if (!usage) continue;
      const timestamp = timestampFromRecord(record, fallbackTime);
      const requestId = typeof record.requestId === "string" ? record.requestId : "";
      const messageId = typeof message?.id === "string" ? message.id : "";
      const dedupKey = messageId && requestId ? `${messageId}:${requestId}` : messageId ? `message:${messageId}` : `${filePath}:${timestamp}:${requests.length}`;
      const existing = byDedup.get(dedupKey);
      if (existing) {
        existing.inputTokens = Math.max(existing.inputTokens, usage.inputTokens);
        existing.outputTokens = Math.max(existing.outputTokens, usage.outputTokens);
        existing.cacheReadTokens = Math.max(existing.cacheReadTokens, usage.cacheReadTokens);
        existing.cacheCreationTokens = Math.max(existing.cacheCreationTokens, usage.cacheCreationTokens);
        existing.totalTokens = existing.inputTokens + existing.outputTokens + existing.cacheReadTokens + existing.cacheCreationTokens;
        existing.timestamp = Math.max(existing.timestamp, timestamp);
        continue;
      }
      const request: ParsedTokenRequest = {
        ...usage,
        id: dedupKey,
        sessionId,
        filePath,
        projectPath,
        projectName: claudeProjectName(projectPath, encodedProject),
        model,
        timestamp,
        durationMs: pendingUserTimestamp && timestamp > pendingUserTimestamp ? timestamp - pendingUserTimestamp : undefined
      };
      byDedup.set(dedupKey, request);
      requests.push(request);
      pendingUserTimestamp = undefined;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  const project = { path: projectPath, name: claudeProjectName(projectPath, encodedProject) };
  claudeTokenFileCache.set(filePath, { mtimeMs, size, requests, edits, usage: usageCounts, project });
  return { requests, edits, usage: usageCounts, project };
}

async function scanClaudeTokenStatsFresh(forcePricing = false): Promise<ClaudeTokenStats> {
  await loadDynamicPricingRates(forcePricing);
  const native = await getDshSessionScanner().scan(forcePricing);
  const store = getDshUsageStore();
  const signature = `${native.signature}|${store.signature()}|${dynamicPricingSnapshot?.signature ?? "embedded"}`;
  dshAnalyticsSnapshot = native.analytics;
  claudeRecentEditsSnapshot = aggregateRecentEdits(native.edits, native.analytics.lastScannedAt);
  claudeUsageRankingsSnapshot = aggregateUsageRankings(native.rankings, native.analytics.lastScannedAt);
  if (signature === lastTokenScanSignature && claudeTokenStatsCache) {
    return { ...claudeTokenStatsCache.data, lastScannedAt: Date.now() };
  }
  const result = applyDurableDailyHistory(aggregateClaudeTokenStats([
    ...native.requests,
    ...dshTokenRequests(native.requestIds)
  ], Date.now()));
  lastTokenScanSignature = signature;
  return result;
}

function aggregateClaudeTokenStats(parsed: ParsedTokenRequest[], scannedAt: number): ClaudeTokenStats {
  // Resolve every request's cost against the CURRENT pricing table here — never from the cache — so
  // a cached (unchanged) file and a freshly parsed one always agree on price, and the totals match a
  // full rescan even after the 24h rate refresh. This reuses the request set we already iterate.
  const requests: ClaudeTokenRequest[] = parsed.map(request => {
    const cost = pricingMemo.cost(dynamicPricingRates, request.model, request);
    return { ...request, costUsd: cost.costUsd, priced: cost.priced };
  });
  const dailyMap = new Map<string, TokenBreakdown & { date: string; model: string; costUsd: number; sessionIds: Set<string>; requestCount: number; messageCount: number }>();
  const dailyTotalsMap = new Map<string, TokenBreakdown & { date: string; costUsd: number; sessionIds: Set<string>; requestCount: number; messageCount: number }>();
  const modelMap = new Map<string, TokenBreakdown & { model: string; costUsd: number; requestCount: number; sessionIds: Set<string>; messageCount: number; priced: boolean }>();
  const projectMap = new Map<string, TokenBreakdown & { projectPath: string; projectName: string; costUsd: number; requestCount: number; sessionIds: Set<string>; lastActivity: number; models: Set<string> }>();
  const sessionMap = new Map<string, TokenBreakdown & { sessionId: string; project: string; cwd: string; startTime: number; endTime: number; model: string; entrypoint: string; costUsd: number; requestCount: number; messageCount: number }>();
  const total = createBreakdown();
  let totalCostUsd = 0;

  for (const request of requests) {
    addTokenBreakdown(total, request);
    totalCostUsd += request.costUsd;
    const date = localDateKey(request.timestamp);
    const dailyKey = `${date}|${request.model}`;
    const daily = dailyMap.get(dailyKey) ?? { ...createBreakdown(), date, model: request.model, costUsd: 0, sessionIds: new Set<string>(), requestCount: 0, messageCount: 0 };
    addTokenBreakdown(daily, request);
    daily.costUsd += request.costUsd;
    daily.sessionIds.add(request.sessionId);
    daily.requestCount++;
    daily.messageCount++;
    dailyMap.set(dailyKey, daily);

    const dailyTotal = dailyTotalsMap.get(date) ?? { ...createBreakdown(), date, costUsd: 0, sessionIds: new Set<string>(), requestCount: 0, messageCount: 0 };
    addTokenBreakdown(dailyTotal, request);
    dailyTotal.costUsd += request.costUsd;
    dailyTotal.sessionIds.add(request.sessionId);
    dailyTotal.requestCount++;
    dailyTotal.messageCount++;
    dailyTotalsMap.set(date, dailyTotal);

    const model = modelMap.get(request.model) ?? { ...createBreakdown(), model: request.model, costUsd: 0, requestCount: 0, sessionIds: new Set<string>(), messageCount: 0, priced: request.priced };
    addTokenBreakdown(model, request);
    model.costUsd += request.costUsd;
    model.requestCount++;
    model.sessionIds.add(request.sessionId);
    model.messageCount++;
    model.priced = model.priced || request.priced;
    modelMap.set(request.model, model);

    const projectKey = request.projectPath || request.projectName;
    const project = projectMap.get(projectKey) ?? { ...createBreakdown(), projectPath: request.projectPath || request.projectName, projectName: request.projectName, costUsd: 0, requestCount: 0, sessionIds: new Set<string>(), lastActivity: 0, models: new Set<string>() };
    addTokenBreakdown(project, request);
    project.costUsd += request.costUsd;
    project.requestCount++;
    project.sessionIds.add(request.sessionId);
    project.lastActivity = Math.max(project.lastActivity, request.timestamp);
    project.models.add(request.model);
    projectMap.set(projectKey, project);

    const session = sessionMap.get(request.sessionId) ?? { ...createBreakdown(), sessionId: request.sessionId, project: request.projectPath || request.projectName, cwd: request.projectPath || "", startTime: request.timestamp, endTime: request.timestamp, model: request.model, entrypoint: request.entrypoint ?? "dsh", costUsd: 0, requestCount: 0, messageCount: 0 };
    addTokenBreakdown(session, request);
    session.costUsd += request.costUsd;
    session.requestCount++;
    session.messageCount++;
    session.startTime = Math.min(session.startTime, request.timestamp);
    session.endTime = Math.max(session.endTime, request.timestamp);
    session.model = request.model;
    sessionMap.set(request.sessionId, session);
  }

  const daily = Array.from(dailyMap.values()).map(entry => ({ ...entry, sessionCount: entry.sessionIds.size, sessionIds: undefined as never })).map(({ sessionIds, ...entry }) => entry).sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model));
  const dailyTotals = Array.from(dailyTotalsMap.values()).map(entry => ({ ...entry, sessionCount: entry.sessionIds.size, sessionIds: undefined as never })).map(({ sessionIds, ...entry }) => entry).sort((a, b) => a.date.localeCompare(b.date));
  const modelTotals = Array.from(modelMap.values()).map(entry => ({
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    totalTokens: entry.totalTokens,
    costUsd: entry.costUsd,
    requestCount: entry.requestCount,
    sessionCount: entry.sessionIds.size,
    messageCount: entry.messageCount,
    cacheHitRatio: cacheHitRatio(entry),
    priced: entry.priced
  })).sort((a, b) => b.totalTokens - a.totalTokens);
  const projectTotals = Array.from(projectMap.values()).map(entry => ({
    projectPath: entry.projectPath,
    projectName: entry.projectName,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    totalTokens: entry.totalTokens,
    costUsd: entry.costUsd,
    requestCount: entry.requestCount,
    sessionCount: entry.sessionIds.size,
    lastActivity: entry.lastActivity,
    models: Array.from(entry.models).sort(),
    cacheHitRatio: cacheHitRatio(entry)
  })).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20);

  return {
    sessions: Array.from(sessionMap.values()).sort((a, b) => b.endTime - a.endTime).slice(0, 50),
    daily,
    modelTotals,
    dailyTotals,
    projectTotals,
    // "高消耗请求" ranks by spend: cost desc, tiebreaking on total tokens so unpriced
    // requests (costUsd 0) still land in a stable size order at the bottom rather than
    // scrambling the cost column (which reads as random when sorted by tokens instead).
    recentRequests: requests.slice().sort((a, b) => (b.costUsd - a.costUsd) || (b.totalTokens - a.totalTokens)).slice(0, 30),
    totalTokens: total.totalTokens,
    totalCostUsd,
    totalSessions: sessionMap.size,
    totalRequests: requests.length,
    cacheHitRatio: cacheHitRatio(total),
    pricing: currentPricingStatus(),
    lastScannedAt: scannedAt,
    scanning: false
  };
}

async function getClaudeTokenStats(force = false) {
  const now = Date.now();
  if (!force && claudeTokenStatsCache && now - claudeTokenStatsCache.timestamp < CLAUDE_TOKEN_CACHE_TTL) {
    return claudeTokenStatsCache.data;
  }
  if (!force && claudeTokenStatsCache && now - claudeTokenStatsCache.timestamp < CLAUDE_TOKEN_STALE_TTL) {
    if (!pendingClaudeTokenStatsScan) {
      pendingClaudeTokenStatsScan = scanClaudeTokenStatsFresh()
        .then(data => {
          claudeTokenStatsCache = { data, timestamp: Date.now() };
          return data;
        })
        .finally(() => { pendingClaudeTokenStatsScan = null; });
    }
    return claudeTokenStatsCache.data;
  }
  if (pendingClaudeTokenStatsScan) return pendingClaudeTokenStatsScan;
  pendingClaudeTokenStatsScan = scanClaudeTokenStatsFresh(force)
    .then(data => {
      claudeTokenStatsCache = { data, timestamp: Date.now() };
      return data;
    })
    .catch(() => emptyClaudeTokenStats())
    .finally(() => { pendingClaudeTokenStatsScan = null; });
  return pendingClaudeTokenStatsScan;
}

// The recent-edits snapshot is a by-product of the token scan, so serving it just means making
// sure that scan is fresh (same TTL / stale-while-revalidate policy) and returning the aggregate.
async function getClaudeRecentEdits(force = false): Promise<RecentEditsSnapshot> {
  await getClaudeTokenStats(force);
  return claudeRecentEditsSnapshot;
}

// Same for the tool / skill / subagent usage rankings.
async function getClaudeUsageRankings(force = false): Promise<UsageRankingsSnapshot> {
  await getClaudeTokenStats(force);
  return claudeUsageRankingsSnapshot;
}

async function getDshAnalytics(force = false): Promise<DshAnalyticsSnapshot> {
  await getClaudeTokenStats(force);
  return dshAnalyticsSnapshot;
}

function collectClaudeJsonlFiles(projectsDir: string) {
  const files: Array<{ filePath: string; encodedProject: string }> = [];
  try {
    if (!existsSync(projectsDir)) return files;
    for (const projectEntry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) continue;
      const projectDir = join(projectsDir, projectEntry.name);
      for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push({ filePath: join(projectDir, entry.name), encodedProject: projectEntry.name });
        }
      }
    }
  } catch {
    return files;
  }
  return files;
}

function textFromClaudeContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(block => {
      if (!block || typeof block !== "object") return "";
      const value = block as Record<string, unknown>;
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
      if (typeof value.name === "string") return value.name;
      if (typeof value.type === "string" && value.type !== "text") return `[${value.type}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function timestampFromRecord(record: Record<string, unknown>, fallback: number) {
  const raw = record.timestamp ?? record.created_at ?? record.updated_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 10_000_000_000 ? raw : raw * 1000;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function roleFromRecord(record: Record<string, unknown>): ClaudeSessionMessage["role"] {
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const role = (message as Record<string, unknown>).role;
    if (role === "user" || role === "assistant" || role === "system") return role;
  }
  const type = record.type;
  if (type === "system") return "system";
  if (type === "tool_result") return "tool";
  return "unknown";
}

function textFromRecord(record: Record<string, unknown>) {
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const value = message as Record<string, unknown>;
    const text = textFromClaudeContent(value.content);
    if (text) return text;
  }
  return textFromClaudeContent(record.content) || (typeof record.summary === "string" ? record.summary : "");
}

function sessionIdFromPath(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  return name.replace(/\.jsonl$/i, "") || name;
}

function isAllowedClaudeSessionFile(filePath: string) {
  try {
    const paths = getClaudePaths();
    const resolvedTarget = resolve(filePath);
    const resolvedProjects = resolve(paths.projectsDir);
    return resolvedTarget.endsWith(".jsonl") && (resolvedTarget === resolvedProjects || resolvedTarget.startsWith(`${resolvedProjects}\\`) || resolvedTarget.startsWith(`${resolvedProjects}/`));
  } catch {
    return false;
  }
}

async function getClaudeSessionDetail(filePath: string) {
  if (typeof filePath !== "string" || !isAllowedClaudeSessionFile(filePath)) throw new Error("Invalid Claude session path");
  const paths = getClaudePaths();
  const resolved = resolve(filePath);
  const resolvedProjects = resolve(paths.projectsDir);
  const relative = resolved.slice(resolvedProjects.length + 1);
  const encodedProject = relative.split(/[\\/]/)[0] ?? "";
  const session = await scanSingleClaudeSessionStream(filePath, encodedProject);
  const messages: ClaudeSessionMessage[] = [];

  await visitJsonlTail(filePath, CLAUDE_SESSION_DETAIL_MAX_BYTES, (rawLine, index) => {
    const line = rawLine.replace(/^﻿/, "").trim();
    if (!line) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const record = parsed as Record<string, unknown>;
      const text = textFromRecord(record);
      const role = roleFromRecord(record);
      if (!text || (role !== "user" && role !== "assistant")) return;
      const message = record.message && typeof record.message === "object" && !Array.isArray(record.message)
        ? record.message as Record<string, unknown>
        : null;
      messages.push({
        id: `${session.sessionId}:${index}`,
        role,
        text: text.slice(0, 4000),
        timestamp: timestampFromRecord(record, session.lastMessageAt),
        model: typeof message?.model === "string" ? message.model : typeof record.model === "string" ? record.model : undefined,
        toolName: typeof record.toolName === "string" ? record.toolName : undefined
      });
      if (messages.length > CLAUDE_SESSION_DETAIL_MAX_MESSAGES) messages.shift();
    } catch {
      // Ignore broken JSONL rows in read-only viewer mode.
    }
  });

  return { session, messages, totalMessages: session.messageCount };
}

// Actionable errors shared by both PowerShell terminal-launch paths.
const POWERSHELL_NOT_FOUND_ERROR = "Windows PowerShell wasn't found at System32\\WindowsPowerShell\\v1.0. Is this a standard Windows install?";
const CMD_NOT_FOUND_ERROR = "The Windows command processor (System32\\cmd.exe) wasn't found, so a PowerShell window can't be opened. Is this a standard Windows install?";
function claudeUnavailableError(reason: "not-found" | "batch-only"): string {
  return reason === "batch-only"
    ? "Only a claude.cmd/.bat batch shim is on PATH. DSH Desk runs Claude as a native PowerShell command, so install the native Claude CLI (claude.exe) or put claude.ps1 on PATH."
    : "Claude Code (claude.exe or claude.ps1) isn't on PATH. Install it — or restart DSH Desk if you just installed it — then try again.";
}

async function resumeClaudeSession(sessionId: string, projectPath?: string) {
  const safeSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!/^[a-zA-Z0-9._:-]{6,200}$/.test(safeSessionId)) return { ok: false, command: "", error: "Invalid session id" };
  const command = `claude --resume ${safeSessionId}`;

  if (process.platform !== "win32") {
    return { ok: false, command, error: "Terminal launch is only implemented on Windows in this build" };
  }
  const powershell = trustedPowerShellPath(process.env);
  if (!powershell) return { ok: false, command, error: POWERSHELL_NOT_FOUND_ERROR };
  // cmd is only the launcher: `cmd /c start` opens a normal, visible PowerShell window
  // and Claude runs inside PowerShell, never inside cmd. A bare detached powershell.exe
  // gets no console and runs windowless (a false success), so we go through `start`.
  const cmd = trustedCmdPath(process.env);
  if (!cmd) return { ok: false, command, error: CMD_NOT_FOUND_ERROR };
  // Resolve claude to a trusted native entry point (claude.exe / claude.ps1) from
  // PATH only, never the session's cwd — so a project-local shim can't shadow it. Not
  // copyable: if claude can't run here it can't run from the copied command either.
  const claude = resolveClaudeExecutable(process.env);
  if (!claude.ok) return { ok: false, command, error: claudeUnavailableError(claude.reason) };
  // Home only when the session recorded no cwd; a recorded-but-unavailable cwd fails
  // (never silently resume in home). claude resolved, so the copied command is a real
  // recovery — mark it copyable. The path is omitted from the message in privacy mode.
  const resolved = resolveSessionCwd(projectPath, homedir());
  if (!resolved.ok) {
    return { ok: false, command, error: sessionFolderUnavailableMessage(resolved.path, companionSettings.hideSensitiveContent), copyable: true };
  }
  // cmd can't take a UNC/extended-length cwd — it silently drops to C:\Windows yet exits 0.
  // Normalize an extended local path; reject UNC so we never launch in the wrong folder.
  const launchCwd = normalizeCmdCwd(resolved.cwd);
  if (!launchCwd.ok) {
    return { ok: false, command, error: uncNotSupportedMessage(resolved.cwd, companionSettings.hideSensitiveContent), copyable: true };
  }
  // Trusted claude path + validated id ride in child-only env vars; a fixed PowerShell
  // call-operator command invokes them, so no value is interpolated into the command.
  const env = mergeTerminalEnv({ [CHARA_DESK_CLAUDE_ENV]: claude.path, [CHARA_DESK_RESUME_ID_ENV]: safeSessionId }, process.env);
  const { file, args } = buildPowerShellLaunch(cmd, powershell, PS_RESUME_CLAUDE, env);
  const result = await launchDetachedTerminal(file, args, { cwd: launchCwd.cwd, env });
  return result.ok
    ? { ok: true, command, cwd: resolved.cwd }
    : { ok: false, command, error: launchFailedMessage(result.error, companionSettings.hideSensitiveContent), copyable: true };
}

function getCompanionEvents() {
  return eventHistory.map(toCompanionEvent);
}

function getClaudeSettingsPath() {
  const claudeDir = join(homedir(), ".claude");
  return join(claudeDir, "settings.json");
}

function readLiveJsonObject(path: string) {
  if (!existsSync(path)) return {} as Record<string, any>;
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return {} as Record<string, any>;
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, any> : {} as Record<string, any>;
}

function sanitizeClaudeSettingsConfig(config: Record<string, any>) {
  const next = { ...config };
  delete next.api_format;
  delete next.apiFormat;
  delete next.openrouter_compat_mode;
  delete next.openrouterCompatMode;
  return next;
}

async function openClaudeProviderTerminal(providerId: string, cwd: string) {
  const listed = listUnifiedProviders();
  const provider = listed.providers.find(item => item.id === providerId);
  if (!provider) return { ok: false, command: "", error: `Provider ${providerId} not found` };
  if (process.platform !== "win32") {
    return { ok: false, command: "", error: "Terminal launch is only implemented on Windows in this build" };
  }
  // A provider terminal exists to run `claude` against the project the user picked,
  // so that working directory is the point. Refuse anything that isn't a real
  // directory instead of silently falling back to the home folder; the path is
  // omitted from the message in privacy mode.
  const workingDir = typeof cwd === "string" ? cwd.trim() : "";
  if (!workingDir || !isDirectoryPath(workingDir)) {
    return { ok: false, command: "", error: notAFolderMessage(workingDir, companionSettings.hideSensitiveContent) };
  }
  // cmd can't take a UNC/extended-length cwd — it silently drops to C:\Windows yet exits 0.
  // Normalize an extended local path; reject UNC so we never launch in the wrong folder.
  const launchCwd = normalizeCmdCwd(workingDir);
  if (!launchCwd.ok) {
    return { ok: false, command: "", error: uncNotSupportedMessage(workingDir, companionSettings.hideSensitiveContent) };
  }
  const powershell = trustedPowerShellPath(process.env);
  if (!powershell) return { ok: false, command: "", error: POWERSHELL_NOT_FOUND_ERROR };
  // cmd is only the launcher: `cmd /c start` opens a normal, visible PowerShell window
  // and Claude runs inside PowerShell, never inside cmd. A bare detached powershell.exe
  // gets no console and runs windowless (a false success), so we go through `start`.
  const cmd = trustedCmdPath(process.env);
  if (!cmd) return { ok: false, command: "", error: CMD_NOT_FOUND_ERROR };
  // The provider's routing env (base URL, tokens) is handed to the child through spawn's
  // `env` (never argv, never disk), but providerTerminalEnv rejects PATH. Resolve Claude
  // against the inherited process environment before overlaying provider values, so an
  // imported provider cannot select a planted executable. Its absolute path rides in a
  // child-only env var invoked by a fixed PowerShell call-operator command, so a
  // project-local shim can't shadow it and no value is interpolated into the command.
  const claude = resolveClaudeExecutable(process.env);
  if (!claude.ok) return { ok: false, command: "", error: claudeUnavailableError(claude.reason) };
  const baseEnv = mergeTerminalEnv(providerTerminalEnv(provider.settingsConfig), process.env);
  const command = "claude";
  const env = mergeTerminalEnv({ [CHARA_DESK_CLAUDE_ENV]: claude.path }, baseEnv);
  const { file, args } = buildPowerShellLaunch(cmd, powershell, PS_RUN_CLAUDE, env);
  const result = await launchDetachedTerminal(file, args, { cwd: launchCwd.cwd, env });
  return result.ok
    ? { ok: true, command }
    : { ok: false, command, error: launchFailedMessage(result.error, companionSettings.hideSensitiveContent) };
}

/* ---------- unified Claude provider service (cc-switch db when present) ---------- */

function ccSwitchModeActive() {
  return getCcSwitchStatus().available;
}

function localProviders(): Record<string, CcSwitchProvider> {
  const stored = companionSettings.claudeProviders;
  if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
    return stored as Record<string, CcSwitchProvider>;
  }
  return {};
}

function saveLocalProviders(next: Record<string, CcSwitchProvider>, currentId?: string) {
  companionSettings = {
    ...companionSettings,
    claudeProviders: next,
    ...(currentId !== undefined ? { currentClaudeProviderId: currentId } : {})
  };
  saveCompanionSettings(true);
  broadcastCompanionSettings();
}

function localCurrentProviderId(providers: Record<string, CcSwitchProvider>) {
  const pointer = typeof companionSettings.currentClaudeProviderId === "string" ? companionSettings.currentClaudeProviderId : "";
  if (pointer && providers[pointer]) return pointer;
  return Object.values(providers).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))[0]?.id ?? "";
}

function listUnifiedProviders() {
  const status = getCcSwitchStatus();
  if (status.available) {
    try {
      const providers = listCcSwitchProviders();
      return {
        ok: true,
        source: "cc-switch" as const,
        dbPath: status.dbPath,
        providers,
        currentId: getCurrentCcSwitchProviderId(providers),
        hasCommonConfig: getCommonConfigSnippet().trim().length > 0
      };
    } catch (error) {
      const providers = localProviders();
      return {
        ok: true,
        source: "local" as const,
        dbPath: status.dbPath,
        readError: error instanceof Error ? error.message : String(error),
        providers: Object.values(providers),
        currentId: localCurrentProviderId(providers),
        hasCommonConfig: false
      };
    }
  }
  const providers = localProviders();
  return {
    ok: true,
    source: "local" as const,
    dbPath: status.dbPath,
    providers: Object.values(providers),
    currentId: localCurrentProviderId(providers),
    hasCommonConfig: false
  };
}

function saveUnifiedProvider(provider: CcSwitchProvider, originalId?: string) {
  if (ccSwitchModeActive()) {
    const exists = originalId
      ? listCcSwitchProviders().some(item => item.id === originalId)
      : listCcSwitchProviders().some(item => item.id === provider.id);
    if (exists) {
      const warnings = updateCcSwitchProvider(provider, originalId);
      return { ok: true, provider, warnings };
    }
    return { ok: true, provider: addCcSwitchProvider(provider) };
  }
  const providers = { ...localProviders() };
  if (originalId && originalId !== provider.id) delete providers[originalId];
  const record = { ...provider, id: provider.id?.trim() || `provider-${Date.now().toString(36)}` };
  providers[record.id] = record;
  const currentId = localCurrentProviderId(providers);
  saveLocalProviders(providers, currentId === originalId ? record.id : currentId);
  return { ok: true, provider: record };
}

function deleteUnifiedProvider(id: string) {
  if (ccSwitchModeActive()) {
    deleteCcSwitchProvider(id);
    return { ok: true };
  }
  const providers = { ...localProviders() };
  if (Object.keys(providers).length <= 1) return { ok: false, error: "At least one provider is required" };
  delete providers[id];
  const fallback = Object.values(providers).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))[0]?.id ?? "";
  const currentId = localCurrentProviderId(providers);
  saveLocalProviders(providers, currentId === id ? fallback : currentId);
  return { ok: true };
}

function duplicateUnifiedProvider(id: string) {
  if (ccSwitchModeActive()) {
    return { ok: true, provider: duplicateCcSwitchProvider(id) };
  }
  const providers = { ...localProviders() };
  const source = providers[id];
  if (!source) return { ok: false, error: `Provider ${id} not found` };
  // Same placement as cc-switch: the copy sits right below the original.
  const newSortIndex = source.sortIndex !== undefined ? source.sortIndex + 1 : Object.keys(providers).length;
  if (source.sortIndex !== undefined) {
    for (const [key, provider] of Object.entries(providers)) {
      if (key !== id && provider.sortIndex !== undefined && provider.sortIndex >= newSortIndex) {
        providers[key] = { ...provider, sortIndex: provider.sortIndex + 1 };
      }
    }
  }
  const copy: CcSwitchProvider = {
    ...JSON.parse(JSON.stringify(source)) as CcSwitchProvider,
    id: `provider-${Date.now().toString(36)}`,
    name: `${source.name} copy`,
    createdAt: Date.now(),
    sortIndex: newSortIndex
  };
  providers[copy.id] = copy;
  saveLocalProviders(providers);
  return { ok: true, provider: copy };
}

function reorderUnifiedProviders(orderedIds: string[]) {
  if (ccSwitchModeActive()) {
    reorderCcSwitchProviders(orderedIds);
    return { ok: true };
  }
  const providers = { ...localProviders() };
  orderedIds.forEach((id, index) => {
    if (providers[id]) providers[id] = { ...providers[id], sortIndex: index };
  });
  saveLocalProviders(providers);
  return { ok: true };
}

function switchUnifiedProvider(id: string) {
  if (ccSwitchModeActive()) {
    const outcome = switchCcSwitchProvider(id);
    if (outcome.ok) {
      // Mirror the cc-switch records locally so terminal launch and the local
      // provider list stay in sync with the active selection.
      const providers = listCcSwitchProviders();
      const target = providers.find(provider => provider.id === id);
      if (target) {
        companionSettings = {
          ...companionSettings,
          claudeProviders: Object.fromEntries(providers.map(provider => [provider.id, provider])),
          currentClaudeProviderId: id
        };
        saveCompanionSettings(true);
        broadcastCompanionSettings();
      }
    }
    return outcome;
  }

  // Local fallback keeps cc-switch semantics: backfill the outgoing record,
  // then replace the live file with the incoming provider's settings.
  const providers = { ...localProviders() };
  const target = providers[id];
  if (!target) return { ok: false, warnings: [], error: `Provider ${id} not found` };
  const warnings: string[] = [];
  const livePath = getClaudeSettingsPath();
  const currentId = localCurrentProviderId(providers);
  if (currentId && currentId !== id && providers[currentId]) {
    const live = readLiveJsonObject(livePath);
    if (Object.keys(live).length > 0) {
      providers[currentId] = { ...providers[currentId], settingsConfig: live };
    }
  }
  let backupPath: string | null = null;
  try {
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    backupPath = backupJsonFile(livePath);
    const effective = sanitizeClaudeSettingsConfig((target.settingsConfig ?? {}) as Record<string, any>);
    writeTextFileAtomic(livePath, `${JSON.stringify(effective, null, 2)}\n`);
  } catch (error) {
    return { ok: false, warnings, error: error instanceof Error ? error.message : String(error) };
  }
  saveLocalProviders(providers, id);
  return { ok: true, path: livePath, backupPath, warnings };
}

/**
 * Reachability check matching cc-switch's stream check: probes base_url
 * only (no auth), honoring the provider's custom User-Agent and optional
 * per-provider meta.testConfig overrides when enabled.
 */
async function testUnifiedProvider(payload: { id?: string; baseUrl?: string }) {
  let baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl : "";
  let userAgent: string | undefined;
  let timeoutMs: number | undefined;
  let maxRetries: number | undefined;
  let degradedThresholdMs: number | undefined;
  if (payload?.id) {
    const listed = listUnifiedProviders();
    const provider = listed.providers.find(item => item.id === payload.id);
    if (!baseUrl) {
      const env = provider?.settingsConfig && typeof provider.settingsConfig === "object"
        ? (provider.settingsConfig as Record<string, any>).env as Record<string, any> | undefined
        : undefined;
      baseUrl = typeof env?.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : "";
    }
    const meta = provider?.meta as Record<string, any> | undefined;
    if (typeof meta?.customUserAgent === "string" && meta.customUserAgent.trim()) userAgent = meta.customUserAgent.trim();
    const testConfig = meta?.testConfig as Record<string, any> | undefined;
    if (testConfig?.enabled) {
      if (typeof testConfig.timeoutSecs === "number") timeoutMs = testConfig.timeoutSecs * 1000;
      if (typeof testConfig.maxRetries === "number") maxRetries = testConfig.maxRetries;
      if (typeof testConfig.degradedThresholdMs === "number") degradedThresholdMs = testConfig.degradedThresholdMs;
    }
  }
  return probeClaudeEndpoint(baseUrl, { userAgent, timeoutMs, maxRetries, degradedThresholdMs });
}

function broadcastCcSwitchChanged() {
  for (const target of [panelWindow, petWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send("companion:ccswitch-changed", { at: Date.now() });
  }
}

function broadcastPetPacksChanged() {
  for (const target of [panelWindow, petWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send("companion:pet-packs-changed", { at: Date.now() });
  }
}

function getConnectionStatus() {
  const latest = eventHistory[0] ? toCompanionEvent(eventHistory[0]) : undefined;
  // No single "connected" flag: a past event does not prove the live link is
  // healthy. Callers derive readiness from serverListening + hook status, and
  // report the most recent event (lastEventAt) as a separate fact.
  return {
    port: eventPort,
    serverListening: Boolean(eventServer?.listening),
    activeSessionId: sessionId,
    activeClientType: "desktop",
    activeClientLabel: "DSH Desk",
    lastEventAt: latest?.timestamp,
    lastEventTitle: latest?.title,
    lastEventType: latest?.event,
    lastEventSource: latest?.source
  };
}

function settingsPath() {
  return join(app.getPath("userData"), "companion-settings.json");
}

function petPacksDir() {
  return join(app.getPath("userData"), "pets");
}

function petDownloadsDir() {
  return join(app.getPath("userData"), "pet-downloads");
}

function loadCompanionSettings() {
  try {
    if (existsSync(settingsPath())) {
      const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Only the canonical schema enters memory; unknown keys are ignored
        // here and therefore never written back on the next save.
        const canonical = pickCanonicalSettings(parsed);
        companionSettings = { ...companionSettings, ...canonical, ...normalizePetDisplaySettings(canonical) };
      }
    }
  } catch { /* ignore corrupt settings */ }
}

function broadcastCompanionSettings() {
  for (const target of [panelWindow, petWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send("companion:settings", companionSettings);
  }
}

function broadcastCompanionConnection() {
  const status = getConnectionStatus();
  for (const target of [panelWindow, petWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send("companion:connection", status);
  }
}

function writeCompanionSettings() {
  if (companionSettingsSaveTimer) {
    clearTimeout(companionSettingsSaveTimer);
    companionSettingsSaveTimer = null;
  }
  try { writeTextFileAtomic(settingsPath(), JSON.stringify(companionSettings, null, 2)); } catch { /* best effort */ }
}

function saveCompanionSettings(immediate = false) {
  if (immediate) {
    writeCompanionSettings();
    return;
  }
  if (companionSettingsSaveTimer) clearTimeout(companionSettingsSaveTimer);
  companionSettingsSaveTimer = setTimeout(writeCompanionSettings, 350);
}

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function runtimeStatsPath() {
  return join(app.getPath("userData"), "dsh-runtime-stats.json");
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
  ) as Record<string, number>;
}

function normalizeHourlyBuckets(value: unknown): number[] {
  return Array.isArray(value) && value.length === 24
    ? value.map((count: unknown) => typeof count === "number" && Number.isFinite(count) ? count : 0)
    : new Array(24).fill(0);
}

function normalizeDailyStats(value: unknown): Record<string, DailyRuntimeStats> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([day, entry]) => {
      const row = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
      return [day, {
        events: typeof row.events === "number" ? row.events : 0,
        toolCalls: typeof row.toolCalls === "number" ? row.toolCalls : 0,
        sessions: typeof row.sessions === "number" ? row.sessions : 0,
        errors: typeof row.errors === "number" ? row.errors : 0,
        permissionRequests: typeof row.permissionRequests === "number" ? row.permissionRequests : 0
      }];
    })
  );
}

function normalizeDailyHourlyActivity(value: unknown): Record<string, number[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([day, buckets]) => [day, normalizeHourlyBuckets(buckets)])
  );
}

function normalizeDailyToolUsage(value: unknown): Record<string, Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([day, usage]) => [day, normalizeNumberRecord(usage)])
  );
}

function normalizeDailySessionIds(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([day, ids]) => [
      day,
      Array.isArray(ids) ? Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))) : []
    ])
  );
}

function createRuntimeStats(): RuntimeStats {
  return {
    toolUsage: {},
    eventTypeCounts: {},
    totalSessions: 0,
    dailyStats: {},
    errorCount: 0,
    permissionRequests: 0,
    permissionApproved: 0,
    permissionDenied: 0,
    totalRuntime: 0,
    hourlyActivity: new Array(24).fill(0),
    dailyHourlyActivity: {},
    dailyToolUsage: {},
    dailySessionIds: {},
    firstStartTime: appStartedAt,
    lastEventTime: 0
  };
}

function normalizeRuntimeStats(value: unknown): RuntimeStats {
  const base = createRuntimeStats();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const raw = value as Partial<RuntimeStats>;
  return {
    toolUsage: normalizeNumberRecord(raw.toolUsage),
    eventTypeCounts: normalizeNumberRecord(raw.eventTypeCounts),
    totalSessions: typeof raw.totalSessions === "number" ? raw.totalSessions : 0,
    dailyStats: normalizeDailyStats(raw.dailyStats),
    errorCount: typeof raw.errorCount === "number" ? raw.errorCount : 0,
    permissionRequests: typeof raw.permissionRequests === "number" ? raw.permissionRequests : 0,
    permissionApproved: typeof raw.permissionApproved === "number" ? raw.permissionApproved : 0,
    permissionDenied: typeof raw.permissionDenied === "number" ? raw.permissionDenied : 0,
    totalRuntime: typeof raw.totalRuntime === "number" ? raw.totalRuntime : 0,
    hourlyActivity: normalizeHourlyBuckets(raw.hourlyActivity),
    dailyHourlyActivity: normalizeDailyHourlyActivity(raw.dailyHourlyActivity),
    dailyToolUsage: normalizeDailyToolUsage(raw.dailyToolUsage),
    dailySessionIds: normalizeDailySessionIds(raw.dailySessionIds),
    firstStartTime: typeof raw.firstStartTime === "number" && raw.firstStartTime > 0 ? raw.firstStartTime : appStartedAt,
    lastEventTime: typeof raw.lastEventTime === "number" ? raw.lastEventTime : 0
  };
}

function loadRuntimeStats() {
  if (runtimeStats) return runtimeStats;
  try {
    if (existsSync(runtimeStatsPath())) {
      runtimeStats = normalizeRuntimeStats(JSON.parse(readFileSync(runtimeStatsPath(), "utf8")));
    }
  } catch { /* ignore corrupt stats */ }
  if (!runtimeStats) {
    runtimeStats = createRuntimeStats();
    runtimeStatsDirty = true;
  }
  return runtimeStats;
}

function writeRuntimeStats() {
  if (runtimeStatsSaveTimer) {
    clearTimeout(runtimeStatsSaveTimer);
    runtimeStatsSaveTimer = null;
  }
  if (!runtimeStats) return;
  try {
    writeTextFileAtomic(runtimeStatsPath(), JSON.stringify(runtimeStats, null, 2));
    runtimeStatsDirty = false;
  } catch { /* best effort */ }
}

function saveRuntimeStats(force = false) {
  if (!runtimeStats || (!force && !runtimeStatsDirty)) return;
  if (force) {
    writeRuntimeStats();
    return;
  }
  if (!runtimeStatsSaveTimer) runtimeStatsSaveTimer = setTimeout(writeRuntimeStats, 750);
}

// dailyStats is tiny (a handful of numbers per day), so keep the FULL history — "全部"
// should mean all-time, and one calendar entry/day is trivial even over many years.
// Only the heavier per-day maps (24 hourly buckets + a tool map each) get a long safety
// cap so an extreme multi-year install can't grow them without bound. Keys are
// YYYY-MM-DD, so a lexicographic compare against the cutoff is correct. Runs only on a
// day rollover, so it costs ~nothing.
const HEAVY_DAILY_RETENTION_DAYS = 730; // ~2 years

function pruneRuntimeStatsDays(stats: ReturnType<typeof loadRuntimeStats>): void {
  const cutoff = localDateKey(Date.now() - HEAVY_DAILY_RETENTION_DAYS * 86_400_000);
  for (const key of Object.keys(stats.dailyHourlyActivity)) if (key < cutoff) delete stats.dailyHourlyActivity[key];
  for (const key of Object.keys(stats.dailyToolUsage)) if (key < cutoff) delete stats.dailyToolUsage[key];
  for (const key of Object.keys(stats.dailySessionIds)) if (key < cutoff) delete stats.dailySessionIds[key];
}

function recordRuntimeEvent(event: CompanionEvent, dshSessionId?: string) {
  if (event.source !== "deepseek-harness") return;
  const stats = loadRuntimeStats();
  stats.eventTypeCounts[event.event] = (stats.eventTypeCounts[event.event] ?? 0) + 1;
  const isToolCall = event.event === "tool_start" && event.tool !== undefined;
  if (isToolCall) stats.toolUsage[event.tool!] = (stats.toolUsage[event.tool!] ?? 0) + 1;
  if (event.event === "error") stats.errorCount++;
  if (event.event === "permission_wait") stats.permissionRequests++;
  const date = new Date(event.timestamp);
  const day = localDateKey(event.timestamp);
  const isNewDay = !(day in stats.dailyStats);
  const hour = date.getHours();
  stats.hourlyActivity[hour]++;
  stats.dailyHourlyActivity[day] ??= new Array(24).fill(0);
  stats.dailyHourlyActivity[day][hour]++;
  stats.dailyStats[day] ??= { events: 0, toolCalls: 0, sessions: 0, errors: 0, permissionRequests: 0 };
  stats.dailyStats[day].events++;
  if (isToolCall) {
    stats.dailyStats[day].toolCalls++;
    stats.dailyToolUsage[day] ??= {};
    stats.dailyToolUsage[day][event.tool!] = (stats.dailyToolUsage[day][event.tool!] ?? 0) + 1;
  }
  // Any event can be the first one seen after DSH Desk starts, so count sessions by the
  // durable DSH session id instead of relying on a single lifecycle event.
  recordSessionSighting(stats.dailyStats[day], (stats.dailySessionIds[day] ??= []), dshSessionId);
  if (event.event === "error") stats.dailyStats[day].errors = (stats.dailyStats[day].errors ?? 0) + 1;
  if (event.event === "permission_wait") stats.dailyStats[day].permissionRequests = (stats.dailyStats[day].permissionRequests ?? 0) + 1;
  if (!stats.firstStartTime || stats.firstStartTime > event.timestamp) stats.firstStartTime = event.timestamp;
  stats.lastEventTime = Math.max(stats.lastEventTime ?? 0, event.timestamp);
  if (isNewDay) pruneRuntimeStatsDays(stats);
  runtimeStatsDirty = true;
  saveRuntimeStats();
}

function recordPermissionDecision(decision?: string) {
  if (decision !== "allow" && decision !== "deny") return;
  const stats = loadRuntimeStats();
  if (decision === "allow") stats.permissionApproved++;
  else stats.permissionDenied++;
  runtimeStatsDirty = true;
  saveRuntimeStats();
}

/**
 * Owns pending permission requests posted to /permission by the hook
 * forwarder. When a request settles (user decision, timeout, or quit) the
 * onSettled callback tells every window to dismiss its permission card.
 */
// How long the pet waits for the user's allow/deny before Claude Code falls back
// to its own terminal prompt — user-configurable via the "Permission wait" slider
// (permissionWaitSeconds). The forwarder's long-poll and the PreToolUse hook
// timeout are set above this so the fallback is graceful (bubble dismisses + a
// single native prompt), never a premature hook kill. See
// PRETOOLUSE_HOOK_TIMEOUT_SECONDS.
const MIN_PERMISSION_WAIT_SECONDS = 5;
const MAX_PERMISSION_WAIT_SECONDS = 60;
const DEFAULT_PERMISSION_WAIT_SECONDS = 30;

function getPermissionWaitMs() {
  const seconds = companionSettings.permissionWaitSeconds;
  const clamped = typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.max(MIN_PERMISSION_WAIT_SECONDS, Math.min(MAX_PERMISSION_WAIT_SECONDS, seconds))
    : DEFAULT_PERMISSION_WAIT_SECONDS;
  return clamped * 1000;
}

const permissionBroker = new PermissionBroker({
  defaultTimeoutMs: DEFAULT_PERMISSION_WAIT_SECONDS * 1000,
  onSettled: (pending, result) => {
    recordPermissionDecision(result.decision);
    for (const target of [petWindow, panelWindow]) {
      if (target && !target.isDestroyed()) target.webContents.send("companion:permission-resolved", { id: pending.id, decision: result.decision });
    }
    if (permissionBroker.size === 0) setPetWindowExpanded(false);
  }
});

/**
 * Surface a new permission request: show the card in both windows and fire
 * exactly one notification/sound (respecting notificationRules). This is the
 * ONLY place a permission alert originates — tool events never alert.
 */
function announcePermissionRequest(pending: PendingPermission) {
  setPetWindowExpanded(true);
  for (const target of [petWindow, panelWindow]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send("companion:permission-request", {
        id: pending.id,
        toolName: normalizeTool(pending.toolName),
        toolDetail: pending.toolDetail,
        sessionId: pending.sessionId,
        timestamp: pending.timestamp,
        rawPayload: {}
      });
    }
  }
  handleCompanionAlerts({
    id: pending.id,
    source: "manual",
    event: "permission_wait",
    sessionId: pending.sessionId,
    clientType: "cli",
    clientLabel: "DeepSeek Harness",
    tool: normalizeTool(pending.toolName),
    title: pending.toolName ? `${pending.toolName} 需要确认` : "需要确认",
    message: pending.toolDetail ?? "DeepSeek Harness 正在等待你的授权",
    detail: pending.toolDetail,
    timestamp: pending.timestamp
  });
}

function handlePermissionRequest(payload: unknown): { id?: string } {
  // When the pet permission card is off, return no id so the DSH approval
  // waterfall continues to its next answerer.
  if (companionSettings.permissionDialogEnabled === false) return {};
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const pending = permissionBroker.create({
    toolName: typeof body.toolName === "string" ? body.toolName : "Unknown",
    toolDetail: typeof body.toolDetail === "string" ? body.toolDetail : undefined,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    rawPayload: body.rawPayload && typeof body.rawPayload === "object" ? body.rawPayload as Record<string, unknown> : {},
    timeoutMs: getPermissionWaitMs()
  });
  announcePermissionRequest(pending);
  return { id: pending.id };
}

function respondPermission(id: string, decision: "allow" | "deny", reason?: string) {
  return permissionBroker.respond({ id, decision, reason });
}

function getStats() {
  const persisted = loadRuntimeStats();
  // "会话" is derived from the per-day distinct-session counts (always consistent with the
  // range views, which sum dailyStats), and the raw per-day session ids never leave the
  // process. dailyStats is kept all-time, so this sum is complete.
  const { dailySessionIds, ...rest } = persisted;
  const totalSessions = Object.values(persisted.dailyStats).reduce((sum, day) => sum + (day.sessions ?? 0), 0);
  return { ...rest, totalSessions, totalRuntime: (persisted.totalRuntime ?? 0) + (Date.now() - appStartedAt) };
}

function getSessionHistory() {
  const events = getCompanionEvents().map(event => ({ id: event.id, event, timestamp: event.timestamp })).reverse();
  return [{
    sessionId,
    title: "DSH Desk",
    clientLabel: "DSH Desk",
    startedAt: appStartedAt,
    lastEventAt: eventHistory[0]?.timestamp ?? appStartedAt,
    eventCount: events.length,
    status: currentState === "completed" ? "done" : "active",
    events
  }];
}

function dshPluginManagerOptions(): DshPluginManagerOptions {
  return {
    profilesRoot: join(resolveDshHome(), "profiles"),
    pluginPath: resolveBundledDshPluginPath(app.getAppPath(), process.resourcesPath ?? "", app.isPackaged),
    npxPath: findNpxExecutable()
  };
}

function dshPluginCatalog() {
  return new DshPluginCatalog({
    dshHome: resolveDshHome(),
    npxPath: findNpxExecutable(),
    marketplaceCachePath: join(app.getPath("userData"), "awesome-dsh-plugin-cache.json")
  });
}

function dshResourceInventory(): DshResourceInventory {
  const runtimeSnapshot = dshRuntimeSnapshots.current();
  const desired = desiredDshResources.current();
  const skillSnapshot = scanDshSkills();
  const localSkills = dshSkillResources(
    skillSnapshot,
    desired.skills,
    desired.skillDefaultEnabled
  );
  const skillsById = new Map(localSkills.map(skill => [skill.id, skill]));
  for (const runtimeSkill of dshRuntimeSkillResources(runtimeSnapshot)) {
    const local = skillsById.get(runtimeSkill.id);
    const name = runtimeSkill.name;
    skillsById.set(runtimeSkill.id, {
      ...local,
      ...runtimeSkill,
      ...(local?.sourceIds ? { sourceIds: local.sourceIds } : {}),
      detail: [local?.detail, runtimeSkill.detail].filter(Boolean).join(" + "),
      enabled: Object.prototype.hasOwnProperty.call(desired.skills, name)
        ? desired.skills[name]
        : desired.skillDefaultEnabled
    });
  }
  const skills = [...skillsById.values()].sort((left, right) => left.name.localeCompare(right.name));
  let plugins = dshRuntimePluginResources(runtimeSnapshot).map(plugin => {
    const entryId = plugin.id.replace(/^plugin:/, "");
    return Object.prototype.hasOwnProperty.call(desired.plugins, entryId)
      ? { ...plugin, enabled: desired.plugins[entryId] }
      : plugin;
  });
  if (plugins.length === 0) {
    plugins = dshPluginCatalog().snapshot().plugins.map(plugin => ({
      id: `plugin:package:${plugin.packageName}`,
      kind: "plugin" as const,
      name: plugin.name,
      packageName: plugin.packageName,
      ...(plugin.description ? { description: plugin.description } : {}),
      detail: plugin.packageName,
      enabled: plugin.states.some(state => state.enabled),
      manageable: false,
      schemeSelectable: true,
      required: plugin.protected
    }));
  }
  return {
    skills,
    plugins,
    scannedAt: Date.now(),
    runtimeConnected: runtimeSnapshot !== null
  };
}

function setDesiredDshSkills(states: Record<string, boolean>, defaultEnabled: boolean) {
  const nextStates = { ...states };
  writeTextFileAtomic(
    join(resolveDshHome(), ".dsh-desk", "skill-policy.json"),
    `${JSON.stringify({ defaultEnabled, states: nextStates }, null, 2)}\n`
  );
  desiredDshResources.setSkills(nextStates, defaultEnabled);
}

function setDesiredDshPlugins(states: Record<string, boolean>) {
  desiredDshResources.setPlugins(states);
}

function sameBooleanStates(left: Readonly<Record<string, boolean>>, right: Readonly<Record<string, boolean>>): boolean {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length
    && leftEntries.every(([key, value]) => right[key] === value);
}

function dshResourceSchemeManager() {
  return new DshResourceSchemeManager({
    storePath: dshResourceSchemesPath(),
    inventory: dshResourceInventory,
    setDesiredSkills: setDesiredDshSkills,
    setDesiredPlugins: setDesiredDshPlugins
  });
}

function dshSkillMarketplace() {
  dshSkillMarketplaceInstance ??= new DshSkillMarketplace({
    dshHome: resolveDshHome(),
    storePath: dshSkillRepositoriesPath(),
    cachePath: join(app.getPath("userData"), "dsh-skill-marketplace-cache.json")
  });
  return dshSkillMarketplaceInstance;
}

function restoreDesiredDshResources() {
  try {
    const snapshot = dshResourceSchemeManager().snapshot();
    const scheme = snapshot.schemes.find(item => item.id === snapshot.appliedSchemeId);
    if (!scheme) return;
    const selected = new Set(scheme.plugins);
    const selectedSkills = new Set(scheme.skills);
    const schemeSkillStates = dshDesiredSkillStates(snapshot.inventory.skills, selectedSkills);
    const allPlugins = snapshot.schemes.find(item => item.id === ALL_DSH_SCHEME_ID)?.plugins ?? [];
    const allowPluginDisable = !scheme.plugins.some(id => snapshot.legacyRuntimePluginIds.includes(id));
    const schemePluginStates = dshDesiredPluginStates(snapshot.inventory.plugins, selected, dshPluginPackageNames(allPlugins), allowPluginDisable);
    const current = desiredDshResources.current();
    const next = desiredDshResources.reconcileScheme(
      schemeSkillStates,
      scheme.id === ALL_DSH_SCHEME_ID,
      schemePluginStates,
      allowPluginDisable
    );
    const skillsInitialized = desiredDshResources.isSkillsInitialized();
    const pluginsInitialized = desiredDshResources.isPluginsInitialized();
    if (!skillsInitialized
      || next.skillDefaultEnabled !== current.skillDefaultEnabled
      || !sameBooleanStates(next.skills, current.skills)) {
      setDesiredDshSkills(next.skills, next.skillDefaultEnabled);
    }
    if (snapshot.inventory.runtimeConnected
      && (!pluginsInitialized || !sameBooleanStates(next.plugins, current.plugins))) {
      setDesiredDshPlugins(next.plugins);
    }
  } catch {
    // A malformed scheme file is reported by the resource page; never block the event bridge.
  }
}

function getHooksStatus(): HookStatus {
  return getDshPluginStatus(dshPluginManagerOptions());
}

function installHooks(): Promise<HookOperationResult> {
  return installDshPlugin(dshPluginManagerOptions());
}

function repairHooks(): Promise<HookOperationResult> {
  return installDshPlugin(dshPluginManagerOptions());
}

function removeHooks(): Promise<HookOperationResult> {
  return removeDshPlugin(dshPluginManagerOptions());
}

function getUpdateStatus() {
  return updateStatus;
}

// The connection status carries a stable identity (port / serverListening / session) plus the
// last-event fields, which churn on every event. The panel already receives each event on the
// `companion:event` channel and only shows the connection's last-event time as an "N ago" that ticks
// off a local clock, so pushing the full status per event during a tool burst is wasted IPC + panel
// re-renders. Push immediately when the stable identity changes; otherwise coalesce the last-event
// churn to at most once per second (with a trailing send so the final state always lands).
let lastConnectionStableKey = "";
let lastConnectionSentAt = 0;
let connectionTrailingTimer: ReturnType<typeof setTimeout> | null = null;
const CONNECTION_BROADCAST_MIN_INTERVAL_MS = 1000;

function sendConnectionStatus() {
  const status = getConnectionStatus();
  lastConnectionStableKey = `${status.port}|${status.serverListening}|${status.activeSessionId}|${status.activeClientType}`;
  lastConnectionSentAt = Date.now();
  panelWindow?.webContents.send("companion:connection", status);
}

function broadcastConnectionStatus() {
  const status = getConnectionStatus();
  const stableKey = `${status.port}|${status.serverListening}|${status.activeSessionId}|${status.activeClientType}`;
  const sinceLast = Date.now() - lastConnectionSentAt;
  if (stableKey !== lastConnectionStableKey || sinceLast >= CONNECTION_BROADCAST_MIN_INTERVAL_MS) {
    if (connectionTrailingTimer) { clearTimeout(connectionTrailingTimer); connectionTrailingTimer = null; }
    sendConnectionStatus();
  } else if (!connectionTrailingTimer) {
    connectionTrailingTimer = setTimeout(() => {
      connectionTrailingTimer = null;
      sendConnectionStatus();
    }, CONNECTION_BROADCAST_MIN_INTERVAL_MS - sinceLast);
  }
}

function broadcastCompanionEvent(event: CompanionEvent) {
  // Permission requests are owned by the PermissionBroker (/permission flow);
  // regular events just fan out to the panel for the activity feed.
  panelWindow?.webContents.send("companion:event", event);
  broadcastConnectionStatus();
}

function publishPetEvent(event: PetEvent) {
  if (event.notificationKind !== "info") currentState = event.event;
  eventHistory = [event, ...eventHistory].slice(0, 100);
  const companionEvent = toCompanionEvent(event);
  recordRuntimeEvent(companionEvent, event.sessionId);
  petWindow?.webContents.send("pet-event", event);
  panelWindow?.webContents.send("pet-event", event);
  // No per-event `pet-snapshot`: nothing in the Electron panel subscribes to it (the list is kept
  // current incrementally via `pet-event` / `companion:event`), so serializing the whole 100-event
  // history on every hook event was pure waste. The snapshot is still sent at the explicit resync
  // points (initial render / clear-history) that own it.
  broadcastCompanionEvent(companionEvent);
  handleCompanionAlerts(companionEvent);
}

const PERMISSION_ID_PATTERN = /^\/permission\/([A-Za-z0-9-]+)$/;

function startEventServer() {
  eventServer = createServer(async (req, res) => {
    if (!isAcceptedEventServerRequest(req.method, req.headers)) {
      sendJson(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    // Blocking permission flow: the DSH plugin POSTs a request, then long-polls
    // the GET until the user decides (or it times out).
    if (req.method === "POST" && req.url === "/permission") {
      try {
        const body = await readJson(req);
        sendJson(res, 200, handlePermissionRequest(body));
      } catch {
        sendJson(res, 400, { status: "error", reason: "invalid_json" });
      }
      return;
    }

    const permissionMatch = req.method === "GET" && req.url ? req.url.match(PERMISSION_ID_PATTERN) : null;
    if (permissionMatch) {
      const result: PermissionPollResult = await permissionBroker.wait(permissionMatch[1]);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/dsh-plugin-inventory") {
      try {
        const snapshot = normalizeDshRuntimePluginSnapshot(await readJson(req));
        if (!snapshot) {
          sendJson(res, 400, { ok: false, error: "invalid_plugin_inventory" });
          return;
        }
        dshRuntimeSnapshots.update(snapshot);
        restoreDesiredDshResources();
        if (panelWindow && !panelWindow.isDestroyed()) {
          panelWindow.webContents.send("companion:dsh-resources-updated");
        }
        const desired = desiredDshResources.current();
        sendJson(res, 200, {
          ok: true,
          desiredSkills: desired.skills,
          desiredPlugins: desired.plugins,
          skillPolicy: {
            defaultEnabled: desired.skillDefaultEnabled,
            states: desired.skills
          }
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid_plugin_inventory" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/dsh-usage") {
      try {
        const record = normalizeDshUsageRecord(await readJson(req));
        if (!record) {
          sendJson(res, 400, { ok: false, error: "invalid_usage" });
          return;
        }
        const added = getDshUsageStore().add(record);
        if (added) {
          claudeTokenStatsCache = null;
          lastTokenScanSignature = "";
        }
        sendJson(res, 200, { ok: true, added });
      } catch {
        sendJson(res, 500, { ok: false, error: "usage_store_failed" });
      }
      return;
    }

    if (req.method !== "POST" || req.url !== "/event") {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }

    try {
      const value = await readJson(req);
      if (!isPetEvent(value)) {
        sendJson(res, 400, { ok: false, error: "invalid_event" });
        return;
      }

      publishPetEvent(value);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
    }
  });

  eventServer.listen(eventPort, "127.0.0.1");
}

if (singleInstanceLock) {
app.whenReady().then(() => {
  try {
    restoreLegacyDisabledDshSkills();
  } catch (error) {
    console.warn("Could not restore legacy DSH Desk Skill files.", error);
  }
  restoreDesiredDshResources();
  loadCompanionSettings();
  loadRuntimeStats();
  currencyRatesSnapshot = loadCachedCurrencyRates();
  void loadCurrencyRates(true);
  currencyRatesRefreshTimer = setInterval(() => { void loadCurrencyRates(true); }, CURRENCY_RATES_TTL_MS);
  // Crash leftovers from network pet installs are temp files by definition.
  cleanupPetDownloads(petDownloadsDir());
  protocol.handle("pet-asset", request => {
    const filePath = resolvePetAssetPath(request.url, petPacksDir());
    if (!filePath || !existsSync(filePath)) return new Response(null, { status: 404 });
    const type = filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/webp";
    return new Response(readFileSync(filePath), { headers: { "content-type": type } });
  });
  ipcMain.handle("pet:get-event-port", () => eventPort);
  ipcMain.handle("pet:get-snapshot", () => getSnapshot());
  ipcMain.handle("pet:minimize-panel", () => panelWindow?.minimize());
  ipcMain.handle("pet:toggle-maximize-panel", () => {
    if (!panelWindow) return;
    if (panelWindow.isMaximized()) panelWindow.unmaximize();
    else panelWindow.maximize();
  });
  ipcMain.handle("pet:close-panel", () => hidePanelWindow());
  ipcMain.on("companion:pet-rendered", event => {
    if (petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents) runStartupWarmup();
  });
  ipcMain.on("companion:get-initial-state", event => {
    event.returnValue = companionInitialState();
  });
  ipcMain.handle("companion:get-settings", () => companionSettings);
  ipcMain.handle("companion:save-settings", (_, next: Partial<typeof companionSettings>) => {
    const previousLaunchAtLogin = companionSettings.launchAtLogin;
    const previousPetEnabled = companionSettings.petEnabled;
    const previousAlwaysOnTop = companionSettings.alwaysOnTop;
    const previousPetScale = companionSettings.petScale;
    const previousFeedbackScale = companionSettings.feedbackScale;
    const previousPermissionScale = companionSettings.permissionScale;
    const previousPetTheme = typeof companionSettings.petTheme === "string" ? companionSettings.petTheme : "";
    const canonicalNext = pickCanonicalSettings(next && typeof next === "object" ? next : {});
    const mergedSettings = { ...companionSettings, ...canonicalNext };
    companionSettings = { ...mergedSettings, ...normalizePetDisplaySettings(mergedSettings) };
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.setBackgroundColor(panelWindowBackgroundColor());
    }
    // Theme changes swap the per-theme animation profile (stateAnimations +
    // idleAnim) so one theme's mappings never leak into another, and resize
    // the pet window for the incoming theme's sprite height.
    if (companionSettings.petTheme !== previousPetTheme) {
      companionSettings = applyThemeAnimationProfileSwitch(companionSettings, previousPetTheme, listPetPacks(petPacksDir()));
      setPetWindowExpanded(petExpanded, true);
    }
    saveCompanionSettings();
    if (previousLaunchAtLogin !== companionSettings.launchAtLogin) {
      applyLaunchAtLoginSetting();
    }
    if (previousPetEnabled !== companionSettings.petEnabled) {
      if (isPetEnabled()) showPetWindow();
      else hidePetWindow();
    } else if (previousAlwaysOnTop !== companionSettings.alwaysOnTop) {
      applyPetAlwaysOnTopSetting();
    }
    if (previousPetScale !== companionSettings.petScale
      || previousFeedbackScale !== companionSettings.feedbackScale
      || previousPermissionScale !== companionSettings.permissionScale) {
      setPetWindowExpanded(petExpanded, true);
    }
    broadcastCompanionSettings();
    broadcastCompanionConnection();
    return companionSettings;
  });
  ipcMain.handle("companion:get-connection-status", () => getConnectionStatus());
  ipcMain.handle("companion:check-hooks", () => getHooksStatus());
  ipcMain.handle("companion:install-hooks", () => installHooks());
  ipcMain.handle("companion:repair-hooks", () => repairHooks());
  ipcMain.handle("companion:remove-hooks", () => removeHooks());
  ipcMain.handle("companion:open-settings", () => showPanelWindow());
  ipcMain.handle("companion:minimize-settings", () => panelWindow?.minimize());
  ipcMain.handle("companion:toggle-maximize-settings", () => {
    if (!panelWindow) return;
    if (panelWindow.isMaximized()) panelWindow.unmaximize();
    else panelWindow.maximize();
  });
  ipcMain.handle("companion:close-settings", () => hidePanelWindow());
  ipcMain.handle("companion:tray-menu-ready", () => {
    trayMenuController.notifyRendererReady();
    // The handshake doubles as the pull path: the renderer renders from this
    // result even if a push was emitted before it subscribed.
    return trayMenuState();
  });
  ipcMain.handle("companion:tray-menu-rendered", () => {
    completeTrayMenuPresent();
  });
  ipcMain.handle("companion:tray-menu-action", (_, action: string) => {
    hideTrayMenu();
    // State is read live, not from the payload the popup rendered with, so
    // a stale menu can only ever toggle to the correct current state.
    if (action === "toggle-pet") {
      if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) hidePetWindow();
      else showPetWindow();
    } else if (action === "toggle-panel") {
      if (panelWindow && !panelWindow.isDestroyed() && panelWindow.isVisible()) hidePanelWindow();
      else showPanelWindow();
    } else if (action === "quit") {
      app.quit();
    }
  });
  ipcMain.handle("companion:set-pet-interactive", (_, interactive: boolean) => petWindow?.setIgnoreMouseEvents(!interactive, { forward: true }));
  ipcMain.handle("companion:update-permission-card-rect", () => undefined);
  ipcMain.handle("companion:respond-permission", (_, response: { id: string; decision?: string; reason?: string }) => {
    if (response.decision !== "allow" && response.decision !== "deny") return { ok: false };
    // The broker's onSettled records the stat, dismisses the card in both
    // windows, and unblocks the waiting DSH approval request.
    return respondPermission(response.id, response.decision, response.reason);
  });
  ipcMain.handle("companion:open-claude-provider-terminal", (_, providerId: string, cwd: string) => openClaudeProviderTerminal(providerId, cwd));
  ipcMain.handle("companion:pick-terminal-directory", async () => {
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
    const result = panelWindow && !panelWindow.isDestroyed()
      ? await dialog.showOpenDialog(panelWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("companion:providers-list", () => {
    try { return listUnifiedProviders(); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("companion:providers-save", (_, provider: CcSwitchProvider, originalId?: string) => {
    try { return saveUnifiedProvider(provider, originalId); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("companion:providers-delete", (_, id: string) => {
    try { return deleteUnifiedProvider(id); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("companion:providers-duplicate", (_, id: string) => {
    try { return duplicateUnifiedProvider(id); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("companion:providers-reorder", (_, orderedIds: string[]) => {
    try { return reorderUnifiedProviders(Array.isArray(orderedIds) ? orderedIds.map(String) : []); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("companion:providers-switch", (_, id: string) => {
    try { return switchUnifiedProvider(id); } catch (error) { return { ok: false, warnings: [], error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("companion:providers-test", async (_, payload: { id?: string; baseUrl?: string }) => {
    try {
      return await testUnifiedProvider(payload ?? {});
    } catch (error) {
      return { status: "failed", success: false, message: error instanceof Error ? error.message : String(error), url: "" };
    }
  });
  ipcMain.handle("companion:providers-fetch-models", async (_, payload: { baseUrl?: string; apiKey?: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }) => {
    try {
      return await fetchProviderModels(payload ?? {});
    } catch {
      // Never surface the raw error (it can embed the request URL); map to a code.
      return { ok: false, models: [], errorCode: "failed" as const };
    }
  });
  ipcMain.handle("companion:dsh-providers-list", () => listDshProviders());
  ipcMain.handle("companion:dsh-providers-save", (_, provider: DshProviderSaveInput) => saveDshProvider(provider));
  ipcMain.handle("companion:dsh-providers-delete", (_, id: string) => deleteDshProvider(id));
  ipcMain.handle("companion:dsh-providers-duplicate", (_, id: string) => duplicateDshProvider(id));
  ipcMain.handle("companion:dsh-providers-reorder", (_, ids: string[]) => reorderDshProviders(ids));
  ipcMain.handle("companion:dsh-providers-enabled", (_, id: string, enabled: boolean) => setDshProviderEnabled(id, enabled));
  ipcMain.handle("companion:dsh-providers-switch", (_, id: string, model?: string) => switchDshProvider(id, model));
  ipcMain.handle("companion:dsh-providers-probe", (_, payload: { id?: string; baseUrl?: string; apiKey?: string; mode?: "connectivity" | "models" }) => probeDshProvider(payload));
  ipcMain.handle("companion:get-update-status", () => getUpdateStatus());
  ipcMain.handle("companion:check-for-updates", () => checkForUpdates());
  ipcMain.handle("companion:install-update", () => installUpdate());
  ipcMain.handle("companion:get-app-version", () => app.getVersion());
  ipcMain.handle("companion:get-token-stats", async (_, force?: boolean) => {
    const refresh = Boolean(force);
    const [stats, exchangeRates] = await Promise.all([getClaudeTokenStats(refresh), loadCurrencyRates(refresh)]);
    return { ...stats, exchangeRates };
  });
  ipcMain.handle("companion:get-dsh-analytics", (_, force?: boolean) => getDshAnalytics(Boolean(force)));
  ipcMain.handle("companion:get-recent-edits", (_, force?: boolean) => getClaudeRecentEdits(Boolean(force)));
  ipcMain.handle("companion:get-usage-rankings", (_, force?: boolean) => getClaudeUsageRankings(Boolean(force)));
  ipcMain.handle("companion:preview-sound", (_, name: unknown) => isBuiltInSound(name) ? previewSoundDataUrl(name) : { ok: false, error: "Unknown sound type." });
  ipcMain.handle("companion:get-default-sound-paths", () => ({
    done: windowsMediaSoundPath("done"),
    error: windowsMediaSoundPath("error"),
    permission: windowsMediaSoundPath("permission")
  }));
  ipcMain.handle("companion:preview-sound-file", (_, filePath: string) => previewSoundFile(filePath));
  ipcMain.handle("companion:pick-sound-file", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3"] }]
    };
    const result = panelWindow && !panelWindow.isDestroyed()
      ? await dialog.showOpenDialog(panelWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("companion:preview-pet-animation", (_, animationKey: unknown) => {
    if (typeof animationKey !== "string") return false;
    const target = petWindow && !petWindow.isDestroyed() ? petWindow : null;
    target?.webContents.send("companion:preview-pet-animation", animationKey);
    return Boolean(target);
  });
  ipcMain.handle("companion:sync-idle-bubble", (_, payload: unknown) => panelWindow?.webContents.send("companion:idle-bubble-sync", payload));
  ipcMain.handle("companion:get-event-history", () => getCompanionEvents().map(event => ({ id: event.id, event, timestamp: event.timestamp })));
  ipcMain.handle("companion:get-session-history", () => getSessionHistory());
  ipcMain.handle("companion:clear-event-history", () => {
    eventHistory = [];
    panelWindow?.webContents.send("pet-snapshot", getSnapshot());
  });
  ipcMain.handle("companion:export-event-history-file", () => undefined);
  ipcMain.handle("companion:get-data-directory", () => app.getPath("userData"));
  ipcMain.handle("companion:open-data-directory", async () => {
    const error = await shell.openPath(app.getPath("userData"));
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle("companion:reveal-dsh-session", (_, filePath: string) => {
    if (!isDshSessionLogPath(filePath, resolveDshHome()) || !existsSync(filePath)) return false;
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle("companion:pet-pack-pick-file", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "Codex Pet Package", extensions: ["zip"] }]
    };
    const result = panelWindow && !panelWindow.isDestroyed()
      ? await dialog.showOpenDialog(panelWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("companion:pet-pack-inspect", (_, zipPath: string) => inspectPetPackZip(String(zipPath)));
  ipcMain.handle("companion:pet-pack-install", (_, zipPath: string, rowFrameCounts: number[], packageSha256: string, overwrite?: boolean) => {
    const result = installPetPack(String(zipPath), Array.isArray(rowFrameCounts) ? rowFrameCounts.map(Number) : [], String(packageSha256 ?? ""), petPacksDir(), { overwrite: Boolean(overwrite) });
    if (result.ok) broadcastPetPacksChanged();
    return result;
  });
  ipcMain.handle("companion:pet-pack-list", () => listPetPacks(petPacksDir()));
  ipcMain.handle("companion:pet-pack-remove", (_, id: string) => {
    const result = removePetPack(String(id), petPacksDir());
    if (result.ok) broadcastPetPacksChanged();
    return result;
  });
  ipcMain.handle("companion:pet-pack-download", (event, petSlug: string) =>
    downloadPetPack(String(petSlug ?? ""), petDownloadsDir(), {
      onProgress: (receivedBytes, totalBytes) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("companion:pet-pack-download-progress", { receivedBytes, totalBytes });
        }
      }
    }));
  ipcMain.handle("companion:pet-pack-discard-download", (_, zipPath: string) =>
    discardDownloadedPetPack(String(zipPath ?? ""), petDownloadsDir()));
  ipcMain.handle("companion:get-monitors", () => screen.getAllDisplays().map(display => ({ id: String(display.id), label: display.label || `Display ${display.id}`, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor })));
  ipcMain.handle("companion:get-plugins", () => companionSettings.customPlugins);
  ipcMain.handle("companion:dsh-plugins-list", () => dshPluginCatalog().snapshot());
  ipcMain.handle("companion:dsh-plugins-marketplace", (_, force?: boolean) => dshPluginCatalog().marketplace(Boolean(force)));
  ipcMain.handle("companion:dsh-plugins-set-enabled", (_, input: DshPluginStateInput) => dshPluginCatalog().setEnabled(input));
  ipcMain.handle("companion:dsh-plugins-install", (_, input: DshPluginInstallInput) => dshPluginCatalog().install(input));
  ipcMain.handle("companion:dsh-plugins-remove", (_, input: DshPluginRemoveInput) => dshPluginCatalog().remove(input));
  ipcMain.handle("companion:dsh-skills-list", () => scanDshSkills());
  ipcMain.handle("companion:dsh-resource-schemes", () => dshResourceSchemeManager().snapshot());
  ipcMain.handle("companion:dsh-resource-scheme-save", (_, input: DshResourceSchemeSaveInput) => dshResourceSchemeManager().save(input));
  ipcMain.handle("companion:dsh-resource-scheme-delete", (_, schemeId: unknown) => dshResourceSchemeManager().delete(typeof schemeId === "string" ? schemeId : ""));
  ipcMain.handle("companion:dsh-resource-scheme-apply", (_, schemeId: unknown) => dshResourceSchemeManager().apply(typeof schemeId === "string" ? schemeId : ""));
  ipcMain.handle("companion:dsh-resource-state", (_, input: DshResourceStateInput) => dshResourceSchemeManager().setResourceState(input));
  ipcMain.handle("companion:dsh-skill-marketplace", (_, force?: boolean) => dshSkillMarketplace().snapshot(Boolean(force)));
  ipcMain.handle("companion:dsh-skill-repo-add", (_, repo: DshSkillRepo) => dshSkillMarketplace().addRepo(repo));
  ipcMain.handle("companion:dsh-skill-repo-remove", (_, owner: unknown, name: unknown) => dshSkillMarketplace().removeRepo(String(owner ?? ""), String(name ?? "")));
  ipcMain.handle("companion:dsh-skill-install", (_, skill: DshMarketplaceSkill) => dshSkillMarketplace().install(skill));
  ipcMain.handle("companion:dsh-skill-reveal", (_, targetPath: unknown) => {
    if (typeof targetPath !== "string" || !canRevealDshSkillPath(targetPath)) return false;
    if (existsSync(targetPath) && statSync(targetPath).isFile()) shell.showItemInFolder(targetPath);
    else void shell.openPath(targetPath);
    return true;
  });
  ipcMain.handle("companion:get-claude-resources", (_, force?: boolean) => getClaudeResourcesSnapshot(Boolean(force)));
  ipcMain.handle("companion:get-claude-profiles", (_, force?: boolean) => getClaudeProfilesSnapshot(Boolean(force)));
  ipcMain.handle("companion:save-claude-profile", (_, input: unknown) => saveClaudeProfileFromRenderer(input));
  ipcMain.handle("companion:delete-claude-profile", (_, profileId: unknown) => deleteClaudeProfileFromRenderer(profileId));
  ipcMain.handle("companion:preview-claude-profile", (_, profileId: unknown) => previewClaudeProfileFromRenderer(profileId));
  ipcMain.handle("companion:apply-claude-profile", (_, profileId: unknown) => applyClaudeProfileFromRenderer(profileId));
  ipcMain.handle("companion:set-claude-profile-resource-state", (_, input: unknown) => setClaudeProfileResourceStateFromRenderer(input));
  ipcMain.handle("companion:get-claude-sessions", (_, force?: boolean) => getClaudeSessionSnapshot(Boolean(force)));
  ipcMain.handle("companion:get-claude-session-detail", (_, filePath: string) => getClaudeSessionDetail(filePath));
  ipcMain.handle("companion:resume-claude-session", (_, targetSessionId: string, projectPath?: string) => resumeClaudeSession(targetSessionId, projectPath));
  ipcMain.handle("companion:open-claude-resource", (_, targetPath: string) => {
    if (typeof targetPath !== "string" || !isAllowedClaudeResourcePath(targetPath)) return false;
    if (existsSync(targetPath) && statSync(targetPath).isFile()) shell.showItemInFolder(targetPath);
    else void shell.openPath(targetPath);
    return true;
  });
  ipcMain.handle("companion:get-plugin-runs", () => []);
  ipcMain.handle("companion:run-plugin-now", () => undefined);
  ipcMain.handle("companion:open-plugin-data-dir", () => undefined);
  ipcMain.handle("companion:get-plugin-market", () => ({ version: 1, plugins: [] }));
  ipcMain.handle("companion:install-market-plugin", () => undefined);
  ipcMain.handle("companion:save-plugins", (_, plugins: unknown[]) => {
    companionSettings = { ...companionSettings, customPlugins: plugins };
    saveCompanionSettings();
    broadcastCompanionSettings();
  });
  ipcMain.handle("companion:open-external", (_, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle("companion:get-stats", () => getStats());
  ipcMain.handle("companion:reset-stats", () => {
    runtimeStats = createRuntimeStats();
    runtimeStatsDirty = true;
    saveRuntimeStats(true);
  });
  ipcMain.handle("companion:export-settings-file", () => undefined);
  ipcMain.handle("companion:import-settings-file", () => null);
  ipcMain.handle("companion:export-stats-file", () => undefined);
  ipcMain.handle("companion:import-stats-file", () => null);
  if (isPetEnabled()) createPetWindow();
  createTray();
  // Warm the tray popup so the first right-click opens instantly.
  createTrayMenuWindow();
  startEventServer();
  runStartupBehaviors();

  app.on("activate", () => {
    if (isPetEnabled() && !petWindow) createPetWindow();
  });
});
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (startupWarmupTimer) {
    clearTimeout(startupWarmupTimer);
    startupWarmupTimer = null;
  }
  if (currencyRatesRefreshTimer) {
    clearInterval(currencyRatesRefreshTimer);
    currencyRatesRefreshTimer = null;
  }
  permissionBroker.shutdown();
  saveCompanionSettings(true);
  if (runtimeStats) {
    runtimeStats.totalRuntime = (runtimeStats.totalRuntime ?? 0) + (Date.now() - appStartedAt);
    runtimeStatsDirty = true;
    saveRuntimeStats(true);
  }
  eventServer?.close();
});

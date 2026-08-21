import { contextBridge, ipcRenderer, webUtils } from "electron";
import { PetEvent, PetState } from "../shared/events";
import type { CompanionInitialState } from "../renderer/shared/events";
import type {
  ClaudeProfileMutationResult,
  ClaudeProfilePreviewResult,
  ClaudeProfileResourceStateInput,
  ClaudeProfileSaveInput,
  ClaudeProfilesSnapshot,
  ClaudeResourcesSnapshot
} from "../shared/claudeProfiles";
import type { DshMarketplaceSkill, DshPluginInstallInput, DshPluginRemoveInput, DshPluginStateInput, DshSkillRepo } from "../shared/dshPlugins";
import type { DshPluginComponentStateInput, DshResourceSchemeSaveInput, DshResourceStateInput, DshThemeOverrideInput } from "../shared/dshResources";
import type { DshSkinMutationInput, DshSkinOperationProgress } from "../shared/dshSkins";
import type { PetPackInstallScan } from "../shared/petPackTransport";

export interface PetSnapshot {
  state: PetState;
  events: PetEvent[];
  startedAt: number;
  eventPort: number;
}

type Unsubscribe = () => void;

const initialState = ipcRenderer.sendSync("companion:get-initial-state") as CompanionInitialState;

function onChannel<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("petAPI", {
  onPetEvent(callback: (event: PetEvent) => void) {
    return onChannel<PetEvent>("pet-event", callback);
  },
  onSnapshot(callback: (snapshot: PetSnapshot) => void) {
    return onChannel<PetSnapshot>("pet-snapshot", callback);
  },
  getSnapshot() {
    return ipcRenderer.invoke("pet:get-snapshot") as Promise<PetSnapshot>;
  },
  minimizePanel() {
    return ipcRenderer.invoke("pet:minimize-panel") as Promise<void>;
  },
  toggleMaximizePanel() {
    return ipcRenderer.invoke("pet:toggle-maximize-panel") as Promise<void>;
  },
  closePanel() {
    return ipcRenderer.invoke("pet:close-panel") as Promise<void>;
  }
});

contextBridge.exposeInMainWorld("companion", {
  initialState,
  notifyPetRendered: () => ipcRenderer.send("companion:pet-rendered"),
  getSettings: () => ipcRenderer.invoke("companion:get-settings"),
  saveSettings: (next: unknown) => ipcRenderer.invoke("companion:save-settings", next),
  getConnectionStatus: () => ipcRenderer.invoke("companion:get-connection-status"),
  checkHooks: (provider?: unknown) => ipcRenderer.invoke("companion:check-hooks", provider),
  installHooks: (provider?: unknown) => ipcRenderer.invoke("companion:install-hooks", provider),
  repairHooks: (provider?: unknown) => ipcRenderer.invoke("companion:repair-hooks", provider),
  removeHooks: (provider?: unknown) => ipcRenderer.invoke("companion:remove-hooks", provider),
  openSettings: () => ipcRenderer.invoke("companion:open-settings"),
  minimizeSettings: () => ipcRenderer.invoke("companion:minimize-settings"),
  toggleMaximizeSettings: () => ipcRenderer.invoke("companion:toggle-maximize-settings"),
  closeSettings: () => ipcRenderer.invoke("companion:close-settings"),
  onEvent: (callback: (event: unknown) => void) => onChannel("companion:event", callback),
  onSettings: (callback: (settings: unknown) => void) => onChannel("companion:settings", callback),
  onConnection: (callback: (connection: unknown) => void) => onChannel("companion:connection", callback),
  setPetInteractive: (interactive: boolean) => ipcRenderer.invoke("companion:set-pet-interactive", interactive),
  updatePermissionCardRect: (rect: unknown) => ipcRenderer.invoke("companion:update-permission-card-rect", rect),
  onPetDragDirection: (callback: (direction: "left" | "right" | null) => void) => onChannel("companion:pet-drag-direction", callback),
  setPetLookTracking: (enabled: boolean) => ipcRenderer.send("companion:set-pet-look-tracking", enabled),
  onPetLookPoint: (callback: (point: { x: number; y: number } | null) => void) => onChannel("companion:pet-look-point", callback),
  onPetDoubleClickProbe: (callback: (point: { x: number; y: number }) => void) => onChannel("companion:pet-doubleclick-probe", callback),
  onTrayMenuState: (callback: (state: unknown) => void) => onChannel("companion:tray-menu-state", callback),
  trayMenuReady: () => ipcRenderer.invoke("companion:tray-menu-ready"),
  trayMenuRendered: () => ipcRenderer.invoke("companion:tray-menu-rendered"),
  trayMenuAction: (action: string) => ipcRenderer.invoke("companion:tray-menu-action", action),
  onPermissionRequest: (callback: (request: unknown) => void) => onChannel("companion:permission-request", callback),
  onPermissionResolved: (callback: (payload: unknown) => void) => onChannel("companion:permission-resolved", callback),
  respondPermission: (response: unknown) => ipcRenderer.invoke("companion:respond-permission", response),
  checkForUpdates: () => ipcRenderer.invoke("companion:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("companion:install-update"),
  openClaudeProviderTerminal: (providerId: string, cwd: string) => ipcRenderer.invoke("companion:open-claude-provider-terminal", providerId, cwd),
  pickTerminalDirectory: () => ipcRenderer.invoke("companion:pick-terminal-directory"),
  pickPetPackFile: () => ipcRenderer.invoke("companion:pet-pack-pick-file"),
  inspectPetPack: (zipPath: string) => ipcRenderer.invoke("companion:pet-pack-inspect", zipPath),
  installPetPack: (zipPath: string, scan: PetPackInstallScan, packageSha256: string, overwrite?: boolean) => ipcRenderer.invoke("companion:pet-pack-install", zipPath, scan, packageSha256, overwrite),
  listPetPacks: () => ipcRenderer.invoke("companion:pet-pack-list"),
  removePetPack: (id: string) => ipcRenderer.invoke("companion:pet-pack-remove", id),
  onPetPacksChanged: (callback: (payload: unknown) => void) => onChannel("companion:pet-packs-changed", callback),
  getPetPackFilePath: (file: File) => webUtils.getPathForFile(file),
  downloadPetPack: (petSlug: string, source?: "codex-pet-installer" | "codex-pets" | "petscodex") => ipcRenderer.invoke("companion:pet-pack-download", petSlug, source),
  discardPetPackDownload: (zipPath: string) => ipcRenderer.invoke("companion:pet-pack-discard-download", zipPath),
  onPetPackDownloadProgress: (callback: (payload: unknown) => void) => onChannel("companion:pet-pack-download-progress", callback),
  listClaudeProviders: () => ipcRenderer.invoke("companion:providers-list"),
  saveClaudeProvider: (provider: unknown, originalId?: string) => ipcRenderer.invoke("companion:providers-save", provider, originalId),
  deleteClaudeProvider: (id: string) => ipcRenderer.invoke("companion:providers-delete", id),
  duplicateClaudeProvider: (id: string) => ipcRenderer.invoke("companion:providers-duplicate", id),
  reorderClaudeProviders: (orderedIds: string[]) => ipcRenderer.invoke("companion:providers-reorder", orderedIds),
  switchClaudeProvider: (id: string) => ipcRenderer.invoke("companion:providers-switch", id),
  testClaudeProvider: (payload: { id?: string; baseUrl?: string }) => ipcRenderer.invoke("companion:providers-test", payload),
  fetchClaudeProviderModels: (payload: { baseUrl?: string; apiKey?: string; apiFormat?: string; apiKeyField?: string; userAgent?: string }) => ipcRenderer.invoke("companion:providers-fetch-models", payload),
  listDshProviders: () => ipcRenderer.invoke("companion:dsh-providers-list"),
  saveDshProvider: (provider: unknown) => ipcRenderer.invoke("companion:dsh-providers-save", provider),
  deleteDshProvider: (id: string) => ipcRenderer.invoke("companion:dsh-providers-delete", id),
  duplicateDshProvider: (id: string) => ipcRenderer.invoke("companion:dsh-providers-duplicate", id),
  reorderDshProviders: (ids: string[]) => ipcRenderer.invoke("companion:dsh-providers-reorder", ids),
  setDshProviderEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("companion:dsh-providers-enabled", id, enabled),
  switchDshProvider: (id: string) => ipcRenderer.invoke("companion:dsh-providers-switch", id),
  probeDshProvider: (payload: { id?: string; baseUrl?: string; protocol?: string; apiKey?: string; mode?: "connectivity" | "models" }) => ipcRenderer.invoke("companion:dsh-providers-probe", payload),
  onCcSwitchChanged: (callback: (payload: unknown) => void) => onChannel("companion:ccswitch-changed", callback),
  getUpdateStatus: () => ipcRenderer.invoke("companion:get-update-status"),
  getAppVersion: () => ipcRenderer.invoke("companion:get-app-version"),
  getTokenStats: (force?: boolean) => ipcRenderer.invoke("companion:get-token-stats", force),
  getDshAnalytics: (force?: boolean) => ipcRenderer.invoke("companion:get-dsh-analytics", force),
  getRecentEdits: (force?: boolean) => ipcRenderer.invoke("companion:get-recent-edits", force),
  getUsageRankings: (force?: boolean) => ipcRenderer.invoke("companion:get-usage-rankings", force),
  previewSound: (name: unknown) => ipcRenderer.invoke("companion:preview-sound", name),
  getDefaultSoundPaths: () => ipcRenderer.invoke("companion:get-default-sound-paths"),
  previewSoundFile: (path: string) => ipcRenderer.invoke("companion:preview-sound-file", path),
  pickSoundFile: () => ipcRenderer.invoke("companion:pick-sound-file"),
  previewPetAnimation: (animationKey: string) => ipcRenderer.invoke("companion:preview-pet-animation", animationKey),
  syncIdleBubble: (payload: unknown) => ipcRenderer.invoke("companion:sync-idle-bubble", payload),
  onIdleBubbleSync: (callback: (payload: unknown) => void) => onChannel("companion:idle-bubble-sync", callback),
  onPreviewPetAnimation: (callback: (animationKey: string) => void) => onChannel("companion:preview-pet-animation", callback),
  getEventHistory: () => ipcRenderer.invoke("companion:get-event-history"),
  getSessionHistory: () => ipcRenderer.invoke("companion:get-session-history"),
  clearEventHistory: () => ipcRenderer.invoke("companion:clear-event-history"),
  exportEventHistoryFile: () => ipcRenderer.invoke("companion:export-event-history-file"),
  getDataDirectory: () => ipcRenderer.invoke("companion:get-data-directory"),
  openDataDirectory: () => ipcRenderer.invoke("companion:open-data-directory"),
  revealDshSession: (filePath: string) => ipcRenderer.invoke("companion:reveal-dsh-session", filePath),
  getMonitors: () => ipcRenderer.invoke("companion:get-monitors"),
  getPlugins: () => ipcRenderer.invoke("companion:get-plugins"),
  listDshPlugins: () => ipcRenderer.invoke("companion:dsh-plugins-list"),
  getDshPluginMarketplace: (force?: boolean) => ipcRenderer.invoke("companion:dsh-plugins-marketplace", force),
  setDshPluginEnabled: (input: DshPluginStateInput) => ipcRenderer.invoke("companion:dsh-plugins-set-enabled", input),
  installDshMarketplacePlugin: (input: DshPluginInstallInput) => ipcRenderer.invoke("companion:dsh-plugins-install", input),
  removeDshPluginPackage: (input: DshPluginRemoveInput) => ipcRenderer.invoke("companion:dsh-plugins-remove", input),
  listDshSkills: () => ipcRenderer.invoke("companion:dsh-skills-list"),
  getDshResourceSchemes: () => ipcRenderer.invoke("companion:dsh-resource-schemes"),
  saveDshResourceScheme: (input: DshResourceSchemeSaveInput) => ipcRenderer.invoke("companion:dsh-resource-scheme-save", input),
  deleteDshResourceScheme: (schemeId: string) => ipcRenderer.invoke("companion:dsh-resource-scheme-delete", schemeId),
  applyDshResourceScheme: (schemeId: string) => ipcRenderer.invoke("companion:dsh-resource-scheme-apply", schemeId),
  setDshThemeOverride: (input: DshThemeOverrideInput) => ipcRenderer.invoke("companion:dsh-theme-override", input),
  setDshResourceState: (input: DshResourceStateInput) => ipcRenderer.invoke("companion:dsh-resource-state", input),
  setDshPluginComponentState: (input: DshPluginComponentStateInput) => ipcRenderer.invoke("companion:dsh-plugin-component-state", input),
  onDshResourcesUpdated: (callback: () => void) => onChannel("companion:dsh-resources-updated", callback),
  getDshSkillMarketplace: (force?: boolean) => ipcRenderer.invoke("companion:dsh-skill-marketplace", force),
  addDshSkillRepo: (repo: DshSkillRepo) => ipcRenderer.invoke("companion:dsh-skill-repo-add", repo),
  removeDshSkillRepo: (owner: string, name: string) => ipcRenderer.invoke("companion:dsh-skill-repo-remove", owner, name),
  installDshSkill: (skill: DshMarketplaceSkill) => ipcRenderer.invoke("companion:dsh-skill-install", skill),
  getDshSkinMarketplace: (force?: boolean) => ipcRenderer.invoke("companion:dsh-skins-marketplace", force),
  installDshSkinMarketplace: () => ipcRenderer.invoke("companion:dsh-skins-market-install"),
  mutateDshSkin: (input: DshSkinMutationInput) => ipcRenderer.invoke("companion:dsh-skins-mutate", input),
  onDshSkinProgress: (callback: (progress: DshSkinOperationProgress) => void) => onChannel("companion:dsh-skin-progress", callback),
  revealDshSkill: (path: string) => ipcRenderer.invoke("companion:dsh-skill-reveal", path),
  getClaudeResources: (force?: boolean) => ipcRenderer.invoke("companion:get-claude-resources", force) as Promise<ClaudeResourcesSnapshot>,
  getClaudeProfiles: (force?: boolean) => ipcRenderer.invoke("companion:get-claude-profiles", force) as Promise<ClaudeProfilesSnapshot>,
  saveClaudeProfile: (input: ClaudeProfileSaveInput) => ipcRenderer.invoke("companion:save-claude-profile", input) as Promise<ClaudeProfileMutationResult>,
  deleteClaudeProfile: (profileId: string) => ipcRenderer.invoke("companion:delete-claude-profile", profileId) as Promise<ClaudeProfileMutationResult>,
  previewClaudeProfile: (profileId: string) => ipcRenderer.invoke("companion:preview-claude-profile", profileId) as Promise<ClaudeProfilePreviewResult>,
  applyClaudeProfile: (profileId: string) => ipcRenderer.invoke("companion:apply-claude-profile", profileId) as Promise<ClaudeProfileMutationResult>,
  setClaudeProfileResourceState: (input: ClaudeProfileResourceStateInput) => ipcRenderer.invoke("companion:set-claude-profile-resource-state", input) as Promise<ClaudeProfileMutationResult>,
  getClaudeSessions: (force?: boolean) => ipcRenderer.invoke("companion:get-claude-sessions", force),
  onSessionsUpdated: (callback: (snapshot: unknown) => void) => onChannel("companion:sessions-updated", callback),
  getClaudeSessionDetail: (filePath: string) => ipcRenderer.invoke("companion:get-claude-session-detail", filePath),
  resumeClaudeSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke("companion:resume-claude-session", sessionId, projectPath),
  openClaudeResource: (path: string) => ipcRenderer.invoke("companion:open-claude-resource", path),
  getPluginRuns: () => ipcRenderer.invoke("companion:get-plugin-runs"),
  runPluginNow: (pluginId: string) => ipcRenderer.invoke("companion:run-plugin-now", pluginId),
  openPluginDataDir: (pluginId: string) => ipcRenderer.invoke("companion:open-plugin-data-dir", pluginId),
  getPluginMarket: () => ipcRenderer.invoke("companion:get-plugin-market"),
  installMarketPlugin: (pluginId: string) => ipcRenderer.invoke("companion:install-market-plugin", pluginId),
  savePlugins: (plugins: unknown[]) => ipcRenderer.invoke("companion:save-plugins", plugins),
  openExternal: (url: string) => ipcRenderer.invoke("companion:open-external", url),
  getStats: () => ipcRenderer.invoke("companion:get-stats"),
  resetStats: () => ipcRenderer.invoke("companion:reset-stats"),
  exportSettingsFile: () => ipcRenderer.invoke("companion:export-settings-file"),
  importSettingsFile: () => ipcRenderer.invoke("companion:import-settings-file"),
  exportStatsFile: () => ipcRenderer.invoke("companion:export-stats-file"),
  importStatsFile: () => ipcRenderer.invoke("companion:import-stats-file"),
  onUpdateStatus: (callback: (status: unknown) => void) => onChannel("companion:update-status", callback),
  onPlaySound: (callback: (dataUrl: string) => void) => onChannel("companion:play-sound", callback),
  onOpenSection: (callback: (section: string) => void) => onChannel("companion:open-section", callback)
});

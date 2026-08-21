import type { DshRuntimePluginPhase } from "./dshPlugins";

export type DshResourceKind = "skill" | "plugin";

export type DshAppearanceKind = "theme" | "appearance-extension" | "theme-bundle";
export type DshAppearanceComponent = "base-theme" | "wallpaper" | "motion" | "sound" | "settings";

export type DshAppearanceMetadata = {
  kind: DshAppearanceKind;
  components: DshAppearanceComponent[];
  themeId?: string;
  activationGroup?: string;
  active?: boolean;
};

export type DshPluginComponent = {
  key: string;
  name: string;
  moduleName: string;
  baselineEnabled: boolean | null;
  enabled: boolean;
  desiredEnabled?: boolean;
  manageable: boolean;
  fiberPhase: DshRuntimePluginPhase;
  runtimeObserved?: boolean;
};

export type DshResourceItem = {
  id: string;
  kind: DshResourceKind;
  name: string;
  packageName?: string;
  description?: string;
  detail?: string;
  enabled: boolean;
  manageable: boolean;
  schemeSelectable?: boolean;
  sourceIds?: string[];
  components?: DshPluginComponent[];
  required?: boolean;
  missing?: boolean;
  appearance?: DshAppearanceMetadata;
};

export function isDshResourceSchemeSelectable(resource: DshResourceItem): boolean {
  if (resource.missing) return true;
  return resource.schemeSelectable ?? resource.manageable;
}

export type DshResourceInventory = {
  skills: DshResourceItem[];
  plugins: DshResourceItem[];
  scannedAt: number;
  runtimeConnected: boolean;
};

export type DshResourceScheme = {
  id: string;
  name: string;
  description?: string;
  skills: string[];
  plugins: string[];
  /** One mutually-exclusive base theme package for this scheme. */
  themeId?: string;
  pluginComponentOverrides: DshPluginComponentOverride[];
  isProtected: boolean;
  createdAt: number;
  updatedAt: number;
};

export type DshPluginComponentOverrideState = "enabled" | "disabled";

export type DshPluginComponentOverride = {
  packageName: string;
  componentKey: string;
  state: DshPluginComponentOverrideState;
};

export const DSH_RESOURCE_SCHEME_VERSION = 1 as const;
export const DEFAULT_DSH_SCHEME_ID = "default";
export const ALL_DSH_SCHEME_ID = "all";

export type DshResourceSchemeStore = {
  schemaVersion: typeof DSH_RESOURCE_SCHEME_VERSION;
  schemes: DshResourceScheme[];
  pluginRuntimePackages: Record<string, string>;
  legacyRuntimePluginIds: string[];
  appliedSchemeId: string | null;
  /** Omitted means follow the applied scheme. */
  themeOverride?: DshThemeOverride;
};

export type DshThemeOverride =
  | { mode: "follow-scheme" }
  | { mode: "temporary"; themeId: string }
  | { mode: "disabled" };

export type DshResourceDrift = {
  schemeId: string | null;
  isDrifted: boolean;
  skills: boolean;
  plugins: boolean;
  theme?: boolean;
};

export type DshResourceSchemesSnapshot = DshResourceSchemeStore & {
  inventory: DshResourceInventory;
  drift: DshResourceDrift;
};

export type DshResourceSchemeSaveInput = {
  id?: string;
  name: string;
  description?: string;
  skills: string[];
  plugins: string[];
  themeId?: string;
  pluginComponentOverrides?: DshPluginComponentOverride[];
};

export type DshThemeOverrideInput = DshThemeOverride;

export type DshPluginComponentStateInput = {
  schemeId: string;
  packageName: string;
  componentKey: string;
  state: DshPluginComponentOverrideState | "default";
};

export type DshResourceIssue = {
  code: string;
  message: string;
  resourceId?: string;
};

export type DshResourceMutationResult =
  | { ok: true; schemeId: string; snapshot: DshResourceSchemesSnapshot }
  | { ok: false; issues: DshResourceIssue[] };

export type DshResourceStateInput = {
  schemeId: string;
  resourceId: string;
  enabled: boolean;
};

export function createEmptyDshResourceSchemesSnapshot(scannedAt = 0): DshResourceSchemesSnapshot {
  const now = 0;
  return {
    schemaVersion: DSH_RESOURCE_SCHEME_VERSION,
    schemes: [{
      id: DEFAULT_DSH_SCHEME_ID,
      name: "Default",
      skills: [],
      plugins: [],
      pluginComponentOverrides: [],
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }, {
      id: ALL_DSH_SCHEME_ID,
      name: "All",
      skills: [],
      plugins: [],
      pluginComponentOverrides: [],
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }],
    pluginRuntimePackages: {},
    legacyRuntimePluginIds: [],
    appliedSchemeId: DEFAULT_DSH_SCHEME_ID,
    inventory: { skills: [], plugins: [], scannedAt, runtimeConnected: false },
    drift: { schemeId: DEFAULT_DSH_SCHEME_ID, isDrifted: false, skills: false, plugins: false }
  };
}

export type DshResourceKind = "skill" | "plugin";

export type DshResourceItem = {
  id: string;
  kind: DshResourceKind;
  name: string;
  description?: string;
  detail?: string;
  enabled: boolean;
  manageable: boolean;
  required?: boolean;
  missing?: boolean;
};

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
  isProtected: boolean;
  createdAt: number;
  updatedAt: number;
};

export const DSH_RESOURCE_SCHEME_VERSION = 1 as const;
export const DEFAULT_DSH_SCHEME_ID = "default";
export const ALL_DSH_SCHEME_ID = "all";

export type DshResourceSchemeStore = {
  schemaVersion: typeof DSH_RESOURCE_SCHEME_VERSION;
  schemes: DshResourceScheme[];
  appliedSchemeId: string | null;
};

export type DshResourceDrift = {
  schemeId: string | null;
  isDrifted: boolean;
  skills: boolean;
  plugins: boolean;
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
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }, {
      id: ALL_DSH_SCHEME_ID,
      name: "All",
      skills: [],
      plugins: [],
      isProtected: true,
      createdAt: now,
      updatedAt: now
    }],
    appliedSchemeId: DEFAULT_DSH_SCHEME_ID,
    inventory: { skills: [], plugins: [], scannedAt, runtimeConnected: false },
    drift: { schemeId: DEFAULT_DSH_SCHEME_ID, isDrifted: false, skills: false, plugins: false }
  };
}

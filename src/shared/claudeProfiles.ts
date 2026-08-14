export type ClaudeResourceKind = "skill" | "plugin" | "mcp";
export type ClaudeSkillSource = "personal" | "plugin";
export type ClaudePluginScope = "user" | "project" | "local" | "unknown";

export type ClaudeResourceItem = {
  id: string;
  kind: ClaudeResourceKind;
  name: string;
  description?: string;
  path?: string;
  enabled?: boolean;
  source: "claude" | "claude-json" | "unknown";
  detail?: string;
  skillSource?: ClaudeSkillSource;
  pluginId?: string;
  scopes?: ClaudePluginScope[];
};

export type ClaudeResourcesSnapshot = {
  summary: { skills: number; plugins: number; mcp: number };
  skills: ClaudeResourceItem[];
  plugins: ClaudeResourceItem[];
  mcp: ClaudeResourceItem[];
  scannedAt: number;
  paths: {
    claudeDir: string;
    claudeJson: string;
    projectsDir?: string;
  };
};

export type ClaudeProfileResource = {
  id: string;
  kind: ClaudeResourceKind;
  name: string;
  description?: string;
  detail?: string;
  enabled: boolean;
};

export type ClaudeProfileInventory = {
  skills: ClaudeProfileResource[];
  plugins: ClaudeProfileResource[];
  mcpServers: ClaudeProfileResource[];
  scannedAt: number;
};

export type ClaudeProfile = {
  id: string;
  name: string;
  description?: string;
  skills: string[];
  plugins: string[];
  mcpServers: string[];
  isProtected: boolean;
  createdAt: number;
  updatedAt: number;
};

export const CLAUDE_PROFILE_SCHEMA_VERSION = 2 as const;
export const DEFAULT_CLAUDE_PROFILE_ID = "default";
export const ALL_CLAUDE_PROFILE_ID = "all";

export type ClaudeProfileStoreData = {
  schemaVersion: typeof CLAUDE_PROFILE_SCHEMA_VERSION;
  profiles: ClaudeProfile[];
  appliedProfileId: string | null;
};

export type ClaudeProfileDrift = {
  profileId: string | null;
  isDrifted: boolean;
  skills: boolean;
  plugins: boolean;
  mcpServers: boolean;
};

export type ClaudeProfileMcpStatus = "ready" | "config-unreadable" | "inventory-unreadable";

function profileMembershipDiffers(expected: string[], resources: ClaudeProfileResource[]) {
  const active = new Set(resources.filter(item => item.enabled).map(item => item.id));
  return expected.length !== active.size || expected.some(id => !active.has(id));
}

export function getClaudeProfileDrift(
  store: ClaudeProfileStoreData,
  inventory: ClaudeProfileInventory,
  mcpStatus: ClaudeProfileMcpStatus = "ready"
): ClaudeProfileDrift {
  const profileId = store.appliedProfileId;
  if (profileId === null) {
    return { profileId: null, isDrifted: false, skills: false, plugins: false, mcpServers: false };
  }
  const profile = store.profiles.find(item => item.id === profileId);
  if (!profile) {
    return { profileId, isDrifted: true, skills: true, plugins: true, mcpServers: true };
  }
  const skills = profileMembershipDiffers(profile.skills, inventory.skills);
  const plugins = profileMembershipDiffers(profile.plugins, inventory.plugins);
  const mcpServers = mcpStatus === "ready" && profileMembershipDiffers(profile.mcpServers, inventory.mcpServers);
  return { profileId, isDrifted: skills || plugins || mcpServers, skills, plugins, mcpServers };
}

export function snapshotAfterClaudeProfileApply(
  snapshot: ClaudeProfilesSnapshot,
  profileId: string
): ClaudeProfilesSnapshot {
  const profile = snapshot.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error(`Claude profile does not exist: ${profileId}`);

  const selected = {
    skills: new Set(profile.skills),
    plugins: new Set(profile.plugins),
    mcpServers: new Set(profile.mcpServers)
  };
  const inventory: ClaudeProfileInventory = {
    ...snapshot.inventory,
    skills: snapshot.inventory.skills.map(item => ({ ...item, enabled: selected.skills.has(item.id) })),
    plugins: snapshot.inventory.plugins.map(item => ({ ...item, enabled: selected.plugins.has(item.id) })),
    mcpServers: snapshot.inventory.mcpServers.map(item => ({ ...item, enabled: selected.mcpServers.has(item.id) }))
  };
  const projected = { ...snapshot, appliedProfileId: profileId, inventory };
  return { ...projected, drift: getClaudeProfileDrift(projected, inventory, snapshot.mcpStatus) };
}

export function snapshotAfterClaudeProfileResourceState(
  snapshot: ClaudeProfilesSnapshot,
  resourceId: string,
  enabled: boolean
): ClaudeProfilesSnapshot {
  const update = (items: ClaudeProfileResource[]) => items.map(item => item.id === resourceId ? { ...item, enabled } : item);
  const inventory: ClaudeProfileInventory = {
    ...snapshot.inventory,
    skills: update(snapshot.inventory.skills),
    plugins: update(snapshot.inventory.plugins),
    mcpServers: update(snapshot.inventory.mcpServers)
  };
  const projected = { ...snapshot, inventory };
  return { ...projected, drift: getClaudeProfileDrift(projected, inventory, snapshot.mcpStatus) };
}

export type ClaudeProfilesSnapshot = ClaudeProfileStoreData & {
  inventory: ClaudeProfileInventory;
  drift: ClaudeProfileDrift;
  mcpStatus: ClaudeProfileMcpStatus;
};

export function createEmptyClaudeProfilesSnapshot(scannedAt = 0): ClaudeProfilesSnapshot {
  return {
    schemaVersion: CLAUDE_PROFILE_SCHEMA_VERSION,
    profiles: [{
      id: DEFAULT_CLAUDE_PROFILE_ID,
      name: "Default",
      skills: [],
      plugins: [],
      mcpServers: [],
      isProtected: true,
      createdAt: 0,
      updatedAt: 0
    }, {
      id: ALL_CLAUDE_PROFILE_ID,
      name: "All",
      skills: [],
      plugins: [],
      mcpServers: [],
      isProtected: true,
      createdAt: 0,
      updatedAt: 0
    }],
    appliedProfileId: DEFAULT_CLAUDE_PROFILE_ID,
    inventory: { skills: [], plugins: [], mcpServers: [], scannedAt },
    drift: { profileId: DEFAULT_CLAUDE_PROFILE_ID, isDrifted: false, skills: false, plugins: false, mcpServers: false },
    mcpStatus: "ready"
  };
}

export type ClaudeProfileSaveInput = {
  id?: string;
  name: string;
  description?: string;
  skills: string[];
  plugins: string[];
  mcpServers: string[];
};

export type ClaudeProfileOperationIssue = {
  code: string;
  message: string;
  resourceId?: string;
  target?: "settings" | "mcp";
};

export type ClaudeProfileChanges = {
  enable: string[];
  disable: string[];
};

export type ClaudeProfilePreviewResult =
  | {
      ok: true;
      profileId: string;
      changes: {
        skills: ClaudeProfileChanges;
        plugins: ClaudeProfileChanges;
        mcpServers: ClaudeProfileChanges;
      };
    }
  | { ok: false; issues: ClaudeProfileOperationIssue[] };

export type ClaudeProfileMutationResult =
  | { ok: true; profileId: string; snapshot: ClaudeProfilesSnapshot }
  | { ok: false; issues: ClaudeProfileOperationIssue[] };

export type ClaudeProfileResourceStateInput = {
  profileId: string;
  resourceId: string;
  enabled: boolean;
};

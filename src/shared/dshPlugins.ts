export type DshPluginProfile = {
  name: string;
  label: string;
  exists: boolean;
  readError?: string;
};

export type DshPluginProfileState = {
  profile: string;
  dependencySpec?: string;
  enabled: boolean;
  materialized: boolean;
  bundleCapable: boolean | null;
};

export type DshInstalledPluginKind = "builtin" | "desk" | "plugin" | "dependency" | "broken";

export type DshInstalledPlugin = {
  packageName: string;
  name: string;
  description?: string;
  version?: string;
  homepage?: string;
  kind: DshInstalledPluginKind;
  protected: boolean;
  states: DshPluginProfileState[];
};

export type DshPluginSnapshot = {
  profiles: DshPluginProfile[];
  plugins: DshInstalledPlugin[];
  dshHome: string;
  npxAvailable: boolean;
  scannedAt: number;
};

export type DshRuntimePluginPhase = "pending" | "loading" | "active" | "failed" | "unloading" | null;

export type DshRuntimePluginEntry = {
  entryId: string;
  configId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: DshRuntimePluginPhase;
};

export type DshRuntimePluginSnapshot = {
  entries: DshRuntimePluginEntry[];
  receivedAt: number;
};

export type DshMarketplaceCategory = {
  id: string;
  en: string;
  zh: string;
};

export type DshMarketplacePlugin = {
  id: string;
  name: string;
  owner: string;
  packageName: string;
  repositoryUrl: string;
  category: string;
  description: { en: string; zh: string };
  installSpec: string;
  stars: number | null;
  added: string;
};

export type DshMarketplaceSnapshot = {
  source: "remote" | "cache" | "unavailable";
  sourceName: string;
  sourceUrl: string;
  updatedAt?: string;
  fetchedAt?: number;
  categories: DshMarketplaceCategory[];
  plugins: DshMarketplacePlugin[];
  error?: string;
};

export type DshPluginMutationCode =
  | "invalid-input"
  | "profile-not-found"
  | "plugin-not-found"
  | "protected-plugin"
  | "not-a-bundle"
  | "npx-missing"
  | "concurrent-change"
  | "operation-failed";

export type DshPluginMutationResult = {
  ok: boolean;
  snapshot: DshPluginSnapshot;
  changedProfiles: string[];
  restartRequired: boolean;
  code?: DshPluginMutationCode;
  error?: string;
};

export type DshPluginStateInput = {
  packageName: string;
  profile: string;
  enabled: boolean;
};

export type DshPluginInstallInput = {
  installSpec: string;
  profiles: string[];
};

export type DshPluginRemoveInput = {
  packageName: string;
  profiles: string[];
};

export type DshSkillSource = "user-dsh" | "user-agents";

export type DshSkillItem = {
  id: string;
  name: string;
  description: string;
  path: string;
  directory: string;
  source: DshSkillSource;
  active: boolean;
  enabled: boolean;
  manageable: boolean;
  storageName: string;
  storagePath: string;
  modelInvocable: boolean;
  userInvocable: boolean;
};

export type DshSkillSnapshot = {
  skills: DshSkillItem[];
  roots: Array<{ source: DshSkillSource; path: string }>;
  scannedAt: number;
};

export type DshSkillRepo = {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
};

export type DshMarketplaceSkill = {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  stars: number | null;
  installed: boolean;
};

export type DshSkillMarketplaceSnapshot = {
  repos: DshSkillRepo[];
  skills: DshMarketplaceSkill[];
  scannedAt: number;
  errors: string[];
};

export type DshSkillInstallResult = {
  ok: boolean;
  snapshot: DshSkillSnapshot;
  error?: string;
};

export type DshSkillRepoMutationResult = {
  ok: boolean;
  snapshot?: DshSkillMarketplaceSnapshot;
  error?: string;
};

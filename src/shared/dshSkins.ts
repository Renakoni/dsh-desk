export type DshSkinMode = "light" | "dark";

export type DshSkinReview = {
  compatibility: "verified" | "unverified";
  preview: "verified" | "repository-card";
  installation: "verified" | "manual-only";
};

export type DshSkinCatalogEntry = {
  id: string;
  name: { zh: string; en: string };
  author: string;
  description: string;
  repositoryUrl: string | null;
  packageName: string;
  tags: string[];
  modes: DshSkinMode[];
  install: { target: string; version: string; commit: string };
  compatibility: { dsh: string; platform: string[] };
  screenshots: string[];
  listScreenshot?: string;
  review?: DshSkinReview;
  license: { code: string; commercialUse: boolean; notice?: string };
  stars: number | null;
  updatedAt: string;
};

export type DshLocalSkin = {
  id: string;
  packageName: string;
  name: { zh: string; en: string };
  author: string;
  description: string;
  version: string | null;
  repositoryUrl: string | null;
  active: boolean;
  broken: boolean;
};

export type DshSkinRuntimeState = {
  skinId: string;
  installation: "missing" | "installed" | "updating" | "broken";
  activation: "inactive" | "active" | "switching" | "restart-required";
  installedVersion: string | null;
  installedAt: string | null;
  updateAvailable: boolean;
  error?: string;
};

export type DshSkinHostState = {
  connected: boolean;
  marketInstalled: boolean;
  skins: DshSkinRuntimeState[];
  restartAvailable: boolean;
  runningAgentCount: number | null;
};

export type DshSkinMarketplaceSnapshot = {
  skins: DshSkinCatalogEntry[];
  localSkins?: DshLocalSkin[];
  generatedAt: string | null;
  catalogSource: "remote" | "cache" | "unavailable";
  catalogCheckedAt: number;
  catalogError?: string;
  host: DshSkinHostState;
};

export type DshSkinMarketInstallResult = {
  ok: boolean;
  restartRequired: boolean;
  snapshot: DshSkinMarketplaceSnapshot;
  error?: string;
};

export type DshSkinAction = "install" | "activate" | "deactivate" | "update" | "uninstall" | "restart";

export type DshSkinMutationInput = {
  skinId: string;
  action: DshSkinAction;
};

export type DshSkinMutationResult = {
  ok: boolean;
  snapshot: DshSkinMarketplaceSnapshot;
  restartRequested?: boolean;
  browserRefreshRequired?: boolean;
  supportPrepared?: boolean;
  error?: string;
};

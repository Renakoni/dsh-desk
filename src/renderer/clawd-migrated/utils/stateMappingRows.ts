import type { PetAnimationKey } from "../../../shared/petAnimationKeys";
import { normalizeMappableAnimationKey, type PetThemeCatalog, type PetThemeRoleDefaults } from "../../../shared/petThemeCatalog";

/**
 * Action Mapping rows for the active theme.
 *
 * Rows are keyed by the theme's role-default keys — the same slot keys
 * resolvePetAnimation() reads — so what the picker edits is exactly what the
 * pet consumes. An `error` row appears only when the theme has a dedicated
 * error animation (imported packs: `failed`); the built-in theme shares
 * `running` for errors, so its running row carries the error meta instead of
 * duplicating the slot. Sparse packs whose fallback chains collapse several
 * roles onto one key produce a single merged row per key, never duplicate
 * React/storage keys.
 */

type MappingRole = keyof PetThemeRoleDefaults;

export interface StateMappingRow {
  /** Slot key in settings.stateAnimations — the theme's role-default key. */
  key: PetAnimationKey;
  /** Roles this row edits (several when fallback chains collapse). */
  roles: MappingRole[];
  labelKey: string;
  labelFallback: string;
  metaKey: string;
  metaFallback: string;
}

const ROW_ROLE_ORDER: readonly MappingRole[] = ["running", "waiting_permission", "done", "error"];

const ROLE_COPY: Record<MappingRole, { labelKey: string; labelFallback: string; metaKey: string; metaFallback: string }> = {
  idle: { labelKey: "animation.state.idle", labelFallback: "待机", metaKey: "animation.stateMeta.idle", metaFallback: "空闲状态" },
  running: { labelKey: "animation.state.running", labelFallback: "正在运行", metaKey: "animation.stateMeta.running", metaFallback: "读取、编辑、执行、搜索、技能、子代理" },
  waiting_permission: { labelKey: "animation.state.permission", labelFallback: "权限请求", metaKey: "animation.stateMeta.permission", metaFallback: "权限等待、通知确认" },
  done: { labelKey: "animation.state.done", labelFallback: "运行完成", metaKey: "animation.stateMeta.done", metaFallback: "任务完成、停止事件" },
  error: { labelKey: "animation.state.error", labelFallback: "运行出错", metaKey: "animation.stateMeta.error", metaFallback: "错误、失败事件" }
};

export function stateMappingRowsFor(catalog: PetThemeCatalog): StateMappingRow[] {
  const rows: StateMappingRow[] = [];
  for (const role of ROW_ROLE_ORDER) {
    const key = catalog.roleDefaults[role];
    // A role that collapsed onto idle has no dedicated animation in this
    // theme. Its slot key would be the very "idle" the genuinely idle pet
    // consumes, so an editable row here would silently restyle the idle
    // state too — no row is rendered, and the runtime ignores the idle slot
    // for the same reason (resolvePetAnimation).
    if (key === "idle") continue;
    const existing = rows.find(row => row.key === key);
    if (existing) {
      // The role shares a slot with an earlier row (built-in error→running,
      // or a sparse pack's collapsed fallbacks): merge instead of duplicating.
      // The merged metas are joined at render time via mappingRowMeta().
      existing.roles.push(role);
      continue;
    }
    const copy = ROLE_COPY[role];
    rows.push({
      key,
      roles: [role],
      labelKey: copy.labelKey,
      labelFallback: copy.labelFallback,
      metaKey: copy.metaKey,
      metaFallback: copy.metaFallback
    });
  }
  return rows;
}

/** Meta line for a row: every merged role's meta, joined. */
export function mappingRowMeta(row: StateMappingRow, t: (key: string, fallback?: string) => string): string {
  return row.roles
    .map(role => t(ROLE_COPY[role].metaKey, ROLE_COPY[role].metaFallback))
    .join(" · ");
}

/**
 * The animation a mapping slot currently shows — validated against the
 * active catalog with the SAME rule resolvePetAnimation() applies, so the
 * settings UI can never display a value the live pet would reject.
 */
export function displayedMappingKey(
  catalog: PetThemeCatalog,
  stateAnimations: Record<string, string> | null | undefined,
  row: StateMappingRow
): PetAnimationKey {
  return normalizeMappableAnimationKey(catalog, stateAnimations?.[row.key], row.key);
}

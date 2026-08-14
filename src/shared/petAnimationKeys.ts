// Canonical animation keys for the pet sprite library — the single source of
// truth for what may be persisted in settings (action mappings and the idle
// pool). Legacy or alternative names are intentionally NOT supported: an
// unknown value is invalid and callers fall back, never translated.
//
// This is the closed superset across all theme sources; no single theme
// provides every key. Which keys are actually available comes from the active
// theme's catalog (shared/petThemeCatalog.ts). The last six entries carry the
// codex-pet spritesheet vocabulary, translated once at the import boundary.
export const PET_ANIMATION_KEYS = [
  "idle",
  "running",
  "waiting_permission",
  "done",
  "extra_action_5",
  "extra_action_7",
  "extra_action_8",
  "extra_action_9",
  "extra_action_aqua_bocchi",
  "extra_action_aqua_pixel",
  "running_right",
  "running_left",
  "waving",
  "jumping",
  "failed",
  "review"
] as const;

export type PetAnimationKey = (typeof PET_ANIMATION_KEYS)[number];

export function isPetAnimationKey(value: unknown): value is PetAnimationKey {
  return typeof value === "string" && (PET_ANIMATION_KEYS as readonly string[]).includes(value);
}

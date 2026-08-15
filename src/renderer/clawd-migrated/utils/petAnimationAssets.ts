import completedAnimation from "../../assets/pet/completed.webp";
import extraAction7Animation from "../../assets/pet/extra-action-7.webp";
import extraAction8Animation from "../../assets/pet/extra-action-8.webp";
import extraActionAquaBocchiAnimation from "../../assets/pet/extra-action-aqua-bocchi.png";
import idleAnimation from "../../assets/pet/idle.png";
import permissionAnimation from "../../assets/pet/permission-prompt.webp";
import runningAnimation from "../../assets/pet/running.webp";
import type { PetAnimationKey } from "./petAnimations";

// Clip assets for the built-in theme. The canonical superset is wider than
// any one theme, so this record is partial; catalog-scoped pickers only ever
// look up keys the built-in theme provides.
export const petAnimationAssets: Partial<Record<PetAnimationKey, string>> = {
  idle: idleAnimation,
  running: runningAnimation,
  waiting_permission: permissionAnimation,
  done: completedAnimation,
  extra_action_7: extraAction7Animation,
  extra_action_8: extraAction8Animation,
  extra_action_aqua_bocchi: extraActionAquaBocchiAnimation
};

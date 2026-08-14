import completedAnimation from "../../assets/pet/completed.webp";
import extraAction5Animation from "../../assets/pet/extra-action-5.webp";
import extraAction7Animation from "../../assets/pet/extra-action-7.webp";
import extraAction8Animation from "../../assets/pet/extra-action-8.webp";
import extraAction9Animation from "../../assets/pet/extra-action-9.webp";
import extraActionAquaBocchiAnimation from "../../assets/pet/extra-action-aqua-bocchi.png";
import extraActionAquaPixelAnimation from "../../assets/pet/extra-action-aqua-pixel.gif";
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
  extra_action_5: extraAction5Animation,
  extra_action_7: extraAction7Animation,
  extra_action_8: extraAction8Animation,
  extra_action_9: extraAction9Animation,
  extra_action_aqua_bocchi: extraActionAquaBocchiAnimation,
  extra_action_aqua_pixel: extraActionAquaPixelAnimation
};

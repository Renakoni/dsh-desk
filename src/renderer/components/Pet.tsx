import { PetState } from "../../shared/events";
import { PET_IMAGE_SIZE } from "../../shared/petDisplaySettings";
import { displayedSpriteHeight } from "../../shared/spriteFrame";
import type { SpritesheetAssets } from "../../shared/petPackAssets";
import { lookFrameForTarget, type PetLookTarget } from "../../shared/petLook";
import { MINATO_AQUA_CATALOG, type PetThemeCatalog } from "../../shared/petThemeCatalog";
import { SpritesheetSprite } from "./SpritesheetSprite";
import completedImage from "../assets/pet/completed.webp";
import extraAction7Image from "../assets/pet/extra-action-7.webp";
import extraAction8Image from "../assets/pet/extra-action-8.webp";
import extraActionAquaBocchiImage from "../assets/pet/extra-action-aqua-bocchi.png";
import idleImage from "../assets/pet/idle.png";
import permissionPromptImage from "../assets/pet/permission-prompt.webp";
import runningImage from "../assets/pet/running.webp";
import { PetAnimationKey, resolvePetAnimation } from "../state/petAnimations";

// Clip assets for the built-in theme. The canonical key superset is wider
// than any one theme, so this record is partial; resolution against the
// built-in catalog can only yield these keys, and idle stays the last-resort
// image if that invariant is ever broken.
const animationImages: Partial<Record<PetAnimationKey, string>> = {
  idle: extraActionAquaBocchiImage,
  running: runningImage,
  waiting_permission: permissionPromptImage,
  done: completedImage,
  extra_action_7: extraAction7Image,
  extra_action_8: extraAction8Image,
  extra_action_aqua_bocchi: idleImage
};

interface PetProps {
  state: PetState;
  stateAnimations?: Record<string, string>;
  idleAnimation?: PetAnimationKey | null;
  previewAnimation?: { key: string; nonce: number } | null;
  /** Transient drag-direction locomotion; overrides every other resolution while set. */
  dragAnimation?: PetAnimationKey | null;
  /** Legacy v2 hook. Current Desk runtime intentionally leaves it unset. */
  lookTarget?: PetLookTarget;
  scale?: number;
  opacity?: number;
  catalog?: PetThemeCatalog;
  /** Active theme's spritesheet; null/undefined renders the built-in clips. */
  spritesheet?: SpritesheetAssets | null;
}

export function Pet({ state, stateAnimations, idleAnimation, previewAnimation, dragAnimation = null, lookTarget = null, scale = 1, opacity = 1, catalog = MINATO_AQUA_CATALOG, spritesheet = null }: PetProps) {
  const resolved = resolvePetAnimation(state, stateAnimations, previewAnimation, idleAnimation, catalog);
  // The drag transient only applies when the active sheet actually has the
  // locomotion row — the built-in clip theme has none, so dragging it never
  // swaps the image.
  const dragOverride = dragAnimation && spritesheet?.animations[dragAnimation] ? dragAnimation : null;
  const animationKey = dragOverride ?? resolved.animationKey;
  const imageKey = dragOverride ?? resolved.imageKey;
  const displayTranslate = spritesheet?.displayOffset
    ? `${spritesheet.displayOffset.x}px ${spritesheet.displayOffset.y}px`
    : undefined;

  const lookFrame = state === "idle" && !dragOverride && !previewAnimation && spritesheet?.look
    ? lookFrameForTarget(lookTarget, spritesheet.look.startRow, spritesheet.look.columns, spritesheet.look.neutralFrame)
    : null;
  if (spritesheet && lookFrame) {
    const height = displayedSpriteHeight(spritesheet.cellWidth, spritesheet.cellHeight, PET_IMAGE_SIZE);
    return (
      <div className={`pet pet-${state}`} style={{ transform: `scale(${scale})`, opacity, height, translate: displayTranslate }}>
        <SpritesheetSprite
          sheetUrl={spritesheet.sheetUrl}
          columns={spritesheet.columns}
          rows={spritesheet.rows}
          row={lookFrame.row}
          frameCount={1}
          frameDurationMs={160}
          fixedFrame={lookFrame.column}
          width={PET_IMAGE_SIZE}
          height={height}
          alt="pointer look"
          errorFallbackUrl={idleImage}
        />
      </div>
    );
  }

  const spriteAnimation = spritesheet?.animations[animationKey];
  if (spritesheet && spriteAnimation) {
    // Pack cells keep the pet's display width; height follows the cell's
    // aspect ratio (codex-pet cells are taller than square).
    const height = displayedSpriteHeight(spritesheet.cellWidth, spritesheet.cellHeight, PET_IMAGE_SIZE);
    return (
      <div className={`pet pet-${state}`} style={{ transform: `scale(${scale})`, opacity, height, translate: displayTranslate }}>
        <SpritesheetSprite
          key={imageKey}
          sheetUrl={spritesheet.sheetUrl}
          columns={spritesheet.columns}
          rows={spritesheet.rows}
          row={spriteAnimation.row}
          frameCount={spriteAnimation.frameCount}
          frameDurationMs={spriteAnimation.frameDurationMs}
          width={PET_IMAGE_SIZE}
          height={height}
          alt={animationKey}
          errorFallbackUrl={idleImage}
        />
      </div>
    );
  }

  return (
    <div className={`pet pet-${state}`} style={{ transform: `scale(${scale})`, opacity }}>
      <img key={imageKey} src={animationImages[animationKey] ?? idleImage} alt={animationKey} draggable={false} />
    </div>
  );
}

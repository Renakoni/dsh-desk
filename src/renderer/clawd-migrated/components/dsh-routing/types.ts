import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { DshProvider } from "../../../../shared/dshProviders";

export type DshRouteProvider = DshProvider;

export type DragHandleProps = {
  attributes: DraggableAttributes;
  listeners?: SyntheticListenerMap;
  isDragging: boolean;
};

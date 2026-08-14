import { PetEvent, PetState } from "../../shared/events";

export function nextPetState(current: PetState, event: PetEvent): PetState {
  if (event.notificationKind === "info") return current;
  if (event.event === "idle" || event.event === "completed") return event.event;
  if (current === "permission-prompt" && event.event === "running" && event.title !== "Tool completed") return current;
  return event.event;
}

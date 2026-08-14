import type { CompanionEvent } from "../shared/events";

// tool_end (ends a tool) and git_operation (a transient toast) never become the pet's
// current event and never drive its state, so they're excluded from every selection.
function isNonSurfacingEvent(event: CompanionEvent): boolean {
  return event.event === "tool_end" || event.event === "git_operation";
}

// An informational notification (notificationKind "info") is display-only: useCompanion
// deliberately refuses to let it drive pet state. It's still eligible for DISPLAY (it can
// be the newest thing worth showing) but must be excluded from the STATE selection.
function isInformationalNotification(event: CompanionEvent): boolean {
  return event.event === "notification" && event.notificationKind === "info";
}

function latestMatching(
  pending: readonly CompanionEvent[],
  accept: (event: CompanionEvent) => boolean
): CompanionEvent | null {
  let latest: CompanionEvent | null = null;
  for (const event of pending) {
    if (!accept(event)) continue;
    // Max timestamp — correct and order-independent, so the pet and the panel (which
    // reverses its own copy for display) agree on the chosen event.
    if (!latest || event.timestamp >= latest.timestamp) latest = event;
  }
  return latest;
}

/**
 * The latest event in a coalesced 100ms burst to SHOW as the pet's current event
 * (bubble). Excludes tool_end/git_operation; an informational notification is eligible.
 */
export function pickThrottledDisplayEvent(pending: readonly CompanionEvent[]): CompanionEvent | null {
  return latestMatching(pending, event => !isNonSurfacingEvent(event));
}

/**
 * The latest event in a coalesced 100ms burst that should DRIVE the pet's state.
 *
 * Beyond tool_end/git_operation this also excludes informational notifications, which
 * useCompanion never applies to state. Selecting a single event for both display and
 * state let a trailing info notification (e.g. tool_start → done → info) mask the
 * earlier `done`, stranding the pet on "using tool" after the turn had finished — the
 * very stale-state bug this module exists to prevent. Picking by max timestamp keeps
 * a burst ending in done/error resolving to that terminal state, order-independently.
 */
export function pickThrottledStateEvent(pending: readonly CompanionEvent[]): CompanionEvent | null {
  return latestMatching(pending, event => !isNonSurfacingEvent(event) && !isInformationalNotification(event));
}

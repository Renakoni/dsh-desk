import { describe, expect, it } from "vitest";
import { pickThrottledDisplayEvent, pickThrottledStateEvent } from "../src/renderer/clawd-migrated/eventThrottle";
import type { CompanionEvent } from "../src/renderer/shared/events";

function ev(event: CompanionEvent["event"], timestamp: number): CompanionEvent {
  return { id: `${event}-${timestamp}`, source: "claude-code", event, title: "", message: "", timestamp };
}

function notif(notificationKind: "idle" | "attention" | "info", timestamp: number): CompanionEvent {
  return { id: `notification-${notificationKind}-${timestamp}`, source: "claude-code", event: "notification", notificationKind, title: "", message: "", timestamp };
}

describe("pickThrottledStateEvent", () => {
  it("picks the latest event when a burst ends in done (the stale-state bug)", () => {
    expect(pickThrottledStateEvent([ev("tool_start", 1), ev("done", 2)])?.event).toBe("done");
  });

  it("picks the latest event when a burst ends in error", () => {
    expect(pickThrottledStateEvent([ev("tool_start", 1), ev("tool_start", 2), ev("error", 3)])?.event).toBe("error");
  });

  it("selects by max timestamp, independent of array/arrival order", () => {
    expect(pickThrottledStateEvent([ev("done", 5), ev("tool_start", 9)])?.timestamp).toBe(9);
    expect(pickThrottledStateEvent([ev("tool_start", 9), ev("done", 5)])?.timestamp).toBe(9);
  });

  it("ignores tool_end and git_operation (they don't drive pet state)", () => {
    expect(pickThrottledStateEvent([ev("tool_start", 1), ev("tool_end", 5), ev("git_operation", 9)])?.event).toBe("tool_start");
  });

  it("returns null when every event is a non-state event", () => {
    expect(pickThrottledStateEvent([ev("tool_end", 1), ev("git_operation", 2)])).toBeNull();
  });

  it("returns null for an empty burst", () => {
    expect(pickThrottledStateEvent([])).toBeNull();
  });

  it("skips a trailing info notification so it can't mask an earlier done (tool_start → done → info)", () => {
    expect(pickThrottledStateEvent([ev("tool_start", 1), ev("done", 2), notif("info", 3)])?.event).toBe("done");
  });

  it("still lets a non-info notification (e.g. attention) drive state", () => {
    const chosen = pickThrottledStateEvent([ev("tool_start", 1), notif("attention", 3)]);
    expect(chosen?.event).toBe("notification");
    expect(chosen?.timestamp).toBe(3);
  });
});

describe("pickThrottledDisplayEvent", () => {
  it("shows the latest surfacing event, including a trailing info notification", () => {
    const shown = pickThrottledDisplayEvent([ev("tool_start", 1), ev("done", 2), notif("info", 3)]);
    expect(shown?.event).toBe("notification");
    expect(shown?.timestamp).toBe(3);
  });

  it("ignores tool_end and git_operation", () => {
    expect(pickThrottledDisplayEvent([ev("tool_start", 1), ev("tool_end", 5), ev("git_operation", 9)])?.event).toBe("tool_start");
  });

  it("returns null for an empty burst", () => {
    expect(pickThrottledDisplayEvent([])).toBeNull();
  });
});

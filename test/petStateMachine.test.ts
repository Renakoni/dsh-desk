import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { nextPetState } from "../src/renderer/state/petStateMachine";
import { isPetEvent, isSessionStartEvent, type PetEvent, type PetState } from "../src/shared/events";

const require = createRequire(import.meta.url);
const { mapHookToPetEvent } = require("../scripts/hook-forwarder.js") as {
  mapHookToPetEvent: (hook: string, payload: Record<string, unknown>) => Partial<PetEvent> & { event: PetState };
};

// nextPetState only reads `.event` and `.title`; fill the rest for the type.
function asEvent(partial: Partial<PetEvent> & { event: PetState }): PetEvent {
  return { id: "test", timestamp: 0, ...partial };
}

describe("nextPetState", () => {
  it("lets idle and completed events win from any state", () => {
    expect(nextPetState("running", asEvent({ event: "idle" }))).toBe("idle");
    expect(nextPetState("error", asEvent({ event: "completed" }))).toBe("completed");
  });

  it("keeps a permission prompt visible over incidental running events", () => {
    expect(nextPetState("permission-prompt", asEvent({ event: "running", title: "Using tool" }))).toBe("permission-prompt");
  });

  it("keeps the core state for informational Notifications", () => {
    expect(nextPetState("running", asEvent({ event: "idle", notificationKind: "info" }))).toBe("running");
    expect(nextPetState("permission-prompt", asEvent({ event: "idle", notificationKind: "info" }))).toBe("permission-prompt");
  });

  it("moves to idle when an attention Notification pauses Claude", () => {
    expect(nextPetState("running", asEvent({ event: "idle", notificationKind: "attention" }))).toBe("idle");
  });
});

describe("regression: idle after completion must not flip back to 'working'", () => {
  it("stays idle when an idle-prompt Notification arrives after a session finishes", () => {
    // 1. Claude finishes the task.
    const stop = mapHookToPetEvent("Stop", {});
    let state: PetState = nextPetState("running", asEvent(stop));
    expect(state).toBe("completed");

    // 2. The renderer resets completed -> idle after its delay.
    state = nextPetState(state, asEvent({ event: "idle", title: "Idle" }));
    expect(state).toBe("idle");

    // 3. Claude sits idle and the CLI emits an idle-prompt Notification.
    const notif = mapHookToPetEvent("Notification", { message: "Claude is done and waiting for your next prompt" });
    expect(notif.event).toBe("idle"); // before the fix this was "running" ("Working")
    state = nextPetState(state, asEvent(notif));

    // 4. The pet stays idle instead of getting stuck on "Working".
    expect(state).toBe("idle");
  });

  it("still enters running for genuine tool activity", () => {
    const pre = mapHookToPetEvent("PreToolUse", { tool_name: "Read", tool_input: { file_path: "a.ts" } });
    expect(nextPetState("idle", asEvent(pre))).toBe("running");
  });

  it("enters running when a new prompt follows a Notification", () => {
    const notif = mapHookToPetEvent("Notification", { notification_type: "idle_prompt" });
    const prompt = mapHookToPetEvent("UserPromptSubmit", { prompt: "Continue" });
    const waiting = nextPetState("completed", asEvent(notif));
    expect(nextPetState(waiting, asEvent(prompt))).toBe("running");
  });
});

describe("isSessionStartEvent", () => {
  it("uses the structured hook name instead of display copy", () => {
    expect(isSessionStartEvent(asEvent({ event: "idle", hook: "SessionStart", title: "Localized title" }))).toBe(true);
    expect(isSessionStartEvent(asEvent({ event: "idle", hook: "agent/session-start", title: "Localized title" }))).toBe(true);
    expect(isSessionStartEvent(asEvent({ event: "idle", hook: "Notification", title: "Claude session started" }))).toBe(false);
  });

  it("keeps compatibility with old events that have no hook metadata", () => {
    expect(isSessionStartEvent(asEvent({ event: "idle", title: "Claude session started" }))).toBe(true);
    expect(isSessionStartEvent(asEvent({ event: "idle", title: "DeepSeek Harness session started" }))).toBe(true);
  });
});

describe("PetEvent notification metadata", () => {
  it("accepts known metadata and rejects unknown notification kinds", () => {
    expect(isPetEvent(asEvent({ event: "idle", hook: "Notification", notificationKind: "info" }))).toBe(true);
    expect(isPetEvent({ ...asEvent({ event: "idle" }), notificationKind: "future_kind" })).toBe(false);
  });

  it("accepts DeepSeek Harness and rejects unknown sources", () => {
    expect(isPetEvent(asEvent({ event: "idle", source: "deepseek-harness" }))).toBe(true);
    expect(isPetEvent({ ...asEvent({ event: "idle" }), source: "future-source" })).toBe(false);
  });
});

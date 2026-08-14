import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// hook-forwarder.js is a CommonJS hook script; require it for its pure helpers.
const require = createRequire(import.meta.url);
const { mapHookToPetEvent, classifyNotification, pickSessionId } = require("../scripts/hook-forwarder.js") as {
  mapHookToPetEvent: (hook: string, payload: Record<string, unknown>) => { event: string; notificationKind?: "idle" | "attention" | "info"; title?: string; message?: string; tool?: string; detail?: string };
  classifyNotification: (payload: Record<string, unknown>) => "idle" | "attention" | "info";
  pickSessionId: (payload: Record<string, unknown>) => string | undefined;
};

describe("pickSessionId (forward the Claude session id on every event)", () => {
  it("reads Claude Code's snake_case session_id", () => {
    expect(pickSessionId({ session_id: "abc-123" })).toBe("abc-123");
  });

  it("accepts a camelCase sessionId fallback", () => {
    expect(pickSessionId({ sessionId: "def-456" })).toBe("def-456");
  });

  it("returns undefined when no id is present, so internal events don't inflate the session count", () => {
    expect(pickSessionId({})).toBeUndefined();
    expect(pickSessionId({ session_id: "" })).toBeUndefined();
    expect(pickSessionId({ session_id: 42 })).toBeUndefined();
  });

  it("caps an over-long id to the PetEvent validation limit (128)", () => {
    expect(pickSessionId({ session_id: "x".repeat(200) })).toHaveLength(128);
  });
});

describe("classifyNotification", () => {
  it("classifies an idle-prompt message as idle", () => {
    expect(classifyNotification({ message: "Claude is done and waiting for your next prompt" })).toBe("idle");
    expect(classifyNotification({ message: "Claude is waiting for your input" })).toBe("idle");
  });

  it("classifies a permission / elicitation message as attention", () => {
    expect(classifyNotification({ message: "Claude needs your permission to use Bash" })).toBe("attention");
    expect(classifyNotification({ message: "Waiting for your approval to continue" })).toBe("attention");
    expect(classifyNotification({ message: "Claude Code needs your input" })).toBe("attention");
    expect(classifyNotification({ message: "Waiting for your input to confirm permission" })).toBe("attention");
  });

  it("falls back to info for empty or unrecognised messages", () => {
    expect(classifyNotification({})).toBe("info");
    expect(classifyNotification({ message: "Background task finished" })).toBe("info");
  });

  it("honours an explicit matcher type over the message text", () => {
    expect(classifyNotification({ type: "idle_prompt" })).toBe("idle");
    expect(classifyNotification({ notification_type: "permission_prompt" })).toBe("attention");
    expect(classifyNotification({ notification_type: "elicitation_dialog", message: "waiting for your input" })).toBe("attention");
    expect(classifyNotification({ notification_type: "auth_success" })).toBe("info");
  });
});

describe("mapHookToPetEvent: Notification semantics", () => {
  it("maps an idle-prompt Notification to a calm waiting/idle state", () => {
    const ev = mapHookToPetEvent("Notification", { message: "Claude is done and waiting for your next prompt" });
    expect(ev.event).toBe("idle");
    expect(ev.event).not.toBe("running");
    expect(ev.notificationKind).toBe("idle");
    expect(ev.title).toBe("Waiting for you");
  });

  it("maps a permission-style Notification to idle with an attention headline", () => {
    const ev = mapHookToPetEvent("Notification", { message: "Claude needs your permission to use Bash" });
    expect(ev.event).toBe("idle");
    expect(ev.notificationKind).toBe("attention");
    expect(ev.title).toMatch(/attention/i);
  });

  it("marks informational Notifications for transient display", () => {
    const ev = mapHookToPetEvent("Notification", { notification_type: "auth_success", message: "Claude Code login successful" });
    expect(ev.event).toBe("idle");
    expect(ev.event).not.toBe("running");
    expect(ev.notificationKind).toBe("info");
    expect(ev.message).toBe("Claude Code login successful");
  });
});

describe("mapHookToPetEvent: real execution still transitions correctly", () => {
  it("keeps PreToolUse as a running/tool event", () => {
    const ev = mapHookToPetEvent("PreToolUse", { tool_name: "Read", tool_input: { file_path: "a.ts" } });
    expect(ev.event).toBe("running");
    expect(ev.tool).toBe("Read");
  });

  it("maps a successful Stop to completed", () => {
    expect(mapHookToPetEvent("Stop", {}).event).toBe("completed");
  });

  it("maps a failed PostToolUse to an error that keeps its failure title", () => {
    const ev = mapHookToPetEvent("PostToolUse", { tool_name: "Bash", tool_input: { command: "boom" }, error: "exit 1" });
    expect(ev.event).toBe("error");
    expect(ev.title).toBe("Tool failed");
    expect(ev.message).toBe("exit 1");
    expect(ev.detail).toBe("boom");
  });

  it("extracts nested and structured error reasons", () => {
    expect(mapHookToPetEvent("PostToolUse", {
      tool_name: "Bash",
      tool_response: { error: { message: "nested failure" } }
    }).message).toBe("nested failure");
    expect(mapHookToPetEvent("Stop", { exception: { message: "session crashed" } }).message).toBe("session crashed");
  });

  it("falls back to a non-zero exit code when no error text exists", () => {
    expect(mapHookToPetEvent("PostToolUse", { exit_code: 7 }).message).toBe("Exited with code 7");
  });
});

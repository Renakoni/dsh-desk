import { describe, expect, it } from "vitest";
import { redactDisplayEvent, redactSensitiveText } from "../src/shared/privacy";

describe("redactDisplayEvent", () => {
  it("removes paths, commands, and prompt text while preserving event identity", () => {
    const event = {
      id: "event-1",
      event: "tool_start",
      tool: "Bash",
      title: "Run npm publish",
      message: "Publishing private package",
      detail: "npm publish --//registry.example.test/:_authToken=secret",
      cwd: "C:\\Users\\private\\project",
      timestamp: 123
    };

    expect(redactDisplayEvent(event)).toEqual({
      id: "event-1",
      event: "tool_start",
      tool: "Bash",
      title: "Bash activity",
      message: "",
      detail: undefined,
      cwd: undefined,
      timestamp: 123
    });
  });

  it("uses stable labels for notifications and completed work", () => {
    expect(redactDisplayEvent({ event: "notification", notificationKind: "info", title: "private", message: "private" }).title).toBe("Notification");
    expect(redactDisplayEvent({ event: "done", title: "private", message: "private" }).title).toBe("Completed");
  });

  it("localizes stable labels without restoring sensitive details", () => {
    expect(redactDisplayEvent({ event: "error", title: "private", message: "secret" }, "zh")).toMatchObject({
      title: "任务出错",
      message: ""
    });
  });
});

describe("redactSensitiveText", () => {
  it("strips a Windows drive path from a hook-operation error, keeping the rest", () => {
    const message = "Hook forwarder not found: C:\\Users\\private\\AppData\\hook-forwarder.js";
    expect(redactSensitiveText(message)).toBe("Hook forwarder not found: [path hidden]");
  });

  it("strips UNC and POSIX home paths", () => {
    expect(redactSensitiveText("Backup at \\\\nas\\share\\clawd\\settings.json")).toBe("Backup at [path hidden]");
    expect(redactSensitiveText("Backup at //nas/share/clawd/settings.json")).toBe("Backup at [path hidden]");
    expect(redactSensitiveText("Wrote ~/.claude/settings.json")).toBe("Wrote [path hidden]");
    expect(redactSensitiveText("Reading /Users/private/project/a.ts")).toBe("Reading [path hidden]");
  });

  it("strips common POSIX roots the old implementation missed", () => {
    // These were reproduced as leaks in review — /opt, /tmp, /usr/local, /Applications.
    expect(redactSensitiveText("Missing: /opt/DSH Desk/resources/hook-forwarder.js")).toBe("Missing: [path hidden]");
    expect(redactSensitiveText("Wrote /tmp/clawd/hook-forwarder.js")).toBe("Wrote [path hidden]");
    expect(redactSensitiveText("node /usr/local/bin/node")).toBe("node [path hidden]");
    expect(redactSensitiveText("/Applications/DSH Desk.app/hook-forwarder.js")).toBe("[path hidden]");
    expect(redactSensitiveText("Reading /data/home/jdoe/project/file.ts")).toBe("Reading [path hidden]");
    expect(redactSensitiveText("Missing /workspace/private/project/file.ts")).toBe("Missing [path hidden]");
    expect(redactSensitiveText("Mounted /media/jdoe/private/file.ts")).toBe("Mounted [path hidden]");
    expect(redactSensitiveText("Socket /run/user/1000/private.sock")).toBe("Socket [path hidden]");
    expect(redactSensitiveText("Snap /snap/chara/current/private.json")).toBe("Snap [path hidden]");
  });

  it("does not mistake a URL scheme for a forward-slash UNC path", () => {
    expect(redactSensitiveText("Endpoint https://api.example.test/v1")).toBe("Endpoint https://api.example.test/v1");
  });

  it("strips Windows paths that contain spaces", () => {
    expect(redactSensitiveText("Missing: C:\\Program Files\\DSH Desk\\hook-forwarder.js")).toBe("Missing: [path hidden]");
    expect(redactSensitiveText("Missing: C:\\Users\\Jane Doe\\AppData\\hook-forwarder.js")).toBe("Missing: [path hidden]");
  });

  it("handles quoted paths and trailing punctuation without leaking", () => {
    expect(redactSensitiveText('Wrote "C:\\Users\\foo\\settings.json"')).toBe('Wrote "[path hidden]"');
    expect(redactSensitiveText("Missing /opt/app/hook-forwarder.js.")).toBe("Missing [path hidden]");
  });

  it("redacts every path when several appear in one message (never leaks a path)", () => {
    // Over-redaction is acceptable; a leaked path is not.
    const redacted = redactSensitiveText("Moved C:\\a\\forwarder.js to C:\\b\\forwarder.js");
    expect(redacted).not.toContain("C:\\a");
    expect(redacted).not.toContain("C:\\b");
    expect(redacted).toContain("[path hidden]");
  });

  it("leaves status words, counts, versions, and event names intact (no false positives)", () => {
    for (const safe of ["Configured 6 / 6 events", "OK/Check", "v1.2.3", "Repair complete. Fixed 3 config items.", "PreToolUse", "and/or maybe"]) {
      expect(redactSensitiveText(safe)).toBe(safe);
    }
  });

  it("localizes the placeholder for Chinese without leaking the path", () => {
    const redacted = redactSensitiveText("Hook forwarder not found: C:\\Users\\private\\hook-forwarder.js", "zh");
    expect(redacted).toBe("Hook forwarder not found: [路径已隐藏]");
    expect(redacted).not.toContain("private");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionBroker, type PermissionPollResult } from "../src/main/permissionBroker";

// Deterministic regression harness for the in-memory permission broker: the
// state machine behind the /permission long-poll endpoints. Tests exercise the
// REAL production class through its public API only — no Electron, no network,
// no timers beyond vitest's fake clock.

const DEFAULT_ALLOW_REASON = "Approved via DSH Desk";
const DEFAULT_DENY_REASON = "Denied via DSH Desk";
const POLL_TIMEOUT: PermissionPollResult = { status: "expired", reason: "Poll timeout" };

// Brokers created by the running test, so teardown can always drain pending
// requests (and their waiters) before restoring real timers.
let brokers: PermissionBroker[] = [];

function makeBroker(...args: ConstructorParameters<typeof PermissionBroker>): PermissionBroker {
  const broker = new PermissionBroker(...args);
  brokers.push(broker);
  return broker;
}

function createRequest(broker: PermissionBroker, timeoutMs?: number) {
  return broker.create({
    toolName: "Bash",
    toolDetail: "npm run build",
    sessionId: "session-1",
    rawPayload: { tool_name: "Bash", tool_input: { command: "npm run build" } },
    timeoutMs
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const broker of brokers) broker.shutdown("test teardown");
  brokers = [];
  vi.useRealTimers();
});

describe("create: public shape and pending accounting", () => {
  it("returns the stable public PendingPermission shape without rawPayload", () => {
    const broker = makeBroker();
    const pending = createRequest(broker);

    expect(Object.keys(pending).sort()).toEqual(["id", "sessionId", "timestamp", "toolDetail", "toolName"]);
    expect("rawPayload" in pending).toBe(false);
    expect(typeof pending.id).toBe("string");
    expect(pending.id.length).toBeGreaterThan(0);
    expect(pending.toolName).toBe("Bash");
    expect(pending.toolDetail).toBe("npm run build");
    expect(pending.sessionId).toBe("session-1");
    expect(typeof pending.timestamp).toBe("number");
  });

  it("increments size per pending request and gives each request a distinct id", () => {
    const broker = makeBroker();
    expect(broker.size).toBe(0);
    const first = createRequest(broker);
    const second = createRequest(broker);
    expect(broker.size).toBe(2);
    expect(first.id).not.toBe(second.id);
  });
});

describe("unknown request ids", () => {
  it("wait() reports not_found", async () => {
    const broker = makeBroker();
    await expect(broker.wait("no-such-id")).resolves.toEqual({ status: "error", reason: "not_found" });
  });

  it("respond() reports { ok: false }", () => {
    const broker = makeBroker();
    expect(broker.respond({ id: "no-such-id", decision: "allow" })).toEqual({ ok: false });
  });
});

describe("allow and deny decisions", () => {
  it("resolves a pending waiter as approved with the documented default reason", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    const waiter = broker.wait(id);

    expect(broker.respond({ id, decision: "allow" })).toEqual({ ok: true });
    await expect(waiter).resolves.toEqual({ status: "approved", decision: "allow", reason: DEFAULT_ALLOW_REASON });
    expect(broker.size).toBe(0);
  });

  it("resolves a pending waiter as denied with the documented default reason", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    const waiter = broker.wait(id);

    expect(broker.respond({ id, decision: "deny" })).toEqual({ ok: true });
    await expect(waiter).resolves.toEqual({ status: "denied", decision: "deny", reason: DEFAULT_DENY_REASON });
    expect(broker.size).toBe(0);
  });

  it("preserves an explicit reason verbatim", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    const waiter = broker.wait(id);

    broker.respond({ id, decision: "deny", reason: "User rejected the command" });
    await expect(waiter).resolves.toEqual({ status: "denied", decision: "deny", reason: "User rejected the command" });
  });

  it("only settles the responded request, not other pending ones", async () => {
    const broker = makeBroker();
    const first = createRequest(broker);
    const second = createRequest(broker);

    broker.respond({ id: first.id, decision: "allow" });
    expect(broker.size).toBe(1);

    // The second request is still live and decidable.
    const waiter = broker.wait(second.id);
    broker.respond({ id: second.id, decision: "deny" });
    await expect(waiter).resolves.toMatchObject({ status: "denied" });
  });
});

describe("idempotency", () => {
  it("a second response to the same request returns { ok: false } and does not change the decision", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);

    expect(broker.respond({ id, decision: "allow" })).toEqual({ ok: true });
    expect(broker.respond({ id, decision: "deny" })).toEqual({ ok: false });

    // Late pollers still see the FIRST decision.
    await expect(broker.wait(id)).resolves.toMatchObject({ status: "approved", decision: "allow" });
  });

  it("onSettled fires exactly once per request even with a repeated response", () => {
    const onSettled = vi.fn();
    const broker = makeBroker({ onSettled });
    const { id } = createRequest(broker);

    broker.respond({ id, decision: "allow" });
    broker.respond({ id, decision: "allow" });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ id, toolName: "Bash" }),
      expect.objectContaining({ status: "approved", decision: "allow" })
    );
  });
});

describe("multiple concurrent waiters", () => {
  it("delivers the same final decision to every waiter", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    const waiters = [broker.wait(id), broker.wait(id), broker.wait(id)];

    broker.respond({ id, decision: "allow" });
    const results = await Promise.all(waiters);

    for (const result of results) {
      expect(result).toEqual({ status: "approved", decision: "allow", reason: DEFAULT_ALLOW_REASON });
    }
  });

  it("one waiter's poll timeout does not prevent another waiter from settling", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);

    const short = broker.wait(id, 1_000);
    const long = broker.wait(id, 60_000);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(short).resolves.toEqual(POLL_TIMEOUT);

    broker.respond({ id, decision: "deny" });
    await expect(long).resolves.toMatchObject({ status: "denied", decision: "deny" });
  });
});

describe("independent poll timeout", () => {
  it("times out the short waiter, keeps the permission pending, and lets a later waiter receive the decision", async () => {
    const onSettled = vi.fn();
    const broker = makeBroker({ onSettled });
    const { id } = createRequest(broker); // default 120s request timeout — far beyond this test's clock

    const short = broker.wait(id, 2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(short).resolves.toEqual(POLL_TIMEOUT);
    // The poll timeout is per-waiter only: the request itself is untouched.
    expect(broker.size).toBe(1);
    expect(onSettled).not.toHaveBeenCalled();

    // A new longer waiter still receives the eventual user decision.
    const retry = broker.wait(id, 60_000);
    broker.respond({ id, decision: "allow" });
    await expect(retry).resolves.toMatchObject({ status: "approved", decision: "allow" });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe("request auto-expiration", () => {
  it("expires at exactly the configured request timeout and settles every active waiter", async () => {
    const onSettled = vi.fn();
    const broker = makeBroker({ onSettled });
    const { id } = createRequest(broker, 5_000);
    const waiters = [broker.wait(id, 60_000), broker.wait(id, 60_000)];

    await vi.advanceTimersByTimeAsync(4_999);
    expect(broker.size).toBe(1);
    expect(onSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const results = await Promise.all(waiters);
    for (const result of results) {
      expect(result).toEqual({ status: "expired", reason: "Timeout" });
    }
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(broker.size).toBe(0);
  });

  it("uses the broker's default timeout when none is configured per request", async () => {
    const broker = makeBroker({ defaultTimeoutMs: 3_000 });
    const { id } = createRequest(broker);
    const waiter = broker.wait(id, 60_000);

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(waiter).resolves.toEqual({ status: "expired", reason: "Timeout" });
    expect(broker.size).toBe(0);
  });
});

describe("cached final result for late pollers", () => {
  it("returns the cached decision immediately after allow", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    broker.respond({ id, decision: "allow", reason: "Fine" });

    // No timer advancement: the cached final result resolves immediately.
    await expect(broker.wait(id, 1)).resolves.toEqual({ status: "approved", decision: "allow", reason: "Fine" });
  });

  it("returns the cached expiration immediately after the request timed out", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(broker.wait(id, 1)).resolves.toEqual({ status: "expired", reason: "Timeout" });
  });
});

describe("shutdown", () => {
  it("expires all pending requests with the shutdown reason and settles every waiter", async () => {
    const onSettled = vi.fn();
    const broker = makeBroker({ onSettled });
    const first = createRequest(broker);
    const second = createRequest(broker);
    const waiters = [broker.wait(first.id, 60_000), broker.wait(second.id, 60_000)];

    broker.shutdown();

    const results = await Promise.all(waiters);
    for (const result of results) {
      expect(result).toEqual({ status: "expired", reason: "App quitting" });
    }
    expect(broker.size).toBe(0);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it("supports a custom shutdown reason", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    const waiter = broker.wait(id, 60_000);

    broker.shutdown("Maintenance restart");
    await expect(waiter).resolves.toEqual({ status: "expired", reason: "Maintenance restart" });
  });

  it("is safe to repeat and never settles a request twice", () => {
    const onSettled = vi.fn();
    const broker = makeBroker({ onSettled });
    createRequest(broker);
    createRequest(broker);

    broker.shutdown();
    broker.shutdown();
    broker.shutdown("again");

    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(broker.size).toBe(0);
  });
});

describe("callback isolation", () => {
  it("a throwing onSettled callback does not make respond() throw", async () => {
    const onSettled = vi.fn(() => { throw new Error("listener exploded"); });
    const broker = makeBroker({ onSettled });
    const { id } = createRequest(broker);
    const waiter = broker.wait(id);

    expect(() => broker.respond({ id, decision: "allow" })).not.toThrow();
    expect(onSettled).toHaveBeenCalledTimes(1);
    // Waiters settled normally despite the exploding callback.
    await expect(waiter).resolves.toMatchObject({ status: "approved" });
  });

  it("a throwing onSettled callback does not poison later requests", async () => {
    const onSettled = vi.fn(() => { throw new Error("listener exploded"); });
    const broker = makeBroker({ onSettled });

    const first = createRequest(broker);
    broker.respond({ id: first.id, decision: "deny" });

    const second = createRequest(broker);
    const waiter = broker.wait(second.id);
    expect(broker.respond({ id: second.id, decision: "allow" })).toEqual({ ok: true });
    await expect(waiter).resolves.toMatchObject({ status: "approved" });
    expect(onSettled).toHaveBeenCalledTimes(2);
  });
});

describe("settled-entry eviction", () => {
  it("evicts a settled request after the grace period so it stops retaining memory", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker);
    broker.respond({ id, decision: "allow" });

    // Within the grace window the cached decision is still readable.
    await expect(broker.wait(id, 1)).resolves.toMatchObject({ status: "approved", decision: "allow" });

    // After the grace period the entry is gone — a later poll reports not_found.
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(broker.wait(id, 1)).resolves.toEqual({ status: "error", reason: "not_found" });
  });

  it("evicts an auto-expired request after the grace period too", async () => {
    const broker = makeBroker();
    const { id } = createRequest(broker, 1_000);
    await vi.advanceTimersByTimeAsync(1_000); // request auto-expires

    await expect(broker.wait(id, 1)).resolves.toEqual({ status: "expired", reason: "Timeout" });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(broker.wait(id, 1)).resolves.toEqual({ status: "error", reason: "not_found" });
  });
});

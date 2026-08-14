/**
 * Permission broker — the in-memory state machine behind the /permission
 * HTTP endpoints. Ported from the Clawd-Companion reference.
 *
 * A permission request is created when a hook (PreToolUse in a mode that
 * requires confirmation) POSTs to /permission. The hook then long-polls
 * GET /permission/:id and blocks Claude Code until the user clicks
 * allow/deny in the pet UI (or the request times out), at which point the
 * decision is written back to Claude Code as a hookSpecificOutput JSON.
 *
 * The broker never exposes a bare `resolve` function: N concurrent waiters
 * subscribe to a listeners Set, so a per-waiter poll timeout can never
 * corrupt another waiter's resolution.
 */

import { randomUUID } from "node:crypto";

export type PermissionDecision = "allow" | "deny";

export interface PermissionPollResult {
  status: "pending" | "approved" | "denied" | "expired" | "error";
  decision?: PermissionDecision;
  reason?: string;
}

export interface PermissionResponse {
  id: string;
  decision: PermissionDecision;
  reason?: string;
}

export interface CreateOptions {
  toolName: string;
  toolDetail?: string;
  sessionId?: string;
  rawPayload: Record<string, unknown>;
  /** Auto-expire after this many ms. Defaults to 120_000 (2 minutes). */
  timeoutMs?: number;
}

export interface PendingPermission {
  id: string;
  toolName: string;
  toolDetail?: string;
  sessionId?: string;
  timestamp: number;
}

interface InternalState extends PendingPermission {
  status: "pending" | "approved" | "denied" | "expired";
  decision?: PermissionDecision;
  reason?: string;
  rawPayload: Record<string, unknown>;
  listeners: Set<(result: PermissionPollResult) => void>;
  timeout: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  final?: PermissionPollResult;
  onSettled?: (state: PendingPermission, result: PermissionPollResult) => void;
}

const POLL_TIMEOUT_RESULT: PermissionPollResult = { status: "expired", reason: "Poll timeout" };

// A settled request is evicted this long after it settles, so a late long-poll
// can still read the cached decision. Without eviction every settled request (and
// its rawPayload) would live in `states` for the whole process lifetime.
const SETTLED_EVICTION_MS = 60_000;

export class PermissionBroker {
  private readonly states = new Map<string, InternalState>();
  private readonly defaultTimeoutMs: number;
  /** Fired once when a request settles (respond / expire / shutdown). */
  private readonly onSettled?: (state: PendingPermission, result: PermissionPollResult) => void;

  constructor(opts: { defaultTimeoutMs?: number; onSettled?: (state: PendingPermission, result: PermissionPollResult) => void } = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;
    this.onSettled = opts.onSettled;
  }

  /** Create a new pending permission and start its auto-expire timer. */
  create(opts: CreateOptions): PendingPermission {
    const id = randomUUID();
    const state: InternalState = {
      id,
      status: "pending",
      toolName: opts.toolName,
      toolDetail: opts.toolDetail,
      sessionId: opts.sessionId,
      rawPayload: opts.rawPayload,
      timestamp: Date.now(),
      listeners: new Set(),
      timeout: undefined as unknown as ReturnType<typeof setTimeout>
    };
    state.timeout = setTimeout(() => this.expire(id, "Timeout"), opts.timeoutMs ?? this.defaultTimeoutMs);
    this.states.set(id, state);
    return { id, toolName: state.toolName, toolDetail: state.toolDetail, sessionId: state.sessionId, timestamp: state.timestamp };
  }

  /**
   * Wait for the permission to resolve. Returns the cached final result if
   * already settled; otherwise subscribes a one-shot listener and races a
   * per-call poll timeout.
   */
  async wait(id: string, pollTimeoutMs = 120_000): Promise<PermissionPollResult> {
    const state = this.states.get(id);
    if (!state) return { status: "error", reason: "not_found" };
    if (state.final) return state.final;

    return new Promise<PermissionPollResult>(resolve => {
      const settle = (result: PermissionPollResult) => {
        state.listeners.delete(settle);
        clearTimeout(pollTimer);
        resolve(result);
      };
      state.listeners.add(settle);
      const pollTimer = setTimeout(() => {
        state.listeners.delete(settle);
        resolve(POLL_TIMEOUT_RESULT);
      }, pollTimeoutMs);
    });
  }

  /** Apply a user decision. Idempotent: a second call returns { ok: false }. */
  respond(response: PermissionResponse): { ok: boolean } {
    const state = this.states.get(response.id);
    if (!state || state.status !== "pending") return { ok: false };
    clearTimeout(state.timeout);
    const status = response.decision === "allow" ? "approved" : "denied";
    this.finalize(state, {
      status,
      decision: response.decision,
      reason: response.reason ?? (response.decision === "allow" ? "Approved via DSH Desk" : "Denied via DSH Desk")
    });
    return { ok: true };
  }

  /** Expire all pending permissions (e.g. from before-quit). Safe to repeat. */
  shutdown(reason = "App quitting"): void {
    for (const state of Array.from(this.states.values())) {
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
      if (state.status !== "pending") continue;
      clearTimeout(state.timeout);
      this.finalize(state, { status: "expired", reason });
    }
    // finalize() above may have scheduled fresh eviction timers; drop them too.
    for (const state of this.states.values()) if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
    this.states.clear();
  }

  /** Number of currently pending permissions. */
  get size(): number {
    let n = 0;
    for (const s of this.states.values()) if (s.status === "pending") n++;
    return n;
  }

  private expire(id: string, reason: string): void {
    const state = this.states.get(id);
    if (!state || state.status !== "pending") return;
    this.finalize(state, { status: "expired", reason });
  }

  private finalize(state: InternalState, result: PermissionPollResult): void {
    state.status = result.status === "approved" ? "approved"
      : result.status === "denied" ? "denied"
        : result.status === "expired" ? "expired"
          : "pending";
    state.decision = result.decision;
    state.reason = result.reason;
    state.final = result;

    const listeners = Array.from(state.listeners);
    state.listeners.clear();
    for (const fn of listeners) {
      try { fn(result); } catch { /* listener errors must not poison the broker */ }
    }

    try {
      this.onSettled?.({ id: state.id, toolName: state.toolName, toolDetail: state.toolDetail, sessionId: state.sessionId, timestamp: state.timestamp }, result);
    } catch { /* notification failures must not poison the broker */ }

    // Evict the settled entry after a grace period. `wait()` returns the cached
    // `final` until then; after eviction it returns not_found (harmless — the hook
    // has already received its decision on its earlier poll). unref so a pending
    // eviction timer never keeps the process alive at quit.
    const cleanup = setTimeout(() => this.states.delete(state.id), SETTLED_EVICTION_MS);
    cleanup.unref?.();
    state.cleanupTimer = cleanup;
  }
}

import { useEffect, useRef, useState } from "react";
import type { HookStatus } from "../../../../shared/hooks";
import type { HookOperationOutcome } from "../../components/hooks/hookOutcome";
import { resolveRecheck } from "./connectionState";

// The connection-surface controller shared by the Overview card and the
// Settings → General connection-management card. Extracted from the panel
// root so the navigation/async behavior is directly testable:
//
// - Refresh the WHOLE chain — hook facts AND connection status — as one
//   guarded request. Both promises are settled together so a connection-status
//   failure is not silently swallowed; results are applied only while this
//   request's sequence is still current, so an older response can never
//   overwrite a newer one. The error is set from the combined outcome —
//   cleared only when BOTH checks succeed — and checking is cleared exactly
//   once, by the owning request.
// - A manual or navigation-triggered recheck clears any prior action message
//   so it cannot linger and contradict the freshly fetched facts; the
//   automatic post-action recheck preserves the just-produced outcome.
// - A completed hook action (install/repair/remove) yields fresh HOOK status
//   and a structured outcome, but says nothing about the live listener — so
//   the outcome is stored (rendered reactively by the surfaces), the fresh
//   hook status applies via a functional update (preserving the latest state
//   on a thrown, null status), and an authoritative full-chain recheck runs.

export interface ConnectionSurface<Connection> {
  hookStatus: HookStatus | null;
  checkError: boolean;
  checking: boolean;
  actionOutcome: HookOperationOutcome | null;
  recheck: (options?: { preserveActionOutcome?: boolean }) => Promise<void>;
  handleOperation: (outcome: HookOperationOutcome) => void;
}

export function useConnectionSurface<Connection>({
  surfaceKey,
  checkHooks,
  getConnectionStatus,
  applyConnection
}: {
  /** connectionSurfaceKey(...) — null while no connection surface is showing. */
  surfaceKey: string | null;
  checkHooks: () => Promise<HookStatus>;
  getConnectionStatus: () => Promise<Connection>;
  applyConnection?: (connection: Connection) => void;
}): ConnectionSurface<Connection> {
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [actionOutcome, setActionOutcome] = useState<HookOperationOutcome | null>(null);
  const seqRef = useRef(0);

  async function recheck({ preserveActionOutcome = false }: { preserveActionOutcome?: boolean } = {}): Promise<void> {
    if (!preserveActionOutcome) setActionOutcome(null);
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setChecking(true);
    const [hookResult, connResult] = await Promise.allSettled([checkHooks(), getConnectionStatus()]);
    if (seqRef.current !== seq) return; // superseded by a newer check or an action
    const outcome = resolveRecheck(hookResult, connResult);
    if (outcome.status) setHookStatus(outcome.status);
    if (outcome.connection) applyConnection?.(outcome.connection);
    setCheckError(outcome.error);
    setChecking(false);
  }

  // Authoritative recheck whenever a connection surface becomes visible (or the
  // user moves between the two visible surfaces — the key changes identity), so
  // an externally changed config cannot leave a stale state indefinitely.
  useEffect(() => {
    if (surfaceKey === null) return undefined;
    void recheck();
    return undefined;
    // recheck is re-created per render but only reads current props/refs; the
    // navigation key is the intentional trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey]);

  function handleOperation(outcome: HookOperationOutcome): void {
    setActionOutcome(outcome);
    setHookStatus(previous => outcome.status ?? previous);
    void recheck({ preserveActionOutcome: true });
  }

  return { hookStatus, checkError, checking, actionOutcome, recheck, handleOperation };
}

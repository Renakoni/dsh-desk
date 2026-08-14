// Pure derivation for the Overview connection workbench. Kept out of the
// (@ts-nocheck) component so the delivery-chain model can be unit-tested.
//
// Each link in the chain is an INDEPENDENT fact: DSH profile registration, the
// bundled installer package, npx availability, the local listener, and the
// recent-event history are reported separately. A listening server with no
// events yet is a healthy, non-failure state ("waiting for the first event") —
// a past event is never treated as proof the live link is currently up, and its
// absence never marks the link down. Repair/Remove are offered ONLY for the
// links Repair can actually fix (hook configuration / command), never for a
// forwarder-file or listener problem that Repair cannot resolve.
import type { HookStatus } from "../../../../shared/hooks";

export type ConnectionRowState = "healthy" | "waiting" | "partial" | "repair" | "unavailable";

// Which surface the connection area shows. These are mutually exclusive:
//  - loading:       the hook check has not resolved yet
//  - error:         the check failed, or the settings file is unreadable/corrupt
//  - notConfigured: neither DSH profile has the plugin (prominent one-click Connect)
//  - workbench:     the factual delivery-chain rows (+ contextual actions)
export type ConnectionMode = "loading" | "error" | "notConfigured" | "workbench";

// Why the area is in `error` mode. These are materially different problems:
//  - check-failed:        a Recheck IPC request failed — retrying may fix it
//  - settings-unreadable: the settings file is present but corrupt/unreadable —
//                         retrying will not help; the file needs attention
export type ConnectionErrorReason = "check-failed" | "settings-unreadable";

// The derivation intentionally needs only a subset of the shared HookStatus; a
// Pick keeps it tied to the single source of truth so it cannot silently drift.
// Bundle/npx facts are optional HERE ONLY so the pure derivation remains
// defensive if an older renderer receives an incomplete payload.
export type HookStatusInput =
  Pick<HookStatus, "installed" | "hookCount" | "requiredCount" | "missingEvents" | "commandMatches" | "configReadError">
  & Partial<Pick<HookStatus, "bundle" | "npxAvailable">>;

export interface ConnectionInput {
  serverListening?: boolean;
  lastEventAt?: number | null;
  port?: number | null;
}

export interface ConnectionFacts {
  mode: ConnectionMode;
  /** Present only in `error` mode; distinguishes a transient check failure from
      an unreadable settings file so the UI can give accurate remediation. */
  errorReason: ConnectionErrorReason | null;
  requiredCount: number;
  configuredCount: number;
  configComplete: boolean;
  commandOk: boolean;
  bundleKnown: boolean;
  bundleOk: boolean;
  npxAvailable: boolean;
  listening: boolean;
  hasRecentEvent: boolean;
  /** Overall health does NOT depend on a recent event, only on the live links. */
  healthy: boolean;
  /** Hook configuration or command needs fixing (the things Repair actually fixes). */
  needsHookRepair: boolean;
  /** Repair can run only when both the bundled package and npx are available. */
  canRepair: boolean;
  bundleMissing: boolean;
  /** Local listener is down — a Repair cannot restart it; needs its own guidance. */
  listenerDown: boolean;
  configState: ConnectionRowState;
  commandState: ConnectionRowState;
  bundleState: ConnectionRowState;
  npxState: ConnectionRowState;
  listenerState: ConnectionRowState;
  recentEventState: ConnectionRowState;
}

const DEFAULT_REQUIRED_COUNT = 6;

export function deriveConnectionState(
  hookStatus: HookStatusInput | null,
  connection: ConnectionInput,
  checkError = false
): ConnectionFacts {
  const requiredCount = hookStatus?.requiredCount ?? DEFAULT_REQUIRED_COUNT;
  const configuredCount = hookStatus?.hookCount ?? 0;
  const configComplete = hookStatus ? hookStatus.missingEvents.length === 0 : false;
  const commandOk = hookStatus?.commandMatches === true;

  const bundleKnown = Boolean(hookStatus?.bundle);
  const bundleOk = hookStatus?.bundle ? hookStatus.bundle.exists : false;
  const npxAvailable = hookStatus?.npxAvailable === true;

  const listening = connection.serverListening === true;
  const hasRecentEvent = Boolean(connection.lastEventAt);

  // A past event is not proof the live link is healthy, so it is deliberately
  // excluded — health tracks the currently-verifiable links only.
  const healthy = hookStatus?.installed === true && listening;

  const needsHookRepair = hookStatus !== null && hookStatus.installed !== true;
  const bundleMissing = bundleKnown && !bundleOk;
  const listenerDown = !listening;
  // Repair re-runs the official DSH profile add command for both profiles.
  const canRepair = needsHookRepair && bundleOk && npxAvailable;

  let mode: ConnectionMode;
  let errorReason: ConnectionErrorReason | null = null;
  if (checkError) {
    // A Recheck request failed — retrying may fix it.
    mode = "error";
    errorReason = "check-failed";
  } else if (hookStatus === null) {
    mode = "loading";
  } else if (hookStatus.configReadError) {
    // The settings file is present but unreadable/corrupt; retrying won't help,
    // so this is a distinct, factual error rather than a transient refresh failure.
    mode = "error";
    errorReason = "settings-unreadable";
  } else if (configuredCount === 0) {
    // The plugin may be absent because this is first use or because it was
    // removed externally; both cases warrant the same install action.
    mode = "notConfigured";
  } else {
    mode = "workbench";
  }

  return {
    mode,
    errorReason,
    requiredCount,
    configuredCount,
    configComplete,
    commandOk,
    bundleKnown,
    bundleOk,
    npxAvailable,
    listening,
    hasRecentEvent,
    healthy,
    needsHookRepair,
    canRepair,
    bundleMissing,
    listenerDown,
    configState: configComplete ? "healthy" : "partial",
    commandState: commandOk ? "healthy" : "repair",
    bundleState: bundleOk ? "healthy" : "unavailable",
    npxState: npxAvailable ? "healthy" : "unavailable",
    listenerState: listening ? "healthy" : "unavailable",
    recentEventState: hasRecentEvent ? "healthy" : "waiting"
  };
}

// Which panel surfaces actually render the connection area: the Overview
// section, and Settings only while its General subsection is showing (that is
// where the connection-management card lives). Gating the authoritative
// recheck on THIS — not just the top-level section — means returning to
// Settings → General after an external change re-verifies the chain, and
// entering a Settings subsection without the card fires no invisible
// diagnostics request.
//
// The key is a stable IDENTITY rather than a boolean: moving between the two
// visible surfaces (Overview → Settings/General) changes the key and re-fires
// an effect keyed on it, where a boolean would stay `true` and swallow that
// recheck. Null means no connection surface is showing.
export function connectionSurfaceKey(activeSection: string, settingsSubsection: string): string | null {
  if (activeSection === "general") return "overview";
  if (activeSection === "settings" && settingsSubsection === "general") return "settings-general";
  return null;
}

export function isConnectionSurfaceVisible(activeSection: string, settingsSubsection: string): boolean {
  return connectionSurfaceKey(activeSection, settingsSubsection) !== null;
}

export interface RecheckOutcome<Status, Connection> {
  /** Fresh hook status to apply, if that request succeeded. */
  status?: Status;
  /** Fresh connection status to apply, if that request succeeded. */
  connection?: Connection;
  /** The recheck is an error unless BOTH required requests succeeded. */
  error: boolean;
}

// Combine the two settled results of a full-chain Recheck (hook status +
// connection status). Only fulfilled values are applied, so a failed request
// preserves the previous data; the error is set unless BOTH succeed — a hook
// success paired with a connection failure is still an error, and a connection
// failure alone never clears the error.
export function resolveRecheck<Status, Connection>(
  hookResult: PromiseSettledResult<Status>,
  connResult: PromiseSettledResult<Connection>
): RecheckOutcome<Status, Connection> {
  return {
    status: hookResult.status === "fulfilled" ? hookResult.value : undefined,
    connection: connResult.status === "fulfilled" ? connResult.value : undefined,
    error: !(hookResult.status === "fulfilled" && connResult.status === "fulfilled")
  };
}

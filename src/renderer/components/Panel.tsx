import type { CSSProperties } from "react";
import { isSessionStartEvent, PetEvent, PetState } from "../../shared/events";
import { actionForTool, parseMcpTool, toolLabel } from "./toolPresentation";

interface PanelProps {
  state: PetState;
  event: PetEvent | null;
  /** Status-feedback size (feedbackScale) and opacity (feedbackOpacity). */
  scale?: number;
  opacity?: number;
  exiting?: boolean;
}

const stateLabels: Record<PetState, string> = {
  idle: "Idle",
  running: "Working",
  "permission-prompt": "Permission",
  completed: "Done",
  error: "Error"
};

export function Panel({ state, event, scale = 1, opacity = 1, exiting = false }: PanelProps) {
  const tool = event?.tool;
  const detail = event?.detail?.trim();
  const isError = state === "error";
  const isConnected = event ? isSessionStartEvent(event) : false;
  const detailIsProse = !isError
    && (tool?.toLowerCase().replace(/[^a-z0-9]+/g, "") === "askuserquestion" || parseMcpTool(tool) !== null);
  const notificationKind = event?.notificationKind;
  const eyebrow = isConnected ? "Connected" : notificationKind === "attention"
    ? "Attention"
    : notificationKind === "info" ? "Notice" : stateLabels[state];

  // Errors keep their explicit failure title (e.g. "Tool failed") and reason
  // instead of the generic action — the failure text is the point. Normal tool
  // activity leads with the action ("Read a file") plus the tool chip.
  const headline = isConnected ? "DeepSeek Harness" : !isError && tool
    ? actionForTool(tool)
    : (event?.title ?? (isError ? "Something went wrong" : "DSH Desk"));

  // Prose note: the message for errors and non-tool events (deduped against the
  // headline). Normal tool events show their target on the mono path line.
  const message = event?.message?.trim();
  const isRedundantCompletionMessage = state === "completed" && message === "Task finished";
  const note = !isConnected && !isRedundantCompletionMessage && (isError || !tool) && message && message !== headline ? message : undefined;

  return (
    <section
      className={`pet-bubble panel state-${state}${notificationKind ? ` notification-${notificationKind}` : ""}${exiting ? " panel-exiting" : ""}`}
      style={{ "--bubble-scale": scale, "--bubble-opacity": opacity } as CSSProperties}
      aria-label="Pet status"
    >
      <div className="bubble-eyebrow">
        <span className="bubble-dot" aria-hidden="true" />
        {eyebrow}
      </div>

      <div className="bubble-body">
        <p className="bubble-action">{headline}</p>
        {tool ? <span className="bubble-tool-chip">{toolLabel(tool)}</span> : null}
      </div>

      {!isError && tool && detail && !detailIsProse ? <div className="panel-path" title={detail}><bdi>{detail}</bdi></div> : null}
      {detailIsProse && detail ? <p className="panel-note panel-note-prose" title={detail}>{detail}</p> : null}
      {note ? <p className="panel-note" title={note}>{note}</p> : null}
    </section>
  );
}

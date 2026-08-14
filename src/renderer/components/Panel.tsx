import type { CSSProperties } from "react";
import { PetEvent, PetState } from "../../shared/events";
import { actionForTool, toolLabel } from "./toolPresentation";

interface PanelProps {
  state: PetState;
  event: PetEvent | null;
  /** Status-feedback size (feedbackScale) and opacity (feedbackOpacity). */
  scale?: number;
  opacity?: number;
}

const stateLabels: Record<PetState, string> = {
  idle: "Idle",
  running: "Working",
  "permission-prompt": "Permission",
  completed: "Done",
  error: "Error"
};

export function Panel({ state, event, scale = 1, opacity = 1 }: PanelProps) {
  const tool = event?.tool;
  const detail = event?.detail?.trim();
  const isError = state === "error";
  const notificationKind = event?.notificationKind;
  const eyebrow = notificationKind === "attention"
    ? "Attention"
    : notificationKind === "info" ? "Notice" : stateLabels[state];

  // Errors keep their explicit failure title (e.g. "Tool failed") and reason
  // instead of the generic action — the failure text is the point. Normal tool
  // activity leads with the action ("Read a file") plus the tool chip.
  const headline = !isError && tool
    ? actionForTool(tool)
    : (event?.title ?? (isError ? "Something went wrong" : "DSH Desk is ready"));

  // Prose note: the message for errors and non-tool events (deduped against the
  // headline). Normal tool events show their target on the mono path line.
  const message = event?.message?.trim();
  const note = (isError || !tool) && message && message !== headline ? message : undefined;

  return (
    <section
      className={`pet-bubble panel state-${state}${notificationKind ? ` notification-${notificationKind}` : ""}`}
      style={{ "--bubble-scale": scale, opacity } as CSSProperties}
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

      {!isError && tool && detail ? <div className="panel-path" title={detail}><bdi>{detail}</bdi></div> : null}
      {note ? <p className="panel-note" title={note}>{note}</p> : null}
    </section>
  );
}

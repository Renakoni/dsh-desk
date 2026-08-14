// @ts-nocheck
import React, { useId } from "react";

interface ToggleProps {
  label: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Explicit accessible name, for when `label` is empty/decorative (the visible name
   *  lives elsewhere in the row). When omitted, the visible `label` names the switch
   *  via aria-labelledby. */
  ariaLabel?: string;
}

export function Toggle({ label, checked, onChange, ariaLabel }: ToggleProps) {
  const labelId = useId();
  // A wrapping <label> does not name a div[role="switch"], so wire the visible text to
  // the switch explicitly. An explicit ariaLabel (empty/decorative label) takes
  // precedence; it's the only name source in that case, avoiding the
  // aria-labelledby-wins-over-aria-label precedence trap.
  const labelledBy = !ariaLabel && label != null && label !== "" ? labelId : undefined;
  return (
    <label className="toggle-row">
      <span id={labelId}>{label}</span>
      <div
        className={`toggle ${checked ? "on" : "off"}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(!checked); } }}
      >
        <div className="toggle-knob" />
      </div>
    </label>
  );
}


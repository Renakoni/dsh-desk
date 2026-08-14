// @ts-nocheck
import React from "react";

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (val: number) => string;
  onChange: (value: number) => void;
}

export function Slider({ label, min, max, step, value, format, onChange }: SliderProps) {
  const fillPercent = ((value - min) / (max - min)) * 100;

  return (
    <div className="slider-row">
      <div className="slider-label">
        <span className="slider-label-text">{label}</span>
        <span className="slider-value">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--slider-fill": `${fillPercent}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-input"
      />
    </div>
  );
}


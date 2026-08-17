import { useState } from "react";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
}

/** Clamp to [min, max] and snap to the nearest `step` offset from `min`. */
export function clampToStep(n: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, n));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Re-clamp (rounding can nudge past max) and trim float noise.
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(6));
}

/**
 * Thin wrapper over a native range input. The native control is kept (rather
 * than a custom-drawn track) because it is accessible and keyboard-friendly out
 * of the box; styling is applied via CSS in theme.css.
 *
 * Double-clicking the label swaps the track for a number field so an exact value
 * can be typed — Enter/blur commits (clamped + step-snapped), Esc cancels.
 */
export function Slider({ value, min, max, step, onChange, label }: SliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const beginEdit = () => {
    setDraft(String(value));
    setEditing(true);
  };
  const commit = () => {
    const n = Number(draft);
    if (!Number.isNaN(n) && draft.trim() !== "") onChange(clampToStep(n, min, max, step));
    setEditing(false);
  };

  return (
    <label className="slider">
      <span className="slider-label" onDoubleClick={beginEdit} title="Double-click to type a value">
        {label}
      </span>
      {editing ? (
        <input
          type="number"
          className="slider-edit"
          autoFocus
          value={draft}
          min={min}
          max={max}
          step={step}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <input
          type="range"
          className="slider-input"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </label>
  );
}

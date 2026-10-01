import { useId, useState } from "react";
import { coalesceNextEdit } from "../../state/history";

interface NumberInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
}

/**
 * The value a typed draft commits, or null when it shouldn't commit (yet). Blank or
 * unparseable text commits nothing — `Number("")` is 0, so treating a cleared field
 * as a number snapped it straight to `min` and made retyping impossible. A typed value
 * is CLAMPED to [min, max]: the native `min`/`max` only bound the spinner arrows, so
 * a typed `0` or `-5` would otherwise flow through (e.g. a 0% export scale).
 */
export function parseNumberDraft(raw: string, min: number, max: number): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * Numeric input paired with the slider for precise sizing. While focused it shows the
 * user's own DRAFT text (so the field can be cleared and retyped) and commits each
 * valid value; on blur it snaps back to the committed value. Typed digits / a held
 * spinner share one undo step.
 */
export function NumberInput({ value, min, max, step, onChange, label }: NumberInputProps) {
  const gesture = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="number-input">
      <span className="number-input-label">{label}</span>
      <input
        type="number"
        className="number-input-field"
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNumberDraft(e.target.value, min, max);
          if (n !== null) {
            coalesceNextEdit(gesture);
            onChange(n);
          }
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

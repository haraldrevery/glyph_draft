interface NumberInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
}

/**
 * Numeric input paired with the slider for precise grid sizing. Empty / invalid
 * intermediate states (e.g. the field momentarily blank) are swallowed so the
 * consumer never receives NaN, and a typed value is CLAMPED to [min, max] — the
 * native `min`/`max` only bound the spinner arrows, so without this a typed `0`
 * or `-5` would flow straight through (e.g. a 0% export scale → invalid SVG).
 */
export function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: NumberInputProps) {
  return (
    <label className="number-input">
      <span className="number-input-label">{label}</span>
      <input
        type="number"
        className="number-input-field"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Multi-selection "mixed" state: the targets disagree. Shows an indeterminate look;
   *  clicking commits a definite ON so the selection becomes uniform. */
  mixed?: boolean;
}

/**
 * A switch-style toggle built on a real <button role="switch">, so it is
 * keyboard-operable and announces its state to assistive tech for free. The
 * visual thumb is purely decorative (aria-hidden); focus styling is handled by
 * the global :focus-visible rule rather than inline so it can respect the
 * quiet, single-accent palette.
 */
export function Toggle({ checked, onChange, label, mixed = false }: ToggleProps) {
  return (
    <div className="toggle">
      <span className="toggle-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={mixed ? "mixed" : checked}
        aria-label={label}
        className={`toggle-switch${mixed ? " is-mixed" : checked ? " is-on" : ""}`}
        // A mixed toggle commits a definite ON, making the selection uniform.
        onClick={() => onChange(mixed ? true : !checked)}
      >
        <span className="toggle-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

interface KnobProps {
  /** Angle in degrees, screen-clockwise from +x (0 = pointing right, 90 = down). */
  value: number;
  onChange: (deg: number) => void;
  label: string;
}

/**
 * A small rotary knob for picking an angle (the gradient direction). Drag anywhere
 * over the dial and the pointer aims at the cursor; the reported degrees are
 * screen-clockwise from +x (matching `atan2(dy, dx)` in Y-down screen space), so the
 * value feeds `linearGradientSpec` directly. Keyboard-operable via the arrow keys.
 */
export function Knob({ value, onChange, label }: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);

  const setFromPoint = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const deg = (Math.atan2(clientY - (r.top + r.height / 2), clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    onChange((Math.round(deg) + 360) % 360);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setFromPoint(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => setFromPoint(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rad = (value * Math.PI) / 180;
  const px = 50 + Math.cos(rad) * 36;
  const py = 50 + Math.sin(rad) * 36;

  return (
    <div className="knob-row">
      <span className="knob-label">{label}</span>
      <div
        ref={ref}
        className="knob"
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={360}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange((Math.round(value) + 359) % 360);
          else if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange((Math.round(value) + 1) % 360);
        }}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="knob-face" cx="50" cy="50" r="44" />
          <line className="knob-pointer" x1="50" y1="50" x2={px} y2={py} />
        </svg>
      </div>
    </div>
  );
}

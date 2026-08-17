import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Size, Viewport } from "../../../types/viewport";

/**
 * A draggable 1-unit coordinate reference, rendered in the screen-space overlay.
 * The X and Y arms are each exactly one world unit long at the current zoom
 * (`viewport.zoom` px), so they grow/shrink as you zoom — a live legend for how
 * big "1 u" really is. It is screen-fixed (stays put when panning); drag the
 * origin handle to reposition. Component-local state only — not geometry, not
 * undoable, not persisted (the View toggle owns visibility).
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function UnitReference({
  viewport,
  canvasSize,
}: {
  viewport: Viewport;
  canvasSize: Size;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Default to the lower-left corner until the user drags it.
  const ax = anchor ? anchor.x : 28;
  const ay = anchor ? anchor.y : canvasSize.height - 44;
  const len = viewport.zoom; // exactly 1 world unit, in screen px

  const onDown = (e: ReactPointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!dragging) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setAnchor({
      x: clamp(e.clientX - r.left, 8, canvasSize.width - 8),
      y: clamp(e.clientY - r.top, 8, canvasSize.height - 8),
    });
  };
  const onUp = (e: ReactPointerEvent<SVGCircleElement>) => {
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <g className="unit-ref">
      {/* X axis (→) and Y axis (↑), each exactly 1 u long at this zoom. */}
      <line className="unit-ref-axis" x1={ax} y1={ay} x2={ax + len} y2={ay} />
      <line className="unit-ref-axis" x1={ax} y1={ay} x2={ax} y2={ay - len} />
      {/* End ticks. */}
      <line className="unit-ref-axis" x1={ax + len} y1={ay - 4} x2={ax + len} y2={ay + 4} />
      <line className="unit-ref-axis" x1={ax - 4} y1={ay - len} x2={ax + 4} y2={ay - len} />
      <text className="unit-ref-label" x={ax + len + 5} y={ay + 4}>x</text>
      <text className="unit-ref-label" x={ax + 5} y={ay - len - 4}>y</text>
      <text className="unit-ref-label" x={ax + 6} y={ay + 16}>1 u</text>
      {/* Origin drag handle (the only pointer-active part). */}
      <circle
        className="unit-ref-handle"
        cx={ax}
        cy={ay}
        r={8}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </g>
  );
}

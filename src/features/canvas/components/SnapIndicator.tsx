import type { Vec2, Viewport } from "../../../types/viewport";
import { worldToScreen } from "../../../engine/viewport/transform";

/**
 * A small crosshair shown at the grid point the cursor is currently snapping
 * to. Rendered in the overlay group at a screen position, so it keeps a
 * constant pixel size at every zoom level — the accent reserved for live
 * interaction feedback.
 */
export function SnapIndicator({
  point,
  viewport,
}: {
  point: Vec2;
  viewport: Viewport;
}) {
  const s = worldToScreen(point, viewport);
  return (
    <g className="snap-indicator" transform={`translate(${s.x},${s.y})`}>
      <line x1={-7} y1={0} x2={7} y2={0} className="snap-cross" />
      <line x1={0} y1={-7} x2={0} y2={7} className="snap-cross" />
      <circle r={3} className="snap-dot" />
    </g>
  );
}

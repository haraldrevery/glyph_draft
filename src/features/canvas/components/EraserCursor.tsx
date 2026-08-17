import type { Vec2, Viewport } from "../../../types/viewport";
import { worldToScreen } from "../../../engine/viewport/transform";

/**
 * The eraser's size indicator: a constant-pixel circle of radius `size` at the
 * cursor, so the user sees the pick reach. Rendered in the overlay group (screen
 * space), so it stays the same size at any zoom.
 */
export function EraserCursor({
  point,
  size,
  viewport,
}: {
  point: Vec2;
  size: number;
  viewport: Viewport;
}) {
  const s = worldToScreen(point, viewport);
  return <circle className="eraser-cursor" cx={s.x} cy={s.y} r={size} />;
}

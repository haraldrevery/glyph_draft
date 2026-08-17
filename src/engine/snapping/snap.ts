import type { Vec2 } from "../../types/viewport";

/**
 * Snap-to-grid lives here as pure functions so it has exactly one definition.
 * Phase 1 uses it only to drive the live cursor readout and the snap marker,
 * but the Pen tool, primitives, and selection drag in later phases all call the
 * same `snapPoint` — guaranteeing identical quantization everywhere.
 *
 * All values are in WORLD units; snapping in screen space would change behavior
 * with zoom, which is never what a glyph designer wants.
 */

export function snapValue(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapPoint(p: Vec2, grid: number, enabled: boolean): Vec2 {
  if (!enabled || grid <= 0) return p;
  return { x: snapValue(p.x, grid), y: snapValue(p.y, grid) };
}

/**
 * Constrain `p` to a ray from `anchor` whose angle is the nearest multiple of
 * `stepDeg` (e.g. 45° for the pen's Shift angle-lock). The distance from the
 * anchor is preserved; only the direction is quantized. Zero-length input is
 * returned unchanged.
 */
export function constrainAngle(anchor: Vec2, p: Vec2, stepDeg: number): Vec2 {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || stepDeg <= 0) return p;
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist };
}

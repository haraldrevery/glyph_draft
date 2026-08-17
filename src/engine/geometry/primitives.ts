import type { AnchorPoint, Contour } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { createId } from "../../utils/id";
import { ensureWinding } from "./path";

/**
 * Factories for the primitive tools. Each returns a plain Contour ready to drop
 * into the document store. Closed primitives are normalized to clockwise so the
 * whole document follows the "outer contour clockwise" convention from the
 * winding-rules pillar; that consistency is what makes nonzero-fill holes and
 * FontForge import behave predictably.
 *
 * Inputs are world/font units. Rectangles and ellipses are described by a
 * world-space box so the shape tools can build one straight from a drag.
 */

function corner(x: number, y: number): AnchorPoint {
  return { id: createId("pt"), type: "corner", x, y };
}

/** A smooth anchor with explicit (absolute) bezier handles. */
function smooth(point: Vec2, handleIn: Vec2, handleOut: Vec2): AnchorPoint {
  return {
    id: createId("pt"),
    type: "smooth",
    x: point.x,
    y: point.y,
    handleIn,
    handleOut,
  };
}

/** An open two-point line. */
export function makeLine(a: Vec2, b: Vec2): Contour {
  return {
    id: createId("ct"),
    closed: false,
    points: [corner(a.x, a.y), corner(b.x, b.y)],
  };
}

/**
 * A rectangle from a world-space box. Width/height may be negative (the box is
 * normalized first), so it works regardless of drag direction.
 */
export function makeRectangle(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Contour {
  const x0 = Math.min(box.x, box.x + box.width);
  const x1 = Math.max(box.x, box.x + box.width);
  const y0 = Math.min(box.y, box.y + box.height);
  const y1 = Math.max(box.y, box.y + box.height);

  const contour: Contour = {
    id: createId("ct"),
    closed: true,
    points: [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)],
  };
  return ensureWinding(contour, "cw");
}

/**
 * A regular N-gon inscribed in a world-space box: center = box center, radii =
 * half the (normalized) box extents, so it sizes from a drag exactly like the
 * ellipse. Vertices start at the top and go around (Y-up), as corner anchors;
 * `sides` is clamped to ≥ 3. Normalized to clockwise like the other primitives.
 * A triangle is just makePolygon(box, 3).
 */
export function makePolygon(
  box: { x: number; y: number; width: number; height: number },
  sides: number,
): Contour {
  const n = Math.max(3, Math.round(sides));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = Math.abs(box.width) / 2;
  const ry = Math.abs(box.height) / 2;

  const points: AnchorPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n; // start at top, go around
    points.push(corner(cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
  }

  const contour: Contour = { id: createId("ct"), closed: true, points };
  return ensureWinding(contour, "cw");
}

/** Quarter-circle handle length as a fraction of the radius (the kappa magic). */
const KAPPA = 0.5522847498307936;

/**
 * An ellipse inscribed in a world-space box, built from four smooth anchors at
 * the cardinal points with kappa-length tangent handles — the standard
 * four-segment cubic approximation of a circle/ellipse.
 */
export function makeEllipse(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Contour {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = Math.abs(box.width) / 2;
  const ry = Math.abs(box.height) / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;

  // Built counter-clockwise (right, top, left, bottom) then normalized to cw.
  const right = smooth(
    { x: cx + rx, y: cy },
    { x: cx + rx, y: cy - oy },
    { x: cx + rx, y: cy + oy },
  );
  const top = smooth(
    { x: cx, y: cy + ry },
    { x: cx + ox, y: cy + ry },
    { x: cx - ox, y: cy + ry },
  );
  const left = smooth(
    { x: cx - rx, y: cy },
    { x: cx - rx, y: cy + oy },
    { x: cx - rx, y: cy - oy },
  );
  const bottom = smooth(
    { x: cx, y: cy - ry },
    { x: cx - ox, y: cy - ry },
    { x: cx + ox, y: cy - ry },
  );

  const contour: Contour = {
    id: createId("ct"),
    closed: true,
    points: [right, top, left, bottom],
  };
  return ensureWinding(contour, "cw");
}

import type { AnchorPoint, Contour } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";

/**
 * Node continuity conversions, pure. A bezier handle's PRESENCE is what makes a
 * segment curved (see `path.ts` `segment()`), and `AnchorPoint.type` records the
 * continuity state used by the overlay marker and by handle mirroring:
 *
 *   - smooth — tangent-symmetric handles (mirrored on drag);
 *   - cusp   — a `corner`-typed node that still HAS handles (moved independently);
 *   - corner — a `corner`-typed node with NO handles (a sharp point).
 *
 * "Make smooth"/"make cusp" synthesize tangent handles from the node's neighbors
 * so a plain corner becomes a grabbable curve; "make corner" strips them.
 */

/** Fallback symmetric handle length for an isolated node (no neighbors), in font units. */
const ISOLATED_HANDLE_LEN = 50;

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Vec2): Vec2 {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

/** Tangent direction + symmetric handle length for a node, from its neighbors. */
function tangent(contour: Contour, index: number): { dir: Vec2; length: number } {
  const pts = contour.points;
  const n = pts.length;
  const p = pts[index]!;
  const prev =
    contour.closed ? pts[(index - 1 + n) % n] : index > 0 ? pts[index - 1] : undefined;
  const next =
    contour.closed ? pts[(index + 1) % n] : index < n - 1 ? pts[index + 1] : undefined;

  let dir: Vec2;
  if (prev && next) dir = normalize(sub(next, prev));
  else if (next) dir = normalize(sub(next, p));
  else if (prev) dir = normalize(sub(p, prev));
  else dir = { x: 1, y: 0 };
  if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 }; // coincident neighbors

  const dPrev = prev ? len(sub(p, prev)) : 0;
  const dNext = next ? len(sub(p, next)) : 0;
  const ref =
    dPrev && dNext ? Math.min(dPrev, dNext) : dPrev || dNext || ISOLATED_HANDLE_LEN;
  return { dir, length: ref / 3 };
}

/** Symmetric tangent handles for the node at `index`. */
function tangentHandles(contour: Contour, index: number): { handleIn: Vec2; handleOut: Vec2 } {
  const p = contour.points[index]!;
  const { dir, length } = tangent(contour, index);
  return {
    handleOut: { x: p.x + dir.x * length, y: p.y + dir.y * length },
    handleIn: { x: p.x - dir.x * length, y: p.y - dir.y * length },
  };
}

/**
 * Convert the node `pointId` in `contour` to the given continuity mode, returning
 * the new anchor (the contour itself is not mutated). Unknown id → the point is
 * returned unchanged by the caller (this assumes the id exists).
 */
export function convertPoint(
  contour: Contour,
  pointId: string,
  mode: "smooth" | "cusp" | "corner",
): AnchorPoint {
  const index = contour.points.findIndex((p) => p.id === pointId);
  const p = contour.points[index]!;

  if (mode === "corner") {
    const next: AnchorPoint = { id: p.id, type: "corner", x: p.x, y: p.y };
    return next;
  }

  if (mode === "smooth") {
    const { handleIn, handleOut } = tangentHandles(contour, index);
    return { ...p, type: "smooth", handleIn, handleOut };
  }

  // cusp: keep existing handles if any; otherwise synthesize them so the node is
  // grabbable. Type becomes corner so the two handles move independently.
  if (p.handleIn || p.handleOut) return { ...p, type: "corner" };
  const { handleIn, handleOut } = tangentHandles(contour, index);
  return { ...p, type: "corner", handleIn, handleOut };
}

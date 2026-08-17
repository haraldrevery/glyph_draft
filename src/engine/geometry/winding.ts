import type { Contour } from "../../types/geometry";
import { ensureWinding } from "./path";
import { flattenContour, pointInRing, type Pt } from "./polygon";

/**
 * The winding-rules engine. Sets every contour's direction by its NESTING
 * DEPTH: a contour at even depth (outermost, or inside two others, …) is an
 * outer boundary and runs CLOCKWISE; odd depth is a hole and runs
 * COUNTER-CLOCKWISE — the convention the renderer's nonzero fill and FontForge's
 * SVG import both expect (in our Y-up space, CW = negative signed area).
 *
 * Depth is measured by testing each contour's extreme (min-y) vertex — which is
 * guaranteed to lie on its boundary — against every other contour with an
 * even-odd point-in-polygon test. For boolean results (clean, non-overlapping)
 * this is exact; for arbitrary hand-drawn input it is the standard heuristic.
 */

/** The min-y (then min-x) vertex — always on the ring's convex hull, so a true
 *  boundary point usable for containment tests. */
function extremePoint(ring: Pt[]): Pt {
  let e = ring[0]!;
  for (const p of ring) {
    if (p.y < e.y || (p.y === e.y && p.x < e.x)) e = p;
  }
  return e;
}

export function correctWinding(contours: Contour[]): Contour[] {
  if (contours.length === 0) return contours;
  const rings = contours.map(flattenContour);
  const probes = rings.map(extremePoint);

  return contours.map((contour, i) => {
    let depth = 0;
    for (let j = 0; j < contours.length; j += 1) {
      if (j === i) continue;
      if (pointInRing(probes[i]!, rings[j]!)) depth += 1;
    }
    const target = depth % 2 === 0 ? "cw" : "ccw";
    return ensureWinding(contour, target);
  });
}

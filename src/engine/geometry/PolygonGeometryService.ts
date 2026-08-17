import type { Contour, StrokeStyle } from "../../types/geometry";
import type { GeometryService } from "./GeometryService";
import { clip } from "./clip";
import { correctWinding } from "./winding";
import { flattenContour, type Pt } from "./polygon";
import { createId } from "../../utils/id";

/**
 * The interim, dependency-free GeometryService: boolean operations on flattened
 * contours plus exact winding correction. It honours the same contract as the
 * eventual Paper.js implementation — plain Contour data in and out — so the two
 * are interchangeable; the only difference is that this one returns polygonal
 * (flattened) boolean results, while Paper.js would preserve curves.
 */
export class PolygonGeometryService implements GeometryService {
  union(a: Contour[], b: Contour[]): Contour[] {
    return clip(a, b, (inA, inB) => inA || inB);
  }

  subtract(a: Contour[], b: Contour[]): Contour[] {
    return clip(a, b, (inA, inB) => inA && !inB);
  }

  intersect(a: Contour[], b: Contour[]): Contour[] {
    return clip(a, b, (inA, inB) => inA && inB);
  }

  exclude(a: Contour[], b: Contour[]): Contour[] {
    return clip(a, b, (inA, inB) => inA !== inB);
  }

  correctWinding(contours: Contour[]): Contour[] {
    return correctWinding(contours);
  }

  /**
   * A flattened, approximate stroker (butt caps, bevel-ish joins): each segment
   * becomes a width-wide quad and all quads are unioned into one clean region.
   * Adequate for the DOM-free tests; the curve-exact stroker is Paper.js.
   */
  expandStroke(contour: Contour, stroke: StrokeStyle): Contour[] {
    const pts = flattenContour(contour);
    if (pts.length < 2) return [];
    const half = stroke.width / 2;
    if (half <= 0) return [];

    const last = contour.closed ? pts.length : pts.length - 1;
    let region: Contour[] = [];
    for (let i = 0; i < last; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const quad = segmentQuad(a, b, half);
      if (quad) region = region.length === 0 ? [quad] : this.union(region, [quad]);
    }
    return region;
  }

  /** Halftone is Paper-only (the dot-grid fill); the polyline test impl has no
   *  halftone, so a combined halftone is a no-op here. */
  expandHalftoneGroup(): Contour[] {
    return [];
  }
}

/** A rectangle covering segment a→b expanded by `half` on each side, or null if degenerate. */
function segmentQuad(a: Pt, b: Pt, half: number): Contour | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  const corners: Pt[] = [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
  return {
    id: createId("ct"),
    closed: true,
    points: corners.map((p) => ({ id: createId("pt"), type: "corner" as const, x: p.x, y: p.y })),
  };
}

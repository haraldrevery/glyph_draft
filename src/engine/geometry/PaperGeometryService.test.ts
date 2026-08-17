import { describe, it, expect } from "vitest";
import { PaperGeometryService } from "./PaperGeometryService";
import { contourWinding } from "./path";
import type { Contour } from "../../types/geometry";

/**
 * Paper.js runs headless here (a Size-based PaperScope, no canvas/DOM), so the
 * live geometry engine is covered by the same deterministic suite as the rest of
 * the engine. These guard two things the renderer depends on: the four boolean
 * results are normalized to our winding convention (outer CW, holes CCW), and
 * bezier handles survive a boolean (the whole reason for swapping in Paper).
 */

function poly(id: string, pts: [number, number][]): Contour {
  return { id, closed: true, points: pts.map(([x, y], i) => ({ id: `${id}_${i}`, type: "corner" as const, x, y })) };
}
/** An OPEN polyline (for stroke/halftone bodies). */
function line(id: string, pts: [number, number][]): Contour {
  return { id, closed: false, points: pts.map(([x, y], i) => ({ id: `${id}_${i}`, type: "corner" as const, x, y })) };
}
/** World bbox of a contour list (anchor points only — enough for these assertions). */
function bbox(contours: Contour[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
const OUTER = poly("o", [[0, 0], [100, 0], [100, 100], [0, 100]]);
const INNER = poly("i", [[25, 25], [75, 25], [75, 75], [25, 75]]);

describe("PaperGeometryService (headless smoke)", () => {
  const g = new PaperGeometryService();
  it("subtract inner from outer → ring (outer + hole)", () => {
    const r = g.subtract([OUTER], [INNER]);
    expect(r.length).toBe(2);
    expect(contourWinding(r[0]!)).toBe("cw");
    expect(contourWinding(r[1]!)).toBe("ccw");
  });
  it("union of disjoint squares → two contours", () => {
    const far = poly("f", [[200, 0], [300, 0], [300, 100], [200, 100]]);
    expect(g.union([OUTER], [far]).length).toBe(2);
  });
  it("intersect overlapping → one region", () => {
    const ov = poly("v", [[50, 50], [150, 50], [150, 150], [50, 150]]);
    const r = g.intersect([OUTER], [ov]);
    expect(r.length).toBe(1);
  });
  it("expandHalftoneGroup fills the UNION of two same-style bars as one field", () => {
    // Two parallel horizontal bars 30 apart, each a 40-wide halftone ribbon (y∈[-20,20]
    // and y∈[10,50]). Combined, the merged body spans y∈[-20,50]; the dots must cover the
    // whole merged region (across the seam between the bars), not fade to zero at each edge.
    const stroke = {
      width: 40,
      startCap: "butt" as const,
      endCap: "butt" as const,
      join: "miter" as const,
      model: "halftone" as const,
      halftone: { cell: 10, size: 8, angle: 0, shape: "circle" as const, contrast: 0.5 },
    };
    const bar1 = line("b1", [[10, 0], [190, 0]]);
    const bar2 = line("b2", [[10, 30], [190, 30]]);

    const combined = g.expandHalftoneGroup([bar1, bar2], stroke);
    expect(combined.length).toBeGreaterThan(0);
    const bb = bbox(combined);
    // Dots reach into BOTH bars' far edges → one continuous field over the union.
    expect(bb.minY).toBeLessThan(-5);
    expect(bb.maxY).toBeGreaterThan(35);

    // A single-element group still produces a valid field, smaller than the combined one.
    const single = g.expandHalftoneGroup([bar1], stroke);
    expect(single.length).toBeGreaterThan(0);
    expect(combined.length).toBeGreaterThan(single.length);
  });

  it("preserves a curve handle through union", () => {
    const curved: Contour = {
      id: "c", closed: true,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 20, y: 30 } },
        { id: "b", type: "smooth", x: 60, y: 0, handleIn: { x: 40, y: 30 } },
        { id: "d", type: "corner", x: 60, y: -40 },
        { id: "e", type: "corner", x: 0, y: -40 },
      ],
    };
    const r = g.union([curved], []);
    const hasHandle = r.some((c) => c.points.some((p) => p.handleIn || p.handleOut));
    expect(hasHandle).toBe(true);
  });
});

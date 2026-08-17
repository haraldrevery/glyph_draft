import { describe, it, expect } from "vitest";
import type { Contour } from "../../types/geometry";
import { signedArea } from "./path";
import { PolygonGeometryService } from "./PolygonGeometryService";

const geom = new PolygonGeometryService();

/** An axis-aligned square as a closed corner contour. */
function sq(x0: number, y0: number, x1: number, y1: number): Contour {
  return {
    id: "c",
    closed: true,
    points: [
      { id: "p0", type: "corner", x: x0, y: y0 },
      { id: "p1", type: "corner", x: x1, y: y0 },
      { id: "p2", type: "corner", x: x1, y: y1 },
      { id: "p3", type: "corner", x: x0, y: y1 },
    ],
  };
}

/** Total enclosed area across result contours (winding-agnostic). */
function totalArea(contours: Contour[]): number {
  return contours.reduce((sum, c) => sum + Math.abs(signedArea(c)), 0);
}

// Two 100×100 squares overlapping in a 50×50 region (area 2500).
const A = sq(0, 0, 100, 100);
const B = sq(50, 50, 150, 150);

describe("PolygonGeometryService boolean ops", () => {
  it("union = 17500 (two squares minus the shared overlap)", () => {
    const r = geom.union([A], [B]);
    expect(r).toHaveLength(1);
    expect(totalArea(r)).toBeCloseTo(17500, 1);
  });

  it("intersect = 2500 (just the overlap)", () => {
    const r = geom.intersect([A], [B]);
    expect(r).toHaveLength(1);
    expect(totalArea(r)).toBeCloseTo(2500, 1);
  });

  it("subtract A−B = 7500 (A with the overlap removed)", () => {
    const r = geom.subtract([A], [B]);
    expect(r).toHaveLength(1);
    expect(totalArea(r)).toBeCloseTo(7500, 1);
  });

  it("exclude = 15000 (symmetric difference)", () => {
    const r = geom.exclude([A], [B]);
    expect(totalArea(r)).toBeCloseTo(15000, 1);
  });
});

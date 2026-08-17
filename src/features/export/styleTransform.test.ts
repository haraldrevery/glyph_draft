import { describe, it, expect } from "vitest";
import {
  styleMatrix,
  transformContours,
  extendOutlineX,
  isIdentityStyle,
  REGULAR_STYLE,
} from "./styleTransform";
import { apply } from "../../engine/geometry/affine";
import { contourWinding } from "../../engine/geometry/path";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import type { Contour } from "../../types/geometry";

const g = getGeometryService();

/** A CW (outer/solid, Y-up) rectangle — matching what the fill builder emits. */
function rect(id: string, x0: number, y0: number, x1: number, y1: number): Contour {
  return {
    id,
    closed: true,
    points: [
      { id: `${id}0`, type: "corner", x: x0, y: y0 },
      { id: `${id}1`, type: "corner", x: x0, y: y1 },
      { id: `${id}2`, type: "corner", x: x1, y: y1 },
      { id: `${id}3`, type: "corner", x: x1, y: y0 },
    ],
  };
}

/** The same rectangle reversed → CCW (a hole/counter). */
function hole(id: string, x0: number, y0: number, x1: number, y1: number): Contour {
  const r = rect(id, x0, y0, x1, y1);
  return { ...r, points: [...r.points].reverse() };
}

function bbox(cs: Contour[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cs) for (const p of c.points) {
    for (const pt of [p, p.handleIn, p.handleOut]) {
      if (!pt) continue;
      minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

describe("extendOutlineX (horizontal, x-only)", () => {
  it("dilates a VERTICAL stem in x only (thicker), height unchanged", () => {
    const stem = [rect("s", 0, 0, 20, 100)]; // 20 wide, 100 tall
    const out = extendOutlineX(stem, 10, g);
    const b = bbox(out);
    expect(b.w).toBeCloseTo(40, 0); // 20 + 2·10
    expect(b.h).toBeCloseTo(100, 0); // height locked
  });

  it("leaves a HORIZONTAL bar's thickness (height) unchanged", () => {
    const bar = [rect("b", 0, 0, 100, 20)]; // 100 wide, 20 thick
    const out = extendOutlineX(bar, 10, g);
    const b = bbox(out);
    expect(b.h).toBeCloseTo(20, 0); // NOT thickened
    expect(b.w).toBeCloseTo(120, 0); // only widened
  });

  it("erodes a stem in x (thinner) with a negative amount", () => {
    const stem = [rect("s", 0, 0, 20, 100)];
    const out = extendOutlineX(stem, -5, g);
    expect(bbox(out).w).toBeCloseTo(10, 0); // 20 − 2·5
  });

  it("is identity at d=0", () => {
    const stem = [rect("s", 0, 0, 20, 100)];
    expect(extendOutlineX(stem, 0, g)).toBe(stem);
  });

  it("preserves a counter — a ring stays a frame, NOT filled solid (the bug)", () => {
    const ring = [rect("o", 0, 0, 100, 100), hole("h", 30, 30, 70, 70)];
    expect(contourWinding(ring[0]!)).toBe("cw"); // outer solid
    expect(contourWinding(ring[1]!)).toBe("ccw"); // counter
    const out = extendOutlineX(ring, 10, g); // bold dilation
    expect(out.some((c) => contourWinding(c) === "ccw")).toBe(true); // counter survives
    expect(out.length).toBeGreaterThanOrEqual(2); // not collapsed to one solid
    expect(bbox(out).w).toBeCloseTo(120, 0); // outer widened by 2·10
  });
});

describe("styleMatrix", () => {
  it("skews about the baseline (y=0 unmoved, x shifts with height)", () => {
    const m = styleMatrix({ stretchPct: 100, skewDeg: 15, extensionUnits: 0 });
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 }); // baseline fixed
    const top = apply(m, { x: 0, y: 100 });
    expect(top.x).toBeCloseTo(Math.tan((15 * Math.PI) / 180) * 100, 3); // ≈26.79
    expect(top.y).toBeCloseTo(100, 9);
  });

  it("stretches x about the origin", () => {
    const m = styleMatrix({ stretchPct: 120, skewDeg: 0, extensionUnits: 0 });
    expect(apply(m, { x: 50, y: 0 })).toEqual({ x: 60, y: 0 });
  });
});

describe("transformContours (final-outline shear — no re-expansion)", () => {
  it("shears a sharp-cornered contour exactly, keeping ONE clean contour", () => {
    // A right triangle with a sharp apex at (50,100): shear must just MOVE the points
    // (no expansion, no extra/fragmented contours, no facets).
    const tri: Contour = {
      id: "t",
      closed: true,
      points: [
        { id: "t0", type: "corner", x: 0, y: 0 },
        { id: "t1", type: "corner", x: 100, y: 0 },
        { id: "t2", type: "corner", x: 50, y: 100 },
      ],
    };
    const m = styleMatrix({ stretchPct: 100, skewDeg: 12, extensionUnits: 0 });
    const out = transformContours([tri], m);
    expect(out).toHaveLength(1); // not fragmented
    expect(out[0]!.points).toHaveLength(3); // same corners, none added
    expect(out[0]!.points[2]).toMatchObject(apply(m, { x: 50, y: 100 })); // apex moved exactly
    expect(out[0]!.points[0]).toEqual({ id: "t0", type: "corner", x: 0, y: 0 }); // baseline fixed
  });

  it("shears a ring without filling the counter (winding preserved)", () => {
    const ring = [rect("o", 0, 0, 100, 100), hole("h", 30, 30, 70, 70)];
    const out = transformContours(ring, styleMatrix({ stretchPct: 100, skewDeg: 12, extensionUnits: 0 }));
    expect(out).toHaveLength(2);
    expect(contourWinding(out[0]!)).toBe("cw"); // outer stays solid
    expect(contourWinding(out[1]!)).toBe("ccw"); // counter stays a hole
  });
});

describe("isIdentityStyle", () => {
  it("recognises the regular (no-op) style", () => {
    expect(isIdentityStyle(REGULAR_STYLE)).toBe(true);
    expect(isIdentityStyle({ stretchPct: 110, skewDeg: 0, extensionUnits: 0 })).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import type { Contour } from "../../types/geometry";
import {
  contourToPath,
  contourWinding,
  cubicAt,
  ensureWinding,
  reverseContour,
  signedArea,
  splitCubic,
} from "./path";

/** A closed corner contour from [x, y] pairs. */
function poly(pts: [number, number][], closed = true): Contour {
  return {
    id: "c",
    closed,
    points: pts.map(([x, y], i) => ({ id: `p${i}`, type: "corner" as const, x, y })),
  };
}

describe("signedArea / contourWinding", () => {
  it("is positive (CCW) for a counter-clockwise ring in Y-up space", () => {
    const ccw = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(signedArea(ccw)).toBe(10000);
    expect(contourWinding(ccw)).toBe("ccw");
  });

  it("flips sign and winding when reversed", () => {
    const ccw = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    const cw = reverseContour(ccw);
    expect(signedArea(cw)).toBe(-10000);
    expect(contourWinding(cw)).toBe("cw");
  });
});

describe("reverseContour", () => {
  it("double-reverse restores point order and handles exactly", () => {
    const c: Contour = {
      id: "c",
      closed: true,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleIn: { x: -1, y: 0 }, handleOut: { x: 1, y: 0 } },
        { id: "b", type: "corner", x: 10, y: 0 },
      ],
    };
    const twice = reverseContour(reverseContour(c));
    expect(twice.points.map((p) => p.id)).toEqual(["a", "b"]);
    expect(twice.points[0]!.handleIn).toEqual({ x: -1, y: 0 });
    expect(twice.points[0]!.handleOut).toEqual({ x: 1, y: 0 });
  });
});

describe("ensureWinding", () => {
  it("forces the requested winding, reversing only when needed", () => {
    const ccw = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(contourWinding(ensureWinding(ccw, "cw"))).toBe("cw");
    expect(ensureWinding(ccw, "ccw")).toBe(ccw); // already CCW: same reference
  });
});

describe("contourToPath", () => {
  it("emits a straight segment as L for handle-free corners", () => {
    expect(contourToPath(poly([[0, 0], [10, 0]], false))).toBe("M 0 0 L 10 0");
  });

  it("closes a closed contour with Z", () => {
    const d = contourToPath(poly([[0, 0], [10, 0], [10, 10]]));
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
  });
});

describe("cubicAt", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 10, y: 5 };
    expect(cubicAt(p0, { x: 3, y: 9 }, { x: 7, y: 1 }, p3, 0)).toEqual(p0);
    expect(cubicAt(p0, { x: 3, y: 9 }, { x: 7, y: 1 }, p3, 1)).toEqual(p3);
  });

  it("evaluates the midpoint of a straight cubic", () => {
    const mid = cubicAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, 0.5);
    expect(mid.x).toBeCloseTo(5, 9);
    expect(mid.y).toBeCloseTo(0, 9);
  });
});

describe("splitCubic", () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 10 };
  const p2 = { x: 10, y: 10 };
  const p3 = { x: 10, y: 0 };

  it("keeps the original endpoints and meets at the split point", () => {
    const { left, right } = splitCubic(p0, p1, p2, p3, 0.5);
    expect(left[0]).toEqual(p0);
    expect(right[3]).toEqual(p3);
    expect(left[3]).toEqual(right[0]); // shared split point
  });

  it("the split point equals the curve evaluated at t", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const { left } = splitCubic(p0, p1, p2, p3, t);
      const onCurve = cubicAt(p0, p1, p2, p3, t);
      expect(left[3].x).toBeCloseTo(onCurve.x, 9);
      expect(left[3].y).toBeCloseTo(onCurve.y, 9);
    }
  });
});

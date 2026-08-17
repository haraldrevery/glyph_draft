import { describe, it, expect } from "vitest";
import { contourWinding, signedArea } from "./path";
import { makeEllipse, makeLine, makePolygon, makeRectangle } from "./primitives";

describe("makeRectangle", () => {
  it("is a closed, clockwise 4-point contour with the expected signed area", () => {
    const r = makeRectangle({ x: 0, y: 0, width: 200, height: 100 });
    expect(r.closed).toBe(true);
    expect(r.points).toHaveLength(4);
    expect(contourWinding(r)).toBe("cw");
    expect(signedArea(r)).toBe(-20000);
  });

  it("normalizes a negative-size box (drag-direction agnostic)", () => {
    const r = makeRectangle({ x: 100, y: 50, width: -100, height: -50 });
    const xs = r.points.map((p) => p.x);
    const ys = r.points.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(100);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(50);
    expect(contourWinding(r)).toBe("cw");
  });
});

describe("makeEllipse", () => {
  it("is a closed clockwise 4-anchor cubic approximation with kappa-length handles", () => {
    const e = makeEllipse({ x: -100, y: -100, width: 200, height: 200 });
    expect(e.closed).toBe(true);
    expect(e.points).toHaveLength(4);
    expect(contourWinding(e)).toBe("cw");

    // The right cardinal anchor sits at x≈100, y≈0; its tangent handles run
    // vertically by KAPPA*r = 55.2284749… regardless of winding normalization.
    const right = e.points.reduce((a, b) => (b.x > a.x ? b : a));
    expect(right.x).toBeCloseTo(100, 6);
    expect(Math.abs(right.handleOut!.y)).toBeCloseTo(55.2284749830794, 6);
    expect(Math.abs(right.handleIn!.y)).toBeCloseTo(55.2284749830794, 6);
  });
});

describe("makePolygon", () => {
  it("is a closed clockwise N-corner contour inscribed in the box", () => {
    const p = makePolygon({ x: -100, y: -100, width: 200, height: 200 }, 6);
    expect(p.closed).toBe(true);
    expect(p.points).toHaveLength(6);
    expect(p.points.every((pt) => pt.type === "corner")).toBe(true);
    expect(contourWinding(p)).toBe("cw");

    // Inscribed in the box: extents reach the radius (here ±100) and no further.
    const xs = p.points.map((pt) => pt.x);
    const ys = p.points.map((pt) => pt.y);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100.0001);
    expect(Math.max(...ys)).toBeCloseTo(100, 6); // a vertex sits at the top
  });

  it("clamps to a minimum of 3 sides (a triangle)", () => {
    const t = makePolygon({ x: 0, y: 0, width: 100, height: 100 }, 3);
    expect(t.points).toHaveLength(3);
    expect(makePolygon({ x: 0, y: 0, width: 10, height: 10 }, 2).points).toHaveLength(3);
  });
});

describe("makeLine", () => {
  it("is an open two-corner contour", () => {
    const l = makeLine({ x: 0, y: 0 }, { x: 10, y: 5 });
    expect(l.closed).toBe(false);
    expect(l.points).toHaveLength(2);
    expect(l.points.every((p) => p.type === "corner")).toBe(true);
  });
});

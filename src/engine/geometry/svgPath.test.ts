import { describe, it, expect } from "vitest";
import { parsePathD } from "./svgPath";

describe("parsePathD", () => {
  it("parses a closed triangle of straight lines as corners", () => {
    const subs = parsePathD("M0 0 L10 0 L10 10 Z");
    expect(subs).toHaveLength(1);
    expect(subs[0]!.closed).toBe(true);
    expect(subs[0]!.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    for (const p of subs[0]!.points) expect(p.handleIn ?? p.handleOut).toBeUndefined();
  });

  it("sets absolute bezier handles for a cubic", () => {
    const subs = parsePathD("M0 0 C 10 0 20 10 30 10");
    const [a, b] = subs[0]!.points;
    expect(a!.handleOut).toEqual({ x: 10, y: 0 }); // first control
    expect(b!.handleIn).toEqual({ x: 20, y: 10 }); // second control
    expect([b!.x, b!.y]).toEqual([30, 10]);
  });

  it("handles relative commands and H/V", () => {
    const subs = parsePathD("M5 5 h10 v10"); // → (5,5) (15,5) (15,15)
    expect(subs[0]!.points.map((p) => [p.x, p.y])).toEqual([
      [5, 5],
      [15, 5],
      [15, 15],
    ]);
  });

  it("converts a quadratic to an equivalent cubic", () => {
    const subs = parsePathD("M0 0 Q 6 0 6 6"); // p0=(0,0) qc=(6,0) p1=(6,6)
    const [a, b] = subs[0]!.points;
    // c1 = p0 + 2/3(qc-p0) = (4,0); c2 = p1 + 2/3(qc-p1) = (6,2)
    expect(a!.handleOut).toEqual({ x: 4, y: 0 });
    expect(b!.handleIn).toEqual({ x: 6, y: 2 });
  });

  it("splits multiple subpaths on repeated M", () => {
    const subs = parsePathD("M0 0 L1 0 M5 5 L6 5");
    expect(subs).toHaveLength(2);
    expect(subs[1]!.points[0]!.x).toBe(5);
  });

  it("approximates an arc with one or more cubic segments ending at the target", () => {
    // Quarter circle radius 10 from (10,0) to (0,10).
    const subs = parsePathD("M10 0 A 10 10 0 0 1 0 10");
    const pts = subs[0]!.points;
    expect(pts.length).toBeGreaterThanOrEqual(2);
    const endpt = pts[pts.length - 1]!;
    expect(endpt.x).toBeCloseTo(0, 3);
    expect(endpt.y).toBeCloseTo(10, 3);
    expect(pts[0]!.handleOut).toBeDefined(); // arc became a curve, not a line
  });
});

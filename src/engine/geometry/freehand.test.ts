import { describe, it, expect } from "vitest";
import { simplifyRDP, fitFreehand } from "./freehand";
import type { Vec2 } from "../../types/viewport";

const v = (x: number, y: number): Vec2 => ({ x, y });

describe("simplifyRDP", () => {
  it("collapses a noisy near-straight run to its two endpoints", () => {
    const noisy = [v(0, 0), v(1, 0.1), v(2, -0.1), v(3, 0.05), v(4, 0)];
    expect(simplifyRDP(noisy, 0.5)).toEqual([v(0, 0), v(4, 0)]);
  });

  it("keeps a point that bulges past the tolerance", () => {
    const out = simplifyRDP([v(0, 0), v(2, 5), v(4, 0)], 0.5);
    expect(out).toHaveLength(3);
  });

  it("a higher tolerance keeps no more points", () => {
    const wig = Array.from({ length: 40 }, (_, i) => v(i, Math.sin(i / 3) * 3));
    expect(simplifyRDP(wig, 2).length).toBeLessThanOrEqual(simplifyRDP(wig, 0.5).length);
  });
});

describe("fitFreehand", () => {
  it("returns a bare straight segment for two points (no spurious handles)", () => {
    const { points, closed } = fitFreehand([v(0, 0), v(10, 0)], { tolerance: 0 });
    expect(closed).toBe(false);
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.type === "corner" && !p.handleIn && !p.handleOut)).toBe(true);
  });

  it("gives interior nodes smooth (mirrored) bezier handles on a curve", () => {
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * (Math.PI / 2);
      return v(Math.cos(a) * 100, Math.sin(a) * 100);
    });
    const { points } = fitFreehand(arc, { tolerance: 1 });
    const mid = points[Math.floor(points.length / 2)]!;
    expect(mid.type).toBe("smooth");
    expect(mid.handleIn).toBeDefined();
    expect(mid.handleOut).toBeDefined();
  });

  it("keeps a sharp turn as a corner node", () => {
    const { points } = fitFreehand([v(0, 0), v(10, 0), v(10, 10)], { tolerance: 0 });
    expect(points).toHaveLength(3);
    const corner = points[1]!;
    expect(corner.type).toBe("corner");
    expect(corner.handleIn ?? corner.handleOut).toBeUndefined();
  });

  it("closes the path when the gesture ends where it began", () => {
    const loop = [v(0, 0), v(10, 0), v(10, 10), v(0, 10), v(0, 0)];
    const { points, closed } = fitFreehand(loop, { tolerance: 0, closeTolerance: 1 });
    expect(closed).toBe(true);
    expect(points).toHaveLength(4); // the duplicate end point is dropped
  });

  it("does not close an open stroke whose ends are far apart", () => {
    const open = [v(0, 0), v(10, 0), v(20, 5), v(30, 0)];
    expect(fitFreehand(open, { tolerance: 0, closeTolerance: 1 }).closed).toBe(false);
  });
});

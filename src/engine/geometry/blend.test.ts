import { describe, it, expect } from "vitest";
import { blendContours, MAX_BLEND_STEPS } from "./blend";
import type { Contour } from "../../types/geometry";

function sq(id: string, x: number, y: number, s = 10): Contour {
  return {
    id,
    closed: true,
    points: [
      { id: `${id}0`, type: "corner", x, y },
      { id: `${id}1`, type: "corner", x: x + s, y },
      { id: `${id}2`, type: "corner", x: x + s, y: y + s },
      { id: `${id}3`, type: "corner", x, y: y + s },
    ],
  };
}

describe("blendContours", () => {
  it("returns steps + 2 sets (endpoints included)", () => {
    const seq = blendContours([sq("a", 0, 0)], [sq("b", 100, 0)], 3);
    expect(seq).not.toBeNull();
    expect(seq!).toHaveLength(5); // A + 3 middles + B
  });

  it("endpoints reproduce A and B; midpoint is their average", () => {
    const seq = blendContours([sq("a", 0, 0)], [sq("b", 100, 40)], 1)!; // A, mid, B
    expect(seq[0]![0]!.points[0]!.x).toBeCloseTo(0); // t=0 → A
    expect(seq[0]![0]!.points[0]!.y).toBeCloseTo(0);
    expect(seq[2]![0]!.points[0]!.x).toBeCloseTo(100); // t=1 → B
    expect(seq[2]![0]!.points[0]!.y).toBeCloseTo(40);
    expect(seq[1]![0]!.points[0]!.x).toBeCloseTo(50); // midpoint = average
    expect(seq[1]![0]!.points[0]!.y).toBeCloseTo(20);
  });

  it("interpolates bezier handles, treating a missing handle as the anchor", () => {
    const a: Contour = {
      id: "a",
      closed: false,
      points: [
        { id: "a0", type: "smooth", x: 0, y: 0, handleOut: { x: 0, y: 10 } },
        { id: "a1", type: "corner", x: 20, y: 0 },
      ],
    };
    const b: Contour = {
      id: "b",
      closed: false,
      points: [
        { id: "b0", type: "smooth", x: 0, y: 0, handleOut: { x: 0, y: 30 } },
        { id: "b1", type: "corner", x: 20, y: 0 },
      ],
    };
    const mid = blendContours([a], [b], 1)![1]!;
    expect(mid[0]!.points[0]!.handleOut!.y).toBeCloseTo(20); // (10+30)/2
  });

  it("morphs DIFFERING shapes via resampling (point/contour counts no longer block)", () => {
    const tri: Contour = {
      id: "t",
      closed: true,
      points: [
        { id: "t0", type: "corner", x: 0, y: 0 },
        { id: "t1", type: "corner", x: 40, y: 0 },
        { id: "t2", type: "corner", x: 20, y: 40 },
      ],
    };
    const seq = blendContours([sq("a", 0, 0, 40)], [tri], 2); // 4 pts vs 3 pts
    expect(seq).not.toBeNull();
    expect(seq!).toHaveLength(4); // steps + 2
    const K = seq![0]![0]!.points.length;
    expect(K).toBeGreaterThanOrEqual(4); // resampled to a common count
    expect(seq![1]![0]!.points.length).toBe(K); // every step shares it
    expect(seq![2]![0]!.points.length).toBe(K);
  });

  it("morphs DIFFERENT contour counts: the extra path collapses to a point", () => {
    const a = [sq("a", 0, 0, 20)]; // 1 path
    const b = [sq("b1", 100, 0, 20), sq("b2", 160, 0, 20)]; // 2 paths
    const seq = blendContours(a, b, 2);
    expect(seq).not.toBeNull();
    expect(seq!).toHaveLength(4); // steps + 2
    // Every step renders BOTH B-paths (one matched, one growing from its centroid).
    for (const step of seq!) expect(step).toHaveLength(2);
    // The unmatched path starts collapsed (t=0): its samples share one point.
    const collapsed = seq![0]!;
    const spread = (c: { points: { x: number }[] }) =>
      Math.max(...c.points.map((p) => p.x)) - Math.min(...c.points.map((p) => p.x));
    // At least one of the two contours is (near) a point at t=0.
    expect(Math.min(spread(collapsed[0]!), spread(collapsed[1]!))).toBeLessThan(1);
  });

  it("returns null only when a side has no contours; clamps steps to the cap", () => {
    expect(blendContours([], [sq("b", 0, 0)], 3)).toBeNull();
    expect(blendContours([sq("a", 0, 0)], [], 3)).toBeNull();
    const seq = blendContours([sq("a", 0, 0)], [sq("b", 100, 0)], 9999)!;
    expect(seq).toHaveLength(MAX_BLEND_STEPS + 2);
  });

  it("carries stroke / corner, morphs stroke width, and takes colour from A (the 2nd arg)", () => {
    const a: Contour = {
      ...sq("a", 0, 0),
      stroke: { width: 10, startCap: "butt", endCap: "butt", join: "miter" },
      paint: { fill: "#0000ff" }, // B's colour — should be IGNORED
      corner: { type: "round", radius: 5 },
    };
    const b: Contour = {
      ...sq("b", 100, 0),
      stroke: { width: 30, startCap: "butt", endCap: "butt", join: "miter" },
      paint: { fill: "#00ff00" }, // A's colour — used for the whole echo
    };
    const mid = blendContours([a], [b], 1)![1]![0]!; // the t=0.5 step
    expect(mid.stroke?.width).toBeCloseTo(20); // (10 + 30) / 2
    expect(mid.paint?.fill).toBe("#00ff00"); // operand A (the `b` / upper side)
    expect(mid.corner?.type).toBe("round");
  });

  it("gives every interpolated anchor a fresh id (unique fill-group keys)", () => {
    const seq = blendContours([sq("a", 0, 0)], [sq("b", 100, 0)], 2)!;
    const ids = seq.flatMap((set) => set.flatMap((c) => [c.id, ...c.points.map((p) => p.id)]));
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});

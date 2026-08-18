import { describe, it, expect } from "vitest";
import { roundCorners } from "./corners";
import { contourWinding } from "./path";
import type { Contour } from "../../types/geometry";

/** A unit square (0,0)→(100,0)→(100,100)→(0,100), all corner nodes. */
function square(): Contour {
  return {
    id: "sq",
    closed: true,
    points: [
      { id: "a", type: "corner", x: 0, y: 0 },
      { id: "b", type: "corner", x: 100, y: 0 },
      { id: "c", type: "corner", x: 100, y: 100 },
      { id: "d", type: "corner", x: 0, y: 100 },
    ],
  };
}

describe("roundCorners", () => {
  it("round: each of the 4 corners becomes two tangent points (8 total)", () => {
    const r = roundCorners(square(), { type: "round", radius: 20 });
    expect(r.points).toHaveLength(8);
    // Every emitted point carries exactly one handle (the fillet tangent).
    for (const p of r.points) {
      const handles = (p.handleIn ? 1 : 0) + (p.handleOut ? 1 : 0);
      expect(handles).toBe(1);
    }
  });

  it("chamfer: 8 plain corner points, no handles (flat cuts)", () => {
    const r = roundCorners(square(), { type: "chamfer", radius: 20 });
    expect(r.points).toHaveLength(8);
    for (const p of r.points) {
      expect(p.handleIn).toBeUndefined();
      expect(p.handleOut).toBeUndefined();
      expect(p.type).toBe("corner");
    }
    // The first corner (0,0) cut between (20,0) on the bottom edge and (0,20) on the left.
    const xs = r.points.map((p) => `${p.x},${p.y}`);
    expect(xs).toContain("20,0");
    expect(xs).toContain("0,20");
  });

  it("clamps the radius to ½ the edge so a huge radius can't overshoot/self-intersect", () => {
    // radius 999 on a 100-unit square → clamped to 50; trims meet at edge midpoints.
    const r = roundCorners(square(), { type: "chamfer", radius: 999 });
    for (const p of r.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
    // Bottom edge: the two trims from corners a and b meet at the midpoint (50,0).
    expect(r.points.filter((p) => p.y === 0 && p.x === 50)).toHaveLength(2);
  });

  // Split per style: these used to share one `orig`, so the second call hit the
  // memo and silently re-checked the ROUND result. The assertion is winding, which
  // is style-independent, so it passed and the chamfer branch was never exercised.
  it("preserves winding — round", () => {
    const orig = square();
    expect(contourWinding(roundCorners(orig, { type: "round", radius: 20 }))).toBe(contourWinding(orig));
  });

  it("preserves winding — chamfer", () => {
    const orig = square();
    expect(contourWinding(roundCorners(orig, { type: "chamfer", radius: 20 }))).toBe(contourWinding(orig));
  });

  it("preserves winding — invertedRound", () => {
    const orig = square();
    expect(contourWinding(roundCorners(orig, { type: "invertedRound", radius: 20 }))).toBe(contourWinding(orig));
  });

  // The memo is keyed by contour identity; `style` must be part of the validity
  // check (as expandStroke validates `stroke ===`), or the same contour rendered
  // with a different style silently returns the first style's geometry.
  it("does not serve a cached result for a DIFFERENT style", () => {
    const orig = square();
    const rounded = roundCorners(orig, { type: "round", radius: 20 });
    const chamfered = roundCorners(orig, { type: "chamfer", radius: 20 });

    // A chamfer produces plain corner nodes with no handles; a round fillet
    // produces smooth nodes carrying handles. Confusing the two is the bug.
    expect(rounded.points.some((p) => p.handleOut || p.handleIn)).toBe(true);
    expect(chamfered.points.every((p) => !p.handleOut && !p.handleIn)).toBe(true);
    expect(chamfered.points.every((p) => p.type === "corner")).toBe(true);
  });

  it("still memoizes when the SAME style object is passed again", () => {
    const orig = square();
    const style = { type: "round", radius: 20 } as const;
    expect(roundCorners(orig, style)).toBe(roundCorners(orig, style));
  });

  it("recomputes when a same-VALUE but different style object is passed", () => {
    const orig = square();
    const a = roundCorners(orig, { type: "chamfer", radius: 20 });
    const b = roundCorners(orig, { type: "chamfer", radius: 40 });
    // radius 20 trims to x=20; radius 40 trims to x=40 — different geometry.
    expect(a.points.map((p) => p.x)).not.toEqual(b.points.map((p) => p.x));
  });

  it("leaves smooth nodes and open-path endpoints untouched", () => {
    const openMixed: Contour = {
      id: "o",
      closed: false,
      points: [
        { id: "a", type: "corner", x: 0, y: 0 }, // endpoint → skip
        { id: "b", type: "corner", x: 50, y: 0 }, // interior corner → round
        { id: "s", type: "smooth", x: 80, y: 20, handleIn: { x: 70, y: 10 } }, // smooth → skip
        { id: "z", type: "corner", x: 100, y: 50 }, // endpoint → skip
      ],
    };
    const r = roundCorners(openMixed, { type: "chamfer", radius: 10 });
    // Only the single interior corner "b" splits in two ⇒ 4 + 1 = 5 points.
    expect(r.points).toHaveLength(5);
    expect(r.points.some((p) => p.id === "a")).toBe(true); // endpoint kept verbatim
    expect(r.points.some((p) => p.id === "s")).toBe(true); // smooth kept verbatim
  });

  it("inverted round: a concave arc with tangents ⟂ the edges (opposite of round)", () => {
    // Corner b=(100,0) between a=(0,0) and c=(100,100): u=(-1,0), v=(0,1), r=20.
    // Trim points A=(80,0), B=(100,20). The scoop is centered at b, so A's outgoing
    // handle is ⟂ the bottom edge (points +y), not ALONG it (as the convex round does).
    const round = roundCorners(square(), { type: "round", radius: 20 }).points;
    const inv = roundCorners(square(), { type: "invertedRound", radius: 20 }).points;
    const aRound = round.find((p) => p.id === "b_a")!; // trim point on the bottom edge
    const aInv = inv.find((p) => p.id === "b_a")!;
    expect(aInv.x).toBeCloseTo(80, 5);
    expect(aInv.y).toBeCloseTo(0, 5);
    // Convex round handle lies ALONG the bottom edge (y≈0); inverted lifts ⟂ off it (y>0).
    expect(Math.abs(aRound.handleOut!.y)).toBeLessThan(1e-6);
    expect(aInv.handleOut!.y).toBeGreaterThan(1);
    // ...and it stays on the correct side (doesn't run backward along the edge).
    expect(aInv.handleOut!.x).toBeCloseTo(80, 5);
  });

  it("carries stroke/paint/closed through unchanged", () => {
    const c: Contour = { ...square(), closed: true, paint: { fill: "#ff0000" } };
    const r = roundCorners(c, { type: "round", radius: 10 });
    expect(r.closed).toBe(true);
    expect(r.paint).toEqual({ fill: "#ff0000" });
  });
});

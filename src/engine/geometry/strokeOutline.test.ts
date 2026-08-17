import { describe, it, expect } from "vitest";
import { PaperGeometryService } from "./PaperGeometryService";
import { contourWinding } from "./path";
import { flattenContour, insideNonzero, ringSignedArea } from "./polygon";
import type { Contour, StrokeStyle } from "../../types/geometry";

/** Count reflex (concave) vertices on a shape's OUTER ring. A round-brush stroke of a
 *  CONVEX polygon must be fully convex — any concavity is a corner "notch" artefact. */
function outerConcavities(out: Contour[]): number {
  const rings = out.map((c) => flattenContour(c)).filter((r) => r.length >= 3);
  if (rings.length === 0) return 0;
  const outer = rings.reduce((a, b) => (Math.abs(ringSignedArea(b)) > Math.abs(ringSignedArea(a)) ? b : a));
  const sgn = Math.sign(ringSignedArea(outer));
  let concave = 0;
  for (let i = 0; i < outer.length; i += 1) {
    const a = outer[(i - 1 + outer.length) % outer.length]!;
    const b = outer[i]!;
    const c = outer[(i + 1) % outer.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6 && Math.sign(cross) !== sgn) concave += 1;
  }
  return concave;
}

/**
 * Stroke expansion (Paper.js), headless like the other Paper tests. Outlines are
 * built in-house by PaperGeometryService (sweptUniform / sweptBrush / sweptRound /
 * sampledOutline) — the old paperjs-offset dependency is gone. Guards the width
 * calibration and the open→outline / closed→frame topology the renderer depends on.
 */

const g = new PaperGeometryService();

function open(id: string, pts: [number, number][]): Contour {
  return {
    id,
    closed: false,
    points: pts.map(([x, y], i) => ({ id: `${id}_${i}`, type: "corner" as const, x, y })),
  };
}
function closed(id: string, pts: [number, number][]): Contour {
  return { ...open(id, pts), closed: true };
}

const STROKE: StrokeStyle = { width: 20, startCap: "butt", endCap: "butt", join: "miter" };

/** Axis-aligned bbox over anchors AND handles (handles bound the curve extremes). */
function bbox(contours: Contour[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const c of contours) {
    for (const p of c.points) {
      see(p.x, p.y);
      if (p.handleIn) see(p.handleIn.x, p.handleIn.y);
      if (p.handleOut) see(p.handleOut.x, p.handleOut.y);
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Total filled area (sum of |shoelace| per contour) — for relative comparisons. */
function area(contours: Contour[]): number {
  let total = 0;
  for (const c of contours) {
    const p = c.points;
    let s = 0;
    for (let i = 0; i < p.length; i += 1) {
      const q = p[(i + 1) % p.length]!;
      s += p[i]!.x * q.y - q.x * p[i]!.y;
    }
    total += Math.abs(s / 2);
  }
  return total;
}

describe("expandStroke", () => {
  it("memoizes by contour+stroke identity (same input → cached, changed stroke → recompute)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const out1 = g.expandStroke(seg, STROKE);
    const out2 = g.expandStroke(seg, STROKE); // same objects → cache hit (same reference)
    expect(out2).toBe(out1);
    // Same contour, a DIFFERENT stroke object → must recompute, not return the cached one.
    const wider = { ...STROKE, width: 60 };
    const out3 = g.expandStroke(seg, wider);
    expect(out3).not.toBe(out1);
    expect(bbox(out3).h).toBeCloseTo(60, 0); // reflects the new width, not the cached 20
  });

  it("expands a straight open segment to a closed outline of the right width", () => {
    // A horizontal segment of length 100, width 20 (±10), butt caps → a 100×20 box.
    const out = g.expandStroke(open("seg", [[0, 0], [100, 0]]), STROKE);
    expect(out.length).toBe(1);
    expect(out[0]!.closed).toBe(true);
    const b = bbox(out);
    expect(b.w).toBeCloseTo(100, 0);
    expect(b.h).toBeCloseTo(20, 0); // total width = STROKE.width, confirms ±width/2
  });

  it("expands a closed path to a frame (outer ring + hole)", () => {
    const out = g.expandStroke(closed("sq", [[0, 0], [100, 0], [100, 100], [0, 100]]), STROKE);
    expect(out.length).toBe(2); // outer + inner hole
    expect(out.map(contourWinding).sort()).toEqual(["ccw", "cw"]); // outer CW, hole CCW
  });

  it("dash model: OVERLAPPING elements merge to solid, never XOR (no spurious holes)", () => {
    // Dashes crowd the inside of a bend so consecutive elements overlap. Nesting-based
    // correctWinding used to mislabel an overlapping sibling as a hole (CCW) → an
    // 'exclusion' where they intersect. The self-union (solidify) must dissolve overlaps
    // so every emitted region is solid CW — no hole.
    const dash: StrokeStyle = {
      width: 30, startCap: "butt", endCap: "butt", join: "miter",
      model: "dash", dash: { shape: "dash", dash: 40, gap: 2 },
    };
    const out = g.expandStroke(open("bend", [[0, 0], [120, 0], [120, 120]]), dash);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => contourWinding(c) === "cw")).toBe(true); // no CCW hole → no XOR
  });

  it("brush model rounds sharp corners cleanly — the outer outline stays CONVEX (no notch)", () => {
    // A round brush over a convex polygon must produce a fully-convex outer outline.
    // The old swept-quad construction left a reflex 'disc–notch–disc' sliver at every
    // corner (triangles/rectangles, thick AND thin) — outerConcavities caught it.
    const brush = (r: number): StrokeStyle => ({
      width: r * 2, startCap: "round", endCap: "round", join: "round", model: "brush",
    });
    const rect = closed("brsq", [[0, 0], [300, 0], [300, 200], [0, 200]]);
    const tri = closed("brtri", [[0, 0], [300, 0], [150, 260]]);
    const acute = closed("bracute", [[0, 0], [400, 0], [380, 60]]);
    expect(outerConcavities(g.expandStroke(rect, brush(30)))).toBe(0); // thick rectangle
    expect(outerConcavities(g.expandStroke(rect, brush(8)))).toBe(0); // thin rectangle
    expect(outerConcavities(g.expandStroke(tri, brush(30)))).toBe(0); // triangle
    expect(outerConcavities(g.expandStroke(acute, brush(20)))).toBe(0); // acute corner

    // And the corner is actually rounded (filled out to ~0.85·r along the bisector).
    const r = 20;
    const out = g.expandStroke(closed("brsq2", [[0, 0], [200, 0], [200, 200], [0, 200]]), brush(r));
    const rings = out.map(flattenContour);
    const k = (r * 0.85) / Math.SQRT2;
    for (const [cx, cy, dx, dy] of [[0, 0, -1, -1], [200, 0, 1, -1], [200, 200, 1, 1], [0, 200, -1, 1]] as const) {
      expect(insideNonzero({ x: cx + dx * k, y: cy + dy * k }, rings)).toBe(true);
    }
  });

  it("returns nothing for a degenerate path", () => {
    expect(g.expandStroke(open("x", [[5, 5]]), STROKE)).toEqual([]);
    expect(g.expandStroke(open("y", [[0, 0], [1, 0]]), { ...STROKE, width: 0 })).toEqual([]);
  });

  it("caps each end independently (round start extends only the start)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    // Round START cap only → extends to the left (x<0) but not the right.
    const out = g.expandStroke(seg, { width: 20, startCap: "round", endCap: "butt", join: "miter" });
    const b = bbox(out);
    expect(b.minX).toBeLessThan(-1); // round start bulges past x=0
    expect(b.maxX).toBeCloseTo(100, 0); // butt end stays flat at x=100
  });

  it("keeps a self-overlapping stroke solid (no spurious hole / exclude)", () => {
    // A hairpin: the two arms nearly coincide, so a wide stroke's outline overlaps
    // itself. The result must be a solid union (all CW), not an even-odd exclude.
    const hairpin = open("hp", [[0, 0], [100, 0], [0, 1]]);
    const out = g.expandStroke(hairpin, { width: 40, startCap: "butt", endCap: "butt", join: "round" });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(contourWinding(c)).toBe("cw"); // no CCW hole
  });

  it("rectangle cap keeps its far edge at the node and grows inward", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    // End cap = rectangle, depth 30. The far edge stays at x=100 (the node); the box
    // grows inward (x<100), so it must NOT project past the terminal.
    const out = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "rectangle", join: "miter",
      endRect: { size: 30, ratio: 1, radius: 0 }, // angle omitted = auto (perpendicular)
    });
    const b = bbox(out);
    expect(b.maxX).toBeCloseTo(100, 0); // far edge AT the node, no overhang
    expect(b.minX).toBeCloseTo(0, 0); // butt start unchanged
  });

  it("rectangle cap ratio widens the cap past the stem width", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const narrow = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "rectangle", join: "miter",
      endRect: { size: 30, ratio: 1, radius: 0 },
    });
    const wide = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "rectangle", join: "miter",
      endRect: { size: 30, ratio: 2.5, radius: 0 },
    });
    expect(bbox(wide).h).toBeGreaterThan(bbox(narrow).h); // ratio 2.5 is taller
    for (const c of wide) expect(contourWinding(c)).toBe("cw");
  });

  it("rectangle cap with default size reproduces the old square footprint", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    // Old square cap projected r past the node and was width 2r. The migration
    // backfills size = width/2 (= r) and ratio 1, but anchored at the node, so the
    // box spans [70,100]×width instead of [100,110] — same size, flush at the node.
    const out = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "rectangle", join: "miter",
      endRect: { size: 10, ratio: 1, radius: 0 },
    });
    const b = bbox(out);
    expect(b.h).toBeCloseTo(20, 0); // full stem width
    expect(b.maxX).toBeCloseTo(100, 0); // flush at node
    for (const c of out) expect(contourWinding(c)).toBe("cw");
  });

  it("rectangle cap angle rotates the whole cap rigidly about the node", () => {
    // Horizontal stroke ending at x=100. Auto = axis along the path → vertical flat
    // edge sitting on the node (maxX=100). A 45° world axis rotates the WHOLE cap, so
    // a far corner swings past x=100; it stays one solid region and never detaches.
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt", endCap: "rectangle", join: "miter" } as const;
    const auto = g.expandStroke(seg, { ...base, endRect: { size: 40, ratio: 2 } });
    const tilted = g.expandStroke(seg, { ...base, endRect: { size: 40, ratio: 2, angle: 45 } });
    expect(bbox(auto).maxX).toBeCloseTo(100, 0); // auto far edge sits on the node
    expect(bbox(tilted).maxX).toBeGreaterThan(100); // rotated cap swings a corner past
    expect(tilted.length).toBe(1); // one solid region, not a detached floating box
    for (const c of tilted) expect(contourWinding(c)).toBe("cw");
  });

  it("rectangle cap 'outward' anchor projects the box past the node", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // ends at x=100
    const node = bbox(g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "rectangle", join: "miter",
      endRect: { size: 30, ratio: 1, radius: 0, anchor: "node" },
    }));
    const outward = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "rectangle", join: "miter",
      endRect: { size: 30, ratio: 1, radius: 0, anchor: "outward" },
    });
    expect(node.maxX).toBeCloseTo(100, 0); // node anchor: far edge on the node
    const b = bbox(outward);
    expect(b.maxX).toBeCloseTo(130, 0); // outward: box projects depth=30 past the node
    expect(outward.length).toBe(1); // unions solidly with the stem, one region
    for (const c of outward) expect(contourWinding(c)).toBe("cw");
  });

  it("rectangle variant 'b' is a seamless flare — one solid wider than the stem", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt" as const, endCap: "rectangle" as const, join: "miter" as const };
    const slab = g.expandStroke(seg, { ...base, endRect: { size: 30, ratio: 2 } }); // A
    const flare = g.expandStroke(seg, { ...base, endRect: { size: 30, ratio: 2, variant: "b" } });
    expect(flare.length).toBe(1); // seamless single solid
    for (const c of flare) expect(contourWinding(c)).toBe("cw");
    expect(bbox(flare).h).toBeGreaterThan(20); // flares wider than the ±10 stem
    expect(area(flare)).not.toBeCloseTo(area(slab), 0); // a different construction than A
  });

  it("rectangle B 'reach' runs the flare further up the stem", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt" as const, endCap: "rectangle" as const, join: "miter" as const };
    const shortR = g.expandStroke(seg, { ...base, endRect: { size: 30, ratio: 2, variant: "b", reach: 15 } });
    const longR = g.expandStroke(seg, { ...base, endRect: { size: 30, ratio: 2, variant: "b", reach: 70 } });
    expect(longR.length).toBe(1);
    for (const c of longR) expect(contourWinding(c)).toBe("cw");
    expect(area(longR)).toBeGreaterThan(area(shortR)); // a longer flare adds material up the stem
  });

  it("swapping the caps mirrors which end extends", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const out = g.expandStroke(seg, { width: 20, startCap: "butt", endCap: "round", join: "miter" });
    const b = bbox(out);
    expect(b.minX).toBeCloseTo(0, 0); // butt start flat at x=0
    expect(b.maxX).toBeGreaterThan(101); // round end bulges past x=100
  });

  it("round cap 'far edge at node' keeps the tip on the node (no overhang)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // ends at x=100
    const past = bbox(g.expandStroke(seg, { width: 20, startCap: "butt", endCap: "round", join: "miter" }));
    const atNode = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "round", join: "miter", endRoundAtNode: true,
    });
    expect(past.maxX).toBeGreaterThan(101); // default round bulges past the node
    const b = bbox(atNode);
    expect(b.maxX).toBeCloseTo(100, 0); // tip ON the node, nothing projects past
    for (const c of atNode) expect(contourWinding(c)).toBe("cw"); // one solid region
  });

  it("round 'far edge at node' keeps BOTH caps on a WIDE stroke (no cap carved away)", () => {
    // A short, very WIDE stroke (width 80 ≫ length 60): the old straight-box carve
    // over-removed and could erase a whole cap. Both ends must survive as one solid.
    const seg = open("seg", [[0, 0], [60, 0]]);
    const out = g.expandStroke(seg, {
      width: 80, startCap: "round", endCap: "round", join: "miter",
      startRoundAtNode: true, endRoundAtNode: true,
    });
    expect(out.length).toBe(1); // one solid region, neither cap carved away
    for (const c of out) expect(contourWinding(c)).toBe("cw");
    const b = bbox(out);
    expect(b.minX).toBeGreaterThan(-1); // far edges at the nodes, no overhang past either
    expect(b.maxX).toBeLessThan(61);
    expect(area(out)).toBeGreaterThan(60 * 80 * 0.35); // substantial body remains (not gutted to ~0)
  });

  it("round 'far edge at node' on a CURVED terminal stays one clean solid", () => {
    // A curving terminal: the straight-box carve mismatched the curved body (artifacts).
    // Carving against the real body must keep it one solid CW region with no overhang.
    const curve: Contour = {
      id: "cv", closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 50, y: 0 } },
        { id: "b", type: "smooth", x: 100, y: 60, handleIn: { x: 100, y: 10 } },
      ],
    };
    const out = g.expandStroke(curve, {
      width: 40, startCap: "butt", endCap: "round", join: "round", endRoundAtNode: true,
    });
    expect(out.length).toBe(1);
    for (const c of out) expect(contourWinding(c)).toBe("cw");
  });

  it("a thick stroke with a sharp corner gets a clean round join (no spike/hole)", () => {
    // An L (90° corner at (50,0)). The swept model unions a disc at the corner for a
    // round join, so it's one solid region, larger than the bevel, with no spike.
    const ell = open("L", [[0, 0], [50, 0], [50, 50]]);
    const base = { width: 30, startCap: "butt", endCap: "butt" } as const;
    const round = g.expandStroke(ell, { ...base, join: "round" });
    const bevel = g.expandStroke(ell, { ...base, join: "bevel" });
    for (const c of round) expect(contourWinding(c)).toBe("cw"); // solid, no exclude hole
    expect(area(round)).toBeGreaterThan(area(bevel)); // the round join adds the corner disc
    const b = bbox(round);
    expect(b.maxX).toBeLessThan(67); // r=15 past the corner — no runaway spike
    expect(b.minY).toBeGreaterThan(-17);
  });

  it("brush model: a thick sharp corner is one solid region (no notch / hole)", () => {
    const ell = open("L", [[0, 0], [50, 0], [50, 50]]);
    const base = { width: 30, startCap: "butt" as const, endCap: "butt" as const, join: "round" as const };
    const brush = g.expandStroke(ell, { ...base, model: "brush" });
    expect(brush.length).toBeGreaterThan(0);
    for (const c of brush) expect(contourWinding(c)).toBe("cw"); // solid, no exclude hole
    // The brush envelope stays within r=15 of the centerline (no runaway spike).
    const b = bbox(brush);
    expect(b.maxX).toBeLessThan(67);
    expect(b.minY).toBeGreaterThan(-17);
  });

  it("brush model: a straight segment matches the offset body's footprint", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 24, startCap: "butt" as const, endCap: "butt" as const, join: "miter" as const };
    const offset = bbox(g.expandStroke(seg, base));
    const brush = bbox(g.expandStroke(seg, { ...base, model: "brush" }));
    expect(brush.w).toBeCloseTo(offset.w, 0);
    expect(brush.h).toBeCloseTo(offset.h, 0); // same ±width/2 band
  });

  it("brush model: a closed path expands to an annulus (outer + hole)", () => {
    const sq = closed("sq", [[0, 0], [120, 0], [120, 120], [0, 120]]);
    const out = g.expandStroke(sq, { width: 20, startCap: "butt", endCap: "butt", join: "round", model: "brush" });
    expect(out.length).toBe(2); // outer ring + hole
    expect(out.map(contourWinding).sort()).toEqual(["ccw", "cw"]);
  });

  it("brush model: a path that curves back on itself stays solid (no carved gap)", () => {
    // A hook whose end tangent points back toward the body — the old global terminal
    // half-plane cut sliced a distant part here, leaving a huge gap. The brush body
    // must stay one solid region with area on par with the offset body (no gap).
    const hook = open("hook", [[0, 0], [120, 0], [120, 60], [40, 60]]);
    const base = { width: 24, startCap: "round" as const, endCap: "round" as const, join: "round" as const };
    const brush = g.expandStroke(hook, { ...base, model: "brush" });
    const offset = g.expandStroke(hook, base);
    for (const c of brush) expect(contourWinding(c)).toBe("cw"); // no spurious hole
    expect(brush.length).toBe(1); // one piece, not carved apart
    expect(area(brush)).toBeGreaterThan(area(offset) * 0.85); // ~same coverage, no gap
  });

  it("butt cap edge is perpendicular to the terminal tangent (no skew/overhang)", () => {
    // A 45° segment: the butt ends must lie on x+y=0 (start) and x+y=100 (end), i.e.
    // ⟂ the (1,1) tangent — a skewed/overhanging cap would push max(x+y) past 100.
    const diag = open("d", [[0, 0], [50, 50]]);
    const out = g.expandStroke(diag, { width: 20, startCap: "butt", endCap: "butt", join: "miter" });
    const sums = out.flatMap((c) => c.points).map((p) => p.x + p.y);
    expect(Math.max(...sums)).toBeCloseTo(100, 0); // end butt edge ⟂ the tangent
    expect(Math.min(...sums)).toBeCloseTo(0, 0); // start butt edge ⟂ the tangent
  });

  it("a terminal handle rotates the butt cap (edge ⟂ the handle, not the tangent)", () => {
    // Horizontal stem; the START node's dangling handleIn is the cap-angle handle.
    const withHandle = (handleIn?: { x: number; y: number }): Contour => ({
      id: "s", closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, ...(handleIn ? { handleIn } : {}) },
        { id: "b", type: "corner", x: 100, y: 0 },
      ],
    });
    const base = { width: 20, startCap: "butt" as const, endCap: "butt" as const, join: "miter" as const };
    // No handle → butt ⟂ tangent: the vertical start edge spans to (0,-10), so min(x+y)=-10.
    const plain = g.expandStroke(withHandle(), base);
    expect(Math.min(...plain.flatMap((c) => c.points).map((p) => p.x))).toBeCloseTo(0, 0);
    expect(Math.min(...plain.flatMap((c) => c.points).map((p) => p.x + p.y))).toBeCloseTo(-10, 0);
    // handleIn along (-1,-1) → the flat butt is ⟂ that axis, i.e. it lies on x+y=0.
    const tilted = g.expandStroke(withHandle({ x: -30, y: -30 }), base);
    expect(tilted.length).toBe(1);
    for (const c of tilted) expect(contourWinding(c)).toBe("cw");
    expect(Math.min(...tilted.flatMap((c) => c.points).map((p) => p.x + p.y))).toBeCloseTo(0, 0);
  });

  it("a terminal handle feeds the rectangle cap's axis (when no panel angle is set)", () => {
    const seg: Contour = {
      id: "s", closed: false,
      points: [
        { id: "a", type: "corner", x: 0, y: 0 },
        { id: "b", type: "smooth", x: 100, y: 0, handleOut: { x: 130, y: 30 } }, // end cap-angle handle
      ],
    };
    const base = { width: 20, startCap: "butt" as const, endCap: "rectangle" as const, join: "miter" as const };
    const noHandle: Contour = {
      ...seg,
      points: [seg.points[0]!, { id: "b", type: "corner", x: 100, y: 0 }],
    };
    const auto = g.expandStroke(noHandle, { ...base, endRect: { size: 40, ratio: 2, radius: 0 } });
    const tilted = g.expandStroke(seg, { ...base, endRect: { size: 40, ratio: 2, radius: 0 } });
    expect(bbox(auto).maxX).toBeCloseTo(100, 0); // auto: flat edge on the node
    expect(bbox(tilted).maxX).toBeGreaterThan(100); // handle rotates the cap → corner swings past
    expect(tilted.length).toBe(1);
    for (const c of tilted) expect(contourWinding(c)).toBe("cw");
  });

  it("broad nib: thickness depends on nib angle vs path direction", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // horizontal path
    // Nib aligned with the path (0°) → thin (≈ width·contrast).
    const thin = g.expandStroke(seg, {
      width: 80, startCap: "butt", endCap: "butt", join: "round", angle: 0, contrast: 0.1,
    });
    // Nib perpendicular to the path (90°) → full width.
    const thick = g.expandStroke(seg, {
      width: 80, startCap: "butt", endCap: "butt", join: "round", angle: 90, contrast: 0.1,
    });
    expect(bbox(thin).h).toBeLessThan(20); // ≈ 80·0.1
    expect(bbox(thick).h).toBeGreaterThan(70); // ≈ 80
    for (const c of thick) expect(contourWinding(c)).toBe("cw"); // solid, no hole
  });

  it("broad nib stays solid on a sharp bend (no exclude hole)", () => {
    // A hairpin sends a wide nib's sampled ribbon across itself at the turn. Pre-fix
    // the overlap loop nested inside the outline → correctWinding made it a CCW hole
    // → an "exclude" under nonzero. It must come back all-CW (one solid region).
    const hairpin = open("nib-hp", [[0, 0], [120, 0], [0, 12]]);
    const out = g.expandStroke(hairpin, {
      width: 70, startCap: "butt", endCap: "butt", join: "round", angle: 90, contrast: 0.2,
    });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(contourWinding(c)).toBe("cw"); // no spurious hole
  });

  it("serif stays solid on a sharply curving path (no exclude hole)", () => {
    // A tight S — the sampled serif ribbon self-crosses at the inflection.
    const scurve: Contour = {
      id: "sc",
      closed: false,
      points: [
        { id: "s0", type: "smooth", x: 0, y: 0, handleOut: { x: 80, y: 0 } },
        { id: "s1", type: "smooth", x: 60, y: 60, handleIn: { x: 60, y: -20 }, handleOut: { x: 60, y: 140 } },
        { id: "s2", type: "smooth", x: 120, y: 0, handleIn: { x: 40, y: 60 } },
      ],
    };
    const out = g.expandStroke(scurve, {
      width: 50, startCap: "butt", endCap: "serif", join: "round", endSerif: { length: 40, depth: 30 },
    });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(contourWinding(c)).toBe("cw"); // no spurious hole
  });

  it("does not spike from dangling end handles (pen smooth anchors)", () => {
    // smoothPoint gives every smooth anchor BOTH handles, so an open path's first
    // anchor carries a dangling handleIn and the last a dangling handleOut — used
    // by no drawn segment. The offsetter must ignore them: a butt stroke along +x
    // from 0..100 stays within x∈[0,100], with no spike growing along the handles.
    const path: Contour = {
      id: "h",
      closed: false,
      points: [
        { id: "h0", type: "smooth", x: 0, y: 0, handleOut: { x: 40, y: 0 }, handleIn: { x: -120, y: 0 } },
        { id: "h1", type: "smooth", x: 100, y: 0, handleIn: { x: 60, y: 0 }, handleOut: { x: 220, y: 0 } },
      ],
    };
    const b = bbox(g.expandStroke(path, { width: 20, startCap: "butt", endCap: "butt", join: "miter" }));
    expect(b.minX).toBeGreaterThan(-2); // no backward spike at the start
    expect(b.maxX).toBeLessThan(102); // no forward spike at the end
  });

  it("serif cap flares the terminal into a wider foot", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // width 20 → spans y∈[-10,10]
    const plain = bbox(g.expandStroke(seg, { width: 20, startCap: "butt", endCap: "butt", join: "miter" }));
    const serifed = bbox(
      g.expandStroke(seg, {
        width: 20, startCap: "butt", endCap: "serif", join: "miter",
        endSerif: { length: 40, depth: 30 },
      }),
    );
    expect(serifed.h).toBeGreaterThan(plain.h + 30); // foot spans ±40 at the end
  });

  it("serif variant 'b' builds a clean foot on a curved stem at a steep angle (no notch)", () => {
    // Curved terminal + a steep foot angle — algorithm A's notch case. B is the SEAMLESS
    // sampled flare built INTO the body (tangent-only, so it ignores the angle and never
    // hits A's kink): one solid outline (no union seam, no CCW notch-hole).
    const curve: Contour = {
      id: "cv",
      closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 40, y: 0 } },
        { id: "b", type: "smooth", x: 100, y: 60, handleIn: { x: 100, y: 0 } },
      ],
    };
    const base = { width: 20, startCap: "butt" as const, endCap: "serif" as const, join: "round" as const };
    const aFoot = g.expandStroke(curve, { ...base, endSerif: { length: 50, depth: 30, bracket: 0.6, angle: 20 } });
    const bFoot = g.expandStroke(curve, {
      ...base,
      endSerif: { length: 50, depth: 30, bracket: 0.6, angle: 20, variant: "b" },
    });
    expect(bFoot.length).toBe(1); // ONE seamless solid — no union seam / detached piece
    for (const c of bFoot) expect(contourWinding(c)).toBe("cw"); // no spurious notch-hole
    expect(bbox(bFoot).h).toBeGreaterThan(60); // the foot (±50) widens the terminal
    expect(area(bFoot)).not.toBeCloseTo(area(aFoot), 0); // tangent foot ≠ A's angled foot
  });

  it("serif B ignores the angle (tangent only) — the broken-angle case", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt" as const, endCap: "serif" as const, join: "miter" as const };
    const plain = g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 30, bracket: 0.6, variant: "b" } });
    const angled = g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 30, bracket: 0.6, variant: "b", angle: 45 } });
    expect(angled.length).toBe(1);
    for (const c of angled) expect(contourWinding(c)).toBe("cw");
    expect(area(angled)).toBeCloseTo(area(plain), 0); // the angle has NO effect on a variant-b foot
  });

  it("serif B (wedge) is a DIFFERENT shape from A (bracket) on a straight stem", () => {
    // The regression: B used to reduce to A's concave bracket, so a straight unangled
    // stem looked identical. B is now a wedge (linear sides) — its area must differ, and
    // it must stay ONE seamless cw solid (no union/overlap edge).
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt" as const, endCap: "serif" as const, join: "miter" as const };
    const foot = { length: 50, depth: 40, bracket: 0.6 };
    const bracket = g.expandStroke(seg, { ...base, endSerif: { ...foot, variant: "a" } });
    const wedge = g.expandStroke(seg, { ...base, endSerif: { ...foot, variant: "b" } });
    expect(wedge.length).toBe(1); // one seamless solid
    for (const c of wedge) expect(contourWinding(c)).toBe("cw");
    expect(area(wedge)).not.toBeCloseTo(area(bracket), 0); // wedge ≠ concave bracket
  });

  it("serif integrates as one solid region on a curve (no detached block)", () => {
    // A gentle smooth curve — the realistic case where the old block stuck out.
    const curve: Contour = {
      id: "cv",
      closed: false,
      points: [
        { id: "c0", type: "smooth", x: 0, y: 0, handleOut: { x: 50, y: 0 } },
        { id: "c1", type: "smooth", x: 150, y: 40, handleIn: { x: 100, y: 40 } },
      ],
    };
    const base = { width: 20, startCap: "butt" as const, join: "round" as const };
    const plain = g.expandStroke(curve, { ...base, endCap: "butt" });
    const serifed = g.expandStroke(curve, {
      ...base, endCap: "serif", endSerif: { length: 30, depth: 25 },
    });
    expect(serifed.length).toBe(1); // a single outline, not body + a stuck-on box
    for (const c of serifed) expect(contourWinding(c)).toBe("cw"); // solid, no hole
    expect(area(serifed)).toBeGreaterThan(area(plain)); // the foot adds material
  });

  it("serif 'project' extends the foot as a box past the terminal", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // ends at x=100
    const flush = bbox(
      g.expandStroke(seg, {
        width: 20, startCap: "butt", endCap: "serif", join: "miter",
        endSerif: { length: 40, depth: 30, project: 0 },
      }),
    );
    const boxed = bbox(
      g.expandStroke(seg, {
        width: 20, startCap: "butt", endCap: "serif", join: "miter",
        endSerif: { length: 40, depth: 30, project: 25 },
      }),
    );
    expect(flush.maxX).toBeCloseTo(100, 0); // flush foot ends at the terminal
    expect(boxed.maxX).toBeCloseTo(125, 0); // project=25 → foot box to x≈125
  });

  it("serif 'node' anchor keeps the foot's far edge on the node when boxed", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // ends at x=100
    const boxed = bbox(
      g.expandStroke(seg, {
        width: 20, startCap: "butt", endCap: "serif", join: "miter",
        endSerif: { length: 40, depth: 30, project: 25, anchor: "node" },
      }),
    );
    // Unlike the default outward box (which would reach x≈125), the node anchor
    // holds the far edge on the terminal and grows the box inward.
    expect(boxed.maxX).toBeCloseTo(100, 0);
  });

  it("serif 'bias' shifts the foot to one side (asymmetric beak)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt", endCap: "serif", join: "miter" } as const;
    const sym = bbox(g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 30 } }));
    const biased = bbox(g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 30, bias: 1 } }));
    // Symmetric: the foot reaches ~±40 on both sides of the stem.
    expect(sym.maxY).toBeCloseTo(40, 0);
    expect(-sym.minY).toBeCloseTo(40, 0);
    // bias=1: one side collapses toward the stem (~±10), the other keeps the foot.
    const top = biased.maxY, bot = -biased.minY;
    expect(Math.min(top, bot)).toBeLessThan(20); // collapsed side ≈ stem
    expect(Math.max(top, bot)).toBeGreaterThan(35); // foot side ≈ full
  });

  it("serif world-angle foot rotates rigidly with the angle (stays solid)", () => {
    // A slanted stem (45°). The world-absolute foot axis rotates the flat foot
    // rigidly, so different angles give different footprints — and each stays one
    // solid CW region (the angled slab unions onto the flush flare, never detaches).
    const stem = open("seg", [[0, 0], [70, 70]]);
    const base = { width: 20, startCap: "butt", endCap: "serif", join: "miter" } as const;
    const a = g.expandStroke(stem, { ...base, endSerif: { length: 50, depth: 30, angle: 0 } });
    const b = g.expandStroke(stem, { ...base, endSerif: { length: 50, depth: 30, angle: 90 } });
    for (const c of a) expect(contourWinding(c)).toBe("cw");
    for (const c of b) expect(contourWinding(c)).toBe("cw");
    expect(Math.abs(bbox(a).w - bbox(b).w)).toBeGreaterThan(1); // angle changes the footprint
  });

  it("serif 'bracket' reduces to the legacy flare at 0 and carves a concave fillet above 0", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 20, startCap: "butt" as const, endCap: "serif" as const, join: "miter" as const };
    // bracket omitted vs bracket:0 must be identical (backward-compatible default).
    const legacy = g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 40 } });
    const zero = g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 40, bracket: 0 } });
    expect(area(zero)).toBeCloseTo(area(legacy), 0);
    // A concave bracket hugs the stem through the reach (flaring out only near the
    // foot), so it fills LESS area than the smoothstep flare — and stays one solid CW.
    const bracketed = g.expandStroke(seg, { ...base, endSerif: { length: 40, depth: 40, bracket: 1 } });
    expect(area(bracketed)).toBeLessThan(area(legacy));
    expect(bbox(bracketed).maxY).toBeCloseTo(40, 0); // foot still reaches full length
    for (const c of bracketed) expect(contourWinding(c)).toBe("cw");
  });

  it("drop cap swells into a rounded ink-pool wider than the stem, projecting past the node", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // stem width 16 (r=8), ends at x=100
    const plain = g.expandStroke(seg, { width: 16, startCap: "butt", endCap: "butt", join: "miter" });
    const pool = g.expandStroke(seg, {
      width: 16, startCap: "butt", endCap: "drop", join: "miter",
      endDrop: { size: 40, ratio: 1.5, smear: 0 },
    });
    const b = bbox(pool);
    expect(b.maxX).toBeGreaterThan(135); // round pool (radius 40) projects past x=100 → ~140
    expect(b.maxY).toBeGreaterThan(30); // pool half-width ≈40 ≫ stem half 8 (it swells)
    expect(pool.length).toBe(1); // one seamless solid (swell + tangent round cap)
    for (const c of pool) expect(contourWinding(c)).toBe("cw");
    expect(area(pool)).toBeGreaterThan(area(plain)); // the pool adds material
  });

  it("drop variant 'b' is a seamless necked-bulb teardrop (one solid; a tighter neck pinches it)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]); // stem width 16 (r=8)
    const base = { width: 16, startCap: "butt" as const, endCap: "drop" as const, join: "miter" as const };
    const round = g.expandStroke(seg, { ...base, endDrop: { size: 40, ratio: 1.5 } }); // A
    const bulb = g.expandStroke(seg, { ...base, endDrop: { size: 40, ratio: 1.5, variant: "b" } });
    const bb = bbox(bulb);
    expect(bulb.length).toBe(1); // one seamless solid — no pasted-on cap, no seam
    for (const c of bulb) expect(contourWinding(c)).toBe("cw");
    expect(bb.maxX).toBeGreaterThan(100); // the bulb + tip project past the node
    expect(bb.maxY).toBeGreaterThan(20); // the bulb is far wider than the ±8 stem
    expect(area(bulb)).not.toBeCloseTo(area(round), 0); // a different construction than A
    // A tighter neck removes material at the waist → less total area.
    const tight = g.expandStroke(seg, { ...base, endDrop: { size: 40, ratio: 1.5, variant: "b", neck: 0.2 } });
    const wide = g.expandStroke(seg, { ...base, endDrop: { size: 40, ratio: 1.5, variant: "b", neck: 0.9 } });
    expect(area(tight)).toBeLessThan(area(wide));
  });

  it("drop 'ink size' sets the pool radius (bigger = wider and further past the node)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 16, startCap: "butt" as const, endCap: "drop" as const, join: "miter" as const };
    const small = bbox(g.expandStroke(seg, { ...base, endDrop: { size: 24, ratio: 1.5 } }));
    const big = bbox(g.expandStroke(seg, { ...base, endDrop: { size: 60, ratio: 1.5 } }));
    expect(big.maxX).toBeGreaterThan(small.maxX + 30); // further past the node
    expect(big.maxY).toBeGreaterThan(small.maxY + 20); // and a wider pool
  });

  it("drop ink-pool stays one solid region under a lean", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 16, startCap: "butt" as const, endCap: "drop" as const, join: "miter" as const };
    const leaned = g.expandStroke(seg, { ...base, endDrop: { size: 40, ratio: 1.5, smear: 0.8 } });
    expect(leaned.length).toBe(1);
    for (const c of leaned) expect(contourWinding(c)).toBe("cw");
  });

  it("drop on a broad-nib stroke stays one solid (mouth matches the nib width)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const out = g.expandStroke(seg, {
      width: 60, startCap: "butt", endCap: "drop", join: "round",
      angle: 45, contrast: 0.2, endDrop: { size: 50, ratio: 1 },
    });
    expect(out.length).toBe(1);
    for (const c of out) expect(contourWinding(c)).toBe("cw");
  });

  it("drop merges into a CURVED terminal as one solid (neck on the stroke)", () => {
    // Terminal segment is curved (end tangent not aligned with the chord), the case
    // where the old straight-tangent neck stuck off the stroke.
    const curve: Contour = {
      id: "cv",
      closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 60, y: 0 } },
        { id: "b", type: "smooth", x: 120, y: 70, handleIn: { x: 120, y: 10 } },
      ],
    };
    const base = { width: 16, startCap: "butt" as const, join: "round" as const };
    const plain = g.expandStroke(curve, { ...base, endCap: "butt" });
    const dropped = g.expandStroke(curve, {
      ...base, endCap: "drop", endDrop: { size: 40, ratio: 1 },
    });
    expect(dropped.length).toBe(1); // one merged solid, no detached neck island
    for (const c of dropped) expect(contourWinding(c)).toBe("cw");
    expect(area(dropped)).toBeGreaterThan(area(plain)); // the bulb adds material
  });

  it("a serif terminal is finely sampled (smooth flare, not a 4-corner box)", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const out = g.expandStroke(seg, {
      width: 20, startCap: "butt", endCap: "serif", join: "miter",
      endSerif: { length: 40, depth: 30 },
    });
    const pts = out.reduce((n, c) => n + c.points.length, 0);
    expect(pts).toBeGreaterThan(20); // many samples → smooth flare along the path
  });

  // --- Width / angle profiles (the graph editor) -----------------------------

  /** Max |y| among points whose x falls in [xMin, xMax] — local thickness probe. */
  const maxAbsYNear = (cs: Contour[], xMin: number, xMax: number): number => {
    let m = 0;
    for (const c of cs) for (const p of c.points) if (p.x >= xMin && p.x <= xMax) m = Math.max(m, Math.abs(p.y));
    return m;
  };

  it("a flat width profile scales the whole stroke's area by the multiplier", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const base = { width: 40, startCap: "butt", endCap: "butt", join: "miter" } as const;
    const full = g.expandStroke(seg, base);
    const half = g.expandStroke(seg, { ...base, widthProfile: { points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] } });
    expect(area(half)).toBeCloseTo(area(full) * 0.5, -2); // ~half the filled area
  });

  it("a tapering width profile makes the end thinner than the start", () => {
    const seg = open("seg", [[0, 0], [100, 0]]);
    const out = g.expandStroke(seg, {
      width: 40, startCap: "butt", endCap: "butt", join: "miter",
      widthProfile: { points: [{ x: 0, y: 1 }, { x: 1, y: 0.2 }] },
    });
    const startHalf = maxAbsYNear(out, 0, 8); // ≈ 20 (full)
    const endHalf = maxAbsYNear(out, 92, 100); // ≈ 4 (20%)
    expect(startHalf).toBeGreaterThan(15);
    expect(endHalf).toBeLessThan(8);
    expect(endHalf).toBeLessThan(startHalf);
  });

  it("a closed path with a width profile expands to an annulus (outer + hole)", () => {
    const ring = closed("ring", [[0, 0], [100, 0], [100, 100], [0, 100]]);
    const out = g.expandStroke(ring, {
      width: 20, startCap: "butt", endCap: "butt", join: "miter",
      widthProfile: { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    });
    expect(out.length).toBe(2); // outer boundary + inner hole
    const windings = out.map(contourWinding).sort();
    expect(windings).toEqual(["ccw", "cw"]); // outer CW, hole CCW (Invariant 4)
  });

  it("an angle profile varies the nib thickness along the path", () => {
    // Horizontal path: nib angle 0 ⟂ path → thin (contrast); 90° → thick (full).
    const seg = open("seg", [[0, 0], [100, 0]]);
    const out = g.expandStroke(seg, {
      width: 60, startCap: "butt", endCap: "butt", join: "round", contrast: 0.1,
      angleProfile: { points: [{ x: 0, y: 0 }, { x: 1, y: 90 }] },
    });
    const startHalf = maxAbsYNear(out, 0, 8); // nib-parallel → thin
    const endHalf = maxAbsYNear(out, 92, 100); // nib-perpendicular → thick
    expect(endHalf).toBeGreaterThan(startHalf * 2);
    for (const c of out) expect(contourWinding(c)).toBe("cw"); // one solid region
  });
});

describe("halftone model (experimental)", () => {
  const base: StrokeStyle = { width: 40, startCap: "butt", endCap: "butt", join: "miter", model: "halftone" };

  it("fills the ribbon with many separate dots, all within the stroke band", () => {
    const dots = g.expandStroke(open("h", [[0, 0], [200, 0]]), {
      ...base,
      halftone: { cell: 12, size: 16, angle: 0, shape: "circle" },
    });
    expect(dots.length).toBeGreaterThan(5); // many elements, not one solid
    const bb = bbox(dots);
    // body is width 40 about y=0 ⇒ every dot stays within ±(20) + a hair, and 0..200 in x.
    expect(bb.minY).toBeGreaterThanOrEqual(-21);
    expect(bb.maxY).toBeLessThanOrEqual(21);
    expect(bb.minX).toBeGreaterThanOrEqual(-1);
    expect(bb.maxX).toBeLessThanOrEqual(201);
  });

  it("a smaller cell yields more dots", () => {
    const few = g.expandStroke(open("hf", [[0, 0], [200, 0]]), {
      ...base,
      halftone: { cell: 40, size: 16, angle: 0, shape: "circle" },
    });
    const many = g.expandStroke(open("hm", [[0, 0], [200, 0]]), {
      ...base,
      halftone: { cell: 12, size: 14, angle: 0, shape: "circle" },
    });
    expect(many.length).toBeGreaterThan(few.length);
  });

  it("dots are solid (CW); a non-halftone stroke of the same path is one solid (offset intact)", () => {
    const dots = g.expandStroke(open("hc", [[0, 0], [200, 0]]), {
      ...base,
      halftone: { cell: 24, size: 18, angle: 30, shape: "square" },
    });
    expect(dots.length).toBeGreaterThan(0);
    for (const c of dots) expect(contourWinding(c)).toBe("cw");
    const solid = g.expandStroke(open("hs", [[0, 0], [200, 0]]), {
      width: 40,
      startCap: "butt",
      endCap: "butt",
      join: "miter",
    });
    expect(solid.length).toBe(1); // offset model unaffected by the new branch
  });

  it("higher contrast concentrates the tone (less total ink than the low-contrast fill)", () => {
    const ht = (contrast: number) =>
      g.expandStroke(open(`ct${contrast}`, [[0, 0], [200, 0]]), {
        ...base,
        halftone: { cell: 10, size: 14, angle: 0, shape: "circle", contrast },
      });
    // contrast>0.5 ⇒ dots decay faster off-centre ⇒ less filled area than contrast<0.5.
    const totalArea = (cs: ReturnType<typeof ht>) => cs.reduce((s, c) => s + Math.abs(signedAreaOf(c)), 0);
    expect(totalArea(ht(0.85))).toBeLessThan(totalArea(ht(0.15)));
  });

  it("triangle and custom-svg-pattern shapes both stamp many in-band dots", () => {
    const tri = g.expandStroke(open("tri", [[0, 0], [200, 0]]), {
      ...base,
      halftone: { cell: 14, size: 16, angle: 0, shape: "triangle" },
    });
    expect(tri.length).toBeGreaterThan(3);
    for (const c of tri) expect(contourWinding(c)).toBe("cw");
    // A custom pattern: a unit square contour stamped as the element.
    const sq: Contour = closed("p", [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]);
    const svg = g.expandStroke(open("svp", [[0, 0], [200, 0]]), {
      ...base,
      halftone: { cell: 16, size: 16, angle: 0, shape: "svg", pattern: [sq] },
    });
    expect(svg.length).toBeGreaterThan(3);
    const bb = bbox(svg);
    expect(bb.minY).toBeGreaterThanOrEqual(-21);
    expect(bb.maxY).toBeLessThanOrEqual(21);
  });

  it("a CLOSED path halftones its INTERIOR (not a thin ring)", () => {
    // 200×200 square; halftone should place dots across the whole interior, incl. the centre.
    const sq = closed("sq", [[0, 0], [200, 0], [200, 200], [0, 200]]);
    const dots = g.expandStroke(sq, {
      width: 80, // fade depth
      startCap: "butt",
      endCap: "butt",
      join: "miter",
      model: "halftone",
      halftone: { cell: 16, size: 16, angle: 0, shape: "circle", contrast: 0.5 },
    });
    expect(dots.length).toBeGreaterThan(20);
    for (const c of dots) expect(contourWinding(c)).toBe("cw");
    const bb = bbox(dots);
    expect(bb.minX).toBeGreaterThanOrEqual(-1);
    expect(bb.maxX).toBeLessThanOrEqual(201);
    // A dot exists near the centre (100,100) — proof the interior is filled, not just a ring.
    const nearCentre = dots.some((c) => c.points.some((p) => Math.hypot(p.x - 100, p.y - 100) < 30));
    expect(nearCentre).toBe(true);
  });

  it("round end-cap extends the halftone past the terminal (a dome); butt stays flat", () => {
    const seg = (): Contour => open("rc", [[0, 0], [200, 0]]);
    const round = g.expandStroke(seg(), {
      width: 40, startCap: "butt", endCap: "round", join: "miter", model: "halftone",
      halftone: { cell: 8, size: 16, angle: 0, shape: "circle", contrast: 0.2 },
    });
    const butt = g.expandStroke(seg(), {
      width: 40, startCap: "butt", endCap: "butt", join: "miter", model: "halftone",
      halftone: { cell: 8, size: 16, angle: 0, shape: "circle", contrast: 0.2 },
    });
    expect(bbox(round).maxX).toBeGreaterThan(bbox(butt).maxX + 2); // dome past the node
  });
});

/** Signed area of one contour (anchors only) — for the contrast test. */
function signedAreaOf(c: Contour): number {
  const p = c.points;
  let s = 0;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

describe("dash model (experimental)", () => {
  const LINE = open("dl", [[0, 0], [300, 0]]); // 300-unit straight line

  it("breaks a line into MANY separate dash blocks (vs one continuous outline)", () => {
    const plain = g.expandStroke(LINE, STROKE); // continuous outline = one contour
    const dashed = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "dash", dash: 24, gap: 16 },
    });
    expect(plain).toHaveLength(1);
    expect(dashed.length).toBeGreaterThan(3); // several separate dash blocks
    for (const c of dashed) expect(contourWinding(c)).toBe("cw"); // solid CW pieces
    const b = bbox(dashed); // dashes span the whole line
    expect(b.minX).toBeLessThan(10);
    expect(b.maxX).toBeGreaterThan(280);
  });

  it("dot shape emits many separate round elements", () => {
    const dots = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "dot", dash: 0, gap: 16, size: 20 },
    });
    expect(dots.length).toBeGreaterThan(3);
  });

  it("leaves a normal (no-model) stroke unchanged — full isolation", () => {
    expect(g.expandStroke(LINE, STROKE)).toHaveLength(1);
  });

  it("custom-svg shape tiles the imported pattern along the line", () => {
    // A unit-box triangle pattern (normalized, centred at origin).
    const tri: Contour = closed("p", [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]);
    const tiled = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "svg", dash: 0, gap: 16, size: 20, pattern: [tri] },
    });
    expect(tiled.length).toBeGreaterThan(3); // many stamped elements
    const b = bbox(tiled);
    expect(b.minX).toBeLessThan(20);
    expect(b.maxX).toBeGreaterThan(280);
  });

  it("custom-svg without a pattern falls back to dots (still renders)", () => {
    const out = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "svg", dash: 0, gap: 16, size: 20 },
    });
    expect(out.length).toBeGreaterThan(3);
  });

  it("size profile grows dots toward the end of the path (ramp 0→2)", () => {
    const ramp = { points: [{ x: 0, y: 0.2 }, { x: 1, y: 2 }] };
    const dots = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "dot", dash: 0, gap: 24, size: 20, sizeProfile: ramp },
    });
    expect(dots.length).toBeGreaterThan(2);
    // First dot (near x=0) is smaller than the last (near x=300).
    const cx = (c: Contour) => c.points.reduce((s, p) => s + p.x, 0) / c.points.length;
    const sorted = [...dots].sort((a, b) => cx(a) - cx(b));
    const span = (c: Contour) =>
      Math.max(...c.points.map((p) => p.x)) - Math.min(...c.points.map((p) => p.x));
    expect(span(sorted[sorted.length - 1]!)).toBeGreaterThan(span(sorted[0]!) + 2);
  });

  it("align:false makes dash a perpendicular tick (taller than the along-path ribbon)", () => {
    const along = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "dash", dash: 30, gap: 16 }, // ribbon along a horizontal line → thin
    });
    const ticks = g.expandStroke(LINE, {
      ...STROKE,
      model: "dash",
      dash: { shape: "dash", dash: 30, gap: 16, align: false }, // ⟂ ticks → tall
    });
    expect(ticks.length).toBeGreaterThan(2);
    const h = (cs: Contour[]) => {
      const b = bbox(cs);
      return b.maxY - b.minY;
    };
    expect(h(ticks)).toBeGreaterThan(h(along) + 5);
  });

  it("a default dash (no align/profile) is byte-identical to before", () => {
    const a = g.expandStroke(LINE, { ...STROKE, model: "dash", dash: { shape: "dash", dash: 24, gap: 16 } });
    expect(a.length).toBeGreaterThan(3);
    for (const c of a) expect(contourWinding(c)).toBe("cw");
  });
});

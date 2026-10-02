import { describe, it, expect } from "vitest";
import { buildFillGroups, type FillLayer } from "./layerFills";
import { contourWinding } from "../../engine/geometry/path";
import { PolygonGeometryService } from "../../engine/geometry/PolygonGeometryService";
import type { GeometryService } from "../../engine/geometry/GeometryService";
import type { BooleanPair } from "../../types/document";
import type { Contour, StrokeStyle } from "../../types/geometry";

const geom = new PolygonGeometryService();

function poly(id: string, pts: [number, number][]): Contour {
  return {
    id,
    closed: true,
    points: pts.map(([x, y], i) => ({ id: `${id}_p${i}`, type: "corner" as const, x, y })),
  };
}

// OUTER is authored CCW (positive signed area in Y-up); INNER_CW is clockwise.
const OUTER = poly("outer", [[0, 0], [100, 0], [100, 100], [0, 100]]);
const INNER = poly("inner", [[25, 25], [75, 25], [75, 75], [25, 75]]);
const INNER_CW = poly("innercw", [[25, 25], [25, 75], [75, 75], [75, 25]]);

function pair(a: string, b: string, op: BooleanPair["op"]): BooleanPair {
  return { id: `${a}_${b}_${op}`, layerIds: [a, b], op };
}

describe("buildFillGroups", () => {
  it("keeps unpaired layers as separate fill groups", () => {
    const layers: FillLayer[] = [
      { id: "LA", contours: [OUTER] },
      { id: "LB", contours: [INNER] },
    ];
    const groups = buildFillGroups(layers, [], geom);
    expect(groups.map((g) => g.id)).toEqual(["LA", "LB"]);
  });

  it("renders a single layer as a SOLID union (all contours CW, no hole)", () => {
    // One layer with a CCW outer and a CW inner: under the old nesting rule the
    // inner would punch a hole; now a single layer is always solid.
    const groups = buildFillGroups([{ id: "LA", contours: [OUTER, INNER_CW] }], [], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.contours).toHaveLength(2);
    for (const c of groups[0]!.contours) {
      expect(contourWinding(c)).toBe("cw"); // both forced CW → solid under nonzero
    }
  });

  it("subtract combines two layers into one group at the lower z, A = upper layer", () => {
    // Stack bottom→top: INNER (lower, B), OUTER (upper, A). Subtract = A − B =
    // OUTER − INNER = a ring (outer CW + CCW hole).
    const layers: FillLayer[] = [
      { id: "LB", contours: [INNER] }, // lower
      { id: "LA", contours: [OUTER] }, // upper
    ];
    const p = pair("LA", "LB", "subtract");
    const groups = buildFillGroups(layers, [p], geom);

    expect(groups).toHaveLength(1); // both operands suppressed, one result
    expect(groups[0]!.id).toBe(p.id);
    expect(groups[0]!.contours).toHaveLength(2); // ring = outer + hole
    expect(contourWinding(groups[0]!.contours[0]!)).toBe("cw"); // outer
    expect(contourWinding(groups[0]!.contours[1]!)).toBe("ccw"); // hole
  });

  it("union of two fully-overlapping layers yields a single solid region", () => {
    const layers: FillLayer[] = [
      { id: "LB", contours: [INNER] },
      { id: "LA", contours: [OUTER] },
    ];
    const groups = buildFillGroups(layers, [pair("LA", "LB", "union")], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.contours).toHaveLength(1); // INNER ⊂ OUTER → just OUTER
    expect(contourWinding(groups[0]!.contours[0]!)).toBe("cw");
  });

  it("renders a baked layer verbatim — winding preserved, no force-CW", () => {
    // A baked (merged) layer carries FINAL geometry that may include a CCW hole;
    // it must be rendered as-is (force-CW would fill the hole). Here a CW outer +
    // CCW hole must survive unchanged.
    const baked = [INNER_CW, INNER]; // CW outer, CCW "hole" — authored windings
    const groups = buildFillGroups([{ id: "M", contours: baked, baked: true }], [], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.contours).toBe(baked); // returned verbatim, not rebuilt
    expect(contourWinding(groups[0]!.contours[0]!)).toBe("cw");
    expect(contourWinding(groups[0]!.contours[1]!)).toBe("ccw"); // hole NOT force-CW'd
  });

  it("baked is per CONTOUR: imported art stays verbatim, a path drawn later on its layer renders normally", () => {
    // The layer-level flag this replaced rendered EVERYTHING on an imported/merged layer
    // verbatim — so a stroke drawn there after an import came out as a filled centerline.
    const stroke: StrokeStyle = { width: 10, startCap: "butt", endCap: "butt", join: "miter" };
    const line: Contour = { ...poly("line", [[0, 200], [100, 200]]), closed: false, stroke };
    const outer = { ...INNER_CW, baked: true };
    const hole = { ...INNER, baked: true };
    const [g] = buildFillGroups([{ id: "L", contours: [outer, hole, line] }], [], geom);
    expect(g!.contours[0]).toBe(outer); // verbatim — the CCW hole keeps its winding
    expect(g!.contours[1]).toBe(hole);
    const drawn = g!.contours.slice(2);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn).not.toContain(line); // expanded to an outline, not the raw centerline
    expect(drawn.every((c) => c.closed)).toBe(true);
  });

  it("does not mutate the input contours (non-destructive)", () => {
    const inner = poly("inner2", [[25, 25], [75, 25], [75, 75], [25, 75]]);
    const snapshot = JSON.stringify(inner);
    buildFillGroups(
      [
        { id: "LB", contours: [inner] },
        { id: "LA", contours: [OUTER] },
      ],
      [pair("LA", "LB", "subtract")],
      geom,
    );
    expect(JSON.stringify(inner)).toBe(snapshot);
  });

  it("no-paint layer is ONE group with the bare layer id and no paint (unchanged)", () => {
    const groups = buildFillGroups([{ id: "LA", contours: [OUTER, INNER] }], [], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("LA");
    expect(groups[0]!.paint).toBeUndefined();
    expect(groups[0]!.contours).toHaveLength(2); // both contours, as before
  });

  it("splits a layer's contours into separate fill groups by paint", () => {
    const red = { ...poly("red", [[0, 0], [10, 0], [10, 10], [0, 10]]), paint: { fill: "#ff0000" } };
    const groups = buildFillGroups([{ id: "LA", contours: [OUTER, red] }], [], geom);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.id).toBe("LA"); // the default (black) group keeps the bare id
    expect(groups[0]!.paint).toBeUndefined();
    expect(groups[1]!.paint).toEqual({ fill: "#ff0000" }); // the coloured group
  });

  it("a boolean-pair result inherits the upper operand's (A's) paint", () => {
    // OUTER (upper, A) is coloured; the subtract result should carry that colour
    // instead of reverting to default black.
    const outerRed = { ...OUTER, paint: { fill: "#ff0000" } };
    const layers: FillLayer[] = [
      { id: "LB", contours: [INNER] }, // lower, default ink
      { id: "LA", contours: [outerRed] }, // upper, red
    ];
    const groups = buildFillGroups([...layers], [pair("LA", "LB", "subtract")], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.paint).toEqual({ fill: "#ff0000" });
  });

  it("a boolean-pair result falls back to the lower operand's (B's) paint", () => {
    // Upper (A) is default ink; lower (B) is blue → result inherits B's colour.
    const innerBlue = { ...INNER, paint: { fill: "#0000ff" } };
    const layers: FillLayer[] = [
      { id: "LB", contours: [innerBlue] }, // lower, blue
      { id: "LA", contours: [OUTER] }, // upper, default ink
    ];
    const groups = buildFillGroups([...layers], [pair("LA", "LB", "subtract")], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.paint).toEqual({ fill: "#0000ff" });
  });

  it("an all-default boolean pair stays paint-less (default black, unchanged)", () => {
    const layers: FillLayer[] = [
      { id: "LB", contours: [INNER] },
      { id: "LA", contours: [OUTER] },
    ];
    const groups = buildFillGroups([...layers], [pair("LA", "LB", "subtract")], geom);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.paint).toBeUndefined();
  });
});

// --- mergeHalftones grouping (Stage 2) — uses a stub geom to observe routing ---

const htStroke = (cell: number): StrokeStyle => ({
  width: 40,
  startCap: "butt",
  endCap: "butt",
  join: "miter",
  model: "halftone",
  halftone: { cell, size: 8, angle: 0, shape: "circle", contrast: 0.5 },
});
const htLine = (id: string, cell = 10): Contour => ({
  id,
  closed: false,
  points: [
    { id: `${id}a`, type: "corner", x: 0, y: 0 },
    { id: `${id}b`, type: "corner", x: 100, y: 0 },
  ],
  stroke: htStroke(cell),
});

/** Records how the fill builder routed each contour: per-path expandStroke vs the
 *  combined expandHalftoneGroup. */
class StubGeom implements GeometryService {
  groupCalls: Contour[][] = [];
  strokeCalls: Contour[] = [];
  union = (): Contour[] => [];
  subtract = (): Contour[] => [];
  intersect = (): Contour[] => [];
  exclude = (): Contour[] => [];
  correctWinding = (c: Contour[]): Contour[] => c;
  expandStroke = (c: Contour): Contour[] => {
    this.strokeCalls.push(c);
    return [{ ...c, id: `stroke-${c.id}` }];
  };
  expandHalftoneGroup = (cs: Contour[]): Contour[] => {
    this.groupCalls.push(cs);
    return [{ ...cs[0]!, id: `htgroup-${this.groupCalls.length}` }];
  };
}

describe("buildFillGroups — mergeHalftones", () => {
  it("flag OFF: each halftone path expands on its own (no combining)", () => {
    const g = new StubGeom();
    buildFillGroups([{ id: "L", contours: [htLine("h1"), htLine("h2")] }], [], g, { mergeHalftones: false });
    expect(g.groupCalls).toHaveLength(0);
    expect(g.strokeCalls).toHaveLength(2);
  });

  it("flag ON: two identical-style halftone paths render as ONE combined group", () => {
    const g = new StubGeom();
    const groups = buildFillGroups([{ id: "L", contours: [htLine("h1"), htLine("h2")] }], [], g, { mergeHalftones: true });
    expect(g.groupCalls).toHaveLength(1);
    expect(g.groupCalls[0]).toHaveLength(2); // both contours merged
    expect(g.strokeCalls).toHaveLength(0); // neither went through per-path expand
    expect(groups).toHaveLength(1); // one fill group for the combined dots
  });

  it("flag ON: different halftone styles do NOT merge", () => {
    const g = new StubGeom();
    buildFillGroups([{ id: "L", contours: [htLine("h1", 10), htLine("h2", 20)] }], [], g, { mergeHalftones: true });
    expect(g.groupCalls).toHaveLength(0); // two buckets of size 1 → no combine
    expect(g.strokeCalls).toHaveLength(2); // each falls back to per-path expand
  });

  it("flag ON: a lone halftone path falls back to per-path expand", () => {
    const g = new StubGeom();
    buildFillGroups([{ id: "L", contours: [htLine("h1")] }], [], g, { mergeHalftones: true });
    expect(g.groupCalls).toHaveLength(0);
    expect(g.strokeCalls).toHaveLength(1);
  });

  it("flag ON never changes the look: dots keep the STROKE colour, filled interiors stay", () => {
    // Red-stroke / blue-fill halftone squares. Merging used to paint the dots with the
    // fill colour (blue) and drop the interiors.
    const sq = (id: string, dx: number): Contour => ({
      ...poly(id, [[dx, 0], [dx + 100, 0], [dx + 100, 100], [dx, 100]]),
      stroke: { ...htStroke(10), color: "#ff0000" },
      paint: { fill: "#0000ff" },
      filled: true,
    });
    const paints = (merge: boolean) =>
      buildFillGroups([{ id: "L", contours: [sq("a", 0), sq("b", 80)] }], [], new StubGeom(), {
        mergeHalftones: merge,
      }).map((grp) => [grp.paint?.fill, grp.contours.length]);
    const off = paints(false);
    const on = paints(true);
    expect(off).toContainEqual(["#0000ff", 2]); // both interiors
    expect(on).toContainEqual(["#0000ff", 2]); // …still there when merged
    expect(on).toContainEqual(["#ff0000", 1]); // the ONE combined tone, in the stroke colour
    expect(on.some(([fill]) => fill === "#ff0000")).toBe(true);
  });

  it("flag ON: paths whose stroke colours differ are not merged into one tone", () => {
    const g = new StubGeom();
    const a = { ...htLine("h1"), stroke: { ...htStroke(10), color: "#ff0000" } };
    const b = { ...htLine("h2"), stroke: { ...htStroke(10), color: "#00ff00" } };
    buildFillGroups([{ id: "L", contours: [a, b] }], [], g, { mergeHalftones: true });
    expect(g.groupCalls).toHaveLength(0);
  });
});

describe("buildFillGroups — independent fill & stroke", () => {
  const box = (id: string): Contour => poly(id, [[0, 0], [100, 0], [100, 100], [0, 100]]);
  const STROKE = (color?: string): StrokeStyle => ({
    width: 10,
    startCap: "butt",
    endCap: "butt",
    join: "miter",
    ...(color ? { color } : {}),
  });

  it("legacy: an unstroked closed path fills its interior (one group, no stroke call)", () => {
    const g = new StubGeom();
    const groups = buildFillGroups([{ id: "L", contours: [box("p")] }], [], g);
    expect(g.strokeCalls).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.contours.map((c) => c.id)).toEqual(["p"]); // the interior itself
  });

  it("legacy: a stroked closed path is OUTLINE-ONLY (no interior fill)", () => {
    const g = new StubGeom();
    const c: Contour = { ...box("ls"), stroke: STROKE(), paint: { fill: "#00aa00" } };
    const groups = buildFillGroups([{ id: "L", contours: [c] }], [], g);
    expect(g.strokeCalls).toHaveLength(1);
    expect(groups).toHaveLength(1);
    // Only the expanded outline (the `stroke-` id), NOT the original interior contour.
    expect(groups[0]!.contours.map((x) => x.id)).toEqual(["stroke-ls"]);
    expect(groups[0]!.paint?.fill).toBe("#00aa00"); // outline keeps the legacy paint colour
  });

  it("filled:true + stroke → BOTH an interior fill group and an outline group, distinct colours", () => {
    const g = new StubGeom();
    const c: Contour = {
      ...box("sf"),
      filled: true,
      paint: { fill: "#ff0000" },
      stroke: STROKE("#0000ff"),
    };
    const groups = buildFillGroups([{ id: "L", contours: [c] }], [], g);
    expect(groups).toHaveLength(2);
    const fills = groups.map((gr) => gr.paint?.fill).sort();
    expect(fills).toEqual(["#0000ff", "#ff0000"]); // interior red + outline blue
    // The interior is the original contour; the outline is the expanded one.
    const ids = groups.flatMap((gr) => gr.contours.map((x) => x.id)).sort();
    expect(ids).toEqual(["sf", "stroke-sf"]);
  });

  it("filled:false on an unstroked closed path emits nothing", () => {
    const g = new StubGeom();
    const groups = buildFillGroups([{ id: "L", contours: [{ ...box("e"), filled: false }] }], [], g);
    expect(groups).toHaveLength(0);
  });
});

describe("buildFillGroups — stroke gradient", () => {
  const line = (id: string, pts: [number, number][]): Contour => ({
    id,
    closed: false,
    points: pts.map(([x, y], i) => ({ id: `${id}_p${i}`, type: "corner" as const, x, y })),
  });
  const STROKE = (extra: Partial<StrokeStyle> = {}): StrokeStyle => ({
    width: 10,
    startCap: "butt",
    endCap: "butt",
    join: "miter",
    ...extra,
  });

  it("carries a fixed-angle gradient onto the outline group (first stop = stroke colour)", () => {
    const g = new StubGeom();
    const c: Contour = {
      ...line("s", [[0, 0], [100, 0]]),
      stroke: STROKE({ color: "#ff0000", gradient: { angle: 45, to: "#0000ff", midpoint: 0.5, fade: 1 } }),
    };
    const groups = buildFillGroups([{ id: "L", contours: [c] }], [], g);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.paint?.fill).toBe("#ff0000");
    expect(groups[0]!.paint?.gradient?.angle).toBe(45);
    expect(groups[0]!.paint?.gradient?.to).toBe("#0000ff");
  });

  it("along-path replaces the angle with the start→end direction", () => {
    const g = new StubGeom();
    const vert: Contour = {
      ...line("v", [[0, 0], [0, 100]]),
      stroke: STROKE({ gradient: { angle: 0, to: "#ffffff", midpoint: 0.5, fade: 1, alongPath: true } }),
    };
    const groups = buildFillGroups([{ id: "L", contours: [vert] }], [], g);
    expect(groups[0]!.paint?.gradient?.angle).toBe(90); // atan2(Δy=100, Δx=0) = 90°
    expect(groups[0]!.paint?.gradient?.alongPath).toBe(true);
  });
});

describe("buildFillGroups — blend (5th op)", () => {
  const blendPair = (a: string, b: string, steps: number): BooleanPair => ({
    id: `${a}_${b}_blend`,
    layerIds: [a, b],
    op: "blend",
    steps,
  });

  it("matched-topology layers → one solid group per step (steps + 2)", () => {
    const sqA = poly("a", [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const sqB = poly("b", [[100, 0], [110, 0], [110, 10], [100, 10]]); // same 4-pt structure
    const layers: FillLayer[] = [
      { id: "LB", contours: [sqB] }, // lower
      { id: "LA", contours: [sqA] }, // upper
    ];
    const groups = buildFillGroups([...layers], [blendPair("LA", "LB", 2)], geom);
    expect(groups).toHaveLength(4); // B + 2 in-between steps + A
    // The two ends ARE the operand layers (rendered as themselves); only the middles blend.
    expect(groups.map((g) => g.id)).toEqual(["LB", "LA_LB_blend#b1", "LA_LB_blend#b2", "LA"]);
    // Every step is a solid (forced CW) fill.
    for (const grp of groups) expect(contourWinding(grp.contours[0]!)).toBe("cw");
  });

  it("in-between steps take operand A's paint; each operand keeps its own", () => {
    const sqA = { ...poly("a", [[0, 0], [10, 0], [10, 10], [0, 10]]), paint: { fill: "#ff0000" } };
    const sqB = { ...poly("b", [[100, 0], [110, 0], [110, 10], [100, 10]]), paint: { fill: "#0000ff" } };
    const groups = buildFillGroups(
      [{ id: "LB", contours: [sqB] }, { id: "LA", contours: [sqA] }],
      [blendPair("LA", "LB", 2)],
      geom,
    );
    // Pairing must not restyle an operand: B stays blue (it used to be painted A's red —
    // or black when A had no paint). The echo between them reads in A's colour.
    expect(groups.map((g) => g.paint?.fill)).toEqual(["#0000ff", "#ff0000", "#ff0000", "#ff0000"]);
  });

  it("in-between steps keep a baked operand's holes (verbatim, not forced CW)", () => {
    // An imported/merged ring: CW outer + CCW counter, both baked.
    const ring = (id: string, dx: number): Contour[] => [
      { ...poly(`${id}o`, [[dx, 0], [dx, 100], [dx + 100, 100], [dx + 100, 0]]), baked: true },
      { ...poly(`${id}h`, [[dx + 30, 30], [dx + 70, 30], [dx + 70, 70], [dx + 30, 70]]), baked: true },
    ];
    const groups = buildFillGroups(
      [{ id: "LB", contours: ring("b", 200) }, { id: "LA", contours: ring("a", 0) }],
      [blendPair("LA", "LB", 1)],
      geom,
    );
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.contours.map(contourWinding)).toEqual(["cw", "ccw"]); // the counter survives
    }
  });

  it("in-between steps keep an interior fill (`filled`) alongside the stroke", () => {
    const stroke = { width: 4, startCap: "butt" as const, endCap: "butt" as const, join: "miter" as const };
    const sq = (id: string, dx: number): Contour => ({
      ...poly(id, [[dx, 0], [dx + 50, 0], [dx + 50, 50], [dx, 50]]),
      stroke,
      filled: true,
    });
    const groups = buildFillGroups(
      [{ id: "LB", contours: [sq("b", 200)] }, { id: "LA", contours: [sq("a", 0)] }],
      [blendPair("LA", "LB", 1)],
      geom,
    );
    const counts = groups.map((g) => g.contours.length);
    expect(counts[1]).toBe(counts[0]); // the step renders interior + outline, like the operands
  });

  it("stroked blend paths expand per step (honours outlined paths)", () => {
    const g = new StubGeom();
    const stroke = { width: 8, startCap: "butt" as const, endCap: "butt" as const, join: "miter" as const };
    const sqA = { ...poly("a", [[0, 0], [10, 0], [10, 10], [0, 10]]), stroke };
    const sqB = { ...poly("b", [[100, 0], [110, 0], [110, 10], [100, 10]]), stroke };
    buildFillGroups(
      [{ id: "LB", contours: [sqB] }, { id: "LA", contours: [sqA] }],
      [blendPair("LA", "LB", 2)],
      g,
    );
    // Each of the steps+2 steps carries the stroke ⇒ expandStroke runs once per step.
    expect(g.strokeCalls).toHaveLength(4);
  });

  it("morphs every path of a multi-path layer (matched topology)", () => {
    const a1 = poly("a1", [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const a2 = poly("a2", [[20, 0], [30, 0], [30, 10], [20, 10]]);
    const b1 = poly("b1", [[100, 0], [110, 0], [110, 10], [100, 10]]);
    const b2 = poly("b2", [[120, 0], [130, 0], [130, 10], [120, 10]]);
    const groups = buildFillGroups(
      [{ id: "LB", contours: [b1, b2] }, { id: "LA", contours: [a1, a2] }],
      [blendPair("LA", "LB", 1)],
      geom,
    );
    expect(groups).toHaveLength(3); // 1 + 2 endpoints
    for (const grp of groups) expect(grp.contours).toHaveLength(2); // both paths morphed
  });

  it("differing shapes (point counts) now morph via resampling — not a fallback", () => {
    const sq = poly("a", [[0, 0], [40, 0], [40, 40], [0, 40]]); // 4 points
    const tri = poly("t", [[100, 0], [140, 0], [120, 40]]); // 3 points
    const groups = buildFillGroups(
      [{ id: "LB", contours: [tri] }, { id: "LA", contours: [sq] }],
      [blendPair("LA", "LB", 3)],
      geom,
    );
    expect(groups).toHaveLength(5); // B + 3 resampled in-between steps + A
    expect(groups.slice(1, -1).every((g) => g.id.includes("#b"))).toBe(true);
  });

  it("falls back to the operands only when a layer is empty (nothing to blend)", () => {
    const sq = poly("a", [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const groups = buildFillGroups(
      [{ id: "LB", contours: [] }, { id: "LA", contours: [sq] }],
      [blendPair("LA", "LB", 2)],
      geom,
    );
    expect(groups.map((g) => g.id)).toEqual(["LA"]); // LB empty → only the non-empty operand
  });
});

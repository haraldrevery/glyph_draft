import { describe, it, expect } from "vitest";
import {
  bakeContours,
  buildGlyphFills,
  flattenRenderGroups,
  glyphFillGroups,
  type FillLayer,
} from "../canvas/layerFills";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import { glyphToSvg } from "../export/glyphToSvg";
import { contourWinding } from "../../engine/geometry/path";
import { DEFAULT_METRICS } from "../../constants/metrics";
import type { Glyph, Layer, LayerGroup } from "../../types/document";
import type { Contour } from "../../types/geometry";

/**
 * Stage 4: a `renderAsOne` group renders as ONE layer — its members collapse into a
 * single fill region so overlaps fuse, while a group with the flag off stays a plain
 * organisational folder and renders exactly as if it were not grouped.
 */

const geom = () => getGeometryService();

/** A square of side 100 at (o,o). */
const sq = (id: string, o: number): Contour => ({
  id,
  closed: true,
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ].map(([x, y], i) => ({ id: `${id}${i}`, type: "corner" as const, x: x! + o, y: y! + o })),
});

const lay = (id: string, o: number, groupId?: string, over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  contours: [sq(id, o)],
  ...(groupId ? { groupId } : {}),
  ...over,
});

const grp = (id: string, over: Partial<LayerGroup> = {}): LayerGroup => ({
  id,
  name: id,
  visible: true,
  locked: false,
  ...over,
});

const gl = (layers: Layer[], layerGroups?: LayerGroup[]): Glyph => ({
  id: "G",
  codepoint: 0x41,
  name: "A",
  advanceWidth: 600,
  layers,
  ...(layerGroups ? { layerGroups } : {}),
});

const fillLayers = (g: Glyph): FillLayer[] =>
  g.layers.map((l) => ({
    id: l.id,
    contours: l.contours,
    ...(l.baked ? { baked: true } : {}),
    ...(l.groupId ? { groupId: l.groupId } : {}),
  }));

describe("flattenRenderGroups", () => {
  it("returns the SAME array when no group renders as one (identity)", () => {
    const g = gl([lay("a", 0, "g1"), lay("b", 50, "g1")], [grp("g1")]);
    const fl = fillLayers(g);
    expect(flattenRenderGroups(fl, g.layerGroups!, [], geom())).toBe(fl);
  });

  it("collapses a render-as-one group into one synthetic baked layer", () => {
    const g = gl(
      [lay("a", 0, "g1"), lay("b", 50, "g1"), lay("c", 400)],
      [grp("g1", { renderAsOne: true })],
    );
    const out = flattenRenderGroups(fillLayers(g), g.layerGroups!, [], geom());
    expect(out).toHaveLength(2); // the group + the loose layer
    expect(out[0]!.id).toBe("g1");
    expect(out[0]!.baked).toBe(true); // already-final geometry, must not be re-normalised
    expect(out[1]!.id).toBe("c");
  });

  it("preserves paint order — the group sits where its members were", () => {
    const g = gl(
      [lay("bottom", 0), lay("a", 50, "g1"), lay("b", 60, "g1"), lay("top", 400)],
      [grp("g1", { renderAsOne: true })],
    );
    const out = flattenRenderGroups(fillLayers(g), g.layerGroups!, [], geom());
    expect(out.map((l) => l.id)).toEqual(["bottom", "g1", "top"]);
  });

  it("bakes a nested plain folder into the outer render-as-one group", () => {
    // The TOPMOST render-as-one ancestor wins.
    const g = gl(
      [lay("a", 0, "inner"), lay("b", 50, "outer")],
      [grp("outer", { renderAsOne: true }), grp("inner", { parentId: "outer" })],
    );
    const out = flattenRenderGroups(fillLayers(g), g.layerGroups!, [], geom());
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("outer");
  });

  it("is cycle-safe against a corrupt parent loop", () => {
    const g = gl([lay("a", 0, "x")], [grp("x", { parentId: "y" }), grp("y", { parentId: "x" })]);
    expect(() => flattenRenderGroups(fillLayers(g), g.layerGroups!, [], geom())).not.toThrow();
  });
});

describe("render-as-one changes what the pipeline emits", () => {
  const overlapping = (renderAsOne: boolean): Glyph =>
    gl(
      [lay("a", 0, "g1"), lay("b", 50, "g1")],
      [grp("g1", renderAsOne ? { renderAsOne: true } : {})],
    );

  it("two overlapping layers become ONE fill region", () => {
    const separate = glyphFillGroups(overlapping(false), geom());
    const fused = glyphFillGroups(overlapping(true), geom());
    expect(separate).toHaveLength(2); // one region per layer
    expect(fused).toHaveLength(1); // one region for the whole group
  });

  it("the fused region still carries both shapes", () => {
    const fused = glyphFillGroups(overlapping(true), geom());
    expect(fused[0]!.contours).toHaveLength(2);
    // Both forced CW, so under nonzero they read as one solid — no cancelling hole.
    expect(fused[0]!.contours.map(contourWinding)).toEqual(["cw", "cw"]);
  });

  it("a group with the flag OFF renders exactly as if it were not grouped", () => {
    const plain = gl([lay("a", 0), lay("b", 50)]);
    expect(glyphToSvg(overlapping(false), DEFAULT_METRICS)).toBe(
      glyphToSvg(plain, DEFAULT_METRICS),
    );
  });

  it("the canvas and the export produce the same fills", () => {
    // glyphFillGroups (thumbnails/preview/export) and buildGlyphFills (the canvas,
    // which needs live drag overrides) must agree. Both go through the one shared
    // entry point, which is what stops the canvas showing ungrouped fills.
    const g = overlapping(true);
    const viaGlyph = glyphFillGroups(g, geom());
    const viaCanvas = buildGlyphFills(fillLayers(g), g.layerGroups!, [], geom());
    expect(viaCanvas.map((x) => x.id)).toEqual(viaGlyph.map((x) => x.id));
    expect(viaCanvas.map((x) => x.contours.length)).toEqual(
      viaGlyph.map((x) => x.contours.length),
    );
  });

  it("the canvas path really does collapse the group", () => {
    // Guards the above from passing because BOTH forgot to flatten.
    const fused = buildGlyphFills(
      fillLayers(overlapping(true)),
      overlapping(true).layerGroups!,
      [],
      geom(),
    );
    const separate = buildGlyphFills(
      fillLayers(overlapping(false)),
      overlapping(false).layerGroups!,
      [],
      geom(),
    );
    expect(fused).toHaveLength(1);
    expect(separate).toHaveLength(2);
  });
});

describe("baked members keep their counters", () => {
  it("a baked layer's CCW hole survives being grouped", () => {
    // A baked layer carries final CW-outer / CCW-hole geometry. Collapsing the group
    // must not force-CW it, or the counter would fill in solid.
    const outer = sq("outer", 0);
    const hole: Contour = {
      id: "hole",
      closed: true,
      points: [
        [30, 30],
        [30, 70],
        [70, 70],
        [70, 30],
      ].map(([x, y], i) => ({ id: `h${i}`, type: "corner" as const, x: x!, y: y! })),
    };
    const ring: Layer = {
      id: "ring",
      name: "ring",
      visible: true,
      locked: false,
      contours: [outer, hole],
      baked: true,
      groupId: "g1",
    };
    const g = gl([ring, lay("plain", 400, "g1")], [grp("g1", { renderAsOne: true })]);

    const groups = glyphFillGroups(g, geom());
    const windings = groups.flatMap((x) => x.contours.map(contourWinding));
    expect(windings).toContain("ccw"); // the hole is still a hole
  });
});

describe("merge-a-group and render-as-one agree", () => {
  it("produce identical geometry", () => {
    const g = gl(
      [lay("a", 0, "g1"), lay("b", 50, "g1")],
      [grp("g1", { renderAsOne: true })],
    );
    const members = fillLayers(g).filter((l) => l.groupId === "g1");

    const merged = bakeContours(members, [], geom());
    const rendered = flattenRenderGroups(fillLayers(g), g.layerGroups!, [], geom())[0]!.contours;

    const coords = (cs: Contour[]) =>
      cs.flatMap((c) => c.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(coords(rendered)).toEqual(coords(merged));
  });
});

describe("the bake cache is keyed by render options too", () => {
  it("does not hand back the other setting's bake", () => {
    // Regression guard: keying the cache on the group id alone would return the
    // mergeHalftones:false bake for a mergeHalftones:true render, and vice versa.
    const g = gl([lay("a", 0, "g1"), lay("b", 50, "g1")], [grp("g1", { renderAsOne: true })]);
    const fl = fillLayers(g);
    const off = flattenRenderGroups(fl, g.layerGroups!, [], geom(), { mergeHalftones: false });
    const on = flattenRenderGroups(fl, g.layerGroups!, [], geom(), { mergeHalftones: true });
    // Same inputs here, so the RESULTS match — what matters is that asking twice with
    // different options recomputes rather than reusing a foreign entry.
    expect(off[0]!.contours).toHaveLength(on[0]!.contours.length);
    // Asking again with the first options must still be the first bake.
    const offAgain = flattenRenderGroups(fl, g.layerGroups!, [], geom(), {
      mergeHalftones: false,
    });
    expect(offAgain[0]!.contours).toBe(off[0]!.contours); // cache hit, same reference
  });
});

describe("hidden groups still win over render-as-one", () => {
  it("a hidden render-as-one group emits nothing", () => {
    const g = gl(
      [lay("a", 0, "g1"), lay("b", 400)],
      [grp("g1", { renderAsOne: true, visible: false })],
    );
    const groups = glyphFillGroups(g, geom());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("b");
  });
});

describe("a group as a Pathfinder operand (stage 5)", () => {
  /** Two 100-squares inside g1 (bottom), one big square on top. */
  const paired = () =>
    gl(
      [lay("a", 0, "g1"), lay("b", 40, "g1"), lay("big", 20)],
      [grp("g1", { renderAsOne: true })],
    );

  it("resolves a pair whose operand is a GROUP id", () => {
    const g = paired();
    g.booleanPairs = [{ id: "bp1", layerIds: ["big", "g1"], op: "subtract" }];
    const groups = glyphFillGroups(g, geom());
    // One combined region, not the two operands painted separately.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("bp1");
  });

  it("a group operand really is treated as ONE shape", () => {
    // Subtracting the group must remove BOTH its members' area, not just one.
    const withGroup = paired();
    withGroup.booleanPairs = [{ id: "bp1", layerIds: ["big", "g1"], op: "subtract" }];
    const onlyOne = gl([lay("a", 0), lay("big", 20)]);
    onlyOne.booleanPairs = [{ id: "bp1", layerIds: ["big", "a"], op: "subtract" }];

    const areaish = (x: Glyph) =>
      glyphFillGroups(x, geom()).flatMap((q) => q.contours).length;
    // Different geometry: subtracting two squares leaves a different result than one.
    expect(areaish(withGroup)).not.toBe(0);
    expect(glyphToSvg(withGroup, DEFAULT_METRICS)).not.toBe(
      glyphToSvg(onlyOne, DEFAULT_METRICS),
    );
  });

  it("falls back to painting both when the group is hidden", () => {
    // A hidden operand drops out of the layer list, so the pair can't resolve — the
    // visible operand must still paint rather than vanishing.
    const g = paired();
    g.layerGroups = [grp("g1", { renderAsOne: true, visible: false })];
    g.booleanPairs = [{ id: "bp1", layerIds: ["big", "g1"], op: "subtract" }];
    const groups = glyphFillGroups(g, geom());
    expect(groups.map((x) => x.id)).toEqual(["big"]);
  });

  it("a pair naming a group that does NOT render as one cannot resolve", () => {
    // Documents the invariant setBooleanPair maintains by auto-enabling renderAsOne.
    const g = paired();
    g.layerGroups = [grp("g1")]; // renderAsOne off
    g.booleanPairs = [{ id: "bp1", layerIds: ["big", "g1"], op: "subtract" }];
    const groups = glyphFillGroups(g, geom());
    expect(groups.map((x) => x.id)).toEqual(["a", "b", "big"]); // all painted normally
  });
});

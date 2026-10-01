import { describe, it, expect } from "vitest";
import { migrate } from "./projectFile";
import { sanitizeGlyph } from "./sanitize";
import { glyphFillGroups } from "../features/canvas/layerFills";
import { PaperGeometryService } from "../engine/geometry/PaperGeometryService";
import type { Glyph } from "../types/document";

/**
 * The load-time repair pass. Regression guard for the crash-loop: these documents
 * all passed the old shallow check, then threw on EVERY render — and since the
 * document autosaves, again after every reload.
 */

const geom = new PaperGeometryService();

const sq = (id: string) => ({
  id,
  closed: true,
  points: [
    { id: `${id}a`, type: "corner", x: 0, y: 0 },
    { id: `${id}b`, type: "corner", x: 0, y: 100 },
    { id: `${id}c`, type: "corner", x: 100, y: 100 },
    { id: `${id}d`, type: "corner", x: 100, y: 0 },
  ],
});

function healthy(): Glyph {
  return {
    id: "g",
    codepoint: 0x41,
    name: "A",
    advanceWidth: 600,
    layers: [
      { id: "l1", name: "L1", visible: true, locked: false, contours: [sq("c1") as never] },
      { id: "l2", name: "L2", visible: true, locked: false, contours: [sq("c2") as never], groupId: "G" },
    ],
    booleanPairs: [{ id: "p", layerIds: ["l1", "l2"], op: "subtract" }],
    layerGroups: [{ id: "G", name: "G", visible: true, locked: false }],
  };
}

const load = (g: unknown, key = "g") => migrate({ version: 8, savedAt: 0, glyphs: { [key]: g } });

describe("sanitizeGlyph", () => {
  it("returns a healthy glyph as the SAME object (and the doc map too)", () => {
    const g = healthy();
    expect(sanitizeGlyph("g", g)).toBe(g);
    const map = { g };
    expect(migrate({ version: 8, savedAt: 0, glyphs: map })).toBe(map);
  });

  it("a layer without `contours` loads (empty) instead of crashing the renderer", () => {
    const g = healthy() as unknown as { layers: Record<string, unknown>[] };
    delete g.layers[0]!.contours;
    const out = load(g)!.g!;
    expect(out.layers[0]!.contours).toEqual([]);
    expect(() => glyphFillGroups(out, geom)).not.toThrow();
  });

  it("drops a pair with an op the engine doesn't know (used to throw `geom[op] is not a function`)", () => {
    const g = healthy();
    g.booleanPairs = [{ id: "p", layerIds: ["l1", "l2"], op: "xor" as never }];
    const out = load(g)!.g!;
    expect(out.booleanPairs).toEqual([]);
    expect(() => glyphFillGroups(out, geom)).not.toThrow();
  });

  it("drops points without finite coordinates (NaN round-trips through JSON as null)", () => {
    const g = healthy() as unknown as { layers: { contours: { points: unknown[] }[] }[] };
    g.layers[0]!.contours[0]!.points.push({ id: "bad", type: "corner", x: null, y: 5 });
    const out = load(g)!.g!;
    expect(out.layers[0]!.contours[0]!.points.map((p) => p.id)).toEqual(["c1a", "c1b", "c1c", "c1d"]);
  });

  it("removes a malformed handle but keeps its point", () => {
    const g = healthy() as unknown as { layers: { contours: { points: Record<string, unknown>[] }[] }[] };
    g.layers[0]!.contours[0]!.points[0]!.handleOut = { x: null, y: 1 };
    const p = load(g)!.g!.layers[0]!.contours[0]!.points[0]!;
    expect(p.id).toBe("c1a");
    expect(p.handleOut).toBeUndefined();
  });

  it("drops a stroke with a non-finite width, keeping the path", () => {
    const g = healthy() as unknown as { layers: { contours: Record<string, unknown>[] }[] };
    g.layers[0]!.contours[0]!.stroke = { width: null, startCap: "round", endCap: "round", join: "round" };
    const c = load(g)!.g!.layers[0]!.contours[0]!;
    expect(c.id).toBe("c1");
    expect(c.stroke).toBeUndefined();
  });

  it("defaults mis-typed layer flags instead of hiding the layer", () => {
    const g = healthy() as unknown as { layers: Record<string, unknown>[] };
    delete g.layers[0]!.visible;
    g.layers[0]!.locked = "no";
    const l = load(g)!.g!.layers[0]!;
    expect(l.visible).toBe(true);
    expect(l.locked).toBe(false);
  });

  it("gives a layerless glyph one empty layer", () => {
    const g = healthy();
    g.layers = [];
    expect(load(g)!.g!.layers).toHaveLength(1);
  });

  it("drops non-array booleanPairs / layerGroups", () => {
    const g = healthy() as unknown as Record<string, unknown>;
    g.booleanPairs = "nope";
    g.layerGroups = { a: 1 };
    const out = load(g)!.g!;
    expect(out.booleanPairs).toBeUndefined();
    expect(out.layerGroups).toBeUndefined();
  });

  it("re-keys a glyph whose id disagrees with its map key (else it can't be selected)", () => {
    const out = load(healthy(), "other")!;
    expect(out.other!.id).toBe("other");
  });

  it("repairs a bad advance width", () => {
    const g = healthy();
    g.advanceWidth = -5;
    expect(load(g)!.g!.advanceWidth).toBeGreaterThan(0);
  });

  it("still REJECTS a document whose glyphs aren't glyphs at all", () => {
    expect(load({ id: "g", layers: [] })).toBeNull(); // no codepoint
    expect(load({ id: "g", codepoint: Number.NaN, layers: [] })).toBeNull();
  });
});

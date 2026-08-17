import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "../../state/documentStore";
import { useHistoryStore } from "../../state/history";
import { useEditorStore } from "../../state/editorStore";
import { canExpandStrokes, expandSelectedStrokes } from "./editActions";
import type { Glyph, Layer } from "../../types/document";
import type { Contour, StrokeStyle } from "../../types/geometry";

/**
 * "Expand stroke": replace a selected stroked path with its filled outline (the
 * same geometry buildFillGroups renders) on a new BAKED layer, consuming the
 * original. Runs the live Paper engine headless, like the other glue tests.
 */

const STROKE: StrokeStyle = { width: 20, startCap: "butt", endCap: "butt", join: "miter" };

function square(id: string, stroke?: StrokeStyle): Contour {
  const pts: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const c: Contour = {
    id,
    closed: true,
    points: pts.map(([x, y], i) => ({ id: `${id}_p${i}`, type: "corner" as const, x, y })),
  };
  return stroke ? { ...c, stroke } : c;
}

function layer(id: string, contours: Contour[]): Layer {
  return { id, name: id, visible: true, locked: false, contours };
}

function seed(contours: Contour[]): void {
  const glyph: Glyph = {
    id: "G",
    codepoint: 0x41,
    name: "A",
    advanceWidth: 600,
    layers: [layer("L0", contours)],
  };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId: "L0",
    selectedLayerIds: ["L0"],
  });
  useHistoryStore.getState().clear();
  useEditorStore.getState().clearSelection();
}

function selectNode(layerId: string, contourId: string, pointId: string): void {
  useEditorStore.getState().setSelection([{ layerId, contourId, pointId }]);
}

const glyph = () => useDocumentStore.getState().glyphs["G"]!;

describe("expandSelectedStrokes", () => {
  beforeEach(() => seed([square("s", STROKE)]));

  it("is gated on the selection carrying a stroke", () => {
    expect(canExpandStrokes()).toBe(false); // nothing selected yet
    selectNode("L0", "s", "s_p0");
    expect(canExpandStrokes()).toBe(true);
  });

  it("replaces the stroked path with a baked outline layer (original consumed)", () => {
    selectNode("L0", "s", "s_p0");
    const before = glyph().layers.length;
    expandSelectedStrokes();

    const layers = glyph().layers;
    expect(layers.length).toBe(before + 1); // one new layer
    // The original stroked centerline is gone from its layer.
    expect(layers.find((l) => l.id === "L0")!.contours.find((c) => c.id === "s")).toBeUndefined();
    // The new layer is baked and holds the expanded outline (≥1 contour).
    const baked = layers.find((l) => l.baked);
    expect(baked).toBeDefined();
    expect(baked!.contours.length).toBeGreaterThanOrEqual(1);
    // No expanded contour still carries a stroke recipe — they're plain fills now.
    expect(baked!.contours.every((c) => c.stroke == null)).toBe(true);
    // The node selection was cleared (the old ids are stale).
    expect(useEditorStore.getState().selection.length).toBe(0);
  });

  it("is one undo step that restores the stroked path", () => {
    selectNode("L0", "s", "s_p0");
    expandSelectedStrokes();
    expect(useHistoryStore.getState().pastStates.length).toBe(1);

    useHistoryStore.getState().undo();
    const layers = glyph().layers;
    expect(layers.length).toBe(1);
    expect(layers[0]!.contours.find((c) => c.id === "s")?.stroke).toEqual(STROKE);
    expect(layers.some((l) => l.baked)).toBe(false);
  });

  it("does nothing when the selected path has no stroke", () => {
    seed([square("plain")]); // no stroke
    selectNode("L0", "plain", "plain_p0");
    expect(canExpandStrokes()).toBe(false);
    expandSelectedStrokes();
    expect(glyph().layers.length).toBe(1); // unchanged
    expect(glyph().layers[0]!.contours[0]!.id).toBe("plain");
  });
});

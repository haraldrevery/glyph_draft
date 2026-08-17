import { describe, it, expect, beforeEach } from "vitest";
import { nudgeSelection, flipSelection, reverseSelection } from "./editActions";
import { duplicate } from "../clipboard/clipboardActions";
import { useDocumentStore } from "../../state/documentStore";
import { useHistoryStore } from "../../state/history";
import { useEditorStore } from "../../state/editorStore";
import { contourWinding } from "../../engine/geometry/path";
import type { Glyph, Layer } from "../../types/document";
import type { AnchorPoint, Contour, PointRef } from "../../types/geometry";

/**
 * Selection-level edit actions (nudge / flip / reverse / duplicate): cross-layer,
 * one undo step, locked layers skipped. Headless via getState().
 */

function pt(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}
function poly(id: string, pts: [number, number][], closed = false): Contour {
  return { id, closed, points: pts.map(([x, y], i) => pt(`${id}_p${i}`, x, y)) };
}
function layer(id: string, contours: Contour[], locked = false): Layer {
  return { id, name: id, visible: true, locked, contours };
}
function seed(layers: Layer[], activeLayerId = layers[0]!.id): void {
  const glyph: Glyph = { id: "G", codepoint: 0x41, name: "A", advanceWidth: 600, layers };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId,
    selectedLayerIds: layers.map((l) => l.id),
  });
  useEditorStore.getState().resetEphemeral();
}
function ref(layerId: string, contourId: string, pointId: string): PointRef {
  return { layerId, contourId, pointId };
}
function contoursOf(layerId: string): Contour[] {
  return useDocumentStore.getState().glyphs["G"]!.layers.find((l) => l.id === layerId)!.contours;
}
function point(layerId: string, contourId: string, pointId: string): AnchorPoint {
  return contoursOf(layerId).find((c) => c.id === contourId)!.points.find((p) => p.id === pointId)!;
}

describe("nudgeSelection", () => {
  beforeEach(() => seed([layer("LA", [poly("c", [[0, 0], [10, 0], [20, 0]])])]));

  it("moves only the selected anchors by the delta", () => {
    useEditorStore.getState().setSelection([ref("LA", "c", "c_p1")]);
    nudgeSelection(5, 7);
    expect(point("LA", "c", "c_p1")).toMatchObject({ x: 15, y: 7 });
    expect(point("LA", "c", "c_p0")).toMatchObject({ x: 0, y: 0 }); // unselected unchanged
  });

  it("is one undo step", () => {
    useEditorStore.getState().setSelection([ref("LA", "c", "c_p1")]);
    const before = useHistoryStore.getState().pastStates.length;
    nudgeSelection(1, 0);
    expect(useHistoryStore.getState().pastStates.length).toBe(before + 1);
  });

  it("no-ops with an empty selection", () => {
    const before = useDocumentStore.getState().glyphs;
    nudgeSelection(5, 5);
    expect(useDocumentStore.getState().glyphs).toBe(before);
  });
});

describe("flipSelection", () => {
  it("mirrors the selected anchors about the selection bbox center", () => {
    seed([layer("LA", [poly("c", [[0, 0], [20, 0]])])]);
    useEditorStore.getState().setSelection([ref("LA", "c", "c_p0"), ref("LA", "c", "c_p1")]);
    flipSelection("h"); // center x = 10
    expect(point("LA", "c", "c_p0").x).toBeCloseTo(20, 6);
    expect(point("LA", "c", "c_p1").x).toBeCloseTo(0, 6);
  });
});

describe("reverseSelection", () => {
  it("flips the winding of a contour owning a selected anchor", () => {
    seed([layer("LA", [poly("sq", [[0, 0], [100, 0], [100, 100], [0, 100]], true)])]);
    const before = contourWinding(contoursOf("LA")[0]!);
    useEditorStore.getState().setSelection([ref("LA", "sq", "sq_p0")]);
    reverseSelection();
    expect(contourWinding(contoursOf("LA")[0]!)).not.toBe(before);
  });
});

describe("duplicate", () => {
  it("clones the selected paths into the active layer with new ids and selects them", () => {
    seed([layer("LA", [poly("c", [[0, 0], [10, 0]])])]);
    useEditorStore.getState().setSelection([ref("LA", "c", "c_p0")]);
    duplicate();
    const cs = contoursOf("LA");
    expect(cs).toHaveLength(2);
    expect(cs[1]!.id).not.toBe("c"); // fresh id
    expect(useEditorStore.getState().selection.length).toBe(2); // the copy is selected
    expect(useEditorStore.getState().activeTool).toBe("select");
  });
});

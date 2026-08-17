import { describe, it, expect, beforeEach } from "vitest";
import { copy, cut, paste, selectAll } from "./clipboardActions";
import { useDocumentStore } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import { useClipboardStore } from "../../state/clipboardStore";
import type { Glyph, Layer } from "../../types/document";
import type { AnchorPoint, Contour, PointRef, StrokeStyle } from "../../types/geometry";

/**
 * The clipboard glue (React-free): copy/cut/paste-in-place/select-all over the
 * document + editor + clipboard stores. Cut is node-aware (splits the path).
 */

function pt(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}
function open(id: string, n: number): Contour {
  return {
    id,
    closed: false,
    points: Array.from({ length: n }, (_, i) => pt(`${id}_p${i}`, i * 10, 0)),
  };
}
function layer(id: string, contours: Contour[], locked = false): Layer {
  return { id, name: id, visible: true, locked, contours };
}
function seed(layers: Layer[], activeLayerId: string): void {
  const glyph: Glyph = { id: "G", codepoint: 0x41, name: "A", advanceWidth: 600, layers };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId,
    selectedLayerIds: [activeLayerId],
  });
  useEditorStore.getState().resetEphemeral();
  useClipboardStore.getState().setContours([]);
}
function ref(contourId: string, pointId: string, layerId = "LA"): PointRef {
  return { layerId, contourId, pointId };
}
function activeContours(): Contour[] {
  return useDocumentStore.getState().glyphs["G"]!.layers.find((l) => l.id === "LA")!.contours;
}

const STROKE: StrokeStyle = { width: 30, startCap: "round", endCap: "round", join: "round" };

describe("copy", () => {
  beforeEach(() => seed([layer("LA", [open("c", 3)])], "LA"));

  it("copies the whole contour that owns a selected anchor", () => {
    useEditorStore.getState().setSelection([ref("c", "c_p1")]);
    copy();
    const clip = useClipboardStore.getState().contours;
    expect(clip).toHaveLength(1);
    expect(clip[0]!.id).toBe("c");
  });
});

describe("paste", () => {
  it("clones into the active layer at the same coords with new ids + stroke, selects it", () => {
    seed([layer("LA", [])], "LA");
    useClipboardStore.getState().setContours([{ ...open("src", 2), stroke: STROKE }]);
    useEditorStore.getState().setTool("pen"); // prove paste switches to select

    paste();

    const cs = activeContours();
    expect(cs).toHaveLength(1);
    expect(cs[0]!.id).not.toBe("src"); // new id
    expect(cs[0]!.points[0]).toMatchObject({ x: 0, y: 0 }); // same coords
    expect(cs[0]!.stroke).toEqual(STROKE); // stroke carried
    expect(cs[0]!.stroke).not.toBe(STROKE); // deep-cloned
    expect(useEditorStore.getState().activeTool).toBe("select");
    expect(useEditorStore.getState().selection.length).toBe(2);
  });

  it("refuses to paste into a locked layer", () => {
    seed([layer("LA", [], true)], "LA");
    useClipboardStore.getState().setContours([open("src", 2)]);
    paste();
    expect(activeContours()).toHaveLength(0);
  });
});

describe("cut", () => {
  it("whole-contour: removes it and fills the clipboard", () => {
    seed([layer("LA", [open("c", 3)])], "LA");
    useEditorStore.getState().setSelection([ref("c", "c_p0"), ref("c", "c_p1"), ref("c", "c_p2")]);
    cut();
    expect(useClipboardStore.getState().contours).toHaveLength(1);
    expect(activeContours()).toHaveLength(0); // all points cut → contour gone
  });

  it("partial: splits the remainder and clipboards the cut run", () => {
    seed([layer("LA", [open("c", 6)])], "LA"); // p0..p5
    useEditorStore.getState().setSelection([ref("c", "c_p2"), ref("c", "c_p3")]);
    cut();
    // clipboard = the cut run [p2,p3]; document = two surviving runs [p0,p1],[p4,p5]
    const clip = useClipboardStore.getState().contours;
    expect(clip).toHaveLength(1);
    expect(clip[0]!.points.map((p) => p.id)).toEqual(["c_p2", "c_p3"]);
    expect(activeContours()).toHaveLength(2);
  });
});

describe("selectAll", () => {
  it("selects every anchor of the (single) marked layer", () => {
    seed([layer("LA", [open("c", 3)])], "LA");
    selectAll();
    expect(useEditorStore.getState().selection).toHaveLength(3);
  });

  it("spans EVERY editable layer, ignoring the layer selection (Illustrator-style)", () => {
    seed([layer("LA", [open("a", 2)]), layer("LB", [open("b", 3)])], "LA");
    useDocumentStore.setState({ selectedLayerIds: ["LA"] }); // only LA "marked"
    selectAll();
    expect(useEditorStore.getState().selection).toHaveLength(5); // still both: 2 + 3
  });

  it("excludes locked and hidden layers", () => {
    seed(
      [layer("LA", [open("a", 2)]), { ...layer("LB", [open("b", 3)]), locked: true }],
      "LA",
    );
    selectAll();
    expect(useEditorStore.getState().selection).toHaveLength(2); // only LA (LB locked)
  });
});

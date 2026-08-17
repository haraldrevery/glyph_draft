import { describe, it, expect, beforeEach } from "vitest";
import { penTool } from "./pen";
import { useDocumentStore } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import type { Glyph, Layer } from "../../types/document";
import type { Contour } from "../../types/geometry";
import type { Vec2, Viewport } from "../../types/viewport";
import type { ToolPointerContext } from "./types";

/**
 * Pen session vs. layer switching. The pen tracks the contour being extended in
 * editorStore.pen.contourId; that contour belongs to one layer. Switching the
 * active layer mid-draw (e.g. clicking "New layer") must not leave the pen wedged
 * onto a contour that's no longer on the active layer — the next click has to start
 * a fresh path. DOM-free: drives the tool's handlers against the real stores.
 */

const VIEWPORT: Viewport = { zoom: 1, pan: { x: 0, y: 0 } };

function open(id: string, pts: [number, number][]): Contour {
  return {
    id,
    closed: false,
    points: pts.map(([x, y], i) => ({ id: `${id}_p${i}`, type: "corner" as const, x, y })),
  };
}

function layer(id: string, contours: Contour[]): Layer {
  return { id, name: id, visible: true, locked: false, contours };
}

/** Two-layer glyph: A (bottom) holds an in-progress contour, B (top) is empty. */
function seed(activeLayerId: string): void {
  const glyph: Glyph = {
    id: "G",
    codepoint: 0x41,
    name: "A",
    advanceWidth: 600,
    layers: [layer("A", [open("ctA", [[0, 0], [50, 0]])]), layer("B", [])],
  };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId,
    selectedLayerIds: [activeLayerId],
  });
}

/** Minimal pointer context at a world point (snapping off ⇒ world = rawWorld). */
function ctxAt(world: Vec2): ToolPointerContext {
  const doc = useDocumentStore.getState();
  const glyph = doc.glyphs["G"]!;
  return {
    world,
    rawWorld: world,
    handleWorld: world,
    screen: world, // zoom 1, origin pan ⇒ screen ≈ world; far from anchors anyway
    viewport: VIEWPORT,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    isDown: false,
    downWorld: world,
    glyph,
    layer: glyph.layers.find((l) => l.id === doc.activeLayerId) ?? null,
    doc,
    editor: useEditorStore.getState(),
  };
}

function layersById(): Record<string, Layer> {
  return Object.fromEntries(
    useDocumentStore.getState().glyphs["G"]!.layers.map((l) => [l.id, l]),
  );
}

describe("pen tool — near-zero handle collapses to a corner", () => {
  // A move while dragging out the first point's handle. downWorld is the anchor;
  // ctx.screen sits `screenPx` away (zoom 1, pan 0 ⇒ screen px ≈ world units).
  function moveCtx(screenPx: number): ToolPointerContext {
    return {
      world: { x: screenPx, y: 0 },
      rawWorld: { x: screenPx, y: 0 },
      handleWorld: { x: screenPx, y: 0 },
      screen: { x: screenPx, y: 0 },
      viewport: VIEWPORT,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      isDown: true,
      downWorld: { x: 0, y: 0 },
      glyph: null,
      layer: null,
      doc: useDocumentStore.getState(),
      editor: useEditorStore.getState(),
    };
  }

  beforeEach(() => {
    useEditorStore.getState().resetEphemeral();
    useEditorStore.getState().penSetPending({ id: "pt", type: "corner", x: 0, y: 0 });
  });

  it("keeps the pending point a corner when the drag is below threshold", () => {
    penTool.onPointerMove!(moveCtx(2)); // < HANDLE_COLLAPSE_PX (4)
    const pending = useEditorStore.getState().pen.pending!;
    expect(pending.type).toBe("corner");
    expect(pending.handleOut).toBeUndefined();
    expect(pending.handleIn).toBeUndefined();
  });

  it("makes the pending point smooth (mirrored handles) past threshold", () => {
    penTool.onPointerMove!(moveCtx(20)); // >= threshold
    const pending = useEditorStore.getState().pen.pending!;
    expect(pending.type).toBe("smooth");
    expect(pending.handleOut).toEqual({ x: 20, y: 0 });
    expect(pending.handleIn).toEqual({ x: -20, y: 0 }); // mirror about (0,0)
  });
});

describe("pen tool — stale session after a layer switch", () => {
  beforeEach(() => useEditorStore.getState().resetEphemeral());

  it("starts a fresh path on the new layer when the tracked contour isn't on it", () => {
    seed("A");
    useEditorStore.getState().penStart("ctA"); // mid-draw on layer A

    // The user clicks "New layer" instead of placing the next node.
    useDocumentStore.getState().setActiveLayer("B");
    expect(useEditorStore.getState().pen.contourId).toBe("ctA"); // still stale

    // Next click on empty canvas, far from A's first anchor (no close).
    const ctx = ctxAt({ x: 300, y: 300 });
    penTool.onPointerDown!(ctx);
    penTool.onPointerUp!(ctxAt({ x: 300, y: 300 }));

    const byId = layersById();
    expect(byId["A"]!.contours).toHaveLength(1); // untouched
    expect(byId["A"]!.contours[0]!.points).toHaveLength(2);
    expect(byId["B"]!.contours).toHaveLength(1); // fresh path created here
    expect(byId["B"]!.contours[0]!.points).toHaveLength(1);
    expect(useEditorStore.getState().pen.contourId).toBe(byId["B"]!.contours[0]!.id);
  });

  it("still extends the tracked contour when the active layer is unchanged", () => {
    seed("A");
    useEditorStore.getState().penStart("ctA");

    penTool.onPointerDown!(ctxAt({ x: 300, y: 300 }));
    penTool.onPointerUp!(ctxAt({ x: 300, y: 300 }));

    const byId = layersById();
    expect(byId["A"]!.contours).toHaveLength(1); // no new contour
    expect(byId["A"]!.contours[0]!.points).toHaveLength(3); // appended, not reset
    expect(byId["B"]!.contours).toHaveLength(0);
    expect(useEditorStore.getState().pen.contourId).toBe("ctA");
  });
});

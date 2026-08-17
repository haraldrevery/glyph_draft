import { describe, it, expect } from "vitest";
import { applyAnchorDelta, editableLayers, dragDelta, leadPoint } from "./shared";
import type { AnchorPoint, Contour, PointRef } from "../../types/geometry";
import type { Layer } from "../../types/document";
import type { GridSettings } from "../../types/viewport";
import type { ToolPointerContext } from "./types";

/** Shared node-tool helpers (extracted from select/lasso). Pure, DOM-free. */

function pt(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}
function contour(id: string, points: AnchorPoint[]): Contour {
  return { id, closed: false, points };
}
function layer(id: string, opts: Partial<Layer> = {}): Layer {
  return { id, name: id, visible: true, locked: false, contours: [], ...opts };
}

describe("applyAnchorDelta", () => {
  it("translates only the referenced anchors (with handles) and leaves others by identity", () => {
    const a: Contour = {
      id: "a",
      closed: false,
      points: [{ id: "p", type: "smooth", x: 0, y: 0, handleOut: { x: 5, y: 0 } }, pt("q", 10, 0)],
    };
    const b = contour("b", [pt("r", 0, 0)]);
    const refs: PointRef[] = [{ layerId: "L", contourId: "a", pointId: "p" }];

    const out = applyAnchorDelta([a, b], refs, { x: 100, y: 0 });
    expect(out[0]!.points[0]).toEqual({ id: "p", type: "smooth", x: 100, y: 0, handleOut: { x: 105, y: 0 } });
    expect(out[0]!.points[1]).toEqual(pt("q", 10, 0)); // unreferenced anchor untouched
    expect(out[1]).toBe(b); // contour with no refs returned by identity
  });
});

describe("dragDelta — lead node snaps to the current grid (not the cursor delta)", () => {
  const grid = (snap: boolean): GridSettings => ({
    size: 50,
    visible: true,
    snap,
    snapHandles: false,
  });

  it("lands an OFF-grid grabbed node exactly on the grid", () => {
    const lead = { x: 12, y: 7 }; // not on the 50-unit grid
    // Move the cursor +60,0 → desired lead ≈ (72,7); snaps to (50,0).
    const d = dragDelta(lead, { x: 0, y: 0 }, { x: 60, y: 0 }, grid(true));
    const landed = { x: lead.x + d.x, y: lead.y + d.y };
    expect(landed.x % 50).toBe(0);
    expect(landed.y % 50).toBe(0);
    expect(landed).toEqual({ x: 50, y: 0 });
  });

  it("returns the raw cursor delta when snap is off", () => {
    const d = dragDelta({ x: 12, y: 7 }, { x: 0, y: 0 }, { x: 33, y: -8 }, grid(false));
    expect(d).toEqual({ x: 33, y: -8 });
  });
});

describe("leadPoint", () => {
  it("finds a ref's anchor position in the snapshot, else null", () => {
    const c = contour("a", [pt("p", 12, 7)]);
    expect(leadPoint([c], { layerId: "L", contourId: "a", pointId: "p" })).toEqual({ x: 12, y: 7 });
    expect(leadPoint([c], { layerId: "L", contourId: "a", pointId: "z" })).toBeNull();
  });
});

describe("editableLayers", () => {
  it("returns every visible + unlocked layer (skips locked / hidden)", () => {
    const glyph = {
      layers: [
        layer("LA"),
        layer("LB", { locked: true }),
        layer("LC", { visible: false }),
        layer("LD"),
      ],
    };
    const ctx = { glyph } as unknown as ToolPointerContext;
    expect(editableLayers(ctx).map((l) => l.id)).toEqual(["LA", "LD"]); // LB locked, LC hidden
  });

  it("ignores the layer selection — any editable layer is in scope", () => {
    const glyph = { layers: [layer("LA"), layer("LB")] };
    // selectedLayerIds is just LA, but node selection spans all editable layers.
    const ctx = { glyph, doc: { selectedLayerIds: ["LA"] } } as unknown as ToolPointerContext;
    expect(editableLayers(ctx).map((l) => l.id)).toEqual(["LA", "LB"]);
  });
});

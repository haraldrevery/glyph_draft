import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./documentStore";
import { useHistoryStore } from "./history";
import type { Glyph } from "../types/document";

/**
 * Per-glyph undo/redo: Ctrl+Z while viewing a glyph only ever changes THAT glyph, and
 * glyph create/delete are structural (not undoable). `setAdvanceWidth` is used as a
 * cheap single-step edit of the active glyph.
 */

function glyph(id: string, cp: number): Glyph {
  return {
    id,
    codepoint: cp,
    name: String.fromCodePoint(cp),
    advanceWidth: 600,
    layers: [{ id: `${id}_l`, name: "L", visible: true, locked: false, contours: [] }],
  };
}

const doc = () => useDocumentStore.getState();
const hist = () => useHistoryStore.getState();
const aw = (id: string) => doc().glyphs[id]!.advanceWidth;

beforeEach(() => {
  doc().loadGlyphs({ A: glyph("A", 0x41), B: glyph("B", 0x42) });
  hist().clear();
});

describe("per-glyph undo/redo", () => {
  it("undo only changes the ACTIVE glyph, never an off-screen one", () => {
    doc().setActiveGlyph("A");
    doc().setAdvanceWidth(700); // edit A
    doc().setActiveGlyph("B");
    doc().setAdvanceWidth(800); // edit B
    expect([aw("A"), aw("B")]).toEqual([700, 800]);

    hist().undo(); // active is B → only B reverts
    expect(aw("B")).toBe(600);
    expect(aw("A")).toBe(700); // A untouched (the whole point)

    doc().setActiveGlyph("A");
    hist().undo(); // now A reverts
    expect([aw("A"), aw("B")]).toEqual([600, 600]);
  });

  it("canUndo/canRedo track the ACTIVE glyph", () => {
    doc().setActiveGlyph("A");
    doc().setAdvanceWidth(700);
    doc().setActiveGlyph("A");
    expect(hist().pastStates.length).toBe(1); // A has history
    doc().setActiveGlyph("B");
    expect(hist().pastStates.length).toBe(0); // B does not
  });

  it("redo re-applies on the active glyph; a fresh edit invalidates it", () => {
    doc().setActiveGlyph("A");
    doc().setAdvanceWidth(700);
    hist().undo();
    expect(aw("A")).toBe(600);
    expect(hist().futureStates.length).toBe(1);
    hist().redo();
    expect(aw("A")).toBe(700);

    hist().undo(); // future has 1 again
    doc().setAdvanceWidth(650); // a new edit
    expect(hist().futureStates.length).toBe(0); // redo invalidated on that glyph
  });

  it("creating a glyph is structural — not undoable", () => {
    doc().setActiveGlyph("A");
    hist().clear();
    doc().addGlyph(0x43); // new glyph C becomes active
    expect(hist().pastStates.length).toBe(0); // no step on C
    doc().setActiveGlyph("A");
    expect(hist().pastStates.length).toBe(0); // and none leaked onto A
  });

  it("deleting a glyph is structural — Ctrl+Z does not resurrect it", () => {
    doc().setActiveGlyph("A");
    doc().deleteGlyph("B");
    expect(Object.keys(doc().glyphs)).toEqual(["A"]);
    hist().undo(); // active A, no A history → no-op; B stays gone
    expect(doc().glyphs["B"]).toBeUndefined();
  });
});

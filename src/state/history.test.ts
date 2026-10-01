import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useDocumentStore } from "./documentStore";
import { useHistoryStore, coalesceNextEdit } from "./history";
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

describe("gesture coalescing (one slider drag = one undo step)", () => {
  afterEach(() => vi.useRealTimers());

  const drag = (tag: string, values: number[]) => {
    for (const v of values) {
      coalesceNextEdit(tag);
      doc().setAdvanceWidth(v);
    }
  };

  it("collapses a continuous drag into ONE step", () => {
    doc().setActiveGlyph("A");
    drag("slider-1", [601, 602, 603, 650, 700]);
    expect(hist().pastStates).toHaveLength(1);
    hist().undo();
    expect(aw("A")).toBe(600); // the whole drag reverts
  });

  it("never merges a tagged drag with an untagged edit around it", () => {
    doc().setActiveGlyph("A");
    doc().setAdvanceWidth(610); // plain edit
    drag("slider-1", [620, 630]);
    doc().setAdvanceWidth(640); // plain edit
    expect(hist().pastStates).toHaveLength(3);
  });

  it("two different controls are two steps", () => {
    doc().setActiveGlyph("A");
    drag("slider-1", [610, 620]);
    drag("slider-2", [630, 640]);
    expect(hist().pastStates).toHaveLength(2);
  });

  it("a pause longer than the window starts a new step", () => {
    vi.useFakeTimers();
    doc().setActiveGlyph("A");
    drag("slider-1", [610]);
    vi.advanceTimersByTime(1500);
    drag("slider-1", [620]);
    expect(hist().pastStates).toHaveLength(2);
  });

  it("a change after an undo starts a new step", () => {
    doc().setActiveGlyph("A");
    drag("slider-1", [610, 620]);
    hist().undo();
    drag("slider-1", [630]);
    expect(hist().pastStates).toHaveLength(1);
    expect(hist().futureStates).toHaveLength(0);
  });

  it("an unconsumed tag expires: it can't merge a LATER unrelated edit", async () => {
    doc().setActiveGlyph("A");
    drag("slider-1", [610]);
    coalesceNextEdit("slider-1"); // e.g. the slider didn't change the document
    await Promise.resolve(); // end of task → the mark is dropped
    doc().setAdvanceWidth(620); // unrelated, untagged
    expect(hist().pastStates).toHaveLength(2);
  });
});


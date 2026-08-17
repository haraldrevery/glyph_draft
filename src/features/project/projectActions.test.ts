import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "../../state/documentStore";
import { useHistoryStore } from "../../state/history";
import { serializeCurrentProject, applyImportedProject } from "./projectActions";
import type { Glyph } from "../../types/document";

/**
 * The React-free core of project import/export. The platform I/O seam only moves the
 * JSON string in/out, so these cover the parse → migrate → load path and its
 * corruption safety (no DOM, no storage).
 */

function glyph(id: string, codepoint: number): Glyph {
  return {
    id,
    codepoint,
    name: String.fromCodePoint(codepoint),
    advanceWidth: 600,
    layers: [{ id: `${id}_l0`, name: "Layer 1", visible: true, locked: false, contours: [] }],
  };
}

const state = () => useDocumentStore.getState();
const temporal = () => useHistoryStore.getState();

beforeEach(() => {
  state().loadGlyphs({ a: glyph("a", 0x41), b: glyph("b", 0x42) });
  temporal().clear();
});

describe("projectActions", () => {
  it("round-trips the document through serialize → apply", () => {
    const before = state().glyphs;
    const json = serializeCurrentProject();
    // Replace with a different document, then import the saved one back.
    state().loadGlyphs({ z: glyph("z", 0x5a) });
    const result = applyImportedProject(json);
    expect(result.ok).toBe(true);
    expect(state().glyphs).toEqual(before);
  });

  it("imported document is the history baseline (no undo step)", () => {
    const json = serializeCurrentProject();
    state().loadGlyphs({ z: glyph("z", 0x5a) });
    applyImportedProject(json);
    expect(temporal().pastStates.length).toBe(0); // load cleared history
  });

  it("rejects malformed JSON and leaves the document untouched", () => {
    const before = state().glyphs;
    const result = applyImportedProject("{ not valid json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(state().glyphs).toBe(before); // identity preserved
  });

  it("rejects an unknown-version envelope", () => {
    const before = state().glyphs;
    const result = applyImportedProject(JSON.stringify({ version: 99, glyphs: { a: glyph("a", 0x41) } }));
    expect(result.ok).toBe(false);
    expect(state().glyphs).toBe(before);
  });

  it("rejects an empty document", () => {
    const result = applyImportedProject(JSON.stringify({ version: 2, savedAt: 0, glyphs: {} }));
    expect(result.ok).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore } from "../../state/documentStore";
import { useHistoryStore } from "../../state/history";
import {
  serializeCurrentProject,
  applyImportedProject,
  parseProject,
  replaceWorkspace,
} from "./projectActions";
import { PREIMPORT_KEY } from "../../storage/projectFile";
import type { Glyph } from "../../types/document";

const kv = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  return {
    data,
    storage: {
      getItem: async (k: string) => (data.has(k) ? structuredClone(data.get(k)) : null),
      setItem: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
      removeItem: async (k: string) => void data.delete(k),
      keys: async () => [...data.keys()],
      clear: async () => data.clear(),
    },
  };
});
vi.mock("../../storage/createStorage", () => ({
  createStorage: async () => kv.storage,
  getStorage: () => kv.storage,
}));

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

  it("parseProject validates without touching the document", () => {
    const before = state().glyphs;
    const parsed = parseProject(JSON.stringify({ version: 8, savedAt: 0, glyphs: { z: glyph("z", 0x5a) } }));
    expect(parsed.ok).toBe(true);
    expect(state().glyphs).toBe(before);
  });

  it("replaceWorkspace snapshots the old workspace before replacing it", async () => {
    kv.data.clear();
    await replaceWorkspace({ z: glyph("z", 0x5a) });
    expect(Object.keys(state().glyphs)).toEqual(["z"]);
    const snap = kv.data.get(PREIMPORT_KEY) as { glyphs: Record<string, Glyph> };
    expect(Object.keys(snap.glyphs).sort()).toEqual(["a", "b"]);
  });
});

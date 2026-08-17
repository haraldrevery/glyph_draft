import { describe, it, expect } from "vitest";
import { GLYPH_SETS } from "./glyphSets";

describe("GLYPH_SETS", () => {
  it("has the four expected sets", () => {
    expect(GLYPH_SETS.map((s) => s.id)).toEqual([
      "english",
      "scandinavian",
      "digits-math",
      "keyboard",
    ]);
  });

  it("every set is non-empty, with valid, unique code points", () => {
    for (const set of GLYPH_SETS) {
      expect(set.codepoints.length).toBeGreaterThan(0);
      // No duplicates within a set.
      expect(new Set(set.codepoints).size).toBe(set.codepoints.length);
      // All are real, > 0 code points (renderable / hex-taggable).
      for (const cp of set.codepoints) {
        expect(Number.isInteger(cp)).toBe(true);
        expect(cp).toBeGreaterThan(0);
        expect(() => String.fromCodePoint(cp)).not.toThrow();
      }
    }
  });

  it("English = 52 letters, Scandinavian = 10 extras", () => {
    const byId = Object.fromEntries(GLYPH_SETS.map((s) => [s.id, s]));
    expect(byId.english!.codepoints).toHaveLength(52);
    expect(byId.scandinavian!.codepoints).toHaveLength(10);
    expect(byId.scandinavian!.codepoints).toContain(0x00c5); // Å
  });
});

import { describe, it, expect } from "vitest";
import {
  CURRENT_VERSION,
  serializeProject,
  migrate,
  type ProjectFileV1,
} from "./projectFile";
import type { Glyph } from "../types/document";

function glyph(id: string, codepoint: number): Glyph {
  return {
    id,
    codepoint,
    name: String.fromCodePoint(codepoint),
    advanceWidth: 600,
    layers: [{ id: `${id}_l0`, name: "Layer 1", visible: true, locked: false, contours: [] }],
  };
}

const glyphs: Record<string, Glyph> = {
  g1: glyph("g1", 0x41),
  g2: glyph("g2", 0x42),
};

describe("serializeProject", () => {
  it("wraps glyphs in the current versioned envelope with a timestamp", () => {
    const file = serializeProject(glyphs);
    expect(file.version).toBe(CURRENT_VERSION);
    expect(typeof file.savedAt).toBe("number");
    expect(file.glyphs).toBe(glyphs);
  });
});

describe("migrate", () => {
  it("round-trips serialize → migrate to the same glyphs", () => {
    const restored = migrate(serializeProject(glyphs));
    expect(restored).toEqual(glyphs);
  });

  it("loads a hand-written v1 blob", () => {
    const blob: ProjectFileV1 = { version: 1, savedAt: 0, glyphs };
    expect(migrate(blob)).toEqual(glyphs);
  });

  it("v1 → v2 rewrites legacy `square` caps to `rectangle` with a backfilled style", () => {
    const sq = glyph("sq", 0x43);
    sq.layers[0]!.contours = [
      {
        id: "c0",
        closed: false,
        points: [
          { id: "p0", type: "corner", x: 0, y: 0 },
          { id: "p1", type: "corner", x: 100, y: 0 },
        ],
        stroke: { width: 40, startCap: "square", endCap: "round", join: "miter" } as never,
      },
    ];
    const out = migrate({ version: 1, savedAt: 0, glyphs: { sq } })!;
    const stroke = out.sq!.layers[0]!.contours[0]!.stroke!;
    expect(stroke.startCap).toBe("rectangle");
    expect(stroke.endCap).toBe("round"); // untouched
    expect(stroke.startRect).toEqual({ size: 20, ratio: 1, radius: 0 });
  });

  it("v2 → v3 is the identity (additive paint preserved, no transform)", () => {
    const g = glyph("pc", 0x44);
    g.layers[0]!.contours = [
      {
        id: "c0",
        closed: true,
        points: [
          { id: "p0", type: "corner", x: 0, y: 0 },
          { id: "p1", type: "corner", x: 100, y: 0 },
          { id: "p2", type: "corner", x: 100, y: 100 },
        ],
        paint: { fill: "#ff0000", opacity: 0.5 },
      },
    ];
    const out = migrate({ version: 2, savedAt: 0, glyphs: { pc: g } })!;
    expect(out.pc!.layers[0]!.contours[0]!.paint).toEqual({ fill: "#ff0000", opacity: 0.5 });
  });

  it("v4 → v5 is the identity (additive paint.gradient preserved, no transform)", () => {
    const g = glyph("gr", 0x45);
    g.layers[0]!.contours = [
      {
        id: "c0",
        closed: true,
        points: [
          { id: "p0", type: "corner", x: 0, y: 0 },
          { id: "p1", type: "corner", x: 100, y: 0 },
          { id: "p2", type: "corner", x: 100, y: 100 },
        ],
        paint: { fill: "#ff0000", gradient: { angle: 45, to: "#0000ff", midpoint: 0.5, fade: 1 } },
      },
    ];
    const out = migrate({ version: 4, savedAt: 0, glyphs: { gr: g } })!;
    expect(out.gr!.layers[0]!.contours[0]!.paint).toEqual({
      fill: "#ff0000",
      gradient: { angle: 45, to: "#0000ff", midpoint: 0.5, fade: 1 },
    });
  });

  it("defensively accepts an unversioned legacy glyph map", () => {
    expect(migrate(glyphs)).toEqual(glyphs);
  });

  it("returns null (not throw) on corrupt or unreadable input", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate("not an object")).toBeNull();
    expect(migrate(42)).toBeNull();
    expect(migrate({ version: 1, savedAt: 0, glyphs: {} })).toBeNull(); // empty doc
    expect(migrate({ version: 1, savedAt: 0, glyphs: "nope" })).toBeNull();
  });

  it("rejects a glyph missing required fields", () => {
    const bad = { version: 1, savedAt: 0, glyphs: { g1: { id: "g1" } } };
    expect(migrate(bad)).toBeNull();
  });

  it("rejects a version it does not know how to read", () => {
    expect(migrate({ version: 99, glyphs })).toBeNull();
  });
});

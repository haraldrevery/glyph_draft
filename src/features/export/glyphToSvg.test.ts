import { describe, it, expect } from "vitest";
import { glyphToSvg } from "./glyphToSvg";
import { exportFileName } from "../../state/glyphHelpers";
import { DEFAULT_METRICS } from "../../constants/metrics";
import type { Glyph, Layer } from "../../types/document";
import type { Contour } from "../../types/geometry";

/**
 * glyphToSvg exercises the live geometry service (Paper.js) for boolean pairs,
 * which initializes headless in this suite — same as PaperGeometryService.test.ts.
 */

function poly(id: string, pts: [number, number][]): Contour {
  return {
    id,
    closed: true,
    points: pts.map(([x, y], i) => ({
      id: `${id}_p${i}`,
      type: "corner" as const,
      x,
      y,
    })),
  };
}

function layer(id: string, contours: Contour[], visible = true): Layer {
  return { id, name: id, visible, locked: false, contours };
}

function glyph(layers: Layer[], extra: Partial<Glyph> = {}): Glyph {
  return {
    id: "g1",
    codepoint: 0x41,
    name: "A",
    advanceWidth: DEFAULT_METRICS.advanceWidth,
    layers,
    ...extra,
  };
}

const BIG = poly("big", [[100, 100], [500, 100], [500, 700], [100, 700]]);
const SMALL = poly("small", [[250, 250], [350, 250], [350, 450], [250, 450]]);

describe("exportFileName", () => {
  it("renders lowercase u_xxxx.svg, min 4 hex digits", () => {
    expect(exportFileName(0x41)).toBe("u_0041.svg");
    expect(exportFileName(0x20ac)).toBe("u_20ac.svg");
    expect(exportFileName(0x1f600)).toBe("u_1f600.svg");
  });
});

describe("glyphToSvg", () => {
  it("frames the em box when artwork fits inside it", () => {
    // BIG (100..500, 100..700) is within the em box, so the union is the em box:
    // minY = -ascender (-800), width = advanceWidth (600),
    // height = ascender + descender (1000).
    const svg = glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS);
    expect(svg).toContain('viewBox="0 -800 600 1000"');
  });

  it("expands the frame so overflowing artwork is never clipped", () => {
    // OVER spans x -100..900 and y -400..900, past the em box (0..600, -200..800).
    const OVER = poly("over", [[-100, -400], [900, -400], [900, 900], [-100, 900]]);
    const svg = glyphToSvg(glyph([layer("LA", [OVER])]), DEFAULT_METRICS);
    // World union: x [-100, 900], y [-400, 900]. SVG Y-flip → minY = -maxY = -900,
    // width = 1000, height = 1300.
    expect(svg).toContain('viewBox="-100 -900 1000 1300"');
  });

  it("scales the frame uniformly with the artwork", () => {
    const svg = glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS, 50);
    expect(svg).toContain('viewBox="0 -400 300 500"');
  });

  it("flips Y world->SVG so the glyph is upright (scale 1 -1 at 100%)", () => {
    const svg = glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS, 100);
    expect(svg).toContain("transform=\"scale(1 -1)\"");
  });

  it("applies the universal scale % to the geometry transform", () => {
    const svg = glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS, 50);
    expect(svg).toContain("transform=\"scale(0.5 -0.5)\"");
  });

  it("emits a nonzero-fill path for an unpaired solid layer", () => {
    const svg = glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS);
    expect(svg).toContain('fill-rule="nonzero"');
    expect(svg).toContain("100 100"); // a rectangle corner, in world units
  });

  it("exports default ink as black (unchanged) and a painted contour with its colour", () => {
    expect(glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS)).toContain('fill="#000000"');
    const red = { ...poly("red", [[100, 100], [500, 100], [500, 700], [100, 700]]), paint: { fill: "#ff0000", opacity: 0.5 } };
    const svg = glyphToSvg(glyph([layer("LA", [red])]), DEFAULT_METRICS);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill-opacity="0.5"');
  });

  it("emits a <defs> linearGradient and url() fill for a gradient paint", () => {
    const grad = {
      ...poly("grad", [[100, 100], [500, 100], [500, 700], [100, 700]]),
      paint: { fill: "#ff0000", gradient: { angle: 90, to: "#0000ff", midpoint: 0.5, fade: 1, toOpacity: 0.25 } },
    };
    const svg = glyphToSvg(glyph([layer("LA", [grad])]), DEFAULT_METRICS);
    expect(svg).toContain("<defs>");
    expect(svg).toContain('stop-color="#ff0000"'); // first stop = the fill
    expect(svg).toContain('stop-color="#0000ff"'); // second stop = `to`
    expect(svg).toContain('stop-opacity="0.25"'); // the To stop fades toward transparent
    // The path's url() references the SAME id the <linearGradient> defines.
    const id = svg.match(/<linearGradient id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(svg).toContain(`fill="url(#${id})"`);
    // A plain glyph emits NO defs (byte-shape unchanged for the common case).
    expect(glyphToSvg(glyph([layer("LA", [BIG])]), DEFAULT_METRICS)).not.toContain("<defs>");
  });

  it("silhouette mode flattens to solid black (no colour/gradient/opacity), geometry unchanged", () => {
    const grad = {
      ...poly("grad", [[100, 100], [500, 100], [500, 700], [100, 700]]),
      paint: { fill: "#ff0000", opacity: 0.5, gradient: { angle: 90, to: "#0000ff", midpoint: 0.5, fade: 1 } },
    };
    const g = glyph([layer("LA", [grad])]);
    const colored = glyphToSvg(g, DEFAULT_METRICS);
    const silh = glyphToSvg(g, DEFAULT_METRICS, 100, undefined, false, true);
    expect(silh).toContain('fill="#000000"');
    expect(silh).not.toContain("<defs>");
    expect(silh).not.toContain("<linearGradient");
    expect(silh).not.toContain("url(#");
    expect(silh).not.toContain("fill-opacity");
    const paths = (s: string) => (s.match(/<path /g) ?? []).length;
    expect(paths(silh)).toBe(paths(colored)); // same number of regions
    expect(silh.match(/viewBox="[^"]+"/)?.[0]).toBe(colored.match(/viewBox="[^"]+"/)?.[0]); // same frame
  });

  it("omits hidden layers", () => {
    const svg = glyphToSvg(
      glyph([layer("LA", [BIG]), layer("LB", [SMALL], false)]),
      DEFAULT_METRICS,
    );
    expect(svg).toContain("100 100"); // BIG present
    expect(svg).not.toContain("250 250"); // SMALL (hidden) absent
  });

  it("fills a stroked open path's outline but not an unstroked open path", () => {
    const openPath = (id: string, stroke?: Contour["stroke"]): Contour => ({
      id,
      closed: false,
      points: [
        { id: `${id}_0`, type: "corner", x: 100, y: 300 },
        { id: `${id}_1`, type: "corner", x: 500, y: 300 },
      ],
      ...(stroke ? { stroke } : {}),
    });

    const plain = glyphToSvg(glyph([layer("LA", [openPath("p")])]), DEFAULT_METRICS);
    expect(plain).not.toContain("<path "); // open + unstroked → no fill

    const stroked = glyphToSvg(
      glyph([layer("LA", [openPath("p", { width: 40, startCap: "round", endCap: "round", join: "round" })])]),
      DEFAULT_METRICS,
    );
    expect(stroked).toContain('fill-rule="nonzero"'); // stroke outline is filled
  });

  it("exports a baked layer verbatim, preserving its hole (Phase F parity)", () => {
    // A baked/merged layer carries final geometry (CW outer + CCW hole). Export
    // must emit it as-is under nonzero — not force-CW (which would fill the hole).
    const ring = (): Layer => ({
      id: "M",
      name: "M",
      visible: true,
      locked: false,
      baked: true,
      contours: [BIG, poly("h", [[250, 250], [250, 450], [350, 450], [350, 250]])], // CCW hole
    });
    const svg = glyphToSvg(glyph([ring()]), DEFAULT_METRICS);
    const fills = svg.match(/<path /g) ?? [];
    expect(fills).toHaveLength(1); // one nonzero path
    expect(svg).toContain('fill-rule="nonzero"');
    const moves = svg.match(/M /g) ?? [];
    expect(moves.length).toBe(2); // outer + hole both present (hole not dropped)
  });

  it("bakes a Subtract pair into a single result with a hole (two subpaths)", () => {
    // layers bottom-to-top: B (small) lower, A (big) upper → A - B = ring + hole.
    const g = glyph(
      [layer("LB", [SMALL]), layer("LA", [BIG])],
      { booleanPairs: [{ id: "p1", layerIds: ["LA", "LB"], op: "subtract" }] },
    );
    const svg = glyphToSvg(g, DEFAULT_METRICS);
    const fills = svg.match(/<path /g) ?? [];
    expect(fills).toHaveLength(1); // one combined result group, not two operands
    const moves = svg.match(/M /g) ?? [];
    expect(moves.length).toBeGreaterThanOrEqual(2); // outer + hole
  });
});

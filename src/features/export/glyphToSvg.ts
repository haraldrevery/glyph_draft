import type { Glyph } from "../../types/document";
import type { FontMetrics } from "../../constants/metrics";
import { glyphFillGroups, type FillGroup, type RenderOptions } from "../canvas/layerFills";
import { linearGradientSpec } from "../canvas/fillPaint";
import { contoursToPath } from "../../engine/geometry/path";
import { contourTightBounds, type BBox } from "../../engine/geometry/align";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import {
  type StyleTransform,
  isIdentityStyle,
  styleMatrix,
  transformContours,
  extendOutlineX,
} from "./styleTransform";

/**
 * Serializes one glyph to a standalone, FontForge-importable SVG string.
 *
 * Parity with the canvas is the whole point: the same `buildFillGroups` the
 * renderer uses (Invariant 5) produces the fill regions, so a two-layer
 * Pathfinder result is baked identically into the export. Each group is emitted
 * as one `<path fill-rule="nonzero">`, exactly as `GlyphView` does.
 *
 * Coordinates stay in world/font units; a single wrapping `<g>` carries the
 * world→SVG Y-flip (world is Y-up, SVG is Y-down) AND the universal scale, so
 * the reused `contoursToPath` serializer never has to think about either.
 *
 * The `viewBox` frames the UNION of the em box (descender..ascender by the
 * glyph's advance width) and the glyph's own artwork bounds, so the export is
 * "the canvas as it is" — the metric frame is kept for consistent baselines and
 * sidebearings across glyphs, but artwork that overflows the em box is NEVER
 * clipped. The universal `scalePct` scales everything uniformly (frame and
 * artwork together), so the output is just the canvas at a chosen size.
 *
 * `tightCrop` opts out of the metric frame entirely: the viewBox hugs the ink
 * (exact curve bounds, not the handle box), so a small glyph doesn't ship inside
 * a large empty frame. That is for artwork use — cropping each glyph to its own
 * drawing deliberately gives up the shared baseline/sidebearings a font import
 * needs, so the default stays the framed union.
 *
 * Winding is deliberately NOT re-normalized here: `buildFillGroups` already
 * forces solid layers all-CW (solid under nonzero, no spurious hole) and the
 * geometry service hands back CW-outer / CCW-hole for boolean results — that is
 * the FontForge-compatible winding. Running `correctWinding` again would punch
 * holes into nested solid layers and diverge from what the canvas shows.
 */
/** Everything that varies per export, as one object. Previously six positional params
 *  ending in two adjacent booleans (`mergeHalftones`, `silhouette`) — a swapped pair
 *  type-checked silently and would have shipped the wrong artwork. */
export interface GlyphSvgOptions extends RenderOptions {
  /** Universal scale applied to the artwork (not the em frame). */
  scalePct?: number;
  /** Export-only synthetic Bold/Italic. */
  style?: StyleTransform;
  /** Flat solid black, no colour/gradient/opacity — holes preserved. FontForge-ready. */
  silhouette?: boolean;
  /** Frame the viewBox to the artwork alone, dropping the em box (see the note above).
   *  Affects ONLY the frame — never the fill groups, so the render cache is untouched. */
  tightCrop?: boolean;
}

export function glyphToSvg(
  glyph: Glyph,
  metrics: FontMetrics,
  opts: GlyphSvgOptions = {},
): string {
  const { scalePct = 100, style, silhouette = false, tightCrop = false } = opts;
  const geom = getGeometryService();

  // Synthetic Bold/Italic (export-only). Build the fills UPRIGHT, then transform the
  // FINISHED outline — the skew/stretch is an exact affine of the final fill contours
  // (NOT a skeleton transform + stroke re-expansion, which re-exposed corner glitches).
  // Order: extend (x-only weight) on the upright fills, then shear/stretch the result.
  const styled = style && !isIdentityStyle(style);
  let groups = glyphFillGroups(glyph, geom, opts);
  if (styled && style.extensionUnits !== 0) {
    groups = groups.map((grp) => ({ ...grp, contours: extendOutlineX(grp.contours, style.extensionUnits, geom) }));
  }
  const advScale = styled ? style.stretchPct / 100 : 1;
  if (styled && (style.skewDeg !== 0 || style.stretchPct !== 100)) {
    const m = styleMatrix(style);
    groups = groups.map((grp) => ({ ...grp, contours: transformContours(grp.contours, m) }));
  }

  const s = scalePct / 100;

  // World-space bounds. Default: the em box (advance scaled by the stretch) unioned
  // with the actual — now sheared — artwork, so the frame keeps metric context yet
  // never crops. With tightCrop: the artwork alone, falling back to the em box when
  // the glyph is empty (there is no box to crop to, and a 0-size viewBox is invalid).
  const framed = advScale === 1 ? glyph : { ...glyph, advanceWidth: glyph.advanceWidth * advScale };
  const art = artworkBounds(groups);
  const bounds = tightCrop
    ? art ?? emBounds(framed, metrics)
    : unionBounds(emBounds(framed, metrics), art);

  // World → SVG: (x, y) → (s·x, −s·y). Frame the viewBox to the transformed box.
  // A flat span (a horizontal line cropped tight) would emit width/height 0, which
  // renders as nothing — keep at least one unit on each axis.
  const vbX = s * bounds.minX;
  const vbY = -s * bounds.maxY;
  const vbW = s * Math.max(bounds.maxX - bounds.minX, 1);
  const vbH = s * Math.max(bounds.maxY - bounds.minY, 1);

  // A gradient group emits a `<linearGradient>` in <defs> (the SAME pure spec the
  // canvas/preview use) and fills via url(#id); FontForge ignores it and flattens to
  // a solid, but browsers/preview render the gradient. Plain groups are unchanged.
  const defsParts: string[] = [];
  const drawn = groups
    .map((g) => ({ group: g, d: contoursToPath(g.contours) }))
    .filter((g) => g.d.length > 0);

  const paths = drawn
    .map(({ group, d }) => {
      // Silhouette: every region is flat solid black — no colour, gradient, or opacity.
      // Geometry/winding is untouched, so counters/holes still punch through.
      if (silhouette) return `    <path d="${d}" fill-rule="nonzero" fill="#000000" />`;
      const paint = group.paint;
      let fill = paint?.fill ?? "#000000"; // default (no paint) stays exactly "#000000"
      if (paint?.gradient) {
        const spec = linearGradientSpec(group)!;
        const stops = spec.stops
          .map((st) => {
            const so = st.opacity != null ? ` stop-opacity="${num(st.opacity)}"` : "";
            return `<stop offset="${num(st.offset)}" stop-color="${st.color}"${so} />`;
          })
          .join("");
        defsParts.push(
          `    <linearGradient id="${spec.id}" gradientUnits="objectBoundingBox" gradientTransform="${spec.transform}">${stops}</linearGradient>`,
        );
        fill = `url(#${spec.id})`;
      }
      const op = paint?.opacity != null && paint.opacity !== 1 ? ` fill-opacity="${num(paint.opacity)}"` : "";
      return `    <path d="${d}" fill-rule="nonzero" fill="${fill}"${op} />`;
    })
    .join("\n");

  const body = paths.length > 0 ? `\n${paths}\n  ` : "";
  const defs = defsParts.length > 0 ? `  <defs>\n${defsParts.join("\n")}\n  </defs>\n` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${num(vbX)} ${num(vbY)} ${num(vbW)} ${num(vbH)}" ` +
    `width="${num(vbW)}" height="${num(vbH)}">\n` +
    defs +
    `  <g transform="scale(${num(s)} ${num(-s)})">${body}</g>\n` +
    `</svg>\n`
  );
}

/** The em box in world units (Y-up): [0, advanceWidth] × [-descender, ascender]. */
function emBounds(glyph: Glyph, metrics: FontMetrics): BBox {
  return {
    minX: 0,
    minY: -metrics.descender,
    maxX: glyph.advanceWidth,
    maxY: metrics.ascender,
  };
}

/**
 * World-space bounds of the rendered artwork, measured on the curves themselves
 * (`contourTightBounds`) rather than on the control handles — the framed default
 * only needs "no clipping", but the tight crop would show every unit of slack.
 * Returns null when there is no geometry.
 */
function artworkBounds(groups: FillGroup[]): BBox | null {
  let box: BBox | null = null;
  for (const g of groups) {
    for (const c of g.contours) {
      box = growBounds(box, contourTightBounds(c));
    }
  }
  return box;
}

/** Union that tolerates a null on EITHER side (the accumulator starts empty). */
function growBounds(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  return unionBounds(a, b);
}

function unionBounds(a: BBox, b: BBox | null): BBox {
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Compact, stable number rendering for SVG attributes (3 decimals max). */
function num(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

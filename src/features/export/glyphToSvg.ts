import type { Glyph } from "../../types/document";
import type { FontMetrics } from "../../constants/metrics";
import { glyphFillGroups, type FillGroup, type RenderOptions } from "../canvas/layerFills";
import { linearGradientSpec } from "../canvas/fillPaint";
import { contoursToPath } from "../../engine/geometry/path";
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
}

export function glyphToSvg(
  glyph: Glyph,
  metrics: FontMetrics,
  opts: GlyphSvgOptions = {},
): string {
  const { scalePct = 100, style, silhouette = false } = opts;
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

  // World-space bounds: the em box (advance scaled by the stretch) unioned with the
  // actual — now sheared — artwork, so the frame keeps metric context yet never crops.
  const framed = advScale === 1 ? glyph : { ...glyph, advanceWidth: glyph.advanceWidth * advScale };
  const bounds = unionBounds(emBounds(framed, metrics), artworkBounds(groups));

  // World → SVG: (x, y) → (s·x, −s·y). Frame the viewBox to the transformed box.
  const vbX = s * bounds.minX;
  const vbY = -s * bounds.maxY;
  const vbW = s * (bounds.maxX - bounds.minX);
  const vbH = s * (bounds.maxY - bounds.minY);

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

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The em box in world units (Y-up): [0, advanceWidth] × [-descender, ascender]. */
function emBounds(glyph: Glyph, metrics: FontMetrics): Bounds {
  return {
    minX: 0,
    minY: -metrics.descender,
    maxX: glyph.advanceWidth,
    maxY: metrics.ascender,
  };
}

/**
 * World-space bounds of the rendered artwork. Anchor points AND their bezier
 * handles are included: a curve never leaves the box spanned by its control
 * points, so this is a safe (slightly generous) superset that guarantees no
 * clipping. Returns null when there is no geometry.
 */
function artworkBounds(groups: FillGroup[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of groups) {
    for (const c of g.contours) {
      for (const p of c.points) {
        for (const pt of [p, p.handleIn, p.handleOut]) {
          if (!pt) continue;
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
      }
    }
  }
  return maxX >= minX ? { minX, minY, maxX, maxY } : null;
}

function unionBounds(a: Bounds, b: Bounds | null): Bounds {
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

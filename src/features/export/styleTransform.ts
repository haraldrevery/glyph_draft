import type { Contour } from "../../types/geometry";
import {
  type Matrix,
  multiply,
  scaleAbout,
  shearX,
  transformAnchor,
  translate,
} from "../../engine/geometry/affine";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import type { GeometryService } from "../../engine/geometry/GeometryService";
import { contourWinding } from "../../engine/geometry/path";

/**
 * Export-time synthetic Bold/Italic. NOTHING is stored — the source stays
 * single-weight; this transforms each glyph only on the way out (see glyphToSvg).
 *
 * - `stretchPct` + `skewDeg` are NODE-level (applied to the centerline before stroke
 *   expansion, so strokes expand perpendicular to the skewed/stretched skeleton).
 * - `extensionUnits` is OUTLINE-level (applied to the final fills): a signed x-only
 *   horizontal extension — `+` dilates (bold weight, vertical stems only, height
 *   locked), `−` erodes (italic stem-thinning).
 */
export interface StyleTransform {
  /** Horizontal stretch, percent (100 = none). */
  stretchPct: number;
  /** Italic skew in degrees (0 = none): x += tan(deg)·y about the baseline. */
  skewDeg: number;
  /** Horizontal outline extension in font units (+dilate / −erode; 0 = none). */
  extensionUnits: number;
}

export const REGULAR_STYLE: StyleTransform = { stretchPct: 100, skewDeg: 0, extensionUnits: 0 };

/** A no-op style → callers skip all the work and emit the plain glyph. */
export function isIdentityStyle(s: StyleTransform): boolean {
  return s.stretchPct === 100 && s.skewDeg === 0 && s.extensionUnits === 0;
}

/** The node matrix: X-stretch (about x=0) then italic shear (about the baseline y=0). */
export function styleMatrix(s: StyleTransform): Matrix {
  const scale = scaleAbout(s.stretchPct / 100, 1, { x: 0, y: 0 });
  const shear = shearX(Math.tan((s.skewDeg * Math.PI) / 180));
  return multiply(shear, scale); // scale first, then shear
}

/** Apply an affine `m` to every node (+ handles) of each contour. Used to shear/stretch
 *  the FINAL filled outline (no stroke re-expansion → sharp corners stay clean) and,
 *  internally, to translate copies for the smear. A shear/positive-scale has det>0, so
 *  CW-outer / CCW-hole winding is preserved (counters survive). */
export function transformContours(contours: Contour[], m: Matrix): Contour[] {
  return contours.map((c) => ({ ...c, points: c.points.map((p) => transformAnchor(p, m)) }));
}

/** Target spacing (font units) between smear copies — small enough to avoid gaps on
 *  normal stems, capped so a full-font export stays reasonable. */
const SMEAR_STEP = 2;
const MAX_COPIES = 16;

function translateX(contours: Contour[], dx: number): Contour[] {
  return dx === 0 ? contours : transformContours(contours, translate(dx, 0));
}

/** Union/intersection of horizontally-translated copies, treating the input as SOLID
 *  areas (no holes among them — the caller separates outers from holes first). */
function smearSolids(
  contours: Contour[],
  abs: number,
  op: "union" | "intersect",
  geom: GeometryService,
): Contour[] {
  if (contours.length === 0) return [];
  const n = Math.max(1, Math.min(MAX_COPIES, Math.ceil((2 * abs) / SMEAR_STEP)));
  const step = (2 * abs) / n;
  let acc = translateX(contours, -abs);
  for (let i = 1; i <= n; i += 1) {
    const copy = translateX(contours, -abs + i * step);
    acc = op === "union" ? geom.union(acc, copy) : geom.intersect(acc, copy);
  }
  return acc;
}

/**
 * Horizontal outline extension — the x-only Minkowski with a segment [−d, d]×0:
 * `d>0` DILATES (bold weight, vertical stems +2d, horizontal strokes & height
 * unchanged), `d<0` ERODES. Vertical-only.
 *
 * The geometry-service booleans treat a contour SET as a UNION OF SOLIDS (so a
 * lone counter/annulus would fill solid). We therefore split the group into solid
 * outers (CW) and holes (CCW) and smear each: dilation grows the outer ink (union)
 * and **erodes** the counters (intersect), then subtracts the shrunk counters back
 * out; erosion does the reverse. Counters survive (the source fills are CW-outer /
 * CCW-hole; depth-1 nesting, the glyph case).
 */
export function extendOutlineX(
  contours: Contour[],
  d: number,
  geom: GeometryService = getGeometryService(),
): Contour[] {
  if (d === 0 || contours.length === 0) return contours;
  const abs = Math.abs(d);
  const grow = d > 0;
  const outers = contours.filter((c) => contourWinding(c) === "cw");
  const holes = contours.filter((c) => contourWinding(c) === "ccw");
  const ink = smearSolids(outers.length ? outers : contours, abs, grow ? "union" : "intersect", geom);
  if (holes.length === 0) return ink;
  const counters = smearSolids(holes, abs, grow ? "intersect" : "union", geom);
  return geom.subtract(ink, counters);
}

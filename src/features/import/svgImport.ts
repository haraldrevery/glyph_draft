import type { Contour, AnchorPoint, Paint } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import {
  type Matrix,
  IDENTITY,
  multiply,
  translate,
  scaleAbout,
  rotateAbout,
  transformAnchor,
} from "../../engine/geometry/affine";
import { correctWinding } from "../../engine/geometry/winding";
import { contourBounds } from "../../engine/geometry/align";
import { parsePathD, type ParsedSubpath } from "../../engine/geometry/svgPath";
import { createId } from "../../utils/id";

/**
 * Import an SVG string into our `Contour` model (one new layer's worth of geometry).
 *
 * - Shapes: `<path>` (full command set), `<rect>`, `<circle>`, `<ellipse>`, `<line>`,
 *   `<polyline>`, `<polygon>`. (`<use>`/text/images and rounded-rect corners are skipped.)
 * - Transforms on the element AND its `<g>` ancestors are flattened (matrix/translate/
 *   scale/rotate/skew).
 * - SVG is Y-down, our world is Y-up, so a final Y-flip is folded in — which means an SVG
 *   we exported (`glyphToSvg`, whose `scale(1,-1)` wrapper this flatten undoes) round-trips
 *   to the same coordinates.
 * - `fill` / `fill-opacity` (attribute, `style`, or inherited) map to `Contour.paint`
 *   (default black = no paint). Winding is normalized by `correctWinding`, so counters
 *   punch through under the renderer's nonzero fill (the layer is imported as `baked`).
 */

/** SVG (Y-down) → our world (Y-up). */
const FLIP_Y: Matrix = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };

const num = (v: string | null | undefined, fallback = 0): number => {
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** A presentation attribute, falling back to the same property in a `style=""` string. */
function attrOrStyle(el: Element, name: string): string | null {
  const a = el.getAttribute(name);
  if (a != null) return a;
  const style = el.getAttribute("style");
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/** Parse an SVG `transform` list into one matrix (composed left-to-right). */
export function parseTransform(s: string | null): Matrix {
  if (!s) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(s))) {
    const a = t[2]!.split(/[\s,]+/).filter((x) => x.length).map(Number);
    let next: Matrix = IDENTITY;
    switch (t[1]) {
      case "matrix":
        if (a.length >= 6) next = { a: a[0]!, b: a[1]!, c: a[2]!, d: a[3]!, e: a[4]!, f: a[5]! };
        break;
      case "translate":
        next = translate(a[0] ?? 0, a[1] ?? 0);
        break;
      case "scale":
        next = scaleAbout(a[0] ?? 1, a[1] ?? a[0] ?? 1, { x: 0, y: 0 });
        break;
      case "rotate": {
        const rad = ((a[0] ?? 0) * Math.PI) / 180;
        const pivot = a.length >= 3 ? { x: a[1]!, y: a[2]! } : { x: 0, y: 0 };
        next = rotateAbout(rad, pivot);
        break;
      }
      case "skewX":
        next = { a: 1, b: 0, c: Math.tan(((a[0] ?? 0) * Math.PI) / 180), d: 1, e: 0, f: 0 };
        break;
      case "skewY":
        next = { a: 1, b: Math.tan(((a[0] ?? 0) * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
        break;
    }
    m = multiply(m, next);
  }
  return m;
}

/** Effective fill/opacity → our `Paint` (undefined = the default black ink). */
export function toPaint(fill: string | undefined, opacity: number): Paint | undefined {
  const f = fill?.trim();
  const lower = f?.toLowerCase();
  const blackish = !f || lower === "black" || lower === "#000" || lower === "#000000";
  const p: Paint = {};
  if (f !== undefined && !blackish) p.fill = f; // a colour or "none" (keep original case)
  if (opacity !== 1) p.opacity = opacity;
  return p.fill !== undefined || p.opacity !== undefined ? p : undefined;
}

function corner(x: number, y: number): AnchorPoint {
  return { id: createId("pt"), type: "corner", x, y };
}
function smooth(p: Vec2, hIn: Vec2, hOut: Vec2): AnchorPoint {
  return { id: createId("pt"), type: "smooth", x: p.x, y: p.y, handleIn: hIn, handleOut: hOut };
}

const KAPPA = 0.5522847498307936;

/** A 4-segment cubic ellipse as one closed subpath. */
function ellipseSubpath(cx: number, cy: number, rx: number, ry: number): ParsedSubpath {
  if (rx <= 0 || ry <= 0) return { points: [], closed: false };
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const points: AnchorPoint[] = [
    smooth({ x: cx + rx, y: cy }, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
    smooth({ x: cx, y: cy + ry }, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
    smooth({ x: cx - rx, y: cy }, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
    smooth({ x: cx, y: cy - ry }, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
  ];
  return { points, closed: true };
}

function pointList(s: string | null): Vec2[] {
  if (!s) return [];
  const n = s.split(/[\s,]+/).filter((x) => x.length).map(Number);
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! });
  return out;
}

/** Local (untransformed) subpaths for a shape element, or [] if it isn't one. */
function shapeSubpaths(el: Element): ParsedSubpath[] {
  switch (el.localName) {
    case "path":
      return parsePathD(el.getAttribute("d") ?? "");
    case "rect": {
      const x = num(el.getAttribute("x"));
      const y = num(el.getAttribute("y"));
      const w = num(el.getAttribute("width"));
      const h = num(el.getAttribute("height"));
      if (w <= 0 || h <= 0) return [];
      return [{ points: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)], closed: true }];
    }
    case "circle": {
      const r = num(el.getAttribute("r"));
      return r > 0 ? [ellipseSubpath(num(el.getAttribute("cx")), num(el.getAttribute("cy")), r, r)] : [];
    }
    case "ellipse":
      return [ellipseSubpath(num(el.getAttribute("cx")), num(el.getAttribute("cy")), num(el.getAttribute("rx")), num(el.getAttribute("ry")))];
    case "line":
      return [{ points: [corner(num(el.getAttribute("x1")), num(el.getAttribute("y1"))), corner(num(el.getAttribute("x2")), num(el.getAttribute("y2")))], closed: false }];
    case "polyline":
    case "polygon": {
      const pts = pointList(el.getAttribute("points")).map((p) => corner(p.x, p.y));
      return pts.length >= 2 ? [{ points: pts, closed: el.localName === "polygon" }] : [];
    }
    default:
      return [];
  }
}

const CONTAINERS = new Set(["svg", "g", "a"]);
const SKIP = new Set(["defs", "clipPath", "mask", "symbol", "marker", "pattern"]);

export function importSvg(svgText: string): Contour[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  } catch {
    return [];
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return [];
  const root = doc.documentElement;
  if (!root || root.localName !== "svg") return [];

  const contours: Contour[] = [];

  const walk = (el: Element, ctm: Matrix, fill: string | undefined, opacity: number) => {
    if (SKIP.has(el.localName)) return;
    const ctm2 = multiply(ctm, parseTransform(el.getAttribute("transform")));
    const f = attrOrStyle(el, "fill");
    const o = attrOrStyle(el, "fill-opacity");
    const fill2 = f != null ? f : fill;
    const opacity2 = o != null ? Math.min(1, Math.max(0, parseFloat(o) || 0)) : opacity;

    const subs = shapeSubpaths(el);
    if (subs.length > 0) {
      const m = multiply(FLIP_Y, ctm2);
      const paint = toPaint(fill2, opacity2);
      for (const sub of subs) {
        if (sub.points.length < 2) continue;
        const c: Contour = {
          id: createId("ct"),
          closed: sub.closed,
          points: sub.points.map((p) => transformAnchor(p, m)),
        };
        if (paint) c.paint = paint;
        contours.push(c);
      }
    }

    if (CONTAINERS.has(el.localName)) {
      for (const child of Array.from(el.children)) walk(child, ctm2, fill2, opacity2);
    }
  };

  walk(root, IDENTITY, undefined, 1);
  // Normalize winding so nested counters punch through under nonzero fill (baked layer).
  return correctWinding(contours);
}

/**
 * Fit contours into a UNIT box centred at the origin (longest side = 1, aspect kept),
 * the canonical form the halftone "svg" pattern is stored + stamped from (the engine
 * scales each stamp by the per-cell dot size). Returns the input unchanged if it has
 * no measurable extent.
 */
export function normalizePattern(contours: Contour[]): Contour[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    const bb = contourBounds(c);
    if (!bb) continue;
    minX = Math.min(minX, bb.minX);
    minY = Math.min(minY, bb.minY);
    maxX = Math.max(maxX, bb.maxX);
    maxY = Math.max(maxY, bb.maxY);
  }
  if (!Number.isFinite(minX)) return contours;
  const s = 1 / Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const m: Matrix = { a: s, b: 0, c: 0, d: s, e: -s * cx, f: -s * cy };
  return contours.map((c) => ({ ...c, points: c.points.map((p) => transformAnchor(p, m)) }));
}

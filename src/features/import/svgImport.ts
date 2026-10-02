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
 * - `fill` / `fill-opacity` / `opacity` map to `Contour.paint` (default black = no paint),
 *   resolved with CSS precedence: `style=""`, then embedded `<style>` rules (simple
 *   selectors — `parseStyleSheet`), then presentation attributes; inherited down `<g>`s.
 *   Stroke-only shapes (`fill="none"` + a stroke) still import as unfilled outlines —
 *   strokes are not converted. Winding is normalized by `correctWinding`, so counters
 *   punch through under the renderer's nonzero fill (the layer is imported as `baked`).
 */

/** SVG (Y-down) → our world (Y-up). */
const FLIP_Y: Matrix = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };

const num = (v: string | null | undefined, fallback = 0): number => {
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** One rule of an embedded `<style>` sheet, reduced to what the importer can apply. */
export interface CssRule {
  tag: string | null;
  id: string | null;
  classes: string[];
  /** id·100 + class·10 + tag·1 — compared first; `order` breaks ties (later wins). */
  specificity: number;
  order: number;
  decls: Record<string, string>;
}

/**
 * Parse the rules of an embedded `<style>` sheet. Only COMPOUND SIMPLE selectors are
 * kept (`.cls-1`, `path`, `rect.a.b`, `#logo`, and lists of them) — exactly what design
 * tools emit (Illustrator's default SVG export puts every colour in `.cls-N` rules,
 * which the importer used to ignore, turning everything black). Anything it can't
 * evaluate here (descendant/child combinators, pseudo-classes, `@media`) is skipped
 * rather than guessed. Pure: no DOM.
 */
export function parseStyleSheet(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const text = stripAtRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  const block = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = block.exec(text))) {
    const decls: Record<string, string> = {};
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const value = d.slice(i + 1).replace(/!important/i, "").trim();
      if (prop && value) decls[prop] = value;
    }
    for (const raw of m[1]!.split(",")) {
      const sel = raw.trim();
      const parts = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/.exec(sel);
      if (!sel || sel.startsWith("@") || !parts) continue;
      const tag = parts[1] ?? null;
      const id = parts[2] ? parts[2].slice(1) : null;
      const classes = parts[3] ? parts[3].split(".").filter(Boolean) : [];
      if (!tag && !id && classes.length === 0) continue;
      const specificity = (id ? 100 : 0) + classes.length * 10 + (tag ? 1 : 0);
      rules.push({ tag, id, classes, specificity, order: order++, decls });
    }
  }
  return rules;
}

/** Drop every top-level @-rule (`@media … { … }`, `@import …;`) with its nested block —
 *  conditional styles can't be evaluated for an import, so they must not leak in. */
function stripAtRules(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] !== "@") {
      out += css[i];
      i += 1;
      continue;
    }
    let depth = 0;
    for (; i < css.length; i += 1) {
      const ch = css[i];
      if (ch === ";" && depth === 0) break;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i += 1; // past the closing `}` / `;`
  }
  return out;
}

/** What the cascade needs to know about one element (decoupled from the DOM for tests). */
export interface StyleTarget {
  tag: string;
  id: string | null;
  classes: string[];
  attr: (name: string) => string | null;
  inlineStyle: string | null;
}

/**
 * The element's OWN declared value for a property, by CSS precedence: the `style=""`
 * attribute, then the most specific matching sheet rule (later wins a tie), then the
 * presentation attribute (`fill="…"`). Presentation attributes are the WEAKEST source —
 * the importer used to check them first, so `fill="red" style="fill:blue"` (blue in
 * every browser) imported red. Returns null when the element doesn't set it (inherit).
 */
export function cascadeProp(name: string, el: StyleTarget, rules: CssRule[]): string | null {
  if (el.inlineStyle) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(el.inlineStyle);
    if (m && m[1]) return m[1].replace(/!important/i, "").trim();
  }
  let best: CssRule | null = null;
  for (const r of rules) {
    if (!(name in r.decls)) continue;
    if (r.tag && r.tag !== el.tag) continue;
    if (r.id && r.id !== el.id) continue;
    if (!r.classes.every((c) => el.classes.includes(c))) continue;
    if (!best || r.specificity > best.specificity || (r.specificity === best.specificity && r.order > best.order)) best = r;
  }
  if (best) return best.decls[name]!;
  return el.attr(name);
}

/**
 * An opacity value (`0.5` or `50%`) clamped to [0, 1], or null when it isn't a usable
 * number — `inherit`, a typo — so the caller falls back to the inherited value. (It used
 * to become 0 through `parseFloat(…) || 0`, which made the shape invisible.)
 */
export function parseOpacity(v: string | null): number | null {
  if (v == null) return null;
  const t = v.trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, t.endsWith("%") ? n / 100 : n));
}

/** Parse an SVG `transform` list into one matrix (composed left-to-right). */
export function parseTransform(s: string | null): Matrix {
  if (!s) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(s))) {
    // parseFloat (not Number) so CSS-style units ("10px", "45deg") read as their
    // number instead of NaN — a NaN here poisoned every point of the import.
    const a = t[2]!.split(/[\s,]+/).filter((x) => x.length).map(parseFloat);
    if (!a.every(Number.isFinite)) continue; // unparseable function → ignore it
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
  // A paint server (`url(#gradient)`) or `currentColor` has no flat-colour equivalent
  // here; passing it through made the shape INVISIBLE (the reference resolves to
  // nothing in our document) and wrote an unresolvable fill into exported SVGs.
  // Fall back to the default ink so the shape at least shows.
  const unrepresentable = !!lower && (lower.startsWith("url(") || lower === "currentcolor");
  const blackish =
    !f || unrepresentable || lower === "black" || lower === "#000" || lower === "#000000";
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
  const n = s.split(/[\s,]+/).filter((x) => x.length).map(parseFloat);
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) out.push({ x: n[i]!, y: n[i + 1]! });
  }
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

  // Embedded <style> sheets (Illustrator / Figma exports keep colours in class rules).
  const rules = parseStyleSheet(
    Array.from(doc.getElementsByTagName("style"))
      .map((s) => s.textContent ?? "")
      .join("\n"),
  );
  const target = (el: Element): StyleTarget => ({
    tag: el.localName,
    id: el.getAttribute("id"),
    classes: (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
    attr: (n) => el.getAttribute(n),
    inlineStyle: el.getAttribute("style"),
  });

  // `fill` and `fill-opacity` INHERIT; `opacity` doesn't, but a group's opacity fades
  // everything inside it, so it is carried down as a running product (an approximation of
  // group compositing that is exact for non-overlapping children).
  const walk = (el: Element, ctm: Matrix, fill: string | undefined, fillOpacity: number, groupOpacity: number) => {
    if (SKIP.has(el.localName)) return;
    const ctm2 = multiply(ctm, parseTransform(el.getAttribute("transform")));
    const t = target(el);
    const f = cascadeProp("fill", t, rules);
    const fo = cascadeProp("fill-opacity", t, rules);
    const o = cascadeProp("opacity", t, rules);
    const fill2 = f != null && f.trim().toLowerCase() !== "inherit" ? f : fill;
    const fillOpacity2 = parseOpacity(fo) ?? fillOpacity;
    const groupOpacity2 = groupOpacity * (parseOpacity(o) ?? 1);

    const subs = shapeSubpaths(el);
    if (subs.length > 0) {
      const m = multiply(FLIP_Y, ctm2);
      const paint = toPaint(fill2, fillOpacity2 * groupOpacity2);
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
      for (const child of Array.from(el.children)) walk(child, ctm2, fill2, fillOpacity2, groupOpacity2);
    }
  };

  walk(root, IDENTITY, undefined, 1, 1);
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

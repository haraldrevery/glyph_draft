import { DEFAULT_HALFTONE, type Contour, type GradientFill, type Paint } from "../../types/geometry";
import type { BooleanPair, Glyph } from "../../types/document";
import type { GeometryService } from "../../engine/geometry/GeometryService";
import { ensureWinding } from "../../engine/geometry/path";
import { withCorners } from "../../engine/geometry/corners";
import { blendContours } from "../../engine/geometry/blend";

/** Default in-between steps for a Blend pair when the UI hasn't set one. */
const DEFAULT_BLEND_STEPS = 4;

/**
 * Builds the per-fill contour groups the renderer (and, in Phase 6, the
 * exporter) paints. Two rules, both non-destructive — the input layers are never
 * mutated:
 *
 *  1. A layer ON ITS OWN: unstroked closed contours are forced to the same
 *     winding (solid under nonzero — no hole from nesting), while a STROKED path
 *     is expanded to its filled outline (which legitimately carries a hole). See
 *     renderContours.
 *
 *  2. Two layers joined by a BooleanPair are combined by the geometry service
 *     (union / subtract / intersect / exclude). The UPPER layer in the stack is
 *     operand A, the LOWER is B (Subtract = A − B). The result is emitted ONCE,
 *     at the lower layer's paint position, and both operands' own fills are
 *     suppressed. Both layers stay separate and editable; moving either updates
 *     the result live. A layer is in at most one pair.
 *
 * `layers` is bottom-to-top (paint order); groups come back in the same order.
 */

export interface FillLayer {
  id: string;
  contours: Contour[];
  /** A baked/merged layer: render its contours as-is (winding preserved, no
   *  stroke expansion, no force-CW). See Layer.baked. */
  baked?: boolean;
}

export interface FillGroup {
  /** Stable React key: a plain layer id, a `layerId#paint` id, or a boolean pair id. */
  id: string;
  contours: Contour[];
  /** Fill paint for the group (default = black ink). Set only when the contours
   *  carry a non-default `paint`; the no-paint case keeps the bare layer id + no
   *  paint, so the renderer/exporter emit exactly what they did before. */
  paint?: Paint;
}

/** A stable key for a paint (so same-paint contours land in one group). The default
 *  ink (no paint / undefined fill / no gradient) keys to "default" — the unchanged path.
 *  The gradient is part of the key so a gradient region never merges with a same-colour
 *  flat one (which would drop the gradient). */
function paintKey(p?: Paint): string {
  if (!p || (p.fill === undefined && p.opacity === undefined && p.gradient === undefined)) return "default";
  const g = p.gradient;
  const gk = g ? `${g.angle}/${g.to}/${g.midpoint}/${g.fade}/${g.toOpacity ?? ""}/${g.alongPath ? "p" : ""}` : "";
  return `${p.fill ?? ""}|${p.opacity ?? ""}|${gk}`;
}

/** The first non-default paint among contours, used to colour a boolean-pair result
 *  from its operand. Returns undefined when every contour is default black ink (so the
 *  pair group stays paint-less — byte-identical to the pre-inheritance default). */
function firstPaint(contours: Contour[]): Paint | undefined {
  for (const c of contours) {
    if (c.paint && paintKey(c.paint) !== "default") return c.paint;
  }
  return undefined;
}

/** Split a layer's rendered contours into fill groups by paint, preserving paint order.
 *  All-default contours collapse to ONE group with the bare layer id (byte-identical to
 *  the pre-paint behaviour); only when a real paint appears do extra groups split off. */
function groupByPaint(layerId: string, contours: Contour[]): FillGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, { paint?: Paint; contours: Contour[] }>();
  for (const c of contours) {
    const k = paintKey(c.paint);
    let g = byKey.get(k);
    if (!g) {
      g = { contours: [] };
      if (k !== "default" && c.paint) g.paint = c.paint;
      byKey.set(k, g);
      order.push(k);
    }
    g.contours.push(c);
  }
  if (order.length === 0) return [];
  if (order.length === 1 && order[0] === "default") return [{ id: layerId, contours }];
  return order.map((k) => {
    const g = byKey.get(k)!;
    const id = k === "default" ? layerId : `${layerId}#${k}`;
    return g.paint ? { id, contours: g.contours, paint: g.paint } : { id, contours: g.contours };
  });
}

/** A halftone-stroked contour (the only kind the "merge halftones" setting groups). */
function isHalftone(c: Contour): boolean {
  return !!c.stroke && c.stroke.model === "halftone";
}

// Stable ids for svg `pattern` arrays so two halftones merge only when they share the
// SAME imported pattern (equal-content but distinct arrays stay separate — conservative).
let patternCounter = 0;
const patternIds = new WeakMap<object, number>();
function patternId(pattern: object): number {
  let id = patternIds.get(pattern);
  if (id === undefined) {
    id = (patternCounter += 1);
    patternIds.set(pattern, id);
  }
  return id;
}

/** Signature that buckets IDENTICAL-style halftone contours: the stroke fields that shape
 *  the body (width/join/miter/caps) + the halftone params + the paint. Same signature ⇒
 *  the paths render as one combined halftone (`expandHalftoneGroup`). */
function halftoneKey(c: Contour): string {
  const s = c.stroke!;
  const h = s.halftone ?? DEFAULT_HALFTONE;
  return JSON.stringify({
    w: s.width,
    j: s.join,
    m: s.miterLimit ?? null,
    sc: s.startCap,
    ec: s.endCap,
    h: { c: h.cell, s: h.size, a: h.angle, sh: h.shape, ct: h.contrast ?? 0.5 },
    pat: h.pattern ? patternId(h.pattern) : 0,
    paint: c.paint ?? null,
  });
}

/** A gradient running ALONG the path: replace its `angle` with the contour's
 *  first→last node direction (world degrees; the renderers' Y-flip handling matches the
 *  fill knob's convention, so this is just atan2(Δy, Δx)). Non-alongPath = unchanged. */
function resolveGradient(g: GradientFill, c: Contour): GradientFill {
  if (!g.alongPath || c.points.length < 2) return g;
  const a = c.points[0]!;
  const b = c.points[c.points.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return g; // degenerate (e.g. a closed loop) → keep the set angle
  return { ...g, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** The paint for a stroked contour's outline: its own `color`/`gradient` (a gradient
 *  always pins a concrete first-stop `fill` so grouping keeps it), else the legacy
 *  fallback to the contour's `paint`. */
function strokeOutlinePaint(c: Contour): Paint | undefined {
  const s = c.stroke!;
  if (s.gradient) {
    const fill = s.color ?? c.paint?.fill ?? "#000000";
    return { fill, gradient: resolveGradient(s.gradient, c) };
  }
  return s.color ? { fill: s.color } : c.paint;
}

/**
 * A layer's fillable contours. Fill and stroke are INDEPENDENT: a closed path can
 * emit its CW interior fill (when `filled`) AND its stroke outline (when `stroke`) —
 * two separate groups. `filled` defaults to the legacy rule (closed, unstroked, not
 * Transparent), so without the new fields the output is byte-identical: a stroked
 * path is outline-only, an unstroked closed path is a solid CW fill. A stroked path's
 * outline still carries a CCW hole; holes within a plain layer come from a stroke or a
 * between-layer Subtract — never from winding.
 *
 * When `mergeHalftones` is on, same-style halftone-stroked paths in the layer are
 * rendered as ONE combined halftone (`expandHalftoneGroup`) instead of one per path,
 * so abutting paths read as a single continuous tone. A lone halftone path, and
 * everything else, renders exactly as with the flag off (default-off ⇒ byte-identical).
 */
function renderContours(layer: FillLayer, geom: GeometryService, mergeHalftones: boolean): Contour[] {
  // A baked (merged) layer is already final geometry: render it verbatim so its
  // holes (CCW) survive nonzero fill — do NOT force-CW or re-expand strokes.
  if (layer.baked) return layer.contours;
  const out: Contour[] = [];

  // Pre-pass: bucket same-style halftone paths; a bucket of ≥2 renders as one combined
  // halftone, and its source contours are skipped in the main loop below.
  const merged = new Set<string>();
  if (mergeHalftones) {
    const buckets = new Map<string, { raws: Contour[]; cs: Contour[] }>();
    for (const raw of layer.contours) {
      if (raw.points.length < 2 || !isHalftone(raw)) continue;
      const c = withCorners(raw);
      const k = halftoneKey(c);
      const b = buckets.get(k);
      if (b) {
        b.raws.push(raw);
        b.cs.push(c);
      } else {
        buckets.set(k, { raws: [raw], cs: [c] });
      }
    }
    for (const { raws, cs } of buckets.values()) {
      if (cs.length < 2) continue; // a lone halftone path falls through to the normal path
      const stroke = cs[0]!.stroke!;
      const paint = cs[0]!.paint;
      for (const o of geom.expandHalftoneGroup(cs, stroke)) out.push(paint ? { ...o, paint } : o);
      for (const r of raws) merged.add(r.id);
    }
  }

  for (const raw of layer.contours) {
    if (raw.points.length < 2 || merged.has(raw.id)) continue;
    // Non-destructive PATH-corner rounding (round/chamfer/inverted) runs FIRST, so the
    // rounded centerline feeds stroke expansion and the fill alike. No-op without it.
    const c = withCorners(raw);
    // Fill and stroke are INDEPENDENT (a closed path can have both). `filled` defaults to
    // the legacy rule (closed, unstroked, not Transparent) so old saves are byte-identical.
    const isFilled = c.filled ?? (c.closed && !c.stroke && c.paint?.fill !== "none");
    // Interior fill — carries the contour's `paint` (the fill colour).
    if (c.closed && isFilled) {
      const w = ensureWinding(c, "cw");
      out.push(c.paint ? { ...w, paint: c.paint } : w);
    }
    // Stroke outline — coloured by the stroke's own `color`/`gradient`, else (legacy) the
    // contour's `paint`, so an existing stroked path keeps its colour.
    if (c.stroke) {
      const strokePaint = strokeOutlinePaint(c);
      for (const o of geom.expandStroke(c, c.stroke)) out.push(strokePaint ? { ...o, paint: strokePaint } : o);
    }
  }
  return out;
}

export function buildFillGroups(
  layers: FillLayer[],
  pairs: BooleanPair[],
  geom: GeometryService,
  mergeHalftones = false,
): FillGroup[] {
  const indexById = new Map(layers.map((l, i) => [l.id, i] as const));

  // Expand strokes / solidify once per layer (an operand is reused by its pair).
  const renderedCache = new Map<string, Contour[]>();
  const rendered = (layer: FillLayer): Contour[] => {
    let r = renderedCache.get(layer.id);
    if (!r) {
      r = renderContours(layer, geom, mergeHalftones);
      renderedCache.set(layer.id, r);
    }
    return r;
  };

  // Map each layer to its pair, but only for pairs whose BOTH members are
  // present (a hidden operand falls back to painting the visible one normally).
  const pairByLayer = new Map<string, BooleanPair>();
  for (const p of pairs) {
    if (indexById.has(p.layerIds[0]) && indexById.has(p.layerIds[1])) {
      pairByLayer.set(p.layerIds[0], p);
      pairByLayer.set(p.layerIds[1], p);
    }
  }

  const groups: FillGroup[] = [];
  const emitted = new Set<string>();

  for (const layer of layers) {
    const pair = pairByLayer.get(layer.id);
    if (!pair) {
      // Per-layer fill, split by paint (one black group when nothing is coloured).
      groups.push(...groupByPaint(layer.id, rendered(layer)));
      continue;
    }
    if (emitted.has(pair.id)) continue; // already emitted at the lower member
    emitted.add(pair.id);

    // Order operands by stack position: upper (higher index) = A, lower = B.
    const i0 = indexById.get(pair.layerIds[0])!;
    const i1 = indexById.get(pair.layerIds[1])!;
    const upper = layers[Math.max(i0, i1)]!;
    const lower = layers[Math.min(i0, i1)]!;

    // Blend (5th op): an A→B shape-morph echo. Interpolate the RAW contours (so B = a
    // moved/scaled copy of A matches point-for-point), emit one solid-fill group per
    // step (bottom→top z), each carrying the pair's inherited paint. Topology mismatch
    // (or stroked/baked operands the raw lerp can't match) ⇒ render both operands as
    // usual — never a glitch. The 4 boolean ops below are untouched.
    if (pair.op === "blend") {
      const seq = blendContours(lower.contours, upper.contours, pair.steps ?? DEFAULT_BLEND_STEPS);
      if (seq) {
        // Render each step like a normal LAYER: strokes expand to outlines, corners
        // apply, per-contour paint splits — so blend honours outlined/multi-path layers.
        seq.forEach((step, k) => {
          const stepId = `${pair.id}#b${k}`;
          groups.push(...groupByPaint(stepId, renderContours({ id: stepId, contours: step }, geom, mergeHalftones)));
        });
      } else {
        groups.push(...groupByPaint(lower.id, rendered(lower)));
        groups.push(...groupByPaint(upper.id, rendered(upper)));
      }
      continue;
    }

    const contours = geom[pair.op](rendered(upper), rendered(lower));
    // Emitted at the first-encountered (lower) member → result sits at lower z. The
    // boolean flattens operands to one region, so it carries ONE paint: operand A's
    // (the upper layer), else B's — a colour set on either operand survives the pair
    // instead of reverting to black. No paint on either operand → paint-less (black).
    if (contours.length > 0) {
      const paint = firstPaint(rendered(upper)) ?? firstPaint(rendered(lower));
      groups.push(paint ? { id: pair.id, contours, paint } : { id: pair.id, contours });
    }
  }

  return groups;
}

/**
 * The fill groups for a WHOLE glyph (its visible layers + boolean pairs) — the same
 * pipeline the canvas and `glyphToSvg` export use, so a glyph renders identically in
 * the canvas, the export, and the text-preview window. The committed glyph data only
 * (no live-drag overrides), so it's safe to call for any glyph, not just the active one.
 *
 * Memoized by GLYPH IDENTITY: glyphs are immutable (an edit replaces the glyph object),
 * so the cached groups are valid exactly while the same glyph object is requested again.
 * This makes the text-preview window (rebuilt per keystroke) and bulk export cheap — the
 * underlying glyph data hasn't changed, so the heavy stroke/boolean geometry is reused.
 * The WeakMap auto-evicts replaced glyphs. (Callers treat the groups as read-only.)
 *
 * The cache is keyed by the `mergeHalftones` flag too (two WeakMaps), so toggling that
 * setting never returns a stale cached build for an unchanged glyph.
 */
const glyphFillCache = new WeakMap<Glyph, FillGroup[]>();
const glyphFillCacheMerged = new WeakMap<Glyph, FillGroup[]>();

export function glyphFillGroups(
  glyph: Glyph,
  geom: GeometryService,
  mergeHalftones = false,
): FillGroup[] {
  const cache = mergeHalftones ? glyphFillCacheMerged : glyphFillCache;
  const cached = cache.get(glyph);
  if (cached) return cached;
  const layers: FillLayer[] = glyph.layers
    .filter((l) => l.visible)
    .map((l) => ({ id: l.id, contours: l.contours, ...(l.baked ? { baked: true } : {}) }));
  const groups = buildFillGroups(layers, glyph.booleanPairs ?? [], geom, mergeHalftones);
  cache.set(glyph, groups);
  return groups;
}

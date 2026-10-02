import { DEFAULT_HALFTONE, type Contour, type GradientFill, type Paint } from "../../types/geometry";
import type { BooleanOp, BooleanPair, Glyph, LayerGroup } from "../../types/document";
import type { GeometryService } from "../../engine/geometry/GeometryService";
import { ensureWinding } from "../../engine/geometry/path";
import { withCorners } from "../../engine/geometry/corners";
import { blendContours } from "../../engine/geometry/blend";
import { resolvedLayers } from "../layers/layerTree";
import { DEFAULT_INK, isDefaultInk } from "../../engine/paint/paint";

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
  /** Render EVERY contour of this layer verbatim (winding preserved, no stroke
   *  expansion, no force-CW). Internal to the render pipeline — set only on the synthetic
   *  layer a render-as-one group collapses into, whose contours are already final.
   *  Document data marks baked geometry per contour instead (`Contour.baked`). */
  baked?: boolean;
  /** The layer's group, if any — read by `flattenRenderGroups` to collapse a
   *  `renderAsOne` group into a single synthetic layer. */
  groupId?: string;
}

/**
 * Render-affecting options threaded through the whole fill pipeline
 * (`glyphFillGroups` → `buildFillGroups` → `renderContours`), and on to the export.
 *
 * These are GLOBAL switches that change the geometry a glyph renders to, as opposed to
 * per-contour style, which lives on the model. They travel as one object rather than as
 * positional booleans: the chain already carried two adjacent booleans at the export end
 * (`mergeHalftones`, `silhouette`), where a swapped pair type-checks silently. Adding a
 * new switch means adding a field here — every consumer keeps compiling, and the
 * identity-keyed caches pick it up automatically via `renderKey`.
 */
export interface RenderOptions {
  /** Render same-style halftone paths in a layer as ONE continuous tone (settings v6).
   *  Off ⇒ byte-identical to the pre-merge pipeline. */
  mergeHalftones?: boolean;
}

/** Stable cache key for a RenderOptions value. Extend alongside the interface. */
function renderKey(opts: RenderOptions): string {
  return opts.mergeHalftones ? "m1" : "m0";
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

/** A halftone-stroked contour (the only kind the "merge halftones" setting groups). A
 *  baked contour renders verbatim, so its stroke (if any) is never expanded. */
function isHalftone(c: Contour): boolean {
  return !c.baked && !!c.stroke && c.stroke.model === "halftone";
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
 *  the body (width/join/miter/caps) + the halftone params + the OUTLINE paint the dots are
 *  drawn in (`strokeOutlinePaint` — the stroke's own colour/gradient, else the legacy fill
 *  paint). Same signature ⇒ the paths render as one combined halftone. */
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
    paint: strokeOutlinePaint(c) ?? null,
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
 *  fallback to the contour's `paint`. A black stroke colour is the DEFAULT INK (no
 *  paint) — the same rule fills follow — so it draws in the theme's ink on the canvas,
 *  not as near-invisible literal black on the dark theme. (Export: black either way.) */
function strokeOutlinePaint(c: Contour): Paint | undefined {
  const s = c.stroke!;
  if (s.gradient) {
    const fill = s.color ?? c.paint?.fill ?? DEFAULT_INK;
    return { fill, gradient: resolveGradient(s.gradient, c) };
  }
  if (s.color === undefined) return c.paint; // legacy: the outline follows the fill paint
  return isDefaultInk(s.color) ? undefined : { fill: s.color };
}

/**
 * Everything ONE contour renders to — the single definition of a contour's appearance.
 * The layer pipeline (`renderContours`) and Expand stroke both use it, so an expanded
 * stroke is exactly what the canvas showed. (Expand once re-implemented this and drifted:
 * it painted the outline with the FILL colour and dropped a filled path's interior.)
 *
 *  - baked → the contour itself, verbatim (its winding — so its holes — kept);
 *  - its INTERIOR, when `filled` (undefined ⇒ the legacy rule: closed, unstroked, not
 *    Transparent) → the contour forced CW, carrying `paint`;
 *  - its STROKE OUTLINE, when stroked → the expanded outline, painted by
 *    `strokeOutlinePaint` (the stroke's own colour/gradient, else the legacy fill paint).
 *
 * Fill and stroke are INDEPENDENT, so a closed path can emit both. Corner rounding runs
 * first, so the rounded centerline feeds the fill and the stroke alike. `stroke: false`
 * leaves the outline out (the merged-halftone pre-pass draws it for the whole bucket).
 */
export function renderContour(
  raw: Contour,
  geom: GeometryService,
  { stroke = true }: { stroke?: boolean } = {},
): Contour[] {
  if (raw.baked) return [raw];
  if (raw.points.length < 2) return [];
  const c = withCorners(raw);
  const out: Contour[] = [];
  const isFilled = c.filled ?? (c.closed && !c.stroke && c.paint?.fill !== "none");
  if (c.closed && isFilled) {
    const w = ensureWinding(c, "cw");
    out.push(c.paint ? { ...w, paint: c.paint } : w);
  }
  if (stroke && c.stroke) {
    const strokePaint = strokeOutlinePaint(c);
    for (const o of geom.expandStroke(c, c.stroke)) out.push(strokePaint ? { ...o, paint: strokePaint } : o);
  }
  return out;
}

/**
 * A layer's fillable contours: `renderContour` over each contour (a baked contour stays
 * verbatim; unstroked closed contours come out CW, so they fill as one solid union — holes
 * within a plain layer come only from a stroke outline, a baked contour, or a
 * between-layer Subtract, never from winding).
 *
 * When `mergeHalftones` is on, same-style halftone-stroked paths in the layer are
 * rendered as ONE combined halftone (`expandHalftoneGroup`) instead of one per path,
 * so abutting paths read as a single continuous tone. Their interiors (if filled) still
 * render per path. A lone halftone path, and everything else, renders exactly as with
 * the flag off (default-off ⇒ byte-identical).
 *
 * Memoized by the INPUT ARRAY's identity (contours are immutable, Invariant 2), validated
 * by everything else the output depends on. A drag re-renders the glyph every frame; with
 * this, only the layer actually being edited is rebuilt, and its untouched neighbours keep
 * stable output identities — which in turn lets `cachedPairOp` and the blend cache hit.
 */
const renderCache = new WeakMap<
  Contour[],
  { baked: boolean; key: string; geom: GeometryService; result: Contour[] }
>();

function renderContours(layer: FillLayer, geom: GeometryService, opts: RenderOptions): Contour[] {
  const baked = !!layer.baked;
  const key = renderKey(opts);
  const hit = renderCache.get(layer.contours);
  if (hit && hit.baked === baked && hit.key === key && hit.geom === geom) return hit.result;
  const result = renderLayerContours(layer, geom, opts);
  renderCache.set(layer.contours, { baked, key, geom, result });
  return result;
}

function renderLayerContours(layer: FillLayer, geom: GeometryService, opts: RenderOptions): Contour[] {
  // The synthetic layer of a render-as-one group is already final geometry: verbatim.
  if (layer.baked) return layer.contours;
  const out: Contour[] = [];

  // Pre-pass: bucket same-style halftone paths; a bucket of ≥2 renders as one combined
  // halftone, and its source contours' OUTLINES are skipped in the main loop below.
  const merged = new Set<string>();
  if (opts.mergeHalftones) {
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
      // The bucket shares one outline paint (it is part of the key) — the same paint each
      // path's own halftone would have had, so merging never recolours the dots.
      const paint = strokeOutlinePaint(cs[0]!);
      for (const o of geom.expandHalftoneGroup(cs, stroke)) out.push(paint ? { ...o, paint } : o);
      for (const r of raws) merged.add(r.id);
    }
  }

  for (const raw of layer.contours) {
    out.push(...renderContour(raw, geom, { stroke: !merged.has(raw.id) }));
  }
  return out;
}

/**
 * The geometry of an A→B blend, memoized per operand-array identity + step count. The
 * steps are fresh contour objects, so recomputing them every render (every drag frame,
 * even on an unrelated layer) also defeated the per-contour stroke cache: a stroked
 * 8-step blend cost ~1 s per frame. Cached, the steps keep their identities and every
 * downstream cache hits.
 */
const blendCache = new WeakMap<Contour[], { upper: Contour[]; steps: number; seq: Contour[][] | null }>();

function cachedBlend(lower: Contour[], upper: Contour[], steps: number): Contour[][] | null {
  const hit = blendCache.get(lower);
  if (hit && hit.upper === upper && hit.steps === steps) return hit.seq;
  const seq = blendContours(lower, upper, steps);
  blendCache.set(lower, { upper, steps, seq });
  return seq;
}

/**
 * A Pathfinder boolean's result, memoized on the two operands' RENDERED arrays (stable
 * identities, courtesy of the `renderContours` cache) + op + engine. Without it every
 * pair re-ran its Paper boolean on every drag frame, whichever layer was being dragged.
 */
const pairCache = new WeakMap<
  Contour[],
  { lower: Contour[]; op: BooleanOp; geom: GeometryService; result: { contours: Contour[]; paint?: Paint } }
>();

function cachedPairOp(
  op: BooleanOp,
  upper: Contour[],
  lower: Contour[],
  geom: GeometryService,
): { contours: Contour[]; paint?: Paint } {
  const hit = pairCache.get(upper);
  if (hit && hit.lower === lower && hit.op === op && hit.geom === geom) return hit.result;
  const contours = geom[op](upper, lower);
  // The boolean flattens operands to one region, so it carries ONE paint: operand A's
  // (the upper layer), else B's — a colour set on either operand survives the pair
  // instead of reverting to black. No paint on either operand → paint-less (black).
  const paint = firstPaint(upper) ?? firstPaint(lower);
  const result = paint ? { contours, paint } : { contours };
  pairCache.set(upper, { lower, op, geom, result });
  return result;
}

export function buildFillGroups(
  layers: FillLayer[],
  pairs: BooleanPair[],
  geom: GeometryService,
  opts: RenderOptions = {},
): FillGroup[] {
  const indexById = new Map(layers.map((l, i) => [l.id, i] as const));

  // Expand strokes / solidify per layer (memoized across calls — see renderContours).
  const rendered = (layer: FillLayer): Contour[] => renderContours(layer, geom, opts);

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

    // Blend (5th op): an A→B shape-morph echo, bottom→top z: operand B, the in-between
    // steps, operand A. The two OPERANDS render exactly as themselves (their own colour,
    // fill, holes and curves) — pairing two layers must not restyle them. Only the
    // in-between steps are interpolated (`blendContours`) and rendered like a normal
    // layer (strokes expand, corners apply, per-contour paint splits). An empty operand
    // (nothing to blend) ⇒ just the operands. The 4 boolean ops below are untouched.
    if (pair.op === "blend") {
      const seq = cachedBlend(lower.contours, upper.contours, pair.steps ?? DEFAULT_BLEND_STEPS);
      groups.push(...groupByPaint(lower.id, rendered(lower)));
      if (seq) {
        for (let k = 1; k < seq.length - 1; k += 1) {
          const stepId = `${pair.id}#b${k}`;
          groups.push(...groupByPaint(stepId, renderContours({ id: stepId, contours: seq[k]! }, geom, opts)));
        }
      }
      groups.push(...groupByPaint(upper.id, rendered(upper)));
      continue;
    }

    // Emitted at the first-encountered (lower) member → result sits at lower z.
    const result = cachedPairOp(pair.op, rendered(upper), rendered(lower), geom);
    if (result.contours.length > 0) groups.push({ id: pair.id, ...result });
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
 * The cache is keyed by the RenderOptions too (one WeakMap per distinct `renderKey`),
 * so toggling a render switch never returns a stale cached build for an unchanged glyph.
 */
const glyphFillCaches = new Map<string, WeakMap<Glyph, FillGroup[]>>();

function cacheFor(opts: RenderOptions): WeakMap<Glyph, FillGroup[]> {
  const k = renderKey(opts);
  let c = glyphFillCaches.get(k);
  if (!c) {
    c = new WeakMap<Glyph, FillGroup[]>();
    glyphFillCaches.set(k, c);
  }
  return c;
}

/**
 * Fills for a set of visible layers, honouring layer GROUPS.
 *
 * The ONE entry point for "layers → fills": it applies the render-as-one group
 * pre-pass and then the normal pipeline. Both consumers go through it — the cached
 * whole-glyph path (`glyphFillGroups`, used by thumbnails/preview/export) and the
 * canvas (`GlyphView`, which needs live drag overrides so it cannot use the cache).
 *
 * Keeping this in one function is deliberate: when the flatten was applied separately
 * at each call site, forgetting one would have left the canvas showing ungrouped fills
 * while the export showed grouped ones — a divergence no unit test would catch, since
 * the canvas path is a React component.
 */
export function buildGlyphFills(
  layers: FillLayer[],
  groups: LayerGroup[],
  pairs: BooleanPair[],
  geom: GeometryService,
  opts: RenderOptions = {},
): FillGroup[] {
  return buildFillGroups(
    flattenRenderGroups(layers, groups, pairs, geom, opts),
    pairs,
    geom,
    opts,
  );
}

export function glyphFillGroups(
  glyph: Glyph,
  geom: GeometryService,
  opts: RenderOptions = {},
): FillGroup[] {
  const cache = cacheFor(opts);
  const cached = cache.get(glyph);
  if (cached) return cached;
  const layers: FillLayer[] = resolvedLayers(glyph)
    .filter((l) => l.visible)
    .map((l) => ({
      id: l.id,
      contours: l.contours,
      ...(l.groupId ? { groupId: l.groupId } : {}),
    }));
  const groups = buildGlyphFills(
    layers,
    glyph.layerGroups ?? [],
    glyph.booleanPairs ?? [],
    geom,
    opts,
  );
  cache.set(glyph, groups);
  return groups;
}

/**
 * Bake a set of layers down to ONE layer's worth of final contours — the exact
 * pipeline the canvas draws, flattened.
 *
 * Shared by destructive "Merge layers" and by the render-as-one group pre-pass below,
 * so a merged group is guaranteed to look identical to the same group rendered as one.
 * Any boolean pair fully inside `layers` is applied; a pair with one foot outside is
 * skipped by `buildFillGroups` (which only resolves pairs whose both members are present).
 */
export function bakeContours(
  layers: FillLayer[],
  pairs: BooleanPair[],
  geom: GeometryService,
  opts: RenderOptions = {},
): Contour[] {
  // A boolean-pair result carries its (inherited) paint on the GROUP, not on its
  // contours — flattening the groups alone dropped it, so a coloured pair turned black
  // when merged or rendered inside a render-as-one group. Stamp the group's paint onto
  // any contour that has none of its own. (Per-layer groups are split BY contour paint,
  // so their contours already carry exactly the group's paint: unchanged.)
  return buildFillGroups(layers, pairs, geom, opts).flatMap((g) =>
    g.paint ? g.contours.map((c) => (c.paint ? c : { ...c, paint: g.paint! })) : g.contours,
  );
}

/**
 * Cache one group's bake against EVERYTHING the bake reads, so a drag elsewhere in the
 * glyph doesn't re-bake every group on every frame:
 *  - the IDENTITY of each member's contour array (contours are immutable — Invariant 2 —
 *    so identical references mean identical geometry);
 *  - a signature of the member layers (ids + baked flag) and of the inner boolean
 *    pairs (ids, operands, op, blend steps) — pairs and flags live on the glyph, not on
 *    the contours, so without this a Pathfinder change INSIDE the group kept returning
 *    the old bake (on the canvas and in exported SVGs) until a member path was edited;
 *  - the geometry service instance.
 *
 * Keyed by group id AND `renderKey(opts)` — a render switch changes the baked geometry,
 * so keying on the group alone would hand back the other setting's bake (the same
 * mistake the twin mergeHalftones WeakMaps were built to avoid). Bounded by the number
 * of groups × distinct option sets; entries are replaced, not accumulated.
 */
const bakeCache = new Map<
  string,
  { keys: readonly Contour[][]; sig: string; geom: GeometryService; result: Contour[] }
>();

/** Everything about a bake's inputs that is NOT the contour arrays themselves. */
function bakeSignature(members: FillLayer[], pairs: BooleanPair[]): string {
  const m = members.map((l) => `${l.id}${l.baked ? "*" : ""}`).join(",");
  const p = pairs.map((x) => `${x.id}:${x.layerIds[0]}+${x.layerIds[1]}:${x.op}:${x.steps ?? ""}`).join(",");
  return `${m}|${p}`;
}

function cachedBake(
  groupId: string,
  members: FillLayer[],
  pairs: BooleanPair[],
  geom: GeometryService,
  opts: RenderOptions,
): Contour[] {
  const cacheKey = `${groupId}|${renderKey(opts)}`;
  const keys = members.map((m) => m.contours);
  const sig = bakeSignature(members, pairs);
  const hit = bakeCache.get(cacheKey);
  if (
    hit &&
    hit.geom === geom &&
    hit.sig === sig &&
    hit.keys.length === keys.length &&
    hit.keys.every((k, i) => k === keys[i])
  ) {
    return hit.result;
  }
  const result = bakeContours(members, pairs, geom, opts);
  bakeCache.set(cacheKey, { keys, sig, geom, result });
  return result;
}

/**
 * Collapse every `renderAsOne` group into ONE synthetic layer, so the group's contents
 * read as a single layer: overlaps inside it fuse into one region, and the group can act
 * as a single Pathfinder operand (its synthetic id is a valid `booleanPairs` member).
 *
 * A PRE-PASS over the `FillLayer[]` projection — `buildFillGroups` and the whole
 * boolean/blend/export path below it are untouched. The synthetic layer is `baked: true`
 * because its contours are already fully rendered (strokes expanded, unstroked closed
 * paths already forced CW, a baked member's CCW counters intact), so `renderContours`
 * must emit them verbatim rather than force-CW them a second time.
 *
 * Relies on the CONTIGUITY invariant: a group's members are an unbroken run, so one
 * linear pass collapses them in place and paint order is preserved.
 *
 * IDENTITY: with no render-as-one group this returns the SAME array, so an ungrouped
 * (or organisation-only) document is completely unaffected.
 */
export function flattenRenderGroups(
  layers: FillLayer[],
  groups: LayerGroup[],
  pairs: BooleanPair[],
  geom: GeometryService,
  opts: RenderOptions = {},
): FillLayer[] {
  if (groups.length === 0 || !groups.some((g) => g.renderAsOne)) return layers;
  const byId = new Map(groups.map((g) => [g.id, g] as const));

  // The TOPMOST render-as-one ancestor wins, so a plain folder nested inside a
  // render-as-one one still bakes into the single outer layer. Cycle-safe.
  const unitOf = (groupId?: string): string | null => {
    let unit: string | null = null;
    const seen = new Set<string>();
    let cur = groupId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = byId.get(cur);
      if (!g) break;
      if (g.renderAsOne) unit = g.id;
      cur = g.parentId;
    }
    return unit;
  };

  const out: FillLayer[] = [];
  let i = 0;
  while (i < layers.length) {
    const unit = unitOf(layers[i]!.groupId);
    if (!unit) {
      out.push(layers[i]!);
      i += 1;
      continue;
    }
    // Consume the whole contiguous run belonging to this unit.
    const start = i;
    while (i < layers.length && unitOf(layers[i]!.groupId) === unit) i += 1;
    const members = layers.slice(start, i);
    const ids = new Set(members.map((m) => m.id));
    const inner = pairs.filter((p) => ids.has(p.layerIds[0]) && ids.has(p.layerIds[1]));
    const contours = cachedBake(unit, members, inner, geom, opts);
    if (contours.length > 0) out.push({ id: unit, contours, baked: true });
  }
  return out;
}

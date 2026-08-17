/**
 * Vector geometry model. These describe a glyph's drawn outlines in absolute
 * font-unit coordinates (Y-up, baseline at y=0). They are not yet exercised by
 * Phase 1's canvas, but the GeometryService interface and the document store
 * are typed against them so the contracts are locked before the Pen tool lands
 * in Phase 2.
 *
 * Handles are stored in ABSOLUTE coordinates (not relative to the anchor). This
 * is deliberate: paste-in-place across glyphs and boolean ops both operate on
 * absolute positions, so keeping one canonical representation avoids a class of
 * conversion bugs.
 */

import type { Vec2 } from "./viewport";

export type PointType = "corner" | "smooth";

export interface AnchorPoint extends Vec2 {
  id: string;
  type: PointType;
  /** Incoming bezier handle, absolute coords. Undefined = straight segment. */
  handleIn?: Vec2;
  /** Outgoing bezier handle, absolute coords. Undefined = straight segment. */
  handleOut?: Vec2;
}

/** Winding direction of a closed contour. */
export type Winding = "cw" | "ccw";

/** Path-corner treatment applied (non-destructively, at render/export) to every
 *  `corner`-type node of a contour: a convex fillet, a straight cut, or a concave
 *  scoop. Distinct from `StrokeStyle.join` (which corners the stroke OUTLINE) — this
 *  rounds the centerline itself, upstream of stroke expansion. */
export type CornerType = "round" | "chamfer" | "invertedRound";
export interface CornerStyle {
  type: CornerType;
  /** Corner radius in font units; clamped per-corner to ½ the shorter adjacent edge. */
  radius: number;
}

/** Stroke line-end style. `serif` flares the terminal into a bracketed foot and
 *  `drop` swells it into an ink-pen bulb (each parametrized by a per-end style);
 *  the rest are simple caps. */
export type StrokeCap = "butt" | "round" | "rectangle" | "serif" | "drop";
/** Stroke corner style at anchors. */
export type StrokeJoin = "miter" | "round" | "bevel";

/**
 * A typographic serif (a "foot"/"ear") on one stroke terminal. It is a smooth
 * WIDTH FLARE sampled along the centerline (so the foot bends with the path),
 * optionally followed by a straight box projecting past the terminal. Optional
 * everywhere so it stays backward-compatible.
 */
export interface SerifStyle {
  /** Foot half-span across the stroke at its widest, in font units (each side). */
  length: number;
  /** Flare reach: how far back up the stem the foot eases in, in font units. */
  depth: number;
  /** Length of the constant-width foot box, in font units (0 = the foot eases
   *  straight off the terminal). With `anchor: "outward"` (default) the box
   *  projects PAST the terminal; with `anchor: "node"` it grows INWARD up the stem
   *  so the foot's far edge stays on the node. */
  project?: number;
  /** Where the foot box sits relative to the terminal. `"outward"` (default,
   *  legacy) projects past the node; `"node"` keeps the far edge on the node and
   *  grows inward. */
  anchor?: "outward" | "node";
  /** WORLD-ABSOLUTE orientation of the foot's flat far edge, in degrees from the
   *  canvas X axis (undefined = auto, i.e. perpendicular to the path). Shears the
   *  foot so its flat side sits at a chosen angle regardless of stem slant — a
   *  horizontal foot under a slanted stem, wedge/beak terminals, etc. */
  angle?: number;
  /** Foot asymmetry in [-1, 1]: 0 = symmetric (both sides flare equally), ±1 = the
   *  foot collapses to the stem on one side (a one-sided ear/beak/bracket). */
  bias?: number;
  /** Bracket depth in [0, 1]: the concave fillet that joins the stem to the flat
   *  foot (what makes a serif read as a serif rather than a slab). 0 (default) =
   *  the legacy abrupt foot (no fillet); →1 = a deep, gentle bracket sweep. */
  bracket?: number;
  /** Foot SHAPE: `"a"` (default, absent) = the concave BRACKET fillet (cups into the
   *  stem, tangent at the top); `"b"` = a WEDGE (straight diagonal sides → convex
   *  flare; `bracket` reads as the flare amount, 0 = straight). Both are built into
   *  the sampled outline (seamless — no union); A also honors a world/handle `angle`,
   *  B is tangent-only (so it can't kink on a curved/steep stem). */
  variant?: "a" | "b";
}

/**
 * A "drop" terminal — a teardrop INK-POOL (where an ink pen touches the paper): the
 * stroke's own outline SWELLS from the stem up to a rounded ink pool at the terminal
 * and a round cap closes it, so the stem flows seamlessly out of the pool (no seam,
 * no bolted-on bulb). `size` is the ink-pool radius; `ratio` the reach (how far up the
 * stem the swell eases in — larger = a longer teardrop); `smear` a lateral lean of the
 * pool in [-1, 1]. `anchor`/`neck` are inert (kept for back-compat).
 */
export interface DropStyle {
  size: number;
  ratio: number;
  smear?: number;
  anchor?: "center" | "far";
  /** Neck pinch ratio in (0,1] — variant "b" only: the half-width the stem pinches to
   *  before swelling into the bulb (× the stem half-width; smaller = a tighter neck).
   *  Default ~0.55. (Inert for variant "a".) */
  neck?: number;
  /** Terminal algorithm: `"a"` (default, absent) = the round ink-pool dome (swell +
   *  tangent round cap); `"b"` = a SEAMLESS necked-bulb teardrop built from the body
   *  outline itself (stem → concave neck → round bulb → soft point), no unioned cap. */
  variant?: "a" | "b";
}

/**
 * A "rectangle" terminal cap (the parametric successor to the old fixed `square`
 * cap). Its FAR edge sits ON the node — the cap body grows INWARD up the stem
 * (the old square instead projected past the node). `size` is that inward depth
 * along the stem in font units; `ratio` is the cap's cross-width as a multiple of
 * the stroke half-width (1 = flush with the stem edges); `angle` is the WORLD-
 * ABSOLUTE orientation of the flat far edge in degrees from the canvas X axis
 * (undefined = auto, i.e. perpendicular to the path); `radius` rounds the two near
 * corners in [0,1] (0 = sharp 90° corners, the default).
 */
export interface RectCapStyle {
  size: number;
  ratio: number;
  angle?: number;
  radius?: number;
  /** Where the box sits relative to the terminal. `"node"` (default) keeps the far
   *  edge on the node and grows the box INWARD up the stem; `"outward"` projects the
   *  box PAST the node (a true overhanging slab terminal). */
  anchor?: "node" | "outward";
  /** Slab algorithm: `"a"` (default, absent) = a CRISP re-cut rectangle (the body is
   *  sliced at the far-edge plane, so a tilted/narrow slab never leaves the stem's
   *  butt corners sticking out); `"b"` = a SEAMLESS constructive flare (curved sides
   *  easing the stem out to the slab — graceful on curved/angled stems). */
  variant?: "a" | "b";
  /** Variant "b" only: how far UP the stem the flare eases, in font units (absent =
   *  derived from `size`). Larger = a longer, gentler flare. */
  reach?: number;
}

/** One control point of a stroke PROFILE: `x` is the normalized position along the
 *  path (0 = start node → 1 = end node), `y` the value at that position (meaning
 *  depends on the profile — a width multiplier or a nib angle). */
export interface ProfilePoint {
  x: number;
  y: number;
}

/**
 * A 1-D curve drawn over the length of a stroke (the "graph" the user shapes): an
 * x-sorted list of ≥2 control points with `x` spanning [0,1] (first at 0, last at
 * 1), smoothly interpolated (monotone cubic — see `engine/geometry/profile.ts`).
 * `loop` forces `y(0) === y(1)` so the curve wraps seamlessly (closed paths).
 */
export interface StrokeProfile {
  points: ProfilePoint[];
  loop?: boolean;
}

/**
 * A non-destructive stroke on a path: the contour keeps its editable centerline
 * and this describes how to EXPAND it into a filled outline at render/export
 * time.
 *
 * Uniform strokes are curve-exact. A BROAD-NIB stroke (`angle` set) emulates a
 * calligraphy pen — width modulates with the path direction — and is rendered as
 * a flattened polygon outline.
 *
 * The two ends are styled INDEPENDENTLY (`startCap`/`endCap`, plus optional
 * `startSerif`/`endSerif`) — "start" is the first anchor, "end" the last. The UI
 * offers a swap to exchange the two ends without redrawing.
 */
export interface StrokeStyle {
  /** Total stroke width in font units (expanded ±width/2 about the centerline).
   *  For a broad nib this is the nib's broad (major) width. */
  width: number;
  /** How the centerline is expanded into a filled body. `"offset"` (default) is the
   *  perpendicular two-sided offset / swept ribbon. `"brush"` is a true swept-brush
   *  ENVELOPE — a round (or nib) brush stamped along the path and unioned — so thick
   *  strokes with sharp corners read as pen-DRAWN and never glitch on tight curves
   *  (boolean unions can't self-intersect). `"halftone"` fills the ribbon with a
   *  screen-tone of small shapes (see `halftone`). `"dash"` breaks the line into dashes or
  *  dots along its length (see `dash`). Optional ⇒ old saves load unchanged. */
  model?: "offset" | "brush" | "halftone" | "dash";
  /** Outline colour (CSS colour). Undefined = legacy fallback to the contour's `paint`
   *  (so an old stroked path keeps its colour); lets a filled+stroked path colour its
   *  outline independently of its interior fill. Additive ⇒ old saves load unchanged. */
  color?: string;
  /** Optional gradient for the outline (decorative, like `Paint.gradient`). First stop =
   *  the stroke `color` (else fallback), second = `gradient.to`. With `alongPath` the
   *  gradient runs start→end of the line. Additive ⇒ old saves load unchanged. */
  gradient?: GradientFill;
  /** Cap at the first anchor. */
  startCap: StrokeCap;
  /** Cap at the last anchor. */
  endCap: StrokeCap;
  join: StrokeJoin;
  /** Miter clip ratio for sharp joins; defaults applied by the engine. */
  miterLimit?: number;
  /** Broad-nib angle in degrees (world space). When set, the stroke is a
   *  calligraphic nib sweep (flattened) instead of a uniform offset. */
  angle?: number;
  /** Nib thin/thick ratio in [0,1] (the nib's minor axis). Keeps the nib from
   *  pinching to zero width; only meaningful with `angle`. Engine default ~0.15. */
  contrast?: number;
  /** Serif at the first anchor (params for `startCap === "serif"`). */
  startSerif?: SerifStyle | null;
  /** Serif at the last anchor. */
  endSerif?: SerifStyle | null;
  /** Drop bulb at the first anchor (params for `startCap === "drop"`). */
  startDrop?: DropStyle | null;
  /** Drop bulb at the last anchor. */
  endDrop?: DropStyle | null;
  /** Rectangle cap at the first anchor (params for `startCap === "rectangle"`). */
  startRect?: RectCapStyle | null;
  /** Rectangle cap at the last anchor. */
  endRect?: RectCapStyle | null;
  /** For a `round` cap: put the rounded tip ON the node (far edge at the node) instead
   *  of centering the disc on it — so the cap doesn't project past the terminal. */
  startRoundAtNode?: boolean;
  endRoundAtNode?: boolean;
  /** Thickness profile along the path: `y` is a multiplier of `width` (1 = uniform,
   *  range ~0–2). When set, the stroke renders through the sampled (flattened)
   *  outline so the width can vary per position. */
  widthProfile?: StrokeProfile | null;
  /** Nib-angle profile along the path: `y` is the ABSOLUTE nib angle in degrees
   *  (−180…180). When set, the stroke is a calligraphic nib whose angle varies per
   *  position (overrides the constant `angle`). */
  angleProfile?: StrokeProfile | null;
  /** Params for `model === "halftone"` (defaults applied by the engine when absent). */
  halftone?: HalftoneStyle;
  /** Params for `model === "dash"` (defaults applied by the engine when absent). */
  dash?: DashStyle;
}

/** EXPERIMENTAL dash-stroke params: the line is broken into repeated elements along its
 *  length — `"dash"` blocks (the stroke width thick) or `"dot"` circles — with adjustable
 *  spacing. Used only by `model === "dash"`; ignored by every other model. */
export interface DashStyle {
  shape: "dash" | "dot" | "svg";
  /** ON length of each dash block / tick mark, in font units (shape `"dash"`). */
  dash: number;
  /** OFF gap between elements, in font units. */
  gap: number;
  /** Element size, in font units: dot diameter / custom-SVG box (defaults to stroke width). */
  size?: number;
  /** Size multiplier along the path (the graph profile, `y` ~0–2): scales each element's
   *  size by its value at that element's arc-length position. Absent = uniform. */
  sizeProfile?: StrokeProfile | null;
  /** Element orientation follows the path tangent (default true). When false, a `"svg"`
   *  element uses a FIXED angle, and a `"dash"` becomes a perpendicular tick mark. */
  align?: boolean;
  /** Fixed rotation in degrees. svg: added to its orientation (tangent if aligned, else
   *  world 0). dash tick (align=false): leans the perpendicular tick. Default 0. */
  angle?: number;
  /** For `shape === "svg"`: the imported element, normalized to a unit box centred at the
   *  origin (plain serializable contours; stamped + rotated to the tangent + scaled per step). */
  pattern?: Contour[];
}

/** A sensible starting dash when the user first switches a stroke to that model. */
export const DEFAULT_DASH: DashStyle = {
  shape: "dash",
  dash: 24,
  gap: 16,
};

/** EXPERIMENTAL halftone-stroke params: the stroke ribbon is filled with a regular
 *  grid of small shapes whose size FADES from the centerline to the edges (a tonal
 *  gradient). Used only by `model === "halftone"`; ignored by every other model. */
export type HalftoneShape = "circle" | "square" | "diamond" | "triangle" | "line" | "svg";
export interface HalftoneStyle {
  /** Grid pitch (centre-to-centre spacing) in font units. */
  cell: number;
  /** Maximum dot size (diameter / side) in font units, reached ON the centerline;
   *  it scales to 0 at the stroke edge. */
  size: number;
  /** Screen rotation of the grid, in degrees. */
  angle: number;
  /** The repeated element's shape. `"svg"` stamps the imported `pattern`. */
  shape: HalftoneShape;
  /** Falloff shaping in [0,1] (default 0.5 = LINEAR decay). >0.5 = dots decay faster
   *  (concentrate near the centerline); <0.5 = stay full, then drop at the edge. */
  contrast?: number;
  /** For `shape === "svg"`: the imported element, normalized to a unit box centred at
   *  the origin (plain serializable contours; stamped + scaled per cell). */
  pattern?: Contour[];
}

/** A sensible starting halftone when the user first switches a stroke to that model. */
export const DEFAULT_HALFTONE: HalftoneStyle = {
  cell: 28,
  size: 22,
  angle: 45,
  shape: "circle",
  contrast: 0.5,
};

/** A named, reusable stroke style — the unit of the user's brush/preset library. */
export interface StrokePreset {
  id: string;
  label: string;
  style: StrokeStyle;
}

/** A named set of fill colours — the unit of the user's saved colour palettes, for a
 *  consistent theme across glyphs. Colours are `#rrggbb` strings. */
export interface ColorPalette {
  id: string;
  label: string;
  colors: string[];
}

/**
 * How a filled region is painted. The default (no paint, or `fill` undefined) is the
 * document ink — solid black — so the glyph-drawing workflow and every old save are
 * unchanged. Set only when the user picks a colour (or an imported SVG carried one).
 * `fill` is a CSS colour or `"none"` (transparent); `opacity` is 0–1 (default 1).
 */
export interface Paint {
  fill?: string;
  opacity?: number;
  /** Optional linear gradient. When set, the region fills with a gradient from
   *  `fill` (the first stop, default black) to `gradient.to` (the second stop)
   *  instead of a flat colour. Additive/optional so old saves load unchanged.
   *  Gradients are decorative (canvas/preview/export SVG) — NOT FontForge font
   *  outline data; FontForge import will flatten them to a solid. */
  gradient?: GradientFill;
}

/**
 * A two-stop linear gradient. The first stop reuses `Paint.fill` (default black);
 * `to` is the second stop. `angle` is the direction in degrees (screen-clockwise
 * from +x). The transition band is centred at `midpoint` (0–1) and `fade` (0–1)
 * wide: fade 0 = a hard two-tone split at the midpoint, fade 1 = a full smooth blend.
 */
export interface GradientFill {
  angle: number;
  to: string;
  midpoint: number;
  fade: number;
  /** Opacity (0–1) of the second (`to`) stop. Absent = 1 (opaque); set below 1 to
   *  fade the gradient toward transparent. Additive/optional so existing gradients
   *  are unchanged. */
  toOpacity?: number;
  /** When true, `angle` is IGNORED and the gradient runs ALONG the path — its
   *  direction is computed at render time from the contour's first→last node
   *  (start→end of the line). Additive/optional; absent = the fixed-angle gradient. */
  alongPath?: boolean;
}

/** A sensible starting gradient when the user first enables one (white second stop,
 *  centred, full smooth blend). The first stop is the path's existing fill colour. */
export const DEFAULT_GRADIENT: GradientFill = { angle: 0, to: "#ffffff", midpoint: 0.5, fade: 1 };

export interface Contour {
  id: string;
  points: AnchorPoint[];
  closed: boolean;
  /** When set, the path renders as this stroke's filled outline (non-destructive,
   *  derived at render/export — the points stay the editable centerline). Optional
   *  so older saved documents load unchanged (see CLAUDE.md Invariant 7). */
  stroke?: StrokeStyle;
  /** Optional fill paint for this contour's INTERIOR (default = black ink).
   *  Additive/optional so old saves load unchanged; see CLAUDE.md Invariant 6. */
  paint?: Paint;
  /** Whether the interior is filled — INDEPENDENT of `stroke`, so a closed path can
   *  have both a fill and a stroke outline at once. Undefined = the legacy default
   *  (`closed && !stroke && paint.fill !== "none"`), so old saves render unchanged. */
  filled?: boolean;
  /** Optional per-path corner treatment (round/chamfer/inverted), applied to every
   *  corner node at render/export. Additive/optional so old saves load unchanged. */
  corner?: CornerStyle;
}

/** A sensible starting stroke when the user first enables one on a path. */
export const DEFAULT_STROKE: StrokeStyle = {
  width: 40,
  startCap: "round",
  endCap: "round",
  join: "round",
};

/** A sensible starting bracketed serif when the user first enables one on an end. */
export const DEFAULT_SERIF: SerifStyle = {
  length: 30, // foot half-span
  depth: 30, // bracket reach up the stem
  project: 12, // a small flat foot
  bracket: 0.6, // concave bracket
};

/** A sensible starting ink-pool terminal when the user first enables one on an end. */
export const DEFAULT_DROP: DropStyle = {
  size: 32, // ink-pool radius
  ratio: 1.5, // reach (how far up the stem the swell eases in)
  smear: 0, // no lean
  anchor: "far",
};

/** A sensible starting rectangle cap when the user first picks it on an end. */
export const DEFAULT_RECT: RectCapStyle = {
  size: 40,
  ratio: 1,
  radius: 0,
  // `angle` omitted = auto (flat edge perpendicular to the path).
};

/** Default nib thin/thick ratio when a broad-nib angle is enabled. */
export const DEFAULT_CONTRAST = 0.15;

/**
 * A reference to one anchor point, fully qualified by layer. Phase 5 made
 * selection layer-aware so contours can be selected across layers (the basis
 * for cross-layer boolean / compound-path holes), so a ref carries its layer
 * id, contour id, and point id. The glyph is still implied by the active glyph.
 */
export interface PointRef {
  layerId: string;
  contourId: string;
  pointId: string;
}

/** Which bezier handle of an anchor a gesture is acting on. */
export type HandleKind = "in" | "out";

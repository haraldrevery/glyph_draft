import { DEFAULT_GRADIENT, type Contour, type GradientFill, type Paint, type StrokeStyle } from "../../types/geometry";

/**
 * Pure fill-paint rules shared by the document store and the renderer.
 *
 * DEFAULT INK: opaque black with no gradient is not stored as a colour. A fill with that
 * paint keeps NO `paint` at all, and a stroke colour of black renders as default ink too,
 * so the canvas draws it in the theme's ink (faint while editing) exactly like an
 * unpainted path. The export writes default ink as black either way.
 */

export const DEFAULT_INK = "#000000";

/** Is `color` the default ink (black)? */
export function isDefaultInk(color: string): boolean {
  const c = color.trim().toLowerCase();
  return c === "#000000" || c === "#000";
}

/** A paint that is just the default ink — stored as no paint at all. */
export function isDefaultPaint(p: Paint): boolean {
  return (
    (p.fill === undefined || isDefaultInk(p.fill)) &&
    (p.opacity === undefined || p.opacity === 1) &&
    p.gradient === undefined
  );
}

/** A partial edit of ONE contour's fill paint: only the named properties change. */
export interface PaintPatch {
  fill?: string;
  opacity?: number;
  /** Merged into the contour's OWN gradient (or the default one); `null` removes it. */
  gradient?: Partial<GradientFill> | null;
}

/**
 * Apply a patch to one contour's paint. Applied PER CONTOUR, so editing one property on
 * a multi-selection (dragging Opacity over a red and a blue path) never overwrites the
 * other properties — the Colour panel once built one paint from the first path and wrote
 * it to every path, turning both red. Returns `undefined` for the default ink.
 */
export function patchPaint(paint: Paint | undefined, patch: PaintPatch): Paint | undefined {
  const next: Paint = { ...(paint ?? {}) };
  if (patch.fill !== undefined) next.fill = patch.fill;
  if (patch.opacity !== undefined) next.opacity = patch.opacity;
  if (patch.gradient === null) delete next.gradient;
  else if (patch.gradient !== undefined) next.gradient = { ...(paint?.gradient ?? DEFAULT_GRADIENT), ...patch.gradient };
  return isDefaultPaint(next) ? undefined : next;
}

/**
 * Fill and stroke are independent, except for one legacy rule: a stroke with no colour
 * of its own draws its outline in the contour's FILL paint (so pre-v7 documents keep
 * their look). Editing the fill would then recolour the outline too. Call this BEFORE a
 * fill-paint edit: it writes the outline's current colour onto the stroke, so the
 * outline keeps exactly its look and the fill edit touches the interior only.
 *
 * Lossless by construction — one case is left alone instead: a semi-transparent fill
 * with no stroke gradient (a stroke has no opacity of its own to carry it), which keeps
 * the old coupled behaviour rather than silently changing the outline's transparency.
 */
export function pinLegacyStrokePaint(c: Contour): Contour {
  const s = c.stroke;
  if (!s || s.color !== undefined) return c;
  const p = c.paint;
  if (!s.gradient && p?.opacity !== undefined && p.opacity !== 1) return c;
  const stroke: StrokeStyle = { ...s, color: p?.fill ?? DEFAULT_INK };
  if (!s.gradient && p?.gradient) stroke.gradient = p.gradient;
  return { ...c, stroke };
}

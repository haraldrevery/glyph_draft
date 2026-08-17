import type { Glyph, Layer } from "../types/document";
import type { AnchorPoint, Contour } from "../types/geometry";
import type { FontMetrics } from "../constants/metrics";
import { createId } from "../utils/id";

/**
 * Pure, immutable operations on the document model. The store actions stay thin
 * by delegating the actual nested updates here, which keeps the tricky
 * "replace one contour deep inside glyph→layer→contours" logic in one tested
 * place and makes every edit produce a fresh object graph (required for
 * snapshot-based undo/redo to diff correctly).
 */

/** Human-readable label for a code point: the character itself when printable,
 *  "space" for U+0020, otherwise a U+XXXX tag. */
export function glyphLabel(codepoint: number): string {
  if (codepoint === 0x20) return "space";
  if (codepoint >= 0x21) {
    try {
      return String.fromCodePoint(codepoint);
    } catch {
      /* invalid code point — fall through to the hex tag */
    }
  }
  return formatCodepoint(codepoint);
}

/** Canonical "U+XXXX" rendering (min 4 hex digits, uppercase). */
export function formatCodepoint(codepoint: number): string {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Export filename for a code point: `u_xxxx.svg`, lowercase hex, min 4 digits,
 * no `U+` prefix — the convention FontForge expects for per-glyph SVG import
 * (e.g. 0x41 → "u_0041.svg", 0x20ac → "u_20ac.svg"). Distinct from
 * formatCodepoint (uppercase "U+XXXX"), which is for on-screen labels.
 */
export function exportFileName(codepoint: number): string {
  return `u_${codepoint.toString(16).toLowerCase().padStart(4, "0")}.svg`;
}

/**
 * Parse a glyph-chooser input into a code point: either a literal character
 * (the first code point of the string is taken) or an explicit "U+XXXX" /
 * "0xXXXX" hex tag. Returns null for empty or invalid input. The two forms are
 * unambiguous — a bare "A" means the letter A, "U+0041" means the same by code.
 */
export function parseGlyphInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const hex = /^(?:u\+|0x)([0-9a-f]+)$/i.exec(s);
  if (hex && hex[1]) {
    const cp = parseInt(hex[1], 16);
    return Number.isFinite(cp) && cp > 0 ? cp : null;
  }
  return s.codePointAt(0) ?? null;
}

/** A fresh glyph for a code point, with a single empty layer. */
export function createGlyph(
  codepoint: number,
  metrics: FontMetrics,
  name?: string,
): Glyph {
  return {
    id: createId("gl"),
    codepoint,
    name: name ?? glyphLabel(codepoint),
    advanceWidth: metrics.advanceWidth,
    layers: [makeEmptyLayer("Layer 1")],
  };
}

/** A fresh glyph seeded as 'A' — used to initialise an empty document. */
export function createDefaultGlyph(metrics: FontMetrics): Glyph {
  return createGlyph(0x41, metrics);
}

/** Locate a layer within a glyph. */
export function findLayer(glyph: Glyph, layerId: string): Layer | undefined {
  return glyph.layers.find((l) => l.id === layerId);
}

/** Immutably replace a layer's contour list via a transform function. */
export function updateLayerContours(
  glyph: Glyph,
  layerId: string,
  fn: (contours: Contour[]) => Contour[],
): Glyph {
  return {
    ...glyph,
    layers: glyph.layers.map((layer) =>
      layer.id === layerId ? { ...layer, contours: fn(layer.contours) } : layer,
    ),
  };
}

/** Replace a single contour (matched by id) within a contour list. */
export function replaceContourIn(
  contours: Contour[],
  contour: Contour,
): Contour[] {
  return contours.map((c) => (c.id === contour.id ? contour : c));
}

/** Replace a single anchor point (matched by id) within a contour. */
export function replacePointIn(contour: Contour, point: AnchorPoint): Contour {
  return {
    ...contour,
    points: contour.points.map((p) => (p.id === point.id ? point : p)),
  };
}

/* ------------------------------------------------------------------ *
 * Phase 3: layer-level operations and deep cloning for the clipboard.
 * ------------------------------------------------------------------ */

/** A fresh empty layer. */
export function makeEmptyLayer(name: string): Layer {
  return { id: createId("ly"), name, visible: true, locked: false, contours: [] };
}

/**
 * A unique "Layer N" name for a glyph. Counts up from the layer total so the
 * default name stays meaningful even after deletes; collisions are avoided by
 * scanning existing names.
 */
export function nextLayerName(glyph: Glyph): string {
  const used = new Set(glyph.layers.map((l) => l.name));
  let n = glyph.layers.length + 1;
  let name = `Layer ${n}`;
  while (used.has(name)) name = `Layer ${(n += 1)}`;
  return name;
}

/**
 * Deep-clone a contour with brand-new ids for the contour and every point.
 * Handles are plain absolute coordinates (no id references), so cloning is a
 * straight structural copy — which is exactly why paste-in-place is trivial:
 * the geometry keeps its world coordinates and only identity changes.
 */
export function cloneContourWithNewIds(contour: Contour): Contour {
  const clone: Contour = {
    id: createId("ct"),
    closed: contour.closed,
    points: contour.points.map((p) => {
      const copy: AnchorPoint = { id: createId("pt"), type: p.type, x: p.x, y: p.y };
      if (p.handleIn) copy.handleIn = { x: p.handleIn.x, y: p.handleIn.y };
      if (p.handleOut) copy.handleOut = { x: p.handleOut.x, y: p.handleOut.y };
      return copy;
    }),
  };
  // Carry the non-destructive stroke (deep-cloned so the copy is independent), so
  // duplicating a layer — and paste-in-place — preserve each path's stroke.
  if (contour.stroke) clone.stroke = structuredClone(contour.stroke);
  return clone;
}

/**
 * Deep-clone a whole layer (new ids throughout), optionally renamed. A duplicate
 * is intentionally NOT carried into any boolean pair the source belonged to — a
 * layer may only be in one pair, so the copy starts unpaired (the caller manages
 * the glyph's `booleanPairs`).
 */
export function cloneLayer(layer: Layer, name = `${layer.name} copy`): Layer {
  return {
    id: createId("ly"),
    name,
    visible: layer.visible,
    locked: false, // a fresh duplicate is editable
    contours: layer.contours.map(cloneContourWithNewIds),
  };
}

/** Immutably transform a glyph's layer array. */
export function mapGlyphLayers(
  glyph: Glyph,
  fn: (layers: Layer[]) => Layer[],
): Glyph {
  return { ...glyph, layers: fn(glyph.layers) };
}

/** Move an array element from one index to another, returning a new array. */
export function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) {
    return arr;
  }
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

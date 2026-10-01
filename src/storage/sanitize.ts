import type { BooleanPair, Glyph, Layer, LayerGroup } from "../types/document";
import type { AnchorPoint, Contour } from "../types/geometry";
import { DEFAULT_METRICS } from "../constants/metrics";
import { glyphLabel, makeEmptyLayer } from "../state/glyphHelpers";

/**
 * Structural REPAIR for a loaded glyph (autosave or an imported project file).
 *
 * `migrate()` only checks a glyph's top-level shape, so a file with, say, a layer
 * missing its `contours` array or a pair with an unknown op used to load fine and
 * then throw on every render — and because the document autosaves, it threw again
 * after every reload. This pass removes exactly the things that would crash:
 *
 *  - REPAIR, never reject: a document that is merely unusual must still load (a
 *    rejected main falls back to the backup and gets parked, which for a healthy
 *    save would look like data loss). Whole-document rejection stays with the
 *    top-level checks in `projectFile.ts`.
 *  - Only fix what cannot render: garbage (a point without finite x/y, a pair op the
 *    engine doesn't know) is dropped; a missing/mis-typed flag gets its default.
 *  - IDENTITY: an already-valid glyph is returned as the SAME object (and so are its
 *    unchanged layers/contours/points), so a healthy document is untouched.
 */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isVec = (x: unknown): boolean => isRec(x) && fin(x.x) && fin(x.y);
const PAIR_OPS = new Set(["union", "subtract", "intersect", "exclude", "blend"]);

/** Map an array, returning the SAME array when no element changed or was dropped. */
function mapKeep<T>(arr: unknown[], fn: (x: unknown, i: number) => T | null): T[] {
  let changed = false;
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += 1) {
    const x = arr[i];
    const y = fn(x, i);
    if (y === null) {
      changed = true;
      continue;
    }
    if (y !== x) changed = true;
    out.push(y);
  }
  return changed ? out : (arr as T[]);
}

function sanitizePoint(p: unknown): AnchorPoint | null {
  if (!isRec(p) || typeof p.id !== "string" || !fin(p.x) || !fin(p.y)) return null;
  const badType = p.type !== "corner" && p.type !== "smooth";
  const badIn = p.handleIn !== undefined && !isVec(p.handleIn);
  const badOut = p.handleOut !== undefined && !isVec(p.handleOut);
  if (!badType && !badIn && !badOut) return p as unknown as AnchorPoint;
  const q: Rec = { ...p };
  if (badType) q.type = "corner";
  if (badIn) delete q.handleIn;
  if (badOut) delete q.handleOut;
  return q as unknown as AnchorPoint;
}

function sanitizeContour(c: unknown): Contour | null {
  if (!isRec(c) || typeof c.id !== "string" || !Array.isArray(c.points)) return null;
  const points = mapKeep(c.points, sanitizePoint);
  const badClosed = typeof c.closed !== "boolean";
  // A stroke the engine would divide by / feed NaN into, or a style that isn't an
  // object, is dropped (the path itself survives, unstyled).
  const badStroke = c.stroke !== undefined && !(isRec(c.stroke) && fin(c.stroke.width));
  const badPaint = c.paint !== undefined && !isRec(c.paint);
  const badCorner =
    c.corner !== undefined && !(isRec(c.corner) && typeof c.corner.type === "string" && fin(c.corner.radius));
  const badFilled = c.filled !== undefined && typeof c.filled !== "boolean";
  if (points === c.points && !badClosed && !badStroke && !badPaint && !badCorner && !badFilled) {
    return c as unknown as Contour;
  }
  const q: Rec = { ...c, points };
  if (badClosed) q.closed = !!c.closed;
  if (badStroke) delete q.stroke;
  if (badPaint) delete q.paint;
  if (badCorner) delete q.corner;
  if (badFilled) delete q.filled;
  return q as unknown as Contour;
}

function sanitizeLayer(l: unknown, i: number): Layer | null {
  if (!isRec(l) || typeof l.id !== "string") return null;
  const contours = Array.isArray(l.contours) ? mapKeep(l.contours, sanitizeContour) : [];
  const badName = typeof l.name !== "string";
  const badVisible = typeof l.visible !== "boolean";
  const badLocked = typeof l.locked !== "boolean";
  const badBaked = l.baked !== undefined && typeof l.baked !== "boolean";
  const badGroup = l.groupId !== undefined && typeof l.groupId !== "string";
  if (contours === l.contours && !badName && !badVisible && !badLocked && !badBaked && !badGroup) {
    return l as unknown as Layer;
  }
  const q: Rec = { ...l, contours };
  if (badName) q.name = `Layer ${i + 1}`;
  if (badVisible) q.visible = true;
  if (badLocked) q.locked = false;
  if (badBaked) delete q.baked;
  if (badGroup) delete q.groupId;
  return q as unknown as Layer;
}

function sanitizePair(p: unknown): BooleanPair | null {
  if (
    !isRec(p) ||
    typeof p.id !== "string" ||
    !Array.isArray(p.layerIds) ||
    p.layerIds.length !== 2 ||
    !p.layerIds.every((x) => typeof x === "string") ||
    !PAIR_OPS.has(p.op as string)
  ) {
    return null; // an op the engine can't run would throw on every render
  }
  if (p.steps === undefined || fin(p.steps)) return p as unknown as BooleanPair;
  const q: Rec = { ...p };
  delete q.steps;
  return q as unknown as BooleanPair;
}

function sanitizeGroup(g: unknown): LayerGroup | null {
  if (!isRec(g) || typeof g.id !== "string") return null;
  const badName = typeof g.name !== "string";
  const badVisible = typeof g.visible !== "boolean";
  const badLocked = typeof g.locked !== "boolean";
  const badParent = g.parentId !== undefined && typeof g.parentId !== "string";
  if (!badName && !badVisible && !badLocked && !badParent) return g as unknown as LayerGroup;
  const q: Rec = { ...g };
  if (badName) q.name = "Group";
  if (badVisible) q.visible = true;
  if (badLocked) q.locked = false;
  if (badParent) delete q.parentId;
  return q as unknown as LayerGroup;
}

/**
 * Repair one glyph. `key` is its key in the glyph map — the store addresses glyphs by
 * key, so a mismatched `id` would make the glyph unselectable; the key wins.
 * Assumes the top-level checks already passed (id string, codepoint number, layers array).
 */
export function sanitizeGlyph(key: string, glyph: Glyph): Glyph {
  const g = glyph as unknown as Rec;
  let layers = mapKeep(g.layers as unknown[], sanitizeLayer);
  // A glyph needs ≥1 layer: with none, the first drawing action would create a
  // duplicate glyph instead (ensureActiveTarget).
  if (layers.length === 0) layers = [makeEmptyLayer("Layer 1")];

  const pairs =
    g.booleanPairs === undefined
      ? undefined
      : Array.isArray(g.booleanPairs)
        ? mapKeep(g.booleanPairs, sanitizePair)
        : null;
  const groups =
    g.layerGroups === undefined
      ? undefined
      : Array.isArray(g.layerGroups)
        ? mapKeep(g.layerGroups, sanitizeGroup)
        : null;
  const badId = g.id !== key;
  const badName = typeof g.name !== "string";
  const badAdvance = !fin(g.advanceWidth) || g.advanceWidth < 0;

  if (
    layers === g.layers &&
    pairs === g.booleanPairs &&
    groups === g.layerGroups &&
    !badId &&
    !badName &&
    !badAdvance
  ) {
    return glyph;
  }
  const q: Rec = { ...g, layers };
  if (pairs === null) delete q.booleanPairs;
  else if (pairs !== undefined) q.booleanPairs = pairs;
  if (groups === null) delete q.layerGroups;
  else if (groups !== undefined) q.layerGroups = groups;
  if (badId) q.id = key;
  if (badName) q.name = glyphLabel(g.codepoint as number);
  if (badAdvance) q.advanceWidth = DEFAULT_METRICS.advanceWidth;
  return q as unknown as Glyph;
}

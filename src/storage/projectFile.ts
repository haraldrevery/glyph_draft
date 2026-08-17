import type { Glyph } from "../types/document";

/**
 * The on-disk project format and its migration seam. The whole point of building
 * save *now* (before the big stroke feature) is this versioned envelope: future
 * model additions become a backward-compatible migration, not a rewrite.
 *
 * The glyph model is already plain serializable JSON (the same data zundo
 * snapshots and the exporter walks), so persistence is fundamentally
 * `serializeProject(glyphs)` → StorageService and `migrate(stored)` back.
 *
 * Stroke forward-compat (when the non-destructive stroke feature lands): bump to
 * `version: 2`, add a `ProjectFileV2`, and add a `v1 → v2` step in `migrate`
 * that defaults the new optional `stroke?` fields. Because those fields are
 * optional, even un-migrated v1 data loads fine; the migration only backfills
 * defaults. That is the rework this design is meant to avoid.
 */

export const CURRENT_VERSION = 7 as const;

/** KV keys. The backup is the previous main, kept so a corrupt write is recoverable. */
export const STORAGE_KEY = "glyphdraft:project";
export const BACKUP_KEY = "glyphdraft:project.bak";
/** Where an unreadable blob is parked on load (never silently discarded). */
export const CORRUPT_KEY = "glyphdraft:project.corrupt";

export interface ProjectFileV1 {
  version: 1;
  /** Epoch ms of the write — surfaced as the "Saved · hh:mm" indicator. */
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

export interface ProjectFileV2 {
  version: 2;
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

/** v3 added the optional per-contour `paint` (fill colour/opacity). Purely additive,
 *  so v2 blobs are already valid v3 — the v2→v3 migration is the identity. */
export interface ProjectFileV3 {
  version: 3;
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

/** v4 added the optional per-contour `corner` (path corner style). Purely additive,
 *  so v3 blobs are already valid v4 — the v3→v4 migration is the identity. */
export interface ProjectFileV4 {
  version: 4;
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

/** v5 added the optional gradient on `Contour.paint` (`Paint.gradient`). Purely
 *  additive, so v4 blobs are already valid v5 — the v4→v5 migration is the identity. */
export interface ProjectFileV5 {
  version: 5;
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

/** v6 added the `"blend"` layer-pair op + optional `BooleanPair.steps`. Purely
 *  additive (and the loader never validated pair shape), so v5 blobs are already valid
 *  v6 — the v5→v6 migration is the identity. */
export interface ProjectFileV6 {
  version: 6;
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

/** v7 added optional `Contour.filled` (independent interior fill), `StrokeStyle.color`
 *  (independent outline colour) + `StrokeStyle.gradient` (outline gradient), and
 *  `GradientFill.alongPath` (a gradient that runs start→end of the line). Purely additive
 *  — absent fields fall back to the legacy render — so v6 blobs are already valid v7; the
 *  v6→v7 migration is the identity. */
export interface ProjectFileV7 {
  version: 7;
  savedAt: number;
  glyphs: Record<string, Glyph>;
}

export type ProjectFile = ProjectFileV7;

/** Wrap the live glyph map in the current envelope for persistence. */
export function serializeProject(glyphs: Record<string, Glyph>): ProjectFile {
  return { version: CURRENT_VERSION, savedAt: Date.now(), glyphs };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** A defensive, shallow shape check — enough to reject corruption, not a full schema. */
function isValidGlyph(g: unknown): g is Glyph {
  return (
    isRecord(g) &&
    typeof g.id === "string" &&
    typeof g.codepoint === "number" &&
    Array.isArray(g.layers)
  );
}

/** Accept an object only if it is a non-empty map of valid glyphs. */
function asGlyphMap(x: unknown): Record<string, Glyph> | null {
  if (!isRecord(x)) return null;
  const values = Object.values(x);
  if (values.length === 0) return null; // a real document always has ≥1 glyph
  if (!values.every(isValidGlyph)) return null;
  return x as Record<string, Glyph>;
}

/**
 * Read a stored value back into a glyph map, or `null` if it is missing, of an
 * unknown/newer version, or corrupt. Never throws — the caller falls back to the
 * backup or the in-memory seed. `raw` is the already-parsed value the
 * StorageService returns (LocalForage stores structured data; TauriStorage
 * JSON-parses), so no JSON.parse happens here.
 */
export function migrate(raw: unknown): Record<string, Glyph> | null {
  if (!isRecord(raw)) return null;
  if (raw.version === CURRENT_VERSION) return asGlyphMap(raw.glyphs);
  // v6 → v7 (optional `Contour.filled` + `StrokeStyle.color`), v5 → v6 (the `"blend"`
  // pair op + `BooleanPair.steps`), v4 → v5 (optional `paint.gradient`), v3 → v4 (optional
  // per-contour `corner`), and v2 → v3 (optional `paint`) are all purely additive, so those
  // blobs are already valid — the migrations are identities.
  if (
    raw.version === 6 ||
    raw.version === 5 ||
    raw.version === 4 ||
    raw.version === 3 ||
    raw.version === 2
  )
    return asGlyphMap(raw.glyphs);
  // v1 → v2: the `square` cap became the parametric `rectangle` cap. Rewrite every
  // stroke's caps and backfill a RectCapStyle that reproduces the old square
  // footprint (far edge at the node, depth = half the stroke width).
  if (raw.version === 1) {
    const glyphs = asGlyphMap(raw.glyphs);
    return glyphs ? migrateSquareCaps(glyphs) : null;
  }
  // An unversioned legacy blob that is itself a glyph map — accept defensively.
  if (!("version" in raw)) {
    const glyphs = asGlyphMap(raw);
    return glyphs ? migrateSquareCaps(glyphs) : null;
  }
  return null; // a version we don't know how to read
}

/**
 * Walk a v1 glyph map and convert legacy `square` caps to `rectangle` caps in
 * place. Mutates the parsed (just-loaded, not-yet-shared) objects — safe because
 * this runs once on load before the data reaches the store.
 */
function migrateSquareCaps(glyphs: Record<string, Glyph>): Record<string, Glyph> {
  for (const glyph of Object.values(glyphs)) {
    for (const layer of glyph.layers) {
      for (const contour of layer.contours) {
        const stroke = contour.stroke as Record<string, unknown> | undefined;
        if (!stroke) continue;
        const width = typeof stroke.width === "number" ? stroke.width : 40;
        // `angle` omitted = auto (perpendicular), reproducing the old square cap.
        const rect = { size: width / 2, ratio: 1, radius: 0 };
        if (stroke.startCap === "square") {
          stroke.startCap = "rectangle";
          stroke.startRect ??= { ...rect };
        }
        if (stroke.endCap === "square") {
          stroke.endCap = "rectangle";
          stroke.endRect ??= { ...rect };
        }
      }
    }
  }
  return glyphs;
}

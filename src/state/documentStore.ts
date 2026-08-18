import { useMemo } from "react";
import { create } from "zustand";
import type { BooleanPair, Glyph, Layer, LayerGroup, PairOp } from "../types/document";
import type { AnchorPoint, Contour, CornerStyle, GradientFill, Paint, PointRef, StrokeStyle } from "../types/geometry";
import { DEFAULT_STROKE } from "../types/geometry";
import { createId } from "../utils/id";
import { extractContours, joinContours, splitContourAt, splitContourAtPoints } from "../engine/geometry/topology";
import { convertPoint } from "../engine/geometry/nodeHandles";
import {
  ancestors,
  effectiveLocked,
  findGroup,
  groupMembers,
  groupRange,
  visibleRows,
} from "../features/layers/layerTree";
import { DEFAULT_METRICS } from "../constants/metrics";
import {
  cloneLayer,
  createDefaultGlyph,
  createGlyph,
  findLayer,
  makeEmptyLayer,
  mapGlyphLayers,
  moveInArray,
  nextLayerName,
  replaceContourIn,
  replacePointIn,
  updateLayerContours,
} from "./glyphHelpers";

/**
 * The document store: the source of truth for everything that gets exported. Undo/redo
 * is PER-GLYPH and lives in `state/history.ts` (it subscribes here); each transition is
 * one Undo/Redo step. The model is plain serializable data — no class instances — which
 * is what makes snapshot history and cross-glyph paste reliable.
 *
 * History granularity is deliberate on two axes:
 *  - WHAT is tracked: only `glyphs`. The active glyph/layer pointers live in this
 *    store (they belong with the document), but the history subscriber diffs only
 *    `glyphs` (by reference), so merely switching the active layer never records a
 *    step and never gets undone. After an undo that changes the active glyph's layers,
 *    `reconcileActive` (run by the undo command's `afterHistory`) repairs any dangling
 *    pointer.
 *  - WHEN a step is recorded: the Pen commits one point per gesture and node
 *    drags commit once on mouse-up (live movement lives in the editor store), so
 *    one user action maps to exactly one entry. Selection/drafts are not here.
 *
 * Geometry edits target the ACTIVE glyph's ACTIVE layer and are refused on a
 * locked layer; layer-management edits operate on the layer array directly.
 */

export interface EditTarget {
  glyphId: string;
  layerId: string;
}

interface DocumentState {
  glyphs: Record<string, Glyph>;
  activeGlyphId: string | null;
  activeLayerId: string | null;
  /** Selected layers (always includes the active layer). Plain-activating a
   *  layer selects only it; Ctrl/Cmd+click toggles others in. Drives the
   *  layer-level Pathfinder and multi-layer operations. Not undoable. */
  selectedLayerIds: string[];
  /** The GROUP row the user last clicked, or null when the target is a plain layer.
   *  Lets the panel's move/duplicate/delete act on the whole folder instead of on
   *  one member. Session state like `activeLayerId` — never undoable. */
  activeGroupId: string | null;

  ensureActiveTarget: () => EditTarget;
  setActiveGlyph: (glyphId: string) => void;
  /** Re-point active glyph/layer to existing objects (call after undo/redo). */
  reconcileActive: () => void;
  /** Replace the whole document (e.g. restoring a saved project on launch), then
   *  re-point active/selected pointers. The caller clears undo history so the
   *  load becomes the baseline rather than an undoable step. */
  loadGlyphs: (glyphs: Record<string, Glyph>) => void;

  // --- Glyphs (document) ---
  addGlyph: (codepoint: number) => void;
  /** Add every code point not already present (one glyph per code point), in ONE
   *  undo step. Keeps the active glyph; a no-op (no history) if all already exist. */
  addGlyphs: (codepoints: number[]) => void;
  deleteGlyph: (glyphId: string) => void;
  /** Set the active glyph's advance width (font units; clamped ≥ 0). One undo step. */
  setAdvanceWidth: (width: number) => void;

  // --- Geometry (active layer; no-ops on a locked layer) ---
  addContour: (contour: Contour) => void;
  addContours: (contours: Contour[]) => void;
  appendPoint: (contourId: string, point: AnchorPoint) => void;
  closeContour: (contourId: string) => void;
  replaceContour: (contour: Contour) => void;
  replaceContours: (contours: Contour[]) => void;
  /** Replace contours by id across every unlocked layer (cross-layer node move).
   *  One undo step. */
  replaceContoursEverywhere: (contours: Contour[]) => void;
  updatePoint: (contourId: string, point: AnchorPoint) => void;
  deletePoints: (refs: PointRef[]) => void;
  /** Like deletePoints, but SPLITS each affected contour at the removed nodes
   *  (the remainder becomes separate paths) instead of reconnecting neighbors.
   *  Cross-layer, locked-safe, one undo step. */
  splitAtPoints: (refs: PointRef[]) => void;
  /** Scissors: cut the contour `contourId` on `layerId` at point (`segIndex`, `t`)
   *  — an open path splits into two, a closed one opens into one (`splitContourAt`).
   *  Skips locked layers; a terminal/degenerate cut is a no-op. One undo step. */
  splitContourAtPoint: (layerId: string, contourId: string, segIndex: number, t: number) => void;
  /** Knife: cut many contours, each at many points, in one undo step. Locked-safe;
   *  a set of cuts with no effect is a no-op (no undo step). */
  splitContoursAtPoints: (
    cuts: { layerId: string; contourId: string; segIndex: number; t: number }[],
  ) => void;
  /** Eraser: drop the path span between `entry` and `exit` on one contour (open → the
   *  run between the cuts; closed → the arc between them). One undo step; no-op if the
   *  span is empty. */
  eraseContourSpan: (
    layerId: string,
    contourId: string,
    entry: { segIndex: number; t: number },
    exit: { segIndex: number; t: number },
  ) => void;
  /** Convert the referenced nodes' continuity: "smooth" (tangent-symmetric
   *  handles), "cusp" (corner-typed but with handles, moved independently), or
   *  "corner" (handles stripped). Cross-layer, locked-safe, one undo step. */
  convertPoints: (refs: PointRef[], mode: "smooth" | "cusp" | "corner") => void;
  /** Fuse two open-contour endpoints into one path. When both refs are the two
   *  ends of the SAME contour, it is closed in place. One undo step. */
  joinEndpoints: (a: PointRef, b: PointRef) => void;
  deleteContour: (contourId: string) => void;
  deleteContours: (contourIds: string[]) => void;
  /** Remove contour ids from every unlocked layer (cross-layer cut). */
  deleteContoursEverywhere: (contourIds: string[]) => void;
  /** Move whole contours (by id) out of their source layers and onto `targetLayerId`,
   *  preserving ids. Skips locked source/target. One undo step. */
  moveContoursToLayer: (contourIds: string[], targetLayerId: string) => void;
  /** Like moveContoursToLayer but creates a fresh layer for them; returns its id. */
  moveContoursToNewLayer: (contourIds: string[]) => string | null;
  /** Add imported geometry as a NEW layer (above the active one) on the active glyph.
   *  The layer is `baked` (rendered verbatim — preserves the import's holes/colours,
   *  no force-CW/stroke expansion). One undo step. */
  addImportedLayer: (contours: Contour[], name?: string) => void;
  /** Replace selected stroked contours with their already-expanded outline geometry:
   *  drop the `removeRefs` contours from their layers and add `expanded` as ONE new
   *  `baked` layer (above the active one), so the outline's holes/winding are preserved.
   *  The expansion itself is computed by the caller (Paper stays out of the store).
   *  One undo step. */
  expandStrokesToLayer: (
    expanded: Contour[],
    removeRefs: { layerId: string; contourId: string }[],
    name?: string,
  ) => void;
  /** Set (or clear, with null) the non-destructive stroke on contours in the
   *  active layer. One undo step. */
  setContourStroke: (contourIds: string[], stroke: StrokeStyle | null) => void;
  patchContourStroke: (contourIds: string[], patch: Partial<StrokeStyle>) => void;
  removeStrokeKeys: (contourIds: string[], keys: (keyof StrokeStyle)[]) => void;
  /** Set (or clear, with null) the fill paint on contours across unlocked layers
   *  (default ink = no paint = black). One undo step. */
  setContourPaint: (contourIds: string[], paint: Paint | null) => void;
  setContourFilled: (contourIds: string[], filled: boolean | null) => void;
  setStrokeColor: (contourIds: string[], color: string) => void;
  setStrokeGradient: (contourIds: string[], gradient: GradientFill | null) => void;
  /** Set (or clear, with null) the path-corner style on contours across unlocked
   *  layers (round/chamfer/inverted). One undo step. */
  setContourCorner: (contourIds: string[], corner: CornerStyle | null) => void;

  // --- Layers (active glyph) ---
  setActiveLayer: (layerId: string) => void;
  /** Toggle a layer in/out of the multi-selection (Ctrl/Cmd+click). */
  toggleLayerSelection: (layerId: string) => void;
  /** Select every layer between the active (anchor) layer and `layerId`, inclusive
   *  (Shift+click). The active layer stays the anchor. */
  selectLayerRange: (layerId: string) => void;
  addLayer: () => void;
  duplicateLayer: (layerId?: string) => void;
  deleteLayer: (layerId: string) => void;
  renameLayer: (layerId: string, name: string) => void;
  setLayerVisible: (layerId: string, visible: boolean) => void;
  setLayerLocked: (layerId: string, locked: boolean) => void;
  /** Create/replace the non-destructive layer pair for two layers (a boolean op or
   *  `"blend"`). A layer can be in at most one pair, so any pair touching either layer
   *  is dropped first. `steps` applies to `"blend"` only. */
  setBooleanPair: (aLayerId: string, bLayerId: string, op: PairOp, steps?: number) => void;
  /** Remove any boolean pair that references the given layer. */
  clearBooleanPair: (layerId: string) => void;
  /** Replace the given layers with one pre-baked merged layer at the lowest of
   *  their positions; prunes pairs touching any removed layer. The caller computes
   *  the merged geometry (keeps Paper.js out of the store). One undo step. */
  commitMerge: (removeIds: string[], merged: Layer) => void;
  moveLayer: (layerId: string, direction: "up" | "down") => void;

  // ---- Layer groups (folders) ------------------------------------------------
  // `glyph.layers` stays FLAT; groups live in `glyph.layerGroups` and nest via
  // `parentId`. See `features/layers/layerTree.ts` for the tree view, and the
  // CONTIGUITY invariant on `LayerGroup`: a group's members occupy an unbroken run
  // of `glyph.layers`, which these actions maintain.

  /** Put the given layers into a NEW group, reordering them into one contiguous run
   *  at the topmost member's position. Nests under the common parent group when the
   *  members already share one. Returns the new group id (null if it did nothing).
   *  One undo step. */
  groupLayers: (layerIds: string[], name?: string) => string | null;
  /** Dissolve a group: its layers and child groups are re-parented to the group's own
   *  parent (so an inner group survives), and the group is removed. Geometry and stack
   *  order are untouched. One undo step. */
  ungroupGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  setGroupVisible: (groupId: string, visible: boolean) => void;
  setGroupLocked: (groupId: string, locked: boolean) => void;
  /** Render the group's contents as ONE layer (Stage 4). Stored now so the flag
   *  round-trips through save/load before anything consumes it. */
  setGroupRenderAsOne: (groupId: string, renderAsOne: boolean) => void;
  /** Select every layer in a group (Ctrl/Cmd+click adds to the current selection).
   *  The group's lowest member becomes active so new geometry lands inside it. */
  selectGroup: (groupId: string, additive?: boolean) => void;
  /** Move a whole group past its adjacent SIBLING (same parent). A move that would
   *  cross a parent boundary is a no-op — re-parenting is a drag-and-drop concern. */
  moveGroup: (groupId: string, direction: "up" | "down") => void;
}

/**
 * Write a group list back onto a glyph, dropping the key entirely when it is empty so
 * an ungrouped document stays byte-identical to a pre-groups save.
 */
function withGroups(glyph: Glyph, groups: LayerGroup[]): Glyph {
  if (groups.length === 0) {
    const next = { ...glyph };
    delete next.layerGroups;
    return next;
  }
  return { ...glyph, layerGroups: groups };
}

/**
 * Drop groups that no longer hold any layer (directly or through a descendant), plus
 * any boolean pair that referenced one. Runs after a delete/merge so a dissolved
 * folder cannot linger as a phantom panel row or a stale Pathfinder operand.
 *
 * Iterates to a fixed point: emptying an inner group can empty its parent too.
 */
function pruneEmptyGroups(glyph: Glyph): Glyph {
  const groups = glyph.layerGroups ?? [];
  if (groups.length === 0) return glyph;

  let keep = groups;
  for (;;) {
    const keepIds = new Set(keep.map((g) => g.id));
    const holdsLayer = new Set(
      glyph.layers.map((l) => l.groupId).filter((id): id is string => !!id && keepIds.has(id)),
    );
    // A group survives if it holds a layer directly, or if a surviving child does.
    const survives = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const g of keep) {
        if (survives.has(g.id)) continue;
        const childSurvives = keep.some((c) => c.parentId === g.id && survives.has(c.id));
        if (holdsLayer.has(g.id) || childSurvives) {
          survives.add(g.id);
          changed = true;
        }
      }
    }
    const next = keep.filter((g) => survives.has(g.id));
    if (next.length === keep.length) break;
    keep = next;
  }
  if (keep.length === groups.length) return glyph;

  const gone = new Set(groups.filter((g) => !keep.some((k) => k.id === g.id)).map((g) => g.id));
  const out = withGroups(glyph, keep);
  if (out.booleanPairs) {
    const pairs = out.booleanPairs.filter((p) => !p.layerIds.some((id) => gone.has(id)));
    if (pairs.length !== out.booleanPairs.length) {
      return pairs.length ? { ...out, booleanPairs: pairs } : (() => {
        const o = { ...out };
        delete o.booleanPairs;
        return o;
      })();
    }
  }
  return out;
}

/** "Group 1", "Group 2", … skipping names already taken. */
function nextGroupName(glyph: Glyph): string {
  const taken = new Set((glyph.layerGroups ?? []).map((g) => g.name));
  for (let n = (glyph.layerGroups ?? []).length + 1; ; n += 1) {
    const name = `Group ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Walk up from `groupId` until we find the group whose parent is `parentId` — i.e. the
 * sibling-level block containing it. Returns null when `groupId` is not inside
 * `parentId` at all (so a move must not cross into it).
 */
function siblingAncestor(glyph: Glyph, groupId: string, parentId?: string): string | null {
  const chain = [groupId, ...ancestors(glyph, groupId).map((g) => g.id)];
  for (const id of chain) {
    if ((findGroup(glyph, id)?.parentId ?? undefined) === (parentId ?? undefined)) return id;
  }
  return null;
}

/** The group a newly inserted layer should join: the active layer's own group, so a
 *  new/duplicated/imported layer placed just above it cannot split that group's run
 *  (the CONTIGUITY invariant). Undefined = top level. */
function inheritGroupId(glyph: Glyph, activeLayerId: string | null): string | undefined {
  if (!activeLayerId) return undefined;
  return glyph.layers.find((l) => l.id === activeLayerId)?.groupId;
}

function seed(): Pick<
  DocumentState,
  "glyphs" | "activeGlyphId" | "activeLayerId" | "selectedLayerIds" | "activeGroupId"
> {
  const glyph = createDefaultGlyph(DEFAULT_METRICS);
  const layerId = glyph.layers[0]!.id;
  return {
    glyphs: { [glyph.id]: glyph },
    activeGlyphId: glyph.id,
    activeLayerId: layerId,
    selectedLayerIds: [layerId],
    activeGroupId: null,
  };
}

function resolveActive(s: DocumentState): EditTarget | null {
  if (!s.activeGlyphId || !s.activeLayerId) return null;
  return { glyphId: s.activeGlyphId, layerId: s.activeLayerId };
}

export const useDocumentStore = create<DocumentState>()(
  (set, get): DocumentState => {
      /** Geometry edit on the active layer — refused if the layer is locked. */
      const mutateActiveLayer = (fn: (contours: Contour[]) => Contour[]): void => {
        const s = get();
        const target = resolveActive(s);
        if (!target) return;
        const glyph = s.glyphs[target.glyphId];
        const layer = glyph ? findLayer(glyph, target.layerId) : undefined;
        if (!glyph || !layer || effectiveLocked(glyph, layer)) return;
        const nextGlyph = updateLayerContours(glyph, target.layerId, fn);
        set({ glyphs: { ...s.glyphs, [target.glyphId]: nextGlyph } });
      };

      /**
       * Cross-layer per-contour edit: apply `fn` to every contour named in
       * `contourIds`, across ALL unlocked layers of the active glyph, as ONE undo
       * step. A node selection routinely spans layers (each path is often its own
       * layer), which is why this is not scoped to the active layer.
       *
       * `fn` returns the replacement contour, or `null` to leave that contour alone —
       * the stroke-only actions use `null` so they never add a stroke to an unstroked
       * path. Layers with no match keep their identity, which the identity-keyed
       * geometry caches depend on (Invariant 3).
       *
       * Every per-contour STYLE action goes through here, so adding the next one
       * (a custom cap, a per-node corner) is a few lines rather than another copy of
       * this traversal.
       */
      const patchContours = (contourIds: string[], fn: (c: Contour) => Contour | null): void => {
        const s = get();
        if (!s.activeGlyphId) return;
        const glyph = s.glyphs[s.activeGlyphId];
        if (!glyph) return;
        const ids = new Set(contourIds);
        const layers = glyph.layers.map((layer) => {
          if (effectiveLocked(glyph, layer)) return layer;
          let changed = false;
          const contours = layer.contours.map((c) => {
            if (!ids.has(c.id)) return c;
            const next = fn(c);
            if (!next) return c;
            changed = true;
            return next;
          });
          return changed ? { ...layer, contours } : layer;
        });
        // NB: always commits, exactly as the eight hand-written versions did — a
        // no-match call still produces a new glyph object (and so an undo step).
        // Preserved deliberately; changing it is a behaviour change, not a refactor.
        set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
      };

      /** Group-list edit on the active glyph. One undo step; an empty result drops
       *  the `layerGroups` key so an ungrouped document stays as it was. */
      const mutateGroups = (fn: (groups: LayerGroup[]) => LayerGroup[]): void => {
        const s = get();
        if (!s.activeGlyphId) return;
        const glyph = s.glyphs[s.activeGlyphId];
        if (!glyph) return;
        const next = fn(glyph.layerGroups ?? []);
        set({ glyphs: { ...s.glyphs, [glyph.id]: withGroups(glyph, next) } });
      };

      /** Layer-array edit on the active glyph (lock does not apply). */
      const mutateLayers = (fn: (layers: Layer[]) => Layer[]): void => {
        const s = get();
        if (!s.activeGlyphId) return;
        const glyph = s.glyphs[s.activeGlyphId];
        if (!glyph) return;
        set({ glyphs: { ...s.glyphs, [glyph.id]: mapGlyphLayers(glyph, fn) } });
      };

      return {
        ...seed(),

        ensureActiveTarget: () => {
          const s = get();
          if (
            s.activeGlyphId &&
            s.activeLayerId &&
            s.glyphs[s.activeGlyphId] &&
            findLayer(s.glyphs[s.activeGlyphId]!, s.activeLayerId)
          ) {
            return { glyphId: s.activeGlyphId, layerId: s.activeLayerId };
          }
          const glyph = createDefaultGlyph(DEFAULT_METRICS);
          const layerId = glyph.layers[0]!.id;
          set({
            glyphs: { ...s.glyphs, [glyph.id]: glyph },
            activeGlyphId: glyph.id,
            activeLayerId: layerId,
            selectedLayerIds: [layerId],
          });
          return { glyphId: glyph.id, layerId };
        },

        setActiveGlyph: (glyphId) => {
          const glyph = get().glyphs[glyphId];
          if (!glyph) return;
          const activeLayerId = glyph.layers[glyph.layers.length - 1]?.id ?? null;
          set({
            activeGlyphId: glyphId,
            activeLayerId,
            selectedLayerIds: activeLayerId ? [activeLayerId] : [],
          });
        },

        reconcileActive: () => {
          const s = get();
          let activeGlyphId = s.activeGlyphId;
          if (!activeGlyphId || !s.glyphs[activeGlyphId]) {
            activeGlyphId = Object.keys(s.glyphs)[0] ?? null;
          }
          const glyph = activeGlyphId ? s.glyphs[activeGlyphId] : null;
          let activeLayerId = s.activeLayerId;
          if (!glyph) activeLayerId = null;
          else if (!activeLayerId || !findLayer(glyph, activeLayerId)) {
            activeLayerId = glyph.layers[glyph.layers.length - 1]?.id ?? null;
          }
          // Prune the multi-selection to existing layers; if the active layer
          // dropped out (e.g. an undo removed it), fall back to just the active.
          let selectedLayerIds = glyph
            ? s.selectedLayerIds.filter((id) => findLayer(glyph, id))
            : [];
          if (activeLayerId && !selectedLayerIds.includes(activeLayerId)) {
            selectedLayerIds = [activeLayerId];
          }
          // A targeted group can vanish (undo, ungroup, prune) — drop the pointer.
          const activeGroupId =
            glyph && s.activeGroupId && findGroup(glyph, s.activeGroupId)
              ? s.activeGroupId
              : null;
          const selChanged =
            selectedLayerIds.length !== s.selectedLayerIds.length ||
            selectedLayerIds.some((id, i) => s.selectedLayerIds[i] !== id);
          if (
            activeGlyphId !== s.activeGlyphId ||
            activeLayerId !== s.activeLayerId ||
            activeGroupId !== s.activeGroupId ||
            selChanged
          ) {
            set({ activeGlyphId, activeLayerId, selectedLayerIds, activeGroupId });
          }
        },

        loadGlyphs: (glyphs) => {
          // The persisted document carries no active pointers, so set the glyphs
          // and let reconcileActive choose a valid active/selected target.
          set({ glyphs });
          get().reconcileActive();
        },

        addGlyph: (codepoint) => {
          const s = get();
          // A font has one glyph per code point: switch to an existing match
          // (untracked — no history step) rather than creating a duplicate.
          const existing = Object.values(s.glyphs).find(
            (g) => g.codepoint === codepoint,
          );
          if (existing) {
            const activeLayerId = existing.layers[existing.layers.length - 1]?.id ?? null;
            set({
              activeGlyphId: existing.id,
              activeLayerId,
              selectedLayerIds: activeLayerId ? [activeLayerId] : [],
            });
            return;
          }
          const glyph = createGlyph(codepoint, DEFAULT_METRICS);
          const activeLayerId = glyph.layers[glyph.layers.length - 1]?.id ?? null;
          set({
            glyphs: { ...s.glyphs, [glyph.id]: glyph },
            activeGlyphId: glyph.id,
            activeLayerId,
            selectedLayerIds: activeLayerId ? [activeLayerId] : [],
          });
        },

        addGlyphs: (codepoints) => {
          const s = get();
          const have = new Set(Object.values(s.glyphs).map((g) => g.codepoint));
          const added: Record<string, Glyph> = {};
          // De-dup the input too, so overlapping sets don't make two glyphs at once.
          const seen = new Set<number>();
          for (const cp of codepoints) {
            if (have.has(cp) || seen.has(cp)) continue;
            seen.add(cp);
            const glyph = createGlyph(cp, DEFAULT_METRICS);
            added[glyph.id] = glyph;
          }
          if (Object.keys(added).length === 0) return; // nothing new → no history step
          // Keep the active glyph; one undo step removes the whole set.
          set({ glyphs: { ...s.glyphs, ...added } });
        },

        deleteGlyph: (glyphId) => {
          const s = get();
          const removed = s.glyphs[glyphId];
          if (!removed || Object.keys(s.glyphs).length <= 1) return; // keep ≥1
          const rest = { ...s.glyphs };
          delete rest[glyphId];
          let activeGlyphId = s.activeGlyphId;
          let activeLayerId = s.activeLayerId;
          let selectedLayerIds = s.selectedLayerIds;
          if (s.activeGlyphId === glyphId) {
            // Move to the next glyph by code point, or the previous if it was last.
            const sorted = Object.values(rest).sort((a, b) => a.codepoint - b.codepoint);
            const next =
              sorted.find((g) => g.codepoint > removed.codepoint) ??
              sorted[sorted.length - 1] ??
              null;
            activeGlyphId = next?.id ?? null;
            activeLayerId = next?.layers[next.layers.length - 1]?.id ?? null;
            selectedLayerIds = activeLayerId ? [activeLayerId] : [];
          }
          set({ glyphs: rest, activeGlyphId, activeLayerId, selectedLayerIds });
        },

        setAdvanceWidth: (width) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const w = Math.max(0, Math.round(width));
          if (glyph.advanceWidth === w) return;
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, advanceWidth: w } } });
        },

        addContour: (contour) =>
          mutateActiveLayer((contours) => [...contours, contour]),

        addContours: (incoming) =>
          mutateActiveLayer((contours) => [...contours, ...incoming]),

        appendPoint: (contourId, point) =>
          mutateActiveLayer((contours) =>
            contours.map((c) =>
              c.id === contourId ? { ...c, points: [...c.points, point] } : c,
            ),
          ),

        closeContour: (contourId) =>
          mutateActiveLayer((contours) =>
            contours.map((c) => (c.id === contourId ? { ...c, closed: true } : c)),
          ),

        replaceContour: (contour) =>
          mutateActiveLayer((contours) => replaceContourIn(contours, contour)),

        replaceContours: (updated) =>
          mutateActiveLayer((contours) => {
            const byId = new Map(updated.map((c) => [c.id, c] as const));
            return contours.map((c) => byId.get(c.id) ?? c);
          }),

        replaceContoursEverywhere: (updated) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const byId = new Map(updated.map((c) => [c.id, c] as const));
          const layers = glyph.layers.map((layer) => {
            if (effectiveLocked(glyph, layer)) return layer;
            let changed = false;
            const contours = layer.contours.map((c) => {
              const next = byId.get(c.id);
              if (next && next !== c) changed = true;
              return next ?? c;
            });
            return changed ? { ...layer, contours } : layer;
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        setContourStroke: (contourIds, stroke) => {
          // Whole-stroke replace (the enable toggle + preset apply). `null` removes it.
          // Shape edits use patchContourStroke instead, so they can't clobber colour.
          patchContours(contourIds, (c) => {
            if (stroke) return { ...c, stroke };
            const next = { ...c };
            delete next.stroke;
            return next;
          });
        },

        patchContourStroke: (contourIds, patch) => {
          // Merge ONLY the changed shape field(s) into each contour's OWN stroke (seeding a
          // default for an unstroked target), so a Stroke-panel shape edit preserves each
          // path's colour/gradient and other differing fields — it never rewrites colour.
          patchContours(contourIds, (c) => ({
            ...c,
            stroke: { ...(c.stroke ?? DEFAULT_STROKE), ...patch },
          }));
        },

        removeStrokeKeys: (contourIds, keys) => {
          // Delete the given stroke field(s) per contour (preserving the rest, incl. colour).
          patchContours(contourIds, (c) => {
            if (!c.stroke) return null; // never adds a stroke to an unstroked path
            const stroke = { ...c.stroke };
            for (const k of keys) delete stroke[k];
            return { ...c, stroke };
          });
        },

        setContourPaint: (contourIds, paint) => {
          // Fill paint (default ink = no paint). `null` clears it back to black.
          patchContours(contourIds, (c) => {
            if (paint) return { ...c, paint };
            const next = { ...c };
            delete next.paint;
            return next;
          });
        },

        setContourFilled: (contourIds, filled) => {
          // Interior-fill flag, INDEPENDENT of stroke (a closed path can have both).
          // `null` clears it back to the legacy default rule.
          patchContours(contourIds, (c) => {
            if (filled === null) {
              const next = { ...c };
              delete next.filled;
              return next;
            }
            return { ...c, filled };
          });
        },

        setStrokeColor: (contourIds, color) => {
          // Outline colour — ONLY on contours that already have a stroke.
          patchContours(contourIds, (c) =>
            c.stroke ? { ...c, stroke: { ...c.stroke, color } } : null,
          );
        },

        setStrokeGradient: (contourIds, gradient) => {
          // Outline gradient — ONLY on contours that already have a stroke. `null` removes it.
          patchContours(contourIds, (c) => {
            if (!c.stroke) return null;
            if (gradient) return { ...c, stroke: { ...c.stroke, gradient } };
            const stroke = { ...c.stroke };
            delete stroke.gradient;
            return { ...c, stroke };
          });
        },

        setContourCorner: (contourIds, corner) => {
          // Path-corner style (round/chamfer/inverted). `null` clears to sharp corners.
          patchContours(contourIds, (c) => {
            if (corner) return { ...c, corner };
            const next = { ...c };
            delete next.corner;
            return next;
          });
        },

        updatePoint: (contourId, point) =>
          mutateActiveLayer((contours) =>
            contours.map((c) => (c.id === contourId ? replacePointIn(c, point) : c)),
          ),

        deletePoints: (refs) => {
          // Cross-layer (Phase 5): refs carry their layerId, so a selection that
          // spans layers deletes from each in one undo step. Locked layers are
          // skipped. layerId → (contourId → pointIds to drop).
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const byLayer = new Map<string, Map<string, Set<string>>>();
          for (const ref of refs) {
            const byContour = byLayer.get(ref.layerId) ?? new Map<string, Set<string>>();
            const ids = byContour.get(ref.contourId) ?? new Set<string>();
            ids.add(ref.pointId);
            byContour.set(ref.contourId, ids);
            byLayer.set(ref.layerId, byContour);
          }
          const layers = glyph.layers.map((layer) => {
            const byContour = byLayer.get(layer.id);
            if (!byContour || effectiveLocked(glyph, layer)) return layer;
            const contours = layer.contours
              .map((c) => {
                const drop = byContour.get(c.id);
                if (!drop) return c;
                return { ...c, points: c.points.filter((p) => !drop.has(p.id)) };
              })
              .filter((c) => c.points.length >= 2);
            return { ...layer, contours };
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        splitAtPoints: (refs) => {
          // Same cross-layer grouping as deletePoints, but each affected contour
          // is replaced by its split fragments (extractContours over the KEPT
          // points) rather than filtered — so the path breaks at removed nodes.
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const byLayer = new Map<string, Map<string, Set<string>>>();
          for (const ref of refs) {
            const byContour = byLayer.get(ref.layerId) ?? new Map<string, Set<string>>();
            const ids = byContour.get(ref.contourId) ?? new Set<string>();
            ids.add(ref.pointId);
            byContour.set(ref.contourId, ids);
            byLayer.set(ref.layerId, byContour);
          }
          const layers = glyph.layers.map((layer) => {
            const byContour = byLayer.get(layer.id);
            if (!byContour || effectiveLocked(glyph, layer)) return layer;
            const contours = layer.contours.flatMap((c) => {
              const drop = byContour.get(c.id);
              if (!drop) return [c];
              const keep = new Set(
                c.points.map((p) => p.id).filter((id) => !drop.has(id)),
              );
              return extractContours(c, keep);
            });
            return { ...layer, contours };
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        splitContourAtPoint: (layerId, contourId, segIndex, t) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          let didCut = false;
          const layers = glyph.layers.map((layer) => {
            if (layer.id !== layerId || effectiveLocked(glyph, layer)) return layer;
            const contours = layer.contours.flatMap((c) => {
              if (c.id !== contourId) return [c];
              const out = splitContourAt(c, segIndex, t);
              // splitContourAt returns the SAME object for a terminal/degenerate cut.
              if (out.length === 1 && out[0] === c) return [c];
              didCut = true;
              return out;
            });
            return { ...layer, contours };
          });
          if (!didCut) return; // missed/terminal click → no phantom undo step
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        splitContoursAtPoints: (cuts) => {
          const s = get();
          if (!s.activeGlyphId || cuts.length === 0) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          // Group cuts by layer → contour.
          const byLayer = new Map<string, Map<string, { segIndex: number; t: number }[]>>();
          for (const c of cuts) {
            const byContour = byLayer.get(c.layerId) ?? new Map<string, { segIndex: number; t: number }[]>();
            const arr = byContour.get(c.contourId) ?? [];
            arr.push({ segIndex: c.segIndex, t: c.t });
            byContour.set(c.contourId, arr);
            byLayer.set(c.layerId, byContour);
          }
          let didCut = false;
          const layers = glyph.layers.map((layer) => {
            const byContour = byLayer.get(layer.id);
            if (!byContour || effectiveLocked(glyph, layer)) return layer;
            const contours = layer.contours.flatMap((c) => {
              const cc = byContour.get(c.id);
              if (!cc) return [c];
              const out = splitContourAtPoints(c, cc);
              if (out.length === 1 && out[0] === c) return [c]; // no effective cut
              didCut = true;
              return out;
            });
            return { ...layer, contours };
          });
          if (!didCut) return;
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        eraseContourSpan: (layerId, contourId, entry, exit) => {
          // No drag (entry ≈ exit) → no span to remove.
          if (entry.segIndex === exit.segIndex && Math.abs(entry.t - exit.t) < 1e-4) return;
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          let changed = false;
          const layers = glyph.layers.map((layer) => {
            if (layer.id !== layerId || effectiveLocked(glyph, layer)) return layer;
            const contours = layer.contours.flatMap((c) => {
              if (c.id !== contourId) return [c];
              const pieces = splitContourAtPoints(c, [entry, exit]);
              if (pieces.length < 2) return [c]; // no span (same point / a terminal)
              let kept: Contour[];
              if (c.closed) {
                kept = pieces.slice(1); // drop the lo→hi arc (the dragged span)
              } else {
                // Keep the pieces that still touch an ORIGINAL terminal; the spanned middle
                // (touching neither) is dropped.
                const firstId = c.points[0]!.id;
                const lastId = c.points[c.points.length - 1]!.id;
                kept = pieces.filter(
                  (p) => p.points[0]!.id === firstId || p.points[p.points.length - 1]!.id === lastId,
                );
              }
              if (kept.length === pieces.length) return [c]; // nothing dropped → no-op
              changed = true;
              return kept;
            });
            return { ...layer, contours };
          });
          if (!changed) return;
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        convertPoints: (refs, mode) => {
          // Same cross-layer grouping as deletePoints: each targeted node is
          // converted in place via the pure nodeHandles helper (neighbors read
          // from the original contour). Locked layers skipped; one undo step.
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const byLayer = new Map<string, Map<string, Set<string>>>();
          for (const ref of refs) {
            const byContour = byLayer.get(ref.layerId) ?? new Map<string, Set<string>>();
            const ids = byContour.get(ref.contourId) ?? new Set<string>();
            ids.add(ref.pointId);
            byContour.set(ref.contourId, ids);
            byLayer.set(ref.layerId, byContour);
          }
          const layers = glyph.layers.map((layer) => {
            const byContour = byLayer.get(layer.id);
            if (!byContour || effectiveLocked(glyph, layer)) return layer;
            const contours = layer.contours.map((c) => {
              const ids = byContour.get(c.id);
              if (!ids) return c;
              return {
                ...c,
                points: c.points.map((p) =>
                  ids.has(p.id) ? convertPoint(c, p.id, mode) : p,
                ),
              };
            });
            return { ...layer, contours };
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        joinEndpoints: (a, b) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          // Endpoint role within a contour: 0 = first, last index = last.
          const endRole = (c: Contour, pointId: string): "start" | "end" | null => {
            if (c.points[0]?.id === pointId) return "start";
            if (c.points[c.points.length - 1]?.id === pointId) return "end";
            return null;
          };
          // Locate each endpoint's contour by its ref's layer — so the two ends may
          // live on DIFFERENT layers (the right-click "Merge nodes"); the joined path
          // lands on b's layer (the target), mirroring drag-to-merge.
          const la = findLayer(glyph, a.layerId);
          const lb = findLayer(glyph, b.layerId);
          if (!la || !lb || la.locked || lb.locked) return;
          const ca = la.contours.find((c) => c.id === a.contourId);
          const cb = lb.contours.find((c) => c.id === b.contourId);
          if (!ca || !cb) return;
          const ra = endRole(ca, a.pointId);
          const rb = endRole(cb, b.pointId);
          if (!ra || !rb) return;

          // Same contour, its two distinct ends → close it in place.
          if (ca === cb) {
            if (a.pointId === b.pointId) return;
            const layers = glyph.layers.map((layer) =>
              layer.id === lb.id
                ? {
                    ...layer,
                    contours: layer.contours.map((c) =>
                      c.id === cb.id ? { ...c, closed: true } : c,
                    ),
                  }
                : layer,
            );
            set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
            return;
          }

          // Keep the TARGET (b) geometry/stroke and drop the (a) coincident endpoint;
          // the merged path replaces cb on b's layer, and ca is removed from its layer.
          const merged = joinContours(cb, ca, rb === "start", ra === "start");
          const layers = glyph.layers.map((layer) => {
            if (layer.id === lb.id) {
              const contours = layer.contours
                .map((c) => (c.id === cb.id ? merged : c))
                .filter((c) => c.id !== ca.id);
              return { ...layer, contours };
            }
            if (layer.id === la.id) {
              return { ...layer, contours: layer.contours.filter((c) => c.id !== ca.id) };
            }
            return layer;
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        deleteContour: (contourId) =>
          mutateActiveLayer((contours) => contours.filter((c) => c.id !== contourId)),

        deleteContours: (contourIds) => {
          const drop = new Set(contourIds);
          mutateActiveLayer((contours) => contours.filter((c) => !drop.has(c.id)));
        },

        deleteContoursEverywhere: (contourIds) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const drop = new Set(contourIds);
          const layers = glyph.layers.map((layer) => {
            if (effectiveLocked(glyph, layer)) return layer;
            const kept = layer.contours.filter((c) => !drop.has(c.id));
            return kept.length === layer.contours.length ? layer : { ...layer, contours: kept };
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        moveContoursToLayer: (contourIds, targetLayerId) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const target = findLayer(glyph, targetLayerId);
          if (!target || target.locked) return;
          const move = new Set(contourIds);
          // Collect the contours to move (from any unlocked source layer) in paint order.
          const moving: Contour[] = [];
          for (const layer of glyph.layers) {
            if (layer.locked) continue;
            for (const c of layer.contours) if (move.has(c.id)) moving.push(c);
          }
          if (moving.length === 0) return;
          const movedIds = new Set(moving.map((c) => c.id));
          const layers = glyph.layers.map((layer) => {
            if (layer.id === targetLayerId) {
              // Append the moved contours on top, dropping any that were already here.
              const kept = layer.contours.filter((c) => !movedIds.has(c.id));
              return { ...layer, contours: [...kept, ...moving] };
            }
            if (effectiveLocked(glyph, layer)) return layer;
            const kept = layer.contours.filter((c) => !movedIds.has(c.id));
            return kept.length === layer.contours.length ? layer : { ...layer, contours: kept };
          });
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        moveContoursToNewLayer: (contourIds) => {
          const s = get();
          if (!s.activeGlyphId) return null;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return null;
          const move = new Set(contourIds);
          const moving: Contour[] = [];
          for (const layer of glyph.layers) {
            if (layer.locked) continue;
            for (const c of layer.contours) if (move.has(c.id)) moving.push(c);
          }
          if (moving.length === 0) return null;
          const movedIds = new Set(moving.map((c) => c.id));
          const dest = { ...makeEmptyLayer(nextLayerName(glyph)), contours: moving };
          // Drop the moved contours from their sources, then add the new layer on top.
          const stripped = glyph.layers.map((layer) => {
            if (effectiveLocked(glyph, layer)) return layer;
            const kept = layer.contours.filter((c) => !movedIds.has(c.id));
            return kept.length === layer.contours.length ? layer : { ...layer, contours: kept };
          });
          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers: [...stripped, dest] } },
            activeLayerId: dest.id,
            selectedLayerIds: [dest.id],
          });
          return dest.id;
        },

        addImportedLayer: (contours, name) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph || contours.length === 0) return;
          // Inherit the active layer's group so the splice above it cannot
          // split that group's contiguous run.
          const inheritedGid = inheritGroupId(glyph, s.activeLayerId);
          // Baked = render the imported geometry verbatim (holes/colours preserved).
          const layer: Layer = {
            ...makeEmptyLayer(name ?? nextLayerName(glyph)),
            contours,
            baked: true,
            ...(inheritedGid ? { groupId: inheritedGid } : {}),
          };
          const at = glyph.layers.findIndex((l) => l.id === s.activeLayerId);
          const insert = at >= 0 ? at + 1 : glyph.layers.length;
          const layers = [...glyph.layers.slice(0, insert), layer, ...glyph.layers.slice(insert)];
          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } },
            activeLayerId: layer.id,
            selectedLayerIds: [layer.id],
          });
        },

        expandStrokesToLayer: (expanded, removeRefs, name) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph || expanded.length === 0) return;
          // Drop the original stroked centerlines (contour ids are unique per glyph).
          const removeIds = new Set(removeRefs.map((r) => r.contourId));
          const stripped = glyph.layers.map((layer) => {
            const kept = layer.contours.filter((c) => !removeIds.has(c.id));
            return kept.length === layer.contours.length ? layer : { ...layer, contours: kept };
          });
          // Baked = render the expanded outline verbatim (holes/winding preserved).
          // Inherit the active layer's group so the splice above it cannot
          // split that group's contiguous run.
          const inheritedGid = inheritGroupId(glyph, s.activeLayerId);
          const layer: Layer = {
            ...makeEmptyLayer(name ?? nextLayerName(glyph)),
            contours: expanded,
            baked: true,
            ...(inheritedGid ? { groupId: inheritedGid } : {}),
          };
          const at = stripped.findIndex((l) => l.id === s.activeLayerId);
          const insert = at >= 0 ? at + 1 : stripped.length;
          const layers = [...stripped.slice(0, insert), layer, ...stripped.slice(insert)];
          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } },
            activeLayerId: layer.id,
            selectedLayerIds: [layer.id],
          });
        },

        setActiveLayer: (layerId) => {
          const s = get();
          const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
          // Plain activation selects only this layer (single-select) and clears any
          // group target, so the reorder buttons act on the layer again.
          if (glyph && findLayer(glyph, layerId)) {
            set({ activeLayerId: layerId, selectedLayerIds: [layerId], activeGroupId: null });
          }
        },

        toggleLayerSelection: (layerId) => {
          const s = get();
          const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
          if (!glyph || !findLayer(glyph, layerId)) return;
          const has = s.selectedLayerIds.includes(layerId);
          if (has) {
            if (s.selectedLayerIds.length <= 1) return; // keep at least one selected
            const selectedLayerIds = s.selectedLayerIds.filter((id) => id !== layerId);
            const activeLayerId =
              s.activeLayerId === layerId
                ? selectedLayerIds[selectedLayerIds.length - 1] ?? s.activeLayerId
                : s.activeLayerId;
            set({ selectedLayerIds, activeLayerId, activeGroupId: null });
          } else {
            // Add and make it active so edits target the just-clicked layer.
            set({
              selectedLayerIds: [...s.selectedLayerIds, layerId],
              activeLayerId: layerId,
              activeGroupId: null,
            });
          }
        },

        selectLayerRange: (layerId) => {
          const s = get();
          const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
          if (!glyph || !findLayer(glyph, layerId)) return;
          const anchorId = s.activeLayerId;
          const anchorIdx = glyph.layers.findIndex((l) => l.id === anchorId);
          // No valid anchor → behave like a plain activation of the clicked layer.
          if (anchorIdx < 0) {
            set({ activeLayerId: layerId, selectedLayerIds: [layerId] });
            return;
          }
          // Range over the PANEL's row order, not the raw array: with groups the two
          // differ (a collapsed group hides rows), and selecting a layer the user
          // cannot see would be a surprise. Layers inside a collapsed group are
          // therefore skipped, and a group row contributes all of its members.
          const rows = visibleRows(glyph);
          const rowIds: string[][] = rows.map((r) =>
            r.group ? groupMembers(glyph, r.group.id).map((l) => l.id) : [r.layer!.id],
          );
          const rowOf = (id: string): number =>
            rowIds.findIndex((ids) => ids.includes(id));
          const a = rowOf(anchorId!);
          const b = rowOf(layerId);
          if (a < 0 || b < 0) {
            set({ activeLayerId: layerId, selectedLayerIds: [layerId] });
            return;
          }
          const from = Math.min(a, b);
          const to = Math.max(a, b);
          // Keep the result in STACK order (bottom-to-top), matching `glyph.layers`
          // and the pre-groups behaviour — `visibleRows` is top-down for display only.
          const picked = new Set(rowIds.slice(from, to + 1).flat());
          const selectedLayerIds = glyph.layers.filter((l) => picked.has(l.id)).map((l) => l.id);
          // Keep the anchor active so repeated Shift+clicks extend from the same row.
          set({ selectedLayerIds });
        },

        addLayer: () => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const inherited = inheritGroupId(glyph, s.activeLayerId);
          const base = makeEmptyLayer(nextLayerName(glyph));
          // Join the active layer's group: the insert lands directly above it, so a
          // group-less new layer would split that group's contiguous run.
          const layer = inherited ? { ...base, groupId: inherited } : base;
          const at = glyph.layers.findIndex((l) => l.id === s.activeLayerId);
          const insert = at >= 0 ? at + 1 : glyph.layers.length;
          const layers = [
            ...glyph.layers.slice(0, insert),
            layer,
            ...glyph.layers.slice(insert),
          ];
          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } },
            activeLayerId: layer.id,
            selectedLayerIds: [layer.id],
          });
        },

        duplicateLayer: (layerId) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const id = layerId ?? s.activeLayerId;
          const at = glyph.layers.findIndex((l) => l.id === id);
          const src = at >= 0 ? glyph.layers[at] : undefined;
          if (!src) return;
          const clone = cloneLayer(src);
          const layers = [
            ...glyph.layers.slice(0, at + 1),
            clone,
            ...glyph.layers.slice(at + 1),
          ];
          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } },
            activeLayerId: clone.id,
            selectedLayerIds: [clone.id],
          });
        },

        deleteLayer: (layerId) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph || glyph.layers.length <= 1) return; // keep at least one
          const at = glyph.layers.findIndex((l) => l.id === layerId);
          if (at < 0) return;
          const layers = glyph.layers.filter((l) => l.id !== layerId);
          let nextGlyph: Glyph = { ...glyph, layers };
          // Drop any boolean pair that referenced the removed layer.
          if (glyph.booleanPairs) {
            nextGlyph.booleanPairs = glyph.booleanPairs.filter(
              (p) => !p.layerIds.includes(layerId),
            );
          }
          // Drop groups the delete left empty (and any pair that referenced them), so
          // a dissolved folder can't linger as a phantom row or a stale operand.
          nextGlyph = pruneEmptyGroups(nextGlyph);
          let activeLayerId = s.activeLayerId;
          if (s.activeLayerId === layerId) {
            activeLayerId = layers[Math.min(at, layers.length - 1)]?.id ?? null;
          }
          // Drop the removed layer from the multi-selection; keep active in it.
          let selectedLayerIds = s.selectedLayerIds.filter((id) => id !== layerId);
          if (activeLayerId && !selectedLayerIds.includes(activeLayerId)) {
            selectedLayerIds = [activeLayerId];
          }
          set({
            glyphs: { ...s.glyphs, [glyph.id]: nextGlyph },
            activeLayerId,
            selectedLayerIds,
          });
        },

        renameLayer: (layerId, name) =>
          mutateLayers((layers) =>
            layers.map((l) =>
              l.id === layerId ? { ...l, name: name.trim() || l.name } : l,
            ),
          ),

        setLayerVisible: (layerId, visible) =>
          mutateLayers((layers) =>
            layers.map((l) => (l.id === layerId ? { ...l, visible } : l)),
          ),

        setLayerLocked: (layerId, locked) =>
          mutateLayers((layers) =>
            layers.map((l) => (l.id === layerId ? { ...l, locked } : l)),
          ),

        setBooleanPair: (aLayerId, bLayerId, op, steps) => {
          const s = get();
          if (!s.activeGlyphId || aLayerId === bLayerId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          // An operand is a layer OR a whole group (a group renders as one synthetic
          // layer whose id is the group's, so `buildFillGroups` resolves it the same way).
          const isOperand = (id: string): boolean => !!findLayer(glyph, id) || !!findGroup(glyph, id);
          if (!isOperand(aLayerId) || !isOperand(bLayerId)) return;

          // Exclusivity: drop any existing pair that references either operand,
          // then add the new one.
          const kept = (glyph.booleanPairs ?? []).filter(
            (p) => !p.layerIds.includes(aLayerId) && !p.layerIds.includes(bLayerId),
          );
          const pair: BooleanPair = {
            id: createId("bp"),
            layerIds: [aLayerId, bLayerId],
            op,
            ...(op === "blend" && steps != null ? { steps } : {}),
          };
          // Pairing a group MEANS treating it as one shape, so make sure it actually
          // renders that way. Without this the group would still emit its members
          // individually, none of them matching the pair's id — and `buildFillGroups`
          // (which only resolves pairs whose BOTH members are present) would silently
          // drop the boolean, leaving the user with an op that appears to do nothing.
          const operandGroups = new Set(
            [aLayerId, bLayerId].filter((id) => findGroup(glyph, id)),
          );
          const layerGroups = operandGroups.size
            ? (glyph.layerGroups ?? []).map((g) =>
                operandGroups.has(g.id) && !g.renderAsOne ? { ...g, renderAsOne: true } : g,
              )
            : glyph.layerGroups;

          set({
            glyphs: {
              ...s.glyphs,
              [glyph.id]: {
                ...glyph,
                booleanPairs: [...kept, pair],
                ...(layerGroups ? { layerGroups } : {}),
              },
            },
          });
        },

        clearBooleanPair: (layerId) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph || !glyph.booleanPairs?.length) return;
          const kept = glyph.booleanPairs.filter((p) => !p.layerIds.includes(layerId));
          if (kept.length === glyph.booleanPairs.length) return;
          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, booleanPairs: kept } },
          });
        },

        commitMerge: (removeIds, merged) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const remove = new Set(removeIds);
          const indices = glyph.layers
            .map((l, i) => (remove.has(l.id) ? i : -1))
            .filter((i) => i >= 0);
          if (indices.length < 2) return; // need ≥2 real layers to merge
          const insertAt = Math.min(...indices);
          // Keep order; drop the removed layers and slot the merged one where the
          // lowest removed layer was (so paint order is preserved).
          const below = glyph.layers
            .slice(0, insertAt)
            .filter((l) => !remove.has(l.id)).length;
          const kept = glyph.layers.filter((l) => !remove.has(l.id));
          const layers = [...kept.slice(0, below), merged, ...kept.slice(below)];

          let nextGlyph: Glyph = { ...glyph, layers };
          if (glyph.booleanPairs) {
            nextGlyph.booleanPairs = glyph.booleanPairs.filter(
              (p) => !p.layerIds.some((id) => remove.has(id)),
            );
          }
          nextGlyph = pruneEmptyGroups(nextGlyph);
          set({
            glyphs: { ...s.glyphs, [glyph.id]: nextGlyph },
            activeLayerId: merged.id,
            selectedLayerIds: [merged.id],
          });
        },

        groupLayers: (layerIds, name) => {
          const s = get();
          if (!s.activeGlyphId) return null;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return null;
          const wanted = new Set(layerIds);
          const members = glyph.layers.filter((l) => wanted.has(l.id));
          if (members.length === 0) return null;

          // What gets re-parented into the new group are UNITS, not raw layers: if a
          // whole existing group is inside the selection, that GROUP is nested (kept
          // intact) rather than having its layers re-tagged — otherwise grouping two
          // groups would silently dissolve both into one flat folder.
          const selected = new Set(members.map((l) => l.id));
          const fullyContained = (gid: string): boolean => {
            const ms = groupMembers(glyph, gid);
            return ms.length > 0 && ms.every((l) => selected.has(l.id));
          };
          // The TOPMOST fully-contained ancestor. Containment is monotone going up (a
          // child is a subset of its parent), so the last `true` in the chain wins.
          const unitGroupFor = (gid: string | undefined): string | null => {
            let best: string | null = null;
            for (const id of gid ? [gid, ...ancestors(glyph, gid).map((a) => a.id)] : []) {
              if (!fullyContained(id)) break;
              best = id;
            }
            return best;
          };

          const unitGroups = new Set<string>();
          const unitLayers = new Set<string>();
          for (const l of members) {
            const unit = unitGroupFor(l.groupId);
            if (unit) unitGroups.add(unit);
            else unitLayers.add(l.id);
          }

          // Nest under the parent every unit already shares; mixed ⇒ top level.
          const parents = new Set<string | undefined>([
            ...[...unitGroups].map((id) => findGroup(glyph, id)?.parentId),
            ...[...unitLayers].map((id) => glyph.layers.find((l) => l.id === id)?.groupId),
          ]);
          const parentId = parents.size === 1 ? [...parents][0] : undefined;

          const groupId = createId("grp");
          const group: LayerGroup = {
            id: groupId,
            name: name?.trim() || nextGroupName(glyph),
            visible: true,
            locked: false,
            // New groups render as ONE layer — that is what "group" means here.
            // Turn it off per group to get a plain organisational folder.
            renderAsOne: true,
            ...(parentId ? { parentId } : {}),
          };

          // CONTIGUITY: pull the members out and reinsert them as one run at the
          // topmost member's slot, so the group occupies an unbroken range.
          const memberIds = new Set(members.map((l) => l.id));
          const rest = glyph.layers.filter((l) => !memberIds.has(l.id));
          let top = -1;
          glyph.layers.forEach((l, i) => {
            if (memberIds.has(l.id)) top = i;
          });
          const below = glyph.layers.slice(0, top).filter((l) => !memberIds.has(l.id)).length;
          // Only layers that are NOT already covered by a nested unit group get re-tagged.
          const tagged = members.map((l) =>
            unitLayers.has(l.id) ? { ...l, groupId } : l,
          );
          const layers = [...rest.slice(0, below), ...tagged, ...rest.slice(below)];

          // Unit groups keep their own layers; only their parent pointer moves.
          const layerGroups = [
            ...(glyph.layerGroups ?? []).map((gr) =>
              unitGroups.has(gr.id) ? { ...gr, parentId: groupId } : gr,
            ),
            group,
          ];

          set({
            glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers, layerGroups } },
          });
          return groupId;
        },

        ungroupGroup: (groupId) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const groups = glyph.layerGroups ?? [];
          const target = groups.find((g) => g.id === groupId);
          if (!target) return;

          // Re-parent one level up: direct layers and direct child groups both adopt
          // the dissolved group's own parent, so an inner group survives intact.
          const up = target.parentId;
          const layers = glyph.layers.map((l) => {
            if (l.groupId !== groupId) return l;
            const next = { ...l };
            if (up) next.groupId = up;
            else delete next.groupId;
            return next;
          });
          const layerGroups = groups
            .filter((g) => g.id !== groupId)
            .map((g) => {
              if (g.parentId !== groupId) return g;
              const next = { ...g };
              if (up) next.parentId = up;
              else delete next.parentId;
              return next;
            });
          // A pair naming the dissolved group would dangle — the group no longer
          // renders as a single layer, so the op could never resolve.
          const next = withGroups({ ...glyph, layers }, layerGroups);
          const pairs = (next.booleanPairs ?? []).filter((p) => !p.layerIds.includes(groupId));
          const cleaned: Glyph = pairs.length
            ? { ...next, booleanPairs: pairs }
            : (() => {
                const o = { ...next };
                delete o.booleanPairs;
                return o;
              })();
          set({ glyphs: { ...s.glyphs, [glyph.id]: cleaned } });
        },

        renameGroup: (groupId, name) =>
          mutateGroups((groups) =>
            groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g)),
          ),

        setGroupCollapsed: (groupId, collapsed) =>
          mutateGroups((groups) =>
            groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
          ),

        setGroupVisible: (groupId, visible) =>
          mutateGroups((groups) =>
            groups.map((g) => (g.id === groupId ? { ...g, visible } : g)),
          ),

        setGroupLocked: (groupId, locked) =>
          mutateGroups((groups) =>
            groups.map((g) => (g.id === groupId ? { ...g, locked } : g)),
          ),

        setGroupRenderAsOne: (groupId, renderAsOne) =>
          mutateGroups((groups) =>
            groups.map((g) => (g.id === groupId ? { ...g, renderAsOne } : g)),
          ),

        selectGroup: (groupId, additive = false) => {
          const s = get();
          const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
          if (!glyph) return;
          const ids = groupMembers(glyph, groupId).map((l) => l.id);
          if (ids.length === 0) return;
          const selectedLayerIds = additive
            ? [...new Set([...s.selectedLayerIds, ...ids])]
            : ids;
          // The lowest member becomes active, so new geometry lands inside the group,
          // and the group itself becomes the target for move/duplicate/delete.
          set({ selectedLayerIds, activeLayerId: ids[0]!, activeGroupId: groupId });
        },

        moveGroup: (groupId, direction) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const range = groupRange(glyph, groupId);
          const self = findGroup(glyph, groupId);
          if (!range || !self) return;
          const [lo, hi] = range;

          // The adjacent item in the move direction must be a SIBLING (same parent);
          // anything else would mean re-parenting, which needs drag-and-drop.
          const probe = direction === "up" ? hi + 1 : lo - 1;
          const neighbour = glyph.layers[probe];
          if (!neighbour) return;
          const nGroup = neighbour.groupId ? findGroup(glyph, neighbour.groupId) : undefined;
          // Resolve the neighbour to the sibling BLOCK it belongs to.
          let block: [number, number];
          if (!nGroup) {
            if ((self.parentId ?? undefined) !== undefined) return; // leaving the parent
            block = [probe, probe];
          } else {
            const sibId = siblingAncestor(glyph, nGroup.id, self.parentId);
            if (!sibId) return; // the neighbour is outside our parent → no-op
            const r = groupRange(glyph, sibId);
            if (!r) return;
            block = r;
          }

          const run = glyph.layers.slice(lo, hi + 1);
          const other = glyph.layers.slice(block[0], block[1] + 1);
          const head = glyph.layers.slice(0, Math.min(lo, block[0]));
          const tail = glyph.layers.slice(Math.max(hi, block[1]) + 1);
          const layers =
            direction === "up" ? [...head, ...other, ...run, ...tail] : [...head, ...run, ...other, ...tail];
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },

        moveLayer: (layerId, direction) => {
          const s = get();
          if (!s.activeGlyphId) return;
          const glyph = s.glyphs[s.activeGlyphId];
          if (!glyph) return;
          const at = glyph.layers.findIndex((l) => l.id === layerId);
          if (at < 0) return;
          const self = glyph.layers[at]!;
          const gid = self.groupId;

          // Leaving a group: at the edge of its own group's run, a further step OUT
          // pops the layer out of the folder instead of dragging an outsider into the
          // run (which would break CONTIGUITY). Its array position is already correct,
          // so only the tag changes — one press to leave, another to actually move.
          if (gid) {
            const range = groupRange(glyph, gid);
            if (range) {
              const atEdge = direction === "up" ? at === range[1] : at === range[0];
              if (atEdge) {
                const up = findGroup(glyph, gid)?.parentId;
                const layers = glyph.layers.map((l) => {
                  if (l.id !== layerId) return l;
                  const next = { ...l };
                  if (up) next.groupId = up;
                  else delete next.groupId;
                  return next;
                });
                set({
                  glyphs: {
                    ...s.glyphs,
                    [glyph.id]: pruneEmptyGroups({ ...glyph, layers }),
                  },
                });
                return;
              }
            }
          }

          // Array order is bottom-to-top, so "up" (toward the top) is +1.
          const probe = direction === "up" ? at + 1 : at - 1;
          const neighbour = glyph.layers[probe];
          if (!neighbour) return;

          // A neighbour inside a group we are NOT in must be stepped OVER as a whole
          // block — swapping into it would wedge an outsider inside its run.
          let to = probe;
          if (neighbour.groupId && neighbour.groupId !== gid) {
            const sibId = siblingAncestor(glyph, neighbour.groupId, gid);
            const r = sibId ? groupRange(glyph, sibId) : null;
            if (r) to = direction === "up" ? r[1] : r[0];
          }

          const layers = moveInArray(glyph.layers, at, to);
          if (layers === glyph.layers) return;
          set({ glyphs: { ...s.glyphs, [glyph.id]: { ...glyph, layers } } });
        },
      };
    },
);

/** The active glyph, or null. */
export function useActiveGlyph(): Glyph | null {
  return useDocumentStore((s) =>
    s.activeGlyphId ? s.glyphs[s.activeGlyphId] ?? null : null,
  );
}

export function useActiveGlyphId(): string | null {
  return useDocumentStore((s) => s.activeGlyphId);
}

/**
 * All glyphs sorted by code point (font order). Selects the stable `glyphs`
 * reference and memoizes the sort, so the array identity only changes when the
 * glyph set actually changes — avoiding the fresh-array-every-render pitfall.
 */
export function useGlyphList(): Glyph[] {
  const glyphs = useDocumentStore((s) => s.glyphs);
  return useMemo(
    () => Object.values(glyphs).sort((a, b) => a.codepoint - b.codepoint),
    [glyphs],
  );
}

export function useActiveLayerId(): string | null {
  return useDocumentStore((s) => s.activeLayerId);
}

/** The group row the user last clicked, or null when a plain layer is the target. */
export function useActiveGroupId(): string | null {
  return useDocumentStore((s) => s.activeGroupId);
}

/** Ids of the selected layers (always includes the active layer). */
export function useSelectedLayerIds(): string[] {
  return useDocumentStore((s) => s.selectedLayerIds);
}

/** The active glyph's boolean pairs (empty array when none). */
export function useBooleanPairs(): BooleanPair[] {
  return useDocumentStore((s) => {
    const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
    return glyph?.booleanPairs ?? EMPTY_PAIRS;
  });
}

/** The active glyph's layer groups (empty array when none). A stable empty array so
 *  an ungrouped document never re-renders on identity churn. */
export function useLayerGroups(): LayerGroup[] {
  return useDocumentStore((s) => {
    const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
    return glyph?.layerGroups ?? EMPTY_GROUPS;
  });
}

/** Stable empty reference so useBooleanPairs doesn't churn on every render. */
const EMPTY_PAIRS: BooleanPair[] = [];
const EMPTY_GROUPS: LayerGroup[] = [];

/** Find the boolean pair a layer belongs to, if any. */
export function pairForLayer(
  pairs: BooleanPair[],
  layerId: string,
): BooleanPair | undefined {
  return pairs.find((p) => p.layerIds.includes(layerId));
}

/** The active layer object, or null. */
export function useActiveLayer(): Layer | null {
  return useDocumentStore((s) => {
    const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
    if (!glyph || !s.activeLayerId) return null;
    return glyph.layers.find((l) => l.id === s.activeLayerId) ?? null;
  });
}

// Per-glyph undo/redo lives in `state/history.ts` (`useHistory`, `useHistoryStore`).

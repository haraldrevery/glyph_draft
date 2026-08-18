import type { AnchorPoint, Contour, HandleKind, PointRef } from "../../types/geometry";
import type { Layer } from "../../types/document";
import type { Vec2 } from "../../types/viewport";
import { hitTestLayers, hitEndpoint, screenDistance, HANDLE_COLLAPSE_PX } from "./hitTest";
import {
  selectedIdSet,
  applyAnchorDelta,
  editableLayers,
  refsInPolygon,
  leadPoint,
  dragDelta,
} from "./shared";
import { dragSnapFn } from "./snapGeometry";
import { constrainAngle } from "../../engine/snapping/snap";
import { sameRef } from "../../state/editorStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ToolDefinition, ToolPointerContext } from "./types";
import { resolvedLayers } from "../layers/layerTree";

/** Minimum drag (px) before an empty-canvas press counts as a marquee, not a click. */
const MARQUEE_MIN_PX = 3;

/** The four corners (min/max, drag-direction agnostic) of a world-space rectangle. */
export function rectRing(a: Vec2, b: Vec2): Vec2[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * The direct-selection / node tool (Illustrator's white arrow). It selects
 * anchors, drags them, and drags their bezier handles. This is what makes pen
 * output and primitives editable, so it is the default tool.
 *
 * Live drags are written to the editor store's `liveContours` override every
 * frame and rendered in place; the document is only touched once, on release,
 * via a single batched `replaceContours` — so an entire drag (however many
 * frames) is one undo step. Anchor moves use the snapped delta so on-grid
 * points stay on-grid; handle moves use the raw cursor for smooth control and
 * mirror the opposite handle on smooth points (Alt breaks the mirror).
 */

type DragState =
  | { mode: "anchor"; origin: Contour[]; refs: PointRef[]; lead: PointRef; startRaw: Vec2 }
  | { mode: "handle"; origin: Contour; ref: PointRef; handle: HandleKind }
  | { mode: "marquee"; start: Vec2; additive: boolean }
  | null;

// Module-scoped: the tool is a singleton, so this holds the gesture in flight.
let drag: DragState = null;

/** The dragged ref when it's a single anchor that is an endpoint of an open
 *  contour — the only case eligible for merge-on-drag. */
function soleEndpointRef(d: DragState): PointRef | null {
  if (!d || d.mode !== "anchor" || d.refs.length !== 1) return null;
  const ref = d.refs[0]!;
  const c = d.origin.find((x) => x.id === ref.contourId);
  if (!c || c.closed) return null;
  const isEnd =
    c.points[0]?.id === ref.pointId ||
    c.points[c.points.length - 1]?.id === ref.pointId;
  return isEnd ? ref : null;
}

/** Visible, unlocked layers in TOP-TO-BOTTOM order — what the user can pick. */
function editableLayersTopFirst(ctx: ToolPointerContext): Layer[] {
  return ctx.glyph ? resolvedLayers(ctx.glyph).filter((l) => l.visible && !l.locked).reverse() : [];
}

/** Contours of a specific layer in the active glyph. */
function layerContours(ctx: ToolPointerContext, layerId: string): Contour[] {
  return ctx.glyph?.layers.find((l) => l.id === layerId)?.contours ?? [];
}

/** Flat contours of every visible+unlocked layer that owns one of the given refs —
 *  the origin for a CROSS-LAYER anchor drag (the selection can span layers). */
function originForRefs(ctx: ToolPointerContext, refs: PointRef[]): Contour[] {
  const layerIds = new Set(refs.map((r) => r.layerId));
  const out: Contour[] = [];
  for (const l of ctx.glyph?.layers ?? []) {
    if (l.visible && !l.locked && layerIds.has(l.id)) out.push(...l.contours);
  }
  return out;
}

/** Whether a handle drag mirrors the opposite handle: only SMOOTH nodes keep their
 *  handles symmetric; cusp/corner nodes move each handle independently. Alt is a
 *  momentary override that breaks the mirror on a smooth node. */
export function mirrorForDrag(node: AnchorPoint | undefined, alt: boolean): boolean {
  return node?.type === "smooth" && !alt;
}

/** Set or CLEAR one handle on the dragged point, mirroring the opposite if smooth.
 *  `pos === null` drops the handle (a near-zero handle collapsed to a corner); the
 *  mirror of a cleared handle is also cleared. When the node ends up with no handles
 *  it becomes a corner so the marker/hit-testing match the now-straight segments. */
export function applyHandle(
  origin: Contour,
  ref: PointRef,
  handle: HandleKind,
  pos: Vec2 | null,
  mirror: boolean,
): Contour {
  return {
    ...origin,
    points: origin.points.map((p) => {
      if (p.id !== ref.pointId) return p;
      const next: AnchorPoint = { ...p };
      const setSide = (side: HandleKind, v: Vec2 | null) => {
        if (side === "out") {
          if (v) next.handleOut = v;
          else delete next.handleOut;
        } else {
          if (v) next.handleIn = v;
          else delete next.handleIn;
        }
      };
      setSide(handle, pos);
      if (mirror) {
        const opposite: Vec2 | null = pos ? { x: 2 * p.x - pos.x, y: 2 * p.y - pos.y } : null;
        setSide(handle === "out" ? "in" : "out", opposite);
      }
      if (!next.handleIn && !next.handleOut) next.type = "corner";
      return next;
    }),
  };
}

export const selectTool: ToolDefinition = {
  id: "select",
  label: "Direct Select",
  shortcut: "v",
  cursor: "default",
  // Picking shouldn't chase the grid: no ambient snap crosshair while hovering/clicking.
  // A node DRAG still snaps and sets its own landing crosshair (see onPointerMove).
  snapsOnHover: false,

  onPointerDown: (ctx) => {
    const hit = hitTestLayers(
      editableLayersTopFirst(ctx),
      ctx.viewport,
      ctx.screen,
      selectedIdSet(ctx.editor.selection),
    );

    if (hit?.kind === "handle") {
      // Editing a handle activates its layer so the commit lands there.
      if (hit.ref.layerId !== ctx.layer?.id) ctx.doc.setActiveLayer(hit.ref.layerId);
      const origin = layerContours(ctx, hit.ref.layerId).find(
        (c) => c.id === hit.ref.contourId,
      );
      if (origin) drag = { mode: "handle", origin, ref: hit.ref, handle: hit.handle };
      return;
    }

    if (hit?.kind === "anchor") {
      // Clicking an anchor activates its layer (so new geometry lands there); the drag
      // moves the WHOLE selection across layers (origin spans every layer that owns a
      // selected ref; the commit uses replaceContoursEverywhere).
      if (hit.ref.layerId !== ctx.layer?.id) ctx.doc.setActiveLayer(hit.ref.layerId);
      const already = ctx.editor.selection.some((r) => sameRef(r, hit.ref));
      let refs: PointRef[];
      if (ctx.modifiers.shift) {
        ctx.editor.toggleSelection(hit.ref);
        refs = already
          ? ctx.editor.selection.filter((r) => !sameRef(r, hit.ref))
          : [...ctx.editor.selection, hit.ref];
      } else {
        refs = already ? ctx.editor.selection : [hit.ref];
        if (!already) ctx.editor.setSelection([hit.ref]);
      }
      drag = {
        mode: "anchor",
        origin: originForRefs(ctx, refs),
        refs,
        lead: hit.ref,
        startRaw: ctx.rawWorld,
      };
      return;
    }

    // Empty space: start a marquee (box-select). The clear-on-plain-click is
    // deferred to pointer-up so a drag selects but a bare click still deselects.
    drag = { mode: "marquee", start: ctx.world, additive: ctx.modifiers.shift };
    ctx.editor.setMarquee({ a: ctx.world, b: ctx.world });
  },

  onPointerMove: (ctx) => {
    if (!ctx.isDown || !drag) {
      // Hover feedback when idle (across all editable layers).
      const hit = hitTestLayers(
        editableLayersTopFirst(ctx),
        ctx.viewport,
        ctx.screen,
        selectedIdSet(ctx.editor.selection),
      );
      ctx.editor.setHover(hit?.kind === "anchor" ? hit.ref : null);
      return;
    }

    if (drag.mode === "anchor") {
      // Snap the GRABBED node's absolute position to the grid (not the cursor
      // delta), so a dragged node locks to the current grid even after the grid
      // size changes; the group keeps its relative spacing. With snap-to-point on,
      // it locks to a nearby anchor/path instead (excluding the moving selection).
      const vp = useViewportStore.getState();
      const grid = vp.grid;
      const snapFn =
        vp.snapToGeometry && ctx.glyph
          ? dragSnapFn(resolvedLayers(ctx.glyph).filter((l) => l.visible), ctx.viewport, drag.refs)
          : undefined;
      const lead = leadPoint(drag.origin, drag.lead);
      const d: Vec2 = lead
        ? dragDelta(lead, drag.startRaw, ctx.rawWorld, grid, snapFn)
        : { x: ctx.rawWorld.x - drag.startRaw.x, y: ctx.rawWorld.y - drag.startRaw.y };
      ctx.editor.setLiveContours(applyAnchorDelta(drag.origin, drag.refs, d));
      // Keep the snap crosshair on the node's landing point (matches what locks).
      if ((grid.snap || vp.snapToGeometry) && lead) {
        ctx.editor.setCursor({
          raw: ctx.rawWorld,
          snapped: { x: lead.x + d.x, y: lead.y + d.y },
        });
      }
      // Merge feedback: highlight an endpoint the dragged endpoint would fuse to
      // (same layer only — matches what the pointer-up merge will actually do).
      const ep = useViewportStore.getState().mergeEndpoints ? soleEndpointRef(drag) : null;
      const target = ep
        ? hitEndpoint(editableLayersTopFirst(ctx), ctx.viewport, ctx.screen, ep)
        : null;
      ctx.editor.setHover(target && ep && target.layerId === ep.layerId ? target : null);
    } else if (drag.mode === "marquee") {
      ctx.editor.setMarquee({ a: drag.start, b: ctx.world });
    } else {
      const d = drag; // narrowed to the handle gesture (drag is module-scoped)
      // Same handle rules as the pen: Shift locks the angle to the nearest 45°
      // from the node; otherwise `handleWorld` (grid-snapped only when "handle
      // grid lock" is on). Shift is free here — it only toggles multi-select on
      // pointer-down, not mid-drag.
      const node = d.origin.points.find((p) => p.id === d.ref.pointId);
      // Smooth nodes keep handles mirrored; cusp/corner nodes move independently.
      const mirror = mirrorForDrag(node, ctx.modifiers.alt);
      const anchor: Vec2 = node ? { x: node.x, y: node.y } : ctx.rawWorld;
      const pos = ctx.modifiers.shift
        ? constrainAngle(anchor, ctx.rawWorld, 45)
        : ctx.handleWorld;
      // Collapse a near-zero handle to a corner: below HANDLE_COLLAPSE_PX on
      // screen, drop it (and its mirror) so the node has no spurious tiny curve.
      // Screen-relative, so zooming in still allows a deliberately small curve.
      const lenPx = Math.hypot(pos.x - anchor.x, pos.y - anchor.y) * ctx.viewport.zoom;
      const handlePos = lenPx < HANDLE_COLLAPSE_PX ? null : pos;
      ctx.editor.setLiveContours([
        applyHandle(d.origin, d.ref, d.handle, handlePos, mirror),
      ]);
    }
  },

  onPointerUp: (ctx) => {
    const live = ctx.editor.liveContours;

    // Marquee (box-select): a drag selects the enclosed nodes; a bare click clears.
    if (drag?.mode === "marquee") {
      const moved =
        screenDistance(drag.start, ctx.screen, ctx.viewport) >= MARQUEE_MIN_PX;
      if (moved) {
        const inside = refsInPolygon(editableLayers(ctx), rectRing(drag.start, ctx.world));
        if (drag.additive) {
          const merged = [...ctx.editor.selection];
          for (const r of inside) if (!merged.some((m) => sameRef(m, r))) merged.push(r);
          ctx.editor.setSelection(merged);
        } else {
          ctx.editor.setSelection(inside);
        }
      } else if (!drag.additive) {
        ctx.editor.clearSelection();
      }
      ctx.editor.setMarquee(null);
      drag = null;
      return;
    }

    // Merge: an endpoint dragged onto another endpoint fuses the two paths
    // (one undo step), instead of committing the move.
    const ep = drag && useViewportStore.getState().mergeEndpoints ? soleEndpointRef(drag) : null;
    if (ep) {
      const target = hitEndpoint(editableLayersTopFirst(ctx), ctx.viewport, ctx.screen, ep);
      // joinEndpoints only fuses within one layer, so a cross-layer target must
      // fall through to the normal move commit — otherwise the drag is lost.
      if (target && target.layerId === ep.layerId) {
        ctx.doc.joinEndpoints(ep, target);
        drag = null;
        ctx.editor.setLiveContours(null);
        ctx.editor.setHover(null);
        ctx.editor.clearSelection();
        return;
      }
    }
    // Cross-layer: anchor drags span layers and handle edits touch one contour — both
    // commit by id across every layer in one undo step.
    if (drag && live) ctx.doc.replaceContoursEverywhere(live);
    drag = null;
    ctx.editor.setLiveContours(null);
    ctx.editor.setHover(null);
  },
};

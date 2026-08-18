import { useEffect, type RefObject } from "react";
import { useViewportStore } from "../../../state/viewportStore";
import { useDocumentStore } from "../../../state/documentStore";
import { useEditorStore } from "../../../state/editorStore";
import { screenToWorld } from "../../../engine/viewport/transform";
import { snapPoint } from "../../../engine/snapping/snap";
import { snapToGeometry, SNAP_RADIUS, NO_EXCLUDE } from "../../tools/snapGeometry";
import type { Glyph, Layer } from "../../../types/document";
import type { Vec2, Viewport } from "../../../types/viewport";
import { getTool } from "../../tools";
import { isEditable } from "../../../utils/dom";
import type { Modifiers, ToolPointerContext } from "../../tools/types";
import { resolvedLayers } from "../../layers/layerTree";

/**
 * The single bridge between raw DOM input and the active tool. It owns the
 * left-button-without-Space gesture; pan/zoom (Space-drag, middle-mouse, wheel)
 * stays with usePanZoom, and the two never fire together because this handler
 * bails on any non-primary button or while Space is held. Responsibilities:
 *   - convert pointer events to world units and apply grid snapping once, here,
 *     so tools receive ready-to-use points and never see screen space;
 *   - record the snapped press point (downWorld) for drag-based tools;
 *   - keep the shared cursor in the editor store fresh for the readout/overlay;
 *   - route the tool-delegated keys Esc/Enter to the active tool. Global keys
 *     (tool switch, Delete, clipboard, undo/redo, save) are owned by the command
 *     registry via `useCommandKeys` — the two listeners never share a key.
 *
 * All store reads use getState() inside handlers (never stale, no re-renders),
 * and the active tool is resolved per-event so switching tools is instant.
 */

function readModifiers(e: PointerEvent | MouseEvent): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey };
}

function activeGlyph(): Glyph | null {
  const d = useDocumentStore.getState();
  return d.activeGlyphId ? d.glyphs[d.activeGlyphId] ?? null : null;
}

function activeLayer(): Layer | null {
  const d = useDocumentStore.getState();
  const glyph = d.activeGlyphId ? d.glyphs[d.activeGlyphId] ?? null : null;
  if (!glyph || !d.activeLayerId) return null;
  // Resolved, so a layer inside a hidden or LOCKED GROUP refuses to start a gesture
  // even when its own flags are clear.
  return resolvedLayers(glyph).find((l) => l.id === d.activeLayerId) ?? null;
}

export function useToolController(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let downWorld: Vec2 | null = null;

    const points = (e: PointerEvent | MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const screen: Vec2 = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const vp = useViewportStore.getState();
      const viewport: Viewport = vp;
      const grid = vp.grid;
      const rawWorld = screenToWorld(screen, viewport);
      const gridWorld = grid.snap ? snapPoint(rawWorld, grid.size, true) : rawWorld;
      // Snap-to-point (when on): land new geometry / the cursor on a nearby anchor or
      // path of the visible layers; fall back to the grid/raw point otherwise. No
      // exclusion here — placing/ hovering wants to snap TO existing geometry.
      let world = gridWorld;
      if (vp.snapToGeometry) {
        const g = activeGlyph();
        const layers = (g ? resolvedLayers(g) : []).filter((l) => l.visible);
        const hit = snapToGeometry(layers, viewport, screen, SNAP_RADIUS, NO_EXCLUDE);
        world = hit ? hit.point : gridWorld;
      }
      // Pen handles snap on their own toggle, independent of node `snap`.
      const handleWorld = grid.snapHandles ? snapPoint(rawWorld, grid.size, true) : rawWorld;
      return { screen, viewport, rawWorld, world, handleWorld };
    };

    const buildCtx = (
      e: PointerEvent,
      down: boolean,
    ): ToolPointerContext => {
      const { screen, viewport, rawWorld, world, handleWorld } = points(e);
      return {
        world,
        rawWorld,
        handleWorld,
        screen,
        viewport,
        modifiers: readModifiers(e),
        isDown: down,
        downWorld,
        glyph: activeGlyph(),
        layer: activeLayer(),
        doc: useDocumentStore.getState(),
        editor: useEditorStore.getState(),
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      const editor = useEditorStore.getState();
      if (e.button !== 0 || editor.spaceDown) return; // pan owns these gestures
      if (editor.transforming) return; // the transform box owns the pointer

      const { world, rawWorld } = points(e);
      // Pick-only tools (select) don't show an ambient snap target while hovering/
      // clicking; they set one themselves while dragging a node. Placement tools snap.
      const hoverSnaps = getTool(editor.activeTool).snapsOnHover !== false;
      editor.setCursor({ raw: rawWorld, snapped: hoverSnaps ? world : null });

      // A locked or hidden active layer can't be drawn on; keep the cursor live
      // but don't begin a tool gesture (pan/zoom still work).
      const layer = activeLayer();
      if (!layer || layer.locked || !layer.visible) return;

      el.setPointerCapture(e.pointerId);
      isDown = true;
      downWorld = world;
      getTool(editor.activeTool).onPointerDown?.(buildCtx(e, true));
    };

    const onPointerMove = (e: PointerEvent) => {
      const editor = useEditorStore.getState();
      const { world, rawWorld } = points(e);
      // See onPointerDown: select suppresses the hover snap target; a node drag (in the
      // tool's own onPointerMove below) re-sets it to the landing point, so drag snaps.
      const hoverSnaps = getTool(editor.activeTool).snapsOnHover !== false;
      editor.setCursor({ raw: rawWorld, snapped: hoverSnaps ? world : null });
      if (editor.spaceDown) return; // mid-pan: cursor only, no tool dispatch
      getTool(editor.activeTool).onPointerMove?.(buildCtx(e, isDown));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || !isDown) return;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      const editor = useEditorStore.getState();
      getTool(editor.activeTool).onPointerUp?.(buildCtx(e, false));
      isDown = false;
      downWorld = null;
    };

    const onPointerLeave = () => {
      if (isDown) return; // capture keeps a drag alive past the edge
      const editor = useEditorStore.getState();
      editor.setCursor(null);
      editor.setHover(null);
    };

    // A browser-issued pointercancel (OS gesture, focus steal) ends an in-flight drag:
    // run the tool's own pointer-up cleanup (it clears its module-local drag state) and
    // reset, so no stuck preview / dangling gesture survives (usePanZoom does the same).
    const onPointerCancel = (e: PointerEvent) => {
      if (!isDown) return;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      getTool(useEditorStore.getState().activeTool).onPointerUp?.(buildCtx(e, false));
      isDown = false;
      downWorld = null;
    };

    // Only the tool-delegated keys live here; everything else is a command
    // (useCommandKeys). Esc/Enter route to the active tool (e.g. the pen finishing
    // an open path); Esc additionally clears the anchor selection.
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key !== "Escape" && e.key !== "Enter") return;

      const editor = useEditorStore.getState();
      getTool(editor.activeTool).onKeyDown?.(e, {
        modifiers: readModifiers(e as unknown as MouseEvent),
        glyph: activeGlyph(),
        layer: activeLayer(),
        doc: useDocumentStore.getState(),
        editor,
      });
      if (e.key === "Escape") editor.clearSelection();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}

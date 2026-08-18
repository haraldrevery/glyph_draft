import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Drag-and-drop reordering for the Layers panel rows.
 *
 * Pointer events, not HTML5 drag-and-drop — matching `usePanelDrag` / `TransformBox` /
 * `UnitReference`, the app's existing drag idiom. HTML5 DnD would bring drag images,
 * `dragover`-preventDefault quirks and inconsistent behaviour inside the Tauri webview
 * for no benefit here.
 *
 * The hook is deliberately DUMB: it only works out which row the pointer is over and
 * whether that means above / below / inside. Every rule about what a drop *means*
 * (adopting a parent, moving a group's whole run, refusing cycles, pruning empties)
 * lives in `documentStore.moveUnitTo`, so the interaction cannot drift from the model.
 *
 * A drag only starts after a few pixels of movement, so an ordinary click still selects
 * the row and double-click still renames.
 */

/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** Fraction of a group row's height, at each edge, that reorders instead of nesting. */
const EDGE_BAND = 0.28;

export type DropPosition = "above" | "below" | "inside";

export interface DropTarget {
  id: string;
  position: DropPosition;
}

interface RowMeta {
  id: string;
  isGroup: boolean;
}

export interface RowDrag {
  /** The row currently being dragged, or null. */
  draggingId: string | null;
  /** Where it would land if released now, or null. */
  drop: DropTarget | null;
  /** Spread on each row; `meta` identifies it. Carries the pointer handler plus the
   *  data attributes `resolveTarget` reads back out of the DOM during a drag. */
  rowProps: (meta: RowMeta) => Record<string, unknown>;
}

/** @param onDrop committed move — receives ids and a panel-relative position. */
export function useRowDrag(
  onDrop: (dragId: string, targetId: string, position: DropPosition) => void,
): RowDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  // Mutable so the pointer handlers never close over stale state.
  const live = useRef<{ id: string; startX: number; startY: number; armed: boolean } | null>(null);
  const dropRef = useRef<DropTarget | null>(null);

  const resolveTarget = (e: PointerEvent): DropTarget | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest<HTMLElement>("[data-row-id]");
    if (!row) return null;
    const id = row.dataset["rowId"];
    if (!id || id === live.current?.id) return null;

    const rect = row.getBoundingClientRect();
    const t = (e.clientY - rect.top) / Math.max(rect.height, 1);
    // A GROUP row nests when the pointer is in its middle band, and reorders at its
    // edges — the standard file-tree affordance. A layer row can only reorder.
    if (row.dataset["rowGroup"] === "true") {
      if (t > EDGE_BAND && t < 1 - EDGE_BAND) return { id, position: "inside" };
    }
    return { id, position: t < 0.5 ? "above" : "below" };
  };

  const rowProps = (meta: RowMeta) => ({
    "data-row-id": meta.id,
    ...(meta.isGroup ? { "data-row-group": "true" } : {}),
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return; // left button only; right-click opens the menu
      // Never start a drag from a control inside the row. The eye/lock/disclosure
      // buttons stop MOUSEdown to avoid selecting the row, which does not stop
      // pointerdown — so guard here instead of bolting stopPropagation onto each one.
      if ((e.target as HTMLElement | null)?.closest("button, input, select, textarea")) {
        return;
      }
      live.current = { id: meta.id, startX: e.clientX, startY: e.clientY, armed: false };

      const move = (ev: PointerEvent): void => {
        const st = live.current;
        if (!st) return;
        if (!st.armed) {
          const moved = Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY);
          if (moved < DRAG_THRESHOLD_PX) return; // still a click
          st.armed = true;
          setDraggingId(st.id);
        }
        const next = resolveTarget(ev);
        dropRef.current = next;
        setDrop(next);
      };

      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const st = live.current;
        const target = dropRef.current;
        live.current = null;
        dropRef.current = null;
        setDraggingId(null);
        setDrop(null);
        // A press that never armed is a plain click — the row's own handler took it.
        if (st?.armed && target) onDrop(st.id, target.id, target.position);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
  });

  return { draggingId, drop, rowProps };
}

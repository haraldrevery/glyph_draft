import { create } from "zustand";
import type { AnchorPoint, Contour, PointRef } from "../types/geometry";
import type { Vec2 } from "../types/viewport";

/**
 * Editor SESSION state — everything that describes what the user is doing right
 * now but is NOT part of the saved document: the active tool, the selection,
 * hover, the live cursor, and the in-progress geometry for drawing/dragging.
 *
 * This store is deliberately NOT wrapped in zundo. Selection changes, cursor
 * moves, and per-frame drag updates must never become undo steps. The flow is:
 * tools mutate this ephemeral state every frame for a live preview, then commit
 * the final result to the (undoable) document store once, on mouse-up.
 */
export type ToolId =
  | "select"
  | "lasso"
  | "pen"
  | "freepen"
  | "scissors"
  | "knife"
  | "eraser"
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "triangle";

/** Live cursor in world units. `snapped` is the active snap target the indicator
 *  draws, or `null` when nothing is snapping (e.g. the select tool while merely
 *  hovering — it only sets a snap target while dragging a node). */
export interface CursorState {
  raw: Vec2;
  snapped: Vec2 | null;
}

/** Pen session: the contour being appended to, and the not-yet-committed point. */
interface PenSession {
  contourId: string | null;
  pending: AnchorPoint | null;
}

interface EditorState {
  activeTool: ToolId;
  selection: PointRef[];
  hover: PointRef | null;
  cursor: CursorState | null;
  /** True while Space is held (hand-pan); shared with usePanZoom. */
  spaceDown: boolean;

  /** Live overrides for contours being node-dragged (rendered in place). */
  liveContours: Contour[] | null;
  /** Live preview for shape tools before the shape is committed. */
  draft: Contour | null;
  /** In-progress freeform lasso path (world units), or null. */
  lasso: Vec2[] | null;
  /** In-progress marquee (box-select) rectangle by two world-space corners, or null. */
  marquee: { a: Vec2; b: Vec2 } | null;
  /** True while the transform box (Ctrl+T) is shown over the current selection. */
  transforming: boolean;
  pen: PenSession;

  setTool: (tool: ToolId) => void;
  setCursor: (cursor: CursorState | null) => void;
  setSpaceDown: (down: boolean) => void;

  setSelection: (refs: PointRef[]) => void;
  toggleSelection: (ref: PointRef) => void;
  clearSelection: () => void;
  setHover: (ref: PointRef | null) => void;

  setLiveContours: (contours: Contour[] | null) => void;
  setDraft: (contour: Contour | null) => void;
  setLasso: (path: Vec2[] | null) => void;
  setMarquee: (rect: { a: Vec2; b: Vec2 } | null) => void;
  setTransforming: (on: boolean) => void;
  penStart: (contourId: string | null) => void;
  penSetPending: (point: AnchorPoint | null) => void;
  penEnd: () => void;

  /** Drop all transient state — used on tool switch and after undo/redo. */
  resetEphemeral: () => void;
}

export function sameRef(a: PointRef, b: PointRef): boolean {
  return (
    a.layerId === b.layerId &&
    a.contourId === b.contourId &&
    a.pointId === b.pointId
  );
}

const EMPTY_PEN: PenSession = { contourId: null, pending: null };

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTool: "select",
  selection: [],
  hover: null,
  cursor: null,
  spaceDown: false,
  liveContours: null,
  draft: null,
  lasso: null,
  marquee: null,
  transforming: false,
  pen: EMPTY_PEN,

  setTool: (activeTool) => {
    if (activeTool === get().activeTool) return;
    set({
      activeTool,
      // Switching tools abandons any in-progress gesture cleanly.
      selection: [],
      hover: null,
      liveContours: null,
      draft: null,
      lasso: null,
      marquee: null,
      transforming: false,
      pen: EMPTY_PEN,
    });
  },

  setCursor: (cursor) => set({ cursor }),
  setSpaceDown: (spaceDown) => set({ spaceDown }),

  setSelection: (selection) => set({ selection }),
  toggleSelection: (ref) => {
    const current = get().selection;
    const exists = current.some((r) => sameRef(r, ref));
    set({
      selection: exists
        ? current.filter((r) => !sameRef(r, ref))
        : [...current, ref],
    });
  },
  clearSelection: () => set({ selection: [] }),
  setHover: (hover) => set({ hover }),

  setLiveContours: (liveContours) => set({ liveContours }),
  setDraft: (draft) => set({ draft }),
  setLasso: (lasso) => set({ lasso }),
  setMarquee: (marquee) => set({ marquee }),
  setTransforming: (transforming) => set({ transforming }),
  penStart: (contourId) => set({ pen: { contourId, pending: null } }),
  penSetPending: (pending) => set({ pen: { ...get().pen, pending } }),
  penEnd: () => set({ pen: EMPTY_PEN }),

  resetEphemeral: () =>
    set({
      selection: [],
      hover: null,
      liveContours: null,
      draft: null,
      lasso: null,
      marquee: null,
      transforming: false,
      pen: EMPTY_PEN,
    }),
}));

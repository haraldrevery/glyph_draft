import { create } from "zustand";

/**
 * Floating-HUD panel layout — where the user has dragged the Stroke, Color and
 * Layers panels. Session-only and NOT undoable (like the camera): moving a panel
 * is a UI gesture, never part of the document history. A panel with no stored
 * position renders at its default CSS spot; once dragged it switches to a fixed
 * viewport position. Positions are in viewport (client) pixels; `w` pins the
 * width so a panel that leaves its flex container doesn't collapse.
 *
 * These are exactly the ids `usePanelDrag(id)` is called with. There is no "view"
 * panel — the old floating View/ControlPanel became the top-bar View menu
 * (`ViewMenu.tsx`), which is not draggable.
 */
export type PanelId = "stroke" | "layers" | "fill";

export interface PanelPos {
  x: number;
  y: number;
  w: number;
}

interface PanelState {
  positions: Partial<Record<PanelId, PanelPos>>;
  setPosition: (id: PanelId, pos: PanelPos) => void;
  resetPosition: (id: PanelId) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  positions: {},
  setPosition: (id, pos) =>
    set((s) => ({ positions: { ...s.positions, [id]: pos } })),
  resetPosition: (id) =>
    set((s) => {
      const next = { ...s.positions };
      delete next[id];
      return { positions: next };
    }),
}));

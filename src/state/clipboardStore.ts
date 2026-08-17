import { create } from "zustand";
import type { Contour } from "../types/geometry";

/**
 * The clipboard lives outside both the document (it is not exported state) and
 * the editor session reset (it must survive tool switches and undo). It holds
 * whole contours with their ABSOLUTE world coordinates, which is the entire
 * trick behind paste-in-place: because the metrics — em square, baseline — are
 * shared across glyphs, re-inserting a contour at the same coordinates lands it
 * in the same visual spot, even in a different glyph. Cloning to fresh ids
 * happens at paste time, so one copy can be pasted many times.
 */
interface ClipboardState {
  contours: Contour[];
  setContours: (contours: Contour[]) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  contours: [],
  setContours: (contours) => set({ contours }),
  clear: () => set({ contours: [] }),
}));

/** Whether there is anything to paste. */
export function useHasClipboard(): boolean {
  return useClipboardStore((s) => s.contours.length > 0);
}

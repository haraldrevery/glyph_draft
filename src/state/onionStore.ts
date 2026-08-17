import { create } from "zustand";

/**
 * Onion-skinning state — which other glyphs to ghost behind the active one,
 * and how faintly. This is a pure view concern: not part of the document and
 * not undoable, so it lives in its own small store (kept isolated per the
 * modularity pillar) rather than in the document history.
 *
 * `referenceIds` point at document glyphs; a deleted glyph simply stops
 * rendering (consumers filter against the live glyph set), so no cross-store
 * cleanup is required. Adding a reference auto-enables the overlay so the
 * effect of the toggle is immediately visible; removing one never disables it.
 */
interface OnionState {
  enabled: boolean;
  opacity: number; // 0..1, applied to the whole ghost layer
  referenceIds: string[];
  /** Ghost the TRUE rendered output (expanded strokes/booleans/baked layers, via
   *  glyphFillGroups) instead of the raw contour skeleton. Persisted preference. */
  renderSvg: boolean;

  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  setOpacity: (opacity: number) => void;
  setRenderSvg: (renderSvg: boolean) => void;
  toggleRenderSvg: () => void;
  toggleReference: (glyphId: string) => void;
  removeReference: (glyphId: string) => void;
}

export const useOnionStore = create<OnionState>((set) => ({
  enabled: false,
  opacity: 0.32,
  referenceIds: [],
  renderSvg: false,

  setEnabled: (enabled) => set({ enabled }),
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  setOpacity: (opacity) => set({ opacity }),
  setRenderSvg: (renderSvg) => set({ renderSvg }),
  toggleRenderSvg: () => set((s) => ({ renderSvg: !s.renderSvg })),

  toggleReference: (glyphId) =>
    set((s) => {
      const has = s.referenceIds.includes(glyphId);
      return {
        referenceIds: has
          ? s.referenceIds.filter((id) => id !== glyphId)
          : [...s.referenceIds, glyphId],
        // Turning a reference on reveals the overlay; turning one off leaves it.
        enabled: has ? s.enabled : true,
      };
    }),

  removeReference: (glyphId) =>
    set((s) => ({ referenceIds: s.referenceIds.filter((id) => id !== glyphId) })),
}));

/** Whether a given glyph is currently a ghost reference. */
export function useIsReference(glyphId: string): boolean {
  return useOnionStore((s) => s.referenceIds.includes(glyphId));
}

import { create } from "zustand";
import type { ColorPalette } from "../types/geometry";
import { createId } from "../utils/id";

/**
 * The user's saved colour palettes — named swatch sets for a consistent theme
 * across glyphs. UI state, not undoable and not part of the document, persisted via
 * the settings file (v5), exactly like the stroke presets (`strokePresetStore`) and
 * keybinding overrides. The fixed `PRESET_INKS` in the FillPanel are separate,
 * read-only built-ins shown above these; only these palettes are user-managed.
 */
interface ColorPaletteState {
  palettes: ColorPalette[];

  /** Create a palette, UPSERTING by name: if a palette with the same
   *  (case-insensitive, trimmed) label exists its colours are overwritten, else a
   *  new one is appended. Returns the affected palette's id. */
  upsertPalette: (label: string, colors: string[]) => string;
  updatePalette: (id: string, patch: Partial<Omit<ColorPalette, "id">>) => void;
  removePalette: (id: string) => void;
  /** Replace the whole list (used when loading persisted settings). */
  setAll: (palettes: ColorPalette[]) => void;
  resetAll: () => void;
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const useColorPaletteStore = create<ColorPaletteState>((set, get) => ({
  palettes: [],

  upsertPalette: (label, colors) => {
    const existing = get().palettes.find((p) => sameName(p.label, label));
    if (existing) {
      set((s) => ({
        palettes: s.palettes.map((p) =>
          p.id === existing.id ? { ...p, colors: [...colors] } : p,
        ),
      }));
      return existing.id;
    }
    const id = createId();
    set((s) => ({ palettes: [...s.palettes, { id, label: label.trim(), colors: [...colors] }] }));
    return id;
  },

  updatePalette: (id, patch) =>
    set((s) => ({
      palettes: s.palettes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removePalette: (id) =>
    set((s) => ({ palettes: s.palettes.filter((p) => p.id !== id) })),

  setAll: (palettes) => set({ palettes }),
  resetAll: () => set({ palettes: [] }),
}));

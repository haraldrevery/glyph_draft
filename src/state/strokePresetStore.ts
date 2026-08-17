import { create } from "zustand";
import type { StrokePreset, StrokeStyle } from "../types/geometry";
import { createId } from "../utils/id";

/**
 * The user's saved stroke presets ("brush library"). UI state — not undoable, not
 * part of the document — persisted via the settings file (v3), exactly like the
 * keybinding overrides. The built-in presets (`brushPresets.ts`) are separate,
 * read-only constants shown above this list; only these are user-managed.
 */
interface StrokePresetState {
  presets: StrokePreset[];

  /** Save from a live stroke style, UPSERTING by name: if a preset with the same
   *  (case-insensitive, trimmed) label exists its style is overwritten, else a new
   *  one is appended. Returns the affected preset's id. */
  upsertPreset: (label: string, style: StrokeStyle) => string;
  updatePreset: (id: string, patch: Partial<Omit<StrokePreset, "id">>) => void;
  removePreset: (id: string) => void;
  /** Replace the whole list (used when loading persisted settings). */
  setAll: (presets: StrokePreset[]) => void;
  resetAll: () => void;
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const useStrokePresetStore = create<StrokePresetState>((set, get) => ({
  presets: [],

  upsertPreset: (label, style) => {
    const existing = get().presets.find((p) => sameName(p.label, label));
    if (existing) {
      set((s) => ({
        presets: s.presets.map((p) =>
          p.id === existing.id ? { ...p, style: { ...style } } : p,
        ),
      }));
      return existing.id;
    }
    const id = createId();
    set((s) => ({ presets: [...s.presets, { id, label: label.trim(), style: { ...style } }] }));
    return id;
  },

  updatePreset: (id, patch) =>
    set((s) => ({
      presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removePreset: (id) =>
    set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

  setAll: (presets) => set({ presets }),
  resetAll: () => set({ presets: [] }),
}));

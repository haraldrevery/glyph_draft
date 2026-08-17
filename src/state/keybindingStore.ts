import { create } from "zustand";
import type { KeyChord } from "../commands/types";

/**
 * User keybinding OVERRIDES, keyed by command id. The registry resolves a
 * command's effective keys as `overrides[id] ?? defaultKeys`, so this is the only
 * place rebinds live — defaults stay in the command definitions. UI state (not
 * undoable, not part of the document); persisted via the settings file (v2).
 *
 * `capturing` is true while the keybinding editor is listening for a chord; the
 * global keyboard handler (`useCommandKeys`) stands down during that window so
 * the chord being assigned doesn't also fire the command.
 */
interface KeybindingState {
  overrides: Record<string, KeyChord[]>;
  capturing: boolean;

  setOverride: (id: string, chords: KeyChord[]) => void;
  clearOverride: (id: string) => void;
  setAll: (overrides: Record<string, KeyChord[]>) => void;
  resetAll: () => void;
  setCapturing: (capturing: boolean) => void;
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  overrides: {},
  capturing: false,

  setOverride: (id, chords) =>
    set((s) => ({ overrides: { ...s.overrides, [id]: chords } })),

  clearOverride: (id) =>
    set((s) => {
      if (!(id in s.overrides)) return s;
      const next = { ...s.overrides };
      delete next[id];
      return { overrides: next };
    }),

  setAll: (overrides) => set({ overrides }),
  resetAll: () => set({ overrides: {} }),
  setCapturing: (capturing) => set({ capturing }),
}));

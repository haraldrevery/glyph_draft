import { create } from "zustand";

/**
 * Recently-applied fill colours, for the StrokePanel "Fill" palette. A pure view
 * concern — not part of the document and not undoable — so it lives in its own
 * small store (like `onionStore`). Session-only: NOT persisted, so it needs no
 * settings migration (persisting in a future settings version is a clean additive
 * follow-up). Colours are stored lowercased `#rrggbb`, most-recent first, deduped,
 * and capped so the row stays compact.
 */
const MAX_RECENT = 8;

interface PaletteState {
  recentColors: string[];
  pushRecentColor: (hex: string) => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  recentColors: [],
  pushRecentColor: (hex) =>
    set((s) => {
      const c = hex.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(c)) return s; // ignore non-hex (e.g. "none")
      const next = [c, ...s.recentColors.filter((x) => x !== c)].slice(0, MAX_RECENT);
      return { recentColors: next };
    }),
}));

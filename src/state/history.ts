import { create } from "zustand";
import { useDocumentStore } from "./documentStore";
import type { Glyph } from "../types/document";

/**
 * PER-GLYPH undo/redo — replaces zundo's single global timeline. Ctrl+Z while
 * viewing a glyph only ever changes THAT glyph, so an undo can never silently revert
 * an edit on an off-screen glyph.
 *
 * How it stays correct + safe:
 * - Every EDIT is one `set({ glyphs: { ...s, [id]: next } })` of a single glyph (the
 *   store's granularity guarantee), so a transition that keeps the same glyph KEY SET
 *   is an edit → recorded on the changed glyph's stack. A transition that CHANGES the
 *   key set is structural (addGlyph/addGlyphs/deleteGlyph/loadGlyphs) → skipped, which
 *   is exactly "glyph create/delete are not undoable".
 * - The `applying` flag makes undo/redo's own `set` not re-record.
 * - History is session-only (never serialized) — same as the old zundo store.
 *
 * The exposed shape (`undo`/`redo`/`clear`/`pastStates`/`futureStates`) matches what
 * the call sites already used, so wiring it in is a mechanical re-point.
 */

const LIMIT = 200;

interface GlyphHistory {
  past: Glyph[];
  future: Glyph[];
}

const stacks = new Map<string, GlyphHistory>();
let applying = false; // true while undo/redo applies a change (so it isn't recorded)

function stackFor(id: string): GlyphHistory {
  let s = stacks.get(id);
  if (!s) {
    s = { past: [], future: [] };
    stacks.set(id, s);
  }
  return s;
}

/** Record per-glyph diffs, but ONLY when the glyph key set is unchanged (an edit).
 *  A changed key set = a structural op (add/delete/load) → no undo step. */
function record(prev: Record<string, Glyph>, next: Record<string, Glyph>): void {
  const nextKeys = Object.keys(next);
  if (nextKeys.length !== Object.keys(prev).length) return; // added/removed a glyph
  for (const k of nextKeys) if (!(k in prev)) return; // key set changed (swap)
  for (const k of nextKeys) {
    const before = prev[k]!;
    if (before !== next[k]) {
      const st = stackFor(k);
      st.past.push(before);
      if (st.past.length > LIMIT) st.past.shift();
      st.future.length = 0; // a fresh edit invalidates redo
    }
  }
}

interface HistoryState {
  /** The ACTIVE glyph's stacks (consumers read `.length`); refreshed reactively. */
  pastStates: Glyph[];
  futureStates: Glyph[];
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>(() => ({
  pastStates: [],
  futureStates: [],

  undo: () => {
    const doc = useDocumentStore.getState();
    const id = doc.activeGlyphId;
    const cur = id ? doc.glyphs[id] : undefined;
    const st = id ? stacks.get(id) : undefined;
    if (!id || !cur || !st || st.past.length === 0) return;
    st.future.push(cur);
    const prev = st.past.pop()!;
    applying = true;
    useDocumentStore.setState({ glyphs: { ...doc.glyphs, [id]: prev } });
    applying = false; // the subscribe ran synchronously above; refresh() fired there
  },

  redo: () => {
    const doc = useDocumentStore.getState();
    const id = doc.activeGlyphId;
    const cur = id ? doc.glyphs[id] : undefined;
    const st = id ? stacks.get(id) : undefined;
    if (!id || !cur || !st || st.future.length === 0) return;
    st.past.push(cur);
    const next = st.future.pop()!;
    applying = true;
    useDocumentStore.setState({ glyphs: { ...doc.glyphs, [id]: next } });
    applying = false;
  },

  clear: () => {
    stacks.clear();
    refresh();
  },
}));

/** Mirror the active glyph's stacks into the store so `pastStates`/`futureStates`
 *  (hence canUndo/canRedo) are per-active-glyph and reactive on glyph switch. */
function refresh(): void {
  const { activeGlyphId } = useDocumentStore.getState();
  const st = activeGlyphId ? stacks.get(activeGlyphId) : undefined;
  useHistoryStore.setState({
    pastStates: st ? st.past : [],
    futureStates: st ? st.future : [],
  });
}

// Record edits + keep the active-glyph view fresh. One subscription; `prev` comes from
// zustand so no manual previous-state tracking is needed.
useDocumentStore.subscribe((s, prev) => {
  if (s.glyphs !== prev.glyphs) {
    if (!applying) record(prev.glyphs, s.glyphs);
    // Drop the history of any glyph that no longer exists (deleted) so its stacks don't
    // linger for the session. Deletion is permanent (structural ⇒ not undoable), so this
    // can never discard a reachable redo.
    for (const id of Object.keys(prev.glyphs)) if (!(id in s.glyphs)) stacks.delete(id);
  }
  if (s.glyphs !== prev.glyphs || s.activeGlyphId !== prev.activeGlyphId) refresh();
});
refresh(); // seed the initial (empty) view

/** Reactive undo/redo state for the UI (kept for API parity; canUndo/canRedo are
 *  per active glyph). */
export function useHistory() {
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const clear = useHistoryStore((s) => s.clear);
  const canUndo = useHistoryStore((s) => s.pastStates.length > 0);
  const canRedo = useHistoryStore((s) => s.futureStates.length > 0);
  return { undo, redo, clear, canUndo, canRedo };
}

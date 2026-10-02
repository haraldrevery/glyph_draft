import { create } from "zustand";

/**
 * One-line messages about FILE operations (import / export / restore) shown in the
 * header. Deliberately separate from the save-status store: a bad project file or an
 * unreadable SVG used to surface as "Save failed: …", which reads as if saving broke.
 * Session-only, not undoable. A newer notice replaces the current one.
 */
export interface Notice {
  id: number;
  message: string;
  kind: "error" | "info";
}

interface NoticeState {
  notice: Notice | null;
  dismiss: () => void;
}

let nextId = 1;

export const useNoticeStore = create<NoticeState>((set) => ({
  notice: null,
  dismiss: () => set({ notice: null }),
}));

/** Show a notice in the header (an error stays until dismissed; info clears itself). */
export function notify(message: string, kind: Notice["kind"] = "error"): void {
  const id = nextId++;
  useNoticeStore.setState({ notice: { id, message, kind } });
  if (kind === "info") {
    setTimeout(() => {
      if (useNoticeStore.getState().notice?.id === id) useNoticeStore.setState({ notice: null });
    }, 6000);
  }
}

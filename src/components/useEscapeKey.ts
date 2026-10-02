import { useEffect } from "react";

/**
 * Run `onEscape` when Esc is pressed while `active` — the modal-close convention. It
 * listens in the CAPTURE phase and stops propagation, so the key doesn't also reach the
 * canvas behind the dialog (where Esc finishes a pen path / leaves the transform box).
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onEscape();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, onEscape]);
}

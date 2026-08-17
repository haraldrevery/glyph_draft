import { useEffect } from "react";
import { matchKey } from "./registry";
import { isEditable } from "../utils/dom";
import { useKeybindingStore } from "../state/keybindingStore";

/**
 * The single global keyboard entry point. Resolves each keydown to a Command via
 * the registry and runs it — unless a text field is focused, or the command is
 * disabled. Tool-delegated keys (Esc/Enter) deliberately stay with the canvas
 * tool controller, so the two listeners never own the same key.
 *
 * A recognized chord always preventDefault()s (even when the command is
 * disabled) to preserve the prior behavior of swallowing the editor's shortcuts
 * from the browser.
 */
export function useCommandKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      // While the keybinding editor is capturing a chord, stand down so the chord
      // being assigned doesn't also fire its (old) command.
      if (useKeybindingStore.getState().capturing) return;
      const cmd = matchKey(e);
      if (!cmd) return;
      e.preventDefault();
      if (cmd.isEnabled && !cmd.isEnabled()) return;
      cmd.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

import { useMemo } from "react";
import * as clipboard from "./clipboardActions";

/**
 * React entry point for the clipboard. The actual logic lives in
 * `clipboardActions.ts` (React-free) so the command registry and context menus
 * can share it; this hook just exposes the stable functions to components.
 */
export function useClipboard() {
  return useMemo(
    () => ({
      copy: clipboard.copy,
      cut: clipboard.cut,
      paste: clipboard.paste,
      selectAll: clipboard.selectAll,
    }),
    [],
  );
}

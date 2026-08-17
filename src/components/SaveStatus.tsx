import { useSaveStatus } from "../state/persistence";

/**
 * Header indicator for autosave/explicit-save state. Reads the save-status store
 * (driven by persistence.ts) and shows a quiet "Saved · hh:mm" / "Saving…" /
 * "Save failed" line — enough feedback that work is safe without adding chrome.
 */
export function SaveStatus() {
  const { state, savedAt, error } = useSaveStatus();

  const label =
    state === "saving"
      ? "Saving…"
      : state === "error"
        ? `Save failed${error ? `: ${error}` : ""}`
        : state === "saved" && savedAt
          ? `Saved · ${formatTime(savedAt)}`
          : "";

  if (!label) return null;

  return (
    <span
      className={`save-status${state === "error" ? " save-status-err" : ""}`}
      role="status"
      aria-live="polite"
    >
      {label}
    </span>
  );
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Runtime environment detection. We check for Tauri's injected globals rather
 * than importing any @tauri-apps package here, so this module is safe to load
 * in a plain browser and adds nothing to the web bundle.
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

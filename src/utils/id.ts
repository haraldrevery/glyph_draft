/**
 * Tiny id factory for model objects (glyphs, layers, contours, anchor points).
 *
 * Ids only need to be unique within a document and stable for the lifetime of
 * an object; they are never shown to the user and never parsed. We prefer
 * crypto.randomUUID when present (browser + Tauri webview both have it) and fall
 * back to a counter+random string so the module is safe in any environment.
 */
let counter = 0;

export function createId(prefix = "id"): string {
  const c = (counter = (counter + 1) % Number.MAX_SAFE_INTEGER);
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${c.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

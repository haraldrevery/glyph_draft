/**
 * Naming for the web export archive (the single .zip a browser tab gets instead of a
 * folder). Pure and DOM-free so it is unit-tested like the rest of the engine.
 *
 * Desktop does not use this: TauriExportService writes into a folder the user picks in
 * a native dialog, so the archive name is meaningless there.
 */

/** Characters that would break a zip entry or a saved file: ASCII control codes plus
 *  the set Windows forbids in a filename. Path separators are handled separately. */
const ILLEGAL = /[\u0000-\u001f<>:"|?*]/g;

/** The auto name when the user hasn't typed one: `glyphs.svg.zip`, plus any
 *  style/silhouette tag (e.g. `glyphs-bold-silhouette.svg.zip`). */
export function defaultArchiveName(tag = ""): string {
  return `glyphs${tag ? `-${tag}` : ""}.svg.zip`;
}

/**
 * Resolve the archive filename from the user's input, falling back to the auto name.
 *
 * Blank (or whitespace-only) input keeps today's behaviour exactly, so an existing user
 * who ignores the field sees no change. A typed name is sanitised rather than rejected:
 * path separators would either escape the download folder or silently break the zip
 * entry, and a leading dot would produce a hidden file.
 */
export function resolveArchiveName(input: string, tag = ""): string {
  // Take the last path segment. Pasting a full path ("~/fonts/myfont.zip") is far more
  // likely than deliberately typing a separator, and basename gives the obviously-right
  // answer there; replacing separators with dashes would yield "-home-me-fonts-myfont".
  // It also makes traversal impossible rather than merely defanged.
  const base = input.split(/[/\\]/).pop() ?? "";
  const safe = base
    .replace(ILLEGAL, "")
    .replace(/^\.+/, "") // no hidden/relative names
    .trim();
  if (!safe) return defaultArchiveName(tag);
  return /\.zip$/i.test(safe) ? safe : `${safe}.zip`;
}

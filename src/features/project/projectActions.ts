import type { Glyph } from "../../types/document";
import { useDocumentStore } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import { useHistoryStore } from "../../state/history";
import { saveNow, useSaveStatus } from "../../state/persistence";
import { createStorage } from "../../storage/createStorage";
import { serializeProject, migrate, PREIMPORT_KEY } from "../../storage/projectFile";
import { createProjectIO } from "./ProjectIOService";

/**
 * Portable project export/import — the React-free glue between the document store
 * and the platform `ProjectIOService`. The file is the same versioned envelope
 * autosave writes (`serializeProject`), so import reuses `migrate()` (corruption-
 * safe, never throws) and `loadGlyphs` + `temporal.clear()` (a load is not an undo
 * step — Invariant 7). The pure core (`serializeCurrentProject` /
 * `applyImportedProject`) is unit-tested; the I/O seam only supplies/consumes the
 * JSON string.
 */

const DEFAULT_NAME = "project.glphdrft";

/** The current document as a portable `.glphdrft` JSON string. */
export function serializeCurrentProject(): string {
  return JSON.stringify(serializeProject(useDocumentStore.getState().glyphs));
}

/** Parse + migrate a project string WITHOUT touching the document. */
export function parseProject(
  json: string,
): { ok: true; glyphs: Record<string, Glyph> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not a valid project file (could not be read)." };
  }
  const glyphs = migrate(parsed);
  if (!glyphs) return { ok: false, error: "Not a valid Glyph Draft project." };
  return { ok: true, glyphs };
}

/** Load glyphs as the new workspace: history cleared (the import is the baseline, not
 *  an undo step), editor gestures/selection dropped (they point into the old
 *  document), and the result persisted. */
function loadAsWorkspace(glyphs: Record<string, Glyph>): void {
  useDocumentStore.getState().loadGlyphs(glyphs);
  useHistoryStore.getState().clear();
  useEditorStore.getState().resetEphemeral();
  void saveNow();
}

/**
 * Replace the workspace with an imported project string, immediately. On failure
 * the document is left untouched and an error is returned. The UI goes through
 * `pickProject` + `replaceWorkspace` instead (confirmation + pre-import snapshot);
 * this synchronous form is the tested core.
 */
export function applyImportedProject(json: string): { ok: boolean; error?: string } {
  const parsed = parseProject(json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  loadAsWorkspace(parsed.glyphs);
  return { ok: true };
}

/**
 * Replace the workspace with already-validated glyphs, after snapshotting the
 * current one under PREIMPORT_KEY. The autosave rotation would otherwise push the old
 * workspace out of both slots within one more save, making an import irreversible.
 * The snapshot is best-effort: the user has already confirmed the replacement.
 */
export async function replaceWorkspace(glyphs: Record<string, Glyph>): Promise<void> {
  try {
    const storage = await createStorage();
    await storage.setItem(PREIMPORT_KEY, serializeProject(useDocumentStore.getState().glyphs));
  } catch {
    /* best-effort */
  }
  loadAsWorkspace(glyphs);
}

/** File → Export project… — serialize and hand off to the platform writer. */
export async function exportProject(): Promise<void> {
  const io = await createProjectIO();
  try {
    await io.exportProject(serializeCurrentProject(), DEFAULT_NAME);
  } catch (err) {
    useSaveStatus.setState({
      state: "error",
      error: err instanceof Error ? err.message : "Export failed",
    });
  }
}

/** A picked + validated project waiting for the user to confirm the replacement. */
export interface PendingImport {
  glyphs: Record<string, Glyph>;
  glyphCount: number;
}

/**
 * File → Import project… step 1: pick a file and validate it. Returns the pending
 * import for the caller to CONFIRM (then `replaceWorkspace`), or null when cancelled
 * or invalid (the error is shown in the header). Never touches the document.
 * Confirmation comes AFTER the pick, so the web file picker still opens inside the
 * menu click's user gesture.
 */
export async function pickProject(): Promise<PendingImport | null> {
  const io = await createProjectIO();
  let result;
  try {
    result = await io.importProject();
  } catch (err) {
    useSaveStatus.setState({
      state: "error",
      error: err instanceof Error ? err.message : "Import failed",
    });
    return null;
  }
  if (result.cancelled || result.json == null) return null;

  const parsed = parseProject(result.json);
  if (!parsed.ok) {
    useSaveStatus.setState({ state: "error", error: parsed.error });
    return null;
  }
  return { glyphs: parsed.glyphs, glyphCount: Object.keys(parsed.glyphs).length };
}

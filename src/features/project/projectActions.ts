import { useDocumentStore } from "../../state/documentStore";
import { useHistoryStore } from "../../state/history";
import { saveNow, useSaveStatus } from "../../state/persistence";
import { serializeProject, migrate } from "../../storage/projectFile";
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

/**
 * Replace the workspace with an imported project string. Parses + migrates; on
 * success loads it, clears history (so the import is the new baseline, not an undo
 * step), and persists it as the workspace. On any failure the document is left
 * untouched and an error is returned.
 */
export function applyImportedProject(json: string): { ok: boolean; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not a valid project file (could not be read)." };
  }
  const glyphs = migrate(parsed);
  if (!glyphs) return { ok: false, error: "Not a valid Glyph Draft project." };

  const store = useDocumentStore.getState();
  store.loadGlyphs(glyphs);
  useHistoryStore.getState().clear();
  void saveNow(); // persist the imported document as the current workspace
  return { ok: true };
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

/** File → Import project… — pick a file, then replace the workspace with it. */
export async function importProject(): Promise<void> {
  const io = await createProjectIO();
  let result;
  try {
    result = await io.importProject();
  } catch (err) {
    useSaveStatus.setState({
      state: "error",
      error: err instanceof Error ? err.message : "Import failed",
    });
    return;
  }
  if (result.cancelled || result.json == null) return;

  const applied = applyImportedProject(result.json);
  if (!applied.ok) {
    useSaveStatus.setState({ state: "error", error: applied.error ?? "Import failed" });
  }
}

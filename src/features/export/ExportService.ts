import { isTauri } from "../../storage/platform";
import { WebExportService } from "./WebExportService";

/**
 * Bulk SVG export, as a platform seam separate from the StorageService KV store
 * (CLAUDE.md §6: file export is filesystem-shaped, not a key/value operation).
 * Feature code talks only to this interface; the platform-specific writer is
 * resolved by createExportService().
 *
 * The web writer (zip download) is the common case and is imported statically;
 * the Tauri writer is pulled in via dynamic import() — mirroring createStorage —
 * so the web bundle never references @tauri-apps.
 */

export interface ExportFile {
  /** Target filename, e.g. "u_0041.svg". */
  name: string;
  content: string;
}

export interface ExportResult {
  /** Files actually written/zipped (0 when the user cancelled). */
  count: number;
  /** True when the user dismissed the destination picker (desktop only). */
  cancelled: boolean;
  /** Human-friendly destination: a folder path (desktop) or zip name (web). */
  destination?: string;
}

export interface ExportService {
  exportGlyphs(
    files: ExportFile[],
    options?: { archiveName?: string },
  ): Promise<ExportResult>;
  /** Export a single glyph as one `.svg` — a direct download (web) or a
   *  save-file dialog (desktop), not a zip/folder. */
  exportSingle(file: ExportFile): Promise<ExportResult>;
}

export async function createExportService(): Promise<ExportService> {
  if (isTauri()) {
    const { TauriExportService } = await import("./TauriExportService");
    return new TauriExportService();
  }
  return new WebExportService();
}

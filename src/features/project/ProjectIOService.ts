import { isTauri } from "../../storage/platform";
import { WebProjectIO } from "./WebProjectIO";

/**
 * Portable PROJECT file I/O — reading/writing the whole document as one
 * `.glphdrft` JSON file, so a project can move between machines (web ⇄ desktop).
 *
 * A platform seam separate from both the StorageService KV store (that is the
 * auto-persisted workspace) and the SVG ExportService (that emits per-glyph SVGs):
 * this one reads/writes a single project file. Mirrors `createExportService` — the
 * web writer (Blob download / file input) is the common case and is imported
 * statically; the Tauri writer is pulled in via dynamic import() so the web bundle
 * never references @tauri-apps (CLAUDE.md §6).
 */

export interface ProjectExportResult {
  cancelled: boolean;
  /** Human-friendly destination: a file path (desktop) or file name (web). */
  destination?: string;
}

export interface ProjectImportResult {
  /** True when the user dismissed the file picker. */
  cancelled: boolean;
  /** The file's text content, or null when cancelled. */
  json: string | null;
}

export interface ProjectIOService {
  exportProject(json: string, suggestedName: string): Promise<ProjectExportResult>;
  importProject(): Promise<ProjectImportResult>;
}

export async function createProjectIO(): Promise<ProjectIOService> {
  if (isTauri()) {
    const { TauriProjectIO } = await import("./TauriProjectIO");
    return new TauriProjectIO();
  }
  return new WebProjectIO();
}

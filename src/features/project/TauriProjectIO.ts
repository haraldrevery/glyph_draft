import type {
  ProjectExportResult,
  ProjectImportResult,
  ProjectIOService,
} from "./ProjectIOService";

/**
 * Desktop project I/O: a native save/open dialog plus a filesystem read/write. The
 * @tauri-apps plugins are imported LAZILY and only from here (createProjectIO()
 * instantiates this only when isTauri()), so they land in an async chunk the web
 * build never requests — same discipline as TauriExportService / TauriStorage.
 */
// `glyphforge` kept so projects saved under the old name still appear in the open dialog.
const FILTERS = [{ name: "Glyph Draft project", extensions: ["glphdrft", "glyphforge"] }];

export class TauriProjectIO implements ProjectIOService {
  async exportProject(json: string, suggestedName: string): Promise<ProjectExportResult> {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const path = await dialog.save({
      defaultPath: suggestedName,
      filters: FILTERS,
      title: "Export project",
    });
    if (typeof path !== "string") return { cancelled: true };

    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeTextFile(path, json);
    return { cancelled: false, destination: path };
  }

  async importProject(): Promise<ProjectImportResult> {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const path = await dialog.open({
      multiple: false,
      directory: false,
      filters: FILTERS,
      title: "Import project",
    });
    if (typeof path !== "string") return { cancelled: true, json: null };

    const fs = await import("@tauri-apps/plugin-fs");
    const json = await fs.readTextFile(path);
    return { cancelled: false, json };
  }
}

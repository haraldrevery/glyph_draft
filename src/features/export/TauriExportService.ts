import type { ExportFile, ExportResult, ExportService } from "./ExportService";

/**
 * Desktop export: ask the user for a destination folder, then write each glyph
 * SVG straight into it. The @tauri-apps plugins are imported LAZILY (dynamic
 * import) and only ever from here, which createExportService() instantiates
 * exclusively when isTauri() is true — so they land in their own async chunk the
 * web build never requests (same discipline as TauriStorage).
 *
 * The destination is an absolute path returned by the folder picker, so
 * writeTextFile is called with the absolute path and no baseDir. (The desktop
 * build's Tauri capabilities must permit fs write + the dialog plugin.)
 */
export class TauriExportService implements ExportService {
  async exportGlyphs(files: ExportFile[]): Promise<ExportResult> {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const dir = await dialog.open({
      directory: true,
      multiple: false,
      title: "Choose a folder to export glyph SVGs into",
    });
    if (typeof dir !== "string") return { count: 0, cancelled: true };

    const fs = await import("@tauri-apps/plugin-fs");
    for (const f of files) {
      await fs.writeTextFile(`${dir}/${f.name}`, f.content);
    }

    return { count: files.length, cancelled: false, destination: dir };
  }

  async exportSingle(file: ExportFile): Promise<ExportResult> {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const path = await dialog.save({
      defaultPath: file.name,
      filters: [{ name: "SVG", extensions: ["svg"] }],
      title: "Export glyph as SVG",
    });
    if (typeof path !== "string") return { count: 0, cancelled: true };

    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeTextFile(path, file.content);
    return { count: 1, cancelled: false, destination: path };
  }
}

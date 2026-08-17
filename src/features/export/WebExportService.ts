import { zipSync, strToU8 } from "fflate";
import type { ExportFile, ExportResult, ExportService } from "./ExportService";

/**
 * Web export: bundle every glyph SVG into a single .zip and hand it to the
 * browser as a download. There is no filesystem in a plain browser tab, so a zip
 * is the standard "give me all my files at once" affordance (Phase 6 fallback).
 */
export class WebExportService implements ExportService {
  async exportGlyphs(
    files: ExportFile[],
    options?: { archiveName?: string },
  ): Promise<ExportResult> {
    const archiveName = options?.archiveName ?? "glyphs.zip";
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.name] = strToU8(f.content);

    const zipped = zipSync(entries, { level: 6 });
    triggerDownload(zipped, archiveName, "application/zip");

    return { count: files.length, cancelled: false, destination: archiveName };
  }

  async exportSingle(file: ExportFile): Promise<ExportResult> {
    // One glyph → the raw SVG directly (no zip-of-one).
    triggerDownload(strToU8(file.content), file.name, "image/svg+xml");
    return { count: 1, cancelled: false, destination: file.name };
  }
}

/** Save bytes as a browser download via a transient object URL. */
function triggerDownload(bytes: Uint8Array, fileName: string, mime: string): void {
  // fflate types its output as Uint8Array<ArrayBufferLike>; the DOM BlobPart
  // generic wants ArrayBuffer specifically, so narrow it here.
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

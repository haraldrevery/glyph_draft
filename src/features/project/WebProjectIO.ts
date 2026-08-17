import type {
  ProjectExportResult,
  ProjectImportResult,
  ProjectIOService,
} from "./ProjectIOService";

/**
 * Web project I/O: there is no filesystem in a plain browser tab, so export hands
 * the project JSON to the browser as a download, and import opens a transient file
 * picker. The picker `<input>` is created and clicked SYNCHRONOUSLY inside the
 * caller's click handler so the user-gesture that lets `.click()` open the dialog
 * isn't lost.
 */
export class WebProjectIO implements ProjectIOService {
  async exportProject(json: string, suggestedName: string): Promise<ProjectExportResult> {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { cancelled: false, destination: suggestedName };
  }

  importProject(): Promise<ProjectImportResult> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      // `.glyphforge` kept so projects exported under the old name still open.
      input.accept = ".glphdrft,.glyphforge,application/json,.json";
      // Settle exactly once: `change` fires when a file is chosen; `cancel` (where
      // supported) when the picker is dismissed. A focus-based fallback covers the
      // browsers without `cancel`.
      let settled = false;
      let chosen = false; // a file was picked → never let the focus-fallback cancel it
      const onFocus = () => {
        // Focus returned to the window ⇒ the picker closed. Give `change` a moment to
        // win; if no file was chosen it was a cancel. `chosen` guards a slow file read.
        window.setTimeout(() => {
          if (!chosen) done({ cancelled: true, json: null });
        }, 500);
      };
      const done = (result: ProjectImportResult) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("focus", onFocus);
        input.remove();
        resolve(result);
      };
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return done({ cancelled: true, json: null });
        chosen = true;
        file.text().then(
          (json) => done({ cancelled: false, json }),
          () => done({ cancelled: false, json: null }), // read error → no content
        );
      });
      input.addEventListener("cancel", () => done({ cancelled: true, json: null }));
      window.addEventListener("focus", onFocus);
      document.body.appendChild(input);
      input.click();
    });
  }
}

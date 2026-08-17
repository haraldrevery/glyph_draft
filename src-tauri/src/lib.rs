//! Glyph Draft desktop shell.
//!
//! Registers the official plugins the web side talks to:
//!  - **fs**: the `TauriStorage` KV adapter (one JSON file per key under app data)
//!    AND the project / SVG file read+write (`TauriProjectIO` / `TauriExportService`).
//!  - **dialog**: the native open/save pickers those services use to choose files.
//! Access scoping (and the `dialog:` / `fs:` permissions) live in
//! `capabilities/default.json`.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Glyph Draft");
}

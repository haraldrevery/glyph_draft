import { useEffect, useState } from "react";
import { useViewportStore } from "./state/viewportStore";
import { initPersistence, saveNow } from "./state/persistence";
import { exportProject, importProject } from "./features/project/projectActions";
import { initSettings } from "./state/settings";
import { useCommandKeys } from "./commands";
import { SaveStatus } from "./components/SaveStatus";
import { GlyphSidebar } from "./features/glyphs/GlyphSidebar";
import { CanvasViewport } from "./features/canvas";
import { ExportModal } from "./features/export/ExportModal";
import { KeybindingsModal } from "./features/settings/KeybindingsModal";
import { MenuBar, Menu, MenuItem, SubMenu } from "./components/menu";
import { Toggle } from "./components/controls/Toggle";
import type { Theme } from "./types/viewport";
import { ViewMenu } from "./features/canvas/ViewMenu";
import { TextPreviewModal } from "./features/preview/TextPreviewModal";
import { InfoModal, type InfoSection } from "./features/info/InfoModal";
import { GLYPH_SETS } from "./features/glyphs/glyphSets";
import { useDocumentStore } from "./state/documentStore";
import { useEditorStore } from "./state/editorStore";
import { importSvg } from "./features/import/svgImport";

/**
 * Application shell. Holds the app-level effects and otherwise delegates the
 * whole surface to CanvasViewport:
 *   1. mirror the theme onto <html data-theme> so the CSS variable sets switch;
 *   2. initialise persistence once at startup — restore the saved project (if
 *      any) and begin autosaving (LocalForage on web, Tauri FS on desktop);
 *   3. install the global command keyboard handler (`useCommandKeys`) — Undo/Redo,
 *      clipboard, select-all, save, and tool switching are all resolved through
 *      the command registry. Tool-delegated keys (Esc/Enter) and Delete routing
 *      stay with the canvas tool controller / registry respectively.
 */

/** Each theme's default `--accent` (mirrors theme.css), shown in the colour picker
 *  when there is no user override. */
const THEME_ACCENT_DEFAULT: Record<Theme, string> = {
  dark: "#ec9a52",
  light: "#cf7c2c",
  paper: "#c2702a",
};

export default function App() {
  const theme = useViewportStore((s) => s.theme);
  const setTheme = useViewportStore((s) => s.setTheme);
  const accentColor = useViewportStore((s) => s.accentColor);
  const setAccentColor = useViewportStore((s) => s.setAccentColor);
  const snapHandles = useViewportStore((s) => s.grid.snapHandles);
  const toggleHandleSnap = useViewportStore((s) => s.toggleHandleSnap);
  const deleteSplits = useViewportStore((s) => s.deleteSplits);
  const toggleDeleteSplits = useViewportStore((s) => s.toggleDeleteSplits);
  const mergeEndpoints = useViewportStore((s) => s.mergeEndpoints);
  const toggleMergeEndpoints = useViewportStore((s) => s.toggleMergeEndpoints);
  const mergeHalftones = useViewportStore((s) => s.mergeHalftones);
  const toggleMergeHalftones = useViewportStore((s) => s.toggleMergeHalftones);
  const alignMode = useViewportStore((s) => s.alignMode);
  const setAlignMode = useViewportStore((s) => s.setAlignMode);
  const [exportOpen, setExportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [infoSection, setInfoSection] = useState<InfoSection | null>(null);

  useCommandKeys();

  // Import an SVG file onto a new (baked) layer of the active glyph. The hidden
  // input is created + clicked synchronously so the user-gesture survives.
  const handleImportSvg = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      void file.text().then((text) => {
        const contours = importSvg(text);
        if (contours.length === 0) return; // nothing importable
        useDocumentStore.getState().addImportedLayer(contours, `Imported · ${file.name.replace(/\.svg$/i, "")}`);
        useEditorStore.getState().resetEphemeral();
      });
    });
    document.body.appendChild(input);
    input.click();
  };

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // Override the theme's --accent when the user picked one; --accent-strong/-soft
    // derive from it in theme.css, so they follow. null = use the theme default.
    if (accentColor) root.style.setProperty("--accent", accentColor);
    else root.style.removeProperty("--accent");
  }, [theme, accentColor]);

  useEffect(() => {
    void initPersistence();
    void initSettings();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <MenuBar aria-label="Main menu">
          <Menu label="File">
            <MenuItem label="Save" onSelect={() => void saveNow()} />
            <MenuItem label="Export…" onSelect={() => setExportOpen(true)} />
            <MenuItem label="Export project…" onSelect={() => void exportProject()} />
            <MenuItem label="Import project…" onSelect={() => void importProject()} />
            <MenuItem label="Import SVG…" onSelect={handleImportSvg} />
          </Menu>
          <Menu label="View">
            <ViewMenu />
            <MenuItem label="Text preview…" onSelect={() => setPreviewOpen(true)} />
          </Menu>
          <Menu label="Glyphs">
            {GLYPH_SETS.map((set) => (
              <MenuItem
                key={set.id}
                label={set.label}
                onSelect={() => useDocumentStore.getState().addGlyphs(set.codepoints)}
              />
            ))}
          </Menu>
          <Menu label="Settings">
            <SubMenu label="Theme">
              <MenuItem label="Dark" checked={theme === "dark"} onSelect={() => setTheme("dark")} />
              <MenuItem label="Light" checked={theme === "light"} onSelect={() => setTheme("light")} />
              <MenuItem label="Paper" checked={theme === "paper"} onSelect={() => setTheme("paper")} />
            </SubMenu>
            <div className="menu-accent">
              <label htmlFor="accent-color">Accent colour</label>
              <input
                id="accent-color"
                type="color"
                value={accentColor ?? THEME_ACCENT_DEFAULT[theme]}
                onChange={(e) => setAccentColor(e.target.value)}
              />
              {accentColor && (
                <button type="button" className="btn-mini" onClick={() => setAccentColor(null)}>
                  Reset
                </button>
              )}
            </div>
            <Toggle
              label="Path point handle grid lock"
              checked={snapHandles}
              onChange={toggleHandleSnap}
            />
            <Toggle
              label="Delete node splits path"
              checked={deleteSplits}
              onChange={toggleDeleteSplits}
            />
            <Toggle
              label="Merge endpoints on drag"
              checked={mergeEndpoints}
              onChange={toggleMergeEndpoints}
            />
            <Toggle
              label="Merge halftone strokes per layer"
              checked={mergeHalftones}
              onChange={toggleMergeHalftones}
            />
            <Toggle
              label="Align by outline (vs nodes)"
              checked={alignMode === "outline"}
              onChange={(on) => setAlignMode(on ? "outline" : "nodes")}
            />
            <MenuItem label="Keyboard shortcuts…" onSelect={() => setKeysOpen(true)} />
          </Menu>
          <Menu label="Information">
            <MenuItem label="About" onSelect={() => setInfoSection("about")} />
            <MenuItem label="Licence" onSelect={() => setInfoSection("licence")} />
            <MenuItem label="Legal" onSelect={() => setInfoSection("legal")} />
            <MenuItem label="User guide" onSelect={() => setInfoSection("userGuide")} />
          </Menu>
        </MenuBar>
        <SaveStatus />
      </header>
      <main className="app-main">
        <GlyphSidebar />
        <CanvasViewport />
      </main>
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <KeybindingsModal open={keysOpen} onClose={() => setKeysOpen(false)} />
      <TextPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} />
      <InfoModal
        open={infoSection !== null}
        section={infoSection ?? "about"}
        onClose={() => setInfoSection(null)}
      />
    </div>
  );
}

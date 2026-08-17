# Glyph Draft

A web-based and Tauri-wrapped SVG editor focused entirely on **drawing font
glyphs**. One glyph is one document is one SVG, exported as `u_xxxx.svg` for
import into FontForge. It is a glyph *drawing* tool, not a font editor —
kerning, OTF compilation, and metrics editing are left to FontForge.

## Shipped phases

- **Phases 1–4:** pan/zoom canvas, em-square + adjustable grid with snap-to-grid, theme/state/storage foundations; pen tool and primitives (rectangle/ellipse/line/polygon/triangle) with winding engine; layer system and paste-in-place clipboard; glyph management with onion-skinning.
- **Phase 5:** non-destructive **Pathfinder between two layers** — Ctrl/Cmd+click two layer rows, pick Union / Subtract / Intersect / Exclude. Curve-exact (Paper.js), both layers stay editable, results computed at render/export time only.
- **Phase 6:** bulk export — every glyph as `u_xxxx.svg`, universal scale %, web zip download (`fflate`) or desktop folder write (Tauri). Reuses the Pathfinder pipeline so exports match the canvas exactly.
- **Phase 7:** non-destructive per-path strokes — uniform and broad-nib/calligraphic, per-end caps (butt/round/**rectangle**/serif/drop), serif feet (anchor / world-absolute angle / asymmetric bias), drop terminals, expanded to filled outlines at render/export.
- **Phase A:** command registry + rebindable keyboard shortcuts + right-click context menus.
- **Phase B:** node topology — split/delete-toggle/merge endpoints on drag.
- **Phase C:** settings persistence (theme/grid/prefs survive reload) + keybinding editor.
- **Phase E:** transform box (Ctrl+T) — scale/rotate/move handles over node selection.
- **Phase F (partial):** destructive merge/flatten — bakes selected layers' rendered geometry into one layer.
- **Stroke library & profiles:** user-managed **stroke preset library** (persisted), and **width & nib-angle profiles** — per-path curves drawn in a small graph editor that vary thickness / pen angle along the path (closed paths render as an annulus). Cross-layer stroke editing.
- **Portable project export/import:** File → Export/Import project… writes/reads one `.glphdrft` file (the versioned document envelope; legacy `.glyphforge` files still import), so a project moves between machines (web ⇄ desktop).
- **Vector-editing basics:** arrow-key nudge (Shift ×10), duplicate (Ctrl/Cmd+D), flip H/V, reverse path, zoom-to-fit (Ctrl/Cmd+0) / actual size (Ctrl/Cmd+1), and Shift-constrain on the shape tools (square / circle / regular / 45°).

**Not yet implemented:** color/fill support (incl. imported-SVG color), SVG import → layer, align/distribute, free pencil/brush, path-node corner rounding, knife/scissors/eraser, dashed/pattern strokes, blend/echo stepped interpolation, i18n.

## Tech stack

- **React 18 + TypeScript** (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — UI and component layer
- **Zustand** — shared app state; **zundo** — undo/redo history on the document store (200 steps)
- **Paper.js** — live geometry engine: curve-exact boolean ops (union/subtract/intersect/exclude) behind the `GeometryService` interface. **paperjs-offset** — stroke expansion (uniform + calligraphic outlines).
- **LocalForage** — IndexedDB persistence on web (autosave + explicit save, versioned format)
- **fflate** — in-browser zip for the bulk SVG export
- **LocalForage** (web) / **Tauri v2 FS plugin** (desktop) behind a single `StorageService` interface — the Tauri adapter is always lazy-loaded so the web bundle never references `@tauri-apps`
- **Vite** for dev/build; **Tauri v2** for the desktop shell

> **Paper.js note:** Paper.js is stable but hasn't had a major release since 2022. It sits entirely behind `src/engine/geometry/geometryEngine.ts` — swapping it for another library is a one-line change in that file with no ripple into stores or UI.

## Platform compatibility

### Web (static site)

Build target is **ES2020**, so any browser from early 2020 or later:

| Browser | Minimum version |
|---|---|
| Chrome / Edge | 80 |
| Firefox | 72 |
| Safari / iOS Safari | 13.1 |

The canvas renders as SVG — no WebGL, no GPU requirement. Works on mobile browsers and low-powered hardware. Data is stored in IndexedDB (supported everywhere since ~2014).

### Desktop (Tauri v2)

| OS | Minimum version | Notes |
|---|---|---|
| Windows | 10 (2015) | Requires WebView2, already bundled on Win 10/11. Win 7/8 not supported. |
| macOS | 10.13 High Sierra (2017) | |
| Linux | Ubuntu 20.04 / Fedora 32 / Arch | Needs WebKitGTK 4.0 |

**CPU:** x86_64 and aarch64 (Apple Silicon, ARM Linux) only. No 32-bit desktop builds.

## Building for each platform

**Web build** — works on any OS, just needs Node.js:

```bash
npm install
npm run build   # produces dist/ — deploy to any static host
```

**Desktop build (Tauri)** — produces the native installers/binaries: **`.exe`** on Windows,
**`.deb` + `.AppImage` + `.rpm`** on Linux, **`.dmg` + `.app`** on macOS. The project folder is fully
portable (no hardcoded paths) — move it to the target OS, install the prerequisites once, then build.

> ⚠️ **Tauri builds for the OS you run it on — there is no practical cross-compilation.** A Windows
> `.exe` must be built **on Windows**, the Linux bundles on **Linux**, and the macOS bundles on
> **macOS**. To produce every artifact from a single push, use CI (see "All platforms at once" below).

**1. One-time prerequisites per machine** — Node.js + npm and Rust (via [`rustup`](https://rustup.rs/))
on every OS, plus:

| OS | Also install |
|---|---|
| **Windows** | Microsoft C++ Build Tools (VS Build Tools or Visual Studio → "Desktop development with C++"). WebView2 is preinstalled on Win 10/11. NSIS (for the `-setup.exe`) is fetched by Tauri automatically. |
| **macOS** | Xcode Command Line Tools (`xcode-select --install`). |
| **Linux (Debian/Ubuntu)** | `sudo apt install build-essential curl wget file libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev` — and **`rpm`** if you want the `.rpm` bundle. (Fedora: the `dnf` `webkit2gtk4.1-devel`/`@development-tools` groups; Arch: `pacman` `webkit2gtk-4.1 base-devel`. See the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).) |

**2. Install the Tauri CLI** (not bundled in this repo). Either add it to the project once:

```bash
npm install --save-dev @tauri-apps/cli@^2     # then use:  npx tauri <cmd>
```

…or install it globally via Cargo: `cargo install tauri-cli --version "^2"` (then `cargo tauri <cmd>`).
Tip: add `"tauri": "tauri"` to `package.json` → `scripts` if you prefer `npm run tauri build`.

**3. (Windows / macOS only) Generate the platform icon set** — this repo ships only PNG icons, and the
Windows/macOS installers need an `.ico`/`.icns`. Run once (uses a square ≥1024 px source PNG):

```bash
npx tauri icon path/to/icon.png   # writes icon.ico + icon.icns and updates tauri.conf.json
```

**4. Build:**

```bash
npm install
npx tauri build                              # bundles for THIS OS (runs the web build first)
# pick specific bundles, e.g. on Linux (omit rpm unless rpmbuild is installed — see Troubleshooting):
npx tauri build --bundles deb,appimage
```

**Where the files land** — under `src-tauri/target/release/bundle/` (raw binary at
`src-tauri/target/release/glyph-draft[.exe]`):

| OS | Artifacts |
|---|---|
| **Windows** | `nsis/Glyph Draft_0.1.0_x64-setup.exe` (installer `.exe`); `msi/…msi` if WiX is present |
| **Linux** | `deb/glyph-draft_0.1.0_amd64.deb` · `appimage/glyph-draft_0.1.0_amd64.AppImage` · `rpm/glyph-draft-0.1.0-1.x86_64.rpm` |
| **macOS** | `dmg/…dmg` · `macos/Glyph Draft.app` (universal) |

**All platforms at once** — use a **GitHub Actions matrix** with
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) on `windows-latest`,
`ubuntu-latest`, and `macos-latest` runners; it builds each OS's artifacts in parallel and attaches them
to a release. This is the only way to get the Windows `.exe` without a Windows machine.

### Troubleshooting

- **`could not compile 'brotli'` / `the trait 'alloc::Allocator<u8>' …` (alloc-no-stdlib).** A transitive
  dep (`brotli`, pulled by Tauri) was incompatible with a newer Rust. **Fix:** refresh the lockfile —
  `cd src-tauri && cargo update` — then rebuild (`brotli` ≥ 8.0.4 compiles cleanly). **Commit the updated
  `src-tauri/Cargo.lock`** so it doesn't recur.
- **`icon …/32x32.png is not RGBA`.** Tauri requires **RGBA** PNG icons (with an alpha channel); a plain
  RGB PNG fails the build. **Fix:** regenerate the icon set from a square source —
  `npx tauri icon src-tauri/icons/icon.png` (writes RGBA `32x32/128x128/icon.png` + `icon.ico`/`icon.icns`
  and updates `tauri.conf.json`). Commit the regenerated `src-tauri/icons/`.
- **Build compiles, then fails at the `.rpm` step.** `tauri.conf.json` sets `bundle.targets: "all"`, but
  `.rpm` needs `rpmbuild`. Either `sudo apt install rpm`, or build only the formats you want:
  `npx tauri build --bundles deb,appimage`.
- **`failed to run linuxdeploy` (AppImage step).** `linuxdeploy` is itself an AppImage and FUSE-mounts to
  run; in sandboxed/headless/CI shells (no `/dev/fuse` or restricted user namespaces) that fails even when
  `libfuse2` is installed. **Fix:** tell the AppImage tools to extract instead of mount —
  `APPIMAGE_EXTRACT_AND_RUN=1 npx tauri build --bundles appimage` (add `NO_STRIP=1` if the strip step also
  errors). The first run also downloads `linuxdeploy` from GitHub, so it needs network once.

## Running locally

```bash
npm install
npm run dev          # web app on http://localhost:5173
npm run typecheck    # tsc --noEmit (strict)
npm test             # vitest run — pure-engine unit tests
npm run build        # production web build

# Desktop (requires Rust toolchain + the Tauri CLI + platform prerequisites —
# see "Building for each platform" above):
npx tauri dev
```

## Architecture at a glance

```
src/
  engine/                  # framework-free domain logic (unit-tested)
    viewport/transform.ts  # the ONLY place the world<->screen Y-flip lives
    snapping/snap.ts       # pure snap-to-grid quantization (world units)
    geometry/              # path/winding math + the boolean engine
                           #   GeometryService.ts: the swappable interface
                           #   PaperGeometryService.ts: live impl (Paper.js, curve-exact)
                           #   PolygonGeometryService.ts: test-only impl (flattens curves)
  state/                   # Zustand stores
    viewportStore.ts       # zoom/pan/grid/theme — NOT undoable
    documentStore.ts       # glyphs/layers — undoable via zundo
    editorStore.ts         # live ephemeral session state — NOT undoable
    middleware/temporal.ts # typed hook over zundo's temporal store
  storage/                 # StorageService + Local/Tauri adapters + factory
  features/
    canvas/                # viewport, grid, HUD, tool controller
    tools/                 # pen, select, lasso, shapes — no React, no DOM
    layers/                # LayersPanel, merge/flatten
    glyphs/                # GlyphSidebar, thumbnails
    clipboard/             # copy/cut/paste (layer-aware)
    export/                # glyphToSvg, ExportService, ExportModal (bulk SVG)
    project/               # portable .glphdrft project export/import (web/desktop seam)
    settings/              # KeybindingsModal
  commands/                # registry.ts — single source of actions + keybinds
  components/controls/     # small shared UI controls
  types/                   # dependency-free shared types
  constants/               # font metrics + defaults
  styles/                  # theme.css (CSS-variable dark/light)
src-tauri/                 # Tauri v2 desktop shell
```

### Two key decisions

1. **Coordinate system.** World space is in font units, Y-up, baseline at
   `y = 0` (descenders negative). Screen space is CSS px, Y-down. The single
   Y-flip is encoded only in `engine/viewport/transform.ts`; every other module
   goes through it.

2. **Split stores.** `viewportStore` (camera + UI) is separate from
   `documentStore` (the glyph model) and is deliberately *not* part of the
   undo/redo history — so <kbd>Ctrl</kbd>+<kbd>Z</kbd> never undoes a pan or
   zoom. The document model is plain serializable data (no class instances),
   which is what makes snapshot history and cross-glyph paste-in-place reliable.

## Canvas controls

- **Pan:** scroll/trackpad, <kbd>Space</kbd>+drag, or middle-mouse drag
- **Zoom:** <kbd>Ctrl/Cmd</kbd>+scroll (or trackpad pinch) — zooms to cursor; <kbd>Ctrl/Cmd</kbd>+<kbd>0</kbd> fit, <kbd>Ctrl/Cmd</kbd>+<kbd>1</kbd> actual size
- **Edit selection:** Arrow keys nudge (Shift = ×10), <kbd>Ctrl/Cmd</kbd>+<kbd>D</kbd> duplicate; flip H/V and reverse path from the right-click menu
- **Reset view / theme / grid / snap:** the floating control panel

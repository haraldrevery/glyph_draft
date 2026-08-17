# Glyph Draft

A web-based and Tauri-wrapped SVG editor focused entirely on **drawing font
glyphs**. One glyph is one document is one SVG, exported as `u_xxxx.svg` for
import into FontForge. It is a glyph *drawing* tool, not a font editor —
kerning, OTF compilation, and metrics editing are left to FontForge.

## What it does

> **Detail lives in [CLAUDE.md](CLAUDE.md)** — the architectural invariants, the per-phase history,
> and the feature-by-feature status table. This README deliberately stays a summary and defers there
> rather than duplicating it (the duplication is what let this file go stale before).

**Drawing** — Illustrator-style bezier pen, freehand pencil (auto-simplified/smoothed), and
primitives (rectangle / ellipse / line / polygon / triangle) with Shift-constrain and draw-from-centre.
Scissors, knife and eraser for cutting paths. Node editing with lasso and marquee select, a transform
box (Ctrl+T) with a draggable rotation pivot, align/distribute, and snapping to grid or to
anchors/paths.

**Strokes (the core idea)** — you draw a *path*, then shape it with a **non-destructive stroke**: the
centerline stays editable and the filled outline is derived at render/export. Uniform, broad-nib
calligraphic, and swept-brush models; per-end caps (butt / round / rectangle / serif / drop) with A/B
algorithm variants; bracketed serif feet and teardrop ink-pool terminals; width and nib-angle
**profiles** drawn in a graph editor; plus experimental **halftone** and **dash/dot/custom-SVG**
brushes. Presets are saved in a user-managed library. Path corners (round / chamfer / inverted) apply
non-destructively too, and any stroke can be manually expanded to editable outlines.

**Layers & booleans** — Illustrator-style layers (lock, hide, reorder, colour-coded). A
**non-destructive Pathfinder between two layers**: Union / Subtract / Intersect / Exclude, plus
**Blend** (an A→B stepped morph). Curve-exact via Paper.js, computed at render/export time, so both
operand layers stay fully editable. Destructive merge/flatten is available when you want to bake.

**Colour** — per-contour fill and stroke colour are independent, with opacity, two-stop linear
gradients (including along-path for strokes), saved palettes, and imported-SVG colour. Decorative
only: FontForge flattens it on import.

**Glyphs & output** — a code-point-sorted sidebar with live thumbnails, onion-skinning against other
glyphs, adjustable typography guides and per-glyph advance width, and a text-preview window. Export
every glyph as `u_xxxx.svg` (or just one) with a universal scale %, an optional flat-black silhouette
mode, and synthetic **bold/italic**. SVG import lands on a new layer.

**Workspace** — dark / light / paper themes with a custom accent, movable and resizable panels, a
command registry with fully rebindable shortcuts, right-click menus everywhere, per-glyph undo/redo,
and autosave plus a portable `.glphdrft` project file that moves between web and desktop.

**Not yet implemented:** dynamic alignment "smart guides", a custom cap designer, procedural/L-system
brushes, per-*node* corner styles (per-path corners are shipped), and i18n. See CLAUDE.md →
"Future seams" for how entangled each is and whether it's safe to build.

## Tech stack

- **React 18 + TypeScript** (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — UI and component layer
- **Zustand** — shared app state. Undo/redo is **per-glyph** and hand-rolled (`src/state/history.ts`, 200 steps), so Ctrl+Z only ever changes the glyph you're looking at
- **Paper.js** — the live geometry engine behind the `GeometryService` interface: curve-exact booleans and stroke expansion. Stroke outlines are built in-house (`PaperGeometryService`), not by an offset library
- **fflate** — in-browser zip for the bulk SVG export
- **marked** — renders the bundled Markdown in the Information modal
- **LocalForage** (web) / **Tauri v2 FS plugin** (desktop) behind a single `StorageService` interface — the Tauri adapter is always lazy-loaded so the web bundle never references `@tauri-apps`
- **Vite** for dev/build; **Vitest** for the pure-engine unit tests (46 files, 433 tests); **Tauri v2** for the desktop shell

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

**2. The Tauri CLI is already a devDependency** (`@tauri-apps/cli@^2`), wired to the `tauri` script —
so `npm install` is all you need, then use `npm run tauri <cmd>` (or `npx tauri <cmd>`).

If you'd rather have it globally: `cargo install tauri-cli --version "^2"` (then `cargo tauri <cmd>`).

**3. (Windows / macOS only) Generate the platform icon set** — this repo ships only PNG icons, and the
Windows/macOS installers need an `.ico`/`.icns`. Run once (uses a square ≥1024 px source PNG):

```bash
npx tauri icon path/to/icon.png   # writes icon.ico + icon.icns and updates tauri.conf.json
```

**4. Build:**

```bash
npm install
npm run tauri build                              # bundles for THIS OS (runs the web build first)
# pick specific bundles, e.g. on Linux (omit rpm unless rpmbuild is installed — see Troubleshooting):
npm run tauri build -- --bundles deb,appimage
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
npm run test:watch   # vitest in watch mode
npm run build        # production web build (typechecks first)
npm run preview      # serve the built dist/ locally

# Desktop (requires the Rust toolchain + platform prerequisites —
# see "Building for each platform" above):
npm run tauri dev
```

## Architecture at a glance

> The full, annotated file tree is in **[CLAUDE.md](CLAUDE.md) → "Source Structure"**. This is the
> orientation-level view.

```
src/
  engine/                  # framework-free domain logic (unit-tested, no React/DOM)
    viewport/transform.ts  # the ONLY place the world<->screen Y-flip lives
    snapping/snap.ts       # pure snap-to-grid quantization (world units)
    geometry/              # path/winding/bezier math, corners, blend, profiles
                           #   GeometryService.ts: the swappable interface
                           #   geometryEngine.ts: the single swap point
                           #   PaperGeometryService.ts: live impl (Paper.js, curve-exact)
                           #   PolygonGeometryService.ts: test-only impl (flattens curves)
  state/                   # Zustand stores (+ persistence lifecycle)
    viewportStore.ts       # zoom/pan/grid/theme — NOT undoable
    documentStore.ts       # glyphs/layers — plain data
    history.ts             # PER-GLYPH undo/redo (custom, not zundo)
    editorStore.ts         # live ephemeral session state — NOT undoable
  storage/                 # StorageService + Local/Tauri adapters + versioned file formats
  features/
    canvas/                # viewport, tool controller, Stroke/Color panels, fill pipeline
    tools/                 # pen, pencil, select, lasso, shapes, scissors/knife/eraser
    layers/                # LayersPanel, Pathfinder UI, merge/flatten
    glyphs/                # GlyphSidebar, thumbnails, glyph-set templates
    clipboard/             # copy/cut/paste-in-place (layer-aware)
    import/ export/        # SVG import; glyphToSvg + bulk export behind ExportService
    project/               # portable .glphdrft export/import (web/desktop seam)
    preview/ info/ settings/
  commands/                # registry.ts — single source of actions + keybinds
  components/              # shared controls, menus, error boundary
  types/ constants/ styles/ utils/
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
   History is **per-glyph**, so an undo can never silently revert a glyph you
   aren't looking at.

3. **Geometry is a service, not the data model.** Paper.js never owns the scene
   graph — the canonical glyph stays plain Zustand state rendered to native SVG,
   and heavy vector math goes through `GeometryService`. Swapping the engine is a
   one-line change in `engine/geometry/geometryEngine.ts`.

## Canvas controls

- **Pan:** scroll/trackpad, <kbd>Space</kbd>+drag, or middle-mouse drag
- **Zoom:** <kbd>Ctrl/Cmd</kbd>+scroll (or trackpad pinch) — zooms to cursor; <kbd>Ctrl/Cmd</kbd>+<kbd>0</kbd> fit, <kbd>Ctrl/Cmd</kbd>+<kbd>1</kbd> actual size, <kbd>Ctrl/Cmd</kbd>+<kbd>2</kbd> zoom to selection
- **Tools:** <kbd>V</kbd> select · <kbd>Q</kbd> lasso · <kbd>P</kbd> pen · <kbd>B</kbd> pencil · <kbd>C</kbd> scissors · <kbd>K</kbd> knife · <kbd>X</kbd> eraser · <kbd>M</kbd>/<kbd>E</kbd>/<kbd>L</kbd>/<kbd>G</kbd>/<kbd>T</kbd> shapes
- **Edit selection:** Arrow keys nudge (Shift = ×10), <kbd>Ctrl/Cmd</kbd>+<kbd>D</kbd> duplicate, <kbd>Ctrl/Cmd</kbd>+<kbd>T</kbd> transform box; flip H/V and reverse path from the right-click menu
- **View modes:** <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> toggles wireframe/outline; a "final" mode previews the exported look
- **Grid, snap, onion skin, guides, themes:** the **View** and **Settings** top-bar menus
- Every shortcut is rebindable in Settings → Keyboard shortcuts

# Glyph Draft — Project Context for AI Assistants

> **Naming:** the product is **Glyph Draft**; its project files use the **`.glphdrft`** extension (legacy
> `.glyphforge` files still import). Because the app is pre-release, the internal identifiers were renamed
> too: KV keys `glyphdraft:*`, IndexedDB DB name `glyph-draft`, npm name `glyph-draft`, Cargo crate
> `glyph-draft` / lib `glyph_draft_lib`, Tauri id `app.glyphdraft.desktop`. (No data migration ships — a
> pre-rename autosave under the old keys won't auto-load; export → re-import a project file to carry it over.)

## Core Philosophy

This is a **glyph drawing tool**, NOT a font editor. It handles vector art, stylistic consistency, and SVG generation. Typography features (kerning, OTF compilation, metrics editing) are out of scope and delegated to FontForge.

**Primary workflow:** Draw a path first, then adjust stroke outlines to shape the glyph — not drawing pre-filled shapes. This keeps glyphs easy to adjust later.

When UX/UI is ambiguous, default to **Adobe Illustrator paradigms**.

## Target Platforms

- **Web** — storage via LocalForage (IndexedDB)
- **Desktop** — Tauri v2 wrapper, strict `StorageService` abstraction layer (must remain swappable to Electron without touching feature code)

## Tech Stack

- React 18 + TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Zustand for state; **per-glyph** undo/redo history (`state/history.ts`, custom — replaced the old global zundo timeline)
- Vite for dev/build; Tauri v2 for the desktop shell
- Vitest for the pure-engine unit tests (geometry, winding, transform, snap)
- `fflate` for the web export zip; `@tauri-apps/plugin-dialog` + `-plugin-fs`
  (both lazy-loaded, desktop-only) for the desktop folder export
- **Geometry engine:** **Paper.js is installed and is the live engine**
  (`PaperGeometryService`), wired behind the `GeometryService` seam via
  `geometryEngine.ts`. It computes **curve-exact** booleans for the
  non-destructive two-layer Pathfinder (see Phase 5). The original dependency-free
  `PolygonGeometryService` (which flattens beziers to polylines) is kept for the
  DOM-free unit tests, which inject it directly rather than going through the seam.

## Run Commands

```bash
npm install
npm run dev          # web — http://localhost:5173
npm run typecheck    # tsc --noEmit (strict, must stay clean)
npm test             # vitest run — pure-engine unit tests (must stay green)
npm run test:watch   # vitest in watch mode (what you want while doing geometry work)
npm run build        # production web build — runs `tsc --noEmit` FIRST, so it subsumes typecheck
npm run preview      # serve the built dist/ locally
npm run tauri dev    # desktop (requires Rust toolchain + Tauri prerequisites)
```

## Testing

Vitest covers the **pure engine** — the modules where a wrong number silently
corrupts geometry: `transform.ts` (the Y-flip + zoom-to-cursor), `snap.ts`,
`path.ts` (bezier/winding math), `winding.ts`, `clip.ts` (the polygon boolean
ops), `primitives.ts`. `PaperGeometryService.test.ts` also runs here: Paper.js
initializes headless (a Size-based `PaperScope`, no canvas/DOM), so the live
geometry engine is under the same deterministic suite. `glyphToSvg.test.ts`
(Phase 6 export) runs here too — it drives the live Paper engine for boolean
pairs the same headless way. Tests are colocated as `*.test.ts` next to each
module.

These are the cheapest possible regression guard: deterministic, no DOM, no
mocks. **Before claiming a geometry change works, run `npm test`** — do not assert
verification narratively.

**The suite is much wider than the two paragraphs above imply — 59 files / 707 tests.**
Beyond the engine modules named there it also covers `affine`, `align`, `blend`, `corners`,
`freehand`, `nodeHandles`, `polygon`, `profile`, `svgPath`, `topology`, and the big one,
`strokeOutline.test.ts` (74 tests, ~70% of the runtime — the guard on the riskiest file; it now
includes CURVED-path cap tests — every earlier cap test used a straight stem, which is how a
global terminal cut that deleted most of a curving stroke went unnoticed).
The React-free **glue** is covered too — `clipboardActions`, `mergeLayers`, `documentStore`,
`editActions`, `expandStroke`, `layerFills`, `fillPaint`, `glyphToSvg`, `styleTransform`,
`svgImport`, `textLayout`, `projectActions`, `glyphHelpers`, `history`, `registry`, the
tool helpers (`hitTest`, `select`, `pen`, `shapes`, `lasso`, `shared`, `snapGeometry`), the
stores (`colorPaletteStore`, `strokePresetStore`), and both persisted formats
(`projectFile`, `settingsFile`) — all via `getState`, Paper headless where needed. Even one
control has a pure test (`Slider.test.ts` → `clampToStep`). **`state/fieldSurvival.test.ts`
is a cross-cutting GUARD:** it plants an unknown field on a contour and its nodes and runs it
through every copy/rebuild site (paste, cut, split, join, reverse, drag, transform, node
conversion, corners) — add any NEW copy site to it. **So: assume a module you are
about to change already has a test, and check before adding a new file.** Only the React
components themselves (overlays, modals, panels) remain verified in-app.

## Verifying export (FontForge round-trip)

The tool's deliverable is FontForge-importable SVG, so confirm the round-trip after
touching `glyphToSvg`/`buildFillGroups`/winding:
1. File → Export SVGs… (100%); use a representative set — a solid letter, a counter via a
   **Subtract** pair, a **stroked** path, and a **merged/baked** layer.
2. In FontForge, open a glyph and **File → Import** each `u_xxxx.svg` (SVG format).
3. Confirm: outer shapes fill, **counters/holes punch through** (winding correct),
   nothing is inverted, advance width matches, artwork sits on the baseline as on
   canvas. Holes filling in or shapes inverting ⇒ a winding mismatch to fix in
   `glyphToSvg`/`buildFillGroups` (NOT by re-running `correctWinding` — see Invariant 4).

## Source Structure

> Kept in sync with the real tree; if you add a file, add it here. Test files (`*.test.ts`,
> colocated next to their module) are omitted for brevity — there are 59 of them.

```
src/
  main.tsx                       # React 18 entry (wraps <App/> in ErrorBoundary)
  App.tsx                        # Shell: menu bar (File / Edit / View / Glyphs / Settings / Information), modals, theme/accent sync, global key handler mount
  vite-env.d.ts                  # Types the `?raw` Markdown imports as string
  engine/                        # Framework-free, pure domain logic
    viewport/transform.ts        # THE ONLY place the world↔screen Y-flip lives
    snapping/snap.ts             # Pure snap-to-grid (world units)
    paint/paint.ts               # Pure fill-paint rules: DEFAULT_INK/isDefaultInk (black = no paint, for fills AND stroke colours),
                                 #   patchPaint (per-contour paint PATCH — the Color panel's multi-selection edits),
                                 #   pinLegacyStrokePaint (a fill edit never recolours an outline that falls back to the fill)
    geometry/
      GeometryService.ts         # Boolean/winding interface (union/subtract/intersect/exclude)
      geometryEngine.ts          # getGeometryService() — the single swap point (→ Paper)
      PaperGeometryService.ts    # LIVE impl: Paper.js, curve-exact booleans
      PolygonGeometryService.ts  # Test-only impl: dependency-free, flattens curves to polylines
      clip.ts                    # Planar-arrangement boolean clipper (the polygon ops)
      polygon.ts                 # Low-level polygon math: flatten, winding number, simplify
      path.ts                    # Bezier path math + SVG `d` serialization (absolute coords) + cubicBounds (exact curve extrema)
      svgPath.ts                 # Pure SVG path-`d` PARSER (M/L/H/V/C/S/Q/T/A/Z + relative; arc→cubic) for import
      primitives.ts              # makeLine/makeRectangle/makeEllipse/makePolygon — always CW winding
      topology.ts                # Pure node topology: extractContours (split/cut), joinContours (merge/join: fuses coincident ends keeping both curves, or connects ends that are apart), closeEnds, splitContourAtPoints (multi-cut: scissors/knife/eraser; splitContourAt = single-cut wrapper). Pieces are built by SPREADING the source contour, so no field is dropped
      affine.ts                  # Pure 2D affine (transform box): scale/rotate/translate + transformSelected (a mirror re-reverses a fully mirrored BAKED contour so its winding = its holes survive)
      align.ts                   # Pure align/distribute math (contourBounds + alignDeltas) for the Align panel; contourTightBounds = exact-curve bounds (export crop)
      winding.ts                 # Winding detection and correction (nesting-depth based)
      freehand.ts                # Pure freehand fit: simplifyRDP + fitFreehand (Catmull-Rom handles, corner/close detection) for the pencil tool
      profile.ts                 # Pure monotone-cubic profile evaluator (evalProfile) — drives the width/nib-angle graphs
      blend.ts                   # Pure A→B shape morph (blendContours) — the Phase-M 5th pair op; steps carry stroke/paint/filled/corner/baked
      nodeHandles.ts             # Pure node-continuity conversion (convertPoint): smooth / cusp / corner
      corners.ts                 # Pure per-path corner pre-pass: roundCorners (round/chamfer/invertedRound, clamped) — non-destructive, run in renderContours before stroke-expand/export
  state/
    viewportStore.ts             # Zoom/pan/grid/theme — NOT undoable
    documentStore.ts             # Glyphs/layers — plain store; undo/redo is per-glyph (see history.ts).
                                 #   Per-contour STYLE actions all go through ONE `patchContours(ids, fn)`
                                 #   closure helper (cross-layer, skips locked, one undo step) — add the
                                 #   next style field there, don't re-copy the traversal
    history.ts                   # PER-GLYPH undo/redo (Map<glyphId,{past,future}>, limit 200) — useHistoryStore/useHistory; structural glyph add/delete not recorded;
                                 #   coalesceNextEdit(tag): a slider/knob/colour drag = ONE step (see Invariant 2)
    tabLock.ts                   # claimWorkspace(): Web Lock so only ONE tab autosaves the workspace (a second tab opens but doesn't save)
    editorStore.ts               # Live ephemeral state (pen in-progress, drag) — NOT undoable
    clipboardStore.ts            # Clipboard — survives undo and tool switches
    onionStore.ts                # Onion-skin state — NOT undoable
    keybindingStore.ts           # User shortcut overrides (effectiveKeys) — persisted (settings v2+)
    strokePresetStore.ts         # User-saved StrokePresets — persisted (settings v3+)
    colorPaletteStore.ts         # User-saved named colour palettes — persisted (settings v5+)
    paletteStore.ts              # Session-only RECENT colours (NOT persisted)
    panelStore.ts                # Session-only floating-panel positions (PanelId = stroke/fill/layers/tool/align)
    noticeStore.ts               # Session-only header NOTICES for file operations (import/export/restore errors) — NOT the save status
    glyphHelpers.ts              # createGlyph, glyphLabel, parseGlyphInput, exportFileName, markBaked +
                                 #   cloneContourWithNewIds (SPREADS the contour, so every field survives) /
                                 #   cloneLayer — ⚠ cloneLayer still rebuilds a Layer FIELD-BY-FIELD, so a new
                                 #   optional LAYER field must be added there too (omitting one compiles clean)
    persistence.ts               # Document: load-on-launch (missing/invalid/unreadable slots handled differently) + serialized,
                                 #   debounced autosave (flushed on tab hide) + saveNow + blockSaving + useSaveStatus — see Invariant 7;
                                 #   also rotates the per-launch "session" recovery points (File → Restore previous version…)
    settings.ts                  # Preferences: load-on-launch + debounced autosave (separate KV key)
  storage/
    StorageService.ts            # KV interface everything talks to
    LocalForageStorage.ts        # Web adapter
    TauriStorage.ts              # Desktop adapter (lazy-loaded, code-split)
    createStorage.ts             # Memoized platform factory
    platform.ts                  # isTauri() — checks window globals, no tauri import
    projectFile.ts               # Versioned document format + migrate() seam (corruption-safe; v8→v9 = liftLayerBaked); recovery keys PREIMPORT_KEY / SESSION_KEY / SESSION_PREV_KEY
    sanitize.ts                  # sanitizeGlyph: load-time structural REPAIR (never reject) of anything that would crash rendering
    settingsFile.ts              # Versioned PREFERENCES format + migrateSettings/mergeSettings (defaults-fallback)
  features/
    canvas/                      # Main viewport, grid, HUD, tool controller
      CanvasViewport.tsx
      ViewMenu.tsx               # View top-bar menu body: grid/snap/onion/reset + outline + adjustable typography guides (replaced the old floating ControlPanel)
      EditMenu.tsx               # Edit top-bar menu — a VIEW over the command registry (like the right-click menu), with shortcut hints; keeps inapplicable commands visible-but-disabled
      ToolPanel.tsx              # Contextual ACTIVE-tool options (view-layer TOOL_PANELS map by ToolId); movable like the other panels
      StrokePanel.tsx            # Per-path SHAPE only: path Corners (round/chamfer/inverted) + stroke editor (width/cap/join/serif/drop/nib + width & nib-angle profiles + preset library + brush model). NO colour — all colour lives in the Color panel (FillPanel.tsx). Shape edits PATCH each path's own stroke (setContourStroke→patchContourStroke/removeStrokeKeys), so editing e.g. width on a multi-selection never overwrites each path's stroke colour/gradient
      FillPanel.tsx              # The **"Color" panel** (movable HUD, panel id "fill") — ALL colour, both fill and stroke. A panel-level **Palette** picker (colorPaletteStore — a colour SOURCE for both sections). A **Fill section**: a "Fill interior" toggle (Contour.filled, independent of stroke — setContourFilled) gating the shared ColorPicker (swatch/hex + preset inks + recent + palette swatches with a "+" tile) + opacity + gradient. A **Stroke section**: the SAME ColorPicker for StrokeStyle.color (setStrokeColor) + a **stroke Gradient** (patchStrokeGradient, "Along path" toggle — both only touch contours that already have a stroke). A separated "Manage palette" row at the bottom. Every edit is a per-contour PATCH (patchContourPaint / patchStrokeGradient), so a multi-selection keeps each path's own colours; Recent records CHOSEN colours only (not every picker-drag shade)
      useEditTargets.ts          # Shared hook: the target contours (selected-anchor paths across unlocked layers, else active layer) used by BOTH StrokePanel and FillPanel
      GraphEditor.tsx            # SVG control-point editor for the width/nib-angle profiles
      Toolbar.tsx
      brushPresets.ts            # Read-only BUILT-IN brushes (sibling of the user strokePresetStore)
      usePanelDrag.ts            # Drag/resize for the floating HUD panels (over panelStore)
      layerFills.ts              # renderContour (THE definition of what one contour renders to — shared with Expand stroke) + buildFillGroups (active glyph, live) + glyphFillGroups (per-glyph, cached) — strokes + booleans + group-by-PAINT → live results (non-destructive); boolean-pair result inherits operand A's/B's paint (firstPaint). Identity-memoized per layer render, per Pathfinder pair and per blend (see Invariant 3)
      fillPaint.ts               # Pure linearGradientSpec(group) — turns Paint.gradient into {id,transform,stops} for the canvas/preview/export renderers (objectBoundingBox; Y-flip-aware; DOM-safe id)
      editActions.ts             # React-free nudge/flip/reverse + move-to-layer, merge-endpoints, expand-stroke (via renderContour), align — over the node selection (one undo step)
      useGlyphContours.ts        # Render selectors (visible/editable layers; liveContours across layers)
      hooks/usePanZoom.ts        # Space+drag, middle-drag, wheel zoom/pan
      hooks/useToolController.ts # Routes pointer events to active tool; Esc/Enter only
      components/                # Grid, EmSquare, MetricGuides, MetricLabels,
                                 # SnapIndicator, CoordinateReadout, EditOverlay,
                                 # GlyphView, OnionSkin, PreviewLayer, LassoOverlay,
                                 # MarqueeOverlay, TransformBox, AlignPanel,
                                 # EraserCursor, UnitReference
    tools/                       # Tool definitions (no React, no DOM)
      pen.ts                     # Bezier pen — Illustrator-style
      freepen.ts                 # Free-pen (pencil) — freehand draw → simplified smooth bezier (reuses freehand.ts + the shapes draft→commit gesture)
      scissors.ts                # Scissors — click a path to cut it (nearestPointOnContours → splitContourAt)
      knife.ts                   # Knife — drag a line; cut every crossed path (lineCrossings → splitContoursAtPoints)
      eraser.ts                  # Eraser — drag along a path; drop the spanned portion (nearestPointOnContours → eraseContourSpan)
      select.ts                  # Node/anchor select + drag + merge-endpoints-on-drag
      lasso.ts                   # Freeform lasso node select + cross-layer move
      shapes.ts                  # Rectangle, Ellipse, Line, Polygon, Triangle
      types.ts                   # ToolDefinition interface
      hitTest.ts                 # Hit testing (layer-scoped) + hitEndpoint
      shared.ts                  # Shared node-tool helpers (anchor-delta, selected-layer scope, refsInPolygon)
      snapGeometry.ts            # Pure "Snap to point" resolver (nearestAnchor → nearestPointOnContours)
      index.ts                   # The TOOLS registry — drives toolbar + shortcuts + routing
    layers/                      # LayersPanel, LayerRow, GroupRow, useRowDrag (drag-reorder), mergeLayers (destructive flatten),
                                 #   layerColors (auto per-layer editing palette), layerTree (the GROUP tree as a pure
                                 #   view over the flat layers array: groupRange, effectiveLocked/Visible, resolvedLayers — see 5b)
    glyphs/                      # GlyphSidebar (resizable: right-edge drag handle → viewportStore.sidebarWidth; drag left to collapse to a re-open grip; "Reset view" restores 212px/expanded), GlyphCell, GlyphThumbnail, glyphSets (set templates)
    settings/                    # KeybindingsModal — the keyboard-shortcut editor
    clipboard/
      useClipboard.ts            # React entry for copy/cut/paste-in-place (layer-aware)
      clipboardActions.ts        # React-free copy/cut(node-aware split)/paste/selectAll
    boolean/                     # info.md only — the Pathfinder UI lives in the
                                 #   Layers panel; combine is canvas/layerFills.ts
    export/                      # Phase 6 — bulk SVG export
      glyphToSvg.ts              # Pure glyph→SVG string (reuses buildFillGroups; optional synthetic style; optional `silhouette` flag → every region flat solid black, no colour/gradient/opacity, holes preserved — FontForge-ready; optional `tightCrop` flag → viewBox hugs the artwork instead of the em box)
      styleTransform.ts          # Export-only synthetic Bold/Italic: transformContours (skew/stretch the FINAL outline) + extendOutlineX (x-only smear/erode)
      ExportService.ts          # Platform seam + createExportService() factory
      WebExportService.ts       # Web impl: fflate zip + browser download
      TauriExportService.ts     # Desktop impl: folder picker + FS write (lazy)
      exportNaming.ts           # Pure archive-name resolver (basename + sanitise; blank ⇒ auto name)
      ExportModal.tsx           # Scale-% + synthetic-style + archive-name modal (File → Export SVGs…)
    import/                      # SVG import — drops imported art (baked contours) on a new layer
      svgImport.ts              # DOM walk → flatten transforms + Y-flip + fill→paint (CSS cascade: style="" > embedded <style> simple-selector rules > attributes; opacity) + correctWinding → Contour[]
    preview/                     # Text-preview window: type a string, see it in the glyphs
      textLayout.ts             # Pure mono text layout (advances, blank gaps, \n breaks + optional maxWidth word-wrap)
      TextPreviewModal.tsx      # Modal renderer (reuses layerFills.glyphFillGroups, coloured). A Size slider (px/em) sets a FIXED glyph scale; text word-wraps to the measured stage width (ResizeObserver) and the stage scrolls — long text stays readable instead of shrinking to fit
    project/                     # Portable PROJECT file (whole document) — web ⇄ desktop
      ProjectIOService.ts       # Platform seam + createProjectIO() factory
      WebProjectIO.ts           # Web impl: Blob download + hidden file-input
      TauriProjectIO.ts         # Desktop impl: save/open dialog + FS (lazy, code-split). ⚠️ Desktop dialogs/FS need the Rust side wired: `src-tauri/Cargo.toml` + `lib.rs` register BOTH `tauri-plugin-fs` AND `tauri-plugin-dialog`, and `capabilities/default.json` grants `dialog:default` + BROAD `fs:allow-read/write-text-file` (`**`/`$HOME/**`) for user-PICKED files (project .glphdrft anywhere, SVG export folder) — distinct from the `$APPDATA/**`-scoped FS the autosave StorageService uses (which also needs `fs:allow-rename` for its atomic temp-file writes). (The dialog plugin was missing → import/export/SVG-export silently failed on desktop.) Hardening, NOT yet done because it needs a desktop test run: Tauri v2's dialog plugin already adds user-picked paths to the FS scope, so the `**` grant is likely narrowable.
      projectActions.ts         # serialize / applyImportedProject (reuses projectFile envelope + migrate) + replaceWorkspace (snapshots first) + listRecoveryPoints
      RecoverModal.tsx          # File → Restore previous version…: lists the recovery points (session start, previous session, before last import/restore); picking one goes through the same confirm + replaceWorkspace as an import, so a restore is itself reversible
    info/                        # Information top-bar menu
      InfoModal.tsx             # About / License / Legal / User guide in ONE modal with a sidebar;
                                 #   renders src/content/*.md (imported ?raw) via `marked`
  commands/                      # Command registry — the single source of actions + keybinds
    types.ts                     # Command, KeyChord
    registry.ts                  # COMMANDS[], matchKey(), commandMenuItems() (+ shortcut labels; `keepHidden` for the menu bar)
    useCommandKeys.ts            # The ONE global keyboard entry point
  components/
    controls/                    # Toggle, Slider, NumberInput, Knob (rotary angle picker), CollapseButton
    menu/                        # MenuBar, Menu, MenuItem (optional right-aligned `shortcut`), SubMenu (nested flyout: Settings → Theme) + ContextMenu (right-click, supports nested submenus — the open submenu is PORTALED to <body> at fixed coords so it escapes the list's vertical scroll container; an in-place left:100% flyout otherwise just made the menu scroll horizontally. The outside-pointerdown close-handler ignores clicks inside `.context-menu-root` OR a portaled `.context-menu-submenu` — else a submenu click closed the menu before its onSelect ran, e.g. "Move to layer" appeared to do nothing)
    SaveStatus.tsx               # Header autosave indicator (reads useSaveStatus) — SAVE state only
    NoticeBar.tsx                # Header line for file-operation notices (noticeStore) — a bad import file no longer reads as "Save failed"
    useEscapeKey.ts              # Capture-phase Esc-to-close for dialogs (stops the key reaching the canvas)
    ErrorBoundary.tsx            # Render-error boundary. ROOT (wraps <App/>): reload + "Export project file" rescue. SCOPED (fallback + resetKey):
                                 #   around the canvas glyph/onion/preview layer, each sidebar thumbnail, the text preview — one bad glyph
                                 #   degrades that view (canvas banner offers Undo/Retry). Deliberately NOT inside the shared fill
                                 #   pipeline: an export of a broken glyph must fail loudly, not write an SVG with geometry missing
  content/                       # Bundled Markdown for the Info modal (about/licence/legal/user-guide)
                                 #   — imported `?raw` (see vite-env.d.ts), rendered with `marked`
  utils/
    dom.ts                       # isEditable() — shared "is a text field focused?" guard
    id.ts                        # createId() — the id factory used across the geometry/state layers
  types/                         # document.ts, geometry.ts, viewport.ts
  constants/metrics.ts           # FontMetrics, DEFAULT_METRICS, emBox()
  styles/theme.css               # CSS-variable themes (dark/light/paper; "EDIT THEME COLOURS HERE" anchor); accent derives --accent-strong/-soft via color-mix so the Settings accent-colour override (App.tsx sets --accent inline on <html>) recolours everything
```

## Architectural Invariants — Never Break These

### 1. Coordinate System
- **World space:** font units, Y-up, baseline at `y = 0`, descenders negative
- **Screen space:** CSS px, Y-down
- The Y-flip (`-zoom` on the matrix `d` term) lives **only** in `engine/viewport/transform.ts`
- All anchor handles are stored as **absolute coordinates** — never relative

### 2. State Split
- `viewportStore` — camera, grid, theme. Never undoable. Never recorded.
- `documentStore` — glyph model. Plain serializable data only (no class instances). Undo/redo is **PER-GLYPH**, owned by `state/history.ts` (not zundo): a `Map<glyphId, {past, future}>` driven by one `documentStore.subscribe`. Ctrl+Z while viewing a glyph only ever changes THAT glyph (an undo can never silently revert an off-screen glyph). `useHistoryStore` exposes the same `undo`/`redo`/`clear`/`pastStates`/`futureStates` shape the call sites used (pastStates/futureStates are the ACTIVE glyph's stacks, so canUndo/canRedo are per active glyph). History is session-only, never serialized.
- `editorStore` — live per-frame state (pen pending point, shape draft, liveContours during drag). Never undoable. Cleared on commit or undo.
- One user action = exactly one Ctrl+Z step (one `set({glyphs})` per action = one per-glyph entry). Live geometry must not pollute the timeline.
  **Continuous controls** (Slider, Knob, NumberInput, the Color-panel colour inputs) commit on every input
  event, so they call `history.coalesceNextEdit(tag)` before each change: consecutive changes with the same
  tag on the same glyph, each ≤1 s apart, share ONE step. There is deliberately no begin/end pairing (a
  missed "end" would merge unrelated edits) — the tag is consumed by the next change and expires at the end
  of the task. A new continuous control that edits the document must tag its changes the same way.
- **Undo/redo are disabled while a drag preview is live** (`editorStore.liveContours !== null`): the gesture
  holds a pre-undo snapshot and would re-commit it on pointer-up.
- **Recording rule:** the history subscriber records per-glyph diffs **only when the glyph KEY SET is unchanged** (an edit). A changed key set is a STRUCTURAL op (`addGlyph`/`addGlyphs`/`deleteGlyph`/`loadGlyphs`) → **not recorded** (glyph create/delete are deliberately NOT undoable; delete is guarded by its confirm dialog). An `applying` re-entrancy flag keeps undo/redo from recording themselves.
- `activeGlyphId` / `activeLayerId` are in `documentStore` but the history only ever diffs `glyphs`, so active-pointer changes never create a step.
- **IMMUTABLE DATA (load-bearing — see Invariant 3's caches):** `Glyph`, `Layer`, `Contour`,
  and `AnchorPoint` are treated as **immutable**. Every edit **REPLACES** the object with a new
  one (a new identity) — `documentStore` always does `set({ glyphs: { ...s.glyphs, [id]: next } })`,
  store helpers clone-and-replace, and the per-glyph history snapshots assume this. **NEVER mutate a
  `Contour`/`Glyph`/etc. in place** (no `c.points.push(...)`, no `glyph.advanceWidth = …`).
  Identity therefore equals content, which both keeps undo correct AND lets the geometry layer
  cache by identity safely; an in-place mutation would silently corrupt a cache with no test
  failure.

### 3. Geometry as a Service (Not Data Model)
- Canonical glyph data stays plain Zustand state, rendered to native SVG. The geometry engine is never the source of truth.
- All heavy vector math goes through the `GeometryService` interface, obtained **only** via `getGeometryService()` in `geometryEngine.ts` — that one function is the swap point.
- `PaperGeometryService` (Paper.js) is the **live** implementation: curve-exact booleans. It is non-destructive at the call site too — the Pathfinder computes results at render/export time and never overwrites the source layers. Paper's own (Y-down) orientation is re-normalized to our convention via `winding.ts` `correctWinding` inside every op.
- `PolygonGeometryService` (the dependency-free planar-arrangement clipper, which flattens beziers to polylines) is kept for the **DOM-free unit tests**, which construct it directly rather than through the seam.
- Hand the service plain points, read plain points back — do **not** refactor the interface to fit any one engine. The swap is a one-line change in `geometryEngine.ts` with no ripple into stores or UI.
- **Identity-keyed memoization (relies on Invariant 2's immutability):** the heavy geometry is
  cached by INPUT IDENTITY, so unchanged data is never recomputed (notably per-frame during a
  drag, and per-keystroke in the text preview). `PaperGeometryService.expandStroke` memoizes per
  `Contour` (a `WeakMap`, validated by `stroke ===` so the same contour with a different stroke
  object recomputes); `layerFills.glyphFillGroups` memoizes per `Glyph` (a `WeakMap`). Inside the
  pipeline, `renderContours` memoizes per layer CONTOURS ARRAY (validated by baked/options/engine),
  which gives untouched layers stable output identities during a drag — so `cachedPairOp` (a
  Pathfinder boolean, keyed on the two rendered arrays + op) and `cachedBlend` (the blend steps,
  keyed on the operand arrays + step count) hit too. Before these, EVERY pair and blend re-ran on
  every drag frame whichever layer moved (a stroked 8-step blend: ~1 s per frame). The caches
  are **transparent** (identical outputs — proven by the geometry suites passing unchanged) and
  **self-evicting** (`WeakMap`s drop replaced objects). They are correct **only because** of the
  immutability rule: a changed object is a new identity = a cache miss; mutating in place would
  return stale geometry. Callers must treat cached outputs as read-only.

### 4. Winding Rules
- Outer contours: **clockwise** (in Y-up world space, CW = negative signed area via shoelace)
- Inner contours / holes: **counter-clockwise**
- `primitives.ts` always runs new closed shapes through `ensureWinding(_, "cw")`
- `GlyphView` fills closed contours as `<path fill-rule="nonzero">` so CCW holes punch through
- **Unstroked contours within a single layer never make a hole by winding** — `buildFillGroups` forces every *unstroked* closed contour to CW, so they fill as one **solid union** under nonzero. A hole legitimately appears three ways: (a) a **stroked path's expanded outline** (a closed stroked path becomes a frame with a CCW hole — `expandStroke` via `layerFills.ts`); (b) a between-layer **Subtract** (Invariant 5); and (c) a **baked contour** (`Contour.baked` — imported SVG, merged layers, expanded strokes), which `renderContour` emits **verbatim** (the deliberate exception to force-CW, so baked holes survive). All three carry CW-outer / CCW-hole winding; ordinary unstroked overlaps still never cancel.
- **`baked` is per CONTOUR (projectFile v9), not per layer.** The old `Layer.baked` rendered
  EVERYTHING on the layer verbatim — and Import SVG / Expand stroke / Merge make their new layer
  ACTIVE, so the next path an artist drew landed there and rendered wrong (stroke ignored, an open
  path filled); baked art pasted or moved elsewhere also lost its holes. Now the flag travels with
  the contour (paste, duplicate, move-to-layer, cut/split pieces, blend steps), and `markBaked`
  stamps it wherever finished outlines enter the document. `liftLayerBaked` (projectFile) converts
  older files on every load — immutably, because persistence promotes the validated raw value to
  the backup slot. (`FillLayer.baked` still exists, INTERNAL to the pipeline: the synthetic layer a
  render-as-one group collapses into.) A mirror (flip / negative scale) re-reverses a fully
  mirrored baked contour (`affine.transformSelected`), since its winding IS its holes.
- **Fill and stroke are INDEPENDENT (projectFile v7).** `renderContours` emits a contour's interior
  fill and its stroke outline **separately**, so a single closed path can have **both** a filled
  interior AND a stroke outline (two fill groups). Two optional, legacy-defaulted fields drive it:
  `Contour.filled?` (interior on/off; **undefined ⇒ the legacy rule** `closed && !stroke && paint.fill !== "none"`)
  and `StrokeStyle.color?` (outline colour; **undefined ⇒ legacy fallback to `Contour.paint`**). So with
  neither field set the output is **byte-identical** to the old if/else (`stroke` ⇒ outline-only,
  unstroked closed ⇒ solid fill) — fill+stroke together happens only when a user explicitly sets
  `filled: true`. The interior carries `paint`; the outline carries `{ fill: stroke.color } ?? paint`.
  Edited in the **Color panel** (`FillPanel.tsx`): a "Fill interior" toggle (`setContourFilled`) for the
  interior, and a "Stroke" section with a colour picker (`setStrokeColor` → `stroke.color`) **and a stroke
  Gradient** (`patchStrokeGradient` → `stroke.gradient`, a `GradientFill` — both applied only to contours that
  already have a stroke). The Stroke panel is **shape-only** (no colour). v6→v7 migration is the identity.
  **The legacy fallback must not leak:** a FILL edit (`patchContourPaint` / `setContourPaint`) first
  runs `engine/paint` `pinLegacyStrokePaint`, writing the outline's current colour onto a stroke that
  had none — so the outline keeps its look and only the interior changes (lossless; the one case
  left coupled is a semi-transparent legacy fill with no stroke gradient, since a stroke has no
  opacity field). **A black stroke colour is the DEFAULT INK** (`isDefaultInk`), like a black fill:
  it renders in the theme's ink on the canvas (it used to render as literal black — near-invisible
  on the dark theme); the export writes black either way.
- **Stroke gradient (`StrokeStyle.gradient`) + along-path (`GradientFill.alongPath`):** the stroke outline
  already renders as a fill group, so a stroke gradient REUSES the whole `Paint.gradient` pipeline —
  `renderContours`'s `strokeOutlinePaint` emits `{ fill: stroke.color ?? fallback, gradient }` and
  `linearGradientSpec`/`<linearGradient>` (canvas/preview/export) render it unchanged. With `alongPath` the
  fixed `angle` is replaced at render time by the contour's first→last node direction (`atan2(Δy,Δx)`, same
  convention as the fill knob), so the gradient runs start→end of the line (a directional approximation over
  the bbox, decorative — not curve-arc-length). `paintKey` now includes a gradient signature so a gradient
  region never merges with a same-colour flat one. Both fields additive/optional ⇒ old saves unchanged.
- Export is FontForge-compatible by **reusing** this pipeline, not by
  re-normalizing: `glyphToSvg` emits the exact winding `buildFillGroups` produced
  (solids all-CW; boolean results CW-outer / CCW-hole from the geometry service)
  under `fill-rule="nonzero"`, so the exported SVG matches the canvas. Running
  `correctWinding` again at export would punch holes into nested solid layers and
  diverge — so it deliberately does not.
- **Fill PAINT (colour) is orthogonal to winding** — `Contour.paint?` (`{ fill?, opacity? }`,
  optional; default = black ink) only changes the colour, never the winding. `buildFillGroups`
  groups a layer's contours **by paint** (same paint → one nonzero union as before; different
  paint → separate fill groups in paint order); `GlyphView`/`glyphToSvg` emit `fill`/`fill-opacity`
  from the group's paint, **defaulting to black**. ⚠️ **On the canvas, `GlyphView` MUST set a
  painted group's fill via inline `style`, NOT the `fill` attribute** — the `.glyph-fill` CSS rule
  (the faint edit-mode ink) overrides the `fill` *attribute* (presentation attrs are the weakest
  cascade layer), which silently swallowed paint colours. Export (`glyphToSvg`) emits a bare
  `fill="…"` attribute (no CSS, so it's fine). "Final" view adds `.glyph-view-final` → solid ink so
  it matches the export. Safety property: with NO paint anywhere the
  grouping yields exactly one black group per layer — byte-identical to the pre-paint pipeline,
  so colour is purely opt-in. Set via `documentStore.patchContourPaint` (a per-contour PATCH of only
  the named properties — editing Opacity on a red and a blue path keeps one red and one blue; the
  panel used to write the first path's whole paint to every path) or the whole-paint
  `setContourPaint` (cross-layer, one undo step either way). A **boolean-pair result inherits a paint from its operands** — the first non-default
  paint on operand **A** (the upper layer), else operand **B** (`firstPaint` in `layerFills.ts`);
  all-default operands stay paint-less (black), byte-identical to before. A **baked** contour renders
  its OWN paint verbatim — merge (`mergeLayers.ts`), SVG import (`svgImport.ts`), and
  expand-stroke (`editActions.ts`, via `renderContour`: the outline in the stroke's colour, plus the
  interior of a filled path) each carry per-contour paint onto the baked contours. A baked
  **boolean-pair** result keeps its inherited colour too: the pair's paint lives on the fill GROUP,
  so `bakeContours` stamps it onto the result contours (it used to drop it → black). (projectFile **v3** added
  the field; the v2→v3 migration is the identity. **v4** later added the per-contour `corner?` the
  same additive way — v3→v4 is also the identity. **v5** added the optional `Paint.gradient`
  (a two-stop linear gradient) the same additive way — v4→v5 is also the identity. **v6** added the
  `"blend"` pair op; **v7** added `Contour.filled?` + `StrokeStyle.color?` (independent fill & stroke)
  — both additive identities. **v9** moved `baked` from the layer to the contour — the first
  non-identity migration since v1→v2, see the per-contour `baked` bullet above.)
- **Gradient fill (additive on `Paint`):** an optional `Paint.gradient` (`GradientFill { angle, to,
  midpoint, fade, toOpacity? }`) fills a region with a two-stop linear gradient — stop 0 = the existing
  `fill` (default black), stop 1 = `to` (with optional `toOpacity` so it can fade toward transparent);
  `midpoint`/`fade` place & widen the transition band; `angle` is the direction. `toOpacity` is additive
  within the already-optional gradient (no migration; absent = opaque). The pure helper `features/canvas/fillPaint.ts` `linearGradientSpec(group)` turns it into
  `{ id, transform, stops }` (objectBoundingBox; the angle is negated for the world→SVG Y-flip; the id
  is sanitized so the painted-group id's `#`/`|` are safe inside `url(#…)`). The **same spec** drives
  all THREE colour renderers — `GlyphView` (canvas), `TextPreviewModal`, and `glyphToSvg` (export, a
  real `<defs><linearGradient>`) — so they can't drift; thumbnails stay monochrome silhouettes
  (gradient ignored, like solid paint). **Gradients are decorative** (canvas/preview/exported SVG) —
  NOT FontForge font-outline data; FontForge import flattens them. Edited in the FillPanel "Gradient"
  block (an angle `Knob` + `to` swatch + Blend/Fade sliders).

### 5. Layer Paint Order & Two-Layer Booleans (Pathfinder)
- `layers[]` array = **bottom-to-top paint order** (index 0 paints first); LayersPanel renders it reversed (Illustrator convention).
- Fill is built by `buildFillGroups` (`features/canvas/layerFills.ts`), not inline in the view. Each **unpaired** layer becomes one nonzero-fill compound `<path>`, all its contours forced CW → **solid union** (no within-layer holes).
- **The non-destructive Pathfinder is the sanctioned cross-layer combine.** An entry in `Glyph.booleanPairs` (a `BooleanPair`) joins **exactly two** layers with an op (`union`/`subtract`/`intersect`/`exclude`, or `blend` — the A→B morph echo, Phase M). At RENDER and EXPORT time (**never** in the data) `buildFillGroups` calls the geometry service on the two layers — **upper = operand A, lower = B** (Subtract = A − B) — emits one result group at the lower layer's paint position (inheriting A's paint, else B's), and suppresses both operands' own fills. Both layers stay separate and editable; moving either updates the result live. **Curves preserved** (Paper.js). A layer is in **at most one** pair (no entangled ops).
- So fill is per-layer **except** for an explicit boolean pair. Do **not** make ordinary layers' fills interact; only paired layers combine, and only through `buildFillGroups` (which Phase 6 export reuses via `glyphToSvg`, so the exported SVG carries the same results).
- Each operand layer is unioned ("fully rendered") before the op, so multi-contour layers don't glitch. Unlike the old cutter, a Subtract pair is a true boolean, so a B that **crosses** A's edge clips correctly (no overhang caveat).

### 5a. Two Selections (Phase 5)
There are **two independent selections**:
- **Layer selection** — `documentStore.selectedLayerIds` (always includes the active layer). Plain-click a panel row = select only it; **Ctrl/Cmd+click toggles** layers in/out (`toggleLayerSelection`); **Shift+click selects the inclusive range** from the active anchor to the clicked row (`selectLayerRange`, anchor stays active). Not undoable; pruned in `reconcileActive`; reset to the active layer on any plain activation / glyph switch. **The Pathfinder uses this:** when exactly two layers are selected, the Pathfinder bar offers the four ops on that pair. (The resulting pair itself is stored in `Glyph.booleanPairs`, not in the selection.)
- **Anchor selection** — `editorStore.selection`, layer-aware `PointRef[]` (`{ layerId, contourId, pointId }`, `sameRef` compares all three). Drives **node editing**, and is **decoupled from the layer selection** (Illustrator-style): every selection op — single click (`hitTestLayers`), select-all (Ctrl+A), lasso, and marquee — works over **ALL visible + unlocked layers** (`editableLayers` in `tools/shared.ts`), regardless of which layer rows are in `selectedLayerIds` (that set only drives the Pathfinder). `EditOverlay` shows anchors for every editable layer (non-active dimmed). A node DRAG (select tool or lasso) now moves the **whole cross-layer selection** in one undo step (`originForRefs` + `replaceContoursEverywhere`); transform box / nudge / flip / align act cross-layer too. Clicking an anchor still activates its layer so NEW geometry lands there. The **LayersPanel tints every layer owning a selected node** (`.layer-row-involved`, a faint cue derived from `selection`'s `layerId`s) — deliberately weaker than the active/selected row styling, so the user sees which layers a cross-layer edit will touch without it competing with the Pathfinder selection.

### 5b. Layer Groups (projectFile v8)
- `glyph.layers` stays **FLAT** (paint order). Groups live beside it in `glyph.layerGroups`, nested via
  `LayerGroup.parentId`; `features/layers/layerTree.ts` is the ONE definition of the tree (rows, ranges,
  inherited visibility/lock). **CONTIGUITY:** a group's members are an unbroken run of `glyph.layers` —
  every insert/move/merge must keep it (merge: the merged layer takes the LOWEST merged layer's slot
  AND group).
- **Locks/visibility are inherited**: use `effectiveLocked`/`effectiveVisible` (or `resolvedLayers`),
  never a layer's own `locked`/`visible` alone — a raw check lets an edit reach into a locked group.
- **`renderAsOne` is OPT-IN** (new groups are organisation-only): it bakes the members into ONE fill
  region (`flattenRenderGroups` → `bakeContours`), which orders mixed colours by paint (the single-layer
  rule) and makes a pair with one operand inside the group dormant. Making a group a Pathfinder operand
  turns it on (`setBooleanPair`), and it can't be turned off while the pair exists.
- The group **bake cache** (`cachedBake`) keys on the member contour arrays AND a signature of member
  ids + inner pairs (op/steps) + the geometry service (the members' own baked contours are part of
  the contour arrays); the canvas keeps unchanged layers' contour arrays identical during a drag
  (`withOverrides`) so it actually hits.

### 6. Storage
- All feature code talks only to `StorageService` KV interface
- `TauriStorage` is always lazy-imported and code-split — the web build must never bundle it
- Bulk file export (`u_xxxx.svg`) is not a KV operation — it has its own
  `ExportService` seam (`features/export/`, resolved by `createExportService()`),
  separate from `StorageService`. Like `TauriStorage`, the Tauri export impl is
  lazy-imported/code-split so the web build never bundles `@tauri-apps`.

### 7. Persistence (Save) — versioned, autosave, corruption-safe
- **One auto-persisted workspace** = the whole document (`documentStore.glyphs`).
  Persisted to the `StorageService` KV under `glyphdraft:project`; **never** mixed
  with preferences (those live under their own key — see below).
- **Preferences persist separately** under `glyphdraft:settings`
  (`storage/settingsFile.ts` + `state/settings.ts`, **v7**): viewport (theme/grid/
  polygonSides/deleteSplits/mergeEndpoints/**mergeHalftones**/**alignMode**/**guides**/**accentColor**), onion
  (enabled/opacity), keybindings (v2+), stroke presets (v3+), **colour palettes**
  (`colorPalettes`, v5+ — `colorPaletteStore`, the saved-swatch sibling of the brush
  preset library), **mergeHalftones** (v6+), and the **accent-colour override**
  (`accentColor`, v7+). **NOT** the
  camera (zoom/pan — refit on launch), ephemeral `editorStore` state, or onion
  `referenceIds` (would dangle across documents). Its own versioned envelope +
  `migrateSettings` returns a sanitized **partial** that `mergeSettings` layers over
  the live stores' defaults, so a missing/corrupt blob just yields defaults (the app
  always launches; the bad blob is parked under `…settings.corrupt`). Future
  preferences (keybinding overrides, language) are additive fields + a version bump.
  Separate key ⇒ preferences can never affect document safety.
- **Versioned format is mandatory** — `storage/projectFile.ts` wraps glyphs in
  `{ version, savedAt, glyphs }`. `migrate(raw)` is the **forward-compat seam**:
  it validates shape and returns `null` (never throws) on corrupt/unknown data.
  **New model fields (e.g. the future non-destructive `stroke?`) ship as a
  `version` bump + a `vN→vN+1` migration, not a format rewrite.** Keep new fields
  **optional** so old saves load untouched.
  > **CURRENT persisted formats: projectFile = `v9`, settings = `v7`** (the source of truth is
  > `CURRENT_VERSION` in `projectFile.ts` / `SETTINGS_VERSION` in `settingsFile.ts`). Throughout this
  > doc each field is annotated with the version it was **added in** (e.g. "projectFile v6 added blend");
  > those are history, not the latest. projectFile **v8** added layer groups (`Layer.groupId` +
  > `Glyph.layerGroups`, additive; v7→v8 is the identity — see 5b). **v9** moved `baked` from the
  > layer to each contour (`liftLayerBaked`, applied on every load and immutable — see Invariant 4).
  > As with every bump, an OLDER build rejects a v9 file (it falls back to its backup), so keep
  > desktop and web builds in step when sharing a project.
  > Below the top-level checks (which decide reject vs accept), `migrate` runs **`sanitizeGlyph`**
  > (`storage/sanitize.ts`): a structural REPAIR of anything that would throw while rendering (a layer
  > without `contours`, a pair op the engine doesn't know, a point without finite x/y …). It **repairs,
  > never rejects** — a rejected main falls back to the backup and is parked, which for a healthy-but-
  > unusual save would look like data loss — and returns a healthy document as the SAME object.
- **`state/persistence.ts` owns the lifecycle** (not the stores): `initPersistence()`
  (idempotent — StrictMode's double effect shares one run) loads on launch, then starts a
  **debounced autosave** on every `glyphs` change, flushed when the page is hidden.
  `saveNow()` (File → Save / Ctrl-Cmd+S) writes immediately. Status flows through the
  `useSaveStatus` store → `SaveStatus` (states incl. **`paused`** = saving deliberately refused).
  Load treats each slot (main, then `…bak`) by what went wrong — they need OPPOSITE handling:
  - **missing** → nothing to lose: try the backup, else the in-memory seed.
  - **invalid** (readable but unusable: corrupt shape, unknown version, or a `CorruptValueError` —
    an undecodable value such as a half-written file) → **park** it under `…corrupt` (a second one goes
    to `…corrupt.<ts>`, never over the first), then use the backup.
  - **unreadable** (the read itself threw an I/O error, after 3 attempts) → the data may be fine, so
    **autosave is paused** (`blockSaving`) — writing would replace the real document with whatever is
    on screen. The backup is shown if readable. Reload retries.
  Writes are **serialized** (a promise queue — autosave and Ctrl+S never interleave) and
  **double-buffer**: the current main is promoted to the backup **only if it is itself a valid
  project**, so a corrupt main can never overwrite a good backup. On desktop each `setItem` is
  additionally **atomic** (`TauriStorage`: write `<key>.json.tmp`, then `rename` over the target; falls
  back to a direct write if the rename is refused, so saving never breaks). A tab that can't claim the
  workspace Web Lock (`tabLock.ts`) loads but never saves. "Import project…" confirms first and
  snapshots the replaced workspace under `PREIMPORT_KEY` (outside the autosave rotation).
  **Recovery points.** The backup slot is only the previous save (~a second old), so it guards
  against a torn write, not a mistake — a non-undoable glyph delete reaches both slots within a
  second. So each launch also keeps the loaded workspace under `SESSION_KEY`, rotating the last
  launch's to `SESSION_PREV_KEY` (queued through the write chain; skipped when saving is blocked or
  another tab owns the workspace). **File → Restore previous version…** (`RecoverModal`) offers the
  valid ones plus the pre-import snapshot; a restore goes through the import's confirm +
  `replaceWorkspace`, which snapshots the current workspace first — so a restore is reversible.
  File-operation errors (bad import file, unreadable SVG, failed project export) go to the header
  **notice** (`noticeStore`/`NoticeBar`), never to the save status.
- **A load is not an undo step:** restore via `documentStore.loadGlyphs` (which
  reuses `reconcileActive`), then `useHistoryStore.getState().clear()`
  so the restored document is the history baseline. (loadGlyphs changes the key set, so
  the history subscriber skips it anyway; the explicit clear resets every per-glyph stack.)

### 8. Commands & Keybindings — one registry, one keyboard entry point
- **`src/commands/registry.ts` `COMMANDS[]` is the single source of truth** for
  named actions (undo/redo, clipboard, select-all, save, delete) and their default
  keybindings. **Do not** hardcode shortcuts in components or add a second keyboard
  listener — add a `Command` instead. Tool-switch commands are **generated from
  `TOOLS`**, so the Phase 2 "add a `ToolDefinition` → free shortcut" promise still
  holds through this one path (don't reintroduce a parallel shortcut map).
- **`useCommandKeys` (mounted once in `App`) is the ONE global keydown handler:**
  `isEditable` guard → `matchKey(e)` → `run()`. The canvas tool controller keeps
  **only** the tool-delegated keys **Esc/Enter** (e.g. the pen finishing a path).
  These two listeners must never bind the same key — modifier matching in
  `matchKey` is exact, so plain `v` (select tool) ≠ Ctrl+V (paste).
- **Right-click menus are views over the registry**, not new logic: `ContextMenu`
  (`components/menu/`) takes plain items; the canvas builds them from command ids
  via `commandMenuItems`, the Layers panel builds layer-targeted ones inline
  (layer ops are parameterized by the clicked layer, so they don't fit the
  parameter-free `Command`).
- **Rebinding (shipped):** `state/keybindingStore.ts` holds user overrides keyed by
  command id; `effectiveKeys(cmd) = overrides[id] ?? defaultKeys` is the ONE
  resolution point (`matchKey` and the editor both use it). The editor
  (`features/settings/KeybindingsModal.tsx`) captures a chord with the global handler
  suspended (`keybindingStore.capturing` → `useCommandKeys` stands down), reassigns
  conflicts so chords stay unique, and persists via the settings v2 `keybindings`
  field. Esc/Enter stay tool-delegated and are never bindable.

## Implementation Phases

### Completed

**Phase 1 — Foundation**
Canvas viewport, pan/zoom (Space+drag, middle-drag, Ctrl+wheel to cursor), em-square, adjustable grid, snap-to-grid toggle, dark/light theme, `viewportStore`, `documentStore` skeleton with undo/redo history (originally global zundo; **later replaced by the per-glyph `state/history.ts`** — see Invariant 2), storage abstraction.

**Phase 2 — Drawing Tools**
Pen tool (click = corner, click-drag = smooth mirrored handles, close on start point, Esc/Enter to finish), rectangle, ellipse, line. Winding engine, path/primitive engine. Tool registry (add a `ToolDefinition` → toolbar button + shortcut + routing for free; an optional contextual options panel comes via the view-layer `TOOL_PANELS` map in `ToolPanel.tsx`, keyed by `ToolId` like the Toolbar `ICONS` — `ToolDefinition` stays React-free). `usePanZoom` owns Space/middle+wheel; `useToolController` owns left-button-no-Space — they cannot collide.

**Phase 3 — Layers & Clipboard**
Layer model (lock, hide, rename, reorder, add, duplicate, delete — minimum 1 layer always). `LayersPanel` HUD (bottom-right). Clipboard with true paste-in-place (absolute coords preserved; works across glyphs). Ctrl/Cmd+C/X/V/A. Cut = copy + delete. Paste switches to select tool and selects result.

**Phase 4 — Glyph Management & Onion Skinning**
Glyph sidebar (left, code-point sorted). `addGlyph(codepoint)` enforces one glyph per code point. `deleteGlyph` always keeps at least one, reassigns active to next/previous. `GlyphThumbnail` uses same Y-flip as canvas, and renders through **`glyphFillGroups`** — the canonical per-glyph fill builder shared by the export (`glyphToSvg`) and the text-preview window (so thumbnails match the canvas, incl. **baked** layers; routing it through the shared builder fixed an earlier bug where the thumbnail dropped the `baked` flag). `onionStore` (non-undoable): enabled, opacity, referenceIds, **renderSvg**. Ghosts render behind active glyph in shared coordinate space, in blue-grey (not ember accent). Deleted glyph auto-removed from references. **Two onion-skin modes** (View → "Onion skin: rendered output", `onionStore.renderSvg`, persisted): the raw contour skeleton (default — naive nonzero fill + outline), or the **true rendered output** (expanded strokes/booleans/baked layers) via `glyphFillGroups` as a monochrome silhouette — the same builder `GlyphThumbnail`/export use.

**Glyph set templates + delete (later addition):** a top-bar **Glyphs menu** adds a run of code points via `documentStore.addGlyphs(codepoints[])` (skips existing → idempotent; keeps the active glyph). The four sets live in `features/glyphs/glyphSets.ts` (English, Scandinavian extras, digits & math, keyboard symbols incl. Swedish). **Right-click a glyph cell → "Delete glyph"** (a `ContextMenu` hosted by `GlyphSidebar`) opens a **confirm dialog** before calling the existing `deleteGlyph` (which keeps ≥1) — disabled on the last glyph. **(Per-glyph history: glyph create/delete are structural ⇒ NOT undoable via Ctrl+Z — the confirm dialog is the safety net for delete.)**

**Phase 5 — Non-Destructive Pathfinder between Two Layers**

A live, **curve-exact**, **non-destructive** boolean between **exactly two layers**. Ctrl/Cmd+click two layer rows → the **Pathfinder bar** appears → pick **Union / Subtract / Intersect / Exclude**. The **upper** layer is operand **A**, the **lower** is **B** (Subtract = A − B). The result renders live; **both source layers stay separate and fully editable** — move/reshape either and it updates instantly. A layer is in **at most one** pair (no entangled ops). The Subtract case covers wishlist #17 (the old "transparent hole" — now a real boolean, so a B that crosses A's edge clips correctly). The earlier *destructive* Pathfinder (consumed layers) and the interim *cutter* toggle were both replaced by this one unified model.

- **Data:** `Glyph.booleanPairs` (`BooleanPair { id, layerIds: [a, b], op }`). Set via `documentStore.setBooleanPair` (exclusive: re-pairing a layer drops its old pair) / `clearBooleanPair`; pruned when a member layer is deleted. One undo step. Geometry is **never** mutated — results are render/export-time only.
- **Render:** `buildFillGroups` (`features/canvas/layerFills.ts`) calls the geometry service for paired layers (upper = A, lower = B), emits one result group at the lower layer's position, and forces each unpaired layer to a solid union. `GlyphView` memoizes the build over layers + pairs and draws each operand's outline **dashed in the accent**. **Phase 6 export reuses `buildFillGroups`** (via `glyphToSvg`) so exported SVGs carry the same results.
- **Engine:** `PaperGeometryService` (Paper.js) — curve-exact. Each operand layer is unioned ("fully rendered") before the op so complex layers don't glitch.

**Carried over / still here:**
- `PolygonGeometryService` (`engine/geometry/PolygonGeometryService.ts`, built on the `clip.ts` planar-arrangement clipper) stays behind `GeometryService` for the **DOM-free unit tests** (injected directly); the live seam points at Paper.
- Layer multi-select (`selectedLayerIds`, Ctrl/Cmd+click — now the Pathfinder's operand picker) and cross-layer anchor selection (`PointRef.layerId`, see 5a) remain.

**Notes / caveats:**
- Simultaneous multi-layer NODE editing is **shipped** — a node drag (select tool or lasso) moves the whole cross-layer selection in one undo step (`originForRefs` + `replaceContoursEverywhere`); transform box / nudge / flip / align act cross-layer too (see Invariant 5a). Clicking an anchor still activates its layer so NEW geometry lands there.
- Pathfinder UI behavior (bar, pair badge, live result render) is covered by typecheck + unit tests (`layerFills.test.ts`, `PaperGeometryService.test.ts`, `documentStore.test.ts`) + build, **not** by an automated interaction test — verify in-app when touching `layerFills.ts`, `GlyphView`, `LayersPanel`, or `LayerRow`.

**Phase 6 — Export**

Bulk export of **every** glyph as an individual `u_xxxx.svg` (lowercase hex, no
`+` — via `exportFileName` in `glyphHelpers.ts`), triggered from **File →
Export SVGs…** in the header menu bar. The modal offers a **universal scale %** applied
on export. Desktop writes the files to a picked folder (Tauri dialog + FS,
lazy-loaded); web downloads a single zip (`fflate`).

- **SVG builder:** `glyphToSvg` (`features/export/glyphToSvg.ts`) reuses
  `buildFillGroups` so the export carries the same Pathfinder results as the
  canvas (Invariant 5). It Y-flips world→SVG via one wrapping `<g transform>` and
  frames the `viewBox` to the **union** of the em box (descender..ascender by the
  glyph's advance width) and the artwork's own bounds, in unscaled font units — so
  the metric frame gives every glyph a shared baseline/sidebearings, overflowing
  artwork is never clipped, and the scale % resizes only the artwork. The optional
  **`tightCrop`** flag frames the **artwork alone** instead (em box dropped; falls
  back to the em box on an empty glyph, and never emits a 0-size axis) — for artwork
  use, since per-glyph cropping gives up the shared metrics a font import needs.
  Artwork bounds are measured on the CURVES (`align.ts` `contourTightBounds` →
  `path.ts` `cubicBounds`, exact bezier extrema), not on the control handles, so a
  tight crop has no slack. Winding is preserved from the pipeline, not re-normalized
  (see Invariant 4).
- **Platform seam:** `ExportService` + `createExportService()` branch on
  `isTauri()` to `WebExportService` (zip) or `TauriExportService` (folder write),
  the Tauri impl dynamically imported so the web bundle stays `@tauri-apps`-free.
- **UI:** the header is a `MenuBar` (`components/menu/`) — File → Export SVGs…,
  Settings → Theme — with `ExportModal` mounted at the app root.
- **Tested:** `glyphToSvg.test.ts` (viewBox/Y-flip/scale/hidden-layer/Subtract
  hole) + `exportFileName` cases. Modal/menu interaction is verified in-app.

**Phase 7 — Non-Destructive Per-Path Strokes**

> ⚠️ **SUPERSEDED IN PART — read "Strokes — current state" (below) FIRST.** The paragraph that
> follows is the Phase-7 *historical* record. The serif, drop, brush and cap specifics have all
> evolved past it (drop is an ink-pool, not a bolted-on bulb; serif is built into the sampled
> outline; the brush/halftone/dash models and the A/B cap variants arrived later). Trust the
> current-state block wherever the two disagree.

A path keeps its editable centerline; an optional `Contour.stroke` (`StrokeStyle`)
is expanded to a filled outline at render/export. `StrokePanel` edits it per
selected path. Kinds: **uniform** (a SWEPT round-brush outline — `sweptUniform`:
the sampled ribbon + an explicit round/miter/bevel join unioned at each corner;
replaced `paperjs-offset` — since removed as a dependency — which glitched on thick + sharp strokes and skewed the
butt cap), **broad-nib** (`angle`+`contrast` → calligraphic sweep, sampled), plus
per-end caps **butt/round/rectangle/serif/drop** (independent `startCap`/`endCap`,
with a swap), **serif** feet (`SerifStyle`), **drop** terminals (`DropStyle`), and
the parametric **rectangle** cap (`RectCapStyle`). Expansion lives in
`PaperGeometryService.expandStroke`; self-overlaps are dissolved by `solidify`
(self-union) so sharp curves don't punch a spurious "exclude" hole. The swept model
flattens curves (denser output) but is glitch-proof and gives a clean butt edge ⟂
the terminal tangent. Reused by `buildFillGroups` → canvas, thumbnails, export.
Tested in `strokeOutline.test.ts`.

**Cap/serif hardening (additive — see the stroke types in `types/geometry.ts`):**
- **`rectangle` cap** replaced the old fixed `square`. Its FAR edge sits ON the node
  and the box grows INWARD (`RectCapStyle { size, ratio, angle?, radius? }`; built by
  `rectCap` in `PaperGeometryService.ts`). The rename ships with a `projectFile`
  v1→v2 migration (`migrateSquareCaps`) that rewrites `square`→`rectangle` and
  backfills a style reproducing the old footprint — old saves load unchanged.
- **`angle` is WORLD-ABSOLUTE** (degrees from the canvas X axis) for BOTH the
  rectangle cap and the serif foot. It is the cap/foot's **AXIS (point-handle)
  direction**: the WHOLE cap rotates rigidly about the node and the flat far edge
  stays ⟂ to that axis, so the flat side tracks the canvas regardless of stem
  direction. `angle` is **optional** — undefined = **auto (axis along the path
  tangent = perpendicular flat edge)**, the default, so existing/migrated caps &
  serifs are unchanged. The cap extrudes along the axis but ALWAYS toward the stroke
  (the inward sign is taken from the tangent) so it can never detach into a floating
  box. (The serif foot is now built **into the outline** — see "Strokes — current
  state" below; the old unioned `serifFootSlab` was removed.)
- **Serif** also carries `anchor` (`"outward"` legacy box past the terminal vs
  `"node"` = far edge stays on the node, box grows inward) and `bias` in [-1,1]
  (foot asymmetry; ±1 = the foot collapses to the stem on one side, for beak/wedge
  terminals). These flow through a left/right split in `sampledOutline` (independent
  `leftWidthAt`/`rightWidthAt`); at bias=0 the math reduces EXACTLY to the symmetric
  foot.
- **Stroke preset library** (`state/strokePresetStore.ts`): user-saved `StrokePreset`
  styles, the user-managed sibling of the read-only built-ins in `brushPresets.ts`.
  Fully managed INLINE in `StrokePanel` — apply (Brush dropdown), save (upsert by
  name via `upsertPreset` — re-saving a name overwrites, no duplicates), rename,
  update-style, and delete on the selected user preset. Persisted in the **settings
  v3** `strokePresets` field (same additive pattern as the v2 `keybindings`),
  separate from the document.

- **Width & angle PROFILES** (the graph editor): optional `widthProfile`/
  `angleProfile` (`StrokeProfile = { points: ProfilePoint[]; loop? }`) on
  `StrokeStyle` let the thickness (% of width) and nib angle vary along the path. A
  present profile routes the stroke through the **sampled** outline (not curve-exact)
  — `baseHalf` reads `evalProfile` per arc-length sample. Closed paths build a proper
  **annulus** (`sampledOutline` closed branch: outer + reversed inner compound; skip
  `solidify` which would dissolve the hole). The pure evaluator is
  `engine/geometry/profile.ts` (`evalProfile`, monotone-cubic, no overshoot), reused
  by the engine AND the `GraphEditor` (`features/canvas/GraphEditor.tsx`) — an SVG
  control-point editor (drag/add/remove, Loop toggle) in the Stroke panel that
  commits once per drag. Additive optional fields ⇒ no migration; profiles ride on
  `StrokeStyle`, so the cross-layer `setContourStroke` and presets carry them.

**Strokes — current state (supersedes the paragraphs above where they differ):**
- **Drop = a teardrop INK-POOL**, not a bulb: the stroke's OWN outline swells from the
  stem up to a pool of radius `DropStyle.size` over a reach (`ratio`), then a TANGENT
  round cap of that radius closes it — seamless (no unioned bulb). `smear` leans the pool.
  `dropTip` was removed; the swell rides `leftWidthAt`/`rightWidthAt` like the serif.
- **Serif = a seamless bracketed foot**: a concave **bracket** fillet (`SerifStyle.bracket`,
  `bracketEase`) flares the stem into a flat foot — built INTO the sampled outline. A
  world-absolute foot `angle` is realized by extending the sample centerline along that
  axis (so the flat terminal edge comes out angled); the old `serifFootSlab` union is gone.
- **Brush-sweep model** (`StrokeStyle.model: "offset" | "brush" | "halftone" | "dash"`): `"brush"` is a true
  Minkowski-style swept-brush envelope — stamps a brush along the path and unions it, so thick + sharp
  strokes read as pen-DRAWN and can't glitch. Opt-in; default `"offset"`. **Two builders:** a **NIB** brush
  (panel `angle`/`angleProfile`) uses `sweptBrush` (pen-edge cross-section quads + dot discs). A pure **ROUND**
  brush uses **`sweptRound`** — per centerline SEGMENT a trapezoid aligned to THAT segment's own direction
  (exact straight edges, no scalloping) + a disc at every joint/corner (rounds it). This is notch-free **by
  construction**: the older per-sample perpendicular-quad approach mis-oriented the cross-section at a hard
  corner's ambiguous tangent and left a reflex "disc–notch–notch" sliver at EVERY corner of triangles/
  rectangles (an earlier "disc on the vertex" patch did NOT fix it). Curves are subdivided; straight curves
  stay whole; open terminals are left flat for the cap pass. Guarded by an outer-ring **convexity** test
  (`outerConcavities` in `strokeOutline.test.ts`, = 0 for triangles/rects, thick & thin).
- **Halftone model** (`model: "halftone"`, EXPERIMENTAL — `HalftoneStyle {cell,size,angle,shape,contrast?,pattern?}`):
  fills the swept-uniform body with a rotated grid of shapes (circle/square/diamond/**triangle**/line/**svg**),
  each sized by its distance to the centerline — full `size` on the centerline → 0 at the edge (a tonal
  gradient shaped by **`contrast`**: `gamma = 4^((contrast−0.5)·2)`, 0.5 = linear) — clipped to the body.
  `shape:"svg"` stamps an imported **`pattern`** (a `Contour[]` normalized to a unit box by
  `svgImport.normalizePattern`, cached to a Paper compound per identity, cloned+scaled per cell; imported via
  the StrokePanel button reusing `importSvg`; lower `HALFTONE_MAX_CELLS_SVG` cap). **OPEN** contour → the swept
  ribbon + a **round-cap disc** at a `round`-capped end (butt = flat; serif/drop/rect → butt; full cap
  integration deferred). **CLOSED** contour → fills the **INTERIOR** (not a ring), size fading from deep inside
  to the boundary (`r = width/2` = fade depth) via `body.contains` + distance-to-edge. Built by `halftoneStroke`
  as a **top-level early return** in `expandStroke` (fully isolated — offset/brush/serif/drop/profile code is
  unreachable for it and untouched; caps are simple disc-unions, NOT `withCap`). Many CW dots that inherit the
  contour's `paint`; `HALFTONE_MAX_CELLS` guard. All additive optional fields ⇒ no migration. Set in the
  StrokePanel "Model" select + "Halftone" block (caps via the normal Caps & ends section).
- **Dash model** (`model: "dash"`, EXPERIMENTAL — `DashStyle {shape:"dash"|"dot"|"svg", dash, gap, size?, sizeProfile?, align?, angle?, pattern?}`):
  breaks the line into repeated elements along its **arc length** — `"dash"` blocks (stroke-width thick, sampled
  via Paper `getPointAt`/`getNormalAt` so they FOLLOW curves), `"dot"` circles (`size` diameter, default = width),
  or a custom **`"svg"`** `pattern` (a `Contour[]` normalized to a unit box by `svgImport.normalizePattern`,
  reusing `halftonePatternPath`) **scaled to `size` + rotated to the tangent + stamped** every step — all
  separated by `gap`. A **`sizeProfile`** (`StrokeProfile`, reusing `evalProfile` + the `GraphEditor`) scales
  each element's size by its arc-length position (dash thickness tapers per-sample; dot/svg grow/shrink).
  **`align`** (default true) makes elements follow the tangent (dash = ribbon ALONG the path; svg = rotated to
  it); **`align:false`** turns a dash into a perpendicular **railroad TICK** (`tangent+90+angle`, `dash` = tick
  length) and sits an svg at a fixed angle (`(align?tangent:0)+angle`). Built by `dashStroke` as another
  **top-level early return** in `expandStroke` (fully isolated, exactly like halftone — offset/brush/serif/profile
  code is unreachable for it; caps/serifs N/A). Returns CW solids that inherit the contour's `paint`;
  `MAX_DASH_ELEMENTS`(/`_SVG`) guard; svg-without-a-pattern falls back to a dot. The elements are
  **`solidify`d (self-union) before `normalize`** — like halftone's `intersect(body)` — so OVERLAPPING
  elements merge to solid instead of nesting-based `correctWinding` mislabelling an intersecting sibling
  as a hole (that caused an "exclusion"/XOR where elements crossed); genuine SVG-pattern holes survive. All
  additive optional fields ⇒ no migration. Set in the StrokePanel "Model" select + "Dash / dot" block (Shape,
  size/gap, "Import SVG…", **Follow-path** toggle + Angle slider, **Size profile** graph).
  - **Merge halftones (combined field):** a global persisted toggle (Settings → "Merge halftone strokes
    per layer", `viewportStore.mergeHalftones`, **settings v6**) makes **same-style** halftone paths in
    one layer render as ONE continuous halftone. `layerFills.renderContours` (gated, default-off ⇒
    byte-identical) buckets a layer's halftone contours by `halftoneKey` (stroke body fields + halftone
    params + paint) and renders each bucket of ≥2 via a new seam method `GeometryService.expandHalftoneGroup`
    → `PaperGeometryService.halftoneGroup`: UNION the bodies, then ONE `halftoneFill` over the merged
    region (body-distance falloff) so abutting paths read as one tone with no seam. The flag threads
    through `buildFillGroups`/`glyphFillGroups` (cache keyed by it) to canvas/thumbnail/preview/export/merge;
    lone or differing-style halftones are unchanged. The single-path `halftoneStroke` is untouched.
    **Render switches travel as a `RenderOptions` object** (`layerFills.ts`), threaded
    `glyphToSvg` → `glyphFillGroups` → `buildFillGroups` → `renderContours`; the export adds its own
    knobs via `GlyphSvgOptions extends RenderOptions`. Adding a new global render switch = a field on
    that interface plus a case in `renderKey` (which keys the per-options glyph cache) — **never**
    another positional boolean. This replaced positional flags after `glyphToSvg` reached six params
    ending in two adjacent booleans (`mergeHalftones`, `silhouette`), where a swap type-checks silently.
- **Terminal-handle cap angle** (the deferred Stage-5 feature, now shipped): the first
  node's `handleIn` / last node's `handleOut` are read as the cap **axis** — butt caps
  re-cut along it (`angledTerminal`), rectangle/serif take it as their `angle` when no
  panel angle is set. Driven by the existing handle-drag; collapse-to-corner = "auto". Note the
  pen's click-drag leaves such a handle (collinear) on every smooth end, so this path runs for
  most pen-drawn strokes with butt caps. ⚠️ **Terminal cuts must stay LOCAL** (`cutPastPlane`):
  they remove only the pieces of `body ∩ half-plane` attached at the terminal. A bare
  half-plane subtract deleted every part of a CURVING stroke lying in front of its own end — a
  pen-drawn S with butt caps kept ~2% of its area. When every piece is local (all straight
  stems) it performs the original subtract, so those outputs are byte-identical.
- **Rectangle cap `anchor`** (`"node"` default / `"outward"`): the box can grow inward or
  project past the node. The `square`→`rectangle` v1→v2 migration still applies.
- **Per-end cap A/B algorithm variants** (`RectCapStyle`/`SerifStyle`/`DropStyle` each carry an
  optional `variant?: "a" | "b"`; absent = `"a"` = the prior look, so **NO migration** — same
  additive pattern as the profiles). A small per-end "Variant" `<select>` in `StrokePanel`'s
  `EndControls` picks it. The B paths are **isolated constructive functions** (unioned/cut in the
  finishing pass) that do **not** touch the sampled-outline machinery, so the A paths can't regress:
  - **Rectangle A (rewritten):** `withCap` now unions `rectCap` then **slices off any body past the
    far-edge plane** (`rectFarPlane` → `cutPastPlane`, ⟂ the cap axis, LOCAL to the terminal) — so a
    tilted/narrow slab can't leave the stem's butt corners sticking out (the old union-box bug).
    Auto (far edge ⟂ tangent on the node) cuts nothing ⇒ byte-identical to before. **Rectangle B:** `rectFlareB` — a SEAMLESS constructive flare
    (concave sides easing the stem to the slab), graceful on curved/angled stems, with a user
    **`reach`** (how far up the stem the flare runs).
  - **Serif A** and **Serif B** BOTH build the foot INTO the sampled width-flare body (seamless by
    construction — no union, so there is no overlap seam). Two differences: (1) **SHAPE** — A is the
    concave **bracket** fillet (`bracketEase`: cups into the stem, tangent at the top); **B is a WEDGE**
    (`wedgeEase`: straight diagonal sides at flare=0 → convex flare as `bracket`→1, meeting the stem at a
    deliberate ANGLE — that crease is the wedge look, NOT a seam). The variant just picks the easing
    (`footEaseStart`/`footEaseEnd`) inside `footStartTarget`/`footEndTarget`; the `bracket` field is
    reused (panel labels it **"Flare"** for B). (2) **ANGLE** — A honors a world/handle foot `angle`
    (extends the sample centerline along that axis — can kink at extreme angles on a curved stem); **B is
    TANGENT-ONLY** (`startFootAngle`/`endFootAngle` = `null`), so it can't kink/notch on a curved/steep
    stem. The handle-axis injection (`startSerifS`/`endSerifS`) is variant-a only; the panel hides the
    angle control for B. (The old `serifFootB` constructive-hull union was removed — it was the seam.)
  - **Drop A** is unchanged (round ink-pool dome). **Drop B:** a SEAMLESS necked-bulb teardrop built
    from the body OUTLINE itself — a centerline extension past the node + a necked width profile (stem
    → concave neck pinch to `DropStyle.neck` → round bulb → soft point); **no unioned cap** (the old
    `ogiveCap` looked pasted-on and was removed). `ratio` = elongation, `smear` leans the bulb.
  - Shared: `constructiveFootHull` (the bracketed-foot hull behind **rect-B**) and `footAxis`
    (the world-angle/tangent axis). Covered in `strokeOutline.test.ts`.

**Phase A — Command Registry + Right-Click Menus** (see Invariant 8)

`commands/registry.ts` is the single source of named actions + default keybindings;
`useCommandKeys` is the one global key handler; `ContextMenu` gives canvas + layer
right-click menus. Tool-switch commands are generated from `TOOLS`.

**Phase B — Node Topology** (split / delete-toggle / merge)

One pure op `engine/geometry/topology.ts` `extractContours` powers: **cut nodes →
split path** (node-aware `clipboard.cut`), **delete = connect-or-split** (the
`deleteSplits` setting; `documentStore.splitAtPoints` vs `deletePoints`), and
**merge endpoints on drag** (`joinContours` → `documentStore.joinEndpoints(…, "merge")`, same
layer only; the `mergeEndpoints` setting). New split ends get butt caps AND lose the dangling
handle that pointed at the removed neighbour (it would otherwise act as a cap-angle handle).
Merging FUSES the dragged end into the target (`fuseNodes`): the junction keeps the target's
inner handle and takes the dragged node's outward handle as an OFFSET, so the dragged path's
first curve keeps its shape; closing a path onto its own start drops the duplicate seam node
(`closeEnds`). Each end of a joined path keeps the cap of the geometric end it is. Every piece
spreads its source contour, so paint/fill/corners/baked survive cut, split and merge. Tested in
`topology.test.ts` + `documentStore.test.ts` + `state/fieldSurvival.test.ts`.

**Phase C — Settings Persistence + Keybinding Editor** (see Invariants 7 & 8)

Preferences persist under `glyphdraft:settings` (`storage/settingsFile.ts` v2 +
`state/settings.ts`), separate from the document, defaults-fallback. The keybinding
editor (`features/settings/KeybindingsModal.tsx`) rebinds any command over the
registry and persists overrides via the settings `keybindings` field.

**Phase E — Transform box (Ctrl+T)**

Scale/rotate/move handles over the node selection; a pure affine
(`engine/geometry/affine.ts`) applied across layers via `liveContours` →
`replaceContoursEverywhere` (one undo step). See `features/canvas/components/TransformBox.tsx`.
A draggable **rotation pivot** (a ring marker; component-local `pivot` state, default = box center,
double-click resets) lets the rotate handle turn the selection around a **marked point** —
`matrixFor`'s rotate branch uses `d.pivot`; the pivot drag is geometry-neutral (no `liveContours`,
not an undo step). Scale/move keep their existing pivots. **During a rotate drag the box renders
RIGIDLY rotated** (component-local `rotateView` = the committed box turned by the live angle about the
pivot; outline + 8 handles + the rotate stem derive from the four rotated corners) instead of warping
as the AABB of the rotating points — geometry is unchanged (still via `matrixFor`), only the chrome.

**Phase F (partial) — Destructive Merge / Flatten layers**

Layers panel right-click → **Merge N layers** bakes the selected layers' RENDERED
geometry (reusing `buildFillGroups`, so strokes are expanded and any boolean pair
fully within the set is applied) into ONE layer of **baked contours** (`markBaked`), removing
the sources and their pairs. Geometry is computed in `features/layers/mergeLayers.ts`
(keeps Paper.js out of the store); the store action `commitMerge` does only the array
surgery (one undo step). A **baked contour renders verbatim** — `renderContour`
returns it as-is (winding preserved for holes, no stroke expansion, no
force-CW), the deliberate exception to Invariant 4's force-CW rule. Paths drawn on the merged
layer afterwards render normally (the flag is per contour — projectFile v9). (Blend/echo
shipped later — Phase M.)

**Phase G — Path↔layer ops, Align, Fill paint**

- **Move to layer:** canvas right-click → **"Move to layer ▸"** submenu (all layers +
  "New layer") moves every whole path that has a selected node, via
  `documentStore.moveContoursToLayer` / `moveContoursToNewLayer` (one undo step). Needed
  the new **`ContextMenu` submenu** support (`submenu?: ContextMenuItem[]`).
- **Merge nodes:** `joinEndpoints` generalised to **cross-layer** — two selected open-path
  endpoints join into one path on the SECOND node's layer (same-layer + close-in-place still
  work). Mode `"join"` (Illustrator's Join): ends that COINCIDE fuse into one node; ends that are
  APART are connected by a new segment (it used to drop the second path's end node, deleting
  geometry). Exposed as the `edit.mergeNodes` command (self-hides in the right-click menu unless
  exactly two endpoints; disabled-but-listed in the Edit menu).
- **Align panel:** a floating Illustrator-style panel (`features/canvas/components/AlignPanel.tsx`,
  shown when ≥2 paths selected) over a pure engine `engine/geometry/align.ts`
  (`contourBounds`, `alignDeltas` for left/centerH/right/top/middleV/bottom + distribute,
  relative to the selection bbox). Applied via `editActions.alignSelectedPaths` →
  `replaceContoursEverywhere` (one undo step).
- **Fill paint (the colour seam):** optional `Contour.paint` (see Invariant 4's paint bullet
  + the `setContourPaint` action + the **Color panel** `FillPanel.tsx`). The chosen foundation
  that makes SVG import / richer colour cheap later.

**Phase H — SVG import**

**File → Import SVG…** parses an SVG file and drops its art onto a **new layer** of the active
glyph. It rode the paint seam exactly as planned (the colour foundation from Phase G), so it
stayed small and self-contained.

- **Pure parser:** `engine/geometry/svgPath.ts` `parsePathD` — the full path-`d` command set
  (M/L/H/V/C/S/Q/T/A/Z + relative forms) → our cubic `AnchorPoint`/`Contour` model. Quadratics
  (Q/T) are exact-converted to cubics; arcs (A) are split into ≤90° cubic segments. DOM-free and
  unit-tested (`svgPath.test.ts`).
- **Importer:** `features/import/svgImport.ts` `importSvg(text)` — a `DOMParser` walk over
  `<path>` + basic shapes (`rect`/`circle`/`ellipse`/`line`/`polyline`/`polygon`) that **flattens
  element + `<g>` ancestor transforms** (matrix/translate/scale/rotate/skew), folds in the
  world↔SVG **Y-flip** (so re-importing our own `glyphToSvg` exports round-trips coordinates),
  maps `fill`/`fill-opacity` (attribute, `style`, or inherited) → `Contour.paint` via `toPaint`
  (black = default ink = no paint), and runs `correctWinding` so nested counters punch through.
  The pure pieces (`parseTransform`, `toPaint`) are unit-tested; the `DOMParser` glue is verified
  in-app (the node test env has no DOM). Skips `<use>`/text/images and rounded-rect corners.
- **Lands as baked contours on a new layer:** `documentStore.addImportedLayer(contours, name)` inserts
  the art on a NEW layer above the active one and marks its contours **`baked`** (`markBaked`) so
  `renderContour` emits them **verbatim** — preserving the import's holes (correct winding) and
  colours, with no force-CW or stroke expansion (the Invariant 4 baked exception). One undo step.
  The new layer becomes active, and anything drawn on it next renders as a normal path.
- **Colour fidelity:** `fill` / `fill-opacity` / `opacity` resolve with CSS precedence — `style=""`,
  then embedded `<style>` rules (`parseStyleSheet`: compound simple selectors such as Illustrator's
  `.cls-N`; combinators / pseudo-classes / `@media` are skipped, not guessed), then presentation
  attributes (`cascadeProp`). `opacity` multiplies down the `<g>` tree; an unusable opacity value is
  ignored (`parseOpacity` — it used to become 0, i.e. invisible). Still NOT handled: strokes
  (stroke-only shapes import unfilled), the root `viewBox` (external art lands in raw SVG units),
  `<use>`, text.
- **UI:** a hidden `<input type=file>` (created + clicked synchronously to keep the user gesture),
  wired to **File → Import SVG…** in `App.tsx`. Cross-platform (works in the web tab and the Tauri
  webview) — no new platform seam needed.

**Phase I — Expand stroke** (centerline + `stroke` → editable filled outline)

Right-click a selected stroked path → **Expand stroke** bakes its non-destructive stroke into the
literal filled outline (the SAME geometry `buildFillGroups` draws) as real, node-editable contours.
The lowest-risk wishlist item — it reuses `expandStroke` + the `baked` render path verbatim, so
there's no new geometry and no model change.

- **Engine reuse:** `editActions.expandSelectedStrokes` calls `layerFills.renderContour(c)` — THE
  definition of what a contour renders to — for each selected path with a live (non-baked) stroke:
  the outline in the stroke's own colour/gradient, plus the interior when the path is also filled.
  (It used to re-derive this and drift: the outline took the FILL colour, and a filled path lost its
  interior.) `canExpandStrokes` (≥1 selected path has a live stroke) self-hides/disables the command.
- **Lands as baked contours on a new layer:** `documentStore.expandStrokesToLayer(expanded, removeRefs)` drops the
  originals (their centerline+`stroke`) and inserts ONE new layer (above the active one) of
  **baked** contours — so its holes/winding survive (a stroked closed path → annulus). One undo step;
  the array surgery stays in the store, the Paper call stays in `editActions` (the `commitMerge`
  pattern). Result is consumed-in-place semantics: same shape, now an outline instead of a recipe.
- **UI:** `edit.expandStroke` in the command registry (right-click canvas menu via `CANVAS_MENU`,
  rebindable, self-hiding). Tested headless in `expandStroke.test.ts` (outline replaces the stroke on
  a baked layer, original gone, one-undo round-trip, no-op without a stroke, stroke colour kept,
  interior kept).

**Phase J — Free-pen (pencil) tool** (freehand draw → simplified smooth bezier)

The **Pencil** tool (toolbar / shortcut **B**) lets you *sketch*: drag freely, and on release the
raw cursor trail is **simplified + fit to a smooth, editable bezier** that lands as one contour on
the active layer (one undo step). It's the registry's "add a `ToolDefinition` → free button +
shortcut + routing" promise in action — no controller changes.

- **Pure fit:** `engine/geometry/freehand.ts` — `simplifyRDP` (Ramer–Douglas–Peucker decimation) +
  `fitFreehand` (Catmull-Rom → mirrored cubic handles for C1 smoothness; turns sharper than
  `cornerAngle` stay **corner** nodes; closes when the ends meet). DOM-free, unit-tested
  (`freehand.test.ts`).
- **Tool:** `features/tools/freepen.ts` reuses the shapes-tool gesture — `editor.draft` holds the
  growing RAW polyline for the live preview AND is the input to the fit on release, so **no new
  editor state**; `resetEphemeral`/`setTool` already clear it. Input is **unsnapped** (`ctx.rawWorld`);
  moves are gated by a ~2px `screenDistance` sample. Commits via `doc.addContour` (one undo step).
- **Smoothing** is a per-tool `ToolPanel` slider (`viewportStore.freehandSmoothing`, **session-only —
  not persisted**, so no settings migration). The value is SCREEN px → world (`/ zoom`) at fit time,
  so the feel is zoom-independent.

**Phase K — Scissors tool** (click a path to cut it in two)

The **Scissors** tool (toolbar / **C**) cuts a path where you click — at a node or **mid-segment**
(the bezier is subdivided so the cut lands exactly on the curve). An open path splits into **two**,
a closed one **opens** into one; new cut ends get **butt** caps (matching delete-split). One undo
step. Lowest-risk: rides the tool registry and the existing cut/cap conventions; the new logic is
three small pure, tested functions. (Drag-**knife** and **eraser** shipped next, on the same
helpers — see Phase L.)

- **Pure pieces:** `engine/geometry/path.ts` `splitCubic` (De Casteljau); `engine/geometry/topology.ts`
  `splitContourAt(contour, segIndex, t)` (subdivide-or-snap-to-node, **duplicate** the cut point, butt
  caps via the `makeFragment` convention, open→2 / closed→1, terminal/`n<2` → no-op); `features/tools/hitTest.ts`
  `nearestPointOnContours` (project the click onto each segment — sample `cubicAt` + ternary-refine —
  nearest within `maxPx`; closed paths include the closing segment). All unit-tested.
- **Store + tool:** `documentStore.splitContourAtPoint(layerId, contourId, segIndex, t)` mirrors
  `splitAtPoints` (`flatMap`-replace in the target layer; locked-safe; **no-op = no undo step**).
  `features/tools/scissors.ts` `onPointerDown` → `nearestPointOnContours(editableLayers(ctx), …)` →
  the store action. Single click cuts; no drag, no options panel.

**Phase L — Knife & Eraser tools** (drag-cut / drag-erase)

Both ride the tool registry and reuse the scissors primitives — no controller changes. The shared
new pure op `topology.ts` **`splitContourAtPoints(contour, cuts[])`** generalizes `splitContourAt` to
MANY cuts (subdivide each cut segment via `splitCubic`, then break the contour at every cut → open:
runs between cuts + the ends, closed: arcs; duplicated butt-capped cut points). `splitContourAt` is now
a thin single-cut wrapper.

- **Knife** (`tools/knife.ts`, **K**): drag a straight line (live preview via `editor.draft`); on
  release `hitTest.ts` **`lineCrossings(contour, a, b)`** (sample `cubicAt`, sign-change of the
  side-of-line, bisection-refine, keep within the segment) finds every crossing across
  `editableLayers`, and `documentStore.splitContoursAtPoints(cuts[])` cuts them all in one undo step.
- **Eraser** (`tools/eraser.ts`, **X**): press → entry `nearestPointOnContours`; release → exit on the
  SAME contour → `documentStore.eraseContourSpan(...)` = `splitContourAtPoints([entry,exit])` then drop
  the spanned piece (open: the run touching no original terminal; closed: the `entry→exit` arc). The
  entry hit is held in a module-local (not rendered). One undo step; entry≈exit → no-op.

**Phase M — Layer Blend (5th Pathfinder op)** (A→B shape-morph echo)

A live, non-destructive **blend** between two layers — Illustrator's "echo": N stepped in-between shapes
morphing A into B. It rides the existing two-layer pair seam (`Glyph.booleanPairs`), so it needed **no new
fan-out** — `buildFillGroups` is the single chokepoint and the canvas/thumbnail/preview/export/merge just
consume the extra groups.

- **Model:** `PairOp = BooleanOp | "blend"` (`BooleanOp` stays the 4 so `geom[op]` type-checks);
  `BooleanPair.op: PairOp` + optional `steps?`. Added at projectFile **v6** (additive; v5→v6 identity; current is v9).
- **Engine:** pure `engine/geometry/blend.ts` `blendContours(a, b, steps)` → `steps + 2` step sets
  (endpoints incl.), each carrying the source contour's `stroke`/`paint`/`filled`/`corner`/`baked` (stroke
  **width** morphs; a baked side keeps the in-betweens verbatim, so imported counters stay holes).
  Two paths: **matching structure** (same contour + point counts) → exact per-anchor lerp that preserves
  béziers; **different shapes** → each matched contour is arc-length **resampled** to a common point count
  and cyclically **aligned** (min Σ-distance, so the morph doesn't twist) then lerped as polylines; different
  **contour counts** pair greedily by centroid and unmatched paths collapse to a point. `null` only when a
  side is empty. Reuses `flattenContour`/`ringSignedArea`/`cubicAt`. DOM-free, tested.
- **Render:** a `pair.op === "blend"` branch in `buildFillGroups` (before the boolean `geom[op]`) emits,
  bottom→top: **operand B rendered as itself**, the in-between steps, **operand A rendered as itself**.
  Only the in-betweens (`seq[1 … n]`) come from `blendContours` (raw contours, lower→upper z), each
  rendered through `renderContours` + `groupByPaint` — the normal layer path — so strokes expand, corners
  apply, holes/winding behave, and per-path colour survives. The ENDS used to be the interpolated t=0/1
  steps, which restyled the operands (B repainted in A's colour, `filled` dropped, curves resampled to
  polylines); pairing two layers must not change how either looks. `null` (an empty operand) ⇒ just the
  operands. The 4 boolean ops are untouched.
- **Colour:** the in-between echo takes **operand A's (upper layer's) paint** (`carryStyle` uses `cb.paint`,
  and A's stroke colour when both are stroked); each operand keeps its own. Stroke shape/corner come from
  whichever side has them; stroke width morphs A↔B.
- **Cost:** the step geometry is memoized (`cachedBlend`, on the operand arrays + step count), so the
  steps keep their identities and the per-contour stroke cache hits: an UNCHANGED blend costs nothing
  per frame (a stroked 8-step blend used to cost ~1 s per drag frame even while dragging an unrelated
  layer). Editing an operand still re-expands every **stroked** step via Paper, so the Pathfinder bar
  keeps its perf **warning** at a high step count (`blendCostly` in `LayersPanel`: stroked ≥ 8 steps, or
  any ≥ 24). The resampling (`alignCyclic` is O(K²), K capped at 256) is minor by comparison.
- **UI:** a **Blend** button in the Pathfinder bar (`LayersPanel`) + a **steps** `NumberInput` when a blend
  pair is active; the pair badge shows `≈`. **Scope:** handles outlined/multi-path/coloured/corner layers and
  morphs genuinely different shapes (and path counts). Caveat: resampled in-between steps are **polyline
  approximations** (not editable béziers) — fine for the transient echo; A↔B colour interpolation is not done
  (steps take the source contour's paint).

### Future seams (deferred wishlist — keep these cheap, build only on demand)

**The artist wishlist is essentially complete.** Only a handful of items are genuinely open.

> ⚠️ **THE TIER LIST BELOW IS THE SINGLE SOURCE OF TRUTH for how entangled an open item is and
> whether to build it.** Do not restate a tier number anywhere else in this document — the
> "Not Yet Implemented" list and the Known-Gaps table deliberately carry **no** tier numbers and
> just point here. (They used to disagree: every open item carried two or three different tiers,
> so "should I build the cap designer?" got opposite answers from the same file.)

The debt-smart rule: every new feature lands ON an existing seam, model fields stay **optional +
migration-guarded**, and **Tier 2, 3 and 4 seams stay DOCUMENTED intentions — built only when an
artist actually asks (YAGNI), never pre-built.** Tier 1 is the only "safe anytime" tier.

**The six genuinely-open items, in build order** (each appears in its tier bullet below):
smart guides (T1) → cap designer (T1) → stroke alignment (T2) → procedural/L-system brushes (T2)
→ per-NODE corners (T3) → i18n (T4). Everything else below is marked Shipped and kept for the design rationale.

- **Tier 1 — isolated, rides an existing seam (safe anytime):**
  - **Colour picker UI** → the `Contour.paint` seam (`setContourPaint` / `applyPaint`, both in the **Color panel** `FillPanel.tsx` — NOT StrokePanel, which is shape-only). Pure UI. **(Now shipped — richer Fill palette: presets + recent + hex, over the existing native swatch.)**
  - **Rotate around a marked point** → **Shipped** — a draggable **pivot** on the Transform box (Ctrl+T): the rotate handle rotates the selection around the marked pivot (default = box center; double-click the pivot resets it), reusing `affine.rotateAbout`. Implemented as a transform-box pivot, NOT a separate tool — a standalone Rotate tool was rejected because switching tools clears the selection (Invariant: `setTool` resets selection), which would wipe what you mean to rotate.
  - **OPEN — Dynamic alignment "smart guides"** (live alignment lines while dragging). The least
    entangled open item: it touches **no document model at all**, so there is no migration and no
    render fan-out. Every seam exists — `dragDelta` (`tools/shared.ts`) already takes an **injected
    `snap` strategy** (`snapGeometry.ts`'s `dragSnapFn` is the precedent); `editorStore` already
    holds ephemeral gesture visuals (`lasso`, `marquee`) cleared in `setTool`/`resetEphemeral`;
    `components/MarqueeOverlay.tsx` (21 lines) is the overlay template; and `align.ts`
    `contourBounds` supplies the bbox math. Two notes: widen `GeomSnap` first (it currently discards
    the `ref` of what you snapped to, and a guide must know what it aligned to), and snapshot the
    static bboxes at pointer-DOWN rather than recomputing per move. Ship the toggle session-only
    (like `snapToGeometry`) to avoid a settings migration.
  - **OPEN — Cap designer** (user-drawn custom serif/teardrop cap shapes). `withCap` in
    `PaperGeometryService.ts` is a clean dispatch point — a `cap === "custom"` branch is ~6 lines and
    inherits the per-end wiring, the terminal cap-angle handle, and the node/outward anchor
    convention for free. Reuse the pattern machinery **verbatim**: `svgImport.normalizePattern`
    (normalizes a `Contour[]` to a unit box), `halftonePatternPath` (caches the Paper compound —
    already reused by BOTH halftone and dash, so a third caller is proven safe), and `footAxis` for
    orientation; `rectCap` is the reference implementation. The StrokePanel "Import SVG…" flow
    already exists twice and can be extracted to a shared hook.
    ⚠️ **Design limit:** serif and drop-B are **not shapes** — they are per-position width fields
    folded into `sampledOutline`, which is exactly what makes them seamless with the stem. A
    user-supplied `Contour[]` can only ever be a **unioned** cap, so it will show a union boundary
    on a tapered/profiled stroke. Scope custom caps to uniform-width terminals.
- **Tier 2 — additive, touches ONE pipeline (behind a reserved seam):**
  - **OPEN — Stroke alignment** (Illustrator's Align Stroke: center / inside / outside — the third
    item of the wishlist's "Cap, corner and align stroke"; it was never tracked here). Closed paths
    only, as in Illustrator (an open path has no inside). The low-entanglement route does not touch
    the per-side width machinery at all: expand the stroke CENTERED at twice the width, then
    `intersect` it with the path's own interior (inside) or `subtract` the interior (outside) — one
    boolean after `expandStroke`, so it works for the offset, brush and nib models alike and can't
    disturb caps (closed paths have none). One optional `StrokeStyle.align?` (additive, no
    migration); halftone/dash ignore it (early returns). Mind the stroke cache: the result depends
    only on (contour, stroke), so it stays valid.
  - **Stroke decorators** (dashed/dotted/**custom-SVG-along-line**) → **Shipped** as an isolated **`model: "dash"`** brush (a top-level early return in `expandStroke`, like halftone — see "Strokes — current state"). This proved SAFER than the earlier "decorator post-pass" idea (a new model can't touch the offset/brush/serif code at all). Still deferred: simple dash/pattern decorators on the *existing* offset/brush models (vs. the dash model replacing the ribbon).
  - **OPEN — Procedural / L-system brushes** (growing branches, voronoi fracture, reaction-diffusion
    along the path). Structurally this is the SAFEST of the open items — a 5th `StrokeStyle.model`
    added as another **top-level early return** in `expandStroke` (beside `halftone`/`dash`), so the
    offset/brush/serif/drop/profile machinery is literally unreachable for it and cannot regress.
    Only ~4 files change (type union + style interface + default, the engine function, the
    StrokePanel block, tests). Honour the two conventions the other two models established:
    `solidify` (self-union) the elements **before** `normalize`, or nesting-based `correctWinding`
    mislabels overlapping branches as holes (an XOR artifact already hit and fixed once in dash);
    and add a graceful **element cap** like `HALFTONE_MAX_CELLS`/`MAX_DASH_ELEMENTS` that degrades
    resolution rather than freezing. Two risks the other models don't have: element count is
    **exponential** in L-system depth (cap depth AND total elements, counting as you grow), and any
    randomness **must store its seed** in the style — otherwise canvas, thumbnail, preview and
    export each compute a different shape, masked intermittently by the `expandStroke` WeakMap.
    Note `PolygonGeometryService.expandStroke` ignores `model`, so headless tests can't cover it.
- **Tier 3 — model + multi-pipeline fan-out (design the additive seam first):**
  - **Rounded corners (general):** **Shipped** — a per-contour `Contour.corner?` (round/chamfer/inverted) + the pure render-time pre-pass `engine/geometry/corners.ts` `roundCorners` plugged into `renderContours` (before stroke-expand/booleans/export).
  - **OPEN — Per-NODE corners** (`AnchorPoint.corner?`, selecting individual anchors). **Deceptive:
    the engine is ~1 line, the plumbing is ~12 files.** `roundOne(P, prev, next, style)` is already
    pure per-corner with the radius already clamped against *that* corner's own two edges and no
    cross-corner state, so the engine change is just `roundOne(P, prev, next, P.corner ?? style)`
    plus a nullable path style.
    The former big cost — `AnchorPoint` rebuilt FIELD-BY-FIELD in six places, each silently
    dropping a new field — is PAID: every node copy now spreads the source node (`translatePoint`,
    `transformAnchor`, `topology` `clonePoint`/`reverseContour`, `path` `reverseContour`,
    `convertPoint`, `cloneContourWithNewIds`), and `state/fieldSurvival.test.ts` fails if any copy
    site drops an unknown node or contour field (add new copy sites to it). Still needed: the
    per-path gate in `layerFills.ts` (`renderContour` → `withCorners`, and the merged-halftone
    pre-pass) must also test for per-node overrides, a `PointRef[]`-keyed store action beside
    `setContourCorner`, and a mixed-state UI decision (the Corners section is per-PATH via
    `useEditTargets`, while node selection lives in `editorStore.selection` — Invariant 5a keeps
    them decoupled).
  - **Custom-SVG-on-line decorator:** **Shipped** — the dash `model:"svg"` imports an SVG and tiles it
    along the line (scaled + rotated to the tangent; `DashStyle.pattern`). The ONLY open remnant is the
    niche "decorate the *existing* offset/brush ribbon" (vs. the dash model replacing it) — low value,
    deferred (see the Tier-2 note).
- **Tier 4 — genuinely cross-cutting; defer deliberately:**
  - **Blend/echo between layers** → **Shipped** as the 5th pair op on the `Glyph.booleanPairs` seam — see Phase M. Handles outlined/multi-path/coloured/corner layers and morphs genuinely different shapes (arc-length resampling + cyclic alignment; different path counts collapse to a point). Only remaining caveat: resampled in-between steps are polyline approximations (not editable béziers), and A↔B colour isn't interpolated.
  - **OPEN — i18n / language.** The most entangled item; defer hard. ~350-400 distinct user-facing
    strings and **zero** infrastructure (no library, no `t()`, no string-constant module, no
    extraction tooling or lint rule). The shape is friendlier than "massive rewrite" suggests —
    **26 of 46 `.tsx` files have no user-facing strings at all** (every `components/` overlay is
    pure SVG), and seven files hold well over half: `StrokePanel`, `FillPanel`, `App`, `ViewMenu`,
    `GlyphSidebar`, `ExportModal`, and `commands/registry.ts` (22 command labels in one array,
    already the single source for menus + right-click + the keybinding editor — the natural first
    conversion). Three things are easy to overlook: ~46 **template-literal** labels
    (`` `Width · ${n} u` ``) need interpolation-aware messages, not key lookup; `src/content/*.md`
    (~460 words, imported `?raw`) localizes per-FILE and `?raw` resolves at build time, so a locale
    switch needs `import.meta.glob` or bundling every language; and numbers/units would need
    `Intl.NumberFormat`. Settings would take one additive `language?` field (**settings v8**) —
    `settingsFile.ts` already names this exact case. **The real debt is not the conversion but the
    ongoing discipline** with no lint rule to enforce it.

(Free-hand pen — Phase J; **scissors/knife/eraser** — Phase K/L, on
`splitContourAtPoints`/`lineCrossings`/`nearestPointOnContours`.)

### Not Yet Implemented

The wishlist is essentially complete; only these remain open. **This list carries no tier numbers
and no entanglement claims on purpose** — "Future seams" above is the single source for both, and
for whether an item is safe to build yet. In build order:
- **Dynamic alignment "smart guides"** (live alignment lines while dragging) — a drag-time overlay
  (static "Snap to point" + the Align panel are already shipped).
- **Cap designer** (custom serif/teardrop cap shapes) — a custom shape unioned in the cap stage.
- **Stroke alignment** (inside / center / outside, closed paths) — Illustrator's Align Stroke.
- **Procedural / L-system brushes** (perf-heavy, experimental) — a new `StrokeStyle.model`
  early-return, like `halftone`/`dash`.
- **Per-NODE corners** (select individual anchors) — an extension of `engine/geometry/corners.ts`
  (per-*path* `Contour.corner` is shipped).
- **i18n / language** — cross-cutting (every user-facing string); deferred deliberately.
- (Niche) **decorators on the existing offset/brush ribbon** — low value now that `model:"dash"` ships
  dashes/dots/custom-SVG-along-line. If ever built, make it a `model` (a 6th early return that calls
  the existing `sweptUniform`/`sampledOutline` helpers) rather than an inline post-pass — a post-pass
  is the design already rejected once, and it would reach into the serif/drop code the A/B `variant`
  system was built to protect.

(Everything else from the wishlist is shipped — strokes/serifs/caps/profiles, the two-layer Pathfinder +
**blend**, booleans/winding, layers/lock/onion, glyph sidebar, clipboard paste-in-place,
knife/scissors/eraser/pencil, expand-stroke, SVG import, alignment, transform box + pivot, path corners,
dash/halftone, fill/stroke colour + gradients, bold/italic export, robust save + portable project,
dark/light/paper themes.)

## Known Gaps vs Artist Wishlist

| Feature | Status |
|---|---|
| Holes between layers (non-destructive) | **Shipped** — a two-layer **Subtract** in the Pathfinder; curve-exact (Paper.js), both layers stay editable |
| Boolean ops (union/subtract/intersect/exclude) | **Shipped** — non-destructive, between two layers, curve-exact; results computed at render/export time, never baked |
| Multi-layer selection (Ctrl+click layers) | **Shipped** — layer rows drive the Pathfinder operand picker; node selection is independent (any visible+unlocked node, Illustrator-style) and node drag/transform/align act across layers in one undo step |
| Non-destructive stroke (uniform + broad-nib/quill, caps, joins) | **Shipped** — Phase 7; per-path `stroke`, expanded at render/export, never baked |
| Serif foot/ears + drop at stroke ends | **Shipped** — Phase 7; per-end `serif`/`drop`, each with a selectable **A/B algorithm** (`variant`). Serif A = concave **bracket** fillet honoring a world/handle `angle` (`bracket`, `anchor`/`bias`); serif B = a **WEDGE** (straight diagonal sides → convex flare via the reused `bracket` slider, labeled "Flare"), **tangent-only** — a distinct shape from A, **seamless by construction** (no union) and robust on curved/steep stems. Drop A = round ink-pool dome; drop B = a **seamless necked-bulb teardrop** (stem→neck→bulb→point, built from the outline, no cap; `neck` pinch). Plus a brush-sweep model + terminal-handle cap angle — see "Strokes — current state" |
| Rectangle/angled terminal cap | **Shipped** — parametric `rectangle` cap (`RectCapStyle`: far edge on the node, `size`/`ratio`/`radius`, world-absolute flat-edge `angle`) with a selectable **A/B** (`variant`): A = a **crisp re-cut slab** (no protruding corners), B = a **seamless flare**. Replaced the old fixed `square` (v1→v2 doc migration). The slab's re-cut (and the handle-angled butt) is LOCAL to the terminal, so curved strokes (S, C, J, hooks) keep their whole body |
| Custom stroke preset library (save/select/edit/remove) | **Shipped** — `strokePresetStore`; fully managed inline in `StrokePanel` (apply/save-upsert-by-name/rename/update/delete); persisted in the settings file (now **v7**; the `strokePresets` field was added in v3, `alignMode`/`guides` in v4, `colorPalettes` in v5, `mergeHalftones` in v6, `accentColor` in v7) |
| Non-uniform thickness / width profile + brush angle profile | **Shipped** — width & nib-angle `StrokeProfile`s edited in a graph panel (`GraphEditor`), evaluated by `engine/geometry/profile.ts`; closed paths render as an annulus |
| Dashed / dotted / custom-SVG stroke line | **Shipped** — an isolated experimental `model:"dash"` brush (`DashStyle`): dash blocks (curve-following), dot circles, or a **custom SVG** tiled along the line (scaled + rotated to the tangent), with dash/gap/size sliders + an Import SVG button; `dashStroke` is a top-level early return in `expandStroke` (can't affect other strokes); additive, no migration |
| On-canvas serif/cap angle handles | **Partial** — reading a terminal bezier handle as the cap AXIS shipped (the Stage-5 "terminal-handle cap angle" — see "Strokes — current state"); only the draggable **on-canvas** angle-handle widgets remain deferred |
| Basic shapes incl. polygon/triangle | **Shipped** — rectangle/ellipse/line + polygon (configurable sides) + triangle |
| Lasso + marquee node selection | **Shipped** — freeform lasso (Q) with cross-layer move; rubber-band **box-select** on the select tool (drag empty canvas, Shift adds) |
| Snap to anchors & paths (Illustrator "Snap to Point") | **Shipped** — `viewportStore.snapToGeometry` toggle (View → "Snap to point", session-only) snaps the cursor / a dragged node to existing anchors then path edges within ~8px, excluding the dragged geometry (`tools/snapGeometry.ts`, reusing `nearestPointOnContours`); off by default, grid stays the fallback. (Dynamic alignment-line "smart guides" remain open.) |
| Free pen drawing (jagged input simplified/smoothed) | **Shipped** — Phase J; the **Pencil** tool (B) drags a freehand trail, then `freehand.ts` RDP-simplifies + fits a smooth bezier (corner/close detection); per-tool **Smoothing** slider; one undo step |
| Knife / Scissors / Eraser tool | **Shipped** — **Scissors** (C, Phase K) click-cuts a path; **Knife** (K, Phase L) drags a line and cuts every visible+unlocked path it crosses (`lineCrossings` → multi-point `splitContourAtPoints`); **Eraser** (X, Phase L) press-drag-release on a path drops the spanned run. Open→pieces, closed→opens; butt cut ends; one undo step each |
| Delete = connect-or-split + merge endpoints on drag | **Shipped** — Phase B (toggles in Settings) |
| Right-click canvas/layer menus | **Shipped** — Phase A (over the command registry) |
| Undo/redo + editing actions without shortcuts | **Shipped** — the top-bar **Edit** menu (`EditMenu.tsx`, a view over the registry) lists Undo/Redo, clipboard, transform, flip, node, merge and expand-stroke actions with their shortcuts; inapplicable ones are listed disabled. (There is no toolbar undo button.) |
| Rebindable keyboard shortcuts | **Shipped** — Phase C (editor over the registry, persisted) |
| Settings persistence (theme/grid/prefs survive reload) | **Shipped** — Phase C; separate versioned key, defaults-fallback |
| Advance width per glyph (UI) | **Shipped** — editable in the glyph sidebar (`setAdvanceWidth`); live em-box/guide feedback; export framing reflects it |
| Single-glyph export | **Shipped** — Export modal "Active glyph" scope → one `.svg` (web direct download / desktop save dialog) via `ExportService.exportSingle` |
| SVG import | **Shipped** — Phase H; File → Import SVG… parses `<path>` (full command set, arcs→cubics) + basic shapes, flattens transforms, Y-flips, maps `fill`/`fill-opacity`/`opacity` → `Contour.paint` with CSS precedence (incl. embedded `<style>` class rules — Illustrator's default export), `correctWinding`s, and drops the art as **baked** contours on a new layer (`addImportedLayer`). Re-imports our own exports round-trip. **Not yet:** strokes (stroke-only shapes import unfilled), the root `viewBox` (external art keeps raw SVG units, landing below the baseline), `<use>`/text |
| Color support (for imported SVGs) | **Shipped** — the per-contour **paint seam** (`Contour.paint`, `setContourPaint`, fill/opacity through render + export, projectFile v3) is consumed by SVG import AND the in-app **Color panel** (`FillPanel.tsx`): one shared picker for BOTH fill and stroke colour (native swatch + hex + preset inks + session **recent colours** via `paletteStore` + **saved colour palettes** via `colorPaletteStore`/settings v5), every edit a per-contour patch |
| Saved colour palettes (consistent theme) | **Shipped** — user-managed named swatch sets in `FillPanel` (pick/apply/add current colour/rename/delete; Alt-click a swatch removes it); `colorPaletteStore` persisted in the settings file (v5), the colour sibling of the stroke-preset library |
| Gradient fill (angle + fade) | **Shipped** — optional two-stop linear `Paint.gradient` (projectFile v5, additive): FillPanel "Gradient" block with an angle **Knob** + second colour + a **To-opacity** slider (fade toward transparent) + **Blend** (midpoint) & **Fade** (band width) sliders; rendered live on canvas/text-preview and exported as a real `<linearGradient>` (with `stop-opacity`) via the pure `fillPaint.ts` spec (decorative — FontForge flattens it) |
| Boolean-pair fill colour | **Shipped** — a Pathfinder result inherits operand A's paint (else B's) via `firstPaint` in `layerFills.ts`; colour an operand layer and the combined fill keeps it (all-default stays black) |
| Alignment of multiple paths (Illustrator-style) | **Shipped** — Phase G; floating Align panel (left/center/right/top/middle/bottom + distribute) over `engine/geometry/align.ts`, one undo step. A Settings toggle aligns by **nodes** or each path's **expanded outline** (`viewportStore.alignMode`; outline bounds via `expandStroke` in `editActions.alignSelectedPaths`) |
| Move path(s) to another layer / merge endpoint nodes | **Shipped** — Phase G; right-click "Move to layer" submenu (incl. New layer) + cross-layer "Merge nodes" (coincident ends fuse into one node; ends that are apart get a connecting segment) |
| Transform box (Ctrl+T) | **Shipped** — scale/rotate/move handles over the node selection; affine applied across layers, one undo step. A draggable **pivot** marks the point to **rotate around** (default = box center; double-click resets) — covers wishlist "rotate around the center or a marked point" |
| Flatten / merge layers (destructive) | **Shipped** — Phase F; right-click → Merge N layers bakes strokes + booleans into one `baked` layer |
| Expand stroke (centerline+`stroke` → editable outline) | **Shipped** — Phase I; right-click → Expand stroke (`edit.expandStroke`) bakes the selected path's `expandStroke` output onto a new `baked` layer (holes preserved), consuming the original, one undo step |
| Movable / floating panels | **Shipped** — Stroke/**Color**/Layers/tool-options panels drag by their header + resize by the left edge, and the Align strip drags by the gaps between its buttons (`usePanelDrag` + session-only `panelStore`, `PanelId` = stroke/fill/layers/tool/align), clamped to the canvas; a moved panel detaches to a fixed position. **There is no draggable View panel** — the old floating ControlPanel became the top-bar View *menu* (`ViewMenu.tsx`) |
| Path corner styles (Illustrator Round/Chamfer/Inverted) | **Shipped** — per-path `Contour.corner?` (`{type,radius}`) applied by the pure render-time pre-pass `engine/geometry/corners.ts` `roundCorners` in `renderContours` (round = circular fillet, chamfer = flat cut, invertedRound = concave scoop); radius clamped per corner (no self-intersection), non-destructive, reused by canvas/thumbnail/export; set in the StrokePanel "Corners" section. Per-NODE corner widget is a future extension |
| Blend / echo between layers | **Shipped** — Phase M; a 5th Pathfinder op (`PairOp "blend"` on `Glyph.booleanPairs` + `steps`) that morphs A→B as N echo steps. Each step renders through the normal layer path, so **outlined (stroked), multi-path, coloured, and corner** layers all morph; **genuinely different shapes** morph via arc-length resampling + cyclic alignment, and different **path counts** collapse the extra to a point. Pure `engine/geometry/blend.ts`, render-time in `buildFillGroups`, added at projectFile **v6** (current is v7). Caveat: resampled steps are polyline approximations |
| Halftone brush (custom grid patterns) | **Shipped** — an isolated experimental `model:"halftone"` (`HalftoneStyle`): a rotated grid of circle/square/diamond/triangle/line/**custom-SVG** cells sized by distance to the centerline (`contrast` gamma), clipped to the swept body; open→ribbon+cap disc, closed→interior fill; `HALFTONE_MAX_CELLS` guard. Optional per-layer merge (settings v6) renders same-style halftone paths as one seamless tone |
| Outline / preview (wireframe) mode toggle | **Shipped** — `viewportStore.viewMode`: `edit`, `outline` (Ctrl/Cmd+Shift+O — skeletons+nodes, fills hidden) and `final` (the exported look, chrome hidden, optional "Show path lines"). Session-only; export is unaffected |
| Ghost / onion-skin reference glyphs | **Shipped** — Phase 4; `onionStore` (non-undoable), per-cell onion-skin toggle in the sidebar, opacity slider, shared coordinate space. Two modes: raw contour skeleton, or the **true rendered output** (`renderSvg`, via `glyphFillGroups`). **Partial vs the wishlist:** references are chosen per GLYPH; choosing which of a reference's LAYERS show is not supported (only via that glyph's own layer visibility, which also affects its export) |
| Dark / light mode | **Shipped** — three themes (dark/light/**paper**) via CSS variables in `styles/theme.css`, plus a user **accent-colour** override; both persisted (settings v7) |
| Em square + metrics guides | **Shipped** — Phase 1; em box, baseline and metric guides in shared world space, plus **adjustable** ascender/cap-height/x-height/descender guides (visual-only, `viewportStore.guides`) and a 1-unit coordinate reference legend |
| Layer lock / hide | **Shipped** — Phase 3; enforced in depth (store no-ops on a locked layer, the controller refuses to start a gesture, `EditOverlay` hides its anchors) |
| Grid: toggle, snap, adjustable density | **Shipped** — Phase 1; show/snap/size in the View menu, plus an independent "Snap to point" (anchors & paths) |
| One panel per tool (contextual) | **Shipped** — Phase 2; the view-layer `TOOL_PANELS` map in `ToolPanel.tsx`, keyed by `ToolId`, so a tool gets an options panel only if it has settings (`ToolDefinition` stays React-free) |
| **Stroke alignment** (inside / center / outside) | **Open** — see "Future seams" → Tier 2. (The wishlist's "Cap, corner and align stroke": caps and corners are shipped.) |
| **Dynamic alignment "smart guides"** | **Open** — see "Future seams" → Tier 1. Static "Snap to point" + the Align panel are shipped; live alignment LINES while dragging are not |
| **Cap designer** (custom cap shapes) | **Open** — see "Future seams" → Tier 1 |
| **Procedural / L-system brushes** | **Open** — see "Future seams" → Tier 2 |
| **Per-NODE corner styles** | **Open** — see "Future seams" → Tier 3. Per-*path* `Contour.corner` is shipped |
| i18n / language | **Open** — see "Future seams" → Tier 4 (deferred deliberately) |
| Export (bulk u_xxxx.svg + universal scale) | **Shipped** — Phase 6; every glyph → `u_xxxx.svg`, universal scale %, web zip (fflate) / desktop folder write (Tauri); reuses `buildFillGroups` so output matches the canvas. Optional **Silhouette** toggle → flat solid black (no colour/gradient/opacity, holes preserved), `-silhouette`-tagged archive. Optional **Crop to artwork** toggle → the viewBox hugs each glyph's own ink (exact curve bounds) instead of the em square, so there is no empty frame — artwork use only, since it drops the shared baseline/sidebearings; `-cropped`-tagged archive. The web zip's **name is editable** in the modal (`exportNaming.ts`; blank = the auto `glyphs[-tag].svg.zip`, so the default is unchanged) — desktop is unaffected since the user picks a folder |
| Synthetic Bold / Italic export | **Shipped** — `features/export/styleTransform.ts` + an Export-modal Style selector (Regular/Bold/Italic presets + Stretch %/Skew °/Outline-extension sliders). **Export-only** (source stays single-weight): fills are built UPRIGHT, then the skew/stretch is an **exact affine of the FINAL outline** (`transformContours`) — NOT a skeleton transform + stroke re-expansion (which re-exposed corner glitches); shearing finished beziers keeps sharp corners clean and counters intact (det>0 preserves CW-outer/CCW-hole). The fills also get an **x-only horizontal extension** (`extendOutlineX` — union/intersect of horizontally-shifted copies → bold thickens vertical stems only, height locked; negative thins, but the discrete intersect can facet sharp corners so Italic defaults to **skew-only**). `extendOutlineX` **splits CW outers from CCW holes** and smears each (grow ink + erode counters, then subtract) so counters DON'T fill solid (the geometry-service booleans flatten a contour set to a union of solids — feeding a whole annulus through `union` would lose the hole). Style-tagged archive name (`glyphs-bold/italic.svg.zip`) |
| Robust/stable save (low corruption risk) | **Shipped** — single auto-persisted workspace; versioned format + `migrate()` seam + load-time repair (`sanitize.ts`), serialized debounced autosave (flushed on tab hide) + File → Save (Ctrl/Cmd+S), double-buffered writes (atomic on desktop), main→backup→seed load fallback that pauses autosave rather than overwrite an unreadable save, one-writer tab lock, confirmed import with a pre-import snapshot, and per-launch **recovery points** (start of this session / the previous one / before the last import) restorable via **File → Restore previous version…** — the backup slot alone (~1 s old) can't undo a non-undoable mistake such as deleting a glyph (see Invariant 7) |
| Portable project export/import (continue on another computer, web ⇄ desktop) | **Shipped** — File → Export/Import project… writes/reads one `.glphdrft` file (legacy `.glyphforge` still imports; the versioned `serializeProject` envelope) via `features/project/`; import reuses `migrate()` (corruption-safe) then `loadGlyphs` + `useHistoryStore…clear()` |
| Vector-editing basics (nudge, duplicate, flip, reverse, zoom-fit, shift-constrain shapes) | **Shipped** — arrow nudge (Shift ×10), Ctrl/Cmd+D duplicate, flip H/V + reverse (right-click), Ctrl/Cmd+0 fit / Ctrl/Cmd+1 actual size; Shift → square/circle/regular/45° (`editActions.ts`, `shapes.ts`) |

## Canvas Controls

- **Pan:** scroll, Space+drag, middle-mouse drag
- **Zoom:** Ctrl/Cmd+scroll or trackpad pinch (zooms to cursor)
- **Pen (P):** click = corner, click-drag = smooth, click start = close, Esc/Enter = finish open path
- **Pencil / free-pen (B):** drag to sketch freely (unsnapped); on release the trail is simplified + fit to a smooth editable bezier (closes if you end near the start). Tune the **Smoothing** slider in the tool panel. One undo step.
- **Scissors (C):** click a point on any visible+unlocked path to cut it there (at a node or mid-segment); an open path splits into two, a closed one opens into one. New cut ends get butt caps. One undo step.
- **Knife (K):** drag a straight line; on release every visible+unlocked path the line crosses is cut at the crossing point(s) (crossed twice → splits into pieces). Butt cut ends. One undo step.
- **Eraser (X):** press on a path, drag along it, release — the spanned portion is removed (the path is cut at the press/release points and the run between dropped). Both ends must land on the same path. One undo step. A cursor **size circle** shows the pick reach; adjust it with the **Eraser size** slider in the tool panel (`viewportStore.eraserSize`, session-only).
- **Select (V):** click/Shift+click anchors, drag to move (snapped), drag handles to reshape, Alt = break mirror, Delete = remove (or split — see Settings), drag an open path's endpoint onto another to merge, drag from empty canvas = marquee box-select (Shift adds)
- **Node-drag snapping:** with snap on, the **grabbed node's absolute position** snaps to the current grid (`dragDelta` in `tools/shared.ts`), not the cursor delta — so a dragged node always locks to the live grid even after the grid size changes; a multi-node drag moves the group rigidly while the grabbed node lands on-grid. The snap crosshair tracks that landing point. (Pen/shape tools already place anchors at the absolute snapped point.)
- **Ambient snap indicator is per-tool (`ToolDefinition.snapsOnHover`, default true):** the controller only writes a snapped `cursor.snapped` (the `SnapIndicator` crosshair + "snap x,y" readout) while HOVERING for tools that opt in (pen/shapes — they preview where a click lands). **The select tool sets `snapsOnHover: false`**, so merely moving/clicking to pick doesn't chase the grid; a node DRAG still snaps and re-sets the landing crosshair itself (`select.ts` onPointerMove). `cursor.snapped` is therefore `Vec2 | null` (null = no active snap target). The marquee box still uses the snapped `ctx.world` (unchanged).
- **Snap to point (anchors & paths):** an independent toggle (`viewportStore.snapToGeometry`, session-only; View menu → "Snap to point") that snaps the cursor / a dragged node to existing **anchors** then **path edges** of the visible layers, within ~8 screen px — Illustrator "Snap to Point". Pure resolver `tools/snapGeometry.ts` (`snapToGeometry` = `nearestAnchor` → `nearestPointOnContours`+`cubicAt`), wired at the **two** snap sites: the controller's `points()` (pen/shape placement + cursor, no exclusion) and `dragDelta`'s optional `snap` callback (node drag; `dragSnapFn` excludes the moving refs' points/contours so a node never snaps to itself). When a geometry target is in range it WINS over grid; else grid/raw is the untouched fallback. Off by default ⇒ no behaviour change unless enabled. Tested in `snapGeometry.test.ts`.
- **Handle collapse:** a bezier handle dragged shorter than a few **screen** pixels (`HANDLE_COLLAPSE_PX`, `tools/hitTest.ts`) snaps to zero — the handle is dropped so the node becomes a corner (no spurious micro-curve). Applies to the pen's click-drag and to editing a handle with select; Alt-collapsing one side keeps the other (a cusp). Screen-relative, so **zoom in** to pull a deliberately small curve.
- **Node continuity (right-click a selected node):** **Make smooth** (adds tangent-symmetric handles — turns a corner into a grabbable curve, or re-symmetrizes a cusp), **Make cusp** (handles move independently / asymmetric; adds handles first if the node has none), **Make corner** (strips handles to a sharp point). Pure geometry in `engine/geometry/nodeHandles.ts` (`convertPoint`) → store `convertPoints` (cross-layer, one undo step). Handle **mirroring is type-aware**: a smooth node keeps its two handles mirrored on drag; a cusp/corner node moves each independently (`mirrorForDrag` in `tools/select.ts`) — Alt remains a momentary break on smooth nodes.
- **Lasso (Q):** drag a freeform loop to select nodes (across the selected layers), then drag to move
- **Transform (Ctrl+T):** with nodes selected, shows a bounding box — drag handles to scale, the top handle to rotate (Shift = uniform / 15° snap), the border to move; drag the **pivot** (ring marker, default center) to rotate around a marked point, double-click it to reset; Esc/Enter exits
- **Rectangle (M) / Ellipse (E) / Line (L) / Polygon (G) / Triangle (T):** drag to size with live preview (a tool gets a contextual options panel when it has settings — e.g. the Polygon tool's side count; see `ToolPanel`). A **"Draw from center"** toggle (`viewportStore.shapeFromCenter`, session-only; in the rectangle/ellipse/polygon/triangle tool panels) makes the drag grow symmetrically from the start point instead of corner-to-corner (`shapes.ts` `centerBox`, applied after `squareBox` so Shift still constrains; Line is point-to-point and unaffected)
- **Layer color coding:** each layer's paths + nodes are drawn in an auto-assigned color (matching its swatch in the Layers panel) — an editing aid only (`features/layers/layerColors.ts`; distinct from a contour's **fill `paint`**, which DOES export). Clicking any node on a visible+unlocked layer already activates that layer (the color coding just makes it discoverable).
- **Right-click:** canvas → edit actions (incl. **Transform** — opens the Ctrl+T box; disabled when nothing is selected); a layer row → layer actions (both from the command registry). The same actions are in the top-bar **Edit** menu; both menus show each command's shortcut
- **File menu:** Save | Import SVG…, Export SVGs… | Export project…, Import project…, **Restore previous version…** (recovery points — see Invariant 7)
- **Undo/Redo:** Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z), or Edit → Undo/Redo — **per-glyph** (Ctrl+Z only ever changes the glyph you're viewing; never an off-screen one), document ops only; pan, zoom, layer switch, and glyph create/delete are not undone
- **Nudge:** Arrow keys move the selected nodes 1 unit (Shift = 10). **Duplicate:** Ctrl/Cmd+D (in place). **Flip H/V** and **Reverse path direction** are in the canvas right-click menu (unbound by default, rebindable). All over the command registry (`editActions.ts`), one undo step.
- **Zoom:** Ctrl/Cmd+0 = zoom to fit, Ctrl/Cmd+1 = actual size (100%), Ctrl/Cmd+2 = zoom to selection (`view.zoomSelection` → `viewportStore.zoomToBounds`; falls back to fit when nothing is selected).
- **Shape tools + Shift:** rectangle→square, ellipse→circle, polygon/triangle regular, line→45° (via `squareBox` / `constrainAngle`).
- **Save:** Ctrl/Cmd+S (also File → Save) — explicit flush; the document also autosaves
- **Keyboard shortcuts** are all rebindable via Settings → Keyboard shortcuts (defaults above; Esc/Enter are reserved)
- **View modes (`viewportStore.viewMode`, session-only, mutually exclusive):** `edit`
  (fills + editing chrome), `outline` (Ctrl/Cmd+Shift+O — wireframe skeletons+nodes, fills
  hidden), and `final` (the exported look: rendered coloured fills only, editing chrome
  hidden, metric frame dimmed via `.metrics-faint`; a "Show path lines" toggle =
  `previewPaths` overlays the skeletons). `GlyphView` + `CanvasViewport` gate on it. Export
  is unaffected.
- **View menu (top bar):** grid show/snap/density, **snap to point** (anchors & paths), onion skin + opacity, reset view, the
  three view-mode toggles, the **Coordinate reference (1 u)** toggle (`viewportStore.unitRef`,
  session-only — a draggable screen-fixed legend, `features/canvas/components/UnitReference.tsx`, whose X/Y arms
  are exactly 1 world unit at the current zoom; mounted in the overlay group, hidden in final view),
  **adjustable typography guides** (ascender/cap-height/x-height/
  descender; **visual-only** — `viewportStore.guides`, read by `MetricGuides`/`MetricLabels`;
  do NOT change the em box, camera-fit, thumbnails, or export), and **Text preview…**. (This
  menu replaced the old floating View panel.)
- **Theme & accent (Settings menu):** the **Theme** nested submenu (`components/menu/SubMenu.tsx` —
  the menu bar's first real flyout submenu; `MenuItem` gained a `checked?` ✓ prop) picks **Dark /
  Light / Paper** (`Theme` type + a `[data-theme="paper"]` block; `setTheme`). An **Accent color**
  picker (`viewportStore.accentColor`, null = theme default) overrides `--accent` inline on `<html>`
  (App.tsx effect), recolouring every slider/toggle/active-chrome; both persist in settings v7.
- **Text preview window** (`features/preview/`): a modal that sets typed text in the
  project's glyphs with ~10% mono spacing for a quick read before FontForge. Pure layout
  in `textLayout.ts`; renders the same coloured fills via `layerFills.glyphFillGroups` (the
  shared per-glyph fill builder that `glyphToSvg` export also uses). Missing glyph = blank gap.
  A **Size slider** sets a fixed px/em scale (so glyphs never shrink to fit); long text **word-wraps**
  (`layoutText` `maxWidth`, sized to the measured stage width) and the stage **scrolls**.
- **Multi-selection "mixed" state:** when 2+ paths are selected, the Stroke & Color panels show a
  "N paths selected — edits apply to all" banner and a **mixed** indicator on the colour swatches
  (a "Mixed" badge) and the on/off toggles (`Toggle` `mixed` prop → indeterminate; clicking commits a
  definite ON). Edits already commit to **all** `targetIds` (so they were always applied to every
  selected path — this only fixes the misleading single-value display). Shape sliders keep showing a
  representative value. **Stroke shape edits PATCH per-contour** (`patchContourStroke`/`removeStrokeKeys`,
  not the whole-stroke `setContourStroke`), so changing a shape field on a multi-selection preserves each
  path's own stroke **colour/gradient** (and other differing shape fields) — the Stroke panel never writes
  colour. (`setContourStroke` whole-replace is reserved for the enable toggle + preset apply.) **Color
  edits patch per-contour too** (`patchContourPaint` / `patchStrokeGradient`): dragging Opacity over a
  red and a blue path keeps one red and one blue (it used to write the first path's paint to all).
  The Stroke panel also notes when selected paths are **baked** outlines, on which stroke/corner
  settings have no effect.
- **Information menu** (top bar, `features/info/InfoModal.tsx`): About / License / Legal / User guide in
  ONE modal with a sidebar. Each section is a Markdown file in `src/content/*.md` (imported `?raw`,
  rendered with **`marked`**) — easy to edit, can grow long. Content is trusted/bundled, so the HTML is
  injected directly (add a sanitiser only if untrusted content is ever shown). `src/vite-env.d.ts` was
  added so `?raw` imports type as `string`.
- **Sliders:** double-click a slider's label to type an exact value (clamped + step-snapped; `clampToStep` in `components/controls/Slider.tsx`). `NumberInput` also clamps TYPED values to `[min,max]` (the native min/max only bound the spinner arrows) — so e.g. export scale % can't be set to 0/negative.
- **Modals** (Export, Text preview, Keyboard shortcuts) all close on **Esc** (capture-phase, so it doesn't also reach the canvas). The tool controller handles **`pointercancel`** (an OS gesture / focus-steal mid-drag routes through the tool's pointer-up cleanup) so a drag can't get stuck. Destructive list deletes (Fill palette, Stroke preset) use a **two-click "Delete?" confirm** (settings aren't undoable).
- **Settings** (persisted): theme (dark/light/paper) + accent colour, handle grid lock, delete-splits-path, merge-endpoints-on-drag, merge-halftones-per-layer, align-by-outline

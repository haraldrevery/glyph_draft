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
npm run build        # production web build
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
verification narratively. The React-free **glue** is also covered now
(`clipboardActions.test.ts`, `mergeLayers.test.ts`, `documentStore.test.ts`,
`registry.test.ts` — all via `getState`, Paper headless where needed); only the
React components themselves (overlays, modals, panels) remain verified in-app.

## Verifying export (FontForge round-trip)

The tool's deliverable is FontForge-importable SVG, so confirm the round-trip after
touching `glyphToSvg`/`buildFillGroups`/winding:
1. File → Export… (100%); use a representative set — a solid letter, a counter via a
   **Subtract** pair, a **stroked** path, and a **merged/baked** layer.
2. In FontForge, open a glyph and **File → Import** each `u_xxxx.svg` (SVG format).
3. Confirm: outer shapes fill, **counters/holes punch through** (winding correct),
   nothing is inverted, advance width matches, artwork sits on the baseline as on
   canvas. Holes filling in or shapes inverting ⇒ a winding mismatch to fix in
   `glyphToSvg`/`buildFillGroups` (NOT by re-running `correctWinding` — see Invariant 4).

## Source Structure

```
src/
  engine/                        # Framework-free, pure domain logic
    viewport/transform.ts        # THE ONLY place the world↔screen Y-flip lives
    snapping/snap.ts             # Pure snap-to-grid (world units)
    geometry/
      GeometryService.ts         # Boolean/winding interface (union/subtract/intersect/exclude)
      geometryEngine.ts          # getGeometryService() — the single swap point (→ Paper)
      PaperGeometryService.ts    # LIVE impl: Paper.js, curve-exact booleans
      PolygonGeometryService.ts  # Test-only impl: dependency-free, flattens curves to polylines
      clip.ts                    # Planar-arrangement boolean clipper (the polygon ops)
      polygon.ts                 # Low-level polygon math: flatten, winding number, simplify
      path.ts                    # Bezier path math + SVG `d` serialization (absolute coords)
      svgPath.ts                 # Pure SVG path-`d` PARSER (M/L/H/V/C/S/Q/T/A/Z + relative; arc→cubic) for import
      primitives.ts              # makeLine/makeRectangle/makeEllipse/makePolygon — always CW winding
      topology.ts                # Pure node topology: extractContours (split/cut), joinContours (merge), splitContourAtPoints (multi-cut: scissors/knife/eraser; splitContourAt = single-cut wrapper)
      affine.ts                  # Pure 2D affine (transform box): scale/rotate/translate + transformSelected
      align.ts                   # Pure align/distribute math (contourBounds + alignDeltas) for the Align panel
      winding.ts                 # Winding detection and correction (nesting-depth based)
      freehand.ts                # Pure freehand fit: simplifyRDP + fitFreehand (Catmull-Rom handles, corner/close detection) for the pencil tool
      corners.ts                 # Pure per-path corner pre-pass: roundCorners (round/chamfer/invertedRound, clamped) — non-destructive, run in renderContours before stroke-expand/export
  state/
    viewportStore.ts             # Zoom/pan/grid/theme — NOT undoable
    documentStore.ts             # Glyphs/layers — plain store; undo/redo is per-glyph (see history.ts)
    history.ts                   # PER-GLYPH undo/redo (Map<glyphId,{past,future}>, limit 200) — useHistoryStore/useHistory; structural glyph add/delete not recorded
    editorStore.ts               # Live ephemeral state (pen in-progress, drag) — NOT undoable
    clipboardStore.ts            # Clipboard — survives undo and tool switches
    onionStore.ts                # Onion-skin state — NOT undoable
    glyphHelpers.ts              # createGlyph, glyphLabel, parseGlyphInput, exportFileName
    persistence.ts               # Document: load-on-launch + debounced autosave + saveNow + useSaveStatus
    settings.ts                  # Preferences: load-on-launch + debounced autosave (separate KV key)
  storage/
    StorageService.ts            # KV interface everything talks to
    LocalForageStorage.ts        # Web adapter
    TauriStorage.ts              # Desktop adapter (lazy-loaded, code-split)
    createStorage.ts             # Memoized platform factory
    platform.ts                  # isTauri() — checks window globals, no tauri import
    projectFile.ts               # Versioned document format + migrate() seam (corruption-safe)
    settingsFile.ts              # Versioned PREFERENCES format + migrateSettings/mergeSettings (defaults-fallback)
  features/
    canvas/                      # Main viewport, grid, HUD, tool controller
      CanvasViewport.tsx
      ViewMenu.tsx               # View top-bar menu body: grid/snap/onion/reset + outline + adjustable typography guides (replaced the old floating ControlPanel)
      ToolPanel.tsx              # Contextual ACTIVE-tool options (view-layer TOOL_PANELS map by ToolId)
      StrokePanel.tsx            # Per-path SHAPE only: path Corners (round/chamfer/inverted) + stroke editor (width/cap/join/serif/drop/nib + width & nib-angle profiles + preset library + brush model). NO colour — all colour lives in the Color panel (FillPanel.tsx). Shape edits PATCH each path's own stroke (setContourStroke→patchContourStroke/removeStrokeKeys), so editing e.g. width on a multi-selection never overwrites each path's stroke colour/gradient
      FillPanel.tsx              # The **"Color" panel** (movable HUD, panel id "fill") — ALL colour, both fill and stroke. A **Fill section**: a "Fill interior" toggle (Contour.filled, independent of stroke — setContourFilled) gating colour swatch/hex + preset inks + recent + saved-palette swatches (colorPaletteStore) + opacity + gradient + a separated "Manage palette" row. A **Stroke section**: a Stroke-colour swatch (StrokeStyle.color via setStrokeColor) + a **stroke Gradient** (StrokeStyle.gradient via setStrokeGradient, with an "Along path" toggle — both only touch contours that already have a stroke). Over the Contour.paint / stroke.color / stroke.gradient seams; hint when an open path can't be filled
      useEditTargets.ts          # Shared hook: the target contours (selected-anchor paths across unlocked layers, else active layer) used by BOTH StrokePanel and FillPanel
      GraphEditor.tsx            # SVG control-point editor for the width/nib-angle profiles
      Toolbar.tsx
      layerFills.ts              # buildFillGroups (active glyph, live) + glyphFillGroups (per-glyph, cached) — strokes + booleans + group-by-PAINT → live results (non-destructive); boolean-pair result inherits operand A's/B's paint (firstPaint)
      fillPaint.ts               # Pure linearGradientSpec(group) — turns Paint.gradient into {id,transform,stops} for the canvas/preview/export renderers (objectBoundingBox; Y-flip-aware; DOM-safe id)
      editActions.ts             # React-free nudge/flip/reverse + move-to-layer, merge-endpoints, align — over the node selection (one undo step)
      useGlyphContours.ts        # Render selectors (visible/editable layers; liveContours across layers)
      hooks/usePanZoom.ts        # Space+drag, middle-drag, wheel zoom/pan
      hooks/useToolController.ts # Routes pointer events to active tool; Esc/Enter only
      components/                # Grid, EmSquare, MetricGuides, MetricLabels,
                                 # SnapIndicator, CoordinateReadout, EditOverlay,
                                 # GlyphView, OnionSkin, PreviewLayer, LassoOverlay,
                                 # MarqueeOverlay, TransformBox, AlignPanel
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
    layers/                      # LayersPanel, LayerRow, mergeLayers (destructive flatten),
                                 #   layerColors (auto per-layer editing palette)
    glyphs/                      # GlyphSidebar (resizable: right-edge drag handle → viewportStore.sidebarWidth; drag left to collapse to a re-open grip; "Reset view" restores 212px/expanded), GlyphCell, GlyphThumbnail, glyphSets (set templates)
    settings/                    # KeybindingsModal — the keyboard-shortcut editor
    clipboard/
      useClipboard.ts            # React entry for copy/cut/paste-in-place (layer-aware)
      clipboardActions.ts        # React-free copy/cut(node-aware split)/paste/selectAll
    boolean/                     # info.md only — the Pathfinder UI lives in the
                                 #   Layers panel; combine is canvas/layerFills.ts
    export/                      # Phase 6 — bulk SVG export
      glyphToSvg.ts              # Pure glyph→SVG string (reuses buildFillGroups; optional synthetic style; optional `silhouette` flag → every region flat solid black, no colour/gradient/opacity, holes preserved — FontForge-ready)
      styleTransform.ts          # Export-only synthetic Bold/Italic: transformContours (skew/stretch the FINAL outline) + extendOutlineX (x-only smear/erode)
      ExportService.ts          # Platform seam + createExportService() factory
      WebExportService.ts       # Web impl: fflate zip + browser download
      TauriExportService.ts     # Desktop impl: folder picker + FS write (lazy)
      ExportModal.tsx           # Scale-% + synthetic-style modal (opened from File → Export…)
    import/                      # SVG import — drops imported art on a new (baked) layer
      svgImport.ts              # DOM walk → flatten transforms + Y-flip + fill→paint + correctWinding → Contour[]
    preview/                     # Text-preview window: type a string, see it in the glyphs
      textLayout.ts             # Pure mono text layout (advances, blank gaps, \n breaks + optional maxWidth word-wrap)
      TextPreviewModal.tsx      # Modal renderer (reuses layerFills.glyphFillGroups, coloured). A Size slider (px/em) sets a FIXED glyph scale; text word-wraps to the measured stage width (ResizeObserver) and the stage scrolls — long text stays readable instead of shrinking to fit
    project/                     # Portable PROJECT file (whole document) — web ⇄ desktop
      ProjectIOService.ts       # Platform seam + createProjectIO() factory
      WebProjectIO.ts           # Web impl: Blob download + hidden file-input
      TauriProjectIO.ts         # Desktop impl: save/open dialog + FS (lazy, code-split). ⚠️ Desktop dialogs/FS need the Rust side wired: `src-tauri/Cargo.toml` + `lib.rs` register BOTH `tauri-plugin-fs` AND `tauri-plugin-dialog`, and `capabilities/default.json` grants `dialog:default` + BROAD `fs:allow-read/write-text-file` (`**`/`$HOME/**`) for user-PICKED files (project .glphdrft anywhere, SVG export folder) — distinct from the `$APPDATA/**`-scoped FS the autosave StorageService uses. (The dialog plugin was missing → import/export/SVG-export silently failed on desktop.)
      projectActions.ts         # serialize / applyImportedProject (reuses projectFile envelope + migrate)
  commands/                      # Command registry — the single source of actions + keybinds
    types.ts                     # Command, KeyChord
    registry.ts                  # COMMANDS[], matchKey(), commandMenuItems()
    useCommandKeys.ts            # The ONE global keyboard entry point
  components/
    controls/                    # Toggle, Slider, NumberInput, Knob (rotary angle picker)
    menu/                        # MenuBar, Menu, MenuItem (header) + ContextMenu (right-click, supports nested submenus — the open submenu is PORTALED to <body> at fixed coords so it escapes the list's vertical scroll container; an in-place left:100% flyout otherwise just made the menu scroll horizontally. The outside-pointerdown close-handler ignores clicks inside `.context-menu-root` OR a portaled `.context-menu-submenu` — else a submenu click closed the menu before its onSelect ran, e.g. "Move to layer" appeared to do nothing)
    SaveStatus.tsx               # Header autosave indicator (reads useSaveStatus)
    ErrorBoundary.tsx            # Root render-error boundary (wraps <App/> in main.tsx) — shows a reload panel instead of a white screen; work is autosaved
  utils/
    dom.ts                       # isEditable() — shared "is a text field focused?" guard
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
  object recomputes); `layerFills.glyphFillGroups` memoizes per `Glyph` (a `WeakMap`). The caches
  are **transparent** (identical outputs — proven by the geometry suites passing unchanged) and
  **self-evicting** (`WeakMap`s drop replaced objects). They are correct **only because** of the
  immutability rule: a changed object is a new identity = a cache miss; mutating in place would
  return stale geometry. Callers must treat cached outputs as read-only.

### 4. Winding Rules
- Outer contours: **clockwise** (in Y-up world space, CW = negative signed area via shoelace)
- Inner contours / holes: **counter-clockwise**
- `primitives.ts` always runs new closed shapes through `ensureWinding(_, "cw")`
- `GlyphView` fills closed contours as `<path fill-rule="nonzero">` so CCW holes punch through
- **Unstroked contours within a single layer never make a hole by winding** — `buildFillGroups` forces every *unstroked* closed contour to CW, so they fill as one **solid union** under nonzero. A hole legitimately appears three ways: (a) a **stroked path's expanded outline** (a closed stroked path becomes a frame with a CCW hole — `expandStroke` via `layerFills.ts`); (b) a between-layer **Subtract** (Invariant 5); and (c) a **baked/merged layer** (`Layer.baked` — Phase F), whose contours `renderContours` returns **verbatim** (the deliberate exception to force-CW, so baked holes survive). All three carry CW-outer / CCW-hole winding; ordinary unstroked overlaps still never cancel.
- **Fill and stroke are INDEPENDENT (projectFile v7).** `renderContours` emits a contour's interior
  fill and its stroke outline **separately**, so a single closed path can have **both** a filled
  interior AND a stroke outline (two fill groups). Two optional, legacy-defaulted fields drive it:
  `Contour.filled?` (interior on/off; **undefined ⇒ the legacy rule** `closed && !stroke && paint.fill !== "none"`)
  and `StrokeStyle.color?` (outline colour; **undefined ⇒ legacy fallback to `Contour.paint`**). So with
  neither field set the output is **byte-identical** to the old if/else (`stroke` ⇒ outline-only,
  unstroked closed ⇒ solid fill) — fill+stroke together happens only when a user explicitly sets
  `filled: true`. The interior carries `paint`; the outline carries `{ fill: stroke.color } ?? paint`.
  Edited in the **Color panel** (`FillPanel.tsx`): a "Fill interior" toggle (`setContourFilled`) for the
  interior, and a "Stroke" section with a colour swatch (`setStrokeColor` → `stroke.color`) **and a stroke
  Gradient** (`setStrokeGradient` → `stroke.gradient`, a `GradientFill` — both applied only to contours that
  already have a stroke). The Stroke panel is **shape-only** (no colour). v6→v7 migration is the identity.
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
  so colour is purely opt-in. Set via `documentStore.setContourPaint` (cross-layer, one undo
  step). A **boolean-pair result inherits a paint from its operands** — the first non-default
  paint on operand **A** (the upper layer), else operand **B** (`firstPaint` in `layerFills.ts`);
  all-default operands stay paint-less (black), byte-identical to before. A **baked** layer renders
  its contours' OWN paint verbatim — merge (`mergeLayers.ts`), SVG import (`svgImport.ts`), and
  expand-stroke (`editActions.ts`) each carry per-contour paint onto the baked contours. The one
  exception: a baked **boolean-pair** result reverts to default-black, because the pair's inherited
  paint lives on the fill GROUP, not on its contours, so the merge (which copies per-contour paint
  only) drops it. (projectFile **v3** added
  the field; the v2→v3 migration is the identity. **v4** later added the per-contour `corner?` the
  same additive way — v3→v4 is also the identity. **v5** added the optional `Paint.gradient`
  (a two-stop linear gradient) the same additive way — v4→v5 is also the identity. **v6** added the
  `"blend"` pair op; **v7** added `Contour.filled?` + `StrokeStyle.color?` (independent fill & stroke)
  — both additive identities.)
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
- **The non-destructive Pathfinder is the sanctioned cross-layer combine.** A `Glyph.booleanPair` joins **exactly two** layers with an op (`union`/`subtract`/`intersect`/`exclude`, or `blend` — the A→B morph echo, Phase M). At RENDER and EXPORT time (**never** in the data) `buildFillGroups` calls the geometry service on the two layers — **upper = operand A, lower = B** (Subtract = A − B) — emits one result group at the lower layer's paint position (inheriting A's paint, else B's), and suppresses both operands' own fills. Both layers stay separate and editable; moving either updates the result live. **Curves preserved** (Paper.js). A layer is in **at most one** pair (no entangled ops).
- So fill is per-layer **except** for an explicit boolean pair. Do **not** make ordinary layers' fills interact; only paired layers combine, and only through `buildFillGroups` (which Phase 6 export reuses via `glyphToSvg`, so the exported SVG carries the same results).
- Each operand layer is unioned ("fully rendered") before the op, so multi-contour layers don't glitch. Unlike the old cutter, a Subtract pair is a true boolean, so a B that **crosses** A's edge clips correctly (no overhang caveat).

### 5a. Two Selections (Phase 5)
There are **two independent selections**:
- **Layer selection** — `documentStore.selectedLayerIds` (always includes the active layer). Plain-click a panel row = select only it; **Ctrl/Cmd+click toggles** layers in/out (`toggleLayerSelection`); **Shift+click selects the inclusive range** from the active anchor to the clicked row (`selectLayerRange`, anchor stays active). Not undoable; pruned in `reconcileActive`; reset to the active layer on any plain activation / glyph switch. **The Pathfinder uses this:** when exactly two layers are selected, the Pathfinder bar offers the four ops on that pair. (The resulting pair itself is stored in `Glyph.booleanPairs`, not in the selection.)
- **Anchor selection** — `editorStore.selection`, layer-aware `PointRef[]` (`{ layerId, contourId, pointId }`, `sameRef` compares all three). Drives **node editing**, and is **decoupled from the layer selection** (Illustrator-style): every selection op — single click (`hitTestLayers`), select-all (Ctrl+A), lasso, and marquee — works over **ALL visible + unlocked layers** (`editableLayers` in `tools/shared.ts`), regardless of which layer rows are in `selectedLayerIds` (that set only drives the Pathfinder). `EditOverlay` shows anchors for every editable layer (non-active dimmed). A node DRAG (select tool or lasso) now moves the **whole cross-layer selection** in one undo step (`originForRefs` + `replaceContoursEverywhere`); transform box / nudge / flip / align act cross-layer too. Clicking an anchor still activates its layer so NEW geometry lands there. The **LayersPanel tints every layer owning a selected node** (`.layer-row-involved`, a faint cue derived from `selection`'s `layerId`s) — deliberately weaker than the active/selected row styling, so the user sees which layers a cross-layer edit will touch without it competing with the Pathfinder selection.

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
  > **CURRENT persisted formats: projectFile = `v7`, settings = `v7`** (the source of truth is
  > `CURRENT_VERSION` in `projectFile.ts` / `SETTINGS_VERSION` in `settingsFile.ts`). Throughout this
  > doc each field is annotated with the version it was **added in** (e.g. "projectFile v6 added blend");
  > those are history, not the latest — `v7` is current for both.
- **`state/persistence.ts` owns the lifecycle** (not the stores): `initPersistence()`
  loads on launch (main → `…bak` backup → in-memory seed; an unreadable blob is
  parked under `…corrupt`, not discarded) then starts a **debounced autosave** on
  every `glyphs` change. `saveNow()` (File → Save / Ctrl-Cmd+S) flushes immediately.
  Writes **double-buffer** (promote current main → backup before overwrite; KV has
  no atomic rename). Status flows through the `useSaveStatus` store → `SaveStatus`.
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
Glyph sidebar (left, code-point sorted). `addGlyph(codepoint)` enforces one glyph per code point. `deleteGlyph` always keeps at least one, reassigns active to next/previous. `GlyphThumbnail` uses same Y-flip as canvas, and renders through **`glyphFillGroups`** — the canonical per-glyph fill builder shared by the export (`glyphToSvg`) and the text-preview window (so thumbnails match the canvas, incl. **baked** layers; routing it through the shared builder fixed an earlier bug where the thumbnail dropped the `baked` flag). `onionStore` (non-undoable): enabled, opacity, referenceIds, **renderSvg**. Ghosts render behind active glyph in shared coordinate space, in blue-grey (not ember accent). Deleted glyph auto-removed from references. **Two ghost modes** (View → "Ghost: rendered output", `onionStore.renderSvg`, persisted): the raw contour skeleton (default — naive nonzero fill + outline), or the **true rendered output** (expanded strokes/booleans/baked layers) via `glyphFillGroups` as a monochrome silhouette — the same builder `GlyphThumbnail`/export use.

**Glyph set templates + delete (later addition):** a top-bar **Glyphs menu** adds a run of code points via `documentStore.addGlyphs(codepoints[])` (skips existing → idempotent; keeps the active glyph). The four sets live in `features/glyphs/glyphSets.ts` (English, Scandinavian extras, digits & math, keyboard symbols incl. Swedish). **Right-click a glyph cell → "Delete glyph"** (a `ContextMenu` hosted by `GlyphSidebar`) opens a **confirm dialog** before calling the existing `deleteGlyph` (which keeps ≥1) — disabled on the last glyph. **(Per-glyph history: glyph create/delete are structural ⇒ NOT undoable via Ctrl+Z — the confirm dialog is the safety net for delete.)**

**Phase 5 — Non-Destructive Pathfinder between Two Layers**

A live, **curve-exact**, **non-destructive** boolean between **exactly two layers**. Ctrl/Cmd+click two layer rows → the **Pathfinder bar** appears → pick **Union / Subtract / Intersect / Exclude**. The **upper** layer is operand **A**, the **lower** is **B** (Subtract = A − B). The result renders live; **both source layers stay separate and fully editable** — move/reshape either and it updates instantly. A layer is in **at most one** pair (no entangled ops). The Subtract case covers wishlist #17 (the old "transparent hole" — now a real boolean, so a B that crosses A's edge clips correctly). The earlier *destructive* Pathfinder (consumed layers) and the interim *cutter* toggle were both replaced by this one unified model.

- **Data:** `Glyph.booleanPairs` (`BooleanPair { id, layerIds: [a, b], op }`). Set via `documentStore.setBooleanPair` (exclusive: re-pairing a layer drops its old pair) / `clearBooleanPair`; pruned when a member layer is deleted. One undo step. Geometry is **never** mutated — results are render/export-time only.
- **Render:** `buildFillGroups` (`features/canvas/layerFills.ts`) calls the geometry service for paired layers (upper = A, lower = B), emits one result group at the lower layer's position, and forces each unpaired layer to a solid union. `GlyphView` memoizes the build over layers + pairs and draws each operand's outline **dashed in the accent**. **Phase 6 export reuses `buildFillGroups`** (via `glyphToSvg`) so exported SVGs carry the same results.
- **Engine:** `PaperGeometryService` (Paper.js) — curve-exact. Each operand layer is unioned ("fully rendered") before the op so complex layers don't glitch.

**Carried over / still here:**
- `PolygonGeometryService` (`engine/geometry/clip.ts`) stays behind `GeometryService` for the **DOM-free unit tests** (injected directly); the live seam points at Paper.
- Layer multi-select (`selectedLayerIds`, Ctrl/Cmd+click — now the Pathfinder's operand picker) and cross-layer anchor selection (`PointRef.layerId`, see 5a) remain.

**Notes / caveats:**
- Simultaneous multi-layer NODE editing is **shipped** — a node drag (select tool or lasso) moves the whole cross-layer selection in one undo step (`originForRefs` + `replaceContoursEverywhere`); transform box / nudge / flip / align act cross-layer too (see Invariant 5a). Clicking an anchor still activates its layer so NEW geometry lands there.
- Pathfinder UI behavior (bar, pair badge, live result render) is covered by typecheck + unit tests (`layerFills.test.ts`, `PaperGeometryService.test.ts`, `documentStore.test.ts`) + build, **not** by an automated interaction test — verify in-app when touching `layerFills.ts`, `GlyphView`, `LayersPanel`, or `LayerRow`.

**Phase 6 — Export**

Bulk export of **every** glyph as an individual `u_xxxx.svg` (lowercase hex, no
`+` — via `exportFileName` in `glyphHelpers.ts`), triggered from **File →
Export…** in the header menu bar. The modal offers a **universal scale %** applied
on export. Desktop writes the files to a picked folder (Tauri dialog + FS,
lazy-loaded); web downloads a single zip (`fflate`).

- **SVG builder:** `glyphToSvg` (`features/export/glyphToSvg.ts`) reuses
  `buildFillGroups` so the export carries the same Pathfinder results as the
  canvas (Invariant 5). It Y-flips world→SVG via one wrapping `<g transform>` and
  frames the `viewBox` to the em box (descender..ascender by the glyph's advance
  width) in unscaled font units, so the scale % resizes only the artwork. Winding
  is preserved from the pipeline, not re-normalized (see Invariant 4).
- **Platform seam:** `ExportService` + `createExportService()` branch on
  `isTauri()` to `WebExportService` (zip) or `TauriExportService` (folder write),
  the Tauri impl dynamically imported so the web bundle stays `@tauri-apps`-free.
- **UI:** the header is now a `MenuBar` (`components/menu/`) — File → Export…,
  Settings → Dark theme — with `ExportModal` mounted at the app root.
- **Tested:** `glyphToSvg.test.ts` (viewBox/Y-flip/scale/hidden-layer/Subtract
  hole) + `exportFileName` cases. Modal/menu interaction is verified in-app.

**Phase 7 — Non-Destructive Per-Path Strokes**

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
Tested in `strokeOutline.test.ts`. **See the "Strokes — current state" block below; the
serif/drop/brush specifics evolved past this paragraph.**

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
    **Debt-smart note:** `mergeHalftones` is the FIRST render-affecting global flag threaded as a
    positional param through `buildFillGroups`/`glyphFillGroups`. If a SECOND such flag is ever needed,
    switch these to a single `RenderOptions` object (and key the cache on it) rather than adding another
    positional boolean — one flag is fine, two would make the signatures noisy.
- **Terminal-handle cap angle** (the deferred Stage-5 feature, now shipped): the first
  node's `handleIn` / last node's `handleOut` are read as the cap **axis** — butt caps
  re-cut along it (`angledTerminal`), rectangle/serif take it as their `angle` when no
  panel angle is set. Driven by the existing handle-drag; collapse-to-corner = "auto".
- **Rectangle cap `anchor`** (`"node"` default / `"outward"`): the box can grow inward or
  project past the node. The `square`→`rectangle` v1→v2 migration still applies.
- **Per-end cap A/B algorithm variants** (`RectCapStyle`/`SerifStyle`/`DropStyle` each carry an
  optional `variant?: "a" | "b"`; absent = `"a"` = the prior look, so **NO migration** — same
  additive pattern as the profiles). A small per-end "Algorithm" `<select>` in `StrokePanel`'s
  `EndControls` picks it. The B paths are **isolated constructive functions** (unioned/cut in the
  finishing pass) that do **not** touch the sampled-outline machinery, so the A paths can't regress:
  - **Rectangle A (rewritten):** `withCap` now unions `rectCap` then **slices off any body past the
    far-edge plane** (`rectFarCut`, ⟂ the cap axis) — so a tilted/narrow slab can't leave the stem's
    butt corners sticking out (the old union-box bug). Auto (far edge ⟂ tangent on the node) cuts
    nothing ⇒ byte-identical to before. **Rectangle B:** `rectFlareB` — a SEAMLESS constructive flare
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
**merge endpoints on drag** (`joinContours` → `documentStore.joinEndpoints`, same
layer only; the `mergeEndpoints` setting). New split ends get butt caps. Tested in
`topology.test.ts` + `documentStore.test.ts`.

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
fully within the set is applied) into ONE layer with `Layer.baked = true`, removing
the sources and their pairs. Geometry is computed in `features/layers/mergeLayers.ts`
(keeps Paper.js out of the store); the store action `commitMerge` does only the array
surgery (one undo step). A **baked layer renders verbatim** — `renderContours`
returns its contours as-is (winding preserved for holes, no stroke expansion, no
force-CW), the deliberate exception to Invariant 4's force-CW rule. (Blend/echo
shipped later — Phase M.)

**Phase G — Path↔layer ops, Align, Fill paint**

- **Move to layer:** canvas right-click → **"Move to layer ▸"** submenu (all layers +
  "New layer") moves every whole path that has a selected node, via
  `documentStore.moveContoursToLayer` / `moveContoursToNewLayer` (one undo step). Needed
  the new **`ContextMenu` submenu** support (`submenu?: ContextMenuItem[]`).
- **Merge nodes:** `joinEndpoints` generalised to **cross-layer** — two selected open-path
  endpoints join into one path on the SECOND node's layer (same-layer + close-in-place still
  work). Exposed as the `edit.mergeNodes` command (self-hides unless exactly two endpoints).
- **Align panel:** a floating Illustrator-style panel (`features/canvas/components/AlignPanel.tsx`,
  shown when ≥2 paths selected) over a pure engine `engine/geometry/align.ts`
  (`contourBounds`, `alignDeltas` for left/centerH/right/top/middleV/bottom + distribute,
  relative to the selection bbox). Applied via `editActions.alignSelectedPaths` →
  `replaceContoursEverywhere` (one undo step).
- **Fill paint (the colour seam):** optional `Contour.paint` (see Invariant 4's paint bullet
  + the `setContourPaint` action + the StrokePanel "Fill" section). The chosen foundation
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
- **Lands as a `baked` layer:** `documentStore.addImportedLayer(contours, name)` inserts the art
  on a NEW layer above the active one and marks it **`baked`** so `renderContours` returns it
  **verbatim** — preserving the import's holes (correct winding) and colours, with no force-CW or
  stroke expansion (the Invariant 4 baked exception). One undo step.
- **UI:** a hidden `<input type=file>` (created + clicked synchronously to keep the user gesture),
  wired to **File → Import SVG…** in `App.tsx`. Cross-platform (works in the web tab and the Tauri
  webview) — no new platform seam needed.

**Phase I — Expand stroke** (centerline + `stroke` → editable filled outline)

Right-click a selected stroked path → **Expand stroke** bakes its non-destructive stroke into the
literal filled outline (the SAME geometry `buildFillGroups` draws) as real, node-editable contours.
The lowest-risk wishlist item — it reuses `expandStroke` + the `baked` render path verbatim, so
there's no new geometry and no model change.

- **Engine reuse:** `editActions.expandSelectedStrokes` calls `getGeometryService().expandStroke(c,
  c.stroke)` for each selected path that has a `.stroke`, carrying `c.paint` onto each outline piece
  (exactly like `renderContours`). `canExpandStrokes` (≥1 selected path is stroked) self-hides/disables
  the command.
- **Lands as a `baked` layer:** `documentStore.expandStrokesToLayer(expanded, removeRefs)` drops the
  originals (their centerline+`stroke`) and inserts ONE new **`baked`** layer (above the active one)
  with the outline — so its holes/winding survive (a stroked closed path → annulus). One undo step;
  the array surgery stays in the store, the Paper call stays in `editActions` (the `commitMerge`
  pattern). Result is consumed-in-place semantics: same shape, now an outline instead of a recipe.
- **UI:** `edit.expandStroke` in the command registry (right-click canvas menu via `CANVAS_MENU`,
  rebindable, self-hiding). Tested headless in `expandStroke.test.ts` (outline replaces the stroke on
  a baked layer, original gone, one-undo round-trip, no-op without a stroke).

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
  `BooleanPair.op: PairOp` + optional `steps?`. Added at projectFile **v6** (additive; v5→v6 identity; current is v7).
- **Engine:** pure `engine/geometry/blend.ts` `blendContours(a, b, steps)` → `steps + 2` step sets
  (endpoints incl.), each carrying the source contour's `stroke`/`paint`/`corner` (stroke **width** morphs).
  Two paths: **matching structure** (same contour + point counts) → exact per-anchor lerp that preserves
  béziers; **different shapes** → each matched contour is arc-length **resampled** to a common point count
  and cyclically **aligned** (min Σ-distance, so the morph doesn't twist) then lerped as polylines; different
  **contour counts** pair greedily by centroid and unmatched paths collapse to a point. `null` only when a
  side is empty. Reuses `flattenContour`/`ringSignedArea`/`cubicAt`. DOM-free, tested.
- **Render:** a `pair.op === "blend"` branch in `buildFillGroups` (before the boolean `geom[op]`) blends the
  **raw** contours (lower→upper z) and renders **each step through `renderContours` + `groupByPaint`** — the
  normal layer path — so strokes expand, corners apply, holes/winding behave, and per-path colour survives.
  `null` (an empty operand) ⇒ fall back to rendering both operands. The 4 boolean ops are untouched.
- **Colour:** the whole echo takes **operand A's (upper layer's) paint** (`carryStyle` uses `cb.paint`),
  regardless of B's colour. Stroke style/corner come from whichever side has them; stroke width morphs A↔B.
- **Cost:** unstroked steps are cheap (lerp + nonzero fill). **Stroked** steps re-expand their outline via
  Paper **per step, per render** (heavy when dragging a blended layer), so the Pathfinder bar shows a perf
  **warning** at a high step count (`blendCostly` in `LayersPanel`: stroked ≥ 8 steps, or any ≥ 24). The
  resampling itself (`alignCyclic` is O(K²), K capped at 256) is minor by comparison.
- **UI:** a **Blend** button in the Pathfinder bar (`LayersPanel`) + a **steps** `NumberInput` when a blend
  pair is active; the pair badge shows `≈`. **Scope:** handles outlined/multi-path/coloured/corner layers and
  morphs genuinely different shapes (and path counts). Caveat: resampled in-between steps are **polyline
  approximations** (not editable béziers) — fine for the transient echo; A↔B colour interpolation is not done
  (steps take the source contour's paint).

### Future seams (deferred wishlist — keep these cheap, build only on demand)

**The artist wishlist is essentially complete.** Only a handful of items are genuinely open, listed
below **ranked by entanglement** (how many subsystems each couples = future-debt risk). The debt-smart
rule: every new feature lands ON an existing seam, model fields stay **optional + migration-guarded**,
and the Tier-2/3 seams below stay DOCUMENTED intentions — **built only when an artist actually asks
(YAGNI), never pre-built.** The genuinely-open items are: **per-NODE corners**, **cap designer**, and
**dynamic alignment "smart guides"** (Tier 1, ride existing seams); **procedural/L-system brushes**
(Tier 2 — isolated as a new `model` but perf-heavy/experimental); **i18n/language** (Tier 3 —
cross-cutting, defer hard). Everything else below is marked Shipped and kept for the design rationale.

- **Tier 1 — isolated, rides an existing seam (safe anytime):**
  - **Colour picker UI** → the `Contour.paint` seam (`setContourPaint` / StrokePanel `applyPaint`). Pure UI. **(Now shipped — richer Fill palette: presets + recent + hex, over the existing native swatch.)**
  - **Rotate around a marked point** → **Shipped** — a draggable **pivot** on the Transform box (Ctrl+T): the rotate handle rotates the selection around the marked pivot (default = box center; double-click the pivot resets it), reusing `affine.rotateAbout`. Implemented as a transform-box pivot, NOT a separate tool — a standalone Rotate tool was rejected because switching tools clears the selection (Invariant: `setTool` resets selection), which would wipe what you mean to rotate.
- **Tier 2 — additive, touches ONE pipeline (behind a reserved seam):**
  - **Stroke decorators** (dashed/dotted/**custom-SVG-along-line**) → **Shipped** as an isolated **`model: "dash"`** brush (a top-level early return in `expandStroke`, like halftone — see "Strokes — current state"). This proved SAFER than the earlier "decorator post-pass" idea (a new model can't touch the offset/brush/serif code at all). Still deferred: simple dash/pattern decorators on the *existing* offset/brush models (vs. the dash model replacing the ribbon).
  - **Cap designer** (custom serif/teardrop shapes): a custom-cap-shape type fed into the cap stage; reuses the cap A/B variant machinery.
- **Tier 3 — model + multi-pipeline fan-out (design the additive seam first):**
  - **Rounded corners (general):** **Shipped** — a per-contour `Contour.corner?` (round/chamfer/inverted) + the pure render-time pre-pass `engine/geometry/corners.ts` `roundCorners` plugged into `renderContours` (before stroke-expand/booleans/export). Per-NODE corners (select individual anchors) remain a future extension on the same engine.
  - **Custom-SVG-on-line decorator:** **Shipped** — the dash `model:"svg"` imports an SVG and tiles it
    along the line (scaled + rotated to the tangent; `DashStyle.pattern`). The ONLY open remnant is the
    niche "decorate the *existing* offset/brush ribbon" (vs. the dash model replacing it) — low value,
    deferred (see the Tier-2 note).
- **Tier 4 — genuinely cross-cutting; defer deliberately:**
  - **Blend/echo between layers** → **Shipped** as the 5th pair op on the `Glyph.booleanPairs` seam — see Phase M. Handles outlined/multi-path/coloured/corner layers and morphs genuinely different shapes (arc-length resampling + cyclic alignment; different path counts collapse to a point). Only remaining caveat: resampled in-between steps are polyline approximations (not editable béziers), and A↔B colour isn't interpolated.
  - **Procedural/L-system brushes** (perf-heavy, experimental) and **i18n / language** (touches every user-facing string — a "massive rewrite").

(Free-hand pen — Phase J; **scissors/knife/eraser** — Phase K/L, on
`splitContourAtPoints`/`lineCrossings`/`nearestPointOnContours`.)

### Not Yet Implemented

The wishlist is essentially complete; only these remain open (see "Future seams" for the entanglement
ranking and the build-on-demand rule):
- **Cap designer** (custom serif/teardrop cap shapes) — Tier 1, rides the cap A/B `variant` machinery.
- **Per-NODE corners** (select individual anchors) — Tier 1, an extension of `engine/geometry/corners.ts`
  (per-*path* `Contour.corner` is shipped).
- **Dynamic alignment "smart guides"** (live alignment lines while dragging) — Tier 1, an isolated drag-time
  overlay (static "Snap to point" + the Align panel are already shipped).
- **Procedural / L-system brushes** (perf-heavy, experimental) — Tier 2, would be a new `StrokeStyle.model`
  early-return (like `halftone`/`dash`).
- **i18n / language** — Tier 3, cross-cutting (every user-facing string); deferred deliberately.
- (Niche) **decorators on the existing offset/brush ribbon** — low value now that `model:"dash"` ships
  dashes/dots/custom-SVG-along-line.

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
| Rectangle/angled terminal cap | **Shipped** — parametric `rectangle` cap (`RectCapStyle`: far edge on the node, `size`/`ratio`/`radius`, world-absolute flat-edge `angle`) with a selectable **A/B** (`variant`): A = a **crisp re-cut slab** (no protruding corners), B = a **seamless flare**. Replaced the old fixed `square` (v1→v2 doc migration) |
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
| Rebindable keyboard shortcuts | **Shipped** — Phase C (editor over the registry, persisted) |
| Settings persistence (theme/grid/prefs survive reload) | **Shipped** — Phase C; separate versioned key, defaults-fallback |
| Advance width per glyph (UI) | **Shipped** — editable in the glyph sidebar (`setAdvanceWidth`); live em-box/guide feedback; export framing reflects it |
| Single-glyph export | **Shipped** — Export modal "Active glyph" scope → one `.svg` (web direct download / desktop save dialog) via `ExportService.exportSingle` |
| SVG import | **Shipped** — Phase H; File → Import SVG… parses `<path>` (full command set, arcs→cubics) + basic shapes, flattens transforms, Y-flips, maps `fill`/`fill-opacity` → `Contour.paint`, `correctWinding`s, and drops the art on a new **baked** layer (`addImportedLayer`). Re-imports our own exports round-trip |
| Color support (for imported SVGs) | **Shipped** — the per-contour **paint seam** (`Contour.paint`, `setContourPaint`, fill/opacity through render + export, projectFile v3) is consumed by SVG import AND a **richer in-app Fill palette** in the **`FillPanel`** (native swatch + preset inks + session **recent colours** via `paletteStore` + hex entry + **saved colour palettes** via `colorPaletteStore`/settings v5; all over `applyPaint`) |
| Saved colour palettes (consistent theme) | **Shipped** — user-managed named swatch sets in `FillPanel` (pick/apply/add current colour/rename/delete; Alt-click a swatch removes it); `colorPaletteStore` persisted in the settings file (v5), the colour sibling of the stroke-preset library |
| Gradient fill (angle + fade) | **Shipped** — optional two-stop linear `Paint.gradient` (projectFile v5, additive): FillPanel "Gradient" block with an angle **Knob** + second colour + a **To-opacity** slider (fade toward transparent) + **Blend** (midpoint) & **Fade** (band width) sliders; rendered live on canvas/text-preview and exported as a real `<linearGradient>` (with `stop-opacity`) via the pure `fillPaint.ts` spec (decorative — FontForge flattens it) |
| Boolean-pair fill colour | **Shipped** — a Pathfinder result inherits operand A's paint (else B's) via `firstPaint` in `layerFills.ts`; colour an operand layer and the combined fill keeps it (all-default stays black) |
| Alignment of multiple paths (Illustrator-style) | **Shipped** — Phase G; floating Align panel (left/center/right/top/middle/bottom + distribute) over `engine/geometry/align.ts`, one undo step. A Settings toggle aligns by **nodes** or each path's **expanded outline** (`viewportStore.alignMode`; outline bounds via `expandStroke` in `editActions.alignSelectedPaths`) |
| Move path(s) to another layer / merge endpoint nodes | **Shipped** — Phase G; right-click "Move to layer" submenu (incl. New layer) + cross-layer "Merge nodes" |
| Transform box (Ctrl+T) | **Shipped** — scale/rotate/move handles over the node selection; affine applied across layers, one undo step. A draggable **pivot** marks the point to **rotate around** (default = box center; double-click resets) — covers wishlist "rotate around the center or a marked point" |
| Flatten / merge layers (destructive) | **Shipped** — Phase F; right-click → Merge N layers bakes strokes + booleans into one `baked` layer |
| Expand stroke (centerline+`stroke` → editable outline) | **Shipped** — Phase I; right-click → Expand stroke (`edit.expandStroke`) bakes the selected path's `expandStroke` output onto a new `baked` layer (holes preserved), consuming the original, one undo step |
| Movable / floating panels | **Shipped** — View/Stroke/**Fill**/Layers HUD panels drag by their header + resize by the left edge (`usePanelDrag` + session-only `panelStore`, `PanelId` = view/stroke/fill/layers), clamped to the canvas; a moved panel detaches to a fixed position |
| Path corner styles (Illustrator Round/Chamfer/Inverted) | **Shipped** — per-path `Contour.corner?` (`{type,radius}`) applied by the pure render-time pre-pass `engine/geometry/corners.ts` `roundCorners` in `renderContours` (round = circular fillet, chamfer = flat cut, invertedRound = concave scoop); radius clamped per corner (no self-intersection), non-destructive, reused by canvas/thumbnail/export; set in the StrokePanel "Corners" section. Per-NODE corner widget is a future extension |
| Blend / echo between layers | **Shipped** — Phase M; a 5th Pathfinder op (`PairOp "blend"` on `Glyph.booleanPairs` + `steps`) that morphs A→B as N echo steps. Each step renders through the normal layer path, so **outlined (stroked), multi-path, coloured, and corner** layers all morph; **genuinely different shapes** morph via arc-length resampling + cyclic alignment, and different **path counts** collapse the extra to a point. Pure `engine/geometry/blend.ts`, render-time in `buildFillGroups`, added at projectFile **v6** (current is v7). Caveat: resampled steps are polyline approximations |
| i18n / language | Not implemented (roadmap) |
| Export (bulk u_xxxx.svg + universal scale) | **Shipped** — Phase 6; every glyph → `u_xxxx.svg`, universal scale %, web zip (fflate) / desktop folder write (Tauri); reuses `buildFillGroups` so output matches the canvas. Optional **Silhouette** toggle → flat solid black (no colour/gradient/opacity, holes preserved), `-silhouette`-tagged archive |
| Synthetic Bold / Italic export | **Shipped** — `features/export/styleTransform.ts` + an Export-modal Style selector (Regular/Bold/Italic presets + Stretch %/Skew °/Outline-extension sliders). **Export-only** (source stays single-weight): fills are built UPRIGHT, then the skew/stretch is an **exact affine of the FINAL outline** (`transformContours`) — NOT a skeleton transform + stroke re-expansion (which re-exposed corner glitches); shearing finished beziers keeps sharp corners clean and counters intact (det>0 preserves CW-outer/CCW-hole). The fills also get an **x-only horizontal extension** (`extendOutlineX` — union/intersect of horizontally-shifted copies → bold thickens vertical stems only, height locked; negative thins, but the discrete intersect can facet sharp corners so Italic defaults to **skew-only**). `extendOutlineX` **splits CW outers from CCW holes** and smears each (grow ink + erode counters, then subtract) so counters DON'T fill solid (the geometry-service booleans flatten a contour set to a union of solids — feeding a whole annulus through `union` would lose the hole). Style-tagged archive name (`glyphs-bold/italic.svg.zip`) |
| Robust/stable save (low corruption risk) | **Shipped** — single auto-persisted workspace; versioned format + `migrate()` seam, debounced autosave + File → Save (Ctrl/Cmd+S), double-buffered writes, main→backup→seed load fallback (see Invariant 7) |
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
- **Right-click:** canvas → edit actions (incl. **Transform** — opens the Ctrl+T box; disabled when nothing is selected); a layer row → layer actions (both from the command registry)
- **Undo/Redo:** Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) — **per-glyph** (Ctrl+Z only ever changes the glyph you're viewing; never an off-screen one), document ops only; pan, zoom, layer switch, and glyph create/delete are not undone
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
  session-only — a draggable screen-fixed legend, `components/UnitReference.tsx`, whose X/Y arms
  are exactly 1 world unit at the current zoom; mounted in the overlay group, hidden in final view),
  **adjustable typography guides** (ascender/cap-height/x-height/
  descender; **visual-only** — `viewportStore.guides`, read by `MetricGuides`/`MetricLabels`;
  do NOT change the em box, camera-fit, thumbnails, or export), and **Text preview…**. (This
  menu replaced the old floating View panel.)
- **Theme & accent (Settings menu):** the **Theme** nested submenu (`components/menu/SubMenu.tsx` —
  the menu bar's first real flyout submenu; `MenuItem` gained a `checked?` ✓ prop) picks **Dark /
  Light / Paper** (`Theme` type + a `[data-theme="paper"]` block; `setTheme`). An **Accent colour**
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
  colour. (`setContourStroke` whole-replace is reserved for the enable toggle + preset apply.)
- **Information menu** (top bar, `features/info/InfoModal.tsx`): About / Licence / Legal / User guide in
  ONE modal with a sidebar. Each section is a Markdown file in `src/content/*.md` (imported `?raw`,
  rendered with **`marked`**) — easy to edit, can grow long. Content is trusted/bundled, so the HTML is
  injected directly (add a sanitiser only if untrusted content is ever shown). `src/vite-env.d.ts` was
  added so `?raw` imports type as `string`.
- **Sliders:** double-click a slider's label to type an exact value (clamped + step-snapped; `clampToStep` in `components/controls/Slider.tsx`). `NumberInput` also clamps TYPED values to `[min,max]` (the native min/max only bound the spinner arrows) — so e.g. export scale % can't be set to 0/negative.
- **Modals** (Export, Text preview, Keyboard shortcuts) all close on **Esc** (capture-phase, so it doesn't also reach the canvas). The tool controller handles **`pointercancel`** (an OS gesture / focus-steal mid-drag routes through the tool's pointer-up cleanup) so a drag can't get stuck. Destructive list deletes (Fill palette, Stroke preset) use a **two-click "Delete?" confirm** (settings aren't undoable).
- **Settings** (persisted): theme (dark/light/paper) + accent colour, handle grid lock, delete-splits-path, merge-endpoints-on-drag, merge-halftones-per-layer, align-by-outline

> ⚠️ **HISTORICAL — DO NOT USE AS A REFERENCE.** These are inception notes/chat from
> the project's start. They do **NOT** reflect the current code or features — APIs,
> phases, file layout, and design decisions have all changed since. For the current
> state, see **CLAUDE.md** and **README.md**. Kept only as a record of how the project
> began.

---

# Initial prompt

Act as an Expert Frontend Architect and Desktop App Developer.
I am building a web-based and Tauri-wrapped SVG editor focused entirely on drawing font glyphs. I have provided the `project_context.md` which outlines the philosophy.
Required Tech Stack:

* Framework: React with TypeScript (Strict mode enabled).
* State Management: Zustand (preferred for minimal boilerplate) or Redux, with middleware for Undo/Redo history.
* Vector Graphics: Choose a robust SVG/Canvas manipulation library that supports Bezier math and Boolean operations (e.g., Paper.js, Fabric.js, or a highly optimized raw SVG/D3 setup). Briefly justify your choice before coding.
* Storage Abstraction: Create an interface `StorageService` that implements `LocalForage` for the web and Tauri FS APIs for desktop.
Complete Feature List to Keep in Mind:

* Tools: Pen tool (Illustrator-style Bezier), basic primitives (lines, rectangles, circles, polygons). Emulated quill/brush angles via non-destructive stroke outlines.
* Canvas: Pan/Zoom, Dark/Light mode, Em-square metric guides. Grid with adjustable density and toggleable snap-to-grid.
* Layers/Management: Illustrator-style layer system (Lock, Hide, Boolean Ops). Ghost/guide layers (onion-skinning background glyphs with variable opacity).
* Glyph Organization: Left-sidebar with mini-thumbnails. 1 Glyph = 1 Document/SVG.
* Editing: Selection, Cut/Copy/Paste (must paste in place using exact absolute coordinates, even across different glyphs).
* Export: Bulk export to folder. Naming convention: `u_xxxx.svg` (lowercase hex, no '+'). Universal scale % applied on export. Output must handle proper path winding rules automatically.
Your Task Right Now: Do NOT attempt to write the entire application. We are going to build this strictly in phases to ensure modularity and code quality.
Execute PHASE 1 ONLY:

1. Scaffold the Architecture: Set up the React + TS project structure. Create the specific folder structure demonstrating where the state, canvas engine, UI components, and storage abstraction layers will live.
2. The Canvas & State Foundation: Build the main drawing viewport with Pan and Zoom capabilities.
3. The Em-Square & Grid: Implement the background Em-square guide, the adjustable grid, and the logic for the snap-to-grid toggle.
4. Basic State: Implement the Zustand/Redux store that will hold canvas parameters (zoom level, pan offset, grid settings) and dark/light mode toggle.
Provide the folder structure first, then the code for the storage abstraction layer, the state store, and the core Canvas component. End your response by asking for my approval to move to Phase 2 (The Pen Tool and Bezier Math).
How to manage the AI moving forward:
Once the AI completes Phase 1, you will prompt it through the remaining phases one by one. Here is your roadmap for those follow-up prompts:

* Phase 2: The Pen Tool & Shapes: "Implement the drawing tools. Focus on the Bezier curve tool. Ensure points are objects in our state so they can be snapped to the grid. Add straight lines, boxes, and circles."
* Phase 3: Layers & The Clipboard: "Implement the layer system (lock/hide). Then, implement the selection tool and Cut/Copy/Paste. Crucial: Ensure copied SVG nodes retain their absolute X/Y coordinates when pasted into a new blank canvas."
* Phase 4: Glyph Management & Onion Skinning: "Build the left sidebar. Let me create multiple glyphs. Implement the 'Ghost Layer' feature where I can select Glyph A to appear at 20% opacity in the background of Glyph B."
* Phase 5: Advanced Math (Booleans & Winding): "Implement Boolean operations (Union, Subtract, Intersect) using a library like Javascript Clipper or Paper.js. Ensure the system checks and auto-fixes path direction (winding rules) for inner vs. outer contours."
* Phase 6: Export & Tauri Integration: "Implement the export sequence. Apply the universal scale percentage, name the files `u_xxxx.svg`, and wire up the Tauri file system API to save them to a local folder."

# Chat history

The trap is letting Paper.js own the scene graph. Its model is mutable, stateful objects — if that becomes the source of truth, undo/redo and cross-glyph paste-in-place get coupled to Paper's object identity, which fights the snapshot-based history and plain-data serialization the later phases depend on.

So the decision: **Paper.js is a swappable geometry _service_, not the data model.** The canonical glyph stays plain serializable data in Zustand; we render it to native SVG (which is what FontForge wants on export); and when a boolean op or winding fix is needed, we hand plain points to a `GeometryService`, run Paper.js in isolation, and read plain points back. The interface ships now; the implementation lands in Phase 2/5. It's deliberately **not installed yet** — nothing in Phase 1 needs it, and keeping it out keeps the dependency surface honest.

typescript

```typescript
// engine/geometry/GeometryService.ts  — the contract; Paper.js impl arrives later
export interface GeometryService {
  union(contours: Contour[]): Contour[];
  subtract(a: Contour[], b: Contour[]): Contour[];
  intersect(a: Contour[], b: Contour[]): Contour[];
  exclude(a: Contour[], b: Contour[]): Contour[];
  /** Force outer contours one way and holes the other (even-odd / nonzero). */
  correctWinding(contours: Contour[]): Contour[];
}
```

### Folder structure

```
glyph-forge/
├── index.html
├── package.json            # react/zustand/zundo/localforage; tauri pkgs are devDeps
├── tsconfig.json           # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├── vite.config.ts
├── README.md
├── src/
│   ├── main.tsx            # React 18 entry
│   ├── App.tsx             # shell: theme sync, storage init, global undo/redo keys
│   ├── types/             # dependency-free shared types
│   │   ├── viewport.ts     # Vec2, Size, Viewport, Theme, GridSettings
│   │   ├── geometry.ts     # AnchorPoint, Contour, Winding (handles in ABSOLUTE coords)
│   │   └── document.ts     # Layer, Glyph
│   ├── constants/
│   │   └── metrics.ts      # FontMetrics + DEFAULT_METRICS + emBox()
│   ├── engine/            # framework-free domain logic
│   │   ├── viewport/transform.ts        # the ONLY place the world↔screen Y-flip lives
│   │   ├── snapping/snap.ts             # pure snap-to-grid (world units)
│   │   └── geometry/GeometryService.ts  # boolean/winding interface (Paper.js: Phase 5)
│   ├── state/
│   │   ├── viewportStore.ts             # zoom/pan/grid/theme — NOT undoable
│   │   ├── documentStore.ts             # glyphs/layers — undoable (zundo temporal)
│   │   └── middleware/temporal.ts       # typed hook over zundo's temporal store
│   ├── storage/
│   │   ├── StorageService.ts            # the KV interface everything talks to
│   │   ├── platform.ts                  # isTauri()
│   │   ├── LocalForageStorage.ts        # web adapter
│   │   ├── TauriStorage.ts              # desktop adapter (KV over FS, lazy-loaded)
│   │   └── createStorage.ts             # memoized platform factory
│   ├── features/
│   │   ├── canvas/                      # ← the Phase 1 surface
│   │   │   ├── CanvasViewport.tsx        # core component
│   │   │   ├── ControlPanel.tsx          # grid / snap / theme / reset HUD
│   │   │   ├── components/               # Grid, EmSquare, MetricGuides,
│   │   │   │                             #   MetricLabels, SnapIndicator, CoordinateReadout
│   │   │   └── hooks/usePanZoom.ts
│   │   ├── tools/   ·gitkeep            # Phase 2
│   │   ├── layers/  ·gitkeep            # Phase 3
│   │   ├── glyphs/  ·gitkeep            # Phase 4
│   │   └── export/  ·gitkeep            # Phase 6
│   ├── components/controls/             # Toggle, Slider, NumberInput
│   └── styles/theme.css                 # CSS-variable dark/light + a11y floor
└── src-tauri/                           # Tauri v2 shell — registers the FS plugin
    ├── Cargo.toml · build.rs · tauri.conf.json
    ├── capabilities/default.json        # scoped $APPDATA FS permissions
    └── src/{main.rs, lib.rs}
```

### Storage abstraction layer

Everything talks to one KV interface; the two platform adapters are the only files that know about LocalForage or Tauri. Note the scope line in the interface — bulk `u_xxxx.svg` export is a genuinely filesystem-shaped operation and gets its own `ExportService` in Phase 6 rather than being forced into a KV model the web build can't honor.

typescript

```typescript
// storage/StorageService.ts
export interface StorageService {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}
```

typescript

```typescript
// storage/platform.ts  — checks Tauri's globals; imports no @tauri-apps package
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}
```

typescript

```typescript
// storage/LocalForageStorage.ts  — web: IndexedDB-backed KV
import localforage from "localforage";
import type { StorageService } from "./StorageService";

export class LocalForageStorage implements StorageService {
  private readonly store: LocalForage;

  constructor(name = "glyph-forge") {
    this.store = localforage.createInstance({
      name,
      storeName: "documents",
      description: "GlyphForge documents and application settings",
    });
  }

  async getItem<T>(key: string): Promise<T | null> {
    return (await this.store.getItem<T>(key)) ?? null;
  }
  async setItem<T>(key: string, value: T): Promise<void> {
    await this.store.setItem(key, value);
  }
  async removeItem(key: string): Promise<void> {
    await this.store.removeItem(key);
  }
  async keys(): Promise<string[]> {
    return this.store.keys();
  }
  async clear(): Promise<void> {
    await this.store.clear();
  }
}
```

typescript

```typescript
// storage/TauriStorage.ts  — desktop: one JSON file per key under <AppData>/storage/
// @tauri-apps/plugin-fs is imported lazily and only from inside Tauri, so it
// lands in its own async chunk the web build never requests.
import type { StorageService } from "./StorageService";

type FsModule = typeof import("@tauri-apps/plugin-fs");
const ROOT_DIR = "storage";
const EXT = ".json";

export class TauriStorage implements StorageService {
  private fsPromise: Promise<FsModule> | null = null;
  private baseDir = 0;

  private async fs(): Promise<FsModule> {
    if (!this.fsPromise) {
      this.fsPromise = import("@tauri-apps/plugin-fs").then(async (mod) => {
        this.baseDir = mod.BaseDirectory.AppData;
        if (!(await mod.exists(ROOT_DIR, { baseDir: this.baseDir }))) {
          await mod.mkdir(ROOT_DIR, { baseDir: this.baseDir, recursive: true });
        }
        return mod;
      });
    }
    return this.fsPromise;
  }

  private pathFor(key: string) { return `${ROOT_DIR}/${encodeURIComponent(key)}${EXT}`; }
  private keyFrom(file: string) { return decodeURIComponent(file.slice(0, -EXT.length)); }

  async getItem<T>(key: string): Promise<T | null> {
    const mod = await this.fs();
    const path = this.pathFor(key);
    if (!(await mod.exists(path, { baseDir: this.baseDir }))) return null;
    return JSON.parse(await mod.readTextFile(path, { baseDir: this.baseDir })) as T;
  }
  async setItem<T>(key: string, value: T): Promise<void> {
    const mod = await this.fs();
    await mod.writeTextFile(this.pathFor(key), JSON.stringify(value), { baseDir: this.baseDir });
  }
  async removeItem(key: string): Promise<void> {
    const mod = await this.fs();
    const path = this.pathFor(key);
    if (await mod.exists(path, { baseDir: this.baseDir })) {
      await mod.remove(path, { baseDir: this.baseDir });
    }
  }
  async keys(): Promise<string[]> {
    const mod = await this.fs();
    const entries = await mod.readDir(ROOT_DIR, { baseDir: this.baseDir });
    return entries.filter((e) => e.isFile && e.name.endsWith(EXT)).map((e) => this.keyFrom(e.name));
  }
  async clear(): Promise<void> {
    await Promise.all((await this.keys()).map((k) => this.removeItem(k)));
  }
}
```

typescript

```typescript
// storage/createStorage.ts  — picks the adapter once; dynamic-imports Tauri only on desktop
import type { StorageService } from "./StorageService";
import { LocalForageStorage } from "./LocalForageStorage";
import { isTauri } from "./platform";

let instance: StorageService | null = null;

export async function createStorage(): Promise<StorageService> {
  if (instance) return instance;
  if (isTauri()) {
    const { TauriStorage } = await import("./TauriStorage");
    instance = new TauriStorage();
  } else {
    instance = new LocalForageStorage();
  }
  return instance;
}

export function getStorage(): StorageService {
  if (!instance) throw new Error("Storage not initialised — await createStorage() first.");
  return instance;
}
```

### State store

Two stores, split along one line: **is this an editing operation?** Camera and UI live in `viewportStore` (never recorded); the glyph model lives in `documentStore` wrapped in zundo's `temporal()`, so <kbd>Ctrl</kbd>+<kbd>Z</kbd> will undo a drawn point but never a pan or zoom.

The whole coordinate system rests on one pure module. World space is **font units, Y-up, baseline at 0** (descenders negative); screen space is **CSS px, Y-down**. The single Y-flip exists in exactly one place, so the world group, the overlay labels, and the snap marker can't disagree:

typescript

```typescript
// engine/viewport/transform.ts  (the keystone — full file in the bundle)
// zoom = screen px per font unit;  pan = screen-px position of world origin (0,0)
export function worldToScreen(p: Vec2, vp: Viewport): Vec2 {
  return { x: vp.pan.x + p.x * vp.zoom, y: vp.pan.y - p.y * vp.zoom }; // minus = Y-flip
}
export function screenToWorld(p: Vec2, vp: Viewport): Vec2 {
  return { x: (p.x - vp.pan.x) / vp.zoom, y: (vp.pan.y - p.y) / vp.zoom };
}
// SVG <g> transform for world-space content (note the -zoom on the d term):
export function worldMatrix(vp: Viewport): string {
  return `matrix(${vp.zoom},0,0,${-vp.zoom},${vp.pan.x},${vp.pan.y})`;
}
// zoomAt() keeps the world point under the cursor pinned (zoom-to-cursor);
// fitToBox() centers the em square. Both return a new Viewport.
```

typescript

```typescript
// state/viewportStore.ts  — camera + grid + theme; NOT part of history
import { create } from "zustand";
import type { GridSettings, Size, Theme, Vec2, Viewport } from "../types/viewport";
import { clampZoom, fitToBox, panBy as panViewport, zoomAt } from "../engine/viewport/transform";
import { DEFAULT_METRICS, emBox } from "../constants/metrics";

interface ViewportState {
  zoom: number;
  pan: Vec2;
  canvasSize: Size;       // last measured pixel size; lets resetView() take no args
  grid: GridSettings;
  theme: Theme;

  setCanvasSize: (size: Size) => void;
  setViewport: (vp: Viewport) => void;
  zoomAtCursor: (factor: number, cursor: Vec2) => void;
  setZoom: (zoom: number) => void;
  panBy: (dx: number, dy: number) => void;
  resetView: () => void;          // fit the em square to the canvas
  setGridSize: (size: number) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  setSnap: (on: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useViewportStore = create<ViewportState>((set, get) => ({
  zoom: 1,
  pan: { x: 0, y: 0 },
  canvasSize: { width: 0, height: 0 },
  grid: { size: 50, visible: true, snap: true },
  theme: "dark",

  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setViewport: (vp) => set({ zoom: vp.zoom, pan: vp.pan }),

  zoomAtCursor: (factor, cursor) => {
    const { zoom, pan } = get();
    const next = zoomAt({ zoom, pan }, factor, cursor);
    set({ zoom: next.zoom, pan: next.pan });
  },
  setZoom: (zoom) => {
    const { canvasSize, zoom: z, pan } = get();
    const center: Vec2 = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const next = zoomAt({ zoom: z, pan }, clampZoom(zoom) / z, center);
    set({ zoom: next.zoom, pan: next.pan });
  },
  panBy: (dx, dy) => {
    const { zoom, pan } = get();
    set({ pan: panViewport({ zoom, pan }, dx, dy).pan });
  },
  resetView: () => {
    const next = fitToBox(get().canvasSize, emBox(DEFAULT_METRICS));
    set({ zoom: next.zoom, pan: next.pan });
  },

  setGridSize: (size) => set({ grid: { ...get().grid, size: Math.max(1, Math.round(size)) } }),
  toggleGrid: () => set({ grid: { ...get().grid, visible: !get().grid.visible } }),
  toggleSnap: () => set({ grid: { ...get().grid, snap: !get().grid.snap } }),
  setSnap: (on) => set({ grid: { ...get().grid, snap: on } }),
  toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
  setTheme: (theme) => set({ theme }),
}));
```

The document store is intentionally empty of editing actions in Phase 1 — but the history machinery is already typed and in place, so Phase 2's pen tool just adds `set(...)` calls and undo/redo works for free:

typescript

```typescript
// state/documentStore.ts  — glyph model wrapped in zundo; history is ready, model grows in P2+
export const useDocumentStore = create<DocumentState>()(
  temporal(
    (): DocumentState => ({ glyphs: {}, activeGlyphId: null }),
    { limit: 200 },
  ),
);

// useHistory() exposes undo/redo/canUndo/canRedo for the UI and the keyboard shortcuts.
```

### Core canvas component

`CanvasViewport` owns the element, keeps `canvasSize` synced via a `ResizeObserver` (and fits the em square exactly once, on first real measurement), wires pan/zoom, and tracks the cursor in world units for the live readout and snap marker. The SVG is split into a **world group** carrying the single Y-flip matrix (its children are authored in plain font units) and an **untransformed overlay group** (labels and the snap crosshair compute their own screen positions, so they stay upright and a constant pixel size at any zoom).

tsx

```tsx
// features/canvas/CanvasViewport.tsx
import { useEffect, useRef, useState } from "react";
import { useViewportStore } from "../../state/viewportStore";
import { usePanZoom } from "./hooks/usePanZoom";
import { screenToWorld, worldMatrix } from "../../engine/viewport/transform";
import { snapPoint } from "../../engine/snapping/snap";
import { DEFAULT_METRICS } from "../../constants/metrics";
import type { Vec2, Viewport } from "../../types/viewport";
import { Grid } from "./components/Grid";
import { EmSquare } from "./components/EmSquare";
import { MetricGuides } from "./components/MetricGuides";
import { MetricLabels } from "./components/MetricLabels";
import { SnapIndicator } from "./components/SnapIndicator";
import { CoordinateReadout } from "./components/CoordinateReadout";
import { ControlPanel } from "./ControlPanel";

export function CanvasViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const zoom = useViewportStore((s) => s.zoom);
  const pan = useViewportStore((s) => s.pan);
  const canvasSize = useViewportStore((s) => s.canvasSize);
  const grid = useViewportStore((s) => s.grid);
  const setCanvasSize = useViewportStore((s) => s.setCanvasSize);
  const resetView = useViewportStore((s) => s.resetView);

  const [cursor, setCursor] = useState<Vec2 | null>(null);
  usePanZoom(containerRef);

  const didFit = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
      if (!didFit.current && width > 0 && height > 0) {
        didFit.current = true;
        resetView();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setCanvasSize, resetView]);

  const viewport: Viewport = { zoom, pan };

  const handleMouseMove = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCursor(screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport));
  };
  const handleMouseLeave = () => setCursor(null);

  const snapped = cursor && grid.snap ? snapPoint(cursor, grid.size, true) : null;

  return (
    <div className="canvas-viewport">
      <div
        ref={containerRef}
        className="canvas-surface"
        role="application"
        aria-label="Glyph drawing canvas"
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg className="canvas-svg" width={canvasSize.width} height={canvasSize.height}
             viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} role="presentation">
          {/* World space: font units, Y-up via the matrix from transform.ts */}
          <g transform={worldMatrix(viewport)}>
            {grid.visible && <Grid viewport={viewport} size={canvasSize} gridSize={grid.size} />}
            <EmSquare metrics={DEFAULT_METRICS} />
            <MetricGuides metrics={DEFAULT_METRICS} />
          </g>
          {/* Screen space: upright, constant-size labels and live feedback */}
          <g className="overlay">
            <MetricLabels metrics={DEFAULT_METRICS} viewport={viewport} />
            {grid.snap && snapped && <SnapIndicator point={snapped} viewport={viewport} />}
          </g>
        </svg>
        <CoordinateReadout raw={cursor} snapped={snapped} snapOn={grid.snap} />
      </div>
      <ControlPanel />
    </div>
  );
}
```

Pan/zoom itself lives in `usePanZoom`, attached to the element natively with `{ passive: false }` so it can `preventDefault`: <kbd>Ctrl/Cmd</kbd>+wheel zooms to the cursor (this also catches trackpad pinch, which browsers report as wheel + `ctrlKey`); plain wheel pans (<kbd>Shift</kbd> swaps axes); <kbd>Space</kbd>+drag and middle-mouse drag both hand-pan. Snapping is a pure `snapPoint` in world units — the same function the pen tool and selection drag will call later, guaranteeing identical quantization everywhere.

### Also in the bundle

Beyond the files above: the canvas sub-components (`Grid` with a 600-line perf cap and non-scaling strokes, `EmSquare`, `MetricGuides` with an emphasized baseline, screen-space `MetricLabels`, `SnapIndicator`, `CoordinateReadout`); the shared `Toggle`/`Slider`/`NumberInput` controls; `App.tsx` (theme→`<html>` sync, storage warm-up, global undo/redo keys); `theme.css` (CSS-variable dark/light, hairline guides, a single warm "ember" accent reserved for live feedback, plus the quality floor — `:focus-visible` rings and a `prefers-reduced-motion` block); and a real Tauri v2 shell that registers the FS plugin with `$APPDATA`-scoped capabilities so the desktop storage path actually works. `npm install` then `npm run dev` (web) or `npm run tauri dev` (desktop); `npm run typecheck` passes clean.


---

### Bezier/path engine (`engine/geometry/path.ts`)

Pure, screen-space-unaware, world units throughout. Because handles are stored **absolute**, a segment is just `C out(a) in(b) b`, collapsing to `L` when both handles are absent. Winding comes from the shoelace signed area — **clockwise = negative** in our Y-up space — with `reverseContour` swapping point order _and_ each anchor's in/out handles so a flip is exact and reversible. Verified: `r=100` ellipse → kappa handle length `55.2284…`, rect signed area `−20000` (cw), double-reverse preserves winding.

### Primitives + winding normalization (`primitives.ts`)

`makeLine/makeRectangle/makeEllipse` take a world box (drag-direction agnostic) and run every closed shape through `ensureWinding(_, "cw")`, so the whole document obeys "outer contour clockwise." `GlyphView` fills closed contours as one compound `<path fill-rule="nonzero">`, so an inner CCW contour punches a real hole — the winding pillar is visible, not theoretical.

### Tool system (`features/tools/*`, `useToolController`)

Each tool is one `ToolDefinition` touching stores _only_ through a typed context — no React, no DOM. The registry array is the single source: add a tool and it gets a toolbar button, a shortcut, and event routing for free. Input is cleanly split: `usePanZoom` owns Space/middle-drag + wheel; `useToolController` owns left-button-no-Space and bails the instant Space is down (shared via `editorStore.spaceDown`), so pan and draw never collide. Snapping is applied once, in the controller, so tools receive ready-to-use world points.

### History granularity (`editorStore` vs `documentStore`)

The key decision: **all live, per-frame geometry lives in the non-undoable editor store** (pen pending point, shape draft, node-drag `liveContours` override). Only the final result commits to the undoable document store — pen = one point per gesture, a whole drag = one batched `replaceContours`. So one user action is exactly one Ctrl+Z, and selection/cursor never pollute the timeline. Undo/redo also clears ephemeral state so refs can't dangle.

### Interaction summary

- **Pen (P):** click = corner, click-drag = smooth (mirrored handles, anchor pinned at press), click the start point to close, Esc/Enter to finish.
- **Direct Select (V):** click/shift-click anchors, drag to move (snapped delta keeps on-grid points on-grid), drag handles to reshape (Alt breaks mirroring), Delete removes selection.
- **Rectangle (M) / Ellipse (E) / Line (L):** drag to size with live dashed preview.

### In the bundle

59 source files; `npx vite build` green; `TauriStorage` still code-split out of the web chunk. Lead files above: the pen, node-select, the input controller, the path/primitive engine, and both stores.

One note for later: `signedArea` uses the anchor polygon (fast, correct for these shapes) — exact curve-aware winding arrives with the Paper.js geometry service in Phase 5, behind the existing `GeometryService` seam.

---

### Layer model + z-order

A glyph's `layers[]` array is **paint order, bottom-to-top** (index 0 paints first = bottom, last index = top), so it maps straight onto SVG document order. The panel renders the array **reversed** so the top of the list is the top of the stack (Illustrator convention); "move up" means toward the top, i.e. `+1` in the array. Fill is computed **per layer** (nonzero winding, closed contours only), so a CW-outer/CCW-inner hole shows correctly without winding bleeding between independent layers.

### History tracks content, not the active pointer

The key decision: `activeGlyphId`/`activeLayerId` live in the document store (they belong with the document) but are **excluded from undo history** via zundo `partialize: s => ({ glyphs: s.glyphs })` with reference-based `equality`. So switching the active layer records no step and is never undone — only changes that produce a new `glyphs` object are. Because an undo _can_ remove the layer that was active, `reconcileActive()` runs after every undo/redo to re-point dangling pointers (falling back to the top layer / first glyph). The store test confirmed it: `setActiveLayer` leaves `pastStates` unchanged while `addLayer`/`setLayerVisible`/`addContour` each add exactly one, and a dangling pointer after undo is repaired.

### Editing is scoped to the active layer

Phase 3 edits one layer at a time. The active `Layer` is threaded through `ToolPointerContext`/`ToolKeyContext`; hit-testing became `hitTestLayer(layer, …)`. Locked-layer enforcement is layered: the store's `mutateActiveLayer` is a no-op on a locked layer, the controller refuses to _start_ a gesture when the active layer is locked or hidden (pan/zoom still work), and `EditOverlay` hides its anchors. To edit different geometry, switch the active layer.

### Clipboard — true paste-in-place

The copy unit is the whole **contour**: copy gathers every contour owning a selected anchor, so selecting any one anchor copies its outline. Paste-in-place is trivial precisely because handles are stored as **absolute coordinates** and metrics are shared across glyphs — paste clones to fresh ids at the _same_ coordinates, so the shape lands in the same visual spot, and the architecture already supports pasting into a _different_ glyph (relevant in Phase 4). The clipboard lives in its own store so it survives undo and tool switches. Bound to `Ctrl/Cmd+C/X/V` and `Ctrl/Cmd+A` (select-all in the active layer); cut = copy + delete; paste switches to the select tool and selects the result.

### Layers panel

Floating bottom-right HUD: reversed stack, per-row eye (visibility) and lock toggles, double-click to rename inline (Enter/blur commits, Esc cancels), click to activate. Footer: add (inserts above active), duplicate, reorder up/down (disabled at the ends), delete (disabled at the last layer). It sits outside the canvas surface so its clicks don't bleed into the tool controller.

In the bundle: `TauriStorage` is still code-split out of the web chunk (the Phase 1 lazy-import boundary holds); CSS is 10.6 kB. Lead files above are the document store, the clipboard hook, the panel, the render selectors, the multi-layer `GlyphView`, and the controller.

---

### Generalized glyph creation

`createDefaultGlyph` no longer hardcodes 'A' — it delegates to `createGlyph(codepoint, metrics)`. Added three small model helpers: `glyphLabel` (the character when printable, `"space"` for U+0020, else a `U+XXXX` tag), `formatCodepoint`, and `parseGlyphInput`, which accepts either a literal character or an explicit `U+XXXX`/`0x` hex tag — unambiguous, since a bare `A` means the letter and `U+0041` means it by code. Verified: `'B'→66`, `'U+00E9'→233`, `'0x41'→65`, blank→null.

### Glyph store actions

`addGlyph(codepoint)` enforces **one glyph per code point**: if the code point already exists it just switches to it (an untracked active-pointer change — no bogus undo step), otherwise it creates and switches. `deleteGlyph` keeps at least one glyph and, when you delete the active one, moves to the **next glyph by code point** (or the previous if it was last). The store test confirmed all of it: creating adds one history entry, adding an existing code point adds none, and delete reassigns the active glyph correctly. `useGlyphList` selects the stable `glyphs` reference and memoizes the code-point sort, avoiding the fresh-array-every-render pitfall that breaks `useSyncExternalStore`.

### Glyph sidebar

A docked left navigator (the document switcher, since one glyph = one file): code-point-sorted cells, each a `GlyphThumbnail` — a mini silhouette framed to the em box with the same Y-flip as the canvas, so every thumbnail sits at one scale for quick visual comparison. Add by typing a character or `U+XXXX`; delete the active glyph; click to switch. Switching, adding, or deleting a glyph also resets editor state, so a selection from the old glyph can't linger onto the new one.

### Onion-skinning

Reference glyphs are ghosted **behind** the active one in the _same shared coordinate space_ — em square and baseline are common to every glyph, so heights, widths, and overshoots line up directly, which is the whole point. State lives in its own small non-undoable `onionStore` (`enabled`, `opacity`, `referenceIds`); a deleted glyph just stops rendering (consumers filter against the live set), so no cross-store cleanup is needed. Each sidebar cell has a ghost toggle that marks it as a reference and **auto-enables** the overlay so the toggle's effect is immediately visible; the ControlPanel gained an on/off switch and an opacity slider. Ghosts render in a distinct blue-grey (deliberately _not_ the ember accent or ink) so they never read as the current glyph, drawn non-interactively under `GlyphView`.

In the bundle: `TauriStorage` is still code-split out of the web chunk (the Phase 1 boundary holds); CSS is 13.7 kB. Lead files above are the sidebar, the ghost renderer, the onion store, the document store (glyph actions), the thumbnail, and the glyph helpers.

Two notes carried forward: per-glyph **advance-width** editing isn't wired yet (the field exists; the metric guide already reads it) and is a natural small addition; and layer-switch within a glyph keeps its selection (benign, since selection is active-layer-scoped) — I can make that clear-on-switch too if you'd like consistency with glyph switching.

Ready to proceed to **Phase 5 — Boolean Operations & Winding** (union/subtract/intersect on contours via Paper.js behind the existing `GeometryService` seam, with the results normalized to the winding convention — outer CW, holes CCW — that the engine and FontForge expect)? Or would you like adjustments to the sidebar or onion-skinning first?
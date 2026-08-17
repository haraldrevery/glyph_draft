import { create } from "zustand";
import type { GridSettings, Size, Theme, Vec2, Viewport } from "../types/viewport";
import {
  clampZoom,
  fitToBox,
  panBy as panViewport,
  zoomAt,
} from "../engine/viewport/transform";
import { DEFAULT_METRICS, emBox, type Box } from "../constants/metrics";

/** How the Align panel measures each path: by its NODES (skeleton) or its expanded
 *  OUTLINE (the visible filled shape). A persisted UI preference. */
export type AlignMode = "nodes" | "outline";

/** Canvas view mode: normal editing, wireframe outline, or the final rendered look. */
export type ViewMode = "edit" | "outline" | "final";

/** On-canvas typography guide-line positions (font units, Y-up; descender is a
 *  positive magnitude). VISUAL ONLY — these move the reference lines/labels and do
 *  NOT affect the em box, camera-fit, thumbnails, or export framing. */
export interface GuideMetrics {
  ascender: number;
  capHeight: number;
  xHeight: number;
  descender: number;
}

export const DEFAULT_GUIDES: GuideMetrics = {
  ascender: DEFAULT_METRICS.ascender,
  capHeight: DEFAULT_METRICS.capHeight,
  xHeight: DEFAULT_METRICS.xHeight,
  descender: DEFAULT_METRICS.descender,
};

/**
 * Canvas / UI state. This is deliberately SEPARATE from the document store and
 * is NOT part of the undo/redo history: pressing Ctrl+Z should never undo a pan
 * or a zoom. Splitting the stores along the "is it an editing operation?" line
 * is what keeps the history tree clean once real editing arrives.
 */
interface ViewportState {
  zoom: number;
  pan: Vec2;
  /** Last measured canvas pixel size; kept here so resetView() needs no args. */
  canvasSize: Size;
  grid: GridSettings;
  theme: Theme;
  /** User accent-colour override (CSS colour) applied over the theme's `--accent`.
   *  `null` = use the theme default. Persisted. */
  accentColor: string | null;
  /** Side count for the polygon tool (UI setting; not undoable, not persisted). */
  polygonSides: number;
  /** Shape tools draw symmetrically from the start point (center) instead of corner-to-corner
   *  (session-only; not persisted). */
  shapeFromCenter: boolean;
  /** Free-pen smoothing/simplify amount in SCREEN px (session-only; not persisted). */
  freehandSmoothing: number;
  /** Eraser pick radius in SCREEN px — also the on-canvas size indicator (session-only). */
  eraserSize: number;
  /** Glyph sidebar width (px) and collapsed state (session-only; reset by resetView). */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Snap the cursor / a dragged node to existing anchors & path edges (Illustrator
   *  "Snap to Point"). Session-only; independent of grid snap. */
  snapToGeometry: boolean;
  /** Deleting a node splits the path in two (vs. reconnecting its neighbors). */
  deleteSplits: boolean;
  /** Dragging an open path's endpoint onto another endpoint fuses them. */
  mergeEndpoints: boolean;
  /** Same-style halftone-stroked paths in one layer render as ONE continuous halftone
   *  (`expandHalftoneGroup`) instead of one per path. Persisted preference. */
  mergeHalftones: boolean;
  /** Show the draggable 1-unit coordinate-reference legend (session-only). */
  unitRef: boolean;
  /** Canvas view mode (session-only): `edit` = fills + editing chrome; `outline` =
   *  wireframe (skeletons + nodes, fills hidden); `final` = rendered fills only (the
   *  exported look, in colour) with the editing chrome hidden and the metric frame
   *  dimmed. */
  viewMode: ViewMode;
  /** In `final` mode, overlay the path lines (skeletons). Session-only. */
  previewPaths: boolean;
  /** Align panel measure mode (persisted). */
  alignMode: AlignMode;
  /** On-canvas typography guide positions (persisted; visual only). */
  guides: GuideMetrics;

  // viewport transform
  setCanvasSize: (size: Size) => void;
  setViewport: (vp: Viewport) => void;
  zoomAtCursor: (factor: number, cursor: Vec2) => void;
  setZoom: (zoom: number) => void;
  panBy: (dx: number, dy: number) => void;
  /** Fit the em square to the canvas (the "zoom to fit" / reset action). */
  resetView: () => void;
  /** Frame a world-space box in the viewport (e.g. zoom to the selection). */
  zoomToBounds: (box: Box) => void;

  // grid
  setGridSize: (size: number) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  setSnap: (on: boolean) => void;
  /** Toggle grid-snapping of pen handles (independent of node `snap`). */
  toggleHandleSnap: () => void;

  // theme
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string | null) => void;

  // shapes
  setPolygonSides: (sides: number) => void;
  toggleShapeFromCenter: () => void;
  setFreehandSmoothing: (px: number) => void;
  setEraserSize: (px: number) => void;
  setSidebarWidth: (px: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSnapToGeometry: () => void;
  toggleUnitRef: () => void;

  // node editing
  toggleDeleteSplits: () => void;
  toggleMergeEndpoints: () => void;
  toggleMergeHalftones: () => void;

  // view mode
  setViewMode: (mode: ViewMode) => void;
  /** Toggle wireframe outline (edit ↔ outline); keeps the Ctrl+Shift+O command. */
  toggleOutlineMode: () => void;
  /** Toggle the final-render preview (edit ↔ final). */
  toggleFinalPreview: () => void;
  /** Toggle the path-line overlay shown in `final` mode. */
  togglePreviewPaths: () => void;

  // align + guides
  setAlignMode: (mode: AlignMode) => void;
  setGuide: (key: keyof GuideMetrics, value: number) => void;
  resetGuides: () => void;
}

export const useViewportStore = create<ViewportState>((set, get) => ({
  zoom: 1,
  pan: { x: 0, y: 0 },
  canvasSize: { width: 0, height: 0 },
  grid: { size: 50, visible: true, snap: true, snapHandles: false },
  theme: "dark",
  accentColor: null,
  polygonSides: 6,
  shapeFromCenter: false,
  freehandSmoothing: 4,
  eraserSize: 8,
  sidebarWidth: 212,
  sidebarCollapsed: false,
  snapToGeometry: false,
  deleteSplits: false,
  mergeEndpoints: true,
  mergeHalftones: false,
  unitRef: false,
  viewMode: "edit",
  previewPaths: false,
  alignMode: "nodes",
  guides: { ...DEFAULT_GUIDES },

  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setViewport: (vp) => set({ zoom: vp.zoom, pan: vp.pan }),

  zoomAtCursor: (factor, cursor) => {
    const { zoom, pan } = get();
    const next = zoomAt({ zoom, pan }, factor, cursor);
    set({ zoom: next.zoom, pan: next.pan });
  },

  setZoom: (zoom) => {
    const { canvasSize } = get();
    // Zoom about the canvas center when set numerically.
    const center: Vec2 = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const { zoom: z, pan } = get();
    const next = zoomAt({ zoom: z, pan }, clampZoom(zoom) / z, center);
    set({ zoom: next.zoom, pan: next.pan });
  },

  panBy: (dx, dy) => {
    const { zoom, pan } = get();
    set({ pan: panViewport({ zoom, pan }, dx, dy).pan });
  },

  resetView: () => {
    const next = fitToBox(get().canvasSize, emBox(DEFAULT_METRICS));
    set({ zoom: next.zoom, pan: next.pan, sidebarWidth: 212, sidebarCollapsed: false });
  },

  zoomToBounds: (box: Box) => {
    // Frame a world box in the viewport (reuses fitToBox's padding + zero-box guard).
    // A degenerate box (single node → zero width/height) is grown to a sane minimum
    // around its centre so a lone point still zooms in instead of snapping to origin.
    const MIN = 120;
    const w = Math.max(box.width, MIN);
    const h = Math.max(box.height, MIN);
    const padded: Box = {
      x: box.x - (w - box.width) / 2,
      y: box.y - (h - box.height) / 2,
      width: w,
      height: h,
    };
    const next = fitToBox(get().canvasSize, padded);
    set({ zoom: next.zoom, pan: next.pan });
  },

  setGridSize: (size) =>
    set({ grid: { ...get().grid, size: Math.max(1, Math.round(size)) } }),
  toggleGrid: () => set({ grid: { ...get().grid, visible: !get().grid.visible } }),
  toggleSnap: () => set({ grid: { ...get().grid, snap: !get().grid.snap } }),
  setSnap: (on) => set({ grid: { ...get().grid, snap: on } }),
  toggleHandleSnap: () =>
    set({ grid: { ...get().grid, snapHandles: !get().grid.snapHandles } }),

  toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
  setTheme: (theme) => set({ theme }),
  setAccentColor: (accentColor) => set({ accentColor }),

  setPolygonSides: (sides) =>
    set({ polygonSides: Math.min(24, Math.max(3, Math.round(sides))) }),
  toggleShapeFromCenter: () => set((s) => ({ shapeFromCenter: !s.shapeFromCenter })),
  setFreehandSmoothing: (px) =>
    set({ freehandSmoothing: Math.min(40, Math.max(0, px)) }),
  setEraserSize: (px) =>
    set({ eraserSize: Math.min(60, Math.max(2, Math.round(px))) }),
  setSidebarWidth: (px) =>
    set({ sidebarWidth: Math.min(480, Math.max(140, Math.round(px))), sidebarCollapsed: false }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSnapToGeometry: () => set((s) => ({ snapToGeometry: !s.snapToGeometry })),
  toggleUnitRef: () => set((s) => ({ unitRef: !s.unitRef })),

  toggleDeleteSplits: () => set({ deleteSplits: !get().deleteSplits }),
  toggleMergeEndpoints: () => set({ mergeEndpoints: !get().mergeEndpoints }),
  toggleMergeHalftones: () => set({ mergeHalftones: !get().mergeHalftones }),

  setViewMode: (viewMode) => set({ viewMode }),
  toggleOutlineMode: () => set({ viewMode: get().viewMode === "outline" ? "edit" : "outline" }),
  toggleFinalPreview: () => set({ viewMode: get().viewMode === "final" ? "edit" : "final" }),
  togglePreviewPaths: () => set({ previewPaths: !get().previewPaths }),

  setAlignMode: (alignMode) => set({ alignMode }),
  setGuide: (key, value) =>
    set({ guides: { ...get().guides, [key]: Math.max(0, Math.round(value)) } }),
  resetGuides: () => set({ guides: { ...DEFAULT_GUIDES } }),
}));

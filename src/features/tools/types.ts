import type { useDocumentStore } from "../../state/documentStore";
import type { useEditorStore, ToolId } from "../../state/editorStore";
import type { Glyph, Layer } from "../../types/document";
import type { Vec2, Viewport } from "../../types/viewport";

/**
 * The pluggable tool contract. Every interaction tool (pen, node-select, the
 * shape primitives) is one object implementing the handlers it cares about and
 * nothing more. The canvas's tool controller is the only thing that knows tools
 * exist; tools never reach into React or the DOM, and they touch the stores
 * only through the typed handles handed to them in the context. That isolation
 * is the modularity pillar in practice — a bug in the pen's bezier handling
 * cannot reach the selection or shape tools.
 */

/** Direct, fully-typed access to the store actions, passed in via context. */
export type DocApi = ReturnType<typeof useDocumentStore.getState>;
export type EditorApi = ReturnType<typeof useEditorStore.getState>;

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

/** Everything a pointer handler needs for one event. */
export interface ToolPointerContext {
  /** Grid-snapped world point (equals rawWorld when snapping is off). */
  world: Vec2;
  /** Unsnapped world point. */
  rawWorld: Vec2;
  /** World point for pen handles — grid-snapped when "handle grid lock" is on,
   *  else equals rawWorld. (Node placement uses `world`.) */
  handleWorld: Vec2;
  /** Pointer position in canvas pixels (for screen-space hit-testing). */
  screen: Vec2;
  viewport: Viewport;
  modifiers: Modifiers;
  /** Is the primary button currently pressed? (move fires on hover too.) */
  isDown: boolean;
  /** World point where the current press began, if any. */
  downWorld: Vec2 | null;
  /** Snapshot of the active glyph for hit-testing. */
  glyph: Glyph | null;
  /** The active layer — where edits land and what gets hit-tested. */
  layer: Layer | null;
  doc: DocApi;
  editor: EditorApi;
}

export interface ToolKeyContext {
  modifiers: Modifiers;
  glyph: Glyph | null;
  layer: Layer | null;
  doc: DocApi;
  editor: EditorApi;
}

export interface ToolDefinition {
  id: ToolId;
  label: string;
  /** Single lowercase activation key (Illustrator-style). */
  shortcut: string;
  /** CSS cursor applied to the canvas while this tool is active. */
  cursor: string;
  /** Whether the ambient grid/point snap indicator follows the cursor while merely
   *  HOVERING (no drag). Default true — placement tools (pen, shapes) want to preview
   *  where a click lands. A pick-only tool like select sets this false so the crosshair
   *  doesn't chase the grid during selection; it still sets a snap target itself while
   *  dragging a node, so dragging keeps snapping. */
  snapsOnHover?: boolean;

  onPointerDown?(ctx: ToolPointerContext): void;
  onPointerMove?(ctx: ToolPointerContext): void;
  onPointerUp?(ctx: ToolPointerContext): void;
  onKeyDown?(event: KeyboardEvent, ctx: ToolKeyContext): void;
}

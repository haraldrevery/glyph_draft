import { useDocumentStore } from "../state/documentStore";
import { useHistoryStore } from "../state/history";
import { useEditorStore } from "../state/editorStore";
import { useViewportStore } from "../state/viewportStore";
import { useKeybindingStore } from "../state/keybindingStore";
import { saveNow } from "../state/persistence";
import { TOOLS } from "../features/tools";
import * as clipboard from "../features/clipboard/clipboardActions";
import * as edit from "../features/canvas/editActions";
import type { Command, KeyChord } from "./types";

/**
 * The command registry: the flat list of every named action plus its default
 * keybindings. Global shortcuts, right-click menus, and (later) a keybind editor
 * are all views over this one array — keeping a single definition per action and
 * avoiding the divergent, hardcoded shortcut handling this phase replaces.
 *
 * Commands are React-free and read the stores via getState() (the tool pattern).
 * Tool-switch commands are GENERATED from `TOOLS`, so the "add a ToolDefinition →
 * free shortcut" guarantee still holds through this single path.
 */

/** After an undo/redo, repair the active pointers and drop transient state. */
function afterHistory(): void {
  useDocumentStore.getState().reconcileActive();
  useEditorStore.getState().resetEphemeral();
}

/** Delete the selected anchors. The "Delete node splits path" setting picks
 *  between splitting the path at each node and reconnecting its neighbors. */
function deleteSelection(): void {
  const editor = useEditorStore.getState();
  if (editor.selection.length === 0) return;
  const doc = useDocumentStore.getState();
  if (useViewportStore.getState().deleteSplits) doc.splitAtPoints(editor.selection);
  else doc.deletePoints(editor.selection);
  editor.clearSelection();
}

/** Convert the selected nodes' continuity (smooth/cusp/corner). Selection is kept
 *  so the converted node's new handles stay visible for grabbing. */
function convertSelectedNodes(mode: "smooth" | "cusp" | "corner"): void {
  const { selection } = useEditorStore.getState();
  if (selection.length === 0) return;
  useDocumentStore.getState().convertPoints(selection, mode);
}

const editCommands: Command[] = [
  {
    id: "edit.undo",
    label: "Undo",
    group: "edit",
    defaultKeys: [{ key: "z", mod: true }],
    run: () => {
      useHistoryStore.getState().undo();
      afterHistory();
    },
    isEnabled: () => useHistoryStore.getState().pastStates.length > 0,
  },
  {
    id: "edit.redo",
    label: "Redo",
    group: "edit",
    defaultKeys: [
      { key: "z", mod: true, shift: true },
      { key: "y", mod: true },
    ],
    run: () => {
      useHistoryStore.getState().redo();
      afterHistory();
    },
    isEnabled: () => useHistoryStore.getState().futureStates.length > 0,
  },
  {
    id: "edit.cut",
    label: "Cut",
    group: "edit",
    defaultKeys: [{ key: "x", mod: true }],
    run: clipboard.cut,
    isEnabled: clipboard.canCopy,
  },
  {
    id: "edit.copy",
    label: "Copy",
    group: "edit",
    defaultKeys: [{ key: "c", mod: true }],
    run: clipboard.copy,
    isEnabled: clipboard.canCopy,
  },
  {
    id: "edit.paste",
    label: "Paste",
    group: "edit",
    defaultKeys: [{ key: "v", mod: true }],
    run: clipboard.paste,
    isEnabled: clipboard.canPaste,
  },
  {
    id: "edit.selectAll",
    label: "Select All",
    group: "edit",
    defaultKeys: [{ key: "a", mod: true }],
    run: clipboard.selectAll,
  },
  {
    id: "edit.delete",
    label: "Delete",
    group: "edit",
    defaultKeys: [{ key: "Delete" }, { key: "Backspace" }],
    run: deleteSelection,
    isEnabled: () => useEditorStore.getState().selection.length > 0,
  },
  {
    id: "edit.transform",
    label: "Transform",
    group: "edit",
    defaultKeys: [{ key: "t", mod: true }],
    run: () => useEditorStore.getState().setTransforming(true),
    isEnabled: () => useEditorStore.getState().selection.length > 0,
  },
  {
    id: "edit.smoothNode",
    label: "Make smooth",
    group: "edit",
    defaultKeys: [],
    run: () => convertSelectedNodes("smooth"),
    isEnabled: () => useEditorStore.getState().selection.length > 0,
  },
  {
    id: "edit.cuspNode",
    label: "Make cusp",
    group: "edit",
    defaultKeys: [],
    run: () => convertSelectedNodes("cusp"),
    isEnabled: () => useEditorStore.getState().selection.length > 0,
  },
  {
    id: "edit.cornerNode",
    label: "Make corner",
    group: "edit",
    defaultKeys: [],
    run: () => convertSelectedNodes("corner"),
    isEnabled: () => useEditorStore.getState().selection.length > 0,
  },
  {
    id: "edit.duplicate",
    label: "Duplicate",
    group: "edit",
    defaultKeys: [{ key: "d", mod: true }],
    run: clipboard.duplicate,
    isEnabled: clipboard.canCopy,
  },
  {
    id: "edit.flipH",
    label: "Flip horizontal",
    group: "edit",
    defaultKeys: [],
    run: () => edit.flipSelection("h"),
    isEnabled: edit.hasSelection,
  },
  {
    id: "edit.flipV",
    label: "Flip vertical",
    group: "edit",
    defaultKeys: [],
    run: () => edit.flipSelection("v"),
    isEnabled: edit.hasSelection,
  },
  {
    id: "edit.reverse",
    label: "Reverse path direction",
    group: "edit",
    defaultKeys: [],
    run: edit.reverseSelection,
    isEnabled: edit.hasSelection,
  },
  {
    id: "edit.mergeNodes",
    label: "Merge nodes",
    group: "edit",
    defaultKeys: [],
    run: edit.mergeSelectedEndpoints,
    isEnabled: edit.canMergeEndpoints,
    isVisible: edit.canMergeEndpoints,
  },
  {
    id: "edit.expandStroke",
    label: "Expand stroke",
    group: "edit",
    defaultKeys: [],
    run: edit.expandSelectedStrokes,
    isEnabled: edit.canExpandStrokes,
    isVisible: edit.canExpandStrokes,
  },
  {
    // Layer GROUP/UNGROUP. Layer ops are normally built inline in the Layers panel
    // (they're parameterized by the clicked row), but a keyboard shortcut can only
    // exist through this registry — `useCommandKeys` is the one global key handler.
    // These stay parameter-free by reading `selectedLayerIds` themselves, exactly as
    // the edit.* commands read `editorStore.selection`.
    id: "layer.group",
    label: "Group layers",
    group: "edit",
    defaultKeys: [{ key: "g", mod: true }],
    run: () => {
      const doc = useDocumentStore.getState();
      doc.groupLayers(doc.selectedLayerIds);
    },
    isEnabled: () => useDocumentStore.getState().selectedLayerIds.length > 0,
  },
  {
    id: "layer.ungroup",
    label: "Ungroup",
    group: "edit",
    defaultKeys: [{ key: "g", mod: true, shift: true }],
    run: () => {
      const gid = activeGroupId();
      if (gid) useDocumentStore.getState().ungroupGroup(gid);
    },
    isEnabled: () => activeGroupId() !== null,
  },
];

/** The group of the active layer, or null when it is not in one. */
function activeGroupId(): string | null {
  const s = useDocumentStore.getState();
  const glyph = s.activeGlyphId ? s.glyphs[s.activeGlyphId] : null;
  if (!glyph) return null;
  return glyph.layers.find((l) => l.id === s.activeLayerId)?.groupId ?? null;
}

/** Arrow-key nudge of the selected anchors: 1 unit, or 10 with Shift. Generated so
 *  the four directions × two steps stay in sync. */
const NUDGE_STEP = 1;
const NUDGE_BIG = 10;
const nudgeCommands: Command[] = (
  [
    ["Up", "ArrowUp", 0, -1],
    ["Down", "ArrowDown", 0, 1],
    ["Left", "ArrowLeft", -1, 0],
    ["Right", "ArrowRight", 1, 0],
  ] as const
).flatMap(([name, key, ux, uy]) => [
  {
    id: `edit.nudge${name}`,
    label: `Nudge ${name.toLowerCase()}`,
    group: "edit",
    defaultKeys: [{ key }],
    run: () => edit.nudgeSelection(ux * NUDGE_STEP, uy * NUDGE_STEP),
    isEnabled: edit.hasSelection,
  },
  {
    id: `edit.nudge${name}Big`,
    label: `Nudge ${name.toLowerCase()} ×10`,
    group: "edit",
    defaultKeys: [{ key, shift: true }],
    run: () => edit.nudgeSelection(ux * NUDGE_BIG, uy * NUDGE_BIG),
    isEnabled: edit.hasSelection,
  },
]);

const fileCommands: Command[] = [
  {
    id: "file.save",
    label: "Save",
    group: "file",
    defaultKeys: [{ key: "s", mod: true }],
    run: () => {
      void saveNow();
    },
  },
];

const viewCommands: Command[] = [
  {
    id: "view.outline",
    label: "Outline / Preview view",
    group: "view",
    defaultKeys: [{ key: "o", mod: true, shift: true }],
    run: () => useViewportStore.getState().toggleOutlineMode(),
  },
  {
    id: "view.zoomFit",
    label: "Zoom to fit",
    group: "view",
    defaultKeys: [{ key: "0", mod: true }],
    run: () => useViewportStore.getState().resetView(),
  },
  {
    id: "view.zoomSelection",
    label: "Zoom to selection",
    group: "view",
    defaultKeys: [{ key: "2", mod: true }],
    run: () => {
      const b = edit.selectionBounds();
      const vp = useViewportStore.getState();
      if (b) vp.zoomToBounds({ x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY });
      else vp.resetView(); // nothing selected → fit the glyph
    },
  },
  {
    id: "view.actualSize",
    label: "Actual size (100%)",
    group: "view",
    defaultKeys: [{ key: "1", mod: true }],
    run: () => useViewportStore.getState().setZoom(1),
  },
];

const toolCommands: Command[] = TOOLS.map((t) => ({
  id: `tool.${t.id}`,
  label: t.label,
  group: "tool",
  defaultKeys: [{ key: t.shortcut }],
  run: () => useEditorStore.getState().setTool(t.id),
}));

export const COMMANDS: Command[] = [
  ...editCommands,
  ...nudgeCommands,
  ...fileCommands,
  ...viewCommands,
  ...toolCommands,
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandById(id: string): Command | undefined {
  return BY_ID.get(id);
}

export function commandsInGroup(group: string): Command[] {
  return COMMANDS.filter((c) => c.group === group);
}

/** Build context-menu rows from command ids: resolves each id, drops hidden
 *  commands, and exposes the run/disabled state. Returns plain objects so menu
 *  code stays decoupled from the Command type. */
export function commandMenuItems(
  ids: string[],
): { label: string; onSelect: () => void; disabled: boolean }[] {
  return ids
    .map(commandById)
    .filter((c): c is Command => !!c && c.isVisible?.() !== false)
    .map((c) => ({
      label: c.label,
      onSelect: c.run,
      disabled: c.isEnabled ? !c.isEnabled() : false,
    }));
}

/** Normalize an event key: single characters lowercased (so Shift-affected case
 *  is ignored), named keys (Delete, Escape, …) kept verbatim. */
function normKey(e: KeyboardEvent): string {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

function chordMatches(chord: KeyChord, e: KeyboardEvent): boolean {
  return (
    chord.key === normKey(e) &&
    !!chord.mod === (e.ctrlKey || e.metaKey) &&
    !!chord.shift === e.shiftKey &&
    !!chord.alt === e.altKey
  );
}

/** Two chords are equal (used for conflict detection in the keybinding editor). */
export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return (
    a.key === b.key &&
    !!a.mod === !!b.mod &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

/** A command's CURRENTLY bound chords: the user override if any, else defaults. */
export function effectiveKeys(command: Command): KeyChord[] {
  return useKeybindingStore.getState().overrides[command.id] ?? command.defaultKeys ?? [];
}

/** Resolve a keydown to the command bound to it (honoring user overrides), if any.
 *  Modifier matching is exact, so plain "v" (select tool) and Ctrl+V (paste) never
 *  collide. */
export function matchKey(e: KeyboardEvent): Command | undefined {
  return COMMANDS.find((c) => effectiveKeys(c).some((ch) => chordMatches(ch, e)));
}

/** The command a chord is currently bound to (excluding one id), for conflicts. */
export function commandUsing(chord: KeyChord, excludeId?: string): Command | undefined {
  return COMMANDS.find(
    (c) => c.id !== excludeId && effectiveKeys(c).some((ch) => sameChord(ch, chord)),
  );
}

/** Human-readable label for a chord, e.g. "Ctrl Z", "⇧ V", "Delete". */
export function formatChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push("Ctrl");
  if (chord.shift) parts.push("⇧");
  if (chord.alt) parts.push("Alt");
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return parts.join(" ");
}

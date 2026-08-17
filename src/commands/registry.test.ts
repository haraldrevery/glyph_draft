import { describe, it, expect, beforeEach } from "vitest";
import {
  matchKey,
  commandById,
  commandMenuItems,
  effectiveKeys,
  commandUsing,
  formatChord,
} from "./registry";
import { useEditorStore } from "../state/editorStore";
import { useClipboardStore } from "../state/clipboardStore";
import { useKeybindingStore } from "../state/keybindingStore";
import { useViewportStore } from "../state/viewportStore";
import { useDocumentStore } from "../state/documentStore";
import type { Glyph } from "../types/document";
import type { Contour, PointRef } from "../types/geometry";

/**
 * The command registry is the single source of shortcuts. These tests pin the
 * key resolution (exact modifier matching, so plain "v" ≠ Ctrl+V) and the
 * enable gating that drives both shortcuts and right-click menus. Pure: fake
 * event objects, no DOM.
 */

function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("basics-pack commands", () => {
  it("registers duplicate / nudge / zoom with the expected default keys", () => {
    expect(commandById("edit.duplicate")?.defaultKeys).toEqual([{ key: "d", mod: true }]);
    expect(matchKey(ev({ key: "ArrowUp" }))?.id).toBe("edit.nudgeUp");
    expect(matchKey(ev({ key: "ArrowDown", shiftKey: true }))?.id).toBe("edit.nudgeDownBig");
    expect(matchKey(ev({ key: "0", ctrlKey: true }))?.id).toBe("view.zoomFit");
    expect(matchKey(ev({ key: "1", ctrlKey: true }))?.id).toBe("view.actualSize");
  });

  it("exposes flip / reverse as unbound, selection-gated commands", () => {
    for (const id of ["edit.flipH", "edit.flipV", "edit.reverse"]) {
      const cmd = commandById(id)!;
      expect(cmd.defaultKeys).toEqual([]);
      expect(cmd.isEnabled).toBeTypeOf("function");
    }
  });
});

describe("matchKey", () => {
  it("resolves history chords (mod + shift variants)", () => {
    expect(matchKey(ev({ key: "z", ctrlKey: true }))?.id).toBe("edit.undo");
    expect(matchKey(ev({ key: "z", metaKey: true }))?.id).toBe("edit.undo");
    expect(matchKey(ev({ key: "z", ctrlKey: true, shiftKey: true }))?.id).toBe("edit.redo");
    expect(matchKey(ev({ key: "y", ctrlKey: true }))?.id).toBe("edit.redo");
  });

  it("distinguishes a plain tool key from its Ctrl combo", () => {
    expect(matchKey(ev({ key: "v" }))?.id).toBe("tool.select");
    expect(matchKey(ev({ key: "v", ctrlKey: true }))?.id).toBe("edit.paste");
    expect(matchKey(ev({ key: "p" }))?.id).toBe("tool.pen");
  });

  it("resolves clipboard, select-all, save, and delete", () => {
    expect(matchKey(ev({ key: "c", ctrlKey: true }))?.id).toBe("edit.copy");
    expect(matchKey(ev({ key: "x", ctrlKey: true }))?.id).toBe("edit.cut");
    expect(matchKey(ev({ key: "a", ctrlKey: true }))?.id).toBe("edit.selectAll");
    expect(matchKey(ev({ key: "s", ctrlKey: true }))?.id).toBe("file.save");
    expect(matchKey(ev({ key: "Delete" }))?.id).toBe("edit.delete");
    expect(matchKey(ev({ key: "Backspace" }))?.id).toBe("edit.delete");
  });

  it("resolves the outline-view toggle (Ctrl+Shift+O)", () => {
    expect(matchKey(ev({ key: "o", ctrlKey: true, shiftKey: true }))?.id).toBe("view.outline");
    expect(matchKey(ev({ key: "o", ctrlKey: true }))).toBeUndefined(); // needs shift
  });

  it("returns undefined for an unbound key", () => {
    expect(matchKey(ev({ key: "j" }))).toBeUndefined();
    expect(matchKey(ev({ key: "z", altKey: true }))).toBeUndefined();
  });
});

describe("isEnabled gating", () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
    useClipboardStore.getState().setContours([]);
  });

  it("disables paste with an empty clipboard, enables it when filled", () => {
    expect(commandById("edit.paste")!.isEnabled!()).toBe(false);
    useClipboardStore.getState().setContours([
      { id: "c", closed: true, points: [{ id: "p", type: "corner", x: 0, y: 0 }] },
    ]);
    expect(commandById("edit.paste")!.isEnabled!()).toBe(true);
  });

  it("disables delete/copy with no selection, enables with one", () => {
    expect(commandById("edit.delete")!.isEnabled!()).toBe(false);
    expect(commandById("edit.copy")!.isEnabled!()).toBe(false);
    const ref: PointRef = { layerId: "L", contourId: "c", pointId: "p" };
    useEditorStore.getState().setSelection([ref]);
    expect(commandById("edit.delete")!.isEnabled!()).toBe(true);
    expect(commandById("edit.copy")!.isEnabled!()).toBe(true);
  });
});

describe("keybinding overrides", () => {
  beforeEach(() => useKeybindingStore.getState().resetAll());

  it("effectiveKeys returns the override when set, else the default", () => {
    expect(effectiveKeys(commandById("file.save")!)).toEqual([{ key: "s", mod: true }]);
    useKeybindingStore.getState().setOverride("file.save", [{ key: "k", mod: true }]);
    expect(effectiveKeys(commandById("file.save")!)).toEqual([{ key: "k", mod: true }]);
  });

  it("matchKey honors an override (new chord matches, old default no longer does)", () => {
    useKeybindingStore.getState().setOverride("file.save", [{ key: "k", mod: true }]);
    expect(matchKey(ev({ key: "k", ctrlKey: true }))?.id).toBe("file.save");
    // The old Ctrl+S no longer resolves to save (nothing else binds it).
    expect(matchKey(ev({ key: "s", ctrlKey: true }))?.id).not.toBe("file.save");
  });

  it("commandUsing finds the command a chord is bound to", () => {
    expect(commandUsing({ key: "c", mod: true })?.id).toBe("edit.copy");
    expect(commandUsing({ key: "c", mod: true }, "edit.copy")).toBeUndefined();
  });

  it("formatChord renders modifiers and key", () => {
    expect(formatChord({ key: "z", mod: true })).toBe("Ctrl Z");
    expect(formatChord({ key: "z", mod: true, shift: true })).toBe("Ctrl ⇧ Z");
    expect(formatChord({ key: "Delete" })).toBe("Delete");
  });
});

describe("node continuity commands", () => {
  beforeEach(() => useEditorStore.getState().clearSelection());

  it("exposes smooth/cusp/corner, gated on a node selection", () => {
    for (const id of ["edit.smoothNode", "edit.cuspNode", "edit.cornerNode"]) {
      const cmd = commandById(id)!;
      expect(cmd).toBeTruthy();
      expect(cmd.isEnabled!()).toBe(false); // nothing selected
    }
    useEditorStore.getState().setSelection([
      { layerId: "L", contourId: "c", pointId: "p" },
    ]);
    for (const id of ["edit.smoothNode", "edit.cuspNode", "edit.cornerNode"]) {
      expect(commandById(id)!.isEnabled!()).toBe(true);
    }
  });
});

describe("commandMenuItems", () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
    useClipboardStore.getState().setContours([]);
  });

  it("maps ids to labelled rows carrying disabled state", () => {
    const items = commandMenuItems(["edit.copy", "edit.paste"]);
    expect(items.map((i) => i.label)).toEqual(["Copy", "Paste"]);
    expect(items.every((i) => i.disabled)).toBe(true); // nothing selected / clipboard empty
  });

  it("skips unknown ids", () => {
    expect(commandMenuItems(["nope", "edit.copy"]).map((i) => i.label)).toEqual(["Copy"]);
  });
});

describe("edit.delete honors the deleteSplits setting", () => {
  function seedPath(): void {
    const points = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      type: "corner" as const,
      x: i * 10,
      y: 0,
    }));
    const contour: Contour = { id: "c", closed: false, points };
    const glyph: Glyph = {
      id: "G",
      codepoint: 0x41,
      name: "A",
      advanceWidth: 600,
      layers: [{ id: "LA", name: "LA", visible: true, locked: false, contours: [contour] }],
    };
    useDocumentStore.setState({
      glyphs: { G: glyph },
      activeGlyphId: "G",
      activeLayerId: "LA",
      selectedLayerIds: ["LA"],
    });
    useEditorStore.getState().setSelection([{ layerId: "LA", contourId: "c", pointId: "p2" }]);
  }
  const contours = () => useDocumentStore.getState().glyphs["G"]!.layers[0]!.contours;

  it("off → reconnects neighbors (one contour, point removed)", () => {
    seedPath();
    useViewportStore.setState({ deleteSplits: false });
    commandById("edit.delete")!.run();
    expect(contours()).toHaveLength(1);
    expect(contours()[0]!.points).toHaveLength(4); // p2 removed, rest connected
    expect(useEditorStore.getState().selection).toEqual([]); // cleared
  });

  it("on → splits the path at the deleted node (two contours)", () => {
    seedPath();
    useViewportStore.setState({ deleteSplits: true });
    commandById("edit.delete")!.run();
    expect(contours()).toHaveLength(2); // [p0,p1] and [p3,p4]
    useViewportStore.setState({ deleteSplits: false }); // restore default
  });
});

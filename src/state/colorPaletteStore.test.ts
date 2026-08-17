import { describe, it, expect, beforeEach } from "vitest";
import { useColorPaletteStore } from "./colorPaletteStore";

describe("colorPaletteStore.upsertPalette", () => {
  beforeEach(() => useColorPaletteStore.getState().resetAll());

  it("adds a new palette and trims the label", () => {
    const id = useColorPaletteStore.getState().upsertPalette("  Reds  ", ["#ff0000"]);
    const palettes = useColorPaletteStore.getState().palettes;
    expect(palettes).toHaveLength(1);
    expect(palettes[0]).toMatchObject({ id, label: "Reds", colors: ["#ff0000"] });
  });

  it("overwrites colours by name (case-insensitive) instead of duplicating", () => {
    const id1 = useColorPaletteStore.getState().upsertPalette("Reds", ["#ff0000"]);
    const id2 = useColorPaletteStore.getState().upsertPalette("  reds ", ["#00ff00", "#0000ff"]);
    const palettes = useColorPaletteStore.getState().palettes;
    expect(palettes).toHaveLength(1); // no duplicate
    expect(id2).toBe(id1); // same palette
    expect(palettes[0]!.colors).toEqual(["#00ff00", "#0000ff"]); // colours replaced
  });

  it("keeps distinct names as separate palettes", () => {
    useColorPaletteStore.getState().upsertPalette("A", ["#000000"]);
    useColorPaletteStore.getState().upsertPalette("B", ["#ffffff"]);
    expect(useColorPaletteStore.getState().palettes).toHaveLength(2);
  });

  it("updatePalette patches colours without touching the id", () => {
    const id = useColorPaletteStore.getState().upsertPalette("A", ["#000000"]);
    useColorPaletteStore.getState().updatePalette(id, { colors: ["#000000", "#111111"] });
    const palettes = useColorPaletteStore.getState().palettes;
    expect(palettes[0]!.id).toBe(id);
    expect(palettes[0]!.colors).toEqual(["#000000", "#111111"]);
  });

  it("removePalette drops only the targeted palette", () => {
    const a = useColorPaletteStore.getState().upsertPalette("A", ["#000000"]);
    useColorPaletteStore.getState().upsertPalette("B", ["#ffffff"]);
    useColorPaletteStore.getState().removePalette(a);
    const palettes = useColorPaletteStore.getState().palettes;
    expect(palettes).toHaveLength(1);
    expect(palettes[0]!.label).toBe("B");
  });

  it("does not alias the input colours array", () => {
    const input = ["#ff0000"];
    useColorPaletteStore.getState().upsertPalette("A", input);
    input.push("#00ff00");
    expect(useColorPaletteStore.getState().palettes[0]!.colors).toEqual(["#ff0000"]);
  });
});

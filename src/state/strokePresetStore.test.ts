import { describe, it, expect, beforeEach } from "vitest";
import { useStrokePresetStore } from "./strokePresetStore";
import type { StrokeStyle } from "../types/geometry";

const style = (width: number): StrokeStyle => ({
  width,
  startCap: "butt",
  endCap: "butt",
  join: "miter",
});

describe("strokePresetStore.upsertPreset", () => {
  beforeEach(() => useStrokePresetStore.getState().resetAll());

  it("adds a new preset and trims the label", () => {
    const id = useStrokePresetStore.getState().upsertPreset("  Beak  ", style(40));
    const presets = useStrokePresetStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ id, label: "Beak" });
    expect(presets[0]!.style.width).toBe(40);
  });

  it("overwrites by name (case-insensitive) instead of duplicating", () => {
    const id1 = useStrokePresetStore.getState().upsertPreset("Beak", style(40));
    const id2 = useStrokePresetStore.getState().upsertPreset("  beak ", style(99));
    const presets = useStrokePresetStore.getState().presets;
    expect(presets).toHaveLength(1); // no duplicate
    expect(id2).toBe(id1); // same preset
    expect(presets[0]!.style.width).toBe(99); // style replaced
  });

  it("keeps distinct names as separate presets", () => {
    useStrokePresetStore.getState().upsertPreset("A", style(10));
    useStrokePresetStore.getState().upsertPreset("B", style(20));
    expect(useStrokePresetStore.getState().presets).toHaveLength(2);
  });

  it("removePreset drops only the targeted preset", () => {
    const a = useStrokePresetStore.getState().upsertPreset("A", style(10));
    useStrokePresetStore.getState().upsertPreset("B", style(20));
    useStrokePresetStore.getState().removePreset(a);
    const presets = useStrokePresetStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]!.label).toBe("B");
  });
});

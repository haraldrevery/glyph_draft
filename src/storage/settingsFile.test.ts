import { describe, it, expect } from "vitest";
import {
  serializeSettings,
  migrateSettings,
  mergeSettings,
  SETTINGS_VERSION,
  type PersistedSettings,
} from "./settingsFile";

/**
 * The settings envelope mirrors the document format: a versioned wrapper plus a
 * lenient, never-throwing reader. Pure (no storage, no DOM).
 */

const BASE: PersistedSettings = {
  theme: "dark",
  grid: { size: 50, visible: true, snap: true, snapHandles: false },
  polygonSides: 6,
  deleteSplits: false,
  mergeEndpoints: true,
  mergeHalftones: false,
  alignMode: "nodes",
  guides: { ascender: 800, capHeight: 700, xHeight: 500, descender: 200 },
  onion: { enabled: false, opacity: 0.32 },
};

describe("serializeSettings / migrateSettings", () => {
  it("round-trips a full settings object", () => {
    const file = serializeSettings(BASE);
    expect(file.version).toBe(SETTINGS_VERSION);
    expect(migrateSettings(file)).toEqual(BASE);
  });

  it("returns a partial for partial input and drops unknown / wrong-typed fields", () => {
    const patch = migrateSettings({
      version: 1,
      savedAt: 1,
      settings: {
        theme: "light",
        polygonSides: 8,
        bogus: "nope", // unknown → dropped
        deleteSplits: "yes", // wrong type → dropped
        grid: { size: 25, visible: "no" }, // visible wrong type → dropped
      },
    });
    expect(patch).toEqual({ theme: "light", polygonSides: 8, grid: { size: 25 } });
  });

  it("accepts an unversioned but shaped blob defensively", () => {
    expect(migrateSettings({ theme: "light" })).toEqual({ theme: "light" });
  });

  it("returns null for non-records and unknown versions", () => {
    expect(migrateSettings(null)).toBeNull();
    expect(migrateSettings(42)).toBeNull();
    expect(migrateSettings({ version: 99, settings: {} })).toBeNull();
  });

  it("round-trips keybinding overrides (v2)", () => {
    const withKeys: PersistedSettings = {
      ...BASE,
      keybindings: { "file.save": [{ key: "k", mod: true }] },
    };
    expect(migrateSettings(serializeSettings(withKeys))).toEqual(withKeys);
  });

  it("loads a v1 blob (no keybindings) untouched", () => {
    const v1 = { version: 1, savedAt: 1, settings: { theme: "light", polygonSides: 5 } };
    expect(migrateSettings(v1)).toEqual({ theme: "light", polygonSides: 5 });
  });

  it("round-trips stroke presets (v3)", () => {
    const withPresets: PersistedSettings = {
      ...BASE,
      strokePresets: [
        {
          id: "p1",
          label: "My beak",
          style: { width: 40, startCap: "butt", endCap: "serif", join: "miter" },
        },
      ],
    };
    expect(migrateSettings(serializeSettings(withPresets))).toEqual(withPresets);
  });

  it("drops malformed stroke presets", () => {
    const patch = migrateSettings({
      version: 3,
      savedAt: 1,
      settings: {
        strokePresets: [
          { id: "ok", label: "Good", style: { width: 20, startCap: "butt", endCap: "butt", join: "miter" } },
          { id: "no-style", label: "Bad" }, // missing style → dropped
          { id: "bad-style", label: "Bad", style: { width: "x" } }, // bad style → dropped
          "nope", // not an object → dropped
        ],
      },
    });
    expect(patch).toEqual({
      strokePresets: [
        { id: "ok", label: "Good", style: { width: 20, startCap: "butt", endCap: "butt", join: "miter" } },
      ],
    });
  });

  it("drops malformed keybindings", () => {
    const patch = migrateSettings({
      version: 2,
      savedAt: 1,
      settings: {
        keybindings: {
          "a.b": [{ key: "z" }], // valid
          "bad.1": "nope", // not an array → dropped
          "bad.2": [{ nope: true }], // chord without `key` → dropped
        },
      },
    });
    expect(patch).toEqual({ keybindings: { "a.b": [{ key: "z" }] } });
  });
});

describe("mergeSettings", () => {
  it("fills missing top-level and nested fields from base", () => {
    const merged = mergeSettings(BASE, {
      theme: "light",
      grid: { size: 10 },
      onion: { opacity: 0.5 },
    });
    expect(merged.theme).toBe("light");
    expect(merged.grid).toEqual({ size: 10, visible: true, snap: true, snapHandles: false });
    expect(merged.onion).toEqual({ enabled: false, opacity: 0.5 });
    expect(merged.polygonSides).toBe(6); // untouched from base
  });

  it("returns base values for an empty patch", () => {
    expect(mergeSettings(BASE, {})).toEqual(BASE);
  });
});

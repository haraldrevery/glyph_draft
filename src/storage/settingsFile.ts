import type { GridSettings, Theme } from "../types/viewport";
import type { KeyChord } from "../commands/types";
import type { ColorPalette, StrokePreset } from "../types/geometry";
import type { AlignMode, GuideMetrics } from "../state/viewportStore";

/**
 * On-disk format for UI/editor PREFERENCES — a deliberate mirror of the document
 * format (`projectFile.ts`): a versioned envelope plus a lenient, never-throwing
 * reader, so future preferences (e.g. keybinding overrides, language) become an
 * additive `version` bump, not a rewrite.
 *
 * This is a SEPARATE KV key from the document, so it can never affect document
 * safety. The reader returns a *partial* — the lifecycle (`state/settings.ts`)
 * merges it over the live stores' defaults, so missing/corrupt fields simply fall
 * back and the app always launches.
 */

export const SETTINGS_VERSION = 7 as const;

export const SETTINGS_KEY = "glyphdraft:settings";
/** Where an unreadable settings blob is parked on load (never silently discarded). */
export const SETTINGS_CORRUPT_KEY = "glyphdraft:settings.corrupt";

/** The persisted preferences (camera, ephemeral editor state, and the document
 *  are intentionally NOT here). Future fields land here behind a version bump. */
export interface PersistedSettings {
  theme: Theme;
  grid: GridSettings;
  polygonSides: number;
  deleteSplits: boolean;
  mergeEndpoints: boolean;
  /** Render same-style halftone strokes in a layer as one combined halftone (v6+). */
  mergeHalftones: boolean;
  onion: { enabled: boolean; opacity: number; renderSvg?: boolean };
  /** Align panel measure mode (v4+). */
  alignMode: AlignMode;
  /** On-canvas typography guide positions (v4+). */
  guides: GuideMetrics;
  /** User keybinding overrides, keyed by command id (v2+). Absent = all defaults. */
  keybindings?: Record<string, KeyChord[]>;
  /** User stroke presets — the saved brush library (v3+). Absent = none. */
  strokePresets?: StrokePreset[];
  /** User colour palettes — the saved swatch sets (v5+). Absent = none. */
  colorPalettes?: ColorPalette[];
  /** User accent-colour override (CSS colour) over the theme default (v7+). Absent = default. */
  accentColor?: string;
}

export interface SettingsFileV7 {
  version: 7;
  /** Epoch ms of the write. */
  savedAt: number;
  settings: PersistedSettings;
}

export type SettingsFile = SettingsFileV7;

/** Wrap live settings in the current envelope for persistence. */
export function serializeSettings(settings: PersistedSettings): SettingsFile {
  return { version: SETTINGS_VERSION, savedAt: Date.now(), settings };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const bool = (x: unknown): x is boolean => typeof x === "boolean";

/** Pick only the known, correctly-typed grid fields from arbitrary input. */
function pickGrid(x: unknown): Partial<GridSettings> | undefined {
  if (!isRecord(x)) return undefined;
  const g: Partial<GridSettings> = {};
  if (num(x.size)) g.size = x.size;
  if (bool(x.visible)) g.visible = x.visible;
  if (bool(x.snap)) g.snap = x.snap;
  if (bool(x.snapHandles)) g.snapHandles = x.snapHandles;
  return Object.keys(g).length ? g : undefined;
}

function pickOnion(x: unknown): Partial<PersistedSettings["onion"]> | undefined {
  if (!isRecord(x)) return undefined;
  const o: Partial<PersistedSettings["onion"]> = {};
  if (bool(x.enabled)) o.enabled = x.enabled;
  if (num(x.opacity)) o.opacity = x.opacity;
  if (bool(x.renderSvg)) o.renderSvg = x.renderSvg;
  return Object.keys(o).length ? o : undefined;
}

function pickGuides(x: unknown): Partial<GuideMetrics> | undefined {
  if (!isRecord(x)) return undefined;
  const g: Partial<GuideMetrics> = {};
  if (num(x.ascender)) g.ascender = x.ascender;
  if (num(x.capHeight)) g.capHeight = x.capHeight;
  if (num(x.xHeight)) g.xHeight = x.xHeight;
  if (num(x.descender)) g.descender = x.descender;
  return Object.keys(g).length ? g : undefined;
}

function isChord(x: unknown): x is KeyChord {
  return isRecord(x) && typeof x.key === "string";
}

/** A record of command id → chord[], keeping only well-formed entries. */
function pickKeybindings(x: unknown): Record<string, KeyChord[]> | undefined {
  if (!isRecord(x)) return undefined;
  const out: Record<string, KeyChord[]> = {};
  for (const [id, chords] of Object.entries(x)) {
    if (Array.isArray(chords) && chords.every(isChord)) out[id] = chords as KeyChord[];
  }
  return Object.keys(out).length ? out : undefined;
}

/** A stroke-preset entry: an id, a label, and a minimally shaped StrokeStyle. The
 *  style is kept verbatim (optional cap/serif/drop/rect fields pass through) once
 *  its required fields type-check — the engine clamps/defaults the rest. */
function isStrokePreset(x: unknown): x is StrokePreset {
  if (!isRecord(x)) return false;
  if (typeof x.id !== "string" || typeof x.label !== "string") return false;
  const st = x.style;
  return (
    isRecord(st) &&
    num(st.width) &&
    typeof st.startCap === "string" &&
    typeof st.endCap === "string" &&
    typeof st.join === "string"
  );
}

/** An array of well-formed stroke presets (drops malformed entries). */
function pickStrokePresets(x: unknown): StrokePreset[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter(isStrokePreset) as StrokePreset[];
  return out.length ? out : undefined;
}

/** A colour-palette entry: an id, a label, and an array of string colours. */
function isColorPalette(x: unknown): x is ColorPalette {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    typeof x.label === "string" &&
    Array.isArray(x.colors) &&
    x.colors.every((c) => typeof c === "string")
  );
}

/** An array of well-formed colour palettes (drops malformed entries). */
function pickColorPalettes(x: unknown): ColorPalette[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter(isColorPalette) as ColorPalette[];
  return out.length ? out : undefined;
}

/** Sanitize an arbitrary settings object into a typed partial (drops anything
 *  off-shape). `grid`/`onion` come back as their own partials for deep-merge. */
type SettingsPatch = Partial<Omit<PersistedSettings, "grid" | "onion" | "guides">> & {
  grid?: Partial<GridSettings>;
  onion?: Partial<PersistedSettings["onion"]>;
  guides?: Partial<GuideMetrics>;
};

function pickSettings(x: unknown): SettingsPatch | null {
  if (!isRecord(x)) return null;
  const out: SettingsPatch = {};
  if (x.theme === "dark" || x.theme === "light" || x.theme === "paper") out.theme = x.theme;
  if (typeof x.accentColor === "string") out.accentColor = x.accentColor;
  if (num(x.polygonSides)) out.polygonSides = x.polygonSides;
  if (bool(x.deleteSplits)) out.deleteSplits = x.deleteSplits;
  if (bool(x.mergeEndpoints)) out.mergeEndpoints = x.mergeEndpoints;
  if (bool(x.mergeHalftones)) out.mergeHalftones = x.mergeHalftones;
  if (x.alignMode === "nodes" || x.alignMode === "outline") out.alignMode = x.alignMode;
  const grid = pickGrid(x.grid);
  if (grid) out.grid = grid;
  const onion = pickOnion(x.onion);
  if (onion) out.onion = onion;
  const guides = pickGuides(x.guides);
  if (guides) out.guides = guides;
  const keybindings = pickKeybindings(x.keybindings);
  if (keybindings) out.keybindings = keybindings;
  const strokePresets = pickStrokePresets(x.strokePresets);
  if (strokePresets) out.strokePresets = strokePresets;
  const colorPalettes = pickColorPalettes(x.colorPalettes);
  if (colorPalettes) out.colorPalettes = colorPalettes;
  return out;
}

/**
 * Read a stored value back into a settings patch, or `null` if missing / of an
 * unknown version / not an object. Never throws. Returns a PARTIAL (merged over
 * defaults by the caller), so an old or truncated blob still loads cleanly.
 */
export function migrateSettings(raw: unknown): SettingsPatch | null {
  if (!isRecord(raw)) return null;
  // v1–v7 share a forward-compatible `settings` shape (each version only ADDS
  // fields — keybindings v2, strokePresets v3, alignMode/guides v4, colorPalettes
  // v5, mergeHalftones v6, accentColor + "paper" theme v7), so the same lenient picker
  // reads them all and old saves load untouched (missing fields fall back via mergeSettings).
  if (
    raw.version === 1 ||
    raw.version === 2 ||
    raw.version === 3 ||
    raw.version === 4 ||
    raw.version === 5 ||
    raw.version === 6 ||
    raw.version === 7
  )
    return pickSettings(raw.settings);
  if (!("version" in raw)) return pickSettings(raw); // unversioned shaped blob
  return null; // a version we don't know how to read
}

/** Deep-merge a sanitized patch over base defaults (nested grid/onion included). */
export function mergeSettings(
  base: PersistedSettings,
  patch: SettingsPatch,
): PersistedSettings {
  const merged: PersistedSettings = {
    theme: patch.theme ?? base.theme,
    polygonSides: patch.polygonSides ?? base.polygonSides,
    deleteSplits: patch.deleteSplits ?? base.deleteSplits,
    mergeEndpoints: patch.mergeEndpoints ?? base.mergeEndpoints,
    mergeHalftones: patch.mergeHalftones ?? base.mergeHalftones,
    alignMode: patch.alignMode ?? base.alignMode,
    grid: { ...base.grid, ...patch.grid },
    onion: { ...base.onion, ...patch.onion },
    guides: { ...base.guides, ...patch.guides },
  };
  // Optional fields (exactOptionalPropertyTypes): only set when present.
  const keybindings = patch.keybindings ?? base.keybindings;
  if (keybindings) merged.keybindings = keybindings;
  const strokePresets = patch.strokePresets ?? base.strokePresets;
  if (strokePresets) merged.strokePresets = strokePresets;
  const colorPalettes = patch.colorPalettes ?? base.colorPalettes;
  if (colorPalettes) merged.colorPalettes = colorPalettes;
  const accentColor = patch.accentColor ?? base.accentColor;
  if (accentColor) merged.accentColor = accentColor;
  return merged;
}

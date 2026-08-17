import { createStorage } from "../storage/createStorage";
import { useViewportStore } from "./viewportStore";
import { useOnionStore } from "./onionStore";
import { useKeybindingStore } from "./keybindingStore";
import { useStrokePresetStore } from "./strokePresetStore";
import { useColorPaletteStore } from "./colorPaletteStore";
import {
  SETTINGS_KEY,
  SETTINGS_CORRUPT_KEY,
  serializeSettings,
  migrateSettings,
  mergeSettings,
  type PersistedSettings,
} from "../storage/settingsFile";

/**
 * UI/editor PREFERENCE persistence — the sibling of `persistence.ts` (which owns
 * the document). It loads saved preferences on launch and debounce-saves them on
 * change, under a SEPARATE KV key so it can never touch document safety.
 *
 * Persisted: viewport (theme/grid/polygonSides/deleteSplits/mergeEndpoints) and
 * onion (enabled/opacity). NOT persisted: the camera (zoom/pan — refit on launch),
 * any ephemeral editor state, and onion `referenceIds` (they point at glyph ids
 * and would dangle across documents, so they stay session-local).
 *
 * Robustness: a missing/corrupt blob merges to defaults (the app always launches),
 * the unreadable blob is parked under the corrupt key, and saves are skipped when
 * the extracted settings are unchanged — so frequent camera moves never write.
 */

const DEBOUNCE_MS = 600;
let ready = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved = "";

/** Read the persistable fields from the live stores. */
function collectSettings(): PersistedSettings {
  const v = useViewportStore.getState();
  const o = useOnionStore.getState();
  return {
    theme: v.theme,
    grid: { ...v.grid },
    polygonSides: v.polygonSides,
    deleteSplits: v.deleteSplits,
    mergeEndpoints: v.mergeEndpoints,
    mergeHalftones: v.mergeHalftones,
    alignMode: v.alignMode,
    guides: { ...v.guides },
    onion: { enabled: o.enabled, opacity: o.opacity, renderSvg: o.renderSvg },
    keybindings: useKeybindingStore.getState().overrides,
    strokePresets: useStrokePresetStore.getState().presets,
    colorPalettes: useColorPaletteStore.getState().palettes,
    // Only persisted when set (null = theme default); exactOptionalPropertyTypes.
    ...(v.accentColor ? { accentColor: v.accentColor } : {}),
  };
}

/** Write loaded settings back into the stores (top-level shallow-merge; the
 *  nested grid/onion objects are provided whole). */
function applySettings(s: PersistedSettings): void {
  useViewportStore.setState({
    theme: s.theme,
    grid: s.grid,
    polygonSides: s.polygonSides,
    deleteSplits: s.deleteSplits,
    mergeEndpoints: s.mergeEndpoints,
    mergeHalftones: s.mergeHalftones,
    alignMode: s.alignMode,
    guides: s.guides,
    accentColor: s.accentColor ?? null,
  });
  useOnionStore.setState({
    enabled: s.onion.enabled,
    opacity: s.onion.opacity,
    renderSvg: s.onion.renderSvg ?? false,
  });
  useKeybindingStore.getState().setAll(s.keybindings ?? {});
  useStrokePresetStore.getState().setAll(s.strokePresets ?? []);
  useColorPaletteStore.getState().setAll(s.colorPalettes ?? []);
}

async function writeNow(): Promise<void> {
  const snapshot = JSON.stringify(collectSettings());
  try {
    const storage = await createStorage();
    await storage.setItem(SETTINGS_KEY, serializeSettings(collectSettings()));
    lastSaved = snapshot;
  } catch {
    /* preference loss is non-catastrophic — defaults load next time */
  }
}

function scheduleSave(): void {
  if (!ready) return;
  if (JSON.stringify(collectSettings()) === lastSaved) return; // no real change
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void writeNow();
  }, DEBOUNCE_MS);
}

/** Load saved preferences (if any) and start autosaving. Call once at startup. */
export async function initSettings(): Promise<void> {
  // The stores' own initial values are the single source of defaults.
  const defaults = collectSettings();
  try {
    const storage = await createStorage();
    const raw = await storage.getItem<unknown>(SETTINGS_KEY);
    const patch = migrateSettings(raw);
    if (patch) {
      applySettings(mergeSettings(defaults, patch));
    } else if (raw != null) {
      // Unreadable but present — park it rather than overwrite blindly.
      try {
        await storage.setItem(SETTINGS_CORRUPT_KEY, raw);
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* storage unavailable — keep defaults */
  }

  ready = true;
  lastSaved = JSON.stringify(collectSettings());

  // Save when a persisted field changes; the change-check ignores camera moves.
  useViewportStore.subscribe(scheduleSave);
  useOnionStore.subscribe(scheduleSave);
  useKeybindingStore.subscribe(scheduleSave);
  useStrokePresetStore.subscribe(scheduleSave);
  useColorPaletteStore.subscribe(scheduleSave);
}

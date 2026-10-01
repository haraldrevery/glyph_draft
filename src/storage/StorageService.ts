/**
 * Persistence abstraction. The whole app talks to this key/value interface and
 * never touches LocalForage or the Tauri filesystem directly. That keeps the
 * platform-specific code quarantined to two small adapter classes and makes the
 * "migrate desktop backend later" requirement a one-file change.
 *
 * Scope note: this is for DOCUMENT/SETTINGS PERSISTENCE only. Bulk SVG export to
 * a user-chosen folder (u_xxxx.svg) is a genuinely filesystem-shaped operation
 * and gets its own ExportService in Phase 6 — conflating the two would force a
 * file-path model onto the web build, which only has a KV store.
 */
export interface StorageService {
  /**
   * The stored value, or `null` when the key is absent. Throws `CorruptValueError`
   * when a value IS stored but cannot be decoded (e.g. a half-written file), and any
   * other error for an I/O failure — callers must treat those two differently: a
   * corrupt value is safe to replace from a backup, an unreadable one is not.
   */
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** All keys currently stored. */
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * A value exists under `key` but is not decodable (truncated or garbled). Carries
 * the raw text so the caller can park it for recovery instead of discarding it.
 */
export class CorruptValueError extends Error {
  constructor(
    readonly key: string,
    readonly raw: string,
  ) {
    super(`Stored value for "${key}" is corrupt`);
    this.name = "CorruptValueError";
  }
}

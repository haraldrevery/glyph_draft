import { CorruptValueError, type StorageService } from "./StorageService";

/**
 * Desktop implementation: a key/value store implemented over the Tauri v2
 * filesystem plugin. Each key becomes one JSON file under
 * <AppData>/storage/<urlencoded-key>.json.
 *
 * The @tauri-apps/plugin-fs module is imported LAZILY (dynamic import) and only
 * ever from inside Tauri, because createStorage() instantiates this class
 * exclusively when isTauri() is true. As a result the plugin lands in its own
 * async chunk that the web build never requests.
 *
 * `FsModule` is a type-only reference, so type-checking needs the package
 * present (it is a devDependency) but the web runtime bundle stays clean.
 */
type FsModule = typeof import("@tauri-apps/plugin-fs");

const ROOT_DIR = "storage";
const EXT = ".json";
/** Suffix of the scratch file a write lands in before it is renamed over the target. */
const TMP = ".tmp";

export class TauriStorage implements StorageService {
  private fsPromise: Promise<FsModule> | null = null;
  private baseDir = 0;

  /** Resolve the fs module once, ensuring the root directory exists. */
  private async fs(): Promise<FsModule> {
    if (!this.fsPromise) {
      this.fsPromise = import("@tauri-apps/plugin-fs").then(async (mod) => {
        this.baseDir = mod.BaseDirectory.AppData;
        const exists = await mod.exists(ROOT_DIR, { baseDir: this.baseDir });
        if (!exists) {
          await mod.mkdir(ROOT_DIR, { baseDir: this.baseDir, recursive: true });
        }
        return mod;
      });
    }
    return this.fsPromise;
  }

  private pathFor(key: string): string {
    return `${ROOT_DIR}/${encodeURIComponent(key)}${EXT}`;
  }

  private keyFrom(fileName: string): string {
    return decodeURIComponent(fileName.slice(0, -EXT.length));
  }

  async getItem<T>(key: string): Promise<T | null> {
    const mod = await this.fs();
    const path = this.pathFor(key);
    if (!(await mod.exists(path, { baseDir: this.baseDir }))) return null;
    const text = await mod.readTextFile(path, { baseDir: this.baseDir });
    try {
      return JSON.parse(text) as T;
    } catch {
      // A value IS there but can't be decoded — typically a write cut short by a
      // crash. Distinct from an I/O error so the caller can fall back to the backup.
      throw new CorruptValueError(key, text);
    }
  }

  /**
   * Write-then-rename, so a crash mid-write can never leave a truncated file under
   * the real name: the old file stays intact until the complete new one replaces it
   * (rename() replaces an existing target). If the rename is refused — e.g. a build
   * whose capabilities predate `fs:allow-rename` — fall back to the direct write
   * rather than failing every save.
   */
  async setItem<T>(key: string, value: T): Promise<void> {
    const mod = await this.fs();
    const path = this.pathFor(key);
    const text = JSON.stringify(value);
    const opts = { baseDir: this.baseDir };
    await mod.writeTextFile(path + TMP, text, opts);
    try {
      await mod.rename(path + TMP, path, {
        oldPathBaseDir: this.baseDir,
        newPathBaseDir: this.baseDir,
      });
    } catch (err) {
      console.warn("Atomic save unavailable, writing in place:", err);
      await mod.writeTextFile(path, text, opts);
      await mod.remove(path + TMP, opts).catch(() => undefined);
    }
  }

  async removeItem(key: string): Promise<void> {
    const mod = await this.fs();
    const path = this.pathFor(key);
    if (await mod.exists(path, { baseDir: this.baseDir })) {
      await mod.remove(path, { baseDir: this.baseDir });
    }
  }

  async keys(): Promise<string[]> {
    const mod = await this.fs();
    const entries = await mod.readDir(ROOT_DIR, { baseDir: this.baseDir });
    return entries
      .filter((entry) => entry.isFile && entry.name.endsWith(EXT))
      .map((entry) => this.keyFrom(entry.name));
  }

  async clear(): Promise<void> {
    const keys = await this.keys();
    await Promise.all(keys.map((key) => this.removeItem(key)));
  }
}

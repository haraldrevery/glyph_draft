import { describe, it, expect, vi, beforeEach } from "vitest";
import { CorruptValueError } from "./StorageService";

/**
 * The desktop KV adapter over an in-memory stand-in for `@tauri-apps/plugin-fs`.
 * Guards the two corruption properties: a write must never leave a truncated file
 * under the real name, and an undecodable file must surface as CorruptValueError
 * (not a generic error) so the loader can fall back to the backup.
 */

const fsMock = vi.hoisted(() => {
  const files = new Map<string, string>();
  const state = { renameFails: false };
  return {
    files,
    state,
    module: {
      BaseDirectory: { AppData: 14 },
      exists: async (p: string) => files.has(p) || p === "storage",
      mkdir: async () => undefined,
      readTextFile: async (p: string) => {
        const t = files.get(p);
        if (t === undefined) throw new Error("ENOENT");
        return t;
      },
      writeTextFile: async (p: string, text: string) => {
        files.set(p, text);
      },
      rename: async (from: string, to: string) => {
        if (state.renameFails) throw new Error("fs.rename not allowed");
        const t = files.get(from);
        if (t === undefined) throw new Error("ENOENT");
        files.set(to, t);
        files.delete(from);
      },
      remove: async (p: string) => {
        files.delete(p);
      },
      readDir: async () =>
        [...files.keys()].map((k) => ({ name: k.replace(/^storage\//, ""), isFile: true })),
    },
  };
});

vi.mock("@tauri-apps/plugin-fs", () => fsMock.module);

const PATH = "storage/glyphdraft%3Aproject.json";

beforeEach(() => {
  fsMock.files.clear();
  fsMock.state.renameFails = false;
});

describe("TauriStorage", () => {
  it("writes via a temp file + rename, leaving no temp file behind", async () => {
    const { TauriStorage } = await import("./TauriStorage");
    const s = new TauriStorage();
    await s.setItem("glyphdraft:project", { a: 1 });
    expect(fsMock.files.get(PATH)).toBe('{"a":1}');
    expect(fsMock.files.has(`${PATH}.tmp`)).toBe(false);
    expect(await s.getItem("glyphdraft:project")).toEqual({ a: 1 });
  });

  it("falls back to a direct write when rename is refused (older capabilities)", async () => {
    const { TauriStorage } = await import("./TauriStorage");
    const s = new TauriStorage();
    fsMock.state.renameFails = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await s.setItem("glyphdraft:project", { a: 2 });
    expect(fsMock.files.get(PATH)).toBe('{"a":2}');
    expect(fsMock.files.has(`${PATH}.tmp`)).toBe(false);
  });

  it("an undecodable file throws CorruptValueError carrying the raw text", async () => {
    const { TauriStorage } = await import("./TauriStorage");
    const s = new TauriStorage();
    fsMock.files.set(PATH, '{"version":8,"gly');
    const err = await s.getItem("glyphdraft:project").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CorruptValueError);
    expect((err as CorruptValueError).raw).toBe('{"version":8,"gly');
  });

  it("a missing key reads as null, and temp files are not listed as keys", async () => {
    const { TauriStorage } = await import("./TauriStorage");
    const s = new TauriStorage();
    expect(await s.getItem("nope")).toBeNull();
    fsMock.files.set(`${PATH}.tmp`, "{}");
    fsMock.files.set(PATH, "{}");
    expect(await s.keys()).toEqual(["glyphdraft:project"]);
  });
});

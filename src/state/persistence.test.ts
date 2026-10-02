import { describe, it, expect, vi, beforeEach } from "vitest";
import { CorruptValueError } from "../storage/StorageService";
import type { Glyph } from "../types/document";

/**
 * Load/save lifecycle. The store modules are singletons, so each test re-imports
 * them fresh (`vi.resetModules`) against an in-memory KV whose failure modes can be
 * scripted: a stored value that can't be decoded (a half-written desktop file) and a
 * read that throws (an I/O hiccup) must be handled in OPPOSITE ways.
 */

const kv = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const corrupt = new Set<string>(); // keys whose stored text can't be decoded
  let readFailures = 0; // the next N reads throw an I/O error
  const log: string[] = [];
  return {
    data,
    corrupt,
    log,
    failReads(n: number) {
      readFailures = n;
    },
    storage: {
      async getItem(key: string) {
        log.push(`get ${key}`);
        if (readFailures > 0) {
          readFailures -= 1;
          throw new Error("transient I/O error");
        }
        if (corrupt.has(key)) {
          const { CorruptValueError } = await import("../storage/StorageService");
          throw new CorruptValueError(key, "{\"version\":8,\"gly");
        }
        return data.has(key) ? structuredClone(data.get(key)) : null;
      },
      async setItem(key: string, value: unknown) {
        log.push(`set:start ${key}`);
        await new Promise((r) => setTimeout(r, 5)); // a slow write, to expose overlap
        corrupt.delete(key);
        data.set(key, structuredClone(value));
        log.push(`set:end ${key}`);
      },
      async removeItem(key: string) {
        data.delete(key);
      },
      async keys() {
        return [...data.keys()];
      },
      async clear() {
        data.clear();
      },
    },
  };
});

const lock = vi.hoisted(() => ({ owner: true }));
vi.mock("./tabLock", () => ({ claimWorkspace: async () => lock.owner }));

vi.mock("../storage/createStorage", () => ({
  createStorage: async () => kv.storage,
  getStorage: () => kv.storage,
}));

const MAIN = "glyphdraft:project";
const BACKUP = "glyphdraft:project.bak";
const CORRUPT = "glyphdraft:project.corrupt";

function glyph(id: string): Glyph {
  return {
    id,
    codepoint: 0x41,
    name: "A",
    advanceWidth: 600,
    layers: [{ id: `${id}_l`, name: "Layer 1", visible: true, locked: false, contours: [] }],
  };
}
const file = (id: string) => ({ version: 8, savedAt: 1, glyphs: { [id]: glyph(id) } });
const idsIn = (key: string) => Object.keys((kv.data.get(key) as { glyphs: object }).glyphs);

async function boot() {
  const persistence = await import("./persistence");
  const { useDocumentStore } = await import("./documentStore");
  await persistence.initPersistence();
  return { ...persistence, doc: useDocumentStore };
}

beforeEach(() => {
  vi.resetModules();
  kv.data.clear();
  kv.corrupt.clear();
  kv.log.length = 0;
  kv.failReads(0);
  lock.owner = true;
});

describe("persistence — load", () => {
  it("a truncated main falls back to the backup and parks the corrupt text", async () => {
    kv.data.set(BACKUP, file("gBAK"));
    kv.data.set(MAIN, "placeholder");
    kv.corrupt.add(MAIN);
    const { doc, useSaveStatus } = await boot();

    expect(Object.keys(doc.getState().glyphs)).toEqual(["gBAK"]);
    expect(kv.data.get(CORRUPT)).toBe("{\"version\":8,\"gly"); // parked, not discarded
    expect(useSaveStatus.getState().state).not.toBe("paused");
  });

  it("after recovering from a truncated main, saving works and never overwrites the good backup with garbage", async () => {
    kv.data.set(BACKUP, file("gBAK"));
    kv.data.set(MAIN, "placeholder");
    kv.corrupt.add(MAIN);
    const { doc, saveNow, useSaveStatus } = await boot();

    doc.getState().setAdvanceWidth(500);
    await saveNow();
    expect(useSaveStatus.getState().state).toBe("saved");
    expect(idsIn(MAIN)).toEqual(["gBAK"]);
    expect(idsIn(BACKUP)).toEqual(["gBAK"]); // still the intact copy
  });

  it("a parseable-but-invalid main never displaces a valid backup on the next save", async () => {
    kv.data.set(BACKUP, file("gBAK"));
    kv.data.set(MAIN, { version: 8, glyphs: { bad: { nope: true } } });
    const { doc, saveNow } = await boot();
    expect(Object.keys(doc.getState().glyphs)).toEqual(["gBAK"]);

    await saveNow();
    expect(idsIn(BACKUP)).toEqual(["gBAK"]);
    expect(kv.data.get(CORRUPT)).toEqual({ version: 8, glyphs: { bad: { nope: true } } });
  });

  it("a read that keeps failing pauses autosave instead of overwriting the real document", async () => {
    kv.data.set(MAIN, file("gREAL"));
    kv.data.set(BACKUP, file("gREAL"));
    kv.failReads(3); // every retry of the main read fails
    const { doc, saveNow, useSaveStatus } = await boot();

    expect(useSaveStatus.getState().state).toBe("paused");
    doc.getState().setAdvanceWidth(500);
    await saveNow();
    doc.getState().setAdvanceWidth(400);
    await saveNow();
    expect(idsIn(MAIN)).toEqual(["gREAL"]);
    expect(idsIn(BACKUP)).toEqual(["gREAL"]);
  });

  it("a read that fails once is retried and loads normally", async () => {
    kv.data.set(MAIN, file("gREAL"));
    kv.failReads(1);
    const { doc, useSaveStatus } = await boot();
    expect(Object.keys(doc.getState().glyphs)).toEqual(["gREAL"]);
    expect(useSaveStatus.getState().state).toBe("saved");
  });

  it("a fresh install (nothing stored) starts from the seed with autosave on", async () => {
    const { doc, saveNow, useSaveStatus } = await boot();
    const [seedId] = Object.keys(doc.getState().glyphs);
    await saveNow();
    expect(useSaveStatus.getState().state).toBe("saved");
    expect(idsIn(MAIN)).toEqual([seedId]);
  });

  it("a second corrupt blob is parked beside the first rather than over it", async () => {
    kv.data.set(CORRUPT, "older parked blob");
    kv.data.set(MAIN, "placeholder");
    kv.corrupt.add(MAIN);
    await boot();
    expect(kv.data.get(CORRUPT)).toBe("older parked blob");
    expect([...kv.data.keys()].some((k) => k.startsWith(`${CORRUPT}.`))).toBe(true);
  });
});

describe("persistence — second tab", () => {
  it("a tab that doesn't own the workspace loads it but never writes", async () => {
    kv.data.set(MAIN, file("gNEW"));
    lock.owner = false;
    const { doc, saveNow, useSaveStatus } = await boot();
    expect(Object.keys(doc.getState().glyphs)).toEqual(["gNEW"]);
    expect(useSaveStatus.getState().state).toBe("paused");
    doc.getState().setAdvanceWidth(1);
    await saveNow();
    expect((kv.data.get(MAIN) as { glyphs: Record<string, Glyph> }).glyphs.gNEW!.advanceWidth).toBe(600);
  });
});

describe("persistence — save", () => {
  it("serializes writes: an explicit save never interleaves with an in-flight one", async () => {
    kv.data.set(MAIN, file("g1"));
    const { doc, saveNow } = await boot();
    doc.getState().setAdvanceWidth(500);
    kv.log.length = 0;
    await Promise.all([saveNow(), saveNow()]);

    // Every set:start must be followed by its own set:end before the next begins.
    const sets = kv.log.filter((l) => l.startsWith("set:"));
    for (let i = 0; i < sets.length; i += 2) {
      expect(sets[i]!.replace("start", "end")).toBe(sets[i + 1]);
    }
  });

  it("initPersistence is idempotent (StrictMode double effects share one run)", async () => {
    kv.data.set(MAIN, file("g1"));
    const persistence = await import("./persistence");
    const { useDocumentStore } = await import("./documentStore");
    await Promise.all([persistence.initPersistence(), persistence.initPersistence()]);
    // One load: a second run would re-read main and re-apply loadGlyphs, which can
    // clobber edits made in between.
    expect(kv.log.filter((l) => l === `get ${MAIN}`)).toHaveLength(1);
    expect(Object.keys(useDocumentStore.getState().glyphs)).toEqual(["g1"]);
  });

  it("blockSaving refuses every later save and drops a pending autosave", async () => {
    kv.data.set(MAIN, file("g1"));
    const { doc, saveNow, blockSaving, useSaveStatus } = await boot();
    doc.getState().setAdvanceWidth(500); // schedules an autosave
    blockSaving("open in another tab");
    await saveNow();
    expect(useSaveStatus.getState()).toMatchObject({ state: "paused", error: "open in another tab" });
    expect((kv.data.get(MAIN) as { glyphs: Record<string, Glyph> }).glyphs.g1!.advanceWidth).toBe(600);
  });
});

describe("persistence — recovery points", () => {
  const SESSION = "glyphdraft:project.session";
  const SESSION_PREV = "glyphdraft:project.session.prev";

  it("keeps the loaded workspace as this session's snapshot, rotating the last one", async () => {
    kv.data.set(MAIN, file("gNOW"));
    kv.data.set(SESSION, file("gLAST"));
    const { saveNow } = await boot();
    await saveNow(); // queued behind the snapshot, so it has landed
    expect(idsIn(SESSION)).toEqual(["gNOW"]);
    expect(idsIn(SESSION_PREV)).toEqual(["gLAST"]);
  });

  it("the snapshot survives later edits (it is outside the autosave rotation)", async () => {
    kv.data.set(MAIN, file("gNOW"));
    const { doc, saveNow } = await boot();
    doc.getState().setAdvanceWidth(321);
    await saveNow();
    const session = kv.data.get(SESSION) as { glyphs: Record<string, Glyph> };
    expect(session.glyphs.gNOW!.advanceWidth).toBe(600); // as loaded, not as edited
  });

  it("a tab that doesn't own the workspace writes no snapshot", async () => {
    kv.data.set(MAIN, file("gNOW"));
    lock.owner = false;
    const { saveNow } = await boot();
    await saveNow();
    expect(kv.data.has(SESSION)).toBe(false);
  });

  it("an unreadable save (autosave paused) writes no snapshot", async () => {
    kv.data.set(MAIN, file("gREAL"));
    kv.failReads(100);
    const { saveNow } = await boot();
    kv.failReads(0);
    await saveNow();
    expect(kv.data.has(SESSION)).toBe(false);
  });
});

it("CorruptValueError carries the raw text", () => {
  const e = new CorruptValueError("k", "{trunc");
  expect(e).toBeInstanceOf(Error);
  expect(e.raw).toBe("{trunc");
});

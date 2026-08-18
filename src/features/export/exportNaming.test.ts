import { describe, it, expect } from "vitest";
import { defaultArchiveName, resolveArchiveName } from "./exportNaming";

describe("defaultArchiveName", () => {
  it("is the untagged name with no tag", () => {
    expect(defaultArchiveName()).toBe("glyphs.svg.zip");
  });

  it("folds a style/silhouette tag in", () => {
    expect(defaultArchiveName("bold")).toBe("glyphs-bold.svg.zip");
    expect(defaultArchiveName("italic-silhouette")).toBe("glyphs-italic-silhouette.svg.zip");
  });
});

describe("resolveArchiveName", () => {
  it("falls back to the auto name when the field is blank", () => {
    // The no-change guarantee for users who ignore the new field.
    expect(resolveArchiveName("", "bold")).toBe("glyphs-bold.svg.zip");
    expect(resolveArchiveName("   ", "")).toBe("glyphs.svg.zip");
  });

  it("keeps a typed name and adds .zip", () => {
    expect(resolveArchiveName("My Font", "")).toBe("My Font.zip");
  });

  it("does not double up an existing .zip, case-insensitively", () => {
    expect(resolveArchiveName("myfont.zip", "")).toBe("myfont.zip");
    expect(resolveArchiveName("myfont.ZIP", "")).toBe("myfont.ZIP");
  });

  it("a typed name overrides the auto tag", () => {
    expect(resolveArchiveName("custom", "bold")).toBe("custom.zip");
  });

  it("uses the last path segment, so a pasted path reads sensibly", () => {
    expect(resolveArchiveName("~/fonts/myfont.zip", "")).toBe("myfont.zip");
    expect(resolveArchiveName("C:\\Users\\me\\myfont", "")).toBe("myfont.zip");
  });

  it("cannot escape the download folder", () => {
    const out = resolveArchiveName("../../etc/passwd", "");
    expect(out).toBe("passwd.zip");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
    expect(out).not.toContain("..");
  });

  it("strips leading dots and characters illegal in a filename", () => {
    expect(resolveArchiveName(".hidden", "")).toBe("hidden.zip");
    expect(resolveArchiveName("a<b>c:\"d|e?f*g", "")).toBe("abcdefg.zip");
  });

  it("keeps digits and ordinary punctuation intact", () => {
    // Guards the character class: an over-broad range would eat these.
    expect(resolveArchiveName("Font-v2.1_final (rev3)", "")).toBe("Font-v2.1_final (rev3).zip");
  });

  it("falls back when sanitising leaves nothing", () => {
    expect(resolveArchiveName("///", "bold")).toBe("glyphs-bold.svg.zip");
    expect(resolveArchiveName("...", "")).toBe("glyphs.svg.zip");
  });
});

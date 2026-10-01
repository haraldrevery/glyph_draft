import { describe, it, expect } from "vitest";
import { parseNumberDraft } from "./NumberInput";

describe("parseNumberDraft", () => {
  it("a cleared field commits nothing (it used to snap to min — Number('') is 0)", () => {
    expect(parseNumberDraft("", 10, 100)).toBeNull();
    expect(parseNumberDraft("   ", 10, 100)).toBeNull();
  });

  it("unparseable text commits nothing", () => {
    expect(parseNumberDraft("abc", 0, 10)).toBeNull();
    expect(parseNumberDraft("-", 0, 10)).toBeNull();
  });

  it("clamps typed values to [min, max]", () => {
    expect(parseNumberDraft("0", 1, 100)).toBe(1);
    expect(parseNumberDraft("500", 1, 100)).toBe(100);
    expect(parseNumberDraft("42", 1, 100)).toBe(42);
  });
});

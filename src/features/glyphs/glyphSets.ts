/**
 * Predefined glyph-set templates — one-click ways to populate a project with a
 * common run of code points (the top-bar "Glyphs" menu). Pure data: each set is a
 * list of Unicode code points; the store's `addGlyphs` adds the missing ones (a font
 * is one-glyph-per-code-point, so re-running a set is idempotent and overlaps between
 * sets are harmless).
 */

export interface GlyphSet {
  id: string;
  label: string;
  codepoints: number[];
}

/** Inclusive code-point range [from, to]. */
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let c = from; c <= to; c += 1) out.push(c);
  return out;
}

const ENGLISH = [...range(0x41, 0x5a), ...range(0x61, 0x7a)]; // A–Z, a–z

// Letters BEYOND English used in Scandinavian languages (Swedish Å Ä Ö; Danish/
// Norwegian Æ Ø), upper + lower.
const SCANDINAVIAN = [
  0x00c5, 0x00e5, // Å å
  0x00c4, 0x00e4, // Ä ä
  0x00d6, 0x00f6, // Ö ö
  0x00c6, 0x00e6, // Æ æ
  0x00d8, 0x00f8, // Ø ø
];

const DIGITS_MATH = [
  ...range(0x30, 0x39), // 0–9
  0x002b, // +
  0x2212, // − (minus sign)
  0x00d7, // ×
  0x00f7, // ÷
  0x003d, // =
  0x00b1, // ±
  0x003c, // <
  0x003e, // >
  0x2264, // ≤
  0x2265, // ≥
  0x2260, // ≠
  0x0025, // %
];

// ASCII punctuation (US/EN QWERTY) + the Swedish-keyboard extras.
const KEYBOARD = [
  ...range(0x21, 0x2f), // ! " # $ % & ' ( ) * + , - . /
  ...range(0x3a, 0x40), // : ; < = > ? @
  ...range(0x5b, 0x60), // [ \ ] ^ _ `
  ...range(0x7b, 0x7e), // { | } ~
  0x00a7, // §
  0x00bd, // ½
  0x00a4, // ¤
  0x00a3, // £
  0x20ac, // €
  0x00b5, // µ
  0x00b4, // ´ (acute accent)
  0x00a8, // ¨ (diaeresis)
];

export const GLYPH_SETS: GlyphSet[] = [
  { id: "english", label: "Add English (A–Z, a–z)", codepoints: ENGLISH },
  { id: "scandinavian", label: "Add Scandinavian (Å Ä Ö Æ Ø)", codepoints: SCANDINAVIAN },
  { id: "digits-math", label: "Add digits & math", codepoints: DIGITS_MATH },
  { id: "keyboard", label: "Add keyboard symbols", codepoints: KEYBOARD },
];

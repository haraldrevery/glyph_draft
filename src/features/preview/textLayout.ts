import type { Glyph } from "../../types/document";

/**
 * Pure text layout for the preview window — no DOM. Lays a string out left-to-right in
 * the project's glyphs with simple **mono** spacing: each glyph advances by its own
 * advance width plus ~`spacing` (≈10%). A code point with no glyph (or a space) leaves a
 * blank gap of `spaceWidth` (also + spacing). `\n` starts a new line, stepping the
 * baseline down by `lineHeight`. World units, Y-up (lower lines have more-negative y).
 */

export interface LayoutOptions {
  /** Extra advance as a fraction of each glyph's width (0.1 = 10%). */
  spacing?: number;
  /** Advance for a space / missing glyph, before spacing. */
  spaceWidth?: number;
  /** Baseline-to-baseline distance for line breaks (font units). */
  lineHeight?: number;
  /** Word-wrap width in font units. When set (> 0), a line that would exceed it
   *  breaks at the last space; a single word wider than `maxWidth` still gets its
   *  own line (and may overflow). 0/undefined = no wrapping (only `\n` breaks). */
  maxWidth?: number;
}

export interface LayoutItem {
  glyph: Glyph;
  /** Left edge (x) and baseline (y) of the glyph, in world units. */
  x: number;
  y: number;
}

export interface TextLayout {
  items: LayoutItem[];
  /** Bounding size of the laid-out advances (not the glyph artwork). */
  width: number;
  height: number;
  lineHeight: number;
}

const isSpace = (cp: number): boolean => cp === 0x20 || cp === 0x09;

export function layoutText(
  text: string,
  glyphByCodepoint: Map<number, Glyph>,
  opts: LayoutOptions = {},
): TextLayout {
  const spacing = opts.spacing ?? 0.1;
  const spaceWidth = opts.spaceWidth ?? 500;
  const lineHeight = opts.lineHeight ?? 1000;
  const wrapWidth = opts.maxWidth ?? 0;
  const mul = 1 + spacing;

  const items: LayoutItem[] = [];
  let maxWidth = 0;
  let visualLine = 0; // counts hard (\n) AND soft (wrap) line breaks

  for (const line of text.split("\n")) {
    let x = 0;
    if (wrapWidth > 0) {
      // Greedy word-wrap: break before a word that would overflow `wrapWidth` (a single
      // word wider than the limit still gets its own line and may overflow). Whitespace
      // tokens are gaps between words (collapsed at the start of a wrapped line).
      for (const tok of line.split(/(\s+)/)) {
        if (tok === "") continue;
        if (/^\s+$/.test(tok)) {
          if (x > 0) x += spaceWidth * mul * tok.length;
          continue;
        }
        // Measure the word's glyphs and their offsets within it.
        const word: { glyph: Glyph; dx: number }[] = [];
        let w = 0;
        for (const ch of tok) {
          const glyph = glyphByCodepoint.get(ch.codePointAt(0)!);
          if (!glyph) {
            w += spaceWidth * mul; // missing glyph → blank gap
            continue;
          }
          word.push({ glyph, dx: w });
          w += Math.max(glyph.advanceWidth, 0) * mul;
        }
        if (x > 0 && x + w > wrapWidth) {
          if (x > maxWidth) maxWidth = x;
          visualLine += 1;
          x = 0;
        }
        const y = visualLine ? -visualLine * lineHeight : 0; // avoid -0 on line 0
        for (const it of word) items.push({ glyph: it.glyph, x: x + it.dx, y });
        x += w;
      }
    } else {
      // No wrapping: the original per-char advance (byte-identical).
      const y = visualLine ? -visualLine * lineHeight : 0; // avoid -0 on line 0
      for (const ch of line) {
        const cp = ch.codePointAt(0)!;
        const glyph = isSpace(cp) ? undefined : glyphByCodepoint.get(cp);
        if (!glyph) {
          x += spaceWidth * mul; // blank gap for space / missing glyph
          continue;
        }
        items.push({ glyph, x, y });
        x += Math.max(glyph.advanceWidth, 0) * mul;
      }
    }
    if (x > maxWidth) maxWidth = x;
    visualLine += 1;
  }

  return { items, width: maxWidth, height: visualLine * lineHeight, lineHeight };
}

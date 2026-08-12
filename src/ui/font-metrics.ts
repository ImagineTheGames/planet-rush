/**
 * src/ui/font-metrics.ts — how wide a label actually is. OWNER: UI Engineer.
 *
 * A label overflows its chrome when the words are wider than the box, and until
 * a0-32 nothing in this repo could answer *"how wide are the words"* without a
 * browser. The two headless models it had were both guesses:
 *
 *   - `hud-geometry.test.ts` assumed a glyph is at most `.82em` of Audiowide and
 *     `.60em` of Oxanium — "measured generously", and generous for the *average*
 *     string, but `W` is a full `1.002em` of Audiowide and `M` is `.962em`, so
 *     the budget was optimistic exactly where a display face is widest;
 *   - `voice-copy-fit.spec.ts` measured for real, but only in a booted page, so
 *     the check it does could never be a unit test and only ever covered the
 *     eighteen strings somebody listed in it.
 *
 * Both were written before u14-01 self-hosted the ratified faces. Once it did,
 * every advance in the game moved at once, and two labels stopped fitting the
 * shapes that hold them (a0-32: `& UPGRADE` past the BUILD circle, `UPGRADE` past
 * its wedge). A guess is what let that through, so this module replaces the guess
 * with the measurement:
 *
 *   - `./font-metrics.data.ts` — GENERATED, the real per-glyph advance of every
 *     codepoint the UI draws, taken from the repo's own `public/fonts/*.woff2`
 *     (`tools/font-metrics-scan.mjs`);
 *   - this file — Pixi's own width and height arithmetic on top of them, so a
 *     headless test computes what `CanvasTextMetrics` will compute in the page.
 *
 * Pure data and arithmetic: no Pixi, no DOM, so the whole of the UI's fit budget
 * unit-tests. `tests/mobile/voice-copy-fit.spec.ts` re-measures the table against
 * the real booted client, which is what stops it drifting back into a note.
 *
 * ── HOW PIXI MEASURES, AND WHY IT IS SPELLED OUT HERE ──────────────────────
 * `CanvasTextMetrics.measureText` (pixi.js v8):
 *
 *   width  = max over lines of ( measureText(line).width + (glyphs − 1) × spacing )
 *   height = lineHeight × lines,  lineHeight = ascent + descent of `|ÉqM`
 *
 * Two details in there are easy to get wrong and both change an answer by whole
 * pixels. **The letter spacing lands between glyphs, not after each one** —
 * `n − 1` gaps, because Pixi's `experimentalLetterSpacing` is `false` by default
 * (it measures unspaced and adds the gaps itself) and this project never sets it.
 * And **the line height is the FACE's ink box, not the font size** — 1.157em for
 * Audiowide, 1.204em for its synthesised bold, 1.126–1.173em across Oxanium's
 * weights — which is why a stack of four lines is a fifth taller than four times
 * its type size.
 *
 * ── QUANTISATION, WHICH IS WHY THE ROUNDING IS WHERE IT IS ─────────────────
 * The engine does not lay glyphs out on fractional pixels. Every advance comes
 * back as a whole number — `measureText` of a 28-glyph line at 11px returns
 * exactly `174`, and it returns it because each glyph in it was rounded first and
 * then added, not the other way round. Sum the `em` values and round once at the
 * end and you get 171: three pixels light, in the optimistic direction, on
 * exactly the kind of line that is drawn into a fixed box.
 *
 * So {@link textWidth} rounds per glyph. What it does NOT reproduce is the second
 * quantisation, of the type SIZE: asked for 13.435px the engine measures the 13px
 * metrics, so at the fractional sizes the wheel's profile ramp produces this model
 * reads a little WIDE. That is the direction a budget wants to be wrong in, and
 * it is why the wheel's own margin is 4px rather than a hairline.
 *
 * There is no kerning term because there is no kerning: measured against the real
 * page, `measureText(whole)` equals the sum of its glyphs' advances exactly, in
 * every string this UI draws. `tests/mobile/voice-copy-fit.spec.ts` re-measures
 * both claims — the table, glyph by glyph, and this arithmetic, string by string —
 * so neither is believed on the strength of this paragraph.
 */

import { ADVANCE_EM, LINE_HEIGHT_EM, type MetricFace } from './font-metrics.data';

export type { MetricFace };

/**
 * What a glyph outside the tabled set is charged.
 *
 * The two faces are declared with a `unicode-range` (`./typography.ts`), so a
 * codepoint outside it is drawn by whatever face the *machine* has, and the
 * studio container and the CI runner do not have to agree about that — `●` is
 * .6001em through one stack and .604em through the other on this box alone. That
 * is the a1-01 trap, and the fix is not to pick one of the numbers: it is to
 * refuse to promise one. So an untabled glyph is charged a full `em`, which is
 * wider than any glyph in either ratified face (Audiowide's `W`, the widest thing
 * in the game, is 1.002em and is the only one that reaches it).
 *
 * A measurement that spends this is conservative and says so —
 * {@link untabledGlyphs} names them — so a caller can tell "this label fits" from
 * "this label fits even at the worst thing the glyph could be".
 */
export const UNTABLED_ADVANCE_EM = 1;

/** A run of text as the UI actually styles it: a face, a size, and tracking. */
export interface TypeSpec {
  readonly face: MetricFace;
  /** Type size in CSS px — `TextStyle.fontSize`. */
  readonly size: number;
  /** Tracking in `em` — the ratified scale (`../art/materials` TRACKING). */
  readonly tracking: number;
}

/** The glyphs of `text` the table does not carry — see {@link UNTABLED_ADVANCE_EM}. */
export function untabledGlyphs(text: string, face: MetricFace): readonly string[] {
  const table = ADVANCE_EM[face];
  const missing: string[] = [];
  for (const ch of text) {
    if (ch === '\n') continue;
    if (table[ch] === undefined && !missing.includes(ch)) missing.push(ch);
  }
  return missing;
}

/** One line's width in px — no `\n` handling, so {@link textWidth} can fold. */
function lineWidth(line: string, spec: TypeSpec): number {
  const table = ADVANCE_EM[spec.face];
  let px = 0;
  let glyphs = 0;
  for (const ch of line) {
    // Rounded per glyph, because that is what the engine does — see the note on
    // quantisation in the header. Summing the un-rounded advances and rounding
    // once at the end is a different number, and on a 28-glyph line it is a
    // different number by three pixels.
    px += Math.round((table[ch] ?? UNTABLED_ADVANCE_EM) * spec.size);
    glyphs++;
  }
  // The spacing lands BETWEEN glyphs — `n − 1` gaps, exactly as Pixi adds them.
  const spacing = glyphs > 1 ? (glyphs - 1) * spec.tracking * spec.size : 0;
  return px + spacing;
}

/**
 * The width PixiJS will measure for `text`, in px — the widest LINE of a wrapped
 * string, which is what has to fit, not the whole string laid end to end.
 */
export function textWidth(text: string, spec: TypeSpec): number {
  let widest = 0;
  for (const line of text.split('\n')) widest = Math.max(widest, lineWidth(line, spec));
  return widest;
}

/**
 * The height PixiJS will measure for `text`, in px.
 *
 * The face's own ink box per line ({@link LINE_HEIGHT_EM}), NOT the type size and
 * not a leading multiple — `wheel-stack.ts` used to model a wedge line as
 * `size × 1.25` and the view then stacked the real thing, so the model and the
 * screen disagreed about where every line after the first one landed.
 */
export function textHeight(text: string, spec: TypeSpec): number {
  let lines = 1;
  for (const ch of text) if (ch === '\n') lines++;
  return LINE_HEIGHT_EM[spec.face] * spec.size * lines;
}

/** An axis-aligned box, the shape every fit assertion in this UI is written in. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The box a `Text` node occupies, given where its anchor sits.
 *
 * `anchorX`/`anchorY` are Pixi's own `anchor`, so a centred label passes `0.5`
 * and a top-centred one — every line of a wheel wedge — passes `0.5, 0`.
 */
export function textBox(
  text: string,
  spec: TypeSpec,
  x: number,
  y: number,
  anchorX = 0.5,
  anchorY = 0.5,
): Box {
  const width = textWidth(text, spec);
  const height = textHeight(text, spec);
  return { x: x - width * anchorX, y: y - height * anchorY, width, height };
}

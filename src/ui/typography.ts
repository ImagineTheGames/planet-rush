/**
 * src/ui/typography.ts — the two faces, in one place. OWNER: UI Engineer.
 *
 * The style guide (§7) ratifies exactly two type families and a rule for which
 * goes where:
 *
 *   **Audiowide** — the wordmark, headings and menu confirmations. Rounded
 *   retro-techno; playful without being a toy. Never the HUD numerals.
 *
 *   **Oxanium** — HUD numerals and body text. Designed for game interfaces,
 *   legible at 12px, squared geometry that sits beside Audiowide without
 *   competing. Never the wordmark.
 *
 * Both are OFL-licensed and **self-hosted** (`assets/`, no CDN, no Google Fonts
 * call — offline-first, GDD §4.3/§4.8). This module names the two *stacks* so
 * every menu screen in this directory spells them identically and a face swap is
 * a one-line change rather than a grep. The fallback in each stack is the
 * nearest system face, so the menus stay legible for the frame or two before the
 * self-hosted files finish decoding — a menu that flashed invisible would be a
 * worse first impression than one that flashed a fallback.
 *
 * Pure data. No Pixi, no DOM: the `@font-face` declarations that actually load
 * the files, and the `<link>` that pulls them in, are the page's job (index.html
 * / `assets/`), not a model's. This file only says *which family a given piece
 * of text belongs to*, which is the one part of typography that is UI's to own.
 */

/** Wordmark, headings, menu confirmations (style-guide §7). Never HUD numerals. */
export const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';

/** Body text and numerals (style-guide §7). Never the wordmark. Legible at 12px. */
export const FONT_BODY = 'Oxanium, "DejaVu Sans Mono", monospace';

// ---------------------------------------------------------------------------
// Neutrals — the two greys every menu text lands in (style-guide §2)
// ---------------------------------------------------------------------------
//
// Colour on the menus is spent sparingly: plasma for the one affirmative action
// on a screen, threat red only for a genuine failure, player colours only for a
// player. Everything else — labels, hints, inert chrome — is one of these two
// neutrals, so the eye is drawn to the coloured thing precisely because it is
// the only coloured thing.

/** Primary readable text. The chalk of the player roster's P7, reused as ink. */
export const TEXT_PRIMARY = 0xdce3ec;

/** Dimmed text — hints, disabled labels, the line under a title. Hull steel. */
export const TEXT_DIM = 0x7e8894;

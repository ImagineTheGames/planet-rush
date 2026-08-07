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
 * Both are OFL-licensed and were to be **self-hosted** (`assets/`, no CDN, no
 * Google Fonts call — offline-first, GDD §4.3/§4.8). This module names the two
 * *stacks* so every menu screen in this directory spells them identically and a
 * face swap is a one-line change rather than a grep. The fallback in each stack
 * is the nearest system face, so the menus stay legible for the frame or two
 * before the self-hosted files finish decoding — a menu that flashed invisible
 * would be a worse first impression than one that flashed a fallback.
 *
 * **The self-hosting never happened** *(found by a1-01, 2026-08-07)*: there is no
 * `@font-face` in `index.html` and no font file under `assets/`, so neither
 * ratified face has ever loaded and every screen in this game draws in its
 * fallback. That is why the fallbacks below are chosen for what the two gating
 * machines actually have rather than for what is nearest — see {@link FONT_BODY}.
 * Shipping the two files is the real fix and wants its own brief: it is the
 * page's job (`index.html` / `assets/`, below), it changes how every screen
 * looks, and it re-baselines every golden in `tests/mobile/goldens.spec.ts`.
 *
 * Pure data. No Pixi, no DOM: the `@font-face` declarations that actually load
 * the files, and the `<link>` that pulls them in, are the page's job (index.html
 * / `assets/`), not a model's. This file only says *which family a given piece
 * of text belongs to*, which is the one part of typography that is UI's to own.
 */

/** Wordmark, headings, menu confirmations (style-guide §7). Never HUD numerals. */
export const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';

/**
 * Body text and numerals (style-guide §7). Never the wordmark. Legible at 12px.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FALLBACK IS LIBERATION MONO AND NOT DEJAVU SANS MONO (a1-01)
 * ---------------------------------------------------------------------------
 * It said `"DejaVu Sans Mono"`, and naming a face that only ONE of the two
 * machines that gate this repo actually has is what made four goldens
 * un-reproducible:
 *
 *   - the GitHub runner HAS DejaVu Sans Mono, so it matched the named face;
 *   - the studio container does NOT, so it fell through to generic `monospace`
 *     and got WenQuanYi Zen Hei Mono — a different face, ~20% narrower per
 *     glyph at the same size.
 *
 * So every baseline shot in the container encoded one font and CI compared it
 * against another. Screens with a few words of body text stayed inside the 1%
 * `maxDiffPixelRatio` and nobody noticed for months; u7-04's two TEXT-DENSE
 * screens did not, and `desktop-codex` failed by 3% — 23,766 pixels, entirely in
 * the article prose. It was never caught because #297's checks were cancelled.
 *
 * **Liberation Mono is on both.** Playwright installs `fonts-liberation` as a
 * hard dependency of its chromium install on every Linux variant it supports
 * (`playwright-core/.../nativeDeps.js`), so the runner has it by construction,
 * and the container ships it too. Naming it makes a golden shot in the container
 * mean what it says on CI — which is the whole premise of `goldens.spec.ts`.
 *
 * This is a FALLBACK, not the ratified face. Style-guide §7 ratifies **Oxanium**,
 * and this stack still asks for it first. The header above says both faces are
 * self-hosted in `assets/` — they are NOT, and never have been: there is no
 * `@font-face` in `index.html` and no font file in `assets/`, so every screen in
 * this game has always drawn in a fallback. Shipping the two OFL files is the
 * real fix and it is worth its own brief — it touches `index.html` and `assets/`
 * (the page's job, not a model's) and it re-baselines every golden in the suite.
 * Until then, this line is what keeps the two machines agreeing.
 */
export const FONT_BODY = 'Oxanium, "Liberation Mono", monospace';

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

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
 * Both are OFL-licensed and **self-hosted** (`public/fonts/`, no CDN, no Google
 * Fonts call — offline-first, GDD §4.3/§4.8). This module names the two *stacks*
 * so every menu screen in this directory spells them identically and a face swap
 * is a one-line change rather than a grep. The fallback in each stack is the
 * nearest face both gating machines actually have, for the glyphs the ratified
 * faces do not carry ({@link RATIFIED_FACES}) and for the case where the woff2
 * genuinely fails to arrive.
 *
 * **The self-hosting has actually happened, as of u14-01 (2026-08-11.)** From
 * a1-01's discovery on 2026-08-07 until then this comment recorded a gap instead
 * of a wiring: there was no `@font-face` anywhere and no font file in the repo,
 * so neither ratified face had ever loaded and **every frame this project ever
 * drew — every golden, every screenshot in `evidence/`, every live round — was
 * in a fallback.** What closed it:
 *
 *   - `public/fonts/*.woff2` — the two files, latin subset, 27.5 KB the pair,
 *     with their OFL licences and full provenance in `public/fonts/README.md`;
 *   - `index.html` — the `@font-face` blocks, the `<link rel="preload">` pair,
 *     and the boot gate that awaits both faces *before* `src/main.ts` is
 *     evaluated. That gate is not belt-and-braces: this game draws its text into
 *     a canvas, where `font-display` does nothing, so a frame composited early
 *     bakes the fallback into a texture that is never redrawn;
 *   - `./typography.test.ts` — asserts the page and this file still agree, so
 *     the wiring cannot rot back into a note.
 *
 * Pure data still. No Pixi, no DOM: the `@font-face` rules and the `<link>`s are
 * the page's job (`index.html`), not a model's. This file says *which family a
 * given piece of text belongs to* and *what the page is contracted to load*,
 * which is the part of typography that is UI's to own.
 */

/** Wordmark, headings, menu confirmations (style-guide §7). Never HUD numerals. */
export const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';

// ---------------------------------------------------------------------------
// The self-hosted files — one source of truth for what the page must load
// ---------------------------------------------------------------------------

/**
 * The `unicode-range` both faces are subsetted to: Google's `latin` block.
 *
 * It covers every character the game's copy actually renders, including the ones
 * that are easy to miss — `·` `×` `°` `§` `—` `’` `…` `−` and the `á`/`ã` in the
 * region names. What it CUTS is `latin-ext` (Latin Extended-A/B and friends):
 * 15,000 bytes across the two files, **+53% payload for glyphs no string in this
 * repo uses**, on a page that ships to a phone browser on every load. Because the
 * cut is expressed as a range rather than baked in, localising later is additive:
 * drop the two `latin-ext` woff2 files in and add a second `@font-face` each.
 */
export const LATIN_SUBSET_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
  'U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, ' +
  'U+2212, U+2215, U+FEFF, U+FFFD';

/** One self-hosted face: what `index.html` declares and the boot gate awaits. */
export interface RatifiedFace {
  /** CSS `font-family`, and the first name in the stack that uses it. */
  readonly family: string;
  /** Path under `public/`, spelled exactly as `index.html` spells it. */
  readonly href: string;
  /**
   * The `font-weight` descriptor. Audiowide is `'400'` — upstream ships one
   * weight, so a bold heading is synthesised, as it always was. Oxanium is
   * `'200 800'`, the variable file's real `wght` axis; the range is **not
   * optional**, because the font's own default instance is 200 (ExtraLight) and
   * a face declared without it renders the whole HUD hairline-thin.
   */
  readonly weight: string;
  /** The `font: ` shorthands the boot gate passes to `document.fonts.load()`. */
  readonly load: readonly string[];
}

/**
 * The two files `index.html` is contracted to self-host, and the only place that
 * contract is written down in TypeScript. `./typography.test.ts` reads it and the
 * page together, so a renamed file, a dropped `unicode-range`, a lost preload or
 * a boot gate that stops waiting fails a unit test rather than a screenshot.
 *
 * **Neither face carries the UI's symbol glyphs and neither ever did** — `→`
 * U+2192, `○` U+25CB and `●` U+25CF (the upgrade panel's pips), `▸` U+25B8,
 * `△` U+25B3, `⌫` U+232B, thin space U+2009. Checked against the upstream
 * `cmap`s: Audiowide has 366 codepoints, Oxanium 357, and neither includes any
 * of them. They fall through to the stack per-character, exactly as they did
 * before the fonts shipped. That is a browser behaviour, not a subsetting loss.
 */
export const RATIFIED_FACES: readonly RatifiedFace[] = [
  {
    family: 'Audiowide',
    href: './fonts/Audiowide-Regular-latin.woff2',
    weight: '400',
    load: ['400 16px Audiowide'],
  },
  {
    family: 'Oxanium',
    href: './fonts/Oxanium-Variable-latin.woff2',
    weight: '200 800',
    load: ['400 16px Oxanium', '700 16px Oxanium'],
  },
];

/**
 * The ceiling the two self-hosted files are held under, in bytes.
 *
 * They are 27.5 KB today. This is a **budget, not a record** — it exists so that
 * un-subsetting a face, or quietly adding a second weight of Oxanium next to a
 * variable file that already covers the axis, fails a test instead of costing
 * every phone on every cold load. Raising it is a decision, which is the point.
 */
export const FONT_PAYLOAD_BUDGET_BYTES = 32 * 1024;

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
 * and since u14-01 that first name resolves: the woff2 is in `public/fonts/` and
 * the page loads it before the first frame is drawn ({@link RATIFIED_FACES}). So
 * Liberation Mono no longer decides what a golden looks like — but it is not
 * dead weight either. It is still what draws the symbol glyphs Oxanium has never
 * contained (`→`, `○`, `●`, `▸`, `△`, `⌫`, thin space), per-character, and it is
 * still what the screen falls back to whole if the file 404s or the boot gate's
 * deadline expires. On both of those paths the two gating machines have to agree
 * about what they are drawing, so the reasoning above stands unchanged.
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

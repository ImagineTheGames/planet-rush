/**
 * src/ui/font-boot.ts — the boot gate for the two ratified faces. OWNER: UI Engineer.
 *
 * `index.html` calls {@link awaitRatifiedFaces} and awaits it **before** it
 * imports `src/main.ts`, so the module that builds the renderer is not evaluated
 * until Audiowide and Oxanium have loaded (or the deadline has passed).
 *
 * ── WHY BLOCKING, AND NOT `font-display` ───────────────────────────────────
 * `font-display` is a DOM rule and this game draws its text into a **canvas**,
 * where it buys nothing: Pixi calls `fillText` with whatever face is resolved at
 * that instant, bakes the result into a texture, and never redraws it because a
 * font arrived later. A frame composited before the woff2 decodes is therefore a
 * *permanently* wrong frame — the menu in Trebuchet, the HUD in Liberation Mono —
 * and in `tests/mobile/goldens.spec.ts` it is a coin flip between two different
 * baselines. Waiting on `document.fonts.ready` inside the app would be too late
 * for anything drawn during boot.
 *
 * ── WHY `.load()` AND NOT `.ready` ─────────────────────────────────────────
 * `document.fonts.ready` resolves immediately when nothing is pending, and a face
 * nothing has asked for yet is *not* pending — so `ready` alone would wave a cold
 * page straight through. `.load()` is what actually starts the load. The
 * `<link rel="preload">` pair in `index.html` means the bytes are usually already
 * in cache by the time this runs.
 *
 * ── WHY IT IS BOUNDED ──────────────────────────────────────────────────────
 * NO BLACK SCREENS, EVER (`@platform/boot-error`). A font that 404s or hangs must
 * cost the player a fallback face, never the game. The deadline races the load and
 * boots regardless, and it matches the `font-display: block` period in
 * `index.html` so the two cannot disagree about how long the screen may be bare.
 *
 * This module owns the *waiting*. `./typography` owns *which faces*, and
 * `index.html` owns the `@font-face` rules and the preloads — the page's job, not
 * a model's.
 */
import { RATIFIED_FACES } from './typography';

/**
 * How long boot will wait for the faces before giving up and starting anyway.
 *
 * Matches `font-display: block`'s period in `index.html`. Asserted in
 * `./typography.test.ts` — a gate that can wait forever is a black screen.
 */
export const BOOT_FONT_DEADLINE_MS = 3000;

/**
 * Load every ratified face, or give up after {@link BOOT_FONT_DEADLINE_MS}.
 *
 * Never rejects and never throws: every failure path here has to end in "boot the
 * game in a fallback face", because the alternative is a player looking at
 * nothing. Resolves as soon as the faces are ready, which on a warm cache is the
 * same tick.
 */
export async function awaitRatifiedFaces(
  deadlineMs: number = BOOT_FONT_DEADLINE_MS,
): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  // No CSS Font Loading API (old Safari, some embedded webviews) — there is
  // nothing to wait on and nothing to gain by stalling. Boot.
  if (!fonts) return;

  const loaded = Promise.all(
    RATIFIED_FACES.flatMap((face) => face.load.map((shorthand) => fonts.load(shorthand))),
  ).catch((err: unknown) => {
    console.warn('Planet Rush: a ratified face did not load; falling back.', err);
  });

  await Promise.race([
    loaded,
    new Promise<void>((resolve) => setTimeout(resolve, deadlineMs)),
  ]);
}

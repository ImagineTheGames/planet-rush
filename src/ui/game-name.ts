/**
 * src/ui/game-name.ts — the game's name, in one place. OWNER: UI Engineer.
 *
 * ── WHY A CONSTANT AND NOT A STRING ────────────────────────────────────────
 * The title gate (`./title-gate`) stamps the wordmark INTO the leaves of an
 * airlock: the two words are cut through steel, carry a gradient ramp keyed to
 * the leaf's own material, and travel with the door as it opens. A name baked
 * into that geometry is a name that costs a re-cut to change.
 *
 * The developer intends to rename the game eventually — *"it has nothing to do
 * with planets anymore"* — but that is a decision with a blast radius this
 * screen has no business forcing: it reaches the repository name and the Pages
 * URL, which breaks every evidence link in `evidence/` and every docs
 * cross-reference. So the rename is somebody else's call, made once, and this
 * file is where it lands.
 *
 * **What ships is what the browser tab and the manifest already say.**
 * `index.html` (`<title>`, `apple-mobile-web-app-title`) and
 * `public/manifest.webmanifest` (`name`, `short_name`) all say `Planet Rush`,
 * and a title screen that disagreed with the tab above it would be the drift
 * this constant exists to prevent. Docs and evidence keep saying Planet Rush
 * whatever happens here — they are records of what was true.
 *
 * The rename therefore costs **this constant plus those files**, and the door
 * never gets re-cut.
 */

/**
 * The wordmark, as the gate and the main menu print it.
 *
 * All caps because both surfaces set it in Audiowide at display size, where the
 * lowercase is not the ratified look (style-guide §7). Change it here and the
 * gate re-splits it across the two leaves on the next mount — no geometry moves.
 */
export const GAME_NAME = 'PLANET RUSH';

/** The upper leaf's word and the lower leaf's word. */
export interface Wordmark {
  /** Rides the leaf that LIFTS. */
  readonly upper: string;
  /** Rides the leaf that DROPS. */
  readonly lower: string;
}

/**
 * Split {@link GAME_NAME} across the two leaves.
 *
 * A door has two leaves and the name has to survive being cut in half, so the
 * split is a rule rather than two literals: everything before the **last**
 * space goes up, the last word comes down. `PLANET RUSH` → `PLANET` / `RUSH`,
 * `STAR RUSH` → `STAR` / `RUSH`, and a three-word name keeps its first two
 * together rather than orphaning a word onto a leaf of its own.
 *
 * A single-word name is cut at its own midpoint (rounded up, so the heavier
 * half rides the upper leaf, which is the one the lock is bolted through). That
 * is not a nice reading, but it is a *readable* one — and it is the case a
 * rename can produce without warning, which is exactly when a silently empty
 * leaf would be discovered.
 */
export function splitWordmark(name: string = GAME_NAME): Wordmark {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return { upper: '', lower: '' };
  const cut = trimmed.lastIndexOf(' ');
  if (cut > 0) {
    return { upper: trimmed.slice(0, cut), lower: trimmed.slice(cut + 1) };
  }
  const half = Math.ceil(trimmed.length / 2);
  return { upper: trimmed.slice(0, half), lower: trimmed.slice(half) };
}

/**
 * Extra letter-spacing, in em, for the SHORTER of the two words.
 *
 * The design tracks its lower word out by a flat `0.17em` so that `STAR` and
 * `RUSH` — four letters each, but not four letters of equal width — read as one
 * column rather than as two lines that happen to be stacked. A flat number only
 * works while both words are the same length, and `PLANET` / `RUSH` are not: the
 * name is a constant now, so the correction has to be derived from the words
 * actually being set.
 *
 * Audiowide is near-monospaced at display size, so character count is a good
 * enough proxy for advance width: spreading the shorter word by the width
 * difference, divided by the gaps it has to spread it across, lands the two
 * columns within a few percent of each other. It is capped at
 * {@link MAX_EXTRA_TRACKING} because past that the letters stop being a word.
 *
 * Returns `0` for the longer word — it is the one that sets the column width.
 */
export function extraTracking(word: string, other: string): number {
  const gaps = Math.max(1, word.length - 1);
  const deficit = other.length - word.length;
  if (deficit <= 0) return 0;
  return Math.min(MAX_EXTRA_TRACKING, deficit / gaps);
}

/** Ceiling on {@link extraTracking} — the design's own flat correction, which is
 *  as far as Audiowide can be opened before the word stops reading as one. */
export const MAX_EXTRA_TRACKING = 0.17;

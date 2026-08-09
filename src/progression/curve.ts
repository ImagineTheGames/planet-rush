/**
 * src/progression/curve.ts — the level curve, as pure functions and two dials.
 * OWNER: UI Engineer (brief `docs/briefs/pr-03-level-curve.md`; plan
 * `docs/progression-plan.md` §1.4).
 *
 * The smallest module in the progression chain, and deliberately separate from
 * everything else so that the one piece of arithmetic the whole system rests on
 * has its own tests and no dependencies: **no storage, no sim, no DOM**.
 *
 * `base = 300` and `exp = 1.6` are developer-ratified (2026-08-07, verbatim:
 * *"ok"*) and re-proved against the ratified XP weights in plan §1.4 — level 2
 * still lands inside a single match (0.8 of one), level 10 at ~101 matches. Both
 * stay TUNABLE; QA owns them from m10.
 *
 * Two traps the implementation below is written around, both named in the brief:
 *
 *  - **`levelForXp` must not loop unbounded.** The obvious implementation walks
 *    levels until the cumulative total exceeds `xp`; hand it `Infinity` and that
 *    is a hung tab on the one screen a player cannot leave. It is capped, and
 *    junk input folds to level 1 before the walk starts.
 *  - **Round once, at `xpToNext`.** Rounding inside the cumulative sum and
 *    rounding the sum give different tables; §1.4's table is the
 *    rounded-per-step one, and every consumer reads the same numbers the tests
 *    assert.
 */

/** Moves the whole early game. TUNABLE (ratified 2026-08-07). */
export const XP_CURVE_BASE = 300;
/** Moves the tail's steepness. TUNABLE (ratified 2026-08-07). */
export const XP_CURVE_EXP = 1.6;

/**
 * The highest level this curve will count to.
 *
 * Not a design cap — it is the bound that makes {@link levelForXp} total. A
 * corrupt-but-parseable profile reaches these functions (the profile reader
 * folds junk, but a merely *enormous* XP total is valid), and an uncapped walk
 * on `Number.MAX_VALUE` never returns. At `base·L^exp` the cumulative XP to
 * reach level 1000 is already ~1.9e7 times a single match's pay, so nothing a
 * player can earn touches this.
 */
export const XP_MAX_LEVEL = 1000;

/** A level clamped into `[1, XP_MAX_LEVEL]`, with junk (`NaN`, `-3`, `2.5`,
 *  `Infinity`) folded to something sane rather than propagated. */
function safeLevel(level: number): number {
  if (!Number.isFinite(level)) return level > 0 ? XP_MAX_LEVEL : 1;
  return Math.min(XP_MAX_LEVEL, Math.max(1, Math.floor(level)));
}

/** An XP total clamped to a finite, non-negative number. `NaN` folds to 0 —
 *  a player with an unreadable total is at the start of the curve, never past
 *  the end of it. */
function safeXp(xp: number): number {
  if (!Number.isFinite(xp)) return xp > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return Math.max(0, xp);
}

/**
 * XP required to go FROM `level` TO `level + 1` — `round(base · L^exp)`.
 *
 * This is the ONE rounding in the whole module: every cumulative total below is
 * a sum of these rounded steps, so `xpToReach`, `levelForXp` and the summary
 * bar can never disagree about where a level boundary sits.
 */
export function xpToNext(level: number): number {
  return Math.round(XP_CURVE_BASE * safeLevel(level) ** XP_CURVE_EXP);
}

/** Total XP required to REACH `level` from zero. Level 1 costs nothing — a fresh
 *  profile is already there. */
export function xpToReach(level: number): number {
  const target = safeLevel(level);
  let total = 0;
  for (let l = 1; l < target; l++) total += xpToNext(l);
  return total;
}

/**
 * The level a lifetime XP total corresponds to. Level 1 at 0 XP, and never 0 or
 * negative whatever it is handed.
 *
 * Walks the same rounded steps `xpToNext` produces — a closed-form inverse of a
 * *rounded* sum would drift off the table by a level at the boundaries, which is
 * a level-up firing at the wrong moment on a screen built entirely around that
 * moment. The walk is bounded by {@link XP_MAX_LEVEL}.
 */
export function levelForXp(xp: number): number {
  let remaining = safeXp(xp);
  let level = 1;
  while (level < XP_MAX_LEVEL) {
    const step = xpToNext(level);
    if (remaining < step) break;
    remaining -= step;
    level++;
  }
  return level;
}

/** Where a lifetime XP total sits inside its own level — what the summary bar
 *  and the hangar's level block both read. */
export interface LevelProgress {
  /** The level that total corresponds to. */
  readonly level: number;
  /** XP earned INTO the current level. */
  readonly into: number;
  /** XP still owed to reach the next one. */
  readonly toNext: number;
  /** `into / xpToNext(level)`, in `[0, 1)` — the bar's fill. */
  readonly frac: number;
}

/**
 * How far through the current level a total sits.
 *
 * Consistent with the three functions above by construction: `into + toNext ===
 * xpToNext(level)`, and `frac` is in `[0, 1)` — never 1, because a full bar is a
 * level-up, and a screen that drew a completed bar under the *previous* level's
 * number would be showing a promotion it had not made.
 */
export function levelProgress(xp: number): LevelProgress {
  const total = safeXp(xp);
  const level = levelForXp(total);
  const step = xpToNext(level);
  const into = Math.min(Math.max(0, total - xpToReach(level)), Math.max(0, step - 1));
  const toNext = step - into;
  return { level, into, toNext, frac: step > 0 ? into / step : 0 };
}

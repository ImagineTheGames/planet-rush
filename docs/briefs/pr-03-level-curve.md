# pr-03 — the level curve, as two pure functions and two dials

**Owner:** UI Engineer · **needs: nothing** — claimable today
**Plan:** `docs/progression-plan.md` §1.4 · **Blocks:** pr-04

---

## The ask

The smallest brief in the chain, and deliberately separate from everything else so that the one
piece of arithmetic the whole system rests on has its own tests and no dependencies.

```ts
// src/progression/curve.ts (new) — pure. No storage, no sim, no DOM.
export const XP_CURVE_BASE = 300 as Tunable<number>;   // moves the whole early game
export const XP_CURVE_EXP  = 1.6 as Tunable<number>;   // moves the tail's steepness

/** XP required to go FROM level L TO L+1. */
export function xpToNext(level: number): number;
/** Total XP required to REACH a level from zero. */
export function xpToReach(level: number): number;
/** The level a lifetime XP total corresponds to. Level 1 at 0 XP. */
export function levelForXp(xp: number): number;
/** For the bar: how far through the current level a total sits, 0..1, and the remainder. */
export function levelProgress(xp: number): { level: number; into: number; toNext: number; frac: number };
```

`base = 300` and `exp = 1.6` are **developer-ratified** (2026-08-07, verbatim: *"ok"*) and
re-proved against the ratified weights in §1.4 — level 2 still lands inside a single match
(0.8 of one), level 10 at ~101 matches. Both stay `TUNABLE`; QA owns them from m10.

## Test first

1. `levelForXp(0) === 1`, and it never returns 0 or a negative.
2. `xpToNext(L) === Math.round(300 * L ** 1.6)` reproduces §1.4's table exactly at
   L = 1…20.
3. **Boundaries.** `levelForXp(xpToReach(n)) === n` and `levelForXp(xpToReach(n) - 1) === n - 1`
   for n = 2…20. Off-by-one here is a level-up that fires at the wrong moment on a screen
   built entirely around that moment.
4. **`levelProgress` is consistent with the others** — `into + toNext === xpToNext(level)`, and
   `frac` is in `[0, 1)`.
5. **Junk in.** `NaN`, `-1`, `Infinity` and a non-integer XP total all produce a sane level and
   never loop. A corrupt-but-parseable profile reaches this function; it must not hang the
   summary screen.

## Traps

- **`levelForXp` must not loop unbounded.** The obvious implementation walks levels until the
  cumulative total exceeds `xp`; with `Infinity` in, that is a hung tab on the one screen a
  player cannot leave. Cap it, or invert the sum in closed form.
- **Round once, at `xpToNext`.** Rounding inside the cumulative sum and rounding the sum give
  different tables; §1.4's table is the rounded-per-step one, and pr-05's bar reads the same
  numbers the tests assert.
- **No storage, no sim, no DOM.** If this file imports anything from `src/sim/` or
  `src/platform/`, it is the wrong file.

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "git ls-files src/progression/curve.ts | grep -q ."
bash -c "grep -rEn \"from '(\\.\\./)+(sim|platform|render)\" src/progression/curve.ts | wc -l | grep -q '^0$'"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

The generated L = 2…20 table printed in the PR body, beside §1.4's, character for character.

## Open questions this brief is exposed to

**Question A** (keep the participation rows?) does not change this file — but if the answer is
*no*, `XP_CURVE_BASE` re-tunes to **75** in pr-04's change, not this one. Ship `300`.

# p1-03-level-curve.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/p1-03-level-curve`, cut from `origin/main` @ 644d3a4.

## THE FIRST THING TO KNOW

**`src/progression/curve.ts` was already on main when this lane opened.** It
landed 2026-08-07 as commit `ae5fa52` ("feat(pr-03): the level curve") inside
**PR #333** (`agent/ui/a0-14-hangar`) — that lane needed the curve for the
hangar's level block, found `pr-03` unclaimed, and implemented the ratified
spec verbatim as its own commit. See `status/notes/a0-14-the-hangar.md` §BUILT 2
and its NEXT block ("pr-01 and pr-03 are LANDED here").

So this lane is **not** a re-implementation. Re-writing the file would churn a
merged, tested module for no gain. What was left undone is audited below.

## BUILT

1. **the table lock** — `src/progression/curve.test.ts` gains a block that pins
   plan §1.4's *published table* (toNext, cumTotal, matches @600XP at levels
   2/3/4/5/6/8/10/15/20) as literals. The shipped test asserted
   `xpToNext(L) === Math.round(300 * L ** 1.6)`, which restates the formula
   rather than the doc, and pinned no cumulative total at all — so `xpToReach`
   was only ever checked against itself. pr-05's bar reads those cumulative
   numbers; now a dial change turns the doc red instead of silently re-deriving.
2. **evidence** — `evidence/p1-03-level-curve.ts` prints the L = 2…20 table out
   of the shipped module (`npx vite-node evidence/p1-03-level-curve.ts`);
   `evidence/p1-03-level-curve.txt` is its committed output, which is the
   brief's evidence line and goes in the PR body beside §1.4's.
3. **brief fixed** — `docs/briefs/pr-03-level-curve.md` annotated where it
   disagrees with the plan (below), per the chain rule "the plan wins — say so
   in the PR and fix the brief".

## DECISIONS

- **Audited the shipped module against the brief's five tests before writing
  anything.** Four of the five were already covered by the 13 shipped tests:
  `levelForXp(0) === 1` and never ≤ 0; the L = 1…20 formula; the two-directional
  boundary sweep for n = 2…20; `into + toNext === xpToNext(level)` with
  `frac ∈ [0, 1)`; and NaN / -1 / ±Infinity / 12.5 folding without a loop. The
  one genuine hole was test 2's *"reproduces §1.4's table exactly"* — the doc's
  numbers were nowhere in the repo. That is the commit above. Rejected:
  rewriting curve.ts (nothing wrong with it), and a no-op PR (the hole is real).
- **`Tunable<number>` is NOT importable here — the plan wins.** The brief's
  signature block writes `export const XP_CURVE_BASE = 300 as Tunable<number>`,
  but `Tunable<T>` is declared in `src/sim/constants.ts:24`, so importing it
  would break the brief's own trap ("if this file imports anything from
  `src/sim/`… it is the wrong file") *and* fail the brief's own DoD grep. Plan
  §1.4 asks only for "both `TUNABLE`" — the comment convention used all over
  `src/main.ts`, `src/bots/ally.ts` and `src/art/`. Shipped code already does it
  that way and is correct. Brief annotated, `src/shared/` untouched.
- **Evidence is generated from the module, not typed out.** The table in the PR
  body comes from `import`ing `xpToNext`/`xpToReach`, so "character for
  character" is a property of the code, not of my typing.
- **The cumTotal column is `xpToReach(L)`, not a running sum of the row's own
  `toNext`.** §1.4's table is offset by one: the row labelled level *L* carries
  `xpToNext(L - 1)` — the cost of the step that *arrives* at L. Got this
  backwards once; it is why row 2 reads 300 and not 909.

## VERIFIED

- `npx tsc --noEmit` clean.
- `npx vitest run src/progression/` green (curve + profile).
- Full `npm test -- --run` green.
- Generated table matches §1.4 character for character, all nine published rows.

## NEXT

- Nothing outstanding once the PR is open and CI is green.
- For the rest of the chain: pr-04 (accrual) writes `xp`/`matches`; pr-05
  (summary bar) must read `levelProgress` and must not re-derive the curve. If
  Question A lands *no* (drop the participation rows), `XP_CURVE_BASE` re-tunes
  to 75 in **pr-04's** change, not here — and the table lock added by this PR is
  the test that will go red to tell you so.

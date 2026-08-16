# a0-59 — a destroyed ship drops everything

Branch `agent/gameplay/a0-59-full-death-drop`, **based on `a0-58` (PR #433, open)**,
not on `main`. Read the BASE section before touching anything.

## BASE — why this branch is stacked

a0-58 (`agent/gameplay/a0-58-whole-ore-only`) was pushed but **not merged** when
this started. The brief says rebase on it rather than race it, so this branch was
cut from a0-58's tip (`6044fca`) and carries its 14 commits underneath its own.
Consequences to know:

- `git diff main..HEAD` shows a0-58's whole diff plus mine, and shows a few
  `sound-review/` files as "reverted" — that is the merge-base, not a revert. a0-58
  branched before the a0-57 sound merge. **Do not "fix" that by reverting anything.**
- If a0-58 merges first, this PR collapses to my delta on its own.
- If a0-58 is ever abandoned, this branch still needs its whole-ore commits: the
  invariant is deliberately kept (see DECISIONS).

## BUILT

- `97a27f4` **sim(a0-59)** — `DEATH_ORE_DROP_FRACTION: Tunable<number> = 1`
  (`src/sim/constants.ts`), the ruling quoted verbatim on the constant.
  - `src/sim/damage.ts` — every comment that said "half" now says what happens.
    The code itself did not need to change: `drop = held * fraction` and a0-58's
    whole-chunk split already produce `drop = held`, all whole, `deathLoss = 0`.
  - `src/sim/damage.test.ts` — **`drops the whole hold`** (the DoD's named test):
    N = 1..9, chunks summing to exactly N, `toBe`-exact, plus `deathLoss === 0`.
    Beside it: the ledger balance (`dropped + deathLoss === held`) and the
    sub-chunk floor. a0-58's five tests are kept and renamed off "half".
  - `src/sim/loot-tell.test.ts`, `src/sim/match.test.ts` — the three assertions
    that encoded 0.5.
  - `GDD.md` §2.3 / §2.7 / §2.8 amended; `docs/design-amendments.md` carries the
    full entry with the developer's sentence verbatim.
- `586f479` **docs(a0-59)** — the sweep: `content/codex/codex-systems.json` (the
  in-game codex was telling players they drop half; the fact value is pinned to
  the constant by `tests/codex/codex-constants.test.ts`), `docs/gdd-conformance.md`,
  `docs/progression-plan.md`, `tests/harness/a0-08-evidence.test.ts` and the
  regenerated `evidence/a0-08-loot-tell/trace.txt`.

## DECISIONS

**Kept a0-58's whole-ore invariant, which this brief mostly dissolves.** At a
fraction of 1 the drop equals the hold and a whole hold divides into whole chunks
with nothing over, so the rounding subtracts zero today. It stays because both
`DEATH_ORE_DROP_FRACTION` and `CHUNK.ore` are TUNABLE and either one moving off 1
re-mints the remainder in one edit. LESSONS §26 — assert the relationship, not
today's value. **Do not delete the `pieces = Math.floor(...)` split because it
currently rounds nothing.**

**Kept `deathLoss`, now 0 for an ordinary death.** Explicitly required by the DoD.
It is the sink for anything undropped (quantisation leftover, ore lost out of
bounds) and `expectedLiveOre` subtracts it either way; a zero term costs nothing,
an absent term costs the conservation law.

**Rejected: touching `killShip`'s logic.** The one-line constant is the whole
mechanical change. Anything else would be scope the developer did not ask for.

**Rejected: hardcoding 1 in the tests.** Every assertion except `drops the whole
hold` reads `DEATH_ORE_DROP_FRACTION` / `CHUNK.ore`, so a future tune moves them
honestly instead of failing for the wrong reason. `drops the whole hold` is the
one place the *value* is the point, and is exact there on purpose.

**Removed the victim's bought cargo tier in two staging helpers**
(`src/sim/loot-tell.test.ts`, `tests/harness/a0-08-evidence.test.ts`) rather than
raising the looter's hold. Both tiers existed only so the *half*-drop would shed
2 chunks; the base hold of 2 now sheds 2 by itself. This keeps the a0-08 three-way
comparison honest — the looter's hold stays the only thing that varies. Worth
knowing: with a whole-hold drop a wreck can now out-size its looter (a tiered
victim sheds 4 into a base hold of 2), which is a real a0-59 consequence and is
noted in the test comment, not hidden.

**Flagged, not decided: the balance re-measure.** §2.8's field-yield, abundance
and collapse numbers were tuned with a sink that no longer exists. Stated as a
change in the amendment and the PR body; measuring it is QA's call, not this
lane's.

## CROSS-LANE FALLOUT (the part that took the time)

A ratified sim change reshuffles every simulated match, and four tests outside
this lane went red. Three were sampling; one is a real defect.

1. **Determinism goldens** — `src/bots/ffa-parity.test.ts` (3 seeds) and
   `tests/net/online-radio.test.ts` `FFA_GOLDEN`. Expected: they pin absolute
   state hashes. Re-measured in their own flagged commits, old values kept, on the
   bar each file sets for itself (a ratified amendment in
   `docs/design-amendments.md`). Same four a0-58 moved hours earlier.
2. **`src/bots/field-division.test.ts`** rock contention — pooled over 3 seeds,
   read 2.16 against a bar of 1.6. Per seed the ratio ranges **0.04–3.8**. Pooled
   1..24 it reads 1.19. Widened the pool to a 1..24 scan; **threshold untouched**.
   *Finding for the Bot Engineer:* on the PRE-a0-59 build the shipped 3 seeds read
   1.22 but seeds 1..24 read **1.74** — over the bar. §1.6's "closes to ~1.1×"
   claim is weaker than its seeds suggest, independent of this branch.
3. **`tests/harness/player-aggression.test.ts`** p15 A/B — pooled over 10 seeds,
   read 1.146 against a bar of 1.1. At 24 seeds: 0.971 here, 0.876 on the base.
   Widened 10 → 24; **thresholds untouched**. Costs 41s → 100s.
4. **`tests/harness/unstuck.test.ts` — NOT FIXED, NOT SAMPLING. See BLOCKED.**

## BLOCKED — one item: wave 5 entombs ships at the map centre

`tests/harness/unstuck.test.ts` fails at **seed 15**: `foreman` (slot 2) wedged
**133.5 s** at (1204,1195) while `'haul'`. 5531/5532 tests pass; `tsc`, the
dark-matter gate and `vite build` are green.

**Root cause — and it is NOT a bot bug.** Tracking slot 2 vs rocks near centre:

```
t=570  wave 4    0 rocks near centre   slot 2  39u from centre   free
t=600  wave 5   24 rocks near centre   slot 2   8u from centre   WEDGED
t=810  wave 5   23 rocks near centre   slot 2   6u from centre   still wedged
```

Wave 5 lays **24 asteroids of r=45.4 on a 67 u ring around the map centre**,
overlapping each other by up to **79.3 u**. The annulus 21.6 u → 112 u is solid
rock and the disc inside is a **sealed pocket of radius 21.6 u**. Hull is ~12 u.
The ship was at the centre when the wave landed and is entombed. The "13×9 u box
it orbits" is the pocket.

Systematic, every seed measured — free-pocket radius / ring solidity at wave 5:
seed 1 → 32.1 u, 232/360 blocked · seed 7 → 27.7 u, 264/360 · seed 15 → 21.6 u,
**304/360** · seed 42 → 35.9 u, 200/360 · seed 991 → 38.1 u, 192/360. **A human
player caught at the centre would be entombed the same way.**

**a0-59 did not cause it.** The central geometry is byte-identical on the base
(same positions, radii, overlap; only entity ids differ). Wedge rates:

| build | wedges | seeds |
|---|---|---|
| a0-58 tip | 3 (seeds 142, 146, 147) | 280 |
| this branch | 1 (seed 15) | 96 |

≈1.1% vs ≈1.0% — statistically identical, all four at the map centre. The gate
samples 24 seeds, so at ~1% it is a coin flip on any sim change. Third
under-powered standing gate this branch turned up; the only one sitting on a real
bug.

**Why not fixed here.** `src/sim/waves.ts` IS this lane's file, so the bug is
mine — but the fix is a placement rule ("a wave must not spawn rock overlapping a
live ship"), and placement is pinned by two ratified invariants: exact
`FIELD_YIELD` at every N, and per-station fairness by construction. That is the
trade a0-58 flagged and declined. It needs its own brief and ratification;
folding it into a one-constant developer ruling is exactly the scope creep to
avoid. **Director call:** land a0-59 and brief the wave trap separately, or hold
a0-59 behind it.

Repro: `npx vitest run tests/harness/unstuck.test.ts` here (seed 15), or seeds
142/146/147 on `main`.

*(Diagnosed wrong twice before this: "steering limit cycle in open space" — I had
measured centre-to-centre, not hull clearance — then a `dodge` oscillation between
two rocks. Both were symptoms of the pocket. Trust the numbers above.)*

## NEXT

- Determinism goldens: `src/bots/ffa-parity.test.ts` (3 seeds) and
  `tests/net/online-radio.test.ts` `FFA_GOLDEN` pin absolute state hashes of the
  simulation, so a sim rule change moves them by construction — same four a0-58
  moved. **`src/bots/` is not this lane's to edit.** Cross-lane, in their own
  commits, flagged in the PR to Bot and Netcode, old values kept, exactly as a0-58
  did it. Status: see the commits after `586f479`.
- Full `npx vitest --run` and `npx tsc --noEmit` green before the PR opens.

## BLOCKERS

One: the `unstuck` wedge above. Everything else in the DoD is done and green.

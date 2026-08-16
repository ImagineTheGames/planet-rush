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

## BLOCKED — one item, and it is not this lane's to decide

`tests/harness/unstuck.test.ts` "keeps every bot under 12s pinned across 24
shipped-cast matches" fails on this branch at **seed 15**: `foreman` (slot 2)
wedged **133.5 s** at (1204,1195) while `'haul'`, at full throttle.

**It is a genuine bot defect, and a0-59 exposed it rather than caused it.** It is
the v0.2.2 field report's own bug class: a hull pinned against bodies at full
throttle. Hull-surface clearance to the four nearest rocks, seed 15 slot 2:

```
t=580 pos=(1136,1212)   0.2   7.8  11.4  21.7   <- clipping, still escaping
t=590 pos=(1228,1124)  23.3  27.2  33.3  33.9   <- free
t=600 pos=(1208,1203)  -2.6   0.0   0.1   6.0   <- enters the clump
t=610 pos=(1196,1204)  -0.0   0.0   3.5   3.6   <- wedged
t=620 pos=(1201,1194)  -0.0   0.6   2.9   4.3
t=640 pos=(1206,1199)   0.0   0.9   2.6   4.7
```

From t≈600 it is **in contact with 3–4 asteroids at once** in a dense clump at the
exact map centre (late waves spawn closer to centre by design, §2.3) and never
gets out: `lastThrust = 1.00`, `lastBehavior = 'haul'`, cargo 3/4, phase `live`,
133 s. Before t=600 the escape run *was* working — it clipped rocks repeatedly and
got clear each time.

**Mechanism.** While wedged, the nearest-body pick alternates on a fixed rhythm:
over one 120-tick sample, **26 flips across 7 distinct bodies**, cycling 7 ticks on
rock `4882` and 3 on rock `4879`. `go()` curves the committed escape heading
through `dodge` around whichever body is nearest *this* tick, so with two rocks
straddling the lane the escape is re-steered back and forth and never outlasts the
thing it is escaping. `src/bots/behaviors.ts`'s own comment anticipates exactly
this in a dense central cluster. That is `src/bots/`, which this lane must never
touch, and it is behaviour, not a fixture.

*(An earlier reading in this note said "no obstacle at all" — that measured
centre-to-centre distance under a range filter and was wrong. Surface clearance is
the number above.)*

**Rate, measured.** Base build (a0-58 tip): **0 wedges in 120 seeds** scanned
(1..24 shipped + 25..120), larger scan running. a0-59: **1 in 96** (seed 15 only).
1/96 vs 0/120 does not establish that a0-59 raised the rate (Fisher p≈0.44) — it
is most consistent with a **rare latent trap** that the shipped 24-seed set
happens to miss on one build and hit on the other.

**Why it is not resolvable here.** The two honest exits are (a) fix the steering
limit cycle in `src/bots/`, which is out of ownership and is a substantive
behaviour change, or (b) weaken a standing class-killer invariant, which would be
wrong at any time and especially to land an unrelated constant. Widening the seed
pool — the fix for items 2 and 3 — makes this one *worse*, not better. Repro:
`npx vitest run tests/harness/unstuck.test.ts` on this branch.

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

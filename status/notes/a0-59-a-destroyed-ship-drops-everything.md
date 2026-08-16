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

- `9d52dc6` **docs(a0-59)** — the wedge A/B re-measured on 200 seeds, both arms,
  replacing a table that did not reproduce. See BLOCKED. Nothing in the shipped
  code changed; this commit is the evidence the Director's ruling rests on.

- `dc952e9` **docs(a0-59)** — the wave-trap *geometry* re-measured off the shipped
  constants, replacing a hand-computed version with two wrong inputs. See BLOCKED
  for the table. Shipped code unchanged.
- `faa756b` **sim(a0-59)** — **comment-only**, `src/sim/constants.ts`. Corrects a
  provably false guarantee in `commonsHoleFraction`'s doc-comment ("a radius whose
  circumference actually admits a ship-wide gap" — it does not; 276 u needed,
  71 u delivered) and records the angular-scaling caveat on `commonsSpokeGap`.
  **No value moves**; every changed line is a comment line, `tsc` clean, no golden
  can shift. Done because that false claim is load-bearing: it is precisely what
  talks the next agent into raising the fraction a third time.

**Verified green, not re-done, on 2026-08-16 (third session):** `npx tsc --noEmit`
exits 0; the constant is `1`; `drops the whole hold` is present and exact; CI's own
log for `96bfe7e` reads **299 of 300 test files passed**, the single failure being
`tests/harness/unstuck.test.ts` at seed 15. Both remote DoD greps pass against
`FETCH_HEAD`.

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

**Corrected the two commons doc-comments, but moved no value (`faa756b`, fourth
session).** The line I drew: a constant's *value* is a design call and stays
untouched; a constant's *doc-comment stating a falsehood about the geometry* is an
engineering defect in my own file and I fixed it. `commonsHoleFraction` claimed its
raise made the innermost ring's circumference "actually admit a ship-wide gap" —
measured, it needs 276 u and delivers 71 u. Leaving that in place is not neutral:
it is an argument, written in the file, for raising the fraction a third time, and
it would have cost the next agent a session before they measured anything. Same
for `commonsSpokeGap`, which is an angle and so silently weakens as the ring
shrinks. Zero behavioural risk — every changed line starts with `*`, `tsc` clean,
no golden can move — so this does not touch the "no unratified sim change" line the
rest of this note holds.

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
(same positions, radii, overlap; only entity ids differ).

**RE-MEASURED AGAIN 2026-08-16 (third session) ON 200 SEEDS — AND THE TABLE THAT
USED TO BE HERE DID NOT REPRODUCE. Trust this one; the numbers below replaced a
wrong table, not a missing one.** The two builds differ by exactly one constant
now that a0-58 has merged to `main`, so the A/B is that constant flipped on this
tree with the same seeds run through `unstuck`'s own wedge probe (a verbatim copy
of `worstWedge`, same `WEDGE_R = 8`, same `WEDGE_LIMIT_S = 12`, same 20-minute
match cap) both ways:

| build | seeds 1–48 | seeds 49–200 | total 1–200 | rate |
|---|---|---|---|---|
| `main` (fraction 0.5) | **0** | 3 — 142, 146, 147 | **3 / 200** | 1.5% |
| this branch (fraction 1) | 1 — 15 | 1 — 142 | **2 / 200** | 1.0% |

Held times and positions: at 0.5 — 142 (40.9 s @1202,1193), 146 (58.8 s
@1200,1308), 147 (95.9 s @1198,1193). At 1 — 15 (133.5 s @1204,1195), 142 (12.3 s
@1205,1204). **Every wedge on both builds is at or beside the map centre**
(1200,1200); the one outlier, 146 at 108 u, is still inside wave 5's 21.6→112 u
annulus.

**What did NOT reproduce**, and is corrected here: the previous table claimed
`main` wedges at seeds **30 and 40** and this branch at **15, 23 and 40**, with
seed 40 failing on both. Seeds 23, 30 and 40 wedge on **neither** build. `main` is
clean across the whole of 1–48. The 4.2% / 6.3% rates were both roughly 4× too
high, and the direction was wrong too.

**Two conclusions change, one survives.**

1. *(survives, now correctly evidenced)* **`main` passes this gate by luck, not by
   being correct.** It really does carry the defect — at seeds 142, 146, 147 — and
   the gate draws seeds 1–24 and asserts zero, so `main`'s three bad seeds all fall
   outside the draw. That claim was right; the seeds behind it were not.
2. *(changed)* **a0-59 does not make the wedge more likely.** 2/200 here against
   3/200 on `main` — indistinguishable at this sample size, and if anything lower.
   The old table said this branch was ~50% worse. It is not. a0-59 re-rolls *which*
   seeds hit a pre-existing trap; seed 15 happens to land inside the gate's draw.
3. *(changed)* **The blast radius is ~1.25% of seeds, not ~5%.** A zero-tolerance
   24-seed draw over a 1.25% defect passes ~74% of the time, so roughly **one sim
   change in four** turns this gate red without causing anything — not "two thirds."

**Why not fixed here — the arithmetic, now MEASURED off the shipped constants
rather than hand-computed. (2026-08-16, fourth session. This replaces a weaker
and partly wrong version of this section; two of its inputs were off.)**

`src/sim/waves.ts` IS this lane's file, so the bug is mine. There is **no
repositioning fix at all** — not radial, not angular — and it is provable.
Measured by instantiating the real world (`createWorld`, seed 15, the shipped
8-slot cast) and reading `waveRadiusFraction` / `RESOURCE_FIELD` / `ASTEROID`
directly, rather than from remembered numbers:

```
fieldRadius=307.2  sectors=8  sectorWidth=45.00deg  gap=0.330rad (clamp 0.353)
asteroidsPerWave=20  sectorRocks=3  total=24  ASTEROID r=[22,46] mean=34  SHIP_RADIUS=16

wave  disc    eye(centres)  freeEye  ringMid  circum  arcNeeded  oversub  spokeClear
 1    307.2      261.1       215.1    284.2    1785     1632      0.91x      84.6
 2    249.6      212.2       166.2    230.9    1451     1632      1.13x      68.7
 3    192.0      163.2       117.2    177.6    1116     1632      1.46x      52.9
 4    134.4      114.2        68.2    124.3     781     1632      2.09x      37.0
 5     76.8       65.3        19.3     71.0     446     1632      3.66x      21.2
                                                     needSpokeClear=62   rMinPassable=276
```

Two corrections to what this note used to say. **`SHIP_RADIUS` is 16, not the
"~12 u hull" quoted above** — every clearance requirement is 8 u larger than the
old arithmetic assumed. And **the binding constraint is not adjacent-pair
spacing.** The old note solved `2πR/8 ≥ 92` for one pair of neighbours and got
`R ≥ 117 u`. The real requirement is that all 24 rocks *plus one ship-wide
corridor* fit around the whole circumference: `(24 × 68 + 2 × (16+34)) / 2π`
= **`R ≥ 276 u`**. Wave 5's ring sits at **71 u**. It is short by **3.9×**, not
the 1.5–1.9× the old note claimed.

**The commons ring is oversubscribed by construction from wave 2 onward.** Wave
5 needs 1632 u of rock arc on a 446 u circumference — **3.66× more rock than the
ring can hold**. No angular or radial rearrangement fits 1632 u of rock into
446 u of ring. That kills every "just place them better" fix outright, including
the one this note previously left open.

**And the launch-corridor guarantee is angular, so it evaporates as the disc
shrinks.** `commonsSpokeGap` is a fixed **0.33 rad**; the linear clearance it
buys is `eye × sin(gap)`, which scales with the ring. It is 84.6 u at wave 1 and
**21.2 u at wave 5**, against the `SHIP_RADIUS + ASTEROID.maxRadius` = **62 u**
the constant's own doc-comment promises ("so the innermost ring rock clears a
launching ship's path by more than a ship+rock radius"). **That promise is
already broken at wave 3** (52.9 u) and is off by 3× at wave 5. Both documented
corridor guarantees — the radial eye and the angular spoke — are void at wave 5.

This also explains the residual rate precisely. `commonsHoleFraction`'s
0.75 → 0.85 raise was made for *exactly this bug*, and its comment claims it
"pushes the innermost ring out to a radius whose circumference actually admits a
ship-wide gap." **That claim is false** — 276 u is needed and 71 u is delivered;
the raise never touched oversubscription. All it did was grow `freeEye` from
~10 u to **19.3 u**, which is why the wedge got *shorter* (a ship rattles in a
bigger pocket and sometimes escapes inside 12 s) but never went away. The
19.3 u free eye is also the measured ~21.6 u pocket at seed 15 — same number,
confirming the pocket IS `eye − rock body`.

So `commonsHoleFraction` is not merely at the end of its travel; it was never
the right knob. The knobs that could actually fix it are `WAVE.lastRadiusFraction`
(stop the rings closing so far in — but "the shrinking ring *is* the mechanic",
GDD §2.3), `ASTEROID.maxRadius` / rock size, or the per-wave rock count. **All
three are balance/design calls, not gameplay-lane repairs**, and folding one into
a one-constant developer ruling is exactly the scope creep to avoid. **Director
call:** land a0-59 and brief the wave trap separately, or hold a0-59 behind it.

Note also a second-order fact worth the Director's attention: the eye is reserved
by rock **centre**, while the launch pocket 90 lines above in the same file is
reserved by rock **body** (`pocketOuterR = ringR − ringR×SPAWN_CLEAR_POCKET −
ASTEROID.maxRadius`, commented "keeps the whole rock out of the pocket, not just
its centre"). The commons omits that `− maxRadius` term, which is why a 65.3 u
eye leaves only 19.3 u of actually-free space. Correcting that alone does not
open a corridor — the ring is 3.66× oversubscribed either way — but it is the
same class of mistake and belongs in the same brief.

Three candidates for whoever takes that brief, re-costed against the arithmetic
above. None is taken here.

1. **Widen the final wave's ring — `WAVE.lastRadiusFraction`.** ~~0.25 → ~0.44~~
   **Re-costed and now much worse than this note used to say.** Passability needs
   `R ≥ 276 u`, so the ring's *mid* radius must reach 276 of a 307 u field: that
   is `lastRadiusFraction ≈ 0.90`, against wave 1's own 1.00. **Wave 5 would have
   to land essentially on top of wave 1.** This does not weaken GDD §2.3's
   shrinking ring, it **deletes** it — all five waves would land in the same
   annulus. On the corrected arithmetic this option is not a designer trade-off,
   it is a non-starter, and it should not be offered as one.
2. **Cut late-wave rock size or count — the only knob with real travel.** The
   ring is oversubscribed 3.66×, so passability needs the rock arc down by ~4×:
   `ASTEROID.maxRadius` tapered with `waveRadiusFraction`, or `sectorRocks`
   falling as the ring closes (fewer, and the wave's fixed ore budget makes the
   survivors richer — `asteroidCount` already documents exactly that trade).
   Either keeps GDD §2.3's ring closing in. Costs GDD §5.5's "a payout the player
   can judge" — rock size reads as ore — and changes the field's visual texture.
   **This is the one to brief**, and the count variant is likely cheaper than the
   size variant because the ore budget absorbs it.
3. **Eject any live ship a landing wave would entomb.** Rock positions untouched,
   so `FIELD_YIELD` and `N`-fold symmetry are both exact and — because it only
   fires on the ~1.25% of seeds where a ship is actually caught — it moves almost
   no goldens. Cheapest of the three and the only one that changes no field
   design. Against it: it is a new sim rule (a wave displacing a ship), and it
   treats the symptom — with the ring 3.66× oversubscribed the centre stays a
   sealed pocket for anyone who flies in *after* the wave lands; it only stops
   someone being sealed in at the instant of landing.
   **Note the earlier draft of this option was overlap-triggered and would not have
   fired**: at seed 15 the ship sits ~8 u from centre in a 19.3 u free pocket with
   a 16 u hull radius, so it overlaps nothing — it is sealed *behind* a ~90 u
   annulus, not pinned inside rock. The trigger has to be "no escape route", not
   "overlaps rock". (Note how tight that is: a 16 u hull in a 19.3 u pocket has
   3 u of slack. The ship is very nearly a press-fit at the moment the wave lands.)

Repro, both arms, on this tree (the only difference between the builds is the one
constant): `npx vitest run tests/harness/unstuck.test.ts` fails here at seed 15.
For `main`'s sim, flip `DEATH_ORE_DROP_FRACTION` back to `0.5` and probe seeds
**142, 146, 147** — seeds 1–48 are clean on `main`, which is the whole reason the
24-seed gate is green there.

The geometry table above is reproduced by instantiating the shipped world and
reading the constants — `createWorld({ seed: 15, players: botLobby(fillEmptySlots([],
MATCH_SLOTS)) })`, then `world.fieldRadius`, `world.asteroidsPerWave`,
`world.stations.length`, and `waveRadiusFraction(n)` for n = 1..5. It needs no
match to be run, so it is seconds, not the 200-seed hours.

*(Diagnosed wrong three times before this: "steering limit cycle in open space" —
I had measured centre-to-centre, not hull clearance — then a `dodge` oscillation
between two rocks; both were symptoms of the pocket. Then the pocket was
root-caused correctly but **mis-costed**: a 12 u hull instead of the real 16, and
an adjacent-pair spacing bound (`R ≥ 117`) instead of the whole-circumference one
(`R ≥ 276`). The conclusion "no in-lane fix" survived all three; the numbers
under it did not. Trust the measured table, not the prose around it.)*

## NEXT

- Determinism goldens: `src/bots/ffa-parity.test.ts` (3 seeds) and
  `tests/net/online-radio.test.ts` `FFA_GOLDEN` pin absolute state hashes of the
  simulation, so a sim rule change moves them by construction — same four a0-58
  moved. **`src/bots/` is not this lane's to edit.** Cross-lane, in their own
  commits, flagged in the PR to Bot and Netcode, old values kept, exactly as a0-58
  did it. Status: see the commits after `586f479`.
- Full `npx vitest --run` and `npx tsc --noEmit` green before the PR opens.
- **2026-08-16, second session:** a0-58 has since MERGED (PR #433, `main` @
  `43236fb`), so the stacked base in the BASE section above has resolved —
  `origin/main` merged in at `3090cbd`, and `git diff main..HEAD` is now this
  brief's delta alone. The only sim difference between `main` and this branch is
  the one constant, which is what made the clean A/B in BLOCKED possible. PR
  **#436** is open.
- **2026-08-16, third session — what this one actually did.** Everything in BUILT
  was already committed and correct; I re-verified it rather than redoing it
  (`tsc --noEmit` clean, `drops the whole hold` present and exact, constant at 1,
  GDD + amendment + codex + conformance sweep all in place). The work of this
  session was **the A/B being wrong**: the previous table did not reproduce, so I
  re-ran both arms over 200 seeds with a verbatim copy of the gate's own probe and
  replaced it. Headline change — a0-59 does **not** raise the wedge rate (2/200 vs
  `main`'s 3/200); the previous table claimed the opposite and would have pushed
  the Director toward the wrong reason for the right decision. Also added the
  arithmetic proving no in-disc repositioning fix exists. The blocker itself is
  unchanged and still needs the same ruling.
- **2026-08-16, fourth session — what this one actually did.** Re-verified the
  shipped work again (nothing redone): `tsc --noEmit` exits 0, constant is `1`,
  `drops the whole hold` present at `damage.test.ts:83`, both remote DoD greps
  pass against `FETCH_HEAD`, local `HEAD` == `origin/…` == `4df48a5`, `main` has
  not moved (`43236fb`). Re-ran `unstuck` — still exactly seed 15, `foreman`
  slot 2, **133.5 s at (1204,1195)**, byte-identical to the third session's
  report. The work of this session was **the wave-trap arithmetic being wrong** —
  the same failure mode as last session, one level down. Measured the geometry off
  the shipped constants instead of recomputing it by hand and found two errors:
  `SHIP_RADIUS` is **16, not 12**, and the passability bound is
  whole-circumference (**`R ≥ 276 u`**), not adjacent-pair (`R ≥ 117 u`). Also
  found the mechanism nobody had named: the commons ring is **oversubscribed with
  rock 3.66×** at wave 5 (and >1× from wave 2 on), and `commonsSpokeGap` is an
  *angular* constant so the linear launch corridor it guarantees shrinks with the
  ring — 84.6 u at wave 1, **21.2 u at wave 5 against the 62 u its own doc-comment
  promises**. Consequences: no placement fix of any kind can exist, candidate 1
  (`lastRadiusFraction`) is re-costed from "0.44, a designer trade-off" to
  "**0.90, a non-starter that deletes the shrinking ring**", and candidate 2
  (rock size/count) is now the one to brief. **The ruling being asked for is
  unchanged; the reasoning under it is now correct and measured.**

## BLOCKERS

One: the `unstuck` wedge above — `tests/harness/unstuck.test.ts` is the only red
test, and it is the only thing keeping the PR's "Typecheck, test, build" check
red. `tsc --noEmit` is clean; everything else in the DoD is done and verified.

The 200-seed re-measure above is the part a Director needs, and it is the third
measurement of this — **the first two were wrong, this one is reproducible from
the recipe in the repro line**. The wedge is a **pre-existing map-geometry defect
on `main`**: 3/200 seeds there (142, 146, 147) against 2/200 here (15, 142), every
instance at the map centre. `main` passes the gate only because all three of its
bad seeds fall outside the 24 it draws, and seed 15 — which this branch's re-roll
moves into the trap — falls inside.

**a0-59 does not increase the defect rate.** That is the fact that decides this: a
one-constant developer ruling is being held behind a trap it did not create, does
not worsen, and cannot fix without a design change. The fourth session's measured
geometry makes the "cannot fix" part stronger than it was: the commons ring is
**3.66× oversubscribed with rock** at wave 5, so no rearrangement of any kind
fits, and the one knob that would make it passable (`lastRadiusFraction` ≈ 0.90)
would land wave 5 on top of wave 1 and delete GDD §2.3's shrinking ring outright.
So the choice is **who fixes the wave trap, and when**, not "is a0-59 safe".
Land a0-59 and brief the wave trap separately, or hold it.

What I deliberately did NOT do, and why, so the next session does not redo it:

- **Did not touch `src/sim/waves.ts`.** It is my file and the bug is mine, but
  every fix that works is a balance/design change (options 1–3 above). Unratified.
- **Did not weaken `tests/harness/unstuck.test.ts`.** It is the Bot Engineer's
  gate, and quarantining seed 15 to go green would mask a defect that is live on
  `main` right now at three other seeds. The gate is doing its job; it is the only
  reason anybody knows about this.
- **Did not re-widen the seed pool.** Widening is the right treatment for the two
  *sampling* gates above, and the wrong one here — a bigger pool makes this gate
  redder, not greener, because the defect is real.

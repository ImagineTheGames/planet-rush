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

- `6b6cab1` **docs(a0-59)** — commits the fourth session's note edits, which had
  been left in the working tree uncommitted.
- `95a8fb1` **docs(a0-59)** — `docs/wave-commons-entombment.md`, the wave trap
  written up as its own defect report so it outlives PR #436, plus a one-line
  comment in `constants.ts` pointing `commonsHoleFraction` at it (it already
  claimed the trap was "briefed separately"; now that is true). **No value moves.**

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

- **2026-08-16, fifth session — what this one actually did.** Re-verified the
  shipped work again (nothing redone): local `HEAD` == `origin/…` == `faa756b` at
  start, `tsc --noEmit` exits 0, constant is `1`, `drops the whole hold` present,
  both remote DoD greps pass against `FETCH_HEAD`, `main` still `43236fb`, PR #436
  open with **no Director ruling yet** (zero comments, zero reviews). Re-ran
  `unstuck`: still exactly seed 15, `foreman` slot 2, **133.5 s at (1204,1195)** —
  identical to sessions three and four.
  **Independently re-derived the wave-5 geometry** rather than trusting the note,
  because the note itself records getting it wrong twice. It reproduces: 446 u
  circumference, 1632 u of rock arc, **3.66× oversubscribed by rock alone**
  (3.9× including a ship corridor), `freeEye` 19.3 u against a 16 u hull,
  `spokeClear` 21.2 u against the 62 u promised, `rMinPassable` 276–280 u
  depending on whether the corridor's flanking rocks are sized at mean or max
  radius. **The "no in-lane fix" conclusion is now confirmed by a second
  independent derivation.**
  The one new thing: committed the fourth session's uncommitted note edits, and
  **lifted the wave trap out of the PR body into `docs/wave-commons-entombment.md`**
  — a standalone defect report (geometry, 200-seed incidence on both builds, three
  costed candidates, the eye-by-centre second-order bug, repro, and the four wrong
  diagnoses). The note had said "brief the wave trap separately" for two sessions
  and nobody had written the brief; a PR body dies with its PR, and this defect is
  live on `main`. **This is a docs deliverable, not a fix — the blocker is
  unchanged and still needs the same ruling.**

- **2026-08-16, sixth session — what this one actually did.** Three things, none
  of them a re-measurement of the blocker (the fifth session already re-derived it
  independently and it reproduced; a sixth pass would be waste).
  1. **Brought the branch up to date with `main`**, which had moved 10 commits
     (`43236fb` → `221a2b1`: a0-61 ui, a0-62 app-shell bloom, a0-63 explosion lab).
     Merged at `3773f95`. **`git diff HEAD...origin/main -- src/sim src/shared` is
     empty** — none of the three touched this lane, so the A/B in BLOCKED still
     stands unchanged and no re-measure was needed. *Note for whoever hits this
     next:* the merge aborts on untracked `evidence/a0-62-app-shell-bloom/audit.ts`
     left in the shared workspace by the art lane. Do **not** `git clean`; back the
     file up (I put it in `/tmp/a0-62-untracked-backup/`) and merge — `main`'s
     tracked copy is authoritative now that a0-62 has landed.
  2. **`3855f6c` sim(a0-59) — COMMENT-ONLY.** The fourth session corrected the two
     false corridor guarantees in `constants.ts` but **missed the third copy of the
     same claim, in `src/sim/waves.ts` itself** — the commons placement comment, at
     the point of edit, which is the one an agent actually reads before touching
     this code. It said *"Sized so the innermost ring rock clears a ship's straight
     path by more than a ship+rock radius (`inner·sin(gap)` ≈ 74 u)"*. False: 62 u
     is required, 21.2 u is delivered at wave 5, and the promise is already missed
     at wave 3. Also recorded there now: the eye is reserved by rock **centre**
     (unlike `pocketOuterR` 90 lines up, which subtracts `ASTEROID.maxRadius` and
     says so), and the 3.66× oversubscription that makes every placement fix
     impossible. `git diff -U0` filtered of comment lines is **empty**; `tsc`
     clean; no golden can move. Same rationale as `faa756b`.
  3. **Re-derived the geometry table before writing that comment**, from
     `createWorld(seed 15, 8-slot cast)` + `waveRadiusFraction` / `RESOURCE_FIELD`
     / `ASTEROID`, rather than copying it out of this note. **It reproduces to the
     digit** — 3.66× oversubscribed at wave 5, `freeEye` 19.3 u against
     `SHIP_RADIUS` 16, `spokeClear` 21.2 u against `needSpokeClear` 62,
     `rMinPassable` 276. Third independent derivation, same answer. **The geometry
     is settled — stop re-deriving it.**
  - **Full suite re-run after the merge: `1 failed | 5541 passed (5542)`,
    `1 failed | 299 passed (300)` files, 673 s.** The one failure is `unstuck`
    seed 15, `foreman` slot 2, **133.5 s at (1204,1195)** — identical to sessions
    three, four and five. `tsc --noEmit` exits 0. Both remote DoD greps pass
    against `FETCH_HEAD`.
  - **Escalated once, deliberately.** PR #436 had **zero comments and zero reviews**
    after five sessions. The whole analysis lives in the PR *body*, and editing a
    body notifies nobody. Posted exactly one short comment naming the two options.
    Did not repost the analysis — it is already in the body and in
    `docs/wave-commons-entombment.md`.
  - **Trap for the next session, found the hard way:** `/status/notes/…` and the
    repo's `status/notes/…` are **two separate files, not a symlink**, and
    `/status`'s copy was a session stale (missing the fifth session's entries).
    Editing `/status` and copying it over the repo copy silently deleted committed
    history. **Edit the repo copy, then `cp` it to `/status` — never the reverse
    without diffing first.**

- **2026-08-16, seventh session — what this one actually did.** One new finding,
  committed; everything else was re-verification that found no drift.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `42392ac` at
    start, `main` still `221a2b1` and **0 commits ahead of this branch** (the sixth
    session's merge still current), `tsc --noEmit` exits 0, constant is `1`,
    `drops the whole hold` present at `damage.test.ts:83`, both remote DoD greps
    pass against `FETCH_HEAD`. PR #436 still open, still **no Director ruling** —
    the sixth session's escalation comment is the only comment and has no reply.
    Did **not** re-measure the wedge or re-derive the geometry: three independent
    derivations agree and the note says stop. Did not escalate a second time —
    one unanswered ping is a signal, two is noise.
  - **`742d12c` docs(a0-59) — the new finding. The DoD's half-drop sweep is
    scoped to `src/sim/` and `docs/`, and both are clean; widening it past that
    scope found four stale comments that six sessions had missed**, all in files
    this lane may not edit: `src/bots/hard.ts:214`, `src/net/transport.ts:661`,
    `src/net/ore-authority.test.ts:452` and `:469`, `src/main.ts:4555`. Each still
    says a dead ship burns half its hold. **None fails CI** — the `ore-authority`
    one is a test whose *assertions* still pass (`loose > 0`, residual conserved)
    while its *comments* lie — which is exactly why they survived, and exactly the
    hazard the amendment exists to prevent: prose arguing, in-repo, for putting
    the 0.5 back. Recorded in `docs/design-amendments.md` with the site, the quote
    and the owner for each. **Docs only; no code, no constant, no golden.**
  - **Left them unedited on purpose.** `src/bots/`, `src/net/` and the app shell
    are not this lane's. The line: the determinism goldens were *failing tests* a
    sim rule change necessarily moved, which justified reaching across a boundary
    in flagged commits; a stale comment is not. Flag, do not fix.
  - **Two things found while checking them, useful to whoever fixes them.**
    (a) `hard.ts`'s retreat rationale **survives and strengthens** under a0-59 —
    it breaks off at 20% hull because dying costs the hold, and the hold now lands
    whole in front of the killer. Comment needs one word; behaviour needs no
    review. (b) **`transport.ts`'s "half its hold lost" was already wrong before
    a0-59.** `killShip` sets `ship.cargo = 0` *unconditionally*, so a death has
    always cost the pilot the entire hold — the fraction only ever governed how
    much came back as field chunks. The divergent-death drift that passage
    documents is a bigger accounting hole than it claims, on both builds.

- **2026-08-16, eighth session — what this one actually did.** One new finding,
  committed; the blocker is untouched and unchanged.
  - **Re-verified from scratch, trusting nothing in this note:** local `HEAD` ==
    `origin/…` == `b250ff2` at start, `main` still `221a2b1` and **0 commits ahead**
    (the sixth session's merge still current), `tsc --noEmit` exits 0, the constant
    is `1` at `constants.ts:1032`, `drops the whole hold` present at
    `damage.test.ts:83` and exact (N = 1..9, `toBe`, `deathLoss === 0`), both remote
    DoD greps pass against `FETCH_HEAD`. Pulled CI's own log for `b250ff2`:
    **1 failed | 5541 passed (5542)**, the single failure `unstuck` seed 15,
    `foreman` slot 2, **133.5 s at (1204,1195)** — byte-identical to sessions three
    through six. PR #436 still open, still **no Director ruling**; the sixth
    session's escalation comment is still the only comment and still has no reply.
  - **Did NOT re-measure the wedge or re-derive the geometry.** Three independent
    derivations agree and the note says stop. Did not escalate a second time —
    the seventh session's reasoning holds: one unanswered ping is a signal, two is
    noise. The new finding below is not about the blocker, so it went into the PR
    **body**, not a comment.
  - **`6e19eea` docs(a0-59) — the new finding. The sweep was NOT clean in this
    lane's own scope, and had been recorded as clean since the second session.**
    Two sites still asserted the half-drop:
    1. **`docs/gdd-conformance.md`, the §2.7 table** — *"Half the held ore drops
       where you exploded"*, verdict **SHIPPED**, evidence `constants.ts:981`. The
       **§2.3** row two tables up was corrected in `586f479` and GDD §2.7's own
       prose was amended with it; only this row was left behind. Its line reference
       was stale as well (`:981` → `:1032`).
    2. **`content/codex/codex-systems.json`, `sys-collection-field`** — *"…risk
       hauling a fat hold through contested space where a death spills **half** of
       it."* `586f479` corrected `sys-death-debris`, the entry *about* death, and
       its pinned numeric fact; this sentence is in the entry about **banking**.
       Player-facing copy, and now simply untrue.
  - **Why both survived seven sessions, which is the transferable part.** Every
    prior sweep was anchored on the identifier — `grep DEATH_ORE_DROP_FRACTION`,
    which finds nothing here because **neither site names the constant**. Both say
    "half" in prose about a *different* subject (a conformance verdict; a banking
    tip), so a topic-anchored search misses them too. **A constant sweep has to be
    run twice: once on the identifier, once on the English.** The grep that finally
    caught them: `grep -rniE "drops? (half|all)|half (the|its|your) (held )?(hold|
    ore)|whole hold|entire hold" docs/ content/ GDD.md` with the known-good
    amendment lines filtered out, then eyeballing every remaining `half` in
    `src/sim/ docs/ content/ GDD.md tests/` (about 30 hits, all unrelated geometry
    half-widths and "the other half of the answer" idioms — the scope is now
    genuinely clean, checked line by line rather than asserted).
  - **The conformance row is the more serious of the two by some way**, and worth
    naming as a class. It is not a stale comment — it is a **conformance table
    certifying, as SHIPPED, a behaviour the shipped code does not have**, in the
    one document a future agent opens to ask "what does this build actually do?"
    That is not a failure to record the ruling; it is affirmative in-repo evidence
    *for reverting it*, which is exactly the hazard the brief names ("a constant
    that silently contradicts the design doc is how the next agent restores it").
    The four flagged out-of-lane comments are a weaker version of the same thing.
  - `docs/design-amendments.md`'s sweep section now **records both rather than
    quietly absorbing them** — the paragraph that opened *"the sweep is clean in
    `src/sim/` and `docs/`"* was false and is corrected in place, with the failure
    mode written down so the next sweep of any constant looks for the prose too.
  - **No code, no constant, no golden.** `tsc` clean; codex, damage, ore-ledger,
    match, loot-tell and loot-ore-parity green (130 tests). `src/ui/codex.test.ts`
    checked specifically (41 tests) because the codex edit is content the UI
    renders — no test and no Playwright golden pins codex body prose. **Full local
    suite after the commit: `1 failed | 5541 passed (5542)`, 658 s** — the one
    failure is the standing `unstuck` seed 15. **CI on `9786f7b` agrees exactly:
    `1 failed | 5541 passed (5542)`, same single test.** Nothing this session
    touched moved a number.
  - **Independently re-verified the fact the Director's decision rests on**, since
    it is asserted all over this note and had never been checked mechanically:
    *the branch's entire behavioural sim delta against `main` is the one constant.*
    Seven non-test sim files differ (`match.ts`, `state.ts`, `step.ts`,
    `ore-ledger.ts`, `waves.ts`, `damage.ts`, `constants.ts`), and filtering their
    diff of comment lines and blank lines leaves **exactly two lines in the whole
    branch**:

    ```
    $ for f in src/sim/{match,state,step,ore-ledger,waves,damage,constants}.ts; do
        git diff origin/main...HEAD -U0 -- "$f" | grep -E '^[+-]' \
          | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(\*|//|/\*)' | grep -vE '^[+-]\s*$'
      done
    -export const DEATH_ORE_DROP_FRACTION: Tunable<number> = 0.5;
    +export const DEATH_ORE_DROP_FRACTION: Tunable<number> = 1;
    ```

    That is the whole of it. Every other sim change on this branch — including the
    three comment-only commits `faa756b`, `3855f6c` and the `waves.ts` corridor
    correction — is provably prose. **Re-run this one-liner instead of re-reading
    the note** if a future session doubts the A/B; it takes a second and it settles
    the "is a0-59 safe" half of the question outright, leaving only "who fixes the
    wave trap, and when".

- **2026-08-16, ninth session — what this one actually did.** One new finding,
  committed as **`b7edd1c`**; the blocker is untouched and unchanged.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `4e4c33d` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` present at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    still open, `mergeStateStatus` UNSTABLE, **still no Director ruling** — the
    sixth session's escalation comment is still the only comment and still has no
    reply. **Did not escalate again** (a third ping is noise) and did **not**
    re-measure the wedge or re-derive the geometry — three derivations agree.
  - **`b7edd1c` — the finding: a fifth lane nobody had swept, `src/progression/`.**
    The sweep went `src/sim/` → `docs/` → `content/` → (seventh session)
    `src/bots/`, `src/net/`, `src/main.ts`. It never reached `src/progression/`,
    which is neither this lane's nor in the flagged set. Three sites there:
    `accrual.ts:109` and `:454` (doc/inline comments), and — worst —
    `accrual.test.ts:287`, a test **named** *"does not read the half-hold sink at a
    death as ore spent"* with an inline *"half dropped, half destroyed with the
    hull"*. Verified all **15 of its tests pass**: the rule it pins (`oreUsed`
    counts a hold+bank drop only while hull *and* home live, so a death is
    excluded) is fraction-independent and correct on both builds. Only the naming
    is stale — but a stale **test name** reads as a specification, which is the
    strongest form of the hazard the amendment exists to prevent.
  - **Flagged, not edited** — `src/progression/accrual.test.ts`'s own header says
    OWNER: UI Engineer. Same line as the seventh session's four sites. **Fixed the
    two that are in this brief's stated sweep scope** (`docs/`):
    `docs/briefs/pr-04-accrual-and-xp.md:76` (brief test 5) and
    `docs/briefs/pr-02-attribution-hook.md:93`.
  - **Two more found by the same widening, also flagged:**
    `spikes/progression/measure-ratified-xp.ts:303` (the spike `accrual.ts` was
    derived from, same "half-hold sink" phrasing) and
    `evidence/images/boards/index.json` scene 9's caption — *"But **half your
    hold** is now loose in space for anyone"*, an **art review board** describing
    the mechanic (a2-08, Art's file). **Nine stale sites now exist in total across
    six lanes** — bots, net, app shell, progression, spikes, art — all tabled in
    `docs/design-amendments.md`, none of them a failing test or a behaviour bug.
  - **The sweep is now CLOSED on all three axes**, and says so in the amendment:
    identifier, English prose, and numeric forms (`50%`, `one-half`, `halved`,
    `0.5 of the hold` — all clean), run over the **whole repo**. A tenth session
    should not need to sweep again; if it does, the recipe is in the amendment.
  - **How it was found, which is the transferable part again.** The eighth session
    learned "sweep the English, not just the identifier". This one adds the other
    axis: **sweep every directory, not just the ones the DoD names.** The grep that
    caught it was `grep -rniE '(half[- ]?hold|hold[- ]?half|ore sink|half[- ]?burn)'`
    over **`src/` whole**, not `src/sim/`. Also swept numeric forms (`50%`,
    `one-half`, `halved`, `0.5 of the hold`) — those came back clean, so that axis
    is now closed too.
  - **The consequence nobody had named — measured, not reasoned.** `oreMined` is
    Σ positive Δ`cargo` and counts scavenged ore alike ("ore is ore", GDD §2.7,
    `accrual.ts:100`) — deliberate, not a0-59's doing. But the credit for one
    minted unit is the series **`1/(1−f)`**: at `f = 0.5` it converged to a hard
    **2.0× ceiling** however often the ore changed hands; at `f = 1` there is **no
    decay**, so each death→scavenge cycle adds a full `1.0×` and the total is
    `1 + k` in cycles — bounded by match length and hold size, not by ore minted.
    Probed end-to-end with the real sim and the real tractor (mint 2, kill, fly a
    second ship onto the drop): **2 minted, 2 dropped, 2 scavenged, 4 credited —
    2.0× for a single cycle.** The scratch probe was deleted, not committed.
    **The ore ledger is untouched and the field still conserves exactly on both
    builds** — it is the progression *metric* on top that loses its bound. Not an
    action item (p1-04's XP weights are not shipped balance); it is for the balance
    crew before they tune ore-mined XP, because a kill-and-rescavenge loop is now a
    repeatable lossless XP source and at 0.5 it provably was not.
  - **No code, no constant, no golden.** `tsc --noEmit` exits 0; **110 tests green**
    across `src/progression`, `damage`, `ore-ledger`, `match`. Checked that no test
    pins the content of the two edited briefs (the files that mention them cite
    them in comments only).

- **2026-08-16, tenth session — what this one actually did.** One new finding,
  committed as **`6c34929`**, and it is the one that closes the lane's side of the
  blocker.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `8222a18` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, `mergeStateStatus` UNSTABLE, **still no Director ruling** — the sixth
    session's escalation comment is still the only comment, still no reply. Did not
    escalate a fourth time. Did **not** re-derive the wave geometry (three
    derivations agree; the note says stop).
    *Gotcha worth keeping:* `git fetch -q origin main` **overwrites `FETCH_HEAD`**,
    so running it between the two DoD greps makes them fail against `main`. Fetch
    the branch immediately before each grep, as the DoD lines themselves do.
  - **`6c34929` sim(a0-59) — COMMENT-ONLY. The finding: the sim carries a ratified
    anti-wedge mechanic that ten sessions of this note never mentioned, and it is
    in THIS lane.** `WEDGE_SLIDE_SPEED` / `WEDGE_SLIDE_KICK` / `WEDGE_SLIDE_RUN_S` /
    `WEDGE_CONTACT_S` (`constants.ts`) and `updateWedgeEscape` (`step.ts`), from
    developer report p14 — "no ship stays wedged against anything", made in the
    collision response for every ship and every body. Its doc-comment promised a
    ship **"can never *stay* pinned, whatever heading its pilot keeps asking for"**.
    That is a lane-owned knob with a standing guarantee, sitting directly on top of
    the standing failure, and the honest question was whether the blocker was a
    one-constant tune after all.
  - **It is not. Measured over the 12600 ticks of the seed-15 wedge** (slot 2,
    t = 600–810), reading `Ship.wedgeContactS` / `Ship.wedgeSlide` off the live
    world with a scratch probe (run, read, **deleted — not committed**):

    | measure | value |
    |---|---|
    | ticks in contact with rock | 12599 / 12600 |
    | ticks armed and sliding | **12402 (98.4%)** |
    | distinct slide directions | **4 — the whole quarter-turn search, cycling** |
    | mean hull speed | **68.7 u/s** |
    | clearance to nearest rock surface | −2.6 u … **+5.5 u**, vs `SHIP_RADIUS` 16 |

    Three consequences. The hull is **not motionless** — it is at cruise for the
    full 133.5 s, which is exactly why the gate measures *displacement* and not
    speed, and it retires the intuition that a wedged ship is a stopped ship. The
    hatch is **not failing to fire**; it runs its complete bounded search — tangent,
    outward along the normal, other tangent, inward — over and over, as designed.
    And it **cannot succeed**: max clearance 5.5 u for a 16 u hull means no
    direction has an exit, so a bigger `WEDGE_SLIDE_KICK` or longer
    `WEDGE_SLIDE_RUN_S` only reaches the wall sooner.
  - **The distinction to carry forward: the hatch beats *pinning* (one body, open
    space behind); it cannot beat *enclosure*. Its search is over directions — it
    cannot make space.** Struck the false guarantee from `constants.ts` and
    `step.ts` and wrote the measurement into `docs/wave-commons-entombment.md`,
    because the in-file promise was itself the argument for spending a session on
    the knob — the same failure mode as the corridor guarantees corrected in
    `faa756b` and `3855f6c`, and now the third instance of it in this lane.
  - **With this, every knob inside the gameplay lane is measured and exhausted:**
    placement (arithmetic — 3.66× oversubscribed), `commonsHoleFraction` (at its
    ceiling, and never the right knob), `commonsSpokeGap` (angular, clamped), and
    the p14 escape hatch (firing, saturated, no exit). **There is nothing left in
    this lane to try.** That is a strictly stronger statement than previous sessions
    could make — they had ruled out placement; this one rules out the mechanic whose
    stated job was to catch precisely this. The remaining candidates are all design
    rulings, unchanged.
  - **No code, no constant, no golden.** `git diff -U0` over both sim files,
    filtered of comment and blank lines, is **empty**; `tsc --noEmit` exits 0;
    damage / ore-ledger / match / loot-tell green (51 tests).

- **2026-08-16, eleventh session — what this one actually did.** One new finding,
  committed as **`92e788c`**. The shipped work is untouched and the blocker is
  unchanged.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `e97756d` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, `mergeStateStatus` UNSTABLE, **still no Director ruling** — the sixth
    session's comment is still the only one and still has no reply. Pulled the
    check list: the *only* `fail` bucket is `Typecheck, test, build`; the perf
    gate and the Playwright shards that have reported are green. Did **not**
    re-derive the geometry or re-measure the wedge (four derivations agree now,
    counting the doc's own), and did **not** escalate again on the PR.
  - **`92e788c` — the finding: the defect report was unlinked from the gap
    register.** `docs/wave-commons-entombment.md` had exactly two inbound
    references in the whole repo, both sim doc-comments (`waves.ts:392`,
    `constants.ts:611`/`:1440`). It was absent from **`docs/gdd-conformance.md`**,
    which is the repo's authoritative "what does the build actually deliver"
    report — a ranked gap list, a milestone table, a per-section claim audit and
    a **§7 QUESTIONS FOR THE DEVELOPER** queue. A live, measured,
    player-affecting defect on `main` was in none of it.
  - **Two edits, both minimal.** (a) §2.3's row *"Five timed waves, each closer to
    centre; after the last, collapse"* read as an unqualified **SHIPPED**. It now
    carries the defect and the pointer. **Verdict deliberately left SHIPPED** —
    the waves do land, each closer, and collapse does follow, so this is *not* a
    gap against §2.3's claim, and regrading it PARTIAL would be its own error and
    would break the section's `9 claims: 9 SHIPPED` count. The row says why it is
    graded that way. (b) **Q-6** added to §7, stating both halves of the ask:
    which of the three costed fixes, and does a0-59 wait for it. Also amended §7's
    preamble, which promised *"a decision, not a bug"*, to name Q-6 as the
    deliberate exception rather than silently contradict itself. Added a
    **Where the decision is queued** line to the entombment doc so the two are
    mutually discoverable.
  - **Why this and not another ping.** The reasoning sessions 7–10 used to decline
    re-escalating still holds — a second unanswered comment is noise. But it left
    a gap nobody had named: the analysis lived in a **PR body** (dies with the PR,
    notifies nobody when edited), one **PR comment** (notifies once, already
    spent), and an **unlinked doc**. §7 is a standing, named, Director-facing
    queue that already contains four open questions in exactly this shape, and it
    outlives PR #436 either way. That is a channel, not a repetition.
  - **Every figure in Q-6 was cross-checked against the committed report**, not
    retyped from this note — 3.66×, 1632 u on 446 u, `R ≥ 276`, 19.3 u pocket,
    5.5 u max clearance, 98.4%, 68.7 u/s, seeds 142/146/147 vs 15/142, ~1.25%.
    All present and matching in `docs/wave-commons-entombment.md`. *(Watch one
    coincidence: `68.7` is both the mean hull speed and wave 2's `eye` column.)*
  - **The transferable lesson, continuing the sweep series.** Sessions 8 and 9
    learned *sweep the English, not just the identifier* and *sweep every
    directory, not just the ones the DoD names*. This one adds the third:
    **a finding is not delivered until it is linked from where people look.**
    Writing the standalone report (fifth session) was necessary and not
    sufficient — for six sessions it sat in a directory of fifty files with no
    inbound link from any index, which is functionally the same as the PR body it
    was rescued from.
  - **No code, no constant, no test, no golden.** `git diff --numstat` is
    `docs/gdd-conformance.md` alone for the commit; `tsc --noEmit` exits 0. No
    test pins either edited section (`tests/codex/tone-mirror.test.ts` and the
    perf gates cite G-4/G-5/T-4 in comments only, none of which moved).

- **2026-08-16, twelfth session — what this one actually did.** One new finding,
  committed as **`a50a300`**. The shipped work is untouched and the blocker is
  unchanged.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `9dced54` at
    start, `main` still `221a2b1` and **0 commits ahead** (so the sixth session's
    merge is still current and the A/B is not stale), `tsc --noEmit` exits 0, the
    constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE, **still no Director ruling** — the sixth session's comment is
    still the only one, still no reply. Did not escalate again. Re-ran the
    one-liner from the eighth session: the whole behavioural sim delta is still
    **exactly the one constant line**.
  - Ran `unstuck` locally: still seed 15, `foreman` slot 2, **133.5 s at
    (1204,1195)**. CI's log was unavailable this session (`gh` refuses logs while
    the run is `in_progress`), so the local run is the evidence — identical to
    sessions three through eleven. The *only* `fail` bucket on the PR is
    `Typecheck, test, build`; perf gate and the reported Playwright shards pass.
  - **`a50a300` — the finding: the decisive A/B had been measured exactly once,
    and never independently confirmed.** Everything the Director is being asked to
    rule on reduces to one claim — *`main` carries the entombment defect and a0-59
    does not worsen it* — and that claim rested entirely on the third session's
    200-seed sweep. The third session also records that the table it *replaced*
    was wrong, so a single unconfirmed measurement was the weakest link in the
    whole argument. **Confirmed it, and cheaply:** the claim is about *which named
    seeds wedge on which build*, which is four matches per arm, not two hundred.
    Copied `worstWedge` verbatim, ran seeds 15/142/146/147 at both values of the
    constant. **Every figure reproduces to the tenth of a second and the unit of
    position** — 0.5: 142 (40.9 s), 146 (58.8 s), 147 (95.9 s), 15 clean; 1: 15
    (133.5 s), 142 (12.3 s), 146/147 clean. The sweep is now corroborated rather
    than merely asserted.
  - **The new observation, which is the part worth keeping.** The *behaviours*
    differ across the two arms — `haul` vs `defend`, `last-stand`, `fix-base` —
    while the *positions* do not (every wedge at or beside 1200,1200). **The trap
    is indifferent to what the ship was trying to do.** It catches whatever is at
    the centre when wave 5 lands, regardless of intent. That is the cleanest
    single piece of evidence that this is map geometry and not bot logic, and it
    is stronger than the geometry derivation because it needs no arithmetic to
    read. Written into the report.
  - **Also recorded a trap that cost time:** vitest's `include` is
    `tests/**/*.test.ts, src/**/*.test.ts`, so a scratch probe at the repo root is
    **silently reported as "No test files found"** rather than as an error. Put
    scratch probes under `tests/harness/`.
  - **The 0.5 arm needs a real edit** — `Tunable<T> = T`, so the constant is a
    plain `const` and cannot be overridden at runtime. Flip it, measure, flip it
    back; `git diff` over `src/` must return empty afterwards (it does — that
    empty diff is itself the proof the restore was exact, and is worth checking
    rather than assuming).
  - **No code, no constant, no test, no golden.** `git diff --numstat` for the
    commit is `docs/wave-commons-entombment.md` alone; `tsc --noEmit` exits 0;
    damage / ore-ledger / match / loot-tell green (51 tests). The scratch probe
    was deleted, not committed.
  - **What a thirteenth session should NOT do.** The A/B is now measured twice
    independently and agrees; the geometry is derived four times and agrees; the
    sweep is closed on all three axes and every in-lane knob is exhausted. There
    is no measurement left that would change the ask. **The only thing still
    missing is the ruling itself**, and it is queued in three places (PR #436 body,
    one PR comment, `docs/gdd-conformance.md` §7 Q-6). Re-verify, do not re-measure.

- **2026-08-16, thirteenth session — what this one actually did.** One new
  finding, committed as **`5081dab`**, and it is a *hazard* rather than another
  measurement of the same thing. The shipped work is untouched.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `3601c43` at
    start, `main` still `221a2b1`, `tsc --noEmit` exits 0, the constant is `1`,
    `drops the whole hold` present, both remote DoD greps pass against
    `FETCH_HEAD`. PR #436 open, UNSTABLE, **still no Director ruling** — the
    sixth session's comment is still the only one, still no reply. Re-ran the
    eighth session's one-liner: the whole behavioural sim delta is still **exactly
    the one constant line**. The only `fail` bucket is `Typecheck, test, build`.
    Did not escalate again.
  - **Checked one channel nobody had, and closed it: the repo has ZERO GitHub
    issues**, open or closed. The issue tracker is not a convention this project
    uses, so filing the wave trap there would invent one rather than reach anyone.
    Q-6 remains the right queue. *A fourteenth session need not re-check this.*
  - **`5081dab` — the finding: the "obvious" in-lane fix is a gate mask.** The
    defect report has flagged the commons eye-by-**centre** bug since the fourth
    session as *"the same class of mistake, worth folding in"*, and reasoned that
    correcting it *"does not open a corridor"*. That was right and badly
    understated. **Measured, both arms** — `innerRadius + ASTEROID.maxRadius`:

    | build | free pocket (seed 15) | escape bearings blocked | `unstuck` seed 15 |
    |---|---|---|---|
    | shipped | 21.6 u | **360/360** | **133.5 s — RED** |
    | eye by body | 42.1 u | **360/360** | **2.7 s — GREEN** |

    The ring is **100% sealed on both builds**; the correction opens **zero**
    exits. It doubles the pocket, which lifts the hull's roaming radius above
    `unstuck.test.ts:107`'s `WEDGE_R = 8` **re-anchor** threshold — so the gate
    stops accumulating held time. **PR #436's only red check goes green while the
    player stays entombed in a bigger cell.** Worst wedge on all four decisive
    seeds falls to 2.4–2.7 s, under the file's own transient canary too.
  - **Why this mattered enough to break the "do not re-measure" rule.** It is not
    a re-measurement — it is the first measurement of a *candidate fix*, and it is
    the edit anyone would reach for first: it is one term, it corrects a real
    inconsistency with `pocketOuterR` 90 lines up, it is in this lane, and it
    turns the PR green. A future session would have made it for the right reason
    and shipped a change that **deletes the only instrument detecting a live
    player-affecting defect**. Warned at the point of edit in `src/sim/waves.ts`,
    in the defect report, and in Q-6.
  - **The transferable lesson, continuing the series.** Sessions 8/9/11 learned
    *sweep the English*, *sweep every directory*, *link the finding where people
    look*. This one adds: **a gate's threshold is a definition, not a detector.**
    `WEDGE_R = 8` does not measure confinement — it measures confinement *tighter
    than 8 u*. Anything that enlarges the cell past the threshold reads as a fix.
    Before proposing a change that turns a red gate green, measure the *defect*
    independently of the gate, or you cannot tell repair from erasure.
  - **Method worth reusing.** Measure solidity off the **field**, never off a
    ship: changing geometry re-rolls the match (under the correction slot 2 is
    137 u from centre when wave 5 lands, never trapped at all), so ship-tracking
    silently compares two different matches and answers nothing. Ray-cast 360
    bearings from centre, requiring perpendicular clearance
    `> rock.radius + SHIP_RADIUS` against every rock out to 300 u. The probe
    reproduces the known **21.6 u** pocket at seed 15, which is what validates it.
    *(This ray-cast is stricter than the 232–304/360 figures in the incidence
    table — whole-path against the cumulative 81-rock field, not wave 5's ring
    alone. Both say sealed; only this one says completely. Not a contradiction,
    and it is written down as such in the report.)*
  - **No value moves.** `git diff -U0 -- src/` filtered of comment and blank lines
    is **empty**; `tsc --noEmit` exits 0; damage / ore-ledger / match / loot-tell
    green (51 tests). All four scratch probes deleted, not committed, and
    `git diff -- src/` verified empty after **each** arm — that empty diff is the
    proof the restore was exact and is worth checking rather than assuming.
  - **What a fourteenth session should NOT do.** Everything in the twelfth
    session's list still holds, plus: do not re-measure the eye-by-body arm (done,
    both arms, recorded), and do not re-check the issue tracker. **The only thing
    still missing is the ruling.**

## BLOCKERS

*(Still current as of the THIRTEENTH session, 2026-08-16. Unchanged in substance
since the third; re-confirmed each session since. **One hazard added by the
thirteenth session: the tidiest-looking in-lane fix — reserving the commons eye by
rock body — turns this PR's only red check GREEN while leaving the ring 360/360
sealed. Do not mistake it for a repair; see `5081dab`.** The ask is now also queued as
**Q-6** in `docs/gdd-conformance.md` §7, which outlives PR #436. The A/B beneath
it is no longer a single measurement — the twelfth session reproduced both arms
from scratch on the four decisive seeds and every figure matched exactly.)*

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

**The tenth session closes the last in-lane avenue** (`6c34929`): the sim's own
ratified anti-wedge mechanic — the p14 escape hatch, whose stated job is that no
ship ever stays wedged — **fires on 98.4% of the wedge's ticks, cycles its entire
four-direction search, moves the hull at 68.7 u/s, and still cannot get out**,
because the pocket's widest clearance is 5.5 u for a 16 u hull. It defeats pinning
against a surface; it cannot defeat enclosure. Every knob in this lane is now
measured and exhausted — placement, `commonsHoleFraction`, `commonsSpokeGap`, the
hatch. **Nothing remains that is not a design ruling**, which is the same ask as
before, now with no unexplored alternative left standing behind it.

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

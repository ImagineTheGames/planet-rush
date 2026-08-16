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

- `cda7e82` **docs(a0-59)** — **the brief's own headline claim measured, and it was
  wrong by 2.4×.** "Every kill now returns twice the ore to the field" was an
  estimate, repeated into `GDD.md` twice, `constants.ts` and the amendment. Measured
  on 24 full matches on both real builds: **a kill returns 4.8× more ore**, the
  shipped half-drop returned only **30.3 %** of a dead hold, and the withdrawn sink
  **migrated to `spent`** rather than vanishing. Corrected in `GDD.md` (§2.3 prose +
  §2.8 row), `docs/design-amendments.md`, `docs/gdd-conformance.md` §2.8 and the
  `DEATH_ORE_DROP_FRACTION` doc-comment. `constants.ts` is **comment-only**. See the
  seventeenth session in NEXT.

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

- `0970edb` **test(a0-59)** — `src/sim/waves.test.ts`, the first test file
  `waves.ts` has ever had. Flood-fills free configuration space from the map
  centre to ask whether a route out exists at all. Pins: escapable through wave 3,
  **sealed at waves 4 and 5** (seeds 1/15/42). Runs in 1.9 s. It is the one
  instrument the eye-by-body gate mask cannot fool — verified by applying that
  edit and watching this stay sealed while `unstuck` goes green. New test file
  only; **no sim code, no constant, no golden.**
- `633a862` **docs(a0-59)** — the onset/incidence/severity corrections that test
  produced, into `docs/wave-commons-entombment.md`, `docs/gdd-conformance.md`
  (Q-6 and the §2.3 row) and a **comment-only** block in `src/sim/waves.ts`.
  Headline: the seal closes at **wave 4** (9/9 seeds) and catches a ship on
  **16 of 24 seeds**, against the `~1.25%` that was really the wedge gate's
  detection rate — but 18 of 24 caught ships mine out within 30–120 s, so
  *"entombed for the rest of the match"* was too strong and is corrected too.
  **No value moves.**

- `4e4907c` **test(a0-59)** — `src/sim/damage.test.ts`, *'the sink is armed by the
  fraction alone — `CHUNK.ore` cannot re-arm it'*. The DoD's REASON for keeping
  `deathLoss` — "a ledger with no sink cannot stay conserved when one reappears" —
  measured for the first time in nineteen sessions, and the trigger it names is
  wrong. Asserts the cancellation across chunk sizes 1–4, so it survives a fraction
  tune (verified at 0.5). See the nineteenth session in NEXT.
- `8eb0c43` **docs(a0-59)** — the measurement, and the five stale copies of the
  wrong claim: `src/sim/damage.ts` (×2), `constants.ts`, `ore-ledger.ts`,
  `GDD.md` §2.3, `docs/design-amendments.md`, `docs/gdd-conformance.md` §2.8.
  **All three sim files comment-only.** No value moves.

- `ac91b61` **test(a0-59)** — `src/sim/upgrades.test.ts`, *'a hold ceiling only ever
  rises'*. The `cargo > cargoCap` clamp in `refreshDerivedStats` /
  `applyPurchasedStats` is **the one ore-destroying path in `src/sim/` that writes
  no ledger bucket** (measured: cap 8 → 3 destroys 5 ore, `oreResidual` −5, all four
  sinks still 0). It has never fired — a cap cannot fall within a match — so an
  *unwritten* invariant was holding an *unaccounted* sink shut. This pins it, and is
  verified to go red when the ladder is shortened. See the twentieth session in NEXT.
- `9e64251` **docs(a0-59)** — the DoD's second `deathLoss` flow, *"ore lost out of
  bounds"*, **is not a mechanic this sim has**; corrected at the one site it reached
  (`damage.test.ts`). Plus the clamp audit into `src/sim/upgrades.ts`,
  `docs/design-amendments.md` and `docs/gdd-conformance.md` §2.8. **Both sim files
  comment-only.** No value moves.

**Verified green, not re-done, on 2026-08-16 (third session):** `npx tsc --noEmit`
exits 0; the constant is `1`; `drops the whole hold` is present and exact; CI's own
log for `96bfe7e` reads **299 of 300 test files passed**, the single failure being
`tests/harness/unstuck.test.ts` at seed 15. Both remote DoD greps pass against
`FETCH_HEAD`.

## DECISIONS

**Kept a0-58's whole-ore invariant, which this brief mostly dissolves.** At a
fraction of 1 the drop equals the hold and a whole hold divides into whole chunks
with nothing over, so the rounding subtracts zero today. It stays because
`DEATH_ORE_DROP_FRACTION` is TUNABLE and moving it off 1 re-mints the remainder in
one edit — **measured, nineteenth session: 283 of the 396 ore that died, at 0.5.**
LESSONS §26 — assert the relationship, not today's value. **Do not delete the
`pieces = Math.floor(...)` split because it currently rounds nothing.**

**CORRECTED, nineteenth session:** this decision used to say *"both
`DEATH_ORE_DROP_FRACTION` and `CHUNK.ore` are TUNABLE and either one moving off 1
re-mints the remainder"*. **`CHUNK.ore` does not** — holds are whole chunks by
a0-58's construction, so a whole-hold drop divides exactly at any chunk size
(0.00 burned across 2,358 deaths at chunk sizes 1, 2, 3). The guard rests on ONE
knob. What the chunk size does is scale the burn *once the fraction is off 1*.

**Kept `deathLoss`, now 0 for an ordinary death.** Explicitly required by the DoD.
It is the sink for anything undropped (quantisation leftover, ore lost out of
bounds) and `expectedLiveOre` subtracts it either way; a zero term costs nothing,
an absent term costs the conservation law. **The DoD's reason for this is now
measured rather than assumed** (nineteenth session): with the sink present the
ledger conserves in all six arms of a fraction × chunk-size sweep, residual
≤ 6.3e-13, while the sink itself carries a live 283-ore term at a fraction of 0.5.

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

**~~Flagged, not decided: the balance re-measure.~~ MEASURED, seventeenth session
(`cda7e82`).** §2.8's field-yield, abundance and collapse numbers were tuned with a
sink that no longer exists, and for sixteen sessions this note said measuring it was
QA's call. That was wrong on the cheap half: **the question "did §2.8's mint budget
move?" is 50 seconds of compute per arm**, not a QA programme, and the answer turns
out to be **no** — mining +4 %, total live ore −0.8 %, so `FIELD_YIELD` and the
a0-17 abundance spread stand. What DID move is throughput (a kill returns 4.8×, not
2×). Deferring it also left a *wrong* number in four places for sixteen sessions.
The genuinely QA-shaped part — the passive-match ceiling and mined-out floor at
non-default abundance multipliers — is still theirs, and is now flagged with an
expected movement rather than an open worry.

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

**Wrote a test that ASSERTS THE DEFECT, on purpose (`0970edb`, fourteenth
session).** `src/sim/waves.test.ts` expects the map centre to be sealed at waves 4
and 5. That is deliberate and the alternatives are worse. Asserting the *desired*
property (centre stays escapable) means committing a permanently-red test, which
CI teaches everyone to ignore. Asserting nothing leaves the situation as it was:
the only instrument that sees a live player-affecting defect is a Bot-lane wedge
gate that the tidiest in-lane edit switches off silently. A characterisation test
is the honest third option — it says "this is what the build does today", it goes
red exactly when someone changes it, and its failure message says in as many words
that red-in-that-direction is the fix landing and to update the report and Q-6
with it rather than repair the test. **Do not "fix" this test by flipping its
expectation without reading `docs/wave-commons-entombment.md` first.**

**Broke the standing "re-verify, do not re-measure" rule once, deliberately
(fourteenth session).** Sessions 12 and 13 both close by telling the next session
not to re-measure, and that was right for what they meant: re-confirming a settled
figure. It did not cover this. Every number in thirteen sessions was taken through
`unstuck`'s wedge probe, and the thirteenth session's own lesson was that a gate's
threshold is a definition rather than a detector — which nobody had then acted on.
Measuring *enclosure* instead of *wedging* was a first measurement, not a repeat,
and it moved the onset by a wave and the incidence by 16×. **The rule to carry
forward is narrower than "do not re-measure": do not re-run a measurement, but do
question what the existing measurements were actually of.**

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

- **2026-08-16, fourteenth session — what this one actually did.** Two commits,
  **`0970edb`** (a new test) and **`633a862`** (docs + a comment-only sim edit).
  The shipped a0-59 work is untouched; the blocker is unchanged in its ask but its
  numbers moved a lot.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `fb5563f` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE, **still no Director ruling** — the sixth session's comment is
    still the only one, still no reply. Did not escalate again. Re-ran the eighth
    session's one-liner: the whole behavioural sim delta is still **exactly the one
    constant line**. Ran `unstuck` locally: still seed 15, `foreman` slot 2,
    **133.5 s at (1204,1195)**, identical to sessions three through thirteen. CI's
    log was again unavailable (`gh` refuses logs while the run is `in_progress`),
    and there are now **two** failing check entries of the same name — two
    duplicate workflow runs of `Typecheck, test, build`, not a second failure.
  - **I broke the "do not re-measure" rule deliberately, and it was right to.**
    The rule is sound for re-confirming a settled number. This was not that: the
    thirteenth session's lesson was *"a gate's threshold is a definition, not a
    detector — measure the defect independently of the gate"*, and nobody had ever
    done that. Every number in thirteen sessions came through `unstuck`'s wedge
    probe. Measuring **enclosure** instead of **wedging** moved two headline
    figures and added a third.
  - **`0970edb` — `src/sim/waves.test.ts`, the first test `waves.ts` has ever
    had.** 475 lines of this lane's placement code; the only coverage was
    `match.test.ts` §4, which pins *containment* (each wave lands inside its own
    disc) and is silent on *passability* — which is where the defect is. The new
    file flood-fills free **configuration** space from the map centre and asks
    whether the component reaches past the field edge: a real "is there a route
    out", admitting any weaving path, where a ray-cast only answers for straight
    lines. Two characterisation tests, seeds 1/15/42, 1.9 s.
    **Verified it cannot be masked:** applying the eye-by-body edit — the one the
    thirteenth session measured turning seed 15 from 133.5 s RED to 2.7 s GREEN —
    leaves this test still reporting sealed on all three seeds. It asks whether
    the ship can get *out*, not whether it has room to move. `git diff -- src/`
    verified empty after the arm, as always.
  - **`633a862` — the numbers, and two of them were wrong in the same way.**
    1. **The seal closes at WAVE 4, not wave 5.** 9 of 9 seeds sealed at wave 4;
       0 of 9 at wave 3. Structural, not probabilistic. Wave 5 only shrinks the
       cell from 68–108 u across to **4–24 u**, which is the first point a
       *cell-size* detector can see it. For a whole wave an entombed ship flies
       around a roomy cell looking perfectly healthy. The report's own
       `t=570 wave 4 … free` trace, which has sat there since the second session,
       was the gate's verdict and not the ship's state — slot 2 was already sealed
       inside a 73 u cell at that instant.
    2. **Incidence is 16 of 24 seeds, not ~1.25%.** (28 of 46 ship-snapshots
       free-and-inside the commons at a late-wave landing; 24 of the 28 at wave 4.)
       The gate reds on **one** of those 24. So `~1.25%` was always the rate at
       which the defect *becomes visible to CI* and has been read for twelve
       sessions as the rate at which it happens. Retitled and fenced rather than
       deleted — it is still the correct number for "how often does this turn a
       build red", which is what it is used for.
    3. **Severity moves the OTHER way, and I reported it because it weakens my own
       case.** The ring is minable rock, so the seal is usually temporary: of the
       24 ships sealed at the wave-4 landing, **18 chewed out within 30–120 s**, 5
       died first, and 1 (seed 15) was still sealed at +240 s. *"Entombed for the
       rest of the match"* was too strong and is corrected everywhere it appeared,
       including my own text from earlier sessions. Net: **frequent,
       near-invisible and survivable** rather than rare and fatal.
  - **Two things nobody had seen.** A **second trap shape**: seed 17 slot 3 sealed
    into an *annular* pocket at 147–157 u, never near the centre — a centre-only
    fix misses it, and the oversubscription argument predicts it. And **re-entry is
    real**: seed 23 slot 2 escapes by +120 s and is sealed again by +240 s, which
    is candidate 3's known weakness made concrete rather than hypothetical.
  - **Candidate 3 re-costed, and it is no longer the cheap one.** It was sold as
    "fires only on the ~1.25% of seeds … so almost no golden moves". At the true
    incidence it must arm at **wave 4** and fires on **most matches**, displacing a
    ship each time — it moves goldens broadly and is a balance change in itself.
    Corrected in both the report and Q-6.
  - **A methodological trap worth keeping.** Respawned ships stand at their home
    station 768 u out, which any enclosure test reads as *free* — so counting
    "free" naively scores a **death as an escape** and inflates 18/24 to 21/24.
    Discount any ship that showed dead before it showed free. Likewise: a ship
    *overlapping* a rock is transient contact, not enclosure; 11 snapshots had to
    be excluded on that basis or the incidence reads 39 instead of 28.
  - **Where it all landed.** `docs/wave-commons-entombment.md` (onset, incidence,
    persistence, the two new observations, a repro section pointing at the 2-second
    test rather than the 200-seed sweep, and a fifth entry in the diagnostic
    history); `docs/gdd-conformance.md` **Q-6** and the §2.3 wave row;
    `src/sim/waves.ts` **comment-only** (`git diff -U0` filtered of comment and
    blank lines is empty, `tsc` clean, no value moves).
  - **The lesson, continuing the series.** Sessions 8/9/11/13 learned *sweep the
    English*, *sweep every directory*, *link the finding where people look*, and
    *a gate's threshold is a definition, not a detector*. This one is the direct
    consequence of the last: **all five wrong numbers in this defect's history came
    from reading an instrument's verdict as the thing itself** — centre-to-centre
    distance for hull clearance, adjacent-pair spacing for passability, a wedge
    threshold for entombment. Written into the report's diagnostic history so the
    sixth one is caught earlier.
  - **What a fifteenth session should NOT do.** Everything in the twelfth and
    thirteenth sessions' lists still holds. Do not re-measure enclosure — it is
    pinned by a committed 2-second test now, so run `npx vitest run
    src/sim/waves.test.ts` instead of re-deriving anything. **The only thing still
    missing is the ruling.**

- **2026-08-16, fifteenth session — what this one actually did.** One commit,
  **`a6aabf8`**, and it is the first session to measure the *fixes* rather than the
  defect. The shipped a0-59 work is untouched.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `14e85a2` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE; the only `fail` bucket is `Typecheck, test, build` (two
    duplicate workflow runs of it, not two failures). **Still no Director ruling**
    — there are now two comments, both mine (the sixth session's escalation and the
    fourteenth's numeric correction), zero reviews.
  - **Did not re-measure the wedge, the geometry, or enclosure.** Four derivations
    agree and `src/sim/waves.test.ts` pins enclosure in 1.9 s.
  - **Closed one more escalation channel, and it stays closed.** `/status/feedback.md`
    is the **Director → developer** relay queue ("Director appends; developer
    clears"), not a lane inbox — and its own entries show the established path for
    a lane's question is *PR body / doc → Director relays* (see its p8-05 and
    team-bots entries, which say so in as many words). Q-6 is therefore the correct
    queue and there is no unused channel. **A sixteenth session need not re-check
    this**, as it need not re-check the issue tracker (thirteenth session: zero
    issues, not a convention this repo uses).
  - **`a6aabf8` — the finding: every candidate fix had been costed by arithmetic
    and none had ever been RUN, and two of the three costings were wrong.** I now
    had an oracle the earlier sessions did not — `centreCanEscape` from the
    fourteenth session's test — so the candidates could be measured instead of
    argued. 9 seeds, waves 1–5, 8 players.
    1. **Candidate 1 (`WAVE.lastRadiusFraction`) is NOT a non-starter.** The fourth
       session's "needs ≈ 0.90, deletes the shrinking ring" was computed with rock
       size held at its shipped value. **The two knobs multiply** — required ring
       radius is proportional to total rock arc — so halving late-wave rock radius
       halves the ring radius needed. Measured: **`lastRadiusFraction = 0.50` +
       a 2× late-wave size cut opens the centre 9/9 at BOTH waves 4 and 5**, discs
       307 → 269 → 230 → 192 → 154 u. §2.3's ring is weakened, not deleted.
    2. **Candidate 2's preferred COUNT variant cannot work at all in a full
       lobby.** `sectorRocks = Math.max(1, …)` floors the wave at one rock per
       sector = 8 rocks at 8 players, whose arc is still **1.22×** the wave-5
       circumference before a ship corridor. Flood-filled: count ∝ ring → 9/9
       sealed at w5; count ×0.5 flat → 9/9 sealed. **That floor is the `N`-fold
       fairness symmetry, so it is not a floor anyone may lower.** Eleven sessions
       recommended this variant.
    3. **The ore-budget argument behind that preference does not discriminate.**
       Measured, *every* arm — count, size, both, ring width — delivers **exactly**
       400.00 field ore per seed, identical to baseline, because `drawCanon` scales
       ore to `waveOre` independently of radius and count. Ore-neutrality is a
       property of the spawner, not of the count knob.
    4. **Size alone works but needs a 6.7× cut** (`s ≈ 0.15`, max radius 46 → 7 u —
       smaller than the `CHUNK.radius` 6 ore it emits). Note `s = 0.25` is exactly
       *constant angular occupancy* and still leaves 4/9 sealed: **the hull is not
       scaled**, so as the ring shrinks 4× the corridor's share of circumference
       grows and the taper must be super-proportional.
    5. **A cheap partial exists:** a 2× size cut alone opens **wave 4 on 9/9** and
       leaves wave 5 sealed. Since 24 of 28 catches are at wave 4 — the wave where
       the trap is invisible — one knob in one direction removes most of the
       incidence.
  - **Also measured, and nobody had: lobby size.** Every number in fourteen
    sessions came off the 8-slot cast. Across 2–8 players, **wave 5 seals the
    centre 9/9 at every size** — `fieldRadius` is 307.2 throughout and the wave's
    rock budget does not scale with the count either. The **wave-4** onset *is*
    lobby-dependent (0/9 sealed at 2 players, 9/9 at 8), so the fourteenth
    session's "the seal closes at wave 4" is a full-lobby statement and is now
    fenced as one. **A solo-with-bots match is as sealed as a full eight.**
  - **No value moves.** `git diff -U0 -- src/` filtered of comment and blank lines
    is **empty**; `tsc --noEmit` exits 0; 53 sim tests green (`waves`, `damage`,
    `ore-ledger`, `match`, `loot-tell`). The probe was scratch under
    `tests/harness/` (vitest's `include` ignores the repo root — twelfth session's
    trap) and was **deleted**, with `git status -- src/ tests/` verified empty after
    each arm set.
  - **Method worth reusing:** none of this needed a constant edit. Rock size and
    `lastRadiusFraction` were varied by **mutating the constant objects at runtime**
    inside the probe (`as const` is compile-time only, not `Object.freeze`), and
    rock count by setting `world.asteroidsPerWave`, which `spawnWave` already takes
    as a parameter. That removes the flip-measure-flip-back risk the twelfth and
    thirteenth sessions ran, where an inexact restore would have been a live edit.
  - **The lesson, continuing the series.** Sessions 8/9/11/13/14 learned *sweep the
    English*, *sweep every directory*, *link the finding where people look*, *a
    gate's threshold is a definition not a detector*, and *do not read an
    instrument's verdict as the thing itself*. This one is the mirror of the last:
    **the same standard applies to the remedy, not just the defect.** Thirteen
    sessions measured the bug to four decimal places and left every proposed fix as
    arithmetic — including the one being actively recommended to the Director, which
    turned out to be impossible. If a recommendation is going to be acted on,
    measure it with the same instrument used to find the problem.
  - **Escalated once, on the same test the fourteenth session used:** would acting
    on the stale content waste work? Yes — briefing "cut the rock count" produces a
    fix that measurably cannot work. Posted one short correction comment naming the
    changed recommendation. Did not repost the analysis.
  - **What a sixteenth session should NOT do.** Everything in the twelfth,
    thirteenth and fourteenth lists still holds. Do not re-measure the candidate
    fixes — the tables are in `docs/wave-commons-entombment.md`
    (*Candidate fixes, measured*) and Q-6, and the oracle to re-run them with is a
    committed 2-second test. Do not check `/status/feedback.md` or the issue
    tracker again. **The only thing still missing is the ruling**, and it is now
    queued in four places with a measured menu attached.

- **2026-08-16, sixteenth session — what this one actually did.** One commit,
  **`966c1d9`**. The shipped a0-59 work is untouched and the blocker's *ask* is
  unchanged — but it is no longer a binary, and that is the finding.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `49e272a` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE, the only `fail` bucket is `Typecheck, test, build` (two
    duplicate workflow runs of it, not two failures). **Still no Director ruling**
    — three comments, all mine, zero reviews. Did not escalate a fourth time on
    the same ask; the new finding went into the PR **body**, the report and Q-6.
  - **Did not re-measure the wedge, the geometry, enclosure, or the candidate
    fixes.** All four are settled and pinned; sessions 12–15 say stop and they are
    right.
  - **`966c1d9` — the finding: sixteen sessions of measurement are coupled to a
    ruling that is not about them, and nobody had checked whether the coupling is
    real.** Everything this lane found about the wave trap — the defect report, the
    detector, Q-6 — lives on PR #436. If the ruling is *"hold a0-59"*, all of it is
    held too and the trap goes back to being invisible on `main`, where it is live
    right now. That is not a decision anyone made; it is an accident of where the
    work happened to be written.
  - **Measured, both directions.** *(a)* Flipped the constant to `main`'s `0.5` on
    this tree: `src/sim/waves.test.ts` passes **unchanged**, while
    `damage.test.ts` and `loot-tell.test.ts` fail — that is the line between the
    separable half and the a0-59-dependent half, drawn by measurement rather than
    by reading the diff. Constant restored; `git diff -- src/` verified **empty**.
    *(b)* Then against **actual `main`**, which removes the inference entirely: a
    detached worktree at `origin/main` (`221a2b1`), the four candidate files
    checked into it → `git diff -U0` over `waves.ts`/`step.ts` filtered of comments
    is **empty**, `tsc --noEmit` exits **0**, and **`npx vitest run src/sim` passes
    376/376** with `waves.test.ts` reporting the *identical* verdicts (escapable
    through wave 3, sealed at waves 4 and 5, seeds 1/15/42). Worktree removed with
    `git worktree remove`, never `git clean`.
  - **Separable:** `src/sim/waves.test.ts`, `docs/wave-commons-entombment.md`, the
    comment-only edits in `waves.ts` and `step.ts`, Q-6 and the §2.3 row in
    `docs/gdd-conformance.md`. **Not separable:** `damage.test.ts`,
    `loot-tell.test.ts`, the re-measured `ffa-parity` / `online-radio` goldens, and
    the constant itself. `constants.ts` is mixed — its comments separate, its one
    line does not.
  - **A second, stronger proof fell out of it.** The detector is green on `main`
    **because it characterises a defect `main` has**. That is a cleaner
    demonstration that a0-59 did not cause the trap than the 200-seed wedge A/B —
    it needs no seed sampling and no argument about which 24 seeds a gate happens
    to draw. Worth reaching for first if the question is ever re-litigated.
  - **Recorded, not executed.** The split needs a second branch and this brief
    permits exactly one pushed branch, so the verified file list is written down
    instead — `docs/wave-commons-entombment.md` → *"This report does not depend on
    a0-59"*, and the scheduling half of Q-6. Flagged in the PR body too.
  - **No value moves.** `git diff -U0 -- src/` filtered of comment and blank lines
    is **empty**; `tsc --noEmit` exits 0; 53 sim tests green.
  - **The lesson, continuing the series.** Sessions 8/9/11/13/14/15 learned *sweep
    the English*, *sweep every directory*, *link the finding where people look*,
    *a gate's threshold is a definition not a detector*, *do not read an
    instrument's verdict as the thing itself*, and *measure the remedy to the same
    standard as the defect*. This one is about the container rather than the
    content: **check whether a blocker actually blocks what you have parked behind
    it.** Fifteen sessions accepted "a0-59 is blocked, therefore this work waits"
    without ever testing the *therefore*. The dependency was assumed from where the
    files sat, and it took four minutes to disprove.
  - **What a seventeenth session should NOT do.** Everything in the twelfth
    through fifteenth lists still holds, plus: do not re-run the separability
    check — it is measured on both `main`'s constant value and actual `main`, and
    the file list is committed. **The only thing still missing is the ruling.**

- **2026-08-16, seventeenth session — what this one actually did.** One commit,
  **`cda7e82`**, and it is the first session to measure **this brief's own subject**
  rather than the blocker. The shipped a0-59 work is untouched; the blocker is
  unchanged in every particular.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `ac70cc2` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1032`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE. **Still no Director ruling** — four comments, all mine, zero
    reviews. Did **not** re-measure the wedge, the geometry, enclosure, the
    candidate fixes or separability; sessions 12–16 say stop and they are right.
  - **The finding: sixteen sessions measured a defect this branch did not cause, to
    four decimal places, while the one number the brief actually asks for was never
    measured at all.** The brief requires the economy consequence be stated "so the
    balance crew reads it as a change, not discovers it". I wrote **"every kill now
    returns twice the ore to the field"** and propagated it into `GDD.md` twice,
    `src/sim/constants.ts` and `docs/design-amendments.md`. It was an estimate.
  - **Measured** — 24 seeds, full natural eight-slot matches to their own ending, on
    **both real builds** (this branch, and a detached worktree at `origin/main`
    `221a2b1`, so neither arm is a hand-flipped constant; session 16's method).
    Ledger at the final tick, hold sampled the tick each ship dies, loose ore summed
    over `world.chunks` every tick and split by `world.match.phase`.

    | summed over 24 matches | `main` (0.5) | a0-59 (1) |
    |---|---|---|
    | **death-drop ore reaching the field** | **448** | **2156 — 4.81×** |
    | effective share of a dead hold returned | **30.3 %** | 100 % |
    | ore at risk (Σ hold at death) | 1479 | 2156 |
    | `deathLoss` burned | 1031 | **0** |
    | `spent` (construction sink) | 3835 | 4805 (**+970**) |
    | `looted` | 5165 | 6917 (+34 %) |
    | `mined` | 4100 | 4267 (**+4 %**) |
    | mean total live ore | 230.45 | 228.64 (**−0.8 %**) |
    | loose ore during collapse | 19.93 | 23.13 (+16 %) |

  - **Three things the estimate hid.**
    1. **The 2× was against design intent, not against the build.** Pre-a0-58
       `killShip` laid down `held × 0.5` with **no rounding** (verified at
       `6c0de0d^:src/sim/damage.ts`), so a dead hold returned exactly half — that is
       the number §2.3 was written against. a0-58's whole-chunk floor then landed on
       a hold-at-death distribution **nobody had ever looked at**: 71 % of deaths
       carry no ore, 16 % carry exactly 1, and `floor(1 × 0.5 / 1)` is **zero
       chunks**. A ship dying with one ore on `main` today drops *nothing*. Shipped
       effective return: **30.3 %**, not 50 %.
    2. **So this buffs light holds, not fat ones — the opposite of the intuition,
       and of what I had written.** A hold of 8 went 4 chunks → 8 (a clean 2×); a
       hold of 1 went **0 → 1**. Across 24 seeds a full hold of 8 died *zero* times
       on `main` and once here, while 470 deaths carried exactly 1. "Ganking a
       loaded miner pays double" was pointing at the **least**-changed case.
    3. **The sink did not thin out, it MIGRATED.** Total ore in play is flat within
       1 % — the 1031 that used to burn was absorbed within 6 % by construction
       spending (+970). The brake on ore supply is now a **visible,
       player-controlled** sink where it was invisible and involuntary. Predicted
       nowhere, and the most interesting consequence of the ruling.
  - **The practical payoff:** mining +4 % and live ore −0.8 % mean `FIELD_YIELD` and
    the a0-17 abundance spread are **NOT** invalidated. The old wording ("collapse
    sits under more circulating ore than §2.8 was measured against") implied they
    were, and would have cost someone a re-tuning session. Recorded in
    `docs/gdd-conformance.md` §2.8 so the balance crew meets it where they look
    (session 11's lesson).
  - **Two avenues checked and closed first, both negative, both cheap:** (a) the
    non-zero `deathLoss` sink **is** already exercised — `damage.test.ts:157`, the
    sub-chunk floor case — so the DoD's "keep the sink" is genuinely tested, not
    trivially satisfied; (b) a0-59 doubles the chunk entities a death spawns, but
    max hold is 8 at `CHUNK.ore = 1`, giving 8 chunks at 17.3 u spacing on a 22 u
    ring (diameter 12 u) — **no self-overlap, and no chunk cap exists in `src/sim/`
    to hit**, so the doubled drop cannot leak into `capLoss`.
  - **Full local suite after the commits: `1 failed | 5543 passed (5544)`,
    `1 failed | 300 passed (301)` files, 657 s.** The one failure is the standing
    `unstuck` blocker, re-run on its own and byte-identical to sessions three
    through sixteen: **seed 15, `foreman` slot 2, 133.5 s at (1204,1195) while
    `'haul'`**. (Counts are +2 tests / +1 file against the sixth session's
    5541/5542 — that is `src/sim/waves.test.ts`, added in the fourteenth session,
    not drift.) Nothing this session touched moved a number.
  - **No value moves.** `git diff -U0 -- src/sim/constants.ts` filtered of comment
    and blank lines is **empty**; `tsc --noEmit` exits 0; 125 tests green (`damage`,
    `ore-ledger`, `match`, `loot-tell`, `waves`, `tests/codex/`). Both probes were
    scratch files under `tests/harness/` (twelfth session's trap: vitest's `include`
    silently ignores the repo root), **deleted**, with `git status -- src/ tests/`
    verified empty and the worktree removed via `git worktree remove`.
  - **The lesson, continuing the series.** Sessions 8/9/11/13/14/15/16 learned
    *sweep the English*, *sweep every directory*, *link the finding where people
    look*, *a gate's threshold is a definition not a detector*, *do not read an
    instrument's verdict as the thing itself*, *measure the remedy to the same
    standard as the defect*, and *check whether a blocker actually blocks what you
    parked behind it*. This one is the sharpest of them: **a blocker will pull all
    your attention onto itself, including away from your own deliverable.** Sixteen
    sessions refined a defect in someone else's design space while the brief's own
    headline number sat unmeasured and wrong in four files — and measuring it cost
    under two minutes of compute. When a session opens with "still blocked", the
    first question is not *what else can I learn about the blocker* but *what does
    my brief ask for that I have not actually checked*.
  - **What an eighteenth session should NOT do.** Everything in the twelfth through
    sixteenth lists still holds, plus: do not re-measure the economy — the tables are
    in `docs/design-amendments.md` → *What this does to the economy — MEASURED, not
    estimated*, reproduced at 12 and 24 seeds and agreeing to 0.3 pp on the effective
    fraction. **The only thing still missing is the ruling.**

- **2026-08-16, eighteenth session — what this one actually did.** One commit,
  **`0996300`**. The shipped a0-59 work is untouched and the blocker is unchanged
  in every particular. This session followed the seventeenth's lesson a second
  time: the blocker is settled, so the question is what my *own brief* asserts
  that nobody has checked.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `676c35c` at
    start, `main` still `221a2b1`, `tsc --noEmit` exits 0, the constant is `1` at
    `constants.ts:1039`, `drops the whole hold` at `damage.test.ts:83`, both
    remote DoD greps pass against `FETCH_HEAD`. PR #436 open, UNSTABLE, **still no
    Director ruling** — five comments, all mine, zero reviews. Did not escalate a
    sixth time. Did **not** re-measure the wedge, the geometry, enclosure, the
    candidate fixes, separability, or the economy aggregate; sessions 12–17 say
    stop and they are right.
  - **The finding: the brief's economy paragraph makes FOUR claims and session 17
    measured one.** The other three are about **place** — *"contested space is
    worth more"*, *"interception beats hauling"*, *"ganking a loaded miner pays
    double"* — and place had never been measured at all. The 4.8× says how much
    ore a death returns; it says nothing about **where it goes or who ends up with
    it**, and both of those were stated as fact in `GDD.md` (the ratified design
    doc), `docs/design-amendments.md` and the constant's doc-comment.
  - **Measured** — 12 seeds, full natural eight-slot matches to their own ending,
    both real builds (this branch, and a detached worktree at `origin/main`
    `221a2b1`; session 16's method, so neither arm is a hand-flipped constant).
    Every chunk a death lays down is tagged at spawn and followed until a ship
    takes it; the taker is the ship whose `lootTake` fired nearest that tick.

    | | `main` (0.5) | a0-59 (1) |
    |---|---|---|
    | deaths carrying ore | 401 | 639 |
    | death-drop ore tracked | 199 | 1153 |
    | **share landing INSIDE the asteroid field** | **10.6 %** | **7.5 %** |
    | median death distance from centre (field r ≈ 307 u) | 621.6 u | 639.0 u |
    | **recovered by someone OTHER than the dead pilot** | **70.9 %** | **79.4 %** |
    | recovered by the dead pilot themself | 19.6 % | 15.4 % |
    | never recovered | 9.5 % | 5.3 % |
    | of "by other", taken by the **nearest station's owner** | 36.2 % | 45.2 % |

  - **Three results, and one of them corrects the GDD.**
    1. **The ore does not land in the asteroid field, and never did.** ~90 % falls
       outside the field radius on **both** builds, on the station ring. The
       amendment's opening — *"A fight in the asteroid field used to burn most of
       whatever the loser was carrying"* — is wrong about place, was wrong about
       place on `main` too, and would have had the balance crew budgeting the
       extra circulation into the wrong part of the map. Inherited error, not
       a0-59's doing; corrected because it is mine to correct.
    2. **"Contested space is worth more" SURVIVES, in its strongest form.** The
       ore really does change hands and more than before: 70.9 % → **79.4 %** to
       someone other than the loser, uncollected 9.5 % → **5.3 %**. First evidence
       this claim has ever had. Reported even though it confirms me.
    3. **"Interception beats hauling" is the weakest of the four and reads closer
       to a DEFENDER'S BUFF.** Of the ore that changes hands, the nearest
       station-owner's share rises 36.2 % → **45.2 %** — die on somebody's
       approach and you hand them your hold on their doorstep. With session 17's
       fat hauler already the least-changed case, what a0-59 pays out is **combat
       attrition near stations, not intercepted cargo**. The ore a0-59 *adds* (the
       holds of 1 `main`'s floor minted as nothing) is the extreme case: **1.9 %**
       of it lands in the field.
  - **Rigour, because this lane's history is wrong numbers.** The tagger was
    validated against `floor(hold × fraction / CHUNK.ore)` summed per death:
    **97.2 %** coverage here, **97.1 %** on `main` — consistent across arms, so the
    comparison is sound. The ~3 % missed is chunks tractored the same tick they
    spawn, which are disproportionately **the killer's**, so the "by other" share
    is a **floor, not a ceiling**. Self-calibrating control: `main`'s 227 held=1
    deaths must drop exactly nothing, and the tagger attributed **1** ore to them —
    a ~0.4 % false-positive rate, the noise floor on every figure above.
  - **Explicitly NOT claimed: the "305 u from the nearest enemy home" figure.**
    Eight stations on a 768 u ring sit ~588 u apart, so any point on that ring is
    within ~294 u of *some* station before anyone dies there. It is a geometric
    artefact, it is nowhere load-bearing, and it is fenced as such in the doc —
    the fourteenth session's lesson applied to my own new instrument rather than
    to somebody else's.
  - **Where it landed:** `GDD.md` §2.3's amendment prose, `docs/design-amendments.md`
    (new subsection *Where the ore actually lands*, with the table, the three
    results and the caveats), `docs/gdd-conformance.md` §2.8 beside session 17's
    mint-budget note (session 11's lesson — put it where the balance crew looks),
    and the `DEATH_ORE_DROP_FRACTION` doc-comment. **`constants.ts` is
    COMMENT-ONLY**: `git diff -U0` filtered of comment and blank lines is empty,
    `tsc --noEmit` exits 0, no golden can move.
  - **No code, no constant, no test, no golden.** Probe was a scratch file under
    `tests/harness/` (twelfth session's trap: vitest's `include` silently ignores
    the repo root), **deleted**, `git status -- src/ tests/` verified empty, and
    the worktree removed with `git worktree remove` — never `git clean`.
  - **The lesson, continuing the series.** Sessions 8/9/11/13/14/15/16/17 learned
    *sweep the English*, *sweep every directory*, *link the finding where people
    look*, *a gate's threshold is a definition not a detector*, *do not read an
    instrument's verdict as the thing itself*, *measure the remedy to the same
    standard as the defect*, *check whether a blocker actually blocks what you
    parked behind it*, and *a blocker pulls attention off your own deliverable*.
    This one is the seventeenth's second half: **once you turn back to your own
    deliverable, audit ALL of it, not the one number that felt quantitative.**
    Session 17 measured the claim with a multiplier in it and stopped; the three
    claims in the same sentence with no number attached sat unmeasured for another
    session, and one of them was wrong. A claim without a figure in it is not
    thereby a soft claim — *"contested space is worth more"* is a testable
    statement about where ore lands, and it took 50 seconds of compute to test.
  - **Full local suite, run TWICE this session, before and after the commit:**
    both `1 failed | 5543 passed (5544)`, `1 failed | 300 passed (301)` files,
    676 s and 664 s. The one failure is the standing blocker — `unstuck` seed 15,
    `foreman` slot 2, **133.5 s at (1204,1195)** while `'haul'` — byte-identical
    to sessions three through seventeen. `tsc --noEmit` exits 0. Both remote DoD
    greps pass against `FETCH_HEAD`. PR check buckets unchanged: the only `fail`
    is `Typecheck, test, build` (two duplicate workflow runs of it, not two
    failures); perf gate passes, Playwright shards pending.
  - **Escalated once, on the fourteenth/fifteenth/seventeenth sessions' test** —
    would acting on the stale text waste work? Yes: the GDD told the balance crew
    the extra ore lands in the asteroid field, so anyone tuning against it would
    budget the circulation into the wrong part of the map, and *"interception
    beats hauling"* points a designer at haulers when the measured effect is a
    defender's buff near stations. Posted one short correction comment and added
    the table to the PR **body**. Did not repost the blocker ask.
  - **What a nineteenth session should NOT do.** Everything in the twelfth through
    seventeenth lists still holds, plus: do not re-measure the spatial
    distribution — the table is in `docs/design-amendments.md` → *Where the ore
    actually lands*, run on both real builds with a self-calibrated tagger.
    **The only thing still missing is the ruling.**

- **2026-08-16, nineteenth session — what this one actually did.** Two commits,
  **`4e4907c`** (a new test — the first behavioural addition since the fourteenth
  session) and **`8eb0c43`** (comment-only sim edits + docs). The shipped a0-59
  work is untouched and the blocker is unchanged in every particular. This session
  followed the seventeenth and eighteenth sessions' lesson a third time: the
  blocker is settled, so the question is what my **own DoD** asserts that nobody
  has checked.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `3aebee0` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1048`, `drops the whole hold` at
    `damage.test.ts:83`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE, **still no Director ruling** — six comments, all mine, zero
    reviews. Did not escalate a seventh time. Did **not** re-measure the wedge, the
    geometry, enclosure, the candidate fixes, separability, the economy aggregate
    or the spatial distribution; sessions 12–18 say stop and they are right.
  - **The finding: the DoD's stated reason for keeping `deathLoss` had never been
    tested, and the reason as written names the wrong knob.** The DoD requires the
    sink be kept because *"a ledger with no sink cannot stay conserved when one
    reappears"*. For eighteen sessions that was reasoning. **Nobody had ever made
    the flow reappear.**
  - **Measured** — `DEATH_ORE_DROP_FRACTION` × `CHUNK.ore` swept over
    {1, 0.5} × {1, 2, 3}, six full natural eight-slot matches per arm run to their
    own ending, conservation residual sampled every tick, ~4,700 deaths in all.

    | fraction | `CHUNK.ore` | ore at death | `deathLoss` | burned | max residual |
    |---|---|---|---|---|---|
    | **1** (shipped) | 1 | 526 | **0.00** | **0 %** | 6.8e-13 |
    | **1** | 2 | 486 | **0.00** | **0 %** | 4.5e-13 |
    | **1** | 3 | 99 | **0.00** | **0 %** | 8.2e-13 |
    | 0.5 (`main`) | 1 | 396 | **283** | **71.5 %** | 5.1e-13 |
    | 0.5 | 2 | 336 | 274 | 81.5 % | 6.3e-13 |
    | 0.5 | 3 | 78 | **78** | **100 %** | 5.7e-13 |

  - **Two things confirmed, one corrected.**
    1. **The sink is load-bearing, not decorative** — 283 of the 396 ore that died,
       at `main`'s fraction. Deleting it (which "it is always 0 now" invites) opens
       a hole that size the instant anyone tunes the fraction back.
    2. **Conservation holds in every arm**, residual ≤ 6.3e-13 against a 1e-6
       tolerance. The DoD's claim is now evidenced rather than argued.
    3. **`CHUNK.ore` does NOT arm the sink — and five places in the repo said it
       did**, including `GDD.md` §2.3 and my own `constants.ts`/`damage.ts`
       comments. 0.00 burned across **2,358 deaths** at chunk sizes 1, 2 and 3.
       Structural, not lucky: a0-58 quantised *every* boundary a hold has — the
       tractor floors `room` to whole `CHUNK.ore` (`step.ts`), the drain returns
       `k · CHUNK.ore` (`dueThisTick`), all four mint sites emit exactly
       `CHUNK.ore` — so `cargo` is always an exact multiple of the chunk size
       (already pinned by `ore-ledger.test.ts:282`, across all three hold paths).
       A whole-hold drop divides exactly at any chunk size. The algebra: for a hold
       of `n` chunks, `deathLoss / held = (n − ⌊n·f⌋) / n`, and the chunk size
       **cancels**.
  - **Why the correction is worth a commit — it errs in BOTH directions.** Against
    my own case: the guard the DoD insists on rests on **one** knob, not the two it
    advertised, so it is less exercised than claimed. Reported anyway, same as the
    fourteenth session's severity correction. For the balance crew: `CHUNK.ore` is
    therefore **safe to tune** on this path.
  - **And it hid a real interaction nobody had named.** The chunk size scales what
    the floor destroys **once the fraction is off 1** — a hold of a single chunk
    always returns nothing at 0.5, and a chunk is `CHUNK.ore` ore. Hence the
    0.5 × 3 arm burning **100 %** of everything that died. So a future "put the
    half back" costs progressively more ore as `CHUNK.ore` rises, and **the two
    must be re-tuned together, not independently.** In `gdd-conformance.md` §2.8
    where the balance crew already looks (session 11's lesson).
  - **`4e4907c` — the new test, `'the sink is armed by the fraction alone —
    CHUNK.ore cannot re-arm it'`** (`src/sim/damage.test.ts`). Asserts the
    **cancellation** across chunk sizes 1–4, not today's zero — so it still passes
    at a fraction of 0.5, **verified** by flipping the constant and running it
    (`drops the whole hold` fails there, correctly, because its value is the point;
    the new one passes). The value statement is kept separate and explicit, on the
    same footing. This is LESSONS §26 applied to the correction itself.
  - **`8eb0c43` — the five stale copies corrected**: `src/sim/damage.ts` (×2),
    `src/sim/damage.test.ts`, `src/sim/constants.ts`, `GDD.md` §2.3, plus the
    measurement into `docs/design-amendments.md` (*The sink, MEASURED*),
    `docs/gdd-conformance.md` §2.8 and the `deathLoss` doc-comment in
    `src/sim/ore-ledger.ts`. **All three sim files COMMENT-ONLY** — `git diff -U0`
    over each, filtered of comment and blank lines, is empty.
  - *Cross-check of the seventeenth session, unplanned:* the 0.5 × 1 arm returns
    **28.5 %** of a dead hold on these six seeds, against **30.3 %** measured over
    24 seeds there — different seeds, different instrument, same answer.
  - **Method.** The `CHUNK.ore` arms mutate the constant object at runtime
    (session 15's trick — `as const` is compile-time only, not `Object.freeze`);
    only the fraction arms need a file edit, and `git diff -- src/` was verified
    **empty** after each restore. Scratch probe under `tests/harness/` (twelfth
    session's trap: vitest's `include` silently ignores the repo root),
    **deleted**, `git status -- src/ tests/` verified empty.
  - **The lesson, continuing the series.** Sessions 8/9/11/13/14/15/16/17/18
    learned *sweep the English*, *sweep every directory*, *link the finding where
    people look*, *a gate's threshold is a definition not a detector*, *do not read
    an instrument's verdict as the thing itself*, *measure the remedy to the same
    standard as the defect*, *check whether a blocker actually blocks what you
    parked behind it*, *a blocker pulls attention off your own deliverable*, and
    *audit ALL of your deliverable, not the one number that felt quantitative*.
    This one is the next layer down: **audit the DoD's REASONS, not just its
    checkboxes.** Every box was ticked and verified nineteen times. But "keep
    `deathLoss`, because a ledger with no sink cannot conserve when one reappears"
    is a *falsifiable claim*, not an instruction — and the version of it written
    into five files named the wrong knob. A requirement's rationale is testable
    exactly like its requirement, and it is the rationale a future agent reasons
    from when they decide whether the guard still earns its place.
  - **What a twentieth session should NOT do.** Everything in the twelfth through
    eighteenth lists still holds, plus: do not re-sweep the sink — the table is in
    `docs/design-amendments.md` → *The sink, MEASURED*, and the relationship is now
    pinned by a committed test that runs in milliseconds, so re-run
    `npx vitest run src/sim/damage.test.ts` instead of re-measuring anything.
    **The only thing still missing is the ruling.**

- **2026-08-16, twentieth session — what this one actually did.** Two commits,
  **`ac91b61`** (a new test) and **`9e64251`** (comment-only sim edits + docs). The
  shipped a0-59 work is untouched and the blocker is unchanged in every particular.
  This session followed the seventeenth–nineteenth sessions' lesson a fourth time:
  the blocker is settled, so the question is what my own brief/DoD asserts that
  nobody has checked.
  - **Re-verified, nothing redone:** local `HEAD` == `origin/…` == `ff04513` at
    start, `main` still `221a2b1` and **0 commits ahead**, `tsc --noEmit` exits 0,
    the constant is `1` at `constants.ts:1057`, `drops the whole hold` at
    `damage.test.ts:86`, both remote DoD greps pass against `FETCH_HEAD`. PR #436
    open, UNSTABLE, the only `fail` bucket is `Typecheck, test, build` (two
    duplicate workflow runs of it, not two failures); perf gate and the reported
    Playwright shard pass. **Still no Director ruling** — seven comments, all mine,
    zero reviews. Did not escalate an eighth time. Did **not** re-measure the wedge,
    the geometry, enclosure, the candidate fixes, separability, the economy
    aggregate, the spatial distribution or the sink sweep; sessions 12–19 say stop
    and they are right.
  - **Also verified for the first time, and it holds: the DoD's LAST bullet is
    byte-exact.** The developer's sentence is quoted verbatim — no smart quotes, no
    `½` for `1/2` — at `GDD.md:119` and `docs/design-amendments.md:23`, matching the
    brief character for character. Nineteen sessions asserted this bullet was done;
    none had actually compared the strings.
  - **The finding: the DoD names TWO flows for `deathLoss` and only one exists.**
    The sink is kept as cover for *"a quantisation leftover, ore lost out of
    bounds"*. Session 19 measured the first. The second is **not a mechanic this sim
    has**: there is no world bound that destroys ore, chunks are removed on exactly
    one condition (emptied by a tractor — `step.ts` `chunks.filter(c => c.amount >
    1e-9)`), asteroids only after `chipAsteroid` drains the sub-chunk tail into
    `dust`, and **nothing anywhere culls ore by position**. It had propagated into
    one repo site (`damage.test.ts`), now corrected. Same shape as session 19's
    `CHUNK.ore` error: a guard advertising a flow that cannot happen invites the
    next agent either to trust it for a reason that is not real, or to hunt a leak
    that is not there.
  - **The audit that answered it is the real finding: every ore-destroying path in
    `src/sim/` names itself in the ledger EXCEPT one.** `refreshDerivedStats` /
    `applyPurchasedStats` (`src/sim/upgrades.ts`) clamp `cargo` down to `cargoCap`
    when a ceiling lands under a loaded hold, and write **no bucket**. Measured on a
    real `createWorld`, one loaded ship:

    | | value |
    |---|---|
    | cargo cap before → after | 8 → 3 |
    | ore destroyed by the clamp | **5** |
    | change in `oreResidual` | **−5** |
    | `spent` / `deathLoss` / `capLoss` / `dust` | **0 / 0 / 0 / 0** |

    A black hole of exactly the class `ore-ledger.ts`'s header exists to catch (the
    p2c loot-regression pattern) — **except that it has never fired.** A cap cannot
    fall within a match as the sim stands: `shipClass` is never written after
    world-build (grepped: zero writes in `src/sim/`), `tiers` is only ever `+= 1`
    (`buyUpgrade`), and the ladder adds off a non-negative base. That is why
    nineteen sessions of ledger work never saw it.
  - **`ac91b61` — the new test, `'a hold ceiling only ever rises (a0-59)'`**
    (`src/sim/upgrades.test.ts`, 2 tests, 42 in the file now). An **unwritten**
    invariant was holding an **unaccounted** sink shut; this writes it down.
    Asserts the cap is non-decreasing in tier for every class, and that climbing the
    whole cargo ladder with a **full** hold loses no ore
    (`cargo + banked + oreSpentOnUpgrades` conserved — `oreResidual` stated without
    needing a ledger, since that file's `makeWorld` has none). **Verified as a real
    detector, not decoration:** shortening the ladder so a cap falls turns it red
    naming the *relationship* (*"interceptor cap fell from tier 2 to 3"*), where the
    two pre-existing tests that also go red fail on their pinned *values*. Constant
    restored, `git diff --stat -- src/sim/constants.ts` verified empty.
  - **Not fixed, deliberately, and this is the line.** `refreshDerivedStats(ship)`
    is **world-free by design** — called on hand-built loadouts, including from
    `src/net/prediction.ts` — so ledgering it means threading a `world` through a
    signature **another lane consumes**. Unratified scope on a path that cannot
    currently leak. Flag the sink, pin the invariant, leave the signature alone.
  - **Two things found for whoever does arm it.** (a) `tierOf` already contemplates
    half of this scenario a few lines up — it clamps a tier a shortened ladder
    stranded so the stat is not `NaN` — but the **ore** the same retune eats has no
    such guard. (b) **The Netcode lane has already met this clamp from the other
    side and wrote it down**: `src/net/lifecycle.test.ts`'s `parkForBanking` warns
    that over-filling a fixture *"does not test a big deposit, it tests the clamp,
    and the ore above the line vanishes at the first snapshot"*, because
    `applyPlayerEconomy` sets `ship.cargo = economy.held` then calls
    `refreshDerivedStats`. On a client whose build does not know a track (tiers
    *"ignored rather than invented"*), the smaller derived cap eats the difference.
    Prediction-side divergence, not authoritative ore loss — **flagged, not
    touched**; `src/net/` is not this lane's.
  - **Where it landed:** `src/sim/upgrades.ts` (**comment-only**, at the clamp, the
    line an agent actually reads before editing), `src/sim/damage.test.ts`
    (**comment-only**, the out-of-bounds correction), `docs/design-amendments.md`
    (*The sink's OTHER advertised flow does not exist*), and
    `docs/gdd-conformance.md` **§2.8** — because everything that would arm the clamp
    is a **balance call** (shortening `UPGRADES[Cargo].steps`, a cargo debuff, a
    mid-match class swap, a tier reset), so it belongs where the balance crew
    already reads the sink notes (session 11's lesson).
  - **No value moves.** `git diff -U0` over both sim files, filtered of comment and
    blank lines, is **empty**; `tsc --noEmit` exits 0. Scratch probe under
    `tests/harness/` (twelfth session's trap: vitest's `include` silently ignores
    the repo root), **deleted**, `git status -- src/ tests/` verified clean.
  - **The lesson, continuing the series.** Sessions 8/9/11/13/14/15/16/17/18/19
    learned *sweep the English*, *sweep every directory*, *link the finding where
    people look*, *a gate's threshold is a definition not a detector*, *do not read
    an instrument's verdict as the thing itself*, *measure the remedy to the same
    standard as the defect*, *check whether a blocker actually blocks what you
    parked behind it*, *a blocker pulls attention off your own deliverable*, *audit
    ALL of your deliverable*, and *audit the DoD's reasons, not just its
    checkboxes*. This one is that last one carried one step further: **a rationale
    names a set, and the set is checkable both ways.** Session 19 asked whether the
    two named triggers were real and found one was not. The complementary question —
    *is anything MISSING from the set?* — is the one that pays: "which flows destroy
    ore, and is each one named?" is a two-minute enumeration, and it turned up a
    sink the ledger has never accounted for, in this lane's own file, that nineteen
    sessions of conservation work walked past.
  - **What a twenty-first session should NOT do.** Everything in the twelfth through
    nineteenth lists still holds, plus: do not re-measure the cargo clamp — the
    table is in `docs/design-amendments.md` → *The sink's OTHER advertised flow does
    not exist*, and the invariant that keeps it shut is pinned by a committed test
    that runs in milliseconds (`npx vitest run src/sim/upgrades.test.ts`). Do not
    re-check the verbatim quote. **The only thing still missing is the ruling.**

## BLOCKERS

*(**SIXTEENTH session, 2026-08-16: the ask is unchanged, but it is NOT A BINARY
and has been written as one for ten sessions. Measured — on `main`'s constant
value and then in a detached worktree at actual `main` — the trap evidence carries
no dependence on a0-59: `src/sim/waves.test.ts`,
`docs/wave-commons-entombment.md` and the comment-only `waves.ts`/`step.ts` edits
typecheck clean on `main` and pass `npx vitest run src/sim` 376/376, with the
detector giving identical verdicts. So the evidence half can land whichever way
the constant goes, and holding it alongside a0-59 is an accident rather than a
decision. Third option and the verified file list: `docs/wave-commons-entombment.md`
→ *This report does not depend on a0-59*, and the scheduling half of Q-6.**)*

*(**FIFTEENTH session, 2026-08-16: the ask is still unchanged, but the MENU
attached to it is not. Every candidate fix below had been costed by arithmetic and
never run; measured against the reachability oracle, candidate 1 is not a
non-starter (`lastRadiusFraction` 0.50 WITH a 2× rock-size cut opens 9/9 at both
waves and keeps §2.3's shrinking ring) and candidate 2's recommended COUNT variant
cannot work at all (`sectorRocks` floors at one rock per sector — 1.22×
oversubscribed at the floor — so every count taper leaves wave 5 sealed 9/9). Both
knobs are ore-neutral, measured identical to the cent. Also: the trap is not an
8-player artefact — wave 5 seals 9/9 at every lobby size from 2 to 8. Tables in
`docs/wave-commons-entombment.md` → *Candidate fixes, measured*, and in Q-6. Read
those before re-costing anything below.**)*

*(**FOURTEENTH session, 2026-08-16: the ask is unchanged, but the defect is
bigger and quieter than every prior version of this section said. The seal closes
at WAVE 4, not wave 5, on 9 of 9 seeds; a ship is caught on 16 of 24 seeds, not
~1.25% — that figure was the wedge gate's DETECTION rate all along. Against that,
the seal is usually temporary: 18 of 24 caught ships mine out inside 30–120 s.
There is now a committed detector that measures enclosure directly and cannot be
masked by widening the cage — `src/sim/waves.test.ts`, 2 seconds. Prefer it to
every measurement recipe below.**)*

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

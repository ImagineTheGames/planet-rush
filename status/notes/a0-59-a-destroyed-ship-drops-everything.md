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

**Why not fixed here — and now with the arithmetic, not just the principle.**
`src/sim/waves.ts` IS this lane's file, so the bug is mine. But there is **no
repositioning fix inside the wave's own disc**, and that is provable from the
shipped constants rather than a judgement call:

- `fieldRadius = ringRadius × commonsRadiusFraction ≈ 773 × 0.4 ≈ 309 u`.
- Wave 5's disc: `309 × WAVE.lastRadiusFraction (0.25) ≈ 77 u`. Its eye:
  `77 × commonsHoleFraction (0.85) ≈ 66 u`, so rock **centres** sit in 66–77 u.
- `sectorRocks = round(20 / 8) = 3`, stamped ×8 = **24 rocks**, each
  `ASTEROID.radius ∈ [22, 46]`.
- Adjacent sector clumps are 45° apart; at r ≈ 71 u that is an arc of **55.8 u**.
  Two mean-size rocks need 68 u of centre separation just to not overlap, and
  **92 u** for a 12 u-hull ship to fit between them (116 u at `maxRadius`).
- Solving `2πR/8 ≥ 92` gives **R ≥ 117 u** — and the wave's entire disc is 77 u.

So the innermost ring would have to sit at 1.5–1.9× the radius of the disc it is
drawn in. **`commonsHoleFraction` cannot deliver that: it is a fraction of the
disc and is bounded by 1.0, which tops out at 77 u.** That knob is already at the
end of its travel — its own comment records it being raised 0.75 → 0.85 for
*exactly this bug* ("could be **sealed** by a full ring of body-radius rocks it
could not squeeze past ... the `unstuck` invariant"), and my 200-seed numbers are
what that fix left behind: reduced, not removed.

The knobs that could actually fix it are `WAVE.lastRadiusFraction` (stop the rings
closing so far in — but "the shrinking ring *is* the mechanic", GDD §2.3),
`ASTEROID.maxRadius` (smaller rock, but GDD §5.5 ties rock size to a payout the
player can judge), or the per-wave rock count. **All three are balance/design
calls, not gameplay-lane repairs**, and folding one into a one-constant developer
ruling is exactly the scope creep to avoid. **Director call:** land a0-59 and brief
the wave trap separately, or hold a0-59 behind it.

Note also a second-order fact worth the Director's attention: the eye is reserved
by rock **centre**, while the launch pocket 90 lines above in the same file is
reserved by rock **body** (`pocketOuterR = ringR − ringR×SPAWN_CLEAR_POCKET −
ASTEROID.maxRadius`, commented "keeps the whole rock out of the pocket, not just
its centre"). The commons omits that `− maxRadius` term, which is why a 66 u eye
leaves only ~20 u of actually-free space. Correcting that alone does not open a
corridor — see the arithmetic above — but it is the same class of mistake and
belongs in the same brief.

Three candidates for whoever takes that brief, re-costed against the arithmetic
above. None is taken here.

1. **Widen the final wave's ring — `WAVE.lastRadiusFraction` 0.25 → ~0.44.** The
   only knob that makes the ring geometrically passable (`R ≥ 117 u` needs a disc
   of ≥ 137 u, i.e. ≥ 0.44 × fieldRadius). Costs no ratified invariant — ore per
   rock is untouched so `FIELD_YIELD` holds exactly, and it is still one sector
   stamped `N` times so fairness holds — but it **directly weakens GDD §2.3's
   shrinking ring**, which is the mechanic the section is about. A designer call,
   not an engineering one.
2. **Shrink late-wave rock.** Drop `ASTEROID.maxRadius` for the last wave, or taper
   it with `waveRadiusFraction`. Opens the corridor at the current ring radius and
   keeps the ring closing in. Costs GDD §5.5's "a payout the player can judge" —
   rock size reads as ore — and changes the field's whole visual texture.
3. **Eject any live ship a landing wave would entomb.** Rock positions untouched,
   so `FIELD_YIELD` and `N`-fold symmetry are both exact and — because it only
   fires on the ~1.25% of seeds where a ship is actually caught — it moves almost
   no goldens. It is the cheapest of the three and the only one that changes no
   field design. Against it: it is a new sim rule (a wave displacing a ship), and
   it treats the symptom — the centre stays a trap for anyone who flies in after
   the wave lands, it just stops sealing someone in at the instant of landing.
   **Note the earlier draft of this option was overlap-triggered and would not have
   fired**: at seed 15 the ship sits ~8 u from centre in a ~20 u free pocket with a
   ~12 u hull, so it overlaps nothing — it is sealed *behind* a 90 u annulus, not
   pinned inside rock. The trigger has to be "no escape route", not "overlaps rock".

Repro, both arms, on this tree (the only difference between the builds is the one
constant): `npx vitest run tests/harness/unstuck.test.ts` fails here at seed 15.
For `main`'s sim, flip `DEATH_ORE_DROP_FRACTION` back to `0.5` and probe seeds
**142, 146, 147** — seeds 1–48 are clean on `main`, which is the whole reason the
24-seed gate is green there.

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
not worsen, and cannot fix without a design change to GDD §2.3's shrinking ring
(the arithmetic is in BLOCKED — `commonsHoleFraction` is bounded by 1.0 and would
need to be ~1.9). So the choice is **who fixes the wave trap, and when**, not "is
a0-59 safe". Land a0-59 and brief the wave trap separately, or hold it.

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

# a0-08-looted-ore-that-does-not-count.md — working notes (gameplay)

Scratch memory for THIS brief, across retries and resumes. Keep it current; a
future you reads it first. It is a working note, not evidence — "done" is the
DoD, the PR and QA's attestation, never a line written here.

Branch `agent/gameplay/a0-08-looted-ore-that-does-not-count`, cut from
`origin/main` at `f3ace95`.

## THE ANSWER, FIRST (this is the deliverable)

**Conservation HOLDS.** Ran the reproduction the ledger was built for — kill a
loaded ship, fly the wreck drop, empty hold and full hold — and
`liveOre === seeded + injected + debrisFloor − spent − deathLoss − capLoss` is
exact, residual `0.0e+0`, at every frame of every run, and every tick of six full
natural matches. **No ore leaks. This is a legibility bug, not the fourth loot
regression.** Numbers: `evidence/a0-08-loot-tell/trace.txt`.

"Sometimes" = three outcomes of the *same* kill (victim hold 4 → drops 2):

| looter hold | takes | left on field | ledger `looted` |
|---|---|---|---|
| 0/2 | 2 | 0 | 2 |
| 2/2 | **0** | 2 | 0 |
| 1/2 | 1 | 1 | 1 |

Plus the fourth thing, and it stacks on all three: loot lands in `cargo`; the
prominent readout is `banked`. A *correct* pickup moves no number the player is
watching. Brief candidates 1, 2 and 4 are all live at once; 3 (the half-drop) is
working as designed and untold.

## BUILT

- **`44ad13f` — the two tells.** `Ship.lootTake` (ore that ARRIVED this tick, per
  ship, accumulated — the ore that moved, not the chunk offered) and
  `Ship.lootBlocked` (this hold is full AND loose ore is inside `TRACTOR.range`).
  Both optional, both cleared for every ship at the top of `updateChunks` — the
  only chunk→cargo path there is — so a tell cannot outlive its tick. `makeShip`
  seeds them. Nothing in the sim reads them back.
- **`src/sim/loot-tell.test.ts`** — the reproduction pinned: all three outcomes,
  residual 0 in each, partial-take reports 1 not the chunk, `lootBlocked` fires on
  the wreck and is silent out of tractor range / clears the tick room appears, a
  deposit courier never reads as loot, tells cleared for dead ships too.
- **`tests/harness/ore-conservation.test.ts`** — the natural matches now also
  audit the tells, sampled on the same ticks (a second eight-slot run is not
  affordable): summed `lootTake` must EQUAL ledger `looted` (a tell that lies is
  worse than no tell), and a full hold over loose ore must actually OCCUR across
  six seeds, so the fix can't rot into dead code.
- **`tests/harness/a0-08-evidence.test.ts`** — regenerates
  `evidence/a0-08-loot-tell/trace.txt` under `A0_08_WRITE_EVIDENCE=1` and asserts
  every number it prints, so the artifact can never drift. CI never dirties the
  tree.
- **GDD §2.3 + §2.7**, `docs/design-amendments.md` (new top entry),
  `src/sim/ore-ledger.ts` header — the ledger proved a NEGATIVE, and that is
  worth recording as loudly as the three leaks it caught.

## DECISIONS

**1. A tell, not a rule.** The brief forbids raising `cargoCap`, lowering
`DEATH_ORE_DROP_FRACTION` or letting pickup ignore the cap without ratification,
and conservation holding removes any *correctness* reason to touch them. All
three are named in the PR body as questions for the developer and left alone.
Rejected specifically: making a full hold still tractor-and-refuse at contact (it
would fire the "refused" branch that today never even runs, but it also changes
chunk motion — visible, and not mine to ratify).

**2. `lootBlocked` is set in the target scan, not the contact branch.** Important
and easy to get backwards: with a full hold the tractor never targets the chunk,
so the `room > 0` check in the collect branch is *never reached*. A tell hung
there would essentially never fire. The player-visible event is "ore in range,
hold full, nothing coming" — so it is decided in the same distance test the
tractor already does. Zero extra cost, and it is the reported frame exactly.

**3. Nothing published for the partial take beyond `lootTake`.** A partial take
composes: `lootTake 1` on the tick, then `lootBlocked` latches while the leftover
floats there (see run C in the trace — both are true on tick 1). A third field
would have been a second way to say the same thing.

**4. Out of `hashState`, deliberately.** Both tells are pure functions of state
already fingerprinted (cargo, cargoCap, chunk positions), so hashing them adds no
detection power and not hashing them can never hide a divergence. `firing` is
hashed, but `firing` is *decided* by input, not derived. Determinism GDD §4.8.

**5. Staging fills holds rock → cargo, never out of thin air.** Both test files
move ore from an asteroid into the hold, which conserves `liveOre` exactly — so
every residual assertion in the repro is honest rather than measured against a
baseline the test itself broke. The victim gets a real bought cargo tier
(`tiers.cargo = 1`, cap 4) so the half-drop is 2 and "partial" has meaning; at the
base cap of 2 the drop is a single indivisible ore.

**6. I did not draw anything.** `src/render/` and `src/ui/` are not mine. The
sim publishes the two facts; the hold pips are the natural home (they already
drain visibly on deposit) and that is called out for those lanes in the PR body.
Pixel evidence needs them; the ledger evidence does not, and the ledger evidence
is what the brief asked the PR body to state.

## COORDINATION — a0-03, and this matters

`status/notes/a0-03-wheel-cost-is-one-number.md` NEXT already names this brief:
a0-03 renames the top-left `BANKED` → `ORE`. **If that lands without this, it
gets worse:** a readout captioned `ORE` that does not move when you pick up ore.
Same root, two lanes. Said so in the PR body and named the brief; did NOT touch
the label myself (a0-03 owns it, and fixing it in two places is how lanes
collide). No sim change here depends on a0-03 landing, or vice versa.

## NEXT

- [ ] PR body states the verdict + ledger numbers in the first paragraph — that
      sentence IS the deliverable per the brief.
- [ ] Render/UI handoff: `lootTake` / `lootBlocked` are published and tested but
      **nothing draws them yet**. Until a lane consumes them the player still
      sees nothing; say this plainly rather than implying the bug is closed.
- [ ] Three balance questions left for the developer, unratified and untouched:
      hold cap of 2, the half-hold death drop, cap-ignoring pickup.

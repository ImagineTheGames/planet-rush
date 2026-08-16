# a0-54 — "I picked up two and only one registered", and the game never said why

Branch: `agent/ui/a0-54-partial-pickup-tell` · UI Engineer · started 2026-08-16

## VERIFICATION FIRST (the brief's stop condition — it does NOT hold)

Before writing a line of the tell, the brief asks for a real ore journal (a0-52)
to confirm `take === min(chunk.amount, room)`, and to STOP if it ever doesn't —
that would be a sim accounting bug, a different and more serious brief.

No developer playtest log is committed anywhere in this repo (`docs/playtest-log.md`
is the format spec, not a capture), so the reading was taken from the journal
itself, off a real run: `createWorld` + the real offline bot cast + the real
`step`, seed 7, five sim-minutes, draining `drainOreJournal` every tick and
matching each `mined`/`chunk` line against the chunk that actually shrank.

    events=117  partials=4  mismatches=0
    partial tick=805  p2 offered=1 room=0.63 took=0.63 hold 1.37->2/2
    partial tick=1041 p6 offered=1 room=0.87 took=0.87 hold 1.13->2/2
    partial tick=1261 p5 offered=1 room=0.87 took=0.87 hold 1.13->2/2
    partial tick=3050 p5 offered=1 room=0.50 took=0.50 hold 1.50->2/2

Every take is exactly `min(offered, room)`. **The sim's accounting is correct;
the silence is the bug**, exactly as the brief reads it. (The scratch runner was
deleted, not committed — it was a measurement, not a deliverable. The finding it
produced is quoted in the sim commit message and in the PR body.)

## BUILT

- `6e11b7b` **sim(a0-54): carry `lootOffered` beside `lootTake`.**
  `src/sim/state.ts` (the field + its doc + the `makeShip` default) and
  `src/sim/step.ts` (cleared with the other loot tells at the top of the chunk
  step; accumulated on the same line as `lootTake`, from the chunk amount read
  *before* the take spends it). The hold rule is untouched. Write-only, optional,
  not fingerprinted by `hashState` — determinism unaffected (GDD §4.8).
- `src/ui/loot-tell.ts` — the pure decision + timing: `partialTake(taken, offered)`
  (null unless `offered > taken`), `leftNumeral`, and `LootTellLatch`, which holds
  a one-tick pulse on screen for `LOOT_TELL_SECONDS` (1.1 s) with a fade.
- `src/ui/hud.ts` — `HudFrame.lootTake` / `.lootOffered`, two Texts under the hold
  pip row (`updateLootTell`), a `loot-tell` layout-registry entry, and a
  `debugLootTell()` seam for the live stage.
- `src/main.ts` — TWO lines feeding the ship's tells into the frame, marked
  `OWNED BY PLATFORM, EDITED BY THE UI ENGINEER` in the same style QA's
  `goldens.spec.ts` carries for its one UI-owned line. Without them the tell can
  never fire in the real game.
- `src/ui/hud.test.ts` (new) — 13 tests, sim-driven: `a partial take says so`
  stages a hold of 1/2 against a real 2-ore chunk through `createWorld` + `step`
  and asserts 1 taken, 1 left, `HOLD FULL · 1 LEFT`; the full-take test asserts
  silence; plus the outright-refusal boundary, rounding, float slack, and latch
  timing.

## DECISIONS (and what was rejected)

- **The line is `HOLD FULL · 1 LEFT`** — reason first, per the clarity rule
  (style-guide §8 / GDD §4.7: "a refusal names its reason in the first three
  words"). Painted in the ore readout's own grammar: the reason in `./chrome`'s
  `TEXT_MUTED`, the count in signal yellow, exactly as the top-left draws a muted
  `ORE` over a yellow total. Rejected: inventing a new tell language, and putting
  the whole line in yellow (the words are not a quantity — style-guide §2).
- **Only on a partial take.** A full take says nothing; the tell for a pickup that
  worked is the pips filling. Rejected: a `+N` float on every pickup.
- **No second flash.** Checked, per the brief: `oreHudModel().full` is
  `cargo >= cargoCap` and a partial take always lands exactly on `cargoCap`, so
  the existing pip flash (`oreFlashOn`) is already firing on this frame. This
  branch adds the *reason* only.
- **The leftover is whole ore, floored at 1** (`Math.max(1, Math.round(left))`) —
  the rule `repairWedgeInfo` already ships for `+N HP`. A decimal is unreadable in
  a one-second glance and `0 LEFT` would be false while a chunk is still on screen.
- **The tell latches in the UI, not the sim.** The sim's tells are one tick wide
  by design (a0-08); making them sticky would be a sim change the brief forbids.
- **`lootOffered` counts only ore that touched a hold with room** — "the same
  accumulate", per the brief. It deliberately does not count a chunk a FULL hold
  refused outright; that case is `lootBlocked` and the pip flash. See NEXT.

## NEXT / open, for the Director and the gameplay lane

1. **No chunk in the shipped game carries more than 1 ore.** `CHUNK.ore` is 1, and
   both death drops and wreck debris split into 1-ore pieces plus a fractional
   remainder (`src/sim/match.ts` `scatterWreckDebris`). So today's real partial
   takes are the fractional kind above (offered 1, room 0.63) and the tell will
   read `HOLD FULL · 1 LEFT` over the ~0.4 still floating — true, and the best
   whole-ore statement available. The brief's own example (a 2-ore chunk) is
   handled exactly as specified and is what the DoD test stages; it just is not
   what the field produces yet.
2. **Therefore the developer's "two, but only one registered" is most likely TWO
   1-ore chunks**, where the second was refused outright by a hold that the first
   one filled. That path takes nothing, so `lootOffered === lootTake === 0` and
   this tell stays down by construction. The existing signal there is
   `Ship.lootBlocked` (a0-08) — which, note, **no view has ever drawn**: nothing
   outside `src/sim` and `tests/harness` reads `lootTake` or `lootBlocked` today.
   Widening `lootOffered` to refused chunks (or drawing `lootBlocked`) is a real
   design call and is deliberately NOT taken unilaterally here. Flagged in the PR.
3. **Sampling.** `lootTake`/`lootOffered` are one-tick pulses read once per
   rendered frame, so a frame that runs two sim steps can miss a partial take on
   the first — the same sampling every per-tick tell in `HudFrame` has had since
   M1. A dropped *tell*, never dropped ore. If Platform wants it lossless, the fix
   is an accumulate in `main.ts`'s `update`, not in `src/ui`.
4. Online: the tell rides local sim state, so it is right on the predicted local
   ship and absent for remote ships. `src/net/snapshot` carries neither loot tell
   today; not this lane's to change.

## STATUS

- `npx tsc --noEmit` — green.
- `npm test -- --run` — see the PR; run on the branch before pushing.
- Goldens: the frozen golden scenes pin a fixed tick with no collection on it, so
  no HUD frame changes. Re-baseline only if a golden actually moves.

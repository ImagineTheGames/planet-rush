# p1-04-accrual-and-xp.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as you
work; a future you reads it first. This is a working note, not evidence — "done"
is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/p1-04-accrual-and-xp`, cut from `origin/main` @ `be3c5dd`.
Contract: `docs/progression-plan.md` §1.1, §1.3a–d, §1.5, §5 (Task PR-4). **The
plan wins where it and the brief disagree** — three places it did, all annotated
in `docs/briefs/pr-04-accrual-and-xp.md` and in the PR.

## BUILT

1. `27ac009` — **the two modules and their tests.**
   - `src/progression/accrual.ts` — `createAccrualObserver(world, tiers)` →
     `{ observe(world), finalize(world): MatchAccrual[] }`. Read-only spectator.
     The free half is world deltas; the credited half is READ off pr-02's
     `world.credit`. Every seat is tallied, not just the local player.
   - `src/progression/xp.ts` — plan §1.3d, eleven rows, every weight TUNABLE and
     at the top of the file. `xpForMatch(a) → { total, rows }`.
   - `src/progression/accrual.test.ts` (15) + `xp.test.ts` (12) — the brief's
     seven tests in its order, plus read-only-ness and the Crush case.
2. `f34f0fb` — **evidence.** `evidence/p1-04-accrual-and-xp.ts` runs the shipped
   bot cast through the shipped observer on `onTick`; `…-accrual-and-xp.txt` is
   the committed output and the PR body's evidence line.
3. `e5048d1` — the brief's three amendments, and this note.
4. **PR [#346](https://github.com/ImagineTheGames/planet-rush/pull/346)** opened
   against `main` — carries the three amendments, the evidence table beside the
   spike's, and Questions A/B/C as the PR's stated exposure.

## DECISIONS (and what was rejected)

1. **The tier bucket is read out of `lastDamageAt`, not reconstructed.** THE
   problem in this brief: it asks for `damageDealt: Record<Difficulty, number>`
   "from pr-02's ledger", but the shipped `CombatCredit` rows are **one number per
   attacker slot with no victim dimension** — the bucket is not in there. What is
   in there is `lastDamageAt[victim][attacker]` (the per-pair clock, which p1-02
   added beyond the ratified six fields) and `lastHitBy[victim]`. So each window's
   damage delta for an attacker is charged to exactly the victims the ledger says
   they hit in that window; ambiguity inside one window is apportioned by the
   victims' own observed HP loss. Fed per tick, the common case is one attacker,
   one victim, one tier — exact. Pinned by a test that *discriminates*: two duels
   in one tick, and the observer must not smear slot 0's damage across the hull
   slot 3 was shooting. **Rejected:** (a) a shadow attributor over projectile
   geometry — the brief's test 2 forbids it and it is a measurement device, not a
   client feature; (b) widening `CombatCredit` to bucket by victim — correct, and
   `src/sim/` is not this lane's to touch; it is written up as a proposal for the
   Gameplay lane instead; (c) a single lobby-average multiplier — that is a design
   change to §1.3b wearing an implementation's clothes.
2. **`observe()` is idempotent for the newest tick and revisable for it.** "Feed
   it the authoritative world" is a wiring rule this module cannot enforce (pr-05
   owns the wiring), so the module enforces what it can: the last window is kept
   whole and rolled back when the same tick arrives with different content, and an
   older world is ignored outright. That is what makes brief test 7 a test rather
   than a comment. **Rejected:** a monotonic tick guard alone — it makes a
   re-delivery safe but leaves the *mispredicted* value banked, which is the bug
   the trap is actually about.
3. **`MatchAccrual` gained `slots` and `slot`.** A placement row priced at 20/rung
   needs the lobby size; the observer tallies every seat because pr-08 re-baselines
   the whole lobby.
4. **The rows sum to the total exactly** — each row rounded once, total = Σ rounded
   rows. pr-05 counts eleven rows up in front of the player and then shows a total;
   a rounded *sum* would sit one XP off the rows that produced it.
5. **Eleven rows always, in a fixed order, zero counts included.** The summary's
   timeline should not change shape with the match; filtering is the view's call.
6. **Question A shipped the recommended way (keep s4's participation rows).** The
   consequence if the developer says no is written at the top of `xp.ts`:
   `XP_CURVE_BASE` re-tunes to 75 **in that change**, and p1-03's table lock in
   `curve.test.ts` is the test that goes red to say so.
7. **`Difficulty` is imported from `../bots`** (the enum, as `src/ui/lobby.ts`
   already does). The tier of a seat is lobby knowledge; `accrual.ts` consumes a
   `readonly Difficulty[]` and never asks a personality anything itself.
8. **Mutation-checked the three novel guards** before trusting the green: break
   the ledger pairing, the death-sink guard, or the teleport filter and the
   matching test fails. A suite that passes first try deserves that check.

## VERIFIED

- `npx tsc --noEmit` clean.
- `npm test -- --run` on `e5048d1` — **257 files, 4450 tests, all passing** (556s).
  The earlier `npx vitest run src/progression/` → 66 green (accrual 15, xp 12,
  plus curve and profile untouched) was the narrow gate; this is the DoD's.
- `git merge-base --is-ancestor origin/main HEAD` — yes, on `be3c5dd`.
- CI on #346: **Typecheck, test, build → pass**; every other job skipped by its
  own trigger (Pages deploy, the Playwright mobile shards, live-deploy boot,
  ntfy) — zero in the `fail` bucket, which is what the DoD's last line asks.
- Evidence reproduces run to run (MIXED median 397.5 XP both times) and lands on
  top of `measured-a0-13.txt`: ore 28.8 vs 28.9, dist 61819 vs 63430, deaths 19.0
  vs 16.5, secs 772 vs 835. Combat reads a little **higher** than the spike, which
  is the expected direction — the spike published a reconstruction residual and
  this reads the ledger.
- §1.3d predicted a median of **399 XP** for the recommended table; the MIXED cast
  measures **397.5** out of the shipped modules with no scale factor anywhere. So
  §1.4's curve stands as ratified.

## NEXT

- Nothing outstanding on this brief once CI is green on the PR.
- **For pr-05:** call `createAccrualObserver(world, tiers)` at match start and
  `observe(world)` on every tick of the **authoritative** world (the server's,
  online). `finalize()` is pure and cheap enough to call per frame, but the
  sequence must fix its numbers once at teardown (§6.3 rule 2). `xpForMatch`
  gives the rows in draw order; `HUMAN_TIER` (`xp.ts`) is the tier to put in the
  `tiers` array for a human seat.
- **For the Gameplay lane, if it ever wants it:** a victim dimension on
  `CombatCredit.dealtToShips`/`dealtToStations` would make the tier bucket exact in
  every case, including a window coarse enough to lose the pairing. Not needed at
  the shipped observation rate; recorded so nobody has to re-derive it.
- **Question C** (a station the Crush killed) changes only what pr-05 *shows*: the
  accrual already records zero, honestly, and the summary renders `—`.

# p1-02 — the attribution hook (`by: PlayerId` + the write-only credit ledger)

Branch: `agent/gameplay/p1-02-attribution-hook` · Brief: `docs/briefs/pr-02-attribution-hook.md`
Contract: `docs/progression-plan.md` §1.1, §1.5 (the plan wins where the two disagree).

## SHIPPED — PR #343, merged 2026-08-09 09:57Z

**This brief is done and in `main`. Do not rebuild it.** Verified in `origin/main`, not
just assumed from the merge: `src/sim/combat-credit.ts` and its test are tracked there,
`ASSIST_WINDOW_S` is in `constants.ts`, and `by?: PlayerId` is on `damageShip` /
`killShip` / `damageStation` / `damageTurret` / `damageSatellite` / `destroyCore` /
`eliminate`. No review comments on the PR.

The branch was later fast-forwarded to `origin/main` (`fa55346`) so the DoD's
`git merge-base --is-ancestor origin/main HEAD` line keeps passing as main moves — the
branch had gone stale behind p1-03's merge. Nothing was re-edited to make it pass.

Re-verified on the fast-forwarded tree (`853520a`): `npx tsc --noEmit` clean,
`npm test -- --run` → **255 files / 4416 tests, all green**. (4414 of those were green
before the fast-forward; the extra two arrived with p1-03, not from this lane.)

## BUILT

`6e4b0e6` — sim(p1-02): `by: PlayerId` on the damage path + the write-only credit ledger

- **`src/sim/combat-credit.ts` (new)** — `CombatCredit`, every array keyed by player
  **slot**. The six ratified fields (`dealtToShips`, `dealtToStations`, `shipKills`,
  `stationKills`, `lastHitBy`, `lastHitAt`) plus `lastDamageAt[victim][attacker]`.
  `makeCombatCredit`, `creditDamage`, `creditKill`, `assistsOn`. Modelled on
  `ore-ledger.ts`: write-only, optional on `World`, every function no-ops when the
  ledger is absent.
- **`by?: PlayerId`, optional and trailing**, on `damageShip`, `damageStation`,
  `damageTurret`, `damageSatellite`, `killShip`, `destroyCore`. Every existing caller
  compiles untouched.
- **`projectiles.ts`** passes `p.owner` at all four hit sites. Nothing is inferred — the
  value was already in hand (it had to be, to ask `canDamage`).
- **`ASSIST_WINDOW_S`** (TUNABLE, 5 s) in `constants.ts`.
- **`world.credit`** on `World`, attached by `createWorld`, sized from the lobby.
- **`src/sim/combat-credit.test.ts`** — 19 tests, the brief's seven properties in order.

Evidence: `npx tsc --noEmit` clean; `npm test -- --run` → **253 files / 4366 tests, all
green**. The determinism arm prints its two hashes:

```
p1-02 determinism evidence — credit ledger PRESENT: 14ab34ee · ABSENT: 14ab34ee
```

## DECISIONS (and what was rejected)

1. **Credit is gated on `areEnemies`, not `canDamage`.** The brief says "ask `canDamage`";
   the plan's own traps say "refuse to credit an ally" (trap 2) and "the last **enemy** to
   land damage" (trap 5). `canDamage` opens to allies the day `FRIENDLY_FIRE` is ratified
   ON, which would let a shot that *lands* on a teammate also *pay*. With friendly fire OFF
   (the ratified default) the two predicates agree exactly on every damaging call, so this
   changes nothing today. Both come from `allegiance.ts` — the single module — so nothing is
   re-derived. **Flagged in the PR as a brief fix.**
2. **`damageTurret`/`damageSatellite` take a trailing optional `world`.** They are the two
   entry points that never took one, and the ledger lives on the world. A leading `world`
   would break existing callers in lanes this agent does not own (`src/art/compliance.test.ts`).
   Omitting it skips the accounting — `ledgerAdd`'s no-op discipline. Rejected: a parallel
   `damageTurretBy()` (forks the rule), and a dead `by` parameter that records nothing.
3. **Turret and satellite damage counts as `dealtToStations`.** They are the station's
   property, and the 2× weight is on damage dealt, not on which body absorbed it.
4. **The station kill is credited inside `eliminate`, not `destroyCore`.** `destroyCore` is
   deliberately idempotent (two shots, one tick); `eliminate`'s `eliminated.includes` guard is
   the single once-per-death point. Pinned by a test.
5. **Overkill is never credited.** A 9999-damage finisher into a 30 HP hull pays 30. Each
   damage site clamps before crediting.
6. **A ship that dies WITH its core (elimination collateral) credits no ship kill.** A "ship
   destroyed" is a killing blow landed on a hull; that hull went down with the seat, and the
   10× station kill already pays for ending the player. Hence no `by` on the `killShip` call
   inside `eliminate`.
7. **No fallback from the killing blow to `lastHitBy`.** The kill is awarded from the `by` on
   the fatal call. A core the Crush finished has no killer and gets none — inventing one from
   an earlier hit is exactly the guess the honesty rule forbids.
8. **`lastDamageAt` added beyond the ratified six fields.** "Record the assist window anyway"
   needs per-attacker timing that `lastHitAt` alone cannot answer. Fixed size (slots², eight
   seats), no allocation after construction. The ratified shape is a subset, so pr-04/pr-05
   consume it unchanged.
9. **`assistsOn` is a read helper for consumers OUTSIDE the sim.** `step` must never call it;
   reading the ledger from inside is the one thing that could make accounting change behaviour.

## NEXT

Nothing outstanding on this brief — it is merged. If a future session lands here, the
only live work is keeping the branch an ancestor-descendant of `main` (fast-forward, never
a force-push) should the DoD be re-run later. Open items that belong to other lanes:

- **Question C** (a station the Crush killed — who gets the 10×?) changes only what pr-05
  *shows*. This lane's answer is unchanged: record the truth, credit nobody.
- pr-04 consumes `world.credit` for the XP economy; `DAMAGE_HP_PER_UNIT` (the 25 HP unit,
  plan §1.3a Question B) is that lane's constant, not this one's — the ledger stores raw HP.

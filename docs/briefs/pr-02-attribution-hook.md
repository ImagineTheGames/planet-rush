# pr-02 — the sim learns who did it

**Owner:** Gameplay Engineer · **needs: nothing** — claimable today
**Plan:** `docs/progression-plan.md` §1.1, §1.5 · **GDD:** §2.6, §2.7, §4.8
**Blocks:** pr-04 (and therefore pr-05, pr-08). **The long pole of the chain.**

---

## The ask

Three of the developer's four ratified XP weights — **damage dealt 2×, ships destroyed 5×,
stations destroyed 10×** — are on information the simulation does not have. Not "does not
expose": does not have.

- `damageShip(world, target, amount)` (`src/sim/damage.ts:25`) carries no source.
- `killShip(world, ship)` (`damage.ts:37`) carries no source.
- `damageStation` (`buildings.ts:770`), `damageTurret` (`:796`), `damageSatellite` (`:719`) —
  none.
- `destroyCore` (`match.ts:114`) — a core simply reaches zero.
- `src/main.ts:2147` says it in words: *"the sim tracks no killer."*
- And **damage dealt is worse than kills**: a kill at least leaves a mark in
  `match.eliminated`. Damage leaves nothing at all.

Give the sim an optional attacker on the damage path, and a write-only ledger to put it in.

```ts
// the four existing entry points gain an OPTIONAL last parameter — every current caller
// keeps compiling, which is what makes this a small change.
export function damageShip(world: World, target: Ship, amount: number, by?: PlayerId): boolean
export function damageStation(world: World, s: MiningStation, amount: number, by?: PlayerId): boolean
export function damageTurret(t: Turret, amount: number, by?: PlayerId): boolean
export function damageSatellite(sat: RadarSatellite, amount: number, by?: PlayerId): boolean

// src/sim/combat-credit.ts (new) — modelled on src/sim/ore-ledger.ts, line for line.
export interface CombatCredit {
  dealtToShips: number[];     // HP, indexed by attacker slot
  dealtToStations: number[];  // HP, indexed by attacker slot
  shipKills: number[];
  stationKills: number[];
  lastHitBy: (PlayerId | null)[];  // per victim slot — the killing-blow answer
  lastHitAt: number[];             // sim time of that hit
}
```

**`by` is never inferred.** Every damaging call site already holds it: `projectiles.ts` has
`p.owner` on the shot that struck (it must, to avoid friendly fire), and a turret shot carries
its station's owner. You are threading a value down a call that already has it.

## Two invariants that are not negotiable

- **Determinism (GDD §4.8).** The ledger is **write-only** and lives **outside `hashState`**,
  exactly like `src/sim/ore-ledger.ts`. Nothing inside `step` may ever read it. If a behaviour
  changes because the ledger exists, the change is wrong.
- **Honesty.** A stat that cannot be credited to a real player is **not credited to anyone**.
  The collapse phase has no attacker (GDD §2.3 — the claim closing in), and measurement says
  that is not a corner case: **100% of station deaths in an Easy bot lobby, and 98% in a Medium
  one, were the Crush** (`spikes/progression/measured-a0-13.txt`). Zero is the correct answer
  there, and pr-05 renders it as `—`, never as a guess.

## Test first

1. **A kills B.** A two-ship fixture: A's shots take B's hull to zero. `dealtToShips[A]` equals
   B's starting hull; `shipKills[A] === 1`; `shipKills[B] === 0`.
2. **A turret's kill belongs to the station owner.** Not to nobody, not to a turret id. The
   player bought the deterrent; they get what it kills (GDD §2.6).
3. **A shot outlives its owner.** A projectile in flight when its owner's ship dies still credits
   that owner's **slot**. The slot is the accounting key, not the hull — including for a player
   already eliminated from the match.
4. **Allies and self are never credited.** Ask `canDamage` (`allegiance.ts:90`) — the same single
   predicate the turrets, auto-aim and projectiles ask (GDD §2.9). Do not re-derive it. **This
   must be tested with two slots sharing a side**: FFA is teams-of-one, so an allegiance bug is
   invisible there forever.
5. **A shared kill goes to one player.** The killing blow is the **last enemy to land damage** —
   never split. The damage rows already split the work proportionally; splitting the kill too
   pays the same contribution twice, and `0.5 SHIPS DESTROYED` is a number nobody can read.
6. **The Crush credits nobody.** A match run to full collapse with no player-dealt core damage
   ends with `stationKills` all zero and `lastHitBy` null for those cores.
7. **The replay hash does not move.** The CI determinism replay test produces a **byte-identical**
   final hash with the ledger present and absent. This is the test the whole brief lives or dies
   on.

## Traps

- **Assists.** An assist is any *other* enemy who damaged the same hull within `ASSIST_WINDOW_S`
  (`TUNABLE`, opening value 5 s) before it died. **Phase 1 pays no assist XP** — the damage they
  dealt already paid them at 2× per unit, which is the honest version of an assist. Record the
  window anyway; the summary may want to name it later.
- **Do not put the ledger on the snapshot.** It is not per-tick state and must never inflate the
  snapshot budget. Same discipline as the ore ledger.
- **`ledgerAdd` no-ops on a world without a ledger** — copy that. Hand-built `World` literals in
  net, bot and render fixtures must keep working untouched.
- **Optional parameters, not a new function.** A parallel `damageShipBy()` would fork the two
  things that must agree exactly about spawn protection, the half-hold drop and the respawn
  clock (`damage.ts`'s own header says why).

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "git ls-files src/sim/combat-credit.ts | grep -q ."
bash -c "grep -rn 'combat-credit\\|combatCredit' src/sim/step.ts src/sim/state.ts | grep -q 'hashState' && exit 1 || exit 0"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

The determinism replay hash, printed twice — once with the credit ledger built and once with it
absent — and identical. Plus test 4's two-slots-on-a-side case, because an FFA-only test proves
nothing about allegiance.

## Open questions this brief is exposed to

**Question C** (a station the Crush killed — who gets the 10×?) changes only what pr-05 *shows*.
Whatever the answer, this brief's job is unchanged: record the truth, credit nobody when there
is nobody. **Ship it now.**

---

## Amendments made while building it *(p1-02, 2026-08-09)*

Two places where the brief as written could not be followed literally. Both are recorded in
`status/notes/p1-02-attribution-hook.md` with the reasoning.

1. **The credit gate is `areEnemies`, not `canDamage`.** Trap 4 above and plan §1.5 trap 2 both
   say an ally must never be credited — but `canDamage` *opens up to allies* the day
   `FRIENDLY_FIRE` is ratified ON, so a shot that lands on a teammate would also pay. Plan trap
   5's wording ("the last **enemy** to land damage") settles it. With friendly fire OFF (the
   ratified default) the two predicates agree exactly on every damaging call, so nothing about
   today's behaviour differs, and the predicate still comes from `allegiance.ts` — it is not
   re-derived.
2. **`damageTurret`/`damageSatellite` take a trailing optional `world` after `by`.** They are
   the only two damage entry points that never took a `World`, and the ledger lives on it.
   Putting `world` first would break existing callers in lanes the Gameplay Engineer does not
   own. Omitting it skips the accounting — `ledgerAdd`'s no-op discipline.

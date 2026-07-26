# Planet Rush — Design Amendments

Ratified changes to the GDD, recorded here so the GDD's affected sections are
**amended by reference** rather than silently drifting. Each entry names the
date, the ratifying quote, and the exact scope of the change. The interfaces in
`src/shared/` and the constants in `src/sim/constants.ts` are the machine-readable
half of these amendments; this file is the human-readable why.

---

## v0.2 — Combat becomes PROJECTILES (ship-vs-ship and ship-vs-structure)

**Date:** 2026-07-26
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.3 (core loop / "one beam, one stat"), §2.6 (siege
balance), §4.1 (collision — "Beam: a segment-vs-circle raycast … not a
projectile"). The GDD's combat description is amended by this entry.

### The ratification, verbatim

> "It's too easy right now to kill each other and there's no way to dodge. If we
> switch to a projectile there's a chance to dodge and it becomes a lot funner…
> and then we can also add upgrades to make them faster, stronger."

### Scope split — what changed and what did NOT

- **Mining stays a beam.** The mining laser vs asteroids/ore is *untouched*: the
  whole mining loop, the segment-vs-circle raycast, clamp-to-hit, and the
  tractoring rules are exactly as they were (GDD §4.1). `Ship.beam` is now a pure
  **mining** tell — it is non-null only on a tick a ship is actually cutting rock.
- **Ship-vs-ship and ship-vs-structure combat is a projectile.** Firing at
  anything that is not a rock looses a pooled projectile on the weapon cadence
  (`SHIP_WEAPON.fireInterval`) instead of an instant hitscan beam. The projectile
  has a finite muzzle speed and lifetime, so **a target at combat range strafing
  at full speed can evade it** — that dodge is the entire point, and it is pinned
  by a test (`src/sim/projectiles.test.ts`, "the dodge").
- **One beam, one stat survives.** Per-shot weapon damage is still the beam stat
  (`shipWeaponDamage = shipBeamShipDps × fireInterval`), and mining rate still
  scales off the same beam, so mining speed and weapon damage move together
  exactly as GDD §2.5 requires. What changed is only that the damage is
  *delivered* by a shot that can miss, not a ray that cannot.
- **Turrets fire projectiles too.** They already did (GDD §2.6); the firing,
  flight, collision and pool were unified into `src/sim/projectiles.ts`, shared by
  both shooters. A turret shot still hits only ships (p1-14 coverage rules
  intact); a ship shot is siege-capable (ships, turrets, shields, cores). Neither
  hits an asteroid — shots fly over rock; mining is the beam's job.

### Upgrade hooks (base tier now, tiers later)

Projectile **speed** and **damage** read from the ship's upgrade state, on the
same beam ladder as mining and weapon damage — "faster, stronger" rides the beam
track (`shipProjectileSpeed`, `shipWeaponDamage` in `src/sim/upgrades.ts`). This
brief wires the plumbing at the base tier; balancing new tiers is a follow-up the
harness will measure.

### Bots lead

Combat now has travel time, so a shot aimed where a strafing enemy *is* misses.
Bots aim on an **intercept course** (`leadAim`, threaded through
`aimAt`/`canHit`/`engage`) using the target's last-seen velocity and the hull's
own muzzle speed; a still target (a turret, a core) has zero velocity and the lead
collapses to a straight shot. The per-tier `aimJitter` still rides on top, so an
Easy bot leads *badly* and a Hard bot leads well — the difficulty ladder is intact.

### Wire / snapshot

Ship weapon shots ride the same `world.projectiles` pool the turret guns always
did, so they stream through the existing 6-byte projectile record with no format
change. The worst case was **re-derived** for two shooters (≤ 32 turret shots +
≤ 16 ship shots ≈ 48, under the 64-slot budget), so the measured 510-byte layout
is deliberately unchanged (`src/net/snapshot.ts`, `MAX_PROJECTILES`). The one
addition, at zero byte cost: a **shot-kind bit** in a previously-reserved `meta`
bit, so the renderer can size/tint a ship shot apart from a turret shot
(`SHOT_META`, pinned in `snapshot.test.ts`).

### Balance (harness re-run, seeds 1–6, 8 seats)

The projectile switch **improves termination** — every mirror now reaches an
ending (was 65.6% at the pre-existing baseline), and economic/combat mirrors land
in target: `miner` 12:18, `raider` 12:22, `turtle` 14:10, `idle` 14:10.

| Contestant | decided | win rate | mirror median |
|---|---|---|---|
| `rusher` | 24 | 100.0% ⚠ | 0:35 |
| `miner` | 24 | 0.0% | 12:18 |
| `raider` | 24 | 0.0% | 12:22 |
| `turtle` | 24 | 0.0% | 14:10 |

| Target | Verdict |
|---|---|
| Termination — every match ends | **PASS** (improved from FAIL) |
| No ship class > 55% | **PASS** (top `hauler` 43.8%) |
| No strategy > 55% | **FAIL** — `rusher` 100% |
| Match length 10–15 min | **FAIL** — rusher mirrors end < 1 min |

The two remaining failures are **pre-existing and orthogonal to the combat model**:
they are the undefended-core problem the shipped balance report already names
(`tests/reports/balance-01.md`, Finding 2: "`rusher` wins ~97%, because nobody
defends… **Blocked on the bot trees**"). The strategy sweep pits QA probes that do
exactly one thing against each other, and the shipped difficulty tiers still run
the do-nothing baseline, so a pure rusher sieging a core nobody defends still
wins — a shot at a *stationary* core does not benefit from the dodge. Fixing it is
bot-defence work, not a combat-model or constants change. The switch did not
collapse the round-robin further (rusher was already ~100%; ship-class balance
still passes), and it made the dodge real, which is what it set out to do.

### Constants added (`src/sim/constants.ts`, all TUNABLE)

- `SHIP_WEAPON` — `fireInterval` 0.35 s, base `projectileSpeed` 520 u/s, `range`
  300 u, `radius` 5.
- `PROJECTILE_CORE_FACTOR` — the 5:10 core:ship ratio a shot on a shield/core
  takes, so §2.8 balance is unchanged by the delivery mechanism.

# Planet Rush — Design Amendments

Ratified changes to the GDD, recorded here so the GDD's affected sections are
**amended by reference** rather than silently drifting. Each entry names the
date, the ratifying quote, and the exact scope of the change. The interfaces in
`src/shared/` and the constants in `src/sim/constants.ts` are the machine-readable
half of these amendments; this file is the human-readable why.

---

## v0.3 — The mining laser goes away: PROJECTILES for everything

**Date:** 2026-07-26
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.3 (core loop / "hold fire on an asteroid… the same
beam that damages ships chips asteroids"), §4.1 (collision — "Beam: a
segment-vs-circle raycast … not a projectile"). Supersedes the v0.2 scope split's
"mining stays a beam." The GDD's mining description is amended by this entry; the
§2.3 **tractor rules are unchanged and sacred** — chunks fly to a ship with hold
space and stay put when the hold is full.

### The ratification, verbatim

> "I think mining laser should go away, it should be a projectile as well… that
> way we don't have laser + projectile, just projectile."

### What changed

- **Mining is shooting.** There is now ONE weapon system. Holding fire looses a
  pooled projectile on the weapon cadence (`SHIP_WEAPON.fireInterval`); a shot
  that strikes an **asteroid** chips ore chunks (`Projectile.mineYield`), and a
  shot that strikes an enemy **ship / turret / shield / core** deals `damage`
  (GDD §2.4). One projectile carries both payloads; whatever it reaches first
  decides which applies. Auto-fire / hold-to-FIRE now mines *and* fights with the
  same verb.
- **The beam is deleted as a mechanism.** The segment-vs-circle raycast, the
  clamp-to-hit, `mineBeam`/`raycastBeam`/`segCircle`, and the continuous
  `mineAsteroid` are gone — no ray does any mining or damage; the projectile does.
  `Ship.beam` survives only as a **mining indicator tell**: non-null on a tick a
  ship is mining a rock, `null` while it shoots an enemy — exactly the v0.2
  contract. It carries no mechanical weight, but it is the signal the netcode
  "firing" bit (`src/net/snapshot.ts`) and the renderer read across the
  agent-ownership boundary, so the sim cannot drop it without breaking ratified
  consumers it does not own. **Follow-up (cross-agent, render + netcode):** retire
  the beam VFX draw and the `Ship.beam` field once render/net stop keying the
  "firing"/mining tell off it — the sim half is done; the field is kept as the
  seam. This is why the frozen-scene goldens still show a mining beam and have not
  been re-baselined here (item 5): the draw is render-owned.
- **"You cannot shoot through things" is now free.** A rock between you and an
  enemy eats the shot (and is mined) — projectile collision covers the guarantee
  the retired clamp-to-hit test used to pin, so those beam-geometry tests retire
  with the beam (see the PR body for each retired test and its replacement).
- **One beam, one stat survives.** The per-hit chip is the ship's continuous
  mining rate over one fire interval (`shipMineYield = shipMiningRate ×
  fireInterval`), so mining speed still rides the one beam stat exactly as weapon
  damage and projectile speed do (GDD §2.5). `MINING_YIELD_PER_HIT` is the
  Vanguard baseline, derived from `MINING_RATE × SHIP_WEAPON.fireInterval`.
- **Turrets are untouched** — a turret shot still hits only enemy ships, never
  rock or structures (p1-14 coverage intact).

### Mining feel — ore per minute (harness-measured, Vanguard at the face)

| | ore/min | note |
|---|---|---|
| Old (continuous beam) | 30.0 | `shipMiningRate` × 60, by construction |
| New (projectile) | ~28.7 | flat across mining standoffs; ~96% of old — a field takes ~4% longer |

Shots land one fire interval apart (the weapon is a pipeline; shot-travel time is
a one-off latency, not a rate cap), so ore/second at the mining face is
`mineYield ⁄ fireInterval = MINING_RATE`, a hair under in a finite window by the
last in-flight shot. "About as long as it does today," as the brief asks.

### Constants added (`src/sim/constants.ts`, all TUNABLE)

- `MINING_YIELD_PER_HIT` — Vanguard ore chipped per shot on a rock, `= MINING_RATE
  × SHIP_WEAPON.fireInterval` (0.175). `shipMineYield` (`src/sim/upgrades.ts`)
  scales it by the beam stat.
- `Projectile.mineYield` — per-shot chip carried on the pooled projectile (0 on
  turret and wire-decoded shots — the server is authoritative for ore).
- `BEAM_RANGE` kept (name unchanged for the bot/net/harness consumers that size
  standoffs from it) — now documented as the auto-aim engagement radius.

### Balance (harness round-robin, seeds 1–6, 8 seats)

See the PR body for the pasted table. The switch is mining-delivery only — the
targeting logic (`acquireNearest`) is identical for rock and hull, and combat was
already a projectile (v0.2) — so the round-robin is materially unchanged: the
ship-class ceiling stays under 55%, and the pre-existing undefended-core `rusher`
result (bot-defence work, `tests/reports/balance-01.md` Finding 2) is orthogonal
to the mining model, exactly as it was under v0.2.

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

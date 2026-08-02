/**
 * src/sim/state.ts — the simulation's world state. OWNER: Gameplay Engineer.
 *
 * Everything here is **plain serializable data**: numbers, strings, and arrays
 * of the same. No class instances, no functions, no `Date`, no `Map` live in
 * the state tree. That is load-bearing for two reasons (GDD §4.1, §4.8):
 *
 *  1. **Determinism replay** — two runs from the same world + same inputs must
 *     `deepEqual`. Plain data compares cleanly; a closure or a `Map` would not.
 *  2. **Netcode snapshots** — the server encodes ships and projectiles from
 *     this tree; a plain shape serializes without a bespoke codec.
 *
 * The seeded RNG is stored as a bare 32-bit `rngState` number (not an `Rng`
 * closure) so the whole tree stays serializable and hashable. `advanceRng`
 * below steps it with the ratified mulberry32 algorithm (`@shared/types`).
 */

import type { Muzzle, PlayerId, ShipClass, Vec2 } from '@shared/types';
import type { Abundance, ResolvedEconomy } from './constants';
import {
  CORE_HP,
  STATION,
  RESOURCE_FIELD,
  SHIELD,
  SHIP_RADIUS,
  SPAWN_PROTECTION_S,
  STARTING_ORE,
  resolveEconomy,
} from './constants';
import { getMap } from './maps';
import { scatterDerelictLoot } from './match';
import { liveOre, makeLedger, type OreLedger } from './ore-ledger';
import { shipCargoCap, shipMaxHull, stockTiers, type UpgradeTiers } from './upgrades';
import { spawnHomeFields, spawnWave } from './waves';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** A player's ship. One per slot (GDD §2.1); humans and bots share the shape. */
export interface Ship {
  readonly id: PlayerId;
  /** The lobby choice, locked for the match (GDD §2.11). Sets every base stat;
   *  `tiers` scales them. */
  readonly shipClass: ShipClass;
  /**
   * The side this ship fights for (variable-slots Task A2), a plain
   * hash/snapshot-safe int fixed at match start. FFA sets it to the ship's own
   * id (teams-of-one); TEAMS shares one `team` across allies. `areEnemies`
   * (`./allegiance`) is the ONLY reader — everything friend/foe routes through it.
   *
   * Optional so the `Ship` literals other agents build (net decode, bot/render
   * fixtures) keep compiling; an absent team reads as the ship's own id, i.e.
   * FFA — same discipline as `weaponCooldown`. It must NOT ride the per-tick
   * snapshot (allegiance is static config; it rides matchStart — spike Trap 7).
   */
  team?: number;
  /**
   * Tiers bought on the four upgrade tracks (GDD §2.5). Match-lifetime state:
   * upgrades persist through respawn, so nothing on the respawn path clears it —
   * and because the ladder *multiplies* the class base, a maxed Interceptor is
   * still the fastest hull on the map (`./upgrades`).
   */
  tiers: UpgradeTiers;
  pos: Vec2;
  vel: Vec2;
  /** Home spawn point — where the player's station sits; respawn returns here
   *  (GDD §2.7). Day 1 has no stations, so this is just the ring spawn. */
  home: Vec2;
  /** Facing, radians. A manual weapon shot fires along this. Resolved once per
   *  tick by the facing ladder (aim input → auto-aim target → velocity → hold)
   *  and always turn-rate limited — it never snaps (see `resolveFacing`). */
  angle: number;
  /** Current hull HP. Ships are cheap and not repairable (GDD §2.5). */
  hull: number;
  /** Max hull for this class+upgrades; respawn restores to it. Stored rather than
   *  derived per read (the renderer's hull bar and the netcode both want it);
   *  written only by `./upgrades`, so it can never disagree with `tiers`. */
  maxHull: number;
  /** Ore currently held. Lost (half) on death; capped by `cargoCap` (GDD §2.3). */
  cargo: number;
  /** Hold capacity in ore. Class base, +2 per upgrade tier, cap 8 (GDD §2.8).
   *  Stored on the same terms as `maxHull`. */
  cargoCap: number;
  /** Banked ore — safe, never lost to ship death (GDD §2.3). */
  banked: number;
  /** false while dead and waiting to respawn. */
  alive: boolean;
  /** Seconds until respawn (0 when alive). */
  respawnTimer: number;
  /** Seconds of spawn protection remaining (GDD §2.1). */
  spawnProtect: number;
  /** True once this player's home core has been destroyed: they are out of the
   *  match (GDD §2.7 — "its owner is eliminated"). An eliminated ship is dead
   *  and never respawns; the player gets the Rematch button instead. */
  eliminated: boolean;
  /** Collision radius. */
  radius: number;
  /**
   * **Firing tell** — true on any tick this ship's weapon is active (holding the
   * trigger with a shot loosing, whether it lands on rock or hull). The mining /
   * attack laser retired to a projectile (ratified amendment v0.3: "the mining
   * laser goes away, it should be a projectile"), so there is no shot geometry to
   * publish any more — a ship's shots are drawn from the projectile pool. This
   * boolean is all that survives: the signal the netcode "firing" bit
   * (`src/net/snapshot.ts`), the bots' threat read, and the renderer's in-combat
   * glow key off. Reset to `false` every tick before the fire step decides it.
   */
  firing: boolean;
  /** Seconds until the ship's weapon may loose its next projectile (0 = ready).
   *  The weapon fires on `SHIP_WEAPON.fireInterval`, the projectile analogue of
   *  the old hitscan's per-tick damage (design amendment v0.2). Match
   *  state like everything else; reset to 0 on respawn.
   *
   *  Optional so the `Ship` literals other agents build (bot/render/net/harness
   *  fixtures) keep compiling — an absent cooldown reads as ready-to-fire (0), the
   *  same backward-compatible discipline as `Turret.muzzle`. The sim's own ships
   *  always carry it (`makeShip` sets it). */
  weaponCooldown?: number;
  /**
   * Seconds this ship has been GRINDING a body — pressing into a station or
   * asteroid while held to near-stillness by the contact (the bot-home-rim wedge,
   * developer report p14). The collision response (`step` `reflectOffCircle`)
   * counts it up while the grind persists and resets it the instant the ship
   * breaks contact or gets moving; once it crosses `WEDGE_CONTACT_S` the response
   * slides the pinned hull off the rim. A gate on *persistent* contact, not any
   * contact, so a normal bounce or a momentary graze is left untouched — and, in
   * particular, a ship that only brushes a body for a fraction of a second stays
   * byte-for-byte on the pre-p14 path, which the netcode's prediction relies on
   * (a discontinuous shove on every touch would amplify snapshot quantization).
   *
   * Local grind-state scratch: it is NOT on the wire snapshot (`src/net/snapshot`)
   * and not needed there — a remote ship reads an absent value as 0 and re-earns
   * it from its own contacts. Optional on the same backward-compatible terms as
   * `weaponCooldown`; `makeShip` always sets it to 0 and respawn clears it. */
  wedgeContactS?: number;
  /**
   * Where the current grind began — the position {@link wedgeContactS} is timed
   * against (p15). The escape hatch asks "has this hull actually GONE anywhere?",
   * not "is it slow?", because the two are not the same question: a ship pinned in
   * the V between two rocks keeps most of its speed (each body reflects only its
   * own inward component, and what survives points into the other) while its net
   * displacement is a couple of units per minute. Measuring the pin off *net
   * headway from this anchor* catches that treadmill and the near-still radial
   * press with one rule. Re-anchored the moment the ship clears
   * `WEDGE_ESCAPE_PROGRESS` of it, and dropped when contact breaks.
   *
   * Local grind-state scratch on the same terms as `wedgeContactS`: not on the
   * wire, optional, always set by `makeShip`, cleared on respawn. */
  wedgeAnchor?: Vec2;
  /**
   * The slide direction a *committed* escape is walking along, or absent when no
   * escape is running (p15).
   *
   * Latched, not recomputed, and that is the load-bearing part: the tangent is
   * taken about the body the hull last pressed into, and a hull wedged in a V
   * presses into a different one every tick, so a freshly-derived tangent flips
   * direction as fast as the contact does and the two cancel — the ship shivers in
   * the pocket at full throttle instead of leaving it. One direction, held until
   * the hull has actually gone somewhere, walks it out.
   *
   * Local grind-state scratch on the same terms as `wedgeContactS`. */
  wedgeSlide?: Vec2;
}

/** A minable asteroid — the economy (GDD §2.3, §5.5). */
export interface Asteroid {
  readonly id: number;
  pos: Vec2;
  radius: number;
  /** Ore remaining inside; mining draws this down to 0, then it bursts. */
  ore: number;
  /** Ore the asteroid held when spawned; crack stage is a fraction of this. */
  maxOre: number;
  /** Visible crack stage 0..2 (GDD §5.5, three stages). Art reads this. */
  crackStage: number;
  /** Fractional ore mined but not yet emitted as a whole chunk. */
  mineBuffer: number;
  /**
   * Which field this rock belongs to (field rule v0.1.2, `RESOURCE_FIELD`): the
   * owner slot of the home neighbourhood it was stamped for, or `null` for the
   * contested commons. It is the fairness invariant made legible — the fairness
   * test groups home fields by owner and sums the commons by `null`, and a
   * renderer may tint "your neighbourhood" apart from the centre.
   *
   * Optional so the asteroid literals other agents build (net wire-decode, bot
   * fixtures, render tests) keep compiling — a rock with no `home` field simply
   * predates the tag; the sim's own spawners (`./waves`) always set it. Same
   * backward-compatible discipline as `Turret.orbitAngle` / `Turret.muzzle`.
   */
  home?: PlayerId | null;
}

/** A drifting ore chunk, tractor-collected by proximity (GDD §2.3). */
export interface OreChunk {
  readonly id: number;
  pos: Vec2;
  vel: Vec2;
  /** Ore value carried. */
  amount: number;
  radius: number;
  /**
   * Deposit-flight chunk (field report v0.1.2): a ship docked at its own station
   * spins these off as its hold drains into the bank, and they fly to `homeTo`
   * and vanish on arrival. They are the *telegraph*, not the ore — the drain
   * itself is authoritative on `Ship.cargo`/`banked`, so a flight chunk carries
   * no economic weight: the tractor never grabs it, no ship ever collects it,
   * and it is absorbed silently at the station. Optional and unset on a normal
   * mined chunk, so the renderer (which draws every chunk by `pos`) and the net
   * codec keep working unchanged — the same backward-compatible discipline as
   * `Turret.muzzle`.
   */
  deposit?: boolean;
  /** Where a `deposit` flight is headed — its station's centre. Unset otherwise. */
  homeTo?: Vec2;
}

// --- Stations and what gets built on them (GDD §2.1, §2.5, §2.6) ------------

/** An auto-firing turret mounted on a station (GDD §2.5, §2.6: "turrets deter;
 *  the ship defends"). Cheap, killable, and a shot target in its own right. */
/**
 * A turret's committed intercept aim, re-solved on a tier cadence (turret-lead
 * field report v0.2.4). Plain, serializable, hashable scratch that lives on the
 * {@link Turret}; the sim's `updateTurrets` reads and rewrites it. Mirrors the
 * bot `AimTrack`, but for a world entity rather than a per-brain closure.
 */
export interface TurretAim {
  /** The (possibly stale) target velocity the intercept lead is solved from —
   *  re-sampled only every `aimLatency` seconds, so a mover is led where it was
   *  last seen going. */
  vel: Vec2;
  /** The committed angular error (radians) added to the lead bearing, redrawn
   *  from the seeded RNG at each re-sample — the deviance the field report asks
   *  for, tier-scaled by `aimSpread`. */
  error: number;
  /** Sim time (`world.time`) `vel` and `error` were adopted. */
  since: number;
  /** The target slot the commit belongs to; a change re-solves immediately (you
   *  read a fresh threat's motion the moment you swing onto it). */
  targetId: PlayerId;
}

export interface Turret {
  readonly id: number;
  /** The station owner's slot — turrets never shoot their own fleet. */
  readonly owner: PlayerId;
  /** Mount slot 0..`TURRET.capPerStation`-1. Fixes the mount angle around the
   *  station and frees for re-use when the turret dies, so a rebuilt turret
   *  lands in a hole rather than on top of a survivor. */
  readonly slot: number;
  pos: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** Barrel facing, radians — turn-rate limited toward the tracked ship. Purely
   *  the visible telegraph: alignment never gates the shot (DPS is DPS). */
  angle: number;
  /**
   * Angular position of the turret **around its station's rim**, radians (field
   * report P1). A turret is no longer pinned to its build spot: it slides along
   * the surface ring toward the point whose outward normal faces its target,
   * capped at `TURRET.orbitSpeed` so it glides. `pos` is derived from this every
   * tick (`turretOrbitPos`), so the sprite and muzzle origin track the slide.
   *
   * Starts at the turret's mount-slot home angle (`turretHomeAngle`), which is
   * why a freshly built turret sits exactly on its reserved slot, and where it
   * slides back to when no enemy is in range.
   *
   * Optional so the render tell / netcode-reconstruction / bot-fixture turret
   * literals other agents build keep compiling — a turret with no `orbitAngle`
   * simply does not slide (its `pos` is taken as authoritative), exactly the same
   * backward-compatible discipline as `muzzle`. The sim's own turrets always
   * carry it (`makeTurret` sets it).
   */
  orbitAngle?: number;
  /** Seconds until it may fire again. */
  cooldown: number;
  /**
   * Turret tier — the `Mk` on the ladder (`TURRET_TIERS`; parity field report
   * v0.2.2). Tier 0 is Mk I, the built baseline; the TURRET wedge upgrades a
   * standing turret one step at a time (`upgradeTurret`), and this is where the
   * step lands. Every combat number the turret uses — HP, per-shot damage, fire
   * rate, range — is read from `turretTierSpec(tier)`, so a tier bump is the one
   * field that makes the turret better and nothing else has to change.
   *
   * Optional so the turret literals other agents build (render tells, netcode
   * reconstruction, bot fixtures) keep compiling — a turret with no `tier` reads
   * as Mk I (0), the exact pre-ladder turret. Same backward-compatible discipline
   * as `orbitAngle` / `muzzle`. The sim's own turrets always carry it
   * (`makeTurret` sets it). */
  tier?: number;
  /** Ship it is tracking this tick, or null when nothing is in range. */
  targetId: PlayerId | null;
  /**
   * The turret's committed aim solution — the lead-and-deviance model's scratch
   * (turret-lead field report v0.2.4). A turret no longer fires at where the
   * enemy *is*: it solves an intercept lead (`leadAim`) with a seeded angular
   * error on top, and — the half that makes a strafing attacker dodge — it
   * re-samples the target's velocity only every tier `aimLatency` seconds. This
   * holds the velocity and error it committed to between those re-samples, so a
   * juking target is led where it *was* going. The world entity equivalent of the
   * bots' per-brain {@link ../bots AimTrack}; a turret is world state, so its aim
   * scratch has to live on the turret to persist across ticks and stay hashable.
   *
   * `null` when the turret is not currently leading anything (no target, or not
   * yet committed). Optional so the turret literals other agents build (render
   * tells, netcode reconstruction, bot fixtures) keep compiling — same
   * backward-compatible discipline as `orbitAngle` / `tier` / `muzzle`; a turret
   * with no `aim` simply re-commits from scratch the next tick it fires.
   */
  aim?: TurretAim | null;
  /**
   * Muzzle-flash geometry for the tick this turret actually loosed a shot, else
   * `null` (GDD §2.6, §4.1). A turret's damage rides a pooled projectile, but its
   * *tell* is the flash at the barrel, and that tell has to come from sim combat
   * state so **every** turret in the world flashes when it fires — not just the
   * local player's. Origin at the barrel tip, direction along the barrel, and a
   * short `length` flare off the muzzle (`TURRET.muzzleFlashLength`) with a `null`
   * `hitPoint`: a burst at the muzzle, **never a line to the target** — the
   * projectile owns the shot and its impact (see `makeMuzzle`, v0.2.2 field
   * report). Set only on fire ticks (~twice a second), cleared every other tick,
   * so it is a transient event.
   *
   * Optional so this render tell can be added without breaking the turret
   * literals other agents build (wire-event reconstruction, bot fixtures) — the
   * sim's own turrets always carry it (`makeTurret` sets it), and a turret with
   * no `muzzle` field simply is not flashing.
   */
  muzzle?: Muzzle | null;
}

/**
 * A **radar satellite** — a buildable body that orbits its owner's station and,
 * while alive, projects the LARGE sensor coverage that lifts the minimap fog
 * (RATIFIED developer feature f1: "build a radar satellite … it orbits around the
 * mining station and can be attacked"). It reuses the turret orbit-ring geometry
 * (`turretOrbitPos`-style), in its own outboard band (`SATELLITE.mountOffset`),
 * but — unlike a turret, which slides to face a threat — it simply ORBITS at a
 * constant angular speed, so `orbitAngle` advances every tick.
 *
 * It has HP and is a legitimate high-value siege target (the ship weapon's target
 * ladder and the auto-aim include it); killing it removes it as a sensor source
 * the same tick, collapsing that coverage (`./sensing` reads only alive
 * satellites). One per station (`SATELLITE.capPerStation`), stored in an array on
 * the {@link MiningStation} so the build-cap/construction/damage/sweep paths match
 * turrets and shields exactly.
 */
export interface RadarSatellite {
  readonly id: number;
  /** The station owner's slot — a satellite is only ever your own until it dies. */
  readonly owner: PlayerId;
  pos: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** Angular position around the station rim (radians), advanced every tick at
   *  `SATELLITE.orbitSpeed`. `pos` is derived from this each tick, so the sprite
   *  and the sensor origin track the orbit (`updateSatellites`). */
  orbitAngle: number;
}

/** A shield generator's bubble over the core (GDD §2.5). Stacks to two; each
 *  generator is its own HP pool and regenerates independently, so the second
 *  shield doubles both the buffer and the recovery rate. */
export interface Shield {
  readonly id: number;
  hp: number;
  maxHp: number;
  /** Bubble radius — the shot target that stands in front of the core. */
  radius: number;
}

/** A building under construction (GDD §2.5: "defenses are bought before the
 *  attack, not during it"). Ore is spent when the order is placed; only time
 *  remains. */
export interface BuildJob {
  readonly id: number;
  readonly kind: 'turret' | 'shield' | 'satellite';
  /** Reserved mount slot (turrets only; 0 for shields) — held for the whole
   *  build so two queued turrets can never claim the same mount. */
  readonly slot: number;
  /** Seconds of construction left. */
  remaining: number;
  /** Seconds the job started with — the renderer's progress denominator. */
  total: number;
}

/** A player's home station: the win condition, and the only thing in the match
 *  that does not respawn (GDD §2.1, §2.7). One per slot. */
export interface MiningStation {
  readonly id: number;
  readonly owner: PlayerId;
  /**
   * The side this station belongs to (variable-slots Task A2) — matches its
   * owner's ship `team`, so a shot never sieges an ally's home. FFA sets it to
   * the owner id (teams-of-one). Optional, same backward-compatible reasoning as
   * `Ship.team`: `MiningStation` literals other agents build without a team read as
   * FFA. Static config, never on the per-tick snapshot (spike Trap 7).
   */
  team?: number;
  /**
   * True for a **derelict** — an unowned wreck the map lays out to keep its
   * shape at a small N (the derelict-fill maps `compass`/`diamond`, ratified
   * 2026-07-26, Milestone B). A derelict is born a wreck: `alive === false` from
   * construction, no owning ship, no home field, its `owner`/`team` a board index
   * beyond the live roster (`>= N`) that nobody shares — so every combat path
   * ignores it exactly as it ignores a killed home (a dead core takes no damage,
   * has no turrets, and is never auto-aimed). Its lootable debris is scattered at
   * world-build like any wreck's (GDD §2.7). Optional and absent on live homes,
   * the same backward-compatible discipline as `team`; never on the per-tick
   * snapshot (static match layout — the client rebuilds it from map + roster).
   */
  derelict?: boolean;
  /** Static — stations do not move. */
  pos: Vec2;
  radius: number;
  /** Core HP. Zero ends this player's match (GDD §1 loss condition). */
  coreHp: number;
  maxCoreHp: number;
  /** false once the core has been destroyed; the wreck stays on the map. */
  alive: boolean;
  /** Sim time the core died, or -1 while it lives. The dead station *is* the
   *  wreck (GDD §2.7): it keeps its position and radius, stays solid, and never
   *  leaves the world — this is the timestamp the renderer's death moment and
   *  the wreck sprite swap hang off. */
  deathTime: number;
  /** Seconds of match-start spawn protection left on the core (GDD §2.1). */
  spawnProtect: number;
  /** Outward angle from the arena centre — the turret mount ring starts here. */
  angle: number;
  /** Seconds since the core or any shield last took damage. Drives shield
   *  "pressure beats regeneration" (GDD §2.6): shields regenerate only past
   *  `SHIELD.regenDelay` undamaged seconds. (Repair no longer reads this — it is
   *  a discrete purchase now, not an interruptible channel; see `placeOrder`.) */
  sinceDamage: number;
  /** The repair TELL — "a repair was just bought and is still settling"
   *  (developer amendment, 2026-07-26 — repair is a discrete purchase now, no
   *  held channel). Lit by a repair purchase (`placeOrder`) and held for
   *  `REPAIR_TELL_HOLD` seconds (see `repairCooldown`), then released — or cleared
   *  early by a full core, the ship leaving, or collapse (`maintainRepairTell`).
   *  It drains nothing and heals nothing — signalling only: the renderer pulses
   *  the healed core from it, and an AI defender reads `!repairing` to PACE its
   *  next repair order, so bots keep the retired channel's ~2 HP/s cadence
   *  instead of buying 15 HP every tick. A human is never gated by it —
   *  `placeOrder` lets a person tap as fast as they like, one purchase per tap. */
  repairing: boolean;
  /** Seconds left on the repair-tell hold before `repairing` releases — the
   *  bot-pacing cooldown behind the tell (`maintainRepairTell`). Optional and
   *  treated as `0` when absent, so hand-built `MiningStation` fixtures need not set it;
   *  `createWorld` seeds it to `0`. Never gates a human's `placeOrder`. */
  repairCooldown?: number;
  /** Seconds left on the repair COOLDOWN before this station will accept another
   *  repair order (RATIFIED developer, 2026-07-28). Unlike `repairCooldown` above
   *  — the tell-hold that never blocks a press — this one DOES gate `placeOrder`:
   *  while it is `> 0`, a repair press is refused `'cooling-down'`, spending
   *  nothing. Armed to `REPAIR_COOLDOWN_SECONDS` on a successful repair and
   *  ticked down every tick in `updateStations` (independent of docking, damage,
   *  or the tell, so it is a pure time lockout). Per STATION, so one cooling core
   *  never blocks another. Optional and treated as `0` when absent, so hand-built
   *  `MiningStation` fixtures need not set it; `createWorld` seeds it to `0`. The
   *  Build wheel reads it for the live "REPAIR in Ns" countdown. */
  repairGate?: number;
  turrets: Turret[];
  shields: Shield[];
  /**
   * Radar satellites orbiting this station (RATIFIED feature f1) — one per station
   * (`SATELLITE.capPerStation`), an array so the build/damage/sweep paths mirror
   * `turrets`/`shields`. Optional so the `MiningStation` literals other agents build
   * (net decode, render/bot fixtures) keep compiling — an absent array reads as
   * "no satellites", the same backward-compatible discipline as `team`; the sim's
   * own stations always carry it (`makeStation` sets `[]`). Never on the per-tick
   * snapshot — a satellite is a static-ish structure the client rebuilds from
   * entity events (like turrets/shields), same as `derelict`.
   */
  satellites?: RadarSatellite[];
  builds: BuildJob[];
}

/**
 * A turret shot. **Pooled**: slots are reused and `active` marks a live shot,
 * so a firefight allocates nothing per frame (GDD §4.3). Consumers — renderer,
 * snapshot encoder — must skip `active === false` slots rather than assume the
 * array is dense.
 */
export interface Projectile {
  id: number;
  active: boolean;
  /** Firing player, so a shot never hits its own fleet. */
  owner: PlayerId;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  radius: number;
  /** Seconds of flight left before it despawns. */
  life: number;
  /**
   * Ore this shot chips if it strikes an asteroid — mining is shooting now
   * (ratified amendment v0.3). One projectile carries two payloads: `damage` for
   * a hull/structure, `mineYield` for a rock, and what it hits first decides
   * which applies. Set on every ship weapon shot (`fireShipProjectile` =
   * `shipMineYield`); absent on a turret shot (turrets do not mine) and on a
   * wire-decoded shot, where it reads as `0` — the authoritative server already
   * chipped the ore, so a predicted/decoded shot must not chip it twice. Same
   * backward-compatible optional discipline as `kind` / `Turret.muzzle`.
   */
  mineYield?: number;
  /**
   * What fired this shot (design amendment v0.2): a `'ship'` weapon projectile or
   * a `'turret'` defensive shot. Both fly and die the same way; the difference is
   * the target list — a ship shot is siege-capable (it collides with enemy ships,
   * turrets, shields and cores), a turret shot hits only enemy ships, holding
   * p1-14's turret behaviour intact. It also lets the snapshot tint the two shots
   * apart in the reserved `meta` bits, and the renderer size them differently.
   *
   * Optional so the pooled `Projectile` literals other code builds (net wire
   * fixtures, the perf harness's `topUpProjectiles`) keep compiling — an
   * untagged shot is treated as a `'turret'` shot, exactly the pre-amendment
   * behaviour, the same backward-compatible discipline as `Turret.muzzle`.
   */
  kind?: 'ship' | 'turret';
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Rectangular play bounds; the ring of stations and the field sit inside. */
export interface Bounds {
  width: number;
  height: number;
}

/**
 * Per-player sensory MEMORY — the "remembered once seen" half of the minimap
 * fog-of-war (RATIFIED feature f1, item 1). Live entities (ships, projectiles,
 * satellites) are recomputed from CURRENT coverage every read, so they need no
 * memory; but static geography a player has scouted stays on the minimap after
 * their coverage moves off it, and that persistence has to be stored.
 *
 * Kept deliberately tiny and serializable: `seenStations[playerId]` is a BITMASK
 * of station board-ids (`MiningStation.id`, 0..7 — well under 32 bits) that player
 * has ever sensed. Monotonic — bits are only ever set, never cleared — so
 * "remembered" grows as a match is explored. Plain numbers, so it hashes and
 * snapshots with the rest of the world and can never desync a replay
 * (`./sensing` `updateSensory` writes it; `sensedState` reads it).
 *
 * Determinism: derived purely from world state each tick, so a replay from the
 * same inputs reproduces it exactly. It is sim-internal read-model support, not on
 * the per-tick network snapshot — a client runs the same sim and recomputes it.
 */
export interface SensoryMemory {
  /** `seenStations[playerId]` = bitmask of remembered `MiningStation.id`s. */
  seenStations: number[];
}

/**
 * Where the match is on its one-way road to an ending (GDD §2.3).
 *
 *  - `live`     — waves are still arriving or ore is still in the field.
 *  - `collapse` — the field is spent: no shield regeneration, no repair, no new
 *                 ore. Entropy finishes whoever the players don't (GDD §1).
 *  - `ended`    — one station left standing (or none, resolved last-to-die).
 */
export type MatchPhase = 'live' | 'collapse' | 'ended';

/**
 * The match's own state: the wave metronome, the collapse phase, and win/loss
 * (GDD §1, §2.3, §2.7). Plain data like everything else, so it snapshots and
 * hashes with the rest of the world.
 */
export interface MatchState {
  phase: MatchPhase;
  /** Waves delivered so far, 0..`WAVE_COUNT`. Wave 1 lands at match creation. */
  wavesSpawned: number;
  /** Sim time collapse began, or -1 while the field still has something in it.
   *  This — not `phase` — is the durable "collapse has happened" marker, so the
   *  collapse rules survive the transition to `ended`. */
  collapseTime: number;
  /**
   * Players eliminated, **in the order their cores reached zero**. This array is
   * the last-to-die tiebreak (GDD §1): if the final cores die in the same tick,
   * the last entry — the last core to reach zero in the simulation's resolution
   * order — is the winner.
   */
  eliminated: PlayerId[];
  /** The winning slot once `phase === 'ended'`; null until then, and null in the
   *  degenerate case where a match had nobody to win it. In TEAMS this is a
   *  *representative* survivor of the winning team (a real `PlayerId`), so every
   *  existing consumer that reads `winner === you` keeps working for the slot
   *  that actually held a core; {@link winningTeam} is the team-level answer. */
  winner: PlayerId | null;
  /**
   * The winning **team** once `phase === 'ended'` — the team that owns the last
   * surviving core(s) (Task D1, TEAMS). In FFA (teams-of-one) it equals `winner`.
   * Null until the match ends, and null in the degenerate no-winner case.
   *
   * Optional, the same backward-compatible discipline as `Ship.team`/`derelict`:
   * the many hand-built `MatchState` literals other lanes construct (art/vfx, ui,
   * net/bot fixtures) keep compiling, and a foreign match with no `winningTeam`
   * reads as "unset". Static result data — never on the per-tick snapshot.
   */
  winningTeam?: number | null;
  /** Sim time the match ended, or -1 while it runs. */
  endTime: number;
}

/** The complete simulation state for one match at one tick. Plain data. */
export interface World {
  /** Elapsed sim time, seconds. */
  time: number;
  /** Integer tick counter (increments once per `step`). */
  tick: number;
  /** mulberry32 state as a bare uint32 — serializable RNG (see module doc). */
  rngState: number;
  /** Monotonic id allocator for spawned entities (chunks, turrets, shields). */
  nextEntityId: number;
  ships: Ship[];
  asteroids: Asteroid[];
  chunks: OreChunk[];
  /** Home stations, one per slot, in the ring layout (GDD §2.1). */
  stations: MiningStation[];
  /** Turret shot pool — dense array, sparse liveness (see {@link Projectile}). */
  projectiles: Projectile[];
  bounds: Bounds;
  /** Radius of wave 1's scatter disc around the arena centre. Every later wave
   *  is a fraction of it (`waveRadiusFraction`), so the shrinking field is
   *  derived from one stored number rather than re-derived from the config. */
  fieldRadius: number;
  /** Rocks per wave (`WorldConfig.asteroidCount`, else the abundance-resolved
   *  `economy.asteroidsPerWave`). Stored so waves 2..5 are the same size as the
   *  opening field. */
  asteroidsPerWave: number;
  /**
   * The match's abundance-resolved economy (ore scarcity, p11): the field yield,
   * home/commons rock counts, and wave interval this match runs at, resolved once
   * at `createWorld` from `WorldConfig.abundance` (`./constants` `resolveEconomy`).
   * The sim's ore code reads THIS, never the raw baseline constants, so abundance
   * is per-world — one match can be SCARCE while another is RICH.
   *
   * Optional so the hand-built worlds other lanes construct (net snapshots, bot
   * fixtures, `@platform/freeze`) keep compiling; a world without one reads the
   * pre-p11 `standard` baseline everywhere (each consumer falls back to the
   * baseline constant), so foreign worlds are byte-for-byte unchanged. Static
   * match config, like `fieldRadius` — never on the per-tick snapshot, and not
   * fingerprinted by the determinism hash (`harness/hash.ts`), so accounting for
   * it never perturbs a replay.
   */
  economy?: ResolvedEconomy;
  /** Waves, collapse, and win/loss (GDD §1, §2.3). */
  match: MatchState;
  /**
   * Match-wide ore accounting (`./ore-ledger`). Optional so the hand-built worlds
   * other lanes construct (net snapshots, bot fixtures, `@platform/freeze`) still
   * satisfy the interface; `createWorld` always attaches one, and every ore
   * mutation funnels its delta through `ledgerAdd`, which no-ops when it is
   * absent. Write-only — the sim never reads it, so it never changes behaviour or
   * a determinism hash.
   */
  ledger?: OreLedger;
  /**
   * Per-player sensory memory — the "remembered once seen" static geography of the
   * minimap fog (RATIFIED feature f1; see {@link SensoryMemory}). Optional so the
   * hand-built worlds other lanes construct keep satisfying the interface;
   * `createWorld` always attaches one, `./sensing` `updateSensory` maintains it, and
   * `sensedState` degrades gracefully when it is absent (it still reports currently
   * covered + own stations, just without cross-tick memory).
   */
  sensory?: SensoryMemory;
}

// ---------------------------------------------------------------------------
// Seeded RNG over explicit state (ratified mulberry32, @shared/types)
// ---------------------------------------------------------------------------
//
// The generator itself lives in `./rng` (a leaf module, so `./waves` can draw
// from it without a cycle). Re-exported here because `world.rngState` is the
// state it threads, and callers reach for both together.

export { advanceRng, rngInt, rngRange } from './rng';
export type { RngDraw } from './rng';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** One player's lobby choice for a fresh match. */
export interface PlayerSpec {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
  /**
   * The side this player fights for (variable-slots Task A2). Optional so every
   * `PlayerSpec` literal other agents build (bots, harness, platform boot) keeps
   * compiling — an absent team defaults to the player's own id at world-build,
   * i.e. **FFA teams-of-one** (the same backward-compatible discipline as
   * `Ship.weaponCooldown`). TEAMS supplies it explicitly; `configToPlayers`
   * (`./match-config`) fills it from the lobby config. `areEnemies`
   * (`./allegiance`) only ever compares two teams for equality.
   */
  readonly team?: number;
}

/** Match-creation parameters. All deterministic given `seed`. */
export interface WorldConfig {
  readonly seed: number;
  readonly players: readonly PlayerSpec[];
  /**
   * Which ratified layout to build (`./maps`) — the arena bounds and where the
   * home stations sit. Defaults to `octagon` ("The Ring"), the hardwired default
   * until the picker (m8-02) lands. An unknown id falls back to the default, so
   * a stale saved key can never crash boot.
   */
  readonly mapId?: string;
  /** Play bounds (world units). Overrides the map's own bounds — the QA harness
   *  runs deliberately cramped worlds. */
  readonly bounds?: Bounds;
  /** Asteroids per wave, overriding the abundance-resolved count. Wave 1 is placed
   *  at construction, so this is also the opening field's rock count; the
   *  wave's *ore* budget is unchanged, so fewer rocks means richer ones (the
   *  finite field is the design constant, GDD §2.3). */
  readonly asteroidCount?: number;
  /**
   * Ore scarcity for this match (p11): `scarce | standard | rich`, a named
   * multiplier set over field density, total ore, and respawn interval
   * (`./constants` `ABUNDANCE`). Omitted → the pre-p11 `standard` baseline, so
   * every existing caller (tests, harness, foreign builders) is unchanged; the
   * lobby/room-ad default is SCARCE and rides `MatchConfig.abundance`, which the
   * world-build wiring passes here (`DEFAULT_ABUNDANCE`).
   */
  readonly abundance?: Abundance;
}

/** Build a ship at a spawn point with class-derived stats (GDD §2.11, §2.8).
 *  Every ship starts stock: hull and hold come from the same derived-stat
 *  functions a purchase runs through (`./upgrades`), so tier 0 is not a special
 *  case in the code any more than it is in the design. */
function makeShip(spec: PlayerSpec, pos: Vec2): Ship {
  const loadout = { shipClass: spec.shipClass, tiers: stockTiers() };
  const maxHull = shipMaxHull(loadout);
  return {
    id: spec.id,
    shipClass: spec.shipClass,
    // FFA teams-of-one: an unassigned spec fights as its own team (Task A2).
    team: spec.team ?? spec.id,
    tiers: loadout.tiers,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    home: { x: pos.x, y: pos.y },
    angle: 0,
    hull: maxHull,
    maxHull,
    cargo: 0,
    cargoCap: shipCargoCap(loadout),
    banked: STARTING_ORE,
    alive: true,
    respawnTimer: 0,
    spawnProtect: SPAWN_PROTECTION_S,
    eliminated: false,
    radius: SHIP_RADIUS,
    firing: false,
    weaponCooldown: 0,
    wedgeContactS: 0,
    wedgeAnchor: { x: pos.x, y: pos.y },
    wedgeSlide: { x: 0, y: 0 },
  };
}

/** Build a player's home station at its ring station (GDD §2.1, §2.8). */
function makeStation(spec: PlayerSpec, index: number, pos: Vec2, angle: number): MiningStation {
  return {
    id: index,
    owner: spec.id,
    // Same side as its owner's ship — FFA teams-of-one defaults to the owner id.
    team: spec.team ?? spec.id,
    pos: { x: pos.x, y: pos.y },
    radius: STATION.radius,
    coreHp: CORE_HP,
    maxCoreHp: CORE_HP,
    alive: true,
    deathTime: -1,
    spawnProtect: SPAWN_PROTECTION_S,
    angle,
    // No damage has ever landed, so the shield-regen window opens immediately
    // and a repair purchase is available from tick 0.
    sinceDamage: SHIELD.regenDelay,
    repairing: false,
    repairCooldown: 0,
    repairGate: 0,
    turrets: [],
    shields: [],
    satellites: [],
    builds: [],
  };
}

/**
 * Build a **derelict wreck** at an unused board position (the derelict-fill maps,
 * Milestone B). It is born dead — `alive: false`, `coreHp: 0`, `deathTime: 0` —
 * so every combat path treats it exactly like a home whose core was destroyed:
 * `damageStation`/siege collision/auto-aim all skip a dead core, and it carries no
 * turrets, shields, or builds to defend or lose. `owner`/`team` are its board
 * index, which is `>= N` (the live roster is the dense `0..N-1`), so no ship
 * shares them and `areEnemies` reads it as everyone's foe — harmless, since a
 * dead core is untargetable regardless. Its lootable debris is scattered
 * separately at world-build (`scatterDerelictLoot`).
 */
function makeDerelictStation(index: number, pos: Vec2, angle: number): MiningStation {
  return {
    id: index,
    owner: index,
    team: index,
    derelict: true,
    pos: { x: pos.x, y: pos.y },
    radius: STATION.radius,
    coreHp: 0,
    maxCoreHp: CORE_HP,
    alive: false,
    deathTime: 0,
    spawnProtect: 0,
    angle,
    sinceDamage: SHIELD.regenDelay,
    repairing: false,
    repairCooldown: 0,
    repairGate: 0,
    turrets: [],
    shields: [],
    satellites: [],
    builds: [],
  };
}

/** A fresh per-player sensory memory: nobody has scouted anything yet (every
 *  mask starts at 0). One slot per live player (`./sensing` `updateSensory` fills
 *  them each tick, own station included on the first pass). */
function initialSensory(playerCount: number): SensoryMemory {
  return { seenStations: new Array<number>(playerCount).fill(0) };
}

/** A fresh match's clock: nothing has spawned, collapsed, or been won yet. */
function initialMatch(): MatchState {
  return {
    phase: 'live',
    wavesSpawned: 0,
    collapseTime: -1,
    eliminated: [],
    winner: null,
    winningTeam: null,
    endTime: -1,
  };
}

/**
 * Which fair home slot each player takes, so **teammates spawn adjacent** (TEAMS,
 * developer report p14 "we should also spawn close together if we are teams").
 *
 * A map's live home slots are handed back in spatial-walk order — consecutive
 * slots are neighbouring positions on the arena (octagon's `2π/N` ring, oval's
 * angle-sorted rim, the compass/diamond eight-point walks all share this). So
 * grouping same-team players into **contiguous slot blocks** clusters each team
 * onto neighbouring homes, while the layout's own rotational symmetry keeps the
 * clusters equidistant across teams — team A's arc and team B's arc sit opposite
 * on the ring, exactly the "equal spacing ACROSS teams" fairness rule. Every home
 * is resource-identical by construction (`spawnHomeFields`), so which owner takes
 * which slot never changes per-player ore.
 *
 * Returns, for each player index, the home slot it occupies. Teams are laid down
 * in **first-seen order** and players within a team in id order — a pure,
 * sort-free grouping so replay is deterministic without leaning on `Array.sort`
 * stability. **FFA is teams-of-one:** every player is its own team, so the grouping
 * is the identity permutation and an FFA world is byte-for-byte unchanged.
 */
function teamHomeSlots(players: readonly PlayerSpec[]): number[] {
  const order: number[] = []; // team values, in first-seen order
  const buckets = new Map<number, number[]>(); // team → member player indices
  players.forEach((p, i) => {
    const team = p.team ?? p.id;
    let bucket = buckets.get(team);
    if (!bucket) {
      bucket = [];
      buckets.set(team, bucket);
      order.push(team);
    }
    bucket.push(i);
  });

  // slot k (spatially the k-th live home) is taken by the k-th player in the
  // team-grouped walk; invert that to "player i → its home slot".
  const slotOf = new Array<number>(players.length);
  let slot = 0;
  for (const team of order) for (const playerIndex of buckets.get(team)!) slotOf[playerIndex] = slot++;
  return slotOf;
}

/**
 * Construct a fresh, deterministic match world. Stations sit evenly around a
 * ring with each player's ship spawning in orbit of its own — inboard of the
 * station, facing the field (GDD §2.1); the opening field is **asteroid wave 1**,
 * scattered in the central disc from the seeded RNG (GDD §2.3 — the remaining
 * four waves arrive on the metronome, each closer to centre). In TEAMS, teammates
 * take contiguous home slots so a side spawns clustered ({@link teamHomeSlots}).
 * Same config ⇒ byte-identical world.
 */
export function createWorld(config: WorldConfig): World {
  // The layout owns the arena and where the homes sit (`./maps`); everything
  // downstream is the same code for every map. A caller may override the map's
  // own bounds (the QA harness runs cramped worlds).
  const map = getMap(config.mapId);
  const bounds: Bounds = config.bounds ?? map.bounds;
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;
  const halfMin = Math.min(bounds.width, bounds.height) / 2;
  // The commons scatter radius is a fraction of the arena, independent of the
  // map's station arrangement — mid-map is the centre for every layout.
  const ringRadius = halfMin * 2 * STATION.ringFraction;

  // The map's per-slot placements: station centre, inboard ship spawn, spoke
  // angle. Deterministic geometry (no RNG); the seed threads into the asteroid
  // scatter below, not the layout. NOTHING hugs the wall — each map sizes its
  // outermost stations to clear the bounds by `WORLD_EDGE_MARGIN` (field report
  // P1), and the spawners clamp everything else through the same margin.
  // A map returns one placement per board position: exactly `N` live homes for a
  // regenerate map (`octagon`/`oval`), or all eight for a derelict-fill map
  // (`compass`/`diamond`) with the `8-N` unused ones marked derelict. The live
  // homes come first, so they line up with the dense `0..N-1` player roster.
  const placements = map.stations(config.seed, config.players.length, bounds);
  const homes = placements.filter((p) => !p.derelict);

  // Which live home each player takes. In FFA this is the identity (teams-of-one),
  // so the board is unchanged; in TEAMS teammates get contiguous — hence spatially
  // adjacent — home slots, so a side spawns clustered ({@link teamHomeSlots}).
  const homeSlotOf = teamHomeSlots(config.players);

  // Ships spawn orbiting their (team-clustered) live home, one per lobby slot —
  // deterministic, no RNG. Derelict positions carry no ship.
  const ships: Ship[] = config.players.map((spec, i) => {
    const pos = homes[homeSlotOf[i]!]!.ship;
    const ship = makeShip(spec, pos);
    // Face inward toward the field so the opening read is legible.
    ship.angle = Math.atan2(cy - pos.y, cx - pos.x);
    return ship;
  });

  // A station per board position: a live home for each player (on the same spoke
  // as its ship, outboard of it), and an unowned wreck for each derelict position
  // — so the layout keeps its shape at any N. The station's array index stays its
  // board id: live homes keep ids `0..N-1` matching each owner id (so every
  // `stations[owner]` lookup is unmoved), while the team-clustered slot only moves
  // where each live station SITS; derelicts take the remaining board ids `>= N`.
  const stations: MiningStation[] = [];
  config.players.forEach((spec, i) => {
    const home = homes[homeSlotOf[i]!]!;
    stations.push(makeStation(spec, i, home.station, home.angle));
  });
  placements.forEach((place, index) => {
    if (place.derelict) stations.push(makeDerelictStation(index, place.station, place.angle));
  });

  // Resolve the abundance economy once (ore scarcity, p11). An omitted level reads
  // as the pre-p11 `standard` baseline (`resolveEconomy`'s default), so a bare
  // `createWorld` — every existing test, the harness, foreign builders — is
  // byte-for-byte unchanged; the SCARCE product default lives on `MatchConfig`
  // (`DEFAULT_ABUNDANCE`) and is passed in as `config.abundance` by the world-build
  // wiring. The `asteroidCount` override still wins over the density-scaled count.
  const economy = resolveEconomy(config.abundance, config.asteroidCount);

  const world: World = {
    time: 0,
    tick: 0,
    rngState: config.seed >>> 0,
    // The home fields take the first ids, then wave 1's commons; everything else
    // continues from there.
    nextEntityId: 0,
    ships,
    asteroids: [],
    chunks: [],
    stations,
    projectiles: [],
    bounds,
    // The commons scatter disc — a fraction of the ring, kept clear of every
    // home's measure radius so the two fields never overlap (`RESOURCE_FIELD`).
    fieldRadius: ringRadius * RESOURCE_FIELD.commonsRadiusFraction,
    asteroidsPerWave: economy.asteroidsPerWave,
    economy,
    match: initialMatch(),
    ledger: makeLedger(),
    // Per-player minimap fog memory (feature f1): one slot per live player, all
    // masks 0 (nothing scouted yet). `step`'s sensory pass fills them from tick 1,
    // starting with each player's own station (always in its own coverage).
    sensory: initialSensory(config.players.length),
  };

  // The fair opening layout, before the fight begins (field rule v0.1.2): the
  // identical per-station home neighbourhoods first, then wave 1 of the contested
  // commons. Waves 2..5 land on the metronome — the rock a player mines at t=0
  // and the rock that lands at t=600 come from one code path (`./waves`).
  spawnHomeFields(world);
  spawnWave(world);
  // Derelict wrecks are lootable (GDD §2.7, ratified 2026-07-26): each scatters a
  // ring of scavengeable debris at construction, the same burst a home leaves
  // when its core dies. Done after the fair field so the home + commons asteroid
  // ids are stamped first and unaffected by how many derelicts a map carries.
  scatterDerelictLoot(world);

  // Capture the t0 baseline and zero the flow counters the build fired (the
  // opening `spawnWave` bumped `injected`, derelict debris bumped `dropped`): from
  // here every source/transfer/sink the ledger records is real match activity, and
  // `seeded` is the clean starting total the conservation invariant balances
  // against (`./ore-ledger`).
  world.ledger = { ...makeLedger(), seeded: liveOre(world) };
  return world;
}

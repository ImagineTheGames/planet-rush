/**
 * src/art/vfx/observer.ts — the world, watched. OWNER: Art & Audio Agent.
 *
 * The simulation emits no events. That is deliberate and load-bearing: `src/sim/`
 * is "plain serializable data … no class instances, no functions" so two runs
 * `deepEqual` under the determinism replay and so a snapshot needs no bespoke
 * codec (GDD §4.1, §4.8). An event bus bolted onto it would be a second source
 * of truth for the Gameplay Engineer to keep in sync with the first.
 *
 * So art reads the world instead of being told about it: this class holds the
 * previous tick's numbers and turns the differences into {@link TellQueue}
 * entries. A crack stage that went up, a rock that vanished with its ore spent,
 * a turret whose cooldown just reset, a core that lost HP, a planet whose
 * `alive` flipped — each is a moment, and each becomes one tell that the VFX
 * field draws and the audio engine sounds.
 *
 * Two properties fall out of doing it this way, both of which matter:
 *
 *  1. **No sim change is needed for a new tell.** The Art agent adds tells
 *     without touching a file it does not own (GDD §3, ownership).
 *  2. **It works on state you did not simulate.** An online client renders
 *     server snapshots (GDD §4.2); diffing them is the same operation as
 *     diffing local ticks, so the tells fire identically online and offline.
 *
 * ## Structural types, not sim imports
 *
 * The views below are structural — a `World` satisfies {@link WorldView} without
 * `src/art/` importing `src/sim/`, the same discipline `../atlas.ts` uses. It
 * keeps the art module a leaf, and `observer.test.ts` asserts the real `World`
 * still satisfies the view, so a sim shape change fails a test here rather than
 * silently killing a tell.
 *
 * ## What it costs
 *
 * Steady state allocates nothing: the memo records are created when an entity is
 * first seen and reused every frame after, and tells are written into typed
 * arrays. New entities (a wave of rocks, a freshly built turret) allocate one
 * small record each and free it when the entity leaves. The hard zero-allocation
 * rule is on the particle pool (`./particles`), which is the one that runs at
 * thousands of items per frame.
 */

import { TELL, type TellQueue } from '../tells';

// ---------------------------------------------------------------------------
// The structural view of the world (satisfied by `src/sim/state.ts`)
// ---------------------------------------------------------------------------

/** A point. A sim `Vec2` satisfies it. */
export interface PointView {
  readonly x: number;
  readonly y: number;
}

/** The public muzzle geometry for the tick a turret fires (`Muzzle`, @shared/types). */
export interface MuzzleView {
  readonly origin: PointView;
  readonly dir: PointView;
  readonly hitPoint: PointView | null;
  readonly length: number;
}

/** Upgrade tiers, by track name (`UpgradeTiers`). */
export interface TiersView {
  readonly power: number;
  readonly engine: number;
  readonly cargo: number;
  readonly hull: number;
}

/** What the observer reads off a ship. */
export interface ShipView {
  readonly id: number;
  readonly pos: PointView;
  readonly vel: PointView;
  readonly angle: number;
  readonly radius: number;
  readonly alive: boolean;
  readonly hull: number;
  readonly maxHull: number;
  readonly cargo: number;
  readonly cargoCap: number;
  readonly banked: number;
  readonly spawnProtect: number;
  readonly tiers: TiersView;
  readonly firing: boolean;
}

/** What the observer reads off an asteroid. */
export interface AsteroidView {
  readonly id: number;
  readonly pos: PointView;
  readonly radius: number;
  readonly ore: number;
  readonly crackStage: number;
}

/** What the observer reads off a turret. */
export interface TurretView {
  readonly id: number;
  readonly pos: PointView;
  readonly radius: number;
  readonly angle: number;
  readonly cooldown: number;
  readonly hp: number;
  /** The muzzle geometry for the tick this turret fires, else null/absent. */
  readonly muzzle?: MuzzleView | null;
}

/** What the observer reads off a shield generator's bubble. */
export interface ShieldView {
  readonly id: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly radius: number;
}

/** What the observer reads off a build job. */
export interface BuildJobView {
  readonly id: number;
  readonly kind: 'turret' | 'shield';
  readonly remaining: number;
}

/** What the observer reads off a planet. */
export interface PlanetView {
  readonly id: number;
  readonly owner: number;
  readonly pos: PointView;
  readonly radius: number;
  readonly coreHp: number;
  readonly maxCoreHp: number;
  readonly alive: boolean;
  readonly angle: number;
  readonly repairing: boolean;
  readonly turrets: readonly TurretView[];
  readonly shields: readonly ShieldView[];
  readonly builds: readonly BuildJobView[];
}

/** What the observer reads off a pooled turret shot. */
export interface ProjectileView {
  readonly id: number;
  readonly active: boolean;
  readonly pos: PointView;
  readonly vel: PointView;
  readonly damage: number;
  readonly life: number;
}

/** What the observer reads off the match clock. */
export interface MatchView {
  readonly phase: string;
  readonly wavesSpawned: number;
  readonly winner: number | null;
}

/** The whole world, as art needs it. A sim `World` satisfies this. */
export interface WorldView {
  readonly time: number;
  readonly bounds: { readonly width: number; readonly height: number };
  readonly ships: readonly ShipView[];
  readonly asteroids: readonly AsteroidView[];
  readonly planets: readonly PlanetView[];
  readonly projectiles: readonly ProjectileView[];
  readonly match: MatchView;
}

// ---------------------------------------------------------------------------
// Tuning (visual references — deliberately not imported from src/sim/)
// ---------------------------------------------------------------------------

/**
 * Acceleration (units/s²) that reads as "full throttle" for the thruster trail.
 * Mirrors the sim's Vanguard `BASE_ACCEL` baseline, held here as a *visual*
 * reference so `src/art/` stays a leaf module: if the sim retunes thrust, the
 * trail gets a little longer or shorter and nothing breaks. TUNABLE.
 */
export const REFERENCE_ACCEL = 900;

/** Seconds between spawn-protection glow pulses (GDD §2.1, 10 s of protection). */
export const SPAWN_PULSE_S = 0.5;

/** Seconds between repair-channel pulses while the channel is held (GDD §2.5). */
export const REPAIR_PULSE_S = 0.45;

/** How close a shot hit must be to a hull-ish target to sound like hull, not rock. */
const HULL_HIT_SLOP = 6;

/**
 * Firing power a turret muzzle reads as, 0..1 — turrets carry no upgrade tier, so
 * the two firing voices ride a fixed reference rather than a per-shooter stat.
 * TUNABLE.
 */
const MUZZLE_POWER = 0.7;

/** Ore in one bank run that reads as "a full haul" — normalises `bankOre`. */
const BANK_REFERENCE = 8;

/** Highest upgrade tier a track offers, for normalising `upgradeBought`. */
const TIER_REFERENCE = 4;

// ---------------------------------------------------------------------------
// Memos — last tick's numbers, one small record per entity, reused
// ---------------------------------------------------------------------------

interface ShipMemo {
  alive: boolean;
  cargo: number;
  banked: number;
  tierSum: number;
  vx: number;
  vy: number;
  seen: number;
}

interface RockMemo {
  crack: number;
  ore: number;
  x: number;
  y: number;
  radius: number;
  seen: number;
}

interface PlanetMemo {
  coreHp: number;
  alive: boolean;
  repairTimer: number;
  seen: number;
}

interface TurretMemo {
  cooldown: number;
  x: number;
  y: number;
  angle: number;
  radius: number;
  /** The planet owner's slot. Kept because a dead turret has no planet to ask:
   *  the `turretDown` tell is emitted from the memo, and the under-attack alarm
   *  needs to know whose deterrent just died (GDD §2.2, `../audio/alarm`). */
  owner: number;
  seen: number;
}

interface ShieldMemo {
  hp: number;
  maxHp: number;
  radius: number;
  seen: number;
}

interface ProjectileMemo {
  active: boolean;
  life: number;
  x: number;
  y: number;
}

/** Options for {@link WorldObserver}. */
export interface ObserverOptions {
  /**
   * The player whose screen this is. Only used to colour the end-of-match tell
   * (won or lost) — every other tell is world-truth and identical for everyone.
   */
  readonly local?: number;
}

/**
 * Watches a world and writes the frame's tells into a queue.
 *
 * Call {@link observe} once per rendered frame with the current world and the
 * time since the last call. The **first** call primes the memos and emits
 * nothing: a fresh match should not open with eight spawn bangs and two hundred
 * rock cracks, and a client that joins mid-match should not replay the siege it
 * missed.
 */
export class WorldObserver {
  private readonly ships = new Map<number, ShipMemo>();
  private readonly rocks = new Map<number, RockMemo>();
  private readonly planets = new Map<number, PlanetMemo>();
  private readonly turrets = new Map<number, TurretMemo>();
  private readonly shields = new Map<number, ShieldMemo>();
  private readonly builds = new Map<number, { seen: number }>();
  /** Indexed by projectile *slot*, not id: the pool reuses slots (GDD §4.3). */
  private readonly shots: ProjectileMemo[] = [];

  private readonly local: number;

  private primed = false;
  private frame = 0;
  private pulseClock = 0;
  private wavesSeen = 0;
  private phaseSeen = 'live';
  private endedSeen = false;

  constructor(options: ObserverOptions = {}) {
    this.local = options.local ?? -1;
  }

  /** Forget everything — a new match, or a rejoin (GDD §4.2 reconnect grace). */
  reset(): void {
    this.ships.clear();
    this.rocks.clear();
    this.planets.clear();
    this.turrets.clear();
    this.shields.clear();
    this.builds.clear();
    this.shots.length = 0;
    this.primed = false;
    this.frame = 0;
    this.pulseClock = 0;
    this.wavesSeen = 0;
    this.phaseSeen = 'live';
    this.endedSeen = false;
  }

  /** True once the first frame has been absorbed; tells flow from the second on. */
  get ready(): boolean {
    return this.primed;
  }

  /**
   * Diff this frame against the last and queue the difference as tells.
   *
   * @param world The current world (local sim, or a server snapshot).
   * @param dt    Seconds since the previous call. Drives the periodic tells
   *              (spawn-protection pulse, repair channel) and the throttle read.
   * @param out   Queue to append to. Not cleared here — the caller owns its
   *              lifetime, so one queue can gather a frame from several sources.
   */
  observe(world: WorldView, dt: number, out: TellQueue): void {
    const step = dt > 0 ? dt : 0;
    this.frame++;
    const silent = !this.primed;

    // One clock for every protection glow on screen, so eight protected ships
    // pulse together instead of eight timers drifting apart.
    this.pulseClock += step;
    let pulse = false;
    if (this.pulseClock >= SPAWN_PULSE_S) {
      this.pulseClock %= SPAWN_PULSE_S;
      pulse = true;
    }

    this.observeShips(world, step, out, silent, pulse);
    this.observeRocks(world, out, silent);
    this.observePlanets(world, step, out, silent);
    this.observeMuzzles(world, out, silent);
    this.observeShots(world, step, out, silent);
    this.observeMatch(world, out, silent);

    this.primed = true;
  }

  // -------------------------------------------------------------------------
  // Ships: mine, die, respawn, thrust
  // -------------------------------------------------------------------------

  private observeShips(
    world: WorldView,
    dt: number,
    out: TellQueue,
    silent: boolean,
    pulse: boolean,
  ): void {
    for (const ship of world.ships) {
      const tierSum = ship.tiers.power + ship.tiers.engine + ship.tiers.cargo + ship.tiers.hull;
      let memo = this.ships.get(ship.id);
      if (!memo) {
        memo = {
          alive: ship.alive,
          cargo: ship.cargo,
          banked: ship.banked,
          tierSum,
          vx: ship.vel.x,
          vy: ship.vel.y,
          seen: this.frame,
        };
        this.ships.set(ship.id, memo);
        // A ship that appears after priming is a slot joining a live match.
        if (!silent && ship.alive) {
          out.push(TELL.shipSpawn, ship.pos.x, ship.pos.y, ship.angle, 1, ship.id);
        }
      }
      memo.seen = this.frame;

      if (!silent) {
        if (ship.alive && !memo.alive) {
          out.push(TELL.shipSpawn, ship.pos.x, ship.pos.y, ship.angle, 1, ship.id);
        } else if (!ship.alive && memo.alive) {
          // Explosions are fireworks (GDD §4.7) — sized by the hull that made it.
          const heading = Math.atan2(memo.vy, memo.vx);
          out.push(
            TELL.shipExplode,
            ship.pos.x,
            ship.pos.y,
            heading,
            clamp01(ship.radius / 16),
            ship.id,
          );
        }

        if (ship.alive) {
          // Ore in, one chunk at a time (GDD §2.3 tractor collection).
          if (ship.cargo > memo.cargo + 1e-6) {
            const full = ship.cargoCap > 0 ? clamp01(ship.cargo / ship.cargoCap) : 1;
            out.push(TELL.oreCollect, ship.pos.x, ship.pos.y, ship.angle, full, ship.id);
            // "Flashing when full" is a HUD mechanic (GDD §2.2); this is its
            // audible half, fired once on the transition rather than every tick.
            if (ship.cargoCap > 0 && ship.cargo >= ship.cargoCap - 1e-6 && memo.cargo < ship.cargoCap - 1e-6) {
              out.push(TELL.holdFull, ship.pos.x, ship.pos.y, ship.angle, 1, ship.id);
            }
          }
          if (ship.banked > memo.banked + 1e-6) {
            const amount = clamp01((ship.banked - memo.banked) / BANK_REFERENCE);
            out.push(TELL.bankOre, ship.pos.x, ship.pos.y, 0, amount, ship.id);
          }
          if (tierSum > memo.tierSum) {
            out.push(
              TELL.upgradeBought,
              ship.pos.x,
              ship.pos.y,
              0,
              clamp01(tierSum / TIER_REFERENCE),
              ship.id,
            );
          }

          this.observeThrust(ship, memo, dt, out);

          if (pulse && ship.spawnProtect > 0) {
            out.push(TELL.spawnPulse, ship.pos.x, ship.pos.y, ship.angle, 1, ship.id);
          }
        }
      }

      memo.alive = ship.alive;
      memo.cargo = ship.cargo;
      memo.banked = ship.banked;
      memo.tierSum = tierSum;
      memo.vx = ship.vel.x;
      memo.vy = ship.vel.y;
    }

    this.forget(this.ships);
  }

  /**
   * The two firing voices (GDD §3.6: "the distinct rock-vs-hull firing sounds").
   *
   * Since the laser retired to a projectile (amendment v0.3), the geometry that
   * classifies a shot as rock- or hull-biting is the turret muzzle (`Muzzle`,
   * `@shared/types`) — the one thing that still publishes *where* a shot struck.
   * The sim carries no art-facing target kind, so the observer classifies: hull-
   * ish targets are few (≤8 ships, ≤32 turrets, ≤16 shields, 8 cores) and rocks
   * are the default, which makes the check a short scan over the small set rather
   * than over ~200 rocks.
   */
  private observeMuzzles(world: WorldView, out: TellQueue, silent: boolean): void {
    if (silent) return;
    for (const planet of world.planets) {
      for (const turret of planet.turrets) {
        const muzzle = turret.muzzle;
        if (!muzzle || !muzzle.hitPoint || turret.hp <= 0) continue;
        const hx = muzzle.hitPoint.x;
        const hy = muzzle.hitPoint.y;
        const dir = Math.atan2(muzzle.dir.y, muzzle.dir.x);
        // Firing power reads as mining speed and weapon damage alike — one stat
        // (GDD §2.5), so one number scales both the spark burst and the gain.
        const kind = hitsHull(world, -1, hx, hy) ? TELL.weaponHit : TELL.mineHit;
        out.push(kind, hx, hy, dir, MUZZLE_POWER, planet.owner);
      }
    }
  }

  /**
   * Throttle, measured rather than told: the component of this frame's velocity
   * change along the ship's facing. Engine output is not in the state tree, and
   * this needs no constant from the sim to read it — a ship under power has its
   * nose pushing its own velocity, and a coasting one does not.
   */
  private observeThrust(ship: ShipView, memo: ShipMemo, dt: number, out: TellQueue): void {
    if (dt <= 0) return;
    const ax = (ship.vel.x - memo.vx) / dt;
    const ay = (ship.vel.y - memo.vy) / dt;
    const along = ax * Math.cos(ship.angle) + ay * Math.sin(ship.angle);
    const throttle = clamp01(along / REFERENCE_ACCEL);
    if (throttle <= 0.05) return;
    // The exhaust leaves from behind the hull, travelling backwards.
    const bx = ship.pos.x - Math.cos(ship.angle) * ship.radius;
    const by = ship.pos.y - Math.sin(ship.angle) * ship.radius;
    out.push(TELL.thrust, bx, by, ship.angle + Math.PI, throttle, ship.id);
  }

  // -------------------------------------------------------------------------
  // Asteroids: crack, and burst
  // -------------------------------------------------------------------------

  private observeRocks(world: WorldView, out: TellQueue, silent: boolean): void {
    for (const rock of world.asteroids) {
      let memo = this.rocks.get(rock.id);
      if (!memo) {
        memo = {
          crack: rock.crackStage,
          ore: rock.ore,
          x: rock.pos.x,
          y: rock.pos.y,
          radius: rock.radius,
          seen: this.frame,
        };
        this.rocks.set(rock.id, memo);
      } else if (!silent && rock.crackStage > memo.crack) {
        // "Asteroids visibly crack as they're mined" (GDD §2.2) — three stages.
        out.push(TELL.rockCrack, rock.pos.x, rock.pos.y, 0, clamp01(rock.crackStage / 2), -1);
      }
      memo.seen = this.frame;
      memo.crack = rock.crackStage;
      memo.ore = rock.ore;
      memo.x = rock.pos.x;
      memo.y = rock.pos.y;
      memo.radius = rock.radius;
    }

    // A rock that left the world was mined out: "burst into ore chunks that
    // drift toward nearby ships" (GDD §2.2). Its last known position is where.
    for (const [id, memo] of this.rocks) {
      if (memo.seen === this.frame) continue;
      if (!silent) {
        out.push(TELL.rockBurst, memo.x, memo.y, 0, clamp01(memo.radius / 24), -1);
      }
      this.rocks.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Planets: the siege, the build economy, and the one serious thing
  // -------------------------------------------------------------------------

  private observePlanets(world: WorldView, dt: number, out: TellQueue, silent: boolean): void {
    for (const planet of world.planets) {
      let memo = this.planets.get(planet.id);
      if (!memo) {
        memo = { coreHp: planet.coreHp, alive: planet.alive, repairTimer: 0, seen: this.frame };
        this.planets.set(planet.id, memo);
      }
      memo.seen = this.frame;

      if (!silent) {
        const fraction = planet.maxCoreHp > 0 ? clamp01(planet.coreHp / planet.maxCoreHp) : 0;
        if (planet.coreHp < memo.coreHp - 1e-6 && planet.alive) {
          out.push(TELL.coreHit, planet.pos.x, planet.pos.y, 0, fraction, planet.owner);
        }
        if (memo.alive && !planet.alive) {
          // The tone paragraph's moment (GDD §4.7). Everything downstream of
          // this tell — the hush, the smoke, the slow shards — hangs off it.
          out.push(
            TELL.planetDeath,
            planet.pos.x,
            planet.pos.y,
            planet.angle,
            clamp01(planet.radius / 64),
            planet.owner,
          );
        }

        // The repair channel is a held state, not an event: pulse it so it has
        // a heartbeat a player can hear stop when a hit interrupts it (§2.5).
        if (planet.repairing && planet.alive) {
          memo.repairTimer += dt;
          if (memo.repairTimer >= REPAIR_PULSE_S) {
            memo.repairTimer %= REPAIR_PULSE_S;
            out.push(TELL.repairTick, planet.pos.x, planet.pos.y, 0, fraction, planet.owner);
          }
        } else {
          memo.repairTimer = REPAIR_PULSE_S; // next channel opens on its first tick
        }
      }

      memo.coreHp = planet.coreHp;
      memo.alive = planet.alive;

      this.observeTurrets(planet, out, silent);
      this.observeShields(planet, out, silent);
      this.observeBuilds(planet, out, silent);
    }

    this.forget(this.planets);
    this.forget(this.builds);
  }

  private observeTurrets(planet: PlanetView, out: TellQueue, silent: boolean): void {
    for (const turret of planet.turrets) {
      let memo = this.turrets.get(turret.id);
      if (!memo) {
        memo = {
          cooldown: turret.cooldown,
          x: turret.pos.x,
          y: turret.pos.y,
          angle: turret.angle,
          radius: turret.radius,
          owner: planet.owner,
          seen: this.frame,
        };
        this.turrets.set(turret.id, memo);
        // A turret that appears is a build job that just finished (GDD §2.5).
        if (!silent) {
          out.push(TELL.buildComplete, turret.pos.x, turret.pos.y, turret.angle, 1, planet.owner);
        }
      } else if (!silent && turret.cooldown > memo.cooldown + 1e-6 && memo.cooldown <= 1e-6) {
        // The cooldown resetting is the shot: muzzle flash at the barrel tip.
        const mx = turret.pos.x + Math.cos(turret.angle) * turret.radius;
        const my = turret.pos.y + Math.sin(turret.angle) * turret.radius;
        out.push(TELL.turretFire, mx, my, turret.angle, 1, planet.owner);
      }
      memo.seen = this.frame;
      memo.cooldown = turret.cooldown;
      memo.x = turret.pos.x;
      memo.y = turret.pos.y;
      memo.angle = turret.angle;
      memo.radius = turret.radius;
      memo.owner = planet.owner;
    }

    for (const [id, memo] of this.turrets) {
      if (memo.seen === this.frame) continue;
      // "A patient attacker can pick off turrets from the edge of their range"
      // (GDD §2.6) — a deterrent dying is a tell the owner should hear, so it
      // carries the owner: this is one of the three damage kinds that ring the
      // under-attack alarm (GDD §2.2, "core, shield, or turrets").
      if (!silent) out.push(TELL.turretDown, memo.x, memo.y, memo.angle, 1, memo.owner);
      this.turrets.delete(id);
    }
  }

  private observeShields(planet: PlanetView, out: TellQueue, silent: boolean): void {
    for (const shield of planet.shields) {
      let memo = this.shields.get(shield.id);
      if (!memo) {
        memo = { hp: shield.hp, maxHp: shield.maxHp, radius: shield.radius, seen: this.frame };
        this.shields.set(shield.id, memo);
        if (!silent) {
          out.push(TELL.buildComplete, planet.pos.x, planet.pos.y, planet.angle, 0.5, planet.owner);
        }
      } else if (!silent && shield.hp < memo.hp - 1e-6) {
        // Shimmer scales with what is left: a failing bubble flickers thin.
        const strength = shield.maxHp > 0 ? clamp01(shield.hp / shield.maxHp) : 0;
        out.push(TELL.shieldHit, planet.pos.x, planet.pos.y, 0, strength, planet.owner);
      }
      memo.seen = this.frame;
      memo.hp = shield.hp;
      memo.maxHp = shield.maxHp;
      memo.radius = shield.radius;
    }

    for (const [id, memo] of this.shields) {
      if (memo.seen === this.frame) continue;
      // Pressure beat regeneration (GDD §2.6): the bubble is gone.
      if (!silent) {
        out.push(TELL.shieldDown, planet.pos.x, planet.pos.y, 0, clamp01(memo.radius / 64), planet.owner);
      }
      this.shields.delete(id);
    }
  }

  /**
   * Construction orders. A job id is world-unique, so the memo map spans every
   * planet and is pruned once per frame by {@link forget} — pruning it per
   * planet would drop the other seven planets' jobs and re-announce them on the
   * next frame.
   *
   * Only the *placing* is announced here. A job finishing is announced by the
   * turret or shield appearing, which is the moment the player can act on.
   */
  private observeBuilds(planet: PlanetView, out: TellQueue, silent: boolean): void {
    for (const job of planet.builds) {
      const memo = this.builds.get(job.id);
      if (memo) {
        memo.seen = this.frame;
        continue;
      }
      this.builds.set(job.id, { seen: this.frame });
      // Ore is spent when the order is placed; only time remains (GDD §2.5).
      if (!silent) {
        out.push(
          TELL.buildPlaced,
          planet.pos.x,
          planet.pos.y,
          planet.angle,
          job.kind === 'turret' ? 1 : 0.5,
          planet.owner,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Turret shots
  // -------------------------------------------------------------------------

  private observeShots(world: WorldView, dt: number, out: TellQueue, silent: boolean): void {
    const shots = world.projectiles;
    for (let i = 0; i < shots.length; i++) {
      const p = shots[i]!;
      let memo = this.shots[i];
      if (!memo) {
        memo = { active: p.active, life: p.life, x: p.pos.x, y: p.pos.y };
        this.shots[i] = memo;
      } else if (!silent && memo.active && !p.active) {
        // A slot going quiet is either a hit or a shot that ran out of road. A
        // shot with life left, inside the arena, hit something (`src/sim/`
        // deactivates on hit, on expiry, and on leaving the bounds).
        const expired = memo.life - dt <= 1e-6;
        const inside =
          p.pos.x >= 0 && p.pos.y >= 0 && p.pos.x <= world.bounds.width && p.pos.y <= world.bounds.height;
        if (!expired && inside) {
          const heading = Math.atan2(p.vel.y, p.vel.x);
          out.push(TELL.shotImpact, p.pos.x, p.pos.y, heading, clamp01(p.damage / 10), -1);
        }
      }
      memo.active = p.active;
      memo.life = p.life;
      memo.x = p.pos.x;
      memo.y = p.pos.y;
    }
    if (this.shots.length > shots.length) this.shots.length = shots.length;
  }

  // -------------------------------------------------------------------------
  // The clock
  // -------------------------------------------------------------------------

  private observeMatch(world: WorldView, out: TellQueue, silent: boolean): void {
    const match = world.match;
    const cx = world.bounds.width / 2;
    const cy = world.bounds.height / 2;

    if (!silent && match.wavesSpawned > this.wavesSeen) {
      // Each wave spawns closer to centre than the last (GDD §2.3) — the
      // metronome of the match, and the one clock every player shares.
      out.push(TELL.waveArrive, cx, cy, 0, clamp01(match.wavesSpawned / 5), -1);
    }
    this.wavesSeen = match.wavesSpawned;

    if (!silent && match.phase === 'collapse' && this.phaseSeen !== 'collapse') {
      out.push(TELL.collapseBegin, cx, cy, 0, 1, -1);
    }
    if (!silent && match.phase === 'ended' && !this.endedSeen) {
      const won = this.local >= 0 && match.winner === this.local ? 1 : 0;
      out.push(TELL.matchEnd, cx, cy, 0, won, match.winner ?? -1);
    }
    if (match.phase === 'ended') this.endedSeen = true;
    this.phaseSeen = match.phase;
  }

  // -------------------------------------------------------------------------

  /** Drop memos for entities that were not in the world this frame. */
  private forget(map: Map<number, { seen: number }>): void {
    for (const [id, memo] of map) if (memo.seen !== this.frame) map.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0;
}

/**
 * Did this shot land on something with a hull? Ships (other than the firer),
 * turrets, shield bubbles and planet cores all sound like metal; everything
 * else in weapon range is rock.
 */
function hitsHull(world: WorldView, firerId: number, x: number, y: number): boolean {
  for (const ship of world.ships) {
    if (!ship.alive || ship.id === firerId) continue;
    if (within(x, y, ship.pos, ship.radius)) return true;
  }
  for (const planet of world.planets) {
    if (within(x, y, planet.pos, planet.radius)) return true;
    for (const shield of planet.shields) {
      if (shield.hp > 0 && within(x, y, planet.pos, shield.radius)) return true;
    }
    for (const turret of planet.turrets) {
      if (within(x, y, turret.pos, turret.radius)) return true;
    }
  }
  return false;
}

function within(x: number, y: number, at: PointView, radius: number): boolean {
  const dx = x - at.x;
  const dy = y - at.y;
  const r = radius + HULL_HIT_SLOP;
  return dx * dx + dy * dy <= r * r;
}

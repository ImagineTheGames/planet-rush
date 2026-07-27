/**
 * tests/sim/target-priority.test.ts — the auto-aim priority ladder. OWNER:
 * Gameplay Engineer.
 *
 * Ratified (developer, p8): "If I'm near asteroids it should still target the
 * closest enemy in line of sight (unless he is not hittable)." Auto-aim target
 * selection is now a strict two-tier ladder, not a flat nearest-of-everything:
 *
 *   TIER 1 — the closest **hittable enemy** (ship / turret / core): an enemy per
 *     the same friend/foe + spawn-protection predicates a shot obeys, with a clear
 *     line of sight (a planet body or an asteroid across the path eats the shot).
 *   TIER 2 — only when no enemy is hittable, the closest **asteroid** (mining).
 *
 * A rock is mined ONLY when the field holds no reachable foe; "near a rock with an
 * enemy on screen" always shoots the enemy (`src/sim/step.ts` `acquireAimTarget`).
 *
 * These tests read the ladder off the real firing path: the shooter holds
 * auto-fire and the *direction of the projectile it looses* is the target it
 * picked (auto-aim fires straight at the chosen body — a lead only bends the aim
 * for a *moving* ship, and every target here is stationary, so the shot points
 * exactly at what was acquired). Fully deterministic: fixed timestep, no RNG on
 * the acquisition path, pure geometry.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Action, type Vec2 } from '@shared/types';
import {
  step,
  type Asteroid,
  type Inputs,
  type Planet,
  type Ship,
  type Turret,
  type World,
} from '../../src/sim';
import {
  ASTEROID,
  CORE_HP,
  PLANET,
  SHIELD,
  SHIP_RADIUS,
  TURRET,
  WEAPON_RANGE,
} from '../../src/sim';
import { shipCargoCap, shipMaxHull, stockTiers } from '../../src/sim';
import { normalize } from '../../src/sim/vec';

// --- fixtures (self-contained, no ring layout — cf. projectiles.test.ts) -----

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const loadout = { shipClass: cls, tiers: over.tiers ?? stockTiers() };
  return {
    id: over.id,
    shipClass: cls,
    tiers: loadout.tiers,
    pos: over.pos ?? { x: 0, y: 0 },
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? { x: 0, y: 0 },
    angle: over.angle ?? 0,
    hull: over.hull ?? shipMaxHull(loadout),
    maxHull: over.maxHull ?? shipMaxHull(loadout),
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? shipCargoCap(loadout),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    eliminated: over.eliminated ?? false,
    radius: over.radius ?? SHIP_RADIUS,
    firing: over.firing ?? false,
    weaponCooldown: over.weaponCooldown ?? 0,
  };
}

function makeTurret(over: Partial<Turret> & Pick<Turret, 'id' | 'owner'>): Turret {
  return {
    id: over.id,
    owner: over.owner,
    slot: over.slot ?? 0,
    pos: over.pos ?? { x: 0, y: 0 },
    radius: over.radius ?? TURRET.radius,
    hp: over.hp ?? TURRET.hp,
    maxHp: over.maxHp ?? TURRET.hp,
    angle: over.angle ?? 0,
    cooldown: over.cooldown ?? 0,
    targetId: over.targetId ?? null,
    muzzle: over.muzzle ?? null,
  };
}

function makePlanet(over: Partial<Planet> & Pick<Planet, 'id' | 'owner' | 'pos'>): Planet {
  return {
    id: over.id,
    owner: over.owner,
    pos: over.pos,
    radius: over.radius ?? PLANET.radius,
    coreHp: over.coreHp ?? CORE_HP,
    maxCoreHp: over.maxCoreHp ?? CORE_HP,
    alive: over.alive ?? true,
    deathTime: over.deathTime ?? -1,
    spawnProtect: over.spawnProtect ?? 0,
    angle: over.angle ?? 0,
    sinceDamage: over.sinceDamage ?? SHIELD.regenDelay,
    repairing: over.repairing ?? false,
    turrets: over.turrets ?? [],
    shields: over.shields ?? [],
    builds: over.builds ?? [],
  };
}

function makeAsteroid(over: Partial<Asteroid> & Pick<Asteroid, 'id' | 'pos'>): Asteroid {
  const maxOre = over.maxOre ?? 100000; // deep rock: survives long mining, index stable
  return {
    id: over.id,
    pos: over.pos,
    radius: over.radius ?? ASTEROID.minRadius,
    ore: over.ore ?? maxOre,
    maxOre,
    crackStage: over.crackStage ?? 0,
    mineBuffer: over.mineBuffer ?? 0,
    home: over.home ?? null,
  };
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships: over.ships ?? [],
    asteroids: over.asteroids ?? [],
    chunks: over.chunks ?? [],
    planets: over.planets ?? [],
    projectiles: over.projectiles ?? [],
    bounds: over.bounds ?? { width: 8000, height: 8000 },
    fieldRadius: over.fieldRadius ?? 600,
    asteroidsPerWave: over.asteroidsPerWave ?? 0,
    match: over.match ?? {
      phase: 'live',
      wavesSpawned: 0,
      collapseTime: -1,
      eliminated: [],
      winner: null,
      endTime: -1,
    },
  };
}

// --- reading the ladder off the shot ---------------------------------------

const FIRE_AUTO: Action = { type: 'fire', active: true, auto: true };

/** One tick with `shooter` holding auto-fire and every other body idle (no fire,
 *  no thrust — targets stay put, so a shot's aim is the exact bearing it picked). */
function tick(world: World, shooter: number): void {
  const inputs: Inputs = [{ id: shooter, actions: [FIRE_AUTO] }];
  step(world, inputs);
}

/** The id of the newest live projectile owned by `shooter`, or -1 if none. */
function newestShotId(world: World, shooter: number): number {
  let best = -1;
  for (const p of world.projectiles) {
    if (p.active && p.owner === shooter && p.id > best) best = p.id;
  }
  return best;
}

/** The most recent live projectile owned by `shooter`. */
function newestShot(world: World, shooter: number): { vel: Vec2 } {
  let best = -1;
  let found: { vel: Vec2 } | null = null;
  for (const p of world.projectiles) {
    if (p.active && p.owner === shooter && p.id > best) {
      best = p.id;
      found = p;
    }
  }
  if (!found) throw new Error('shooter has no live shot to read');
  return found;
}

/** Step until `shooter` looses a fresh shot (a new, higher projectile id), then
 *  return that shot's unit aim — the target the ladder just acquired. The very
 *  first tick fires immediately (cooldown starts ready); later measurements wait
 *  out the reload. */
function fireAim(world: World, shooter: number): Vec2 {
  const before = newestShotId(world, shooter);
  for (let k = 0; k < 400; k++) {
    tick(world, shooter);
    if (newestShotId(world, shooter) > before) break;
  }
  return normalize(newestShot(world, shooter).vel);
}

/** Whether a shot fired from `from` along unit `aim` is pointed straight at
 *  `target` (a stationary body: the auto-aim shot is the exact bearing). */
function aimsAt(aim: Vec2, from: Vec2, target: Vec2): boolean {
  const u = normalize({ x: target.x - from.x, y: target.y - from.y });
  return aim.x * u.x + aim.y * u.y > 0.9999;
}

// Two teams-of-one (FFA): every fixture uses ids 0 (shooter) and 1 (enemy), which
// `areEnemies` reads as foes by default (team = id).
const SHOOTER = 0;
const ENEMY = 1;
const ORIGIN: Vec2 = { x: 2000, y: 2000 };

// ---------------------------------------------------------------------------

describe('auto-aim priority ladder — enemies before rocks (ratified p8)', () => {
  it('TIER 1 wins: a closer asteroid is ignored while an enemy is in line of sight', () => {
    // Enemy on +x at 220u (in range); a CLOSER rock on +y at 100u. A flat
    // nearest-of-everything aimer would mine the rock; the ladder shoots the enemy.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const enemy = makeShip({ id: ENEMY, pos: { x: ORIGIN.x + 220, y: ORIGIN.y }, hull: 1e7, maxHull: 1e7 });
    const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x, y: ORIGIN.y + 100 } });
    const world = makeWorld({ ships: [shooter, enemy], asteroids: [rock] });

    const aim = fireAim(world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, enemy.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, rock.pos)).toBe(false);
  });

  it('TIER 2 fallback: a spawn-protected enemy is not hittable, so the rock is mined', () => {
    // The enemy is a legal foe standing in the clear, but under spawn protection a
    // shot passes over it (GDD §2.1) — it is not hittable, tier 1 is empty, and the
    // ladder falls through to the rock.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const enemy = makeShip({
      id: ENEMY,
      pos: { x: ORIGIN.x + 150, y: ORIGIN.y },
      spawnProtect: 10,
      hull: 1e7,
      maxHull: 1e7,
    });
    const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x, y: ORIGIN.y + 200 } });
    const world = makeWorld({ ships: [shooter, enemy], asteroids: [rock] });

    const aim = fireAim(world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, rock.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, enemy.pos)).toBe(false);
  });

  it('TIER 2 fallback: an enemy occluded by a planet body is not hittable, so the rock is mined', () => {
    // The enemy sits directly behind a planet on +x; auto-aim treats a planet body
    // as opaque (you do not shoot an enemy through a planet), so the enemy is not
    // hittable and the ladder mines the clear rock on +y. The occluder is the
    // shooter's OWN home, so it is never a target in its own right — this isolates
    // the line-of-sight rule from the tier-1 pick.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const home = makePlanet({ id: 9, owner: SHOOTER, pos: { x: ORIGIN.x + 110, y: ORIGIN.y } });
    const enemy = makeShip({ id: ENEMY, pos: { x: ORIGIN.x + 220, y: ORIGIN.y }, hull: 1e7, maxHull: 1e7 });
    const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x, y: ORIGIN.y + 150 } });
    const world = makeWorld({ ships: [shooter, enemy], asteroids: [rock], planets: [home] });

    const aim = fireAim(world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, rock.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, enemy.pos)).toBe(false);
  });

  it('TIER 2 fallback: an enemy occluded by an asteroid is not hittable — the ladder mines a clear rock', () => {
    // A rock squarely between the shooter and the enemy blocks the line ("you
    // cannot shoot through things"), so the enemy drops out of tier 1. A SECOND,
    // clear rock on +y (and closer) is the tier-2 pick — its distinct bearing
    // proves the enemy was rejected: were the block ignored, the shot would point
    // +x straight down the shooter→blocker→enemy line instead.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const blocker = makeAsteroid({ id: 5, pos: { x: ORIGIN.x + 120, y: ORIGIN.y }, radius: ASTEROID.maxRadius });
    const enemy = makeShip({ id: ENEMY, pos: { x: ORIGIN.x + 240, y: ORIGIN.y }, hull: 1e7, maxHull: 1e7 });
    const clear = makeAsteroid({ id: 6, pos: { x: ORIGIN.x, y: ORIGIN.y + 100 } });
    const world = makeWorld({ ships: [shooter, enemy], asteroids: [blocker, clear] });

    const aim = fireAim(world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, clear.pos)).toBe(true); // mined the clear rock (+y)
    expect(aimsAt(aim, ORIGIN, enemy.pos)).toBe(false); // never aimed at the occluded enemy (+x)
  });

  it('TIER 1, two enemies: the closest in line of sight is chosen', () => {
    // Enemy A on +x at 120u, enemy B on +y at 200u, both in the clear. Closest wins.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const near = makeShip({ id: ENEMY, pos: { x: ORIGIN.x + 120, y: ORIGIN.y }, hull: 1e7, maxHull: 1e7 });
    const far = makeShip({ id: 2, pos: { x: ORIGIN.x, y: ORIGIN.y + 200 }, hull: 1e7, maxHull: 1e7 });
    const world = makeWorld({ ships: [shooter, near, far] });

    const aim = fireAim(world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, near.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, far.pos)).toBe(false);
  });

  it('a turret and a core each outrank a closer rock (the full tier-1 target list)', () => {
    // No enemy ship: an enemy turret and an enemy core are tier-1 targets too, and
    // both beat a nearer rock. Turret on +x at 130u, core (planet) on +y at 170u,
    // a closer rock on −x at 90u; the closest tier-1 target (the turret) is picked.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const turret = makeTurret({ id: 7, owner: ENEMY, pos: { x: ORIGIN.x + 130, y: ORIGIN.y } });
    const planet = makePlanet({
      id: 9,
      owner: ENEMY,
      pos: { x: ORIGIN.x, y: ORIGIN.y + 170 },
      turrets: [turret],
    });
    const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x - 90, y: ORIGIN.y } });
    const world = makeWorld({ ships: [shooter], planets: [planet], asteroids: [rock] });

    const aim = fireAim(world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, turret.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, rock.pos)).toBe(false);
  });

  it('protection expiring mid-fight retargets: the rock is mined until grace lapses, then the enemy', () => {
    // A protected enemy in the clear + a rock: the ladder mines the rock while the
    // grace holds, and the moment protection lapses the very next acquisition tick
    // switches to the enemy — selection is re-run every tick, so the switch is
    // immediate, not sticky.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const enemy = makeShip({
      id: ENEMY,
      pos: { x: ORIGIN.x + 150, y: ORIGIN.y },
      spawnProtect: 0.2, // ~12 ticks of grace
      hull: 1e7,
      maxHull: 1e7,
    });
    const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x, y: ORIGIN.y + 200 } });
    const world = makeWorld({ ships: [shooter, enemy], asteroids: [rock] });

    // Under grace: the enemy is not hittable, so the shot mines the rock.
    const guarded = fireAim(world, SHOOTER);
    expect(aimsAt(guarded, ORIGIN, rock.pos)).toBe(true);
    expect(enemy.spawnProtect).toBeGreaterThan(0);

    // Fly out the rest of the grace (shooter keeps firing at the rock throughout).
    while (enemy.spawnProtect > 0) tick(world, SHOOTER);

    // The next shot after protection lapses locks onto the now-hittable enemy.
    const freed = fireAim(world, SHOOTER);
    expect(aimsAt(freed, ORIGIN, enemy.pos)).toBe(true);
    expect(aimsAt(freed, ORIGIN, rock.pos)).toBe(false);
  });

  it('is deterministic: identical worlds pick identical targets, shot-for-shot', () => {
    // Same scenario as tier-1-wins, built twice; the acquired aim must be bit-for-
    // bit identical (pure geometry, no RNG on the acquisition path).
    function scenario(): World {
      const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
      const enemy = makeShip({ id: ENEMY, pos: { x: ORIGIN.x + 220, y: ORIGIN.y }, hull: 1e7, maxHull: 1e7 });
      const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x, y: ORIGIN.y + 100 } });
      return makeWorld({ ships: [shooter, enemy], asteroids: [rock] });
    }
    const a = scenario();
    const b = scenario();

    const shotA = newestShotAfterFire(a);
    const shotB = newestShotAfterFire(b);
    expect(shotA.x).toBe(shotB.x);
    expect(shotA.y).toBe(shotB.y);
  });

  it('WEAPON_RANGE gate is unchanged: a rock just out of range is not mined even with no enemy', () => {
    // Nothing in range at all ⇒ hold fire (no shot at all). The gate that bounded
    // the old aimer still bounds both tiers.
    const shooter = makeShip({ id: SHOOTER, pos: { ...ORIGIN } });
    const rock = makeAsteroid({ id: 5, pos: { x: ORIGIN.x + WEAPON_RANGE + 50, y: ORIGIN.y } });
    const world = makeWorld({ ships: [shooter], asteroids: [rock] });

    for (let k = 0; k < 30; k++) tick(world, SHOOTER);
    expect(world.projectiles.some((p) => p.active && p.owner === SHOOTER)).toBe(false);
  });
});

/** Fire once and return the exact velocity of the shot — the determinism probe
 *  reads the raw numbers, not a normalized direction, so any drift shows. */
function newestShotAfterFire(world: World): Vec2 {
  const before = newestShotId(world, SHOOTER);
  for (let k = 0; k < 400; k++) {
    tick(world, SHOOTER);
    if (newestShotId(world, SHOOTER) > before) break;
  }
  return { ...newestShot(world, SHOOTER).vel };
}

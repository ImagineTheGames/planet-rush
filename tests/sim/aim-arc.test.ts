/**
 * tests/sim/aim-arc.test.ts — `AUTO_AIM_ARC` is a live knob. OWNER: Gameplay
 * Engineer (brief g6-01, audit item G-13).
 *
 * GDD §2.4: auto-aim "engages the nearest valid target — asteroid, ship, turret,
 * shield, or reactor — within weapon range, checked across the full 360° around
 * the ship, no front-arc restriction (`TUNABLE`)". The 360° is the ratified
 * behaviour; the `TUNABLE` is the promise that the arc is a number someone can
 * turn. Until g6-01 the behaviour was right by having *no arc check at all*, and
 * the constant was referenced by nothing — setting it to π would silently have
 * done nothing, the trap §2.8 retired `Sensor range` to avoid.
 *
 * So this file has to prove two things that pull in opposite directions:
 *
 *   1. **The default did not move.** At the shipped `2π` a target dead astern is
 *      still acquired and shot — the wiring bought no balance change.
 *   2. **The knob turns.** With `AUTO_AIM_ARC` re-bound to π, the *same world*
 *      produces a different game: the target behind stops being valid, and the
 *      ladder picks a farther one in front, or holds fire.
 *
 * (2) re-binds the constant by mocking `src/sim/constants` and re-importing the
 * sim, which is the only honest way to read a module-level `const`: it exercises
 * the real `step()`, not a copy of the arc arithmetic. Every assertion reads the
 * ladder the way `target-priority.test.ts` does — off the direction of the shot
 * the shooter actually looses, which for a stationary target is the exact bearing
 * of what it acquired.
 *
 * Deterministic: fixed timestep, no RNG on the acquisition path, pure geometry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ShipClass, type Action, type Vec2 } from '@shared/types';
import type { Asteroid, Inputs, Ship, World } from '../../src/sim';
import { normalize } from '../../src/sim/vec';

type Sim = typeof import('../../src/sim');
type Constants = typeof import('../../src/sim/constants');

/** The sim, loaded with `AUTO_AIM_ARC` re-bound to `arc` (or as shipped when
 *  `arc` is undefined). `vi.resetModules()` first, so `step.ts` re-evaluates its
 *  module-level arc constants against the value under test rather than the one
 *  the last case left behind. */
async function loadSim(arc?: number): Promise<Sim> {
  vi.resetModules();
  if (arc === undefined) {
    vi.doUnmock('../../src/sim/constants');
  } else {
    vi.doMock('../../src/sim/constants', async (importOriginal) => {
      const actual = await importOriginal<Constants>();
      return { ...actual, AUTO_AIM_ARC: arc };
    });
  }
  return (await import('../../src/sim')) as Sim;
}

afterEach(() => {
  vi.doUnmock('../../src/sim/constants');
  vi.resetModules();
});

// --- fixtures (self-contained; cf. tests/sim/target-priority.test.ts) --------

function makeShip(S: Sim, over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const loadout = { shipClass: cls, tiers: over.tiers ?? S.stockTiers() };
  return {
    id: over.id,
    shipClass: cls,
    tiers: loadout.tiers,
    pos: over.pos ?? { x: 0, y: 0 },
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? { x: 0, y: 0 },
    angle: over.angle ?? 0,
    hull: over.hull ?? S.shipMaxHull(loadout),
    maxHull: over.maxHull ?? S.shipMaxHull(loadout),
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? S.shipCargoCap(loadout),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    eliminated: over.eliminated ?? false,
    radius: over.radius ?? S.SHIP_RADIUS,
    firing: over.firing ?? false,
    weaponCooldown: over.weaponCooldown ?? 0,
  };
}

function makeAsteroid(S: Sim, over: Partial<Asteroid> & Pick<Asteroid, 'id' | 'pos'>): Asteroid {
  const maxOre = over.maxOre ?? 100000; // deep rock: survives long mining, index stable
  return {
    id: over.id,
    pos: over.pos,
    radius: over.radius ?? S.ASTEROID.minRadius,
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
    stations: over.stations ?? [],
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

// --- reading the arc off the shot -------------------------------------------

const FIRE_AUTO: Action = { type: 'fire', active: true, auto: true };

/** One tick with `shooter` holding auto-fire and everything else idle. */
function tick(S: Sim, world: World, shooter: number): void {
  const inputs: Inputs = [{ id: shooter, actions: [FIRE_AUTO] }];
  S.step(world, inputs);
}

/** The most recent live projectile owned by `shooter`, or null if it has not
 *  fired — "held fire" is an outcome this file asserts, so a missing shot is a
 *  result, not an error. */
function newestShot(world: World, shooter: number): { vel: Vec2 } | null {
  let best = -1;
  let found: { vel: Vec2 } | null = null;
  for (const p of world.projectiles) {
    if (p.active && p.owner === shooter && p.id > best) {
      best = p.id;
      found = p;
    }
  }
  return found;
}

/** Hold auto-fire for `ticks` and return the unit aim of the shot that came out,
 *  or null if the shooter never fired. The first tick fires immediately (the
 *  cooldown starts ready), so one tick is enough to read an acquisition. */
function aimHeld(S: Sim, world: World, shooter: number, ticks = 1): Vec2 | null {
  for (let k = 0; k < ticks; k++) tick(S, world, shooter);
  const shot = newestShot(world, shooter);
  return shot ? normalize(shot.vel) : null;
}

/** Whether a shot fired from `from` along unit `aim` points straight at a
 *  stationary `target`. */
function aimsAt(aim: Vec2 | null, from: Vec2, target: Vec2): boolean {
  if (!aim) return false;
  const u = normalize({ x: target.x - from.x, y: target.y - from.y });
  return aim.x * u.x + aim.y * u.y > 0.9999;
}

// Two teams-of-one (FFA): ids 0 (shooter) and 1/2 (enemies) are foes by default.
const SHOOTER = 0;
const ENEMY = 1;
const ORIGIN: Vec2 = { x: 2000, y: 2000 };
const FAT_HULL = { hull: 1e7, maxHull: 1e7 };

// ---------------------------------------------------------------------------
// 1. The ratified default — 360°, unchanged by the wiring
// ---------------------------------------------------------------------------

describe('AUTO_AIM_ARC at its ratified 2π — the full 360° (GDD §2.4)', () => {
  it('ships the full circle', async () => {
    const S = await loadSim();
    expect(S.AUTO_AIM_ARC).toBe(2 * Math.PI);
  });

  it('acquires an enemy DEAD ASTERN — the behaviour the knob must not have changed', async () => {
    // The shooter faces +x (angle 0); the only enemy is at 180°, directly behind.
    // This is the assertion that catches a "wiring fix" that smuggled in a front
    // arc: with any arc < 2π this enemy stops being valid and the shot vanishes.
    const S = await loadSim();
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const astern = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x - 200, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, astern] });

    expect(aimsAt(aimHeld(S, world, SHOOTER), ORIGIN, astern.pos)).toBe(true);
  });

  it('mines a rock dead astern too — tier 2 is inside the same full circle', async () => {
    const S = await loadSim();
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const rock = makeAsteroid(S, { id: 5, pos: { x: ORIGIN.x - 180, y: ORIGIN.y } });
    const world = makeWorld({ ships: [shooter], asteroids: [rock] });

    expect(aimsAt(aimHeld(S, world, SHOOTER), ORIGIN, rock.pos)).toBe(true);
  });

  it('takes the NEAREST target even when the nearest is behind', async () => {
    // Near enemy astern at 120u, far enemy ahead at 240u. The full circle picks
    // the near one; §2 turns the knob on this exact world and gets the other.
    const S = await loadSim();
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const near = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x - 120, y: ORIGIN.y }, ...FAT_HULL });
    const far = makeShip(S, { id: 2, pos: { x: ORIGIN.x + 240, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, near, far] });

    const aim = aimHeld(S, world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, near.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, far.pos)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Turning the knob changes the game
// ---------------------------------------------------------------------------

describe('AUTO_AIM_ARC turned down to π — a ±90° front arc', () => {
  it('drops an enemy dead astern: the shooter holds fire', async () => {
    const S = await loadSim(Math.PI);
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const astern = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x - 200, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, astern] });

    // Ten ticks, not one: nothing turns the hull toward a target it never
    // acquired, so "no shot yet" cannot be a reload artefact.
    expect(aimHeld(S, world, SHOOTER, 10)).toBeNull();
    expect(world.ships[0]!.firing).toBe(false);
  });

  it('still engages an enemy ahead — the arc narrows targeting, it does not disable it', async () => {
    const S = await loadSim(Math.PI);
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const ahead = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x + 200, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, ahead] });

    expect(aimsAt(aimHeld(S, world, SHOOTER), ORIGIN, ahead.pos)).toBe(true);
  });

  it('picks a FARTHER enemy in front over a nearer one behind — the same world, a different game', async () => {
    // Byte-identical fixture to the "nearest even when behind" case above; only
    // the knob moved. That is the whole point of the brief: turning it has to
    // change what the sim does.
    const S = await loadSim(Math.PI);
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const near = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x - 120, y: ORIGIN.y }, ...FAT_HULL });
    const far = makeShip(S, { id: 2, pos: { x: ORIGIN.x + 240, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, near, far] });

    const aim = aimHeld(S, world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, far.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, near.pos)).toBe(false);
  });

  it('gates rocks by the same arc: a rock behind is not mined, one ahead is', async () => {
    const S = await loadSim(Math.PI);
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const behind = makeAsteroid(S, { id: 5, pos: { x: ORIGIN.x - 100, y: ORIGIN.y } });
    const ahead = makeAsteroid(S, { id: 6, pos: { x: ORIGIN.x + 240, y: ORIGIN.y } });
    const world = makeWorld({ ships: [shooter], asteroids: [behind, ahead] });

    const aim = aimHeld(S, world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, ahead.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, behind.pos)).toBe(false);
  });

  it('is centred on the ship’s FACING, not on the world axis', async () => {
    // Same geometry as the "holds fire" case, with the hull turned to face the
    // enemy's bearing: the target is now inside the arc and is engaged. The gate
    // reads `ship.angle`, so a pilot re-acquires by turning around.
    const S = await loadSim(Math.PI);
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: Math.PI });
    const astern = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x - 200, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, astern] });

    expect(aimsAt(aimHeld(S, world, SHOOTER), ORIGIN, astern.pos)).toBe(true);
  });

  it('holds the arc EDGE: a target 80° off is valid, one 100° off is not', async () => {
    // π means ±90°. Two enemies at equal range, one just inside the edge and one
    // just outside, so the pick names the boundary rather than merely "in front".
    const S = await loadSim(Math.PI);
    const R = 200;
    const at = (deg: number): Vec2 => ({
      x: ORIGIN.x + R * Math.cos((deg * Math.PI) / 180),
      y: ORIGIN.y + R * Math.sin((deg * Math.PI) / 180),
    });
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const outside = makeShip(S, { id: ENEMY, pos: at(-100), ...FAT_HULL });
    const inside = makeShip(S, { id: 2, pos: at(80), ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, outside, inside] });

    const aim = aimHeld(S, world, SHOOTER);
    expect(aimsAt(aim, ORIGIN, inside.pos)).toBe(true);
    expect(aimsAt(aim, ORIGIN, outside.pos)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The degenerate end of the range
// ---------------------------------------------------------------------------

describe('AUTO_AIM_ARC at 0 — the knob is a real range, not a two-state switch', () => {
  it('acquires only what is exactly down the barrel', async () => {
    const S = await loadSim(0);
    const shooter = makeShip(S, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 });
    const dead = makeShip(S, { id: ENEMY, pos: { x: ORIGIN.x + 200, y: ORIGIN.y }, ...FAT_HULL });
    const world = makeWorld({ ships: [shooter, dead] });
    expect(aimsAt(aimHeld(S, world, SHOOTER), ORIGIN, dead.pos)).toBe(true);

    // One degree off the barrel is outside a zero-width arc.
    const S2 = await loadSim(0);
    const off = makeShip(S2, {
      id: ENEMY,
      pos: { x: ORIGIN.x + 200 * Math.cos(Math.PI / 180), y: ORIGIN.y + 200 * Math.sin(Math.PI / 180) },
      ...FAT_HULL,
    });
    const world2 = makeWorld({ ships: [makeShip(S2, { id: SHOOTER, pos: { ...ORIGIN }, angle: 0 }), off] });
    expect(aimHeld(S2, world2, SHOOTER, 10)).toBeNull();
  });
});

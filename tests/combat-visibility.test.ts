/**
 * tests/combat-visibility.test.ts — every shooter is seen (GDD §2.3, §2.6, §4.1).
 *
 * Field report against build 5254cfe: "another enemy attacking my planet but I
 * didn't see his shots… I also don't think my turret was firing." Two shooters
 * the player could not see: a rival ship's fire, and a friendly turret's fire.
 *
 * The root is a rendering one, but the fix is anchored in the sim: combat visuals
 * must be driven from **combat state**, not from the local player's fire input.
 * A ship's shots stream as pooled projectiles (drawn from the shot pool since the
 * v0.3 laser funeral), and the sim publishes `Turret.muzzle` for every turret that
 * looses a shot; the `muzzleFlashes` read model (src/sim/combat-view.ts) is the
 * single source a renderer draws turret flashes from, so an enemy ship, a bot, a
 * remote player, and a turret all show up regardless of who the camera follows.
 *
 * This test steps a world where (a) an enemy ship fires at a planet and (b) a
 * friendly turret engages an in-range enemy, and asserts that the sim reports
 * both shots and that the render layer registers both — the ship as a projectile,
 * the turret as a muzzle flash sourced from sim state, origin at the barrel and a
 * short flare off the muzzle: a burst, **never a line to the target** (the mining
 * laser retired to a projectile — v0.2.2 field report). It drives the real
 * `Renderer` headlessly (Pixi builds Graphics geometry with no WebGL), the same
 * way src/render/muzzle.test.ts does.
 */

import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer, PLAYER_COLORS, type MuzzleView } from '../src/render/index';
import {
  CORE_HP,
  PLANET,
  TURRET,
  muzzleFlashes,
  createWorld,
  step,
  type MuzzleFlash,
  type Turret,
  type World,
} from '../src/sim';

// ---------------------------------------------------------------------------
// Fixture: one world holding both shooters at once, in two separate corners so
// their shots never interfere. Positions are overwritten after construction —
// the ring layout is irrelevant to what this test measures.
// ---------------------------------------------------------------------------

/** How far short of the planet the attacker parks: comfortably inside weapon
 *  range, so the shot reaches the core surface (planet radius + this < range). */
const ATTACK_STANDOFF = 100;
/** How far the turret's prey sits from the muzzle — well inside `TURRET.range`. */
const TURRET_STANDOFF = 150;

interface Fixture {
  world: World;
  turret: Turret;
  attackerPos: { x: number; y: number };
  preyPos: { x: number; y: number };
  planetPos: { x: number; y: number };
}

function combatFixture(): Fixture {
  const world = createWorld({
    seed: 3,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard }, // the attacker
      { id: 1, shipClass: ShipClass.Vanguard }, // owns the firing turret
      { id: 2, shipClass: ShipClass.Vanguard }, // the turret's prey / attacker's mark's owner
    ],
    bounds: { width: 4000, height: 4000 },
  });
  // Hand-built siege fixture: clear the field so the only thing the attacker's
  // shot can strike is the planet it is aimed at (a stray rock scattered in the
  // central disc would otherwise intercept the shot and steal the hit).
  world.asteroids = [];

  const attacker = world.ships[0]!;
  const prey = world.ships[2]!;
  const targetPlanet = world.planets[2]!; // owned by player 2 — the attacker's mark
  const turretPlanet = world.planets[1]!; // owned by player 1 — mounts the turret

  // (a) Enemy ship firing at a planet. Park the attacker one standoff short of
  //     planet 2, nose straight on it, and drop the core's spawn shield so it is
  //     a legal target (GDD §2.1).
  const planetPos = { x: 1000, y: 1000 };
  targetPlanet.pos = { x: planetPos.x, y: planetPos.y };
  targetPlanet.spawnProtect = 0;
  const attackerPos = { x: planetPos.x - (PLANET.radius + ATTACK_STANDOFF), y: planetPos.y };
  attacker.pos = { x: attackerPos.x, y: attackerPos.y };
  attacker.vel = { x: 0, y: 0 };
  attacker.angle = 0; // facing +x, straight at the planet
  attacker.spawnProtect = 0;

  // (b) Friendly turret engaging an in-range enemy. Mount a live, loaded turret
  //     on planet 1 and drop its prey (ship 2) inside range, unprotected.
  turretPlanet.pos = { x: 3000, y: 3000 };
  const turret: Turret = {
    id: 9001,
    owner: 1,
    slot: 0,
    pos: { x: 3000, y: 3000 },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    angle: 0,
    cooldown: 0, // ready to loose a shot this very tick
    targetId: null,
    muzzle: null,
  };
  turretPlanet.turrets = [turret];
  const preyPos = { x: 3000 + TURRET_STANDOFF, y: 3000 };
  prey.pos = { x: preyPos.x, y: preyPos.y };
  prey.vel = { x: 0, y: 0 };
  prey.spawnProtect = 0;

  return { world, turret, attackerPos, preyPos, planetPos };
}

/** The attacker holds fire in Manual mode; nobody else sends input. */
const ATTACKER_FIRES = [{ id: 0, actions: [{ type: 'fire' as const, active: true, auto: false }] }];

/** Map one sim muzzle flash to the render layer's `MuzzleView` — exactly the tiny
 *  adaptation the client does each frame: geometry from sim state, colour from
 *  the shooter's player slot (style-guide §3). */
function toMuzzleView(m: MuzzleFlash): MuzzleView {
  return {
    from: m.origin,
    to: { x: m.origin.x + m.dir.x * m.length, y: m.origin.y + m.dir.y * m.length },
    color: PLAYER_COLORS[m.shooter] ?? 0x4dc3ff,
    hit: m.hitPoint,
  };
}

function muzzleLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('muzzles', true);
  if (!layer) throw new Error('muzzles layer missing');
  return layer as Container;
}

function impactLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('impacts', true);
  if (!layer) throw new Error('impacts layer missing');
  return layer as Container;
}

function shotLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('shots', true);
  if (!layer) throw new Error('shots layer missing');
  return layer as Container;
}

function visibleChildren(layer: Container): Graphics[] {
  return layer.children.filter((c) => c.visible) as Graphics[];
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------

describe('combat visibility — every shooter is seen from sim state', () => {
  it('an enemy ship attacking a planet is seen — its weapon fire streams as a projectile', () => {
    const { world, attackerPos } = combatFixture();
    step(world, ATTACKER_FIRES);

    // Combat is a projectile now (design amendment v0.2), not a hitscan ray:
    // the attacker fired a ship-kind shot owned by the NON-local shooter — the
    // whole point of the original bug. It is born at the attacker's muzzle,
    // heading +x straight at the planet.
    const shots = world.projectiles.filter((p) => p.active && p.owner === 0 && p.kind === 'ship');
    expect(shots).toHaveLength(1);
    expect(dist(shots[0]!.pos, attackerPos)).toBeLessThan(30);
    expect(shots[0]!.vel.x).toBeGreaterThan(0);

    // The renderer draws it from sim state — `drawShots` pools every active shot,
    // ship and turret alike — so it is visible even though the camera follows a
    // different player (the attacker is not the local slot).
    const stage = new Container();
    const renderer = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    renderer.draw(world, { cameraTarget: 1, muzzles: [] });
    expect(visibleChildren(shotLayer(stage)).length).toBeGreaterThanOrEqual(1);

    // And it is a real attack, not a light show: the shot reaches and bites the core.
    for (let t = 0; t < 40 && world.planets[2]!.coreHp >= CORE_HP; t++) step(world, []);
    expect(world.planets[2]!.coreHp).toBeLessThan(CORE_HP);
  });

  it('a friendly turret engaging an in-range enemy fires, deals damage, and publishes a muzzle flash', () => {
    const { world, turret, preyPos } = combatFixture();

    // First tick: the loaded turret looses a shot at the prey.
    step(world, ATTACKER_FIRES);
    expect(turret.targetId).toBe(2); // acquired the unprotected enemy, not its owner
    expect(world.projectiles.some((p) => p.active && p.owner === 1)).toBe(true);

    // Its muzzle tell is published from sim combat state, origin at the barrel,
    // and a short flare off the muzzle — NOT a line to the prey (GDD §2.6). The
    // projectile owns the shot and its impact, so the flash carries no hit point.
    expect(turret.muzzle).not.toBeNull();
    const m = turret.muzzle!;
    expect(dist(m.origin, turret.pos)).toBeCloseTo(TURRET.radius, 4);
    expect(m.hitPoint).toBeNull();
    expect(m.length).toBe(TURRET.muzzleFlashLength);
    // The flare's far end stays right at the barrel — it covers only a sliver of
    // the gap, leaving well over half the standoff still between it and the prey.
    const flareEnd = { x: m.origin.x + m.dir.x * m.length, y: m.origin.y + m.dir.y * m.length };
    expect(dist(flareEnd, preyPos)).toBeGreaterThan(TURRET_STANDOFF / 2);

    // And the shot deals damage: step until the projectile reaches the prey.
    const prey = world.ships[2]!;
    const startHull = prey.hull;
    for (let t = 0; t < 40 && prey.hull >= startHull; t++) step(world, []);
    expect(prey.hull).toBeLessThan(startHull);
  });

  it('both shooters are seen from sim state — the turret as a muzzle flash, the ship as a projectile', () => {
    const { world } = combatFixture();
    step(world, ATTACKER_FIRES);

    // The turret's shot publishes a muzzle flash (GDD §2.6); the attacking ship's
    // weapon is a projectile now, not a line — so `muzzleFlashes` carries exactly
    // the one turret muzzle, and the ship shows in the shot pool.
    const flashes = muzzleFlashes(world);
    expect(flashes).toHaveLength(1);
    expect(flashes[0]!.shooter).toBe(1); // the turret owner, a non-local slot

    const shipShots = world.projectiles.filter((p) => p.active && p.owner === 0 && p.kind === 'ship');
    expect(shipShots).toHaveLength(1);

    // Drive the real renderer headlessly with the sim-sourced views. The turret's
    // flash draws in the muzzles layer; every active shot (ship + turret) draws in
    // the shots layer — so neither shooter is invisible, whoever the camera follows.
    const stage = new Container();
    const renderer = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const views = flashes.map(toMuzzleView);
    renderer.draw(world, { cameraTarget: 2, muzzles: views });

    expect(visibleChildren(muzzleLayer(stage))).toHaveLength(1); // turret muzzle
    expect(visibleChildren(shotLayer(stage)).length).toBeGreaterThanOrEqual(2); // ship + turret shots
    // The flash is a burst at the muzzle, not a beam to the prey: it publishes no
    // hit point, so the renderer paints NO impact glow out at the target from it
    // (the projectile owns the impact now — v0.2.2 field report).
    const glows = visibleChildren(impactLayer(stage));
    expect(glows).toHaveLength(0);
  });
});

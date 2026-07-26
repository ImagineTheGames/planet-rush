/**
 * tests/combat-visibility.test.ts — every shooter is seen (GDD §2.3, §2.6, §4.1).
 *
 * Field report against build 5254cfe: "another enemy attacking my planet but I
 * didn't see his laser… I also don't think my turret was firing." Two shooters
 * the player could not see: a rival ship's beam, and a friendly turret's fire.
 *
 * The root is a rendering one, but the fix is anchored in the sim: beam visuals
 * must be driven from **combat state**, not from the local player's fire input.
 * The sim already publishes `Ship.beam` for every firing ship in the world, and
 * now publishes `Turret.muzzle` for every turret that looses a shot; the
 * `combatBeams` read model (src/sim/combat-view.ts) is the single source a
 * renderer draws from, so an enemy ship, a bot, a remote player, and a turret
 * all show up exactly the way the local player's own beam does.
 *
 * This test steps a world where (a) an enemy ship fires at a planet and (b) a
 * friendly turret engages an in-range enemy, and asserts that the sim reports
 * both shots and that the render layer registers an active beam visual for
 * BOTH — sourced from sim state, origin at the shooter, end clamped to the hit
 * target. It drives the real `Renderer` headlessly (Pixi builds Graphics
 * geometry with no WebGL), the same way src/render/beam.test.ts does.
 */

import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer, PLAYER_COLORS, type BeamView } from '../src/render/index';
import {
  CORE_HP,
  PLANET,
  TURRET,
  combatBeams,
  createWorld,
  step,
  type CombatBeam,
  type Turret,
  type World,
} from '../src/sim';

// ---------------------------------------------------------------------------
// Fixture: one world holding both shooters at once, in two separate corners so
// their beams never interfere. Positions are overwritten after construction —
// the ring layout is irrelevant to what this test measures.
// ---------------------------------------------------------------------------

/** How far short of the planet the attacker parks: comfortably inside beam
 *  range, so the ray reaches the core surface (planet radius + this < range). */
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
  // beam can strike is the planet it is aimed at (a stray rock scattered in the
  // central disc would otherwise intercept the ray and steal the hit).
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

/** Map one sim combat beam to the render layer's `BeamView` — exactly the tiny
 *  adaptation the client does each frame: geometry from sim state, colour from
 *  the shooter's player slot (style-guide §3). */
function toBeamView(b: CombatBeam): BeamView {
  return {
    from: b.origin,
    to: { x: b.origin.x + b.dir.x * b.length, y: b.origin.y + b.dir.y * b.length },
    color: PLAYER_COLORS[b.shooter] ?? 0x4dc3ff,
    hit: b.hitPoint,
  };
}

function beamLayer(stage: Container): Container {
  const layer = stage.getChildByLabel('beams', true);
  if (!layer) throw new Error('beams layer missing');
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

    // Combat is a projectile now (design amendment v0.2), not the mining beam:
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
    renderer.draw(world, { cameraTarget: 1, beams: [] });
    expect(visibleChildren(shotLayer(stage)).length).toBeGreaterThanOrEqual(1);

    // And it is a real attack, not a light show: the shot reaches and bites the core.
    for (let t = 0; t < 40 && world.planets[2]!.coreHp >= CORE_HP; t++) step(world, []);
    expect(world.planets[2]!.coreHp).toBeLessThan(CORE_HP);
  });

  it('a friendly turret engaging an in-range enemy fires, deals damage, and publishes a muzzle beam', () => {
    const { world, turret, preyPos } = combatFixture();

    // First tick: the loaded turret looses a shot at the prey.
    step(world, ATTACKER_FIRES);
    expect(turret.targetId).toBe(2); // acquired the unprotected enemy, not its owner
    expect(world.projectiles.some((p) => p.active && p.owner === 1)).toBe(true);

    // Its muzzle tell is published from sim combat state, origin at the barrel,
    // end clamped to the prey's surface (GDD §2.6).
    expect(turret.muzzle).not.toBeNull();
    const m = turret.muzzle!;
    expect(dist(m.origin, turret.pos)).toBeCloseTo(TURRET.radius, 4);
    expect(m.hitPoint).not.toBeNull();
    expect(dist(m.hitPoint!, preyPos)).toBeCloseTo(world.ships[2]!.radius, 4);

    // And the shot deals damage: step until the projectile reaches the prey.
    const prey = world.ships[2]!;
    const startHull = prey.hull;
    for (let t = 0; t < 40 && prey.hull >= startHull; t++) step(world, []);
    expect(prey.hull).toBeLessThan(startHull);
  });

  it('both shooters are seen from sim state — the turret as a muzzle beam, the ship as a projectile', () => {
    const { world } = combatFixture();
    step(world, ATTACKER_FIRES);

    // The turret's shot still publishes a muzzle beam (unchanged, GDD §2.6); the
    // attacking ship's weapon is a projectile now, not a beam — so combatBeams
    // carries exactly the one turret muzzle, and the ship shows in the shot pool.
    const beams = combatBeams(world);
    expect(beams).toHaveLength(1);
    expect(beams[0]!.source).toBe('turret');
    expect(beams[0]!.shooter).toBe(1);

    const shipShots = world.projectiles.filter((p) => p.active && p.owner === 0 && p.kind === 'ship');
    expect(shipShots).toHaveLength(1);

    // Drive the real renderer headlessly with the sim-sourced views. The turret's
    // beam draws in the beams layer; every active shot (ship + turret) draws in
    // the shots layer — so neither shooter is invisible, whoever the camera follows.
    const stage = new Container();
    const renderer = new Renderer(stage, { width: 800, height: 600, originX: 0, originY: 0 });
    const views = beams.map(toBeamView);
    renderer.draw(world, { cameraTarget: 2, beams: views });

    expect(visibleChildren(beamLayer(stage))).toHaveLength(1); // turret muzzle
    expect(visibleChildren(shotLayer(stage)).length).toBeGreaterThanOrEqual(2); // ship + turret shots
    // The turret's shot strikes its prey, so a pooled impact glow rides its hit point.
    const glows = visibleChildren(impactLayer(stage));
    expect(glows.length).toBeGreaterThanOrEqual(1);
  });
});

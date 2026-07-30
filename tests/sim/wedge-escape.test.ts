/**
 * tests/sim/wedge-escape.test.ts — the in-sim escape hatch, the braces half of
 * the bot-home-rim wedge fix. OWNER: Gameplay Engineer (developer report p14).
 *
 * The report photographed a MEDIUM bot at 16/55 HP parked motionless pressed
 * into its OWN station's ring next to its turret — a HOME-state wedge. Root
 * cause: a ship whose steering keeps aiming *through* a solid body (an arrival
 * point at or inside the body's collision radius) thrusts radially inward every
 * tick; the collision response separates it and kills that inward push, and a
 * pure radial press has no tangential velocity to preserve, so the ship grinds to
 * a dead stop against the surface and stays there forever.
 *
 * The physics floor (`reflectOffCircle`, `WEDGE_SLIDE_*`) guarantees this can
 * never persist: a ship both pressing in AND ground to near-stillness earns a
 * deterministic tangential slide along the surface — it walks off the rim,
 * whatever heading its pilot keeps asking for. These pins reproduce the exact
 * screenshot recipe in the REAL `step()` loop (damaged ship, own station, turret
 * nearby, steering held into the core) and prove:
 *   1. the wedge is escaped — the ship never stays pinned within a few units;
 *   2. it works against a rock too (the class is "any solid body");
 *   3. a ship NOT in contact is untouched (no spurious kick, no free energy);
 *   4. the slide is bounded and self-limiting (it reads as a slide, not a launch);
 *   5. determinism — the same steering, tick for tick, gives byte-identical runs.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Vec2 } from '@shared/types';
import {
  BASE_SPEED,
  SHIP_RADIUS,
  STATION,
  TICK_DT,
  WEDGE_SLIDE_SPEED,
  createWorld,
  shipOf,
  stationOf,
  step,
  type Inputs,
  type PlayerSpec,
  type Ship,
  type World,
} from '../../src/sim';

const LOCAL = 0;
const players: PlayerSpec[] = [
  { id: LOCAL, shipClass: ShipClass.Vanguard }, // MEDIUM hull — the screenshot's class
  { id: 1, shipClass: ShipClass.Interceptor },
];

function speed(s: Ship): number {
  return Math.hypot(s.vel.x, s.vel.y);
}

/** A steering input that holds full thrust toward `target` from the ship's
 *  CURRENT position — the "aiming through the body" a bad arrival point produces.
 *  Recomputed each tick, exactly as a bot re-steers toward its fixed anchor. */
function thrustToward(ship: Ship, target: Vec2): Inputs {
  const dx = target.x - ship.pos.x;
  const dy = target.y - ship.pos.y;
  const m = Math.hypot(dx, dy) || 1;
  return [{ id: LOCAL, actions: [{ type: 'thrust', dir: { x: dx / m, y: dy / m } }] }];
}

/**
 * The report's precondition, staged in a real match: a damaged local ship parked
 * ON its own station's rim (touching the collision surface), pressed inward, with
 * the field cleared so nothing else drifts into the fixture. Spawn protection is
 * cleared so it's a normal mid-match moment.
 */
function wedgedAtStation(): { world: World; ship: Ship } {
  const world = createWorld({ seed: 7, players, asteroidCount: 0 });
  world.asteroids = [];
  const ship = shipOf(world, LOCAL)!;
  const station = stationOf(world, LOCAL)!;
  ship.spawnProtect = 0;
  station.spawnProtect = 0;
  ship.hull = 16; // 16/55, the screenshot

  // Plant the hull just touching the station surface, dead still — the state a
  // ship reaches after decelerating onto an arrival point inside the core.
  ship.pos = { x: station.pos.x + STATION.radius + SHIP_RADIUS - 1, y: station.pos.y };
  ship.vel = { x: 0, y: 0 };
  return { world, ship };
}

describe('bot-home-rim wedge is escaped in the real step() loop (developer report p14)', () => {
  it('a ship steering INTO its own station never stays pinned — it slides off the rim', () => {
    const { world, ship } = wedgedAtStation();
    const station = stationOf(world, LOCAL)!;
    const anchor = { x: station.pos.x, y: station.pos.y }; // steer through the core, forever

    // Mirror the standing invariant: the longest the ship holds within a few
    // units of any single spot while it is asking to travel is the wedge time.
    const WEDGE_R = 8;
    let holdStart = { x: ship.pos.x, y: ship.pos.y, t: 0 };
    let worstHeld = 0;

    const seconds = 8;
    const ticks = Math.round(seconds / TICK_DT);
    for (let i = 0; i < ticks; i++) {
      step(world, thrustToward(ship, anchor));
      const dx = ship.pos.x - holdStart.x;
      const dy = ship.pos.y - holdStart.y;
      if (dx * dx + dy * dy > WEDGE_R * WEDGE_R) {
        holdStart = { x: ship.pos.x, y: ship.pos.y, t: world.time };
      } else {
        worstHeld = Math.max(worstHeld, world.time - holdStart.t);
      }
    }

    // Before the fix this pinned for the rest of the match; the floor keeps it
    // moving. An order of magnitude under the 12 s standing ceiling.
    expect(worstHeld).toBeLessThan(2);
  });

  it('the hull ends up meaningfully displaced from the pin, not grinding in place', () => {
    const { world, ship } = wedgedAtStation();
    const station = stationOf(world, LOCAL)!;
    const start = { x: ship.pos.x, y: ship.pos.y };
    const startAngle = Math.atan2(start.y - station.pos.y, start.x - station.pos.x);

    for (let i = 0; i < Math.round(4 / TICK_DT); i++) {
      step(world, thrustToward(ship, station.pos));
    }

    // It slid around the rim — the bearing from the station centre swung well
    // past the starting spoke (a dead pin would hold the same bearing forever).
    const endAngle = Math.atan2(ship.pos.y - station.pos.y, ship.pos.x - station.pos.x);
    let swept = Math.abs(endAngle - startAngle);
    if (swept > Math.PI) swept = 2 * Math.PI - swept;
    expect(swept).toBeGreaterThan(0.3);
  });

  it('never tunnels inside the station — it clears the collision surface every tick', () => {
    const { world, ship } = wedgedAtStation();
    const station = stationOf(world, LOCAL)!;
    const minClear = STATION.radius + SHIP_RADIUS - 1.5; // separation floor (allow the plant)
    for (let i = 0; i < Math.round(6 / TICK_DT); i++) {
      step(world, thrustToward(ship, station.pos));
      expect(Math.hypot(ship.pos.x - station.pos.x, ship.pos.y - station.pos.y)).toBeGreaterThan(minClear);
    }
  });

  it('the class is "any solid body": a ship jammed into an ASTEROID escapes too', () => {
    const world = createWorld({ seed: 11, players, asteroidCount: 0 });
    world.asteroids = [
      { id: 1, pos: { x: 2000, y: 2000 }, radius: 40, ore: 100, maxOre: 100, crackStage: 0, mineBuffer: 0, home: null },
    ];
    const ship = shipOf(world, LOCAL)!;
    ship.spawnProtect = 0;
    const rock = world.asteroids[0]!;
    ship.pos = { x: rock.pos.x + rock.radius + SHIP_RADIUS - 1, y: rock.pos.y };
    ship.vel = { x: 0, y: 0 };

    const WEDGE_R = 8;
    let holdStart = { x: ship.pos.x, y: ship.pos.y, t: 0 };
    let worstHeld = 0;
    for (let i = 0; i < Math.round(8 / TICK_DT); i++) {
      step(world, thrustToward(ship, rock.pos));
      const dx = ship.pos.x - holdStart.x;
      const dy = ship.pos.y - holdStart.y;
      if (dx * dx + dy * dy > WEDGE_R * WEDGE_R) holdStart = { x: ship.pos.x, y: ship.pos.y, t: world.time };
      else worstHeld = Math.max(worstHeld, world.time - holdStart.t);
    }
    expect(worstHeld).toBeLessThan(2);
  });
});

describe('the escape hatch is surgical — it perturbs nothing else', () => {
  it('a ship in open space, not touching any body, is untouched by the slide', () => {
    const world = createWorld({ seed: 3, players, asteroidCount: 0 });
    world.asteroids = [];
    const ship = shipOf(world, LOCAL)!;
    ship.spawnProtect = 0;
    // Far from its station, coasting; give it a known drift, no input.
    ship.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
    ship.vel = { x: 10, y: 0 };

    step(world, [{ id: LOCAL, actions: [] }]);
    // Only drag acted on it — velocity stayed on the +x axis, no tangential kick
    // sneaked in (the hatch only fires on a confirmed inward contact).
    expect(ship.vel.y).toBeCloseTo(0, 9);
    expect(ship.vel.x).toBeGreaterThan(0);
    expect(ship.vel.x).toBeLessThanOrEqual(10);
  });

  it('the slide is bounded and self-limiting — a pinned hull never launches', () => {
    const { world, ship } = wedgedAtStation();
    const station = stationOf(world, LOCAL)!;
    let maxSpeed = 0;
    for (let i = 0; i < Math.round(8 / TICK_DT); i++) {
      step(world, thrustToward(ship, station.pos));
      maxSpeed = Math.max(maxSpeed, speed(ship));
    }
    // A slide, not a launch: it stays well under cruise. The kick only fires
    // while the ship is below WEDGE_SLIDE_SPEED, so it self-caps not far above it.
    expect(maxSpeed).toBeLessThan(BASE_SPEED);
    expect(maxSpeed).toBeLessThan(WEDGE_SLIDE_SPEED * 4);
  });
});

describe('determinism (GDD §4.8) — the escape hatch adds no RNG, no clock', () => {
  it('two identical wedged runs are byte-identical, tick for tick', () => {
    const run = (): Ship => {
      const { world, ship } = wedgedAtStation();
      const station = stationOf(world, LOCAL)!;
      for (let i = 0; i < Math.round(5 / TICK_DT); i++) step(world, thrustToward(ship, station.pos));
      return ship;
    };
    const a = run();
    const b = run();
    expect(a.pos).toEqual(b.pos);
    expect(a.vel).toEqual(b.vel);
  });
});

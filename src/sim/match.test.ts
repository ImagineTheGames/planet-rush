/**
 * src/sim/match.test.ts — the day-2 endgame contract (GDD §1, §2.3, §2.7).
 *
 * The four checks from the brief:
 *   1. last-to-die resolution — one home standing wins, and when the final
 *      cores die in the same tick the *last* one to reach zero does;
 *   2. collapse disables regen and repair;
 *   3. wave radii shrink — every wave lands closer to centre than the last;
 *   4. respawn preserves upgrades.
 * Plus what hangs off them: elimination taking the owner's ship out of the
 * match for good, the wreck's scavengeable debris, and the guarantee that a
 * match nobody finishes still reaches collapse.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createWorld,
  damagePlanet,
  damageShip,
  isCollapsed,
  placeOrder,
  step,
  collapseDeadline,
  type Inputs,
} from './index';
import {
  CARGO_BASE,
  CORE_HP,
  FIELD_YIELD,
  PLANET,
  RESPAWN_S,
  SHIELD,
  SHIP_RADIUS,
  SHIP_STATS,
  SPAWN_PROTECTION_S,
  TICK_DT,
  TURRET,
  WAVE_COUNT,
  WRECK,
  waveRadiusFraction,
} from './constants';
import type { MatchState, Planet, Ship, World } from './state';

// --- builders --------------------------------------------------------------
//
// Same shape as the day-1/day-2 fixtures in `step.test.ts` / `buildings.test.ts`
// (a hand-built world is placed well inside the arena so the walls never move a
// fixture), with the match clock parked: zero rocks per wave means the wave
// metronome cannot drop asteroids into a test, and the collapse phase — which
// needs all five waves first — only opens where a test asks for it.

const ORIGIN = 2000;
const at = (x: number, y: number) => ({ x: ORIGIN + x, y: ORIGIN + y });

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const stats = SHIP_STATS[cls];
  return {
    id: over.id,
    shipClass: cls,
    pos: over.pos ?? at(0, 0),
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? at(0, 0),
    angle: over.angle ?? 0,
    hull: over.hull ?? stats.hull,
    maxHull: over.maxHull ?? stats.hull,
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? Math.max(CARGO_BASE, stats.cargo),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    eliminated: over.eliminated ?? false,
    radius: over.radius ?? SHIP_RADIUS,
    beam: over.beam ?? null,
  };
}

function makePlanet(over: Partial<Planet> & Pick<Planet, 'id' | 'owner'>): Planet {
  return {
    id: over.id,
    owner: over.owner,
    pos: over.pos ?? at(0, 0),
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

function makeMatch(over: Partial<MatchState> = {}): MatchState {
  return {
    phase: over.phase ?? 'live',
    wavesSpawned: over.wavesSpawned ?? 0,
    collapseTime: over.collapseTime ?? -1,
    eliminated: over.eliminated ?? [],
    winner: over.winner ?? null,
    endTime: over.endTime ?? -1,
  };
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    time: over.time ?? 0,
    tick: over.tick ?? 0,
    rngState: over.rngState ?? 1,
    nextEntityId: over.nextEntityId ?? 1000,
    ships: over.ships ?? [],
    asteroids: over.asteroids ?? [],
    chunks: over.chunks ?? [],
    planets: over.planets ?? [],
    projectiles: over.projectiles ?? [],
    bounds: over.bounds ?? { width: 4000, height: 4000 },
    fieldRadius: over.fieldRadius ?? 600,
    asteroidsPerWave: over.asteroidsPerWave ?? 0,
    match: over.match ?? makeMatch(),
  };
}

/** Total ore loose in the world — rock plus chunks. */
const oreInWorld = (w: World): number =>
  w.asteroids.reduce((n, a) => n + a.ore, 0) + w.chunks.reduce((n, c) => n + c.amount, 0);

// --- 1. win/loss and the last-to-die rule (GDD §1) -------------------------

describe('win/loss (GDD §1)', () => {
  it('the last surviving core wins the match', () => {
    const world = makeWorld({
      ships: [makeShip({ id: 0 }), makeShip({ id: 1 }), makeShip({ id: 2 })],
      planets: [
        makePlanet({ id: 0, owner: 0, pos: at(-500, 0) }),
        makePlanet({ id: 1, owner: 1, pos: at(0, 0) }),
        makePlanet({ id: 2, owner: 2, pos: at(500, 0) }),
      ],
    });

    damagePlanet(world, world.planets[2]!, CORE_HP);
    step(world, []);
    // Two homes still standing: the match is not over.
    expect(world.match.phase).toBe('live');
    expect(world.match.winner).toBeNull();

    damagePlanet(world, world.planets[0]!, CORE_HP);
    step(world, []);
    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBe(1);
    expect(world.match.endTime).toBeCloseTo(world.time, 9);
    expect(world.match.eliminated).toEqual([2, 0]);
  });

  it('when the final cores die in the same tick, the last to reach zero wins', () => {
    const world = makeWorld({
      ships: [makeShip({ id: 0 }), makeShip({ id: 1 })],
      planets: [
        makePlanet({ id: 0, owner: 0, pos: at(-400, 0) }),
        makePlanet({ id: 1, owner: 1, pos: at(400, 0) }),
      ],
    });

    // Slot 1's core reaches zero first, slot 0's second — inside one tick, so
    // there is no survivor to crown. Whoever dies last, wins (GDD §1): the
    // answer must be 0, and it must not be "the lowest surviving slot".
    damagePlanet(world, world.planets[1]!, CORE_HP);
    damagePlanet(world, world.planets[0]!, CORE_HP);
    step(world, []);

    expect(world.match.eliminated).toEqual([1, 0]);
    expect(world.match.phase).toBe('ended');
    expect(world.match.winner).toBe(0);
  });

  it('reversing the death order reverses the winner', () => {
    const world = makeWorld({
      ships: [makeShip({ id: 0 }), makeShip({ id: 1 })],
      planets: [
        makePlanet({ id: 0, owner: 0, pos: at(-400, 0) }),
        makePlanet({ id: 1, owner: 1, pos: at(400, 0) }),
      ],
    });

    damagePlanet(world, world.planets[0]!, CORE_HP);
    damagePlanet(world, world.planets[1]!, CORE_HP);
    step(world, []);

    expect(world.match.eliminated).toEqual([0, 1]);
    expect(world.match.winner).toBe(1);
  });

  it('latches: a winner is decided once and never re-decided', () => {
    const world = makeWorld({
      ships: [makeShip({ id: 0 }), makeShip({ id: 1 })],
      planets: [
        makePlanet({ id: 0, owner: 0, pos: at(-400, 0) }),
        makePlanet({ id: 1, owner: 1, pos: at(400, 0) }),
      ],
    });

    damagePlanet(world, world.planets[1]!, CORE_HP);
    step(world, []);
    expect(world.match.winner).toBe(0);
    const endTime = world.match.endTime;

    // The survivor's own core dying afterwards cannot rewrite the result.
    damagePlanet(world, world.planets[0]!, CORE_HP);
    for (let t = 0; t < 30; t++) step(world, []);
    expect(world.match.winner).toBe(0);
    expect(world.match.endTime).toBe(endTime);
  });

  it('a single-slot world is not a match and never ends', () => {
    const world = createWorld({ seed: 3, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
    for (let t = 0; t < 120; t++) step(world, []);
    expect(world.match.phase).toBe('live');
    expect(world.match.winner).toBeNull();
  });
});

// --- 2. elimination, the wreck, and its debris (GDD §2.7) ------------------

describe('elimination and the wreck (GDD §2.7)', () => {
  function siegeWorld() {
    const victim = makeShip({ id: 1, pos: at(300, 0), banked: 10, cargo: 2 });
    const world = makeWorld({
      ships: [makeShip({ id: 0, pos: at(-600, 0) }), victim],
      planets: [
        makePlanet({ id: 0, owner: 0, pos: at(-900, 0) }),
        makePlanet({
          id: 1,
          owner: 1,
          pos: at(0, 0),
          coreHp: 5,
          turrets: [
            {
              id: 50,
              owner: 1,
              slot: 0,
              pos: at(80, 0),
              radius: TURRET.radius,
              hp: TURRET.hp,
              maxHp: TURRET.hp,
              angle: 0,
              cooldown: 0,
              targetId: null,
            },
          ],
          builds: [{ id: 51, kind: 'shield', slot: 0, remaining: 5, total: SHIELD.buildTime }],
        }),
      ],
    });
    return { world, victim, wreck: world.planets[1]! };
  }

  it('a destroyed core wrecks the planet and takes its owner out of the match', () => {
    const { world, victim, wreck } = siegeWorld();

    damagePlanet(world, wreck, 5);
    step(world, []);

    // The wreck stays on the map for the rest of the match — same place, same
    // radius, dead, and stamped with when it died.
    expect(wreck.alive).toBe(false);
    expect(wreck.coreHp).toBe(0);
    expect(wreck.deathTime).toBeGreaterThanOrEqual(0);
    expect(world.planets).toHaveLength(2);
    expect(wreck.turrets).toHaveLength(0);
    expect(wreck.builds).toHaveLength(0);

    // The owner is eliminated: their ship dies where it stood and stays dead.
    expect(victim.eliminated).toBe(true);
    expect(victim.alive).toBe(false);
    for (let t = 0; t < Math.ceil((RESPAWN_S + 1) / TICK_DT); t++) step(world, []);
    expect(victim.alive).toBe(false);
    expect(victim.eliminated).toBe(true);
  });

  it('the wreck scatters the dead player\'s fortune as debris anyone can scavenge', () => {
    const { world, victim, wreck } = siegeWorld();
    const bank = victim.banked;
    const held = victim.cargo;

    damagePlanet(world, wreck, 5);

    // The bank funds the debris field (plus the floor), and the half-hold drops
    // where the ship exploded — the two halves of GDD §2.7's payout.
    expect(victim.banked).toBe(0);
    expect(oreInWorld(world)).toBeCloseTo(bank + WRECK.baseDebrisOre + held / 2, 9);

    // Debris sits on a ring around the wreck, not inside it.
    const nearWreck = world.chunks.filter(
      (c) => Math.hypot(c.pos.x - wreck.pos.x, c.pos.y - wreck.pos.y) < wreck.radius + 2 * WRECK.debrisRingOffset,
    );
    expect(nearWreck.length).toBeGreaterThan(0);

    // And it is loot: a rival flying to the wreck fills its hold from it.
    const scavenger = world.ships[0]!;
    scavenger.pos = { x: wreck.pos.x + wreck.radius + WRECK.debrisRingOffset, y: wreck.pos.y };
    for (let t = 0; t < 240; t++) step(world, []);
    expect(scavenger.cargo).toBeGreaterThan(0);
  });

  it('a wreck cannot be re-eliminated, however many beams land on it', () => {
    const { world, wreck } = siegeWorld();

    damagePlanet(world, wreck, 5);
    expect(damagePlanet(world, wreck, 50)).toBe(false);
    step(world, []);
    expect(world.match.eliminated).toEqual([1]);
  });
});

// --- 3. death and respawn (GDD §2.7) --------------------------------------

describe('death and respawn (GDD §2.7)', () => {
  it('respawns in 5 s with upgrades intact, having dropped half the hold', () => {
    // A player who has bought hull and cargo tiers: the upgrade state lives in
    // `maxHull` / `cargoCap`, and respawn must not touch either (GDD §2.5).
    const upgradedHull = 80;
    const upgradedCargo = 6;
    const ship = makeShip({
      id: 0,
      pos: at(400, 0),
      home: at(0, 0),
      hull: 4,
      maxHull: upgradedHull,
      cargo: 4,
      cargoCap: upgradedCargo,
      banked: 7,
      shipClass: ShipClass.Hauler,
    });
    const world = makeWorld({ ships: [ship] });

    damageShip(world, ship, 4);
    expect(ship.alive).toBe(false);
    expect(ship.respawnTimer).toBeCloseTo(RESPAWN_S, 9);
    // Half the hold drops as debris where it exploded; the bank is untouched.
    expect(world.chunks.reduce((n, c) => n + c.amount, 0)).toBeCloseTo(2, 9);
    expect(ship.banked).toBe(7);

    // Not a tick early…
    for (let t = 0; t < Math.floor(RESPAWN_S / TICK_DT); t++) step(world, []);
    expect(ship.alive).toBe(false);
    step(world, []);

    expect(ship.alive).toBe(true);
    expect(ship.hull).toBe(upgradedHull);
    expect(ship.maxHull).toBe(upgradedHull);
    expect(ship.cargoCap).toBe(upgradedCargo);
    expect(ship.shipClass).toBe(ShipClass.Hauler);
    expect(ship.banked).toBe(7);
    expect(ship.cargo).toBe(0);
    expect(ship.pos).toEqual(ship.home);
    expect(ship.spawnProtect).toBeCloseTo(SPAWN_PROTECTION_S, 9);
  });
});

// --- 4. the five waves (GDD §2.3) -----------------------------------------

describe('asteroid waves (GDD §2.3)', () => {
  it('every wave scatters strictly closer to the map centre than the last', () => {
    expect(waveRadiusFraction(1)).toBeGreaterThan(waveRadiusFraction(WAVE_COUNT));
    for (let n = 2; n <= WAVE_COUNT; n++) {
      expect(waveRadiusFraction(n)).toBeLessThan(waveRadiusFraction(n - 1));
    }

    const world = createWorld({
      seed: 4242,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Vanguard },
      ],
    });
    const cx = world.bounds.width / 2;
    const cy = world.bounds.height / 2;
    const seen = new Set<number>();
    const reach: number[] = [];

    // Fast-forward on a coarse dt — the sim is dt-parametric, and with no input
    // nothing but the metronome moves.
    for (let n = 1; n <= WAVE_COUNT; n++) {
      while (world.match.wavesSpawned < n) step(world, [], 1);
      const fresh = world.asteroids.filter((a) => !seen.has(a.id));
      expect(fresh.length).toBeGreaterThan(0);
      let far = 0;
      for (const a of fresh) {
        seen.add(a.id);
        far = Math.max(far, Math.hypot(a.pos.x - cx, a.pos.y - cy));
      }
      // Inside its own wave's disc…
      expect(far).toBeLessThanOrEqual(world.fieldRadius * waveRadiusFraction(n) + 1e-9);
      reach.push(far);
    }

    // …and each wave's reach is shorter than the one before it.
    for (let i = 1; i < reach.length; i++) expect(reach[i]!).toBeLessThan(reach[i - 1]!);
  });

  it('delivers the whole field yield, and not one wave more', () => {
    const world = createWorld({
      seed: 11,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Vanguard },
      ],
    });
    expect(world.match.wavesSpawned).toBe(1); // wave 1 is the opening field
    expect(oreInWorld(world)).toBeCloseTo(FIELD_YIELD / WAVE_COUNT, 6);

    for (let t = 0; t < 900; t++) step(world, [], 1);
    expect(world.match.wavesSpawned).toBe(WAVE_COUNT);
    expect(oreInWorld(world)).toBeCloseTo(FIELD_YIELD, 6);
  });

  it('two runs of the whole wave schedule deep-equal (GDD §4.8)', () => {
    const cfg = {
      seed: 90210,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Excavator },
      ],
    } as const;
    const a = createWorld(cfg);
    const b = createWorld(cfg);
    for (let t = 0; t < 800; t++) {
      step(a, [], 1);
      step(b, [], 1);
    }
    expect(a).toEqual(b);
    expect(a.match.phase).toBe('collapse');
  });
});

// --- 5. the collapse phase (GDD §2.3) -------------------------------------

describe('collapse (GDD §2.3)', () => {
  /** A defender at home with a hurt core and a hurt shield, ore in the bank,
   *  and the field already spent — one step from collapse. */
  function endgame(over: Partial<MatchState> = {}) {
    const ship = makeShip({ id: 0, pos: at(0, 0), banked: 20 });
    const planet = makePlanet({
      id: 0,
      owner: 0,
      pos: at(0, 0),
      coreHp: 50,
      shields: [{ id: 9, hp: 10, maxHp: SHIELD.hp, radius: SHIELD.radius }],
    });
    const world = makeWorld({
      ships: [ship],
      planets: [planet],
      match: makeMatch({ wavesSpawned: WAVE_COUNT, ...over }),
    });
    return { world, ship, planet };
  }

  it('opens once the last wave is exhausted', () => {
    const { world } = endgame();
    expect(isCollapsed(world)).toBe(false);
    step(world, []);
    expect(isCollapsed(world)).toBe(true);
    expect(world.match.phase).toBe('collapse');
    expect(world.match.collapseTime).toBeCloseTo(world.time, 9);
  });

  it('does not open while the field still holds ore', () => {
    const { world } = endgame();
    world.chunks.push({ id: 77, pos: at(200, 0), vel: { x: 0, y: 0 }, amount: 1, radius: 6 });
    for (let t = 0; t < 60; t++) step(world, []);
    expect(isCollapsed(world)).toBe(false);
  });

  it('does not open before the final wave, however empty the field is', () => {
    const { world } = endgame({ wavesSpawned: WAVE_COUNT - 1 });
    for (let t = 0; t < 60; t++) step(world, []);
    expect(isCollapsed(world)).toBe(false);
  });

  it('stops shield regeneration', () => {
    // Baseline: the same fixture, still live, regenerates at 2 HP/s.
    const live = endgame({ wavesSpawned: 0 });
    for (let t = 0; t < 60; t++) step(live.world, []);
    expect(live.planet.shields[0]!.hp).toBeCloseTo(10 + SHIELD.regenPerSecond, 6);

    const { world, planet } = endgame();
    step(world, []); // the tick collapse opens on
    const hp = planet.shields[0]!.hp;
    for (let t = 0; t < 300; t++) step(world, []);
    expect(planet.shields[0]!.hp).toBe(hp);
  });

  it('shuts the repair channel off — open or requested', () => {
    // Baseline: the same fixture, still live, repairs at 2 HP/s for 1 ore/5 HP.
    const live = endgame({ wavesSpawned: 0 });
    expect(placeOrder(live.world, live.ship, 'repair')).toBe('ok');
    for (let t = 0; t < 60; t++) step(live.world, []);
    expect(live.planet.coreHp).toBeCloseTo(52, 6);

    // Collapse: an open channel closes, and a fresh order is refused outright.
    const { world, ship, planet } = endgame();
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    step(world, []); // collapse opens at the end of this tick
    const coreHp = planet.coreHp;
    const banked = ship.banked;
    for (let t = 0; t < 300; t++) step(world, []);

    expect(planet.repairing).toBe(false);
    expect(planet.coreHp).toBe(coreHp);
    expect(ship.banked).toBe(banked);
    expect(placeOrder(world, ship, 'repair')).toBe('collapsed');
  });

  it('brings no new ore: the field is closed for good', () => {
    const { world } = endgame({ wavesSpawned: WAVE_COUNT - 1 });
    // One wave still owed by the schedule, but the deadline has passed…
    world.time = collapseDeadline() + 1;
    world.match.wavesSpawned = WAVE_COUNT;
    step(world, []);
    expect(isCollapsed(world)).toBe(true);

    const rocks = world.asteroids.length;
    for (let t = 0; t < 600; t++) step(world, []);
    expect(world.asteroids).toHaveLength(rocks);
    expect(world.match.wavesSpawned).toBe(WAVE_COUNT);
  });

  it('arrives on the deadline even if nobody mines a single rock', () => {
    const world = createWorld({
      seed: 8,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Vanguard },
      ],
    });
    const idle: Inputs = [];
    while (world.time < collapseDeadline() && !isCollapsed(world)) step(world, idle, 1);
    step(world, idle, 1);

    expect(isCollapsed(world)).toBe(true);
    expect(world.time).toBeLessThanOrEqual(collapseDeadline() + 1);
    // Well inside the 10–15 minute match target (GDD §1).
    expect(world.match.collapseTime).toBeLessThan(15 * 60);
  });
});

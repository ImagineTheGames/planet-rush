/**
 * tests/sim/damage-integrity.test.ts — combat that never silently fails to hurt.
 * OWNER: Gameplay Engineer (field report v0.2: "some ships would not take damage
 * from me"; GDD §2.1, §2.4, §2.6, §2.8, §4.8).
 *
 * The most serious kind of bug is the one where a shot plays the hit and the sim
 * quietly applies nothing. This file is the standing proof that it does not.
 * Combat is a PROJECTILE now (design amendment v0.2 — the mining beam vs
 * asteroids is untouched), so the accounting became "whole shots landed × the
 * beam stat per shot" where it used to be continuous DPS; the invariants are the
 * same, delivered by a shot that can miss instead of a ray that cannot:
 *
 *  §A  THE DAMAGE MATRIX — for EVERY ship class attacking EVERY ship class, the
 *      weapon fired at a stationary point-blank target for N ticks removes a
 *      whole number of shots' worth of hull, both manual and auto-aim. No
 *      attacker/target pair may zero out. Per-shot damage is the attacker's beam
 *      stat and hull class is armour *total*, never damage resistance, so the
 *      delta depends on the shooter and never on the victim.
 *
 *  §B  SHIELDED TARGETS bleed their pool by the same accounting: a planet's shield
 *      loses exactly the core-rate damage dealt before the core takes a scratch,
 *      for every attacker class — the "shields stand in front of the core" rule
 *      measured HP-for-HP (GDD §2.6).
 *
 *  §C  THE SPAWN-PROTECTION RULE (field report v0.2) — a protected ship is not a
 *      shot target: it takes zero damage (GDD §2.1) AND does not *block* the
 *      weapon. A shot flies OVER a protected hull to a live enemy behind it, and
 *      protection is honoured at the moment of impact, not at fire time. Ships
 *      behave like protected cores/turrets: the shot passes over.
 *
 *  §D  DETERMINISM — a full four-class firefight replays byte-for-byte (GDD §4.8).
 *
 * VISUAL GAP filed to the UI agent in the PR body: a spawn-protected ship has no
 * on-screen tell, so a shot sailing over one now (correctly) doing nothing still
 * has nothing that says "invulnerable." The sim is right; the read needs a shield
 * shimmer / protection ring on ships, the same tell the core wants.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  SHIP_RADIUS,
  SHIP_WEAPON,
  SHIELD,
  SPAWN_PROTECTION_S,
  TICK_DT,
  PLANET,
  CORE_HP,
  beamShipDps,
  beamCoreDps,
  createWorld,
  shipCargoCap,
  shipMaxHull,
  shipWeaponDamage,
  shieldPool,
  step,
  stockTiers,
  type Inputs,
  type Planet,
  type Shield,
  type Ship,
  type World,
} from '../../src/sim';

const CLASSES = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
] as const;

// --- builders --------------------------------------------------------------
//
// Hand-built fixtures so a pair is exactly two ships and nothing else — no waves
// dropping rocks in front of a beam, no third body to occlude it. Ship stats come
// from the same derived-stat path a real hull's do, so the matrix measures the
// shipped numbers, not restated ones.

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
    beam: over.beam ?? null,
  };
}

/** A planet owned by slot `owner`, optionally carrying `shields`. Core is deep
 *  enough to outlast the short shots these tests fire; spawn protection off so it
 *  is a live target (GDD §2.1). */
function makePlanet(owner: number, x: number, y: number, shields: Shield[] = []): Planet {
  return {
    id: 0,
    owner,
    pos: { x, y },
    radius: PLANET.radius,
    coreHp: CORE_HP,
    maxCoreHp: CORE_HP,
    alive: true,
    deathTime: -1,
    spawnProtect: 0,
    angle: 0,
    // Freshly damaged, so shield regen (8 s undamaged) never opens in these runs
    // and the pool only ever moves under the beam we are measuring.
    sinceDamage: 0,
    repairing: false,
    turrets: [],
    shields,
    builds: [],
  };
}

function makeShield(id: number, hp = SHIELD.hp): Shield {
  return { id, hp, maxHp: SHIELD.hp, radius: SHIELD.radius };
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
    bounds: over.bounds ?? { width: 4000, height: 4000 },
    fieldRadius: over.fieldRadius ?? 600,
    // No wave metronome in a physics fixture (empty field stays empty).
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

const fire = (auto = false): Inputs[number]['actions'][number] => ({ type: 'fire', active: true, auto });

/** Fire `attacker`'s weapon at a stationary `target` directly ahead (+x) for
 *  `fireTicks`, then drain a few ticks so the last in-flight shots land, and
 *  return the hull it lost. Combat is a projectile now (design amendment v0.2):
 *  the target holds still in the open, so every shot fired lands, and the
 *  delivered damage is a whole number of shots. */
function hullLostOverWeapon(attacker: ShipClass, target: ShipClass, fireTicks: number, auto: boolean): number {
  const shooter = makeShip({ id: 0, shipClass: attacker, pos: { x: 500, y: 500 }, angle: 0 });
  const victim = makeShip({ id: 1, shipClass: target, pos: { x: 620, y: 500 } });
  const world = makeWorld({ ships: [shooter, victim] });
  const before = victim.hull;
  const firing: Inputs = [{ id: 0, actions: [fire(auto)] }];
  for (let t = 0; t < fireTicks; t++) step(world, firing);
  // Let the last shots cross the ~120-unit gap and land (≈15 ticks at base speed).
  for (let t = 0; t < 30; t++) step(world, []);
  return before - world.ships[1]!.hull;
}

/** Assert `delta` is a positive whole number of `perShot` hits — the projectile
 *  accounting the old continuous-DPS asserts became (design amendment v0.2). */
function expectWholeShots(delta: number, perShot: number): void {
  expect(delta).toBeGreaterThan(0); // no pair silently zeroes out
  const shots = delta / perShot;
  expect(shots).toBeCloseTo(Math.round(shots), 6);
  expect(Math.round(shots)).toBeGreaterThanOrEqual(1);
}

// --- §A. the damage matrix -------------------------------------------------

describe('§A damage matrix — every class × every class, no pair zeroes (GDD §2.4, §2.8)', () => {
  // Fire long enough for a few shots, short enough that even the frailest hull
  // (Interceptor, 35) survives the hardest hitter: 3 shots × 4.55 ≈ 14 ≪ 35, so
  // no target dies mid-run and the delta is pure applied damage.
  const N = 63;

  for (const mode of [false, true] as const) {
    const label = mode ? 'auto-aim' : 'manual';

    describe(`${label} fire`, () => {
      for (const atk of CLASSES) {
        // Per-shot weapon damage is the attacker's beam stat over one fire
        // interval — one beam, one stat (GDD §2.5) — so the delta is a whole
        // number of these, the same whichever hull is on the receiving end.
        const perShot = beamShipDps(atk) * SHIP_WEAPON.fireInterval;

        it(`${atk} lands its beam DPS (${beamShipDps(atk)}/s) as shots on every target class, never zero`, () => {
          const deltas = CLASSES.map((tgt) => hullLostOverWeapon(atk, tgt, N, mode));

          // The load-bearing assertion: real hits, a whole number of them, on
          // every pair — no attacker/target combination silently fails to hurt.
          for (const delta of deltas) expectWholeShots(delta, perShot);

          // Hull class is armour TOTAL, not damage resistance: the same shooter
          // strips the same HP from all four targets to the last bit.
          for (const delta of deltas) expect(delta).toBeCloseTo(deltas[0]!, 12);
        });
      }
    });
  }

  it('the four attacker rates are distinct and ordered (Excavator > Vanguard > Hauler > Interceptor)', () => {
    // A sanity net under the matrix: if a retune ever flattened the beam stats,
    // the per-pair checks would still pass while class identity had been lost.
    expect(beamShipDps(ShipClass.Excavator)).toBeGreaterThan(beamShipDps(ShipClass.Vanguard));
    expect(beamShipDps(ShipClass.Vanguard)).toBeGreaterThan(beamShipDps(ShipClass.Hauler));
    expect(beamShipDps(ShipClass.Hauler)).toBeGreaterThan(beamShipDps(ShipClass.Interceptor));
  });
});

// --- §B. shielded targets lose the pool by the same accounting -------------

describe('§B shields bleed HP-for-HP before the core (GDD §2.6)', () => {
  const N = 63;

  /** Fire `attacker`'s weapon at a planet (with `shields`) directly ahead for
   *  `fireTicks`, then drain so the last shots land. */
  function weaponPlanet(attacker: ShipClass, shields: Shield[], fireTicks: number) {
    // Shooter faces +x at 300; planet centre at 500 (owner slot 1). Centre gap
    // 200, shield bubble r=90 → shots bite the bubble at 110 u, well in range.
    const shooter = makeShip({ id: 0, shipClass: attacker, pos: { x: 300, y: 500 }, angle: 0 });
    const planet = makePlanet(1, 500, 500, shields);
    const world = makeWorld({ ships: [shooter], planets: [planet] });
    const firing: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < fireTicks; t++) step(world, firing);
    for (let t = 0; t < 30; t++) step(world, []);
    return world.planets[0]!;
  }

  for (const atk of CLASSES) {
    it(`${atk} strips shield HP at its core rate (${beamCoreDps(atk)}/s) and leaves the core untouched`, () => {
      const shield = makeShield(1);
      const before = shield.hp;
      // Core rate, not ship rate: a shot on a shield or core is scaled by the
      // core:ship ratio (GDD §2.8). Kept short so the 40 HP bubble never breaks.
      const perShot = beamCoreDps(atk) * SHIP_WEAPON.fireInterval;

      const planet = weaponPlanet(atk, [shield], N);
      const drop = before - shieldPool(planet);

      expectWholeShots(drop, perShot);
      expect(drop).toBeLessThan(SHIELD.hp); // the bubble held
      // Not a single point leaked past the bubble to the core.
      expect(planet.coreHp).toBe(CORE_HP);
    });
  }

  it('a naked core (no shield) takes the same core-rate damage the shield would have', () => {
    for (const atk of CLASSES) {
      const planet = weaponPlanet(atk, [], N); // no shield: core is the surface
      const perShot = beamCoreDps(atk) * SHIP_WEAPON.fireInterval;
      expectWholeShots(CORE_HP - planet.coreHp, perShot);
    }
  });

  it('two stacked shields drain in build order, second only after the first is gone', () => {
    // Enough shots to empty the first 40 HP bubble and bite into the second.
    // Excavator core DPS 6.5 → 40 HP in ~6.15 s of landed shots; run 8 s.
    const first = makeShield(1);
    const second = makeShield(2);
    const shooter = makeShip({ id: 0, shipClass: ShipClass.Excavator, pos: { x: 300, y: 500 }, angle: 0 });
    const planet = makePlanet(1, 500, 500, [first, second]);
    const world = makeWorld({ ships: [shooter], planets: [planet] });
    const firing: Inputs = [{ id: 0, actions: [fire()] }];

    const startPool = shieldPool(planet);
    for (let t = 0; t < 8 * 60; t++) step(world, firing);
    for (let t = 0; t < 30; t++) step(world, []);

    const p = world.planets[0]!;
    const totalDrop = startPool - shieldPool(p);
    // All damage went into the pool, none skipped a bubble: the first is empty,
    // the second has taken the overflow, and the accounting is a whole shot count.
    expect(p.shields[0]!.hp).toBe(0);
    expect(p.shields[1]!.hp).toBeLessThan(SHIELD.hp);
    expect(p.shields[1]!.hp).toBeGreaterThan(0); // not yet through to the core
    expectWholeShots(totalDrop, beamCoreDps(ShipClass.Excavator) * SHIP_WEAPON.fireInterval);
    expect(p.coreHp).toBe(CORE_HP);
  });
});

// --- §C. spawn protection vs a projectile (field report v0.2, amendment v0.2) ---

describe('§C a spawn-protected ship is not a shot target — no zero-damage wall (GDD §2.1)', () => {
  const N = 63;

  it('takes zero damage while protected (the protection itself still holds)', () => {
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
    const world = makeWorld({ ships: [shooter, target] });
    for (let t = 0; t < N + 30; t++) step(world, [{ id: 0, actions: [fire()] }]);
    expect(world.ships[1]!.hull).toBe(target.maxHull); // every shot flew over it
  });

  it('does NOT block the weapon: a live enemy directly behind a protected one is hit', () => {
    // shooter → [protected @620] → [live @760], all on the +x axis. The shot
    // flies OVER the protected hull (it is not a target) and bites the live one.
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const guard = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
    const behind = makeShip({ id: 2, pos: { x: 760, y: 500 } });
    const world = makeWorld({ ships: [shooter, guard, behind] });

    const before = behind.hull;
    for (let t = 0; t < N; t++) step(world, [{ id: 0, actions: [fire()] }]);
    for (let t = 0; t < 30; t++) step(world, []);

    expect(world.ships[1]!.hull).toBe(guard.maxHull); // protected one untouched
    expectWholeShots(before - world.ships[2]!.hull, shipWeaponDamage(shooter));
  });

  it('auto-aim skips a nearer protected ship and shoots the live enemy', () => {
    // Protected enemy is the CLOSEST body; a live enemy sits farther off-axis.
    // Auto-aim ignores the invulnerable one and locks the one it can hurt.
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const near = makeShip({ id: 1, pos: { x: 560, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
    const live = makeShip({ id: 2, pos: { x: 500, y: 640 } }); // 140 u away, perpendicular
    const world = makeWorld({ ships: [shooter, near, live] });

    const before = live.hull;
    for (let t = 0; t < N; t++) step(world, [{ id: 0, actions: [fire(true)] }]);
    for (let t = 0; t < 30; t++) step(world, []);

    expect(world.ships[1]!.hull).toBe(near.maxHull); // protected one ignored
    expectWholeShots(before - world.ships[2]!.hull, shipWeaponDamage(shooter));
  });

  it('protection is honoured at the moment of impact, not at fire time', () => {
    // A projectile checks protection when it *lands*, not when it is fired.
    // Case 1: the target stays protected through the whole flight → the shot
    // passes over and nothing lands.
    {
      const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
      const target = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
      const world = makeWorld({ ships: [shooter, target] });
      step(world, [{ id: 0, actions: [fire()] }]); // one shot
      for (let t = 0; t < 30; t++) step(world, []); // let it cross
      expect(world.ships[1]!.hull).toBe(target.maxHull);
    }
    // Case 2: protection lapses (2·dt) before the shot arrives → it lands, for
    // exactly one shot's worth of damage.
    {
      const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
      const target = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: 2 * TICK_DT });
      const world = makeWorld({ ships: [shooter, target] });
      const before = target.hull;
      step(world, [{ id: 0, actions: [fire()] }]); // fire one shot while protected
      for (let t = 0; t < 30; t++) step(world, []); // protection lapses, shot lands
      expect(before - world.ships[1]!.hull).toBeCloseTo(shipWeaponDamage(shooter), 6);
    }
  });
});

// --- §D. determinism (GDD §4.8) --------------------------------------------

describe('§D determinism — a four-class firefight replays byte-for-byte', () => {
  it('two runs from the same world + same inputs deep-equal', () => {
    const cfg = {
      seed: 909,
      players: [
        { id: 0, shipClass: ShipClass.Interceptor },
        { id: 1, shipClass: ShipClass.Vanguard },
        { id: 2, shipClass: ShipClass.Excavator },
        { id: 3, shipClass: ShipClass.Hauler },
      ],
      asteroidCount: 24,
    } as const;

    // Everyone thrusts on a per-slot orbit and holds auto-fire, so beams sweep
    // over ships and asteroids alike — the damage path runs every tick.
    const inputsAt = (tick: number): Inputs =>
      cfg.players.map((p) => ({
        id: p.id,
        actions: [
          { type: 'thrust', dir: { x: Math.cos(tick * 0.09 + p.id), y: Math.sin(tick * 0.12 + p.id) } },
          fire(true),
        ],
      }));

    const a = createWorld(cfg);
    const b = createWorld(cfg);
    for (let t = 0; t < 500; t++) {
      step(a, inputsAt(t));
      step(b, inputsAt(t));
    }
    expect(a).toEqual(b);
    expect(a.tick).toBe(500);
  });
});

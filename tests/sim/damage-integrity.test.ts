/**
 * tests/sim/damage-integrity.test.ts — combat that never silently fails to hurt.
 * OWNER: Gameplay Engineer (field report v0.2: "some ships would not take damage
 * from me"; GDD §2.1, §2.4, §2.6, §2.8, §4.8).
 *
 * The most serious kind of bug is the one where a beam plays the hit and the sim
 * quietly applies nothing. This file is the standing proof that it does not:
 *
 *  §A  THE DAMAGE MATRIX — for EVERY ship class attacking EVERY ship class, a
 *      beam held on the target for N ticks removes the EXACT expected hull, both
 *      manual and auto-aim. No attacker/target pair may zero out. Weapon DPS is
 *      the attacker's beam stat and hull class is armour *total*, never damage
 *      resistance, so the delta depends on the shooter and never on the victim.
 *
 *  §B  SHIELDED TARGETS bleed their pool by the same accounting: a planet's shield
 *      loses exactly the core-rate damage dealt before the core takes a scratch,
 *      for every attacker class — the "shields stand in front of the core" rule
 *      measured HP-for-HP (GDD §2.6).
 *
 *  §C  THE FIX for the field report — a spawn-protected ship is not a beam target:
 *      it takes zero damage (GDD §2.1) AND, crucially, does not *block* the beam.
 *      Before the fix a fresh spawn (10 s of protection at match start) clamped
 *      the beam on an invulnerable hull with no visual tell — the exact "would
 *      not take damage" report — and body-blocked a live enemy standing behind
 *      it. Ships now behave like protected cores/turrets: the beam passes over.
 *
 *  §D  DETERMINISM — a full four-class firefight replays byte-for-byte (GDD §4.8).
 *
 * VISUAL GAP filed to the UI agent in the PR body: a spawn-protected ship has no
 * on-screen tell, so a beam sweeping over one now (correctly) doing nothing still
 * has nothing that says "invulnerable." The sim is right; the read needs a shield
 * shimmer / protection ring on ships, the same tell the core wants.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  SHIP_RADIUS,
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

/** Beam `attacker` onto a stationary `target` directly ahead (+x) for `ticks`,
 *  and return the hull it lost. The target holds still and never fires. */
function hullLostOverBeam(attacker: ShipClass, target: ShipClass, ticks: number, auto: boolean): number {
  const shooter = makeShip({ id: 0, shipClass: attacker, pos: { x: 500, y: 500 }, angle: 0 });
  const victim = makeShip({ id: 1, shipClass: target, pos: { x: 620, y: 500 } });
  const world = makeWorld({ ships: [shooter, victim] });
  const before = victim.hull;
  const inputs: Inputs = [{ id: 0, actions: [fire(auto)] }];
  for (let t = 0; t < ticks; t++) step(world, inputs);
  return before - world.ships[1]!.hull;
}

// --- §A. the damage matrix -------------------------------------------------

describe('§A damage matrix — every class × every class, no pair zeroes (GDD §2.4, §2.8)', () => {
  // Short enough that even the frailest hull (Interceptor, 35) survives the
  // hardest hitter (Excavator, 13 DPS): 13 × 30/60 = 6.5 HP ≪ 35, so no target
  // ever dies mid-run and the delta is pure applied damage.
  const N = 30;

  for (const mode of [false, true] as const) {
    const label = mode ? 'auto-aim' : 'manual';

    describe(`${label} fire`, () => {
      for (const atk of CLASSES) {
        // Weapon DPS is the attacker's beam stat (one beam, one stat), so the
        // expected hull delta is the same whichever hull is on the receiving end.
        const expected = beamShipDps(atk) * TICK_DT * N;

        it(`${atk} deals its beam DPS (${beamShipDps(atk)}/s) to every target class, and never zero`, () => {
          const deltas = CLASSES.map((tgt) => hullLostOverBeam(atk, tgt, N, mode));

          for (let i = 0; i < CLASSES.length; i++) {
            const delta = deltas[i]!;
            // The load-bearing assertion: a real hit, exactly the expected size.
            expect(delta).toBeGreaterThan(0); // no pair silently zeroes out
            expect(delta).toBeCloseTo(expected, 8);
          }

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
  const N = 30;

  /** Beam `attacker` at a planet (with `shields`) directly ahead for `ticks`. */
  function beamPlanet(attacker: ShipClass, shields: Shield[], ticks: number) {
    // Shooter faces +x at 300; planet centre at 500 (owner slot 1, not the
    // shooter). centre gap 200, shield bubble r=90 → beam bites the bubble at
    // 110 u, well inside BEAM_RANGE.
    const shooter = makeShip({ id: 0, shipClass: attacker, pos: { x: 300, y: 500 }, angle: 0 });
    const planet = makePlanet(1, 500, 500, shields);
    const world = makeWorld({ ships: [shooter], planets: [planet] });
    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < ticks; t++) step(world, inputs);
    return world.planets[0]!;
  }

  for (const atk of CLASSES) {
    it(`${atk} strips shield HP at its core rate (${beamCoreDps(atk)}/s) and leaves the core untouched`, () => {
      const shield = makeShield(1);
      const before = shield.hp;
      // Core rate, not ship rate: shields and cores take the beam at the core
      // stat (GDD §2.8). Kept short so the 40 HP bubble never breaks.
      const expected = beamCoreDps(atk) * TICK_DT * N;
      expect(expected).toBeLessThan(SHIELD.hp); // precondition: the bubble holds

      const planet = beamPlanet(atk, [shield], N);
      const drop = before - shieldPool(planet);

      expect(drop).toBeGreaterThan(0);
      expect(drop).toBeCloseTo(expected, 8);
      // Not a single point leaked past the bubble to the core.
      expect(planet.coreHp).toBe(CORE_HP);
    });
  }

  it('a naked core (no shield) takes the same core-rate damage the shield would have', () => {
    const N2 = 30;
    for (const atk of CLASSES) {
      const shooter = makeShip({ id: 0, shipClass: atk, pos: { x: 300, y: 500 }, angle: 0 });
      const planet = makePlanet(1, 500, 500, []); // no shield: core is the surface
      const world = makeWorld({ ships: [shooter], planets: [planet] });
      const inputs: Inputs = [{ id: 0, actions: [fire()] }];
      for (let t = 0; t < N2; t++) step(world, inputs);

      const expected = beamCoreDps(atk) * TICK_DT * N2;
      expect(CORE_HP - world.planets[0]!.coreHp).toBeCloseTo(expected, 8);
    }
  });

  it('two stacked shields drain in build order, second only after the first is gone', () => {
    // Enough beam time to empty the first 40 HP bubble and bite into the second.
    // Excavator core DPS 6.5 → 40 HP in ~6.15 s; run 8 s.
    const first = makeShield(1);
    const second = makeShield(2);
    const N3 = 8 * 60;
    const shooter = makeShip({ id: 0, shipClass: ShipClass.Excavator, pos: { x: 300, y: 500 }, angle: 0 });
    const planet = makePlanet(1, 500, 500, [first, second]);
    const world = makeWorld({ ships: [shooter], planets: [planet] });
    const inputs: Inputs = [{ id: 0, actions: [fire()] }];

    const startPool = shieldPool(planet);
    for (let t = 0; t < N3; t++) step(world, inputs);

    const p = world.planets[0]!;
    const totalDrop = startPool - shieldPool(p);
    // All damage went into the pool, none skipped a bubble: the first is empty,
    // the second has taken the overflow, and the accounting is exact.
    expect(p.shields[0]!.hp).toBe(0);
    expect(p.shields[1]!.hp).toBeLessThan(SHIELD.hp);
    expect(p.shields[1]!.hp).toBeGreaterThan(0); // not yet through to the core
    expect(totalDrop).toBeCloseTo(beamCoreDps(ShipClass.Excavator) * TICK_DT * N3, 6);
    expect(p.coreHp).toBe(CORE_HP);
  });
});

// --- §C. the spawn-protection fix (field report v0.2) ----------------------

describe('§C a spawn-protected ship is not a beam target — no zero-damage wall (GDD §2.1)', () => {
  const N = 30;

  it('takes zero damage while protected (the protection itself still holds)', () => {
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
    const world = makeWorld({ ships: [shooter, target] });
    for (let t = 0; t < N; t++) step(world, [{ id: 0, actions: [fire()] }]);
    expect(world.ships[1]!.hull).toBe(target.maxHull);
  });

  it('does NOT block the manual beam: a live enemy directly behind it takes full damage', () => {
    // shooter → [protected @620] → [live @760], all on the +x axis. Before the
    // fix the beam clamped on the protected hull and the live enemy took nothing.
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const guard = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
    const behind = makeShip({ id: 2, pos: { x: 760, y: 500 } });
    const world = makeWorld({ ships: [shooter, guard, behind] });

    const before = behind.hull;
    for (let t = 0; t < N; t++) step(world, [{ id: 0, actions: [fire()] }]);

    // The protected shield ship is untouched; the beam passed over it and the
    // live enemy behind bled the shooter's full ship DPS.
    expect(world.ships[1]!.hull).toBe(guard.maxHull);
    expect(before - world.ships[2]!.hull).toBeCloseTo(beamShipDps(ShipClass.Vanguard) * TICK_DT * N, 8);
    // And the beam reached the far ship's surface rather than stopping short.
    expect(world.ships[0]!.beam!.length).toBeCloseTo(760 - 500 - SHIP_RADIUS, 6);
  });

  it('auto-aim skips a nearer protected ship and engages the live enemy', () => {
    // Protected enemy is the CLOSEST body; a live enemy sits farther off-axis.
    // Auto-aim must ignore the invulnerable one and lock the one it can hurt.
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const near = makeShip({ id: 1, pos: { x: 560, y: 500 }, spawnProtect: SPAWN_PROTECTION_S });
    const live = makeShip({ id: 2, pos: { x: 500, y: 640 } }); // 140 u away, perpendicular
    const world = makeWorld({ ships: [shooter, near, live] });

    const before = live.hull;
    for (let t = 0; t < N; t++) step(world, [{ id: 0, actions: [fire(true)] }]);

    expect(world.ships[1]!.hull).toBe(near.maxHull); // protected one ignored
    expect(before - world.ships[2]!.hull).toBeCloseTo(beamShipDps(ShipClass.Vanguard) * TICK_DT * N, 8);
  });

  it('protection wearing off mid-beam starts damage exactly when it expires', () => {
    // Protection is spent at the top of the tick, before the beam (step phase 1):
    // a ship with 2·dt left is guarded on tick 1 (2·dt → dt, beam sees dt > 0),
    // then vulnerable on tick 2 (dt → 0, the beam that tick already lands). No
    // lingering immunity, no lost hit — damage begins the tick protection hits 0.
    const dps = beamShipDps(ShipClass.Vanguard);
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: 2 * TICK_DT });
    const world = makeWorld({ ships: [shooter, target] });

    step(world, [{ id: 0, actions: [fire()] }]); // protect 2·dt → dt: guarded
    expect(world.ships[1]!.hull).toBe(target.maxHull);

    step(world, [{ id: 0, actions: [fire()] }]); // protect dt → 0: first tick of damage
    expect(world.ships[1]!.hull).toBeCloseTo(target.maxHull - dps * TICK_DT, 8);

    step(world, [{ id: 0, actions: [fire()] }]); // second tick of damage, and counting
    expect(world.ships[1]!.hull).toBeCloseTo(target.maxHull - 2 * dps * TICK_DT, 8);
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

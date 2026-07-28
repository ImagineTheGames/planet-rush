/**
 * tests/sim/turret-aim.test.ts — the turret lead-and-deviance aim model, measured.
 * OWNER: Gameplay Engineer (turret-lead field report v0.2.4).
 *
 * The field report: "turrets fire at where the enemy WAS, so they miss every shot
 * if the enemy is smart about it. Turrets should have some deviance to their
 * shots." The fix, mirroring the ship/bot aim model (p5-01), is two-part and
 * TIER-SCALED so upgrading a turret buys accuracy:
 *
 *   1. **intercept lead** — the turret aims where the target *will be*, solved by
 *      the one shared `leadAim` the sim's auto-aim and the bots also use (no
 *      second lead solver to drift). A shot fired where a strafing ship *is*
 *      misses — the whole reason combat became a projectile;
 *   2. **an aim model** — seeded angular error (`aimSpread`) around the solution
 *      plus a re-aim latency (`aimLatency`, the delay before the turret re-reads a
 *      juking target's velocity). Both tighten with tier: Mk I loosest, Mk III
 *      tightest.
 *
 * This file is the instrument. A lone turret of each tier fires at the exact
 * scenario the report names — a full-speed probe **orbiting a defended station** —
 * and the hits are counted off real projectile physics, pooled over several orbit
 * radii so the number is not a knife-edge on one orbit rhythm. It pins the design
 * bands the report asked for:
 *
 *   - Mk I lands a meaningful *minority* against a smart orbiter (dodging works);
 *   - the ladder holds, Mk I < Mk II < Mk III (a bought upgrade is felt);
 *   - Mk III is clearly better but never an aimbot;
 *   - a STATIONARY target is hit near-always at every tier (dodging is a choice,
 *     not free — the deviance is small next to a hull's angular size, so only a
 *     *mover* slips the stale lead);
 *   - the lead is correct: a constant-velocity crosser (no staleness) is hit, and
 *     a turret aiming where the target *was* would shoot behind it.
 *
 * Fully deterministic: fixed seed, fixed timestep, the sim's seeded RNG keyed per
 * turret/tick (never the shared wave stream). The printed table is the report's
 * measured-scenario deliverable.
 */

import { describe, it, expect } from 'vitest';
import type { Action } from '@shared/types';
import { ShipClass } from '@shared/types';
import {
  STATION,
  SHIP_RADIUS,
  TICK_DT,
  TURRET,
  TURRET_MAX_TIER,
  TURRET_TIERS,
  leadAim,
  shipTopSpeed,
  step,
  stockTiers,
  turretHomeAngle,
  turretOrbitPos,
  turretTierShotDamage,
  type MiningStation,
  type Ship,
  type Turret,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------
//
// One station at the arena centre with a single turret of the tier under test,
// against one indestructible probe (huge hull, so hull loss counts hits cleanly).
// Everything is placed station-relative so the geometry reads directly.

const CENTER = 3000;

function makeTurret(tier: number): Turret {
  const home = turretHomeAngle({ angle: 0 } as MiningStation, 0);
  const pos = turretOrbitPos({ pos: { x: CENTER, y: CENTER }, radius: STATION.radius } as MiningStation, home);
  const hp = TURRET_TIERS[tier]!.hp;
  return {
    id: 1,
    owner: 0,
    slot: 0,
    pos: { x: pos.x, y: pos.y },
    radius: TURRET.radius,
    hp,
    maxHp: hp,
    angle: home,
    orbitAngle: home,
    cooldown: 0,
    tier,
    targetId: null,
    aim: null,
    muzzle: null,
  };
}

function makeStation(turret: Turret): MiningStation {
  return {
    id: 0,
    owner: 0,
    pos: { x: CENTER, y: CENTER },
    radius: STATION.radius,
    coreHp: 100,
    maxCoreHp: 100,
    alive: true,
    deathTime: -1,
    spawnProtect: 0,
    angle: 0,
    sinceDamage: 100,
    repairing: false,
    turrets: [turret],
    shields: [],
    builds: [],
  };
}

const HUGE = 1e9; // an indestructible probe: hull loss is a clean hit counter.

// The orbiter is an Interceptor — the fast scout / miner-hunter (GDD §2.11) that
// actually strafes a defended station: the "smart about it" attacker the report
// names. Its speed is what a turret's stale lead has to keep up with.
const PROBE_CLASS = ShipClass.Interceptor;

function makeProbe(pos: { x: number; y: number }, vel: { x: number; y: number }): Ship {
  const loadout = { shipClass: PROBE_CLASS, tiers: stockTiers() };
  return {
    id: 1,
    shipClass: PROBE_CLASS,
    tiers: loadout.tiers,
    pos: { x: pos.x, y: pos.y },
    vel: { x: vel.x, y: vel.y },
    home: { x: pos.x, y: pos.y },
    angle: 0,
    hull: HUGE,
    maxHull: HUGE,
    cargo: 0,
    cargoCap: 2,
    banked: 0,
    alive: true,
    respawnTimer: 0,
    spawnProtect: 0,
    eliminated: false,
    radius: SHIP_RADIUS,
    firing: false,
  };
}

function makeWorld(turret: Turret, probe: Ship): World {
  return {
    time: 0,
    tick: 0,
    rngState: 0x51ee_d001,
    nextEntityId: 1000,
    ships: [probe],
    asteroids: [],
    chunks: [],
    stations: [makeStation(turret)],
    projectiles: [],
    bounds: { width: 2 * CENTER, height: 2 * CENTER },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
  };
}

interface HitRate {
  readonly shots: number;
  readonly hits: number;
  readonly rate: number;
}

const TOP = shipTopSpeed({ shipClass: PROBE_CLASS, tiers: stockTiers() });

// --- one measurement -------------------------------------------------------

/**
 * Fly a probe on a **kinematic circular orbit** of radius `R` around the station
 * at full ship speed and count what the tier's turret lands off real projectile
 * physics. The probe's pos/vel are set analytically each tick (the "smart
 * orbiter" that holds a perfect circle) and the sim is stepped with no probe
 * input; the turret acquires, slides, leads and fires exactly as it does in a
 * match. `RUN_S` seconds is several full orbits — a stable sample.
 */
function runOrbit(tier: number, R: number, RUN_S = 24): HitRate {
  const turret = makeTurret(tier);
  const omega = TOP / R; // constant angular speed at full linear speed
  let theta = 0;
  const probe = makeProbe(
    { x: CENTER + R * Math.cos(theta), y: CENTER + R * Math.sin(theta) },
    { x: -R * omega * Math.sin(theta), y: R * omega * Math.cos(theta) },
  );
  const world = makeWorld(turret, probe);
  const perShot = turretTierShotDamage(tier);

  const seen = new Set<number>();
  const ticks = Math.round(RUN_S / TICK_DT);
  for (let t = 0; t < ticks; t++) {
    // Re-assert the analytic orbit each tick (before the turret reads it).
    probe.pos.x = CENTER + R * Math.cos(theta);
    probe.pos.y = CENTER + R * Math.sin(theta);
    probe.vel.x = -R * omega * Math.sin(theta);
    probe.vel.y = R * omega * Math.cos(theta);

    step(world, [{ id: 1, actions: [] }]);
    for (const p of world.projectiles) if (p.active && p.owner === 0) seen.add(p.id);

    theta += omega * TICK_DT;
  }

  const shots = seen.size;
  const hits = Math.round((HUGE - probe.hull) / perShot);
  return { shots, hits, rate: shots > 0 ? hits / shots : 0 };
}

/** Orbit hit-rate pooled over several radii — not a knife-edge on one rhythm. */
const ORBIT_RADII = [245, 285, 315] as const;
function orbit(tier: number): HitRate {
  let shots = 0;
  let hits = 0;
  for (const R of ORBIT_RADII) {
    const r = runOrbit(tier, R);
    shots += r.shots;
    hits += r.hits;
  }
  return { shots, hits, rate: shots > 0 ? hits / shots : 0 };
}

/** Hit-rate against a dead-still probe parked in range — spread only, no lead to
 *  go stale. The report's "a stationary target gets hit near-always." */
function stationary(tier: number, RUN_S = 16): HitRate {
  const turret = makeTurret(tier);
  const probe = makeProbe({ x: CENTER + 160, y: CENTER }, { x: 0, y: 0 });
  const world = makeWorld(turret, probe);
  const perShot = turretTierShotDamage(tier);

  const seen = new Set<number>();
  const ticks = Math.round(RUN_S / TICK_DT);
  for (let t = 0; t < ticks; t++) {
    step(world, [{ id: 1, actions: [] }]);
    for (const p of world.projectiles) if (p.active && p.owner === 0) seen.add(p.id);
  }
  const shots = seen.size;
  const hits = Math.round((HUGE - probe.hull) / perShot);
  return { shots, hits, rate: shots > 0 ? hits / shots : 0 };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

const TIERS = TURRET_TIERS.map((_, i) => i);

// --- the table -------------------------------------------------------------

describe('turret aim model — measured hit-rate vs a station-orbiting probe (v0.2.4)', () => {
  const orbitRate = TIERS.map((t) => orbit(t));
  const sitRate = TIERS.map((t) => stationary(t));

  it('prints the hit-rate table', () => {
    const rows = TIERS.map(
      (t) =>
        `  ${TURRET_TIERS[t]!.label.padEnd(6)} | orbiting ${pct(orbitRate[t]!.rate).padStart(6)} ` +
        `(${orbitRate[t]!.hits}/${orbitRate[t]!.shots}) | stationary ${pct(sitRate[t]!.rate).padStart(6)} ` +
        `(${sitRate[t]!.hits}/${sitRate[t]!.shots})`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `\n  turret aim hit-rate vs a full-speed orbiter (pooled radii ${ORBIT_RADII.join('/')}u):\n` +
        rows.join('\n') +
        '\n',
    );
    expect(orbitRate[0]!.shots).toBeGreaterThan(40); // a real sample
  });

  it('Mk I lands a meaningful minority against a smart orbiter (dodging works)', () => {
    // Meaningful: it is a real deterrent, not a wet noodle...
    expect(orbitRate[0]!.rate).toBeGreaterThan(0.2);
    // ...but a clear minority: a smart orbiter slips most of a Mk I's shots.
    expect(orbitRate[0]!.rate).toBeLessThan(0.55);
  });

  it('the ladder holds — a bought upgrade tracks a mover better (Mk I < Mk II < Mk III)', () => {
    expect(orbitRate[0]!.rate).toBeLessThan(orbitRate[1]!.rate);
    expect(orbitRate[1]!.rate).toBeLessThan(orbitRate[2]!.rate);
  });

  it('Mk III is clearly better but never an aimbot', () => {
    // Clearly better: a solid margin over Mk I.
    expect(orbitRate[TURRET_MAX_TIER]!.rate).toBeGreaterThan(orbitRate[0]!.rate + 0.15);
    // Not an aimbot: a full-speed orbiter still slips a real share of its shots.
    expect(orbitRate[TURRET_MAX_TIER]!.rate).toBeLessThan(0.9);
  });

  it('a stationary target is hit near-always at every tier (dodging is a choice)', () => {
    for (const t of TIERS) {
      expect(sitRate[t]!.rate).toBeGreaterThan(0.9);
      // Not moving forfeits the dodge: every tier hits a sitting target far more
      // often than the same tier hits an orbiter.
      expect(sitRate[t]!.rate).toBeGreaterThan(orbitRate[t]!.rate + 0.2);
    }
  });
});

// --- lead correctness ------------------------------------------------------

describe('the lead is where the target WILL be, not where it was (v0.2.4)', () => {
  it('leadAim solves an exact intercept for a constant-velocity target', () => {
    // Turret at origin; target 200u away on +x, crossing at half muzzle speed.
    const origin = { x: 0, y: 0 };
    const targetPos = { x: 200, y: 0 };
    const targetVel = { x: 0, y: TURRET.projectileSpeed * 0.5 };
    const dir = leadAim(origin, targetPos, targetVel, TURRET.projectileSpeed);

    // It leads AHEAD of the target's motion — a positive y-aim, not the straight
    // +x bearing at where the target stands right now.
    expect(dir.y).toBeGreaterThan(0);

    // And the intercept is exact: advancing the shot and the target by the same
    // time t, they meet. Solve t from the x-closure (shot has no y bias but for
    // the lead, target has no x motion) and check the miss distance is ~0.
    // Sample the closest approach along the shot's flight.
    let best = Infinity;
    for (let t = 0; t <= 1; t += 1 / 600) {
      const sx = origin.x + dir.x * TURRET.projectileSpeed * t;
      const sy = origin.y + dir.y * TURRET.projectileSpeed * t;
      const tx = targetPos.x + targetVel.x * t;
      const ty = targetPos.y + targetVel.y * t;
      best = Math.min(best, Math.hypot(sx - tx, sy - ty));
    }
    expect(best).toBeLessThan(1); // meets to within a unit — an exact solution
  });

  it('a turret hits a fast constant-velocity crosser a where-it-was shot would miss', () => {
    // A probe crossing the turret's face at full speed on a straight line — no
    // reversal, so the committed (delayed) velocity never goes stale: the tier's
    // re-aim lag is irrelevant and only the lead itself is on trial.
    const tier = TURRET_MAX_TIER;
    const turret = makeTurret(tier);
    const startY = CENTER - 220;
    const probe = makeProbe({ x: CENTER + 150, y: startY }, { x: 0, y: TOP });
    const world = makeWorld(turret, probe);
    const startHull = probe.hull;

    // The moment the turret first looses a shot, record the bearing it fired and
    // the straight bearing at where the probe stood — the lead must sit ahead.
    let leadAhead = false;
    const ticks = Math.round(3.5 / TICK_DT);
    for (let t = 0; t < ticks; t++) {
      const beforeMuzzle = world.stations[0]!.turrets[0]!.muzzle;
      step(world, [{ id: 1, actions: [] }]);
      // constant-velocity straight line: re-assert so integration/drag can't bend it
      probe.pos.y = startY + TOP * (world.time);
      probe.vel.x = 0;
      probe.vel.y = TOP;

      const tt = world.stations[0]!.turrets[0]!;
      if (!beforeMuzzle && tt.muzzle) {
        const fired = Math.atan2(tt.muzzle.dir.y, tt.muzzle.dir.x);
        const straight = Math.atan2(probe.pos.y - tt.pos.y, probe.pos.x - tt.pos.x);
        // The probe moves in +y, so a leading shot points at a larger y than the
        // straight bearing: the fired bearing is ahead of (greater than) it.
        if (fired > straight) leadAhead = true;
      }
    }

    expect(leadAhead).toBe(true); // it aimed where the probe was GOING
    expect(probe.hull).toBeLessThan(startHull); // and connected — the lead lands
  });
});

// --- determinism -----------------------------------------------------------

describe('determinism (GDD §4.8)', () => {
  it('same fixture, same seed — identical shots, hits, and committed aim', () => {
    const a = runOrbit(0, 200);
    const b = runOrbit(0, 200);
    expect(a.shots).toBe(b.shots);
    expect(a.hits).toBe(b.hits);
    expect(a.rate).toBe(b.rate);
  });

  it('the seeded deviance is reproducible tick-for-tick', () => {
    // Two identical worlds stepped in lockstep hold byte-identical turret aim
    // state — the per-turret/tick RNG hash is a pure function of world state.
    const wA = makeWorld(makeTurret(0), makeProbe({ x: CENTER + 160, y: CENTER }, { x: 0, y: 60 }));
    const wB = makeWorld(makeTurret(0), makeProbe({ x: CENTER + 160, y: CENTER }, { x: 0, y: 60 }));
    const probeInput: Action[] = [];
    for (let t = 0; t < 300; t++) {
      step(wA, [{ id: 1, actions: probeInput }]);
      step(wB, [{ id: 1, actions: probeInput }]);
      const ta = wA.stations[0]!.turrets[0]!;
      const tb = wB.stations[0]!.turrets[0]!;
      expect(ta.aim?.error).toBe(tb.aim?.error);
      expect(ta.aim?.vel.x).toBe(tb.aim?.vel.x);
      expect(ta.angle).toBe(tb.angle);
      expect(ta.hp).toBe(tb.hp);
    }
  });
});

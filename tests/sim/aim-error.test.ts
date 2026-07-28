/**
 * tests/sim/aim-error.test.ts — the bot aim-error model, measured. OWNER: Bot
 * Engineer (GDD §2.9; v0.2.2 field report "enemies' aim is too accurate").
 *
 * The projectile pivot (design amendment v0.2) gave bots a perfect intercept
 * solve (`leadAim`), and with no error on top of it every difficulty became an
 * aimbot — a strafing player could not dodge, which is the whole point of a
 * projectile. The fix is a two-part, per-difficulty **aim-error model** in
 * `src/bots`:
 *
 *   1. **spread** — `DifficultyTuning.aimJitter`, an angular error drawn from the
 *      bot's seeded RNG and added to every aim bearing; the bot fires along that
 *      jittered line (`canHitDir`), so a wider spread is a wider miss;
 *   2. **reaction latency** — `DifficultyTuning.aimLatency`, the lag before a bot
 *      re-solves its lead on a target that changed course (`trackAimVelocity`),
 *      so a strafing target is led *where it was going* and the shot goes wide.
 *
 * This file is the instrument that keeps that honest. A lone bot gun of each tier
 * fires at a **juking probe** — a target patrolling a strafe band at full speed,
 * reversing at the band edges so it holds the ship engage range while dodging —
 * driving the exact shipped aim path (`aimAndFire`) at the exact tier cadence. It
 * counts shots and hits off real projectile physics, pools over several strafe
 * amplitudes to shake out phase-alignment noise, and pins the design bands the
 * field report asked for:
 *
 *   - EASY well under half — a strafing player evades most shots and feels clever;
 *   - the ladder holds, EASY < MEDIUM < HARD (difficulty is visible competence);
 *   - HARD strong but clearly under the aimbot it used to be — genuinely beatable;
 *   - a target that will not dodge (a sitting duck) is punished at every tier,
 *     because dodging is a choice, not free (the property `projectiles.test.ts`
 *     pins for the raw weapon);
 *   - personality leans inside the band — Bolt sprays wider than a neutral Easy
 *     bot — but can never cross into another tier.
 *
 * Fully deterministic: fixed seed, fixed timestep, the sim's seeded RNG. The
 * printed table is the source for `docs/bot-aim-error-p5.md`.
 */

import { describe, it, expect } from 'vitest';
import type { Action, AimAction, FireAction } from '@shared/types';
import { ShipClass, mulberry32 } from '@shared/types';
import {
  SHIP_RADIUS,
  TICK_DT,
  shipTopSpeed,
  shipWeaponDamage,
  step,
  stockTiers,
  type Ship,
  type World,
} from '../../src/sim';
import {
  Difficulty,
  DIFFICULTY_TUNING,
  PERSONALITIES,
  WEAPON_RANGE,
  aimAndFire,
  newAimTrack,
  type SelfView,
} from '../../src/bots';

// --- fixtures (self-contained, no ring layout — cf. projectiles.test.ts) ----

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const tiers = over.tiers ?? stockTiers();
  return {
    id: over.id,
    shipClass: cls,
    tiers,
    pos: over.pos ?? { x: 0, y: 0 },
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? { x: 0, y: 0 },
    angle: over.angle ?? 0,
    hull: over.hull ?? 100,
    maxHull: over.maxHull ?? 100,
    cargo: 0,
    cargoCap: 100,
    banked: 0,
    alive: true,
    respawnTimer: 0,
    spawnProtect: 0,
    eliminated: false,
    radius: SHIP_RADIUS,
    firing: false,
    weaponCooldown: 0,
  };
}

function makeWorld(ships: Ship[]): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships,
    asteroids: [],
    chunks: [],
    stations: [],
    projectiles: [],
    bounds: { width: 20000, height: 20000 },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
  };
}

/** The bot's aim path only reads pos/vel/angle/shipClass/tiers off its self view;
 *  build the minimal shape fresh each decision so it tracks the live ship. */
function selfViewOf(ship: Ship): SelfView {
  return {
    pos: ship.pos,
    vel: ship.vel,
    angle: ship.angle,
    shipClass: ship.shipClass,
    tiers: ship.tiers,
  } as unknown as SelfView;
}

// --- one measurement -------------------------------------------------------

/** The ship-vs-ship stand-off the trees actually hold (`engage`) — the range
 *  that matters in a real firefight. */
const ENGAGE_RANGE = WEAPON_RANGE * 0.6;
/** Sim seconds per run. */
const RUN_S = 28;
/** Strafe-band half-widths the juking hit-rate is pooled over — several so the
 *  number is not a knife-edge on one juke rhythm (a human's is not either). */
const STRAFE_AMPS = [30, 42, 55, 70] as const;

interface HitRate {
  readonly shots: number;
  readonly hits: number;
  readonly rate: number;
}

/**
 * Fire a lone bot gun (given cadence + spread + latency) at a probe at the engage
 * range and count what lands off real projectile physics. The shooter is
 * stationary — this measures *aim*, not navigation. `amp === 0` is a sitting duck
 * (never moves); `amp > 0` is a juker patrolling a ±`amp` strafe band at full
 * speed, reversing at the edges so it dodges while holding range.
 */
function runGun(reaction: number, jitter: number, latency: number, amp: number): HitRate {
  const HUGE = 1e7; // an indestructible probe: hull loss counts hits cleanly
  const loadout = { shipClass: ShipClass.Vanguard, tiers: stockTiers() };
  const top = shipTopSpeed(loadout);
  const perShot = shipWeaponDamage(loadout);

  const cx = 5000;
  const cy = 5000;
  const shooter = makeShip({ id: 0, pos: { x: cx, y: cy } });
  const target = makeShip({
    id: 1,
    pos: { x: cx + ENGAGE_RANGE, y: cy },
    hull: HUGE,
    maxHull: HUGE,
    vel: amp > 0 ? { x: 0, y: top } : { x: 0, y: 0 },
  });
  const world = makeWorld([shooter, target]);

  const track = newAimTrack();
  const rng = mulberry32(0x5eed_face);
  const seenShots = new Set<number>();
  let held: { aim: AimAction; fire: FireAction } | null = null;
  let sinceDecision = reaction; // decide on the first tick
  let dir = 1;

  const ticks = Math.round(RUN_S / TICK_DT);
  for (let t = 0; t < ticks; t++) {
    sinceDecision += TICK_DT;
    if (sinceDecision >= reaction) {
      sinceDecision = 0;
      held = aimAndFire(
        selfViewOf(shooter),
        target.pos,
        target.radius,
        target.vel,
        jitter,
        rng,
        track,
        target.id,
        world.time,
        latency,
      );
    }

    const probe: Action[] = [];
    if (amp > 0) {
      const off = target.pos.y - cy;
      if (off > amp) dir = -1;
      else if (off < -amp) dir = 1;
      probe.push({ type: 'thrust', dir: { x: 0, y: dir } });
    }

    step(world, [
      { id: 0, actions: held ? [held.aim, held.fire] : [] },
      { id: 1, actions: probe },
    ]);

    for (const p of world.projectiles) {
      if (p.active && p.owner === 0) seenShots.add(p.id);
    }
  }

  const shots = seenShots.size;
  const hits = Math.round((HUGE - target.hull) / perShot);
  return { shots, hits, rate: shots > 0 ? hits / shots : 0 };
}

/** Hit-rate against the juking probe, pooled over strafe amplitudes. */
function juke(reaction: number, jitter: number, latency: number): HitRate {
  let shots = 0;
  let hits = 0;
  for (const amp of STRAFE_AMPS) {
    const r = runGun(reaction, jitter, latency, amp);
    shots += r.shots;
    hits += r.hits;
  }
  return { shots, hits, rate: shots > 0 ? hits / shots : 0 };
}

/** Hit-rate against a sitting duck — spread only, no lead to go stale. */
function sitting(reaction: number, jitter: number, latency: number): HitRate {
  return runGun(reaction, jitter, latency, 0);
}

// --- the aim of each tier / character, exactly as the trees compute it ------

function clampScale(s: number): number {
  return s < 0.85 ? 0.85 : s > 1.4 ? 1.4 : s;
}

/** (cadence, spread, latency) for a tier, leaned by an optional `aimScale` —
 *  the same math `behaviors.ts` `combatSpread`/`combatLatency` apply. */
function aimOf(difficulty: Difficulty, aimScale = 1): [number, number, number] {
  const t = DIFFICULTY_TUNING[difficulty];
  const s = clampScale(aimScale);
  return [t.reactionInterval, t.aimJitter * s, t.aimLatency * s];
}

/** The old aimbot: a Hard-cadence gun with zero spread and zero latency (perfect
 *  re-lead every decision) — the ceiling the field report measures against. */
const AIMBOT_CADENCE = DIFFICULTY_TUNING[Difficulty.Hard].reactionInterval;

const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

describe('bot aim-error model — measured hit-rate vs a juking probe (v0.2.2)', () => {
  const jukeRate: Record<Difficulty, HitRate> = {
    [Difficulty.Easy]: juke(...aimOf(Difficulty.Easy)),
    [Difficulty.Medium]: juke(...aimOf(Difficulty.Medium)),
    [Difficulty.Hard]: juke(...aimOf(Difficulty.Hard)),
  };
  const sitRate: Record<Difficulty, HitRate> = {
    [Difficulty.Easy]: sitting(...aimOf(Difficulty.Easy)),
    [Difficulty.Medium]: sitting(...aimOf(Difficulty.Medium)),
    [Difficulty.Hard]: sitting(...aimOf(Difficulty.Hard)),
  };
  const aimbotJuke = juke(AIMBOT_CADENCE, 0, 0);
  const aimbotSit = sitting(AIMBOT_CADENCE, 0, 0);

  it('prints the hit-rate table', () => {
    const rows = TIERS.map(
      (d) =>
        `  ${d.padEnd(7)} | juking ${pct(jukeRate[d].rate).padStart(6)} (${jukeRate[d].hits}/${jukeRate[d].shots}) | sitting ${pct(sitRate[d].rate).padStart(6)} (${sitRate[d].hits}/${sitRate[d].shots})`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `\n  aim-error hit-rate vs probe at ${ENGAGE_RANGE.toFixed(0)}u (${RUN_S}s, pooled amps ${STRAFE_AMPS.join('/')}):\n` +
        rows.join('\n') +
        `\n  aimbot  | juking ${pct(aimbotJuke.rate)} (${aimbotJuke.hits}/${aimbotJuke.shots}) | sitting ${pct(aimbotSit.rate)}  ← old Hard, for reference\n`,
    );
    expect(jukeRate[Difficulty.Hard].shots).toBeGreaterThan(50); // a real sample
  });

  it('EASY lands well under half its shots on a juking target (dodging feels clever)', () => {
    expect(jukeRate[Difficulty.Easy].rate).toBeLessThan(0.3);
  });

  it('the ladder holds — competence rises with tier (EASY < MEDIUM < HARD)', () => {
    expect(jukeRate[Difficulty.Easy].rate).toBeLessThan(jukeRate[Difficulty.Medium].rate);
    expect(jukeRate[Difficulty.Medium].rate).toBeLessThan(jukeRate[Difficulty.Hard].rate);
  });

  it('HARD is strong but clearly under the aimbot it used to be (genuinely beatable)', () => {
    // Strong: it still lands a serious fraction on a full-speed juker.
    expect(jukeRate[Difficulty.Hard].rate).toBeGreaterThan(0.25);
    // Beatable: a clear margin under a perfect gun, and well under the 55%
    // round-robin win-rate ceiling QA holds the meta to.
    expect(jukeRate[Difficulty.Hard].rate).toBeLessThan(aimbotJuke.rate - 0.05);
    expect(jukeRate[Difficulty.Hard].rate).toBeLessThan(0.5);
  });

  it('dodging is a choice, not free — a sitting duck is punished at every tier', () => {
    for (const d of TIERS) {
      // Not dodging forfeits the dodge: each tier hits a sitting duck far more
      // often than the same tier hits a juker.
      expect(sitRate[d].rate).toBeGreaterThan(jukeRate[d].rate + 0.15);
    }
    // Even Easy connects on someone who will not move; the aimbot never misses one.
    expect(sitRate[Difficulty.Easy].rate).toBeGreaterThan(0.4);
    expect(aimbotSit.rate).toBeGreaterThan(0.95);
  });

  it('personality leans inside the band — Bolt (sprayer) fires wider than a neutral Easy bot', () => {
    const boltScale = PERSONALITIES.bolt.weights.aimScale ?? 1;
    expect(boltScale).toBeGreaterThan(1); // config: Bolt is the loose end of Easy

    const boltJuke = juke(...aimOf(Difficulty.Easy, boltScale));
    const boltSit = sitting(...aimOf(Difficulty.Easy, boltScale));
    // Wider spread + slower re-lead: Bolt lands fewer than a neutral Easy bot,
    // both on a juker and on a sitting duck.
    expect(boltJuke.rate).toBeLessThan(jukeRate[Difficulty.Easy].rate);
    expect(boltSit.rate).toBeLessThan(sitRate[Difficulty.Easy].rate);
    // ...but never crosses out of the Easy band into Medium's competence.
    expect(boltJuke.rate).toBeLessThan(jukeRate[Difficulty.Medium].rate);
  });

  it('the aimScale clamp keeps any character inside its tier (never an aimbot)', () => {
    // The tightest a Hard character could ever be tuned (aimScale floor 0.85)
    // still leaves a clear margin under the aimbot — no personality can snipe its
    // way past its tier's reaction lag onto the aimbot cliff.
    const tightestHard = juke(...aimOf(Difficulty.Hard, 0.5)); // floored to 0.85
    expect(tightestHard.rate).toBeLessThan(aimbotJuke.rate - 0.05);
  });
});

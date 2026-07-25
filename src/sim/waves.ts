/**
 * src/sim/waves.ts — the asteroid waves. OWNER: Gameplay Engineer.
 *
 * The field's total yield is finite and it arrives on a metronome: five waves,
 * `WAVE_INTERVAL_S` apart, **each spawning closer to the map center than the
 * last** (GDD §2.3). That shrinking disc is the match's shape — it pulls every
 * surviving player into a smaller and smaller contested space, and when the
 * last wave is exhausted the match enters collapse (see `./match`).
 *
 * Two rules make the ending structural rather than hoped-for:
 *
 *  1. **Finite yield.** Every wave carries exactly `WAVE_ORE` = `FIELD_YIELD` ÷
 *     `WAVE_COUNT`. Rock *sizes* and *positions* vary with the seed; the ore
 *     total does not, so no seed produces a match that can be farmed forever.
 *  2. **Fixed schedule.** Wave `n` lands at `waveTime(n)` — the same function
 *     the HUD's wave clock counts down to, so the clock can never promise a
 *     wave the sim does not deliver.
 *
 * Determinism (GDD §4.8): every draw comes from `world.rngState` in a fixed
 * order, and the wave that lands at t=600 is decided by the seed, not the
 * frame rate.
 */

import {
  ASTEROID,
  WAVE_COUNT,
  WAVE_ORE,
  clampToMargin,
  waveRadiusFraction,
  waveTime,
} from './constants';
import { rngRange } from './rng';
import type { Asteroid, World } from './state';

/** True once every wave in the schedule has been delivered — no more ore is
 *  ever coming (GDD §2.3, the precondition for collapse). */
export function allWavesSpawned(world: World): boolean {
  return world.match.wavesSpawned >= WAVE_COUNT;
}

/** Ore still available to a miner anywhere on the map: rock plus loose chunks.
 *  Debris around a wreck counts — it is ore, and it is scavengeable (GDD §2.7). */
export function fieldOre(world: World): number {
  let ore = 0;
  for (const a of world.asteroids) ore += a.ore;
  for (const c of world.chunks) ore += c.amount;
  return ore;
}

/** True when there is nothing left to mine or scoop anywhere. */
export function fieldExhausted(world: World): boolean {
  return fieldOre(world) <= 1e-9;
}

/**
 * Spawn the next wave: `count` rocks scattered in a disc whose radius shrinks
 * wave over wave, carrying exactly `WAVE_ORE` ore between them.
 *
 * Per-rock ore is drawn for variety and then scaled so the wave's total is the
 * design number — the payout a player can *judge* by looking at a rock stays
 * varied (GDD §5.5) while the match's economy stays finite. Advances
 * `world.match.wavesSpawned`.
 */
export function spawnWave(world: World, count: number = world.asteroidsPerWave): void {
  const n = world.match.wavesSpawned + 1;
  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  const discRadius = world.fieldRadius * waveRadiusFraction(n);

  let rng = world.rngState;
  const spawned: Asteroid[] = [];
  let drawnOre = 0;

  for (let i = 0; i < count; i++) {
    let r = rngRange(rng, 0, discRadius);
    const radius = r.value;
    rng = r.state;
    r = rngRange(rng, 0, 2 * Math.PI);
    const angle = r.value;
    rng = r.state;
    r = rngRange(rng, ASTEROID.minRadius, ASTEROID.maxRadius);
    const rockRadius = r.value;
    rng = r.state;
    r = rngRange(rng, ASTEROID.minOre, ASTEROID.maxOre);
    const ore = r.value;
    rng = r.state;
    drawnOre += ore;

    // The disc is well inside the arena on the default map, but a wide field on
    // a small QA world could scatter a rock into the wall margin — clamp so
    // NOTHING spawns within `WORLD_EDGE_MARGIN` of the bounds (field report P1).
    spawned.push({
      id: world.nextEntityId++,
      pos: {
        x: clampToMargin(cx + Math.cos(angle) * radius, rockRadius, world.bounds.width),
        y: clampToMargin(cy + Math.sin(angle) * radius, rockRadius, world.bounds.height),
      },
      radius: rockRadius,
      ore,
      maxOre: ore,
      crackStage: 0,
      mineBuffer: 0,
    });
  }

  // Normalize the wave to its ore budget. `drawnOre` is only zero for an empty
  // wave, in which case there is nothing to scale.
  if (drawnOre > 1e-9) {
    const scale = WAVE_ORE / drawnOre;
    for (const a of spawned) {
      a.ore *= scale;
      a.maxOre = a.ore;
    }
  }

  for (const a of spawned) world.asteroids.push(a);
  world.rngState = rng;
  world.match.wavesSpawned = n;
}

/**
 * Deliver every wave whose scheduled time has arrived (GDD §2.3). Normally one
 * per call at most; a coarse `dt` (the QA harness fast-forwards) can make two
 * come due in the same step, and both land rather than one being silently
 * dropped.
 *
 * Collapse closes the field for good — "no new ore" (GDD §2.3) — so nothing
 * spawns once it has begun, even if the schedule somehow still owes a wave.
 */
export function spawnDueWaves(world: World): void {
  if (world.match.collapseTime >= 0) return;
  while (!allWavesSpawned(world) && world.time >= waveTime(world.match.wavesSpawned + 1)) {
    spawnWave(world);
  }
}

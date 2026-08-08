/**
 * src/sim/station-health-visibility.test.ts — **a station's health tells the
 * truth at every range** (a0-05; GDD §2.2 amended 2026-08-07).
 *
 * The developer, 2026-08-07, verbatim: *"you can see other stations healths only
 * when you are near, it should always show the health regardless of proximity or
 * else it looks like a glitch approaching and getting far it looks like its full
 * health even if its damaged."*
 *
 * Two claims are pinned here, and the second is the one that matters:
 *
 *  1. {@link stationHealthVisible} is true for every viewer, every station, at
 *     every distance from touching the rock to the far corner of the arena —
 *     including the exact distance the retired `SENSOR_RANGE` used to cut at.
 *  2. **The old failure mode cannot come back.** A damaged station read from far
 *     away must not be indistinguishable from a healthy one. That is LESSONS §20
 *     stated as a test: the ring's fill is derived from `coreHp/maxCoreHp` and
 *     nothing else, so "damaged" and "healthy" produce different reads at the
 *     same distance, and the same read at different distances.
 *
 * The ring's geometry belongs to the render layer; what belongs here is the
 * *truth it is drawn from* and the rule about when it may be drawn. A range sweep
 * is the right shape for that: a single "expect(true).toBe(true)" would pass
 * forever without ever describing the bug it closes.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { stationHealthVisible } from './sensing';
import { createWorld, damageStation } from './index';
import { SHIELD, SPAWN_PROTECTION_S } from './constants';
import type { MiningStation, World } from './state';

/** The distance the retired `SENSOR_RANGE` cut at (2× shield radius = 180). Not
 *  imported — the constant is gone, and the point of the sweep is that this
 *  number has stopped meaning anything. Hard-coded so the test still describes
 *  the boundary it is asserting has no effect. */
const RETIRED_SENSOR_RANGE = 2 * SHIELD.radius;

function arena(slots = 8): World {
  const world = createWorld({
    seed: 11,
    players: Array.from({ length: slots }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
  });
  world.time = SPAWN_PROTECTION_S + 1;
  for (const station of world.stations) station.spawnProtect = 0;
  return world;
}

/** The fraction of the core that is GONE — exactly what the damage ring fills
 *  with threat red (GDD §2.2 grammar, §5.4). The render layer computes this
 *  inline; the test states it once so "what the ring says" has a name. */
function lostFraction(station: MiningStation): number {
  return 1 - station.coreHp / station.maxCoreHp;
}

describe('station health is visible at any range (GDD §2.2, amended 2026-08-07)', () => {
  it('reads true at every distance — touching the rock, the old cut, and the far corner', () => {
    const world = arena();
    const rival = world.stations[4]!;
    const diagonal = Math.hypot(world.bounds.width, world.bounds.height);

    const distances = [
      0,
      rival.radius,
      RETIRED_SENSOR_RANGE - 1,
      RETIRED_SENSOR_RANGE,
      RETIRED_SENSOR_RANGE + 1, // the exact step that used to blank the ring
      RETIRED_SENSOR_RANGE * 10,
      diagonal,
    ];

    for (const d of distances) {
      expect(stationHealthVisible(0, rival), `at ${d} units`).toBe(true);
    }
  });

  it('holds for every viewer over every station, wrecks included', () => {
    const world = arena();
    const wreck = world.stations[6]!;
    damageStation(world, wreck, wreck.maxCoreHp * 2);
    expect(wreck.alive).toBe(false); // the smoke was always public; now so are the numbers

    for (const station of world.stations) {
      for (const viewer of world.ships) {
        expect(stationHealthVisible(viewer.id, station)).toBe(true);
      }
    }
  });

  it('the fill is the core fraction and nothing else — so distance cannot enter it', () => {
    const world = arena();
    const rival = world.stations[4]!;
    const viewer = world.ships[0]!;

    damageStation(world, rival, rival.maxCoreHp * 0.6);
    const wounded = lostFraction(rival);
    expect(wounded).toBeCloseTo(0.6, 6);

    // Fly the viewer from the doorstep to the far corner. The read does not move.
    for (const at of [
      { x: rival.pos.x, y: rival.pos.y },
      { x: rival.pos.x + RETIRED_SENSOR_RANGE * 0.5, y: rival.pos.y },
      { x: rival.pos.x + RETIRED_SENSOR_RANGE * 20, y: rival.pos.y },
      { x: 0, y: 0 },
      { x: world.bounds.width, y: world.bounds.height },
    ]) {
      viewer.pos = at;
      expect(stationHealthVisible(viewer.id, rival)).toBe(true);
      expect(lostFraction(rival)).toBe(wounded);
    }
  });

  it('a damaged station never reads like a healthy one — the frame that was lying', () => {
    // The bug, restated as the assertion that closes it. From far away the old
    // renderer drew no ring at all, and the always-drawn owner-colour beacon ring
    // underneath meant "no red" — which is what full health looks like. So the
    // two states below were the SAME picture. They must never be again.
    const world = arena();
    const healthy = world.stations[2]!;
    const damaged = world.stations[4]!;
    damageStation(world, damaged, damaged.maxCoreHp * 0.75);

    // Same viewer, same (large) distance, two stations: the reads differ.
    world.ships[0]!.pos = { x: 0, y: 0 };
    expect(stationHealthVisible(0, healthy)).toBe(stationHealthVisible(0, damaged));
    expect(lostFraction(damaged)).toBeGreaterThan(lostFraction(healthy));
    expect(lostFraction(healthy)).toBe(0);
  });
});

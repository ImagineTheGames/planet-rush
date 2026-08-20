/**
 * src/bots/berth-ore-visibility.test.ts — **a ship parked on its own berth can
 * see its own ore field.** OWNER: Bot Engineer (brief a0-120; GDD §2.2, §2.6,
 * §2.8, §2.9).
 *
 * This file exists because of a number that was wrong by 392 units in the
 * direction that matters.
 *
 * `a0-117-tuning.md` §5 priced the one constant that closes the `excavator`'s
 * out-of-band win rate — `WORLD_SIZE`, which every arena distance is a fraction
 * of while `SHIP_SENSOR_RANGE` is absolute — and recorded a ceiling on it:
 *
 * > Past ~3150 a ship parked on its own berth senses **no ore at all** and its
 * > own field goes dark on the minimap — `src/sim/radar-fog.test.ts` passes at
 * > 3100 and fails at 3200.
 *
 * That reading is correct and it is also **not the ceiling**, because
 * `radar-fog.test.ts` builds one board: a two-player `octagon` at seed 7. Three
 * shipped maps take their bounds from `WORLD_SIZE` (`./maps` `SQUARE` —
 * `octagon`, `compass`, `crescents`; `oval`/`diamond`/`line` sit on the
 * hardcoded `WIDE`), and they do not sit their stations on the same ring.
 * `crescents` sits its eight homes at 916 from centre where `octagon` sits them
 * at 864, so its berths start further from their fields and it runs out of
 * sensor **first, by 392 units**. Measured across all three, 2–8 players and 60
 * seeds, the ceilings are the literals below: `crescents` **2807**, `octagon`
 * **3199**, `compass` **3735**. The middle one reproduces a0-117 exactly, which
 * is the cross-check that this file measures the same thing that report did.
 *
 * ### Why a *bots* file owns it
 *
 * Fog honesty is the bot lane's invariant (GDD §2.9): a bot perceives only what
 * a human in its cockpit could. That cuts both ways and this is the other way —
 * **an arena the human cannot see across is one the bot cannot see across
 * either**, and the first thing either of them looks for on spawn is the rock
 * they are about to mine. So the check is written twice, at both radii, because
 * they are different numbers and only one of them is the binding one:
 *
 *  - the **player's** minimap coverage, `SHIP_SENSOR_RANGE` = 520 (GDD §2.8,
 *    "Ship sensor (minimap)"), read through the sim's own `sensorSources` /
 *    `pointSensed` — the fog that decides whether the field is drawn at all;
 *  - the **bot's** `BotView.perception.visualRange` = 720 (`./perception`,
 *    capped at `HUMAN_VISUAL_RANGE`) — the on-screen reach a tree picks a mining
 *    site from.
 *
 * 720 > 520, so a human's map goes dark **before** a bot's cockpit does: the
 * bot-side ceilings are 3511 / 4299 / 4731 against the fog's 2807 / 3199 / 3735.
 * A bot never goes blind first, and that ordering is itself worth pinning — a
 * change that inverted it would be a fog-honesty break with the bot on the
 * *winning* side of it.
 *
 * ### What this file is FOR
 *
 * It is a tripwire on `WORLD_SIZE`, not a description of today's board. At the
 * shipped 2400 every case here passes with room to spare; its whole job is to go
 * red the day somebody grows the arena to buy a balance point, and to say — in
 * the failure message, on the map that binds — how much room there actually was.
 * a0-120 is that day: the dial that puts the `excavator` inside the band sits
 * **above** every ceiling below, so the trade is a hull win rate against an
 * invisible ore field, and the report (`tests/reports/a0-120-world-size.md`)
 * takes the ore field.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld } from '../sim';
import { MAPS } from '../sim/maps';
import { SHIP_SENSOR_RANGE, WORLD_SIZE } from '../sim/constants';
import { pointSensed, sensorSources } from '../sim/sensing';
import type { World } from '../sim/state';
import { DEFAULT_PERCEPTION, HUMAN_VISUAL_RANGE, perceive } from './perception';

// --- the boards under test -------------------------------------------------

/**
 * The maps whose arena is `WORLD_SIZE` (`./maps` `SQUARE`). The other three sit
 * on the hardcoded `WIDE` 3200×2000 and are untouched by this dial — listed by
 * exclusion rather than by name so a new `SQUARE` map joins this file for free.
 */
const SQUARE_MAPS = MAPS.filter((m) => m.bounds.width === WORLD_SIZE && m.bounds.height === WORLD_SIZE).map(
  (m) => m.id,
);

/** Lobby sizes. Every one of them, because the home field is stamped per live
 *  home and the count decides how many there are. */
const SIZES = [2, 3, 4, 5, 6, 7, 8] as const;

/** The draw the ceilings below were measured on. A home field is a seeded draw
 *  inside a fixed band, so one seed is a sample and sixty is the band. */
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

/** The measured ceilings: the largest `WORLD_SIZE` at which EVERY berth on that
 *  map still sees at least one rock of its own home field, over {@link SEEDS} ×
 *  {@link SIZES}. Both radii, because they are different numbers. */
const CEILING = {
  fog: { crescents: 2807, octagon: 3199, compass: 3735 },
  bot: { crescents: 3511, octagon: 4299, compass: 4731 },
} as const satisfies Record<'fog' | 'bot', Record<string, number>>;

/** The map that runs out of sensor first — the one "on every map" means. */
const BINDING_MAP = 'crescents';

// --- the two reads ---------------------------------------------------------

function board(mapId: string, players: number, seed: number, size: number): World {
  return createWorld({
    seed,
    players: Array.from({ length: players }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
    mapId,
    bounds: { width: size, height: size },
  });
}

/** This player's own home-field rocks — the neighbourhood stamped for its berth
 *  at construction (`sim/waves.ts` `spawnHomeFields`), never the commons. */
function ownField(world: World, owner: number) {
  return world.asteroids.filter((a) => a.home === owner);
}

/** Does the PLAYER's minimap draw any of its own field, from the berth? The
 *  sim's own fog seam, not a re-derivation of it. */
function fogSeesField(world: World, owner: number): boolean {
  const sources = sensorSources(world, owner);
  return ownField(world, owner).some((a) => pointSensed(sources, a.pos, a.radius));
}

/** Does the BOT in that cockpit have any of its own field in view? */
function botSeesField(world: World, owner: number): boolean {
  const inView = new Set(perceive(world, owner).asteroids.map((a) => a.id));
  return ownField(world, owner).some((a) => inView.has(a.id));
}

/** Every berth on one board, as `map/N/seed/owner` labels that failed. */
function blindBerths(mapId: string, size: number, read: (w: World, o: number) => boolean): string[] {
  const out: string[] = [];
  for (const players of SIZES) {
    for (const seed of SEEDS) {
      const world = board(mapId, players, seed, size);
      for (const ship of world.ships) {
        if (!read(world, ship.id)) out.push(`${mapId}/N=${players}/seed=${seed}/p${ship.id}`);
      }
    }
  }
  return out;
}

// --- 1. the shipped board --------------------------------------------------

describe('a ship on its own berth sees its own ore field — the shipped arena', () => {
  for (const mapId of SQUARE_MAPS) {
    it(`${mapId}: every berth's minimap draws its own field at WORLD_SIZE ${WORLD_SIZE}`, () => {
      expect(blindBerths(mapId, WORLD_SIZE, fogSeesField)).toEqual([]);
    });

    it(`${mapId}: and the bot in that cockpit has it in view too`, () => {
      expect(blindBerths(mapId, WORLD_SIZE, botSeesField)).toEqual([]);
    });
  }

  it('the fog is what binds, not the bot — a human goes dark first, on every map', () => {
    // Fog honesty runs both ways (GDD §2.9). A bot that could still see a field
    // its human counterpart cannot would be reading the board through a wider
    // window than the cockpit gives, which is the handicap-in-reverse.
    // 520 < 720: the reach a bot actually gets (`DEFAULT_PERCEPTION`), not just
    // the 900 ceiling `resolvePerception` clamps to.
    expect(SHIP_SENSOR_RANGE).toBeLessThan(DEFAULT_PERCEPTION.visualRange);
    expect(DEFAULT_PERCEPTION.visualRange).toBeLessThanOrEqual(HUMAN_VISUAL_RANGE);
    for (const mapId of SQUARE_MAPS) {
      const fog = CEILING.fog[mapId as keyof typeof CEILING.fog];
      const bot = CEILING.bot[mapId as keyof typeof CEILING.bot];
      expect(fog, `${mapId}: fog ceiling`).toBeLessThan(bot);
    }
  });
});

// --- 2. the ceilings, named ------------------------------------------------

describe('the ceiling on WORLD_SIZE, per map — the budget the arena dial has left', () => {
  for (const [mapId, ceiling] of Object.entries(CEILING.fog)) {
    it(`${mapId}: holds at ${ceiling} and breaks at ${ceiling + 1}`, () => {
      expect(blindBerths(mapId, ceiling, fogSeesField)).toEqual([]);
      // The other half of a named number: a ceiling nothing is ever measured
      // above is a guess. One unit past it, at least one berth is blind.
      expect(blindBerths(mapId, ceiling + 1, fogSeesField).length).toBeGreaterThan(0);
    });
  }

  it(`${BINDING_MAP} is the map that binds, and the shipped arena is under it`, () => {
    const lowest = Math.min(...Object.values(CEILING.fog));
    expect(CEILING.fog[BINDING_MAP]).toBe(lowest);
    // The line a0-120 refused to cross. If this goes red, `WORLD_SIZE` grew past
    // the point where a player parked at home can see the rocks they spawned
    // next to — on `crescents` first, whatever `octagon` still shows.
    expect(WORLD_SIZE, `WORLD_SIZE exceeds the ${BINDING_MAP} ceiling`).toBeLessThanOrEqual(lowest);
  });

  it('a0-117’s ~3150 was the octagon reading, and crescents is 392 units tighter', () => {
    // Kept as a case rather than a comment because it is the whole reason this
    // file exists: the number in the prior report was measured on one board.
    expect(CEILING.fog.octagon - CEILING.fog.crescents).toBe(392);
    expect(blindBerths('octagon', 3100, fogSeesField)).toEqual([]); // radar-fog passes
    expect(blindBerths('octagon', 3200, fogSeesField).length).toBeGreaterThan(0); // and fails
    // …while crescents was already dark at both.
    expect(blindBerths(BINDING_MAP, 3100, fogSeesField).length).toBeGreaterThan(0);
  });
});

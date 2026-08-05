/**
 * src/bots/rebuild.test.ts — a bot replaces what it lost, and never buys past a
 * cap. (Developer report p15-02: "bots don't repair or rebuild.")
 *
 * ── What the harness found, and what it refuted ──────────────────────────────
 *
 * The rebuild half of the report is two different claims, and they came back
 * differently.
 *
 * **Turrets and shields were already being replaced.** Build and rebuild are one
 * question in these trees — "I want two turrets and I have one" reads the same
 * whether the second was never built or was shot off ten seconds ago — so the
 * tier target gate *is* the rebuild path. Driven through an unstaged eight-bot
 * match at seed 1, it worked: Warden lost 7 turrets over the match and ordered 7,
 * Rusty lost 3 and ordered 3, Vulture lost 3 and ordered 3. That is recorded here
 * because a refuted half is worth locking too: these tests would have passed
 * before the branch, and they exist so the path stays honest.
 *
 * **The radar satellite was not.** `satellite` appeared nowhere in `src/bots`, so
 * no bot had ever built one — and a structure never built is a structure never
 * replaced. That is the genuine gap, and `hardDefence` closes it.
 *
 * **The counting was wrong under both.** The trees added `station.builds` — every
 * job on the station, of *every* kind — to the standing count of *one* kind, so a
 * shield fifteen seconds from done read as a turret already on order and a bot
 * with a hole in its ring sat on the ore waiting for a job that could never fill
 * it. That is the seam the first block below pins.
 */

import { describe, it, expect } from 'vitest';
import {
  SATELLITE,
  SHIELD,
  TICK_DT,
  TURRET,
  createWorld,
  isOver,
  step,
  type MiningStation,
  type World,
} from '../sim';
import { rebuildOrder } from './behaviors';
import { easyDefence } from './easy';
import { botInputs, botLobby, createBots, fillEmptySlots } from './harness';
import { hardDefence } from './hard';
import { mediumDefence } from './medium';
import { perceive } from './perception';
import type { PersonalityId } from './personalities';
import { PERSONALITIES } from './personalities';
import { context, createBrain } from './tree';
import type { BotCtx } from './tree';

/** Seeds the unstaged sweep plays out — five whole eight-bot matches. */
const SWEEP_SEEDS = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// A quiet board — one bot, its own home, nothing shooting at anything
// ---------------------------------------------------------------------------

function board(personality: PersonalityId): World {
  const world = createWorld({
    seed: 5,
    players: [{ id: 0, shipClass: PERSONALITIES[personality].shipClass }],
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  const station = world.stations[0]!;
  const ship = world.ships[0]!;
  station.spawnProtect = 0;
  station.sinceDamage = 999;
  ship.spawnProtect = 0;
  ship.banked = 40; // rich enough to buy anything on any tier's list
  ship.pos = { x: station.pos.x + 20, y: station.pos.y }; // docked
  return world;
}

function ctxOf(world: World, personality: PersonalityId): BotCtx {
  return context(perceive(world, 0), createBrain(PERSONALITIES[personality], { next: () => 0.5 }));
}

/** The tier plan each character plays to. */
function planFor(personality: PersonalityId, ctx: BotCtx) {
  const tier = PERSONALITIES[personality].difficulty;
  return tier === 'easy' ? easyDefence(ctx) : tier === 'medium' ? mediumDefence(ctx) : hardDefence(ctx);
}

/** What this character's spend plan wants to build at home right now. */
function wants(world: World, personality: PersonalityId): string | null {
  const ctx = ctxOf(world, personality);
  const purchase = rebuildOrder(ctx, planFor(personality, ctx));
  return purchase === null ? null : purchase.kind === 'order' ? purchase.item : purchase.track;
}

function turret(station: MiningStation, slot: number) {
  return {
    id: 100 + slot,
    owner: 0,
    slot,
    pos: { x: station.pos.x, y: station.pos.y },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    tier: 0,
    angle: 0,
    orbitAngle: 0,
    cooldown: 0,
    targetId: null,
    aim: null,
    muzzle: null,
  };
}

function shield(id: number) {
  return { id, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius };
}

function satellite(station: MiningStation) {
  return {
    id: 300,
    owner: 0,
    pos: { x: station.pos.x, y: station.pos.y },
    radius: SATELLITE.radius,
    hp: SATELLITE.hp,
    maxHp: SATELLITE.hp,
    orbitAngle: 0,
  };
}

// ---------------------------------------------------------------------------

describe('a bot replaces a destroyed structure (p15-02)', () => {
  // Every tier, because "rebuild" is not a tier's private business — the ring is
  // what stops the next hole at all three (GDD §2.6).
  for (const [personality, wantedTurrets] of [
    ['rusty', 3],
    ['foreman', 2],
    ['warden', 2],
  ] as const) {
    it(`${PERSONALITIES[personality].name} rebuilds a turret shot off a full ring`, () => {
      const world = board(personality);
      const station = world.stations[0]!;

      // At target: nothing to buy on the gun line.
      station.turrets = Array.from({ length: wantedTurrets }, (_, slot) => turret(station, slot));
      station.shields = [shield(200)];
      expect(wants(world, personality)).not.toBe('turret');

      // One turret dies. The ring is short, and the bot buys the replacement.
      station.turrets.pop();
      expect(wants(world, personality)).toBe('turret');
    });
  }

  it('rebuilds a shield the same way, once a gun is standing', () => {
    const world = board('patch');
    const station = world.stations[0]!;
    station.turrets = [turret(station, 0), turret(station, 1)];
    station.shields = [shield(200)];
    expect(wants(world, 'patch')).toBeNull();

    station.shields = [];
    expect(wants(world, 'patch')).toBe('shield');
  });

  it('rebuilds the radar satellite — the structure no bot used to build at all', () => {
    // Warden is the one character that wires its claim for radar (`hardDefence`),
    // so it is the one character that can lose one.
    const world = board('warden');
    const station = world.stations[0]!;
    station.turrets = [turret(station, 0), turret(station, 1)];
    station.shields = [shield(200)];

    // Nothing else left on the list: the dish.
    expect(wants(world, 'warden')).toBe('satellite');

    // Built — and now there is nothing to buy…
    station.satellites = [satellite(station)];
    expect(wants(world, 'warden')).toBeNull();

    // …until somebody shoots it off, which is the whole point of it being an
    // attackable body (feature f1).
    station.satellites = [];
    expect(wants(world, 'warden')).toBe('satellite');
  });

  it('leaves the dish to the character whose read it is', () => {
    // The cost is real (6 ore, above a shield's 5) and it buys a bot no vision
    // today — `BotView` does not read the sensed set — so only the tier that
    // plays the whole board buys it, and only its homesteader.
    for (const personality of ['sable', 'vulture'] as const) {
      const world = board(personality);
      const station = world.stations[0]!;
      station.turrets = [turret(station, 0), turret(station, 1)];
      station.shields = [shield(200)];
      expect(wants(world, personality)).toBeNull();
    }
    // …and Easy and Medium do not buy one at any character.
    for (const personality of ['rusty', 'patch'] as const) {
      const ctx = ctxOf(board(personality), personality);
      expect(planFor(personality, ctx).satellites).toBe(0);
    }
  });
});

describe('queued construction is counted by KIND (p15-02)', () => {
  it('a shield under construction does not stall a turret rebuild', () => {
    // The defect, exactly. `station.builds` counts every job of every kind; the
    // trees added it to the *turret* count, so a 15-second shield read as a gun
    // already on order and the hole in the ring stayed open for the duration.
    const world = board('warden');
    const station = world.stations[0]!;
    station.turrets = [turret(station, 0)]; // one short of Hard's two
    station.builds = [{ id: 900, kind: 'shield', slot: 0, remaining: SHIELD.buildTime, total: SHIELD.buildTime }];

    expect(station.builds.length).toBe(1); // the count that used to do the blocking
    expect(wants(world, 'warden')).toBe('turret');
  });

  it('a turret under construction DOES stall a second order for the same slot', () => {
    // The other half, and the reason the kind-agnostic count was there at all: a
    // bot must not queue its whole bank into the build list one decision at a
    // time (GDD §2.5 — construction is time, and the ore is spent up front).
    const world = board('warden');
    const station = world.stations[0]!;
    station.turrets = [turret(station, 0)];
    station.builds = [{ id: 901, kind: 'turret', slot: 1, remaining: TURRET.buildTime, total: TURRET.buildTime }];
    expect(wants(world, 'warden')).not.toBe('turret');
  });

  it('a queued satellite does not stall a shield, and a queued shield not the dish', () => {
    const world = board('warden');
    const station = world.stations[0]!;
    station.turrets = [turret(station, 0), turret(station, 1)];
    station.builds = [
      { id: 902, kind: 'satellite', slot: 0, remaining: SATELLITE.buildTime, total: SATELLITE.buildTime },
    ];
    expect(wants(world, 'warden')).toBe('shield');

    station.shields = [shield(200)];
    expect(wants(world, 'warden')).toBeNull(); // the dish is already on order
  });
});

describe('a bot never buys past a per-station cap (GDD §2.5)', () => {
  it('stops at the cap even when the tier would happily want more', () => {
    const world = board('rusty');
    const station = world.stations[0]!;

    // A full ring, a full bubble stack, and a dish: every cap in the game, met.
    station.turrets = Array.from({ length: TURRET.capPerStation }, (_, slot) => turret(station, slot));
    station.shields = Array.from({ length: SHIELD.capPerStation }, (_, i) => shield(200 + i));
    station.satellites = Array.from({ length: SATELLITE.capPerStation }, () => satellite(station));

    // Ask with a plan that wants more of everything than the sim allows: the
    // ledger clamps to the sim's own caps rather than filing orders it will
    // refuse `'cap-reached'`. (The view is built *after* the staging, because a
    // `BotCtx` is a snapshot of the world, not a window onto it.)
    const greedy = { turrets: 99, shields: 99, satellites: 99 };
    expect(rebuildOrder(ctxOf(world, 'rusty'), greedy)).toBeNull();
  });

  it('holds every cap, and replaces what it loses, across five unstaged matches', () => {
    // Both halves on a real board, in one sweep. The caps are what a rebuild path
    // gets wrong first — a structure dies, the slot frees, the bot rebuys, and
    // the count crosses the line — and they are contested here rather than
    // staged. Violations are accumulated and asserted once: `expect` inside the
    // inner loop is eight stations × ~50 000 ticks of assertion machinery, which
    // costs a minute of CI for no extra proof.
    const over = { turrets: 0, shields: 0, satellites: 0 };
    let lost = 0;
    let ordered = 0;
    let satellitesBuilt = 0;

    for (const seed of SWEEP_SEEDS) {
      const seats = fillEmptySlots();
      const world = createWorld({ seed, players: botLobby(seats) });
      const bots = createBots(seats, { seed });

      while (!isOver(world) && world.time < 20 * 60) {
        const inputs = botInputs(world, bots, TICK_DT);
        for (const input of inputs) {
          for (const action of input.actions) {
            if (action.type !== 'buildOrder') continue;
            if (action.item === 'turret') ordered++;
            if (action.item === 'satellite') satellitesBuilt++;
          }
        }
        const before = new Map(world.stations.map((s) => [s.owner, s.turrets.length]));

        step(world, inputs, TICK_DT);

        for (const station of world.stations) {
          let queuedTurrets = 0;
          let queuedShields = 0;
          let queuedSatellites = 0;
          for (const job of station.builds) {
            if (job.kind === 'turret') queuedTurrets++;
            else if (job.kind === 'shield') queuedShields++;
            else if (job.kind === 'satellite') queuedSatellites++;
          }
          if (station.turrets.length + queuedTurrets > TURRET.capPerStation) over.turrets++;
          if (station.shields.length + queuedShields > SHIELD.capPerStation) over.shields++;
          if ((station.satellites?.length ?? 0) + queuedSatellites > SATELLITE.capPerStation) {
            over.satellites++;
          }
          if (!station.alive) continue;
          const had = before.get(station.owner) ?? 0;
          if (station.turrets.length < had) lost += had - station.turrets.length;
        }
      }
    }

    // Standing plus queued, never past the line, for any kind, on any tick.
    expect(over).toEqual({ turrets: 0, shields: 0, satellites: 0 });

    // Turrets are lost, and turrets are bought — the rebuild path is live on a
    // board nobody arranged. Not an equality: a bot that dies with a hole in its
    // ring never fills it, and the opening ring is bought before anything has
    // been lost.
    expect(lost).toBeGreaterThan(10);
    expect(ordered).toBeGreaterThanOrEqual(lost);
    // And the structure that genuinely did not exist before this branch now does.
    expect(satellitesBuilt).toBeGreaterThan(0);
  }, 300_000);
});

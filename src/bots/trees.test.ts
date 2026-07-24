/**
 * src/bots/trees.test.ts — the three trees, in a match and in close-up.
 *
 * `./match-endgame.test.ts` proves the *ending* is structural by running eight
 * bots that never touch a control. This file makes the opposite claim about the
 * same simulation: eight bots that play — mine, bank, build, gang up, siege —
 * also reach a winner, at the shipped baseline constants, inside the harness
 * timeout that GDD §3.8 insists on.
 *
 * Then the close-ups: one test per clause of GDD §2.9 that the tier tests
 * (`./easy.test.ts`, `./hard.test.ts`) do not already own — Medium contesting a
 * wave off the public clock, Medium ganging the *leader* rather than the
 * weakest, Hard taking the guns off a planet before its core, and Vulture doing
 * what its name says.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Action } from '@shared/types';
import { CHUNK, SPAWN_PROTECTION_S, TURRET, WAVE_INTERVAL_S, createWorld, type World } from '../sim';
import { suppressTurrets } from './behaviors';
import { DEFAULT_MATCH_TIMEOUT_S, botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { mediumTarget } from './medium';
import { perceive } from './perception';
import { PERSONALITIES } from './personalities';
import { scorePlanet } from './targeting';
import { context, createBrain } from './tree';
import type { BotCtx } from './tree';

/** The offline match a solo player gets: eight planets, the whole cast, real
 *  trees, shipped constants (GDD §3.3). */
function offlineMatch(seed: number): { world: World; bots: ReturnType<typeof createBots> } {
  const seats = fillEmptySlots();
  const world = createWorld({ seed, players: botLobby(seats) });
  return { world, bots: createBots(seats, { seed }) };
}

/** A quiet arena for the close-ups: four homes, no rocks, no opening-seconds
 *  special cases. */
function board(seed = 4): World {
  const world = createWorld({
    seed,
    players: [0, 1, 2, 3].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 10;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const planet of world.planets) {
    planet.spawnProtect = 0;
    planet.sinceDamage = 999;
  }
  return world;
}

function ctxOf(world: World, id: number, personality: keyof typeof PERSONALITIES): BotCtx {
  return context(perceive(world, id), createBrain(PERSONALITIES[personality], { next: () => 0.5 }));
}

function thrustOf(actions: readonly Action[]): { x: number; y: number } {
  const t = actions.find((a) => a.type === 'thrust');
  return t && t.type === 'thrust' ? t.dir : { x: 0, y: 0 };
}

describe('the three trees, playing a whole match', () => {
  it('reaches a winner inside the enforced timeout, at shipped constants', () => {
    const { world, bots } = offlineMatch(1);
    const result = runHeadlessMatch(world, bots, { maxSeconds: DEFAULT_MATCH_TIMEOUT_S });

    // A hung match is a failed test, not a hung harness (GDD §3.8).
    expect(result.timedOut).toBe(false);
    expect(result.ended).toBe(true);
    expect(result.winner).not.toBeNull();
    expect(result.world.match.eliminated).toHaveLength(7);
    // And it ended because the bots played, not because entropy ran the clock
    // out: the shipped `COLLAPSE_CORE_DECAY` is zero (`src/sim/constants.ts`).
    expect(result.seconds).toBeLessThan(DEFAULT_MATCH_TIMEOUT_S);
  });

  it('plays the whole triangle — mine, spend, defend, attack (GDD §2.3)', () => {
    const { world, bots } = offlineMatch(2);
    // Wave 1's rocks, by id: the field as a whole *grows* when wave 2 lands
    // (GDD §2.3), so the opening rocks are what "somebody mined" is measured on.
    const waveOne = new Map(world.asteroids.map((a) => [a.id, a.ore]));
    const oreAtStart = [...waveOne.values()].reduce((sum, ore) => sum + ore, 0);
    const behaviors = new Set<string>();

    runHeadlessMatch(world, bots, {
      maxSeconds: 200,
      onTick: () => {
        for (const bot of bots) behaviors.add(bot.brain.lastBehavior);
      },
    });

    // Every corner of the triangle got used by somebody.
    for (const verb of ['mine', 'spend', 'defend', 'attack']) expect(behaviors).toContain(verb);
    // Rock came out of the field…
    const waveOneLeft = world.asteroids
      .filter((a) => waveOne.has(a.id))
      .reduce((sum, a) => sum + a.ore, 0);
    expect(waveOneLeft).toBeLessThan(oreAtStart);
    // …and turned into defences and hulls (GDD §2.5: ore has five competing uses).
    expect(world.planets.some((p) => p.turrets.length + p.builds.length > 0)).toBe(true);
    expect(world.ships.some((s) => s.banked > 0 || s.cargo > 0)).toBe(true);
  });

  it('spends ore without ever double-charging a one-shot press', () => {
    const { world, bots } = offlineMatch(3);
    runHeadlessMatch(world, bots, { maxSeconds: 240 });

    // Per-planet caps are the sim's to enforce, but a bot that latched a wheel
    // press would sit on the cap with a queue behind it and an empty bank
    // (`holdable` in `./harness`).
    for (const planet of world.planets) {
      expect(planet.turrets.length).toBeLessThanOrEqual(TURRET.capPerPlanet);
      expect(planet.turrets.length + planet.builds.length).toBeLessThanOrEqual(TURRET.capPerPlanet + 2);
    }
  });
});

describe('Medium — contests ore waves and gangs the leader (GDD §2.9)', () => {
  it('is already moving to the centre when the wave clock runs down', () => {
    const world = board();
    const me = world.ships[0]!;
    // Out in open space, hold empty, nothing threatening — and the next wave
    // twelve seconds out, which every HUD in the match is printing (GDD §2.2).
    me.pos = { x: 1200, y: 1200 };
    me.vel = { x: 0, y: 0 };
    world.time = WAVE_INTERVAL_S - 12;
    for (const ship of world.ships) if (ship.id !== 0) ship.alive = false;

    const bot = createBots([{ id: 0, personality: 'foreman' }], { seed: 5 })[0]!;
    const actions = bot.decide(perceive(world, 0));

    expect(bot.brain.lastBehavior).toBe('contest-wave');
    const dir = thrustOf(actions);
    const centre = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
    expect(dir.x * (centre.x - me.pos.x) + dir.y * (centre.y - me.pos.y)).toBeGreaterThan(0);
  });

  it('picks the strongest rival it has scouted, not the weakest', () => {
    const world = board();
    const me = world.ships[0]!;
    me.pos = { x: 2000, y: 2000 };

    // Two homes close enough to scout, one healthy and one nearly dead. The
    // wounded one is the easier kill; the design says gang the *leader*.
    const strong = world.planets.find((p) => p.owner === 1)!;
    const weak = world.planets.find((p) => p.owner === 2)!;
    strong.pos = { x: 2000 - 240, y: 2000 };
    weak.pos = { x: 2000 + 240, y: 2000 };
    strong.coreHp = strong.maxCoreHp;
    weak.coreHp = weak.maxCoreHp * 0.25;
    for (const ship of world.ships) if (ship.id !== 0) ship.alive = false;
    world.planets.find((p) => p.owner === 3)!.alive = false;

    const ctx = ctxOf(world, 0, 'foreman');
    const target = mediumTarget(ctx);
    expect(target).not.toBeNull();
    expect(target!.kind).toBe('planet');
    expect(target!.id).toBe(strong.owner);
  });
});

describe('Hard — the patient siege, and the wreck (GDD §2.6, §2.7)', () => {
  it('takes the guns off a planet it can see them on, and not one it cannot', () => {
    const world = board();
    const me = world.ships[0]!;
    const target = world.planets.find((p) => p.owner === 1)!;
    target.pos = { x: 2300, y: 2000 };
    me.pos = { x: 2000, y: 2000 };
    target.turrets = [
      {
        id: 50,
        owner: 1,
        slot: 0,
        pos: { x: target.pos.x, y: target.pos.y - (target.radius + TURRET.mountOffset) },
        radius: TURRET.radius,
        hp: TURRET.hp,
        maxHp: TURRET.hp,
        angle: 0,
        cooldown: 0,
        targetId: null,
      },
    ];

    const close = ctxOf(world, 0, 'sable');
    const scored = scorePlanet(close, close.view.planets.find((p) => p.owner === 1)!);
    expect(suppressTurrets(close, scored)).not.toBeNull();

    // The same planet, its barrels never counted: a bot that cannot see the guns
    // does not get to plan around them.
    const blind = ctxOf(world, 0, 'sable');
    blind.memory.planet(1)!.turrets = null;
    expect(suppressTurrets(blind, scored)).toBeNull();
  });

  it('sends the scavenger to the loose ore first — it is what Vulture is for', () => {
    const world = board();
    const me = world.ships[0]!;
    me.pos = { x: 2000, y: 2000 };
    me.cargo = 0;
    for (const ship of world.ships) if (ship.id !== 0) ship.alive = false;
    // A kill site: debris a couple of hundred units off, nobody guarding it.
    world.chunks = [0, 1, 2].map((i) => ({
      id: 900 + i,
      pos: { x: 2200 + i * 10, y: 2000 },
      vel: { x: 0, y: 0 },
      amount: CHUNK.ore,
      radius: CHUNK.radius,
    }));

    const vulture = createBots([{ id: 0, personality: 'vulture' }], { seed: 6 })[0]!;
    const actions = vulture.decide(perceive(world, 0));
    expect(vulture.brain.lastBehavior).toBe('scavenge');
    expect(thrustOf(actions).x).toBeGreaterThan(0);

    // Warden, on the same board, has better things to do (scavenge 0.3).
    const warden = createBots([{ id: 0, personality: 'warden' }], { seed: 6 })[0]!;
    warden.decide(perceive(world, 0));
    expect(warden.brain.lastBehavior).not.toBe('scavenge');
  });
});

/**
 * src/bots/cornered.test.ts — a blockaded bot FIGHTS (developer report p15,
 * ratified: "When I put myself in between their planet and they are damaged,
 * they can't decide whether to attack or flee. In this case they need to attack
 * and stop being scared.").
 *
 * The frame the developer photographed: Rusty at 38/70 hull, the player's ship
 * (22/60 — weaker than the fear model assumes!) parked squarely on the line
 * between Rusty and its home station. Rusty oscillates.
 *
 * `./commitment` cannot fix that, and this file's staging is the reason: the
 * p8-era hysteresis bounds how *often* the flee/fight pair flips, but the trap
 * here is geometric — fear pushes away from the threat, home pulls through it,
 * and the ship sits at the crossing. So the four things the ratification asks
 * for, each with its own describe block:
 *
 *  1. **detection geometry** — a threat on the home line corners the bot; the
 *     same threat, the same distance away but off the line, does not (it gets
 *     the ordinary latched retreat, which stays correct);
 *  2. **the commitment window** — once committed, the fear model gets no vote
 *     until the window closes, even when the geometry has already opened;
 *  3. **per-tier detection latency** — Hard reads the trap almost at once, Easy
 *     takes a visible while, everyone ends up fighting;
 *  4. **determinism** — the commitment never desyncs a replay (GDD §4.8).
 *
 * The soak half of the ratification — "no bot oscillates more than K flips
 * against a stationary blockader" — lives with the invariant it extends, in
 * `./commitment.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { BLOCKADE, SPAWN_PROTECTION_S, TICK_DT, createWorld, type World } from '../sim';
import { CORNERED_COMMIT_SECONDS, THREAT_RANGE, corneredBlockader } from './behaviors';
import { createBot, type Bot } from './bot';
import { committed } from './commitment';
import { corneredCommitted } from './cornered';
import { perceive } from './perception';
import { DIFFICULTY_TUNING, Difficulty, type PersonalityId } from './personalities';
import { dist } from './steering';
import { context } from './tree';

/** The same quiet board the other commitment tests stage on: four homes, no
 *  rocks, no spawn protection, no match-start alarm. */
function board(seed = 8): World {
  const world = createWorld({
    seed,
    players: [0, 1, 2, 3].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 10;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const station of world.stations) {
    station.spawnProtect = 0;
    station.sinceDamage = 999;
  }
  return world;
}

/** Hull fraction low enough to be past every tier's nerve (the floor on
 *  `retreatThreshold` is 0.15, so this is wounded for everybody). */
const WOUNDED = 0.12;

/** How far out from home the bot is caught — a plausible way back from the
 *  field, and long enough that a blockader at its midpoint has real tangents. */
const RUN_HOME = 700;

/** Where on that run the blockader parks. At 350 both endpoints sit outside the
 *  corridor, so the detour is a genuine arc rather than the degenerate
 *  "already-in-its-lap" case — the harder read to pass. */
const BLOCK_AT = 350;

/**
 * Stage the photograph: a wounded bot `RUN_HOME` units out from its own station
 * with an enemy ship parked on the line between them.
 *
 * `offset` slides the blockader off that line, which is the whole A/B of the
 * detection test — same threat, comparable distance, on the road or beside it.
 * Positions are set directly and the sim is never stepped, so nothing moves
 * except the clock: these tests are about a *decision*, not about flight.
 */
function blockade(opts: { personality: PersonalityId; along?: number; offset?: number; seed?: number }): {
  world: World;
  bot: Bot;
} {
  const world = board(opts.seed ?? 8);
  const home = world.stations.find((s) => s.owner === 0)!;
  const me = world.ships[0]!;
  const threat = world.ships[1]!;

  // Straight out from home toward the arena centre — where the ore is, and so
  // where a bot on its way back from the field actually comes from.
  const dx = world.bounds.width / 2 - home.pos.x;
  const dy = world.bounds.height / 2 - home.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const out = { x: dx / d, y: dy / d };
  const perp = { x: -out.y, y: out.x };

  me.pos = { x: home.pos.x + out.x * RUN_HOME, y: home.pos.y + out.y * RUN_HOME };
  me.vel = { x: 0, y: 0 };
  me.hull = me.maxHull * WOUNDED;

  const along = opts.along ?? BLOCK_AT;
  const offset = opts.offset ?? 0;
  threat.pos = {
    x: home.pos.x + out.x * along + perp.x * offset,
    y: home.pos.y + out.y * along + perp.y * offset,
  };
  threat.vel = { x: 0, y: 0 };
  for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;

  return { world, bot: createBot({ id: 0, personality: opts.personality }, { seed: 3 }) };
}

/** Run decisions forward without moving anything, and return the sim time the
 *  bot first committed to the fight (`null` if it never did). */
function timeToCommit(world: World, bot: Bot, seconds: number): number | null {
  const start = world.time;
  const steps = Math.round(seconds / TICK_DT);
  for (let i = 0; i < steps; i++) {
    world.time += TICK_DT;
    bot.decide(perceive(world, 0));
    if (bot.brain.lastBehavior === 'cornered-fight') return world.time - start;
  }
  return null;
}

describe('the blockade is detected by geometry, not by fear (ratified point 1)', () => {
  it('corners a damaged bot whose own station is behind the threat — and it fights', () => {
    const { world, bot } = blockade({ personality: 'rusty' });
    // The photograph: threat squarely on the line, and closer than home.
    const home = world.stations.find((s) => s.owner === 0)!;
    expect(dist(world.ships[1]!.pos, home.pos)).toBeLessThan(dist(world.ships[0]!.pos, home.pos));

    expect(timeToCommit(world, bot, 6)).not.toBeNull();
    expect(bot.brain.lastBehavior).toBe('cornered-fight');
    // And it is fighting *that* ship, not something it wandered into.
    expect(corneredBlockader(context(perceive(world, 0), bot.brain))?.id).toBe(1);
  });

  it('does not corner on a threat standing beside the road — that is still a retreat', () => {
    // Same tier, same wound, a comparable distance away (~353 u, inside the
    // threat range so the ordinary retreat definitely engages) — but a corridor
    // and change off the line home.
    const { world, bot } = blockade({
      personality: 'rusty',
      along: RUN_HOME - 150,
      offset: BLOCKADE.corridor + 60,
    });
    expect(dist(world.ships[0]!.pos, world.ships[1]!.pos)).toBeLessThan(THREAT_RANGE);

    // A beat in: an ordinary committed retreat, which is the whole claim.
    expect(timeToCommit(world, bot, 1)).toBeNull();
    expect(bot.brain.lastBehavior).toBe('retreat');
    expect(committed(bot.brain.fleeing)).toBe(true);
    // And out to six seconds it never becomes a *blockade*. It does eventually
    // stop being a retreat, and that is a0-107 rather than this branch: nothing
    // in this staging ever moves, so the bot opens no ground and closes no road,
    // and after Rusty's 3.9 s of patience the standoff reads a retreat that is
    // getting nowhere and turns. `turn-and-fight`, not `cornered-fight` — a
    // different branch, on a geometry that is still not a blockade.
    expect(timeToCommit(world, bot, 5)).toBeNull();
    expect(bot.brain.lastBehavior).toBe('turn-and-fight');
  });

  it('does not corner an undamaged bot — only fear can build the trap fear falls into', () => {
    const { world, bot } = blockade({ personality: 'rusty' });
    world.ships[0]!.hull = world.ships[0]!.maxHull; // whole
    expect(timeToCommit(world, bot, 6)).toBeNull();
    expect(corneredCommitted(bot.brain.cornered, world.time)).toBe(false);
  });

  it('does not corner on a threat sitting past the destination — that is a siege', () => {
    // Parked on the far side of home: it is not standing between anything.
    const { world, bot } = blockade({ personality: 'rusty', along: -120 });
    expect(timeToCommit(world, bot, 6)).toBeNull();
  });

  it('lets go the moment the blockader dies — the path is open', () => {
    const { world, bot } = blockade({ personality: 'warden' });
    expect(timeToCommit(world, bot, 6)).not.toBeNull();

    world.ships[1]!.alive = false;
    world.time += TICK_DT;
    bot.decide(perceive(world, 0));
    expect(bot.brain.lastBehavior).not.toBe('cornered-fight');
    expect(corneredCommitted(bot.brain.cornered, world.time)).toBe(false);
  });
});

describe('the commitment window is honoured (ratified point 2)', () => {
  it('keeps fighting after the geometry opens, until the window closes', () => {
    const { world, bot } = blockade({ personality: 'warden' });
    const home = world.stations.find((s) => s.owner === 0)!;
    expect(timeToCommit(world, bot, 6)).not.toBeNull();
    const committedAt = world.time;

    // The road opens: the blockader slides off the line, close enough that a
    // plain fear model would certainly still want to run (inside THREAT_RANGE),
    // but no longer standing on the way home.
    const dx = world.bounds.width / 2 - home.pos.x;
    const dy = world.bounds.height / 2 - home.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const perp = { x: -dy / d, y: dx / d };
    const me = world.ships[0]!;
    world.ships[1]!.pos = { x: me.pos.x + perp.x * 300, y: me.pos.y + perp.y * 300 };
    expect(dist(me.pos, world.ships[1]!.pos)).toBeLessThan(THREAT_RANGE);

    // Inside the window: no re-evaluation. It is still fighting, and its fear
    // latch is *released* rather than merely outvoted.
    for (let i = 0; i < 10; i++) {
      world.time += TICK_DT;
      bot.decide(perceive(world, 0));
      expect(bot.brain.lastBehavior).toBe('cornered-fight');
    }
    expect(committed(bot.brain.fleeing)).toBe(false);
    expect(world.time - committedAt).toBeLessThan(CORNERED_COMMIT_SECONDS);

    // Past the window, with the road genuinely open: it re-decides, and now the
    // ordinary latched retreat is the right answer again.
    world.time = committedAt + CORNERED_COMMIT_SECONDS + TICK_DT;
    bot.decide(perceive(world, 0));
    expect(corneredCommitted(bot.brain.cornered, world.time)).toBe(false);
    expect(bot.brain.lastBehavior).toBe('retreat');
  });

  it('renews the commitment for as long as the road stays shut', () => {
    const { world, bot } = blockade({ personality: 'sable' });
    expect(timeToCommit(world, bot, 6)).not.toBeNull();

    // Three whole windows' worth of decisions with nothing moving: the bot never
    // once goes back to being scared.
    const steps = Math.round((CORNERED_COMMIT_SECONDS * 3) / TICK_DT);
    for (let i = 0; i < steps; i++) {
      world.time += TICK_DT;
      bot.decide(perceive(world, 0));
      expect(bot.brain.lastBehavior).toBe('cornered-fight');
    }
  });

  it('a core under final assault still outranks it, and clears the commitment', () => {
    const { world, bot } = blockade({ personality: 'warden' });
    expect(timeToCommit(world, bot, 6)).not.toBeNull();

    // The one strictly-higher priority (v0.2.2 field report point 1).
    const home = world.stations.find((s) => s.owner === 0)!;
    home.coreHp = home.maxCoreHp * 0.2;
    home.sinceDamage = 0;
    world.time += TICK_DT;
    bot.decide(perceive(world, 0));
    expect(bot.brain.lastBehavior).toBe('last-stand');
    expect(corneredCommitted(bot.brain.cornered, world.time)).toBe(false);
  });
});

describe('per-tier detection latency (ratified point 3)', () => {
  /** One representative character per tier, all in the identical trap. */
  const CAST: ReadonlyArray<{ id: PersonalityId; tier: Difficulty }> = [
    { id: 'rusty', tier: Difficulty.Easy },
    { id: 'foreman', tier: Difficulty.Medium },
    { id: 'warden', tier: Difficulty.Hard },
  ];

  it('every tier eventually commits, each at roughly its own tuned lag', () => {
    const measured = CAST.map(({ id, tier }) => {
      const { world, bot } = blockade({ personality: id });
      const t = timeToCommit(world, bot, 8);
      expect(t, `${id} never committed to the fight`).not.toBeNull();
      return { id, tier, t: t!, tuned: DIFFICULTY_TUNING[tier].blockadeDetectSeconds };
    });

    for (const m of measured) {
      // The lag is the tuning, not an accident of sampling: within one decision
      // of the tier's own `blockadeDetectSeconds`.
      expect(m.t, `${m.id} committed at ${m.t.toFixed(2)}s, tuned ${m.tuned}s`).toBeGreaterThanOrEqual(m.tuned);
      expect(m.t).toBeLessThan(m.tuned + 0.2);
    }
  });

  it('Hard reads the trap fastest and Easy slowest — the ladder is intact', () => {
    const [easy, medium, hard] = CAST.map(({ id }) => {
      const { world, bot } = blockade({ personality: id });
      return timeToCommit(world, bot, 8)!;
    });
    expect(hard).toBeLessThan(medium!);
    expect(medium!).toBeLessThan(easy!);
    // And Easy's lag is long enough for the visible wobble the developer
    // ratified as acceptable at this tier only — several of its own decisions.
    expect(easy! / DIFFICULTY_TUNING[Difficulty.Easy].reactionInterval).toBeGreaterThan(5);
  });
});

describe('determinism — the cornered commitment never desyncs a replay (GDD §4.8)', () => {
  it('two identical blockades produce identical behavior traces', () => {
    function trace(): string[] {
      const { world, bot } = blockade({ personality: 'rusty', seed: 5 });
      const out: string[] = [];
      for (let i = 0; i < 600; i++) {
        world.time += TICK_DT;
        bot.decide(perceive(world, 0));
        out.push(bot.brain.lastBehavior);
      }
      return out;
    }
    expect(trace()).toEqual(trace());
  });

  it('a fresh brain carries no commitment, and a dead ship drops the one it had', () => {
    const { world, bot } = blockade({ personality: 'warden' });
    expect(corneredCommitted(bot.brain.cornered, world.time)).toBe(false);
    expect(timeToCommit(world, bot, 6)).not.toBeNull();

    // Killed mid-commitment: the respawn is a clean slate (GDD §2.7), so the
    // next life must not inherit this life's blockade.
    world.ships[0]!.alive = false;
    world.time += TICK_DT;
    bot.decide(perceive(world, 0));
    expect(corneredCommitted(bot.brain.cornered, world.time)).toBe(false);
  });
});

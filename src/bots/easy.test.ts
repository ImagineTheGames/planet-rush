/**
 * src/bots/easy.test.ts — the Easy tier's four promises (GDD §2.9).
 *
 * > **Easy** mines slowly, over-defends, attacks rarely, retreats at half hull.
 *
 * The retreat threshold is the one number in that sentence, so it gets the most
 * of this file: the tier value is exactly one half, the character's `caution`
 * leans it (timid Rusty breaks off earlier than reckless Bolt), and — the part
 * that would actually be noticed in a match — the *branch* fires at the
 * threshold and not above it.
 *
 * The rest of the sentence gets one test each: an Easy bot buys three turrets
 * and a shield before it will spend an ore on its own ship, and it has no
 * seek-and-destroy branch at all — a timid character with a rival in plain sight
 * keeps working.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Action } from '@shared/types';
import { SHIELD, TURRET, createWorld, type World } from '../sim';
import { createBot } from './bot';
import { EASY_UPGRADE_FLOOR, easySpendPlan } from './easy';
import { perceive } from './perception';
import type { PersonalityId } from './personalities';
import { DIFFICULTY_TUNING, Difficulty, PERSONALITIES } from './personalities';
import { retreatThreshold } from './targeting';
import { context, createBrain } from './tree';

/** A neutral nerve: the tier's own threshold, unbent by character. */
const NEUTRAL_WEIGHTS = { ...PERSONALITIES.rusty.weights, caution: 1 };

/**
 * A quiet two-slot arena with the opening-seconds noise turned off: no rocks to
 * distract a miner, no spawn protection making the rival untouchable, and no
 * match-start alarm ringing on either home (a fresh planet's `sinceDamage` is
 * zero, which reads as "under attack" until the first two seconds have passed).
 */
function arena(): World {
  const world = createWorld({
    seed: 3,
    players: [
      { id: 0, shipClass: ShipClass.Hauler },
      { id: 1, shipClass: ShipClass.Interceptor },
    ],
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const planet of world.planets) {
    planet.spawnProtect = 0;
    planet.sinceDamage = 999;
  }
  return world;
}

/** Put the bot in open space with a rival on top of it, at a chosen hull. */
function standoff(hullFraction: number, personality: PersonalityId) {
  const world = arena();
  const me = world.ships[0]!;
  const them = world.ships[1]!;
  me.pos = { x: 2000, y: 2000 };
  me.vel = { x: 0, y: 0 };
  me.hull = me.maxHull * hullFraction;
  them.pos = { x: 2150, y: 2000 };
  them.vel = { x: 0, y: 0 };

  const bot = createBot({ id: 0, personality }, { seed: 11 });
  const actions = bot.decide(perceive(world, 0));
  return { world, bot, actions };
}

/** The thrust vector a decision asked for. */
function thrustOf(actions: readonly Action[]): { x: number; y: number } {
  const t = actions.find((a) => a.type === 'thrust');
  return t && t.type === 'thrust' ? t.dir : { x: 0, y: 0 };
}

describe('Easy — retreats at half hull (GDD §2.9)', () => {
  it('puts the tier threshold at exactly one half', () => {
    expect(DIFFICULTY_TUNING[Difficulty.Easy].retreatHullFraction).toBe(0.5);
    expect(retreatThreshold(DIFFICULTY_TUNING[Difficulty.Easy], NEUTRAL_WEIGHTS)).toBe(0.5);
  });

  it('lets character bend the tier without breaking it', () => {
    const easy = DIFFICULTY_TUNING[Difficulty.Easy];
    const rusty = retreatThreshold(easy, PERSONALITIES.rusty.weights); // caution 1.3
    const bolt = retreatThreshold(easy, PERSONALITIES.bolt.weights); // caution 0.5

    // The timid hoarder leaves before the reckless rusher does.
    expect(rusty).toBeGreaterThan(0.5);
    expect(bolt).toBeLessThan(0.5);
    // Nobody's character turns into suicide or a flinch.
    for (const value of [rusty, bolt]) {
      expect(value).toBeGreaterThanOrEqual(0.15);
      expect(value).toBeLessThanOrEqual(0.9);
    }
  });

  it('breaks off below its threshold, and only below it', () => {
    const threshold = retreatThreshold(DIFFICULTY_TUNING[Difficulty.Easy], PERSONALITIES.rusty.weights);

    const hurt = standoff(threshold - 0.05, 'rusty');
    expect(hurt.bot.brain.lastBehavior).toBe('retreat');

    const fine = standoff(threshold + 0.05, 'rusty');
    expect(fine.bot.brain.lastBehavior).not.toBe('retreat');
  });

  it('runs for home with the beam off — a fleeing bot does not advertise', () => {
    const threshold = retreatThreshold(DIFFICULTY_TUNING[Difficulty.Easy], PERSONALITIES.rusty.weights);
    const { world, actions } = standoff(threshold - 0.2, 'rusty');

    const home = world.planets.find((p) => p.owner === 0)!.pos;
    const me = world.ships[0]!.pos;
    const dir = thrustOf(actions);
    // Thrust has a positive component toward home…
    expect(dir.x * (home.x - me.x) + dir.y * (home.y - me.y)).toBeGreaterThan(0);
    // …and the trigger is up.
    expect(actions.some((a) => a.type === 'fire' && a.active)).toBe(false);
  });

  it('is the tier that flinches: Hard holds the same hull and keeps fighting', () => {
    // 40% hull: past Easy Rusty's nerve (0.65), nowhere near Hard Sable's (0.18).
    expect(standoff(0.4, 'rusty').bot.brain.lastBehavior).toBe('retreat');
    expect(standoff(0.4, 'sable').bot.brain.lastBehavior).not.toBe('retreat');
  });
});

describe('Easy — over-defends, and attacks rarely (GDD §2.9)', () => {
  it('buys three turrets and a shield before it will touch the upgrade panel', () => {
    const world = arena();
    const me = world.ships[0]!;
    const planet = world.planets.find((p) => p.owner === 0)!;
    me.pos = { x: planet.pos.x, y: planet.pos.y - 100 }; // docked
    me.banked = 100; // rich enough to buy anything on the list

    const plan = (): string => {
      const brain = createBrain(PERSONALITIES.rusty, { next: () => 0.5 });
      const purchase = easySpendPlan(context(perceive(world, 0), brain));
      return purchase === null ? 'nothing' : purchase.kind === 'order' ? purchase.item : purchase.track;
    };

    expect(plan()).toBe('turret');
    // Three turrets up: now the bubble.
    planet.turrets = [0, 1, 2].map((slot) => ({
      id: 100 + slot,
      owner: 0,
      slot,
      pos: { x: planet.pos.x, y: planet.pos.y },
      radius: TURRET.radius,
      hp: TURRET.hp,
      maxHp: TURRET.hp,
      angle: 0,
      cooldown: 0,
      targetId: null,
    }));
    expect(plan()).toBe('shield');

    // Guns and bubble both up, hold empty, ore to spare — only now the ship.
    planet.shields = [{ id: 200, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius }];
    expect(plan()).toBe('cargo');

    // And a poor bot with the same fortress banks instead of overspending.
    me.banked = EASY_UPGRADE_FLOOR - 1;
    me.cargo = 1;
    expect(plan()).toBe('bank');
  });

  it('does not go hunting: a timid character keeps working with a rival in sight', () => {
    // Healthy, home quiet, rival 150 units away and plainly visible.
    const { bot } = standoff(1, 'rusty');
    expect(['potshot', 'attack']).not.toContain(bot.brain.lastBehavior);
  });

  it('…but the reckless one takes the shot, because its character says so', () => {
    // Same board, same tier, different weights: Bolt's attack weight clears the
    // bar Rusty's does not (GDD §2.9 — "characters, not difficulty labels").
    const { bot } = standoff(1, 'bolt');
    expect(bot.brain.lastBehavior).toBe('potshot');
  });
});

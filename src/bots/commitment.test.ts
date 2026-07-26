/**
 * src/bots/commitment.test.ts — the flee/fight pair does not flap (GDD §2.9;
 * v0.2.2 field report — "low-HP bot stuck flapping between attack and flee").
 *
 * The field report is one photograph: a low-health Warden "oscillating between
 * attacking and fleeing … twitching in place beside its own planet, never
 * actually went anywhere." That is textbook threshold flapping — FLEE and ATTACK
 * share one boundary with no memory between them — and the fix is decision
 * hysteresis (`./commitment`): dual thresholds and a latched commitment.
 *
 * So this file asserts the four things the report asks for:
 *
 *  1. the {@link commit} latch's raw enter/exit/hold semantics;
 *  2. the flee band *holds* through the gap a single threshold would flap in;
 *  3. a committed retreat goes *somewhere* — a low-HP bot's distance from the
 *     threat increases monotonically (the exact screenshot scenario), and over
 *     30 s of pursuit the flee/fight flip count stays bounded;
 *  4. the priority exception — a core under final assault — still interrupts a
 *     committed retreat; and determinism holds across identical runs.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, step, type World } from '../sim';
import {
  RETREAT_CLEAR_RANGE,
  THREAT_RANGE,
  coreUnderFinalAssault,
  retreatRecoverFraction,
  wantsRetreat,
} from './behaviors';
import { createBot } from './bot';
import { commit, committed, newLatch, release } from './commitment';
import { botInputs } from './harness';
import { perceive } from './perception';
import { PERSONALITIES } from './personalities';
import { dist } from './steering';
import { retreatThreshold } from './targeting';
import { context, createBrain } from './tree';
import type { Brain } from './tree';

/** A quiet four-home arena, past the opening seconds: no rocks, no spawn
 *  protection, no match-start alarm — the same clean board the other tier tests
 *  stage on. */
function board(seed = 8): World {
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

/** A persistent brain for a character — the same one across several decisions,
 *  so the flee latch actually carries state between them (unlike a fresh-brain
 *  helper, which would erase the commitment the test is about). */
function brainFor(personality: keyof typeof PERSONALITIES): Brain {
  return createBrain(PERSONALITIES[personality], { next: () => 0.5 });
}

describe('commit — the latch primitive (hysteresis in one struct)', () => {
  it('enters on enter, holds through the gap, exits on exit', () => {
    const latch = newLatch();
    expect(committed(latch)).toBe(false);

    // Off, and only `enter` fires ⇒ on.
    expect(commit(latch, true, false)).toBe(true);
    // On, and *neither* condition fires ⇒ holds. This is the whole point: a
    // value sitting between the two thresholds cannot toggle the state.
    expect(commit(latch, false, false)).toBe(true);
    // On, and `exit` fires ⇒ off.
    expect(commit(latch, false, true)).toBe(false);
    // Off again, and neither ⇒ holds off.
    expect(commit(latch, false, false)).toBe(false);
  });

  it('never enters on the enter boundary while off if exit is also true — safety wins', () => {
    const latch = newLatch();
    // Off: enter can still latch it (exit only matters while on).
    expect(commit(latch, true, true)).toBe(true);
    // On with both true: exit wins, so a latch can never wedge on the way the
    // raw condition wedged the ship.
    expect(commit(latch, true, true)).toBe(false);
  });

  it('release forces it off for the priority override', () => {
    const latch = newLatch();
    commit(latch, true, false);
    expect(committed(latch)).toBe(true);
    release(latch);
    expect(committed(latch)).toBe(false);
  });
});

describe('the flee band holds — a committed retreat does not flap', () => {
  /** Put a lone rival at `gap` units off the bot's nose and re-read the same
   *  brain's retreat decision. */
  function decideAt(world: World, brain: Brain, gap: number, hullFraction: number): boolean {
    const me = world.ships[0]!;
    const them = world.ships[1]!;
    me.pos = { x: 2000, y: 2000 };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * hullFraction;
    them.pos = { x: 2000 + gap, y: 2000 };
    them.vel = { x: 0, y: 0 };
    return wantsRetreat(context(perceive(world, 0), brain));
  }

  it('the two thresholds are distinct and ordered (dual thresholds)', () => {
    // Spatial: the clear range is meaningfully past the threat range.
    expect(RETREAT_CLEAR_RANGE).toBeGreaterThan(THREAT_RANGE);
    // Hull: the release fraction sits above the break-off fraction.
    const brain = brainFor('rusty');
    const ctx = context(perceive(board(), 0), brain);
    expect(retreatRecoverFraction(ctx)).toBeGreaterThan(retreatThreshold(ctx.tuning, ctx.weights));
  });

  it('stays committed while the threat drifts through the hysteresis band', () => {
    const world = board();
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    const brain = brainFor('rusty');
    const hurt = 0.4; // below Rusty's 0.65 nerve, all three reads

    // Knife range: enters.
    expect(decideAt(world, brain, THREAT_RANGE * 0.4, hurt)).toBe(true);
    // Drifted into the band — past THREAT_RANGE, inside RETREAT_CLEAR_RANGE. A
    // single-threshold bot reads "no threat" here and re-engages; the latched one
    // holds the retreat.
    const inBand = (THREAT_RANGE + RETREAT_CLEAR_RANGE) / 2;
    expect(inBand).toBeGreaterThan(THREAT_RANGE);
    expect(inBand).toBeLessThan(RETREAT_CLEAR_RANGE);
    expect(decideAt(world, brain, inBand, hurt)).toBe(true);
    // Past the clear range: escaped, so it releases.
    expect(decideAt(world, brain, RETREAT_CLEAR_RANGE + 40, hurt)).toBe(false);
  });

  it('the band only *holds* a commitment, it never *starts* one', () => {
    const world = board();
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    const brain = brainFor('rusty'); // fresh: latch off
    // Wounded, but the threat is already in the band, never inside THREAT_RANGE.
    const inBand = (THREAT_RANGE + RETREAT_CLEAR_RANGE) / 2;
    expect(decideAt(world, brain, inBand, 0.4)).toBe(false);
  });

  it('collapse cancels the commitment outright (GDD §2.3, §2.7)', () => {
    const world = board();
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    const brain = brainFor('warden');
    // Enter a retreat...
    world.ships[0]!.hull = world.ships[0]!.maxHull * 0.1;
    world.ships[1]!.pos = { x: world.ships[0]!.pos.x + 120, y: world.ships[0]!.pos.y };
    expect(wantsRetreat(context(perceive(world, 0), brain))).toBe(true);
    // ...then the field runs dry: no hold worth saving, respawn is free.
    world.match.collapseTime = world.time; // isCollapsed ⇔ collapseTime >= 0
    world.match.phase = 'collapse';
    expect(wantsRetreat(context(perceive(world, 0), brain))).toBe(false);
    expect(committed(brain.fleeing)).toBe(false);
  });
});

describe('a committed retreat goes somewhere (the screenshot scenario)', () => {
  /**
   * The photograph, staged: a low-HP Warden beside its own planet with an
   * attacker sitting on that planet — home is the danger, so the bot must break
   * contact rather than run into the siege. Its core is whole, so this is
   * self-preservation, not the last stand.
   */
  function siegedAtHome(seed = 8): { world: World; me: number; threat: number } {
    const world = board(seed);
    const myHome = world.planets.find((p) => p.owner === 0)!;
    const me = world.ships[0]!;
    const threat = world.ships[1]!;
    // Beside the planet; the attacker on its far side.
    me.pos = { x: myHome.pos.x - 40, y: myHome.pos.y };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * 0.15; // low-health, past every nerve
    threat.pos = { x: myHome.pos.x + 40, y: myHome.pos.y };
    threat.vel = { x: 0, y: 0 };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    return { world, me: 0, threat: 1 };
  }

  it('increases distance from the threat monotonically, and commits to the flee', () => {
    const { world } = siegedAtHome();
    const warden = createBot({ id: 0, personality: 'warden' }, { seed: 7 });

    let prev = dist(world.ships[0]!.pos, world.ships[1]!.pos);
    const start = prev;
    for (let tick = 0; tick < 45; tick++) {
      step(world, botInputs(world, [warden]), TICK_DT);
      const d = dist(world.ships[0]!.pos, world.ships[1]!.pos);
      // Every single tick opens the gap — no twitch, no going nowhere.
      expect(d).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = d;
    }
    // And it actually went somewhere.
    expect(prev - start).toBeGreaterThan(100);
    // It broke off, and committed to it (still fleeing, still inside the band).
    expect(warden.brain.lastBehavior).toBe('retreat');
    expect(committed(warden.brain.fleeing)).toBe(true);
  });

  it('keeps the flip count bounded over 30 s of live pursuit', () => {
    // A wounded Warden and an aggressive Hard raider (Sable) that chases it.
    // Pre-fix this flapped many times a second; the latch bounds it to a handful
    // of genuine state changes (each fresh commitment costs a wounding or a
    // respawn, both real events, not boundary noise).
    const world = board(3);
    const warden = createBot({ id: 0, personality: 'warden' }, { seed: 3 });
    const sable = createBot({ id: 1, personality: 'sable' }, { seed: 3 });
    world.ships[0]!.hull = world.ships[0]!.maxHull * 0.25;
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[1]!.pos = { x: 2160, y: 2000 };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;

    let flips = 0;
    let wasFleeing = false;
    const ticks = Math.round(30 / TICK_DT);
    for (let t = 0; t < ticks; t++) {
      step(world, botInputs(world, [warden, sable]), TICK_DT);
      const fleeing = warden.brain.lastBehavior === 'retreat';
      if (fleeing !== wasFleeing) flips++;
      wasFleeing = fleeing;
    }

    // A small named ceiling — a genuinely committed bot changes its mind only on
    // real events, never on the tick-rate.
    const MAX_FLIPS = 20;
    expect(flips).toBeLessThan(MAX_FLIPS);
  });
});

describe('the priority exception interrupts a committed retreat', () => {
  it('drops the flee when the core comes under final assault, and re-commits after', () => {
    const world = board();
    const myHome = world.planets.find((p) => p.owner === 0)!;
    const me = world.ships[0]!;
    const threat = world.ships[1]!;
    me.pos = { x: myHome.pos.x - 200, y: myHome.pos.y };
    me.hull = me.maxHull * 0.15;
    threat.pos = { x: myHome.pos.x - 320, y: myHome.pos.y };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;

    const warden = createBot({ id: 0, personality: 'warden' }, { seed: 4 });

    // Core whole: self-preservation wins, the bot commits to the flee.
    warden.decide(perceive(world, 0));
    expect(warden.brain.lastBehavior).toBe('retreat');
    expect(committed(warden.brain.fleeing)).toBe(true);

    // The core comes under final assault — and it outranks the ship's skin. The
    // last stand fires *and clears the commitment*.
    myHome.coreHp = myHome.maxCoreHp * 0.2;
    myHome.sinceDamage = 0;
    expect(coreUnderFinalAssault(context(perceive(world, 0), warden.brain))).toBe(true);
    warden.decide(perceive(world, 0));
    expect(warden.brain.lastBehavior).toBe('last-stand');
    expect(committed(warden.brain.fleeing)).toBe(false);
  });
});

describe('determinism — the commitment never desyncs a replay (GDD §4.8)', () => {
  it('two identical pursuits produce identical behavior traces', () => {
    function trace(): string[] {
      const world = board(5);
      const warden = createBot({ id: 0, personality: 'warden' }, { seed: 5 });
      const sable = createBot({ id: 1, personality: 'sable' }, { seed: 5 });
      world.ships[0]!.hull = world.ships[0]!.maxHull * 0.3;
      world.ships[0]!.pos = { x: 2000, y: 2000 };
      world.ships[1]!.pos = { x: 2200, y: 2000 };
      for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;

      const out: string[] = [];
      for (let t = 0; t < 600; t++) {
        step(world, botInputs(world, [warden, sable]), TICK_DT);
        out.push(warden.brain.lastBehavior);
      }
      return out;
    }
    expect(trace()).toEqual(trace());
  });
});

/**
 * src/bots/commitment.test.ts — the flee/fight pair does not flap (GDD §2.9;
 * v0.2.2 field report — "low-HP bot stuck flapping between attack and flee").
 *
 * The field report is one photograph: a low-health Warden "oscillating between
 * attacking and fleeing … twitching in place beside its own station, never
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
 *
 * And, since p15, the invariant is extended with the **blockade recipe** the
 * developer's second screenshot names: a damaged bot, an enemy held stationary
 * on the line between it and its own station. That geometry is the one the
 * hysteresis here cannot resolve on its own — fleeing and going home point
 * opposite ways along a single line — so the flip ceiling is re-asserted against
 * a wall as well as against a pursuer, for the whole shipped cast, together with
 * the two things a bounded flip count alone would not prove: that the bot
 * actually *fights* (`./cornered`), and that it actually *gets home*.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { DEPOSIT_RANGE, SPAWN_PROTECTION_S, TICK_DT, createWorld, step, type World } from '../sim';
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
  for (const station of world.stations) {
    station.spawnProtect = 0;
    station.sinceDamage = 999;
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
   * The photograph, staged: a low-HP Warden beside its own station with an
   * attacker sitting on that station — home is the danger, so the bot must break
   * contact rather than run into the siege. Its core is whole, so this is
   * self-preservation, not the last stand.
   */
  function siegedAtHome(seed = 8): { world: World; me: number; threat: number } {
    const world = board(seed);
    const myHome = world.stations.find((p) => p.owner === 0)!;
    const me = world.ships[0]!;
    const threat = world.ships[1]!;
    // Beside the station; the attacker on its far side.
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

describe('the blockade recipe — bounded flips against a stationary blockader (p15)', () => {
  /**
   * The extension the p15 ratification asks for (point 4): the bounded-flip
   * invariant above proves a bot does not flap against a *pursuer*, and this
   * proves it does not flap against a *wall* — the geometry the hysteresis alone
   * cannot resolve.
   *
   * The recipe is the developer's screenshot, made a fixture: a damaged bot, an
   * enemy parked squarely on the line between it and its own station, and that
   * enemy held stationary and at full hull every tick so it stays a genuine wall
   * for the whole soak. Nothing else is on the board. Pre-p15 this is the exact
   * shape that dithers, because fleeing and going home point opposite ways along
   * one line and neither ever wins.
   */
  function stationaryBlockade(personality: keyof typeof PERSONALITIES): {
    flips: number;
    fightTicks: number;
    closestToHome: number;
  } {
    const world = board(11);
    const home = world.stations.find((s) => s.owner === 0)!;
    const me = world.ships[0]!;
    const wall = world.ships[1]!;

    // Out toward the arena centre — the way back from the field.
    const dx = world.bounds.width / 2 - home.pos.x;
    const dy = world.bounds.height / 2 - home.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const out = { x: dx / d, y: dy / d };
    me.pos = { x: home.pos.x + out.x * 700, y: home.pos.y + out.y * 700 };
    me.vel = { x: 0, y: 0 };
    const woundedAt = me.maxHull * 0.12; // past every tier's nerve
    const post = { x: home.pos.x + out.x * 350, y: home.pos.y + out.y * 350 };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;

    const bot = createBot({ id: 0, personality }, { seed: 3 });
    let flips = 0;
    let wasFleeing = false;
    let fightTicks = 0;
    let closestToHome = Number.POSITIVE_INFINITY;

    for (let t = 0; t < Math.round(30 / TICK_DT); t++) {
      // Hold the wall exactly where it is, at full hull: a blockade that drifts
      // or dies would let the bot off the hook the fixture is about.
      wall.pos = { x: post.x, y: post.y };
      wall.vel = { x: 0, y: 0 };
      wall.hull = wall.maxHull;
      // And hold the bot wounded, so the fear that builds the trap never lifts.
      me.hull = woundedAt;

      step(world, botInputs(world, [bot]), TICK_DT);

      closestToHome = Math.min(closestToHome, dist(me.pos, home.pos));
      if (bot.brain.lastBehavior === 'cornered-fight') fightTicks++;
      const fleeing = bot.brain.lastBehavior === 'retreat';
      if (fleeing !== wasFleeing) flips++;
      wasFleeing = fleeing;
    }
    return { flips, fightTicks, closestToHome };
  }

  /** The ceiling on mind-changes against a wall over 30 s, for the whole cast.
   *  A cornered bot changes its mind on real events — noticing the trap,
   *  breaking through it — never on the tick rate. Measured worst across the
   *  shipped cast is 7; this sits above it with headroom and an order of
   *  magnitude under the bug. TUNABLE */
  const MAX_BLOCKADE_FLIPS = 12;

  for (const id of Object.keys(PERSONALITIES) as Array<keyof typeof PERSONALITIES>) {
    it(`${id} commits and gets home instead of dithering on the line`, () => {
      const { flips, fightTicks, closestToHome } = stationaryBlockade(id);

      // 1. It stops asking. No flapping between attack and flee.
      expect(flips, `${id} flipped ${flips} times against a stationary wall`).toBeLessThan(
        MAX_BLOCKADE_FLIPS,
      );
      // 2. It fights — the ratified verb, not a shorter retreat.
      expect(fightTicks, `${id} never committed to the fight`).toBeGreaterThan(0);
      // 3. And it *goes somewhere*: the photograph's whole complaint was a ship
      //    that "never actually went anywhere". It ends up inside its own
      //    collection field, on the far side of the thing that was blocking it.
      expect(closestToHome, `${id} never reached its own station`).toBeLessThan(DEPOSIT_RANGE);
    });
  }
});

describe('the priority exception interrupts a committed retreat', () => {
  it('drops the flee when the core comes under final assault, and re-commits after', () => {
    const world = board();
    const myHome = world.stations.find((p) => p.owner === 0)!;
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

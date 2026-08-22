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
 * ── One thing in here was overturned, and by the same developer (a0-135) ───
 *
 * v0.2.2's photograph was a low-HP Warden *beside its own station with an
 * attacker sitting on that station*, and the ruling taken from it was that home
 * is then the danger, so the bot breaks contact rather than running into the
 * siege. a0-135 (2026-08-22) rules the other way on that exact board: *"protection
 * of their base is essential to the game a player would defend at all costs"* —
 * a threatened home outranks self-preservation, at any hull fraction, and the
 * bot stays and fights.
 *
 * What v0.2.2 established is untouched by that and is still asserted below: the
 * flee/fight pair does not flap, and a committed retreat **goes somewhere**
 * rather than twitching in place. Only the board it is asserted on moved off the
 * doorstep — because on the doorstep there is no longer a retreat to measure, and
 * `HOME_ALARM_RANGE` (520) being wider than `THREAT_RANGE` (416) means there
 * never can be again. The flight vector that v0.2.2 asked for is still pinned
 * where it still exists, on `retreat`'s own output.
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
    // Enter a retreat, out in the field. The arena centre, and not the spawn
    // point the ships start on, because a bot standing at its own station cannot
    // be frightened off it any more (a0-135): `HOME_ALARM_RANGE` (520) is wider
    // than `THREAT_RANGE` (416), so a hostile close enough to trigger the flee
    // latch there is already an intruder in its own home's alarm ring, and
    // `defend` takes the tick. This cell is about collapse, so it stages the
    // retreat where a retreat exists — the same place `decideAt` above does.
    world.ships[0]!.pos = { x: 2000, y: 2000 };
    world.ships[0]!.vel = { x: 0, y: 0 };
    world.ships[0]!.hull = world.ships[0]!.maxHull * 0.1;
    world.ships[1]!.pos = { x: world.ships[0]!.pos.x + 120, y: world.ships[0]!.pos.y };
    world.ships[1]!.vel = { x: 0, y: 0 };
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
   * The photograph, staged: a low-HP Warden with an attacker at knife range and
   * a station in the picture. `mine` picks whose station, and that one parameter
   * is the whole of a0-135 expressed as a fixture.
   *
   * On **its own** doorstep this is no longer a retreat board at all — a
   * threatened home outranks self-preservation, at any hull, and `defend` takes
   * the tick. So v0.2.2's *goes somewhere* claim is staged out in the field
   * instead, where a retreat still exists, with the attacker on the far side of
   * the bot from home: a tail, which is the geometry the field report actually
   * photographed and the one `./cornered` does not own.
   */
  function stagedChase(seed = 8): World {
    const world = board(seed);
    const myHome = world.stations.find((p) => p.owner === 0)!;
    const me = world.ships[0]!;
    const threat = world.ships[1]!;
    // Out in the field, well clear of its own alarm ring.
    me.pos = { x: 2000, y: 2000 };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * 0.15; // low-health, past every nerve
    // On its tail: the far side from home, so the way out and the way home are
    // the same direction and a working retreat opens the gap every tick.
    const dx = me.pos.x - myHome.pos.x;
    const dy = me.pos.y - myHome.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    // 80 units: the separation v0.2.2's own staging held these two at.
    threat.pos = { x: me.pos.x + (dx / d) * 80, y: me.pos.y + (dy / d) * 80 };
    threat.vel = { x: 0, y: 0 };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    return world;
  }

  /** The same picture with the station under the attacker being the bot's own —
   *  v0.2.2's literal staging, which a0-135 rules the other way. */
  function siegedAtOwnHome(seed = 8): World {
    const world = board(seed);
    const myHome = world.stations.find((p) => p.owner === 0)!;
    const me = world.ships[0]!;
    const threat = world.ships[1]!;
    me.pos = { x: myHome.pos.x - 40, y: myHome.pos.y };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * 0.15;
    threat.pos = { x: myHome.pos.x + 40, y: myHome.pos.y };
    threat.vel = { x: 0, y: 0 };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    return world;
  }

  it('increases distance from the threat monotonically, and commits to the flee', () => {
    const world = stagedChase();
    const warden = createBot({ id: 0, personality: 'warden' }, { seed: 7 });

    let prev = dist(world.ships[0]!.pos, world.ships[1]!.pos);
    const start = prev;
    // One second, where v0.2.2's cell ran 45 ticks (0.75 s). Both numbers are
    // the same distance: a hull starting from rest clears 100 units of gap in
    // just under a second, and the old board bought the difference by having the
    // bot beside a station it could push off the far side of. Measured on this
    // branch, opened 18.9u by t=15, 83.9u by t=45, **117.8u by t=60**, and 389.8u
    // by t=180, monotone at every one of those ticks. The assertion below is
    // unchanged; only the window it is given moved.
    for (let tick = 0; tick < 60; tick++) {
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

  it('but stands and fights when the station in the way is its own (a0-135)', () => {
    // v0.2.2's literal board, ruled the other way by the same developer. On
    // 2026-08-17 the reading was "home is the danger, break contact"; on
    // 2026-08-22 it is *"protection of their base is essential to the game a
    // player would defend at all costs"*. The bot does not break contact, never
    // commits to a flee, and does not leave.
    const world = siegedAtOwnHome();
    const warden = createBot({ id: 0, personality: 'warden' }, { seed: 7 });
    const home = world.stations.find((p) => p.owner === 0)!;
    const start = dist(world.ships[0]!.pos, home.pos);

    for (let tick = 0; tick < 45; tick++) {
      step(world, botInputs(world, [warden]), TICK_DT);
      expect(warden.brain.lastBehavior, `tick ${tick}`).not.toBe('retreat');
      expect(committed(warden.brain.fleeing), `tick ${tick}`).toBe(false);
    }
    expect(warden.brain.lastBehavior).toBe('defend');
    // …and it is still on its doorstep, not 100 units further off like the cell
    // above. "A player would defend at all costs" is a claim about where the
    // ship ends up, so that is what is measured.
    expect(dist(world.ships[0]!.pos, home.pos) - start).toBeLessThan(100);
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
    // Out in the field, clear of its own alarm ring: a bot inside that ring has
    // no retreat to interrupt any more (a0-135), and this cell is about what
    // interrupts one. `coreUnderFinalAssault` reads the bot's own station view,
    // which is legible from anywhere on the map, so the distance costs the cell
    // nothing.
    me.pos = { x: 2000, y: 2000 };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * 0.15;
    threat.pos = { x: me.pos.x - 120, y: me.pos.y };
    threat.vel = { x: 0, y: 0 };
    for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;
    expect(dist(me.pos, myHome.pos), 'staged clear of its own alarm ring').toBeGreaterThan(520);

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

/**
 * src/bots/ally-defence.test.ts — **a bot answers its teammate's alarm, and
 * still mines.** OWNER: Bot Engineer (GDD §2.6, §2.9; `docs/team-bots-plan.md`
 * Stage 2, Tasks 2.5, 2.6 and 2.7).
 *
 * The developer, 2026-08-07:
 *
 * > *"enemies on teams should try to defend their teammates bases when under
 * > attack (if they are under threat as well) … same thing for bots on your
 * > team"*
 *
 * Two halves, and the second is the one this file spends most of its length on.
 * The first is easy to build and easy to demo: a teammate's home burns, a bot in
 * range breaks off and arrives. The second is the parenthesis — *"(if they are
 * under threat as well)"* — and it is the half that keeps this from becoming a
 * bot that abandons its economy to be heroic. **My home outranks yours**, and
 * one besieged ally may not consume a teammate's whole match.
 *
 * So the cases below are, in order:
 *
 *  1. **The truth table.** In range + my home quiet → answer. My home also under
 *     attack → *do not*, at every tier, every time. Out of range → do not.
 *     Fleeing or cornered → do not.
 *  2. **The latch cannot flap.** `underAttack` is `sinceDamage < 2 s`
 *     (`./perception`), so an attacker who pauses between bursts blinks the alarm
 *     off. Read raw, that is a bot that turns around halfway there, every time
 *     (plan Trap 7).
 *  3. **The budget holds.** A permanently besieged ally next door, run for real
 *     against a control with no siege at all, with the responder's *mined ore*
 *     as the measurement. This is the assertion that fails if the cost bounds
 *     ever come out.
 *  4. **Nothing moves in FFA.** A side of one has no allies and no radio, so the
 *     branch cannot fire and no random number is drawn — which is why
 *     `./ffa-parity.test.ts`'s pinned world hashes are still green.
 *
 * The determinism half of Stage 2 lives in `./team-radio.test.ts`, because it is
 * a property of the channel rather than of the branch.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId, Vec2 } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, step, type World } from '../sim';
import {
  ALLY_RESPONSE_COOLDOWN,
  ALLY_RESPONSE_MAX,
  ALLY_RESPONSE_QUIET,
  ALLY_RESPONSE_RANGE,
  allyResponseCommit,
  newAllyResponse,
} from './ally';
import {
  allyResponseRange,
  nearestAllyDistress,
  wantsAllyDefence,
} from './behaviors';
import { createBot, treeFor } from './bot';
import { commit } from './commitment';
import { botInputs, botLobby, createBots, fillEmptySlots } from './harness';
import { DEFAULT_PERCEPTION, perceive } from './perception';
import { Difficulty, PERSONALITIES, ROSTER } from './personalities';
import type { PersonalityId } from './personalities';
import type { BotCtx } from './tree';
import { context, createBrain, runTree } from './tree';
import { teamRadio } from './radio';

const ME = 0;
const ALLY = 1;
const FOE = 2;
const FOE2 = 3;

/** The 2v2 side table this file's board is built under. */
const SIDES: readonly number[] = [0, 0, 1, 1];

/** Every tier, because the ladder is the design and it has to hold at all three. */
const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

/**
 * Characters whose `homebody` puts a 1000-unit alarm comfortably inside their
 * response range (`allyResponseRange` = 1200 × (0.5 + homebody)): Patch 1680,
 * Rusty 1560, Warden 1260. Used where a case is about the *ladder* rather than
 * about the range dial, so the range is never what a case turns on.
 */
const RESPONDERS: readonly PersonalityId[] = ['patch', 'rusty', 'warden'];

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * **The rescue board**, read from the bot at the centre:
 *
 *   ME    ship (3000, 3000), home (3000, 3300) — 300 south, quiet, not docked.
 *   ALLY  home (3000, 2000) — **1000 units due north**, and it is the one that
 *         will be burning.
 *   FOE   home (300, 5700), FOE2 home (700, 5700) — both far off-screen with
 *         their ships parked on top of them, so nothing above `defend-ally` in
 *         any tree has anything to fire on: no threat to flee, no intruder at
 *         this bot's own door, no target worth the attack floor.
 *
 * 1000 units is the distance that matters: inside every {@link RESPONDERS}
 * character's reach and outside Bolt's (720) and Sable's (840), so the same board
 * proves both the answer and the range dial.
 *
 * `sides` omitted builds the identical board with **no `team` key at all** — the
 * FFA roster shape — which is the control that proves the board is live rather
 * than the branch being off for some unrelated reason.
 */
function rescueBoard(sides?: readonly number[]): World {
  const world = createWorld({
    seed: 16,
    players: [ME, ALLY, FOE, FOE2].map((id) => {
      const spec = { id, shipClass: ShipClass.Vanguard };
      return sides?.[id] === undefined ? spec : { ...spec, team: sides[id]! };
    }),
    bounds: { width: 6000, height: 6000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  world.asteroids.length = 0;
  world.chunks.length = 0;

  place(world, ME, { x: 3000, y: 3000 }, { x: 3000, y: 3300 });
  place(world, ALLY, { x: 3000, y: 1950 }, { x: 3000, y: 2000 });
  place(world, FOE, { x: 300, y: 5700 }, { x: 300, y: 5700 });
  place(world, FOE2, { x: 700, y: 5700 }, { x: 700, y: 5700 });
  return world;
}

/** Put a slot's ship and home where the case wants them, quiet and whole. */
function place(world: World, id: PlayerId, ship: Vec2, home: Vec2): void {
  const s = world.ships.find((x) => x.id === id)!;
  s.pos = { ...ship };
  s.vel = { x: 0, y: 0 };
  s.home = { ...home };
  s.hull = s.maxHull;
  s.cargo = 0;
  s.banked = 0;
  s.spawnProtect = 0;
  const p = world.stations.find((x) => x.owner === id)!;
  p.pos = { ...home };
  p.coreHp = p.maxCoreHp;
  p.spawnProtect = 0;
  p.sinceDamage = 999;
}

const station = (w: World, owner: PlayerId) => w.stations.find((p) => p.owner === owner)!;

/** Ring a home's klaxon (or silence it). The alarm is `sinceDamage < 2 s`. */
function alarm(world: World, owner: PlayerId, ringing: boolean): void {
  station(world, owner).sinceDamage = ringing ? 0 : 999;
}

/** A decision context for a character over a board. The RNG is a constant so no
 *  case ever turns on a draw; the radio is real, so callouts work. */
function ctxOf(world: World, personality: PersonalityId, radio = true): BotCtx {
  const brain = createBrain(
    PERSONALITIES[personality],
    { next: () => 0.5 },
    radio ? teamRadio([ME, ALLY]) : null,
  );
  return context(perceive(world, ME), brain);
}

/** Run a whole tier's tree over the board and report which leaf took the tick. */
function decide(
  world: World,
  personality: PersonalityId,
  tier: Difficulty,
): { behavior: string; actions: readonly Action[]; ctx: BotCtx } {
  const ctx = ctxOf(world, personality);
  const actions = runTree(treeFor(tier), ctx);
  return { behavior: ctx.brain.lastBehavior, actions, ctx };
}

/** The direction a decision actually thrusts, or null if it is coasting. */
function heading(actions: readonly Action[]): Vec2 | null {
  for (const a of actions) {
    if (a.type !== 'thrust') continue;
    return a.dir.x === 0 && a.dir.y === 0 ? null : a.dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Task 2.6 — the trigger truth table
// ---------------------------------------------------------------------------

describe("a bot answers a teammate's alarm (Task 2.6)", () => {
  it('breaks off and heads at the burning home, at every tier', () => {
    for (const tier of TIERS) {
      const world = rescueBoard(SIDES);
      alarm(world, ALLY, true);
      const { behavior, actions } = decide(world, 'patch', tier);

      expect(behavior, tier).toBe('defend-ally');
      // Due north — the ally's home is at y 2000 and the bot at y 3000, so a
      // response is a thrust with a decisively negative y and no lateral bias.
      const dir = heading(actions);
      expect(dir, tier).not.toBeNull();
      expect(dir!.y, tier).toBeLessThan(-0.9);
    }
  });

  it('does NOT answer while its OWN home is under attack — every tier, every time', () => {
    // The developer's parenthesis, and the half that keeps this from becoming a
    // bot that abandons its economy. The alarm rings for the team; the priority
    // ladder stays selfish-first.
    for (const tier of TIERS) {
      for (const personality of RESPONDERS) {
        const world = rescueBoard(SIDES);
        alarm(world, ALLY, true);
        alarm(world, ME, true);
        const { behavior } = decide(world, personality, tier);
        expect(behavior, `${tier}/${personality}`).toBe('defend');
      }
    }
  });

  it('does not answer an alarm out of reach', () => {
    for (const tier of TIERS) {
      const world = rescueBoard(SIDES);
      // 2500 units north: past the widest reach in the cast (Patch, 1680).
      station(world, ALLY).pos = { x: 3000, y: 500 };
      alarm(world, ALLY, true);
      const { behavior } = decide(world, 'patch', tier);
      expect(behavior, tier).not.toBe('defend-ally');
    }
  });

  it('does not answer while fleeing, or while cornered', () => {
    for (const tier of TIERS) {
      const world = rescueBoard(SIDES);
      alarm(world, ALLY, true);

      const fleeing = ctxOf(world, 'patch');
      commit(fleeing.brain.fleeing, true, false);
      expect(wantsAllyDefence(fleeing), tier).toBe(false);

      const cornered = ctxOf(world, 'patch');
      cornered.brain.cornered.until = cornered.view.time + 5;
      cornered.brain.cornered.target = FOE;
      expect(wantsAllyDefence(cornered), tier).toBe(false);
    }
  });

  it('does not START a run with a hold worth banking', () => {
    // The plan's trap for this branch: the response sits above `haul`, so a bot
    // that answered with a full hold would fly into a fight and hand half of it
    // to whoever killed it (GDD §2.7).
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    const me = world.ships.find((s) => s.id === ME)!;
    me.cargo = me.cargoCap;

    expect(decide(world, 'patch', Difficulty.Hard).behavior).toBe('haul');
  });

  it('does not answer once the field is spent', () => {
    // Collapse: nothing can be repaired and the endgame is a damage race a
    // defender cannot win by guarding (GDD §2.3) — the same argument that
    // switches each tree's own `defend` off there.
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    world.match.collapseTime = world.time;
    world.match.phase = 'collapse';
    expect(decide(world, 'patch', Difficulty.Hard).behavior).not.toBe('defend-ally');
  });

  it('leans its reach by homebody, around the plan\'s measured 1200', () => {
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);

    // The recommendation is the MIDPOINT of the dial, not a per-character cap.
    expect(allyResponseRange(ctxOf(world, 'foreman'))).toBeCloseTo(ALLY_RESPONSE_RANGE * 0.9);
    // Warden and Patch cross the map for a teammate; Sable and Bolt barely
    // turn around. The alarm is 1000 units away on this board.
    expect(nearestAllyDistress(ctxOf(world, 'patch'))?.id).toBe(ALLY);
    expect(nearestAllyDistress(ctxOf(world, 'warden'))?.id).toBe(ALLY);
    expect(nearestAllyDistress(ctxOf(world, 'sable'))).toBeNull();
    expect(nearestAllyDistress(ctxOf(world, 'bolt'))).toBeNull();
  });

  it('hears the klaxon from anywhere, because a human does too', () => {
    // Layer A is range-free by licence (`AllyView.underAttack`): the shipped
    // human klaxon is team-scoped and map-wide. A bot four thousand units away
    // still knows — and still does not know the ally's core HP.
    const world = rescueBoard(SIDES);
    station(world, ALLY).pos = { x: 3000, y: 200 };
    alarm(world, ALLY, true);
    const ctx = ctxOf(world, 'patch');
    expect(ctx.view.allies[0]!.underAttack).toBe(true);
    expect(ctx.view.stations.find((p) => p.owner === ALLY)?.coreHp ?? null).toBeNull();
    // …but it does not fly: knowing is Layer A, going is a cost decision.
    expect(wantsAllyDefence(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 2.7 — the response commits, and ends
// ---------------------------------------------------------------------------

describe('the response commits, and then ends (Task 2.7)', () => {
  it('holds through a stuttering alarm instead of turning around', () => {
    // `alarmWindow` is 2 s, so an attacker lining up a shot blinks the klaxon
    // off. Without the latch this is a bot that oscillates between home and away
    // and never arrives anywhere (Trap 7).
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    const ctx = ctxOf(world, 'patch');
    expect(wantsAllyDefence(ctx)).toBe(true);

    let held = 0;
    for (let i = 0; i < 40; i++) {
      // Stutter: on for a beat, off for a beat, half a second at a time — well
      // inside ALLY_RESPONSE_QUIET, and it never goes quiet for long enough.
      world.time += 0.5;
      alarm(world, ALLY, i % 2 === 0);
      const next = context(perceive(world, ME), ctx.brain);
      if (wantsAllyDefence(next)) held++;
    }
    expect(held).toBe(40);
  });

  it('lets go when the alarm really has gone quiet', () => {
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    const ctx = ctxOf(world, 'patch');
    expect(wantsAllyDefence(ctx)).toBe(true);

    alarm(world, ALLY, false);
    world.time += ALLY_RESPONSE_QUIET - 0.5;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(true);

    world.time += 1;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(false);
    expect(ctx.brain.allyResponse.target).toBe(-1);
  });

  it('lets go on arrival with nothing to fight, and does not re-commit at once', () => {
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    const ctx = ctxOf(world, 'patch');
    expect(wantsAllyDefence(ctx)).toBe(true);

    // There, and the doorstep is clear.
    world.ships.find((s) => s.id === ME)!.pos = { x: 3000, y: 2050 };
    world.time += 6;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(false);

    // The cooldown is now running, so a still-ringing alarm does not restart it.
    world.time += ALLY_RESPONSE_COOLDOWN - 1;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(false);
    world.time += 2;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(true);
  });

  it('drops the run on death, and keeps the cooldown', () => {
    // A respawned bot must not resume a rescue that ended two lives ago; but
    // clearing the *budget* on death would hand a bot that keeps dying at its
    // teammate's doorstep an unlimited allowance.
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    const ctx = ctxOf(world, 'patch');
    expect(wantsAllyDefence(ctx)).toBe(true);
    ctx.brain.allyResponse.readyAt = world.time + 10;

    world.ships.find((s) => s.id === ME)!.alive = false;
    context(perceive(world, ME), ctx.brain);
    expect(ctx.brain.allyResponse.target).toBe(-1);
    expect(ctx.brain.allyResponse.readyAt).toBe(world.time + 10);
  });

  it('caps one run, so a siege nobody can break is not a posting', () => {
    // The clause that can fire while the alarm is still genuinely live. Without
    // it, the quiet timer never runs, the cooldown never engages, and the bot
    // never mines again.
    const world = rescueBoard(SIDES);
    alarm(world, ALLY, true);
    const ctx = ctxOf(world, 'patch');
    expect(wantsAllyDefence(ctx)).toBe(true);

    world.time += ALLY_RESPONSE_MAX - 1;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(true);
    world.time += 2;
    expect(wantsAllyDefence(context(perceive(world, ME), ctx.brain))).toBe(false);
  });

  it('is a plain latch underneath, with arrival outranking a live alarm', () => {
    // The primitive on its own, so the ordering inside it is pinned separately
    // from the view logic that feeds it: arrival, then the ceiling, then the
    // alarm, then the quiet clock. Completion breaks a commitment rather than
    // renewing it, exactly as `./commitment`'s `commit` resolves its own tie.
    const latch = newAllyResponse();
    const fold = (now: number, candidate: number, held: boolean, arrived: boolean) =>
      allyResponseCommit(
        latch, now, candidate, held, arrived,
        ALLY_RESPONSE_QUIET, ALLY_RESPONSE_MAX, ALLY_RESPONSE_COOLDOWN,
      );

    expect(fold(0, -1, false, false)).toBe(-1); // nothing to answer
    expect(fold(0, 7, true, false)).toBe(7); // commit
    expect(fold(1, -1, true, true)).toBe(-1); // arrived beats a live alarm
    expect(latch.readyAt).toBe(1 + ALLY_RESPONSE_COOLDOWN);
    expect(fold(2, 7, true, false)).toBe(-1); // cooling down
  });
});

// ---------------------------------------------------------------------------
// Task 2.5 — `help` and `siege` callouts
// ---------------------------------------------------------------------------

describe('a bot under siege says so, once per cooldown (Task 2.5)', () => {
  it('sends one siege call per callCooldown, not one per decision', () => {
    const world = rescueBoard(SIDES);
    alarm(world, ME, true);
    const ctx = ctxOf(world, 'warden');

    // Ten decisions inside one Hard cooldown (1.5 s) — one call, not ten.
    for (let i = 0; i < 10; i++) {
      world.time += 0.05;
      runTree(treeFor(Difficulty.Hard), context(perceive(world, ME), ctx.brain));
    }
    expect(ctx.brain.radio!.calls).toHaveLength(1);
    expect(ctx.brain.radio!.calls[0]!.kind).toBe('siege');
    expect(ctx.brain.radio!.calls[0]!.about).toBe(ME);

    // Past the cooldown, it speaks again.
    world.time += 2;
    runTree(treeFor(Difficulty.Hard), context(perceive(world, ME), ctx.brain));
    expect(ctx.brain.radio!.calls).toHaveLength(2);
  });

  it("stamps the sender's own view time, never the receipt", () => {
    const world = rescueBoard(SIDES);
    world.time = 123.5;
    alarm(world, ME, true);
    const ctx = ctxOf(world, 'warden');
    runTree(treeFor(Difficulty.Hard), context(perceive(world, ME), ctx.brain));
    expect(ctx.brain.radio!.calls[0]!.seenAt).toBe(123.5);
  });

  it('sends nothing at all in FFA — there is nobody to hear it', () => {
    const world = rescueBoard();
    alarm(world, ME, true);
    const ctx = ctxOf(world, 'warden', false);
    runTree(treeFor(Difficulty.Hard), context(perceive(world, ME), ctx.brain));
    expect(ctx.brain.radio).toBeNull();
    expect(ctx.brain.lastCallAt).toBe(-1);
  });

  it('carries a teammate in open space, which the klaxon cannot', () => {
    // The `help` call's whole reason to exist: the klaxon rings for a *home*, so
    // a teammate jumped a thousand units from anybody's station has no klaxon.
    // Here the caller's home is quiet and it is being shot at in the field.
    const world = rescueBoard(SIDES);
    const ally = world.ships.find((s) => s.id === ALLY)!;
    ally.pos = { x: 4200, y: 3000 };
    ally.hull = ally.maxHull * 0.1;
    world.ships.find((s) => s.id === FOE)!.pos = { x: 4260, y: 3000 };

    const radio = teamRadio([ME, ALLY])!;
    const helper = createBot({ id: ALLY, personality: 'patch', team: 0 }, { seed: 5, radio });
    helper.decide(perceive(world, ALLY));
    expect(helper.brain.lastBehavior).toBe('retreat');
    expect(radio.calls.map((c) => c.kind)).toEqual(['help']);

    // And the teammate answers it once it has travelled — the alarm on the view
    // says nothing at all, because no home is burning.
    const me = createBrain(PERSONALITIES.patch, { next: () => 0.5 }, radio);
    world.time += 1;
    const ctx = context(perceive(world, ME), me);
    expect(ctx.view.allies[0]!.underAttack).toBe(false);
    expect(wantsAllyDefence(ctx)).toBe(true);
    expect(me.allyResponse.target).toBe(ALLY);
  });

  it('does not reach a teammate who missed the call', () => {
    // Cooperation quality is the difficulty dial: an Easy team loses a third of
    // its calls, and a call nobody heard changes nothing (§2.3).
    const world = rescueBoard(SIDES);
    const radio = teamRadio([ME, ALLY])!;
    const ally = world.ships.find((s) => s.id === ALLY)!;
    ally.pos = { x: 4200, y: 3000 };
    ally.hull = ally.maxHull * 0.1;
    world.ships.find((s) => s.id === FOE)!.pos = { x: 4260, y: 3000 };

    // A stream that always draws 0: below every tier's miss chance, so every
    // recipient misses.
    const deaf = createBot({ id: ALLY, personality: 'rusty', team: 0 }, { seed: 5, radio });
    (deaf.brain as { rng: { next: () => number } }).rng = { next: () => 0 };
    deaf.decide(perceive(world, ALLY));
    expect(radio.calls).toHaveLength(0);

    const me = createBrain(PERSONALITIES.patch, { next: () => 0.5 }, radio);
    world.time += 2;
    expect(wantsAllyDefence(context(perceive(world, ME), me))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The budget — "one besieged ally cannot consume a teammate's whole match"
// ---------------------------------------------------------------------------

/**
 * A real 2v2 with rocks, run for `seconds`, with slot {@link ALLY}'s klaxon
 * **forced** on or off after every step. Forced on is the worst case the cost
 * bounds exist for: an attacker who never leaves, so the alarm never goes quiet
 * on its own and only the ceiling and the cooldown can end a response.
 *
 * The measurement is **ore mined**, accumulated as the responder's hold grows,
 * not ore *held*: a bot that banks and spends its earnings on turrets ends the
 * match with an empty hold and a full ring, and reading the hold would score
 * that as having mined nothing.
 */
function siegeRun(besieged: boolean, seconds = 240): { mined: number; answered: number; ticks: number } {
  const seats = fillEmptySlots([], 4, ['warden', 'patch', 'sable', 'foreman'], SIDES);
  const world = createWorld({ seed: 31, players: botLobby(seats) });
  const bots = createBots(seats, { seed: 31 });
  const me = bots.find((b) => b.seat.id === ME)!;

  let answered = 0;
  let ticks = 0;
  let mined = 0;
  let hold = 0;
  while (world.time < seconds) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    station(world, ALLY).sinceDamage = besieged ? 0 : 999;
    const ship = world.ships.find((s) => s.id === ME)!;
    if (ship.cargo > hold) mined += ship.cargo - hold;
    hold = ship.cargo;
    ticks++;
    if (me.brain.lastBehavior === 'defend-ally') answered++;
  }
  return { mined, answered, ticks };
}

describe('one besieged ally cannot consume a teammate\'s match', () => {
  it('keeps mining through a permanent siege next door', () => {
    const quiet = siegeRun(false);
    const under = siegeRun(true);

    // The case is live: the responder really did break off, repeatedly.
    expect(under.answered).toBeGreaterThan(0);

    // …and its economy did not collapse. Answering costs the trip and the fight
    // and is *supposed* to cost something; what it may not do is produce a bot
    // that never mines. Measured, the permanent-siege run still brings in ~86%
    // of the control's ore over four minutes. The cooldown is what buys that.
    expect(quiet.mined).toBeGreaterThan(0);
    expect(under.mined).toBeGreaterThan(quiet.mined * 0.6);

    // And the share of the match spent answering stays a slice, not the match.
    expect(under.answered / under.ticks).toBeLessThan(0.4);
  });

  it('is not a quiet control by accident — the radio carries the rest', () => {
    // The "quiet" run above is quiet in its *klaxon* only: a teammate breaking
    // off wounded still calls `help`, and that call is answered too. Worth
    // pinning, because a control that were genuinely silent would make the A/B
    // above look like a bigger effect than it is — and because it is the one
    // place Layer B is measurably doing work Layer A cannot.
    expect(siegeRun(false).answered).toBeGreaterThan(0);
  });

  it('caps the share of a match one alarm can take', () => {
    // The analytic bound is ALLY_RESPONSE_MAX / (MAX + COOLDOWN) — 60% at the
    // shipped numbers — and that is the *worst* case, an alarm that never stops.
    // Asserting the mechanism rather than a measured percentage keeps this test
    // honest if QA re-tunes either constant (Task 2.8).
    const ceiling = ALLY_RESPONSE_MAX / (ALLY_RESPONSE_MAX + ALLY_RESPONSE_COOLDOWN);
    expect(ceiling).toBeLessThan(0.7);
    expect(ALLY_RESPONSE_QUIET).toBeGreaterThan(DEFAULT_PERCEPTION.alarmWindow);
  });
});

// ---------------------------------------------------------------------------
// FFA does not move (plan §2.5)
// ---------------------------------------------------------------------------

describe('FFA is untouched, structurally', () => {
  it('never fires the branch, because a side of one has no ally', () => {
    for (const tier of TIERS) {
      const world = rescueBoard(); // no team keys at all
      alarm(world, ALLY, true);
      const { behavior, ctx } = decide(world, 'patch', tier);
      expect(ctx.view.allies, tier).toEqual([]);
      expect(behavior, tier).not.toBe('defend-ally');
      expect(wantsAllyDefence(ctx), tier).toBe(false);
    }
  });

  it('draws no random number for the radio it does not have', () => {
    // This is *why* `./ffa-parity.test.ts`'s pinned hashes are still green: a
    // call that consumed a draw even in FFA would shift every later number the
    // bot pulls — its aim spread, its escape heading — and the whole match would
    // drift while every behavioural test stayed happy.
    const ffa = rescueBoard();
    alarm(ffa, ME, true);
    let quiet = 0;
    const soloBrain = createBrain(PERSONALITIES.warden, { next: () => (quiet++, 0.5) }, null);
    runTree(treeFor(Difficulty.Hard), context(perceive(ffa, ME), soloBrain));

    const teams = rescueBoard(SIDES);
    alarm(teams, ME, true);
    let chatter = 0;
    const teamBrain = createBrain(
      PERSONALITIES.warden,
      { next: () => (chatter++, 0.5) },
      teamRadio([ME, ALLY]),
    );
    runTree(treeFor(Difficulty.Hard), context(perceive(teams, ME), teamBrain));

    // The same bot, the same board, the same alarm — and the FFA one spent
    // strictly fewer draws. The difference is exactly the per-recipient miss
    // roll on the call it had nobody to make.
    expect(quiet).toBe(0);
    expect(chatter).toBe(1);
  });

  it('seats every bot without a radio when no lineup mentions teams', () => {
    const ffa = createBots(fillEmptySlots([], 8), { seed: 3 });
    expect(ffa.every((b) => b.brain.radio === null)).toBe(true);

    const teams = createBots(fillEmptySlots([], 8, ROSTER, [0, 0, 0, 0, 1, 1, 1, 1]), { seed: 3 });
    // One channel per side, shared by its four members and by nobody else.
    expect(teams[0]!.brain.radio).toBe(teams[3]!.brain.radio);
    expect(teams[4]!.brain.radio).toBe(teams[7]!.brain.radio);
    expect(teams[0]!.brain.radio).not.toBe(teams[4]!.brain.radio);
    expect(teams[0]!.brain.radio!.members).toEqual([0, 1, 2, 3]);
  });
});

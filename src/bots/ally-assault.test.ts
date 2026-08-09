/**
 * src/bots/ally-assault.test.ts — **a bot joins the attack its teammate opened,
 * and still goes home when its own house is burning.** OWNER: Bot Engineer
 * (GDD §2.6, §2.9; `docs/team-bots-plan.md` Stage 4).
 *
 * The developer, 2026-08-07:
 *
 * > *"…and equally should try to attack when team mates go on offensive."*
 *
 * `./ally-defence.test.ts` is the defensive half of the same sentence, and this
 * file is deliberately its mirror — same board shape, same tier loop, same
 * argument about the ladder — so that the two can be read side by side and the
 * places they *differ* are visible rather than buried. Those places are the
 * point of the brief, and they are:
 *
 *  1. **The termination condition does not transfer.** `defend-ally` ends on
 *     "arrived, and there is nothing to fight". A raid that arrives to plenty to
 *     fight has *succeeded*. So the cases below never assert an arrival ending;
 *     they assert that a bot standing in the fire it flew to is **still
 *     committed**, and that the one thing which ends it is the objective dying.
 *  2. **The numbers do not transfer.** 45/30 came from a siege that never stops;
 *     a raid is a short event (`evidence/b2-03-assault-window.ts`: p90 7.7 s,
 *     longest ever observed 25.8 s), so the shipped ceiling and cooldown are
 *     measured against a different distribution — and so is the reach, which the
 *     end-to-end economy A/B pulled below the defensive one. The cases here guard the *mechanism* and the
 *     relationships between the constants rather than the literals, so a QA
 *     re-tune moves numbers without turning this file red for the wrong reason.
 *  3. **Collapse does not switch it off**, where it does switch `defend-ally`
 *     off. Guarding a core that cannot be repaired cannot win a damage race;
 *     hitting a rival's core is the only thing that still scores (GDD §2.3).
 *
 * What is asserted identically, because it must never move: fog honesty (the
 * only signal is a call the bot actually heard — there is no klaxon for a
 * teammate's raid), determinism, FFA, and the selfish-first ladder — **my home
 * outranks yours, and my home outranks your raid.**
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId, Vec2 } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, step, type World } from '../sim';
import {
  ALLY_RESPONSE_COOLDOWN,
  ALLY_RESPONSE_MAX,
  ALLY_RESPONSE_RANGE,
  ASSAULT_JOIN_COOLDOWN,
  ASSAULT_JOIN_MAX,
  ASSAULT_JOIN_QUIET,
  ASSAULT_JOIN_RANGE,
  ASSAULT_JOIN_RANGE_WIDE,
  allyResponseCommit,
  newAllyResponse,
} from './ally';
import {
  allyAssaultOn,
  assaultJoinRange,
  nearestAllyAssault,
  wantsJoinAssault,
} from './behaviors';
import { treeFor } from './bot';
import { commit } from './commitment';
import { botInputs, botLobby, createBots, fillEmptySlots } from './harness';
import { perceive } from './perception';
import { DIFFICULTY_TUNING, Difficulty, PERSONALITIES } from './personalities';
import type { PersonalityId } from './personalities';
import type { BotCtx } from './tree';
import { context, createBrain, runTree } from './tree';
import { teamRadio, send } from './radio';
import type { TeamRadio } from './radio';

const ME = 0;
const ALLY = 1;
const FOE = 2;
const FOE2 = 3;

/** The 2v2 side table this file's board is built under. */
const SIDES: readonly number[] = [0, 0, 1, 1];

/** Every tier, because the ladder is the design and it has to hold at all three. */
const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

/**
 * Characters whose `opportunism` puts a 900-unit raid comfortably inside their
 * join range (`assaultJoinRange` = 1000 × (0.55 + opportunism)): Sable 1450,
 * Vulture 1350, Warden 1050. Used where a case is about the *ladder* rather than
 * about the range dial, so no case turns on the reach by accident.
 *
 * Note this is a different shortlist from `./ally-defence.test.ts`'s RESPONDERS
 * (Patch, Rusty, Warden), and deliberately so: the two ranges lean on different
 * dials because they answer different questions. Warden is in both, which is the
 * character that both answers alarms and honours calls.
 */
const JOINERS: readonly PersonalityId[] = ['sable', 'vulture', 'warden'];

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * **The raid board**, read from the bot at the centre:
 *
 *   ME    ship (3000, 3000), home (3000, 3300) — 300 south, quiet, not docked.
 *   FOE   home (3000, 2100) — **900 units due north**, and it is the one the
 *         team is going in on.
 *   ALLY  ship parked on FOE's doorstep — the teammate prosecuting the raid.
 *   FOE2  home (300, 5700) with its ship on top of it, far off-screen, so
 *         nothing above `join-assault` in any tree has anything to fire on.
 *
 * 900 units is the distance that matters: inside every {@link JOINERS}
 * character's reach and outside Rusty's (650) and Patch's (750), so the same
 * board proves both the join and the range dial.
 *
 * `sides` omitted builds the identical board with **no `team` key at all** — the
 * FFA roster shape — which is the control that proves the board is live rather
 * than the branch being off for some unrelated reason.
 */
function raidBoard(sides?: readonly number[]): World {
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
  // The teammate is AT the objective, which is what makes this a raid in
  // progress rather than a rumour.
  place(world, ALLY, { x: 3060, y: 2100 }, { x: 3000, y: 3600 });
  place(world, FOE, { x: 300, y: 5700 }, { x: 3000, y: 2100 });
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

/**
 * Put a `push` call about {@link FOE}'s home on the channel, as the teammate
 * would have. Sent with zero latency and zero miss so a case about the *branch*
 * never turns on the channel's dice — `./team-radio.test.ts` owns the channel.
 */
function pushCall(world: World, radio: TeamRadio, from: PlayerId = ALLY, about: PlayerId = FOE): void {
  send(
    radio,
    { kind: 'push', from, about, pos: { ...station(world, about).pos }, seenAt: world.time },
    0,
    0,
    { next: () => 0.5 },
  );
}

/** A decision context for a character over a board, with a live channel and a
 *  `push` already on it. The RNG is a constant so no case turns on a draw. */
function ctxOf(world: World, personality: PersonalityId, radio = true): BotCtx {
  const channel = radio ? teamRadio([ME, ALLY]) : null;
  if (channel) pushCall(world, channel);
  const brain = createBrain(PERSONALITIES[personality], { next: () => 0.5 }, channel);
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
// The trigger truth table
// ---------------------------------------------------------------------------

describe("a bot joins its teammate's attack", () => {
  it('breaks off and heads at the raided home, at every tier', () => {
    for (const tier of TIERS) {
      const world = raidBoard(SIDES);
      const { behavior, actions } = decide(world, 'sable', tier);

      expect(behavior, tier).toBe('join-assault');
      // Due north — the objective is at y 2100 and the bot at y 3000, so joining
      // is a thrust with a decisively negative y and no lateral bias.
      const dir = heading(actions);
      expect(dir, tier).not.toBeNull();
      expect(dir!.y, tier).toBeLessThan(-0.9);
    }
  });

  it('does NOT join while its OWN home is under attack — every tier, every time', () => {
    // **My home outranks your raid.** The control frame the brief asks for, and
    // the half that keeps this from becoming a bot that abandons its economy to
    // be useful somewhere else.
    for (const tier of TIERS) {
      for (const personality of JOINERS) {
        const world = raidBoard(SIDES);
        alarm(world, ME, true);
        const { behavior } = decide(world, personality, tier);
        expect(behavior, `${tier}/${personality}`).toBe('defend');
      }
    }
  });

  it('does NOT join while a teammate is being besieged — defence outranks offence', () => {
    // The other half of the ladder, and the one that is new here: a0-10's
    // `defend-ally` sits ABOVE this branch, so a side with one home burning and
    // one raid running sends its spare bot to the burning home. Warden is in
    // both shortlists, so the same character genuinely had both options.
    for (const tier of TIERS) {
      const world = raidBoard(SIDES);
      // The ally's home, 300 south of the bot, is the one on fire.
      station(world, ALLY).pos = { x: 3000, y: 3600 };
      alarm(world, ALLY, true);
      const { behavior } = decide(world, 'warden', tier);
      expect(behavior, tier).toBe('defend-ally');
    }
  });

  it('does not join a raid out of reach', () => {
    for (const tier of TIERS) {
      const world = raidBoard(SIDES);
      // 2500 units north: past the widest reach in the cast (Sable, 1450).
      station(world, FOE).pos = { x: 3000, y: 500 };
      const { behavior } = decide(world, 'sable', tier);
      expect(behavior, tier).not.toBe('join-assault');
    }
  });

  it('does not join while fleeing, or while cornered', () => {
    for (const tier of TIERS) {
      const world = raidBoard(SIDES);

      const fleeing = ctxOf(world, 'sable');
      commit(fleeing.brain.fleeing, true, false);
      expect(wantsJoinAssault(fleeing), tier).toBe(false);

      const cornered = ctxOf(world, 'sable');
      cornered.brain.cornered.until = cornered.view.time + 5;
      cornered.brain.cornered.target = FOE;
      expect(wantsJoinAssault(cornered), tier).toBe(false);
    }
  });

  it('banks a full hold before it goes raiding — the tree order, not a gate', () => {
    // `wantsJoinAssault` carries no cargo condition on purpose: the branch sits
    // BELOW `haul` in all three trees, so a bot with a hold worth banking never
    // reaches the test. Flying into a siege with a full hold hands half of it to
    // whoever kills you (GDD §2.7). This asserts the ladder does the job.
    const world = raidBoard(SIDES);
    const me = world.ships.find((s) => s.id === ME)!;
    me.cargo = me.cargoCap;
    expect(decide(world, 'sable', Difficulty.Hard).behavior).toBe('haul');
  });

  it('KEEPS joining once the field is spent, where a rescue would stop', () => {
    // The asymmetry with `defend-ally`, and it is one argument rather than two:
    // in collapse nothing can be repaired and the endgame is a damage race
    // (GDD §2.3), so guarding cannot win it — but a rival's core is the only
    // thing that still scores. Defence stops mattering; offence starts mattering
    // more. `./ally-defence.test.ts` asserts the other side of this.
    const world = raidBoard(SIDES);
    world.match.collapseTime = world.time;
    world.match.phase = 'collapse';
    const ctx = ctxOf(world, 'sable');
    expect(ctx.view.collapsed).toBe(true);
    expect(wantsJoinAssault(ctx)).toBe(true);
  });

  it("leans its reach by opportunism, around the measured 1200", () => {
    const world = raidBoard(SIDES);

    // The plan's own dial for this job (§4.5): "Sable (0.9) and Vulture (0.8)
    // honour focus-fire calls; Rusty (0.1) does not." NOT `homebody`, which is
    // the defensive range multiplier — a territorial character answers an alarm
    // from further and flies out for a raid from nearer, and sharing one dial
    // between them would make those the same sentence.
    expect(assaultJoinRange(ctxOf(world, 'sable'))).toBeCloseTo(ASSAULT_JOIN_RANGE * 1.45);
    expect(assaultJoinRange(ctxOf(world, 'rusty'))).toBeCloseTo(ASSAULT_JOIN_RANGE * 0.65);
    // …and the offensive reach is strictly tighter than the defensive one, which
    // is the ladder written as a number: someone else's core is worth less of my
    // match than my own side's is (`./ally`).
    expect(ASSAULT_JOIN_RANGE).toBeLessThan(ALLY_RESPONSE_RANGE);

    // The raid is 900 units away on this board.
    expect(nearestAllyAssault(ctxOf(world, 'sable'))?.on).toBe(FOE);
    expect(nearestAllyAssault(ctxOf(world, 'vulture'))?.on).toBe(FOE);
    expect(nearestAllyAssault(ctxOf(world, 'rusty'))).toBeNull();
    expect(nearestAllyAssault(ctxOf(world, 'patch'))).toBeNull();
  });

  it('costs the cast nothing on average — the lean is centred on the measurement', () => {
    const world = raidBoard(SIDES);
    const cast: readonly PersonalityId[] = ['rusty', 'bolt', 'foreman', 'patch', 'sable', 'vulture', 'warden'];
    const mean =
      cast.reduce((sum, id) => sum + assaultJoinRange(ctxOf(world, id)), 0) / cast.length;
    expect(mean / ASSAULT_JOIN_RANGE).toBeGreaterThan(0.98);
    expect(mean / ASSAULT_JOIN_RANGE).toBeLessThan(1.02);
    // The wide reach is on the shelf for a re-tune, not in shipped behaviour.
    expect(ASSAULT_JOIN_RANGE_WIDE).toBeGreaterThan(ASSAULT_JOIN_RANGE);
  });
});

// ---------------------------------------------------------------------------
// Fog honesty — there is no Layer A for a raid
// ---------------------------------------------------------------------------

describe('a bot may act on a callout, never on what it could not perceive', () => {
  it('does not join a raid nobody told it about', () => {
    // The whole difference from the defensive branch. `AllyView.underAttack` is
    // a map-wide klaxon a human already hears, so `defend-ally` has a signal with
    // no call behind it. **Nothing on anyone's HUD announces that a teammate has
    // opened a raid**, so with no `push` on the channel there is nothing to act
    // on — even with the teammate's ship parked on the objective in plain view.
    const world = raidBoard(SIDES);
    const brain = createBrain(PERSONALITIES.sable, { next: () => 0.5 }, teamRadio([ME, ALLY]));
    const ctx = context(perceive(world, ME), brain);

    expect(ctx.brain.radio!.calls).toHaveLength(0);
    expect(nearestAllyAssault(ctx)).toBeNull();
    expect(wantsJoinAssault(ctx)).toBe(false);
  });

  it('does not reach a teammate who missed the call', () => {
    // Cooperation quality is the difficulty dial: an Easy team loses a third of
    // its calls, and a call nobody heard changes nothing (plan §2.3).
    const world = raidBoard(SIDES);
    const radio = teamRadio([ME, ALLY])!;
    // A stream that always draws 0 is below every tier's miss chance, so every
    // recipient misses and the call is never filed at all.
    send(
      radio,
      { kind: 'push', from: ALLY, about: FOE, pos: { ...station(world, FOE).pos }, seenAt: world.time },
      0,
      1,
      { next: () => 0 },
    );
    expect(radio.calls).toHaveLength(0);

    const brain = createBrain(PERSONALITIES.sable, { next: () => 0.5 }, radio);
    expect(wantsJoinAssault(context(perceive(world, ME), brain))).toBe(false);
  });

  it('reads no core HP off the objective it is flying at', () => {
    // The one thing about an enemy core a bot may read without scouting is that
    // it is *alive* — a wreck is visible from further than its numbers are
    // (GDD §2.2). Its HP stays behind the scouting gate, and `join-assault` flies
    // 1000 units at a home whose HP it does not know.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    const objective = ctx.view.stations.find((s) => s.owner === FOE)!;
    expect(objective.alive).toBe(true);
    expect(objective.coreHp).toBeNull();
    expect(wantsJoinAssault(ctx)).toBe(true);
  });

  it('ignores a call about a slot on its own side', () => {
    // Stage 4 never sends one, but a branch that would fly at a *teammate's*
    // home on the strength of a malformed record is not a branch worth shipping.
    const world = raidBoard(SIDES);
    const radio = teamRadio([ME, ALLY])!;
    pushCall(world, radio, ALLY, ALLY);
    const brain = createBrain(PERSONALITIES.sable, { next: () => 0.5 }, radio);
    const ctx = context(perceive(world, ME), brain);

    expect(allyAssaultOn(ctx, ALLY)).toBeNull();
    expect(wantsJoinAssault(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The commitment — and the two things about it that do NOT transfer
// ---------------------------------------------------------------------------

describe('the join commits, and ends for a different reason than a rescue does', () => {
  it('does NOT end on arrival — a raid that found a fight has succeeded', () => {
    // The headline difference from `defend-ally`, which completes on "arrived,
    // and there is nothing to fight". Here the bot is standing on the objective
    // with an enemy on it, and that is the *success* case, so the commitment has
    // to survive it. This is the assertion that fails if somebody "helpfully"
    // copies the arrival clause across.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    expect(wantsJoinAssault(ctx)).toBe(true);

    // There, and the doorstep is anything but clear: the objective's owner is
    // sitting on it.
    world.ships.find((s) => s.id === ME)!.pos = { x: 3000, y: 2150 };
    world.ships.find((s) => s.id === FOE)!.pos = { x: 3000, y: 2050 };
    world.time += 2;
    pushCall(world, ctx.brain.radio!);
    expect(wantsJoinAssault(context(perceive(world, ME), ctx.brain))).toBe(true);
    expect(ctx.brain.allyAssault.target).toBe(FOE);
  });

  it('ends when the objective dies, and does not re-commit at once', () => {
    // The one completion this latch has.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    expect(wantsJoinAssault(ctx)).toBe(true);

    station(world, FOE).alive = false;
    world.time += 1;
    expect(wantsJoinAssault(context(perceive(world, ME), ctx.brain))).toBe(false);
    expect(ctx.brain.allyAssault.target).toBe(-1);
    // The cooldown is now running, so another raid does not restart it at once.
    station(world, FOE).alive = true;
    world.time += ASSAULT_JOIN_COOLDOWN - 2;
    pushCall(world, ctx.brain.radio!);
    expect(wantsJoinAssault(context(perceive(world, ME), ctx.brain))).toBe(false);
    world.time += 3;
    pushCall(world, ctx.brain.radio!);
    expect(wantsJoinAssault(context(perceive(world, ME), ctx.brain))).toBe(true);
  });

  it('holds through the silence between a teammate\'s calls', () => {
    // The anti-flap property, and the reason the quiet window is derived from
    // the CHANNEL rather than from the klaxon. A teammate prosecuting a siege
    // re-sends every `callCooldown`, and each call stays readable for
    // `memorySeconds / HEARSAY_STALENESS`, so the silence inside a *continuous*
    // raid is the difference between the two. Easy is the only tier where that
    // is positive — 6 s between calls against a 3 s readable life — and read raw
    // it is a joiner that turns around mid-flight on a raid that never stopped.
    const silentFor = (tier: Difficulty): number => {
      const t = DIFFICULTY_TUNING[tier];
      return t.callCooldown - t.memorySeconds / 2; // HEARSAY_STALENESS
    };
    expect(silentFor(Difficulty.Medium)).toBeLessThanOrEqual(0);
    expect(silentFor(Difficulty.Hard)).toBeLessThanOrEqual(0);
    expect(silentFor(Difficulty.Easy)).toBeGreaterThan(0);
    // The window has to clear the only tier that ever goes quiet, with room for
    // a raider whose next slot goes on `help` instead of `push`.
    expect(ASSAULT_JOIN_QUIET).toBeGreaterThan(2 * silentFor(Difficulty.Easy));

    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    expect(wantsJoinAssault(ctx)).toBe(true);

    // Six seconds of dead air — a whole Easy call cooldown — then the teammate
    // speaks again. The commitment must survive the gap.
    let held = 0;
    for (let i = 0; i < 12; i++) {
      world.time += 0.5;
      if (wantsJoinAssault(context(perceive(world, ME), ctx.brain))) held++;
    }
    expect(held).toBe(12);
    expect(ctx.brain.allyAssault.target).toBe(FOE);
  });

  it('lets go when the raid really has gone quiet', () => {
    // "Quiet" is a property of the CHANNEL, so the release is `readable life +
    // ASSAULT_JOIN_QUIET`, not the quiet window alone: the last call a teammate
    // spoke keeps `held` true until it ages off the receiver's hearsay-discounted
    // clock, and only then does the quiet clock start. Derived from the tuning
    // rather than hardcoded, so a memory or staleness re-tune moves it here too.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    expect(wantsJoinAssault(ctx)).toBe(true);

    const readableLife = ctx.brain.tuning.memorySeconds / 2; // HEARSAY_STALENESS
    const startedAt = world.time;

    // Folded every step, as a real bot does — the quiet clock is `now -
    // lastLive` and `lastLive` only advances on a decision, so a test that
    // jumped the clock would be measuring from the wrong instant.
    let releasedAt = -1;
    for (let i = 0; i < 80 && releasedAt < 0; i++) {
      world.time += 0.5;
      if (!wantsJoinAssault(context(perceive(world, ME), ctx.brain))) releasedAt = world.time - startedAt;
    }

    expect(releasedAt).toBeGreaterThan(0);
    expect(ctx.brain.allyAssault.target).toBe(-1);
    // It held for the whole life of the last thing said, and then for the quiet
    // window on top — and it let go on the quiet clock, not on the ceiling.
    expect(releasedAt).toBeGreaterThan(readableLife);
    expect(releasedAt).toBeLessThanOrEqual(readableLife + ASSAULT_JOIN_QUIET + 0.5);
    expect(releasedAt).toBeLessThan(ASSAULT_JOIN_MAX);
  });

  it('caps one join, so a siege the side cannot break is not a posting', () => {
    // The only clause that can fire while the raid is still genuinely live —
    // and the one the measurement moved. A 45 s ceiling would never have fired
    // at all: the longest raid observed across 610 of them was 25.8 s.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    expect(wantsJoinAssault(ctx)).toBe(true);

    // Keep the raid loudly alive right through the ceiling.
    for (let t = 0; t < ASSAULT_JOIN_MAX - 1; t++) {
      world.time += 1;
      pushCall(world, ctx.brain.radio!);
      expect(wantsJoinAssault(context(perceive(world, ME), ctx.brain)), `t=${t}`).toBe(true);
    }
    world.time += 2;
    pushCall(world, ctx.brain.radio!);
    expect(wantsJoinAssault(context(perceive(world, ME), ctx.brain))).toBe(false);
  });

  it('drops the run on death, and keeps the cooldown', () => {
    // A bot that died at an enemy's doorstep is exactly the bot most likely to
    // still be committed to it; resuming after a respawn at the far end of the
    // map is how a "join" becomes a lone suicide run. The *budget* survives —
    // dying on a raid does not earn a free second one.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    expect(wantsJoinAssault(ctx)).toBe(true);
    ctx.brain.allyAssault.readyAt = world.time + 10;

    world.ships.find((s) => s.id === ME)!.alive = false;
    context(perceive(world, ME), ctx.brain);
    expect(ctx.brain.allyAssault.target).toBe(-1);
    expect(ctx.brain.allyAssault.readyAt).toBe(world.time + 10);
  });

  it('is the SAME latch as the rescue, folded with a different question', () => {
    // `./ally` carries no domain knowledge, which is what lets the offensive
    // branch be a second instance rather than a second mechanism. Pinned here on
    // the primitive alone, with the assault's durations, so the ordering inside
    // it is guarded separately from the view logic that feeds it.
    const latch = newAllyResponse();
    const fold = (now: number, candidate: number, held: boolean, gone: boolean) =>
      allyResponseCommit(
        latch, now, candidate, held, gone,
        ASSAULT_JOIN_QUIET, ASSAULT_JOIN_MAX, ASSAULT_JOIN_COOLDOWN,
      );

    expect(fold(0, -1, false, false)).toBe(-1); // no raid to join
    expect(fold(0, 7, true, false)).toBe(7); // commit
    expect(fold(1, -1, true, true)).toBe(-1); // the objective died — completion
    expect(latch.readyAt).toBe(1 + ASSAULT_JOIN_COOLDOWN);
    expect(fold(2, 7, true, false)).toBe(-1); // cooling down
  });

  it('holds the two commitments apart', () => {
    // One `Brain`, two latches. A bot between rescues must not be barred from
    // joining a raid by the rescue cooldown, and vice versa — folding them into
    // one budget is the quiet way to make a bot that does neither.
    const world = raidBoard(SIDES);
    const ctx = ctxOf(world, 'sable');
    ctx.brain.allyResponse.readyAt = world.time + 60;
    expect(wantsJoinAssault(ctx)).toBe(true);
    expect(ctx.brain.allyResponse.target).toBe(-1);
    expect(ctx.brain.allyAssault.target).toBe(FOE);
  });
});

// ---------------------------------------------------------------------------
// The budget — measured against a raid, not against a siege
// ---------------------------------------------------------------------------

describe('the numbers are the raid\'s numbers, not the rescue\'s', () => {
  it('caps the share of a match one raid can take, tighter than a rescue does', () => {
    // The analytic bound is MAX / (MAX + COOLDOWN). Asserting the mechanism and
    // the RELATIONSHIP rather than the literals keeps this honest through a QA
    // re-tune of either constant — while still pinning the one thing that is a
    // design decision: your side's core is the win condition and someone else's
    // is not, so the offensive budget must not be looser than the defensive one.
    const offence = ASSAULT_JOIN_MAX / (ASSAULT_JOIN_MAX + ASSAULT_JOIN_COOLDOWN);
    const defence = ALLY_RESPONSE_MAX / (ALLY_RESPONSE_MAX + ALLY_RESPONSE_COOLDOWN);
    expect(offence).toBeLessThanOrEqual(defence);
    expect(offence).toBeLessThan(0.7);
  });

  it('sizes the ceiling against a raid that actually happens', () => {
    // `evidence/b2-03-assault-window.ts`, 610 raids over 12 seeds × {2v2, 4v4}
    // at the shipped `scarce` abundance: p90 7.7 s, and the longest raid ever
    // observed was 25.8 s. A ceiling at a0-10's 45 would never once have bound,
    // which is not a ceiling. This is the guard on that reasoning: if a re-tune
    // pushes the ceiling past the longest raid the game produces, the mechanism
    // has quietly been switched off and somebody should have to say so.
    expect(ASSAULT_JOIN_MAX).toBeLessThan(ALLY_RESPONSE_MAX);
    expect(ASSAULT_JOIN_MAX).toBeLessThanOrEqual(26);
    // …and long enough to buy the trip: ~8.4 s of flight at the shipped reach
    // before a shot is fired, so a ceiling under it never lets a joiner arrive.
    expect(ASSAULT_JOIN_MAX).toBeGreaterThan(2 * (ASSAULT_JOIN_RANGE / 119));
  });

  it('keeps mining through a raid running next door', () => {
    // The end-to-end guard, and the reason the shipped numbers cannot drift: a
    // real 2v2 with rocks, with a `push` forced onto the channel every second —
    // the worst case the cost bounds exist for, a teammate who never stops
    // raiding — against the same match unforced, measured in the joiner's ore.
    const unforced = raidRun(false);
    const forced = raidRun(true);

    // **The control is not a silent control, and that is the finding.** No call
    // is injected into it at all, yet the bot still joins: the cast opens its own
    // raids and announces them through `attack`, and a teammate in range comes.
    // The feature works with nothing scripted, which is worth pinning separately
    // from the forced case — and it means the A/B below understates the effect
    // rather than flattering it. (`./ally-defence.test.ts` makes the same point
    // about its own quiet control.)
    expect(unforced.joined).toBeGreaterThan(0);
    expect(forced.joined).toBeGreaterThan(0);

    // …and the economy did not collapse. Joining costs the trip and the fight
    // and is *supposed* to cost something; what it may not do is produce a bot
    // that never mines. Swept over 8 seeds × 3 casts against the same matches
    // with the branch absent, the shipped reach keeps 82–92% of the control's
    // ore; at 1200 it kept 66–88% and this is the assertion that said so, which
    // is why the reach is 1000 (`./ally` `ASSAULT_JOIN_RANGE`).
    expect(unforced.mined).toBeGreaterThan(0);
    expect(forced.mined).toBeGreaterThan(0);

    // **The duty-cycle bound is NOT a bound, and this assertion used to claim it
    // was.** `MAX / (MAX + COOLDOWN)` — 36% at the shipped numbers — assumes a
    // committed join always ends by *completing*, which is what starts the
    // cooldown (`./ally` `complete`). A join that ends because the bot **died**
    // does not: `context()` calls `releaseAllyResponse`, which deliberately
    // drops the target while keeping whatever `readyAt` was already set, and a
    // `readyAt` from a completion two minutes ago is long expired. So a bot that
    // keeps dying at an enemy's doorstep re-commits immediately, every time, and
    // the duty cycle has no ceiling at all.
    //
    // Measured at `origin/main` — b3-01 changes nothing here, and that is the
    // point of quoting the number from the *other* build — over eight seeds of
    // this same fixture, the forced join share is **mean 0.42, max 0.59**, i.e.
    // above the "bound" on six of the eight. Seed 31 reads 0.19 and is the only
    // reason this line was ever green. The latch-committed share (read straight
    // off `Brain.allyAssault.target` rather than off `lastBehavior`) is worse
    // still: mean 0.49, max 0.69.
    //
    // **This is a real defect in b2-03's join latch, not in Stage 3**, and it is
    // deliberately not fixed here: this brief is mining-site selection, and the
    // fix — charging a cooldown on a death that interrupts a commitment — is a
    // change to the offensive latch's budget that wants its own measurement.
    // Recorded in the b3-01 PR and working note.
    //
    // What is asserted instead is what is actually true and still worth
    // guarding: **joining is a slice of a match, not a match**, and the forced
    // case is strictly keener than real play.
    const dutyCycle = ASSAULT_JOIN_MAX / (ASSAULT_JOIN_MAX + ASSAULT_JOIN_COOLDOWN);
    expect(dutyCycle).toBeLessThan(0.4);
    expect(forced.joined / forced.ticks).toBeLessThan(0.7);
    expect(unforced.joined / unforced.ticks).toBeLessThan(forced.joined / forced.ticks);
  });
});

/**
 * A real 2v2 with rocks, run for `seconds`, with a `push` about slot
 * {@link FOE}'s home forced onto slot 0's channel at Hard's `callCooldown` when
 * `raiding` — the fastest cadence any voice on the channel can actually manage.
 *
 * Forced is the worst case: a teammate who never stops calling, so the quiet
 * clock never runs on its own and only the ceiling and the cooldown can end a
 * join. The measurement is **ore mined**, accumulated as the hold grows rather
 * than read off the hold at the end — a bot that banks and spends its earnings
 * on turrets finishes with an empty hold and a full ring, and reading the hold
 * would score that as having mined nothing.
 */
function raidRun(raiding: boolean, seconds = 240): { mined: number; joined: number; ticks: number } {
  const seats = fillEmptySlots([], 4, ['sable', 'vulture', 'warden', 'foreman'], SIDES);
  const world = createWorld({ seed: 31, players: botLobby(seats) });
  const bots = createBots(seats, { seed: 31 });
  const me = bots.find((b) => b.seat.id === ME)!;

  let joined = 0;
  let ticks = 0;
  let mined = 0;
  let hold = 0;
  let nextCall = 0;
  while (world.time < seconds) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    if (raiding && world.time >= nextCall) {
      nextCall = world.time + DIFFICULTY_TUNING[Difficulty.Hard].callCooldown;
      const foe = station(world, FOE);
      if (foe.alive) {
        send(
          me.brain.radio!,
          { kind: 'push', from: ALLY, about: FOE, pos: { ...foe.pos }, seenAt: world.time },
          0,
          0,
          { next: () => 0.5 },
        );
      }
    }
    const ship = world.ships.find((s) => s.id === ME)!;
    if (ship.cargo > hold) mined += ship.cargo - hold;
    hold = ship.cargo;
    ticks++;
    if (me.brain.lastBehavior === 'join-assault') joined++;
  }
  return { mined, joined, ticks };
}

// ---------------------------------------------------------------------------
// FFA does not move (plan §2.5)
// ---------------------------------------------------------------------------

describe('FFA is untouched, structurally', () => {
  it('never fires the branch, because a side of one has no ally', () => {
    for (const tier of TIERS) {
      const world = raidBoard(); // no team keys at all
      const { behavior, ctx } = decide(world, 'sable', tier);
      expect(ctx.view.allies, tier).toEqual([]);
      expect(behavior, tier).not.toBe('join-assault');
      expect(wantsJoinAssault(ctx), tier).toBe(false);
    }
  });

  it('draws no random number for the push it has nobody to make', () => {
    // This is *why* `./ffa-parity.test.ts`'s pinned hashes are still green: a
    // call that consumed a draw even in FFA would shift every later number the
    // bot pulls — its aim spread, its escape heading — and the whole match would
    // drift while every behavioural test stayed happy. `callOut` returns before
    // the roll when the radio is null, so an FFA raid costs exactly nothing.
    const world = raidBoard();
    // Put the bot on top of an enemy home, so its tree really does open a siege.
    world.ships.find((s) => s.id === ME)!.pos = { x: 3000, y: 2300 };

    let draws = 0;
    const solo = createBrain(PERSONALITIES.sable, { next: () => (draws++, 0.5) }, null);
    runTree(treeFor(Difficulty.Hard), context(perceive(world, ME), solo));
    const soloDraws = draws;

    const teamed = raidBoard(SIDES);
    teamed.ships.find((s) => s.id === ME)!.pos = { x: 3000, y: 2300 };
    let chatter = 0;
    const team = createBrain(
      PERSONALITIES.sable,
      { next: () => (chatter++, 0.5) },
      teamRadio([ME, ALLY]),
    );
    runTree(treeFor(Difficulty.Hard), context(perceive(teamed, ME), team));

    // The same bot, the same board, the same siege — and the FFA one spent
    // strictly fewer draws. The difference is exactly the per-recipient miss
    // roll on the `push` it had nobody to make.
    expect(team.lastBehavior).toBe('attack');
    expect(solo.lastBehavior).toBe('attack');
    expect(chatter).toBe(soloDraws + 1);
  });
});

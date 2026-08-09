/**
 * src/bots/defender-role.test.ts — **exactly one teammate breaks off.** OWNER:
 * Bot Engineer (GDD §2.9, §4.8; `docs/team-bots-plan.md` Stage 4, the role
 * split).
 *
 * `a0-10` shipped `defend-ally` and `b2-03` shipped `join-assault`, both as
 * independent per-bot decisions, and the klaxon that triggers the first is
 * **range-free**: every teammate on the side hears it, simultaneously and
 * identically. So nothing in either stage stops all of them answering at once —
 * the plan's own Stage 2 risk, *"two bots abandoning two economies to answer one
 * alarm"*. The latch and its cooldown bound how long that lasts; they do not stop
 * it happening. `./roles` is the fix, and this file is the assertion that it
 * works.
 *
 * The cases, in the order the argument runs:
 *
 *  1. **The assignment.** Who is eligible, who is excluded, and how it ranks —
 *     all of it over facts that are public at any range, because that is the only
 *     way two bots can agree without talking.
 *  2. **Agreement, which is the load-bearing property.** Every member of a side
 *     computes the same defender for the same alarm. Including the case that
 *     would silently break it: an exact dead heat, where keying `tiebreakKey` by
 *     `self.id` — the ratified helper's normal usage — makes two teammates
 *     disagree. That negative control is in here as an assertion, not a comment,
 *     because it is the one line of `./roles` a future reader is most likely to
 *     "simplify".
 *  3. **The count, in a 4v4** — the brief's actual ask, asserted rather than
 *     eyeballed, with the pre-Stage-4 condition asserted alongside it so the
 *     board is proven to be one where all three *would* have gone.
 *  4. **What must not change**: FFA, 2v2, an open-space `help`, a run already in
 *     flight, and the selfish-first ladder.
 *
 * The match-scale economic number the plan predicts — a side's mining output no
 * longer collapsing when one home is attacked — is `evidence/b4-01-defender-role.ts`
 * and its JSON, because it is an A/B over whole matches rather than a fixture.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId, Vec2 } from '@shared/types';
import { SPAWN_PROTECTION_S, createWorld, type World } from '../sim';
import {
  allyDistress,
  allyResponseRange,
  assignedToAnswer,
  nearestAllyDistress,
  wantsAllyDefence,
} from './behaviors';
import { treeFor } from './bot';
import { DEFAULT_PERCEPTION, perceive } from './perception';
import { Difficulty, PERSONALITIES } from './personalities';
import type { PersonalityId } from './personalities';
import { teamRadio } from './radio';
import { NO_DEFENDER, defenderFor, holdsDefenderRole } from './roles';
import { tiebreakKey } from './targeting';
import type { BotCtx } from './tree';
import { context, createBrain, runTree } from './tree';

/** Side A: the besieged home and its three teammates. Side B: the enemy. */
const VICTIM: PlayerId = 0;
const NEAR: PlayerId = 1;
const MID: PlayerId = 2;
const FAR: PlayerId = 3;
const SIDE_A: readonly PlayerId[] = [VICTIM, NEAR, MID, FAR];
const SIDE_B: readonly PlayerId[] = [4, 5, 6, 7];
const SIDES: readonly number[] = [0, 0, 0, 0, 1, 1, 1, 1];

const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

/**
 * Characters whose `homebody` puts an 800-unit alarm comfortably inside their
 * reach (`allyResponseRange` = 1200 × (0.5 + homebody)): Patch 1680, Rusty 1560,
 * Warden 1260. Used everywhere a case is about the *role* rather than the range
 * dial, so no case can pass because a bot was simply too far away.
 */
const RESPONDERS: readonly PersonalityId[] = ['patch', 'rusty', 'warden'];

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * **The 4v4 rescue board.** Side A's four homes lie on a line and a cross out
 * from the besieged one, at deliberately distinct distances:
 *
 *   VICTIM home (4000, 4000) — the one that burns.
 *   NEAR   home (4000, 3400) —  600 away. The designated defender.
 *   MID    home (4900, 4000) —  900 away.
 *   FAR    home (4000, 5200) — 1200 away.
 *
 * and all three teammates' **ships** sit ~800 units from the burning home, in
 * three different directions. That is the whole point of the geometry: by *ship*
 * distance — the quantity the pre-Stage-4 branch gated on — the three are
 * interchangeable and all three are in reach, so the only thing that can separate
 * them is the derived role. It also keeps them outside `GUARD_RADIUS * 1.5`, so
 * nobody counts as having already arrived.
 *
 * Side B is parked in a far corner with its ships on its homes, so nothing above
 * `defend-ally` in any tree has anything to fire on or flee from.
 *
 * `sides` omitted builds the identical board with **no `team` key at all** — the
 * FFA roster shape — which is the control that proves a case turns on the role
 * rather than on the board being dead.
 */
function rescueBoard(sides?: readonly number[]): World {
  const world = createWorld({
    seed: 4401,
    players: [...SIDE_A, ...SIDE_B].map((id) => {
      const spec = { id, shipClass: ShipClass.Vanguard };
      return sides?.[id] === undefined ? spec : { ...spec, team: sides[id]! };
    }),
    bounds: { width: 8000, height: 8000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  world.asteroids.length = 0;
  world.chunks.length = 0;

  place(world, VICTIM, { x: 4000, y: 4000 }, { x: 4000, y: 4000 });
  place(world, NEAR, { x: 3300, y: 4400 }, { x: 4000, y: 3400 });
  place(world, MID, { x: 4700, y: 4400 }, { x: 4900, y: 4000 });
  place(world, FAR, { x: 4000, y: 4800 }, { x: 4000, y: 5200 });
  SIDE_B.forEach((id, i) => {
    const at: Vec2 = { x: 400 + i * 300, y: 7600 };
    place(world, id, at, at);
  });
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

/** Kill a home's core — the slot's owner is out (GDD §2.7). */
function razeHome(world: World, owner: PlayerId): void {
  const p = station(world, owner);
  p.alive = false;
  p.coreHp = 0;
}

/** A decision context for one slot. The RNG is a constant so no case ever turns
 *  on a draw; the radio is the real one for side A. */
function ctxOf(world: World, id: PlayerId, personality: PersonalityId): BotCtx {
  const brain = createBrain(PERSONALITIES[personality], { next: () => 0.5 }, teamRadio([...SIDE_A]));
  return context(perceive(world, id, DEFAULT_PERCEPTION), brain);
}

/** Run a whole tier's tree for one slot and report which leaf took the tick. */
function decide(world: World, id: PlayerId, personality: PersonalityId, tier: Difficulty): string {
  const ctx = ctxOf(world, id, personality);
  runTree(treeFor(tier), ctx);
  return ctx.brain.lastBehavior;
}

// ---------------------------------------------------------------------------
// 1 — the assignment
// ---------------------------------------------------------------------------

describe('the defender role is a derived assignment over the public roster', () => {
  it('picks the teammate whose own home is nearest the burning one', () => {
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    // 600 / 900 / 1200 from the victim's home. Ship distances are ~800 for all
    // three, so this cannot be reading ship positions — which it must not,
    // because they are not public.
    expect(defenderFor(perceive(world, NEAR), VICTIM)).toBe(NEAR);
  });

  it('never designates the besieged slot itself', () => {
    // It is already going: its own `defend` outranks every ally branch in all
    // three trees. Designating it would spend the role on a bot that needed no
    // designating and leave ZERO teammates breaking off.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    for (const member of SIDE_A) {
      expect(defenderFor(perceive(world, member), VICTIM), `seen by ${member}`).not.toBe(VICTIM);
    }
  });

  it('skips a teammate whose OWN door is burning, and passes the role on', () => {
    // Public, through the same klaxon, and it mirrors the selfish-first ladder:
    // `ownHomeThreatened` would block that bot anyway, so designating it would
    // mean the role is held by someone who structurally cannot go.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    alarm(world, NEAR, true);
    expect(defenderFor(perceive(world, MID), VICTIM)).toBe(MID);

    alarm(world, MID, true);
    expect(defenderFor(perceive(world, FAR), VICTIM)).toBe(FAR);
  });

  it('skips a teammate whose home is already a wreck', () => {
    // A dead core eliminates its owner (GDD §2.7, plan Question 1 answer (a)),
    // so that slot is not in the match to send.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    razeHome(world, NEAR);
    expect(defenderFor(perceive(world, MID), VICTIM)).toBe(MID);
  });

  it('designates nobody when the whole side is answering its own door', () => {
    const world = rescueBoard(SIDES);
    for (const member of SIDE_A) alarm(world, member, true);
    expect(defenderFor(perceive(world, NEAR), VICTIM)).toBe(NO_DEFENDER);
  });

  it('designates nobody for a home that does not exist or is not on my side', () => {
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    // An enemy's home is not this side's alarm to divide.
    expect(defenderFor(perceive(world, NEAR), SIDE_B[0]!)).toBe(NO_DEFENDER);
    razeHome(world, VICTIM);
    expect(defenderFor(perceive(world, NEAR), VICTIM)).toBe(NO_DEFENDER);
  });
});

// ---------------------------------------------------------------------------
// 2 — agreement, which is the whole feature
// ---------------------------------------------------------------------------

describe('every bot on the side computes the same answer, without a word', () => {
  it('agrees across all four members, for every alarm on the side', () => {
    // Same roster, same tick, same answer — the load-bearing property. This is
    // the one feature where a disagreement between two bots is a *correctness*
    // bug rather than a texture difference (GDD §4.8).
    for (const owner of SIDE_A) {
      const world = rescueBoard(SIDES);
      alarm(world, owner, true);
      const answers = SIDE_A.map((member) => defenderFor(perceive(world, member), owner));
      expect(new Set(answers).size, `alarm on ${owner}: ${answers.join(',')}`).toBe(1);
      // And it is a real designation, not a unanimous shrug.
      expect(answers[0], `alarm on ${owner}`).not.toBe(NO_DEFENDER);
      // Exactly one member believes it is the one — and nobody believes it of a
      // slot that does not believe it of itself.
      const holders = SIDE_A.filter((m) => holdsDefenderRole(perceive(world, m), owner));
      expect(holders, `alarm on ${owner}`).toEqual([answers[0]]);
    }
  });

  it('agrees on an exact dead heat — where keying the tie by `self` would NOT', () => {
    // The negative control, and the reason `./roles` passes `owner` to
    // `breaksTie` rather than `self.id`. `tiebreakKey` is observer-keyed on
    // purpose (p8's fix for the aggression bias), so its ordinary usage is
    // exactly wrong here.
    const world = rescueBoard(SIDES);
    // MID and FAR equidistant from the burning home; NEAR moved out of the
    // running so the heat is between two.
    station(world, MID).pos = { x: 5000, y: 4000 };
    station(world, FAR).pos = { x: 3000, y: 4000 };
    alarm(world, VICTIM, true);
    alarm(world, NEAR, true);

    const answers = SIDE_A.map((member) => defenderFor(perceive(world, member), VICTIM));
    expect(new Set(answers).size, answers.join(',')).toBe(1);
    expect(answers[0] === MID || answers[0] === FAR).toBe(true);

    // Now the same dead heat resolved the way the helper is normally used —
    // keyed by the observer. It splits the side, which is the bug.
    const selfKeyed = SIDE_A.map((me) =>
      tiebreakKey(me, MID) > tiebreakKey(me, FAR) ? MID : FAR,
    );
    expect(new Set(selfKeyed).size, `self-keyed: ${selfKeyed.join(',')}`).toBeGreaterThan(1);
  });

  it('does not privilege a slot: across alarms, the role moves around the side', () => {
    // Index-blindness survives the substitution. If keying by the alarm's owner
    // had collapsed the hash to a constant, one slot would answer everything.
    const world = rescueBoard(SIDES);
    // Every home equidistant from every other, so distance decides nothing and
    // the tie-break decides everything.
    const at: Record<number, Vec2> = {
      0: { x: 4000, y: 3500 },
      1: { x: 4500, y: 4000 },
      2: { x: 4000, y: 4500 },
      3: { x: 3500, y: 4000 },
    };
    for (const member of SIDE_A) station(world, member).pos = at[member]!;
    const chosen = SIDE_A.map((owner) => {
      alarm(world, owner, true);
      const who = defenderFor(perceive(world, owner), owner);
      alarm(world, owner, false);
      return who;
    });
    expect(new Set(chosen).size, chosen.join(',')).toBeGreaterThan(1);
  });

  it('answers each of two simultaneous alarms with a different bot', () => {
    // The consequence of designating per ALARM rather than picking one
    // side-wide holder: two burning homes get one defender each instead of one
    // of them going unanswered. It also means the answer for a given home never
    // depends on what else is on fire — which is what makes it immune to two
    // bots reading the world a tick apart on different think cadences.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    alarm(world, FAR, true);
    const forVictim = defenderFor(perceive(world, MID), VICTIM);
    const forFar = defenderFor(perceive(world, MID), FAR);
    expect(forVictim).not.toBe(NO_DEFENDER);
    expect(forFar).not.toBe(NO_DEFENDER);
    expect(forVictim).not.toBe(forFar);
    // …and both are still agreed side-wide.
    for (const member of SIDE_A) {
      expect(defenderFor(perceive(world, member), VICTIM), `${member}`).toBe(forVictim);
      expect(defenderFor(perceive(world, member), FAR), `${member}`).toBe(forFar);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 — the count, in a 4v4 (the brief's ask)
// ---------------------------------------------------------------------------

describe("a 4v4 where one home burns: EXACTLY one teammate breaks off", () => {
  it('sends one, and only one, at every tier and for every character', () => {
    for (const tier of TIERS) {
      for (const personality of RESPONDERS) {
        const world = rescueBoard(SIDES);
        alarm(world, VICTIM, true);

        const answered = [NEAR, MID, FAR].filter(
          (id) => decide(world, id, personality, tier) === 'defend-ally',
        );
        expect(answered, `${tier}/${personality}`).toEqual([NEAR]);
      }
    }
  });

  it('is a board where all three WOULD have gone — the pre-Stage-4 condition', () => {
    // Without this the case above proves nothing: three bots that stayed home
    // because they were out of range would read exactly the same. The gate the
    // branch used before Stage 4 was distance alone, so assert distance alone
    // still admits all three.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    for (const id of [NEAR, MID, FAR]) {
      const ctx = ctxOf(world, id, 'patch');
      const distress = allyDistress(ctx, VICTIM);
      expect(distress, `${id}`).not.toBeNull();
      expect(distress!.distance, `${id}`).toBeLessThanOrEqual(allyResponseRange(ctx));
      // The klaxon reaches every one of them — it is range-free by licence.
      expect(distress!.live, `${id}`).toBe(true);
      // …and the ONE thing that now separates them is the role.
      expect(assignedToAnswer(ctx, distress!), `${id}`).toBe(id === NEAR);
    }
  });

  it('still sends one when the designated defender is the only one in reach', () => {
    // The role narrows who may answer; it must not silence an alarm that the
    // designated bot can reach. NEAR is 806 units out — inside every RESPONDER's
    // reach — so the count is one, not zero.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    expect(nearestAllyDistress(ctxOf(world, NEAR, 'warden'))?.id).toBe(VICTIM);
    expect(nearestAllyDistress(ctxOf(world, MID, 'warden'))).toBeNull();
    expect(nearestAllyDistress(ctxOf(world, FAR, 'warden'))).toBeNull();
  });

  it('sends nobody rather than everybody when the designated bot is out of reach', () => {
    // The honest cost of a negotiation-free assignment, asserted rather than
    // discovered: a role derived from public facts cannot know that a teammate
    // it did not pick happens to be closer. Bolt's reach is 720 and the alarm is
    // 806 units out, so the designated defender declines and the role does not
    // fall through to MID or FAR.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    for (const id of [NEAR, MID, FAR]) {
      expect(nearestAllyDistress(ctxOf(world, id, 'bolt')), `${id}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 4 — what the role must not change
// ---------------------------------------------------------------------------

describe('the role split constrains WHO answers, and nothing else', () => {
  it('changes nothing in FFA — there is no roster to divide', () => {
    const world = rescueBoard();
    alarm(world, VICTIM, true);
    const ctx = ctxOf(world, NEAR, 'patch');
    expect(ctx.view.allies).toEqual([]);
    expect(defenderFor(ctx.view, VICTIM)).toBe(NO_DEFENDER);
    // The branch could not fire in FFA before Stage 4 either — this is the
    // structural degradation, not a mode flag (plan §2.5).
    expect(wantsAllyDefence(ctx)).toBe(false);
  });

  it('changes nothing in a 2v2 — the only eligible teammate is always the one', () => {
    // A side of two with one home burning has exactly one candidate, so the
    // assignment is a formality and `a0-10`'s behaviour is untouched. This is
    // why every case in `./ally-defence.test.ts` is still green.
    const world = rescueBoard([0, 0, 1, 1, 1, 1, 1, 1]);
    alarm(world, VICTIM, true);
    expect(defenderFor(perceive(world, NEAR), VICTIM)).toBe(NEAR);
    expect(decide(world, NEAR, 'patch', Difficulty.Hard)).toBe('defend-ally');
  });

  it('does not divide an open-space `help` — only the shared signal', () => {
    // A klaxon is range-free: every teammate gets it, so a role can divide it. A
    // `help` is heard by whichever subset the miss roll allowed, so dividing it
    // would forbid the one bot that heard the scream from going while the
    // designated bot never heard it at all.
    const world = rescueBoard(SIDES);
    const ctx = ctxOf(world, FAR, 'patch');
    const cry = { id: VICTIM, pos: { x: 4100, y: 4100 }, distance: 300, live: false, atHome: false };
    expect(holdsDefenderRole(ctx.view, VICTIM)).toBe(false);
    expect(assignedToAnswer(ctx, cry)).toBe(true);
    // A `siege` is about a home, so it IS divided — otherwise a klaxon flicker
    // would be a hole a second responder could walk through.
    expect(assignedToAnswer(ctx, { ...cry, atHome: true })).toBe(false);
  });

  it('does not re-test the role on a run already in flight', () => {
    // `./ally`'s latch holds a response across the klaxon's two-second flicker,
    // and the role gate sits in `nearestAllyDistress` — the *start* — for the
    // same reason the range gate does: releasing a commitment when it is closest
    // to paying off is the flap the latch exists to prevent.
    const world = rescueBoard(SIDES);
    alarm(world, VICTIM, true);
    const ctx = ctxOf(world, MID, 'patch');
    expect(holdsDefenderRole(ctx.view, VICTIM)).toBe(false);
    // The `held` read is not gated…
    expect(allyDistress(ctx, VICTIM)?.id).toBe(VICTIM);
    // …so a latch already committed keeps flying.
    ctx.brain.allyResponse.target = VICTIM;
    ctx.brain.allyResponse.lastLive = ctx.view.time;
    ctx.brain.allyResponse.startedAt = ctx.view.time;
    ctx.brain.allyResponse.at.x = 4000;
    ctx.brain.allyResponse.at.y = 4000;
    expect(wantsAllyDefence(ctx)).toBe(true);
  });

  it('keeps the ladder selfish-first: my home still outranks the role', () => {
    // The role says "you are the one who answers". It does not say "answer even
    // while your own door burns" — the plan's whole Stage 2 distinction.
    for (const tier of TIERS) {
      const world = rescueBoard(SIDES);
      alarm(world, VICTIM, true);
      alarm(world, NEAR, true);
      expect(decide(world, NEAR, 'patch', tier), tier).toBe('defend');
    }
  });
});

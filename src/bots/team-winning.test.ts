/**
 * src/bots/team-winning.test.ts — **what a bot thinks winning is.**
 * OWNER: Bot Engineer (GDD §1, §2.9; `docs/team-bots-plan.md` Stage 1,
 * Tasks 1.3, 1.4 and 1.7).
 *
 * The sim's win condition is *the last **team** holding a core*
 * (`sim/match.ts` `resolveWinner`): a side plays on while any ally's core lives,
 * and a 2v2 ends when the opposing side loses its last one even if the winners
 * hold two homes. Every "who am I trying to outlast?" read in the bot layer was
 * *me*-shaped, and the s5-01 spike measured what that cost: over 8 seeds of a
 * 2v2, the collapse-phase hunt target was the bot's **own teammate's home
 * 62.7%** of the time (85.8% in a 4v4), and Medium's "gang up on the leader"
 * picked an ally **65.9%** of the time. The FFA control read 0.0% at both sizes,
 * which is what proves the instrument rather than the bots.
 *
 * That is a different failure from p16-01's. p16-01 asked *"may I shoot this?"*
 * and routed the targeting ladder through the sim's one allegiance predicate.
 * These two functions ask *"who am I trying to outlast?"* — a question about the
 * **win condition**, not about a trigger — and it happens that the same
 * `hostile` stamp answers both. **So the *change* Task 1.3 called for was
 * already shipped by p16-01** (`targeting.ts` `nearestLivingRival` and
 * `leaderStation` both open on `isFoe`, and `docs/bot-teams-allegiance-p16.md`
 * §4 lists them by name). Adding a second ally filter here would be Trap 9 — two
 * answers to one question, in two shapes, drifting apart. So this file ships the
 * **guarantee** instead of a duplicate implementation, which is the durable half
 * anyway: it is the assertion that fails if anyone ever widens either read back
 * out to "every other home".
 *
 * Four things are pinned:
 *
 *  1. **1.3** — in a 2v2 the ally's home is the *nearest standing home on the
 *     board* and neither `nearestLivingRival` nor `leaderStation` will touch it;
 *     the identical geometry in FFA still picks it, so the fixture is live.
 *  2. **1.4** — the collapse hunt *flies* at an enemy home, for every character
 *     at both tiers that hunts. The plan flags this as the one Stage 1 change
 *     that could in principle hang a match (Trap 6), so —
 *  3. **1.4, the anti-stalemate half** — a real 2v2 of the shipped cast, eight
 *     seeds, every match reaching an ending inside the harness ceiling.
 *     `timedOut === true` here is a failure, never a slow seed.
 *  4. **1.7** — the developer's ruling of 2026-08-05, *"if your core dies you
 *     are out"* (§2.7, and what the sim already does): a teammate whose home
 *     dies stops flying, the surviving ally plays on coherently while its side
 *     still holds a core, and the result is attributed to the **team**.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId, Vec2 } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, isOver, step, type World } from '../sim';
import { hunt } from './behaviors';
import { NO_ACTIONS, treeFor } from './bot';
import { botInputs, botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { perceive } from './perception';
import { Difficulty, PERSONALITIES, ROSTER } from './personalities';
import type { PersonalityId } from './personalities';
import { leaderStation, nearestLivingRival } from './targeting';
import type { BotCtx } from './tree';
import { context, createBrain, runTree } from './tree';

const ME = 0;
const ALLY = 1;
const NEAR_FOE = 2;
const FAR_FOE = 3;

/** Both tiers that hunt. Easy has no collapse branch — it has no endgame model
 *  to get wrong, which is a competence difference and not a bug. */
const HUNTING_TIERS: readonly Difficulty[] = [Difficulty.Medium, Difficulty.Hard];

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * **The collapse board**, read as a compass rose from the bot at the centre:
 *
 *   (3400, 3000)  E, 400 out — the ALLY's home. Standing, healthy, and the
 *                 nearest home on the entire map.
 *   (3000, 3400)  S, 400 out — the bot's own home. Quiet.
 *   (3000, 1200)  N, 1800 out — a FOE's home. The nearest thing worth hunting.
 *   (1000, 1000)  NW, ~2800 out — the far foe's home.
 *
 * The geometry is the point: an unfiltered "nearest living rival" picks the ally
 * every time (it is 4.5× closer than the nearest real enemy), and the two
 * answers lie on **opposite bearings**, so the direction a bot actually thrusts
 * tells them apart with no ambiguity to argue about.
 *
 * Both enemy ships are parked off-screen so nothing above `hunt` in either tree
 * can fire: no threat to flee, no target to attack, no intruder to meet.
 *
 * `teams` omitted builds the identical board with **no `team` key at all** — the
 * FFA roster shape — which is the control that proves the board is live.
 */
function collapseBoard(teams?: readonly number[]): World {
  const world = createWorld({
    seed: 16,
    players: [ME, ALLY, NEAR_FOE, FAR_FOE].map((id) => {
      const spec = { id, shipClass: ShipClass.Vanguard };
      return teams?.[id] === undefined ? spec : { ...spec, team: teams[id]! };
    }),
    bounds: { width: 6000, height: 6000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  world.asteroids.length = 0;
  world.chunks.length = 0;

  place(world, ME, { x: 3000, y: 3000 }, { x: 3000, y: 3400 });
  place(world, ALLY, { x: 3500, y: 2900 }, { x: 3400, y: 3000 });
  place(world, NEAR_FOE, { x: 200, y: 5600 }, { x: 3000, y: 1200 });
  place(world, FAR_FOE, { x: 400, y: 5800 }, { x: 1000, y: 1000 });

  // Collapse: no new ore, no repair, and the only score left is whose core
  // outlasts whose (GDD §2.3). This is the phase `hunt` exists for.
  world.match.collapseTime = world.time;
  world.match.phase = 'collapse';
  return world;
}

/** Put a slot's ship and home exactly where the case wants them, with nothing
 *  in the opening-seconds state that would answer a different branch. */
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

/** A decision context over a board, for one character. The RNG is a constant so
 *  a case never turns on a draw. */
function ctxOf(world: World, personality: PersonalityId, id: PlayerId = ME): BotCtx {
  return context(perceive(world, id), createBrain(PERSONALITIES[personality], { next: () => 0.5 }));
}

/** The direction a decision actually thrusts, or null if it is coasting. */
function heading(actions: readonly Action[]): Vec2 | null {
  for (const a of actions) {
    if (a.type !== 'thrust') continue;
    return a.dir.x === 0 && a.dir.y === 0 ? null : a.dir;
  }
  return null;
}

/** A character running a given tier's tree, regardless of its usual difficulty —
 *  the endgame model is shared selection, so it is asserted for every character
 *  at every tier that has one, not for a sampled bot. */
function decideWith(world: World, personality: PersonalityId, tier: Difficulty) {
  const brain = createBrain(PERSONALITIES[personality], { next: () => 0.5 });
  return runTree(treeFor(tier), context(perceive(world, ME), brain));
}

// ---------------------------------------------------------------------------
// Task 1.3 — "who am I trying to outlast?" excludes allies
// ---------------------------------------------------------------------------

describe('the win-condition reads never name an ally (Task 1.3)', () => {
  it("skips the ally's home even when it is the nearest standing home on the map", () => {
    const teams = collapseBoard([0, 0, 1, 1]);
    const ctx = ctxOf(teams, 'rusty');

    // The fixture is what it claims to be: the ally really is nearest.
    const homes = ctx.view.stations;
    const nearest = homes.reduce((a, b) => (a.distance <= b.distance ? a : b));
    expect(nearest.owner).toBe(ALLY);
    expect(nearest.alive).toBe(true);

    expect(nearestLivingRival(ctx)?.owner).toBe(NEAR_FOE);
    expect(leaderStation(ctx)?.owner).not.toBe(ALLY);
  });

  it('holds for every character — this is shared selection, not one bot', () => {
    const teams = collapseBoard([0, 0, 1, 1]);
    for (const character of ROSTER) {
      const ctx = ctxOf(teams, character);
      expect(nearestLivingRival(ctx)?.owner, character).toBe(NEAR_FOE);
      expect(leaderStation(ctx)?.owner, character).not.toBe(ALLY);
    }
  });

  it('still picks that same home in FFA — teams-of-one moves nothing', () => {
    // The control. Identical geometry, no `team` key anywhere: slot 1 is a
    // rival again and both reads go straight back to it, which is what proves
    // the case above is measuring the ally filter and not the geometry.
    const ffa = ctxOf(collapseBoard(), 'rusty');
    expect(nearestLivingRival(ffa)?.owner).toBe(ALLY);
    for (const character of ROSTER) {
      expect(nearestLivingRival(ctxOf(collapseBoard(), character))?.owner, character).toBe(ALLY);
    }
  });

  it('is unmoved by a wrecked ally — a dead home is not a rival either', () => {
    const world = collapseBoard([0, 0, 1, 1]);
    world.stations.find((p) => p.owner === ALLY)!.alive = false;
    expect(nearestLivingRival(ctxOf(world, 'rusty'))?.owner).toBe(NEAR_FOE);
  });
});

// ---------------------------------------------------------------------------
// Task 1.4 — the endgame hunts the other side
// ---------------------------------------------------------------------------

describe('the collapse hunt flies at the other side (Task 1.4)', () => {
  it('heads for an enemy home, away from the teammate on its doorstep', () => {
    const teams = collapseBoard([0, 0, 1, 1]);
    for (const tier of HUNTING_TIERS) {
      for (const character of ROSTER) {
        const dir = heading(decideWith(teams, character, tier));
        expect(dir, `${character} @ ${tier}`).not.toBeNull();
        // The enemy home is due north, the ally's due east: a negative y is a
        // flight at the other side, and a positive one is a flight at a
        // teammate. There is no reading in which both are true.
        expect(dir!.y, `${character} @ ${tier}`).toBeLessThan(0);
      }
    }
  });

  it('is the hunt branch doing it, and it names the enemy home', () => {
    const ctx = ctxOf(collapseBoard([0, 0, 1, 1]), 'rusty');
    const rival = nearestLivingRival(ctx);
    expect(rival?.owner).toBe(NEAR_FOE);
    expect(hunt(ctx, rival)).not.toBeNull();
    // No standing enemy home at all: the branch declines rather than inventing
    // a target, and the tree falls through to something else. (It cannot happen
    // in a live match — `resolveWinner` has already ended it — which is exactly
    // why the soak below is the real assertion.)
    expect(hunt(ctx, null)).toBeNull();
  });

  it('flies at the ally in FFA, where the ally is a rival — the control', () => {
    const ffa = collapseBoard();
    for (const tier of HUNTING_TIERS) {
      const dir = heading(decideWith(ffa, 'rusty', tier));
      expect(dir).not.toBeNull();
      // Due east, at slot 1's home: the same code, the same board, teams-of-one.
      expect(dir!.x).toBeGreaterThan(0);
    }
  });
});

/**
 * **The anti-stalemate promise, in TEAMS** (Task 1.4, Trap 6).
 *
 * `hunt` is what stops two survivors turtling at opposite ends of the ring until
 * the harness timeout, and narrowing its candidate set to enemy homes is the one
 * Stage 1 change that could in principle leave a bot with nothing to hunt. It
 * cannot in practice — if no enemy home stands, `resolveWinner` has already
 * ended the match — but "cannot in practice" is a claim, and this is the
 * measurement. Eight seeds of the real shipped cast, and `timedOut === true` is
 * a failure here, never a slow seed.
 *
 * The second rotation is not decoration: it swaps which characters fly for which
 * side, so a result that only holds for one seating arrangement cannot pass.
 */
describe('a 2v2 of the shipped cast always reaches an ending (Task 1.4)', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const rotation of [0, 2]) {
    it(`ends every match and attributes it to a team (cast rotation ${rotation})`, () => {
      const cast = [...ROSTER.slice(rotation), ...ROSTER.slice(0, rotation)];
      const winners: number[] = [];

      for (const seed of SEEDS) {
        const seats = fillEmptySlots([], 4, cast, [0, 0, 1, 1]);
        const world = createWorld({ seed, players: botLobby(seats) });
        const result = runHeadlessMatch(world, createBots(seats, { seed }));

        expect(result.timedOut, `seed ${seed}`).toBe(false);
        expect(result.ended, `seed ${seed}`).toBe(true);

        // The result is the TEAM's, and the surviving slot is one of its
        // members — the sim's own attribution, which a bot's model now matches.
        //
        // a0-113: `winner` is null on a DRAW — every remaining core lost on one
        // tick — and this suite met one. **Seed 4 really is a draw**: home death
        // times are [843.72, 850.02, 850.02, 850.02], so slot 1 (team 0) and both
        // of team 1's homes reached zero on the same collapse tick. It used to
        // read as a team-1 win off `eliminated`'s last entry, which in a
        // collapse-lockstep is `world.stations` index and nothing either side
        // did. The anti-stalemate claim this test exists for is untouched by
        // that: the match still ENDS, inside the ceiling, with nothing hung —
        // which is what `timedOut`/`ended` above assert. What is asserted below
        // is the attribution, and it can only be asserted where there is one.
        const winningTeam = world.match.winningTeam;
        expect(winningTeam === null, `seed ${seed}`).toBe(result.winner === null);
        if (result.winner !== null) {
          const home = world.stations.find((p) => p.owner === result.winner)!;
          expect(home.team, `seed ${seed}`).toBe(winningTeam);
          winners.push(winningTeam!);
        }
      }

      // Every match landed inside the design band's neighbourhood rather than
      // grinding to the ceiling: the spike's pre-change baseline is 847 s. Most
      // of them are decided; a draw is a legal ending, not a hung one.
      expect(winners.length).toBeGreaterThan(SEEDS.length / 2);
    });
  }

  it('is not a fixed side that wins — rotate the cast and the result moves', () => {
    // The thing that would make both rotations above meaningless: if side 1 won
    // every seed under every seating, the "ending" would be a seating artefact
    // rather than a match. A given rotation IS lopsided — the cast is uneven, so
    // a seating sweeps — and it is the sweep changing hands across seatings that
    // says the match is real.
    //
    // **Sampled over all eight rotations since a0-05.** It used to sample two
    // (0 and 2) at three seeds. Station health stopped being range-gated on
    // 2026-08-07 (GDD §2.2, amended), bots read rings four times further out,
    // and those two particular seatings both landed on side 1 — a six-match
    // sample flipping, not the property failing. Re-measured over 8 rotations ×
    // 6 seeds (48 matches) on this branch before widening it, side wins were
    // [team0, team1]: rot0 [0,6] · rot1 [1,5] · rot2 [1,5] · rot3 [1,5] ·
    // rot4 [3,3] · rot5 [6,0] · rot6 [6,0] · rot7 [0,6] — 18/48 to side 0.
    // Both sides win handily; the two-rotation window was the whole problem, so
    // the fix is a wider sample rather than a hand-picked pair of seatings.
    const seen = new Set<number>();
    for (let rotation = 0; rotation < ROSTER.length; rotation++) {
      const cast = [...ROSTER.slice(rotation), ...ROSTER.slice(0, rotation)];
      for (const seed of [1, 2]) {
        const seats = fillEmptySlots([], 4, cast, [0, 0, 1, 1]);
        const world = createWorld({ seed, players: botLobby(seats) });
        runHeadlessMatch(world, createBots(seats, { seed }));
        seen.add(world.match.winningTeam!);
      }
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// Task 1.7 — "if your core dies you are out" (developer, 2026-08-05)
// ---------------------------------------------------------------------------

/**
 * The GDD said both things — §1 ("in Teams, your whole side is eliminated when
 * its last reactor dies") and §2.7 ("its owner is eliminated") — and the sim
 * implemented §2.7 (`match.ts` `destroyCore` → `eliminate`, unconditional; `step`
 * never revives an eliminated ship). Asked directly, the developer ruled **"if
 * your core dies you are out"**, so §2.7 stands, no sim change is due, and the
 * §1 sentence is amended in this branch to stop contradicting shipped behaviour.
 *
 * This is the test that pins the ruling from the bot layer's side, and it is
 * **unstaged**: a real 2v2 of the shipped cast, nothing placed by hand. The
 * "one home down, one still standing" state is not rare — it occurs in every one
 * of the eight seeds the soak above runs, for anywhere from 3 to 360 seconds.
 *
 * **The seed moved from 1 to 3 when a0-10 landed, and from 3 to 11 when b3-01
 * did**, and the reason is worth stating because "the test went red so I changed
 * the seed" is exactly the move this comment exists to distinguish itself from.
 * Every *claim* below has held at every seed; what does not survive a behaviour
 * change is the sampling **window**, which is however long this particular pair
 * of bots happens to take to finish each other off. It collapsed 257 → too-short
 * at seed 1 under Stage 2, and 33k → 84 ticks at seed 3 under Stage 3, which
 * divided where bots mine and therefore where they are when a core goes.
 *
 * That fragility is a property of the fixture, so the move was made by
 * **measurement rather than by trying the next number**: seeds 1–16 were scanned
 * for the window length and for every quantity asserted below (see the b3-01
 * working note). It is a genuinely bimodal thing — seeds 1, 3 and 14 give under
 * 130 ticks while 5, 8 and 11 give over 21,000 — which is why picking the
 * *largest* margin rather than the first green one is the right move. Seed 11
 * gives a **6.8-minute window (24,362 ticks, 62,343 units travelled, 3,042 ticks
 * with the trigger down, 9 orders placed)**, so every assertion below is measured
 * with two orders of magnitude of room rather than on the edge of its fixture.
 * The assertions themselves are unchanged and none of them was relaxed.
 *
 * **And from 11 to 13 when a0-58 landed** (2026-08-16, Gameplay lane — flagged
 * for the Bot Engineer). a0-58 makes ore countable: every mint emits whole
 * `CHUNK.ore` and a hold moves in whole ore, which changes where chunks are and
 * therefore where bots are, exactly as a0-10 and b3-01 did. Seed 11's window
 * collapsed 24,362 → 2,884 ticks with 0 orders in it. The same 1–16 scan was
 * re-run under the new rules and seed 13 is the like-for-like replacement — a
 * **6.3-minute window (22,846 ticks, 48,169 units travelled, 1,385 ticks with the
 * trigger down, 8 orders placed)**, the nearest profile to the seed it replaces.
 * (Seed 16 gives a longer window, 29,971 ticks, but fewer orders, 6; seed 15 more
 * orders, 10, on half the window.) Nothing below was relaxed, added or removed:
 * one number moved, by the measurement this paragraph asks for.
 *
 * **And from 13 to 4 when a0-81 landed** (2026-08-17, this lane). a0-81 makes a
 * retreating, hauling or banking bot fire at whatever is chasing it — movement
 * intent and fire intent stopped being one decision — so bots trade damage on
 * ticks they previously did not, break off at different moments, and are
 * somewhere else when a core goes. Fourth instance of the same fixture
 * fragility, fourth time the prescribed answer is a re-scan rather than the next
 * number: seed 13's window collapsed 22,846 → 895 ticks with 0 orders in it.
 *
 * Seeds 1–16 re-scanned under the new rules for every quantity asserted below.
 * The distribution is bimodal exactly as before — eleven of sixteen seeds give
 * under 3,000 ticks — and **seed 4 is the largest-margin replacement**: a
 * **3.9-minute window (13,924 ticks, 19,365 units travelled, 1,895 ticks with
 * the trigger down, 4 orders placed)**, and it resolves as a team result with
 * zero ghost inputs like every other seed in the scan. (Seed 8 is the runner-up
 * at 8,172 ticks — more travel and more trigger, fewer orders and half the
 * window.) Nothing below was relaxed, added or removed.
 *
 * One thing the scan is worth reporting for, because it is a real second-order
 * effect of a0-81 rather than a fixture quirk: **orders placed inside these
 * windows fell across the whole scan**, from 8 at the old seed to 0–4 anywhere.
 * A bot that shoots back is a bot whose pursuer breaks off sooner, so bot-vs-bot
 * matches run less lethal and a survivor spends more of the window flying and
 * fighting rather than docked and shopping. Measured properly, on full matches
 * and both builds, in `evidence/a0-81-fleeing-fire/audit.txt`.
 */
describe('a teammate whose core dies is out, and its side plays on (Task 1.7)', () => {
  it('stops the dead-home bot dead, and its ally plays on for minutes', () => {
    const seats = fillEmptySlots([], 4, [...ROSTER.slice(2), ...ROSTER.slice(0, 2)], [0, 0, 1, 1]);
    const world = createWorld({ seed: 4, players: botLobby(seats) });
    const bots = createBots(seats, { seed: 4 });

    /** The first slot to lose its home while a teammate still holds one. */
    let downSlot: PlayerId | null = null;
    let survivor: PlayerId | null = null;
    /** Ticks the eliminated bot spent still emitting a control input. */
    let ghostTicks = 0;
    /** What the survivor did across the window its teammate spent eliminated. */
    let ticks = 0;
    let acted = 0;
    let fired = 0;
    let ordered = 0;
    let travelled = 0;
    let last: Vec2 = { x: 0, y: 0 };

    while (!isOver(world) && world.time < 20 * 60) {
      const inputs = botInputs(world, bots, TICK_DT);
      step(world, inputs, TICK_DT);

      if (downSlot === null) {
        for (const home of world.stations) {
          if (home.alive) continue;
          const mate = world.stations.find((p) => p.team === home.team && p.owner !== home.owner);
          if (mate?.alive) {
            downSlot = home.owner;
            survivor = mate.owner;
            last = { ...world.ships.find((s) => s.id === mate.owner)!.pos };
            break;
          }
        }
        continue;
      }

      // The window closes when the side loses its last core — from there on it
      // is not a "team plays on" case any more, it is a dead team.
      if (!world.stations.find((p) => p.owner === survivor)!.alive) break;

      // **The ruling.** A dead home ends that player's match: eliminated, never
      // respawned, and not one control input for the rest of the match — not
      // even the stream its hands were still holding when the core went.
      const dead = world.ships.find((s) => s.id === downSlot)!;
      expect(dead.eliminated).toBe(true);
      expect(dead.alive).toBe(false);
      if (inputs.find((i) => i.id === downSlot)!.actions.length > 0) ghostTicks++;

      // …and the survivor's match is emphatically not over.
      const stream = inputs.find((i) => i.id === survivor)!.actions;
      ticks++;
      if (stream.length > 0) acted++;
      if (stream.some((a) => a.type === 'fire' && a.active)) fired++;
      if (stream.some((a) => a.type === 'buildOrder' || a.type === 'upgradeOrder')) ordered++;
      const now = world.ships.find((s) => s.id === survivor)!.pos;
      travelled += Math.sqrt((now.x - last.x) ** 2 + (now.y - last.y) ** 2);
      last = { ...now };
    }

    expect(downSlot, 'a seed in which one side loses a member first').not.toBeNull();
    expect(ghostTicks).toBe(0);

    // The window is not a formality — this seed runs it for minutes — and the
    // survivor is *playing*, not idling out the clock: it emits a stream
    // on every single tick of it, crosses the arena several times over, holds
    // the trigger down, and keeps buying things at its own home.
    expect(ticks).toBeGreaterThan(600);
    expect(acted).toBe(ticks);
    expect(travelled).toBeGreaterThan(1000);
    expect(fired).toBeGreaterThan(0);
    expect(ordered).toBeGreaterThan(0);

    // And the match resolved as a TEAM result, not a last-player-standing one.
    expect(isOver(world)).toBe(true);
    expect(world.match.winningTeam).not.toBeNull();

    // The other half of the amended §1 sentence, which is the half that is
    // true: a side is finished when its LAST reactor dies — and then every one
    // of its members is out, not merely the one whose core went first.
    const losers = world.stations.filter((p) => p.team !== world.match.winningTeam);
    expect(losers.length).toBeGreaterThan(1);
    for (const home of losers) {
      expect(home.alive).toBe(false);
      expect(world.ships.find((s) => s.id === home.owner)!.eliminated).toBe(true);
    }
  });

  it('emits NO_ACTIONS for an eliminated seat, whatever its side is doing', () => {
    // The unit-level statement of the same ruling: `thinkOnce` gates on the
    // view's own `eliminated`, which is a fact about this player and not about
    // its team, so a living teammate changes nothing about it (GDD §2.7).
    const seats = fillEmptySlots([], 4, ROSTER, [0, 0, 1, 1]);
    const world = createWorld({ seed: 9, players: botLobby(seats), asteroidCount: 0 });
    const bots = createBots(seats, { seed: 9 });

    const out = world.ships.find((s) => s.id === ALLY)!;
    out.eliminated = true;
    out.alive = false;

    const inputs = botInputs(world, bots, TICK_DT);
    expect(inputs.find((i) => i.id === ALLY)!.actions).toEqual(NO_ACTIONS);
    expect(inputs.find((i) => i.id === ME)!.actions.length).toBeGreaterThan(0);
  });
});

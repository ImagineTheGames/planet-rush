/**
 * src/bots/teams-hostility.test.ts — **a bot never fights its own side.**
 * OWNER: Bot Engineer (GDD §2.9; developer report p16-01, "team B bots was
 * attacking each other").
 *
 * This is the test whose absence let the defect ship, so it is the deliverable
 * rather than a lap of honour. `src/sim/allegiance.ts` is by its own header *the
 * ONE friend/foe predicate*, and the bots layer never asked it: `nearestEnemy`,
 * `homeIntruder`, `bestTarget`, `leaderStation`, `nearestLivingRival`,
 * `nearestThreat` and the mining-corridor scoring were all *named* for hostility
 * and all meant "any other ship". Nothing caught it because **FFA is
 * teams-of-one** — with every slot on its own team, `areEnemies` reduces to
 * `a !== b`, so "nearest other ship" and "nearest enemy" are the same set and
 * `sim/ffa-hostility.test.ts` passes either way. The defect is invisible until
 * two slots share a `team`, which is exactly what this file arranges.
 *
 * The shape of every case below is **one geometry, three team tables**:
 *
 *  - `foe`  — slot 1 is an enemy. The tempting thing in front of the bot is a
 *             legitimate target, and the bot must take it. This validates the
 *             fixture: without it, "never shoots an ally" would also be
 *             satisfied by a bot that never shoots at all.
 *  - `ally` — the identical board with slot 1 moved onto the observer's team.
 *             Every pick must move to a real enemy; none may name slot 1.
 *  - `ffa`  — the identical board with **no `team` field at all**, the pre-teams
 *             roster shape (`src/platform/match-boot`). Teams-of-one, so every
 *             pick must be byte-identical to `foe`.
 *
 * The matrix is all seven characters (GDD §2.9) × all three trees, not one
 * sampled bot: the defect lived in shared target selection, so the guarantee has
 * to hold for every character running any tier's tree.
 *
 * The last case is the developer's own scenario, unstaged: eight bots, two
 * teams, a real headless match, nothing placed by hand.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId, Vec2 } from '@shared/types';
import {
  SPAWN_PROTECTION_S,
  TICK_DT,
  areEnemies,
  createWorld,
  step,
  type MiningStation,
  type PlayerSpec,
  type Ship,
  type World,
} from '../sim';
import { RETREAT_CLEAR_RANGE, corneredBlockader, nearestThreat } from './behaviors';
import type { Bot } from './bot';
import { treeFor } from './bot';
import { botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { hardAttackFloor } from './hard';
import { mediumTarget } from './medium';
import type { BotView, PerceivedShip, PerceivedStation } from './perception';
import { perceive } from './perception';
import { Difficulty, PERSONALITIES, ROSTER } from './personalities';
import type { PersonalityId } from './personalities';
import {
  allyCrowding,
  bestRock,
  bestTarget,
  homeIntruder,
  pathClearance,
  isFoe,
  isTargetable,
  leaderStation,
  nearestEnemy,
  nearestLivingRival,
  scoreShip,
  scoreStation,
} from './targeting';
import type { BotCtx } from './tree';
import { context, createBrain, runTree } from './tree';

/** The three team tables laid over one geometry. */
type Side = 'foe' | 'ally' | 'ffa';
const SIDES: readonly Side[] = ['foe', 'ally', 'ffa'];

/** The slot under test, the slot the boards move between sides, and the two
 *  rivals that are hostile in every table. */
const SELF = 0;
const SWING = 1;
const RIVAL = 2;
const DISTANT = 3;

const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The roster for a side table. `ffa` supplies **no `team` field at all** — the
 *  shape the offline client boots with, and the `undefined === undefined` trap
 *  `sim/ffa-hostility.test.ts` closed at the sim layer. */
function roster(side: Side): PlayerSpec[] {
  const table: Record<Side, readonly (number | undefined)[]> = {
    ffa: [undefined, undefined, undefined, undefined],
    ally: [0, 0, 1, 1],
    foe: [0, 1, 1, 1],
  };
  return [SELF, SWING, RIVAL, DISTANT].map((id) => {
    const team = table[side][id];
    const spec: PlayerSpec = { id, shipClass: ShipClass.Vanguard };
    return team === undefined ? spec : { ...spec, team };
  });
}

function shipOf(world: World, id: PlayerId): Ship {
  const ship = world.ships.find((s) => s.id === id);
  expect(ship, `slot ${id} has a ship`).toBeDefined();
  return ship!;
}

function stationOf(world: World, id: PlayerId): MiningStation {
  const station = world.stations.find((p) => p.owner === id);
  expect(station, `slot ${id} has a home`).toBeDefined();
  return station!;
}

/** Put a slot's ship and home exactly where the case wants them. */
function place(world: World, id: PlayerId, ship: Vec2, home: Vec2): void {
  const s = shipOf(world, id);
  s.pos = { ...ship };
  s.vel = { x: 0, y: 0 };
  s.home = { ...home };
  s.spawnProtect = 0;
  const p = stationOf(world, id);
  p.pos = { ...home };
  p.spawnProtect = 0;
  p.sinceDamage = 999;
}

/** Four slots, no rocks, and none of the opening-seconds special cases. */
function blankWorld(side: Side): World {
  const world = createWorld({
    seed: 16,
    players: roster(side),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  world.asteroids.length = 0;
  return world;
}

/**
 * **The board.** Read down the y axis from the bot's own front door:
 *
 *   y=2600  the bot's own station
 *   y=2380  slot 1 — wounded, in the alarm ring, the nearest hull on the map,
 *           and (at x=2150, alongside the bot) its home, on screen and cracked
 *   y=2260  the bot
 *   y=2100  slot 2 — a healthy rival, further away, still inside the ring
 *   y=1700  slot 2's home, in view — and, since a0-05, read like anything
 *           else on screen (it sits at full core, so it reads full)
 *
 * Slot 1 is deliberately the most tempting thing in the game: nearest, most
 * wounded, most exposed, and sitting on the observer's doorstep with a cracked
 * core beside it. When it is a foe, every selector should want it. When it is a
 * teammate, none of them may — and the pick must move to slot 2, which is
 * *behind the bot*, so an aim vector alone tells the two apart.
 */
function board(side: Side): World {
  const world = blankWorld(side);
  place(world, SELF, { x: 2000, y: 2260 }, { x: 2000, y: 2600 });
  place(world, SWING, { x: 2000, y: 2380 }, { x: 2150, y: 2260 });
  place(world, RIVAL, { x: 2000, y: 2100 }, { x: 2000, y: 1700 });
  place(world, DISTANT, { x: 200, y: 200 }, { x: 200, y: 400 });

  shipOf(world, SWING).hull = shipOf(world, SWING).maxHull * 0.15;
  // A cracked core beside the bot: on screen, readable, and worth besieging,
  // which is what makes an unfiltered `scoreStation` reach for it.
  stationOf(world, SWING).coreHp = stationOf(world, SWING).maxCoreHp * 0.2;
  return world;
}

/** A decision context over a board, for one character running one tier's tree. */
function ctxOf(world: World, personality: PersonalityId, id: PlayerId = SELF): BotCtx {
  const brain = createBrain(PERSONALITIES[personality], { next: () => 0.5 });
  return context(perceive(world, id), brain);
}

/** The perceived ship / home of a slot, which the case requires to be in view. */
function seenShip(ctx: BotCtx, id: PlayerId): PerceivedShip {
  const ship = ctx.view.ships.find((s) => s.id === id);
  expect(ship, `slot ${id} should be in view`).toBeDefined();
  return ship!;
}
function seenHome(ctx: BotCtx, id: PlayerId): PerceivedStation {
  const station = ctx.view.stations.find((p) => p.owner === id);
  expect(station, `slot ${id}'s home should be in view`).toBeDefined();
  return station!;
}

/** Every slot a decision could be read as targeting: the ids this bot's selectors
 *  named this tick. Collected in one place so a new selector cannot be added
 *  without a test author noticing it is not on the list. */
function picks(ctx: BotCtx): Record<string, PlayerId | null> {
  const hard = bestTarget(ctx, hardAttackFloor(ctx));
  const medium = mediumTarget(ctx);
  return {
    nearestEnemy: nearestEnemy(ctx)?.id ?? null,
    homeIntruder: homeIntruder(ctx)?.id ?? null,
    bestTarget: hard?.id ?? null,
    bestTargetKind: (hard?.kind === 'station' ? -2 : hard ? -3 : null) as PlayerId | null,
    mediumTarget: medium?.id ?? null,
    leaderStation: leaderStation(ctx)?.owner ?? null,
    nearestLivingRival: nearestLivingRival(ctx)?.owner ?? null,
    nearestThreat: nearestThreat(ctx, RETREAT_CLEAR_RANGE)?.id ?? null,
  };
}

/** The `aim` direction a decision emitted, and whether the trigger was down. */
function aiming(actions: readonly Action[]): { dir: Vec2 | null; firing: boolean } {
  let dir: Vec2 | null = null;
  let firing = false;
  for (const a of actions) {
    if (a.type === 'aim') dir = a.dir;
    if (a.type === 'fire' && a.active) firing = true;
  }
  return { dir, firing };
}

/** Is `dir` pointing at `pos` from `from`, inside the widest aim spread any tier
 *  draws? The board puts the two candidates on opposite bearings, so this is a
 *  coarse-but-unambiguous read of who a shot is meant for. */
function pointsAt(from: Vec2, dir: Vec2 | null, pos: Vec2): boolean {
  if (dir === null) return false;
  const dx = pos.x - from.x;
  const dy = pos.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const dlen = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
  return (dx / len) * (dir.x / dlen) + (dy / len) * (dir.y / dlen) > Math.cos(0.5);
}

/**
 * Fly one character's tree over a board for a second and a half of sim time, and
 * report who it actually shot at.
 *
 * A single decision is not enough to see a trigger: `engage` only fires once the
 * hull has turned onto the bearing (`canHitDir`), so a bot that has correctly
 * chosen its target still reads as "not firing" on the tick it chose. This runs
 * the real loop — decide, `step`, decide — with the bot as the only input, which
 * is also the honest test of the whole chain: view → tree → action stream → sim.
 *
 * The tree is re-run every tick rather than at the tier's reaction cadence: the
 * cadence is the harness's business (`./harness.test.ts`) and holding it here
 * would only make the same decisions arrive later.
 */
function drive(
  side: Side,
  character: PersonalityId,
  tier: Difficulty,
  ticks = 90,
): { shots: number; atSwing: number; atRival: number } {
  const world = board(side);
  const brain = createBrain(PERSONALITIES[character], { next: () => 0.5 });
  let shots = 0;
  let atSwing = 0;
  let atRival = 0;
  for (let i = 0; i < ticks; i++) {
    const actions = runTree(treeFor(tier), context(perceive(world, SELF), brain));
    const { dir, firing } = aiming(actions);
    if (firing) {
      const self = shipOf(world, SELF).pos;
      shots++;
      if (
        pointsAt(self, dir, shipOf(world, SWING).pos) ||
        pointsAt(self, dir, stationOf(world, SWING).pos)
      ) {
        atSwing++;
      }
      if (pointsAt(self, dir, shipOf(world, RIVAL).pos)) atRival++;
    }
    step(world, [{ id: SELF, actions }], TICK_DT);
  }
  return { shots, atSwing, atRival };
}

// ---------------------------------------------------------------------------
// 1. The board itself — the fixture is a fight, and the bot takes it
// ---------------------------------------------------------------------------

describe('the fixture is a fight worth having', () => {
  it('every selector wants slot 1 when slot 1 is an enemy', () => {
    const ctx = ctxOf(board('foe'), 'sable');
    const p = picks(ctx);
    expect(p.nearestEnemy).toBe(SWING);
    expect(p.homeIntruder).toBe(SWING);
    expect(p.bestTarget).toBe(SWING);
    expect(p.mediumTarget).toBe(SWING);
    expect(p.nearestLivingRival).toBe(SWING);
    expect(p.nearestThreat).toBe(SWING);
    // And it is worth points, both as a hull and as a home to crack.
    expect(scoreShip(ctx, seenShip(ctx, SWING)).score).toBeGreaterThan(0);
    expect(scoreStation(ctx, seenHome(ctx, SWING)).score).toBeGreaterThan(0);
  });

  it('slot 2 is a real enemy on every board — so a moved pick has somewhere to go', () => {
    for (const side of SIDES) {
      const world = board(side);
      const ctx = ctxOf(world, 'sable');
      expect(areEnemies(world, SELF, RIVAL), side).toBe(true);
      expect(isFoe(seenShip(ctx, RIVAL)), side).toBe(true);
      expect(isTargetable(seenShip(ctx, RIVAL)), side).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Never an ally — every selector, every character, every tier
// ---------------------------------------------------------------------------

describe('a bot never selects an ally as a target', () => {
  it('no selector names a teammate — and each one still names the real enemy', () => {
    const world = board('ally');
    for (const character of ROSTER) {
      const ctx = ctxOf(world, character);
      const p = picks(ctx);
      for (const [name, id] of Object.entries(p)) {
        if (id === null || id < 0) continue;
        expect(areEnemies(world, SELF, id), `${character}: ${name} named slot ${id}`).toBe(true);
      }
      // Not passive: the same reads still find slot 2, which is a genuine foe.
      expect(p.nearestEnemy, character).toBe(RIVAL);
      expect(p.homeIntruder, character).toBe(RIVAL);
      expect(p.nearestThreat, character).toBe(RIVAL);
      expect(p.bestTarget, character).not.toBeNull();
      expect(p.mediumTarget, character).not.toBeNull();
      expect(p.nearestLivingRival, character).toBe(RIVAL);
    }
  });

  it('an ally scores zero as a hull and zero as a home, however tempting', () => {
    const world = board('ally');
    for (const character of ROSTER) {
      const ctx = ctxOf(world, character);
      const ally = scoreShip(ctx, seenShip(ctx, SWING));
      const allyHome = scoreStation(ctx, seenHome(ctx, SWING));
      expect(ally.score, character).toBe(0);
      expect(ally.opportunity, character).toBe(0);
      expect(allyHome.score, character).toBe(0);
      expect(allyHome.opportunity, character).toBe(0);
      // The complement, on the same tick: the rival is still worth going for.
      expect(scoreShip(ctx, seenShip(ctx, RIVAL)).score, character).toBeGreaterThan(0);
    }
  });

  it('every character, in every tier’s tree, shoots the rival and never the teammate', () => {
    let engaged = 0;
    for (const character of ROSTER) {
      for (const tier of TIERS) {
        const label = `${character}/${tier}`;
        const run = drive('ally', character, tier);
        expect(run.atSwing, `${label} fired on the teammate`).toBe(0);
        // Not passive: it turned on the intruder that IS a foe and pulled the
        // trigger. Every shot it fired was at that ship.
        expect(run.shots, `${label} never fired at all`).toBeGreaterThan(0);
        expect(run.atRival, label).toBe(run.shots);
        engaged++;
      }
    }
    expect(engaged).toBe(ROSTER.length * TIERS.length);
  });

  it('the same 21 cases DO shoot slot 1 the moment it changes sides', () => {
    for (const character of ROSTER) {
      for (const tier of TIERS) {
        const label = `${character}/${tier}`;
        const run = drive('foe', character, tier);
        expect(run.shots, `${label} never fired at all`).toBeGreaterThan(0);
        expect(run.atSwing, label).toBe(run.shots);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Siege — a bot does not lay siege to its own side
// ---------------------------------------------------------------------------

describe('a bot never sieges an ally', () => {
  it('the nearest, most cracked home on the board is skipped when it is a friend', () => {
    const world = board('ally');
    for (const character of ROSTER) {
      const ctx = ctxOf(world, character);
      const target = bestTarget(ctx, 0);
      expect(target, character).not.toBeNull();
      expect(areEnemies(world, SELF, target!.id), character).toBe(true);
      // The endgame hunt goes past it too: `nearestLivingRival` is the one
      // map-wide read, and an ally's front door is not a destination.
      expect(nearestLivingRival(ctx)!.owner, character).toBe(RIVAL);
    }
  });

  it('"gangs up on the leader" never means "gang up on your own side"', () => {
    // The leader read prefers the STRONGEST-looking home, and an UNREAD core is
    // assumed full — so a teammate's home, the one home a bot is rarely close
    // enough to look at, is exactly the shape that wins this comparison.
    for (const side of ['ally', 'foe'] as const) {
      const world = blankWorld(side);
      place(world, SELF, { x: 2000, y: 2000 }, { x: 2000, y: 2600 });
      // SWING's home sits OFF SCREEN (surface past the 720-unit `visualRange`),
      // so its core reads `null` and the leader heuristic assumes it full. It
      // used to sit at x=2600: outside the retired 180-unit `SENSOR_RANGE`, but
      // comfortably on screen. a0-05 widened the station-health gate to the
      // on-screen test (GDD §2.2, amended 2026-08-07), so the board moved out to
      // keep saying exactly what it was always saying.
      place(world, SWING, { x: 3100, y: 2100 }, { x: 3100, y: 2000 }); // off screen: unread, reads healthy
      place(world, RIVAL, { x: 2150, y: 2100 }, { x: 2150, y: 2000 }); // on screen: read, and cracked
      place(world, DISTANT, { x: 200, y: 200 }, { x: 200, y: 400 });
      stationOf(world, RIVAL).coreHp = stationOf(world, RIVAL).maxCoreHp * 0.2;

      for (const character of ROSTER) {
        const ctx = ctxOf(world, character);
        expect(seenHome(ctx, SWING).scouted, `${side}/${character}`).toBe(false);
        expect(seenHome(ctx, RIVAL).scouted, `${side}/${character}`).toBe(true);
        const leader = leaderStation(ctx);
        expect(leader, `${side}/${character}`).not.toBeNull();
        expect(areEnemies(world, SELF, leader!.owner), `${side}/${character}`).toBe(true);
        // With slot 1 hostile the healthiest-looking home IS slot 1's, which is
        // what makes the ally case a real filter rather than a coincidence.
        if (side === 'foe') expect(leader!.owner, character).toBe(SWING);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. An ally is not a threat — corridors, flee reads, and the cornered latch
// ---------------------------------------------------------------------------

describe('an ally never contributes to threat scoring', () => {
  /** Two equal rocks 600 out, one dead ahead with slot 1 parked on its approach. */
  function corridorWorld(side: Side): World {
    const world = blankWorld(side);
    place(world, SELF, { x: 2000, y: 2000 }, { x: 2000, y: 3400 });
    place(world, SWING, { x: 2000, y: 1700 }, { x: 2600, y: 1400 }); // on the path to rock A
    place(world, RIVAL, { x: 200, y: 200 }, { x: 200, y: 400 });
    place(world, DISTANT, { x: 3800, y: 3800 }, { x: 3700, y: 3700 });
    for (const [id, pos] of [
      [900, { x: 2000, y: 1400 }],
      [901, { x: 2000, y: 2600 }],
    ] as const) {
      world.asteroids.push({
        id,
        pos: { ...pos },
        radius: 40,
        ore: 30,
        maxOre: 30,
        crackStage: 0,
        mineBuffer: 0,
        home: null,
      });
    }
    return world;
  }

  it('a teammate on the approach is not a THREAT to the site — asserted on the term, not the pick', () => {
    // **This assertion moved from the pick to the term, and it was not relaxed
    // — it was sharpened.** It used to read "an ally on the corridor leaves the
    // pick alone (900); a foe there costs that site the pick (901)". Since
    // b3-01 an ally on the corridor *also* costs the site the pick, for an
    // entirely different reason: `allyCrowding` discounts a rock a teammate is
    // nearer to than I am (`docs/team-bots-plan.md` Stage 3).
    //
    // The two cannot be told apart by geometry, and that is a property of the
    // design rather than an accident of this fixture: the crowd reach is one
    // *visual range*, and any ship strictly on my approach segment to a rock I
    // can see is necessarily nearer to that rock than I am and inside that
    // reach. **"On my path to that rock" and "competing with me for that rock"
    // are the same set of ships.** So an outcome assertion can no longer carry
    // the p16-01 claim, and the two terms are read directly instead — which is
    // the stronger statement anyway, and the same reason `TargetScore` carries
    // its three terms beside its total.
    for (const character of ROSTER) {
      const ally = ctxOf(corridorWorld('ally'), character);
      const foe = ctxOf(corridorWorld('foe'), character);
      const ffa = ctxOf(corridorWorld('ffa'), character);
      const rock = ally.view.asteroids.find((r) => r.id === 900)!;

      // **p16-01, exactly.** A teammate contributes NOTHING to the threat on a
      // corridor — not "less", nothing — while a hostile in the identical
      // position divides the site down. This is the assertion that would catch
      // an ally leaking back into `pathClearance`.
      expect(pathClearance(ally, rock.pos), character).toBe(1);
      expect(pathClearance(foe, rock.pos), character).toBeLessThan(1);
      expect(pathClearance(ffa, rock.pos), character).toBeLessThan(1);

      // …and the mirror image on the Stage 3 term: a *foe* near a rock is not
      // competition for it, at any character. Only a teammate crowds.
      expect(allyCrowding(foe, rock), character).toBe(1);
      expect(allyCrowding(ffa, rock), character).toBe(1);
      expect(allyCrowding(ally, rock), character).toBeLessThan(1);

      // The pick, now that both terms are accounted for: every table takes the
      // *other* rock, and the tables differ in why.
      expect(bestRock(ally)?.id, character).toBe(901);
      expect(bestRock(foe)?.id, character).toBe(901);
      expect(bestRock(ffa)?.id, character).toBe(901);
    }
  });

  it('a wounded bot does not flee its own escort', () => {
    for (const side of ['ally', 'foe'] as const) {
      const world = blankWorld(side);
      place(world, SELF, { x: 2000, y: 2000 }, { x: 2000, y: 2600 });
      place(world, SWING, { x: 2000, y: 2150 }, { x: 2600, y: 1400 });
      place(world, RIVAL, { x: 200, y: 200 }, { x: 200, y: 400 });
      place(world, DISTANT, { x: 3800, y: 3800 }, { x: 3700, y: 3700 });
      shipOf(world, SELF).hull = shipOf(world, SELF).maxHull * 0.15;

      for (const character of ROSTER) {
        const ctx = ctxOf(world, character);
        const threat = nearestThreat(ctx, RETREAT_CLEAR_RANGE);
        if (side === 'ally') expect(threat, character).toBeNull();
        else expect(threat?.id, character).toBe(SWING);
      }
    }
  });

  it('a teammate in the road is an obstacle, never a blockade to commit to', () => {
    // The p15 geometry exactly: damaged bot, own station behind a ship parked on
    // the line between them. Committing here means committing to ATTACK, so an
    // ally must never satisfy it — and an enemy must still.
    for (const side of ['ally', 'foe'] as const) {
      for (const character of ROSTER) {
        const world = blankWorld(side);
        place(world, SELF, { x: 2000, y: 2000 }, { x: 2000, y: 2600 });
        place(world, SWING, { x: 2000, y: 2300 }, { x: 2600, y: 1400 });
        place(world, RIVAL, { x: 200, y: 200 }, { x: 200, y: 400 });
        place(world, DISTANT, { x: 3800, y: 3800 }, { x: 3700, y: 3700 });
        shipOf(world, SELF).hull = shipOf(world, SELF).maxHull * 0.15;

        const brain = createBrain(PERSONALITIES[character], { next: () => 0.5 });
        let committed: PlayerId | null = null;
        // Four seconds of decisions — past even Easy's 1.6s detection lag.
        for (let i = 0; i < 40; i++) {
          world.time += 0.1;
          world.tick += 6;
          const found = corneredBlockader(context(perceive(world, SELF), brain));
          if (found) committed = found.id;
        }
        if (side === 'ally') expect(committed, character).toBeNull();
        else expect(committed, character).toBe(SWING);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. FFA is teams-of-one — routing through `areEnemies` changed nothing
// ---------------------------------------------------------------------------

describe('FFA is byte-identical', () => {
  it('every entity in an FFA view is hostile, so no filter can bite', () => {
    const world = board('ffa');
    for (const id of [SELF, SWING, RIVAL, DISTANT]) {
      const view = perceive(world, id);
      for (const ship of view.ships) {
        expect(ship.hostile, `slot ${id} sees ship ${ship.id}`).toBe(true);
        expect(isFoe(ship)).toBe(true);
      }
      for (const station of view.stations) {
        expect(station.hostile, `slot ${id} sees home ${station.owner}`).toBe(true);
      }
      // Self is never in its own view, so self-immunity is not this file's to
      // re-prove — `areEnemies` short-circuits `a === b` regardless.
      expect(view.ships.some((s) => s.id === id)).toBe(false);
    }
  });

  it('a roster with no `team` field picks exactly what an explicit-teams roster picks', () => {
    for (const character of ROSTER) {
      expect(picks(ctxOf(board('ffa'), character)), character).toEqual(
        picks(ctxOf(board('foe'), character)),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The developer's own scenario: an unstaged eight-bot TEAMS match
// ---------------------------------------------------------------------------

describe('an unstaged TEAMS match', () => {
  /** Slots 0-3 fight for side 0, slots 4-7 for side 1 — the table
   *  `src/platform/match-boot` stamps for a TEAMS lobby. */
  const sideOf = (id: PlayerId): number => (id < 4 ? 0 : 1);

  it('two minutes, eight bots, two teams: not one target pick names a teammate', () => {
    const seats = fillEmptySlots();
    const players: PlayerSpec[] = botLobby(seats).map((p) => ({ ...p, team: sideOf(p.id) }));
    const world = createWorld({ seed: 9021, players });
    const bots: Bot[] = createBots(seats, { seed: 9021 });

    let allied = 0;
    let hostile = 0;
    for (const bot of bots) {
      const decide = bot.decide;
      bot.decide = (view: BotView): readonly Action[] => {
        const actions = decide(view);
        // The bot's own selectors, on the bot's own view, after its own
        // decision: a context assembled by hand so reading cannot perturb the
        // match being measured.
        const ctx: BotCtx = {
          view,
          self: view.self,
          brain: bot.brain,
          weights: bot.brain.weights,
          tuning: bot.brain.tuning,
          rng: bot.brain.rng,
          memory: bot.brain.memory,
        };
        for (const id of Object.values(picks(ctx))) {
          if (id === null || id < 0) continue;
          if (areEnemies(world, bot.seat.id, id)) hostile++;
          else allied++;
        }
        return actions;
      };
    }

    runHeadlessMatch(world, bots, { dt: TICK_DT, maxSeconds: 120 });

    expect(allied).toBe(0);
    // And they are still playing: the same run before this fix produced 1440
    // hostile picks against 17390 allied ones (docs/bot-teams-allegiance-p16.md).
    expect(hostile).toBeGreaterThan(1440);
  });
});

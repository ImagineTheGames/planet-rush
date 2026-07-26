/**
 * src/bots/medium.ts — the Medium tree. OWNER: Bot Engineer (GDD §2.9).
 *
 * > **Medium** balances the triangle, contests ore waves, and gangs up on the
 * > current leader.
 *
 * Three clauses, three structural differences from Easy:
 *
 *  - **balances the triangle** — the spending plan stops turtling at two turrets
 *    and one shield and starts buying the *ship* (GDD §2.5: "the economy is the
 *    choice between those two"), and the attack branch sits above mining rather
 *    than nowhere at all.
 *  - **contests ore waves** — a Medium bot reads the wave clock, which is public
 *    information printed on every HUD (GDD §2.2), and is already at the centre
 *    when the next wave lands. Every wave spawns closer to the middle than the
 *    last (GDD §2.3), so being early is a real edge and needs no map knowledge.
 *  - **gangs up on the current leader** — `leaderPlanet` (`./targeting`) picks
 *    the strongest rival *from what this bot has scouted*, which is a guess, and
 *    is meant to be: "a global HP scoreboard would let everyone free-ride on
 *    every attack; fog makes third-party awareness a skill" (GDD §2.2). Several
 *    Medium bots converging on the same guess is the emergent alliance GDD §2.6
 *    describes — "why being the leader is dangerous" — with no alliance protocol
 *    anywhere in the code.
 */

import { UpgradeTrack } from '@shared/types';
import { SHIELD, TURRET, nextUpgradeCost } from '../sim';
import type { Purchase } from './behaviors';
import {
  attack,
  defendHome,
  haulHome,
  hunt,
  incomingThreat,
  mine,
  order,
  retreat,
  roam,
  scavenge,
  spendAtHome,
  upgrade,
  wantsToHaul,
} from './behaviors';
import { NEUTRAL } from './steering';
import {
  bestRock,
  homeIntruder,
  isWounded,
  leaderPlanet,
  nearestEnemy,
  nearestLivingRival,
  scorePlanet,
  scoreShip,
} from './targeting';
import type { TargetScore } from './targeting';
import type { BotCtx, Node } from './tree';
import { selector, when } from './tree';

/** Turrets before the ship gets anything. Two, not Easy's three: a Medium bot
 *  buys enough deterrent to make a lone attacker regret it and spends the rest
 *  on being able to fight back (GDD §2.6). TUNABLE */
export const MEDIUM_TURRET_TARGET = 2;
/** Shield generators before the ship gets anything. TUNABLE */
export const MEDIUM_SHIELD_TARGET = 1;
/** Seconds before a wave lands that a Medium bot starts moving to meet it. TUNABLE */
export const WAVE_CONTEST_LEAD = 14;

/**
 * The balanced wallet. Defence first but *bounded*, then the two upgrades that
 * pay for themselves inside one match — hold size and power — then the bank.
 *
 * The order is the triangle: a bot that never buys a turret dies at home, and a
 * bot that only buys turrets arrives at the collapse phase with a fortress, a
 * stock ship, and nothing left to mine (GDD §2.6).
 */
export function mediumSpendPlan(ctx: BotCtx): Purchase | null {
  const planet = ctx.self.planet;
  if (!planet) return null;
  const spendable = ctx.self.spendable;

  if (
    !ctx.view.collapsed &&
    !planet.repairing &&
    !planet.underAttack &&
    planet.coreHp < planet.maxCoreHp * MEDIUM_REPAIR_AT &&
    spendable >= 2
  ) {
    return order('repair');
  }

  if (planet.turrets + planet.builds < MEDIUM_TURRET_TARGET && spendable >= TURRET.cost) return order('turret');
  if (
    planet.turrets >= 1 &&
    planet.shields + planet.builds < MEDIUM_SHIELD_TARGET &&
    spendable >= SHIELD.cost
  ) {
    return order('shield');
  }

  // The ship half of the economy. Cargo first — the cheapest tier in the ladder
  // and the one a miner feels immediately (GDD §2.5) — then power, which is both
  // mining speed and weapon damage, so it pays on two sides of the triangle.
  for (const track of MEDIUM_UPGRADE_ORDER) {
    const cost = nextUpgradeCost(ctx.self, track);
    if (cost !== null && spendable >= cost) return upgrade(track);
  }

  if (ctx.self.cargo > 1e-9) return order('bank');
  return null;
}

/** Core fraction below which a Medium bot spends its trip home on repairs. TUNABLE */
export const MEDIUM_REPAIR_AT = 0.7;

/** The ladder a Medium bot climbs, in order (GDD §2.5). TUNABLE */
export const MEDIUM_UPGRADE_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Cargo,
  UpgradeTrack.Power,
  UpgradeTrack.Engine,
];

/**
 * What a Medium bot picks a fight with: the leader's home if it can see one
 * worth cracking, otherwise whatever enemy ship is nearest. The leader guess
 * comes from scouting only, so a bot that has been mining all match with its
 * back to the field will guess wrong — and that is the design (GDD §2.2).
 */
export function mediumTarget(ctx: BotCtx): TargetScore | null {
  const leader = leaderPlanet(ctx);
  if (leader && leader.distance - leader.radius <= ctx.view.perception.visualRange) {
    const scored = scorePlanet(ctx, leader);
    if (scored.score > 0) return scored;
  }
  const enemy = nearestEnemy(ctx);
  return enemy ? scoreShip(ctx, enemy) : null;
}

/** Is this bot in shape to start something? Healthy, and not carrying a load it
 *  would rather bank — dying with a full hold hands half of it to the killer
 *  (GDD §2.7). */
export function mediumWillFight(ctx: BotCtx): boolean {
  return !isWounded(ctx) && ctx.self.cargo < ctx.self.cargoCap * 0.5;
}

/** The Medium tree (GDD §2.9). */
export const mediumTree: Node = selector('medium', [
  when('dead', (ctx) => !ctx.self.alive, () => NEUTRAL),

  // Breaks off wounded — until the field is spent, when there is no hold left to
  // save and a respawn is free (GDD §2.3, §2.7). See `./hard` for the same rule.
  when(
    'retreat',
    (ctx) => !ctx.view.collapsed && isWounded(ctx) && incomingThreat(ctx) !== null,
    (ctx) => retreat(ctx, incomingThreat(ctx)),
  ),

  // Answers the alarm — until collapse, when guarding a core that can no longer
  // be repaired only costs the damage race (see `./hard` for the full argument).
  when(
    'defend',
    (ctx) => {
      const planet = ctx.self.planet;
      if (!planet || !planet.alive || ctx.view.collapsed) return false;
      return planet.underAttack || homeIntruder(ctx) !== null;
    },
    (ctx) => defendHome(ctx),
  ),

  when('spend', () => true, (ctx) => spendAtHome(ctx, mediumSpendPlan)),

  when('haul', (ctx) => wantsToHaul(ctx), (ctx) => haulHome(ctx)),

  // "contests ore waves": be at the centre when the rocks arrive, not after.
  when(
    'contest-wave',
    (ctx) =>
      ctx.view.nextWaveIn !== null &&
      ctx.view.nextWaveIn <= WAVE_CONTEST_LEAD &&
      !ctx.self.cargoFull,
    (ctx) => roam(ctx),
  ),

  // "gangs up on the current leader".
  when(
    'attack',
    (ctx) => mediumWillFight(ctx) && mediumTarget(ctx) !== null,
    (ctx) => {
      const target = mediumTarget(ctx);
      return target ? attack(ctx, target) : null;
    },
  ),

  // Collapse, and nothing in sight: go and find the last rival (`./behaviors`).
  // Above the economy, because by now there is no economy (GDD §2.3).
  when('hunt', (ctx) => ctx.view.collapsed, (ctx) => hunt(ctx, nearestLivingRival(ctx))),

  when('mine', () => true, (ctx) => mine(ctx, bestRock(ctx))),

  when('scavenge', () => true, (ctx) => scavenge(ctx)),

  when('roam', () => true, (ctx) => roam(ctx)),
]);

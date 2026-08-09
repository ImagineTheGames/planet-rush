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
 *  - **gangs up on the current leader** — `leaderStation` (`./targeting`) picks
 *    the strongest rival *from what this bot has scouted*, which is a guess, and
 *    is meant to be: "a global HP scoreboard would let everyone free-ride on
 *    every attack; fog makes third-party awareness a skill" (GDD §2.2). Several
 *    Medium bots converging on the same guess is the emergent alliance GDD §2.6
 *    describes — "why being the leader is dangerous" — with no alliance protocol
 *    anywhere in the code.
 */

import { UpgradeTrack } from '@shared/types';
import { nextUpgradeCost } from '../sim';
import type { DefencePlan, Purchase } from './behaviors';
import {
  RETREAT_CLEAR_RANGE,
  attack,
  corneredBlockader,
  coreUnderFinalAssault,
  defendAlly,
  defendHome,
  haulHome,
  homeErrand,
  hunt,
  fightBlockade,
  lastStandDefend,
  mine,
  nearestThreat,
  order,
  rebuildOrder,
  retreat,
  roam,
  scavenge,
  spendAtHome,
  upgrade,
  wantsCorePatch,
  wantsCorneredFight,
  wantsHomeErrand,
  wantsRetreat,
  wantsAllyDefence,
  wantsToHaul,
} from './behaviors';
import { NEUTRAL } from './steering';
import {
  bestRock,
  homeIntruder,
  isWounded,
  leaderStation,
  nearestEnemy,
  nearestLivingRival,
  scoreStation,
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
  const station = ctx.self.station;
  if (!station) return null;
  const spendable = ctx.self.spendable;

  // Repair, gated on the sim's real 15-second cooldown rather than the tell that
  // releases at half of it (p15-02, `wantsCorePatch`).
  if (wantsCorePatch(ctx, MEDIUM_REPAIR_AT)) return order('repair');

  // Guns, then the bubble — queued jobs counted BY KIND, so a shield in progress
  // no longer stalls a turret rebuild (`rebuildOrder`, p15-02).
  const rebuild = rebuildOrder(ctx, mediumDefence(ctx));
  if (rebuild) return rebuild;

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

/**
 * What a Medium bot keeps standing at home (GDD §2.6 — bounded defence, then the
 * ship). **No radar satellite:** Medium's whole read is that it stops turtling at
 * two turrets and buys the *ship* instead, and a 6-ore sensor is the cargo tier
 * and the power tier it would rather have. The dish belongs to Hard, the tier
 * that thinks about the whole board (`./hard` `hardDefence`).
 */
export function mediumDefence(_ctx: BotCtx): DefencePlan {
  return { turrets: MEDIUM_TURRET_TARGET, shields: MEDIUM_SHIELD_TARGET, satellites: 0 };
}

/** The ladder a Medium bot climbs, in order (GDD §2.5). TUNABLE */
export const MEDIUM_UPGRADE_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Cargo,
  UpgradeTrack.Power,
  UpgradeTrack.Speed,
  UpgradeTrack.Engine,
];

/**
 * What a Medium bot picks a fight with: the leader's home if it can see one
 * worth cracking, otherwise whatever enemy ship is nearest. The leader guess
 * comes from scouting only, so a bot that has been mining all match with its
 * back to the field will guess wrong — and that is the design (GDD §2.2).
 */
export function mediumTarget(ctx: BotCtx): TargetScore | null {
  const leader = leaderStation(ctx);
  if (leader && leader.distance - leader.radius <= ctx.view.perception.visualRange) {
    const scored = scoreStation(ctx, leader);
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

  // A core under final assault outranks self-preservation (v0.2.2 field report):
  // above the retreat, and the one thing that interrupts a committed one.
  when('last-stand', (ctx) => coreUnderFinalAssault(ctx), (ctx) => lastStandDefend(ctx)),

  // Cornered: the road home runs through the ship that is scaring it (developer
  // report p15, ratified). Fear says back off, home says come through, and the
  // two cancel on the line between them — so the bot stops asking and FIGHTS,
  // for a committed window with its nerve switched off (`./cornered`). Above the
  // retreat, because it is the branch that says the retreat does not exist.
  when(
    'cornered-fight',
    (ctx) => wantsCorneredFight(ctx),
    (ctx) => {
      const blockader = corneredBlockader(ctx);
      return blockader ? fightBlockade(ctx, blockader) : null;
    },
  ),

  // Breaks off wounded, and *stays* broken off — the retreat is latched so it
  // cannot flap between fleeing and re-engaging (`./commitment`; v0.2.2 field
  // report). Until the field is spent, when there is no hold left to save and a
  // respawn is free (GDD §2.3, §2.7) and `wantsRetreat` switches off. See `./hard`.
  when(
    'retreat',
    (ctx) => wantsRetreat(ctx),
    (ctx) => retreat(ctx, nearestThreat(ctx, RETREAT_CLEAR_RANGE)),
  ),

  // Answers the alarm — until collapse, when guarding a core that can no longer
  // be repaired only costs the damage race (see `./hard` for the full argument).
  when(
    'defend',
    (ctx) => {
      const station = ctx.self.station;
      if (!station || !station.alive || ctx.view.collapsed) return false;
      return station.underAttack || homeIntruder(ctx) !== null;
    },
    (ctx) => defendHome(ctx),
  ),

  // **Answer a teammate's alarm** (`docs/team-bots-plan.md` Stage 2; the
  // developer, 2026-08-07: *"enemies on teams should try to defend their
  // teammates bases when under attack (if they are under threat as well) …
  // same thing for bots on your team"*).
  //
  // Its position in this list IS the design. Below `last-stand`,
  // `cornered-fight`, `retreat` and this bot's own `defend`, so **my home
  // outranks yours** — the alarm rings for the team, the ladder stays
  // selfish-first. Above `spend`, so a teammate under siege beats a shopping
  // trip. In FFA the branch cannot fire at all: a teams-of-one side has no
  // allies, so `wantsAllyDefence` returns on an empty roster (plan §2.5).
  when('defend-ally', (ctx) => wantsAllyDefence(ctx), (ctx) => defendAlly(ctx)),

  when('spend', () => true, (ctx) => spendAtHome(ctx, mediumSpendPlan)),

  when('haul', (ctx) => wantsToHaul(ctx), (ctx) => haulHome(ctx)),

  // Go home ON PURPOSE to patch the core or replace a lost structure (p15-02) —
  // the errand a bot that only ever spent while docked-for-something-else did not
  // have. Ranged by `homebody`, so Patch crosses the map for it and Foreman does
  // not (`wantsHomeErrand`); a core under its ration calls either one home from
  // anywhere, because a core is the win condition (GDD §1).
  when(
    'fix-base',
    (ctx) => wantsHomeErrand(ctx, MEDIUM_REPAIR_AT, mediumDefence(ctx)),
    (ctx) => homeErrand(ctx),
  ),

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

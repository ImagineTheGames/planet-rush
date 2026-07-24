/**
 * src/bots/hard.ts — the Hard tree. OWNER: Bot Engineer (GDD §2.9).
 *
 * > **Hard** plays like a good human: it evaluates targets by *threat,
 * > proximity, and opportunity* — it punishes whoever it can profitably punish
 * > (the miner far from home, the planet whose alarm went unanswered, the wreck
 * > nobody is guarding), times attacks to when you're seen mining far from home,
 * > and scavenges kill sites.
 *
 * Everything in that paragraph is one scoring function (`./targeting`) and one
 * priority list. What makes it *hard* rather than *cheating* is worth stating,
 * because it is the line GDD §2.9 draws and this file is where it would be
 * crossed:
 *
 *  - It sees exactly what Easy sees. Same `BotView`, same `SENSOR_RANGE`, same
 *    `null` where a core has not been scouted. A Hard bot that knows you are
 *    wounded flew over and looked.
 *  - It decides more often (`reactionInterval` 1/20 s), aims straighter
 *    (`aimJitter` 0.02), holds its nerve longer (`retreatHullFraction` 0.2), and
 *    forgets more slowly (`memorySeconds` 20). Four competence knobs, no
 *    information knobs.
 *  - The *only* thing it does that the other tiers do not is **think about the
 *    whole board**: it compares a wounded miner against an unguarded core
 *    against a fresh wreck, on one scale, every fiftieth of a second.
 *
 * The three Hard characters read differently out of the same tree because the
 * weights lean the same score: Sable (opportunism 0.9) chases the punishable,
 * Vulture (scavenge 1.0) takes the wreck first, Warden (homebody 1.0) treats the
 * space around its planet as its own.
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
  suppressTurrets,
  upgrade,
  wantsToHaul,
} from './behaviors';
import { NEUTRAL } from './steering';
import { bestRock, bestTarget, homeIntruder, isWounded, nearestLivingRival } from './targeting';
import type { BotCtx, Node } from './tree';
import { selector, when } from './tree';

/** A target has to be worth the trip before a Hard bot abandons the economy for
 *  it. Below this it keeps mining, which is usually the right answer (GDD §2.3:
 *  the triangle is a trade, not a preference). TUNABLE */
export const HARD_ATTACK_FLOOR = 0.34;

/** Turrets a Hard bot keeps at home. Deliberately few: it defends with the ship
 *  and spends the difference on the ship (GDD §2.6). TUNABLE */
export const HARD_TURRET_TARGET = 2;
/** Shields it keeps once the guns are up. TUNABLE */
export const HARD_SHIELD_TARGET = 1;
/** Core fraction below which it spends a trip home on repairs. TUNABLE */
export const HARD_REPAIR_AT = 0.75;

/**
 * The ladder a Hard bot climbs, in order (GDD §2.5). Beam leads because it is
 * the one stat that pays twice — "mining speed and weapon damage — one beam, one
 * stat" — so every tier of it shortens both the trip to a full hold and the time
 * to kill whoever interrupts it. TUNABLE
 */
export const HARD_UPGRADE_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Beam,
  UpgradeTrack.Cargo,
  UpgradeTrack.Engine,
  UpgradeTrack.Hull,
];

/**
 * The wallet of a bot that intends to still be dangerous at the collapse phase:
 * a working minimum of defence, then the ship, then the bank. It repairs only
 * when nothing is hitting the planet, because "a defender cannot out-repair an
 * attacker who keeps shooting" (GDD §2.6) — the ore would be thrown away.
 */
export function hardSpendPlan(ctx: BotCtx): Purchase | null {
  const planet = ctx.self.planet;
  if (!planet) return null;
  const spendable = ctx.self.spendable;

  // Under siege right now: a turret is the only purchase that helps, and only
  // if there is a slot for it. Everything else waits.
  if (planet.underAttack) {
    if (planet.turrets + planet.builds < TURRET.capPerPlanet && spendable >= TURRET.cost) {
      return order('turret');
    }
    return null;
  }

  if (planet.turrets + planet.builds < HARD_TURRET_TARGET && spendable >= TURRET.cost) return order('turret');

  if (
    !ctx.view.collapsed &&
    !planet.repairing &&
    planet.coreHp < planet.maxCoreHp * HARD_REPAIR_AT &&
    spendable >= 2
  ) {
    return order('repair');
  }

  if (
    planet.turrets >= 1 &&
    planet.shields + planet.builds < HARD_SHIELD_TARGET &&
    spendable >= SHIELD.cost
  ) {
    return order('shield');
  }

  for (const track of HARD_UPGRADE_ORDER) {
    const cost = nextUpgradeCost(ctx.self, track);
    if (cost !== null && spendable >= cost) return upgrade(track);
  }

  if (ctx.self.cargo > 1e-9) return order('bank');
  return null;
}

/**
 * The score a target must clear before the bot leaves the economy for it —
 * **zero once the field is spent**. In the collapse phase there is no new ore,
 * no repair and no regeneration (GDD §2.3): a hold of ore buys almost nothing, a
 * lost hull costs five free seconds, and the only number still moving is core
 * HP. A bot that kept weighing "is this fight worth it?" against an economy that
 * no longer exists would be playing the wrong game.
 */
export function hardAttackFloor(ctx: BotCtx): number {
  return ctx.view.collapsed ? 0 : HARD_ATTACK_FLOOR;
}

/** Does this bot's character send it to the wreck first? The scavenge dial:
 *  Vulture (1.0) always, Sable and Foreman (0.5) when it is on the way, Rusty
 *  (0.2) rarely. TUNABLE */
export const SCAVENGE_COMMIT = 0.6;

/** The Hard tree (GDD §2.9). */
export const hardTree: Node = selector('hard', [
  when('dead', (ctx) => !ctx.self.alive, () => NEUTRAL),

  // Hard holds its nerve to 20% hull — and then leaves, because a dead ship
  // drops half its hold to the player who just earned it (GDD §2.7). Once the
  // field is spent there is no hold worth saving and a respawn is free, so the
  // branch switches off and the bot fights to the end.
  when(
    'retreat',
    (ctx) => !ctx.view.collapsed && isWounded(ctx) && incomingThreat(ctx) !== null,
    (ctx) => retreat(ctx, incomingThreat(ctx)),
  ),

  // Home comes first, but only when home is actually being hit — a Hard bot does
  // not sit on its doorstep waiting for something that is not coming.
  //
  // And **not once the field is spent.** In collapse there is no repair and no
  // regeneration (GDD §2.3), so a core only ever goes down: the endgame is a
  // damage race, and a player who spends it guarding cannot win it — every
  // second on defence is a second not spent on the rival's core, while the
  // attacker they just killed respawns free five seconds later (GDD §2.7). Two
  // bots that both understand this trade cores until one falls, which is how the
  // endgame is supposed to read (GDD §2.6: "the endgame belongs to whoever
  // managed the clock best") — and, not incidentally, why a match of them ends.
  when(
    'defend',
    (ctx) => {
      const planet = ctx.self.planet;
      if (!planet || !planet.alive || ctx.view.collapsed) return false;
      return planet.underAttack || homeIntruder(ctx) !== null;
    },
    (ctx) => defendHome(ctx),
  ),

  when('spend', () => true, (ctx) => spendAtHome(ctx, hardSpendPlan)),

  when('haul', (ctx) => wantsToHaul(ctx), (ctx) => haulHome(ctx)),

  // "scavenges kill sites" — for the characters whose dial says so, before they
  // look for a fight. A wreck nobody is guarding is free ore (GDD §2.7).
  when(
    'scavenge',
    (ctx) => ctx.weights.scavenge >= SCAVENGE_COMMIT,
    (ctx) => scavenge(ctx),
  ),

  // The paragraph, executed: score every visible ship and home by threat,
  // proximity and opportunity, take the best one if it clears the floor, and
  // strip the guns off a planet before going for its core (GDD §2.6).
  when(
    'attack',
    (ctx) => bestTarget(ctx, hardAttackFloor(ctx)) !== null,
    (ctx) => {
      const target = bestTarget(ctx, hardAttackFloor(ctx));
      if (!target) return null;
      if (target.kind === 'planet') {
        const suppress = suppressTurrets(ctx, target);
        if (suppress) return suppress;
      }
      return attack(ctx, target);
    },
  ),

  // Collapse, and nothing in sight: go and find the last rival (`./behaviors`).
  // Above the economy, because by now there is no economy (GDD §2.3).
  when('hunt', (ctx) => ctx.view.collapsed, (ctx) => hunt(ctx, nearestLivingRival(ctx))),

  when('mine', () => true, (ctx) => mine(ctx, bestRock(ctx))),

  // Ore under the nose, for the characters that did not commit to a kill site.
  when('scavenge-opportunist', () => true, (ctx) => scavenge(ctx)),

  when('roam', () => true, (ctx) => roam(ctx)),
]);

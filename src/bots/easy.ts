/**
 * src/bots/easy.ts — the Easy tree. OWNER: Bot Engineer (GDD §2.9).
 *
 * > **Easy** mines slowly, over-defends, attacks rarely, retreats at half hull.
 *
 * Four clauses, and the tree below is those four clauses in priority order:
 *
 *  - **retreats at half hull** — the tier's `retreatHullFraction` is 0.5, and
 *    the retreat branch sits second, under nothing but "am I alive". A neutral
 *    Easy character therefore breaks off at exactly half hull, which is the one
 *    number in GDD §2.9 that reads like a spec (`./targeting`).
 *  - **over-defends** — the defend branch outranks every economic one, and the
 *    spending plan buys three turrets and a shield before it will consider a
 *    ship upgrade. An Easy bot is safe and poor.
 *  - **attacks rarely** — there is no seek-and-destroy branch at all. The only
 *    way an Easy bot shoots a player is if that player came to it, or (for a
 *    character with a real attack weight, i.e. Bolt) wandered into plain sight.
 *  - **mines slowly** — no slow-mining knob: the tier's fat `aimJitter` wobbles
 *    the weapon across the rock, so the trigger is on target a fraction of the
 *    time a Hard bot's is (`./behaviors`).
 *
 * What this adds up to for a first-time player: an opponent that fills a slot,
 * defends its home convincingly, and loses.
 */

import { UpgradeTrack } from '@shared/types';
import { SHIELD, TURRET } from '../sim';
import type { Purchase } from './behaviors';
import {
  defendHome,
  engage,
  haulHome,
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
import { WEAPON_RANGE, NEUTRAL } from './steering';
import { bestRock, homeIntruder, isWounded, nearestEnemy } from './targeting';
import type { BotCtx, Node } from './tree';
import { selector, when } from './tree';

/**
 * Over-defence, priced. Three turrets and a shield come before anything that
 * makes the *ship* better, which is why an Easy bot is hard to kill at home and
 * harmless anywhere else (GDD §2.6: "an undefended planet falls to a determined
 * siege; a defended planet is nearly uncrackable one-on-one").
 */
export function easySpendPlan(ctx: BotCtx): Purchase | null {
  const planet = ctx.self.planet;
  if (!planet) return null;
  const spendable = ctx.self.spendable;

  // Patch the core when nothing is hitting it — repair interrupts on any damage
  // (GDD §2.5), so opening the channel mid-siege just wastes ore.
  if (
    !ctx.view.collapsed &&
    !planet.repairing &&
    !planet.underAttack &&
    planet.coreHp < planet.maxCoreHp - 1 &&
    spendable >= 1
  ) {
    return order('repair');
  }

  // Guns, then the bubble. Jobs in progress count against the target so a bot
  // does not queue four turrets in four consecutive decisions.
  if (planet.turrets + planet.builds < EASY_TURRET_TARGET && spendable >= TURRET.cost) return order('turret');
  if (planet.shields + planet.builds < EASY_SHIELD_TARGET && spendable >= SHIELD.cost) return order('shield');

  // Held ore is not safe ore (GDD §2.3). Bank before flying out again.
  if (ctx.self.cargo > 1e-9) return order('bank');

  // Fully turtled and still rich: widen the hold, so the next trip is worth more.
  if (spendable >= EASY_UPGRADE_FLOOR) return upgrade(UpgradeTrack.Cargo);
  return null;
}

/** Turrets an Easy bot wants before it thinks about anything else. TUNABLE */
export const EASY_TURRET_TARGET = 3;
/** Shield generators it wants after the guns. TUNABLE */
export const EASY_SHIELD_TARGET = 1;
/** Ore it must be sitting on before it will spend on its ship. TUNABLE */
export const EASY_UPGRADE_FLOOR = 10;

/** An Easy character only goes looking for a fight if the design gave it one —
 *  Bolt, "reckless rusher" — and even then only at what it can already see. */
export const EASY_ATTACK_WEIGHT = 0.4;

/** The Easy tree (GDD §2.9). Read top to bottom: that is the bot's priorities. */
export const easyTree: Node = selector('easy', [
  // Dead and waiting on the respawn clock: hands still, like a human watching it.
  when('dead', (ctx) => !ctx.self.alive, () => NEUTRAL),

  // "retreats at half hull" — above everything except being alive.
  when(
    'retreat',
    (ctx) => isWounded(ctx) && incomingThreat(ctx) !== null,
    (ctx) => retreat(ctx, incomingThreat(ctx)),
  ),

  // "over-defends": the alarm outranks the economy, always.
  when(
    'defend',
    (ctx) => {
      const planet = ctx.self.planet;
      return planet !== null && planet.alive && (planet.underAttack || homeIntruder(ctx) !== null);
    },
    (ctx) => defendHome(ctx),
  ),

  // At the wheel with something worth buying.
  when('spend', () => true, (ctx) => spendAtHome(ctx, easySpendPlan)),

  // Hold full enough: take it home. Easy characters run shallow holds.
  when('haul', (ctx) => wantsToHaul(ctx), (ctx) => haulHome(ctx)),

  // "attacks rarely": only a character with a real attack weight, and only at
  // something already in front of it.
  when(
    'potshot',
    (ctx) =>
      ctx.weights.triangle.attack >= EASY_ATTACK_WEIGHT &&
      !isWounded(ctx) &&
      nearestEnemy(ctx) !== null,
    (ctx) => {
      const target = nearestEnemy(ctx);
      return target ? engage(ctx, target.pos, 16, WEAPON_RANGE * 0.6) : null;
    },
  ),

  // The day job.
  when('mine', () => true, (ctx) => mine(ctx, bestRock(ctx))),

  // Free ore on the floor is still ore.
  when('scavenge', () => true, (ctx) => scavenge(ctx)),

  // Nothing in sight: drift toward where the next wave lands.
  when('roam', () => true, (ctx) => roam(ctx)),
]);

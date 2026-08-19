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
import type { DefencePlan, Purchase } from './behaviors';
import {
  RETREAT_CLEAR_RANGE,
  corneredBlockader,
  coreUnderFinalAssault,
  defendAlly,
  defendHome,
  engage,
  haulHome,
  fightBlockade,
  homeErrand,
  joinAssault,
  lastStandDefend,
  mine,
  nearestThreat,
  order,
  rebuildOrder,
  retreat,
  roam,
  scavenge,
  spendAtHome,
  turnAndFight,
  upgrade,
  wantsCorePatch,
  wantsCorneredFight,
  wantsHomeErrand,
  wantsRetreat,
  wantsAllyDefence,
  wantsJoinAssault,
  wantsToHaul,
  wantsTurnAndFight,
} from './behaviors';
import { WEAPON_RANGE, NEUTRAL } from './steering';
import { bestRock, homeIntruder, isWounded, nearestEnemy } from './targeting';
import type { BotCtx, Node } from './tree';
import { selector, when } from './tree';

/**
 * Over-defence, priced. Three turrets and a shield come before anything that
 * makes the *ship* better, which is why an Easy bot is hard to kill at home and
 * harmless anywhere else (GDD §2.6: "an undefended station falls to a determined
 * siege; a defended station is nearly uncrackable one-on-one").
 */
export function easySpendPlan(ctx: BotCtx): Purchase | null {
  const station = ctx.self.station;
  if (!station) return null;
  const spendable = ctx.self.spendable;

  // Patch the core when nothing is hitting it — a besieged core cannot be
  // out-repaired (GDD §2.6), so spending under fire just wastes ore. RATIONED,
  // not topped to full: even timid Rusty stops short of the ceiling so a field
  // of turtles does not reach collapse at one identical HP (`repairTargetFraction`,
  // p5-repair-discrete). Rusty (caution 1.3) patches early; Bolt (0.5) rarely.
  // The whole gate now lives in `wantsCorePatch`, which also refuses a press the
  // sim's 15-second cooldown would throw away (p15-02).
  if (wantsCorePatch(ctx, EASY_REPAIR_AT)) return order('repair');

  // Guns, then the bubble. Queued jobs count against the target BY KIND, so a
  // shield fifteen seconds from done can no longer read as a turret already on
  // order and stall a rebuild (`rebuildOrder`, p15-02).
  const rebuild = rebuildOrder(ctx, easyDefence(ctx));
  if (rebuild) return rebuild;

  // Held ore is not safe ore (GDD §2.3). Bank before flying out again.
  if (ctx.self.cargo > 1e-9) return order('bank');

  // Fully turtled and still rich: widen the hold, so the next trip is worth more.
  if (spendable >= EASY_UPGRADE_FLOOR) return upgrade(UpgradeTrack.Cargo);
  return null;
}

/**
 * What an Easy bot keeps standing at home: three guns and a bubble, and **no
 * radar satellite**. Easy is "safe and poor" — its documented ladder is guns,
 * bubble, hold (`./easy.test.ts`), and a 6-ore strategic sensor is two turrets it
 * would rather have. The dish belongs to the tier that plays the whole board
 * (`./hard` `hardDefence`).
 */
export function easyDefence(_ctx: BotCtx): DefencePlan {
  return { turrets: EASY_TURRET_TARGET, shields: EASY_SHIELD_TARGET, satellites: 0 };
}

/** Base core fraction below which an Easy bot patches its core, before the
 *  `caution` lean and the below-ceiling cap in `repairTargetFraction`. Was an
 *  effective ~0.99 (repair to full); dropped to a genuine ration so the discrete
 *  heal no longer pins every funded core on the `maxCoreHp` clamp — the collapse
 *  lockstep the soak caught (p5-repair-discrete). TUNABLE */
export const EASY_REPAIR_AT = 0.6;

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

  // A core under final assault outranks even an over-defender's own skin
  // (v0.2.2 field report): above the retreat, and interrupts a committed one.
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

  // "retreats at half hull" — above everything except being alive and the last
  // stand. Latched so it does not flap: once an Easy bot turns to run it commits
  // to the run until it has cleared the threat or respawned (`./commitment`;
  // v0.2.2 field report).
  when(
    'retreat',
    (ctx) => wantsRetreat(ctx),
    (ctx) => retreat(ctx, nearestThreat(ctx, RETREAT_CLEAR_RANGE)),
  ),

  // **The retreat that ends** (a0-105; the developer, 2026-08-19: *"he just
  // stayed in that same spot scared of me. ship lives are cheap. enemies should
  // not fear death"*). Directly BELOW the retreat, which is deliberate: the
  // retreat's own test is where the standoff is folded (`./standoff`), so it
  // must be evaluated every decision for the patience clock to run. When the
  // running has opened no ground for this character's own patience, `wantsRetreat`
  // stands down and this leaf takes the tick — the bot turns on its chaser with
  // its own turrets behind it (GDD §2.6).
  when('turn-and-fight', (ctx) => wantsTurnAndFight(ctx), (ctx) => turnAndFight(ctx)),

  // "over-defends": the alarm outranks the economy, always.
  when(
    'defend',
    (ctx) => {
      const station = ctx.self.station;
      return station !== null && station.alive && (station.underAttack || homeIntruder(ctx) !== null);
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

  // At the wheel with something worth buying.
  when('spend', () => true, (ctx) => spendAtHome(ctx, easySpendPlan)),

  // Hold full enough: take it home. Easy characters run shallow holds.
  when('haul', (ctx) => wantsToHaul(ctx), (ctx) => haulHome(ctx)),

  // Go home ON PURPOSE to patch the core or plug a hole in the ring (p15-02).
  // An over-defender that only ever spent when it happened to be docked was an
  // over-defender in name only: it carried the ore for the turret it needed
  // around the field instead (`wantsHomeErrand`). Below `haul`, because a full
  // hold is already flying the same way.
  when(
    'fix-base',
    (ctx) => wantsHomeErrand(ctx, EASY_REPAIR_AT, easyDefence(ctx)),
    (ctx) => homeErrand(ctx),
  ),

  // **Join a teammate's attack** (`docs/team-bots-plan.md` Stage 4; the
  // developer, 2026-08-07: *"…and equally should try to attack when team mates
  // go on offensive"*). Below `defend`, `defend-ally`, `haul` and `fix-base`, so
  // an over-defender still patches its own ring before it goes raiding — and
  // **above `potshot`**, because a called objective is a better use of a shot
  // than whatever happens to be in front of it.
  //
  // An Easy bot joins *badly*, and that is the design rather than a concession:
  // it misses a third of the calls, hears the rest 1.2 s late, and its teammate's
  // calls fall off the channel between sends (`./ally` `ASSAULT_JOIN_QUIET`).
  // Cooperation is a difficulty dial expressed through the existing latency and
  // miss model — there is no separate "be bad at teamwork" knob (plan §4.5).
  //
  // Easy never *opens* a raid, note: this tree has no station attack to announce
  // one from. It only ever answers a better bot's.
  when('join-assault', (ctx) => wantsJoinAssault(ctx), (ctx) => joinAssault(ctx)),

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

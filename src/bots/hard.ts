/**
 * src/bots/hard.ts — the Hard tree. OWNER: Bot Engineer (GDD §2.9).
 *
 * > **Hard** plays like a good human: it evaluates targets by *threat,
 * > proximity, and opportunity* — it punishes whoever it can profitably punish
 * > (the miner far from home, the station whose alarm went unanswered, the wreck
 * > nobody is guarding), times attacks to when you're seen mining far from home,
 * > and scavenges kill sites.
 *
 * Everything in that paragraph is one scoring function (`./targeting`) and one
 * priority list. What makes it *hard* rather than *cheating* is worth stating,
 * because it is the line GDD §2.9 draws and this file is where it would be
 * crossed:
 *
 *  - It sees exactly what Easy sees. Same `BotView`, same `visualRange`, same
 *    `null` where a core has not been scouted. A Hard bot that knows you are
 *    wounded flew over and looked.
 *  - It decides more often (`reactionInterval` 1/20 s), aims straighter (tightest
 *    spread `aimJitter` 0.05 and shortest lead-lag `aimLatency` 0.20 s — beatable,
 *    not an aimbot, since v0.2.2), holds its nerve longer (`retreatHullFraction`
 *    0.2), and forgets more slowly (`memorySeconds` 20). Competence knobs, no
 *    information knobs.
 *  - The *only* thing it does that the other tiers do not is **think about the
 *    whole board**: it compares a wounded miner against an unguarded core
 *    against a fresh wreck, on one scale, every fiftieth of a second.
 *
 * The three Hard characters read differently out of the same tree because the
 * weights lean the same score: Sable (opportunism 0.9) chases the punishable,
 * Vulture (scavenge 1.0) takes the wreck first, Warden (homebody 1.0) treats the
 * space around its station as its own.
 */

import { UpgradeTrack } from '@shared/types';
import { TURRET, nextUpgradeCost } from '../sim';
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
  satelliteTarget,
  scavenge,
  spendAtHome,
  suppressTurrets,
  upgrade,
  wantsCorePatch,
  wantsCorneredFight,
  wantsHomeErrand,
  wantsRetreat,
  wantsAllyDefence,
  wantsToHaul,
} from './behaviors';
import { NEUTRAL } from './steering';
import { bestRock, bestTarget, homeIntruder, nearestLivingRival } from './targeting';
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
 * What a Hard bot keeps standing at home: a working minimum of guns and one
 * bubble, plus — for the territorial half of the tier — a **radar satellite**.
 *
 * Hard is the tier that thinks about the whole board (see the file header), so it
 * is the tier that buys the board-scale sensor; `satelliteTarget` then leaves it
 * to the character, which among the Hard three means Warden and only Warden
 * (`homebody` 0.55, against Vulture's 0.4 and Sable's 0.2). Easy and Medium buy
 * guns and hulls instead, and say so in their own `*Defence`.
 */
export function hardDefence(ctx: BotCtx): DefencePlan {
  return {
    turrets: HARD_TURRET_TARGET,
    shields: HARD_SHIELD_TARGET,
    satellites: satelliteTarget(ctx),
  };
}

/**
 * The ladder a Hard bot climbs, in order (GDD §2.5). DAMAGE (`Power`) leads
 * because it is the one stat that pays twice — "mining speed and weapon damage —
 * one stat" — so every tier of it shortens both the trip to a full hold and the
 * time to kill whoever interrupts it. SPEED comes second, ahead of the economy
 * tracks: a Hard bot plays like a good human (GDD §2.9), and a good human buys
 * muzzle velocity early because a faster shot lands the damage it already has on
 * a strafing target the stock shot would miss (v0.2.2 field report — SPEED is
 * how a Hard bot "actually uses" the counterplay the projectile weapon created).
 * TUNABLE
 */
export const HARD_UPGRADE_ORDER: readonly UpgradeTrack[] = [
  UpgradeTrack.Power,
  UpgradeTrack.Speed,
  UpgradeTrack.Cargo,
  UpgradeTrack.Engine,
  UpgradeTrack.Hull,
];

/**
 * The wallet of a bot that intends to still be dangerous at the collapse phase:
 * a working minimum of defence, then the ship, then the bank. It repairs only
 * when nothing is hitting the station, because "a defender cannot out-repair an
 * attacker who keeps shooting" (GDD §2.6) — the ore would be thrown away.
 */
export function hardSpendPlan(ctx: BotCtx): Purchase | null {
  const station = ctx.self.station;
  if (!station) return null;
  const spendable = ctx.self.spendable;

  // Under siege right now: a turret is the only purchase that helps, and only
  // if there is a slot for it. Everything else waits. Queued turrets counted BY
  // KIND (p15-02): a shield half-built used to read as a gun already on order, at
  // the exact moment the guns are the only thing that helps.
  if (station.underAttack) {
    if (station.turrets + station.turretsBuilding < TURRET.capPerStation && spendable >= TURRET.cost) {
      return order('turret');
    }
    return null;
  }

  // Guns first, then the patch, then the bubble and (for a homesteader) the
  // sensor — a Hard bot plugs a hole in its ring before it heals, because the
  // ring is what stops the next hole (GDD §2.6). `rebuildOrder` is asked twice
  // for exactly that: once for the turrets it puts at the head of the list, once
  // for everything behind the repair.
  const guns = rebuildOrder(ctx, { turrets: HARD_TURRET_TARGET, shields: 0, satellites: 0 });
  if (guns) return guns;

  if (wantsCorePatch(ctx, HARD_REPAIR_AT)) return order('repair');

  const rebuild = rebuildOrder(ctx, hardDefence(ctx));
  if (rebuild) return rebuild;

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
 *
 * Below that, the tier's appetite divides it (`DifficultyTuning.aggression`,
 * ratified p15 point 3 — "HARD bots seek the fight more"): a hungrier tier
 * prices the same target as worth the trip sooner. A no-op at 1.0, which is
 * where Easy and Medium stay.
 */
export function hardAttackFloor(ctx: BotCtx): number {
  return ctx.view.collapsed ? 0 : HARD_ATTACK_FLOOR / ctx.tuning.aggression;
}

/** Does this bot's character send it to the wreck first? The scavenge dial:
 *  Vulture (1.0) always, Sable and Foreman (0.5) when it is on the way, Rusty
 *  (0.2) rarely. TUNABLE */
export const SCAVENGE_COMMIT = 0.6;

/** The Hard tree (GDD §2.9). */
export const hardTree: Node = selector('hard', [
  when('dead', (ctx) => !ctx.self.alive, () => NEUTRAL),

  // The priority exception (v0.2.2 field report): a core under final assault
  // outranks self-preservation, so it sits *above* the retreat and is the one
  // thing allowed to interrupt a committed one. A territorial Hard bot dies on
  // its own doorstep rather than saving a hull that respawns free (GDD §2.7).
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

  // Hard holds its nerve to 20% hull — and then leaves, because a dead ship
  // drops half its hold to the player who just earned it (GDD §2.7). The break
  // off is *latched* (`./commitment`): once committed it keeps fleeing until it
  // has cleared the threat or respawned, so a wounded bot never twitches between
  // fleeing and re-engaging (the v0.2.2 field report's exact bug). Once the field
  // is spent there is no hold worth saving and a respawn is free, so `wantsRetreat`
  // switches the whole thing off and the bot fights to the end.
  when(
    'retreat',
    (ctx) => wantsRetreat(ctx),
    (ctx) => retreat(ctx, nearestThreat(ctx, RETREAT_CLEAR_RANGE)),
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
  // strip the guns off a station before going for its core (GDD §2.6).
  when(
    'attack',
    (ctx) => bestTarget(ctx, hardAttackFloor(ctx)) !== null,
    (ctx) => {
      const target = bestTarget(ctx, hardAttackFloor(ctx));
      if (!target) return null;
      if (target.kind === 'station') {
        const suppress = suppressTurrets(ctx, target);
        if (suppress) return suppress;
      }
      return attack(ctx, target);
    },
  ),

  // Go home ON PURPOSE to patch the core (p15-02) — the errand a bot that only
  // ever spent while docked-for-something-else did not have. Two deliberate
  // narrowings, and both are the same sentence of GDD §2.9: *a Hard bot plays
  // like a good human.*
  //
  //  - **The core only** (`null` plan — see `wantsHomeErrand`). A good human
  //    swings home to patch the thing that ends the match, and replaces a shot-off
  //    turret on the next trip home rather than flying one for it; the spend plan
  //    already rebuilds the ring every time this bot docks for any reason.
  //  - **Below the attack.** A target that has already cleared `hardAttackFloor`
  //    is by construction worth more than an errand. Both narrowings are also
  //    measured: with either one dropped, an all-Hard cast turns *inward* enough
  //    to move the standing appetite A/B in `tests/harness/player-aggression.test.ts`.
  when(
    'fix-base',
    (ctx) => wantsHomeErrand(ctx, HARD_REPAIR_AT, null),
    (ctx) => homeErrand(ctx),
  ),

  // Collapse, and nothing in sight: go and find the last rival (`./behaviors`).
  // Above the economy, because by now there is no economy (GDD §2.3).
  when('hunt', (ctx) => ctx.view.collapsed, (ctx) => hunt(ctx, nearestLivingRival(ctx))),

  when('mine', () => true, (ctx) => mine(ctx, bestRock(ctx))),

  // Ore under the nose, for the characters that did not commit to a kill site.
  when('scavenge-opportunist', () => true, (ctx) => scavenge(ctx)),

  when('roam', () => true, (ctx) => roam(ctx)),
]);

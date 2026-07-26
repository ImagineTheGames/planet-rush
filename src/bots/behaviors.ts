/**
 * src/bots/behaviors.ts — the verbs all three trees share. OWNER: Bot Engineer
 * (GDD §2.3, §2.5, §2.9).
 *
 * The triangle is mine / defend / attack (GDD §2.3), and every tier does all
 * three — the tiers differ in *when* and *how well*, not in what they know how
 * to do. So the verbs live here once: mine a rock, haul it home, spend at the
 * wheel, guard the doorstep, close on a target, break off, scavenge a kill site.
 * `./easy`, `./medium` and `./hard` are then almost entirely priority order,
 * which is the part a reader should be able to argue with.
 *
 * Every function returns `Action`s (via `./steering`) or `null` to pass, and
 * reads nothing but its {@link BotCtx}. There is no path from here to the world.
 */

import type { Action, BuildItem, ThrustAction, UpgradeTrack, Vec2 } from '@shared/types';
import { BEAM_RANGE, PLANET, SHIELD, TURRET } from '../sim';
import type { PerceivedShip } from './perception';
import {
  ARRIVE_RADIUS,
  aimAt,
  arrive,
  boost,
  canHit,
  clampUnit,
  dist,
  dodge,
  fire,
  flee,
  orbit,
  pursue,
  rotate,
  standOff,
  thrust,
  toward,
} from './steering';
import { homeIntruder, isEngageable } from './targeting';
import type { TargetScore } from './targeting';
import { STUCK_DECISIONS } from './tree';
import type { BotCtx } from './tree';

// ---------------------------------------------------------------------------
// Distances the trees fly at. All TUNABLE, all owned by this agent.
// ---------------------------------------------------------------------------

/** How far off a rock a bot parks to mine it. Inside beam range with margin,
 *  and inside tractor range of the chunks it cracks loose, so the ore drifts to
 *  the miner instead of being left for whoever passes (GDD §2.3). TUNABLE */
export const MINE_STANDOFF = BEAM_RANGE * 0.45;

/** The ring a defender holds around its own planet: outside the core body,
 *  comfortably inside its turrets' range, so ship and turrets focus the same
 *  attacker (GDD §2.6 — "two beats one", and the defender counts). TUNABLE */
export const GUARD_RADIUS = PLANET.radius + 70;

/** Station-keeping ring while docked and spending. Inside `PLANET.dockRange`,
 *  so the wheel stays live and a repair channel is not broken by drift. TUNABLE */
export const DOCK_RADIUS = PLANET.radius + 45;

/** Stand-off for picking a turret apart: past its range (240), inside the beam's
 *  (260). That twenty-unit window *is* GDD §2.6's "a patient attacker can pick
 *  off turrets from the edge of their range" — it only exists because the beam
 *  out-ranges the turret, and flying it is a skill a Hard bot has. TUNABLE */
export const TURRET_STANDOFF = (TURRET.range + BEAM_RANGE) / 2;

/** Stand-off for beaming a core or shield bubble. Measured centre-to-centre, so
 *  it must clear the bubble (90) and stay inside beam range. TUNABLE */
export const SIEGE_STANDOFF = (SHIELD.radius + BEAM_RANGE) / 2;

/** Speed at which a bot chasing something leans on the boost button. TUNABLE */
export const BOOST_CHASE_DISTANCE = 320;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Every thrust a tree emits goes through here: the desired direction, curved
 * around anything solid in front of it (`dodge` in `./steering`).
 *
 * Asteroids and planets are solid bodies that stop a ship dead, so "fly at the
 * target" is not a navigation policy — it is a way to get wedged against a rock
 * with the collision response cancelling exactly the thrust the bot keeps
 * asking for. One place, so no branch can forget.
 *
 * `ignoreRock` exempts the rock a miner is deliberately parked against: it is
 * the destination, not an obstacle.
 */
export function go(ctx: BotCtx, want: ThrustAction, ignoreRock?: number): ThrustAction {
  const dir = want.dir;
  if (dir.x === 0 && dir.y === 0) return want;

  // **One** obstacle, not all of them. Summing a dodge per rock reads like the
  // obvious generalisation and is much worse: the late waves land in a tight
  // cluster (GDD §2.3), thirty overlapping pushes cancel into noise, and the bot
  // shivers in place instead of going around. So: the most urgent body wins, and
  // the ship commits to sliding past that one.
  let worstPos: Vec2 | null = null;
  let worstRadius = 0;
  let worstSlack = Number.POSITIVE_INFINITY;
  for (const rock of ctx.view.asteroids) {
    if (rock.id === ignoreRock) continue;
    const slack = rock.distance - rock.radius;
    if (slack < worstSlack) {
      worstSlack = slack;
      worstPos = rock.pos;
      worstRadius = rock.radius;
    }
  }
  for (const planet of ctx.view.planets) {
    const slack = planet.distance - planet.radius;
    if (slack < worstSlack) {
      worstSlack = slack;
      worstPos = planet.pos;
      worstRadius = planet.radius;
    }
  }
  const own = ctx.self.planet;
  if (own && own.distance - own.radius < worstSlack) {
    worstPos = own.pos;
    worstRadius = own.radius;
  }

  // Wedged: thrusting into a gap no hull fits through, with the collision
  // response cancelling exactly the thrust being asked for. Local avoidance
  // cannot fix this on its own — sliding one tick's worth around a rock puts the
  // ship back in front of the same gap on the next one — so the bot **commits**
  // to an escape heading for a fixed run, long enough to leave the cluster, and
  // re-plans from wherever that lands it. A wiggle would not do; the run has to
  // outlast the thing it is escaping.
  const brain = ctx.brain;
  if (brain.stuckFor >= STUCK_DECISIONS && ctx.view.time >= brain.escapeUntil) {
    const away = worstPos === null ? { x: -dir.x, y: -dir.y } : toward(worstPos, ctx.self.pos);
    // Away from the obstacle, thrown off to one side so the escape is a run
    // *past* it rather than a rebound into the same approach. The draw is the
    // bot's own seeded stream, so it stays deterministic and two bots wedged in
    // the same clump do not pick the same line out of it.
    brain.escapeDir = rotate(away, (brain.rng.next() * 2 - 1) * ESCAPE_SPREAD);
    brain.escapeUntil = ctx.view.time + ESCAPE_SECONDS;
    brain.stuckFor = 0;
  }
  const escaping = ctx.view.time < brain.escapeUntil;
  const steered = escaping
    ? brain.escapeDir
    : worstPos === null
      ? dir
      : dodge(ctx.self, dir, worstPos, worstRadius);

  const out = clampUnit(steered);
  ctx.brain.lastThrust = Math.sqrt(out.x * out.x + out.y * out.y);
  return thrust(out);
}

/** How long a wedged bot commits to its escape heading. Long enough to clear a
 *  late-wave asteroid cluster at cruise. TUNABLE */
export const ESCAPE_SECONDS = 1.5;

/** Half-angle the escape heading is thrown off "straight back". TUNABLE */
export const ESCAPE_SPREAD = Math.PI / 3;

// ---------------------------------------------------------------------------
// Purchases (GDD §2.5 — one wheel, five segments, and the panel behind one)
// ---------------------------------------------------------------------------

/** A single press: a wheel segment, or a row of the upgrade panel. */
export type Purchase =
  | { readonly kind: 'order'; readonly item: BuildItem }
  | { readonly kind: 'upgrade'; readonly track: UpgradeTrack };

/** Sugar for a wheel press. */
export function order(item: BuildItem): Purchase {
  return { kind: 'order', item };
}

/** Sugar for an upgrade-panel row press. */
export function upgrade(track: UpgradeTrack): Purchase {
  return { kind: 'upgrade', track };
}

/** The action a purchase becomes. One-shot: the sim acts on it for the tick it
 *  arrives in and never latches it, and the harness strips it from the stream a
 *  bot holds between decisions, so a press can never double-charge (`./harness`). */
export function purchaseAction(purchase: Purchase): Action {
  return purchase.kind === 'order'
    ? { type: 'buildOrder', item: purchase.item }
    : { type: 'upgradeOrder', track: purchase.track };
}

/**
 * Hold station at the wheel and make at most one purchase this decision.
 * `plan` is the character's spending policy — the one part of the economy that
 * differs sharply between tiers (Easy over-defends, Hard tools up), so it is a
 * parameter rather than a branch.
 *
 * Returns `null` when the bot is not docked or the plan wants nothing, so the
 * tree falls through to whatever it would rather be doing.
 */
export function spendAtHome(ctx: BotCtx, plan: (ctx: BotCtx) => Purchase | null): readonly Action[] | null {
  const planet = ctx.self.planet;
  if (!planet || !planet.alive || !ctx.self.docked) return null;
  // A stand-in never spends the ore it inherited — that is the dropped pilot's
  // to reclaim (GDD §4.2). Only what this bot has mined since it sat down lifts
  // `spendable` past its endowment; an opening bot's endowment is zero, so this
  // never stays the hand of a bot that earned its own start (`./tree`).
  if (ctx.self.spendable <= ctx.brain.endowment + 1e-9) return null;
  const purchase = plan(ctx);
  if (!purchase) return null;
  return [go(ctx, orbit(ctx.self, planet.pos, DOCK_RADIUS, 0.2)), fire(false), purchaseAction(purchase)];
}

// ---------------------------------------------------------------------------
// Mine (GDD §2.3)
// ---------------------------------------------------------------------------

/**
 * How full this bot runs before heading home — the `greed` dial made concrete
 * (GDD §2.3: "You decide how full to run: dart home early or risk hauling a full
 * hold"). Timid Rusty banks at two thirds; Vulture flies home with the hold
 * bursting.
 */
export function haulThreshold(ctx: BotCtx): number {
  return Math.max(1, ctx.self.cargoCap * (0.5 + 0.5 * ctx.weights.greed));
}

/** Is the hold full enough to be worth the trip home? */
export function wantsToHaul(ctx: BotCtx): boolean {
  return ctx.self.cargoFull || ctx.self.cargo >= haulThreshold(ctx) - 1e-9;
}

/**
 * Work the nearest worthwhile rock: park at {@link MINE_STANDOFF}, point the
 * beam at it, and hold the trigger only while the shot would actually land.
 *
 * The tier's `aimJitter` is what makes "Easy mines slowly" true without a
 * separate slow-mining knob: a wobbling nose crosses the rock intermittently, so
 * an Easy bot's beam is on target a fraction of the time a Hard bot's is. One
 * mechanism, visible competence, no cheat in either direction (GDD §2.9).
 */
export function mine(ctx: BotCtx, rock: { id: number; pos: Vec2; radius: number } | null): readonly Action[] | null {
  if (!rock) return null;
  if (ctx.self.cargoFull) return null;
  return [
    go(ctx, standOff(ctx.self, rock.pos, MINE_STANDOFF), rock.id),
    aimAt(ctx.self, rock.pos, ctx.tuning.aimJitter, ctx.rng),
    fire(canHit(ctx.self, rock.pos, rock.radius)),
  ];
}

// ---------------------------------------------------------------------------
// Haul and bank (GDD §2.3, §2.5)
// ---------------------------------------------------------------------------

/** Fly home with a load. Trigger up: a hauling bot lighting its beam is a bot
 *  advertising a full hold (GDD §2.2). */
export function haulHome(ctx: BotCtx): readonly Action[] | null {
  const planet = ctx.self.planet;
  if (!planet) return null;
  return [go(ctx, arrive(ctx.self, planet.pos, ARRIVE_RADIUS)), fire(false)];
}

// ---------------------------------------------------------------------------
// Defend (GDD §2.6)
// ---------------------------------------------------------------------------

/**
 * Answer the alarm: meet the intruder in front of your own turrets, or hold the
 * guard ring if there is nobody to meet. "Turrets deter; the ship defends … but
 * turrets fighting *alongside the defender's ship* focus fire and kill attackers
 * fast" (GDD §2.6) — which is why the defender fights *at home* rather than
 * chasing the attacker out into the dark.
 */
export function defendHome(ctx: BotCtx): readonly Action[] | null {
  const planet = ctx.self.planet;
  if (!planet) return null;
  const intruder = homeIntruder(ctx);
  if (!intruder) return [go(ctx, orbit(ctx.self, planet.pos, GUARD_RADIUS)), fire(false)];
  return engage(ctx, intruder.pos, 16, BEAM_RANGE * 0.6, intruder.vel);
}

// ---------------------------------------------------------------------------
// Attack (GDD §2.6, §2.9)
// ---------------------------------------------------------------------------

/**
 * Close to `range`, point the beam, and fire only when the shot lands. The
 * stand-off is the whole tactic: against a ship it is a knife fight, against a
 * turret it is {@link TURRET_STANDOFF} — outside the turret's reach and inside
 * the beam's (GDD §2.6).
 */
export function engage(ctx: BotCtx, pos: Vec2, radius: number, range: number, targetVel?: Vec2): readonly Action[] {
  const d = dist(ctx.self.pos, pos);
  const actions: Action[] = [
    go(ctx, standOff(ctx.self, pos, range)),
    // Lead a moving target so the projectile intercepts it (design amendment
    // v0.2); a still target (a turret, a core) has no velocity and the aim is
    // straight.
    aimAt(ctx.self, pos, ctx.tuning.aimJitter, ctx.rng, targetVel),
    fire(canHit(ctx.self, pos, radius, 0, targetVel)),
  ];
  // A bold character burns the boost closing the gap; a cautious one saves it
  // for the trip home. `caution` > 1 means "breaks off early" (`./personalities`).
  if (d > BOOST_CHASE_DISTANCE && ctx.weights.caution < 1) actions.push(boost(true));
  return actions;
}

/** Attack a scored target at the stand-off its kind deserves. */
export function attack(ctx: BotCtx, target: TargetScore): readonly Action[] {
  // A ship moves, so lead it (`target.vel`); a home does not, so the lead is a
  // straight shot (design amendment v0.2).
  if (target.kind === 'ship') return engage(ctx, target.pos, target.radius, BEAM_RANGE * 0.6, target.vel);
  return engage(ctx, target.pos, target.radius, SIEGE_STANDOFF);
}

/**
 * Take the turrets off a planet first, from outside their range — the patient
 * siege (GDD §2.6). Returns null when the bot cannot see any turret on the
 * target, which includes "it is too far away to count barrels": a bot that
 * cannot see the guns does not get to plan around them.
 */
export function suppressTurrets(ctx: BotCtx, target: TargetScore): readonly Action[] | null {
  const memo = ctx.memory.planet(target.id);
  if (!memo || memo.turrets === null || memo.turrets <= 0) return null;
  // Turrets ring the planet; the nearest arc of that ring is the first barrel.
  const out = toward(memo.pos, ctx.self.pos);
  const mount = PLANET.radius + TURRET.mountOffset;
  const barrel: Vec2 = { x: memo.pos.x + out.x * mount, y: memo.pos.y + out.y * mount };
  return engage(ctx, barrel, TURRET.radius, TURRET_STANDOFF);
}

// ---------------------------------------------------------------------------
// Break off (GDD §2.9)
// ---------------------------------------------------------------------------

/**
 * Get out. Home is the destination — it is where the turrets are — unless the
 * thing that hurt this bot is *already* at home, in which case running there is
 * running into it and the bot simply puts distance between them.
 *
 * The trigger stays up on the way out. A retreating bot that keeps firing is a
 * bot that keeps its beam pointed at the thing it is fleeing, and never gets
 * home.
 */
export function retreat(ctx: BotCtx, threat: PerceivedShip | null): readonly Action[] {
  const planet = ctx.self.planet;
  const threatAtHome = planet !== null && threat !== null && dist(threat.pos, planet.pos) < GUARD_RADIUS * 2;
  if (planet && !threatAtHome) return [go(ctx, arrive(ctx.self, planet.pos, ARRIVE_RADIUS)), fire(false)];
  if (threat) return [go(ctx, flee(ctx.self, threat.pos)), fire(false), boost(true)];
  return [thrust({ x: 0, y: 0 }), fire(false)];
}

/** The nearest thing that could be shooting at this bot right now. */
export function incomingThreat(ctx: BotCtx): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  for (const ship of ctx.view.ships) {
    if (!isEngageable(ship)) continue;
    if (ship.distance > BEAM_RANGE * 1.6) continue;
    if (best === null || ship.distance < best.distance) best = ship;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scavenge (GDD §2.7 — "ore-laden debris that *anyone* can scavenge")
// ---------------------------------------------------------------------------

/**
 * Fly onto loose ore: the chunks in view now, or the kill site this bot
 * remembers (`./memory`). The tractor does the collecting (GDD §2.3), so this is
 * only ever a flight plan — and it gives up on a remembered site once the bot
 * has flown there and found nothing, rather than orbiting an empty patch of
 * space for the rest of the match.
 */
export function scavenge(ctx: BotCtx): readonly Action[] | null {
  if (ctx.self.cargoFull) return null;

  let best: Vec2 | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const chunk of ctx.view.chunks) {
    if (chunk.distance < bestD) {
      bestD = chunk.distance;
      best = chunk.pos;
    }
  }
  if (best) return [go(ctx, pursue(ctx.self, best)), fire(false)];

  const site = ctx.memory.lootSite(ctx.tuning.memorySeconds);
  if (!site) return null;
  if (dist(ctx.self.pos, site.pos) < ctx.view.perception.visualRange * 0.25) {
    // Standing in the remembered spot with nothing in view: the ore is gone.
    ctx.memory.clearLoot();
    return null;
  }
  return [go(ctx, arrive(ctx.self, site.pos, ARRIVE_RADIUS)), fire(false)];
}

// ---------------------------------------------------------------------------
// The endgame (GDD §2.3 collapse, §2.6 "the economy is the siege engine of last
// resort")
// ---------------------------------------------------------------------------

/**
 * Collapse has arrived: no new ore, no repair, no regeneration (GDD §2.3). Ore
 * in the hold is nearly worthless, a lost hull costs five free seconds, and the
 * only score left is whose core outlasts whose. So a bot that can still fight
 * stops managing its economy and goes to find the last rival — a flight plan off
 * the one map-wide fact everybody has (`nearestLivingRival`).
 *
 * This is what stops two survivors turtling at opposite ends of the ring until
 * the harness timeout. The match "cannot stalemate" is a promise the *ruleset*
 * makes (GDD §2.3); this is the bots keeping their half of it.
 */
export function hunt(ctx: BotCtx, rival: { pos: Vec2; radius: number } | null): readonly Action[] | null {
  if (!rival) return null;
  return [go(ctx, arrive(ctx.self, rival.pos, ARRIVE_RADIUS)), fire(false)];
}

// ---------------------------------------------------------------------------
// Roam
// ---------------------------------------------------------------------------

/**
 * Nothing to do: go where the ore will be. Every wave lands closer to the map
 * centre than the last (GDD §2.3), so the centre is the correct default answer
 * to "where should I be?" for the whole match — and being early to a wave is
 * exactly what "contests ore waves" means for a Medium bot (GDD §2.9).
 */
export function roam(ctx: BotCtx): readonly Action[] {
  return [go(ctx, arrive(ctx.self, ctx.view.center, ARRIVE_RADIUS)), fire(false)];
}

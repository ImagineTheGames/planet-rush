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

import type { Action, BuildItem, PlayerId, ThrustAction, UpgradeTrack, Vec2 } from '@shared/types';
import { CORE_HP, REPAIR_HP_PER_ORE, WEAPON_RANGE, PLANET, SHIELD, SHIP_RADIUS, TURRET } from '../sim';
import type { PerceivedShip } from './perception';
import {
  ARRIVE_RADIUS,
  aimAndFire,
  aimAt,
  arrive,
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
import { commit, release } from './commitment';
import { homeIntruder, isEngageable, retreatThreshold } from './targeting';
import type { TargetScore } from './targeting';
import { STUCK_DECISIONS } from './tree';
import type { BotCtx } from './tree';

// ---------------------------------------------------------------------------
// Distances the trees fly at. All TUNABLE, all owned by this agent.
// ---------------------------------------------------------------------------

/** How far off a rock a bot parks to mine it. Inside weapon range with margin,
 *  and inside tractor range of the chunks it cracks loose, so the ore drifts to
 *  the miner instead of being left for whoever passes (GDD §2.3). TUNABLE */
export const MINE_STANDOFF = WEAPON_RANGE * 0.45;

/** The ring a defender holds around its own planet: outside the core body,
 *  comfortably inside its turrets' range, so ship and turrets focus the same
 *  attacker (GDD §2.6 — "two beats one", and the defender counts). TUNABLE */
export const GUARD_RADIUS = PLANET.radius + 70;

/** Station-keeping ring while docked and spending. Inside `PLANET.dockRange`,
 *  so the wheel stays live and a repair channel is not broken by drift. TUNABLE */
export const DOCK_RADIUS = PLANET.radius + 45;

/** Stand-off for picking a turret apart: past its range (240), inside the
 *  weapon's (260). That twenty-unit window *is* GDD §2.6's "a patient attacker
 *  can pick off turrets from the edge of their range" — it only exists because
 *  the weapon out-ranges the turret, and flying it is a skill a Hard bot has. TUNABLE */
export const TURRET_STANDOFF = (TURRET.range + WEAPON_RANGE) / 2;

/** Stand-off for shooting a core or shield bubble. Measured centre-to-centre, so
 *  it must clear the bubble (90) and stay inside weapon range. TUNABLE */
export const SIEGE_STANDOFF = (SHIELD.radius + WEAPON_RANGE) / 2;

// ---------------------------------------------------------------------------
// Core repair — a RATIONED discrete purchase (p5-repair-discrete, GDD §2.5/§2.9)
// ---------------------------------------------------------------------------

/**
 * The core-HP fraction below which a bot buys a discrete core repair — the gate
 * every tier's spend plan shares. Repair is a one-tap `+REPAIR_HP_PER_ORE`
 * purchase now (developer 2026-07-26, `docs/design-amendments.md`), cheap and
 * instant, so a bot that repaired "whenever the core is below full" would top it
 * back to **exactly** `maxCoreHp` every dip. A field of such bots reaches
 * collapse at one identical HP and then dies in entropy lockstep — no survivor
 * to crown, the match stalled by the tiebreak (`trees.test.ts`). Discrete repair
 * therefore has to be a *ration*, not an always-on top-up (the brief's point 1).
 *
 * Two dials make it one:
 *
 *  - **Personality-modulated** by `caution` — the same character dial that sets
 *    the retreat nerve (GDD §2.9): a timid Rusty (1.3) patches early, a reckless
 *    Bolt (0.5) lets its core ride and dies on its own doorstep sooner. That
 *    spread alone means two funded turtles rarely reach collapse at the same HP.
 *  - **Capped strictly below the ceiling** — the target can never sit within one
 *    repair chunk of full, so a repaired core *settles below `maxCoreHp`* at a
 *    value that varies with its own damage history rather than snapping onto the
 *    shared `maxCoreHp` clamp. That is what actually kills the lockstep: there is
 *    no longer a single HP value every well-off defender converges on.
 *
 * Returns the fraction; a tier gates `coreHp < maxCoreHp * repairTargetFraction`.
 */
export function repairTargetFraction(ctx: BotCtx, baseAt: number): number {
  const maxHp = ctx.self.planet?.maxCoreHp ?? CORE_HP;
  // One repair chunk lands `REPAIR_HP_PER_ORE` HP; keep the target a further 5%
  // below `maxHp - one chunk` so the last chunk before the bot stops can never
  // reach — let alone clamp onto — the ceiling. (100/15 ⇒ cap ≈ 0.80.)
  const ceiling = Math.max(0, (maxHp - REPAIR_HP_PER_ORE) / maxHp - 0.05);
  return Math.min(baseAt * ctx.weights.caution, ceiling);
}

// ---------------------------------------------------------------------------
// The aim-error model, per character (v0.2.2 field report). The tier owns the
// band (`DifficultyTuning`); a personality's `aimScale` leans inside it.
// ---------------------------------------------------------------------------

/** This character's aim modulation, clamped so it can never cross tiers
 *  (`PersonalityWeights.aimScale`). The floor is deliberately higher than the
 *  ceiling is far: a Hard gun snaps back toward the aimbot once its lead-lag
 *  drops under ~0.16 s (`docs/bot-aim-error-p5.md`), so the tight end is capped
 *  tighter than the loose end to keep every character a clear margin above that
 *  cliff. */
function aimScaleOf(ctx: BotCtx): number {
  const s = ctx.weights.aimScale ?? 1;
  return s < 0.85 ? 0.85 : s > 1.4 ? 1.4 : s;
}

/** Angular spread this bot fires with — the tier's `aimJitter`, leaned by the
 *  character. */
export function combatSpread(ctx: BotCtx): number {
  return ctx.tuning.aimJitter * aimScaleOf(ctx);
}

/** Seconds before this bot re-solves its lead — the tier's `aimLatency`, leaned
 *  by the character. */
export function combatLatency(ctx: BotCtx): number {
  return ctx.tuning.aimLatency * aimScaleOf(ctx);
}

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
    // The way *out*, not merely away from the single nearest rock: "away from the
    // closest body" in a dense central cluster (GDD §2.3) is usually straight into
    // the next one, which is exactly how a bot trades one wedge for another and
    // never leaves. `openDirection` sums the repulsion of the whole clump, so it
    // points down the clearest lane.
    const fallback = worstPos === null ? { x: -dir.x, y: -dir.y } : toward(worstPos, ctx.self.pos);
    const open = openDirection(ctx, fallback, ignoreRock);
    // Thrown off to one side so two bots wedged in the same clump do not pick the
    // same line, and so a lane the resultant points dead-down is still committed
    // to off-centre rather than threaded perfectly. The draw is the bot's own
    // seeded stream, so it stays deterministic.
    brain.escapeDir = rotate(open, (brain.rng.next() * 2 - 1) * ESCAPE_SPREAD);
    brain.escapeUntil = ctx.view.time + ESCAPE_SECONDS;
    brain.stuckFor = 0;
  }
  // The heading this decision commits to: the escape run while one is live, else
  // the tree's own desired direction.
  const escaping = ctx.view.time < brain.escapeUntil;
  const heading = escaping ? brain.escapeDir : dir;
  // Curve *either* heading around the nearest body. An escape run that ignored
  // obstacles (as this once did) drives straight out of one rock and into the
  // next in a dense central cluster, so the bot never actually leaves — it just
  // trades which rock it is pinned against. Sliding the escape past whatever is
  // ahead is what lets a committed run thread out of the clump; the escape points
  // *away* from the body it was wedged on, so dodging around later ones curves
  // the exit, it never loops the run back onto the target.
  const steered = worstPos === null ? heading : dodge(ctx.self, heading, worstPos, worstRadius);

  const out = clampUnit(steered);
  ctx.brain.lastThrust = Math.sqrt(out.x * out.x + out.y * out.y);
  return thrust(out);
}

/** How long a wedged bot commits to its escape heading. Long enough to slide a
 *  pinned hull out of a late-wave asteroid pocket at cruise. Raised from 1.5 s
 *  when BOOST was cut (p7-remove-boost-ping): a chasing bot used to inherit the
 *  chase boost during its escape run, and the 1.6× burst punched it clear of a
 *  hard pin in one go; at base speed the run has to last a little longer so the
 *  tangential slide accumulates instead of re-rolling into another blocked lane
 *  (verified: worst wedge 16.5 s → 3.5 s across seeds 1–48, ceiling 12 s). TUNABLE */
export const ESCAPE_SECONDS = 2.0;

/** Half-angle the escape heading is thrown off the open lane. TUNABLE */
export const ESCAPE_SPREAD = Math.PI / 3;

/** How far out {@link openDirection} lets a body vote on the way out. Wide enough
 *  to take in a whole late-wave cluster around a wedged hull, short enough that
 *  rocks the bot is nowhere near do not drag the escape sideways. TUNABLE */
export const ESCAPE_SENSE = 220;

/** Denominator floor for a body's escape-repulsion weight, in surface-distance
 *  units. A touching or overlapping body (slack ≤ 0) is clamped to this rather
 *  than dividing by ~zero, so the resultant stays finite and one contact never
 *  drowns out the rest of the clump. TUNABLE */
export const ESCAPE_WEIGHT_FLOOR = 6;

/**
 * The clearest direction out of wherever a bot is wedged: a proximity-weighted
 * sum of the unit vectors *away* from every body within {@link ESCAPE_SENSE},
 * normalised. Because a nearer body pushes harder ({@link ESCAPE_WEIGHT_FLOOR}
 * sets the ceiling on that push), the resultant leans down the open lane between
 * rocks instead of straight back off the single closest one — the difference
 * between leaving a cluster and swapping which rock you are pinned against.
 *
 * This is a *potential-field* read, the very thing {@link go}'s per-tick steering
 * deliberately avoids because thirty overlapping pushes shiver a ship in place.
 * It is safe *here* only because it is sampled once, at the instant an escape is
 * committed, and then flown open-loop for {@link ESCAPE_SECONDS} — a heading, not
 * a per-tick force. `fallback` is returned when nothing is close enough to repel.
 */
export function openDirection(ctx: BotCtx, fallback: Vec2, ignoreRock?: number): Vec2 {
  let rx = 0;
  let ry = 0;
  const vote = (pos: Vec2, radius: number, distance: number): void => {
    const slack = distance - radius;
    if (slack > ESCAPE_SENSE) return;
    const away = toward(pos, ctx.self.pos, fallback);
    const denom = Math.max(ESCAPE_WEIGHT_FLOOR, slack);
    const w = 1 / (denom * denom);
    rx += away.x * w;
    ry += away.y * w;
  };
  for (const rock of ctx.view.asteroids) {
    if (rock.id === ignoreRock) continue;
    vote(rock.pos, rock.radius, rock.distance);
  }
  for (const planet of ctx.view.planets) vote(planet.pos, planet.radius, planet.distance);
  const own = ctx.self.planet;
  if (own) vote(own.pos, own.radius, own.distance);

  // The arena edge is a hard wall (`sim/step.ts` clamps position and kills the
  // inward velocity), so a bot fled into a corner is as wedged as one against a
  // rock — and no body in view repels it back out. Vote the four walls in as
  // inward pushes, weighted by how close each one is, so the open lane leans away
  // from the corner rather than deeper into it.
  const { x: px, y: py } = ctx.self.pos;
  const wall = (ax: number, ay: number, slack: number): void => {
    if (slack > ESCAPE_SENSE) return;
    const denom = Math.max(ESCAPE_WEIGHT_FLOOR, slack);
    const w = 1 / (denom * denom);
    rx += ax * w;
    ry += ay * w;
  };
  wall(1, 0, px - SHIP_RADIUS);
  wall(-1, 0, ctx.view.bounds.width - px - SHIP_RADIUS);
  wall(0, 1, py - SHIP_RADIUS);
  wall(0, -1, ctx.view.bounds.height - py - SHIP_RADIUS);

  const m = Math.sqrt(rx * rx + ry * ry);
  if (m < 1e-9) return fallback;
  return { x: rx / m, y: ry / m };
}

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
 * weapon at it, and hold the trigger only while the shot would actually land.
 *
 * The tier's `aimJitter` is what makes "Easy mines slowly" true without a
 * separate slow-mining knob: a wobbling nose crosses the rock intermittently, so
 * an Easy bot's weapon is on target a fraction of the time a Hard bot's is. One
 * mechanism, visible competence, no cheat in either direction (GDD §2.9).
 */
export function mine(ctx: BotCtx, rock: { id: number; pos: Vec2; radius: number } | null): readonly Action[] | null {
  if (!rock || ctx.self.cargoFull) {
    ctx.brain.mineSite = -1;
    return null;
  }
  // Book the site this decision commits to (p11). Read on the tick a retreat
  // breaks off this approach ({@link wantsRetreat}) and by the oscillation soak.
  ctx.brain.mineSite = rock.id;
  return [
    go(ctx, standOff(ctx.self, rock.pos, MINE_STANDOFF), rock.id),
    aimAt(ctx.self, rock.pos, ctx.tuning.aimJitter, ctx.rng),
    fire(canHit(ctx.self, rock.pos, rock.radius)),
  ];
}

// ---------------------------------------------------------------------------
// Haul and bank (GDD §2.3, §2.5)
// ---------------------------------------------------------------------------

/** Fly home with a load. Trigger up: a hauling bot opening fire is a bot
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
  return engage(ctx, intruder.pos, 16, WEAPON_RANGE * 0.6, intruder.vel, intruder.id);
}

// ---------------------------------------------------------------------------
// Attack (GDD §2.6, §2.9)
// ---------------------------------------------------------------------------

/**
 * Close to `range`, point the weapon, and fire only when the shot lands. The
 * stand-off is the whole tactic: against a ship it is a knife fight, against a
 * turret it is {@link TURRET_STANDOFF} — outside the turret's reach and inside
 * the weapon's (GDD §2.6).
 */
export function engage(
  ctx: BotCtx,
  pos: Vec2,
  radius: number,
  range: number,
  targetVel?: Vec2,
  targetId?: PlayerId,
): readonly Action[] {
  // A ship moves, so lead it with the tier's reaction lag on top (`targetId`
  // carries the bot's aim track — design amendment v0.2 + the v0.2.2 aim-error
  // model). A still target (a turret, a core) has no velocity, so `track` is null
  // and the aim is a straight bearing with only the spread.
  const track = targetId !== undefined ? ctx.brain.aim : null;
  const { aim, fire: fireAction } = aimAndFire(
    ctx.self,
    pos,
    radius,
    targetVel,
    combatSpread(ctx),
    ctx.rng,
    track,
    targetId ?? -1,
    ctx.view.time,
    combatLatency(ctx),
  );
  const actions: Action[] = [go(ctx, standOff(ctx.self, pos, range)), aim, fireAction];
  return actions;
}

/** Attack a scored target at the stand-off its kind deserves. */
export function attack(ctx: BotCtx, target: TargetScore): readonly Action[] {
  // A ship moves, so lead it (`target.vel`, with the reaction lag keyed on
  // `target.id`); a home does not, so the lead is a straight shot (design
  // amendment v0.2).
  if (target.kind === 'ship') {
    return engage(ctx, target.pos, target.radius, WEAPON_RANGE * 0.6, target.vel, target.id);
  }
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
// Break off, with commitment (GDD §2.9; v0.2.2 field report — decision
// hysteresis on the flee/fight pair)
// ---------------------------------------------------------------------------

/** How close an engageable ship must be to count as an active threat this bot
 *  breaks off *from* — the enter side of the flee band. Just past knife-fight
 *  range, so a bot reacts to a duel, not to a dot on the far edge of vision. TUNABLE */
export const THREAT_RANGE = WEAPON_RANGE * 1.6;

/**
 * The wider ring a committed retreat must open before it counts as *escaped* —
 * the exit side of the band, and the spatial half of the hysteresis. It is
 * deliberately past {@link THREAT_RANGE}: a bot backing off must not re-read a
 * pursuer that has only just left knife range as "gone" and wheel back into it,
 * which is precisely the flap the field report photographed. The gap between the
 * two ranges is the distance a retreat is allowed to commit to. TUNABLE
 */
export const RETREAT_CLEAR_RANGE = WEAPON_RANGE * 2.6;

/**
 * Hull margin above the tier's break-off point at which a *committed* retreat
 * releases on health alone — the hull half of the dual threshold, meaningfully
 * above the enter point so the two never coincide. In this sim a ship's hull
 * does not regenerate mid-life (GDD §2.5: "Ship hull is not repairable at all"),
 * so this fires almost entirely on a respawn-to-full — but it is the honest
 * second threshold, and it is here for the day hull repair exists. TUNABLE
 */
export const RETREAT_RECOVER_MARGIN = 0.15;

/**
 * How long a mining site stays tabu after an approach to it was broken off by a
 * retreat (p11 field report point 2). Long enough to outlast a threat that is
 * merely passing through the approach corridor, so the bot commits to another
 * field rather than wheeling straight back at the same rock the instant the flee
 * latch releases — and short enough that a site abandoned to a threat that has
 * since *left* is a candidate again within one mining errand. It sits at the
 * same order as the flee band's own commitment (`./commitment`) on purpose: the
 * tabu is the *spatial* commitment that outlives the flee's, so a released flee
 * does not re-select the goal the flee was escaping. TUNABLE */
export const TABU_SECONDS = 12;

/**
 * Book this bot's committed mine site (`Brain.mineSite`) as tabu until
 * {@link TABU_SECONDS} from now. Called the instant a retreat *commits* off a
 * mining approach — the one transition where the site the bot was flying at is
 * the site the threat is sitting on (`wantsRetreat`).
 */
function tabuMineSite(ctx: BotCtx): void {
  const site = ctx.brain.mineSite;
  if (site < 0) return;
  ctx.brain.tabu.set(site, ctx.view.time + TABU_SECONDS);
}

/** Core fraction below which self-preservation yields to home defence — the
 *  priority exception the field report names ("your core under final assault
 *  outranks self-preservation"). A bot this close to losing its home stops
 *  saving its cheap, respawnable hull and fights for the thing that is not
 *  cheap (GDD §1, §2.7). TUNABLE */
export const CORE_FINAL_ASSAULT = 0.3;

/** The nearest engageable ship within `range` — the thing that could be shooting
 *  at this bot. The break-off band reads it at two ranges (enter/exit), so the
 *  range is a parameter rather than a constant. */
export function nearestThreat(ctx: BotCtx, range: number): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  for (const ship of ctx.view.ships) {
    if (!isEngageable(ship)) continue;
    if (ship.distance > range) continue;
    if (best === null || ship.distance < best.distance) best = ship;
  }
  return best;
}

/** The nearest thing that could be shooting at this bot right now — the enter-side
 *  read of the break-off band. */
export function incomingThreat(ctx: BotCtx): PerceivedShip | null {
  return nearestThreat(ctx, THREAT_RANGE);
}

/** The hull fraction a committed retreat must climb back above to release on
 *  health — the tier's break-off point plus {@link RETREAT_RECOVER_MARGIN},
 *  capped short of full so a respawn always clears it. */
export function retreatRecoverFraction(ctx: BotCtx): number {
  return Math.min(0.95, retreatThreshold(ctx.tuning, ctx.weights) + RETREAT_RECOVER_MARGIN);
}

/** Is this bot's own core under final assault — the strictly-higher priority that
 *  pre-empts fleeing (see {@link CORE_FINAL_ASSAULT})? False in collapse, where a
 *  core cannot be repaired and defending it is a losing trade (`./hard`). */
export function coreUnderFinalAssault(ctx: BotCtx): boolean {
  const planet = ctx.self.planet;
  if (!planet || !planet.alive || ctx.view.collapsed) return false;
  return planet.underAttack && planet.coreHp < planet.maxCoreHp * CORE_FINAL_ASSAULT;
}

/**
 * Does this bot want to be breaking off *right now*? The flee half of the
 * flee/fight pair, latched so it cannot flap (`./commitment`; v0.2.2 field
 * report).
 *
 *  - **Enter** when the hull is under the tier's nerve ({@link retreatThreshold})
 *    and something engageable is inside {@link THREAT_RANGE}.
 *  - **Exit** when the bot has *arrived somewhere* — cleared {@link
 *    RETREAT_CLEAR_RANGE} of every threat — or its hull is whole again
 *    ({@link retreatRecoverFraction}), i.e. it respawned.
 *
 * Between those two it holds: a committed retreat keeps fleeing even on the
 * decisions where backing off has already nudged the nearest threat past
 * {@link THREAT_RANGE}, so the tree does not fall through to `attack`/`mine` and
 * drive the wounded ship straight back into the fight it was leaving. Collapse
 * cancels the whole thing — there is no hold worth saving and a respawn is free
 * (GDD §2.3, §2.7) — and releases the latch so the endgame reads cleanly.
 */
export function wantsRetreat(ctx: BotCtx): boolean {
  const latch = ctx.brain.fleeing;
  if (ctx.view.collapsed || !ctx.self.alive) {
    release(latch);
    return false;
  }
  const wounded = ctx.self.hullFraction < retreatThreshold(ctx.tuning, ctx.weights);
  const enter = wounded && incomingThreat(ctx) !== null;
  const recovered = ctx.self.hullFraction >= retreatRecoverFraction(ctx);
  const escaped = nearestThreat(ctx, RETREAT_CLEAR_RANGE) === null;
  const wasFleeing = latch.on;
  const fleeing = commit(latch, enter, recovered || escaped);
  // The retreat just *committed* off a mining approach: cool the site down so the
  // next mining decision picks another field rather than re-litigating this rock
  // with the threat still on the path (p11). `lastBehavior` holds the *previous*
  // decision's leaf here — the tree evaluates this test before the mine leaf runs
  // — so gating on it scopes the tabu to a break-off from mining, never from a
  // duel or a haul that happened to leave `mineSite` set from earlier.
  if (fleeing && !wasFleeing && ctx.brain.lastBehavior === 'mine') tabuMineSite(ctx);
  return fleeing;
}

/**
 * Get out, and go *somewhere* — a committed retreat that never twitches in place
 * (v0.2.2 field report point 2). Home is the destination, because home is where
 * the turrets are and a bot's territorial identity is to retreat *into* its
 * defences (GDD §2.6) — **unless** the thing that hurt it is already at home, in
 * which case running there is running into the siege, and the bot puts flat
 * distance between itself and the threat instead. Either way the flee vector has
 * a positive component away from the threat, so a low-HP bot's distance from it
 * increases every decision rather than oscillating (the screenshot scenario).
 *
 * The per-character read this produces (all one function, leaned by the tree's
 * priority order and `caution`):
 *
 *  - **Warden / Patch** (homebody): jumped in the field, they run for their own
 *    turret cover and turn to fight there; sieged at home, they break contact to
 *    regroup rather than die on a core the {@link coreUnderFinalAssault} branch
 *    has not yet flagged as worth dying for.
 *  - **Sable / Bolt** (aggressive, low `caution`): a higher nerve floor means
 *    they enter this later and leave it sooner, so they flee shallower.
 *  - **Rusty** (timid, high `caution`): enters earliest, runs straight home.
 *
 * The trigger stays up on the way out only when there is no threat to flee (a
 * fleeing bot that keeps firing keeps its gun trained on what it is running from
 * and never leaves); with a live threat the weapon is off — a retreating bot
 * does not advertise (GDD §2.2).
 */
export function retreat(ctx: BotCtx, threat: PerceivedShip | null): readonly Action[] {
  const planet = ctx.self.planet;
  const threatAtHome =
    planet !== null && planet.alive && threat !== null && dist(threat.pos, planet.pos) < GUARD_RADIUS * 2;
  if (planet && planet.alive && !threatAtHome) return [go(ctx, arrive(ctx.self, planet.pos, ARRIVE_RADIUS)), fire(false)];
  if (threat) return [go(ctx, flee(ctx.self, threat.pos)), fire(false)];
  return [thrust({ x: 0, y: 0 }), fire(false)];
}

/**
 * The priority exception (v0.2.2 field report point 1): a core under final
 * assault outranks self-preservation. Meet the attacker at home
 * ({@link defendHome}) and **drop any flee commitment**, so a bot that was
 * mid-retreat abandons it for the last stand and — once the assault lifts —
 * re-decides its nerve from scratch rather than silently resuming the run.
 *
 * The trees place this *above* {@link wantsRetreat}: it is the one thing allowed
 * to interrupt a committed retreat, which is exactly what a strictly-higher
 * priority in a hysteresis pair is for.
 */
export function lastStandDefend(ctx: BotCtx): readonly Action[] | null {
  release(ctx.brain.fleeing);
  return defendHome(ctx);
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

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
import {
  CORE_HP,
  REPAIR_HP_PER_ORE,
  REPAIR_ORE_COST,
  WEAPON_RANGE,
  SATELLITE,
  STATION,
  SHIELD,
  SHIP_RADIUS,
  TURRET,
  classTopSpeed,
  corneredReading,
} from '../sim';
import type { PerceivedShip } from './perception';
import {
  ALLY_RESPONSE_COOLDOWN,
  ALLY_RESPONSE_MAX,
  ALLY_RESPONSE_QUIET,
  ALLY_RESPONSE_RANGE,
  ASSAULT_JOIN_COOLDOWN,
  ASSAULT_JOIN_MAX,
  ASSAULT_JOIN_QUIET,
  ASSAULT_JOIN_RANGE,
  allyResponseCommit,
  allyResponseTarget,
  releaseAllyResponse,
} from './ally';
import type { Callout, CalloutKind } from './radio';
import { receive, send } from './radio';
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
  topSpeedOf,
  toward,
} from './steering';
import { commit, committed, release } from './commitment';
import { corneredCommit, corneredCommitted, corneredHeld, resetCornered } from './cornered';
import {
  homeIntruder,
  intruderNear,
  isTargetable,
  isWounded,
  retreatThreshold,
  scoreStation,
} from './targeting';
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

/** The ring a defender holds around its own station: outside the core body,
 *  comfortably inside its turrets' range, so ship and turrets focus the same
 *  attacker (GDD §2.6 — "two beats one", and the defender counts). TUNABLE */
export const GUARD_RADIUS = STATION.radius + 70;

/** Station-keeping ring while docked and spending. Inside `STATION.dockRange`,
 *  so the wheel stays live and a repair channel is not broken by drift. TUNABLE */
export const DOCK_RADIUS = STATION.radius + 45;

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
  const maxHp = ctx.self.station?.maxCoreHp ?? CORE_HP;
  // One repair chunk lands `REPAIR_HP_PER_ORE` HP; keep the target a further 5%
  // below `maxHp - one chunk` so the last chunk before the bot stops can never
  // reach — let alone clamp onto — the ceiling. (100/15 ⇒ cap ≈ 0.80.)
  const ceiling = Math.max(0, (maxHp - REPAIR_HP_PER_ORE) / maxHp - 0.05);
  return Math.min(baseAt * ctx.weights.caution, ceiling);
}

/**
 * Does this bot want to buy a core patch *right now* — the one question the spend
 * plans and the {@link wantsHomeErrand} both ask, so the errand can never fly a
 * bot home for a purchase the plan will then refuse (p15-02).
 *
 * Five gates, and each one is somebody's rule rather than this file's taste:
 *
 *  - **Collapse** shuts repair off for good (GDD §2.3).
 *  - **Under attack** — "a defender cannot out-repair an attacker who keeps
 *    shooting" (GDD §2.6), so ore spent under fire is ore thrown away.
 *  - **The tell** (`repairing`) is the sim's pacing signal: it releases only once
 *    the core has been quiet for `REPAIR_TELL_HOLD`, which is what keeps a bot
 *    from resuming its patching on the firing line (`sim/buildings.ts`).
 *  - **The cooldown** (`repairReadyIn`) is the gate that actually *refuses* a
 *    press — 15 seconds per station, ratified 2026-07-28. Until p15-02 no tree
 *    read it: they paced off the tell alone, which releases at half the cooldown,
 *    so the back half of every cooldown was spent filing orders the sim answered
 *    `'cooling-down'` and threw away — and, because repair sits at the head of the
 *    spend plan, those dropped presses starved the turret and shield buys behind
 *    them for as long as they lasted.
 *  - **The ration** ({@link repairTargetFraction}) — deliberately untouched here.
 */
export function wantsCorePatch(ctx: BotCtx, baseAt: number): boolean {
  const station = ctx.self.station;
  if (!station || !station.alive || ctx.view.collapsed) return false;
  if (station.underAttack || station.repairing || station.repairReadyIn > 1e-9) return false;
  if (station.coreHp >= station.maxCoreHp * repairTargetFraction(ctx, baseAt)) return false;
  return ctx.self.spendable >= REPAIR_ORE_COST;
}

// ---------------------------------------------------------------------------
// The standing defence — build, and REBUILD (GDD §2.5 caps; p15-02)
// ---------------------------------------------------------------------------

/**
 * What a tier keeps standing at home. Written as one record rather than three
 * loose constants because the *arithmetic* over it — standing plus queued,
 * clamped to the sim's caps — is the part that was wrong, and it should be wrong
 * in only one place if it is ever wrong again.
 */
export interface DefencePlan {
  readonly turrets: number;
  readonly shields: number;
  readonly satellites: number;
}

/**
 * `homebody` at or above which a character wires its claim for radar — the
 * satellite dial (feature f1). Rusty (0.8), Patch (0.9) and Warden (0.55) are the
 * homesteaders; Bolt, Sable, Foreman and Vulture are out in the field and buy
 * guns instead.
 *
 * **Stated plainly, because it is a real cost:** a live satellite lifts the
 * *minimap* fog for its owner (`sim/sensing.ts`), and a bot's `BotView` does not
 * read the sensed set — so today this purchase buys a bot no vision it did not
 * already have. It is bought anyway, and only by the two characters whose whole
 * read is homesteading, for two reasons that are not vision: the structure exists
 * on the board for a human to hunt (which `constants.ts` calls "a legitimate
 * strategy"), and a capped structure a bot never builds is a capped structure the
 * rebuild path can never be exercised on. Feeding a satellite's coverage into
 * `BotView` is the honest follow-up — a human in that cockpit genuinely sees more
 * — and it is flagged to the Director rather than smuggled in here. TUNABLE
 */
export const SATELLITE_HOMESTEAD = 0.5;

/** Ore a bot keeps back beyond the sticker price before it will buy a sensor:
 *  the satellite is the last thing on the list, never the purchase that empties
 *  a wallet the turret ring wanted. TUNABLE */
export const SATELLITE_RESERVE = 3;

/** This character's satellite target — {@link SATELLITE_HOMESTEAD}, in one place. */
export function satelliteTarget(ctx: BotCtx): number {
  return ctx.weights.homebody >= SATELLITE_HOMESTEAD ? SATELLITE.capPerStation : 0;
}

/** Ore price of one capped structure. Local rather than the sim's `orderCost` so
 *  this module keeps one import surface; the three numbers are the same table. */
function structureCost(item: 'turret' | 'shield' | 'satellite'): number {
  return item === 'turret' ? TURRET.cost : item === 'shield' ? SHIELD.cost : SATELLITE.cost;
}

/**
 * The one purchase that closes this station's most urgent hole in its standing
 * defence, or `null` when there is nothing to close (or nothing to close it
 * with). Guns, then the bubble, then the sensor.
 *
 * **Build and rebuild are the same question**, deliberately: "I want two turrets
 * and I have one" reads identically whether the second was never built or was
 * shot off ten seconds ago, so a bot that tops up to its target *is* a bot that
 * rebuilds, and there is no second code path to keep in step. What was actually
 * broken is the counting (p15-02):
 *
 *  - **Queued jobs are counted by KIND.** The trees used to add
 *    `station.builds` — every job on the station, of every kind — to the standing
 *    count of one kind. So a shield under construction read as a turret already on
 *    order, and a bot with a hole in its ring sat on the ore for the fifteen
 *    seconds the shield took, waiting for a job that could never fill it. With the
 *    satellite in the mix (12 s) the same collision widens.
 *  - **The sim's caps clamp the target**, so a tier target can never ask for a
 *    fifth turret or a second satellite and spend the match filing orders the sim
 *    refuses `'cap-reached'`.
 *
 * The shield still waits on a standing turret: a bubble over an unguarded core
 * only buys time, and the guns are what make an attacker regret the trip
 * (GDD §2.6).
 */
export function rebuildOrder(ctx: BotCtx, plan: DefencePlan): Purchase | null {
  const station = ctx.self.station;
  if (!station || !station.alive) return null;
  const spendable = ctx.self.spendable;

  const wantTurrets = Math.min(plan.turrets, TURRET.capPerStation);
  if (station.turrets + station.turretsBuilding < wantTurrets && spendable >= structureCost('turret')) {
    return order('turret');
  }

  const wantShields = Math.min(plan.shields, SHIELD.capPerStation);
  if (
    station.turrets >= 1 &&
    station.shields + station.shieldsBuilding < wantShields &&
    spendable >= structureCost('shield')
  ) {
    return order('shield');
  }

  const wantSatellites = Math.min(plan.satellites, SATELLITE.capPerStation);
  if (
    station.satellites + station.satellitesBuilding < wantSatellites &&
    spendable >= structureCost('satellite') + SATELLITE_RESERVE
  ) {
    return order('satellite');
  }

  return null;
}

// ---------------------------------------------------------------------------
// The home errand — going home ON PURPOSE (p15-02)
// ---------------------------------------------------------------------------

/**
 * How far from home a character will break off what it is doing to go and fix
 * its base, as a multiple of its own visual range, leaned by `homebody`.
 *
 * Bolt (0.1) barely turns around; Patch (0.9) crosses the map for it. The dial is
 * the same one that decides how territorial a character is (GDD §2.9), which is
 * exactly the question "is my base worth the trip?" asks. TUNABLE
 */
export function errandRange(ctx: BotCtx): number {
  return ctx.view.perception.visualRange * (0.5 + 1.5 * ctx.weights.homebody);
}

/** How much further a bot will fly for a *core patch* than for a structure — the
 *  core is the win condition (GDD §1) and a turret slot is not, so the trip home
 *  is worth twice as much for one as for the other. TUNABLE */
export const CORE_ERRAND_REACH = 2;

/**
 * Does this bot want to fly home and spend, right now?
 *
 * **The defect this exists for (p15-02).** A bot only ever spent when it happened
 * to be docked for some *other* reason — a full hold, an answered alarm. There
 * was no errand that said "go home and fix your base", so a bot that wanted a
 * repair while it was out mining simply… kept mining. Measured over one unstaged
 * eight-bot match at seed 1: nine repair orders in 791 seconds; 21.8% of every
 * decision taken with a core under its own ration was taken away from home, and
 * Warden alone spent ~286 seconds of that match carrying the ore for a turret it
 * never went home to build. Six of the eight cores died with damage on them that
 * was never patched.
 *
 * So this is the missing verb, and it is deliberately narrow:
 *
 *  - **Not docked**, or there is nothing to fly to — {@link spendAtHome} owns the
 *    purchase, this only owns the trip.
 *  - **A patch calls you home from twice as far** as a structure does
 *    ({@link CORE_ERRAND_REACH}): a core is the win condition, a turret slot is a
 *    convenience.
 *  - **`plan === null` means this tier runs no structural errand at all** — it
 *    replaces what it lost on its next trip home instead. That is `./hard`'s
 *    setting, and the reason is in that file: a Hard bot plays like a good human,
 *    and a good human does not fly home mid-raid to plug one turret.
 *  - **Never in collapse** — no repair, no regeneration, and the endgame is a
 *    damage race a defender cannot win by spending (GDD §2.3, `./hard`).
 *  - **A stand-in never spends the dropped pilot's endowment** (GDD §4.2) — the
 *    same line {@link spendAtHome} draws, drawn before the trip rather than after
 *    it, so a stand-in does not fly home for a purchase it will be refused.
 */
export function wantsHomeErrand(ctx: BotCtx, baseAt: number, plan: DefencePlan | null): boolean {
  const station = ctx.self.station;
  if (!ctx.self.alive || ctx.self.docked || ctx.view.collapsed) return false;
  if (!station || !station.alive) return false;
  if (ctx.self.spendable <= ctx.brain.endowment + 1e-9) return false;
  const reach = errandRange(ctx);
  if (wantsCorePatch(ctx, baseAt)) return ctx.self.homeDistance <= reach * CORE_ERRAND_REACH;
  return plan !== null && rebuildOrder(ctx, plan) !== null && ctx.self.homeDistance <= reach;
}

/**
 * Fly home to spend. The same flight {@link haulHome} makes and for the same
 * reason — home is home — named separately because the *reason* is what a reader
 * of the tree needs: this bot is not carrying anything, it is going to fix
 * something.
 */
export function homeErrand(ctx: BotCtx): readonly Action[] | null {
  return haulHome(ctx);
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
 * Asteroids and stations are solid bodies that stop a ship dead, so "fly at the
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
  for (const station of ctx.view.stations) {
    const slack = station.distance - station.radius;
    if (slack < worstSlack) {
      worstSlack = slack;
      worstPos = station.pos;
      worstRadius = station.radius;
    }
  }
  const own = ctx.self.station;
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
  for (const station of ctx.view.stations) vote(station.pos, station.radius, station.distance);
  const own = ctx.self.station;
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
  const station = ctx.self.station;
  if (!station || !station.alive || !ctx.self.docked) return null;
  // A stand-in never spends the ore it inherited — that is the dropped pilot's
  // to reclaim (GDD §4.2). Only what this bot has mined since it sat down lifts
  // `spendable` past its endowment; an opening bot's endowment is zero, so this
  // never stays the hand of a bot that earned its own start (`./tree`).
  if (ctx.self.spendable <= ctx.brain.endowment + 1e-9) return null;
  const purchase = plan(ctx);
  if (!purchase) return null;
  return [go(ctx, orbit(ctx.self, station.pos, DOCK_RADIUS, 0.2)), fire(false), purchaseAction(purchase)];
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
  const station = ctx.self.station;
  if (!station) return null;
  return [go(ctx, arrive(ctx.self, station.pos, ARRIVE_RADIUS)), fire(false)];
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
  const station = ctx.self.station;
  if (!station) return null;
  // Say so, on the way. A siege call is a fact about the sender's own home and
  // therefore always legal to send (`./radio` §2.2), and it is the one thing a
  // teammate out of visual range cannot otherwise learn from anything but the
  // klaxon. Cooldown-gated, so this is not one call per decision.
  callSiege(ctx);
  const intruder = homeIntruder(ctx);
  if (!intruder) return [go(ctx, orbit(ctx.self, station.pos, GUARD_RADIUS)), fire(false)];
  return engage(ctx, intruder.pos, 16, WEAPON_RANGE * 0.6, intruder.vel, intruder.id);
}

// ---------------------------------------------------------------------------
// Defending an ALLY (GDD §2.6, §2.9; `docs/team-bots-plan.md` Stage 2 —
// the developer, 2026-08-07: "enemies on teams should try to defend their
// teammates bases when under attack (if they are under threat as well) …
// same thing for bots on your team")
// ---------------------------------------------------------------------------

/**
 * Everything a teammate said that this bot can hear right now (`./radio`).
 *
 * Freshness is the receiver's own {@link DifficultyTuning.memorySeconds} clock —
 * the same clock its own eyes are on — applied to the **hearsay-discounted** age,
 * so second-hand news expires at twice the rate first-hand news does and a bot
 * always prefers to go and look. Empty and allocation-free on a quiet tick, and
 * empty *always* in FFA, where the radio is `null` because a team of one has
 * nobody to talk to (plan §2.5).
 */
export function allyCalls(ctx: BotCtx): readonly Callout[] {
  return receive(ctx.brain.radio, ctx.self.id, ctx.view.time, ctx.tuning.memorySeconds);
}

/**
 * Speak, if this bot's voice is off cooldown. Returns whether it spoke.
 *
 * The cooldown is the only thing bounding traffic: a call is **not** an `Action`,
 * so it does not travel in the action stream and `holdable` (`./harness`) — which
 * exists to stop exactly this class of bug for wheel presses — is not protecting
 * it. A tree that called once per *decision* would emit twenty a second at Hard.
 *
 * `lastCallAt` advances even when nobody hears, because the cooldown models a
 * mouth rather than an outcome. And the whole function is a no-op with **no RNG
 * draw** when the radio is `null`: that is what keeps an FFA match byte-identical
 * to the one that shipped before the radio existed (plan §2.5, Task 1.6's hash).
 */
export function callOut(ctx: BotCtx, kind: CalloutKind, about: PlayerId, pos: Vec2): boolean {
  const brain = ctx.brain;
  if (!brain.radio) return false;
  const now = ctx.view.time;
  if (brain.lastCallAt >= 0 && now - brain.lastCallAt < ctx.tuning.callCooldown) return false;
  brain.lastCallAt = now;
  send(
    brain.radio,
    { kind, from: ctx.self.id, about, pos, seenAt: now },
    ctx.tuning.callLatency,
    ctx.tuning.callMissChance,
    ctx.rng,
  );
  return true;
}

/** *"My home is being hit."* Legal from the sender's own `underAttack`, which is
 *  own-cockpit knowledge (`./radio`'s `siege` row). Silent when the home is not
 *  actually taking fire, so a bot orbiting its guard ring on a false alarm does
 *  not summon the side. */
export function callSiege(ctx: BotCtx): boolean {
  const station = ctx.self.station;
  if (!station || !station.alive || !station.underAttack) return false;
  return callOut(ctx, 'siege', ctx.self.id, station.pos);
}

/** *"I am in trouble, here."* A fact about the sender's own ship, so it is legal
 *  under any fog — and it is the one thing Layer A genuinely cannot carry: the
 *  klaxon rings for a **home**, and a teammate jumped in open space has no
 *  klaxon. */
export function callHelp(ctx: BotCtx): boolean {
  return callOut(ctx, 'help', ctx.self.id, ctx.self.pos);
}

/**
 * *"I am going in on that home, there."* The sender's own committed intent, which
 * is a fact about itself and therefore always legal (`./radio` §2.2), over a
 * position it read off a `PerceivedStation` — public at any range.
 *
 * **Homes only.** "Going on the offensive" is a raid on a core, which is also the
 * only offence worth converging on: GDD §2.6's "two beats one" is a statement
 * about sieges. Broadcasting every potshot at a passing ship would be the plan's
 * Stage 4 focus fire, which is a different mechanism (a score bonus, not a
 * commitment) and is deliberately not in this brief. A ship target is silent.
 *
 * Called from the *body* of an attack rather than from its test, so a bot only
 * announces a raid it is actually prosecuting this tick — and cooldown-gated by
 * {@link callOut}, so pressing a siege for thirty seconds is a handful of calls
 * and not six hundred.
 */
export function callPush(ctx: BotCtx, target: TargetScore): boolean {
  if (target.kind !== 'station') return false;
  return callOut(ctx, 'push', target.id, target.pos);
}

/**
 * How far *this character* will break off to answer a teammate, leaned by
 * `homebody` around the plan's measured {@link ALLY_RESPONSE_RANGE}.
 *
 * The dial is the one that already decides how territorial a character is, and
 * `errandRange` above uses it for the same shape of question ("is the trip
 * worth it?"), so this is a reuse rather than a new knob — which is what the plan
 * asks for (§4.5: "`homebody` … *is* the ally-response range multiplier").
 *
 * The multiplier is `0.5 + homebody`, so the plan's 1200 is exactly the value at
 * the **midpoint of the dial** and the cast spreads around it: Bolt (0.1) 720 and
 * Sable (0.2) 840 barely turn around, Warden (0.55) 1260 and Patch (0.9) 1680
 * cross the map. The cast mean lands at ~1175, within 2% of the measured
 * recommendation, so the character spread costs the team nothing on average.
 * TUNABLE
 */
export function allyResponseRange(ctx: BotCtx): number {
  return ALLY_RESPONSE_RANGE * (0.5 + ctx.weights.homebody);
}

/** A teammate in trouble, and where. */
export interface AllyDistress {
  /** The slot in trouble. */
  readonly id: PlayerId;
  /** Where to go: the besieged home, or where the caller said it was. */
  readonly pos: Vec2;
  /** How far this bot is from that point, now. */
  readonly distance: number;
  /**
   * True when this came from the **klaxon** — Layer A, live and range-free —
   * rather than from a call that travelled. A live alarm outranks a call in
   * {@link nearestAllyDistress}, because it is happening *now* and it is about a
   * core, which is the win condition (GDD §1).
   */
  readonly live: boolean;
}

/**
 * Is slot `id` in trouble, as far as this bot can legitimately tell? **At any
 * range** — deliberately.
 *
 * A bot most of the way to a rescue has flown out of the range it started in, so
 * re-testing distance mid-flight would release the commitment exactly when it is
 * closest to paying off. Range gates *starting* a run ({@link
 * nearestAllyDistress}), never continuing one.
 *
 * Two legitimate sources, and no third:
 *
 *  - **Layer A**, the ally klaxon on the view ({@link AllyView.underAttack}) —
 *    the same map-wide, scouting-free signal a human teammate already hears
 *    (`src/art/presenter.ts`). Parity, not telepathy.
 *  - **Layer B**, a `help` or `siege` call this bot actually heard, still fresh
 *    on its discounted clock ({@link allyCalls}).
 *
 * A call about a slot that is not on this bot's side is ignored rather than
 * trusted: Stage 2 never sends one, and a branch that would fly at an *enemy's*
 * distress on the strength of a malformed record is not a branch worth shipping.
 */
export function allyDistress(ctx: BotCtx, id: PlayerId): AllyDistress | null {
  for (const ally of ctx.view.allies) {
    if (ally.id !== id) continue;
    if (ally.underAttack && ally.stationAlive && ally.stationPos) {
      return { id, pos: ally.stationPos, distance: dist(ctx.self.pos, ally.stationPos), live: true };
    }
    break;
  }
  // The FRESHEST call about this slot, not the first: `receive` returns them in
  // ascending delivery order, so the last match is the newest thing said. Taking
  // the first would send a responder to where a moving teammate was six seconds
  // ago while a newer call sat unread behind it.
  let latest: Callout | null = null;
  for (const call of allyCalls(ctx)) {
    if (call.about !== id || call.about === ctx.self.id) continue;
    if (!isAlly(ctx, call.about)) continue;
    latest = call;
  }
  if (latest) return { id, pos: latest.pos, distance: dist(ctx.self.pos, latest.pos), live: false };
  return null;
}

/** Is this slot on my side? A roster read, not a sighting (`./perception`). */
function isAlly(ctx: BotCtx, id: PlayerId): boolean {
  for (const ally of ctx.view.allies) {
    if (ally.id === id) return true;
  }
  return false;
}

/**
 * The teammate this bot would break off for — nearest first, inside
 * {@link allyResponseRange}, klaxon before hearsay.
 *
 * The scan is over `view.allies`, which is ascending by id (`./perception`), and
 * ties are broken by that order, so two equidistant alarms resolve the same way
 * on every engine (GDD §4.8).
 */
export function nearestAllyDistress(ctx: BotCtx): AllyDistress | null {
  const reach = allyResponseRange(ctx);
  let best: AllyDistress | null = null;
  for (const ally of ctx.view.allies) {
    const distress = allyDistress(ctx, ally.id);
    if (!distress || distress.distance > reach) continue;
    if (best === null || betterDistress(distress, best)) best = distress;
  }
  return best;
}

/** A live klaxon beats a call; then nearer beats further. Ties keep the earlier
 *  (lower-id) candidate, because the scan runs in ascending id order. */
function betterDistress(candidate: AllyDistress, best: AllyDistress): boolean {
  if (candidate.live !== best.live) return candidate.live;
  return candidate.distance < best.distance;
}

/** Is this bot's *own* doorstep the one that needs it? The identical expression
 *  the trees' own `defend` test uses, so the two can never disagree about which
 *  alarm outranks which. */
export function ownHomeThreatened(ctx: BotCtx): boolean {
  const station = ctx.self.station;
  if (!station || !station.alive) return false;
  return station.underAttack || homeIntruder(ctx) !== null;
}

/** Arrived at the post, with nothing left to fight — the response's happy ending
 *  ({@link allyResponseCommit}'s `arrived`). The radius is the defender's guard
 *  ring with margin, so "there" means close enough to be standing in front of
 *  the teammate's turrets rather than merely on the same side of the map. */
function atAllyPost(ctx: BotCtx, at: Vec2): boolean {
  return dist(ctx.self.pos, at) <= GUARD_RADIUS * 1.5 && intruderNear(ctx, at) === null;
}

/**
 * **Does this bot want to answer a teammate's alarm right now?** The trigger, and
 * the whole selfish-first ladder, in one place (`docs/team-bots-plan.md` Stage 2).
 *
 * The plan's trigger, clause by clause: an ally's home reads `underAttack` **or**
 * a `help`/`siege` call arrives, **and** the bot is within
 * {@link allyResponseRange} of it, **and** its own home is not itself under
 * attack, **and** it is not fleeing or cornered.
 *
 * That third clause is the developer's parenthesis — *"(if they are under threat
 * as well)"* — and it is the half that keeps this from becoming a bot that
 * abandons its economy. **My home outranks yours.** The alarm rings for the team;
 * the priority ladder stays selfish-first.
 *
 * The gates fall into two kinds, and the difference matters:
 *
 *  - **Terminal** — FFA (no allies at all, so nothing here can ever fire: the
 *    structural degradation, not a mode flag), death, and collapse. Collapse
 *    ends it for the same reason the trees switch their *own* `defend` off there:
 *    nothing can be repaired, the endgame is a damage race, and a player who
 *    spends it guarding cannot win it (GDD §2.3, `./hard`).
 *  - **Transient** — my own home, my own skin, my own hold. These *hold* the
 *    commitment rather than ending it: the teammate may still be under siege when
 *    the emergency at this end passes, and {@link ALLY_RESPONSE_MAX} bounds how
 *    long that hold can last. A full hold blocks only the *start* of a run, so a
 *    bot never answers a call, dies, and hands half a full hold to the attacker
 *    (GDD §2.7) — but a run already under way is not abandoned over cargo.
 *
 * Folds the commitment exactly once per decision, like every other `wants*` in
 * this file; the branch body ({@link defendAlly}) only reads what this wrote.
 */
export function wantsAllyDefence(ctx: BotCtx): boolean {
  const brain = ctx.brain;
  const latch = brain.allyResponse;
  const now = ctx.view.time;

  if (ctx.view.allies.length === 0) return false;
  if (!ctx.self.alive || ctx.view.collapsed) {
    releaseAllyResponse(latch);
    return false;
  }
  if (ownHomeThreatened(ctx) || committed(brain.fleeing) || corneredCommitted(brain.cornered, now)) {
    return false;
  }

  const answering = allyResponseTarget(latch);
  const held = answering >= 0 ? allyDistress(ctx, answering) : null;
  const candidate = answering >= 0 || wantsToHaul(ctx) ? null : nearestAllyDistress(ctx);
  const arrived = answering >= 0 && atAllyPost(ctx, latch.at);

  const target = allyResponseCommit(
    latch,
    now,
    candidate ? candidate.id : -1,
    held !== null,
    arrived,
    ALLY_RESPONSE_QUIET,
    ALLY_RESPONSE_MAX,
    ALLY_RESPONSE_COOLDOWN,
  );
  if (target < 0) return false;
  // Remember where the trouble is while it is still readable. The alarm blinks
  // off between an attacker's bursts, so a responder that re-derived this every
  // decision would lose its destination mid-flight (`./ally`'s `at`).
  const seen = held ?? candidate;
  if (seen) {
    latch.at.x = seen.pos.x;
    latch.at.y = seen.pos.y;
  }
  return true;
}

/**
 * Go. Fight what is at the teammate's doorstep, or fly to the doorstep.
 *
 * There is no third case: the response *arriving* with nothing to fight is not a
 * behaviour, it is the end of the commitment, and {@link wantsAllyDefence} has
 * already turned this branch off by the time that is true. So this never loiters
 * at a teammate's home — which is the difference between answering an alarm and
 * becoming a free escort that makes a defended team uncrackable (plan §4, Stage 2
 * risks).
 *
 * The stand-off and the lead are {@link defendHome}'s exactly: a defender is a
 * defender, and the only thing that changed is whose doorstep it is.
 */
export function defendAlly(ctx: BotCtx): readonly Action[] | null {
  const latch = ctx.brain.allyResponse;
  if (allyResponseTarget(latch) < 0) return null;
  const at = latch.at;
  const intruder = intruderNear(ctx, at);
  if (intruder) return engage(ctx, intruder.pos, 16, WEAPON_RANGE * 0.6, intruder.vel, intruder.id);
  return [go(ctx, arrive(ctx.self, at, ARRIVE_RADIUS)), fire(false)];
}

// ---------------------------------------------------------------------------
// Joining an ally's ATTACK (GDD §2.6, §2.9; `docs/team-bots-plan.md` Stage 4 —
// the developer, 2026-08-07: "…and equally should try to attack when team mates
// go on offensive")
// ---------------------------------------------------------------------------

/**
 * How far *this character* will fly to join a teammate's raid, leaned by
 * `opportunism` around the measured {@link ASSAULT_JOIN_RANGE}.
 *
 * **The plan already named this dial for this job** (§4.5): *"`opportunism` —
 * Sable (0.9) and Vulture (0.8) honour focus-fire calls (a called target is a
 * punishable target); Rusty (0.1) does not."* So this is a reuse, not a new knob
 * — and pointedly **not** `homebody`, which is the *defensive* range multiplier
 * one section up. A territorial character should answer an alarm from further
 * and fly out for a raid from nearer; sharing one dial between the two would make
 * those the same sentence.
 *
 * The multiplier is `0.55 + opportunism`, so the cast mean lands at 0.99 — within
 * 1% of the measured recommendation, meaning the character spread costs the team
 * nothing on average. The spread reads as the plan describes it: Sable 1740 and
 * Vulture 1620 cross the map for a called target, Warden 1260 goes if it is on
 * the way, and Rusty 780 and Patch 900 stay home. TUNABLE
 */
export function assaultJoinRange(ctx: BotCtx): number {
  return ASSAULT_JOIN_RANGE * (0.55 + ctx.weights.opportunism);
}

/** A teammate's raid, and where it is. */
export interface AllyAssault {
  /** The **objective**: the slot whose home is being hit. This is what the latch
   *  commits to, because "that home is gone" is what ends a raid. */
  readonly on: PlayerId;
  /** The teammate who said so — for a debug overlay, and for tests. */
  readonly by: PlayerId;
  /** Where the fight is: the enemy home's position, as the caller reported it. */
  readonly pos: Vec2;
  /** How far this bot is from that point, now. */
  readonly distance: number;
}

/**
 * Is that home still standing, as far as this bot can legitimately tell?
 *
 * `PerceivedStation.alive` is public at any range — a wreck is visible from
 * further away than its numbers are, "smoke carries" (GDD §2.2) — so this is the
 * one thing about an enemy core a bot may read without scouting. Its HP is not,
 * and is not read anywhere here.
 *
 * A station that is not in the view at all reads as **not standing**, which ends
 * a commitment rather than holding one open. That is the safe direction: the
 * alternative is a bot posted forever at an objective it cannot confirm.
 */
function enemyHomeStanding(ctx: BotCtx, owner: PlayerId): boolean {
  for (const station of ctx.view.stations) {
    if (station.owner === owner) return station.alive;
  }
  return false;
}

/**
 * Is somebody on my side going in on slot `id`'s home? **At any range** —
 * deliberately, and for the identical reason {@link allyDistress} is: a bot most
 * of the way to a fight has flown out of the range it started in, and re-testing
 * distance mid-flight would release the commitment exactly when it is closest to
 * paying off. Range gates *starting* a run ({@link nearestAllyAssault}), never
 * continuing one.
 *
 * **One legitimate source, and no second one.** Unlike the defensive branch there
 * is no Layer A here: the klaxon rings for a home *on your own side*, and nothing
 * on anybody's HUD announces that a teammate has opened a raid. So the only
 * signal is a `push` call this bot actually heard, still fresh on its
 * hearsay-discounted clock. A bot may act on a callout; it may never act on what
 * it could not perceive, and with no call it perceives nothing.
 *
 * The **freshest** call about the target, not the first: `receive` returns them in
 * ascending delivery order, so the last match is the newest thing said, and a
 * newer report of the same objective should not sit unread behind an older one.
 */
export function allyAssaultOn(ctx: BotCtx, id: PlayerId): AllyAssault | null {
  // Never against my own side, whatever a malformed record claims — the same
  // refusal `allyDistress` makes in the other direction.
  if (id === ctx.self.id || isAlly(ctx, id)) return null;
  if (!enemyHomeStanding(ctx, id)) return null;
  let latest: Callout | null = null;
  for (const call of allyCalls(ctx)) {
    if (call.kind !== 'push' || call.about !== id) continue;
    latest = call;
  }
  if (!latest) return null;
  return { on: id, by: latest.from, pos: latest.pos, distance: dist(ctx.self.pos, latest.pos) };
}

/**
 * The raid this bot would break off for — nearest first, inside
 * {@link assaultJoinRange}.
 *
 * The scan is over `ctx.view.stations`, which is built in `world.stations` order
 * (`./perception`), and ties keep the earlier entry, so two equidistant raids
 * resolve the same way on every engine (GDD §4.8).
 */
export function nearestAllyAssault(ctx: BotCtx): AllyAssault | null {
  const reach = assaultJoinRange(ctx);
  let best: AllyAssault | null = null;
  for (const station of ctx.view.stations) {
    const raid = allyAssaultOn(ctx, station.owner);
    if (!raid || raid.distance > reach) continue;
    if (best === null || raid.distance < best.distance) best = raid;
  }
  return best;
}

/**
 * **Does this bot want to join a teammate's attack right now?**
 *
 * The offensive twin of {@link wantsAllyDefence}, and the differences are the
 * whole design. What is the *same*: the latch, the selfish-first gates, and the
 * fold-exactly-once-per-decision contract. What is different, in the order it
 * matters:
 *
 *  1. **There is no happy ending on arrival.** `defend-ally` completes on
 *     "arrived, and nothing to fight"; a raid that arrives to plenty to fight has
 *     *succeeded*. So the `arrived` slot carries **"the objective is gone"** —
 *     the target's home is dead — and everything else leans on the ceiling and
 *     the cooldown, which is why those are measured rather than inherited
 *     (`./ally`, `evidence/b2-03-assault-window.ts`).
 *  2. **Collapse does not switch it off**, where it does switch `defend-ally`
 *     off. That asymmetry is one argument, not two: in collapse nothing can be
 *     repaired and the endgame is a damage race (GDD §2.3), so a player who
 *     spends it *guarding* cannot win — but a player who spends it *on a rival's
 *     core* is doing the only thing that still scores. Defence stops mattering
 *     there; offence starts mattering more.
 *  3. **No `wantsToHaul` gate.** The branch sits below `haul` in all three trees,
 *     so a bot with a hold worth banking never reaches this test at all. The
 *     defensive branch needs the explicit gate because it sits *above* `haul`;
 *     here the ladder does it, and a condition that can never fire would be a
 *     worse guarantee than the tree order, not a better one.
 *
 * **The ladder is unchanged, and this is where that is enforced.** The branch is
 * below `last-stand`, `cornered-fight`, `retreat`, this bot's own `defend`, and
 * `defend-ally`: **my home outranks yours, and my home outranks your raid.**
 * `ownHomeThreatened` is the same expression the trees' own `defend` test uses,
 * so the two can never disagree — and it is a *transient* hold rather than a
 * release, because the raid may still be running when the emergency here passes
 * and {@link ASSAULT_JOIN_MAX} already bounds how long that hold can last.
 */
export function wantsJoinAssault(ctx: BotCtx): boolean {
  const brain = ctx.brain;
  const latch = brain.allyAssault;
  const now = ctx.view.time;

  // FFA, structurally: a side of one has no teammates to raid with and no radio
  // to hear one on, so this cannot fire and draws nothing (plan §2.5).
  if (ctx.view.allies.length === 0) return false;
  if (!ctx.self.alive) {
    releaseAllyResponse(latch);
    return false;
  }
  if (ownHomeThreatened(ctx) || committed(brain.fleeing) || corneredCommitted(brain.cornered, now)) {
    return false;
  }

  const answering = allyResponseTarget(latch);
  const held = answering >= 0 ? allyAssaultOn(ctx, answering) : null;
  const candidate = answering >= 0 ? null : nearestAllyAssault(ctx);
  // The objective died: the raid worked. This is the only completion this latch
  // has, and it outranks a live call for the same reason arrival does over there
  // — completion breaks a commitment rather than renewing it.
  const objectiveGone = answering >= 0 && !enemyHomeStanding(ctx, answering);

  const target = allyResponseCommit(
    latch,
    now,
    candidate ? candidate.on : -1,
    held !== null,
    objectiveGone,
    ASSAULT_JOIN_QUIET,
    ASSAULT_JOIN_MAX,
    ASSAULT_JOIN_COOLDOWN,
  );
  if (target < 0) return false;
  // Remember where the fight is while it is still being talked about. A home does
  // not move, but the channel goes quiet between a teammate's calls — at Easy for
  // half of a continuous raid (`./ally` `ASSAULT_JOIN_QUIET`) — and a joiner that
  // re-derived its destination every decision would lose it mid-flight.
  const seen = held ?? candidate;
  if (seen) {
    latch.at.x = seen.pos.x;
    latch.at.y = seen.pos.y;
  }
  return true;
}

/**
 * Go, and press the same siege the teammate is pressing.
 *
 * Two cases, in this order, and the order is the tactic:
 *
 *  1. **Something is defending the objective** — meet it. A raid that ignores the
 *     defender to plink the core takes turret fire and ship fire while doing the
 *     slowest damage on the board. This is {@link intruderNear} at the *enemy's*
 *     doorstep, which is the identical predicate at the identical radius the
 *     defensive branch uses at a friendly one (`./targeting`, plan Trap 9).
 *  2. **Otherwise the home itself** — through the ordinary attack verbs, so a
 *     joiner strips the turrets first exactly like a bot that picked the target
 *     for itself (GDD §2.6's patient siege). A raider is a raider; the only thing
 *     that changed is who chose the doorstep.
 *
 * Reusing {@link attack} also means the joiner **re-broadcasts the push** on its
 * own cooldown, so a raid two bots have joined keeps talking even if the bot that
 * opened it dies. That falls out of the reuse rather than being wired, which is
 * the point of doing it this way round.
 */
export function joinAssault(ctx: BotCtx): readonly Action[] | null {
  const latch = ctx.brain.allyAssault;
  const objective = allyResponseTarget(latch);
  if (objective < 0) return null;

  const defender = intruderNear(ctx, latch.at);
  if (defender) return engage(ctx, defender.pos, 16, WEAPON_RANGE * 0.6, defender.vel, defender.id);

  for (const station of ctx.view.stations) {
    if (station.owner !== objective || !station.alive) continue;
    const target = scoreStation(ctx, station);
    const suppress = suppressTurrets(ctx, target);
    return suppress ?? attack(ctx, target);
  }
  return null;
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
  // Going in on a home: say so, so a teammate in range can come too (the
  // developer, 2026-08-07 — *"equally should try to attack when team mates go on
  // offensive"*). Cooldown-gated, silent on ship targets, and a no-op with no RNG
  // draw in FFA, where there is nobody to tell (`callPush`).
  callPush(ctx, target);
  return engage(ctx, target.pos, target.radius, SIEGE_STANDOFF);
}

/**
 * Take the turrets off a station first, from outside their range — the patient
 * siege (GDD §2.6). Returns null when the bot cannot see any turret on the
 * target, which includes "it is too far away to count barrels": a bot that
 * cannot see the guns does not get to plan around them.
 */
export function suppressTurrets(ctx: BotCtx, target: TargetScore): readonly Action[] | null {
  const memo = ctx.memory.station(target.id);
  if (!memo || memo.turrets === null || memo.turrets <= 0) return null;
  // Stripping the guns off a home is the opening move of a raid, not a separate
  // activity, so it announces on the same terms `attack` does. Below the guard
  // above, so a bot that turned out to have no turrets to shoot at says nothing
  // here and says it from `attack` instead — one call either way, never two.
  callPush(ctx, target);
  // Turrets ring the station; the nearest arc of that ring is the first barrel.
  const out = toward(memo.pos, ctx.self.pos);
  const mount = STATION.radius + TURRET.mountOffset;
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

/** The nearest engageable **enemy** ship within `range` — the thing that could be
 *  shooting at this bot. The break-off band reads it at two ranges (enter/exit),
 *  so the range is a parameter rather than a constant.
 *
 *  Hostility comes from the one predicate ({@link isTargetable} → `hostile` →
 *  `sim/allegiance.ts`): a teammate cannot shoot this bot (`canDamage`), so it is
 *  not something to flee from and not something to be cornered by. Before
 *  p16-01 a wounded TEAMS bot fled its own escort, and — worse — the cornered
 *  branch could commit to *fighting* the teammate parked between it and home. */
export function nearestThreat(ctx: BotCtx, range: number): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  for (const ship of ctx.view.ships) {
    if (!isTargetable(ship)) continue;
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
  const station = ctx.self.station;
  if (!station || !station.alive || ctx.view.collapsed) return false;
  return station.underAttack && station.coreHp < station.maxCoreHp * CORE_FINAL_ASSAULT;
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
  // Cornered and committed: there is no retreat to want, because the road home
  // runs through the thing being run from (`./cornered`; ratified p15 point 2 —
  // "no fear re-evaluation mid-commitment"). The flee latch is *released* rather
  // than merely ignored, so when the commitment lifts the bot re-reads its nerve
  // from scratch instead of silently resuming a run it abandoned to fight —
  // exactly how the last stand pre-empts a retreat.
  if (corneredCommitted(ctx.brain.cornered, ctx.view.time)) {
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
  const station = ctx.self.station;
  // Say it out loud on the way out. This is the `help` call, and it is the one
  // thing the ally klaxon genuinely cannot carry: the klaxon rings for a *home*,
  // and a teammate jumped in open space has no klaxon (`./radio`). A call for
  // help is a fact about yourself, so it is legal under any fog; cooldown-gated,
  // and silent in FFA, where there is nobody to hear it.
  callHelp(ctx);
  if (station && station.alive && !threatAtHome(ctx, threat)) {
    return [go(ctx, arrive(ctx.self, station.pos, ARRIVE_RADIUS)), fire(false)];
  }
  if (threat) return [go(ctx, flee(ctx.self, threat.pos)), fire(false)];
  return [thrust({ x: 0, y: 0 }), fire(false)];
}

/**
 * Is the thing this bot is afraid of already sitting *on* its home?
 *
 * The one place that question is answered, because two behaviors need the same
 * answer and must not drift apart: {@link retreat} uses it to decide that
 * running home is running into the siege, and {@link corneredBlockader} uses it
 * to rule out calling a siege a blockade — a ship parked on the destination is
 * not standing between the bot and the destination, and the defend/last-stand
 * branches already own that case (GDD §2.6).
 */
export function threatAtHome(ctx: BotCtx, threat: PerceivedShip | null): boolean {
  const station = ctx.self.station;
  return (
    station !== null && station.alive && threat !== null && dist(threat.pos, station.pos) < GUARD_RADIUS * 2
  );
}

// ---------------------------------------------------------------------------
// Cornered — the blockade, and the commitment to fight it (developer report
// p15, ratified: "a blockaded bot FIGHTS — no dithering")
// ---------------------------------------------------------------------------

/**
 * The minimum window a cornered bot fights for, seconds, with its fear model
 * switched off (`./cornered`; ratified point 2).
 *
 * It has to outlast the thing it is fixing, exactly like the wedge escape run
 * ({@link ESCAPE_SECONDS}) does: a one-decision "commitment" is another twitch.
 * Long enough to actually close the stand-off and land shots — several seconds
 * of weapon time at any tier's cadence — and short enough that a bot whose
 * blockade genuinely lifts is not still swinging at a ship that left. The
 * commitment renews itself for as long as the geometry stays shut, so this is a
 * floor on how briefly a bot may change its mind, never a ceiling on the fight.
 * TUNABLE
 */
export const CORNERED_COMMIT_SECONDS = 4;

/** The ship in view with this slot, if it is still worth fighting and still
 *  here. `null` covers all three ways a commitment ends on its own — it died,
 *  it was eliminated, or it broke off past the retreat band. A teammate is never
 *  a blockader ({@link isTargetable}): it is in the way, which is what
 *  `go`'s obstacle avoidance is for, not something to commit to fighting. */
function blockaderInView(ctx: BotCtx, id: PlayerId): PerceivedShip | null {
  for (const ship of ctx.view.ships) {
    if (ship.id !== id) continue;
    if (!isTargetable(ship) || ship.distance > RETREAT_CLEAR_RANGE) return null;
    return ship;
  }
  return null;
}

/**
 * The ship this bot is cornered by and has committed to fighting, or `null`.
 *
 * The developer's frame, in code: a damaged bot, its own station behind an enemy
 * parked on the line between them, fear and home pulling exactly against each
 * other. This is the read that breaks the tie, and it runs in two modes:
 *
 *  - **Committed.** Inside the minimum window, with the blockader still alive
 *    and still here, nothing is re-derived and nothing is re-voted on. That is
 *    ratified point 2 — "no fear re-evaluation mid-commitment" — and it is why
 *    this check comes first. The commitment ends by itself the moment the
 *    blockader dies or breaks off (`blockaderInView` returns `null`).
 *  - **Reading.** Otherwise: is this bot even afraid (`isWounded` — only fear
 *    can build the trap fear is caught in), is there a threat, is it *not*
 *    simply besieging the destination, and does `@sim/blockade` say the road is
 *    shut? An unbroken run of shut reads longer than the tier's
 *    `blockadeDetectSeconds` commits (ratified point 3: Hard almost at once,
 *    Easy after a visible wobble).
 *
 * Fog-honest throughout: positions and hull class come from the view — a
 * silhouette is public information (GDD §2.11) — and the blockader's speed is
 * priced off its class alone (`classTopSpeed`), never off engine tiers this bot
 * never scouted.
 */
export function corneredBlockader(ctx: BotCtx): PerceivedShip | null {
  const latch = ctx.brain.cornered;
  const now = ctx.view.time;
  const station = ctx.self.station;
  // No home to be cut off from, no life to save, and in collapse there is
  // nothing to run to anyway (GDD §2.3) — every tier already fights to the end.
  if (!ctx.self.alive || ctx.view.collapsed || station === null || !station.alive) {
    resetCornered(latch);
    return null;
  }

  const heldId = corneredHeld(latch, now);
  if (heldId >= 0) {
    const held = blockaderInView(ctx, heldId);
    if (held !== null) {
      release(ctx.brain.fleeing);
      return held;
    }
    resetCornered(latch); // it died, or it broke off: the path is open again
    return null;
  }

  // Prefer re-reading against the ship already under suspicion, so a threat that
  // has held the lane keeps its detection clock rather than restarting it every
  // time another hull drifts marginally closer.
  const threat = (latch.target >= 0 ? blockaderInView(ctx, latch.target) : null)
    ?? nearestThreat(ctx, RETREAT_CLEAR_RANGE);
  if (threat === null || !isWounded(ctx) || threatAtHome(ctx, threat)) {
    resetCornered(latch);
    return null;
  }

  const shut = corneredReading({
    from: ctx.self.pos,
    to: station.pos,
    threat: threat.pos,
    ownSpeed: topSpeedOf(ctx.self),
    threatSpeed: classTopSpeed(threat.shipClass),
  }).cornered;
  const committedTo = corneredCommit(
    latch,
    now,
    threat.id,
    shut,
    ctx.tuning.blockadeDetectSeconds,
    CORNERED_COMMIT_SECONDS,
  );
  if (committedTo < 0) return null;
  // A committed bot is not fleeing — say so in the state, not just in the tree's
  // priority order. The flee latch is dropped at the moment of commitment (and
  // on every decision the commitment holds), so when the window finally closes
  // the bot re-reads its nerve from scratch instead of silently resuming the run
  // it abandoned to fight. `wantsRetreat`'s own guard is then a safety net for
  // any future tree that orders these two differently, rather than the only
  // thing holding the invariant up.
  release(ctx.brain.fleeing);
  return threat;
}

/** Does this bot want to be fighting its way out right now? The tree's test —
 *  `./easy`, `./medium` and `./hard` all place it directly above the retreat,
 *  because it is the branch that says the retreat is not available. */
export function wantsCorneredFight(ctx: BotCtx): boolean {
  return corneredBlockader(ctx) !== null;
}

/**
 * Fight the blockade: full engagement on the ship in the way, at knife range,
 * until it dies, breaks off, or the path opens (ratified point 2).
 *
 * Deliberately the same `engage` every other attack uses — a cornered bot is not
 * given a special weapon or a special aim, only a decision it holds to. Its
 * tier's spread and lead-lag still apply, so an Easy bot cornered is an Easy bot
 * *fighting*, which is the point: "the blockader is often weaker than the fear
 * model assumes" (the developer's own hull was 22/60 in the frame).
 */
export function fightBlockade(ctx: BotCtx, threat: PerceivedShip): readonly Action[] {
  return engage(ctx, threat.pos, SHIP_RADIUS, WEAPON_RANGE * 0.6, threat.vel, threat.id);
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
  // The cornered commitment is a commitment like any other, and a core about to
  // die outranks it too: drop it, so a bot that was fighting its way home stops
  // fighting *out there* and comes back to the thing that is not cheap (GDD
  // §2.7). It re-earns the read from scratch if the blockade is still up after.
  resetCornered(ctx.brain.cornered);
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

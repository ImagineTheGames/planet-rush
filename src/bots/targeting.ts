/**
 * src/bots/targeting.ts — who to hit, and when to stop. OWNER: Bot Engineer
 * (GDD §2.9).
 *
 * The design's one sentence about Hard bots is a scoring function:
 *
 * > it evaluates targets by *threat, proximity, and opportunity* — it punishes
 * > whoever it can profitably punish (the miner far from home, the planet whose
 * > alarm went unanswered, the wreck nobody is guarding). (GDD §2.9)
 *
 * So the three terms are named, each is computed in [0, 1] from the fog-honest
 * view (plus expiring memory, `./memory`), and the tiers differ only in how much
 * of it they use: Easy asks "is something shooting at my house?", Medium adds
 * "who is winning?", Hard weighs all three and travels for the answer. The
 * personality weights are the last multiplier on top — Warden (homebody 1.0)
 * leans on threat-near-home, Sable (opportunism 0.9) on opportunity — so two
 * Hard bots with the same tree pick different fights.
 *
 * **Nothing in this file can see anything a human could not.** Every input is a
 * `PerceivedShip`/`PerceivedPlanet` field or a memo taken from one. An unscouted
 * core reads as `null` and the score falls back to an *assumption* — which is
 * exactly what a player does, and exactly why scouting is worth the trip.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { ShipClass } from '@shared/types';
import { PLANET, SPAWN_PROTECTION_S, TURRET, WEAPON_RANGE } from '../sim';
import type { PerceivedAsteroid, PerceivedPlanet, PerceivedShip } from './perception';
import { estimateOre } from './perception';
import type { DifficultyTuning, PersonalityWeights } from './personalities';
import { dist } from './steering';
import type { BotCtx } from './tree';

/** Clamp to the unit interval — every scoring term lives there. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---------------------------------------------------------------------------
// Index-blind tie-breaks (p8 aggression-bias field question)
// ---------------------------------------------------------------------------

/**
 * An **index-blind** symmetry-break for a dead heat between two targets owned by
 * different slots, judged by the bot in `observer` (its own `ctx.self.id`).
 *
 * The scoring terms are continuous, so an exact score tie is a genuine dead heat
 * — two rivals a bot has no honest reason to separate. The obvious `a.id < b.id`
 * hands every such tie to the **lowest slot id**, and that is not a rare corner:
 * an *unscouted* rival core reads as full with no turrets, so `leaderPlanet`
 * scores every un-visited home at one identical standing, and early-match a bot's
 * whole board is tied there — "gang the leader" then silently means "gang slot
 * 0". Measured, the lowest-id tie-break sends 7 of 8 observers at slot 0 with
 * slots 2–7 never chosen (see `tests/harness/aggression-bias.test.ts`). That is a
 * slot-position bias — player 0 draws fire it did nothing to earn.
 *
 * The fix is the ratified mulberry32 avalanche (`@shared/types`) used as a hash,
 * **keyed by the observer** so different bots break the same dead heat toward
 * different slots — across the cast no single slot is preferred — while a given
 * bot's pick stays a pure function of the ids, so it is stable from one decision
 * to the next and a bot never dithers between two equal rivals (which a freshly
 * drawn RNG value each tick would cause). Deterministic, so replays are
 * unaffected (GDD §4.8), and it only ever changes the outcome of an *exact* tie.
 */
export function tiebreakKey(observer: PlayerId, candidate: PlayerId): number {
  let h = (Math.imul(observer + 1, 0x9e37_79b9) ^ Math.imul(candidate + 1, 0x85eb_ca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0_aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a_2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * True when `candidate` should displace `best` on an exact-score dead heat: the
 * higher index-blind key wins, and an astronomically rare key collision falls
 * back to the lower id so the order stays total and deterministic.
 */
export function breaksTie(observer: PlayerId, candidate: PlayerId, best: PlayerId): boolean {
  const kc = tiebreakKey(observer, candidate);
  const kb = tiebreakKey(observer, best);
  return kc > kb || (kc === kb && candidate < best);
}

// ---------------------------------------------------------------------------
// Nerve: when a bot breaks off (GDD §2.9 — Easy "retreats at half hull")
// ---------------------------------------------------------------------------

/**
 * Hull fraction at which this bot disengages: the **tier's** threshold scaled by
 * the character's `caution`. Easy's tier value is 0.5, so an Easy bot with a
 * neutral nerve retreats at exactly half hull, as the GDD says — while timid
 * Rusty (caution 1.3) breaks off earlier and reckless Bolt (0.5) stays in a
 * fight he is losing.
 *
 * Clamped to [0.15, 0.9] so no personality can turn a tier's nerve into either
 * suicide or a bot that flees at the first scratch.
 */
export function retreatThreshold(tuning: DifficultyTuning, weights: PersonalityWeights): number {
  return Math.min(0.9, Math.max(0.15, tuning.retreatHullFraction * weights.caution));
}

/** Is this bot hurt enough to want out of a fight? */
export function isWounded(ctx: BotCtx): boolean {
  return ctx.self.hullFraction < retreatThreshold(ctx.tuning, ctx.weights);
}

// ---------------------------------------------------------------------------
// Reading the field
// ---------------------------------------------------------------------------

/** Can this ship be hurt at all right now? Spawn protection is a visible glow
 *  (style-guide §8), so reading it is fair; out of range it is `null` and the
 *  bot assumes the worst about its own information, not the best. */
export function isEngageable(ship: PerceivedShip): boolean {
  return ship.alive && !ship.eliminated && ship.spawnProtected !== true;
}

/** How threatening a hull looks on sight (GDD §2.11 roles). The Interceptor
 *  "catches miners in the open", so it is the one you turn to face. */
export function classThreat(cls: ShipClass): number {
  switch (cls) {
    case ShipClass.Interceptor:
      return 1;
    case ShipClass.Excavator:
      return 0.8;
    case ShipClass.Vanguard:
      return 0.7;
    case ShipClass.Hauler:
      return 0.55;
  }
}

/**
 * How close to *this bot's own home* a point is, as a 0..1 alarm. Zero past
 * `HOME_ALARM_RANGE`, one on the doorstep. The homebody dial multiplies it.
 */
export const HOME_ALARM_RANGE = 520;

export function homeProximity(ctx: BotCtx, pos: Vec2): number {
  const planet = ctx.self.planet;
  if (!planet) return 0;
  return 1 - clamp01(dist(planet.pos, pos) / HOME_ALARM_RANGE);
}

/** The nearest enemy ship inside the home alarm ring — the intruder a defender
 *  turns to meet (GDD §2.6: "turrets deter; the ship defends"). */
export function homeIntruder(ctx: BotCtx): PerceivedShip | null {
  const planet = ctx.self.planet;
  if (!planet) return null;
  let best: PerceivedShip | null = null;
  let bestD = HOME_ALARM_RANGE;
  for (const ship of ctx.view.ships) {
    if (!isEngageable(ship)) continue;
    const d = dist(planet.pos, ship.pos);
    if (d < bestD) {
      bestD = d;
      best = ship;
    }
  }
  return best;
}

/** The nearest engageable enemy ship, at any range in view. */
export function nearestEnemy(ctx: BotCtx): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  for (const ship of ctx.view.ships) {
    if (!isEngageable(ship)) continue;
    if (best === null || ship.distance < best.distance) best = ship;
  }
  return best;
}

/** Half-width of the approach corridor a hostile has to sit inside to spoil a
 *  mining site (p11 field report point 1). One weapon-range-and-a-bit either
 *  side of the straight line to the rock: a ship this close to the path can open
 *  fire on the miner before it ever reaches the standoff, which is exactly the
 *  "threat on the path" the report describes. TUNABLE */
export const PATH_THREAT_RADIUS = WEAPON_RANGE * 1.4;

/** How hard a fully-blocked approach divides a site's score down. At 3, a rock
 *  whose path runs straight through a hostile is worth a quarter of the same
 *  rock on a clean line — enough that a clean field one corridor further out
 *  wins the pick, which is the developer's scenario resolving itself. TUNABLE */
export const PATH_THREAT_PENALTY = 3;

/** Shortest distance from point `p` to segment `a`→`b`. The approach path is a
 *  segment, not a ray, so a hostile behind the miner or past the rock does not
 *  count as "on the path". IEEE-exact sqrt, for the determinism reason
 *  `./perception` gives. */
function segmentDist(a: Vec2, b: Vec2, p: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 1e-9 ? clamp01((apx * abx + apy * aby) / len2) : 0;
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * How clear the run to a rock is, in (0, 1]: 1 for a path no hostile is near,
 * shrinking toward `1 / (1 + PATH_THREAT_PENALTY)` as a ship closes on the line
 * the miner would fly. The worst single hostile sets it — a corridor with two
 * threats is not twice as bad as one, it is just blocked (p11).
 */
function pathClearance(ctx: BotCtx, to: Vec2): number {
  const from = ctx.self.pos;
  let worst = 0;
  for (const ship of ctx.view.ships) {
    if (!isEngageable(ship)) continue;
    const d = segmentDist(from, to, ship.pos);
    if (d >= PATH_THREAT_RADIUS) continue;
    const near = 1 - d / PATH_THREAT_RADIUS;
    if (near > worst) worst = near;
  }
  return 1 / (1 + PATH_THREAT_PENALTY * worst);
}

/** Drop tabu sites whose cool-down has lifted (`Brain.tabu`, p11). Deletes
 *  during iteration, which a `Map` allows and which stays deterministic because
 *  the map is insertion-ordered and the clock is the sim's own `view.time`. */
function pruneTabu(ctx: BotCtx): void {
  const now = ctx.view.time;
  for (const [id, until] of ctx.brain.tabu) {
    if (until <= now) ctx.brain.tabu.delete(id);
  }
}

/**
 * The rock worth mining: estimated payout against the trip to reach it
 * (GDD §5.5 — "let a player judge a payout before committing weapon time"),
 * **discounted by the threat along the approach and excluding sites on
 * cool-down** (p11 field report).
 *
 * Fog-honest — {@link estimateOre} reads size and crack stage, never `ore`, and
 * the path threat is read off ships already filtered to visual range. Ties break
 * on the lower id so the choice is stable frame to frame and a bot never dithers
 * between two identical rocks.
 *
 * A site whose approach a retreat just broke off is booked tabu on the brain
 * (`./behaviors`), so this skips it and commits to the next-best field — no
 * re-litigating the same rock while the threat sits on the path. When *every*
 * visible rock is tabu the bot mines nothing this decision and the tree falls
 * through to roam, which carries it somewhere new to look — deliberately not a
 * fall-back that re-includes the cooled sites, because flying back at them is
 * the exact loop the tabu exists to break.
 */
export function bestRock(ctx: BotCtx): PerceivedAsteroid | null {
  pruneTabu(ctx);
  const tabu = ctx.brain.tabu;
  let best: PerceivedAsteroid | null = null;
  let bestScore = 0;
  for (const rock of ctx.view.asteroids) {
    if (tabu.has(rock.id)) continue;
    const payout = estimateOre(rock) / (1 + rock.distance / 150);
    const score = payout * pathClearance(ctx, rock.pos);
    if (score > bestScore || (best !== null && score === bestScore && rock.id < best.id)) {
      bestScore = score;
      best = rock;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Target scoring — threat × proximity × opportunity (GDD §2.9)
// ---------------------------------------------------------------------------

/** One scored candidate. The three terms are kept alongside the total because
 *  they are the explanation — and because the tests assert on them directly. */
export interface TargetScore {
  readonly kind: 'ship' | 'planet';
  /** The slot that owns the target (its ship, or its home). */
  readonly id: PlayerId;
  readonly pos: Vec2;
  /** Body radius, for the stand-off maths in `./behaviors`. */
  readonly radius: number;
  /** The target's velocity when last seen, for intercept lead (design amendment
   *  v0.2: combat is a projectile, so a bot must aim where a mover *will be*).
   *  Present for ships; a home never moves, so it is omitted for planets and the
   *  lead collapses to a straight shot. */
  readonly vel?: Vec2;
  readonly threat: number;
  readonly proximity: number;
  readonly opportunity: number;
  readonly score: number;
}

/** The tier-neutral mix. Personality weights lean it; nothing here is a cheat —
 *  every term is computed from the view. TUNABLE */
export const TARGET_MIX = { threat: 0.34, proximity: 0.28, opportunity: 0.38 } as const;

/** Distance past which a ship counts as fully "caught in the open", measured
 *  from its own front door. Roughly the trip a miner makes to the field. TUNABLE */
export const EXPOSED_RANGE = 560;

/**
 * What a ship target is worth once the field is spent. Respawning is free and
 * fast — "the cost of dying is *time and position*" (GDD §2.7) — so in the
 * collapse phase killing a rival's ship buys five seconds of their absence,
 * while killing a core wins the match. A good human stops duelling and starts
 * besieging; this discount is that instinct, and it is the difference between a
 * match that ends and eight bots trading hull forever. TUNABLE
 */
export const COLLAPSE_SHIP_DISCOUNT = 0.3;

/** Personality-leaned mix for this bot. */
function mixFor(weights: PersonalityWeights): { threat: number; proximity: number; opportunity: number } {
  return {
    threat: TARGET_MIX.threat * (0.6 + 0.8 * weights.homebody),
    proximity: TARGET_MIX.proximity,
    opportunity: TARGET_MIX.opportunity * (0.6 + 0.8 * weights.opportunism),
  };
}

function total(
  weights: PersonalityWeights,
  threat: number,
  proximity: number,
  opportunity: number,
): number {
  const mix = mixFor(weights);
  return mix.threat * threat + mix.proximity * proximity + mix.opportunity * opportunity;
}

/**
 * Score an enemy **ship**.
 *
 *  - *threat* — what it is (hull class), whether it is firing, and how close
 *    it is to this bot's own planet. A firing Interceptor over your house is the
 *    highest-threat thing in the game.
 *  - *proximity* — how cheap it is to reach, as a fraction of visual range.
 *  - *opportunity* — how profitably it can be punished *now*: how wounded it
 *    looked when last seen (the hull bar floats over every ship on screen —
 *    GDD §2.2), and how far it has strayed from its own front door. That second
 *    term is "the miner far from home", spelled arithmetically.
 *
 * A spawn-protected ship scores zero opportunity: it cannot be hurt, so hitting
 * it is not an opportunity, it is a waste of a shot (GDD §2.1).
 */
export function scoreShip(ctx: BotCtx, ship: PerceivedShip): TargetScore {
  const threat = clamp01(
    0.35 * classThreat(ship.shipClass) + 0.25 * (ship.firing ? 1 : 0) + 0.4 * homeProximity(ctx, ship.pos),
  );
  const proximity = 1 - clamp01(ship.distance / ctx.view.perception.visualRange);

  // Wounded: only from the hull bar, which is a visual-range read. Out of range
  // it is null and the bot assumes an average target rather than a soft one.
  const wounded = ship.hull !== null ? 1 - clamp01(ship.hull / Math.max(1e-9, ship.maxHull)) : 0.25;
  const home = ctx.memory.planet(ship.id);
  const exposed = home ? clamp01(dist(home.pos, ship.pos) / EXPOSED_RANGE) : 0.5;
  const engageable = isEngageable(ship);
  const opportunity = engageable ? clamp01(0.55 * wounded + 0.45 * exposed) : 0;
  const worth = ctx.view.collapsed ? COLLAPSE_SHIP_DISCOUNT : 1;

  return {
    kind: 'ship',
    id: ship.id,
    pos: ship.pos,
    vel: ship.vel,
    radius: 16,
    threat,
    proximity,
    opportunity,
    score: engageable ? worth * total(ctx.weights, threat, proximity, opportunity) : 0,
  };
}

/**
 * Score an enemy **home**.
 *
 *  - *threat* — that player's standing: a healthy, well-defended core belonging
 *    to a neighbour is the thing that beats you later. This term is also how
 *    "gangs up on the current leader" (GDD §2.9, Medium) falls out of one
 *    scoring function instead of a special case.
 *  - *proximity* — surface distance over visual range.
 *  - *opportunity* — how crackable it is *now*: a scouted-low core, an alarm
 *    nobody answered (under attack, owner's ship not at home), and thin turret
 *    cover. Discounted by how stale the scouting is, so a Hard bot's fresher
 *    memory is worth something and a ten-second-old read is worth less.
 *
 * A wreck scores zero — it has no core left to kill (GDD §2.7). Its *debris* is
 * a separate, scavenger-shaped errand (`./behaviors`).
 */
export function scorePlanet(ctx: BotCtx, planet: PerceivedPlanet): TargetScore {
  const memo = ctx.memory.planet(planet.owner);
  const surface = Math.max(0, planet.distance - planet.radius);
  const proximity = 1 - clamp01(surface / ctx.view.perception.visualRange);

  // Standing: an unscouted core is assumed *healthy*, which is the pessimistic
  // reading and the one that makes a bot go and look.
  const coreFraction = memo?.coreFraction ?? 1;
  const turrets = memo?.turrets ?? null;
  const standing = clamp01(0.6 * coreFraction + 0.4 * clamp01((turrets ?? TURRET.capPerPlanet / 2) / TURRET.capPerPlanet));
  const threat = clamp01(0.55 * standing + 0.45 * homeProximity(ctx, planet.pos));

  // Freshness of the scouting behind the opportunity terms (GDD §2.2: fog).
  const age = ctx.memory.planetAge(planet.owner);
  const freshness = Number.isFinite(age) ? clamp01(1 - age / Math.max(1e-9, ctx.tuning.memorySeconds)) : 0;

  const wounded = memo?.coreFraction !== null && memo?.coreFraction !== undefined ? 1 - memo.coreFraction : 0.3;
  const ownerHome = ctx.memory.ship(planet.owner, ctx.tuning.memorySeconds);
  const defended = ownerHome ? (dist(ownerHome.pos, planet.pos) < PLANET.dockRange * 1.5 ? 1 : 0) : 0.5;
  const alarmUnanswered = memo?.underAttack === true && defended < 1 ? 1 : 0;
  const thinCover = 1 - clamp01((turrets ?? TURRET.capPerPlanet / 2) / TURRET.capPerPlanet);

  // Spawn protection is match-start-wide and the match clock is public (GDD §2.2
  // — the wave clock), so a bot knows without peeking that nothing is crackable
  // in the opening seconds.
  const crackable = planet.alive && ctx.view.time >= SPAWN_PROTECTION_S;
  const opportunity = crackable
    ? clamp01(0.4 * wounded * freshness + 0.3 * alarmUnanswered + 0.15 * (1 - defended) + 0.15 * thinCover)
    : 0;

  return {
    kind: 'planet',
    id: planet.owner,
    pos: planet.pos,
    radius: planet.radius,
    threat,
    proximity,
    opportunity,
    score: crackable ? total(ctx.weights, threat, proximity, opportunity) : 0,
  };
}

/**
 * The best thing to go and hit, or null when nothing is worth the trip. Ships
 * and homes are scored on the same scale on purpose: a bot choosing between
 * chasing a wounded miner and besieging an undefended core should be making one
 * comparison, not two (GDD §2.9).
 *
 * An exact-score dead heat is broken index-blind ({@link breaksTie}, keyed by
 * the observing bot), not by lowest slot id, so no player draws fire merely for
 * sitting in a low slot (p8) — while the pick stays stable frame to frame.
 */
export function bestTarget(ctx: BotCtx, minScore = 0): TargetScore | null {
  let best: TargetScore | null = null;
  const consider = (candidate: TargetScore): void => {
    if (candidate.score <= minScore) return;
    if (best === null || candidate.score > best.score) {
      best = candidate;
      return;
    }
    if (candidate.score === best.score && breaksTie(ctx.self.id, candidate.id, best.id)) best = candidate;
  };

  for (const ship of ctx.view.ships) consider(scoreShip(ctx, ship));
  for (const planet of ctx.view.planets) {
    if (!planet.alive) continue;
    // Homes are only candidates once they are on screen: a bot does not lay
    // siege to a rumour.
    if (planet.distance - planet.radius > ctx.view.perception.visualRange) continue;
    consider(scorePlanet(ctx, planet));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Who is winning (GDD §2.9 — Medium "gangs up on the current leader")
// ---------------------------------------------------------------------------

/**
 * The nearest home still standing that is not this bot's own. Position and
 * wreck state are public at any range — "a burning planet is visible from
 * further away than its numbers are" (GDD §2.2) — so this is a legal read
 * without scouting, and it is the only map-wide fact any tree uses.
 *
 * It exists for the endgame. Once the field is spent there is nothing left to
 * mine and nothing left to repair (GDD §2.3), so a bot with no target in view
 * has exactly one useful thing to do: go and find the last rival. Without this a
 * two-survivor match can sit at opposite ends of the ring forever, each one
 * defending a doorstep nobody is standing on.
 */
export function nearestLivingRival(ctx: BotCtx): PerceivedPlanet | null {
  let best: PerceivedPlanet | null = null;
  for (const planet of ctx.view.planets) {
    if (!planet.alive) continue;
    if (best === null || planet.distance < best.distance) best = planet;
  }
  return best;
}

/**
 * The rival that looks strongest from what this bot has actually seen: core
 * health where it has scouted (assumed full where it has not), turret cover
 * where it has been close enough to count barrels, and still alive.
 *
 * This is a *guess*, and it is supposed to be. A global scoreboard "would let
 * everyone free-ride on every attack; fog makes third-party awareness a skill"
 * (GDD §2.2) — so a bot that has scouted nobody thinks the nearest healthy
 * neighbour is the leader, and is often wrong.
 *
 * When several rivals look equally strong — the common early-match case, where
 * every unscouted home reads at one standing — the dead heat is broken
 * index-blind ({@link breaksTie}), not toward slot 0: without that, "gang the
 * leader" quietly means "gang the lowest slot" (p8 aggression-bias fix).
 */
export function leaderPlanet(ctx: BotCtx): PerceivedPlanet | null {
  let best: PerceivedPlanet | null = null;
  let bestStanding = -1;
  for (const planet of ctx.view.planets) {
    if (!planet.alive) continue;
    const memo = ctx.memory.planet(planet.owner);
    const core = memo?.coreFraction ?? 1;
    const turrets = memo?.turrets ?? 0;
    const standing = 0.7 * core + 0.3 * clamp01(turrets / TURRET.capPerPlanet);
    if (
      standing > bestStanding ||
      (best !== null && standing === bestStanding && breaksTie(ctx.self.id, planet.owner, best.owner))
    ) {
      bestStanding = standing;
      best = planet;
    }
  }
  return best;
}

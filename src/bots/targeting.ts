/**
 * src/bots/targeting.ts — who to hit, and when to stop. OWNER: Bot Engineer
 * (GDD §2.9).
 *
 * The design's one sentence about Hard bots is a scoring function:
 *
 * > it evaluates targets by *threat, proximity, and opportunity* — it punishes
 * > whoever it can profitably punish (the miner far from home, the station whose
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
 * `PerceivedShip`/`PerceivedStation` field or a memo taken from one. An unscouted
 * core reads as `null` and the score falls back to an *assumption* — which is
 * exactly what a player does, and exactly why scouting is worth the trip.
 *
 * **And nothing in this file decides who the enemy is.** Every friend/foe
 * question here — the intruder in the alarm ring, the nearest engageable ship,
 * the hostile on a mining corridor, the home worth besieging, the "leader" to
 * gang up on — is {@link isFoe}, which reads the `hostile` stamp `./perception`
 * takes from `sim/allegiance.ts`'s `areEnemies`. That module is by its own header
 * *"the ONE friend/foe predicate"*, so this layer owns no second notion of
 * hostility and must never grow one: FFA vs TEAMS is a difference in the `team`
 * table, not a difference in any code path here.
 *
 * Before p16-01 these functions were merely *named* for hostility and asked only
 * "is that another ship?". In FFA that is the same set — teams-of-one makes
 * `areEnemies` reduce to `a !== b` — which is why every gate stayed green while a
 * TEAMS bot chased its own teammates (developer report, "team B bots was
 * attacking each other"). Self-immunity comes free from the `a === b`
 * short-circuit inside `areEnemies`; it is not re-implemented here.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { ShipClass } from '@shared/types';
import { STATION, SPAWN_PROTECTION_S, TURRET, WEAPON_RANGE } from '../sim';
import type { PerceivedAsteroid, PerceivedStation, PerceivedShip } from './perception';
import { estimateOre } from './perception';
import type { DifficultyTuning, PersonalityWeights } from './personalities';
import { receive } from './radio';
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
 * an *unscouted* rival core reads as full with no turrets, so `leaderStation`
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

/**
 * **Is that a foe?** The single question, asked the single way: the `hostile`
 * stamp `./perception` takes from `sim/allegiance.ts`'s `areEnemies`. Ships and
 * homes both carry it, so one predicate covers both kinds of target and the two
 * can never disagree about a slot.
 *
 * A bare field read, deliberately a *named function* anyway: it is the seam where
 * this layer's hostility question meets the sim's answer, and a named seam is
 * what makes "did we route this through allegiance?" a grep rather than an audit.
 */
export function isFoe(seen: { readonly hostile: boolean }): boolean {
  return seen.hostile;
}

/** Can this ship be hurt at all right now? Spawn protection is a visible glow
 *  (style-guide §8), so reading it is fair; out of range it is `null` and the
 *  bot assumes the worst about its own information, not the best.
 *
 *  **Allegiance is a separate question** ({@link isFoe}) and every caller asks
 *  both: this one is about the target's *state*, not its *side*, and folding the
 *  two together here would hide a friendly-fire gate inside a spawn-protection
 *  check. */
export function isEngageable(ship: PerceivedShip): boolean {
  return ship.alive && !ship.eliminated && ship.spawnProtected !== true;
}

/** Engageable **and** an enemy — the full "may I shoot this?" test, and what
 *  every ship-picking function below filters on. */
export function isTargetable(ship: PerceivedShip): boolean {
  return isFoe(ship) && isEngageable(ship);
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
  const station = ctx.self.station;
  if (!station) return 0;
  return 1 - clamp01(dist(station.pos, pos) / HOME_ALARM_RANGE);
}

/** The nearest enemy ship inside the home alarm ring — the intruder a defender
 *  turns to meet (GDD §2.6: "turrets deter; the ship defends").
 *
 *  An **intruder is a foe**: a teammate flying home to dock is the most ordinary
 *  sight in a TEAMS match, and before p16-01 it was what a defending bot turned
 *  and opened fire on (repro, slot 5 vs slot 4). */
export function homeIntruder(ctx: BotCtx): PerceivedShip | null {
  const station = ctx.self.station;
  if (!station) return null;
  return intruderNear(ctx, station.pos);
}

/**
 * The nearest enemy ship inside the alarm ring around **any** point — the same
 * question {@link homeIntruder} asks, with the doorstep as a parameter.
 *
 * It exists because Stage 2 of `docs/team-bots-plan.md` gave a bot a *second*
 * doorstep to care about: a teammate's. A responder needs "is there anything to
 * fight at the home I flew to?" and the answer must be the identical predicate,
 * at the identical radius, with the identical hostility read — two spellings of
 * one question is how the two answers drift apart (plan Trap 9). `homeIntruder`
 * is now this function with the bot's own station passed in.
 */
export function intruderNear(ctx: BotCtx, pos: Vec2): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  let bestD = HOME_ALARM_RANGE;
  for (const ship of ctx.view.ships) {
    if (!isTargetable(ship)) continue;
    const d = dist(pos, ship.pos);
    if (d < bestD) {
      bestD = d;
      best = ship;
    }
  }
  return best;
}

/** The nearest engageable **enemy** ship, at any range in view — an ally is not
 *  a candidate however close it is ({@link isTargetable}). */
export function nearestEnemy(ctx: BotCtx): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  for (const ship of ctx.view.ships) {
    if (!isTargetable(ship)) continue;
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
 *
 * **Only a foe spoils a corridor** ({@link isTargetable}). A teammate on its own
 * mining run cannot open fire on this bot, so counting it as a threat divided a
 * perfectly good field's score by up to four and sent the bot somewhere worse —
 * in TEAMS, where allies spawn adjacent and therefore mine the same fields, that
 * was most of them (p16-01).
 *
 * **Exported for the tests**, like {@link TargetScore}'s three terms and for the
 * same reason: it is the *explanation* behind a pick, and since Stage 3 the pick
 * alone can no longer carry the claim this function makes. With the crowd reach
 * set to one visual range ({@link allyCrowdRadius}), *"on my approach to that
 * rock"* and *"competing with me for that rock"* are the same set of ships, so
 * "an ally is not a threat" and "an ally is competition" move the pick the same
 * way — and only the two terms, read separately, tell them apart.
 */
export function pathClearance(ctx: BotCtx, to: Vec2): number {
  const from = ctx.self.pos;
  let worst = 0;
  for (const ship of ctx.view.ships) {
    if (!isTargetable(ship)) continue;
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

// ---------------------------------------------------------------------------
// Dividing the field (`docs/team-bots-plan.md` Stage 3)
// ---------------------------------------------------------------------------
//
// The spike measured allies **434 units apart in a 2v2**, against the enemy
// pairs' 1042, with 79.3% of the match inside one visual range of each other
// (plan §1.6). *"They are not covering a board; they are flying formation by
// accident."* Two allies mining the same rocks is two economies doing one
// economy's work, and `bestRock` had no notion of who else was going anywhere.
//
// Stage 3 is two mechanisms, and they answer two different halves of the same
// problem. The first needs no channel at all, which is exactly right: most
// contention is *visible* contention, so most of it is solvable without a word.
// The second is for the contention that is not visible.

/**
 * How near a teammate has to be to a rock before it counts as *theirs*: **one
 * visual range**, and therefore not a constant at all —
 * `view.perception.visualRange`.
 *
 * This is the one number in the mechanism that did not need choosing, and the
 * sweep is what established that. Priced end to end over two disjoint 8-seed
 * sets at 450 / 720 / 1000 (`evidence/b3-01-dividing-the-field.json`), 720 was
 * the reach that raised ore on both — and 720 *is* `visualRange`
 * (`./perception` `HUMAN_VISUAL_RANGE`), which is also the only reach the
 * mechanism can honestly have: an ally further away than that is not in
 * `view.ships` at all, so a wider radius is unreachable and a narrower one
 * throws away sightings the bot legitimately has.
 *
 * So the term reads exactly as plan §2.1's candidate (b) states it — *"he is
 * closer to that rock than I am, so I take the other one"* — over precisely the
 * board this bot can see, with no free parameter for how far it looks. Kept as a
 * named function rather than inlined because *"the reach is the sight"* is the
 * argument, and it should be greppable.
 */
function allyCrowdRadius(ctx: BotCtx): number {
  return ctx.view.perception.visualRange;
}

/**
 * How hard a rock a teammate is parked on divides down for me. At 4 a rock with
 * an ally sitting on it is worth a fifth of the same rock in open space — enough
 * that the next field over wins the pick, and never enough to make the rock
 * unpickable.
 *
 * **A multiplier, never a veto** (plan §4.3's named risk): if the only rock in
 * view is the one my teammate is on, I still mine it, because two miners on one
 * rock beats one miner and one bot flying in circles. The same discipline
 * {@link pathClearance} already keeps, in the same shape and with the same
 * "worst single ally sets it" rule so three teammates are not three penalties.
 *
 * **Measured, over two disjoint 8-seed sets against the same matches with the
 * branch absent** (`evidence/b3-01-dividing-the-field.json`). Against a baseline
 * of 12.5% / 12.0% of allied pair-ticks committed to the *same* rock, the grid
 * at `(reach, penalty, claim-hold)`:
 *
 *   | arm        | same rock 2v2 | ore/side 2v2 | ore/side/min 2v2 | same rock 4v4 |
 *   |------------|---------------|--------------|------------------|---------------|
 *   | branch off |  12.5 / 12.0  | 108.4 /116.1 |   7.86 / 8.35    |  15.2 / 13.4  |
 *   | 450, 2, 10 |   9.9 /  8.6  | 116.1 /113.5 |   8.27 / 8.15    |   9.4 /  8.3  |
 *   | 450, 4, 10 |   7.7 /  7.1  | 114.8 /116.2 |   8.38 / 8.33    |   7.3 /  9.0  |
 *   | 720, 2, 20 |   7.5 /  7.2  | 116.1 /112.4 |   8.31 / 8.13    |   6.7 /  7.4  |
 *   | **720,4,10** | **8.0 / 8.4** | **118.1/118.8** | **8.41 / 8.61** | **8.3 / 7.5** |
 *
 * Every arm divides the field; the second seed set is what picks between them.
 * **720/4 is the only arm that raises both ore per side and ore per side-minute
 * on *both* seed sets** — the others each win one set and lose the other, which
 * is the signature of a number fitted to eight seeds rather than measured. That
 * is also why the sweep was run twice on disjoint seeds instead of once on
 * sixteen: a held-out set can falsify an over-fit, a bigger single set cannot.
 * TUNABLE
 */
export const ALLY_CROWD_PENALTY = 4;

/**
 * How much of the discount *this character* applies, leaned by `greed` — the
 * plan's own dial for this question (§4.5: *"a greedy bot defers a rock claim
 * less readily"*), reused rather than replaced by a new knob.
 *
 * `1.5 - greed`, so Vulture (0.9) applies 0.6× of it and defers barely at all
 * while timid Rusty (0.3) applies 1.2×. The cast mean is 0.94, so the constants
 * above are very nearly what the cast as a whole plays at and the character
 * spread costs the team almost nothing on average — the same property
 * `allyResponseRange` was tuned for.
 */
function crowdLean(weights: PersonalityWeights): number {
  return 1.5 - weights.greed;
}

/**
 * **Mechanism 1 — observable-state division, no radio.** How crowded the run to
 * a rock is, in (0, 1]: 1 for a rock no teammate is nearer to, shrinking toward
 * `1 / (1 + ALLY_CROWD_PENALTY)` as a teammate closes on it.
 *
 * This is candidate (b) from plan §2.1 — *"he is closer to that rock than I am,
 * so I take the other one"* — and the `d >= rock.distance` gate is the whole
 * reason it cannot over-divide. Deference is **strictly ordered by distance**:
 * the nearer bot never defers to the further one, so the plan's named failure
 * ("two allies each politely deferring until neither mines the good rock") is
 * not merely unlikely, it is unreachable. An exact tie defers neither, which
 * is the safe direction to be wrong in.
 *
 * O(ships in view) and allocation-free, because `bestRock` runs this for every
 * rock on every decision for every bot (plan §4.3's cost note).
 *
 * **FFA gets exactly 1.0, structurally.** Every ship in an FFA view is hostile
 * (teams-of-one), so the loop finds no candidate, `worst` stays 0, and the
 * result is `1 / (1 + 0)` = 1 exactly — and an IEEE multiply by 1.0 is the
 * identity, so an FFA bot's rock scores are the same bits they were before this
 * function existed (`ffa-parity.test.ts`'s pinned hashes).
 */
export function allyCrowding(ctx: BotCtx, rock: PerceivedAsteroid): number {
  const reach = allyCrowdRadius(ctx);
  let worst = 0;
  for (const ship of ctx.view.ships) {
    // A teammate, alive, and actually able to be working: a wreck or an
    // eliminated slot is not competing for anything.
    if (isFoe(ship) || !ship.alive || ship.eliminated) continue;
    const d = dist(ship.pos, rock.pos);
    // Not near it, or not nearer to it than I am — no claim on it either way.
    if (d >= reach || d >= rock.distance) continue;
    const near = 1 - d / reach;
    if (near > worst) worst = near;
  }
  if (worst === 0) return 1;
  return 1 / (1 + ALLY_CROWD_PENALTY * crowdLean(ctx.weights) * worst);
}

/**
 * How long an ally's `claim` keeps a rock on this bot's tabu list, measured from
 * the moment the claim was **made** rather than heard.
 *
 * Anchoring to `seenAt` is what makes the fold **idempotent**: the same call
 * re-folded on the next decision writes the same number, so there is no
 * "have I already handled this one?" state to keep and no way for a claim to
 * renew itself by being re-read. It also means a claim ages exactly like the
 * news it is — a late-delivered claim is already half spent when it lands.
 *
 * Sized against a mining errand and against the channel: a claim stays readable
 * for `memorySeconds / HEARSAY_STALENESS` (Easy 3 s, Hard 10 s), so a value in
 * that band means an exclusion expires at about the same time the news does
 * instead of long after the teammate has moved on. TUNABLE
 */
export const CLAIM_TABU_SECONDS = 10;

/**
 * **Mechanism 2 — `claim` callouts (plan §4.3.2).** Fold every fresh ally claim
 * this bot can hear into its own {@link Brain.tabu}, so a rock a teammate said
 * it was working is excluded exactly the way a rock this bot broke off from is.
 *
 * **The tier dial is the channel, and no new knob was invented for it.** The
 * plan's §4.5 row — *"honours an ally's rock claim: Easy often ignores it,
 * Medium usually, Hard always"* — falls straight out of the dials Stage 2 already
 * shipped: an Easy bot misses 35% of calls outright (`callMissChance`), hears
 * what it does hear 1.2 s late, and the claim expires on its 6 s `memorySeconds`
 * at a hearsay discount, so it honours a claim for about three seconds if at all;
 * a Hard bot misses 5%, hears in 0.25 s, and honours for ten. That is the same
 * mechanism-not-a-knob discipline as `aimLatency`, and it is why there is no
 * `claimHonour` probability here (which would also have needed a per-claim RNG
 * draw, and therefore dedup state to stop it re-rolling every decision).
 *
 * **It only ever widens.** A claim that would *shorten* an entry this bot put
 * there itself is ignored: a site this bot broke off from under fire (p11) is a
 * decision of its own about its own safety, and a teammate's intent is not
 * grounds to revisit it early.
 *
 * `greed` leans the duration for the same reason it leans the discount above —
 * a greedy character defers less readily.
 */
function foldAllyClaims(ctx: BotCtx): void {
  const radio = ctx.brain.radio;
  if (!radio) return;
  const calls = receive(radio, ctx.self.id, ctx.view.time, ctx.tuning.memorySeconds);
  if (calls.length === 0) return;
  const hold = CLAIM_TABU_SECONDS * crowdLean(ctx.weights);
  for (const call of calls) {
    if (call.kind !== 'claim' || call.key < 0) continue;
    // A claim about a slot that is not on this bot's side is ignored rather than
    // trusted — the same refusal `allyDistress` makes, for the same reason: no
    // branch should act on a malformed record it never sends.
    if (call.about === ctx.self.id || !isAllySlot(ctx, call.about)) continue;
    // A dead heat over the rock I am already on, settled by who called it first
    // (`Brain.mineSiteAt`). Strictly earlier wins, so an exact tie defers
    // neither and two teammates who chose the same rock on the same tick simply
    // both keep it — today's behaviour — rather than both leaving it together
    // and contesting the next one together.
    if (call.key === ctx.brain.mineSite && call.seenAt >= ctx.brain.mineSiteAt) continue;
    const until = call.seenAt + hold;
    const existing = ctx.brain.tabu.get(call.key);
    if (existing === undefined || until > existing) ctx.brain.tabu.set(call.key, until);
  }
}

/** Is this slot on my side? A roster read, not a sighting (`./perception`). */
function isAllySlot(ctx: BotCtx, id: PlayerId): boolean {
  for (const ally of ctx.view.allies) {
    if (ally.id === id) return true;
  }
  return false;
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
 *
 * **And, since Stage 3, discounted by how crowded the rock is with teammates**
 * ({@link allyCrowding}) with an ally's spoken {@link CLAIM_TABU_SECONDS claim}
 * folded into the same tabu list. Both are inert in FFA — there are no allies to
 * be near and no channel to hear — so this function's FFA answer is unchanged to
 * the bit.
 */
export function bestRock(ctx: BotCtx): PerceivedAsteroid | null {
  // Order matters: a claim heard this decision must be on the list before the
  // list is read, and the prune must run after the fold so a claim that landed
  // already expired never lingers a decision longer than its own clock.
  foldAllyClaims(ctx);
  pruneTabu(ctx);
  const tabu = ctx.brain.tabu;
  let best: PerceivedAsteroid | null = null;
  let bestScore = 0;
  for (const rock of ctx.view.asteroids) {
    if (tabu.has(rock.id)) continue;
    const payout = estimateOre(rock) / (1 + rock.distance / 150);
    const score = payout * pathClearance(ctx, rock.pos) * allyCrowding(ctx, rock);
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
  readonly kind: 'ship' | 'station';
  /** The slot that owns the target (its ship, or its home). */
  readonly id: PlayerId;
  readonly pos: Vec2;
  /** Body radius, for the stand-off maths in `./behaviors`. */
  readonly radius: number;
  /** The target's velocity when last seen, for intercept lead (design amendment
   *  v0.2: combat is a projectile, so a bot must aim where a mover *will be*).
   *  Present for ships; a home never moves, so it is omitted for stations and the
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
 *    it is to this bot's own station. A firing Interceptor over your house is the
 *    highest-threat thing in the game.
 *  - *proximity* — how cheap it is to reach, as a fraction of visual range.
 *  - *opportunity* — how profitably it can be punished *now*: how wounded it
 *    looked when last seen (the hull bar floats over every ship on screen —
 *    GDD §2.2), and how far it has strayed from its own front door. That second
 *    term is "the miner far from home", spelled arithmetically.
 *
 * A spawn-protected ship scores zero opportunity: it cannot be hurt, so hitting
 * it is not an opportunity, it is a waste of a shot (GDD §2.1). **An ally scores
 * zero outright** ({@link isTargetable}) — gated here, and not only in
 * {@link bestTarget}, so a tier that scores one candidate by hand (Medium's
 * `mediumTarget`) gets the same answer as one that scores the whole board.
 */
export function scoreShip(ctx: BotCtx, ship: PerceivedShip): TargetScore {
  const threat = clamp01(
    0.35 * classThreat(ship.shipClass) + 0.25 * (ship.firing ? 1 : 0) + 0.4 * homeProximity(ctx, ship.pos),
  );
  const proximity = 1 - clamp01(ship.distance / ctx.view.perception.visualRange);

  // Wounded: only from the hull bar, which is a visual-range read. Out of range
  // it is null and the bot assumes an average target rather than a soft one.
  const wounded = ship.hull !== null ? 1 - clamp01(ship.hull / Math.max(1e-9, ship.maxHull)) : 0.25;
  const home = ctx.memory.station(ship.id);
  const exposed = home ? clamp01(dist(home.pos, ship.pos) / EXPOSED_RANGE) : 0.5;
  const targetable = isTargetable(ship);
  const opportunity = targetable ? clamp01(0.55 * wounded + 0.45 * exposed) : 0;
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
    score: targetable ? worth * total(ctx.weights, threat, proximity, opportunity) : 0,
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
 *  - *opportunity* — how crackable it is *now*: a core seen low, an alarm
 *    nobody answered (under attack, owner's ship not at home), and thin turret
 *    cover. Discounted by how stale the read is, so a Hard bot's fresher memory
 *    is worth something and a ten-second-old read is worth less.
 *
 * A wreck scores zero — it has no core left to kill (GDD §2.7). Its *debris* is
 * a separate, scavenger-shaped errand (`./behaviors`). **An ally's home scores
 * zero** for the same reason a wreck does: there is no win in it. Killing a
 * teammate's core would hand the match to the other side, and the sim would not
 * let the shots land anyway (`canDamage`).
 */
export function scoreStation(ctx: BotCtx, station: PerceivedStation): TargetScore {
  const memo = ctx.memory.station(station.owner);
  const surface = Math.max(0, station.distance - station.radius);
  const proximity = 1 - clamp01(surface / ctx.view.perception.visualRange);

  // Standing: an unscouted core is assumed *healthy*, which is the pessimistic
  // reading and the one that makes a bot go and look.
  const coreFraction = memo?.coreFraction ?? 1;
  const turrets = memo?.turrets ?? null;
  const standing = clamp01(0.6 * coreFraction + 0.4 * clamp01((turrets ?? TURRET.capPerStation / 2) / TURRET.capPerStation));
  const threat = clamp01(0.55 * standing + 0.45 * homeProximity(ctx, station.pos));

  // Freshness of the scouting behind the opportunity terms (GDD §2.2: fog).
  const age = ctx.memory.stationAge(station.owner);
  const freshness = Number.isFinite(age) ? clamp01(1 - age / Math.max(1e-9, ctx.tuning.memorySeconds)) : 0;

  const wounded = memo?.coreFraction !== null && memo?.coreFraction !== undefined ? 1 - memo.coreFraction : 0.3;
  const ownerHome = ctx.memory.ship(station.owner, ctx.tuning.memorySeconds);
  const defended = ownerHome ? (dist(ownerHome.pos, station.pos) < STATION.dockRange * 1.5 ? 1 : 0) : 0.5;
  const alarmUnanswered = memo?.underAttack === true && defended < 1 ? 1 : 0;
  const thinCover = 1 - clamp01((turrets ?? TURRET.capPerStation / 2) / TURRET.capPerStation);

  // Spawn protection is match-start-wide and the match clock is public (GDD §2.2
  // — the wave clock), so a bot knows without peeking that nothing is crackable
  // in the opening seconds.
  const crackable = isFoe(station) && station.alive && ctx.view.time >= SPAWN_PROTECTION_S;
  const opportunity = crackable
    ? clamp01(0.4 * wounded * freshness + 0.3 * alarmUnanswered + 0.15 * (1 - defended) + 0.15 * thinCover)
    : 0;

  return {
    kind: 'station',
    id: station.owner,
    pos: station.pos,
    radius: station.radius,
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

  // Allies are skipped before they are scored rather than after: the score gate
  // in `scoreShip`/`scoreStation` would already zero them, but a teammate is not
  // a candidate the bot rejected — it is not a candidate at all.
  for (const ship of ctx.view.ships) {
    if (!isFoe(ship)) continue;
    consider(scoreShip(ctx, ship));
  }
  for (const station of ctx.view.stations) {
    if (!isFoe(station) || !station.alive) continue;
    // Homes are only candidates once they are on screen: a bot does not lay
    // siege to a rumour.
    if (station.distance - station.radius > ctx.view.perception.visualRange) continue;
    consider(scoreStation(ctx, station));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Who is winning (GDD §2.9 — Medium "gangs up on the current leader")
// ---------------------------------------------------------------------------

/**
 * The nearest **hostile** home still standing. Position and wreck state are
 * public at any range — "a burning station is visible from further away than its
 * numbers are" (GDD §2.2) — so this is a legal read without scouting, and it is
 * the only map-wide fact any tree uses.
 *
 * "Not this bot's own" was enough when FFA was the only mode (`./perception`
 * leaves self out of the view). In TEAMS it sent the endgame hunt at a
 * teammate's doorstep — so the filter is the allegiance stamp, and in FFA it
 * still means every home but this bot's.
 *
 * It exists for the endgame. Once the field is spent there is nothing left to
 * mine and nothing left to repair (GDD §2.3), so a bot with no target in view
 * has exactly one useful thing to do: go and find the last rival. Without this a
 * two-survivor match can sit at opposite ends of the ring forever, each one
 * defending a doorstep nobody is standing on.
 */
export function nearestLivingRival(ctx: BotCtx): PerceivedStation | null {
  let best: PerceivedStation | null = null;
  for (const station of ctx.view.stations) {
    if (!isFoe(station) || !station.alive) continue;
    if (best === null || station.distance < best.distance) best = station;
  }
  return best;
}

/**
 * The rival that looks strongest from what this bot has actually seen: core
 * health where it has looked (assumed full where it has not), turret cover
 * where it has been close enough to count barrels, and still alive.
 *
 * This is a *guess*, and it is supposed to be. Station health stopped being
 * range-gated on 2026-08-07 (GDD §2.2, amended; a0-05), but "always visible" is
 * not "omniscient": the ring is on the station, so a bot still has to have the
 * home *on screen* to read it, exactly as a human does. A bot that has looked at
 * nobody still thinks the nearest healthy neighbour is the leader, and is still
 * often wrong — the guess just gets corrected from four times further out now.
 *
 * When several rivals look equally strong — the common early-match case, where
 * every unread home reads at one standing — the dead heat is broken
 * index-blind ({@link breaksTie}), not toward slot 0: without that, "gang the
 * leader" quietly means "gang the lowest slot" (p8 aggression-bias fix).
 *
 * **The leader is a rival**, so allies are not in the running ({@link isFoe}).
 * They would otherwise win it routinely: a teammate's home is the one a bot has
 * been parked next to all match, so it is the best-read, healthiest-looking
 * standing on the board — "gang up on the leader" meant "besiege your own side"
 * (p16-01).
 */
export function leaderStation(ctx: BotCtx): PerceivedStation | null {
  let best: PerceivedStation | null = null;
  let bestStanding = -1;
  for (const station of ctx.view.stations) {
    if (!isFoe(station) || !station.alive) continue;
    const memo = ctx.memory.station(station.owner);
    const core = memo?.coreFraction ?? 1;
    const turrets = memo?.turrets ?? 0;
    const standing = 0.7 * core + 0.3 * clamp01(turrets / TURRET.capPerStation);
    if (
      standing > bestStanding ||
      (best !== null && standing === bestStanding && breaksTie(ctx.self.id, station.owner, best.owner))
    ) {
      bestStanding = standing;
      best = station;
    }
  }
  return best;
}

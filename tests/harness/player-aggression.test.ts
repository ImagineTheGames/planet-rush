/**
 * tests/harness/player-aggression.test.ts — "are they ignoring me???" measured.
 * (Developer report p15: "I don't think enemies attacked me at all… they
 * attacked each other though.")
 *
 * The brief's instrument, and its acceptance gate. A **scripted human** flies a
 * real FFA match against a homogeneous cast, and every bot decision is tallied
 * by *who it is engaging*: one column for the human, one for the bot rivals. The
 * gap between those two columns IS the bug metric — if the trees treat a human
 * seat as anything other than one more rival, the human column collapses toward
 * zero while the bot column stays healthy, which is exactly what the report
 * describes.
 *
 * ── What counts as an "attack initiation" ────────────────────────────────────
 *
 * A bot's decision engages somebody when the leaf that won the tick is one of the
 * fighting leaves, and that leaf's target resolves to a slot. The leaf name is on
 * the brain (`Brain.lastBehavior`) and the target is recomputed with the *same
 * public function the leaf itself called*, on a read-only context — so this
 * measures the bot's own intent rather than a proxy for it, and it is blind to
 * whether the shot happened to land. An **initiation** is the decision where that
 * victim CHANGES (a new engagement); the decisions that follow are dwell, tallied
 * separately. Damage absorbed is tallied alongside as the outcome column, because
 * intent that never lands is what a player actually feels as "they ignore me".
 *
 * ── Two probes, because they answer different questions ──────────────────────
 *
 *  - **clone** — the probe seat is driven by a bot of the same character it would
 *    otherwise have held. Behaviour is then *identical* to the cast's, so any
 *    human/rival gap is about the SEAT, not about how it is being flown. This is
 *    the discriminator for "bots ignore the player".
 *  - **player** — a scripted human pilot: hauls when full, works the nearest rock,
 *    holds auto-aim fire, and juke-strafes across its heading the way a person
 *    does. This is the report's actual condition, and the one the soak invariant
 *    below is stated over.
 *
 * The per-slot fairness of aggression is already pinned by
 * `tests/harness/aggression-bias.test.ts` (p8); this file is about the human/bot
 * axis, not the slot-index axis. The match-build half of the p15 investigation —
 * "is the human accidentally a TEAMMATE?" — is `src/sim/ffa-hostility.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { Action, PlayerId, Vec2 } from '../../src/shared/types';
import { ShipClass } from '../../src/shared/types';
import type { Inputs, World } from '../../src/sim';
import { TICK_DT, createWorld, shieldPool } from '../../src/sim';
import type { Bot, BotSeat } from '../../src/bots/bot';
import { createBot } from '../../src/bots/bot';
import { botInputs, createBots, runHeadlessMatch } from '../../src/bots/harness';
import type { BotView } from '../../src/bots/perception';
import { mediumTarget } from '../../src/bots/medium';
import type { DifficultyTuning, PersonalityId } from '../../src/bots/personalities';
import {
  DIFFICULTY_TUNING,
  Difficulty,
  PERSONALITIES,
  ROSTER,
  rosterAt,
} from '../../src/bots/personalities';
import {
  bestTarget,
  homeIntruder,
  nearestEnemy,
  nearestLivingRival,
} from '../../src/bots/targeting';
import type { BotCtx } from '../../src/bots/tree';

const SLOTS = 8;
/** The seat the human flies. Slot-position fairness is p8's question, already
 *  pinned there; one seat keeps this sweep affordable. */
const HUMAN = 3;
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
/** Sim seconds per match. Long enough to clear spawn protection, run several ore
 *  waves, and let the cast go looking for fights. */
const MATCH_SECS = 180;
/** The appetite the p15 note ratified for HARD ("seek the fight more"). It is
 *  measured here, not shipped — see the A/B gate at the foot of this file and
 *  `docs/bot-player-aggression-p15.md` §3. */
const RATIFIED_APPETITE = 1.6;

// ---------------------------------------------------------------------------
// The scripted human
// ---------------------------------------------------------------------------

function len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function unit(v: Vec2): Vec2 {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
}

/**
 * A human pilot, scripted: fly to the nearest rock, take it home when the hold is
 * full, and hold the auto-aim trigger down the whole time (the mobile default —
 * the same stream a player on the Tap Commander produces). The heading carries a
 * **juke**: a perpendicular oscillation, because a person does not fly the
 * straight lines a bot does and the aim-error model is specifically tuned so that
 * strafing shakes shots (`DifficultyTuning.aimLatency`).
 *
 * Deterministic: a pure function of world state and the sim clock, no RNG.
 */
function playerPilot(world: World, id: PlayerId): readonly Action[] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship || !ship.alive) return [];
  const home = world.stations.find((p) => p.owner === id);

  let goal: Vec2 | null = null;
  if (ship.cargo >= ship.cargoCap - 1e-9 && home) {
    goal = home.pos;
  } else {
    let best = Number.POSITIVE_INFINITY;
    for (const rock of world.asteroids) {
      const d = len({ x: rock.pos.x - ship.pos.x, y: rock.pos.y - ship.pos.y });
      if (d < best) {
        best = d;
        goal = rock.pos;
      }
    }
    if (!goal && home) goal = home.pos;
  }
  if (!goal) return [{ type: 'fire', active: true, auto: true }];

  const straight = unit({ x: goal.x - ship.pos.x, y: goal.y - ship.pos.y });
  // The juke: up to 0.7 of a hull-width of sideways intent, reversing about
  // every 1.4 s — faster than a Hard bot re-solves its lead (0.20 s latency is
  // the lag; the reversal is what the lag misses).
  const wobble = Math.sin(world.time * 4.4) * 0.7;
  const dir = unit({
    x: straight.x - straight.y * wobble,
    y: straight.y + straight.x * wobble,
  });
  return [
    { type: 'thrust', dir },
    { type: 'fire', active: true, auto: true },
  ];
}

// ---------------------------------------------------------------------------
// The instrument: who is each bot engaging?
// ---------------------------------------------------------------------------

/** The fighting leaves, per tier. Anything else a tree can do (mine, haul,
 *  spend, roam, retreat) is not an engagement and is not counted. */
const FIGHTING_LEAVES = new Set(['attack', 'potshot', 'defend', 'last-stand', 'cornered-fight', 'hunt']);

/**
 * A read-only decision context over an already-decided view. Deliberately NOT
 * `context()`: that folds the view into memory and advances the stuck counter,
 * both of which the real decision already did a moment ago. Every function this
 * file calls with it is a pure read.
 */
function readCtx(bot: Bot, view: BotView): BotCtx {
  const brain = bot.brain;
  return {
    view,
    self: view.self,
    brain,
    weights: brain.weights,
    tuning: brain.tuning,
    rng: brain.rng,
    memory: brain.memory,
  };
}

/**
 * The slot this bot's winning leaf is engaging, or null when it is not fighting
 * anybody. Each branch recomputes the target with the same public function the
 * leaf used, so this is the bot's own choice read back, not an inference:
 *
 *  - `attack`         — `bestTarget` (Hard) / `mediumTarget` (Medium). The Hard
 *    floor only gates *entry*; the arg-max above it is the same target, so a
 *    zero floor recovers exactly the pick the leaf made.
 *  - `potshot`        — `nearestEnemy` (Easy).
 *  - `defend` / `last-stand` — the intruder inside the home ring.
 *  - `cornered-fight` — the blockader the latch is already committed to, read
 *    straight off the brain (re-deriving it would mutate the latch).
 *  - `hunt`           — the last rival's home, in collapse.
 */
function engagedVictim(bot: Bot, view: BotView): PlayerId | null {
  const behavior = bot.brain.lastBehavior;
  if (!FIGHTING_LEAVES.has(behavior)) return null;
  const ctx = readCtx(bot, view);
  switch (behavior) {
    case 'attack': {
      const medium = bot.difficulty === Difficulty.Medium;
      const target = medium ? mediumTarget(ctx) : bestTarget(ctx, 0);
      return target ? target.id : null;
    }
    case 'potshot': {
      const enemy = nearestEnemy(ctx);
      return enemy ? enemy.id : null;
    }
    case 'defend':
    case 'last-stand': {
      const intruder = homeIntruder(ctx);
      return intruder ? intruder.id : null;
    }
    case 'cornered-fight': {
      const committed = bot.brain.cornered.target;
      return committed >= 0 ? committed : null;
    }
    case 'hunt': {
      const rival = nearestLivingRival(ctx);
      return rival ? rival.owner : null;
    }
    default:
      return null;
  }
}

/** What one match measured, per victim slot. */
interface Tally {
  /** Decisions where the engaged victim CHANGED to this slot — a new fight. */
  readonly initiations: number[];
  /** Every decision spent engaging this slot — how long the fights last. */
  readonly dwell: number[];
  /** Hull knocked off this slot's SHIP — the number a pilot actually feels.
   *  Kept apart from the structure column below because a bot buys shields and
   *  turrets and a scripted probe does not, so a combined figure would compare
   *  two different amounts of *stuff to shoot at*. */
  readonly hullDamage: number[];
  /** HP off this slot's core, shields, and turrets — the siege column. */
  readonly structureDamage: number[];
  /** Sim time this slot first appeared in ANY bot's view, or Infinity. */
  readonly firstSeen: number[];
  /** Sim time a bot first initiated on this slot, or Infinity. */
  readonly firstAttack: number[];
  /**
   * Sim seconds actually played across the seeds in this sweep — the
   * denominator every count below is quoted against.
   *
   * It is not a constant: a more aggressive cast kills faster and a match that
   * reaches its result early simply stops (`runHeadlessMatch`). Comparing raw
   * totals across a tuning change would therefore read "more aggression, fewer
   * attacks" when what happened is "more aggression, shorter matches", which is
   * the opposite conclusion. Rates per match-minute are the honest column.
   */
  played: number;
  /**
   * Sim seconds each slot spent **still in the match** (not eliminated) — the
   * denominator for that slot's own columns.
   *
   * Total sim time is not enough. A slot whose core falls at 90 seconds cannot
   * be shot at for the remaining 90, so quoting its attention against the whole
   * match reads a *faster kill* as *less aggression* — precisely backwards.
   * Per-alive-minute asks the question that survives a tuning change: how much
   * fire does this slot draw for every minute it is there to draw it?
   */
  readonly alive: number[];
  /** Sim time this slot was eliminated, or Infinity if it survived. */
  readonly eliminatedAt: number[];
  /** Every decision taken, by winning leaf — the "what are they doing instead?"
   *  column. A fighting leaf that resolves to no victim (a `defend` with the
   *  besieger sitting outside the home ring, say) is invisible in the victim
   *  tallies but very visible here. */
  readonly leaves: Map<string, number>;
  /**
   * Decisions spent engaging the HUMAN, split by the **attacker's tier**.
   *
   * The aggregate human column answers "how much fire do I draw"; this answers
   * the ratified question, which is narrower — *"Hard enemies should attack
   * more"*. In a mixed roster only some seats are Hard, and the tiers do not
   * move together: a change to Hard's appetite reaches Easy and Medium seats
   * only through the world it leaves them (different rocks mined, different
   * rivals still alive), so an aggregate that fell can still be hiding a Hard
   * column that rose, and vice versa.
   */
  readonly humanDwellByTier: Map<Difficulty, number>;
  /** Initiations on the HUMAN, split by the attacker's tier. */
  readonly humanInitByTier: Map<Difficulty, number>;
}

function newTally(): Tally {
  return {
    initiations: new Array(SLOTS).fill(0),
    dwell: new Array(SLOTS).fill(0),
    hullDamage: new Array(SLOTS).fill(0),
    structureDamage: new Array(SLOTS).fill(0),
    firstSeen: new Array(SLOTS).fill(Number.POSITIVE_INFINITY),
    firstAttack: new Array(SLOTS).fill(Number.POSITIVE_INFINITY),
    played: 0,
    alive: new Array(SLOTS).fill(0),
    eliminatedAt: new Array(SLOTS).fill(Number.POSITIVE_INFINITY),
    leaves: new Map(),
    humanDwellByTier: new Map(),
    humanInitByTier: new Map(),
  };
}

/**
 * Wrap every bot's `decide` so each decision reports the view it saw and the
 * victim it engaged. The wrapper runs the real decision first and reads state
 * back — it never changes what the bot does, so the match measured is the match
 * that would have run without the instrument.
 */
function instrument(bots: readonly Bot[], tally: Tally): void {
  const lastVictim = new Map<PlayerId, PlayerId>();
  for (const bot of bots) {
    const decide = bot.decide.bind(bot);
    bot.decide = (view: BotView): readonly Action[] => {
      const actions = decide(view);
      for (const seen of view.ships) {
        if (tally.firstSeen[seen.id]! > view.time) tally.firstSeen[seen.id] = view.time;
      }
      const leaf = bot.brain.lastBehavior;
      tally.leaves.set(leaf, (tally.leaves.get(leaf) ?? 0) + 1);
      const victim = engagedVictim(bot, view);
      const previous = lastVictim.get(bot.seat.id) ?? -1;
      if (victim === null) {
        lastVictim.delete(bot.seat.id);
      } else {
        tally.dwell[victim]!++;
        if (victim !== previous) {
          tally.initiations[victim]!++;
          if (view.time < tally.firstAttack[victim]!) tally.firstAttack[victim] = view.time;
        }
        if (victim === HUMAN) {
          const tier = bot.brain.personality.difficulty;
          tally.humanDwellByTier.set(tier, (tally.humanDwellByTier.get(tier) ?? 0) + 1);
          if (victim !== previous) {
            tally.humanInitByTier.set(tier, (tally.humanInitByTier.get(tier) ?? 0) + 1);
          }
        }
        lastVictim.set(bot.seat.id, victim);
      }
      return actions;
    };
  }
}

/** This slot's damageable pools right now: `[ship hull, core, shields+turrets]`. */
function pools(world: World, id: PlayerId): [number, number, number] {
  const ship = world.ships.find((s) => s.id === id);
  const station = world.stations.find((p) => p.owner === id);
  if (!ship || !station) return [0, 0, 0];
  let guns = 0;
  for (const turret of station.turrets) guns += turret.hp;
  return [ship.hull, station.coreHp, shieldPool(station) + guns];
}

/** Fold this tick's fresh damage into the tally (increases — respawn, regen,
 *  repair, a newly-built turret — are not fire dealt and do not count), and
 *  accrue each slot's time still in the match. */
function sampleDamage(world: World, tally: Tally, last: number[][], dt: number): void {
  for (let id = 0; id < SLOTS; id++) {
    const ship = world.ships.find((s) => s.id === id);
    if (ship && !ship.eliminated) tally.alive[id]! += dt;
    else if (ship && tally.eliminatedAt[id]! === Number.POSITIVE_INFINITY) {
      tally.eliminatedAt[id] = world.time;
    }
    const now = pools(world, id);
    const prev = last[id]!;
    for (let k = 0; k < now.length; k++) {
      if (now[k]! < prev[k]!) {
        const dealt = prev[k]! - now[k]!;
        if (k === 0) tally.hullDamage[id]! += dealt;
        else tally.structureDamage[id]! += dealt;
      }
      prev[k] = now[k]!;
    }
  }
}

// ---------------------------------------------------------------------------
// One measured match
// ---------------------------------------------------------------------------

type Probe = 'clone' | 'player';
/** A cast is one difficulty tier (the per-tier columns the brief asks for) or
 *  `roster` — the shipped mixed cast a solo player actually meets offline
 *  (`fillEmptySlots`), which is the condition the report was written under. */
type Cast = Difficulty | 'roster';

/** The characters in the bot seats: a tier's own characters cycled (so the column
 *  reads as the TIER rather than as one character), or the shipped roster order. */
function castFor(cast: Cast): PersonalityId[] {
  const characters = cast === 'roster' ? ROSTER : rosterAt(cast);
  const seats: PersonalityId[] = [];
  for (let id = 0, k = 0; id < SLOTS; id++) {
    if (id === HUMAN) continue;
    seats.push(characters[k % characters.length]!);
    k++;
  }
  return seats;
}

/**
 * The A/B arm: force every bot's appetite (`DifficultyTuning.aggression`) to a
 * given value, so the ratified p15 tuning can be measured against the build it
 * replaced *in the same process, on the same seeds*. `null` means "run the
 * shipped table", which is the only arm the report columns are quoted from.
 *
 * Written straight onto the brain because that is where the tree reads it
 * (`buildCtx` — `ctx.tuning` IS `brain.tuning`), and nothing about the match is
 * touched beyond it: same seeds, same cast, same world.
 */
type Appetite = number | null;

function forceAppetite(bots: readonly Bot[], appetite: Appetite): void {
  if (appetite === null) return;
  for (const bot of bots) {
    const brain = bot.brain as { tuning: DifficultyTuning };
    brain.tuning = { ...brain.tuning, aggression: appetite };
  }
}

function measure(tier: Cast, probe: Probe, seed: number, tally: Tally, appetite: Appetite): void {
  const cast = castFor(tier);
  const seats: BotSeat[] = [];
  for (let id = 0, k = 0; id < SLOTS; id++) {
    if (id === HUMAN) continue;
    seats.push({ id, personality: cast[k++]! });
  }
  const players = Array.from({ length: SLOTS }, (_, id) => ({
    id,
    shipClass:
      id === HUMAN
        ? ShipClass.Vanguard
        : PERSONALITIES[seats.find((s) => s.id === id)!.personality].shipClass,
  }));

  const world = createWorld({ seed, players });
  const bots = createBots(seats, { seed });
  forceAppetite(bots, appetite);
  instrument(bots, tally);

  // The clone probe flies the same tree the cast does, so behaviour is held
  // constant and only the seat differs.
  const clone: Bot | null =
    probe === 'clone' ? createBot({ id: HUMAN, personality: cast[0]! }, { seed }) : null;
  if (clone) forceAppetite([clone], appetite);
  const extraInputs = (w: World): Inputs =>
    clone ? botInputs(w, [clone]) : [{ id: HUMAN, actions: playerPilot(w, HUMAN) }];

  const last = Array.from({ length: SLOTS }, (_, id) => pools(world, id) as number[]);

  const result = runHeadlessMatch(world, bots, {
    maxSeconds: MATCH_SECS,
    extraInputs,
    onTick: () => sampleDamage(world, tally, last, TICK_DT),
  });
  tally.played += result.seconds;
}

/** Run every seed for one (tier, probe, arm) and return the summed tally. */
const runCache = new Map<string, Tally>();
function sweep(tier: Cast, probe: Probe, appetite: Appetite = null): Tally {
  const key = `${tier}:${probe}:${appetite ?? 'shipped'}`;
  const cached = runCache.get(key);
  if (cached) return cached;
  const tally = newTally();
  for (const seed of SEEDS) measure(tier, probe, seed, tally, appetite);
  runCache.set(key, tally);
  return tally;
}

type Metric = 'initiations' | 'dwell' | 'hullDamage' | 'structureDamage';

/** The two columns: the human's number, and the mean over the seven bot rivals
 *  (per rival, so the columns are comparable — one human, seven bots). */
function columns(tally: Tally, field: Metric): {
  human: number;
  bot: number;
  ratio: number;
} {
  const values = tally[field];
  const perMinute = (id: number): number => (60 * values[id]!) / Math.max(1e-9, tally.alive[id]!);
  const human = perMinute(HUMAN);
  let sum = 0;
  let n = 0;
  for (let id = 0; id < SLOTS; id++) {
    if (id === HUMAN) continue;
    sum += perMinute(id);
    n++;
  }
  const bot = sum / n;
  return { human, bot, ratio: bot > 0 ? human / bot : human > 0 ? Number.POSITIVE_INFINITY : 1 };
}

const TIERS: Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];
const CASTS: Cast[] = [...TIERS, 'roster'];

/** One `human | bot (×ratio)` cell, **per minute that slot was alive in the
 *  match**, so neither a shorter match nor a faster kill can masquerade as less
 *  aggression (see `Tally.alive`). */
function cell(tally: Tally, field: Metric, digits = 1): string {
  const c = columns(tally, field);
  return `${c.human.toFixed(digits).padStart(6)} |${c.bot.toFixed(digits).padStart(6)} ×${c.ratio.toFixed(2).padStart(5)}`;
}

/**
 * The two columns, per tier, printed for the Director — the brief's deliverable.
 * `init` and `dwell` are what the bots INTEND; `hull` and `struct` are what
 * actually landed; `hit/100` is hull damage per hundred decisions spent engaging
 * that victim, i.e. how much of the intent survives contact with the target's
 * flying. A bot that aims at the player all match and never connects reads as a
 * healthy intent column and a starved `hit/100` — which is what "they ignored
 * me" feels like from the cockpit.
 */
function report(probe: Probe, label = ''): void {
  // eslint-disable-next-line no-console
  console.log(
    `\n[p15]${label} probe=${probe} — per minute ALIVE: HUMAN | per-BOT-rival (×human/bot)\n` +
      `        ${'initiations'.padEnd(22)}${'dwell'.padEnd(22)}${'hull dmg'.padEnd(22)}${'struct dmg'.padEnd(22)}hit/100 dwell`,
  );
  for (const tier of CASTS) {
    const tally = sweep(tier, probe);
    const dwell = columns(tally, 'dwell');
    const hull = columns(tally, 'hullDamage');
    const rateHuman = dwell.human > 0 ? (100 * hull.human) / dwell.human : 0;
    const rateBot = dwell.bot > 0 ? (100 * hull.bot) / dwell.bot : 0;
    // eslint-disable-next-line no-console
    console.log(
      `  ${tier.padEnd(6)}${cell(tally, 'initiations')}  ${cell(tally, 'dwell', 0)}  ` +
        `${cell(tally, 'hullDamage')}  ${cell(tally, 'structureDamage')}  ` +
        `${rateHuman.toFixed(1).padStart(5)} |${rateBot.toFixed(1).padStart(5)} ×${(rateBot > 0 ? rateHuman / rateBot : 0).toFixed(2)}` +
        `   ${(tally.played / SEEDS.length).toFixed(0)}s/match, human alive ${(tally.alive[HUMAN]! / SEEDS.length).toFixed(0)}s` +
        `   contact ${tally.firstSeen[HUMAN]!.toFixed(1)}s → 1st attack ${tally.firstAttack[HUMAN]!.toFixed(1)}s`,
    );
    const total = [...tally.leaves.values()].reduce((a, b) => a + b, 0);
    const share = [...tally.leaves.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${((100 * n) / total).toFixed(0)}%`)
      .join('  ');
    // eslint-disable-next-line no-console
    console.log(
      `         ${((60 * total) / tally.played).toFixed(0)} decisions/min — ${share}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

describe('bots fight the human, not just each other (p15)', () => {
  it('every tier initiates attacks on a scripted human player, and lands them', () => {
    report('player');
    for (const cast of CASTS) {
      const tally = sweep(cast, 'player');
      // The report's claim, as a gate: not "rarely" — at all, in every tier.
      expect(columns(tally, 'initiations').human).toBeGreaterThan(0);
      // And it has to land, not just be intended: a player who is aimed at but
      // never hit experiences exactly the reported "they ignore me".
      expect(columns(tally, 'hullDamage').human).toBeGreaterThan(0);
    }
  }, 300_000);

  it('a human seat flown exactly like a bot draws the same attention as a bot', () => {
    report('clone');
    // Behaviour held constant, only the seat differs. If anything in the trees
    // treated a human slot differently these ratios would collapse toward zero.
    // They do not — which is what clears the brief's prime suspect at the
    // behavioural layer, the way `src/sim/ffa-hostility.test.ts` clears it at
    // match build.
    for (const cast of CASTS) {
      const tally = sweep(cast, 'clone');
      expect(columns(tally, 'initiations').ratio).toBeGreaterThan(0.5);
      expect(columns(tally, 'dwell').ratio).toBeGreaterThan(0.5);
    }
  }, 300_000);

  it('every tier attacks the human within N minutes of sensor contact (soak invariant)', () => {
    // The standing invariant the brief asks for: contact, then a fight, at every
    // difficulty. Deterministic — same seeds, same cast, same numbers every run.
    const N_MINUTES = 2;
    for (const cast of CASTS) {
      const tally = sweep(cast, 'player');
      const contact = tally.firstSeen[HUMAN]!;
      const attacked = tally.firstAttack[HUMAN]!;
      expect(contact).toBeLessThan(MATCH_SECS);
      expect(attacked).toBeLessThan(contact + N_MINUTES * 60);
    }
  }, 300_000);

  it('the soak invariant is deterministic — the same seed measured twice is identical', () => {
    // The invariant above is only a standing gate if its numbers reproduce, and
    // `sweep` memoises, so re-reading it would prove nothing. This runs a whole
    // match twice through the *uncached* path and compares the entire tally —
    // every per-slot column, both first-contact clocks, and the leaf histogram.
    // Any Math.random, Date.now, or map-iteration-order leak in the sim, the
    // trees, or the scripted pilot separates the two.
    const first = newTally();
    measure('roster', 'player', SEEDS[0]!, first, null);
    const second = newTally();
    measure('roster', 'player', SEEDS[0]!, second, null);
    expect(second).toEqual(first);
    // ...and it is not vacuously equal: the run it compares is a real fight in
    // which the human was seen and attacked.
    expect(first.initiations[HUMAN]!).toBeGreaterThan(0);
    expect(first.firstAttack[HUMAN]!).toBeLessThan(Number.POSITIVE_INFINITY);
  }, 300_000);

  it('the ratified HARD appetite raise costs the player fire in the shipped roster', () => {
    // The brief's point 3, as a standing A/B. Both arms run the same seeds in
    // the same process and differ only by `DifficultyTuning.aggression`, so the
    // delta is the dial and nothing else. The shipped arm is the table as it
    // stands (every tier 1.0); the raised arm is the value the note ratified.
    const control = sweep(Difficulty.Hard, 'player');
    const raised = sweep(Difficulty.Hard, 'player', RATIFIED_APPETITE);
    const rosterControl = sweep('roster', 'player');
    const rosterRaised = sweep('roster', 'player', RATIFIED_APPETITE);

    const share = (t: Tally): number => {
      const hull = columns(t, 'hullDamage').human;
      const struct = columns(t, 'structureDamage').human;
      return hull / Math.max(1e-9, hull + struct);
    };
    /** Who is doing the attacking, per minute the human is alive — the ratified
     *  ask is about HARD seats, and in a mixed roster they are a minority. */
    const attackers = (t: Tally): string => {
      const per = (n: number): string => ((60 * n) / Math.max(1e-9, t.alive[HUMAN]!)).toFixed(1);
      return TIERS.map(
        (tier) =>
          `${tier} ${per(t.humanInitByTier.get(tier) ?? 0)}/${per(t.humanDwellByTier.get(tier) ?? 0)}`,
      ).join('  ');
    };
    const row = (label: string, t: Tally): string =>
      `  ${label.padEnd(16)}${columns(t, 'initiations').human.toFixed(1).padStart(6)}` +
      `${columns(t, 'dwell').human.toFixed(0).padStart(7)}` +
      `${columns(t, 'hullDamage').human.toFixed(1).padStart(8)}` +
      `${columns(t, 'structureDamage').human.toFixed(1).padStart(8)}` +
      `${(100 * share(t)).toFixed(0).padStart(7)}%` +
      `   human alive ${(t.alive[HUMAN]! / SEEDS.length).toFixed(0)}s   by attacker (init/dwell): ${attackers(t)}`;
    // eslint-disable-next-line no-console
    console.log(
      `\n[p15] HARD appetite A/B — on the HUMAN, per minute ALIVE\n` +
        `                    init  dwell    hull  struct  on-ship\n` +
        `${row('hard 1.0', control)}\n${row(`hard ${RATIFIED_APPETITE}`, raised)}\n` +
        `${row('roster 1.0', rosterControl)}\n${row(`roster ${RATIFIED_APPETITE}`, rosterRaised)}`,
    );

    // What ships: the dial exists, and it is a no-op everywhere. This branch
    // changes no bot's behaviour — the measurement below is why.
    for (const tier of TIERS) expect(DIFFICULTY_TUNING[tier].aggression).toBe(1);

    // In an ALL-HARD cast the raise does what the note wanted: more hull damage
    // on the player, and the fire stays on their ship rather than moving to
    // their home. This half of the finding is real and is why the dial is kept.
    expect(columns(raised, 'hullDamage').human).toBeGreaterThan(
      columns(control, 'hullDamage').human,
    );
    expect(share(raised)).toBeGreaterThanOrEqual(share(control));

    // And in the SHIPPED roster — the cast a solo player actually meets, and the
    // condition the report was written under — the same raise does the opposite:
    // the player draws LESS fire, and it is the Hard seats themselves that back
    // off (their initiations on the human fall by more than a third). A Hard bot
    // with a cheaper attack floor spends it on the softest hull in range, and in
    // a mixed roster that is an Easy or Medium bot, not a juking human.
    //
    // This gate pins the finding, not a preference. If it ever fails, the raise
    // has stopped being harmful and §3 of `docs/bot-player-aggression-p15.md`
    // needs re-measuring before the Director's answer changes.
    expect(columns(rosterRaised, 'hullDamage').human).toBeLessThan(
      columns(rosterControl, 'hullDamage').human,
    );
    const hardInit = (t: Tally): number => t.humanInitByTier.get(Difficulty.Hard) ?? 0;
    expect(hardInit(rosterRaised)).toBeLessThan(hardInit(rosterControl));
  }, 300_000);
});

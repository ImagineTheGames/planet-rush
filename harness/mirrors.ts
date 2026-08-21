/**
 * harness/mirrors.ts — the a0-112 re-measurement: **full bot mirrors across
 * every character and tier**, on the shipped trees. OWNER: QA Agent (GDD §3.8).
 *
 * Why this file exists rather than another pass of `./soak`: how bots fight
 * changed twice on 2026-08-19 (a0-105 gave the retreat an end, a0-107 closed the
 * dead band in front of it) and **both changes were checked by the lane that
 * made them, against the change it had just written**. `./soak` answers three of
 * QA's four targets, but it cannot answer the question those two branches
 * opened: a bot that used to hold position indefinitely now commits, so did
 * matches get shorter, bloodier, or both? That needs two numbers nobody was
 * collecting over whole matches — the share of a match spent in `turn-and-fight`,
 * and deaths per match — and it needs them per character and per tier.
 *
 * Everything here runs on `./soak`'s `runBotMatch` and therefore on its enforced
 * ceilings: **a hung match is a failed test, never a hung harness** (GDD §3.8).
 * The telemetry is pure observation (`SoakRunOptions.telemetry`), so a measured
 * match and an unmeasured one are the same match.
 *
 * ## The five sections, and what each can and cannot say
 *
 * | section | lineup | answers | cannot answer |
 * |---|---|---|---|
 * | `mirror` | eight of one character | length, deaths, decision mix, per character | **who wins** — everyone is the same bot |
 * | `roster` | the shipped cast, rotated | win rate per character and per tier, on the match a solo player actually gets | equal-skill balance (Hard *should* beat Easy) |
 * | `tier` | one hull, one tier's pool, rotated | the GDD §3.8 strategy target at equal skill | anything across tiers |
 * | `class` | one behaviour, four hulls, rotated | the GDD §2.11 ship-class target | anything about characters |
 * | `slice` | 180 s of the shipped cast | the decision mix in a0-107's own run shape, for a like-for-like comparison | whole-match shares |
 *
 * A mirror is deliberately the *first* section and deliberately not a contest:
 * the brief asks what a match now costs in deaths and in fight time, and a
 * single-character board is the only lineup where that number belongs to one
 * character rather than to a matchup.
 *
 * Run:  npx vite-node harness/cli.ts mirrors <section|all> [--seeds n] [--out DIR]
 */

import { ShipClass } from '@shared/types';
import type { PersonalityId } from '../src/bots';
import { Difficulty, MATCH_SLOTS, PERSONALITIES, ROSTER, rosterAt } from '../src/bots';
import { TICK_DT } from '../src/sim';
import { MATCH_TIMEOUT_S } from './match';
import type { BotMatchResult, BotSlot } from './soak';
import {
  CLASSES,
  HARD_POOL,
  LENGTH_TARGET_MAX_S,
  LENGTH_TARGET_MIN_S,
  WIN_RATE_CEILING,
  classLineup,
  rosterCast,
  runBotMatch,
  strategyLineup,
} from './soak';

// ---------------------------------------------------------------------------
// The lineups this report adds
// ---------------------------------------------------------------------------

/** The tiers in ladder order — the axis every table in the report is cut on. */
export const TIERS: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

/** The leaf the whole brief is about (`src/bots/behaviors.ts`, a0-105). */
export const FIGHT_LEAF = 'turn-and-fight';

/**
 * Eight of one character, each in that character's own hull — the mirror.
 *
 * Hull is held at the character's own (GDD §2.9: a character *is* a tree plus a
 * silhouette), not at a neutral one, because the question a mirror answers is
 * "what does a match of *this bot* cost?" and the bot includes its hull. Every
 * seat identical means nothing about the result is attributable to a matchup, so
 * length, deaths and decision mix belong to the character alone.
 */
export function mirrorLineup(personality: PersonalityId): BotSlot[] {
  const shipClass = PERSONALITIES[personality].shipClass;
  return Array.from({ length: MATCH_SLOTS }, (_, id) => ({ id, personality, shipClass }));
}

/**
 * The whole cast dealt round-robin across the eight seats and rotated — the
 * character contest.
 *
 * Eight seats over seven characters means one character always holds two of
 * them, which is the shipped offline lobby's own shape (`fillEmptySlots`:
 * "eight slots, seven characters … a full house needs a repeat"). Over
 * {@link ROSTER}`.length` rotations every character holds the double seat exactly
 * once **and** occupies every seat exactly once, so seat order and the double
 * seat both cancel and a win is attributable to the character. Run it at any
 * other rotation count and it is no longer fair — {@link rosterRotations}.
 */
export function rosterContestLineup(rotation = 0): BotSlot[] {
  return Array.from({ length: MATCH_SLOTS }, (_, id) => {
    const personality = ROSTER[(id + rotation) % ROSTER.length]!;
    return { id, personality, shipClass: PERSONALITIES[personality].shipClass };
  });
}

/** The rotation count that makes {@link rosterContestLineup} fair. Anything that
 *  is not a multiple of this leaves some character holding the extra seat more
 *  often than another, and the win rates are then partly a seat count. */
export const rosterRotations = (): number => ROSTER.length;

// ---------------------------------------------------------------------------
// The artifact — one JSON blob per section, small enough to commit
// ---------------------------------------------------------------------------

export type SectionId = 'mirror' | 'roster' | 'tier' | 'class' | 'slice' | 'cast' | 'a0107';

/** One match, reduced to what the report reads off it. Per-seat leaf censuses
 *  are pooled by character at the section level instead of stored per match: the
 *  tables need the totals, and 800 matches of per-seat censuses is a megabyte of
 *  numbers nobody reads. */
export interface MatchRow {
  readonly seed: number;
  /** Which lineup produced it — `mirror:rusty`, `roster:rot3`, `hard:rot1`, … */
  readonly lineup: string;
  readonly ok: boolean;
  readonly failure: string | null;
  readonly seconds: number;
  readonly winner: PersonalityId | null;
  readonly winnerClass: ShipClass | null;
  readonly winnerTier: Difficulty | null;
  /** Seats each character held in this match (the fair-share denominator). */
  readonly seats: Record<string, number>;
  /** Deaths each character took in this match — alive→dead transitions. */
  readonly deaths: Record<string, number>;
  /** Whole-match leaf census pooled over all eight seats. */
  readonly leaves: Record<string, number>;
  readonly decisions: number;
}

/** A whole section: its runs, and the per-character pools the tables are cut from. */
export interface SectionRun {
  readonly section: SectionId;
  readonly label: string;
  readonly seeds: readonly number[];
  readonly rotations: number;
  /** Sim-seconds ceiling each match ran under, so the report can quote it. */
  readonly ceilingSeconds: number;
  readonly matches: readonly MatchRow[];
  /** character → leaf → ticks, pooled over every match in the section. */
  readonly leavesBy: Record<string, Record<string, number>>;
  /** character → ticks observed, the denominator of the shares above. */
  readonly decisionsBy: Record<string, number>;
  /** character → deaths, pooled. */
  readonly deathsBy: Record<string, number>;
  /** character → seat-matches (seats held, summed over matches) — a character in
   *  two seats of one match took two seats' worth of deaths. */
  readonly seatMatchesBy: Record<string, number>;
}

function add(into: Record<string, number>, key: string, n: number): void {
  into[key] = (into[key] ?? 0) + n;
}

/** Fold one finished match into a {@link MatchRow} and the section's pools. */
function foldMatch(
  result: BotMatchResult,
  lineup: string,
  pools: Pick<SectionRun, 'leavesBy' | 'decisionsBy' | 'deathsBy' | 'seatMatchesBy'>,
): MatchRow {
  const seats: Record<string, number> = {};
  const deaths: Record<string, number> = {};
  const leaves: Record<string, number> = {};
  let decisions = 0;
  for (const seat of result.telemetry?.seats ?? []) {
    add(seats, seat.personality, 1);
    add(deaths, seat.personality, seat.deaths);
    add(pools.seatMatchesBy, seat.personality, 1);
    add(pools.deathsBy, seat.personality, seat.deaths);
    add(pools.decisionsBy, seat.personality, seat.decisions);
    decisions += seat.decisions;
    const by = (pools.leavesBy[seat.personality] ??= {});
    for (const [leaf, ticks] of Object.entries(seat.leafTicks)) {
      add(leaves, leaf, ticks);
      add(by, leaf, ticks);
    }
  }
  return {
    seed: result.seed,
    lineup,
    ok: result.ok,
    failure: result.failure,
    seconds: result.seconds,
    winner: result.winnerPersonality,
    winnerClass: result.winnerClass,
    winnerTier: result.winnerDifficulty,
    seats,
    deaths,
    leaves,
    decisions,
  };
}

/** One named lineup to run over every seed. */
export interface LineupSpec {
  readonly lineup: string;
  readonly slots: readonly BotSlot[];
  /** Seeds for **this** lineup, when the section is not a clean cross product of
   *  lineups × seeds. Only the a0-107 replay needs it: that instrument draws a
   *  different world for every rotation, and reproducing a published number means
   *  reproducing its draw, not improving on it. */
  readonly seeds?: readonly number[];
}

/** How a section is run. `maxSeconds` exists for `slice`, which deliberately
 *  stops a match early rather than playing it out (a0-107's own run shape). */
export interface SectionOptions {
  readonly seeds: readonly number[];
  readonly maxSeconds?: number;
  /** Called after every match, so a long section prints progress instead of
   *  looking hung — the harness's own rule applied to the harness. */
  readonly onMatch?: (row: MatchRow, index: number, total: number) => void;
}

/** Run every lineup over every seed, telemetry on. Always terminates: the
 *  ceilings are `runBotMatch`'s (GDD §3.8). */
export function runSection(
  section: SectionId,
  label: string,
  lineups: readonly LineupSpec[],
  options: SectionOptions,
): SectionRun {
  const pools = { leavesBy: {}, decisionsBy: {}, deathsBy: {}, seatMatchesBy: {} } as Pick<
    SectionRun,
    'leavesBy' | 'decisionsBy' | 'deathsBy' | 'seatMatchesBy'
  >;
  const matches: MatchRow[] = [];
  const total = lineups.reduce((n, spec) => n + (spec.seeds ?? options.seeds).length, 0);
  for (const spec of lineups) {
    for (const seed of spec.seeds ?? options.seeds) {
      const result = runBotMatch(seed, spec.slots, {
        telemetry: true,
        ...(options.maxSeconds !== undefined ? { maxSeconds: options.maxSeconds } : {}),
      });
      const row = foldMatch(result, spec.lineup, pools);
      matches.push(row);
      options.onMatch?.(row, matches.length, total);
    }
  }
  return {
    section,
    label,
    seeds: [...options.seeds],
    rotations: lineups.length,
    ceilingSeconds: options.maxSeconds ?? MATCH_TIMEOUT_S,
    matches,
    ...pools,
  };
}

/**
 * Fold shard artifacts of the same section back into one {@link SectionRun}.
 *
 * A section is a clean cross product of lineups × seeds and `runBotMatch(seed,
 * slots)` reads nothing but its own two arguments — no shared state, no clock,
 * no accumulator carried between matches. So splitting a seed span across
 * processes and concatenating the results is not an approximation of the long
 * run, it **is** the long run, and a0-126 proves that rather than asserting it
 * (`evidence/a0-126-the-last-two-points/shard-identity.txt`): the same span run
 * as one process and as four shards produces byte-identical match rows.
 *
 * That matters because the sample size a ceiling question needs is an order of
 * magnitude past what a "did this move" question needed. 223 matches is 45
 * seconds a shard and six minutes single-file; 2400 is an hour of one core and
 * eight minutes of eight.
 *
 * Rejects a mixed bag loudly: shards of different sections, or two shards
 * claiming the same seed, are a mistake in the run script and not something to
 * average over.
 */
export function mergeSections(shards: readonly SectionRun[]): SectionRun {
  if (shards.length === 0) throw new Error('mergeSections: no shards');
  const head = shards[0]!;
  const pools = { leavesBy: {}, decisionsBy: {}, deathsBy: {}, seatMatchesBy: {} } as Pick<
    SectionRun,
    'leavesBy' | 'decisionsBy' | 'deathsBy' | 'seatMatchesBy'
  >;
  const matches: MatchRow[] = [];
  const seeds: number[] = [];
  const seen = new Set<string>();
  for (const shard of shards) {
    if (shard.section !== head.section) {
      throw new Error(`mergeSections: shard is section ${shard.section}, expected ${head.section}`);
    }
    if (shard.rotations !== head.rotations) {
      throw new Error(`mergeSections: shard has ${shard.rotations} rotations, expected ${head.rotations}`);
    }
    if (shard.ceilingSeconds !== head.ceilingSeconds) {
      throw new Error(`mergeSections: shard ran under a ${shard.ceilingSeconds}s ceiling, expected ${head.ceilingSeconds}`);
    }
    for (const row of shard.matches) {
      const key = `${row.lineup}#${row.seed}`;
      if (seen.has(key)) throw new Error(`mergeSections: ${key} appears in two shards`);
      seen.add(key);
      matches.push(row);
    }
    for (const seed of shard.seeds) if (!seeds.includes(seed)) seeds.push(seed);
    for (const [c, by] of Object.entries(shard.leavesBy)) {
      const into = (pools.leavesBy[c] ??= {});
      for (const [leaf, ticks] of Object.entries(by)) add(into, leaf, ticks);
    }
    for (const [c, n] of Object.entries(shard.decisionsBy)) add(pools.decisionsBy, c, n);
    for (const [c, n] of Object.entries(shard.deathsBy)) add(pools.deathsBy, c, n);
    for (const [c, n] of Object.entries(shard.seatMatchesBy)) add(pools.seatMatchesBy, c, n);
  }
  seeds.sort((a, b) => a - b);
  matches.sort((a, b) => (a.lineup === b.lineup ? a.seed - b.seed : a.lineup < b.lineup ? -1 : 1));
  return { ...head, seeds, matches, ...pools };
}

// ---------------------------------------------------------------------------
// The five sections
// ---------------------------------------------------------------------------

export function mirrorSection(options: SectionOptions): SectionRun {
  return runSection(
    'mirror',
    'character mirrors — eight of one character, its own hull',
    ROSTER.map((p) => ({ lineup: `mirror:${p}`, slots: mirrorLineup(p) })),
    options,
  );
}

export function rosterSection(options: SectionOptions): SectionRun {
  const rotations = rosterRotations();
  return runSection(
    'roster',
    `the shipped cast, ${rotations} rotations (every character holds every seat once)`,
    Array.from({ length: rotations }, (_, rot) => ({
      lineup: `roster:rot${rot}`,
      slots: rosterContestLineup(rot),
    })),
    options,
  );
}

/** The equal-skill contests, one per tier: one hull, that tier's pool rotated.
 *  Vanguard is the neutral hull the shipped strategy contest already uses, so
 *  this number is comparable with `./soak`'s and with a0-107's. */
export function tierSection(options: SectionOptions): SectionRun {
  const lineups: LineupSpec[] = [];
  for (const tier of TIERS) {
    const pool = rosterAt(tier);
    for (let rot = 0; rot < pool.length; rot++) {
      lineups.push({ lineup: `${tier}:rot${rot}`, slots: strategyLineup(pool, ShipClass.Vanguard, rot) });
    }
  }
  return runSection('tier', 'equal-skill contests — one hull, one tier’s pool, rotated', lineups, options);
}

/** The behaviour the class contest holds fixed. `./soak`'s own choice, kept
 *  verbatim so this table can be compared with a0-107 §4 line for line. */
export const CLASS_CONTEST_BEHAVIOUR: PersonalityId = 'sable';

export function classSection(options: SectionOptions): SectionRun {
  return runSection(
    'class',
    `ship-class contest — behaviour=${CLASS_CONTEST_BEHAVIOUR}, four hulls, ${CLASSES.length} rotations`,
    Array.from({ length: CLASSES.length }, (_, rot) => ({
      lineup: `class:rot${rot}`,
      slots: classLineup(CLASS_CONTEST_BEHAVIOUR, rot),
    })),
    options,
  );
}

/**
 * The twelve seeds a0-105 measured its death count on
 * (`src/bots/repair-honesty.test.ts` `SEEDS`, quoted in `tests/reports/a0-105-standoff.md`
 * §4: "over twelve whole matches (seeds 1–12) bots die 25% more often — 1754 →
 * 2184"). The `cast` section runs the same twelve on the same lineup, so the one
 * deaths number a prior report published can be compared without a conversion.
 */
export const A0105_DEATH_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * The shipped offline cast, in seat order, unrotated — the exact match a solo
 * player gets (`fillEmptySlots`, GDD §2.9). It is not a contest and its win
 * column means nothing (the seats are fixed); it is here because it is the
 * lineup a0-105 counted deaths on.
 */
export function castSection(options: SectionOptions): SectionRun {
  return runSection('cast', 'the shipped offline cast, unrotated (a0-105’s death sweep)', [
    { lineup: 'cast:shipped', slots: rosterCast() },
  ], options);
}

/**
 * **a0-107's own draw, replayed.** `evidence/a0-107-dead-band/win-rates.ts` seeds
 * rotation `r` of contest seed `s` with `s × 1000 + r`, so each rotation plays a
 * *different world*; this section reproduces that exactly — same lineups, same
 * seeds, same counts — because the point is to check a published number, and a
 * better draw would answer a different question.
 *
 * `src/sim` and `src/bots` have not changed since the a0-107 merge, so anything
 * other than an exact reproduction of a0-107 §4 is a finding in itself.
 */
export function a0107Section(options: SectionOptions): SectionRun {
  const seedsFor = (rot: number): number[] => options.seeds.map((s) => s * 1000 + rot);
  const lineups: LineupSpec[] = [];
  for (let rot = 0; rot < HARD_POOL.length; rot++) {
    lineups.push({
      lineup: `a0107-strategy:rot${rot}`,
      slots: strategyLineup(HARD_POOL, ShipClass.Vanguard, rot),
      seeds: seedsFor(rot),
    });
  }
  for (let rot = 0; rot < CLASSES.length; rot++) {
    lineups.push({
      lineup: `a0107-class:rot${rot}`,
      slots: classLineup(HARD_POOL[0]!, rot),
      seeds: seedsFor(rot),
    });
  }
  return runSection('a0107', 'a0-107’s own contests, on a0-107’s own seeds', lineups, options);
}

/** a0-107's decision-mix shape: the shipped cast in seat order, stopped at 180 s.
 *  It exists for one job — putting this report's `turn-and-fight` share next to
 *  a0-107's 3.00% without an apples-to-oranges footnote. */
export const SLICE_SECONDS = 180;

/**
 * a0-107's own seeds (`evidence/a0-107-dead-band/decision-mix.ts` `A0107_SEEDS`).
 * The slice section runs **these** and not this report's seed range, because the
 * comparison it exists for is against numbers produced on them: same seeds, same
 * cast, same ceiling, so any difference in the mix is the build and not the draw.
 */
export const A0107_SLICE_SEEDS: readonly number[] = [20260806, 7, 991, 11, 12];

export function sliceSection(options: SectionOptions): SectionRun {
  return runSection(
    'slice',
    `decision mix in a0-107’s run shape — shipped cast, first ${SLICE_SECONDS} s`,
    [{ lineup: 'slice:cast', slots: rosterCast() }],
    { ...options, maxSeconds: SLICE_SECONDS },
  );
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export const tierOf = (p: string): Difficulty => PERSONALITIES[p as PersonalityId].difficulty;
export const nameOf = (p: string): string => PERSONALITIES[p as PersonalityId].name;

export interface Length {
  readonly n: number;
  readonly min: number;
  readonly p10: number;
  readonly median: number;
  readonly mean: number;
  readonly p90: number;
  readonly max: number;
  readonly insideFraction: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Length over the **decided** matches only: a match that hit a ceiling has no
 *  length, and folding the ceiling in would launder a termination failure into a
 *  length number (`./soak` `lengthStats`, same rule). */
export function lengthOf(rows: readonly MatchRow[]): Length {
  const decided = rows.filter((r) => r.ok).map((r) => r.seconds);
  const sorted = [...decided].sort((a, b) => a - b);
  const n = sorted.length;
  const inside = decided.filter((s) => s >= LENGTH_TARGET_MIN_S && s <= LENGTH_TARGET_MAX_S).length;
  return {
    n,
    min: n ? sorted[0]! : 0,
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    mean: n ? decided.reduce((a, b) => a + b, 0) / n : 0,
    p90: quantile(sorted, 0.9),
    max: n ? sorted[n - 1]! : 0,
    insideFraction: n ? inside / n : 0,
  };
}

export interface Win {
  readonly key: string;
  readonly name: string;
  /** Seat-matches held — the fair share is this over the total. */
  readonly seatMatches: number;
  readonly decided: number;
  readonly wins: number;
  readonly rate: number;
  readonly fairShare: number;
}

/**
 * Win rate by contestant over the decided matches, with **the fair share derived
 * from seats actually held** rather than assumed to be 1/N. The roster contest
 * seats seven characters in eight chairs, so a flat 1/7 would be wrong for
 * whoever held the double seat; deriving it from `seats` keeps every table in
 * this report readable the same way.
 */
export function winsBy(
  rows: readonly MatchRow[],
  keyOf: (r: MatchRow) => string | null,
  seatsOf: (r: MatchRow) => Record<string, number>,
  displayOf: (key: string) => string = (k) => k,
): Win[] {
  const decided = rows.filter((r) => r.ok && r.winner !== null).length;
  const wins: Record<string, number> = {};
  const seats: Record<string, number> = {};
  let seatTotal = 0;
  for (const r of rows) {
    for (const [k, n] of Object.entries(seatsOf(r))) {
      add(seats, k, n);
      seatTotal += n;
    }
    if (!(r.ok && r.winner !== null)) continue;
    const k = keyOf(r);
    if (k !== null) add(wins, k, 1);
  }
  return Object.keys(seats)
    .map((key) => ({
      key,
      name: displayOf(key),
      seatMatches: seats[key]!,
      decided,
      wins: wins[key] ?? 0,
      rate: decided ? (wins[key] ?? 0) / decided : 0,
      fairShare: seatTotal ? seats[key]! / seatTotal : 0,
    }))
    .sort((a, b) => b.rate - a.rate);
}

/** Per-character seat table: `seats[character]`. */
export const seatsByCharacter = (r: MatchRow): Record<string, number> => r.seats;

/** Per-tier seat table, folded up from the characters. */
export function seatsByTier(r: MatchRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [p, n] of Object.entries(r.seats)) add(out, tierOf(p), n);
  return out;
}

/**
 * Per-hull seat table for a lineup where each character flies its **own** hull
 * (the mirrors, the roster contest, the shipped cast). This is the cut that
 * separates "which character won" from "which silhouette won", and the roster
 * contest needs it: two of the seven characters fly the same hull, so a
 * character table alone cannot tell a good tree from a good hull.
 */
export function seatsByOwnHull(r: MatchRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [p, n] of Object.entries(r.seats)) add(out, String(PERSONALITIES[p as PersonalityId].shipClass), n);
  return out;
}

/** The hull a winning character was flying, when the lineup flies own hulls. */
export const ownHullOf = (r: MatchRow): string | null =>
  r.winner === null ? null : String(PERSONALITIES[r.winner].shipClass);

/**
 * Per-hull seat table. It cannot come off a {@link MatchRow} — the row records
 * characters, and the class contest holds the character fixed — so it comes off
 * the lineup, which deals every hull exactly `MATCH_SLOTS / CLASSES.length`
 * seats at **every** rotation. That makes it the same table for every match in
 * the section, and the fair share a flat 25%.
 */
export function classSeats(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of classLineup(CLASS_CONTEST_BEHAVIOUR, 0)) add(out, String(s.shipClass), 1);
  return out;
}

/**
 * The turn as a share of the **retreat family** — `turn-and-fight` over
 * (`turn-and-fight` + `retreat`).
 *
 * This is the number that makes the per-tier spread readable. The turn is an
 * *exit from a retreat* (a0-105: patience `tier × caution`, clamped to
 * [0.5 s, 5 s]), so a tier that rarely retreats rarely turns, and a raw share
 * cannot tell "this tier turns reluctantly" from "this tier never had to".
 */
export function turnOfRetreat(census: Record<string, number>): number {
  const turn = census[FIGHT_LEAF] ?? 0;
  const family = turn + (census['retreat'] ?? 0);
  return family ? turn / family : 0;
}

/** Share of all observed decisions that went to one leaf. */
export function leafShare(leaves: Record<string, number>, leaf: string): number {
  const total = Object.values(leaves).reduce((a, b) => a + b, 0);
  return total ? (leaves[leaf] ?? 0) / total : 0;
}

/** Pool a section's per-character censuses up to a tier. */
export function poolByTier<T extends Record<string, number>>(
  by: Record<string, T>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [p, census] of Object.entries(by)) {
    const t = (out[tierOf(p)] ??= {});
    for (const [k, n] of Object.entries(census)) add(t, k, n);
  }
  return out;
}

/** Sum a per-character scalar up to a tier. */
export function sumByTier(by: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [p, n] of Object.entries(by)) add(out, tierOf(p), n);
  return out;
}

/**
 * Deaths per match, two ways, because the two answer different questions and
 * only one of them survives a lineup change:
 *
 * - **per seat-match** — one bot's deaths in one match. Comparable across every
 *   section, because it does not depend on how many seats a character held.
 * - **per match** — the whole board's deaths, when every seat is the same
 *   character (a mirror). This is the one that says how bloody a match *is*.
 */
export interface Deaths {
  readonly deaths: number;
  readonly seatMatches: number;
  readonly matches: number;
  readonly perSeatMatch: number;
  readonly perMatch: number;
  /** Deaths per bot per minute of sim time — length-normalised, so a longer
   *  match cannot look bloodier just by being longer. */
  readonly perSeatMinute: number;
}

export function deathsOf(rows: readonly MatchRow[], keep: (character: string) => boolean): Deaths {
  let deaths = 0;
  let seatMatches = 0;
  let botMinutes = 0;
  let matches = 0;
  for (const r of rows) {
    let seatsHere = 0;
    for (const [p, n] of Object.entries(r.seats)) {
      if (!keep(p)) continue;
      seatsHere += n;
      deaths += r.deaths[p] ?? 0;
    }
    if (seatsHere > 0) {
      seatMatches += seatsHere;
      botMinutes += (seatsHere * r.seconds) / 60;
      matches++;
    }
  }
  return {
    deaths,
    seatMatches,
    matches,
    perSeatMatch: seatMatches ? deaths / seatMatches : 0,
    perMatch: matches ? deaths / matches : 0,
    perSeatMinute: botMinutes ? deaths / botMinutes : 0,
  };
}

/** m:ss, the report's length format (`./balance` `mmss`, restated so this module
 *  can be read on its own). */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/**
 * Standard error of a win rate at this sample size, in points — the number that
 * decides whether a moved number moved. Quoted rather than assumed, because
 * a0-107 had to make the same argument by hand ("SE ≈ 4.9 points").
 */
export function winSE(rate: number, decided: number): number {
  return decided > 0 ? Math.sqrt(Math.max(0, rate * (1 - rate)) / decided) : 0;
}

/** Ticks → sim seconds, for the report's episode numbers. */
export const ticksToSeconds = (ticks: number): number => ticks * TICK_DT;

/** Re-exported so a reader of the report's tables can find the ceiling and the
 *  targets in one place. */
export { LENGTH_TARGET_MAX_S, LENGTH_TARGET_MIN_S, WIN_RATE_CEILING };

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** One row of a prior report's numbers, transcribed with the line it came from.
 *  Nothing in this file re-runs an old build: a comparison to a prior run is a
 *  comparison to what that run *reported*, and it says so. */
export interface PriorNumber {
  readonly what: string;
  readonly value: string;
  readonly source: string;
}

export interface MirrorsReportInput {
  readonly title: string;
  readonly context: string;
  /** The one-line answer the brief asks for at the top: do the two bands hold? */
  readonly headline: string;
  /** Hand-written: the reading of the numbers below. */
  readonly reading: string;
  /** Hand-written: what moved against the prior run, and by how much. */
  readonly comparison: string;
  /** Hand-written: what is out of band and is being reported rather than tuned. */
  readonly outOfBand: string;
  readonly mirror: SectionRun;
  readonly roster: SectionRun;
  readonly tier: SectionRun;
  readonly klass: SectionRun;
  readonly slice: SectionRun;
  readonly cast: SectionRun;
  readonly a0107: SectionRun;
  readonly prior: readonly PriorNumber[];
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

const ratio = (rate: number, fair: number): string => (fair > 0 ? `${(rate / fair).toFixed(2)}×` : '—');

/** Rows of a win table, with the fair share and the standard error spelled out
 *  so a reader can tell a real gap from a sample-size one without arithmetic. */
function winTable(wins: readonly Win[], ceiling = WIN_RATE_CEILING): string {
  return table(
    ['contestant', 'wins / decided', 'win rate', 'fair share', 'vs fair', '±1 SE', 'vs 55%'],
    wins.map((w) => [
      w.name,
      `${w.wins} / ${w.decided}`,
      `**${pct(w.rate)}**`,
      pct(w.fairShare),
      ratio(w.rate, w.fairShare),
      `${(winSE(w.rate, w.decided) * 100).toFixed(1)} pts`,
      w.rate > ceiling ? '**OVER**' : 'under',
    ]),
  );
}

function lengthRow(label: string, l: Length): readonly string[] {
  return [
    label,
    String(l.n),
    mmss(l.min),
    mmss(l.p10),
    `**${mmss(l.median)}**`,
    mmss(l.mean),
    mmss(l.p90),
    mmss(l.max),
    pct(l.insideFraction),
  ];
}

const LENGTH_HEAD = ['run', 'decided', 'min', 'p10', 'median', 'mean', 'p90', 'max', 'inside 10–15 min'];

/** Every leaf seen in a census, most-used first — the report never hard-codes a
 *  leaf list, so a tree that grows one shows up here instead of being dropped. */
function leafOrder(census: Record<string, number>): string[] {
  return Object.keys(census).sort((a, b) => (census[b] ?? 0) - (census[a] ?? 0));
}

function censusTable(columns: readonly (readonly [string, Record<string, number>])[]): string {
  const pooled: Record<string, number> = {};
  for (const [, c] of columns) for (const [k, n] of Object.entries(c)) add(pooled, k, n);
  return table(
    ['leaf', ...columns.map(([name]) => name)],
    leafOrder(pooled).map((leaf) => [
      leaf === FIGHT_LEAF ? `**${leaf}**` : `\`${leaf}\``,
      ...columns.map(([, c]) => pct(leafShare(c, leaf), 2)),
    ]),
  );
}

function deathsTable(rows: readonly (readonly [string, Deaths])[]): string {
  // "seats" is printed because "deaths per match" is only the whole board's
  // number when the row holds all eight of them. A tier that holds two seats of
  // the shipped cast contributes two seats' worth, and a table that hid that
  // would read as if Easy died a third as often as it does.
  return table(
    ['run', 'matches', 'seats / match', 'deaths', 'deaths per match', 'per bot per match', 'per bot per minute'],
    rows.map(([label, d]) => [
      label,
      String(d.matches),
      d.matches ? (d.seatMatches / d.matches).toFixed(2) : '0',
      String(d.deaths),
      `**${d.perMatch.toFixed(1)}**`,
      d.perSeatMatch.toFixed(2),
      d.perSeatMinute.toFixed(2),
    ]),
  );
}

const terminationOf = (run: SectionRun): { matches: number; decided: number; timeouts: number; hangs: number } => ({
  matches: run.matches.length,
  decided: run.matches.filter((r) => r.ok).length,
  timeouts: run.matches.filter((r) => r.failure === 'sim-timeout').length,
  hangs: run.matches.filter((r) => r.failure === 'wall-clock' || r.failure === 'stalled').length,
});

/**
 * Render the whole report. Every number is computed here from the committed
 * section artifacts; the only hand-written text is the four fields the input
 * names as such, which is the same division `./balance` uses (`ReportInput`
 * `findings`) — the harness produces the numbers, QA produces the reading.
 */
export function renderReport(input: MirrorsReportInput): string {
  const { mirror, roster, tier, klass, slice, cast, a0107 } = input;
  const out: string[] = [];
  const everyMatch = [
    ...mirror.matches,
    ...roster.matches,
    ...tier.matches,
    ...klass.matches,
    ...cast.matches,
    ...a0107.matches,
  ];
  const term = {
    matches: everyMatch.length,
    decided: everyMatch.filter((r) => r.ok).length,
    timeouts: everyMatch.filter((r) => r.failure === 'sim-timeout').length,
    hangs: everyMatch.filter((r) => r.failure === 'wall-clock' || r.failure === 'stalled').length,
  };

  const charWins = winsBy(roster.matches, (r) => r.winner, seatsByCharacter, nameOf);
  const tierWins = winsBy(roster.matches, (r) => r.winnerTier, seatsByTier);
  const classWins = winsBy(klass.matches, (r) => (r.winnerClass !== null ? String(r.winnerClass) : null), () =>
    classSeats(),
  );
  const topChar = charWins[0];
  // The §3.8 target proper is the equal-skill one: the top character inside its
  // own tier's pool, hull held fixed. The cast contest is reported beside it and
  // not instead of it, because a mixed-tier board answers a different question.
  const equalSkill = TIERS.flatMap((t) => {
    const rows = tier.matches.filter((r) => r.lineup.startsWith(`${t}:`));
    return rows.length ? winsBy(rows, (r) => r.winner, seatsByCharacter, nameOf).map((w) => ({ ...w, tier: t })) : [];
  }).sort((a, b) => b.rate - a.rate);
  const topEqual = equalSkill[0];
  const topClass = classWins[0];
  const rosterLen = lengthOf(roster.matches);
  const mirrorLen = lengthOf(mirror.matches);

  out.push(`# ${input.title}`, '', `**${input.context}**`, '');
  out.push(`> ${input.headline}`, '');
  out.push(
    'Generated by `harness/mirrors.ts` (`npx vite-node harness/cli.ts mirrors report`).',
    'Every number below is computed by the headless harness from the section artifacts',
    'in `tests/reports/a0-112-data/` — the seeds and lineups are named in §1, and the',
    'run is reproducible from this file alone. Only the readings are hand-written, and',
    'they are marked.',
    '',
    '---',
    '',
  );

  // --- Scoreboard ---
  out.push('## Targets at a glance', '');
  out.push(
    table(
      ['Target', 'Source', 'Measured', 'Verdict'],
      [
        [
          'Match length 10–15 min',
          'GDD §1',
          `median ${mmss(rosterLen.median)} (shipped cast), ${pct(rosterLen.insideFraction)} inside`,
          rosterLen.median >= LENGTH_TARGET_MIN_S && rosterLen.median <= LENGTH_TARGET_MAX_S
            ? '**PASS**'
            : '**FAIL**',
        ],
        [
          'No strategy > 55% — at equal skill (§2.3)',
          'GDD §3.8',
          `top: ${topEqual?.name ?? '—'} ${pct(topEqual?.rate ?? 0)} of ${topEqual?.decided ?? 0} decided in the ${topEqual?.tier ?? '—'} pool`,
          (topEqual?.rate ?? 0) <= WIN_RATE_CEILING ? '**PASS**' : '**FAIL**',
        ],
        [
          'No character > 55% — across the whole cast (§2.1)',
          'GDD §3.8, read on the shipped lobby',
          `top: ${topChar?.name ?? '—'} ${pct(topChar?.rate ?? 0)} of ${topChar?.decided ?? 0} decided`,
          (topChar?.rate ?? 0) <= WIN_RATE_CEILING ? '**PASS**' : '**FAIL**',
        ],
        [
          'No ship class > 55% win rate',
          'GDD §2.11',
          `top: ${topClass?.name ?? '—'} ${pct(topClass?.rate ?? 0)} of ${topClass?.decided ?? 0} decided`,
          (topClass?.rate ?? 0) <= WIN_RATE_CEILING ? '**PASS**' : '**FAIL**',
        ],
        [
          'Every match reaches an ending',
          'GDD §2.3',
          `${term.decided}/${term.matches} decided, ${term.timeouts} sim-timeout`,
          term.decided === term.matches ? '**PASS**' : '**FAIL**',
        ],
        [
          'No hung match (harness gate)',
          'GDD §3.8',
          `${term.hangs} hangs in ${term.matches} matches`,
          term.hangs === 0 ? '**PASS**' : '**FAIL**',
        ],
      ],
    ),
    '',
  );

  out.push('## QA reading', '', input.reading, '');
  out.push('## If something is out of band', '', input.outOfBand, '');

  // --- §1 method ---
  out.push('---', '', '## 1 · What was run', '');
  out.push(
    table(
      ['section', 'lineup', 'seeds', 'lineups', 'matches', 'decided', 'sim-timeout', 'hangs', 'ceiling'],
      ([mirror, roster, tier, klass, cast, a0107, slice] as const).map((run) => {
        const t = terminationOf(run);
        return [
          `\`${run.section}\``,
          run.label,
          String(run.seeds.length),
          String(run.rotations),
          String(t.matches),
          String(t.decided),
          String(t.timeouts),
          String(t.hangs),
          `${mmss(run.ceilingSeconds)} sim`,
        ];
      }),
    ),
    '',
  );
  out.push(
    `Seeds, every section: \`${mirror.seeds.join(', ')}\`` +
      (slice.seeds.join(',') === mirror.seeds.join(',') ? '.' : ` · slice: \`${slice.seeds.join(', ')}\`.`),
    '',
    'Every match ran under `runBotMatch`’s three enforced ceilings (sim-time, wall-clock,',
    'ticks): **a hung match is a failed test, never a hung harness** (GDD §3.8). The',
    '`hangs` column is that gate, and it is the only column whose non-zero value would',
    'make this report an instrument failure rather than a measurement.',
    '',
  );

  // --- §2 win rate ---
  out.push('---', '', '## 2 · Win rate', '');
  out.push(
    '### 2.1 · Per character — the shipped cast, every seat, every rotation',
    '',
    `${roster.matches.length} matches: ${roster.seeds.length} seeds × ${roster.rotations} rotations of the`,
    'seven-character cast over eight seats. Over a full set of rotations every character',
    'holds every seat exactly once and the eighth (doubled) seat exactly once, so seat',
    'order cancels and a win is attributable to the character.',
    '',
    winTable(charWins),
    '',
  );
  out.push(
    '### 2.2 · Per tier — the same runs, folded up',
    '',
    'The tiers do not hold equal numbers of seats (three Hard characters, two Medium, two',
    'Easy), so the fair share differs per tier and is printed. **A tier is not a strategy:**',
    'Hard out-winning Easy is what difficulty is *for* (GDD §2.9), so the 55% column is',
    'informational here and the target proper is §2.3.',
    '',
    winTable(tierWins),
    '',
  );
  out.push(
    '### 2.3 · Per character at equal skill — the GDD §3.8 target',
    '',
    'One hull (vanguard), one tier’s pool rotated across all eight seats: skill and shape',
    'held fixed, so a win is attributable to the triangle strategy the character leans on.',
    '',
  );
  for (const t of TIERS) {
    const rows = tier.matches.filter((r) => r.lineup.startsWith(`${t}:`));
    if (rows.length === 0) continue;
    const pool = rosterAt(t);
    const wins = winsBy(rows, (r) => r.winner, seatsByCharacter, nameOf);
    out.push(
      `**${t}** — pool of ${pool.length}, fair share ${pct(1 / pool.length)}, ${rows.length} matches:`,
      '',
      winTable(wins),
      '',
    );
  }
  out.push(
    '### 2.4 · Per ship class — the GDD §2.11 target',
    '',
    `One behaviour (\`${CLASS_CONTEST_BEHAVIOUR}\`), four hulls dealt two seats each and rotated, so a win is`,
    'attributable to the hull and nothing else.',
    '',
    winTable(classWins),
    '',
  );
  out.push(
    '### 2.5 · The cast contest, cut by hull instead of by character',
    '',
    'The same 224 matches as §2.1, attributed to the silhouette the winner was flying',
    'rather than to its name. Two of the seven characters fly an excavator and two fly a',
    'hauler (GDD §2.11), so a character table on its own cannot separate a good tree from',
    'a good hull — and §2.4 says the hull is worth a great deal.',
    '',
    winTable(winsBy(roster.matches, ownHullOf, seatsByOwnHull)),
    '',
    '### 2.6 · a0-107’s own contests, replayed on a0-107’s own seeds',
    '',
    '`src/sim` and `src/bots` have not changed since the a0-107 merge, so these tables',
    'should reproduce `a0-107-dead-band.md` §4 exactly. They are here because a report',
    'whose whole subject is "the lane that changed it also checked it" owes the check a',
    'check. The seeding is a0-107’s (`s × 1000 + rotation`, a different world per',
    'rotation), not this report’s.',
    '',
    `**Strategy contest** — Hard pool on vanguard, ${a0107.matches.filter((r) => r.lineup.startsWith('a0107-strategy')).length} matches:`,
    '',
    winTable(
      winsBy(
        a0107.matches.filter((r) => r.lineup.startsWith('a0107-strategy')),
        (r) => r.winner,
        seatsByCharacter,
        nameOf,
      ),
    ),
    '',
    `**Class contest** — \`${CLASS_CONTEST_BEHAVIOUR}\`, four hulls, ${a0107.matches.filter((r) => r.lineup.startsWith('a0107-class')).length} matches:`,
    '',
    winTable(
      winsBy(
        a0107.matches.filter((r) => r.lineup.startsWith('a0107-class')),
        (r) => (r.winnerClass !== null ? String(r.winnerClass) : null),
        () => classSeats(),
      ),
    ),
    '',
    table(LENGTH_HEAD, [
      lengthRow(
        'a0-107 replay — strategy',
        lengthOf(a0107.matches.filter((r) => r.lineup.startsWith('a0107-strategy'))),
      ),
      lengthRow('a0-107 replay — class', lengthOf(a0107.matches.filter((r) => r.lineup.startsWith('a0107-class')))),
    ]),
    '',
  );

  // --- §3 length ---
  out.push('---', '', '## 3 · Match length', '');
  out.push(
    table(LENGTH_HEAD, [
      lengthRow('shipped cast (roster contest)', rosterLen),
      lengthRow('character mirrors', mirrorLen),
      lengthRow('equal-skill contests', lengthOf(tier.matches)),
      lengthRow('ship-class contest', lengthOf(klass.matches)),
      lengthRow('shipped cast, unrotated (a0-105 seeds)', lengthOf(cast.matches)),
      lengthRow('a0-107 replay (a0-107 seeds)', lengthOf(a0107.matches)),
      lengthRow('**all decided matches**', lengthOf(everyMatch)),
    ]),
    '',
    '### 3.1 · Per character — the mirror, where length belongs to one bot',
    '',
    table(
      LENGTH_HEAD,
      ROSTER.map((p) =>
        lengthRow(
          `${nameOf(p)} (${tierOf(p)})`,
          lengthOf(mirror.matches.filter((r) => r.lineup === `mirror:${p}`)),
        ),
      ),
    ),
    '',
    '### 3.2 · Per tier — the mirrors pooled',
    '',
    table(
      LENGTH_HEAD,
      TIERS.map((t) =>
        lengthRow(String(t), lengthOf(mirror.matches.filter((r) => tierOf(r.lineup.slice('mirror:'.length)) === t))),
      ),
    ),
    '',
  );

  // --- §4 fight time ---
  out.push('---', '', '## 4 · How much of a match is spent in `turn-and-fight`', '');
  out.push(
    'The share is of **decisions**, not of wall time: one tick of one bot is one decision,',
    'and the leaf is `Brain.lastBehavior` — the bot’s own account of what it was doing, the',
    'same read a0-105 and a0-107 measured the standoff on.',
    '',
    '### 4.1 · The whole decision mix, per section',
    '',
    censusTable([
      ['mirrors', poolCensus(mirror)],
      ['shipped cast', poolCensus(roster)],
      ['equal-skill', poolCensus(tier)],
      ['ship-class', poolCensus(klass)],
      ['cast, unrotated', poolCensus(cast)],
      [`a0-107 shape (${SLICE_SECONDS} s)`, poolCensus(slice)],
    ]),
    '',
    '### 4.2 · `turn-and-fight` share per character and per tier',
    '',
    table(
      ['character', 'tier', 'mirror', 'shipped cast', 'equal-skill', 'retreat (cast)', 'turn ÷ (turn + retreat), cast'],
      ROSTER.map((p) => [
        nameOf(p),
        String(tierOf(p)),
        pct(leafShare(mirror.leavesBy[p] ?? {}, FIGHT_LEAF), 2),
        pct(leafShare(roster.leavesBy[p] ?? {}, FIGHT_LEAF), 2),
        p in tier.leavesBy ? pct(leafShare(tier.leavesBy[p] ?? {}, FIGHT_LEAF), 2) : '—',
        pct(leafShare(roster.leavesBy[p] ?? {}, 'retreat'), 2),
        `**${pct(turnOfRetreat(roster.leavesBy[p] ?? {}))}**`,
      ]),
    ),
    '',
    'The last column is the one that makes the spread readable. The turn is an *exit*',
    'from a retreat, so a tier that rarely retreats rarely turns — and the raw share',
    'cannot tell "turns reluctantly" from "never had to".',
    '',
    table(
      ['tier', 'mirror', 'shipped cast', 'equal-skill', 'retreat (cast)', 'turn ÷ (turn + retreat), cast'],
      TIERS.map((t) => [
        String(t),
        pct(leafShare(poolByTier(mirror.leavesBy)[t] ?? {}, FIGHT_LEAF), 2),
        pct(leafShare(poolByTier(roster.leavesBy)[t] ?? {}, FIGHT_LEAF), 2),
        pct(leafShare(poolByTier(tier.leavesBy)[t] ?? {}, FIGHT_LEAF), 2),
        pct(leafShare(poolByTier(roster.leavesBy)[t] ?? {}, 'retreat'), 2),
        `**${pct(turnOfRetreat(poolByTier(roster.leavesBy)[t] ?? {}))}**`,
      ]),
    ),
    '',
  );

  // --- §5 deaths ---
  out.push('---', '', '## 5 · Deaths per match', '');
  out.push(
    'A death is an alive→dead transition on a seat’s ship, counted over the whole match',
    'and including the elimination that ends it. The developer’s ruling was *“ship lives',
    'are cheap. enemies should not fear death”* (a0-105), so a rise here is the design',
    'working; the number is reported either way.',
    '',
    '### 5.1 · Per character — the mirror',
    '',
    deathsTable(
      ROSTER.map(
        (p) =>
          [
            `${nameOf(p)} (${tierOf(p)})`,
            deathsOf(
              mirror.matches.filter((r) => r.lineup === `mirror:${p}`),
              (c) => c === p,
            ),
          ] as const,
      ),
    ),
    '',
    '### 5.2 · Per tier',
    '',
    deathsTable(
      TIERS.flatMap((t) => [
        [
          `${t} — mirrors`,
          deathsOf(
            mirror.matches.filter((r) => tierOf(r.lineup.slice('mirror:'.length)) === t),
            (c) => tierOf(c) === t,
          ),
        ] as const,
        [`${t} — shipped cast`, deathsOf(roster.matches, (c) => tierOf(c) === t)] as const,
      ]),
    ),
    '',
    '### 5.3 · The whole board',
    '',
    deathsTable([
      ['mirrors', deathsOf(mirror.matches, () => true)] as const,
      ['shipped cast', deathsOf(roster.matches, () => true)] as const,
      ['equal-skill contests', deathsOf(tier.matches, () => true)] as const,
      ['ship-class contest', deathsOf(klass.matches, () => true)] as const,
      ['**shipped cast, unrotated — a0-105’s twelve seeds**', deathsOf(cast.matches, () => true)] as const,
    ]),
    '',
  );

  // --- §6 comparison ---
  out.push('---', '', '## 6 · Against the last run', '');
  out.push(
    table(
      ['what', 'prior run', 'source'],
      input.prior.map((p) => [p.what, p.value, p.source]),
    ),
    '',
    input.comparison,
    '',
  );

  out.push('---', '', `*${input.title} — QA Agent. No file under \`src/\` was changed by this brief.*`, '');
  return out.join('\n');
}

/** A section's whole-board census — every character's leaves pooled. */
export function poolCensus(run: SectionRun): Record<string, number> {
  const out: Record<string, number> = {};
  for (const census of Object.values(run.leavesBy)) for (const [k, n] of Object.entries(census)) add(out, k, n);
  return out;
}

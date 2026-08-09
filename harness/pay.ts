/**
 * harness/pay.ts — what a match PAYS, measured with the shipped instruments.
 * OWNER: QA Agent (p1-08; brief `docs/briefs/pr-08-rebaseline.md`, plan
 * `docs/progression-plan.md` §1.2, §1.3a–d, §1.4).
 *
 * The plan's whole XP economy was sized off one spike
 * (`spikes/progression/measure-ratified-xp.ts`) that ran **four bot lobbies at
 * N=8 on octagon, seeds 1–12, at `createWorld`'s default abundance**, and
 * reconstructed damage attribution from projectile geometry because the sim had
 * no attacker on the damage path. Both of those are now obsolete:
 *
 *  - the sim credits damage and kills itself (`src/sim/combat-credit.ts`), and
 *    `src/progression/accrual.ts` reads that ledger rather than reconstructing
 *    anything — so this file measures with the **shipped** observer and the
 *    **shipped** pricer (`src/progression/xp.ts`), never a copy of them. If a
 *    weight moves, this rig moves with it, which is the point;
 *  - the pay is not one number. It is a function of map, lobby size and
 *    abundance, and `homeFieldOre(n)` alone moves per-player ore ~4× between
 *    N=8 and N=3. A rig that can only run octagon/N=8 cannot see that.
 *
 * So: one match runner, parameterised on the three axes the brief names, plus
 * the cast; and the arithmetic that turns a bag of matches into the two tables
 * the report is made of. **Nothing here decides anything** — `./cli.ts pay`
 * prints it and `docs/progression-balance-p1-08.md` argues from it.
 *
 * ── The three ceilings ─────────────────────────────────────────────────────
 *
 * GDD §3.8: "a hung match is a failed test, not a hung harness". This runner
 * carries the same three independent ceilings `./match.ts` does — sim time, wall
 * clock, and a tick backstop for a world whose clock stops advancing — and a run
 * that hits any of them comes back with `failure` set and `ok === false` rather
 * than throwing. **A hung match is a failed MEASUREMENT**: `payStats` counts
 * only `ok` matches into the pay tables and reports the shortfall beside them,
 * because a timed-out match's accrual is a partial match's accrual and pooling
 * it would quietly drag every median down.
 *
 * ── Why it does not reuse `runMatch` ───────────────────────────────────────
 *
 * `./match.ts` seats *probe strategies* — deliberately, because a win rate is
 * only attributable in a mirror of the thing being measured. But a probe has no
 * difficulty tier, and the tier is exactly what the XP multiplier reads
 * (plan §1.3b). This runner seats the **real shipped cast** (`createBots`) for
 * the same reason a0-13's spike did, and keeps `./match.ts` untouched.
 */

import type { PlayerId } from '@shared/types';
import type { Bot, PersonalityId } from '../src/bots';
import { DEFAULT_PERCEPTION, Difficulty, PERSONALITIES, botInputs, createBots, fillEmptySlots } from '../src/bots';
import type { Perception } from '../src/bots';
import type { Abundance, PlayerSpec, World } from '../src/sim';
import { TICK_DT, createWorld, isOver, step } from '../src/sim';
import { DEFAULT_MAP_ID } from '../src/sim/maps';
import { createAccrualObserver, totalByTier } from '../src/progression/accrual';
import type { MatchAccrual } from '../src/progression/accrual';
import { xpForMatch } from '../src/progression/xp';
import type { MatchXp, XpRowKey } from '../src/progression/xp';
import { levelForXp, xpToReach } from '../src/progression/curve';
import { buildSummary } from '../src/ui/summary-sequence';
import { hashState } from './hash';
import { MATCH_TIMEOUT_S, MATCH_WALL_CLOCK_MS } from './match';
import type { MatchFailure } from './match';

// ---------------------------------------------------------------------------
// The sample — stated, never sampled from a clock or an environment variable
// ---------------------------------------------------------------------------

/** The cast at each tier, as the plan's §1.3a lobbies name it. */
export const ROSTER_BY_TIER: Readonly<Record<Difficulty, readonly PersonalityId[]>> = {
  [Difficulty.Easy]: ['rusty', 'bolt'],
  [Difficulty.Medium]: ['foreman', 'patch'],
  [Difficulty.Hard]: ['sable', 'vulture', 'warden'],
};

/** The shipped fill order — what an offline lobby actually seats when the host
 *  picks no characters (`fillEmptySlots`'s default roster). */
export const MIXED_ROSTER: readonly PersonalityId[] = [
  'rusty',
  'bolt',
  'foreman',
  'patch',
  'sable',
  'vulture',
  'warden',
];

/** A named lobby: a label for the report and the cast it cycles across the seats. */
export interface Lobby {
  readonly label: string;
  readonly roster: readonly PersonalityId[];
}

/** The four lobbies §1.3a measured, so this rig's rows sit beside that table
 *  rather than near it. */
export const LOBBIES: readonly Lobby[] = [
  { label: 'EASY mirror', roster: ROSTER_BY_TIER[Difficulty.Easy] },
  { label: 'MEDIUM mirror', roster: ROSTER_BY_TIER[Difficulty.Medium] },
  { label: 'HARD mirror', roster: ROSTER_BY_TIER[Difficulty.Hard] },
  { label: 'MIXED cast', roster: MIXED_ROSTER },
];

/** The FFA boards. `line` and `crescents` are the TEAM maps (`TEAM_MAP_IDS`) and
 *  are deliberately outside an FFA pay sample: a 4v4 changes placement rungs and
 *  the win row for reasons that have nothing to do with the map. */
export const FFA_MAP_IDS: readonly string[] = ['octagon', 'compass', 'oval', 'diamond'];

/** `seedRange(12)` → 1..12, the sample a0-13 measured on. */
export const seeds = (count: number, from = 1): number[] =>
  Array.from({ length: count }, (_, i) => from + i);

// ---------------------------------------------------------------------------
// One match
// ---------------------------------------------------------------------------

/** One match to measure. Every axis the brief names is explicit; nothing is
 *  defaulted from a clock, an environment variable or a random source. */
export interface PaySetup {
  readonly seed: number;
  /** Seats in the lobby. Per-player ore density rises ~4× as this falls
   *  (`homeFieldOre(n)`), which is the reason N is an axis at all. */
  readonly slots: number;
  /** Which ratified board (`src/sim/maps.ts`). Defaults to the shipped default. */
  readonly mapId?: string;
  /**
   * Ore scarcity. **Omitted is NOT the shipped default**: `createWorld` keeps the
   * pre-p11 `standard` baseline for compatibility, while the lobby ships
   * `DEFAULT_ABUNDANCE = 'scarce'`. a0-13's spike omitted it, so every number in
   * plan §1.3a is a `standard` number. Name it in every reading.
   */
  readonly abundance?: Abundance;
  /** The cast, cycled across the seats. */
  readonly roster: readonly PersonalityId[];
}

/** How a pay match is run. Same three ceilings as `./match.ts`. */
export interface PayOptions {
  readonly dt?: number;
  readonly maxSeconds?: number;
  readonly maxWallClockMs?: number;
  readonly perception?: Perception;
  /**
   * Feed the accrual observer every `n` ticks instead of every tick.
   *
   * 1 (the default) is what an offline client does. Anything above it is a
   * *coarser* observation window, and the observer's own apportionment fallbacks
   * start firing — so it is a knob for measuring the observer, not for making a
   * sweep cheaper. `payStats` never sets it.
   */
  readonly observeEveryTicks?: number;
}

/** What one measured match produced. */
export interface PayResult {
  readonly setup: PaySetup;
  /** The match reached a real ending inside every ceiling. A `false` here is a
   *  failed measurement, not a hung harness. */
  readonly ok: boolean;
  readonly failure: MatchFailure | null;
  readonly seconds: number;
  readonly ticks: number;
  readonly wallClockMs: number;
  /** The final state hash (GDD §4.8) — observing must never move it. */
  readonly hash: string;
  readonly winner: PlayerId | null;
  /** The tier each seat is *scored* at, by slot. */
  readonly tiers: readonly Difficulty[];
  /** One per seat, in slot order — the shipped observer's answer. */
  readonly accruals: readonly MatchAccrual[];
  /** One per seat, in slot order — the shipped pricer's answer. */
  readonly xp: readonly MatchXp[];
}

/** How often the wall-clock guard is read — the same cadence `./match.ts` uses,
 *  and for the same reason: reading it every tick costs more than the step. */
const WALL_CLOCK_CHECK_TICKS = 256;

/** The seats a setup describes, cast cycled across them in slot order. */
function seatsOf(setup: PaySetup): { specs: PlayerSpec[]; tiers: Difficulty[]; bots: Bot[] } {
  const seats = fillEmptySlots([], setup.slots, setup.roster);
  const specs: PlayerSpec[] = seats.map((seat) => ({
    id: seat.id,
    shipClass: PERSONALITIES[seat.personality].shipClass,
  }));
  const tiers = seats.map((seat) => PERSONALITIES[seat.personality].difficulty);
  return { specs, tiers, bots: createBots(seats, { seed: setup.seed }) };
}

/** Build the world a setup describes. One construction path, so a reading and a
 *  replay of it cannot diverge. */
export function buildPayWorld(setup: PaySetup): World {
  return createWorld({
    seed: setup.seed,
    players: seatsOf(setup).specs,
    mapId: setup.mapId ?? DEFAULT_MAP_ID,
    ...(setup.abundance !== undefined ? { abundance: setup.abundance } : {}),
  });
}

/**
 * Run one match and price it.
 *
 * think → `step` → observe → check the ending → check the ceilings. The observer
 * is fed the authoritative world (there is only one here — this is offline), and
 * it is a **spectator**: it never writes a field of `World`, so the hash this
 * returns is the hash the same match produces with no observer attached. The
 * test that says so is `tests/harness/p1-08-pay.test.ts`.
 */
export function runPayMatch(setup: PaySetup, options: PayOptions = {}): PayResult {
  const dt = options.dt ?? TICK_DT;
  if (!(dt > 0)) throw new Error(`runPayMatch: dt must be positive, got ${dt}`);
  const every = options.observeEveryTicks ?? 1;
  if (!(Number.isInteger(every) && every > 0)) {
    throw new Error(`runPayMatch: observeEveryTicks must be a positive integer, got ${every}`);
  }

  const maxSeconds = options.maxSeconds ?? MATCH_TIMEOUT_S;
  const maxWallClockMs = options.maxWallClockMs ?? MATCH_WALL_CLOCK_MS;
  const maxTicks = Math.ceil((maxSeconds / dt) * 1.5) + 1;
  const env = options.perception ?? DEFAULT_PERCEPTION;

  const { specs, tiers, bots } = seatsOf(setup);
  const world = createWorld({
    seed: setup.seed,
    players: specs,
    mapId: setup.mapId ?? DEFAULT_MAP_ID,
    ...(setup.abundance !== undefined ? { abundance: setup.abundance } : {}),
  });
  const observer = createAccrualObserver(world, tiers);

  const startedAt = performance.now();
  let failure: MatchFailure | null = null;
  let ticks = 0;

  while (!isOver(world)) {
    if (world.time >= maxSeconds) {
      failure = 'sim-timeout';
      break;
    }
    if (ticks >= maxTicks) {
      failure = 'stalled';
      break;
    }
    if (ticks % WALL_CLOCK_CHECK_TICKS === 0 && performance.now() - startedAt > maxWallClockMs) {
      failure = 'wall-clock';
      break;
    }

    step(world, botInputs(world, bots, dt, { perception: env }), dt);
    ticks++;
    if (ticks % every === 0) observer.observe(world);
  }
  // The last window, whatever the loop broke on: a match that ended on a tick
  // the sampler skipped must still have that tick counted.
  observer.observe(world);

  const accruals = observer.finalize(world);
  return {
    setup,
    ok: failure === null,
    failure,
    seconds: world.time,
    ticks,
    wallClockMs: performance.now() - startedAt,
    hash: hashState(world),
    winner: failure === null ? world.match.winner : null,
    tiers,
    accruals,
    xp: accruals.map(xpForMatch),
  };
}

// ---------------------------------------------------------------------------
// Statistics — the arithmetic the report's tables are made of
// ---------------------------------------------------------------------------

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** One player-match, flattened — the unit every median below is taken over. */
export interface PlayerMatch {
  readonly accrual: MatchAccrual;
  readonly xp: MatchXp;
  readonly seconds: number;
  readonly won: boolean;
  readonly firstOut: boolean;
}

/** The accrual and XP tables for a bag of matches, plus the honesty columns. */
export interface PayStats {
  /** Matches run, and matches that reached a real ending. A gap is a failed
   *  measurement and every median below excludes it. */
  readonly matches: number;
  readonly ended: number;
  readonly failures: readonly MatchFailure[];
  /** Player-matches pooled (ended matches only). */
  readonly samples: number;

  // The accrual table (§1.3a's units)
  readonly oreMined: number;
  readonly oreBanked: number;
  readonly damageHp: number;
  readonly shipKills: number;
  readonly stationKills: number;
  readonly structures: number;
  readonly upgrades: number;
  readonly repairs: number;

  // The XP table (§1.3/§1.4's units)
  readonly medianXp: number;
  readonly meanXp: number;
  readonly winnerXp: number;
  readonly firstOutXp: number;
  /** winner ÷ first-out — s4's participation floor, in one number. Below 1.0 the
   *  first player knocked out out-earns the winner (plan §1.3c(1)). */
  readonly spread: number;
  /** Median XP per minute of match — the farm question (plan §1.3c(3)). */
  readonly xpPerMinute: number;

  /**
   * The same pool priced on the **ratified four rows only** — ore mined, damage,
   * ship kills, station kills — with s4's seven participation rows dropped.
   *
   * This is plan **Question A** asked as a measurement rather than an argument:
   * the plan's own §1.3c(1) table (spread 0.3× in an Easy lobby, 149 XP typical)
   * came from the spike's reconstruction against probe strategies, and the
   * question in front of the developer is whether dropping those rows really
   * inverts winner and first-out. It is computed by summing the four rows the
   * shipped pricer already itemises, so it can never drift from what would
   * happen if the other seven weights were set to zero.
   */
  readonly fourOnlyMedianXp: number;
  readonly fourOnlyWinnerXp: number;
  readonly fourOnlyFirstOutXp: number;
  readonly fourOnlySpread: number;
  /** Median match length in sim seconds — the 10–15 minute target (GDD §1). */
  readonly medianSeconds: number;
  readonly maxSeconds: number;
  /** Share of the median match's XP each row paid, keyed by row. */
  readonly composition: Readonly<Record<XpRowKey, number>>;
}

/** Flatten a bag of ended matches into player-matches. */
export function playerMatches(results: readonly PayResult[]): PlayerMatch[] {
  const out: PlayerMatch[] = [];
  for (const r of results) {
    if (!r.ok) continue;
    r.accruals.forEach((accrual, i) => {
      out.push({
        accrual,
        xp: r.xp[i]!,
        seconds: r.seconds,
        won: accrual.won,
        firstOut: accrual.placement === accrual.slots,
      });
    });
  }
  return out;
}

/** The player-match sitting at the median of a bag by XP — a *real* match to
 *  hand the summary sequence, rather than a synthetic average that no seat
 *  actually played. */
export function medianPlayerMatch(results: readonly PayResult[]): PlayerMatch | null {
  const pool = playerMatches(results);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => a.xp.total - b.xp.total);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Pool a bag of matches into the two tables. */
export function payStats(results: readonly PayResult[]): PayStats {
  const pool = playerMatches(results);
  const ended = results.filter((r) => r.ok);
  const totals = pool.map((p) => p.xp.total);
  const medXp = median(totals);
  const firstOut = median(pool.filter((p) => p.firstOut).map((p) => p.xp.total));

  const fourOnly = (p: PlayerMatch): number =>
    p.xp.rows.reduce((sum, r) => sum + (RATIFIED_FOUR.includes(r.key) ? r.xp : 0), 0);
  const fourWinner = median(pool.filter((p) => p.won).map(fourOnly));
  const fourFirstOut = median(pool.filter((p) => p.firstOut).map(fourOnly));

  // Composition is taken over the whole pool rather than off one match: a single
  // median match has no station kill in it at all (§1.3a), and a row that is rare
  // but huge is exactly what a composition table exists to show.
  const paid = (key: XpRowKey): number =>
    pool.reduce((sum, p) => sum + (p.xp.rows.find((r) => r.key === key)?.xp ?? 0), 0);
  const allPaid = pool.reduce((sum, p) => sum + p.xp.total, 0);
  const composition = Object.fromEntries(
    XP_ROW_KEYS.map((key) => [key, allPaid > 0 ? paid(key) / allPaid : 0]),
  ) as Record<XpRowKey, number>;

  return {
    matches: results.length,
    ended: ended.length,
    failures: results.filter((r) => r.failure !== null).map((r) => r.failure!),
    samples: pool.length,

    oreMined: median(pool.map((p) => p.accrual.oreMined)),
    oreBanked: median(pool.map((p) => p.accrual.oreBanked)),
    damageHp: median(pool.map((p) => totalByTier(p.accrual.damageDealt))),
    shipKills: median(pool.map((p) => totalByTier(p.accrual.shipKills))),
    stationKills: median(pool.map((p) => totalByTier(p.accrual.stationKills))),
    structures: median(pool.map((p) => p.accrual.structures)),
    upgrades: median(pool.map((p) => p.accrual.upgrades)),
    repairs: median(pool.map((p) => p.accrual.repairs)),

    medianXp: medXp,
    meanXp: mean(totals),
    winnerXp: median(pool.filter((p) => p.won).map((p) => p.xp.total)),
    firstOutXp: firstOut,
    spread: firstOut > 0 ? median(pool.filter((p) => p.won).map((p) => p.xp.total)) / firstOut : 0,
    xpPerMinute: median(pool.map((p) => (p.seconds > 0 ? p.xp.total / (p.seconds / 60) : 0))),

    fourOnlyMedianXp: median(pool.map(fourOnly)),
    fourOnlyWinnerXp: fourWinner,
    fourOnlyFirstOutXp: fourFirstOut,
    fourOnlySpread: fourFirstOut > 0 ? fourWinner / fourFirstOut : 0,

    medianSeconds: median(ended.map((r) => r.seconds)),
    maxSeconds: ended.reduce((max, r) => Math.max(max, r.seconds), 0),
    composition,
  };
}

/** The developer's four ratified rows (plan §1.3d rows 1–4), as row keys — the
 *  half of the table that is *not* Question A. */
export const RATIFIED_FOUR: readonly XpRowKey[] = ['oreMined', 'damage', 'shipKills', 'stationKills'];

/** Fixed order, so a composition table is the §1.3d table's order every time. */
export const XP_ROW_KEYS: readonly XpRowKey[] = [
  'oreMined',
  'damage',
  'shipKills',
  'stationKills',
  'oreBanked',
  'structures',
  'upgrades',
  'repairs',
  'waves',
  'placement',
  'win',
];

// ---------------------------------------------------------------------------
// The curve, re-fitted against a measured pay
// ---------------------------------------------------------------------------

/**
 * How many matches at `payPerMatch` it takes to reach `level` from a fresh
 * profile.
 *
 * Reads the **shipped** curve (`src/progression/curve.ts`), so a re-tune of
 * `XP_CURVE_BASE`/`XP_CURVE_EXP` moves this table with it and the report can
 * never quote a curve the game does not run.
 */
export function matchesToLevel(payPerMatch: number, level: number): number {
  if (!(payPerMatch > 0)) return Infinity;
  return xpToReach(level) / payPerMatch;
}

/** The plan §1.4 milestones, in its order. */
export const CURVE_MILESTONES: readonly number[] = [2, 5, 10, 20];

/**
 * What the end-of-match summary costs a player, match after match.
 *
 * The brief asks whether the 10–15 minute match target still holds **with the
 * summary sequence in the loop** — "a five-second beat every match is not free at
 * the fiftieth match". It is not a guess: `buildSummary` (pr-05) fixes the whole
 * timeline before a frame exists, and its `duration` is the answer for one
 * match. The only thing that moves it is how many level-ups the sequence has to
 * play, which is a function of where the player's lifetime total sits — so this
 * walks a career forward, one match at a time, at a measured pay.
 *
 * Reads the shipped sequence, so a re-tune of `SUMMARY_TIMING` moves this
 * reading with it. It is a *model* of the career, not a measurement of one: it
 * assumes every match pays the median and that the player watches rather than
 * skips (rule 1 — the screen is always skippable, and a skip costs one tap).
 */
export interface SummaryCost {
  readonly matches: number;
  /** The first match's sequence — a fresh profile, and the level-2 hook in it. */
  readonly firstMatchSeconds: number;
  /** Median and worst single sequence across the career. */
  readonly medianSeconds: number;
  readonly maxSeconds: number;
  /** Every sequence added up — what the player spends watching, in total. */
  readonly totalSeconds: number;
  /** Sequences that carried at least one level-up beat. */
  readonly withLevelUp: number;
  /** The level reached at the end of the career. */
  readonly finalLevel: number;
}

export function summaryCost(
  accrual: MatchAccrual,
  xp: MatchXp,
  matches: number,
): SummaryCost {
  const each: number[] = [];
  let withLevelUp = 0;
  let lifetime = 0;
  for (let i = 0; i < matches; i++) {
    const seq = buildSummary({ accrual, xp, startXp: lifetime });
    each.push(seq.duration);
    if (seq.fills.some((f) => f.levelUp)) withLevelUp++;
    lifetime += xp.total;
  }
  return {
    matches,
    firstMatchSeconds: each[0] ?? 0,
    medianSeconds: median(each),
    maxSeconds: each.reduce((max, s) => Math.max(max, s), 0),
    totalSeconds: each.reduce((sum, s) => sum + s, 0),
    withLevelUp,
    finalLevel: levelForXp(lifetime),
  };
}

/**
 * The `XP_CURVE_BASE` at which level 2 lands after exactly `matches` matches of
 * `payPerMatch` XP.
 *
 * `xpToNext(1) = base · 1^exp = base`, so the whole hook — "you level up your
 * first game" — is the single comparison `base ≤ pay`, independent of
 * `XP_CURVE_EXP`. That is why `base` is the only dial this report recommends
 * moving, and why moving it is safe: it slides the early game without touching
 * the tail's shape.
 */
export const baseForLevel2In = (payPerMatch: number, matches = 1): number => payPerMatch * matches;

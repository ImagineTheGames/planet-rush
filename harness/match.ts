/**
 * harness/match.ts — the headless bot-vs-bot match harness. OWNER: QA Agent
 * (GDD §3.8, §4.8).
 *
 * The charter sentence this file exists to honor:
 *
 * > "Runs headless bot-vs-bot matches **with an enforced match timeout** (a hung
 * > match is a failed test, not a hung harness)." — GDD §3.8
 *
 * So the loop below carries **three** independent ceilings, and it always
 * returns rather than hanging:
 *
 *  1. **Sim time** (`maxSeconds`) — the match itself is not ending. The design
 *     guarantees an ending by ~12.5 minutes at baseline constants (GDD §2.3,
 *     `COLLAPSE_GRACE_S`); a run past this ceiling has falsified that.
 *  2. **Wall clock** (`maxWallClockMs`) — the *harness* is not ending. A sim
 *     that slows to a crawl (an entity leak, an O(n²) regression) would
 *     otherwise turn a failing test into a hung CI job.
 *  3. **Ticks** (`maxTicks`, derived) — the backstop for the pathological case
 *     where `world.time` stops advancing at all. Neither of the ceilings above
 *     can catch that one; this one can.
 *
 * A run that hits any ceiling comes back with `failure` set and `ok === false`.
 * Nothing in here throws on a bad match, because "the match hung" is a *result*
 * QA reports, not an exception that loses the run that produced it.
 *
 * Runs a full 8-slot match by default (GDD §2.1 — eight stations, always). Imports
 * `src/sim/` and `src/bots/` headless; never PixiJS, never a DOM, never a wall
 * clock inside the simulation (the wall clock here is the *guard*, and it is
 * read outside `step`, so it can never influence the world).
 */

import type { Action, PlayerId } from '@shared/types';
import { ShipClass } from '@shared/types';
import type { Bot } from '../src/bots';
import { MATCH_SLOTS, createBot, fillEmptySlots } from '../src/bots';
import { perceive, DEFAULT_PERCEPTION } from '../src/bots';
import type { Perception } from '../src/bots';
import type { Inputs, PlayerInput, PlayerSpec, World } from '../src/sim';
import { TICK_DT, createWorld, fieldOre, isOver, step } from '../src/sim';
import { hashState } from './hash';
import type { StrategyId } from './strategies';
import { strategy } from './strategies';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** One seat at the table: who is flying, what they are flying, how they play. */
export interface SlotSpec {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
  readonly strategy: StrategyId;
}

/** A match to run. Everything is explicit and seeded — no defaults are read
 *  from a clock, an environment variable, or a random source. */
export interface MatchSetup {
  readonly seed: number;
  /** The full lineup. Eight seats is a real match (GDD §2.1); fewer is a probe. */
  readonly lineup: readonly SlotSpec[];
  /** Play bounds, if the default 1920×1920 arena is not what is being tested. */
  readonly bounds?: { width: number; height: number };
  /** Asteroids per wave, overriding `WAVE.asteroidsPerWave`. */
  readonly asteroidCount?: number;
}

/**
 * Hard ceiling on a headless match, in **sim seconds**. The design target is a
 * 10–15 minute match (GDD §1) and collapse is guaranteed by ~12.5 minutes at
 * baseline constants, so 20 minutes is comfortably "this match is not going to
 * end". Matches the Bot Engineer's `DEFAULT_MATCH_TIMEOUT_S` on purpose: one
 * number, two harnesses. TUNABLE
 */
export const MATCH_TIMEOUT_S = 20 * 60;

/**
 * Hard ceiling on a headless match, in **wall-clock milliseconds**. A 20-minute
 * sim match is ~72 000 ticks; on any machine that can run the game it completes
 * in single-digit seconds. Two minutes is therefore a diagnosis, not a budget:
 * something is pathologically slow. TUNABLE
 */
export const MATCH_WALL_CLOCK_MS = 120_000;

/**
 * Ticks between decisions, per slot — 10 Hz. Reaction cadence modelled the same
 * way the shipped bots model it (`src/bots/harness.ts`): a probe holds its last
 * action stream in between, exactly like a human whose hands have not moved.
 * Deterministic, and it keeps an eight-slot match from re-perceiving the world
 * sixty times a second per seat. TUNABLE
 */
export const DECISION_TICKS = 6;

/** How a match is run. */
export interface RunOptions {
  /** Fixed timestep. Defaults to the sim's 60 Hz `TICK_DT`. */
  readonly dt?: number;
  /** Sim-seconds ceiling (see {@link MATCH_TIMEOUT_S}). */
  readonly maxSeconds?: number;
  /** Wall-clock ceiling in ms (see {@link MATCH_WALL_CLOCK_MS}). */
  readonly maxWallClockMs?: number;
  /** Perception envelope handed to every probe. Defaults to the bots' own
   *  fog-honest baseline; it can be narrowed, never widened past the human
   *  ceiling (`resolvePerception` clamps). */
  readonly perception?: Perception;
  /** Record every tick's inputs, so the run can be replayed bit-for-bit
   *  (GDD §4.8). Off by default: a full match is ~72 000 ticks of arrays. */
  readonly record?: boolean;
  /** Called after every step — sampling hangs off this (perf, wave timing). */
  readonly onTick?: (world: World, tick: number) => void;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Why a run stopped short of a result. `null` means the match ended properly. */
export type MatchFailure =
  /** The match ran past the sim-time ceiling without producing a winner. */
  | 'sim-timeout'
  /** The harness ran past its wall-clock ceiling — the sim is too slow. */
  | 'wall-clock'
  /** `world.time` stopped advancing: the sim is stuck, not merely slow. */
  | 'stalled';

/** What one seat did with its match. */
export interface SlotResult {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
  readonly strategy: StrategyId;
  /** Their home survived to the end. */
  readonly survived: boolean;
  /** Sim seconds their core lasted (the full match, if it survived). */
  readonly survivedSeconds: number;
  /** Core HP left, as a fraction of max — 0 for a wreck. */
  readonly coreFraction: number;
  /** Ore banked at the end (a wreck's bank has burst into debris — GDD §2.7). */
  readonly banked: number;
  readonly turrets: number;
  readonly shields: number;
}

/** Everything one headless match produced. */
export interface MatchResult {
  readonly seed: number;
  /** True when the match reached a real ending inside every ceiling. */
  readonly ok: boolean;
  readonly failure: MatchFailure | null;
  /** The winning slot, or null when there was no result. */
  readonly winner: PlayerId | null;
  readonly winnerStrategy: StrategyId | null;
  readonly winnerClass: ShipClass | null;
  /** Sim seconds elapsed — the match-length target is measured on this (GDD §1). */
  readonly seconds: number;
  readonly ticks: number;
  /** Wall-clock milliseconds the harness spent stepping. */
  readonly wallClockMs: number;
  /** Sim time collapse began, or -1 if it never did (GDD §2.3). */
  readonly collapseTime: number;
  readonly wavesSpawned: number;
  /** Ore still lying in the field at the end — the finite yield, unspent. */
  readonly fieldOreLeft: number;
  /** Elimination order — the last-to-die tiebreak, as it happened (GDD §1). */
  readonly eliminated: readonly PlayerId[];
  /** The final state hash (GDD §4.8). */
  readonly hash: string;
  readonly slots: readonly SlotResult[];
  /** The finished world, for any assertion this shape does not anticipate. */
  readonly world: World;
}

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

/** A full eight-seat lineup, every seat playing `id` in the same hull. The
 *  mirror match: the only setup in which a win rate is attributable to the
 *  thing being measured and nothing else (GDD §2.11, §3.8). */
export function mirrorLineup(strategyId: StrategyId, shipClass: ShipClass, slots = MATCH_SLOTS): SlotSpec[] {
  return Array.from({ length: slots }, (_, id) => ({ id, shipClass, strategy: strategyId }));
}

/**
 * A lineup that deals `entries` round-robin across the seats, rotated by
 * `rotation`. Rotation is the control for seat advantage: the ring is
 * geometrically symmetric, but wave scatter is seeded and the resolution order
 * is by slot, so the same lineup is run in every rotation and the results are
 * pooled.
 */
export function roundRobinLineup(
  entries: readonly { strategy: StrategyId; shipClass: ShipClass }[],
  rotation = 0,
  slots = MATCH_SLOTS,
): SlotSpec[] {
  if (entries.length === 0) throw new Error('roundRobinLineup: no entries');
  return Array.from({ length: slots }, (_, id) => {
    const e = entries[(id + rotation) % entries.length]!;
    return { id, shipClass: e.shipClass, strategy: e.strategy };
  });
}

/** The lobby rows `createWorld` wants, from a lineup. */
function playerSpecs(lineup: readonly SlotSpec[]): PlayerSpec[] {
  return lineup.map((s) => ({ id: s.id, shipClass: s.shipClass }));
}

// ---------------------------------------------------------------------------
// The seat: a probe wired to the shipped bot contract
// ---------------------------------------------------------------------------

/**
 * One seat's decision scheduler. A probe is wrapped in a real {@link Bot} (from
 * `src/bots`) so it carries a personality and a seat exactly like a shipped bot
 * does — the harness measures the same object type either way, which is what
 * makes swapping in the Bot Engineer's trees a one-line change.
 */
interface Seat {
  readonly spec: SlotSpec;
  readonly bot: Bot;
  /** Ticks until this seat thinks again. Staggered at construction so the eight
   *  seats do not all recompute on the same tick — deterministic, because the
   *  stagger is the slot index. */
  countdown: number;
  actions: readonly Action[];
}

/** Seat the lineup: one bot per slot, in slot order, with a deterministic
 *  decision stagger. */
function seatLineup(lineup: readonly SlotSpec[], seed: number): Seat[] {
  // Personalities come from the shipped roster in roster order, so a harness
  // match has the same cast a player's offline match would (GDD §2.9); the
  // probe replaces only the tree.
  const cast = fillEmptySlots([], lineup.length);
  return lineup.map((spec, i) => {
    const seatSpec = cast[i] ?? { id: spec.id, personality: cast[0]!.personality };
    const bot = createBot({ id: spec.id, personality: seatSpec.personality }, { seed });
    const decide = strategy(spec.strategy).create(spec.id);
    return {
      spec,
      bot: { ...bot, decide },
      countdown: i % DECISION_TICKS,
      actions: [],
    };
  });
}

/** One tick of thinking for every seat, as `Inputs` the sim consumes directly.
 *  Eliminated seats emit nothing at all — their match is over (GDD §2.7). */
function tickInputs(world: World, seats: readonly Seat[], env: Perception): Inputs {
  const inputs: PlayerInput[] = [];
  for (const seat of seats) {
    if (seat.countdown <= 0) {
      const view = perceive(world, seat.spec.id, env);
      seat.actions = view.self.eliminated ? EMPTY_ACTIONS : seat.bot.decide(view);
      seat.countdown = DECISION_TICKS;
    }
    seat.countdown--;
    inputs.push({ id: seat.spec.id, actions: seat.actions });
  }
  return inputs;
}

const EMPTY_ACTIONS: readonly Action[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** A recorded run: everything needed to replay it bit-for-bit (GDD §4.8). */
export interface MatchRecording {
  readonly setup: MatchSetup;
  readonly dt: number;
  /** `inputs[t]` is what every seat sent on tick `t`. */
  readonly inputs: readonly Inputs[];
  /** The state hash the recorded run finished on. */
  readonly hash: string;
}

/** A run plus its recording (only when `record` was set). */
export interface RecordedRun {
  readonly result: MatchResult;
  readonly recording: MatchRecording;
}

/** How often the wall-clock guard is read. Every tick would cost more than the
 *  step it guards; 256 ticks is ~4 s of sim time and microseconds of check. */
const WALL_CLOCK_CHECK_TICKS = 256;

/**
 * Run one headless match to its ending — or to whichever ceiling it hits first.
 *
 * The loop is exactly: think → `step` → check the ending → check the ceilings.
 * Nothing here reaches into the world; the only writer is the simulation.
 */
export function runMatch(setup: MatchSetup, options: RunOptions = {}): MatchResult {
  return runMatchInternal(setup, options).result;
}

/**
 * Run a match and keep every tick's inputs, so the same run can be replayed and
 * hashed (GDD §4.8: "same inputs, same final state hash"). Separate entry point
 * because recording a full match allocates one array per tick — a cost the
 * balance sweep must not pay.
 */
export function recordMatch(setup: MatchSetup, options: RunOptions = {}): RecordedRun {
  const run = runMatchInternal(setup, { ...options, record: true });
  return {
    result: run.result,
    recording: {
      setup,
      dt: options.dt ?? TICK_DT,
      inputs: run.recorded,
      hash: run.result.hash,
    },
  };
}

/**
 * Replay a recording against a freshly-constructed world and return the state
 * hash it finishes on. Constructs the world from the *same setup*, so this
 * exercises seeded construction as well as the step — a replay that only re-ran
 * `step` would miss a non-deterministic `createWorld` entirely.
 */
export function replay(recording: MatchRecording): { hash: string; world: World } {
  const world = buildWorld(recording.setup);
  for (const inputs of recording.inputs) {
    step(world, inputs, recording.dt);
  }
  return { hash: hashState(world), world };
}

/** Construct the world a setup describes. One code path for the run and for the
 *  replay, which is the point. */
export function buildWorld(setup: MatchSetup): World {
  return createWorld({
    seed: setup.seed,
    players: playerSpecs(setup.lineup),
    ...(setup.bounds ? { bounds: setup.bounds } : {}),
    ...(setup.asteroidCount !== undefined ? { asteroidCount: setup.asteroidCount } : {}),
  });
}

/** The shared implementation behind {@link runMatch} and {@link recordMatch}. */
function runMatchInternal(
  setup: MatchSetup,
  options: RunOptions,
): { result: MatchResult; recorded: Inputs[] } {
  const dt = options.dt ?? TICK_DT;
  if (!(dt > 0)) throw new Error(`runMatch: dt must be positive, got ${dt}`);

  const maxSeconds = options.maxSeconds ?? MATCH_TIMEOUT_S;
  const maxWallClockMs = options.maxWallClockMs ?? MATCH_WALL_CLOCK_MS;
  // The stall backstop: 50% more ticks than the sim-time ceiling could possibly
  // need. Reaching it means `world.time` is not tracking `dt` — a stuck sim.
  const maxTicks = Math.ceil((maxSeconds / dt) * 1.5) + 1;

  const world = buildWorld(setup);
  const seats = seatLineup(setup.lineup, setup.seed);
  const env = options.perception ?? DEFAULT_PERCEPTION;
  const recorded: Inputs[] = [];

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

    const inputs = tickInputs(world, seats, env);
    if (options.record) recorded.push(inputs);
    step(world, inputs, dt);
    ticks++;
    options.onTick?.(world, ticks);
  }

  const wallClockMs = performance.now() - startedAt;
  return { result: summarize(setup, seats, world, ticks, wallClockMs, failure), recorded };
}

/** Turn a finished world into the flat, plain-data result a report reads. */
function summarize(
  setup: MatchSetup,
  seats: readonly Seat[],
  world: World,
  ticks: number,
  wallClockMs: number,
  failure: MatchFailure | null,
): MatchResult {
  const ended = isOver(world);
  const winner = ended ? world.match.winner : null;
  const bySlot = new Map<PlayerId, SlotSpec>(seats.map((s) => [s.spec.id, s.spec]));

  const slots: SlotResult[] = world.stations.map((station) => {
    const spec = bySlot.get(station.owner);
    const ship = world.ships.find((s) => s.id === station.owner);
    return {
      id: station.owner,
      shipClass: spec?.shipClass ?? ShipClass.Vanguard,
      strategy: spec?.strategy ?? 'idle',
      survived: station.alive,
      survivedSeconds: station.alive ? world.time : station.deathTime,
      coreFraction: station.maxCoreHp > 0 ? Math.max(0, station.coreHp) / station.maxCoreHp : 0,
      banked: ship?.banked ?? 0,
      turrets: station.turrets.length,
      shields: station.shields.length,
    };
  });

  const winnerSpec = winner === null ? undefined : bySlot.get(winner);

  return {
    seed: setup.seed,
    ok: ended && failure === null,
    failure,
    winner,
    winnerStrategy: winnerSpec?.strategy ?? null,
    winnerClass: winnerSpec?.shipClass ?? null,
    seconds: world.time,
    ticks,
    wallClockMs,
    collapseTime: world.match.collapseTime,
    wavesSpawned: world.match.wavesSpawned,
    fieldOreLeft: fieldOre(world),
    eliminated: [...world.match.eliminated],
    hash: hashState(world),
    slots,
    world,
  };
}

/**
 * Run the same setup across a span of seeds. One match is an anecdote; the
 * balance targets are claims about a distribution (GDD §3.8), so every number in
 * a balance report comes from a sweep and never from a single run.
 */
export function runSeeds(
  make: (seed: number) => MatchSetup,
  seeds: readonly number[],
  options: RunOptions = {},
): MatchResult[] {
  return seeds.map((seed) => runMatch(make(seed), options));
}

/** Seeds `[from, from + count)` — a stated, reproducible span, never a random
 *  sample. */
export function seedRange(count: number, from = 1): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

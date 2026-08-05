/**
 * spikes/team-bots/measure-team-gaps.ts — THROWAWAY measurement code for
 * docs/team-bots-plan.md (Architect spike s5-01). NOT production; not in the
 * build; excluded from tsconfig/vitest include. Run it with:
 *
 *   npx vite-node spikes/team-bots/measure-team-gaps.ts
 *
 * The plan claims bots have no ally concept. That is a `grep` result, and a grep
 * does not tell you what it COSTS. This spike runs the real shipped trees in a
 * real team-aware world and measures the seven consequences the plan stages
 * against, so every number in the doc is reproducible from this file:
 *
 *   1. Do the bots even know their side?  — `botLobby()` drops `team`, so a
 *      TEAMS bot match has to be assembled by hand HERE. That is finding zero.
 *   2. `nearestLivingRival` → an ALLY: the collapse-phase `hunt` target.
 *   3. `leaderStation` → an ALLY: Medium's "gang the leader" pick.
 *   4. `bestTarget` → an ALLY-owned ship or home: Hard's whole attack branch.
 *   5. `homeIntruder` → an ALLY: the defender turning to "meet" its teammate.
 *   6. Two allies committed to the SAME rock (`Brain.mineSite`), against the
 *      enemy-pair rate as a control.
 *   7. Ally-siege blindness: seconds an ally's home is under attack while the
 *      teammate is out of `SENSOR_RANGE` of it, i.e. seconds a bot could not
 *      have answered a call it was never able to hear.
 *   8. Orphan seconds: sim time a team spends with one member ELIMINATED and
 *      another still alive — the state the win-condition stage is about.
 *
 * Plus the balance control: match length and result for FFA vs 2v2 vs 4v4 at the
 * same seeds, so the doc can say which measured targets move.
 *
 * Method notes, so the numbers are readable rather than trusted:
 *
 *  - The world is built team-aware (`PlayerSpec.team`) and the bots are the real
 *    `createBots` cast. Nothing in `src/` is patched.
 *  - Metrics 2–5 need a `BotCtx`, which only exists inside a decision. Rather
 *    than reach into a live bot's brain mid-decision (which would corrupt it),
 *    each seat gets a SHADOW brain fed the same fog-honest views on a coarser
 *    cadence. A shadow's memory is therefore slightly staler than the real
 *    bot's; that biases the ally-read rates DOWN (a staler memory has fewer
 *    scouted stations to mistake for a leader), so every rate here is a floor.
 *  - Metrics 1, 6, 7, 8 are read off the world and the real bots' brains, every
 *    tick, with no shadow involved.
 *
 * Deterministic: seeded, no wall clock in any measurement, same output every run.
 */

import { ShipClass } from '../../src/shared/types';
import { mulberry32 } from '../../src/shared/types';
import type { PlayerSpec, World } from '../../src/sim';
import { SENSOR_RANGE, createWorld } from '../../src/sim';
import type { Bot } from '../../src/bots';
import {
  DEFAULT_PERCEPTION,
  PERSONALITIES,
  bestTarget,
  context,
  createBots,
  createBrain,
  fillEmptySlots,
  homeIntruder,
  leaderStation,
  nearestLivingRival,
  perceive,
  runHeadlessMatch,
} from '../../src/bots';
import type { Brain } from '../../src/bots';

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

/** One measured configuration: a size and a side table over the dense slots. */
interface Lineup {
  readonly label: string;
  readonly size: number;
  /** Team of slot `i`. FFA is teams-of-one. */
  readonly teams: readonly number[];
}

const LINEUPS: readonly Lineup[] = [
  { label: 'FFA 4 (control)', size: 4, teams: [0, 1, 2, 3] },
  { label: 'TEAMS 2v2', size: 4, teams: [0, 0, 1, 1] },
  { label: 'FFA 8 (control)', size: 8, teams: [0, 1, 2, 3, 4, 5, 6, 7] },
  { label: 'TEAMS 4v4', size: 8, teams: [0, 0, 0, 0, 1, 1, 1, 1] },
];

/** Seeds every lineup is run at. Stated, not sampled — a hidden sample is a
 *  hidden result (harness/balance.ts's discipline). */
const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** Enforced ceiling, sim seconds. A hung match is a failed measurement. */
const MAX_SECONDS = 20 * 60;

/** Ticks between shadow samples for the ctx-level metrics (2–5). 30 ticks is
 *  2 Hz — coarser than every tier's decision cadence, which is the bias note in
 *  the header. */
const SAMPLE_TICKS = 30;

/**
 * Assemble a TEAMS bot match by hand.
 *
 * **This function is finding zero.** `botLobby()` (`src/bots/harness.ts`) maps a
 * seat to `{id, shipClass}` and nothing else — there is no `team` on `BotSeat`
 * and no way to put one there — so the shipped bot path cannot express a team
 * match at all. The world below is team-aware only because this spike stamps
 * `PlayerSpec.team` itself, exactly as `src/platform/match-boot.ts` does for the
 * offline client. The BOTS still learn nothing: `SelfView` carries no team.
 */
function build(lineup: Lineup, seed: number): { world: World; bots: Bot[] } {
  const seats = fillEmptySlots([], lineup.size);
  const players: PlayerSpec[] = seats.map((seat, i) => ({
    id: seat.id,
    shipClass: PERSONALITIES[seat.personality].shipClass,
    team: lineup.teams[i]!,
  }));
  const world = createWorld({ seed, players });
  return { world, bots: createBots(seats, { seed }) };
}

// ---------------------------------------------------------------------------
// Tallies
// ---------------------------------------------------------------------------

interface Tally {
  matches: number;
  ended: number;
  timedOut: number;
  secondsTotal: number;

  /** Shadow samples taken (the denominator for the ctx-level rates). */
  ctxSamples: number;
  huntSamples: number; // samples where a hunt target existed
  huntAlly: number;
  leaderSamples: number;
  leaderAlly: number;
  targetSamples: number;
  targetAlly: number;
  intruderSamples: number;
  intruderAlly: number;

  /** Per-tick pair tallies (metric 6). */
  pairTicks: number;
  allyPairs: number;
  allyPairsSameRock: number;
  foePairs: number;
  foePairsSameRock: number;

  /** Seconds (metrics 7, 8). */
  allySiegeSeconds: number;
  allySiegeBlindSeconds: number;
  orphanSeconds: number;
  /** Sim seconds a bot spent eliminated while its own team still held a core. */
  orphanBotSeconds: number;

  /**
   * How far the teammate actually was when an ally's home was under attack —
   * the "how far is too far" question of stage 2, as a distribution rather than
   * an opinion. Bucketed in world units; the last bucket is "the far side of the
   * map". Seconds, not samples, so a long siege weighs more than a tap.
   */
  siegeDistanceBuckets: number[];

  /** Overlap (stage 3): pair-ticks where two live allies were within one
   *  `visualRange` of each other — duplicated coverage of the same board. */
  allyPairsOverlapping: number;
  foePairsOverlapping: number;
  /** Σ pair distance, for the mean. */
  allyPairDistance: number;
  foePairDistance: number;
}

/** Upper edges of {@link Tally.siegeDistanceBuckets}, world units. `SENSOR_RANGE`
 *  (the scouting radius) and `visualRange` are called out because they are the
 *  two thresholds the perception envelope already uses. */
const SIEGE_BUCKETS: readonly number[] = [
  SENSOR_RANGE,
  DEFAULT_PERCEPTION.visualRange,
  1200,
  1800,
  2400,
  Number.POSITIVE_INFINITY,
];
const SIEGE_BUCKET_LABELS: readonly string[] = [
  `≤sensor(${SENSOR_RANGE})`,
  `≤visual(${DEFAULT_PERCEPTION.visualRange})`,
  '≤1200',
  '≤1800',
  '≤2400',
  '>2400',
];

function newTally(): Tally {
  return {
    matches: 0,
    ended: 0,
    timedOut: 0,
    secondsTotal: 0,
    ctxSamples: 0,
    huntSamples: 0,
    huntAlly: 0,
    leaderSamples: 0,
    leaderAlly: 0,
    targetSamples: 0,
    targetAlly: 0,
    intruderSamples: 0,
    intruderAlly: 0,
    pairTicks: 0,
    allyPairs: 0,
    allyPairsSameRock: 0,
    foePairs: 0,
    foePairsSameRock: 0,
    allySiegeSeconds: 0,
    allySiegeBlindSeconds: 0,
    orphanSeconds: 0,
    orphanBotSeconds: 0,
    siegeDistanceBuckets: SIEGE_BUCKETS.map(() => 0),
    allyPairsOverlapping: 0,
    foePairsOverlapping: 0,
    allyPairDistance: 0,
    foePairDistance: 0,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function measure(lineup: Lineup, seed: number, tally: Tally): void {
  const { world, bots } = build(lineup, seed);
  const teamOfSlot = (id: number): number => lineup.teams[id]!;
  const allied = (a: number, b: number): boolean => a !== b && teamOfSlot(a) === teamOfSlot(b);

  // Shadow minds for the ctx-level reads. Same character, same seeded stream
  // shape, fed the same views — but on this spike's cadence, never the bot's.
  const shadows = new Map<number, Brain>();
  for (const bot of bots) {
    shadows.set(bot.seat.id, createBrain(PERSONALITIES[bot.seat.personality], mulberry32(0xa5c0_de ^ bot.seat.id)));
  }

  const dt = 1 / 60;

  const onTick = (w: World, tick: number): void => {
    // --- metric 6: two allies committed to the same rock -------------------
    tally.pairTicks++;
    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const a = bots[i]!;
        const b = bots[j]!;
        const shipA = w.ships.find((s) => s.id === a.seat.id);
        const shipB = w.ships.find((s) => s.id === b.seat.id);
        if (!shipA?.alive || !shipB?.alive) continue;
        const same = a.brain.mineSite >= 0 && a.brain.mineSite === b.brain.mineSite;
        const apart = distance(shipA.pos, shipB.pos);
        const overlapping = apart <= DEFAULT_PERCEPTION.visualRange;
        if (allied(a.seat.id, b.seat.id)) {
          tally.allyPairs++;
          tally.allyPairDistance += apart;
          if (same) tally.allyPairsSameRock++;
          if (overlapping) tally.allyPairsOverlapping++;
        } else {
          tally.foePairs++;
          tally.foePairDistance += apart;
          if (same) tally.foePairsSameRock++;
          if (overlapping) tally.foePairsOverlapping++;
        }
      }
    }

    // --- metric 7: ally-siege blindness ------------------------------------
    for (const station of w.stations) {
      if (!station.alive || station.derelict) continue;
      if (station.sinceDamage >= DEFAULT_PERCEPTION.alarmWindow) continue;
      for (const mate of w.ships) {
        if (mate.id === station.owner) continue;
        if (!allied(mate.id, station.owner)) continue;
        if (!mate.alive) continue;
        tally.allySiegeSeconds += dt;
        const surface = Math.max(0, distance(mate.pos, station.pos) - station.radius);
        if (surface > SENSOR_RANGE) tally.allySiegeBlindSeconds += dt;
        for (let b = 0; b < SIEGE_BUCKETS.length; b++) {
          if (surface <= SIEGE_BUCKETS[b]!) {
            tally.siegeDistanceBuckets[b]! += dt;
            break;
          }
        }
      }
    }

    // --- metric 8: orphan seconds ------------------------------------------
    const aliveByTeam = new Map<number, number>();
    const deadByTeam = new Map<number, number>();
    for (const station of w.stations) {
      if (station.derelict) continue;
      const team = teamOfSlot(station.owner);
      const map = station.alive ? aliveByTeam : deadByTeam;
      map.set(team, (map.get(team) ?? 0) + 1);
    }
    for (const [team, alive] of aliveByTeam) {
      if (alive > 0 && (deadByTeam.get(team) ?? 0) > 0) tally.orphanSeconds += dt;
    }
    for (const ship of w.ships) {
      if (!ship.eliminated) continue;
      if ((aliveByTeam.get(teamOfSlot(ship.id)) ?? 0) > 0) tally.orphanBotSeconds += dt;
    }

    // --- metrics 2–5: what the shipped reads return in a team world --------
    if (tick % SAMPLE_TICKS !== 0) return;
    for (const bot of bots) {
      const ship = w.ships.find((s) => s.id === bot.seat.id);
      if (!ship?.alive || ship.eliminated) continue;
      const brain = shadows.get(bot.seat.id)!;
      const ctx = context(perceive(w, bot.seat.id, DEFAULT_PERCEPTION), brain);
      tally.ctxSamples++;

      const rival = nearestLivingRival(ctx);
      if (rival) {
        tally.huntSamples++;
        if (allied(bot.seat.id, rival.owner)) tally.huntAlly++;
      }
      const leader = leaderStation(ctx);
      if (leader) {
        tally.leaderSamples++;
        if (allied(bot.seat.id, leader.owner)) tally.leaderAlly++;
      }
      const target = bestTarget(ctx);
      if (target) {
        tally.targetSamples++;
        if (allied(bot.seat.id, target.id)) tally.targetAlly++;
      }
      const intruder = homeIntruder(ctx);
      if (intruder) {
        tally.intruderSamples++;
        if (allied(bot.seat.id, intruder.id)) tally.intruderAlly++;
      }
    }
  };

  const result = runHeadlessMatch(world, bots, { maxSeconds: MAX_SECONDS, onTick });
  tally.matches++;
  tally.secondsTotal += result.seconds;
  if (result.ended) tally.ended++;
  if (result.timedOut) tally.timedOut++;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pct(num: number, den: number): string {
  if (den <= 0) return '     n/a';
  return `${((100 * num) / den).toFixed(1).padStart(7)}%`;
}

function main(): void {
  console.log('spikes/team-bots/measure-team-gaps.ts — s5-01');
  console.log(`seeds ${SEEDS.join(',')} · shadow sample every ${SAMPLE_TICKS} ticks · cap ${MAX_SECONDS}s\n`);

  const rows: { lineup: Lineup; tally: Tally }[] = [];
  for (const lineup of LINEUPS) {
    const tally = newTally();
    for (const seed of SEEDS) measure(lineup, seed, tally);
    rows.push({ lineup, tally });
    console.log(`  ${lineup.label} done (${tally.matches} matches)`);
  }

  const header = [
    'lineup'.padEnd(16),
    'len s'.padStart(8),
    'ended'.padStart(6),
    'hunt=ally'.padStart(10),
    'leader=ally'.padStart(12),
    'target=ally'.padStart(12),
    'intrudr=ally'.padStart(13),
    'ally same rock'.padStart(15),
    'foe same rock'.padStart(14),
    'siege blind'.padStart(12),
    'orphan s'.padStart(9),
  ].join(' ');
  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));

  for (const { lineup, tally } of rows) {
    console.log(
      [
        lineup.label.padEnd(16),
        (tally.secondsTotal / Math.max(1, tally.matches)).toFixed(0).padStart(8),
        `${tally.ended}/${tally.matches}`.padStart(6),
        pct(tally.huntAlly, tally.huntSamples).padStart(10),
        pct(tally.leaderAlly, tally.leaderSamples).padStart(12),
        pct(tally.targetAlly, tally.targetSamples).padStart(12),
        pct(tally.intruderAlly, tally.intruderSamples).padStart(13),
        pct(tally.allyPairsSameRock, tally.allyPairs).padStart(15),
        pct(tally.foePairsSameRock, tally.foePairs).padStart(14),
        pct(tally.allySiegeBlindSeconds, tally.allySiegeSeconds).padStart(12),
        (tally.orphanSeconds / Math.max(1, tally.matches)).toFixed(0).padStart(9),
      ].join(' '),
    );
  }

  console.log('\nRaw counts (for the doc\'s footnotes):');
  for (const { lineup, tally } of rows) {
    console.log(
      `  ${lineup.label.padEnd(16)} ctxSamples=${tally.ctxSamples} hunt=${tally.huntAlly}/${tally.huntSamples}` +
        ` leader=${tally.leaderAlly}/${tally.leaderSamples} target=${tally.targetAlly}/${tally.targetSamples}` +
        ` intruder=${tally.intruderAlly}/${tally.intruderSamples}` +
        ` allyPairs=${tally.allyPairsSameRock}/${tally.allyPairs}` +
        ` foePairs=${tally.foePairsSameRock}/${tally.foePairs}` +
        ` siege=${tally.allySiegeBlindSeconds.toFixed(0)}/${tally.allySiegeSeconds.toFixed(0)}s` +
        ` orphanTeam=${tally.orphanSeconds.toFixed(0)}s orphanBot=${tally.orphanBotSeconds.toFixed(0)}s`,
    );
  }

  console.log('\nStage 2 — how far the teammate was while an ally home burned (siege-seconds):');
  for (const { lineup, tally } of rows) {
    if (tally.allySiegeSeconds <= 0) continue;
    const cells = tally.siegeDistanceBuckets.map(
      (s, i) => `${SIEGE_BUCKET_LABELS[i]}=${pct(s, tally.allySiegeSeconds).trim()}`,
    );
    console.log(`  ${lineup.label.padEnd(16)} ${cells.join('  ')}`);
  }

  console.log('\nStage 3 — how much board two live ships share (pair-ticks):');
  for (const { lineup, tally } of rows) {
    const allyMean = tally.allyPairs > 0 ? (tally.allyPairDistance / tally.allyPairs).toFixed(0) : 'n/a';
    const foeMean = tally.foePairs > 0 ? (tally.foePairDistance / tally.foePairs).toFixed(0) : 'n/a';
    console.log(
      `  ${lineup.label.padEnd(16)} mean apart ally=${allyMean.padStart(5)} foe=${foeMean.padStart(5)}` +
        `   within one visual range: ally=${pct(tally.allyPairsOverlapping, tally.allyPairs).trim()}` +
        ` foe=${pct(tally.foePairsOverlapping, tally.foePairs).trim()}`,
    );
  }

  // The ship classes are fixed by the roster (GDD §2.11), so this is not a class
  // balance run — it is a "does a team match of real bots even resolve" run.
  void ShipClass;
}

main();

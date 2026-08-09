/**
 * evidence/b2-03-assault-window.ts — **how long a raid on an enemy home actually
 * lasts.** OWNER: Bot Engineer (b2-03; `docs/team-bots-plan.md` Stage 4).
 *
 * This is the instrument that picks {@link ASSAULT_JOIN_MAX} and
 * {@link ASSAULT_JOIN_COOLDOWN}, and it exists because those two numbers are the
 * ones that *do not transfer* from a0-10's defensive latch. `defend-ally` ends
 * on "arrived and there is nothing to fight"; an assault that arrives to plenty
 * to fight has **succeeded**, so the join latch leans almost entirely on its
 * ceiling and its cooldown. Inheriting 45/30 would be inheriting numbers that
 * were measured against a different question.
 *
 * **Part 1 — the ceiling, measured at HEAD before the branch exists.** Real
 * seeded TEAMS matches, no forcing, no scripted board. For every station on the
 * board the rig watches the one signal a joiner can legitimately perceive — the
 * `underAttack` tell, `alive && sinceDamage < alarmWindow` (`src/bots/perception`)
 * — and cuts it into **episodes**: a raid begins when the tell comes up and ends
 * when it has been down for `mergeGap` seconds. Each episode is scored by
 * whether the core died at the end of it. The ceiling wants to be long enough to
 * see a *winning* raid through and short enough that a doomed one is not a
 * permanent posting, so it is read off the kill-ending distribution.
 *
 * Reported at three merge gaps, because an episode boundary is a choice and a
 * reading that only holds at one gap is an artefact rather than a measurement.
 *
 * **Part 3 — the reach, and what the trip costs.** The same shape as the plan's
 * §1.5 spike, asked about the other distribution: §1.5 weighted every *ally
 * siege* second by how far the teammate was, and 1200 fell out of it. A raid is a
 * different distribution — enemy homes, not ally homes — so the rig weights every
 * second an enemy home was taking fire from this side by **how far the nearest
 * teammate who was not already there had to fly**, and reports the coverage
 * curve. It also records the cruise speed the cast actually travels at, because
 * the ceiling has to pay for the trip before it pays for the fight.
 *
 * **Part 2 — the cooldown, by trace replay.** The budget question is "what share
 * of a match can one ally's raiding consume?", and the honest way to price a
 * candidate is to measure the *readings* once and replay the pure latch against
 * them, rather than editing the constants table between runs (which measures the
 * afternoon as much as the constant). So the rig records, per decision of one
 * observer bot in a real match, the `(candidate, held, objectiveGone)` triple the
 * branch would have folded, then replays `allyResponseCommit` across a grid of
 * (max, cooldown) pairs and reports the committed share of each.
 *
 * The replay cannot capture feedback — a bot that joins changes what happens
 * next — so it prices the *budget*, not the outcome. The end-to-end guard on the
 * shipped pair is `src/bots/ally-assault.test.ts`, which runs real matches and
 * is in CI; this file picks the numbers, that file stops them drifting.
 *
 * **The abundance is named on purpose.** `createWorld` defaults to `standard`
 * for backward compatibility while the lobby ships `scarce` (`sim/constants.ts`
 * `DEFAULT_ABUNDANCE`), so a sweep that omits it measures a game nobody plays.
 * Same for `mapId`.
 *
 * Re-run:  npx vite-node evidence/b2-03-assault-window.ts
 * Writes:  evidence/b2-03-assault-window.json
 */

import { writeFileSync } from 'node:fs';
import type { PlayerId } from '../src/shared/types';
import { DEFAULT_ABUNDANCE, TICK_DT, createWorld, isOver, step } from '../src/sim';
import type { World } from '../src/sim';
import { DEFAULT_PERCEPTION, allyResponseCommit, botInputs, botLobby, createBots, fillEmptySlots, newAllyResponse } from '../src/bots';

/** The board every run is built on. Named, not defaulted — see the module note. */
const MAP_ID = 'octagon';
const ABUNDANCE = DEFAULT_ABUNDANCE;

/** Enough seeds that a percentile means something, few enough to re-run by hand. */
const SEEDS = [11, 23, 37, 41, 59, 67, 73, 89, 97, 101, 113, 127];

/** Both team shapes the plan measures against (§1.5): 2v2 and 4v4. */
const LINEUPS = [
  { name: '2v2', slots: 4, sides: [0, 0, 1, 1] },
  { name: '4v4', slots: 8, sides: [0, 0, 0, 0, 1, 1, 1, 1] },
] as const;

/** A match is guaranteed to end by ~12.5 minutes at baseline constants
 *  (GDD §2.3); this is the harness ceiling, not an expectation. */
const MAX_SECONDS = 800;

/** Episode boundaries, at three gaps. The middle one is the alarm window itself
 *  — the tell's own resolution — and the outer two are the sensitivity check. */
const MERGE_GAPS = [DEFAULT_PERCEPTION.alarmWindow, 3, 5];

// ---------------------------------------------------------------------------
// Part 1 — the raid-duration distribution
// ---------------------------------------------------------------------------

/** One window during which a home was visibly taking fire. */
interface Episode {
  readonly lineup: string;
  readonly seed: number;
  readonly owner: PlayerId;
  readonly startedAt: number;
  readonly seconds: number;
  /** Did the core actually go down at the end of this window? The difference
   *  between a raid the ceiling should see through and one it should cut off. */
  readonly killed: boolean;
}

/** Per-station state while the tell is being cut into episodes. */
interface Tracker {
  open: boolean;
  startedAt: number;
  lastLive: number;
  wasAlive: boolean;
}

/**
 * Run one match and return its episodes at one merge gap.
 *
 * The tell is read exactly as `perceiveStation` reads it, off the sim's own
 * `sinceDamage`, so what is being measured is the signal a bot receives and not
 * a privileged damage log.
 */
function episodesOf(lineup: (typeof LINEUPS)[number], seed: number, mergeGap: number): Episode[] {
  const seats = fillEmptySlots([], lineup.slots, undefined, [...lineup.sides]);
  const world: World = createWorld({
    seed,
    players: botLobby(seats),
    mapId: MAP_ID,
    abundance: ABUNDANCE,
  });
  const bots = createBots(seats, { seed });

  const trackers = new Map<PlayerId, Tracker>();
  for (const s of world.stations) {
    trackers.set(s.owner, { open: false, startedAt: -1, lastLive: -1, wasAlive: s.alive });
  }
  const out: Episode[] = [];

  const close = (owner: PlayerId, t: Tracker, killed: boolean): void => {
    out.push({
      lineup: lineup.name,
      seed,
      owner,
      startedAt: +t.startedAt.toFixed(2),
      seconds: +(t.lastLive - t.startedAt).toFixed(2),
      killed,
    });
    t.open = false;
  };

  while (world.time < MAX_SECONDS && !isOver(world)) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    const now = world.time;
    for (const station of world.stations) {
      const t = trackers.get(station.owner)!;
      const live = station.alive && station.sinceDamage < DEFAULT_PERCEPTION.alarmWindow;
      // A core that died closes its episode as a KILL — that is the assault's
      // happy ending, and the only one the join latch gets to call a success.
      if (t.wasAlive && !station.alive) {
        if (t.open) close(station.owner, t, true);
        t.wasAlive = false;
        continue;
      }
      if (!station.alive) continue;
      if (live) {
        if (!t.open) {
          t.open = true;
          t.startedAt = now;
        }
        t.lastLive = now;
      } else if (t.open && now - t.lastLive >= mergeGap) {
        close(station.owner, t, false);
      }
    }
  }
  // Whatever is still open at the ceiling ended without a kill, by definition.
  for (const [owner, t] of trackers) if (t.open) close(owner, t, false);
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function describe(seconds: readonly number[]): Record<string, number> {
  const s = [...seconds].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return {
    n: s.length,
    mean: +mean.toFixed(1),
    p50: +percentile(s, 50).toFixed(1),
    p75: +percentile(s, 75).toFixed(1),
    p90: +percentile(s, 90).toFixed(1),
    p95: +percentile(s, 95).toFixed(1),
    max: +(s[s.length - 1] ?? 0).toFixed(1),
  };
}

// ---------------------------------------------------------------------------
// Part 3 — how far a joiner would have to fly, and how fast it flies
// ---------------------------------------------------------------------------

/** How close counts as "already there", so the bot doing the raiding is not
 *  counted as its own reinforcement. The defender's guard ring, near enough. */
const ALREADY_THERE = 300;

interface Reach {
  /** One entry per (raided home × second): the nearest available teammate's
   *  distance to the fight. This is the distribution a reach must cover. */
  readonly distances: number[];
  /** Mean speed of ships that were actually travelling — what a trip costs. */
  cruiseSum: number;
  cruiseN: number;
}

/**
 * Weight every second of every raid by how far the nearest teammate who was not
 * already in it would have had to fly to join.
 *
 * Sampled once a second rather than once a tick, so a long raid does not
 * outvote sixty short ones by a factor of sixty — the same weighting §1.5 used.
 */
function reachOf(lineup: (typeof LINEUPS)[number], seed: number, acc: Reach): void {
  const seats = fillEmptySlots([], lineup.slots, undefined, [...lineup.sides]);
  const world = createWorld({ seed, players: botLobby(seats), mapId: MAP_ID, abundance: ABUNDANCE });
  const bots = createBots(seats, { seed });
  const teamOf = new Map<PlayerId, number>(seats.map((s) => [s.id, s.team!]));

  let nextSample = 1;
  while (world.time < MAX_SECONDS && !isOver(world)) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    for (const ship of world.ships) {
      const speed = Math.hypot(ship.vel.x, ship.vel.y);
      if (speed > 20) {
        acc.cruiseSum += speed;
        acc.cruiseN++;
      }
    }
    if (world.time < nextSample) continue;
    nextSample = Math.floor(world.time) + 1;

    for (const station of world.stations) {
      if (!station.alive || station.sinceDamage >= DEFAULT_PERCEPTION.alarmWindow) continue;
      const victimSide = teamOf.get(station.owner);
      // Whose raid is it? Every side that is not the victim's is a candidate
      // joiner pool; a bot already on the doorstep is the raider, not a joiner.
      for (const ship of world.ships) {
        if (!ship.alive) continue;
        const side = teamOf.get(ship.id);
        if (side === undefined || side === victimSide) continue;
        let nearest = Number.POSITIVE_INFINITY;
        let raiderPresent = false;
        for (const mate of world.ships) {
          if (!mate.alive || teamOf.get(mate.id) !== side) continue;
          const d = Math.hypot(mate.pos.x - station.pos.x, mate.pos.y - station.pos.y);
          if (d <= ALREADY_THERE) raiderPresent = true;
          else nearest = Math.min(nearest, d);
        }
        // Only a raid somebody on that side is actually prosecuting can be
        // joined — otherwise this counts homes taking incidental fire.
        if (raiderPresent && Number.isFinite(nearest)) acc.distances.push(nearest);
        break;
      }
    }
  }
}

/** What fraction of raid-seconds a reach of `r` units covers. */
function coverage(sorted: readonly number[], r: number): string {
  const under = sorted.filter((d) => d <= r).length;
  return `${((100 * under) / Math.max(1, sorted.length)).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Part 2 — the budget, by trace replay
// ---------------------------------------------------------------------------

/**
 * One decision's worth of the readings the join branch would have folded, taken
 * from a real match: is there a raid worth joining, is the one I joined still
 * running, and has its objective gone.
 */
interface Reading {
  readonly t: number;
  readonly candidate: PlayerId;
  readonly live: boolean;
  readonly gone: boolean;
}

/**
 * Watch one team's raiding for a whole match and record, once per tick, what an
 * observer on that side would have read.
 *
 * "A raid worth joining" is measured the same way Part 1 measures an episode:
 * an enemy home with its `underAttack` tell up. That is deliberately *more*
 * generous than the shipped branch, which additionally needs a `push` call to
 * have been heard and to have survived the range gate — so the share this
 * replay reports is an **upper bound** on the share the branch can consume,
 * which is the right side to err on for a budget.
 */
function trace(lineup: (typeof LINEUPS)[number], seed: number): Reading[] {
  const seats = fillEmptySlots([], lineup.slots, undefined, [...lineup.sides]);
  const world = createWorld({ seed, players: botLobby(seats), mapId: MAP_ID, abundance: ABUNDANCE });
  const bots = createBots(seats, { seed });
  const mySide = lineup.sides[0]!;
  const foes = seats.filter((s) => s.team !== mySide).map((s) => s.id);

  const out: Reading[] = [];
  let joined: PlayerId = -1;
  while (world.time < MAX_SECONDS && !isOver(world)) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    let candidate: PlayerId = -1;
    for (const id of foes) {
      const st = world.stations.find((s) => s.owner === id);
      if (!st) continue;
      if (st.alive && st.sinceDamage < DEFAULT_PERCEPTION.alarmWindow) {
        if (candidate < 0) candidate = id;
      }
    }
    const heldStation = joined >= 0 ? world.stations.find((s) => s.owner === joined) : undefined;
    out.push({
      t: +world.time.toFixed(2),
      candidate,
      live: heldStation
        ? heldStation.alive && heldStation.sinceDamage < DEFAULT_PERCEPTION.alarmWindow
        : false,
      gone: heldStation ? !heldStation.alive : false,
    });
    // The replay below decides what is actually held; this only has to name a
    // plausible subject for the `live`/`gone` columns, so it follows the first
    // candidate it sees until that home dies.
    if (joined < 0) joined = candidate;
    else if (heldStation && !heldStation.alive) joined = -1;
  }
  return out;
}

/** Replay the pure latch over a recorded trace and report the committed share. */
function replay(readings: readonly Reading[], quiet: number, max: number, cooldown: number): number {
  const latch = newAllyResponse();
  let committed = 0;
  for (const r of readings) {
    const target = allyResponseCommit(latch, r.t, r.candidate, r.live, r.gone, quiet, max, cooldown);
    if (target >= 0) committed++;
  }
  return readings.length === 0 ? 0 : committed / readings.length;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const header = {
  what: 'b2-03 — how long a raid on an enemy home lasts, and what a join budget costs',
  measuredAt: 'HEAD before the join branch exists — this is the game as it ships today',
  fixture: {
    mapId: MAP_ID,
    abundance: ABUNDANCE,
    note: 'abundance and mapId are named, never defaulted: createWorld falls back to `standard`/`octagon` while the lobby ships DEFAULT_ABUNDANCE',
    seeds: SEEDS,
    lineups: LINEUPS.map((l) => `${l.name} (${l.slots} slots)`),
    maxSeconds: MAX_SECONDS,
    alarmWindow: DEFAULT_PERCEPTION.alarmWindow,
  },
};

const byGap: Record<string, unknown> = {};
let episodesAtNominal: Episode[] = [];

for (const gap of MERGE_GAPS) {
  const all: Episode[] = [];
  for (const lineup of LINEUPS) {
    for (const seed of SEEDS) all.push(...episodesOf(lineup, seed, gap));
  }
  if (gap === DEFAULT_PERCEPTION.alarmWindow) episodesAtNominal = all;
  const kills = all.filter((e) => e.killed).map((e) => e.seconds);
  const survived = all.filter((e) => !e.killed).map((e) => e.seconds);
  byGap[`mergeGap_${gap}s`] = {
    allRaids: describe(all.map((e) => e.seconds)),
    raidsThatKilledTheCore: describe(kills),
    raidsThatPeteredOut: describe(survived),
    killRate: `${((100 * kills.length) / Math.max(1, all.length)).toFixed(1)}%`,
  };
  process.stdout.write(`gap ${gap}s: ${all.length} raids, ${kills.length} kills\n`);
}

const perLineup: Record<string, unknown> = {};
for (const lineup of LINEUPS) {
  const mine = episodesAtNominal.filter((e) => e.lineup === lineup.name);
  perLineup[lineup.name] = {
    allRaids: describe(mine.map((e) => e.seconds)),
    raidsThatKilledTheCore: describe(mine.filter((e) => e.killed).map((e) => e.seconds)),
  };
}

process.stdout.write('measuring the reach…\n');
const reach: Reach = { distances: [], cruiseSum: 0, cruiseN: 0 };
for (const lineup of LINEUPS) {
  for (const seed of SEEDS) reachOf(lineup, seed, reach);
}
const reachSorted = [...reach.distances].sort((a, b) => a - b);
const cruise = reach.cruiseN === 0 ? 0 : reach.cruiseSum / reach.cruiseN;
const REACH_GRID = [600, 900, 1200, 1500, 1800, 2400];
const reachTable: Record<string, string> = {};
for (const r of REACH_GRID) {
  reachTable[`${r}u`] =
    `${coverage(reachSorted, r)} of raid-seconds, ~${(r / Math.max(1, cruise)).toFixed(1)} s to fly`;
}

process.stdout.write('tracing for the budget replay…\n');
const readings: Reading[] = [];
for (const lineup of LINEUPS) {
  for (const seed of SEEDS.slice(0, 6)) readings.push(...trace(lineup, seed));
}

const QUIET = 4;
const MAX_GRID = [20, 25, 30, 35, 45];
const COOLDOWN_GRID = [15, 20, 25, 30, 45];
const budget: Record<string, string> = {};
for (const max of MAX_GRID) {
  for (const cd of COOLDOWN_GRID) {
    budget[`max_${max}_cooldown_${cd}`] =
      `${(100 * replay(readings, QUIET, max, cd)).toFixed(1)}% of ticks committed` +
      ` (analytic ceiling ${(100 * (max / (max + cd))).toFixed(0)}%)`;
  }
}

const out = {
  ...header,
  part1_howLongARaidLasts: { byMergeGap: byGap, byLineup_atNominalGap: perLineup },
  part3_howFarAJoinerFlies: {
    method:
      'every raid-second (an enemy home taking fire with a raider from that side already on its doorstep) weighted by the nearest teammate NOT already there — the §1.5 shape, asked about enemy homes instead of ally ones',
    raidSecondsSampled: reachSorted.length,
    cruiseSpeed: `${cruise.toFixed(0)} units/s measured over travelling ships (BASE_SPEED is 260 top, class- and drag-scaled)`,
    distance: describe(reachSorted),
    coverageByReach: reachTable,
  },
  part2_budgetByTraceReplay: {
    method:
      'per-tick readings recorded once from real matches, then the pure latch replayed at each (max, cooldown) pair — no constant edited between runs',
    quietSeconds: QUIET,
    readings: readings.length,
    caveat:
      'an upper bound: the trace offers a candidate whenever ANY enemy home is taking fire, with no push call and no range gate, so the shipped branch commits strictly less often',
    grid: budget,
  },
};

writeFileSync(new URL('./b2-03-assault-window.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(out.part1_howLongARaidLasts.byMergeGap, null, 2)}\n`);

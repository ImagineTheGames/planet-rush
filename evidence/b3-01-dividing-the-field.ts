/**
 * evidence/b3-01-dividing-the-field.ts — **the 434 figure, re-measured.**
 * OWNER: Bot Engineer (b3-01; `docs/team-bots-plan.md` Stage 3).
 *
 * The plan's §1.6 is the whole case for this stage, and it is a measurement
 * rather than an assertion:
 *
 * > in a 2v2 **two teammates spend 79% of the match inside one visual range of
 * > each other, at a mean separation of 434 units against the enemies' 1042.**
 * > They are not covering a board; they are flying formation by accident.
 *
 * So this rig re-runs that instrument, and adds the economic number that
 * justifies the change: **ore mined per side**. A discount that does not move the
 * separation has not divided anything; a discount that moves the separation and
 * costs the side its economy has divided the wrong thing.
 *
 * **It is the same file on both arms of the A/B, and that is deliberate.** It
 * imports no Stage 3 symbol on any measurement path — only `createWorld`, `step`
 * and the shipped bot harness — so the identical script runs at `origin/main`
 * (the branch-absent baseline) and at HEAD, over the identical seeds, and the two
 * JSON files are directly comparable. The constants block is read reflectively
 * and reads `null` on the arm where those constants do not exist yet, which is
 * how a run labels itself rather than being labelled by hand.
 *
 * **The controls, all four of them**, because a separation number on its own
 * proves nothing:
 *
 *  - the **enemy pair** in the same match (§1.6's own control — it must NOT move,
 *    since nothing here touches how a bot treats a foe);
 *  - **FFA at the same size** (it must not move at all — plan §2.5);
 *  - the **same seeds** on both arms;
 *  - **ore per side and match length**, so a separation win that was really an
 *    economy loss cannot hide.
 *
 * **The abundance and the map are named on purpose.** `createWorld` defaults to
 * `standard` for backward compatibility while the lobby ships `scarce`
 * (`sim/constants.ts` `DEFAULT_ABUNDANCE`), so a sweep that omits it measures a
 * game nobody plays. Same for `mapId`.
 *
 * Re-run:  npx vite-node evidence/b3-01-dividing-the-field.ts [label]
 * Writes:  evidence/b3-01-dividing-the-field[.label].json
 */

import { writeFileSync } from 'node:fs';
import type { PlayerId, Vec2 } from '../src/shared/types';
import { DEFAULT_ABUNDANCE, TICK_DT, createWorld, isOver, step } from '../src/sim';
import type { World } from '../src/sim';
import * as bots from '../src/bots';

const { DEFAULT_PERCEPTION, botInputs, botLobby, createBots, fillEmptySlots } = bots;

/** Whatever Stage 3 shipped, or `null` on the baseline arm. Read reflectively so
 *  this one file compiles and runs on both sides of the A/B. */
const dial = (name: string): unknown => (bots as unknown as Record<string, unknown>)[name] ?? null;

const LABEL = process.argv[2] ?? '';

/**
 * The board every run is built on. Named, not defaulted — see the module note.
 *
 * Overridable by env **only so §1.6's own conditions can be reproduced**: the
 * spike that produced the 434 figure called `createWorld({ seed, players })`
 * with neither argument (`spikes/team-bots/measure-team-gaps.ts`), so it measured
 * `standard` abundance on the default map, over seeds 1–8. Reproducing a figure
 * before reading a delta against it is what separates *"the game moved"* from
 * *"my instrument differs"*, and here it turned out to be the former.
 */
const MAP_ID = process.env.B3_MAP ?? 'octagon';
const ABUNDANCE = (process.env.B3_ABUNDANCE ?? DEFAULT_ABUNDANCE) as typeof DEFAULT_ABUNDANCE;

/** The plan's own count (§1.6 ran 8 per lineup); the same seeds on both arms. */
const SEEDS = (process.env.B3_SEEDS ?? '11,23,37,41,59,67,73,89').split(',').map(Number);

/** A match is guaranteed to end well inside this at baseline constants; it is
 *  the harness ceiling, not an expectation (`harness/balance.ts` 10–15 min). */
const MAX_SECONDS = 900;

/** §1.6 measured 2v2 and 4v4, each against the FFA of the same size. */
const LINEUPS = [
  { name: 'TEAMS 2v2', slots: 4, sides: [0, 0, 1, 1] as readonly number[] },
  { name: 'FFA 4', slots: 4, sides: null },
  { name: 'TEAMS 4v4', slots: 8, sides: [0, 0, 0, 0, 1, 1, 1, 1] as readonly number[] },
  { name: 'FFA 8', slots: 8, sides: null },
] as const;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** One lineup × one seed, rolled up. */
interface Run {
  readonly lineup: string;
  readonly seed: number;
  readonly seconds: number;
  readonly ended: boolean;
  /** Pair-tick sums, split ally vs foe — the §1.6 table's two columns. */
  readonly allyPairTicks: number;
  readonly allySepSum: number;
  readonly allyCloseTicks: number;
  readonly allySameRockTicks: number;
  readonly foePairTicks: number;
  readonly foeSepSum: number;
  readonly foeCloseTicks: number;
  readonly foeSameRockTicks: number;
  /** Ore actually cut out of rocks, per side. The economic number. */
  readonly minedPerSide: readonly number[];
}

/**
 * Run one match, sampling every tick.
 *
 * **Separation is measured over live pairs only** — a dead or eliminated ship is
 * not "covering" anything, and counting a wreck's last position would quietly
 * reward a side for losing a member. Same rule on both arms.
 *
 * **"Same rock" is `Brain.mineSite`**, the committed site, exactly as §1.6 read
 * it: two bots that happen to fly past one rock are not contending for it; two
 * bots that have both *chosen* it are.
 *
 * **Ore is accumulated from cargo growth**, not from the bank, because a bot that
 * mined a full hold and died on the way home still did an economy's work — and
 * banking-only would score that as having mined nothing.
 */
function runMatch(lineup: (typeof LINEUPS)[number], seed: number): Run {
  const sides = lineup.sides ? [...lineup.sides] : undefined;
  const seats = fillEmptySlots([], lineup.slots, undefined, sides);
  const world: World = createWorld({
    seed,
    players: botLobby(seats),
    mapId: MAP_ID,
    abundance: ABUNDANCE,
  });
  const brains = createBots(seats, { seed });
  const brainOf = new Map<PlayerId, (typeof brains)[number]>();
  for (const b of brains) brainOf.set(b.seat.id, b);

  /** Slot → side. In FFA every bot is its own side (teams-of-one). */
  const sideOf = new Map<PlayerId, number>();
  for (const s of world.stations) sideOf.set(s.owner, s.team);
  const sideCount = new Set(sideOf.values()).size;
  const mined = new Array<number>(sideCount).fill(0);
  const sideIndex = [...new Set([...sideOf.values()].sort((a, b) => a - b))];

  const held = new Map<PlayerId, number>();
  for (const s of world.ships) held.set(s.id, s.cargo);

  let allyPairTicks = 0;
  let allySepSum = 0;
  let allyCloseTicks = 0;
  let allySameRockTicks = 0;
  let foePairTicks = 0;
  let foeSepSum = 0;
  let foeCloseTicks = 0;
  let foeSameRockTicks = 0;

  const visual = DEFAULT_PERCEPTION.visualRange;

  while (world.time < MAX_SECONDS && !isOver(world)) {
    step(world, botInputs(world, brains, TICK_DT), TICK_DT);

    for (const ship of world.ships) {
      const was = held.get(ship.id) ?? 0;
      if (ship.cargo > was) {
        const side = sideIndex.indexOf(sideOf.get(ship.id) ?? 0);
        if (side >= 0) mined[side] = (mined[side] ?? 0) + (ship.cargo - was);
      }
      held.set(ship.id, ship.cargo);
    }

    for (let i = 0; i < world.ships.length; i++) {
      const a = world.ships[i]!;
      if (!a.alive || a.eliminated) continue;
      for (let j = i + 1; j < world.ships.length; j++) {
        const b = world.ships[j]!;
        if (!b.alive || b.eliminated) continue;
        const d = dist(a.pos, b.pos);
        const siteA = brainOf.get(a.id)?.brain.mineSite ?? -1;
        const siteB = brainOf.get(b.id)?.brain.mineSite ?? -1;
        const same = siteA >= 0 && siteA === siteB ? 1 : 0;
        if (sideOf.get(a.id) === sideOf.get(b.id)) {
          allyPairTicks++;
          allySepSum += d;
          if (d <= visual) allyCloseTicks++;
          allySameRockTicks += same;
        } else {
          foePairTicks++;
          foeSepSum += d;
          if (d <= visual) foeCloseTicks++;
          foeSameRockTicks += same;
        }
      }
    }
  }

  return {
    lineup: lineup.name,
    seed,
    seconds: +world.time.toFixed(1),
    ended: isOver(world),
    allyPairTicks,
    allySepSum,
    allyCloseTicks,
    allySameRockTicks,
    foePairTicks,
    foeSepSum,
    foeCloseTicks,
    foeSameRockTicks,
    minedPerSide: mined,
  };
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : +((100 * n) / d).toFixed(1);
}

function roll(runs: readonly Run[]): Record<string, unknown> {
  const allyPair = runs.reduce((a, r) => a + r.allyPairTicks, 0);
  const foePair = runs.reduce((a, r) => a + r.foePairTicks, 0);
  const allySep = runs.reduce((a, r) => a + r.allySepSum, 0);
  const foeSep = runs.reduce((a, r) => a + r.foeSepSum, 0);
  const oreTotals = runs.flatMap((r) => r.minedPerSide);
  const minutes = runs.reduce((a, r) => a + r.seconds, 0) / 60;
  return {
    matches: runs.length,
    ended: `${runs.filter((r) => r.ended).length}/${runs.length}`,
    meanSeconds: +(runs.reduce((a, r) => a + r.seconds, 0) / runs.length).toFixed(1),
    meanAllySeparation: allyPair === 0 ? null : +(allySep / allyPair).toFixed(1),
    meanFoeSeparation: foePair === 0 ? null : +(foeSep / foePair).toFixed(1),
    allyWithinOneVisualRange: allyPair === 0 ? null : `${pct(runs.reduce((a, r) => a + r.allyCloseTicks, 0), allyPair)}%`,
    foeWithinOneVisualRange: foePair === 0 ? null : `${pct(runs.reduce((a, r) => a + r.foeCloseTicks, 0), foePair)}%`,
    allyPairsSameRock: allyPair === 0 ? null : `${pct(runs.reduce((a, r) => a + r.allySameRockTicks, 0), allyPair)}%`,
    foePairsSameRock: foePair === 0 ? null : `${pct(runs.reduce((a, r) => a + r.foeSameRockTicks, 0), foePair)}%`,
    oreMinedPerSide: +(oreTotals.reduce((a, b) => a + b, 0) / oreTotals.length).toFixed(1),
    oreMinedPerSidePerMinute: +(oreTotals.reduce((a, b) => a + b, 0) / oreTotals.length / (minutes / runs.length)).toFixed(2),
  };
}

const byLineup: Record<string, unknown> = {};
const all: Run[] = [];
for (const lineup of LINEUPS) {
  const runs = SEEDS.map((seed) => runMatch(lineup, seed));
  all.push(...runs);
  byLineup[lineup.name] = roll(runs);
  console.log(lineup.name, JSON.stringify(byLineup[lineup.name]));
}

const out = {
  what: 'b3-01 — mean ally separation and ore per side, before and after Stage 3',
  plan: 'docs/team-bots-plan.md Stage 3 (§1.6 measured allies 434 units apart in a 2v2)',
  arm: LABEL || '(unlabelled)',
  fixture: {
    seeds: SEEDS,
    mapId: MAP_ID,
    abundance: ABUNDANCE,
    maxSeconds: MAX_SECONDS,
    cast: 'the shipped rotation (`fillEmptySlots` with no cast argument) — the real cast, not the QA probe strategies (plan §6)',
    note: 'the identical script runs on both arms; it imports no Stage 3 symbol on any measurement path',
  },
  dials: {
    // The reach is derived rather than declared — it is `visualRange`, because
    // an ally further off is not in the view at all (`./targeting`
    // `allyCrowdRadius`). Reported so an arm still names its own reach.
    allyCrowdReach: dial('ALLY_CROWD_PENALTY') === null ? null : `visualRange (${DEFAULT_PERCEPTION.visualRange})`,
    ALLY_CROWD_PENALTY: dial('ALLY_CROWD_PENALTY'),
    CLAIM_TABU_SECONDS: dial('CLAIM_TABU_SECONDS'),
  },
  byLineup,
  runs: all,
};

const suffix = LABEL ? `.${LABEL}` : '';
writeFileSync(new URL(`./b3-01-dividing-the-field${suffix}.json`, import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log('dials:', JSON.stringify(out.dials));

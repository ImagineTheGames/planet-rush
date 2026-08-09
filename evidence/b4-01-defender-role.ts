/**
 * evidence/b4-01-defender-role.ts — **how many teammates answer one alarm, and
 * what it costs the side that answers.** OWNER: Bot Engineer (b4-01;
 * `docs/team-bots-plan.md` Stage 4, the role split).
 *
 * The plan names the risk that this stage exists to close:
 *
 * > *"two bots abandoning two economies to answer one alarm."*
 *
 * So there are exactly two numbers worth measuring, and they pull against each
 * other:
 *
 *  1. **How many teammates are committed to the same alarm at the same tick.**
 *     Read off `Brain.allyResponse.target` — the *committed* latch, not
 *     `lastBehavior`, because a bot in flight to a teammate's home is spending
 *     its match on that rescue whether or not `defend-ally` happened to win the
 *     tick it was sampled on. This is the number the stage must move to 1.
 *  2. **Whether the alarm still gets answered at all.** A role split that drives
 *     the responder count to *zero* has not fixed anything, it has switched the
 *     feature off — and it would look identical in metric 1. So `answered` is
 *     reported beside `multi`, always, and neither is readable without the other.
 *
 * Plus the economic number the plan predicts: **a side's mining output no longer
 * collapsing when one of its homes is attacked.** Ore is split by whether that
 * side had a live klaxon on the tick it was cut, so the reading is the *ratio*
 * `besieged : quiet` — a side that mines at half its usual rate whenever a
 * teammate is attacked is the collapse, and it is a ratio rather than a total so
 * it cannot be flattered by a longer match.
 *
 * **It is the same file on both arms of the A/B, and that is deliberate.** It
 * imports no Stage 4 symbol on any measurement path — only `createWorld`, `step`
 * and the shipped bot harness, and every field it reads off a `Brain`
 * (`allyResponse.target`, `lastBehavior`) predates this branch. So the identical
 * script runs at `origin/main` (the branch-absent baseline) and at HEAD over the
 * identical seeds, and the two JSON files are directly comparable. The arm labels
 * itself by reflection rather than by hand.
 *
 * **The abundance and the map are named on purpose.** `createWorld` defaults to
 * `standard` while the lobby ships `scarce` (`sim/constants.ts`), so a sweep that
 * omits them measures a game nobody plays — b3-01's finding, and it is why §1.6's
 * published figures did not reproduce.
 *
 * **Why 4v4 is the headline and 2v2 is a control.** A side of two with one home
 * burning has exactly one eligible teammate, so the assignment is a formality and
 * 2v2 must not move at all. The contention the plan describes needs three or more
 * a side, which is where the brief's evidence is.
 *
 * Re-run:  npx vite-node evidence/b4-01-defender-role.ts [label]
 * Writes:  evidence/b4-01-defender-role[.label].json
 */

import { writeFileSync } from 'node:fs';
import type { PlayerId } from '../src/shared/types';
import { DEFAULT_ABUNDANCE, TICK_DT, createWorld, isOver, step } from '../src/sim';
import type { World } from '../src/sim';
import * as bots from '../src/bots';

const { DEFAULT_PERCEPTION, botInputs, botLobby, createBots, fillEmptySlots } = bots;

/** Whatever Stage 4 shipped, or `null` on the baseline arm. Read reflectively so
 *  this one file compiles and runs on both sides of the A/B. */
const dial = (name: string): unknown => (bots as unknown as Record<string, unknown>)[name] ?? null;

const LABEL = process.argv[2] ?? '';
const MAP_ID = process.env.B4_MAP ?? 'octagon';
const ABUNDANCE = (process.env.B4_ABUNDANCE ?? DEFAULT_ABUNDANCE) as typeof DEFAULT_ABUNDANCE;
/** Eight seeds, the same on both arms — the count every team-bots rig has used. */
const SEEDS = (process.env.B4_SEEDS ?? '11,23,37,41,59,67,73,89').split(',').map(Number);
const MAX_SECONDS = 900;

const LINEUPS = [
  { name: 'TEAMS 4v4', slots: 8, sides: [0, 0, 0, 0, 1, 1, 1, 1] as readonly number[] },
  { name: 'TEAMS 2v2', slots: 4, sides: [0, 0, 1, 1] as readonly number[] },
  { name: 'FFA 8', slots: 8, sides: null },
  { name: 'FFA 4', slots: 4, sides: null },
] as const;

/** One lineup × one seed, rolled up. */
interface Run {
  readonly lineup: string;
  readonly seed: number;
  readonly seconds: number;
  readonly ended: boolean;
  /** (tick × burning home) pairs — the denominator for everything in metric 1. */
  readonly alarmTicks: number;
  /** Teammates committed to that alarm, summed over those pairs. */
  readonly responderSum: number;
  /** …of which at least one, and at least two. */
  readonly answeredTicks: number;
  readonly multiTicks: number;
  /** The worst single moment in the whole match. */
  readonly maxResponders: number;
  /**
   * The same three, counted over teammates **actually running the branch** —
   * committed *and* `defend-ally` won their last decision.
   *
   * Both readings are reported because they bound the truth from either side and
   * neither is the whole of it. A latch can be held by a bot that is not going
   * anywhere: the selfish-first gates *hold* a commitment rather than ending it
   * (`./ally`), so a defender whose own door catches fire stays latched while it
   * stands at its own home. Counting that as a second responder over-reads —
   * nobody abandoned an economy — and counting only the branch under-reads,
   * because a bot between decisions is still flying the rescue. The brief asks
   * how many teammates **break off**, which is this one.
   */
  readonly activeSum: number;
  readonly activeAnsweredTicks: number;
  readonly activeMultiTicks: number;
  readonly maxActive: number;
  /** Ticks any bot spent committed to a rescue, over live-bot-ticks. */
  readonly committedTicks: number;
  readonly liveBotTicks: number;
  /** Ore cut per side, split by whether that side had a klaxon ringing. */
  readonly minedPerSide: readonly number[];
  readonly minedBesieged: readonly number[];
  readonly minedQuiet: readonly number[];
  readonly besiegedTicks: readonly number[];
  readonly quietTicks: readonly number[];
}

/**
 * Run one match, sampling every tick.
 *
 * **Ore is accumulated from cargo growth**, not from the bank: a bot that mined a
 * full hold and died on the way home still did an economy's work, and
 * banking-only would score that as having mined nothing. Same rule on both arms,
 * and the same rule b3-01 used, so the two rigs' ore columns are comparable.
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
  const sideIndex = [...new Set([...sideOf.values()])].sort((a, b) => a - b);
  const idx = (id: PlayerId): number => sideIndex.indexOf(sideOf.get(id) ?? -1);

  const n = sideIndex.length;
  const mined = new Array<number>(n).fill(0);
  const minedBesieged = new Array<number>(n).fill(0);
  const minedQuiet = new Array<number>(n).fill(0);
  const besiegedTicks = new Array<number>(n).fill(0);
  const quietTicks = new Array<number>(n).fill(0);

  const held = new Map<PlayerId, number>();
  for (const s of world.ships) held.set(s.id, s.cargo);

  let alarmTicks = 0;
  let responderSum = 0;
  let answeredTicks = 0;
  let multiTicks = 0;
  let maxResponders = 0;
  let activeSum = 0;
  let activeAnsweredTicks = 0;
  let activeMultiTicks = 0;
  let maxActive = 0;
  let committedTicks = 0;
  let liveBotTicks = 0;

  const alarmWindow = DEFAULT_PERCEPTION.alarmWindow;

  while (world.time < MAX_SECONDS && !isOver(world)) {
    step(world, botInputs(world, brains, TICK_DT), TICK_DT);

    // Which sides have a klaxon ringing this tick — the same expression the view
    // derives `underAttack` from, so this reads exactly what a bot reads.
    const burning = new Array<boolean>(n).fill(false);
    for (const s of world.stations) {
      if (!s.alive || s.sinceDamage >= alarmWindow) continue;
      const side = sideIndex.indexOf(s.team);
      if (side >= 0) burning[side] = true;

      // Metric 1: teammates committed to THIS home's alarm. Counted per burning
      // home, so two homes alight in one tick are two separate alarms rather
      // than one blurred average.
      let responders = 0;
      let active = 0;
      for (const b of brains) {
        if (b.seat.id === s.owner) continue;
        if (sideOf.get(b.seat.id) !== s.team) continue;
        if (b.brain.allyResponse.target !== s.owner) continue;
        responders++;
        if (b.brain.lastBehavior === 'defend-ally') active++;
      }
      alarmTicks++;
      responderSum += responders;
      if (responders >= 1) answeredTicks++;
      if (responders >= 2) multiTicks++;
      if (responders > maxResponders) maxResponders = responders;
      activeSum += active;
      if (active >= 1) activeAnsweredTicks++;
      if (active >= 2) activeMultiTicks++;
      if (active > maxActive) maxActive = active;
    }

    for (const ship of world.ships) {
      if (!ship.alive || ship.eliminated) continue;
      liveBotTicks++;
      const brain = brainOf.get(ship.id)?.brain;
      if (brain && brain.allyResponse.target >= 0) committedTicks++;
    }

    for (let i = 0; i < n; i++) {
      if (burning[i]) besiegedTicks[i] = (besiegedTicks[i] ?? 0) + 1;
      else quietTicks[i] = (quietTicks[i] ?? 0) + 1;
    }

    for (const ship of world.ships) {
      const was = held.get(ship.id) ?? 0;
      if (ship.cargo > was) {
        const side = idx(ship.id);
        if (side >= 0) {
          const cut = ship.cargo - was;
          mined[side] = (mined[side] ?? 0) + cut;
          if (burning[side]) minedBesieged[side] = (minedBesieged[side] ?? 0) + cut;
          else minedQuiet[side] = (minedQuiet[side] ?? 0) + cut;
        }
      }
      held.set(ship.id, ship.cargo);
    }
  }

  return {
    lineup: lineup.name,
    seed,
    seconds: +world.time.toFixed(1),
    ended: isOver(world),
    alarmTicks,
    responderSum,
    answeredTicks,
    multiTicks,
    maxResponders,
    activeSum,
    activeAnsweredTicks,
    activeMultiTicks,
    maxActive,
    committedTicks,
    liveBotTicks,
    minedPerSide: mined,
    minedBesieged,
    minedQuiet,
    besiegedTicks,
    quietTicks,
  };
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : +((100 * n) / d).toFixed(1));
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function roll(runs: readonly Run[]): Record<string, unknown> {
  const alarms = sum(runs.map((r) => r.alarmTicks));
  const oreTotals = runs.flatMap((r) => r.minedPerSide);
  const minutes = sum(runs.map((r) => r.seconds)) / 60;

  // The collapse number: ore per side-second while that side had a klaxon
  // ringing, against the same side-seconds with none. A ratio, so a longer or
  // shorter match cannot flatter it.
  const besiegedOre = sum(runs.flatMap((r) => r.minedBesieged));
  const quietOre = sum(runs.flatMap((r) => r.minedQuiet));
  const besiegedSecs = (sum(runs.flatMap((r) => r.besiegedTicks)) * TICK_DT) || 0;
  const quietSecs = (sum(runs.flatMap((r) => r.quietTicks)) * TICK_DT) || 0;
  const besiegedRate = besiegedSecs === 0 ? null : besiegedOre / besiegedSecs;
  const quietRate = quietSecs === 0 ? null : quietOre / quietSecs;

  return {
    matches: runs.length,
    ended: `${runs.filter((r) => r.ended).length}/${runs.length}`,
    meanSeconds: +(sum(runs.map((r) => r.seconds)) / runs.length).toFixed(1),

    // --- metric 1: how many answer one alarm -------------------------------
    alarmTicks: alarms,
    respondersPerAlarm: alarms === 0 ? null : +(sum(runs.map((r) => r.responderSum)) / alarms).toFixed(3),
    alarmsAnswered: `${pct(sum(runs.map((r) => r.answeredTicks)), alarms)}%`,
    alarmsWithTwoOrMore: `${pct(sum(runs.map((r) => r.multiTicks)), alarms)}%`,
    worstSimultaneous: Math.max(0, ...runs.map((r) => r.maxResponders)),
    respondersPerAnsweredAlarm:
      sum(runs.map((r) => r.answeredTicks)) === 0
        ? null
        : +(sum(runs.map((r) => r.responderSum)) / sum(runs.map((r) => r.answeredTicks))).toFixed(3),
    botTimeCommitted: `${pct(sum(runs.map((r) => r.committedTicks)), sum(runs.map((r) => r.liveBotTicks)))}%`,

    // …and the same three counted over teammates actually flying the branch —
    // the brief's "breaks off". See `Run.activeSum`.
    activePerAlarm: alarms === 0 ? null : +(sum(runs.map((r) => r.activeSum)) / alarms).toFixed(3),
    alarmsActivelyAnswered: `${pct(sum(runs.map((r) => r.activeAnsweredTicks)), alarms)}%`,
    alarmsWithTwoOrMoreFlying: `${pct(sum(runs.map((r) => r.activeMultiTicks)), alarms)}%`,
    worstSimultaneousFlying: Math.max(0, ...runs.map((r) => r.maxActive)),

    // --- metric 2: the economy ---------------------------------------------
    oreMinedPerSide: +(sum(oreTotals) / oreTotals.length).toFixed(1),
    oreMinedPerSidePerMinute: +(sum(oreTotals) / oreTotals.length / (minutes / runs.length)).toFixed(2),
    oreRateWhileBesieged: besiegedRate === null ? null : +besiegedRate.toFixed(4),
    oreRateWhileQuiet: quietRate === null ? null : +quietRate.toFixed(4),
    besiegedOverQuiet:
      besiegedRate === null || quietRate === null || quietRate === 0
        ? null
        : +(besiegedRate / quietRate).toFixed(3),
  };
}

const byLineup: Record<string, unknown> = {};
for (const lineup of LINEUPS) {
  const runs = SEEDS.map((seed) => runMatch(lineup, seed));
  byLineup[lineup.name] = roll(runs);
  const r = byLineup[lineup.name] as Record<string, unknown>;
  process.stdout.write(
    `${lineup.name.padEnd(10)} responders/alarm ${String(r['respondersPerAlarm']).padEnd(6)} ` +
      `answered ${String(r['alarmsAnswered']).padEnd(7)} 2+ ${String(r['alarmsWithTwoOrMore']).padEnd(7)} ` +
      `worst ${String(r['worstSimultaneous']).padEnd(3)} ` +
      `| flying/alarm ${String(r['activePerAlarm']).padEnd(6)} 2+ ${String(r['alarmsWithTwoOrMoreFlying']).padEnd(7)} ` +
      `worst ${String(r['worstSimultaneousFlying']).padEnd(3)} | ` +
      `ore/side ${String(r['oreMinedPerSide']).padEnd(7)} besieged:quiet ${String(r['besiegedOverQuiet'])}\n`,
  );
}

const out = {
  rig: 'evidence/b4-01-defender-role.ts',
  label: LABEL || null,
  arm: dial('defenderFor') ? 'b4-01 (role split present)' : 'baseline (role split absent)',
  mapId: MAP_ID,
  abundance: ABUNDANCE,
  seeds: SEEDS,
  maxSeconds: MAX_SECONDS,
  byLineup,
};

const path = `evidence/b4-01-defender-role${LABEL ? `.${LABEL}` : ''}.json`;
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`\nwrote ${path}\n`);

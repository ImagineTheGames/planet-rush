/**
 * evidence/a0-130-bolt-inside-the-band/autopsy.ts — what actually decides an
 * Easy-pool match. OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/.../autopsy.ts [seeds] [rotations] > autopsy.txt
 *
 * a0-126 §4.5 filed Bolt at 67.4% of the Easy pool and flagged, without being
 * able to explain it, that **81.4% of that pool draws**. A win rate over a
 * denominator that small is not a mechanism, it is a symptom, and this brief's
 * first instruction is to establish the mechanism before changing anything.
 *
 * So this file re-runs Easy-pool matches with the world open rather than with
 * the result sealed. `runBotMatch` reports `winner`; it does not report *how the
 * winner won*, and for this pool that turns out to be the whole question. What
 * is recorded, per seat, per match:
 *
 *  - **core HP the tick collapse opened** (`world.match.collapseTime`), which is
 *    the state the endgame starts from once repair and shield regen stop
 *    (GDD §2.3, `src/sim/match.ts`);
 *  - the sim time each core died, and therefore the **margin** between the last
 *    core standing and the second-last — the quantity a draw is a tie in
 *    (a0-113: same-tick wipe, no winner);
 *  - whether the core ever took damage at all before collapse.
 *
 * It reads `src/sim`'s public state (`World`, `MiningStation`) and writes
 * nothing to it — the loop below is `runBotMatch`'s loop with an observer bolted
 * on, exactly as `harness/soak`'s telemetry is, so it steps and ends identically.
 */

import { ShipClass } from '@shared/types';
import { TICK_DT, createWorld, isOver, step } from '../../src/sim';
import type { PlayerSpec, World } from '../../src/sim';
import { Difficulty, botInputs, createBot, rosterAt } from '../../src/bots';
import type { Bot } from '../../src/bots';
import { MATCH_TIMEOUT_S } from '../../harness/match';
import { strategyLineup } from '../../harness/soak';
import type { BotSlot } from '../../harness/soak';

/** One seat's endgame, as the collapse sees it. */
interface Seat {
  readonly id: number;
  readonly personality: string;
  /** Core HP fraction at the tick collapse opened — the endgame's starting line. */
  atCollapse: number;
  /** Lowest core fraction seen before collapse: 1 means nobody ever shot it. */
  minBeforeCollapse: number;
  /** Sim time this core died, or the match end if it outlived the match. */
  died: number;
  alive: boolean;
  /** HP this seat landed on enemy station property over the whole match
   *  (`world.credit.dealtToStations`) — shields, core, turrets. */
  dealtToStations: number;
  /** The character of the last seat to land damage on anything this seat owns
   *  (`world.credit.lastHitBy`), or null while nobody ever has. */
  lastHitBy: string | null;
  /** Characters that ever landed damage on anything this seat owns, from
   *  `world.credit.lastDamageAt[victim][attacker]` — the contact matrix. */
  chippedBy: string[];
  /** Turrets and shield generators standing when collapse opened — what this
   *  character actually bought with its match. */
  turretsAtCollapse: number;
  shieldsAtCollapse: number;
}

export interface Autopsy {
  readonly seed: number;
  readonly lineup: string;
  readonly winner: string | null;
  readonly seconds: number;
  readonly collapseTime: number;
  readonly seats: readonly Seat[];
  /** Core-HP fraction between the highest core at collapse and the second
   *  highest. `0` is the same-tick wipe a0-113 rules a draw — and it is the
   *  *only* thing a draw is, because collapse decays every core at one rate. */
  readonly margin: number;
}

export function autopsy(seed: number, slots: readonly BotSlot[]): Autopsy {
  const dt = TICK_DT;
  const players: PlayerSpec[] = slots.map((s) => ({ id: s.id, shipClass: s.shipClass }));
  const world: World = createWorld({ seed, players });
  const bots: Bot[] = slots.map((s) => createBot({ id: s.id, personality: s.personality }, { seed }));
  const seats: Seat[] = slots.map((s) => ({
    id: s.id,
    personality: s.personality,
    atCollapse: 1,
    minBeforeCollapse: 1,
    died: -1,
    alive: true,
    dealtToStations: 0,
    lastHitBy: null,
    chippedBy: [],
    turretsAtCollapse: 0,
    shieldsAtCollapse: 0,
  }));
  const stationOf = new Map<number, number>();
  world.stations.forEach((st, i) => {
    if (st.derelict !== true) stationOf.set(st.owner, i);
  });

  let collapsed = false;
  let ticks = 0;
  const maxTicks = Math.ceil((MATCH_TIMEOUT_S / dt) * 1.5) + 1;
  while (!isOver(world) && world.time < MATCH_TIMEOUT_S && ticks < maxTicks) {
    step(world, botInputs(world, bots, dt), dt);
    ticks++;
    const nowCollapsed = world.match.collapseTime >= 0;
    for (const seat of seats) {
      const idx = stationOf.get(seat.id);
      if (idx === undefined) continue;
      const st = world.stations[idx]!;
      const frac = st.maxCoreHp > 0 ? st.coreHp / st.maxCoreHp : 0;
      if (!nowCollapsed) seat.minBeforeCollapse = Math.min(seat.minBeforeCollapse, frac);
      if (nowCollapsed && !collapsed) {
        seat.atCollapse = frac;
        seat.turretsAtCollapse = st.turrets.filter((t) => t.hp > 0).length;
        seat.shieldsAtCollapse = st.shields.filter((sh) => sh.hp > 0).length;
      }
      if (seat.alive && !st.alive) {
        seat.alive = false;
        seat.died = st.deathTime;
      }
    }
    if (nowCollapsed) collapsed = true;
  }
  for (const seat of seats) if (seat.alive) seat.died = world.time;
  // Who chipped whom, off the sim's own ledger rather than inferred
  // (`src/sim/combat-credit.ts`): `dealtToStations` is HP actually landed on
  // enemy station property, and `lastHitBy` is the last seat to land any of it.
  const credit = world.credit;
  if (credit) {
    for (const seat of seats) {
      seat.dealtToStations = credit.dealtToStations[seat.id] ?? 0;
      const by = credit.lastHitBy[seat.id];
      seat.lastHitBy = by === null || by === undefined ? null : (slots.find((s) => s.id === by)?.personality ?? null);
      const when = credit.lastDamageAt[seat.id] ?? [];
      const who = new Set<string>();
      when.forEach((t, attacker) => {
        if (t >= 0) {
          const p = slots.find((s) => s.id === attacker)?.personality;
          if (p) who.add(p);
        }
      });
      seat.chippedBy = [...who];
    }
  }

  const tops = seats.map((s) => s.atCollapse).sort((a, b) => b - a);
  const winnerSlot = world.match.winner;
  return {
    seed,
    lineup: '',
    winner: winnerSlot === null ? null : (slots.find((s) => s.id === winnerSlot)?.personality ?? null),
    seconds: world.time,
    collapseTime: world.match.collapseTime,
    seats,
    margin: tops.length > 1 ? tops[0]! - tops[1]! : 0,
  };
}

// ---------------------------------------------------------------------------

function main(): void {
  const seedCount = Number(process.argv[2] ?? 64);
  const pool = rosterAt(Difficulty.Easy);
  const rows: Autopsy[] = [];
  for (let seed = 1; seed <= seedCount; seed++) {
    for (let rot = 0; rot < pool.length; rot++) {
      const a = autopsy(seed, strategyLineup(pool, ShipClass.Vanguard, rot));
      rows.push({ ...a, lineup: `easy:rot${rot}` });
    }
  }

  const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
  const decided = rows.filter((r) => r.winner !== null);
  const drawn = rows.filter((r) => r.winner === null);

  console.log(`=== Easy-pool autopsy: ${rows.length} matches (${seedCount} seeds x ${pool.length} rotations) ===`);
  console.log(`decided ${decided.length}  drawn ${drawn.length} (${pct(drawn.length / rows.length)})`);
  console.log('');

  console.log('--- 1. does anything reach a core before the collapse? ---');
  for (const who of pool) {
    const s = rows.flatMap((r) => r.seats.filter((x) => x.personality === who));
    const untouched = s.filter((x) => x.minBeforeCollapse > 0.9999).length;
    console.log(
      `  ${who.padEnd(6)}: ${s.length} seats, core never touched in ${untouched} (${pct(untouched / s.length)}), ` +
        `mean core at collapse ${pct(mean(s.map((x) => x.atCollapse)))}, ` +
        `mean floor before collapse ${pct(mean(s.map((x) => x.minBeforeCollapse)))}`,
    );
  }
  console.log('');

  console.log('--- 1b. who does the chipping? ---');
  for (const who of pool) {
    const s = rows.flatMap((r) => r.seats.filter((x) => x.personality === who));
    const dealt = s.reduce((a, x) => a + x.dealtToStations, 0);
    const hits: Record<string, number> = {};
    for (const x of s) hits[x.lastHitBy ?? 'nobody'] = (hits[x.lastHitBy ?? 'nobody'] ?? 0) + 1;
    console.log(
      `  ${who.padEnd(6)}: dealt ${(dealt / rows.length).toFixed(1)} HP/match to enemy stations; ` +
        `its own home was last hit by { ${Object.entries(hits).map(([k, v]) => `${k}: ${pct(v / s.length)}`).join(', ')} }`,
    );
  }
  console.log('');

  console.log('--- 1c. what did each character buy? (standing at collapse) ---');
  for (const who of pool) {
    const s = rows.flatMap((r) => r.seats.filter((x) => x.personality === who));
    console.log(
      `  ${who.padEnd(6)}: mean ${(mean(s.map((x) => x.turretsAtCollapse))).toFixed(2)} turrets, ` +
        `${(mean(s.map((x) => x.shieldsAtCollapse))).toFixed(2)} shields standing when the field closed`,
    );
  }
  console.log('');

  console.log('--- 2. the margin: how far apart are the top two cores at collapse? ---');
  const margins = (rs: readonly Autopsy[]): string => {
    const xs = rs.map((r) => r.margin).sort((a, b) => a - b);
    if (!xs.length) return 'n/a';
    return `median ${pct(xs[Math.floor(xs.length / 2)]!)} of a core  max ${pct(xs[xs.length - 1]!)}`;
  };
  console.log(`  decided: ${margins(decided)}`);
  console.log(`  drawn  : ${margins(drawn)}`);
  console.log('');

  console.log('--- 3. does the winner own the highest core at collapse? ---');
  let topWins = 0;
  let topShared = 0;
  for (const r of decided) {
    const best = Math.max(...r.seats.map((s) => s.atCollapse));
    const winners = r.seats.filter((s) => s.atCollapse > best - 1e-9);
    if (winners.every((s) => s.personality === r.winner)) topWins++;
    else if (winners.some((s) => s.personality === r.winner)) topShared++;
  }
  console.log(
    `  winner held the (uniquely) highest core at collapse in ${topWins}/${decided.length} (${pct(topWins / Math.max(decided.length, 1))}), ` +
      `shared the top in a further ${topShared}`,
  );
  console.log('');

  console.log('--- 4. the pool, one row per character ---');
  for (const who of pool) {
    const wins = decided.filter((r) => r.winner === who).length;
    console.log(`  ${who.padEnd(6)}: ${wins}/${decided.length} decided (${pct(wins / Math.max(decided.length, 1))})`);
  }
}

main();

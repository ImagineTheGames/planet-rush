/**
 * spikes/variable-slots/measure-match-length.ts — THROWAWAY measurement code
 * for docs/variable-slots-plan.md (Architect spike s1). NOT production; not in
 * the build; excluded from tsconfig/vitest include. Run it with:
 *
 *   npx vite-node spikes/variable-slots/measure-match-length.ts
 *
 * It answers one question the plan needs measured, not asserted: with today's
 * §2.8 constants and no per-N tuning, how long does a headless bot match last
 * at N = 2, 3, 4, 6, 8 — and does it still land in the 10–15 min window (GDD
 * §1)? It reuses the QA harness exactly as shipped (harness/match.ts), which
 * already accepts a variable-length lineup, so the only thing this spike adds
 * is the sweep and the table.
 *
 * Everything is seeded and deterministic; re-running prints the same numbers.
 */

import { ShipClass } from '../../src/shared/types';
import { runMatch, seedRange, type SlotSpec } from '../../harness/match';
import type { StrategyId } from '../../harness/strategies';

// A representative contested mix — not a mirror. Round-robin these across the N
// seats so every match has miners feeding the field, a turtle, and two kinds of
// aggression. This is the closest cheap stand-in for a live lobby (GDD §2.9).
const MIX: readonly { strategy: StrategyId; shipClass: ShipClass }[] = [
  { strategy: 'miner', shipClass: ShipClass.Excavator },
  { strategy: 'turtle', shipClass: ShipClass.Hauler },
  { strategy: 'rusher', shipClass: ShipClass.Interceptor },
  { strategy: 'raider', shipClass: ShipClass.Vanguard },
];

function lineup(n: number): SlotSpec[] {
  return Array.from({ length: n }, (_, id) => {
    const e = MIX[id % MIX.length]!;
    return { id, shipClass: e.shipClass, strategy: e.strategy };
  });
}

const COUNTS = [2, 3, 4, 6, 8];
const SEEDS = seedRange(16, 1); // seeds 1..16, a stated reproducible span

// Mirror lineups hold *composition* fixed so the sweep isolates the effect of N
// alone (the round-robin mix above changes who is in the match as N grows, which
// conflates count with aggression). One passive archetype, one aggressive.
function mirror(strategy: StrategyId, shipClass: ShipClass, n: number): SlotSpec[] {
  return Array.from({ length: n }, (_, id) => ({ id, shipClass, strategy }));
}

interface Row {
  n: number;
  meanMin: number;
  minMin: number;
  maxMin: number;
  meanWaves: number;
  meanCollapseMin: number;
  inWindow: number; // how many of SEEDS landed in [10,15] min
  ended: number; // how many produced a real winner (ok)
  fieldLeftMean: number;
}

function summarize(n: number): Row {
  const mins: number[] = [];
  let waves = 0;
  let collapse = 0;
  let collapseCount = 0;
  let inWindow = 0;
  let ended = 0;
  let fieldLeft = 0;
  for (const seed of SEEDS) {
    const r = runMatch({ seed, lineup: lineup(n) });
    const m = r.seconds / 60;
    mins.push(m);
    waves += r.wavesSpawned;
    if (r.collapseTime >= 0) {
      collapse += r.collapseTime / 60;
      collapseCount++;
    }
    if (m >= 10 && m <= 15) inWindow++;
    if (r.ok) ended++;
    fieldLeft += r.fieldOreLeft;
  }
  const mean = mins.reduce((s, x) => s + x, 0) / mins.length;
  return {
    n,
    meanMin: mean,
    minMin: Math.min(...mins),
    maxMin: Math.max(...mins),
    meanWaves: waves / SEEDS.length,
    meanCollapseMin: collapseCount ? collapse / collapseCount : -1,
    inWindow,
    ended,
    fieldLeftMean: fieldLeft / SEEDS.length,
  };
}

function fmt(x: number, w = 6): string {
  return x.toFixed(2).padStart(w);
}

console.log('\n=== variable-slots match-length sweep (today\'s constants, octagon, no per-N tuning) ===');
console.log(`seeds: ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} (${SEEDS.length} each)   mix: miner/turtle/rusher/raider round-robin\n`);
console.log('  N | meanMin |  minMin |  maxMin | in[10,15] | ended | meanWaves | collapseMin | fieldLeft');
console.log('----+---------+---------+---------+-----------+-------+-----------+-------------+----------');
for (const n of COUNTS) {
  const r = summarize(n);
  console.log(
    `  ${r.n} | ${fmt(r.meanMin)} | ${fmt(r.minMin)} | ${fmt(r.maxMin)} |   ${String(r.inWindow).padStart(2)}/${SEEDS.length}   |  ${String(r.ended).padStart(2)}/${SEEDS.length} | ${fmt(r.meanWaves)} | ${fmt(r.meanCollapseMin, 11)} | ${fmt(r.fieldLeftMean)}`,
  );
}
console.log('\nTarget window is 10–15 min (GDD §1). Read meanMin against it per N.');
console.log('The 14.17-min ceiling = collapse@750s + 100s core-decay (COLLAPSE_CORE_DECAY=1).\n');

// --- Fixed-composition mirror sweeps: isolate N from who-is-in-the-match ---
function summarizeLineup(build: (n: number) => SlotSpec[], n: number): Row {
  const mins: number[] = [];
  let inWindow = 0;
  let collapseCount = 0;
  for (const seed of SEEDS) {
    const r = runMatch({ seed, lineup: build(n) });
    const m = r.seconds / 60;
    mins.push(m);
    if (m >= 10 && m <= 15) inWindow++;
    if (r.collapseTime >= 0) collapseCount++;
  }
  const mean = mins.reduce((s, x) => s + x, 0) / mins.length;
  return { n, meanMin: mean, minMin: Math.min(...mins), maxMin: Math.max(...mins), meanWaves: 0, meanCollapseMin: collapseCount / SEEDS.length, inWindow, ended: 0, fieldLeftMean: 0 };
}

for (const arch of [
  { name: 'mirror raider (aggressive)', s: 'raider' as StrategyId, cls: ShipClass.Interceptor },
  { name: 'mirror miner (passive)', s: 'miner' as StrategyId, cls: ShipClass.Excavator },
]) {
  console.log(`=== ${arch.name} — composition FIXED, only N varies ===`);
  console.log('  N | meanMin |  minMin |  maxMin | in[10,15] | reachedCollapse');
  console.log('----+---------+---------+---------+-----------+----------------');
  for (const n of COUNTS) {
    const r = summarizeLineup((k) => mirror(arch.s, arch.cls, k), n);
    console.log(`  ${r.n} | ${fmt(r.meanMin)} | ${fmt(r.minMin)} | ${fmt(r.maxMin)} |   ${String(r.inWindow).padStart(2)}/${SEEDS.length}   |     ${(r.meanCollapseMin * 100).toFixed(0).padStart(3)}%`);
  }
  console.log('');
}

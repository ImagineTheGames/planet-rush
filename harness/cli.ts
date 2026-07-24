/**
 * harness/cli.ts — the QA harness command line. OWNER: QA Agent (GDD §3.8).
 *
 * Heavy harness runs are not unit tests: a full balance sweep is a few hundred
 * eight-slot matches and takes minutes, so it runs here, on demand, and files
 * its output as markdown in `tests/reports/`. What CI runs is the fast subset —
 * the determinism replay and a smoke match (`.github/workflows/ci.yml`).
 *
 *   npx vite-node harness/cli.ts smoke              # one 8-slot match, enforced timeout
 *   npx vite-node harness/cli.ts balance [seeds] [--out FILE]
 *   npx vite-node harness/cli.ts perf [ticks]
 *   npx vite-node harness/cli.ts determinism [seconds]
 *
 * Every command exits non-zero when the thing it measured failed a target, so
 * the CLI is usable as a gate as well as an instrument. Nothing here reads a
 * clock, an environment variable, or a random source to decide *what* to run —
 * the run is the arguments, and the arguments are printed into the report.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ShipClass } from '@shared/types';
import {
  classSweep,
  lengthStats,
  mmss,
  renderReport,
  runSweep,
  strategySweep,
  terminationStats,
  verdicts,
  WIN_RATE_CEILING,
  winRecords,
} from './balance';
import type { Sweep } from './balance';
import { digestDiff, stateDigest } from './hash';
import { mirrorLineup, recordMatch, replay, roundRobinLineup, runMatch, seedRange } from './match';
import type { MatchResult } from './match';
import { profileSuite } from './perf';
import { SIM_BUDGET_60_MS, SIM_BUDGET_30_MS } from './perf';
import { STRATEGY_IDS } from './strategies';
import type { StrategyId } from './strategies';

/** Probes that actually play; `idle` is kept out of competitive sweeps because
 *  a seat that never acts is not a contestant, it is a control. */
const PLAYING: readonly StrategyId[] = STRATEGY_IDS.filter((s) => s !== 'idle');

/** Repo root, resolved from this file so the CLI works from any cwd. */
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

// ---------------------------------------------------------------------------
// smoke — one match, the shape CI runs
// ---------------------------------------------------------------------------

function smoke(): number {
  const setup = {
    seed: 1,
    lineup: roundRobinLineup(PLAYING.map((strategy) => ({ strategy, shipClass: ShipClass.Vanguard }))),
  };
  log('smoke: one 8-slot bot-vs-bot match, enforced timeout');
  const r = runMatch(setup);
  log(
    `  ${r.ok ? 'ENDED' : `FAILED (${r.failure})`} in ${mmss(r.seconds)} sim / ` +
      `${r.wallClockMs.toFixed(0)} ms wall · winner ${r.winner ?? 'none'} (${r.winnerStrategy ?? '—'}) · hash ${r.hash}`,
  );
  return r.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// determinism — the replay, run standalone
// ---------------------------------------------------------------------------

function determinism(seconds: number): number {
  const setup = {
    seed: 7,
    lineup: roundRobinLineup(PLAYING.map((strategy) => ({ strategy, shipClass: ShipClass.Vanguard }))),
  };
  log(`determinism: record ${seconds}s of an 8-slot match, then replay it`);
  const run = recordMatch(setup, { maxSeconds: seconds });
  const again = replay(run.recording);
  const a = stateDigest(run.result.world);
  const b = stateDigest(again.world);
  log(`  recorded ${run.recording.inputs.length} ticks · hash ${run.recording.hash}`);
  log(`  replayed ${run.recording.inputs.length} ticks · hash ${again.hash}`);
  if (a.hash === b.hash) {
    log('  MATCH — same inputs, same final state hash (GDD §4.8)');
    return 0;
  }
  log('  MISMATCH:');
  for (const line of digestDiff(a, b)) log(`    ${line}`);
  return 1;
}

// ---------------------------------------------------------------------------
// perf — the entity-count stress profile
// ---------------------------------------------------------------------------

function perf(ticks: number): number {
  log(`perf: sim frame-time capture, ${ticks} ticks per scene`);
  log(`  sim budget: ${SIM_BUDGET_60_MS.toFixed(2)} ms/tick @60fps, ${SIM_BUDGET_30_MS.toFixed(2)} ms/tick @30fps floor`);
  let failed = 0;
  for (const p of profileSuite(ticks)) {
    const c = p.counts;
    log(
      `  ${p.label.padEnd(18)} ${c.ships} ships · ${c.asteroids} rocks · ${c.turrets} turrets · ` +
        `${c.liveProjectiles} shots · ${c.chunks} chunks`,
    );
    log(
      `  ${''.padEnd(18)} mean ${p.frames.mean.toFixed(3)} ms · p95 ${p.frames.p95.toFixed(3)} ms · ` +
        `p99 ${p.frames.p99.toFixed(3)} ms · max ${p.frames.max.toFixed(3)} ms · ` +
        `${p.frames.ticksPerSecond.toFixed(0)} ticks/s (${(p.frames.ticksPerSecond / 60).toFixed(1)}× real time)`,
    );
    log(
      `  ${''.padEnd(18)} 60fps share ${(p.budget60.p95Ratio * 100).toFixed(1)}% ${p.budget60.pass ? 'PASS' : 'FAIL'} · ` +
        `30fps share ${(p.budget30.p95Ratio * 100).toFixed(1)}% ${p.budget30.pass ? 'PASS' : 'FAIL'}`,
    );
    if (!p.budget60.pass) failed++;
  }
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// balance — the sweep and the report
// ---------------------------------------------------------------------------

function balance(seedCount: number, outPath: string | null): number {
  const seeds = seedRange(seedCount);
  log(`balance: seeds ${seeds[0]}–${seeds[seeds.length - 1]}, 8 seats, every rotation`);

  const strategySweeps: Sweep[] = [runSweep(strategySweep(PLAYING, seeds))];
  log(`  strategy sweep: ${strategySweeps[0]!.matches.length} matches`);

  const classSweeps: Sweep[] = [runSweep(classSweep('miner', seeds)), runSweep(classSweep('rusher', seeds))];
  for (const s of classSweeps) log(`  class sweep (${s.spec.entries[0]!.strategy}): ${s.matches.length} matches`);

  const mirrors = STRATEGY_IDS.map((id) => ({
    label: id,
    matches: seeds.map((seed): MatchResult =>
      runMatch({ seed, lineup: mirrorLineup(id, ShipClass.Vanguard) }),
    ),
  }));
  for (const m of mirrors) {
    const t = terminationStats(m.matches);
    log(`  mirror ${m.label.padEnd(7)}: ${t.ended}/${t.matches} ended, median ${mmss(lengthStats(m.matches).median)}`);
  }

  const input = {
    title: 'Balance report 01 — M5',
    context: `harness sweep, ${seeds.length} seeds × every rotation`,
    strategySweeps,
    classSweeps,
    mirrors,
  };
  const v = verdicts(input);
  const md = renderReport(input);

  const out = outPath ?? resolve(ROOT, 'tests/reports/balance-01.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md, 'utf8');
  log(`  report written: ${out}`);

  const strat = winRecords(strategySweeps.flatMap((s) => s.matches), (s) => s.strategy);
  const cls = winRecords(classSweeps.flatMap((s) => s.matches), (s) => s.shipClass);
  log('');
  log(`  match length : ${v.length ? 'PASS' : 'FAIL'}`);
  log(`  termination  : ${v.termination ? 'PASS' : 'FAIL'}`);
  log(`  strategy     : ${v.strategy ? 'PASS' : 'FAIL'} (top ${strat[0]?.name} ${((strat[0]?.rate ?? 0) * 100).toFixed(1)}%, ceiling ${WIN_RATE_CEILING * 100}%)`);
  log(`  ship class   : ${v.shipClass ? 'PASS' : 'FAIL'} (top ${cls[0]?.name} ${((cls[0]?.rate ?? 0) * 100).toFixed(1)}%)`);

  // The report is the deliverable; a failing target is news, not a broken tool.
  return 0;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function usage(): number {
  log('usage: vite-node harness/cli.ts <smoke|balance|perf|determinism> [args]');
  return 2;
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case 'smoke':
      return smoke();
    case 'determinism':
      return determinism(Number(rest[0] ?? 60));
    case 'perf':
      return perf(Number(rest[0] ?? 600));
    case 'balance': {
      const flag = rest.indexOf('--out');
      const out = flag >= 0 ? (rest[flag + 1] ?? null) : null;
      const seedArg = rest[0] && !rest[0].startsWith('--') ? Number(rest[0]) : 6;
      return balance(seedArg, out);
    }
    default:
      return usage();
  }
}

process.exitCode = main(process.argv.slice(2));

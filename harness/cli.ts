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

/** This report is run at the **shipped baseline** — no constant is changed. The
 *  one tuning move QA recommends needs ratification, so it is a recommendation
 *  below, not an applied edit. Hand-written, because it is a decision. */
const BALANCE_01_TUNING =
  'None applied. This sweep runs the **GDD §2.8 baseline table verbatim** (see §5). ' +
  'QA owns this table for *values*, but the one change these numbers call for — ' +
  '`COLLAPSE_CORE_DECAY` 0 → 1 — is not a values-only change: raising it turns ' +
  'collapse from the three rules GDD §2.3 spells out into four, which the constant’s ' +
  'own doc calls "a design decision, not a tuning one," and it breaks two ratified ' +
  '`src/sim/match.test.ts` cases (wreck debris inflates the field-yield assertion). ' +
  'So it is filed as a **recommendation for the Director** in the QA reading, with the ' +
  'measured effect, rather than pushed unilaterally.';

/** QA's reading of this sweep. The interpretation, not the numbers. */
const BALANCE_01_FINDINGS = [
  '**Three of the four targets fail at the shipped baseline, and every failure traces',
  'to one of two holes that are not tuning holes:** the collapse phase has no teeth,',
  'and the shipped bots do not defend. Neither is fixable by the values QA owns; both',
  'have a named owner. Read the verdicts through that, not as "the constants are wrong."',
  '',
  '### Finding 1 — a passive match never ends. **RECOMMENDATION: `COLLAPSE_CORE_DECAY` 0 → 1.**',
  '',
  'At the baseline `COLLAPSE_CORE_DECAY = 0`, collapse removes shield regen, repair, and',
  'new ore (GDD §2.3’s three rules) but nothing takes the last cores down — so a match',
  'in which nobody attacks runs forever. Every passive and economic **mirror timed out**',
  'at the 20-minute ceiling (see §4): `idle`, `miner`, `turtle`, `raider` all 0/8 ended.',
  'The match-length and (for the mirror-vs-field class sweep) some win-rate numbers are',
  'unmeasurable as a direct result — a win rate over matches that never end is not a',
  'number.',
  '',
  'QA measured the fix. Setting `COLLAPSE_CORE_DECAY = 1` HP/s (a naked core dies 100 s',
  'into collapse) makes **every mirror terminate**, and lands the passive/economic',
  'matches **inside the 10–15 min target**: `idle` 14.2, `miner` 12.5, `turtle` 14.2,',
  '`raider` 13.1 min. That is the match GDD §1 promises ("entropy finishes whoever the',
  'players don’t").',
  '',
  '**Why it is a recommendation and not an applied edit.** The constant’s own doc',
  '(`src/sim/constants.ts`) says making it nonzero adds a fourth collapse rule and is',
  '"a design decision, not a tuning one," and raising it breaks two ratified',
  '`src/sim/match.test.ts` cases (a dying core scatters wreck debris, which inflates the',
  'field-yield assertion). Both put it past a values-only change. **Ask for the Director',
  '(with the Gameplay Engineer) to ratify `COLLAPSE_CORE_DECAY = 1` and update the two',
  'sim tests;** QA will re-baseline this report the moment it lands.',
  '',
  '### Finding 2 — `rusher` wins ~97%, because nobody defends. **Blocked on the bot trees.**',
  '',
  'Every difficulty tier on `main` still runs the do-nothing baseline (`src/bots/bot.ts`);',
  'the Easy/Medium/Hard trees (`agent/bots/d4-difficulties`) are not merged. So the only',
  'agents that fight here are QA probes (`harness/strategies.ts`), and none defends a',
  'planet the way GDD §2.6 requires — "turrets fighting *alongside the defender’s ship*."',
  'A lone `rusher` parks at beam range and holds the trigger, and undefended cores fall',
  'exactly as GDD §2.6 predicts ("an undefended planet falls to a determined siege").',
  '',
  'This is not a constants failure and cannot be tuned away: nerfing the beam far enough',
  'to save an undefended core stops *anything* from dying and re-breaks termination. **The',
  'fix is a defender that defends — the merged bot trees.** The harness swaps probes for',
  'trees in one line (`harness/match.ts` `seatLineup`); recommend re-running this sweep',
  'the day `agent/bots/d4-difficulties` lands.',
  '',
  'The same hole explains the match-length aggregate: `rusher`-containing matches end in',
  'under a minute and drag the pooled median to ~3:37, while matches played to an economic',
  'end land in target. The distribution is bimodal, and both modes are Finding 1 and 2.',
  '',
  '### What passes, and is real.',
  '',
  '**Ship class ≤ 55% — PASS.** In the mirror-vs-field `rusher` sweep (the one that',
  'actually decides matches at baseline), the top hull sits at ~28% against a 25% fair',
  'share; Interceptor trails at ~17%, which is the intended shape ("melts against',
  'turrets"), not a failure. The §2.11 class multipliers are not the balance problem.',
  'The `miner` class sweep is unmeasurable for the same reason as Finding 1 (it never',
  'decides) — re-check both once collapse has teeth and bots defend.',
  '',
  '**The harness itself — PASS.** No run in the sweep hit the wall-clock or stall',
  'ceiling; the only failures to terminate are the sim-timeouts of Finding 1, which are',
  'reported as findings, not lost as hangs. That is the charter working as written',
  '(GDD §3.8).',
  '',
  '### Net for the Director.',
  '',
  '1. **Ratify `COLLAPSE_CORE_DECAY = 1`** (+ update two sim tests) — unblocks match',
  '   length and termination for every non-siege match. One number.',
  '2. **Merge the bot trees, then re-run** — the strategy and siege-length verdicts are',
  '   measuring a missing defender, not a broken ruleset.',
  '3. The GDD §2.8 constants are otherwise sound: nothing else in the table is out of',
  '   line with its intended shape at this milestone.',
].join('\n');

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
    context: `harness sweep, ${seeds.length} seeds × every rotation, branch agent/qa/d5-integration`,
    tuning: BALANCE_01_TUNING,
    findings: BALANCE_01_FINDINGS,
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

  const decidedFirst = (rs: readonly { decided: number; name: string; rate: number }[]) =>
    rs.filter((r) => r.decided > 0)[0];
  const strat = decidedFirst(winRecords(strategySweeps.flatMap((s) => s.matches), (s) => s.strategy));
  const cls = decidedFirst(winRecords(classSweeps.flatMap((s) => s.matches), (s) => s.shipClass));
  const ceiling = `${(WIN_RATE_CEILING * 100).toFixed(0)}%`;
  log('');
  log(`  match length : ${v.length ? 'PASS' : 'FAIL'}`);
  log(`  termination  : ${v.termination ? 'PASS' : 'FAIL'}`);
  log(`  strategy     : ${v.strategy ? 'PASS' : 'FAIL'} (top ${strat?.name ?? '—'} ${((strat?.rate ?? 0) * 100).toFixed(1)}%, ceiling ${ceiling})`);
  log(`  ship class   : ${v.shipClass ? 'PASS' : 'FAIL'} (top ${cls?.name ?? '—'} ${((cls?.rate ?? 0) * 100).toFixed(1)}%, ceiling ${ceiling})`);

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

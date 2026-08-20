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
 *   npx vite-node harness/cli.ts pay [--seeds n]     # the XP economy, re-baselined
 *
 * Every command exits non-zero when the thing it measured failed a target, so
 * the CLI is usable as a gate as well as an instrument. Nothing here reads a
 * clock, an environment variable, or a random source to decide *what* to run —
 * the run is the arguments, and the arguments are printed into the report.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import {
  a0107Section,
  castSection,
  classSection,
  mirrorSection,
  renderReport as renderMirrorsReport,
  rosterSection,
  sliceSection,
  tierSection,
} from './mirrors';
import { A0105_DEATH_SEEDS, A0107_SLICE_SEEDS } from './mirrors';
import type { MatchRow, PriorNumber, SectionRun } from './mirrors';
import type { Change, Lever, Pair } from './tuning';
import { renderTuningReport } from './tuning';
import { digestDiff, stateDigest } from './hash';
import { mirrorLineup, recordMatch, replay, roundRobinLineup, runMatch, seedRange } from './match';
import type { MatchResult } from './match';
import { profileSuite } from './perf';
import { SIM_BUDGET_60_MS, SIM_BUDGET_30_MS } from './perf';
import {
  contestsPass,
  maxIntervalHoldingAnchor,
  maxIntervalInsideRail,
  railVerdict,
  readCandidate,
  readContests,
  schedule,
  shippedSpread,
} from './abundance';
import type { Candidate, CandidateReading } from './abundance';
import { WAVE_COUNT, WAVE_INTERVAL_S } from '../src/sim';
import { STRATEGY_IDS } from './strategies';
import type { StrategyId } from './strategies';
import {
  CLASSES,
  HARD_POOL,
  LENGTH_TARGET_MAX_S,
  LENGTH_TARGET_MIN_S,
  WIN_RATE_CEILING as SOAK_CEILING,
  classLineup,
  lengthStats as botLengthStats,
  rosterCast,
  runBotMatch,
  strategyLineup,
  terminationStats as botTerminationStats,
  winRates,
} from './soak';
import type { BotMatchResult } from './soak';
import { Difficulty, PERSONALITIES } from '../src/bots';
import {
  CURVE_MILESTONES,
  FFA_MAP_IDS,
  LOBBIES,
  MIXED_ROSTER,
  XP_ROW_KEYS,
  baseForLevel2In,
  floorCandidate,
  matchesToLevel,
  medianPlayerMatch,
  payStats,
  rowCount,
  runPayMatch,
  seeds,
  summaryCost,
} from './pay';
import type { PayResult, PayStats, PaySetup, PlayerMatch } from './pay';
import { DEFAULT_ABUNDANCE } from '../src/sim';
import { XP_CURVE_BASE, XP_CURVE_EXP } from '../src/progression/curve';
import {
  DAMAGE_HP_PER_UNIT,
  TIER_MULTIPLIER,
  XP_PER_DAMAGE_UNIT,
  XP_PER_ORE_MINED,
  XP_PER_SHIP_KILL,
  XP_PER_STATION_KILL,
} from '../src/progression/xp';

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
  'station the way GDD §2.6 requires — "turrets fighting *alongside the defender’s ship*."',
  'A lone `rusher` parks at weapon range and holds the trigger, and undefended cores fall',
  'exactly as GDD §2.6 predicts ("an undefended station falls to a determined siege").',
  '',
  'This is not a constants failure and cannot be tuned away: nerfing the weapon far enough',
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
// soak — N shipped-bot matches: zero hangs, then the shipped-bot balance targets
// ---------------------------------------------------------------------------

/** The behaviour the class contest holds fixed while it varies the hull. It must
 *  be one that actually *decides* matches — a low-aggression field never kills a
 *  core at the shipped baseline (`COLLAPSE_CORE_DECAY = 0`), so a miner mirror
 *  times out with no winner and measures nothing. Sable is the Hard opportunist
 *  raider: eight of it produce constant combat, so the win falls to the hull, not
 *  the character. The trade-off — class balance is read under aggression — is
 *  named in the report. */
const CLASS_CONTEST_BEHAVIOUR = 'sable' as const;

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** One rotated contest → a printed table + the top contestant's rate. */
function contest(
  title: string,
  fairShare: number,
  results: readonly BotMatchResult[],
  contestants: readonly string[],
  keyOf: (r: BotMatchResult) => string | null,
): { top: string; rate: number; pass: boolean } {
  const term = botTerminationStats(results);
  const records = winRates(results, contestants, keyOf);
  log(`  ${title}: ${results.length} matches, ${term.ended} decided, ${term.simTimeout} sim-timeout, ${term.hangs} hangs`);
  for (const r of records) {
    const flag = r.rate > SOAK_CEILING ? ' ⚠' : '';
    log(`    ${r.name.padEnd(12)} ${r.wins}/${r.decided}  ${pct(r.rate).padStart(6)}  (${(r.rate / fairShare).toFixed(2)}× fair)${flag}`);
  }
  const top = records[0];
  return { top: top?.name ?? '—', rate: top?.rate ?? 0, pass: (top?.rate ?? 0) <= SOAK_CEILING };
}

/**
 * The release soak. Runs `matchCount` matches of the real offline cast for the
 * hang gate and the length distribution, then two rotated contests for the
 * class and strategy win-rate targets — all against the *shipped* trees, not the
 * probes. Exits non-zero only on a **hang** (GDD §3.8): a balance miss is news
 * the report carries, a hung harness is a broken instrument.
 */
function soak(matchCount: number, rotations: number): number {
  log(`soak: ${matchCount} shipped-bot matches (real cast), then class & strategy contests`);
  const seeds = seedRange(matchCount);

  // 1. Termination + length, on the exact match a solo player gets.
  const cast = rosterCast();
  const rosterResults = seeds.map((seed) => runBotMatch(seed, cast));
  const term = botTerminationStats(rosterResults);
  const len = botLengthStats(rosterResults);
  log('');
  log(`  roster soak: ${term.matches} matches · ${term.ended} ended · ${term.simTimeout} sim-timeout · ${term.hangs} hangs · max wall ${term.maxWallClockMs.toFixed(0)} ms`);
  log(
    `  match length: min ${mmss(len.min)} · p10 ${mmss(len.p10)} · median ${mmss(len.median)} · ` +
      `mean ${mmss(len.mean)} · p90 ${mmss(len.p90)} · max ${mmss(len.max)} · ` +
      `${pct(len.insideFraction)} inside ${mmss(LENGTH_TARGET_MIN_S)}–${mmss(LENGTH_TARGET_MAX_S)}`,
  );
  const charWins = winRates(rosterResults, cast.map((s) => PERSONALITIES[s.personality].name), (r) =>
    r.winnerPersonality ? PERSONALITIES[r.winnerPersonality].name : null,
  );
  log(`  character wins (fixed seats — a soak, not a fair contest): ${charWins.map((r) => `${r.name} ${r.wins}`).filter((_, i) => i < 3).join(', ')} …`);

  log('');
  // 2. Ship-class contest: one behaviour, four hulls rotated (GDD §2.11).
  const classResults: BotMatchResult[] = [];
  for (let rot = 0; rot < rotations; rot++) {
    for (const seed of seeds) classResults.push(runBotMatch(seed, classLineup(CLASS_CONTEST_BEHAVIOUR, rot)));
  }
  const cls = contest(
    `ship class (behaviour=${CLASS_CONTEST_BEHAVIOUR}, ${rotations} rotations)`,
    1 / CLASSES.length,
    classResults,
    CLASSES.map((c) => String(c)),
    (r) => (r.winnerClass !== null ? String(r.winnerClass) : null),
  );

  log('');
  // 3. Strategy contest: one hull, the three Hard characters rotated (GDD §3.8).
  const stratResults: BotMatchResult[] = [];
  for (let rot = 0; rot < rotations; rot++) {
    for (const seed of seeds) stratResults.push(runBotMatch(seed, strategyLineup(HARD_POOL, ShipClass.Vanguard, rot)));
  }
  const strat = contest(
    `strategy (hull=vanguard, Hard pool, ${rotations} rotations)`,
    1 / HARD_POOL.length,
    stratResults,
    HARD_POOL.map((p) => PERSONALITIES[p].name),
    (r) => (r.winnerPersonality ? PERSONALITIES[r.winnerPersonality].name : null),
  );

  const ceiling = `${(SOAK_CEILING * 100).toFixed(0)}%`;
  const lengthPass = len.insideFraction >= 0.5 && len.median >= LENGTH_TARGET_MIN_S && len.median <= LENGTH_TARGET_MAX_S;
  log('');
  log(`  hangs (soak gate) : ${term.hangs === 0 ? 'PASS' : 'FAIL'} (${term.hangs} roster hangs)`);
  log(`  match length      : ${lengthPass ? 'PASS' : 'FAIL'} (median ${mmss(len.median)}, ${pct(len.insideFraction)} inside target)`);
  log(`  strategy ≤ ${ceiling}      : ${strat.pass ? 'PASS' : 'FAIL'} (top ${strat.top} ${pct(strat.rate)})`);
  log(`  ship class ≤ ${ceiling}    : ${cls.pass ? 'PASS' : 'FAIL'} (top ${cls.top} ${pct(cls.rate)})`);

  // The soak's own exit code gates only the thing it must never allow: a hang.
  const hangs = term.hangs + botTerminationStats(classResults).hangs + botTerminationStats(stratResults).hangs;
  if (hangs > 0) {
    log('');
    log(`  SOAK FAILED: ${hangs} match(es) hung (wall-clock or stalled) — GDD §3.8`);
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// mirrors — the a0-112 re-measurement (win rate, length, fight time, deaths)
// ---------------------------------------------------------------------------

/** Where a section artifact lands. Committed: the report quotes it, and a reader
 *  who distrusts a table can recompute it from the JSON without a run. */
const A0112_DATA = 'tests/reports/a0-112-data';

const A0112_SECTIONS = ['mirror', 'roster', 'tier', 'class', 'slice', 'cast', 'a0107'] as const;
type A0112Section = (typeof A0112_SECTIONS)[number];

/**
 * Where section artifacts land, overridable with `--data DIR` (a0-117).
 *
 * a0-112's artifacts are committed evidence for a published report, and a tuning
 * pass runs the same sections twice — once before it moves a constant and once
 * after. Writing both into `a0-112-data/` would overwrite the very numbers the
 * after-run has to be compared against, so a run says where its artifacts go and
 * the default is unchanged: a bare `mirrors <section>` still files a0-112's.
 */
let dataDir: string = A0112_DATA;

function a0112Path(section: string): string {
  return resolve(ROOT, dataDir, `${section}.json`);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
}

function readSection(section: A0112Section): SectionRun {
  return JSON.parse(readFileSync(a0112Path(section), 'utf8')) as SectionRun;
}

/**
 * Run one section of the a0-112 sweep and file its artifact. Sections are
 * separate commands on purpose: they are independent, a full set is a few
 * hundred whole matches, and running them as five processes is the difference
 * between one core for half an hour and five cores for six minutes.
 */
function mirrors(section: A0112Section, seedCount: number): number {
  // The slice exists to be compared with a0-107's number, so it runs a0-107's
  // seeds rather than this report's range — same draw, same cast, same ceiling.
  const seeds =
    section === 'slice' ? A0107_SLICE_SEEDS : section === 'cast' ? A0105_DEATH_SEEDS : seedRange(seedCount);
  const started = performance.now();
  let last = started;
  const options = {
    seeds,
    onMatch: (row: MatchRow, i: number, total: number): void => {
      const now = performance.now();
      // Progress, not decoration: a section is minutes long and a silent process
      // is indistinguishable from a hung one.
      if (now - last > 15_000 || i === total) {
        log(`    ${i}/${total} · ${row.lineup} seed ${row.seed} · ${mmss(row.seconds)}${row.ok ? '' : ` · ${row.failure}`}`);
        last = now;
      }
    },
  };
  log(`mirrors: section ${section}, ${seeds.length} seeds (${seeds.join(', ')})`);
  const run =
    section === 'mirror'
      ? mirrorSection(options)
      : section === 'roster'
        ? rosterSection(options)
        : section === 'tier'
          ? tierSection(options)
          : section === 'class'
            ? classSection(options)
            : section === 'cast'
              ? castSection(options)
              : section === 'a0107'
                ? a0107Section(options)
                : sliceSection(options);

  const hangs = run.matches.filter((r) => r.failure === 'wall-clock' || r.failure === 'stalled').length;
  const timeouts = run.matches.filter((r) => r.failure === 'sim-timeout').length;
  const path = a0112Path(section);
  writeJson(path, run);
  log(
    `  ${run.matches.length} matches · ${run.matches.filter((r) => r.ok).length} decided · ` +
      `${timeouts} sim-timeout · ${hangs} hangs · ${((performance.now() - started) / 1000).toFixed(0)} s wall`,
  );
  log(`  wrote ${path}`);
  if (hangs > 0) {
    log(`  SECTION FAILED: ${hangs} match(es) hung — GDD §3.8`);
    return 1;
  }
  return 0;
}

/**
 * The hand-written half of the report. Everything else in
 * `tests/reports/a0-112-balance.md` is computed from the artifacts; these four
 * fields are QA's reading of it, and they live here so that regenerating the
 * report reproduces the whole file rather than half of it (the same division
 * `balance` uses for `BALANCE_01_TUNING`).
 */
const A0112_HEADLINE =
  '**The 10–15 minute window HOLDS — yes. The 55% band does NOT — no.** 1164 matches, ' +
  'median 13:43, 99.7% inside 10–15 minutes, every one decided, zero hangs. Three ' +
  'contestants sit over 55%: the `excavator` hull (77.3% of the ship-class contest, ' +
  '88.4% of the cast contest), Bolt (73.4% inside the Easy pool at a fixed hull) and ' +
  'Warden (73.2% across the cast). **None of it is new to the retreat rewrite** — ' +
  'a0-107’s own contests, replayed on a0-107’s own seeds, reproduce its published ' +
  'numbers digit for digit (§2.6).';

const A0112_READING = [
  '*Hand-written. Every number it quotes is in a table below.*',
  '',
  '### The check checks out — and that is the first finding',
  '',
  '`src/sim` and `src/bots` have not changed since the a0-107 merge (`git diff`',
  '`38a0107b..HEAD -- src/sim src/bots` is empty; everything since is UI and copy). So',
  'the honest first job was not "has it drifted" but "was it right", and an independently',
  'written instrument re-deriving the same numbers is the only way to answer that.',
  'It does, exactly:',
  '',
  '- the decision mix in a0-107’s own run shape — `turn-and-fight` **3.00%**, `retreat`',
  '  **11.49%**, `dead` **18.64%**, `attack` 17.52%, `mine` 15.51%, `defend` 14.90%,',
  '  `cornered-fight` 1.70% over 432 000 decisions (§4.1, last column) — is a0-107 §3’s',
  '  "after" column to the last digit;',
  '- its strategy contest replays as **Vulture 38/96, Warden 35/96, Sable 23/96** (§2.6)',
  '  — a0-107 §4’s exact counts, not just its percentages;',
  '- its class contest replays as **excavator 97/128 (75.8%)**, vanguard 21, hauler 6,',
  '  interceptor 4 — likewise exact, and the match lengths (mean 13:29 and 13:26, min',
  '  12:48 and 5:22, max 13:57 and 14:08) match its §4 line for line.',
  '',
  'Both retreat branches asserted the two bands still held. On the numbers they',
  'published, they were telling the truth. What they could not see is what a *different*',
  'lineup does, and that is the rest of this report.',
  '',
  '### Shorter, bloodier, or both? **Bloodier. Not shorter.**',
  '',
  'The brief asks the honest question about a0-105 turning a bot that held position into',
  'one that commits. The answer is in two numbers:',
  '',
  '- **Length did not move.** Median 13:43 over 1164 matches, 99.7% inside the target,',
  '  and every section’s median lands between 13:33 and 13:56 (§3). On a0-105’s own',
  '  twelve cast seeds the mean is **13:52** against the 13:32 that report quotes — +20 s,',
  '  under 3%, and in the *longer* direction.',
  '- **Deaths rose again.** On those same twelve seeds the board now takes **2460**',
  '  deaths against a0-105’s published **2184** (+12.6%) and the **1754** it measured',
  '  before its own change (+40%). a0-107 is the only sim or bot change between those two',
  '  numbers, and its own `dead` share moving 16.10% → 18.64% predicts exactly this.',
  '',
  'That is the ruling working, not a regression: *"ship lives are cheap. enemies should',
  'not fear death"* (GDD §2.3, §2.7 — respawn is free). It is reported here as a fact',
  'either way, and the fact is that a match is now **25.6 deaths per bot**, one every',
  '32 seconds of a bot’s match (§5.3).',
  '',
  '### The turn is smaller over a whole match than the first three minutes suggested',
  '',
  '**This is the number nobody had.** Every prior measurement of `turn-and-fight` is a',
  '180-second slice; over whole matches the leaf takes **2.01%** of decisions on the',
  'shipped cast (1.47%–2.52% across sections, §4.1) against **3.00%** in the first three',
  'minutes. The turn is an early- and mid-match behaviour: late decisions go to',
  '`last-stand` (15.97% of the cast’s, against 2.94% in the slice) and to `dead`.',
  '',
  'Per tier the raw share spreads 24× — Easy 5.46% of mirror decisions, Hard 0.23% — and',
  '**that spread is not a difference in how the tiers turn.** It is a difference in how',
  'often they retreat at all: Hard retreats on 3.75% of its decisions where Easy retreats',
  'on 10.22%. Normalised against the retreat family, every tier ends **14–16%** of its',
  'retreat decisions in a turn (§4.2, last column). The personality spread a0-105 built',
  'is intact and the tiers are not diverging in the one behaviour it added.',
  '',
  '### Who wins is mostly which hull, and the hull was already out of band',
  '',
  'Warden takes **73.2%** of the cast contest (§2.1) — a number no prior report has, and',
  'far outside the band. Read it with §2.5 before reading it as a character result: cut',
  'the *same* 224 matches by silhouette and the **excavator wins 88.4%** of them, which is',
  'the two excavator characters (Warden 73.2% + Foreman 15.2%) taking almost every match',
  'between them. Hold the character fixed and rotate the hulls instead (§2.4) and the',
  'excavator alone reads **77.3%** of 256. The character table is largely a hull table.',
  '',
  '**The hull result is not this rewrite’s doing.** a0-105 measured it at 78.1% *before*',
  'its own change and 68.8% after; a0-107 measured 72.7% → 78.5% at 256 matches. It sits',
  'at 77.3% now, inside one standard error of a0-107’s reading. The §2.11 class',
  'multipliers are gameplay’s lane, and this is the fourth report in a row to say so.',
  '',
  '**One win-rate result is *not* explained by the hull.** In the Easy pool at a fixed',
  'vanguard — same tier, same silhouette, so only the tree and the personality differ —',
  '**Bolt beats Rusty 47–17, 73.4%** (§2.3). That is 4.2 standard errors above the 50%',
  'fair share of a two-character pool, so it is not the draw. Medium’s 59.4% (Patch over',
  'Foreman) is 1.5 SE and is not yet evidence of anything. The Hard pool — the only one',
  'any prior report measured — is the healthy one: 37.5 / 34.4 / 28.1, all under.',
  '',
  '**A caveat that belongs with the Easy number, not hidden under it:** a two-character',
  'pool has a 50% fair share, so the 55% ceiling is a five-point test there and a',
  'thirty-point one in the four-hull contest. Bolt would clear a ceiling stated as "no',
  'more than 1.5× fair share"; it does not clear the one the GDD actually states. Both',
  'facts are above; which one binds is the Director’s call.',
  '',
  '### Two observations for the lanes that own them',
  '',
  '- **The Easy tree never runs `attack`** — 0.00% of Rusty’s and Bolt’s decisions in',
  '  every section measured, where Medium runs it at 25.6–28.8% and Hard at 7.7–48.3%',
  '  (§4.1 is pooled; the per-character censuses are in `tests/reports/a0-112-data/`).',
  '  Bolt fights through `potshot` instead — 32–42% of its decisions, its most common',
  '  leaf everywhere — while Rusty mostly mines, roams and defends and turns to fight',
  '  more often than any other character. Stated as a census fact, not a defect: it may',
  '  be exactly what the Easy tree is meant to be.',
  '- **A Rusty mirror is the quietest board measured** (58.4 deaths per match, median',
  '  12:55) and a Foreman mirror the bloodiest (**314.3**, 39.3 per bot). A five-fold',
  '  spread in how lethal a lobby is, purely from which character fills it, is worth',
  '  knowing before anyone tunes a constant against a single cast.',
].join('\n');

const A0112_OUT_OF_BAND = [
  '*Hand-written.*',
  '',
  '**Three things are out of band, and this brief tunes none of them.**',
  '',
  '| what | where | owner | already known? |',
  '|---|---|---|---|',
  '| `excavator` 77.3% (class contest), 88.4% (cast contest) | §2.4, §2.5 | GDD §2.11 class multipliers — Gameplay | **Yes** — reported by a0-105 (78.1% *before* it), a0-107 and balance-01 |',
  '| Bolt 73.4% over Rusty at equal skill and equal hull | §2.3 | the Easy tree / personality dials — Bots | **No** — no prior report contests the Easy pool |',
  '| Warden 73.2% across the shipped cast | §2.1 | mostly the hull above; the residue is Bots | **No** — no prior report measures a per-character rate |',
  '',
  'QA owns the *values* in `src/sim/constants.ts` and a tuning pass is a legitimate',
  'thing for QA to do. It is not a legitimate thing to do **here**: a measurement that',
  'arrives already acted upon cannot be checked, and the lane that made a change',
  'checking its own change is the exact failure this brief exists to correct. Doing it',
  'in the same commit would repeat that mistake with QA’s name on it.',
  '',
  'So: no constant moved, no file under `src/` changed. Two of the three are outside the',
  'values QA owns in any case — a class multiplier is a design ratio and a behaviour tree',
  'is not a number — and the third needs the Director to say which reading of the 55%',
  'ceiling binds in a two-character pool before anyone touches a dial.',
  '',
  'The instrument is committed and re-runnable, so whoever acts on this can re-measure',
  'the same way: `npx vite-node harness/cli.ts mirrors <section>` then `mirrors report`.',
].join('\n');

const A0112_COMPARISON = [
  '*Hand-written.* **What moved, and by how much:**',
  '',
  '| number | prior | this run | move |',
  '|---|---|---|---|',
  '| `turn-and-fight`, a0-107’s run shape | 3.00% | **3.00%** | **exact reproduction** |',
  '| `retreat` / `dead`, same run | 11.49% / 18.64% | **11.49% / 18.64%** | **exact** |',
  '| Strategy contest, a0-107’s seeds | 39.6 / 36.5 / 24.0 | **39.6 / 36.5 / 24.0** | **exact**, counts included |',
  '| Class contest 128, a0-107’s seeds | excavator 75.8% | **75.8%** | **exact** |',
  '| Class contest 256, this report’s seeds | excavator 78.5% | **77.3%** | −1.2 pts (0.4 SE — a different draw, not a move) |',
  '| Match length, contests | mean 13:29 / 13:26 | **13:29 / 13:26** replayed; 13:49 on this report’s draws | unmoved |',
  '| Match length, twelve cast seeds | mean 13:32 (a0-105) | **13:52** | +20 s (+2.5%), *longer* |',
  '| Deaths, twelve cast seeds | 2184 (a0-105), 1754 before it | **2460** | **+12.6%** since a0-105, +40% since before it |',
  '| `turn-and-fight` over a **whole** match | *not measured* | **2.01%** (cast) | new |',
  '| Win rate per character / per tier | *not measured* | §2.1, §2.2 | new |',
  '| Deaths per tier, length per character | *not measured* | §5.2, §3.1 | new |',
  '',
  '**Read the reproductions first.** Six published numbers were re-derived by a',
  'separately written instrument and came back identical, which is what makes the two',
  'numbers that *did* move worth trusting. Both are deaths-shaped, both point the same',
  'way, and both are the ordered trade rather than a regression: closing the dead band',
  '(a0-107) cost another 12.6% in hulls on top of a0-105’s 25%, and matches got very',
  'slightly **longer** while doing it — a bot that turns and dies is off the board for',
  '`RESPAWN_S` instead of parked in a corner holding a stalemate open.',
  '',
  '**Two caveats, stated rather than buried.** a0-105 does not publish how it counted a',
  'death, so 2184 → 2460 is a comparison of magnitudes on the same seeds and lineup, not',
  'of two identical procedures; and its "mean 812 s" sits in a paragraph that could be',
  'read as the twelve-seed sweep or as the contest beside it, so treat the +20 s as',
  'directional. Neither caveat touches the reproductions, which are exact.',
  '',
  '**And the one that has no prior at all:** no report before this one gives a win rate',
  'per character or per tier, a whole-match fight share, or deaths per tier. Those',
  'sections are not a comparison; they are a baseline, and the next brief to change how',
  'bots fight now has one to be checked against by somebody other than itself.',
].join('\n');

/**
 * The prior runs this one is compared against, **transcribed from the reports
 * that produced them**. Nothing here re-runs an old build: a comparison against
 * a prior run is a comparison against what that run published, and it says so on
 * every row. The rows marked *not measured* are the point of the brief.
 */
const A0112_PRIOR: PriorNumber[] = [
  {
    what: 'Match length — strategy contest, 96 matches',
    value: 'mean **809 s** (13:29), min 768, max 837, 0 unfinished',
    source: '`a0-107-dead-band.md` §4, "after"',
  },
  {
    what: 'Match length — class contest, 128 matches',
    value: 'mean **806 s** (13:26), min 322, max 848, 0 unfinished',
    source: '`a0-107-dead-band.md` §4, "after"',
  },
  {
    what: 'Match length — the shipped cast',
    value: 'mean **812 s** (13:32), "unmoved" against 813 s before',
    source: '`a0-105-standoff.md` §4',
  },
  {
    what: 'Strategy contest — Hard pool on vanguard, 96 matches',
    value: 'vulture **39.6%**, warden 36.5%, sable 24.0% — inside the band',
    source: '`a0-107-dead-band.md` §4, "after"',
  },
  {
    what: 'Class contest — sable, 256 matches',
    value: 'excavator **78.5% OVER**, vanguard 13.7%, hauler 5.5%, interceptor 2.3%',
    source: '`a0-107-dead-band.md` §4, "after"',
  },
  {
    what: '`turn-and-fight` share — 5 × 180 s of the shipped cast',
    value: '**3.00%** (0.82% before a0-107; 0.57% at a0-105)',
    source: '`a0-107-dead-band.md` §3, "after"',
  },
  {
    what: '`retreat` / `dead` share — same run',
    value: '**11.49%** / **18.64%** (23.15% / 16.10% before a0-107)',
    source: '`a0-107-dead-band.md` §3, "after"',
  },
  {
    what: 'Deaths — 12 whole matches of the shipped cast, seeds 1–12',
    value: '**2184** (1754 before a0-105) — 182 per match, 22.8 per bot',
    source: '`a0-105-standoff.md` §4 (counting method not published)',
  },
  {
    what: 'Win rate **per character** across the whole cast',
    value: '*not measured* — every prior contest holds a tier or a hull fixed',
    source: '—',
  },
  {
    what: 'Win rate **per tier**',
    value: '*not measured*',
    source: '—',
  },
  {
    what: '`turn-and-fight` share over a **whole match**',
    value: '*not measured* — both priors measure the first 180 s',
    source: '—',
  },
  {
    what: 'Deaths **per tier**, and match length **per character**',
    value: '*not measured*',
    source: '—',
  },
];

/** Render `tests/reports/a0-112-balance.md` from the five committed artifacts. */
function mirrorsReport(outPath: string | null): number {
  const missing = A0112_SECTIONS.filter((s) => !existsSync(a0112Path(s)));
  if (missing.length > 0) {
    log(`mirrors report: missing section artifact(s): ${missing.join(', ')}`);
    log(`  run: npx vite-node harness/cli.ts mirrors <section> [--seeds n]`);
    return 1;
  }
  const md = renderMirrorsReport({
    title: 'a0-112 — the balance after the retreat rewrite',
    context:
      'full bot mirrors and rotated contests on the shipped trees, branch ' +
      'agent/qa/a0-112-balance-after-the-retreat-rewrite',
    headline: A0112_HEADLINE,
    reading: A0112_READING,
    outOfBand: A0112_OUT_OF_BAND,
    comparison: A0112_COMPARISON,
    mirror: readSection('mirror'),
    roster: readSection('roster'),
    tier: readSection('tier'),
    klass: readSection('class'),
    slice: readSection('slice'),
    cast: readSection('cast'),
    a0107: readSection('a0107'),
    prior: A0112_PRIOR,
  });
  const path = resolve(ROOT, outPath ?? 'tests/reports/a0-112-balance.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, md, 'utf8');
  log(`mirrors report: wrote ${path} (${md.split('\n').length} lines)`);
  return 0;
}

// ---------------------------------------------------------------------------
// tuning — the a0-117 before/candidate report
// ---------------------------------------------------------------------------

/** Where a0-117 files its two artifact sets. Committed, same reasoning as
 *  a0-112's: a reader who distrusts a table can recompute it without a run. */
const A0117_BEFORE = 'tests/reports/a0-117-data/before';
const A0117_AFTER = 'tests/reports/a0-117-data/candidate-w3400';

/** The label the report gives the right-hand column of every table. It is a
 *  CANDIDATE, not an after: nothing under `src/` moved (see `A0117_CHANGED`). */
const A0117_CANDIDATE = '`WORLD_SIZE` 3400 (candidate — NOT shipped)';

function a0117Pair(dir: string, other: string, section: A0112Section): Pair {
  const read = (d: string): SectionRun =>
    JSON.parse(readFileSync(resolve(ROOT, d, `${section}.json`), 'utf8')) as SectionRun;
  return { before: read(dir), after: read(other) };
}

/** The brief asks for "every constant you changed, its before and after value,
 *  and the reason". The answer is none, and the reason is one sentence per row. */
const A0117_CHANGED: readonly Change[] = [
  {
    name: '(none)',
    before: '—',
    after: '—',
    why:
      'No value in `src/sim/constants.ts` moved. Every value that moves the `excavator` ' +
      'fails a test in a file this lane does not own — §4 prices each one and names what ' +
      'stops it, and §5 says what it would take.',
  },
];

const A0117_VERDICT =
  '**NONE of the three is inside the band, because this pass shipped no tuning at all: the ' +
  '`excavator` is still 77.3% of the ship-class contest and 88.3% of the cast contest, Warden ' +
  '73.1%, Bolt 83.3% of a pool that now mostly draws.** Not for want of a dial — `WORLD_SIZE` ' +
  '2400 → 3400 puts the hull at **51.8%** and drags Warden to **30.5%** with it, measured on ' +
  'a0-112’s own seeds — but **every constant that moves the hull fails a test in a file this ' +
  'lane may not edit**, and the bluntest of them, `src/bots/ffa-parity.test.ts`, fails on ' +
  '`WORLD_SIZE` 2400 → **2401**. §4 prices every lever, §5 says what it would take.';

const A0117_HEADLINE =
  '**The lever exists, was found, and was measured: `WORLD_SIZE` 2400 → 3400 takes the ' +
  '`excavator` from 77.3% to 51.8% on the same seeds, with the median match unmoved at 13:41 ' +
  'and 100% of matches still inside 10–15 minutes.** It is not shipped, because a state-hash ' +
  'golden owned by another lane fails on a one-unit change to the same constant, and because ' +
  'past ~3150 a ship parked on its own berth can no longer see its own ore field. Both are ' +
  'measured below. The right-hand column of every table is therefore a **candidate**, run on ' +
  'a0-112’s own seeds so the size of the prize is on the record for whoever gets to take it.';

const A0117_LEVERS: readonly Lever[] = [
  { constant: 'WORLD_SIZE', from: '2400', to: '3400', excavator: '**51.8%**', matches: 253,
    blockedBy: '`src/bots/ffa-parity.test.ts` (3 goldens) **and** `src/sim/radar-fog.test.ts` — see §5' },
  { constant: 'WORLD_SIZE', from: '2400', to: '3200', excavator: '56.6%', matches: 256,
    blockedBy: 'same two — still over 55% in any case' },
  { constant: 'WORLD_SIZE', from: '2400', to: '3100', excavator: '63.0%', matches: 254,
    blockedBy: '`src/bots/ffa-parity.test.ts`, `src/bots/defender-role.test.ts`, `src/bots/team-winning.test.ts`' },
  { constant: 'WORLD_SIZE', from: '2400', to: '3000', excavator: '71.9%', matches: 64, blockedBy: '`src/bots/ffa-parity.test.ts`' },
  { constant: 'WORLD_SIZE', from: '2400', to: '2401', excavator: 'not measured', matches: 0,
    blockedBy: '**`src/bots/ffa-parity.test.ts` — 3 of 3 goldens fail on ONE world unit**' },
  { constant: 'BASE_TURN_RATE', from: '6.5', to: '2.6', excavator: '65.6%', matches: 64,
    blockedBy: '`src/sim/step.test.ts` — the slowest hull gets 40 ticks to cover π, so the floor is **5.89**' },
  { constant: 'BASE_TURN_RATE', from: '6.5', to: '5.9', excavator: '75.0%', matches: 64,
    blockedBy: '`src/bots/ffa-parity.test.ts` (the whole legal move is worth 4.7 pts)' },
  { constant: 'SHIP_WEAPON.projectileSpeed', from: '520', to: '380', excavator: '67.2%', matches: 64,
    blockedBy: '`src/net/snapshot.test.ts` — `× max(SHOT_SPEED_STEPS)` must be **exactly 676**' },
  { constant: 'WEAPON_RANGE', from: '260', to: '400', excavator: '65.6%', matches: 64,
    blockedBy: '`src/bots/commitment.test.ts`, `src/bots/field-division.test.ts`, `src/sim/blockade.test.ts`' },
  { constant: 'RESOURCE_FIELD.commonsShare', from: '0.6', to: '0.45', excavator: '68.8%', matches: 64,
    blockedBy: '`commonsMinShare` = 0.5 is the stated floor; and `src/bots/team-winning.test.ts`' },
  { constant: 'RESOURCE_FIELD.commonsShare', from: '0.6', to: '0.5', excavator: '62.7%', matches: 255,
    blockedBy: '`src/bots/ffa-parity.test.ts` (and worth ~0 on its own — see §4’s note)' },
  { constant: 'MINING_RATE', from: '0.5', to: '0.35', excavator: '75.0%', matches: 64,
    blockedBy: '`content/codex/codex-systems.json` pins the value — another lane’s file (`tests/codex/codex-constants.test.ts`)' },
  { constant: 'REPAIR_HP_PER_ORE', from: '15', to: '8', excavator: '84.4% (**worse**)', matches: 64,
    blockedBy: 'codex-pinned — and it moves the wrong way' },
  { constant: 'UPGRADES[Power].steps', from: '[1, 1.25, 1.5, 1.8]', to: '[1, 1.12, 1.24, 1.36]', excavator: '79.7% (**no move**)', matches: 64,
    blockedBy: '`src/ui/upgrade-wheel.test.ts` pins the first step’s readout at `13` — and it buys nothing anyway' },
  { constant: 'UPGRADES[Power].costs', from: '[4, 8, 14]', to: '[8, 16, 28]', excavator: '81.3% (**worse**)', matches: 64,
    blockedBy: '`src/sim/upgrades.test.ts` — the first tier must cost ≤ a shield (5)' },
  { constant: 'SHIP_WEAPON.fireInterval', from: '0.35', to: '0.7', excavator: '76.6%', matches: 64,
    blockedBy: '`src/sim/projectiles.test.ts` — a 0.35-ore chip against `CHUNK.ore` = 1 **loses ore**; conservation is a CI invariant' },
  { constant: 'SHIP_RADIUS', from: '16', to: '10', excavator: '78.1%', matches: 64,
    blockedBy: 'style-guide §5.3 — silhouette at 24 px is load-bearing; and it buys 1.6 pts' },
  { constant: 'BASE_ACCEL', from: '900', to: '400', excavator: '74.6%', matches: 63,
    blockedBy: '11 tests across `src/sim`, `src/bots`, `src/net`' },
  { constant: 'DRAG', from: '3.0', to: '6.0', excavator: '81.3% (**worse**)', matches: 64, blockedBy: 'moves the wrong way' },
  { constant: 'COLLAPSE_GRACE_S', from: '150', to: '45', excavator: '75.0%', matches: 64,
    blockedBy: '**nothing** — the only lever measured that clears every pin. It buys 4.7 pts and costs two minutes of median match length.' },
  { constant: 'SHIP_STATS.excavator.*', from: 'the §2.11 row', to: 'anything', excavator: 'not measured', matches: 0,
    blockedBy: '`src/sim/upgrades.test.ts` transcribes GDD §2.11 by hand and compares — the class table is the DESIGN, not a QA dial' },
];

/**
 * The hand-written half — QA's reading of the tables. It lives here for the same
 * reason a0-112's does: regenerating the report must reproduce the whole file,
 * not the half of it a script can compute.
 */
const A0117_READING: readonly string[] = [
  '*Hand-written. Every number it quotes is in a table above or below.*',
  '',
  '### The baseline reproduces — with one correction to a0-112 that changes a headline number',
  '',
  'Re-running a0-112\u2019s seven sections on a0-112\u2019s own seeds, on today\u2019s tree, every one of',
  'the 1164 matches ends at the **identical sim second**: the simulation has not drifted.',
  'But **129 matches a0-112 credited to a winner are now DRAWS** \u2014 62 in the mirrors, 66 in',
  'the equal-skill contests, 1 in the cast \u2014 because **a0-113 retired the `lastToDie`',
  'tiebreak** after a0-112 was written. Read that before reading anything else here:',
  '',
  '- the **ship-class contest is untouched**: 0 matches changed, and the `excavator`\u2019s',
  '  198/256 = **77.3%** reproduces digit for digit;',
  '- the **cast contest** moved by one match: Warden **73.1%** against a0-112\u2019s 73.2%;',
  '- the **easy pool did not survive**. 52 of its 64 matches are now draws, so a0-112\u2019s',
  '  "Bolt 47/64 = 73.4%" is **not reproducible and must not be quoted as a before-number**.',
  '  Bolt is now 10 of the 12 that still decide \u2014 **83.3%**, on a denominator small enough',
  '  that \u00b11 SE is 10.8 points. It is over the band either way; how far over is no longer',
  '  a number anyone should lean on.',
  '',
  '### Why the `excavator` wins, measured rather than assumed (`harness/hull-diag.ts`)',
  '',
  'A win rate names a winner and nothing else, and the dial that closes an economy lead is',
  'not the dial that closes a combat lead \u2014 so the first job was to find out which this is.',
  'Six seeds \u00d7 four rotations of the ship-class lineup, reading the world after each tick',
  'and writing nothing back:',
  '',
  '| hull | win% | ore acquired | upgrade tiers | defences | core HP at collapse | deaths |',
  '|---|---|---|---|---|---|---|',
  '| interceptor | 12.5 | 32.0 | 1.4 | 0.3 | 16.2 | 18.4 |',
  '| vanguard | 4.2 | 38.7 | 1.9 | 0.4 | 16.3 | 16.6 |',
  '| **excavator** | **83.3** | **88.6** | **6.2** | **1.7** | **59.9** | 20.4 |',
  '| hauler | 0.0 | 23.5 | 1.2 | 0.2 | 11.0 | 11.3 |',
  '',
  '**A 1.3\u00d7 mining stat becomes a 2.3\u20133.8\u00d7 share of a finite field**, six upgrade tiers',
  'against everyone else\u2019s one and a half, and **3.7\u00d7 the core HP at the moment collapse',
  'opens** \u2014 and the last home standing is the winner. The excavator does not out-shoot the',
  'field. It out-*earns* it and then out-lasts it.',
  '',
  '### And yet the economy dials do nothing \u2014 the movement is all in the movement stats',
  '',
  'That reading predicts an economy fix, and the economy fix does not work. `MINING_RATE`',
  '\u221230% is worth 4.7 points; flattening the DAMAGE ladder is worth **zero**; raising its',
  'cost, and cutting what a repair buys, both make it **worse** (\u00a74). What moves the number',
  'is anything that makes a hull\u2019s speed and turn columns cost something \u2014 turn rate,',
  'shot speed, weapon range, arena size.',
  '',
  '**The mechanism is that bots aim manually.** `src/bots/steering.ts` emits `aim` +',
  '`fire{auto:false}`, so a bot\u2019s shot goes down its barrel and its turn rate decides',
  'whether it can hit at all. At `BASE_TURN_RATE` 6.5 a hull flips 180\u00b0 in 0.48 s, so the',
  'excavator\u2019s ratified 90%/80% speed-and-turn cost is **inert**, and GDD \u00a72.11\u2019s',
  '*"out-earns everyone but can\u2019t run"* is a sentence with no mechanism behind it. The ore',
  'lead is the *consequence* of winning at the rock face for free, not the cause.',
  '',
  '### `WORLD_SIZE` is the dial, and it is the one the design already implies',
  '',
  'Everything the arena *contains* is a fraction of `WORLD_SIZE` \u2014 the station ring, the home',
  'fields, the commons \u2014 so its shape is unchanged. What does **not** scale with it is',
  '`BASE_SPEED`, `WEAPON_RANGE` and the sensor radii. A bigger arena is therefore exactly',
  'where "can\u2019t run" starts to cost something, and the spread it produces is healthy rather',
  'than inverted: at 3400 the excavator is still the best hull at 51.8%, the hauler reads',
  '20.6%, the vanguard 17.4%, and the interceptor \u2014 "catches miners in the open" \u2014 goes',
  '2.7% \u2192 10.3%. **Nothing was over-corrected into a hull nobody picks.** The match-length',
  'target is untouched: median 13:41 against 13:33, 100% of matches inside 10\u201315 minutes,',
  'zero hangs, because the ending is anchored to the wave schedule and not to travel.',
  '',
  '### The brief\u2019s order was right: fix the hull and the cast contest follows it',
  '',
  'The brief said do the hull first and re-measure the characters afterwards, because the',
  'two character numbers are measured on a cast that can pick the excavator. Run on the',
  'candidate, on the same seeds, that is exactly what happens \u2014 and nothing about a',
  'character\u2019s tree was touched to make it happen:',
  '',
  '- **Warden falls from 73.1% to 30.5% and is INSIDE the band** (\u00a72.3). No character nerf',
  '  was applied, considered, or needed; the number was a hull number wearing a name.',
  '- **Foreman \u2014 the other excavator \u2014 becomes the top of the cast at 32.7%**, also inside.',
  '  The cast contest goes from one character taking three matches in four to a seven-way',
  '  spread of 32.7 / 30.5 / 10.0 / 9.1 / 6.8 / 6.4 / 4.5. Every tier lands inside too',
  '  (\u00a72.4): medium 42.7%, hard 41.8%, easy 15.5%, against 76.7% for hard before.',
  '- **The `excavator` silhouette still takes 63.2% of the cast contest** (\u00a72.2) against',
  '  51.8% of the ship-class contest, and that gap is the honest residue: the cast seats two',
  '  excavators out of eight, so the hull\u2019s share of a cast board is structurally higher',
  '  than its share of an equal-hull board. One dial does not close both.',
  '- **Bolt cannot be measured at all on the candidate.** All 64 easy-pool matches end in a',
  '  DRAW (they were 52 of 64 already on the shipped tree \u2014 a0-113). Two Easy bots on one',
  '  hull in a bigger arena simply never finish each other, and collapse takes the last two',
  '  cores in the same tick. That is not a balance reading and must not be reported as one:',
  '  **the Easy pool is a Bots question about two trees that cannot close a match**, and it',
  '  is the one of the three targets that a constant was never going to reach.',
  '',
  '### Why it is not shipped',
  '',
  '**`src/bots/ffa-parity.test.ts` hashes a 180-second eight-bot FFA match of the shipped',
  'cast to three literal `hashState` goldens**, and its header says in terms: *"Do not',
  're-baseline these. The only thing that has ever earned it is a ratified amendment in',
  '`docs/design-amendments.md`."* It is the Bot Engineer\u2019s file. Measured on the clean tree,',
  'one constant at a time:',
  '',
  '| one-line change | `ffa-parity` |',
  '|---|---|',
  '| `WORLD_SIZE` 2400 \u2192 **2401** \u2014 one world unit | **3 of 3 goldens FAIL** |',
  '| `BASE_TURN_RATE` 6.5 \u2192 6.4 | **3 of 3 goldens FAIL** |',
  '| `COLLAPSE_GRACE_S` 150 \u2192 45 | 5 passed \u2014 the golden match is 180 s long and collapse cannot open before wave 5 at 600 s |',
  '',
  '**So the tuning surface this lane can actually reach is: values the simulation does not',
  'read in the first three minutes of an FFA match.** In practice that is the collapse',
  'constants and nothing else. The one that clears every pin, `COLLAPSE_GRACE_S` 150 \u2192 45,',
  'buys 4.7 points and takes **two minutes off the median match** \u2014 trading one target for',
  'another to get a fifth of the way to a third. It is not taken, and \u00a74 records it so that',
  'the next pass does not have to re-derive it.',
  '',
  '**There is a second, independent ceiling, and it is a real invariant rather than a stale',
  'assertion.** The home field is placed as a fraction of the station ring, which is a',
  'fraction of `WORLD_SIZE`; `SHIP_SENSOR_RANGE` (520) and `STATION_SENSOR_RANGE` (300) are',
  'absolute. Past ~3150 a ship parked on its own berth senses **no ore at all** and its own',
  'field goes dark on the minimap \u2014 `src/sim/radar-fog.test.ts` passes at 3100 and fails at',
  '3200. Both radii are `content/codex/*.json` facts, so they cannot be scaled to match from',
  'inside this lane either.',
  '',
  '**The full suite, on the real tree, is the receipt.** The best four-lever candidate',
  '(`WORLD_SIZE` 3100 + `BASE_TURN_RATE` 5.9 + `SHIP_WEAPON.fireInterval` 0.7 +',
  '`commonsShare` 0.5), which lands the hull at 51.4% of 255, failed **17 tests across 13',
  'files** against 5949/5949 green on the clean tree. It is reverted. Nothing under `src/`',
  'changes on this branch.',
  '',
  '### One thing that is a defect and not a pin',
  '',
  '`SHIP_WEAPON.fireInterval` 0.35 \u2192 0.7 fails `src/sim/projectiles.test.ts` "conserves',
  'total ore: a rock chipped out yields exactly its ore, no more" with `expected 4 to be',
  'close to 5`. That is not a golden being precious \u2014 the per-hit chip is derived',
  '(`MINING_YIELD_PER_HIT` = `MINING_RATE \u00d7 fireInterval`), and a coarser chip against the',
  'indivisible `CHUNK.ore` = 1 **rounds ore out of existence**. Ore is conserved exactly,',
  'every tick, in CI (GDD \u00a72.7, \u00a74.8). The value is wrong on its merits and is off the list',
  'for that reason, not for a pin.',
  '',
];

/** What the fix costs, stated for whoever owns it. */
const A0117_WOULD_TAKE: readonly string[] = [
  '*Hand-written.*',
  '',
  '**The hull.** `WORLD_SIZE` 2400 \u2192 3400 closes it: **51.8% of 253 decided**, on a0-112\u2019s',
  'seeds, match length unmoved, zero hangs. Three things have to move with it, and not one',
  'of them is in this lane:',
  '',
  '1. **`src/bots/ffa-parity.test.ts`** \u2014 three `hashState` goldens, OWNER Bot Engineer. Its',
  '   own header names the only thing that has ever earned a re-baseline: *a ratified',
  '   amendment in `docs/design-amendments.md`*. A ship-class rebalance either is one or is',
  '   not; that is the Director\u2019s call, not QA\u2019s. Note the same file blocks **every** value',
  '   in this table, including a one-unit change, so this is the gate on the whole idea of a',
  '   QA tuning pass, not on this candidate.',
  '2. **`SHIP_SENSOR_RANGE` (520) and `STATION_SENSOR_RANGE` (300)** must scale with the',
  '   arena or a player stops seeing their own ore field (`src/sim/radar-fog.test.ts`). Both',
  '   are `content/codex/*.json` facts \u2014 Gameplay/content, enforced by',
  '   `tests/codex/codex-constants.test.ts`. At 3400 they want roughly \u00d71.42: **740** and',
  '   **425**. Unmeasured; the arena number is what was measured.',
  '3. **`src/bots/defender-role.test.ts` and `src/bots/team-winning.test.ts`** carry',
  '   travel-time budgets that a bigger board exceeds (measured at 3100: "seed 11: expected',
  '   207 to be less than 145.68"). Bot Engineer\u2019s.',
  '',
  '**Warden \u2014 nothing.** On the candidate it reads **30.5%**, inside the band, with no',
  'character dial touched. It comes for free with the hull, exactly as the brief predicted,',
  'and a Warden nerf applied before the hull would have been tuning against a symptom.',
  '',
  '**Bolt \u2014 not a constant, and not this lane.** All 64 easy-pool matches on the candidate',
  'are DRAWS, and 52 of 64 already are on the shipped tree. Two Easy bots on one hull do not',
  'finish each other, and collapse then takes the last two cores in the same tick. Until',
  'that changes there is no win rate to bring inside anything. It is a **Bots** brief about',
  'the Easy tree \u2014 a0-112 already flagged that the Easy tree never runs `attack` at all \u2014',
  'and possibly an a0-113 follow-up about a draw rule meeting a stalemate. QA can measure it',
  'the day it decides again.',
  '',
  '**And the honest alternative.** If the Director would rather not re-baseline a golden for',
  'a balance pass, then the `excavator` cannot be brought inside the band from',
  '`src/sim/constants.ts` at all, and the fix is structural: GDD \u00a72.11\u2019s class table gives',
  'one hull the best power stat **and** the second-best hull, against a speed and turn',
  'penalty that the simulation currently charges nothing for. Making that penalty real is a',
  'gameplay change \u2014 a firing arc, a turn-gated weapon, or a re-costed class row \u2014 and it',
  'needs its own brief. This report is the evidence either way.',
  '',
];

/** Render `tests/reports/a0-117-tuning.md`. */
function tuningReport(outPath: string | null): number {
  const pair = (section: A0112Section): Pair => a0117Pair(A0117_BEFORE, A0117_AFTER, section);
  const md = renderTuningReport({
    title: 'a0-117 — three contestants over the band, and the one dial that closes the hull',
    context:
      'the ship-class and cast contests re-run on a0-112’s own seeds, branch ' +
      'agent/qa/a0-117-back-inside-the-band',
    verdictLine: A0117_VERDICT,
    headline: A0117_HEADLINE,
    changed: A0117_CHANGED,
    reading: A0117_READING.join('\n'),
    levers: A0117_LEVERS,
    whatItWouldTake: A0117_WOULD_TAKE.join('\n'),
    klass: pair('class'),
    roster: pair('roster'),
    tier: pair('tier'),
    mirror: pair('mirror'),
    cast: pair('cast'),
    a0107: pair('a0107'),
    candidateLabel: A0117_CANDIDATE,
  });
  const path = resolve(ROOT, outPath ?? 'tests/reports/a0-117-tuning.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, md, 'utf8');
  log(`tuning report: wrote ${path} (${md.split('\n').length} lines)`);
  return 0;
}

// ---------------------------------------------------------------------------
// abundance — pricing a candidate SCARCE↔RICH spread (a0-17)
// ---------------------------------------------------------------------------

/**
 * Price one or more candidate wave intervals per abundance level and print the
 * numbers the scarcity report quotes, plus the rail verdicts.
 *
 *   vite-node harness/cli.ts abundance                       # the shipped table
 *   vite-node harness/cli.ts abundance --scarce 180,240 --rich 90,75
 *
 * A candidate is `level@interval`; omitting `--<level>` prices whatever the
 * shipped table resolves to for that level, so a bare run is "re-measure what is
 * committed". Seeds are fixed and printed, so a run is reproducible from the
 * output alone.
 */
function abundance(
  scarce: readonly number[],
  rich: readonly number[],
  standard: readonly number[],
  seedCount: number,
  contestsOnly = false,
): number {
  const seeds = seedRange(seedCount);
  log(`# abundance — candidate wave-interval spread (a0-17)`);
  log('');
  log(`seeds: ${seeds.join(',')}   probe mirrors: miner + turtle (8 seats, vanguard)   roster: the real trees`);
  log('');
  const shipped = shippedSpread();
  log(
    `shipped table: SCARCE ${shipped.scarce.toFixed(1)} s · STANDARD ${shipped.standard.toFixed(1)} s · ` +
      `RICH ${shipped.rich.toFixed(1)} s — spread ${shipped.spread.toFixed(1)} s`,
  );
  log(
    `rails: deadline holds its anchor up to ${maxIntervalHoldingAnchor().toFixed(1)} s/wave; ` +
      `worst-case ending stays inside 15:00 up to ${maxIntervalInsideRail().toFixed(1)} s/wave`,
  );
  log('');

  const candidates: Candidate[] = [
    ...scarce.map((interval) => ({ level: 'scarce' as const, interval })),
    ...(scarce.length ? [] : [{ level: 'scarce' as const }]),
    ...standard.map((interval) => ({ level: 'standard' as const, interval })),
    ...(standard.length ? [] : [{ level: 'standard' as const }]),
    ...rich.map((interval) => ({ level: 'rich' as const, interval })),
    ...(rich.length ? [] : [{ level: 'rich' as const }]),
  ];

  let allPass = true;
  const readings: CandidateReading[] = [];
  if (contestsOnly) return abundanceContests(candidates, seeds);
  log('| level | s/wave | ×base | schedule | miner ore/min | miner med | turtle med | turtle max | roster med | roster max | waves | rails |');
  log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of candidates) {
    const r = readCandidate(c, seeds, seeds);
    readings.push(r);
    const v = railVerdict(r);
    const pass = v.terminates && v.insideLengthRail && v.allWavesLanded;
    allPass = allPass && pass;
    const flags = [
      v.terminates ? '' : 'TIMEOUT',
      v.insideLengthRail ? '' : 'LONG',
      v.allWavesLanded ? '' : 'WAVE-LOST',
      v.anchorHeld ? '' : 'anchor-moved',
    ].filter(Boolean);
    log(
      `| ${r.level} | ${r.interval.toFixed(1)} | ${r.multiplier.toFixed(3)} | ${schedule(r.interval).join(' · ')} | ` +
        `${r.miner.orePerMinute.toFixed(1)} | ${mmss(r.miner.medianSeconds)} | ${mmss(r.turtle.medianSeconds)} | ` +
        `${mmss(r.turtle.maxSeconds)} | ${mmss(r.roster.median)} | ${mmss(r.roster.max)} | ` +
        `${r.minWavesSpawned}/${WAVE_COUNT} | ${flags.length ? flags.join(' ') : 'PASS'} |`,
    );
  }

  log('');
  log('| level | s/wave | last wave | collapse deadline | worst-case end | mined (miner) | field left (turtle) |');
  log('|---|---|---|---|---|---|---|');
  for (const r of readings) {
    log(
      `| ${r.level} | ${r.interval.toFixed(1)} | ${mmss(r.lastWave)} | ${mmss(r.deadline)} | ${mmss(r.worstCase)} | ` +
        `${r.miner.minedTotal.toFixed(0)} | ${r.turtle.fieldLeft.toFixed(0)} |`,
    );
  }

  log('');
  const contestsOk = abundanceContests(candidates, seeds) === 0;
  allPass = allPass && contestsOk;

  log('');
  log(allPass ? '  ALL RAILS GREEN' : '  RAIL BROKEN — see the flags above');
  return allPass ? 0 : 1;
}

/** The two 55% contests at each candidate, contestant by contestant — the shape
 *  that shows whether a win-rate hole is *caused* by abundance or merely present
 *  at every level (a0-17: the excavator is the latter). */
function abundanceContests(candidates: readonly Candidate[], seeds: readonly number[]): number {
  let pass = true;
  for (const c of candidates) {
    const con = readContests(c, seeds);
    const ok = contestsPass(con);
    pass = pass && ok;
    log(
      `  ${con.level} @ ${con.interval.toFixed(1)} s — ${ok ? 'PASS' : 'FAIL'} ` +
        `(${con.ended}/${con.matches} decided; fair share: character ${(100 / HARD_POOL.length).toFixed(1)}%, hull ${(100 / CLASSES.length).toFixed(1)}%)`,
    );
    const row = (label: string, rs: readonly { name: string; rate: number }[]): void =>
      log(`      ${label}: ${rs.map((r) => `${r.name} ${(r.rate * 100).toFixed(1)}%`).join(' · ')}`);
    row('character', con.byCharacter);
    row('hull     ', con.byClass);
  }
  return pass ? 0 : 1;
}

/** `1.2,1.6` or `180,240` → seconds. A value ≤ 4 is read as a `respawnInterval`
 *  multiplier, anything larger as a literal interval in seconds — the two ways a
 *  reader thinks about this table, and no interval below 4 s is meaningful. */
function intervals(arg: string | undefined): number[] {
  if (!arg) return [];
  return arg
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => (n <= 4 ? n * WAVE_INTERVAL_S : n));
}

// ---------------------------------------------------------------------------
// pay — what a match pays, across map, N and abundance (p1-08)
// ---------------------------------------------------------------------------

/**
 * The re-baseline of the XP economy (plan §1.2, §1.3a–d, §1.4).
 *
 * Everything printed is a *measurement* taken with the shipped observer and the
 * shipped pricer; the argument built on it is
 * `docs/progression-balance-p1-08.md`. Redirect this to a file and commit it
 * beside the report, exactly as `spikes/progression/measured-a0-13.txt` was, so
 * the next lane diffs two runs rather than trusting two prose summaries.
 *
 * Exits non-zero when a match failed to reach an ending: a hung match is a
 * failed measurement (GDD §3.8), and a pay table pooled over partial matches is
 * a wrong number rather than a missing one.
 */
/** The career length the summary-sequence cost is modelled over — the brief's
 *  own "at the fiftieth match". */
const SUMMARY_CAREER_MATCHES = 50;

/** One measured cell of the grid: what it was, what it paid, and a real
 *  median player-match from it to hand the summary sequence. */
interface Cell {
  readonly label: string;
  readonly stats: PayStats;
  readonly median: PlayerMatch | null;
  /** Kept so a candidate floor can be priced against the SAME matches rather
   *  than a second sweep — `harness/abundance.ts`'s discipline. */
  readonly results: readonly PayResult[];
}

function pay(seedCount: number): number {
  const seedList = seeds(seedCount);
  const cell = (label: string, setup: Omit<PaySetup, 'seed'>): Cell => {
    const results = seedList.map((seed) => runPayMatch({ ...setup, seed }));
    return { label, stats: payStats(results), median: medianPlayerMatch(results), results };
  };

  log('# p1-08 — what a match pays, re-measured against the shipped code');
  log('');
  log(`sample: seeds ${seedList[0]}..${seedList[seedList.length - 1]} (${seedList.length} per cell) · real shipped bot cast`);
  log('instruments: src/progression/accrual.ts (observer, fed every tick) + src/progression/xp.ts (pricer)');
  log(`weights: ore ${XP_PER_ORE_MINED}× · damage ${XP_PER_DAMAGE_UNIT}/${DAMAGE_HP_PER_UNIT}HP · ship ${XP_PER_SHIP_KILL}× · station ${XP_PER_STATION_KILL}×`);
  log(`tier multiplier: easy ${TIER_MULTIPLIER[Difficulty.Easy]} · medium ${TIER_MULTIPLIER[Difficulty.Medium]} · hard ${TIER_MULTIPLIER[Difficulty.Hard]}`);
  log(`curve: base ${XP_CURVE_BASE} · exp ${XP_CURVE_EXP}`);
  log(`abundance: shipped lobby default is ${DEFAULT_ABUNDANCE.toUpperCase()}; createWorld's own default (what a0-13 measured) is STANDARD`);
  log('');

  const cells: Cell[] = [];
  const section = (title: string, rows: Cell[]): void => {
    cells.push(...rows);
    log(`## ${title}`);
    log('');
    log('| cell | medXP | meanXP | winner | firstOut | spread | XP/min | ore | dmgHP | shipK | statK | struct | upgr | rep | len | max | ended |');
    log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { label, stats: s } of rows) {
      log(
        `| ${label} | ${s.medianXp.toFixed(0)} | ${s.meanXp.toFixed(0)} | ${s.winnerXp.toFixed(0)} | ` +
          `${s.firstOutXp.toFixed(0)} | ${s.spread.toFixed(1)}× | ${s.xpPerMinute.toFixed(1)} | ` +
          `${s.oreMined.toFixed(1)} | ${s.damageHp.toFixed(0)} | ${s.shipKills.toFixed(1)} | ${s.stationKills.toFixed(1)} | ` +
          `${s.structures.toFixed(1)} | ${s.upgrades.toFixed(1)} | ${s.repairs.toFixed(1)} | ` +
          `${mmss(s.medianSeconds)} | ${mmss(s.maxSeconds)} | ${s.ended}/${s.matches} |`,
      );
    }
    log('');
  };

  // 1. The four lobbies §1.3a measured, at BOTH abundances — the standard column
  //    is the apples-to-apples control against the plan's own numbers, the scarce
  //    column is the game as it actually ships.
  section(
    'By lobby, octagon, N=8 — STANDARD (the abundance a0-13 measured)',
    LOBBIES.map((l) => cell(`${l.label} · standard`, { slots: 8, roster: l.roster, abundance: 'standard' })),
  );
  section(
    'By lobby, octagon, N=8 — SCARCE (the shipped lobby default)',
    LOBBIES.map((l) => cell(`${l.label} · scarce`, { slots: 8, roster: l.roster, abundance: 'scarce' })),
  );

  // 2. N — the axis the plan never checked. Per-player ore density rises ~4× as
  //    N falls (`homeFieldOre(n)`), so this is where the curve is most exposed.
  section(
    'By lobby size, octagon, MIXED cast, SCARCE',
    [8, 6, 5, 4, 3].map((n) =>
      cell(`N=${n} · scarce`, { slots: n, roster: MIXED_ROSTER, abundance: 'scarce' }),
    ),
  );

  // 3. Map.
  section(
    'By map, N=8, MIXED cast, SCARCE',
    FFA_MAP_IDS.map((mapId) =>
      cell(`map ${mapId} · scarce`, { slots: 8, mapId, roster: MIXED_ROSTER, abundance: 'scarce' }),
    ),
  );

  // 4. Abundance.
  section(
    'By abundance, octagon, N=8, MIXED cast',
    (['scarce', 'standard', 'rich'] as const).map((abundance) =>
      cell(`abundance ${abundance}`, { slots: 8, roster: MIXED_ROSTER, abundance }),
    ),
  );

  // Question A, as a measurement: what the pay and the participation floor look
  // like with s4's seven rows dropped and only the developer's four kept.
  log('## Plan Question A — the ratified four rows ONLY, beside the full table');
  log('');
  log('| cell | full medXP | four-only medXP | full spread | four-only spread | four-only L2 |');
  log('|---|---|---|---|---|---|');
  for (const { label, stats: s } of cells) {
    log(
      `| ${label} | ${s.medianXp.toFixed(0)} | ${s.fourOnlyMedianXp.toFixed(0)} | ` +
        `${s.spread.toFixed(1)}× | ${s.fourOnlySpread.toFixed(1)}× | ` +
        `${matchesToLevel(s.fourOnlyMedianXp, 2).toFixed(1)} |`,
    );
  }
  log('');

  // Composition — which rows actually pay, pooled over each lobby cell. The
  // §1.3a unit question, re-asked of the shipped economy.
  log('## Composition of the pay, by row (share of all XP paid in the cell)');
  log('');
  log(`| cell | ${XP_ROW_KEYS.join(' | ')} |`);
  log(`|---|${XP_ROW_KEYS.map(() => '---').join('|')}|`);
  for (const { label, stats } of cells) {
    log(
      `| ${label} | ${XP_ROW_KEYS.map((k) => `${(stats.composition[k] * 100).toFixed(0)}%`).join(' | ')} |`,
    );
  }
  log('');

  // The curve, re-fitted against every cell measured above.
  log(`## The curve at each measured pay (base ${XP_CURVE_BASE}, exp ${XP_CURVE_EXP})`);
  log('');
  log(`| cell | medXP | ${CURVE_MILESTONES.map((l) => `L${l}`).join(' | ')} | base for L2 in one match |`);
  log(`|---|---|${CURVE_MILESTONES.map(() => '---').join('|')}|---|`);
  for (const { label, stats } of cells) {
    log(
      `| ${label} | ${stats.medianXp.toFixed(0)} | ` +
        `${CURVE_MILESTONES.map((l) => matchesToLevel(stats.medianXp, l).toFixed(1)).join(' | ')} | ` +
        `${baseForLevel2In(stats.medianXp).toFixed(0)} |`,
    );
  }
  log('');

  // The hook, asked about the player it was written for: not the median seat,
  // but a new player losing their first match (the brief's falsification 2).
  log('## "Level 2 inside a single match" — for WHOM (matches to level 2)');
  log('');
  log('| cell | worst seat | p25 | median | winner | first out | L2 @ p25 | L2 @ first out |');
  log('|---|---|---|---|---|---|---|---|');
  for (const { label, stats: s } of cells) {
    log(
      `| ${label} | ${s.worstXp.toFixed(0)} | ${s.p25Xp.toFixed(0)} | ${s.medianXp.toFixed(0)} | ` +
        `${s.winnerXp.toFixed(0)} | ${s.firstOutXp.toFixed(0)} | ` +
        `${matchesToLevel(s.p25Xp, 2).toFixed(1)} | ${matchesToLevel(s.firstOutXp, 2).toFixed(1)} |`,
    );
  }
  log('');

  // What it would take to make the hook true for the player it was written for
  // — a new player losing their first match. Priced against the SHIPPED default
  // lobby's own matches, so the candidates are comparable to each other and to
  // the row above them. QA recommends; it does not apply (`src/progression/xp.ts`
  // is the UI Engineer's file, and its rows are plan Question A's territory).
  const shipped = cells.find((c) => c.label === 'MIXED cast · scarce');
  if (shipped) {
    log('## Candidate participation floors, priced against the shipped default lobby');
    log('');
    log(`(MIXED cast · octagon · N=8 · SCARCE — the lobby an offline match actually seats)`);
    log('');
    log('| candidate | median | p25 | first out | L2 @ median | L2 @ p25 | L2 @ first out | spread |');
    log('|---|---|---|---|---|---|---|---|');
    const candidates: { label: string; bonus: (p: PlayerMatch) => number }[] = [
      { label: 'shipped (control)', bonus: () => 0 },
      { label: 'XP_PER_WAVE 15 → 40', bonus: (p) => rowCount(p, 'waves') * 25 },
      { label: 'XP_PER_PLACEMENT_RUNG 20 → 40', bonus: (p) => rowCount(p, 'placement') * 20 },
      { label: 'flat MATCH PLAYED +100', bonus: () => 100 },
      { label: 'flat MATCH PLAYED +200', bonus: () => 200 },
      { label: 'flat +100 and XP_PER_WAVE 40', bonus: (p) => 100 + rowCount(p, 'waves') * 25 },
    ];
    for (const c of candidates) {
      const r = floorCandidate(shipped.results, c.label, c.bonus);
      log(
        `| ${r.label} | ${r.medianXp.toFixed(0)} | ${r.p25Xp.toFixed(0)} | ${r.firstOutXp.toFixed(0)} | ` +
          `${r.medianL2.toFixed(1)} | ${r.p25L2.toFixed(1)} | ${r.firstOutL2.toFixed(1)} | ${r.spread.toFixed(1)}× |`,
      );
    }
    log('');
  }

  // The summary sequence, in the loop. The brief's question: a five-second beat
  // every match is not free at the fiftieth.
  log('## The summary sequence in the loop (pr-05 `buildSummary`, watched not skipped)');
  log('');
  log('| cell | 1st match | median | max | ×50 matches | with level-up | level @50 | match+summary |');
  log('|---|---|---|---|---|---|---|---|');
  for (const c of cells) {
    if (!c.median) continue;
    const cost = summaryCost(c.median.accrual, c.median.xp, SUMMARY_CAREER_MATCHES);
    log(
      `| ${c.label} | ${cost.firstMatchSeconds.toFixed(1)}s | ${cost.medianSeconds.toFixed(1)}s | ` +
        `${cost.maxSeconds.toFixed(1)}s | ${mmss(cost.totalSeconds)} | ` +
        `${cost.withLevelUp}/${cost.matches} | ${cost.finalLevel} | ` +
        `${mmss(c.stats.medianSeconds + cost.medianSeconds)} |`,
    );
  }
  log('');

  // Verdicts.
  const failed = cells.filter((c) => c.stats.ended < c.stats.matches);
  const long = cells.filter(
    (c) => c.stats.medianSeconds > LENGTH_TARGET_MAX_S || c.stats.medianSeconds < LENGTH_TARGET_MIN_S,
  );
  const noHook = cells.filter((c) => matchesToLevel(c.stats.medianXp, 2) > 1);
  log('## Verdicts');
  log('');
  log(`  measurement: ${failed.length === 0 ? 'ALL MATCHES ENDED' : `${failed.length} cell(s) lost matches to a ceiling`}`);
  for (const c of failed) log(`    ${c.label}: ${c.stats.ended}/${c.stats.matches} ended · ${c.stats.failures.join(',')}`);
  log(
    `  match length 10–15 min: ${long.length === 0 ? 'ALL CELLS IN TARGET' : `${long.length} cell(s) outside`}`,
  );
  for (const c of long) log(`    ${c.label}: median ${mmss(c.stats.medianSeconds)}`);
  log(
    `  "level 2 inside one match": ${noHook.length === 0 ? 'HOLDS IN EVERY CELL' : `${noHook.length} cell(s) miss it`}`,
  );
  for (const c of noHook) log(`    ${c.label}: ${matchesToLevel(c.stats.medianXp, 2).toFixed(2)} matches`);
  log('');
  return failed.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function usage(): number {
  log('usage: vite-node harness/cli.ts <smoke|balance|perf|determinism|soak|abundance|pay|mirrors> [args]');
  log('  mirrors <mirror|roster|tier|class|slice|cast> [--seeds n] [--data DIR]  # run one section');
  log('  mirrors report [--out FILE] [--data DIR]               # render the report from artifacts');
  log('  tuning report [--out FILE]                             # render the a0-117 before/candidate report');
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
    case 'soak': {
      const matches = rest[0] && !rest[0].startsWith('--') ? Number(rest[0]) : 50;
      const rotFlag = rest.indexOf('--rotations');
      const rotations = rotFlag >= 0 ? Number(rest[rotFlag + 1] ?? 4) : 4;
      return soak(matches, rotations);
    }
    case 'mirrors': {
      const sub = rest[0] ?? '';
      const outFlag = rest.indexOf('--out');
      const dataFlag = rest.indexOf('--data');
      if (dataFlag >= 0) dataDir = rest[dataFlag + 1] ?? A0112_DATA;
      if (sub === 'report') return mirrorsReport(outFlag >= 0 ? (rest[outFlag + 1] ?? null) : null);
      if (!(A0112_SECTIONS as readonly string[]).includes(sub)) return usage();
      const seedsFlag = rest.indexOf('--seeds');
      return mirrors(sub as A0112Section, seedsFlag >= 0 ? Number(rest[seedsFlag + 1] ?? 24) : 24);
    }
    case 'tuning': {
      const sub = rest[0] ?? '';
      if (sub !== 'report') return usage();
      const outFlag = rest.indexOf('--out');
      return tuningReport(outFlag >= 0 ? (rest[outFlag + 1] ?? null) : null);
    }
    case 'pay': {
      const seedsFlag = rest.indexOf('--seeds');
      return pay(seedsFlag >= 0 ? Number(rest[seedsFlag + 1] ?? 12) : 12);
    }
    case 'abundance': {
      const flagValue = (name: string): string | undefined => {
        const i = rest.indexOf(name);
        return i >= 0 ? rest[i + 1] : undefined;
      };
      const seedsFlag = flagValue('--seeds');
      return abundance(
        intervals(flagValue('--scarce')),
        intervals(flagValue('--rich')),
        intervals(flagValue('--standard')),
        seedsFlag ? Number(seedsFlag) : 8,
        rest.includes('--contests'),
      );
    }
    default:
      return usage();
  }
}

process.exitCode = main(process.argv.slice(2));

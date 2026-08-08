/**
 * tests/mobile/shard-plan.ts — which shard runs which work. OWNER: QA Agent.
 *
 * ── THE LESSON THIS FILE ENCODES ───────────────────────────────────────────
 * a0-00 split this suite four ways with Playwright's native `--shard=i/N` and
 * the wall times came back **5 · 12 · 21 · 42 minutes**. A gate is as slow as
 * its slowest shard, so four runners bought the time of one 42-minute job —
 * roughly a third of the split it looked like it was buying.
 *
 * `--shard` divides by TEST COUNT. That is the right rule for a suite whose
 * tests all cost about the same, and this one is nothing like that: measured on
 * PR #321's own run (31249237259), the 123 tests that actually execute span
 * **1.4 s to 300 s**, and the single heaviest spec-file/project pair costs more
 * than the whole of the lightest shard. Counting tests and calling it balanced
 * is how you get 5 and 42 in the same matrix.
 *
 * So this file divides by MEASURED DURATION instead. Nothing about what is
 * asserted moves — same specs, same three projects, same budgets, same
 * baselines. Only the assignment changes.
 *
 * ── THE UNIT IS A SPEC FILE ON A PROJECT, AND THAT IS FORCED ───────────────
 * `playwright.config.ts` sets `fullyParallel: false`, so every test in one spec
 * file runs SERIALLY in one worker. A file/project pair is therefore the
 * smallest thing a scheduler can actually move: splitting one across two shards
 * would not make it finish sooner, and splitting it across two workers is not
 * something Playwright will do. Hence `iphone|goldens.spec.ts` is one indivisible
 * 1032-second brick, and the floor on any plan is the largest brick in it
 * ({@link heaviestUnit}). That floor is why N stops at 8: an even split of the
 * suite's 8355 s is 1044 s, so N=8 is the largest N the heaviest brick does not
 * bind. At N=9 the makespan flatlines and the spread goes 28 s → 123 s.
 *
 * ── THE ALGORITHM, AND WHY THIS ONE ────────────────────────────────────────
 * Longest-processing-time-first (LPT) greedy: sort the bricks heaviest-first,
 * drop each into the shard with the least work so far. It is four lines, it is
 * deterministic (ties break on the unit's own name, never on directory order),
 * and its makespan is provably within 4/3 − 1/(3N) of optimal — for N=8, within
 * 29% of a perfect split, and in practice much closer (28 s of spread on 1044 s,
 * i.e. under 3%). Optimal bin-packing here would buy single-digit seconds for a
 * scheduler nobody could review.
 *
 * Every shard computes the WHOLE plan and takes its own slice, so the shards
 * never have to agree about anything at run time — they agree by construction,
 * and their union is exactly the suite (`tests/mobile-shard-plan.test.ts`
 * asserts precisely that, plus that no file is in two shards).
 *
 * ── WHEN THE TABLE IS WRONG ────────────────────────────────────────────────
 * {@link MEASURED_SECONDS} is a snapshot, and a snapshot goes stale. Two things
 * keep that from being a silent failure:
 *
 *   - a file with NO entry costs {@link UNMEASURED_SECONDS} rather than zero, so
 *     a new spec lands in the middle of the pack instead of being treated as
 *     free and dumped on whichever shard is already lightest;
 *   - `tests/mobile-shard-plan.test.ts` fails the build when a spec file in
 *     tests/mobile/ has no row here at all, so "add a spec, forget the table" is
 *     a red unit test on the cheapest job rather than a slow shard nobody reads.
 *
 * Re-measure by re-reading the `list` reporter's per-test durations off a green
 * run of the four shards and re-summing per file/project — the procedure is
 * written out in tests/reports/mobile-shard-a0-00.md §6.
 */

/** A spec file as run on one project — the indivisible unit of scheduling. */
export interface ShardUnit {
  readonly project: string;
  readonly file: string;
  /** Measured wall-clock seconds for every test in this file on this project. */
  readonly seconds: number;
}

/** One shard's assignment, and what it is predicted to cost. */
export interface ShardAssignment {
  /** 1-based, as the CI matrix names it. */
  readonly shard: number;
  readonly units: readonly ShardUnit[];
  /** Sum of the units' measured seconds — the shard's serial test time. */
  readonly seconds: number;
}

/**
 * What one spec file costs on one project, in wall-clock seconds, keyed
 * `project|file`.
 *
 * MEASURED, not estimated: summed from the `list` reporter's per-test durations
 * in the shard jobs of run **31258319576**, first attempts only — a retry is a
 * repeat of work already counted, and counting it would inflate exactly the
 * specs that are already the problem.
 *
 * Refreshed off 31258319576 rather than the original 31249237259, for two
 * reasons. The three spec fixes this branch shipped moved real numbers —
 * `iphone|upgrade-wheel-gantry` 1338 → 688 s, `iphone|menu-frame-cost` 480 →
 * 186 s — and a table that still priced them at their pre-fix cost would keep
 * isolating files that are no longer heavy. And the old table was summed off a
 * run whose shard 2 was a 42-minute pile-up, which distorted everything in it.
 *
 * ── WHY AN INFLATED SNAPSHOT IS STILL A CORRECT ONE ────────────────────────
 * These durations were measured at `workers: 2`, i.e. every one of them carries
 * some contention tax, and four tests in `iphone|goldens` are their 90 s budget
 * rather than their cost. That is fine, and not by luck: **LPT balances on
 * RATIOS, so a uniform scale factor cannot change the assignment it produces.**
 * What would break the plan is a cost that is wrong *relative to its
 * neighbours*, which is precisely what the stale table had become. A test that
 * hit its budget is if anything under-counted (a ceiling truncates it), and
 * under-counting the heaviest brick is the safe direction: it can only make
 * this file spread that brick's shard thinner.
 *
 * A pair that is absent ran ZERO tests: `menu-frame-cost` skips off `iphone`,
 * `build-flow` skips off `desktop`, `goldens` skips off `pixel`. Absent is not
 * the same as unmeasured — see {@link UNMEASURED_SECONDS} — so the two are told
 * apart by {@link MEASURED_FILES} rather than by a zero.
 */
export const MEASURED_SECONDS: Readonly<Record<string, number>> = {
  'iphone|goldens.spec.ts': 1032,
  'pixel|upgrade-wheel-gantry.spec.ts': 918,
  'iphone|upgrade-wheel-gantry.spec.ts': 688,
  'iphone|build-flow.spec.ts': 570,
  'iphone|build-wheel-gantry.spec.ts': 504,
  'pixel|build-wheel-gantry.spec.ts': 504,
  'pixel|build-flow.spec.ts': 492,
  'desktop|goldens.spec.ts': 421,
  'desktop|upgrade-wheel-gantry.spec.ts': 311,
  'iphone|landscape-lock.spec.ts': 307,
  'iphone|campaign-door.spec.ts': 254,
  'iphone|slot-state.spec.ts': 240,
  'pixel|campaign-door.spec.ts': 234,
  'iphone|emulation.spec.ts': 218,
  'pixel|landscape-lock.spec.ts': 206,
  'iphone|menu-frame-cost.spec.ts': 186,
  'pixel|emulation.spec.ts': 185,
  'pixel|slot-state.spec.ts': 174,
  'iphone|centering.spec.ts': 173,
  'pixel|centering.spec.ts': 152,
  'desktop|build-wheel-gantry.spec.ts': 94,
  'iphone|voice-copy-fit.spec.ts': 78,
  'desktop|campaign-door.spec.ts': 68,
  'pixel|voice-copy-fit.spec.ts': 64,
  'desktop|centering.spec.ts': 63,
  'iphone|layout.spec.ts': 59,
  'desktop|slot-state.spec.ts': 54,
  'pixel|layout.spec.ts': 47,
  'desktop|voice-copy-fit.spec.ts': 17,
  'desktop|emulation.spec.ts': 17,
  'desktop|landscape-lock.spec.ts': 13,
  'desktop|layout.spec.ts': 13,
  'pixel|goldens.spec.ts': 0,
  'pixel|menu-frame-cost.spec.ts': 0,
  'desktop|menu-frame-cost.spec.ts': 0,
  'desktop|build-flow.spec.ts': 0,
};

/** Every spec file the table above has an opinion about, on any project. */
export const MEASURED_FILES: ReadonlySet<string> = new Set(
  Object.keys(MEASURED_SECONDS).map((k) => k.slice(k.indexOf('|') + 1)),
);

/**
 * What an unmeasured file/project pair is assumed to cost.
 *
 * The mean executed pair in the table is ~230 s; this is deliberately a little
 * under that. Zero would be the dangerous default — an unmeasured spec would
 * look free, get stacked onto whichever shard was already lightest, and turn up
 * as a mystery 10-minute regression on one runner. A middling guess costs at
 * worst a slightly lopsided plan for one run, and the contract test turns the
 * omission red long before that.
 */
export const UNMEASURED_SECONDS = 180;

/** This pair's cost, measured where we have it and assumed where we do not. */
export function costOf(project: string, file: string): number {
  const key = `${project}|${file}`;
  if (key in MEASURED_SECONDS) return MEASURED_SECONDS[key]!;
  // A file we have never measured at all — assume it costs something everywhere.
  // A file we HAVE measured, on a project it is absent from, genuinely costs 0.
  return MEASURED_FILES.has(file) ? 0 : UNMEASURED_SECONDS;
}

/**
 * Assign every project × file pair to one of `total` shards, heaviest first,
 * always into the shard that has the least work so far.
 *
 * `files` is passed in rather than read off disk here so this stays a pure
 * function a unit test can drive with a fixture — the caller
 * (playwright.config.ts) is the one that enumerates tests/mobile/.
 */
export function planShards(
  projects: readonly string[],
  files: readonly string[],
  total: number,
): ShardAssignment[] {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard-plan: shard count must be a positive integer, got ${String(total)}`);
  }

  const units: ShardUnit[] = [];
  for (const project of projects) {
    for (const file of files) units.push({ project, file, seconds: costOf(project, file) });
  }
  // Heaviest first; ties broken on the unit's own name so the plan is identical
  // on every runner, every time, whatever order the directory was read in.
  units.sort(
    (a, b) =>
      b.seconds - a.seconds ||
      `${a.project}|${a.file}`.localeCompare(`${b.project}|${b.file}`),
  );

  const shards: ShardAssignment[] = Array.from({ length: total }, (_, i) => ({
    shard: i + 1,
    units: [] as ShardUnit[],
    seconds: 0,
  })) as ShardAssignment[];

  for (const unit of units) {
    // The least-loaded shard, lowest index first so a tie is resolved the same
    // way on every runner.
    let best = 0;
    for (let i = 1; i < shards.length; i++) if (shards[i]!.seconds < shards[best]!.seconds) best = i;
    (shards[best]!.units as ShardUnit[]).push(unit);
    (shards[best] as { seconds: number }).seconds += unit.seconds;
  }

  return shards;
}

/**
 * The spec files shard `shard` of `total` should run on `project` — the slice of
 * the whole plan this runner owns. Sorted, so the CI log reads the same order
 * every time.
 */
export function filesForShard(
  projects: readonly string[],
  files: readonly string[],
  project: string,
  shard: number,
  total: number,
): string[] {
  if (!Number.isInteger(shard) || shard < 1 || shard > total) {
    throw new Error(`shard-plan: shard ${String(shard)} is not in 1..${total}`);
  }
  return planShards(projects, files, total)
    .find((s) => s.shard === shard)!
    .units.filter((u) => u.project === project)
    .map((u) => u.file)
    .sort();
}

/**
 * The heaviest single unit in a plan — the wall-clock FLOOR no shard count can
 * beat, because a file/project pair cannot be split (see the header). Reported
 * alongside the spread so a plan that is as balanced as it can get is not
 * mistaken for one that is merely badly packed.
 */
export function heaviestUnit(projects: readonly string[], files: readonly string[]): ShardUnit {
  let worst: ShardUnit = { project: '', file: '', seconds: -1 };
  for (const project of projects) {
    for (const file of files) {
      const seconds = costOf(project, file);
      if (seconds > worst.seconds) worst = { project, file, seconds };
    }
  }
  return worst;
}

/** The plan's spread: the gap between its busiest and idlest shard, in seconds. */
export function spreadSeconds(plan: readonly ShardAssignment[]): number {
  const totals = plan.map((s) => s.seconds);
  return Math.max(...totals) - Math.min(...totals);
}

/**
 * harness/pool-size.ts — how many test workers this box can actually afford.
 * OWNER: QA Agent (a0-00c).
 *
 * Both test runners size their worker pool from `os.cpus().length` (vitest) or
 * `os.cpus().length / 2` (Playwright). Inside a container that number is a lie:
 * Docker does not mask `/proc/cpuinfo` against the cgroup CPU quota, so a
 * process in a 6-core container on a 16-core host reads *sixteen* and spawns a
 * pool sized for a machine it does not have. The studio container then runs
 * three lanes at once, each spawning that oversized pool, and the three runs
 * spend their time descheduling each other rather than running tests. Measured
 * 2026-08-08: one `npm test -- --run` at 85 minutes and climbing against ~2
 * minutes on a quiet box — no test got slower, the runner got mis-sized. Same
 * shape as the CI problem a0-00 fixed, one level down.
 *
 * So: derive the cap from the cgroup quota, which is the only number that
 * describes the box the process is actually in, and divide it by the number of
 * lanes sharing that box.
 *
 *   cgroup v2  /sys/fs/cgroup/cpu.max            "600000 100000" -> 6.0 cores
 *   cgroup v1  cpu.cfs_quota_us / cfs_period_us  "600000"/"100000" -> 6.0 cores
 *   unlimited  "max" or quota -1                 -> null, fall back to os
 *
 * The fallback matters as much as the derivation: on a developer's laptop and on
 * a GitHub runner there is no quota and no `LANES`, so this returns exactly the
 * host parallelism the runners would have picked themselves and nothing changes.
 * This file only ever *removes* workers, and only when a cgroup says to.
 *
 * What it deliberately does not do: change which specs run, or how they are
 * sharded. CI's shard plan (a0-00b) divides work across *machines*; this divides
 * workers *within* one machine. Independent axes, both needed.
 *
 * Pure enough to unit-test: {@link resolveWorkerCap} takes the raw file contents
 * and environment as arguments, so `tests/harness/pool-size.test.ts` can assert
 * the arithmetic for boxes this one is not.
 */

import { availableParallelism, cpus } from 'node:os';
import { readFileSync } from 'node:fs';

/** cgroup v2 unified path. One line: "<quota|max> <period>", microseconds. */
const CGROUP_V2 = '/sys/fs/cgroup/cpu.max';
/** cgroup v1 pair. Quota is -1 when unlimited. */
const CGROUP_V1_QUOTA = '/sys/fs/cgroup/cpu/cpu.cfs_quota_us';
const CGROUP_V1_PERIOD = '/sys/fs/cgroup/cpu/cpu.cfs_period_us';

/** Everything {@link resolveWorkerCap} is allowed to look at. */
export interface BoxReading {
  /** Contents of `/sys/fs/cgroup/cpu.max`, or null if unreadable. */
  cpuMax: string | null;
  /** Contents of `cpu.cfs_quota_us`, or null if unreadable. */
  cfsQuota: string | null;
  /** Contents of `cpu.cfs_period_us`, or null if unreadable. */
  cfsPeriod: string | null;
  /** What the runners would have used: `os.availableParallelism()`. */
  hostParallelism: number;
  /** `LANES` — how many lanes share this container. Absent means one. */
  lanes: string | undefined;
  /** `VITEST_MAX_WORKERS` — an explicit override, for measurement runs. */
  override: string | undefined;
}

/** Why a cap is what it is. Carried alongside the number so callers can say so. */
export interface WorkerCap {
  /** Workers to allow. Always >= 1. */
  workers: number;
  /** Cores the cgroup quota grants, or null when there is no quota. */
  quotaCores: number | null;
  /** This lane's share of those cores, fractional; null when there is no quota. */
  laneCores: number | null;
  /** Lanes sharing the box. */
  lanes: number;
  /** One line of arithmetic, for a log or a report. */
  reason: string;
}

/** Read a cgroup file, or null when it is absent (v1 on a v2 box, or no cgroup). */
function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Cores granted by the cgroup CPU quota, or null when unlimited/unreadable.
 * A fractional grant floors: 1.5 cores' worth of quota is one worker's worth of
 * headroom, and rounding up is how you get the thrash this file exists to stop.
 */
export function quotaCores(reading: BoxReading): number | null {
  const v2 = reading.cpuMax?.trim().split(/\s+/);
  if (v2 && v2.length >= 2 && v2[0] !== 'max') {
    const quota = Number(v2[0]);
    const period = Number(v2[1]);
    if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
      return quota / period;
    }
  }

  const quota = Number(reading.cfsQuota?.trim());
  const period = Number(reading.cfsPeriod?.trim());
  if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
    return quota / period;
  }

  return null;
}

/** A positive integer from an env var, or null when unset/garbage. */
function positiveInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The cap, and the arithmetic behind it.
 *
 * `VITEST_MAX_WORKERS` > (cgroup cores / LANES) > host parallelism. The result
 * is clamped to [1, hostParallelism]: never zero workers, and never more than
 * the machine claims to have even if someone sets `LANES=0.5`-shaped nonsense.
 */
export function resolveWorkerCap(reading: BoxReading): WorkerCap {
  const lanes = positiveInt(reading.lanes) ?? 1;
  const cores = quotaCores(reading);

  const laneCores = cores === null ? null : cores / lanes;

  const override = positiveInt(reading.override);
  if (override !== null) {
    return {
      workers: override,
      quotaCores: cores,
      laneCores,
      lanes,
      reason: `VITEST_MAX_WORKERS=${override} (explicit override)`,
    };
  }

  if (cores === null) {
    return {
      workers: Math.max(1, reading.hostParallelism),
      quotaCores: null,
      laneCores: null,
      lanes,
      reason:
        `no cgroup CPU quota — using host parallelism ${reading.hostParallelism} ` +
        `(unchanged from the runner's own default)`,
    };
  }

  const workers = Math.max(1, Math.min(Math.floor(cores / lanes), reading.hostParallelism));
  return {
    workers,
    quotaCores: cores,
    laneCores,
    lanes,
    reason:
      `cgroup quota ${round2(cores)} cores / LANES ${lanes} = ${workers} workers ` +
      `(host claims ${reading.hostParallelism})`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Read this box. */
export function readBox(env: NodeJS.ProcessEnv = process.env): BoxReading {
  return {
    cpuMax: readOrNull(CGROUP_V2),
    cfsQuota: readOrNull(CGROUP_V1_QUOTA),
    cfsPeriod: readOrNull(CGROUP_V1_PERIOD),
    hostParallelism: hostParallelism(),
    lanes: env['LANES'],
    override: env['VITEST_MAX_WORKERS'],
  };
}

/** Exactly what vitest and Playwright ask the OS — so the fallback is a no-op. */
export function hostParallelism(): number {
  return typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
}

/** The cap for this box, with its arithmetic. Cheap; called once per config load. */
export function workerCap(env: NodeJS.ProcessEnv = process.env): WorkerCap {
  return resolveWorkerCap(readBox(env));
}

/**
 * Cores one mobile browser worker needs to itself before it starts costing more
 * than it buys. Not a guess: `playwright.config.ts` records a dpr-3 page running
 * at 0.28 fps with two workers on a 4-core runner against 1.5 fps with the
 * runner to itself, and a golden that died outright (`session closed`) beside a
 * heavy neighbour. A page rasterising in software is a ~2-core unit.
 */
export const CORES_PER_BROWSER_WORKER = 2;

/**
 * Playwright's worker count for this box, or `undefined` to leave Playwright's
 * own default alone.
 *
 * `undefined` off a container is deliberate and matches what playwright.config
 * already said: a dev box has the cores, and this brief is not the place to take
 * them away. Under a quota it is the lane's core share divided by
 * {@link CORES_PER_BROWSER_WORKER} — in the studio, 6 cores / 3 lanes = 2 cores
 * per lane = **1 worker**, which is the same answer CI reached by measurement.
 */
export function resolveBrowserWorkerCap(cap: WorkerCap): number | undefined {
  if (cap.laneCores === null) return undefined;
  return Math.max(1, Math.floor(cap.laneCores / CORES_PER_BROWSER_WORKER));
}

/** {@link resolveBrowserWorkerCap} against the box actually running this. */
export function browserWorkerCap(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return resolveBrowserWorkerCap(workerCap(env));
}

/**
 * The cap as a bare number, announcing itself on stderr when it actually bites.
 * Silent on a laptop and in CI (no quota => no reduction => nothing to explain);
 * one line in a container, which is where someone will be wondering why a run is
 * using two cores. `TEST_POOL_QUIET=1` mutes it.
 */
export function announcedWorkerCap(env: NodeJS.ProcessEnv = process.env): number {
  const cap = workerCap(env);
  if (cap.workers < hostParallelism() && !env['TEST_POOL_QUIET']) {
    process.stderr.write(`[pool-size] worker cap ${cap.workers}: ${cap.reason}\n`);
  }
  return cap.workers;
}

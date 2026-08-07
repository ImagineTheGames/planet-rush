/**
 * tests/net/capacity/capacity-ramp.ts — ramp N until the loop is late. OWNER:
 * Netcode Engineer (m11 server stress; GDD §4.2).
 *
 * Machines advertise a capacity of 32 rooms. Nobody had measured it. This is the
 * instrument that does: add rooms in steps against ONE Machine, let each step
 * settle, sample `/health` across a window, and stop at the first N whose
 * sustained loop lag crosses the safety line — the tick budget is 33 ms at the
 * 30 Hz broadcast, and 10 ms is where the margin stops being comfortable.
 *
 * Three measurement decisions, each of which changes the answer:
 *
 * **1. The headline is the MEDIAN of a step's window, and a breach is confirmed.**
 * `/health`'s `loopLagMs` is a p99 over 256 samples at 2 Hz — a two-minute
 * memory. That is right for an alarm (it catches a rising load fast: p99 of 256
 * is the 3rd-largest sample) and wrong for a step, because it keeps a *previous*
 * step's spike for ~128 s and would attribute it to this N. Taking the median of
 * a step's readings drops the inherited tail, and a breach is then re-tested at
 * the same N over a longer window before it is believed. A single high reading
 * is never a capacity result.
 *
 * **2. CPU is the honest second axis.** It is cumulative, so differencing it over
 * a window has *no* memory at all, and it is what a shared-vCPU quota actually
 * bills. On a shared-cpu-1x the loop can look perfectly healthy right up to the
 * quota and then fall off a cliff when the burst credit is gone — lag reports the
 * cliff, CPU reports the approach (`./guest-model.ts` turns it into rooms).
 *
 * **3. Marginal, not average.** A room costs `(cpu(N) − cpu(0)) / N`. The empty
 * process is not free — it holds a listener, a 60 Hz interval and a lag probe —
 * and on a guest metered at 6.25% of a core that floor is a real fraction of the
 * budget. Billing it to the rooms would understate how many fit.
 */

import type { CapacityTarget } from './target';
import type { HealthReading } from './target';
import { SyntheticFleet } from './synthetic-match';

/** How the ramp is shaped. Every default is stated in the report it produces. */
export interface RampOptions {
  /** Rooms at the first step. */
  readonly startRooms?: number;
  /** Rooms added per step. */
  readonly step?: number;
  /** Give up above this many rooms even if nothing has breached. */
  readonly maxRooms?: number;
  /** Ignore readings for this long after adding rooms — room construction and
   *  the first `fullEntityState` broadcast are a transient, not the steady state. */
  readonly settleMs?: number;
  /** Sample window per step. */
  readonly sampleMs?: number;
  /** Longer window a breach must survive to count. */
  readonly confirmMs?: number;
  /** The safety line, ms of sustained loop lag. */
  readonly lagLimitMs?: number;
  /** Empty-process baseline window, before any room exists. */
  readonly baselineMs?: number;
  /** Called with each step as it completes, so a CLI can print a live table. */
  readonly onStep?: (step: RampStep) => void;
  /** Progress narration for a run that takes twenty minutes. */
  readonly log?: (line: string) => void;
}

/** One rung of the ramp. */
export interface RampStep {
  /** Rooms opened by the end of this step. */
  readonly rooms: number;
  /** Rooms still live and flying — see {@link RampStep.failures}. */
  readonly liveRooms: number;
  readonly lagMedianMs: number;
  readonly lagMaxMs: number;
  /** Server CPU over this step's window, as a percentage of ONE core. */
  readonly cpuPercentOfCore: number | null;
  /** `(cpu(N) − cpu(0)) / N`, ms of CPU per second of wall clock, per room. */
  readonly cpuMsPerRoomPerSec: number | null;
  readonly rssMb: number | null;
  /** Snapshot bytes each room's single client received per second. */
  readonly snapshotBytesPerRoomPerSec: number | null;
  /** Median lag crossed the limit in this step's window. */
  readonly breached: boolean;
  /** Set when a breach was re-tested over the confirm window: did it hold? */
  readonly confirmed?: boolean;
  /** Rooms that stopped generating load, with why. A step with any of these is
   *  reported and NOT treated as a clean capacity reading. */
  readonly failures: readonly string[];
  /** Window length actually sampled, ms. */
  readonly windowMs: number;
  /** Readings taken in the window. */
  readonly samples: number;
}

/** What a whole run found. */
export interface RampResult {
  readonly target: string;
  readonly limitMs: number;
  readonly options: Required<Omit<RampOptions, 'onStep' | 'log'>>;
  /** The empty process, before any room existed. */
  readonly baseline: {
    readonly lagMedianMs: number;
    readonly cpuPercentOfCore: number | null;
    readonly rssMb: number | null;
  };
  readonly steps: readonly RampStep[];
  /**
   * The largest N that held the line — the honest capacity, before margin. Null
   * when the ramp hit `maxRooms` without breaching (the answer is then "at least
   * `maxRooms`", and the run should be repeated with a higher ceiling), or when
   * the very first step breached.
   */
  readonly honestN: number | null;
  /** True when the run ended because it ran out of ramp, not out of headroom. */
  readonly ranOutOfRamp: boolean;
  /**
   * **The empty process was already lagging past the safety line.**
   *
   * `loopLagMs` is a p99, so it reports the worst few of 256 samples — and on a
   * noisy host (a laptop, a shared CI runner, anything under WSL2) the scheduler
   * supplies those spikes for free, with no rooms open at all. When that is true
   * the lag axis is measuring the *host*, the 10 ms line is unreachable, and the
   * honest N below is not a capacity result. The CPU axis has no such problem —
   * it is a cumulative counter differenced over a window — which is why a run
   * that trips this flag can still produce a usable answer through
   * `./guest-model.ts`, and why the CI gate is a CPU gate.
   */
  readonly baselineExceedsLimit: boolean;
}

const DEFAULTS = {
  startRooms: 4,
  step: 4,
  maxRooms: 48,
  settleMs: 15_000,
  sampleMs: 20_000,
  confirmMs: 60_000,
  lagLimitMs: 10,
  baselineMs: 10_000,
} as const;

/** `/health` is polled at the same 2 Hz the server samples its own lag at, so a
 *  window of W ms yields ~W/500 readings and no reading is counted twice. */
const POLL_MS = 500;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Poll `/health` across a window and return every reading. A failed poll is
 *  skipped, not fatal: one refused connection under load is a hiccup, and a
 *  window with *no* readings is caught by the caller. */
async function sampleWindow(
  target: CapacityTarget,
  windowMs: number,
): Promise<HealthReading[]> {
  const readings: HealthReading[] = [];
  const end = Date.now() + windowMs;
  while (Date.now() < end) {
    try {
      readings.push(await target.health());
    } catch {
      // skipped
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return readings;
}

/** CPU drawn across a window, as a percentage of one core. Needs two readings
 *  with a `cpuMs` — a server one deploy behind reports none, and the column is
 *  then honestly absent rather than zero. */
function cpuPercent(readings: readonly HealthReading[]): number | null {
  const withCpu = readings.filter((r) => r.cpuMs !== null);
  const first = withCpu[0];
  const last = withCpu[withCpu.length - 1];
  if (!first || !last || first === last) return null;
  const wall = last.at - first.at;
  if (wall <= 0) return null;
  return ((last.cpuMs! - first.cpuMs!) / wall) * 100;
}

/**
 * Run the ramp. Long — a full run is `baseline + steps × (settle + sample)` and
 * lands around twenty minutes at the defaults — so it narrates through `log`.
 */
export async function runCapacityRamp(
  target: CapacityTarget,
  options: RampOptions = {},
): Promise<RampResult> {
  const opts = { ...DEFAULTS, ...stripUndefined(options) };
  const log = options.log ?? ((): void => {});
  const fleet = new SyntheticFleet(target);
  const steps: RampStep[] = [];

  try {
    log(`baseline: ${opts.baselineMs} ms with zero rooms`);
    const baselineReadings = await sampleWindow(target, opts.baselineMs);
    if (baselineReadings.length === 0) throw new Error('no /health reading at baseline');
    const baselineCpu = cpuPercent(baselineReadings);
    const baseline = {
      lagMedianMs: median(baselineReadings.map((r) => r.loopLagMs)),
      cpuPercentOfCore: baselineCpu,
      rssMb: baselineReadings[baselineReadings.length - 1]!.rssMb,
    };
    const startRooms = baselineReadings[0]!.rooms;
    if (startRooms !== 0) {
      log(`WARNING: the target already hosts ${startRooms} room(s) — the baseline is not empty`);
    }
    const baselineExceedsLimit = baseline.lagMedianMs > opts.lagLimitMs;
    if (baselineExceedsLimit) {
      log(
        `WARNING: the EMPTY process already reports ${baseline.lagMedianMs.toFixed(2)} ms p99 lag, ` +
          `past the ${opts.lagLimitMs} ms line. This host's own jitter is the measurement; read the ` +
          `CPU column, not the lag column.`,
      );
    }

    let honestN: number | null = null;
    let ranOutOfRamp = true;
    let opened = 0;
    let bytesAtStepStart = 0;

    for (let n = opts.startRooms; n <= opts.maxRooms; n += opts.step) {
      log(`opening ${n - opened} room(s) → ${n}`);
      await fleet.add(n - opened);
      opened = n;

      log(`settling ${opts.settleMs} ms`);
      await new Promise((r) => setTimeout(r, opts.settleMs));
      bytesAtStepStart = fleet.binaryBytes;

      const step = await measure(fleet, target, n, opts.sampleMs, opts.lagLimitMs, baselineCpu, bytesAtStepStart);
      let recorded = step;

      if (step.breached) {
        log(`  ${n} rooms: median ${step.lagMedianMs.toFixed(2)} ms > ${opts.lagLimitMs} ms — confirming over ${opts.confirmMs} ms`);
        const confirmBytes = fleet.binaryBytes;
        const confirm = await measure(
          fleet, target, n, opts.confirmMs, opts.lagLimitMs, baselineCpu, confirmBytes,
        );
        recorded = { ...confirm, breached: true, confirmed: confirm.breached };
      }

      steps.push(recorded);
      options.onStep?.(recorded);
      log(
        `  ${n} rooms · lag median ${recorded.lagMedianMs.toFixed(2)} ms (max ${recorded.lagMaxMs.toFixed(2)}) · ` +
          `cpu ${recorded.cpuPercentOfCore === null ? 'n/a' : `${recorded.cpuPercentOfCore.toFixed(1)}%`} · ` +
          `live ${recorded.liveRooms}/${n}`,
      );

      if (recorded.failures.length > 0) {
        log(`  ${recorded.failures.length} room(s) stopped generating load — this step is not a clean reading`);
        for (const failure of recorded.failures.slice(0, 5)) log(`    ${failure}`);
      }

      if (recorded.confirmed === true) {
        ranOutOfRamp = false;
        log(`BREACH CONFIRMED at ${n} rooms.`);
        break;
      }
      if (recorded.confirmed === false) {
        log(`  breach did not hold over the longer window — treating ${n} as passing`);
      }
      // A step only counts as capacity when it held the line AND every room in
      // it was still flying: "40 rooms at 6 ms" with six dead sockets is not 40.
      if (!recorded.breached && recorded.failures.length === 0) honestN = n;
    }

    return {
      target: target.label,
      limitMs: opts.lagLimitMs,
      options: opts,
      baseline,
      steps,
      honestN,
      ranOutOfRamp,
      baselineExceedsLimit,
    };
  } finally {
    fleet.stop();
  }
}

/** Sample one window and shape it into a step. */
async function measure(
  fleet: SyntheticFleet,
  target: CapacityTarget,
  rooms: number,
  windowMs: number,
  limitMs: number,
  baselineCpuPercent: number | null,
  bytesAtStart: number,
): Promise<RampStep> {
  const readings = await sampleWindow(target, windowMs);
  if (readings.length === 0) throw new Error(`no /health reading at ${rooms} rooms`);
  const lags = readings.map((r) => r.loopLagMs);
  const lagMedianMs = median(lags);
  const percent = cpuPercent(readings);
  const elapsed = (readings[readings.length - 1]!.at - readings[0]!.at) / 1000;
  const bytes = fleet.binaryBytes - bytesAtStart;
  return {
    rooms,
    liveRooms: fleet.live,
    lagMedianMs,
    lagMaxMs: Math.max(...lags),
    cpuPercentOfCore: percent,
    // Marginal: the empty process's floor is subtracted before the rest is
    // divided by N (see the header).
    cpuMsPerRoomPerSec:
      percent === null || baselineCpuPercent === null || rooms === 0
        ? null
        : ((percent - baselineCpuPercent) * 10) / rooms,
    rssMb: readings[readings.length - 1]!.rssMb,
    snapshotBytesPerRoomPerSec:
      elapsed > 0 && rooms > 0 ? bytes / elapsed / rooms : null,
    breached: lagMedianMs > limitMs,
    failures: fleet.failures,
    windowMs,
    samples: readings.length,
  };
}

/** `exactOptionalPropertyTypes` makes `{...defaults, ...options}` unsound when a
 *  caller passes an explicit `undefined`; drop those keys first. */
function stripUndefined(options: RampOptions): Partial<typeof DEFAULTS> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'number') out[key] = value;
  }
  return out as Partial<typeof DEFAULTS>;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Render a run as the markdown table that goes into `docs/server-capacity.md`.
 *  A run's output IS its evidence; a number quoted without the table it came
 *  from is the thing this whole brief exists to replace. */
export function renderRampMarkdown(result: RampResult): string {
  const cell = (value: number | null, digits = 2): string =>
    value === null ? '—' : value.toFixed(digits);
  const lines: string[] = [];
  lines.push(`**Target:** ${result.target}`);
  lines.push('');
  lines.push(
    `**Ramp:** start ${result.options.startRooms}, step ${result.options.step}, ceiling ` +
      `${result.options.maxRooms} · settle ${result.options.settleMs / 1000}s · sample ` +
      `${result.options.sampleMs / 1000}s · confirm ${result.options.confirmMs / 1000}s · ` +
      `safety line ${result.limitMs} ms`,
  );
  lines.push('');
  lines.push(
    `**Baseline (0 rooms):** lag ${result.baseline.lagMedianMs.toFixed(2)} ms · CPU ` +
      `${cell(result.baseline.cpuPercentOfCore, 1)}% of a core · RSS ${cell(result.baseline.rssMb, 1)} MB`,
  );
  lines.push('');
  lines.push(
    '| rooms | live | loop lag median (ms) | loop lag max (ms) | CPU (% of core) | CPU/room (ms/s) | RSS (MB) | snapshot B/s per client | verdict |',
  );
  lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const step of result.steps) {
    const verdict = step.confirmed === true
      ? '**BREACH (confirmed)**'
      : step.confirmed === false
        ? 'breach not confirmed'
        : step.failures.length > 0
          ? `not clean (${step.failures.length} dead)`
          : 'ok';
    lines.push(
      `| ${step.rooms} | ${step.liveRooms} | ${step.lagMedianMs.toFixed(2)} | ${step.lagMaxMs.toFixed(2)} | ` +
        `${cell(step.cpuPercentOfCore, 1)} | ${cell(step.cpuMsPerRoomPerSec, 2)} | ${cell(step.rssMb, 1)} | ` +
        `${cell(step.snapshotBytesPerRoomPerSec, 0)} | ${verdict} |`,
    );
  }
  lines.push('');
  if (result.baselineExceedsLimit) {
    lines.push(
      `> **The lag column on this run is not a capacity reading.** The EMPTY process already ` +
        `reported ${result.baseline.lagMedianMs.toFixed(2)} ms p99 loop lag, past the ` +
        `${result.limitMs} ms line — this host supplies its own scheduler spikes, and a p99 ` +
        `reports exactly those. Read the CPU column, which is a differenced counter and has no ` +
        `such floor, and take the room count from \`guest-model.ts\`. The lag gate belongs on a ` +
        `quiet Machine (docs/server-capacity.md, the hosted runbook).`,
    );
    lines.push('');
  }
  if (result.honestN === null && result.ranOutOfRamp) {
    lines.push(
      `**Result: no breach up to ${result.options.maxRooms} rooms.** The honest N is *at least* ` +
        `${result.options.maxRooms}; re-run with a higher \`--max\` to find it.`,
    );
  } else if (result.honestN === null) {
    lines.push('**Result: the first step already breached.** The step size is too coarse — re-run with a smaller `--start`.');
  } else {
    lines.push(
      `**Result: the honest N is ${result.honestN} rooms** — the largest step that held ` +
        `median loop lag under ${result.limitMs} ms with every room still flying.`,
    );
  }
  return lines.join('\n');
}

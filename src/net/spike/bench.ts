/**
 * src/net/spike/bench.ts — the day-0 tick-rate + bandwidth benchmark
 * (GDD §4.2 spike; risks 3 & 4).
 *
 * Steps the stand-in sim (sim-standin.ts) for 30 simulated seconds at 20, 30,
 * and 60 Hz, measuring real wall-clock cost per tick on this hardware, and
 * measures the encoded snapshot size at each rate. The sim always integrates at
 * a fixed 60 Hz internally (GDD §4.1); `hz` is the server broadcast/step rate
 * under test. Snapshots are encoded at the broadcast cadence (capped at 30 Hz —
 * clients render at 60 with interpolation, GDD §4.2).
 *
 * Pure functions returning data + a formatted report; the vitest spec
 * (spike.bench.test.ts) runs it and prints the MEASUREMENTS block that goes
 * into docs/netcode-spike.md. Reproduce: `npx vitest run src/net/spike`.
 */

import os from 'node:os';
import { createStandInSim, DEFAULT_SIM } from './sim-standin';
import { encodeSnapshot, buildWorstCaseSnapshot, WORST_CASE_BYTES } from './snapshot';

/** Frame-time cost and bandwidth at one candidate server rate. */
export interface RateResult {
  hz: number;
  /** Snapshot broadcast rate (min(hz, 30)). */
  broadcastHz: number;
  ticks: number;
  totalMs: number;
  avgTickMs: number;
  maxTickMs: number;
  /** Wall-clock budget for one tick at this rate (1000 / hz). */
  budgetMs: number;
  /** budgetMs / avgTickMs — how many real-time servers one core could run. */
  headroom: number;
  sustainable: boolean;
  /** Encoded snapshot size from live sim state at this rate, in bytes. */
  snapshotBytesLive: number;
  /** Per-client downstream at broadcastHz, worst case, bytes/second. */
  bandwidthBytesPerSecWorst: number;
}

export interface BenchResult {
  cpu: string;
  cores: number;
  node: string;
  simSeconds: number;
  worstCaseBytes: number;
  rates: RateResult[];
}

const SIM_SECONDS = 30;
const RATES = [20, 30, 60];

/** WebSocket (unmasked, server→client) + IPv4/TCP per-frame overhead estimate. */
const FRAME_OVERHEAD_BYTES = 4 /* WS header, 126–65535 payload */ + 40 /* IPv4 + TCP */;

export function runBench(seed = 0x1234abcd): BenchResult {
  const rates: RateResult[] = [];

  for (const hz of RATES) {
    const sim = createStandInSim(DEFAULT_SIM, seed);
    const broadcastHz = Math.min(hz, 30);
    const broadcastEvery = Math.max(1, Math.round(hz / broadcastHz));
    const ticks = hz * SIM_SECONDS;
    const budgetMs = 1000 / hz;

    let liveBytes = WORST_CASE_BYTES;
    let maxTickMs = 0;
    // Warm up JIT so the measurement reflects steady state, not cold code.
    for (let i = 0; i < 120; i++) sim.step();

    const t0 = performance.now();
    for (let tick = 0; tick < ticks; tick++) {
      const tickStart = performance.now();
      sim.step();
      if (tick % broadcastEvery === 0) {
        const buf = encodeSnapshot(tick, sim.snapshotShips(), sim.snapshotProjectiles());
        liveBytes = buf.byteLength;
      }
      const tickMs = performance.now() - tickStart;
      if (tickMs > maxTickMs) maxTickMs = tickMs;
    }
    const totalMs = performance.now() - t0;
    // Keep the checksum observable so the sim can't be optimized away.
    if (sim.checksum() < 0) throw new Error('unreachable');

    const avgTickMs = totalMs / ticks;
    const bandwidthWorst =
      (WORST_CASE_BYTES + FRAME_OVERHEAD_BYTES) * broadcastHz;

    rates.push({
      hz,
      broadcastHz,
      ticks,
      totalMs,
      avgTickMs,
      maxTickMs,
      budgetMs,
      headroom: budgetMs / avgTickMs,
      sustainable: avgTickMs < budgetMs,
      snapshotBytesLive: liveBytes,
      bandwidthBytesPerSecWorst: bandwidthWorst,
    });
  }

  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model.trim() ?? 'unknown',
    cores: cpus.length,
    node: process.version,
    simSeconds: SIM_SECONDS,
    worstCaseBytes: buildWorstCaseSnapshot().byteLength,
    rates,
  };
}

/** Render a BenchResult as the plain-text MEASUREMENTS block for the doc. */
export function formatReport(r: BenchResult): string {
  const kb = (b: number): string => (b / 1024).toFixed(1);
  const lines: string[] = [];
  lines.push(`host CPU        : ${r.cpu} (${r.cores} logical cores)`);
  lines.push(`node           : ${r.node}`);
  lines.push(`sim duration   : ${r.simSeconds}s simulated per rate`);
  lines.push(`worst-case snap: ${r.worstCaseBytes} bytes (8 ships + 64 projectiles)`);
  lines.push('');
  lines.push(
    'rate  broadcast  avg tick  max tick  budget  headroom  sustain  snap(live)  BW worst',
  );
  for (const x of r.rates) {
    lines.push(
      [
        `${x.hz}Hz`.padEnd(5),
        `${x.broadcastHz}Hz`.padEnd(9),
        `${x.avgTickMs.toFixed(4)}ms`.padEnd(9),
        `${x.maxTickMs.toFixed(3)}ms`.padEnd(9),
        `${x.budgetMs.toFixed(2)}ms`.padEnd(7),
        `${x.headroom.toFixed(0)}×`.padEnd(9),
        `${x.sustainable ? 'YES' : 'NO'}`.padEnd(8),
        `${x.snapshotBytesLive}B`.padEnd(11),
        `${kb(x.bandwidthBytesPerSecWorst)}KB/s`,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

/**
 * tests/net/latency-feel.test.ts — the M10 acceptance gate. OWNER: Netcode
 * Engineer (netcode audit item 3; GDD §4.2).
 *
 * *"ACCEPTANCE — 'meant to work on slower connections': the latency harness runs
 * the full 2-client match at 150 ms and 250 ms with ±30 ms jitter and 2 % loss;
 * correction-magnitude and visual-snap counters stay under named thresholds
 * (tunables, stated in the audit doc). These runs are CI, permanent."*
 *
 * The thresholds are the named constants below and nowhere else — the audit doc
 * quotes them, this file enforces them, and moving one is a visible diff on a
 * number with a paragraph attached rather than a quiet edit to an assertion.
 *
 * Everything under the wire is shipping code (`./latency-harness`): the real
 * server, the real sessions, real prediction and reconciliation, the real
 * presentation layer. The clock is virtual, so these runs are deterministic and
 * take milliseconds — which is what makes a *feel* threshold safe to gate CI on.
 */

import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_MS, MAX_DELAY_MS, MIN_DELAY_MS } from '../../src/net/interpolation';
import { MAX_LEAD_TICKS, SNAP_THRESHOLD } from '../../src/net/prediction';
import { runLatencyMatch } from './latency-harness';
import type { LatencyMatchResult, WireProfile } from './latency-harness';

// ---------------------------------------------------------------------------
// The named thresholds (docs/netcode-audit.md §5)
// ---------------------------------------------------------------------------

/**
 * **Worst correction, world units.** The ceiling on a single reconcile's
 * disagreement between prediction and authority, anywhere in the run.
 *
 * The wire quantizes position to whole units, so a *perfect* prediction still
 * reconciles by up to ~1.4 u (√2, both axes rounding the wrong way). Four is that
 * with room for the tick of divergence a dropped input costs, and it is far under
 * {@link SNAP_THRESHOLD} — which is the point: everything under the snap threshold
 * is *blended out over ~100 ms and never seen*. A run that clears this is a run
 * where the client and the server genuinely disagreed about the physics.
 */
export const MAX_CORRECTION_UNITS = 4;

/**
 * **Mean correction, world units.** The typical reconcile, which is what "feel"
 * actually is — one bad frame is not a bad match, a bad average is. At the wire's
 * quantization floor this sits near 0.5 u.
 */
export const MAX_MEAN_CORRECTION_UNITS = 1.5;

/**
 * **Visual snaps.** Corrections large enough that the ship teleported instead of
 * blending — the event a player calls "server rollback". Zero is the threshold and
 * it is deliberately zero: at these latencies, in normal flight, there is nothing
 * a snap could be except a bug. (A respawn or a reclaim also snaps, correctly; the
 * gate's flight plan contains neither.)
 */
export const MAX_VISUAL_SNAPS = 0;

/**
 * **Mean lead, in ticks.** How far ahead of its newest snapshot the client runs on
 * average — the input latency the player pays on their own trigger, over and above
 * the wire.
 *
 * The steady-state budget is {@link MAX_LEAD_TICKS} (24), and the mean sits a
 * little above it on a lossy wire for an honest reason: while a retransmit stalls
 * the snapshot stream, the client is *correctly* far ahead of a frame that is
 * simply old, and no reconcile happens to trim it. So the threshold is the budget
 * plus a stall allowance — 32 ticks, ~530 ms. This is the ratchet regression test,
 * and the number it guards against is specific: before the lead budget existed the
 * mean settled at **33 ticks at 150 ms and 59 at 250 ms** and stayed there for the
 * rest of the match. It is now 18–21 and 26.
 */
export const MAX_MEAN_LEAD_TICKS = 32;

/** The same bound for the deliberately brutal 20 %-loss run, where the client
 *  spends much of the match legitimately far ahead of a stalled snapshot stream.
 *  Named apart so the ordinary gate above stays tight. */
export const MAX_MEAN_LEAD_TICKS_LOSSY = 40;

/**
 * **Worst lead, in ticks.** A stall legitimately leaves the client a long way past
 * its newest snapshot, so this is the far looser bound that only a genuine runaway
 * would clear — two seconds of ticks.
 */
export const MAX_PEAK_LEAD_TICKS = 120;

/**
 * **Misprediction rate.** The fraction of reconciles that cleared the ~1-unit
 * quantization floor. Some is inevitable on a lossy wire — a dropped input is a
 * tick the client simulated and the server did not — but a *majority* would mean
 * the two sims are not running the same physics.
 */
export const MAX_MISPREDICTION_RATE = 0.5;

// ---------------------------------------------------------------------------
// The profiles
// ---------------------------------------------------------------------------

/** The developer's own condition: a gru client on the iad fleet. */
const AT_150: WireProfile = { rttMs: 150, jitterMs: 30, lossRate: 0.02 };
/** "Slower connections", named in the brief: a worse route, or mobile data. */
const AT_250: WireProfile = { rttMs: 250, jitterMs: 30, lossRate: 0.02 };
/** The control: a clean local wire, where nothing may be wrong at all. */
const AT_0: WireProfile = { rttMs: 0, jitterMs: 0, lossRate: 0 };

/** Twenty seconds of two-client flight — long enough for stalls to happen, the
 *  jitter buffer to re-size, and the lead to settle wherever it settles. */
const FRAMES = 20 * 60;

interface Feel {
  worstCorrection: number;
  meanCorrection: number;
  snaps: number;
  mispredictionRate: number;
  meanLead: number;
  peakLead: number;
  reconciles: number;
  jitterMs: number | null;
  rttMs: number | null;
  bufferMs: number;
  /** Mean input-tick misalignment over the run, in ticks, or null when nothing
   *  could be measured (`src/net/telemetry` `appliedDeltaMean`). */
  meanAlignment: number | null;
  /** Worst input-tick misalignment over the run, in ticks. */
  peakAlignment: number;
}

function feelOf(result: LatencyMatchResult, index: number): Feel {
  const client = result.clients[index]!;
  const samples = client.telemetry.samples;
  const reconciles = samples.reduce((n, s) => n + s.reconciles, 0);
  const weighted = samples.reduce((n, s) => n + s.correctionMeanUnits * s.reconciles, 0);
  const mispredictions = samples.reduce((n, s) => n + s.mispredictions, 0);
  // Alignment is weighted by the reconciles that could state one, so a second
  // that measured twice does not count as much as a second that measured thirty.
  const alignN = samples.reduce((n, s) => n + s.appliedDeltaSamples, 0);
  const alignSum = samples.reduce((n, s) => n + (s.appliedDeltaMean ?? 0) * s.appliedDeltaSamples, 0);
  return {
    worstCorrection: Math.max(0, ...samples.map((s) => s.correctionMaxUnits)),
    meanCorrection: reconciles > 0 ? weighted / reconciles : 0,
    snaps: samples.reduce((n, s) => n + s.visualSnaps, 0),
    mispredictionRate: reconciles > 0 ? mispredictions / reconciles : 0,
    meanLead: reconciles > 0 ? samples.reduce((n, s) => n + s.leadMeanTicks * s.reconciles, 0) / reconciles : 0,
    peakLead: Math.max(0, ...samples.map((s) => s.leadMaxTicks)),
    reconciles,
    jitterMs: client.telemetry.live.rttJitterMs,
    rttMs: client.telemetry.live.rttMs,
    bufferMs: client.session.interpolation?.delayMs ?? 0,
    meanAlignment: alignN > 0 ? alignSum / alignN : null,
    peakAlignment: Math.max(0, ...samples.map((s) => s.appliedDeltaMax)),
  };
}

/** The capture the audit doc quotes. Printed on every run, so a regression is
 *  readable in CI output and not only in an assertion message. */
function report(label: string, result: LatencyMatchResult): Feel[] {
  const feels = result.clients.map((_, i) => feelOf(result, i));
  const lines = feels.map(
    (f, i) =>
      `    client ${i}: corr ${f.meanCorrection.toFixed(2)}/${f.worstCorrection.toFixed(2)}u  ` +
      `mispred ${(f.mispredictionRate * 100).toFixed(0)}%  snaps ${f.snaps}  ` +
      `lead ${f.meanLead.toFixed(0)}/${f.peakLead}t  ` +
      `align ${f.meanAlignment === null ? '—' : f.meanAlignment.toFixed(2)}/${f.peakAlignment}t  ` +
      `rtt ${f.rttMs === null ? '—' : Math.round(f.rttMs)}ms  ` +
      `jitter ${f.jitterMs === null ? '—' : Math.round(f.jitterMs)}ms  ` +
      `buffer ${Math.round(f.bufferMs)}ms  (${f.reconciles} recon)`,
  );
  // eslint-disable-next-line no-console
  console.log(`\n  ${label} — ${result.stalls} retransmit stalls injected\n${lines.join('\n')}`);
  return feels;
}

function assertFeel(feels: readonly Feel[]): void {
  for (const feel of feels) {
    // A run that reconciled nothing proves nothing; guard the guard.
    expect(feel.reconciles).toBeGreaterThan(100);
    expect(feel.worstCorrection).toBeLessThan(MAX_CORRECTION_UNITS);
    expect(feel.meanCorrection).toBeLessThan(MAX_MEAN_CORRECTION_UNITS);
    expect(feel.snaps).toBeLessThanOrEqual(MAX_VISUAL_SNAPS);
    expect(feel.mispredictionRate).toBeLessThan(MAX_MISPREDICTION_RATE);
    expect(feel.meanLead).toBeLessThanOrEqual(MAX_MEAN_LEAD_TICKS);
    expect(feel.peakLead).toBeLessThanOrEqual(MAX_PEAK_LEAD_TICKS);
    // And nothing snapped: worst < SNAP_THRESHOLD is what makes every correction
    // in the run a *blended* one, which is the developer's actual ask.
    expect(feel.worstCorrection).toBeLessThan(SNAP_THRESHOLD);
  }
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('the full two-client match, at real-world latency', () => {
  it('holds its feel thresholds at 150 ms RTT, ±30 ms jitter, 2 % loss', () => {
    const result = runLatencyMatch({ profile: AT_150, frames: FRAMES });
    // The wire the test claims to have tested: loss must actually have bitten.
    expect(result.stalls).toBeGreaterThan(0);
    assertFeel(report('150 ms ±30 ms, 2 % loss', result));
  });

  it('holds them on a slower connection: 250 ms RTT, ±30 ms jitter, 2 % loss', () => {
    const result = runLatencyMatch({ profile: AT_250, frames: FRAMES });
    expect(result.stalls).toBeGreaterThan(0);
    assertFeel(report('250 ms ±30 ms, 2 % loss', result));
  });

  it('is quiet on a clean wire — 0 ms, no jitter, no loss', () => {
    const result = runLatencyMatch({ profile: AT_0, frames: FRAMES });
    expect(result.stalls).toBe(0);
    const feels = report('0 ms, clean', result);
    assertFeel(feels);
    for (const feel of feels) {
      // With no wire between them the two sims must agree to the quantization
      // floor, and the client must not be running meaningfully ahead of anything.
      expect(feel.meanCorrection).toBeLessThan(1);
      expect(feel.meanLead).toBeLessThanOrEqual(6);
    }
  });
});

describe('the jitter buffer sizes itself from what it measured', () => {
  it('opens smaller on a clean wire than on a jittery one, and never leaves its range', () => {
    const clean = runLatencyMatch({ profile: { rttMs: 40, jitterMs: 0, lossRate: 0 }, frames: FRAMES });
    const rough = runLatencyMatch({ profile: { rttMs: 150, jitterMs: 60, lossRate: 0.02 }, frames: FRAMES });

    const cleanMs = clean.clients[0]!.session.interpolation!.delayMs;
    const roughMs = rough.clients[0]!.session.interpolation!.delayMs;
    // eslint-disable-next-line no-console
    console.log(`\n  jitter buffer: clean wire ${Math.round(cleanMs)}ms · jittery wire ${Math.round(roughMs)}ms`);

    // The whole point of item 2d: this is a measurement, not a constant. A clean
    // client stops paying the standard 100 ms; a jittery one is allowed past it.
    expect(cleanMs).toBeLessThan(INTERP_DELAY_MS);
    expect(roughMs).toBeGreaterThan(cleanMs);
    for (const ms of [cleanMs, roughMs]) {
      expect(ms).toBeGreaterThanOrEqual(MIN_DELAY_MS);
      expect(ms).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
  });
});

describe('the lead does not ratchet', () => {
  it('comes back down after a burst of retransmit stalls', () => {
    // Ten times the loss rate, so the stalls are relentless — then measure where
    // the client's clock ended up. Before the lead budget this run settled at 59
    // ticks (~1 s of input latency) and stayed there for the rest of the match.
    const result = runLatencyMatch({
      profile: { rttMs: 250, jitterMs: 30, lossRate: 0.2 },
      frames: FRAMES,
    });
    expect(result.stalls).toBeGreaterThan(50);
    for (const client of result.clients) {
      const samples = client.telemetry.samples;
      const recon = samples.reduce((n, s) => n + s.reconciles, 0);
      const mean = samples.reduce((n, s) => n + s.leadMeanTicks * s.reconciles, 0) / recon;
      // eslint-disable-next-line no-console
      console.log(`    20 % loss: mean lead ${mean.toFixed(1)}t, budget ${client.session.prediction!.leadBudget}t`);
      expect(mean).toBeLessThanOrEqual(MAX_MEAN_LEAD_TICKS_LOSSY);
    }
  });
});

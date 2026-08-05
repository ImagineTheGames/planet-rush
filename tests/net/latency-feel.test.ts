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
import type { HarnessClient, LatencyMatchResult, WireProfile } from './latency-harness';
import { netBudget } from './budgets';

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
/**
 * The developer's own reported condition for the constant-correction gate below: a
 * slow, jittery, but **loss-free** wire. Their capture had no resyncs, no snaps, and
 * a lead that simply tracked RTT — the signature of a link that is far away rather
 * than broken — and it still corrected on every single sampled second. That is the
 * run this gate holds at zero.
 */
const STEADY_250: WireProfile = { rttMs: 250, jitterMs: 30, lossRate: 0 };

/** Twenty seconds of two-client flight — long enough for stalls to happen, the
 *  jitter buffer to re-size, and the lead to settle wherever it settles. */
const FRAMES = 20 * 60;

/** Ten seconds of straight-line flight — long enough for the lead to settle and
 *  for ~300 reconciles, short enough that a ship crossing the arena at top speed
 *  never reaches the far wall (which would stop it, and a stopped ship proves
 *  nothing about prediction). */
const STRAIGHT_FRAMES = 10 * 60;

/**
 * **Mean correction in steady straight-line flight, world units.** The gate the M10
 * tick-alignment brief asks for: *"steady-state corr in straight-line flight is ~0
 * at 250 ms"*.
 *
 * "~0" is the wire's own precision and nothing else. Positions stream as eighths of
 * a unit (`src/net/snapshot` `POS_SCALE`), so a *perfect* prediction still
 * reconciles by up to 1/16 u per axis — a mean of ~0.05 u in two. This is that with
 * room for the odd tick of jitter, and it is 10× under what the developer measured
 * (0.3–0.6 u) and 20× under the wire's *old* floor. A regression to whole-unit
 * streaming, or to input the server files somewhere other than where the client
 * predicted it, lands well over this line.
 */
export const STEADY_CORRECTION_UNITS = 0.15;

/** **Worst correction in steady straight-line flight, world units.** The developer's
 *  `corrMax ~1.0-1.2` line: not one reconcile in the run may reach a quarter of a
 *  unit, let alone a whole one. */
export const STEADY_PEAK_CORRECTION_UNITS = 0.25;

/** **Mean input-tick misalignment in steady flight, ticks.** Zero is the honest
 *  answer and what the run actually reports; the allowance is for a jitter draw
 *  landing one input a tick late, which costs a correction far under the line
 *  above (`src/net/telemetry` `appliedDeltaMean`). */
export const STEADY_ALIGNMENT_TICKS = 0.5;

/** **Worst input-tick misalignment in steady flight, ticks.** A tick or two of
 *  jitter is a wire; anything more is authority filing input somewhere the client
 *  never predicted it, which is the whole subject of this gate. */
export const STEADY_PEAK_ALIGNMENT_TICKS = 2;

/** How far off the arena centre each ship's straight line passes, world units —
 *  wide enough that the two never touch at the crossing (ship radius is ~16). */
const LANE_OFFSET = 250;

/** The speed a gate ship must still be carrying at the end of the run, u/s: proof
 *  it flew the whole way instead of stopping against something. */
const FLYING_SPEED = 50;

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

/**
 * @param skipSeconds finalized seconds to drop from the front of the window — the
 *   *steady state* rather than the join. The opening second of a match is the
 *   client establishing its clock against a server already running (a resync or
 *   two, a lead climbing from nothing), which is real but is not what "constant
 *   correction in flight" means.
 */
function feelOf(result: LatencyMatchResult, index: number, skipSeconds = 0): Feel {
  const client = result.clients[index]!;
  const samples = client.telemetry.samples.slice(skipSeconds);
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
function report(label: string, result: LatencyMatchResult, skipSeconds = 0): Feel[] {
  const feels = result.clients.map((_, i) => feelOf(result, i, skipSeconds));
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
  }, netBudget({
    work: 'one scripted two-client match at 150 ms, ±30 ms jitter, 2 % loss → assert every feel threshold',
    measuredSeconds: 2.8,
  }));

  it('holds them on a slower connection: 250 ms RTT, ±30 ms jitter, 2 % loss', () => {
    const result = runLatencyMatch({ profile: AT_250, frames: FRAMES });
    expect(result.stalls).toBeGreaterThan(0);
    assertFeel(report('250 ms ±30 ms, 2 % loss', result));
  }, netBudget({
    work: 'one scripted two-client match at 250 ms, ±30 ms jitter, 2 % loss → assert every feel threshold',
    measuredSeconds: 2.0,
  }));

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
  }, netBudget({
    work: 'one scripted two-client match on a 0 ms wire → assert the feel thresholds and that nothing stalled',
    measuredSeconds: 0.6,
  }));
});

describe('the constant correction', () => {
  it('is gone: straight-line flight at 250 ms reconciles to nothing', () => {
    // ── THE M10 TICK-ALIGNMENT GATE ──
    //
    // The developer's report: *"corr 0.3-0.6u with corrMax ~1.0-1.2 nearly EVERY
    // sampled second in flight"* at ~250 ms, on a connection with no resyncs and no
    // snaps — a *constant* correction, which is a systematic cause rather than a
    // stochastic one. This is that condition reproduced, and then held: a slow,
    // jittery, loss-free wire, and the plainest flight there is.
    //
    // Straight-line flight is the case where prediction should be *exactly* right —
    // one stick, no direction changes, a client and a server running the same
    // integrator on the same inputs at the same ticks — so every unit of correction
    // in it is a defect. There were two, in order of size: the wire rounding
    // positions to whole units (`src/net/snapshot` `POS_SCALE`), and authority
    // filing input somewhere other than where the client predicted it
    // (`src/net/input-queue` `coalesce`, `server/room.ts` `heldIntent`, and the
    // client stamping its true tick again — `src/net/session` `sendInput`).
    //
    // Before them: **corr 0.50/1.26 u, every second, forever.** This gate is what
    // makes a return to that red.
    const clients: HarnessClient[] = [];
    const heading: { x: number; y: number }[] = [];
    const result = runLatencyMatch({
      profile: STEADY_250,
      frames: STRAIGHT_FRAMES,
      // An empty board. A rock is a discontinuity — a graze resolves differently on
      // either side of an eighth of a unit — and this gate is about the smooth case,
      // which is the one the developer flew and the one a defect cannot hide in.
      asteroidCount: 0,
      input: (client) => {
        const dir = heading[client] ?? { x: 1, y: 0 };
        return [
          { type: 'thrust', dir },
          { type: 'aim', dir },
        ];
      },
      onFrame: (frame, cs) => {
        if (frame !== 1) return;
        clients.push(...cs);
        for (const c of cs) {
          const ship = c.world?.ships.find((s) => s.id === c.you);
          if (!ship) continue;
          // Each ship flies from its spawn across the middle of the board — the
          // longest straight run available — down its own lane, so the two pass
          // each other rather than meeting head-on (a collision is a discontinuity
          // for the same reason a rock is).
          const lane = c.you === 0 ? LANE_OFFSET : -LANE_OFFSET;
          const dx = c.world!.bounds.width / 2 - ship.pos.x;
          const dy = c.world!.bounds.height / 2 + lane - ship.pos.y;
          const len = Math.hypot(dx, dy) || 1;
          heading[c.you] = { x: dx / len, y: dy / len };
        }
      },
    });

    expect(result.stalls).toBe(0); // the wire under test really is loss-free
    // The first second is the join — the client's clock arriving at a server
    // already running — and steady state is what the report is about.
    const feels = report('250 ms ±30 ms, no loss — straight-line flight', result, 1);

    for (const feel of feels) {
      expect(feel.reconciles).toBeGreaterThan(100);
      // **The gate.** A steady-state correction at the wire's own precision floor,
      // and nothing above it.
      expect(feel.meanCorrection).toBeLessThan(STEADY_CORRECTION_UNITS);
      // Not one reconcile in five seconds of flight reaches a quarter of a unit —
      // the "corrMax ~1.0-1.2" half of the report, answered.
      expect(feel.worstCorrection).toBeLessThan(STEADY_PEAK_CORRECTION_UNITS);
      expect(feel.mispredictionRate).toBe(0);
      expect(feel.snaps).toBe(0);
      // And the *reason* it is this low is stated rather than hoped for: authority
      // ran this client's input at the tick the client predicted it at, all but
      // exactly (the M10 instrument — `src/net/telemetry` `appliedDeltaMean`).
      expect(feel.meanAlignment).toBeLessThan(STEADY_ALIGNMENT_TICKS);
      expect(feel.peakAlignment).toBeLessThanOrEqual(STEADY_PEAK_ALIGNMENT_TICKS);
    }

    // Nothing the player pressed was thrown away, on a wire or in a queue.
    expect(result.droppedInputs).toBe(0);

    // The flight guards: a ship that stopped — into a wall, into the other ship —
    // would reconcile perfectly and prove nothing, so the run must have been a real
    // flight from end to end.
    for (const client of clients) {
      const ship = client.world!.ships.find((s) => s.id === client.you)!;
      expect(Math.hypot(ship.vel.x, ship.vel.y)).toBeGreaterThan(FLYING_SPEED);
    }
  }, netBudget({
    work: 'one scripted 250 ms match of straight-line flight on an empty board → assert the constant correction is at the wire\'s precision floor',
    measuredSeconds: 0.5,
  }));
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
  }, netBudget({
    work: 'two scripted matches, clean and jittery → assert the jitter buffer sized itself from what it measured',
    measuredSeconds: 1.8,
  }));
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
  }, netBudget({
    work: 'one scripted match at 250 ms with 20 % loss → assert the lead comes back down instead of ratcheting',
    measuredSeconds: 1.4,
  }));
});

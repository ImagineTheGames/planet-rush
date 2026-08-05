/**
 * src/net/telemetry.test.ts — the reconciliation netgraph's data source
 * (`./telemetry`, M10 reconcile-feel brief).
 *
 * The instrument earns its keep only if the three numbers it reports are the
 * real ones: RTT measured from a real send→ack round trip (not a constant),
 * misprediction rate keyed to the wire's quantization floor, and correction
 * magnitude aggregated per wall-clock second exactly as the brief specifies.
 * Every clock reading is passed in, so each of these is asserted against an exact
 * expected value rather than a tolerance.
 */

import { describe, expect, it } from 'vitest';
import { MISPREDICTION_UNITS, NetTelemetry } from './telemetry';

/** A correct prediction: correction under the quantization floor, no resync. */
const OK = { error: 0.3, resynced: false };

describe('NetTelemetry — RTT', () => {
  it('measures the round trip from an input send to the snapshot that acks it', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordInput(2, 1016);

    // The snapshot that first acks seq 2 arrives at 1150 — a 134 ms round trip
    // for that input (from its own send at 1016), not seq 1's.
    t.recordReconcile(OK, 2, 1150);
    expect(t.live.rttMs).toBe(134);

    // Roll into the next wall-clock second to finalize the sample.
    t.recordReconcile(OK, 2, 2000);
    expect(t.samples[0]!.rttMeanMs).toBe(134);
    expect(t.samples[0]!.rttMaxMs).toBe(134);
  });

  it('retires acked sends and does not double-count a repeated ack', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordInput(2, 1010);
    t.recordInput(3, 1020);

    t.recordReconcile(OK, 2, 1100); // acks 1 and 2, times seq 2 → 90 ms
    expect(t.live.rttMs).toBe(90);

    // The next snapshot repeats ack 2 (server ran nothing new): seq 2's send was
    // already retired, so there is no round trip to measure and the last stays put.
    t.recordReconcile(OK, 2, 1200);
    expect(t.live.rttMs).toBe(90);

    t.recordReconcile(OK, 3, 1300); // now seq 3 is acked → 280 ms
    expect(t.live.rttMs).toBe(280);
  });

  it('reports null RTT for a window whose acks named no timed send', () => {
    const t = new NetTelemetry();
    // A reconcile whose ack matches nothing recorded (e.g. before any send was
    // seen) contributes no RTT.
    t.recordReconcile(OK, 5, 1500);
    t.recordReconcile(OK, 5, 2500); // roll
    expect(t.samples[0]!.rttMeanMs).toBeNull();
    expect(t.samples[0]!.rttMaxMs).toBeNull();
  });
});

describe('NetTelemetry — hudRttMs, the number shown to the player', () => {
  it('IS the number the session log prints: the last finalized second mean, not\n' +
    '     the last single round trip (ratified: "the session log already samples\n' +
    '     it; show the same number")', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordInput(2, 1100);
    t.recordReconcile(OK, 1, 1100); // 100 ms
    t.recordReconcile(OK, 2, 1300); // 200 ms
    // Roll the second: the sample's mean is 150, while the last trip was 200.
    t.recordInput(3, 2000);
    t.recordReconcile(OK, 3, 2050);

    expect(t.samples[0]!.rttMeanMs).toBe(150);
    expect(t.hudRttMs).toBe(150);
    // The live sub-second value is a different, jitterier truth — and is exactly
    // what the corner must NOT be reading, or it would flicker every frame.
    expect(t.live.rttMs).toBe(50);
  });

  it('shows the live reading before the first second has rolled, so a fresh match\n' +
    '     is not a blank corner', () => {
    const t = new NetTelemetry();
    expect(t.hudRttMs).toBeNull();
    t.recordInput(1, 1000);
    t.recordReconcile(OK, 1, 1080);
    expect(t.hudRttMs).toBe(80);
  });

  it('falls back to the live reading when a finalized second measured no round\n' +
    '     trip at all', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordReconcile(OK, 1, 1090); // 90 ms, but in the second that is about to roll
    t.recordReconcile(OK, 9, 2000); // rolls; the new second's ack times nothing
    t.recordReconcile(OK, 9, 3000); // rolls again: a sample with a null mean
    expect(t.samples[1]!.rttMeanMs).toBeNull();
    expect(t.hudRttMs).toBe(90);
  });

  it('reports nothing offline — no send, no ack, no number', () => {
    expect(new NetTelemetry().hudRttMs).toBeNull();
  });
});

describe('NetTelemetry — misprediction rate & correction', () => {
  it('counts a correction over the quantization floor as a misprediction', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordInput(2, 1000);
    t.recordInput(3, 1000);
    t.recordInput(4, 1000);

    // Three reconciles inside one second: two at the floor, one a real divergence.
    t.recordReconcile({ error: 0.5, resynced: false }, 1, 1100);
    t.recordReconcile({ error: MISPREDICTION_UNITS + 4, resynced: false }, 2, 1200);
    t.recordReconcile({ error: 0.2, resynced: false }, 3, 1300);
    // Roll into the next second.
    t.recordReconcile(OK, 4, 2000);

    const s = t.samples[0]!;
    expect(s.reconciles).toBe(3);
    expect(s.mispredictions).toBe(1);
    expect(s.mispredictionRate).toBeCloseTo(1 / 3, 6);
    expect(s.correctionMaxUnits).toBeCloseTo(MISPREDICTION_UNITS + 4, 6);
    expect(s.correctionMeanUnits).toBeCloseTo((0.5 + (MISPREDICTION_UNITS + 4) + 0.2) / 3, 6);
  });

  it('does not count a correction exactly at the floor', () => {
    const t = new NetTelemetry();
    t.recordReconcile({ error: MISPREDICTION_UNITS, resynced: false }, 0, 1000);
    t.recordReconcile(OK, 0, 2000); // roll
    expect(t.samples[0]!.mispredictions).toBe(0);
  });

  it('counts resyncs', () => {
    const t = new NetTelemetry();
    t.recordReconcile({ error: 800, resynced: true }, 0, 1000);
    t.recordReconcile(OK, 0, 2000); // roll
    expect(t.samples[0]!.resyncs).toBe(1);
  });
});

describe('NetTelemetry — per-second bucketing', () => {
  it('folds events in the same wall-clock second into one sample', () => {
    const t = new NetTelemetry();
    t.recordReconcile(OK, 0, 1000);
    t.recordReconcile(OK, 0, 1500);
    t.recordReconcile(OK, 0, 1999);
    expect(t.samples).toHaveLength(0); // second not yet closed
    t.recordReconcile(OK, 0, 2000); // crosses into the next second
    expect(t.samples).toHaveLength(1);
    expect(t.samples[0]!.reconciles).toBe(3);
    expect(t.samples[0]!.atMs).toBe(1000);
  });

  it('does not emit empty samples across an idle gap', () => {
    const t = new NetTelemetry();
    t.recordReconcile(OK, 0, 1000);
    // A five-second gap with no reconciles, then one event: the open bucket is
    // closed exactly once, and no empty seconds are invented in between.
    t.recordReconcile(OK, 0, 6000);
    expect(t.samples).toHaveLength(1);
    expect(t.samples[0]!.atMs).toBe(1000);
  });

  it('caps history at the configured size', () => {
    const t = new NetTelemetry({ historySize: 3 });
    for (let s = 0; s < 6; s++) {
      // One reconcile per second, each in its own bucket.
      t.recordReconcile(OK, 0, 1000 + s * 1000);
    }
    // Six seconds started, five closed; only the last three are retained.
    expect(t.samples.length).toBe(3);
    expect(t.samples[0]!.atMs).toBe(3000);
  });

  /**
   * The first finalized "second" is a FRAGMENT, and a fragment can be incomplete.
   *
   * Buckets are keyed on `floor(now / SAMPLE_INTERVAL_MS)`, so the first one a
   * session ever closes covers only however much of a wall-clock second was left
   * when it joined — a millisecond, if it joined at .999. That sample is real and
   * it is finalized, but the numbers in it are whatever happened to land inside the
   * fragment, and `rttMeanMs` in particular is null unless a reconcile in there
   * acknowledged an input this client still had a send time for.
   *
   * This is not a curiosity: n4-01 held `main` red on it. `tests/net/playtest-log-
   * online.test.ts` waited for a telemetry sample to *exist* and then asserted its
   * `rtt` was populated, so on a phase where the opening fragment was short the
   * assertion raced the sample's own population. Reproduced there at 1 run in 20,
   * and every run once the phase is forced. Pinned here so the shape the fix is
   * written around cannot change silently underneath it.
   */
  it('finalizes an opening FRAGMENT of a second with a null RTT — a real sample, incomplete', () => {
    const t = new NetTelemetry();
    // Joined at .999: the opening bucket is one millisecond wide. A reconcile lands
    // in it whose ack names an input this client has no send time for — a stale ack,
    // an input already retired, or simply the first snapshot after a join.
    t.recordReconcile(OK, 7, 1999);
    // …and the next event crosses the boundary, closing that fragment.
    t.recordReconcile(OK, 7, 2000);

    const fragment = t.samples[0]!;
    expect(fragment.atMs).toBe(1000);
    // Finalized, and not empty — which is exactly why "a sample exists" is not the
    // same question as "a sample is complete".
    expect(fragment.reconciles).toBe(1);
    expect(fragment.rttMeanMs).toBeNull();
    expect(fragment.rttMaxMs).toBeNull();

    // And the implication the e2e assertion leans on, stated once: an rtt is only
    // ever recorded from inside `recordReconcile`, which has already counted the
    // reconcile — so a sample WITH a round trip always has `reconciles > 0`.
    t.recordInput(9, 2100);
    t.recordReconcile(OK, 9, 2150);
    t.recordReconcile(OK, 9, 3000); // close the second
    const complete = t.samples[1]!;
    expect(complete.rttMeanMs).toBe(50);
    expect(complete.reconciles).toBeGreaterThan(0);
  });
});

describe('NetTelemetry — dump', () => {
  it('says so plainly before any samples exist', () => {
    expect(new NetTelemetry().format()).toContain('no samples');
  });

  it('formats a capture with a per-second body and a summary line', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordReconcile({ error: 0.4, resynced: false }, 1, 1100); // rtt 100
    t.recordInput(2, 2000);
    t.recordReconcile({ error: 6, resynced: false }, 2, 2100); // rtt 100, a misprediction
    t.recordReconcile(OK, 2, 3000); // roll the second sample closed

    const dump = t.format();
    expect(dump).toContain('net telemetry');
    expect(dump).toContain('rtt');
    expect(dump).toContain('mispred');
    expect(dump).toContain('summary');
    // Two seconds' worth of body lines plus a header and a summary.
    expect(dump.split('\n').length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// The audit's additions (M10, docs/netcode-audit.md)
// ---------------------------------------------------------------------------

describe('RTT variance', () => {
  it('opens on the second measurement and tracks how much the wire wanders', () => {
    const telemetry = new NetTelemetry();
    // A steady wire: every round trip the same, so the variance is zero.
    for (let i = 1; i <= 6; i++) {
      telemetry.recordInput(i, i * 100);
      telemetry.recordReconcile({ error: 0, resynced: false }, i, i * 100 + 150);
    }
    expect(telemetry.live.rttJitterMs).toBe(0);

    // A wobbling one: alternating round trips, so the estimate climbs.
    for (let i = 7; i <= 40; i++) {
      telemetry.recordInput(i, i * 100);
      telemetry.recordReconcile({ error: 0, resynced: false }, i, i * 100 + (i % 2 === 0 ? 100 : 200));
    }
    expect(telemetry.live.rttJitterMs).toBeGreaterThan(20);
  });

  it('reports null before there are two round trips to compare', () => {
    const telemetry = new NetTelemetry();
    expect(telemetry.live.rttJitterMs).toBeNull();
    telemetry.recordInput(1, 0);
    telemetry.recordReconcile({ error: 0, resynced: false }, 1, 150);
    expect(telemetry.live.rttJitterMs).toBeNull();
  });
});

describe('input-tick alignment', () => {
  it('averages only the reconciles that could state a delta, and keeps the worst', () => {
    const t = new NetTelemetry();
    // Two measured misalignments and one reconcile that had nothing to compare —
    // an ack for input already retired. The unmeasurable one must not be averaged
    // in as a zero, or a stalled second reads as a well-aligned one.
    t.recordReconcile({ ...OK, appliedDelta: 2 }, 1, 1000);
    t.recordReconcile({ ...OK, appliedDelta: null }, 2, 1010);
    t.recordReconcile({ ...OK, appliedDelta: 6 }, 3, 1020);
    t.recordReconcile(OK, 4, 2000); // rolls the second

    const sample = t.samples[0]!;
    expect(sample.reconciles).toBe(3);
    expect(sample.appliedDeltaSamples).toBe(2);
    expect(sample.appliedDeltaMean).toBe(4);
    expect(sample.appliedDeltaMax).toBe(6);
  });

  it('reports null for a second in which nothing could be measured', () => {
    const t = new NetTelemetry();
    t.recordReconcile(OK, 1, 1000);
    t.recordReconcile(OK, 2, 2000);

    expect(t.samples[0]!.appliedDeltaMean).toBeNull();
    expect(t.samples[0]!.appliedDeltaSamples).toBe(0);
    expect(t.samples[0]!.appliedDeltaMax).toBe(0);
  });

  it('puts the alignment in the dump, because that is where it gets read', () => {
    const t = new NetTelemetry();
    t.recordReconcile({ ...OK, appliedDelta: 3 }, 1, 1000);
    t.recordReconcile(OK, 2, 2000);
    expect(t.format()).toContain('align');
  });
});

describe('the RTT floor', () => {
  it('is the least round trip recently seen, not the mean — the wire without our own queue', () => {
    const telemetry = new NetTelemetry();
    const trips = [400, 380, 160, 420, 390];
    trips.forEach((rtt, i) => {
      const seq = i + 1;
      telemetry.recordInput(seq, seq * 100);
      telemetry.recordReconcile({ error: 0, resynced: false }, seq, seq * 100 + rtt);
    });
    expect(telemetry.live.rttFloorMs).toBe(160);
  });

  it('is null before anything has been measured', () => {
    expect(new NetTelemetry().live.rttFloorMs).toBeNull();
  });
});

describe('the visual-snap counter', () => {
  it('counts teleports apart from magnitude — a blended correction is not one', () => {
    const telemetry = new NetTelemetry();
    telemetry.recordReconcile({ error: 2, resynced: false, snapped: false }, 1, 1_000);
    telemetry.recordReconcile({ error: 300, resynced: false, snapped: true }, 2, 1_100);
    telemetry.recordReconcile({ error: 1, resynced: false }, 3, 1_200);
    // Roll the second so the bucket finalizes.
    telemetry.recordReconcile({ error: 0, resynced: false }, 4, 2_100);

    const sample = telemetry.samples[0]!;
    expect(sample.reconciles).toBe(3);
    expect(sample.visualSnaps).toBe(1);
  });
});

describe('the lead', () => {
  it('records how far ahead of authority each reconcile left the client', () => {
    const telemetry = new NetTelemetry();
    telemetry.recordReconcile({ error: 0, resynced: false, lead: 10 }, 1, 1_000);
    telemetry.recordReconcile({ error: 0, resynced: false, lead: 30 }, 2, 1_100);
    telemetry.recordReconcile({ error: 0, resynced: false, lead: 0 }, 3, 2_100);

    const sample = telemetry.samples[0]!;
    expect(sample.leadMeanTicks).toBe(20);
    expect(sample.leadMaxTicks).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// The round trip, taken apart (M10 item 6)
// ---------------------------------------------------------------------------

/**
 * *"Speedtest 24 ms, game showed 95 then 215 sustained once the match heated up."*
 *
 * The instrument's job here is to make that sentence decidable. Every clock reading
 * below is passed in, so the scenario is the developer's capture exactly: a 24 ms
 * wire, an input that waits 150 ms in the server's tick queue for the tick it was
 * stamped for, and a composite round trip of 174 ms that is the sum of the two.
 */
describe('the round trip, taken apart', () => {
  /** The capture's numbers (room RXS3). */
  const WIRE_MS = 24;
  const QUEUE_MS = 150;

  /** One second of a client at that condition: an input, its ack a queue-wait later,
   *  and a probe answered at wire speed. */
  function second(t: NetTelemetry, atMs: number): void {
    t.recordInput(1, atMs);
    t.recordPingSent(atMs, atMs);
    t.recordPong(atMs, atMs + WIRE_MS, { queueMs: QUEUE_MS, loopLagMs: 2.4 });
    t.recordReconcile(OK, 1, atMs + WIRE_MS + QUEUE_MS);
  }

  it('measures the network from the probe and the composite from the ack', () => {
    const t = new NetTelemetry();
    second(t, 1000);

    // The wire, with no game in it — the number to show a player.
    expect(t.live.networkRttMs).toBe(WIRE_MS);
    // The composite, which is that plus the queue wait. Both readings are honest;
    // only one of them is about the connection.
    expect(t.live.rttMs).toBe(WIRE_MS + QUEUE_MS);
    // And the server said where the difference went, rather than leaving it to be
    // inferred: 150 ms of tick queue on a loop that is barely late at all.
    expect(t.live.serverQueueMs).toBe(QUEUE_MS);
    expect(t.live.serverLoopLagMs).toBe(2.4);
  });

  it('keeps two floors, and only one of them is the wire', () => {
    const t = new NetTelemetry();
    for (let i = 0; i < 5; i++) second(t, 1000 + i * 1000);
    t.recordReconcile(OK, 1, 7000); // roll the last bucket

    // This is the precondition item 7's fix rests on: *the instrument separates raw
    // network from lead*. A floor taken over the composite cannot — every sample in
    // the window carries the same queue wait, so its minimum carries it too, and a
    // lead buffer sized from that number is sized from its own consequence.
    expect(t.live.networkFloorMs).toBe(WIRE_MS);
    expect(t.live.rttFloorMs).toBe(WIRE_MS + QUEUE_MS);
  });

  it('folds each stage into its own per-second field', () => {
    const t = new NetTelemetry();
    second(t, 1000);
    t.recordFrameLag(4, 1500); // one late frame on this device
    second(t, 2000);

    const s = t.samples[0]!;
    expect(s.networkMeanMs).toBe(WIRE_MS);
    expect(s.networkMinMs).toBe(WIRE_MS);
    expect(s.serverQueueMeanMs).toBe(QUEUE_MS);
    expect(s.serverLoopLagMaxMs).toBe(2.4);
    expect(s.clientLagMeanMs).toBe(4);
    expect(s.clientLagMaxMs).toBe(4);
    // The composite is still reported, unchanged — it is the one number that says how
    // late a press actually lands, which is what the feel gates are written against.
    expect(s.rttMeanMs).toBe(WIRE_MS + QUEUE_MS);
  });

  it('reports an unmeasured stage as null rather than as zero', () => {
    const t = new NetTelemetry();
    t.recordInput(1, 1000);
    t.recordReconcile(OK, 1, 1100);
    t.recordReconcile(OK, 1, 2000);

    // No probe was answered: "the network is 0 ms" is a lie a display would repeat,
    // where null is a display that shows nothing yet.
    expect(t.live.networkRttMs).toBeNull();
    expect(t.live.networkFloorMs).toBeNull();
    expect(t.samples[0]!.networkMeanMs).toBeNull();
    expect(t.samples[0]!.serverQueueMeanMs).toBeNull();
    expect(t.samples[0]!.serverLoopLagMaxMs).toBeNull();
    // The client's own scheduling is the one stage this device always knows, so it is
    // a number and not a null: nothing recorded means nothing was late.
    expect(t.samples[0]!.clientLagMeanMs).toBe(0);
  });

  it('drops a pong it has no send for, rather than timing it against the wrong one', () => {
    const t = new NetTelemetry();
    t.recordPingSent(1, 1000);
    t.recordPong(1, 1024, { queueMs: 10, loopLagMs: 1 });
    // A duplicate, or an id this client never sent: the server's own two numbers are
    // still fresh news, but there is no round trip to measure from it.
    t.recordPong(1, 1500, { queueMs: 20, loopLagMs: 3 });
    expect(t.live.networkRttMs).toBe(24);
    expect(t.live.serverQueueMs).toBe(20);
  });

  it('names all three stages in the dump', () => {
    const t = new NetTelemetry();
    second(t, 1000);
    second(t, 2000);
    const dump = t.format();
    expect(dump).toContain('net ');
    expect(dump).toContain('srv ');
    expect(dump).toContain('cli ');
  });
});

/**
 * src/net/telemetry.ts — what reconciliation feel is measured with.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2; M10 reconcile-feel brief).
 *
 * *"TELEMETRY FIRST: instrument the client — misprediction rate, correction
 * magnitude, and RTT, sampled per second, dumpable via `?debug=1`. We tune what
 * we measure."* (M10 brief.) This module is that instrument. It watches the two
 * events the prediction loop already produces — an input going out
 * ({@link NetTelemetry.recordInput}) and a snapshot being reconciled
 * ({@link NetTelemetry.recordReconcile}) — and turns them into three numbers a
 * player at 150 ms can read to know whether the feel is the wire or the code:
 *
 *  - **correction magnitude** — how far prediction was from authority at each
 *    reconcile ({@link ReconcileReport.error}); the thing the developer *sees* as
 *    rollback. Reported as a per-second mean and worst-case.
 *  - **misprediction rate** — the fraction of reconciles whose correction cleared
 *    the wire's ~1-unit quantization floor ({@link MISPREDICTION_UNITS}); a
 *    correct prediction lands *under* it (the same `error < 1` bar the reconcile
 *    tests hold), so a rate near zero means the code is right and any felt
 *    rollback is the picture, not the physics.
 *  - **RTT** — measured, not assumed: the wall-clock from an input leaving to the
 *    snapshot that first says the server *ran* it (its `ackSeq`). No new wire
 *    field and no server clock — the ack the reconcile loop already carries is
 *    the round-trip probe. It reads a little high by up to one broadcast interval
 *    (the ack rides the next 30 Hz snapshot) and by whatever the client's input
 *    waited in the server queue; at a healthy lead that wait is ~0, so this
 *    tracks true RTT closely enough to tune against.
 *
 * The M10 **audit** (docs/netcode-audit.md) added the two numbers the acceptance
 * gate is actually written against, because neither could be read off the three
 * above:
 *
 *  - **RTT variance** ({@link TelemetrySample.rttJitterMs}) — RFC 3550's smoothed
 *    interarrival jitter over consecutive round trips. A mean RTT says how far
 *    away the server is; only the variance says how big a jitter buffer has to be,
 *    and the buffer is now *sized from this* instead of from a constant
 *    (`./interpolation`, audit item 2d).
 *  - **visual snaps** ({@link TelemetrySample.visualSnaps}) — corrections large
 *    enough that the client teleported the ship instead of blending it. A blended
 *    correction is not felt; a snap is exactly the "server rollback" a player
 *    reports, so it is counted on its own rather than inferred from a magnitude.
 *
 * **Sampled per second, kept for two minutes.** Every event folds into an open
 * one-second bucket keyed by wall-clock; when the second rolls over the bucket is
 * finalized into a ring of {@link SAMPLE_HISTORY} {@link TelemetrySample}s. The
 * live sub-second numbers are always readable off {@link NetTelemetry.live}, and
 * {@link NetTelemetry.format} dumps the recent history as text — the "paste a real
 * capture in the PR" the brief asks for. In the shipped client the route to a
 * player is **COPY LOG**: every finalized second is copied into the playtest log
 * (`./playtest-log-attach`, docs/playtest-log.md). There is no on-screen netgraph;
 * #238's comments said there was, and the audit found otherwise.
 *
 * **No ambient clock.** Like the rest of `src/net`, the wall clock is passed in
 * (the session's injected `now`, `./session.ts`), never read from a global — so a
 * capture is reproducible and a test runs instantly.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** The bucket width: one sample per wall-clock second, as the brief specifies. */
export const SAMPLE_INTERVAL_MS = 1000;

/** Samples retained — two minutes of history, enough to cover a whole match's
 *  worth of feel in a dump without unbounded growth. */
export const SAMPLE_HISTORY = 120;

/**
 * The correction magnitude, in world units, above which a reconcile counts as a
 * genuine *misprediction* rather than wire noise. The snapshot quantizes position
 * to whole units (`./snapshot`), so a perfect prediction still reconciles by up
 * to ~1 unit; the reconcile tests treat `error < 1` as "predicted correctly", and
 * this is that same bar named once. Above it the client and server genuinely
 * disagreed about where the ship was.
 */
export const MISPREDICTION_UNITS = 1;

/** How many outstanding input timestamps to keep for the RTT match. Bounded so a
 *  connection whose acks have stalled cannot grow this without limit; sized well
 *  past the pending-input horizon (`./prediction` `MAX_PENDING_INPUTS`). */
export const SEND_RING = 256;

/**
 * Gain of the running RTT-variance estimate — RFC 3550's interarrival-jitter
 * smoothing, `J += (|D| − J) / JITTER_GAIN`, where `D` is the change between two
 * consecutive RTT measurements. Sixteen is the RTP constant and the reason to keep
 * it: it is slow enough that one late packet does not move the estimate much, and
 * fast enough that a route change is absorbed within a second or two.
 *
 * This number exists because the jitter buffer is *sized from it* rather than from
 * a constant (`./interpolation` `jitterDelayMs`, M10 audit item 2d): a client on a
 * clean wire should not pay 100 ms of interpolation delay, and a client on a
 * jittery one needs more than 100 ms.
 */
export const JITTER_GAIN = 16;

/**
 * How many finalized seconds the **RTT floor** is taken over — the minimum round
 * trip recently seen, which is the closest this instrument gets to the *wire's*
 * latency with none of the client's own queueing in it.
 *
 * The measured RTT is send→ack, and the ack cannot come until the server has run
 * the tick the input was stamped for; a client running far ahead of authority is
 * therefore measuring its own lead as if it were the network. The minimum over a
 * window is not: a sample that low is one where the input arrived just in time and
 * waited for nothing. That is the number the lead budget must be sized from
 * (`./prediction` `setLeadBudget`), or the budget chases its own tail.
 */
export const RTT_FLOOR_WINDOW = 10;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One finalized second of reconciliation feel. */
export interface TelemetrySample {
  /** Wall-clock ms at the start of the second this sample covers. */
  readonly atMs: number;
  /** Reconciles applied in the window. */
  readonly reconciles: number;
  /** Of those, how many cleared {@link MISPREDICTION_UNITS}. */
  readonly mispredictions: number;
  /** `mispredictions / reconciles`, or 0 when the window saw no reconciles. */
  readonly mispredictionRate: number;
  /** Mean correction magnitude over the window, world units. */
  readonly correctionMeanUnits: number;
  /** Worst correction in the window, world units. */
  readonly correctionMaxUnits: number;
  /** Mean measured round-trip over the window, ms, or null if none was measured. */
  readonly rttMeanMs: number | null;
  /** Worst measured round-trip in the window, ms, or null if none was measured. */
  readonly rttMaxMs: number | null;
  /** Best measured round-trip in the window, ms, or null if none was measured —
   *  the sample with the least queueing in it (see {@link RTT_FLOOR_WINDOW}). */
  readonly rttMinMs: number | null;
  /**
   * The smoothed RTT variance at the end of the window, ms — how much the wire's
   * delivery instants *wander*, which is what a jitter buffer must cover and what
   * a mean RTT cannot say. Null until two round trips have been measured. This is
   * the number `./interpolation` sizes the interpolation delay from.
   */
  readonly rttJitterMs: number | null;
  /** Mean lead over the window, ticks — how far ahead of authority the client ran.
   *  0 when the window saw no reconciles. */
  readonly leadMeanTicks: number;
  /** Worst lead in the window, ticks. The ratchet's fever chart. */
  readonly leadMaxTicks: number;
  /** Wholesale authority takeovers in the window (a reclaim, a slept tab). */
  readonly resyncs: number;
  /**
   * Corrections in the window big enough that the client **teleported** the ship
   * instead of blending (`./prediction` `SNAP_THRESHOLD`) — the visible-snap
   * counter the M10 acceptance gate is written against. A blended correction is
   * invisible; one of these is the "server rollback" a player reports.
   */
  readonly visualSnaps: number;
}

/** The always-current sub-second view, for anything sampling per frame. */
export interface TelemetryReadout {
  /** The most recent measured round-trip, ms, or null before one is measured. */
  readonly rttMs: number | null;
  /** The most recent reconcile's correction magnitude, world units. */
  readonly correctionUnits: number;
  /** Misprediction rate over the second in progress so far, [0, 1]. */
  readonly mispredictionRate: number;
  /** The live smoothed RTT variance, ms, or null before two round trips. Read by
   *  the adaptive jitter buffer every time a snapshot lands (`./session`). */
  readonly rttJitterMs: number | null;
  /** The least round trip seen over the last {@link RTT_FLOOR_WINDOW} seconds, ms,
   *  or null before one was measured — the wire without this client's own queue in
   *  it. The lead budget is sized from this. */
  readonly rttFloorMs: number | null;
  /** The last finalized one-second sample, or null before a second has rolled. */
  readonly lastSample: TelemetrySample | null;
}

/** The one field of a {@link ReconcileReport} shape this instrument reads, kept
 *  narrow so it never depends on the rest of the prediction module. */
export interface ReconcileFacts {
  /** Correction magnitude — `ReconcileReport.error`. */
  readonly error: number;
  /** Whether the reconcile took authority wholesale — `ReconcileReport.resynced`. */
  readonly resynced: boolean;
  /** Whether the correction was hard-snapped rather than blended — `ReconcileReport.snapped`.
   *  Absent reads as false, so a caller built before the counter existed still compiles. */
  readonly snapped?: boolean;
  /** Ticks the client is running ahead of authority *after* this reconcile —
   *  `ReconcileReport.replayed`, which is exactly the pending queue's depth. The
   *  input latency the player pays on their own trigger, over and above the wire. */
  readonly lead?: number;
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/** A mutable one-second accumulator, folded into a {@link TelemetrySample} when
 *  the wall-clock second rolls over. */
interface OpenBucket {
  /** `floor(nowMs / SAMPLE_INTERVAL_MS)` — the wall-clock second this bucket is. */
  index: number;
  startMs: number;
  reconciles: number;
  mispredictions: number;
  correctionSum: number;
  correctionMax: number;
  rttSum: number;
  rttCount: number;
  rttMax: number;
  rttMin: number;
  leadSum: number;
  leadMax: number;
  resyncs: number;
  visualSnaps: number;
}

export class NetTelemetry {
  private readonly history: TelemetrySample[] = [];
  private readonly historySize: number;
  private readonly mispredictionUnits: number;
  private readonly sendRingSize: number;

  /** Outstanding input sends, oldest first: `{ seq, sentMs }`. The RTT probe. */
  private readonly sends: { seq: number; sentMs: number }[] = [];

  private open: OpenBucket | null = null;
  private lastRttMs: number | null = null;
  private lastCorrection = 0;
  /** The smoothed RTT variance, ms — RFC 3550's estimator over consecutive round
   *  trips. Null until a second measurement gives it a difference to smooth. */
  private jitterMs: number | null = null;
  private readonly jitterGain: number;

  constructor(
    config: {
      readonly historySize?: number;
      readonly mispredictionUnits?: number;
      readonly sendRingSize?: number;
      readonly jitterGain?: number;
    } = {},
  ) {
    this.historySize = config.historySize ?? SAMPLE_HISTORY;
    this.mispredictionUnits = config.mispredictionUnits ?? MISPREDICTION_UNITS;
    this.sendRingSize = config.sendRingSize ?? SEND_RING;
    this.jitterGain = config.jitterGain ?? JITTER_GAIN;
  }

  // --- Recording ----------------------------------------------------------

  /** Note that input `seq` left the client at `nowMs`, so the snapshot that later
   *  acknowledges it can be timed. Called once per `sendInput` (`./session`). */
  recordInput(seq: number, nowMs: number): void {
    this.sends.push({ seq, sentMs: nowMs });
    while (this.sends.length > this.sendRingSize) this.sends.shift();
  }

  /**
   * Fold one applied reconcile into the current second: its correction magnitude,
   * whether it was a misprediction, whether it resynced, and — matched against the
   * recorded sends — the round-trip of the input its `ackSeq` just confirmed.
   *
   * Call only for reconciles that actually applied (`ReconcileReport.applied`); a
   * stale snapshot the client ignored is not a data point.
   */
  recordReconcile(facts: ReconcileFacts, ackSeq: number, nowMs: number): void {
    this.roll(nowMs);
    const bucket = this.bucketFor(nowMs);

    bucket.reconciles++;
    bucket.correctionSum += facts.error;
    if (facts.error > bucket.correctionMax) bucket.correctionMax = facts.error;
    if (facts.error > this.mispredictionUnits) bucket.mispredictions++;
    if (facts.resynced) bucket.resyncs++;
    if (facts.snapped === true) bucket.visualSnaps++;
    if (facts.lead !== undefined) {
      bucket.leadSum += facts.lead;
      if (facts.lead > bucket.leadMax) bucket.leadMax = facts.lead;
    }
    this.lastCorrection = facts.error;

    const rtt = this.matchRtt(ackSeq, nowMs);
    if (rtt !== null) {
      bucket.rttSum += rtt;
      bucket.rttCount++;
      if (rtt > bucket.rttMax) bucket.rttMax = rtt;
      if (rtt < bucket.rttMin) bucket.rttMin = rtt;
      // RFC 3550's jitter: smooth the absolute change between consecutive round
      // trips. The first measurement has nothing to differ from, so the estimate
      // opens on the second one.
      if (this.lastRttMs !== null) {
        const delta = Math.abs(rtt - this.lastRttMs);
        this.jitterMs =
          this.jitterMs === null ? delta : this.jitterMs + (delta - this.jitterMs) / this.jitterGain;
      }
      this.lastRttMs = rtt;
    }
  }

  // --- Reading ------------------------------------------------------------

  /** Every finalized one-second sample, oldest first. */
  get samples(): readonly TelemetrySample[] {
    return this.history;
  }

  /** The current sub-second numbers, sampled live rather than per second. */
  get live(): TelemetryReadout {
    const b = this.open;
    const rate = b && b.reconciles > 0 ? b.mispredictions / b.reconciles : 0;
    return {
      rttMs: this.lastRttMs,
      correctionUnits: this.lastCorrection,
      mispredictionRate: rate,
      rttJitterMs: this.jitterMs,
      rttFloorMs: this.rttFloor(),
      lastSample: this.history.length > 0 ? this.history[this.history.length - 1]! : null,
    };
  }

  /**
   * A human-readable dump of the last `count` finalized seconds — the capture the
   * brief asks to be pasted into the PR. One line per second, newest last, plus a
   * one-line summary of the whole window.
   */
  format(count = 20): string {
    const recent = this.history.slice(-count);
    if (recent.length === 0) return 'net telemetry: no samples yet';

    const lines = recent.map((s) => {
      const rtt = s.rttMeanMs === null ? '   —' : `${Math.round(s.rttMeanMs)}`.padStart(4);
      const rttMax = s.rttMaxMs === null ? '  —' : `${Math.round(s.rttMaxMs)}`.padStart(4);
      const jit = s.rttJitterMs === null ? '  —' : `${Math.round(s.rttJitterMs)}`.padStart(3);
      return (
        `  +${`${Math.round((s.atMs - recent[0]!.atMs) / 1000)}`.padStart(3)}s  ` +
        `rtt ${rtt}/${rttMax}ms  jit ${jit}ms  ` +
        `corr ${s.correctionMeanUnits.toFixed(1)}/${s.correctionMaxUnits.toFixed(1)}u  ` +
        `mispred ${(s.mispredictionRate * 100).toFixed(0).padStart(3)}%  ` +
        `lead ${Math.round(s.leadMeanTicks)}/${s.leadMaxTicks}t  ` +
        `snap ${s.visualSnaps}  ` +
        `(${s.reconciles} recon${s.resyncs > 0 ? `, ${s.resyncs} resync` : ''})`
      );
    });

    const rttVals = recent.filter((s) => s.rttMeanMs !== null).map((s) => s.rttMeanMs!);
    const rttAvg = rttVals.length > 0 ? Math.round(mean(rttVals)) : null;
    const worstCorr = Math.max(...recent.map((s) => s.correctionMaxUnits));
    const totalRecon = recent.reduce((n, s) => n + s.reconciles, 0);
    const totalMispred = recent.reduce((n, s) => n + s.mispredictions, 0);
    const overallRate = totalRecon > 0 ? (totalMispred / totalRecon) * 100 : 0;
    const totalSnaps = recent.reduce((n, s) => n + s.visualSnaps, 0);
    const jitterNow = recent[recent.length - 1]!.rttJitterMs;

    return (
      `net telemetry — last ${recent.length}s\n` +
      lines.join('\n') +
      `\n  summary: rtt ~${rttAvg === null ? '—' : `${rttAvg}ms`}  ` +
      `jitter ${jitterNow === null ? '—' : `${Math.round(jitterNow)}ms`}  ` +
      `worst corr ${worstCorr.toFixed(1)}u  ` +
      `mispred ${overallRate.toFixed(0)}%  ` +
      `snaps ${totalSnaps}  ` +
      `over ${totalRecon} reconciles`
    );
  }

  // --- Internals ----------------------------------------------------------

  /** The least round trip over the recent window, open bucket included. Null when
   *  nothing has been measured yet. */
  private rttFloor(): number | null {
    let floor = this.open && this.open.rttCount > 0 ? this.open.rttMin : Number.POSITIVE_INFINITY;
    const from = Math.max(0, this.history.length - RTT_FLOOR_WINDOW);
    for (let i = from; i < this.history.length; i++) {
      const min = this.history[i]!.rttMinMs;
      if (min !== null && min < floor) floor = min;
    }
    return Number.isFinite(floor) ? floor : null;
  }

  /** Match `ackSeq` against the recorded sends, returning the round-trip of the
   *  input it just confirmed (and retiring everything at or before it), or null
   *  when this ack names nothing we still have a send time for. */
  private matchRtt(ackSeq: number, nowMs: number): number | null {
    let rtt: number | null = null;
    while (this.sends.length > 0 && this.sends[0]!.seq <= ackSeq) {
      const sent = this.sends.shift()!;
      if (sent.seq === ackSeq) rtt = Math.max(0, nowMs - sent.sentMs);
    }
    return rtt;
  }

  /** The bucket for `nowMs`, opening one if the second has no accumulator yet. */
  private bucketFor(nowMs: number): OpenBucket {
    const index = Math.floor(nowMs / SAMPLE_INTERVAL_MS);
    if (!this.open || this.open.index !== index) {
      this.open = {
        index,
        startMs: index * SAMPLE_INTERVAL_MS,
        reconciles: 0,
        mispredictions: 0,
        correctionSum: 0,
        correctionMax: 0,
        rttSum: 0,
        rttCount: 0,
        rttMax: 0,
        rttMin: Number.POSITIVE_INFINITY,
        leadSum: 0,
        leadMax: 0,
        resyncs: 0,
        visualSnaps: 0,
      };
    }
    return this.open;
  }

  /** Finalize the open bucket into the history ring if `nowMs` has crossed into a
   *  later wall-clock second. Idle gaps leave the open bucket alone — it is closed
   *  by the first event of the next second, never by empty seconds in between. */
  private roll(nowMs: number): void {
    const index = Math.floor(nowMs / SAMPLE_INTERVAL_MS);
    if (!this.open || this.open.index === index) return;
    this.finalize(this.open);
    this.open = null;
  }

  private finalize(b: OpenBucket): void {
    this.history.push({
      atMs: b.startMs,
      reconciles: b.reconciles,
      mispredictions: b.mispredictions,
      mispredictionRate: b.reconciles > 0 ? b.mispredictions / b.reconciles : 0,
      correctionMeanUnits: b.reconciles > 0 ? b.correctionSum / b.reconciles : 0,
      correctionMaxUnits: b.correctionMax,
      rttMeanMs: b.rttCount > 0 ? b.rttSum / b.rttCount : null,
      rttMaxMs: b.rttCount > 0 ? b.rttMax : null,
      rttMinMs: b.rttCount > 0 ? b.rttMin : null,
      rttJitterMs: this.jitterMs,
      leadMeanTicks: b.reconciles > 0 ? b.leadSum / b.reconciles : 0,
      leadMaxTicks: b.leadMax,
      resyncs: b.resyncs,
      visualSnaps: b.visualSnaps,
    });
    while (this.history.length > this.historySize) this.history.shift();
  }
}

function mean(xs: readonly number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

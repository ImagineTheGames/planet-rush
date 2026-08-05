/**
 * tests/net/rtt-decomposition.test.ts — **which of the three the ping is made of**,
 * and the ratchet that hid behind not knowing. OWNER: Netcode Engineer
 * (M10, items 6 and 7 of the developer's gru playtest).
 *
 * Two findings, one misread number.
 *
 * *"Speedtest 24 ms, game showed 95 then 215 sustained once the match heated up."*
 * Both readings were honest. The only round trip the client could measure was
 * **input → the snapshot that acknowledges it**, and that path is made of the game:
 * an input is stamped for a *future* tick, so the server holds it in its queue until
 * that tick comes round, and the ack then rides the next 30 Hz broadcast. A client
 * nine ticks ahead measures its own lead and calls it the network.
 *
 * *"Client rtt stepped 108 → 174 at one transient and NEVER came back down — flat
 * plateau, jitter unchanged at 8 ms, server loop lag flat 1.8-2.9 ms all match."*
 * The same number again, this time in a loop: the composite RTT sized the input-lead
 * buffer, and the lead inflated the composite. Those figures close on each other
 * exactly — 174 − 24 ms of wire is 150 ms, which is the 9 ticks of lead the same
 * capture reports — and that arithmetic is what the last test here asserts.
 *
 * Everything under the wire is the shipping stack: the real server, the real room,
 * the real codec, real sessions (`./latency-harness`). What the wire *does* is
 * scripted, so "one 500 ms hiccup at t=20 s" is a sentence a test can write.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { TICK_DT, createWorld } from '../../src/sim';
import type { World } from '../../src/sim';
import { PredictedMatch } from '../../src/net/prediction';
import { runLatencyMatch } from './latency-harness';
import type { HarnessClient, LatencyMatchResult } from './latency-harness';
import { netBudget } from './budgets';

/** A clean 100 ms wire — the developer's condition with nothing else in it, so a
 *  measurement that disagrees with 100 ms is disagreeing about something real. */
const CLEAN_100 = { rttMs: 100, jitterMs: 0, lossRate: 0 };

/** The far end of the acceptance range, where a client's lead is big enough that the
 *  composite reading and the wire's own are visibly different numbers. */
const ROUGH_250 = { rttMs: 250, jitterMs: 30, lossRate: 0.02 };

/** Twenty seconds of steady flight, then the hiccup, then ten seconds to recover —
 *  the shape item 7 names. */
const STALL_AT_S = 20;
const RECOVER_S = 10;
const STALL_MS = 500;

/** One 60 Hz frame in ms. Both ends of a probe are sampled on a frame boundary — the
 *  ping leaves with a tick's input, the pong is read when the socket is pumped — so a
 *  measurement carries up to two frames of quantization, exactly as it does on a real
 *  client. Tolerances here are written in frames for that reason. */
const FRAME_MS = TICK_DT * 1000;

function meanOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** The per-second lead history, paired with the wall-clock second each sample covers
 *  — the *harness* clock, which has been running since long before frame 1 (the lobby
 *  settles on it), so a recovery assertion must select by time and never by index. */
function leadHistory(client: HarnessClient): { atMs: number; mean: number; max: number }[] {
  return client.telemetry.samples.map((s) => ({
    atMs: s.atMs,
    mean: s.leadMeanTicks,
    max: s.leadMaxTicks,
  }));
}

// ---------------------------------------------------------------------------
// 6. The round trip, taken apart
// ---------------------------------------------------------------------------

describe('the round trip is measured in three parts (M10 item 6)', () => {
  function run(profile = CLEAN_100, frames = 20 * 60): LatencyMatchResult {
    return runLatencyMatch({ profile, frames });
  }

  it('measures the NETWORK round trip as the wire, not as the game', () => {
    for (const profile of [CLEAN_100, ROUGH_250]) {
      const result = run(profile);
      for (const client of result.clients) {
        const live = client.telemetry.live;
        // The probe was answered at all — a null here is the whole feature missing.
        expect(live.networkRttMs).not.toBeNull();
        expect(live.networkFloorMs).not.toBeNull();
        // What it measured is the wire itself: the server answers a ping in its socket
        // handler, so there is no tick queue and no broadcast interval in this figure —
        // only the two frames of sampling either end, and the profile's own jitter.
        const slack = 2 * FRAME_MS + profile.jitterMs + 1;
        expect(live.networkFloorMs!).toBeGreaterThan(profile.rttMs - slack);
        expect(live.networkFloorMs!).toBeLessThan(profile.rttMs + slack);
      }
    }
  }, netBudget({
    work: 'two scripted 20 s matches (clean 100 ms, rough 250 ms) → assert the ping floor is the wire on every client',
    measuredSeconds: 4.3,
  }));

  it('shows the composite reading high — and says where the difference went', () => {
    // At 250 ms with jitter and loss the client holds a real lead, which is where the
    // developer's "215 ms on a 24 ms wire" comes from. The composite is the wire plus
    // that lead; the point of the decomposition is that the two come apart.
    const result = run(ROUGH_250);
    for (const client of result.clients) {
      const live = client.telemetry.live;
      expect(live.rttFloorMs).not.toBeNull();
      // Floor against floor, which is the only fair comparison of these two: each is a
      // best-case pass, so the difference between them is pure tick-queue wait and
      // nothing else. (Their *means* are not comparable — the probe runs at 2 Hz against
      // an ack stream at 30, so one retransmit stall dominates the probe's average and
      // barely moves the ack's. That asymmetry is also why the number shown to a player
      // is the floor rather than the newest sample, `./session` `networkPingMs`.)
      expect(live.rttFloorMs!).toBeGreaterThanOrEqual(live.networkFloorMs! + FRAME_MS);
      // And the server states where the difference went. The queue wait can never
      // exceed what the client is allowed to run ahead by — that *is* what the input is
      // waiting for — which is the relation that makes these three numbers one
      // decomposition rather than three unrelated readings.
      expect(live.serverQueueMs).not.toBeNull();
      expect(live.serverQueueMs!).toBeGreaterThan(0);
      const budgetMs = client.session.prediction!.leadBudget * FRAME_MS;
      expect(live.serverQueueMs!).toBeLessThanOrEqual(budgetMs + FRAME_MS);
    }
  }, netBudget({
    work: 'one scripted 20 s match at 250 ms → take the composite RTT apart into network, tick queue and client lag',
    measuredSeconds: 1.4,
  }));

  it('adds up: network + tick queue accounts for what the client measures', () => {
    // On a clean wire, where a single reading is a reading and not a retransmit: the
    // composite is the wire plus the queue wait, within the broadcast interval the ack
    // rides home on. That residual belongs to neither stage, which is why it is a
    // tolerance here rather than a fourth number — the three the report asks for are
    // the three with a fix behind them.
    const result = run(CLEAN_100);
    for (const client of result.clients) {
      const live = client.telemetry.live;
      const explained = live.networkRttMs! + live.serverQueueMs!;
      expect(Math.abs(live.rttMs! - explained)).toBeLessThanOrEqual(4 * FRAME_MS);
    }
  }, netBudget({
    work: 'one scripted 20 s match → assert the three stages account for the composite the client measures',
    measuredSeconds: 1.0,
  }));

  it('reports the server loop honestly — a harness server is not starving', () => {
    const result = run();
    for (const client of result.clients) {
      const live = client.telemetry.live;
      expect(live.serverLoopLagMs).not.toBeNull();
      // The harness advances its clock exactly one tick per frame, so the room is never
      // late: this is the reading a healthy host gives, and it is the number the
      // machine-size question gets asked with — *"if the server component grows with bot
      // count, the gru shared-cpu-1x is CPU-starving the sim"*, which is a
      // Director/developer call and not a code fix (docs/netcode-spike.md).
      expect(live.serverLoopLagMs!).toBeLessThan(1);
    }
  }, netBudget({
    work: 'one scripted 20 s match → assert the harness server states a healthy loop lag',
    measuredSeconds: 1.1,
  }));

  it('keeps all three on every finalized second, for the pasted log', () => {
    const result = run();
    for (const client of result.clients) {
      const samples = client.telemetry.samples.filter((s) => s.networkMeanMs !== null);
      // Twice a second for twenty seconds, less the lobby's settling at the front.
      expect(samples.length).toBeGreaterThan(10);
      for (const s of samples) {
        expect(s.networkMinMs).not.toBeNull();
        expect(s.serverQueueMeanMs).not.toBeNull();
        expect(s.serverLoopLagMaxMs).not.toBeNull();
        // The client's own frame scheduling: ~zero on a harness whose clock is exact,
        // which is the point — the number exists so a *real* device's stalls stop being
        // blamed on the wire.
        expect(s.clientLagMeanMs).toBeLessThan(1);
        expect(s.clientLagMaxMs).toBeLessThan(1);
      }
    }
  }, netBudget({
    work: 'one scripted 20 s match → assert every finalized second carries all three stages for the pasted log',
    measuredSeconds: 1.0,
  }));

  it('shows the player the network figure, never the composite', () => {
    const result = run(ROUGH_250);
    for (const client of result.clients) {
      // `networkPingMs` is what the lobby/HUD readout reads (m10-17): the wire's own
      // number. The composite stays in the log, where a diagnostic belongs — showing it
      // would tell a player on a 24 ms connection that they have a 215 ms one.
      // The floor, not the newest sample: on a lossy wire one retransmit stalls the
      // probe along with everything else on the socket, and a 780 ms flash on a 250 ms
      // connection is noise being presented as information (the wobble is reported
      // separately, as jitter).
      expect(client.session.networkPingMs).toBe(client.telemetry.live.networkFloorMs);
      expect(client.session.networkPingMs!).toBeLessThan(client.telemetry.live.rttFloorMs!);
    }
  }, netBudget({
    work: 'one scripted 20 s match → assert the HUD reads the wire, never the composite',
    measuredSeconds: 1.4,
  }));
});

// ---------------------------------------------------------------------------
// 7. The lead ratchet
// ---------------------------------------------------------------------------

describe('the input lead comes back down after a hiccup (M10 item 7)', () => {
  /**
   * The brief's own scenario, as a permanent gate: *"inject one 500 ms stall at
   * t=20 s, assert lead returns to baseline within 10 s."*
   *
   * The stall is a real head-of-line block — every message in flight in both
   * directions held for half a second — so the lead genuinely spikes, and the peak
   * below is asserted rather than assumed. What this proves is that the clock *bleeds
   * back*: `trimLead` drops the excess a few ticks per reconcile, and the lead is at
   * its baseline again long before the ten seconds are up.
   */
  it('returns to baseline within ten seconds of one 500 ms stall', () => {
    const result = runLatencyMatch({
      profile: CLEAN_100,
      // Two seconds past the recovery window, so the +8s..+10s seconds this asserts
      // over are both *finalized* samples — an open bucket is not a second.
      frames: (STALL_AT_S + RECOVER_S + 2) * 60,
      stall: { atFrame: STALL_AT_S * 60, ms: STALL_MS },
    });
    // The hiccup really happened: two pipes per client, both held.
    expect(result.stalls).toBeGreaterThanOrEqual(4);
    expect(result.stalledAtMs).not.toBeNull();
    const stalledAtMs = result.stalledAtMs!;

    for (const client of result.clients) {
      const history = leadHistory(client);
      // Selected by wall clock, never by index — the lobby settles on the same clock
      // before frame 1, so the twentieth sample is not the twentieth second.
      const before = history.filter((h) => h.atMs < stalledAtMs && h.atMs >= stalledAtMs - 5_000);
      const during = history.filter(
        (h) => h.atMs >= stalledAtMs - 1_000 && h.atMs <= stalledAtMs + 1_000,
      );
      const after = history.filter(
        (h) =>
          h.atMs >= stalledAtMs + (RECOVER_S - 2) * 1_000 &&
          h.atMs <= stalledAtMs + RECOVER_S * 1_000,
      );
      expect(before.length).toBeGreaterThan(3);
      expect(after.length).toBeGreaterThan(1);

      const baseline = meanOf(before.map((h) => h.mean));
      const peak = Math.max(...during.map((h) => h.max));
      const recovered = meanOf(after.map((h) => h.mean));

      // eslint-disable-next-line no-console
      console.log(
        `    lead: baseline ${baseline.toFixed(1)}t → peak ${peak}t → ` +
          `+${RECOVER_S}s ${recovered.toFixed(1)}t  ` +
          `(budget ${client.session.prediction!.leadBudget}t, ` +
          `net ${Math.round(client.telemetry.live.networkFloorMs ?? -1)}ms)`,
      );

      // A run where the stall did not move the lead would pass the recovery assertion
      // by measuring nothing. Guard the guard: half a second of blocked acks is thirty
      // ticks of input the client has sent and cannot retire.
      expect(peak).toBeGreaterThan(baseline + 10);
      // And the clock is back where the wire says it belongs — no plateau, and not
      // merely below the peak but at the baseline it held before the hiccup.
      expect(recovered).toBeLessThanOrEqual(baseline + 1);
    }
  }, netBudget({
    work: 'one scripted 30 s match with a 500 ms stall at t=20 s → assert the lead is back at baseline ten seconds later',
    measuredSeconds: 1.1,
  }));

  it('never widens the budget on a hiccup the wire has already recovered from', () => {
    const result = runLatencyMatch({
      profile: CLEAN_100,
      frames: (STALL_AT_S + RECOVER_S) * 60,
      stall: { atFrame: STALL_AT_S * 60, ms: STALL_MS },
    });
    for (const client of result.clients) {
      const budget = client.session.prediction!.leadBudget;
      // 100 ms of wire is 6 ticks; the budget is that, plus the two frames of sampling
      // quantization the probe carries, plus a jitter allowance and two ticks of margin
      // (`src/net/prediction` `setLeadBudget`). What it must never be is the *hiccup's*
      // worth — half a second is thirty ticks, and a ceiling that rose once and stayed
      // there is the ratchet itself.
      expect(budget).toBeLessThanOrEqual(Math.ceil((CLEAN_100.rttMs + 2 * FRAME_MS) / FRAME_MS) + 4);
    }
  }, netBudget({
    work: 'one scripted 30 s match with a 500 ms stall → assert the lead budget never ratchets on it',
    measuredSeconds: 1.0,
  }));

  /**
   * The ratchet's arithmetic, from the developer's own capture (room RXS3).
   *
   * A unit test rather than a harness run, and deliberately so: the fault is not
   * something a wire *does*, it is which number the budget was sized from. The
   * harness's wire recovers perfectly and its stalled backlog drains at line rate, so
   * the ack stream resumes at once and the lead bleeds back on its own — while the
   * plateau in the capture needed a budget wide enough to permit the inflated lead
   * indefinitely, which is exactly what the composite reading gave it.
   */
  it('sizes the budget from the wire, not from a reading the lead inflated', () => {
    const world = (): World =>
      createWorld({
        seed: 3,
        players: [
          { id: 0, shipClass: ShipClass.Vanguard },
          { id: 1, shipClass: ShipClass.Interceptor },
        ],
        asteroidCount: 4,
      });
    // The capture: a 24 ms wire (the developer's speedtest), a composite RTT that
    // stepped to 174 ms and stayed there, jitter flat at 8 ms, and a lead stuck at 9
    // ticks. 174 − 24 = 150 ms is exactly those 9 ticks — the composite *is* the wire
    // plus the lead, which is why sizing the lead from it closes a loop.
    const NETWORK_MS = 24;
    const COMPOSITE_MS = 174;
    const JITTER_MS = 8;
    const STUCK_LEAD_TICKS = 9;

    const fromComposite = new PredictedMatch({ world: world(), localPlayer: 0 });
    const fromWire = new PredictedMatch({ world: world(), localPlayer: 0 });
    const permissive = fromComposite.setLeadBudget(COMPOSITE_MS, JITTER_MS);
    const honest = fromWire.setLeadBudget(NETWORK_MS, JITTER_MS);

    // The old budget permits the stuck lead outright, so `trimLead` has nothing to do
    // and the plateau is stable: 9 ticks of input latency the player pays for the rest
    // of the match, on a wire that could carry 24 ms.
    expect(permissive).toBeGreaterThan(STUCK_LEAD_TICKS);
    // Sized from the wire, the same lead is over budget and is bled off.
    expect(honest).toBeLessThan(STUCK_LEAD_TICKS);
    // And it is not merely smaller — it is the wire plus its jitter allowance, which is
    // what "the measured need" means: a 24 ms round trip needs three ticks in flight.
    expect(honest).toBeLessThanOrEqual(Math.ceil((NETWORK_MS + 2 * JITTER_MS) / FRAME_MS) + 2);
  }, netBudget({
    work: 'arithmetic on a hand-built telemetry ring — no match',
    measuredSeconds: 0.05,
  }));
});

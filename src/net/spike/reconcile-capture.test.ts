/**
 * src/net/spike/reconcile-capture.test.ts — a real reconciliation-feel capture at
 * the developer's condition (M10 reconcile-feel brief; GDD §4.2).
 *
 * The brief asks for a real telemetry capture pasted into the PR, and this is the
 * tool that mints it — the same discipline as the day-0 spike (`./spike.bench.test.ts`):
 * it drives a full client↔authority round trip over an artificially delayed wire
 * at the developer's ~150 ms + jitter, feeds every send and every reconcile
 * through the production {@link NetTelemetry}, and LOGS the per-second capture. The
 * assertions guard only CI-stable structural invariants — that the run actually
 * reconciled, that RTT was measured near the injected latency, and that no
 * correction ever reached teleport-grade — NOT wall-clock thresholds, so this
 * stays green on any runner.
 *
 * Reproduce / regenerate the capture in docs/netcode-spike.md:
 *   `npx vitest run src/net/spike/reconcile-capture.test.ts`
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { TICK_DT, createWorld, step } from '../../sim';
import type { World, WorldConfig } from '../../sim';
import { InputQueue } from '../input-queue';
import { PredictedMatch, SNAP_THRESHOLD } from '../prediction';
import { NetTelemetry } from '../telemetry';
import { decodeSnapshot, encodeWorldSnapshot } from '../snapshot';
import type { DecodedSnapshot } from '../snapshot';
import type { InputMessage } from '../transport';

const LOCAL: PlayerId = 0;
const MATCH: WorldConfig = {
  seed: 7,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Interceptor },
  ],
  asteroidCount: 8,
};
const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];

function shipOf(world: World, id: PlayerId = LOCAL): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

/** A seeded LCG so the jitter is identical run to run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The authoritative half, assembled from the same parts the match server uses. */
class Authority {
  readonly world = createWorld(MATCH);
  private readonly queue = new InputQueue();
  private acknowledged = 0;
  receive(message: InputMessage): void {
    const verdict = this.queue.accept(LOCAL, message, this.world.tick);
    if (verdict !== 'late') return;
    this.queue.accept(LOCAL, { ...message, tick: this.world.tick + 1 }, this.world.tick);
  }
  tick(): void {
    const rows = this.queue.take(this.world.tick + 1);
    for (const row of rows) if (row.id === LOCAL && row.seq > this.acknowledged) this.acknowledged = row.seq;
    step(this.world, rows, TICK_DT);
  }
  broadcast(): { snapshot: DecodedSnapshot; ackSeq: number } {
    return { snapshot: decodeSnapshot(encodeWorldSnapshot(this.world)), ackSeq: this.acknowledged };
  }
}

/** An additive-jitter wire in frames (a packet never beats the base latency). */
class Link<T> {
  private readonly inflight: { at: number; payload: T }[] = [];
  constructor(
    private readonly delayFrames: number,
    private readonly jitterFrames: number,
    private readonly rng: () => number,
  ) {}
  send(frame: number, payload: T): void {
    const jitter = Math.floor(this.rng() * (this.jitterFrames + 1));
    this.inflight.push({ at: frame + this.delayFrames + jitter, payload });
  }
  arrivals(frame: number): T[] {
    const due = this.inflight.filter((p) => p.at <= frame).sort((a, b) => a.at - b.at);
    for (const packet of due) this.inflight.splice(this.inflight.indexOf(packet), 1);
    return due.map((p) => p.payload);
  }
}

describe('reconciliation feel at ~150 ms + jitter (M10 capture)', () => {
  it('measures RTT / correction / misprediction per second and never snaps in normal flight', () => {
    const server = new Authority();
    const client = new PredictedMatch({ world: createWorld(MATCH), localPlayer: LOCAL });
    const telemetry = new NetTelemetry();

    // ~150–180 ms RTT: one-way 3 frames (≈50 ms) + 0–2 frames of jitter → 6–10
    // frames round trip, plus up to one 30 Hz broadcast interval before the ack
    // rides home — the developer's gru-on-iad condition.
    const rng = lcg(0x150a);
    const up = new Link<InputMessage>(3, 2, rng);
    const down = new Link<{ snapshot: DecodedSnapshot; ackSeq: number }>(3, 2, rng);

    const nowMs = (frame: number): number => frame * TICK_DT * 1000;
    const corrections: number[] = [];
    const start = { ...shipOf(client.world).pos };
    let seq = 0;

    const FRAMES = 8 * 60; // eight seconds of steady flight
    for (let frame = 1; frame <= FRAMES; frame++) {
      const message: InputMessage = { type: 'input', tick: client.tick + 1, seq: ++seq, actions: THRUST };
      up.send(frame, message);
      telemetry.recordInput(message.seq, nowMs(frame));
      client.predict(message.seq, THRUST);

      for (const inbound of up.arrivals(frame)) server.receive(inbound);
      server.tick();
      if (server.world.tick % 2 === 0) down.send(frame, server.broadcast());

      for (const inbound of down.arrivals(frame)) {
        const report = client.reconcile(inbound.snapshot, inbound.ackSeq);
        if (report.applied) {
          telemetry.recordReconcile(report, inbound.ackSeq, nowMs(frame));
          corrections.push(report.error);
        }
      }
    }
    // Flush the final open second into the history so the capture shows it.
    telemetry.recordReconcile({ error: 0, resynced: false }, seq, nowMs(FRAMES) + 1000);

    // The capture — pasted into the PR and docs/netcode-spike.md.
    // eslint-disable-next-line no-console
    console.log(`\n${telemetry.format()}\n`);

    // Structural invariants only (CI-stable, no wall-clock thresholds):
    expect(telemetry.samples.length).toBeGreaterThanOrEqual(5);

    // RTT was actually measured, and near the injected latency — proof the ack is
    // a real round-trip probe, not a placeholder.
    const measured = telemetry.samples.map((s) => s.rttMeanMs).filter((r): r is number => r !== null);
    expect(measured.length).toBeGreaterThan(0);
    const rttMean = measured.reduce((a, b) => a + b, 0) / measured.length;
    expect(rttMean).toBeGreaterThan(100);
    expect(rttMean).toBeLessThan(300);

    // The guarantee: normal flight never produces a teleport-grade correction, so
    // the developer sees a decaying blend, never a rollback.
    expect(Math.max(...corrections)).toBeLessThan(SNAP_THRESHOLD);

    // And the local ship really did fly — the capture is of motion, not a park.
    const moved = Math.hypot(shipOf(client.world).pos.x - start.x, shipOf(client.world).pos.y - start.y);
    expect(moved).toBeGreaterThan(1);
  });
});

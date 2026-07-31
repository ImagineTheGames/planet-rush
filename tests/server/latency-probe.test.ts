/**
 * tests/server/latency-probe.test.ts — **the server's half of the three-part round
 * trip.** OWNER: Netcode Engineer (M10, item 6 of the developer's gru playtest).
 *
 * *"Speedtest 24 ms, game showed 95 then 215 sustained once the match heated up."*
 *
 * The client could only ever measure input→ack, and that path is made of the game: an
 * input is stamped for a future tick, so the room holds it in its queue until that
 * tick comes round. This file asserts the two things the server owes the
 * decomposition, and the *when* matters as much as the what:
 *
 *  1. **A pong is written in the socket handler**, on the frame the ping arrives —
 *     never queued for a tick, never ridden home on the next broadcast. A probe that
 *     waits for the game measures the game, and then there is no wire measurement
 *     anywhere in the system.
 *  2. **It carries what only the server knows**: how long this client's most recently
 *     simulated input waited between arriving and being run, and how far past its
 *     deadline the room's tick loop is running (`src/net/transport` PongMessage).
 *
 * In-process, injected clock, array-backed sockets — the same shape as the rest of
 * this server's tests (`./input-gaps.test.ts`).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '@shared/types';
import type { World } from '../../src/sim';
import { TICK_DT } from '../../src/sim';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { PongMessage } from '../../src/net/transport';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {}
}

const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];
const FRAME_MS = 1000 / 60;

describe('the latency probe', () => {
  let server: MatchServer;
  let socket: FakeSocket;
  let connection: Connection;
  let now = 5_000_000;
  let seq = 0;

  const tick = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += FRAME_MS;
      server.update(now);
    }
  };

  const world = (): World => {
    const w = connection.room?.world;
    if (!w) throw new Error('no authoritative world');
    return w;
  };

  /** Every pong this socket has been sent, in order. */
  const pongs = (): PongMessage[] => {
    const out: PongMessage[] = [];
    for (const frame of socket.frames) {
      const message = parseServerMessage(frame);
      if (message && message.type === 'pong') out.push(message);
    }
    return out;
  };

  const ping = (id: number): void => {
    connection.receive(encodeClientMessage({ type: 'ping', id }));
  };

  /** Input for a tick `ahead` ticks in the future — a client running that far ahead of
   *  authority, which is precisely what the tick queue's wait measures. */
  const send = (ahead: number): void => {
    connection.receive(
      encodeClientMessage({ type: 'input', tick: world().tick + ahead, seq: ++seq, actions: THRUST }),
    );
  };

  beforeEach(() => {
    now = 5_000_000;
    seq = 0;
    socket = new FakeSocket();
    server = new MatchServer({ seed: 0x9e11, graceMs: 60_000, asteroidCount: 0 });
    server.update(now);
    const code = server.createCode();
    connection = server.connect(socket);
    connection.receive(encodeClientMessage({ type: 'join', room: code }));
    connection.receive(encodeClientMessage({ type: 'startMatch' }));
    tick(2);
  });

  it('answers on the frame it arrives, without waiting for a tick', () => {
    const before = socket.frames.length;
    ping(1);
    // No `tick()` between the ping and this assertion: the answer is already on the
    // socket. This is the whole property — a pong that waited for the broadcast would
    // carry the broadcast interval, and the client would measure the game again.
    expect(socket.frames.length).toBeGreaterThan(before);
    const answered = pongs();
    expect(answered.length).toBe(1);
    expect(answered[0]!.id).toBe(1);
  });

  it('echoes the id it was given, so a client can time its own probe', () => {
    ping(7);
    tick();
    ping(9);
    expect(pongs().map((p) => p.id)).toEqual([7, 9]);
  });

  it('states the tick-queue wait: receive to apply, in ms', () => {
    // A client running eight ticks ahead sends input for a tick the room has not
    // reached. It waits in the queue for it — that wait is the SERVER stage, and it is
    // the client's own lead coming back to it rather than anything the wire did.
    const ahead = 8;
    send(ahead);
    tick(ahead + 1);
    ping(1);
    const queueMs = pongs()[0]!.queueMs;
    // Eight ticks of wait, give or take the tick the arrival was measured at.
    expect(queueMs).toBeGreaterThan((ahead - 2) * TICK_DT * 1000);
    expect(queueMs).toBeLessThan((ahead + 2) * TICK_DT * 1000);
  });

  it('states a small wait for a client that is barely ahead at all', () => {
    // The healthy case, and the contrast that makes the measurement meaningful: input
    // stamped for the very next tick waits one tick, not eight.
    send(1);
    tick(2);
    ping(1);
    expect(pongs()[0]!.queueMs).toBeLessThanOrEqual(2 * TICK_DT * 1000);
  });

  it('states the room loop lag, and reads ~zero on a loop that is on time', () => {
    tick(30);
    ping(1);
    const lag = pongs()[0]!.loopLagMs;
    // The test clock advances exactly one tick per update, so the room is never late.
    // A few ms here is healthy on a real host; a figure that climbs with bot count is
    // a shared core out of burst credit, which is a machine-size decision and not a
    // code fix (docs/netcode-spike.md).
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(1);
  });

  it('sees the lag climb when the loop is called late', () => {
    // Four ticks' worth of wall clock per update: a descheduled process, or a host
    // that has run out of burst credit. The room catches up on sim ticks either way —
    // what changes is that it was *called* late, which is what this measures.
    for (let i = 0; i < 40; i++) {
      now += 4 * FRAME_MS;
      server.update(now);
    }
    ping(1);
    const lag = pongs()[0]!.loopLagMs;
    // Three frames late, every time, smoothed — so the reading settles near 50 ms.
    expect(lag).toBeGreaterThan(2 * FRAME_MS);
  });

  it('is refused before a seat exists, like every other room verb', () => {
    const stranger = new FakeSocket();
    const other = server.connect(stranger);
    // No join, so no slot: the room has nobody to answer. A probe is not a way in.
    other.receive(encodeClientMessage({ type: 'ping', id: 1 }));
    const answered = stranger.frames
      .map((f) => parseServerMessage(f))
      .filter((m) => m !== null && m.type === 'pong');
    expect(answered.length).toBe(0);
  });
});

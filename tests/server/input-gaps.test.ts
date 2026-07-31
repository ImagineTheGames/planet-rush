/**
 * tests/server/input-gaps.test.ts — **a tick the wire loses is not a tick the
 * player let go of the stick.** OWNER: Netcode Engineer (GDD §4.2; M10
 * tick-alignment).
 *
 * The authoritative half of the constant-correction hunt. A predicting client
 * simulates its own input the frame the key goes down and then reconciles against
 * whatever the server says happened; when the server's copy of that same input
 * lands somewhere else — a different tick, or nowhere at all — the difference
 * comes back as a correction on every snapshot until it is paid off. Two ways it
 * used to land somewhere else, both measured on the latency harness and both
 * closed here:
 *
 *  1. **A tick with nothing filed ran with a neutral intent.** `step()` gives a
 *     ship with no input row no thrust, no aim and no trigger (`src/sim/step.ts`
 *     `intentFor`) — right for an empty seat, wrong for a human whose 16 ms of
 *     input is merely in the air. The authoritative ship stopped accelerating for
 *     that tick while the client, which knew exactly what was pressed, kept
 *     flying.
 *  2. **A retransmit burst collapsed to one message.** Everything a TCP stall
 *     held arrives at once, all of it re-filed onto the next unsimulated tick,
 *     and the queue's first-wins rule kept the *oldest* stick reading and dropped
 *     the rest — 48 % of a player's input at 250 ms with 2 % loss.
 *
 * In-process, injected clock, array-backed sockets — the same shape as the rest of
 * this server's tests (`./order-idempotence.test.ts`).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '@shared/types';
import type { World } from '../../src/sim';
import { encodeClientMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { INTENT_HOLD_TICKS } from '../../server/room';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {}
}

const THRUST_RIGHT: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];
const THRUST_LEFT: readonly Action[] = [{ type: 'thrust', dir: { x: -1, y: 0 } }];

describe('a human seat with nothing filed for a tick', () => {
  let server: MatchServer;
  let now = 5_000_000;
  let connection: Connection;
  let seq = 0;

  /** One 60 Hz tick of server time. 50 ms — three ticks — is what the other server
   *  tests step by; this file needs single ticks, so it steps by one and lets the
   *  room's fractional carry do the rounding. */
  const tick = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      server.update(now);
    }
  };

  const world = (): World => {
    const w = connection.room?.world;
    if (!w) throw new Error('no authoritative world');
    return w;
  };

  const ship = (): World['ships'][number] => world().ships.find((s) => s.id === 0)!;

  /** Send input for the next unsimulated tick, as the client's codec would. */
  const send = (actions: readonly Action[], forTick = world().tick + 1): void => {
    connection.receive(encodeClientMessage({ type: 'input', tick: forTick, seq: ++seq, actions }));
  };

  beforeEach(() => {
    now = 5_000_000;
    seq = 0;
    server = new MatchServer({ seed: 0x51de, graceMs: 60_000, asteroidCount: 0 });
    server.update(now);
    const code = server.createCode();
    connection = server.connect(new FakeSocket());
    connection.receive(encodeClientMessage({ type: 'join', room: code }));
    connection.receive(encodeClientMessage({ type: 'startMatch' }));
    tick(2);
    // A ship at rest in open space — parked at the arena centre, clear of its own
    // station's hull (a ship that shoulders into one is slid aside by contact
    // resolution, which would drown out the only thing being measured here).
    ship().pos.x = world().bounds.width / 2;
    ship().pos.y = world().bounds.height / 2;
    ship().vel.x = 0;
    ship().vel.y = 0;
  });

  it('keeps flying on the stick it was last holding', () => {
    send(THRUST_RIGHT);
    tick();
    const afterOne = ship().vel.x;
    expect(afterOne).toBeGreaterThan(0);

    // Five ticks with nothing on the wire at all — the shape of a jitter spike or
    // the ragged edge of a retransmit. Before the hold, the ship coasted through
    // them on drag alone while the predicting client kept accelerating, and the
    // gap came back as a correction.
    tick(5);
    expect(ship().vel.x).toBeGreaterThan(afterOne * 2);
  });

  it('lets go once the seat has been silent long enough to have stopped talking', () => {
    send(THRUST_RIGHT);
    tick();
    const held = ship().vel.x;

    tick(INTENT_HOLD_TICKS + 4);
    const coasting = ship().vel.x;
    // It accelerated while the hold lasted…
    expect(coasting).toBeGreaterThan(held);

    // …and past the window it is only drag: a ship must not fly on a dead
    // player's last press (GDD §4.2 hands the seat to a bot).
    tick(10);
    expect(ship().vel.x).toBeLessThan(coasting);
  });

  it('takes the newest press the moment one arrives, never the held one', () => {
    send(THRUST_RIGHT);
    tick(4);
    expect(ship().vel.x).toBeGreaterThan(0);

    send(THRUST_LEFT);
    tick(20); // long enough for the new intent to be held in its turn
    expect(ship().vel.x).toBeLessThan(0);
  });

  it('never repeats a one-shot order it is holding the stick from', () => {
    const home = world().stations.find((s) => s.owner === 0)!;
    const me = ship();
    me.pos.x = home.pos.x;
    me.pos.y = home.pos.y;
    me.banked = 200;

    // A tap that buys a turret, arriving on the same tick as a thrust.
    send([...THRUST_RIGHT, { type: 'buildOrder', item: 'turret', orderId: 0x99 }]);
    tick();
    expect(home.builds).toHaveLength(1);

    // Twenty ticks of silence, every one of them holding that same message's
    // stick. If the hold carried the order too, this would be a turret per tick —
    // the exact arithmetic the order-echo work exists to make impossible.
    tick(20);
    expect(home.builds).toHaveLength(1);
  });
});

describe('a retransmit burst', () => {
  let server: MatchServer;
  let now = 6_000_000;
  let connection: Connection;

  const world = (): World => connection.room!.world!;

  beforeEach(() => {
    now = 6_000_000;
    server = new MatchServer({ seed: 0x7a11, graceMs: 60_000, asteroidCount: 0 });
    server.update(now);
    const code = server.createCode();
    connection = server.connect(new FakeSocket());
    connection.receive(encodeClientMessage({ type: 'join', room: code }));
    connection.receive(encodeClientMessage({ type: 'startMatch' }));
    // A second of match, so the burst below can name ticks that are genuinely in
    // this match's past rather than negative (the codec refuses those outright).
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60;
      server.update(now);
    }
  });

  it('lands as one tick of the newest stick and every order in it, dropping none', () => {
    const station = world().stations.find((s) => s.owner === 0)!;
    const me = world().ships.find((s) => s.id === 0)!;
    me.pos.x = station.pos.x;
    me.pos.y = station.pos.y;
    me.banked = 200;

    // Thirty messages for ticks the sim has long since run — a stalled pipe
    // draining at line rate. Every one of them is re-filed onto the next free
    // tick, so every one of them collides with the last.
    const stale = world().tick - 30;
    for (let i = 0; i < 30; i++) {
      const actions: Action[] = [...(i === 29 ? THRUST_LEFT : THRUST_RIGHT)];
      if (i === 3 || i === 17) actions.push({ type: 'buildOrder', item: 'turret', orderId: 0xb0 + i });
      connection.receive(
        encodeClientMessage({ type: 'input', tick: stale + i, seq: 1 + i, actions }),
      );
    }

    me.vel.x = 0;
    me.vel.y = 0;
    now += 1000 / 60;
    server.update(now);

    // The newest stick reading won — the ship is going *left*, where the player's
    // hands were, not right where the oldest message in the backlog left them.
    expect(world().ships.find((s) => s.id === 0)!.vel.x).toBeLessThan(0);
    
    // Both purchases in the burst were made. Under first-wins, the order at index
    // 17 was thrown away with the twenty-eight messages around it.
    expect(station.builds).toHaveLength(2);
    // And authority discarded nothing at all: the burst was merged, not refused.
    expect(connection.room!.inputStats.duplicate).toBe(0);
  });
});

/**
 * src/net/websocket-transport.test.ts — the online transport, and the sixty
 * seconds it spends trying to get your ship back. OWNER: Netcode Engineer.
 *
 * No real socket, no real clock, no real timer: all three are injected
 * (`WebSocketTransportConfig`), so a grace window elapses here in microseconds
 * and nothing in this file is flaky by construction.
 */

import { describe, expect, it } from 'vitest';
import { encodeSnapshot } from './snapshot';
import type { ClientMessage, ServerMessage } from './transport';
import { WebSocketTransport } from './websocket-transport';
import type { TimerHandle, WebSocketLike } from './websocket-transport';
import { encodeServerMessage } from './wire';

/** A socket a test can open, drop and inspect. */
class FakeSocket implements WebSocketLike {
  binaryType = '';
  readonly sent: string[] = [];
  closedByClient = false;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: string | ArrayBuffer): void {
    if (typeof data === 'string') this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
  }

  /** What the client actually said, decoded. */
  messages(): ClientMessage[] {
    return this.sent.map((frame) => JSON.parse(frame) as ClientMessage);
  }

  open(): void {
    this.onopen?.({});
  }

  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: encodeServerMessage(message) });
  }

  drop(): void {
    this.onclose?.({});
  }
}

/** A transport wired to fakes, plus the levers to drive them. */
function harness(options: { reconnectWindowMs?: number } = {}): {
  transport: WebSocketTransport;
  sockets: FakeSocket[];
  latest: () => FakeSocket;
  states: string[];
  received: ServerMessage[];
  tick: (ms: number) => void;
} {
  const sockets: FakeSocket[] = [];
  const timers = new Map<number, { at: number; fn: () => void }>();
  let clock = 1_000;
  let nextTimer = 1;

  const transport = new WebSocketTransport({
    url: 'wss://example.invalid/play',
    room: 'QK7P',
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => clock,
    schedule: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: clock + ms, fn });
      return id as unknown as TimerHandle;
    },
    cancel: (handle) => {
      timers.delete(handle as unknown as number);
    },
    ...(options.reconnectWindowMs !== undefined
      ? { reconnectWindowMs: options.reconnectWindowMs }
      : {}),
  });

  const states: string[] = [];
  transport.onStateChange((state) => states.push(state));
  const received: ServerMessage[] = [];
  transport.onMessage((message) => received.push(message));

  /** Advance the fake clock and fire whatever it makes due. */
  const tick = (ms: number): void => {
    clock += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > clock) continue;
      timers.delete(id);
      timer.fn();
    }
  };

  return {
    transport,
    sockets,
    latest: () => sockets[sockets.length - 1]!,
    states,
    received,
    tick,
  };
}

describe('WebSocketTransport', () => {
  it('joins the room the moment the socket opens', () => {
    const h = harness();
    expect(h.transport.state).toBe('connecting');
    // Binary frames must arrive as buffers, not Blobs — snapshots are read
    // synchronously on the render tick.
    expect(h.latest().binaryType).toBe('arraybuffer');

    h.latest().open();
    expect(h.transport.state).toBe('open');
    expect(h.latest().messages()).toEqual([{ type: 'join', room: 'QK7P' }]);
  });

  it('hands decoded server messages on, snapshots included', () => {
    const h = harness();
    h.latest().open();
    h.latest().deliver({ type: 'welcome', you: 3, room: 'QK7P', tick: 0, reclaimToken: 'tok' });
    h.latest().deliver({
      type: 'snapshot',
      tick: 240,
      ackSeq: 12,
      payload: encodeSnapshot(240, [], []),
    });

    expect(h.received.map((m) => m.type)).toEqual(['welcome', 'snapshot']);
    expect(h.transport.player).toBe(3);
    const snapshot = h.received[1];
    expect(snapshot?.type === 'snapshot' && snapshot.tick).toBe(240);
  });

  it('drops input while the socket is down instead of buffering a stale tick', () => {
    const h = harness();
    h.latest().open();
    h.latest().drop();

    h.transport.send({ type: 'input', tick: 900, seq: 9, actions: [] });
    // Nothing queued and nothing sent: a bot is flying the ship on the server,
    // and input stamped with ticks the sim already ran would be refused anyway.
    expect(h.sockets[0]?.messages().filter((m) => m.type === 'input')).toHaveLength(0);
  });

  it('redials with backoff and reclaims the seat it was flying (GDD §4.2)', () => {
    const h = harness();
    h.latest().open();
    h.latest().deliver({ type: 'welcome', you: 5, room: 'QK7P', tick: 0, reclaimToken: 'tok-5' });
    h.latest().drop();

    expect(h.transport.state).toBe('reconnecting');
    expect(h.sockets).toHaveLength(1); // nothing dialled yet — it backs off first

    h.tick(500);
    expect(h.sockets).toHaveLength(2);
    h.latest().open();

    // The redial is a *reclaim*: same slot, and the token `welcome` issued.
    expect(h.latest().messages()).toEqual([
      { type: 'join', room: 'QK7P', reclaim: 5, reclaimToken: 'tok-5' },
    ]);
    expect(h.transport.state).toBe('open');
    expect(h.states).toEqual(['open', 'reconnecting', 'open']);
  });

  it('backs off further on each failed attempt', () => {
    const h = harness();
    h.latest().open();
    h.latest().drop();

    h.tick(500); // first retry
    expect(h.sockets).toHaveLength(2);
    h.latest().drop();

    h.tick(500); // too early for the second — it waits twice as long
    expect(h.sockets).toHaveLength(2);
    h.tick(500);
    expect(h.sockets).toHaveLength(3);
  });

  it('gives up when the grace window closes — the seat is the bot’s now', () => {
    const h = harness({ reconnectWindowMs: 3_000 });
    h.latest().open();
    h.latest().deliver({ type: 'welcome', you: 2, room: 'QK7P', tick: 0, reclaimToken: 'tok' });
    h.latest().drop();

    const dialled = h.sockets.length;
    h.tick(4_000); // the whole window passes while the tab is asleep
    expect(h.transport.state).toBe('closed');
    expect(h.sockets).toHaveLength(dialled); // it did not redial into a lost match
  });

  it('never redials after a deliberate close', () => {
    const h = harness();
    h.latest().open();
    h.transport.close();

    expect(h.transport.state).toBe('closed');
    expect(h.sockets[0]?.closedByClient).toBe(true);
    h.tick(60_000);
    expect(h.sockets).toHaveLength(1);
  });
});

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
function harness(
  options: {
    reconnectWindowMs?: number;
    ticket?: string;
    checkRoomAlive?: () => Promise<'live' | 'gone' | 'unknown'>;
  } = {},
): {
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
    ...(options.ticket !== undefined ? { ticket: options.ticket } : {}),
    ...(options.checkRoomAlive !== undefined ? { checkRoomAlive: options.checkRoomAlive } : {}),
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
      ackTick: 238,
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
    expect(h.transport.closeReason).toBe('left');
    expect(h.sockets[0]?.closedByClient).toBe(true);
    h.tick(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('carries the allocator ticket on the first join and on every reclaim (M9 fleet)', () => {
    const h = harness({ ticket: 'payload.sig' });
    h.latest().open();
    expect(h.latest().messages()).toEqual([{ type: 'join', room: 'QK7P', ticket: 'payload.sig' }]);

    h.latest().deliver({ type: 'welcome', you: 4, room: 'QK7P', tick: 0, reclaimToken: 'tok-4' });
    h.latest().drop();
    h.tick(500);
    h.latest().open();
    // A redial is still a join, and in a fleet it must still prove membership.
    expect(h.latest().messages()).toEqual([
      { type: 'join', room: 'QK7P', reclaim: 4, reclaimToken: 'tok-4', ticket: 'payload.sig' },
    ]);
  });

  it('omits the ticket entirely on the direct-connect path (no allocator)', () => {
    const h = harness();
    h.latest().open();
    expect(h.latest().messages()[0]).toEqual({ type: 'join', room: 'QK7P' });
  });

  it('records grace-elapsed when the window closes on a room it could not disprove', () => {
    const h = harness({ reconnectWindowMs: 3_000 });
    h.latest().open();
    h.latest().drop();
    h.tick(4_000);
    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('grace-elapsed');
  });

  it('stops early with room-gone when the allocator says the room has ended (Task 9b)', async () => {
    // The Machine died; a 404 from the allocator is the witness. Retrying the full
    // window would be pointless — stop the instant the probe answers.
    let resolveProbe: (v: 'gone') => void = () => {};
    const probe = new Promise<'gone'>((r) => {
      resolveProbe = r;
    });
    const h = harness({ checkRoomAlive: () => probe });
    h.latest().open();
    h.latest().drop();
    expect(h.transport.state).toBe('reconnecting');
    const dialled = h.sockets.length;

    resolveProbe('gone');
    await probe; // let the .then run
    await Promise.resolve();

    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('room-gone');
    // The pending redial was cancelled: no socket opens against the dead room.
    h.tick(60_000);
    expect(h.sockets).toHaveLength(dialled);
  });

  it('keeps retrying when the probe says the room is still live', async () => {
    const h = harness({ checkRoomAlive: () => Promise.resolve('live') });
    h.latest().open();
    h.latest().drop();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.transport.state).toBe('reconnecting');
    h.tick(500);
    expect(h.sockets).toHaveLength(2); // it redialled, the room being alive
  });

  it('keeps retrying when the probe itself fails — an unreachable allocator is not a dead room', async () => {
    const h = harness({ checkRoomAlive: () => Promise.reject(new Error('allocator down')) });
    h.latest().open();
    h.latest().drop();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.transport.state).toBe('reconnecting');
    h.tick(500);
    expect(h.sockets).toHaveLength(2);
  });

  // --- A refused join is terminal, not a drop (M10 machine-pin lottery) --------

  it('closes on joinError with the reason, and never redials (M10)', () => {
    const h = harness({ ticket: 'sig.tok' });
    h.latest().open();
    expect(h.transport.state).toBe('open');

    // The wrong-machine outcome the pin exists to prevent: the server refuses the
    // join. A dropped socket would recover; this must not — the same ticket would
    // lose the same edge lottery again.
    h.latest().deliver({ type: 'joinError', reason: 'bad-ticket' });

    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('join-rejected');
    expect(h.transport.rejectReason).toBe('bad-ticket');
    // The reason reaches an observer too, so a menu can show specifics.
    expect(h.received.map((m) => m.type)).toContain('joinError');
  });

  it('does not restart the reconnect loop when the server closes the socket after a joinError', () => {
    const h = harness({ ticket: 'sig.tok' });
    h.latest().open();
    h.latest().deliver({ type: 'joinError', reason: 'room-full' });
    // The server closes the socket right after refusing — the exact sequence that,
    // read as a plain drop, spun the 60 s reconnect loop and the eternal spinner.
    h.latest().drop();

    expect(h.transport.state).toBe('closed');
    expect(h.states.filter((s) => s === 'reconnecting')).toHaveLength(0);
    // No redial now, and none when the whole grace window elapses.
    h.tick(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('a mid-reconnect joinError ends the loop instead of burning the window', () => {
    const h = harness({ ticket: 'sig.tok' });
    h.latest().open();
    h.latest().drop();
    expect(h.transport.state).toBe('reconnecting');

    h.tick(500); // the backoff fires a redial
    expect(h.sockets).toHaveLength(2);
    h.latest().open();
    // The redial reaches a wrong machine and is refused: stop, do not keep looping.
    h.latest().deliver({ type: 'joinError', reason: 'bad-ticket' });

    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('join-rejected');
    h.tick(60_000);
    expect(h.sockets).toHaveLength(2); // no further dials
  });
});

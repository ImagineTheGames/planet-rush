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
import { seatMemory } from './seat-memory';
import type { SeatMemory } from './seat-memory';
import { memorySeatStorage } from '../../tests/net/seat-storage';

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
    /** This device's seat memory (a0-133). Absent means the pre-a0-133 transport:
     *  nowhere to write a seat down, so nothing to recall on the first dial. */
    seatMemory?: SeatMemory | null;
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
    // Explicitly null by default rather than merely absent: absent means "take the
    // browser's `localStorage`", and a test that quietly shared one with the next
    // test would be the flakiest thing in this file.
    seatMemory: options.seatMemory ?? null,
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

/**
 * The half of the reconnect rule that only exists because of the developer's
 * zombie-match report: a socket can die **without ever firing `onclose`** (a
 * backgrounded tab), and from in here that is indistinguishable from a quiet
 * moment. `./link-loss` sees the silence; `redial()` is how it acts on it.
 */
describe('WebSocketTransport.redial — the dial nobody asked the socket for', () => {
  it('re-dials a socket that never closed, and reclaims the seat', () => {
    const h = harness();
    h.latest().open();
    h.latest().deliver({ type: 'welcome', you: 2, room: 'QK7P', tick: 0, reclaimToken: 'tok-2' });
    const dead = h.latest();
    // No `drop()`: the socket is "open" and simply stopped delivering, exactly as a
    // throttled tab leaves it. Nothing in the transport would ever notice.
    expect(h.transport.state).toBe('open');

    expect(h.transport.redial()).toBe(true);
    // The zombie is hung up on first, so its late close cannot re-enter the loop.
    expect(dead.closedByClient).toBe(true);
    expect(h.sockets).toHaveLength(2);

    h.latest().open();
    const join = h.latest().messages()[0];
    expect(join).toMatchObject({ type: 'join', room: 'QK7P', reclaim: 2, reclaimToken: 'tok-2' });
    expect(h.transport.state).toBe('open');
  });

  it('a late close from the abandoned socket does not restart the loop', () => {
    const h = harness();
    h.latest().open();
    const dead = h.latest();
    h.transport.redial();
    h.latest().open();
    expect(h.sockets).toHaveLength(2);

    dead.drop(); // arrives seconds late, from a socket nobody is using
    expect(h.transport.state).toBe('open');
    h.tick(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('resets the backoff — a human pressing RECONNECT does not wait out a delay they cannot see', () => {
    const h = harness();
    h.latest().open();
    h.latest().drop();
    h.tick(500);
    h.latest().drop();
    h.tick(1_000); // the backoff has doubled to 1 s and would double again

    h.transport.redial();
    const dialsBefore = h.sockets.length;
    h.latest().drop();
    h.tick(500); // …but the next retry is the *base* delay again
    expect(h.sockets.length).toBe(dialsBefore + 1);
  });

  it('refuses once the grace window is spent, and closes with the reason', () => {
    const h = harness({ reconnectWindowMs: 10_000 });
    h.latest().open();
    h.latest().drop(); // the drop clock starts here
    h.tick(11_000);

    expect(h.transport.redial()).toBe(false);
    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('grace-elapsed');
  });

  it('refuses after a deliberate leave — that door does not reopen', () => {
    const h = harness();
    h.latest().open();
    h.transport.close();
    expect(h.transport.redial()).toBe(false);
    expect(h.sockets).toHaveLength(1);
  });

  it('reports the grace remaining, and nothing at all before a drop', () => {
    const h = harness({ reconnectWindowMs: 10_000 });
    h.latest().open();
    expect(h.transport.graceRemainingMs()).toBeNull();

    h.latest().drop();
    h.tick(3_000);
    expect(h.transport.graceRemainingMs()).toBe(7_000);
  });
});

describe('WebSocketTransport.leave — ABANDON MATCH', () => {
  it('tells the server before hanging up, so the seat is freed not held', () => {
    const h = harness();
    h.latest().open();
    const socket = h.latest();
    h.transport.leave('abandoned');

    expect(socket.messages().map((m) => m.type)).toEqual(['join', 'leave']);
    expect(socket.messages()[1]).toMatchObject({ type: 'leave', reason: 'abandoned' });
    expect(socket.closedByClient).toBe(true);
    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('left');
  });

  it('is still a clean exit when the socket is already gone', () => {
    const h = harness();
    h.latest().open();
    h.latest().drop();
    expect(h.transport.state).toBe('reconnecting');

    h.transport.leave();
    expect(h.transport.state).toBe('closed');
    expect(h.transport.closeReason).toBe('left');
    // And no redial is left pending behind it.
    h.tick(60_000);
    expect(h.sockets).toHaveLength(1);
  });
});

describe('WebSocketTransport — the seat this device wrote down (a0-133)', () => {
  it('dials as a reclaim on the first socket when the device remembers this room', () => {
    // The whole of the a0-133 fix, in one assertion. A page that was never open
    // before — a rebuilt tab after a phone slept, the player typing the code back
    // in — knocks with the seat token the *previous* page was issued, so the room
    // reads a returning player instead of a stranger at a live match's door.
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'QK7P', seat: 5, token: 'tok-5' }, 1_000);

    const h = harness({ seatMemory: seatMemory(device) });
    h.latest().open();
    expect(h.latest().messages()).toEqual([
      { type: 'join', room: 'QK7P', reclaim: 5, reclaimToken: 'tok-5' },
    ]);
  });

  it('knocks as a newcomer when the remembered seat is another room’s', () => {
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'ZZZZ', seat: 5, token: 'tok-5' }, 1_000);

    const h = harness({ seatMemory: seatMemory(device) });
    h.latest().open();
    expect(h.latest().messages()).toEqual([{ type: 'join', room: 'QK7P' }]);
  });

  it('writes the seat down on welcome, and again when RUSH! renumbers it', () => {
    // Two writes, because a seat can move once. RUSH! compacts the roster (a0-11)
    // and tells each client the seat it came out on — so a transport still holding
    // its lobby number would reclaim a chair that is somebody else's, or one that
    // no longer exists, and be refused for a reason the player had no part in.
    const device = memorySeatStorage();
    const h = harness({ seatMemory: seatMemory(device) });
    h.latest().open();
    h.latest().deliver({ type: 'welcome', you: 5, room: 'QK7P', tick: 0, reclaimToken: 'tok-5' });
    expect(seatMemory(device).recall('QK7P', 1_000)).toEqual({
      room: 'QK7P',
      seat: 5,
      token: 'tok-5',
    });

    h.latest().deliver({ type: 'matchStart', tick: 0, seed: 1, slots: [], you: 1 });
    expect(seatMemory(device).recall('QK7P', 1_000)?.seat).toBe(1);
    expect(h.transport.player).toBe(1);

    // …and the redial that follows a drop asks for the seat that was PLAYED.
    h.latest().drop();
    h.tick(500);
    h.latest().open();
    expect(h.latest().messages()[0]).toMatchObject({ reclaim: 1, reclaimToken: 'tok-5' });
  });

  it('falls back to an ordinary join when the room refuses the remembered seat', () => {
    // A credential that outlives its page also outlives its match. Being refused
    // for one must not cost the player the ordinary join they would have had
    // before any of this existed — so the seat is dropped and the door is knocked
    // on again, plainly.
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'QK7P', seat: 2, token: 'stale' }, 1_000);

    const h = harness({ seatMemory: seatMemory(device) });
    h.latest().open();
    const refused = h.latest();
    expect(refused.messages()[0]).toMatchObject({ reclaim: 2 });

    refused.deliver({ type: 'joinError', reason: 'reclaim-expired' } as never);
    // Not terminal, and not reported: the refusal was an answer about a
    // credential, not about this player.
    expect(h.received).toHaveLength(0);
    expect(h.transport.state).not.toBe('closed');
    expect(refused.closedByClient).toBe(true);
    // The stale credential is gone from the device, and the second knock is plain.
    expect(seatMemory(device).recall('QK7P', 1_000)).toBeNull();
    expect(h.sockets).toHaveLength(2);
    h.latest().open();
    expect(h.latest().messages()).toEqual([{ type: 'join', room: 'QK7P' }]);

    // …and *that* answer is the player's, whatever it is. A live match still says
    // the thing it has always said to somebody with nothing to present.
    h.latest().deliver({ type: 'joinError', reason: 'match-live' } as never);
    expect(h.received.map((m) => m.type)).toEqual(['joinError']);
    expect(h.transport.state).toBe('closed');
    expect(h.transport.rejectReason).toBe('match-live');
  });

  it('does not re-knock when the refusal is about the player rather than the seat', () => {
    // `match-live` to a client that had no credential is the front door working.
    // There is no second thing to try, and a redial would only hear it again.
    const h = harness({ seatMemory: seatMemory(memorySeatStorage()) });
    h.latest().open();
    h.latest().deliver({ type: 'joinError', reason: 'match-live' } as never);
    expect(h.sockets).toHaveLength(1);
    expect(h.transport.state).toBe('closed');
    expect(h.transport.rejectReason).toBe('match-live');
  });

  it('forgets the seat when the match it belonged to is over', () => {
    const device = memorySeatStorage();
    seatMemory(device).remember({ room: 'QK7P', seat: 2, token: 'tok-2' }, 1_000);
    const h = harness({ seatMemory: seatMemory(device) });
    h.latest().open();
    h.latest().deliver({ type: 'joinError', reason: 'match-over' } as never);

    // The one refusal that says the seat itself is finished (a0-72): there is
    // nothing for a later page to present it to.
    expect(h.transport.rejectReason).toBe('match-over');
    expect(seatMemory(device).recall('QK7P', 1_000)).toBeNull();
  });

  it('forgets on ABANDON MATCH and remembers through a silent hang-up', () => {
    // The two exits, and they are not the same exit. ABANDON is a *statement*: the
    // seat is freed at once (`server/room.ts` `abandon`), so the credential is dead
    // and is dropped here rather than left to expire.
    const stated = memorySeatStorage();
    const a = harness({ seatMemory: seatMemory(stated) });
    a.latest().open();
    a.latest().deliver({ type: 'welcome', you: 1, room: 'QK7P', tick: 0, reclaimToken: 'tok-1' });
    a.transport.leave('abandoned');
    expect(seatMemory(stated).recall('QK7P', 1_000)).toBeNull();

    // Closing without saying so is a *drop*, and a dropped seat is held for as long
    // as the match runs (a0-72). Forgetting it here would take the ruling back from
    // every player who closed a tab instead of pressing a button — which is exactly
    // the player this brief is about.
    const silent = memorySeatStorage();
    const b = harness({ seatMemory: seatMemory(silent) });
    b.latest().open();
    b.latest().deliver({ type: 'welcome', you: 1, room: 'QK7P', tick: 0, reclaimToken: 'tok-1' });
    b.transport.close();
    expect(seatMemory(silent).recall('QK7P', 1_000)?.token).toBe('tok-1');
  });

  it('forgets the seat once the allocator says the room is gone', () => {
    const device = memorySeatStorage();
    const h = harness({
      seatMemory: seatMemory(device),
      checkRoomAlive: () => Promise.resolve('gone' as const),
    });
    h.latest().open();
    h.latest().deliver({ type: 'welcome', you: 1, room: 'QK7P', tick: 0, reclaimToken: 'tok-1' });
    expect(seatMemory(device).recall('QK7P', 1_000)).not.toBeNull();

    h.latest().drop();
    return Promise.resolve().then(() => {
      h.tick(500);
      expect(h.transport.closeReason).toBe('room-gone');
      // No Machine hosts the code: nobody can reclaim that seat ever again.
      expect(seatMemory(device).recall('QK7P', 1_000)).toBeNull();
    });
  });
});

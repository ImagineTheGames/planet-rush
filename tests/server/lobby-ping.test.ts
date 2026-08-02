/**
 * tests/server/lobby-ping.test.ts — the seat's ping, as authority publishes it.
 * OWNER: Netcode Engineer (ratified developer: "the server measures per-socket
 * RTT already — publish it per seat in lobbyState, rounded ms, ~2s cadence;
 * bots show no ping").
 *
 * The measuring itself is `server/ws.ts`'s (`RttProbe`, tested next door with no
 * network at all). What is asserted here is the *publishing*: which seats get a
 * number, which never do, and how often a still lobby is allowed to talk.
 *
 * The socket seam is what makes this cheap. `ServerSocket.rttMs` is an optional
 * read, so a fake socket in this file dials a round trip up and down by
 * assignment — no timers, no sockets, no clock but the one the test hands
 * `update()`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { LobbySlot, ServerMessage } from '../../src/net/transport';
import type { WireFrame } from '../../src/net/wire';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import { LOBBY_PING_INTERVAL_MS } from '../../server/room';

/** A socket whose round trip the test controls. `rttMs` is a live read on the
 *  room's side, exactly as `server/ws.ts`'s probe is. */
class PingSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  /** What the wire would measure right now — null before the first probe answers,
   *  and again once a measurement goes stale. */
  rtt: number | null = null;
  closed = false;

  get rttMs(): number | null {
    return this.rtt;
  }

  send(frame: WireFrame): void {
    this.frames.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** Every `lobbyState` this socket has been sent, oldest first. */
  rosters(): (readonly LobbySlot[])[] {
    const out: (readonly LobbySlot[])[] = [];
    for (const frame of this.frames) {
      const message: ServerMessage | null = parseServerMessage(frame);
      if (message?.type === 'lobbyState') out.push(message.slots);
    }
    return out;
  }

  /** The most recent roster it was told, or null before any. */
  latest(): readonly LobbySlot[] | null {
    const all = this.rosters();
    return all.length > 0 ? all[all.length - 1]! : null;
  }

  clear(): void {
    this.frames.length = 0;
  }
}

interface Client {
  socket: PingSocket;
  connection: Connection;
}

describe('lobbyState carries each human seat its ping', () => {
  let server: MatchServer;
  let now = 2_000_000;
  let code: string;

  const advance = (ms: number): void => {
    now += ms;
    server.update(now);
  };

  const join = (): Client => {
    const socket = new PingSocket();
    const connection = server.connect(socket);
    connection.receive(encodeClientMessage({ type: 'join', room: code }));
    return { socket, connection };
  };

  beforeEach(() => {
    now = 2_000_000;
    server = new MatchServer({ seed: 0x9111, asteroidCount: 8 });
    server.update(now);
    code = server.createCode();
  });

  it('publishes a measured seat, rounded to whole milliseconds', () => {
    const host = join();
    host.socket.rtt = 41.6;
    host.socket.clear();
    advance(LOBBY_PING_INTERVAL_MS);

    const roster = host.socket.latest();
    expect(roster).not.toBeNull();
    expect(roster![0]!.rtt).toBe(42);
  });

  it('gives every human their own number — eight seats are eight connections', () => {
    const host = join();
    const guest = join();
    host.socket.rtt = 30;
    guest.socket.rtt = 244;
    host.socket.clear();
    advance(LOBBY_PING_INTERVAL_MS);

    const roster = host.socket.latest()!;
    expect(roster[0]!.rtt).toBe(30);
    expect(roster[1]!.rtt).toBe(244);
  });

  it('NEVER puts a number on an unseated (bot-bound) slot — a bot is inside the\n' +
    '     sim, and 0ms beside Vulture would be a lie', () => {
    const host = join();
    host.socket.rtt = 55;
    advance(LOBBY_PING_INTERVAL_MS);

    const roster = host.socket.latest()!;
    // Seat 0 is the human; every other seat of the eight is empty and will be cast.
    expect(roster[0]!.rtt).toBe(55);
    for (const slot of roster.slice(1)) {
      expect(slot.rtt).toBeUndefined();
    }
  });

  it('publishes nothing at all for a socket that has not been measured yet —\n' +
    '     absent, never zero', () => {
    const host = join();
    const roster = host.socket.latest()!;
    expect(roster[0]!.rtt).toBeUndefined();
    // …and a *genuine* zero is still published, because that is a measurement.
    host.socket.rtt = 0;
    host.socket.clear();
    advance(LOBBY_PING_INTERVAL_MS);
    expect(host.socket.latest()![0]!.rtt).toBe(0);
  });

  it('blanks a seat whose socket stopped answering — the roster shows a live\n' +
    '     measurement or nothing, never the last good number forever', () => {
    const host = join();
    host.socket.rtt = 120;
    advance(LOBBY_PING_INTERVAL_MS);
    expect(host.socket.latest()![0]!.rtt).toBe(120);

    host.socket.rtt = null; // the probe went stale
    host.socket.clear();
    advance(LOBBY_PING_INTERVAL_MS);
    expect(host.socket.latest()![0]!.rtt).toBeUndefined();
  });

  it('re-publishes on the ~2s cadence when a number moves, and NOT before it', () => {
    const host = join();
    host.socket.rtt = 60;
    advance(LOBBY_PING_INTERVAL_MS);
    host.socket.clear();

    host.socket.rtt = 61;
    // Inside the cadence: the roster is not re-sent, however much the wire moved.
    advance(LOBBY_PING_INTERVAL_MS - 1);
    expect(host.socket.rosters()).toHaveLength(0);

    advance(1);
    expect(host.socket.rosters()).toHaveLength(1);
    expect(host.socket.latest()![0]!.rtt).toBe(61);
  });

  it('says NOTHING while a still lobby stays still — a roster nobody changed is\n' +
    '     not re-broadcast twice a second', () => {
    const host = join();
    host.socket.rtt = 88;
    advance(LOBBY_PING_INTERVAL_MS);
    host.socket.clear();

    for (let i = 0; i < 10; i++) advance(LOBBY_PING_INTERVAL_MS);
    expect(host.socket.rosters()).toHaveLength(0);
  });

  it('stops sweeping once the match is live — the roster is off screen, and a\n' +
    '     number that moves twice a second has no business near a tick', () => {
    const host = join();
    join(); // a second seat, so the match can start
    host.socket.rtt = 70;
    advance(LOBBY_PING_INTERVAL_MS);
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    advance(1);
    expect(server.room(code)?.state).toBe('live');
    host.socket.clear();

    host.socket.rtt = 300;
    for (let i = 0; i < 5; i++) advance(LOBBY_PING_INTERVAL_MS);
    expect(host.socket.rosters()).toHaveLength(0);
  });

  it('costs a socket that cannot measure nothing — the seam is optional, and a\n' +
    '     transport with no wire to time simply has no ping', () => {
    // A socket implementing only the two ratified methods: no `rttMs` at all.
    const bare: ServerSocket = { send: () => {}, close: () => {} };
    const connection = server.connect(bare);
    connection.receive(encodeClientMessage({ type: 'join', room: code }));
    const watcher = join();
    advance(LOBBY_PING_INTERVAL_MS);

    const roster = watcher.socket.latest()!;
    expect(roster[0]!.rtt).toBeUndefined();
  });
});

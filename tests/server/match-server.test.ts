/**
 * tests/server/match-server.test.ts — the room, the bots, and the sixty seconds
 * a dropped player has to come back. OWNER: Netcode Engineer (GDD §4.2).
 *
 * The match server has no clock and no sockets of its own — time arrives as an
 * argument and sockets arrive as a two-method interface (`server/room.ts`) — so
 * everything below runs in-process, in microseconds, with a wall clock this file
 * makes up. A sixty-second reconnect window is a variable here, which is exactly
 * why it was built that way.
 *
 * Lives under `tests/` rather than beside the code because the vitest include
 * globs (`vite.config.ts`, owned by the Platform Engineer) cover `tests/**` and
 * `src/**`, and the Netcode Engineer does not edit other agents' files.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { decodeSnapshot } from '../../src/net/snapshot';
import type { ServerMessage } from '../../src/net/transport';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { TICK_DT } from '../../src/sim';
import { signTicket } from '../../src/net/ticket';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import { seatBots } from './seat-bots';

const GRACE_MS = 60_000;

/** A socket that keeps what it was sent. The whole network layer, for a test. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  closed = false;

  send(frame: WireFrame): void {
    this.frames.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** Every frame this socket could parse as a server message. */
  messages(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const frame of this.frames) {
      const message = parseServerMessage(frame);
      if (message) out.push(message);
    }
    return out;
  }

  first<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.messages().find((m) => m.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }

  /** Frames the ratified `ServerMessage` union does not cover — `joinError`. */
  errors(): { type: string; reason: string }[] {
    return this.frames
      .filter((f): f is string => typeof f === 'string')
      .map((f) => JSON.parse(f) as { type: string; reason: string })
      .filter((m) => m.type === 'joinError');
  }

  clear(): void {
    this.frames.length = 0;
  }
}

/** A client: a socket plus the connection the server gave it. */
interface Client {
  socket: FakeSocket;
  connection: Connection;
}

describe('the authoritative match server', () => {
  let server: MatchServer;
  let now = 1_000_000;

  const advance = (ms: number): void => {
    now += ms;
    server.update(now);
  };

  const connect = (): Client => {
    const socket = new FakeSocket();
    return { socket, connection: server.connect(socket) };
  };

  const join = (client: Client, room: string): void => {
    client.connection.receive(encodeClientMessage({ type: 'join', room }));
  };

  beforeEach(() => {
    now = 1_000_000;
    // A fixed seed: room codes, reclaim tokens and every world are the same
    // on every run (GDD §4.1 — nothing in this process reaches for
    // `Math.random()` or a clock it was not handed).
    server = new MatchServer({ seed: 0x5eed, graceMs: GRACE_MS, asteroidCount: 12 });
    server.update(now);
  });

  // --- Rooms and codes ----------------------------------------------------

  it('opens a room on an unknown code and seats the next client in the same room', () => {
    const code = server.createCode();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    const host = connect();
    join(host, code);
    const guest = connect();
    join(guest, code);

    expect(server.roomCount).toBe(1);
    expect(host.connection.room).toBe(guest.connection.room);
    expect(host.socket.first('welcome')?.you).toBe(0);
    expect(guest.socket.first('welcome')?.you).toBe(1);
    // The code is typed off someone's screen: case and whitespace are forgiven.
    const late = connect();
    join(late, `  ${code.toLowerCase()} `);
    expect(late.connection.room).toBe(host.connection.room);
  });

  it('refuses a ninth client — eight stations, eight seats (GDD §2.1)', () => {
    const code = server.createCode();
    for (let i = 0; i < 8; i++) join(connect(), code);
    const ninth = connect();
    join(ninth, code);

    expect(ninth.connection.room).toBeNull();
    expect(ninth.socket.errors()[0]?.reason).toBe('room-full');
  });

  it('drops a frame carrying a code that is not a code, and opens nothing', () => {
    const client = connect();
    join(client, 'not a code!');

    // The front door rejects it before it is a message at all (`src/net/wire`),
    // so the room registry never hears about it: a malformed frame costs its
    // sender its own packet and nothing else. Telling the player their code was
    // mistyped is the lobby's job — it validates the same alphabet client-side.
    expect(server.roomCount).toBe(0);
    expect(client.connection.room).toBeNull();
    expect(client.socket.frames).toHaveLength(0);
  });

  // --- Starting the match -------------------------------------------------

  it('fills every empty seat with a bot server-side, so three humans still fight an eight-station war', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    join(connect(), code);
    join(connect(), code);

    host.connection.receive(seatBots());

    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    const room = host.connection.room!;

    expect(room.state).toBe('live');
    expect(room.world?.ships).toHaveLength(8);
    expect(room.world?.stations).toHaveLength(8);
    const lobby = room.lobbyState();
    expect(lobby.filter((s) => s.isBot)).toHaveLength(5);
    expect(lobby.filter((s) => !s.isBot).map((s) => s.player)).toEqual([0, 1, 2]);
    // Every bot seat names its difficulty, so the lobby can show the cast.
    for (const slot of lobby.filter((s) => s.isBot)) {
      expect(['easy', 'medium', 'hard']).toContain(slot.botDifficulty);
    }
  });

  it('honours the creator alone: "host" is a lobby word, not a network role', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    const guest = connect();
    join(guest, code);

    guest.connection.receive(seatBots());

    guest.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    expect(host.connection.room?.state).toBe('lobby');

    host.connection.receive(seatBots());

    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    expect(host.connection.room?.state).toBe('live');
  });

  it('locks the hull picked in the lobby into the ship that spawns (GDD §2.11)', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    // The roster first, then the hull: a later `lobbyChoice` that names no seats
    // leaves the roster alone, but one that names no hull would reset it (a0-11).
    host.connection.receive(seatBots());
    host.connection.receive(
      encodeClientMessage({
        type: 'lobbyChoice',
        shipClass: ShipClass.Hauler,
        fireMode: 'manual',
        botDifficulties: ['hard', 'hard', 'hard', 'hard', 'hard', 'hard', 'hard'],
      }),
    );
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));

    expect(host.connection.room?.world?.ships[0]?.shipClass).toBe(ShipClass.Hauler);
    // The creator's difficulty list is honoured seat by seat (GDD §2.1).
    for (const slot of host.connection.room!.lobbyState().filter((s) => s.isBot)) {
      expect(slot.botDifficulty).toBe('hard');
    }
  });

  it('refuses a client that tries to walk into a match already in progress', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    host.connection.receive(seatBots());
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));

    const latecomer = connect();
    join(latecomer, code);
    expect(latecomer.connection.room).toBeNull();
    expect(latecomer.socket.errors()[0]?.reason).toBe('match-live');
  });

  // --- The clock ----------------------------------------------------------

  it('turns elapsed wall-clock time into whole fixed 60 Hz ticks', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    host.connection.receive(seatBots());
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    const room = host.connection.room!;

    advance(16); // the first update after start only sets the clock
    expect(room.world?.tick).toBe(0);

    advance(200);
    expect(room.world?.tick).toBe(Math.floor(0.2 / TICK_DT));

    // A long stall does not become one enormous burst: the catch-up is bounded
    // so a descheduled process cannot freeze every other room in it.
    const before = room.world!.tick;
    advance(10_000);
    expect(room.world!.tick - before).toBeLessThanOrEqual(30);
  });

  it('streams snapshots that decode back into the ships the server is simulating', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    host.connection.receive(seatBots());
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    const room = host.connection.room!;
    host.socket.clear();
    advance(16);
    advance(100);

    const snapshots = host.socket.messages().filter((m) => m.type === 'snapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    const latest = snapshots[snapshots.length - 1]!;
    if (latest.type !== 'snapshot') throw new Error('unreachable');

    const decoded = decodeSnapshot(latest.payload);
    expect(decoded.tick).toBe(latest.tick);
    expect(decoded.ships).toHaveLength(8);
    // Positions are quantized to integers on the wire (docs/netcode-spike.md),
    // so the client's read is the server's truth to within a world unit.
    const first = room.world!.ships[0]!;
    expect(decoded.ships[0]?.posX).toBe(Math.round(first.pos.x));
    expect(decoded.ships[0]?.posY).toBe(Math.round(first.pos.y));
  });

  // --- Reconnect grace (GDD §4.2) -----------------------------------------

  /** A started match with two humans, the second of which is about to drop. */
  const liveMatch = (): { code: string; host: Client; guest: Client } => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    const guest = connect();
    join(guest, code);
    host.connection.receive(seatBots());
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    advance(16);
    advance(500);
    return { code, host, guest };
  };

  const drop = (client: Client): void => client.connection.close(now);

  const rejoin = (code: string, slot: PlayerId, token: string | undefined): Client => {
    const client = connect();
    client.connection.receive(
      encodeClientMessage({
        type: 'join',
        room: code,
        reclaim: slot,
        ...(token !== undefined ? { reclaimToken: token } : {}),
      }),
    );
    return client;
  };

  it('substitutes a bot the instant a player drops, and tells the room', () => {
    const { host, guest } = liveMatch();
    host.socket.clear();
    drop(guest);

    const substituted = host.socket.first('playerSubstituted');
    expect(substituted?.player).toBe(1);
    expect(substituted?.graceSeconds).toBe(GRACE_MS / 1000);
    expect(host.connection.room!.lobbyState()[1]?.isBot).toBe(true);
    // The match keeps its shape: the seat is still flying, and still stepping.
    const before = host.connection.room!.world!.tick;
    advance(200);
    expect(host.connection.room!.world!.tick).toBeGreaterThan(before);
  });

  it('gives the ship back with its cargo, its bank and its upgrades intact', () => {
    const { code, host, guest } = liveMatch();
    const token = guest.socket.first('welcome')?.reclaimToken;
    expect(token).toBeTypeOf('string');

    // Mark the ship the way a match would: ore in the hold, ore in the bank, a
    // widened cargo bay from an upgrade, and a dented hull.
    const room = host.connection.room!;
    const ship = room.world!.ships[1]!;
    ship.cargo = 4;
    ship.banked = 17;
    ship.cargoCap = 6;
    ship.hull = 31;

    drop(guest);
    advance(30_000); // half the window: away long enough to matter

    const back = rejoin(code, 1, token);
    expect(back.connection.player).toBe(1);
    expect(back.connection.room).toBe(room);

    // The same ship object, never removed, never respawned — only the hands on
    // it changed (GDD §4.2 "reclaim their ship, with all upgrades intact").
    expect(room.world!.ships[1]).toBe(ship);
    // The ship's WEALTH is intact across the reclaim — but the split can shift:
    // while the substitute bot parks the seat at its own station, the v0.1.2
    // auto-deposit rule bleeds a little of the hold into the safe bank (field
    // report ore-deposit). Reclaim preserves the ship, not a frozen hold/bank
    // ledger, so assert the conserved total rather than the exact halves.
    expect(ship.cargo + ship.banked).toBeCloseTo(21, 9);
    expect(ship.cargoCap).toBe(6);
    expect(ship.hull).toBe(31);

    // The bot lets go, and the room is told.
    expect(room.lobbyState()[1]?.isBot).toBe(false);
    expect(host.socket.messages().some((m) => m.type === 'playerReclaimed')).toBe(true);
  });

  it('re-teaches a reclaiming client the map it has been away from', () => {
    const { code, guest } = liveMatch();
    const token = guest.socket.first('welcome')?.reclaimToken;
    drop(guest);
    advance(5_000);

    const back = rejoin(code, 1, token);
    const messages = back.socket.messages();
    expect(messages[0]?.type).toBe('welcome');
    expect(messages.some((m) => m.type === 'matchStart')).toBe(true);
    // Static entities are events on join, not a stream (GDD §4.2): a returning
    // client is handed every station and every rock still on the map.
    const events = messages.filter((m) => m.type === 'entityEvent');
    expect(events.some((m) => m.kind === 'station')).toBe(true);
    expect(events.some((m) => m.kind === 'asteroid')).toBe(true);
    expect(messages.some((m) => m.type === 'snapshot')).toBe(true);
  });

  it('will not hand a held seat to whoever knows the room code', () => {
    const { code, guest } = liveMatch();
    drop(guest);

    // The code is shared with the whole classroom by design, so the code alone
    // must not be the credential: the token issued in `welcome` is.
    const thief = rejoin(code, 1, 'not-the-token');
    expect(thief.connection.room).toBeNull();
    expect(thief.socket.errors()[0]?.reason).toBe('reclaim-denied');

    const forgetful = rejoin(code, 1, undefined);
    expect(forgetful.connection.room).toBeNull();
    expect(forgetful.socket.errors()[0]?.reason).toBe('reclaim-denied');
  });

  it('closes the window after ~60 seconds and lets the bot keep the seat', () => {
    const { code, host, guest } = liveMatch();
    const token = guest.socket.first('welcome')?.reclaimToken;
    drop(guest);

    advance(GRACE_MS - 1_000);
    expect(host.connection.room!.hasPendingReclaim).toBe(true);
    expect(host.connection.room!.graceRemaining(1, now)).toBeGreaterThan(0);

    advance(2_000); // the window closes
    expect(host.connection.room!.hasPendingReclaim).toBe(false);

    const late = rejoin(code, 1, token);
    expect(late.connection.room).toBeNull();
    expect(late.socket.errors()[0]?.reason).toBe('reclaim-expired');
    // The match plays on, eight ships, with a bot in that seat for good.
    expect(host.connection.room!.lobbyState()[1]?.isBot).toBe(true);
    expect(host.connection.room!.world?.ships).toHaveLength(8);
  });

  it('refuses a reclaim for a seat nobody dropped, and for a room that never existed', () => {
    const { code, host } = liveMatch();
    const token = host.socket.first('welcome')?.reclaimToken;

    const impostor = rejoin(code, 0, token);
    expect(impostor.socket.errors()[0]?.reason).toBe('reclaim-denied');

    const nowhere = rejoin('ZZZZ', 0, token);
    expect(nowhere.socket.errors()[0]?.reason).toBe('reclaim-unknown');
  });

  it('frees the seat outright when a client leaves the lobby (nothing to reclaim yet)', () => {
    const code = server.createCode();
    const host = connect();
    join(host, code);
    const guest = connect();
    join(guest, code);

    drop(guest);
    const room = host.connection.room!;
    expect(room.hasPendingReclaim).toBe(false);
    expect(room.lobbyState()[1]?.isBot).toBe(false);
    expect(room.lobbyState()[1]?.ready).toBe(false);

    // And the freed seat is handed straight to the next arrival.
    const replacement = connect();
    join(replacement, code);
    expect(replacement.connection.player).toBe(1);
  });

  it('sweeps a room once nobody is in it and nobody may come back', () => {
    const { host, guest } = liveMatch();
    drop(host);
    drop(guest);
    expect(server.roomCount).toBe(1); // both seats are still held

    advance(GRACE_MS + 1_000);
    expect(server.roomCount).toBe(0);
  });

  // --- Variable room size (variable-slots Tasks C1 & C2) ------------------

  describe('variable match size', () => {
    it('opens two rooms at different sizes on one server, simultaneously (C1)', () => {
      // The size is per-room now, not a process-global default: a four-station
      // duel-plus and a full eight-station war coexist in one process.
      const four = server.openRoom('SML4', { size: 4 })!;
      const eight = server.openRoom('BIG8', { size: 8 })!;
      expect(four.size).toBe(4);
      expect(eight.size).toBe(8);
      expect(server.roomCount).toBe(2);
    });

    it('refuses the (N+1)th join with room-full — a closed seat is one that never existed (C2)', () => {
      // "Closing" a lobby slot is resolved to a smaller N before it reaches the
      // server (dense-roster discipline, spike §S2): a size-4 room simply has
      // four seats, so the fifth arrival is refused exactly as a full 8 would be.
      const code = 'FOUR';
      server.openRoom(code, { size: 4 });
      for (let i = 0; i < 4; i++) join(connect(), code);
      const fifth = connect();
      join(fifth, code);
      expect(fifth.connection.room).toBeNull();
      expect(fifth.socket.errors()[0]?.reason).toBe('room-full');
    });

    it('builds an N-station world and seats no bot beyond N (C2)', () => {
      const code = 'FOUR';
      const room = server.openRoom(code, { size: 4 })!;
      const host = connect();
      join(host, code);
      host.connection.receive(seatBots());
      host.connection.receive(encodeClientMessage({ type: 'startMatch' }));

      // Four seats: one human, three bots — a four-station war, not an eight.
      expect(room.world?.ships).toHaveLength(4);
      expect(room.world?.stations).toHaveLength(4);
      const lobby = room.lobbyState();
      expect(lobby).toHaveLength(4);
      expect(lobby.filter((s) => s.isBot)).toHaveLength(3);
      // A dense FFA roster: each ship its own team, contiguous 0..3.
      expect(room.world?.ships.map((s) => s.id)).toEqual([0, 1, 2, 3]);
      expect(room.world?.ships.map((s) => s.team)).toEqual([0, 1, 2, 3]);
    });

    it('reads a new room\'s size from the signed ticket on an enforcing Machine (C1)', () => {
      // In a fleet, the allocator decides the size and signs it; the Machine
      // trusts the ticket, not a size a client could name for itself.
      const SECRET = 'allocator-and-machine-share-this';
      const enforcing = new MatchServer({ seed: 0x5eed, ticketSecret: SECRET, machineId: 'm-1' });
      enforcing.update(now);
      const code = enforcing.createCode();
      const ticket = signTicket(
        { room: code, machine: 'm-1', expiresAt: now + 30_000, size: 6, mode: 'ffa' },
        SECRET,
      );

      const socket = new FakeSocket();
      const connection = enforcing.connect(socket);
      connection.receive(encodeClientMessage({ type: 'join', room: code, ticket }));

      expect(connection.room?.size).toBe(6);
      expect(connection.room?.mode).toBe('ffa');
    });

    it('ignores a size a client tries to smuggle in without a signed ticket (C1)', () => {
      // No ticket secret here, so there is no allocator decision to honour and no
      // config to read: the room opens at the process default, never at whatever a
      // raw join might claim. (The join message has no size field at all — this
      // pins that the *only* channel for size is the signed ticket.)
      const code = server.createCode();
      const host = connect();
      join(host, code);
      expect(host.connection.room?.size).toBe(8); // MATCH_SLOTS default
    });
  });
});

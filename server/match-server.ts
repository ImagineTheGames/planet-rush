/**
 * server/match-server.ts — the authoritative match server. OWNER: Netcode
 * Engineer (GDD §3.5, §4.2).
 *
 * A small authoritative Node server holds all simulation authority: clients send
 * input ticks, the server runs the one true sim and broadcasts state, clients
 * interpolate (GDD §4.2). This file is the part of it that knows about *rooms
 * and connections*; `./room.ts` is the part that knows about a match.
 *
 * **It never imports PixiJS.** It runs the sim with no GPU, no canvas and no
 * window (GDD §4.1) — the imports below are `src/sim/`, `src/bots/` and
 * `src/net/`, and nothing else. That is a hard rule, not a preference: the
 * moment a renderer type leaks into this process, the server stops being
 * deployable as a plain Node container.
 *
 * **Nothing vendor-specific, and no ambient state.** There is no `Date.now()`,
 * no `setInterval`, no `Math.random()`, and no socket implementation in this
 * file. The clock arrives as an argument to {@link MatchServer.update}, sockets
 * arrive as the tiny {@link ServerSocket} interface, and randomness arrives as an
 * injected seed. `server/index.ts` supplies all three from plain Node built-ins.
 * That is what makes the server a **plain Dockerized Node process with zero
 * vendor APIs** — the actual requirement behind the host choice (GDD §4.2,
 * risk 1: "portability is the mitigation, not the vendor") — and, not
 * incidentally, what lets a test watch a sixty-second reconnect window pass in
 * a microsecond.
 *
 * The room lifecycle in one paragraph: a client connects and sends `join` with
 * a room code; an unknown code **creates** that room (a lobby word — the creator
 * picks bot difficulties and presses start, and is otherwise a client like any
 * other, GDD §4.2), a known code joins it. Empty seats fill with bots when the
 * match starts. A dropped client's seat is held for the reconnect-grace window
 * while a bot flies it, and comes back with its ship and upgrades intact
 * (GDD §4.2). Rooms with nobody left in them are swept.
 */

import type { PlayerId, Rng } from '@shared/types';
import { mulberry32 } from '@shared/types';
import type { ClientMessage, RoomCode } from '../src/net/transport';
import { makeRoomCode } from '../src/net/room-code';
import { verifyTicket } from '../src/net/ticket';
import type { MachineId } from '../src/net/ticket';
import { parseClientMessage, parseRoomCode } from '../src/net/wire';
import type { WireFrame } from '../src/net/wire';
import type { Bounds } from '../src/sim';
import { MatchRoom } from './room';
import type { JoinRejection, RoomConfig, ServerSocket } from './room';

export type { ServerSocket, JoinRejection } from './room';
export { MatchRoom } from './room';

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

// The room-code rules (alphabet, length, generation) live in `src/net/room-code.ts`
// so the allocator in front of several match servers can mint codes without a
// second copy of them. Re-exported here because they were part of this module's
// surface before the move.
export { CODE_ALPHABET, CODE_LENGTH } from '../src/net/room-code';

/** Bytes of entropy in a reclaim token (hex-encoded, so twice this in chars). */
const TOKEN_BYTES = 12;

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * One live client, from the server's side. The connection — never the message
 * body — is the source of truth for *which slot is speaking*: a client that
 * could name its own player id could steer someone else's ship.
 */
export interface Connection {
  /** Feed one raw inbound frame. Anything malformed is dropped, not trusted. */
  receive(frame: WireFrame): void;
  /** The socket went away (or the client left). Starts reconnect grace if the
   *  connection was seated in a live match (GDD §4.2). */
  close(nowMs: number): void;
  /** The room this connection is seated in, or null before it has joined. */
  readonly room: MatchRoom | null;
  /** The slot this connection is flying, or null before it has joined. */
  readonly player: PlayerId | null;
}

/** Why the server refused a connection's join, as sent back to the client. */
export interface JoinErrorMessage {
  type: 'joinError';
  reason: JoinRejection | 'bad-room-code' | 'bad-ticket';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How to stand the server up. Everything ambient is injected (see the header). */
export interface MatchServerConfig {
  /**
   * Seed for room codes, reclaim tokens, and every match's world. The process
   * entry point derives it from the clock once, at boot; a test passes a
   * constant and gets a server that behaves the same way every run.
   */
  readonly seed: number;
  /** Seats per match. Default 8 (GDD §2.1). */
  readonly slots?: number;
  /** Reconnect grace, ms (GDD §4.2, ~60 s TUNABLE). */
  readonly graceMs?: number;
  /** Play bounds for every match in this process. */
  readonly bounds?: Bounds;
  /** Asteroids per wave — lets the harness run cramped worlds. */
  readonly asteroidCount?: number;
  /** Ceiling on concurrent rooms, so one enthusiastic client cannot spend the
   *  host's memory creating empty lobbies. */
  readonly maxRooms?: number;
  /**
   * The allocator↔Machine shared key (`src/net/ticket.ts`). Its **presence is the
   * only switch** for ticket enforcement (M9 fleet membership): set, and every
   * join must carry a ticket the allocator signed for *this* Machine and *this*
   * room; unset — the solo/offline path, or a self-hosted single server — and
   * joins are admitted with no ceremony, because with one Machine there is no
   * routing decision to sign. Supplied from `TICKET_SECRET` by `server/index.ts`.
   */
  readonly ticketSecret?: string;
  /**
   * This Machine's id (`MACHINE_ID`, falling back to `FLY_MACHINE_ID`), the value
   * the allocator names in a ticket. When enforcing, a ticket signed for a
   * *different* Machine is refused — one Machine will not honour another's ticket.
   */
  readonly machineId?: MachineId;
}

/** Default room ceiling. Eight players × this is comfortably inside a free-tier
 *  ARM core's budget at the measured per-room cost (docs/netcode-spike.md). */
export const DEFAULT_MAX_ROOMS = 64;

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export class MatchServer {
  private readonly rooms = new Map<RoomCode, MatchRoom>();
  private readonly rng: Rng;
  private readonly maxRooms: number;
  private readonly ticketSecret: string | undefined;
  private readonly machineId: MachineId | undefined;
  /** The last clock reading {@link update} was given. Joins arrive *between*
   *  updates and the grace window is measured in real seconds, so this is the
   *  server's notion of "now" — never a clock this module read itself. */
  private clockMs = 0;

  constructor(private readonly config: MatchServerConfig) {
    this.rng = mulberry32(config.seed >>> 0);
    this.maxRooms = config.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.ticketSecret = config.ticketSecret;
    this.machineId = config.machineId;
  }

  /** Rooms currently alive in this process. */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** The most rooms this process will host — the ceiling a heartbeat reports as
   *  its capacity so the allocator places under it (M9). */
  get capacity(): number {
    return this.maxRooms;
  }

  /** True when this Machine is enforcing tickets — i.e. a `TICKET_SECRET` is set
   *  and it is part of a fleet behind an allocator. */
  get enforcingTickets(): boolean {
    return this.ticketSecret !== undefined;
  }

  /**
   * Every room this process hosts and how many humans are in it — the room list a
   * heartbeat carries so the allocator can locate rooms and read load (M9).
   */
  roomLoads(): { code: RoomCode; players: number }[] {
    const loads: { code: RoomCode; players: number }[] = [];
    for (const [code, room] of this.rooms) loads.push({ code, players: room.humanCount });
    return loads;
  }

  /**
   * Does this Machine admit a join for `code` bearing `ticket`? The **presence of
   * a ticket secret is the only switch** (M9 fleet membership):
   *
   *  - No secret → admit unconditionally. A solo/offline client never reaches
   *    this server, and a self-hosted single Machine has no allocator to sign a
   *    ticket, so demanding one would refuse every honest join.
   *  - Secret set → the join must carry a ticket the allocator signed, still
   *    inside its window, naming *this* room and (when known) *this* Machine.
   *    Anything else — missing, forged, tampered, expired, or issued for a
   *    different room or Machine — is refused. It **fails closed**: a doubt is a
   *    refusal, never an admission.
   *
   * Expiry is judged against {@link MatchServer.now}, the server's own injected
   * clock, so a test controls the window exactly.
   */
  admitsJoin(code: RoomCode, ticket: string | undefined): boolean {
    if (this.ticketSecret === undefined) return true;
    if (ticket === undefined) return false;
    const claims = verifyTicket(ticket, this.ticketSecret, this.now);
    if (claims === null) return false;
    if (claims.room !== code) return false;
    // A ticket names the Machine it was minted for; one Machine will not honour
    // another's. Skip only when this process was not told its own id.
    if (this.machineId !== undefined && claims.machine !== this.machineId) return false;
    return true;
  }

  /** The server's clock: the last reading {@link update} was handed. */
  get now(): number {
    return this.clockMs;
  }

  /** Look up a room by code — the lobby's "is this code real?" question. */
  room(code: RoomCode): MatchRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /**
   * Accept a socket. The returned {@link Connection} is the only handle the
   * transport layer needs: feed it frames, and tell it when the socket dies.
   */
  connect(socket: ServerSocket): Connection {
    return new ServerConnection(this, socket);
  }

  /**
   * Advance every room by the elapsed wall-clock time and sweep the dead ones.
   * Driven by the process loop; see the header on why the clock is a parameter.
   */
  update(nowMs: number): void {
    this.clockMs = nowMs;
    for (const [code, room] of this.rooms) {
      room.update(nowMs);
      // A room is garbage when nobody is in it and nobody may still come back:
      // an abandoned lobby, or a match everyone walked out of (GDD §4.2 grace).
      if (room.humanCount === 0 && !room.hasPendingReclaim) this.rooms.delete(code);
    }
  }

  /** Create the room a code names, or return the one that already exists. */
  openRoom(code: RoomCode): MatchRoom | null {
    const existing = this.rooms.get(code);
    if (existing) return existing;
    if (this.rooms.size >= this.maxRooms) return null;
    const room = new MatchRoom(this.roomConfig(code));
    this.rooms.set(code, room);
    return room;
  }

  /** A fresh, unused, human-typable room code (GDD §4.2 "shareable code"). */
  createCode(): RoomCode {
    // Bounded retry: with a million codes and a classroom's worth of rooms, a
    // collision is a curiosity, not a scenario — but an unbounded loop is a
    // hang, so it gives up and lets the caller refuse rather than spin.
    for (let attempt = 0; attempt < 64; attempt++) {
      const code = makeRoomCode(this.rng);
      if (!this.rooms.has(code)) return code;
    }
    return '';
  }

  private roomConfig(code: RoomCode): RoomConfig {
    return {
      code,
      // Every room gets its own world seed, drawn from the server's one stream.
      seed: Math.floor(this.rng.next() * 0xffff_ffff) >>> 0,
      ...(this.config.slots !== undefined ? { slots: this.config.slots } : {}),
      ...(this.config.graceMs !== undefined ? { graceMs: this.config.graceMs } : {}),
      ...(this.config.bounds ? { bounds: this.config.bounds } : {}),
      ...(this.config.asteroidCount !== undefined
        ? { asteroidCount: this.config.asteroidCount }
        : {}),
      makeToken: () => this.makeToken(),
    };
  }

  /** An opaque per-seat secret for the reconnect-grace rule (GDD §4.2). Drawn
   *  from the server's seeded stream — the server owns its randomness in one
   *  place, and a test can make it predictable. */
  private makeToken(): string {
    let token = '';
    for (let i = 0; i < TOKEN_BYTES; i++) {
      token += Math.floor(this.rng.next() * 256)
        .toString(16)
        .padStart(2, '0');
    }
    return token;
  }
}

// ---------------------------------------------------------------------------
// One connection
// ---------------------------------------------------------------------------

class ServerConnection implements Connection {
  private seatedRoom: MatchRoom | null = null;
  private seat: PlayerId | null = null;
  private closed = false;

  constructor(
    private readonly server: MatchServer,
    private readonly socket: ServerSocket,
  ) {}

  get room(): MatchRoom | null {
    return this.seatedRoom;
  }

  get player(): PlayerId | null {
    return this.seat;
  }

  receive(frame: WireFrame): void {
    if (this.closed) return;
    // The front door: shape, range, and size are validated before a message
    // reaches a room, and a frame that fails costs its sender its own packet
    // and nothing else (`src/net/wire`).
    const message = parseClientMessage(frame);
    if (!message) return;

    if (message.type === 'join') {
      this.handleJoin(message);
      return;
    }
    if (this.seatedRoom === null || this.seat === null) return; // not seated yet
    this.seatedRoom.receive(this.seat, message);
  }

  close(nowMs: number): void {
    if (this.closed) return;
    this.closed = true;
    if (this.seatedRoom !== null && this.seat !== null) {
      this.seatedRoom.disconnect(this.seat, nowMs);
    }
  }

  /**
   * `join` is the one message the connection handles itself, because it is the
   * message that decides which room and which slot everything *else* belongs to.
   *
   * An unknown code creates the room. That is deliberate and is what makes a
   * classroom match one step: the creator types (or is given) a code, shares it,
   * and everyone else joins it — there is no separate "create room" verb to get
   * out of sync with (GDD §4.2).
   */
  private handleJoin(message: Extract<ClientMessage, { type: 'join' }>): void {
    if (this.seatedRoom !== null) return; // already seated; a second join is a no-op

    const code = parseRoomCode(message.room);
    if (code === null) {
      this.refuse('bad-room-code');
      return;
    }

    // The ticket gate comes *before* the room is touched: a join this Machine was
    // never sent must not even be able to create a room (M9 fleet membership). On
    // a Machine that is not enforcing, this admits everything and costs nothing.
    if (!this.server.admitsJoin(code, message.ticket)) {
      this.refuse('bad-ticket');
      return;
    }

    const room =
      message.reclaim !== undefined ? (this.server.room(code) ?? null) : this.server.openRoom(code);
    if (!room) {
      this.refuse(message.reclaim !== undefined ? 'reclaim-unknown' : 'room-full');
      return;
    }

    const outcome = room.join(
      this.socket,
      {
        ...(message.reclaim !== undefined ? { reclaim: message.reclaim } : {}),
        ...(message.reclaimToken !== undefined ? { reclaimToken: message.reclaimToken } : {}),
      },
      this.server.now,
    );
    if (!outcome.ok) {
      this.refuse(outcome.reason);
      return;
    }
    this.seatedRoom = room;
    this.seat = outcome.player;
  }

  private refuse(reason: JoinErrorMessage['reason']): void {
    // `joinError` is a server→client courtesy outside the ratified
    // `ServerMessage` union: a client that does not know it simply ignores an
    // unknown `type`, and one that does can say "that code is full" instead of
    // "connection failed".
    this.socket.send(JSON.stringify({ type: 'joinError', reason } satisfies JoinErrorMessage));
  }
}

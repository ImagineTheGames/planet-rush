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
import { readTicket, verifyTicket } from '../src/net/ticket';
import type { MachineId } from '../src/net/ticket';
import { parseClientMessage, parseRoomCode } from '../src/net/wire';
import type { WireFrame } from '../src/net/wire';
import type { Bounds, MatchMode } from '../src/sim';
import { MAX_MATCH_SIZE, MIN_MATCH_SIZE } from '../src/sim';
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

/**
 * Default room ceiling, and the capacity a Machine advertises to the allocator.
 *
 * **Measured over the real wire, against the guest's quota** — m11-01,
 * `docs/server-capacity.md`. A full 8-seat room (1 human + 7 Hard bots, real
 * sockets, 30 Hz snapshots) costs **~4.7 ms of CPU per second of wall clock**.
 * A `shared-cpu-1x` — what `fly.gameserver.toml` deploys — is metered at
 * **6.25% of a core sustained**, i.e. 62.5 ms/s. At 70% of that, less the
 * ~5.9 ms/s the empty process draws, **8 rooms fit**; less a 25% margin, **6**.
 *
 * This replaces 32, which was not careless but was measured against the wrong
 * budget. `tests/harness/fleet-density.test.ts` timed the *sim* (0.047 ms per
 * room-tick — the wire, the bots' fan-out, snapshot encoding and the control
 * path are not in a bare `step()`, and together they are 1.7× again) and then
 * compared 32 rooms against **one whole core's** 16.67 ms frame. 45% of a core
 * is seven times a `shared-cpu-1x`'s entire sustained quota: the Machine would
 * have throttled long before the loop noticed, and every room on it together.
 *
 * The loop is **not** the binding constraint on a shared guest — 40 rooms held a
 * 5.5 ms p99 loop lag on a full core — so this ceiling tracks the CPU quota, and
 * any Machine with a different quota MUST set `MAX_ROOMS` (`server/index.ts`).
 * The €4 VPS fallback has a real core and wants ~100; a `shared-cpu-2x` wants 12.
 * The default is deliberately wrong for those, in the safe direction:
 * under-advertising costs capacity, over-advertising costs every player at once.
 *
 * `tests/net/capacity/capacity-regression.test.ts` gates the per-room cost this
 * number is derived from, so it cannot drift back without CI saying so.
 */
export const DEFAULT_MAX_ROOMS = 6;

/**
 * The per-room shape a *new*-room join asks for (variable-slots Task C1): the
 * match size (N) and mode. Both are optional — a join that carries neither opens
 * a room at this process's default {@link MatchServerConfig.slots} and `'ffa'`.
 */
export interface RoomOpenOptions {
  readonly size?: number;
  readonly mode?: MatchMode;
}

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
   * Every room this process hosts, with the truth a heartbeat carries so the
   * allocator can locate rooms, read load, and *advertise* them (M9; variable-slots
   * Task C3): each room's human count, its size (N) and mode, and the seats a new
   * human can still take. The size/mode/joinableSeats fields are what let a lobby
   * show or refuse a room before dialing (`Allocator.roomInfo`).
   */
  roomLoads(): {
    code: RoomCode;
    players: number;
    size: number;
    mode: MatchMode;
    joinableSeats: number;
    listed?: boolean;
  }[] {
    const loads = [];
    for (const [code, room] of this.rooms) {
      loads.push({
        code,
        players: room.humanCount,
        size: room.size,
        mode: room.mode,
        joinableSeats: room.joinableSeats,
        // Only a room whose host said PRIVATE spends the bytes (a0-26 D1):
        // absent reads as listed on the far side, which is the ruled default and
        // is also exactly what a pre-a0-26 Machine sends.
        ...(room.listed ? {} : { listed: false }),
      });
    }
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
   *
   * ── THE ONE EXCEPTION: A RETURNING PLAYER (a0-72) ─────────────────────────
   *
   * `reclaiming` marks a join that names a seat and carries that seat's token, and
   * for it the **expiry alone is not a refusal** when this Machine is already
   * hosting the room. That is not a hole; it is the recognition that the ticket
   * answers a different question from the one being asked:
   *
   *   • the ticket answers *which Machine hosts this room* — a routing decision,
   *     and one this Machine can check against its own room table rather than
   *     against a clock. If the room is here, the decision was right, whenever it
   *     was signed.
   *   • the **`reclaimToken`** answers *is this seat yours*, and it is the
   *     server's own per-seat secret (`server/room.ts` `reclaim`), unexpired and
   *     unforgeable. It is checked immediately after this gate, always.
   *
   * The developer's report is the cost of conflating them: a phone whose screen
   * blanked for 35 seconds came back to a live match with its seat still held and
   * a bot flying it, and was told **REFUSED** — because the pass minted for the
   * first dial had lapsed at 30 s (`allocator/allocator.ts`
   * `DEFAULT_TICKET_TTL_MS`), and a lapsed pass and a forged pass were the same
   * answer here. A backgrounded phone is the ordinary case, not an edge case.
   *
   * Everything else still fails closed. A forged, tampered or malformed ticket
   * never reaches the expiry test at all ({@link readTicket} rejects it on the
   * signature); a ticket for another room or another Machine is refused as it
   * always was; a *fresh* join on a lapsed ticket is refused as it always was; and
   * a lapsed ticket for a room this Machine does not host is refused, because then
   * the routing claim it makes is exactly the claim that cannot be checked. What a
   * lapsed ticket buys a returning player is the right to present their token.
   */
  admitsJoin(code: RoomCode, ticket: string | undefined, reclaiming = false): boolean {
    if (this.ticketSecret === undefined) return true;
    if (ticket === undefined) return false;
    // Signature and shape first, and without the clock, so "is this genuine?" and
    // "is this fresh?" can be answered separately (`src/net/ticket.ts`).
    const claims = readTicket(ticket, this.ticketSecret);
    if (claims === null) return false;
    if (claims.room !== code) return false;
    // A ticket names the Machine it was minted for; one Machine will not honour
    // another's. Skip only when this process was not told its own id.
    if (this.machineId !== undefined && claims.machine !== this.machineId) return false;
    if (this.now < claims.expiresAt) return true;
    // Lapsed: only a reclaim, and only into a room this Machine actually holds.
    return reclaiming && this.rooms.has(code);
  }

  /**
   * Must this join be **refused** rather than allowed to open a room (a0-26
   * Milestone A)? True for exactly one case: a ticket the allocator signed with
   * `intent: 'join'` naming a code this process does not host.
   *
   * `openRoom` creating an unknown code is load-bearing — it is how HOST works —
   * so the room-creating join and the room-expecting join cannot be told apart by
   * anything the *client* says. The allocator says it instead, in the one channel
   * a client cannot forge (`src/net/ticket.ts` `TicketClaims.intent`): a ticket
   * from `POST /rooms` says `create`, a ticket from a join or a listing tap says
   * `join`. So a room that ended inside the last heartbeat is refused here
   * instead of being silently resurrected as an empty lobby.
   *
   * **Everything else is unchanged, on purpose.** No secret (the self-hosted and
   * solo paths), no ticket, an unreadable ticket, a ticket for another room, or a
   * ticket with no intent at all — all `false`, which means "carry on exactly as
   * this Machine always has". The claim only ever *adds* a refusal, and only when
   * the allocator explicitly said this was a join.
   */
  refusesUnknownRoom(code: RoomCode, ticket: string | undefined): boolean {
    if (this.ticketSecret === undefined || ticket === undefined) return false;
    const claims = verifyTicket(ticket, this.ticketSecret, this.now);
    if (claims === null || claims.room !== code) return false;
    return claims.intent === 'join' && this.room(code) === undefined;
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

  /**
   * Create the room a code names at the requested size/mode, or return the one
   * that already exists. `options` shapes only a *newly created* room — a join to
   * an existing code lands in the room as it already stands, whatever size it was
   * opened at, because the room's shape is fixed the moment it is created (its
   * first join). This is what makes the room's size a single, stable fact for the
   * whole match rather than something a later joiner could renegotiate.
   */
  openRoom(code: RoomCode, options: RoomOpenOptions = {}): MatchRoom | null {
    const existing = this.rooms.get(code);
    if (existing) return existing;
    if (this.rooms.size >= this.maxRooms) return null;
    const room = new MatchRoom(this.roomConfig(code, options));
    this.rooms.set(code, room);
    return room;
  }

  /**
   * The room-open options a *new*-room join carries, read from its signed ticket
   * (variable-slots Task C1). Only a ticket the allocator signed for *this* room
   * is trusted for the room's shape — a size a client could name for itself is a
   * size an attacker names for someone else's room. When this Machine is not
   * enforcing tickets (the solo/self-hosted path) there is no allocator to sign a
   * config, so the room opens at the process default. A size outside the legal
   * 2..8 range is dropped defensively even though the allocator already clamps it,
   * so a bad ticket degrades to a default room rather than one the sim cannot build.
   */
  roomOptionsFromTicket(code: RoomCode, ticket: string | undefined): RoomOpenOptions {
    if (this.ticketSecret === undefined || ticket === undefined) return {};
    const claims = verifyTicket(ticket, this.ticketSecret, this.now);
    if (claims === null || claims.room !== code) return {};
    const options: { size?: number; mode?: MatchMode } = {};
    if (
      typeof claims.size === 'number' &&
      Number.isInteger(claims.size) &&
      claims.size >= MIN_MATCH_SIZE &&
      claims.size <= MAX_MATCH_SIZE
    ) {
      options.size = claims.size;
    }
    if (claims.mode === 'ffa' || claims.mode === 'teams') options.mode = claims.mode;
    return options;
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

  private roomConfig(code: RoomCode, options: RoomOpenOptions = {}): RoomConfig {
    // Per-room size wins over the process default; mode defaults to `'ffa'` unless
    // the ticket named teams (variable-slots Task C1).
    const slots = options.size ?? this.config.slots;
    return {
      code,
      // Every room gets its own world seed, drawn from the server's one stream.
      seed: Math.floor(this.rng.next() * 0xffff_ffff) >>> 0,
      ...(slots !== undefined ? { slots } : {}),
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
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
  /**
   * What the ROOM is handed instead of the raw socket (a0-11).
   *
   * Everything on it delegates, bar one addition: `reseat`. RUSH! compacts the
   * roster (`server/room.ts` `startMatch` — the seats nobody is in are not in the
   * match, and the survivors are renumbered so no sparse id reaches the sim), and
   * every message this connection routes afterwards is routed by {@link seat}. A
   * connection that never heard about the renumbering would file one player's
   * input against another player's ship, which is a bug with no symptom until
   * somebody's thrust moves somebody else.
   *
   * A wrapper rather than making this class a `ServerSocket`: the two interfaces
   * both spell a method `close`, and they mean different things by it (the
   * connection's takes the clock and vacates a seat; the socket's hangs up).
   */
  private readonly roomSocket: ServerSocket;

  constructor(
    private readonly server: MatchServer,
    private readonly socket: ServerSocket,
  ) {
    const raw = socket;
    this.roomSocket = {
      send: (frame) => raw.send(frame),
      close: () => raw.close(),
      // A getter, not a copy: the probe's reading moves under us, and the room
      // publishes whatever is current at the instant it builds a broadcast.
      get rttMs(): number | null {
        return raw.rttMs ?? null;
      },
      reseat: (player) => {
        if (this.seatedRoom !== null) this.seat = player;
      },
    };
  }

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
    // A reclaim is held to the same ticket as any join, bar its expiry — see
    // `admitsJoin` for why a returning player's lapsed pass is still a good
    // routing claim, and why their seat token is what actually lets them in.
    if (!this.server.admitsJoin(code, message.ticket, message.reclaim !== undefined)) {
      this.refuse('bad-ticket');
      return;
    }

    // A join that was allocated to an *existing* room does not get to create one
    // (a0-26 Milestone A). This sits above `openRoom` rather than inside it
    // because `openRoom`'s create-on-unknown-code is how HOST works and must not
    // move; what changes is only that a ticket saying `join` is held to it.
    if (
      message.reclaim === undefined &&
      this.server.refusesUnknownRoom(code, message.ticket)
    ) {
      this.refuse('room-gone');
      return;
    }

    // A reclaim reaches for an existing room and never reshapes it; a fresh join
    // opens the room at the size/mode its signed ticket names (variable-slots C1).
    const room =
      message.reclaim !== undefined
        ? (this.server.room(code) ?? null)
        : this.server.openRoom(code, this.server.roomOptionsFromTicket(code, message.ticket));
    if (!room) {
      this.refuse(message.reclaim !== undefined ? 'reclaim-unknown' : 'room-full');
      return;
    }

    const outcome = room.join(
      // The room is handed the wrapper, not the raw socket: it is how RUSH!'s
      // roster compaction reaches back and moves this connection's seat (a0-11).
      this.roomSocket,
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

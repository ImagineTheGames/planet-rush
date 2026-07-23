/**
 * src/net/transport.ts — the `Transport` interface SKETCH.
 *
 * OWNER: Netcode Engineer (GDD §3.5, §4.2). Day-0 spike deliverable: **types
 * only, no implementation yet**. The two implementations land mid-week —
 * `LocalLoopback` (solo / offline) and `WebSocketTransport` (online). The
 * simulation consumes ordered input ticks and never knows which transport it is
 * talking to (GDD §4.2); everything the sim needs from the network crosses this
 * one seam.
 *
 * "Host" is a lobby word, not a network role (GDD §4.2): every client — the
 * room creator included — speaks this same interface. The server holds all
 * authority; clients send input and receive snapshots + events.
 *
 * Wire encoding note: only ships and projectiles stream as **binary snapshots**
 * (see `./spike/snapshot.ts` — measured 510-byte worst case). Static entities
 * (asteroids, turrets, shields, wrecks) and all lobby/room state travel as
 * **events** — modeled below as structured messages, serialized as JSON or a
 * compact binary tag by the implementation; the sketch keeps them as typed
 * objects so the contract is legible.
 *
 * This file is fully erasable (type-only imports) and pins down no runtime
 * behavior — it is the contract the implementations and the Director review
 * against, not code that runs.
 */

import type { Action, PlayerId, ShipClass } from '@shared/types';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Monotonic server simulation tick index (60 Hz sim; GDD §4.1). */
export type Tick = number;

/** A room's shareable join code, created from the lobby (GDD §4.2). */
export type RoomCode = string;

/** Bot difficulty picked per empty slot by the room creator (GDD §2.1, §2.9). */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** Fire mode is a per-player setting on every platform (GDD §2.4). */
export type FireMode = 'manual' | 'auto';

/** Connection lifecycle, including the reconnect-grace window (GDD §4.2). */
export type ConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

/**
 * Create or join a room by code. `reclaim` drives the reconnect-grace rule
 * (GDD §4.2): within ~60 s of a drop, the same player rejoins the same match by
 * room code and reclaims its ship and upgrades from the substituting bot.
 */
export interface JoinMessage {
  type: 'join';
  room: RoomCode;
  /** Present when rejoining mid-match to reclaim a slot (reconnect grace). */
  reclaim?: PlayerId;
}

/** Lobby choices before RUSH!: ship class and, for the creator, bot difficulty. */
export interface LobbyChoiceMessage {
  type: 'lobbyChoice';
  shipClass: ShipClass;
  fireMode: FireMode;
  /** Only honored from the room creator; ignored otherwise (GDD §4.2). */
  botDifficulties?: readonly BotDifficulty[];
}

/** The room creator starts the match (fills empty slots with bots server-side). */
export interface StartMatchMessage {
  type: 'startMatch';
}

/**
 * Ordered input for one client tick — the only high-frequency client message.
 * `seq` is the client input sequence the server echoes in `SnapshotMessage.ackSeq`
 * so the client can reconcile prediction (GDD §4.2). Tiny on the wire: a handful
 * of `Action`s per tick.
 */
export interface InputMessage {
  type: 'input';
  tick: Tick;
  seq: number;
  actions: readonly Action[];
}

/** Everything a client can send. */
export type ClientMessage =
  | JoinMessage
  | LobbyChoiceMessage
  | StartMatchMessage
  | InputMessage;

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

/** Assigned slot + authoritative room identity on (re)join. */
export interface WelcomeMessage {
  type: 'welcome';
  you: PlayerId;
  room: RoomCode;
  /** Server tick the client should predict from. */
  tick: Tick;
}

/** One slot's public lobby state (GDD §2.1 lobby; §5.2 player colors). */
export interface LobbySlot {
  player: PlayerId;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  shipClass: ShipClass;
  ready: boolean;
}

/** Full lobby snapshot, broadcast on any change before the match starts. */
export interface LobbyStateMessage {
  type: 'lobbyState';
  slots: readonly LobbySlot[];
}

/** RUSH! — the match countdown resolved; the sim is now live. */
export interface MatchStartMessage {
  type: 'matchStart';
  tick: Tick;
  seed: number; // shared RNG seed so prediction matches authority (GDD §4.1)
}

/**
 * A binary state snapshot: ships + projectiles for one tick, encoded per
 * `./spike/snapshot.ts`. `ackSeq` closes the prediction/reconciliation loop.
 * The transport surfaces the raw buffer; the client decodes it.
 */
export interface SnapshotMessage {
  type: 'snapshot';
  tick: Tick;
  ackSeq: number;
  payload: ArrayBuffer;
}

/**
 * Static-entity events — asteroids, turrets, shields, wrecks — sent on join and
 * on change rather than streamed every tick (GDD §4.2). `kind` names the entity
 * class; `data` is the entity-specific payload the sim applies. Kept structural
 * in the sketch; the implementation picks a compact encoding.
 */
export interface EntityEventMessage {
  type: 'entityEvent';
  tick: Tick;
  kind: 'asteroid' | 'turret' | 'shield' | 'wreck' | 'planet';
  op: 'spawn' | 'update' | 'destroy';
  data: unknown;
}

/** A player dropped; a bot has taken their slot for the grace window (GDD §4.2). */
export interface PlayerSubstitutedMessage {
  type: 'playerSubstituted';
  player: PlayerId;
  /** Seconds remaining to rejoin by room code and reclaim the ship. */
  graceSeconds: number;
}

/** A dropped player rejoined within grace and reclaimed their ship + upgrades. */
export interface PlayerReclaimedMessage {
  type: 'playerReclaimed';
  player: PlayerId;
}

/** The match ended; `winner` is null on the (degenerate) no-survivor case. */
export interface MatchEndMessage {
  type: 'matchEnd';
  winner: PlayerId | null;
  tick: Tick;
}

/** Everything a client can receive. */
export type ServerMessage =
  | WelcomeMessage
  | LobbyStateMessage
  | MatchStartMessage
  | SnapshotMessage
  | EntityEventMessage
  | PlayerSubstitutedMessage
  | PlayerReclaimedMessage
  | MatchEndMessage;

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The one interface the simulation talks to for networking. Both `LocalLoopback`
 * (runs the authoritative sim in-process, zero network) and `WebSocketTransport`
 * (one persistent WebSocket to the match server) implement it identically, so
 * the sim and client are transport-agnostic (GDD §4.2). If TCP head-of-line
 * blocking ever bites (risk 3), a UDP-over-WebRTC transport drops in behind this
 * same interface — transport work, not a rewrite.
 */
export interface Transport {
  /** Current connection state (drives the reconnect-grace UI). */
  readonly state: ConnectionState;

  /** Send a client message. Ordering of `InputMessage`s is preserved. */
  send(message: ClientMessage): void;

  /** Register the handler the transport calls for each inbound server message. */
  onMessage(handler: (message: ServerMessage) => void): void;

  /** Register a connection-state change handler (open / reconnecting / closed). */
  onStateChange(handler: (state: ConnectionState) => void): void;

  /** Close the connection (leaves the room; ends any reclaim window). */
  close(): void;
}

/**
 * src/net/transport.ts — the `Transport` interface.
 *
 * OWNER: Netcode Engineer (GDD §3.5, §4.2). Written as a day-0 spike
 * deliverable and unchanged since: `LocalLoopback` (solo / offline, in
 * `./loopback.ts`) implements it as written, and `WebSocketTransport` (online)
 * lands behind the same shape. The simulation consumes ordered input ticks and
 * never knows which transport it is talking to (GDD §4.2); everything the sim
 * needs from the network crosses this one seam.
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
// Implementation notes, recorded where the contract is read:
//   • `Transport` says nothing about who owns the world, because that differs
//     by implementation: `LocalLoopback` holds the authoritative sim in-process
//     and exposes it through `LocalAuthority` (./loopback.ts), while an online
//     client will keep a predicted world and reconcile it against `snapshot`.
//   • Message *ordering* is the transport's promise; message *tick order* is
//     not. Late, duplicate, and far-future input is filed and judged by the
//     shared `InputQueue` (./input-queue.ts) on the authoritative side.

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
  /**
   * The opaque token this client was issued in its `welcome` (see
   * {@link WelcomeMessage.reclaimToken}), presented to prove it is the same
   * player coming back. A room code is shared by design — it is printed on
   * screen for the whole classroom — so the code alone must not be enough to
   * take over a slot that is merely inside its grace window (GDD §4.2).
   */
  reclaimToken?: string;
  /**
   * The allocator's signed routing decision (`src/net/ticket.ts`), presented so
   * a Machine can refuse a join it was never sent (M9 fleet membership). In a
   * fleet, "which Machine hosts this room?" is a decision the allocator makes and
   * signs; a client that could pick for itself could land on someone else's
   * Machine or a room it was never allocated. Absent on the solo/offline path and
   * on any self-hosted server that runs without a `TICKET_SECRET` — there is only
   * one Machine, so there is no decision to sign.
   */
  ticket?: string;
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

/**
 * The per-player economy the streaming wire never carries. Ships and projectiles
 * stream every tick (`./snapshot`), but a ship's **wallet** — the ore in its hold,
 * the ore it has banked, and the upgrade tiers it bought (DAMAGE/SPEED weapon
 * tiers among them) — is match-lifetime state maintained by *deterministic replay
 * of the player's own input*: the client runs the same `step()` the server does,
 * so its predicted wallet tracks authority without a byte on the wire, and
 * `applySnapshot` deliberately leaves it untouched (`./prediction`).
 *
 * That replay only holds while the player is flying. Across a reconnect the
 * substituting bot mines, banks and upgrades on the authoritative ship, and the
 * reclaiming client rebuilds a **fresh** world with a naked ship (`./session`
 * `beginPredicting`) — there is no input history that would reproduce the wallet.
 * Without this, a reclaimed seat comes back with an empty hold and tier-0 stats
 * (QA m10 "economy-not-on-wire", GDD §4.2 "same cargo, same banked ore, same
 * upgrades"). So the welcome carries the wallet, and the returning client stamps
 * it onto its ship before predicting a single tick.
 *
 * The welcome is one statement, made once; {@link EconomyMessage} is how it stays
 * true for the rest of the match, on the ticks authority moves it.
 */
export interface PlayerEconomy {
  /** Ore currently in the hold (`Ship.cargo`). */
  held: number;
  /** Ore safely banked, never lost to ship death (`Ship.banked`). */
  banked: number;
  /**
   * Tiers bought per upgrade track, keyed by `UpgradeTrack` value (`Ship.tiers`).
   * The client restores every track it recognizes and recomputes the derived
   * stats those tiers scale (max hull, cargo capacity).
   */
  tiers: Readonly<Record<string, number>>;
}

/** Assigned slot + authoritative room identity on (re)join. */
export interface WelcomeMessage {
  type: 'welcome';
  you: PlayerId;
  room: RoomCode;
  /** Server tick the client should predict from. */
  tick: Tick;
  /**
   * A per-slot secret to present as {@link JoinMessage.reclaimToken} when
   * rejoining inside the grace window (GDD §4.2). Absent from `LocalLoopback`,
   * which has no connection to lose and nothing to prove.
   */
  reclaimToken?: string;
  /**
   * This slot's wallet as authority holds it right now (`PlayerEconomy`). Present
   * only when the room already has a live ship for the slot — i.e. on a *reclaim*
   * welcome (GDD §4.2), where the returning client must be handed the cargo, bank
   * and upgrades it earned before the drop. Absent on a lobby join (no ship yet)
   * and from `LocalLoopback` (authority is in-process — nothing to restore).
   */
  economy?: PlayerEconomy;
}

/** One slot's public lobby state (GDD §2.1 lobby; §5.2 player colors). */
export interface LobbySlot {
  player: PlayerId;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  shipClass: ShipClass;
  ready: boolean;
  /**
   * The side this slot fights for (variable-slots Task C4). FFA is teams-of-one,
   * so `team === player`; TEAMS shares one `team` across allies. Optional so a
   * `LobbySlot` a pre-teams client builds still satisfies the type — an absent
   * team reads as FFA (the slot's own id). Allegiance is static match config, so
   * it rides this low-frequency lobby message, never the per-tick snapshot
   * (spike §S2, Trap 7).
   */
  team?: number;
}

/** Full lobby snapshot, broadcast on any change before the match starts. */
export interface LobbyStateMessage {
  type: 'lobbyState';
  slots: readonly LobbySlot[];
}

/**
 * RUSH! — the match countdown resolved; the sim is now live.
 *
 * This message is the client's **world constructor call**. Prediction is only
 * "available because the sim is deterministic and the client runs the same code
 * the server does" (GDD §4.2), and running the same code means being handed the
 * same arguments: the seed, the seated roster in slot order, and the two world
 * dimensions a room may override. A client that guessed any of them would build
 * a different arena and reconcile against it forever.
 */
export interface MatchStartMessage {
  type: 'matchStart';
  tick: Tick;
  seed: number; // shared RNG seed so prediction matches authority (GDD §4.1)
  /** Every seat as the server seated it — humans and bots alike, in slot order,
   *  each with the hull the lobby locked in (GDD §2.11). */
  slots: readonly MatchStartSlot[];
  /** Play bounds, when the room overrode the sim default. */
  bounds?: { width: number; height: number };
  /** Asteroids per wave, when the room overrode the sim default. */
  asteroidCount?: number;
}

/** One seat at RUSH!, as the world was built from it. */
export interface MatchStartSlot {
  player: PlayerId;
  shipClass: ShipClass;
  /**
   * The side this seat fights for (variable-slots Task C4) — the client threads
   * it into `createWorld` so its predicted world groups allies exactly as the
   * server's authoritative world does. FFA is teams-of-one (`team === player`);
   * optional, and an absent team defaults to the seat's own id at world-build
   * (`makeShip`), so a pre-teams roster is byte-identical to today. Static config:
   * it rides RUSH!, never the snapshot (spike §S2, Trap 7).
   */
  team?: number;
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
  /**
   * The sim tick at which the input named by {@link ackSeq} was **actually
   * simulated** — the other half of the ack, and the only way a client can learn
   * whether the server ran its press when it thought it would.
   *
   * A predicting client stamps every input with the tick it predicted it at, and
   * the server files it under that same tick (`./input-queue`) — *usually*. Late
   * arrivals are re-filed onto the next unsimulated tick (`server/room.ts`), so a
   * stalled wire can leave a press running several ticks after the tick it was
   * predicted for; the client then replays it at one tick and authority ran it at
   * another, and every reconcile pays the difference back. That is invisible from
   * either end alone — the client knows only what it predicted, the server only
   * what it ran — so the server states it and the client subtracts
   * (`./telemetry` `appliedDeltaMean`, the M10 tick-alignment instrument).
   *
   * Zero before this slot has had any input simulated.
   */
  ackTick: Tick;
  payload: ArrayBuffer;
}

/**
 * Static-entity events — asteroids, turrets, shields, satellites, wrecks — sent
 * on join and on change rather than streamed every tick (GDD §4.2). `kind` names
 * the entity class; `data` is the entity-specific payload the sim applies. Kept
 * structural in the sketch; the implementation picks a compact encoding.
 *
 * `'satellite'` was added by the M10 netcode audit, which found the kind missing
 * and the structure it names therefore invisible in every online match
 * (docs/netcode-audit.md §6, gap 2). Additive: an unrecognized kind was already
 * dropped rather than guessed at, so the only code that had to change is the
 * code that wanted to see one.
 *
 * `'ship'` is the M10 lifecycle wire, and it is the one kind here that is *not* a
 * static entity — which is the point. A ship's position streams thirty times a
 * second, but the two instants that matter most about it, **the tick it died and
 * the tick it comes back**, were on no channel at all: the snapshot spends one bit
 * on "alive" and says nothing about the five-second respawn clock behind it. So a
 * predicting client ran that clock itself, from a `respawnTimer` that started at
 * zero, and revived the ship on the very next tick — a live ghost flying against a
 * corpse authority had not moved, and a correction that grows with every second the
 * real countdown still has to run (the developer's t=63 s capture: corr 0.5 → 288
 * → 509 u, mispred 1.0, for five seconds). Death and respawn are **events**: they
 * happen a handful of times a match, they carry a tick rather than a position, and
 * they are exactly what this channel is for (GDD §4.2). See
 * `./entity-events` `ShipLifecycleData`.
 */
export interface EntityEventMessage {
  type: 'entityEvent';
  tick: Tick;
  kind: 'asteroid' | 'turret' | 'shield' | 'satellite' | 'wreck' | 'station' | 'ship';
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

/**
 * **The wallet's own low-frequency channel** — one slot's {@link PlayerEconomy}
 * as authority holds it at `tick`, sent to that slot alone, immediately ahead of
 * the snapshot for the same tick and only when a value actually changed.
 *
 * The reclaim `welcome` hands the wallet back once, at world-build; this keeps it
 * true for the rest of the match. Two things move a predicted wallet off
 * authority's and neither is a reconnect:
 *
 *  - **Replay re-earns.** Reconciliation rewinds the clock and replays every
 *    unacknowledged input on top of authority (`./prediction`), but the snapshot
 *    carries no wallet, so a rewind cannot put the hold back the way it puts the
 *    position back. Ore tractored in during those ticks is therefore banked once
 *    per reconcile it survives — an error that compounds with RTT rather than
 *    decaying.
 *  - **Divergent deaths.** Hull comes from the wire, so a ship can die on
 *    authority (half its hold lost, GDD §2.3) on a tick prediction had it alive.
 *    Nothing local ever charges the client for that ore.
 *
 * Either way the drift is *permanent* and it is not cosmetic: the buy button
 * reads the predicted bank, so a client that thinks it is one ore richer than it
 * is sends an upgrade the server refuses, and from then on the two disagree about
 * the ship's stats as well as its wallet. So the wallet re-bases from this message
 * inside the same rewind/replay that corrects position — the client's own unacked
 * mining is still replayed on top, so nothing it just earned reads as lost.
 *
 * Cheap by construction: one slot's frame, ~140 bytes of JSON, and only on the
 * ticks a wallet moves (mining, banking, a purchase) — nothing while a ship is
 * merely flying and fighting, against the snapshot stream's own ~15 KB/s
 * (docs/netcode-spike.md). It is state, not a diff: the whole wallet every time,
 * so a client that missed one is corrected by the next rather than desynced.
 */
export interface EconomyMessage {
  type: 'economy';
  /** The slot this wallet belongs to. Always the recipient's own seat — a client
   *  is never told a rival's cargo or bank (the same discipline as scouted station
   *  health, GDD §2.2). */
  player: PlayerId;
  /** The authoritative tick this wallet was read at. The client applies it during
   *  the reconcile for that tick, so replay lands on top of it rather than under
   *  it (`./prediction` `stageEconomy`). */
  tick: Tick;
  economy: PlayerEconomy;
}

/**
 * **What authority did with one order** — the echo that closes the loop a client
 * sequence id opens (`@shared/types` `OrderId`, `./order-ledger`).
 *
 * Sent to the ordering slot alone, on the tick the order was actually simulated,
 * and only for an order that carried an id. It is the smallest message in the
 * protocol that is *not* optional: without it a client can only ever guess whether
 * the turret it is watching assemble is real, and the developer's playtest is what
 * guessing looks like — *"turrets built instantly and I built 2 but 3 got built."*
 *
 * Three facts, and each one is load-bearing:
 *
 *  - **`accepted`** — the sim acted, or the sim refused (unaffordable, undocked,
 *    capped). A refusal is stated rather than inferred from silence, so the
 *    prediction is taken back at once instead of at the TTL.
 *  - **`tick`** — the **authoritative birth tick**. A predicted build re-bases its
 *    construction clock onto this, which is why an online turret takes the sim's
 *    real ten seconds (GDD §2.5) instead of finishing one round trip early.
 *  - **`build`** — the job the order queued, when it queued one, so the client's
 *    predicted job can *become* authority's job (same id, same clock) rather than
 *    stand beside it. Absent for BANK, REPAIR, a ship upgrade and a turret-tier
 *    step, which spawn nothing.
 *
 * Low-frequency by construction: a player taps a wheel a few dozen times a match,
 * against a snapshot stream of thirty frames a second (docs/netcode-spike.md).
 */
export interface OrderEchoMessage {
  type: 'orderEcho';
  /** The slot the order came from — always the recipient's own seat. */
  player: PlayerId;
  /** The client sequence id the order carried (`@shared/types` `OrderId`). */
  orderId: number;
  /** True when the simulation acted on it. */
  accepted: boolean;
  /** The authoritative tick it was simulated on — the birth tick of anything it
   *  spawned. */
  tick: Tick;
  /** The build job it queued, when it queued one. */
  build?: {
    id: number;
    remaining: number;
    total: number;
  };
}

/** The match ended; `winner` is null on the (degenerate) no-survivor case. */
export interface MatchEndMessage {
  type: 'matchEnd';
  winner: PlayerId | null;
  tick: Tick;
}

/**
 * The server refused this connection's join and will seat no ship for it: a bad
 * or expired ticket, a full room, an unknown room code (`server/match-server.ts`
 * `JoinErrorMessage`, whose `reason` is a stricter union — typed `string` here so
 * this module stays below the server layer that owns those constants).
 *
 * The reason it earns a place in the union is a reconnect distinction, not a new
 * feature. A dropped socket is *recoverable* — a bot holds the seat and the
 * transport redials for the grace window (GDD §4.2). A refused join is *terminal*:
 * the same ticket redialled would lose the same edge lottery again, so
 * `WebSocketTransport` must stop and surface the reason rather than burn sixty
 * seconds hammering — which is exactly what left a lost coin-flip stuck on
 * "connecting" (M10). It was a server→client courtesy outside the original
 * ratified union; adding it lets the client tell "refused" from "dropped" and
 * offer RETRY (a fresh allocate) / BACK instead of a spinner that never resolves.
 */
export interface JoinErrorMessage {
  type: 'joinError';
  /** Why the join was refused, verbatim from the server for the player to read. */
  reason: string;
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
  | EconomyMessage
  | OrderEchoMessage
  | MatchEndMessage
  | JoinErrorMessage;

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

/**
 * src/net/loopback.ts — `LocalLoopback`, the offline `Transport`. OWNER:
 * Netcode Engineer (GDD §3.5, §4.2).
 *
 * The solo/offline half of the two implementations behind the one `Transport`
 * seam (GDD §4.2). It runs the authoritative simulation **in-process**: there is
 * no socket, no server, and no network, but there is still a room, a lobby, a
 * welcome, ordered input ticks, and binary snapshots — the client speaks exactly
 * the same protocol it will speak to the WebSocket match server.
 *
 * That is the whole point, and it is a design requirement rather than a
 * convenience: *"The simulation consumes ordered input ticks and never knows
 * which one it is talking to"* (GDD §4.2). Offline is not a shortcut path
 * around the netcode — it is the netcode with the wire removed. The offline
 * solo game is a complete product on its own (GDD §4.3 constraint 2, risk 6),
 * so this is the transport most matches will actually run on.
 *
 * **Who drives the clock.** Online, the server owns the tick and the client's
 * input arrives as it may. Offline there is no server clock, so the local
 * client's input *is* the pulse: an `InputMessage` from the driving slot
 * advances the authoritative sim to that tick. One client tick in, one sim tick
 * run — which is why "ticks through the loopback" and "ticks stepped directly"
 * are the same world, asserted in `loopback.test.ts`.
 *
 * **Ordering is not assumed, it is enforced.** Every message is filed through
 * the shared {@link InputQueue}, the same one the match server uses: input is
 * applied to the tick it names, players are handed to the sim in slot order
 * regardless of arrival order, and late/duplicate/absurd-future input is
 * dropped rather than allowed to bend the timeline (GDD §4.8).
 *
 * **Not here yet, on purpose:** reconnect grace and bot substitution (GDD §4.2)
 * are properties of a connection that can drop — an in-process call cannot, and
 * `LocalLoopback` never reports `reconnecting`. Static-entity events land with
 * the WebSocket transport, where a client must rebuild state it did not
 * simulate; offline the client reads the authoritative world it already owns.
 */

import type { PlayerId } from '@shared/types';
import { createWorld, step, TICK_DT } from '../sim';
import type { World, WorldConfig } from '../sim';
import { InputQueue } from './input-queue';
import type { InputStats } from './input-queue';
import { encodeWorldSnapshot } from './snapshot';
import type {
  ClientMessage,
  ConnectionState,
  InputMessage,
  LobbySlot,
  RoomCode,
  ServerMessage,
  Tick,
  Transport,
} from './transport';

/** The snapshot broadcast divisor: one snapshot every 2 ticks of the 60 Hz sim
 *  = 30 Hz, the rate the day-0 spike decided on (docs/netcode-spike.md). */
export const DEFAULT_SNAPSHOT_INTERVAL = 2;

/**
 * Ticks the authoritative sim will run in response to a single input message.
 * A client that jumps far ahead (a backgrounded tab resuming, a debugger) must
 * not be able to freeze the frame with a catch-up burst — the remainder is
 * simply run on the next pulse. The same clamp the game loop applies to real
 * time (`@platform/loop`'s spiral-of-death guard), one layer down.
 */
export const MAX_CATCHUP_TICKS = 16;

/** The room code an offline match uses. It is never shared or typed by anyone —
 *  offline has exactly one room — but the protocol has a room, so it has one. */
export const OFFLINE_ROOM: RoomCode = 'LOCAL';

/** How to stand up an offline match. */
export interface LoopbackConfig {
  /** The match to create at `startMatch`: seed, slots, bounds (GDD §2.1). Ship
   *  classes may still be changed by `lobbyChoice` before the match starts. */
  readonly match: WorldConfig;
  /** Which slot this client is flying. Default 0. */
  readonly localPlayer?: PlayerId;
  /** Room code echoed in `welcome`. Default {@link OFFLINE_ROOM}. */
  readonly room?: RoomCode;
  /** Fixed sim timestep. Default the sim's canonical 60 Hz tick (GDD §4.1). */
  readonly dt?: number;
  /** Broadcast a snapshot every N ticks; 0 disables the stream entirely.
   *  Default {@link DEFAULT_SNAPSHOT_INTERVAL}. */
  readonly snapshotIntervalTicks?: number;
  /** The slot whose input advances the sim. Default: the local player — offline,
   *  the client's own loop is the only clock there is. */
  readonly driver?: PlayerId;
}

/**
 * A transport that holds the authoritative world in this process.
 *
 * Offline, the client renders straight off this world: it is already the one
 * true state, at zero latency, so there is nothing to predict and nothing to
 * reconcile. Online that is not true — the client will keep its own predicted
 * world and reconcile it against snapshots (GDD §4.2) — so code that reaches
 * for `world` must go through {@link isLocalAuthority} and have a path for the
 * transport that says no.
 */
export interface LocalAuthority {
  /** The authoritative world, or null before `startMatch`. */
  readonly world: World | null;
}

/** True when this transport runs the sim in-process (see {@link LocalAuthority}). */
export function isLocalAuthority(transport: Transport): transport is Transport & LocalAuthority {
  return 'world' in transport;
}

export class LocalLoopback implements Transport, LocalAuthority {
  private connection: ConnectionState = 'connecting';
  private authoritative: World | null = null;
  private messageHandler: ((message: ServerMessage) => void) | null = null;
  private stateHandler: ((state: ConnectionState) => void) | null = null;

  private readonly queue = new InputQueue();
  private readonly slots: LobbySlot[];
  private readonly you: PlayerId;
  private readonly room: RoomCode;
  private readonly dt: number;
  private readonly snapshotInterval: number;
  private readonly driver: PlayerId;

  /** Latest input sequence accepted from the local client, echoed back in every
   *  snapshot so the client can retire the predictions the server has seen
   *  (GDD §4.2 prediction/reconciliation). */
  private ackSeq = 0;
  /** The tick {@link ackSeq} ran at. Offline it is always the tick the client
   *  asked for — there is no wire to arrive late on — so the alignment
   *  instrument reads a flat zero here, which is the correct answer
   *  (`./transport` `SnapshotMessage.ackTick`). */
  private ackTick: Tick = 0;
  private matchEnded = false;

  /** Outbound delivery is queued rather than immediate so a handler that sends
   *  from inside its own callback cannot interleave two server messages. */
  private readonly outbox: ServerMessage[] = [];
  private draining = false;

  constructor(private readonly config: LoopbackConfig) {
    this.you = config.localPlayer ?? 0;
    this.room = config.room ?? OFFLINE_ROOM;
    this.dt = config.dt ?? TICK_DT;
    this.snapshotInterval = config.snapshotIntervalTicks ?? DEFAULT_SNAPSHOT_INTERVAL;
    this.driver = config.driver ?? this.you;
    // Every slot this client is not flying is a bot: offline, empty slots are
    // filled so a solo match is still a full ring (GDD §2.1, §2.9). Difficulty
    // is a lobby choice and is left unset until a lobby sets it.
    this.slots = config.match.players.map((spec) => ({
      player: spec.id,
      isBot: spec.id !== this.you,
      shipClass: spec.shipClass,
      // FFA teams-of-one unless the config already grouped allies (variable-slots
      // Task C4); mirrors the server so offline and online carry the same shape.
      team: spec.team ?? spec.id,
      ready: true,
    }));
  }

  // --- Transport ----------------------------------------------------------

  get state(): ConnectionState {
    return this.connection;
  }

  send(message: ClientMessage): void {
    if (this.connection === 'closed') return;
    switch (message.type) {
      case 'join':
        this.join();
        break;
      case 'lobbyChoice':
        this.chooseInLobby(message.shipClass);
        break;
      case 'startMatch':
        this.startMatch();
        break;
      case 'input':
        this.input(this.you, message);
        break;
    }
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateHandler = handler;
  }

  /** End the match locally. There is no socket to close and no reclaim window
   *  to end (GDD §4.2 reconnect grace is a property of a real connection); this
   *  simply stops the transport delivering and accepting. */
  close(): void {
    if (this.connection === 'closed') return;
    this.setState('closed');
  }

  // --- The in-process authority seam --------------------------------------

  get world(): World | null {
    return this.authoritative;
  }

  /**
   * File input on behalf of another slot — the in-process stand-in for another
   * client's socket. Offline this is how bot slots reach the sim: they issue
   * the same abstract `Action`s a human does, through the same queue, so the
   * sim cannot tell a bot's tick from a human's (GDD §2.9). Never called by the
   * game's own client, which owns exactly one slot and uses {@link send}.
   */
  sendAs(player: PlayerId, message: InputMessage): void {
    if (this.connection === 'closed') return;
    this.input(player, message);
  }

  /** Queue accounting — how much input was filed, dropped late, or duplicated. */
  get inputStats(): InputStats {
    return this.queue.stats;
  }

  // --- Protocol -----------------------------------------------------------

  private join(): void {
    if (this.connection !== 'open') this.setState('open');
    this.emit({ type: 'welcome', you: this.you, room: this.room, tick: this.simTick });
    this.emit({ type: 'lobbyState', slots: this.slots.map((slot) => ({ ...slot })) });
  }

  private chooseInLobby(shipClass: LobbySlot['shipClass']): void {
    // Locked once the match exists: a hull is chosen in the lobby and held for
    // the match (GDD §2.11).
    if (this.authoritative) return;
    const slot = this.slots.find((s) => s.player === this.you);
    if (!slot) return;
    slot.shipClass = shipClass;
    this.emit({ type: 'lobbyState', slots: this.slots.map((s) => ({ ...s })) });
  }

  private startMatch(): void {
    if (this.authoritative || this.connection !== 'open') return;
    // RUSH! — the world is built from the lobby as it stands, so a ship class
    // picked a moment ago is the hull that spawns.
    const players = this.slots.map((slot) => ({
      id: slot.player,
      shipClass: slot.shipClass,
      ...(slot.team !== undefined ? { team: slot.team } : {}),
    }));
    this.authoritative = createWorld({ ...this.config.match, players });
    // The same arguments the world was just built from. Offline nobody needs
    // them — the client reads this very world — but the protocol is the protocol
    // with the wire removed, so the message is complete either way.
    this.emit({
      type: 'matchStart',
      tick: this.authoritative.tick,
      seed: this.config.match.seed,
      slots: players.map((spec) => ({
        player: spec.id,
        shipClass: spec.shipClass,
        ...(spec.team !== undefined ? { team: spec.team } : {}),
      })),
      ...(this.config.match.bounds ? { bounds: { ...this.config.match.bounds } } : {}),
      ...(this.config.match.asteroidCount !== undefined
        ? { asteroidCount: this.config.match.asteroidCount }
        : {}),
    });
    this.broadcastSnapshot();
  }

  private input(player: PlayerId, message: InputMessage): void {
    const verdict = this.queue.accept(player, message, this.simTick);
    // The driving client's tick is the offline clock — but a tick the queue
    // refused outright is not a clock reading, so it moves nothing.
    if (player === this.driver && verdict !== 'far-future') this.advanceTo(message.tick);
  }

  /**
   * Run the authoritative sim forward to `target`, one fixed tick at a time,
   * consuming each tick's filed input. Bounded by {@link MAX_CATCHUP_TICKS};
   * whatever is left runs on the next pulse, so no single message can stall the
   * frame — and nothing is skipped, so the world stays identical to the same
   * ticks stepped directly.
   */
  private advanceTo(target: Tick): void {
    const world = this.authoritative;
    if (!world || this.matchEnded) return;

    const limit = Math.min(target, world.tick + MAX_CATCHUP_TICKS);
    while (world.tick < limit) {
      const rows = this.queue.take(world.tick + 1);
      // The ack names the newest local input the sim has *run*, not the newest
      // it has been handed — the same rule the match server follows, because the
      // predicting client reconciles against both (GDD §4.2, `./prediction`).
      for (const row of rows) {
        if (row.id === this.you && row.seq > this.ackSeq) {
          this.ackSeq = row.seq;
          this.ackTick = world.tick + 1;
        }
      }
      step(world, rows, this.dt);
      this.broadcastSnapshot();
      if (world.match.phase === 'ended') {
        // The authoritative match is over; the server stops the clock here and
        // so does this one. Later input is filed, but nothing more is simulated.
        this.matchEnded = true;
        this.emit({ type: 'matchEnd', winner: world.match.winner, tick: world.tick });
        return;
      }
    }
  }

  /** Broadcast the current tick as a binary snapshot, on the spike's 30 Hz
   *  divisor. Skipped entirely when nobody is listening or the stream is
   *  disabled — offline the client reads the authoritative world directly, so
   *  the encode is pure cost unless something asked for it. */
  private broadcastSnapshot(): void {
    const world = this.authoritative;
    if (!world || !this.messageHandler || this.snapshotInterval <= 0) return;
    if (world.tick % this.snapshotInterval !== 0) return;
    this.emit({
      type: 'snapshot',
      tick: world.tick,
      ackSeq: this.ackSeq,
      ackTick: this.ackTick,
      payload: encodeWorldSnapshot(world),
    });
  }

  private get simTick(): Tick {
    return this.authoritative?.tick ?? 0;
  }

  private setState(state: ConnectionState): void {
    this.connection = state;
    this.stateHandler?.(state);
  }

  /** Hand one server message to the client, preserving order even if the
   *  handler sends from inside the callback. */
  private emit(message: ServerMessage): void {
    if (!this.messageHandler) return;
    this.outbox.push(message);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.outbox.length > 0) {
        const next = this.outbox.shift()!;
        this.messageHandler(next);
      }
    } finally {
      this.draining = false;
      this.outbox.length = 0;
    }
  }
}

/**
 * src/net/session.ts — the client side of the seam. OWNER: Netcode Engineer
 * (GDD §3.5, §4.2).
 *
 * The game loop does not talk to a socket, a room, or a world; it talks to a
 * {@link MatchSession}. Once per fixed sim tick it hands over the abstract
 * `Action`s the input layer produced, and the session turns them into the one
 * high-frequency client message in the protocol — an ordered `InputMessage`
 * carrying the tick it applies to and the sequence number the server echoes
 * back for reconciliation (GDD §4.2).
 *
 * That indirection is the whole day-3 change to the client: the loop no longer
 * calls `step()` itself. Offline the input goes to a `LocalLoopback` that runs
 * the authoritative sim in this process; online it will go to a socket. The
 * loop's code is identical either way, because from where it stands the two are
 * the same object — which is exactly the property GDD §4.2 asks for.
 */

import type { Action, PlayerId, ShipClass } from '@shared/types';
import type { World } from '../sim';
import { LocalLoopback, OFFLINE_ROOM, isLocalAuthority } from './loopback';
import type { LoopbackConfig } from './loopback';
import type {
  BotDifficulty,
  ConnectionState,
  FireMode,
  RoomCode,
  ServerMessage,
  Tick,
  Transport,
} from './transport';
import { WebSocketTransport } from './websocket-transport';
import type { WebSocketTransportConfig } from './websocket-transport';

/** What the game loop needs from the network, and nothing more. */
export interface MatchSession {
  /** The slot this client is flying. */
  readonly you: PlayerId;
  /** The next tick this client's input applies to. */
  readonly tick: Tick;
  /** Connection state, for the reconnect-grace UI (GDD §4.2). */
  readonly state: ConnectionState;
  /**
   * The world to render, or null before the match starts. Offline this is the
   * authoritative world itself; online it will be the locally predicted world
   * reconciled against snapshots — either way the renderer reads one `World`.
   */
  readonly world: World | null;
  /**
   * Submit one fixed tick's input. Called exactly once per sim step by the game
   * loop, in tick order — this is the pulse the whole protocol is built on.
   */
  sendInput(actions: readonly Action[]): void;
  /** Tick of the last snapshot the server sent, or -1 if none has arrived. */
  readonly lastSnapshotTick: Tick;
  /** Leave the match. */
  close(): void;
}

/** Everything an offline match needs: the loopback's config plus the lobby
 *  choices this client would have made on the lobby screen. */
export interface LocalSessionConfig extends LoopbackConfig {
  /** Hull picked in the lobby; sent as the lobby choice before RUSH!. Omitted,
   *  the slot keeps whatever class `match.players` gave it (GDD §2.11). */
  readonly shipClass?: ShipClass;
  /** Fire mode picked in settings (GDD §2.4). Lobby metadata only — the mode is
   *  resolved client-side into `FireAction.auto`, so the sim never reads it. */
  readonly fireMode?: FireMode;
}

/** An offline session, whose match is already running when it is handed back —
 *  so the client can take the world and render it without a null check. */
export interface LocalSession extends MatchSession {
  readonly world: World;
}

/**
 * Stand up the offline game: one `LocalLoopback`, joined, lobby choice sent,
 * match started — ready for the loop's first `sendInput`. Solo play needs no
 * server and no internet (GDD §4.3 constraint 2, risk 6), but it is the same
 * protocol from the first message.
 */
export function createLocalSession(config: LocalSessionConfig): LocalSession {
  const { shipClass, fireMode, ...loopbackConfig } = config;
  const transport = new LocalLoopback(loopbackConfig);
  const session = new TransportSession(transport);
  session.open({
    room: config.room ?? OFFLINE_ROOM,
    ...(shipClass !== undefined ? { shipClass } : {}),
    ...(fireMode !== undefined ? { fireMode } : {}),
  });
  // `startMatch` is synchronous in-process, so the world exists by now. The
  // check is here so the impossible case is a loud error rather than a null
  // that surfaces three frames later in the renderer.
  if (!session.world) throw new Error('LocalLoopback did not start the match');
  return session as LocalSession;
}

/** The lobby choices a client carries into a room (GDD §2.1, §2.11, §2.4). */
export interface OpenOptions {
  readonly room: RoomCode;
  readonly shipClass?: ShipClass;
  readonly fireMode?: FireMode;
}

/**
 * A `MatchSession` over any `Transport`. It owns exactly two things the loop
 * would otherwise have to: the input sequence number, and the tick each input
 * is stamped with.
 */
export class TransportSession implements MatchSession {
  private player: PlayerId = 0;
  private nextTick: Tick = 1;
  private seq = 0;
  private snapshotTick: Tick = -1;
  private readonly observers: ((message: ServerMessage) => void)[] = [];

  constructor(private readonly transport: Transport) {
    transport.onMessage((message) => this.receive(message));
  }

  /**
   * Watch the server's messages without taking them over. The loop's contract
   * is input in, world out; the lobby screen, the reconnect banner and the
   * end-of-match summary all need to *see* the protocol without owning the
   * transport's single message handler, so they observe here (GDD §4.6 M4, M7).
   */
  observe(handler: (message: ServerMessage) => void): void {
    this.observers.push(handler);
  }

  /** Send the lobby choice: hull, fire mode, and — honoured only from the room
   *  creator — the bots' difficulties (GDD §2.1, §2.11, §4.2). */
  chooseInLobby(options: {
    shipClass: ShipClass;
    fireMode?: FireMode;
    botDifficulties?: readonly BotDifficulty[];
  }): void {
    this.transport.send({
      type: 'lobbyChoice',
      shipClass: options.shipClass,
      fireMode: options.fireMode ?? 'manual',
      ...(options.botDifficulties ? { botDifficulties: options.botDifficulties } : {}),
    });
  }

  /** RUSH! Honoured from the room creator alone; a no-op from anyone else. */
  startMatch(): void {
    this.transport.send({ type: 'startMatch' });
  }

  /** Join the room and start the match. Offline the room is ours alone, so the
   *  two are one gesture; online the lobby sits between them (GDD §2.1). */
  open(options: OpenOptions): void {
    this.transport.send({ type: 'join', room: options.room });
    if (options.shipClass !== undefined) {
      this.transport.send({
        type: 'lobbyChoice',
        shipClass: options.shipClass,
        fireMode: options.fireMode ?? 'manual',
      });
    }
    this.transport.send({ type: 'startMatch' });
  }

  get you(): PlayerId {
    return this.player;
  }

  get tick(): Tick {
    return this.nextTick;
  }

  get state(): ConnectionState {
    return this.transport.state;
  }

  get world(): World | null {
    return isLocalAuthority(this.transport) ? this.transport.world : null;
  }

  get lastSnapshotTick(): Tick {
    return this.snapshotTick;
  }

  sendInput(actions: readonly Action[]): void {
    this.transport.send({
      type: 'input',
      tick: this.nextTick,
      seq: ++this.seq,
      actions,
    });
    this.nextTick++;
  }

  close(): void {
    this.transport.close();
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.player = message.you;
        // Predict from the tick the server says it is on (GDD §4.2).
        this.nextTick = message.tick + 1;
        break;
      case 'matchStart':
        this.nextTick = message.tick + 1;
        break;
      case 'snapshot':
        this.snapshotTick = message.tick;
        break;
      case 'lobbyState':
      case 'entityEvent':
      case 'playerSubstituted':
      case 'playerReclaimed':
      case 'matchEnd':
        // Lobby, static entities, the reconnect-grace pair, and the end-of-match
        // summary are the UI's business; the loop's contract is input in, world
        // out. They reach those screens through `observe` (GDD §4.6 M4, M7).
        break;
    }
    for (const observer of this.observers) observer(message);
  }
}

// ---------------------------------------------------------------------------
// Online
// ---------------------------------------------------------------------------

/** Everything an online match needs: where the server is, and which room. */
export interface OnlineSessionConfig {
  /** `wss://…` (or `ws://` in dev) — the match server's endpoint. */
  readonly url: string;
  /** The room code to create or join. Shared with the other players (GDD §4.2). */
  readonly room: RoomCode;
  /** Hull picked in the lobby (GDD §2.11). Sent as soon as the socket opens. */
  readonly shipClass?: ShipClass;
  /** Fire mode picked in settings (GDD §2.4) — lobby metadata; the sim never
   *  reads it, because the mode is resolved client-side into `FireAction.auto`. */
  readonly fireMode?: FireMode;
  /** Bot difficulties, honoured only if this client created the room. */
  readonly botDifficulties?: readonly BotDifficulty[];
  /** Ambient overrides for the transport — injected in tests (see
   *  `./websocket-transport`); production passes none and gets the browser's. */
  readonly transport?: Omit<WebSocketTransportConfig, 'url' | 'room'>;
}

/** An online session, with the two lobby gestures a room needs. */
export interface OnlineSession extends MatchSession {
  /** Re-send the lobby choice (hull, fire mode, bot difficulties). */
  chooseInLobby(options: {
    shipClass: ShipClass;
    fireMode?: FireMode;
    botDifficulties?: readonly BotDifficulty[];
  }): void;
  /** RUSH! — the room creator starts the match. */
  startMatch(): void;
  /** Watch the protocol: lobby state, the reconnect-grace pair, match end. */
  observe(handler: (message: ServerMessage) => void): void;
}

/**
 * Stand up an online match: one `WebSocketTransport` to the match server, one
 * session over it.
 *
 * `join` is deliberately *not* sent from here. The transport sends it itself on
 * every dial, because a redial inside the grace window has to carry the reclaim
 * slot and token to get the player's ship back (GDD §4.2) — putting that in one
 * place means a reconnect cannot forget to ask for the seat. What this function
 * does own is the lobby gesture that follows a successful open, re-sent on each
 * reconnect so a returning client's hull choice is never lost with its socket.
 *
 * Note what an online session's `world` is: null. The predicted, reconciled
 * client world lands with client-side prediction (GDD §4.2); until then an
 * online client is snapshot-fed, and `lastSnapshotTick` is how it knows the
 * server is still talking.
 */
export function createOnlineSession(config: OnlineSessionConfig): OnlineSession {
  const transport = new WebSocketTransport({
    url: config.url,
    room: config.room,
    ...(config.transport ?? {}),
  });
  const session = new TransportSession(transport);

  const sendLobbyChoice = (): void => {
    if (config.shipClass === undefined) return;
    session.chooseInLobby({
      shipClass: config.shipClass,
      ...(config.fireMode !== undefined ? { fireMode: config.fireMode } : {}),
      ...(config.botDifficulties ? { botDifficulties: config.botDifficulties } : {}),
    });
  };

  transport.onStateChange((state) => {
    if (state === 'open') sendLobbyChoice();
  });
  if (transport.state === 'open') sendLobbyChoice();

  return session;
}

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
 * the authoritative sim in this process; online it goes to a socket. The loop's
 * code is identical either way, because from where it stands the two are the
 * same object — which is exactly the property GDD §4.2 asks for.
 *
 * **Where the world comes from is the one difference, and it lives here.**
 * Offline the transport *is* the authority, so the session hands the renderer
 * the one true world at zero latency: there is nothing to predict. Online there
 * is a wire in the way, so on `matchStart` the session builds its own world from
 * the arguments the server built its world from, steps it on local input the
 * instant the key goes down, and reconciles it against every snapshot
 * (`./prediction`). One `MatchSession`, one `world` property, and the game loop
 * never learns which of the two it got.
 */

import type { Action, PlayerId, ShipClass } from '@shared/types';
import { TICK_DT, createWorld } from '../sim';
import type { World } from '../sim';
import { resetStaticEntities } from './entity-events';
import { LocalLoopback, OFFLINE_ROOM, isLocalAuthority } from './loopback';
import type { LoopbackConfig } from './loopback';
import { PredictedMatch, applyPlayerEconomy } from './prediction';
import { NetTelemetry } from './telemetry';
import { RemoteInterpolator } from './interpolation';
import type { InterpolatedShip, InterpolatedShot } from './interpolation';
import { PresentationLayer } from './presentation';
import { decodeSnapshot } from './snapshot';
import type {
  BotDifficulty,
  ConnectionState,
  FireMode,
  MatchStartMessage,
  PlayerEconomy,
  RoomCode,
  ServerMessage,
  Tick,
  Transport,
} from './transport';
import { WebSocketTransport } from './websocket-transport';
import type { WebSocketTransportConfig } from './websocket-transport';
import { probeRoomLiveness } from './allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from './allocator-client';

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
   * authoritative world itself; online it is the locally predicted world,
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
  /**
   * The predictor, online; null offline, where authority is already in this
   * process. The renderer reads {@link PredictedMatch.renderOffset} off it to
   * absorb corrections smoothly, and the instrument reads the error and the lead.
   */
  readonly prediction: PredictedMatch | null;
  /**
   * Client-side reconciliation telemetry — misprediction rate, correction
   * magnitude, and measured RTT, sampled per second (`./telemetry`, M10 reconcile
   * brief). Populated only online, where there is prediction to measure; a
   * Every finalized second reaches the player through COPY LOG
   * (`./playtest-log-attach`); {@link NetTelemetry.format} dumps a capture for a
   * console or a test. (#238's comments promised a `?debug=1` netgraph reading
   * {@link NetTelemetry.live} per frame — it was never built. See
   * docs/netcode-audit.md §6.)
   */
  readonly telemetry: NetTelemetry;
  /**
   * The remote-entity interpolation buffer (`./interpolation`), or null offline
   * where the world is authoritative in-process. The render layer samples it to
   * draw *other* ships ~100 ms in the past while the local ship stays predicted,
   * so remote motion is smooth regardless of this client's RTT (M10 brief).
   */
  readonly interpolation: RemoteInterpolator | null;
  /**
   * Remote ships at the current render instant, ~100 ms in the past — a
   * clock-safe convenience over {@link interpolation}: it samples with the
   * session's own wall clock, so the render layer never has to match clock
   * domains. Empty offline (authoritative world) and until the first snapshot.
   */
  sampleRemotes(): readonly InterpolatedShip[];
  /**
   * Streamed shots at the current render instant, played back on the same jitter
   * buffer as {@link sampleRemotes} — the firer's own predicted shots are not in
   * here, by design (`./prediction`). Empty offline and until the first snapshot.
   */
  sampleShots(): readonly InterpolatedShot[];
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
  private predictor: PredictedMatch | null = null;
  private interpolator: RemoteInterpolator | null = null;
  /** Writes the smoothed/interpolated picture over the predicted world for the
   *  render window, and takes it straight back off (`./presentation`). Null
   *  offline, where the world *is* authority and there is nothing to smooth. */
  private presentation: PresentationLayer | null = null;
  /**
   * The wallet the server sent in a reclaim `welcome`, held until the predicted
   * world exists to stamp it onto. Welcome arrives before the `matchStart` that
   * builds that world, so the two are stitched together here (GDD §4.2 reclaim).
   * Null on a lobby join and offline, where there is nothing to restore.
   */
  private pendingEconomy: PlayerEconomy | null = null;
  private readonly observers: ((message: ServerMessage) => void)[] = [];
  private readonly dt: number;
  private readonly clock: () => number;
  /** The reconciliation instrument — fed on every send and every applied
   *  reconcile, and handed back through COPY LOG (`./telemetry`). Inert offline. */
  private readonly netTelemetry = new NetTelemetry();
  /** True when the transport runs the sim in this process. Then the session
   *  predicts nothing: there is no latency to hide, and inventing a second copy
   *  of a world we already own would be the one way to make offline drift. */
  private readonly authoritative: boolean;

  constructor(
    private readonly transport: Transport,
    options: { dt?: number; now?: () => number } = {},
  ) {
    this.dt = options.dt ?? TICK_DT;
    // Wall clock for telemetry and interpolation timing. Injected like every
    // other clock in `src/net`, defaulting to the browser's, so a capture is
    // reproducible and a test runs instantly.
    this.clock = options.now ?? ((): number => Date.now());
    this.authoritative = isLocalAuthority(transport);
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

  /**
   * The tick the next input belongs to.
   *
   * Online this is the predicted world's own clock plus one, and that is not a
   * detail: reconciliation rewinds to the snapshot's tick and replays every
   * unacknowledged input, so the client lands back exactly as far ahead of the
   * server as it has input in flight. The lead is therefore *measured* — one
   * round trip, in ticks — rather than guessed at by a constant.
   */
  get tick(): Tick {
    return this.predictor ? this.predictor.tick + 1 : this.nextTick;
  }

  get state(): ConnectionState {
    return this.transport.state;
  }

  get world(): World | null {
    if (isLocalAuthority(this.transport)) return this.transport.world;
    return this.predictor?.world ?? null;
  }

  get lastSnapshotTick(): Tick {
    return this.snapshotTick;
  }

  get prediction(): PredictedMatch | null {
    return this.predictor;
  }

  get telemetry(): NetTelemetry {
    return this.netTelemetry;
  }

  get interpolation(): RemoteInterpolator | null {
    return this.interpolator;
  }

  /**
   * Why the transport closed, when the concrete transport says so
   * (`./websocket-transport` `CloseReason`: a deliberate leave, a dead room, a spent
   * grace window, a refused join). Null offline, and null while still connected.
   *
   * Read structurally rather than by importing the concrete class, because that is
   * exactly the seam `Transport` exists to keep: a session works over any transport,
   * and the two that carry a reason are welcome to say so without the interface
   * growing a field a `LocalLoopback` would have to fake. Surfaced for the reconnect
   * banner and for the playtest log, which must record *why* a socket ended
   * (`./playtest-log-attach`).
   */
  get closeReason(): string | null {
    return readOptionalString(this.transport, 'closeReason');
  }

  /** The server's stated reason for refusing a join, or null. Same structural read
   *  as {@link closeReason}; meaningful alongside `closeReason === 'join-rejected'`. */
  get rejectReason(): string | null {
    return readOptionalString(this.transport, 'rejectReason');
  }

  sampleRemotes(): readonly InterpolatedShip[] {
    return this.interpolator?.sample(this.clock()) ?? [];
  }

  sampleShots(): readonly InterpolatedShot[] {
    return this.interpolator?.sampleShots(this.clock()) ?? [];
  }

  sendInput(actions: readonly Action[]): void {
    // The world the game loop has been rendering holds *presented* values — the
    // local hull nudged by its decaying correction offset, remote hulls a jitter
    // buffer in the past. Put the simulation back before a single tick of it runs
    // (`./presentation`), or the picture compounds into drift.
    this.unpresent();
    const tick = this.tick;
    const seq = ++this.seq;
    this.transport.send({ type: 'input', tick, seq, actions });
    // Send first, then predict: the wire gets the press with no local work in
    // front of it, and the ship moves this frame either way (GDD §4.2).
    if (this.predictor) {
      // Timestamp the send so the snapshot that later acks this seq measures a
      // real round trip (`./telemetry`). Only online — offline there is no wire.
      this.netTelemetry.recordInput(seq, this.clock());
      this.predictor.predict(seq, actions);
    } else this.nextTick = tick + 1;
    this.present();
  }

  /**
   * Draw the presented frame over the predicted world, so the renderer — which
   * reads the world and nothing else — sees smoothing and interpolation at all.
   *
   * This is where PR #238's two dead seams (`prediction.renderOffset`,
   * `sampleRemotes()`) finally reach a screen. It is deliberately *here* rather
   * than in the render layer: the game loop is Platform's, the world is the
   * contract between us, and the net lane can honour that contract without
   * reaching across it (docs/netcode-audit.md).
   */
  private present(): void {
    const world = this.predictor?.world;
    if (!world || !this.presentation) return;
    this.presentation.apply(world, {
      localOffset: this.predictor!.renderOffset,
      remotes: this.sampleRemotes(),
      shots: this.sampleShots(),
    });
  }

  /** Put the simulation back. Idempotent; called before anything that steps or
   *  reconciles, so a message arriving between frames is applied to sim state. */
  private unpresent(): void {
    const world = this.predictor?.world;
    if (world && this.presentation) this.presentation.restore(world);
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
        // A reclaim welcome carries the wallet the streaming snapshot never does
        // (`./transport` PlayerEconomy). Hold it for the `matchStart` that builds
        // the world it belongs on — it is stamped there, in `beginPredicting`.
        this.pendingEconomy = message.economy ?? null;
        break;
      case 'matchStart':
        this.nextTick = message.tick + 1;
        if (!this.authoritative) this.beginPredicting(message);
        break;
      case 'snapshot': {
        this.snapshotTick = message.tick;
        if (this.predictor) {
          const now = this.clock();
          const decoded = decodeSnapshot(message.payload);
          // A snapshot lands between frames, so the world may be holding presented
          // values right now. Reconcile against the simulation, never the picture.
          this.unpresent();
          const report = this.predictor.reconcile(decoded, message.ackSeq);
          // Feed the instrument only for a reconcile that actually applied — a stale
          // snapshot the client ignored is not a data point (`./telemetry`).
          if (report.applied) {
            this.netTelemetry.recordReconcile(
              { ...report, lead: report.replayed },
              message.ackSeq,
              now,
            );
            const live = this.netTelemetry.live;
            // Re-size the jitter buffer from the variance just measured, not from a
            // constant (audit item 2d). Slew-limited inside, so this is a slide.
            this.interpolator?.resize(live.rttJitterMs);
            // And bound how far ahead of authority this client may run, from the
            // same measurement — otherwise a retransmit stall leaves the clock
            // hundreds of ms out and every later press waits in the server's queue
            // for it (`./prediction` MAX_LEAD_TICKS).
            this.predictor.setLeadBudget(live.rttFloorMs, live.rttJitterMs);
          }
          // And buffer the authoritative frame for remote-ship interpolation,
          // timed by the same clock the render layer samples with (`./interpolation`).
          this.interpolator?.record(decoded, now);
          // Put the picture back up: a frame drawn between this snapshot and the
          // next tick must not show the raw correction we just applied.
          this.present();
        }
        break;
      }
      case 'economy':
        // The wallet's own channel, for this client's own seat: held/banked ore and
        // upgrade tiers, on the ticks authority moves them (`./transport`
        // EconomyMessage). Staged on the predictor so it is written inside the
        // reconcile for its tick and the player's unacked mining replays on top; if
        // the world is not built yet (an `economy` that beat `matchStart` home), it
        // waits with the welcome's wallet and is stamped at world-build instead.
        if (message.player !== this.player) break;
        if (this.predictor) this.predictor.stageEconomy(message.economy, message.tick);
        else if (!this.authoritative) this.pendingEconomy = message.economy;
        break;
      case 'entityEvent':
        // The half of the world that does not stream: rocks, turrets, shields,
        // wrecks, and the scouted health a client has earned (GDD §2.2, §4.2).
        // Written into the predicted world, where the renderer will find it.
        this.predictor?.applyEvent(message);
        break;
      case 'lobbyState':
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

  /**
   * RUSH!, online: build this client's own copy of the arena and start
   * predicting inside it.
   *
   * `createWorld` is called with exactly what the server called it with — seed,
   * roster, bounds, rock count (`MatchStartMessage`) — so the two worlds are
   * identical before a single tick has run, which is the whole basis for
   * predicting anything (GDD §4.1 determinism, §4.2 prediction).
   *
   * A `matchStart` at a tick past zero is a *reclaim*: the player dropped and
   * came back inside the grace window (GDD §4.2), and the seed only rebuilds the
   * arena as it was at RUSH!. The opening field is therefore thrown away and
   * refilled from the full static-entity burst the server sends next — a rock
   * mined out while they were gone would otherwise sit there forever, because a
   * server only announces the destruction of things it still believes exist.
   */
  private beginPredicting(message: MatchStartMessage): void {
    const world = createWorld({
      seed: message.seed,
      // Thread each seat's team so the predicted world groups allies exactly as
      // the server's does (variable-slots Task C4); an absent team defaults to the
      // seat's id at world-build (FFA teams-of-one), byte-identical to today.
      players: message.slots.map((slot) => ({
        id: slot.player,
        shipClass: slot.shipClass,
        ...(slot.team !== undefined ? { team: slot.team } : {}),
      })),
      ...(message.bounds ? { bounds: { ...message.bounds } } : {}),
      ...(message.asteroidCount !== undefined ? { asteroidCount: message.asteroidCount } : {}),
    });
    if (message.tick > 0) {
      resetStaticEntities(world);
      world.tick = message.tick;
      world.time = message.tick * this.dt;
    }
    this.predictor = new PredictedMatch({
      world,
      localPlayer: this.player,
      dt: this.dt,
    });
    // A reclaim rebuilds a fresh, naked ship; the wallet the welcome carried is
    // stamped on now, before the first prediction, so cargo/bank/upgrades are the
    // ones the player left (GDD §4.2). Reconciliation then leaves them alone — the
    // snapshot never overwrites the wallet (`./prediction` applySnapshot).
    if (this.pendingEconomy) {
      this.restoreEconomy(world, this.pendingEconomy);
      this.pendingEconomy = null;
    }
    // Remote ships and streamed shots render out of this buffer, one jitter-buffer
    // delay in the past, so their motion is smooth at any RTT while the local slot
    // stays predicted (M10). The delay opens at the standard 100 ms and re-sizes
    // itself from measured RTT variance thereafter (audit item 2d).
    this.interpolator = new RemoteInterpolator({ local: this.player });
    this.presentation = new PresentationLayer(this.player);
  }

  /**
   * Stamp a reclaimed wallet onto the local ship in a freshly built predicted
   * world (`./prediction` `applyPlayerEconomy`) — held ore, banked ore and every
   * upgrade track the client recognizes, with the stats those tiers scale
   * recomputed, so the returning ship matches the one authority is flying rather
   * than merely wearing its labels. Remote ships keep their fresh defaults: this
   * client never learns their wallets, and never needs to.
   */
  private restoreEconomy(world: World, economy: PlayerEconomy): void {
    applyPlayerEconomy(world, this.player, economy);
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

/** Read a named optional string property off a transport, or null when it does not
 *  carry one (the `LocalLoopback` case). Never throws on a transport that lacks it. */
function readOptionalString(transport: unknown, key: string): string | null {
  const value = (transport as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
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
  /** Why the socket closed, once it has — a deliberate leave, a dead room, a spent
   *  grace window, or a refused join. Null while connected (`./websocket-transport`
   *  `CloseReason`). */
  readonly closeReason: string | null;
  /** The server's own reason for refusing the join, or null. */
  readonly rejectReason: string | null;
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
 * An online session's `world` is null until `matchStart` arrives, and from then
 * on it is the *predicted* world — local input applied immediately, corrected
 * against every snapshot (`./prediction`). `lastSnapshotTick` is still how a
 * client knows the server is talking; `prediction.lastError` is how it knows
 * how far apart the two of them are.
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

/**
 * Carry an allocator's decision into an online session (M9 Task 9 + 9b). Given a
 * connection the allocator client resolved (`./allocator-client`), this returns
 * the two transport overrides that make it a *fleet* connection rather than a
 * direct one, to spread across {@link OnlineSessionConfig.transport}:
 *
 *   • the signed **ticket**, presented on every `join` so the Machine accepts a
 *     connection the allocator sent it (and refuses one it did not);
 *   • a room-liveness **probe**, bound to *this resolved room* — the code the
 *     allocator minted for an allocate, not whatever the caller typed — so a
 *     reconnect asks about the right room and can tell "the room ended" (stop)
 *     from "my connection dropped" (keep trying) (`./reconnect`).
 *
 * Binding the probe to the wrong room is the one easy mistake here (a freshly
 * minted code is not the code the player entered), which is exactly why this
 * lives in one tested place instead of at each call site. Without an allocator
 * there is no ticket and no probe — the direct-connect path passes neither and is
 * untouched.
 */
export function allocatorTransport(
  connection: ResolvedConnection,
  client: AllocatorClientConfig,
): Pick<WebSocketTransportConfig, 'ticket' | 'checkRoomAlive'> {
  return {
    ticket: connection.ticket,
    checkRoomAlive: () => probeRoomLiveness(client, connection.room),
  };
}

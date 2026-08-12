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
import type { Abundance, MatchMode, World } from '../sim';
import { resetStaticEntities } from './entity-events';
import { LocalLoopback, OFFLINE_ROOM, isLocalAuthority } from './loopback';
import type { LoopbackConfig } from './loopback';
import { LinkWatch } from './link-loss';
import type { LinkStatus, LinkWatchConfig } from './link-loss';
import { PredictedMatch, applyPlayerEconomy } from './prediction';
import { NetTelemetry } from './telemetry';
import { RemoteInterpolator } from './interpolation';
import type { InterpolatedShip, InterpolatedShot } from './interpolation';
import { PresentationLayer } from './presentation';
import { decodeSnapshot } from './snapshot';
import type { PersonalityId } from '../bots';
import type {
  BotDifficulty,
  ConnectionState,
  FireMode,
  LobbySeatState,
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
   * Every finalized second reaches the player through DOWNLOAD LOG
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
  /**
   * Whether the link is dead and the world is therefore frozen (`./link-loss`).
   *
   * Always false offline, where authority is in this process and cannot go away.
   * Online it is the honest answer to *"is what I am looking at still real?"* —
   * and while it is true, {@link sendInput} predicts nothing (m10 disconnect
   * honesty; the developer's *"bots frozen but I could still move"*).
   */
  readonly frozen: boolean;
  /** Where the connection stands, as of the last poll (`./link-loss`). Permanently
   *  `live` offline — a `LocalLoopback` cannot drop. */
  readonly link: LinkStatus;
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
/**
 * How often the client probes the wire's own round trip, ms (`./transport`
 * PingMessage, M10 item 6).
 *
 * Twice a second. The number it feeds is the displayed ping and the lead budget's
 * input, and both want a *floor* over a window of seconds rather than an instant
 * reading — so this only has to be often enough to catch a route change inside a
 * second or two. Thirty-odd bytes each way at 2 Hz is a rounding error against a
 * 15 KB/s snapshot stream (docs/netcode-spike.md).
 */
export const PING_INTERVAL_MS = 500;

/** What {@link MatchSession.link} reads offline: a connection that cannot drop,
 *  because there is no connection (`./loopback`). One frozen object, so an offline
 *  frame allocates nothing to say nothing has happened. */
const OFFLINE_LINK: LinkStatus = {
  phase: 'live',
  cause: null,
  silentMs: 0,
  graceRemainingMs: 0,
  attempts: 0,
  manualRedial: 'none',
  ending: null,
};

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
   *  reconcile, and handed back through DOWNLOAD LOG (`./telemetry`). Inert offline. */
  private readonly netTelemetry = new NetTelemetry();
  /** Probe ids, and the clock reading of the last probe sent ({@link PING_INTERVAL_MS}). */
  private pingId = 0;
  private lastPingMs = Number.NEGATIVE_INFINITY;
  /** When the previous tick's input was produced — the frame-scheduling delay's
   *  other end (`./telemetry` `recordFrameLag`). */
  private lastSendMs: number | null = null;
  /** True when the transport runs the sim in this process. Then the session
   *  predicts nothing: there is no latency to hide, and inventing a second copy
   *  of a world we already own would be the one way to make offline drift. */
  private readonly authoritative: boolean;
  /**
   * The dead-connection watchdog (`./link-loss`), online only — offline there is
   * no wire to lose and authority is in this process.
   *
   * It is *here*, on the session, rather than on the transport, because the signal
   * it watches is the one the transport cannot see: server frames arriving. A
   * backgrounded socket reads `open` long after it has stopped delivering, so the
   * only honest measure of a live connection is that data is coming out of it.
   */
  private readonly watch: LinkWatch | null;

  constructor(
    private readonly transport: Transport,
    options: { dt?: number; now?: () => number; link?: LinkWatchConfig } = {},
  ) {
    this.dt = options.dt ?? TICK_DT;
    // Wall clock for telemetry and interpolation timing. Injected like every
    // other clock in `src/net`, defaulting to the browser's, so a capture is
    // reproducible and a test runs instantly.
    this.clock = options.now ?? ((): number => Date.now());
    this.authoritative = isLocalAuthority(transport);
    this.watch = this.authoritative ? null : new LinkWatch(this.clock(), options.link ?? {});
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
   *  creator — the bots' CAST and their difficulties, the match MODE and the
   *  per-seat TEAM assignment (GDD §2.1, §2.11, §4.2; m10 teams-wire, a0-06b). */
  chooseInLobby(options: {
    shipClass: ShipClass;
    fireMode?: FireMode;
    botDifficulties?: readonly BotDifficulty[];
    /**
     * The characters those tiers belong to, same order and same length (a0-06b).
     * The authoritative half of the pair: where this names a seat's character the
     * room seats *that* character and derives the tier from it, so the two can
     * never disagree about a seat (`./transport` `LobbyChoiceMessage`).
     */
    botPersonalities?: readonly PersonalityId[];
    mode?: MatchMode;
    teams?: readonly number[];
    /** The host's per-seat OPEN / BOT / CLOSED authoring, by slot (a0-11). */
    seats?: readonly LobbySeatState[];
    /** The ore ABUNDANCE the host's YIELD row is on (n5-01) — match shape like
     *  the mode beside it, so the room builds the economy the lobby promised. */
    abundance?: Abundance;
    /** PUBLIC / PRIVATE — whether the room may appear in the lobby browser's
     *  list (a0-26 D1). The same creator-only, lobby-phase-only seam as the
     *  fields above; omitted means "no opinion", which leaves the room on the
     *  public default it opened at. */
    listed?: boolean;
  }): void {
    this.transport.send({
      type: 'lobbyChoice',
      shipClass: options.shipClass,
      fireMode: options.fireMode ?? 'manual',
      ...(options.botDifficulties ? { botDifficulties: options.botDifficulties } : {}),
      ...(options.botPersonalities ? { botPersonalities: options.botPersonalities } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.teams ? { teams: options.teams } : {}),
      ...(options.seats ? { seats: options.seats } : {}),
      ...(options.abundance ? { abundance: options.abundance } : {}),
      ...(options.listed !== undefined ? { listed: options.listed } : {}),
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

  /**
   * **The ping to show a player**, ms — the wire's own round trip, or null before a
   * probe has been answered (offline, or in the first half second of a match).
   *
   * This is what the lobby and HUD readouts must read (m10-17). Deliberately *not* the
   * composite `telemetry.live.rttMs`, which is send→ack and therefore contains this
   * client's own input lead and the server's 30 Hz broadcast cadence: on the
   * developer's gru session that figure read 95 ms and then a sustained 215 ms on a
   * wire a speedtest called 24 ms. Showing that number tells a player their connection
   * is bad when it is not, which is a lie the client has no business telling
   * (M10 item 6).
   *
   * The *floor* over the recent window rather than the newest reading, for the same
   * reason a speedtest reports its best pass: one retransmit stalls the probe with
   * everything else on the socket, and a single 750 ms sample says nothing about the
   * connection a player is asking about. The wobble is not lost — it is measured, on
   * its own line, as jitter (`./telemetry` `rttJitterMs`). One number, one source: this
   * is the same figure the lead budget is sized from.
   */
  get networkPingMs(): number | null {
    return this.netTelemetry.live.networkFloorMs;
  }

  // --- The link, and whether it is still there (m10 disconnect honesty) -------

  /**
   * Where the connection stands as of the last {@link pollLink} (`./link-loss`).
   * Offline this is permanently `live`: a `LocalLoopback` cannot drop.
   */
  get link(): LinkStatus {
    return this.watch?.status ?? OFFLINE_LINK;
  }

  /**
   * **The freeze.** True from the instant a dead connection is detected until a
   * server frame proves it is back — and while it is true, {@link sendInput}
   * predicts nothing.
   */
  get frozen(): boolean {
    return this.watch?.frozen ?? false;
  }

  /**
   * Sample the link. Call once per rendered frame *and* on the overlay's own
   * clock: a dead connection is detected by nothing happening, so something has to
   * keep looking at the clock or the silence is never noticed.
   *
   * It also spends the one automatic redial a fresh loss is owed (brief §2 —
   * *"auto-attempt one reconnect on tab-return inside grace before even asking"*),
   * so a player who backgrounds the tab for ten seconds and comes back is usually
   * flying again before the overlay has finished asking them anything.
   */
  pollLink(now: number = this.clock()): LinkStatus {
    const watch = this.watch;
    if (!watch) return OFFLINE_LINK;
    watch.transportState(this.transport.state, now, this.closeReason);
    // Size the silence limit from the wire's own round trip, not from a constant:
    // a satellite link deserves more patience than a LAN (`./link-loss`).
    watch.setRtt(this.networkPingMs);
    watch.poll(now);
    // Spend the automatic attempt *inside* the poll, so the status handed back
    // already says `redialing` — an overlay drawn from a pre-redial reading would
    // ask the player to press a button the client is pressing in the same frame.
    if (watch.takeAutoRedial(now)) this.reconnect(now);
    return watch.status;
  }

  /** The page went away — detection suspends (`./link-loss` rule 2). */
  linkHidden(): void {
    this.watch?.hide();
  }

  /** The page came back. A stale last frame at this instant IS the diagnosis, and
   *  this is where the developer's backgrounded-tab case is caught. */
  linkShown(now: number = this.clock()): LinkStatus {
    this.watch?.shown(now);
    return this.pollLink(now);
  }

  /**
   * **RECONNECT**: dial again now and reclaim the seat (GDD §4.2). True when a dial
   * actually started; false when there was nothing to dial for — a dead room or a
   * spent window, which the transport then closes with, so the overlay stops asking
   * and says what happened instead.
   *
   * `manual` is true when a human pressed the button rather than the client spending
   * its one automatic attempt. It changes nothing about the dial and everything about
   * what the overlay is then able to say: the outcome of *that press* is recorded on
   * the watch, so a press that could not get out is reported instead of vanishing
   * (`./link-loss` `ManualRedial`, n8-01).
   */
  reconnect(now: number = this.clock(), manual = false): boolean {
    const watch = this.watch;
    if (!watch) return false;
    const redial = (this.transport as { redial?: () => boolean }).redial;
    const started = typeof redial === 'function' ? redial.call(this.transport) : false;
    if (started) watch.beginRedial(now, manual);
    else watch.redialFailed(now, manual);
    return started;
  }

  /**
   * **ABANDON MATCH**: a clean leave — the seat is freed rather than held empty for
   * a minute (`./transport` LeaveMessage, `server/room.ts` `abandon`). Falls back to
   * a plain hang-up on a transport with no leave gesture, which the grace rule
   * handles exactly as it always has.
   */
  leave(reason = 'abandoned'): void {
    const leave = (this.transport as { leave?: (reason?: string) => void }).leave;
    if (typeof leave === 'function') leave.call(this.transport, reason);
    else this.transport.close();
    this.watch?.abandon(this.clock());
  }

  sampleRemotes(): readonly InterpolatedShip[] {
    return this.interpolator?.sample(this.clock()) ?? [];
  }

  sampleShots(): readonly InterpolatedShot[] {
    return this.interpolator?.sampleShots(this.clock()) ?? [];
  }

  sendInput(actions: readonly Action[]): void {
    // ── THE FREEZE (m10 disconnect honesty) ───────────────────────────────────
    //
    // No authority, no world. The developer's report is what this line prevents:
    // *"bots frozen but I could still move"* — a client predicting on a link that
    // stopped delivering keeps flying a ship nobody else can see, mining rocks
    // nobody else agrees exist, and every second of it is a lie that reconciliation
    // will have to pay back if the link ever returns. So the moment the loss is
    // detected the sim stops advancing: nothing sent, nothing predicted, no tick.
    // The renderer keeps drawing (the overlay has to be live over *something*), and
    // a frame arriving un-freezes it in the same instant it lands (`./link-loss`).
    if (this.watch?.frozen) return;
    // The world the game loop has been rendering holds *presented* values — the
    // local hull nudged by its decaying correction offset, remote hulls a jitter
    // buffer in the past. Put the simulation back before a single tick of it runs
    // (`./presentation`), or the picture compounds into drift.
    this.unpresent();
    // ── ONE TICK NUMBER, AND IT IS THE TRUE ONE ──────────────────────────────
    //
    // The tick a message is stamped with is **the tick this client is about to
    // predict it at**, always — never a number invented to keep the stream tidy.
    // That equality is what makes client-side prediction mean anything: the client
    // replays this input at that tick on every reconcile, so if authority runs it
    // at a different one, every prediction built on it stands at the wrong instant
    // and reconciliation pays the gap back on every snapshot for as long as it
    // lasts (`./telemetry` `appliedDeltaMean`).
    //
    // It has not always been so, for a reason worth keeping written down. The
    // client's clock is not monotonic — a lead trim rewinds it a few ticks
    // (`./prediction` `trimLead`) — so the next input can be predicted at a tick
    // this client has already sent one for, and `InputQueue`'s first-wins duplicate
    // rule dropped such a message whole (~4 % of all input on a real socket, in
    // bursts). The fix then was to stamp strictly increasing ticks; the cost, only
    // visible once `ackTick` existed to measure it, was up to 15 ticks of
    // client-server misalignment on a loss-free wire. The collision is now *merged*
    // by authority instead — newest stick, every order kept, nothing dropped
    // (`server/room.ts` `acceptInput`, `./input-queue` `coalesce`) — so the client
    // can afford to be honest about its own clock, which is the whole point.
    const tick = this.tick;
    const seq = ++this.seq;
    // Name every one-shot order before it goes anywhere, so the copy on the wire
    // and the copy this client is about to predict are the *same* order (M10
    // action-echo; `@shared/types` OrderId). Stamped here rather than at the button
    // because this is the last moment before the two copies part company — and
    // because the input layer that built these actions has no business knowing
    // there is a wire. Offline mints nothing: there is nothing to match.
    const stamped = this.predictor ? this.stampOrders(actions) : actions;
    this.transport.send({ type: 'input', tick, seq, actions: stamped });
    // Send first, then predict: the wire gets the press with no local work in
    // front of it, and the ship moves this frame either way (GDD §4.2).
    if (this.predictor) {
      const now = this.clock();
      // Timestamp the send so the snapshot that later acks this seq measures a
      // real round trip (`./telemetry`). Only online — offline there is no wire.
      this.netTelemetry.recordInput(seq, now);
      // **CLIENT**, the third stage of the round trip (M10 item 6): how much later
      // than the fixed tick interval this device actually produced this tick's input.
      // Zero on a device holding its frame budget; a GC pause or a backgrounded tab
      // shows up here rather than being blamed on the wire — and it is real latency,
      // because a late press is stamped for a tick authority has nearly reached, so it
      // arrives late, is re-filed, and its ack comes back later still.
      if (this.lastSendMs !== null) {
        this.netTelemetry.recordFrameLag(now - this.lastSendMs - this.dt * 1000, now);
      }
      this.lastSendMs = now;
      // **NETWORK**: the probe, on its own cadence, riding the same frame the input
      // does so it needs no timer of its own ({@link PING_INTERVAL_MS}).
      if (now - this.lastPingMs >= PING_INTERVAL_MS) {
        this.lastPingMs = now;
        const id = ++this.pingId;
        this.transport.send({ type: 'ping', id });
        this.netTelemetry.recordPingSent(id, now);
      }
      this.predictor.predict(seq, stamped);
    } else this.nextTick = tick + 1;
    this.present();
  }

  /**
   * Give every one-shot order in this tick a client sequence id.
   *
   * Allocates only on the ticks a wheel is actually pressed — a few dozen times in
   * a fifteen-minute match against 54 000 ticks of flying, so the common path
   * returns the caller's own array (GDD §4.3). An order that already carries an id
   * keeps it: re-stamping would break the very identity the id exists to hold.
   */
  private stampOrders(actions: readonly Action[]): readonly Action[] {
    let out: Action[] | null = null;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const orderly = action.type === 'buildOrder' || action.type === 'upgradeOrder';
      if (!orderly || action.orderId !== undefined) {
        out?.push(action);
        continue;
      }
      out ??= actions.slice(0, i);
      out.push({ ...action, orderId: this.predictor!.orders.mint(this.player) });
    }
    return out ?? actions;
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
    // **Proof of life**, and the only one there is (`./link-loss`). Any frame —
    // snapshot, pong, lobby state — means the socket is still carrying data, and a
    // frame arriving after a detected loss is the recovery: the freeze lifts and the
    // overlay comes down here, in the same call the data lands in.
    this.watch?.frame(this.clock());
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
        // The seat this client came out of RUSH! on (a0-11). The room compacts
        // its roster there — the chairs nobody is in are not in the match, and
        // the survivors are renumbered so no sparse id reaches the sim
        // (`server/room.ts` `compactRoster`) — so the number the `welcome` named
        // is a LOBBY seat and this is the SIM one. They are equal whenever
        // nothing was dropped, which is every room that filled up and every
        // pre-a0-11 server (which omits the field entirely and leaves this
        // untouched). Adopted before `beginPredicting`, which builds the
        // predicted world around it: predicting the wrong ship would mispredict
        // every input this client ever sends, and reconcile forever.
        if (message.you !== undefined) this.player = message.you;
        // RUSH! (or a reclaim's replay) re-bases the clock: the server names the
        // tick to predict from, and nothing this client sent before it is on that
        // timeline (`beginPredicting`).
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
          const report = this.predictor.reconcile(decoded, message.ackSeq, message.ackTick);
          // Feed the instrument only for a reconcile that actually applied — a stale
          // snapshot the client ignored is not a data point (`./telemetry`).
          if (report.applied) {
            // `lead` and `appliedDelta` ride along: the first is how far ahead of
            // authority this client is standing, the second whether the input that
            // put it there was run where it thought (`./telemetry`).
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
            // ── SIZED FROM THE WIRE, NOT FROM ITSELF (M10 item 7) ──────────────
            //
            // The measurement handed over here is the **network** floor when there is
            // one: the ping probe's round trip, which has no tick queue in it
            // (`./telemetry` `networkFloorMs`). The composite send→ack floor is the
            // fallback and it is a feedback loop — an input is stamped for a future
            // tick, so the server holds it until that tick and the ack comes back one
            // *lead* later. Every sample in the window is inflated by the same amount,
            // so the minimum is inflated too, so the budget is sized from the very
            // number it determines. That is the plateau in the developer's second
            // capture: one 500 ms hiccup stepped the lead 5 → 9 and the rtt 108 → 174,
            // and neither ever came back down on a wire whose jitter never moved.
            this.predictor.setLeadBudget(live.networkFloorMs ?? live.rttFloorMs, live.rttJitterMs);
            // And how long a predicted order waits for its echo before it is
            // rolled back — measured from the same wire, for the same reason a
            // constant would be wrong on both a LAN and a phone (`./order-ledger`).
            this.predictor.orders.setTtlFromRtt(
              live.networkFloorMs ?? live.rttFloorMs,
              live.rttJitterMs,
              this.dt * 1000,
            );
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
      case 'pong':
        // The latency probe's answer (`./transport` PongMessage): the wire's own round
        // trip, measured against the send this client is holding, plus the two
        // components only the server can state. Handled outside the reconcile path on
        // purpose — it touches no world, so it needs no unpresent.
        this.netTelemetry.recordPong(message.id, this.clock(), {
          queueMs: message.queueMs,
          loopLagMs: message.loopLagMs,
        });
        break;
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
      case 'orderEcho':
        // What authority did with one identified order (`./transport`
        // OrderEchoMessage): the prediction is adopted into it, or taken back. The
        // world is the simulation for the length of this call — a settled order
        // adds or removes a build job, and doing that to a *presented* world would
        // stash the edit as if the picture had made it (`./presentation`).
        if (message.player !== this.player || !this.predictor) break;
        this.unpresent();
        this.predictor.settleOrder({
          orderId: message.orderId,
          accepted: message.accepted,
          tick: message.tick,
          ...(message.build ? { build: message.build } : {}),
        });
        this.present();
        break;
      case 'entityEvent':
        // The half of the world that does not stream: rocks, turrets, shields,
        // wrecks, and the scouted health a client has earned (GDD §2.2, §4.2).
        // Written into the predicted world, where the renderer will find it.
        this.predictor?.applyEvent(message);
        break;
      case 'matchEnd':
        // The room stops stepping when it ends, so it stops broadcasting: from the
        // watchdog's side the wire simply falls silent (`./link-loss` `retire`).
        // Stop watching, or every finished match throws CONNECTION LOST over its own
        // summary screen two and a half seconds later.
        this.watch?.retire(this.clock());
        break;
      case 'lobbyState':
      case 'playerSubstituted':
      case 'playerReclaimed':
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
   * roster, bounds, rock count, **ore abundance** (`MatchStartMessage`) — so the
   * two worlds are identical before a single tick has run, which is the whole
   * basis for predicting anything (GDD §4.1 determinism, §4.2 prediction).
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
      // The economy the room RUSHed with (n5-01). Threaded verbatim, and ABSENT
      // when the message is absent rather than defaulted to the product's SCARCE:
      // the value that matters here is not the one the lobby promised but the one
      // authority actually built with, and a pre-n5-01 server built with none —
      // so substituting a default is how a client predicts a field of rocks that
      // is not there. Before this line the client never passed one at all, which
      // is why an online SCARCE match ran the `standard` 150 s metronome.
      ...(message.abundance ? { abundance: message.abundance } : {}),
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
  /** The characters behind those tiers (a0-06b) — the row the room actually casts
   *  from. Honoured only if this client created the room, like the tiers. */
  readonly botPersonalities?: readonly PersonalityId[];
  /** Ambient overrides for the transport — injected in tests (see
   *  `./websocket-transport`); production passes none and gets the browser's. */
  readonly transport?: Omit<WebSocketTransportConfig, 'url' | 'room'>;
  /** Dead-connection detection overrides (`./link-loss`) — the grace window to
   *  count down and the broadcast interval to size the silence limit from. Tests
   *  pass a short window; production takes the ratified ~60 s (GDD §4.2). */
  readonly link?: LinkWatchConfig;
  /** Wall clock, ms. Injected in tests so a sixty-second window elapses instantly;
   *  production gets `Date.now`. */
  readonly now?: () => number;
}

/** Read a named optional string property off a transport, or null when it does not
 *  carry one (the `LocalLoopback` case). Never throws on a transport that lacks it. */
function readOptionalString(transport: unknown, key: string): string | null {
  const value = (transport as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** An online session, with the two lobby gestures a room needs. */
export interface OnlineSession extends MatchSession {
  /** Re-send the lobby choice (hull, fire mode, the bots' cast and difficulties,
   *  and — from the host — the match mode and the per-seat team assignment). */
  chooseInLobby(options: {
    shipClass: ShipClass;
    fireMode?: FireMode;
    botDifficulties?: readonly BotDifficulty[];
    /** The characters behind those tiers, same order (a0-06b). */
    botPersonalities?: readonly PersonalityId[];
    mode?: MatchMode;
    teams?: readonly number[];
    /** The host's per-seat OPEN / BOT / CLOSED authoring, by slot (a0-11). */
    seats?: readonly LobbySeatState[];
    /** PUBLIC / PRIVATE — whether the room may be listed in the browser (a0-26). */
    listed?: boolean;
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

  // --- The link, said out loud (m10 disconnect honesty) ---------------------

  /** Sample the link; call once per frame and on the overlay's clock. */
  pollLink(now?: number): LinkStatus;
  /** The page went hidden — detection suspends until it returns. */
  linkHidden(): void;
  /** The page came back; a stale last frame at this instant is a lost connection. */
  linkShown(now?: number): LinkStatus;
  /** RECONNECT: dial now and reclaim the seat. False when there is nothing to
   *  reclaim (dead room, spent window). `manual` marks a human's press, so the
   *  overlay can report what *that* press did (`./link-loss` `ManualRedial`). */
  reconnect(now?: number, manual?: boolean): boolean;
  /** ABANDON MATCH: a stated leave, so the seat is freed rather than held. */
  leave(reason?: string): void;
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
  const session = new TransportSession(transport, {
    ...(config.link !== undefined ? { link: config.link } : {}),
    ...(config.now !== undefined ? { now: config.now } : {}),
  });

  const sendLobbyChoice = (): void => {
    if (config.shipClass === undefined) return;
    session.chooseInLobby({
      shipClass: config.shipClass,
      ...(config.fireMode !== undefined ? { fireMode: config.fireMode } : {}),
      ...(config.botDifficulties ? { botDifficulties: config.botDifficulties } : {}),
      ...(config.botPersonalities ? { botPersonalities: config.botPersonalities } : {}),
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

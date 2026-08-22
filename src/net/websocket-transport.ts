/**
 * src/net/websocket-transport.ts — `WebSocketTransport`, the online `Transport`.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * The other half of the one seam (`./transport`). `LocalLoopback` runs the
 * authoritative sim in this process; this one keeps a single persistent
 * WebSocket to the match server and speaks the identical protocol over it. The
 * game loop cannot tell them apart, which is the property the whole netcode
 * design rests on: *"the simulation consumes ordered input ticks and never knows
 * which one it is talking to"* (GDD §4.2).
 *
 * **Reconnection is a game rule here, not plumbing.** A mid-match drop is
 * routine on mobile — screen lock, app backgrounding, a cellular hand-off (GDD
 * §4.2, mobile amendment) — so the server substitutes a bot immediately and
 * holds the seat for ~60 seconds. This transport spends that window trying to
 * get back: it redials with backoff, and each attempt re-sends `join` carrying
 * the slot it was flying and the reclaim token its `welcome` issued, which is
 * what turns "the connection came back" into "the player got their ship, cargo
 * and upgrades back". When the window closes, it stops trying and reports
 * `closed` rather than redialling into a match a bot now owns.
 *
 * **No ambient anything**, for the same reason the server has none: the socket
 * constructor, the clock and the timer are injected, defaulting to the browser
 * globals. A sixty-second grace window is therefore a test that runs instantly.
 */

import { encodeClientMessage, parseServerMessage } from './wire';
import type { WireFrame } from './wire';
import { decideReconnect } from './reconnect';
import type { RoomLiveness, StopReason } from './reconnect';
import { browserSeatMemory } from './seat-memory';
import type { SeatMemory } from './seat-memory';
import type { PlayerId } from '@shared/types';
import type {
  ClientMessage,
  ConnectionState,
  RoomCode,
  ServerMessage,
  Transport,
} from './transport';

// ---------------------------------------------------------------------------
// The browser seam
// ---------------------------------------------------------------------------

/** The slice of the WebSocket API this transport uses, and nothing more. */
export interface WebSocketLike {
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** A scheduled retry, as returned by the injected timer. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/** Everything ambient, in one injectable place. */
export interface WebSocketTransportConfig {
  /** `wss://…` (or `ws://` in dev) — the match server's endpoint. */
  readonly url: string;
  /** The room to join on connect, and to rejoin on every retry (GDD §4.2). */
  readonly room: RoomCode;
  /**
   * The allocator's signed routing decision (`./allocator-client` → `./ticket`),
   * presented on `join` so a Machine in a fleet accepts a connection it was sent.
   * Absent on the direct-connect path (no allocator, one Machine, nothing to
   * prove — the seam the direct-connect path keeps). Carried on every dial,
   * reclaims included, so a redial inside the grace window still proves membership.
   */
  readonly ticket?: string;
  /**
   * **Mint a fresh ticket for this room** (a0-72), called before every dial that
   * follows a drop. Absent on the direct-connect path, where there is no allocator
   * and no ticket to refresh.
   *
   * A ticket is deliberately short-lived — 30 seconds
   * (`allocator/allocator.ts` `DEFAULT_TICKET_TTL_MS`) — and until a0-72 the one
   * minted for the *first* dial was re-presented on every redial for the rest of
   * the session. That is fine for a redial that happens two seconds after a socket
   * closes, and it is the developer's bug for a phone: the screen blanked, thirty
   * seconds passed, and the return dial presented a pass that had lapsed while its
   * owner was away. The seat was still held, the match was still running, and the
   * Machine said `bad-ticket`.
   *
   * So the pass is re-minted rather than stretched: the TTL stays short (it is what
   * stops a leaked ticket being useful later), and a player who is coming back gets
   * a current one. The answer doubles as a liveness verdict — an allocator that
   * cannot find the room is telling us the match has ended, which is the one case
   * where there is genuinely nothing to dial for.
   */
  readonly refreshTicket?: () => Promise<TicketRefresh>;
  /**
   * Ask the allocator whether the room still exists, used only after a drop to
   * tell "my connection died" from "the room died" (`./reconnect`, M9 Task 9b).
   * A `'gone'` answer stops the retry loop *early* instead of hammering a dead
   * Machine for the whole grace window. Absent (the direct-connect path) leaves
   * the room `'unknown'`, and the reconnect decision falls back to the window
   * alone — exactly today's behaviour.
   */
  readonly checkRoomAlive?: () => Promise<RoomLiveness>;
  /**
   * **Where this device writes down the seat it is flying** (a0-133,
   * `./seat-memory`), so a client that comes back as a *fresh page* can still say
   * which seat is its own.
   *
   * Defaults to the browser's `localStorage`; `null` on a platform with no
   * storage, which is the pre-a0-133 behaviour exactly — the token lives in this
   * object and dies with it.
   *
   * The reconnect this transport was written for is a socket dying under a page
   * that keeps running, and for that the in-memory token is enough. A phone that
   * sleeps long enough does not resume a socket: the tab is discarded, the page is
   * rebuilt, and the player re-enters the code by hand. That client's token field
   * is empty, so its `join` is a stranger's and the room refuses it `match-live` —
   * which is the developer's report of 2026-08-17 and the a0-131 finding. Recalling
   * the credential here means the first dial of a rebuilt page is already the
   * reclaim it always should have been.
   */
  readonly seatMemory?: SeatMemory | null;
  /** Opens a socket. Defaults to the browser's `WebSocket`. */
  readonly connect?: (url: string) => WebSocketLike;
  /** Wall clock, ms. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Schedules a retry. Defaults to `setTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => TimerHandle;
  /** Cancels a scheduled retry. Defaults to `clearTimeout`. */
  readonly cancel?: (handle: TimerHandle) => void;
  /** How long to keep trying after a drop. Defaults to the server's grace
   *  window (GDD §4.2, ~60 s TUNABLE) — past it there is nothing to reclaim. */
  readonly reconnectWindowMs?: number;
  /** First retry delay; each subsequent attempt doubles up to the cap. */
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

/**
 * Why the transport ended up `closed`, once it has. `'left'` is a deliberate
 * hang-up; two are the dead-socket truths Task 9b keeps apart — a room that ended
 * (`'room-gone'`, nothing to reclaim, offer a new match) versus a grace window
 * that ran out (`'grace-elapsed'`, the seat is a bot's now); and `'join-rejected'`
 * is the server refusing the join outright (M10) — a *terminal* end no redial can
 * mend, unlike the recoverable drops above, so the transport stops and the menu
 * offers RETRY (a fresh allocate) / BACK. The specific server reason rides
 * {@link WebSocketTransport.rejectReason}. The ratified `Transport` interface says
 * only `state`; this richer reason is a concrete-class extra the online menu
 * reads, exactly as `player` already is.
 */
export type CloseReason = 'left' | 'join-rejected' | StopReason;

/**
 * What {@link WebSocketTransportConfig.refreshTicket} came back with.
 *
 *   • `{ ok: true }`  — a current ticket for the same room; the dial carries it.
 *   • `roomGone: true` — the allocator knows of no Machine hosting the code (404).
 *     The match has ended; nothing to reclaim, and the retry loop stops here.
 *   • `roomGone: false` — the *allocator* could not be reached, or answered
 *     something unusable. That says nothing about the room, so the dial goes out
 *     on the ticket we already hold: a Machine still hosting the room admits a
 *     reclaim on a lapsed-but-genuine pass (`server/match-server.ts` `admitsJoin`),
 *     which is precisely the case a returning player must not be denied because a
 *     third service is having a bad afternoon.
 */
export type TicketRefresh =
  | { readonly ok: true; readonly ticket: string }
  | { readonly ok: false; readonly roomGone: boolean };

/** Defaults, named so the reconnect behaviour is legible without reading code. */
export const RECONNECT_WINDOW_MS = 60_000;
export const RETRY_BASE_MS = 500;
export const RETRY_MAX_MS = 5_000;

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

export class WebSocketTransport implements Transport {
  private socket: WebSocketLike | null = null;
  private connection: ConnectionState = 'connecting';
  private messageHandler: ((message: ServerMessage) => void) | null = null;
  private stateHandler: ((state: ConnectionState) => void) | null = null;

  /**
   * The slot the server seated us in — from `welcome`, and then from the
   * `matchStart` that renumbers it.
   *
   * Both, because RUSH! compacts the roster and the seat a client played on is not
   * always the seat it was welcomed into (a0-11; `./transport`
   * `MatchStartMessage.you` — *"the room therefore compacts at RUSH! and tells each
   * client the seat it came out on"*). A reclaim names a seat, so a transport still
   * holding its lobby number would ask for somebody else's chair — or for one that
   * no longer exists — and be refused for a reason that is nothing to do with the
   * player. The room's own bookkeeping moves with the compaction
   * (`server/room.ts` `compactRoster` → `socket.reseat`); this is that same move,
   * on this side of the wire.
   */
  private seat: PlayerId | null = null;
  /** The secret that proves we are the same player coming back (GDD §4.2). */
  private token: string | null = null;
  /** Where the seat above is written down between page loads, or null on a device
   *  that cannot remember one (`./seat-memory`, a0-133). */
  private readonly memory: SeatMemory | null;
  /**
   * True while the seat/token we are dialling on came out of {@link memory} rather
   * than out of a `welcome` this transport itself received.
   *
   * It is the difference between a credential we *know* is current and one we are
   * merely presenting in good faith, and it decides what a reclaim refusal means:
   * ours going stale is a fact about the room, while a recalled one being refused
   * may only mean this device is remembering a match that has moved on — in which
   * case the honest next move is to knock as a newcomer ({@link retryAsNewcomer}).
   */
  private recalled = false;

  /** True once `close()` was called: a deliberate exit never redials. */
  private left = false;
  /** True once the server refused the join: like `left`, a state from which the
   *  transport never redials — but the end came *from* the server, not the player,
   *  so it is surfaced with its reason rather than silent (M10). */
  private rejected = false;
  /** The server's stated reason for a refused join, for a menu to show verbatim.
   *  Null until a `joinError` arrives. */
  private rejectReasonValue: string | null = null;
  private attempt = 0;
  /** Wall clock of the drop we are currently trying to recover from, or -1. */
  private droppedAt = -1;
  private retry: TimerHandle | null = null;
  /** The allocator's latest word on the room behind a dead socket (`./reconnect`).
   *  `'unknown'` until a probe answers, and reset to it on every fresh open. */
  private roomLiveness: RoomLiveness = 'unknown';
  /** True while a liveness probe is in flight, so a drop fires at most one. */
  private probing = false;
  /** Why we last moved to `closed`, for a UI that must say the right thing:
   *  a deliberate leave, a dead room, or a spent grace window. Null until closed. */
  private closeReasonValue: CloseReason | null = null;

  private readonly connectSocket: (url: string) => WebSocketLike;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => TimerHandle;
  private readonly cancel: (handle: TimerHandle) => void;
  private readonly windowMs: number;
  private readonly retryBase: number;
  private readonly retryMax: number;
  private readonly checkRoomAlive: (() => Promise<RoomLiveness>) | null;
  private readonly refreshTicket: (() => Promise<TicketRefresh>) | null;
  /** The pass this transport is currently carrying. Seeded from the config and
   *  re-minted before a redial (a0-72), so it is a field rather than a constant. */
  private ticket: string | undefined;
  /** True while a re-mint is in flight, so a second dial cannot start behind it. */
  private refreshing = false;

  constructor(private readonly config: WebSocketTransportConfig) {
    this.checkRoomAlive = config.checkRoomAlive ?? null;
    this.refreshTicket = config.refreshTicket ?? null;
    this.ticket = config.ticket;
    this.connectSocket =
      config.connect ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = config.now ?? (() => Date.now());
    this.schedule = config.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = config.cancel ?? ((handle) => clearTimeout(handle));
    this.windowMs = config.reconnectWindowMs ?? RECONNECT_WINDOW_MS;
    this.retryBase = config.retryBaseMs ?? RETRY_BASE_MS;
    this.retryMax = config.retryMaxMs ?? RETRY_MAX_MS;
    this.memory = config.seatMemory === undefined ? browserSeatMemory() : config.seatMemory;
    // **Before the first dial, ask this device whether it is coming back.** A
    // credential for *this* room means a page that held this seat, so the very
    // first `join` is a reclaim and the room hands the ship back instead of
    // reading a returning player as a stranger at the door of a live match
    // (`./seat-memory`, a0-133). No credential — or one for another room — and
    // nothing changes: the dial is the plain join it always was.
    const remembered = this.memory?.recall(config.room, this.now()) ?? null;
    if (remembered) {
      this.seat = remembered.seat;
      this.token = remembered.token;
      this.recalled = true;
    }
    this.open();
  }

  // --- Transport ----------------------------------------------------------

  get state(): ConnectionState {
    return this.connection;
  }

  /**
   * Send a client message.
   *
   * While the socket is down, everything is dropped rather than buffered — and
   * that is the correct behaviour, not a shortcut. A bot is flying the ship on
   * the server (GDD §4.2); input queued during the gap would arrive stamped with
   * ticks the sim has long since run, and the input queue would refuse it
   * anyway. The one thing worth re-sending on reconnect is `join`, and this
   * transport re-sends it itself.
   */
  send(message: ClientMessage): void {
    if (this.connection !== 'open' || !this.socket) return;
    this.socket.send(encodeClientMessage(message));
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateHandler = handler;
  }

  /**
   * **Dial again, now** — the RECONNECT button, and the one automatic attempt a
   * returning tab is owed (`./link-loss`, m10 disconnect-honesty).
   *
   * The redial loop below only ever starts from `onclose`, which is precisely the
   * event a *backgrounded* socket never fires: the browser throttles the page, the
   * connection dies, and the `WebSocket` object sits there reading `open` forever.
   * From outside, nothing distinguishes that from a healthy quiet moment — but the
   * client can see the silence (`./link-loss`), and this is how it acts on what it
   * saw. The socket is hung up *first* so the dead one cannot fire a late `onclose`
   * into the loop we are about to start ourselves.
   *
   * Returns false when there is nothing to dial for: a deliberate leave, a refused
   * join, a dead room, or a spent grace window — and in the last two it closes with
   * the reason, so the overlay stops asking and says what happened instead.
   *
   * Backoff resets: this is a human (or a tab-return) saying "try now", and making
   * them wait out an exponential delay they cannot see would be the same silence
   * this whole feature exists to remove.
   */
  redial(): boolean {
    if (this.left || this.rejected) return false;
    const now = this.now();
    // A silent death has no `onclose`, so the drop clock may never have started.
    // The caller's detection is the earliest honest reading we have.
    if (this.droppedAt < 0) this.droppedAt = now;

    const decision = decideReconnect({
      elapsedMs: now - this.droppedAt,
      graceWindowMs: this.windowMs,
      roomLiveness: this.roomLiveness,
      room: this.config.room,
    });
    if (decision.action === 'stop') {
      this.stop(decision.reason);
      return false;
    }

    if (this.retry !== null) {
      this.cancel(this.retry);
      this.retry = null;
    }
    // Detach before closing: `onclose` bails when `this.socket !== socket`, so the
    // dead socket's close cannot re-enter `onDrop` behind this dial.
    const dead = this.socket;
    this.socket = null;
    dead?.close();

    this.attempt = 0;
    this.setState('reconnecting');
    this.reopen();
    return true;
  }

  /**
   * How long the reclaim window has left, ms, or null when nothing is being
   * recovered. The transport's own reading — measured from the drop *it* saw, which
   * is the closest thing on this side of the wire to the clock `server/room.ts`
   * started (`Slot.graceUntil`). A silently-killed socket has no such reading until
   * {@link redial} supplies one, which is why `./link-loss` keeps an estimate of its
   * own from the last frame it received.
   */
  graceRemainingMs(now: number = this.now()): number | null {
    if (this.droppedAt < 0) return null;
    return Math.max(0, this.windowMs - (now - this.droppedAt));
  }

  /**
   * **ABANDON MATCH**: say so, then hang up (`./transport` LeaveMessage).
   *
   * The difference between this and {@link close} is one frame on the wire, and it
   * is the difference between a seat held empty for a minute and a seat freed now:
   * the server substitutes the bot either way, but a stated leave closes the grace
   * window immediately (`server/room.ts` `abandon`). Sent best-effort — if the
   * socket is already gone there is nobody to tell, and the grace rule handles it.
   */
  leave(reason?: string): void {
    if (this.left) return;
    if (this.connection === 'open' && this.socket) {
      this.socket.send(
        encodeClientMessage({ type: 'leave', ...(reason !== undefined ? { reason } : {}) }),
      );
    }
    // A stated leave frees the seat at once (`server/room.ts` `abandon`), so the
    // credential this device is holding is dead the moment the frame goes out —
    // and it is forgotten here rather than left to expire, so the next page does
    // not present a seat its owner gave up (a0-133).
    //
    // {@link close} deliberately does **not** do this. Hanging up without saying so
    // is a *drop*, and a dropped seat is held for as long as the match runs (a0-72):
    // the credential is still good, and forgetting it there would take the ruling
    // back from every player who closed a tab instead of pressing a button.
    this.forgetSeat();
    this.close();
  }

  /** Leave the match: hang up, cancel any pending retry, and stop redialling.
   *  This ends the reclaim window from our side (GDD §4.2). */
  close(): void {
    if (this.left) return;
    this.left = true;
    if (this.retry !== null) {
      this.cancel(this.retry);
      this.retry = null;
    }
    this.socket?.close();
    this.socket = null;
    this.closeReasonValue = 'left';
    this.setState('closed');
  }

  /** The slot the server seated us in, or null before `welcome`. */
  get player(): PlayerId | null {
    return this.seat;
  }

  /** Why the transport closed, or null while it is still open/reconnecting. Lets a
   *  reconnect banner distinguish "the room ended" from "your grace ran out" — the
   *  two dead-socket truths (M9 Task 9b). Not part of the `Transport` interface. */
  get closeReason(): CloseReason | null {
    return this.closeReasonValue;
  }

  /** The server's reason for refusing the join, or null when it was not refused.
   *  Meaningful only alongside `closeReason === 'join-rejected'`; a menu shows it
   *  next to a RETRY (fresh allocate) / BACK choice (M10). Not part of the ratified
   *  `Transport` interface — a concrete-class extra, like {@link closeReason}. */
  get rejectReason(): string | null {
    return this.rejectReasonValue;
  }

  // --- Dialling -----------------------------------------------------------

  /**
   * Dial again after a drop — **with a current ticket** (a0-72).
   *
   * Every dial that is not the first goes through here, because every dial that is
   * not the first happens an unknown number of seconds after the last one, and the
   * ticket's 30-second life is measured in those same seconds. A refresh that
   * cannot be had is not a reason to sit still: the dial goes out on the pass we
   * hold, which a Machine still hosting the room will honour for a reclaim.
   *
   * The only verdict that stops the dial is the allocator saying the room is *gone*
   * — the one answer that means there is nothing on the far end to reach.
   */
  private reopen(): void {
    if (this.left || this.rejected) return;
    if (this.refreshTicket === null) {
      this.open();
      return;
    }
    if (this.refreshing) return; // a dial is already forming behind a re-mint
    this.refreshing = true;
    this.refreshTicket()
      .then((result) => {
        if (result.ok) this.ticket = result.ticket;
        else if (result.roomGone) this.roomLiveness = 'gone';
      })
      .catch(() => {
        // An allocator that threw is an allocator we could not reach. It says
        // nothing about the room, so nothing changes and the dial still goes.
      })
      .finally(() => {
        this.refreshing = false;
        if (this.left || this.rejected) return;
        if (this.roomLiveness === 'gone') {
          if (this.retry !== null) {
            this.cancel(this.retry);
            this.retry = null;
          }
          this.stop('room-gone');
          return;
        }
        this.open();
      });
  }

  private open(): void {
    if (this.left || this.rejected) return;
    const socket = this.connectSocket(dialUrl(this.config.url, this.ticket));
    // Snapshots are binary; without this a browser hands them over as `Blob`
    // and every read becomes asynchronous (docs/netcode-spike.md wire layout).
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = (): void => {
      this.attempt = 0;
      this.droppedAt = -1;
      // A fresh open is a clean slate: whatever a prior drop learned about the
      // room no longer bears on the connection we just made.
      this.roomLiveness = 'unknown';
      // Every dial ends the same way: ask for the room. On a first connect that
      // is a join; on a redial inside the grace window it is a reclaim, and the
      // server hands the ship back rather than seating us somewhere new.
      //
      // Sent *before* the state change is announced, and that order is
      // load-bearing: a listener told the socket is open will immediately send
      // its lobby choice, and the server drops any message from a connection it
      // has not yet seated. Open means joined, or it means nothing.
      this.sendJoin();
      this.setState('open');
    };

    socket.onmessage = (event): void => {
      const message = parseServerMessage(event.data as WireFrame);
      if (!message) return; // a frame we cannot read is dropped, never guessed
      if (message.type === 'welcome') {
        this.seat = message.you;
        if (message.reclaimToken) this.token = message.reclaimToken;
        // Seated, on this connection, by this server: whatever we were carrying is
        // now confirmed rather than merely remembered.
        this.recalled = false;
        this.rememberSeat();
      }
      // RUSH! may have moved us (a0-11). The seat we would reclaim is the seat we
      // are *playing*, so it is re-recorded here as well as on the welcome.
      if (message.type === 'matchStart' && message.you !== undefined) {
        this.seat = message.you;
        this.rememberSeat();
      }
      // A refused join is terminal, not a drop: the same ticket redialled would
      // lose the same edge lottery again (M10). Surface the reason and stop —
      // never fall through to the reconnect loop this message's own socket-close
      // would otherwise start. Forwarded first so an observer sees the reason too.
      if (message.type === 'joinError') {
        // …unless it is this device's *memory* being refused rather than this
        // player being refused, in which case there is a second door to try and
        // the refusal is not yet the answer to anything (a0-133).
        if (this.retryAsNewcomer(message.reason)) return;
        this.messageHandler?.(message);
        this.rejectJoin(message.reason);
        return;
      }
      this.messageHandler?.(message);
    };

    // An error is only ever a prelude to a close; the close handler owns the
    // recovery so there is exactly one path into it.
    socket.onerror = (): void => {};

    socket.onclose = (): void => {
      // `rejected` as well as `left`: the server closes the socket right after a
      // `joinError`, and that close must not restart the reconnect loop the
      // rejection just ended (M10).
      if (this.left || this.rejected || this.socket !== socket) return;
      this.socket = null;
      this.onDrop();
    };
  }

  /**
   * The server refused the join. Unlike a drop this is terminal (M10): retrying
   * the same ticket would only lose the same edge lottery, so cancel any pending
   * redial, hang up, record the reason, and close — the menu offers RETRY (which
   * means a *fresh* allocate, one per tap, never this transport redialling) / BACK.
   */
  private rejectJoin(reason: string): void {
    if (this.left || this.rejected) return;
    this.rejected = true;
    this.rejectReasonValue = reason;
    // The one refusal that says the seat itself is finished: the match this
    // credential belongs to has ended, so there is nothing for a later page to
    // present it to (a0-133; `server/room.ts` — *"their window never ran out,
    // their match finished"*). Every other reason leaves it written down, because
    // every other reason may be about this dial rather than about the seat.
    if (reason === 'match-over') this.forgetSeat();
    if (this.retry !== null) {
      this.cancel(this.retry);
      this.retry = null;
    }
    this.socket?.close();
    this.socket = null;
    this.closeReasonValue = 'join-rejected';
    this.setState('closed');
  }

  /**
   * The refusals that mean *this device's memory is stale*, as against *this
   * player may not come in*.
   *
   * All three are answers to a reclaim, and each of them is also what the room
   * says to a client presenting a credential for a match that has moved on: the
   * seat was freed when they left a lobby (`'reclaim-expired'`), somebody else is
   * in it or the token no longer matches (`'reclaim-denied'`), or the four letters
   * now belong to a room that never issued it (`'reclaim-unknown'`). None of them
   * is a verdict on a player who simply wants to join, so a client that reached
   * the door on a *remembered* credential has one more thing to try
   * ({@link retryAsNewcomer}) before any of them is reported as the end.
   *
   * `'match-over'` is deliberately not here, and neither is `'match-live'`: the
   * first is the room's truthful, final answer to a returning player, and the
   * second is what a stranger is told — knocking again as a newcomer would only
   * hear it a second time.
   */
  private static readonly STALE_CREDENTIAL: ReadonlySet<string> = new Set([
    'reclaim-expired',
    'reclaim-denied',
    'reclaim-unknown',
  ]);

  /** Write the seat down for the next page (a0-133). A no-op until there is both a
   *  seat and a token to write, and on a device with nowhere to put them. */
  private rememberSeat(): void {
    if (this.seat === null || this.token === null) return;
    this.memory?.remember(
      { room: this.config.room, seat: this.seat, token: this.token },
      this.now(),
    );
  }

  /** Drop the seat this device was remembering, in memory and in storage alike. */
  private forgetSeat(): void {
    this.seat = null;
    this.token = null;
    this.recalled = false;
    this.memory?.forget(this.config.room);
  }

  /**
   * **The remembered seat was refused, so knock as a newcomer** (a0-133).
   *
   * A credential that outlives its page also outlives its match: a player who left
   * a lobby, whose seat was freed, or whose four letters have since been dealt to a
   * different room is still holding one. Presenting it is right — it is the only
   * way a rebuilt page can say *"this seat is mine"* — but being refused for it
   * must not cost them the ordinary join they would otherwise have had. Before
   * a0-133 there was nothing to get wrong here, because a fresh page never
   * presented anything; the fallback is what keeps that promise intact.
   *
   * So the credential is dropped and the dial goes out again, this time as a plain
   * join. Whatever the room says to *that* is the answer the player gets: a lobby
   * seats them, a live match tells them `match-live` exactly as it did before any
   * of this existed. One extra round trip, in the one case where this device was
   * remembering something the room had forgotten.
   *
   * Returns true when it has taken the refusal over. Then the `joinError` is **not**
   * forwarded and **not** terminal: it was an answer about a credential, not about
   * this player, and a screen that painted `REFUSED: reclaim-expired` for a quarter
   * second before the welcome landed would be telling the player something that
   * never happened to them.
   *
   * The connection state is left where it is on purpose. This is a second knock on
   * the same door within one connect attempt — `connecting` on a first dial,
   * `reconnecting` on a redial — and neither of those has stopped being true.
   */
  private retryAsNewcomer(reason: string): boolean {
    if (this.left || this.rejected) return false;
    if (!this.recalled) return false;
    if (!WebSocketTransport.STALE_CREDENTIAL.has(reason)) return false;

    this.forgetSeat();
    if (this.retry !== null) {
      this.cancel(this.retry);
      this.retry = null;
    }
    // Detach before closing, exactly as {@link redial} does: the server hangs up
    // right after a `joinError`, and that close must not start a backoff loop
    // behind the dial we are making ourselves.
    const dead = this.socket;
    this.socket = null;
    dead?.close();
    this.attempt = 0;
    // Through `reopen` rather than `open`, for the ticket: a *reclaim* is admitted
    // on a lapsed-but-genuine pass and a plain join is not (`server/match-server.ts`
    // `admitsJoin`), so the knock that follows needs a current one or it would be
    // refused `bad-ticket` for a reason the player has even less to do with.
    this.reopen();
    return true;
  }

  private sendJoin(): void {
    // The allocator's ticket rides every dial, reclaims included: in a fleet the
    // Machine refuses a join it was never sent, and a redial is still a join.
    // Since a0-72 this is the *current* pass, re-minted before a redial rather
    // than the one the first dial was handed ({@link reopen}).
    const ticket = this.ticket;
    const message: ClientMessage =
      this.seat !== null && this.token !== null
        ? {
            type: 'join',
            room: this.config.room,
            reclaim: this.seat,
            reclaimToken: this.token,
            ...(ticket !== undefined ? { ticket } : {}),
          }
        : {
            type: 'join',
            room: this.config.room,
            ...(ticket !== undefined ? { ticket } : {}),
          };
    this.socket?.send(encodeClientMessage(message));
  }

  /**
   * The socket went away without us asking. Start (or continue) the sixty
   * seconds we have to get the ship back, with an exponential backoff so a
   * server that is genuinely down is not hammered by eight phones at once.
   *
   * The verdict — keep trying, or stop and why — is `decideReconnect`'s
   * (`./reconnect`), fed the elapsed grace and whatever a liveness probe has
   * learned about the room. With no probe wired (the direct-connect path) the
   * room stays `'unknown'` and the decision is the grace window alone, exactly as
   * before. With one wired, a `'gone'` room stops the loop the instant the probe
   * answers, rather than burning the rest of the window against a dead Machine.
   */
  private onDrop(): void {
    const now = this.now();
    if (this.droppedAt < 0) this.droppedAt = now;

    const decision = decideReconnect({
      elapsedMs: now - this.droppedAt,
      graceWindowMs: this.windowMs,
      roomLiveness: this.roomLiveness,
      room: this.config.room,
    });
    if (decision.action === 'stop') {
      this.stop(decision.reason);
      return;
    }

    this.setState('reconnecting');
    // Ask the allocator, in parallel with the backoff, whether the room even
    // still exists; a `'gone'` answer aborts the pending retry early (M9 Task 9b).
    this.probeRoom();
    const delay = Math.min(this.retryMax, this.retryBase * 2 ** this.attempt);
    this.attempt++;
    this.retry = this.schedule(() => {
      this.retry = null;
      if (this.left) return;
      // Re-decide on wake: the tab may have slept through the whole window, and a
      // probe may have landed a verdict while we backed off.
      const again = decideReconnect({
        elapsedMs: this.now() - this.droppedAt,
        graceWindowMs: this.windowMs,
        roomLiveness: this.roomLiveness,
        room: this.config.room,
      });
      if (again.action === 'stop') {
        this.stop(again.reason);
        return;
      }
      this.reopen();
    }, delay);
  }

  /**
   * Probe the allocator for the room's liveness while we are reconnecting, at most
   * one in flight at a time. A `'gone'` verdict is the whole point of Task 9b: it
   * cancels the pending redial and closes now, so a phone does not retry-loop
   * against a room that has ended. A `'live'`/`'unknown'` answer, or a probe that
   * throws, changes nothing — the window-based retry carries on.
   */
  private probeRoom(): void {
    if (this.checkRoomAlive === null || this.probing || this.left) return;
    this.probing = true;
    this.checkRoomAlive()
      .then((liveness) => {
        this.probing = false;
        // Ignore a verdict that arrived after we already reconnected or left: it
        // describes a socket we are no longer trying to recover.
        if (this.left || this.connection !== 'reconnecting') return;
        this.roomLiveness = liveness;
        if (liveness === 'gone') {
          if (this.retry !== null) {
            this.cancel(this.retry);
            this.retry = null;
          }
          this.stop('room-gone');
        }
      })
      .catch(() => {
        // A failed probe is not a dead room, only an unreachable allocator: leave
        // the room `'unknown'` and let the grace window keep deciding.
        this.probing = false;
      });
  }

  /** Give up reconnecting: record why, then close. */
  private stop(reason: StopReason): void {
    // A room the allocator can no longer find has ended, and a seat in it cannot be
    // reclaimed by anybody ever again — so the credential goes with it (a0-133).
    // `'grace-elapsed'` does not, and that asymmetry is the a0-72 ruling: we stopped
    // dialling on a *clock*, having never established that the room was gone, and a
    // player who reopens the page a minute later must still be able to say the seat
    // is theirs.
    if (reason === 'room-gone') this.forgetSeat();
    this.closeReasonValue = reason;
    this.setState('closed');
  }

  private setState(state: ConnectionState): void {
    if (this.connection === state) return;
    this.connection = state;
    this.stateHandler?.(state);
  }
}

/**
 * The URL to actually dial: the base with the ticket added as a `?ticket=` query
 * when there is one. On Fly the client reaches the gameserver app on one shared
 * hostname, and the edge cannot know which machine hosts this room until the
 * upgrade names it — so the ticket (the signed room→machine binding) rides the
 * upgrade URL and the socket hop replays a wrong-machine upgrade to the room's
 * host (`server/upgrade-router.ts`). The join message still carries the ticket
 * for auth; this is purely the routing hint. Off Fly (direct/solo) the machine
 * that receives the upgrade already hosts the room, so the hint is simply unread.
 * A base that will not parse as a URL (an odd test stub) is dialled as given.
 */
function dialUrl(base: string, ticket: string | undefined): string {
  if (ticket === undefined) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('ticket', ticket);
    return url.toString();
  } catch {
    return base;
  }
}

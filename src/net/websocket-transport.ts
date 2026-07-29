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
   * Ask the allocator whether the room still exists, used only after a drop to
   * tell "my connection died" from "the room died" (`./reconnect`, M9 Task 9b).
   * A `'gone'` answer stops the retry loop *early* instead of hammering a dead
   * Machine for the whole grace window. Absent (the direct-connect path) leaves
   * the room `'unknown'`, and the reconnect decision falls back to the window
   * alone — exactly today's behaviour.
   */
  readonly checkRoomAlive?: () => Promise<RoomLiveness>;
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
 * hang-up; the other two are the two dead-socket truths Task 9b keeps apart —
 * a room that ended (`'room-gone'`, nothing to reclaim, offer a new match) versus
 * a grace window that ran out (`'grace-elapsed'`, the seat is a bot's now). The
 * ratified `Transport` interface says only `state`; this richer reason is a
 * concrete-class extra the online menu reads, exactly as `player` already is.
 */
export type CloseReason = 'left' | StopReason;

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

  /** The slot the server seated us in, once `welcome` has arrived. */
  private seat: PlayerId | null = null;
  /** The secret that proves we are the same player coming back (GDD §4.2). */
  private token: string | null = null;

  /** True once `close()` was called: a deliberate exit never redials. */
  private left = false;
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

  constructor(private readonly config: WebSocketTransportConfig) {
    this.checkRoomAlive = config.checkRoomAlive ?? null;
    this.connectSocket =
      config.connect ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = config.now ?? (() => Date.now());
    this.schedule = config.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = config.cancel ?? ((handle) => clearTimeout(handle));
    this.windowMs = config.reconnectWindowMs ?? RECONNECT_WINDOW_MS;
    this.retryBase = config.retryBaseMs ?? RETRY_BASE_MS;
    this.retryMax = config.retryMaxMs ?? RETRY_MAX_MS;
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

  // --- Dialling -----------------------------------------------------------

  private open(): void {
    if (this.left) return;
    const socket = this.connectSocket(dialUrl(this.config.url, this.config.ticket));
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
      }
      this.messageHandler?.(message);
    };

    // An error is only ever a prelude to a close; the close handler owns the
    // recovery so there is exactly one path into it.
    socket.onerror = (): void => {};

    socket.onclose = (): void => {
      if (this.left || this.socket !== socket) return;
      this.socket = null;
      this.onDrop();
    };
  }

  private sendJoin(): void {
    // The allocator's ticket rides every dial, reclaims included: in a fleet the
    // Machine refuses a join it was never sent, and a redial is still a join.
    const ticket = this.config.ticket;
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
      this.open();
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

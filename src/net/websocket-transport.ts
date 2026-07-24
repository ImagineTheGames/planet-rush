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

  private readonly connectSocket: (url: string) => WebSocketLike;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => TimerHandle;
  private readonly cancel: (handle: TimerHandle) => void;
  private readonly windowMs: number;
  private readonly retryBase: number;
  private readonly retryMax: number;

  constructor(private readonly config: WebSocketTransportConfig) {
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
    this.setState('closed');
  }

  /** The slot the server seated us in, or null before `welcome`. */
  get player(): PlayerId | null {
    return this.seat;
  }

  // --- Dialling -----------------------------------------------------------

  private open(): void {
    if (this.left) return;
    const socket = this.connectSocket(this.config.url);
    // Snapshots are binary; without this a browser hands them over as `Blob`
    // and every read becomes asynchronous (docs/netcode-spike.md wire layout).
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = (): void => {
      this.attempt = 0;
      this.droppedAt = -1;
      this.setState('open');
      // Every dial ends the same way: ask for the room. On a first connect that
      // is a join; on a redial inside the grace window it is a reclaim, and the
      // server hands the ship back rather than seating us somewhere new.
      this.sendJoin();
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
    const message: ClientMessage =
      this.seat !== null && this.token !== null
        ? {
            type: 'join',
            room: this.config.room,
            reclaim: this.seat,
            reclaimToken: this.token,
          }
        : { type: 'join', room: this.config.room };
    this.socket?.send(encodeClientMessage(message));
  }

  /**
   * The socket went away without us asking. Start (or continue) the sixty
   * seconds we have to get the ship back, with an exponential backoff so a
   * server that is genuinely down is not hammered by eight phones at once.
   */
  private onDrop(): void {
    const now = this.now();
    if (this.droppedAt < 0) this.droppedAt = now;

    if (now - this.droppedAt >= this.windowMs) {
      // The window has closed: the bot owns that seat for the rest of the match
      // (GDD §4.2), so there is nothing left to reconnect *to*.
      this.setState('closed');
      return;
    }

    this.setState('reconnecting');
    const delay = Math.min(this.retryMax, this.retryBase * 2 ** this.attempt);
    this.attempt++;
    this.retry = this.schedule(() => {
      this.retry = null;
      if (this.left) return;
      // Re-check the window on wake: the tab may have been asleep for the whole
      // of it, and redialling then would just reconnect into someone else's match.
      if (this.now() - this.droppedAt >= this.windowMs) {
        this.setState('closed');
        return;
      }
      this.open();
    }, delay);
  }

  private setState(state: ConnectionState): void {
    if (this.connection === state) return;
    this.connection = state;
    this.stateHandler?.(state);
  }
}

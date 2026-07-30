/**
 * src/net/latency-transport.ts — an artificial-delay `Transport` wrapper.
 * OWNER: Netcode Engineer (GDD §4.2; M10 reconcile-feel brief).
 *
 * *"LATENCY HARNESS: ... an artificial-delay transport wrapper (150 ms +
 * jitter)."* (M10 brief.) This wraps any {@link Transport} and holds every
 * message — client→server sends and server→client deliveries alike — for a
 * configurable one-way delay plus jitter, so the developer's actual condition (a
 * gru client on an iad fleet, ~150 ms RTT) can be reproduced against a real
 * transport in a test or in manual QA, instead of only ever felt in production.
 *
 * Wrap the *online* transport with it: a two-way wire's RTT is `2 × ` the one-way
 * {@link LatencyConfig.oneWayMs}, so 75 ms one-way is the developer's 150 ms round
 * trip. Wrapping {@link LocalLoopback} is possible but pointless — that transport
 * is the authority in-process, so the session predicts nothing and there is no
 * reconciliation to stress (`./session`, `./loopback`).
 *
 * **Order is preserved, which the `Transport` contract requires** (input-message
 * order is the transport's promise, `./transport`). Jitter alone could deliver a
 * later message before an earlier one; instead each message's delivery instant is
 * clamped to be no earlier than the previous one's — exactly what a real jitter
 * buffer does — so FIFO holds while the spacing between messages still varies.
 *
 * **No ambient anything**, the same discipline as `WebSocketTransport`: the clock
 * and the timer are injected and default to the browser globals, and the jitter
 * source is injectable too, so a "150 ms + jitter" scenario is a test that runs
 * instantly and identically every time.
 */

import type { TimerHandle } from './websocket-transport';
import type {
  ClientMessage,
  ConnectionState,
  ServerMessage,
  Transport,
} from './transport';

/** Everything the wrapper needs, all injectable. */
export interface LatencyConfig {
  /** One-way delay in ms applied to each direction; RTT is twice this. */
  readonly oneWayMs: number;
  /** Peak extra delay in ms drawn per message from {@link rng}; 0 disables jitter. */
  readonly jitterMs?: number;
  /** Jitter source, `[0, 1)`. Defaults to `Math.random`; inject a seeded generator
   *  for a reproducible capture. */
  readonly rng?: () => number;
  /** Wall clock, ms. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Schedules a delivery. Defaults to `setTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => TimerHandle;
  /** Cancels a scheduled delivery. Defaults to `clearTimeout`. */
  readonly cancel?: (handle: TimerHandle) => void;
}

export class LatencyTransport implements Transport {
  private readonly outbound: DelayQueue<ClientMessage>;
  private readonly inbound: DelayQueue<ServerMessage>;
  private handler: ((message: ServerMessage) => void) | null = null;

  constructor(
    private readonly inner: Transport,
    config: LatencyConfig,
  ) {
    const now = config.now ?? ((): number => Date.now());
    const schedule = config.schedule ?? ((fn, ms): TimerHandle => setTimeout(fn, ms));
    const cancel = config.cancel ?? ((h: TimerHandle): void => clearTimeout(h));
    const rng = config.rng ?? Math.random;
    const jitter = config.jitterMs ?? 0;
    const delay = (): number => config.oneWayMs + (jitter > 0 ? rng() * jitter : 0);

    this.outbound = new DelayQueue(now, schedule, cancel, delay, (m) => this.inner.send(m));
    this.inbound = new DelayQueue(now, schedule, cancel, delay, (m) => this.handler?.(m));

    // The inner transport delivers to us immediately; we hold each message for the
    // downlink delay before handing it on.
    this.inner.onMessage((message) => this.inbound.push(message));
  }

  get state(): ConnectionState {
    // Connection lifecycle is not delayed: the reconnect machinery is a real-time
    // state machine (`./websocket-transport`), and a lagged `open` would only
    // desynchronize the wrapper from the transport it wraps. Only messages wait.
    return this.inner.state;
  }

  send(message: ClientMessage): void {
    this.outbound.push(message);
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.handler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.inner.onStateChange(handler);
  }

  close(): void {
    this.outbound.clear();
    this.inbound.clear();
    this.inner.close();
  }
}

// ---------------------------------------------------------------------------
// The delay queue
// ---------------------------------------------------------------------------

/**
 * A FIFO queue that releases each pushed item after a per-item delay, with the
 * release instant clamped monotonic so order is never disturbed by jitter. One
 * pending timer at a time, aimed at the head; refreshed as items fire.
 */
class DelayQueue<T> {
  private readonly items: { at: number; payload: T }[] = [];
  private timer: TimerHandle | null = null;
  /** The last release instant handed out, so the next is never scheduled before
   *  it — the monotonic clamp that keeps delivery FIFO under jitter. */
  private lastAt = 0;

  constructor(
    private readonly now: () => number,
    private readonly schedule: (fn: () => void, ms: number) => TimerHandle,
    private readonly cancel: (handle: TimerHandle) => void,
    private readonly delay: () => number,
    private readonly deliver: (payload: T) => void,
  ) {}

  push(payload: T): void {
    const now = this.now();
    const at = Math.max(now + this.delay(), this.lastAt);
    this.lastAt = at;
    this.items.push({ at, payload });
    if (this.timer === null) this.arm();
  }

  clear(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.items.length = 0;
  }

  /** Schedule the head item's release. */
  private arm(): void {
    const head = this.items[0];
    if (!head) return;
    const wait = Math.max(0, head.at - this.now());
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  /** Release every item now due, then re-arm for the next. */
  private flush(): void {
    const now = this.now();
    while (this.items.length > 0 && this.items[0]!.at <= now) {
      this.deliver(this.items.shift()!.payload);
    }
    if (this.items.length > 0) this.arm();
  }
}

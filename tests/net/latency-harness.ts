/**
 * tests/net/latency-harness.ts — a full two-client match on a bad wire, on a
 * virtual clock. OWNER: Netcode Engineer (M10 netcode audit, item 3).
 *
 * *"the latency harness runs the full 2-client match at 150 ms and 250 ms with
 * ±30 ms jitter and 2 % loss; correction-magnitude and visual-snap counters stay
 * under named thresholds. These runs are CI, permanent."*
 *
 * Everything under the wire is the shipping stack: the real {@link MatchServer}
 * with the real room, the real wire codec, and two real {@link TransportSession}s
 * doing real prediction, reconciliation, interpolation and presentation. The only
 * thing replaced is the *socket* — a `WebSocket` would drag a real clock and a real
 * scheduler into a test that has to be identical on every runner, so this pipes the
 * same encoded frames through a delay queue driven by the harness's own clock.
 *
 * **The clock is the point.** Nothing here reads `Date.now` or `setTimeout`: the
 * harness advances a counter one 60 Hz frame at a time and hands that number to the
 * server, the sessions, and the wire. Two consequences worth the file: a 20-second
 * match runs in milliseconds, and a run at 250 ms RTT with jitter and loss produces
 * *the same numbers every time* — which is what lets a feel threshold be a CI gate
 * instead of a flake.
 *
 * **Loss is modelled as TCP behaves, not as UDP does.** WebSocket is TCP (GDD
 * §4.3b risk 3): a lost segment is not a dropped message, it is a *stall* — the
 * message and everything queued behind it wait for a retransmit. So a "lost"
 * message here is delayed by {@link RETRANSMIT_FACTOR} round trips and the queue's
 * monotonic clamp drags its followers with it, which is head-of-line blocking,
 * which is the thing that actually happens to this game on a lossy link.
 */

import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { MatchServer } from '../../server/match-server';
import type { ServerSocket } from '../../server/room';
import { TICK_DT } from '../../src/sim';
import type { World } from '../../src/sim';
import { TransportSession } from '../../src/net/session';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { ClientMessage, ConnectionState, ServerMessage, Transport } from '../../src/net/transport';
import type { NetTelemetry } from '../../src/net/telemetry';

/** How many round trips a "lost" message waits for its retransmit. TCP's minimum
 *  RTO is one RTT plus the receiver's delayed-ack; three is the pessimistic end of
 *  what a fast-retransmit costs, which is the end a gate should be written at. */
export const RETRANSMIT_FACTOR = 3;

/** One 60 Hz frame in ms — the harness's clock granularity (GDD §4.1). */
export const FRAME_MS = TICK_DT * 1000;

/** The shape of a wire to reproduce. */
export interface WireProfile {
  /** Round-trip time, ms. One-way delay is half of it. */
  readonly rttMs: number;
  /** Peak +/- jitter applied per message, ms. `±30` means `jitterMs: 30`. */
  readonly jitterMs: number;
  /** Fraction of messages that stall for a retransmit, `[0, 1]`. */
  readonly lossRate: number;
}

/** A seeded LCG, so a run at 250 ms with jitter and loss is the same run twice. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/** One direction of the wire: a FIFO whose items come due on the harness clock. */
class Pipe<T> {
  private readonly queue: { at: number; payload: T }[] = [];
  private lastAt = -1;
  /** Messages this pipe delayed for a retransmit — reported, so a run can never
   *  claim to have tested loss it did not actually inject. */
  stalls = 0;

  constructor(
    private readonly profile: WireProfile,
    private readonly rng: () => number,
  ) {}

  push(nowMs: number, payload: T): void {
    const oneWay = this.profile.rttMs / 2;
    const jitter = this.profile.jitterMs > 0 ? (this.rng() * 2 - 1) * this.profile.jitterMs : 0;
    let delay = Math.max(0, oneWay + jitter);
    if (this.profile.lossRate > 0 && this.rng() < this.profile.lossRate) {
      delay += this.profile.rttMs * RETRANSMIT_FACTOR;
      this.stalls++;
    }
    // TCP does not reorder, and neither may this: a message is never delivered
    // before one sent ahead of it — the head-of-line clamp.
    const at = Math.max(nowMs + delay, this.lastAt);
    this.lastAt = at;
    this.queue.push({ at, payload });
  }

  /** Everything due at `nowMs`, in send order. */
  drain(nowMs: number): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.at <= nowMs) out.push(this.queue.shift()!.payload);
    return out;
  }
}

/**
 * A `Transport` that speaks the real wire codec to a real {@link MatchServer}
 * connection, through two {@link Pipe}s on the harness clock. This is the
 * `WebSocketTransport` seam with the socket taken out and the latency put in.
 */
class PipedTransport implements Transport {
  private handler: ((message: ServerMessage) => void) | null = null;
  private readonly stateHandlers: ((state: ConnectionState) => void)[] = [];
  private connection: ReturnType<MatchServer['connect']> | null = null;
  readonly up: Pipe<WireFrame>;
  readonly down: Pipe<WireFrame>;
  state: ConnectionState = 'connecting';

  constructor(
    private readonly server: MatchServer,
    profile: WireProfile,
    rng: () => number,
    private readonly clock: () => number,
  ) {
    this.up = new Pipe(profile, rng);
    this.down = new Pipe(profile, rng);
  }

  /** Ask for a seat in `room` — what `WebSocketTransport` sends itself on every
   *  dial, and what the session deliberately does not own (`./session`). */
  joinRoom(room: string): void {
    this.send({ type: 'join', room });
  }

  /** Open the connection — the moment the socket would report `open`. */
  open(): void {
    const socket: ServerSocket = {
      send: (frame: WireFrame): void => this.down.push(this.clock(), frame),
      close: (): void => undefined,
    };
    this.connection = this.server.connect(socket);
    this.state = 'open';
    for (const handler of this.stateHandlers) handler('open');
  }

  send(message: ClientMessage): void {
    this.up.push(this.clock(), encodeClientMessage(message));
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.handler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateHandlers.push(handler);
  }

  close(): void {
    this.state = 'closed';
    this.connection?.close(this.clock());
  }

  /** Move every message that has come due, in both directions. */
  pump(nowMs: number): void {
    for (const frame of this.up.drain(nowMs)) this.connection?.receive(frame);
    for (const frame of this.down.drain(nowMs)) {
      const message = parseServerMessage(frame);
      if (message) this.handler?.(message);
    }
  }
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/** One client in the harness: its session, its instrument, and its world. */
export interface HarnessClient {
  readonly session: TransportSession;
  readonly telemetry: NetTelemetry;
  readonly you: PlayerId;
  readonly world: World | null;
  /** What this client's screen shows for a given slot right now — the *presented*
   *  position, which is the whole point of the audit: the number a player sees, not
   *  the number the simulation holds. */
  screenPos(id: PlayerId): { x: number; y: number } | null;
}

export interface LatencyMatchOptions {
  readonly profile: WireProfile;
  /** Frames to run after the match starts. 60 = one second. */
  readonly frames: number;
  /** Seed for the wire's jitter/loss draws and the match world. */
  readonly seed?: number;
  /** Each client's input for a frame — the flight plan. Default: both thrust,
   *  in opposite directions, so both ships genuinely fly. */
  readonly input?: (client: number, frame: number) => readonly Action[];
  /** Rocks in the arena. Small keeps the run quick; non-zero keeps mining real. */
  readonly asteroidCount?: number;
}

/** What a run reports back — enough for a gate, and for a capture in the doc. */
export interface LatencyMatchResult {
  readonly clients: readonly HarnessClient[];
  /** Retransmit stalls actually injected, both directions, both clients. */
  readonly stalls: number;
  /** Frames run. */
  readonly frames: number;
  /** The authoritative world, for comparing a screen against the truth. */
  readonly authoritative: World;
}

const DEFAULT_INPUT = (client: number, frame: number): readonly Action[] => {
  // A real flight, not a straight line: each client circles at its own rate, so
  // prediction has direction changes to get wrong and interpolation has curves to
  // round off. Opposite phase, so the two ships are never at rest relative to
  // each other.
  const t = frame / 60;
  const sign = client === 0 ? 1 : -1;
  const angle = sign * t * 1.7 + client * Math.PI;
  return [
    { type: 'thrust', dir: { x: Math.cos(angle), y: Math.sin(angle) } },
    { type: 'aim', dir: { x: Math.cos(angle), y: Math.sin(angle) } },
    // Hold fire: the audit's second item is about projectiles, so every run must
    // actually produce some.
    { type: 'fire', active: true, auto: false },
  ];
};

/**
 * Run a full two-client match over the given wire and hand back what each client
 * measured. Deterministic: same options in, same numbers out.
 */
export function runLatencyMatch(options: LatencyMatchOptions): LatencyMatchResult {
  const seed = options.seed ?? 20260730;
  const rng = lcg(seed);
  let nowMs = 0;
  const clock = (): number => nowMs;

  const server = new MatchServer({
    seed,
    slots: 2,
    asteroidCount: options.asteroidCount ?? 12,
  });

  const transports: PipedTransport[] = [];
  const sessions: TransportSession[] = [];
  for (let i = 0; i < 2; i++) {
    const transport = new PipedTransport(server, options.profile, rng, clock);
    transports.push(transport);
    sessions.push(new TransportSession(transport, { now: clock }));
    transport.open();
  }

  const input = options.input ?? DEFAULT_INPUT;
  const pump = (): void => {
    for (const transport of transports) transport.pump(nowMs);
    server.update(nowMs);
  };
  /** Advance the clock `frames` frames, or until `done()` — whichever first. */
  const settle = (frames: number, done?: () => boolean): void => {
    for (let f = 0; f < frames; f++) {
      if (done?.()) return;
      nowMs += FRAME_MS;
      pump();
    }
  };
  /** Frames one round trip takes, plus a frame of slack. */
  const rttFrames = Math.ceil(options.profile.rttMs / FRAME_MS) + 1;

  // The lobby, in the order a real one happens and with the wire's delay between
  // each step: both clients join, *then* both pick a hull, *then* the creator
  // starts. Collapsing these (the offline `open()` gesture) would race the second
  // join against the match going live, and the server would rightly refuse it.
  for (const transport of transports) transport.joinRoom('RUSH');
  settle(rttFrames * 4, () => (server.room('RUSH')?.humanCount ?? 0) === 2);
  for (let i = 0; i < sessions.length; i++) {
    sessions[i]!.chooseInLobby({ shipClass: i === 0 ? ShipClass.Vanguard : ShipClass.Interceptor });
  }
  settle(rttFrames * 2);
  sessions[0]!.startMatch();
  settle(rttFrames * 6, () => sessions.every((s) => s.world !== null));

  for (let frame = 1; frame <= options.frames; frame++) {
    nowMs += FRAME_MS;
    pump();
    for (let i = 0; i < sessions.length; i++) sessions[i]!.sendInput(input(i, frame));
  }

  const room = server.room('RUSH');
  const clients: HarnessClient[] = sessions.map((session) => ({
    session,
    telemetry: session.telemetry,
    you: session.you,
    world: session.world,
    screenPos: (id: PlayerId): { x: number; y: number } | null => {
      const ship = session.world?.ships.find((s) => s.id === id);
      return ship ? { x: ship.pos.x, y: ship.pos.y } : null;
    },
  }));

  const stalls = transports.reduce((n, t) => n + t.up.stalls + t.down.stalls, 0);
  return {
    clients,
    stalls,
    frames: options.frames,
    authoritative: room!.world!,
  };
}

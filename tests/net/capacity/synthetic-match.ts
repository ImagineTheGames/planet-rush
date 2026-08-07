/**
 * tests/net/capacity/synthetic-match.ts — one room's worth of real load. OWNER:
 * Netcode Engineer (m11 server stress; GDD §4.2).
 *
 * **The room shape is the worst case the fleet advertises**, on purpose: eight
 * seats, one human, **seven Hard bots**. Bot AI runs server-side (GDD §2.9), so
 * seven bots cost the Machine more than seven humans would — a human's ship is
 * driven by input the server merely applies, a bot's is driven by a behaviour
 * tree the server *runs*. A capacity number measured on 8-human rooms would be
 * optimistic about the only configuration the game actually ships (a classroom
 * has three humans and five bots, GDD §4.2).
 *
 * **It is opened the way a player opens one** — allocate, dial, `join` with the
 * signed ticket, `lobbyChoice`, `startMatch` — and then flown: thrust, aim, and a
 * held trigger at 60 Hz, plus the 2 Hz latency probe the shipping client sends.
 * No sim shortcut, no in-process room creation, no `MatchServer` handle. The
 * brief's word is "real wire" and this is what that costs.
 *
 * One thing it deliberately does NOT do is *think*: the flight path is a slow
 * circle and the trigger is always down. That is not a lazy pilot, it is a
 * **reproducible** one — the server's cost must not depend on how well the
 * harness plays, or two runs of the same N are two different measurements.
 *
 * Every match is stepped by one shared driver ({@link SyntheticFleet}) rather
 * than owning a timer: thirty rooms with their own 60 Hz intervals is ~1,800
 * harness wakeups a second competing with the very process being measured.
 */

import type { ShipClass } from '@shared/types';
import type { CapacityTarget } from './target';
import { openLoadSocket } from './ws-load-client';
import type { LoadSocket, LoadSocketStats } from './ws-load-client';

/** The sim's fixed timestep (GDD §4.1). Input is stamped on this grid. */
const TICK_MS = 1000 / 60;

/** How far ahead of the server's tick the harness stamps its input.
 *
 *  A predicting client's lead is *emergent* — it lands one round trip ahead by
 *  replaying unacknowledged input (docs/netcode-spike.md) — but this client does
 *  not predict, so it needs a constant. Four ticks (~67 ms) is a plausible LAN-ish
 *  lead and, more importantly, a fixed one: input that lands early is queued and
 *  input that lands late is re-filed onto the next unsimulated tick
 *  (`server/room.ts` `acceptInput`), and neither costs the server differently.
 *  What would skew a measurement is a lead that *drifts* with load. */
const INPUT_LEAD_TICKS = 4;

/** The shipping client probes latency twice a second (`src/net/transport`
 *  PingMessage) and the server answers it in the socket handler, off the tick.
 *  It is a small cost, but it is a *real* one and it scales with room count. */
const PING_INTERVAL_MS = 500;

/** How long a match may take to get from `place()` to `matchStart` before the
 *  ramp calls it failed. Generous: this is a liveness bound, not a budget. */
const START_TIMEOUT_MS = 20_000;

/** What one synthetic match is doing, from the ramp's side. */
export interface SyntheticMatch {
  readonly room: string;
  readonly machine: string | undefined;
  readonly stats: LoadSocketStats;
  /** True once `matchStart` has arrived — the room is live and being flown. */
  readonly live: boolean;
  /** Why this match stopped generating load, or null while it is healthy. */
  readonly failure: string | null;
  /** Sim ticks of input sent. A room whose count stops moving is not loading. */
  readonly inputsSent: number;
  close(): void;
}

/** Options for one room. */
export interface SyntheticMatchOptions {
  /** Hull for the human seat. Defaults to the Vanguard (the onboarding default). */
  readonly shipClass?: ShipClass;
  /** See {@link SyntheticMatch}; opt in to snapshot payloads for a test that
   *  wants to prove the load is real. Off on the ramp path. */
  readonly onSnapshot?: (payload: ArrayBuffer) => void;
}

/** The seven bots that fill the room. All Hard — the expensive tree (GDD §2.9). */
const SEVEN_HARD_BOTS = ['hard', 'hard', 'hard', 'hard', 'hard', 'hard', 'hard'] as const;

class Match implements SyntheticMatch {
  readonly stats: LoadSocketStats;
  live = false;
  failure: string | null = null;
  inputsSent = 0;
  /** The server tick `matchStart` named, and the harness clock it was named at —
   *  together these turn wall-clock into the tick an input should be stamped for. */
  private baseTick = 0;
  private baseAtMs = 0;
  private lastSentTick = -1;
  private seq = 1;
  private pingId = 1;
  private lastPingMs = 0;
  private closed = false;

  constructor(
    readonly room: string,
    readonly machine: string | undefined,
    private readonly socket: LoadSocket,
  ) {
    this.stats = socket.stats;
  }

  /** Called by the driver at ~60 Hz. Sends at most one input per sim tick, so a
   *  driver that runs late sends fewer messages rather than a burst. */
  step(nowMs: number): void {
    if (this.closed || !this.live || this.failure !== null) return;
    if (!this.socket.open) {
      this.failure = 'socket closed mid-match';
      return;
    }

    const tick = this.baseTick + Math.floor((nowMs - this.baseAtMs) / TICK_MS) + INPUT_LEAD_TICKS;
    if (tick > this.lastSentTick) {
      this.lastSentTick = tick;
      // A slow circle: thrust and aim rotate together once every ~10 s, trigger
      // held. Deterministic in the tick, so the flight path of room 1 at N=4 is
      // the flight path of room 1 at N=40 (see the header).
      const angle = (tick / 600) * Math.PI * 2;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      this.socket.send(
        JSON.stringify({
          type: 'input',
          tick,
          seq: this.seq++,
          actions: [
            { type: 'thrust', dir },
            { type: 'aim', dir },
            { type: 'fire', active: true, auto: true },
          ],
        }),
      );
      this.inputsSent++;
    }

    if (nowMs - this.lastPingMs >= PING_INTERVAL_MS) {
      this.lastPingMs = nowMs;
      this.socket.send(JSON.stringify({ type: 'ping', id: this.pingId++ }));
    }
  }

  /** Feed one server→client JSON message. Only three of them matter here. */
  handle(text: string): void {
    let message: { type?: unknown; tick?: unknown; reason?: unknown };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (message.type === 'joinError') {
      this.failure = `joinError: ${String(message.reason)}`;
      return;
    }
    if (message.type === 'matchStart') {
      this.baseTick = typeof message.tick === 'number' ? message.tick : 0;
      this.baseAtMs = Date.now();
      this.lastPingMs = this.baseAtMs;
      this.live = true;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // ABANDON MATCH rather than a bare hang-up: a socket that simply dies holds
    // the seat for the ~60 s reconnect grace with a bot flying it (GDD §4.2), so
    // a ramp that tore down by closing would leave the Machine running its rooms
    // for a minute after the step ended and poison the next step's baseline.
    if (this.socket.open) this.socket.send(JSON.stringify({ type: 'leave', reason: 'capacity-ramp' }));
    this.socket.close();
  }
}

/**
 * Open one room and fly it. Resolves once `matchStart` has arrived — the room is
 * live, its seven bots are running, and the server is paying for it. Rejects if
 * the allocator refuses, the socket will not open, or the room never starts.
 */
export async function openSyntheticMatch(
  target: CapacityTarget,
  options: SyntheticMatchOptions = {},
): Promise<SyntheticMatch & { step(nowMs: number): void }> {
  const placement = await target.place();
  const socket = await openLoadSocket(placement.url);
  const match = new Match(placement.room, placement.machine, socket);
  socket.onText((text) => match.handle(text));
  if (options.onSnapshot) socket.onBinary(options.onSnapshot);

  socket.send(
    JSON.stringify({
      type: 'join',
      room: placement.room,
      ...(placement.ticket !== undefined ? { ticket: placement.ticket } : {}),
    }),
  );
  socket.send(
    JSON.stringify({
      type: 'lobbyChoice',
      shipClass: options.shipClass ?? 'vanguard',
      fireMode: 'auto',
      botDifficulties: SEVEN_HARD_BOTS,
      mode: 'ffa',
    }),
  );
  socket.send(JSON.stringify({ type: 'startMatch' }));

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!match.live) {
    if (match.failure !== null) {
      socket.close();
      throw new Error(`room ${placement.room}: ${match.failure}`);
    }
    if (!socket.open) {
      throw new Error(`room ${placement.room}: socket closed before matchStart`);
    }
    if (Date.now() > deadline) {
      socket.close();
      throw new Error(`room ${placement.room}: no matchStart within ${START_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return match;
}

/**
 * Every open room, driven by **one** 60 Hz timer.
 *
 * The alternative — an interval per match — makes the harness the second-busiest
 * thing on the box at thirty rooms, and a measurement whose noise floor rises
 * with N is not a measurement of the server.
 */
export class SyntheticFleet {
  private readonly matches: (SyntheticMatch & { step(nowMs: number): void })[] = [];
  private readonly driver: NodeJS.Timeout;

  constructor(private readonly target: CapacityTarget) {
    this.driver = setInterval(() => {
      const now = Date.now();
      for (const match of this.matches) match.step(now);
    }, TICK_MS);
    this.driver.unref?.();
  }

  get size(): number {
    return this.matches.length;
  }

  /** Rooms that have stopped generating load — a dropped socket, a refused join.
   *  The ramp reports these rather than averaging over them: a step that "held
   *  10 ms at 40 rooms" because six of them died is not a capacity result. */
  get failures(): readonly string[] {
    return this.matches.filter((m) => m.failure !== null).map((m) => `${m.room}: ${m.failure}`);
  }

  get live(): number {
    return this.matches.filter((m) => m.live && m.failure === null).length;
  }

  /** Total snapshot bytes every room has received, for the per-client bandwidth
   *  column (the spike's ~510 B × 30 Hz, re-measured under load). */
  get binaryBytes(): number {
    return this.matches.reduce((sum, m) => sum + m.stats.binaryBytes, 0);
  }

  get binaryFrames(): number {
    return this.matches.reduce((sum, m) => sum + m.stats.binaryFrames, 0);
  }

  /**
   * Open `count` more rooms. Serial, with a small gap: opening thirty rooms in
   * one burst measures the *allocator's* burst behaviour and the server's room
   * construction, not its steady-state tick cost, and a burst of `createWorld`
   * calls shows up as a lag spike the p99 window then remembers for two minutes.
   */
  async add(count: number, gapMs = 150): Promise<void> {
    for (let i = 0; i < count; i++) {
      this.matches.push(await openSyntheticMatch(this.target));
      if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  stop(): void {
    clearInterval(this.driver);
    for (const match of this.matches) match.close();
    this.matches.length = 0;
  }
}

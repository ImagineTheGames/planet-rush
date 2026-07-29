/**
 * server/heartbeat.ts — a Machine's identity, its load, and the beat that tells
 * the allocator it is alive. OWNER: Netcode Engineer (M9 fleet membership;
 * GDD §4.2).
 *
 * The allocator does not *store* the fleet, it *learns* it: every Machine states
 * the full truth of what it hosts, every few seconds, and the allocator's
 * registry is a cache rebuilt from those beats (allocator/registry.ts). This file
 * is the *speaker's* side of that arrangement — everything the match server needs
 * to say who it is and how it is doing, with the timers and the socket kept out
 * in `server/index.ts` so the pieces here stay unit-testable.
 *
 * **The load signal is event-loop lag, not CPU percent.** The match server runs a
 * fixed-cadence 60 Hz authoritative loop; the only question that matters for
 * placement is whether it is *making its deadline*, and lag answers that
 * directly. It also catches the failure a CPU reading actively hides: a throttled
 * shared vCPU is busy on someone else's work, so `top` reads low while our loop
 * misses tick after tick. Lag sees the misses; CPU sees an idle-looking host.
 * {@link EventLoopLagMonitor} keeps a sliding window of samples and reports the
 * p99 — the tail is the whole point, because a loop that mostly hits and
 * occasionally stalls is a loop that occasionally drops everyone's tick.
 *
 * **Configuration is environment-only.** Identity comes from `MACHINE_ID`
 * (falling back to Fly's `FLY_MACHINE_ID`) and `REGION` (falling back to
 * `FLY_REGION`) — no config file, because a host that needs a config file is a
 * host that needs porting (GDD §4.2, risk 1). A Machine with no `ALLOCATOR_URL`
 * to beat to is a solo/self-hosted server and simply never starts a reporter.
 *
 * **Nothing here reads a clock or opens a socket.** Lag samples arrive as
 * monotonic readings the caller supplies ({@link LagProbe.sample}); posting is
 * the injected {@link HeartbeatPoster}; the drain state is a plain flag a route
 * flips ({@link Cordon}). That is what lets a test watch a fleet Machine cordon,
 * stall, and beat without a timer or a network. **Zero new dependencies.**
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Who a Machine is, as the allocator names it in a ticket (src/net/ticket.ts). */
export interface MachineIdentity {
  /** This Machine's id — the value a ticket routes a room to. */
  readonly machine: string;
  /** The datacentre it runs in — a placement and cross-region routing hint. */
  readonly region: string;
}

/**
 * Read a Machine's identity from the environment. `MACHINE_ID` falls back to
 * Fly's `FLY_MACHINE_ID`, and `REGION` to `FLY_REGION`, so the same image runs
 * on Fly (which injects the `FLY_*` pair) and on a plain VPS (which sets the
 * explicit pair) with no code change. Missing values become empty strings — an
 * empty identity is a misconfiguration a solo run never reaches, because a solo
 * run has no allocator to beat to.
 */
export function readMachineIdentity(
  env: Readonly<Record<string, string | undefined>>,
): MachineIdentity {
  return {
    machine: env['MACHINE_ID'] ?? env['FLY_MACHINE_ID'] ?? '',
    region: env['REGION'] ?? env['FLY_REGION'] ?? '',
  };
}

// ---------------------------------------------------------------------------
// Event-loop lag — the load signal
// ---------------------------------------------------------------------------

/** Samples the sliding lag window keeps. At the default sample cadence this is a
 *  couple of minutes of history — enough for a stable tail, small enough to
 *  forget a stall the host has recovered from. */
export const DEFAULT_LAG_WINDOW = 256;

/**
 * A sliding window of event-loop lag samples with a p99 read. Pure: it holds
 * numbers and sorts them, reads no clock, and knows nothing about how a sample
 * was measured. Feed it lag (ms past the loop's deadline) via {@link record};
 * ask it for the tail via {@link p99}.
 */
export class EventLoopLagMonitor {
  private readonly samples: number[] = [];
  private readonly window: number;

  constructor(window: number = DEFAULT_LAG_WINDOW) {
    this.window = Math.max(1, Math.floor(window));
  }

  /** How many samples the window currently holds. */
  get count(): number {
    return this.samples.length;
  }

  /**
   * Record one lag sample, in ms. A non-finite reading is dropped, and a slightly
   * negative one (the timer fired a hair early — clock granularity, not a stall)
   * is floored to zero: lag is overshoot, never undershoot.
   */
  record(lagMs: number): void {
    if (!Number.isFinite(lagMs)) return;
    this.samples.push(lagMs < 0 ? 0 : lagMs);
    if (this.samples.length > this.window) this.samples.shift();
  }

  /** The 99th-percentile lag over the window, in ms; 0 when there is no sample
   *  yet. With few samples the tail is simply the worst of them, which is the
   *  honest reading — a stall in a short history is still a stall. */
  p99(): number {
    return this.percentile(0.99);
  }

  /** Nearest-rank percentile of the current window (`q` in [0, 1]). */
  percentile(q: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil(q * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted[index]!;
  }
}

/**
 * Turns a recurring monotonic clock reading into lag samples. The caller fires a
 * timer at {@link intervalMs} and hands each firing's monotonic reading to
 * {@link sample}; the probe records how far *past* the interval the loop actually
 * ran — that overshoot is the event loop's lag. When the loop is healthy the
 * elapsed time is ~the interval and the sample is ~0; when the host is throttled
 * or the loop is busy, the timer fires late and the sample is the delay.
 *
 * It reads no clock of its own: the monotonic value is injected, so a test drives
 * it with exact numbers.
 */
export class LagProbe {
  private last: number | null = null;

  constructor(
    private readonly monitor: EventLoopLagMonitor,
    private readonly intervalMs: number,
  ) {}

  /**
   * Feed one monotonic reading (ms; e.g. `performance.now()`). The first call
   * only anchors the clock — there is no prior firing to measure against — so it
   * records nothing.
   */
  sample(monotonicMs: number): void {
    if (this.last !== null) {
      const elapsed = monotonicMs - this.last;
      this.monitor.record(elapsed - this.intervalMs);
    }
    this.last = monotonicMs;
  }
}

// ---------------------------------------------------------------------------
// Draining — graceful cordoning
// ---------------------------------------------------------------------------

/**
 * A one-way drain switch. A Machine being decommissioned is *cordoned*, not
 * killed: it stops advertising capacity so the allocator places no new room on
 * it, while its running rooms are still listed so joins and reconnects to them
 * keep working (GDD §4.2 reconnect grace). Those matches end on their own and the
 * host leaves the fleet empty. The switch is one-way — a Machine told to drain is
 * on its way out and does not come back.
 */
export class Cordon {
  private cordoned = false;

  /** Begin draining. Idempotent. */
  drain(): void {
    this.cordoned = true;
  }

  /** True once {@link drain} has been called. */
  get draining(): boolean {
    return this.cordoned;
  }
}

// ---------------------------------------------------------------------------
// The heartbeat body
// ---------------------------------------------------------------------------

/** A Machine's load, as a heartbeat carries it. */
export interface HeartbeatLoad {
  /** 99th-percentile event-loop lag over the recent window, in ms. */
  readonly eventLoopLagP99Ms: number;
}

/** One room in a heartbeat's room list — the shape the registry ingests. */
export interface HeartbeatRoom {
  readonly code: string;
  readonly players: number;
  /** Match size (N), advertised so a lobby can show/refuse the room before
   *  dialing (variable-slots Task C3). Optional — an old Machine omits it. */
  readonly size?: number;
  /** Match mode (`'ffa' | 'teams'`), advertised on the same terms as size. */
  readonly mode?: string;
  /** Seats a new human can still take right now (0 once live or full). */
  readonly joinableSeats?: number;
}

/**
 * The full truth a Machine states each beat: who it is, what it will take, what
 * it hosts right now, and how loaded it is. The room list is *state, not a
 * delta* — every beat is the complete set, so the registry replaces rather than
 * accumulates (allocator/registry.ts). `draining` and `load` are additive over
 * the registry's required fields; the allocator ignores what it does not yet read.
 */
export interface HeartbeatBody {
  readonly machine: string;
  readonly region: string;
  /** Rooms this Machine will take — its ceiling, or **0 while draining** so the
   *  allocator places nothing new on a host on its way out. */
  readonly capacity: number;
  /** True once cordoned; carried so an operator (and a future fleet controller)
   *  can tell an empty host apart from a draining one. */
  readonly draining: boolean;
  readonly rooms: readonly HeartbeatRoom[];
  readonly load: HeartbeatLoad;
}

/**
 * What a Machine announces on boot (M10 fleet registration): its identity and the
 * ceiling it will place under. No room list — a freshly-booted Machine hosts none
 * yet; its rooms arrive on the heartbeats that follow. Authenticated on the wire
 * with the shared secret (`src/net/fleet-auth.ts`), like every fleet write.
 */
export interface RegistrationBody {
  readonly machine: string;
  readonly region: string;
  readonly capacity: number;
}

/**
 * What a Machine sends to `POST /deregister` as it leaves the fleet (M10): just
 * who it is. The graceful counterpart to being expired by liveness — a Machine on
 * its way out says so, so the allocator forgets it at once.
 */
export interface DeregistrationBody {
  readonly machine: string;
}

/** Assemble a boot registration. Pure — no clock, no I/O. Mirrors
 *  {@link buildHeartbeat}'s cordon rule: a Machine already draining at
 *  registration announces zero capacity so nothing is ever placed on it. */
export function buildRegistration(inputs: {
  readonly identity: MachineIdentity;
  readonly capacity: number;
  readonly draining: boolean;
}): RegistrationBody {
  return {
    machine: inputs.identity.machine,
    region: inputs.identity.region,
    capacity: inputs.draining ? 0 : inputs.capacity,
  };
}

/** Everything {@link buildHeartbeat} needs, gathered by the reporter each beat. */
export interface HeartbeatInputs {
  readonly identity: MachineIdentity;
  readonly capacity: number;
  readonly draining: boolean;
  readonly rooms: readonly HeartbeatRoom[];
  readonly lagP99Ms: number;
}

/**
 * Assemble one heartbeat body. Pure — no clock, no I/O. Cordoning collapses to
 * one rule here: a draining Machine advertises **zero** capacity, which is all it
 * takes for the allocator's least-loaded placement to route no new room to it
 * while its listed rooms stay reachable.
 */
export function buildHeartbeat(inputs: HeartbeatInputs): HeartbeatBody {
  return {
    machine: inputs.identity.machine,
    region: inputs.identity.region,
    capacity: inputs.draining ? 0 : inputs.capacity,
    draining: inputs.draining,
    rooms: inputs.rooms,
    load: { eventLoopLagP99Ms: inputs.lagP99Ms },
  };
}

// ---------------------------------------------------------------------------
// The reporter
// ---------------------------------------------------------------------------

/** What the match server exposes to a heartbeat — its ceiling and its rooms. */
export interface HeartbeatSource {
  /** The most rooms this process will host. */
  readonly capacity: number;
  /** Every room hosted right now and its human occupancy. */
  roomLoads(): readonly HeartbeatRoom[];
}

/** Sends a composed heartbeat to the allocator. The real one POSTs JSON to
 *  `${ALLOCATOR_URL}/fleet/heartbeat`; a test keeps the bodies in an array. */
export interface HeartbeatPoster {
  post(body: HeartbeatBody): Promise<void>;
}

/** The heartbeat interval Fly's and the registry's liveness assume: three missed
 *  5 s beats is the 15 s a Machine has before the registry forgets it
 *  (allocator/registry.ts, `DEFAULT_LIVENESS_MS`). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

/** How often the lag probe samples the loop. Fine enough for a stable p99,
 *  far too cheap to matter against a 60 Hz sim. */
export const DEFAULT_LAG_SAMPLE_INTERVAL_MS = 500;

/** Everything a {@link HeartbeatReporter} is wired from — all injected. */
export interface HeartbeatReporterDeps {
  readonly identity: MachineIdentity;
  readonly source: HeartbeatSource;
  readonly cordon: Cordon;
  readonly lag: EventLoopLagMonitor;
  readonly poster: HeartbeatPoster;
}

/**
 * Composes and sends heartbeats. The timer that calls {@link beat} on a cadence
 * lives in `server/index.ts`; this object only gathers the current truth and
 * hands it to the poster, so it is exercised in a test with no clock and no
 * socket.
 */
export class HeartbeatReporter {
  constructor(private readonly deps: HeartbeatReporterDeps) {}

  /** The heartbeat body for the current instant. Pure — safe to call anywhere. */
  compose(): HeartbeatBody {
    return buildHeartbeat({
      identity: this.deps.identity,
      capacity: this.deps.source.capacity,
      draining: this.deps.cordon.draining,
      rooms: this.deps.source.roomLoads(),
      lagP99Ms: this.deps.lag.p99(),
    });
  }

  /**
   * Compose and post one heartbeat. A transport failure is swallowed on purpose:
   * a dropped beat is recoverable — the registry rides out a few misses and the
   * next beat restates the whole truth — and a heartbeat must never be the reason
   * the sim loop throws (allocator/registry.ts).
   */
  async beat(): Promise<void> {
    try {
      await this.deps.poster.post(this.compose());
    } catch {
      // Ignored by design; see the doc above.
    }
  }
}

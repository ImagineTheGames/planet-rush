/**
 * allocator/router.ts — the routing seam. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md, Task 8).
 *
 * The allocator's job is to decide *which Machine* a room lives on. That
 * decision then has to become a thing a client can act on, and *how* it becomes
 * actionable is the one genuinely vendor-shaped corner of the HTTP layer:
 *
 *   • On Fly.io every client reaches one Anycast app hostname, and the edge is
 *     told where to send each request with a `fly-replay` response header. The
 *     allocator answers, sets `fly-replay: instance=<machine>`, and steps out —
 *     Fly re-delivers the request to that Machine and the client never learns a
 *     per-Machine address. This is what keeps the allocator **out of the
 *     gameplay path**: it never proxies a packet, it only names a destination.
 *
 *   • Off Fly — a laptop, the €4 VPS, the Oracle free tier (docs/netcode-spike.md)
 *     — there is no edge to replay, so the client is handed the Machine's own URL
 *     and dials it directly.
 *
 * Both are the same seam ({@link Router}), so `allocator/index.ts` is written
 * once and the deployment picks the implementation. This mirrors the discipline
 * of {@link MachineProvider} (allocator/provider.ts): exactly one file knows the
 * vendor, everything above it stays vendor-blind. **Pure and dependency-free** —
 * a Router only rewrites strings; it reads no clock and touches no network.
 */

import type { MachineId } from '../src/net/ticket';

/** The allocator's decision, as the Router receives it: a Machine and its region. */
export interface RouteTarget {
  /** The Machine the room lives on — the destination the client must reach. */
  readonly machine: MachineId;
  /** The datacentre that Machine runs in (drives cross-region replay hints). */
  readonly region: string;
}

/**
 * How a client is sent to its Machine, expressed as HTTP. Exactly one of the two
 * fields carries the routing: `headers` on Fly (the edge acts on `fly-replay`),
 * `connectUrl` off Fly (the client dials it). The allocator writes both onto its
 * response; a client uses whichever its deployment populated.
 */
export interface RouteInstruction {
  /** Response headers to merge in — `{ 'fly-replay': … }` on Fly, empty off it. */
  readonly headers: Readonly<Record<string, string>>;
  /** A direct connect URL for the Machine, or `null` when the edge routes instead. */
  readonly connectUrl: string | null;
}

/** The seam. One method: turn "go to this Machine" into an HTTP instruction. */
export interface Router {
  routeTo(target: RouteTarget): RouteInstruction;
}

/**
 * Off-Fly routing: resolve a Machine to its own address and let the client dial
 * it. The resolver is injected — a `Map` in a test, an address template or a
 * service-discovery lookup in production — so this file, like every file above
 * the vendor seam, knows nothing about how a Machine gets an address.
 */
export class DirectRouter implements Router {
  constructor(private readonly resolve: (machine: MachineId) => string) {}

  routeTo(target: RouteTarget): RouteInstruction {
    return { headers: {}, connectUrl: this.resolve(target.machine) };
  }
}

/** Configuration for a {@link FlyReplayRouter}. */
export interface FlyReplayConfig {
  /**
   * The allocator's own region. When set, a target in the *same* region needs
   * only an `instance=` pin; a target elsewhere gets a `region=` hint too, which
   * Fly requires to replay across datacentres. Unset, the router always pins by
   * instance alone — still correct, just without the cross-region optimisation.
   */
  readonly selfRegion?: string;
  /**
   * The Fly app the match Machines run as, when that is a *different* app from
   * the one serving the allocator. Adds `app=` to the replay directive so the
   * edge crosses the app boundary. Omit when allocator and match share an app.
   */
  readonly appName?: string;
}

/**
 * Fly.io routing: answer with a `fly-replay` header and let the edge re-deliver
 * the request to the named Machine. The directive is assembled in Fly's order —
 * `app`, then `region`, then `instance` — with only the parts this target needs.
 * No URL is handed back: on Fly the client stays on the shared app hostname, so
 * the allocator can disappear the instant the request is replayed.
 */
export class FlyReplayRouter implements Router {
  private readonly selfRegion: string | undefined;
  private readonly appName: string | undefined;

  constructor(config: FlyReplayConfig = {}) {
    this.selfRegion = config.selfRegion;
    this.appName = config.appName;
  }

  routeTo(target: RouteTarget): RouteInstruction {
    const parts: string[] = [];
    if (this.appName !== undefined) parts.push(`app=${this.appName}`);
    // A region hint is only meaningful (and only needed) for a cross-region
    // target; without a known self-region we cannot tell, so we omit it.
    if (this.selfRegion !== undefined && target.region !== this.selfRegion) {
      parts.push(`region=${target.region}`);
    }
    parts.push(`instance=${target.machine}`);
    return { headers: { 'fly-replay': parts.join(';') }, connectUrl: null };
  }
}

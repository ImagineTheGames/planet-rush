/**
 * allocator/probe-target.ts — where a client goes to TIME a region. OWNER:
 * Netcode Engineer (GDD §4.2; the developer's ratified region-picker ask,
 * docs/region-picker.md).
 *
 * `edge-region.ts` infers where the creator is and the allocator prefers that
 * region. This file is the other half of the same question — the half that gives
 * the *player* agency: to choose a region deliberately, a client has to be able to
 * **measure** each one, and to measure one it needs an address it can time a real
 * HTTP round trip against. `GET /regions` therefore publishes, per region, a probe
 * target: a URL and (where the deployment needs it) the headers that steer the
 * request into that region.
 *
 * **The client stays vendor-blind, and that is the whole point of this file.**
 * `src/net/region-probe.ts` fetches a URL with some headers and times it; it knows
 * nothing about Fly, anycast, or replay. Exactly as with {@link Router}, one file
 * knows the vendor and everything above it does not:
 *
 *   • **On Fly** every client reaches one anycast hostname, so a plain GET measures
 *     the nearest edge and *never* the region behind it. The steer is the documented
 *     `Fly-Prefer-Region` request header, which asks the edge to deliver to an
 *     instance in that region. The match server's `/health` answers with its own
 *     `region`, so the client can **verify** it reached the region it asked for
 *     rather than assume it — an edge that ignores the preference produces a
 *     mismatch, which reads as "not measured", not as a flattering number.
 *   • **Off Fly** — the €4 VPS, a laptop, the Oracle free tier — there is no edge to
 *     steer, and a Machine has its own address. The probe URL is that Machine's own
 *     `/health`, so the region it answers for is the region it is in, by
 *     construction.
 *
 * **A region with no probe target is still a region.** The fleet may hold a Machine
 * this file cannot address (no template, no live view); the region is still listed
 * and still choosable — it simply has no measured ping, and an unmeasured region is
 * never the default (`src/net/region-probe.ts`). Nothing here can refuse or hide a
 * region.
 *
 * Pure and dependency-free: a region and a Machine in, a descriptor or `null` out.
 * No clock, no network — a Router with a different shape.
 */

import type { MachineId } from '../src/net/ticket';

/** The Fly edge's documented request header for "deliver this to that region". */
export const FLY_PREFER_REGION_HEADER = 'fly-prefer-region';

/**
 * Where a client times a region: a URL to GET, and the headers that make the GET
 * land in that region. The response is the match server's `/health` body, whose
 * `region` field the client checks against the region it asked for.
 */
export interface RegionProbe {
  readonly url: string;
  /** Request headers the client must send, when the deployment routes by header. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The seam. One method: turn "the client wants to time this region" into a probe
 * descriptor, or `null` when this deployment cannot address it.
 *
 * `machine` is a *live* Machine in that region when the registry has one — the
 * off-Fly path needs it to build an address, and the Fly path ignores it (the edge
 * picks the instance).
 */
export interface ProbeTargeter {
  probeFor(region: string, machine: MachineId | undefined): RegionProbe | null;
}

/**
 * Fly routing: one shared hostname for the whole gameserver app, steered per
 * region by `Fly-Prefer-Region`. Every region gets the same URL and a different
 * header — which is precisely why the client verifies the answering region rather
 * than trusting the request.
 */
export class FlyPreferRegionTargeter implements ProbeTargeter {
  constructor(private readonly healthUrl: string) {}

  probeFor(region: string, _machine?: MachineId): RegionProbe {
    return { url: this.healthUrl, headers: { [FLY_PREFER_REGION_HEADER]: region } };
  }
}

/**
 * Off-Fly routing: a Machine has its own address, so the probe dials it directly
 * and needs no steer. The resolver is injected — the same address function the
 * {@link DirectRouter} is built with — so this file, like everything above the
 * vendor seam, does not know how a Machine gets an address.
 *
 * With no live Machine in the region there is nothing to dial, and the honest
 * answer is `null`: no target, no measurement, and the region still lists.
 */
export class DirectProbeTargeter implements ProbeTargeter {
  constructor(private readonly resolve: (machine: MachineId) => string) {}

  probeFor(_region: string, machine: MachineId | undefined): RegionProbe | null {
    if (machine === undefined) return null;
    const url = healthUrlFrom(this.resolve(machine));
    return url === null ? null : { url };
  }
}

/**
 * Turn the URL a client would open a *socket* against into the health URL beside
 * it: `ws://m1:8080/` → `http://m1:8080/health`, `wss://host/play` →
 * `https://host/health`. The two are the same process on the same port — the match
 * server serves `/health` over plain HTTP precisely so a check never has to speak
 * WebSocket (`server/index.ts`) — so the socket URL a deployment already configures
 * is also the only address this needs, and there is no second variable to forget.
 *
 * Anything that is not a parseable `ws`/`wss`/`http`/`https` URL yields `null`: a
 * malformed address must produce *no* probe target, never a guess a client would
 * then time and report as a region's latency.
 */
export function healthUrlFrom(socketUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(socketUrl);
  } catch {
    return null;
  }
  const scheme =
    parsed.protocol === 'ws:' || parsed.protocol === 'http:'
      ? 'http:'
      : parsed.protocol === 'wss:' || parsed.protocol === 'https:'
        ? 'https:'
        : null;
  if (scheme === null) return null;
  parsed.protocol = scheme;
  parsed.pathname = '/health';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

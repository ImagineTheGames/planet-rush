/**
 * src/net/region-probe.ts — the fleet's regions, each with a ping this client
 * actually MEASURED. OWNER: Netcode Engineer (GDD §4.2; the developer's ratified
 * region-picker ask, docs/region-picker.md).
 *
 * Auto edge-inference (m10-15a) puts a creator in the right region *by default*
 * and stays: `allocator/edge-region.ts` reads the anycast POP that accepted the
 * request and prefers it. This file is the half that adds **agency** — and the
 * only honest way to offer a choice between regions is to let the player see what
 * each one costs them:
 *
 *   > GRU 38ms · IAD 224ms
 *
 * Those two numbers are round trips this client timed, one per region, against the
 * match server's own `/health`. Not a guess from a geo-IP table, not an inference
 * from the edge, not a constant in a config file — the same discipline the day-0
 * spike set for every number in the netcode (docs/netcode-spike.md): measure it.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES
 * ---------------------------------------------------------------------------
 *  1. **Absent, never zero.** A region that could not be measured carries
 *     `pingMs: null` and prints `—`. The failure this forbids is the flattering
 *     one: `0ms` on an unprobed region reads as the best server in the fleet, and
 *     the lobby's per-seat ping already refuses the same lie (`./ping` rule 1).
 *  2. **An unmeasured region is never the default.** {@link defaultRegionId} ranks
 *     only regions with a number. With *nothing* measured it returns `undefined`,
 *     which sends no `region` at all — and an allocate with no region is exactly
 *     the edge-inferred placement that shipped before this file existed. The
 *     picker degrades to the behaviour it was added on top of, never past it.
 *  3. **An unmeasured region is still choosable.** It has no number, not no
 *     existence: a player who knows they want `gru` may pick it whether or not the
 *     probe got through. Nothing here can drop a region from the list.
 *  4. **The list comes from the fleet.** `GET /regions` is the only source; there
 *     is no hard-coded region anywhere in this module, so a new fleet region
 *     appears in the picker the moment it registers — and the one-region launch
 *     configuration keeps the picker suppressed by count, not by a flag.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING TIMED, AND WHY IT CAN BE TRUSTED
 * ---------------------------------------------------------------------------
 * The allocator publishes, per region, a **probe target** — a URL and the headers
 * that steer the request into that region (`allocator/probe-target.ts`; the vendor
 * lives there, not here). This module fetches that URL and times it. Two rules
 * make the number mean what it says:
 *
 *   • **Verify, don't assume.** The match server's `/health` answers with its own
 *     `region`. Behind an anycast edge, a steer that is ignored would otherwise be
 *     measured as "that region is 12ms away" when what was timed is the nearest
 *     POP. A reply from the wrong region is therefore *not a measurement*
 *     (`wrong-region`), and reads as `—`. A reply that names no region at all is
 *     accepted: off the edge the URL *is* the Machine, so there is nothing to
 *     confuse it with.
 *   • **Min of N, not mean.** The first sample pays TLS and (behind the edge) a
 *     CORS preflight; a mean would report that setup cost as the region's latency
 *     forever. The minimum of a few samples is the closest thing to the wire's
 *     actual round trip, which is the number a player is choosing on.
 *
 * Clock and `fetch` are injected (defaults: `performance.now()` and the platform
 * global), and so is the timeout, so every path here — including a region that
 * never answers — is a fixture in a test with no network and no sleep.
 */

import type { AllocatorClientConfig, FetchLike, FetchResponse } from './allocator-client';

// ---------------------------------------------------------------------------
// What the allocator publishes
// ---------------------------------------------------------------------------

/** Where a client times a region — mirrors `allocator/probe-target.ts` `RegionProbe`
 *  across the wire. The headers are opaque to this module: it sends what it is
 *  given and knows nothing about why. */
export interface RegionProbeTarget {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** One region as `GET /regions` describes it: its live capacity, and how to time
 *  it when this deployment can address it. */
export interface FleetRegion {
  /** The region code — `gru`, `iad`. The id everything else keys on. */
  readonly id: string;
  /** Live Machines in the region. */
  readonly machines: number;
  /** Total room slots across those Machines. */
  readonly capacity: number;
  /** Rooms currently occupying slots. */
  readonly rooms: number;
  /** Slots still free. A region with none will refuse a room and fall back. */
  readonly free: number;
  /** Where to time it, when the allocator published a target. */
  readonly probe?: RegionProbeTarget;
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

/**
 * Why a region has no number. Each is a *different* thing to have gone wrong, and
 * they are kept apart because one of them is a bug in the deployment rather than a
 * bad hop:
 *   • `no-target`    — the allocator published no probe for this region: nothing
 *                      to time. Not the player's connection, and not their fault.
 *   • `timeout`      — the probe was still in flight when the deadline passed.
 *   • `unreachable`  — the request failed outright, or answered non-2xx.
 *   • `wrong-region` — something answered, but not from the region asked for: the
 *                      edge ignored the steer, so what was timed is not this
 *                      region (see the file header).
 */
export type RegionPingFailure = 'no-target' | 'timeout' | 'unreachable' | 'wrong-region';

/** One region's measurement — the number, or exactly why there isn't one. */
export interface RegionPing {
  readonly id: string;
  /** The best round trip measured, ms, or `null` when there is no measurement. */
  readonly pingMs: number | null;
  /** How many samples came back from the right region. */
  readonly samples: number;
  /** Why `pingMs` is null. Absent when it is not. */
  readonly failure?: RegionPingFailure;
  /** The region that actually answered, when it was not the one asked for — the
   *  line that makes an ignored steer diagnosable rather than merely blank. */
  readonly servedBy?: string;
}

/** A region, with its capacity and its measurement in one object — what a picker
 *  row is drawn from. */
export type MeasuredRegion = FleetRegion & RegionPing;

/**
 * Race a promise against a deadline. Injected so a test can force a timeout (or
 * refuse to allow one) without a real timer — this repo budgets every net test
 * that lets time pass and bans the sleep (n4-01).
 */
export type WithTimeout = <T>(work: Promise<T>, ms: number) => Promise<T | TimedOut>;

/** The sentinel {@link WithTimeout} resolves to when the deadline wins. */
export const TIMED_OUT = Symbol('timed-out');
export type TimedOut = typeof TIMED_OUT;

/** How the probe runs. Every seam has a working default, so production passes none. */
export interface RegionProbeOptions {
  /** Injected `fetch`; defaults to the config's, then the platform global. */
  readonly fetch?: FetchLike;
  /** Monotonic clock, ms. Defaults to `performance.now()`, falling back to `Date.now`. */
  readonly now?: () => number;
  /** Samples per region. Min-of-N, so more is steadier and slower. Default 3. */
  readonly samples?: number;
  /** Per-sample deadline, ms. Default {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** The deadline mechanism; defaults to a real (cancelled) timer. */
  readonly withTimeout?: WithTimeout;
}

/** Samples per region, unless a caller says otherwise. Three is enough for the
 *  minimum to shed the first sample's setup cost without making the lobby wait. */
export const DEFAULT_PROBE_SAMPLES = 3;

/**
 * How long one sample may take before it is abandoned, ms. Generous on purpose:
 * this is a *timeout*, not a quality bar, and a genuinely far region — the exact
 * case the picker exists to make visible — must be measured, not written off.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

/**
 * Measure one region. Never throws and never rejects: every way this can fail is
 * a {@link RegionPingFailure} on the returned value, because a region that cannot
 * be timed must still take its place in the list (rule 3).
 */
export async function measureRegionPing(
  region: FleetRegion,
  options: RegionProbeOptions = {},
): Promise<RegionPing> {
  const target = region.probe;
  if (target === undefined || target.url.length === 0) {
    return { id: region.id, pingMs: null, samples: 0, failure: 'no-target' };
  }
  const doFetch = options.fetch ?? defaultFetch();
  const clock = options.now ?? defaultClock();
  const race = options.withTimeout ?? realTimeout;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const count = Math.max(1, options.samples ?? DEFAULT_PROBE_SAMPLES);

  let best: number | null = null;
  let samples = 0;
  // The first failure is the one reported: it is the one that describes the
  // connection at the moment the player looked, and a later different one would
  // only overwrite it with noise.
  let failure: RegionPingFailure | undefined;
  let servedBy: string | undefined;

  for (let i = 0; i < count; i++) {
    const started = clock();
    let outcome: SampleOutcome;
    try {
      // The deadline covers the WHOLE sample — the request and reading the body —
      // because a response whose body never arrives is a hang, and a hang the
      // deadline does not cover is a lobby that never finishes measuring.
      const answered = await race(takeSample(doFetch, target, region.id), timeoutMs);
      outcome = answered === TIMED_OUT ? { ok: false, failure: 'timeout' } : answered;
    } catch {
      // `fetch` itself threw: offline, DNS, TLS, or a CORS grant the region's
      // Machine never gave us. The region is not reachable from here, which is a
      // fact about this client's path to it — exactly what the picker is for.
      outcome = { ok: false, failure: 'unreachable' };
    }
    const elapsed = clock() - started;
    if (outcome.ok) {
      samples++;
      if (best === null || elapsed < best) best = elapsed;
      continue;
    }
    failure ??= outcome.failure;
    if (outcome.servedBy !== undefined) servedBy ??= outcome.servedBy;
  }

  if (best !== null) {
    // A measurement beats any failure that happened alongside it: one lost sample
    // out of three is a lossy hop, not an unmeasurable region.
    return { id: region.id, pingMs: Math.round(best), samples };
  }
  return {
    id: region.id,
    pingMs: null,
    samples,
    failure: failure ?? 'unreachable',
    ...(servedBy !== undefined ? { servedBy } : {}),
  };
}

/** One sample's verdict. */
type SampleOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: RegionPingFailure; readonly servedBy?: string };

/** One whole sample: the request, and the answer read. Throws only where `fetch`
 *  does, which the caller treats as `unreachable`. */
async function takeSample(
  doFetch: FetchLike,
  target: RegionProbeTarget,
  region: string,
): Promise<SampleOutcome> {
  const response = await doFetch(
    target.url,
    target.headers !== undefined ? { headers: target.headers } : {},
  );
  return readSample(response, region);
}

/**
 * Read one probe response: 2xx, and — when it names a region — the region asked
 * for. A body that names none is accepted (off the edge the URL *is* the Machine);
 * a body that names a different one is not a measurement of this region at all.
 * An unreadable body still proves the round trip happened, so it counts.
 */
async function readSample(response: FetchResponse, region: string): Promise<SampleOutcome> {
  if (!response.ok) return { ok: false, failure: 'unreachable' };
  let served: string | undefined;
  try {
    const body = (await response.json()) as { region?: unknown } | null;
    if (typeof body === 'object' && body !== null && typeof body.region === 'string') {
      served = body.region.trim().toLowerCase();
    }
  } catch {
    return { ok: true };
  }
  if (served === undefined || served.length === 0) return { ok: true };
  if (served !== region.trim().toLowerCase()) {
    return { ok: false, failure: 'wrong-region', servedBy: served };
  }
  return { ok: true };
}

/**
 * Measure every region. Regions are probed **concurrently** (different hosts, and
 * a lobby that measured four regions in series would keep the player waiting for
 * the sum of the worst hops); samples within one region stay serial, so a
 * region's own minimum is over independent round trips rather than three requests
 * queued behind each other.
 */
export function measureRegionPings(
  regions: readonly FleetRegion[],
  options: RegionProbeOptions = {},
): Promise<readonly RegionPing[]> {
  return Promise.all(regions.map((region) => measureRegionPing(region, options)));
}

// ---------------------------------------------------------------------------
// The fleet's own list
// ---------------------------------------------------------------------------

/**
 * Read the fleet's regions: `GET /regions`. Tolerant by design — this is a
 * *feature* read, not a connection: an allocator that is down, older than the
 * route, or answering nonsense yields an empty list, the picker stays hidden, and
 * CREATE still allocates exactly as it did before there was a picker. Nothing
 * here can fail a player's attempt to play.
 */
export async function fetchFleetRegions(
  config: AllocatorClientConfig,
): Promise<readonly FleetRegion[]> {
  const doFetch = config.fetch ?? defaultFetch();
  let payload: unknown;
  try {
    const response = await doFetch(`${config.baseUrl}/regions`);
    if (!response.ok) return [];
    payload = await response.json();
  } catch {
    return [];
  }
  if (typeof payload !== 'object' || payload === null) return [];
  const list = (payload as { regions?: unknown }).regions;
  if (!Array.isArray(list)) return [];
  const regions: FleetRegion[] = [];
  for (const entry of list) {
    const region = toFleetRegion(entry);
    if (region !== null) regions.push(region);
  }
  return regions;
}

/** One `/regions` entry, defensively. A region needs a non-empty code and nothing
 *  else — the capacity numbers default to zero rather than dropping the region,
 *  because a region a client cannot count is still a region it can pick. */
function toFleetRegion(entry: unknown): FleetRegion | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  const id = typeof e['region'] === 'string' ? e['region'].trim() : '';
  if (id.length === 0) return null;
  const probe = toProbeTarget(e['probe']);
  return {
    id,
    machines: numberOr(e['machines'], 0),
    capacity: numberOr(e['capacity'], 0),
    rooms: numberOr(e['rooms'], 0),
    free: numberOr(e['free'], 0),
    ...(probe !== null ? { probe } : {}),
  };
}

/** A probe descriptor, or `null` when the allocator sent none (or an unusable
 *  one). Header values that are not strings are dropped rather than coerced: a
 *  header this client cannot state exactly is one it must not send. */
function toProbeTarget(value: unknown): RegionProbeTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['url'] !== 'string' || v['url'].length === 0) return null;
  const raw = v['headers'];
  const headers: Record<string, string> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, header] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof header === 'string') headers[key] = header;
    }
  }
  return {
    url: v['url'],
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// The survey: the list, measured, with a default picked
// ---------------------------------------------------------------------------

/** The fleet as the lobby holds it: every region with its measurement, and the
 *  one selected by default. */
export interface RegionSurvey {
  /** Every region the fleet advertises, **fastest measured first**, unmeasured
   *  ones last (in the order the allocator listed them). The order is the picker's
   *  row order, so the choice a player is being nudged toward is the top one. */
  readonly regions: readonly MeasuredRegion[];
  /** The region CREATE will ask for unless the player overrides it: the lowest
   *  measured ping, or `undefined` when nothing could be measured (rule 2). */
  readonly defaultId?: string;
}

/**
 * The whole read, in one call: list the fleet's regions, time each of them, sort
 * by what was measured, and name the default. This is what a lobby calls when it
 * opens.
 */
export async function surveyRegions(
  config: AllocatorClientConfig,
  options: RegionProbeOptions = {},
): Promise<RegionSurvey> {
  const regions = await fetchFleetRegions(config);
  if (regions.length === 0) return { regions: [] };
  // The probe borrows the allocator client's injected `fetch` unless given its own,
  // so one fixture drives both halves of a survey in a test.
  const shared = options.fetch ?? config.fetch;
  const probe: RegionProbeOptions = { ...options, ...(shared !== undefined ? { fetch: shared } : {}) };
  const pings = await measureRegionPings(regions, probe);
  return summariseRegions(regions, pings);
}

/**
 * Join a region list to its measurements and rank them. Pure — the sort and the
 * default are the two decisions worth testing without a network in the way.
 */
export function summariseRegions(
  regions: readonly FleetRegion[],
  pings: readonly RegionPing[],
): RegionSurvey {
  const byId = new Map(pings.map((p) => [p.id, p]));
  // The fleet's own order, kept as the tie-break: two regions that time identically
  // must not swap places between two reads of the same lobby.
  const listed = new Map(regions.map((region, index) => [region.id, index]));
  const measured: MeasuredRegion[] = regions.map((region) => ({
    ...region,
    ...(byId.get(region.id) ?? {
      id: region.id,
      pingMs: null,
      samples: 0,
      failure: 'no-target' as const,
    }),
  }));
  const ordered = [...measured].sort((a, b) => {
    const tie = (listed.get(a.id) ?? 0) - (listed.get(b.id) ?? 0);
    if (a.pingMs === null && b.pingMs === null) return tie;
    if (a.pingMs === null) return 1; // measured before unmeasured
    if (b.pingMs === null) return -1;
    return a.pingMs === b.pingMs ? tie : a.pingMs - b.pingMs;
  });
  const defaultId = defaultRegionId(ordered);
  return { regions: ordered, ...(defaultId !== undefined ? { defaultId } : {}) };
}

/**
 * The region a lobby selects for the player: the **lowest measured** ping.
 * `undefined` when nothing was measured — the caller then sends no region and the
 * allocator's edge inference decides, which is the pre-picker behaviour (rule 2).
 */
export function defaultRegionId(regions: readonly MeasuredRegion[]): string | undefined {
  let best: MeasuredRegion | undefined;
  for (const region of regions) {
    if (region.pingMs === null) continue;
    if (best === undefined || region.pingMs < (best.pingMs ?? Infinity)) best = region;
  }
  return best?.id;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * Datacentre names for the regions this fleet has actually run in, and the ones
 * the hosting plan names as candidates. A code with no entry falls back to the
 * code itself upper-cased — a new fleet region is legible the day it registers,
 * without a redeploy of the client and without this table being a gate on rule 4.
 */
export const REGION_LABELS: Readonly<Record<string, string>> = {
  gru: 'São Paulo',
  gig: 'Rio de Janeiro',
  iad: 'Virginia',
  ord: 'Chicago',
  sjc: 'San Jose',
  lax: 'Los Angeles',
  mia: 'Miami',
  yyz: 'Toronto',
  lhr: 'London',
  cdg: 'Paris',
  ams: 'Amsterdam',
  fra: 'Frankfurt',
  mad: 'Madrid',
  scl: 'Santiago',
  eze: 'Buenos Aires',
  bog: 'Bogotá',
  syd: 'Sydney',
  nrt: 'Tokyo',
  sin: 'Singapore',
  bom: 'Mumbai',
  jnb: 'Johannesburg',
};

/** A region's place name, or its code when the fleet has moved somewhere this
 *  table has never heard of. */
export function regionLabel(id: string): string {
  return REGION_LABELS[id.toLowerCase()] ?? id.toUpperCase();
}

/** What an unmeasured region prints where its number would be. An em dash, never
 *  a zero (rule 1). */
export const NO_PING = '—';

/**
 * The least a row needs to print itself. Deliberately looser than {@link RegionPing}
 * — a *missing* ping and a `null` one are the same thing to a reader, and the UI's
 * own region model (`src/ui/online-copy` `RegionInfo`) carries it as optional — so
 * the formatters below take either and print the same em dash for both.
 */
export interface RegionPingRow {
  readonly id: string;
  readonly pingMs?: number | null;
}

/** One region as the picker reads it: `GRU 38ms`, or `GRU —` when there is no
 *  measurement. The code, not the place name: it is short, it is what the
 *  allocator's placement line says, and it is what a player reports back. */
export function formatRegionPing(region: RegionPingRow): string {
  const ping = region.pingMs;
  return `${region.id.toUpperCase()} ${ping === null || ping === undefined ? NO_PING : `${Math.round(ping)}ms`}`;
}

/** The whole fleet on one line — `GRU 38ms · IAD 224ms`, in survey order, so the
 *  fastest reads first. `''` for an empty fleet, which draws nothing. */
export function formatRegionPings(regions: readonly RegionPingRow[]): string {
  return regions.map(formatRegionPing).join(' · ');
}

/**
 * The same line with the **selected** region marked: `[GRU 38ms] · IAD 224ms`.
 * The brackets are the whole of the selection state in text — a picker drawn as
 * plates says it with a plate, and this is what the same fact looks like in the
 * one message line the doors screen already has.
 */
export function formatRegionChoices(
  regions: readonly RegionPingRow[],
  selectedId: string | null | undefined,
): string {
  return regions
    .map((region) => {
      const text = formatRegionPing(region);
      return region.id === selectedId ? `[${text}]` : text;
    })
    .join(' · ');
}

/**
 * What a JOIN screen says before the player commits: `ROOM IN GRU · YOUR PING
 * 38ms`, or `ROOM IN GRU · PING —` when this client could not measure that region.
 *
 * The room's region is not the joiner's choice — it is the *host's*, and it is the
 * ping profile of every guest — so the honest place to say it is here, on the
 * screen where the player can still back out, rather than after the socket is open
 * and the match has started. `''` when the allocator did not say where the room is
 * (a room known only through a reservation), because a blank is better than a
 * guess about someone else's connection.
 */
export function formatRoomRegion(region: string, pingMs: number | null | undefined): string {
  const id = region.trim();
  if (id.length === 0) return '';
  const ping = pingMs === null || pingMs === undefined ? `PING ${NO_PING}` : `YOUR PING ${Math.round(pingMs)}ms`;
  return `ROOM IN ${id.toUpperCase()} · ${ping}`;
}

// ---------------------------------------------------------------------------
// Defaults for the seams above
// ---------------------------------------------------------------------------

/** The platform `fetch`, resolved lazily so importing this module needs no global. */
function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new Error('no fetch available; inject RegionProbeOptions.fetch');
  return f;
}

/** A monotonic clock. `performance.now()` where there is one (it cannot be moved
 *  by an NTP step mid-probe); `Date.now` otherwise. */
function defaultClock(): () => number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  const monotonic = perf?.now;
  return typeof monotonic === 'function' ? (): number => monotonic.call(perf) : (): number => Date.now();
}

/** The real deadline: a timer that is always cleared, so a fast answer never
 *  leaves a pending timeout holding the process (or the test) open. */
const realTimeout: WithTimeout = <T>(work: Promise<T>, ms: number): Promise<T | TimedOut> => {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<TimedOut>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
};

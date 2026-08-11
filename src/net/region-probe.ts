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
 *     actual round trip, which is the number a player is choosing on. A warm-up
 *     request per origin pays that setup cost before any clock starts, so even a
 *     region that lands only one sample reports a real round trip.
 *   • **One probe in flight at a time.** Behind an edge every region shares one
 *     origin, so concurrent probes queue against each other on one connection and
 *     the *near* region is charged the *far* region's flight. That inverted the
 *     picker for a player in the United States (a0-29). Regions are sampled
 *     round-robin, serially, under a whole-survey budget — see
 *     {@link measureRegionPings}, which carries the numbers.
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
  /**
   * Wall-clock budget for a WHOLE {@link measureRegionPings} survey, ms. Default
   * {@link DEFAULT_SURVEY_BUDGET_MS}. Ignored by {@link measureRegionPing}, which
   * measures one region and is bounded by {@link timeoutMs} alone.
   */
  readonly budgetMs?: number;
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
 * How long a whole survey may spend sampling, ms — the bound that pays for
 * measuring regions one at a time (see {@link measureRegionPings}).
 *
 * Serial sampling is what makes the numbers mean anything, and it is also what
 * lets one dead region hold up the live ones: the worst case is regions × samples
 * × {@link DEFAULT_PROBE_TIMEOUT_MS}. This caps that at something a lobby can
 * absorb. It is generous against a real fleet — from Florida a two-region survey
 * costs about 1.1 s, and four regions about 2.5 s — so it only ever bites when
 * something is actually wrong, and when it bites the regions already measured keep
 * their numbers.
 */
export const DEFAULT_SURVEY_BUDGET_MS = 8000;

/**
 * Measure one region. Never throws and never rejects: every way this can fail is
 * a {@link RegionPingFailure} on the returned value, because a region that cannot
 * be timed must still take its place in the list (rule 3).
 *
 * One region measured alone has nothing to be compared against, so this path takes
 * no warm-up and no survey budget — {@link measureRegionPings} owns both, because
 * both exist to make regions comparable *with each other*.
 */
export async function measureRegionPing(
  region: FleetRegion,
  options: RegionProbeOptions = {},
): Promise<RegionPing> {
  const state = beginMeasure(region);
  if (isFinished(state)) return state;
  const env = probeEnv(options);
  const count = sampleCount(options);
  for (let i = 0; i < count; i++) await takeOneSample(state, env);
  return finishMeasure(state);
}

// ---------------------------------------------------------------------------
// The measurement's moving parts, shared by the one-region and whole-fleet paths
// ---------------------------------------------------------------------------

/** One region mid-measurement: the best round trip so far, and the first thing
 *  that went wrong. */
interface Measuring {
  readonly id: string;
  readonly target: RegionProbeTarget;
  best: number | null;
  samples: number;
  /** The first failure is the one reported: it is the one that describes the
   *  connection at the moment the player looked, and a later different one would
   *  only overwrite it with noise. */
  failure?: RegionPingFailure;
  servedBy?: string;
}

/** The resolved seams one probe run shares across every sample it takes. */
interface ProbeEnv {
  readonly doFetch: FetchLike;
  readonly clock: () => number;
  readonly race: WithTimeout;
  readonly timeoutMs: number;
}

function probeEnv(options: RegionProbeOptions): ProbeEnv {
  return {
    doFetch: options.fetch ?? defaultFetch(),
    clock: options.now ?? defaultClock(),
    race: options.withTimeout ?? realTimeout,
    timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
  };
}

function sampleCount(options: RegionProbeOptions): number {
  return Math.max(1, options.samples ?? DEFAULT_PROBE_SAMPLES);
}

/** Start measuring a region — or finish immediately, when there is nothing to time. */
function beginMeasure(region: FleetRegion): Measuring | RegionPing {
  const target = region.probe;
  if (target === undefined || target.url.length === 0) {
    return { id: region.id, pingMs: null, samples: 0, failure: 'no-target' };
  }
  return { id: region.id, target, best: null, samples: 0 };
}

function isFinished(state: Measuring | RegionPing): state is RegionPing {
  return 'pingMs' in state;
}

/** One timed round trip, folded into the region's running best. Never throws. */
async function takeOneSample(state: Measuring, env: ProbeEnv): Promise<void> {
  const started = env.clock();
  let outcome: SampleOutcome;
  try {
    // The deadline covers the WHOLE sample — the request and reading the body —
    // because a response whose body never arrives is a hang, and a hang the
    // deadline does not cover is a lobby that never finishes measuring.
    const answered = await env.race(takeSample(env.doFetch, state.target, state.id), env.timeoutMs);
    outcome = answered === TIMED_OUT ? { ok: false, failure: 'timeout' } : answered;
  } catch {
    // `fetch` itself threw: offline, DNS, TLS, or a CORS grant the region's
    // Machine never gave us. The region is not reachable from here, which is a
    // fact about this client's path to it — exactly what the picker is for.
    outcome = { ok: false, failure: 'unreachable' };
  }
  const elapsed = env.clock() - started;
  if (outcome.ok) {
    state.samples++;
    if (state.best === null || elapsed < state.best) state.best = elapsed;
    return;
  }
  state.failure ??= outcome.failure;
  if (outcome.servedBy !== undefined) state.servedBy ??= outcome.servedBy;
}

/** The region's verdict, once no more samples are coming. */
function finishMeasure(state: Measuring): RegionPing {
  if (state.best !== null) {
    // A measurement beats any failure that happened alongside it: one lost sample
    // out of three is a lossy hop, not an unmeasurable region.
    return { id: state.id, pingMs: Math.round(state.best), samples: state.samples };
  }
  return {
    id: state.id,
    pingMs: null,
    samples: state.samples,
    failure: state.failure ?? 'unreachable',
    ...(state.servedBy !== undefined ? { servedBy: state.servedBy } : {}),
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
 * Measure every region — **one probe in flight at a time, ever** (a0-29).
 *
 * ---------------------------------------------------------------------------
 * WHY SERIAL, WHEN CONCURRENT IS SO OBVIOUSLY FASTER
 * ---------------------------------------------------------------------------
 * This function used to fire the regions concurrently, on the reasoning that they
 * are different hosts and a player should not wait for the sum of the worst hops.
 * **On the fleet this game actually runs, they are not different hosts.** Behind an
 * edge every region shares ONE origin and differs only by a steer header
 * (`allocator/probe-target.ts`), so a browser puts every probe on ONE connection to
 * ONE nearby POP — and concurrent probes then queue against each other on it.
 *
 * That does not add noise, it **destroys the ordering**, and asymmetrically: a
 * 75 ms request stuck behind a 180 ms request is measured at ~255 ms, while the
 * 180 ms one is barely touched. The near region is dragged up to the far region's
 * number and the far region keeps its own. Measured from Florida, cold, three
 * rounds each (`spikes/a0-29-region-ping/browser-lab.mjs`):
 *
 *   concurrent   gru 257/255/253   iad 254/259/234   <- ±11 ms apart: a coin flip
 *   serial       gru 187/183/180   iad  76/ 74/ 74   <- 106 ms apart, every time
 *
 * The left column is the bug the developer reported: from the United States the
 * picker ranked São Paulo above Virginia, and their own phone in Florida read
 * `[GRU 218ms] · IAD 229ms` — two regions 5,000 km apart, 11 ms apart on screen.
 *
 * Warming the connection first does **not** fix it (still inverted 2 rounds of 3):
 * the cost being measured is the other region's flight, not the handshake. Only
 * removing the overlap fixes it, so the overlap is what this removes.
 *
 * ---------------------------------------------------------------------------
 * ROUND-ROBIN, NOT REGION-BY-REGION
 * ---------------------------------------------------------------------------
 * One sample of every region, then the next round. Region-by-region would work
 * equally well *here*, but it charges the connection's setup cost to whichever
 * region is listed first, every single time — a systematic thumb on the scale for
 * a list whose order the allocator chooses. Round-robin gives every region the
 * same conditions, and the min-of-N then compares like with like.
 *
 * ---------------------------------------------------------------------------
 * THE BUDGET, WHICH IS THE PRICE OF BEING SERIAL
 * ---------------------------------------------------------------------------
 * Serial sampling is also what lets one dead region delay the live ones — the
 * worst case is regions × samples × the per-sample timeout. So the whole survey
 * carries a wall-clock budget ({@link DEFAULT_SURVEY_BUDGET_MS}); when it is spent
 * no further samples are taken. **Nothing already measured is discarded** — a
 * region with a number keeps it, and a region the budget never reached reads as a
 * `timeout`, which is what it is. The tolerance contract is untouched: this can
 * only ever produce *fewer* numbers, never a wrong one, and never a refusal.
 */
export async function measureRegionPings(
  regions: readonly FleetRegion[],
  options: RegionProbeOptions = {},
): Promise<readonly RegionPing[]> {
  const states = regions.map(beginMeasure);
  const pending = states.filter((s): s is Measuring => !isFinished(s));
  if (pending.length === 0) return states.filter(isFinished);

  const env = probeEnv(options);
  const deadline = env.clock() + Math.max(0, options.budgetMs ?? DEFAULT_SURVEY_BUDGET_MS);
  await warmOrigins(pending, env);

  const rounds = sampleCount(options);
  let outOfTime = false;
  for (let round = 0; round < rounds && !outOfTime; round++) {
    // Each round starts one region further along. In a healthy fleet this changes
    // nothing — every region still gets every sample. It matters only when the
    // budget truncates the survey: without the rotation a region that eats the
    // clock (a dead one, timing out) would always be sampled BEFORE the same
    // neighbours, so the same neighbours would always be the ones cut short. The
    // budget must not develop a favourite; that is the shape of bug this whole
    // change is about.
    for (let i = 0; i < pending.length; i++) {
      if (env.clock() >= deadline) {
        outOfTime = true;
        break;
      }
      await takeOneSample(pending[(round + i) % pending.length]!, env);
    }
  }
  if (outOfTime) {
    // A region the budget never reached has no measurement and nothing to blame it
    // on. `timeout` is the honest word — the probe ran out of time — and it keeps
    // the failure vocabulary the picker and the logs already speak.
    for (const state of pending) if (state.best === null) state.failure ??= 'timeout';
  }
  return states.map((state) => (isFinished(state) ? state : finishMeasure(state)));
}

/**
 * Pay the connection's setup cost **before any clock starts**: one untimed request
 * per distinct probe origin, headers and all, so both the TLS handshake and the
 * CORS preflight (which is keyed on the request-header set, `src/net/cors.ts`) are
 * already banked when the first sample is timed.
 *
 * The min-of-N would shed that cost anyway when every sample lands, but it cannot
 * when only one does: a region that loses two samples to a lossy hop reports its
 * one survivor, and that survivor must not be the handshake. Distinct origins are
 * warmed concurrently — nothing here is timed, so there is nothing for them to
 * corrupt — and every failure is swallowed, because a warm-up that does not
 * arrive is not a fact about anything.
 */
async function warmOrigins(pending: readonly Measuring[], env: ProbeEnv): Promise<void> {
  const first = new Map<string, RegionProbeTarget>();
  for (const state of pending) {
    const origin = originOf(state.target.url);
    if (!first.has(origin)) first.set(origin, state.target);
  }
  await Promise.all([...first.values()].map((target) => warmOne(target, env)));
}

/** One warm-up: the request made and the body drained, so the whole response cycle
 *  is paid for. Not a sample — it is never verified, never timed, and every way it
 *  can fail resolves quietly. */
async function warmOne(target: RegionProbeTarget, env: ProbeEnv): Promise<void> {
  const drain = async (): Promise<void> => {
    const response = await env.doFetch(
      target.url,
      target.headers !== undefined ? { headers: target.headers } : {},
    );
    await response.json().catch(() => undefined);
  };
  try {
    await env.race(drain(), env.timeoutMs);
  } catch {
    // A warm-up that never arrived is not a fact about anything.
  }
}

/** A URL's origin — the unit a browser opens one connection per. An unparseable
 *  URL is its own origin: it will fail to fetch either way, and guessing that two
 *  malformed URLs share a connection would be a guess. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
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

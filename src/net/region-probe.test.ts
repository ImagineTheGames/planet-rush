/**
 * src/net/region-probe.test.ts — the region picker's numbers, and the four ways
 * they are allowed to be missing. OWNER: Netcode Engineer.
 *
 * The brief names four things this must hold, and each has a `describe` here:
 * the measurement's fallback when a region host is unreachable, the default being
 * the lowest MEASURED ping, an unmeasured region never becoming that default, and
 * the fleet's own list being the only source of regions.
 *
 * No network, no clock, no sleep: `fetch`, the monotonic clock and the timeout are
 * all injected, so a 224 ms hop and a host that never answers are both fixtures.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROBE_SAMPLES,
  DEFAULT_SURVEY_BUDGET_MS,
  NO_PING,
  TIMED_OUT,
  defaultRegionId,
  fetchFleetRegions,
  formatRegionChoices,
  formatRegionPing,
  formatRegionPings,
  formatRoomRegion,
  measureRegionPings,
  regionLabel,
  summariseRegions,
  surveyRegions,
} from './region-probe';
import type { FetchLike, FetchResponse } from './allocator-client';
import type {
  FleetRegion,
  MeasuredRegion,
  RegionPing,
  RegionProbeOptions,
  RegionSurvey,
  WithTimeout,
} from './region-probe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A JSON answer. */
function ok(body: unknown): FetchResponse {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A region as `/regions` publishes it, with a probe target unless told otherwise. */
function region(id: string, probe: { url: string; headers?: Record<string, string> } | null = { url: `https://${id}.test/health` }): FleetRegion {
  return {
    id,
    machines: 1,
    capacity: 8,
    rooms: 0,
    free: 8,
    ...(probe !== null ? { probe } : {}),
  };
}

/**
 * A fake wire: a clock the test advances by a per-host latency, and a `fetch` that
 * answers the match server's `/health` body. `latency` is the round trip each host
 * costs; a host absent from the map is unreachable.
 */
function wire(hosts: Readonly<Record<string, { latency: number; region?: string; ok?: boolean }>>): {
  fetch: FetchLike;
  now: () => number;
  calls: { url: string; headers?: Readonly<Record<string, string>> }[];
} {
  let clock = 0;
  const calls: { url: string; headers?: Readonly<Record<string, string>> }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, ...(init?.headers !== undefined ? { headers: init.headers } : {}) });
    const host = hosts[url];
    if (host === undefined) return Promise.reject(new Error('unreachable'));
    // The clock only moves when a request is in flight — so the measured number is
    // exactly the latency this fixture declares.
    clock += host.latency;
    if (host.ok === false) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    return Promise.resolve(ok({ status: 'ok', region: host.region ?? '' }));
  };
  return { fetch, now: () => clock, calls };
}

/** A timeout that never fires — the default for a fixture whose fetches resolve. */
const noTimeout: WithTimeout = (work) => work;

/**
 * One region's measurement, taken through the SURVEY — the only path there is, and
 * the only path production uses. There is deliberately no measure-one-region
 * export: a per-region sample loop is what made a0-29's concurrency natural to
 * write, so scheduling lives with the survey and nowhere else.
 *
 * A survey warms each origin before it times anything, so `calls[0]` here is the
 * warm-up and the timed samples start at `calls[1]`.
 */
async function measureOne(region: FleetRegion, options: RegionProbeOptions = {}): Promise<RegionPing> {
  const pings = await measureRegionPings([region], options);
  return pings[0]!;
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

describe('one region measured — a real round trip, or an honest gap', () => {
  it('reports the best of N round trips, verified against the region that answered', async () => {
    const { fetch, now, calls } = wire({ 'https://gru.test/health': { latency: 38, region: 'gru' } });
    const ping = await measureOne(region('gru'), { fetch, now, withTimeout: noTimeout });

    expect(ping).toMatchObject({ id: 'gru', pingMs: 38, samples: DEFAULT_PROBE_SAMPLES });
    expect(ping.failure).toBeUndefined();
    // One warm-up, then the samples.
    expect(calls).toHaveLength(1 + DEFAULT_PROBE_SAMPLES);
  });

  it('takes the MINIMUM, so the first sample’s handshake is not the region’s latency', async () => {
    let call = 0;
    let clock = 0;
    // 300 ms while the connection is being set up, 40 ms once it is warm — the mean
    // would report 127 ms for a region that is 40 ms away. Two calls pay the 300:
    // the survey's warm-up AND the first timed sample, so the minimum is still the
    // thing under test here rather than something the warm-up quietly absorbed.
    const fetch: FetchLike = () => {
      clock += call++ <= 1 ? 300 : 40;
      return Promise.resolve(ok({ region: 'gru' }));
    };
    const ping = await measureOne(region('gru'), {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
    });
    expect(ping.pingMs).toBe(40);
  });

  it('sends the steer headers the allocator published, verbatim', async () => {
    const { fetch, now, calls } = wire({ 'https://edge.test/health': { latency: 12, region: 'gru' } });
    await measureOne(
      { ...region('gru'), probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': 'gru' } } },
      { fetch, now, samples: 1, withTimeout: noTimeout },
    );
    // Both the warm-up and the timed sample carry it — the warm-up must, or it
    // would not pay the CORS preflight, which is keyed on the request-header set.
    expect(calls[0]?.headers, 'the warm-up is steered too').toEqual({ 'fly-prefer-region': 'gru' });
    expect(calls[1]?.headers, 'and so is the sample').toEqual({ 'fly-prefer-region': 'gru' });
  });

  it('accepts a health body that names no region — off the edge, the URL IS the machine', async () => {
    const { fetch, now } = wire({ 'https://m-1.test/health': { latency: 7 } });
    const ping = await measureOne(
      { ...region('iad'), probe: { url: 'https://m-1.test/health' } },
      { fetch, now, samples: 1, withTimeout: noTimeout },
    );
    expect(ping.pingMs).toBe(7);
  });
});

describe('the fallbacks — a region host that does not answer', () => {
  it('an unreachable host measures nothing, and says so', async () => {
    const { fetch, now } = wire({});
    const ping = await measureOne(region('syd'), { fetch, now, withTimeout: noTimeout });
    expect(ping).toMatchObject({ id: 'syd', pingMs: null, samples: 0, failure: 'unreachable' });
  });

  it('a non-2xx answer is not a measurement', async () => {
    const { fetch, now } = wire({ 'https://iad.test/health': { latency: 5, ok: false } });
    const ping = await measureOne(region('iad'), { fetch, now, withTimeout: noTimeout });
    expect(ping).toMatchObject({ pingMs: null, failure: 'unreachable' });
  });

  it('a probe past its deadline is a timeout, not a slow number', async () => {
    const { fetch, now } = wire({ 'https://syd.test/health': { latency: 9000, region: 'syd' } });
    const always: WithTimeout = () => Promise.resolve(TIMED_OUT);
    const ping = await measureOne(region('syd'), { fetch, now, withTimeout: always });
    expect(ping).toMatchObject({ pingMs: null, failure: 'timeout' });
  });

  it('an edge that ignored the steer is NOT a measurement of the region asked for', async () => {
    // The anycast case the whole verification exists for: the request said gru,
    // the nearest POP answered for iad, and 12 ms is iad's number, not gru's.
    const { fetch, now } = wire({ 'https://edge.test/health': { latency: 12, region: 'iad' } });
    const ping = await measureOne(
      { ...region('gru'), probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': 'gru' } } },
      { fetch, now, withTimeout: noTimeout },
    );
    expect(ping).toMatchObject({ pingMs: null, failure: 'wrong-region', servedBy: 'iad' });
  });

  it('a region the deployment cannot address has no target, and that is not the player’s fault', async () => {
    const { fetch, now } = wire({});
    const ping = await measureOne(region('lhr', null), { fetch, now, withTimeout: noTimeout });
    expect(ping).toMatchObject({ pingMs: null, samples: 0, failure: 'no-target' });
  });

  it('one lost sample out of three is a lossy hop, not an unmeasurable region', async () => {
    let call = 0;
    let clock = 0;
    const fetch: FetchLike = () => {
      // Call 0 is the survey's warm-up; the sample that is lost has to be a timed
      // one, or this would be testing that a warm-up may fail (which it may, and
      // which its own case covers).
      if (call++ === 1) return Promise.reject(new Error('reset'));
      clock += 55;
      return Promise.resolve(ok({ region: 'gru' }));
    };
    const ping = await measureOne(region('gru'), {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
    });
    expect(ping).toMatchObject({ pingMs: 55, samples: 2 });
    expect(ping.failure).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// a0-29 — the survey measures one region at a time
// ---------------------------------------------------------------------------

/**
 * The regression the whole of a0-29 is about. The `wire` fixture's clock advances
 * whenever ANY request is in flight, which is exactly the physics of the real
 * defect: behind an edge every region shares one origin, so two probes overlapping
 * on one connection each pay the other's flight. A concurrent survey therefore
 * inverts here for the same reason it inverted from Florida, and a serial one
 * cannot.
 */
/** A far region and a near one, listed far-first (the order `/regions` uses) —
 *  São Paulo and Virginia as seen from Florida, rounded to what was measured. */
const FAR = 180;
const NEAR = 75;
const fleet = (): FleetRegion[] => [region('gru'), region('iad')];
const hosts = {
  'https://gru.test/health': { latency: FAR, region: 'gru' },
  'https://iad.test/health': { latency: NEAR, region: 'iad' },
};

describe('the survey measures one region at a time — a0-29', () => {
  it('reports each region its OWN round trip, not the sum of the ones beside it', async () => {
    const { fetch, now } = wire(hosts);
    const pings = await measureRegionPings(fleet(), { fetch, now, withTimeout: noTimeout });

    // Concurrently these both read ~255ms — the near region dragged up to the far
    // one — and which of them "wins" is a coin flip. Serially they are themselves.
    expect(pings.map((p) => p.pingMs)).toEqual([FAR, NEAR]);
  });

  it('ranks the NEAR region first, by the real gap — the developer’s acceptance case', async () => {
    const { fetch, now } = wire(hosts);
    const regions = fleet();
    const survey = summariseRegions(regions, await measureRegionPings(regions, { fetch, now, withTimeout: noTimeout }));

    expect(survey.regions.map((r) => r.id)).toEqual(['iad', 'gru']);
    expect(survey.defaultId).toBe('iad');
    // Ordering alone is not enough: overlapping probes collapsed São Paulo and
    // Virginia to within 11 ms of each other on the developer's phone, which is a
    // coin flip that sometimes lands the right way up. The gap has to survive too.
    const [near, far] = survey.regions;
    expect((far?.pingMs ?? 0) - (near?.pingMs ?? 0)).toBe(FAR - NEAR);
  });

  it('never has two probes in flight at once — the whole of the fix', async () => {
    // Both regions behind ONE edge hostname: the live fleet's shape, and the one
    // where overlapping probes share a connection and corrupt each other. With a
    // single origin there is a single warm-up, so every overlap here is a real one.
    let inFlight = 0;
    let peak = 0;
    let clock = 0;
    const fetch: FetchLike = (_url, init) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      clock += 40;
      // Resolve on a later microtask, so a concurrent caller WOULD be seen here.
      return Promise.resolve().then(() => {
        inFlight--;
        const steer = (init?.headers as Record<string, string> | undefined)?.['fly-prefer-region'];
        return ok({ region: steer ?? 'gru' });
      });
    };
    const steered = (id: string): FleetRegion => ({
      ...region(id),
      probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': id } },
    });
    await measureRegionPings([steered('gru'), steered('iad')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
    });
    expect(peak).toBe(1);
  });

  it('warms distinct origins concurrently — a warm-up is untimed, so it corrupts nothing', async () => {
    let inFlight = 0;
    let peak = 0;
    let clock = 0;
    const fetch: FetchLike = () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      clock += 40;
      return Promise.resolve().then(() => {
        inFlight--;
        return ok({ region: 'gru' });
      });
    };
    // Two regions on their own hostnames — the off-Fly deployment's shape.
    await measureRegionPings([region('gru'), region('iad')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
      samples: 1,
    });
    // The two warm-ups overlapped (that is the point of doing them together)…
    expect(peak).toBe(2);
  });

  it('samples ROUND-ROBIN, so the first-listed region is not the only one charged the setup', async () => {
    const { fetch, now, calls } = wire(hosts);
    await measureRegionPings(fleet(), { fetch, now, withTimeout: noTimeout });

    // One warm-up per distinct origin, then the rounds — each starting one region
    // further along, so no region is permanently first.
    const GRU = 'https://gru.test/health';
    const IAD = 'https://iad.test/health';
    expect(calls.slice(2).map((c) => c.url)).toEqual([GRU, IAD, IAD, GRU, GRU, IAD]);
    // Whichever way they interleave, every region is sampled the same number of times.
    for (const url of [GRU, IAD]) {
      expect(calls.slice(2).filter((c) => c.url === url)).toHaveLength(DEFAULT_PROBE_SAMPLES);
    }
  });

  it('the budget never develops a favourite — a dead region does not always cut the same neighbour short', async () => {
    // gru times out on every sample and eats the clock; iad answers instantly.
    // Without the round-robin rotation, iad would be the region always cut short.
    let clock = 0;
    const fetch: FetchLike = (url) => {
      clock += url.includes('gru') ? 3000 : 10;
      return Promise.resolve(ok({ region: url.includes('gru') ? 'gru' : 'iad' }));
    };
    const pings = await measureRegionPings([region('gru'), region('iad')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
      budgetMs: 7000,
    });
    const iad = pings.find((p) => p.id === 'iad')!;
    // iad still got measured, and its number is its own — not gru's 3 seconds.
    expect(iad.pingMs).toBe(10);
    expect(iad.samples).toBeGreaterThan(0);
  });

  it('warms each distinct origin ONCE, with the steer headers, and never counts it as a sample', async () => {
    // Both regions behind one edge hostname — the shape the live fleet actually
    // has, and the reason the warm-up is per ORIGIN rather than per region.
    const { fetch, now, calls } = wire({ 'https://edge.test/health': { latency: 20 } });
    const steered = (id: string): FleetRegion => ({
      ...region(id),
      probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': id } },
    });
    const pings = await measureRegionPings([steered('gru'), steered('iad')], {
      fetch,
      now,
      withTimeout: noTimeout,
    });

    expect(calls).toHaveLength(1 + 2 * DEFAULT_PROBE_SAMPLES);
    // The warm-up carries real headers, so it pays the CORS preflight the timed
    // samples would otherwise pay (the preflight is keyed on the header set).
    // Both the warm-up and the timed sample carry it — the warm-up must, or it
    // would not pay the CORS preflight, which is keyed on the request-header set.
    expect(calls[0]?.headers, 'the warm-up is steered too').toEqual({ 'fly-prefer-region': 'gru' });
    expect(calls[1]?.headers, 'and so is the sample').toEqual({ 'fly-prefer-region': 'gru' });
    for (const ping of pings) expect(ping.samples).toBe(DEFAULT_PROBE_SAMPLES);
  });

  it('a warm-up that fails outright still leaves every region measurable', async () => {
    let first = true;
    let clock = 0;
    const fetch: FetchLike = () => {
      if (first) {
        first = false;
        return Promise.reject(new Error('warm-up refused'));
      }
      clock += 60;
      return Promise.resolve(ok({ region: 'gru' }));
    };
    const pings = await measureRegionPings([region('gru')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
    });
    expect(pings[0]).toMatchObject({ pingMs: 60, samples: DEFAULT_PROBE_SAMPLES });
  });

  it('a region with no probe target costs the survey nothing and still comes back', async () => {
    const { fetch, now, calls } = wire(hosts);
    const pings = await measureRegionPings([region('lhr', null), region('iad')], {
      fetch,
      now,
      withTimeout: noTimeout,
    });
    expect(pings.map((p) => p.id)).toEqual(['lhr', 'iad']);
    expect(pings[0]).toMatchObject({ pingMs: null, samples: 0, failure: 'no-target' });
    expect(pings[1]?.pingMs).toBe(NEAR);
    // Only iad's origin was warmed — a region with nothing to time has no origin.
    expect(calls.filter((c) => c.url === 'https://iad.test/health')).toHaveLength(
      1 + DEFAULT_PROBE_SAMPLES,
    );
  });
});

// ---------------------------------------------------------------------------
// n11-01 — the numbers reach a screen a round at a time
// ---------------------------------------------------------------------------

/**
 * The browse row is drawn beside a listing that lands in ~0.6 s, against a survey
 * that answers in ~1.5 s, so for about a second the row has a region and no ping —
 * the frame `a1-17` photographed as `IAD —`. These cases pin the fix and, more
 * importantly, pin what the fix is NOT allowed to be: not a second probe, not
 * overlapping samples, and not a region reported before its neighbours have had
 * the same number of attempts.
 */
describe('the survey publishes each completed round — n11-01', () => {
  it('hands every region a verdict after the FIRST round, long before the last', async () => {
    const { fetch, now } = wire(hosts);
    const rounds: RegionPing[][] = [];
    const pings = await measureRegionPings(fleet(), {
      fetch,
      now,
      withTimeout: noTimeout,
      onRound: (r) => rounds.push(r.map((p) => ({ ...p }))),
    });

    // Three samples means three rounds; the last one is the return value, so two
    // are published early.
    expect(rounds).toHaveLength(DEFAULT_PROBE_SAMPLES - 1);
    // And the first of them already carries a real number for EVERY region — a row
    // drawn from it prints `VIRGINIA 75ms`, not a dash.
    expect(rounds[0]!.map((p) => [p.id, p.pingMs])).toEqual([
      ['gru', FAR],
      ['iad', NEAR],
    ]);
    expect(rounds[0]!.every((p) => p.samples === 1)).toBe(true);
    expect(pings.map((p) => p.pingMs)).toEqual([FAR, NEAR]);
  });

  it('publishes only WHOLE rounds — every region compared on the same number of attempts', async () => {
    const { fetch, now } = wire(hosts);
    const rounds: RegionPing[][] = [];
    await measureRegionPings(fleet(), {
      fetch,
      now,
      withTimeout: noTimeout,
      onRound: (r) => rounds.push(r.map((p) => ({ ...p }))),
    });
    // Nobody is ever reported one sample ahead of the region it will be ranked
    // against: that is a0-29's unfairness in a different costume.
    for (const round of rounds) {
      expect(new Set(round.map((p) => p.samples)).size).toBe(1);
    }
  });

  it('a published number can only ever FALL — min-of-N settling, never a rise', async () => {
    // The first sample of each region is the slow one (the fixture's setup cost);
    // later ones are quicker, so the survey's own minimum walks downwards.
    let clock = 0;
    const seen = new Map<string, number>();
    const fetch: FetchLike = (url) => {
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      clock += n === 1 ? 200 : n === 2 ? 120 : 90;
      return Promise.resolve(ok({ region: url.includes('gru') ? 'gru' : 'iad' }));
    };
    const published: number[] = [];
    const final = await measureRegionPings([region('gru')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
      onRound: (r) => published.push(r[0]!.pingMs!),
    });
    // Sample 1 is the warm-up's successor: 120, then 90. Whatever the fixture's
    // numbers, each publication is <= the one before it and the return value is
    // the smallest of all.
    expect(published).toEqual([...published].sort((a, b) => b - a));
    expect(final[0]!.pingMs).toBeLessThanOrEqual(published.at(-1)!);
  });

  it('a failure published early is replaced by a number when a later round lands one', async () => {
    let call = 0;
    let clock = 0;
    const fetch: FetchLike = () => {
      // 0 is the warm-up; 1 is the first timed sample and it fails outright.
      if (call++ === 1) return Promise.reject(new Error('reset'));
      clock += 60;
      return Promise.resolve(ok({ region: 'gru' }));
    };
    const published: RegionPing[] = [];
    const final = await measureRegionPings([region('gru')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
      onRound: (r) => published.push({ ...r[0]! }),
    });
    expect(published[0]).toMatchObject({ pingMs: null, failure: 'unreachable', samples: 0 });
    expect(published[1]).toMatchObject({ pingMs: 60 });
    expect(final[0]).toMatchObject({ pingMs: 60, samples: 2 });
    // Absent, never zero — not even for the round that had nothing yet (rule 1).
    expect(published[0]!.pingMs).not.toBe(0);
  });

  it('publishes nothing from a round the budget cut short', async () => {
    // One edge origin, two steers — the live fleet's shape — with gru eating the
    // clock. The arithmetic: warm-up 3000, round 1 costs 3000 + 10 (ends at 6010),
    // round 2 starts with iad (the rotation) and ends at 6020, and the budget
    // expires before its second sample. So round 1 is whole and round 2 is not.
    let clock = 0;
    const steerOf = (init?: { headers?: Readonly<Record<string, string>> }): string =>
      init?.headers?.['fly-prefer-region'] ?? 'gru';
    const fetch: FetchLike = (_url, init) => {
      const steer = steerOf(init);
      clock += steer === 'gru' ? 3000 : 10;
      return Promise.resolve(ok({ region: steer }));
    };
    const steered = (id: string): FleetRegion => ({
      ...region(id),
      probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': id } },
    });
    const rounds: RegionPing[][] = [];
    await measureRegionPings([steered('gru'), steered('iad')], {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
      budgetMs: 6015,
      onRound: (r) => rounds.push(r.map((p) => ({ ...p }))),
    });
    // Round 1 completed and was published; the truncated round was not — nobody is
    // ranked on one more attempt than their neighbour.
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.every((p) => p.samples === 1)).toBe(true);
  });

  it('changes NOTHING about the schedule — same requests, same order, still one in flight', async () => {
    const withCb = wire(hosts);
    const without = wire(hosts);
    await measureRegionPings(fleet(), { fetch: withCb.fetch, now: withCb.now, withTimeout: noTimeout, onRound: () => {} });
    await measureRegionPings(fleet(), { fetch: without.fetch, now: without.now, withTimeout: noTimeout });
    expect(withCb.calls.map((c) => c.url)).toEqual(without.calls.map((c) => c.url));
  });

  it('a callback that throws costs the survey nothing', async () => {
    const { fetch, now } = wire(hosts);
    const pings = await measureRegionPings(fleet(), {
      fetch,
      now,
      withTimeout: noTimeout,
      onRound: () => {
        throw new Error('the screen blew up mid-redraw');
      },
    });
    expect(pings.map((p) => p.pingMs)).toEqual([FAR, NEAR]);
  });

  it('surveyRegions hands back a RANKED survey per round, default and all', async () => {
    const { fetch, now } = wire({
      ...hosts,
      'https://alloc.test/regions': { latency: 0, region: '' },
    });
    const list = {
      regions: [
        { region: 'gru', machines: 1, capacity: 8, rooms: 0, free: 8, probe: { url: 'https://gru.test/health' } },
        { region: 'iad', machines: 1, capacity: 8, rooms: 0, free: 8, probe: { url: 'https://iad.test/health' } },
      ],
    };
    const fetchWithList: FetchLike = (url, init) =>
      url.endsWith('/regions') ? Promise.resolve(ok(list)) : fetch(url, init);

    const surveys: RegionSurvey[] = [];
    const final = await surveyRegions(
      { baseUrl: 'https://alloc.test', fetch: fetchWithList },
      { now, withTimeout: noTimeout, onSurvey: (s) => surveys.push(s) },
    );

    expect(surveys).toHaveLength(DEFAULT_PROBE_SAMPLES - 1);
    // The early survey is the same answer the late one is: near region first, and
    // a default that is a MEASURED region.
    expect(surveys[0]!.regions.map((r) => r.id)).toEqual(['iad', 'gru']);
    expect(surveys[0]!.defaultId).toBe('iad');
    expect(surveys[0]!.regions[0]).toMatchObject({ pingMs: NEAR, free: 8 });
    expect(final.regions.map((r) => r.id)).toEqual(['iad', 'gru']);
  });

  it('never publishes a survey for a fleet with no regions — an empty read is not news', async () => {
    const doFetch: FetchLike = () => Promise.resolve(ok({ regions: [] }));
    let called = 0;
    const survey = await surveyRegions(
      { baseUrl: 'https://alloc.test', fetch: doFetch },
      { onSurvey: () => called++ },
    );
    expect(survey.regions).toEqual([]);
    expect(called).toBe(0);
  });
});

describe('the survey budget — the price of being serial, and its limits', () => {
  it('stops sampling when the budget is spent, and KEEPS what it already measured', async () => {
    const { fetch, now } = wire({
      'https://gru.test/health': { latency: 100, region: 'gru' },
      'https://iad.test/health': { latency: 100, region: 'iad' },
    });
    // Warm-ups (2 origins, concurrent → 200ms of clock) plus one round of two
    // 100ms samples lands at 400ms; the budget stops the second round.
    const pings = await measureRegionPings([region('gru'), region('iad')], {
      fetch,
      now,
      withTimeout: noTimeout,
      budgetMs: 400,
    });
    for (const ping of pings) {
      expect(ping.pingMs).toBe(100);
      expect(ping.samples).toBe(1);
      expect(ping.failure).toBeUndefined();
    }
  });

  it('a region the budget never reached reads as a timeout — absent, never zero', async () => {
    const { fetch, now } = wire({
      'https://gru.test/health': { latency: 500, region: 'gru' },
      'https://iad.test/health': { latency: 500, region: 'iad' },
    });
    const pings = await measureRegionPings([region('gru'), region('iad')], {
      fetch,
      now,
      withTimeout: noTimeout,
      budgetMs: 1,
    });
    for (const ping of pings) {
      expect(ping.pingMs).toBeNull();
      expect(ping.failure).toBe('timeout');
    }
    // The rule the budget must never break: no number is better than a wrong one,
    // and an unmeasured region is never the default.
    expect(defaultRegionId(summariseRegions([region('gru'), region('iad')], pings).regions)).toBeUndefined();
  });

  it('does not bite a healthy fleet — a full survey finishes well inside the default', async () => {
    const { fetch, now } = wire(hosts);
    const pings = await measureRegionPings(fleet(), { fetch, now, withTimeout: noTimeout });
    // 2 warm-ups + 3 rounds of (180 + 75) = 255 + 765 = 1020ms, against 8000ms.
    expect(now()).toBeLessThan(DEFAULT_SURVEY_BUDGET_MS);
    for (const ping of pings) expect(ping.samples).toBe(DEFAULT_PROBE_SAMPLES);
  });
});

// ---------------------------------------------------------------------------
// The default, and the ranking
// ---------------------------------------------------------------------------

/** A measured region, for the pure ranking tests. */
function measured(id: string, pingMs: number | null): MeasuredRegion {
  return { ...region(id), id, pingMs, samples: pingMs === null ? 0 : 3 };
}

describe('the default is the LOWEST MEASURED ping', () => {
  it('picks the fastest region', () => {
    expect(defaultRegionId([measured('iad', 224), measured('gru', 38), measured('lhr', 190)])).toBe('gru');
  });

  it('never defaults to a region it could not measure', () => {
    expect(defaultRegionId([measured('gru', null), measured('iad', 224)])).toBe('iad');
  });

  it('with NOTHING measured names no region at all — the allocate then carries none, and the edge infers', () => {
    expect(defaultRegionId([measured('gru', null), measured('iad', null)])).toBeUndefined();
  });

  it('ranks measured regions first, and holds the fleet’s order for a tie', () => {
    const survey = summariseRegions(
      [region('iad'), region('gru'), region('lhr'), region('syd')],
      [
        { id: 'iad', pingMs: 224, samples: 3 },
        { id: 'gru', pingMs: 38, samples: 3 },
        { id: 'lhr', pingMs: null, samples: 0, failure: 'unreachable' },
        { id: 'syd', pingMs: 224, samples: 3 },
      ],
    );
    expect(survey.regions.map((r) => r.id)).toEqual(['gru', 'iad', 'syd', 'lhr']);
    expect(survey.defaultId).toBe('gru');
  });

  it('carries each region’s capacity through the join, so a full region still reads full', () => {
    const survey = summariseRegions(
      [{ ...region('gru'), free: 0, rooms: 8 }],
      [{ id: 'gru', pingMs: 38, samples: 3 }],
    );
    expect(survey.regions[0]).toMatchObject({ id: 'gru', free: 0, rooms: 8, pingMs: 38 });
  });
});

// ---------------------------------------------------------------------------
// The list comes from the fleet
// ---------------------------------------------------------------------------

describe('fetchFleetRegions — the allocator is the only source', () => {
  it('reads the fleet’s regions and their probe targets', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve(
        ok({
          regions: [
            { region: 'gru', machines: 1, capacity: 8, rooms: 2, free: 6, probe: { url: 'https://e.test/health', headers: { 'fly-prefer-region': 'gru' } } },
            { region: 'iad', machines: 2, capacity: 16, rooms: 0, free: 16 },
          ],
        }),
      );
    const regions = await fetchFleetRegions({ baseUrl: 'https://alloc.test', fetch });
    expect(regions.map((r) => r.id)).toEqual(['gru', 'iad']);
    expect(regions[0]?.probe).toEqual({ url: 'https://e.test/health', headers: { 'fly-prefer-region': 'gru' } });
    // No target published for iad — it lists anyway (it is choosable), unmeasured.
    expect(regions[1]?.probe).toBeUndefined();
    expect(regions[1]).toMatchObject({ machines: 2, capacity: 16, free: 16 });
  });

  it('an allocator that is down, old, or answering nonsense yields no regions and no error', async () => {
    const cases: FetchLike[] = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
      () => Promise.resolve(ok({ regions: 'soon' })),
      () => Promise.resolve(ok({})),
      () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('not json')) }),
    ];
    for (const fetch of cases) {
      await expect(fetchFleetRegions({ baseUrl: 'https://alloc.test', fetch })).resolves.toEqual([]);
    }
  });

  it('drops an entry with no region code, and a probe with no URL', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve(ok({ regions: [{ machines: 1 }, { region: '  ' }, { region: 'gru', probe: { headers: {} } }] }));
    const regions = await fetchFleetRegions({ baseUrl: 'https://alloc.test', fetch });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.id).toBe('gru');
    expect(regions[0]?.probe).toBeUndefined();
  });
});

describe('surveyRegions — list, measure, rank, in one read', () => {
  it('measures every advertised region and ranks them by what it measured', async () => {
    const hosts = {
      'https://gru.test/health': { latency: 38, region: 'gru' },
      'https://iad.test/health': { latency: 224, region: 'iad' },
    };
    const { fetch: probe, now } = wire(hosts);
    const fetch: FetchLike = (url, init) =>
      url.endsWith('/regions')
        ? Promise.resolve(
            ok({
              regions: [
                { region: 'iad', probe: { url: 'https://iad.test/health' } },
                { region: 'gru', probe: { url: 'https://gru.test/health' } },
              ],
            }),
          )
        : probe(url, init);

    const survey = await surveyRegions({ baseUrl: 'https://alloc.test', fetch }, { now, withTimeout: noTimeout });
    // Ranked by measurement, not by the order the allocator listed them (iad first).
    expect(survey.regions.map((r) => r.id)).toEqual(['gru', 'iad']);
    expect(survey.defaultId).toBe('gru');
    // Both numbers are exact. They could not be until a0-29: the regions were
    // probed CONCURRENTLY and this fixture shares one virtual clock between them,
    // so iad's elapsed used to carry gru's flight too — and this assertion had been
    // weakened to `>= 224` to let that pass. That weakening was the bug, visible in
    // the test suite, a release before a US player was steered to São Paulo.
    expect(survey.regions[0]?.pingMs).toBe(38);
    expect(survey.regions[1]?.pingMs).toBe(224);
  });

  it('an allocator with no /regions route leaves an empty survey and no default', async () => {
    const fetch: FetchLike = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const survey = await surveyRegions({ baseUrl: 'https://alloc.test', fetch });
    expect(survey).toEqual({ regions: [] });
  });
});

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

describe('the line the lobby prints', () => {
  it('reads GRU 38ms · IAD 224ms', () => {
    const pings: RegionPing[] = [
      { id: 'gru', pingMs: 38, samples: 3 },
      { id: 'iad', pingMs: 224, samples: 3 },
    ];
    expect(formatRegionPings(pings)).toBe('GRU 38ms · IAD 224ms');
  });

  it('prints an em dash for an unmeasured region — never a flattering zero', () => {
    expect(formatRegionPing({ id: 'syd', pingMs: null })).toBe(`SYD ${NO_PING}`);
    expect(formatRegionPing({ id: 'syd', pingMs: null })).not.toContain('0');
  });

  it('names a datacentre it knows, and falls back to the code for one it does not', () => {
    expect(regionLabel('gru')).toBe('São Paulo');
    expect(regionLabel('xyz')).toBe('XYZ');
  });

  it('brackets the selected region, so the line carries the choice as well as the numbers', () => {
    const pings = [
      { id: 'gru', pingMs: 38 },
      { id: 'iad', pingMs: 224 },
    ];
    expect(formatRegionChoices(pings, 'iad')).toBe('GRU 38ms · [IAD 224ms]');
    // Nothing chosen yet (nothing measured) — the line still reads, unmarked.
    expect(formatRegionChoices(pings, null)).toBe('GRU 38ms · IAD 224ms');
  });

  it('tells a joiner where the room is and what it costs THEM, before they commit', () => {
    expect(formatRoomRegion('gru', 38)).toBe('ROOM IN GRU · YOUR PING 38ms');
    expect(formatRoomRegion('gru', null)).toBe(`ROOM IN GRU · PING ${NO_PING}`);
    // A room the allocator located only through a reservation has no region yet —
    // and a blank beats a guess about someone else's connection.
    expect(formatRoomRegion('', 38)).toBe('');
  });
});

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
  NO_PING,
  TIMED_OUT,
  defaultRegionId,
  fetchFleetRegions,
  formatRegionChoices,
  formatRegionPing,
  formatRegionPings,
  formatRoomRegion,
  measureRegionPing,
  regionLabel,
  summariseRegions,
  surveyRegions,
} from './region-probe';
import type { FetchLike, FetchResponse } from './allocator-client';
import type { FleetRegion, MeasuredRegion, RegionPing, WithTimeout } from './region-probe';

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

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

describe('measureRegionPing — a real round trip, or an honest gap', () => {
  it('reports the best of N round trips, verified against the region that answered', async () => {
    const { fetch, now, calls } = wire({ 'https://gru.test/health': { latency: 38, region: 'gru' } });
    const ping = await measureRegionPing(region('gru'), { fetch, now, withTimeout: noTimeout });

    expect(ping).toMatchObject({ id: 'gru', pingMs: 38, samples: DEFAULT_PROBE_SAMPLES });
    expect(ping.failure).toBeUndefined();
    expect(calls).toHaveLength(DEFAULT_PROBE_SAMPLES);
  });

  it('takes the MINIMUM, so the first sample’s handshake is not the region’s latency', async () => {
    let call = 0;
    let clock = 0;
    // 300 ms to set up the connection, 40 ms once it is warm — the mean would
    // report 127 ms for a region that is 40 ms away.
    const fetch: FetchLike = () => {
      clock += call++ === 0 ? 300 : 40;
      return Promise.resolve(ok({ region: 'gru' }));
    };
    const ping = await measureRegionPing(region('gru'), {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
    });
    expect(ping.pingMs).toBe(40);
  });

  it('sends the steer headers the allocator published, verbatim', async () => {
    const { fetch, now, calls } = wire({ 'https://edge.test/health': { latency: 12, region: 'gru' } });
    await measureRegionPing(
      { ...region('gru'), probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': 'gru' } } },
      { fetch, now, samples: 1, withTimeout: noTimeout },
    );
    expect(calls[0]?.headers).toEqual({ 'fly-prefer-region': 'gru' });
  });

  it('accepts a health body that names no region — off the edge, the URL IS the machine', async () => {
    const { fetch, now } = wire({ 'https://m-1.test/health': { latency: 7 } });
    const ping = await measureRegionPing(
      { ...region('iad'), probe: { url: 'https://m-1.test/health' } },
      { fetch, now, samples: 1, withTimeout: noTimeout },
    );
    expect(ping.pingMs).toBe(7);
  });
});

describe('the fallbacks — a region host that does not answer', () => {
  it('an unreachable host measures nothing, and says so', async () => {
    const { fetch, now } = wire({});
    const ping = await measureRegionPing(region('syd'), { fetch, now, withTimeout: noTimeout });
    expect(ping).toMatchObject({ id: 'syd', pingMs: null, samples: 0, failure: 'unreachable' });
  });

  it('a non-2xx answer is not a measurement', async () => {
    const { fetch, now } = wire({ 'https://iad.test/health': { latency: 5, ok: false } });
    const ping = await measureRegionPing(region('iad'), { fetch, now, withTimeout: noTimeout });
    expect(ping).toMatchObject({ pingMs: null, failure: 'unreachable' });
  });

  it('a probe past its deadline is a timeout, not a slow number', async () => {
    const { fetch, now } = wire({ 'https://syd.test/health': { latency: 9000, region: 'syd' } });
    const always: WithTimeout = () => Promise.resolve(TIMED_OUT);
    const ping = await measureRegionPing(region('syd'), { fetch, now, withTimeout: always });
    expect(ping).toMatchObject({ pingMs: null, failure: 'timeout' });
  });

  it('an edge that ignored the steer is NOT a measurement of the region asked for', async () => {
    // The anycast case the whole verification exists for: the request said gru,
    // the nearest POP answered for iad, and 12 ms is iad's number, not gru's.
    const { fetch, now } = wire({ 'https://edge.test/health': { latency: 12, region: 'iad' } });
    const ping = await measureRegionPing(
      { ...region('gru'), probe: { url: 'https://edge.test/health', headers: { 'fly-prefer-region': 'gru' } } },
      { fetch, now, withTimeout: noTimeout },
    );
    expect(ping).toMatchObject({ pingMs: null, failure: 'wrong-region', servedBy: 'iad' });
  });

  it('a region the deployment cannot address has no target, and that is not the player’s fault', async () => {
    const { fetch, now } = wire({});
    const ping = await measureRegionPing(region('lhr', null), { fetch, now, withTimeout: noTimeout });
    expect(ping).toMatchObject({ pingMs: null, samples: 0, failure: 'no-target' });
  });

  it('one lost sample out of three is a lossy hop, not an unmeasurable region', async () => {
    let call = 0;
    let clock = 0;
    const fetch: FetchLike = () => {
      if (call++ === 0) return Promise.reject(new Error('reset'));
      clock += 55;
      return Promise.resolve(ok({ region: 'gru' }));
    };
    const ping = await measureRegionPing(region('gru'), {
      fetch,
      now: () => clock,
      withTimeout: noTimeout,
    });
    expect(ping).toMatchObject({ pingMs: 55, samples: 2 });
    expect(ping.failure).toBeUndefined();
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
    // The regions are probed CONCURRENTLY and this fixture shares one virtual
    // clock between them, so iad's elapsed carries gru's flight too. The exact
    // per-region number is asserted in the sequential cases above; what this one
    // has to hold is that both were measured and the far one measured as far.
    expect(survey.regions[0]?.pingMs).toBe(38);
    expect(survey.regions[1]?.pingMs).toBeGreaterThanOrEqual(224);
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

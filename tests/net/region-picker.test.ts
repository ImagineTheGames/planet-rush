/**
 * tests/net/region-picker.test.ts — the region picker over a real fleet's HTTP.
 * OWNER: Netcode Engineer (GDD §4.2; the ratified region-picker ask,
 * docs/region-picker.md).
 *
 * `src/net/region-probe.test.ts` proves the measurement's rules against fixtures.
 * This is the wiring underneath them, exercised as the browser exercises it and
 * with nothing between the pieces mocked: a real `node:http` allocator
 * (`createAllocatorServer`) with a real {@link DirectProbeTargeter}, two real
 * match-server-shaped `/health` listeners standing in for two datacentres, and a
 * real `fetch` from a client that has **no region hard-coded anywhere** — it
 * learns the fleet's regions from `GET /regions` and times them itself.
 *
 * The three things that can only be proven here:
 *
 *   1. the probe target the allocator publishes actually reaches that region's
 *      Machine, and the Machine's own `/health` names the region back;
 *   2. a region whose host is **down** falls back to no measurement, while the
 *      rest of the fleet still measures — the failure is per-region, never fleet-wide;
 *   3. the player's **override** rides the allocate body and beats the fleet's
 *      own preference, end to end, all the way to `placement.region`.
 *
 * No artificial latency and no sleep: the numbers here are whatever localhost
 * costs. Which region is *fastest* is a fixture question and is settled in the
 * unit tests, where the clock is injected.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mulberry32 } from '@shared/types';
import { Allocator } from '../../allocator/allocator';
import { InMemoryRoomRegistry } from '../../allocator/registry';
import { DirectRouter } from '../../allocator/router';
import { DirectProbeTargeter } from '../../allocator/probe-target';
import { createAllocatorServer } from '../../allocator/index';
import { allocateRoom } from '../../src/net/allocator-client';
import {
  defaultRegionId,
  fetchFleetRegions,
  measureRegionPing,
  summariseRegions,
  surveyRegions,
} from '../../src/net/region-probe';
import { netBudget } from './budgets';

const SECRET = 'allocator-and-machine-share-this';

/** One datacentre, as far as the picker is concerned: a Machine that answers
 *  `/health` with its own region — the same body `server/index.ts` writes. */
async function machine(region: string): Promise<{ server: Server; host: string }> {
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', machine: `m-${region}`, region, rooms: 0, capacity: 8 }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, host: `127.0.0.1:${port}` };
}

/** A fleet: an allocator whose registry holds one Machine per region, each with a
 *  live `/health` behind it and each addressed by the same template the direct
 *  deployment configures (`MATCH_URL_TEMPLATE`). */
async function fleet(regions: readonly string[]): Promise<{
  base: string;
  hosts: Map<string, string>;
  servers: Server[];
  now: { value: number };
}> {
  const now = { value: 1_000_000 };
  const registry = new InMemoryRoomRegistry();
  const hosts = new Map<string, string>();
  const servers: Server[] = [];
  for (const region of regions) {
    const m = await machine(region);
    hosts.set(`m-${region}`, m.host);
    servers.push(m.server);
    registry.observe({ machine: `m-${region}`, region, capacity: 8, rooms: [] }, now.value);
  }
  // One address function, used for BOTH the socket URL and the probe target —
  // which is the property the deployment relies on: configure one template, and
  // the dial and the ping cannot point at different fleets.
  const address = (id: string): string => `ws://${hosts.get(id) ?? 'unrouted.invalid'}/`;
  const server = createAllocatorServer({
    allocator: new Allocator({ registry, rng: mulberry32(7), secret: SECRET }),
    registry,
    router: new DirectRouter(address),
    probeTargeter: new DirectProbeTargeter(address),
    now: () => now.value,
    secret: SECRET,
    log: () => {},
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  servers.push(server);
  return { base: `http://127.0.0.1:${port}`, hosts, servers, now };
}

let open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.map((s) => new Promise<void>((r) => (s.listening ? s.close(() => r()) : r()))));
  open = [];
});

async function fixture(regions: readonly string[]): ReturnType<typeof fleet> {
  const f = await fleet(regions);
  open = f.servers;
  return f;
}

const WORK = { measuredSeconds: 0.3 };

describe('the picker reads the fleet, and times what it reads', () => {
  it(
    'lists every region the fleet registered — no region is named in the client',
    async () => {
      const { base } = await fixture(['gru', 'iad', 'lhr']);
      const regions = await fetchFleetRegions({ baseUrl: base });

      expect(regions.map((r) => r.id).sort()).toEqual(['gru', 'iad', 'lhr']);
      // Each carries where to time it, pointing at that region's own Machine.
      for (const region of regions) {
        expect(region.probe?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/health$/);
      }
    },
    netBudget({ work: 'stand up a 3-region fleet and read GET /regions', ...WORK }),
  );

  it(
    'measures a real round trip to each region, and the region answers for itself',
    async () => {
      const { base } = await fixture(['gru', 'iad']);
      const regions = await fetchFleetRegions({ baseUrl: base });
      // Sequentially, so each number is that region's own round trip and nothing else.
      const pings = [];
      for (const region of regions) pings.push(await measureRegionPing(region));

      for (const ping of pings) {
        expect(ping.failure, `${ping.id} failed: ${ping.failure ?? ''}`).toBeUndefined();
        expect(ping.pingMs).toBeGreaterThanOrEqual(0);
        expect(ping.samples).toBeGreaterThan(0);
      }
      // Every region measured ⇒ the default is one of them, and it is the lowest.
      const survey = summariseRegions(regions, pings);
      const lowest = Math.min(...pings.map((p) => p.pingMs ?? Infinity));
      expect(survey.defaultId).toBe(pings.find((p) => p.pingMs === lowest)?.id);
    },
    netBudget({ work: 'probe two live /health endpoints, min-of-3 each', ...WORK }),
  );

  it(
    'a region whose Machine is DOWN measures nothing, and the rest of the fleet still does',
    async () => {
      const { base, servers } = await fixture(['gru', 'iad']);
      const regions = await fetchFleetRegions({ baseUrl: base });
      // Kill the Machine behind the first region — the fleet still advertises it
      // (the registry's view has not expired), so this is exactly the case the
      // picker has to survive: an advertised region that does not answer.
      const dead = regions[0]!;
      await new Promise<void>((r) => servers[0]!.close(() => r()));

      const pings = [];
      for (const region of regions) pings.push(await measureRegionPing(region, { samples: 1 }));
      const survey = summariseRegions(regions, pings);

      const down = survey.regions.find((r) => r.id === dead.id)!;
      expect(down.pingMs).toBeNull();
      expect(down.failure).toBe('unreachable');
      // Still listed, and still choosable — it simply has no number.
      expect(survey.regions.map((r) => r.id)).toContain(dead.id);
      // …and never the default, which goes to the region that did answer.
      expect(survey.defaultId).not.toBe(dead.id);
      expect(survey.defaultId).toBe(regions[1]!.id);
    },
    netBudget({ work: 'probe a 2-region fleet with one Machine killed', ...WORK }),
  );

  it(
    'with the whole fleet unreachable it names NO region — the allocate then carries none',
    async () => {
      const { base, servers } = await fixture(['gru', 'iad']);
      const regions = await fetchFleetRegions({ baseUrl: base });
      await Promise.all(
        servers.slice(0, 2).map((s) => new Promise<void>((r) => s.close(() => r()))),
      );

      const pings = [];
      for (const region of regions) pings.push(await measureRegionPing(region, { samples: 1 }));
      expect(defaultRegionId(summariseRegions(regions, pings).regions)).toBeUndefined();

      // And that is not a dead end: an allocate with no region still places a room
      // — the edge-inferred placement that shipped before the picker existed.
      const result = await allocateRoom({ baseUrl: base }, {});
      expect(result.ok).toBe(true);
    },
    netBudget({ work: 'kill both Machines, survey, then allocate with no preference', ...WORK }),
  );
});

describe('the override is honoured end to end', () => {
  it(
    'a region the player picked beats the one the survey would have defaulted to',
    async () => {
      const { base } = await fixture(['gru', 'iad']);
      const survey = await surveyRegions({ baseUrl: base });
      expect(survey.regions).toHaveLength(2);

      // Whatever localhost made fastest, the player picks the OTHER one — which is
      // the whole point of the picker: agency over the automatic answer.
      const override = survey.regions.find((r) => r.id !== survey.defaultId)!;
      const result = await allocateRoom({ baseUrl: base }, { region: override.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.connection.region).toBe(override.id);
      expect(result.connection.placement).toMatchObject({
        requested: override.id,
        region: override.id,
        reason: 'preferred',
      });
    },
    netBudget({ work: 'survey a 2-region fleet, then allocate against the survey’s default', ...WORK }),
  );

  it(
    'an override the fleet cannot honour falls back rather than refusing the match',
    async () => {
      const { base } = await fixture(['gru']);
      const result = await allocateRoom({ baseUrl: base }, { region: 'syd' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The room is placed anyway — in the region the fleet has — and the reason
      // says why, which is the line a "why am I on that server?" report carries.
      expect(result.connection.region).toBe('gru');
      expect(result.connection.placement?.requested).toBe('syd');
      expect(result.connection.placement?.reason).toBe('region-absent');
    },
    netBudget({ work: 'allocate into a one-region fleet with an impossible preference', ...WORK }),
  );
});

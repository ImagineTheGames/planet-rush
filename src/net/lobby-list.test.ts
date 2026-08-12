/**
 * src/net/lobby-list.test.ts — the browse screen's two calls, and the failures
 * they are *not* allowed to turn into decisions. OWNER: Netcode Engineer (a0-26;
 * `docs/lobby-browser-plan.md` §3, Milestone B6).
 *
 * No real network: `fetch` is injected, so every allocator answer — a listing, a
 * dead row, a taken seat, an unreachable allocator, a body that is not JSON — is
 * a fixture.
 *
 * Two properties carry the file. **A read decides nothing**: `readLobbyList`
 * answers `null` for every failure, because the list is a photograph up to ten
 * seconds old and the join round trip is the only authority on whether a player
 * gets in (Trap 5). And **a bad row costs its own row, never the list**: one
 * malformed entry must not blank a screen full of good ones, because the plan's
 * first card rule is that the list never blanks.
 */

import { describe, expect, it } from 'vitest';
import { joinListing, readLobbyList } from './lobby-list';
import type { FetchLike, FetchResponse } from './allocator-client';

const BASE = 'https://alloc.example.com';

/** A `fetch` that answers with one canned response and records how it was called. */
function stubFetch(response: { status: number; json?: () => Promise<unknown> }): {
  fetch: FetchLike;
  calls: { url: string; method: string; headers: Readonly<Record<string, string>> | undefined }[];
} {
  const calls: {
    url: string;
    method: string;
    headers: Readonly<Record<string, string>> | undefined;
  }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers });
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: response.json ?? ((): Promise<unknown> => Promise.resolve({})),
    } as FetchResponse);
  };
  return { fetch, calls };
}

/** A `fetch` that throws, the way an offline device's does. */
const throwingFetch: FetchLike = () => Promise.reject(new Error('offline'));

/** One row as `GET /rooms` publishes it — no room code anywhere. */
const ROW = {
  id: 'aFsQ2mZ0pLd7Rk9x',
  owner: 'K4M9QX',
  region: 'iad',
  size: 8,
  mode: 'ffa',
  players: 2,
  joinableSeats: 4,
};

/** The allocation body a listing join answers with (allocator/index.ts). */
const JOINED = {
  room: 'QK7P',
  machine: 'm-abc',
  region: 'iad',
  ticket: 'payload.sig',
  expiresAt: 1_030_000,
  connectUrl: 'ws://m-abc:8080/',
};

const listOf = (rooms: unknown[], asOf = 1_000): { status: number; json: () => Promise<unknown> } => ({
  status: 200,
  json: () => Promise.resolve({ rooms, asOf }),
});

describe('readLobbyList', () => {
  it('reads the listing the allocator published', async () => {
    const { fetch, calls } = stubFetch(listOf([ROW]));

    const list = await readLobbyList({ baseUrl: BASE, fetch });

    expect(calls[0]?.url).toBe(`${BASE}/rooms`);
    expect(list).toEqual({ rooms: [ROW], asOf: 1_000 });
  });

  it('stays CORS-simple — a bare GET with no custom header (Trap 11)', async () => {
    // A custom request header would make every poll a preflight *plus* a GET,
    // doubling the only cost this feature has (plan §6).
    const { fetch, calls } = stubFetch(listOf([ROW]));

    await readLobbyList({ baseUrl: BASE, fetch });

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers).toBeUndefined();
  });

  it('carries no room code, because the route publishes none', async () => {
    const { fetch } = stubFetch(listOf([ROW]));
    const list = await readLobbyList({ baseUrl: BASE, fetch });
    expect(JSON.stringify(list)).not.toContain('QK7P');
  });

  it('keeps a row that omits the optional size and mode', async () => {
    const { id, owner, region, players, joinableSeats } = ROW;
    const { fetch } = stubFetch(listOf([{ id, owner, region, players, joinableSeats }]));

    const list = await readLobbyList({ baseUrl: BASE, fetch });

    expect(list?.rooms).toHaveLength(1);
    expect(list?.rooms[0]?.size).toBeUndefined();
  });

  it('drops a malformed row rather than the whole listing', async () => {
    const { fetch } = stubFetch(
      listOf([
        ROW,
        { id: 'x', owner: 'AAAAAA', region: 'iad', players: 'two', joinableSeats: 4 },
        { owner: 'BBBBBB', region: 'iad', players: 1, joinableSeats: 2 }, // no handle
        { id: 'y', owner: 'CCCCCC', region: 'gru', players: 1 }, // no seat count
        null,
        'not a row',
      ]),
    );

    const list = await readLobbyList({ baseUrl: BASE, fetch });

    // Five bad rows cost five rows. The one good one still draws.
    expect(list?.rooms).toEqual([ROW]);
  });

  it('reads an empty listing as empty, not as a failure', async () => {
    // A fleet with nothing open is a *sentence* on screen ("NO OPEN CLAIMS RIGHT
    // NOW"), and the screen can only say it if this is distinguishable from null.
    const { fetch } = stubFetch(listOf([]));

    expect(await readLobbyList({ baseUrl: BASE, fetch })).toEqual({ rooms: [], asOf: 1_000 });
  });

  it('reads a missing asOf as 0 rather than dropping the listing', async () => {
    const { fetch } = stubFetch({ status: 200, json: () => Promise.resolve({ rooms: [ROW] }) });
    expect((await readLobbyList({ baseUrl: BASE, fetch }))?.asOf).toBe(0);
  });

  describe('every failure is the same one value — the read decides nothing', () => {
    it('null on a 404', async () => {
      const { fetch } = stubFetch({ status: 404 });
      expect(await readLobbyList({ baseUrl: BASE, fetch })).toBeNull();
    });

    it('null on a 500', async () => {
      const { fetch } = stubFetch({ status: 500 });
      expect(await readLobbyList({ baseUrl: BASE, fetch })).toBeNull();
    });

    it('null when fetch itself throws — offline, DNS, TLS', async () => {
      expect(await readLobbyList({ baseUrl: BASE, fetch: throwingFetch })).toBeNull();
    });

    it('null on a body that is not JSON', async () => {
      const { fetch } = stubFetch({
        status: 200,
        json: () => Promise.reject(new Error('not json')),
      });
      expect(await readLobbyList({ baseUrl: BASE, fetch })).toBeNull();
    });

    it('null on a body with no rooms array', async () => {
      const { fetch } = stubFetch({ status: 200, json: () => Promise.resolve({ asOf: 1 }) });
      expect(await readLobbyList({ baseUrl: BASE, fetch })).toBeNull();
    });

    it('null on a body that is not an object at all', async () => {
      const { fetch } = stubFetch({ status: 200, json: () => Promise.resolve('rooms') });
      expect(await readLobbyList({ baseUrl: BASE, fetch })).toBeNull();
    });
  });
});

describe('joinListing — the JOIN button on a row', () => {
  it('posts the handle and lands the same connection a typed code lands', async () => {
    const { fetch, calls } = stubFetch({ status: 200, json: () => Promise.resolve(JOINED) });

    const result = await joinListing({ baseUrl: BASE, fetch }, ROW.id);

    expect(calls[0]).toMatchObject({ url: `${BASE}/listings/${ROW.id}/join`, method: 'POST' });
    expect(result).toEqual({
      ok: true,
      connection: {
        url: 'ws://m-abc:8080/',
        room: 'QK7P',
        ticket: 'payload.sig',
        machine: 'm-abc',
        region: 'iad',
        expiresAt: 1_030_000,
      },
    });
  });

  it('learns the room code from the join, never from the row', async () => {
    // The code is what a `join` names on the socket, so it must reach the joiner
    // — and it does, here, at the one moment the player is actually entering.
    const { fetch } = stubFetch({ status: 200, json: () => Promise.resolve(JOINED) });
    const result = await joinListing({ baseUrl: BASE, fetch }, ROW.id);
    expect(result.ok && result.connection.room).toBe('QK7P');
  });

  it('escapes the handle into the path', async () => {
    const { fetch, calls } = stubFetch({ status: 200, json: () => Promise.resolve(JOINED) });
    await joinListing({ baseUrl: BASE, fetch }, 'a/b?c');
    expect(calls[0]?.url).toBe(`${BASE}/listings/a%2Fb%3Fc/join`);
  });

  describe('the honest end of a stale row', () => {
    it('404 → not-found: the claim is gone, or has gone private', async () => {
      const { fetch } = stubFetch({ status: 404 });
      expect(await joinListing({ baseUrl: BASE, fetch }, ROW.id)).toEqual({
        ok: false,
        reason: 'not-found',
      });
    });

    it('409 → room-full: the claim is there and somebody was faster', async () => {
      // A different sentence from the one above, because it is a different fact:
      // the room the row showed is alive, and the seat is not.
      const { fetch } = stubFetch({ status: 409 });
      expect(await joinListing({ baseUrl: BASE, fetch }, ROW.id)).toEqual({
        ok: false,
        reason: 'room-full',
      });
    });

    it('503 → no-capacity: the fleet, not the room', async () => {
      const { fetch } = stubFetch({ status: 503 });
      expect(await joinListing({ baseUrl: BASE, fetch }, ROW.id)).toEqual({
        ok: false,
        reason: 'no-capacity',
      });
    });

    it('a thrown fetch is network, never a dead row', async () => {
      expect(await joinListing({ baseUrl: BASE, fetch: throwingFetch }, ROW.id)).toEqual({
        ok: false,
        reason: 'network',
      });
    });

    it('a 2xx with an unusable body is bad-response, not a connection', async () => {
      const { fetch } = stubFetch({
        status: 200,
        json: () => Promise.resolve({ room: 'QK7P' }), // no ticket: no join
      });
      expect(await joinListing({ baseUrl: BASE, fetch }, ROW.id)).toEqual({
        ok: false,
        reason: 'bad-response',
      });
    });

    it('a 2xx whose body is not JSON is bad-response', async () => {
      const { fetch } = stubFetch({
        status: 200,
        json: () => Promise.reject(new Error('not json')),
      });
      expect(await joinListing({ baseUrl: BASE, fetch }, ROW.id)).toEqual({
        ok: false,
        reason: 'bad-response',
      });
    });
  });
});

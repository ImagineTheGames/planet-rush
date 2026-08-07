/**
 * src/net/allocator-client.test.ts — the one HTTP round trip before the socket.
 * OWNER: Netcode Engineer (GDD §4.2; M9 hosting, Task 9).
 *
 * No real network: `fetch` is injected, so every allocator answer — a minted
 * room, a 404 for a room that has ended, a 503 for a full fleet — is a fixture,
 * and the whole file runs in microseconds. The thing under test is a *decision
 * about where to open the socket*, not a socket.
 */

import { describe, expect, it } from 'vitest';
import {
  allocateRoom,
  allocatorUrlFromEnv,
  joinRoom,
  probeRoomLiveness,
  readRoomAdvert,
} from './allocator-client';
import type { FetchLike, FetchResponse } from './allocator-client';

/** A `fetch` that answers with one canned response and records how it was called. */
function stubFetch(response: Partial<FetchResponse> & { status: number }): {
  fetch: FetchLike;
  calls: { url: string; method: string; body: string | undefined }[];
} {
  const calls: { url: string; method: string; body: string | undefined }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: response.json ?? ((): Promise<unknown> => Promise.resolve({})),
    } as FetchResponse);
  };
  return { fetch, calls };
}

/** The body the allocator returns on a successful allocate/join (allocator/index.ts). */
const OK_BODY = {
  room: 'QK7P',
  machine: 'm-abc',
  region: 'iad',
  ticket: 'payload.sig',
  expiresAt: 1_030_000,
  connectUrl: 'ws://m-abc:8080/',
};

describe('allocatorUrlFromEnv', () => {
  it('returns null when VITE_ALLOCATOR_URL is unset — the direct-connect path survives', () => {
    expect(allocatorUrlFromEnv({})).toBeNull();
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: '' })).toBeNull();
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: '   ' })).toBeNull();
  });

  it('trims the base URL and strips a trailing slash so paths join cleanly', () => {
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: 'https://alloc.example.com/' })).toBe(
      'https://alloc.example.com',
    );
    expect(allocatorUrlFromEnv({ VITE_ALLOCATOR_URL: '  https://alloc.example.com  ' })).toBe(
      'https://alloc.example.com',
    );
  });
});

describe('joinRoom', () => {
  it('POSTs to /rooms/:code/join and resolves the connect URL, room and ticket', async () => {
    const { fetch, calls } = stubFetch({ status: 200, json: () => Promise.resolve(OK_BODY) });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');

    expect(calls).toEqual([
      { url: 'https://alloc.example.com/rooms/QK7P/join', method: 'POST', body: undefined },
    ]);
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

  it('url-encodes the room code in the path', async () => {
    const { fetch, calls } = stubFetch({ status: 200, json: () => Promise.resolve(OK_BODY) });
    await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'a/b');
    expect(calls[0]?.url).toBe('https://alloc.example.com/rooms/a%2Fb/join');
  });

  it('maps a 404 to room-gone — the room has ended, do not retry', async () => {
    const { fetch } = stubFetch({ status: 404, json: () => Promise.resolve({ error: 'not-found' }) });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('maps a 503 to no-capacity — the fleet is full', async () => {
    const { fetch } = stubFetch({ status: 503, json: () => Promise.resolve({ error: 'no-capacity' }) });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'no-capacity' });
  });

  it('reports a thrown fetch as a network failure, never a room death', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('rejects a 200 whose body is missing a ticket as a bad response', async () => {
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ room: 'QK7P', connectUrl: 'ws://x/' }),
    });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('falls back to a ws URL derived from the allocator host when connectUrl is null', async () => {
    // A defensive fallback for a body that carries no connectUrl at all. (On Fly
    // the allocator now populates connectUrl with the gameserver app's shared
    // endpoint, so this path is not the Fly path — it is the last-resort default.)
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ ...OK_BODY, connectUrl: null }),
    });
    const result = await joinRoom({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(result.ok && result.connection.url).toBe('wss://alloc.example.com/');
  });

  it('derives an insecure ws:// URL from an http allocator base', async () => {
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ ...OK_BODY, connectUrl: null }),
    });
    const result = await joinRoom({ baseUrl: 'http://localhost:8080', fetch }, 'QK7P');
    expect(result.ok && result.connection.url).toBe('ws://localhost:8080/');
  });
});

describe('allocateRoom', () => {
  it('POSTs to /rooms with the requested shape and resolves the minted room', async () => {
    const { fetch, calls } = stubFetch({ status: 201, json: () => Promise.resolve(OK_BODY) });
    const result = await allocateRoom(
      { baseUrl: 'https://alloc.example.com', fetch },
      { region: 'iad', size: 4, mode: 'ffa' },
    );

    expect(calls[0]?.url).toBe('https://alloc.example.com/rooms');
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ region: 'iad', size: 4, mode: 'ffa' });
    expect(result.ok && result.connection.room).toBe('QK7P');
  });

  it('sends an empty body when no room shape is requested', async () => {
    const { fetch, calls } = stubFetch({ status: 201, json: () => Promise.resolve(OK_BODY) });
    await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });
    expect(calls[0]?.body).toBeUndefined();
  });

  it('maps a 503 (full fleet) to no-capacity', async () => {
    const { fetch } = stubFetch({ status: 503, json: () => Promise.resolve({ error: 'no-capacity' }) });
    const result = await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });
    expect(result).toEqual({ ok: false, reason: 'no-capacity' });
  });

  it('sends NO region when the caller names none — the allocator infers it', async () => {
    // The regression this guards: the shipped client used to send a hard-coded
    // `iad` from a one-entry region list nobody could pick from, which outranked
    // the edge inference and pinned every creator to Virginia (src/main.ts).
    const { fetch, calls } = stubFetch({ status: 201, json: () => Promise.resolve(OK_BODY) });
    await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch }, { size: 4 });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ size: 4 });
  });
});

describe('allocateRoom — the placement reason, carried to the session log', () => {
  const PLACED = {
    ...OK_BODY,
    machine: 'd891dd0a1443e8',
    region: 'gru',
    placement: {
      requested: 'gru',
      region: 'gru',
      reason: 'preferred',
      detail: 'gru — your region',
    },
  };

  it('reads the allocator\'s reason onto the resolved connection', async () => {
    const { fetch } = stubFetch({ status: 201, json: () => Promise.resolve(PLACED) });
    const result = await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });

    expect(result.ok && result.connection.placement).toEqual({
      requested: 'gru',
      region: 'gru',
      reason: 'preferred',
      detail: 'gru — your region',
    });
  });

  it('leaves it absent when the allocator sent none — a join, or an older allocator', async () => {
    const { fetch } = stubFetch({ status: 201, json: () => Promise.resolve(OK_BODY) });
    const result = await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });

    expect(result.ok).toBe(true);
    expect(result.ok && result.connection.placement).toBeUndefined();
  });

  it('never fails a good connection over a malformed placement', async () => {
    // The placement costs a log line, not a match. Junk is dropped, the room and
    // the ticket still resolve.
    for (const placement of [null, 'gru', 42, {}, { region: 'gru' }]) {
      const { fetch } = stubFetch({
        status: 201,
        json: () => Promise.resolve({ ...OK_BODY, placement }),
      });
      const result = await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });
      expect(result.ok && result.connection.room).toBe('QK7P');
      expect(result.ok && result.connection.placement).toBeUndefined();
    }
  });

  it('synthesises a readable line when the allocator omitted the detail', async () => {
    const { fetch } = stubFetch({
      status: 201,
      json: () => Promise.resolve({ ...OK_BODY, placement: { region: 'iad', reason: 'region-full' } }),
    });
    const result = await allocateRoom({ baseUrl: 'https://alloc.example.com', fetch });
    expect(result.ok && result.connection.placement?.detail).toBe('iad — region-full');
  });
});

describe('probeRoomLiveness', () => {
  it('GETs /rooms/:code and reads live when a Machine hosts it', async () => {
    const { fetch, calls } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ code: 'QK7P', joinable: true }),
    });
    const liveness = await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(calls).toEqual([
      { url: 'https://alloc.example.com/rooms/QK7P', method: 'GET', body: undefined },
    ]);
    expect(liveness).toBe('live');
  });

  it('reads gone on a 404 — the witness that says stop retrying', async () => {
    const { fetch } = stubFetch({ status: 404, json: () => Promise.resolve({ error: 'not-found' }) });
    expect(
      await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'),
    ).toBe('gone');
  });

  it('reads unknown when the allocator itself is unreachable — not a room death', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    expect(
      await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'),
    ).toBe('unknown');
  });

  it('reads unknown on a 5xx — the allocator is sick, which says nothing about the room', async () => {
    const { fetch } = stubFetch({ status: 500, json: () => Promise.resolve({ error: 'internal' }) });
    expect(
      await probeRoomLiveness({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'),
    ).toBe('unknown');
  });
});

describe('readRoomAdvert — what a joiner sees BEFORE committing', () => {
  it('reads the room’s region and shape from the same GET the liveness probe makes', async () => {
    const { fetch, calls } = stubFetch({
      status: 200,
      json: () =>
        Promise.resolve({
          code: 'QK7P',
          machine: 'm-abc',
          region: 'gru',
          size: 4,
          mode: 'teams',
          joinableSeats: 2,
          joinable: true,
        }),
    });
    const advert = await readRoomAdvert({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');

    expect(calls).toEqual([
      { url: 'https://alloc.example.com/rooms/QK7P', method: 'GET', body: undefined },
    ]);
    // The region is the field this exists for: the HOST’s region is the ping
    // profile of every guest, so a joiner is owed it before they commit.
    expect(advert).toEqual({
      code: 'QK7P',
      machine: 'm-abc',
      region: 'gru',
      size: 4,
      mode: 'teams',
      joinableSeats: 2,
      joinable: true,
    });
  });

  it('survives a room the allocator knows only through a reservation (no region yet)', async () => {
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ code: 'QK7P', machine: 'm-abc', region: '', joinable: true }),
    });
    const advert = await readRoomAdvert({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P');
    expect(advert).toMatchObject({ region: '', joinable: true });
    expect(advert?.size).toBeUndefined();
  });

  it('reads silence as joinable — this preview decides nothing; the join does', async () => {
    const { fetch } = stubFetch({
      status: 200,
      json: () => Promise.resolve({ code: 'QK7P', region: 'iad' }),
    });
    expect((await readRoomAdvert({ baseUrl: 'https://alloc.example.com', fetch }, 'QK7P'))?.joinable).toBe(true);
  });

  it('is null for a room that has ended, an unreachable allocator, or an unusable answer', async () => {
    const config = { baseUrl: 'https://alloc.example.com' };
    const gone = stubFetch({ status: 404, json: () => Promise.resolve({ error: 'not-found' }) });
    expect(await readRoomAdvert({ ...config, fetch: gone.fetch }, 'QK7P')).toBeNull();

    const offline: FetchLike = () => Promise.reject(new Error('offline'));
    expect(await readRoomAdvert({ ...config, fetch: offline }, 'QK7P')).toBeNull();

    const nonsense = stubFetch({ status: 200, json: () => Promise.resolve({ nothing: true }) });
    expect(await readRoomAdvert({ ...config, fetch: nonsense.fetch }, 'QK7P')).toBeNull();
  });

  it('escapes the code exactly as the liveness probe does', async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    await readRoomAdvert({ baseUrl: 'https://alloc.example.com', fetch }, 'a/b');
    expect(calls[0]?.url).toBe('https://alloc.example.com/rooms/a%2Fb');
  });
});

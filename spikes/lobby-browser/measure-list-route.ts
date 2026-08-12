/**
 * spikes/lobby-browser/measure-list-route.ts — THROWAWAY measurement code for
 * the SHIPPED list route (n10-01, a0-26 Milestone B). NOT production; not in the
 * build; excluded from the root tsconfig and from vitest. Run it with:
 *
 *   npx vite-node spikes/lobby-browser/measure-list-route.ts
 *
 * Its companion `./measure-listing.ts` measured what the route would cost
 * *before* it existed, against a hand-built payload that still carried room
 * codes. This one measures the route that shipped, over a **real socket**, with
 * the real `createAllocatorServer`, the real `Allocator`, the real
 * `InMemoryRoomRegistry` and the real derived handles — and it counts bytes on
 * the wire rather than `JSON.stringify(...).length`, because the question the
 * developer actually asked is what an idle browser costs the allocator, and an
 * HTTP request is not its body.
 *
 * The number this exists to produce is **D5's**: what one browsing player costs
 * per minute. It reports it and stops there — fleet sizing is the developer's
 * call and is unanswered (brief n10-01: *report the number, do not provision*).
 *
 *   §1  ONE ROW        — what a row carries, and what it does not
 *   §2  ONE LISTING    — the deployed fleet at its ceiling, on the wire
 *   §3  ONE BROWSER    — requests and bytes per player per minute
 *   §4  A CLASSROOM    — thirty of them, and what the allocator does about it
 *   §5  THE ALTERNATIVE— the fan-out this route was chosen over
 */

import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
import { mulberry32 } from '../../src/shared/types';
import { InMemoryRoomRegistry, type Heartbeat } from '../../allocator/registry';
import { Allocator } from '../../allocator/allocator';
import { DirectRouter } from '../../allocator/router';
import { createAllocatorServer } from '../../allocator/index';
import { DEFAULT_MAX_ROOMS } from '../../server/match-server';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '../../server/heartbeat';

const SECRET = 'spike-shared-secret';
const T0 = 1_700_000_000_000;
/** The deployed fleet: two Machines (docs/hosting-plan.md Task 11). */
const DEPLOYED_MACHINES = 2;
/** The poll the plan recommends and D4 settles on. */
const POLL_MS = 5_000;

const line = (s = ''): void => console.log(s);
const rule = (title: string): void => {
  line();
  line(`── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`);
  line();
};

/** A Machine's beat, hosting `count` lobby-phase rooms with plausible occupancy. */
function beat(machine: string, region: string, count: number, from: number): Heartbeat {
  const rooms = [];
  for (let i = 0; i < count; i++) {
    const code = `${'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(from + i) % 32]}${'7QM4'}`.padEnd(4, 'X');
    rooms.push({
      code: code.slice(0, 4),
      players: 1 + (i % 3),
      size: 8,
      mode: i % 2 === 0 ? 'ffa' : 'teams',
      joinableSeats: 7 - (i % 3),
    });
  }
  return { machine, region, capacity: DEFAULT_MAX_ROOMS, rooms };
}

/**
 * One raw HTTP/1.1 GET over `node:net`, counting **every byte in both
 * directions** — request line, headers, blank line, status line, response
 * headers and body. A browser's poll costs all of them, and the request half is
 * the bigger surprise: a bare GET's headers outweigh a room row.
 */
function rawGet(
  port: number,
  path: string,
): Promise<{ sent: number; received: number; body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(port, '127.0.0.1');
    // The request a browser on GitHub Pages actually sends for a CORS-simple
    // cross-origin GET: no custom header, so no preflight (Trap 11). The one
    // deviation is `Connection: close`, so this reads to EOF and counts every
    // byte; a real browser keeps the socket alive, which makes its per-poll cost
    // *lower* than what is printed here, never higher.
    const request =
      `GET ${path} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Origin: https://imaginethegames.github.io\r\n` +
      `User-Agent: Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124\r\n` +
      `Accept: */*\r\n` +
      `Accept-Encoding: gzip, deflate, br\r\n` +
      `Connection: close\r\n` +
      `\r\n`;
    let received = 0;
    const chunks: Buffer[] = [];
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk: Buffer) => {
      received += chunk.length;
      chunks.push(chunk);
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const whole = Buffer.concat(chunks).toString('utf8');
      const split = whole.indexOf('\r\n\r\n');
      const head = whole.slice(0, Math.max(0, split));
      const framed = whole.slice(split + 4);
      resolve({
        sent: Buffer.byteLength(request, 'utf8'),
        received,
        // Node answers this route with `Transfer-Encoding: chunked` (the handler
        // writes its head before it knows the length), so the body arrives
        // wrapped in chunk framing. Those framing bytes are real bytes on the
        // wire and stay in `received`; only the *content* is unwrapped here.
        body: /transfer-encoding:\s*chunked/i.test(head) ? dechunk(framed) : framed,
        status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0),
      });
    });
  });
}

/** Unwrap HTTP/1.1 chunked framing: `<hex length>CRLF<bytes>CRLF`, repeated. */
function dechunk(framed: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const eol = framed.indexOf('\r\n', cursor);
    if (eol < 0) break;
    const size = Number.parseInt(framed.slice(cursor, eol), 16);
    if (!Number.isFinite(size) || size === 0) break;
    out += framed.slice(eol + 2, eol + 2 + size);
    cursor = eol + 2 + size + 2;
  }
  return out;
}

async function main(): Promise<void> {
  const registry = new InMemoryRoomRegistry();
  const allocator = new Allocator({ registry, rng: mulberry32(7), secret: SECRET });
  const now = { value: T0 };
  const server = createAllocatorServer({
    allocator,
    registry,
    router: new DirectRouter((m) => `wss://${m}.fly.dev/play`),
    now: () => now.value,
    log: () => {},
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // The deployed fleet at its advertised ceiling: 2 Machines × 6 rooms.
  for (let m = 0; m < DEPLOYED_MACHINES; m++) {
    registry.observe(beat(`4d891e33b27a9${m}`, 'iad', DEFAULT_MAX_ROOMS, m * 7), now.value);
  }

  // ---- §1 ---------------------------------------------------------------
  rule('§1  ONE ROW — what a browse row carries');

  const first = await rawGet(port, '/rooms');
  const listing = JSON.parse(first.body) as { rooms: unknown[]; asOf: number };
  line(`one row, verbatim off the wire:`);
  line(`    ${JSON.stringify(listing.rooms[0])}`);
  line();
  line(`fields: ${Object.keys(listing.rooms[0] as object).join(', ')}`);
  line(`a room code anywhere in the payload? ${/"[A-Z2-9]{4}"/.test(first.body) ? 'YES' : 'no'}`);
  line(`one row weighs ${JSON.stringify(listing.rooms[0]).length} B of JSON`);

  // ---- §2 ---------------------------------------------------------------
  rule('§2  ONE LISTING — the deployed fleet at its ceiling, on the wire');

  const rooms = listing.rooms.length;
  line(`fleet:            ${DEPLOYED_MACHINES} Machines × ${DEFAULT_MAX_ROOMS} rooms = ${rooms} listed`);
  line(`JSON body:        ${Buffer.byteLength(first.body, 'utf8')} B`);
  line(`whole response:   ${first.received} B  (status line + headers + body)`);
  line(`the request:      ${first.sent} B  (a bare CORS-simple GET, no preflight)`);
  line(`round trip:       ${first.sent + first.received} B`);
  line();
  line(`per room:         ${Math.round(Buffer.byteLength(first.body, 'utf8') / rooms)} B of body`);
  line(`empty fleet:      the same route on an empty registry —`);
  const emptyRegistry = new InMemoryRoomRegistry();
  const emptyServer = createAllocatorServer({
    allocator: new Allocator({ registry: emptyRegistry, rng: mulberry32(7), secret: SECRET }),
    registry: emptyRegistry,
    router: new DirectRouter((m) => `wss://${m}.fly.dev/play`),
    now: () => now.value,
    log: () => {},
  });
  await new Promise<void>((resolve) => emptyServer.listen(0, '127.0.0.1', resolve));
  const emptyPort = (emptyServer.address() as AddressInfo).port;
  const empty = await rawGet(emptyPort, '/rooms');
  line(`                  ${empty.sent + empty.received} B round trip, body ${empty.body}`);
  emptyServer.close();

  // ---- §3 ---------------------------------------------------------------
  rule('§3  ONE BROWSER — what an idle browsing player costs, per minute');

  const perMinute = 60_000 / POLL_MS;
  const bytesPerPoll = first.sent + first.received;
  line(`poll cadence:     ${POLL_MS / 1000} s (D4; the list cannot be fresher than the`);
  line(`                  ${DEFAULT_HEARTBEAT_INTERVAL_MS / 1000} s heartbeat that feeds it, so a faster poll buys nothing)`);
  line();
  const box = (text: string): void => line(`  │ ${text.padEnd(58)} │`);
  line(`  ┌${'─'.repeat(60)}┐`);
  box('ONE PLAYER, BROWSE ON SCREEN, PER MINUTE');
  box(`   requests:  ${perMinute}`);
  box(
    `   bytes:     ${perMinute * bytesPerPoll}  (${((perMinute * bytesPerPoll) / 1024).toFixed(1)} kB, full fleet, uncompressed)`,
  );
  box('ONE PLAYER, TAB HIDDEN OR OFF THE BROWSE SEGMENT');
  box('   requests:  0        bytes:  0');
  line(`  └${'─'.repeat(60)}┘`);
  line();
  for (const poll of [2_000, 5_000, 10_000]) {
    const n = 60_000 / poll;
    line(
      `  ${String(poll / 1000).padStart(2)} s poll → ${String(n).padStart(2)} req/min, ` +
        `${String(n * bytesPerPoll).padStart(6)} B/min, ${((n * bytesPerPoll * 60) / 1_048_576).toFixed(2)} MB/hour`,
    );
  }

  // ---- §4 ---------------------------------------------------------------
  rule('§4  A CLASSROOM — thirty browsers, and the CPU under them');

  for (const players of [1, 6, 30, 100]) {
    const rps = (players * 60_000) / POLL_MS / 60;
    line(
      `  ${String(players).padStart(3)} browsing players → ${rps.toFixed(1).padStart(5)} req/s, ` +
        `${(((players * 60_000) / POLL_MS) * bytesPerPoll * 60 / 1_048_576).toFixed(1)} MB/hour at the allocator`,
    );
  }
  line();
  // Building one listing, from state already in memory.
  for (const machines of [2, 20]) {
    const reg = new InMemoryRoomRegistry();
    for (let m = 0; m < machines; m++) reg.observe(beat(`m${m}`, 'iad', DEFAULT_MAX_ROOMS, m), T0);
    const alloc = new Allocator({ registry: reg, rng: mulberry32(1), secret: SECRET });
    const runs = 2_000;
    const started = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) alloc.rooms(T0);
    const each = Number(process.hrtime.bigint() - started) / runs / 1000;
    line(
      `  ${String(machines).padStart(2)} Machines × ${DEFAULT_MAX_ROOMS} rooms = ` +
        `${String(machines * DEFAULT_MAX_ROOMS).padStart(3)} rooms → ${each.toFixed(1)} µs to build one listing`,
    );
  }
  line();
  line('  (the listing derives two HMACs per room; that is what the µs above includes)');

  // ---- §5 ---------------------------------------------------------------
  rule('§5  THE ALTERNATIVE — the fan-out this route was chosen over');

  // One room's advertisement, by code — the read a per-row fan-out would make.
  const sample = registry.machines(now.value)[0]!.rooms[0]!.code;
  const one = await rawGet(port, `/rooms/${sample}`);
  line(`GET /rooms/:code — one room's advert: ${one.sent + one.received} B round trip (status ${one.status})`);
  line(`reading the fleet a row at a time: ${rooms} requests per refresh instead of 1,`);
  line(`i.e. ${rooms * perMinute} allocator requests/min per open browser at a ${POLL_MS / 1000} s poll.`);

  rule('FOR D5 — the one number, and what it does NOT say');

  line(`AN IDLE BROWSING PLAYER COSTS THE ALLOCATOR ${perMinute} REQUESTS AND ${
    perMinute * bytesPerPoll
  } BYTES PER MINUTE,`);
  line(`and ZERO while their tab is hidden or they are not on the BROWSE segment.`);
  line();
  line('What that is not: it is not room capacity. This route reads the registry');
  line('and never touches a gameserver, so browsing cannot cost a live match a');
  line('frame and cannot fill a Machine. What a browser MIGHT do is make open');
  line('rooms findable enough that the 12-room ceiling binds sooner — which is');
  line('D5, is the developer\'s call, and is not answered here.');
  line();

  server.close();
}

void main();

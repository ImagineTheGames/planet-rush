/**
 * tests/server/upgrade-replay.test.ts — the machine-pin on the SOCKET hop (M10
 * fly-replay-on-socket). OWNER: Netcode Engineer (GDD §4.2).
 *
 * The live CREATE ROOM failure was a `fly-replay` header on the allocate/join
 * JSON response: the Fly edge replayed the POST at the gameserver and the client
 * never received its {room, ticket}. The pin moved to the WebSocket upgrade, and
 * this proves it there — first as the pure decision (`replayForUpgrade`), then
 * over a real socket through the shipping upgrade handshake (`server/ws.ts`):
 *
 *   • a wrong-machine upgrade is answered `fly-replay instance=<host>` before the
 *     101, so the edge re-delivers it to the room's host;
 *   • a right-machine upgrade completes the handshake and plays.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { signTicket } from '../../src/net/ticket';
import { replayForUpgrade } from '../../server/upgrade-router';
import type { UpgradeGuard } from '../../server/ws';
import { startMatchServer } from '../net/node-websocket';
import type { MatchServerHarness } from '../net/node-websocket';

const SECRET = 'allocator-and-machine-share-this';
const MACHINE = 'm-host';
const OTHER = 'm-elsewhere';

/** A ticket the allocator would sign for `room` on `machine`, valid for a minute. */
function ticketFor(room: string, machine: string): string {
  return signTicket({ room, machine, expiresAt: Date.now() + 60_000 }, SECRET);
}

describe('replayForUpgrade — the pure decision', () => {
  const config = { machineId: MACHINE, secret: SECRET, now: () => Date.now() };

  it('replays a valid ticket that names a *different* machine to that instance', () => {
    const url = `/play?ticket=${encodeURIComponent(ticketFor('RUSH', OTHER))}`;
    expect(replayForUpgrade(url, config)).toEqual({ 'fly-replay': `instance=${OTHER}` });
  });

  it('serves here when the ticket names *this* machine', () => {
    const url = `/play?ticket=${encodeURIComponent(ticketFor('RUSH', MACHINE))}`;
    expect(replayForUpgrade(url, config)).toBeNull();
  });

  it('serves here when there is no ticket on the URL', () => {
    expect(replayForUpgrade('/play', config)).toBeNull();
    expect(replayForUpgrade(undefined, config)).toBeNull();
  });

  it('serves here for a ticket it cannot verify — the join gate refuses it honestly', () => {
    // Signed under a different secret: unverifiable, so never bounced on its word.
    const forged = signTicket({ room: 'RUSH', machine: OTHER, expiresAt: Date.now() + 60_000 }, 'wrong-secret');
    expect(replayForUpgrade(`/play?ticket=${encodeURIComponent(forged)}`, config)).toBeNull();
  });

  it('serves here for an expired ticket', () => {
    const stale = signTicket({ room: 'RUSH', machine: OTHER, expiresAt: Date.now() - 1 }, SECRET);
    expect(replayForUpgrade(`/play?ticket=${encodeURIComponent(stale)}`, config)).toBeNull();
  });
});

/** Open a raw upgrade and resolve the server's first HTTP response head (the
 *  status line + headers), reading just enough to see whether it 101'd or 409'd. */
function rawUpgrade(url: string): Promise<{ statusLine: string; headers: Record<string, string> }> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = createConnection(Number(parsed.port), parsed.hostname);
    let buffer = '';
    socket.on('connect', () => {
      socket.write(
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\nHost: ${parsed.host}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const [statusLine, ...headerLines] = buffer.slice(0, end).split('\r\n');
      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const colon = line.indexOf(':');
        if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      socket.destroy();
      resolve({ statusLine: statusLine ?? '', headers });
    });
    socket.on('error', reject);
  });
}

describe('the upgrade hop over a real socket', () => {
  let harness: MatchServerHarness | null = null;
  afterEach(async () => {
    await harness?.stop();
    harness = null;
  });

  /** The guard `server/index.ts` wires on Fly, built from the same pieces. */
  const guard: UpgradeGuard = (request) =>
    replayForUpgrade(request.url, { machineId: MACHINE, secret: SECRET, now: Date.now });

  it('answers a wrong-machine upgrade with a fly-replay to the host, before the 101', async () => {
    harness = await startMatchServer({ seed: 1, slots: 2, ticketSecret: SECRET, machineId: MACHINE }, guard);
    const res = await rawUpgrade(`${harness.url}?ticket=${encodeURIComponent(ticketFor('RUSH', OTHER))}`);
    expect(res.statusLine).not.toContain('101');
    expect(res.headers['fly-replay']).toBe(`instance=${OTHER}`);
    // Never opened a room for a connection it refused to complete.
    expect(harness.matches.room('RUSH')).toBeUndefined();
  }, 20_000);

  it('completes the handshake for a right-machine upgrade', async () => {
    harness = await startMatchServer({ seed: 2, slots: 2, ticketSecret: SECRET, machineId: MACHINE }, guard);
    const res = await rawUpgrade(`${harness.url}?ticket=${encodeURIComponent(ticketFor('RUSH', MACHINE))}`);
    expect(res.statusLine).toContain('101');
    expect(res.headers['fly-replay']).toBeUndefined();
  }, 20_000);
});

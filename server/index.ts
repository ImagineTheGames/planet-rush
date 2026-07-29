/**
 * server/index.ts — the process. OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * Everything ambient in the match server lives here and nowhere else: the HTTP
 * listener, the WebSocket upgrade, the boot seed, the 60 Hz interval that hands
 * `MatchServer.update` a clock reading, and the signal handlers that let a
 * container stop politely. Below this file there is no `Date.now()`, no timer
 * and no socket — which is what makes the match server testable, and what makes
 * this a **plain Dockerized Node process with zero vendor-specific APIs**
 * (GDD §4.2, risk 1).
 *
 * It imports `src/sim/` and `src/bots/` and **never PixiJS**: no GPU, no canvas,
 * no window (GDD §4.1).
 *
 * Configuration is environment variables and no config file, because a host that
 * needs a config file is a host that needs porting:
 *
 *   PORT          listen port                              (default 8080)
 *   HOST          bind address                             (default 0.0.0.0)
 *   MATCH_SEED    fixed boot seed, for a reproducible run  (default: random)
 *   TICKET_SECRET allocator↔Machine key; **its presence is the only switch** for
 *                 ticket enforcement (M9 fleet membership) (default: off — solo)
 *   ALLOCATOR_URL where to POST heartbeats; unset = a solo/self-hosted server
 *                 that never joins a fleet                 (default: none)
 *   MACHINE_ID    this Machine's id, falling back to FLY_MACHINE_ID  (fleet only)
 *   REGION        this Machine's datacentre, falling back to FLY_REGION (fleet only)
 *
 * A fleet Machine (both TICKET_SECRET and ALLOCATOR_URL set) enforces tickets,
 * beats its rooms and load to the allocator, and cordons on `POST /drain`. Unset
 * any of those and the same binary is a plain single server with no ceremony.
 */

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { MatchServer } from './match-server';
import {
  Cordon,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_LAG_SAMPLE_INTERVAL_MS,
  EventLoopLagMonitor,
  HeartbeatReporter,
  LagProbe,
  buildRegistration,
  readMachineIdentity,
} from './heartbeat';
import type { DeregistrationBody, HeartbeatBody, RegistrationBody } from './heartbeat';
import { FLEET_AUTH_HEADER, signFleetRequest } from '../src/net/fleet-auth';
import { attachWebSocketServer } from './ws';
import type { UpgradeGuard } from './ws';
import { replayForUpgrade } from './upgrade-router';

/** The sim runs at 60 Hz (GDD §4.1); the loop wakes at that rate and the room
 *  converts however much real time actually passed into whole ticks. */
const LOOP_INTERVAL_MS = 1000 / 60;

const port = Number(process.env['PORT'] ?? 8080);
const host = process.env['HOST'] ?? '0.0.0.0';
/** A fixed seed makes a whole run reproducible — useful when a match misbehaves
 *  and someone wants it back. Unset, the process draws one at boot. */
const seed = process.env['MATCH_SEED']
  ? Number(process.env['MATCH_SEED']) >>> 0
  : randomBytes(4).readUInt32LE(0);

/** Identity and the fleet switches (M9). A ticket secret turns on enforcement; an
 *  allocator URL turns on heartbeating. Either can be absent — that is a solo run. */
const identity = readMachineIdentity(process.env);
const ticketSecret = process.env['TICKET_SECRET'];
const allocatorUrl = process.env['ALLOCATOR_URL'];

const matches = new MatchServer({
  seed,
  // `exactOptionalPropertyTypes` is on: only pass a key when it has a value, so
  // enforcement stays off (not "on with undefined") on the solo path.
  ...(ticketSecret !== undefined ? { ticketSecret } : {}),
  ...(identity.machine ? { machineId: identity.machine } : {}),
});
const startedAt = Date.now();

/** The drain switch, flipped by `POST /drain` — a cordoned Machine advertises no
 *  capacity so the allocator places nothing new on it while its rooms empty. */
const cordon = new Cordon();

// The load signal (M9): sample how far past its deadline the event loop runs, at
// a steady cadence. The gap between the interval we asked for and the time that
// actually elapsed *is* the lag — the one reading that catches a throttled shared
// vCPU, which a CPU percentage hides. `performance.now()` is monotonic, so it is
// immune to a wall-clock step. Built before the HTTP server so `/health` can read
// it: the sustained-CPU gate (docs/netcode-spike.md, hosting Task 12) watches this
// number over a full match to tell a healthy shared core from a credit-exhausted
// one that has fallen back to its low baseline.
const lag = new EventLoopLagMonitor();

const http = createServer((request: IncomingMessage, response: ServerResponse) => {
  // Plain HTTP routes, so a health check or a cordon never has to speak WebSocket.
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: cordon.draining ? 'draining' : 'ok',
        machine: identity.machine,
        region: identity.region,
        rooms: matches.roomCount,
        capacity: matches.capacity,
        draining: cordon.draining,
        // p99 event-loop lag over the recent window, ms. The number the sustained
        // 20-minute CPU gate watches: healthy is a few ms; a breach of ~8 ms is the
        // sign a shared core has run out of burst credit and the fleet needs a
        // performance CPU size (docs/netcode-spike.md, "Status since (hosting)").
        loopLagMs: Math.round(lag.p99() * 100) / 100,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
    return;
  }
  // Graceful cordoning: stop taking new rooms, keep serving the ones already
  // running (M9). Idempotent, so a controller may call it more than once.
  if (request.url === '/drain' && request.method === 'POST') {
    cordon.drain();
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'draining', machine: identity.machine }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('Planet Rush match server — connect a WebSocket to play.\n');
});

// The Fly socket-hop machine-pin (M10). It arms only behind a Fly edge
// (MATCH_ROUTER=fly) and only when this Machine both knows its own id and holds
// the ticket key — the same fail-closed rule as ticket enforcement. Off Fly
// (direct/solo, and every test that dials a Machine directly) there is no guard
// and every upgrade completes locally, exactly as before.
const machineRouter = process.env['MATCH_ROUTER'] ?? 'direct';
const machineId = identity.machine;
const beforeUpgrade: UpgradeGuard | undefined =
  machineRouter === 'fly' && ticketSecret !== undefined && machineId
    ? (request): Readonly<Record<string, string>> | null =>
        replayForUpgrade(request.url, { machineId, secret: ticketSecret, now: Date.now })
    : undefined;

attachWebSocketServer(
  http,
  (connection) => {
    const client = matches.connect(connection);
    connection.onMessage((frame) => client.receive(frame));
    // A dropped socket is where the reconnect-grace rule begins: the room seats a
    // bot at once and holds the seat ~60 s (GDD §4.2).
    connection.onClose(() => client.close(Date.now()));
  },
  beforeUpgrade,
);

const loop = setInterval(() => matches.update(Date.now()), LOOP_INTERVAL_MS);

// The lag monitor was built above (so `/health` can read it); the probe that feeds
// it a monotonic reading on a cadence lives here with the other timers.
const lagProbe = new LagProbe(lag, DEFAULT_LAG_SAMPLE_INTERVAL_MS);
const lagTimer = setInterval(() => lagProbe.sample(performance.now()), DEFAULT_LAG_SAMPLE_INTERVAL_MS);
lagTimer.unref();

/**
 * POST a fleet control-plane message to the allocator, authenticated (M10). The
 * body is serialised once and *that exact string* is both signed and sent, so the
 * allocator's HMAC over the bytes it receives matches (`src/net/fleet-auth.ts`). A
 * non-2xx or a network error throws; the caller decides whether that is fatal (a
 * boot registration retries) or ignorable (a dropped beat, the registry rides it
 * out). The secret is the shared `TICKET_SECRET`.
 */
async function postFleet(
  base: string,
  path: string,
  body: RegistrationBody | HeartbeatBody | DeregistrationBody,
  secret: string,
): Promise<void> {
  const raw = JSON.stringify(body);
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FLEET_AUTH_HEADER]: signFleetRequest(raw, secret),
    },
    body: raw,
  });
  if (!response.ok) throw new Error(`${path} rejected: ${response.status}`);
}

// Join the fleet only when there is an allocator to beat to AND a shared secret to
// authenticate with. A solo/self-hosted server has no ALLOCATOR_URL and simply
// never joins (M9). An ALLOCATOR_URL with no TICKET_SECRET cannot sign its
// membership, so it fails closed rather than beating unsigned requests the
// allocator would only 401 (M10) — the same fail-closed rule as a ticket mismatch.
let heartbeatTimer: NodeJS.Timeout | undefined;
if (allocatorUrl !== undefined && ticketSecret === undefined) {
  console.warn(
    '[planet-rush] ALLOCATOR_URL is set but TICKET_SECRET is not — cannot authenticate ' +
      'to the allocator; this Machine will NOT join the fleet. Set the shared secret.',
  );
}
if (allocatorUrl !== undefined && ticketSecret !== undefined) {
  const secret = ticketSecret;
  const reporter = new HeartbeatReporter({
    identity,
    source: matches,
    cordon,
    lag,
    poster: { post: (body) => postFleet(allocatorUrl, '/fleet/heartbeat', body, secret) },
  });

  // Announce ourselves the instant we boot, so `/machines` lists this Machine and
  // the allocator can place on it before the first 5 s heartbeat lands (M10). The
  // registration retries a few times: on a fresh deploy the allocator may still be
  // coming up, and the heartbeats that follow would eventually register us anyway,
  // but retrying makes the door open promptly rather than a beat-interval later.
  const register = (): RegistrationBody =>
    buildRegistration({ identity, capacity: matches.capacity, draining: cordon.draining });
  void (async (): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await postFleet(allocatorUrl, '/register', register(), secret);
        console.log(`[planet-rush] registered ${identity.machine || '(no id)'} with ${allocatorUrl}`);
        return;
      } catch (e) {
        console.warn(`[planet-rush] registration attempt ${attempt + 1} failed`, e);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    console.warn('[planet-rush] registration never succeeded — relying on heartbeats to join');
  })();

  heartbeatTimer = setInterval(() => void reporter.beat(), DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
  console.log(`[planet-rush] fleet member ${identity.machine || '(no id)'} — beating to ${allocatorUrl}`);

  // Leave the fleet cleanly on the way out: deregister so the allocator forgets us
  // at once instead of ~15 s later when our last beat lapses (M10). Best-effort —
  // if it fails, liveness still expires us. Registered on the same signals as the
  // listener shutdown below.
  const deregister = (): Promise<void> =>
    postFleet(allocatorUrl, '/deregister', { machine: identity.machine }, secret).catch(() => {
      // Ignored: liveness expiry is the backstop.
    });
  process.on('SIGTERM', () => void deregister());
  process.on('SIGINT', () => void deregister());
}

http.listen(port, host, () => {
  console.log(`[planet-rush] match server listening on ${host}:${port} (seed ${seed})`);
});

/** Stop taking connections, stop the clock, and let the process exit. Docker
 *  sends SIGTERM; a terminal sends SIGINT. Both mean the same thing here. */
function shutdown(signal: string): void {
  console.log(`[planet-rush] ${signal} — shutting down`);
  clearInterval(loop);
  clearInterval(lagTimer);
  if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
  http.close(() => process.exit(0));
  // A client that will not hang up must not hold the deploy open forever.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

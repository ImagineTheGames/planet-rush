/**
 * allocator/index.ts — the allocator process. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md, Task 8).
 *
 * This is the ambient shell, exactly as `server/index.ts` is for the match
 * server: the HTTP listener, the boot config from environment variables, the
 * injected clock, and the SIGTERM handler that lets a container stop politely.
 * The decisions live below it — in {@link Allocator} (which Machine? what code?)
 * and {@link Router} (how does the client get there?) — and this file only wires
 * them to a socket. It imports neither PixiJS nor `src/sim/`: the allocator is
 * pure control plane.
 *
 * **The allocator is not in the gameplay path.** Its five routes place and find
 * rooms; none of them carries a game packet. Once a client holds its ticket and
 * its socket, this process can vanish and every live match carries on — the
 * property that makes matchmaking and gameplay fail independently. Nothing here
 * may break it, so this file opens no long-lived connection to a Machine and
 * proxies nothing; it answers a question and hangs up.
 *
 * The routes:
 *   GET  /health           liveness + fleet occupancy (plain HTTP, like the server)
 *   GET  /machines         the live fleet, listed — the operator's "who is registered?"
 *   GET  /regions          per-region capacity, for a client's region picker
 *   POST /register         a Machine announces itself on boot (authenticated, M10)
 *   POST /fleet/heartbeat  a Machine restates its rooms + load (authenticated, M10)
 *   POST /deregister       a Machine leaves the fleet at once (authenticated, M10)
 *   POST /rooms            allocate a NEW room  → 201 + signed ticket
 *   POST /rooms/:code/join reach an EXISTING room → 200 + signed ticket, 404 if gone
 *
 * **The fleet write routes are authenticated (M10).** `/register`, `/fleet/heartbeat`
 * and `/deregister` are the ones that mutate who-hosts-what, so each must carry an
 * `X-Fleet-Auth` HMAC over its body proving the sender holds the shared secret
 * (`src/net/fleet-auth.ts`) — a stranger cannot register a phantom host or forge a
 * heartbeat that hijacks a room code. It **fails closed**: with the secret set, a
 * missing or wrong proof is a 401, never an admission. The read routes and the
 * client's own allocate/join carry no proof and need none.
 *
 * **CORS (M10).** The game runs from GitHub Pages (a *different* origin from the
 * allocator), so a browser's `POST /rooms` is a cross-origin request the browser
 * gates on an `OPTIONS` preflight. This server answers that preflight (204 with
 * the allowed methods) and echoes `Access-Control-Allow-Origin` for the Pages
 * origin and for localhost dev; without it the browser never even sees the room
 * decision. Allowed origins are `ALLOW_ORIGINS` (comma-separated) plus any
 * localhost/127.0.0.1 dev origin.
 *
 * `createAllocatorServer` builds the `http.Server` without listening, so it is
 * testable over a real socket; the bootstrap at the foot of the file listens
 * only when this module is the process entry.
 *
 * Configuration is environment variables and no config file (a host that needs a
 * config file is a host that needs porting):
 *
 *   PORT             listen port                                 (default 8080)
 *   HOST             bind address                                (default 0.0.0.0)
 *   ALLOCATOR_SECRET the allocator↔Machine ticket key            (required in prod)
 *   ALLOCATOR_SEED   fixed code-mint seed, for a reproducible run(default: random)
 *   ALLOCATOR_ROUTER 'fly' | 'direct'                            (default 'direct')
 *   FLY_REGION       this allocator's region (Fly sets it)       (fly router only)
 *   MATCH_APP        the match servers' Fly app, if separate     (fly router only)
 *   MATCH_CONNECT_URL  the gameserver app's shared socket URL the client dials on
 *                    Fly; the SOCKET hop pins it to the room's host
 *                    (default wss://planet-rush-gameserver.fly.dev/play)  (fly router only)
 *   MATCH_URL_TEMPLATE  direct connect URL, '{machine}' expanded (default ws://{machine}:8080/)
 *   ALLOW_ORIGINS    comma-separated browser origins the CORS layer permits, on top
 *                    of any localhost dev origin (default the GitHub Pages origin)
 *
 * The fleet controller (allocator/fleet-controller.ts) is wired here but **ships
 * off** — it acts only when `FLEET_AUTOSCALE=on`, so turning it on is a config
 * change, not a code change. Its cordon is fed to the {@link Allocator} as
 * `excludeMachine`, so a drain stops new placement the moment it is armed:
 *
 *   FLEET_AUTOSCALE  'on' arms the autoscale loop                (default off)
 *   FLEET_INTERVAL_MS  reconcile cadence when armed              (default 15000)
 *   FLEET_IMAGE      match-server image a new spare boots        (default 'planet-rush:latest')
 *   FLEET_REGION     region new spares are created in            (default FLY_REGION or 'iad')
 *   FLY_API_TOKEN    Fly token → real provider; unset = in-memory fake (offline dev)
 *   FLY_APP          the match Machines' Fly app (real provider)
 */

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { mulberry32 } from '@shared/types';
import { FLEET_AUTH_HEADER, verifyFleetRequest } from '../src/net/fleet-auth';
import { Allocator, AllocatorError } from './allocator';
import { InMemoryRoomRegistry, type Heartbeat, type RoomRegistry } from './registry';
import { DirectRouter, FlyReplayRouter, type Router } from './router';
import { InMemoryMachineProvider, type MachineProvider } from './provider';
import { FlyMachineProvider } from './provider-fly';
import { FleetController, type FleetSignal } from './fleet-controller';

/** What the process wires together; injected so the server is testable. */
export interface AllocatorServerDeps {
  readonly allocator: Allocator;
  /** The same registry the allocator reads — routes /health and /fleet/heartbeat. */
  readonly registry: RoomRegistry;
  readonly router: Router;
  /** Epoch-ms clock; every request reads it once and passes it down (clockless core). */
  readonly now: () => number;
  /**
   * The allocator↔Machine shared key (M10). When set, the fleet write routes
   * (`/register`, `/fleet/heartbeat`, `/deregister`) demand a valid `X-Fleet-Auth`
   * proof over the request body and **fail closed** without one. Unset — a test
   * harness that drives the registry directly, never a prod deployment — leaves
   * those routes open, exactly as `MatchServer`'s ticket enforcement keys off the
   * *presence* of its secret.
   */
  readonly secret?: string;
  /**
   * Browser origins the CORS layer grants beyond same-origin and localhost dev.
   * A request whose `Origin` is one of these (or any localhost/127.0.0.1 origin)
   * gets it echoed in `Access-Control-Allow-Origin`; anything else gets no grant
   * and the browser blocks it. Omitted → localhost dev only.
   */
  readonly allowOrigins?: readonly string[];
}

/** A dev origin is any localhost/127.0.0.1 on any port, over plain http — the
 *  shape `vite dev` and a local preview serve the game from. */
const LOCALHOST_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

/** The preflight answer's fixed part: the verbs and request headers the client
 *  routes accept. `content-type` is the only non-simple header a browser sends
 *  (on `POST /rooms`); the fleet routes carry `x-fleet-auth` but are server-to-
 *  server on the private network and never preflight, so it need not be listed. */
const PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/** A route's answer before it is written to the socket. */
interface RouteResult {
  readonly status: number;
  /** Extra headers (the Router's `fly-replay` lands here). */
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON-serialisable body, or `undefined` for an empty response (e.g. 204). */
  readonly body?: unknown;
}

const JOIN_PATH = /^\/rooms\/([^/]+)\/join$/;
const ROOM_PATH = /^\/rooms\/([^/]+)$/;

/**
 * Build the allocator's `http.Server` without listening. Reads each request's
 * body, routes it, and writes the result. Kept separate from the bootstrap so a
 * test can drive it over an ephemeral port and so importing this module binds no
 * socket.
 */
export function createAllocatorServer(deps: AllocatorServerDeps): Server {
  const startedAt = deps.now();
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    readBody(request)
      .then((raw) => {
        const result = route(deps, request, raw, startedAt);
        // CORS is decided from the request's Origin and merged onto every
        // response — the empty preflight, an error, a 204 heartbeat ack, and the
        // room decision alike — so a browser sees the same grant whatever it asked.
        const cors = corsHeaders(firstHeader(request.headers['origin']), deps.allowOrigins ?? []);
        if (result.body === undefined) {
          // No content-type on an empty body — but the CORS grant and any route
          // headers (the preflight verbs) still have to ride out.
          response.writeHead(result.status, { ...cors, ...(result.headers ?? {}) });
          response.end();
          return;
        }
        const headers = { 'content-type': 'application/json', ...cors, ...(result.headers ?? {}) };
        response.writeHead(result.status, headers);
        response.end(JSON.stringify(result.body));
      })
      .catch(() => {
        // A body that never finished arriving, or a writer that already closed:
        // fail closed, never leave the socket hanging.
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'internal' }));
      });
  });
}

/** Dispatch one request to its route. Pure over its inputs and the injected clock. */
function route(
  deps: AllocatorServerDeps,
  request: IncomingMessage,
  raw: string,
  startedAt: number,
): RouteResult {
  const method = request.method ?? 'GET';
  // Parse against a dummy base so the query string is stripped from the path.
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const now = deps.now();

  // CORS preflight: a browser asks "may I POST here?" before the real request.
  // Answer any OPTIONS with the allowed verbs and hang up (204); the wrapper adds
  // the origin grant. This is the fix for the 405 a preflight used to hit.
  if (method === 'OPTIONS') {
    return { status: 204, headers: PREFLIGHT_HEADERS };
  }

  if (pathname === '/health') {
    return method === 'GET' ? health(deps, now, startedAt) : methodNotAllowed();
  }
  if (pathname === '/machines') {
    return method === 'GET' ? machinesRoute(deps, now) : methodNotAllowed();
  }
  if (pathname === '/regions') {
    return method === 'GET'
      ? { status: 200, body: { regions: deps.allocator.regions(now) } }
      : methodNotAllowed();
  }
  if (pathname === '/register') {
    return method === 'POST' ? registerRoute(deps, request, raw, now) : methodNotAllowed();
  }
  if (pathname === '/deregister') {
    return method === 'POST' ? deregisterRoute(deps, request, raw) : methodNotAllowed();
  }
  if (pathname === '/fleet/heartbeat') {
    return method === 'POST' ? heartbeatRoute(deps, request, raw, now) : methodNotAllowed();
  }
  if (pathname === '/rooms') {
    return method === 'POST' ? allocateRoute(deps, raw, now) : methodNotAllowed();
  }
  const joinMatch = JOIN_PATH.exec(pathname);
  if (joinMatch) {
    return method === 'POST'
      ? joinRoute(deps, decodeURIComponent(joinMatch[1] ?? ''), now)
      : methodNotAllowed();
  }
  const roomMatch = ROOM_PATH.exec(pathname);
  if (roomMatch) {
    return method === 'GET'
      ? roomInfoRoute(deps, decodeURIComponent(roomMatch[1] ?? ''), now)
      : methodNotAllowed();
  }
  return { status: 404, body: { error: 'not-found' } };
}

/** Liveness plus the fleet occupancy an operator (or a load balancer) reads. */
function health(deps: AllocatorServerDeps, now: number, startedAt: number): RouteResult {
  const machines = deps.registry.machines(now);
  const rooms = machines.reduce((sum, m) => sum + m.rooms.length, 0);
  return {
    status: 200,
    body: {
      status: 'ok',
      machines: machines.length,
      rooms,
      reservations: deps.registry.reservations(now).length,
      uptimeSeconds: Math.round((now - startedAt) / 1000),
    },
  };
}

/** The live fleet, listed — the operator's (and the deploy health check's) answer
 *  to "did the Machines register?" (M10). Plain read, no auth, like `/health`. */
function machinesRoute(deps: AllocatorServerDeps, now: number): RouteResult {
  const fleet = deps.registry.machines(now);
  return {
    status: 200,
    body: {
      machines: fleet.map((m) => ({
        machine: m.machine,
        region: m.region,
        capacity: m.capacity,
        rooms: m.rooms.length,
        lastSeen: m.lastSeen,
      })),
    },
  };
}

/**
 * A Machine announcing itself on boot (M10). Authenticated and fail-closed. A
 * registration *is* a heartbeat with no rooms yet — seeding the Machine into the
 * registry the instant it boots, so `/machines` lists it and `allocate` can place
 * on it before its first 5 s heartbeat lands. Its rooms and load arrive on the
 * beats that follow.
 */
function registerRoute(
  deps: AllocatorServerDeps,
  request: IncomingMessage,
  raw: string,
  now: number,
): RouteResult {
  const denied = fleetAuthFailure(deps, request, raw);
  if (denied !== null) return denied;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'bad-json' } };
  }
  if (!isRegistration(parsed)) return { status: 400, body: { error: 'bad-registration' } };
  deps.registry.observe(
    { machine: parsed.machine, region: parsed.region, capacity: parsed.capacity, rooms: [] },
    now,
  );
  return { status: 204 };
}

/**
 * A Machine leaving the fleet at once (M10). Authenticated and fail-closed. The
 * graceful counterpart to liveness expiry: a Machine shutting down deregisters so
 * the allocator stops routing to it immediately rather than ~15 s later when its
 * last beat lapses. The drain contract (server/README.md) still holds — a Machine
 * cordons and empties its rooms *first*, and only deregisters as it exits, so no
 * live match is stranded.
 */
function deregisterRoute(
  deps: AllocatorServerDeps,
  request: IncomingMessage,
  raw: string,
): RouteResult {
  const denied = fleetAuthFailure(deps, request, raw);
  if (denied !== null) return denied;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'bad-json' } };
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as Record<string, unknown>)['machine'] !== 'string') {
    return { status: 400, body: { error: 'bad-deregister' } };
  }
  deps.registry.remove((parsed as { machine: string }).machine);
  return { status: 204 };
}

/** Ingest a Machine's heartbeat: the registry learns/refreshes it. 204 on success.
 *  Authenticated and fail-closed (M10) — a heartbeat is a write to who-hosts-what. */
function heartbeatRoute(
  deps: AllocatorServerDeps,
  request: IncomingMessage,
  raw: string,
  now: number,
): RouteResult {
  const denied = fleetAuthFailure(deps, request, raw);
  if (denied !== null) return denied;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'bad-json' } };
  }
  if (!isHeartbeat(parsed)) return { status: 400, body: { error: 'bad-heartbeat' } };
  deps.registry.observe(parsed, now);
  return { status: 204 };
}

/**
 * The gate on a fleet write route (M10). With the allocator holding a secret, the
 * request must carry a valid `X-Fleet-Auth` HMAC over its exact body; a missing,
 * malformed, or wrong proof is a 401. Without a secret — a test harness that never
 * runs in prod — the gate is open. Returns a 401 {@link RouteResult} to
 * short-circuit the route, or `null` to let it proceed. Fail-closed by shape: the
 * caller must act on a non-null return.
 */
function fleetAuthFailure(
  deps: AllocatorServerDeps,
  request: IncomingMessage,
  raw: string,
): RouteResult | null {
  if (deps.secret === undefined) return null;
  const signature = firstHeader(request.headers[FLEET_AUTH_HEADER]);
  if (!verifyFleetRequest(raw, signature, deps.secret)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  return null;
}

/** The CORS grant for one request's Origin, or `{}` when the origin is not
 *  allowed (the browser then blocks it). `Vary: Origin` keeps a shared cache from
 *  serving one origin's grant to another. */
function corsHeaders(
  origin: string | undefined,
  allow: readonly string[],
): Readonly<Record<string, string>> {
  if (origin !== undefined && originAllowed(origin, allow)) {
    return { 'access-control-allow-origin': origin, vary: 'Origin' };
  }
  return {};
}

/** Whether a browser Origin may call the client routes: any localhost dev origin,
 *  or one the deployment allow-listed (the GitHub Pages origin). */
function originAllowed(origin: string, allow: readonly string[]): boolean {
  if (LOCALHOST_ORIGIN.test(origin)) return true;
  return allow.includes(origin);
}

/** The first value of a header Node may hand back as an array (it never does for
 *  `origin`; the guard is for the general shape). */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Allocate a new room; 201 with the signed decision, 503 when the fleet is full.
 *  The optional JSON body carries the room's requested shape: `region` (a routing
 *  preference), and `size`/`mode` (the match config, variable-slots Task C1). Each
 *  field is only honoured when well-typed; a malformed one is ignored, never a
 *  400, so a client on an old shape still allocates a default room. */
function allocateRoute(deps: AllocatorServerDeps, raw: string, now: number): RouteResult {
  const opts: { region?: string; size?: number; mode?: string } = {};
  if (raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: 'bad-json' } };
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const body = parsed as Record<string, unknown>;
      if (typeof body['region'] === 'string') opts.region = body['region'];
      if (typeof body['size'] === 'number') opts.size = body['size'];
      if (typeof body['mode'] === 'string') opts.mode = body['mode'];
    }
  }
  try {
    return decided(deps, deps.allocator.allocate(opts, now), 201);
  } catch (e) {
    return errorResult(e);
  }
}

/** Reach an existing room; 200 with a ticket, 404 when no live Machine hosts it. */
function joinRoute(deps: AllocatorServerDeps, code: string, now: number): RouteResult {
  try {
    return decided(deps, deps.allocator.join(code, now), 200);
  } catch (e) {
    return errorResult(e);
  }
}

/**
 * Read a room's advertised config *before* joining it (variable-slots Task C3):
 * 200 with `{code, machine, region, size?, mode?, joinableSeats?, joinable}`, or
 * 404 when no live Machine hosts or has reserved the code. This is the read a
 * lobby makes to show a room's shape and to refuse an incompatible or full one
 * without ever opening a socket to the Machine — advertisement, not a booking, so
 * it mints no ticket and reserves nothing.
 */
function roomInfoRoute(deps: AllocatorServerDeps, code: string, now: number): RouteResult {
  const info = deps.allocator.roomInfo(code, now);
  if (info === null) return { status: 404, body: { error: 'not-found' } };
  return { status: 200, body: info };
}

/**
 * Turn an {@link Allocation} into a response, taking the Router's `connectUrl` —
 * and *only* that. The Router's `fly-replay` header is deliberately NOT merged
 * here: on the Fly edge a `fly-replay` on a JSON response makes the edge REPLAY
 * the POST at the gameserver, so the client never receives its `{room, ticket}`
 * and the menu reports "can't reach the servers" (the live CREATE ROOM failure).
 * The machine-pin lives on the SOCKET hop instead (server/ws upgrade): the client
 * dials `connectUrl` — the gameserver app's shared endpoint on Fly — and a WS
 * upgrade landing on the wrong machine is replayed to the room's host there.
 */
function decided(
  deps: AllocatorServerDeps,
  allocation: ReturnType<Allocator['allocate']>,
  status: number,
): RouteResult {
  const instr = deps.router.routeTo({ machine: allocation.machine, region: allocation.region });
  return {
    status,
    body: {
      room: allocation.room,
      machine: allocation.machine,
      region: allocation.region,
      ticket: allocation.ticket,
      expiresAt: allocation.expiresAt,
      connectUrl: instr.connectUrl,
    },
  };
}

/** Map an {@link AllocatorError} to its status; anything else re-throws. */
function errorResult(e: unknown): RouteResult {
  if (e instanceof AllocatorError) {
    // no-capacity → 503 (full, retry / scale up); not-found → 404 (room is gone).
    const status = e.reason === 'no-capacity' ? 503 : 404;
    return { status, body: { error: e.reason } };
  }
  throw e;
}

function methodNotAllowed(): RouteResult {
  return { status: 405, body: { error: 'method-not-allowed' } };
}

/** Structural guard on a registration parsed from an untrusted POST body (M10):
 *  the identity and capacity a Machine announces on boot, no room list yet. */
function isRegistration(
  value: unknown,
): value is { machine: string; region: string; capacity: number } {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['machine'] === 'string' &&
    typeof r['region'] === 'string' &&
    typeof r['capacity'] === 'number' &&
    Number.isFinite(r['capacity'])
  );
}

/** Structural guard on a heartbeat parsed from an untrusted POST body. */
function isHeartbeat(value: unknown): value is Heartbeat {
  if (typeof value !== 'object' || value === null) return false;
  const h = value as Record<string, unknown>;
  if (typeof h['machine'] !== 'string') return false;
  if (typeof h['region'] !== 'string') return false;
  if (typeof h['capacity'] !== 'number' || !Number.isFinite(h['capacity'])) return false;
  if (!Array.isArray(h['rooms'])) return false;
  return h['rooms'].every((room) => {
    if (typeof room !== 'object' || room === null) return false;
    const r = room as Record<string, unknown>;
    if (typeof r['code'] !== 'string' || typeof r['players'] !== 'number') return false;
    // The advertised config is optional (an old Machine omits it) but must be
    // well-typed when present, so a malformed field never reaches an advertisement
    // (variable-slots Task C3).
    if (r['size'] !== undefined && typeof r['size'] !== 'number') return false;
    if (r['mode'] !== undefined && typeof r['mode'] !== 'string') return false;
    if (r['joinableSeats'] !== undefined && typeof r['joinableSeats'] !== 'number') return false;
    return true;
  });
}

/** Read a request body to a string, bounded so a runaway sender cannot exhaust us. */
function readBody(request: IncomingMessage): Promise<string> {
  const LIMIT = 64 * 1024; // a heartbeat is tiny; anything this big is a mistake
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMIT) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Bootstrap — runs only when this module is the process entry.
// ---------------------------------------------------------------------------

/**
 * Choose the machine provider: the real Fly adapter when a token and app are
 * present, else the in-memory fake so offline dev needs no cloud account. The
 * fake never provisions anything real — a fleet controller pointed at it simply
 * scales an imaginary fleet, which is all a laptop run needs.
 */
function providerFromEnv(): MachineProvider {
  const env = process.env;
  if (env['FLY_API_TOKEN'] && env['FLY_APP']) {
    return new FlyMachineProvider({ appName: env['FLY_APP'], token: env['FLY_API_TOKEN'] });
  }
  return new InMemoryMachineProvider();
}

/**
 * Build the fleet controller from the environment. It is always constructed (so
 * its cordon can be wired into the allocator), but only *acts* when
 * `FLEET_AUTOSCALE=on` — the honest off-by-default setting.
 */
function fleetControllerFromEnv(provider: MachineProvider, registry: RoomRegistry): FleetController {
  const env = process.env;
  return new FleetController({
    provider,
    registry,
    enabled: (env['FLEET_AUTOSCALE'] ?? 'off') === 'on',
    region: env['FLEET_REGION'] ?? env['FLY_REGION'] ?? 'iad',
    image: env['FLEET_IMAGE'] ?? 'planet-rush:latest',
  });
}

/** Choose the Router from the environment: Fly at the edge, direct everywhere else. */
function routerFromEnv(): Router {
  const env = process.env;
  if ((env['ALLOCATOR_ROUTER'] ?? 'direct') === 'fly') {
    const config: { selfRegion?: string; appName?: string; connectUrl?: string } = {
      // The gameserver app's shared socket endpoint the client dials; the SOCKET
      // hop replays a wrong-machine upgrade to the room's host from there. The
      // JSON response carries this URL, never a fly-replay header (see `decided`).
      connectUrl: env['MATCH_CONNECT_URL'] ?? 'wss://planet-rush-gameserver.fly.dev/play',
    };
    if (env['FLY_REGION']) config.selfRegion = env['FLY_REGION'];
    if (env['MATCH_APP']) config.appName = env['MATCH_APP'];
    return new FlyReplayRouter(config);
  }
  const template = env['MATCH_URL_TEMPLATE'] ?? 'ws://{machine}:8080/';
  return new DirectRouter((machine) => template.replace('{machine}', machine));
}

/** Build the process's dependencies from the environment and start listening. */
function main(): void {
  const env = process.env;
  const port = Number(env['PORT'] ?? 8080);
  const host = env['HOST'] ?? '0.0.0.0';
  const secret = env['ALLOCATOR_SECRET'] ?? 'dev-insecure-allocator-secret';
  if (!env['ALLOCATOR_SECRET']) {
    console.warn('[planet-rush] ALLOCATOR_SECRET unset — using an insecure dev key');
  }
  const seed = env['ALLOCATOR_SEED']
    ? Number(env['ALLOCATOR_SEED']) >>> 0
    : randomBytes(4).readUInt32LE(0);

  const registry = new InMemoryRoomRegistry();
  // The fleet controller is built first so its cordon can gate placement: a
  // draining Machine is excluded from new rooms the instant it is cordoned.
  const provider = providerFromEnv();
  const fleet = fleetControllerFromEnv(provider, registry);
  const allocator = new Allocator({
    registry,
    rng: mulberry32(seed),
    secret,
    excludeMachine: (machine) => fleet.isCordoned(machine),
  });
  // Browser origins the CORS layer permits, beyond localhost dev: the GitHub Pages
  // origin by default, overridable/extendable via ALLOW_ORIGINS (comma-separated).
  const allowOrigins = (env['ALLOW_ORIGINS'] ?? 'https://imaginethegames.github.io')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const server = createAllocatorServer({
    allocator,
    registry,
    router: routerFromEnv(),
    now: Date.now,
    // The same secret that signs tickets authenticates the fleet write routes, so
    // enforcement is on whenever the allocator has a key (it always does in prod).
    secret,
    allowOrigins,
  });

  // The autoscale loop. It ships OFF (FleetController.enabled is false unless
  // FLEET_AUTOSCALE=on), so this timer fires a no-op reconcile by default and
  // arming it is purely a config change. The primary scale-up signal — per-Machine
  // event-loop lag — is not yet reported over the heartbeat, so until that lands
  // the armed loop scales on the free-slot floor alone; that limit is stated,
  // not hidden. `loopLagMs: 0` is the honest placeholder for the missing signal.
  const interval = Number(env['FLEET_INTERVAL_MS'] ?? 15_000);
  const fleetSignal: FleetSignal = { loopLagMs: 0 };
  const reconcile = setInterval(() => {
    fleet.reconcile(fleetSignal, Date.now()).catch((e: unknown) => {
      console.error('[planet-rush] fleet reconcile failed', e);
    });
  }, interval);
  reconcile.unref(); // never hold the process open on the autoscale timer alone

  server.listen(port, host, () => {
    console.log(
      `[planet-rush] allocator listening on ${host}:${port} (seed ${seed}) ` +
        `autoscale=${(env['FLEET_AUTOSCALE'] ?? 'off') === 'on' ? 'on' : 'off'}`,
    );
  });

  /** Docker sends SIGTERM; a terminal sends SIGINT. Both stop the listener and exit. */
  const shutdown = (signal: string): void => {
    console.log(`[planet-rush] ${signal} — shutting down`);
    clearInterval(reconcile);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start only when run as the entry point — importing this module (a test does)
// binds no socket. Mirrors how `node allocator.mjs` is the container's PID 1.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

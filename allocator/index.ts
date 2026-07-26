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
 *   GET  /regions          per-region capacity, for a client's region picker
 *   POST /fleet/heartbeat  a Machine reports its rooms (the registry learns the fleet)
 *   POST /rooms            allocate a NEW room  → 201 + signed ticket
 *   POST /rooms/:code/join reach an EXISTING room → 200 + signed ticket, 404 if gone
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
 *   MATCH_URL_TEMPLATE  direct connect URL, '{machine}' expanded (default ws://{machine}:8080/)
 */

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { mulberry32 } from '@shared/types';
import { Allocator, AllocatorError } from './allocator';
import { InMemoryRoomRegistry, type Heartbeat, type RoomRegistry } from './registry';
import { DirectRouter, FlyReplayRouter, type Router } from './router';

/** What the process wires together; injected so the server is testable. */
export interface AllocatorServerDeps {
  readonly allocator: Allocator;
  /** The same registry the allocator reads — routes /health and /fleet/heartbeat. */
  readonly registry: RoomRegistry;
  readonly router: Router;
  /** Epoch-ms clock; every request reads it once and passes it down (clockless core). */
  readonly now: () => number;
}

/** A route's answer before it is written to the socket. */
interface RouteResult {
  readonly status: number;
  /** Extra headers (the Router's `fly-replay` lands here). */
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON-serialisable body, or `undefined` for an empty response (e.g. 204). */
  readonly body?: unknown;
}

const JOIN_PATH = /^\/rooms\/([^/]+)\/join$/;

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
        const headers = { 'content-type': 'application/json', ...(result.headers ?? {}) };
        if (result.body === undefined) {
          // No content-type on an empty body — nothing to describe.
          response.writeHead(result.status);
          response.end();
          return;
        }
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

  if (pathname === '/health') {
    return method === 'GET' ? health(deps, now, startedAt) : methodNotAllowed();
  }
  if (pathname === '/regions') {
    return method === 'GET'
      ? { status: 200, body: { regions: deps.allocator.regions(now) } }
      : methodNotAllowed();
  }
  if (pathname === '/fleet/heartbeat') {
    return method === 'POST' ? heartbeatRoute(deps, raw, now) : methodNotAllowed();
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

/** Ingest a Machine's heartbeat: the registry learns/refreshes it. 204 on success. */
function heartbeatRoute(deps: AllocatorServerDeps, raw: string, now: number): RouteResult {
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

/** Allocate a new room; 201 with the signed decision, 503 when the fleet is full. */
function allocateRoute(deps: AllocatorServerDeps, raw: string, now: number): RouteResult {
  let region: string | undefined;
  if (raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: 'bad-json' } };
    }
    if (typeof parsed === 'object' && parsed !== null && 'region' in parsed) {
      const r = (parsed as { region: unknown }).region;
      if (typeof r === 'string') region = r;
    }
  }
  try {
    const allocation = deps.allocator.allocate(region === undefined ? {} : { region }, now);
    return decided(deps, allocation, 201);
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

/** Turn an {@link Allocation} into a response, folding in the Router's instruction. */
function decided(
  deps: AllocatorServerDeps,
  allocation: ReturnType<Allocator['allocate']>,
  status: number,
): RouteResult {
  const instr = deps.router.routeTo({ machine: allocation.machine, region: allocation.region });
  return {
    status,
    headers: instr.headers,
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
    return typeof r['code'] === 'string' && typeof r['players'] === 'number';
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

/** Choose the Router from the environment: Fly at the edge, direct everywhere else. */
function routerFromEnv(): Router {
  const env = process.env;
  if ((env['ALLOCATOR_ROUTER'] ?? 'direct') === 'fly') {
    const config: { selfRegion?: string; appName?: string } = {};
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
  const allocator = new Allocator({ registry, rng: mulberry32(seed), secret });
  const server = createAllocatorServer({ allocator, registry, router: routerFromEnv(), now: Date.now });

  server.listen(port, host, () => {
    console.log(`[planet-rush] allocator listening on ${host}:${port} (seed ${seed})`);
  });

  /** Docker sends SIGTERM; a terminal sends SIGINT. Both stop the listener and exit. */
  const shutdown = (signal: string): void => {
    console.log(`[planet-rush] ${signal} — shutting down`);
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

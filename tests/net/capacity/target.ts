/**
 * tests/net/capacity/target.ts — what the ramp is pointed at. OWNER: Netcode
 * Engineer (m11 server stress; GDD §4.2).
 *
 * A capacity run has to work against three things without the ramp knowing which:
 *
 *  • **a fleet through its allocator** — the production door. `POST /rooms` picks
 *    a Machine, mints a code and signs a ticket, and the ramp dials the
 *    `connectUrl` it is handed. This is the only mode that measures what a player
 *    actually meets, and it is what the throwaway-Fly run uses;
 *  • **one Machine, dialled directly** — `--direct ws(s)://host/play`, for a
 *    server standing alone. There is no allocator to sign a ticket, so this mode
 *    only works against a process with no `TICKET_SECRET` (`server/match-server.ts`
 *    admits every join then, deliberately: a single Machine has no routing
 *    decision to sign). Against an enforcing Machine it will be refused
 *    `bad-ticket`, loudly, on the first room;
 *  • **a locally spawned process** — `./local-target.ts`, which is the direct mode
 *    with the process management attached.
 *
 * `/health` is read over plain HTTP and never over the socket: it must answer
 * while the loop is late, which is exactly when a WebSocket round trip would not.
 */

import { allocateRoom } from '../../../src/net/allocator-client';
import type { FetchLike } from '../../../src/net/allocator-client';
import { CODE_ALPHABET, CODE_LENGTH } from '../../../src/net/room-code';

/** Where a synthetic match should dial, and what it must present to be let in. */
export interface RoomPlacement {
  /** The `ws(s)://…/play` endpoint, query included. */
  readonly url: string;
  readonly room: string;
  /** The allocator's signed routing decision, absent in direct mode. */
  readonly ticket?: string;
  /** The Machine the allocator placed this room on, when it said. */
  readonly machine?: string;
}

/** One `/health` reading, as `server/index.ts` publishes it. */
export interface HealthReading {
  /** Wall-clock the reading was taken (harness side), epoch ms. */
  readonly at: number;
  readonly rooms: number;
  readonly capacity: number;
  /** p99 event-loop lag over the server's 128 s window, ms — the ramp's headline
   *  and the number the 10 ms safety line is drawn on. */
  readonly loopLagMs: number;
  /** Cumulative process CPU, ms. Differenced across a window it gives the
   *  server's true CPU draw, which is what a shared-vCPU quota throttles on. */
  readonly cpuMs: number | null;
  readonly rssMb: number | null;
  readonly machine: string;
  readonly draining: boolean;
  readonly uptimeSeconds: number;
}

/** Everything the ramp needs from whatever it is measuring. */
export interface CapacityTarget {
  /** For the report header: "allocator https://…" or "direct wss://…". */
  readonly label: string;
  /** Open one room and return where to dial it. */
  place(): Promise<RoomPlacement>;
  /** Read the Machine's `/health`. */
  health(): Promise<HealthReading>;
  /** Release anything this target owns (a spawned process); a no-op remotely. */
  stop(): Promise<void>;
}

/** How a target is described on the command line. */
export interface TargetOptions {
  /** Allocator base URL — the production door. */
  readonly allocator?: string;
  /** One Machine's `ws(s)://…/play`, when there is no allocator. */
  readonly direct?: string;
  /** Where `/health` lives. Required with `--direct`; with `--allocator` it is
   *  the Machine's own health URL, which the allocator does not hand out. */
  readonly health?: string;
  /** Preferred region on allocate (a hint; the allocator may place elsewhere). */
  readonly region?: string;
}

/** Node's global `fetch`, narrowed to the seam `allocator-client` declares. */
const nodeFetch: FetchLike = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;

/** Read a number off an untyped JSON body, or `null` when it is not there. A
 *  server one deploy behind has no `cpuMs`, and that is a missing column in the
 *  report — never a crash, and never a zero pretending to be a measurement. */
function num(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** GET `/health` and shape it. Throws on a non-200 — a ramp that cannot read the
 *  loop lag has nothing to report, and guessing is worse than stopping. */
export async function readHealth(healthUrl: string): Promise<HealthReading> {
  const response = await fetch(healthUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${healthUrl} → ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return {
    at: Date.now(),
    rooms: num(body, 'rooms') ?? 0,
    capacity: num(body, 'capacity') ?? 0,
    loopLagMs: num(body, 'loopLagMs') ?? 0,
    cpuMs: num(body, 'cpuMs'),
    rssMb: num(body, 'rssMb'),
    machine: typeof body['machine'] === 'string' ? body['machine'] : '',
    draining: body['draining'] === true,
    uptimeSeconds: num(body, 'uptimeSeconds') ?? 0,
  };
}

/**
 * A room code minted **client-side**, for direct mode only. The server creates a
 * room the first time it sees an unknown code (`server/match-server.ts`), so in
 * the absence of an allocator this is how a room comes into being. It draws from
 * `node:crypto` rather than the sim's seeded RNG on purpose: two harness
 * processes ramping the same Machine must not collide on the same codes, and
 * nothing about a load run needs to be reproducible in its room names.
 */
function localRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)] ?? 'A';
  }
  return code;
}

/** Build the target `options` describes. Throws when the description is not
 *  usable — a run that starts against a half-configured target wastes the
 *  twenty minutes it takes to find out. */
export function makeTarget(options: TargetOptions): CapacityTarget {
  if (options.allocator) {
    const base = options.allocator.replace(/\/+$/, '');
    // The allocator does not publish the Machine's health URL (it is 6PN-internal
    // in production), so a run must be told where to read the loop lag.
    const healthUrl = options.health;
    if (!healthUrl) {
      throw new Error('--allocator needs --health <url of the Machine’s /health>');
    }
    return {
      label: `allocator ${base}`,
      place: async (): Promise<RoomPlacement> => {
        const result = await allocateRoom(
          { baseUrl: base, fetch: nodeFetch },
          {
            // Eight seats, free-for-all: the worst case the fleet advertises, and
            // the one the room ceiling is set against (GDD §2.1).
            size: 8,
            mode: 'ffa',
            ...(options.region !== undefined ? { region: options.region } : {}),
          },
        );
        if (!result.ok) throw new Error(`allocate refused: ${result.reason}`);
        const { url, room, ticket, machine } = result.connection;
        return { url, room, ticket, ...(machine ? { machine } : {}) };
      },
      health: () => readHealth(healthUrl),
      stop: async (): Promise<void> => {},
    };
  }

  const direct = options.direct;
  if (!direct) throw new Error('a target needs either --allocator <url> or --direct <ws url>');
  const healthUrl = options.health ?? deriveHealthUrl(direct);
  return {
    label: `direct ${direct}`,
    place: async (): Promise<RoomPlacement> => ({
      url: direct,
      room: localRoomCode(Math.random),
    }),
    health: () => readHealth(healthUrl),
    stop: async (): Promise<void> => {},
  };
}

/** `ws://host:port/play` → `http://host:port/health`. A convenience for the
 *  local and direct paths, where the two are always the same listener. */
export function deriveHealthUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = '/health';
  parsed.search = '';
  return parsed.toString();
}

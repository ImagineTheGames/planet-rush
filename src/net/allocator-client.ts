/**
 * src/net/allocator-client.ts — the client half of the allocator. OWNER: Netcode
 * Engineer (GDD §4.2; M9 hosting, Task 9).
 *
 * The moment there is more than one Machine, "which one hosts this room?" stops
 * being obvious. The allocator answers it (`allocator/`); this file is the one
 * HTTP round trip a client makes *before* it opens a socket, turning a room code
 * into three things the socket layer needs: **where** to dial (`url`), **what**
 * room it landed in (`room` — minted server-side for a new match), and the signed
 * **ticket** that proves to the Machine the allocator sent it here (`ticket.ts`).
 *
 * **The direct-connect path must survive untouched.** Local development, the solo
 * `LocalLoopback`, the single self-hosted server — none of them has an allocator,
 * and none of them should learn one exists. That gate is {@link allocatorUrlFromEnv}:
 * with `VITE_ALLOCATOR_URL` unset it returns `null`, the caller connects straight
 * to its configured URL, and this whole module is never entered. The allocator is
 * strictly *additive* — a fleet's front door, not a new dependency for everyone.
 *
 * **Out of the gameplay path, still.** This is a request/response and a hang-up:
 * the client gets its ticket and URL and talks to the Machine directly forever
 * after (or, on Fly, to the edge that replays to it — `allocator/router.ts`). If
 * the allocator vanished the instant after answering, every live match — and this
 * one, once its socket is open — carries on.
 *
 * **`fetch` is injected** (defaulting to the platform global), so the round trip
 * is a fixture in a test and this file, like everything below it, reads no clock
 * and needs no network to be exercised.
 */

import type { MachineId } from './ticket';
import type { RoomLiveness } from './reconnect';
import type { RoomCode } from './transport';

// ---------------------------------------------------------------------------
// The fetch seam — the smallest slice of `fetch`/`Response` this module uses.
// ---------------------------------------------------------------------------

/** The one request field this client sets beyond the URL. */
export interface FetchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Just enough of `Response` to read a status and a JSON body. */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The shape of `fetch` this module needs; the platform's global satisfies it. */
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Where the allocator is, and how to reach it. */
export interface AllocatorClientConfig {
  /** The allocator's base URL, e.g. `https://alloc.example.com` (no trailing slash;
   *  {@link allocatorUrlFromEnv} strips one). */
  readonly baseUrl: string;
  /** Injected `fetch`; defaults to the platform global. Tests pass a fake. */
  readonly fetch?: FetchLike;
}

/** The subset of Vite's `import.meta.env` this module reads. */
export interface AllocatorEnv {
  readonly VITE_ALLOCATOR_URL?: string;
}

/**
 * The base URL of the allocator, or `null` when there isn't one. `null` is the
 * signal to *skip this module entirely* and connect directly — local dev, solo
 * play, and any single self-hosted server run this way, and must keep running
 * this way. A present-but-blank value counts as unset; a trailing slash is
 * stripped so `${base}/rooms/...` never doubles up.
 */
export function allocatorUrlFromEnv(
  env: AllocatorEnv = import.meta.env as unknown as AllocatorEnv,
): string | null {
  const raw = env.VITE_ALLOCATOR_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// The resolved connection, and the ways resolving can fail
// ---------------------------------------------------------------------------

/**
 * Why the allocator chose the Machine it chose, as it came back on an allocate
 * (`allocator/allocator.ts` `Placement`). Nothing routes on this — it exists so
 * the decision is *explainable* from the player's side too: `detail` is the line
 * that lands in the session log, so a "why am I on a US server?" report answers
 * itself in the paste (`gru — your region`, `iad — gru full`).
 *
 * A join carries none (it places nothing), and an allocator that predates this
 * field sends none, so it is optional the whole way down.
 */
export interface ConnectionPlacement {
  /** The region asked for — client-named or edge-inferred — when there was one. */
  readonly requested?: string;
  /** The region the room actually landed in. */
  readonly region: string;
  /** The rule that decided it: `preferred` | `region-full` | `region-absent` |
   *  `no-preference`. A bare string here — the allocator owns the union, and a
   *  client that has not been redeployed must not choke on a new member. */
  readonly reason: string;
  /** The one human line: `gru — your region`. */
  readonly detail: string;
}

/** Everything the socket layer needs, extracted from the allocator's decision. */
export interface ResolvedConnection {
  /** The `ws(s)://` endpoint to open a {@link WebSocketTransport} against. */
  readonly url: string;
  /** The room to join — for an allocate this is the freshly minted code. */
  readonly room: RoomCode;
  /** The signed ticket to present as `JoinMessage.ticket` (`./ticket`). */
  readonly ticket: string;
  /** The Machine the room lives on (informational; the ticket binds it). */
  readonly machine: MachineId;
  /** That Machine's region (a routing hint; may be `''`). */
  readonly region: string;
  /** Epoch-ms the ticket goes stale — the caller races the socket against it. */
  readonly expiresAt: number;
  /** Why this Machine, when the allocator said (allocate only — see
   *  {@link ConnectionPlacement}). Absent on a join and on an older allocator. */
  readonly placement?: ConnectionPlacement;
}

/**
 * Why a resolve did not produce a connection, each mapped from an allocator status:
 *   • `'not-found'`   — 404: no live Machine hosts the code. The room has ended.
 *   • `'no-capacity'` — 503: the fleet is full; try later or scale up.
 *   • `'bad-response'`— a 2xx whose body is not a usable allocation (missing ticket,
 *                       unreadable JSON) — the allocator answered, but not sanely.
 *   • `'network'`     — `fetch` itself threw: offline, DNS, TLS. The allocator was
 *                       never reached, which says *nothing* about the room.
 */
export type ResolveFailure = 'not-found' | 'no-capacity' | 'bad-response' | 'network';

/** A resolve either lands a connection or names why it could not. */
export type ResolveResult =
  | { readonly ok: true; readonly connection: ResolvedConnection }
  | { readonly ok: false; readonly reason: ResolveFailure };

// ---------------------------------------------------------------------------
// The two ways a client arrives, mirroring the allocator's two verbs
// ---------------------------------------------------------------------------

/** The optional shape a *new* room is created with (variable-slots Task C1). */
export interface AllocateOptions {
  /** Preferred datacentre — a hint the allocator honours if it has room there. */
  readonly region?: string;
  /** Requested match size (N, 2..8). */
  readonly size?: number;
  /** Requested match mode. */
  readonly mode?: string;
}

/**
 * Allocate a **new** room: `POST /rooms`. The allocator picks a Machine, mints a
 * globally-unique code, and signs a ticket; the resolved `room` is that new code.
 * The requested shape rides in the body and is honoured only when well-typed, so
 * an old client sending nothing still gets a default-shaped room (201).
 */
export function allocateRoom(
  config: AllocatorClientConfig,
  options: AllocateOptions = {},
): Promise<ResolveResult> {
  const body = allocateBody(options);
  return request(config, '/rooms', {
    method: 'POST',
    ...(body !== undefined ? { body } : {}),
  });
}

/**
 * Reach an **existing** room: `POST /rooms/:code/join`. The allocator locates the
 * Machine hosting `code` and signs a ticket for it (200), or answers 404 when no
 * live Machine hosts it — a room that has ended (`not-found`).
 */
export function joinRoom(config: AllocatorClientConfig, code: RoomCode): Promise<ResolveResult> {
  return request(config, `/rooms/${encodeURIComponent(code)}/join`, { method: 'POST' });
}

/**
 * Ask whether a room still exists, without minting or reserving anything: a plain
 * `GET /rooms/:code` (the allocator's advertisement read, `allocator/index.ts`).
 * This is the witness `decideReconnect` needs — the one party that can tell "my
 * connection died" from "the room died":
 *
 *   • 200 → `'live'`    — a Machine hosts (or has reserved) the code.
 *   • 404 → `'gone'`    — the room has ended; stop retrying (`reconnect.ts`).
 *   • anything else / a thrown fetch → `'unknown'` — the *allocator* is
 *     unreachable or sick, which says nothing about the room, so the caller keeps
 *     trying inside the grace window rather than abandoning a live match.
 */
export async function probeRoomLiveness(
  config: AllocatorClientConfig,
  code: RoomCode,
): Promise<RoomLiveness> {
  const doFetch = config.fetch ?? defaultFetch();
  try {
    const response = await doFetch(`${config.baseUrl}/rooms/${encodeURIComponent(code)}`);
    if (response.ok) return 'live';
    if (response.status === 404) return 'gone';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * A room's advertised shape, read *before* committing to it — the same
 * `GET /rooms/:code` {@link probeRoomLiveness} calls, keeping the body it throws
 * away (`allocator/allocator.ts` `RoomInfo`).
 *
 * The field this was added for is `region`. **A room's region is its host's, for
 * every guest** — a joiner does not get to place anything, so the creator's choice
 * is the ping profile of everyone who joins. That is worth surfacing on the JOIN
 * screen rather than discovering after the socket is open and the match is
 * running: the code is typed, the room says where it is, the player's own probe
 * says what that costs them (`./region-probe`), and only then do they commit.
 */
export interface RoomAdvert {
  readonly code: RoomCode;
  /** The Machine hosting it (informational). */
  readonly machine: string;
  /** The region the room lives in, or `''` when the allocator knows it only
   *  through a reservation — a room still booting has no Machine view yet. */
  readonly region: string;
  /** Match size (N), when advertised. */
  readonly size?: number;
  /** Match mode, when advertised. */
  readonly mode?: string;
  /** Seats a new human can still take, when advertised. */
  readonly joinableSeats?: number;
  /** Whether a join would be accepted right now. */
  readonly joinable: boolean;
}

/**
 * Read a room's advertisement, or `null` when there is nothing to read — the room
 * has ended (404), the allocator is unreachable, or the answer was unusable.
 *
 * `null` is deliberately one value for all three: this read **decides nothing**.
 * It mints no ticket, reserves no seat, and gates no join — the allocate/join
 * round trip remains the only authority on whether a player gets in, and it
 * already distinguishes those failures ({@link ResolveFailure}) with copy for each.
 * A preview that could refuse a join would be a second, weaker gate saying the
 * same thing worse.
 */
export async function readRoomAdvert(
  config: AllocatorClientConfig,
  code: RoomCode,
): Promise<RoomAdvert | null> {
  const doFetch = config.fetch ?? defaultFetch();
  let payload: unknown;
  try {
    const response = await doFetch(`${config.baseUrl}/rooms/${encodeURIComponent(code)}`);
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;
  if (typeof body['code'] !== 'string') return null;
  const size = body['size'];
  const mode = body['mode'];
  const seats = body['joinableSeats'];
  return {
    code: body['code'],
    machine: typeof body['machine'] === 'string' ? body['machine'] : '',
    region: typeof body['region'] === 'string' ? body['region'] : '',
    ...(typeof size === 'number' ? { size } : {}),
    ...(typeof mode === 'string' ? { mode } : {}),
    ...(typeof seats === 'number' ? { joinableSeats: seats } : {}),
    // Absent means "the allocator did not say", and the honest reading of silence
    // is that the room is joinable — the join itself is what decides (above).
    joinable: typeof body['joinable'] === 'boolean' ? body['joinable'] : true,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Do the round trip and turn the allocator's answer into a {@link ResolveResult}. */
async function request(
  config: AllocatorClientConfig,
  path: string,
  init: FetchInit,
): Promise<ResolveResult> {
  const doFetch = config.fetch ?? defaultFetch();
  let response: FetchResponse;
  try {
    response = await doFetch(`${config.baseUrl}${path}`, init);
  } catch {
    // fetch threw: offline, DNS, TLS. The allocator was never reached — this is a
    // network failure, never a room death, and the two must not be conflated.
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    // 404 → room gone, 503 → fleet full; any other error is a malformed answer.
    if (response.status === 404) return { ok: false, reason: 'not-found' };
    if (response.status === 503) return { ok: false, reason: 'no-capacity' };
    return { ok: false, reason: 'bad-response' };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'bad-response' };
  }
  const connection = toConnection(config, payload);
  return connection === null
    ? { ok: false, reason: 'bad-response' }
    : { ok: true, connection };
}

/** The allocator's success body, as far as this client trusts it before checking. */
interface AllocationBody {
  room?: unknown;
  machine?: unknown;
  region?: unknown;
  ticket?: unknown;
  expiresAt?: unknown;
  connectUrl?: unknown;
  placement?: unknown;
}

/**
 * Distil an allocation body into a {@link ResolvedConnection}, or `null` when it
 * is not usable. `room` and `ticket` are load-bearing — no ticket, no join — so a
 * body missing either is rejected; `machine`/`region`/`expiresAt` are filled in
 * defensively. The socket URL is the body's `connectUrl` when the (direct) router
 * handed one back, and otherwise the allocator's own host upgraded to WebSocket —
 * the Fly case, where the edge replays the upgrade to the Machine by header.
 *
 * **Exported for `./lobby-list` and for nothing else** (a0-26): joining from a
 * browse row answers with the identical allocation body a code join does, and one
 * parser for it is the point — a second one would be the place the two paths
 * quietly drift, which is exactly what tapping a row must not do.
 */
export function connectionFromBody(
  config: AllocatorClientConfig,
  payload: unknown,
): ResolvedConnection | null {
  return toConnection(config, payload);
}

function toConnection(config: AllocatorClientConfig, payload: unknown): ResolvedConnection | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as AllocationBody;
  if (typeof body.room !== 'string' || typeof body.ticket !== 'string') return null;

  const url =
    typeof body.connectUrl === 'string' && body.connectUrl.length > 0
      ? body.connectUrl
      : wsFromHttp(config.baseUrl);

  const placement = toPlacement(body.placement);
  return {
    url,
    room: body.room,
    ticket: body.ticket,
    machine: typeof body.machine === 'string' ? body.machine : '',
    region: typeof body.region === 'string' ? body.region : '',
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : 0,
    ...(placement !== null ? { placement } : {}),
  };
}

/**
 * Read the allocator's placement reason, or `null` when it did not send a usable
 * one — a join (which places nothing), an allocator older than the field, or a
 * malformed object. Never load-bearing: a missing placement costs a log line, so
 * this drops it rather than failing a connection that is otherwise perfectly good.
 */
function toPlacement(value: unknown): ConnectionPlacement | null {
  if (typeof value !== 'object' || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p['region'] !== 'string' || typeof p['reason'] !== 'string') return null;
  return {
    ...(typeof p['requested'] === 'string' ? { requested: p['requested'] } : {}),
    region: p['region'],
    reason: p['reason'],
    // The line is what a human reads; if the allocator omitted it, say the parts
    // we do have rather than an empty string.
    detail: typeof p['detail'] === 'string' ? p['detail'] : `${p['region']} — ${p['reason']}`,
  };
}

/** Build the JSON body for an allocate, or `undefined` when nothing is requested
 *  (so an unshaped allocate sends an empty body — `allocateRoute` treats it as a
 *  default room). Only well-typed fields survive; the allocator re-validates. */
function allocateBody(options: AllocateOptions): string | undefined {
  const body: { region?: string; size?: number; mode?: string } = {};
  if (typeof options.region === 'string') body.region = options.region;
  if (typeof options.size === 'number') body.size = options.size;
  if (typeof options.mode === 'string') body.mode = options.mode;
  return Object.keys(body).length > 0 ? JSON.stringify(body) : undefined;
}

/** Turn an `http(s)://host` into the matching `ws(s)://host`, preserving TLS. A
 *  base with no recognised scheme is returned as-is — the caller passed something
 *  odd, and guessing a scheme onto it would only hide the mistake. */
function wsFromHttp(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) return `wss://${baseUrl.slice('https://'.length)}/`;
  if (baseUrl.startsWith('http://')) return `ws://${baseUrl.slice('http://'.length)}/`;
  return baseUrl;
}

/** The platform `fetch`, resolved lazily so importing this module needs no global. */
function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new Error('no fetch available; inject AllocatorClientConfig.fetch');
  return f;
}

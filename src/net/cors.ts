/**
 * src/net/cors.ts — the browser grant, in one place. OWNER: Netcode Engineer
 * (GDD §4.2; M10 CORS, n3 region picker).
 *
 * The game is served from GitHub Pages and every HTTP call it makes is therefore
 * cross-origin: the allocator's `POST /rooms`, and — since the region picker
 * measures a real round trip rather than guessing one — the match server's
 * `GET /health`. Two processes, the same rule, so the rule stops being a copy in
 * each of them and becomes this file. It lives in `src/net/` for the same reason
 * `./fleet-auth` and `./ticket` do: both server-side processes already import from
 * here, and one shared implementation is what stops the allocator and the Machine
 * from disagreeing about who may call them.
 *
 * Two rules, both deliberately narrow:
 *
 *   • **The grant is per-Origin, never `*`.** The response echoes the caller's own
 *     origin when it is allow-listed and says nothing at all when it is not (the
 *     browser then blocks the read, which is the correct outcome). `Vary: Origin`
 *     rides along so a shared cache cannot hand one origin's grant to another.
 *   • **Localhost is always allowed.** `vite dev` and a local preview serve the
 *     game from `http://localhost:<port>`, and a developer must not have to
 *     redeploy a server to test against it.
 *
 * Pure and dependency-free: strings in, headers out. No clock, no `IncomingMessage`
 * — the callers hand it Node's header bag, and a test hands it a literal.
 */

/** A dev origin is any localhost/127.0.0.1 on any port, over plain http — the
 *  shape `vite dev` and a local preview serve the game from. */
export const LOCALHOST_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

/** The origin the shipped client is served from, when a deployment names none. */
export const DEFAULT_ALLOW_ORIGIN = 'https://imaginethegames.github.io';

/** Whether a browser Origin may call these routes: any localhost dev origin, or
 *  one the deployment allow-listed (the GitHub Pages origin). */
export function originAllowed(origin: string, allow: readonly string[]): boolean {
  if (LOCALHOST_ORIGIN.test(origin)) return true;
  return allow.includes(origin);
}

/**
 * The CORS grant for one request's Origin, or `{}` when the origin is not allowed
 * (the browser then blocks it). Merged onto *every* response — the empty preflight,
 * an error, and the room decision alike — so a browser sees the same grant whatever
 * it asked for.
 */
export function corsHeaders(
  origin: string | undefined,
  allow: readonly string[],
): Readonly<Record<string, string>> {
  if (origin !== undefined && originAllowed(origin, allow)) {
    return { 'access-control-allow-origin': origin, vary: 'Origin' };
  }
  return {};
}

/** What a preflight answer may allow, when a route needs more than the default. */
export interface PreflightOptions {
  /** Verbs the route accepts. Default `GET, POST, OPTIONS`. */
  readonly methods?: string;
  /**
   * Non-simple *request* headers the client may send. Default `content-type` (the
   * only one a browser adds on `POST /rooms`). The match server's health probe adds
   * the edge's region-preference header, which is why this is a parameter at all.
   */
  readonly headers?: readonly string[];
  /** How long a browser may cache the grant, seconds. Default one day. */
  readonly maxAgeSeconds?: number;
}

/**
 * The fixed part of a preflight answer: the verbs and request headers a route
 * accepts, and how long the browser may remember them.
 *
 * The cache lifetime is load-bearing for the region probe and not just politeness:
 * a preflight is a whole extra round trip, and a measurement that paid one on every
 * sample would report the preflight's latency as the region's.
 */
export function preflightHeaders(options: PreflightOptions = {}): Readonly<Record<string, string>> {
  return {
    'access-control-allow-methods': options.methods ?? 'GET, POST, OPTIONS',
    'access-control-allow-headers': (options.headers ?? ['content-type']).join(', '),
    'access-control-max-age': String(options.maxAgeSeconds ?? 86400),
  };
}

/** The first value of a header Node may hand back as an array (it never does for
 *  `origin`; the guard is for the general shape). */
export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The allow-list a deployment configured: `ALLOW_ORIGINS`, comma-separated, or the
 * shipped client's origin when the variable is unset. Blank entries are dropped so
 * a trailing comma cannot allow-list the empty string.
 */
export function allowOriginsFromEnv(raw: string | undefined): readonly string[] {
  return (raw ?? DEFAULT_ALLOW_ORIGIN)
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

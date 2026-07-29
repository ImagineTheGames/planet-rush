/**
 * src/net/server-url.ts — where the client dials the match server. OWNER: Netcode
 * Engineer (GDD §4.2; hosting Task 12).
 *
 * The online client needs one `ws(s)://` URL to open a {@link WebSocketTransport}
 * against on the *direct-connect* path — the single self-hosted server, local dev,
 * and the deployed Fly app before the allocator is in front of it. (Once a fleet
 * has an allocator, the URL comes from its signed decision instead —
 * `./allocator-client` → `ResolvedConnection.url` — and this resolver is not
 * consulted.) This file answers "which server?" from two inputs and a fallback, in
 * strict order:
 *
 *  1. **`?server=` query override** — highest, because it exists to point a build
 *     at a different server *without rebuilding*: a QA pass against a staging
 *     Machine, a bug reproduced against a colleague's laptop, the deployed app
 *     dialled at a specific region. Testing-only in spirit, but real: it is the
 *     one knob a shipped bundle exposes.
 *  2. **`VITE_SERVER_URL` build-time default** — what a production build bakes in
 *     (the Fly app's `wss://` hostname). Absent in dev, where there is nothing to
 *     bake.
 *  3. **Same-origin fallback** — dev and the simplest self-host: talk to the host
 *     that served the page, upgraded to `ws(s)://` and pointed at `/play`. A page
 *     on `https://…` gets `wss://` for free; on `http://` (local `vite`), `ws://`.
 *
 * **Pure and injected**, like everything under `src/net/`: the query string, the
 * env, and the page origin all arrive as arguments, so a test resolves a URL with
 * no browser and this module reads no global. The browser entry point passes
 * `window.location.search`, `import.meta.env`, and `window.location.origin`.
 */

/** The path a match-server WebSocket lives at (`server/ws.ts` accepts any path;
 *  this is the one the client dials so logs and proxies see a stable route). */
export const MATCH_SERVER_PATH = '/play';

/** The query parameter that overrides the server, for testing (`?server=…`). */
export const SERVER_QUERY_PARAM = 'server';

/** The subset of Vite's `import.meta.env` this module reads. */
export interface ServerUrlEnv {
  /** The baked-in default match-server URL, e.g. `wss://planet-rush-gameserver.fly.dev`. */
  readonly VITE_SERVER_URL?: string;
}

/**
 * Resolve the match server's `ws(s)://` URL for the direct-connect path.
 *
 * @param search   `window.location.search` (`'?server=…'`), or `''`.
 * @param env      `import.meta.env`; only {@link ServerUrlEnv.VITE_SERVER_URL} is read.
 * @param origin   `window.location.origin` (`'https://host'`), used only by the
 *                 same-origin fallback. Omitted → the fallback yields `''` and the
 *                 caller must supply a URL another way (there is no page to borrow
 *                 a host from, e.g. under Node).
 */
export function resolveServerUrl(
  search: string,
  env: ServerUrlEnv = import.meta.env as unknown as ServerUrlEnv,
  origin?: string,
): string {
  const override = serverFromQuery(search);
  if (override !== null) return override;

  const baked = normalizeWsUrl(env.VITE_SERVER_URL);
  if (baked !== null) return baked;

  return originToWsUrl(origin);
}

/** The `?server=` override, normalised to a `ws(s)://` URL, or `null` when the
 *  query has no usable value. A present-but-blank param counts as unset. */
function serverFromQuery(search: string): string | null {
  // `URLSearchParams` tolerates a leading `?` or its absence, and an empty string.
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(
    SERVER_QUERY_PARAM,
  );
  return normalizeWsUrl(raw);
}

/**
 * Turn a configured value into a `ws(s)://` URL, or `null` when there is nothing
 * usable. Accepts what a human or a build reasonably writes:
 *   • `wss://host` / `ws://host`     — used as-is
 *   • `https://host` / `http://host` — upgraded to `wss://` / `ws://` (TLS kept)
 *   • `host` / `host:8080`           — bare authority, defaulted to `ws://`
 * A blank or non-string value is `null`. The default path is appended only when
 * the value carries none of its own, so `wss://host/custom` is respected.
 */
function normalizeWsUrl(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let url: string;
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) url = trimmed;
  else if (trimmed.startsWith('https://')) url = `wss://${trimmed.slice('https://'.length)}`;
  else if (trimmed.startsWith('http://')) url = `ws://${trimmed.slice('http://'.length)}`;
  else url = `ws://${trimmed}`; // a bare host:port — dev shorthand

  return withDefaultPath(url);
}

/** The same-origin dev/self-host fallback: the page's host, upgraded to WebSocket
 *  and pointed at the match-server path. Empty when there is no origin to borrow. */
function originToWsUrl(origin: string | undefined): string {
  const ws = normalizeWsUrl(origin);
  return ws ?? '';
}

/** Append {@link MATCH_SERVER_PATH} when the URL has only an authority (no path of
 *  its own), so a bare host becomes `ws://host/play` while an explicit path stands. */
function withDefaultPath(wsUrl: string): string {
  const schemeEnd = wsUrl.indexOf('://') + 3;
  const afterScheme = wsUrl.slice(schemeEnd);
  const slash = afterScheme.indexOf('/');
  if (slash < 0) return `${wsUrl}${MATCH_SERVER_PATH}`;
  // A trailing-slash-only path (`ws://host/`) is "no path": point it at /play.
  if (slash === afterScheme.length - 1) return `${wsUrl.slice(0, -1)}${MATCH_SERVER_PATH}`;
  return wsUrl;
}

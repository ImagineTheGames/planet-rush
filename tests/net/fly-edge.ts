/**
 * tests/net/fly-edge.ts — Fly's anycast edge, small enough to run in a test.
 * OWNER: Netcode Engineer (GDD §4.2; M10 machine-pin).
 *
 * The socket-hop machine-pin only *works* because something in front of the fleet
 * honours a `fly-replay` header on the upgrade response: a Machine that does not
 * host the room answers `409 + fly-replay: instance=<host>` before the 101, and
 * the edge re-delivers that same upgrade to the named Machine (`server/ws.ts`,
 * `server/upgrade-router.ts`). Off Fly there is no such thing, which is why every
 * test until now could only prove the *half* the server owns — that it emits the
 * right header — and never the round trip a player actually makes.
 *
 * This is that missing half, in about a hundred lines of `node:net`: an HTTP
 * listener that takes an upgrade, forwards it verbatim to one Machine, and — if
 * the answer is a `fly-replay` rather than a 101 — forwards it again to the
 * Machine the header names, then splices the two sockets. It implements the one
 * edge behaviour the pin depends on and nothing else; it is a test fixture, and
 * nothing in `server/` or `src/` knows it exists.
 *
 * The point of having it is determinism. On the live fleet "which Machine does
 * the edge pick?" is a coin flip, so a passing probe means *this run was lucky*
 * and a 6/6 means only that six coins landed the same way. Here the first hop is
 * chosen by the test ({@link FlyEdge.landOn}), so the wrong-Machine path — the one
 * that was answering `joinError: bad-ticket` in production — is exercised on
 * purpose, every run, in CI.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/** How the edge itself behaves, beyond which Machines are behind it. */
export interface EdgeOptions {
  /** Fixed listen port, for a fixture that has to be reachable at a known URL
   *  (the live-stage evidence run). 0 — the default — takes an ephemeral one. */
  readonly port?: number;
  /**
   * Hold each upgrade this long before forwarding it. Zero in every test that
   * asserts behaviour; a second or so in the evidence run, where the point is to
   * photograph the connecting screen *while it is still dialling* rather than to
   * catch a 20-millisecond frame.
   */
  readonly hopDelayMs?: number;
  /**
   * Extra knobs the *owner* of the fleet wants reachable on the same control
   * route — `./local-fleet` hangs `?pin=on|off` here so an out-of-process caller
   * (the live-stage evidence run) can put the fleet into the shipped-dead state
   * and back without restarting it. The edge itself has no opinion about them.
   */
  readonly onControl?: (params: URLSearchParams) => void;
  /**
   * Resolve the Machine an upgrade URL's ticket names, for {@link FlyEdge.landWrong}
   * — the "anycast always picks the wrong one" mode. Fly's edge cannot do this and
   * must not: it is the fixture cheating on purpose, so a wrong hop is a certainty
   * rather than a coin flip a test has to wait for. `null` means "cannot tell", and
   * the edge falls back to its normal first hop.
   */
  readonly hostOf?: (upgradeUrl: string) => string | null;
}

/** One Machine behind the edge: the id a ticket names, and where it really is. */
export interface EdgeMachine {
  /** The Machine id (`MACHINE_ID` / `FLY_MACHINE_ID`) a `fly-replay` names. */
  readonly machine: string;
  /** Its real `ws://host:port/path` — what a direct dial would use. */
  readonly url: string;
}

/** The edge, as a test drives it. */
export interface FlyEdge {
  /**
   * **Go silent without hanging up** (`?gag=1` on the control route) — the shape of
   * the developer's zombie match, reproduced at the one place that can reproduce it.
   *
   * Only the SERVER→CLIENT direction stops: the edge stops reading from each
   * Machine, so not one further frame reaches a browser, while every socket stays
   * open at both ends and the client's own input keeps flowing. That is exactly the
   * lie `src/net/link-loss` exists to catch — `WebSocket.readyState` still reads
   * `OPEN`, no `onclose` ever runs, and the only evidence of death is the silence
   * itself. Nothing is dropped (the stream is *paused*, so TCP holds it), so
   * ungagging resumes a connection that is still valid rather than one with a hole
   * in it, and the client recovers exactly as it would when a real network returns.
   *
   * Applies to connections spliced later too, so a redial into a still-dead network
   * stays dead until the test says otherwise.
   */
  gag(on: boolean): void;
  /** The shared hostname clients dial — the allocator's `connectUrl`. */
  readonly url: string;
  /** `http://…/_edge/land` — the out-of-process twin of {@link FlyEdge.landOn}. */
  readonly controlUrl: string;
  /**
   * Force the Machine the *next* upgrades land on first, exactly as the real
   * edge's anycast routing would land them somewhere arbitrary. `null` restores
   * round-robin. This is the knob that turns a coin flip into a test.
   */
  landOn(machine: string | null): void;
  /** Land every upgrade on a Machine that is NOT the one its ticket names (or stop
   *  doing so). Needs {@link EdgeOptions.hostOf}; without it this is a no-op. */
  landWrong(on: boolean): void;
  /** How many upgrades have been re-delivered because of a `fly-replay`. */
  readonly replays: number;
  /** Reset the counter between rounds. */
  resetCounts(): void;
  stop(): Promise<void>;
}

/** Hops one upgrade is allowed before the edge calls it a routing loop. */
const MAX_HOPS = 4;

/** The out-of-process control route (`?machine=<id|any>&reset=1`), used by
 *  `./live-pin.probe.mjs --local` to aim the next first hop and read the replay
 *  count. In-process callers use {@link FlyEdge.landOn} instead. */
export const CONTROL_PATH = '/_edge/land';

/** Re-serialise the request line and headers exactly as they arrived, so the
 *  Machine's upgrade guard reads the same `?ticket=` a browser sent. */
function requestHead(request: IncomingMessage): string {
  const lines = [`GET ${request.url ?? '/'} HTTP/1.1`];
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** The `instance=` a `fly-replay` response head names, or null when it is a 101
 *  (or anything else the edge should simply pass through). */
function replayTarget(head: string): string | null {
  const match = /fly-replay:\s*(?:[^\r\n]*;)?\s*instance=([^\r\n;]+)/i.exec(head);
  return match ? match[1]!.trim() : null;
}

/**
 * Start an edge in front of `machines`. Clients dial {@link FlyEdge.url} and never
 * learn which Machine served them — which is the whole shape of the live system.
 */
export async function startFlyEdge(
  machines: readonly EdgeMachine[],
  options: EdgeOptions = {},
): Promise<FlyEdge> {
  if (machines.length === 0) throw new Error('an edge needs at least one machine');
  const hopDelayMs = options.hopDelayMs ?? 0;
  const byId = new Map(machines.map((m) => [m.machine, m]));
  let forced: string | null = null;
  let wrongOnly = false;
  let cursor = 0;
  let replays = 0;
  /** True while the fleet is gagged ({@link FlyEdge.gag}). */
  let gagged = false;
  /** Every Machine-side stream currently spliced to a client, so a gag can stop
   *  reading from all of them at once — and a new splice can join a gag already on. */
  const upstreams = new Set<Socket>();

  const firstHop = (upgradeUrl: string): EdgeMachine => {
    if (wrongOnly && options.hostOf) {
      const host = options.hostOf(upgradeUrl);
      const wrong = host === null ? undefined : machines.find((m) => m.machine !== host);
      if (wrong) return wrong;
    }
    if (forced !== null) {
      const pinned = byId.get(forced);
      if (!pinned) throw new Error(`no machine ${forced} behind this edge`);
      return pinned;
    }
    return machines[cursor++ % machines.length]!;
  };

  /** Stop (or restart) delivery from every Machine. A paused stream keeps its data
   *  in the kernel rather than dropping it, so this is reversible mid-connection. */
  const setGag = (on: boolean): void => {
    gagged = on;
    for (const upstream of upstreams) {
      if (on) upstream.pause();
      else upstream.resume();
    }
  };

  /** Every socket this edge is holding open, so `stop()` can actually stop: an
   *  upgraded connection is invisible to `http.close()`, which would otherwise
   *  wait for a WebSocket that has no reason to ever hang up. */
  const live = new Set<Duplex>();

  const http: Server = createServer((request, response) => {
    // A control plane the *real* edge does not have, and the fleet under it never
    // sees: it lets a probe outside this process aim the next first hop, which is
    // what turns "we got lucky six times" into "we took the wrong hop on purpose
    // three times". Fly's anycast is a coin flip; a test must not be.
    const url = new URL(request.url ?? '/', 'http://edge.internal');
    if (url.pathname === CONTROL_PATH) {
      const machine = url.searchParams.get('machine');
      if (machine !== null) forced = machine === 'any' ? null : machine;
      if (url.searchParams.get('reset') === '1') replays = 0;
      const wrong = url.searchParams.get('wrong');
      if (wrong !== null) wrongOnly = wrong !== '0';
      // `?gag=1|0` — the silent death, and its undo, from outside this process
      // (the live-stage run's browser cannot reach `gag()` any other way).
      const gag = url.searchParams.get('gag');
      if (gag !== null) setGag(gag !== '0');
      options.onControl?.(url.searchParams);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ forced, wrongOnly, replays, gagged, machines: [...byId.keys()] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('edge\n');
  });

  http.on('upgrade', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    // Nothing from the client may be lost while the edge is still deciding where
    // this upgrade belongs — it is resumed only once a Machine has answered 101.
    client.pause();
    live.add(client);
    client.on('close', () => live.delete(client));
    const raw = requestHead(request);

    const hop = (target: EdgeMachine, depth: number): void => {
      if (depth > MAX_HOPS) {
        client.destroy();
        return;
      }
      const parsed = new URL(target.url);
      if (hopDelayMs > 0 && depth === 1) {
        setTimeout(() => hop(target, depth + 0.001), hopDelayMs);
        return;
      }
      const upstream: Socket = createConnection(Number(parsed.port), parsed.hostname);
      live.add(upstream);
      upstream.on('close', () => live.delete(upstream));
      let buffer = Buffer.alloc(0);
      let spliced = false;

      upstream.on('connect', () => {
        upstream.write(raw);
        if (head.length > 0) upstream.write(head);
      });

      upstream.on('data', (chunk: Buffer) => {
        if (spliced) return; // the pipes below own the socket now
        buffer = Buffer.concat([buffer, chunk]);
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const responseHead = buffer.subarray(0, end).toString('utf8');

        const instance = replayTarget(responseHead);
        if (instance !== null) {
          // The Machine says it does not host this room. Re-deliver the upgrade to
          // the one it named — this is the whole behaviour the pin is built on.
          upstream.destroy();
          const next = byId.get(instance);
          if (!next) {
            client.destroy();
            return;
          }
          replays++;
          hop(next, depth + 1);
          return;
        }

        // A 101 (or any other final answer): hand it to the client verbatim and
        // splice the two sockets together for the rest of the connection.
        spliced = true;
        client.write(buffer);
        buffer = Buffer.alloc(0);
        upstream.pipe(client);
        client.pipe(upstream);
        client.resume();
        // The 101 itself is already through (it was written above, before the
        // splice), so a gagged connection still OPENS — which is the point: the
        // socket is healthy in every way a client can observe, and delivers nothing.
        upstreams.add(upstream);
        upstream.on('close', () => upstreams.delete(upstream));
        if (gagged) upstream.pause();
      });

      upstream.on('error', () => client.destroy());
      upstream.on('close', () => {
        if (spliced) client.destroy();
      });
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    };

    hop(firstHop(request.url ?? '/'), 1);
  });

  await new Promise<void>((resolve) => http.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('no port');

  return {
    url: `ws://127.0.0.1:${address.port}/play`,
    controlUrl: `http://127.0.0.1:${address.port}${CONTROL_PATH}`,
    landOn: (machine): void => {
      forced = machine;
    },
    landWrong: (on): void => {
      wrongOnly = on;
    },
    gag: setGag,
    get replays(): number {
      return replays;
    },
    resetCounts: (): void => {
      replays = 0;
    },
    stop: (): Promise<void> => {
      for (const socket of live) socket.destroy();
      live.clear();
      return new Promise((resolve) => http.close(() => resolve()));
    },
  };
}

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
 * Configuration is three environment variables and no config file, because a
 * host that needs a config file is a host that needs porting:
 *
 *   PORT       listen port                            (default 8080)
 *   HOST       bind address                           (default 0.0.0.0)
 *   MATCH_SEED fixed boot seed, for a reproducible run (default: random)
 */

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MatchServer } from './match-server';
import { attachWebSocketServer } from './ws';

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

const matches = new MatchServer({ seed });
const startedAt = Date.now();

const http = createServer((request: IncomingMessage, response: ServerResponse) => {
  // Two plain HTTP routes, so a health check never has to speak WebSocket.
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: 'ok',
        rooms: matches.roomCount,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('Planet Rush match server — connect a WebSocket to play.\n');
});

attachWebSocketServer(http, (connection) => {
  const client = matches.connect(connection);
  connection.onMessage((frame) => client.receive(frame));
  // A dropped socket is where the reconnect-grace rule begins: the room seats a
  // bot at once and holds the seat ~60 s (GDD §4.2).
  connection.onClose(() => client.close(Date.now()));
});

const loop = setInterval(() => matches.update(Date.now()), LOOP_INTERVAL_MS);

http.listen(port, host, () => {
  console.log(`[planet-rush] match server listening on ${host}:${port} (seed ${seed})`);
});

/** Stop taking connections, stop the clock, and let the process exit. Docker
 *  sends SIGTERM; a terminal sends SIGINT. Both mean the same thing here. */
function shutdown(signal: string): void {
  console.log(`[planet-rush] ${signal} — shutting down`);
  clearInterval(loop);
  http.close(() => process.exit(0));
  // A client that will not hang up must not hold the deploy open forever.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

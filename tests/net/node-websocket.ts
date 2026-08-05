/**
 * tests/net/node-websocket.ts — a browser-shaped WebSocket, in Node, with no
 * library, plus a real match-server harness. OWNER: Netcode Engineer (GDD §4.2).
 *
 * The online client (`src/net/websocket-transport.ts`) expects the browser's
 * `WebSocket`; Node has none, and the client must not care. This is that object,
 * hand-rolled over `node:net` so the whole stack under a test is the shipping one:
 * a `node:http` listener, the hand-rolled RFC 6455 endpoint (`server/ws.ts`), and
 * `MatchServer` running the real sim behind it. Nothing between the client's
 * `send()` and the server's socket is a stand-in — which is the point of paying
 * for a real socket in a test rather than faking one.
 *
 * Shared by `online-2p.test.ts` (the play path) and `reconnect-resume.test.ts`
 * (the reconnect-grace path) so the two exercise the identical wire.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { MatchServer } from '../../server/match-server';
import type { MatchServerConfig } from '../../server/match-server';
import { attachWebSocketServer } from '../../server/ws';
import type { UpgradeGuard, WsConnection } from '../../server/ws';
import type { WebSocketLike } from '../../src/net/websocket-transport';

// ---------------------------------------------------------------------------
// RFC 6455 framing, the subset a client uses
// ---------------------------------------------------------------------------

/** Frame one outbound message the way a browser does: masked (RFC 6455 §5.1). */
function maskedFrame(payload: Buffer, opcode: number): Buffer {
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i & 3]!;

  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 0x1_0000) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, mask, masked]);
}

/** Pull every complete server frame out of a buffer. Server frames are never
 *  masked, and this endpoint never fragments what it sends. */
function readFrames(buffer: Buffer): { frames: { opcode: number; payload: Buffer }[]; rest: Buffer } {
  const frames: { opcode: number; payload: Buffer }[] = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const opcode = buffer[offset]! & 0x0f;
    let length = buffer[offset + 1]! & 0x7f;
    let header = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      header = 10;
    }
    if (buffer.length - offset < header + length) break;
    frames.push({ opcode, payload: buffer.subarray(offset + header, offset + header + length) });
    offset += header + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * The `WebSocketLike` the transport expects (`src/net/websocket-transport.ts`),
 * implemented over `node:net`. This is the browser's job, done by hand for a test
 * — and doing it by hand is the point: nothing between the client's `send()` and
 * the server's socket is a stand-in.
 */
export function nodeWebSocket(url: string): WebSocketLike {
  const parsed = new URL(url);
  const socket: Socket = createConnection(Number(parsed.port), parsed.hostname);
  const ws: WebSocketLike = {
    binaryType: 'arraybuffer',
    send(data: string | ArrayBuffer): void {
      if (typeof data === 'string') socket.write(maskedFrame(Buffer.from(data, 'utf8'), 0x1));
      else socket.write(maskedFrame(Buffer.from(new Uint8Array(data)), 0x2));
    },
    close(): void {
      socket.destroy();
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };

  let handshaken = false;
  let buffer = Buffer.alloc(0);

  socket.on('connect', () => {
    // Send the real request-target — path *and* query — so a `?ticket=` routing
    // hint reaches the server's upgrade hop exactly as a browser would deliver it.
    socket.write(
      `GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
  });

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshaken) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      handshaken = true;
      buffer = buffer.subarray(end + 4);
      ws.onopen?.({});
    }
    const { frames, rest } = readFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.opcode === 0x1) ws.onmessage?.({ data: frame.payload.toString('utf8') });
      else if (frame.opcode === 0x2) {
        // A copy, not a view onto the read buffer: the transport hands this
        // straight to the snapshot decoder, which reads it later.
        const copy = new ArrayBuffer(frame.payload.byteLength);
        new Uint8Array(copy).set(frame.payload);
        ws.onmessage?.({ data: copy });
      } else if (frame.opcode === 0x8) socket.destroy();
    }
  });

  socket.on('error', () => ws.onerror?.({}));
  socket.on('close', () => ws.onclose?.({}));
  return ws;
}

// ---------------------------------------------------------------------------
// The server harness
// ---------------------------------------------------------------------------

/** A real match server on a real port, ticked by a real interval. */
export interface MatchServerHarness {
  /** The `ws://…/play` URL clients dial. */
  readonly url: string;
  /** The authoritative server, so a test can read rooms and worlds. */
  readonly matches: MatchServer;
  /** Stop the loop, hang up every socket, close the listener. */
  stop(): Promise<void>;
}

/**
 * Stand up the process `server/index.ts` runs, minus the signal handlers: a
 * `node:http` listener with the RFC 6455 endpoint on top and a 60 Hz tick. The
 * config is the caller's (seats, seed, grace window) so a reconnect test can hand
 * the room a short grace and watch it pass in real seconds.
 */
export async function startMatchServer(
  config: MatchServerConfig,
  beforeUpgrade?: UpgradeGuard,
): Promise<MatchServerHarness> {
  const matches = new MatchServer(config);
  const connections: WsConnection[] = [];
  const http: Server = createServer((_request, response) => {
    response.writeHead(200);
    response.end('ok');
  });
  attachWebSocketServer(
    http,
    (connection) => {
      connections.push(connection);
      const client = matches.connect(connection);
      connection.onMessage((frame) => client.receive(frame));
      connection.onClose(() => client.close(Date.now()));
    },
    beforeUpgrade,
  );

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const loop = setInterval(() => matches.update(Date.now()), 1000 / 60);

  return {
    url: `ws://127.0.0.1:${address.port}/play`,
    matches,
    stop: async (): Promise<void> => {
      clearInterval(loop);
      for (const connection of connections) connection.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/**
 * Poll until a condition holds, or fail loudly rather than hang the suite — the
 * same rule the QA harness applies to matches (GDD §3.8).
 *
 * **Wait for the condition you actually need**, not for a proxy that usually
 * precedes it. n4-01 held `main` red on exactly that mistake: a test waited for a
 * telemetry event to *exist* and then asserted a field that event fills in later,
 * so on a slow host the assertion raced the sample's own population. If an
 * assertion needs a value, the wait is for that value being there.
 *
 * This bound is a **liveness** bound: it names what never arrived and it is
 * deliberately much tighter than the journey budget the test declares
 * (`./budgets.ts`). Budgets bound the slow; this bounds the stuck.
 *
 * `detail` is read only on failure, and only when the wait is for something whose
 * near-miss is worth seeing — "a net sample exists, but rtt is still null" is a
 * different bug report from "no net sample at all", and a bare timeout cannot
 * tell them apart.
 */
export async function until(
  what: string,
  ok: () => boolean,
  timeoutMs = 8_000,
  detail?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) {
      const saw = detail === undefined ? '' : ` — saw: ${detail()}`;
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${saw}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

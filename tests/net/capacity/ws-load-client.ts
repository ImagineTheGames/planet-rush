/**
 * tests/net/capacity/ws-load-client.ts — the thinnest honest WebSocket client.
 * OWNER: Netcode Engineer (m11 server stress; GDD §4.2).
 *
 * The capacity ramp measures **the server**, so the client that generates its
 * load must cost as close to nothing as a real socket allows. This is that
 * client: RFC 6455 over `node:net` and `node:tls`, masked frames out, and — the
 * whole reason it exists rather than reusing `../node-websocket.ts` —
 *
 *  1. **it answers pings.** `server/ws.ts` keepalives every 20 s and hangs up on
 *     a socket that did not pong within 15 s (`PONG_TIMEOUT_MS`), and it probes
 *     RTT twice a second on top of that. A client that ignores opcode 0x9 gets
 *     disconnected a third of a minute into a ramp step, which reads as "the
 *     server shed load" and is really "the harness was rude";
 *  2. **it does not decode.** A snapshot is *counted and sized*, never turned
 *     into ships and projectiles. At thirty-odd rooms a decoding harness does
 *     more work per second than the process it is measuring, and the curve
 *     becomes a picture of the harness. `onBinary` exists for the regression
 *     test, which decodes a handful of frames deliberately to prove the load is
 *     real — it is off on the ramp path;
 *  3. **it speaks `wss://`.** The throwaway Fly Machine is reachable only
 *     through the anycast edge, which is TLS-only (`fly.gameserver.toml`
 *     `force_https`). A harness that could only do `ws://` could never measure
 *     the host we actually deploy to.
 *
 * It is not a `WebSocketLike` and deliberately does not pretend to be one: the
 * shipping client's transport, session, prediction and telemetry are all real
 * per-client cost, and the point here is to pay none of it.
 */

import { randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Socket } from 'node:net';

/** RFC 6455 §5.2 opcodes, the subset a load client meets. */
const OP = { text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

/** What one socket cost and carried — the read side of a synthetic match. */
export interface LoadSocketStats {
  /** Binary frames in (snapshots), counted, never decoded. */
  binaryFrames: number;
  /** Bytes of binary payload in — the honest per-client downstream number. */
  binaryBytes: number;
  /** Text frames in (welcome, lobbyState, matchStart, events, pong, joinError). */
  textFrames: number;
  /** Text frames out (join, lobbyChoice, startMatch, input). */
  sentFrames: number;
  /** Bytes of text payload out. */
  sentBytes: number;
  /** Keepalive/RTT pings answered. Zero here is a bug, not a quiet socket. */
  pongsSent: number;
}

/** One open socket, from the harness's side. */
export interface LoadSocket {
  send(text: string): void;
  /** Server→client JSON, raw. The caller parses only what it needs. */
  onText(handler: (text: string) => void): void;
  /** Opt in to seeing snapshot payloads. Off by default — see the header. */
  onBinary(handler: (payload: ArrayBuffer) => void): void;
  onClose(handler: () => void): void;
  readonly stats: LoadSocketStats;
  readonly open: boolean;
  close(): void;
}

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

/** How long a socket has to complete its HTTP upgrade before we call it dead. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/** Dial one server and complete the RFC 6455 handshake. Resolves when the
 *  upgrade response has been read, which is when the server will accept a
 *  `join`. Rejects on a refused connection, a TLS failure, or a non-101. */
export function openLoadSocket(url: string): Promise<LoadSocket> {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  const port = Number(parsed.port || (secure ? 443 : 80));

  return new Promise<LoadSocket>((resolve, reject) => {
    const socket: Socket = secure
      ? tlsConnect({ host: parsed.hostname, port, servername: parsed.hostname })
      : netConnect({ host: parsed.hostname, port });

    const stats: LoadSocketStats = {
      binaryFrames: 0,
      binaryBytes: 0,
      textFrames: 0,
      sentFrames: 0,
      sentBytes: 0,
      pongsSent: 0,
    };

    let handshaken = false;
    let open = true;
    let buffer = Buffer.alloc(0);
    let textHandler: ((text: string) => void) | null = null;
    let binaryHandler: ((payload: ArrayBuffer) => void) | null = null;
    let closeHandler: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (!handshaken) {
        socket.destroy();
        reject(new Error(`websocket handshake to ${url} timed out`));
      }
    }, HANDSHAKE_TIMEOUT_MS);
    timer.unref?.();

    const die = (): void => {
      if (!open) return;
      open = false;
      clearTimeout(timer);
      socket.destroy();
      closeHandler?.();
    };

    const client: LoadSocket = {
      send(text: string): void {
        if (!open) return;
        const payload = Buffer.from(text, 'utf8');
        stats.sentFrames++;
        stats.sentBytes += payload.length;
        try {
          socket.write(maskedFrame(payload, OP.text));
        } catch {
          die();
        }
      },
      onText: (handler) => void (textHandler = handler),
      onBinary: (handler) => void (binaryHandler = handler),
      onClose: (handler) => void (closeHandler = handler),
      stats,
      get open(): boolean {
        return open;
      },
      close: die,
    };

    socket.on('connect', onReady);
    if (secure) socket.on('secureConnect', onReady);
    function onReady(): void {
      // The request-target carries the query, so a `?ticket=` routing hint reaches
      // the Fly upgrade hop exactly as a browser would deliver it (M10 machine-pin).
      socket.write(
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\nHost: ${parsed.host}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`,
      );
    }

    socket.on('data', (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      if (!handshaken) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('latin1');
        if (!/^HTTP\/1\.1 101/.test(head)) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`upgrade refused by ${url}: ${head.split('\r\n')[0]}`));
          return;
        }
        handshaken = true;
        clearTimeout(timer);
        buffer = buffer.subarray(end + 4);
        resolve(client);
      }

      // Server frames are never masked and this endpoint never fragments, so a
      // frame is header + payload and nothing else.
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
        const payload = buffer.subarray(offset + header, offset + header + length);
        offset += header + length;

        if (opcode === OP.binary) {
          // The measurement path: count and size, do not copy and do not decode.
          stats.binaryFrames++;
          stats.binaryBytes += length;
          if (binaryHandler) {
            const copy = new ArrayBuffer(length);
            new Uint8Array(copy).set(payload);
            binaryHandler(copy);
          }
        } else if (opcode === OP.text) {
          stats.textFrames++;
          if (textHandler) textHandler(payload.toString('utf8'));
        } else if (opcode === OP.ping) {
          // Answer it, echoing the payload verbatim (RFC 6455 §5.5.3) — the RTT
          // probe keys on the sequence number in there, and the keepalive hangs
          // up on silence.
          stats.pongsSent++;
          try {
            socket.write(maskedFrame(Buffer.from(payload), OP.pong));
          } catch {
            die();
          }
        } else if (opcode === OP.close) {
          die();
          return;
        }
        // A pong from the server is nothing to us: we never ping it.
      }
      buffer = offset === 0 ? buffer : buffer.subarray(offset);
    });

    socket.on('error', (error: Error) => {
      const wasOpen = handshaken;
      die();
      if (!wasOpen) reject(error);
    });
    socket.on('close', die);
  });
}

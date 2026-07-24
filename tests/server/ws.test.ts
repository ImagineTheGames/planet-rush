/**
 * tests/server/ws.test.ts — the dependency-free WebSocket endpoint.
 * OWNER: Netcode Engineer (GDD §4.2).
 *
 * Two levels. The frame codec is checked directly — masking, the three length
 * encodings, fragmentation, and the protocol violations that must close a
 * connection rather than be tolerated. Then a **real** client opens a **real**
 * socket against a real `node:http` server, performs the RFC 6455 handshake by
 * hand, joins a room, and reads its `welcome` back: proof that the whole stack
 * — TCP, upgrade, framing, wire format, room state machine — is connected, with
 * no library on either side of it.
 */

import { describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ServerMessage } from '../../src/net/transport';
import { MatchServer } from '../../server/match-server';
import type { WsConnection } from '../../server/ws';
import {
  MAX_FRAME_BYTES,
  acceptKey,
  attachWebSocketServer,
  decodeFrame,
  encodeFrame,
} from '../../server/ws';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';

/** Frame a payload the way a browser does: masked, with a random key. */
function maskedFrame(payload: Buffer, opcode: number): Buffer {
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i & 3]!;

  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 0x1_0000) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, mask, masked]);
}

describe('frame codec', () => {
  it('computes the handshake accept key from RFC 6455 §1.3', () => {
    // The example key and expected accept value from the RFC itself.
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('round-trips a masked client frame', () => {
    const payload = Buffer.from('{"type":"startMatch"}', 'utf8');
    const parsed = decodeFrame(maskedFrame(payload, 0x1));
    expect(parsed?.opcode).toBe(0x1);
    expect(parsed?.fin).toBe(true);
    expect(parsed?.payload.toString('utf8')).toBe(payload.toString('utf8'));
  });

  it('handles all three length encodings', () => {
    for (const size of [0, 125, 126, 4096, 0x1_0000]) {
      const payload = randomBytes(size);
      const parsed = decodeFrame(maskedFrame(payload, 0x2));
      expect(parsed?.payload.equals(payload)).toBe(true);
    }
  });

  it('waits for a frame that has not all arrived yet', () => {
    const frame = maskedFrame(Buffer.from('hello'), 0x1);
    expect(decodeFrame(frame.subarray(0, 4))).toBeNull();
    expect(decodeFrame(Buffer.alloc(0))).toBeNull();
  });

  it('refuses an unmasked client frame and an oversized one', () => {
    // Unmasked from a client is a protocol violation (RFC 6455 §5.1).
    expect(() => decodeFrame(encodeFrame(Buffer.from('hi'), 0x1))).toThrow();

    const huge = Buffer.alloc(10);
    huge[0] = 0x81;
    huge[1] = 0x80 | 127;
    huge.writeBigUInt64BE(BigInt(MAX_FRAME_BYTES + 1), 2);
    expect(() => decodeFrame(huge)).toThrow();
  });

  it('frames server output unmasked, with the length the reader expects', () => {
    const frame = encodeFrame(Buffer.from('abc'), 0x1);
    expect(frame[0]).toBe(0x81); // FIN | text
    expect(frame[1]).toBe(3); // no mask bit, length 3
    expect(frame.subarray(2).toString('utf8')).toBe('abc');
  });
});

/** Read whole *unmasked* frames (what a server sends) out of a buffer. */
function readServerFrames(buffer: Buffer): { payloads: Buffer[]; rest: Buffer } {
  const payloads: Buffer[] = [];
  let rest = buffer;
  for (;;) {
    if (rest.length < 2) break;
    let length = rest[1]! & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (rest.length < 4) break;
      length = rest.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (rest.length < 10) break;
      length = Number(rest.readBigUInt64BE(2));
      offset = 10;
    }
    if (rest.length < offset + length) break;
    payloads.push(rest.subarray(offset, offset + length));
    rest = rest.subarray(offset + length);
  }
  return { payloads, rest };
}

describe('a real socket against a real server', () => {
  it('handshakes, joins a room, and is welcomed into a seat', async () => {
    const matches = new MatchServer({ seed: 7, asteroidCount: 8 });
    const http: Server = createServer((_, response) => response.end('ok'));
    const serverSide: WsConnection[] = [];
    attachWebSocketServer(http, (connection) => {
      serverSide.push(connection);
      const client = matches.connect(connection);
      connection.onMessage((frame) => client.receive(frame));
      connection.onClose(() => client.close(Date.now()));
    });

    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    matches.update(Date.now());

    const socket = createConnection(address.port, '127.0.0.1');
    const received: ServerMessage[] = [];
    await new Promise<void>((resolve, reject) => {
      let handshaken = false;
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error('the server never answered')), 8_000);
      timer.unref?.();

      socket.on('error', reject);
      socket.on('connect', () => {
        // The handshake, by hand — no client library on this side either.
        socket.write(
          `GET /play HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!handshaken) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end < 0) return;
          const headers = buffer.subarray(0, end).toString('ascii');
          if (!headers.startsWith('HTTP/1.1 101')) {
            reject(new Error(headers));
            return;
          }
          handshaken = true;
          buffer = buffer.subarray(end + 4);
          socket.write(
            maskedFrame(Buffer.from(encodeClientMessage({ type: 'join', room: 'QK7P' })), 0x1),
          );
        }

        const { payloads, rest } = readServerFrames(buffer);
        buffer = rest;
        for (const payload of payloads) {
          const message = parseServerMessage(payload.toString('utf8'));
          if (message) received.push(message);
        }
        // A seated client is told two things at once: who it is, and who else
        // is in the lobby.
        if (received.some((m) => m.type === 'welcome') && received.some((m) => m.type === 'lobbyState')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const welcome = received.find((m) => m.type === 'welcome');
    expect(welcome?.type).toBe('welcome');
    if (welcome?.type !== 'welcome') throw new Error('unreachable');
    expect(welcome.you).toBe(0);
    expect(welcome.room).toBe('QK7P');
    // The seat comes with the secret that reclaims it after a drop (GDD §4.2).
    expect(welcome.reclaimToken).toBeTypeOf('string');
    expect(matches.roomCount).toBe(1);

    // An upgraded socket is no longer the HTTP server's to close, so the test
    // hangs up both ends itself before waiting on the listener.
    socket.destroy();
    for (const connection of serverSide) connection.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }, 15_000);
});

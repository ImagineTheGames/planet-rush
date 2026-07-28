/**
 * tests/net/online-2p.test.ts — two players, one room, one authoritative
 * server, over a real socket (GDD §4.2, milestone M3).
 *
 * Everything below this test is the shipping stack and none of it is mocked: a
 * `node:http` listener with the hand-rolled RFC 6455 endpoint (`server/ws.ts`)
 * on top, `MatchServer` running the real sim behind it, and two clients that are
 * `createOnlineSession` — `WebSocketTransport`, the wire codec, prediction, and
 * reconciliation, exactly as a browser would run them. The only thing this file
 * supplies is a browser-shaped WebSocket for Node, because Node does not have
 * one and the client must not care.
 *
 * What it proves, and why each part is worth a real socket rather than a fake:
 *
 *  - **The lobby happens.** Two clients join by code, pick different hulls, and
 *    the creator starts the match — over TCP, in the order a real network
 *    delivers it.
 *  - **Both clients build the server's world.** `matchStart` carries the seed
 *    and roster, so each client's `createWorld` produces the arena the server is
 *    simulating: same rocks, and each ship in the hull its player picked.
 *  - **Prediction tracks authority.** Each client flies its own ship at zero
 *    latency and reconciles against 30 Hz snapshots; the residual error is the
 *    wire's quantization, not drift.
 *  - **Each sees the other.** The remote ship moves on this client's screen
 *    because snapshots move it, and it is where the server says it is.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { MatchServer } from '../../server/match-server';
import { attachWebSocketServer } from '../../server/ws';
import type { WsConnection } from '../../server/ws';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import type { WebSocketLike } from '../../src/net/websocket-transport';
import type { World } from '../../src/sim';

// ---------------------------------------------------------------------------
// A browser-shaped WebSocket, in Node, with no library
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
 * implemented over `node:net`. This is the browser's job, done by hand for a
 * test — and doing it by hand is the point: nothing between the client's
 * `send()` and the server's socket is a stand-in.
 */
function nodeWebSocket(url: string): WebSocketLike {
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
    socket.write(
      `GET /play HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\n` +
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
// Harness
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until a condition holds, or fail loudly rather than hang the suite —
 *  the same rule the QA harness applies to matches (GDD §3.8). */
async function until(what: string, ok: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

const THRUST = (x: number, y: number): readonly Action[] => [{ type: 'thrust', dir: { x, y } }];

function shipOf(world: World, id: PlayerId): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship ${id}`);
  return ship;
}

function shipDistance(a: World, b: World, id: PlayerId): number {
  return Math.hypot(shipOf(a, id).pos.x - shipOf(b, id).pos.x, shipOf(a, id).pos.y - shipOf(b, id).pos.y);
}

interface Harness {
  url: string;
  matches: MatchServer;
  stop: () => Promise<void>;
}

/** A match server on a real port, ticked by a real interval — the process
 *  `server/index.ts` runs, minus the signal handlers. */
async function startServer(): Promise<Harness> {
  const matches = new MatchServer({ seed: 4242, slots: 2, asteroidCount: 10 });
  const connections: WsConnection[] = [];
  const http: Server = createServer((_request, response) => {
    response.writeHead(200);
    response.end('ok');
  });
  attachWebSocketServer(http, (connection) => {
    connections.push(connection);
    const client = matches.connect(connection);
    connection.onMessage((frame) => client.receive(frame));
    connection.onClose(() => client.close(Date.now()));
  });

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

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('a two-player online match', () => {
  it('runs end-to-end against a locally-run server, each client predicting its own ship', async () => {
    const harness = await startServer();
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    // --- Lobby: two clients, one shared room code, two different hulls -------
    const alice = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(alice);
    await until('alice to be seated', () => harness.matches.room('RUSH') !== undefined);

    const bob = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(bob);
    const room = harness.matches.room('RUSH');
    if (!room) throw new Error('the room was never created');
    await until('both seats to be filled', () => room.humanCount === 2);
    // Two humans in a two-seat room: no bots, so what follows is purely the two
    // clients and the authority between them.
    expect(room.lobbyState().every((slot) => !slot.isBot)).toBe(true);

    // --- RUSH! — the room creator starts the match (GDD §2.1, §4.2) ---------
    alice.startMatch();
    await until('both clients to have a world', () => alice.world !== null && bob.world !== null);

    const authority = room.world;
    if (!authority) throw new Error('the room never started its match');
    // Each client built the server's arena from `matchStart`: the same seed, so
    // the same field, and each seat in the hull its player chose in the lobby.
    for (const session of sessions) {
      expect(session.world?.asteroids.length).toBe(authority.asteroids.length);
      expect(session.world?.ships.map((s) => s.shipClass)).toEqual([
        ShipClass.Interceptor,
        ShipClass.Hauler,
      ]);
    }

    // --- Play: both ships fly, at 60 Hz, in opposite directions -------------
    // Thrust is tangential to the ring on purpose: pointed outward, each ship
    // would fly straight into its own station and the test would be measuring
    // collision response rather than the network.
    const start = [{ ...shipOf(authority, 0).pos }, { ...shipOf(authority, 1).pos }];
    // Sampled while the hands are on the controls, because that is the only
    // time there is anything in flight to be ahead by.
    let leadWhileFlying = 0;
    let pendingWhileFlying = 0;
    const flying = setInterval(() => {
      alice.sendInput(THRUST(0, 1));
      bob.sendInput(THRUST(0, -1));
      leadWhileFlying = Math.max(leadWhileFlying, alice.prediction?.lead ?? 0);
      pendingWhileFlying = Math.max(pendingWhileFlying, alice.prediction?.pendingCount ?? 0);
    }, 1000 / 60);
    await sleep(1_500);
    clearInterval(flying);
    // Let the last inputs land and the last snapshots come back.
    await sleep(200);

    const aliceWorld = alice.world;
    const bobWorld = bob.world;
    if (!aliceWorld || !bobWorld) throw new Error('a client lost its world');

    // The match actually ran, on the server, off both clients' input: each ship
    // has travelled, in the direction its own player was pushing.
    expect(authority.tick).toBeGreaterThan(60);
    expect(shipOf(authority, 0).pos.y - start[0]!.y).toBeGreaterThan(20);
    expect(shipOf(authority, 1).pos.y - start[1]!.y).toBeLessThan(-20);

    for (const [session, seat] of [
      [alice, 0],
      [bob, 1],
    ] as const) {
      const prediction = session.prediction;
      if (!prediction) throw new Error(`seat ${seat} is not predicting`);
      // Prediction is tracking authority, not drifting from it: the residual is
      // the wire's integer quantization (`src/net/snapshot.ts`), which is what
      // "reconciles" has to mean if the word is to mean anything.
      expect(prediction.lastError).toBeLessThan(3);
    }
    // While the hands were on the controls the client ran ahead of the server by
    // the input it had in flight — that lead is what makes a press arrive *for*
    // the tick it names rather than after it. Hands off, it settles back onto
    // the server's own tick, because there is nothing left to be ahead by.
    expect(pendingWhileFlying).toBeGreaterThan(0);
    expect(leadWhileFlying).toBeGreaterThan(0);
    expect(alice.prediction?.lead).toBe(0);

    // Each client can see the other player's ship, in the place the server has
    // it: the remote half of the world arrives entirely by snapshot.
    expect(shipDistance(aliceWorld, authority, 1)).toBeLessThan(40);
    expect(shipDistance(bobWorld, authority, 0)).toBeLessThan(40);
    // …and they are not merely *drawing* it at the spawn point.
    expect(shipOf(aliceWorld, 1).pos.y).toBeLessThan(start[1]!.y - 10);
  }, 30_000);
});

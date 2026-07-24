/**
 * server/ws.ts — a WebSocket endpoint in plain Node, with no dependencies.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * RFC 6455, the subset a game server actually uses: the upgrade handshake,
 * masked client frames in, unmasked text and binary frames out, fragmentation,
 * ping/pong, and close. About two hundred lines against `node:http`,
 * `node:crypto` and `node:net` — every one of them a Node built-in.
 *
 * **Why hand-rolled rather than a library.** The hard requirement behind the
 * host decision is that the server ships as *a plain Dockerized Node process
 * with zero vendor-specific APIs*, so it redeploys anywhere in an afternoon
 * (GDD §4.2, risk 1: "portability is the mitigation, not the vendor"). A
 * dependency-free endpoint takes that one step further: the image is `node` plus
 * this repository, there is no native module to rebuild for ARM (the chosen host
 * is an Oracle Ampere core — docs/netcode-spike.md), and nothing in the network
 * layer can be deprecated out from under a build that has to work offline.
 * Swapping in `ws` later is a file, not a rewrite: the room only ever sees
 * {@link ServerSocket}.
 *
 * **What it defends against.** Frames are bounded ({@link MAX_FRAME_BYTES}), an
 * unmasked client frame is a protocol violation and is closed on (RFC 6455 §5.1),
 * and idle sockets are pinged so a half-open connection is discovered rather
 * than left to hold a seat forever — which matters more here than usual, because
 * a socket that dies quietly is a player whose reconnect-grace window never
 * starts (GDD §4.2).
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { WireFrame } from '../src/net/wire';
import type { ServerSocket } from './room';

/**
 * The socket an HTTP upgrade hands over. Node types it as a `Duplex`; in
 * practice it is a `net.Socket`, and the two TCP knobs this endpoint sets are
 * called only when they are actually there — a `Duplex` from a test harness is
 * just as valid a peer.
 */
type UpgradeSocket = Duplex & Partial<Pick<Socket, 'setNoDelay' | 'setTimeout'>>;

/** The RFC 6455 handshake GUID. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Opcodes, named. */
const OP = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

/**
 * Largest frame this endpoint will assemble. The biggest thing a client ever
 * sends is one tick of input — a few hundred bytes (docs/netcode-spike.md) — so
 * 64 KiB is four orders of magnitude of headroom and still a hard ceiling on
 * what one socket can make the server allocate.
 */
export const MAX_FRAME_BYTES = 64 * 1024;

/** How often an idle socket is pinged, and how long it has to answer. */
export const PING_INTERVAL_MS = 20_000;
export const PONG_TIMEOUT_MS = 15_000;

/** The `Sec-WebSocket-Accept` value for a client's key (RFC 6455 §4.2.2). */
export function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');
}

/** Frame one outbound message. Server frames are never masked (RFC 6455 §5.1). */
export function encodeFrame(payload: Buffer, opcode: number): Buffer {
  const length = payload.byteLength;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 0x1_0000) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN, no RSV
  return Buffer.concat([header, payload]);
}

/** One parsed frame, as it came off the wire. */
export interface ParsedFrame {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
  /** Bytes consumed from the front of the buffer. */
  readonly size: number;
}

/**
 * Parse one frame from the front of `buffer`, or return null when the frame is
 * not all there yet — the caller keeps accumulating. Throws on a protocol
 * violation the connection must be closed for.
 */
export function decodeFrame(buffer: Buffer): ParsedFrame | null {
  if (buffer.length < 2) return null;
  const first = buffer[0]!;
  const second = buffer[1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(MAX_FRAME_BYTES)) throw new Error('frame too large');
    length = Number(big);
    offset += 8;
  }
  if (length > MAX_FRAME_BYTES) throw new Error('frame too large');
  // Every frame from a client must be masked; an unmasked one is a broken or
  // hostile peer, never a browser (RFC 6455 §5.1).
  if (!masked) throw new Error('unmasked client frame');
  if (buffer.length < offset + 4 + length) return null;

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) payload[i] = buffer[offset + i]! ^ mask[i & 3]!;

  return { fin, opcode, payload, size: offset + length };
}

// ---------------------------------------------------------------------------
// A connected socket
// ---------------------------------------------------------------------------

/** What the endpoint hands the match server for each client. */
export interface WsConnection extends ServerSocket {
  /** Called with each complete application message (text or binary). */
  onMessage(handler: (frame: WireFrame) => void): void;
  /** Called once, when the socket is gone for good. */
  onClose(handler: () => void): void;
}

class WsSocket implements WsConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private messageHandler: ((frame: WireFrame) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private closed = false;
  /** Assembly state for a fragmented message (RFC 6455 §5.4). */
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private awaitingPong = false;
  private readonly ping: NodeJS.Timeout;

  constructor(private readonly socket: UpgradeSocket) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
    // Node's own idle timer stays off: liveness is this endpoint's ping, which
    // also keeps middleboxes from reaping a quiet socket between waves.
    socket.setTimeout?.(0);
    this.ping = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
    // A keepalive timer must never be the reason a container refuses to exit.
    this.ping.unref?.();
  }

  send(frame: WireFrame): void {
    if (this.closed) return;
    const payload =
      typeof frame === 'string' ? Buffer.from(frame, 'utf8') : Buffer.from(new Uint8Array(frame));
    const opcode = typeof frame === 'string' ? OP.text : OP.binary;
    // A dead socket must not throw its way up into the sim loop: one client's
    // broken pipe is not everyone else's dropped tick.
    try {
      this.socket.write(encodeFrame(payload, opcode));
    } catch {
      this.destroy();
    }
  }

  close(): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(Buffer.alloc(0), OP.close));
    } catch {
      // Already gone; the destroy below is the only thing that still matters.
    }
    this.destroy();
  }

  onMessage(handler: (frame: WireFrame) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    // A client that never completes a frame must not be able to grow the
    // server's memory by dribbling bytes at it.
    if (this.buffer.length > MAX_FRAME_BYTES * 2) {
      this.destroy();
      return;
    }

    for (;;) {
      let frame: ParsedFrame | null;
      try {
        frame = decodeFrame(this.buffer);
      } catch {
        this.destroy();
        return;
      }
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.size);
      this.handleFrame(frame);
      if (this.closed) return;
    }
  }

  private handleFrame(frame: ParsedFrame): void {
    switch (frame.opcode) {
      case OP.close:
        this.destroy();
        return;
      case OP.ping:
        this.socket.write(encodeFrame(frame.payload, OP.pong));
        return;
      case OP.pong:
        this.awaitingPong = false;
        return;
      case OP.continuation: {
        this.fragments.push(frame.payload);
        if (!frame.fin) return;
        const payload = Buffer.concat(this.fragments);
        const opcode = this.fragmentOpcode;
        this.fragments = [];
        this.fragmentOpcode = 0;
        this.deliver(payload, opcode);
        return;
      }
      case OP.text:
      case OP.binary:
        if (!frame.fin) {
          this.fragments = [frame.payload];
          this.fragmentOpcode = frame.opcode;
          return;
        }
        this.deliver(frame.payload, frame.opcode);
        return;
      default:
        // An opcode nobody defined is a peer we cannot understand.
        this.destroy();
    }
  }

  private deliver(payload: Buffer, opcode: number): void {
    if (!this.messageHandler) return;
    if (opcode === OP.text) {
      this.messageHandler(payload.toString('utf8'));
      return;
    }
    // Copy out of Node's pooled buffer: the ArrayBuffer handed on must own its
    // bytes, or a later chunk will quietly rewrite a snapshot under the reader.
    const copy = new ArrayBuffer(payload.byteLength);
    new Uint8Array(copy).set(payload);
    this.messageHandler(copy);
  }

  /** Ping, and hang up on a socket that stopped answering. A half-open
   *  connection left alive is a seat nobody can reclaim (GDD §4.2). */
  private heartbeat(): void {
    if (this.closed) return;
    if (this.awaitingPong) {
      this.destroy();
      return;
    }
    this.awaitingPong = true;
    try {
      this.socket.write(encodeFrame(Buffer.alloc(0), OP.ping));
    } catch {
      this.destroy();
      return;
    }
    setTimeout(() => {
      if (this.awaitingPong) this.destroy();
    }, PONG_TIMEOUT_MS).unref?.();
  }

  private destroy(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping);
    this.socket.destroy();
    this.closeHandler?.();
  }
}

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

/**
 * Attach a WebSocket endpoint to a plain `node:http` server. `onConnection` is
 * called once per client with a {@link WsConnection}; everything above this line
 * is bytes, everything below it is the game.
 */
export function attachWebSocketServer(
  http: HttpServer,
  onConnection: (connection: WsConnection) => void,
): void {
  http.on('upgrade', (request: IncomingMessage, socket: UpgradeSocket, head: Buffer) => {
    const key = request.headers['sec-websocket-key'];
    const upgrade = String(request.headers['upgrade'] ?? '').toLowerCase();
    if (upgrade !== 'websocket' || typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    // Game traffic is small and latency-sensitive: 30 Hz snapshots must not sit
    // in a Nagle buffer waiting for company (GDD §4.2).
    socket.setNoDelay?.(true);

    const connection = new WsSocket(socket);
    onConnection(connection);
    // Bytes that arrived glued to the handshake belong to the first frame.
    if (head && head.length > 0) socket.unshift(head);
  });
}

/**
 * src/net/wire.ts — what the protocol actually looks like on a socket.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * `./transport` says what the client and the server say to each other;
 * this file says how those words are spelled on the wire, and it is the one
 * module both ends share — the client encodes with it and the match server
 * decodes with it, so the two can never drift apart into a "works on my
 * machine" protocol.
 *
 * **Two channels, one socket** (GDD §4.2):
 *
 *  - **Binary frames** carry snapshots, and only snapshots. Ships and
 *    projectiles stream at 30 Hz in the measured layout (`./snapshot`,
 *    510-byte worst case — docs/netcode-spike.md), behind a 10-byte frame
 *    header that names the tick and the input sequence being acknowledged.
 *  - **Text frames** carry everything else as JSON: join, lobby, match start,
 *    static-entity events, the reconnect-grace pair, match end, and the
 *    client's per-tick input. These are low-frequency or small, and legible
 *    JSON is worth more here than the bytes it costs — the spike measured
 *    upstream as "never the bottleneck" (a handful of actions per tick, tens
 *    of KB/s at worst against a 40 KB/s budget). A binary input encoding is a
 *    named follow-up, not a prerequisite.
 *
 * **The server never trusts a client.** Everything arriving from a socket goes
 * through {@link parseClientMessage}, which validates shape, range, and size
 * before the message reaches the room: an action list is bounded, every vector
 * component must be finite, thrust is clamped to the analog range the input
 * layer promises, and a message that is not one of the four client verbs is
 * dropped rather than coerced. A malformed frame costs the sender its own
 * packet and nothing else.
 */

import type { Action, BuildItem, Vec2 } from '@shared/types';
import { ShipClass } from '@shared/types';
import type {
  BotDifficulty,
  ClientMessage,
  FireMode,
  RoomCode,
  ServerMessage,
} from './transport';

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/** Wire format version. Bumped whenever a frame layout changes; a client and a
 *  server that disagree here disagree about everything, so it is checked. */
export const WIRE_VERSION = 1;

/** First byte of a binary frame: this is a snapshot. Room for more binary
 *  frame kinds later (a binary input frame is the obvious next one). */
export const FRAME_SNAPSHOT = 0x01;

/** kind u8 · version u8 · tick u32 · ackSeq u32, little-endian. */
export const SNAPSHOT_FRAME_HEADER_BYTES = 10;

/** The raw payload a socket carries either way. */
export type WireFrame = string | ArrayBuffer;

// ---------------------------------------------------------------------------
// Bounds — every one of these exists to bound work done on a hostile message
// ---------------------------------------------------------------------------

/** Longest room code the server will even look at (codes are 4 chars). */
export const MAX_ROOM_CODE_LENGTH = 8;

/**
 * Longest signed ticket the server will even look at (`src/net/ticket.ts`). A
 * ticket is `base64url(payloadJSON).base64url(hmac)`: the payload is a three-field
 * claims object and the signature a fixed 43-char base64url SHA-256, so a real
 * ticket is a couple hundred bytes. This ceiling is generous headroom and still a
 * hard bound on what an unauthenticated join can make the verifier hash.
 */
export const MAX_TICKET_LENGTH = 512;

/** Most actions one input message may carry. The action union has seven verbs
 *  and a tick sensibly carries at most one of each; anything past that is a
 *  client trying to make the server do arithmetic on its behalf. */
export const MAX_ACTIONS_PER_MESSAGE = 8;

/** Slots in a match (GDD §2.1) — the id space a client may name. */
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

/** Serialize a client message for the socket. Always a text frame: the client
 *  never sends binary (snapshots only ever travel server → client). */
export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/**
 * Parse and **validate** one inbound client frame. Returns `null` for anything
 * that is not a well-formed message — the caller drops it.
 *
 * This is the server's front door, so it is deliberately paranoid: no field is
 * trusted, no missing field is defaulted into something meaningful, and no
 * unbounded structure is accepted. Note what is *not* validated here: which
 * slot the sender is. A client never names itself — the server takes identity
 * from the connection (see `InputQueue.accept`).
 */
export function parseClientMessage(frame: WireFrame): ClientMessage | null {
  if (typeof frame !== 'string') return null; // clients never send binary
  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  switch (raw['type']) {
    case 'join': {
      const room = parseRoomCode(raw['room']);
      if (room === null) return null;
      const reclaim = raw['reclaim'];
      const token = raw['reclaimToken'];
      const ticket = raw['ticket'];
      // A malformed reclaim is refused outright rather than quietly demoted to
      // a plain join: a client asking for a seat it cannot name must not be
      // handed a *different* seat instead (GDD §4.2 reconnect grace).
      if (reclaim !== undefined && !isSlot(reclaim)) return null;
      if (token !== undefined && (typeof token !== 'string' || token.length > 64)) return null;
      // The ticket is bounded like every other field on this hostile-input
      // surface, then carried through verbatim. It MUST be rebuilt here: this
      // parser drops any field it does not name, so a ticket the parser ignores
      // never reaches the Machine — and a Machine that fails closed then refuses
      // every join (M9 fleet membership). The signature is checked later, on the
      // Machine, by `verifyTicket`; here we only bound its size.
      if (ticket !== undefined && (typeof ticket !== 'string' || ticket.length > MAX_TICKET_LENGTH)) {
        return null;
      }
      return {
        type: 'join',
        room,
        ...(isSlot(reclaim) ? { reclaim } : {}),
        ...(typeof token === 'string' ? { reclaimToken: token } : {}),
        ...(typeof ticket === 'string' ? { ticket } : {}),
      };
    }
    case 'lobbyChoice': {
      const shipClass = parseShipClass(raw['shipClass']);
      const fireMode = parseFireMode(raw['fireMode']);
      if (shipClass === null || fireMode === null) return null;
      const difficulties = parseBotDifficulties(raw['botDifficulties']);
      return {
        type: 'lobbyChoice',
        shipClass,
        fireMode,
        ...(difficulties ? { botDifficulties: difficulties } : {}),
      };
    }
    case 'startMatch':
      return { type: 'startMatch' };
    case 'input': {
      const tick = raw['tick'];
      const seq = raw['seq'];
      if (!isCount(tick) || !isCount(seq)) return null;
      const actions = parseActions(raw['actions']);
      if (actions === null) return null;
      return { type: 'input', tick, seq, actions };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

/**
 * Serialize a server message. Snapshots become binary frames (the payload is
 * already a packed buffer — re-encoding it as JSON would quadruple it and
 * throw away the whole point of the measured layout); everything else is JSON.
 */
export function encodeServerMessage(message: ServerMessage): WireFrame {
  if (message.type !== 'snapshot') return JSON.stringify(message);

  const payload = new Uint8Array(message.payload);
  const frame = new ArrayBuffer(SNAPSHOT_FRAME_HEADER_BYTES + payload.byteLength);
  const dv = new DataView(frame);
  dv.setUint8(0, FRAME_SNAPSHOT);
  dv.setUint8(1, WIRE_VERSION);
  dv.setUint32(2, message.tick >>> 0, true);
  dv.setUint32(6, message.ackSeq >>> 0, true);
  new Uint8Array(frame, SNAPSHOT_FRAME_HEADER_BYTES).set(payload);
  return frame;
}

/**
 * Parse one inbound server frame on the client. Returns `null` for a frame
 * this client cannot read — a version mismatch, a truncated header, or JSON
 * that is not a server message. Clients are not the trust boundary the server
 * is, but a null here keeps a bad frame from becoming a crashed game.
 */
export function parseServerMessage(frame: WireFrame): ServerMessage | null {
  if (typeof frame === 'string') {
    try {
      const raw: unknown = JSON.parse(frame);
      return isRecord(raw) && isServerMessageType(raw['type'])
        ? (raw as unknown as ServerMessage)
        : null;
    } catch {
      return null;
    }
  }

  if (frame.byteLength < SNAPSHOT_FRAME_HEADER_BYTES) return null;
  const dv = new DataView(frame);
  if (dv.getUint8(0) !== FRAME_SNAPSHOT || dv.getUint8(1) !== WIRE_VERSION) return null;
  return {
    type: 'snapshot',
    tick: dv.getUint32(2, true),
    ackSeq: dv.getUint32(6, true),
    payload: frame.slice(SNAPSHOT_FRAME_HEADER_BYTES),
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'welcome',
  'lobbyState',
  'matchStart',
  'snapshot',
  'entityEvent',
  'playerSubstituted',
  'playerReclaimed',
  'matchEnd',
]);

function isServerMessageType(value: unknown): boolean {
  return typeof value === 'string' && SERVER_MESSAGE_TYPES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-negative integer that fits comfortably in the arithmetic the server
 *  does with it — ticks and sequence numbers. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_PLAYERS;
}

/**
 * Room codes are typed by a human off someone's screen, so they are normalized
 * (trimmed, upper-cased) before comparison and restricted to the alphabet the
 * generator draws from. Anything else never reaches the room registry.
 */
export function parseRoomCode(value: unknown): RoomCode | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (code.length === 0 || code.length > MAX_ROOM_CODE_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) ? code : null;
}

function parseShipClass(value: unknown): ShipClass | null {
  return typeof value === 'string' && (Object.values(ShipClass) as string[]).includes(value)
    ? (value as ShipClass)
    : null;
}

function parseFireMode(value: unknown): FireMode | null {
  return value === 'manual' || value === 'auto' ? value : null;
}

function parseBotDifficulties(value: unknown): BotDifficulty[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAYERS) return null;
  const out: BotDifficulty[] = [];
  for (const entry of value) {
    if (entry !== 'easy' && entry !== 'medium' && entry !== 'hard') return null;
    out.push(entry);
  }
  return out;
}

/** A finite, bounded vector. Non-finite components are the classic way to
 *  smuggle a `NaN` into a deterministic sim, so they are refused outright. */
function parseVec(value: unknown, limit: number): Vec2 | null {
  if (!isRecord(value)) return null;
  const x = value['x'];
  const y = value['y'];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp(x, limit), y: clamp(y, limit) };
}

function clamp(v: number, limit: number): number {
  return v > limit ? limit : v < -limit ? -limit : v;
}

/** World-space coordinates a ping may name — generous, but finite and bounded
 *  so a ping can never carry an absurd number into the UI. */
const MAX_WORLD_COORD = 1e6;

const BUILD_ITEMS: ReadonlySet<string> = new Set<BuildItem>(['turret', 'shield', 'repair', 'bank']);

/**
 * Validate one tick's action list. Every action is checked against its own
 * shape; one bad action rejects the whole message rather than being silently
 * dropped, because a partially-applied tick is a worse lie than a missing one.
 */
export function parseActions(value: unknown): Action[] | null {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS_PER_MESSAGE) return null;
  const actions: Action[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    switch (entry['type']) {
      case 'thrust': {
        // The input layer promises [-1, 1] per axis (GDD §2.4); clamped rather
        // than rejected, so a stick calibrated a hair past full still flies.
        const dir = parseVec(entry['dir'], 1);
        if (!dir) return null;
        actions.push({ type: 'thrust', dir });
        break;
      }
      case 'aim': {
        const dir = parseVec(entry['dir'], MAX_WORLD_COORD);
        if (!dir) return null;
        actions.push({ type: 'aim', dir });
        break;
      }
      case 'fire': {
        if (typeof entry['active'] !== 'boolean' || typeof entry['auto'] !== 'boolean') return null;
        actions.push({ type: 'fire', active: entry['active'], auto: entry['auto'] });
        break;
      }
      case 'build': {
        if (typeof entry['active'] !== 'boolean') return null;
        actions.push({ type: 'build', active: entry['active'] });
        break;
      }
      case 'buildOrder': {
        const item = entry['item'];
        if (typeof item !== 'string' || !BUILD_ITEMS.has(item)) return null;
        actions.push({ type: 'buildOrder', item: item as BuildItem });
        break;
      }
      case 'boost': {
        if (typeof entry['active'] !== 'boolean') return null;
        actions.push({ type: 'boost', active: entry['active'] });
        break;
      }
      case 'ping': {
        const at = parseVec(entry['at'], MAX_WORLD_COORD);
        if (!at) return null;
        actions.push({ type: 'ping', at });
        break;
      }
      default:
        return null;
    }
  }
  return actions;
}

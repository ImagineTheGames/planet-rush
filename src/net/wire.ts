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
 *
 * **The wire speaks every verb the game speaks, and drops forward-compatibly.**
 * Two rules keep the protocol from quietly amputating gameplay (M10 QA
 * "the wire refuses verbs the game speaks", where `upgradeOrder` was absent from
 * the switch and `satellite` absent from the build-item set, so online players
 * could buy neither an upgrade nor a satellite — silently, because the whole
 * message was rejected):
 *
 *  1. The verb tables here are **pinned to the shared union at compile time**
 *     ({@link BUILD_ITEM_TABLE}, and {@link ACTION_TYPE_TABLE} beside the switch
 *     that must handle them). A new `BuildItem` or a new `Action` in
 *     `@shared/types` fails `tsc` right here until the wire learns it, and
 *     `./protocol-parity.test.ts` enumerates the same unions and asserts each one
 *     actually parses.
 *  2. An **unknown** verb drops *that action*, not the message. A client one
 *     version ahead of the server degrades — it loses the verb this server has
 *     never heard of, and keeps the five it shares — instead of going silent
 *     because every one of its inputs was refused whole. The drop is counted into
 *     the session log (`./playtest-log`) so the asymmetry is visible rather than
 *     inferred. A **known** verb with a malformed payload is still refused whole:
 *     that is a validation failure, not a version skew, and a partially-applied
 *     tick is a worse lie than a missing one.
 */

import type { Action, ActionType, BuildItem, Vec2 } from '@shared/types';
import { ShipClass, UpgradeTrack } from '@shared/types';
import { playtestLog } from './playtest-log';
import type { MatchMode } from '../sim/match-config';
import type {
  BotDifficulty,
  ClientMessage,
  FireMode,
  LobbySeatState,
  RoomCode,
  ServerMessage,
} from './transport';

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Wire format version. Bumped whenever a frame layout changes; a client and a
 * server that disagree here disagree about everything, so it is checked.
 *
 * **v2 (M10 tick-alignment)** — two changes to the snapshot frame, both of which a
 * v1 reader would misread rather than reject, which is exactly what a version byte
 * is for: the header gained `ackTick` (`./transport` `SnapshotMessage`), and the
 * payload's positions and velocities became eighths of a world unit rather than
 * whole ones (`./snapshot` `POS_SCALE`) — a v1 client decoding a v2 payload would
 * draw the entire match at an eighth scale.
 */
export const WIRE_VERSION = 2;

/** First byte of a binary frame: this is a snapshot. Room for more binary
 *  frame kinds later (a binary input frame is the obvious next one). */
export const FRAME_SNAPSHOT = 0x01;

/** kind u8 · version u8 · tick u32 · ackSeq u32 · ackTick u32, little-endian.
 *  The last field is the M10 alignment instrument: the tick `ackSeq` was run at
 *  (`./transport` `SnapshotMessage.ackTick`). Four bytes, thirty times a second —
 *  120 B/s per client against the ~15 KB/s the snapshots themselves cost. */
export const SNAPSHOT_FRAME_HEADER_BYTES = 14;

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

/** Longest ABANDON-MATCH reason the server will keep (`./transport` LeaveMessage).
 *  It is a log string and nothing branches on it, so it is truncated rather than
 *  refused — but it is still attacker-supplied text on its way to a server log. */
export const MAX_LEAVE_REASON_CHARS = 64;

/** Most actions one input message may carry. The action union has six verbs and
 *  a tick sensibly carries at most one of each; the two spare slots are the
 *  headroom a client one version ahead sends its new verbs in (dropped, not
 *  fatal — see {@link parseActions}). Anything past that is a client trying to
 *  make the server do arithmetic on its behalf. */
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
      // The match SHAPE the host is on (m10 teams-wire): the mode and the per-seat
      // side. Both are optional and both are dropped rather than refused when
      // malformed — a bad team array must not cost the sender their hull pick, and
      // the server ignores them from anyone but the creator anyway.
      const mode = parseMatchMode(raw['mode']);
      const teams = parseTeams(raw['teams']);
      // …and the per-seat OPEN / BOT / CLOSED authoring (a0-11), on the same
      // dropped-not-refused terms as the two above.
      const seats = parseSeatStates(raw['seats']);
      return {
        type: 'lobbyChoice',
        shipClass,
        fireMode,
        ...(difficulties ? { botDifficulties: difficulties } : {}),
        ...(mode ? { mode } : {}),
        ...(teams ? { teams } : {}),
        ...(seats ? { seats } : {}),
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
    // The latency probe (`./transport` PingMessage, M10 item 6). One bounded number,
    // echoed back untouched — the id is the client's own bookkeeping and the server
    // reads no meaning into it, so there is nothing here to validate but its shape.
    case 'ping': {
      const id = raw['id'];
      if (!isCount(id)) return null;
      return { type: 'ping', id };
    }
    // ABANDON MATCH (`./transport` LeaveMessage): the one client message whose
    // whole content is its own arrival. The reason is a log string — bounded like
    // every other field on this hostile surface, and dropped rather than refused
    // when it is the wrong shape, because a malformed *reason* must not cost a
    // player the clean exit they asked for.
    case 'leave': {
      const reason = raw['reason'];
      const clean = typeof reason === 'string' ? reason.slice(0, MAX_LEAVE_REASON_CHARS) : null;
      return { type: 'leave', ...(clean !== null && clean.length > 0 ? { reason: clean } : {}) };
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
  dv.setUint32(10, message.ackTick >>> 0, true);
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
    ackTick: dv.getUint32(10, true),
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
  // The wallet's own channel (`./transport` EconomyMessage): held ore, banked ore
  // and upgrade tiers for the recipient's own seat, on the ticks they change. Text,
  // like everything that is not a snapshot — it is low-frequency by construction.
  'economy',
  // What authority did with one identified order (`./transport` OrderEchoMessage).
  // Without it here `parseServerMessage` drops the frame, no prediction is ever
  // settled, and every order the player places is rolled back at its TTL — the
  // exact opposite of the bug this channel exists to close.
  'orderEcho',
  'matchEnd',
  // The latency probe's answer (`./transport` PongMessage, M10 item 6). Without it
  // here the frame is dropped, the client measures no network RTT, and every number
  // it shows a player is the ack-based composite with its own lead baked in.
  'pong',
  // A refused join (server/match-server.ts). Without it here parseServerMessage
  // drops the frame, the transport never learns *why* the socket then closed, and
  // a wrong-machine `bad-ticket` reads as a plain drop → a 60 s reconnect loop and
  // an eternal "connecting" screen (M10). Parsed so the transport can end honestly.
  'joinError',
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

/** The match mode a host's `lobbyChoice` claims (m10 teams-wire), or null for
 *  absent/unknown — the server then keeps the mode the room was allocated with. */
function parseMatchMode(value: unknown): MatchMode | null {
  return value === 'ffa' || value === 'teams' ? value : null;
}

/**
 * The host's per-seat team assignment (m10 teams-wire). Bounded like every other
 * field on this hostile surface: at most one entry per seat, each a small
 * non-negative integer.
 *
 * The ceiling is {@link MAX_TEAMS_ON_WIRE} rather than "any number", because the
 * values are compared for equality alone (`src/sim/allegiance`) and an unbounded
 * one buys a sender nothing but a way to feed the roster a `1e308`. Anything
 * malformed returns null and the whole array is dropped — the room then keeps the
 * sides it already had, which is always a legal match.
 */
function parseTeams(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAYERS) return null;
  const out: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return null;
    if (entry < 0 || entry >= MAX_TEAMS_ON_WIRE) return null;
    out.push(entry);
  }
  return out;
}

/** Sides a room can split into on the wire — the lobby's `MAX_TEAMS` ceiling
 *  (`src/ui/lobby`), restated here because the wire may not import the UI. Eight
 *  seats can never usefully hold more sides than the lobby can author. */
export const MAX_TEAMS_ON_WIRE = 4;

/**
 * The host's per-seat OPEN / BOT / CLOSED authoring (`./transport`
 * {@link LobbySeatState}, a0-11), bounded like every other array on this hostile
 * surface: at most eight entries, each one of exactly three words.
 *
 * Rejected whole rather than per-entry, like {@link parseTeams}: a roster with one
 * unreadable seat is a roster whose *indices* can no longer be trusted, and
 * silently dropping one entry would shift every seat after it by one — which is
 * the same class of off-by-one that would hand seat 5's difficulty to seat 2.
 */
function parseSeatStates(value: unknown): LobbySeatState[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAYERS) return null;
  const out: LobbySeatState[] = [];
  for (const entry of value) {
    if (entry !== 'open' && entry !== 'bot' && entry !== 'closed') return null;
    out.push(entry);
  }
  return out;
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

/**
 * The sentinel {@link parseOrderId} returns for an id that is present but
 * malformed — told apart from `null` ("absent, and that is fine") because the two
 * demand opposite answers. An absent id is an *older client*, which must keep
 * working (the field is optional, `@shared/types` `OrderId`). A malformed one is a
 * hostile or broken sender naming an id the dedupe table would then key on, and it
 * takes the whole message down like every other known-verb-bad-payload does.
 */
const INVALID_ORDER_ID = -1;

/**
 * The client sequence id on a one-shot order (`@shared/types` `OrderId`) — absent
 * (`null`), well-formed (the number), or malformed ({@link INVALID_ORDER_ID}).
 *
 * Bounded like every other field on this surface: it is a key in a per-slot dedupe
 * table on the authoritative server, so a client must not be able to make that
 * table's keys arbitrary. Non-negative safe integers only.
 */
function parseOrderId(value: unknown): number | null {
  if (value === undefined) return null;
  return isCount(value) ? value : INVALID_ORDER_ID;
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

/** World-space coordinate bound for an aim vector — generous, but finite and
 *  bounded so a malformed message can never carry an absurd number into the sim. */
const MAX_WORLD_COORD = 1e6;

/**
 * Every `BuildItem` the wheel can order, as a table rather than a list — the
 * `Record<BuildItem, true>` is the point: a new item in the shared union fails to
 * compile here until the wire names it. `satellite` was missing from the old
 * hand-written list, which is exactly how a ratified feature (f1, the radar
 * satellite) shipped unbuildable online.
 */
const BUILD_ITEM_TABLE: Record<BuildItem, true> = {
  turret: true,
  shield: true,
  satellite: true,
  repair: true,
  bank: true,
};
const BUILD_ITEMS: ReadonlySet<string> = new Set(Object.keys(BUILD_ITEM_TABLE));

/** Every upgrade track, straight off the shared enum — no restatement to drift
 *  from. A new track is on the wire the moment `@shared/types` has it. */
const UPGRADE_TRACKS: ReadonlySet<string> = new Set<string>(Object.values(UpgradeTrack));

/**
 * Every action verb {@link parseActions} handles, pinned to the shared `Action`
 * union. Adding a verb to `@shared/types` fails to compile here, and the switch
 * below is the thing that must then grow a `case` — the compiler points at the
 * table, `./protocol-parity.test.ts` proves the case exists and works.
 */
const ACTION_TYPE_TABLE: Record<ActionType, true> = {
  thrust: true,
  aim: true,
  fire: true,
  build: true,
  buildOrder: true,
  upgradeOrder: true,
};

/** The verbs this build of the wire understands — read by the parity test, and
 *  the honest answer to "what can a client send me?". */
export const WIRE_ACTION_TYPES: ReadonlySet<string> = new Set(Object.keys(ACTION_TYPE_TABLE));

/** How many distinct unknown verb names one dropped message reports into the
 *  session log. The names come off a hostile socket, so they are bounded in both
 *  count and length before anything keeps them. */
const MAX_LOGGED_UNKNOWN_VERBS = 4;
const MAX_LOGGED_VERB_CHARS = 24;

/**
 * Validate one tick's action list.
 *
 * A **known** verb is checked against its own shape, and a failure there rejects
 * the whole message: a partially-applied tick is a worse lie than a missing one.
 *
 * An **unknown** verb drops only itself, and is counted into the session log. The
 * asymmetry is deliberate and is the forward-compatibility rule: a client one
 * version ahead of this server must degrade to the verbs the two share, not go
 * silent because a verb this server has never heard of poisoned every message
 * carrying it (M10 QA — a build where `upgradeOrder` was unknown cost players
 * thrust, aim and fire on every tick they tried to buy an upgrade).
 */
export function parseActions(value: unknown): Action[] | null {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS_PER_MESSAGE) return null;
  const actions: Action[] = [];
  let unknown: string[] | null = null;
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
        const orderId = parseOrderId(entry['orderId']);
        if (orderId === INVALID_ORDER_ID) return null;
        actions.push({
          type: 'buildOrder',
          item: item as BuildItem,
          ...(orderId !== null ? { orderId } : {}),
        });
        break;
      }
      case 'upgradeOrder': {
        // The sibling of `buildOrder` (GDD §2.5): the press on a row of the panel
        // behind the wheel's UPGRADE SHIP arrow. It names a track and nothing
        // else — no tier argument, because a tier is bought one step at a time
        // and the sim decides what the next step costs. Ownership, dock, cost and
        // max-tier are the simulation's to validate; the wire's job is only to
        // refuse a track that does not exist.
        const track = entry['track'];
        if (typeof track !== 'string' || !UPGRADE_TRACKS.has(track)) return null;
        const orderId = parseOrderId(entry['orderId']);
        if (orderId === INVALID_ORDER_ID) return null;
        actions.push({
          type: 'upgradeOrder',
          track: track as UpgradeTrack,
          ...(orderId !== null ? { orderId } : {}),
        });
        break;
      }
      default: {
        // Forward compatibility: drop the verb, keep the tick. See the module
        // header — this is the one case that does not reject the whole message.
        const verb = typeof entry['type'] === 'string' ? entry['type'] : typeof entry['type'];
        (unknown ??= []).push(verb.slice(0, MAX_LOGGED_VERB_CHARS));
        break;
      }
    }
  }
  if (unknown) reportUnknownVerbs(unknown);
  return actions;
}

/**
 * Record dropped verbs in the session log (`./playtest-log`), so a version skew
 * reads as "this server dropped 1 verb it does not know" in an exported log
 * rather than as an input that mysteriously did nothing.
 *
 * The log coalesces identical consecutive lines into a repeat count, so a client
 * spraying an unknown verb every tick costs one entry and a counter — which is
 * also why the *distinct names* are what is logged and not the raw list.
 */
function reportUnknownVerbs(verbs: readonly string[]): void {
  const distinct = [...new Set(verbs)].slice(0, MAX_LOGGED_UNKNOWN_VERBS);
  playtestLog().record('net', 'wire dropped unknown action verbs', {
    count: verbs.length,
    verbs: distinct.join(','),
  });
}

/**
 * src/net/wire.test.ts — the protocol survives the round trip, and the server's
 * front door holds. OWNER: Netcode Engineer.
 *
 * Two things are asserted here, and they are the two ways a wire format fails:
 *
 *  1. **Round trip.** What one end encodes, the other end decodes back into the
 *     same message — snapshots included, since a snapshot is the one frame that
 *     is binary and therefore the one frame a stray byte silently corrupts.
 *  2. **Refusal.** Everything a hostile or broken client can send is rejected
 *     rather than coerced. A `NaN` in a thrust vector, a tick of `-1`, an
 *     unbounded action list, a message type nobody implements: all null.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import { playtestLog, resetPlaytestLog } from './playtest-log';
import { decodeSnapshot, encodeSnapshot } from './snapshot';
import type { ProjSnap, ShipSnap } from './snapshot';
import type { ClientMessage, ServerMessage } from './transport';
import {
  MAX_ACTIONS_PER_MESSAGE,
  SNAPSHOT_FRAME_HEADER_BYTES,
  WIRE_VERSION,
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseRoomCode,
  parseServerMessage,
} from './wire';

function ship(id: number): ShipSnap {
  return {
    id,
    posX: 100 * id - 400,
    posY: 250 - 30 * id,
    velX: -12 * id || 0, // `|| 0` so slot zero is 0 rather than -0 on the wire
    velY: 7 * id,
    heading: (id * 8191) & 0xffff,
    hull: 50 - id,
    flags: 0b0111,
  };
}

function projectile(id: number): ProjSnap {
  return { id, posX: -300 + id * 11, posY: 400 - id * 9, meta: id & 0x7 };
}

describe('client → server', () => {
  it('round-trips every client verb', () => {
    const messages: ClientMessage[] = [
      { type: 'join', room: 'QK7P' },
      { type: 'join', room: 'QK7P', reclaim: 3, reclaimToken: 'abc123' },
      {
        type: 'lobbyChoice',
        shipClass: ShipClass.Hauler,
        fireMode: 'auto',
        botDifficulties: ['easy', 'hard'],
      },
      { type: 'startMatch' },
      {
        type: 'input',
        tick: 4211,
        seq: 91,
        actions: [
          { type: 'thrust', dir: { x: 0.5, y: -1 } },
          { type: 'fire', active: true, auto: false },
          { type: 'buildOrder', item: 'turret' },
          // The two verbs the M10 wire ate: a satellite order and a panel
          // purchase. Both are gameplay the online game simply did not have.
          { type: 'buildOrder', item: 'satellite' },
          { type: 'upgradeOrder', track: UpgradeTrack.Power },
        ],
      },
    ];

    for (const message of messages) {
      expect(parseClientMessage(encodeClientMessage(message))).toEqual(message);
    }
  });

  it('normalizes a room code the way a human types it', () => {
    expect(parseRoomCode('  qk7p ')).toBe('QK7P');
    expect(parseRoomCode('qk-7p')).toBeNull();
    expect(parseRoomCode('')).toBeNull();
    expect(parseRoomCode('TOOLONGACODE')).toBeNull();
    expect(parseRoomCode(42)).toBeNull();
  });

  it('clamps thrust into the analog range the input layer promises', () => {
    const parsed = parseClientMessage(
      JSON.stringify({
        type: 'input',
        tick: 1,
        seq: 1,
        actions: [{ type: 'thrust', dir: { x: 40, y: -40 } }],
      }),
    );
    expect(parsed).toEqual({
      type: 'input',
      tick: 1,
      seq: 1,
      actions: [{ type: 'thrust', dir: { x: 1, y: -1 } }],
    });
  });

  it('refuses everything a broken or hostile client can send', () => {
    const hostile: unknown[] = [
      'not json at all',
      JSON.stringify(null),
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ type: 'nonsense' }),
      // A non-finite vector is the classic way to smuggle NaN into a sim.
      JSON.stringify({
        type: 'input',
        tick: 1,
        seq: 1,
        actions: [{ type: 'thrust', dir: { x: 'NaN', y: 0 } }],
      }),
      // Negative and fractional ticks are not ticks.
      JSON.stringify({ type: 'input', tick: -1, seq: 1, actions: [] }),
      JSON.stringify({ type: 'input', tick: 1.5, seq: 1, actions: [] }),
      // An unbounded action list is work the server did not agree to do.
      JSON.stringify({
        type: 'input',
        tick: 1,
        seq: 1,
        actions: Array.from({ length: MAX_ACTIONS_PER_MESSAGE + 1 }, () => ({
          type: 'build',
          active: true,
        })),
      }),
      // A build order for something that is not on the wheel (GDD §2.5).
      JSON.stringify({ type: 'input', tick: 1, seq: 1, actions: [{ type: 'buildOrder', item: 'battleship' }] }),
      // A known verb with a payload that names nothing: `upgradeOrder` is parsed
      // now, but a track the enum does not define is still refused. Forward
      // compatibility is for verbs the server has never heard of — not for a
      // verb it knows, carrying a value it knows to be wrong.
      JSON.stringify({ type: 'input', tick: 1, seq: 1, actions: [{ type: 'upgradeOrder', track: 'luck' }] }),
      JSON.stringify({ type: 'input', tick: 1, seq: 1, actions: [{ type: 'upgradeOrder' }] }),
      // A hull that does not exist — four classes ship, and no others (§2.11).
      JSON.stringify({ type: 'lobbyChoice', shipClass: 'dreadnought', fireMode: 'manual' }),
      JSON.stringify({ type: 'join', room: 'ok', reclaim: 99 }),
    ];

    for (const frame of hostile) {
      expect(parseClientMessage(frame as string)).toBeNull();
    }
  });

  it('drops a binary frame from a client — clients never send binary', () => {
    expect(parseClientMessage(new ArrayBuffer(16))).toBeNull();
  });

  it('keeps an out-of-range reclaim slot out of the message rather than trusting it', () => {
    // `reclaim: 99` above is rejected outright; a *valid* slot survives.
    expect(parseClientMessage(JSON.stringify({ type: 'join', room: 'QK7P', reclaim: 7 }))).toEqual({
      type: 'join',
      room: 'QK7P',
      reclaim: 7,
    });
  });
});

/**
 * The blast radius rule (M10). Before this, ONE action the wire did not recognize
 * returned `null` for the entire message — so a client one version ahead of the
 * server did not lose its new verb, it lost *every* verb: thrust, aim and fire
 * all went with it, every tick, and the ship simply stopped responding. A player
 * cannot tell that apart from a dead connection.
 */
describe('a client one version ahead degrades — it does not go silent', () => {
  beforeEach(() => {
    // The session log is a process-wide singleton; one spec's drops must not be
    // read as the next one's.
    resetPlaytestLog();
  });

  const frameWithFutureVerb = (): string =>
    JSON.stringify({
      type: 'input',
      tick: 900,
      seq: 12,
      actions: [
        { type: 'thrust', dir: { x: 0, y: -1 } },
        { type: 'tractorBeam', target: 4 }, // a verb from a build this server has never seen
        { type: 'upgradeOrder', track: UpgradeTrack.Speed },
      ],
    });

  it('drops the unknown action and keeps the rest of the tick', () => {
    expect(parseClientMessage(frameWithFutureVerb())).toEqual({
      type: 'input',
      tick: 900,
      seq: 12,
      actions: [
        { type: 'thrust', dir: { x: 0, y: -1 } },
        { type: 'upgradeOrder', track: UpgradeTrack.Speed },
      ],
    });
  });

  it('counts the dropped verbs into the session log', () => {
    parseClientMessage(frameWithFutureVerb());
    const dropped = playtestLog().events.filter((e) => e.msg.includes('unknown action verb'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.kind).toBe('net');
    expect(dropped[0]?.data).toMatchObject({ count: 1, verbs: 'tractorBeam' });
  });

  it('says nothing when every verb was understood', () => {
    parseClientMessage(
      JSON.stringify({ type: 'input', tick: 1, seq: 1, actions: [{ type: 'build', active: true }] }),
    );
    expect(playtestLog().events.filter((e) => e.msg.includes('unknown action verb'))).toEqual([]);
  });

  it('bounds what a hostile client can write into the log', () => {
    // The verb names come off a socket: distinct names only, capped in count and
    // length, so a spray of junk verbs cannot become a log full of attacker text.
    parseClientMessage(
      JSON.stringify({
        type: 'input',
        tick: 1,
        seq: 1,
        actions: [
          { type: 'a'.repeat(200) },
          { type: 'v2' },
          { type: 'v3' },
          { type: 'v4' },
          { type: 'v5' },
          { type: 'v5' },
        ],
      }),
    );
    const dropped = playtestLog().events.filter((e) => e.msg.includes('unknown action verb'));
    expect(dropped[0]?.data?.['count']).toBe(6);
    const verbs = String(dropped[0]?.data?.['verbs']);
    expect(verbs.split(',')).toHaveLength(4); // capped at four distinct names
    expect(verbs.length).toBeLessThan(120);
  });

  it('still refuses an action list longer than the bound', () => {
    // Forward compatibility is not an exemption from the size bound: a client
    // cannot buy unbounded parsing by making its actions unrecognizable.
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'input',
          tick: 1,
          seq: 1,
          actions: Array.from({ length: MAX_ACTIONS_PER_MESSAGE + 1 }, () => ({ type: 'whoKnows' })),
        }),
      ),
    ).toBeNull();
  });

  it('still refuses an action that is not even an object', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'input', tick: 1, seq: 1, actions: ['thrust', 7] })),
    ).toBeNull();
  });
});

describe('server → client', () => {
  it('round-trips the JSON server messages', () => {
    const messages: ServerMessage[] = [
      { type: 'welcome', you: 2, room: 'QK7P', tick: 0, reclaimToken: 'deadbeef' },
      {
        type: 'lobbyState',
        slots: [{ player: 0, isBot: false, shipClass: ShipClass.Vanguard, ready: true }],
      },
      {
        type: 'matchStart',
        tick: 0,
        seed: 1234,
        slots: [{ player: 0, shipClass: ShipClass.Hauler }],
        bounds: { width: 1200, height: 1200 },
        asteroidCount: 12,
      },
      { type: 'entityEvent', tick: 12, kind: 'turret', op: 'spawn', data: { id: 4 } },
      { type: 'playerSubstituted', player: 5, graceSeconds: 60 },
      { type: 'playerReclaimed', player: 5 },
      // The reclaim welcome hands back the wallet the snapshot never carries, and
      // the economy channel keeps it true for the rest of the match — fractional
      // held ore and all (QA m10 "economy-not-on-wire", GDD §4.2).
      {
        type: 'welcome',
        you: 5,
        room: 'QK7P',
        tick: 9_000,
        reclaimToken: 'cafef00d',
        economy: { held: 2.5, banked: 41, tiers: { power: 3, engine: 0, cargo: 1, hull: 2, speed: 0 } },
      },
      {
        type: 'economy',
        player: 5,
        tick: 9_042,
        economy: { held: 0.25, banked: 44, tiers: { power: 3, engine: 0, cargo: 1, hull: 2, speed: 0 } },
      },
      { type: 'matchEnd', winner: 3, tick: 44_100 },
      // A refused join must survive the round trip, or the transport cannot tell a
      // rejection from a plain drop and spins the reconnect loop forever (M10).
      { type: 'joinError', reason: 'bad-ticket' },
    ];

    for (const message of messages) {
      expect(parseServerMessage(encodeServerMessage(message))).toEqual(message);
    }
  });

  it('round-trips a binary snapshot frame, ships and projectiles intact', () => {
    const ships = Array.from({ length: 8 }, (_, i) => ship(i));
    const projectiles = Array.from({ length: 64 }, (_, i) => projectile(i));
    const payload = encodeSnapshot(4096, ships, projectiles);

    const frame = encodeServerMessage({ type: 'snapshot', tick: 4096, ackSeq: 77, payload });
    expect(frame).toBeInstanceOf(ArrayBuffer);
    expect((frame as ArrayBuffer).byteLength).toBe(SNAPSHOT_FRAME_HEADER_BYTES + payload.byteLength);

    const decoded = parseServerMessage(frame);
    expect(decoded?.type).toBe('snapshot');
    if (decoded?.type !== 'snapshot') return;
    expect(decoded.tick).toBe(4096);
    expect(decoded.ackSeq).toBe(77);

    // The payload the client pulls out of the frame is the payload the server
    // packed — byte for byte, and record for record after decoding.
    const snapshot = decodeSnapshot(decoded.payload);
    expect(snapshot.tick).toBe(4096);
    expect(snapshot.ships).toEqual(ships);
    expect(snapshot.projectiles).toEqual(projectiles);
  });

  it('refuses a binary frame it cannot read', () => {
    const truncated = new ArrayBuffer(SNAPSHOT_FRAME_HEADER_BYTES - 1);
    expect(parseServerMessage(truncated)).toBeNull();

    // A frame from a future protocol: refused, not misread.
    const wrongVersion = new ArrayBuffer(SNAPSHOT_FRAME_HEADER_BYTES);
    new DataView(wrongVersion).setUint8(0, 0x01);
    new DataView(wrongVersion).setUint8(1, WIRE_VERSION + 1);
    expect(parseServerMessage(wrongVersion)).toBeNull();
  });
});

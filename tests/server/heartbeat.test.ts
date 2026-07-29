/**
 * tests/server/heartbeat.test.ts — a Machine's identity, its load, and the beat
 * that keeps it in the fleet. OWNER: Netcode Engineer (M9 fleet membership).
 *
 * Everything the match server needs to tell the allocator it is alive is here,
 * and every piece is exercised with no timer and no socket: lag arrives as
 * injected monotonic readings, posting is a fake, and the drain switch is a
 * plain flag. The one cross-process fact these tests also pin is *shape* — a body
 * this producer composes must be a heartbeat the allocator's registry accepts —
 * so the last block feeds a composed beat straight into `InMemoryRoomRegistry`
 * and watches it learn the Machine.
 */

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@shared/types';
import { DEFAULT_LIVENESS_MS, InMemoryRoomRegistry } from '../../allocator/registry';
import { Allocator } from '../../allocator/allocator';
import { MatchServer } from '../../server/match-server';
import { encodeClientMessage } from '../../src/net/wire';
import {
  Cordon,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  EventLoopLagMonitor,
  HeartbeatReporter,
  LagProbe,
  buildHeartbeat,
  buildRegistration,
  readMachineIdentity,
} from '../../server/heartbeat';
import type {
  HeartbeatBody,
  HeartbeatPoster,
  HeartbeatSource,
  MachineIdentity,
} from '../../server/heartbeat';

const IDENTITY: MachineIdentity = { machine: 'iad-7', region: 'iad' };

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('readMachineIdentity', () => {
  it('reads the explicit MACHINE_ID and REGION pair', () => {
    expect(readMachineIdentity({ MACHINE_ID: 'm-3', REGION: 'ord' })).toEqual({
      machine: 'm-3',
      region: 'ord',
    });
  });

  it('falls back to Fly\'s FLY_MACHINE_ID and FLY_REGION', () => {
    expect(readMachineIdentity({ FLY_MACHINE_ID: 'fly-1', FLY_REGION: 'lhr' })).toEqual({
      machine: 'fly-1',
      region: 'lhr',
    });
  });

  it('prefers the explicit vars over the Fly ones when both are present', () => {
    expect(
      readMachineIdentity({
        MACHINE_ID: 'm-3',
        FLY_MACHINE_ID: 'fly-1',
        REGION: 'ord',
        FLY_REGION: 'lhr',
      }),
    ).toEqual({ machine: 'm-3', region: 'ord' });
  });

  it('is empty strings when nothing is set — the solo run that never beats', () => {
    expect(readMachineIdentity({})).toEqual({ machine: '', region: '' });
  });
});

// ---------------------------------------------------------------------------
// Event-loop lag — the load signal
// ---------------------------------------------------------------------------

describe('EventLoopLagMonitor', () => {
  it('reports zero before any sample', () => {
    expect(new EventLoopLagMonitor().p99()).toBe(0);
    expect(new EventLoopLagMonitor().count).toBe(0);
  });

  it('reports the tail, not the typical — a burst of stalls surfaces in p99', () => {
    const m = new EventLoopLagMonitor();
    for (let i = 0; i < 98; i++) m.record(1); // healthy loop, ~1ms over
    m.record(250); // a stall that spans...
    m.record(250); // ...a couple of consecutive samples (the top 1% of 100)
    // Nearest-rank q=0.99 over 100 samples lands on the 99th value = the stall.
    expect(m.p99()).toBe(250);
  });

  it('does not let a lone one-off (below the 1% tail) move p99', () => {
    const m = new EventLoopLagMonitor();
    for (let i = 0; i < 99; i++) m.record(1);
    m.record(250); // a single spike is p100, not p99 — the typical is still ~1ms
    expect(m.p99()).toBe(1);
  });

  it('floors a slightly-early sample to zero — lag is overshoot, never undershoot', () => {
    const m = new EventLoopLagMonitor();
    m.record(-3);
    expect(m.p99()).toBe(0);
    expect(m.count).toBe(1);
  });

  it('drops a non-finite reading rather than poisoning the window', () => {
    const m = new EventLoopLagMonitor();
    m.record(Number.NaN);
    m.record(Number.POSITIVE_INFINITY);
    expect(m.count).toBe(0);
  });

  it('forgets samples past its window, so load reflects recent health', () => {
    const m = new EventLoopLagMonitor(4);
    m.record(500); // this old stall...
    m.record(1);
    m.record(1);
    m.record(1);
    m.record(1); // ...is now evicted by the fifth sample
    expect(m.count).toBe(4);
    expect(m.p99()).toBe(1);
  });
});

describe('LagProbe', () => {
  it('anchors on the first reading and measures overshoot thereafter', () => {
    const monitor = new EventLoopLagMonitor();
    const probe = new LagProbe(monitor, 500);

    probe.sample(1_000); // first firing: nothing to measure against yet
    expect(monitor.count).toBe(0);

    probe.sample(1_500); // exactly on time → ~0 lag
    probe.sample(2_100); // 600ms elapsed against a 500ms interval → 100ms lag
    expect(monitor.count).toBe(2);
    expect(monitor.p99()).toBe(100);
  });

  it('never records negative lag when a timer fires early', () => {
    const monitor = new EventLoopLagMonitor();
    const probe = new LagProbe(monitor, 500);
    probe.sample(1_000);
    probe.sample(1_450); // 450ms elapsed, 50ms early
    expect(monitor.p99()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Draining
// ---------------------------------------------------------------------------

describe('Cordon', () => {
  it('is open until drained, then latched shut', () => {
    const cordon = new Cordon();
    expect(cordon.draining).toBe(false);
    cordon.drain();
    expect(cordon.draining).toBe(true);
    cordon.drain(); // idempotent
    expect(cordon.draining).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The heartbeat body
// ---------------------------------------------------------------------------

describe('buildHeartbeat', () => {
  const rooms = [{ code: 'K7QM', players: 3 }];

  it('carries identity, capacity, rooms, and p99 load', () => {
    expect(
      buildHeartbeat({ identity: IDENTITY, capacity: 64, draining: false, rooms, lagP99Ms: 7 }),
    ).toEqual({
      machine: 'iad-7',
      region: 'iad',
      capacity: 64,
      draining: false,
      rooms,
      load: { eventLoopLagP99Ms: 7 },
    });
  });

  it('advertises zero capacity while draining, but still lists its running rooms', () => {
    const body = buildHeartbeat({
      identity: IDENTITY,
      capacity: 64,
      draining: true,
      rooms,
      lagP99Ms: 2,
    });
    // Zero capacity → the allocator places nothing new here...
    expect(body.capacity).toBe(0);
    expect(body.draining).toBe(true);
    // ...but the rooms already running stay reachable for joins and reconnects.
    expect(body.rooms).toEqual(rooms);
  });
});

describe('buildRegistration (M10)', () => {
  it('announces identity and capacity, with no room list yet', () => {
    expect(buildRegistration({ identity: IDENTITY, capacity: 32, draining: false })).toEqual({
      machine: 'iad-7',
      region: 'iad',
      capacity: 32,
    });
  });

  it('announces zero capacity when it boots already draining', () => {
    expect(buildRegistration({ identity: IDENTITY, capacity: 32, draining: true }).capacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The reporter
// ---------------------------------------------------------------------------

/** A poster that keeps every body it was handed. */
class RecordingPoster implements HeartbeatPoster {
  readonly sent: HeartbeatBody[] = [];
  async post(body: HeartbeatBody): Promise<void> {
    this.sent.push(body);
  }
}

/** A fixed source — a Machine hosting two rooms with 8 slots each. */
const fakeSource = (rooms: { code: string; players: number }[]): HeartbeatSource => ({
  capacity: 64,
  roomLoads: () => rooms,
});

describe('HeartbeatReporter', () => {
  it('composes the current truth: identity, capacity, live rooms, and load', () => {
    const lag = new EventLoopLagMonitor();
    lag.record(4);
    const reporter = new HeartbeatReporter({
      identity: IDENTITY,
      source: fakeSource([{ code: 'K7QM', players: 3 }]),
      cordon: new Cordon(),
      lag,
      poster: new RecordingPoster(),
    });

    expect(reporter.compose()).toEqual({
      machine: 'iad-7',
      region: 'iad',
      capacity: 64,
      draining: false,
      rooms: [{ code: 'K7QM', players: 3 }],
      load: { eventLoopLagP99Ms: 4 },
    });
  });

  it('reflects a cordon the instant it is drained', () => {
    const cordon = new Cordon();
    const reporter = new HeartbeatReporter({
      identity: IDENTITY,
      source: fakeSource([{ code: 'K7QM', players: 1 }]),
      cordon,
      lag: new EventLoopLagMonitor(),
      poster: new RecordingPoster(),
    });

    expect(reporter.compose().capacity).toBe(64);
    cordon.drain();
    expect(reporter.compose().capacity).toBe(0);
    expect(reporter.compose().rooms).toHaveLength(1); // running room still listed
  });

  it('posts the composed body on beat()', async () => {
    const poster = new RecordingPoster();
    const reporter = new HeartbeatReporter({
      identity: IDENTITY,
      source: fakeSource([]),
      cordon: new Cordon(),
      lag: new EventLoopLagMonitor(),
      poster,
    });

    await reporter.beat();
    expect(poster.sent).toHaveLength(1);
    expect(poster.sent[0]?.machine).toBe('iad-7');
  });

  it('swallows a failed post — a dropped beat must not throw into the sim loop', async () => {
    const reporter = new HeartbeatReporter({
      identity: IDENTITY,
      source: fakeSource([]),
      cordon: new Cordon(),
      lag: new EventLoopLagMonitor(),
      poster: {
        post: () => Promise.reject(new Error('allocator unreachable')),
      },
    });
    // The assertion is simply that this resolves rather than rejecting.
    await expect(reporter.beat()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The cross-process contract: a match server's beat is a valid heartbeat
// ---------------------------------------------------------------------------

describe('the beat a MatchServer produces is one the allocator learns from', () => {
  it('flows the server\'s real capacity and rooms into a body the registry accepts', () => {
    // A real match server, a room opened by a real join (no ticket enforcement).
    const server = new MatchServer({ seed: 0x5eed });
    server.update(1_000_000);
    const code = server.createCode();
    server.connect({ send: () => {}, close: () => {} }).receive(
      encodeClientMessage({ type: 'join', room: code }),
    );

    const reporter = new HeartbeatReporter({
      identity: IDENTITY,
      source: server, // MatchServer satisfies HeartbeatSource structurally
      cordon: new Cordon(),
      lag: new EventLoopLagMonitor(),
      poster: new RecordingPoster(),
    });
    const body = reporter.compose();
    expect(body.capacity).toBe(server.capacity);
    expect(body.rooms.map((r) => r.code)).toContain(code);

    // Feed it to the consumer: the allocator's registry must learn the Machine
    // and be able to locate the room — proof the producer and consumer agree on
    // the wire shape without the server ever importing the allocator.
    const registry = new InMemoryRoomRegistry();
    registry.observe(body, 1_000_000);
    expect(registry.machines(1_000_000).map((m) => m.machine)).toEqual(['iad-7']);
    expect(registry.locate(code, 1_000_000)).toBe('iad-7');
  });

  it('carries each room\'s size, mode, and free seats through to an advertisement (Task C3)', () => {
    // A real match server hosting a size-4 room with one human seated: three
    // seats still joinable, mode ffa.
    const server = new MatchServer({ seed: 0x5eed });
    server.update(1_000_000);
    const code = server.createCode();
    server.openRoom(code, { size: 4, mode: 'ffa' });
    server.connect({ send: () => {}, close: () => {} }).receive(
      encodeClientMessage({ type: 'join', room: code }),
    );

    const reporter = new HeartbeatReporter({
      identity: IDENTITY,
      source: server,
      cordon: new Cordon(),
      lag: new EventLoopLagMonitor(),
      poster: new RecordingPoster(),
    });
    const body = reporter.compose();
    const room = body.rooms.find((r) => r.code === code);
    expect(room).toMatchObject({ players: 1, size: 4, mode: 'ffa', joinableSeats: 3 });

    // The allocator learns it and can advertise the room's shape before a dial.
    const registry = new InMemoryRoomRegistry();
    registry.observe(body, 1_000_000);
    const alloc = new Allocator({ registry, rng: mulberry32(1), secret: 'x' });
    expect(alloc.roomInfo(code, 1_000_000)).toMatchObject({
      size: 4,
      mode: 'ffa',
      joinableSeats: 3,
      joinable: true,
    });
  });

  it('keeps the registry\'s liveness assumption: three missed beats is the window', () => {
    // The heartbeat cadence and the registry's liveness must stay in step: the
    // window is exactly three beats, so one dropped beat is survivable.
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS * 3).toBe(DEFAULT_LIVENESS_MS);
  });
});

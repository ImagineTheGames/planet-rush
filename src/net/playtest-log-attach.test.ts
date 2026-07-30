/**
 * src/net/playtest-log-attach.test.ts — the session, into the log
 * (`./playtest-log-attach`, M10 playtest-log brief §1, §5).
 *
 * The brief names one of these explicitly — *"joinError path populates the log"* —
 * because that is the exact report the Director's probes cannot see: the player is
 * told "couldn't connect", the fleet says it is healthy, and the server's own reason
 * for refusing the join is lost between them. It is asserted first.
 *
 * The rest is the discipline that keeps a bounded ring useful: per-tick traffic
 * (snapshots, entity events) must NOT be logged, per-second telemetry must be copied
 * exactly once, and a connection state change must carry the reason the transport
 * gave. All of it runs against a fake session — four fields and an observer list, the
 * same structural slice the module reads.
 */

import { describe, expect, it } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import { attachSessionLog, describeSample } from './playtest-log-attach';
import type { LoggedSession, LoggedWorld } from './playtest-log-attach';
import { ShipClass } from '@shared/types';
import type { ConnectionState, ServerMessage } from './transport';
import type { TelemetrySample } from './telemetry';

function newLog(): PlaytestLog {
  return new PlaytestLog({ env: describeEnvironment({ sha: 'abc1234' }) });
}

/** A one-second telemetry sample, as `NetTelemetry` finalizes them. */
function sample(atMs: number, over: Partial<TelemetrySample> = {}): TelemetrySample {
  return {
    atMs,
    reconciles: 30,
    mispredictions: 3,
    mispredictionRate: 0.1,
    correctionMeanUnits: 0.4,
    correctionMaxUnits: 2.5,
    rttMeanMs: 148.6,
    rttMaxMs: 210.2,
    resyncs: 0,
    ...over,
  };
}

/** A session double: mutable state the test drives, plus a message pump. */
function fakeSession(over: Partial<LoggedSession> = {}): LoggedSession & {
  emit: (message: ServerMessage) => void;
  setState: (state: ConnectionState) => void;
  samples: TelemetrySample[];
  world: LoggedWorld | null;
  closeReason: string | null;
  rejectReason: string | null;
} {
  const observers: ((message: ServerMessage) => void)[] = [];
  const samples: TelemetrySample[] = [];
  const session = {
    you: 2,
    state: 'connecting' as ConnectionState,
    telemetry: { get samples(): readonly TelemetrySample[] { return samples; } },
    world: null as LoggedWorld | null,
    closeReason: null as string | null,
    rejectReason: null as string | null,
    observe: (handler: (message: ServerMessage) => void): void => void observers.push(handler),
    emit: (message: ServerMessage): void => observers.forEach((h) => h(message)),
    setState: (state: ConnectionState): void => void (session.state = state),
    samples,
    ...over,
  };
  return session;
}

describe('the joinError path', () => {
  it('populates the log with the server’s own reason', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });

    session.emit({ type: 'joinError', reason: 'ticket expired' });

    const event = log.events.find((e) => e.msg === 'joinError')!;
    expect(event.kind).toBe('connect');
    expect(event.data!['reason']).toBe('ticket expired');
  });

  it('records the terminal close and its reason alongside it', () => {
    const log = newLog();
    const session = fakeSession();
    const handle = attachSessionLog({ log, session });

    session.emit({ type: 'joinError', reason: 'room full' });
    session.setState('closed');
    session.closeReason = 'join-rejected';
    session.rejectReason = 'room full';
    handle.poll();

    const closed = log.events.find((e) => e.msg === 'state closed')!;
    expect(closed.data!['closeReason']).toBe('join-rejected');
    expect(closed.data!['rejectReason']).toBe('room full');
  });
});

describe('the connection lifecycle', () => {
  it('records the welcome — seat, room and tick — but never the reclaim token', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });

    session.emit({ type: 'welcome', you: 2, room: 'QRST', tick: 480, reclaimToken: 's3cr3t' });

    const welcome = log.events.find((e) => e.msg === 'welcome')!;
    expect(welcome.data).toEqual({ seat: 2, room: 'QRST', tick: 480, reclaimable: true });
    expect(log.toJson()).not.toContain('s3cr3t');
  });

  it('logs every state transition exactly once', () => {
    const log = newLog();
    const session = fakeSession();
    const handle = attachSessionLog({ log, session });

    handle.poll(); // connecting
    handle.poll(); // unchanged — no second line
    session.setState('open');
    handle.poll();
    session.setState('reconnecting');
    handle.poll();
    handle.poll();

    expect(log.events.map((e) => e.msg)).toEqual([
      'state connecting',
      'state open',
      'state reconnecting',
    ]);
  });
});

describe('the per-second telemetry', () => {
  it('copies each finalized sample into the log exactly once', () => {
    const log = newLog();
    const session = fakeSession();
    const handle = attachSessionLog({ log, session });

    session.samples.push(sample(1_000));
    handle.poll();
    handle.poll(); // nothing new
    session.samples.push(sample(2_000, { rttMeanMs: 152 }));
    handle.poll();

    const samples = log.events.filter((e) => e.kind === 'net');
    expect(samples).toHaveLength(2);
    expect(samples[0]!.data!['rtt']).toBe(149);
    expect(samples[1]!.data!['rtt']).toBe(152);
  });

  it('catches up in order when several seconds rolled between polls', () => {
    const log = newLog();
    const session = fakeSession();
    const handle = attachSessionLog({ log, session });

    // A slept tab: three seconds finalized before the next frame ran.
    session.samples.push(sample(1_000, { reconciles: 1 }));
    session.samples.push(sample(2_000, { reconciles: 2 }));
    session.samples.push(sample(3_000, { reconciles: 3 }));
    handle.poll();

    expect(log.events.filter((e) => e.kind === 'net').map((e) => e.data!['recon'])).toEqual([1, 2, 3]);
  });

  it('carries the whole #238 readout: rtt, correction, misprediction rate, snaps', () => {
    const data = describeSample(sample(1_000, { resyncs: 2 }));
    expect(data).toEqual({
      rtt: 149,
      rttMax: 210,
      corr: 0.4,
      corrMax: 2.5,
      mispred: 0.1,
      recon: 30,
      resync: 2,
    });
  });

  it('reports an unmeasured RTT as null rather than as zero', () => {
    const data = describeSample(sample(1_000, { rttMeanMs: null, rttMaxMs: null }));
    expect(data['rtt']).toBeNull();
    expect(data['rttMax']).toBeNull();
  });
});

describe('match events', () => {
  it('records the local ship’s death and respawn off the predicted world', () => {
    const log = newLog();
    const ship = { id: 2, alive: true, eliminated: false };
    const world: LoggedWorld = { tick: 100, ships: [ship, { id: 3, alive: true }] };
    const session = fakeSession({ world });
    const handle = attachSessionLog({ log, session });

    handle.poll(); // primes: alive
    ship.alive = false;
    handle.poll();
    ship.alive = true;
    handle.poll();

    expect(log.events.filter((e) => e.kind === 'match').map((e) => e.msg)).toEqual([
      'death',
      'spawn',
    ]);
  });

  it('does not report a death for the first frame it ever sees', () => {
    const log = newLog();
    const world: LoggedWorld = { tick: 0, ships: [{ id: 2, alive: false }] };
    const handle = attachSessionLog({ log, session: fakeSession({ world }) });

    handle.poll();
    expect(log.events.filter((e) => e.kind === 'match')).toHaveLength(0);
  });

  it('records elimination once, not every frame after it', () => {
    const log = newLog();
    const ship = { id: 2, alive: false, eliminated: false };
    const world: LoggedWorld = { tick: 900, ships: [ship] };
    const handle = attachSessionLog({ log, session: fakeSession({ world }) });

    handle.poll();
    ship.eliminated = true;
    handle.poll();
    handle.poll();
    handle.poll();

    expect(log.events.filter((e) => e.msg === 'eliminated')).toHaveLength(1);
  });

  it('records the reconnect-grace pair, flagging whether it was us', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });

    session.emit({ type: 'playerSubstituted', player: 2, graceSeconds: 60 });
    session.emit({ type: 'playerReclaimed', player: 2 });
    session.emit({ type: 'playerSubstituted', player: 5, graceSeconds: 47 });

    const events = log.events.filter((e) => e.kind === 'match');
    expect(events[0]!.data).toEqual({ player: 2, graceSeconds: 60, isLocal: true });
    expect(events[1]!.data).toEqual({ player: 2, isLocal: true });
    expect(events[2]!.data!['isLocal']).toBe(false);
  });

  it('marks a matchStart past tick 0 as the reclaim replay it is', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });

    session.emit({ type: 'matchStart', tick: 0, seed: 7, slots: [{ player: 2, shipClass: ShipClass.Vanguard }] });
    session.emit({ type: 'matchStart', tick: 1_200, seed: 7, slots: [{ player: 2, shipClass: ShipClass.Vanguard }] });

    const starts = log.events.filter((e) => e.msg === 'matchStart');
    expect(starts[0]!.data!['reclaim']).toBe(false);
    expect(starts[1]!.data!['reclaim']).toBe(true);
  });

  it('records the match end and its winner', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });
    session.emit({ type: 'matchEnd', winner: 5, tick: 3_600 });
    expect(log.events[0]!.data).toEqual({ winner: 5, tick: 3_600 });
  });
});

describe('what is deliberately NOT logged', () => {
  it('ignores per-tick traffic — 30 snapshots a second would spend the whole ring', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });

    for (let tick = 0; tick < 200; tick++) {
      session.emit({ type: 'snapshot', tick, ackSeq: tick, payload: new ArrayBuffer(8) });
      session.emit({ type: 'entityEvent', tick, kind: 'asteroid', op: 'update', data: {} });
    }

    expect(log.events).toHaveLength(0);
  });

  it('stops recording after dispose', () => {
    const log = newLog();
    const session = fakeSession();
    const handle = attachSessionLog({ log, session });
    handle.dispose();

    session.emit({ type: 'joinError', reason: 'ignored' });
    session.setState('closed');
    handle.poll();

    expect(log.events).toHaveLength(0);
  });
});

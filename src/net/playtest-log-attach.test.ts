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
import { ActionJournal } from './action-journal';
import { MAX_ORE_RUN, attachSessionLog, describeAction, describeSample } from './playtest-log-attach';
import type { LoggedOreEvent, LoggedSession, LoggedWorld } from './playtest-log-attach';
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
    rttMinMs: 120.4,
    appliedDeltaMean: 0,
    appliedDeltaMax: 0,
    appliedDeltaSamples: 30,
    rttJitterMs: 12.3,
    networkMeanMs: 26.4,
    networkMinMs: 24.1,
    serverQueueMeanMs: 118.2,
    serverLoopLagMaxMs: 2.4,
    clientLagMeanMs: 1.2,
    clientLagMaxMs: 9.5,
    leadMeanTicks: 11,
    leadMaxTicks: 14,
    resyncs: 0,
    visualSnaps: 0,
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

describe('the action events', () => {
  it('drains the predictor\'s journal into the log, one line per event, once', () => {
    const log = newLog();
    const journal = new ActionJournal();
    const session = fakeSession({ prediction: { actions: journal } });
    const handle = attachSessionLog({ log, session });

    journal.record({ kind: 'volley', tick: 120, inFlight: 2 });
    journal.record({ kind: 'order', tick: 121, orderId: 0x40001, verb: 'buildOrder', what: 'turret' });
    journal.record({ kind: 'echo', tick: 140, orderId: 0x40001, outcome: 'adopt', waited: 19 });
    handle.poll();

    const net = log.events.filter((e) => e.kind === 'net');
    expect(net.map((e) => e.msg)).toEqual(['volley', 'order', 'echo']);
    expect(net[1]!.data).toEqual({ tick: 121, id: 0x40001, verb: 'buildOrder', what: 'turret' });
    expect(net[2]!.data).toEqual({ tick: 140, id: 0x40001, outcome: 'adopt', waited: 19 });

    // Drained: a second poll with nothing new adds nothing, so a paste is not a
    // wall of the same three lines.
    handle.poll();
    expect(log.events.filter((e) => e.kind === 'net')).toHaveLength(3);
  });

  it('says which way an echo went — the two mismatches are the point', () => {
    expect(describeAction({ kind: 'echo', tick: 9, orderId: 7, outcome: 'refused', waited: 30 })).toEqual({
      tick: 9,
      id: 7,
      outcome: 'refused',
      waited: 30,
    });
    // An echo about an order this client never predicted: not an error, and not
    // something a log may pass over in silence either.
    expect(describeAction({ kind: 'echo', tick: 9, orderId: 7, outcome: 'unknown', waited: null })).toMatchObject({
      outcome: 'unknown',
      waited: null,
    });
    // And a prediction nobody ever answered.
    expect(describeAction({ kind: 'expiry', tick: 200, orderId: 7, what: 'shield', waited: 90 })).toEqual({
      tick: 200,
      id: 7,
      what: 'shield',
      waited: 90,
    });
  });

  it('is silent offline, where there is no prediction and no echo', () => {
    const log = newLog();
    const handle = attachSessionLog({ log, session: fakeSession() });
    handle.poll();
    expect(log.events.filter((e) => e.kind === 'net')).toHaveLength(0);
  });
});

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

  it('carries the whole #238 readout plus the audit\'s two: jitter and visual snaps', () => {
    const data = describeSample(sample(1_000, { resyncs: 2, visualSnaps: 4 }));
    expect(data).toEqual({
      rtt: 149,
      rttMax: 210,
      jitter: 12,
      corr: 0.4,
      corrMax: 2.5,
      mispred: 0.1,
      recon: 30,
      resync: 2,
      snap: 4,
      lead: 11,
      // The M10 tick-alignment instrument: how much later the server ran this
      // client's input than the tick it predicted it at.
      align: 0,
      alignMax: 0,
      alignN: 30,
      // The M10 RTT decomposition (item 6): the composite `rtt` above, and the three
      // stages it is actually made of. `rtt 149` beside `net 26` is the whole finding
      // of the developer's gru capture in one line — the wire was never the problem.
      net: 26,
      netMin: 24,
      srvq: 118,
      srvlag: 2,
      cli: 1,
      cliMax: 10,
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

describe('the economy, movement by movement (a0-52)', () => {
  /** One ore-journal event, as `src/sim/ore-journal` writes them. */
  function ore(over: Partial<LoggedOreEvent> = {}): LoggedOreEvent {
    return {
      tick: 100,
      player: 2,
      flow: 'spent',
      item: 'turret',
      amount: 3,
      hold: 3,
      bank: 0,
      holdAfter: 0,
      bankAfter: 0,
      ...over,
    };
  }

  /** A world carrying a journal, as the predicted world does. */
  function worldWith(events: LoggedOreEvent[]): LoggedWorld & { oreJournal: { events: LoggedOreEvent[] } } {
    return { tick: 100, ships: [{ id: 2, alive: true }], oreJournal: { events } };
  }

  it('answers "what did that turret cost me" in one line', () => {
    // The whole reason this exists. a0-52's log carried a session start, a webgl
    // note, two connect lines and eight seconds — nothing that could decide the
    // report either way. This is the line that decides it.
    const log = newLog();
    const world = worldWith([ore({ hold: 5, holdAfter: 2, bank: 1, bankAfter: 1 })]);
    const session = fakeSession();
    session.world = world;
    const handle = attachSessionLog({ log, session });

    handle.poll();

    const spent = log.events.filter((e) => e.msg === 'spent');
    expect(spent).toHaveLength(1);
    expect(spent[0]!.data).toEqual({
      tick: 100,
      player: 2,
      item: 'turret',
      amount: 3,
      hold: 5,
      holdAfter: 2,
      bank: 1,
      bankAfter: 1,
    });
    // Drained by the read, like the action journal: a paste is a timeline, not the
    // same purchase sixty times a second.
    handle.poll();
    expect(log.events.filter((e) => e.msg === 'spent')).toHaveLength(1);
  });

  it('logs the refusal and the overdraft, each on its own line, never folded', () => {
    // A purchase line and its counterpart are what a report about a purchase is
    // made of. Folding two of them together would destroy the only thing they are
    // logged for, so they never merge — even back to back.
    const log = newLog();
    const session = fakeSession();
    session.world = worldWith([
      ore({ flow: 'refused', item: 'shield', amount: 5, hold: 2, holdAfter: 2, bank: 0, bankAfter: 0 }),
      ore({ flow: 'refused', item: 'turret', amount: 3, hold: 2, holdAfter: 2, bank: 0, bankAfter: 0 }),
      ore({ flow: 'refused', item: 'turret', amount: 3, hold: 2, holdAfter: 2, bank: 0, bankAfter: 0 }),
      ore({ flow: 'overdraft', item: 'turret', amount: 3, hold: 2, holdAfter: -1, bank: 0, bankAfter: 0 }),
    ]);
    attachSessionLog({ log, session }).poll();

    // Two refusals of DIFFERENT things are two lines. The two identical ones are
    // the log's own repeat-coalescing (`./playtest-log`), which counts rather than
    // drops them — a distinction this file must not undo by folding first.
    const refusals = log.events.filter((e) => e.msg === 'refused');
    expect(refusals.map((e) => e.data?.item)).toEqual(['shield', 'turret']);
    expect(refusals[1]!.repeat).toBe(2);
    const overdraft = log.events.find((e) => e.msg === 'overdraft');
    // The negative balance, in the log, from before the clamp that would have
    // tidied it into a clean zero (`src/sim/buildings` `spendOre`).
    expect(overdraft?.data).toMatchObject({ item: 'turret', hold: 2, holdAfter: -1 });
  });

  it('folds a run of mining and banking, and keeps the arithmetic true across the fold', () => {
    // A player flying a full hold home banks one ore at a time. Eight of those are
    // one sentence; the ring is 600 events for a whole session.
    const events: LoggedOreEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(ore({ flow: 'mined', item: 'chunk', amount: 1, hold: i, holdAfter: i + 1, bank: 0, bankAfter: 0 }));
    }
    for (let i = 0; i < 4; i++) {
      events.push(
        ore({ flow: 'banked', item: 'drain', amount: 1, hold: 4 - i, holdAfter: 3 - i, bank: i, bankAfter: i + 1 }),
      );
    }
    const log = newLog();
    const session = fakeSession();
    session.world = worldWith(events);
    attachSessionLog({ log, session }).poll();

    const mined = log.events.filter((e) => e.msg === 'mined');
    const banked = log.events.filter((e) => e.msg === 'banked');
    expect(mined).toHaveLength(1);
    expect(banked).toHaveLength(1);
    // First balance in, last balance out, and `n` so nothing is hidden: 0 → 4 in
    // the hold over four chunks, then 4 → 0 out of it and 0 → 4 into the bank.
    expect(mined[0]!.data).toMatchObject({ amount: 4, hold: 0, holdAfter: 4, n: 4 });
    expect(banked[0]!.data).toMatchObject({ amount: 4, hold: 4, holdAfter: 0, bank: 0, bankAfter: 4, n: 4 });
  });

  it('caps a fold, so one long drain cannot become one unreadable line', () => {
    const events = Array.from({ length: MAX_ORE_RUN * 2 + 1 }, (_, i) =>
      ore({ flow: 'mined', item: 'chunk', amount: 1, hold: i, holdAfter: i + 1 }),
    );
    const log = newLog();
    const session = fakeSession();
    session.world = worldWith(events);
    attachSessionLog({ log, session }).poll();

    expect(log.events.filter((e) => e.msg === 'mined')).toHaveLength(3);
  });

  it('logs nothing at all for a world that keeps no journal', () => {
    // Offline worlds other lanes build carry none, and a session with no economy
    // must not become a session with no log (`src/sim/ore-journal`).
    const log = newLog();
    const session = fakeSession();
    session.world = { tick: 4, ships: [{ id: 2, alive: true }] };
    attachSessionLog({ log, session }).poll();

    expect(log.events.filter((e) => e.kind === 'match')).toHaveLength(0);
  });
});

describe('what is deliberately NOT logged', () => {
  it('ignores per-tick traffic — 30 snapshots a second would spend the whole ring', () => {
    const log = newLog();
    const session = fakeSession();
    attachSessionLog({ log, session });

    for (let tick = 0; tick < 200; tick++) {
      session.emit({ type: 'snapshot', tick, ackSeq: tick, ackTick: tick, payload: new ArrayBuffer(8) });
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

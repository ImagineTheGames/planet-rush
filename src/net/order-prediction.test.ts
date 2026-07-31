/**
 * src/net/order-prediction.test.ts — one tap, one turret, on the CLIENT's screen.
 * OWNER: Netcode Engineer (GDD §2.5, §4.2; M10 action-echo).
 *
 * `tests/server/order-idempotence.test.ts` proves the authority builds one turret
 * per tap however many times the wire says it. That is only half the developer's
 * report, because the other half never crossed the wire at all:
 *
 *  1. **The replay bought turrets.** Reconciliation rewinds the *clock* — tick,
 *     time, RNG, entity counter — and replays every unacknowledged input on top of
 *     authority. A `station.builds` entry is not in that checkpoint and cannot be
 *     (the checkpoint is four numbers a tick, not a world copy), so a build job
 *     ordered before a reconcile is still standing when the replay reaches the
 *     press that ordered it — and orders another. At 150 ms RTT that press is
 *     replayed four or five times before its ack lands.
 *  2. **The echo added another.** The predicted turret and the authoritative one
 *     are two objects with two ids, and nothing said they were the same thing.
 *
 * So: an order is predicted **once**, and from then on it belongs to the ledger and
 * to authority's answer (`./order-ledger`). This file holds that line, against the
 * real sim and the real `PredictedMatch`.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { TICK_DT, TURRET, createWorld } from '../sim';
import type { MiningStation, World, WorldConfig } from '../sim';
import { MAX_PREDICTED_SHOTS, PredictedMatch } from './prediction';
import { DEFAULT_ORDER_TTL_TICKS } from './order-ledger';
import { decodeSnapshot, encodeWorldSnapshot } from './snapshot';

const LOCAL: PlayerId = 0;

const MATCH: WorldConfig = {
  seed: 11,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Interceptor },
  ],
  asteroidCount: 6,
};

const ORDER_ID = 0x2a;

/** A predicted match with its ship parked on its own station and ore in the bank —
 *  every assertion below is about how many times an order runs, never about
 *  whether it was legal. */
function standUp(): { match: PredictedMatch; station: MiningStation } {
  const world = createWorld(MATCH);
  const station = world.stations.find((s) => s.owner === LOCAL)!;
  const ship = world.ships.find((s) => s.id === LOCAL)!;
  ship.pos.x = station.pos.x;
  ship.pos.y = station.pos.y;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.banked = 200;
  return { match: new PredictedMatch({ world, localPlayer: LOCAL }), station };
}

const TAP: readonly Action[] = [{ type: 'buildOrder', item: 'turret', orderId: ORDER_ID }];
const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];

/** A snapshot of the predicted world itself, stamped for `tick` — enough to drive
 *  a reconcile whose *position* correction is nil, so what a test sees is the
 *  order handling and nothing else. */
function selfSnapshot(match: PredictedMatch, tick: number): ReturnType<typeof decodeSnapshot> {
  const world = match.world as World;
  const held = world.tick;
  world.tick = tick;
  const decoded = decodeSnapshot(encodeWorldSnapshot(world));
  world.tick = held;
  return decoded;
}

describe('a predicted order runs exactly once', () => {
  it('queues ONE build job from one tap, across many reconciles', () => {
    const { match, station } = standUp();
    match.predict(1, TAP);
    expect(station.builds.length).toBe(1);
    const predictedId = station.builds[0]!.id;

    // Five reconciles with the press still unacknowledged — the exact condition
    // that used to buy five turrets. `ackSeq` stays 0 throughout, so the tap is
    // replayed every single time.
    for (let i = 0; i < 5; i++) {
      match.predict(2 + i, THRUST);
      match.reconcile(selfSnapshot(match, match.tick - 1), 0);
    }

    expect(station.builds.length).toBe(1);
    expect(station.builds[0]!.id).toBe(predictedId);
  });

  it('still replays thrust, aim and fire — the verbs replay is FOR', () => {
    const { match } = standUp();
    const ship = match.world.ships.find((s) => s.id === LOCAL)!;
    // One tick that carries both an order and a stick: the order must not be
    // replayed, and the stick must be, or a reconcile would drop the player's hands.
    match.predict(1, [...TAP, ...THRUST]);
    const afterFirst = ship.vel.x;
    expect(afterFirst).toBeGreaterThan(0);

    match.reconcile(selfSnapshot(match, match.tick), 0);
    // The replay ran the thrust again from the rewound state, so the ship is still
    // moving — the tick was not amputated by the order being stripped out of it.
    expect(ship.vel.x).toBeGreaterThan(0);
  });
});

describe('the echo replaces the prediction', () => {
  it('adopts authority’s job — one job, with authority’s clock', () => {
    const { match, station } = standUp();
    match.predict(1, TAP);
    const predictedId = station.builds[0]!.id;

    // Authority ran the same order four ticks ago and says what it queued.
    const outcome = match.settleOrder({
      orderId: ORDER_ID,
      accepted: true,
      tick: match.tick - 4,
      build: { id: 4242, remaining: TURRET.buildTime, total: TURRET.buildTime },
    });

    expect(outcome?.kind).toBe('adopt');
    // ONE job. The predicted one is gone, authority's stands in its place.
    expect(station.builds.length).toBe(1);
    expect(station.builds[0]!.id).toBe(4242);
    expect(station.builds[0]!.id).not.toBe(predictedId);
    // And it carries the sim's real construction time, wound forward by exactly the
    // ticks this client has run past authority's reading — not an instant turret,
    // and not one that finishes a round trip early (GDD §2.5).
    expect(station.builds[0]!.total).toBeCloseTo(TURRET.buildTime, 5);
    expect(station.builds[0]!.remaining).toBeCloseTo(TURRET.buildTime - 4 * TICK_DT, 5);
    expect(station.builds[0]!.remaining).toBeGreaterThan(0);
  });

  it('grants a job the client refused locally but authority accepted', () => {
    const { match, station } = standUp();
    // The client thinks it is broke (its wallet has not been corrected yet), so it
    // predicts nothing — but the ore was really there and authority spent it.
    match.world.ships.find((s) => s.id === LOCAL)!.banked = 0;
    match.predict(1, TAP);
    expect(station.builds.length).toBe(0);

    match.settleOrder({
      orderId: ORDER_ID,
      accepted: true,
      tick: match.tick,
      build: { id: 55, remaining: TURRET.buildTime, total: TURRET.buildTime },
    });
    // The player paid; the player gets the thing.
    expect(station.builds.map((j) => j.id)).toEqual([55]);
  });

  it('takes a REFUSED order back at once', () => {
    const { match, station } = standUp();
    match.predict(1, TAP);
    expect(station.builds.length).toBe(1);

    match.settleOrder({ orderId: ORDER_ID, accepted: false, tick: match.tick });
    // The ghost turret the player was watching assemble is gone — the truth
    // arriving late, which is the only honest thing to show.
    expect(station.builds.length).toBe(0);
  });
});

describe('construction takes the sim’s real time, online too', () => {
  it('does not run the build clock faster because the wire is slow', () => {
    const { match, station } = standUp();
    // A few ticks of flying first, so the match's clock is past the lag below — a
    // snapshot for a *negative* tick is not a thing a server can send.
    for (let seq = 1; seq <= 20; seq++) match.predict(seq, THRUST);
    match.predict(21, TAP);
    // Authority confirms it on the spot, so the two seconds below are about the
    // construction clock alone and never about the TTL.
    match.settleOrder({
      orderId: ORDER_ID,
      accepted: true,
      tick: match.tick,
      build: { id: 606, remaining: TURRET.buildTime, total: TURRET.buildTime },
    });
    expect(station.builds[0]!.remaining).toBeCloseTo(TURRET.buildTime, 5);

    // A 150 ms wire: the client runs ~9 ticks ahead of the newest snapshot, so
    // every reconcile rewinds and replays those 9 unacknowledged ticks. Before the
    // clocks were frozen across that, each replayed tick took another `dt` off the
    // countdown — construction ran ~10× fast and a ten-second turret landed in
    // under a second. *"Turrets built instantly."*
    const LAG = 9;
    const TICKS = 120; // two seconds of real time
    for (let seq = 22; seq <= TICKS + 21; seq++) {
      match.predict(seq, THRUST);
      // The snapshot describes a tick LAG behind, and acks the input from then —
      // so LAG presses are always in flight and always replayed.
      const at = match.tick - LAG;
      match.reconcile(selfSnapshot(match, at), Math.max(0, seq - LAG));
    }

    // Two seconds have passed, so two seconds have been built — not twenty.
    const elapsed = TICKS * TICK_DT;
    expect(station.builds.length).toBe(1);
    expect(station.builds[0]!.remaining).toBeCloseTo(TURRET.buildTime - elapsed, 1);
    expect(station.builds[0]!.remaining).toBeGreaterThan(TURRET.buildTime * 0.7);
  });
});

describe('the TTL — an order that was never answered', () => {
  it('rolls the prediction back once the deadline passes', () => {
    const { match, station } = standUp();
    match.predict(1, TAP);
    expect(station.builds.length).toBe(1);

    // Reconciles keep arriving; no echo ever does (the order was lost on the way
    // up, or its answer on the way down). Past the TTL the ghost is removed.
    for (let i = 0; i < DEFAULT_ORDER_TTL_TICKS + 4; i++) {
      const seq = 2 + i;
      match.predict(seq, THRUST);
      // Acknowledged input, so the clock is steady and nothing is replayed: what
      // this loop measures is the *order* going unanswered, not a lagging wire.
      match.reconcile(selfSnapshot(match, match.tick), seq);
    }
    expect(station.builds.length).toBe(0);
    expect(match.orders.pending.length).toBe(0);
  });

  it('does NOT roll back an order that was answered inside the window', () => {
    const { match, station } = standUp();
    match.predict(1, TAP);
    match.settleOrder({
      orderId: ORDER_ID,
      accepted: true,
      tick: match.tick,
      build: { id: 9, remaining: TURRET.buildTime, total: TURRET.buildTime },
    });

    for (let i = 0; i < DEFAULT_ORDER_TTL_TICKS + 4; i++) {
      const seq = 2 + i;
      match.predict(seq, THRUST);
      match.reconcile(selfSnapshot(match, match.tick), seq);
    }
    // Still standing, and still authority's job. A TTL that swept settled orders
    // would take turrets away from players who own them.
    expect(station.builds.map((j) => j.id)).toEqual([9]);
  });
});

describe('the action journal — the echo machinery in a pasted log', () => {
  it('records the order, then authority\'s answer, with the wait between them', () => {
    const { match } = standUp();
    match.predict(1, TAP);

    match.settleOrder({
      orderId: ORDER_ID,
      accepted: true,
      tick: match.tick,
      build: { id: 9, remaining: TURRET.buildTime, total: TURRET.buildTime },
    });

    expect(match.actions.pending).toEqual([
      { kind: 'order', tick: 1, orderId: ORDER_ID, verb: 'buildOrder', what: 'turret' },
      { kind: 'echo', tick: 1, orderId: ORDER_ID, outcome: 'adopt', waited: 0 },
    ]);
    // Drained once, so the log never repeats a line (`./playtest-log-attach`).
    expect(match.actions.drain()).toHaveLength(2);
    expect(match.actions.pending).toHaveLength(0);
  });

  it('records a refusal as a refusal, and an id it never predicted as unknown', () => {
    const { match } = standUp();
    match.predict(1, TAP);
    match.actions.drain();

    match.settleOrder({ orderId: ORDER_ID, accepted: false, tick: match.tick });
    match.settleOrder({ orderId: 0xdead, accepted: true, tick: match.tick });

    expect(match.actions.pending.map((e) => e.kind === 'echo' && e.outcome)).toEqual([
      'refused',
      'unknown',
    ]);
  });

  it('records the expiry of a prediction nobody ever answered', () => {
    const { match } = standUp();
    match.predict(1, TAP);
    match.actions.drain();

    for (let i = 0; i < DEFAULT_ORDER_TTL_TICKS + 4; i++) {
      const seq = 2 + i;
      match.predict(seq, THRUST);
      match.reconcile(selfSnapshot(match, match.tick), seq);
    }

    const expiries = match.actions.pending.filter((e) => e.kind === 'expiry');
    expect(expiries).toHaveLength(1);
    expect(expiries[0]).toMatchObject({ orderId: ORDER_ID, what: 'turret' });
    // It waited its whole TTL before giving up — a number a reader can compare
    // against the RTT beside it in the log (`./order-ledger` `setTtlFromRtt`).
    expect((expiries[0] as { waited: number }).waited).toBeGreaterThanOrEqual(DEFAULT_ORDER_TTL_TICKS);
  });

  it('records a volley when the trigger actually produces a shot, and how many are up', () => {
    const { match } = standUp();
    // Manual fire down a fixed heading: auto-aim needs something in range to
    // engage, and this test is about the trigger, not about targeting.
    const FIRE: readonly Action[] = [
      { type: 'aim', dir: { x: 1, y: 0 } },
      { type: 'fire', active: true, auto: false },
    ];
    for (let seq = 1; seq <= 60; seq++) match.predict(seq, FIRE);

    const volleys = match.actions.pending.filter((e) => e.kind === 'volley');
    // A second of held trigger at the sim's fire interval (0.35 s) is two or three
    // shots — not sixty, which is what a volley line would say if it were counting
    // *frames the trigger was down* instead of shots that left the barrel.
    expect(volleys.length).toBeGreaterThanOrEqual(2);
    expect(volleys.length).toBeLessThanOrEqual(4);
    // And no more of the firer's own shots are alive at once than the sim allows.
    for (const volley of volleys) {
      expect((volley as { inFlight: number }).inFlight).toBeLessThanOrEqual(MAX_PREDICTED_SHOTS);
    }
  });
});

/**
 * src/net/entity-echo.test.ts — one turret on the mount, not two.
 * OWNER: Netcode Engineer (M10 action-echo).
 *
 * The predicted turret and the authoritative turret are the same turret. Nothing
 * about their *ids* says so — they were minted by two entity counters that have
 * been drifting apart since RUSH! — so before this the id-keyed applier did the
 * only thing it could with an id it had never seen, and added a second turret to a
 * ring that had already been paid for once.
 *
 * Driven through the real `PredictedMatch.applyEvent`, because the seam that
 * matters is the one the session actually calls.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { SATELLITE, SHIELD, TURRET, createWorld } from '../sim';
import type { MiningStation, World, WorldConfig } from '../sim';
import { PredictedMatch } from './prediction';
import type { EntityEventMessage } from './transport';

const MATCH: WorldConfig = {
  seed: 3,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Hauler },
  ],
  asteroidCount: 4,
};

function standUp(): { match: PredictedMatch; station: MiningStation; world: World } {
  const world = createWorld(MATCH);
  const station = world.stations.find((s) => s.owner === 0)!;
  return { match: new PredictedMatch({ world, localPlayer: 0 }), station, world };
}

/** A turret the client predicted into existence: the client's own id, on a mount. */
function predictTurret(station: MiningStation, id: number, slot: number): void {
  station.turrets.push({
    id,
    owner: station.owner,
    slot,
    pos: { x: station.pos.x + 40, y: station.pos.y },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    angle: 0,
    cooldown: 0,
    targetId: null,
  });
}

const turretEvent = (id: number, slot: number): EntityEventMessage => ({
  type: 'entityEvent',
  tick: 100,
  kind: 'turret',
  op: 'spawn',
  data: { id, owner: 0, slot, x: 10, y: 20, radius: TURRET.radius, maxHp: TURRET.hp },
});

describe('a predicted structure steps aside for the authoritative one', () => {
  it('leaves ONE turret on the mount when authority names its own id', () => {
    const { match, station } = standUp();
    predictTurret(station, 7001, 0); // the client's copy, from its own tap

    match.applyEvent(turretEvent(31, 0));

    expect(station.turrets.length).toBe(1);
    expect(station.turrets[0]!.id).toBe(31);
    expect(station.turrets[0]!.slot).toBe(0);
  });

  it('displaces the turret on the SAME mount, not whichever came first', () => {
    const { match, station } = standUp();
    predictTurret(station, 7001, 0);
    predictTurret(station, 7002, 2);

    match.applyEvent(turretEvent(31, 2));

    // Slot 2's prediction was the one this event is about; slot 0's is untouched.
    expect(station.turrets.map((t) => t.id).sort((a, b) => a - b)).toEqual([31, 7001]);
    expect(station.turrets.find((t) => t.slot === 2)!.id).toBe(31);
  });

  it('does not displace anything on a repeat of an id it has already reconciled', () => {
    const { match, station } = standUp();
    predictTurret(station, 7001, 0);
    predictTurret(station, 7002, 1);

    match.applyEvent(turretEvent(31, 0)); // displaces 7001
    match.applyEvent(turretEvent(31, 0)); // an update — must cost nothing

    expect(station.turrets.map((t) => t.id).sort((a, b) => a - b)).toEqual([31, 7002]);
  });

  it('adds without displacing when the client predicted nothing', () => {
    const { match, station } = standUp();
    match.applyEvent(turretEvent(31, 0));
    match.applyEvent(turretEvent(32, 1));
    expect(station.turrets.map((t) => t.id)).toEqual([31, 32]);
  });

  it('holds the ring at the design cap under a full ring of predictions', () => {
    const { match, station } = standUp();
    for (let slot = 0; slot < TURRET.capPerStation; slot++) predictTurret(station, 8000 + slot, slot);
    for (let slot = 0; slot < TURRET.capPerStation; slot++) match.applyEvent(turretEvent(40 + slot, slot));

    // Four taps, four turrets — not eight (GDD §2.5: the cap is a design rule).
    expect(station.turrets.length).toBe(TURRET.capPerStation);
    expect(station.turrets.every((t) => t.id < 100)).toBe(true);
  });

  it('does the same for shields, which have no mount to match on', () => {
    const { match, station } = standUp();
    station.shields.push({ id: 9001, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius });

    match.applyEvent({
      type: 'entityEvent',
      tick: 100,
      kind: 'shield',
      op: 'spawn',
      data: { id: 55, owner: 0, radius: SHIELD.radius, maxHp: SHIELD.hp },
    });

    expect(station.shields.map((s) => s.id)).toEqual([55]);
  });

  it('does the same for the radar satellite, capped at one', () => {
    const { match, station } = standUp();
    station.satellites = [
      {
        id: 9500,
        owner: 0,
        pos: { x: 0, y: 0 },
        radius: SATELLITE.radius,
        hp: SATELLITE.hp,
        maxHp: SATELLITE.hp,
        orbitAngle: 0,
      },
    ];

    match.applyEvent({
      type: 'entityEvent',
      tick: 100,
      kind: 'satellite',
      op: 'spawn',
      data: {
        id: 61,
        owner: 0,
        x: 5,
        y: 5,
        radius: SATELLITE.radius,
        maxHp: SATELLITE.hp,
        orbitAngle: 1,
      },
    });

    expect(station.satellites!.map((s) => s.id)).toEqual([61]);
  });

  it('leaves a rival’s structures alone — a client predicts only its own orders', () => {
    const { match, world } = standUp();
    const rival = world.stations.find((s) => s.owner === 1)!;
    predictTurret(rival, 7100, 0); // not something a client can actually produce

    match.applyEvent({
      type: 'entityEvent',
      tick: 100,
      kind: 'turret',
      op: 'spawn',
      data: { id: 71, owner: 1, slot: 1, x: 0, y: 0, radius: TURRET.radius, maxHp: TURRET.hp },
    });

    // Different mount, so nothing to displace on the exact match; the rule still
    // stands one in, one out, and the ring never grows past what authority named.
    expect(rival.turrets.map((t) => t.id)).toEqual([71]);
  });
});

/**
 * tests/server/satellite-events.test.ts — the radar satellite's half of the
 * entity-event contract, both ends. OWNER: Netcode Engineer (netcode audit §6
 * gap 2; RATIFIED feature f1; GDD §2.2, §4.2).
 *
 * The audit found `'satellite'` missing from `EntityEventMessage['kind']` and no
 * producer for it, so a structure the sim treats as real — a sensor source, a
 * siege target — existed only on the server. `tests/net/satellite-visibility`
 * proves the round trip over a real socket; this file pins the pieces, and in
 * particular the two that are easy to get subtly wrong:
 *
 *  - **The orbit is the one static entity that moves,** and it is *integrated*
 *    per tick, so a client's replayed ticks advance its copy twice. The producer
 *    corrects that with an `update` — but only once the orbit has moved a legible
 *    amount, or the "event" would be a 10 Hz stream in disguise.
 *  - **Its HP is scouted, not broadcast** (GDD §2.2), on exactly the terms a
 *    turret's is: it rides the {@link FogTracker}, never the public diff.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { applyEntityEvent, resetStaticEntities } from '../../src/net/entity-events';
import type { SatelliteEventData, StationHealthData } from '../../src/net/entity-events';
import type { EntityEventMessage } from '../../src/net/transport';
import { createWorld, SATELLITE, SENSOR_RANGE, step, updateSatellites } from '../../src/sim';
import type { MiningStation, World } from '../../src/sim';
import { FogTracker, fullEntityState, StaticEntityTracker } from '../../server/static-events';

const DT = 1 / 60;

function world(): World {
  return createWorld({
    seed: 99,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
    ],
    bounds: { width: 2000, height: 2000 },
    asteroidCount: 4,
  });
}

function stationOf(w: World, owner: number): MiningStation {
  const station = w.stations.find((s) => s.owner === owner);
  if (!station) throw new Error(`no station for ${owner}`);
  return station;
}

/** Put a satellite in orbit at `station`, the way a finished build does. */
function orbit(w: World, owner: number): NonNullable<MiningStation['satellites']>[number] {
  const station = stationOf(w, owner);
  station.builds.push({
    id: w.nextEntityId++,
    kind: 'satellite',
    slot: 0,
    remaining: DT / 2,
    total: SATELLITE.buildTime,
  });
  // One step finishes the job and mints the real thing through the sim's path.
  step(w, []);
  const satellite = station.satellites?.[0];
  if (!satellite) throw new Error('the build did not produce a satellite');
  return satellite;
}

const satellites = (events: readonly EntityEventMessage[]): EntityEventMessage[] =>
  events.filter((e) => e.kind === 'satellite');

describe('the satellite producer', () => {
  it('puts standing satellites in the join burst, so a client that arrives late still sees one', () => {
    const w = world();
    const satellite = orbit(w, 0);

    const spawn = satellites(fullEntityState(w));
    expect(spawn).toHaveLength(1);
    expect(spawn[0]!.op).toBe('spawn');
    const data = spawn[0]!.data as SatelliteEventData;
    expect(data.id).toBe(satellite.id);
    expect(data.owner).toBe(0);
    expect(data.maxHp).toBe(SATELLITE.hp);
    expect(data.orbitAngle).toBeCloseTo(satellite.orbitAngle, 6);
  });

  it('announces a new satellite once, then corrects its orbit only when it has moved', () => {
    const w = world();
    const tracker = new StaticEntityTracker();
    tracker.prime(w);

    orbit(w, 0);
    const first = satellites(tracker.diff(w));
    expect(first).toHaveLength(1);
    expect(first[0]!.op).toBe('spawn');

    // Sampled again immediately, the orbit has barely moved: nothing to say.
    expect(satellites(tracker.diff(w))).toHaveLength(0);

    // A tenth of a second of orbit is still under the announce threshold — this
    // is the difference between an event and a stream, and it is the assertion
    // that would catch it degrading into one.
    for (let i = 0; i < 6; i++) updateSatellites(w, DT);
    expect(satellites(tracker.diff(w))).toHaveLength(0);

    // A second of it is not: 0.35 rad clears the threshold and gets corrected.
    for (let i = 0; i < 60; i++) updateSatellites(w, DT);
    const update = satellites(tracker.diff(w));
    expect(update).toHaveLength(1);
    expect(update[0]!.op).toBe('update');
    const station = stationOf(w, 0);
    expect((update[0]!.data as SatelliteEventData).orbitAngle).toBeCloseTo(
      station.satellites![0]!.orbitAngle,
      6,
    );
  });

  it('costs about two updates a second while it orbits — not ten', () => {
    const w = world();
    const tracker = new StaticEntityTracker();
    tracker.prime(w);
    orbit(w, 0);
    tracker.diff(w); // absorb the spawn

    // Ten seconds, sampled at the room's own 10 Hz.
    let updates = 0;
    for (let sample = 0; sample < 100; sample++) {
      for (let i = 0; i < 6; i++) updateSatellites(w, DT);
      updates += satellites(tracker.diff(w)).length;
    }
    // 10 s × 0.35 rad/s ÷ 0.125 rad ≈ 28, plus at most one for the 2π wrap.
    expect(updates).toBeGreaterThan(20);
    expect(updates).toBeLessThan(40);
  });

  it('announces the death, so a killed satellite stops granting coverage', () => {
    const w = world();
    const tracker = new StaticEntityTracker();
    tracker.prime(w);
    const satellite = orbit(w, 0);
    tracker.diff(w);

    satellite.hp = 0;
    step(w, []); // sweepDeadSatellites drops it at end of step
    expect(stationOf(w, 0).satellites).toHaveLength(0);

    const events = satellites(tracker.diff(w));
    expect(events).toHaveLength(1);
    expect(events[0]!.op).toBe('destroy');
    expect((events[0]!.data as { id: number }).id).toBe(satellite.id);
  });

  it('keeps its HP off the public diff — that number is scouted (GDD §2.2)', () => {
    const w = world();
    const tracker = new StaticEntityTracker();
    tracker.prime(w);
    const satellite = orbit(w, 0);
    tracker.diff(w);

    satellite.hp = 3;
    for (const event of satellites(tracker.diff(w))) {
      expect(event.data).not.toHaveProperty('hp');
    }
  });
});

describe('the satellite is scouted like a turret', () => {
  it('sends its HP to its owner, and to a rival only from inside sensor range', () => {
    const w = world();
    const satellite = orbit(w, 0);
    satellite.hp = 11;

    const owner = new FogTracker(0);
    const ownHealth = owner
      .events(w)
      .map((e) => e.data as StationHealthData)
      .find((d) => d.id === stationOf(w, 0).id);
    expect(ownHealth?.satellites).toEqual([{ id: satellite.id, hp: 11 }]);

    // The rival, parked well outside sensor range of station 0, earns nothing.
    const station = stationOf(w, 0);
    const rivalShip = w.ships.find((s) => s.id === 1)!;
    rivalShip.pos.x = station.pos.x + SENSOR_RANGE * 3;
    rivalShip.pos.y = station.pos.y;
    const far = new FogTracker(1);
    expect(far.events(w).map((e) => (e.data as StationHealthData).id)).not.toContain(station.id);

    // Fly them in, and the same number is theirs — a besieger has to be able to
    // read the damage they are doing to it.
    rivalShip.pos.x = station.pos.x + SENSOR_RANGE / 2;
    const near = new FogTracker(1);
    const scouted = near
      .events(w)
      .map((e) => e.data as StationHealthData)
      .find((d) => d.id === station.id);
    expect(scouted?.satellites).toEqual([{ id: satellite.id, hp: 11 }]);
  });

  it('omits the field entirely for a station with no satellite', () => {
    const w = world();
    const tracker = new FogTracker(0);
    const health = tracker
      .events(w)
      .map((e) => e.data as StationHealthData)
      .find((d) => d.id === stationOf(w, 0).id);
    expect(health).toBeDefined();
    expect(health).not.toHaveProperty('satellites');
  });
});

describe('the client consumer', () => {
  it('builds, corrects and removes a satellite from the events alone', () => {
    const server = world();
    const client = world();
    const satellite = orbit(server, 0);

    // Spawn: the client had none, and now holds the server's, in its orbit.
    for (const event of fullEntityState(server)) applyEntityEvent(client, event);
    const mirrored = stationOf(client, 0).satellites?.[0];
    expect(mirrored?.id).toBe(satellite.id);
    expect(mirrored?.orbitAngle).toBeCloseTo(satellite.orbitAngle, 6);
    expect(mirrored?.hp).toBe(SATELLITE.hp);

    // Update: the client's copy has drifted ahead (its replayed ticks advanced
    // the orbit twice); the correction puts it back on the server's angle.
    for (let i = 0; i < 30; i++) updateSatellites(client, DT);
    for (let i = 0; i < 60; i++) updateSatellites(server, DT);
    expect(mirrored!.orbitAngle).not.toBeCloseTo(satellite.orbitAngle, 3);
    const tracker = new StaticEntityTracker();
    tracker.prime(server);
    for (let i = 0; i < 60; i++) updateSatellites(server, DT);
    for (const event of tracker.diff(server)) applyEntityEvent(client, event);
    expect(mirrored!.orbitAngle).toBeCloseTo(satellite.orbitAngle, 6);
    expect(mirrored!.pos.x).toBeCloseTo(satellite.pos.x, 6);

    // Destroy: it leaves, and the client stops treating it as a sensor source.
    const destroyed: EntityEventMessage = {
      type: 'entityEvent',
      tick: server.tick,
      kind: 'satellite',
      op: 'destroy',
      data: { id: satellite.id },
    };
    expect(applyEntityEvent(client, destroyed)).toBe(true);
    expect(stationOf(client, 0).satellites).toHaveLength(0);
    // …and a second destroy for the same id is a no-op, not a throw: events are
    // idempotent, and a reclaim burst can repeat one.
    expect(applyEntityEvent(client, destroyed)).toBe(false);
  });

  it('applies the scouted HP a health event carries', () => {
    const server = world();
    const client = world();
    const satellite = orbit(server, 0);
    for (const event of fullEntityState(server)) applyEntityEvent(client, event);

    satellite.hp = 7;
    for (const event of new FogTracker(0).events(server)) applyEntityEvent(client, event);
    expect(stationOf(client, 0).satellites?.[0]?.hp).toBe(7);
  });

  it('drops a satellite on the reclaim reset, so a stale one cannot outlive the grace window', () => {
    const server = world();
    const client = world();
    orbit(server, 0);
    for (const event of fullEntityState(server)) applyEntityEvent(client, event);
    expect(stationOf(client, 0).satellites).toHaveLength(1);

    // Sixty seconds away is long enough for it to have been shot down (GDD §4.2).
    resetStaticEntities(client);
    expect(stationOf(client, 0).satellites).toHaveLength(0);
  });
});

/**
 * tests/server/fog.test.ts — station health reaches every client, at every
 * range, and the server is where that is true. OWNER: Netcode Engineer
 * (GDD §2.2 amended 2026-08-07, §4.2).
 *
 * **This file used to assert the opposite, and it was re-pointed by a0-05, not
 * deleted.** The old rule was "enemy station health is scouted, not broadcast":
 * the server withheld a rival's core HP until your ship flew inside 180 units of
 * it. The developer withdrew it — *"it should always show the health regardless
 * of proximity or else it looks like a glitch … approaching and getting far it
 * looks like its full health even if its damaged."*
 *
 * The wire is still where this is decided, for the same reason it always was: a
 * client can only draw what it was told. Under the old rule the *networked*
 * version of the bug was the worse one — a player could fly to 400 units, see the
 * enemy home filling their screen, and be looking at a ring the server had not
 * updated since the last time they were on its doorstep. So the assertions
 * flipped: what these cases now guard is that no station's health is ever
 * withheld, and that a client's picture does not go stale the moment it turns
 * around.
 *
 * What is still enforced here, unchanged: the payload carries **health and
 * nothing else** — no cargo, no bank, no upgrade tiers. Those are drawn for
 * nobody at any range (GDD §2.2) and the amendment did not touch them.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { EntityEventMessage, ServerMessage } from '../../src/net/transport';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import type { StationHealthData } from '../../src/net/entity-events';

class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {}

  /** Station-health events this client has been told about, by station id. */
  healthUpdates(): StationHealthData[] {
    const out: StationHealthData[] = [];
    for (const frame of this.frames) {
      const message: ServerMessage | null = parseServerMessage(frame);
      if (!message || message.type !== 'entityEvent') continue;
      const event: EntityEventMessage = message;
      if (event.kind !== 'station' || event.op !== 'update') continue;
      out.push(event.data as StationHealthData);
    }
    return out;
  }

  clear(): void {
    this.frames.length = 0;
  }
}

describe('station health on the wire', () => {
  let server: MatchServer;
  let now = 500_000;
  let socket: FakeSocket;
  let client: Connection;

  const advance = (ms: number): void => {
    now += ms;
    server.update(now);
  };

  beforeEach(() => {
    now = 500_000;
    server = new MatchServer({ seed: 99, asteroidCount: 8 });
    server.update(now);

    socket = new FakeSocket();
    client = server.connect(socket);
    client.receive(encodeClientMessage({ type: 'join', room: 'FOGY' }));
    client.receive(encodeClientMessage({ type: 'startMatch' }));
    advance(16);
    socket.clear();
    advance(300);
  });

  /** The retired `SENSOR_RANGE` — 2× the 90-unit shield radius. Written out
   *  rather than imported: the constant is gone, and these cases exist to show
   *  the distance has stopped mattering. */
  const RETIRED_SENSOR_RANGE = 180;

  it('tells a player every station’s numbers, not just their own', () => {
    const seen = new Set(socket.healthUpdates().map((p) => p.id));
    const world = client.room!.world!;

    // Eight homes, all of them across the map from this client's ship, all of
    // them reported. Under the old rule this set had exactly one member.
    expect(seen.size).toBe(world.stations.length);
    for (const station of world.stations) expect(seen.has(station.id)).toBe(true);
  });

  it('keeps a besieged rival’s numbers flowing after the scout flies away', () => {
    // The networked half of the a0-05 report. The scout looks, then leaves, then
    // the siege starts: the ring on their screen must move, not freeze.
    const world = client.room!.world!;
    const target = world.stations.find((p) => p.owner === 4)!;
    const ship = world.ships.find((s) => s.id === 0)!;

    ship.pos = { x: target.pos.x + RETIRED_SENSOR_RANGE * 0.5, y: target.pos.y };
    target.coreHp = 88; // a first hit, taken while the scout is standing there
    socket.clear();
    advance(300);
    expect(socket.healthUpdates().find((p) => p.id === target.id)?.coreHp).toBe(88);

    // Half the map away — twenty times the radius that used to cut this off.
    ship.pos = { x: target.pos.x + RETIRED_SENSOR_RANGE * 20, y: target.pos.y };
    target.coreHp = 42; // a siege the scout is no longer standing next to
    socket.clear();
    advance(300);
    expect(socket.healthUpdates().find((p) => p.id === target.id)?.coreHp).toBe(42);
  });

  it('keeps telling a client whose ship is not in the sky', () => {
    // Dead or eliminated, you still watch the match — and a spectating client
    // that could not see who was winning was the same lie in another costume.
    const world = client.room!.world!;
    const ship = world.ships.find((s) => s.id === 0)!;
    const target = world.stations.find((p) => p.owner === 4)!;
    ship.alive = false;
    target.coreHp = 37;
    socket.clear();
    advance(300);

    expect(socket.healthUpdates().find((p) => p.id === target.id)?.coreHp).toBe(37);
  });

  it('says nothing at all while nothing changes — always-visible is not a flood', () => {
    // The signature check is what makes an unconditional send affordable: a quiet
    // station costs one string compare per sample, not a frame.
    socket.clear();
    advance(300);
    expect(socket.healthUpdates()).toHaveLength(0);
  });

  it('carries health and nothing else — cargo, bank and tiers are still nobody’s', () => {
    const world = client.room!.world!;
    world.stations[4]!.coreHp -= 5; // make it speak
    socket.clear();
    advance(300);

    const payloads = socket.healthUpdates();
    expect(payloads.length).toBeGreaterThan(0);
    for (const data of payloads) {
      const json = JSON.stringify(data);
      expect(json).not.toContain('cargo');
      expect(json).not.toContain('banked');
      expect(json).not.toContain('tiers');
    }
  });
});

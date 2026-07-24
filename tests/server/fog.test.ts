/**
 * tests/server/fog.test.ts — a rival's health is scouted, not broadcast, and
 * the server is where that is true. OWNER: Netcode Engineer (GDD §2.2, §4.2).
 *
 * "Enemy planet health is scouted, not broadcast … Knowing who is winning, who
 * is wounded, and who is under siege is information you *earn* by scouting"
 * (GDD §2.2). A HUD that merely declines to draw a number it was sent is not
 * fog — it is an honour system, and it survives exactly as long as the first
 * modified client. So the rule is enforced on the wire: a client is never sent
 * a core HP its ship has not flown close enough to read.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { EntityEventMessage, ServerMessage } from '../../src/net/transport';
import { SENSOR_RANGE } from '../../src/sim';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import type { PlanetHealthData } from '../../src/net/entity-events';

class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {}

  /** Planet-health events this client has been told about, by planet id. */
  healthUpdates(): PlanetHealthData[] {
    const out: PlanetHealthData[] = [];
    for (const frame of this.frames) {
      const message: ServerMessage | null = parseServerMessage(frame);
      if (!message || message.type !== 'entityEvent') continue;
      const event: EntityEventMessage = message;
      if (event.kind !== 'planet' || event.op !== 'update') continue;
      out.push(event.data as PlanetHealthData);
    }
    return out;
  }

  clear(): void {
    this.frames.length = 0;
  }
}

describe('planet health on the wire', () => {
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

  it('tells a player their own planet’s numbers, and nobody else’s', () => {
    const seen = new Set(socket.healthUpdates().map((p) => p.id));
    const own = client.room!.world!.planets.find((p) => p.owner === 0)!;

    expect(seen.has(own.id)).toBe(true);
    // Seven rivals, all of them across the map, none of them scouted.
    expect(seen.size).toBe(1);
  });

  it('starts telling them a rival’s numbers once they fly over and look', () => {
    const room = client.room!;
    const world = room.world!;
    const target = world.planets.find((p) => p.owner === 4)!;
    expect(new Set(socket.healthUpdates().map((p) => p.id)).has(target.id)).toBe(false);

    // Fly the scout to the rival's doorstep — inside sensor range (GDD §2.2).
    const ship = world.ships.find((s) => s.id === 0)!;
    ship.pos = { x: target.pos.x + SENSOR_RANGE * 0.5, y: target.pos.y };
    socket.clear();
    advance(300);

    const scouted = socket.healthUpdates().find((p) => p.id === target.id);
    expect(scouted).toBeDefined();
    expect(scouted?.coreHp).toBe(target.coreHp);

    // And it goes quiet again when the scout leaves: the client keeps its last
    // read and grows stale, exactly like a human's memory of what they saw.
    ship.pos = { x: target.pos.x + SENSOR_RANGE * 8, y: target.pos.y };
    target.coreHp = 42; // a siege the scout is no longer watching
    socket.clear();
    advance(300);
    expect(socket.healthUpdates().some((p) => p.id === target.id)).toBe(false);
  });

  it('says nothing new to a client whose ship is not in the sky', () => {
    const world = client.room!.world!;
    const ship = world.ships.find((s) => s.id === 0)!;
    const target = world.planets.find((p) => p.owner === 4)!;
    // Parked next to a rival, but dead: a wrecked cockpit scouts nothing.
    ship.pos = { x: target.pos.x, y: target.pos.y };
    ship.alive = false;
    socket.clear();
    advance(300);

    expect(socket.healthUpdates().some((p) => p.id === target.id)).toBe(false);
  });
});

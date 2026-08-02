/**
 * tests/net/online-teams.test.ts — a 2v2 played over the real wire, and the four
 * things a teams match has to be. OWNER: Netcode Engineer (GDD §2.1, §4.2).
 *
 * The developer reported a teams match where "everyone attacked me and I could
 * attack everyone." The sim's own guarantees were already pinned
 * (`src/sim/teams-identity.test.ts`) and all four held — because nothing was
 * wrong with them. What was wrong was that no side ever *reached* the sim: the
 * lobby's assignment stopped at the lobby, and every seat kept the teams-of-one
 * `team = player` it was constructed with, which IS free-for-all.
 *
 * So this file starts one seat further out than a sim test can. Nothing here
 * constructs a world: a host and three guests join a real {@link MatchServer}
 * through real encoded frames, the host sends a real `lobbyChoice` carrying the
 * mode and the 2v2 split, the host presses RUSH!, and only then does the world
 * exist. Every assertion below is about the world the SERVER built from that —
 * so the wire, the room, the roster and the sim are all in the loop, and the one
 * missing hop that caused the report cannot come back unnoticed.
 *
 *  1. `matchStart` carries the per-slot team (the protocol-parity guard the brief
 *     asks for, exercised end to end rather than asserted on a literal).
 *  2. A teammate is untargetable — auto-aim never locks one, at point-blank.
 *  3. An ally's shots do no damage, and pass through to the enemy behind.
 *  4. Teammates spawn adjacent — the same side's homes are neighbours on the ring.
 *
 * …plus the two ways it must refuse: FFA cannot be regrouped by a stale array,
 * and a guest cannot re-side the room under the host.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import type { ServerMessage } from '../../src/net/transport';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { areEnemies, canDamage, step, TICK_DT } from '../../src/sim';
import type { World } from '../../src/sim';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

/** The 2v2 split under test: seats 0 and 2 on side A, seats 1 and 3 on side B.
 *  Deliberately interleaved rather than "first half / second half" — a split that
 *  is not simply `player < 2` cannot be reproduced by an off-by-one accident. */
const SPLIT: readonly number[] = [0, 1, 0, 1];

/** A socket that keeps what it was sent, and can read it back as messages. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    /* nothing to tear down in-process */
  }
  messages(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const frame of this.frames) {
      const message = parseServerMessage(frame);
      if (message) out.push(message);
    }
    return out;
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    const all = this.messages().filter((m) => m.type === type);
    return all[all.length - 1] as Extract<ServerMessage, { type: T }> | undefined;
  }
}

interface Seat {
  readonly socket: FakeSocket;
  readonly connection: Connection;
}

/** Four clients in one four-seat room, un-started. Seat 0 is the room's creator
 *  — the host, a lobby word (GDD §4.2) — because it joined first. */
function room4(): { server: MatchServer; code: string; seats: Seat[] } {
  const server = new MatchServer({ seed: 0x7ea3, slots: 4, asteroidCount: 12 });
  server.update(1_000_000);
  const code = server.createCode();
  const seats: Seat[] = [];
  for (let i = 0; i < 4; i++) {
    const socket = new FakeSocket();
    const connection = server.connect(socket);
    connection.receive(encodeClientMessage({ type: 'join', room: code }));
    seats.push({ socket, connection });
  }
  return { server, code, seats };
}

/** One `lobbyChoice` from `seat`, exactly as a client sends it — through the
 *  encoder and the server's own parser, so a field the wire drops is a failure
 *  here rather than a silent no-op. */
function choose(
  seat: Seat,
  options: { mode?: 'ffa' | 'teams'; teams?: readonly number[] } = {},
): void {
  seat.connection.receive(
    encodeClientMessage({
      type: 'lobbyChoice',
      shipClass: ShipClass.Vanguard,
      fireMode: 'manual',
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.teams ? { teams: options.teams } : {}),
    }),
  );
}

/** A started 2v2: the host authors the split in the lobby, then presses RUSH!. */
function started2v2(): { server: MatchServer; code: string; seats: Seat[]; world: World } {
  const { server, code, seats } = room4();
  choose(seats[0]!, { mode: 'teams', teams: SPLIT });
  seats[0]!.connection.receive(encodeClientMessage({ type: 'startMatch' }));
  const world = server.room(code)!.world!;
  return { server, code, seats, world };
}

/** Manual fire, held, pointed along an axis — the two halves of a shot as the
 *  action union spells them (`@shared/types`), hoisted so the line-of-fire tests
 *  read as geometry rather than as message construction. */
const AIM_EAST: Action = { type: 'aim', dir: { x: 1, y: 0 } };
const AIM_WEST: Action = { type: 'aim', dir: { x: -1, y: 0 } };
const HOLD_FIRE: Action = { type: 'fire', active: true, auto: false };

/**
 * Move a ship somewhere the test needs it, at rest, optionally already facing a
 * given way. The room's own arena puts the four homes far apart — which is the
 * point of guarantee 4 — so a point-blank targeting test has to close the
 * distance itself.
 *
 * `angle` matters for the manual-fire tests: facing is turn-rate limited (a hull
 * never snaps, `src/sim/step`), so a ship handed an aim spends dozens of ticks
 * swinging onto it and sprays shots along the whole arc on the way. Pinning the
 * nose makes those tests about who may be hit rather than about how fast a
 * Vanguard turns.
 */
function place(world: World, id: PlayerId, x: number, y: number, angle?: number): void {
  const ship = world.ships.find((s) => s.id === id)!;
  ship.pos.x = x;
  ship.pos.y = y;
  ship.vel.x = 0;
  ship.vel.y = 0;
  if (angle !== undefined) ship.angle = angle;
  // Spawn protection is 10 s at match start (GDD §2.8) and would make every ship
  // untargetable for reasons that have nothing to do with allegiance.
  ship.spawnProtect = 0;
}

/** Facing east / west, the two directions the line-of-fire tests shoot along. */
const EAST = 0;
const WEST = Math.PI;

/**
 * Empty the asteroid field.
 *
 * The rocks are not incidental scenery to these tests — they are two live rules
 * pointed straight at them. A rock in the line eats a shot bound for whatever is
 * behind it ("you cannot shoot through things", `src/sim/projectiles`), and a rock
 * a ship is standing in pushes it out (ship-vs-asteroid reflects, GDD §4.1). A
 * real arena drops one on the sightline often enough that a teams test would pass
 * or fail on the seed. Clearing them leaves exactly the ships, the homes, and the
 * question this file is asking: who may hit whom.
 */
function clearField(world: World): void {
  world.asteroids.length = 0;
}

// ---------------------------------------------------------------------------
// 1. The team payload — lobby → room → matchStart → world
// ---------------------------------------------------------------------------

describe('the host\'s split rides the wire into the world', () => {
  it('lands on every seat and rides matchStart to every client', () => {
    const { seats, world } = started2v2();

    // Every client is told the same roster, sides included — a client that had to
    // guess would build a different world and reconcile against it forever.
    for (const seat of seats) {
      const start = seat.socket.last('matchStart');
      expect(start).toBeDefined();
      expect(start!.slots.map((s) => s.team)).toEqual([...SPLIT]);
    }
    // And the authority's own world agrees, which is the half that was missing.
    expect(world.ships.map((s) => s.team)).toEqual([...SPLIT]);
    expect(world.stations.map((s) => s.team)).toEqual([...SPLIT]);
  });

  it('shows the sides on the lobby roster before RUSH!, not only after it', () => {
    const { seats } = room4();
    choose(seats[0]!, { mode: 'teams', teams: SPLIT });

    // A player picks a hull and a side against a roster; a roster that only tells
    // the truth once the match has started tells it too late.
    const roster = seats[3]!.socket.last('lobbyState');
    expect(roster!.slots.map((s) => s.team)).toEqual([...SPLIT]);
  });

  it('advertises the room as TEAMS once the host flips the toggle', () => {
    const { server, code, seats } = room4();
    expect(server.room(code)!.mode).toBe('ffa');
    choose(seats[0]!, { mode: 'teams', teams: SPLIT });
    // The room ad is how a player is kept out of a lobby that does not fit them
    // (GDD §4.2), so it has to move when the host does.
    expect(server.room(code)!.mode).toBe('teams');
  });

  it('reads the split through the one predicate the whole sim asks', () => {
    const { world } = started2v2();

    expect(areEnemies(world, 0, 2)).toBe(false); // side A
    expect(areEnemies(world, 1, 3)).toBe(false); // side B
    expect(areEnemies(world, 0, 1)).toBe(true);
    expect(areEnemies(world, 2, 3)).toBe(true);
    // Friendly fire is off by construction: an ally is not damageable at all.
    expect(canDamage(world, 0, 2)).toBe(false);
    expect(canDamage(world, 0, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Targeting and damage, in the world the server built
// ---------------------------------------------------------------------------

describe('a 2v2 plays by the teams rules, server-side', () => {
  it('auto-aim never locks a teammate, however close they get', () => {
    const { world } = started2v2();
    clearField(world);
    place(world, 0, 1000, 1000);
    place(world, 2, 1150, 1000); // teammate at point-blank

    const ally = world.ships.find((s) => s.id === 2)!;
    const before = ally.hull;
    for (let t = 0; t < 120; t++) {
      step(world, [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }], TICK_DT);
    }

    expect(ally.hull).toBe(before);
    // Not "the shot missed" — no shot was ever acquired, which is the difference
    // between a teammate who is safe and a teammate who is lucky.
    expect(world.projectiles.some((p) => p.active)).toBe(false);
  });

  it('picks the enemy over the teammate standing beside it', () => {
    const { world } = started2v2();
    clearField(world);
    place(world, 0, 1000, 1000);
    place(world, 2, 1000, 850); // ally, another bearing
    place(world, 1, 1150, 1000); // enemy

    const ally = world.ships.find((s) => s.id === 2)!;
    const enemy = world.ships.find((s) => s.id === 1)!;
    const allyBefore = ally.hull;
    const enemyBefore = enemy.hull;
    for (let t = 0; t < 120; t++) {
      step(world, [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }], TICK_DT);
    }

    expect(enemy.hull).toBeLessThan(enemyBefore);
    expect(ally.hull).toBe(allyBefore);
  });

  it('puts an ally\'s shot through them and into the enemy behind', () => {
    const { world } = started2v2();
    clearField(world);
    const ally = world.ships.find((s) => s.id === 2)!;
    const enemy = world.ships.find((s) => s.id === 1)!;
    const allyBefore = ally.hull;
    const enemyBefore = enemy.hull;

    // Three ships on one line, held there — the shooter, its teammate, and the
    // enemy behind. Pinned every tick because this is a test about ALLEGIANCE,
    // not about ballistics: a live arena nudges a drifting hull off the line and
    // would turn "no friendly fire" into "the shot happened to miss."
    for (let t = 0; t < 180; t++) {
      place(world, 0, 1000, 1000, EAST);
      place(world, 2, 1070, 1000);
      place(world, 1, 1150, 1000);
      step(world, [{ id: 0, actions: [AIM_EAST, HOLD_FIRE] }], TICK_DT);
    }

    expect(ally.hull).toBe(allyBefore); // zero friendly damage, the ratified default
    expect(enemy.hull).toBeLessThan(enemyBefore); // and the shot still bit
  });

  it('never lets an ally\'s fire reach an ally\'s reactor either', () => {
    const { world } = started2v2();
    clearField(world);
    const allyStation = world.stations.find((s) => s.owner === 2)!;
    // Drop the reactor's 10 s opening shield (GDD §2.8) so the only thing standing
    // between the shot and the core is allegiance — otherwise this passes for a
    // reason that has nothing to do with teams.
    allyStation.spawnProtect = 0;
    const before = allyStation.coreHp;

    for (let t = 0; t < 180; t++) {
      place(world, 0, allyStation.pos.x + 120, allyStation.pos.y, WEST);
      step(world, [{ id: 0, actions: [AIM_WEST, HOLD_FIRE] }], TICK_DT);
    }

    // Homes are the one serious thing in the game (GDD §4.7) — an ally cannot
    // chip one even by trying, protection or no protection.
    expect(allyStation.coreHp).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 4. Spawn adjacency — a side spawns as a side
// ---------------------------------------------------------------------------

describe('teammates spawn together', () => {
  it('seats the same side on neighbouring homes, not opposite corners', () => {
    const { world } = started2v2();
    const home = (id: PlayerId): { x: number; y: number } =>
      world.stations.find((s) => s.owner === id)!.pos;
    const gap = (a: PlayerId, b: PlayerId): number => {
      const p = home(a);
      const q = home(b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    };

    // A side holds one ARC of the ring, so a teammate is somebody you can reach
    // when their alarm fires. Two things say that, and both are needed: no enemy
    // home is nearer than your teammate's, and the widest gap on the board is a
    // gap between sides. (The homes themselves stay on the map's fair placements —
    // teams reorder who takes which slot, they never move the slots, which is why
    // the near pairs can tie on a four-point ring where the clusters touch.)
    const allyGaps = [gap(0, 2), gap(1, 3)];
    const enemyGaps = [gap(0, 1), gap(0, 3), gap(2, 1), gap(2, 3)];
    expect(Math.max(...allyGaps)).toBeLessThanOrEqual(Math.min(...enemyGaps));
    expect(Math.max(...enemyGaps)).toBeGreaterThan(Math.max(...allyGaps));
  });
});

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

describe('the room refuses the two ways a split could go wrong', () => {
  it('keeps FFA a free-for-all even when a stale split arrives with it', () => {
    const { server, code, seats } = room4();
    choose(seats[0]!, { mode: 'teams', teams: SPLIT });
    // The host flips back. The client may well still be carrying the old array —
    // it is the lobby's local state — so FFA is *enforced*, not merely un-set.
    choose(seats[0]!, { mode: 'ffa', teams: SPLIT });

    seats[0]!.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    const world = server.room(code)!.world!;
    expect(world.ships.map((s) => s.team)).toEqual([0, 1, 2, 3]);
    expect(areEnemies(world, 0, 2)).toBe(true);
  });

  it('ignores a split sent by a guest — the room\'s shape is the host\'s', () => {
    const { server, code, seats } = room4();
    choose(seats[0]!, { mode: 'teams', teams: SPLIT });
    // Seat 3 tries to put itself on seat 0's side.
    choose(seats[3]!, { mode: 'teams', teams: [0, 1, 0, 0] });

    seats[0]!.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    const world = server.room(code)!.world!;
    expect(world.ships.map((s) => s.team)).toEqual([...SPLIT]);
  });

  it('drops a malformed split without costing the sender their hull pick', () => {
    const { server, code, seats } = room4();
    choose(seats[0]!, { mode: 'teams', teams: SPLIT });
    // Hand-rolled, because the encoder would never produce it: a team number the
    // lobby cannot author. The wire drops the whole `teams` field; the hull and
    // the mode on the same message must still land.
    seats[0]!.connection.receive(
      JSON.stringify({
        type: 'lobbyChoice',
        shipClass: ShipClass.Interceptor,
        fireMode: 'manual',
        mode: 'teams',
        teams: [0, 1, 0, 99],
      }),
    );

    const roster = seats[0]!.socket.last('lobbyState')!;
    expect(roster.slots[0]!.shipClass).toBe(ShipClass.Interceptor); // the pick landed
    expect(roster.slots.map((s) => s.team)).toEqual([...SPLIT]); // the sides did not move
    expect(server.room(code)!.mode).toBe('teams');
  });
});

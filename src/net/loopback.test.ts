/**
 * src/net/loopback.test.ts — the day-3 netcode contract (GDD §4.2, §4.8).
 *
 * The claim this file has to make good on is the one the GDD makes in §4.2:
 * *the simulation consumes ordered input ticks and never knows which transport
 * it is talking to.* So the headline test is a round trip — drive the same
 * script of `Action`s through `LocalLoopback` and, separately, straight into
 * `step()`, and require the two worlds to be **identical**, not merely similar.
 * If they ever diverge, the offline game and the online game are different
 * games, and the determinism replay (§4.8) is worthless.
 *
 * Everything else here guards the edges that make that round trip honest: input
 * lands on the tick it names, late input is dropped rather than rewound, a
 * client that jumps ahead cannot burst the sim, and the protocol a client sees
 * offline is the protocol it will see online.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass, mulberry32 } from '@shared/types';
import type { Action } from '@shared/types';
import { createWorld, step } from '../sim';
import type { Inputs, World, WorldConfig } from '../sim';
import { LocalLoopback, MAX_CATCHUP_TICKS, OFFLINE_ROOM } from './loopback';
import type { LoopbackConfig } from './loopback';
import { createLocalSession } from './session';
import { decodeSnapshot, SHIP_FLAG } from './snapshot';
import type { InputMessage, ServerMessage, SnapshotMessage } from './transport';

// A four-slot match on a small field: enough ships, rocks, and stations for the
// weapon, the tractor, and the build economy to all be in play, small enough that
// a full deep-equal of two worlds is cheap.
const MATCH: WorldConfig = {
  seed: 0x51ce,
  players: [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Interceptor },
    { id: 2, shipClass: ShipClass.Excavator },
    { id: 3, shipClass: ShipClass.Hauler },
  ],
  bounds: { width: 1200, height: 1200 },
  asteroidCount: 18,
};

const PLAYERS = MATCH.players.map((p) => p.id);
const TICKS = 300; // 5 seconds of match at the 60 Hz sim tick

/**
 * A deterministic pilot: the same `(player, tick)` always yields the same
 * actions, seeded from the ratified mulberry32 so the script is identical on
 * every engine (GDD §4.1). Deliberately busy — thrust, aim, held fire, boost,
 * and the occasional wheel order — so the two worlds have every subsystem to
 * disagree about.
 */
function scriptedInput(player: number, tick: number): Action[] {
  const rng = mulberry32(player * 7919 + tick * 104729);
  const a = rng.next() * Math.PI * 2;
  const actions: Action[] = [
    { type: 'thrust', dir: { x: Math.cos(a), y: Math.sin(a) } },
    { type: 'aim', dir: { x: Math.cos(a * 2), y: Math.sin(a * 2) } },
    { type: 'fire', active: rng.next() < 0.75, auto: player % 2 === 0 },
  ];
  // A wheel press every so often — validated and paid for by the sim, which is
  // free to refuse it (wrong station, no ore, cap reached). Either way both runs
  // must refuse it the same way.
  if (tick % 97 === 0) actions.push({ type: 'buildOrder', item: 'turret' });
  return actions;
}

/** The tick's inputs as the sim wants them: every player, ascending slot. */
function directInputs(tick: number): Inputs {
  return PLAYERS.map((id) => ({ id, actions: scriptedInput(id, tick) }));
}

function inputMessage(player: number, tick: number): InputMessage {
  return { type: 'input', tick, seq: tick, actions: scriptedInput(player, tick) };
}

/** The world the sim produces when nothing but `step()` is involved. */
function stepDirectly(ticks: number): World {
  const world = createWorld(MATCH);
  for (let tick = 1; tick <= ticks; tick++) step(world, directInputs(tick));
  return world;
}

/** An opened loopback and the server messages it has emitted so far. */
function openLoopback(overrides: Partial<LoopbackConfig> = {}): {
  transport: LocalLoopback;
  received: ServerMessage[];
} {
  const received: ServerMessage[] = [];
  const transport = new LocalLoopback({ match: MATCH, localPlayer: 0, ...overrides });
  transport.onMessage((m) => received.push(m));
  transport.send({ type: 'join', room: OFFLINE_ROOM });
  transport.send({ type: 'startMatch' });
  return { transport, received };
}

/** The binary snapshots out of a message log. */
function snapshotsIn(received: readonly ServerMessage[]): SnapshotMessage[] {
  return received.filter((m): m is SnapshotMessage => m.type === 'snapshot');
}

describe('LocalLoopback — ordered input ticks', () => {
  it('produces the identical world to stepping the sim directly', () => {
    const { transport } = openLoopback();

    for (let tick = 1; tick <= TICKS; tick++) {
      // The other slots' input arrives first and out of slot order, exactly as
      // a network would deliver it; the driving client's input closes the tick.
      for (const player of [3, 1, 2]) transport.sendAs(player, inputMessage(player, tick));
      transport.send(inputMessage(0, tick));
    }

    const direct = stepDirectly(TICKS);
    expect(transport.world).not.toBeNull();
    expect(transport.world!.tick).toBe(TICKS);
    // Not "close enough" — the same world, field by field.
    expect(transport.world).toEqual(direct);
  });

  it('runs one sim tick per client input tick', () => {
    const { transport } = openLoopback();
    expect(transport.world!.tick).toBe(0);

    transport.send(inputMessage(0, 1));
    expect(transport.world!.tick).toBe(1);
    transport.send(inputMessage(0, 2));
    expect(transport.world!.tick).toBe(2);
  });

  it('drops input for a tick it already simulated instead of rewinding', () => {
    const { transport } = openLoopback();
    for (let tick = 1; tick <= 3; tick++) transport.send(inputMessage(0, tick));

    const before = transport.world!.tick;
    transport.sendAs(1, inputMessage(1, 2)); // a straggler for a spent tick
    expect(transport.world!.tick).toBe(before);
    expect(transport.inputStats.late).toBe(1);
  });

  it('bounds the catch-up a single message can trigger', () => {
    const { transport } = openLoopback();
    transport.send(inputMessage(0, 100));
    expect(transport.world!.tick).toBe(MAX_CATCHUP_TICKS);

    // The remainder is not lost — the next pulse keeps walking forward.
    transport.send(inputMessage(0, 100));
    expect(transport.world!.tick).toBe(MAX_CATCHUP_TICKS * 2);
  });

  it('never advances a slot that is not driving the clock', () => {
    const { transport } = openLoopback();
    for (let tick = 1; tick <= 5; tick++) transport.sendAs(2, inputMessage(2, tick));
    // A bot's input is filed for its tick, but only the driver pulses the sim.
    expect(transport.world!.tick).toBe(0);
    expect(transport.inputStats.queued).toBe(5);
  });
});

describe('LocalLoopback — the protocol a client sees', () => {
  it('welcomes, states the lobby, and starts the match', () => {
    const { received } = openLoopback();
    const types = received.map((m) => m.type);

    expect(types.slice(0, 3)).toEqual(['welcome', 'lobbyState', 'matchStart']);
    const welcome = received[0];
    expect(welcome).toMatchObject({ you: 0, room: OFFLINE_ROOM, tick: 0 });
    const lobby = received[1];
    if (lobby?.type !== 'lobbyState') throw new Error('expected lobbyState');
    // Offline, every slot the local player is not flying is a bot (GDD §2.1).
    expect(lobby.slots.map((s) => s.isBot)).toEqual([false, true, true, true]);
  });

  it('opens on join and closes on close', () => {
    const states: string[] = [];
    const transport = new LocalLoopback({ match: MATCH });
    transport.onStateChange((s) => states.push(s));
    expect(transport.state).toBe('connecting');

    transport.send({ type: 'join', room: OFFLINE_ROOM });
    expect(transport.state).toBe('open');
    transport.close();
    expect(transport.state).toBe('closed');
    expect(states).toEqual(['open', 'closed']);
  });

  it('honors a lobby ship-class choice made before RUSH!', () => {
    const transport = new LocalLoopback({ match: MATCH, localPlayer: 0 });
    transport.send({ type: 'join', room: OFFLINE_ROOM });
    transport.send({ type: 'lobbyChoice', shipClass: ShipClass.Hauler, fireMode: 'manual' });
    transport.send({ type: 'startMatch' });

    expect(transport.world!.ships[0]!.shipClass).toBe(ShipClass.Hauler);
    // Locked for the match once it starts (GDD §2.11).
    transport.send({ type: 'lobbyChoice', shipClass: ShipClass.Interceptor, fireMode: 'manual' });
    expect(transport.world!.ships[0]!.shipClass).toBe(ShipClass.Hauler);
  });

  it('broadcasts binary snapshots on the spike’s 30 Hz divisor', () => {
    const { transport, received } = openLoopback();
    for (let tick = 1; tick <= 10; tick++) transport.send(inputMessage(0, tick));

    const snapshots = snapshotsIn(received);
    // Ticks 0, 2, 4, 6, 8, 10 — every second tick of the 60 Hz sim.
    expect(snapshots.map((s) => s.tick)).toEqual([0, 2, 4, 6, 8, 10]);

    const latest = snapshots.at(-1)!;
    const decoded = decodeSnapshot(latest.payload);
    expect(decoded.tick).toBe(transport.world!.tick);
    expect(decoded.ships).toHaveLength(MATCH.players.length);
    // Quantized to the wire, so compare against the world at wire precision.
    expect(decoded.ships[0]!.posX).toBe(Math.round(transport.world!.ships[0]!.pos.x));
    // Every ship is alive and inside its 10 s of spawn protection this early.
    for (const s of decoded.ships) {
      expect(s.flags & SHIP_FLAG.alive).toBeTruthy();
      expect(s.flags & SHIP_FLAG.spawnProtected).toBeTruthy();
    }
  });

  it('acks the latest input the server actually holds', () => {
    const { transport, received } = openLoopback();
    transport.send({ type: 'input', tick: 1, seq: 41, actions: [] });
    transport.send({ type: 'input', tick: 2, seq: 42, actions: [] });

    expect(snapshotsIn(received).at(-1)!.ackSeq).toBe(42);
  });

  it('ignores everything after close', () => {
    const { transport } = openLoopback();
    transport.send(inputMessage(0, 1));
    transport.close();
    transport.send(inputMessage(0, 2));
    expect(transport.world!.tick).toBe(1);
  });
});

describe('MatchSession — the client loop, transport-fed', () => {
  it('drives the same world the loop would have stepped itself', () => {
    const session = createLocalSession({ match: MATCH, localPlayer: 0, snapshotIntervalTicks: 0 });
    expect(session.you).toBe(0);
    expect(session.world).not.toBeNull();

    // The loop's day-3 shape: one sendInput per fixed step, nothing else.
    for (let tick = 1; tick <= 120; tick++) session.sendInput(scriptedInput(0, tick));

    const direct = createWorld(MATCH);
    for (let tick = 1; tick <= 120; tick++) {
      step(direct, [{ id: 0, actions: scriptedInput(0, tick) }]);
    }
    expect(session.world).toEqual(direct);
    expect(session.tick).toBe(121); // the next tick input will apply to
  });

  it('stamps ticks in order from the tick the server welcomed it on', () => {
    const session = createLocalSession({ match: MATCH, snapshotIntervalTicks: 0 });
    expect(session.tick).toBe(1);
    session.sendInput([]);
    session.sendInput([]);
    expect(session.tick).toBe(3);
    expect(session.world!.tick).toBe(2);
  });
});

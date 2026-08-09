/**
 * tests/net/abundance-reaches-world.test.ts — **the abundance the lobby promises
 * is the abundance the world is built at**, on BOTH shipped paths. OWNER: Netcode
 * Engineer (GDD §2.8, ratified p11 + a0-17; n5-01).
 *
 * THE BUG THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * The widened interval table — SCARCE 180 s, STANDARD 150 s, RICH 112.5 s — was
 * ratified and had never once been live in a real match. The a1-05 evidence round
 * caught it twice on the build at `7e175ac`:
 *
 *   - offline (PLAY → PLAY SOLO), lobby chip `YIELD · SCARCE`, HUD at t≈4 s:
 *     `WAVE 1/5 · NEXT 2:27` → a 151 s interval;
 *   - online (a real fly.io gameserver), t≈6 s: `NEXT 2:25` → 151 s again.
 *
 * 150 is not a wrong multiplier. **150 is `standard`** — what `resolveEconomy`
 * returns when nobody names a level at all. The lobby read the player's pick,
 * showed it and stored it; then `bootOfflineMatch` had no field to carry it in,
 * `matchStart` had no field to state it in, and both worlds were built with no
 * abundance at all.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS TWO PATHS
 * ---------------------------------------------------------------------------
 * The chain an economy runs on is
 *
 *   lobby YIELD row → MatchConfig → { bootOfflineMatch | lobbyChoice → room }
 *     → createWorld → world.economy → waveIntervalOf → the wave clock, the
 *     spawner, the bots' `waveTime`, the collapse deadline
 *
 * and every consumer past `world.economy` was already correct — this is a
 * PRODUCER bug, in two producers. So both are walked end to end here: the offline
 * one through the real lobby model and the real boot, the online one through the
 * real wire, the real room and the real predicting session. The online half
 * additionally asserts the two ends AGREE, because a client predicting a 180 s
 * metronome against a server spawning on a 150 s one is worse than the honest 150.
 *
 * Every number below is the ratified table (GDD §2.8) written out longhand rather
 * than recomputed from `ABUNDANCE`: a test that multiplies the same constants the
 * code multiplies would still pass if the table were retuned, and the table is the
 * contract this brief threads — not one it may move.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createLobby, cycleAbundance, lobbyMatchConfig } from '../../src/ui';
import type { LobbyState } from '../../src/ui';
import { bootOfflineMatch } from '../../src/platform/match-boot';
import type { MatchBoot } from '../../src/platform/match-boot';
import { collapseDeadline, matchAbundance, waveIntervalOf } from '../../src/sim';
import type { Abundance, World } from '../../src/sim';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import { encodeClientMessage, parseClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { TransportSession } from '../../src/net/session';
import type {
  ClientMessage,
  ConnectionState,
  MatchStartMessage,
  ServerMessage,
  Transport,
} from '../../src/net/transport';

/** The ratified wave interval per level, in seconds (GDD §2.8, a0-17). The whole
 *  point of this file is that a match actually runs on the one it was promised. */
const RATIFIED_INTERVAL: Readonly<Record<Abundance, number>> = {
  scarce: 180,
  standard: 150,
  rich: 112.5,
};

const LEVELS = ['scarce', 'standard', 'rich'] as const;

/** A four-seat solo lobby wound to `level` by the ABUNDANCE row itself — the same
 *  function a tap on YIELD drives (`src/ui/lobby` `cycleAbundance`), so this walks
 *  the player's own control rather than poking the field behind it. */
function soloLobbyAt(level: Abundance): LobbyState {
  let state = createLobby({
    room: 'LOCAL',
    you: 0,
    host: 0,
    shipClass: ShipClass.Vanguard,
    size: 4,
    online: false,
  });
  // The ring has three stops, so three cycles is a full turn: a loop that cannot
  // find the level is a broken row, not an infinite test.
  for (let turn = 0; turn < 3 && state.abundance !== level; turn++) {
    state = cycleAbundance(state);
  }
  expect(state.abundance, `the lobby row reaches ${level}`).toBe(level);
  return state;
}

/** Boot the offline match the way the product does: the lobby authors a
 *  `MatchConfig`, and its abundance is what `bootOfflineMatch` is given. */
function bootSoloAt(level: Abundance): MatchBoot {
  const config = lobbyMatchConfig(soloLobbyAt(level));
  return bootOfflineMatch({
    seed: 0x5a17,
    localPlayer: 0,
    shipClass: ShipClass.Vanguard,
    slots: 4,
    abundance: matchAbundance(config),
  });
}

// ---------------------------------------------------------------------------
// Offline — PLAY SOLO
// ---------------------------------------------------------------------------

describe('offline: the lobby YIELD row is the economy the world is built at (n5-01)', () => {
  /**
   * THE REGRESSION ITSELF. Red on `7e175ac`: `bootOfflineMatch` took no
   * abundance, so `createWorld` resolved `standard` and this read 150.
   */
  it('a SCARCE lobby boots a SCARCE world — 180 s between waves, not 150', () => {
    const boot = bootSoloAt('scarce');
    try {
      expect(boot.world.economy?.abundance).toBe('scarce');
      expect(boot.world.economy?.waveInterval).toBe(RATIFIED_INTERVAL.scarce);
      // …and the accessor every consumer actually reads — the wave clock
      // (`src/ui/wave-clock`), the spawner, `src/bots/perception` — agrees.
      expect(waveIntervalOf(boot.world)).toBe(RATIFIED_INTERVAL.scarce);
    } finally {
      boot.close();
    }
  });

  it('and SCARCE is what an untouched lobby is on — the ratified default', () => {
    // The developer's "by default more scarce" (p11): a host who never touches
    // the YIELD row gets 180, which is the case both live captures were in.
    const config = lobbyMatchConfig(
      createLobby({ room: 'LOCAL', you: 0, host: 0, shipClass: ShipClass.Vanguard, size: 4, online: false }),
    );
    expect(matchAbundance(config)).toBe('scarce');
  });

  it('carries every level, so the spread the developer asked for is real', () => {
    for (const level of LEVELS) {
      const boot = bootSoloAt(level);
      try {
        expect(boot.world.economy?.abundance, level).toBe(level);
        expect(waveIntervalOf(boot.world), level).toBe(RATIFIED_INTERVAL[level]);
      } finally {
        boot.close();
      }
    }
    // The whole ask, restated as one number: *"it should be a much BIGGER time
    // difference"* — 67.5 s between the lean and the generous wait, where the
    // shipped build delivered 0.
    expect(RATIFIED_INTERVAL.scarce - RATIFIED_INTERVAL.rich).toBe(67.5);
  });

  it('threads the ORE as well as the CLOCK — abundance is three multipliers, not one', () => {
    const scarce = bootSoloAt('scarce');
    const standard = bootSoloAt('standard');
    try {
      // `respawnInterval` is the visible half; a world that only got the clock
      // right would still be mining a STANDARD field (GDD §2.8: totalOre ×0.55,
      // density ×0.75 at SCARCE).
      expect(scarce.world.economy!.fieldYield).toBeLessThan(standard.world.economy!.fieldYield);
      expect(scarce.world.economy!.asteroidsPerWave).toBeLessThanOrEqual(
        standard.world.economy!.asteroidsPerWave,
      );
    } finally {
      scarce.close();
      standard.close();
    }
  });

  /**
   * The rail this brief must not move (GDD §1, §2.8). A genuinely-180 s SCARCE
   * match cannot silently stretch past the 10–15 minute target: `collapseDeadline`
   * re-anchors off the per-world interval, so the deadline is the baseline one and
   * all five waves still land before it. Asserted on a REAL booted product world
   * rather than on a hand-built one — the sim's own suite proves the arithmetic
   * (`src/sim/abundance.test.ts`), this proves the match that ships inherits it.
   */
  it('a genuinely-SCARCE match still ends on the ratified rail', () => {
    const scarce = bootSoloAt('scarce');
    const standard = bootSoloAt('standard');
    try {
      const deadline = collapseDeadline(scarce.world);
      expect(deadline).toBeCloseTo(collapseDeadline(standard.world), 6);
      expect(deadline).toBeLessThanOrEqual(15 * 60);
      // Collapse never opens before the fifth wave has landed (GDD §2.3).
      const lastWave = 4 * RATIFIED_INTERVAL.scarce;
      expect(lastWave).toBeLessThanOrEqual(deadline);
    } finally {
      scarce.close();
      standard.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Online — the room is authority, and it TELLS the client
// ---------------------------------------------------------------------------

/** A socket that keeps its frames, so the test can read what a client was told. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    /* nothing to tear down in-process */
  }
}

/** A `Transport` the test drives by hand — no socket, no authority, so the
 *  session builds its own predicted world from `matchStart` (Task C4's rig). */
class FakeTransport implements Transport {
  state: ConnectionState = 'open';
  readonly sent: ClientMessage[] = [];
  private handler: ((message: ServerMessage) => void) | null = null;

  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  onMessage(handler: (message: ServerMessage) => void): void {
    this.handler = handler;
  }
  onStateChange(): void {
    /* no state changes here */
  }
  close(): void {
    this.state = 'closed';
  }
  deliver(message: ServerMessage): void {
    this.handler?.(message);
  }
}

/**
 * Stand up a room, author it as the host's lobby would, and RUSH.
 *
 * Everything goes in through `encodeClientMessage` → the real parser → the real
 * room, so the wire's own allow-list is under test too: a level the parser drops
 * never reaches `createWorld`, and this would find that.
 */
function startOnlineRoom(abundance?: Abundance): { host: Connection; socket: FakeSocket } {
  const server = new MatchServer({ seed: 0x0be1, graceMs: 60_000, asteroidCount: 12 });
  server.update(1_000_000);
  const code = server.createCode();
  const socket = new FakeSocket();
  const host = server.connect(socket);
  host.receive(encodeClientMessage({ type: 'join', room: code }));
  host.receive(
    encodeClientMessage({
      type: 'lobbyChoice',
      shipClass: ShipClass.Vanguard,
      fireMode: 'manual',
      // Three seats: the host and two bots, so RUSH! has a match to start.
      seats: ['open', 'bot', 'bot'],
      ...(abundance ? { abundance } : {}),
    }),
  );
  host.receive(encodeClientMessage({ type: 'startMatch' }));
  return { host, socket };
}

/** The `matchStart` this client was actually sent, parsed off the wire. */
function matchStartOf(socket: FakeSocket): MatchStartMessage {
  const message = socket.frames
    .map((frame) => parseServerMessage(frame))
    .find((m): m is MatchStartMessage => m?.type === 'matchStart');
  expect(message, 'the room sent a matchStart').toBeDefined();
  return message!;
}

/** The world a real `TransportSession` predicts from that `matchStart`. */
function predictedWorldFrom(start: MatchStartMessage): World {
  const transport = new FakeTransport();
  const session = new TransportSession(transport);
  transport.deliver({ type: 'welcome', you: 0, room: 'RUSH', tick: 0 });
  transport.deliver(start);
  expect(session.world, 'the session built a predicted world').not.toBeNull();
  return session.world!;
}

describe('online: the room builds the promised economy and states it (n5-01)', () => {
  /**
   * THE REGRESSION, ONLINE. Red on `7e175ac`: `lobbyChoice` had no abundance
   * field, the room passed none to `createWorld`, and a live fly.io match ran the
   * `standard` 150 s metronome under a lobby that said SCARCE.
   */
  it('a SCARCE lobbyChoice builds a SCARCE authoritative world — 180 s', () => {
    const { host } = startOnlineRoom('scarce');
    const world = host.room!.world!;
    expect(world.economy?.abundance).toBe('scarce');
    expect(world.economy?.waveInterval).toBe(RATIFIED_INTERVAL.scarce);
  });

  /**
   * The client must be TOLD, not guess: `matchStart` is its world-constructor
   * call, and abundance is one of the arguments.
   */
  it('matchStart carries the abundance, and the predicted world resolves it', () => {
    const { socket } = startOnlineRoom('scarce');
    const start = matchStartOf(socket);
    expect(start.abundance).toBe('scarce');
    expect(predictedWorldFrom(start).economy?.waveInterval).toBe(RATIFIED_INTERVAL.scarce);
  });

  /**
   * And they agree — the property the field exists for. A predicted 180 against
   * an authoritative 150 is worse than today's honest 150, because the clock, the
   * spawner and the collapse deadline would all read a metronome the rocks are
   * not keeping.
   */
  it('authority and prediction resolve the SAME economy, at every level', () => {
    for (const level of LEVELS) {
      const { host, socket } = startOnlineRoom(level);
      const authoritative = host.room!.world!;
      const predicted = predictedWorldFrom(matchStartOf(socket));
      expect(predicted.economy, level).toEqual(authoritative.economy);
      expect(waveIntervalOf(predicted), level).toBe(RATIFIED_INTERVAL[level]);
    }
  });

  it('a room nobody priced opens on the ratified SCARCE default, not standard', () => {
    // A pre-n5-01 client sends no abundance at all. The room must land where the
    // lobby's own untouched YIELD row lands — "by default more scarce" (p11) —
    // rather than on `resolveEconomy`'s legacy `standard` fallback.
    const { host, socket } = startOnlineRoom(undefined);
    expect(host.room!.world!.economy?.waveInterval).toBe(RATIFIED_INTERVAL.scarce);
    expect(matchStartOf(socket).abundance).toBe('scarce');
  });
});

describe('the wire admits three levels and nothing else (n5-01)', () => {
  const choice = (abundance: unknown): ClientMessage | null =>
    parseClientMessage(
      JSON.stringify({ type: 'lobbyChoice', shipClass: ShipClass.Vanguard, fireMode: 'manual', abundance }),
    );

  it('carries each ratified level through the parser', () => {
    for (const level of LEVELS) {
      const parsed = choice(level);
      expect(parsed?.type === 'lobbyChoice' ? parsed.abundance : null, level).toBe(level);
    }
  });

  it('drops an unknown level rather than coercing it — and keeps the hull pick', () => {
    for (const junk of ['SCARCE', 'lavish', 7, null, {}]) {
      const parsed = choice(junk);
      // Dropped, not refused: a bad YIELD must not cost the sender their ship.
      expect(parsed?.type, String(junk)).toBe('lobbyChoice');
      expect(parsed?.type === 'lobbyChoice' ? parsed.abundance : 'set', String(junk)).toBeUndefined();
    }
  });
});

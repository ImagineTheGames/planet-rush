/**
 * tests/net/local-revert.test.ts — a room with nobody else in it plays locally,
 * and gives the room back. OWNER: Netcode Engineer (a0-11; GDD §4.2 *amended
 * 2026-08-07*).
 *
 * The developer: *"creating an online match with only bots should also revert
 * back to offline match (so we don't waste money for no reason on servers)."*
 *
 * These are the brief's tests 4, 5 and 6, and they are deliberately asserted
 * against **the transport actually chosen and the room actually held** — never
 * against a log line. A log line is a claim; `server.roomCount` and
 * `isLocalAuthority` are the thing itself. The one that would have shipped
 * quietly broken is test 4's second half: a client that stops *talking* to a room
 * it never released has saved nothing at all, because the room is the unit the
 * fleet is packed by (`src/net/local-revert` `ROOM_COST_NOTE`).
 *
 * The decision itself is `playsLocally`, and it is asked of the ROSTER at RUSH!
 * rather than of the door — which is what these drive: a real `MatchServer`, real
 * sockets through `createOnlineSession`, a real lobby model, and then the same
 * `bootOfflineMatch` the solo game boots through.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld } from '../../src/sim';
import { configToPlayers } from '../../src/sim/match-config';
import { bootOfflineMatch } from '../../src/platform/match-boot';
import {
  LOCAL_REVERT_TELL,
  createOnlineSession,
  localSeat,
  playsLocally,
  releaseRoom,
} from '../../src/net';
import type { OnlineSession } from '../../src/net';
import {
  createLobby,
  cycleSeatState,
  denseSeatIndex,
  isParticipant,
  lobbyMatchConfig,
  lobbyRosterTeams,
  lobbyWireSeats,
  matchSizeOf,
  applyLobbySlots,
  seatLocalPlayer,
} from '../../src/ui';
import type { LobbyState } from '../../src/ui';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';
import { netBudget } from './budgets';

const SEED = 4711;

/**
 * Wait for a session to have been given its own seat.
 *
 * There is no `welcome` event to await on the public surface, and the seat is the
 * thing every assertion below needs, so the wait is for the ROOM to have seated
 * this many people — the state, not a proxy for it (`./node-websocket` `until`).
 */
async function seated(server: { room: (code: string) => { humanCount: number } | undefined }, code: string, humans: number): Promise<void> {
  await until(
    `the room to hold ${humans} human(s)`,
    () => (server.room(code)?.humanCount ?? 0) >= humans,
    5_000,
    () => `room holds ${server.room(code)?.humanCount ?? 0}`,
  );
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  const run = cleanup;
  cleanup = null;
  if (run) await run();
});

/** The census the decision is taken on — humans and bots, counted through the
 *  lobby's own `isParticipant` so there is one definition of "in the match". */
function censusOf(state: LobbyState): { humans: number; bots: number } {
  const seats = state.seats.filter((s) => isParticipant(s.occupant));
  return {
    humans: seats.filter((s) => s.occupant === 'human').length,
    bots: seats.filter((s) => s.occupant === 'bot').length,
  };
}

/** Boot the match the lobby authored, on the local transport — the same call
 *  `main.ts` makes, from the same config it resolves. */
function bootLocal(state: LobbyState, seed = SEED): ReturnType<typeof bootOfflineMatch> {
  return bootOfflineMatch({
    seed,
    localPlayer: localSeat(denseSeatIndex(state, state.you)),
    shipClass: state.shipClass,
    mapId: state.mapId,
    slots: matchSizeOf(state),
    teams: lobbyRosterTeams(state),
  });
}

describe('a room whose only human is the host plays locally (a0-11)', () => {
  // ── TEST 4 ────────────────────────────────────────────────────────────────
  it(
    'boots the OFFLINE transport and holds no server session',
    async () => {
      const harness = await startMatchServer({ seed: SEED, slots: 8, asteroidCount: 10 });
      const sessions: OnlineSession[] = [];
      cleanup = async (): Promise<void> => {
        for (const s of sessions) s.close();
        await harness.stop();
      };

      // A real CREATE: a socket, a welcome, a seat, a room on a real server.
      const session = createOnlineSession({
        url: harness.url,
        room: 'SOLO',
        shipClass: ShipClass.Vanguard,
        transport: { connect: nodeWebSocket },
      });
      sessions.push(session);
      await seated(harness.matches, 'SOLO', 1);
      expect(harness.matches.roomCount, 'the room is real and held').toBe(1);

      // The host's lobby, and the two bots they seat themselves — "it should be up
      // to player to fill it up with bots if they want".
      let lobby = seatLocalPlayer(
        createLobby({ room: 'SOLO', you: session.you, host: session.you, online: true }),
        session.you,
        session.you,
      );
      for (const slot of [1, 4]) lobby = cycleSeatState(lobby, slot);
      session.chooseInLobby({ shipClass: lobby.shipClass, seats: lobbyWireSeats(lobby) });

      // RUSH!, and the decision — taken on the ROSTER, at this instant.
      const census = censusOf(lobby);
      expect(census).toEqual({ humans: 1, bots: 2 });
      expect(playsLocally(census), 'one human and some bots needs no server').toBe(true);

      // …so the room is handed back BEFORE the match boots.
      const release = releaseRoom({ code: 'SOLO', close: () => session.close() });
      expect(release?.room).toBe('SOLO');
      expect(release?.released).toBe(true);

      // THE ASSERTION THIS TEST EXISTS FOR. Not "we logged a revert" — the room
      // is gone from the server, the code is free, and the Machine is holding
      // nothing. The sweep runs on `update`, so give it one.
      await until('the room to be swept off the server', () => harness.matches.roomCount === 0);
      expect(harness.matches.roomCount).toBe(0);
      // …and the match never started on it, so no room-tick was ever spent.
      expect(session.world, 'no predicted world: no server match was ever begun').toBeNull();

      // And the transport the match actually got is the LOCAL one — asserted by
      // the two things only a local authority can be true of, rather than by a
      // name: the session PREDICTS NOTHING (there is no wire to hide, so
      // `beginPredicting` never runs — `src/net/session`), and the world it hands
      // the renderer IS the authoritative world, the same object, at zero
      // latency. An online session has a predictor and a separate predicted copy.
      const match = bootLocal(lobby);
      try {
        expect(match.session.prediction, 'a local authority predicts nothing').toBeNull();
        expect(match.session.world, 'the rendered world IS the authoritative one').toBe(match.world);
        // Three participants: the host and the two bots they seated. The five
        // seats left OPEN brought nothing (GDD §2.1 amended).
        expect(match.world.ships).toHaveLength(3);
        expect(match.world.ships.some((s) => s.id === localSeat(denseSeatIndex(lobby, lobby.you)))).toBe(
          true,
        );
      } finally {
        match.close();
      }

      // The tell is one line, and it says what happened rather than what we saved.
      expect(LOCAL_REVERT_TELL).toBe('NOBODY JOINED — PLAYING LOCALLY');
    },
    netBudget({
      work: 'boot a match server → CREATE a room over a real socket → seat two bots → take the RUSH! decision → release the room and watch the server sweep it → boot the local transport instead',
      measuredSeconds: 0.3,
    }),
  );

  // ── TEST 5 ────────────────────────────────────────────────────────────────
  it(
    'still boots ONLINE the moment a second human is in the room',
    async () => {
      const harness = await startMatchServer({ seed: SEED, slots: 8, asteroidCount: 10 });
      const sessions: OnlineSession[] = [];
      cleanup = async (): Promise<void> => {
        for (const s of sessions) s.close();
        await harness.stop();
      };

      const host = createOnlineSession({
        url: harness.url,
        room: 'PAIR',
        shipClass: ShipClass.Vanguard,
        transport: { connect: nodeWebSocket },
      });
      sessions.push(host);
      await seated(harness.matches, 'PAIR', 1);

      // The host's own lobby, and its subscription to the room — BOTH before the
      // guest dials. `lobbyState` is broadcast on change, so an observer attached
      // after the arrival would simply never hear about it.
      let lobby = seatLocalPlayer(
        createLobby({ room: 'PAIR', you: host.you, host: host.you, online: true }),
        host.you,
        host.you,
      );
      // The roster is folded in from the room's own broadcast, exactly as the
      // client does it — the guest is a human seat because the SERVER says so,
      // not because this test asserted it into place.
      host.observe((message) => {
        if (message.type === 'lobbyState') lobby = applyLobbySlots(lobby, message.slots);
      });

      const guest = createOnlineSession({
        url: harness.url,
        room: 'PAIR',
        shipClass: ShipClass.Interceptor,
        transport: { connect: nodeWebSocket },
      });
      sessions.push(guest);
      await seated(harness.matches, 'PAIR', 2);
      await until('the joiner to read its own welcome', () => guest.you !== host.you, 5_000);

      await until(
        'the guest to reach the host roster',
        () => lobby.seats.some((s) => s.player !== host.you && s.occupant === 'human'),
        5_000,
      );

      const census = censusOf(lobby);
      expect(census.humans, 'two people are in this room').toBe(2);
      expect(playsLocally(census), 'a room with two humans needs an authority').toBe(false);

      // So RUSH! goes to the server, and it is the server that builds the match.
      host.startMatch();
      await until('the room to go live', () => harness.matches.roomCount === 1 && host.world !== null);
      expect(host.world, 'the host is predicting against a real room').not.toBeNull();
      expect(guest.world).not.toBeNull();
      // The room was NOT released: it is still there, holding two people.
      expect(harness.matches.roomCount).toBe(1);
    },
    netBudget({
      work: 'boot a match server → two real sockets join one room → take the RUSH! decision → start the match on the server and confirm both clients predict against it',
      measuredSeconds: 0.35,
    }),
  );
});

// ── TEST 6 ──────────────────────────────────────────────────────────────────
describe('the same seed builds the same arena on both paths (GDD §4.8)', () => {
  it('a locally-booted room is the match the server would have built', () => {
    // The lobby a host would RUSH from: three participants, one hull, one arena.
    let lobby = seatLocalPlayer(
      createLobby({ room: 'SAME', you: 0, host: 0, online: true, mapId: 'compass' }),
      0,
      0,
    );
    for (const slot of [2, 5]) lobby = cycleSeatState(lobby, slot);
    expect(matchSizeOf(lobby)).toBe(3);

    // The world AUTHORITY would have built, from the roster the lobby authored —
    // the same `createWorld` call `server/room.ts` makes at RUSH! (its roster is
    // dense, because the room compacts before it builds).
    const authority = createWorld({
      seed: SEED,
      mapId: lobby.mapId,
      players: configToPlayers(lobbyMatchConfig(lobby)),
    });

    // …and the world the LOCAL boot builds, from the same seed and config.
    const local = bootLocal(lobby);
    try {
      expect(local.world.ships).toHaveLength(authority.ships.length);
      // The arena is the thing the brief names: the homes, in the same places.
      expect(local.world.stations.map((s) => ({ x: s.pos.x, y: s.pos.y }))).toEqual(
        authority.stations.map((s) => ({ x: s.pos.x, y: s.pos.y })),
      );
      // …and every rock, because "same arena" is the whole board, not the homes.
      expect(local.world.asteroids.map((a) => ({ x: a.pos.x, y: a.pos.y }))).toEqual(
        authority.asteroids.map((a) => ({ x: a.pos.x, y: a.pos.y })),
      );
      // The sides survive the trip too: an FFA room is teams-of-one on both.
      expect(local.world.ships.map((s) => s.team)).toEqual(authority.ships.map((s) => s.team));
    } finally {
      local.close();
    }
  }, netBudget({
    work: 'build the world authority would have built from the lobby roster, build the local one from the same seed and config, and compare every home and every rock',
    measuredSeconds: 0.05,
  }));

  it('a different seed is a different arena — so the check above is not vacuous', () => {
    let lobby = seatLocalPlayer(createLobby({ room: 'DIFF', you: 0, host: 0, online: true }), 0, 0);
    for (const slot of [1, 2]) lobby = cycleSeatState(lobby, slot);
    const a = bootLocal(lobby, SEED);
    const b = bootLocal(lobby, SEED + 1);
    try {
      expect(a.world.asteroids.map((r) => r.pos.x)).not.toEqual(b.world.asteroids.map((r) => r.pos.x));
    } finally {
      a.close();
      b.close();
    }
  }, netBudget({
    work: 'build the same lobby twice on two seeds and confirm the arenas differ',
    measuredSeconds: 0.05,
  }));
});

/**
 * tests/net/online-lobby-flow.test.ts — CREATE ROOM opens a LOBBY, and it is the
 * same lobby PLAY SOLO opens. Two clients, one room, one authoritative server, over
 * a real socket (GDD §2.1, §4.2; the ratified unified play flow).
 *
 * THE BUG THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * CREATE ROOM had no lobby. The doors screen allocated a room, showed the code, and
 * the next thing that happened was the match — so a host could not pick a map, a
 * mode, an ore abundance, a hull, the bots' difficulties, or the size of the match
 * they were inviting people to, and a joiner watched a code with no roster under it.
 * Every one of those controls existed, tested and working, in the OFFLINE lobby.
 * The developer's ratification is one sentence: "CREATE ROOM → goes to a lobby where
 * you select players, just like when you press the play button."
 *
 * WHY THIS TEST IS HERE AND NOT IN THE LIVE-STAGE SUITE
 * ---------------------------------------------------------------------------
 * The shipped browser bundle has no allocator (`VITE_ALLOCATOR_URL` is unset), so a
 * Playwright run against it can only ever prove that CREATE fails *gracefully* —
 * which `tests/live-stage/online-flow.spec.ts` already does. The thing worth proving
 * is the part that needs a server: that the lobby sits between the room and the
 * match, that a joiner appears in the host's roster live, that a guest cannot move
 * the room's configuration, and that RUSH! goes out at the END of the countdown and
 * the match arrives from authority. All of that is reachable here, with nothing
 * mocked: the same `node:http` + RFC 6455 + `MatchServer` stack as
 * `./online-2p.test.ts`, two real `createOnlineSession` clients, and the REAL lobby
 * model (`src/ui/lobby`) driven exactly the way `src/main.ts` `openLobby` drives it.
 *
 * The one thing it does not touch is pixels; the drawn screen — the code up top, the
 * dimmed arena row a guest reads — is the live-stage suite's job
 * (`tests/live-stage/unified-play-flow.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import {
  applyLobbySlots,
  botDifficulties,
  canStart,
  createLobby,
  cycleAbundance,
  cycleBotDifficulty,
  cycleSeatState,
  cycleSeatTeam,
  lobbyModel,
  lobbyWireTeams,
  matchSizeOf,
  pressRush,
  selectMap,
  selectShipClass,
  setPlayerName,
  startLobbyMatch,
  tickLobby,
  toggleMode,
} from '../../src/ui/lobby';
import type { LobbyState } from '../../src/ui/lobby';
import type { LobbySlot } from '../../src/net/transport';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';
import { areEnemies, canDamage } from '../../src/sim';

// ---------------------------------------------------------------------------
// The client, assembled the way `main.ts` assembles it
// ---------------------------------------------------------------------------

/**
 * One browser client: a real session, plus the lobby it drives. The wiring is
 * `openLobby`'s, transcribed — `lobbyState` folds in through `applyLobbySlots` (this
 * is what makes joiners appear), `matchStart` ends the lobby whatever the local
 * countdown believed, and a choice is re-sent on every change with the host's bot
 * difficulties in empty-seat order.
 *
 * Transcribed rather than imported because `openLobby` is a Pixi/DOM function; what
 * is shared with the shipped client is every decision it makes — the model calls, in
 * this order — which is exactly the part that can be wrong.
 */
interface Client {
  readonly session: OnlineSession;
  /** The live lobby. Read after an `await until(...)`, never mid-message. */
  lobby(): LobbyState;
  /** Fold a local model change in and tell the room, as a tap would. */
  apply(next: (state: LobbyState) => LobbyState): void;
  /** True once the server's `matchStart` has ended this client's lobby. */
  started(): boolean;
}

function openClient(
  session: OnlineSession,
  room: string,
  you: PlayerId,
  host: PlayerId,
): Client {
  let state = createLobby({ room, you, host, online: true });
  let started = false;

  const send = (): void => {
    const isHost = state.you === state.host;
    session.chooseInLobby({
      shipClass: state.shipClass,
      // Honoured only from the creator (`server/room.ts` — "only the room creator
      // picks the bots' difficulties"), so a guest sending them costs nothing; the
      // shipped client omits them from a guest anyway.
      ...(isHost ? { botDifficulties: botDifficulties(state) } : {}),
      // The match SHAPE, host-only (m10 teams-wire): the MODE and the per-SLOT
      // side. Until this rode along, the mode toggle three screens up moved nothing
      // on the server — the room stayed FFA and built a free-for-all world under a
      // lobby that said TEAMS.
      ...(isHost ? { mode: state.mode, teams: lobbyWireTeams(state) } : {}),
    });
  };

  session.observe((message) => {
    if (message.type === 'lobbyState') state = applyLobbySlots(state, message.slots);
    else if (message.type === 'matchStart') {
      state = startLobbyMatch(state);
      started = true;
    }
  });

  return {
    session,
    lobby: () => state,
    apply: (next) => {
      const folded = next(state);
      if (folded === state) return; // a refused tap costs the wire nothing
      state = folded;
      send();
    },
    started: () => started,
  };
}

/** Run the RUSH! countdown the way the render ticker does, and send `startMatch` on
 *  the ONE frame it reaches zero — not on the press (`src/ui/lobby-flow` rule 2). */
function runCountdown(client: Client): void {
  let state = pressRush(client.lobby());
  expect(state.phase, 'RUSH! starts a countdown').toBe('counting');
  for (let i = 0; i < 120 && state.phase === 'counting'; i++) state = tickLobby(state, 0.1);
  expect(state.phase, 'the countdown reaches zero').toBe('started');
  client.session.startMatch();
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

// ---------------------------------------------------------------------------

describe('CREATE ROOM opens the SAME lobby PLAY SOLO opens (the unified play flow)', () => {
  it('configures the room, fills its seats live, and starts from the host alone', async () => {
    const harness = await startMatchServer({ seed: 4242, slots: 8, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    // --- CREATE ROOM: the host dials, and the server welcomes them into a seat --
    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    await until('the host to be seated', () => harness.matches.room('RUSH') !== undefined);
    const room = harness.matches.room('RUSH');
    if (!room) throw new Error('the room was never created');

    // `welcome` is the handoff (main.ts `beginRoom`): the seat it names is everything
    // the lobby needs to open. The match has NOT started — that is the whole change.
    const host = openClient(hostSession, 'RUSH', hostSession.you, hostSession.you);
    expect(room.world, 'CREATE ROOM does not start a match any more').toBeNull();

    // --- The host configures the match, in the lobby, with the code up ---------
    // Every one of these is a control the online room simply did not have before.
    const model0 = lobbyModel(host.lobby());
    expect(model0.online, 'an online room shows its code and marks seats claimable').toBe(true);
    expect(model0.room, 'the code is the room the socket is in — one code, end to end').toBe('RUSH');
    expect(model0.hostControls, 'the creator holds the slot editor and RUSH!').toBe(true);

    host.apply((s) => selectShipClass(s, ShipClass.Excavator)); // the hull
    host.apply((s) => selectMap(s, 'compass')); // the arena
    host.apply((s) => toggleMode(s)); // FFA ⇄ TEAMS
    host.apply((s) => cycleAbundance(s)); // SCARCE → STANDARD
    host.apply((s) => cycleSeatState(s, 7)); // seat 7: OPEN → BOT
    host.apply((s) => cycleBotDifficulty(s, 3)); // seat 3's tier

    const configured = lobbyModel(host.lobby());
    expect(configured.shipClass).toBe(ShipClass.Excavator);
    expect(configured.mapId).toBe('compass');
    expect(configured.mode).toBe('teams');
    expect(configured.abundance).toBe('standard');
    expect(configured.seats[7]?.state).toBe('bot');
    expect(canStart(host.lobby()), 'a configured TEAMS room with two sides can RUSH').toBe(true);

    // --- JOIN ROOM: a second client types the code and takes an open seat -------
    const guestSession = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(guestSession);
    await until('both seats to be filled', () => room.humanCount === 2);

    // The joiner APPEARS in the host's roster, live, with no re-open and no reload —
    // requirement 2's "names appear as they join", asserted on the host's own model.
    await until('the joiner to appear in the host roster', () => lobbyModel(host.lobby()).humanCount === 2);
    const withGuest = lobbyModel(host.lobby());
    const guestSeat = withGuest.seats.find((s) => !s.isBot && !s.isYou && !s.isClosed);
    expect(guestSeat, 'the guest has a seat on the host screen').toBeDefined();
    expect(guestSeat?.state).toBe('human');

    // --- The guest's own lobby: their seat, and read-only room config -----------
    const guest = openClient(guestSession, 'RUSH', guestSession.you, host.lobby().you);
    const guestModel = lobbyModel(guest.lobby());
    expect(guestModel.seats[guest.lobby().you]?.isYou, 'a joiner sees themselves in their slot').toBe(
      true,
    );
    expect(guestModel.hostControls, 'a joiner does not hold the host controls').toBe(false);

    // Read-only means the model REFUSES, identically — the tap costs the wire nothing.
    const before = guest.lobby();
    expect(selectMap(before, 'diamond'), 'the arena is the host’s').toBe(before);
    expect(toggleMode(before), 'the mode is the host’s').toBe(before);
    expect(cycleAbundance(before), 'the abundance is the host’s').toBe(before);
    expect(cycleSeatState(before, 4), 'the slot editor is the host’s').toBe(before);
    expect(pressRush(before), 'and only the host may RUSH').toBe(before);
    // …but their own hull is theirs, in both lobbies.
    guest.apply((s) => selectShipClass(s, ShipClass.Interceptor));
    expect(guest.lobby().shipClass).toBe(ShipClass.Interceptor);

    // --- RUSH!: sent at the END of the countdown, and authority ends the lobby --
    expect(room.world, 'still no world while the room is being configured').toBeNull();
    runCountdown(host);
    await until('both clients to have a world', () => hostSession.world !== null && guestSession.world !== null);
    await until('both lobbies to end on authority', () => host.started() && guest.started());
    expect(host.lobby().phase).toBe('started');
    expect(guest.lobby().phase).toBe('started');

    // The hulls picked in the lobby are the hulls the server built — the lobby → wire
    // → world path, which is the whole reason the room needed a lobby at all.
    const authority = room.world;
    if (!authority) throw new Error('the room never started its match');
    const hostShip = authority.ships.find((s) => s.id === host.lobby().you);
    const guestShip = authority.ships.find((s) => s.id === guest.lobby().you);
    expect(hostShip?.shipClass, 'the host flies the hull they picked in the room').toBe(
      ShipClass.Excavator,
    );
    expect(guestShip?.shipClass, 'the guest flies theirs').toBe(ShipClass.Interceptor);
    // Eight seats, two humans: the rest are the cast, exactly as the roster previewed.
    expect(matchSizeOf(host.lobby())).toBe(8);
    expect(authority.ships.length).toBe(8);
  });

  it('never starts the match from a guest — the room waits for its host', async () => {
    const harness = await startMatchServer({ seed: 77, slots: 4, asteroidCount: 8 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'WAIT',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    await until('the room to exist', () => harness.matches.room('WAIT') !== undefined);
    const room = harness.matches.room('WAIT');
    if (!room) throw new Error('no room');

    const guestSession = createOnlineSession({
      url: harness.url,
      room: 'WAIT',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(guestSession);
    await until('both seats to be filled', () => room.humanCount === 2);
    const guest = openClient(guestSession, 'WAIT', guestSession.you, hostSession.you);

    // A guest's RUSH! is refused twice over — by the lobby model (it is not theirs to
    // press) and by the server (`startMatch` is honoured from the creator alone). Even
    // sending the message directly, past the UI, must not start the match.
    expect(pressRush(guest.lobby()), 'the model refuses a guest').toBe(guest.lobby());
    guestSession.startMatch();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(room.world, 'the server refuses a non-creator’s start').toBeNull();
    expect(guest.started(), 'and the guest lobby is still gathering').toBe(false);

    // The host's does start it — the same gesture, from the seat that owns it.
    hostSession.startMatch();
    await until('the match to start', () => room.world !== null);
    await until('the guest lobby to end on authority', () => guest.started());
  });

  it('lets go of the room when a client leaves it (BACK — no ghost rooms, u2 item 4)', async () => {
    // BACK out of the online lobby closes the socket before it reloads onto the menu
    // (main.ts `leaveToMenu`), so the client stops holding the room: its transport is
    // shut, it never redials (`WebSocketTransport.close` — "a deliberate exit never
    // redials"), and nothing the room does afterwards can drag it into a match it
    // walked out of.
    //
    // NOTE for Netcode, flagged rather than papered over: the server-side half of the
    // same promise does NOT hold in this harness. `server/room.ts` documents "in the
    // lobby the seat simply frees", but a socket severed before the match starts
    // leaves `room.humanCount` at 2 indefinitely — the close never reaches
    // `Room.disconnect`. (Mid-match it does: `./reconnect-resume.test.ts` observes the
    // substitution.) That is a seat a departed player still occupies, i.e. a room that
    // can read as full to the next joiner. It is `server/`'s to fix, not UI's, so this
    // test asserts the client's half and names the gap instead of asserting a
    // behaviour the server does not currently have.
    const harness = await startMatchServer({ seed: 9, slots: 4, asteroidCount: 8 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'BACK',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    await until('the room to exist', () => harness.matches.room('BACK') !== undefined);
    const room = harness.matches.room('BACK');
    if (!room) throw new Error('no room');

    const guestSession = createOnlineSession({
      url: harness.url,
      room: 'BACK',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(guestSession);
    await until('both seats to be filled', () => room.humanCount === 2);
    const guest = openClient(guestSession, 'BACK', guestSession.you, hostSession.you);

    // The guest presses BACK: the socket closes for good.
    guestSession.close();
    await until('the guest transport to close', () => guestSession.state === 'closed');
    expect(room.world, 'leaving a lobby never starts its match').toBeNull();

    // The room carries on without them — and the client that left is not dragged into
    // it: no world, and a lobby that never started.
    hostSession.startMatch();
    await until('the room to start without the guest', () => room.world !== null);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(guest.started(), 'a client that left never enters the match it left').toBe(false);
    expect(guestSession.world, 'and never builds its world').toBeNull();
  }, 30_000);

  it('fills the seat live — but the joiner’s NAME never crosses the wire (pinned for Netcode)', async () => {
    // Requirement 2 of the ratification asks that "joiners fill HUMAN-open slots live
    // (names appear as they join)". One half of that is real, and the test above
    // asserts it: the seat fills on the host's own model, live, with no re-open and no
    // reload. The other half is NOT this client's to deliver, and this test says so out
    // loud rather than letting a filled roster imply it.
    //
    // `LobbySlot` (src/net/transport.ts) carries `player`, `isBot`, `botDifficulty`,
    // `shipClass`, `ready` and `team` — and no name. So `nameFor` (src/ui/lobby) labels
    // every remote human seat by its slot tag, `PLAYER 2`, and the name a joiner typed
    // never leaves the joiner's own machine. What a host actually watches arrive is a
    // seat, correctly and live, under a slot number rather than a person's name.
    //
    // Closing it means adding a field to `LobbySlot` and populating it in
    // `server/room.ts` — both Netcode's, both ratified contracts, so this lane does not
    // touch either. The assertion below is a FORCING FUNCTION rather than a wish: it
    // FAILS the day a name lands on the wire, which makes deleting this pin (and
    // showing the name) part of that change instead of a comment nobody re-reads.
    const harness = await startMatchServer({ seed: 77, slots: 4, asteroidCount: 8 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'NAME',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    // Every `lobbyState` the host is sent, kept RAW — the wire's own words, before any
    // model has folded them into seats. Registered before the lobby's own observer, so
    // nothing is missed.
    const wire: LobbySlot[][] = [];
    hostSession.observe((message) => {
      if (message.type === 'lobbyState') wire.push(message.slots.map((slot) => ({ ...slot })));
    });
    await until('the room to exist', () => harness.matches.room('NAME') !== undefined);
    const room = harness.matches.room('NAME');
    if (!room) throw new Error('no room');
    const host = openClient(hostSession, 'NAME', hostSession.you, hostSession.you);

    const guestSession = createOnlineSession({
      url: harness.url,
      room: 'NAME',
      shipClass: ShipClass.Hauler,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(guestSession);
    await until('both seats to be filled', () => room.humanCount === 2);
    await until('the joiner to reach the host roster', () => lobbyModel(host.lobby()).humanCount === 2);

    // The SEAT arrives — requirement 2's live-fill half, on the host's screen.
    const guestSeat = lobbyModel(host.lobby()).seats.find((s) => !s.isBot && !s.isYou && !s.isClosed);
    expect(guestSeat, 'the joiner has a seat on the host screen').toBeDefined();
    expect(guestSeat?.state, 'and it fills live, without a reload').toBe('human');

    // The NAME does not — asserted on the wire's own words, not on the UI's reading of
    // them: no slot the host was ever sent carries one.
    expect(wire.length, 'the host was sent at least one lobbyState').toBeGreaterThan(0);
    expect(
      wire.flat().filter((slot) => 'name' in slot),
      'LobbySlot carries no name yet — when it does, delete this pin and DRAW the name',
    ).toEqual([]);

    // …so the row the host reads is labelled by slot tag, which is what
    // `seatView`/`nameFor` fall back to for any human who is not you.
    expect(guestSeat?.name, 'a joiner reads as their slot number on the host screen').toBe(
      `PLAYER ${(guestSeat?.player ?? 0) + 1}`,
    );

    // Requirement 3's half IS met, and needs no wire at all: a joiner sees THEIR OWN
    // name in their own slot, because it never had to cross anything to get there.
    const guest = openClient(guestSession, 'NAME', guestSession.you, hostSession.you);
    const named = setPlayerName(guest.lobby(), 'ZEPHYR');
    const ownSeat = lobbyModel(named).seats.find((s) => s.isYou);
    expect(ownSeat?.name, 'your own seat is you, by name').toBe('ZEPHYR');
  }, 30_000);
});

describe('a TEAMS room is a teams match, over a real socket (m10)', () => {
  it('carries the host\'s split to both rosters, both predicted worlds, and authority', async () => {
    // The closest thing to the developer's own report this lane can run: two real
    // clients on real sockets, one server, the CURRENT unified lobby, TEAMS picked
    // in it. The browser screenshot of the TEAM labels rides QA's round (no
    // browser here); everything underneath the labels is proven here.
    const harness = await startMatchServer({ seed: 909, slots: 4, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'TEAM',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    await until('the host to be seated', () => harness.matches.room('TEAM') !== undefined);
    const room = harness.matches.room('TEAM');
    if (!room) throw new Error('the room was never created');
    const host = openClient(hostSession, 'TEAM', hostSession.you, hostSession.you);

    const guestSession = createOnlineSession({
      url: harness.url,
      room: 'TEAM',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(guestSession);
    await until('both seats to be filled', () => room.humanCount === 2);
    const guest = openClient(guestSession, 'TEAM', guestSession.you, hostSession.you);

    // The host flips TEAMS and puts the two humans on ONE side, the two bot seats
    // on the other — a 2v2 with the humans allied, which is the shape the report
    // was played in.
    host.apply((s) => toggleMode(s));
    await until('the room to advertise TEAMS', () => room.mode === 'teams');

    const sideOf = (player: number): number => host.lobby().seats[player]!.team;
    const wanted = [0, 0, 1, 1];
    for (let player = 0; player < 4; player++) {
      for (let guard = 0; guard < 8 && sideOf(player) !== wanted[player]; guard++) {
        host.apply((s) => cycleSeatTeam(s, player));
      }
      expect(sideOf(player)).toBe(wanted[player]);
    }

    // Both rosters agree, because the sides came back down the authoritative
    // `lobbyState` rather than being each screen's private opinion.
    await until('the guest roster to show the split', () =>
      lobbyModel(guest.lobby()).seats.slice(0, 4).map((s) => s.team).join() === wanted.join(),
    );
    // …and both name the sides in the WORDS that roster's own viewer reads (u3).
    // The GUEST is on side A, so A is `FRIENDLY` and B is `ENEMY` on their screen;
    // the letter is absolute, so both screens agree on which side is which.
    expect(lobbyModel(guest.lobby()).seats.slice(0, 4).map((s) => s.teamName)).toEqual([
      'FRIENDLY A',
      'FRIENDLY A',
      'ENEMY B',
      'ENEMY B',
    ]);

    runCountdown(host);
    await until('both clients to have a world', () => hostSession.world !== null && guestSession.world !== null);

    // Authority, and both PREDICTED worlds, group allies identically. A client that
    // guessed here would reconcile against a different match forever.
    expect(room.world!.ships.map((s) => s.team)).toEqual(wanted);
    expect(hostSession.world!.ships.map((s) => s.team)).toEqual(wanted);
    expect(guestSession.world!.ships.map((s) => s.team)).toEqual(wanted);

    // And the one question the whole sim asks comes back the same on both ends.
    for (const world of [room.world!, hostSession.world!, guestSession.world!]) {
      expect(areEnemies(world, 0, 1)).toBe(false);
      expect(areEnemies(world, 2, 3)).toBe(false);
      expect(areEnemies(world, 0, 2)).toBe(true);
      expect(canDamage(world, 0, 1)).toBe(false);
    }
  }, 30_000);
});

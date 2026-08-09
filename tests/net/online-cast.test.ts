/**
 * tests/net/online-cast.test.ts — the developer's case, on the ONLINE path: a host
 * picks a cast in the lobby, and the match that starts is flown by **those
 * characters**. OWNER: Netcode Engineer (a0-06b; GDD §2.1 *amended 2026-08-07*,
 * §2.9).
 *
 * WHY THIS FILE AND NOT ONLY THE ROOM-LEVEL ONE
 * ---------------------------------------------------------------------------
 * `tests/server/room-cast.test.ts` proves the room seats what the wire says. It
 * hand-builds the wire, so it cannot prove the thing this brief is actually
 * about: that the **client** puts the host's pick on that wire at all. The gap
 * a0-06 left was exactly a field nobody filled — the lobby had resolved a
 * character per seat since it shipped, and nothing carried it across the socket.
 *
 * So everything below runs over a real socket, against the real `MatchServer`,
 * with the REAL lobby model (`src/ui/lobby`) driven the way `src/main.ts`
 * `sendChoice` drives it — transcribed rather than imported, because `openLobby`
 * is a Pixi/DOM function and what is shared is the decisions, not the pixels.
 *
 * **The assertions are on NAMES.** Every one of these cases passed before a0-06b
 * if you asserted on tiers, because the tier always arrived; it was the character
 * that did not. Three characters share the Hard tier, so "a Hard bot is here" and
 * "Sable is here" are different claims and only the second one is the ratified
 * design.
 *
 * It also writes the readback the PR carries as evidence — the lobby's cast and
 * the match's, side by side, from one run of the real stack.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { Difficulty, PERSONALITIES, ROSTER, rosterAt } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import {
  applyLobbySlots,
  botDifficulties,
  createLobby,
  cycleSeatCharacter,
  cycleSeatState,
  lobbyWireSeats,
  lobbyWireTeams,
  pressRush,
  startLobbyMatch,
  tickLobby,
} from '../../src/ui/lobby';
import type { LobbyState } from '../../src/ui/lobby';
import type { MatchStartSlot } from '../../src/net/transport';
import { netBudget } from './budgets';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

const EVIDENCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../evidence/a0-06b-online-cast');

/** One browser client: a real session plus the lobby it drives. */
interface Client {
  readonly session: OnlineSession;
  lobby(): LobbyState;
  apply(next: (state: LobbyState) => LobbyState): void;
  /** The roster `matchStart` ended the lobby with — authority's own, per recipient. */
  matchRoster(): readonly MatchStartSlot[] | null;
}

/**
 * `main.ts` `sendChoice`, transcribed — including the row this brief adds.
 *
 * `botPersonalities` is derived with the SAME filter as `botDifficulties`, and
 * that is load-bearing rather than tidy: `seat.personality` is the seat's
 * character gated by the same `isBotSeat` the tier list filters on, so the two
 * rows are the same length in the same order by construction. A test that built
 * the cast some other way would be testing its own alignment, not the client's.
 */
function openClient(session: OnlineSession, room: string, you: PlayerId, host: PlayerId): Client {
  let state = createLobby({ room, you, host, online: true });
  let roster: readonly MatchStartSlot[] | null = null;

  const send = (): void => {
    const isHost = state.you === state.host;
    session.chooseInLobby({
      shipClass: state.shipClass,
      ...(isHost
        ? {
            botDifficulties: botDifficulties(state),
            botPersonalities: state.seats
              .map((s) => s.personality)
              .filter((p): p is PersonalityId => p !== null),
          }
        : {}),
      ...(isHost
        ? { mode: state.mode, teams: lobbyWireTeams(state), seats: lobbyWireSeats(state) }
        : {}),
    });
  };

  session.observe((message) => {
    if (message.type === 'lobbyState') {
      state = applyLobbySlots(state, message.slots);
    } else if (message.type === 'matchStart') {
      roster = message.slots;
      state = startLobbyMatch(state);
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
    matchRoster: () => roster,
  };
}

/** Run the RUSH! countdown the way the render ticker does, and send `startMatch`
 *  on the ONE frame it reaches zero (`src/ui/lobby-flow` rule 2). */
function runCountdown(client: Client): void {
  let state = pressRush(client.lobby());
  expect(state.phase, 'RUSH! starts a countdown').toBe('counting');
  for (let i = 0; i < 120 && state.phase === 'counting'; i++) state = tickLobby(state, 0.1);
  expect(state.phase, 'the countdown reaches zero').toBe('started');
  client.session.startMatch();
}

/**
 * Tap a seat's row until it shows `target` — the lobby offers a cycle and no
 * setter, so this is how a host actually authors a named cast (a0-06
 * `cycleSeatCharacter`). Bounded by the roster's own length, so a character that
 * cannot be reached fails the expectation rather than spinning.
 */
function setSeatCharacter(client: Client, seat: number, target: PersonalityId): void {
  for (let tap = 0; tap <= ROSTER.length; tap++) {
    if (client.lobby().seats[seat]?.personality === target) return;
    client.apply((s) => cycleSeatCharacter(s, seat));
  }
  expect(client.lobby().seats[seat]?.personality, `seat ${seat} reaches ${target}`).toBe(target);
}

/** The cast a lobby has authored, in the bot-seat order the wire uses. */
function lobbyCast(state: LobbyState): PersonalityId[] {
  return state.seats.map((s) => s.personality).filter((p): p is PersonalityId => p !== null);
}

/** The cast a `matchStart` roster names, in the same order. */
function rosterCast(roster: readonly MatchStartSlot[]): PersonalityId[] {
  return roster.map((s) => s.personality).filter((p): p is PersonalityId => p !== undefined);
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('an online room seats the characters the host picked (a0-06b)', () => {
  it('carries the host CAST across the socket, and the match roster names those characters', async () => {
    const harness = await startMatchServer({ seed: 4242, slots: 8, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'CAST',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    await until('the host to be seated', () => harness.matches.room('CAST') !== undefined);
    const room = harness.matches.room('CAST');
    if (!room) throw new Error('the room was never created');

    const host = openClient(hostSession, 'CAST', hostSession.you, hostSession.you);
    expect(room.world, 'CREATE ROOM opens a lobby, not a match').toBeNull();

    // --- The host authors a cast ------------------------------------------
    // Seven bot seats behind the host's own chair, then a character picked on
    // each — through `cycleSeatCharacter`, the same tap the lobby row makes, so
    // the cast under test is one the screen can actually produce.
    //
    // **The cast is deliberately all-HARD with repeats in it**, because that is
    // the case where the tier row is provably not enough: three characters share
    // the Hard tier, so `['hard'×7]` names 3⁷ different casts and the room used to
    // pick one of them by index. Three Wardens is also the developer's own
    // balanced 4v4, which needs a fourth Hard character that does not exist.
    const CAST: readonly PersonalityId[] = [
      'warden',
      'warden',
      'sable',
      'vulture',
      'warden',
      'sable',
      'vulture',
    ];
    for (let seat = 1; seat < 8; seat++) host.apply((s) => cycleSeatState(s, seat));
    for (let seat = 1; seat < 8; seat++) setSeatCharacter(host, seat, CAST[seat - 1]!);

    const wanted = lobbyCast(host.lobby());
    expect(wanted, 'seven bot seats, seven characters').toEqual(CAST);
    expect(wanted).not.toEqual(ROSTER.slice(0, 7)); // not the default cast
    // Every seat says HARD, so the tier row cannot tell these seven apart — which
    // is the whole reason the character row has to exist.
    expect(new Set(botDifficulties(host.lobby()))).toEqual(new Set(['hard']));

    // The server has heard the whole authoring — read authority's own roster, not
    // a client's copy of it, and wait on it rather than sleeping.
    await until(
      'the room to hold seven BOT seats',
      () => room.lobbyState().filter((s) => s.state === 'bot').length === 7,
      5_000,
    );

    // --- RUSH! -------------------------------------------------------------
    runCountdown(host);
    await until('the match to start', () => room.world !== null, 5_000);
    await until('the host to receive its matchStart roster', () => host.matchRoster() !== null, 5_000);

    // --- The proof ---------------------------------------------------------
    // 1. Authority seated exactly those characters.
    const seated = room
      .lobbyState()
      .filter((s) => s.isBot)
      .map((s) => s.botPersonality);
    expect(seated).toEqual(wanted);

    // 2. …and the roster that ENDED the lobby names the same ones, so the match
    //    the client draws is the match the lobby previewed.
    const roster = host.matchRoster()!;
    expect(rosterCast(roster)).toEqual(wanted);

    // 3. The tier is shown and is the seated character's own — derived, never a
    //    second opinion that could disagree with the name beside it.
    for (const slot of room.lobbyState().filter((s) => s.isBot)) {
      expect(slot.botDifficulty).toBe(PERSONALITIES[slot.botPersonality!].difficulty);
    }

    // 4. …and each bot flies its character's hull (GDD §2.11).
    for (const slot of roster) {
      if (!slot.personality) continue;
      expect(slot.shipClass).toBe(PERSONALITIES[slot.personality].shipClass);
    }

    // --- The readback the PR carries --------------------------------------
    const readback = {
      brief: 'a0-06b',
      what: 'an online room seats the characters the host picked, not just their tiers',
      seed: 4242,
      lobbyCast: wanted,
      seatedCast: seated,
      matchStartCast: rosterCast(roster),
      tiers: room
        .lobbyState()
        .filter((s) => s.isBot)
        .map((s) => s.botDifficulty),
      hulls: roster.filter((s) => s.personality).map((s) => s.shipClass),
      // How many seats each character holds — the duplicate claim, counted rather
      // than described. Three Wardens is the developer's balanced 4v4 of Hard bots,
      // which needs a fourth Hard character that does not exist (GDD §2.9).
      seatsPerCharacter: Object.fromEntries(
        [...new Set(wanted)].map((id) => [id, wanted.filter((x) => x === id).length]),
      ),
      identical:
        JSON.stringify(wanted) === JSON.stringify(seated) &&
        JSON.stringify(wanted) === JSON.stringify(rosterCast(roster)),
      // What this same lobby got before a0-06b, computed rather than described:
      // the tier row survived the hop and the character row did not exist, so the
      // room re-derived a Hard character by index. Same tiers, different cast.
      preA0_06bWouldHaveSeated: wanted.map(
        (_, i) => rosterAt(Difficulty.Hard)[i % rosterAt(Difficulty.Hard).length],
      ),
    };
    expect(readback.identical).toBe(true);
    // The readback earns its place only if the two lists differ — otherwise it is
    // a picture of a fix that changed nothing.
    expect(readback.preA0_06bWouldHaveSeated).not.toEqual(wanted);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(`${EVIDENCE_DIR}/readback.json`, `${JSON.stringify(readback, null, 2)}\n`);
  }, netBudget({
    work: 'boot an 8-seat server → host CREATE ROOM → seven seats to BOT → a named all-Hard cast tapped onto each → RUSH! → assert the seated cast and the matchStart roster by NAME → write the readback',
    measuredSeconds: 0.2,
  }));

  it('seats two Wardens when the host picked two Wardens, over a real socket', async () => {
    const harness = await startMatchServer({ seed: 99, slots: 8, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const hostSession = createOnlineSession({
      url: harness.url,
      room: 'TWIN',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(hostSession);
    await until('the host to be seated', () => harness.matches.room('TWIN') !== undefined);
    const room = harness.matches.room('TWIN')!;
    const host = openClient(hostSession, 'TWIN', hostSession.you, hostSession.you);

    // Two bot seats, both cycled onto the SAME character. 8 slots, 7 characters
    // and three of them Hard, so the developer's balanced 4v4 of Hard bots is
    // impossible without a repeat — the wire has to carry one (a0-06).
    for (const seat of [1, 2]) host.apply((s) => cycleSeatState(s, seat));
    const target: PersonalityId = 'warden';
    for (const seat of [1, 2]) {
      for (let tap = 0; tap < ROSTER.length; tap++) {
        if (host.lobby().seats[seat]?.personality === target) break;
        host.apply((s) => cycleSeatCharacter(s, seat));
      }
    }
    expect(lobbyCast(host.lobby())).toEqual(['warden', 'warden']);

    await until(
      'the room to hold two BOT seats',
      () => room.lobbyState().filter((s) => s.state === 'bot').length === 2,
      5_000,
    );
    runCountdown(host);
    await until('the match to start', () => room.world !== null, 5_000);
    await until('the host to receive its matchStart roster', () => host.matchRoster() !== null, 5_000);

    const seated = room
      .lobbyState()
      .filter((s) => s.isBot)
      .map((s) => s.botPersonality);
    expect(seated).toEqual(['warden', 'warden']);
    expect(rosterCast(host.matchRoster()!)).toEqual(['warden', 'warden']);
    // Two SEATS holding it — a collapse would have left one bot and a short world.
    expect(room.world?.ships).toHaveLength(3); // the host plus two Wardens
  }, netBudget({
    work: 'boot a server → host CREATE ROOM → two seats to BOT → both tapped onto Warden → RUSH! → assert two Wardens in two distinct seats, in the room and in the matchStart roster',
    measuredSeconds: 0.15,
  }));
});

/**
 * src/ui/lobby-flow.test.ts — the seam, driven end to end with no server.
 *
 * `./lobby.test.ts` proves the room's rules and `./lobby-entry.test.ts` proves
 * the door's. Neither can catch the failure M2 was retracted for, because that
 * failure was not in a model — it was in the *order the models are called in*,
 * which lived in a comment.
 *
 * So these tests do the thing a comment cannot: they play the whole front of a
 * match. A tap on SOLO, a welcome, a hull, a difficulty, RUSH!, five seconds,
 * `matchStart` — and they assert both halves of every step, the state the
 * player sees AND the bytes the server is owed. A wiring that drifts out of
 * order now fails here instead of in a playtest.
 */

import { describe, it, expect } from 'vitest';
import { mulberry32, ShipClass } from '@shared/types';
import { FireMode } from '@platform/actions';
import type { ClientMessage, LobbySlot } from '../net/transport';
import {
  createFlow,
  flowCloseSettings,
  flowConnected,
  flowEliminated,
  flowFailed,
  flowKey,
  flowLobbySlots,
  flowMatchEnded,
  flowMatchStart,
  flowOpenSettings,
  flowTapEnd,
  flowTapEntry,
  flowTapLobby,
  flowTapSettings,
  resetFlow,
  setFlowFireMode,
  tickFlow,
  wireFireMode,
} from './lobby-flow';
import type { FlowEffect, FlowResult, FlowState } from './lobby-flow';
import { DOOR_ORDER, ENTRY_COMING_SOON, ENTRY_ERRORS, KEYPAD_KEYS } from './lobby-entry';
import {
  CLASS_ORDER,
  DEFAULT_SHIP_CLASS,
  MODE_LABELS,
  RUSH_COUNTDOWN_SECONDS,
  SEAT_STATE_CYCLE,
  lobbyModel,
} from './lobby';
import type { SeatOccupant } from './lobby';
import { lobbyHitTest, lobbyLayout } from './lobby-geometry';
import type { LobbyLayout, LobbyTarget } from './lobby-geometry';
import type { MatchMode } from '../sim/match-config';
import type { Rect } from '@platform/layout-registry';
import { endOfMatchModel } from './end-of-match';
import { createSettings, volumeLevel } from './settings';

// ---------------------------------------------------------------------------
// Helpers — a flow is driven the way main.ts will drive it: state in, effects
// drained, state kept.
// ---------------------------------------------------------------------------

/** The index of a door in the order the view draws it — the same lookup the
 *  hit-test does, so a test can tap by name. */
function doorIndex(door: 'campaign' | 'solo' | 'create' | 'join'): number {
  return DOOR_ORDER.indexOf(door);
}

function keyIndex(ch: string): number {
  return KEYPAD_KEYS.indexOf(ch);
}

/** Every `send` effect's message, in order. `open-transport` is dropped — the
 *  tests that care about it assert it by kind. */
function sent(result: FlowResult): ClientMessage[] {
  return result.effects.filter((e) => e.kind === 'send').map((e) => (e as { message: ClientMessage }).message);
}

function kinds(result: FlowResult): FlowEffect['kind'][] {
  return result.effects.map((e) => e.kind);
}

/** A flow already in a lobby: SOLO tapped, welcomed into seat 0 as host. This
 *  is the offline path, and it is the path that has to work with no network at
 *  all (GDD §4.8 risk 6). */
function inLobby(you = 0, host = you): FlowState {
  const rng = mulberry32(7);
  const opened = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('solo') }, rng);
  return flowConnected(opened.state, you, { host }).state;
}

/**
 * A flow already in a lobby, entered through a NAMED door — the whole point of the
 * ratified play flow is that all three doors land in the same room, so a guard that
 * only ever walks in through SOLO is only testing a third of it.
 */
function inLobbyVia(door: 'solo' | 'create' | 'join', you = 0, host = you): FlowState {
  const rng = mulberry32(7);
  let state = createFlow();
  if (door === 'join') {
    state = flowTapEntry(state, { kind: 'door', index: doorIndex('join') }, rng).state;
    for (const ch of 'K7QM') state = flowTapEntry(state, { kind: 'key', index: keyIndex(ch) }, rng).state;
    state = flowTapEntry(state, { kind: 'submit' }, rng).state;
  } else {
    state = flowTapEntry(state, { kind: 'door', index: doorIndex(door) }, rng).state;
  }
  return flowConnected(state, you, { host }).state;
}

/** A `lobbyState` broadcast: `count` seats, with `humans` of them seated. */
function slots(count: number, humans: number[]): LobbySlot[] {
  return Array.from({ length: count }, (_, player) => ({
    player,
    isBot: false,
    shipClass: DEFAULT_SHIP_CLASS,
    ready: humans.includes(player),
  }));
}

// ---------------------------------------------------------------------------

describe('the CAMPAIGN teaser resolves into nothing at all (u9-01)', () => {
  it('opens no transport, sends nothing, and leaves the flow on the doors', () => {
    // The whole point, at the seam that owns the transport: a door with no intent
    // produces no effect, so the campaign teaser CANNOT reach the network — not
    // by a stray branch in `main.ts`, and not by a future edit to this flow.
    const before = createFlow();
    const after = flowTapEntry(before, { kind: 'door', index: doorIndex('campaign') }, mulberry32(7));

    expect(kinds(after)).toEqual([]);
    expect(after.state.screen).toBe('entry');
    expect(after.state.entry.screen).toBe('home');
    expect(after.state.lobby).toBeNull();
    expect(after.state.room).toBeNull(); // no code was minted for it
    expect(after.state.entry.notice).toBe(ENTRY_COMING_SOON);
  });

  it('does not strand the player — SOLO still opens the lobby right after it', () => {
    const rng = mulberry32(7);
    let state = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('campaign') }, rng).state;
    const opened = flowTapEntry(state, { kind: 'door', index: doorIndex('solo') }, rng);
    expect(kinds(opened)).toEqual(['open-transport']);
    expect(opened.state.entry.notice).toBe('');
    state = flowConnected(opened.state, 0).state;
    expect(state.screen).toBe('lobby');
  });
});

describe('the door resolves into a room (rule 1 — one room code, end to end)', () => {
  it('opens a transport on SOLO and puts the same code on the lobby', () => {
    const rng = mulberry32(7);
    const opened = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('solo') }, rng);

    expect(kinds(opened)).toEqual(['open-transport']);
    const intent = (opened.effects[0] as { intent: { room: string; online: boolean } }).intent;
    expect(intent.online).toBe(false); // solo needs no server
    expect(opened.state.room).toBe(intent.room);

    const lobby = flowConnected(opened.state, 0);
    expect(lobby.state.screen).toBe('lobby');
    expect(lobby.state.lobby?.room).toBe(intent.room);
  });

  it('carries a TYPED code through the join, unchanged', () => {
    const rng = mulberry32(1);
    let state = createFlow();
    state = flowTapEntry(state, { kind: 'door', index: doorIndex('join') }, rng).state;
    for (const ch of 'K7QM') {
      state = flowTapEntry(state, { kind: 'key', index: keyIndex(ch) }, rng).state;
    }
    const submitted = flowTapEntry(state, { kind: 'submit' }, rng);

    const intent = (submitted.effects[0] as { intent: { room: string; online: boolean } }).intent;
    expect(intent.room).toBe('K7QM');
    expect(intent.online).toBe(true);
    expect(flowConnected(submitted.state, 3).state.lobby?.room).toBe('K7QM');
  });

  it('lets the SERVER win on room identity when its welcome names one', () => {
    const rng = mulberry32(2);
    const opened = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('create') }, rng);
    const lobby = flowConnected(opened.state, 0, { room: 'ZZ99' });
    expect(lobby.state.lobby?.room).toBe('ZZ99');
    expect(lobby.state.room).toBe('ZZ99');
  });

  it('never mints a code twice — the door mints, the lobby reads', () => {
    const rng = mulberry32(9);
    const opened = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('create') }, rng);
    const first = flowConnected(opened.state, 0).state.lobby?.room;
    // Re-welcoming the same flow (a reconnect) must land on the same room.
    const again = flowConnected(opened.state, 0).state.lobby?.room;
    expect(first).toBe(again);
  });

  it('takes a desktop keypress by the same rule as a keypad tap', () => {
    const rng = mulberry32(3);
    let state = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('join') }, rng).state;
    for (const ch of 'k7qm') state = flowKey(state, ch).state; // lower case, as typed
    expect(state.entry.code).toBe('K7QM');
    expect(sent(flowKey(state, 'Enter'))).toEqual([]); // a join is a transport, not a message
    expect(kinds(flowKey(state, 'Enter'))).toEqual(['open-transport']);
  });

  it('comes back to the door on a refusal, with the code kept', () => {
    const rng = mulberry32(4);
    let state = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('join') }, rng).state;
    for (const ch of 'K7QM') state = flowTapEntry(state, { kind: 'key', index: keyIndex(ch) }, rng).state;
    state = flowTapEntry(state, { kind: 'submit' }, rng).state;

    const failed = flowFailed(state, ENTRY_ERRORS.full);
    expect(failed.state.screen).toBe('entry');
    expect(failed.state.entry.code).toBe('K7QM');
    expect(failed.state.entry.error).toBe(ENTRY_ERRORS.full);
    expect(failed.effects).toEqual([]);
  });

  it('ignores a lobby tap that arrives before there is a lobby', () => {
    const state = createFlow();
    expect(flowTapLobby(state, { kind: 'rush' }).state).toBe(state);
    expect(tickFlow(state, 1).state).toBe(state);
  });

  it('ignores an entry tap that arrives after the lobby has the screen', () => {
    const rng = mulberry32(5);
    const state = inLobby();
    expect(flowTapEntry(state, { kind: 'door', index: doorIndex('create') }, rng).state).toBe(state);
    expect(flowKey(state, 'A').state).toBe(state);
  });
});

describe('the room tells the server what it chose', () => {
  it('sends the pre-selected Vanguard the moment the lobby opens (GDD §2.11)', () => {
    const rng = mulberry32(7);
    const opened = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('solo') }, rng);
    const messages = sent(flowConnected(opened.state, 0));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'lobbyChoice', shipClass: DEFAULT_SHIP_CLASS });
  });

  it('sends the hull a tile tap picked, and the tile the model records', () => {
    const state = inLobby();
    const picked = flowTapLobby(state, { kind: 'class', index: CLASS_ORDER.indexOf(ShipClass.Excavator) });

    expect(picked.state.lobby?.shipClass).toBe(ShipClass.Excavator);
    expect(sent(picked)[0]).toMatchObject({ type: 'lobbyChoice', shipClass: ShipClass.Excavator });
  });

  it('carries the fire mode settings set, without a message of its own', () => {
    const state = setFlowFireMode(inLobby(), FireMode.AutoAim);
    const picked = flowTapLobby(state, { kind: 'class', index: CLASS_ORDER.indexOf(ShipClass.Hauler) });
    // …spelled the WIRE's way: transport.ts says 'auto' where the action layer
    // says 'auto-aim', and sending the action layer's spelling would have the
    // server drop every touch player's fire mode. See wireFireMode().
    expect(sent(picked)[0]).toMatchObject({ fireMode: 'auto' });
    expect(FireMode.AutoAim).not.toBe('auto'); // the divergence this guards
  });

  it('translates both fire modes to the spelling transport.ts declares', () => {
    expect(wireFireMode(FireMode.Manual)).toBe('manual');
    expect(wireFireMode(FireMode.AutoAim)).toBe('auto');
  });

  it('sends the host’s difficulties in EMPTY-SEAT order, and only from the host', () => {
    // The row BODY cycles the seat's CHARACTER (a0-06); the tier that rides the
    // wire is read off it, so a character tap is what re-sends the list.
    const host = flowTapLobby(inLobby(0, 0), { kind: 'seat', index: 3 });
    const message = sent(host)[0] as { botDifficulties?: readonly string[] };
    expect(message.botDifficulties).toHaveLength(7); // seven empty seats of eight

    // A guest's choice message carries no difficulties at all — the server
    // ignores them from a guest, so putting them on the wire would be noise.
    const guest = flowTapLobby(inLobby(4, 0), { kind: 'class', index: 0 });
    expect(sent(guest)[0]).not.toHaveProperty('botDifficulties');
  });

  it('costs the wire NOTHING for a refused tap', () => {
    // A guest cycling a seat, and a guest pressing RUSH!: both no-ops in
    // ./lobby, and a no-op there must not become a message here.
    const guest = inLobby(4, 0);
    const cycled = flowTapLobby(guest, { kind: 'seat', index: 2 });
    expect(cycled.effects).toEqual([]);
    expect(cycled.state).toBe(guest);

    // …and re-picking the hull already selected.
    const same = flowTapLobby(inLobby(), { kind: 'class', index: CLASS_ORDER.indexOf(DEFAULT_SHIP_CLASS) });
    expect(same.effects).toEqual([]);
  });

  it('treats the room code as a label, not a control', () => {
    const state = inLobby();
    const tapped = flowTapLobby(state, { kind: 'roomCode' });
    expect(tapped.state).toBe(state);
    expect(tapped.effects).toEqual([]);
  });

  it('routes the variable-match controls (mode, abundance, seat state, team)', () => {
    // MODE toggle: FFA ⇄ TEAMS.
    const teams = flowTapLobby(inLobby(0, 0), { kind: 'mode' });
    expect(teams.state.lobby?.mode).toBe('teams');
    expect(flowTapLobby(teams.state, { kind: 'mode' }).state.lobby?.mode).toBe('ffa');

    // ABUNDANCE toggle: SCARCE → STANDARD.
    const richer = flowTapLobby(inLobby(0, 0), { kind: 'abundance' });
    expect(richer.state.lobby?.abundance).toBe('standard');

    // Seat state: the LEADING state control walks the ring OPEN → BOT → CLOSED.
    // It is the only control that does since a0-06 — the row body moved to the
    // character cycle, because that is where the row draws the name. Which rung a
    // seat *starts* on is the flavour's business since a0-11 (an online room opens
    // its seats OPEN, the solo lobby on the bot cast), so nothing below names one.
    let viaControl = inLobby(0, 0);
    for (let i = 0; i < SEAT_STATE_CYCLE.length; i++) {
      const before = viaControl.lobby?.seats[5]?.occupant;
      viaControl = flowTapLobby(viaControl, { kind: 'seatState', index: 5 }).state;
      expect(
        viaControl.lobby?.seats[5]?.occupant,
        `tap ${i + 1}: the state control did not move`,
      ).not.toBe(before);
    }
    // One full lap of the ring puts the seat back where it started — whichever
    // rung that was, which is the part a0-11 made flavour-dependent.
    expect(viaControl.lobby?.seats[5]?.occupant).toBe(inLobby(0, 0).lobby?.seats[5]?.occupant);

    // A CLOSED row's body still re-opens the seat — one rule, stated once: the body
    // edits whatever the row is SHOWING, and a closed row shows no character.
    const closed = flowTapLobby(
      flowTapLobby(inLobby(0, 0), { kind: 'seatState', index: 5 }).state,
      { kind: 'seatState', index: 5 },
    ).state;
    expect(closed.lobby?.seats[5]?.occupant).toBe('closed');
    expect(flowTapLobby(closed, { kind: 'seat', index: 5 }).state.lobby?.seats[5]?.occupant).toBe('open');

    // The row BODY cycles the seat's CHARACTER in BOTH modes (a0-06) — one
    // control per seat, so there is no tier left to disagree with the cast.
    const recast = flowTapLobby(teams.state, { kind: 'seat', index: 2 });
    expect(recast.state.lobby?.seats[2]?.character).not.toBe(teams.state.lobby?.seats[2]?.character);
    // …and it changed the character WITHOUT touching the side.
    expect(recast.state.lobby?.seats[2]?.team).toBe(teams.state.lobby?.seats[2]?.team);

    // The TEAM chip, composed alongside it, assigns the seat's side (TEAMS).
    const assigned = flowTapLobby(teams.state, { kind: 'seatTeamChip', index: 2 });
    expect(assigned.state.lobby?.seats[2]?.team).not.toBe(teams.state.lobby?.seats[2]?.team);
    // …and it changed the side WITHOUT touching the character.
    expect(assigned.state.lobby?.seats[2]?.character).toBe(teams.state.lobby?.seats[2]?.character);
  });

  it('refuses every variable-match control from a guest', () => {
    const guest = inLobby(4, 0);
    for (const target of [
      { kind: 'mode' } as const,
      { kind: 'abundance' } as const,
      { kind: 'seat', index: 2 } as const,
      { kind: 'seatState', index: 2 } as const,
      { kind: 'seatTeamChip', index: 2 } as const,
    ]) {
      const tapped = flowTapLobby(guest, target);
      expect(tapped.state, `${target.kind} from a guest`).toBe(guest);
      expect(tapped.effects).toEqual([]);
    }
  });

  it('does not answer a lobbyState broadcast — an echo that replied would loop', () => {
    const state = inLobby();
    const folded = flowLobbySlots(state, slots(8, [0, 5]));
    expect(folded.effects).toEqual([]);
    expect(lobbyModel(folded.state.lobby!).humanCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ONE DOOR, ONE LOBBY (ratified — the unified play flow)
//
// PLAY opens the doors; the doors open the lobby. All three doors land in the SAME
// component, and the only thing that differs is the `online` flag the door already
// resolved. These tests hold that shape: the flavours are a flag, not a screen.
// ---------------------------------------------------------------------------

describe('one door, one lobby (ratified: PLAY opens the doors, the doors open the room)', () => {
  it('opens the SOLO lobby offline — no room code, the empty seats are the cast', () => {
    const state = inLobbyVia('solo');
    expect(state.screen).toBe('lobby');
    expect(state.online).toBe(false);
    // The lobby the SOLO door opened knows it is offline, so the view draws no room
    // code and no OPEN markers: there is no transport for a joiner to arrive on.
    expect(lobbyModel(state.lobby!).online).toBe(false);
    expect(lobbyModel(state.lobby!).seats.some((s) => s.openToJoin)).toBe(false);
  });

  it('opens the SAME lobby online for CREATE and JOIN — code up, seats claimable', () => {
    for (const door of ['create', 'join'] as const) {
      const state = inLobbyVia(door);
      expect(state.screen, door).toBe('lobby');
      expect(state.online, door).toBe(true);
      const model = lobbyModel(state.lobby!);
      expect(model.online, door).toBe(true);
      expect(model.room, door).toBe(state.lobby!.room);
      expect(model.seats.some((s) => s.openToJoin), door).toBe(true);
    }
  });

  it('fills the room’s HUMAN-open seats live, as joiners arrive', () => {
    // The host is watching the roster while people type the code in: a `lobbyState`
    // broadcast is the only thing that seats them, and it must land on the same
    // lobby the host is configuring rather than a second screen.
    let state = inLobbyVia('create', 0, 0);
    expect(lobbyModel(state.lobby!).humanCount).toBe(1);
    state = flowLobbySlots(state, slots(8, [0, 1])).state;
    expect(lobbyModel(state.lobby!).humanCount).toBe(2);
    expect(state.lobby?.seats[1]?.occupant).toBe('human');
    state = flowLobbySlots(state, slots(8, [0, 1, 4])).state;
    expect(lobbyModel(state.lobby!).humanCount).toBe(3);
  });

  it('shows a JOINER their own name in their own seat', () => {
    // Requirement 3: a joiner sees the slots fill AND their own name in their slot.
    const guest = inLobbyVia('join', 3, 0);
    const model = lobbyModel(guest.lobby!);
    expect(model.seats[3]?.isYou).toBe(true);
    expect(model.seats[3]?.name).toBe(guest.lobby?.name);
    expect(model.seats[3]?.state).toBe('human');
    // …and the host's seat is marked as the host, so "waiting for the host" names
    // somebody the roster actually shows.
    expect(model.seats[0]?.isHost).toBe(true);
  });

  it('gives a JOINER the map and the mode READ-ONLY', () => {
    // The host owns the board and the mode for the whole room; a guest reads them.
    const guest = inLobbyVia('join', 3, 0);
    const before = lobbyModel(guest.lobby!);
    for (const target of [{ kind: 'map', index: 2 } as const, { kind: 'mode' } as const]) {
      const tapped = flowTapLobby(guest, target);
      expect(tapped.state, `${target.kind} from a joiner`).toBe(guest);
      expect(tapped.effects).toEqual([]);
    }
    expect(lobbyModel(guest.lobby!).mapId).toBe(before.mapId);
    // …and the host of that same online room CAN change both — read-only is the
    // guest's condition, not the online lobby's.
    const host = inLobbyVia('create', 0, 0);
    expect(flowTapLobby(host, { kind: 'map', index: 2 }).state.lobby?.mapId).not.toBe(
      host.lobby?.mapId,
    );
    expect(flowTapLobby(host, { kind: 'mode' }).state.lobby?.mode).toBe('teams');
  });

  it('closes the transport when BACK leaves an ONLINE room, and nothing offline', () => {
    // u2 item 4 — no ghost rooms. BACK out of a room frees the seat; BACK out of a
    // solo lobby has no socket to close, so it asks for nothing.
    const online = flowTapLobby(inLobbyVia('create', 0, 0), { kind: 'leave' });
    expect(online.state.screen).toBe('entry');
    expect(online.state.lobby).toBeNull();
    expect(kinds(online)).toEqual(['close-transport']);

    const offline = flowTapLobby(inLobbyVia('solo'), { kind: 'leave' });
    expect(offline.state.screen).toBe('entry');
    expect(offline.state.lobby).toBeNull();
    expect(offline.effects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The slot-editor CLASS GUARD (n2 — the radar-wedge lesson), now extended over
// the ONLINE lobby as well (ratified: "no feature may exist in one mode's lobby
// and not the other unless ratified by name — the n2-01 affordance-set test
// extends to cover the online lobby").
//
// A bot slot's editor — open/close, bot-assign, bot-DIFFICULTY, and team-assign
// where applicable — must be REACHABLE in every mode AND in both lobby flavours,
// driven through the same hit-test the view uses (a control that isn't laid out
// isn't reachable). The TEAMS lobby had silently dropped bot-difficulty when the
// side control took the row's only chip; the online room had no slot editor at all,
// because it had no lobby. This asserts the whole set, exhaustively over the modes
// and the flavours, so a new mode or a new flavour has to satisfy it or name a
// ratified exclusion.
// ---------------------------------------------------------------------------

/** A roomy desktop viewport — every row chip has extent here, so "reachable"
 *  means "laid out", not "laid out big enough on this phone". */
/**
 * The next rung of the seat-state ring after `occupant` ({@link SEAT_STATE_CYCLE}).
 *
 * Since a0-11 the rung a seat *starts* on depends on the flavour of the lobby —
 * an online room opens its seats OPEN and waits for people, the solo lobby opens
 * them on the bot cast — so a test about the slot editor's ROUTING must assert
 * that a tap moved the seat one rung, not that it landed on a particular word.
 */
function nextRung(occupant: SeatOccupant): SeatOccupant {
  const at = SEAT_STATE_CYCLE.indexOf(occupant);
  return SEAT_STATE_CYCLE[(at + 1) % SEAT_STATE_CYCLE.length]!;
}

const GUARD_VIEWPORT = { width: 1280, height: 800 };

/** The target a tap at a rect's centre resolves to, through the SAME hit-test the
 *  view drives — so an affordance the geometry never laid out reads as unreachable
 *  (null / the wrong target) rather than as passing. */
function tapCentre(layout: LobbyLayout, rect: Rect): LobbyTarget | null {
  return lobbyHitTest(layout, rect.x + rect.width / 2, rect.y + rect.height / 2);
}

describe('the slot editor is reachable in EVERY mode AND both lobbies (guard the class)', () => {
  // Exhaustive over the ratified modes: a new mode added to MODE_LABELS lands here
  // automatically and must reach the shared affordances or be given an exclusion.
  const MODES = Object.keys(MODE_LABELS) as MatchMode[];
  // …and over the two ways a lobby is opened. `solo` is the offline room, `create`
  // the online one; the ratified rule is that the affordance SET is identical, so
  // the same loop body has to pass for both.
  const FLAVOURS: readonly { readonly name: string; readonly door: 'solo' | 'create' }[] = [
    { name: 'the SOLO lobby (offline)', door: 'solo' },
    { name: 'the ROOM lobby (online)', door: 'create' },
  ];
  const SEAT = 3; // a non-human seat in either flavour

  /**
   * Walk `slot` round the seat ring until it is a BOT.
   *
   * Since a0-11 the two flavours no longer start that seat on the same rung — the
   * online room opens it OPEN and empty, the solo lobby opens it on the bot cast —
   * and two of the affordances below only *mean* anything on a bot seat: the
   * difficulty chip has no tier to cycle on an empty chair, and RUSH! is refused
   * below two participants (GDD §2.1, amended 2026-08-07). Getting the seat to a
   * known rung is therefore setup, not the thing under test; the ROUTING each
   * assertion is actually about is unchanged and still checked in both flavours.
   */
  function withBotAt(state: FlowState, slot: number): FlowState {
    let next = state;
    for (let i = 0; i < SEAT_STATE_CYCLE.length; i++) {
      if (next.lobby?.seats[slot]?.occupant === 'bot') return next;
      next = flowTapLobby(next, { kind: 'seatState', index: slot }).state;
    }
    throw new Error(`seat ${slot} never reached BOT`);
  }

  for (const flavour of FLAVOURS) {
    for (const mode of MODES) {
      it(`reaches open/close, bot-assign AND bot-difficulty on a bot seat in ${mode}, in ${flavour.name}`, () => {
        let state = inLobbyVia(flavour.door, 0, 0);
        if (mode !== 'ffa') state = flowTapLobby(state, { kind: 'mode' }).state;
        expect(state.lobby?.mode, `lobby is in ${mode}`).toBe(mode);
        const layout = lobbyLayout(GUARD_VIEWPORT);

        // The CHARACTER cycle: the row body reaches it (a0-06). This is the
        // per-seat bot control now, and it is the one the developer asked for.
        const body = tapCentre(layout, layout.seats[SEAT]!);
        expect(body, `row body reachable in ${mode}`).toEqual({ kind: 'seat', index: SEAT });
        const cycled = flowTapLobby(state, body!);
        expect(cycled.state.lobby?.seats[SEAT]?.character, `character cycle reachable in ${mode}`).not.toBe(
          state.lobby?.seats[SEAT]?.character,
        );

        // open/close + bot-assign: the LEADING STATE control (u5) — the one that
        // SAYS so. It belongs in this guard for the reason the guard exists: an
        // affordance that is laid out in one mode and not another, or in one lobby
        // and not the other, is the class of miss this describe block was written
        // for.
        const stateControl = tapCentre(layout, layout.seatStates[SEAT]!);
        expect(stateControl, `state control reachable in ${mode}`).toEqual({
          kind: 'seatState',
          index: SEAT,
        });
        const viaControl = flowTapLobby(state, stateControl!);
        expect(
          viaControl.state.lobby?.seats[SEAT]?.occupant,
          `bot-assign reachable in ${mode}`,
        ).not.toBe(state.lobby?.seats[SEAT]?.occupant);

        // The `?` control reaches the codex dossier — IN EVERY MODE (a0-06). It is
        // a screen the wiring opens, so the model is deliberately unmoved by it;
        // what this pins is that the control is laid out and hit-testable at all,
        // which is the half a hover-only tooltip never had.
        const help = tapCentre(layout, layout.seatHelp[SEAT]!);
        expect(help, `codex ? reachable in ${mode}`).toEqual({ kind: 'seatHelp', index: SEAT });
        expect(flowTapLobby(state, help!).state, `? changes no lobby state in ${mode}`).toBe(state);

        // The tier chip keeps its rect and is NOT a target (a0-06): it is a value,
        // not a control, so a tap there falls through to the row body rather than
        // reaching a second setting that could disagree with the cast. This is the
        // control a0-11 knew as `seatChip`; deleting it is the point of the brief.
        expect(tapCentre(layout, layout.seatChips[SEAT]!), `tier chip is inert in ${mode}`).not.toEqual({
          kind: 'seatChip',
          index: SEAT,
        });
      });
    }

    it(`reaches the whole host affordance SET in ${flavour.name} — nothing exists in one lobby and not the other`, () => {
      // The ratified guard, stated positively: every control the lobby offers its
      // host is laid out and takes effect, in BOTH flavours. The online room used to
      // have none of these, because CREATE ROOM skipped the lobby entirely.
      const layout = lobbyLayout(GUARD_VIEWPORT);
      const state = inLobbyVia(flavour.door, 0, 0);

      // Every affordance, by the rect the view draws → the target a tap resolves to.
      expect(tapCentre(layout, layout.classOptions[0]!)).toEqual({ kind: 'class', index: 0 });
      expect(tapCentre(layout, layout.maps[1]!)).toEqual({ kind: 'map', index: 1 });
      expect(tapCentre(layout, layout.modeToggle)).toEqual({ kind: 'mode' });
      expect(tapCentre(layout, layout.abundance)).toEqual({ kind: 'abundance' });
      expect(tapCentre(layout, layout.rushButton)).toEqual({ kind: 'rush' });
      expect(tapCentre(layout, layout.leave)).toEqual({ kind: 'leave' });

      // …and each one takes effect through the flow, in this flavour.
      expect(flowTapLobby(state, { kind: 'class', index: 0 }).state.lobby?.shipClass).not.toBe(
        state.lobby?.shipClass,
      );
      expect(flowTapLobby(state, { kind: 'map', index: 1 }).state.lobby?.mapId).not.toBe(state.lobby?.mapId);
      expect(flowTapLobby(state, { kind: 'mode' }).state.lobby?.mode).toBe('teams');
      expect(flowTapLobby(state, { kind: 'abundance' }).state.lobby?.abundance).not.toBe(
        state.lobby?.abundance,
      );
      // The row body is the CHARACTER cycle (a0-06); the seat-state cycle lives on
      // the leading control it has had since u5.
      expect(tapCentre(layout, layout.seatStates[SEAT]!)).toEqual({ kind: 'seatState', index: SEAT });
      expect(tapCentre(layout, layout.seatHelp[SEAT]!)).toEqual({ kind: 'seatHelp', index: SEAT });
      // On a BOT seat, because only a bot seat has a character to cycle (a0-11) —
      // an online room's seats start OPEN, and the body would rightly refuse.
      const onBot = withBotAt(state, SEAT);
      expect(flowTapLobby(onBot, { kind: 'seat', index: SEAT }).state.lobby?.seats[SEAT]?.character).not.toBe(
        onBot.lobby?.seats[SEAT]?.character,
      );
      // The state control moves the seat one rung, from whichever rung this
      // flavour started it on (a0-11) — the ring is the same in both.
      expect(
        flowTapLobby(state, { kind: 'seatState', index: SEAT }).state.lobby?.seats[SEAT]?.occupant,
      ).toBe(nextRung(state.lobby!.seats[SEAT]!.occupant));
      // RUSH! needs a match to start: two participants (GDD §2.1, amended
      // 2026-08-07). Offline the cast is already there; in an empty room the host
      // seats one bot first, which is the developer's "up to player to fill it up".
      expect(flowTapLobby(onBot, { kind: 'rush' }).state.lobby?.phase).toBe('counting');
      expect(flowTapLobby(state, { kind: 'leave' }).state.screen).toBe('entry');
    });
  }

  it('reaches team-assign in TEAMS, and treats FFA as the ratified exclusion (teams-of-one)', () => {
    const layout = lobbyLayout(GUARD_VIEWPORT);

    // TEAMS — the team chip is laid out, and a tap on it changes the side.
    const teams = flowTapLobby(inLobby(0, 0), { kind: 'mode' }).state;
    const teamTarget = tapCentre(layout, layout.seatTeamChips[SEAT]!);
    expect(teamTarget, 'team chip reachable in teams').toEqual({ kind: 'seatTeamChip', index: SEAT });
    const assigned = flowTapLobby(teams, teamTarget!);
    expect(assigned.state.lobby?.seats[SEAT]?.team).not.toBe(teams.lobby?.seats[SEAT]?.team);

    // FFA — the ratified exclusion: a slot's side IS its slot (teams-of-one), so the
    // team chip's tap is a model no-op (and the flow stays perfectly still).
    const ffa = inLobby(0, 0);
    const ffaTapped = flowTapLobby(ffa, { kind: 'seatTeamChip', index: SEAT });
    expect(ffaTapped.state, 'team-assign is excluded in FFA').toBe(ffa);
  });

  it('composes the row’s controls — side chip, `?` and body are distinct targets', () => {
    // The n2 regression, restated for the a0-06 row: a bot row in TEAMS carries the
    // side chip AND the codex `?` at distinct hit targets, and the body between
    // them is a third — so no control on this row replaces another.
    const layout = lobbyLayout(GUARD_VIEWPORT);
    const team = tapCentre(layout, layout.seatTeamChips[SEAT]!);
    const help = tapCentre(layout, layout.seatHelp[SEAT]!);
    const body = tapCentre(layout, layout.seats[SEAT]!);
    expect(team).toEqual({ kind: 'seatTeamChip', index: SEAT });
    expect(help).toEqual({ kind: 'seatHelp', index: SEAT });
    expect(body).toEqual({ kind: 'seat', index: SEAT });
    expect(new Set([JSON.stringify(team), JSON.stringify(help), JSON.stringify(body)]).size).toBe(3);

    // …and the TIER chip is deliberately NOT one of them: the difficulty is shown,
    // not chosen, so a tap that lands on it falls through to the body's character
    // cycle rather than to a control that would have to refuse.
    expect(tapCentre(layout, layout.seatChips[SEAT]!)).toEqual({ kind: 'seat', index: SEAT });
  });
});

describe('RUSH! (rule 2 — the countdown is real, and it is the host’s)', () => {
  it('sends NOTHING on the press — the count has to run first', () => {
    const pressed = flowTapLobby(inLobby(), { kind: 'rush' });
    expect(pressed.effects).toEqual([]);
    expect(pressed.state.lobby?.phase).toBe('counting');
    expect(pressed.state.lobby?.countdown).toBe(RUSH_COUNTDOWN_SECONDS);
    expect(pressed.state.screen).toBe('lobby');
  });

  it('sends startMatch on the ONE frame the count reaches zero', () => {
    let state = flowTapLobby(inLobby(), { kind: 'rush' }).state;
    const messages: ClientMessage[] = [];

    // Sixty frames of a five-second count: one message, at the end.
    for (let i = 0; i < 60; i++) {
      const step = tickFlow(state, 0.1);
      state = step.state;
      messages.push(...sent(step));
    }

    expect(messages).toEqual([{ type: 'startMatch' }]);
    expect(state.lobby?.phase).toBe('started');
    // Still the lobby's screen: the world has not arrived yet (rule 3).
    expect(state.screen).toBe('lobby');
  });

  it('locks the hull from the instant of the press (GDD §2.11)', () => {
    const pressed = flowTapLobby(inLobby(), { kind: 'rush' }).state;
    const late = flowTapLobby(pressed, { kind: 'class', index: CLASS_ORDER.indexOf(ShipClass.Interceptor) });

    expect(late.state.lobby?.shipClass).toBe(DEFAULT_SHIP_CLASS);
    expect(late.effects).toEqual([]); // and the late pick never reaches the wire
    expect(lobbyModel(pressed.lobby!).classLocked).toBe(true);
  });

  it('counts down visibly — 5…1, then RUSH! — rather than jumping', () => {
    let state = flowTapLobby(inLobby(), { kind: 'rush' }).state;
    const labels: string[] = [];
    for (let i = 0; i < 5; i++) {
      labels.push(lobbyModel(state.lobby!).countdown.label);
      state = tickFlow(state, 1).state;
    }
    expect(labels).toEqual(['5', '4', '3', '2', '1']);
  });

  it('is a no-op from a guest, who therefore never sends startMatch', () => {
    const guest = inLobby(4, 0);
    const pressed = flowTapLobby(guest, { kind: 'rush' });
    expect(pressed.state).toBe(guest);

    // …and ticking a guest's lobby produces nothing at all.
    const ticked = tickFlow(pressed.state, 10);
    expect(ticked.effects).toEqual([]);
    expect(ticked.state.screen).toBe('lobby');
  });
});

describe('authority ends the lobby (rule 3)', () => {
  it('hands the screen to the match on matchStart', () => {
    let state = flowTapLobby(inLobby(), { kind: 'rush' }).state;
    state = tickFlow(state, RUSH_COUNTDOWN_SECONDS).state;
    expect(state.screen).toBe('lobby');

    const live = flowMatchStart(state);
    expect(live.state.screen).toBe('match');
    expect(live.state.lobby?.phase).toBe('started');
    expect(live.effects).toEqual([]);
  });

  it('ends a GUEST’s lobby, which never counted at all', () => {
    const guest = inLobby(4, 0);
    expect(guest.lobby?.phase).toBe('gathering');

    const live = flowMatchStart(guest);
    expect(live.state.screen).toBe('match');
    expect(live.state.lobby?.phase).toBe('started');
  });

  it('ends the lobby mid-count if the server gets there first', () => {
    let state = flowTapLobby(inLobby(), { kind: 'rush' }).state;
    state = tickFlow(state, 1).state;
    const live = flowMatchStart(state);
    expect(live.state.screen).toBe('match');
    expect(live.state.lobby?.countdown).toBe(0);
  });

  it('comes back to a CLEAN door after a match', () => {
    let state = flowTapLobby(inLobby(), { kind: 'rush' }).state;
    state = flowMatchStart(tickFlow(state, RUSH_COUNTDOWN_SECONDS).state).state;

    const back = resetFlow(state);
    expect(back.screen).toBe('entry');
    expect(back.lobby).toBeNull();
    expect(back.entry.code).toBe('');
    expect(back.entry.error).toBe('');
  });

  it('keeps the fire mode across a reset — it is a setting, not match state', () => {
    const state = setFlowFireMode(inLobby(), FireMode.AutoAim);
    expect(resetFlow(state).fireMode).toBe(FireMode.AutoAim);
  });
});

describe('the whole front of a match, in one pass', () => {
  it('goes door → room → hull → character → RUSH! → world, in that order', () => {
    const rng = mulberry32(11);
    const log: string[] = [];
    let state = createFlow();

    const drain = (result: FlowResult): void => {
      state = result.state;
      for (const effect of result.effects) {
        if (effect.kind === 'open-transport') log.push(`open:${effect.intent.room}`);
        else if (effect.kind === 'send') log.push(`send:${effect.message.type}`);
        else log.push('close');
      }
    };

    drain(flowTapEntry(state, { kind: 'door', index: doorIndex('create') }, rng));
    const room = state.room!;
    drain(flowConnected(state, 0));
    drain(flowLobbySlots(state, slots(8, [0, 1])));
    drain(flowTapLobby(state, { kind: 'class', index: CLASS_ORDER.indexOf(ShipClass.Interceptor) }));
    drain(flowTapLobby(state, { kind: 'seat', index: 4 }));
    drain(flowTapLobby(state, { kind: 'rush' }));
    // Driven the way a frame loop drives it — until the count is spent, not for
    // a tick count computed from the duration. Fifty 0.1s frames leave ~1e-15
    // on the clock, so a match that depended on an exact multiple would start a
    // frame late; the flow only has to guarantee it starts, once.
    for (let i = 0; i < 600 && state.lobby?.phase === 'counting'; i++) drain(tickFlow(state, 0.1));
    drain(flowMatchStart(state));

    expect(log).toEqual([
      `open:${room}`,
      'send:lobbyChoice', // the pre-selected Vanguard, on open
      'send:lobbyChoice', // the Interceptor tile
      'send:lobbyChoice', // seat 4's character (a0-06) — the tier rides it
      'send:startMatch', // at zero, not on the press
    ]);
    expect(state.screen).toBe('match');
    expect(state.lobby?.shipClass).toBe(ShipClass.Interceptor);
  });

  it('reaches a started match with NO server and NO network (GDD §4.8 risk 6)', () => {
    // The offline path in full: nothing in this test can touch a socket, and
    // the flow still ends in a match. `matchStart` stands in for LocalLoopback,
    // which answers `startMatch` immediately.
    const rng = mulberry32(13);
    let result = flowTapEntry(createFlow(), { kind: 'door', index: doorIndex('solo') }, rng);
    expect((result.effects[0] as { intent: { online: boolean } }).intent.online).toBe(false);

    result = flowConnected(result.state, 0);
    result = flowTapLobby(result.state, { kind: 'rush' });
    result = tickFlow(result.state, RUSH_COUNTDOWN_SECONDS);
    result = flowMatchStart(result.state);

    expect(result.state.screen).toBe('match');
  });
});

// ---------------------------------------------------------------------------
// The Day-7 menus: settings off the main menu, and the end-of-match summary.
// ---------------------------------------------------------------------------

/** A flow watching a live match: seat `you`, host `host`, world built. Reaches
 *  `match` the way a guest does — `flowMatchStart` on the lobby — so no countdown
 *  is needed to get there. */
function inMatch(you = 0, host = you): FlowState {
  return flowMatchStart(inLobby(you, host)).state;
}

describe('the settings screen (the fourth main-menu option)', () => {
  it('opens from the main menu and returns to it', () => {
    const rng = mulberry32(21);
    const opened = flowTapEntry(createFlow(), { kind: 'settings' }, rng);
    expect(opened.state.screen).toBe('settings');
    expect(opened.state.settingsReturn).toBe('entry');
    expect(opened.effects).toEqual([]); // opening a screen owes the wire nothing

    const done = flowTapSettings(opened.state, { kind: 'back' });
    expect(done.state.screen).toBe('entry');
  });

  it('only opens from a screen a settings button can be pressed on', () => {
    // Mid-lobby there is no main-menu settings button; the flow refuses to jump.
    expect(flowOpenSettings(inLobby()).state.screen).toBe('lobby');
  });

  it('backs out on Escape, and ignores other keys', () => {
    const settings = flowOpenSettings(createFlow()).state;
    expect(flowKey(settings, 'A').state).toBe(settings); // swallowed, no churn
    expect(flowKey(settings, 'Escape').state.screen).toBe('entry');
  });

  it('toggles the fire mode, and it is the SAME value the wire will carry', () => {
    const settings = flowOpenSettings(createFlow(FireMode.Manual)).state;
    const toggled = flowTapSettings(settings, { kind: 'fireMode' });
    expect(toggled.state.fireMode).toBe(FireMode.AutoAim);
    expect(toggled.effects).toEqual([]); // no lobby on the main menu, so no message

    // …and it rides the first lobbyChoice when a room finally opens.
    const done = flowCloseSettings(toggled.state).state;
    const rng = mulberry32(22);
    const opened = flowTapEntry(done, { kind: 'door', index: doorIndex('solo') }, rng);
    expect(sent(flowConnected(opened.state, 0))[0]).toMatchObject({ fireMode: 'auto' });
  });

  it('toggles the control scheme, and it never rides the wire (local input only)', () => {
    const settings = flowOpenSettings(createFlow()).state;
    expect(settings.controlScheme).toBe('sticks'); // the untouched default
    const tap = flowTapSettings(settings, { kind: 'controls' });
    expect(tap.state.controlScheme).toBe('tap');
    expect(tap.effects).toEqual([]); // the scheme is local input — nothing to send
    const back = flowTapSettings(tap.state, { kind: 'controls' });
    expect(back.state.controlScheme).toBe('sticks');

    // …and unlike the fire mode it does NOT ride a lobbyChoice — the sim never
    // sees the scheme, so opening a room carries no control-scheme field.
    const done = flowCloseSettings(tap.state).state;
    const rng = mulberry32(23);
    const opened = flowTapEntry(done, { kind: 'door', index: doorIndex('solo') }, rng);
    expect(sent(flowConnected(opened.state, 0))[0]).not.toHaveProperty('controlScheme');
  });

  it('toggles reduce VFX and steps a volume, without a message either', () => {
    const settings = flowOpenSettings(createFlow()).state;
    const vfx = flowTapSettings(settings, { kind: 'reduceVfx' });
    expect(vfx.state.settings.reduceVfx).toBe(true);
    expect(vfx.effects).toEqual([]);

    const before = volumeLevel(settings.settings, 'master');
    const down = flowTapSettings(vfx.state, { kind: 'volume', channel: 'master', dir: -1 });
    expect(volumeLevel(down.state.settings, 'master')).toBe(before - 1);
  });

  it('stays perfectly still on a tap that changed nothing', () => {
    // A volume already at zero, nudged down again: identical settings, identical
    // flow — no new object for anything watching by identity.
    let s = flowOpenSettings(createFlow()).state;
    for (let i = 0; i < 15; i++) s = flowTapSettings(s, { kind: 'volume', channel: 'sfx', dir: -1 }).state;
    const again = flowTapSettings(s, { kind: 'volume', channel: 'sfx', dir: -1 });
    expect(again.state).toBe(s);
  });
});

describe('the end-of-match summary, and Rematch (resets the world cleanly)', () => {
  it('shows VICTORY to the winner and DEFEAT to everyone else', () => {
    const ended = flowMatchEnded(inMatch(4, 0), 4); // seat 4 won, and seat 4 is you
    expect(ended.state.screen).toBe('end');
    // In FFA your side is you alone — teams-of-one, so this is the outcome the
    // flow always built, plus the roster that says exactly that (a0-09).
    expect(ended.state.end).toEqual({ you: 4, winner: 4, matchOver: true, allies: new Set([4]) });
    expect(endOfMatchModel(ended.state.end!).kind).toBe('victory');

    const lost = flowMatchEnded(inMatch(4, 0), 0);
    expect(endOfMatchModel(lost.state.end!).kind).toBe('defeat');
  });

  /**
   * a0-09 — the developer's report, driven through the flow the online client
   * actually runs: a TEAMS match ends on a `matchEnd` naming a TEAMMATE, and the
   * summary must read VICTORY. Before the fix this path had no notion of a side
   * at all, so an ally's win and an enemy's win arrived here identical.
   *
   * The side is read off the lobby the match was built from — legal because
   * allegiance is static match config fixed at match start (GDD §2.1, §4.2).
   */
  it('shows VICTORY in TEAMS when a TEAMMATE takes the claim', () => {
    // The host taps TEAMS on the real roster control, then RUSHes. Sides
    // alternate by slot (`defaultTeamForSlot`), so you at seat 0 hold side A with
    // seats 2, 4 and 6, and the odd seats hold side B.
    const teams = flowTapLobby(inLobby(0, 0), { kind: 'mode' }).state;
    expect(teams.lobby!.mode).toBe('teams');
    const state = flowMatchStart(teams).state;
    expect(state.screen).toBe('match');

    const allyWon = flowMatchEnded(state, 2);
    expect(allyWon.state.end!.allies).toEqual(new Set([0, 2, 4, 6]));
    expect(endOfMatchModel(allyWon.state.end!).kind).toBe('victory');
    expect(endOfMatchModel(allyWon.state.end!).subhead).toContain('Your side');

    // …and an enemy's win is still a defeat.
    expect(endOfMatchModel(flowMatchEnded(state, 1).state.end!).kind).toBe('defeat');

    // Eliminated, then your side finishes it: SPECTATE, then VICTORY.
    const dead = flowEliminated(state);
    expect(endOfMatchModel(dead.state.end!).kind).toBe('eliminated');
    const watching = flowTapEnd(dead.state, { kind: 'spectate' }).state;
    expect(watching.screen).toBe('match');
    const sideWon = flowMatchEnded(watching, 2);
    expect(endOfMatchModel(sideWon.state.end!).kind).toBe('victory');
  });

  it('ignores a matchEnd that did not arrive during a live match', () => {
    // On the door, or a second time over — a stray end must not conjure a summary.
    expect(flowMatchEnded(createFlow(), 0).state.screen).toBe('entry');
    const ended = flowMatchEnded(inMatch(0), 0).state;
    expect(flowMatchEnded(ended, 3).state).toBe(ended);
  });

  it('offers Spectate only when you were eliminated but the match lives on', () => {
    const eliminated = flowEliminated(inMatch(2, 0));
    expect(eliminated.state.screen).toBe('end');
    expect(eliminated.state.end).toMatchObject({ matchOver: false });
    expect(endOfMatchModel(eliminated.state.end!).buttons.map((b) => b.id)).toEqual(['rematch', 'spectate']);

    // Spectate dismisses the summary and returns to watching, flagged spectator.
    const watching = flowTapEnd(eliminated.state, { kind: 'spectate' });
    expect(watching.state.screen).toBe('match');
    expect(watching.state.spectating).toBe(true);
    expect(watching.state.end).toBeNull();
  });

  it('refuses Spectate on a whole-match-over screen — nothing left to watch', () => {
    const ended = flowMatchEnded(inMatch(0), 0).state;
    expect(flowTapEnd(ended, { kind: 'spectate' }).state).toBe(ended);
  });

  it('Rematch resets the world to a clean door, keeping fire mode and settings', () => {
    // A match played with non-default preferences.
    let state = setFlowFireMode(inMatch(0), FireMode.AutoAim);
    state = { ...state, settings: { ...createSettings(), reduceVfx: true }, controlScheme: 'tap' };
    const ended = flowMatchEnded(state, 0).state;

    const rematch = flowTapEnd(ended, { kind: 'rematch' });
    const back = rematch.state;
    expect(back.screen).toBe('entry');
    expect(back.lobby).toBeNull(); // the world is gone
    expect(back.end).toBeNull();
    expect(back.spectating).toBe(false);
    expect(back.entry.code).toBe(''); // and the door is clean
    // …but the player's choices survive the reset.
    expect(back.fireMode).toBe(FireMode.AutoAim);
    expect(back.settings.reduceVfx).toBe(true);
    expect(back.controlScheme).toBe('tap'); // the control scheme is the player's too
  });

  it('a fresh match after spectating never opens over a stale summary', () => {
    // Eliminated → spectate → a rematch elsewhere brings a new matchStart.
    const watching = flowTapEnd(flowEliminated(inMatch(3, 0)).state, { kind: 'spectate' }).state;
    expect(watching.spectating).toBe(true);
    const relit = flowMatchStart(watching);
    expect(relit.state.spectating).toBe(false);
    expect(relit.state.end).toBeNull();
    expect(relit.state.screen).toBe('match');
  });
});

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
  flowConnected,
  flowFailed,
  flowKey,
  flowLobbySlots,
  flowMatchStart,
  flowTapEntry,
  flowTapLobby,
  resetFlow,
  setFlowFireMode,
  tickFlow,
  wireFireMode,
} from './lobby-flow';
import type { FlowEffect, FlowResult, FlowState } from './lobby-flow';
import { DOOR_ORDER, ENTRY_ERRORS, KEYPAD_KEYS } from './lobby-entry';
import { CLASS_ORDER, DEFAULT_SHIP_CLASS, RUSH_COUNTDOWN_SECONDS, lobbyModel } from './lobby';

// ---------------------------------------------------------------------------
// Helpers — a flow is driven the way main.ts will drive it: state in, effects
// drained, state kept.
// ---------------------------------------------------------------------------

/** The index of a door in the order the view draws it — the same lookup the
 *  hit-test does, so a test can tap by name. */
function doorIndex(door: 'solo' | 'create' | 'join'): number {
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
    const host = flowTapLobby(inLobby(0, 0), { kind: 'seat', index: 3 });
    const message = sent(host)[0] as { botDifficulties?: readonly string[] };
    expect(message.botDifficulties).toHaveLength(7); // seven empty seats of eight

    // A guest's choice message carries no difficulties at all — the server
    // ignores them from a guest, so putting them on the wire would be noise.
    const guest = flowTapLobby(inLobby(4, 0), { kind: 'class', index: 0 });
    expect(sent(guest)[0]).not.toHaveProperty('botDifficulties');
  });

  it('costs the wire NOTHING for a refused tap', () => {
    // A guest cycling a difficulty, and a guest pressing RUSH!: both no-ops in
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

  it('does not answer a lobbyState broadcast — an echo that replied would loop', () => {
    const state = inLobby();
    const folded = flowLobbySlots(state, slots(8, [0, 5]));
    expect(folded.effects).toEqual([]);
    expect(lobbyModel(folded.state.lobby!).humanCount).toBe(2);
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
  it('goes door → room → hull → difficulty → RUSH! → world, in that order', () => {
    const rng = mulberry32(11);
    const log: string[] = [];
    let state = createFlow();

    const drain = (result: FlowResult): void => {
      state = result.state;
      for (const effect of result.effects) {
        log.push(effect.kind === 'open-transport' ? `open:${effect.intent.room}` : `send:${effect.message.type}`);
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
      'send:lobbyChoice', // seat 4's difficulty
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

/**
 * src/ui/lobby-flow.ts — the front-of-match state machine. OWNER: UI Engineer.
 *
 * {@link ./lobby-entry} is the door, {@link ./lobby} is the room, and the match
 * is what comes after. Each of those three is a clean pure model with its own
 * tests. This file is the **join between them** — the part that was, until now,
 * a thirty-line comment in `./index.ts` telling `src/main.ts` what to call in
 * what order.
 *
 * A comment is not a seam. M2 shipped a HUD whose every element was merged,
 * tested and unwired, and the milestone was retracted for it (`RETRACTION: M2
 * marked not-done — its features were merged but never wired into the client`).
 * The lesson that commit paid for is that the *order of the calls* is itself a
 * thing that can be wrong, and prose cannot be wrong in a way a test catches.
 * So the order lives here, in code, asserted headless like everything else in
 * this directory — and Platform's job in `main.ts` shrinks from transcribing a
 * comment to draining an effect list.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * It owns the *sequence*: which screen is live, which model an input goes to,
 * and which message the wire owes the server as a result. It owns no sockets,
 * no Pixi, and no clock — {@link FlowEffect}s are handed back to the caller to
 * perform, so this file can be driven to a started match inside a unit test
 * with no server, no canvas and no timers.
 *
 * It does not own the sim. `screen === 'match'` is this module saying "I am
 * done" — the world is built from the server's `matchStart`, by whoever owns
 * the world, exactly as before.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THE SEQUENCE KEEPS
 * ---------------------------------------------------------------------------
 *
 *  1. **One room code, end to end.** The code the door resolved is the code the
 *     lobby opens on and the code the `join` carries. There is exactly one
 *     place a code is minted ({@link ./lobby} `makeRoomCode`, seeded) and the
 *     flow never invents a second one — a lobby whose title disagreed with the
 *     room the socket is in would send a classroom to the wrong match.
 *  2. **The countdown is real, and it is the host's.** RUSH! starts a local
 *     count that everyone watching the host's screen can read; the
 *     `startMatch` message is sent when that count reaches **zero**, not when
 *     the button is pressed. Sending on press would let the server's
 *     `matchStart` land mid-count and cut the countdown to nothing — which is
 *     exactly what would happen offline, where `LocalLoopback` answers
 *     instantly. A countdown that only exists on paper is worse than none.
 *  3. **Authority ends the lobby.** Whatever the local count believed,
 *     `matchStart` is what moves the screen ({@link flowMatchStart}). A guest
 *     never counted at all — the ratified wire has no message that broadcasts
 *     a countdown (`src/net/transport.ts`), so a guest waits on the roster and
 *     the match arrives. That asymmetry is a property of the contract, not an
 *     oversight here; the alternative is for UI to invent a wire message it
 *     does not own.
 */

import type { Rng } from '@shared/types';
import { ShipClass } from '@shared/types';
import { FireMode } from '@platform/actions';
import type { ClientMessage, FireMode as WireFireMode, LobbySlot, RoomCode } from '../net/transport';
import type { EntryTarget, LobbyTarget } from './lobby-geometry';
import {
  DOOR_ORDER,
  ENTRY_ERRORS,
  KEYPAD_KEYS,
  backToDoors,
  chooseDoor,
  createEntry,
  eraseEntryCode,
  entryConnected,
  entryFailed,
  submitJoin,
  typeEntryCode,
} from './lobby-entry';
import type { EntryIntent, EntryState } from './lobby-entry';
import {
  CLASS_ORDER,
  applyLobbySlots,
  botDifficulties,
  createLobby,
  cycleBotDifficulty,
  pressRush,
  seatLocalPlayer,
  selectShipClass,
  startLobbyMatch,
  tickLobby,
} from './lobby';
import type { LobbyState } from './lobby';

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/**
 * Which of the three screens owns the display.
 *
 *  - `entry` — the doors and the keypad ({@link ./lobby-entry-view}).
 *  - `lobby` — the roster, the hulls and RUSH! ({@link ./lobby-view}).
 *  - `match` — neither; the world has the screen and this module is finished.
 */
export type FlowScreen = 'entry' | 'lobby' | 'match';

/** The whole front-of-match, as one immutable value. */
export interface FlowState {
  readonly screen: FlowScreen;
  /** Always present: leaving a match lands back on a clean door. */
  readonly entry: EntryState;
  /** Null until a door resolves — there is no room to have a roster for yet. */
  readonly lobby: LobbyState | null;
  /** The room the transport is (or is being) opened on. */
  readonly room: RoomCode | null;
  /** False for the SOLO door — the caller's cue for `LocalLoopback` over a
   *  WebSocket (GDD §4.2). Meaningless before a door has been chosen. */
  readonly online: boolean;
  /** The fire mode sent with every `lobbyChoice`. Settings owns the value; the
   *  flow only carries it so the message it builds is complete. */
  readonly fireMode: FireMode;
}

/**
 * Something the caller must do. Everything this module cannot do itself —
 * because it holds no socket — comes back as one of these, in the order it must
 * happen.
 */
export type FlowEffect =
  /** Open a transport for `intent.room` (a WebSocket, or `LocalLoopback` when
   *  `intent.online` is false) and send it a `join` for that room. */
  | { readonly kind: 'open-transport'; readonly intent: EntryIntent }
  /** Send this on the open transport, unchanged. */
  | { readonly kind: 'send'; readonly message: ClientMessage };

/** A transition, plus whatever it owes the outside world. */
export interface FlowResult {
  readonly state: FlowState;
  readonly effects: readonly FlowEffect[];
}

const NO_EFFECTS: readonly FlowEffect[] = [];

/** A flow resting on a clean entry screen. */
export function createFlow(fireMode: FireMode = FireMode.Manual): FlowState {
  return {
    screen: 'entry',
    entry: createEntry(),
    lobby: null,
    room: null,
    online: false,
    fireMode,
  };
}

function rest(state: FlowState): FlowResult {
  return { state, effects: NO_EFFECTS };
}

/** Fold a new entry state in, keeping the flow *identical* when the entry model
 *  refused. Every model function in `./lobby-entry` returns the same object on a
 *  no-op, and that stillness has to survive the wrapper — a key that was never
 *  going to be part of a code must not churn a new FlowState per keystroke. */
function withEntry(state: FlowState, entry: EntryState): FlowResult {
  return entry === state.entry ? rest(state) : rest({ ...state, entry });
}

// ---------------------------------------------------------------------------
// The message the lobby owes the server
// ---------------------------------------------------------------------------

/**
 * The `lobbyChoice` for the lobby as it stands: the hull this client picked,
 * the fire mode, and — from the room's creator only — the per-seat bot
 * difficulties in the empty-seat order `server/room.ts` reads them in.
 *
 * Sent on every change rather than once at RUSH!, because `lobbyState` is
 * broadcast on any change (`src/net/transport.ts`) and a roster that showed a
 * hull nobody else had been told about would be a roster that lies about the
 * match being built.
 */
/**
 * The fire mode as **the wire spells it**.
 *
 * Two ratified contracts disagree on one string: `@platform/actions` calls
 * auto-aim `'auto-aim'` and `src/net/transport.ts` calls it `'auto'`. Neither
 * file is UI's to change, and a client that sent the action layer's spelling
 * would have every touch player's fire mode silently rejected by the server's
 * parser — so the translation happens here, in the one place the two contracts
 * meet, and is named so it cannot be mistaken for a typo.
 *
 * Flagged for the Director in this branch's PR: the right fix is one spelling
 * in `@shared/types`, which is a shared-contract change and not a unilateral
 * one.
 */
export function wireFireMode(mode: FireMode): WireFireMode {
  return mode === FireMode.AutoAim ? 'auto' : 'manual';
}

function choiceFor(state: FlowState, lobby: LobbyState): FlowEffect {
  const host = lobby.you === lobby.host;
  return {
    kind: 'send',
    message: {
      type: 'lobbyChoice',
      shipClass: lobby.shipClass,
      fireMode: wireFireMode(state.fireMode),
      ...(host ? { botDifficulties: botDifficulties(lobby) } : {}),
    },
  };
}

/** Fold a new lobby in, emitting a `lobbyChoice` only when something the server
 *  cares about actually moved. Identity-compare, because every model function
 *  in `./lobby` returns the same object when it refuses. */
function withLobby(state: FlowState, lobby: LobbyState): FlowResult {
  if (state.lobby === lobby) return rest(state);
  const next = { ...state, lobby };
  return { state: next, effects: [choiceFor(next, lobby)] };
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/**
 * Tap a door, or a key on the pad — a hit-test target from
 * {@link ./lobby-geometry} `entryHitTest`, mapped back through the *model's*
 * own order so a re-ordered keypad can never dial a different code.
 *
 * A no-op once the lobby has the screen: the entry view is hidden then, and a
 * stray tap arriving a frame late must not re-open a door.
 */
export function flowTapEntry(state: FlowState, target: EntryTarget, rng: Rng): FlowResult {
  if (state.screen !== 'entry') return rest(state);
  switch (target.kind) {
    case 'door': {
      const door = DOOR_ORDER[target.index];
      return door ? resolve(state, chooseDoor(state.entry, door, rng)) : rest(state);
    }
    case 'key': {
      const key = KEYPAD_KEYS[target.index];
      return key ? withEntry(state, typeEntryCode(state.entry, key)) : rest(state);
    }
    case 'erase':
      return withEntry(state, eraseEntryCode(state.entry));
    case 'back':
      return withEntry(state, backToDoors(state.entry).state);
    case 'submit':
      return resolve(state, submitJoin(state.entry));
  }
}

/** Turn an {@link ./lobby-entry} result into a flow transition: an unresolved
 *  one just moves the screen, a resolved one opens the transport. */
function resolve(state: FlowState, result: { state: EntryState; intent: EntryIntent | null }): FlowResult {
  const next = { ...state, entry: result.state };
  if (!result.intent) return rest(next);
  return {
    state: { ...next, room: result.intent.room, online: result.intent.online },
    effects: [{ kind: 'open-transport', intent: result.intent }],
  };
}

/**
 * A desktop keypress, routed by whichever screen is live. The pad and the
 * keyboard go through the same model function (`typeEntryCode`), so a code
 * typed on a phone and a code typed on a laptop are validated identically.
 *
 * `Enter` submits, `Backspace` erases, `Escape` backs out. Anything else is
 * offered as a character and silently dropped if it is not one.
 */
export function flowKey(state: FlowState, key: string): FlowResult {
  if (state.screen !== 'entry') return rest(state);
  if (key === 'Enter') return resolve(state, submitJoin(state.entry));
  if (key === 'Backspace') return withEntry(state, eraseEntryCode(state.entry));
  if (key === 'Escape') return withEntry(state, backToDoors(state.entry).state);
  if (key.length !== 1) return rest(state);
  return withEntry(state, typeEntryCode(state.entry, key));
}

// ---------------------------------------------------------------------------
// How an attempt ends
// ---------------------------------------------------------------------------

/**
 * The transport is up and the server has welcomed this client into `you`.
 *
 * This is where the lobby is born, and it is born on **the room code the door
 * resolved** (rule 1) unless the server names a different one in its `welcome`
 * — the server is the authority on room identity, and a client that argued
 * would print a code nobody else could join by.
 *
 * The first `lobbyChoice` goes out immediately: the pre-selected Vanguard
 * (GDD §2.11) is a real choice the room has not been told about yet, and a
 * roster that showed it only after the player touched a tile would be showing
 * a hull the server had not agreed to.
 */
export function flowConnected(
  state: FlowState,
  you = 0,
  options: { readonly host?: number; readonly room?: RoomCode } = {},
): FlowResult {
  const room = options.room ?? state.room;
  if (room === null) return rest(state);
  // The creator of a room is its host, and so is a solo player. A client that
  // typed a code into JOIN walked into somebody else's room, so its host is
  // whoever the caller says it is — and, absent a wire field for it, seat 0.
  const host = options.host ?? (state.entry.screen === 'join' ? 0 : you);
  const lobby = seatLocalPlayer(createLobby({ room, you, host }), you, host);
  const next: FlowState = {
    ...state,
    screen: 'lobby',
    entry: entryConnected(),
    lobby,
    room,
  };
  return { state: next, effects: [choiceFor(next, lobby)] };
}

/**
 * The transport refused, dropped, or timed out. Back to the door with the
 * reason on it and the typed code intact — see {@link ./lobby-entry}
 * `entryFailed`, which exists so that retrying a full room is one tap.
 */
export function flowFailed(state: FlowState, reason: string = ENTRY_ERRORS.offline): FlowResult {
  return rest({
    ...state,
    screen: 'entry',
    entry: entryFailed(state.entry, reason),
    lobby: null,
  });
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * Tap the lobby — a target from {@link ./lobby-geometry} `lobbyHitTest`,
 * mapped through {@link CLASS_ORDER} so the tile the finger landed on is the
 * hull the model records.
 *
 * Every refusal this can meet — a locked hull, a guest cycling a difficulty, a
 * guest pressing RUSH! — is already a no-op in `./lobby`, and a no-op there
 * returns the identical object, so {@link withLobby} sends nothing. A refused
 * tap costs the wire zero bytes.
 */
export function flowTapLobby(state: FlowState, target: LobbyTarget): FlowResult {
  const lobby = state.lobby;
  if (state.screen !== 'lobby' || !lobby) return rest(state);
  switch (target.kind) {
    case 'class': {
      const shipClass: ShipClass | undefined = CLASS_ORDER[target.index];
      return shipClass === undefined ? rest(state) : withLobby(state, selectShipClass(lobby, shipClass));
    }
    case 'seat':
      return withLobby(state, cycleBotDifficulty(lobby, target.index));
    case 'rush': {
      // No message yet — the countdown has to run first (rule 2). A guest's
      // press is refused by `pressRush`, which returns the identical lobby, and
      // the flow must be just as still: allocating a new FlowState for a
      // refusal would make every guest tap look like a change to anything
      // watching by identity.
      const started = pressRush(lobby);
      return started === lobby ? rest(state) : rest({ ...state, lobby: started });
    }
    case 'roomCode':
      // The code is a label, not a control. It is hit-testable so the caller can
      // offer copy-to-clipboard (a DOM affordance UI does not own); ignoring it
      // here means a tap on it never disturbs the roster.
      return rest(state);
  }
}

/**
 * Advance the countdown by `dt` seconds.
 *
 * The one frame on which it reaches zero is the frame `startMatch` goes out
 * (rule 2) — and only from the seat that pressed the button, because
 * {@link pressRush} is the only way to reach `counting` and it refuses from a
 * guest. The screen does *not* move here: the lobby's own phase becomes
 * `started`, meaning "waiting for the world", and `matchStart` is what hands
 * the screen over ({@link flowMatchStart}, rule 3).
 */
export function tickFlow(state: FlowState, dt: number): FlowResult {
  const lobby = state.lobby;
  if (state.screen !== 'lobby' || !lobby || lobby.phase !== 'counting') return rest(state);
  const next = tickLobby(lobby, dt);
  if (next === lobby) return rest(state);
  const effects: readonly FlowEffect[] =
    next.phase === 'started' ? [{ kind: 'send', message: { type: 'startMatch' } }] : NO_EFFECTS;
  return { state: { ...state, lobby: next }, effects };
}

/** Fold in a `lobbyState` broadcast. Pure display: the server telling us who is
 *  in the room is never a reason to send it anything back, so this emits
 *  nothing — an echo that re-sent a choice would loop the room forever. */
export function flowLobbySlots(state: FlowState, slots: readonly LobbySlot[]): FlowResult {
  if (!state.lobby) return rest(state);
  return rest({ ...state, lobby: applyLobbySlots(state.lobby, slots) });
}

/** The server said the match is live. The world is built by whoever owns the
 *  world; this module's last act is to get off the screen (rule 3). */
export function flowMatchStart(state: FlowState): FlowResult {
  if (!state.lobby) return rest({ ...state, screen: 'match' });
  return rest({ ...state, screen: 'match', lobby: startLobbyMatch(state.lobby) });
}

/** Settings changed the fire mode. Carried into the next `lobbyChoice` rather
 *  than sent on its own — the lobby is not the fire mode's authority, it is
 *  just the message the fire mode happens to ride in before a match. */
export function setFlowFireMode(state: FlowState, fireMode: FireMode): FlowState {
  return state.fireMode === fireMode ? state : { ...state, fireMode };
}

/** Leave the match and come back to a clean door (the end-of-match screen's
 *  way out). Deliberately a full reset: a stale roster behind a new door is how
 *  a player ends up looking at the previous match's colours. */
export function resetFlow(state: FlowState): FlowState {
  return createFlow(state.fireMode);
}

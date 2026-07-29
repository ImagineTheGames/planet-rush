/**
 * src/ui/lobby-entry.ts — the door into a room. OWNER: UI Engineer.
 *
 * The screen *before* {@link ./lobby}: the three ways a match is entered
 * (GDD §2.1, §4.2), and the on-screen pad a room code is typed on.
 *
 *   PLAY SOLO     no server, no code to read out — bots fill all eight seats.
 *   CREATE ROOM   a fresh code, generated here and shown for the room to read.
 *   JOIN ROOM     type the code somebody else is holding up.
 *
 * Pure and DOM-free like every model in this directory. It decides; the geometry
 * ({@link ./lobby-geometry} `entryLayout`) holds the rects and the view
 * ({@link ./lobby-entry-view}) only draws what the two of them return.
 *
 * ---------------------------------------------------------------------------
 * WHY SOLO IS THE FIRST DOOR
 * ---------------------------------------------------------------------------
 * "The solo/offline game is a complete product on its own" and "offline
 * solo-vs-bots is a first-class mode, not a fallback" (GDD §4.8 risks 2 and 6).
 * A player who opens the URL with no room code, no friends and no server should
 * be flying inside one tap — so SOLO is the first door, the largest, and the one
 * that needs no network at all. A dead server costs the classroom a session,
 * never the game, and this screen is where that promise is either kept or lost.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A KEYPAD AND NOT A TEXT FIELD
 * ---------------------------------------------------------------------------
 * The game is a canvas. There is no DOM `<input>` to focus, and summoning a
 * mobile OS keyboard over a landscape-locked WebGL canvas is exactly the kind of
 * thing that eats half the screen and fires a resize storm (`src/platform/
 * orientation.ts` keeps this game landscape). So the code is entered by tapping
 * — "menus and Rematch are plain taps" (GDD §2.4) — on a pad holding the whole
 * {@link ROOM_CODE_ALPHABET}, which is only 32 keys precisely *because* the
 * ambiguous glyphs are not in it. Desktop players type on a real keyboard
 * instead; both routes go through {@link typeEntryCode}, so there is one rule
 * for what a character does and it is unit-tested once.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN NEVER DOES
 * ---------------------------------------------------------------------------
 * It never talks to a socket. {@link chooseDoor} and {@link submitJoin} return an
 * {@link EntryIntent} — a value naming what the player asked for — and the
 * caller owns the transport (`src/net/transport.ts` `JoinMessage`). That keeps
 * the whole flow, including its failures, testable without a server, and keeps
 * this file inside `src/ui/`.
 */

import type { Rng } from '@shared/types';
import type { RoomCode } from '../net/transport';
import type { ResolveFailure } from '../net/allocator-client';
import { resolveFailureMessage } from './online-copy';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  eraseRoomCode,
  isJoinableRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  typeRoomCode,
} from './lobby';

// ---------------------------------------------------------------------------
// The three doors
// ---------------------------------------------------------------------------

/**
 * A way into a match. Ordered as the screen offers them: the one that always
 * works first, then the one that starts a room, then the one that needs someone
 * else to have started one.
 */
export type EntryDoor = 'solo' | 'create' | 'join';

/** Door order, top to bottom / left to right. */
export const DOOR_ORDER: readonly EntryDoor[] = ['solo', 'create', 'join'];

/** One door, as the button reads. Words only — this screen has no numbers. */
export interface EntryDoorOption {
  readonly door: EntryDoor;
  /** The button's word (Audiowide, style-guide §7). */
  readonly label: string;
  /** The one line under it that says what it costs you. */
  readonly hint: string;
  /** Whether it needs a server. SOLO does not — which is the whole point. */
  readonly needsNetwork: boolean;
}

/** The three doors (GDD §2.1, §4.2, §4.8). */
export const DOOR_OPTIONS: readonly EntryDoorOption[] = [
  {
    door: 'solo',
    label: 'PLAY SOLO',
    hint: 'Seven bots, no connection needed.',
    needsNetwork: false,
  },
  {
    door: 'create',
    label: 'CREATE ROOM',
    hint: 'Get a code, read it out, they join you.',
    needsNetwork: true,
  },
  {
    door: 'join',
    label: 'JOIN ROOM',
    hint: 'Type the code somebody is holding up.',
    needsNetwork: true,
  },
];

// ---------------------------------------------------------------------------
// The keypad
// ---------------------------------------------------------------------------

/**
 * The keys of the on-screen pad: the code alphabet, in its own order, plus a
 * back key. 32 letters and digits with no `O`/`0` and no `I`/`1`, which is what
 * makes a pad of tappable keys fit a phone at all (see the file header).
 */
export const KEYPAD_KEYS: readonly string[] = ROOM_CODE_ALPHABET.split('');

/** Columns in the pad. 8 × 4 keys is the landscape shape — wide and short, on a
 *  screen whose scarce axis is height (`./lobby-geometry` header). */
export const KEYPAD_COLUMNS = 8;
/** Rows the pad needs at {@link KEYPAD_COLUMNS} wide. */
export const KEYPAD_ROWS = Math.ceil(KEYPAD_KEYS.length / KEYPAD_COLUMNS);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Which of the entry screens is up. */
export type EntryScreen = 'home' | 'join';

/**
 * What the screen is doing.
 *
 *  - `idle`       — waiting for a tap.
 *  - `connecting` — an intent has been handed to the caller and the transport is
 *                   working on it. Every control is dead until it resolves, so a
 *                   double-tap on CREATE cannot open two rooms.
 *  - `error`      — the attempt came back refused; {@link EntryState.error} says
 *                   why, in the player's words, and the controls are live again.
 */
export type EntryStatus = 'idle' | 'connecting' | 'error';

/** The entry screen, as one immutable value. */
export interface EntryState {
  readonly screen: EntryScreen;
  /** The code being typed on the join screen. Never longer than
   *  {@link ROOM_CODE_LENGTH} and only ever alphabet characters. */
  readonly code: string;
  readonly status: EntryStatus;
  /** Why the last attempt failed, in words a player can act on. `''` if none. */
  readonly error: string;
}

/**
 * What the player asked for. The caller turns this into a `JoinMessage` and a
 * transport — {@link ./lobby} `createLobby({ room })` takes the same `room`, so
 * whichever door was used the lobby that opens is identical.
 */
export interface EntryIntent {
  readonly door: EntryDoor;
  /**
   * The room to open a transport for. For `solo` this is the loopback room; for a
   * `join` it is the code the player typed. For an **online `create`** it is a
   * locally-drawn placeholder the caller MUST discard: the allocator mints the
   * real, globally-unique code and the client uses `assignment.code` verbatim
   * (M3 brief — "the client must never mint or guess a room code"). The seeded
   * placeholder exists only so the offline loopback create has an id to key on.
   */
  readonly room: RoomCode;
  /** `false` only for {@link EntryDoor} `solo` — the caller's cue to reach for
   *  `LocalLoopback` rather than a WebSocket (GDD §4.2). */
  readonly online: boolean;
}

/** A transition that may also hand the caller something to do. */
export interface EntryResult {
  readonly state: EntryState;
  /** Non-null exactly when the caller should now open a transport. */
  readonly intent: EntryIntent | null;
}

/** The refusals this screen knows how to say. Phrased as what to *do* next,
 *  never as an error code — a player who cannot read the message cannot act. */
export const ENTRY_ERRORS = {
  /** A submit with fewer than {@link ROOM_CODE_LENGTH} characters. */
  short: `A room code is ${ROOM_CODE_LENGTH} characters.`,
  /** The server has no such room (it creates unknown codes, so this is a typo
   *  the server declined rather than a room that vanished). */
  unknown: 'No room with that code. Check it and try again.',
  /** Eight seats, all taken (`./lobby` LOBBY_SLOTS). */
  full: 'That room is full. Ask for a rematch, or play solo.',
  /** No server, or no internet. Names the door that still works. */
  offline: 'Cannot reach the server. PLAY SOLO still works.',
} as const;

/** A fresh entry screen: the home doors, nothing typed, nothing wrong. */
export function createEntry(): EntryState {
  return { screen: 'home', code: '', status: 'idle', error: '' };
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

/** Whether the screen is taking input. False mid-attempt, which is what stops a
 *  double-tap on CREATE from opening two rooms. */
export function entryLive(state: EntryState): boolean {
  return state.status !== 'connecting';
}

/**
 * Tap a door.
 *
 * SOLO and CREATE resolve immediately — both need a room code and neither needs
 * the player to know one, so the code is drawn here from the ratified seeded PRNG
 * (`mulberry32`, never `Math.random()`), exactly as {@link makeRoomCode}
 * documents. JOIN has nothing to resolve yet: it opens the keypad.
 *
 * A no-op while an earlier attempt is still connecting.
 */
export function chooseDoor(state: EntryState, door: EntryDoor, rng: Rng): EntryResult {
  if (!entryLive(state)) return { state, intent: null };
  if (door === 'join') {
    return { state: { ...state, screen: 'join', code: '', status: 'idle', error: '' }, intent: null };
  }
  const room = makeRoomCode(rng);
  return {
    state: { ...state, status: 'connecting', error: '' },
    intent: { door, room, online: door === 'create' },
  };
}

/** Back out of the keypad to the doors, dropping what was typed. */
export function backToDoors(state: EntryState): EntryResult {
  if (!entryLive(state)) return { state, intent: null };
  return { state: createEntry(), intent: null };
}

// ---------------------------------------------------------------------------
// Typing a code
// ---------------------------------------------------------------------------

/**
 * Add one character — from a keypad tap or a desktop keypress, the same rule for
 * both. Anything not in the (ambiguity-free) alphabet and anything past the code
 * length is dropped silently: there is nothing useful to say about a keystroke
 * that was never going to be part of a code.
 *
 * Typing clears a previous error, because the player is already fixing it.
 */
export function typeEntryCode(state: EntryState, key: string): EntryState {
  if (!entryLive(state) || state.screen !== 'join') return state;
  const code = typeRoomCode(state.code, key);
  if (code === state.code) return state;
  return { ...state, code, status: 'idle', error: '' };
}

/** Erase the last character (the pad's back key, or Backspace). */
export function eraseEntryCode(state: EntryState): EntryState {
  if (!entryLive(state) || state.screen !== 'join' || state.code === '') return state;
  return { ...state, code: eraseRoomCode(state.code), status: 'idle', error: '' };
}

/** Whether the typed code is long enough to send a `join` for. */
export function canSubmitJoin(state: EntryState): boolean {
  return entryLive(state) && state.screen === 'join' && isJoinableRoomCode(state.code);
}

/**
 * Send the typed code.
 *
 * A short code is refused *here*, with a sentence, rather than sent for the
 * server to refuse with a round trip — the player is mid-typo and the fix is one
 * more key. A complete code is normalised through the same {@link normalizeRoomCode}
 * the wire uses, so a code this returns is a code the server will accept.
 */
export function submitJoin(state: EntryState): EntryResult {
  if (!entryLive(state) || state.screen !== 'join') return { state, intent: null };
  const room = normalizeRoomCode(state.code);
  if (!room || !isJoinableRoomCode(room)) {
    return { state: { ...state, status: 'error', error: ENTRY_ERRORS.short }, intent: null };
  }
  return {
    state: { ...state, status: 'connecting', error: '' },
    intent: { door: 'join', room, online: true },
  };
}

// ---------------------------------------------------------------------------
// How an attempt ends
// ---------------------------------------------------------------------------

/**
 * The transport refused, dropped, or timed out. The screen comes back to life
 * with the reason on it and **the code still typed**: a room that was full a
 * moment ago is worth one more try, and re-typing four characters to find that
 * out is a punishment for the server's behaviour.
 */
export function entryFailed(state: EntryState, reason: string = ENTRY_ERRORS.offline): EntryState {
  return { ...state, status: 'error', error: reason };
}

/** The transport is up and the lobby owns the screen. Returns the entry screen
 *  to rest so that leaving a match lands on a clean home. */
export function entryConnected(): EntryState {
  return createEntry();
}

/**
 * Turn an allocator {@link ResolveFailure} (`src/net/allocator-client`) into the
 * line this screen shows — the caller feeds it straight to {@link entryFailed}.
 *
 * The three failures the M3 brief keeps apart get three different sentences
 * calling for three different actions (never one "connection failed"): the fleet
 * is full (retry later), no room has that code (fix the code), or the servers
 * cannot be reached (retry, and PLAY SOLO still works). The mapping itself lives
 * in {@link ./online-copy} so this door and the in-match connection overlay say
 * the same words for the same reason.
 */
export function entryErrorFor(reason: ResolveFailure): string {
  return resolveFailureMessage(reason);
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** One door button, as the view draws it. */
export interface EntryDoorView extends EntryDoorOption {
  /** Dead while an attempt is in flight. */
  readonly enabled: boolean;
}

/** One code cell — a typed character, or the empty box waiting for one. */
export interface EntryCodeCell {
  readonly char: string;
  readonly filled: boolean;
  /** The cell the next key lands in, so the view can mark the caret. */
  readonly active: boolean;
}

/** The entry screen for one frame. */
export interface EntryModel {
  readonly screen: EntryScreen;
  /** The three doors — drawn on `home`. */
  readonly doors: readonly EntryDoorView[];
  /** {@link ROOM_CODE_LENGTH} cells — drawn on `join`. */
  readonly cells: readonly EntryCodeCell[];
  readonly keys: readonly string[];
  readonly canErase: boolean;
  readonly canSubmit: boolean;
  readonly connecting: boolean;
  /** The failure line, or `''`. Drawn in threat red — the one place on this
   *  screen that colour is allowed to mean something (style-guide §2). */
  readonly error: string;
  /** The line under the title: what the player is being asked to do. */
  readonly prompt: string;
}

/** Build the frame model. Pure: the view draws exactly this and decides nothing. */
export function entryModel(state: EntryState): EntryModel {
  const live = entryLive(state);
  const cells: EntryCodeCell[] = [];
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const char = state.code[i] ?? '';
    cells.push({ char, filled: char !== '', active: i === state.code.length });
  }
  return {
    screen: state.screen,
    doors: DOOR_OPTIONS.map((option) => ({ ...option, enabled: live })),
    cells,
    keys: KEYPAD_KEYS,
    canErase: live && state.code.length > 0,
    canSubmit: canSubmitJoin(state),
    connecting: state.status === 'connecting',
    error: state.error,
    prompt: entryPrompt(state),
  };
}

/** The line under the wordmark. Says what to do, and — while connecting — what
 *  is being waited on, so a slow server never reads as a dead screen. */
function entryPrompt(state: EntryState): string {
  if (state.status === 'connecting') return 'CONNECTING…';
  return state.screen === 'join' ? 'ENTER THE ROOM CODE' : 'STATION RUSH';
}

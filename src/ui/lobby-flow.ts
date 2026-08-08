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
 * ONE DOOR, ONE LOBBY (ratified — the unified play flow)
 * ---------------------------------------------------------------------------
 * There is exactly one entry point and exactly one lobby. The main menu's PLAY
 * opens {@link ./lobby-entry} — SOLO CONTRACT / OPEN A CLAIM / JOIN A CLAIM — and all
 * three of those doors resolve into the same {@link ./lobby} through the same
 * {@link flowConnected}. The single difference between "the solo lobby" and "the
 * online lobby" is the `online` flag the door already decided, which the lobby
 * uses to show the room code and mark seats claimable. There is no second lobby
 * component and no feature that exists in one mode and not the other — a mode is a
 * flag on a screen, not a screen.
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

import type { PlayerId, Rng } from '@shared/types';
import { ShipClass } from '@shared/types';
import { FireMode } from '@platform/actions';
import type { ClientMessage, FireMode as WireFireMode, LobbySlot, RoomCode } from '../net/transport';
import type { EntryTarget, LobbyTarget } from './lobby-geometry';
import { adjustVolume, createSettings, toggleReduceVfx } from './settings';
import type { ControlScheme, SettingsState, SettingsTarget } from './settings';
import { endButtons } from './end-of-match';
import type { EndTarget, MatchOutcome } from './end-of-match';
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
  lobbyWireTeams,
  createLobby,
  cycleAbundance,
  cycleSeatCharacter,
  cycleSeatState,
  cycleSeatTeam,
  pressRush,
  seatLocalPlayer,
  selectMap,
  selectShipClass,
  sideRosterOf,
  startLobbyMatch,
  tickLobby,
  toggleMode,
} from './lobby';
import type { LobbyState } from './lobby';
import { mapIdAt } from './map-picker';

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/**
 * Which screen owns the display.
 *
 *  - `entry`    — the doors and the keypad ({@link ./lobby-entry-view}).
 *  - `settings` — the fire mode, reduce-VFX and volumes ({@link ./settings-view}),
 *                 reached from the main menu and returned from to wherever it was
 *                 opened ({@link FlowState.settingsReturn}).
 *  - `lobby`    — the roster, the hulls and RUSH! ({@link ./lobby-view}).
 *  - `match`    — the world has the screen; this module is watching for the end.
 *  - `end`      — the end-of-match summary ({@link ./end-of-match-view}): VICTORY /
 *                 DEFEAT / DRAW / ELIMINATED, with Rematch and maybe Spectate.
 */
export type FlowScreen = 'entry' | 'settings' | 'lobby' | 'match' | 'end';

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
  /** The fire mode sent with every `lobbyChoice`. The value the settings screen
   *  toggles, carried here because it rides the wire — one home, no drift. */
  readonly fireMode: FireMode;
  /** The rest of the player's settings — reduce VFX and the three volumes. Always
   *  present; survives a rematch ({@link resetFlow}), because a setting is not
   *  match state. */
  readonly settings: SettingsState;
  /** How the player drives the ship (developer §3): `'sticks'` or Tap Commander.
   *  Held here beside the fire mode — the settings screen's other how-it-plays
   *  toggle — but unlike the fire mode it never rides the wire (it is a purely
   *  local input scheme), so changing it costs the lobby nothing. Survives a
   *  rematch ({@link resetFlow}). */
  readonly controlScheme: ControlScheme;
  /** The end-of-match outcome, once a match has ended. Null on every other
   *  screen; the {@link ./end-of-match} summary is built from it. */
  readonly end: MatchOutcome | null;
  /** True while watching a match you are no longer playing (chose Spectate on the
   *  elimination summary). Purely a display flag: the world is unchanged. */
  readonly spectating: boolean;
  /** Where DONE on the settings screen returns to — the screen it was opened
   *  from. The main menu is `entry`; a future pause menu would set `match`. */
  readonly settingsReturn: FlowScreen;
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
  | { readonly kind: 'send'; readonly message: ClientMessage }
  /**
   * Close the transport and forget the room — BACK out of a lobby that had one
   * (u2 item 4: "BACK from the online lobby leaves the room cleanly … no ghost
   * rooms"). Emitted only when the lobby being left was online: leaving the socket
   * open would hold a seat nobody is in, and an unemptied room keeps a code the
   * classroom can still type and nobody is behind. Offline there is nothing to
   * close, so nothing is asked for.
   */
  | { readonly kind: 'close-transport' };

/** A transition, plus whatever it owes the outside world. */
export interface FlowResult {
  readonly state: FlowState;
  readonly effects: readonly FlowEffect[];
}

const NO_EFFECTS: readonly FlowEffect[] = [];

/** A flow resting on a clean entry screen. Fire mode and the rest of settings
 *  carry in, so a rematch keeps a player's choices ({@link resetFlow}). */
export function createFlow(
  fireMode: FireMode = FireMode.Manual,
  settings: SettingsState = createSettings(),
  controlScheme: ControlScheme = 'sticks',
): FlowState {
  return {
    screen: 'entry',
    entry: createEntry(),
    lobby: null,
    room: null,
    online: false,
    fireMode,
    settings,
    controlScheme,
    end: null,
    spectating: false,
    settingsReturn: 'entry',
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
      // The match SHAPE, from the host only (m10 teams-wire): the MODE and the
      // per-SLOT side. It rides every choice for the same reason the difficulties
      // do — `lobbyState` is broadcast on any change, so a roster showing a split
      // the server was never told about is a roster that lies about the match being
      // built. A side authored and never sent is the whole of the developer's
      // report: a lobby that says TEAMS over a free-for-all world.
      ...(host ? { mode: lobby.mode, teams: lobbyWireTeams(lobby) } : {}),
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
    case 'settings':
      // The fourth main-menu option opens a screen, not a room — no transport,
      // no code, just the settings the player already has in hand.
      return flowOpenSettings(state);
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
  // Escape backs out of the settings screen the way DONE does — the one key the
  // settings screen listens for, since everything else on it is a tap.
  if (state.screen === 'settings') return key === 'Escape' ? flowCloseSettings(state) : rest(state);
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
  // ONE lobby component, both modes (ratified): the same `createLobby` opens the
  // solo room and the online one, and the ONLY thing that differs is the flag the
  // door already resolved — `online: false` for SOLO CONTRACT (no room code, the empty
  // seats are the bot cast), `true` for CREATE / JOIN (code up, seats claimable).
  // Every other affordance — hulls, map, mode, abundance, slot states, difficulty,
  // teams, RUSH — is the same model function in both, which is the property the
  // affordance-set guard in `./lobby-flow.test.ts` holds us to.
  const lobby = seatLocalPlayer(createLobby({ room, you, host, online: state.online }), you, host);
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
    case 'seat': {
      // **The row BODY cycles the seat's CHARACTER** (a0-06). The body is where the
      // row draws the name, so the tap that lands on a name is the tap that changes
      // it — and the state cycle lost nothing for it, because it has had its own
      // drawn, labelled, leading control since u5 (the case below).
      //
      // A CLOSED row is the exception and it is one rule, not a special case: the
      // body edits whatever the row is showing, and a closed row shows no character
      // at all, so a tap there re-opens the seat exactly as it always did. Every
      // other refusal — a guest, a human seat, a lobby past RUSH! — is a no-op in
      // `./lobby` that returns the identical object, so it costs the wire zero.
      const seat = lobby.seats[target.index];
      return withLobby(
        state,
        seat && seat.occupant === 'closed'
          ? cycleSeatState(lobby, target.index)
          : cycleSeatCharacter(lobby, target.index),
      );
    }
    case 'seatState':
      // The seat's OPEN → BOT → CLOSED cycle (variable-slots Milestone E); the host
      // shrinks or shapes the match here, through the drawn, labelled button that
      // finally SAYS a slot can be closed (u5 — the developer could not tell that it
      // could). A guest's tap and a human seat are no-ops in `./lobby`, so a refused
      // tap costs the wire zero.
      return withLobby(state, cycleSeatState(lobby, target.index));
    case 'seatHelp':
      // The row's trailing `?` — the codex dossier for that seat's character
      // (a0-06). It changes no lobby state at all: it is a screen the WIRING opens
      // (`main.ts` `openLobby`), the way the hull tiles' hover hint is, so there is
      // nothing here to fold in and nothing to send.
      return rest(state);
    case 'seatTeamChip':
      // The row's TEAM chip — the side cycle, composed alongside the difficulty
      // chip in TEAMS (n2). A no-op outside TEAMS (FFA is teams-of-one) and from a
      // guest, both refused in `./lobby`, so a tap there costs the wire nothing.
      return withLobby(state, cycleSeatTeam(lobby, target.index));
    case 'mode':
      // FFA ⇄ TEAMS. Locked with the hull once RUSH! is pressed (`./lobby`).
      return withLobby(state, toggleMode(lobby));
    case 'abundance':
      // SCARCE → STANDARD → RICH (ratified p11). Locked with the hull at RUSH!.
      return withLobby(state, cycleAbundance(lobby));
    case 'map':
      // The arena picker moved into the lobby (p2). Folded in like the hull; a
      // refusal (locked after RUSH!) returns the identical lobby, so `withLobby`
      // sends nothing. The arena is not yet in the wire protocol, so an online
      // room ignores the re-sent choice — offline is where the pick has teeth.
      return withLobby(state, selectMap(lobby, mapIdAt(target.index)));
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
    case 'leave': {
      // BACK — leave the lobby (u2 menu-back). Backing out of a room returns to the
      // doors with the lobby dropped — the same shape {@link flowFailed} uses. When
      // the room was ONLINE the caller is also owed a `close-transport`: the seat
      // has to be freed and the room allowed to deallocate, or the code stays live
      // with nobody behind it (u2 item 4). Offline there is no socket to close, so
      // the effect list stays empty and BACK costs the wire nothing.
      const next: FlowState = { ...state, screen: 'entry', entry: entryConnected(), lobby: null };
      return lobby.online ? { state: next, effects: [{ kind: 'close-transport' }] } : rest(next);
    }
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
 *  world; this module's job is to get off the lobby screen (rule 3) and clear any
 *  summary a previous match left, so a fresh match never opens over a stale end
 *  screen or an inherited spectate flag. */
export function flowMatchStart(state: FlowState): FlowResult {
  const fresh = { ...state, screen: 'match' as const, end: null, spectating: false };
  if (!state.lobby) return rest(fresh);
  return rest({ ...fresh, lobby: startLobbyMatch(state.lobby) });
}

// ---------------------------------------------------------------------------
// Settings — the fourth main-menu screen
// ---------------------------------------------------------------------------

/**
 * Open the settings screen, remembering where to return. Reachable from the main
 * menu today ({@link flowTapEntry} `settings`); the `settingsReturn` it records
 * is what lets a future pause menu open the same screen and land back in the
 * match. A no-op from anywhere the player cannot have pressed a settings button.
 */
export function flowOpenSettings(state: FlowState): FlowResult {
  if (state.screen !== 'entry' && state.screen !== 'match') return rest(state);
  return rest({ ...state, screen: 'settings', settingsReturn: state.screen });
}

/** Leave the settings screen for wherever it was opened from. DONE and Escape
 *  both land here; the changes are already applied, so there is nothing to
 *  confirm or discard. */
export function flowCloseSettings(state: FlowState): FlowResult {
  if (state.screen !== 'settings') return rest(state);
  return rest({ ...state, screen: state.settingsReturn });
}

/**
 * Apply a tap on the settings screen — from {@link ./settings} `settingsHitTest`.
 *
 * Every change is applied on the spot (there is no cancel), and none of them
 * costs the wire anything on the main menu, where there is no lobby to tell. If
 * the fire mode is ever changed from a pause menu mid-lobby, the lobby is owed a
 * fresh `lobbyChoice`, so that one case re-sends it — the same rule
 * {@link withLobby} keeps for a hull.
 */
export function flowTapSettings(state: FlowState, target: SettingsTarget): FlowResult {
  if (state.screen !== 'settings') return rest(state);
  switch (target.kind) {
    case 'back':
      return flowCloseSettings(state);
    case 'fireMode':
      return applyFireMode(state, state.fireMode === FireMode.AutoAim ? FireMode.Manual : FireMode.AutoAim);
    case 'controls':
      // Toggle the scheme. Unlike the fire mode it never touches the wire — it is
      // a local input scheme the sim never sees — so this only folds into state.
      return rest({ ...state, controlScheme: state.controlScheme === 'tap' ? 'sticks' : 'tap' });
    case 'reduceVfx':
      return foldSettings(state, toggleReduceVfx(state.settings));
    case 'volume':
      return foldSettings(state, adjustVolume(state.settings, target.channel, target.dir));
  }
}

/** Fold a new settings value in, staying identical on a no-op so a slider against
 *  its stop stops churning state. Settings other than fire mode never touch the
 *  wire, so this emits nothing. */
function foldSettings(state: FlowState, settings: SettingsState): FlowResult {
  return settings === state.settings ? rest(state) : rest({ ...state, settings });
}

/** Set the fire mode, re-sending the lobby's choice only if there is a lobby to
 *  hear it (the pause-menu case). On the main menu there is none, so nothing goes
 *  out — the mode simply rides the next `lobbyChoice` when a room opens. */
function applyFireMode(state: FlowState, fireMode: FireMode): FlowResult {
  if (state.fireMode === fireMode) return rest(state);
  const next = { ...state, fireMode };
  return next.lobby ? { state: next, effects: [choiceFor(next, next.lobby)] } : rest(next);
}

// ---------------------------------------------------------------------------
// The end of a match
// ---------------------------------------------------------------------------

/**
 * The whole match resolved (`matchEnd`, `src/net/transport.ts`). Moves to the
 * summary with the winner named — VICTORY if the winner is on **your side**,
 * DEFEAT if they are not, DRAW on the no-survivor end. Only from a live match: a
 * `matchEnd` arriving on the door or twice over is ignored.
 *
 * `you` **and your side** are read from the lobby the match was built from, so the
 * summary knows whose result it is showing without a wire field for either. That
 * is legal because allegiance is static match config fixed at match start (GDD
 * §2.1, §4.2) — the roster that RUSHed is the roster that finished.
 *
 * The side is the a0-09 fix on this path: without it a Teams win by a teammate
 * arrived here indistinguishable from an enemy's, and the summary called it a
 * DEFEAT ({@link ./end-of-match} `endKind`). In FFA `sideRosterOf` returns you
 * alone, so nothing about the free-for-all changes.
 */
export function flowMatchEnded(state: FlowState, winner: PlayerId | null): FlowResult {
  if (state.screen !== 'match') return rest(state);
  const you = state.lobby?.you ?? 0;
  const allies = sideOf(state, you);
  return rest({ ...state, screen: 'end', end: { you, winner, matchOver: true, allies } });
}

/**
 * Your core was destroyed but the match goes on (GDD §2 wreck rule). Moves to the
 * summary in its ELIMINATED form — Rematch and Spectate, because there is still a
 * match to watch. Only from a live match.
 *
 * It carries the side too, even though ELIMINATED does not read it: this outcome
 * is the one a player SPECTATES from, and the `matchEnd` that follows lands on
 * {@link flowMatchEnded} — but a seat whose side wins while it watches must reach
 * VICTORY by the same roster it was eliminated holding, not a re-derived one.
 */
export function flowEliminated(state: FlowState): FlowResult {
  if (state.screen !== 'match') return rest(state);
  const you = state.lobby?.you ?? 0;
  const allies = sideOf(state, you);
  return rest({ ...state, screen: 'end', end: { you, winner: null, matchOver: false, allies } });
}

/** The slots on `you`'s side, for the outcome the two ends above build. Straight
 *  through to the lobby's own roster ({@link ./lobby} `sideRosterOf`); with no
 *  lobby to read there is no side but your own — teams-of-one, which is FFA. */
function sideOf(state: FlowState, you: PlayerId): ReadonlySet<PlayerId> {
  return state.lobby ? sideRosterOf(state.lobby, you) : new Set([you]);
}

/**
 * A tap on the end-of-match summary — from {@link ./end-of-match}
 * `endOfMatchHitTest`.
 *
 *  - **Rematch** tears the world down to a clean door ({@link resetFlow}),
 *    keeping the player's settings. This is the "resets the world cleanly" path.
 *  - **Spectate** dismisses the summary and returns to watching the still-live
 *    match, flagged as a spectator. Refused when the outcome did not offer it (a
 *    whole-match-over screen has nothing left to watch), so a stale tap cannot
 *    strand the player on an empty match screen.
 */
export function flowTapEnd(state: FlowState, target: EndTarget): FlowResult {
  if (state.screen !== 'end' || !state.end) return rest(state);
  if (target.kind === 'rematch') return rest(resetFlow(state));
  if (!endButtons(state.end).includes('spectate')) return rest(state);
  return rest({ ...state, screen: 'match', spectating: true, end: null });
}

/** Settings changed the fire mode. Carried into the next `lobbyChoice` rather
 *  than sent on its own — the lobby is not the fire mode's authority, it is
 *  just the message the fire mode happens to ride in before a match. */
export function setFlowFireMode(state: FlowState, fireMode: FireMode): FlowState {
  return state.fireMode === fireMode ? state : { ...state, fireMode };
}

/** Leave the match and come back to a clean door — Rematch's way out, and the
 *  reset the end-of-match summary performs. Deliberately a full reset: a stale
 *  roster behind a new door is how a player ends up looking at the previous
 *  match's colours. Fire mode, the control scheme and the rest of settings survive
 *  it — they are the player's, not the match's. */
export function resetFlow(state: FlowState): FlowState {
  return createFlow(state.fireMode, state.settings, state.controlScheme);
}

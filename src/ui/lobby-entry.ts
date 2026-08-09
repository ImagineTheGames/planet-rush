/**
 * src/ui/lobby-entry.ts — the door into a room. OWNER: UI Engineer.
 *
 * The screen *before* {@link ./lobby}: the three ways a match is entered
 * (GDD §2.1, §4.2), and the on-screen pad a room code is typed on.
 *
 *   CAMPAIGN  not built yet. It answers `Coming Soon…` and goes nowhere.
 *   SOLO      no server, no code to read out — bots fill all eight seats.
 *   HOST      a fresh code, generated here and shown for the room to read.
 *   JOIN      type the code somebody else is holding up.
 *
 * Those four words are **plain by ratification** and are not the voice's to take
 * (a0-15, 2026-08-07). The developer, reading the sweep's labels on the entry
 * screen: *"you took this too far, its too complicated, you can switch it back to
 * how it was CAMPAIGN, SOLO, HOST, JOIN... its way too complex for new players to
 * understand"*. The front door is the one screen a player meets before they know
 * anything, so it says what the button does and nothing else — the exception is
 * recorded in `docs/copy-sweep-industrial-voice.md` §0 and
 * `docs/lore-copy-sweep.md` §0 so the next voice pass reads it before touching
 * these strings. The in-match copy the sweep wrote is untouched.
 *
 * **This is the one and only front door** (ratified: one play flow). The main
 * menu's PLAY opens *this* screen — there is no second entry point that skips it —
 * and all three PLAYABLE doors land in the SAME lobby ({@link ./lobby}): SOLO opens
 * it offline, CREATE opens it online with the room code up while the host
 * configures, JOIN opens it online as a guest watching the seats fill. One screen
 * decides how you get in; one screen decides what the match is.
 *
 * ---------------------------------------------------------------------------
 * WHY CAMPAIGN IS A DOOR AND NOT A GREYED BUTTON (u9-01, 2026-08-06)
 * ---------------------------------------------------------------------------
 * The developer asked for a CAMPAIGN button above SOLO that says `Coming Soon…`
 * when you press it. That is deliberately *not* {@link EntryDoorView.enabled}
 * `false`: this screen already has a disabled state and it means one specific
 * thing — **"needs a server and there isn't one"** — drawn in the shared dim
 * tokens ({@link ./button-theme}), which by the ratified p4-03 rule must always
 * carry their reason. A door that is greyed for a *different* reason would be a
 * second meaning wearing the first one's costume, and a teaser that greys out
 * reads as broken rather than as unbuilt.
 *
 * So {@link EntryDoorOption.comingSoon} is its own concept, sitting beside
 * {@link EntryDoorOption.needsNetwork}: the door is live, full-contrast and
 * tappable, and pressing it puts {@link ENTRY_COMING_SOON} in the screen's one
 * message slot ({@link EntryState.notice}). It opens no transport, moves no
 * screen and strands nobody — the next press of any door behaves exactly as it
 * always did, and the notice clears the moment something else is asked for.
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
import type { PlateRole, PlateScale, PlateState } from '../art/materials';
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
// The four doors
// ---------------------------------------------------------------------------

/**
 * A way into a match — or, for `campaign`, a way the screen says there is not one
 * yet. Ordered as the screen offers them: the one that is coming, then the one
 * that always works, then the one that starts a room, then the one that needs
 * someone else to have started one.
 */
export type EntryDoor = 'campaign' | 'solo' | 'create' | 'join';

/**
 * Door order, top to bottom (and, where the band is too short to stack four,
 * down the leading column first — `./lobby-geometry` `placeDoors` fills
 * column-major, exactly as the lobby roster does, so **CAMPAIGN is above SOLO in
 * every shape this screen has**).
 */
export const DOOR_ORDER: readonly EntryDoor[] = ['campaign', 'solo', 'create', 'join'];

/** One door, as the button reads. Words only — this screen has no numbers. */
export interface EntryDoorOption {
  readonly door: EntryDoor;
  /** The button's word (Audiowide, style-guide §7). */
  readonly label: string;
  /** The one line under it that says what it costs you. */
  readonly hint: string;
  /** Whether it needs a server. SOLO does not — which is the whole point. */
  readonly needsNetwork: boolean;
  /**
   * Whether the door is a **teaser**: present, lit and pressable, but not built
   * yet. Pressing it says {@link ENTRY_COMING_SOON} and does nothing else.
   *
   * Deliberately separate from the disabled state (see the file header): dim is
   * this screen's word for "needs a server and there isn't one", and it always
   * owes a reason. A teaser is not refused — it is answered.
   */
  readonly comingSoon: boolean;
}

/** What a {@link EntryDoorOption.comingSoon} door says when it is pressed. The
 *  developer's own words, verbatim (u9-01, 2026-08-06), with the ellipsis
 *  character the rest of the screen already uses (`CONNECTING…`). */
export const ENTRY_COMING_SOON = 'Coming Soon…';

/** The four doors (GDD §2.1, §4.2, §4.8; CAMPAIGN added u9-01). */
export const DOOR_OPTIONS: readonly EntryDoorOption[] = [
  {
    // Above SOLO, per the developer's report. It is FIRST because that is where it
    // was asked for, and it costs SOLO nothing: SOLO is still one press from a cold
    // screen, and it is still the only door drawn as the affirmative action.
    door: 'campaign',
    label: 'CAMPAIGN',
    hint: 'A run of linked contracts, one claim after another.',
    needsNetwork: false,
    comingSoon: true,
  },
  {
    door: 'solo',
    label: 'SOLO',
    // The hint says what happens when you press it, in the order it happens:
    // you play, the opponents are bots, and it works with no connection. The
    // offline fact is the one this line may never lose (GDD §4.8 risk 6), so it
    // is stated as the plainest available sentence rather than in the register's
    // word for it ("Offline.") — a player who has to infer that "offline" means
    // "this one still works on the school wifi" has been told nothing.
    //
    // 49 chars. GDD §4.7: "Length is part of clarity… Measure before you ship
    // it", and this exact hint is the one label in the game that has actually
    // overflowed — the sweep's 70-char version drew 462px into a 420px door and
    // nothing truncates (`drawDoor` centres and lets it spill), so the overflow
    // was silent. The budget is 63 characters at 11px (420 / 6.601 px-per-char,
    // Liberation Mono at 0.6em); tests/mobile/voice-copy-fit.spec.ts measures it
    // in the booted page and prints the headroom.
    hint: 'Play on your own against bots. No internet needed.',
    needsNetwork: false,
    comingSoon: false,
  },
  {
    door: 'create',
    // HOST and JOIN are the two halves of one mechanic, so their hints are
    // written as a pair: this one MAKES the code, that one TYPES it. The code is
    // the single thing on this screen a first-time player cannot guess at, which
    // is why both lines spend their words on it and on nothing else.
    label: 'HOST',
    hint: 'Start a new game and get a code for friends to join.',
    needsNetwork: true,
    comingSoon: false,
  },
  {
    door: 'join',
    label: 'JOIN',
    hint: 'Type in a friend’s code to join their game.',
    needsNetwork: true,
    comingSoon: false,
  },
];

/** The option a door reads by, or `undefined` for a door that is not offered. */
export function doorOption(door: EntryDoor): EntryDoorOption | undefined {
  return DOOR_OPTIONS.find((option) => option.door === door);
}

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
  /**
   * The screen's standing ANSWER, as opposed to its refusal: today the one thing
   * it is {@link ENTRY_COMING_SOON}, said because a teaser door was pressed. `''`
   * when there is nothing to answer.
   *
   * Kept apart from {@link error} because the two are drawn differently and mean
   * different things — an error is threat red because something is genuinely
   * wrong (style-guide §2), and a door that is not built yet is not wrong. It is
   * cleared by the next thing the player asks for, so it can never outlive the
   * press it answered.
   */
  readonly notice: string;
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
  short: `A claim code is ${ROOM_CODE_LENGTH} characters.`,
  /** The server has no such claim (it creates unknown codes, so this is a typo
   *  the server declined rather than a claim that vanished).
   *
   *  Duplicated verbatim in `./online-copy` `ONLINE_COPY.notFound` — the two must
   *  agree, and `lobby-entry.test.ts` pins that they do. */
  unknown: 'No claim with that code. Check it and try again.',
  /** Eight seats, all taken (`./lobby` LOBBY_SLOTS). Names the door it sends the
   *  player to, because that door is on the screen this line is drawn over —
   *  "take a solo contract" was the sweep's way of saying it, and it named the
   *  old label in lower case (a0-15). */
  full: 'That claim is full. Ask for a rematch, or press SOLO.',
  /** No server, or no internet. Names the door that still works — so it moves
   *  whenever {@link DOOR_OPTIONS} does (`voice-door-labels.test.ts`). */
  offline: 'Cannot reach the server. SOLO still works.',
} as const;

/** A fresh entry screen: the home doors, nothing typed, nothing wrong. */
export function createEntry(): EntryState {
  return { screen: 'home', code: '', status: 'idle', error: '', notice: '' };
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
 * CAMPAIGN answers and stays put — it is not built yet, so it mints no code,
 * opens no transport and does not move the screen; it puts
 * {@link ENTRY_COMING_SOON} in {@link EntryState.notice} and that is the whole of
 * it. SOLO and CREATE resolve immediately — both need a room code and neither
 * needs the player to know one, so the code is drawn here from the ratified
 * seeded PRNG (`mulberry32`, never `Math.random()`), exactly as
 * {@link makeRoomCode} documents. JOIN has nothing to resolve yet: it opens the
 * keypad.
 *
 * Every door clears a standing notice on the way past, so the answer CAMPAIGN
 * gave can never be left sitting over a screen that has since moved on.
 *
 * A no-op while an earlier attempt is still connecting.
 */
export function chooseDoor(state: EntryState, door: EntryDoor, rng: Rng): EntryResult {
  if (!entryLive(state)) return { state, intent: null };
  if (doorOption(door)?.comingSoon) {
    // Answered, not refused: no screen change, no code, no intent for the caller
    // to open a transport with. Pressing it twice says the same thing twice.
    if (state.notice === ENTRY_COMING_SOON && state.error === '') return { state, intent: null };
    return { state: { ...state, status: 'idle', error: '', notice: ENTRY_COMING_SOON }, intent: null };
  }
  if (door === 'join') {
    return {
      state: { ...state, screen: 'join', code: '', status: 'idle', error: '', notice: '' },
      intent: null,
    };
  }
  const room = makeRoomCode(rng);
  return {
    state: { ...state, status: 'connecting', error: '', notice: '' },
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
  // A refusal takes the message slot from a standing notice: one line, and the
  // thing that is actually wrong is the one that gets to use it.
  return { ...state, status: 'error', error: reason, notice: '' };
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
 * cannot be reached (retry, and SOLO still works). The mapping itself lives
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
  /**
   * Whether this is the screen's ONE headline action (u7-04). SOLO, and only
   * SOLO: it is the door that always works with no server (GDD §4.8 risk 6).
   * Under Gantry/Bone that is not a colour — the primary is simply the biggest and
   * brightest plate, and it *must never share a screen with a second bright plate*
   * ({@link ./gantry} `singlePrimary`).
   */
  readonly primary: boolean;
  /** The plate material and size this door is drawn at ({@link doorPlate}). */
  readonly role: PlateRole;
  readonly scale: PlateScale;
  /** Rest / hover / press — the handoff's three plate states, driven by the
   *  wiring layer's pointer routing. Touch never hovers, so on a phone this is
   *  only ever `rest` or `press`. */
  readonly state: PlateState;
}

/**
 * The plate role and size a door is drawn at.
 *
 * ---------------------------------------------------------------------------
 * WHY CAMPAIGN IS A `secondary` PLATE AND NEVER AN `inert` ONE (u7-04)
 * ---------------------------------------------------------------------------
 * The re-skin had one way to get the CAMPAIGN teaser wrong, and it is the same
 * mistake u9-01 was written against in a new material: `inert` is Gantry's word
 * for *a surface that holds content rather than inviting a press* — a settings
 * row, an unselected ship. A teaser drawn as a surface would read as unpressable,
 * which is the greyed-out door that brief exists to prevent, wearing a bevel.
 *
 * So CAMPAIGN takes exactly the same material as HOST and JOIN:
 * `secondary`, full contrast, raised off the screen with a bezel and a cast
 * shadow, and pressable — because pressing it is how the screen answers.
 */
export function doorPlate(option: EntryDoorOption): {
  primary: boolean;
  role: PlateRole;
  scale: PlateScale;
} {
  // The offline door is the primary (it always works — risk 6); every other door,
  // teaser or not, is an equally-active secondary.
  const primary = !option.needsNetwork && !option.comingSoon;
  return primary
    ? { primary: true, role: 'primary', scale: 'hero' }
    : { primary: false, role: 'secondary', scale: 'standard' };
}

/**
 * What the pointer is doing on the entry screen: which control it is over, and
 * which (if any) it is holding down — each as a {@link ./lobby-geometry}
 * `entryTargetKey`, so the model never has to know what a rect is.
 */
export interface EntryPointer {
  readonly hover?: string | null;
  readonly press?: string | null;
}

/**
 * One control's plate state. A press outranks a hover on the same plate (a finger
 * that is down is not hovering), and a plate that is neither is at rest — the same
 * rule {@link ./main-menu} `mainMenuModel` keeps, stated once so the two front
 * doors cannot disagree about what a press looks like.
 */
export function entryPlateState(model: EntryModel, key: string): PlateState {
  if (model.press === key) return 'press';
  if (model.hover === key) return 'hover';
  return 'rest';
}

/**
 * The live connect narration, handed in by whoever owns the transport
 * (`src/main.ts`, from `src/net/connect-trace` `connectTitleLine`).
 *
 * This screen has never known what a socket is doing and still does not: it is
 * given a line and a flag, and it puts the line in its title. That keeps the
 * developer's ask — *"show it at the top where it says CONNECTING"* — a change of
 * one string, and keeps `src/ui/` free of the netcode it must never import.
 */
export interface EntryNarration {
  /** The line the title shows, e.g. `ROOM Q5RN · TICKET SIGNED`. */
  readonly line: string;
  /** True when that line is a refusal or a failure — the title's cue for red. */
  readonly failed: boolean;
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
  /** The answer line, or `''` — today only {@link ENTRY_COMING_SOON}, from a press
   *  on a teaser door. Shares the message slot with {@link prompt} and yields it to
   *  {@link error} and to a live narration: nothing being built yet is never the
   *  most urgent thing the screen has to say. Never red — nothing is wrong. */
  readonly notice: string;
  /** The title line: what the player is being asked to do, or — while a connect is
   *  running — what the connection is actually doing right now. */
  readonly prompt: string;
  /** True when {@link prompt} is a live connect narration rather than the screen's
   *  own standing line, so the view can draw it as the *title* it now is: bigger,
   *  lit, and with the wordmark stepping back behind it. */
  readonly narrating: boolean;
  /**
   * The header beam's eyebrow cluster (u7-04): the authority above, this screen's
   * own standing status below — the title screen's construction, because this is
   * the title screen's other half and the letterhead does not change between them.
   */
  readonly eyebrow: string;
  readonly status: string;
  /** The control the pointer is over / holding, as a `entryTargetKey` — read
   *  through {@link entryPlateState} rather than compared by the view directly. */
  readonly hover: string | null;
  readonly press: string | null;
}

/**
 * The header beam's first line: the authority, verbatim from the title screen
 * ({@link ./main-menu} `MAIN_MENU_EYEBROW`). It is a letterhead — the same mining
 * authority runs both screens — so repeating it is the point, not drift, and it
 * invents no copy while `docs/copy-sweep-industrial-voice.md` Q1 is still open.
 */
export const ENTRY_EYEBROW = 'DEEP FIELD MINING AUTHORITY';

/**
 * …and its second line, which is this screen's own state. The handoff labels that
 * panel `ROOM CODE`; l2-02 files it as `CLAIM CODE`, because this string landed
 * (u7-04's header beam) after the sweep had already read this file, and left the
 * keypad saying `ROOM CODE` two lines above its own `ENTER THE CLAIM CODE`. One
 * screen cannot hold both vocabularies. It invents nothing: `CLAIM` is the
 * ratified fiction word and `CODE` stays `CODE`, which is the sweep's hard limit —
 * a player types four characters read off somebody else's screen. The doors carry
 * the title screen's standing contract line unchanged, because the doors screen is
 * where that contract is taken up.
 */
export const ENTRY_STATUS = {
  home: 'CONTRACT OPEN · SECTOR 04',
  join: 'CLAIM CODE',
} as const;

/**
 * Build the frame model. Pure: the view draws exactly this and decides nothing.
 *
 * `narration`, when present, **takes the title**. It replaces the static
 * `CONNECTING…` that used to sit there from the first tap to the last, and on a
 * failure it replaces the screen's own error line too — because the narration's
 * last step *is* the failure, said exactly (`REFUSED: bad-ticket — machine
 * mismatch`), and two sentences about one refusal is the duplicate surface this
 * whole change exists to delete. With no narration the screen behaves exactly as it
 * always has, which is what SOLO and a mistyped room code still want.
 */
export function entryModel(
  state: EntryState,
  narration: EntryNarration | null = null,
  pointer: EntryPointer = {},
): EntryModel {
  const live = entryLive(state);
  const cells: EntryCodeCell[] = [];
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const char = state.code[i] ?? '';
    cells.push({ char, filled: char !== '', active: i === state.code.length });
  }
  // An empty narration line is no narration at all — a trace that has not taken
  // its first step yet must not blank the title.
  const told = narration !== null && narration.line !== '' ? narration : null;
  const hover = pointer.hover ?? null;
  const press = pointer.press ?? null;
  return {
    screen: state.screen,
    doors: DOOR_OPTIONS.map((option, i) => {
      const key = `door:${i}`;
      return {
        ...option,
        ...doorPlate(option),
        enabled: live,
        // A dead screen (an attempt in flight) is at rest whatever the pointer is
        // doing: a plate that lights up under a finger it will not answer is a lie.
        state: !live ? 'rest' : press === key ? 'press' : hover === key ? 'hover' : 'rest',
      };
    }),
    cells,
    keys: KEYPAD_KEYS,
    canErase: live && state.code.length > 0,
    canSubmit: canSubmitJoin(state),
    connecting: state.status === 'connecting',
    error: told ? (told.failed ? told.line : '') : state.error,
    // A live connect is the screen's business; a door that is not built yet can
    // wait. The notice stands down while something is narrating.
    notice: told ? '' : state.notice,
    prompt: told ? told.line : entryPrompt(state),
    narrating: told !== null,
    eyebrow: ENTRY_EYEBROW,
    status: ENTRY_STATUS[state.screen],
    hover: live ? hover : null,
    press: live ? press : null,
  };
}

/**
 * The tagline under the wordmark on the home screen — the triangle the whole loop
 * turns on (GDD §2.3: "the loop is a triangle — mine / defend / attack"). It
 * replaces an earlier line that simply repeated the title ("PLANET RUSH"), which
 * said nothing the wordmark above it did not already say: the subtitle is the
 * pitch, not the name a second time.
 */
export const ENTRY_TAGLINE = 'MINE · DEFEND · ATTACK';

/**
 * The line under the wordmark when nobody is narrating: what to do. On the home
 * screen it is the {@link ENTRY_TAGLINE}, not the title repeated.
 *
 * `CONNECTING…` survives here as the *fallback only* — the offline SOLO door, which
 * opens no socket and so has no story to tell. Every online attempt hands
 * {@link entryModel} an {@link EntryNarration} and this word is never seen: that
 * was the whole complaint.
 */
function entryPrompt(state: EntryState): string {
  if (state.status === 'connecting') return 'CONNECTING…';
  return state.screen === 'join' ? 'ENTER THE CLAIM CODE' : ENTRY_TAGLINE;
}

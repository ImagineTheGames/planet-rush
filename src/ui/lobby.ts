/**
 * src/ui/lobby.ts — the 8-slot lobby model. OWNER: UI Engineer.
 *
 * The screen a match is entered from (GDD §2.1): a shareable **room code**, an
 * **eight-slot roster** whose empty seats are filled by the bot cast, a **ship
 * class** pick per player (GDD §2.11), a **player colour** per slot
 * (style-guide §3.1), the host's **bot difficulty** picks, and the **RUSH!**
 * countdown that starts the match.
 *
 * Pure and DOM-free, like every other model in this directory: it holds the
 * decisions, {@link ./lobby-geometry} holds the rects, and {@link ./lobby-view}
 * only draws what the two of them return. That split is what lets the four
 * rules below be unit-tested instead of eyeballed on a phone.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS FILE KEEPS
 * ---------------------------------------------------------------------------
 *
 *  1. **A slot is a slot.** Eight seats, ids 0..7, humans and bots in the same
 *     id space (`@shared/types` PlayerId). Seat identity — colour and decal —
 *     belongs to the *slot*, never to the person sitting in it, so a seat that
 *     changes hands keeps its colour and the roster never re-shuffles under a
 *     player who is reading it.
 *  2. **Eight colours, eight players, all different** (style-guide §3.1). The
 *     roster is read straight from the ratified `PLAYER_COLORS`, so the lobby
 *     chip, the ship trim and the HP bar can never disagree — and every seat
 *     also carries its `P1`…`P8` decal, because identity must never depend on
 *     hue alone (§3 rule 3).
 *  3. **The hull is locked at RUSH!** (GDD §2.11: "the choice is locked for the
 *     match"). {@link selectShipClass} refuses once the countdown has started,
 *     which is the same instant the server stops honouring `lobbyChoice`
 *     (`server/room.ts`: "a hull is locked for the match").
 *  4. **No ship stats on this screen.** A {@link ShipClassOption} carries a
 *     name, a hull and a role blurb — and no number. Stats live in the upgrade
 *     panel and nowhere else (GDD §2.2, §2.5), so the type simply gives the view
 *     nothing it *could* print.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE EMPTY SEATS SHOW
 * ---------------------------------------------------------------------------
 * "Empty slots are filled by AI bots; before the match, the host picks each
 * bot's difficulty" (GDD §2.1) — and the bots are "characters, not difficulty
 * labels" (GDD §2.9). So an unclaimed seat does not read as a hole: it previews
 * the character who will fly it, at the difficulty the host has set, and is
 * marked OPEN for as long as somebody can still take it by room code.
 *
 * That preview is computed with the *server's* rule, not a prettier one of our
 * own ({@link castForEmptySeat} mirrors `server/room.ts` `castFor`): the host's
 * difficulty list is honoured seat by seat, in **empty-seat order**, and
 * whatever it does not name falls back to roster order. A lobby nobody touches
 * therefore previews the whole seven-character cast, one of each — see
 * {@link defaultDifficultyForEmptySeat} — and a lobby the host does touch shows
 * exactly who the room will seat, repeats included. Showing the truth beats
 * showing a nicer roster than the match will actually have.
 */

import type { PlayerId, Rng } from '@shared/types';
import { ShipClass } from '@shared/types';
import { PLAYER_COLORS } from '@render/index';
import { Difficulty, MATCH_SLOTS, PERSONALITIES, ROSTER, rosterAt } from '../bots';
import type { PersonalityId } from '../bots';
import type { BotDifficulty, LobbySlot, RoomCode } from '../net/transport';
import { playerColor } from './planet-hp';
import { CLASS_NAMES } from './upgrade-panel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seats in a match (GDD §1: "up to 8 players"). One source of truth — the
 *  harness's `MATCH_SLOTS`, which is also the number of seats a room holds. */
export const LOBBY_SLOTS = MATCH_SLOTS;

/** The word on the start button, and on the countdown when it reaches zero
 *  (GDD §2.1: "a match countdown ('RUSH!') starts the game"). */
export const RUSH_LABEL = 'RUSH!';

/** Seconds the RUSH countdown runs for. Long enough to put a thumb back on the
 *  stick, short enough that nobody reads it twice. TUNABLE */
export const RUSH_COUNTDOWN_SECONDS = 5;

/** The words a difficulty is shown as. The tier is named in full on the row —
 *  a bot is a character *and* a competence level, and the host is picking the
 *  second one (GDD §2.1, §2.9). */
export const DIFFICULTY_LABELS: Readonly<Record<BotDifficulty, string>> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
};

/** Cycle order for the host's per-seat difficulty tap. Easiest first, so the
 *  host walks *up* the ladder rather than down into Hard by accident. */
export const DIFFICULTY_CYCLE: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * The identity colours in words (style-guide §3.1), indexed by slot. Named on
 * every roster row beside the hull, because the roster has to read with the hue
 * removed — the same reason every ship carries a hull decal (§3 rule 3, §9).
 */
export const COLOR_NAMES: readonly string[] = [
  'AZURE',
  'CYAN',
  'SPRING',
  'VIOLET',
  'MAGENTA',
  'ORANGE',
  'CHALK',
  'SLATE-BLUE',
];

// ---------------------------------------------------------------------------
// The four hulls (GDD §2.11) — words only, never a stat
// ---------------------------------------------------------------------------

/** Tile order, left to right / top to bottom. The order GDD §2.11 tables them
 *  in, so the document and the screen read the same way. */
export const CLASS_ORDER: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

/**
 * The hull pre-selected for a player who has picked nothing: the **Vanguard**,
 * "the all-rounder … the pre-selected default so onboarding never blocks on the
 * choice" (GDD §2.11).
 */
export const DEFAULT_SHIP_CLASS = ShipClass.Vanguard;

/**
 * One hull tile. A name, a hull, a role — **and no number**. This type is the
 * enforcement of GDD §2.5's "ship stats … appear only in the upgrade panel":
 * the view cannot print a stat here because the model never carries one.
 */
export interface ShipClassOption {
  readonly shipClass: ShipClass;
  /** Class name, from the shared table the upgrade panel titles itself with. */
  readonly name: string;
  /** The hull's name (GDD §2.11's parenthetical: Quadfin, Anvil, Pincer,
   *  Hammerhead) — the silhouette a player learns to read at 24px (§5.3). */
  readonly hull: string;
  /** The role, in the design's own words. Words only: no speeds, no HP. */
  readonly blurb: string;
}

/** The four tiles (GDD §2.11), in {@link CLASS_ORDER}. */
export const CLASS_OPTIONS: readonly ShipClassOption[] = [
  {
    shipClass: ShipClass.Interceptor,
    name: CLASS_NAMES[ShipClass.Interceptor],
    hull: 'Quadfin',
    blurb: 'Scout and miner-hunter. Catches miners in the open; melts against turrets.',
  },
  {
    shipClass: ShipClass.Vanguard,
    name: CLASS_NAMES[ShipClass.Vanguard],
    hull: 'Anvil',
    blurb: 'All-rounder. Does everything second-best — the one to learn the game in.',
  },
  {
    shipClass: ShipClass.Excavator,
    name: CLASS_NAMES[ShipClass.Excavator],
    hull: 'Pincer',
    blurb: 'Mining engine and close bruiser. Out-earns everyone, and cannot run.',
  },
  {
    shipClass: ShipClass.Hauler,
    name: CLASS_NAMES[ShipClass.Hauler],
    hull: 'Hammerhead',
    blurb: 'Logistics and siege tank. Hauls the biggest hold and tanks a siege; arrives late.',
  },
];

// ---------------------------------------------------------------------------
// Room codes — created in the lobby, read across a classroom (GDD §4.2)
// ---------------------------------------------------------------------------

/**
 * The alphabet a room code is drawn from — **no `O`/`0`, no `I`/`1`**.
 *
 * Deliberately mirrored from `server/match-server.ts` (`CODE_ALPHABET`,
 * `CODE_LENGTH`) rather than imported: the client bundle does not import the
 * match server, and a four-character alphabet is not worth a new entry in the
 * shared contract. The rule it encodes is the one that matters — a code is read
 * off one player's screen and typed into another's phone, so the letters that
 * are ambiguous in that game of telephone are simply not in the deck, which is
 * also why {@link typeRoomCode} has nothing to fold and can reject outright.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Length of a generated code (32⁴ ≈ 1M codes; short enough to read aloud). */
export const ROOM_CODE_LENGTH = 4;

/** Longest code the wire will look at (`src/net/wire.ts` MAX_ROOM_CODE_LENGTH).
 *  Generated codes are {@link ROOM_CODE_LENGTH}; this is the paste ceiling. */
export const ROOM_CODE_MAX_LENGTH = 8;

/**
 * A fresh, human-typable room code. Drawn from the ratified seeded PRNG
 * (`mulberry32`, `@shared/types`) and never `Math.random()`, so a lobby is
 * reproducible in a test and in a replay.
 *
 * The server creates whatever code it is handed that it does not already know
 * (`server/match-server.ts`: "an unknown code **creates** that room"), so this
 * is the whole of "create a room" on the client side.
 */
export function makeRoomCode(rng: Rng, length = ROOM_CODE_LENGTH): RoomCode {
  let code = '';
  for (let i = 0; i < length; i++) {
    const pick = Math.floor(rng.next() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[Math.min(Math.max(pick, 0), ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}

/**
 * Normalise a code the player typed, pasted, or arrived with in a URL. Mirrors
 * the wire's `parseRoomCode` exactly — trimmed, upper-cased, `A-Z0-9`, at most
 * {@link ROOM_CODE_MAX_LENGTH} — so a code this function accepts is a code the
 * server will accept, and one it rejects never reaches a socket.
 */
export function normalizeRoomCode(raw: string): RoomCode | null {
  const code = raw.trim().toUpperCase();
  if (code.length === 0 || code.length > ROOM_CODE_MAX_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) ? code : null;
}

/** Append one typed character to a code being entered, ignoring anything that
 *  is not in the (ambiguity-free) alphabet and anything past the length. */
export function typeRoomCode(current: string, key: string): string {
  if (current.length >= ROOM_CODE_LENGTH) return current;
  const ch = key.trim().toUpperCase();
  if (ch.length !== 1 || !ROOM_CODE_ALPHABET.includes(ch)) return current;
  return current + ch;
}

/** Erase the last character of a code being entered (backspace). */
export function eraseRoomCode(current: string): string {
  return current.slice(0, -1);
}

/** Whether an entered code is complete enough to send a `join` for. */
export function isJoinableRoomCode(code: string): boolean {
  const normal = normalizeRoomCode(code);
  return normal !== null && normal.length === ROOM_CODE_LENGTH;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/**
 * Who holds a seat.
 *
 *  - `human` — a player is in it.
 *  - `bot`   — a bot is in it, seated by the server (that happens at RUSH!).
 *  - `open`  — nobody yet: it *previews* the bot that will fill it, and anyone
 *              with the room code can still take it (GDD §2.1, §4.2).
 */
export type SeatOccupant = 'human' | 'bot' | 'open';

/** One of the eight seats. */
export interface LobbySeat {
  readonly player: PlayerId;
  readonly occupant: SeatOccupant;
  /** The hull this seat flies. Locked for the match at RUSH! (GDD §2.11). */
  readonly shipClass: ShipClass;
  /** The tier this seat's bot flies at — meaningless on a human seat, and kept
   *  anyway, so a seat that empties again shows the difficulty it had. */
  readonly difficulty: BotDifficulty;
  /** The character previewed (or seated) here, or `null` on a human seat. */
  readonly personality: PersonalityId | null;
}

/** Lobby phases. The view draws nothing once the match owns the screen. */
export type LobbyPhase = 'gathering' | 'counting' | 'started';

/** The whole lobby, as one immutable value. Every function below takes one and
 *  returns a new one, so a reducer, a test and a replay all see the same shape. */
export interface LobbyState {
  readonly room: RoomCode;
  /** The local player's slot. */
  readonly you: PlayerId;
  /** The room creator — **a lobby word, not a network role** (GDD §4.2): they
   *  pick the bot difficulties and press RUSH!, and are otherwise a client. */
  readonly host: PlayerId;
  readonly phase: LobbyPhase;
  readonly seats: readonly LobbySeat[];
  /** Your hull pick. Mirrored onto your seat; locked once counting starts. */
  readonly shipClass: ShipClass;
  /** Seconds left on the RUSH countdown; 0 outside `counting`. */
  readonly countdown: number;
  /**
   * Whether this room can be joined over the wire. Online lobbies show the room
   * code and mark empty seats OPEN (someone can still claim them, GDD §4.2);
   * an **offline** lobby (solo-vs-bots, M4) shows neither, because there is no
   * transport for a second player to arrive on — the empty seats are the bot
   * cast and nothing else. Defaults true, so every existing online path is
   * unchanged; the offline boot in `main.ts` opts out.
   */
  readonly online: boolean;
}

/** Options for {@link createLobby}. Everything has a defensible default so an
 *  offline match can open a lobby with one argument. */
export interface LobbyOptions {
  readonly room: RoomCode;
  /** The local slot. Default 0 — the creator gets the lowest seat. */
  readonly you?: PlayerId;
  /** The room creator. Default: you (creating a room makes you the host). */
  readonly host?: PlayerId;
  /** Seats. Default {@link LOBBY_SLOTS}; a smaller room is a test fixture. */
  readonly slots?: number;
  /** Your hull. Default {@link DEFAULT_SHIP_CLASS} — the Vanguard (GDD §2.11). */
  readonly shipClass?: ShipClass;
  /** Joinable over the wire? Default true (online). The offline solo-vs-bots
   *  boot passes false, which hides the room code and the OPEN seat markers. */
  readonly online?: boolean;
}

/**
 * A fresh lobby: you in your seat, every other seat open and previewing the
 * character who would fly it.
 *
 * The host's seat is seated too when it isn't yours — joining a room means
 * somebody created it, and a creator with no body in the chair would read as an
 * open seat holding the RUSH! button.
 */
export function createLobby(options: LobbyOptions): LobbyState {
  const count = Math.max(1, Math.floor(options.slots ?? LOBBY_SLOTS));
  const you = clampSlot(options.you ?? 0, count);
  const host = clampSlot(options.host ?? you, count);
  const shipClass = options.shipClass ?? DEFAULT_SHIP_CLASS;
  const seats: LobbySeat[] = [];
  let emptyIndex = 0;
  for (let player = 0; player < count; player++) {
    const human = player === you || player === host;
    seats.push({
      player,
      occupant: human ? 'human' : 'open',
      shipClass: player === you ? shipClass : DEFAULT_SHIP_CLASS,
      difficulty: human ? 'medium' : defaultDifficultyForEmptySeat(emptyIndex++),
      personality: null,
    });
  }
  return withCast({
    room: options.room,
    you,
    host,
    phase: 'gathering',
    seats,
    shipClass,
    countdown: 0,
    online: options.online ?? true,
  });
}

// ---------------------------------------------------------------------------
// The cast preview — the server's rule, not a prettier one
// ---------------------------------------------------------------------------

/**
 * The difficulty an untouched empty seat starts at: **the tier of the character
 * who sits there in roster order**. Rusty and Bolt are Easy, Foreman and Patch
 * Medium, Sable, Vulture and Warden Hard (GDD §2.9), so a lobby nobody touches
 * previews the whole cast, one of each, at each character's own tier — a full
 * house of seven distinct rivals rather than seven copies of one Medium bot.
 */
export function defaultDifficultyForEmptySeat(emptyIndex: number): BotDifficulty {
  const id = ROSTER[emptyIndex % ROSTER.length];
  return id ? (PERSONALITIES[id].difficulty as BotDifficulty) : 'medium';
}

/**
 * The character the room will seat in the nth **empty** seat, given the
 * difficulty the host set for it.
 *
 * Mirrors `server/room.ts` `castFor` deliberately, including its modulo: the
 * lobby's job is to show what will happen, so when the host sets four seats to
 * Hard and the Hard tier has three characters, the fourth row must show the
 * repeat the server is going to seat rather than a name it invented.
 */
export function castForEmptySeat(emptyIndex: number, difficulty: BotDifficulty): PersonalityId {
  const tier = rosterAt(difficulty as Difficulty);
  const pick = tier[emptyIndex % Math.max(1, tier.length)];
  if (pick) return pick;
  return ROSTER[emptyIndex % ROSTER.length] as PersonalityId;
}

/** Recompute every non-human seat's previewed character from its difficulty and
 *  its position in empty-seat order. Called after anything that moves either. */
function withCast(state: LobbyState): LobbyState {
  let emptyIndex = 0;
  const seats = state.seats.map((seat) => {
    if (seat.occupant === 'human') return seat.personality === null ? seat : { ...seat, personality: null };
    const personality = castForEmptySeat(emptyIndex++, seat.difficulty);
    // A bot the server has actually seated flies its character's hull
    // (style-guide §4: the livery is a palette swap over one of four
    // silhouettes), so the roster shows the hull it will really fly.
    const shipClass = PERSONALITIES[personality].shipClass;
    return seat.personality === personality && seat.shipClass === shipClass
      ? seat
      : { ...seat, personality, shipClass };
  });
  return { ...state, seats };
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

/** Whether the hull choice is closed. True from the moment RUSH! is pressed —
 *  "the choice is locked for the match" (GDD §2.11). */
export function classLocked(state: LobbyState): boolean {
  return state.phase !== 'gathering';
}

/**
 * Pick a hull. **Refused once the lobby is counting down**: the countdown is the
 * start of the match, the server stops honouring `lobbyChoice` at the same
 * instant, and a hull that changed after RUSH! would be a hull the world was not
 * built from (GDD §2.11, `server/room.ts`).
 */
export function selectShipClass(state: LobbyState, shipClass: ShipClass): LobbyState {
  if (classLocked(state)) return state;
  if (state.shipClass === shipClass) return state;
  return {
    ...state,
    shipClass,
    seats: state.seats.map((seat) =>
      seat.player === state.you ? { ...seat, shipClass } : seat,
    ),
  };
}

/** Whether this client may set bot difficulties — the host, before RUSH!
 *  (GDD §2.1: "before the match, the host picks each bot's difficulty"). */
export function hostControls(state: LobbyState): boolean {
  return state.you === state.host && state.phase === 'gathering';
}

/**
 * Cycle one seat's bot difficulty (the host's tap on a roster row). A no-op from
 * a guest, on a human seat, or after the countdown has started — the same three
 * refusals the server applies to `lobbyChoice.botDifficulties`.
 */
export function cycleBotDifficulty(state: LobbyState, player: PlayerId): LobbyState {
  if (!hostControls(state)) return state;
  const seat = state.seats[player];
  if (!seat || seat.occupant === 'human') return state;
  const at = DIFFICULTY_CYCLE.indexOf(seat.difficulty);
  const next = DIFFICULTY_CYCLE[(at + 1) % DIFFICULTY_CYCLE.length] ?? 'medium';
  return withCast({
    ...state,
    seats: state.seats.map((s) => (s.player === player ? { ...s, difficulty: next } : s)),
  });
}

/**
 * The list to send as `LobbyChoiceMessage.botDifficulties`: one entry per
 * **empty seat, in empty-seat order** — which is the order `server/room.ts`
 * indexes it in (`castFor(botIndex++)` over the seats with no socket), *not*
 * slot order. Getting this wrong would hand seat 5's difficulty to seat 2.
 */
export function botDifficulties(state: LobbyState): readonly BotDifficulty[] {
  return state.seats.filter((s) => s.occupant !== 'human').map((s) => s.difficulty);
}

// ---------------------------------------------------------------------------
// The wire — folding an authoritative lobby snapshot in
// ---------------------------------------------------------------------------

/**
 * Apply a `lobbyState` broadcast (`src/net/transport.ts` {@link LobbySlot}).
 *
 * The wire slot carries `isBot` and `ready` but has no third state for "nobody
 * yet", so the reading is: a bot is a bot; a seat the server has marked `ready`
 * has a human in it (the room sets `ready` the moment a socket is seated); and
 * anything else is still open. That is true of both authorities — the match
 * server, which seats bots only at RUSH!, and `LocalLoopback`, which seats them
 * immediately — so one rule reads both.
 *
 * Your own seat keeps *your* pending hull while the lobby is still gathering:
 * the echo of a pick you made two frames ago must not flick the tile you are
 * looking at back to the hull you just left.
 */
export function applyLobbySlots(state: LobbyState, slots: readonly LobbySlot[]): LobbyState {
  const seats = state.seats.map((seat) => {
    const wire = slots[seat.player];
    if (!wire) return seat;
    const occupant: SeatOccupant = wire.isBot ? 'bot' : wire.ready ? 'human' : 'open';
    const mine = seat.player === state.you && state.phase === 'gathering';
    return {
      ...seat,
      occupant,
      shipClass: mine ? state.shipClass : wire.shipClass,
      difficulty: wire.botDifficulty ?? seat.difficulty,
    };
  });
  return withCast({ ...state, seats });
}

/** Adopt the slot the server welcomed this client into, and (offline or as the
 *  room's creator) the seat that owns the host controls. */
export function seatLocalPlayer(state: LobbyState, you: PlayerId, host = state.host): LobbyState {
  const count = state.seats.length;
  const slot = clampSlot(you, count);
  return withCast({
    ...state,
    you: slot,
    host: clampSlot(host, count),
    seats: state.seats.map((seat) =>
      seat.player === slot
        ? { ...seat, occupant: 'human' as const, shipClass: state.shipClass }
        : seat,
    ),
  });
}

// ---------------------------------------------------------------------------
// RUSH!
// ---------------------------------------------------------------------------

/** Whether RUSH! can be pressed right now: the host, still gathering. Empty
 *  seats are never a reason to wait — they become bots (GDD §2.1, §4.2). */
export function canStart(state: LobbyState): boolean {
  return hostControls(state);
}

/** Press RUSH! — starts the countdown every player watches, and locks the hull
 *  choice (rule 3). A no-op from a guest. */
export function pressRush(state: LobbyState, seconds = RUSH_COUNTDOWN_SECONDS): LobbyState {
  if (!canStart(state)) return state;
  return { ...state, phase: 'counting', countdown: Math.max(0, seconds) };
}

/**
 * Advance the countdown by `dt` seconds. At zero the lobby is done and the match
 * owns the screen. Driven by the frame clock rather than a wall-clock timer, the
 * same discipline the HUD's flashes use.
 */
export function tickLobby(state: LobbyState, dt: number): LobbyState {
  if (state.phase !== 'counting') return state;
  const countdown = state.countdown - Math.max(0, dt);
  if (countdown > 0) return { ...state, countdown };
  return { ...state, phase: 'started', countdown: 0 };
}

/** The server said the match is live (`matchStart`). Ends the lobby whatever the
 *  local countdown thought — authority wins, and a guest never counted at all. */
export function startLobbyMatch(state: LobbyState): LobbyState {
  if (state.phase === 'started') return state;
  return { ...state, phase: 'started', countdown: 0 };
}

/** The countdown as the button says it: `5`…`1`, then {@link RUSH_LABEL} — so
 *  the box the host pressed is the box everyone watches (GDD §2.1). */
export function countdownLabel(state: LobbyState): string {
  if (state.phase !== 'counting') return RUSH_LABEL;
  const seconds = Math.ceil(state.countdown);
  return seconds > 0 ? String(seconds) : RUSH_LABEL;
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** One roster row, as the view draws it. */
export interface LobbySeatView {
  readonly player: PlayerId;
  /** `P1`…`P8` — the hull decal, and the read that survives colour removal
   *  (style-guide §3 rule 3). */
  readonly decal: string;
  /** Who is in the seat: `YOU`, `PLAYER 4`, or a character's name (GDD §2.9). */
  readonly name: string;
  /** The slot's identity colour (style-guide §3.1). */
  readonly color: number;
  /** …and its name, so the row reads with the hue removed. */
  readonly colorName: string;
  /** The hull, in words. No stats (rule 4). */
  readonly className: string;
  readonly isBot: boolean;
  readonly isYou: boolean;
  /** The room's creator — marked, because they hold RUSH! (GDD §4.2). */
  readonly isHost: boolean;
  /** Still claimable by anyone with the room code. */
  readonly openToJoin: boolean;
  /** The tier, on a bot row only. */
  readonly botDifficulty?: BotDifficulty;
}

/** The lobby for one frame. */
export interface LobbyModel {
  readonly phase: LobbyPhase;
  readonly room: RoomCode;
  readonly seats: readonly LobbySeatView[];
  readonly classOptions: readonly ShipClassOption[];
  /** Your hull — the tile drawn as selected. */
  readonly shipClass: ShipClass;
  readonly classLocked: boolean;
  readonly countdown: { readonly active: boolean; readonly label: string; readonly seconds: number };
  readonly canStart: boolean;
  readonly hostControls: boolean;
  /** Seats with a person in them, and seats that will be (or are) bots. */
  readonly humanCount: number;
  readonly botCount: number;
  /** Whether the room is joinable over the wire — drives whether the view draws
   *  the room code at all (offline solo-vs-bots draws none, M4). */
  readonly online: boolean;
}

/** Build the frame model. Pure: the view draws exactly this and decides nothing. */
export function lobbyModel(state: LobbyState): LobbyModel {
  const seats = state.seats.map((seat) => seatView(state, seat));
  const humanCount = seats.filter((s) => !s.isBot).length;
  return {
    phase: state.phase,
    room: state.room,
    seats,
    classOptions: CLASS_OPTIONS,
    shipClass: state.shipClass,
    classLocked: classLocked(state),
    countdown: {
      active: state.phase === 'counting',
      label: countdownLabel(state),
      seconds: state.countdown,
    },
    canStart: canStart(state),
    hostControls: state.you === state.host,
    humanCount,
    botCount: seats.length - humanCount,
    online: state.online,
  };
}

function seatView(state: LobbyState, seat: LobbySeat): LobbySeatView {
  const isBot = seat.occupant !== 'human';
  const character = seat.personality ? PERSONALITIES[seat.personality] : null;
  const name = isBot
    ? (character?.name ?? 'BOT')
    : seat.player === state.you
      ? 'YOU'
      : `PLAYER ${seat.player + 1}`;
  return {
    player: seat.player,
    decal: `P${seat.player + 1}`,
    name,
    color: playerColor(seat.player),
    colorName: colorName(seat.player),
    className: CLASS_NAMES[seat.shipClass],
    isBot,
    isYou: seat.player === state.you,
    isHost: seat.player === state.host && seat.occupant === 'human',
    // An open seat stops being claimable the moment the match starts; a seat the
    // server has already seated a bot in was never claimable to begin with; and
    // offline there is no wire for a second player to arrive on, so nothing is
    // ever "claimable by room code" (the empty seats are simply the bot cast).
    openToJoin: seat.occupant === 'open' && state.phase !== 'started' && state.online,
    ...(isBot ? { botDifficulty: seat.difficulty } : {}),
  };
}

/** The name of a slot's identity colour (style-guide §3.1), or a neutral word
 *  for a slot outside the eight — colour is never the only identity channel. */
export function colorName(id: PlayerId): string {
  if (!Number.isFinite(id) || id < 0) return 'STEEL';
  return COLOR_NAMES[Math.floor(id) % COLOR_NAMES.length] ?? 'STEEL';
}

/** The roster colour count — eight, and asserted against the ratified table so
 *  a roster that grows in one place and not the other fails a test, not a match. */
export const COLOR_ROSTER_SIZE = Math.min(PLAYER_COLORS.length, COLOR_NAMES.length);

function clampSlot(value: number, count: number): PlayerId {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), Math.max(0, count - 1));
}

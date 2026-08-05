/**
 * src/ui/lobby.test.ts — the lobby's three load-bearing contracts, headless.
 *
 * The brief names them, and they are the three things a broken lobby breaks in
 * a way nobody notices until the match has already started:
 *
 *  1. **Slot assignment** — eight seats, ids 0..7, the local player in theirs
 *     and the bot cast previewed over what is left, in the order the *server*
 *     will seat it (`server/room.ts` `castFor`).
 *  2. **Class lock at start** — a hull is picked in the lobby and locked for the
 *     match (GDD §2.11), from the instant RUSH! is pressed, which is the instant
 *     the room stops honouring `lobbyChoice`.
 *  3. **Colour uniqueness** — eight players, eight identity colours, one per
 *     slot, from the ratified roster (style-guide §3.1), never repeated and
 *     never dependent on hue alone.
 *
 * Plus the rules that hold those three up: the room code a classroom reads
 * aloud, the host-only difficulty picks, and the "no ship stats on this screen"
 * rule that the hull tiles exist to obey (GDD §2.2, §2.5).
 */
import { describe, it, expect } from 'vitest';
import { ShipClass, mulberry32 } from '@shared/types';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import { PERSONALITIES, ROSTER } from '../bots';
import type { LobbySlot } from '../net/transport';
import {
  ABUNDANCE_CYCLE,
  ABUNDANCE_LABELS,
  CLASS_ORDER,
  CLASS_OPTIONS,
  COLOR_NAMES,
  DEFAULT_SHIP_CLASS,
  DIFFICULTY_CYCLE,
  DIFFICULTY_LABELS,
  LOBBY_SLOTS,
  MAX_TEAMS,
  MODE_LABELS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RUSH_COUNTDOWN_SECONDS,
  RUSH_LABEL,
  SEAT_STATE_CYCLE,
  SIDE_COLORS,
  SIDE_WORDS,
  TEAM_LABELS,
  activeTeams,
  applyLobbySlots,
  botDifficulties,
  canStart,
  castForEmptySeat,
  classLocked,
  colorName,
  countdownLabel,
  createLobby,
  cycleAbundance,
  cycleBotDifficulty,
  cycleSeatState,
  cycleSeatTeam,
  defaultDifficultyForEmptySeat,
  defaultTeamForSlot,
  eraseRoomCode,
  isJoinableRoomCode,
  lobbyMatchConfig,
  lobbyModel,
  makeRoomCode,
  matchSizeOf,
  nameFor,
  normalizePlayerName,
  normalizeRoomCode,
  playerNameTable,
  pressRush,
  seatLocalPlayer,
  selectMap,
  selectShipClass,
  setPlayerName,
  sideRelation,
  startLobbyMatch,
  teamLabel,
  teamName,
  tickLobby,
  toggleMode,
  viewerTeamOf,
  typeRoomCode,
  DEFAULT_PLAYER_NAME,
  PLAYER_NAME_MAX_CHARS,
} from './lobby';
import type { LobbyState } from './lobby';
import { nameplateModel, resolveTeamLabel } from './nameplates';
// The art direction itself, so the two side hues are pinned to the frozen palette
// and its declared ramp rather than to a hex typed twice (the same cross-check
// `./chrome.test` runs on the panel chrome).
import { PALETTE as ART_PALETTE, DERIVED, tint } from '../art/palette';
import { DEFAULT_MAP_ID, MAPS } from '../sim/maps';
import { DEFAULT_ABUNDANCE } from '../sim/constants';
import {
  MAX_MATCH_SIZE,
  MIN_MATCH_SIZE,
  activeSlots,
  configToPlayers,
  matchSize,
} from '../sim/match-config';

const ROOM = 'K7QM';

/**
 * WCAG relative-contrast of a UI colour against the Vacuum backdrop `#0D1015` —
 * the one thing style-guide §1's "every entity must read against Vacuum on its
 * own" can actually be measured as. Used to keep the side hues legible at 11–12px
 * on a phone, where a dim tone that looked fine in a desktop mock disappears.
 */
function contrastOnVacuum(color: number): number {
  const lum = (c: number): number => {
    const ch = (v: number): number => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * ch((c >> 16) & 0xff) + 0.7152 * ch((c >> 8) & 0xff) + 0.0722 * ch(c & 0xff)
    );
  };
  const a = lum(color) + 0.05;
  const b = lum(ART_PALETTE.vacuum) + 0.05;
  return a > b ? a / b : b / a;
}

function lobby(overrides: Partial<Parameters<typeof createLobby>[0]> = {}): LobbyState {
  return createLobby({ room: ROOM, you: 0, ...overrides });
}

/** A wire lobby snapshot: `ready` marks a seated human, `isBot` a seated bot —
 *  the two flags `server/room.ts` publishes (`lobbyState()`). */
function wireSlots(spec: readonly ('human' | 'bot' | 'open')[]): LobbySlot[] {
  return spec.map((kind, player) => ({
    player,
    isBot: kind === 'bot',
    shipClass: DEFAULT_SHIP_CLASS,
    ready: kind === 'human',
  }));
}

// ---------------------------------------------------------------------------
// 1. Slot assignment
// ---------------------------------------------------------------------------

describe('slot assignment (GDD §2.1 — eight seats, humans and bots in one id space)', () => {
  it('opens eight seats in slot order with the local player in theirs', () => {
    const state = lobby({ you: 3 });
    expect(state.seats).toHaveLength(LOBBY_SLOTS);
    expect(state.seats.map((s) => s.player)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const you = state.seats[3];
    expect(you?.occupant).toBe('human');
    expect(you?.personality).toBeNull();
    // Every other seat is open, and previews the bot that would fly it.
    for (const seat of state.seats.filter((s) => s.player !== 3)) {
      expect(seat.occupant).toBe('open');
      expect(seat.personality).not.toBeNull();
    }
  });

  it('previews the whole seven-character cast in an untouched lobby (GDD §2.9)', () => {
    // Bots are "characters, not difficulty labels": a lobby nobody has touched
    // should read as a full house of distinct rivals, not seven Mediums.
    const names = lobby()
      .seats.filter((s) => s.personality)
      .map((s) => s.personality);
    expect(names).toHaveLength(LOBBY_SLOTS - 1);
    expect(new Set(names).size).toBe(ROSTER.length);
    expect([...names].sort()).toEqual([...ROSTER].sort());
  });

  it('starts each empty seat at its own character’s tier', () => {
    // Rusty/Bolt are Easy, Foreman/Patch Medium, Sable/Vulture/Warden Hard.
    for (let i = 0; i < ROSTER.length; i++) {
      const id = ROSTER[i]!;
      expect(defaultDifficultyForEmptySeat(i)).toBe(PERSONALITIES[id].difficulty);
    }
  });

  it('re-casts over the remaining empty seats when a human arrives', () => {
    // The server casts by *empty-seat order* (`castFor(botIndex++)`), so a human
    // taking seat 1 shifts everyone behind them. The roster must show that.
    const before = lobby();
    const after = applyLobbySlots(before, wireSlots(['human', 'human', 'open', 'open', 'open', 'open', 'open', 'open']));

    expect(after.seats[1]?.occupant).toBe('human');
    expect(after.seats[1]?.personality).toBeNull();

    const empties = after.seats.filter((s) => s.occupant !== 'human');
    empties.forEach((seat, index) => {
      expect(seat.personality).toBe(castForEmptySeat(index, seat.difficulty));
    });
  });

  it('mirrors the server’s cast rule, repeats and all', () => {
    // Four Hard seats and three Hard characters: the fourth row must show the
    // repeat the room is going to seat rather than a name the lobby invented.
    const picks = [0, 1, 2, 3].map((i) => castForEmptySeat(i, 'hard'));
    expect(new Set(picks).size).toBe(3);
    expect(picks[3]).toBe(picks[0]);
  });

  it('reads a bot seat, a human seat and an open seat off one wire snapshot', () => {
    // `LobbySlot` has no "empty" flag, so the rule is: isBot ⇒ bot, ready ⇒
    // human, otherwise still open. It has to read both authorities — the match
    // server (bots seated at RUSH!) and LocalLoopback (bots seated at once).
    const state = applyLobbySlots(lobby(), wireSlots(['human', 'bot', 'open', 'bot', 'open', 'open', 'open', 'open']));
    expect(state.seats.map((s) => s.occupant)).toEqual([
      'human', 'bot', 'open', 'bot', 'open', 'open', 'open', 'open',
    ]);

    const model = lobbyModel(state);
    expect(model.humanCount).toBe(1);
    expect(model.botCount).toBe(7);
    // Only a seat nobody holds is still claimable by room code (GDD §4.2).
    expect(model.seats.filter((s) => s.openToJoin).map((s) => s.player)).toEqual([2, 4, 5, 6, 7]);
    expect(model.seats[1]?.openToJoin).toBe(false);
  });

  it('moves the local player to the slot the server welcomed them into', () => {
    const state = seatLocalPlayer(selectShipClass(lobby(), ShipClass.Hauler), 5);
    expect(state.you).toBe(5);
    expect(state.seats[5]?.occupant).toBe('human');
    expect(state.seats[5]?.shipClass).toBe(ShipClass.Hauler);
    expect(lobbyModel(state).seats[5]?.name).toBe('YOU');
  });

  it('keeps a bot seat flying its character’s hull (style-guide §4)', () => {
    // A livery is a palette swap over one of the four silhouettes, so the hull
    // the roster shows is the hull the bot will really spawn in.
    for (const seat of lobby().seats) {
      if (!seat.personality) continue;
      expect(seat.shipClass).toBe(PERSONALITIES[seat.personality].shipClass);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Class lock at start
// ---------------------------------------------------------------------------

describe('ship-class select and the lock at start (GDD §2.11)', () => {
  it('pre-selects the Vanguard so onboarding never blocks on the choice', () => {
    const model = lobbyModel(lobby());
    expect(model.shipClass).toBe(ShipClass.Vanguard);
    expect(DEFAULT_SHIP_CLASS).toBe(ShipClass.Vanguard);
    expect(model.classLocked).toBe(false);
  });

  it('offers exactly the four hulls, in the order GDD §2.11 tables them', () => {
    expect(CLASS_OPTIONS.map((o) => o.shipClass)).toEqual([...CLASS_ORDER]);
    expect(CLASS_ORDER).toHaveLength(4);
    expect(new Set(CLASS_ORDER).size).toBe(4);
    // Four classes ship in core scope, "and no others".
    expect(new Set(Object.values(ShipClass))).toEqual(new Set(CLASS_ORDER));
  });

  it('gives each hull a name, a hull and a role blurb — and no number', () => {
    // GDD §2.2/§2.5: ship stats appear in the upgrade panel and nowhere else.
    // The tile carries words only, which is why the type has no numeric field.
    for (const option of CLASS_OPTIONS) {
      expect(option.name.length).toBeGreaterThan(0);
      expect(option.hull.length).toBeGreaterThan(0);
      expect(option.blurb.length).toBeGreaterThan(0);
      expect(`${option.name} ${option.hull} ${option.blurb}`).not.toMatch(/\d/);
    }
    expect(CLASS_OPTIONS.map((o) => o.hull)).toEqual(['Quadfin', 'Anvil', 'Pincer', 'Hammerhead']);
  });

  it('takes a pick while gathering and mirrors it onto your seat', () => {
    const state = selectShipClass(lobby({ you: 2 }), ShipClass.Excavator);
    expect(state.shipClass).toBe(ShipClass.Excavator);
    expect(state.seats[2]?.shipClass).toBe(ShipClass.Excavator);
    expect(lobbyModel(state).seats[2]?.className).toBe('EXCAVATOR');
  });

  it('LOCKS the hull the moment RUSH! is pressed', () => {
    const picked = selectShipClass(lobby(), ShipClass.Interceptor);
    const counting = pressRush(picked);

    expect(classLocked(picked)).toBe(false);
    expect(classLocked(counting)).toBe(true);

    const attempted = selectShipClass(counting, ShipClass.Hauler);
    expect(attempted.shipClass).toBe(ShipClass.Interceptor);
    expect(attempted.seats[0]?.shipClass).toBe(ShipClass.Interceptor);
    expect(lobbyModel(attempted).classLocked).toBe(true);
  });

  it('stays locked once the match has started', () => {
    const started = startLobbyMatch(selectShipClass(lobby(), ShipClass.Excavator));
    expect(classLocked(started)).toBe(true);
    expect(selectShipClass(started, ShipClass.Interceptor).shipClass).toBe(ShipClass.Excavator);
  });

  it('does not let a wire echo overwrite the pick you are looking at', () => {
    // The server echoes the lobby back on every change; a pick made two frames
    // ago must not flick the selected tile back to the hull you just left.
    const picked = selectShipClass(lobby(), ShipClass.Hauler);
    const echoed = applyLobbySlots(picked, wireSlots(['human', 'open', 'open', 'open', 'open', 'open', 'open', 'open']));
    expect(echoed.seats[0]?.shipClass).toBe(ShipClass.Hauler);
  });
});

// ---------------------------------------------------------------------------
// 2b. Arena select and the lock at start (p2 field rule — the picker moved here)
// ---------------------------------------------------------------------------

describe('arena select and the lock at start (p2 — the map picker moved into the lobby)', () => {
  it('pre-selects the registry default (octagon) the first time out', () => {
    const model = lobbyModel(lobby());
    expect(model.mapId).toBe(DEFAULT_MAP_ID);
    expect(DEFAULT_MAP_ID).toBe('octagon');
  });

  it('opens on the arena it is handed, folding a stale id down to the default', () => {
    expect(lobby({ mapId: 'diamond' }).mapId).toBe('diamond');
    // A hand-edited / removed storage key can never seat a map the sim lacks.
    expect(lobby({ mapId: 'atlantis' }).mapId).toBe(DEFAULT_MAP_ID);
  });

  it('takes a pick while gathering and folds an unknown one to the default', () => {
    const state = selectMap(lobby(), 'oval');
    expect(state.mapId).toBe('oval');
    expect(lobbyModel(state).mapId).toBe('oval');
    expect(selectMap(state, 'nowhere').mapId).toBe(DEFAULT_MAP_ID);
    // Every ratified map is selectable.
    for (const map of MAPS) expect(selectMap(lobby(), map.id).mapId).toBe(map.id);
  });

  it('LOCKS the arena the moment RUSH! is pressed, exactly like the hull', () => {
    const picked = selectMap(lobby(), 'compass');
    const counting = pressRush(picked);
    expect(picked.mapId).toBe('compass');
    expect(selectMap(counting, 'diamond').mapId).toBe('compass');
  });

  it('stays locked once the match has started', () => {
    const started = startLobbyMatch(selectMap(lobby(), 'oval'));
    expect(selectMap(started, 'diamond').mapId).toBe('oval');
  });

  it('is the HOST’s pick — a joiner reads the arena read-only (the unified play flow)', () => {
    // One arena for the whole room, and the creator owns it exactly as they own the
    // mode and the slot states. A guest tapping a card gets the identical state back,
    // so the tap costs the wire nothing and the board they are told about is the
    // board they will fly.
    const guest = lobby({ you: 3, host: 0, mapId: 'octagon' });
    expect(selectMap(guest, 'diamond')).toBe(guest);
    expect(lobbyModel(guest).mapId).toBe('octagon');
    // …while the host of the same room can still change it.
    const host = lobby({ you: 0, host: 0, mapId: 'octagon' });
    expect(selectMap(host, 'diamond').mapId).toBe('diamond');
  });
});

// ---------------------------------------------------------------------------
// 2b. Player name (field request v0.2.1 — names over ships and stations)
// ---------------------------------------------------------------------------

describe('player name (field request v0.2.1 — the local name over ship + station)', () => {
  it('defaults a fresh lobby to "YOU"', () => {
    expect(lobby().name).toBe(DEFAULT_PLAYER_NAME);
    expect(lobbyModel(lobby()).name).toBe(DEFAULT_PLAYER_NAME);
  });

  it('takes a name from the options, trimmed', () => {
    expect(lobby({ name: '  Reinaldo  ' }).name).toBe('Reinaldo');
  });

  it('setPlayerName folds a raw name (trim + clamp + non-empty)', () => {
    const s = setPlayerName(lobby(), '  Ace  ');
    expect(s.name).toBe('Ace');
    // Blank falls back to the default, never a nameless seat.
    expect(setPlayerName(s, '   ').name).toBe(DEFAULT_PLAYER_NAME);
    // Over-long is clamped.
    const long = normalizePlayerName('A'.repeat(PLAYER_NAME_MAX_CHARS + 5));
    expect(long.length).toBe(PLAYER_NAME_MAX_CHARS);
  });

  it('setPlayerName returns the same state when nothing changed (stable reducer)', () => {
    const s = setPlayerName(lobby(), 'Ace');
    expect(setPlayerName(s, 'Ace')).toBe(s);
  });

  it('mirrors the name onto the local roster row', () => {
    const s = setPlayerName(lobby({ you: 0 }), 'Ace');
    const you = lobbyModel(s).seats.find((row) => row.isYou);
    expect(you?.name).toBe('Ace');
  });

  it('nameFor: the local seat shows the lobby name, bot seats their character', () => {
    const s = setPlayerName(lobby({ you: 0 }), 'Ace');
    expect(nameFor(s, 0)).toBe('Ace');
    // Slot 1 is the first bot in roster order — its personality name (GDD §2.9).
    const firstBot = s.seats[1]!;
    expect(firstBot.personality).not.toBeNull();
    expect(nameFor(s, 1)).toBe(PERSONALITIES[firstBot.personality!].name);
  });

  it('playerNameTable: one entry per slot, local name + the whole bot cast', () => {
    const s = setPlayerName(lobby({ you: 0 }), 'Ace');
    const table = playerNameTable(s);
    expect(table).toHaveLength(LOBBY_SLOTS);
    expect(table[0]).toBe('Ace');
    for (let slot = 1; slot < LOBBY_SLOTS; slot++) {
      expect(table[slot]).toBe(PERSONALITIES[s.seats[slot]!.personality!].name);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Colour uniqueness
// ---------------------------------------------------------------------------

describe('player colours (style-guide §3.1 — eight players, eight colours)', () => {
  it('gives every seat a different colour, straight from the ratified roster', () => {
    const seats = lobbyModel(lobby()).seats;
    const colors = seats.map((s) => s.color);
    expect(colors).toHaveLength(LOBBY_SLOTS);
    expect(new Set(colors).size).toBe(LOBBY_SLOTS);
    seats.forEach((seat, slot) => expect(seat.color).toBe(PLAYER_COLORS[slot]));
  });

  it('names every colour, and names them all differently (§3 rule 3)', () => {
    // Identity must read with the hue removed: the row prints the colour's name
    // beside the hull, and the P1…P8 decal is the source of truth.
    const seats = lobbyModel(lobby()).seats;
    expect(new Set(seats.map((s) => s.colorName)).size).toBe(LOBBY_SLOTS);
    expect(new Set(seats.map((s) => s.decal)).size).toBe(LOBBY_SLOTS);
    expect(seats.map((s) => s.decal)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    expect(COLOR_NAMES).toHaveLength(PLAYER_COLORS.length);
    expect(colorName(0)).toBe('AZURE');
  });

  it('never hands a seat signal yellow or threat red (style-guide §2)', () => {
    for (const seat of lobbyModel(lobby()).seats) {
      expect(seat.color).not.toBe(PALETTE.signalYellow);
      expect(seat.color).not.toBe(PALETTE.threatRed);
    }
  });

  it('binds colour to the SLOT, not to whoever is sitting in it', () => {
    // A seat that changes hands keeps its colour, so the roster never
    // re-shuffles under a player who is reading it.
    const before = lobbyModel(lobby()).seats.map((s) => s.color);
    const after = lobbyModel(
      applyLobbySlots(lobby(), wireSlots(['human', 'human', 'bot', 'human', 'open', 'open', 'open', 'open'])),
    ).seats.map((s) => s.color);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

describe('room codes (GDD §4.2 — created in the lobby, read across a room)', () => {
  it('draws four characters from an alphabet with no O/0 or I/1', () => {
    const code = makeRoomCode(mulberry32(1234));
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    for (const ambiguous of ['O', '0', 'I', '1']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('is deterministic from the ratified seeded PRNG, never Math.random()', () => {
    expect(makeRoomCode(mulberry32(7))).toBe(makeRoomCode(mulberry32(7)));
  });

  it('normalises what a player types the way the wire will (parseRoomCode)', () => {
    expect(normalizeRoomCode(' k7qm ')).toBe('K7QM');
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('K7-M')).toBeNull();
    expect(normalizeRoomCode('TOOLONGCODE')).toBeNull();
  });

  it('accepts only typable characters, and only up to the code length', () => {
    let code = '';
    for (const key of ['k', '7', 'o', 'q', 'm', 'x']) code = typeRoomCode(code, key);
    expect(code).toBe('K7QM'); // 'o' is not in the deck; 'x' is past the length
    expect(eraseRoomCode(code)).toBe('K7Q');
    expect(isJoinableRoomCode('K7Q')).toBe(false);
    expect(isJoinableRoomCode(code)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Host controls and RUSH!
// ---------------------------------------------------------------------------

describe('host controls (GDD §2.1 — the host picks each bot’s difficulty)', () => {
  it('cycles a bot seat easy → medium → hard → easy for the host', () => {
    let state = lobby();
    const start = state.seats[1]!.difficulty;
    const seen = [start];
    for (let i = 0; i < 3; i++) {
      state = cycleBotDifficulty(state, 1);
      seen.push(state.seats[1]!.difficulty);
    }
    expect(seen[3]).toBe(start); // back where it started after a full cycle
    expect(new Set(seen)).toEqual(new Set(DIFFICULTY_CYCLE));
    expect(Object.keys(DIFFICULTY_LABELS).sort()).toEqual([...DIFFICULTY_CYCLE].sort());
  });

  it('refuses the cycle from a guest, on a human seat, and after RUSH!', () => {
    const guest = lobby({ you: 2, host: 0 });
    expect(cycleBotDifficulty(guest, 1)).toBe(guest);

    const host = lobby();
    expect(cycleBotDifficulty(host, 0)).toBe(host); // your own (human) seat

    const counting = pressRush(host);
    expect(cycleBotDifficulty(counting, 1).seats[1]?.difficulty).toBe(host.seats[1]?.difficulty);
  });

  it('sends difficulties in EMPTY-SEAT order, which is the order the room reads them', () => {
    // `server/room.ts` indexes the list with `castFor(botIndex++)` over seats
    // with no socket — slot order would hand seat 5's tier to seat 2.
    const state = cycleBotDifficulty(
      applyLobbySlots(lobby(), wireSlots(['human', 'human', 'open', 'open', 'open', 'open', 'open', 'open'])),
      4,
    );
    const list = botDifficulties(state);
    expect(list).toHaveLength(6);
    expect(list[2]).toBe(state.seats[4]?.difficulty);
    expect(list).toEqual(state.seats.filter((s) => s.occupant !== 'human').map((s) => s.difficulty));
  });

  it('marks the host on the roster and hands the guest the reason they are waiting', () => {
    expect(lobbyModel(lobby()).seats[0]?.isHost).toBe(true);
    const guest = lobbyModel(lobby({ you: 4, host: 0 }));
    expect(guest.hostControls).toBe(false);
    expect(guest.canStart).toBe(false);
    expect(guest.seats[4]?.isYou).toBe(true);
    expect(guest.seats[4]?.name).toBe('YOU');
    expect(guest.seats[0]?.name).toBe('PLAYER 1');
  });
});

describe('RUSH! (GDD §2.1 — the countdown that starts the match)', () => {
  it('counts 5…1 and says RUSH! again at zero', () => {
    let state = pressRush(lobby());
    expect(canStart(lobby())).toBe(true);
    expect(state.countdown).toBe(RUSH_COUNTDOWN_SECONDS);

    const labels: string[] = [countdownLabel(state)];
    for (let i = 0; i < RUSH_COUNTDOWN_SECONDS; i++) {
      state = tickLobby(state, 1);
      labels.push(countdownLabel(state));
    }
    expect(labels).toEqual(['5', '4', '3', '2', '1', RUSH_LABEL]);
    expect(state.phase).toBe('started');
  });

  it('hands the screen to the match at zero, and never counts twice', () => {
    const started = tickLobby(pressRush(lobby(), 0.5), 1);
    expect(lobbyModel(started).phase).toBe('started');
    expect(tickLobby(started, 1)).toBe(started);
  });

  it('is a no-op from a guest — the creator starts the match (GDD §4.2)', () => {
    const guest = lobby({ you: 3, host: 0 });
    expect(pressRush(guest)).toBe(guest);
    expect(lobbyModel(guest).countdown.active).toBe(false);
  });

  it('ends the lobby when the server says the match is live, whatever the local count', () => {
    const guest = startLobbyMatch(lobby({ you: 3, host: 0 }));
    expect(guest.phase).toBe('started');
    expect(lobbyModel(guest).countdown.label).toBe(RUSH_LABEL);
    // Nothing is claimable once the match owns the screen.
    expect(lobbyModel(guest).seats.some((s) => s.openToJoin)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Variable matches — mode, size, teams, abundance (variable-slots Milestone E)
// ---------------------------------------------------------------------------

describe('the mode toggle (variable-slots E — FFA ⇄ TEAMS)', () => {
  it('opens on FFA and flips to TEAMS and back for the host', () => {
    const ffa = lobby();
    expect(ffa.mode).toBe('ffa');
    expect(lobbyModel(ffa).mode).toBe('ffa');
    const teams = toggleMode(ffa);
    expect(teams.mode).toBe('teams');
    expect(toggleMode(teams).mode).toBe('ffa');
    expect(MODE_LABELS).toEqual({ ffa: 'FFA', teams: 'TEAMS' });
  });

  it('is a no-op from a guest and once RUSH! is pressed', () => {
    const guest = lobby({ you: 2, host: 0 });
    expect(toggleMode(guest)).toBe(guest);
    const counting = pressRush(lobby());
    expect(toggleMode(counting)).toBe(counting);
  });

  it('keeps team assignments across a flip out to FFA and back', () => {
    const teams = cycleSeatTeam(toggleMode(lobby()), 1); // move seat 1 off its default side
    const moved = teams.seats[1]!.team;
    const roundTrip = toggleMode(toggleMode(teams));
    expect(roundTrip.seats[1]!.team).toBe(moved);
  });
});

describe('the seat-state cycle (variable-slots E — OPEN → BOT → CLOSED → OPEN)', () => {
  it('walks an empty seat through the ring and shrinks N when it closes', () => {
    let state = lobby();
    expect(SEAT_STATE_CYCLE).toEqual(['open', 'bot', 'closed']);
    expect(state.seats[1]!.occupant).toBe('open');
    expect(matchSizeOf(state)).toBe(LOBBY_SLOTS);

    state = cycleSeatState(state, 1);
    expect(state.seats[1]!.occupant).toBe('bot');
    expect(matchSizeOf(state)).toBe(LOBBY_SLOTS); // a bot still takes the field

    state = cycleSeatState(state, 1);
    expect(state.seats[1]!.occupant).toBe('closed');
    expect(matchSizeOf(state)).toBe(LOBBY_SLOTS - 1); // a closed seat leaves it

    state = cycleSeatState(state, 1);
    expect(state.seats[1]!.occupant).toBe('open'); // back to the start of the ring
  });

  it('never cycles a human seat, and refuses guests and post-RUSH taps', () => {
    const host = lobby();
    expect(cycleSeatState(host, 0)).toBe(host); // your own (human) seat
    const guest = lobby({ you: 2, host: 0 });
    expect(cycleSeatState(guest, 1)).toBe(guest);
    const counting = pressRush(lobby());
    expect(cycleSeatState(counting, 1)).toBe(counting);
  });

  it('drops a closed seat from the previewed bot cast', () => {
    const closed = cycleSeatState(cycleSeatState(lobby(), 5), 5); // open → bot → closed
    expect(closed.seats[5]!.occupant).toBe('closed');
    expect(closed.seats[5]!.personality).toBeNull();
    expect(lobbyModel(closed).seats[5]!.isClosed).toBe(true);
    expect(lobbyModel(closed).seats[5]!.name).toBe('CLOSED');
    // The closed seat is neither a player nor a bot in the tally.
    const model = lobbyModel(closed);
    expect(model.size).toBe(LOBBY_SLOTS - 1);
    expect(model.humanCount + model.botCount).toBe(model.size);
  });

  it('restores a match at a smaller size, closing the trailing seats', () => {
    const four = lobby({ size: 4 });
    expect(matchSizeOf(four)).toBe(4);
    expect(four.seats.map((s) => s.occupant)).toEqual([
      'human', 'open', 'open', 'open', 'closed', 'closed', 'closed', 'closed',
    ]);
    // Clamped into the legal band, never past the physical seats.
    expect(matchSizeOf(lobby({ size: 1 }))).toBe(MIN_MATCH_SIZE);
    expect(matchSizeOf(lobby({ size: 99 }))).toBe(MAX_MATCH_SIZE);
    expect(matchSizeOf(lobby())).toBe(LOBBY_SLOTS); // absent size = the eight-player game
  });
});

describe('RUSH! gating on size and sides (variable-slots E)', () => {
  it('refuses a start with fewer than two live players', () => {
    // Close every seat but the host's.
    let state = lobby();
    for (let slot = 1; slot < LOBBY_SLOTS; slot++) {
      state = cycleSeatState(cycleSeatState(state, slot), slot); // open → bot → closed
    }
    expect(matchSizeOf(state)).toBe(1);
    expect(canStart(state)).toBe(false);
    expect(pressRush(state)).toBe(state); // and the countdown never starts
  });

  it('in TEAMS needs at least two sides, but allows any split (3v1)', () => {
    const teams = toggleMode(lobby());
    // Force everyone onto side A: one team, not a match.
    let oneSide = teams;
    for (let slot = 0; slot < LOBBY_SLOTS; slot++) {
      while (oneSide.seats[slot]!.team !== 0) oneSide = cycleSeatTeam(oneSide, slot);
    }
    expect(activeTeams(oneSide)).toBe(1);
    expect(canStart(oneSide)).toBe(false);

    // The default alternating split is two sides — a legal, if uneven, match.
    expect(activeTeams(teams)).toBe(2);
    expect(canStart(teams)).toBe(true);
  });
});

describe('team assignment (variable-slots E — any split, counts always shown)', () => {
  it('defaults to an alternating two-side split so small matches are manned', () => {
    for (let slot = 0; slot < LOBBY_SLOTS; slot++) {
      expect(defaultTeamForSlot(slot)).toBe(slot % 2);
    }
    // 2v2 at four, 1v1 at two — never one-sided.
    expect(activeTeams(lobby({ size: 2 }))).toBe(2);
    expect(activeTeams(lobby({ size: 4 }))).toBe(2);
  });

  it('cycles a seat through the sides only in TEAMS, never a closed seat', () => {
    const ffa = lobby();
    expect(cycleSeatTeam(ffa, 1)).toBe(ffa); // FFA ignores sides

    const teams = toggleMode(lobby());
    const start = teams.seats[1]!.team;
    const seen = [start];
    let state = teams;
    for (let i = 0; i < MAX_TEAMS; i++) {
      state = cycleSeatTeam(state, 1);
      seen.push(state.seats[1]!.team);
    }
    expect(seen[MAX_TEAMS]).toBe(start); // a full ring returns home
    expect(new Set(seen).size).toBe(MAX_TEAMS);
    expect(TEAM_LABELS).toHaveLength(MAX_TEAMS);

    // A closed seat has no side to cycle.
    const closed = cycleSeatState(cycleSeatState(teams, 3), 3);
    expect(cycleSeatTeam(closed, 3)).toBe(closed);
  });

  it('is a no-op from a guest and after RUSH!', () => {
    const guest = toggleMode(lobby({ you: 2, host: 0 })); // guests cannot toggle either, but be explicit
    expect(cycleSeatTeam(guest, 1)).toBe(guest);
    const counting = pressRush(toggleMode(lobby()));
    expect(cycleSeatTeam(counting, 1)).toBe(counting);
  });

  it('surfaces per-side counts in the model, always, never blocking a split', () => {
    // 3 on A, 1 on B among four active seats — a legal handicap game.
    let state = toggleMode(lobby({ size: 4 }));
    // seats 0,2 default to A; 1,3 to B. Walk seat 1 around the ring onto A → 3v1.
    while (state.seats[1]!.team !== 0) state = cycleSeatTeam(state, 1);
    const counts = lobbyModel(state).teamCounts;
    const byLabel = Object.fromEntries(counts.map((c) => [c.label, c.count]));
    expect(byLabel[teamLabel(0)]).toBe(3);
    expect(byLabel[teamLabel(1)]).toBe(1);
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(4);
    expect(canStart(state)).toBe(true); // shown, not blocked
  });
});

describe('a side says FRIENDLY or ENEMY, and says it to the right player (u3)', () => {
  // Ratified 2026-08-05, refining m10's `TEAM A`: "Friendly/Enemy plus Letters —
  // Friendly A, Enemy B, Enemy C, Enemy D etc...". The grammar is WORD + LETTER,
  // and the two halves behave differently — which is what these tests pin down.

  it('reads FRIENDLY to its own members and ENEMY to everyone else', () => {
    // The same side, from two different viewers. Nothing about the side changed
    // between these two lines; only who is looking.
    expect(teamName(0, 0)).toBe('FRIENDLY A');
    expect(teamName(0, 1)).toBe('ENEMY A');
    expect(teamName(1, 1)).toBe('FRIENDLY B');
    expect(teamName(1, 0)).toBe('ENEMY B');

    expect(sideRelation(0, 0)).toBe('friendly');
    expect(sideRelation(0, 1)).toBe('enemy');
    expect(SIDE_WORDS).toEqual({ friendly: 'FRIENDLY', enemy: 'ENEMY', neutral: 'TEAM' });
  });

  it('keeps the LETTER absolute — team 1 is B no matter who looks', () => {
    for (let viewer = 0; viewer < MAX_TEAMS; viewer++) {
      for (let team = 0; team < MAX_TEAMS; team++) {
        const [, letter] = teamName(team, viewer).split(' ');
        expect(letter, `team ${team} seen by ${viewer}`).toBe(TEAM_LABELS[team]);
      }
    }
    // Absolute is the whole point: two players on opposite sides name the same
    // third side by the same letter, and differ only in the word.
    expect(teamName(2, 0)).toBe('ENEMY C');
    expect(teamName(2, 1)).toBe('ENEMY C');
  });

  it('names a 3-team and a 4-team match as one FRIENDLY and distinct ENEMYs', () => {
    for (const sides of [3, 4]) {
      const viewer = 0;
      const named = Array.from({ length: sides }, (_, team) => teamName(team, viewer));
      expect(named.filter((n) => n.startsWith('FRIENDLY'))).toEqual(['FRIENDLY A']);
      const enemies = named.filter((n) => n.startsWith('ENEMY'));
      expect(enemies).toHaveLength(sides - 1);
      // No two enemies share a letter — the letter is what tells them apart.
      expect(new Set(enemies).size).toBe(enemies.length);
    }
    expect(Array.from({ length: 4 }, (_, t) => teamName(t, 0))).toEqual([
      'FRIENDLY A',
      'ENEMY B',
      'ENEMY C',
      'ENEMY D',
    ]);
  });

  it('falls back to the bare TEAM <letter> when there is no viewer, never to ENEMY', () => {
    // A replay, a spectator, any view with no local player. It has no "friendly",
    // and it must not answer that by declaring everyone hostile.
    for (const viewer of [undefined, -1, Number.NaN]) {
      expect(teamName(0, viewer)).toBe('TEAM A');
      expect(teamName(1, viewer)).toBe('TEAM B');
      expect(sideRelation(1, viewer)).toBe('neutral');
    }
    // The lobby's own viewer-less case: a roster nobody in it is you.
    const spectating = { ...toggleMode(lobby()), you: 99 };
    expect(viewerTeamOf(spectating)).toBeUndefined();
    expect(lobbyModel(spectating).seats.map((s) => s.teamName.split(' ')[0])).toEqual(
      new Array(LOBBY_SLOTS).fill('TEAM'),
    );
    expect(lobbyModel(spectating).seats.every((s) => s.side === 'neutral')).toBe(true);
  });

  it('re-words the whole roster when the viewer changes sides', () => {
    const teams = toggleMode(lobby()); // you are slot 0 ⇒ side A by default
    const before = lobbyModel(teams);
    expect(viewerTeamOf(teams)).toBe(0);
    expect(before.viewerTeam).toBe(0);
    expect(before.seats[0]!.teamName).toBe('FRIENDLY A');
    expect(before.seats[1]!.teamName).toBe('ENEMY B');

    // Walk YOUR OWN seat onto side B. The letters do not move; the words swap.
    let state = teams;
    while (state.seats[0]!.team !== 1) state = cycleSeatTeam(state, 0);
    const after = lobbyModel(state);
    expect(after.seats[0]!.teamName).toBe('FRIENDLY B');
    expect(after.seats[1]!.teamName).toBe('FRIENDLY B'); // slot 1 was already B
    expect(after.seats[2]!.teamName).toBe('ENEMY A'); // and A is now the far side
    // Every OTHER seat's letter is untouched — the letter is the side's identity,
    // not the viewer's opinion of it. (Slot 0's own letter moved because slot 0
    // genuinely changed sides.)
    expect(after.seats.slice(1).map((s) => s.teamLabel)).toEqual(
      before.seats.slice(1).map((s) => s.teamLabel),
    );
  });

  it('colours the motif blue for friendly and red for enemy — as reinforcement', () => {
    const teams = toggleMode(lobby());
    const model = lobbyModel(teams);
    expect(SIDE_COLORS[model.seats[0]!.side]).toBe(SIDE_COLORS.friendly);
    expect(SIDE_COLORS[model.seats[1]!.side]).toBe(SIDE_COLORS.enemy);

    // The words carry the meaning on their own: strip every colour and the roster
    // still says which side each row is on. This is the m10 ratification (colour
    // alone is insufficient) surviving u3's addition of colour.
    const worded = model.seats.map((s) => s.teamName);
    expect(new Set(worded)).toEqual(new Set(['FRIENDLY A', 'ENEMY B']));

    // …and the identity colours do NOT move: they are per-SLOT (style-guide
    // §3.1) and are how a player tells two ENEMIES apart.
    expect(model.seats.map((s) => s.color)).toEqual(PLAYER_COLORS.slice(0, LOBBY_SLOTS));
  });

  it('paints the two side hues from the frozen palette, legible on Vacuum', () => {
    // Blue is plasma; red is threat red lifted one declared rung toward white
    // (`shotEnemy2` of the enemy-fire ramp) — no seventh hue enters the palette.
    expect(SIDE_COLORS.friendly).toBe(PALETTE.plasma);
    expect(SIDE_COLORS.enemy).toBe(tint(ART_PALETTE.threatRed, 0.32));
    expect(SIDE_COLORS.enemy).toBe(DERIVED.shotEnemy2);
    expect(SIDE_COLORS.neutral).toBe(PALETTE.patina);

    // And both hold against the backdrop at both form factors: raw threat red is
    // 3.2:1 on Vacuum — fine for a filling damage ring, too dim for an 11px word
    // on a phone — so the lifted rung is the one that ships.
    for (const key of ['friendly', 'enemy'] as const) {
      expect(contrastOnVacuum(SIDE_COLORS[key]), `${key} contrast`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastOnVacuum(ART_PALETTE.threatRed)).toBeLessThan(4.5);
  });

  it('shows no side label in FFA — a side there is the player again', () => {
    const ffa = lobbyModel(lobby());
    // FFA is teams-of-one (GDD §2.1 / sim/constants), so a side label there would
    // repeat the nameplate. The mode flag is what the view gates the chip on…
    expect(ffa.mode).toBe('ffa');
    expect(lobbyMatchConfig(lobby()).mode).toBe('ffa');
    // …and the nameplate gate is the same fact on the battlefield: no label, on
    // any slot, whatever the team table happens to hold.
    const plates = nameplateModel(
      Array.from({ length: 4 }, (_, owner) => ({
        owner,
        kind: 'ship' as const,
        alive: true,
        pos: { x: 0, y: 0 },
        radius: 8,
      })),
      [],
      { showTeamLabels: false, viewerTeam: 0 },
      [],
      [0, 1, 2, 3],
    );
    expect(plates.map((p) => p.teamLabel)).toEqual(['', '', '', '']);
    expect(plates.every((p) => p.teamColor === SIDE_COLORS.neutral)).toBe(true);
  });

  it('says the SAME string on the roster row and over that seat\'s hull', () => {
    // One vocabulary, asserted rather than assumed: whatever the lobby row says
    // about a seat is exactly what the nameplate says about it, for the same
    // viewer — including when the viewer is nobody.
    for (const viewerSlot of [0, 1]) {
      let state = toggleMode(lobby({ you: viewerSlot }));
      // A three-side split, so the assertion covers more than "us and them".
      while (state.seats[2]!.team !== 2) state = cycleSeatTeam(state, 2);
      const model = lobbyModel(state);
      const teams = model.seats.map((s) => s.team);
      for (const seat of model.seats) {
        expect(
          resolveTeamLabel(teams, seat.player, {
            showTeamLabels: true,
            ...(model.viewerTeam !== undefined ? { viewerTeam: model.viewerTeam } : {}),
          }),
          `seat ${seat.player} seen by ${viewerSlot}`,
        ).toBe(seat.teamName);
      }
    }
  });
});

describe('the abundance row (ratified p11 — SCARCE / STANDARD / RICH)', () => {
  it('opens on the ratified SCARCE default and walks the ring', () => {
    const state = lobby();
    expect(state.abundance).toBe(DEFAULT_ABUNDANCE);
    expect(DEFAULT_ABUNDANCE).toBe('scarce');
    expect(ABUNDANCE_CYCLE).toEqual(['scarce', 'standard', 'rich']);

    const seen = [state.abundance];
    let s = state;
    for (let i = 0; i < ABUNDANCE_CYCLE.length; i++) {
      s = cycleAbundance(s);
      seen.push(s.abundance);
    }
    expect(seen).toEqual(['scarce', 'standard', 'rich', 'scarce']);
    expect(Object.keys(ABUNDANCE_LABELS).sort()).toEqual([...ABUNDANCE_CYCLE].sort());
    expect(lobbyModel(cycleAbundance(state)).abundance).toBe('standard');
  });

  it('is a no-op from a guest and after RUSH!', () => {
    const guest = lobby({ you: 2, host: 0 });
    expect(cycleAbundance(guest)).toBe(guest);
    const counting = pressRush(lobby());
    expect(cycleAbundance(counting)).toBe(counting);
  });
});

describe('lobbyMatchConfig — the one handoff to the wire and the world', () => {
  it('round-trips through the sim config seam: FFA is teams-of-one, dense', () => {
    const config = lobbyMatchConfig(lobby());
    expect(config.mode).toBe('ffa');
    expect(config.slots).toHaveLength(LOBBY_SLOTS);
    expect(matchSize(config)).toBe(LOBBY_SLOTS);
    const players = configToPlayers(config);
    expect(players.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // teams-of-one: each dense player is its own team.
    expect(players.every((p) => p.team === p.id)).toBe(true);
  });

  it('drops closed seats from the world and re-denses the roster', () => {
    // Close seats 6 and 7 → a six-player match, ids 0..5.
    let state = lobby();
    for (const slot of [6, 7]) state = cycleSeatState(cycleSeatState(state, slot), slot);
    const config = lobbyMatchConfig(state);
    expect(matchSize(config)).toBe(6);
    expect(activeSlots(config)).toHaveLength(6);
    expect(configToPlayers(config).map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('carries the authored team table in TEAMS, and abundance in both modes', () => {
    const teams = cycleAbundance(toggleMode(lobby({ size: 4 }))); // teams, standard abundance
    const config = lobbyMatchConfig(teams);
    expect(config.mode).toBe('teams');
    expect(config.abundance).toBe('standard');
    const active = activeSlots(config);
    // Alternating default: A B A B across slots 0..3.
    expect(active.map((s) => s.team)).toEqual([0, 1, 0, 1]);
    // configToPlayers keeps the authored side (not the dense id) in TEAMS.
    expect(configToPlayers(config).map((p) => p.team)).toEqual([0, 1, 0, 1]);
  });

  it('reads an OPEN preview as a joinable seat online but a bot offline', () => {
    // Offline: no wire for a joiner, so an empty seat is a bot in the config.
    const offline = lobbyMatchConfig(lobby({ online: false }));
    expect(offline.slots[1]!.state).toBe('bot');
    expect(offline.slots[1]!.botPersonality).toBeTruthy();
    expect(offline.slots[1]!.botDifficulty).toBeTruthy();
    // Online: the same seat stays open to a room-code joiner.
    expect(lobbyMatchConfig(lobby({ online: true })).slots[1]!.state).toBe('open');
    // The local human is always a live competitive seat, never a bot.
    expect(offline.slots[0]!.state).toBe('open');
  });
});

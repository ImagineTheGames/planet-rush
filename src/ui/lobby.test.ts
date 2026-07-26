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
  CLASS_ORDER,
  CLASS_OPTIONS,
  COLOR_NAMES,
  DEFAULT_SHIP_CLASS,
  DIFFICULTY_CYCLE,
  DIFFICULTY_LABELS,
  LOBBY_SLOTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RUSH_COUNTDOWN_SECONDS,
  RUSH_LABEL,
  applyLobbySlots,
  botDifficulties,
  canStart,
  castForEmptySeat,
  classLocked,
  colorName,
  countdownLabel,
  createLobby,
  cycleBotDifficulty,
  defaultDifficultyForEmptySeat,
  eraseRoomCode,
  isJoinableRoomCode,
  lobbyModel,
  makeRoomCode,
  normalizeRoomCode,
  pressRush,
  seatLocalPlayer,
  selectMap,
  selectShipClass,
  startLobbyMatch,
  tickLobby,
  typeRoomCode,
} from './lobby';
import type { LobbyState } from './lobby';
import { DEFAULT_MAP_ID, MAPS } from '../sim/maps';

const ROOM = 'K7QM';

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

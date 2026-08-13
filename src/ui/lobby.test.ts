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
import type { PlayerId } from '@shared/types';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import { PERSONALITIES, ROSTER } from '../bots';
import type { PersonalityId } from '../bots';
import type { LobbySlot } from '../net/transport';
import {
  ABUNDANCE_CYCLE,
  ABUNDANCE_LABELS,
  CLAIM_LABELS,
  claimLabel,
  CLASS_ORDER,
  CLASS_OPTIONS,
  COLOR_NAMES,
  DEFAULT_SHIP_CLASS,
  CHARACTER_CYCLE,
  DIFFICULTY_LABELS,
  LOBBY_SLOTS,
  MAX_TEAMS,
  MODE_LABELS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RUSH_COUNTDOWN_SECONDS,
  RUSH_LABEL,
  SEAT_STATE_CYCLE,
  SEAT_STATE_LABELS,
  SOLO_SEAT_STATE_CYCLE,
  seatStateCycle,
  showsClaimControl,
  toggleClaim,
  SIDE_COLORS,
  SIDE_WORDS,
  STAT_PIPS,
  STAT_PIP_COLORS,
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
  denseSeatIndex,
  lobbyWireSeats,
  lobbyWireTeams,
  startRefusal,
  NEEDS_TWO,
  cycleAbundance,
  cycleSeatCharacter,
  cycleSeatState,
  cycleSeatTeam,
  defaultCharacterForEmptySeat,
  seatDifficulty,
  defaultTeamForSlot,
  eraseRoomCode,
  isJoinableRoomCode,
  lobbyMatchConfig,
  lobbyRosterCast,
  lobbyRosterTeams,
  lobbyModel,
  makeRoomCode,
  matchSizeOf,
  // The room's three screens (u10-01) and the two picks their cards open.
  openMapSelect,
  openShipSelect,
  pickMap,
  pickShipClass,
  shipCardFor,
  nameFor,
  normalizePlayerName,
  normalizeRoomCode,
  playerNameTable,
  pressRush,
  seatLocalPlayer,
  selectMap,
  selectShipClass,
  setPlayerName,
  shipStatLines,
  sideRelation,
  sideRosterOf,
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
import type { LobbyState, SeatOccupant } from './lobby';
import { nameplateModel, resolveTeamLabel } from './nameplates';
import { countPrimaries, singlePrimary } from './gantry';
import { lobbyPlateRoles } from './lobby-view';
// The art direction itself, so the two side hues are pinned to the frozen palette
// and its declared ramp rather than to a hex typed twice (the same cross-check
// `./chrome.test` runs on the panel chrome).
import { PALETTE as ART_PALETTE, DERIVED, tint } from '../art/palette';
import { BONE, MATERIAL_SHADES } from '../art/materials';
import { DEFAULT_MAP_ID, MAPS } from '../sim/maps';
// The sim's own class table — the source the hull tiles' figures must match
// exactly (u4: never a hand-copied table).
import { DEFAULT_ABUNDANCE, SHIP_STATS } from '../sim/constants';
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
/** A cool neutral: no channel warmer than the blue one. Bone is a value ramp on
 *  hull steel, so every tone it produces has to pass this — the same oracle
 *  `src/art/materials.test.ts` runs over the whole plate vocabulary. */
function isCoolNeutral(color: number): boolean {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return b >= g && g >= r;
}

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

/** An ONLINE room — the default flavour of {@link createLobby}. Since a0-11 it
 *  opens **empty**: you in your seat, seven OPEN chairs and no bots at all. */
function lobby(overrides: Partial<Parameters<typeof createLobby>[0]> = {}): LobbyState {
  return createLobby({ room: ROOM, you: 0, ...overrides });
}

/**
 * The SOLO lobby — the offline flavour, whose non-host seats open on the bot cast
 * (there is no wire for a human to arrive on, so an OPEN seat would be a chair
 * nobody could ever take).
 *
 * Most of the tests below are about the cast, the tiers, the sides or `N`, and
 * every one of those needs a roster with bots in it. Before a0-11 the online room
 * had one by default and they simply said `lobby()`; now a test that wants bots
 * has to *say* it wants bots, which is the point of the change.
 */
function solo(overrides: Partial<Parameters<typeof createLobby>[0]> = {}): LobbyState {
  return createLobby({ room: ROOM, you: 0, online: false, ...overrides });
}

/**
 * Tap a seat's character until it reads `want` — **bounded**, and that bound is
 * the whole point.
 *
 * These used to be bare `while` loops. Every cycler in this file is a no-op on a
 * seat it refuses (`cycleSeatCharacter` ignores a non-bot seat, `cycleSeatTeam` a
 * closed one), so a loop pointed at the wrong fixture does not fail — it spins,
 * silently, forever. That is not a theoretical worry: after a0-11 made an online
 * `lobby()` open EMPTY, one such loop hung this whole file, and a hung file means
 * `npm test` never finishes and never reports, which reads exactly like a slow
 * box. Two of those runs were still spinning hours later.
 *
 * A full lap is the most any cycler can need, so anything past one lap is proof
 * the seat is refusing the tap. Throw and name the seat: a wrong fixture should
 * cost one red test, not the suite.
 */
function cycleCharacterTo(state: LobbyState, slot: PlayerId, want: PersonalityId): LobbyState {
  let next = state;
  for (let i = 0; i <= ROSTER.length; i++) {
    if (next.seats[slot]!.character === want) return next;
    next = cycleSeatCharacter(next, slot);
  }
  throw new Error(
    `seat ${slot} never reached '${want}' — occupant '${state.seats[slot]!.occupant}' refuses the tap`,
  );
}

/**
 * {@link cycleCharacterTo}'s twin for the seat-state ring.
 *
 * Counting taps is what broke here: which rung a seat *starts* on is the
 * flavour's business since a0-11 (solo opens on `bot`, online on `open`), so
 * "two taps reaches CLOSED" was only ever true of the old default. Name the rung
 * you want and let the ring find it.
 */
function cycleStateTo(state: LobbyState, slot: PlayerId, want: SeatOccupant): LobbyState {
  let next = state;
  for (let i = 0; i <= SEAT_STATE_CYCLE.length; i++) {
    if (next.seats[slot]!.occupant === want) return next;
    next = cycleSeatState(next, slot);
  }
  throw new Error(`seat ${slot} never reached '${want}' — the ring refuses the tap`);
}

/** {@link cycleCharacterTo}'s twin for sides, bounded by one lap of MAX_TEAMS. */
function cycleTeamTo(state: LobbyState, slot: PlayerId, want: number): LobbyState {
  let next = state;
  for (let i = 0; i <= MAX_TEAMS; i++) {
    if (next.seats[slot]!.team === want) return next;
    next = cycleSeatTeam(next, slot);
  }
  throw new Error(
    `seat ${slot} never reached side ${want} — occupant '${state.seats[slot]!.occupant}' refuses the tap`,
  );
}

/** A wire lobby snapshot: `ready` marks a seated human, `isBot` a seated bot, and
 *  `state` is what the seat is *set* to for everything else (a0-11) — the three
 *  fields `server/room.ts` publishes (`lobbyState()`). */
function wireSlots(spec: readonly ('human' | 'bot' | 'open' | 'closed')[]): LobbySlot[] {
  return spec.map((kind, player) => ({
    player,
    isBot: kind === 'bot',
    shipClass: DEFAULT_SHIP_CLASS,
    ready: kind === 'human',
    state: kind === 'human' ? ('open' as const) : kind,
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
    // Every other seat is OPEN and EMPTY — no bot, no cast preview (a0-11).
    for (const seat of state.seats.filter((s) => s.player !== 3)) {
      expect(seat.occupant).toBe('open');
      expect(seat.personality).toBeNull();
    }
  });

  // ── a0-11 TEST 1 — the developer's report, stated as an assertion ──────────
  // "when creating a room to play online it should start with all slots OPEN and
  // no bots in it (it should be up to player to fill it up with bots if they want)"
  it('a freshly created ROOM has zero bot seats and zero AI in the cast preview', () => {
    const state = lobby();
    expect(state.seats.filter((s) => s.occupant === 'bot')).toHaveLength(0);
    expect(state.seats.filter((s) => s.personality !== null)).toHaveLength(0);
    expect(state.seats.filter((s) => s.occupant === 'open')).toHaveLength(LOBBY_SLOTS - 1);

    // …and the same read through the frame model the view actually draws, which
    // is where a preview would have to show up to mislead anybody.
    const model = lobbyModel(state);
    expect(model.botCount).toBe(0);
    expect(model.humanCount).toBe(1);
    expect(model.size).toBe(1);
    expect(model.seats.filter((s) => s.isBot)).toHaveLength(0);
    expect(model.seats.filter((s) => s.state === 'open').map((s) => s.name)).toEqual(
      Array.from({ length: LOBBY_SLOTS - 1 }, () => 'OPEN'),
    );
    // No row is offering a difficulty for a bot that is not there.
    expect(model.seats.some((s) => s.botDifficulty !== undefined)).toBe(false);
  });

  it('the SOLO lobby still opens on the bot cast — there is no wire for a joiner', () => {
    // The developer's report is about the room you create to play ONLINE. Offline
    // an OPEN seat would be a chair nobody could ever take, so the solo lobby
    // seats the cast and says BOT on the rows that are bots.
    const state = solo();
    expect(state.seats.filter((s) => s.occupant === 'bot')).toHaveLength(LOBBY_SLOTS - 1);
    expect(matchSizeOf(state)).toBe(LOBBY_SLOTS);
    expect(canStart(state)).toBe(true);
    expect(lobbyModel(state).seats.filter((s) => s.openToJoin)).toHaveLength(0);
  });

  it('previews the whole seven-character cast in an untouched solo lobby (GDD §2.9)', () => {
    // Bots are "characters, not difficulty labels": a lobby nobody has touched
    // should read as a full house of distinct rivals, not seven Mediums.
    const names = solo()
      .seats.filter((s) => s.personality)
      .map((s) => s.personality);
    expect(names).toHaveLength(LOBBY_SLOTS - 1);
    expect(new Set(names).size).toBe(ROSTER.length);
    expect([...names].sort()).toEqual([...ROSTER].sort());
  });

  it('starts each empty seat on its own roster-order character', () => {
    // Rusty, Bolt, Foreman, Patch, Sable, Vulture, Warden — one of each, at each
    // character's own tier, which is the roster this screen has always previewed.
    for (let i = 0; i < ROSTER.length; i++) {
      expect(defaultCharacterForEmptySeat(i)).toBe(ROSTER[i]);
    }
  });

  it('keeps every other seat’s character when a human arrives', () => {
    // Before a0-06 the cast was recomputed from empty-seat order on every state
    // change, so a joiner reshuffled the whole roster under the host. The
    // character is authored per seat now: a human taking seat 1 takes seat 1's
    // character out of the match and moves nobody else.
    //
    // Seated as BOT rather than OPEN (a0-11): an open seat casts nobody, so an
    // all-open fixture would assert this over a roster with no bots in it.
    const before = solo();
    const after = applyLobbySlots(before, wireSlots(['human', 'human', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot']));

    expect(after.seats[1]?.occupant).toBe('human');
    expect(after.seats[1]?.personality).toBeNull();

    const bots = after.seats.filter((s) => s.occupant === 'bot');
    expect(bots).toHaveLength(LOBBY_SLOTS - 2);
    for (const seat of bots) {
      expect(seat.personality).toBe(before.seats[seat.player]?.character);
    }
  });

  it('renames a seat the SERVER re-tiered, to the name the server will seat', () => {
    // The wire carries a tier and no character, so a bot the room has genuinely
    // put on another tier has to resolve through `server/room.ts`'s own rule
    // rather than keep a name this client invented.
    const before = solo();
    const slots = wireSlots(['human', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot']).map((s, i) =>
      i === 3 ? { ...s, botDifficulty: 'hard' as const } : s,
    );
    const after = applyLobbySlots(before, slots);
    // Seat 3 defaults to a non-Hard character; the wire says Hard, so it becomes a
    // Hard one — and specifically the one `castFor` picks for its bot index.
    expect(PERSONALITIES[before.seats[3]!.character].difficulty).not.toBe('hard');
    expect(PERSONALITIES[after.seats[3]!.character].difficulty).toBe('hard');
    // A seat the wire agrees with is untouched.
    expect(after.seats[2]?.character).toBe(before.seats[2]?.character);
  });

  it('mirrors the server’s cast rule, repeats and all', () => {
    // Four Hard seats and three Hard characters: the fourth row must show the
    // repeat the room is going to seat rather than a name the lobby invented.
    const picks = [0, 1, 2, 3].map((i) => castForEmptySeat(i, 'hard'));
    expect(new Set(picks).size).toBe(3);
    expect(picks[3]).toBe(picks[0]);
  });

  it('reads a bot seat, a human seat and an open seat off one wire snapshot', () => {
    // The rule: isBot ⇒ bot, ready ⇒ human, otherwise whatever the room says the
    // seat is SET to (`LobbySlot.state`, a0-11). It has to read both authorities
    // — the match server (bots seated at RUSH!) and LocalLoopback (at once).
    const state = applyLobbySlots(lobby(), wireSlots(['human', 'bot', 'open', 'bot', 'open', 'open', 'open', 'open']));
    expect(state.seats.map((s) => s.occupant)).toEqual([
      'human', 'bot', 'open', 'bot', 'open', 'open', 'open', 'open',
    ]);

    const model = lobbyModel(state);
    expect(model.humanCount).toBe(1);
    // Two bots, not seven: the five OPEN seats are empty chairs (a0-11).
    expect(model.botCount).toBe(2);
    expect(model.size).toBe(3);
    // Only a seat nobody holds is still claimable by room code (GDD §4.2).
    expect(model.seats.filter((s) => s.openToJoin).map((s) => s.player)).toEqual([2, 4, 5, 6, 7]);
    expect(model.seats[1]?.openToJoin).toBe(false);
  });

  // ── a0-11 — the host's authoring survives the room's own broadcast ─────────
  it('does not let a lobbyState broadcast undo the host’s BOT and CLOSED seats', () => {
    // The server seats no bot until RUSH!, so every broadcast before it reads
    // "not a bot yet" for a seat the host deliberately set to BOT. Folding that
    // in blind would wipe the host's own authoring, on the host's own screen.
    let state = lobby();
    state = cycleSeatState(state, 1); // OPEN → BOT
    state = cycleSeatState(cycleSeatState(state, 2), 2); // OPEN → BOT → CLOSED
    const echoed = applyLobbySlots(state, wireSlots(['human', 'bot', 'closed', 'open', 'open', 'open', 'open', 'open']));
    expect(echoed.seats.map((s) => s.occupant)).toEqual([
      'human', 'bot', 'closed', 'open', 'open', 'open', 'open', 'open',
    ]);

    // …and a pre-a0-11 room, which sends no `state` at all, leaves the seat on
    // whatever it already was rather than re-opening it.
    const legacy = state.seats.map((seat) => ({
      player: seat.player,
      isBot: false,
      shipClass: DEFAULT_SHIP_CLASS,
      ready: seat.occupant === 'human',
    }));
    expect(applyLobbySlots(state, legacy).seats.map((s) => s.occupant)).toEqual([
      'human', 'bot', 'closed', 'open', 'open', 'open', 'open', 'open',
    ]);
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

  it('gives each hull a name, a hull, a role blurb — AND its stats (u4)', () => {
    // This assertion is the INVERSION of the one that stood here until
    // 2026-08-05, which required `${name} ${hull} ${blurb}` to contain no digit
    // at all — the enforcement of "ship stats appear only in the upgrade panel".
    // The developer ratified the opposite ("both pips and numbers") and GDD §2.5
    // / §2.11 were amended, so the gate is rewritten to describe the design that
    // exists rather than left skipped as furniture.
    for (const option of CLASS_OPTIONS) {
      expect(option.name.length).toBeGreaterThan(0);
      expect(option.hull.length).toBeGreaterThan(0);
      expect(option.blurb.length).toBeGreaterThan(0);
      // The prose is still prose — a stat belongs in the stat block, not smuggled
      // into a sentence where nothing lines it up against the other three hulls.
      expect(`${option.name} ${option.hull} ${option.blurb}`).not.toMatch(/\d/);
      // …and the stats are there, in GDD §2.11's table order, every one of them
      // carrying BOTH channels: a figure and a pip count.
      expect(option.stats.map((s) => s.key)).toEqual(STAT_KEYS);
      for (const stat of option.stats) {
        expect(stat.label.length, `${option.name} ${stat.key} label`).toBeGreaterThan(0);
        expect(stat.text, `${option.name} ${stat.key} figure`).toMatch(/\d/);
        expect(stat.pips).toBeGreaterThanOrEqual(1);
        expect(stat.pips).toBeLessThanOrEqual(STAT_PIPS);
        expect(stat.pipMax).toBe(STAT_PIPS);
      }
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
    const picked = selectShipClass(solo(), ShipClass.Interceptor);
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
// 2a. Ship stats on ship-select — pips AND numbers (u4, ratified 2026-08-05)
// ---------------------------------------------------------------------------
//
// The developer, asked whether ship stats could appear on ship-select having been
// shown coarse pips: **"both pips and numbers."** GDD §2.5 and §2.11 carry the
// matching *(amended 2026-08-05)* marker. These are the two guarantees that make
// the reversal safe rather than merely permitted:
//
//   1. the figures come from the SIM's own class table, so the screen cannot
//      advertise a game the simulation is not running; and
//   2. the pips and the figure are two renderings of ONE value, so a tile cannot
//      show four pips beside a number that means three.
//
// The build wheel is deliberately untouched by all of this: a segment's numeric
// keys are still exactly `['angle', 'cost']` and UPGRADE SHIP still carries an
// arrow rather than a number — pinned in `./build-wheel.test.ts`, which this
// brief did not go near.

/** GDD §2.11's table columns, in order — the stats a tile shows. */
const STAT_KEYS = ['speed', 'accel', 'turn', 'hull', 'power', 'cargo'] as const;

/** The `SHIP_STATS` field each key is read from — the mapping this screen claims
 *  to make, restated independently here so the test would catch it silently
 *  reading `accelMul` under the SPD label. */
const STAT_SOURCE: Readonly<Record<(typeof STAT_KEYS)[number], keyof (typeof SHIP_STATS)[ShipClass.Vanguard]>> = {
  speed: 'speedMul',
  accel: 'accelMul',
  turn: 'turnMul',
  hull: 'hull',
  power: 'power',
  cargo: 'cargo',
};

/** The figure as a NUMBER again — `130%` → 1.3, `35` → 35. Reading the printed
 *  string back is the only way to assert the *player's* number is the sim's; an
 *  assertion against `stat.value` alone would pass on a broken formatter. */
function parseFigure(text: string): number {
  const n = Number.parseFloat(text);
  return text.trim().endsWith('%') ? n / 100 : n;
}

describe('ship stats on ship-select (u4 — "both pips and numbers")', () => {
  it('reads every figure off the SIM class table, never a hand-copied one', () => {
    for (const option of CLASS_OPTIONS) {
      const source = SHIP_STATS[option.shipClass];
      for (const stat of option.stats) {
        expect(stat.value, `${option.name} ${stat.key}`).toBe(source[STAT_SOURCE[stat.key]]);
      }
    }
    // …and the accessor is the same one the tiles were built from, so a caller
    // that asks for a class's stats gets exactly what its tile shows.
    for (const cls of CLASS_ORDER) {
      const tile = CLASS_OPTIONS.find((o) => o.shipClass === cls)!;
      expect(shipStatLines(cls)).toEqual(tile.stats);
    }
  });

  it('prints the number the sim honours — the figure IS the value', () => {
    for (const option of CLASS_OPTIONS) {
      for (const stat of option.stats) {
        expect(parseFigure(stat.text), `${option.name} ${stat.key} = ${stat.text}`).toBeCloseTo(
          stat.value,
          6,
        );
      }
    }
    // Spot-checked against GDD §2.11's own table, so a silent unit change (a
    // multiplier printed raw as `1.3`) fails here rather than on a phone.
    const interceptor = CLASS_OPTIONS.find((o) => o.shipClass === ShipClass.Interceptor)!;
    expect(interceptor.stats.map((s) => s.text)).toEqual(['130%', '120%', '140%', '35', '8', '2']);
    const hauler = CLASS_OPTIONS.find((o) => o.shipClass === ShipClass.Hauler)!;
    expect(hauler.stats.map((s) => s.text)).toEqual(['85%', '80%', '85%', '70', '9', '3']);
  });

  it('never shows pips that disagree with the number beside them', () => {
    // The load-bearing assertion of this brief. Both channels hang off one
    // `value`, so across the four hulls the pip order can never contradict the
    // figure order: a hull that shows MORE pips than another must also show a
    // BIGGER number for that stat, on every stat, for every pair of hulls.
    for (const key of STAT_KEYS) {
      const rows = CLASS_OPTIONS.map((o) => ({
        name: o.name,
        stat: o.stats.find((s) => s.key === key)!,
      }));
      for (const a of rows) {
        for (const b of rows) {
          if (a.stat.pips === b.stat.pips) continue;
          const claim = `${key}: ${a.name} ${a.stat.text}/${a.stat.pips}pip vs ${b.name} ${b.stat.text}/${b.stat.pips}pip`;
          expect(a.stat.pips > b.stat.pips, claim).toBe(
            parseFigure(a.stat.text) > parseFigure(b.stat.text),
          );
        }
      }
    }
  });

  it('spends the whole bar on the four hulls, so the pips actually compare', () => {
    // A pip bar that reads 4/5 on every hull compares nothing. Each stat's scale
    // is the spread across the roster, so the roster's worst hull reads one pip
    // and its best reads five — and the FIGURE beside it is what keeps the
    // absolute truth on screen.
    for (const key of STAT_KEYS) {
      const stats = CLASS_OPTIONS.map((o) => o.stats.find((s) => s.key === key)!);
      const values = stats.map((s) => s.value);
      const pips = stats.map((s) => s.pips);
      if (Math.min(...values) === Math.max(...values)) {
        // No spread to show (every hull equal) — every tile reads full rather
        // than parking the roster on some arbitrary middle rung.
        expect(new Set(pips)).toEqual(new Set([STAT_PIPS]));
        continue;
      }
      expect(Math.min(...pips), `${key} floor`).toBe(1);
      expect(Math.max(...pips), `${key} ceiling`).toBe(STAT_PIPS);
    }
    // The Interceptor is the roster's fast, nimble, papery knife and the Hauler
    // its hold-carrying tank (GDD §2.11) — the pips say so at a glance.
    const stat = (cls: ShipClass, key: (typeof STAT_KEYS)[number]) =>
      CLASS_OPTIONS.find((o) => o.shipClass === cls)!.stats.find((s) => s.key === key)!.pips;
    expect(stat(ShipClass.Interceptor, 'speed')).toBe(STAT_PIPS);
    expect(stat(ShipClass.Interceptor, 'hull')).toBe(1);
    expect(stat(ShipClass.Hauler, 'hull')).toBe(STAT_PIPS);
    expect(stat(ShipClass.Hauler, 'cargo')).toBe(STAT_PIPS);
    expect(stat(ShipClass.Excavator, 'power')).toBe(STAT_PIPS);
  });

  it('draws the pips in CHROME — never signal yellow, never threat red, and under Bone no hue at all', () => {
    // Cold Vacuum's load-bearing rule (style-guide §2): signal yellow means ore
    // or danger and nothing else, and threat red is damage. A pip is neither.
    const pips = Object.values(STAT_PIP_COLORS);
    for (const color of pips) {
      expect(color).not.toBe(PALETTE.signalYellow);
      expect(color).not.toBe(ART_PALETTE.signalYellow);
      expect(color).not.toBe(PALETTE.threatRed);
      expect(color).not.toBe(SIDE_COLORS.enemy);
    }

    // …and since u7-03 the pips spend no hue at all: the ratified Gantry/Bone
    // direction makes selection a BRIGHTER PLATE rather than a colour, so the
    // pips moved onto the Bone value ramp (the same treatment the settings
    // screen's volume pips take). Each is a declared step on hull steel, which
    // `src/art/materials.test.ts` recomputes from its recipe — so a hand-edited
    // hex cannot smuggle a seventh hue in here any more than into a ship.
    expect(STAT_PIP_COLORS.selected).toBe(BONE.hi);
    expect(STAT_PIP_COLORS.filled).toBe(MATERIAL_SHADES.bone);
    expect(STAT_PIP_COLORS.empty).toBe(MATERIAL_SHADES.chipFaceLit);
    for (const color of pips) expect(isCoolNeutral(color)).toBe(true);
    // The filled-but-unselected pip has to read at 3px against Vacuum — the same
    // bar every other tone on this screen clears.
    expect(contrastOnVacuum(STAT_PIP_COLORS.filled)).toBeGreaterThan(4.5);
    // …and the unfilled remainder must be visibly DARKER than a filled one, which
    // is the whole read of a pip bar once the hue is gone.
    expect(contrastOnVacuum(STAT_PIP_COLORS.filled)).toBeGreaterThan(
      contrastOnVacuum(STAT_PIP_COLORS.empty) * 2,
    );
  });
});

// ---------------------------------------------------------------------------
// 2b. Arena select and the lock at start (p2 field rule — the picker moved here)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2c. Gantry/Bone — the one-primary rule, on the screen with the most controls
// ---------------------------------------------------------------------------

describe('Gantry/Bone: RUSH! is the lobby’s ONE bright plate (u7-03)', () => {
  it('draws exactly one primary plate, whatever the roster is doing', () => {
    // Bone spends no hue on a menu, so the primary action is simply the
    // brightest plate on the screen — which only works while there is exactly
    // one of them (`./gantry` `singlePrimary`, and the handoff's own constraint:
    // *"the primary relies on brightness and size rather than hue, so it must
    // never share a screen with a second bright plate"*).
    //
    // This is the screen where that is easiest to lose: eight roster rows, four
    // hull tiles, four arena cards, two toggles and three per-row controls, any
    // of which could reach for "make the selected one bright". The selected hull
    // is `secondary` for exactly that reason.
    for (const state of [
      lobby(),
      selectShipClass(lobby(), ShipClass.Hauler),
      pressRush(lobby()),
      toggleMode(lobby()),
      cycleSeatState(lobby(), 3),
    ]) {
      const roles = lobbyPlateRoles(lobbyModel(state));
      expect(countPrimaries(roles), 'more than one bright plate on the lobby').toBe(1);
      expect(singlePrimary(roles)).toBe(true);
    }
  });

  it('marks the two summary cards as RAISED plates, never as second primaries', () => {
    const model = lobbyModel(selectShipClass(lobby(), ShipClass.Hauler));
    const roles = lobbyPlateRoles(model);
    // Three `secondary`: BACK, the one hull card and the one arena card (u10-01 —
    // the lobby shows the PICK, so both cards are always the pick and both are
    // always raised; the unselected-hull `inert` case moved to SHIP SELECT with the
    // three tiles it belonged to). The eight roster rows are the surfaces.
    expect(roles.filter((r) => r === 'secondary')).toHaveLength(3);
    expect(roles.filter((r) => r === 'inert')).toHaveLength(LOBBY_SLOTS);
    // …and still exactly one bright plate, which is the rule this whole block is
    // about: adding a card must not add a primary.
    expect(countPrimaries(roles)).toBe(1);
  });
});

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
    const picked = selectMap(solo(), 'compass');
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
    const s = setPlayerName(solo({ you: 0 }), 'Ace');
    expect(nameFor(s, 0)).toBe('Ace');
    // Slot 1 is the first bot in roster order — its personality name (GDD §2.9).
    const firstBot = s.seats[1]!;
    expect(firstBot.personality).not.toBeNull();
    expect(nameFor(s, 1)).toBe(PERSONALITIES[firstBot.personality!].name);
  });

  it('playerNameTable: one entry per slot, local name + the whole bot cast', () => {
    const s = setPlayerName(solo({ you: 0 }), 'Ace');
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

describe('host controls (GDD §2.1 amended — the host picks each bot’s CHARACTER)', () => {
  it('cycles a bot seat through the whole roster and back', () => {
    // SOLO, because only a true `bot` seat has a character to cycle (a0-11) —
    // an online room's seats start OPEN and `cycleSeatCharacter` refuses them.
    let state = solo();
    const start = state.seats[1]!.character;
    const seen = [start];
    for (let i = 0; i < ROSTER.length; i++) {
      state = cycleSeatCharacter(state, 1);
      seen.push(state.seats[1]!.character);
    }
    // Back where it started after a full lap, and every character reachable.
    expect(seen[ROSTER.length]).toBe(start);
    expect(new Set(seen)).toEqual(new Set(CHARACTER_CYCLE));
  });

  it('shows the tier, and shows the tier of the character that is actually seated', () => {
    // The load-bearing property of the whole change: there is no second value to
    // disagree with the cast, so a row can never advertise a difficulty the bot in
    // it will not fly (the developer's "i chose HARD … they were at other
    // difficulties"). Walk every character and check the chip follows.
    //
    // SOLO for the same reason as the lap test above: an online seat is OPEN and
    // refuses the tap, so this would walk nowhere and assert one row seven times.
    let state = solo();
    for (let i = 0; i < ROSTER.length; i++) {
      const seat = state.seats[1]!;
      expect(seatDifficulty(seat)).toBe(PERSONALITIES[seat.character].difficulty);
      expect(lobbyModel(state).seats[1]?.botDifficulty).toBe(PERSONALITIES[seat.character].difficulty);
      state = cycleSeatCharacter(state, 1);
    }
    expect(Object.keys(DIFFICULTY_LABELS).sort()).toEqual(['easy', 'hard', 'medium']);
  });

  it('lets the host seat the same character twice — the balanced 4v4 needs it', () => {
    // Eight slots, seven characters, three of them Hard: the developer's stated
    // goal of four Hard bots is not reachable without a repeat, so forbidding one
    // would make their own use case impossible.
    //
    // SOLO, because seating a character needs seats with bots in them: since
    // a0-11 an online `lobby()` opens with seven OPEN chairs and no cast at all.
    let state = solo();
    for (const slot of [1, 2, 3, 4]) {
      state = cycleCharacterTo(state, slot, 'warden');
    }
    expect([1, 2, 3, 4].map((i) => state.seats[i]!.character)).toEqual([
      'warden', 'warden', 'warden', 'warden',
    ]);
    // …and a repeat is NAMED apart rather than refused.
    expect([1, 2, 3, 4].map((i) => nameFor(state, i))).toEqual([
      'Warden 1', 'Warden 2', 'Warden 3', 'Warden 4',
    ]);
    // A character that does NOT repeat keeps its bare name.
    expect(nameFor(state, 5)).toBe(PERSONALITIES[state.seats[5]!.character].name);
  });

  it('refuses the cycle from a guest, on a human seat, and after RUSH!', () => {
    const guest = solo({ you: 2, host: 0 });
    expect(cycleSeatCharacter(guest, 1)).toBe(guest);

    const host = solo();
    expect(cycleSeatCharacter(host, 0)).toBe(host); // your own (human) seat

    const counting = pressRush(host);
    expect(cycleSeatCharacter(counting, 1).seats[1]?.character).toBe(host.seats[1]?.character);
  });

  it('sends difficulties in BOT-SEAT order, derived from the chosen cast', () => {
    // `server/room.ts` indexes the list with `castFor(botIndex++)` over the seats
    // it seats a bot in — slot order would hand seat 5's tier to seat 2. Since
    // a0-11 that is the BOT seats, not every empty one: an OPEN seat flies
    // nothing, so a tier for it would shift every real bot behind it by one.
    // The tiers themselves are read off the characters the host picked (a0-06),
    // so this list cannot disagree with the names the roster is showing.
    let state = applyLobbySlots(lobby(), wireSlots(['human', 'human', 'open', 'open', 'open', 'open', 'open', 'open']));
    for (const slot of [3, 4, 6]) state = cycleSeatState(state, slot); // OPEN → BOT
    state = cycleSeatCharacter(state, 4);

    const list = botDifficulties(state);
    expect(list).toHaveLength(3);
    expect(list[1]).toBe(seatDifficulty(state.seats[4]!));
    expect(list).toEqual(state.seats.filter((s) => s.occupant === 'bot').map((s) => seatDifficulty(s)));
    // The seats left OPEN contribute nothing to the list at all.
    expect(botDifficulties(applyLobbySlots(lobby(), wireSlots(['human', 'open', 'open', 'open', 'open', 'open', 'open', 'open'])))).toEqual([]);
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
    let state = pressRush(solo());
    expect(canStart(solo())).toBe(true);
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
    const started = tickLobby(pressRush(solo(), 0.5), 1);
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
    const counting = pressRush(solo());
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
    // An OPEN seat is EMPTY (a0-11): only you are in this match so far.
    expect(matchSizeOf(state)).toBe(1);

    state = cycleSeatState(state, 1);
    expect(state.seats[1]!.occupant).toBe('bot');
    expect(matchSizeOf(state)).toBe(2); // …and a bot joins the field

    state = cycleSeatState(state, 1);
    expect(state.seats[1]!.occupant).toBe('closed');
    expect(matchSizeOf(state)).toBe(1); // …and leaves it again when it shuts

    state = cycleSeatState(state, 1);
    expect(state.seats[1]!.occupant).toBe('open'); // back to the start of the ring
  });

  it('never cycles a human seat, and refuses guests and post-RUSH taps', () => {
    const host = lobby();
    expect(cycleSeatState(host, 0)).toBe(host); // your own (human) seat
    const guest = lobby({ you: 2, host: 0 });
    expect(cycleSeatState(guest, 1)).toBe(guest);
    const counting = pressRush(solo());
    expect(cycleSeatState(counting, 1)).toBe(counting);
  });

  it('drops a closed seat from the previewed bot cast', () => {
    const closed = cycleSeatState(solo(), 5); // the solo lobby opens on BOT → closed
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
    // Restored offline (an online room's size is the ROOM's), so the seats that
    // are not closed open on the bot cast and `N` is the size asked for.
    const four = solo({ size: 4 });
    expect(matchSizeOf(four)).toBe(4);
    expect(four.seats.map((s) => s.occupant)).toEqual([
      'human', 'bot', 'bot', 'bot', 'closed', 'closed', 'closed', 'closed',
    ]);
    // Clamped into the legal band, never past the physical seats.
    expect(matchSizeOf(solo({ size: 1 }))).toBe(MIN_MATCH_SIZE);
    expect(matchSizeOf(solo({ size: 99 }))).toBe(MAX_MATCH_SIZE);
    expect(matchSizeOf(solo())).toBe(LOBBY_SLOTS); // absent size = the eight-player game

    // Online the same shape is the same shape — the trailing seats are closed —
    // but the middle ones are EMPTY chairs, so `N` is just you until somebody
    // arrives or the host seats a bot (a0-11).
    const room = lobby({ size: 4 });
    expect(room.seats.map((s) => s.occupant)).toEqual([
      'human', 'open', 'open', 'open', 'closed', 'closed', 'closed', 'closed',
    ]);
    expect(matchSizeOf(room)).toBe(1);
  });
});

describe('the seat-state control SAYS what it is (u5 — the affordance, not the cycle)', () => {
  // The developer's report — "theres no way visible way to know that you can close
  // slots right now" — is a defect the tests above could never have caught: they
  // assert the cycle WORKS, and it always did. What was missing is that nothing
  // said so. These assert the words and the live/dead look the row's leading
  // control is drawn from (`./lobby-view` drawSeatState), which is the half of the
  // fix that lives in a model rather than in pixels.

  it('names every state there is — including the one the ring does not contain', () => {
    // A control that states the current state needs a word for every state; the
    // one it forgets is the one drawn blank. `human` is not on the ring (you
    // cannot cycle a seat somebody is sitting in), and still needs a word.
    for (const occupant of SEAT_STATE_CYCLE) {
      expect(SEAT_STATE_LABELS[occupant], `no word for ${occupant}`).toBeTruthy();
    }
    expect(SEAT_STATE_LABELS.human).toBeTruthy();
    expect(SEAT_STATE_LABELS).toEqual({
      open: 'OPEN',
      bot: 'BOT',
      closed: 'CLOSED',
      human: 'TAKEN',
    });
  });

  it('reads the CURRENT state on every row, and changes as the state changes', () => {
    let state = lobby();
    // Row 0 is you — a seat nobody can cycle, and it says so rather than lying
    // about being one tap from OPEN.
    expect(lobbyModel(state).seats[0]!.stateLabel).toBe('TAKEN');

    // …and row 1 walks the ring, in words, one label per state.
    const walked: string[] = [lobbyModel(state).seats[1]!.stateLabel];
    for (let i = 0; i < 3; i++) {
      state = cycleSeatState(state, 1);
      walked.push(lobbyModel(state).seats[1]!.stateLabel);
    }
    expect(walked).toEqual(['OPEN', 'BOT', 'CLOSED', 'OPEN']);

    // The word is the seat's own state, never a neighbour's: closing row 1 does
    // not relabel row 2.
    const closed = cycleSeatState(cycleSeatState(lobby(), 1), 1);
    expect(lobbyModel(closed).seats[1]!.stateLabel).toBe('CLOSED');
    expect(lobbyModel(closed).seats[2]!.stateLabel).toBe('OPEN');
  });

  it('reads DEAD in exactly the three cases the cycle refuses — never live-then-refusing', () => {
    // One flag, from the mutation's own refusals, because a control that looks
    // live and then does nothing is worse than one that looks unavailable.
    const host = lobby();
    const hostModel = lobbyModel(host);
    expect(hostModel.seats[1]!.canCycleState, 'a host may cycle an empty seat').toBe(true);
    expect(hostModel.seats[0]!.canCycleState, 'nobody may cycle an occupied seat').toBe(false);

    // 1. A GUEST holds no slot editor at all — every row, not just the bot rows.
    const guest = lobbyModel(lobby({ you: 2, host: 0 }));
    expect(guest.seats.every((s) => !s.canCycleState), 'a guest sees a live control').toBe(true);

    // 2. After RUSH! the match shape is locked, so the whole roster goes dead.
    const counting = lobbyModel(pressRush(solo()));
    expect(counting.seats.every((s) => !s.canCycleState), 'a control is live past RUSH!').toBe(true);

    // 3. …and a CLOSED seat stays live for the host, which is the one that would
    //    strand a player if it were wrong: the control is the only way back out
    //    of CLOSED, so a closed row must never read as dead.
    const shut = cycleSeatState(cycleSeatState(lobby(), 5), 5);
    expect(lobbyModel(shut).seats[5]!.stateLabel).toBe('CLOSED');
    expect(lobbyModel(shut).seats[5]!.canCycleState, 'a closed seat cannot be reopened').toBe(true);
  });

  it('agrees with the mutation on every seat, in every state (the flag cannot drift)', () => {
    // The property behind the three cases: `canCycleState` is true exactly when
    // `cycleSeatState` actually moves. Exhaustive over the roster in four lobbies,
    // so a fourth refusal added to the mutation and not to the flag fails here.
    const LOBBIES: readonly { readonly name: string; readonly state: LobbyState }[] = [
      { name: 'host, gathering', state: lobby() },
      { name: 'guest', state: lobby({ you: 2, host: 0 }) },
      { name: 'counting (post-RUSH!)', state: pressRush(solo()) },
      { name: 'host with a closed seat', state: cycleSeatState(cycleSeatState(lobby(), 5), 5) },
    ];
    for (const { name, state } of LOBBIES) {
      const model = lobbyModel(state);
      for (const row of model.seats) {
        const moved = cycleSeatState(state, row.player) !== state;
        expect(row.canCycleState, `${name}: row ${row.player} draws ${row.canCycleState} but moves ${moved}`).toBe(
          moved,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// a0-31 — a SOLO lobby has no OPEN seat
// ---------------------------------------------------------------------------

describe('a solo lobby must not offer an OPEN seat (a0-31)', () => {
  // The developer: *"in solo play there should be no slot open it's either closed
  // or bot. no one can join in solo…."* The MODEL already agreed — `createLobby`
  // seeds an offline seat BOT and `openToJoin` is false offline — and the CONTROL
  // did not: the ring was walked unconditionally, so one tap in a solo lobby could
  // advertise a chair nobody could ever take. These assert the control.

  it('walks BOT ⇄ CLOSED in SOLO and never reaches OPEN — while ONLINE keeps all three', () => {
    // A full lap and a bit, so a ring of any length is walked past its start.
    const walk = (start: LobbyState, slot: PlayerId): Set<SeatOccupant> => {
      const seen = new Set<SeatOccupant>();
      let state = start;
      for (let i = 0; i < SEAT_STATE_CYCLE.length * 2 + 1; i++) {
        seen.add(state.seats[slot]!.occupant);
        state = cycleSeatState(state, slot);
      }
      return seen;
    };

    // SOLO: two rungs, and OPEN is not one of them.
    const inSolo = walk(solo(), 1);
    expect(inSolo.has('open'), 'a solo seat cycled to OPEN — nobody can take it').toBe(false);
    expect([...inSolo].sort()).toEqual(['bot', 'closed']);

    // ONLINE is untouched — a0-11 is ratified: a created room starts with all
    // slots OPEN, and the host can put one back.
    expect([...walk(lobby(), 1)].sort()).toEqual(['bot', 'closed', 'open']);
  });

  it('says so on the row too: no solo seat reads OPEN, in words or as a joinable chair', () => {
    let state = solo();
    // Every non-human row, tapped past a full lap of the longest ring there is —
    // so a rung reachable from any starting state is reached here.
    for (let slot = 1; slot < LOBBY_SLOTS; slot++) {
      for (let tap = 0; tap <= SEAT_STATE_CYCLE.length * 2; tap++) {
        for (const row of lobbyModel(state).seats) {
          expect(row.state, `row ${row.player} is OPEN in a solo lobby`).not.toBe('open');
          expect(row.stateLabel, `row ${row.player} says OPEN in a solo lobby`).not.toBe('OPEN');
          expect(row.name, `row ${row.player} is named OPEN in a solo lobby`).not.toBe('OPEN');
          // …and no row was ever advertised as joinable offline, which is the half
          // of this rule the file already had (a0-11) — asserted here so the two
          // halves stay together.
          expect(row.openToJoin).toBe(false);
        }
        // The control never goes dead on a solo row; it just has one rung fewer.
        expect(lobbyModel(state).seats[slot]!.canCycleState).toBe(true);
        state = cycleSeatState(state, slot);
      }
    }
  });

  it('reads a seat ALREADY STORED as OPEN in a solo lobby as BOT — display, count and match', () => {
    // The returning-player case: a state authored before this rule (or by a path
    // that has not learned it) carries an OPEN seat into a lobby nobody can join.
    // It resolves to BOT wherever it is read, so the screen never shows a chair
    // that cannot be filled and the match it launches contains what the screen says.
    const base = solo();
    const stale: LobbyState = {
      ...base,
      seats: base.seats.map((s) =>
        s.player === 3 ? { ...s, occupant: 'open' as const, personality: null } : s,
      ),
    };

    const row = lobbyModel(stale).seats[3]!;
    expect(row.state).toBe('bot');
    expect(row.stateLabel).toBe('BOT');
    expect(row.isBot).toBe(true);
    expect(row.name).toBe(PERSONALITIES[stale.seats[3]!.character].name);
    expect(nameFor(stale, 3)).toBe(row.name);

    // …in the count, so `N` and the RUSH gate see the same roster the rows do…
    expect(matchSizeOf(stale)).toBe(LOBBY_SLOTS);
    expect(denseSeatIndex(stale, 3)).toBe(3);
    expect(lobbyModel(stale).botCount).toBe(LOBBY_SLOTS - 1);

    // …and in the match, which is the half a preview can lie about.
    const slot = lobbyMatchConfig(stale).slots[3]!;
    expect(slot.state).toBe('bot');
    expect(slot.botPersonality).toBe(stale.seats[3]!.character);
    expect(slot.botDifficulty).toBe(PERSONALITIES[stale.seats[3]!.character].difficulty);

    // Online the very same seat is exactly what it says it is — an empty chair.
    const room: LobbyState = { ...stale, online: true };
    expect(lobbyModel(room).seats[3]!.state).toBe('open');
    expect(lobbyMatchConfig(room).slots[3]!.state).toBe('closed');
  });

  it('takes its answer from the lobby’s OWN online flag, not a second copy of it', () => {
    // u13-01 and g6-01 are both a second copy of a value drifting from the first.
    // `state.online` is the flag `createLobby` seeds seats from and `openToJoin` is
    // drawn from; flipping it is the whole of what makes a lobby solo, and the ring
    // follows it with no other input.
    const base = solo();
    expect(seatStateCycle(base)).toEqual(SOLO_SEAT_STATE_CYCLE);
    expect(seatStateCycle({ ...base, online: true })).toEqual(SEAT_STATE_CYCLE);
    expect(SOLO_SEAT_STATE_CYCLE).toEqual(['bot', 'closed']);
    // Every rung of the solo ring is a rung of the full one — the solo cycle is the
    // online one with OPEN removed, never a second vocabulary.
    expect(SOLO_SEAT_STATE_CYCLE.every((rung) => SEAT_STATE_CYCLE.includes(rung))).toBe(true);
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
    const teams = toggleMode(solo());
    // Force everyone onto side A: one team, not a match.
    let oneSide = teams;
    for (let slot = 0; slot < LOBBY_SLOTS; slot++) {
      oneSide = cycleTeamTo(oneSide, slot, 0);
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
    expect(activeTeams(solo({ size: 2 }))).toBe(2);
    expect(activeTeams(solo({ size: 4 }))).toBe(2);
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
    const counting = pressRush(toggleMode(solo()));
    expect(cycleSeatTeam(counting, 1)).toBe(counting);
  });

  /**
   * a0-09 — the roster the end-of-match summary asks "did MY side take the
   * claim?" of (`./end-of-match` `MatchOutcome.allies`). It exists because the
   * flow learns a match ended from a `matchEnd` message and holds no `World`; the
   * lobby's own `team` table is the same answer, because allegiance is static
   * match config fixed at match start (GDD §2.1, §4.2).
   */
  describe('the side roster the summary reads', () => {
    it('in TEAMS holds you and every ally, and no enemy', () => {
      const teams = toggleMode(solo());
      // Default alternating split: evens are side A, odds side B.
      expect(sideRosterOf(teams, 0)).toEqual(new Set([0, 2, 4, 6]));
      expect(sideRosterOf(teams, 1)).toEqual(new Set([1, 3, 5, 7]));
      // Move seat 3 across and both rosters follow — one table, not two.
      let moved = teams;
      moved = cycleTeamTo(moved, 3, 0);
      expect(moved.seats[3]!.team).toBe(0);
      expect(sideRosterOf(moved, 0)).toContain(3);
      expect(sideRosterOf(moved, 1)).not.toContain(3);
    });

    it('in FFA is you alone — teams-of-one, whatever the seats still remember', () => {
      // A seat keeps its side across a mode switch so flipping to TEAMS and back
      // never loses an assignment, so the gate has to be the MODE, not the table.
      const ffa = lobby();
      expect(ffa.seats[2]!.team).toBe(defaultTeamForSlot(2));
      for (const slot of [0, 2, 5]) expect(sideRosterOf(ffa, slot)).toEqual(new Set([slot]));

      const roundTrip = toggleMode(toggleMode(lobby()));
      expect(sideRosterOf(roundTrip, 0)).toEqual(new Set([0]));
    });

    it('leaves CLOSED and OPEN seats out — neither takes the field, so neither is on a side', () => {
      let teams = toggleMode(solo());
      teams = cycleSeatState(teams, 2); // bot → closed
      expect(teams.seats[2]!.occupant).toBe('closed');
      expect(sideRosterOf(teams, 0)).toEqual(new Set([0, 4, 6]));

      // …and an EMPTY seat is out for the same reason (a0-11): an unclaimed
      // chair has no ship for an ally to fight beside.
      let room = toggleMode(lobby());
      for (const slot of [2, 4]) room = cycleSeatState(room, slot); // OPEN → BOT
      expect(sideRosterOf(room, 0)).toEqual(new Set([0, 2, 4]));
    });

    it('puts a seatless player on their own side, never on nobody’s', () => {
      // A slot outside the roster (a spectator, a stale id) is still on its own
      // side — the set is never empty, so the summary can never read a win by the
      // local player as somebody else's.
      expect(sideRosterOf(toggleMode(lobby()), 99)).toEqual(new Set([99]));
    });
  });

  it('surfaces per-side counts in the model, always, never blocking a split', () => {
    // 3 on A, 1 on B among four active seats — a legal handicap game.
    let state = toggleMode(solo({ size: 4 }));
    // seats 0,2 default to A; 1,3 to B. Walk seat 1 around the ring onto A → 3v1.
    state = cycleTeamTo(state, 1, 0);
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
    state = cycleTeamTo(state, 0, 1);
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
      state = cycleTeamTo(state, 2, 2);
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
    const counting = pressRush(solo());
    expect(cycleAbundance(counting)).toBe(counting);
  });
});

describe('lobbyMatchConfig — the one handoff to the wire and the world', () => {
  it('round-trips through the sim config seam: FFA is teams-of-one, dense', () => {
    const config = lobbyMatchConfig(solo());
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
    let state = solo();
    for (const slot of [6, 7]) state = cycleSeatState(state, slot); // bot → closed
    const config = lobbyMatchConfig(state);
    expect(matchSize(config)).toBe(6);
    expect(activeSlots(config)).toHaveLength(6);
    expect(configToPlayers(config).map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('carries the authored team table in TEAMS, and abundance in both modes', () => {
    const teams = cycleAbundance(toggleMode(solo({ size: 4 }))); // teams, standard abundance
    const config = lobbyMatchConfig(teams);
    expect(config.mode).toBe('teams');
    expect(config.abundance).toBe('standard');
    const active = activeSlots(config);
    // Alternating default: A B A B across slots 0..3.
    expect(active.map((s) => s.team)).toEqual([0, 1, 0, 1]);
    // configToPlayers keeps the authored side (not the dense id) in TEAMS.
    expect(configToPlayers(config).map((p) => p.team)).toEqual([0, 1, 0, 1]);
  });

  it('builds the world WITHOUT the seats nobody is in (a0-11)', () => {
    // Offline the empty seats are the bot cast, so every slot is in the world.
    const offline = lobbyMatchConfig(solo());
    expect(offline.slots[1]!.state).toBe('bot');
    expect(offline.slots[1]!.botPersonality).toBeTruthy();
    expect(offline.slots[1]!.botDifficulty).toBeTruthy();
    // The local human is always a live competitive seat, never a bot.
    expect(offline.slots[0]!.state).toBe('open');

    // Online, an UNCLAIMED seat brings no ship and no station, so the sim must be
    // built without it — `closed`, exactly like a shut door, because the sim has
    // no third answer for "nobody is here". This is the whole difference the
    // developer asked for, at the seam where it reaches the world.
    const room = lobbyMatchConfig(lobby());
    expect(room.slots[1]!.state).toBe('closed');
    expect(room.slots[1]!.botPersonality).toBeUndefined();
    expect(room.slots[1]!.botDifficulty).toBeUndefined();
    expect(matchSize(room)).toBe(1);
  });

  // ── a0-11 TEST 2 — one tap, exactly one participant, preview and match ─────
  it('setting a seat to BOT and back to OPEN adds and removes exactly one participant', () => {
    const before = lobby();
    const withBot = cycleSeatState(before, 3); // OPEN → BOT
    const backToOpen = cycleSeatState(cycleSeatState(withBot, 3), 3); // BOT → CLOSED → OPEN

    // In the PREVIEW…
    expect(lobbyModel(withBot).size).toBe(lobbyModel(before).size + 1);
    expect(lobbyModel(withBot).botCount).toBe(1);
    expect(lobbyModel(withBot).seats[3]!.name).not.toBe('OPEN');
    expect(lobbyModel(backToOpen).size).toBe(lobbyModel(before).size);
    expect(lobbyModel(backToOpen).botCount).toBe(0);
    expect(lobbyModel(backToOpen).seats[3]!.name).toBe('OPEN');

    // …and in the LAUNCHED match, which is the half a preview can lie about.
    expect(configToPlayers(lobbyMatchConfig(before))).toHaveLength(1);
    expect(configToPlayers(lobbyMatchConfig(withBot))).toHaveLength(2);
    expect(configToPlayers(lobbyMatchConfig(backToOpen))).toHaveLength(1);
    // …and it is the seat's OWN character that arrived, at the tier its row shows.
    const slot = lobbyMatchConfig(withBot).slots[3]!;
    expect(slot.botPersonality).toBe(withBot.seats[3]!.personality);
    expect(slot.botDifficulty).toBe(seatDifficulty(withBot.seats[3]!));
  });

  // ── a0-11 TEST 3 — RUSH! below two, and the reason for it ─────────────────
  it('refuses RUSH! with one human and no bots, WITH a reason — and launches a 2-player match with one bot', () => {
    const alone = lobby();
    expect(matchSizeOf(alone)).toBe(1);
    expect(canStart(alone)).toBe(false);
    expect(startRefusal(alone)).toBe(NEEDS_TWO);
    expect(lobbyModel(alone).startRefusal).toBe(NEEDS_TWO);
    // Refused for real, not just drawn refused: RUSH! does not start a countdown.
    expect(pressRush(alone)).toBe(alone);

    const withBot = cycleSeatState(alone, 5); // OPEN → BOT
    expect(matchSizeOf(withBot)).toBe(MIN_MATCH_SIZE);
    expect(canStart(withBot)).toBe(true);
    expect(startRefusal(withBot)).toBeNull();
    expect(lobbyModel(withBot).startRefusal).toBeNull();
    expect(pressRush(withBot).phase).toBe('counting');
    expect(configToPlayers(lobbyMatchConfig(withBot))).toHaveLength(2);

    // A guest is never handed a refusal: RUSH! is not theirs to press, and
    // "waiting for the host" is a different sentence than "this is not legal".
    expect(startRefusal(lobby({ you: 2, host: 0 }))).toBeNull();
  });

  // ── a0-11 — the dense index the offline boot needs ────────────────────────
  it('maps a lobby slot onto the DENSE roster the sim builds, and only for participants', () => {
    let state = lobby();
    for (const slot of [2, 5]) state = cycleSeatState(state, slot); // OPEN → BOT
    // Participants are slots 0 (you), 2 and 5 → dense 0, 1, 2.
    expect(denseSeatIndex(state, 0)).toBe(0);
    expect(denseSeatIndex(state, 2)).toBe(1);
    expect(denseSeatIndex(state, 5)).toBe(2);
    // …and a seat nobody is in has no place in the sim's roster at all.
    expect(denseSeatIndex(state, 1)).toBeNull();
    expect(denseSeatIndex(state, 99)).toBeNull();
    // It agrees with the seam it exists to serve, by construction.
    expect(configToPlayers(lobbyMatchConfig(state)).map((p) => p.id)).toEqual([0, 1, 2]);
  });

  // ── a0-11 — the host's roster, on the wire ────────────────────────────────
  it('sends the host’s per-seat authoring in SLOT order, with a human seat as open', () => {
    let state = lobby();
    state = cycleSeatState(state, 1); // OPEN → BOT
    state = cycleSeatState(cycleSeatState(state, 2), 2); // OPEN → BOT → CLOSED
    expect(lobbyWireSeats(state)).toEqual([
      'open', 'bot', 'closed', 'open', 'open', 'open', 'open', 'open',
    ]);
    // A seat somebody is sitting in is the SERVER's answer, not the host's: it
    // rides as a competitive human seat, which is what `open` means on the wire.
    expect(lobbyWireSeats(state)[0]).toBe('open');
    expect(lobbyWireSeats(state)).toHaveLength(LOBBY_SLOTS);
  });
});

// ---------------------------------------------------------------------------
// lobbyRosterCast — the handoff that did not exist (a0-06)
// ---------------------------------------------------------------------------

describe('lobbyRosterCast — the lobby’s pick, in the order the world builds', () => {
  it('carries a chosen cast out in DENSE player order, human seats null', () => {
    // The offline half of the handoff `bootOfflineMatch` consumes. It is indexed
    // exactly like `lobbyRosterTeams` — closed slots dropped, survivors re-indexed
    // 0..N-1 — because the two are stamped onto the same roster.
    let state = lobby({ online: false });
    for (const slot of [1, 2, 3]) {
      state = cycleCharacterTo(state, slot, 'warden');
    }
    const cast = lobbyRosterCast(state);
    expect(cast).toHaveLength(LOBBY_SLOTS);
    expect(cast[0]).toBeNull(); // your own seat — the boot leaves it to you
    expect(cast.slice(1, 4)).toEqual(['warden', 'warden', 'warden']);
    expect(cast).toEqual(lobbyRosterTeams(state).map((_, i) => cast[i]!)); // same length/order
  });

  it('re-indexes around a CLOSED seat, exactly as the team table does', () => {
    // A closed slot is dropped at world-build and the survivors renumber, so entry
    // `i` has to be the character of the ship the sim will call player `i`. Getting
    // this wrong hands seat 5's character to seat 2 — the same class of bug the
    // empty-seat-order rule exists for.
    const closed = cycleStateTo(solo(), 3, 'closed');
    expect(closed.seats[3]?.occupant).toBe('closed');
    const cast = lobbyRosterCast(closed);
    expect(cast).toHaveLength(LOBBY_SLOTS - 1);
    expect(cast).toEqual(
      closed.seats.filter((s) => s.occupant !== 'closed').map((s) => s.personality),
    );
    expect(lobbyRosterTeams(closed)).toHaveLength(cast.length);
  });

  it('preserves duplicates — two Wardens in, two Wardens out', () => {
    // Seat 7 is already Warden in an untouched lobby (roster order), so put a
    // SECOND one on seat 4 and count: the table must carry both, not fold them.
    let state = lobby({ online: false });
    expect(lobbyRosterCast(state).filter((c) => c === 'warden')).toHaveLength(1);
    state = cycleCharacterTo(state, 4, 'warden');
    expect(lobbyRosterCast(state).filter((c) => c === 'warden')).toHaveLength(2);
    expect(lobbyRosterCast(state)[4]).toBe('warden');
    expect(lobbyRosterCast(state)[7]).toBe('warden');
  });
});

// ---------------------------------------------------------------------------
// u10-01 — one ship card, one map card, and nothing else on this screen moved
// ---------------------------------------------------------------------------
//
// The developer, 2026-08-07, over a screenshot of the live lobby: *"in the lobby
// page select ship and select map need to open different pages, we should only
// show 1 ship and 1 map in lobby because it's too cluttered now"*.
//
// The two picker screens have their own suites (`./ship-select.test.ts`,
// `./map-select.test.ts`). What is asserted here is the LOBBY's half: it shows one
// of each, and it shows everything else exactly as it did — because two of the
// three things on this screen that were developer reports in their own right (the
// seat-state control, u5; the FRIENDLY / ENEMY labels, u3) are neighbours of what
// moved, and the brief is explicit that neither is in scope to alter.

describe('the lobby shows ONE ship card and ONE map card (u10-01)', () => {
  it('publishes the pick, once each, as whole cards', () => {
    const model = lobbyModel(lobby());
    // A card, not a list: there is no array here that could grow back to four.
    expect(model.shipCard.shipClass).toBe(DEFAULT_SHIP_CLASS);
    expect(model.mapCard.id).toBe(DEFAULT_MAP_ID);
    // …and the ship card is the WHOLE option, so u4's ruling is untouched: pips
    // AND numbers, off the sim's own table, on the card the lobby draws.
    expect(model.shipCard.stats).toHaveLength(shipStatLines(DEFAULT_SHIP_CLASS).length);
    for (const line of model.shipCard.stats) {
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.pips).toBeGreaterThanOrEqual(1);
      expect(line.pips).toBeLessThanOrEqual(line.pipMax);
    }
  });

  it('follows the pick — the card is whatever the two screens last returned', () => {
    for (const cls of CLASS_ORDER) {
      expect(lobbyModel(pickShipClass(lobby(), cls)).shipCard.shipClass).toBe(cls);
    }
    for (const map of MAPS) {
      expect(lobbyModel(pickMap(lobby({ online: false }), map.id)).mapCard.id).toBe(map.id);
    }
  });

  it('falls back to a real card rather than a hole if the hull is nonsense', () => {
    // The roster has exactly one ship card now, so "no card" would be a gap where
    // the pick should be. Only reachable from a corrupt store, and answered.
    expect(shipCardFor('not-a-hull' as ShipClass).shipClass).toBe(DEFAULT_SHIP_CLASS);
  });

  it('never lets the screen state reach the match — it is not match config', () => {
    // Which of the three screens a player is standing on is where they are LOOKING.
    // RUSH! must resolve the identical match from any of them, or the picker would
    // be a setting nobody knew they were making.
    const base = lobby({ online: false });
    for (const state of [base, openShipSelect(base), openMapSelect(base)]) {
      expect(lobbyMatchConfig(state)).toEqual(lobbyMatchConfig(base));
      expect(lobbyWireSeats(state)).toEqual(lobbyWireSeats(base));
      expect(lobbyRosterCast(state)).toEqual(lobbyRosterCast(base));
    }
  });

  it('leaves the ROSTER, the seat-state control and the team labels untouched', () => {
    // The two developer reports that live next door (u5's slot-state control and
    // u3's FRIENDLY / ENEMY labels), asserted through the model, on the roster and
    // in TEAMS — the modes and rows they were reported on.
    const teams = toggleMode(lobby({ online: false }));
    const model = lobbyModel(teams);
    expect(model.seats).toHaveLength(LOBBY_SLOTS);
    for (const seat of model.seats) {
      // u5: every row states what it is, and whether it may be cycled.
      expect(SEAT_STATE_LABELS[seat.state]).toBe(seat.stateLabel);
      expect(seat.stateLabel.length).toBeGreaterThan(0);
      expect(seat.canCycleState).toBe(seat.state !== 'human');
      // u3: every row names its side in the viewer's words plus the absolute letter.
      expect(seat.teamName).toBe(teamName(seat.team, model.viewerTeam));
      expect(seat.teamName.startsWith('FRIENDLY') || seat.teamName.startsWith('ENEMY')).toBe(true);
      expect(seat.teamLabel).toBe(teamLabel(seat.team));
    }
    // …and the cycle still moves a seat, on the roster and from either picker
    // screen's state (the screen is not a lock).
    expect(cycleSeatState(teams, 3).seats[3]?.occupant).not.toBe(teams.seats[3]?.occupant);
    expect(cycleSeatTeam(teams, 3).seats[3]?.team).not.toBe(teams.seats[3]?.team);
  });
});

/**
 * a0-35 — **the PRIVATE toggle the developer could not find.**
 *
 * *"when i host, i hav eno way to make a match private i dont see a button to do
 * it"*. D1 was ratified as *"public by default **with a PRIVATE toggle**"* and
 * the toggle reached `n10-01`'s rulings and neither brief's work items, so the
 * whole seam shipped — wire field, room flag, heartbeat, an allocator that leaves
 * a private room out of the payload — with nothing on screen to move it.
 *
 * What is asserted here is the *control's* half of that ruling, which is three
 * refusals and a default:
 *
 *  - a new room is **PUBLIC**, always, and never restores a stored PRIVATE;
 *  - only the **creator** flips it, and only **before RUSH!**;
 *  - an **offline** lobby has no control at all — there is no list for a
 *    solo-vs-bots room to be on, so a chip about one could only mislead;
 *  - and it is **not match config**: `lobbyMatchConfig` is byte-identical either
 *    way, because who may find a room changes nothing about the world it builds.
 */
describe('the CLAIM control — PUBLIC / PRIVATE (a0-35, a0-26 D1)', () => {
  it('opens PUBLIC — the ratified default, online and offline alike', () => {
    expect(lobby().listed).toBe(true);
    expect(lobby({ online: false }).listed).toBe(true);
    expect(lobbyModel(lobby()).listed).toBe(true);
    expect(claimLabel(true)).toBe(CLAIM_LABELS.public);
    expect(claimLabel(false)).toBe(CLAIM_LABELS.private);
  });

  it('the host flips it PUBLIC ⇄ PRIVATE, and the model says the word', () => {
    const room = lobby();
    const priv = toggleClaim(room);
    expect(priv.listed).toBe(false);
    expect(claimLabel(lobbyModel(priv).listed)).toBe('PRIVATE');
    // …and back, because an opt-out a host cannot undo is a trap.
    expect(toggleClaim(priv).listed).toBe(true);
  });

  it('refuses a GUEST, a lobby past RUSH!, and an OFFLINE room — identically', () => {
    // A refusal returns the IDENTICAL state, which is what the flow and the
    // wiring sound a refusal off (`./lobby-flow`, `main.ts` `sendChoice`), so a
    // tap nobody may make costs the wire nothing.
    const guest = lobby({ you: 1, host: 0 });
    expect(toggleClaim(guest)).toBe(guest);
    // RUSH! is refused below two participants (a0-11), so the room that actually
    // counts down is one with somebody in it — here a single authored bot.
    const counting = pressRush(cycleSeatState(lobby(), 1));
    expect(counting.phase).toBe('counting');
    expect(toggleClaim(counting)).toBe(counting);
    const offline = lobby({ online: false });
    expect(toggleClaim(offline)).toBe(offline);
  });

  it('shows the control to the online CREATOR and to nobody else', () => {
    expect(showsClaimControl(lobby())).toBe(true);
    // A guest never sees it: the room does not tell a joiner whether it is
    // listed, so a chip on their screen could only show their own default —
    // PUBLIC over somebody's private room. Absent, never flattering.
    expect(showsClaimControl(lobby({ you: 1, host: 0 }))).toBe(false);
    expect(showsClaimControl(lobby({ online: false }))).toBe(false);
    // It stays on the host's strip through the countdown, drawn dead like its two
    // neighbours — a control that vanished as RUSH! started would re-flow the
    // strip under the host's thumb.
    const counting = pressRush(cycleSeatState(lobby(), 1));
    expect(counting.phase).toBe('counting');
    expect(showsClaimControl(counting)).toBe(true);
    expect(lobbyModel(counting).showClaim).toBe(true);
  });

  it('is NOT match config — the world is built identically either way', () => {
    const room = solo();
    const online = { ...room, online: true };
    const priv = toggleClaim(online);
    expect(priv.listed).toBe(false);
    expect(lobbyMatchConfig(priv)).toEqual(lobbyMatchConfig(online));
    expect(lobbyWireSeats(priv)).toEqual(lobbyWireSeats(online));
    expect(lobbyWireTeams(priv)).toEqual(lobbyWireTeams(online));
  });
});

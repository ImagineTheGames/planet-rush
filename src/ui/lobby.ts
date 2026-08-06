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
 *  4. **Ship stats DO appear here — as pips AND numbers** *(u4, ratified by the
 *     developer 2026-08-05: "both pips and numbers"; GDD §2.5 and §2.11 amended
 *     the same day)*. This reverses the rule this file used to keep ("no ship
 *     stats on this screen"): a {@link ShipClassOption} now carries a name, a
 *     hull, a role blurb **and** its {@link ShipStatLine} row — a coarse pip bar
 *     to compare four hulls at a glance, beside the actual figure for the player
 *     who wants it. Never one or the other: both, together, on every hull.
 *
 *     Two guarantees hold the reversal up, and they are what the tests pin:
 *     the numbers are read from the **sim's own** `SHIP_STATS`
 *     (`../sim/constants`), never a table hand-copied into the UI — a screen
 *     that prints a stat the sim does not honour is worse than one with no
 *     stats; and the pips and the number are derived from the **same** `value`
 *     in {@link statLine}, so a hull can never show four pips beside a figure
 *     that means three.
 *
 *     The upgrade panel ({@link ./upgrade-wheel}) is unaffected and keeps
 *     showing what it shows; the **build wheel** is untouched — a segment's only
 *     number is still its cost (GDD §2.5), and "stats are allowed on
 *     ship-select" does not leak into it.
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
import { PALETTE, PLAYER_COLORS } from '@render/index';
import { BONE, MATERIAL_SHADES } from '../art/materials';
import { Difficulty, MATCH_SLOTS, PERSONALITIES, ROSTER, rosterAt } from '../bots';
import type { PersonalityId } from '../bots';
import type { BotDifficulty, LobbySlot, RoomCode } from '../net/transport';
import { seatPing } from '../net/ping';
import type { PingReadout } from '../net/ping';
import type { MatchConfig, MatchMode, SlotConfig, SlotState } from '../sim/match-config';
import { MAX_MATCH_SIZE, MIN_MATCH_SIZE, configToPlayers } from '../sim/match-config';
import type { Abundance, ShipStats } from '../sim/constants';
// The hull tiles' numbers come from the SIM's own class table (u4) — never a
// table hand-copied into the UI, so a retune in `../sim/constants` moves the
// lobby with it and the screen cannot advertise a game the sim is not running.
import { DEFAULT_ABUNDANCE, SHIP_STATS } from '../sim/constants';
import { playerColor } from './station-hp';
import { CLASS_NAMES } from './upgrade-wheel';
import { normalizeMapId } from './map-picker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seats in a match (GDD §1: "up to 8 players"). One source of truth — the
 *  harness's `MATCH_SLOTS`, which is also the number of seats a room holds. */
export const LOBBY_SLOTS = MATCH_SLOTS;

/** The word on the start button, and on the countdown when it reaches zero
 *  (GDD §2.1: "a match countdown ('RUSH!') starts the game"). */
export const RUSH_LABEL = 'RUSH!';

/**
 * What the header beam calls this screen, and the eyebrow over the room code
 * (u7-03 — Gantry/Bone frames every screen with a heading in its header beam;
 * `CREW MUSTER` is the handoff's own word for the lobby, recorded in the tracking
 * scale it ships with, `../art/materials` DISPLAY_TRACKING).
 *
 * It sits here rather than in the view for the same reason `MAIN_MENU_TITLE`
 * does: the copy sweep (`docs/copy-sweep-industrial-voice.md`) reads the models,
 * and a string typed into a draw call is a string nobody can find.
 */
export const LOBBY_TITLE = 'CREW MUSTER';
export const LOBBY_EYEBROW = 'ROOM';

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

// ---------------------------------------------------------------------------
// Variable matches (docs/variable-slots-plan.md, Milestone E) — the lobby as a
// control surface: a MODE toggle, per-seat OPEN/BOT/CLOSED, TEAM assignment, and
// the ratified ABUNDANCE row. All four ride the one `MatchConfig` seam
// ({@link lobbyMatchConfig}) that the sim already consumes (`../sim/match-config`).
// ---------------------------------------------------------------------------

/** The two match modes (GDD §2.1), as the toggle spells them. FFA is
 *  teams-of-one; TEAMS groups slots by a shared team — the only thing that
 *  differs is that table (spike §S5). */
export const MODE_LABELS: Readonly<Record<MatchMode, string>> = {
  ffa: 'FFA',
  teams: 'TEAMS',
};

/**
 * The host's per-seat occupancy tap walks this ring: a seat OPEN to a joiner (and
 * previewing the bot who fills it) becomes an explicit BOT, then CLOSED (out of
 * the match entirely — `N` drops by one), then open again. A human seat is never
 * in the ring: you cannot cycle a seat somebody is sitting in.
 */
export const SEAT_STATE_CYCLE: readonly SeatOccupant[] = ['open', 'bot', 'closed'];

/**
 * The word a seat's state is shown as, on the row's leading STATE control (u5,
 * 2026-08-05 — the developer's report: *"theres no way visible way to know that
 * you can close slots right now"*).
 *
 * The cycle above walks three of these; the fourth — `human` — is the state you
 * cannot cycle *to* or *from*, because you cannot cycle a seat somebody is
 * sitting in ({@link cycleSeatState}), so its word says the seat is spoken for
 * rather than naming a rung of a ring the row is not on. Every occupant has a
 * word: a control that states the current state must have one for every state
 * there is, or the one it forgets is the one drawn blank.
 */
export const SEAT_STATE_LABELS: Readonly<Record<SeatOccupant, string>> = {
  open: 'OPEN',
  bot: 'BOT',
  closed: 'CLOSED',
  human: 'TAKEN',
};

/**
 * How many sides TEAMS can split into. Two is the common game (1v1..4v4, and any
 * uneven split — the developer ratified "any team split allowed, show counts,
 * never block"); the ring runs to four so 2v2v2v2 and three-corner games are
 * reachable, and no further because there are only eight identity colours and a
 * team of one is just FFA with extra steps.
 */
export const MAX_TEAMS = 4;

/** A team's label — a letter, not a colour: the eight identity colours stay
 *  per-SLOT (style-guide §3.1, ratified), and the team is the *motif* over them
 *  (nameplate underline), so it needs a hue-independent name of its own.
 *
 *  The letter is the **ABSOLUTE** half of the side grammar ({@link teamName}):
 *  team 1 is `B` to everyone, always, whoever is looking. */
export const TEAM_LABELS: readonly string[] = ['A', 'B', 'C', 'D'];

/** A team number's label, folded into range so a stray value still reads. */
export function teamLabel(team: number): string {
  if (!Number.isFinite(team) || team < 0) return TEAM_LABELS[0]!;
  return TEAM_LABELS[Math.floor(team) % TEAM_LABELS.length]!;
}

/**
 * How a side reads **to the viewer looking at it** — the RELATIVE half of the
 * side grammar ({@link teamName}). The same side is `friendly` to its own members
 * and `enemy` to everyone else; `neutral` is the viewer-less case (a spectator, a
 * replay, any view with no local player), where nobody is an ally and — the point
 * — nobody may be called an enemy either.
 */
export type SideRelation = 'friendly' | 'enemy' | 'neutral';

/**
 * The word each relation carries. `WORD + LETTER` is the whole grammar:
 * `FRIENDLY A`, `ENEMY B`, `ENEMY C` — and `TEAM B` when there is no viewer to be
 * friendly to. One table, so nothing else in the UI ever spells a side by hand.
 */
export const SIDE_WORDS: Readonly<Record<SideRelation, string>> = {
  friendly: 'FRIENDLY',
  enemy: 'ENEMY',
  neutral: 'TEAM',
};

/**
 * Which relation `team` bears to the player viewing it.
 *
 * `viewerTeam` is the VIEWING player's own side. Absent (or not a real side) means
 * there is no local player — a spectator, a replay, a lobby nobody is seated in —
 * and that resolves to `neutral`, never to `enemy`: a view with no "friendly" must
 * not answer by declaring everyone hostile. A `team` that is not a real side is
 * neutral for the same reason: an unknown side is not an enemy side.
 */
export function sideRelation(team: number, viewerTeam?: number): SideRelation {
  if (viewerTeam === undefined || !Number.isFinite(viewerTeam) || viewerTeam < 0) return 'neutral';
  if (!Number.isFinite(team) || team < 0) return 'neutral';
  return Math.floor(team) === Math.floor(viewerTeam) ? 'friendly' : 'enemy';
}

/**
 * A side's **player-facing name** — `FRIENDLY A`, `ENEMY B`, `ENEMY C` — the one
 * string both the lobby roster and the in-match nameplates show (`./nameplates`).
 *
 * ---------------------------------------------------------------------------
 * THE RATIFICATION CHAIN (read this before changing the wording)
 * ---------------------------------------------------------------------------
 *
 * **m10, ratified after a TEAMS match:** *"impossible to know who is on your
 * team."* Colour could not answer that and was never going to — the eight
 * identity colours are per-SLOT (style-guide §3.1), so a side has no hue of its
 * own to read, and the bare letter on the lobby chip did not survive the trip
 * into a fight. The conclusion: **colour alone is insufficient**; the label is
 * words, over every nameplate, in both form factors. That produced `TEAM A`.
 *
 * **u3, ratified 2026-08-05 — a REFINEMENT of that, not a reversal:** *"I don't
 * think we should show teams like Team A Team B in the match (perhaps just
 * Friendly, and Enemy, with colors like Blue for Friendly, Red for Enemy)"* and,
 * on more than two sides, *"Friendly/Enemy plus Letters — Friendly A, Enemy B,
 * Enemy C, Enemy D etc..."*. `TEAM A` only ever helped a player who remembered
 * which team *they* were; `FRIENDLY A` answers the original complaint directly.
 * The words still carry the whole meaning — colour came back as **reinforcement,
 * never as the sole signal** ({@link SIDE_COLORS}, on the team motif only), which
 * is what keeps the readout usable with the hue removed.
 *
 * ---------------------------------------------------------------------------
 * THE GRAMMAR: `WORD + LETTER`, and the two halves behave differently
 * ---------------------------------------------------------------------------
 *
 *  - **The letter is ABSOLUTE** ({@link teamLabel}) — team 1 is `B` to everyone,
 *    always. It is the side's identity and does not depend on who is looking, so
 *    two players on opposite sides still name the same third side identically.
 *  - **The word is RELATIVE to the viewer** ({@link sideRelation}) — the same side
 *    reads `FRIENDLY` to its own members and `ENEMY` to everyone else.
 *
 * `viewerTeam` is therefore required for the word to mean anything; omitting it is
 * the documented **viewer-less** case (spectator / replay / no local player) and
 * degrades to the bare `TEAM <letter>` rather than calling everybody an enemy.
 *
 * This function stays the SINGLE place the wording lives, so the lobby roster and
 * the in-match nameplates can never disagree about what a side is called — every
 * call site passes the viewer's team rather than inventing its own wording.
 */
export function teamName(team: number, viewerTeam?: number): string {
  return `${SIDE_WORDS[sideRelation(team, viewerTeam)]} ${teamLabel(team)}`;
}

/**
 * The **team motif's** colour, by relation — blue for friendly, red for enemy
 * (ratified u3, 2026-08-05: *"with colors like Blue for Friendly, Red for
 * Enemy"*).
 *
 * Where it is allowed to land: the **motif only** — the roster row's team
 * underline and its side chip, and the side tag on a nameplate. Never a hull,
 * never a ship's trim, never an HP bar. The eight identity colours are per-SLOT
 * and ratified (style-guide §3.1): they are how a player tells two *enemies*
 * apart, and at three and four sides they are doing real work alongside the
 * letter. The motif is exactly the hue-independent layer this file already
 * described, so blue/red belongs there and nowhere else.
 *
 * Why these two hues, from the frozen palette rather than invented
 * (`src/art/tokens.ts`; pinned in `./lobby.test`):
 *
 *  - **friendly = plasma `#4DC3FF`** — the cold energy blue this UI already
 *    accents with (selection strokes, the lobby's own chips). 9.5:1 against
 *    Vacuum `#0D1015`, so it holds at 11px on a phone.
 *  - **enemy = threat red, lifted toward white** (`tint(threatRed, 0.32)` =
 *    `#CB7979`, the declared `shotEnemy2` rung of the enemy-fire ramp). Raw
 *    threat red `#B23A3A` is only 3.2:1 on Vacuum — right for a filling damage
 *    ring, too dim for a 12px word on a phone — and the ramp already owns the
 *    brighter rung, so no seventh hue enters the palette. It stays inside the
 *    RESERVED rule (style-guide §2: red is "damage, alarm, enemy fire") because
 *    an ENEMY tag is precisely the danger channel; it is never worn by a
 *    friendly or neutral side.
 *  - **neutral = patina** — what the roster underline already drew, and the right
 *    answer for a viewer-less view, which has no friend or foe to colour.
 */
export const SIDE_COLORS: Readonly<Record<SideRelation, number>> = {
  friendly: PALETTE.plasma,
  enemy: 0xcb7979,
  neutral: PALETTE.patina,
};

/** The default side a slot starts on when TEAMS is picked: alternating by slot,
 *  so any active count of two or more already has both sides manned (an even
 *  split at 4v4, 2v1 at three, 1v1 at two) — the host re-assigns from there. A
 *  first-half/second-half default would strand every small match on one side. */
export function defaultTeamForSlot(index: number): number {
  return Math.abs(Math.floor(index)) % 2;
}

/** The abundance ring the ABUNDANCE row walks (ratified developer, p11): the
 *  shipped default is SCARCE ({@link DEFAULT_ABUNDANCE}, "by default more
 *  scarce"), then STANDARD, then RICH, then back. */
export const ABUNDANCE_CYCLE: readonly Abundance[] = ['scarce', 'standard', 'rich'];

/** The words the abundance row shows for each level. */
export const ABUNDANCE_LABELS: Readonly<Record<Abundance, string>> = {
  scarce: 'SCARCE',
  standard: 'STANDARD',
  rich: 'RICH',
};

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
// The four hulls (GDD §2.11) — words, AND pips, AND numbers
//
// Ratified by the developer 2026-08-05 (u4), asked whether ship stats could
// appear on ship-select having been shown coarse pips: **"both pips and
// numbers."** So both, together — pips to compare four hulls at a glance,
// numbers for the player who wants the actual figure. GDD §2.5 and §2.11 carry
// the matching *(amended 2026-08-05)* marker; the superseded rule this file used
// to enforce ("no ship stats on this screen") is gone, not routed around.
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
 * The name the local player shows over their ship and station until they set one
 * (field request v0.2.1). "YOU" is the same word the roster row already uses for
 * the local seat, so a fresh player sees one consistent identity everywhere.
 */
export const DEFAULT_PLAYER_NAME = 'YOU';

/** Longest player name kept, in characters — a nameplate is a quick read over a
 *  24px ship, not a sentence. Clamped on entry ({@link normalizePlayerName}) and
 *  again, defensively, by the nameplate model ([[nameplates]] `NAMEPLATE_MAX_CHARS`). */
export const PLAYER_NAME_MAX_CHARS = 12;

/**
 * Fold a raw name to the stored value: trim surrounding space and clamp length; a
 * name that is empty (or only whitespace) falls back to {@link DEFAULT_PLAYER_NAME},
 * so the local seat is never nameless. Persisted like the hull, so a returning
 * player finds their callsign (the storage seam lives in `main.ts`).
 */
export function normalizePlayerName(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return DEFAULT_PLAYER_NAME;
  return trimmed.length > PLAYER_NAME_MAX_CHARS ? trimmed.slice(0, PLAYER_NAME_MAX_CHARS) : trimmed;
}

/** Pips in one stat's bar. Five is coarse on purpose — a pip bar answers
 *  "which of these four is the fast one?", and the **number beside it** answers
 *  "by how much". Neither is asked to do the other's job. */
export const STAT_PIPS = 5;

/**
 * What a stat pip is drawn in (u4). Lives here, beside {@link SIDE_COLORS} and
 * for the same reason: the frozen palette's reserved rules are a contract, so
 * the colours are pinned by a unit test rather than trusted to a view.
 *
 * **Pips are CHROME, and under Gantry/Bone chrome spends no hue at all** (u7-03).
 * They were plasma-on-the-picked-hull and chalk elsewhere, which was correct
 * while the lobby's selection accent was plasma; the ratified direction makes
 * selection a *brighter plate* rather than a colour (*"the primary action is
 * simply the brightest plate on screen … it spends no colour on the menu, which
 * leaves the palette's hues free to mean things during a match"*), so the pips
 * moved onto the same Bone ramp the settings screen's volume pips use.
 *
 * What has not changed is the rule underneath: a pip is not ore and not danger,
 * so signal yellow `#F2D24B` and threat red `#B23A3A` are both out (style-guide
 * §2), and no seventh hue enters — every tone here is a declared value-ramp step
 * on hull steel (`../art/materials` MATERIAL_RECIPES), verified there.
 */
export const STAT_PIP_COLORS = {
  /** Filled, on the hull you have picked — the brightest metal on the tile. */
  selected: BONE.hi,
  /** Filled, on any other tile — one ramp step down. */
  filled: MATERIAL_SHADES.bone,
  /** The unfilled remainder of a bar — the shaded end of the same ramp. */
  empty: MATERIAL_SHADES.chipFaceLit,
} as const;

/** The stats a hull tile shows, in GDD §2.11's own table order. Exactly the six
 *  columns of that table — the five core attributes the hull choice "sets"
 *  (speed, acceleration, turn rate, armor, weapon power) plus the cargo hold,
 *  which is the sixth column and the Hauler's whole argument. */
export type ShipStatKey = 'speed' | 'accel' | 'turn' | 'hull' | 'power' | 'cargo';

/**
 * One stat on one hull tile: a short label, the sim's own value, that value
 * **printed**, and that same value **as pips**.
 *
 * `text` and `pips` are two renderings of the one `value` ({@link statLine}),
 * which is the whole reason this type carries all three: a tile can never show
 * four pips beside a figure that means three, because there is only ever one
 * number in play and the view does no arithmetic of its own.
 */
export interface ShipStatLine {
  readonly key: ShipStatKey;
  /** The label on the cell — short, because six of these share a phone tile. */
  readonly label: string;
  /** The sim's value, verbatim from `SHIP_STATS` (a multiplier, HP, or slots). */
  readonly value: number;
  /** …the same value as the player reads it: `130%`, `35`, `8`, `3`. */
  readonly text: string;
  /** …and the same value as a coarse bar, 1..{@link STAT_PIPS} filled. */
  readonly pips: number;
  /** Pips in the bar — {@link STAT_PIPS}, carried so the view never hard-codes it. */
  readonly pipMax: number;
}

/**
 * How each stat is read off the sim's table and shown. The `read` functions are
 * the ONLY coupling to `SHIP_STATS`, and there is deliberately no per-class
 * literal anywhere in this file: retune a hull in `../sim/constants` and this
 * screen retunes with it, which is what keeps the tile from advertising a game
 * the sim is not running.
 */
const STAT_SPECS: readonly {
  readonly key: ShipStatKey;
  readonly label: string;
  readonly read: (stats: ShipStats) => number;
  readonly format: (value: number) => string;
}[] = [
  { key: 'speed', label: 'SPD', read: (s) => s.speedMul, format: percent },
  { key: 'accel', label: 'ACC', read: (s) => s.accelMul, format: percent },
  { key: 'turn', label: 'TRN', read: (s) => s.turnMul, format: percent },
  { key: 'hull', label: 'HULL', read: (s) => s.hull, format: whole },
  { key: 'power', label: 'PWR', read: (s) => s.power, format: whole },
  { key: 'cargo', label: 'HOLD', read: (s) => s.cargo, format: whole },
];

/** Speed, acceleration and turn are multipliers over the Vanguard (GDD §2.11
 *  tables them as percentages), so they read as percentages here too. */
function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Hull HP, power and hold are absolute counts — printed as they are. */
function whole(value: number): string {
  return String(Math.round(value));
}

/**
 * A stat's pip scale: the **spread across the four hulls**, so the pips answer
 * the question the screen is actually for — *which of these four is the fast
 * one?* The roster's slowest hull gets one pip and its fastest gets five, and
 * every other tile is placed between them.
 *
 * A scale anchored at zero instead would flatten the roster into four
 * near-identical bars (every hull's speed sits between 85% and 130%), which is a
 * pip bar that compares nothing. The **number** beside it is what keeps the
 * absolute truth on screen, so the coarse scale costs the player nothing.
 *
 * A stat every hull shares — cargo, the day a retune levels it — has no spread
 * to show, so every tile reads full rather than an arbitrary rung.
 */
function pipScale(read: (stats: ShipStats) => number): { min: number; max: number } {
  const values = CLASS_ORDER.map((cls) => read(SHIP_STATS[cls]));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function pipsFor(value: number, scale: { min: number; max: number }): number {
  if (!(scale.max > scale.min)) return STAT_PIPS;
  const t = (value - scale.min) / (scale.max - scale.min);
  return Math.min(STAT_PIPS, Math.max(1, Math.round(1 + t * (STAT_PIPS - 1))));
}

/**
 * One stat line — and the **one place** the number and the pips are decided.
 *
 * `value` is read once, and both renderings hang off that single read. There is
 * no second path by which a tile could print one hull's figure beside another
 * hull's bar, which is the guarantee the brief asked for stated as code rather
 * than as care.
 */
function statLine(
  spec: (typeof STAT_SPECS)[number],
  stats: ShipStats,
  scale: { min: number; max: number },
): ShipStatLine {
  const value = spec.read(stats);
  return {
    key: spec.key,
    label: spec.label,
    value,
    text: spec.format(value),
    pips: pipsFor(value, scale),
    pipMax: STAT_PIPS,
  };
}

/** The six stat lines for one hull, in {@link STAT_SPECS} order — read straight
 *  off the sim's `SHIP_STATS[cls]`, so what the lobby shows is what the match
 *  honours. */
export function shipStatLines(shipClass: ShipClass): readonly ShipStatLine[] {
  const stats = SHIP_STATS[shipClass];
  return STAT_SPECS.map((spec) => statLine(spec, stats, pipScale(spec.read)));
}

/**
 * One hull tile: a name, a hull, a role — **and its stats, as pips and numbers**
 * (u4, ratified 2026-08-05; GDD §2.5 / §2.11 amended).
 *
 * The type used to be the enforcement of "ship stats appear only in the upgrade
 * panel" by carrying no numeric field at all. That rule is superseded: the tile
 * carries {@link stats} now, sourced from the sim and rendered as both a bar and
 * a figure. What has *not* changed is where the numbers come from — never a
 * literal typed into this file.
 */
export interface ShipClassOption {
  readonly shipClass: ShipClass;
  /** Class name, from the shared table the upgrade panel titles itself with. */
  readonly name: string;
  /** The hull's name (GDD §2.11's parenthetical: Quadfin, Anvil, Pincer,
   *  Hammerhead) — the silhouette a player learns to read at 24px (§5.3). */
  readonly hull: string;
  /** The role, in the design's own words. */
  readonly blurb: string;
  /** The six stats of GDD §2.11's table, each as a pip bar **and** a figure. */
  readonly stats: readonly ShipStatLine[];
}

/** The four tiles (GDD §2.11), in {@link CLASS_ORDER}. */
export const CLASS_OPTIONS: readonly ShipClassOption[] = [
  {
    shipClass: ShipClass.Interceptor,
    name: CLASS_NAMES[ShipClass.Interceptor],
    hull: 'Quadfin',
    blurb: 'Scout and miner-hunter. Catches miners in the open; melts against turrets.',
    stats: shipStatLines(ShipClass.Interceptor),
  },
  {
    shipClass: ShipClass.Vanguard,
    name: CLASS_NAMES[ShipClass.Vanguard],
    hull: 'Anvil',
    blurb: 'All-rounder. Does everything second-best — the one to learn the game in.',
    stats: shipStatLines(ShipClass.Vanguard),
  },
  {
    shipClass: ShipClass.Excavator,
    name: CLASS_NAMES[ShipClass.Excavator],
    hull: 'Pincer',
    blurb: 'Mining engine and close bruiser. Out-earns everyone, and cannot run.',
    stats: shipStatLines(ShipClass.Excavator),
  },
  {
    shipClass: ShipClass.Hauler,
    name: CLASS_NAMES[ShipClass.Hauler],
    hull: 'Hammerhead',
    blurb: 'Logistics and siege tank. Hauls the biggest hold and tanks a siege; arrives late.',
    stats: shipStatLines(ShipClass.Hauler),
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
 *  - `human`  — a player is in it.
 *  - `bot`    — a bot is in it: seated by the server at RUSH!, or LOCKED to a bot
 *               by the host (so a joiner can't take it — the explicit-bot state of
 *               the OPEN/BOT/CLOSED cycle).
 *  - `open`   — nobody yet: it *previews* the bot that will fill it, and anyone
 *               with the room code can still take it (GDD §2.1, §4.2).
 *  - `closed` — out of the match ENTIRELY (variable-slots Milestone E): no player,
 *               no station, no colour on the field. `N = count(occupant !==
 *               'closed')`, and it is the seat state that shrinks a match below
 *               eight. Maps to `SlotState.'closed'` (`../sim/match-config`).
 */
export type SeatOccupant = 'human' | 'bot' | 'open' | 'closed';

/** One of the eight seats. */
export interface LobbySeat {
  readonly player: PlayerId;
  readonly occupant: SeatOccupant;
  /** The hull this seat flies. Locked for the match at RUSH! (GDD §2.11). */
  readonly shipClass: ShipClass;
  /** The tier this seat's bot flies at — meaningless on a human seat, and kept
   *  anyway, so a seat that empties again shows the difficulty it had. */
  readonly difficulty: BotDifficulty;
  /** The character previewed (or seated) here, or `null` on a human/closed seat. */
  readonly personality: PersonalityId | null;
  /** The side this slot fights for in TEAMS (variable-slots Milestone E). FFA
   *  ignores it (teams-of-one, `team === slot`); TEAMS shares one value across
   *  allies. Kept on every seat so switching modes never loses an assignment. */
  readonly team: number;
  /**
   * This seat's round trip to the match server, rounded ms — the ping shown next
   * to a human player's name (ratified developer; the wire's `LobbySlot.rtt`,
   * graded by `src/net/ping`). Null on a bot seat always, on an empty or closed
   * seat, offline (no wire to time), and before the server's first probe answers.
   */
  readonly rtt: number | null;
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
  /**
   * The local player's name, shown over their ship and station (field request
   * v0.2.1). Persisted like the hull; defaults to {@link DEFAULT_PLAYER_NAME}.
   * When online lands (m9) each *remote* seat's name arrives via the same slot
   * seam ({@link playerNameTable}) — this field is only ever the LOCAL name.
   */
  readonly name: string;
  /**
   * The arena picked for this match (`../sim/maps` MapDef id) — moved off the
   * PLAY flow into the lobby (p2 field rule). One arena for the whole room,
   * offline the host's (your) pick; locked at RUSH! like the hull. Always a real
   * id ({@link normalizeMapId}), so a stale saved key can never reach the sim.
   */
  readonly mapId: string;
  /**
   * The match mode (variable-slots Milestone E, GDD §2.1): FFA or TEAMS. The one
   * toggle at the top of the roster; locked at RUSH! like the hull and arena.
   * Rides the {@link lobbyMatchConfig} seam the sim consumes.
   */
  readonly mode: MatchMode;
  /**
   * Ore scarcity for this match (ratified developer, p11): the ABUNDANCE row —
   * `scarce | standard | rich`, defaulting to the ratified SCARCE
   * ({@link DEFAULT_ABUNDANCE}, "by default more scarce"). Rides the same
   * {@link lobbyMatchConfig} seam as the mode and the slots.
   */
  readonly abundance: Abundance;
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
  /**
   * The match size to open on (variable-slots Milestone E): the first `size`
   * seats start active, the rest CLOSED, so a returning player's last size is
   * restored without a special path (the same shape {@link ffaConfig} builds).
   * Clamped to {@link MIN_MATCH_SIZE}..{@link MAX_MATCH_SIZE}; default: every
   * physical slot open (the eight-player game).
   */
  readonly size?: number;
  /** The match mode to open on (variable-slots Milestone E). Default `'ffa'`. */
  readonly mode?: MatchMode;
  /** The ore abundance to open on (ratified p11). Default {@link DEFAULT_ABUNDANCE}
   *  — SCARCE, "by default more scarce". */
  readonly abundance?: Abundance;
  /** Your hull. Default {@link DEFAULT_SHIP_CLASS} — the Vanguard (GDD §2.11). */
  readonly shipClass?: ShipClass;
  /** Your name. Default {@link DEFAULT_PLAYER_NAME}; folded through
   *  {@link normalizePlayerName} so a stale/over-long stored value is safe. */
  readonly name?: string;
  /** The arena. Default the registry default (`octagon`, "The Ring"); a stale or
   *  hand-edited value is folded down to it ({@link normalizeMapId}). */
  readonly mapId?: string;
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
  const name = normalizePlayerName(options.name);
  const mapId = normalizeMapId(options.mapId);
  // The size restored (or defaulted): the first `size` seats open, the rest
  // CLOSED — the same shape `ffaConfig` builds, so a returning player's last size
  // is one option, not a special path. A human seat is never closed (below), so a
  // guest welcomed past `size` still holds their seat.
  const size = clampSize(options.size, count);
  const seats: LobbySeat[] = [];
  let emptyIndex = 0;
  for (let player = 0; player < count; player++) {
    const human = player === you || player === host;
    const closed = !human && player >= size;
    const occupant: SeatOccupant = human ? 'human' : closed ? 'closed' : 'open';
    seats.push({
      player,
      occupant,
      shipClass: player === you ? shipClass : DEFAULT_SHIP_CLASS,
      difficulty: human || closed ? 'medium' : defaultDifficultyForEmptySeat(emptyIndex++),
      personality: null,
      team: defaultTeamForSlot(player),
      // Nobody has been measured yet — and offline nobody ever will be.
      rtt: null,
    });
  }
  return withCast({
    room: options.room,
    you,
    host,
    phase: 'gathering',
    seats,
    shipClass,
    name,
    mapId,
    mode: options.mode ?? 'ffa',
    abundance: options.abundance ?? DEFAULT_ABUNDANCE,
    countdown: 0,
    online: options.online ?? true,
  });
}

/** Fold a requested match size into range: absent means every physical slot open
 *  (the eight-player game); present is clamped to 2..8 and never past the physical
 *  seat count of a test fixture. */
function clampSize(size: number | undefined, count: number): number {
  if (size === undefined) return count;
  const ceiling = Math.min(count, MAX_MATCH_SIZE);
  return Math.min(Math.max(Math.floor(size), MIN_MATCH_SIZE), ceiling);
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
    // A human sits in their seat, a closed seat holds nobody: neither previews a
    // bot, and a closed seat must not consume an empty-seat cast index (it is not
    // a seat the room will ever cast into).
    if (seat.occupant === 'human' || seat.occupant === 'closed') {
      return seat.personality === null ? seat : { ...seat, personality: null };
    }
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

/**
 * Pick the arena (a tap on a map card).
 *
 * **The host's, and refused from a guest** — one arena for the whole room, and the
 * room's creator owns it exactly as they own the mode, the abundance and the slot
 * states ({@link hostControls}). A joiner sees the pick read-only: the board they
 * are about to fly is information, not a control, and a guest who could re-pick it
 * would be changing a world the host's own client is about to build. Offline you
 * *are* the host, so the solo lobby is unaffected.
 *
 * {@link hostControls} also refuses once the countdown has started, exactly like
 * the hull ({@link classLocked}): the countdown is the start of the match, and an
 * arena that changed after RUSH! would be an arena the world was not built from.
 * Folds the id to a real one, so a stray index can never select a map that does
 * not exist.
 */
export function selectMap(state: LobbyState, mapId: string): LobbyState {
  if (!hostControls(state)) return state;
  const next = normalizeMapId(mapId);
  if (state.mapId === next) return state;
  return { ...state, mapId: next };
}

/**
 * Set the local player's name (field request v0.2.1). Folded through
 * {@link normalizePlayerName} (trim + clamp + non-empty), so the stored value is
 * always a safe nameplate. Cosmetic, so — unlike the hull and arena — it is not
 * refused during the countdown; whatever it is at RUSH! is the name the match
 * reads. Returns the same state when nothing changed, so a reducer/replay is stable.
 */
export function setPlayerName(state: LobbyState, name: string): LobbyState {
  const next = normalizePlayerName(name);
  if (state.name === next) return state;
  return { ...state, name: next };
}

/**
 * The display name for one slot — the seam the nameplates read, and the same
 * mapping the roster row shows: a **bot** seat shows its character's personality
 * name (GDD §2.9), the **local** seat shows the lobby's {@link LobbyState.name},
 * and any other human seat shows its slot tag (until online carries real remote
 * names, m9). Never empty — identity always resolves to something.
 */
export function nameFor(state: LobbyState, slot: PlayerId): string {
  const seat = state.seats.find((s) => s.player === slot);
  if (!seat) return `P${Math.floor(slot) + 1}`;
  if (seat.occupant !== 'human') {
    const character = seat.personality ? PERSONALITIES[seat.personality] : null;
    return character?.name ?? `P${slot + 1}`;
  }
  if (seat.player === state.you) return state.name;
  return `PLAYER ${seat.player + 1}`;
}

/**
 * The per-slot name table the nameplate layer consumes ([[nameplates]]
 * `NameTable`) — one entry per seat, indexed by slot, built from the lobby's own
 * state. This is the single data-driven seam: offline it carries the local name
 * and the bot cast's personality names; when online lands (m9) the server's room
 * names populate the exact same array, with no change to the nameplate model.
 */
export function playerNameTable(state: LobbyState): string[] {
  const table: string[] = [];
  for (const seat of state.seats) table[seat.player] = nameFor(state, seat.player);
  return table;
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
  // Only a bot-bearing seat has a difficulty: a human flies their own hull, a
  // closed seat holds nobody.
  if (!seat || !isBotSeat(seat.occupant)) return state;
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
  return state.seats.filter((s) => isBotSeat(s.occupant)).map((s) => s.difficulty);
}

// ---------------------------------------------------------------------------
// Variable matches — mode, seat state, teams, abundance (Milestone E)
// ---------------------------------------------------------------------------

/** Whether a seat will fly a bot: an OPEN preview or a host-LOCKED bot. Not a
 *  human (their own hull), not CLOSED (nobody). The one predicate the cast, the
 *  difficulty tap and the config builder share. */
export function isBotSeat(occupant: SeatOccupant): boolean {
  return occupant === 'open' || occupant === 'bot';
}

/** The seats that take the field — everything not CLOSED, in slot order. `N` is
 *  its length (2..8 when the lobby can RUSH). */
export function activeSeats(state: LobbyState): readonly LobbySeat[] {
  return state.seats.filter((s) => s.occupant !== 'closed');
}

/** `N` — the match size, the count of non-closed seats. */
export function matchSizeOf(state: LobbyState): number {
  return activeSeats(state).length;
}

/** The distinct sides manned by the active seats — TEAMS needs at least two, or
 *  it is FFA wearing a costume (secondary ratified default: ≥1 player per team). */
export function activeTeams(state: LobbyState): number {
  return new Set(activeSeats(state).map((s) => s.team)).size;
}

/**
 * Cycle one seat's occupancy — the host's tap on a roster row: OPEN → BOT →
 * CLOSED → OPEN ({@link SEAT_STATE_CYCLE}). A no-op from a guest, after RUSH!, or
 * on a HUMAN seat — you cannot cycle a seat somebody is sitting in (the same three
 * refusals {@link cycleBotDifficulty} keeps, plus the human guard). Closing a seat
 * is never blocked on the count — the developer ratified "show, never block"; the
 * floor of two is enforced at {@link canStart}, not here.
 */
export function cycleSeatState(state: LobbyState, player: PlayerId): LobbyState {
  if (!hostControls(state)) return state;
  const seat = state.seats[player];
  if (!seat || seat.occupant === 'human') return state;
  const at = SEAT_STATE_CYCLE.indexOf(seat.occupant);
  const next = SEAT_STATE_CYCLE[(at + 1) % SEAT_STATE_CYCLE.length] ?? 'open';
  if (next === seat.occupant) return state;
  return withCast({
    ...state,
    seats: state.seats.map((s) => (s.player === player ? { ...s, occupant: next } : s)),
  });
}

/**
 * Flip the match mode FFA ⇄ TEAMS (the toggle at the top of the roster). A no-op
 * from a guest or after RUSH! — the mode is match config the world is built from,
 * so it locks with the hull. Team assignments are kept across the flip (they live
 * on every seat), so a host who set sides, glanced at FFA, and flipped back finds
 * them intact.
 */
export function toggleMode(state: LobbyState): LobbyState {
  if (!hostControls(state)) return state;
  const mode: MatchMode = state.mode === 'ffa' ? 'teams' : 'ffa';
  return { ...state, mode };
}

/**
 * Cycle one seat's TEAM (the host's tap on a row's team chip, TEAMS only). A
 * no-op from a guest, after RUSH!, outside TEAMS, or on a CLOSED seat — a seat
 * out of the match has no side. Humans and bots alike are assignable: the host
 * seats the sides (secondary ratified default). Walks 0..{@link MAX_TEAMS}-1.
 */
export function cycleSeatTeam(state: LobbyState, player: PlayerId): LobbyState {
  if (!hostControls(state) || state.mode !== 'teams') return state;
  const seat = state.seats[player];
  if (!seat || seat.occupant === 'closed') return state;
  const next = (Math.floor(seat.team) + 1) % MAX_TEAMS;
  if (next === seat.team) return state;
  return { ...state, seats: state.seats.map((s) => (s.player === player ? { ...s, team: next } : s)) };
}

/**
 * Cycle the ABUNDANCE row SCARCE → STANDARD → RICH → SCARCE
 * ({@link ABUNDANCE_CYCLE}). A no-op from a guest or after RUSH! — abundance is
 * economy config the world is built from, so it locks with the hull.
 */
export function cycleAbundance(state: LobbyState): LobbyState {
  if (!hostControls(state)) return state;
  const at = ABUNDANCE_CYCLE.indexOf(state.abundance);
  const next = ABUNDANCE_CYCLE[(at + 1) % ABUNDANCE_CYCLE.length] ?? DEFAULT_ABUNDANCE;
  if (next === state.abundance) return state;
  return { ...state, abundance: next };
}

/**
 * The whole authored match, as the one {@link MatchConfig} the sim consumes
 * (`../sim/match-config`): the mode, the abundance, and eight slots each mapped
 * from its seat —
 *
 *  - a CLOSED seat → `closed` (dropped at world-build, shrinks `N`);
 *  - a host-locked BOT → `bot`;
 *  - a HUMAN → `open` (a live competitive seat);
 *  - an OPEN preview → `open` online (a joiner can still take it) or `bot`
 *    offline (there is no wire for a joiner, so the empty seats are the cast).
 *
 * `team` rides FFA as the slot id (teams-of-one) and TEAMS as the authored side;
 * the bot fields ride only bot-bearing slots. This is the single handoff to the
 * wire and the world — the lobby is the only place a `MatchConfig` is authored.
 */
export function lobbyMatchConfig(state: LobbyState): MatchConfig {
  const slots: SlotConfig[] = state.seats.map((seat) => {
    const slotState = seatSlotState(seat.occupant, state.online);
    const bot = slotState === 'bot';
    return {
      index: seat.player,
      state: slotState,
      shipClass: seat.shipClass,
      team: state.mode === 'ffa' ? seat.player : seat.team,
      ...(bot && seat.personality ? { botPersonality: seat.personality } : {}),
      ...(bot ? { botDifficulty: seat.difficulty } : {}),
    };
  });
  return { mode: state.mode, slots, abundance: state.abundance };
}

/**
 * The authored sides as **the wire spells them**: one entry per physical lobby
 * slot 0..7, closed seats included (m10 teams-wire).
 *
 * Physical because that is what the other end indexes by — the server's seats are
 * slots and it reads this by `slot.player` (`server/room.ts` `applyTeamConfig`).
 * FFA reads as teams-of-one, so sending it in FFA is a no-op rather than a
 * special case the caller has to remember.
 */
export function lobbyWireTeams(state: LobbyState): number[] {
  return lobbyMatchConfig(state).slots.map((slot) => slot.team);
}

/**
 * The same authored sides as **the world builds them**: dense, closed slots
 * dropped and the survivors re-indexed 0..N-1 ({@link configToPlayers}, spike
 * Trap 6), so entry `i` is the side of the ship the sim will call player `i`.
 *
 * The offline half of the identical handoff {@link lobbyWireTeams} makes to the
 * server — `bootOfflineMatch` stamps this onto its roster. Two functions rather
 * than one because the two ends genuinely index differently, and one function
 * pretending otherwise is how the sparse lobby id {0,2,5} gets into the sim.
 */
export function lobbyRosterTeams(state: LobbyState): number[] {
  return configToPlayers(lobbyMatchConfig(state)).map((spec) => spec.team ?? spec.id);
}

/** One seat's occupancy as the config's {@link SlotState}: an OPEN preview is a
 *  joinable seat online but a bot offline (no wire for a joiner). */
function seatSlotState(occupant: SeatOccupant, online: boolean): SlotState {
  switch (occupant) {
    case 'closed':
      return 'closed';
    case 'bot':
      return 'bot';
    case 'human':
      return 'open';
    case 'open':
      return online ? 'open' : 'bot';
  }
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
    // The wire has no "closed" flag yet (the server seam is Milestone C), so a
    // seat the host closed locally stays closed unless the wire actually seats a
    // human or a bot in it — an `open`-reading wire slot never re-opens it.
    const occupant: SeatOccupant = wire.isBot
      ? 'bot'
      : wire.ready
        ? 'human'
        : seat.occupant === 'closed'
          ? 'closed'
          : 'open';
    const mine = seat.player === state.you && state.phase === 'gathering';
    return {
      ...seat,
      occupant,
      shipClass: mine ? state.shipClass : wire.shipClass,
      difficulty: wire.botDifficulty ?? seat.difficulty,
      // Allegiance is static config the server carries on the slot (Task C4);
      // absent (a pre-teams host), the seat keeps the side it already had.
      team: wire.team ?? seat.team,
      // Ping is a *measurement*, so it is taken wholesale from the broadcast that
      // carries it rather than remembered: a seat the server has stopped
      // measuring (a bot took it, the socket went quiet) blanks, and never keeps
      // showing the last number it had. A bot never carries one at all.
      rtt: occupant === 'human' ? (wire.rtt ?? null) : null,
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

/**
 * Whether RUSH! can be pressed right now: the host, still gathering, with a legal
 * match to start. Empty seats are never a reason to wait — they become bots (GDD
 * §2.1, §4.2) — but two things gate the start (variable-slots Milestone E):
 *
 *  - **At least two players.** A match needs two live cores ({@link MIN_MATCH_SIZE},
 *    the sim's `< 2` win guard); a host who closed all but one seat cannot RUSH.
 *  - **In TEAMS, at least two sides.** One team is FFA in a costume (the secondary
 *    ratified default: ≥1 player per team). Any *split* is allowed — 3v1 is fine,
 *    counts are shown never blocked — but not a single team.
 */
export function canStart(state: LobbyState): boolean {
  if (!hostControls(state)) return false;
  if (matchSizeOf(state) < MIN_MATCH_SIZE) return false;
  if (state.mode === 'teams' && activeTeams(state) < 2) return false;
  return true;
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
  /** The seat's occupancy (variable-slots Milestone E) — the view dims a `closed`
   *  row and shows the OPEN/BOT/CLOSED cycle state. */
  readonly state: SeatOccupant;
  /** …and that state IN WORDS, for the row's leading state control (u5):
   *  `OPEN` / `BOT` / `CLOSED`, or `TAKEN` on a seat with a person in it
   *  ({@link SEAT_STATE_LABELS}). The control states the state it is on, so a
   *  player can answer "can I close this slot?" without experimenting. */
  readonly stateLabel: string;
  /**
   * Whether *this client, right now* may cycle this seat's state — exactly the
   * three refusals {@link cycleSeatState} already keeps: the host only, before
   * RUSH!, and never on a human seat.
   *
   * It is on the seat view because the control has to LOOK unavailable in each of
   * those cases rather than look live and then refuse (u5): a dead-looking button
   * beats a lying one. Deriving it here — from the same predicate the mutation
   * uses — is what keeps the drawn state and the real refusal from drifting.
   */
  readonly canCycleState: boolean;
  /** Out of the match: no station, no player. The view draws it as a shut seat. */
  readonly isClosed: boolean;
  /** The side this slot fights for (raw team number, TEAMS). */
  readonly team: number;
  /** …and its label (`A`…`D`), so the row reads the team with the hue removed —
   *  colour is identity, the letter is the team (style-guide §3 rule 3). The
   *  letter is ABSOLUTE: this row is `B` on every player's screen. */
  readonly teamLabel: string;
  /** …and the same side as the WORD *you* read — `FRIENDLY A` on your own side,
   *  `ENEMY B` on any other (ratified u3, 2026-08-05, refining m10's `TEAM A`).
   *  The chip carries this rather than the bare letter, and the in-match
   *  nameplates carry the identical string for the same seat and viewer
   *  ({@link teamName}), so the roster and the battlefield teach one vocabulary. */
  readonly teamName: string;
  /** …and that same relation as a token, so the view can colour the team motif
   *  (blue friendly / red enemy, {@link SIDE_COLORS}) without re-deciding it. */
  readonly side: SideRelation;
  /** The tier, on a bot row only. */
  readonly botDifficulty?: BotDifficulty;
  /**
   * This player's ping, ready to draw — `{ ms, label, grade }` — or **null**, and
   * null is the common case: a bot row never carries one (ratified: bots are in
   * the sim, `0ms` would be a lie), and neither does an empty or closed seat, an
   * offline lobby, or a human the server has not measured yet
   * (`src/net/ping` `seatPing`, which owns both rules).
   */
  readonly ping: PingReadout | null;
}

/** A side's active headcount, for the always-visible TEAMS tally (ratified:
 *  counts shown, never blocking). */
export interface LobbyTeamCount {
  readonly team: number;
  readonly label: string;
  readonly count: number;
}

/** The lobby for one frame. */
export interface LobbyModel {
  readonly phase: LobbyPhase;
  readonly room: RoomCode;
  readonly seats: readonly LobbySeatView[];
  readonly classOptions: readonly ShipClassOption[];
  /** Your hull — the tile drawn as selected. */
  readonly shipClass: ShipClass;
  /** Your name (field request v0.2.1) — shown on your roster row and over your
   *  ship and station in the match. */
  readonly name: string;
  /** The arena — the map card drawn as selected (`../sim/maps` id). */
  readonly mapId: string;
  /** The match mode — the toggle drawn as FFA or TEAMS (variable-slots E). */
  readonly mode: MatchMode;
  /** The ore abundance — the row drawn as SCARCE / STANDARD / RICH (ratified p11). */
  readonly abundance: Abundance;
  /** `N` — active (non-closed) seats, 2..8. The size the world will build at. */
  readonly size: number;
  /** Per-side active headcounts, always present so TEAMS shows them and never
   *  blocks a split (ratified). Sorted by team; empty of nothing active. The
   *  tally is by the ABSOLUTE letter (`A 4 · B 4`) — it counts sides, and a
   *  headcount is the one place on this screen that is nobody's point of view. */
  readonly teamCounts: readonly LobbyTeamCount[];
  /** The viewing player's own side ({@link viewerTeamOf}) — what makes every
   *  row's word `FRIENDLY` or `ENEMY`. `undefined` in a viewer-less roster. */
  readonly viewerTeam: number | undefined;
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
  const viewer = viewerTeamOf(state);
  // Read ONCE, from the same predicate the mutations use, and handed to every row:
  // whether this client may edit the slots at all (the host, before RUSH!). It is
  // what makes each row's state control draw live or dead — honestly, per seat.
  const canEdit = hostControls(state);
  const seats = state.seats.map((seat) => seatView(state, seat, viewer, canEdit));
  // Counts are of the ACTIVE field only — a closed seat is neither a player nor a
  // bot, it is a shut door, so the RUSH hint and the team tally both ignore it.
  const active = seats.filter((s) => !s.isClosed);
  const humanCount = active.filter((s) => !s.isBot).length;
  const botCount = active.filter((s) => s.isBot).length;
  return {
    phase: state.phase,
    room: state.room,
    seats,
    classOptions: CLASS_OPTIONS,
    shipClass: state.shipClass,
    name: state.name,
    mapId: state.mapId,
    mode: state.mode,
    abundance: state.abundance,
    size: active.length,
    teamCounts: teamCountsOf(active),
    viewerTeam: viewer,
    classLocked: classLocked(state),
    countdown: {
      active: state.phase === 'counting',
      label: countdownLabel(state),
      seconds: state.countdown,
    },
    canStart: canStart(state),
    hostControls: state.you === state.host,
    humanCount,
    botCount,
    online: state.online,
  };
}

/** The active seats grouped into per-side headcounts, sorted by team number —
 *  the always-visible TEAMS tally (ratified: shown, never blocking). */
function teamCountsOf(active: readonly LobbySeatView[]): LobbyTeamCount[] {
  const counts = new Map<number, number>();
  for (const seat of active) counts.set(seat.team, (counts.get(seat.team) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([team, count]) => ({ team, label: teamLabel(team), count }));
}

/**
 * The VIEWING player's own side — the relative half of every side label on this
 * screen ({@link teamName}).
 *
 * Read off the seat the local player is actually sitting in, so a host who
 * re-assigns their own side sees the whole roster re-word itself in the same
 * frame. `undefined` when no seat is the viewer's — the documented viewer-less
 * case (a spectator, or a roster rendered with no local player), where every row
 * reads the neutral `TEAM <letter>` rather than being declared hostile.
 */
export function viewerTeamOf(state: LobbyState): number | undefined {
  const seat = state.seats.find((s) => s.player === state.you);
  return seat ? seat.team : undefined;
}

function seatView(
  state: LobbyState,
  seat: LobbySeat,
  viewerTeam: number | undefined,
  canEdit: boolean,
): LobbySeatView {
  const isBot = isBotSeat(seat.occupant);
  const isClosed = seat.occupant === 'closed';
  const character = seat.personality ? PERSONALITIES[seat.personality] : null;
  const name = isClosed
    ? 'CLOSED'
    : isBot
      ? (character?.name ?? 'BOT')
      : seat.player === state.you
        ? state.name
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
    state: seat.occupant,
    stateLabel: SEAT_STATE_LABELS[seat.occupant],
    // The control's live/dead look, from the mutation's own three refusals: the
    // host, before RUSH! (both folded into `canEdit`), and never a human seat.
    canCycleState: canEdit && seat.occupant !== 'human',
    isClosed,
    team: seat.team,
    teamLabel: teamLabel(seat.team),
    // The WORD is the viewer's ("FRIENDLY A" on your own side), the LETTER is
    // everyone's — one formatter, so this row and that row's nameplate cannot drift.
    teamName: teamName(seat.team, viewerTeam),
    side: sideRelation(seat.team, viewerTeam),
    // An open seat stops being claimable the moment the match starts; a seat the
    // server has already seated a bot in was never claimable to begin with; a
    // closed seat is a shut door; and offline there is no wire for a second player
    // to arrive on, so nothing is ever "claimable by room code" (the empty seats
    // are simply the bot cast).
    openToJoin: seat.occupant === 'open' && state.phase !== 'started' && state.online,
    // `isBot` here is the OPEN-or-BOT predicate, so an unclaimed seat previewing a
    // character is covered by the same rule the wire keeps: no number on a row
    // nobody is dialing in from.
    ping: seatPing({ isBot: isBot || isClosed, rtt: seat.rtt }),
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

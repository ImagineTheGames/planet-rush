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
 *     *(u10-01, 2026-08-07: the four hull tiles moved to a **screen** of their own
 *     ({@link LobbyScreen}) and the roster kept one card — the pick. The rule is
 *     unchanged and so is the card: pips AND numbers, off the sim's own table.
 *     What moved is where the four are compared, not whether stats are shown.)*
 *
 * ---------------------------------------------------------------------------
 * WHAT THE EMPTY SEATS SHOW
 * ---------------------------------------------------------------------------
 * "Empty slots are filled by AI bots; before the match, the host picks each
 * bot's **character**, and its difficulty is shown" (GDD §2.1, amended
 * 2026-08-07) — because the bots are "characters, not difficulty labels" (GDD
 * §2.9) and that stopped being an aspiration and became the literal interface. So
 * an unclaimed seat does not read as a hole: it names the character who will fly
 * it, states that character's tier beside the name as information, offers a `?`
 * to its codex dossier, and is marked OPEN for as long as somebody can still take
 * it by room code.
 *
 * ---------------------------------------------------------------------------
 * ONE CONTROL, SO THERE IS NOTHING LEFT TO DISAGREE WITH IT (a0-06)
 * ---------------------------------------------------------------------------
 * This screen used to carry a per-seat **difficulty** and resolve a character
 * from it. Two things were wrong with that, and the second is the one that got
 * reported. It was hard to reason about — *"this bot personality thing makes no
 * sense … its difficult to understand and difficult to balance a team with it"* —
 * and the resolved character never actually reached the match, so the developer
 * saw *"i chose HARD for all enemies but they were at other difficulties than i
 * selected."*
 *
 * The seat stores a {@link LobbySeat.character} now and the tier is *read off it*
 * ({@link seatDifficulty}). That is not the same fix as carrying a difficulty
 * through properly: it **deletes the possibility of a mismatch**, because there
 * is no longer a second control that can hold a different opinion from the cast.
 * The character then travels — {@link lobbyRosterCast} → `MatchBootConfig.cast` →
 * `fillEmptySlots` — which is the half that was missing entirely.
 *
 * A lobby nobody touches still opens on the whole seven-character cast, one of
 * each, at each character's own tier ({@link defaultCharacterForEmptySeat}), so
 * the default roster is exactly the one this screen has always previewed.
 * **Repeats are allowed** — eight slots, seven characters, three of them Hard, so
 * a full house needs one and a balanced 4v4 of Hard bots needs a fourth Hard bot
 * that does not exist — and a repeated character is numbered in the name
 * (`Warden 1` / `Warden 2`, `../bots` `castDisplayNames`) rather than forbidden.
 *
 * {@link castForEmptySeat} survives for the wire alone: a `lobbyState` broadcast
 * carries a bot's tier and no character, so a seat the *server* re-tiered still
 * has to resolve to the name `server/room.ts` `castFor` will really seat.
 */

import type { PlayerId, Rng } from '@shared/types';
import { ShipClass } from '@shared/types';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import { BONE, MATERIAL_SHADES } from '../art/materials';
import { Difficulty, MATCH_SLOTS, PERSONALITIES, ROSTER, castDisplayNames, rosterAt } from '../bots';
import type { PersonalityId } from '../bots';
import type { BotDifficulty, LobbySeatState, LobbySlot, RoomCode } from '../net/transport';
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
import { mapCardModel, normalizeMapId } from './map-picker';
import type { MapCardModel } from './map-picker';

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
/**
 * `CLAIM`, not `ROOM` (GDD §4.7 register 2; sweep doc §3 "lobby ROOM → CLAIM").
 * u7-03 extracted this string out of the view and, forking from before the
 * sweep, carried the pre-sweep word up with it — so the merge restores the
 * ratified noun into u7-03's constant rather than reverting the extraction.
 * The room *code* stays a code: the noun above it moved, the code did not
 * (see `lobby-entry.ts` ENTRY_ERRORS, and r1-01's `CLAIM CODE` keypad fix).
 */
export const LOBBY_EYEBROW = 'CLAIM';

/** Seconds the RUSH countdown runs for. Long enough to put a thumb back on the
 *  stick, short enough that nobody reads it twice. TUNABLE */
export const RUSH_COUNTDOWN_SECONDS = 5;

/**
 * The words over the lobby's two summary cards (u10-01) — the eyebrow that turns
 * each card from a label into a **control that opens something**.
 *
 * `NOUN · VERB`, and both halves are load-bearing. The noun says which of the two
 * picks this card is; the verb says that pressing it does something, which a card
 * showing your own selection cannot say on its own (this screen has drawn selected
 * cards as raised plates since u7-03, so a raised card reads as a *state*).
 *
 * **`CHANGE`, not `TAP TO CHANGE`.** The lobby runs on a desktop with a mouse, on a
 * phone with a thumb, and under the keyboard/gamepad menu nav — so a word naming
 * one of those three gestures is wrong on the other two, and GDD §2.4's parity
 * principle has no cell for a device-specific instruction. It is also the shorter
 * word, and the strip it rides is 54px on the narrowest phone.
 *
 * The guest form is the arena's host rule in words: the same `CLAIM HOLDER` noun
 * the footer's `WAITING FOR THE CLAIM HOLDER` already uses (GDD §4.7 worked
 * examples — "claim holder", not "host"), so the roster teaches one word for the
 * person who owns the room rather than two.
 */
export const SHIP_PICK_LABEL = 'SHIP · CHANGE';
export const MAP_PICK_LABEL = 'MAP · CHANGE';
export const MAP_PICK_GUEST_LABEL = "MAP · CLAIM HOLDER'S";

/** The words a difficulty is shown as. The tier is named in full on the row —
 *  and since a0-06 it is **shown, not chosen** (GDD §2.1 amended 2026-08-07): the
 *  host picks the character, and this word is what the character's tier reads as
 *  ({@link seatDifficulty}). */
export const DIFFICULTY_LABELS: Readonly<Record<BotDifficulty, string>> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
};

/**
 * Cycle order for the host's per-seat **character** tap — the whole roster, in
 * GDD §2.9's own order, which is also tier order: Rusty and Bolt (Easy), Foreman
 * and Patch (Medium), Sable, Vulture and Warden (Hard).
 *
 * It replaces the three-rung difficulty cycle this constant's neighbour used to
 * be, and the gesture is identical — *"cycling seven names is the same gesture as
 * cycling three tiers"* (a0-06). Walking the roster in this order means the tap
 * still walks *up* the ladder rather than down into Hard by accident, so the one
 * thing the old cycle got right is kept.
 */
export const CHARACTER_CYCLE: readonly PersonalityId[] = ROSTER;

/**
 * The glyph on a roster row's codex control (a0-06 — the developer asked for
 * *"a ? question mark icon"*). A bare ASCII `?`: it is one character wide at any
 * type size, it needs no icon asset, and it is the same mark every interface a
 * player has ever used puts on "explain this."
 *
 * It lives here rather than in the view for the reason every other lobby string
 * does — the copy sweep reads the models, and a string typed into a draw call is
 * a string nobody can find (`docs/copy-sweep-industrial-voice.md`).
 */
export const SEAT_HELP_GLYPH = '?';

// ---------------------------------------------------------------------------
// The level badge (pr-06) — LEVEL yes, XP never, LOBBY only
// ---------------------------------------------------------------------------

/**
 * The word on the local player's level badge. **`LVL`, not `LEVEL`** — the chip
 * it rides in is the row's trailing 54px (`./lobby-geometry` `SEAT_CHIP_WIDTH`),
 * and `LEVEL 7` would be auto-fitted down to a smudge on the
 * landscape phone this screen is locked to, whereas `LVL 7` sits at full type
 * size at every width in QA's matrix. The industrial voice
 * (`docs/copy-sweep-industrial-voice.md`) reads the models, which is why this
 * string lives here rather than in a draw call.
 *
 * It lives beside the roster's other words for the same reason `DIFFICULTY_LABELS`
 * does, and it is deliberately a *prefix*, not a format string: there is exactly
 * one number that may follow it, and it is a level.
 */
export const LEVEL_BADGE_PREFIX = 'LVL';

/**
 * A career level as the badge prints it — `LVL 7`.
 *
 * ---------------------------------------------------------------------------
 * THE RULING THIS FUNCTION IS HALF OF
 * ---------------------------------------------------------------------------
 * The developer, 2026-08-07, verbatim: *"we can show the LEVEL but not XP (and
 * show it only in the lobby)."* Three rules, and this function keeps the first
 * two: it formats a **level**, and it has no way to print an XP total — there is
 * no XP parameter, no second line and no tooltip. The third rule ("lobby only")
 * is kept by {@link seatView}, which puts the badge on exactly one row and by
 * `src/ui/level-badge.test.ts`, which asserts its absence everywhere else.
 *
 * **A junk level folds to 1**, the `readMapId` discipline every persisted value
 * on this screen already keeps (plan §2.1). The profile reader refuses a
 * malformed level before it gets here, so this is the second line of defence —
 * but it is the cheap one, and the failure it prevents (`LVL undefined` on the
 * roster) is the one a player reads as a broken game rather than as a new career.
 */
export function levelBadgeLabel(level: number): string {
  const safe = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return `${LEVEL_BADGE_PREFIX} ${safe}`;
}

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
 *
 * **This is the ONLINE ring** since a0-31 — the ring a room a joiner can reach
 * walks. Solo walks {@link SOLO_SEAT_STATE_CYCLE}; ask {@link seatStateCycle} for
 * the one a given lobby is on rather than reaching for either by name.
 */
export const SEAT_STATE_CYCLE: readonly SeatOccupant[] = ['open', 'bot', 'closed'];

/**
 * The ring a **solo** lobby walks: BOT ⇄ CLOSED, and no OPEN at all (a0-31 —
 * developer: *"in solo play there should be no slot open it's either closed or
 * bot. no one can join in solo…."*).
 *
 * It is {@link SEAT_STATE_CYCLE} with the one rung removed that solo cannot mean,
 * not a second vocabulary: OPEN is *"a chair a joiner can still take"*, and offline
 * there is no wire for a joiner to arrive on. The lobby has always agreed with that
 * everywhere it *reads* a seat — `createLobby` seeds an offline seat BOT, and
 * `LobbySeatView.openToJoin` is false offline — and the tap was the one place that
 * did not, so the control could put the screen into a state the rest of the file
 * would then have to describe as a seat nobody can fill.
 */
export const SOLO_SEAT_STATE_CYCLE: readonly SeatOccupant[] = ['bot', 'closed'];

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
 * Who holds a seat *(the `open` rung rewritten a0-11, 2026-08-07)*.
 *
 *  - `human`  — a player is in it.
 *  - `bot`    — the host put an AI there. This is where the cast preview and
 *               {@link defaultDifficultyForEmptySeat} belong, and the only state
 *               that puts a bot on the field.
 *  - `open`   — **empty, waiting for a human.** It contributes no ship, no
 *               station, no colour and **no bot**: if nobody takes it, it is
 *               simply not in the match. Anyone with the room code still can
 *               (GDD §2.1, §4.2).
 *  - `closed` — out of the match ENTIRELY (variable-slots Milestone E): no player,
 *               no station, no colour on the field. Maps to `SlotState.'closed'`
 *               (`../sim/match-config`), and so — now — does an unclaimed `open`.
 *
 * `open` used to mean "a bot will sit here", which collapsed the very distinction
 * §2.1 draws between *a competitive human seat* and *AI-filled*. The developer
 * asked for it back — *"it should start with all slots OPEN and no bots in it (it
 * should be up to player to fill it up with bots if they want)"* — and §2.1 is
 * amended to match: **`N` counts humans plus bots**, and the only difference left
 * between `open` and `closed` is that a joiner can still take an open seat.
 */
export type SeatOccupant = 'human' | 'bot' | 'open' | 'closed';

/** One of the eight seats. */
export interface LobbySeat {
  readonly player: PlayerId;
  readonly occupant: SeatOccupant;
  /** The hull this seat flies. Locked for the match at RUSH! (GDD §2.11). */
  readonly shipClass: ShipClass;
  /**
   * **The character the host chose for this seat** — the one per-seat bot control
   * there is (a0-06, 2026-08-07), replacing the `difficulty` field that used to
   * live here.
   *
   * It is kept on *every* seat, meaningless as it is on a human or a closed one,
   * for exactly the reason the tier was: a seat that empties again shows the
   * character it had rather than snapping back to roster order. The tier is no
   * longer stored beside it — it is read off the character
   * ({@link seatDifficulty}), which is what makes a lobby where the two disagree
   * unrepresentable rather than merely unlikely.
   */
  readonly character: PersonalityId;
  /** The character previewed (or seated) here, or `null` on a human/closed seat —
   *  {@link character} gated by {@link isBotSeat}. Derived, never authored. */
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

// ---------------------------------------------------------------------------
// The three screens this room is looked at through (u10-01)
// ---------------------------------------------------------------------------

/**
 * Which of the lobby's three screens has the display.
 *
 * ---------------------------------------------------------------------------
 * THE REPORT, AND WHY IT IS A SCREEN SPLIT RATHER THAN A TIDY-UP
 * ---------------------------------------------------------------------------
 * The developer, 2026-08-07, with a screenshot of the live lobby: *"in the lobby
 * page select ship and select map need to open different pages, we should only
 * show 1 ship and 1 map in lobby because it's too cluttered now"*.
 *
 * CREW MUSTER was carrying eight roster rows, **four hull tiles of six stats
 * each** and **four arena cards** on one 390px-wide screen. The Gantry re-skin
 * (u7-03) made that visible rather than causing it. So the two four-card blocks
 * become two screens of their own, and the roster keeps one card of each — the
 * *pick*, as a control that opens the screen it was picked on.
 *
 *  - `roster`      — CREW MUSTER: the eight seats, the MODE / YIELD strip, one
 *                    ship card, one arena card, RUSH!.
 *  - `ship-select` — the four hulls with their full stats, pips AND numbers
 *                    (u4, ratified 2026-08-05; GDD §2.5 / §2.11 amended). This is
 *                    where the comparison happens, so it finally has the room to
 *                    do it properly.
 *  - `map-select`  — the four arenas with their registry previews, names and the
 *                    VETERAN tag.
 *
 * It lives on the lobby STATE rather than in the wiring for the reason every
 * other decision on this screen does: the brief's whole test list — pressing a
 * card opens its screen, picking returns with the card updated, BACK returns
 * without changing the pick, a guest cannot author the arena — is then a headless
 * unit test rather than a browser run. `main.ts` only draws what this says.
 *
 * **It is not match config.** Nothing here rides the wire, nothing here reaches
 * `MatchConfig`, and RUSH! resolves the same choices from whichever screen the
 * player happens to be standing on ({@link lobbyMatchConfig} does not read it).
 */
export type LobbyScreen = 'roster' | 'ship-select' | 'map-select';

/** Every lobby screen, in a stable order — the audit list the nav-graph contract
 *  (`./menu-nav`) is checked against. */
export const LOBBY_SCREENS: readonly LobbyScreen[] = ['roster', 'ship-select', 'map-select'];

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
  /**
   * Which of the room's three screens is up (u10-01) — the roster, SHIP SELECT or
   * MAP SELECT. Purely where the player is *standing*: it is not sent, not stored
   * and not read by anything that builds a world, and a lobby resolved at RUSH!
   * yields the identical {@link MatchConfig} from any of the three.
   */
  readonly screen: LobbyScreen;
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
  /**
   * **The LOCAL player's career level** — the one number this screen is allowed
   * to show about a career, and the only place in the whole game it may appear
   * (pr-06; plan §Q2, ratified 2026-08-07: *"we can show the LEVEL but not XP
   * (and show it only in the lobby)"*).
   *
   * Read from `src/progression/profile.ts` `loadProfile` by the boot that opens
   * the lobby and handed in here, exactly like {@link name} and {@link mapId}:
   * this model imports no storage and no profile, so it stays pure and testable
   * and the sim can never reach a career through it (GDD §4.8).
   *
   * **It is the local player's and nobody else's.** There is no per-seat level on
   * {@link LobbySeat} and no level on the wire — a remote human's level is a
   * number their own client authored (plan §2.2: m9 has no accounts), so it is
   * not read, not requested and not rendered. Never below 1; a fresh career is
   * level 1 (`freshProfile`).
   *
   * **And never XP.** The raw total is private to its owner *always* — the badge
   * carries a level, never an XP figure, which is why this field is a level and
   * there is no sibling beside it.
   */
  readonly level: number;
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
  /**
   * Your career level, from `loadProfile` (pr-06). Default **1** — a fresh
   * career, and the same value `freshProfile()` holds, so a lobby opened with no
   * profile at all draws `LVL 1` rather than a hole. Folded to a whole number ≥ 1
   * on the way in ({@link levelBadgeLabel}'s discipline), so a hand-edited store
   * can never put a fraction or a negative on the roster.
   */
  readonly level?: number;
  /** Joinable over the wire? Default true (online). The offline solo-vs-bots
   *  boot passes false, which hides the room code and the OPEN seat markers. */
  readonly online?: boolean;
}

/**
 * A fresh lobby: you in your seat, and every other seat **empty** — no bot, no
 * cast preview, nothing AI-filled until the host says so (a0-11; GDD §2.1
 * *amended 2026-08-07*).
 *
 * The host's seat is seated too when it isn't yours — joining a room means
 * somebody created it, and a creator with no body in the chair would read as an
 * open seat holding the RUSH! button.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PLACE THE TWO FLAVOURS OF THIS SCREEN GENUINELY DIFFER
 * ---------------------------------------------------------------------------
 * An `online` room seeds its non-host seats **OPEN**; an **offline** one seeds
 * them **BOT**.
 *
 * That is not a second design. The developer's report is about the room you
 * *create to play online*: *"when creating a room to play online it should start
 * with all slots OPEN and no bots in it."* An OPEN seat means "waiting for a
 * human", and offline there is no wire for a human to arrive on — the seat could
 * wait forever. This file already said as much in two places before a0-11
 * ({@link LobbySeatView.openToJoin} is false offline; `seatSlotState` resolved an
 * open seat to a bot offline), so the rule has simply moved to where it can be
 * *seen*: the solo roster now says BOT on the rows that are bots, instead of
 * saying OPEN on rows nobody could ever take. SOLO is therefore unchanged —
 * it still opens on a full house you can RUSH immediately — and it is the online
 * room that starts empty.
 *
 * Everything downstream of the seat state is identical in both, which is the
 * property the affordance guard in `./lobby-flow.test.ts` holds us to.
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
  const online = options.online ?? true;
  const seats: LobbySeat[] = [];
  let emptyIndex = 0;
  for (let player = 0; player < count; player++) {
    const human = player === you || player === host;
    const closed = !human && player >= size;
    // OPEN online (waiting for a human, and nothing else), BOT offline (there is
    // no wire for a human to arrive on) — see this function's header.
    const occupant: SeatOccupant = human ? 'human' : closed ? 'closed' : online ? 'open' : 'bot';
    seats.push({
      player,
      occupant,
      shipClass: player === you ? shipClass : DEFAULT_SHIP_CLASS,
      // Roster order, one of each: a lobby nobody touches opens on the whole
      // seven-character cast at each character's own tier, which is what it has
      // always previewed — the default is unchanged, only its authority is (the
      // character is the stored value now, and the tier is read off it).
      // Seeded even on an OPEN seat that is flying nothing (a0-11), so the host
      // cycling it to BOT lands on a real character rather than a blank; and a
      // CLOSED seat consumes an index too, so re-opening one hands it the
      // character it would have had all along rather than a repeat of seat 1's.
      character: defaultCharacterForEmptySeat(human ? 0 : emptyIndex++),
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
    // A room opens on its roster, always — the two picker screens are somewhere
    // you go, never somewhere you land (u10-01).
    screen: 'roster',
    seats,
    shipClass,
    name,
    mapId,
    mode: options.mode ?? 'ffa',
    abundance: options.abundance ?? DEFAULT_ABUNDANCE,
    // A fresh career is level 1 (`freshProfile`), which is also what an absent
    // option means — so the badge is never blank on a first boot.
    level: normalizeLevel(options.level),
    countdown: 0,
    online,
  });
}

/** Fold a career level into range: absent, junk or below 1 is a fresh career
 *  (level 1), and a fraction is floored. The profile reader already refuses a
 *  malformed level (`progression/profile.ts` `asLevel`); this is the seam's own
 *  guard, so a lobby built by a test or a future caller cannot carry one either. */
function normalizeLevel(level: number | undefined): number {
  if (level === undefined || !Number.isFinite(level)) return 1;
  return Math.max(1, Math.floor(level));
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
 * The character an untouched empty seat starts on: **roster order, one of each**
 * (GDD §2.9). Rusty, Bolt, Foreman, Patch, Sable, Vulture, Warden — so a lobby
 * nobody touches opens on the whole seven-character cast, each at its own tier,
 * which is exactly what it previewed before the host had a character control.
 *
 * It replaces the tier-shaped default this file used to keep: the default is now
 * stated in the units the host actually edits, and the tier follows from it rather
 * than the other way round.
 */
export function defaultCharacterForEmptySeat(emptyIndex: number): PersonalityId {
  const at = Math.max(0, Math.floor(emptyIndex)) % ROSTER.length;
  return ROSTER[at] as PersonalityId;
}

/**
 * The character a *tier* resolves to in the nth empty seat.
 *
 * This used to be the lobby's whole cast rule — the host set a difficulty and
 * this picked a character to show for it. **It is no longer how a local lobby is
 * authored** (the host picks the character; see {@link cycleSeatCharacter}), and
 * it survives for one job: folding an authoritative `lobbyState` broadcast in
 * ({@link applyLobbySlots}). The wire carries a bot's *tier* and no character
 * (`../net/transport` `LobbySlot.botDifficulty`), so a remote seat the server has
 * re-tiered still has to be turned into a name, and it must be the same name the
 * server will seat — `server/room.ts` `castFor`, modulo and all, which is why the
 * repeat is reproduced rather than a nicer roster invented.
 */
export function castForEmptySeat(emptyIndex: number, difficulty: BotDifficulty): PersonalityId {
  const tier = rosterAt(difficulty as Difficulty);
  const pick = tier[emptyIndex % Math.max(1, tier.length)];
  if (pick) return pick;
  return ROSTER[emptyIndex % ROSTER.length] as PersonalityId;
}

/** The tier a seat's bot flies at — **read off its character, never stored beside
 *  it** (a0-06). This is the whole shape of the fix in one function: there is no
 *  second value that can disagree with the cast, so the class of bug the developer
 *  reported ("i chose HARD … they were at other difficulties") is not merely fixed
 *  but unrepresentable. Null on a seat with no bot in it. */
export function seatDifficulty(seat: LobbySeat): BotDifficulty | null {
  if (!isBotSeat(seat.occupant)) return null;
  return PERSONALITIES[seat.character].difficulty as BotDifficulty;
}

/**
 * Republish every seat's derived fields from its authored {@link LobbySeat.character}:
 * the previewed `personality` (null where no bot flies) and the hull that
 * character brings (style-guide §4 — the livery is a palette swap over one of the
 * four silhouettes, so the roster shows the hull it will really fly).
 *
 * It **no longer re-picks the character**. That is the change: this function used
 * to recompute the cast from each seat's difficulty on every state transition, so
 * a host's pick could not have survived even if there had been one to make. Now
 * it only projects what the host authored, which is why a repeat stays a repeat
 * and closing the seat above one does not shuffle the rest of the roster.
 *
 * Only a `bot` seat previews an AI (a0-11): a human sits in their own seat, a
 * closed seat is a shut door, and an **open** seat is an empty chair. Note that
 * a0-11's worry about which seats consume a *cast index* does not arise here —
 * this function no longer has an index to spend, because each seat carries the
 * character the host gave it rather than drawing one from a running order.
 */
function withCast(state: LobbyState): LobbyState {
  const seats = state.seats.map((seat) => {
    // A human sits in their seat; a closed seat holds nobody; an open seat is an
    // empty chair (a0-11). None of the three previews a bot. The seat KEEPS its
    // character through all of them, so a seat that empties and re-opens comes
    // back as the character the host chose for it.
    if (!isBotSeat(occupantOf(state, seat))) {
      return seat.personality === null ? seat : { ...seat, personality: null };
    }
    const personality = seat.character;
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

// ---------------------------------------------------------------------------
// The two screens the lobby's cards open (u10-01)
// ---------------------------------------------------------------------------

/**
 * Open SHIP SELECT — a press on the lobby's one ship card.
 *
 * **Nobody is refused.** A hull is every client's own choice (there is no host
 * rule on it, and never was), and even a lobby past RUSH! — where the choice is
 * locked, GDD §2.11 — may be *read*: a player who cannot change their hull can
 * still want to see what the four are. {@link classLocked} is what refuses the
 * pick; this only moves the screen, and the screen draws the refusal
 * ({@link LobbyModel.classLocked}).
 *
 * Still on the roster? Then nothing moves and the identical state comes back, the
 * stillness rule every function in this file keeps.
 */
export function openShipSelect(state: LobbyState): LobbyState {
  return state.screen === 'ship-select' ? state : { ...state, screen: 'ship-select' };
}

/**
 * Open MAP SELECT — a press on the lobby's one arena card.
 *
 * **A guest may open it, and reads it.** The arena is the host's
 * ({@link selectMap}, {@link hostControls}) and that does not change here; what
 * this screen refuses is *authoring*, not *looking*. A card that would not open at
 * all is a control that reads as broken — the same failure the lobby's own dead-vs-
 * lying-button rule exists to prevent (`./lobby-view` `drawSeatState` point 3) —
 * so the screen opens, states whose choice it is ({@link LobbyModel.canPickMap}),
 * and draws its four cards unpressable. A guest who taps one lands on
 * {@link selectMap}'s existing refusal and the screen does not move under them.
 *
 * The board a player is about to fly is information they are owed, which is the
 * same argument that put the map on the lobby in the first place (p2 field rule).
 */
export function openMapSelect(state: LobbyState): LobbyState {
  return state.screen === 'map-select' ? state : { ...state, screen: 'map-select' };
}

/**
 * BACK from either screen — return to the roster **with the pick exactly as it
 * was**.
 *
 * That is the whole contract of this function and it is kept by having nothing
 * else in it: it writes `screen` and touches no hull, no arena and no seat. A
 * "cancel" that restored some remembered value would need a second copy of the
 * pick to restore *from*, and that second copy is precisely what could disagree
 * with the first. There is nothing to cancel because a pick is applied when it is
 * made ({@link pickShipClass}, {@link pickMap}) — the same immediate-apply grammar
 * the settings screen keeps ("there is no cancel").
 */
export function closeLobbyScreen(state: LobbyState): LobbyState {
  return state.screen === 'roster' ? state : { ...state, screen: 'roster' };
}

/**
 * Pick a hull **on the SHIP SELECT screen** — the pick, and the return, as one
 * move (u10-01: *"picking returns to the lobby with the choice reflected in the
 * single card"*).
 *
 * Two things happen and they are deliberately separable: {@link selectShipClass}
 * decides the hull and keeps every refusal it has ever kept (a locked lobby is
 * still a locked lobby), and {@link closeLobbyScreen} returns to the roster. The
 * screen returns **even when the hull did not change** — pressing the card you are
 * already flying is a player saying "yes, this one", and stranding them on the
 * picker for agreeing with themselves would be a trap.
 *
 * Callers that owe the wire a message should compare against
 * {@link selectShipClass}'s own result rather than this one: a re-pick of the
 * current hull moves the screen and nothing the server cares about, and a
 * `lobbyChoice` re-sent for it would be bytes spent on nothing.
 */
export function pickShipClass(state: LobbyState, shipClass: ShipClass): LobbyState {
  return closeLobbyScreen(selectShipClass(state, shipClass));
}

/**
 * Pick an arena on the MAP SELECT screen — the twin of {@link pickShipClass}, and
 * the same two moves.
 *
 * **A guest returns to the roster too, having changed nothing.** {@link selectMap}
 * refuses them (the arena is the host's), and the screen still closes: a control
 * that swallowed the press and left the player on a screen they cannot use is
 * worse than one that plainly hands them back. What they are owed instead is
 * knowing it was never theirs *before* they pressed, which is
 * {@link LobbyModel.canPickMap}'s job on the card itself.
 */
export function pickMap(state: LobbyState, mapId: string): LobbyState {
  return closeLobbyScreen(selectMap(state, mapId));
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
  // An empty seat has no name to give — it is not in the match (a0-11) — and says
  // so, in the same word the roster row shows. Solo has no empty seat to name
  // (a0-31): `occupantOf` has already resolved it to the bot that flies it.
  const occupant = occupantOf(state, seat);
  if (occupant === 'open') return 'OPEN';
  if (occupant !== 'human') {
    // A REPEATED character is numbered, and only when repeated (a0-06;
    // `../bots` `castDisplayNames`). The cast may hold two Wardens now — a full
    // house has eight slots for seven characters — and two rows reading `Warden`
    // is a roster the host cannot check their own work against.
    return castNames(state)[slot] ?? `P${slot + 1}`;
  }
  if (seat.player === state.you) return state.name;
  return `PLAYER ${seat.player + 1}`;
}

/** The whole roster's bot names in slot order, numbered where a character repeats
 *  — one pass, so every row is numbered against the same cast.
 *
 *  Read off each seat's authored `character`, gated by the same bot predicate
 *  every other reader uses ({@link occupantOf} + {@link isBotSeat}), rather than off
 *  the projected `personality` — which is that same pair, already computed, and so
 *  a copy that a solo seat stored as OPEN could be stale in. */
function castNames(state: LobbyState): (string | null)[] {
  const cast: (PersonalityId | null)[] = [];
  for (const seat of state.seats) {
    cast[seat.player] = isBotSeat(occupantOf(state, seat)) ? seat.character : null;
  }
  return castDisplayNames(cast);
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
 * Cycle one seat's **character** — the host's tap on a roster row (a0-06;
 * developer, 2026-08-07: *"for bots we are able to select their personality
 * instead of EASY/MEDIUM/HARD"*).
 *
 * It is the same gesture, the same three refusals and the same seat predicate the
 * difficulty tap had — a guest, a human seat, and a lobby past RUSH! are all
 * no-ops, and the identity of the returned state is what the flow sounds a
 * refusal off. What changed is what it walks: {@link CHARACTER_CYCLE}, seven
 * names instead of three tiers. **Repeats are reachable and that is the point** —
 * the ring has no memory of what other seats hold, so a host can seat four
 * Wardens for the balanced 4v4 that four Hard characters could not otherwise
 * make (GDD §2.9 has three).
 *
 * The tier follows the name automatically ({@link seatDifficulty}), so there is
 * no second control left to disagree with the cast.
 */
export function cycleSeatCharacter(state: LobbyState, player: PlayerId): LobbyState {
  if (!hostControls(state)) return state;
  const seat = state.seats[player];
  // Only a bot-bearing seat has a character to cycle: a human flies their own
  // hull, a closed seat holds nobody.
  if (!seat || !isBotSeat(occupantOf(state, seat))) return state;
  const at = CHARACTER_CYCLE.indexOf(seat.character);
  const next = CHARACTER_CYCLE[(at + 1) % CHARACTER_CYCLE.length] ?? ROSTER[0]!;
  if (next === seat.character) return state;
  return withCast({
    ...state,
    seats: state.seats.map((s) => (s.player === player ? { ...s, character: next } : s)),
  });
}

/**
 * The list to send as `LobbyChoiceMessage.botDifficulties`: one entry per
 * **empty seat, in empty-seat order** — which is the order `server/room.ts`
 * indexes it in (`castFor(botIndex++)` over the seats with no socket), *not*
 * slot order. Getting this wrong would hand seat 5's difficulty to seat 2.
 *
 * **Derived from the chosen cast since a0-06.** The wire carries a tier per bot
 * seat and no character (`../net/transport` `LobbyChoiceMessage`), so this is the
 * most of the host's pick that currently fits down it: an online room seats the
 * right *tiers* and may seat different *names* within them. That gap is
 * Netcode's seam to close (a `botPersonalities` row beside this one); the offline
 * game — the flavour the report was filed against — carries the full cast through
 * {@link lobbyRosterCast} instead, and loses nothing.
 */
export function botDifficulties(state: LobbyState): readonly BotDifficulty[] {
  return state.seats
    .filter((s) => isBotSeat(occupantOf(state, s)))
    .map((s) => PERSONALITIES[s.character].difficulty as BotDifficulty);
}

// ---------------------------------------------------------------------------
// Variable matches — mode, seat state, teams, abundance (Milestone E)
// ---------------------------------------------------------------------------

/**
 * **One seat's occupancy as this lobby reads it** — the single seam a0-31's rule
 * lives behind: *in solo there is no OPEN seat, so a seat stored as one is a BOT.*
 *
 * Offline there is no wire for a joiner to arrive on, so OPEN has nothing left to
 * mean; {@link createLobby} has therefore seeded an offline seat BOT since a0-11
 * and {@link LobbySeatView.openToJoin} has been false offline for as long. What
 * this adds is that a seat which arrived at `open` some *other* way — authored
 * before the rule, restored from a store, handed in by a future caller — reads the
 * same way as one seeded here, everywhere it is read: the row, the name, the cast,
 * `N`, and the `MatchConfig` the world is built from. A returning player never
 * meets a chair that cannot be filled.
 *
 * **Derived, never duplicated.** The one input is {@link LobbyState.online} — the
 * same flag `createLobby` seeds seats from and `openToJoin` is drawn from. There is
 * no second notion of solo-ness in this file to drift from the first (u13-01,
 * g6-01), and there must not be: whatever answers "can a human still arrive here?"
 * answers "can this seat be OPEN?", because they are the same question.
 */
export function occupantOf(state: LobbyState, seat: LobbySeat): SeatOccupant {
  return seat.occupant === 'open' && !state.online ? 'bot' : seat.occupant;
}

/**
 * The ring **this** lobby's seat control walks — three rungs online
 * ({@link SEAT_STATE_CYCLE}), two in solo ({@link SOLO_SEAT_STATE_CYCLE}) — off the
 * same `online` flag {@link occupantOf} reads, for the same reason.
 */
export function seatStateCycle(state: LobbyState): readonly SeatOccupant[] {
  return state.online ? SEAT_STATE_CYCLE : SOLO_SEAT_STATE_CYCLE;
}

/**
 * Whether a seat will fly a bot. **Exactly the host-set BOT seats** (a0-11) — an
 * OPEN seat flies nothing at all now, which is the whole of the developer's
 * report. The one predicate the cast, the difficulty tap and the config builder
 * share, so there is no second place that could disagree about what a bot is.
 *
 * It takes an *occupant*, not a seat, and in a lobby that has one the occupant to
 * hand it is {@link occupantOf}'s — solo has no OPEN seat to ask about.
 */
export function isBotSeat(occupant: SeatOccupant): boolean {
  return occupant === 'bot';
}

/**
 * Whether a seat is **in the match**: a human or a bot, and nothing else
 * (a0-11; GDD §2.1 *amended 2026-08-07* — "`N` is the count of humans plus
 * bots").
 *
 * A CLOSED seat is a shut door and an OPEN one is an empty chair; neither brings
 * a ship, a station or a colour, and the only difference between them is that a
 * joiner can still sit in the open one. Every count on this screen — `N`, the
 * team tally, the side roster, the RUSH! gate — is taken through here.
 */
export function isParticipant(occupant: SeatOccupant): boolean {
  return occupant === 'human' || occupant === 'bot';
}

/** The seats that take the field — humans and bots, in slot order. `N` is its
 *  length (2..8 when the lobby can RUSH). */
export function activeSeats(state: LobbyState): readonly LobbySeat[] {
  return state.seats.filter((s) => isParticipant(occupantOf(state, s)));
}

/** `N` — the match size, the count of humans plus bots. */
export function matchSizeOf(state: LobbyState): number {
  return activeSeats(state).length;
}

/**
 * Where `slot` lands in the **dense** roster the sim builds (`configToPlayers`,
 * spike Trap 6): the count of participating seats before it, or `null` when that
 * seat is not in the match at all.
 *
 * The lobby's slot ids are sparse the moment a seat is open or closed, and the
 * sim's are never allowed to be — so a caller that has to say "which ship is
 * mine" in the sim's own numbering (the offline boot, a0-11 Part 2) asks here
 * rather than assuming the two agree.
 */
export function denseSeatIndex(state: LobbyState, slot: PlayerId): number | null {
  let dense = 0;
  for (const seat of state.seats) {
    if (seat.player === slot) return isParticipant(occupantOf(state, seat)) ? dense : null;
    if (isParticipant(occupantOf(state, seat))) dense++;
  }
  return null;
}

/** The distinct sides manned by the active seats — TEAMS needs at least two, or
 *  it is FFA wearing a costume (secondary ratified default: ≥1 player per team). */
export function activeTeams(state: LobbyState): number {
  return new Set(activeSeats(state).map((s) => s.team)).size;
}

/**
 * The slots on `player`'s **side** — the roster the end-of-match summary reads to
 * answer "did MY side take the claim?" (`./end-of-match` `MatchOutcome.allies`,
 * a0-09).
 *
 * The lobby's twin of `art/audio/scope` `deriveAlarmAllies`, which builds the
 * identical set off live world truth for the under-attack alarm. This one exists
 * because the flow-driven client (`./lobby-flow`) learns a match ended from a
 * `matchEnd` message and never holds a `World` — but it does hold the roster the
 * match was built from, and allegiance is static match config fixed at match
 * start (GDD §2.1, §4.2), so the lobby's own `team` table is the same answer.
 *
 * **FFA returns `{player}`** — teams-of-one, the `mode` gate rather than the seat
 * table, because a seat keeps its side assignment across a mode switch so that
 * flipping to TEAMS and back never loses it ({@link LobbySeat.team}). CLOSED
 * seats are skipped: a shut door takes no field and is on nobody's side. A
 * `player` with no seat is still on their own side, never on nobody's.
 */
export function sideRosterOf(state: LobbyState, player: PlayerId): ReadonlySet<PlayerId> {
  const side = new Set<PlayerId>([player]);
  if (state.mode !== 'teams') return side;
  const seat = state.seats.find((s) => s.player === player);
  if (!seat) return side;
  for (const s of state.seats) {
    // Participants only (a0-11): an empty OPEN seat is on nobody's side, exactly
    // as a shut CLOSED one is — neither has a ship for an ally to fight beside.
    if (isParticipant(occupantOf(state, s)) && s.team === seat.team) side.add(s.player);
  }
  return side;
}

/**
 * Cycle one seat's occupancy — the host's tap on a roster row: OPEN → BOT →
 * CLOSED → OPEN online ({@link SEAT_STATE_CYCLE}), and **BOT ⇄ CLOSED in solo**,
 * where OPEN does not exist ({@link SOLO_SEAT_STATE_CYCLE}, a0-31). A no-op from a
 * guest, after RUSH!, or on a HUMAN seat — you cannot cycle a seat somebody is
 * sitting in (the same three refusals {@link cycleSeatCharacter} keeps, plus the
 * human guard). Closing a seat is never blocked on the count — the developer
 * ratified "show, never block"; the floor of two is enforced at {@link canStart},
 * not here, and it still is: a solo lobby of eight closed seats is reachable and
 * refused at RUSH!, not at the tap.
 *
 * Which ring, and where the seat *starts* on it, are both {@link seatStateCycle}'s
 * and {@link occupantOf}'s answer rather than this function's — so the state the
 * control moves off is exactly the state the row draws, and a solo seat stored as
 * OPEN (which draws BOT) takes its next tap to CLOSED rather than jumping to a
 * rung the screen never showed.
 */
export function cycleSeatState(state: LobbyState, player: PlayerId): LobbyState {
  if (!hostControls(state)) return state;
  const seat = state.seats[player];
  if (!seat || seat.occupant === 'human') return state;
  // Which ring, and where on it: ONLINE walks OPEN → BOT → CLOSED, SOLO walks
  // BOT ⇄ CLOSED (a0-31 — nobody can join a solo lobby, so it has no OPEN seat
  // to offer). Both answers come off `state.online`, through the two functions
  // every reader on this screen shares, so the tap can never put the roster in a
  // state the rows would then have to draw as a chair nobody can take.
  const ring = seatStateCycle(state);
  const at = ring.indexOf(occupantOf(state, seat));
  const next = ring[(at + 1) % ring.length] ?? ring[0] ?? 'closed';
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
 *  - a host-set BOT → `bot`;
 *  - a HUMAN → `open` (a live competitive seat);
 *  - an unclaimed OPEN seat → `closed` too (a0-11): it brings no ship and no
 *    station, so the world must be built without it. The two differ in the lobby
 *    — a joiner can still take the open one — and not at all in the sim, which
 *    only ever asks "is there a player here?"
 *
 * `team` rides FFA as the slot id (teams-of-one) and TEAMS as the authored side;
 * the bot fields ride only bot-bearing slots. This is the single handoff to the
 * wire and the world — the lobby is the only place a `MatchConfig` is authored.
 */
export function lobbyMatchConfig(state: LobbyState): MatchConfig {
  const slots: SlotConfig[] = state.seats.map((seat) => {
    const slotState = seatSlotState(occupantOf(state, seat));
    const bot = slotState === 'bot';
    return {
      index: seat.player,
      state: slotState,
      shipClass: seat.shipClass,
      team: state.mode === 'ffa' ? seat.player : seat.team,
      ...(bot ? { botPersonality: seat.character } : {}),
      ...(bot ? { botDifficulty: PERSONALITIES[seat.character].difficulty as BotDifficulty } : {}),
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

/**
 * **The cast the host authored, as the world builds it** — dense, closed slots
 * dropped and the survivors re-indexed 0..N-1, exactly like {@link lobbyRosterTeams}
 * and for exactly the same reason (`configToPlayers`, spike Trap 6): entry `i` is
 * the character of the ship the sim will call player `i`.
 *
 * This is the offline handoff `MatchBootConfig.cast` consumes, and it is the seam
 * that was missing — the lobby has resolved a character per seat since it shipped
 * and showed it on the roster, and nothing ever carried it to `fillEmptySlots`
 * (`src/platform/match-boot`, a0-06). A seat with no bot in it (yours, a joiner's)
 * reads `null`, so the boot leaves that slot to the human it belongs to.
 *
 * Repeats ride through untouched: two Wardens authored is `['warden','warden']`
 * out, and the match seats two Wardens.
 */
export function lobbyRosterCast(state: LobbyState): (PersonalityId | null)[] {
  return lobbyMatchConfig(state)
    .slots.filter((slot) => slot.state !== 'closed')
    .map((slot) => (slot.botPersonality as PersonalityId | undefined) ?? null);
}

/** One seat's occupancy as the config's {@link SlotState}. An unclaimed OPEN seat
 *  resolves to `closed` (a0-11): the sim has no third answer for "nobody is here",
 *  and "nobody is here" is exactly what an open seat means now. */
function seatSlotState(occupant: SeatOccupant): SlotState {
  switch (occupant) {
    case 'closed':
    case 'open':
      return 'closed';
    case 'bot':
      return 'bot';
    case 'human':
      return 'open';
  }
}

/**
 * The per-seat states as **the wire spells them**: one entry per physical lobby
 * slot 0..7, in slot order (a0-11 — `LobbyChoiceMessage.seats`).
 *
 * The host's authoring of the roster is match shape exactly as the mode and the
 * sides are, and it rides the same low-frequency message for the same reason. A
 * `human` seat is sent as `open`: on the wire "who is *in* a seat" is the
 * **server's** answer (it owns the sockets), and this array is the host saying
 * what should happen to the seats nobody is in. Without it the room and the
 * screen disagree about the one thing §2.1's preview exists to prevent — the
 * host's BOT seats would be invisible to the server, and its OPEN seats would be
 * auto-filled behind the roster's back.
 *
 * Note this is emphatically **not** {@link seatSlotState}: there an unclaimed
 * OPEN seat resolves to `closed`, because the *sim* has no third answer for
 * "nobody is here". The room does — a joiner can still arrive — so the wire keeps
 * all three.
 */
export function lobbyWireSeats(state: LobbyState): LobbySeatState[] {
  return state.seats.map((seat) => {
    const occupant = occupantOf(state, seat);
    return occupant === 'human' ? 'open' : occupant;
  });
}

// ---------------------------------------------------------------------------
// The wire — folding an authoritative lobby snapshot in
// ---------------------------------------------------------------------------

/**
 * Apply a `lobbyState` broadcast (`src/net/transport.ts` {@link LobbySlot}).
 *
 * A bot the server has actually seated is a bot; a seat the server has marked
 * `ready` has a person in it (the room sets `ready` the moment a socket is
 * seated); and anything else takes the room's own echo of what the seat is **set
 * to** (`LobbySlot.state`, a0-11), which is what carries the host's OPEN / BOT /
 * CLOSED authoring back to every screen in the room. A person always outranks the
 * authoring — you cannot bot a seat somebody is sitting in — which is why `state`
 * is read last, and why a seat that reads `human` here falls back to `open`
 * rather than to itself when the room has no opinion.
 *
 * ---------------------------------------------------------------------------
 * WHY THE `state` FIELD, AND WHAT BREAKS WITHOUT IT
 * ---------------------------------------------------------------------------
 * `isBot`/`ready` has no third value, and until a0-11 it did not need one: every
 * socket-less seat was going to be a bot, so "open" and "bot" were the same
 * future. Now they are different futures decided by the host, and the server
 * seats no bot until RUSH! — so every `lobbyState` broadcast reads "not a bot
 * yet" for a seat the host deliberately set to BOT. Folding that in blind would
 * silently undo the host's own authoring on the next broadcast, on the host's own
 * screen. Absent (a pre-a0-11 room), the seat keeps the state it already had,
 * which preserves exactly the local-truth behaviour that shipped before.
 *
 * Your own seat keeps *your* pending hull while the lobby is still gathering:
 * the echo of a pick you made two frames ago must not flick the tile you are
 * looking at back to the hull you just left.
 */
export function applyLobbySlots(state: LobbyState, slots: readonly LobbySlot[]): LobbyState {
  // Empty-seat order, the index `server/room.ts` casts by — counted across the
  // whole roster so a re-tiered remote seat resolves to the same name the server
  // will seat rather than to one this client invented.
  let emptyIndex = 0;
  const seats = state.seats.map((seat) => {
    const wire = slots[seat.player];
    if (!wire) return seat;
    const occupant: SeatOccupant = wire.isBot
      ? 'bot'
      : wire.ready
        ? 'human'
        : (wire.state ?? (seat.occupant === 'human' ? 'open' : seat.occupant));
    const mine = seat.player === state.you && state.phase === 'gathering';
    // The wire carries a TIER and no character. A seat whose authored character
    // already flies at that tier keeps its name — which is every seat in a room
    // this client is the host of, because the tier it sent was derived from that
    // very character. Only a seat the server has genuinely re-tiered is renamed,
    // and then to the name `castFor` will actually seat.
    const bumped = isBotSeat(occupant) ? emptyIndex++ : emptyIndex;
    const character =
      isBotSeat(occupant) &&
      wire.botDifficulty !== undefined &&
      PERSONALITIES[seat.character].difficulty !== (wire.botDifficulty as Difficulty)
        ? castForEmptySeat(bumped, wire.botDifficulty)
        : seat.character;
    return {
      ...seat,
      occupant,
      shipClass: mine ? state.shipClass : wire.shipClass,
      character,
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
 * Why RUSH! is refused right now, in the words the screen shows — or `null` when
 * it is not (a0-11; GDD §2.1 *amended 2026-08-07*: "RUSH! is refused, with a
 * reason, below two participants").
 *
 * The reason is the a0-11 half. Before it, an empty seat was never a cause to
 * wait, because it became a bot; now a room can genuinely be one person in eight
 * empty chairs, and a RUSH! button that simply refused would be a dead control
 * with no account of itself. Two things gate the start (the second is
 * variable-slots Milestone E's, unchanged):
 *
 *  - **At least two participants** — humans plus bots ({@link matchSizeOf},
 *    {@link MIN_MATCH_SIZE}, the sim's `< 2` win guard). The reason names the way
 *    out, and there are two of them, which is why it is one sentence rather than
 *    a code: wait for somebody, or seat a bot yourself.
 *  - **In TEAMS, at least two sides.** One team is FFA in a costume (the secondary
 *    ratified default: ≥1 player per team). Any *split* is allowed — 3v1 is fine,
 *    counts are shown never blocked — but not a single team.
 *
 * A guest gets no reason at all: RUSH! is not theirs to press and "waiting for the
 * host" is the view's own line, not a refusal of something they attempted.
 */
export function startRefusal(state: LobbyState): string | null {
  if (!hostControls(state)) return null;
  if (matchSizeOf(state) < MIN_MATCH_SIZE) return NEEDS_TWO;
  if (state.mode === 'teams' && activeTeams(state) < 2) return NEEDS_TWO_SIDES;
  return null;
}

/**
 * Refusal copy. Here rather than in a draw call for the reason every other string
 * on this screen is (the copy sweep reads the models, GDD §4.7 register 2), and in
 * the interface voice: it states the situation, then the way out.
 *
 * Short on purpose. It is drawn in the footer beam's one hint strip beside RUSH!
 * (`./lobby-view` `hintText`), which the narrowest phone spends entirely on the
 * two plates — a line that does not fit is a line that is not drawn, and a refusal
 * nobody reads is the dead button it was written to replace.
 */
export const NEEDS_TWO = 'NEEDS 2 — ADD A BOT OR WAIT';
export const NEEDS_TWO_SIDES = 'NEEDS 2 SIDES';

/**
 * Whether RUSH! can be pressed right now: the host, still gathering, with a legal
 * match to start — exactly {@link startRefusal} having nothing to say. One
 * predicate behind both, so the button's *look* and the button's *reason* can
 * never disagree about whether it is live.
 */
export function canStart(state: LobbyState): boolean {
  return hostControls(state) && startRefusal(state) === null;
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
  /**
   * **`LVL 7` on YOUR row, and `null` on every other one** (pr-06; plan §Q2,
   * ratified 2026-08-07: *"we can show the LEVEL but not XP (and show it only in
   * the lobby)"*).
   *
   * The badge is the whole of the developer's ruling in one field, and the
   * `null` is the more load-bearing half:
   *
   *  - **A bot has no career** — there is no profile behind a personality, and
   *    inventing a level for one would be printing a number nothing produced.
   *  - **A remote human's level is a claim, not a fact.** m9 has no accounts
   *    (plan §2.2), so a level arriving from another client is a number that
   *    client authored; it is not read, not requested and not rendered, and there
   *    is no field on the wire carrying one (`../net/transport` `LobbySlot`).
   *  - **An OPEN or CLOSED seat has nobody in it** to have a career at all.
   *
   * Because the badge lives on this screen and this screen is **gone before
   * RUSH!**, a level can never be read as live information about an opponent —
   * which is precisely the fog GDD §2.2 exists to keep. The absence is asserted
   * in `./level-badge.test.ts` rather than left implicit, because an absence
   * nobody tests for is an absence that comes back.
   *
   * It is a **level**, formatted, and never an XP total: raw XP is private to its
   * owner always, including from its owner's own lobby row.
   */
  readonly levelBadge: string | null;
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
  /** Which of the room's three screens is up (u10-01). The roster draws when this
   *  is `roster`; the two pickers are their own views (`./ship-select-view`,
   *  `./map-select-view`) and draw from their own models. */
  readonly screen: LobbyScreen;
  readonly room: RoomCode;
  readonly seats: readonly LobbySeatView[];
  /**
   * **The one hull card the roster draws** — the hull this client has chosen, and
   * no other (u10-01, the developer: *"we should only show 1 ship and 1 map in
   * lobby"*). The other three moved to SHIP SELECT, where there is room to compare
   * them.
   *
   * It is a whole {@link ShipClassOption}, stats and all, because the ratified u4
   * rule is unchanged: ship stats appear here, **as pips AND numbers**. What
   * changed is how many hulls' worth of them share the screen. One card in the
   * column four used to fight over has more room for the grid than any of the four
   * ever did.
   */
  readonly shipCard: ShipClassOption;
  /** …and **the one arena card**: the map this room is flying, drawn by the same
   *  {@link ./map-picker} constructor MAP SELECT draws its four with, so the
   *  summary and the screen it was picked on are literally the same picture. */
  readonly mapCard: MapCardModel;
  /** Whether the arena is THIS client's to change — the host, before RUSH!
   *  ({@link hostControls}). The card draws dead rather than live-then-refusing
   *  when it is false, which is the rule the whole screen keeps. */
  readonly canPickMap: boolean;
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
  /** …and, when it cannot, WHY, in the words the screen shows — or null
   *  ({@link startRefusal}, a0-11). A refused button that says nothing is a dead
   *  control; this is the sentence under it. */
  readonly startRefusal: string | null;
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
  // The bot names, numbered against the WHOLE cast in one pass (a0-06), so two
  // Wardens read `Warden 1` / `Warden 2` on the roster the host is checking and a
  // lone Warden still reads `Warden`.
  const names = castNames(state);
  const seats = state.seats.map((seat) => seatView(state, seat, viewer, canEdit, names[seat.player] ?? null));
  // Counts are of the PARTICIPANTS only — humans plus bots (a0-11; GDD §2.1
  // amended). A closed seat is a shut door and an open one is an empty chair;
  // neither is a player, so neither reaches the RUSH hint or the team tally.
  const active = seats.filter((s) => isParticipant(s.state));
  const humanCount = active.filter((s) => !s.isBot).length;
  const botCount = active.filter((s) => s.isBot).length;
  return {
    phase: state.phase,
    screen: state.screen,
    room: state.room,
    seats,
    // ONE card each (u10-01). The hull is resolved through `CLASS_OPTIONS` rather
    // than rebuilt, so the card on the roster and the tile on SHIP SELECT are the
    // same object; a hull id outside the four folds to the default rather than
    // leaving the roster with a hole where a card should be.
    shipCard: shipCardFor(state.shipClass),
    mapCard: mapCardModel(state.mapId),
    canPickMap: hostControls(state),
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
    startRefusal: startRefusal(state),
    hostControls: state.you === state.host,
    humanCount,
    botCount,
    online: state.online,
  };
}

/**
 * The {@link ShipClassOption} for a hull — the lobby's one card, and SHIP SELECT's
 * four, read out of the one ratified table ({@link CLASS_OPTIONS}).
 *
 * A hull the table does not hold folds to {@link DEFAULT_SHIP_CLASS}'s card rather
 * than to `undefined`: the roster has exactly one ship card since u10-01, so "no
 * card" is a hole in the screen where the pick should be, and a Vanguard card is a
 * truthful answer for a state that can only arise from a corrupt store.
 */
export function shipCardFor(shipClass: ShipClass): ShipClassOption {
  return (
    CLASS_OPTIONS.find((option) => option.shipClass === shipClass) ??
    CLASS_OPTIONS.find((option) => option.shipClass === DEFAULT_SHIP_CLASS) ??
    CLASS_OPTIONS[0]!
  );
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
  castName: string | null,
): LobbySeatView {
  // The seat as this lobby reads it (a0-31): solo has no OPEN seat, so a seat
  // stored as one is drawn — and counted, and launched — as the bot it is. Every
  // field below is off this one word, so the row cannot say one thing and the
  // match contain another.
  const occupant = occupantOf(state, seat);
  const isBot = isBotSeat(occupant);
  const isClosed = occupant === 'closed';
  // An OPEN seat now names nobody, because nobody is in it and nobody is booked
  // to be (a0-11). It reads as the invitation it is — the row a joiner takes —
  // rather than previewing a character the match will not contain. A BOT row
  // takes its NUMBERED name (a0-06), so two Wardens are tellable apart here.
  const name = isClosed
    ? 'CLOSED'
    : occupant === 'open'
      ? 'OPEN'
      : isBot
        ? (castName ?? 'BOT')
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
    isHost: seat.player === state.host && occupant === 'human',
    state: occupant,
    stateLabel: SEAT_STATE_LABELS[occupant],
    // The control's live/dead look, from the mutation's own three refusals: the
    // host, before RUSH! (both folded into `canEdit`), and never a human seat.
    canCycleState: canEdit && occupant !== 'human',
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
    openToJoin: occupant === 'open' && state.phase !== 'started' && state.online,
    // No number on a row nobody is dialing in from: a bot is inside the sim, and
    // an empty or shut seat has no connection to time. Stated as "anything that is
    // not a human in a chair" so the three cases cannot drift apart.
    ping: seatPing({ isBot: occupant !== 'human', rtt: seat.rtt }),
    // The level badge, on the ONE row that has a career behind it: the seat the
    // local player is actually sitting in. Stated as "a human, and it is you" so
    // the three ways it could leak are closed by one condition — a bot has no
    // profile, a remote human's level is a number their client authored (plan
    // §2.2), and an empty or shut seat has nobody in it. It reads off
    // `state.you` rather than a slot captured when the lobby was built, so the
    // badge follows you when the server seats you somewhere else
    // ({@link seatLocalPlayer}) instead of staying behind on a stranger's row.
    levelBadge:
      occupant === 'human' && seat.player === state.you ? levelBadgeLabel(state.level) : null,
    // Shown, not chosen (a0-06): the row's tier chip is read off the character
    // the host picked, so the row cannot advertise a tier the cast disagrees with.
    ...(isBot ? { botDifficulty: PERSONALITIES[seat.character].difficulty as BotDifficulty } : {}),
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

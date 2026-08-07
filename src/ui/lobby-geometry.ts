/**
 * src/ui/lobby-geometry.ts — where the lobby's boxes are. OWNER: UI Engineer.
 *
 * Pure, PixiJS-free and unit-tested, for the same reason `./hud-geometry` is:
 * the lobby is the one screen a player meets *before* anything else, it is
 * device-shaped (a thumb on a 320px phone, a mouse on a 1920px desktop), and it
 * is not on screen during the frozen golden scene QA's live layout contract
 * measures. Keeping the rects here means every device profile — portrait and
 * landscape, notch and no notch — is asserted headless (`./lobby-geometry.test.ts`)
 * instead of trusted until someone opens a lobby on a phone.
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * convention the layout registry, the touch layer and the camera all speak.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-03, ratified 2026-08-05; spec `docs/design/gantry-bone-handoff.html`)
 * ---------------------------------------------------------------------------
 * The lobby is framed like every other screen in the set: a **header beam**
 * carrying the screen's name and the room code, a **footer beam** carrying
 * BACK, the RUSH! hint and RUSH! itself, and one **content band** between them.
 * That frame is {@link ./gantry} `gantryFrame` — the same call the title and
 * settings screens make — so the beams, the margins and the gutters are the
 * handoff's own numbers on a desktop and their derived counterparts on a phone
 * (`../art/materials` §3b/§3c), never a second hand-picked set.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE, AND WHAT DECIDES IT
 * ---------------------------------------------------------------------------
 * Inside the band, two things flex:
 *
 *  - **Columns** ({@link TWO_COLUMN_MIN_WIDTH}): wide enough, and the roster
 *    takes the left column and **ship select takes the right one, bounded by the
 *    band itself** — the handoff's rule, so nothing crowds the separator between
 *    them. The four arena cards ride the bottom of the *right* column rather
 *    than cutting across both, which is what leaves the roster the full height of
 *    the band and is what makes the thumb floor below reachable at all.
 *    Narrow, and the three blocks stack: roster, tiles, arena row.
 *  - **Tile arrangement** ({@link TileShape}): four stacked, a 2×2, or one row
 *    of four — whichever keeps a tile tall *and* wide enough to carry its name,
 *    its hull and its **stat grid** (u4, 2026-08-05 — pips AND numbers; GDD
 *    §2.5 / §2.11 amended). What a tile can hold at a given size, and in what
 *    order it gives things up, is {@link classTileContent}.
 *
 * Both are decided by the **band's dimensions**, never by `isTouch`: a tablet in
 * landscape gets the same reading as a desktop of the same width, and a desktop
 * window dragged narrow gets the phone one.
 *
 * ---------------------------------------------------------------------------
 * `isTouch` NO LONGER PICKS A SIZE (u7-03)
 * ---------------------------------------------------------------------------
 * It used to choose between a desktop row height and a taller "touch" one, on
 * every block. It does not any more, for the reason `./main-menu` states: **the
 * thumb floor is a property of the viewport, not of the input device** — a
 * viewport cannot tell you whether the screen in front of it is a touchscreen,
 * and a 44px row that a mouse can hit is still a 44px row under a thumb. So
 * every control on this screen is sized by `../art/materials` and floored at
 * `TOUCH_MIN` on *every* platform. The flag is kept because the caller and the
 * seam both still carry it, and because a screen may yet want it.
 *
 * ---------------------------------------------------------------------------
 * LANDSCAPE IS THE CASE THAT MATTERS, AND 48px IS THE BAR
 * ---------------------------------------------------------------------------
 * Planet Rush is a landscape game — a phone held in portrait gets the ROTATE
 * overlay (`src/platform/orientation.ts`) — so **a phone on its side is the
 * primary mobile layout of this screen**, not a degenerate one. That handset is
 * short and wide (a 844×390 device with its notch insets leaves a 704×247 band),
 * and this screen carries more per row than anything else in the game: an
 * identity bar, a P-number, a name, a slot-state control, a side chip, a
 * difficulty chip and a ping.
 *
 * The bar this brief sets is that **every control on a roster row clears the
 * 48px thumb floor** on the orientation the screen is used in. Three decisions
 * are what buy it, and each is a number this file changed on purpose:
 *
 *  1. the arena row moved into the right column, so the roster gets the WHOLE
 *     band rather than the band minus a full-width card row;
 *  2. roster rows **abut** ({@link ../art/materials} `ROSTER.gap` = 0) — a roster
 *     is a list, and the handoff draws lists as adjacent surfaces with a rule
 *     between, not as floating cards;
 *  3. a row's segments — the state control, the side chip, the difficulty chip —
 *     span the row's **full height** instead of sitting inset inside it, so a
 *     48px row is made of 48px controls rather than 42px ones.
 *
 * On the two landscape phone profiles, notched and not, that lands every row at
 * 48–52px. `./lobby-geometry.test.ts` asserts it rather than hoping.
 *
 * Where something still has to give — the smallest PORTRAIT phones, which are
 * behind the ROTATE overlay anyway — the roster compresses and the tiles do not:
 * the roster is a list to *read*, while the tiles and RUSH! are the two choices
 * every player makes with a thumb. The view then drops a row's detail line, and
 * a tile gives up its blurb (and, below that, its hull nickname) by the ladder in
 * {@link classTileContent} — **never its stats** at any size the layout will
 * actually produce — rather than clipping anything.
 *
 * Nothing is ever laid out outside {@link LobbyLayout.content}, which is itself
 * the viewport inset by the safe area — so a notch, a home indicator or a
 * rounded corner can never eat the room code (GDD §4.3 mobile gate).
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import { COLUMN, ROSTER, TOUCH_MIN, plateHeight, rosterRowHeight, valueChipHeight } from '../art/materials';
import type { FrameMetrics, PlateScale } from '../art/materials';
import { beamContent, beamPlate, gantryFrame, stackPlates } from './gantry';

// ---------------------------------------------------------------------------
// Safe area
// ---------------------------------------------------------------------------

/** Safe-area insets, CSS px — the `env(safe-area-inset-*)` four, as the page
 *  shell already applies them (index.html). All optional; missing is zero. */
export interface Insets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** Layout inputs beyond the viewport. */
export interface LobbyLayoutOptions {
  /** Touch device: thumb-scale rows, tiles and button. Default false. */
  readonly isTouch?: boolean;
  /** Safe-area insets to keep clear. Default none. */
  readonly insets?: Insets;
}

// ---------------------------------------------------------------------------
// Tuning — every number the lobby's shape is made of
// ---------------------------------------------------------------------------

/** Roster rows — the eight seats of a match (`./lobby` LOBBY_SLOTS, asserted
 *  equal in the tests). Mirrored rather than imported so the geometry stays
 *  free of the model and its dependencies. */
export const LOBBY_SLOT_ROWS = 8;

/** The uniform page margin the pre-Gantry screens were laid out to, kept as the
 *  published number the rest of the UI matches against (`./menu-geometry`).
 *
 *  **Nothing in this file lays out to it any more.** Both screens here are now
 *  framed by `./gantry` `gantryFrame`, whose margin is the handoff's 44 scaled
 *  to the viewport: the lobby took it in u7-03 and the doors and the keypad
 *  ({@link entryLayout}) took it in u7-04, from two branches that each still saw
 *  the other's screen on the old helper. Merging them left that helper with no
 *  callers at all, so it is gone and this constant is the last of it. */
export const LOBBY_PAD = 16;
/** Gap between the lobby's stacked blocks in the one-column shape, and between
 *  the entry screen's. */
export const BLOCK_GAP = 12;
/** Gap between two hull tiles, and between two arena cards. Roster rows use
 *  `../art/materials` `ROSTER.gap` instead, which is zero (see the header). */
export const ROW_GAP = 6;

/** Entry-screen title band. The lobby's own heading lives in the header beam. */
export const TITLE_HEIGHT = 52;
/** Room-code cluster width at the handoff's reference — `ROOM` over the code,
 *  right-aligned in the header beam. Scaled by the frame like every other
 *  reference metric in this file. */
export const ROOM_CODE_WIDTH = 132;
/** BACK plate width at the reference — the lobby's exit to the main menu (u2
 *  menu-back), now the left-hand plate in the FOOTER beam, which is where this
 *  set puts a screen's secondary action (settings' DONE is its twin). */
export const LOBBY_BACK_WIDTH = 120;

/**
 * The narrowest roster ROW that still carries every control a row must carry.
 *
 * Derived, not chosen, from the two guarantees below it — and
 * `./lobby-geometry.test.ts` re-derives it rather than restating it, so widening
 * a chip moves this number instead of quietly breaking a row:
 *
 *  - the **difficulty chip** keeps its full width, which
 *    {@link SEAT_CHIP_MAX_FRACTION} grants at `W ≥ (54 + 2) / 0.4` = 140;
 *  - the **state control** stays above {@link SEAT_STATE_MIN}, which
 *    {@link SEAT_STATE_MAX_FRACTION} grants at `W ≥ 30 / 0.2` = 150;
 *  - the **side chip** stays above {@link SEAT_TEAM_CHIP_MIN}, which — once the
 *    bar, the state control, the guaranteed body and the difficulty chip have
 *    taken theirs — needs `0.8·W − 116 ≥ 36`, so `W ≥ 190`.
 *
 * The side chip binds, which is the point: a *missing* control is a control the
 * player cannot find, and this screen exists because one of them was.
 */
export const SEAT_ROW_MIN_WIDTH = 190;

/**
 * The narrowest roster column that may be halved into two columns of four —
 * two minimum rows and the gap between them.
 *
 * The old 360 encoded a different question: "is a halved row still legible?"
 * Since u7-03 the split exists to keep every row above the **thumb floor**
 * ({@link placeSeats}), so the question is "does a halved row still carry its
 * controls?", and the answer is {@link SEAT_ROW_MIN_WIDTH} twice. That is what
 * keeps the iPhone SE in landscape — the tightest real device this screen runs
 * on — in ONE column: its 369px roster halves into 180px rows, which is under
 * the width a row needs to carry a side chip at all, and a roster that loses a
 * control to gain a thumb has traded the wrong way round. It reads its eight
 * rows at 25px instead, with every control on them present and legible.
 */
export const TWO_ROSTER_MIN_WIDTH = 2 * SEAT_ROW_MIN_WIDTH + 20;

/** Hull tile heights. 64 is the height that carries a tile's whole IDENTITY
 *  block — its name, its hull, and the 3×2 grid of stat pips-and-numbers (u4,
 *  {@link classTileContent}; the constants below are asserted to add up to it).
 *  It is defended by changing the tiles' *arrangement* before their height (see
 *  {@link TileShape}). Above it the tile also carries its role blurb. */
export const CLASS_TILE_MIN = 64;
export const CLASS_TILE_MAX = 108;
/** The floor a tile keeps even when the band cannot spare the full blurb height:
 *  a thumb target (GDD §2.4). The view drops the blurb below {@link CLASS_TILE_MIN}
 *  and shows just the name + hull, so a compact tile is still a legible, tappable
 *  choice. This is the concession the lobby makes on the smallest LANDSCAPE phone
 *  once the map row (below) joins the roster and the tiles in one short band — the
 *  file header's rule: the tiles and the arena are both thumb *choices*, so they
 *  compress to a floor rather than vanishing, while the roster (a list) compresses
 *  freely. */
export const CLASS_TILE_COMPACT = 44;
/** Narrower than this a tile cannot carry a name over a wrapped blurb, so an
 *  arrangement that would produce one is rejected in favour of a taller shape. */
export const CLASS_TILE_MIN_WIDTH = 150;

// ---------------------------------------------------------------------------
// Inside a hull tile — the identity block, and the stat grid (u4, 2026-08-05:
// "both pips and numbers"). The tile is no longer a name over a blurb: it now
// carries six stats, each as a coarse pip bar over its actual figure, read off
// the sim's own class table (`./lobby` shipStatLines).
//
// Six of those on a 390-wide phone is the hard case this block is dimensioned
// for, so the tile has a stated PRIORITY LADDER and {@link classTileContent} is
// the one place it lives — the view draws whatever the ladder returns and
// decides nothing:
//
//   1. the class NAME       — a tile with no name is not a choice
//   2. the STAT GRID        — the reason this brief exists; the thing a player
//                             is comparing four tiles for
//   3. the HULL nickname    — the silhouette's name (Quadfin…), flavour the
//                             codex also carries
//   4. the role BLURB       — the sentence, which already dropped below 64px
//                             before this brief and still does
//
// One deliberate exception to rung 2, and it is a fallback rather than a hole:
// where a tile is below the stat grid's OWN floor — too short for two rows, or
// too narrow for three legible cells — the tile degrades to the pre-u4 card
// (name over hull) rather than to a bare name. Nothing the layout actually
// produces on any profile in QA's matrix lands there (asserted), and a tile that
// small would have shown a clipped grid, which is the thing this ladder exists
// to prevent.
//
// Each rung is dropped whole rather than clipped — a half-sentence and a
// half-visible stat row both read worse than none — and the ladder is asserted
// against the real QA device matrix in `./lobby-geometry.test.ts`, portrait and
// landscape, so "legible at phone scale" is a test rather than a hope.
// ---------------------------------------------------------------------------

/** Inset from a tile's edge to its content. Tight, because six stat cells and
 *  four words share a 152×56 tile on a phone in landscape — the primary mobile
 *  layout of this screen. */
export const CLASS_TILE_PAD = 3;
/** The class-name line. Audiowide 12's MEASURED box (ascent + descent) on the
 *  self-hosted face, not a guess — the first cut of this block guessed the line
 *  heights and every tile drew its stats through its hull nickname. */
export const CLASS_NAME_LINE = 14;
/** The hull-nickname line (Oxanium 9, measured box 12). */
export const CLASS_HULL_LINE = 12;
/** The role blurb — two wrapped Oxanium-10 lines. */
export const CLASS_BLURB_LINE = 22;

/** Stats on a tile — GDD §2.11's six table columns (`./lobby` STAT_SPECS,
 *  asserted equal in the tests). Mirrored rather than imported so the geometry
 *  stays free of the model, exactly like {@link LOBBY_SLOT_ROWS}. */
export const STAT_COUNT = 6;
/** One stat cell: its figure on a text line (Oxanium 8, measured box 10), its
 *  pip bar directly beneath. */
export const STAT_ROW_TEXT = 10;
export const STAT_PIP_BAR = 3;
export const STAT_ROW_HEIGHT = STAT_ROW_TEXT + STAT_PIP_BAR;
/** Air between two rows of the stat grid. */
export const STAT_ROW_GAP = 2;
/** Air between two columns of it. */
export const STAT_CELL_GAP = 4;
/** Air above and below the whole stat block, when the tile has height to spare.
 *  **Elastic**: a roomy desktop tile takes all of it so the block reads as its
 *  own thing rather than a third line of prose, and the tightest phone tile takes
 *  none — the stats themselves never pay for the spacing. */
export const STAT_BLOCK_AIR = 5;
/** A cell wide enough to lay all six across in ONE row — `SPD 130%` over five
 *  pips with room to spare. The wide-tile (desktop `stack`) shape, which reads
 *  like GDD §2.11's own table row. */
export const STAT_CELL_WIDE = 42;
/** The narrowest a cell may get before the grid is dropped rather than drawn
 *  with figures running into each other. Three columns of this fit inside every
 *  tile the layout is willing to produce, which is why 3 is the floor
 *  arrangement and there is no 2-column shape. */
export const STAT_CELL_FLOOR = 36;

/** Height of a stat grid of `rows` rows. */
export function statGridHeight(rows: number): number {
  const n = Math.max(0, Math.floor(rows));
  return n === 0 ? 0 : n * STAT_ROW_HEIGHT + (n - 1) * STAT_ROW_GAP;
}

// ---------------------------------------------------------------------------
// The arena (map) row — the four map cards, moved off the PLAY flow into the
// lobby (p2 field rule: one pre-match room where you pick your HULL and your
// ARENA, then RUSH!). A row of four registry-preview cards along the bottom of
// the middle band, above RUSH! — a thumb choice, so it keeps a floor height and
// compresses the roster (a list) rather than itself.
// ---------------------------------------------------------------------------

/** Map cards in the row — the four ratified maps (`../sim/maps` MAPS, and
 *  `./map-picker` MAP_ORDER, asserted equal in the tests). Mirrored rather than
 *  imported so the geometry stays free of the model, exactly like
 *  {@link LOBBY_SLOT_ROWS}. */
export const LOBBY_MAP_COUNT = 4;
/** Map card height ceiling — cards are capped here (a tall desktop/portrait band
 *  does not blow the cards up into banners) and compress below it on a short
 *  landscape band. */
export const LOBBY_MAP_ROW_MAX = 108;
/** The height the map band aims to keep so a card can show its preview over its
 *  name — the row's equivalent of the tile's blurb height. Defended down to what
 *  the middle band can actually spare on the tightest landscape phone. */
export const LOBBY_MAP_ROW_MIN = 52;
/** Share of the middle band the arena row takes off the bottom before the roster
 *  and the hull tiles divide the rest. */
export const LOBBY_MAP_BAND_FRACTION = 0.26;
/**
 * Below this per-card width a row of four folds to a 2×2.
 *
 * **48 since u7-03, down from 60: the thumb floor, not a taste.** The arena row
 * now rides the bottom of the ship-select column rather than the full width of
 * the band, so a 2×2 there is *half as tall* as the row it replaces — on the
 * iPhone SE in landscape the fold turned four 57×65 cards into eight… four 119×29
 * ones, which is a card no thumb can hit. A slim card reads fine (a preview over a
 * name); a short one does not, so the row of four is what is defended.
 */
export const LOBBY_MAP_MIN_WIDTH = 48;
/** Cards don't sprawl on a wide desktop. */
export const LOBBY_MAP_CARD_MAX_WIDTH = 240;

// ---------------------------------------------------------------------------
// The control strip — MODE toggle + ABUNDANCE (variable-slots Milestone E). Two
// toggles carved off the TOP of the roster box, never a band of their own: the
// roster is a list to read and it is what compresses (the file header's rule), so
// the hull tiles and the arena cards keep their thumb floors on the tightest
// phone. The per-seat OPEN/BOT/CLOSED cycle is a LABELLED control at the row's
// LEADING edge since u5 (below); the per-row TEAM / difficulty control is a chip
// at the row's right edge (below).
// ---------------------------------------------------------------------------

/** Widest a single toggle grows — the two split the roster width, capped so they
 *  read as controls, not banners, on a wide desktop roster column. */
export const CONTROL_MAX_WIDTH = 200;

/**
 * Width of the identity BAR down a roster row's leading edge.
 *
 * This is the handoff's own row bar (`../art/materials` `ROW_BAR_WIDTH`), and
 * since u7-03 it is one of exactly **two** places a slot's identity colour is
 * allowed to land on this screen — the bar and the P-number — because *"identity
 * colours live on the row bar and P-number only, never as a background wash; that
 * was making identity read as chrome"*. The filled identity chip the row used to
 * carry behind its decal is gone with that rule; the decal itself is unchanged
 * and is still the colour-blind-safe source of truth (style-guide §3 rule 3).
 *
 * It lives here rather than in the view since u5, because the row's leading edge
 * stopped being decoration the drawing code could place on its own: the STATE
 * control is laid out immediately right of the bar, so the two are one piece of
 * geometry and the view reads both from this file.
 */
export const SEAT_STRIPE = ROSTER.bar;

/**
 * Width of a roster row's LEADING STATE control — the OPEN / BOT / CLOSED cycle,
 * finally drawn and finally named (u5, 2026-08-05).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The cycle itself is old ({@link LobbyTarget} `seat`, `./lobby` `cycleSeatState`)
 * and it worked from the day it shipped — on a plain tap of the row BODY, with
 * nothing drawn to say the row was tappable and nothing naming the three states
 * it walks. The developer's report is the whole case: *"theres no way visible way
 * to know that you can close slots right now."* The screen advertised its two
 * lesser controls — the DIFFICULTY chip and the TEAM chip, both drawn chips with
 * backgrounds — and hid the one that decides whether a slot is a human, a bot, or
 * shut. A control that works but cannot be discovered is not shipped (the same
 * class as the M1 miss that created the mobile suite: `playwright.config.ts`,
 * "caught invisible touch UI").
 *
 * So the state is an **explicit, labelled, leading** control that states the
 * CURRENT state and reads as pressable — deliberately the shape the UI design
 * handoff independently proposed (slot state as `OPEN` / `CLOSED` buttons on the
 * far left of each row). That direction is not ratified as a whole and this is
 * NOT that lobby; it is built leading-and-labelled so that if the design lands it
 * is a re-skin rather than a rewrite.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MAY NOT COST
 * ---------------------------------------------------------------------------
 * A leading control is the first thing on this screen to take width off the
 * *front* of a row, and the row already had two guarantees carved off its back
 * ({@link SEAT_CHIP_WIDTH}, {@link SEAT_TEAM_CHIP_WIDTH}) plus the body zone
 * between them ({@link SEAT_TEAM_CHIP_MIN_BODY}). Neither may move, so the state
 * control is bounded three ways and takes whichever is smallest — its own width,
 * a share of a narrow row, and whatever is left once the body keeps
 * {@link SEAT_ROW_BODY_MIN}. The order across a row is therefore fixed at every
 * width: `bar | STATE | body | team chip | difficulty chip`.
 *
 * ---------------------------------------------------------------------------
 * u7-03 — THE RE-SKIN, AND WHAT IT DID NOT MOVE
 * ---------------------------------------------------------------------------
 * The ratified handoff landed, and it puts exactly this control in exactly this
 * place (*"slots are `OPEN` / `CLOSED` buttons on the far left of each row"*), so
 * it is the re-skin u5 was built to be rather than a rewrite: the cycle, the
 * host-only refusals and the hit-test registration are untouched, and only the
 * material and the sizes changed. The width is the handoff's own button
 * (`../art/materials` `ROSTER.stateWidth`, 72 at the reference) scaled by the
 * frame, and the control now spans the row's FULL height rather than sitting
 * inset in it — which is what puts a 48px row's leading control at 48px instead
 * of at 42.
 */
export const SEAT_STATE_WIDTH = ROSTER.stateWidth;
/**
 * …never more than this share of a narrow row.
 *
 * **0.24 since u7-03, down from 0.28.** The control used to be bounded by
 * {@link SEAT_TEAM_CHIP_MIN_BODY}'s fraction as well, which over-reserved on a
 * narrow row; it is bounded by an absolute body rule now ({@link seatBodyEnd}),
 * so every pixel this fraction grants comes straight off the side chip's word.
 * At 0.20 the notched landscape phone's 205px row holds `FRIENDLY A` at full
 * size; at 0.28 it did not, and at 0.24 the name beside it had nowhere to go.
 *
 * It also sets where the control is dropped whole: {@link SEAT_STATE_MIN} ÷ this
 * is {@link SEAT_ROW_MIN_WIDTH}, so the narrowest row the roster will ever split
 * into is exactly the narrowest row that still carries this control.
 */
export const SEAT_STATE_MAX_FRACTION = 0.2;
/**
 * …and below this the control is dropped whole rather than drawn as a stub too
 * small to carry a word (the ladder `classTileContent` keeps for a hull tile: a
 * clipped affordance reads worse than none). No row the layout produces on any
 * profile in QA's matrix lands here — asserted in `./lobby-geometry.test.ts` —
 * and a row that did would fall back to the pre-u5 behaviour, where the row body
 * is still the cycle.
 */
export const SEAT_STATE_MIN = 30;
/**
 * The row BODY the trailing chips must leave clear — and since u7-03 it is what
 * the row's **content** needs, not merely what a finger needs.
 *
 * ---------------------------------------------------------------------------
 * 16 → 64, AND WHY THE NUMBER GREW BY FOUR TIMES
 * ---------------------------------------------------------------------------
 * 16 was a *tap* minimum: it existed so the state control could never close the
 * strip of row that also cycles the seat state. That was the whole job while the
 * body held nothing — and the body holds the P-number and the player's name.
 *
 * On a 233px landscape-phone row the old number let the side chip start 16px
 * after the state control, which is 20px before the name even began: every name
 * on the roster was drawn straight through `FRIENDLY A` (u7-03's first phone
 * render). 56 is the P-number, its two paddings and a name — measured, not
 * guessed — so the chips can never start before the row's own content ends.
 *
 * It does not come free, and this is the honest accounting: a 233px row has ~130
 * px to divide between a name and a side chip that want ~54 and ~88. What the
 * row gives up is the side chip's *single line* — the chip stacks `FRIENDLY`
 * over `A` instead ({@link ../ui/lobby-view} `drawTeamChip`), which is the same
 * `WORD + LETTER` grammar GDD §2.1 ratified, at full type size, in half the
 * width. Every row at or above {@link SEAT_ROW_FULL_WIDTH} keeps it on one line.
 */
export const SEAT_ROW_BODY_MIN = 56;


/** Width of a roster row's trailing DIFFICULTY chip — the bot-tier cycle
 *  (EASY/MEDIUM/HARD). Carved off the RIGHT of the row in BOTH modes: it is the
 *  one slot-editor control every mode shares, so a bot's tier is reachable in FFA
 *  and TEAMS alike (n2 — the TEAMS lobby had lost it). A tap on the row's body
 *  still cycles the seat state; only the chip cycles the tier. */
export const SEAT_CHIP_WIDTH = ROSTER.trailingWidth;
/** The chip never eats more than this share of a (narrow) row, so the state-cycle
 *  body — and the row's centre, which the hit-test contract taps — stays clear. */
export const SEAT_CHIP_MAX_FRACTION = 0.4;
/**
 * Inset of a row's segments from the row's LEFT/RIGHT edges.
 *
 * **Zero on the vertical axis since u7-03**, which is why this is now only a
 * horizontal number: the state control, the side chip and the difficulty chip
 * span the row's full height. A 48px row inset by 3 top and bottom is a 42px
 * control, and 42px is under the thumb floor on the one screen in the game that
 * cannot afford to be — so the segments became segments of the row rather than
 * chips floating in it, which is also the handoff's own read of a machined strip.
 */
export const SEAT_CHIP_PAD = 2;

/**
 * The height below which a roster row draws NONE of its per-row controls — the
 * state control, the difficulty chip and the team chip alike.
 *
 * It was three separate `> 8` literals in the view before u5, which is one guess
 * per control and no statement about their relationship. Stated once, here, it
 * says the thing that matters: **a row either carries its controls or carries
 * none of them.** The state control can never be the one a shrinking row drops
 * first — dropping it first is precisely the shape of the bug u5 exists to fix
 * (a screen that keeps its lesser controls and loses its main one).
 *
 * Rows this short only happen where the roster has been compressed hard (the file
 * header's rule: the roster is a list and it is what gives, so the hull tiles and
 * the arena cards keep their thumb floors). `./lobby-geometry.test.ts` asserts
 * every LANDSCAPE profile — the orientation this screen is used in — stays above
 * it.
 */
export const SEAT_CONTROL_MIN_HEIGHT = 8;

/** Width of a roster row's TEAM chip (TEAMS only) — wide enough for the WORD the
 *  chip carries since the developer reported a teams match they could not read
 *  sides in (m10; a bare letter is a legend nobody was given, and the in-match
 *  nameplates say it in full too). **88, not 64, since u3 (2026-08-05):** the word
 *  is now the viewer-relative `FRIENDLY A` / `ENEMY B` (`./lobby` `teamName`), and
 *  the longest of those measures 64px in 11px Audiowide against `TEAM A`'s 41 —
 *  the old constant would have overflowed its own chip.
 *  It COMPOSES with the difficulty chip rather than replacing it
 *  (n2): laid out immediately left of the difficulty chip, and kept clear of the
 *  row's left {@link SEAT_TEAM_CHIP_MIN_BODY} so the row body stays tappable and the
 *  shared difficulty control keeps its place. In FFA a seat's side is its slot
 *  (teams-of-one), so the team chip is laid out but drawn away and a tap on it is a
 *  no-op in the model — the geometry stays mode-blind, the flow routes by mode. */
export const SEAT_TEAM_CHIP_WIDTH = ROSTER.sideWidth;

/**
 * …and the narrowest one that is still a chip rather than a stub.
 *
 * 36 is `FRIENDLY` at the type floor with its padding, once the chip is allowed
 * to stack the word over the letter (`./lobby-view` `drawTeamChip`) — the same
 * "dropped whole rather than drawn clipped" rung {@link SEAT_STATE_MIN} is for
 * the state control. {@link SEAT_ROW_MIN_WIDTH} is derived so no row the roster
 * will actually split into can reach it.
 */
export const SEAT_TEAM_CHIP_MIN = 36;

/**
 * The row width at which the body and the side chip both stop competing: the
 * leading bar and control, the guaranteed body, the side chip at its full
 * {@link SEAT_TEAM_CHIP_WIDTH} and the difficulty chip, all at once.
 *
 * Recorded so the tests can say *which* rows are the compromised ones rather than
 * asserting a blanket promise the narrow phone cannot keep.
 */
export const SEAT_ROW_FULL_WIDTH =
  (SEAT_STRIPE + SEAT_ROW_BODY_MIN + SEAT_TEAM_CHIP_WIDTH + SEAT_CHIP_WIDTH + 2 * SEAT_CHIP_PAD) /
  (1 - SEAT_STATE_MAX_FRACTION);

/**
 * Where a row's trailing chips may begin — the first pixel after the identity
 * bar, the leading STATE control, and the row BODY's own minimum.
 *
 * ---------------------------------------------------------------------------
 * ABSOLUTE SINCE u7-03, AND THAT IS THE RE-DERIVATION
 * ---------------------------------------------------------------------------
 * This used to be a *fraction* of the row (`SEAT_TEAM_CHIP_MIN_BODY`, 0.36),
 * chosen when a 221px row was the narrowest the screen produced. A fraction is
 * the wrong shape for the thing it protects: what has to survive is the identity
 * bar, the control that is actually there, and 16px of body — three absolute
 * numbers — and expressing them as 36% of the row **over-reserves on a narrow
 * row and under-reserves on a wide one**. On the notched landscape phone the
 * fraction was reserving 74px to protect 20px of need, and the 54px difference
 * came straight off the side chip's word.
 *
 * Stated absolutely, the same row keeps `FRIENDLY A` at full size. The guarantee
 * it replaces is strictly stronger — the body between the state control and the
 * chips is now *exactly* {@link SEAT_ROW_BODY_MIN} at its worst instead of
 * "whatever 36% happened to leave" — and it is one function, so the layout, the
 * hit test and the tests cannot each hold a different opinion about where a row's
 * body ends.
 */
export function seatBodyEnd(seat: Rect, state: Rect): number {
  const lead = state.width > 0 ? state.x + state.width : seat.x + SEAT_STRIPE;
  return lead + SEAT_ROW_BODY_MIN;
}

/** RUSH!'s width at the reference — the one PRIMARY plate on this screen, in
 *  the footer beam. Its HEIGHT is the frame's own compact plate, which is 56 on
 *  a desktop and the thumb floor on a phone, so there is no lobby literal for it
 *  any more (`../art/materials` `plateHeight`). */
export const RUSH_WIDTH_MAX = 220;

/**
 * At or above this BAND width the lobby lays out in two columns.
 *
 * **600 since u7-03, down from 700, and the change is a device rather than a
 * preference.** Planet Rush is a landscape game (`src/platform/orientation.ts` —
 * a phone held in portrait gets a ROTATE overlay), so a handset on its side is
 * the primary mobile layout of this screen. Under the lock, the iPhone SE
 * profile in QA's matrix (375×667) hands the lobby a 667×375 logical viewport,
 * whose band is **621px** — under the old 700, so it fell to the one-column
 * shape, where a 249px band split three ways left the roster 74px for eight rows.
 * Two columns give that same device a full-height roster and 48px rows.
 *
 * The number the constant still has to clear is the notched landscape iPhone's
 * 704px band, which it does with room to spare; and the two profiles that must
 * NOT reach it — a 390-wide phone in portrait (364) and a desktop window dragged
 * to 600 (558) — stay clear of it too. All three are asserted.
 */
export const TWO_COLUMN_MIN_WIDTH = 600;
/**
 * Share of the band the roster column takes when there are two.
 *
 * **0.60 since u7-03, up from 0.56.** The Gantry frame's page margin is the
 * handoff's (44 scaled) rather than the lobby's old 16, so the band is narrower
 * than the content box it replaced — and a roster column that merely kept its
 * old *fraction* would have handed the landscape phone a 191px halved row, below
 * the 190px a row needs to carry its side chip at full word width. At 0.60 that
 * row is 233px, which is wider than the 221px the screen shipped with.
 */
export const ROSTER_COLUMN_FRACTION = 0.6;
/** The rule between the two columns. One pixel: it is a separator, not a wall. */
export const SEPARATOR_WIDTH = 1;

// ---------------------------------------------------------------------------
// The entry screen (./lobby-entry) — the doors, and the keypad behind JOIN
//
// ── GANTRY / BONE (u7-04) ──────────────────────────────────────────────────
// The doors screen is framed like the title and settings screens now: a header
// beam, a footer beam, a page margin, and one content band between them
// ({@link ./gantry} `gantryFrame`). Everything the frame decides — the margins,
// the beam heights, the plate heights, the gutters — comes from
// `../art/materials` `frameMetrics`, so this screen draws the handoff's own 44 /
// 92 / 80 / 72 on a desktop and their derived counterparts on a phone rather than
// a second hand-picked set.
//
// Three of this screen's own numbers went away with that, and it is worth saying
// which and why, because they were load-bearing before:
//
//  - `DOOR_HEIGHT` / `DOOR_HEIGHT_TOUCH` (56 / 64) — a door is a PLATE now, so
//    its height is `plateHeight(scale, metrics)`: a hero plate for PLAY SOLO and
//    a standard plate for the other three. The thumb floor is enforced once, for
//    every screen, by `frameMetrics.plateScale`.
//  - `DOOR_HINT_HEIGHT` (18) — the hint is no longer a line of text floating
//    below the button. It is the plate's SUB-LINE, inside the plate under the
//    label, exactly as the handoff draws `Open a rig and take the field` under
//    PLAY. That is what freed the height the fourth door needed.
//  - `DOOR_WIDTH_MAX` (420) — superseded by the shared `COLUMN.title` (800), the
//    column the title screen already centres its stack in. Two front doors, one
//    column width.
// ---------------------------------------------------------------------------

/** Doors on the entry screen — mirrors `./lobby-entry` DOOR_ORDER.length
 *  (asserted equal in the tests), kept here so the geometry stays free of the
 *  model, exactly like {@link KEYPAD_KEY_COUNT}. Four since u9-01 added CAMPAIGN
 *  above SOLO. */
export const DOOR_COUNT = 4;

/**
 * …and the columns are only worth taking if each column can still carry a door
 * wide enough to read a label and its sub-line on. Narrower than this the stack
 * is kept, compressed plates and all — two unreadable columns are worse than one
 * readable list.
 *
 * The two-column shape is now a genuine LAST RESORT rather than the phone's
 * ordinary answer. Before u7-04 a landscape phone had to take it: four blocks of
 * button-plus-hint did not fit that band, and stacked they came out under 20px
 * each. With the hint inside the plate a block is one plate tall, and four of
 * them stack at 54–60px on the same handset — above the thumb floor, in the order
 * the developer asked for. So the columns branch survives only for a band too
 * short to give four plates a pressable height at all, which no profile in QA's
 * device matrix produces (asserted in `./lobby-entry.test.ts`).
 */
export const DOOR_COLUMN_MIN_WIDTH = 240;

/**
 * The strip at the top of the content band that carries the screen's one line —
 * the tagline `MINE · DEFEND · ATTACK`, the keypad's prompt, the CAMPAIGN
 * teaser's `Coming Soon…`, a refusal, or the live connect narration.
 *
 * Reference px, scaled by the frame like every other chrome metric. It is sized
 * for the largest thing the slot ever carries (the 17px narration line, which may
 * wrap to two lines on a phone), because that line is the connecting screen's
 * real title and must not be the thing a short band clips.
 */
export const ENTRY_MESSAGE_HEIGHT = 44;

/** The four code cells: big, because this is the number being read across a
 *  room and typed one character at a time (GDD §4.2). */
export const CODE_CELL_MAX = 72;
export const CODE_CELL_GAP = 10;

/** Keypad keys. 44 px is the floor a fingertip needs; below it the pad would be
 *  a lottery, so the *cells* shrink before the keys do. */
export const KEY_MIN = 34;
export const KEY_MAX = 56;
export const KEY_GAP = 4;
/** Columns in the pad — mirrors `./lobby-entry` KEYPAD_COLUMNS (asserted equal
 *  in the tests), kept here so the geometry stays free of the model. */
export const KEYPAD_COLUMNS = 8;
/** Keys in the alphabet — mirrors `./lobby-entry` KEYPAD_KEYS.length. */
export const KEYPAD_KEY_COUNT = 32;

/**
 * The footer beam's plates, at the handoff's reference width.
 *
 * `ENTRY_ACTION_HEIGHT` / `_TOUCH` (48 / 56) are gone with the same reasoning as
 * the door heights above: a footer control is a `compact` plate, so its height is
 * `plateHeight('compact', metrics)` — the settings screen's DONE, one dialect.
 * What is left is how WIDE each word's plate is, and they differ because the
 * words do: `SETTINGS` needs more metal than `BACK`.
 *
 * Read off the handoff's own footer, which draws BACK at 140 and its trailing
 * action a shade wider.
 */
export const ENTRY_BACK_WIDTH = 140;
export const ENTRY_SETTINGS_WIDTH = 190;
export const ENTRY_ERASE_WIDTH = 160;
export const ENTRY_SUBMIT_WIDTH = 160;

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

/**
 * How the four hull tiles are arranged. The tile *height* is what carries the
 * role blurb (GDD §2.11), so a short band changes the arrangement rather than
 * squashing four tiles into unreadable strips:
 *
 *  - `stack` — four down a column. The desktop/two-column shape.
 *  - `grid`  — 2×2. The phone shape, in both orientations, since the tiles moved
 *              into the ship-select column (u7-03).
 *  - `row`   — four across, one row. What a wide-and-very-short window falls to,
 *              where height is the scarce axis and width is not.
 */
export type TileShape = 'stack' | 'grid' | 'row';

/** Every rect the lobby draws in, for one viewport. */
export interface LobbyLayout {
  /** The safe area inset by the page margin — the box everything lives inside. */
  readonly content: Rect;
  /** The header beam, full width inside the safe area (`./gantry`). */
  readonly header: Rect;
  /** The footer beam — BACK, the RUSH! hint and RUSH!. */
  readonly footer: Rect;
  /** The band between the two beams: the roster, ship select and the arena row. */
  readonly band: Rect;
  /** The heading's strip inside the header beam (left of the room code). */
  readonly title: Rect;
  /** BACK — the lobby's exit to the main menu (u2 menu-back), the left-hand
   *  plate in the FOOTER beam since u7-03 (it was the title band's far left). */
  readonly leave: Rect;
  /** `ROOM` + the code, right-aligned inside the header beam. */
  readonly roomCode: Rect;
  /** The RUSH! hint's strip — between BACK and RUSH! in the footer beam. */
  readonly rushHint: Rect;
  /** The 1px rule between the roster column and the ship-select column.
   *  Zero-extent in the one-column shape, where there is nothing to separate. */
  readonly separator: Rect;
  /** The ship-select column — the hull tiles and the arena row, bounded by the
   *  band (the handoff's rule) so nothing crowds the separator. In the
   *  one-column shape it is the band's lower two blocks. */
  readonly shipColumn: Rect;
  /** The resolved frame — beams, margins, gutters, plate scale. The view reads
   *  its type sizes and paddings off this rather than re-deriving them. */
  readonly metrics: FrameMetrics;
  /** The eight roster rows, in slot order, top to bottom. */
  readonly seats: readonly Rect[];
  /** Each roster row's LEADING STATE control — the OPEN/BOT/CLOSED cycle, named
   *  (u5). Nested inside its {@link seats} row at the leading edge, right of the
   *  identity bar and spanning the row's FULL height (u7-03), so the hit-test
   *  finds it *before* the row body and a 48px row is made of 48px controls.
   *  Aligned to `seats`; zero-extent on a row too narrow to carry a legible one. */
  readonly seatStates: readonly Rect[];
  /** Each roster row's trailing DIFFICULTY chip — the bot-tier cycle, in BOTH
   *  modes (n2). Nested inside its {@link seats} row on the right, so the hit-test
   *  checks it *before* the row body. Aligned to `seats`. */
  readonly seatChips: readonly Rect[];
  /** Each roster row's TEAM chip (TEAMS) — the side cycle, composed immediately
   *  left of the difficulty chip and kept clear of the row's body ({@link
   *  seatBodyEnd}). Aligned to `seats`; zero-extent below
   *  {@link SEAT_TEAM_CHIP_MIN}, which no row the roster splits into reaches. */
  readonly seatTeamChips: readonly Rect[];
  /** The MODE toggle (FFA / TEAMS), top-left of the roster (variable-slots E). */
  readonly modeToggle: Rect;
  /** The ABUNDANCE toggle (SCARCE / STANDARD / RICH), top-right of the roster. */
  readonly abundance: Rect;
  /** The four hull tiles, in `CLASS_ORDER`. */
  readonly classOptions: readonly Rect[];
  /** The four arena cards, in `MAP_ORDER` (`./map-picker`). A row along the
   *  bottom of the SHIP-SELECT column (u7-03 — it used to cut across the whole
   *  band, which is the width the roster now has); the view draws them through
   *  the shared `MapPickerView`, so the registry previews come for free. */
  readonly maps: readonly Rect[];
  /** The band the arena cards were laid out inside — handed to the map view as
   *  its `MapPickerLayout.band`. */
  readonly mapBand: Rect;
  /** Columns the arena cards fell into — 4 (a row) or 2 (a narrow 2×2). */
  readonly mapColumns: number;
  /** RUSH! / the countdown. */
  readonly rushButton: Rect;
  /** Whether this layout was built at thumb scale. */
  readonly isTouch: boolean;
  /** Whether the roster and the tiles sit side by side. */
  readonly twoColumn: boolean;
  /** Roster columns — 2 where one column of eight would fall under the thumb
   *  floor and the column is wide enough to halve ({@link placeSeats}). Seats
   *  fill column-major, so slot order still reads top-to-bottom. */
  readonly seatColumns: number;
  /** How the four hull tiles are arranged. */
  readonly tileShape: TileShape;
}

/** What a tap landed on. Index-based, so the geometry never has to know what a
 *  seat or a hull *is* — the caller maps an index through the model's own order
 *  (`./lobby` CLASS_ORDER / seat slots), and the two can't drift. */
export type LobbyTarget =
  /** BACK — leaves the lobby for the main menu (u2 menu-back), the exit every
   *  screen carries. The footer beam's left-hand plate since u7-03. */
  | { readonly kind: 'leave' }
  /** The row body — cycles the seat's OPEN/BOT/CLOSED state (variable-slots E).
   *  Since u5 the same cycle also has a control that SAYS so ({@link seatState});
   *  the body is kept because a wide row is a generous target and taking it away
   *  would be a second change nobody asked for. */
  | { readonly kind: 'seat'; readonly index: number }
  /** The row's LEADING STATE control — the same OPEN/BOT/CLOSED cycle as the row
   *  body, drawn and named (u5). A distinct target rather than a second `seat`
   *  rect so the flow, the seam and the tests can talk about the *control* rather
   *  than about the row that happens to contain it. */
  | { readonly kind: 'seatState'; readonly index: number }
  /** The row's trailing DIFFICULTY chip — the bot-tier cycle, present in BOTH
   *  modes (n2). The flow routes it to the difficulty cycle in either mode. */
  | { readonly kind: 'seatChip'; readonly index: number }
  /** The row's TEAM chip — the side cycle, TEAMS only (n2). Laid out in FFA too
   *  (geometry stays mode-blind), where a tap on it is a model no-op. */
  | { readonly kind: 'seatTeamChip'; readonly index: number }
  /** The MODE toggle (variable-slots E). */
  | { readonly kind: 'mode' }
  /** The ABUNDANCE toggle (variable-slots E). */
  | { readonly kind: 'abundance' }
  | { readonly kind: 'class'; readonly index: number }
  | { readonly kind: 'map'; readonly index: number }
  | { readonly kind: 'rush' }
  | { readonly kind: 'roomCode' };

/**
 * Lay the lobby out for a viewport.
 *
 * The frame comes first ({@link ./gantry} `gantryFrame`): two beams, a page
 * margin and one band between them. The beams' own contents — the heading and
 * the room code above, BACK and RUSH! below — are placed inside their strips,
 * and everything else divides the band.
 *
 * Every block is *capped*, never stretched past its cap, so a rect can only ever
 * be smaller than the room it was given — which is what makes "nothing escapes
 * `content`" true by construction rather than by luck. The one place that runs
 * the other way is stated where it happens: RUSH! takes the thumb floor even
 * where the beam cannot hold one, and the BAND gives up exactly those pixels.
 */
export function lobbyLayout(viewport: Viewport, options: LobbyLayoutOptions = {}): LobbyLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const metrics = frame.metrics;
  const content = frame.content;
  const gap = metrics.gap;

  // The footer's plates are sized before the band is, because on a short viewport
  // they are what the band gives way to. RUSH! is the one control on this screen
  // a player has to be able to press, so it takes the thumb floor even where the
  // beam and its gutter cannot hold one (a 390-wide phone in PORTRAIT resolves a
  // 28px beam), and the band loses that overflow off its bottom — which is air
  // between the band and the beam by construction, plus whatever the band lends.
  const actionHeight = Math.max(
    0,
    Math.min(
      Math.max(TOUCH_MIN, plateHeight('compact', metrics)),
      frame.footer.height + metrics.gutter + frame.band.height,
    ),
  );
  const actionOverflow = Math.max(0, actionHeight - (frame.footer.height + metrics.gutter));
  const band: Rect = {
    ...frame.band,
    height: Math.max(0, frame.band.height - actionOverflow),
  };

  // --- The header beam: the heading left, the room-code cluster right --------
  const headerStrip = beamContent(frame.header, metrics, 'header');
  const codeWidth = Math.min(scaled(ROOM_CODE_WIDTH, metrics), headerStrip.width);
  const roomCode: Rect = {
    x: headerStrip.x + headerStrip.width - codeWidth,
    y: headerStrip.y,
    width: codeWidth,
    height: headerStrip.height,
  };
  const title: Rect = {
    x: headerStrip.x,
    y: headerStrip.y,
    width: Math.max(0, headerStrip.width - codeWidth - gap),
    height: headerStrip.height,
  };

  // --- The footer beam: BACK, the hint, RUSH! --------------------------------
  //
  // The two plates are sized by the frame like every other plate in the set, so
  // they are 56px on a desktop and the thumb floor on a phone. A phone's beam is
  // itself under the floor (47px with notch insets), so a plate that cannot be
  // centred in it is bottom-aligned instead and grows upward — never past the
  // safe-area edge below it, and never into the band, which gave up exactly that
  // many pixels above.
  const footerStrip = beamContent(frame.footer, metrics, 'footer');
  const footerBottom = frame.footer.y + frame.footer.height;
  const actionY = Math.min(
    footerStrip.y + (footerStrip.height - actionHeight) / 2,
    footerBottom - actionHeight,
  );
  const backWidth = Math.max(0, Math.min(scaled(LOBBY_BACK_WIDTH, metrics), footerStrip.width));
  const leave: Rect = { x: footerStrip.x, y: actionY, width: backWidth, height: actionHeight };
  const rushWidth = Math.max(
    0,
    Math.min(scaled(RUSH_WIDTH_MAX, metrics), footerStrip.width - backWidth - gap),
  );
  const rushButton: Rect = {
    x: footerStrip.x + footerStrip.width - rushWidth,
    y: actionY,
    width: rushWidth,
    height: actionHeight,
  };
  // The hint is what a guest reads instead of a dead button ("WAITING FOR THE
  // HOST"), so it keeps a strip of its own between the two plates rather than
  // being hung under RUSH! where a short footer would clip it.
  const hintX = leave.x + backWidth + (backWidth > 0 ? gap : 0);
  const rushHint: Rect = {
    x: hintX,
    y: actionY,
    width: Math.max(0, rushButton.x - (rushWidth > 0 ? gap : 0) - hintX),
    height: actionHeight,
  };

  // --- The band -------------------------------------------------------------
  const twoColumn = band.width >= TWO_COLUMN_MIN_WIDTH;

  const seats: Rect[] = [];
  const classOptions: Rect[] = [];
  const maps: Rect[] = [];
  let tileShape: TileShape;
  let rosterBox: Rect;
  let shipColumn: Rect;
  let separator: Rect;
  let mapBand: Rect;

  if (twoColumn) {
    // Roster left, ship select right, **both spanning the whole band** — the
    // handoff's rule, and the reason the roster can hand every row a thumb.
    const rosterWidth = Math.max(0, band.width * ROSTER_COLUMN_FRACTION - gap / 2);
    const shipX = band.x + rosterWidth + gap;
    rosterBox = { x: band.x, y: band.y, width: rosterWidth, height: band.height };
    shipColumn = {
      x: shipX,
      y: band.y,
      width: Math.max(0, band.x + band.width - shipX),
      height: band.height,
    };
    separator = {
      x: band.x + rosterWidth + gap / 2,
      y: band.y,
      width: band.width > 0 && rosterWidth > 0 ? SEPARATOR_WIDTH : 0,
      height: band.height,
    };
    // Inside the right column: the four hull tiles, then the arena row along its
    // bottom. The cards are a thumb choice, so they keep a floor and the tiles —
    // which have a floor of their own — take what is left.
    const mapHeight = mapRowHeight(shipColumn.height);
    const tilesHeight = Math.max(0, shipColumn.height - mapHeight - (mapHeight > 0 ? gap : 0));
    tileShape = placeTiles(
      classOptions,
      shipColumn.x,
      shipColumn.y,
      shipColumn.width,
      tilesHeight,
      'stack',
    );
    mapBand = {
      x: shipColumn.x,
      y: shipColumn.y + tilesHeight + (mapHeight > 0 ? gap : 0),
      width: shipColumn.width,
      height: mapHeight,
    };
  } else {
    // One column: roster, then the tiles, then the arena row off the bottom.
    const mapHeight = mapRowHeight(band.height);
    const upperHeight = Math.max(0, band.height - mapHeight - (mapHeight > 0 ? BLOCK_GAP : 0));
    // The roster asks for what eight thumb-sized rows and the strip above them
    // actually need, and is refused only by the tiles' own floor. It used to take
    // whatever was left after the tiles claimed a *fraction* of the band, which
    // is how a 390px phone ended up with 45px rows on a band that could afford 55.
    const tilesFloor = Math.min(2 * CLASS_TILE_MIN + ROW_GAP + BLOCK_GAP, upperHeight);
    const rosterHeight = Math.max(
      0,
      Math.min(rosterWantedHeight(metrics), upperHeight - tilesFloor),
    );
    const tilesHeight = Math.max(0, upperHeight - rosterHeight - (rosterHeight > 0 ? BLOCK_GAP : 0));
    rosterBox = { x: band.x, y: band.y, width: band.width, height: rosterHeight };
    const tilesY = band.y + rosterHeight + (rosterHeight > 0 ? BLOCK_GAP : 0);
    shipColumn = {
      x: band.x,
      y: tilesY,
      width: band.width,
      height: Math.max(0, band.y + band.height - tilesY),
    };
    separator = { x: band.x, y: band.y, width: 0, height: 0 };
    tileShape = placeTiles(classOptions, band.x, tilesY, band.width, tilesHeight, 'grid');
    mapBand = {
      x: band.x,
      y: band.y + upperHeight + (mapHeight > 0 ? BLOCK_GAP : 0),
      width: band.width,
      height: mapHeight,
    };
  }

  // The MODE / ABUNDANCE strip is carved off the TOP of the roster box (never a
  // band of its own — see the constants header): the roster gives back the space,
  // the tiles and the arena cards keep their floors. The seats take what is left.
  const controls = placeControls(rosterBox, metrics);
  const seatsBox: Rect = {
    x: rosterBox.x,
    y: rosterBox.y + controls.height + (controls.height > 0 ? metrics.rowGap : 0),
    width: rosterBox.width,
    height: Math.max(0, rosterBox.height - controls.height - (controls.height > 0 ? metrics.rowGap : 0)),
  };
  const seatColumns = placeSeats(seats, seatsBox, rosterRowHeight(metrics), gap);
  const seatStates = seats.map((rect) => stateRect(rect));
  const seatChips = seats.map((rect) => chipRect(rect));
  const seatTeamChips = seats.map((rect, i) => teamChipRect(rect, seatChips[i]!, seatStates[i]!));
  const mapColumns = placeMaps(maps, mapBand);

  return {
    content,
    header: frame.header,
    footer: frame.footer,
    band,
    title,
    leave,
    roomCode,
    rushHint,
    separator,
    shipColumn,
    metrics,
    seats,
    seatStates,
    seatChips,
    seatTeamChips,
    modeToggle: controls.modeToggle,
    abundance: controls.abundance,
    classOptions,
    maps,
    mapBand,
    mapColumns,
    rushButton,
    isTouch,
    twoColumn,
    seatColumns,
    tileShape,
  };
}

/** One of this file's reference metrics at the frame's plate scale — the widths
 *  that hold display type and therefore shrink with it. The roster's own segment
 *  widths deliberately do NOT (`../art/materials` `ROSTER`). */
function scaled(referencePx: number, m: FrameMetrics): number {
  return Math.max(0, Math.round(referencePx * m.plateScale));
}

/** The arena row's height inside the column it hangs off the bottom of: a share
 *  of that column, floored so a card can still show its preview over its name and
 *  capped so it never balloons on a tall desktop. */
function mapRowHeight(columnHeight: number): number {
  const wanted = Math.max(
    columnHeight * LOBBY_MAP_BAND_FRACTION,
    Math.min(LOBBY_MAP_ROW_MIN, columnHeight / 2),
  );
  return Math.max(0, Math.min(wanted, LOBBY_MAP_ROW_MAX, columnHeight));
}

/** What the roster column would like: the MODE/ORE strip, then eight rows at the
 *  frame's own row height — which is floored at the thumb (`rosterRowHeight`). */
function rosterWantedHeight(m: FrameMetrics): number {
  return (
    valueChipHeight(m) +
    m.rowGap +
    LOBBY_SLOT_ROWS * rosterRowHeight(m) +
    (LOBBY_SLOT_ROWS - 1) * ROSTER.gap
  );
}

/**
 * The MODE toggle (top-left of the roster) and the ABUNDANCE toggle (top-right),
 * splitting the roster width with a gap between. Capped in width so they read as
 * controls on a wide desktop column, and clamped to the roster's own height so a
 * comically short box yields zero-extent rather than a strip taller than its band.
 *
 * Its height is the frame's own value chip ({@link ../art/materials}
 * `valueChipHeight`) rather than a lobby literal — the same 40px-at-reference,
 * thumb-floored control the settings screen's toggles are, because that is what
 * they are.
 */
function placeControls(roster: Rect, m: FrameMetrics): { modeToggle: Rect; abundance: Rect; height: number } {
  const height = Math.max(0, Math.min(valueChipHeight(m), roster.height));
  const width = Math.max(0, Math.min(CONTROL_MAX_WIDTH, (roster.width - m.gap) / 2));
  const modeToggle: Rect = { x: roster.x, y: roster.y, width, height };
  const abundance: Rect = { x: roster.x + roster.width - width, y: roster.y, width, height };
  return { modeToggle, abundance, height };
}

/**
 * A roster row's LEADING STATE control — the OPEN / BOT / CLOSED cycle, named
 * (u5; see {@link SEAT_STATE_WIDTH} for why it exists).
 *
 * Placed immediately right of the identity stripe and bounded three ways, taking
 * whichever is smallest: its own width, a share of a narrow row, and whatever is
 * left once the row body keeps {@link SEAT_ROW_BODY_MIN} clear of the trailing
 * chips' guaranteed zone ({@link SEAT_TEAM_CHIP_MIN_BODY}). That last bound is
 * the one that matters: it is what makes "u5 moved layout and moved nothing else"
 * true by construction rather than by care — no width of row can let this control
 * reach the space the team chip was already promised, so the difficulty chip, the
 * team chip and the body between them keep every guarantee they had.
 *
 * Below {@link SEAT_STATE_MIN} the control is dropped whole rather than drawn as
 * a stub with a clipped word in it.
 */
function stateRect(seat: Rect): Rect {
  if (seat.width <= 0 || seat.height <= 0) return { x: seat.x, y: seat.y, width: 0, height: 0 };
  const x = seat.x + SEAT_STRIPE;
  const room = Math.min(SEAT_STATE_WIDTH, seat.width * SEAT_STATE_MAX_FRACTION);
  const width = room >= SEAT_STATE_MIN ? room : 0;
  // Full row height, not inset (u7-03): a 48px row inset by a pad is a 42px
  // control, and this is the screen that cannot afford one.
  return { x, y: seat.y, width, height: width > 0 ? seat.height : 0 };
}

/**
 * A roster row's trailing chip — the TEAM (TEAMS) / difficulty (FFA) cycle. Carved
 * off the RIGHT of the row and inset, so it never covers the row's centre: the
 * hit-test contract taps a seat at its centre and must still land on the row body
 * ({@link lobbyHitTest} checks the chip first, so a tap *on* the chip wins).
 */
function chipRect(seat: Rect): Rect {
  if (seat.width <= 0 || seat.height <= 0) return { x: seat.x, y: seat.y, width: 0, height: 0 };
  const width = Math.max(0, Math.min(SEAT_CHIP_WIDTH, seat.width * SEAT_CHIP_MAX_FRACTION - SEAT_CHIP_PAD));
  return { x: seat.x + seat.width - width, y: seat.y, width, height: seat.height };
}

/**
 * A roster row's TEAM chip (TEAMS) — the side cycle that COMPOSES with the
 * difficulty chip rather than replacing it (n2). It sits immediately left of the
 * difficulty chip and its left edge is clamped out of the row's leading
 * {@link SEAT_TEAM_CHIP_MIN_BODY}, so a tap on the row body still lands on the body
 * ({@link lobbyHitTest} checks the chips first, so a tap *on* a chip wins). A very
 * narrow row that cannot spare that width yields a zero-extent chip — the
 * difficulty control, the shared one, always keeps its place.
 */
function teamChipRect(seat: Rect, diffChip: Rect, state: Rect): Rect {
  if (seat.width <= 0 || seat.height <= 0 || diffChip.width <= 0) {
    return { x: seat.x, y: seat.y, width: 0, height: 0 };
  }
  const right = diffChip.x - SEAT_CHIP_PAD;
  const left = Math.max(seatBodyEnd(seat, state), right - SEAT_TEAM_CHIP_WIDTH);
  const room = Math.max(0, right - left);
  // Dropped whole below the stub floor, exactly as the state control is: a chip
  // too narrow to name a side is worse than none, and the row body still cycles.
  const width = room >= SEAT_TEAM_CHIP_MIN ? room : 0;
  return { x: width > 0 ? left : seat.x, y: seat.y, width, height: width > 0 ? seat.height : 0 };
}

/**
 * The target a tap at `(x, y)` hits, or `null` for a tap on nothing.
 *
 * Tested against the rects the frame was **drawn** at, never a second copy of
 * the arithmetic: the view holds one {@link LobbyLayout} and passes it here, so
 * a tap and a pixel can never disagree (GDD §2.4 — "menus and Rematch are plain
 * taps"). Ordered by what a mis-hit should favour: the button, then the hull
 * tiles, then the roster.
 */
export function lobbyHitTest(layout: LobbyLayout, x: number, y: number): LobbyTarget | null {
  // BACK first — the exit sits in the title band's corner, clear of every other
  // control, and a mis-hit toward the edge should favour leaving over nothing.
  if (hit(layout.leave, x, y)) return { kind: 'leave' };
  if (hit(layout.rushButton, x, y)) return { kind: 'rush' };
  for (let i = 0; i < layout.classOptions.length; i++) {
    const rect = layout.classOptions[i];
    if (rect && hit(rect, x, y)) return { kind: 'class', index: i };
  }
  for (let i = 0; i < layout.maps.length; i++) {
    const rect = layout.maps[i];
    if (rect && hit(rect, x, y)) return { kind: 'map', index: i };
  }
  // The MODE / ABUNDANCE toggles (variable-slots E) — above the roster rows.
  if (hit(layout.modeToggle, x, y)) return { kind: 'mode' };
  if (hit(layout.abundance, x, y)) return { kind: 'abundance' };
  for (let i = 0; i < layout.seats.length; i++) {
    // A row's own controls win over its body: the LEADING state control names and
    // cycles OPEN/BOT/CLOSED (u5), the trailing difficulty chip cycles the bot's
    // tier (both modes), and the team chip to its left cycles the side (TEAMS); a
    // tap anywhere else on the row cycles the seat state too. The three sit at the
    // row's leading edge and strictly right of its centre respectively, so the
    // BODY between them — what the hit-test contract taps — is never one of them.
    const stateControl = layout.seatStates[i];
    if (stateControl && hit(stateControl, x, y)) return { kind: 'seatState', index: i };
    const teamChip = layout.seatTeamChips[i];
    if (teamChip && hit(teamChip, x, y)) return { kind: 'seatTeamChip', index: i };
    const chip = layout.seatChips[i];
    if (chip && hit(chip, x, y)) return { kind: 'seatChip', index: i };
    const rect = layout.seats[i];
    if (rect && hit(rect, x, y)) return { kind: 'seat', index: i };
  }
  if (hit(layout.roomCode, x, y)) return { kind: 'roomCode' };
  return null;
}

// ---------------------------------------------------------------------------
// The entry screen's layout
// ---------------------------------------------------------------------------

/**
 * How the doors are arranged (u9-01, the fourth door):
 *
 *  - `stack`   — four down the middle, in `DOOR_ORDER`. The shape every screen
 *                with the height for it gets, and the one the developer's
 *                "CAMPAIGN goes ontop of Solo" describes literally.
 *  - `columns` — two columns of two, filled **column-major** like the lobby
 *                roster ({@link placeSeats}): CAMPAIGN over SOLO on the left,
 *                CREATE over JOIN on the right. The landscape-phone shape, where
 *                height is the scarce axis and width is not — and the reason it
 *                is column-major rather than row-major is precisely so CAMPAIGN
 *                is still directly above SOLO.
 */
export type DoorShape = 'stack' | 'columns';

/** Every rect the entry screen draws in. Both screens are laid out every time —
 *  they cost a dozen rects, the view draws only the active one, and a layout
 *  that does not branch on state cannot be wrong for the state it is in. */
export interface EntryLayout {
  readonly content: Rect;
  /** The header beam, full width inside the safe area (u7-04). */
  readonly header: Rect;
  /** The footer beam, which carries BACK and SETTINGS (or BACK / ERASE / JOIN). */
  readonly footer: Rect;
  /** The wordmark's strip INSIDE the header beam — no longer a slice of the
   *  content box. Same move the title screen made in u7-01: under Gantry the
   *  wordmark lives in the beam, centred across it. */
  readonly title: Rect;
  /** The eyebrow cluster's strip inside the header beam, left of the wordmark. */
  readonly eyebrow: Rect;
  /** The one line under it: the prompt, or the failure (`./lobby-entry`). */
  readonly message: Rect;
  /** The four doors, in `DOOR_ORDER`. Home screen. */
  readonly doors: readonly Rect[];
  /** How those doors were arranged — one column or two. */
  readonly doorShape: DoorShape;
  /** The four code cells, left to right. Join screen. */
  readonly cells: readonly Rect[];
  /** The keypad, in `KEYPAD_KEYS` order: across a row, then down. */
  readonly keys: readonly Rect[];
  /** BACK — the one exit both entry screens carry (u2 menu-back). On the keypad
   *  it steps back to the doors; on the home screen it leaves to the main menu
   *  (the standing "every screen you can leave" rule). Same left-anchored rect on
   *  both, so the button never moves as the screen changes under it. */
  readonly back: Rect;
  /** The erase key. Sized like a button, not like a key: it is pressed far more
   *  often than any single letter, and a mis-hit on it costs a whole character. */
  readonly erase: Rect;
  /** JOIN. */
  readonly submit: Rect;
  /** SETTINGS — home screen only. Shares the action band with the join controls
   *  (only one screen is ever drawn), so it costs a rect, not a branch. It gives
   *  the left slice of the band to {@link back} — the home screen's exit — and
   *  takes the rest. */
  readonly settings: Rect;
  readonly isTouch: boolean;
  /** The frame this screen was resolved at — handed to the view so it scales its
   *  type and its plate padding off the same numbers the rects came from. */
  readonly metrics: FrameMetrics;
}

/** What a tap on the entry screen hit. Index-based, like {@link LobbyTarget}:
 *  the caller maps an index through the model's own order (`./lobby-entry`
 *  DOOR_ORDER / KEYPAD_KEYS), so the two can never drift. */
export type EntryTarget =
  | { readonly kind: 'door'; readonly index: number }
  | { readonly kind: 'key'; readonly index: number }
  | { readonly kind: 'erase' }
  | { readonly kind: 'back' }
  | { readonly kind: 'submit' }
  /** The SETTINGS button, home screen only — the fourth way out of the main menu
   *  (GDD §3.7), and the one that opens a screen rather than a room. */
  | { readonly kind: 'settings' };

/**
 * A stable string naming one entry-screen control — `door:1`, `key:7`, `back`.
 *
 * The pointer layer needs to say "the finger is on THIS control" without holding
 * a rect, and both the hover cue (`src/main.ts`) and the plate's rest/hover/press
 * state (`./lobby-entry` `entryPlateState`) ask the same question. Stating the key
 * format once, here, beside the target it names, is what keeps the two from
 * drifting into two spellings of one control.
 */
export function entryTargetKey(target: EntryTarget | null): string | null {
  if (!target) return null;
  switch (target.kind) {
    case 'door':
      return `door:${target.index}`;
    case 'key':
      return `key:${target.index}`;
    default:
      return target.kind;
  }
}

/**
 * Lay the entry screen out for a viewport, in the Gantry frame (u7-04).
 *
 * The furniture comes from {@link ./gantry} `gantryFrame`: a header beam carrying
 * the eyebrow cluster and the wordmark, a footer beam carrying this screen's
 * secondary actions, and one content band between them. Inside the band, space is
 * handed out top-down — the message line, then everything else — and every block
 * is *capped* rather than stretched, so nothing can escape the content box by
 * construction, exactly as {@link lobbyLayout} does.
 *
 * Where the two screens compete for the same band, the **keys win and the cells
 * give**: a code cell that is a little small is still readable, while a key too
 * small to hit reliably makes the screen unusable (GDD §2.4).
 */
export function entryLayout(viewport: Viewport, options: LobbyLayoutOptions = {}): EntryLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const m = frame.metrics;

  // --- The header beam ------------------------------------------------------
  // Same construction as the title screen: the eyebrow cluster takes the left
  // share of the beam, the wordmark is centred across the whole of it, and the
  // view shrinks the wordmark (never the cluster) if the two would collide.
  const beamStrip = beamContent(frame.header, m);
  const eyebrow: Rect = {
    x: beamStrip.x,
    y: beamStrip.y,
    width: Math.max(0, beamStrip.width * ENTRY_EYEBROW_SHARE),
    height: beamStrip.height,
  };
  const title: Rect = { ...beamStrip };

  // --- The footer beam ------------------------------------------------------
  // BACK is bolted to the leading end on BOTH screens — the exit every screen
  // carries (u2 menu-back), and it must not move as the screen changes under it.
  // The trailing end carries the screen's other control: SETTINGS on the doors,
  // JOIN on the keypad, with ERASE a gutter inboard of it.
  const footerStrip = beamContent(frame.footer, m, 'footer');
  // Three plates share the beam on the KEYPAD screen and two on the doors, so the
  // three-plate case is what the widths are solved against: a beam that fits BACK
  // + ERASE + JOIN fits BACK + SETTINGS with room to spare. They shrink together
  // by one factor rather than each clamping itself — clamping each to the strip
  // independently is what let BACK run under ERASE on a 390px phone, where the
  // three reference widths add up to more beam than there is.
  const footerGutter = m.gutter;
  const wanted = (ENTRY_BACK_WIDTH + ENTRY_ERASE_WIDTH + ENTRY_SUBMIT_WIDTH) * m.plateScale;
  const room = Math.max(0, footerStrip.width - 2 * footerGutter);
  const squeeze = wanted > 0 ? Math.min(1, room / wanted) : 0;
  const plateW = (reference: number): number =>
    Math.max(0, Math.min(Math.floor(reference * m.plateScale * squeeze), footerStrip.width));
  const back = beamPlate(footerStrip, m, 'leading', plateW(ENTRY_BACK_WIDTH));
  const settings = beamPlate(footerStrip, m, 'trailing', plateW(ENTRY_SETTINGS_WIDTH));
  const submit = beamPlate(footerStrip, m, 'trailing', plateW(ENTRY_SUBMIT_WIDTH));
  const erase = beamPlate(
    footerStrip,
    m,
    'trailing',
    plateW(ENTRY_ERASE_WIDTH),
    'compact',
    submit.width + footerGutter,
  );

  // --- The band both screens divide ----------------------------------------
  const messageHeight = Math.min(
    frame.band.height,
    Math.max(0, Math.round(ENTRY_MESSAGE_HEIGHT * m.scale)),
  );
  const message: Rect = {
    x: frame.band.x,
    y: frame.band.y,
    width: frame.band.width,
    height: messageHeight,
  };
  const middleY = message.y + messageHeight + m.gutter;
  const middle: Rect = {
    x: frame.band.x,
    y: middleY,
    width: frame.band.width,
    height: Math.max(0, frame.band.y + frame.band.height - middleY),
  };

  const doors: Rect[] = [];
  const doorShape = placeDoors(doors, middle, m);

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    eyebrow,
    message,
    doors,
    doorShape,
    ...placeCodeEntry(middle),
    back,
    erase,
    submit,
    settings,
    isTouch,
    metrics: m,
  };
}

/** How much of the header beam the eyebrow cluster may claim before the view
 *  starts shrinking the wordmark to clear it. The title screen's own share. */
const ENTRY_EYEBROW_SHARE = 0.34;

/**
 * The target a tap at `(x, y)` hits on the entry screen, or `null`.
 *
 * The caller passes only the targets the *current* screen has (`./lobby-entry`
 * EntryScreen), so a tap cannot land on a door that is not drawn: geometry that
 * is always laid out is not geometry that is always live.
 */
export function entryHitTest(
  layout: EntryLayout,
  x: number,
  y: number,
  screen: 'home' | 'join',
): EntryTarget | null {
  if (screen === 'home') {
    for (let i = 0; i < layout.doors.length; i++) {
      const rect = layout.doors[i];
      if (rect && hit(rect, x, y)) return { kind: 'door', index: i };
    }
    // BACK leaves the online front door for the main menu; it shares the action
    // band with SETTINGS, so it is tested first (the two never overlap).
    if (hit(layout.back, x, y)) return { kind: 'back' };
    if (hit(layout.settings, x, y)) return { kind: 'settings' };
    return null;
  }
  if (hit(layout.submit, x, y)) return { kind: 'submit' };
  if (hit(layout.erase, x, y)) return { kind: 'erase' };
  if (hit(layout.back, x, y)) return { kind: 'back' };
  for (let i = 0; i < layout.keys.length; i++) {
    const rect = layout.keys[i];
    if (rect && hit(rect, x, y)) return { kind: 'key', index: i };
  }
  return null;
}

/**
 * The four doors as PLATES, centred in the band (u7-04).
 *
 * The hint line moved *inside* the plate — it is the sub-line under the label, the
 * construction the handoff draws on the title screen — so a door is one plate
 * tall instead of a button plus a caption, and the plate heights come from the
 * frame: a **hero** plate for the one primary door and a **standard** plate for
 * the other three, which is how Bone says "this is the action" (size, and
 * brightness, and nothing else). {@link ./gantry} `stackPlates` centres the stack
 * and **compresses it proportionally** rather than overflowing, so that size
 * difference survives a band that cannot hold the stack at full height.
 *
 * One column wherever four plates come out pressable; two columns of two where
 * they do not — a last resort now rather than the phone's ordinary answer (see
 * {@link DOOR_COLUMN_MIN_WIDTH}). The columns fill **column-major** — CAMPAIGN
 * over SOLO, then CREATE over JOIN — for the same reason the roster does
 * ({@link placeSeats}): `DOOR_ORDER` still reads top to bottom, so the door the
 * developer asked to sit "ontop of Solo" sits on top of it in both shapes.
 *
 * Returns the shape it settled on.
 */
function placeDoors(out: Rect[], band: Rect, m: FrameMetrics): DoorShape {
  const heights = DOOR_PLATE_SCALES.map((scale) => plateHeight(scale, m));
  const columnCap = Math.min(COLUMN.title, band.width);

  // What a single stack gives. `stackPlates` is the authority on that — asking it
  // and measuring the answer is what stops this function owning a second copy of
  // the compression rule.
  const stacked = stackPlates(band, columnCap, heights, m.gap);
  const shortest = stacked.reduce((lo, r) => Math.min(lo, r.height), Infinity);
  const halfWidth = Math.max(0, (Math.min(COLUMN.title, band.width) - m.gap) / 2);
  // Only trade the stack away for columns that are actually better: the stack has
  // to have compressed a plate below the thumb floor AND the halved width has to
  // still carry a door with a label and a sub-line on it.
  const columns = shortest < TOUCH_MIN && halfWidth >= DOOR_COLUMN_MIN_WIDTH ? 2 : 1;

  if (columns === 1) {
    out.push(...stacked);
    return 'stack';
  }

  // Two columns, filled column-major, and the ROWS across them are TOP-aligned
  // rather than each column being centred in the band on its own: the left column
  // is taller than the right (it carries the hero), so centring each would leave
  // the two rows visibly out of register. Top-aligned, both rows line up and the
  // primary simply hangs lower — which reads as "this one is bigger", which is the
  // thing the size difference is there to say.
  const perColumn = Math.ceil(DOOR_COUNT / columns);
  const gaps = (perColumn - 1) * m.gap;
  let tallest = 0;
  for (let c = 0; c < columns; c++) {
    const slice = heights.slice(c * perColumn, (c + 1) * perColumn);
    tallest = Math.max(tallest, slice.reduce((a, b) => a + b, 0));
  }
  // One compression factor across both columns, so a squeezed band shrinks the
  // stack without changing the ratio between a hero plate and a standard one.
  const k = tallest > 0 ? Math.min(1, Math.max(0, band.height - gaps) / tallest) : 0;
  const spread = columns * halfWidth + (columns - 1) * m.gap;
  const left = band.x + Math.max(0, (band.width - spread) / 2);
  const top = band.y + Math.max(0, (band.height - (tallest * k + gaps)) / 2);
  for (let c = 0; c < columns; c++) {
    let y = top;
    for (let r = 0; r < perColumn; r++) {
      const h = (heights[c * perColumn + r] ?? 0) * k;
      out.push({ x: left + c * (halfWidth + m.gap), y, width: halfWidth, height: h });
      y += h + m.gap;
    }
  }
  return 'columns';
}

/**
 * Which plate scale each door is drawn at, in {@link DOOR_COUNT} order — and so
 * how tall it is. Mirrors `./lobby-entry` `doorPlate`, which owns the *role* half
 * of the same decision; the two are asserted consistent in the tests.
 *
 * PLAY SOLO is the hero, and it is the only one: it is the door that always works
 * with no server (GDD §4.8 risk 6), so it is the screen's headline action, and
 * under Bone the headline action is the biggest and brightest plate — and there is
 * exactly one ({@link ./gantry} `singlePrimary`).
 */
const DOOR_PLATE_SCALES: readonly PlateScale[] = ['standard', 'hero', 'standard', 'standard'];

/**
 * The code cells over the keypad.
 *
 * The keypad is sized first and the cells take what is left, because a key too
 * small to hit is a broken screen while a small cell is only a plain one. Both
 * are capped and centred, so a desktop gets a pad of thumb-sized keys in the
 * middle of the window rather than eight 200px slabs.
 */
function placeCodeEntry(band: Rect): { cells: Rect[]; keys: Rect[] } {
  const rows = Math.ceil(KEYPAD_KEY_COUNT / KEYPAD_COLUMNS);

  // What the pad would like, and what the band can actually give it.
  const keyWidth = Math.max(
    0,
    Math.min(KEY_MAX, (band.width - (KEYPAD_COLUMNS - 1) * KEY_GAP) / KEYPAD_COLUMNS),
  );
  // What the pad must keep is its *floor*, not its ceiling: reserving KEY_MAX
  // would leave a landscape phone's band with nothing for the cells, and a code
  // you cannot see yourself typing is worse than one typed on smaller keys.
  const padFloor = rows * KEY_MIN + (rows - 1) * KEY_GAP;
  const cellsWanted = Math.min(CODE_CELL_MAX, (band.width - 3 * CODE_CELL_GAP) / 4);
  // Give the cells their share only out of what the pad does not need.
  const cellSize = Math.max(
    0,
    Math.min(cellsWanted, band.height - padFloor - BLOCK_GAP, band.height * 0.4),
  );
  const padHeight = Math.max(0, band.height - cellSize - (cellSize > 0 ? BLOCK_GAP : 0));
  const keyHeight = Math.max(0, Math.min(KEY_MAX, rowHeight(padHeight, rows, KEY_GAP, KEY_MAX)));

  const cells: Rect[] = [];
  const cellsWidth = 4 * cellSize + 3 * CODE_CELL_GAP;
  const cellsX = band.x + (band.width - cellsWidth) / 2;
  for (let i = 0; i < 4; i++) {
    cells.push({
      x: cellsX + i * (cellSize + CODE_CELL_GAP),
      y: band.y,
      width: cellSize,
      height: cellSize,
    });
  }

  const keys: Rect[] = [];
  const padWidth = KEYPAD_COLUMNS * keyWidth + (KEYPAD_COLUMNS - 1) * KEY_GAP;
  const padX = band.x + (band.width - padWidth) / 2;
  const padY = band.y + cellSize + (cellSize > 0 ? BLOCK_GAP : 0);
  for (let i = 0; i < KEYPAD_KEY_COUNT; i++) {
    keys.push({
      x: padX + (i % KEYPAD_COLUMNS) * (keyWidth + KEY_GAP),
      y: padY + Math.floor(i / KEYPAD_COLUMNS) * (keyHeight + KEY_GAP),
      width: keyWidth,
      height: keyHeight,
    });
  }
  return { cells, keys };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lay the eight roster rows out inside `box`, in one column or — when eight
 * rows in one column would land **under the thumb floor** and the box is wide
 * enough to halve ({@link TWO_ROSTER_MIN_WIDTH}) — two columns of four. Seats
 * fill **column-major**, so slot order still reads top to bottom: P1–P4 down the
 * left, P5–P8 down the right.
 *
 * The split test is the thumb rather than legibility since u7-03: a roster row
 * stopped being a line of text to read when u5 put a control on it, so "can a
 * finger hit it" is the question, and it is the landscape phone's answer. The
 * width guard is what keeps a portrait phone — whose single column already
 * clears 48 — from being halved into two rows too narrow to carry a side chip.
 *
 * Returns the column count it settled on.
 */
function placeSeats(out: Rect[], box: Rect, max: number, gapX: number): number {
  const gap = ROSTER.gap;
  const single = rowHeight(box.height, LOBBY_SLOT_ROWS, gap, max);
  const twoColumns = single < TOUCH_MIN && box.width >= TWO_ROSTER_MIN_WIDTH;
  const columns = twoColumns ? 2 : 1;
  const perColumn = LOBBY_SLOT_ROWS / columns;
  const width = Math.max(0, (box.width - (columns - 1) * gapX) / columns);
  const height = rowHeight(box.height, perColumn, gap, max);
  for (let i = 0; i < LOBBY_SLOT_ROWS; i++) {
    const column = Math.floor(i / perColumn);
    const row = i % perColumn;
    out.push({
      x: box.x + column * (width + gapX),
      y: box.y + row * (height + gap),
      width,
      height,
    });
  }
  return columns;
}

/**
 * Lay the four hull tiles out, choosing the arrangement that keeps them tall
 * enough to carry a role blurb and wide enough to read one (GDD §2.11):
 * the caller's `preferred` shape, then the alternative, then whichever fits.
 * Returns the shape it used.
 *
 * Every branch caps rather than stretches, so a tile is only ever smaller than
 * the band it was handed — which is what makes "nothing escapes the content
 * box" true by construction.
 */
function placeTiles(
  out: Rect[],
  x: number,
  y: number,
  width: number,
  bandHeight: number,
  preferred: TileShape,
): TileShape {
  const stackH = rowHeight(bandHeight, 4, ROW_GAP, CLASS_TILE_MAX);
  const gridH = rowHeight(bandHeight, 2, ROW_GAP, CLASS_TILE_MAX);
  const gridW = (width - ROW_GAP) / 2;
  const rowW = (width - 3 * ROW_GAP) / 4;

  const stackOk = stackH >= CLASS_TILE_MIN && width >= CLASS_TILE_MIN_WIDTH;
  const gridOk = gridH >= CLASS_TILE_MIN && gridW >= CLASS_TILE_MIN_WIDTH;
  const rowOk = Math.min(CLASS_TILE_MAX, bandHeight) >= CLASS_TILE_MIN && rowW >= CLASS_TILE_MIN_WIDTH;

  const shape: TileShape =
    preferred === 'stack'
      ? stackOk
        ? 'stack'
        : gridOk
          ? 'grid'
          : rowOk
            ? 'row'
            : 'grid'
      : gridOk
        ? 'grid'
        : rowOk
          ? 'row'
          : 'grid';

  const columns = shape === 'stack' ? 1 : shape === 'grid' ? 2 : 4;
  const rows = 4 / columns;
  const tileWidth = Math.max(0, (width - (columns - 1) * ROW_GAP) / columns);
  const tileHeight = rowHeight(bandHeight, rows, ROW_GAP, CLASS_TILE_MAX);
  for (let i = 0; i < 4; i++) {
    // Reading order is CLASS_ORDER: across a grid row, then down.
    const column = columns === 1 ? 0 : i % columns;
    const row = columns === 1 ? i : Math.floor(i / columns);
    out.push({
      x: x + column * (tileWidth + ROW_GAP),
      y: y + row * (tileHeight + ROW_GAP),
      width: tileWidth,
      height: tileHeight,
    });
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Inside one hull tile
// ---------------------------------------------------------------------------

/** Where a hull tile's four content blocks go, and which of them fit. Every rect
 *  is absolute screen space and inside the tile; a block that does not fit is
 *  reported `false` **and** zero-height, so a view that ignores the flag still
 *  cannot draw a clipped one. */
export interface ClassTileContent {
  /** The class name — always drawn (rung 1 of the ladder). */
  readonly name: Rect;
  /** The hull nickname (Quadfin…) — rung 3. */
  readonly hull: Rect;
  /** The whole stat grid — rung 2, the pips-and-numbers block (u4). */
  readonly stats: Rect;
  /** The role blurb — rung 4, the first to go. */
  readonly blurb: Rect;
  readonly showHull: boolean;
  readonly showStats: boolean;
  readonly showBlurb: boolean;
  /** Columns the six stats fall into: 6 (one table-like row, wide tiles) or 3. */
  readonly statColumns: number;
  /** …and the rows that follow from it: 1 or 2. */
  readonly statRows: number;
  /** One cell's width — the room a `SPD 130%` and its pip bar have. */
  readonly cellWidth: number;
}

/**
 * Divide one hull tile between its name, its hull, its stat grid and its blurb,
 * by the priority ladder in the constants header above.
 *
 * Pure and rect-in/rect-out, for the same reason the rest of this file is: the
 * hard case is six stats on a 172×66 tile — a phone on its side, which is the
 * primary mobile layout of this screen — and that is a case worth asserting
 * headless on every device profile rather than eyeballing once.
 */
export function classTileContent(tile: Rect): ClassTileContent {
  const pad = CLASS_TILE_PAD;
  const x = tile.x + pad;
  const width = Math.max(0, tile.width - 2 * pad);
  const height = Math.max(0, tile.height - 2 * pad);

  // Six across whenever a cell can carry its figure over five pips comfortably
  // (the desktop tile, which then reads like GDD §2.11's own table row); 3×2
  // otherwise, which is the shape every phone gets. There is no 2-column shape:
  // three columns fit inside any tile {@link placeTiles} is willing to produce.
  const wideCell = (width - (STAT_COUNT - 1) * STAT_CELL_GAP) / STAT_COUNT;
  const statColumns = wideCell >= STAT_CELL_WIDE ? STAT_COUNT : 3;
  const statRows = Math.ceil(STAT_COUNT / statColumns);
  const cellWidth = (width - (statColumns - 1) * STAT_CELL_GAP) / statColumns;
  const gridHeight = statGridHeight(statRows);

  // A tile wide enough for a grid RESERVES the grid's height whether or not it
  // is tall enough to draw one. Without that, a short tile would "win back" its
  // hull line by failing to fit its stats — the ladder running backwards, and a
  // nickname blinking off as a tile grew. A tile too NARROW for a legible grid
  // is the documented fallback: it reserves nothing and degrades to the pre-u4
  // card, because no amount of height will earn it a grid.
  const fitsWidth = cellWidth >= STAT_CELL_FLOOR;
  const reserved = fitsWidth ? gridHeight : 0;
  const showStats = fitsWidth && height >= CLASS_NAME_LINE + gridHeight;
  const statsHeight = showStats ? gridHeight : 0;
  const showHull = height >= CLASS_NAME_LINE + CLASS_HULL_LINE + reserved;
  const hullHeight = showHull ? CLASS_HULL_LINE : 0;
  const showBlurb =
    showHull && height >= CLASS_NAME_LINE + CLASS_HULL_LINE + reserved + CLASS_BLURB_LINE;

  // Leftover height buys AIR around the stat block, up to STAT_BLOCK_AIR each
  // side — so the block reads as its own thing on a roomy tile instead of a
  // third line of prose, while a phone tile that has nothing to spare spends
  // nothing. Elastic rather than fixed because a fixed gap would have to come
  // out of the stats' own budget on exactly the device that can least afford it.
  const used =
    CLASS_NAME_LINE + hullHeight + statsHeight + (showBlurb ? CLASS_BLURB_LINE : 0);
  const slack = Math.max(0, height - used);
  const airAbove = showStats ? Math.min(STAT_BLOCK_AIR, Math.floor(slack / 2)) : 0;
  const airBelow = showStats ? Math.min(STAT_BLOCK_AIR, Math.floor(slack) - airAbove) : 0;

  let y = tile.y + pad;
  const name: Rect = { x, y, width, height: Math.min(CLASS_NAME_LINE, height) };
  y += name.height;
  const hull: Rect = { x, y, width, height: hullHeight };
  y += hullHeight + airAbove;
  const stats: Rect = { x, y, width, height: statsHeight };
  y += statsHeight + airBelow;
  // The blurb takes whatever is left below it — it wraps, so extra height is
  // extra lines rather than dead space. Never past the tile's own bottom.
  const blurbHeight = showBlurb ? Math.max(0, tile.y + tile.height - pad - y) : 0;
  const blurb: Rect = { x, y, width, height: blurbHeight };

  return {
    name,
    hull,
    stats,
    blurb,
    showHull,
    showStats,
    showBlurb,
    statColumns,
    statRows,
    cellWidth,
  };
}

/**
 * The rect of the `index`th stat cell inside a tile's grid — reading order is
 * `./lobby`'s own stat order, across a row then down, the same discipline
 * {@link placeTiles} uses for the tiles themselves.
 *
 * The view calls this rather than doing the arithmetic itself, so "no cell ever
 * escapes its tile" is asserted once, here, instead of per drawing site.
 */
export function classStatCell(content: ClassTileContent, index: number): Rect {
  const i = Math.max(0, Math.floor(index));
  const column = i % content.statColumns;
  const row = Math.floor(i / content.statColumns);
  return {
    x: content.stats.x + column * (content.cellWidth + STAT_CELL_GAP),
    y: content.stats.y + row * (STAT_ROW_HEIGHT + STAT_ROW_GAP),
    width: content.cellWidth,
    height: STAT_ROW_HEIGHT,
  };
}

/**
 * Lay the four arena cards out inside `band`: a single row of four where each
 * card is wide enough to read (desktop, phone-landscape, most portraits), a 2×2
 * only on the narrowest portrait windows (all behind the ROTATE overlay). Cards
 * are *capped* in width and *centred*, so the block never escapes the band —
 * the same discipline {@link placeTiles} keeps. Returns the column count.
 */
function placeMaps(out: Rect[], band: Rect): number {
  const n = LOBBY_MAP_COUNT;
  if (band.width <= 0 || band.height <= 0) {
    for (let i = 0; i < n; i++) out.push({ x: band.x, y: band.y, width: 0, height: 0 });
    return 0;
  }
  const rowWidth = (band.width - (n - 1) * ROW_GAP) / n;
  const columns = rowWidth >= LOBBY_MAP_MIN_WIDTH ? n : 2;
  const rows = Math.ceil(n / columns);
  const cardWidth = Math.min((band.width - (columns - 1) * ROW_GAP) / columns, LOBBY_MAP_CARD_MAX_WIDTH);
  const cardHeight = Math.min(rowHeight(band.height, rows, ROW_GAP, LOBBY_MAP_ROW_MAX), band.height);
  const blockWidth = columns * cardWidth + (columns - 1) * ROW_GAP;
  const blockHeight = rows * cardHeight + (rows - 1) * ROW_GAP;
  const originX = band.x + Math.max(0, (band.width - blockWidth) / 2);
  const originY = band.y + Math.max(0, (band.height - blockHeight) / 2);
  for (let i = 0; i < n; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    out.push({
      x: originX + column * (cardWidth + ROW_GAP),
      y: originY + row * (cardHeight + ROW_GAP),
      width: cardWidth,
      height: cardHeight,
    });
  }
  return columns;
}

/** The height of one of `count` equal rows in a band, capped at `max`. The
 *  band's leftover height is simply not used — capping rather than stretching
 *  is why no row can run past the bottom of the band it was given. */
function rowHeight(bandHeight: number, count: number, gap: number, max: number): number {
  const available = Math.max(0, bandHeight - (count - 1) * gap);
  return Math.min(max, available / count);
}

function hit(rect: Rect, x: number, y: number): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

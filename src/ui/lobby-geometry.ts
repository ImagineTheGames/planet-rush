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
import {
  COLUMN,
  ROSTER,
  TOUCH_MIN,
  plateHeight,
  rosterRowHeight,
  rowHeight as plateRowHeight,
  valueChipHeight,
} from '../art/materials';
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
 *  heights and every tile drew its stats through its hull nickname.
 *  **Re-measured against the real face when u14-01 shipped it: 14 exactly.** It
 *  had been right about Audiowide all along and wrong about what was on screen —
 *  the page was drawing Trebuchet 12, whose box is 15, so this line was one pixel
 *  short of what it was actually rendering for four days. */
export const CLASS_NAME_LINE = 14;
/** The hull-nickname line (Oxanium 9, measured box 12 — confirmed on the real
 *  face by u14-01; the fallback it was really drawing was 10). */
export const CLASS_HULL_LINE = 12;
/** The role blurb — two wrapped Oxanium-10 lines. */
export const CLASS_BLURB_LINE = 22;

/** Stats on a tile — GDD §2.11's six table columns (`./lobby` STAT_SPECS,
 *  asserted equal in the tests). Mirrored rather than imported so the geometry
 *  stays free of the model, exactly like {@link LOBBY_SLOT_ROWS}. */
export const STAT_COUNT = 6;
/**
 * One stat cell: its figure on a text line, its pip bar directly beneath.
 *
 * **12, RE-MEASURED ON THE FACE THE GAME NOW ACTUALLY DRAWS (u14-01).** It was
 * 10, annotated "Oxanium 8, measured box 10" — but the page had no `@font-face`
 * and no font file, so the figure was really being drawn in Liberation Mono,
 * whose box at 9px *is* 10. The number described the fallback and credited the
 * ratified face. The moment the real Oxanium loaded, every stat cell on every
 * hull tile drew its pip bar through the bottom of its own figure — visible on
 * `phone-landscape-ship-select` and `desktop-lobby`, all six cells, all four
 * hulls.
 *
 * Oxanium 9 measures ascent 10 / descent 2 = **box 12** by Pixi's own
 * `CanvasTextMetrics.measureFont` (`actualBoundingBox` of `|ÉqÅM`), against
 * Liberation Mono 9's 8 / 2 = 10. `class-tile-view` puts the bar at
 * `box.y + STAT_ROW_TEXT`, so 10 landed it exactly on the baseline. 12 clears the
 * descender, and because a stat figure (`SPD 100%`) has no descenders it reads as
 * the same 2px of air the fallback used to give. At the floor size (`STAT_MIN_PX`
 * 8, box 10) it is 4px, which is air rather than a collision.
 *
 * The brief's rule, applied: **the fix is the type metric, not the assertion.**
 */
export const STAT_ROW_TEXT = 12;
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
// The arena row is GONE from this file (u10-01)
// ---------------------------------------------------------------------------
//
// It lived here from p2 (the arena picker moved off the PLAY flow into the
// lobby) through u7-03 (it moved into the bottom of the ship-select column) and
// a0-12 (four maps became six, and its gutter compressed to two pixels because
// there was nothing left to give). The developer, 2026-08-07, looking at the
// result: *"we should only show 1 ship and 1 map in lobby because it's too
// cluttered now"*.
//
// So the six cards moved to a screen of their own ({@link ./map-select}), which
// lays them out through the picker's own `mapPickerLayout` — the layout that was
// written for exactly this job, before the row was ever squeezed into a lobby
// column. Everything a0-12's note defended (six cards, the thumb floor, the fold)
// is defended there, in a band the width of the whole screen, where the numbers
// are no longer tight: the constant that recorded "a SEVENTH map cannot join this
// row" is retired with the row it was about.
//
// What is left in this file is the ONE arena card the lobby still shows — the
// pick — and it is dimensioned with the ship card beside it, below.

// ---------------------------------------------------------------------------
// The lobby's TWO summary cards (u10-01) — one hull, one arena, each a control
// that opens the screen it was picked on
//
// The developer, 2026-08-07, over a screenshot of the live lobby: *"in the lobby
// page select ship and select map need to open different pages, we should only
// show 1 ship and 1 map in lobby because it's too cluttered now"*. So the four
// hull tiles and the six arena cards leave this file's LOBBY layout entirely —
// they are laid out by `./ship-select` and `./map-select` now, through the same
// two placement helpers ({@link placeClassTiles}, {@link placeMapCards}), which
// is why those are exported rather than copied.
//
// What is left here is two blocks in the ship-select column, each an EYEBROW over
// a CARD:
//
//     SHIP · TAP TO CHANGE          <- the eyebrow strip: says what it opens
//     ┌────────────────────────┐
//     │ VANGUARD  Anvil        │    <- the card: the pick, drawn by the same
//     │ SPD 100% ACC 100% …    │       renderer the picker screen uses
//     └────────────────────────┘
//
// The pair is ONE hit target ({@link LobbyLayout.shipPick}): a caption that says
// "tap to change" and is not itself tappable is a smaller control than it looks,
// and this screen's whole rule is that a control looks like what it does.
// ---------------------------------------------------------------------------

/**
 * The eyebrow strip over each summary card — `SHIP · TAP TO CHANGE`.
 *
 * Reference px, scaled with the frame. Sized for one line of the eyebrow type
 * (12px at reference, `./lobby-view` `EYEBROW_PX`) with a little air: this strip is
 * what turns a card from a label into a control, so it is drawn on every viewport
 * the band can spare it on and dropped whole — never clipped — below that.
 */
export const PICK_LABEL_HEIGHT = 18;

/**
 * The tallest a summary card grows.
 *
 * The four-tile block was capped at {@link CLASS_TILE_MAX} because four of them
 * shared a column. One does not — but "not competing" is not the same as "take the
 * column": a card allowed to fill a desktop's right column reads as a banner rather
 * than as the current pick, and the first cut of this (160) drew the hull card's
 * name, stats and two-line blurb across its top two-thirds with a hand's width of
 * empty plate under them.
 *
 * 124 is what the CONTENT wants, measured off `classTileContent`'s own ladder: the
 * 3px pad, the 14px name line, the 12px hull line, the 13px stat row with its air,
 * a two-line blurb, and the pad again. Above that a card gains dead metal, not
 * information. The leftover column height becomes AIR between the two blocks —
 * which is what the Gantry material wants anyway — rather than being spent
 * stretching either of them.
 */
export const PICK_CARD_MAX_HEIGHT = 124;

/**
 * Below this block width the two cards stop sitting side by side and stack.
 *
 * It is {@link CLASS_TILE_MIN_WIDTH} — a hull card narrower than that cannot carry
 * its name over a wrapped blurb, which is the same bound the four-tile block used
 * and for the same reason. Side by side is preferred wherever it holds, because
 * the height it gives back goes to the roster, which is what the developer's report
 * is ultimately about.
 */
export const PICK_CARD_MIN_WIDTH = CLASS_TILE_MIN_WIDTH;

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
 * width: `bar | STATE | body | team chip | tier chip | ?` (a0-06 added the last
 * one and made the tier chip read-only; neither moved anything ahead of them).
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
 * …and the narrowest the tier chip is allowed to become before the row gives up
 * something else instead *(a0-06)*.
 *
 * It has a floor and no drop rung, unlike every other segment on this row: GDD
 * §2.1 promises the tier is *shown* now, so a row that dropped it would be a row
 * that stopped keeping a design rule rather than one that ran out of pixels. 40 is
 * `HARD` and `EASY` at full size with the row's own padding; `MEDIUM`, the one
 * word longer than the chip at this width, is auto-fitted down — the same ladder
 * the side chip already keeps at ITS floor (`../ui/lobby-view` `drawTeamChip`:
 * "below that the word is auto-fitted down, never up"). It is a value, not a
 * control, so a shrunk word costs a read rather than a target.
 */
export const SEAT_CHIP_MIN = 40;

/**
 * Width of a roster row's trailing **`?` control** — the codex dossier for the
 * character in that seat *(a0-06, 2026-08-07; developer: "there is a ? question
 * mark icon that you can press to show a tooltip with the codex entry about that
 * bot")*.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A CONTROL AND NOT A HOVER
 * ---------------------------------------------------------------------------
 * The lobby has shown a codex hint on a bot row since c1 — on a desktop **hover**
 * and a touch **long-press**. A hover is not an affordance: nothing on the row
 * said it was there, and a hover-only feature is a desktop-only feature, which
 * the ratified input-parity principle (GDD §2.4, `docs/input-parity.md`) does not
 * allow. The `?` is the same content reached by a plain **tap**, on the one
 * screen the game is landscape-locked on a phone for. The hover and long-press
 * are kept: they are now shortcuts to a thing that is also advertised, which is
 * the u5 lesson about the state control applied to the row's other half.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COSTS, AND THE ORDER A NARROWING ROW GIVES THINGS UP IN
 * ---------------------------------------------------------------------------
 * It is the row's *fifth* segment (`bar | STATE | body | team | tier | ?`) and it
 * is deliberately the narrowest: one glyph, no word, so 36 rather than the tier
 * chip's 54. A fifth segment on a row that was already tight is a real cost, and
 * the first cut of it was paid for by the wrong thing — the side chip fell off the
 * notched landscape phone entirely, which is a ratified mechanic (m10, u3: the
 * developer played a Teams match they could not read sides in). So the order is
 * stated once, here, and {@link seatTrailing} is the only place it is applied:
 *
 *  1. **The `?` shrinks, then drops.** Its dossier is still reachable by a
 *     long-press on the row, which shipped in c1 and is unchanged; the tier and
 *     the side are reachable no other way. It goes first for that reason alone.
 *  2. **The tier chip shrinks to {@link SEAT_CHIP_MIN}** and never drops — GDD
 *     §2.1 promises the difficulty is shown.
 *  3. **The side chip keeps {@link SEAT_TEAM_CHIP_MIN}**, below which it was
 *     already dropped whole (u3), and the row **body keeps
 *     {@link SEAT_ROW_BODY_MIN}** absolutely (u7-03). Neither is ever spent to
 *     buy a `?`.
 *
 * Below {@link SEAT_HELP_MIN} the `?` is dropped whole rather than drawn as a
 * clipped stub — the same rung {@link SEAT_STATE_MIN} and {@link SEAT_TEAM_CHIP_MIN}
 * keep, and the reason the long-press fallback above is stated rather than assumed.
 */
export const SEAT_HELP_WIDTH = 36;
/** …and the narrowest one that is still a thumbable glyph rather than a smudge.
 *  24 is what lets the notched landscape phone — the tightest row QA's matrix
 *  produces, ~205px — carry the `?` at all; the row is full-height, so the target
 *  is 24 × the row's 48+, not 24 square. */
export const SEAT_HELP_MIN = 24;
/** …never more than this share of a narrow row. Small, because it is one glyph. */
export const SEAT_HELP_MAX_FRACTION = 0.14;
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
  (SEAT_STRIPE +
    SEAT_ROW_BODY_MIN +
    SEAT_TEAM_CHIP_WIDTH +
    SEAT_CHIP_WIDTH +
    SEAT_HELP_WIDTH +
    3 * SEAT_CHIP_PAD) /
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
//    its height is `plateHeight(scale, metrics)`: a hero plate for SOLO and
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
// The JOIN screen's two modes (u17-01) — BROWSE and ENTER ROOM CODE
// ---------------------------------------------------------------------------

/**
 * The mode switch's segment width, at the reference. Two of them plus a row gap
 * lead the band's top strip on **both** modes, at the same place in each, so the
 * switch never moves as the screen changes under it — the promise BACK already
 * makes one beam lower down.
 *
 * ── WHY THE SWITCH SHARES A ROW RATHER THAN TAKING ONE ──────────────────────
 * Measured before it was built, at the developer's own 844×390: the join screen's
 * band is 221 px, the keypad's floor is 148 px of that (four rows at
 * {@link KEY_MIN}), and the code cells take what is left. A switch on a row of its
 * own would cost 48 px + a gutter and leave the cells **2 px** — a code you cannot
 * see yourself typing, which `placeCodeEntry` already names as the thing worse
 * than small keys. So the switch takes the LEADING end of the row the cells are
 * already on, the cells take the rest of it, and the pad below is untouched. At
 * that profile the cells go 61 px → 48 and the keys go 34 px → 37: the code screen
 * comes out with *bigger* keys than before this brief.
 *
 * A band too narrow to seat the switch and four legible cells side by side falls
 * back to stacking them — see {@link JOIN_SWITCH_MIN_CELLS}. That is the tall,
 * narrow viewport, which has the height to spare precisely because it is tall.
 */
export const JOIN_SEGMENT_WIDTH = 168;

/** …and the floor a segment may be squeezed to before the pair stops being drawn
 *  as two words a thumb can pick between. */
export const JOIN_SEGMENT_MIN = 88;

/** The narrowest the four code cells may be squeezed to while sharing their row
 *  with the switch. Below this the switch takes a row of its own instead. */
export const JOIN_SWITCH_MIN_CELLS = 34;

/** A browse row's JOIN button, at the reference — the developer's *"there should
 *  be a join button to join it"*, sized as a chip rather than a plate so the list
 *  never grows a second bright action per room (`./gantry` `singlePrimary`). */
export const BROWSE_JOIN_WIDTH = 104;

/** …and the least of it that survives a squeeze. Below this the row draws the
 *  word alone; it is still the row's own target, which is the whole row. */
export const BROWSE_JOIN_MIN = 56;

/**
 * The narrowest a browse row may be drawn at before two columns of them stop
 * being better than one. A row carries an owner tag, a player/seat line, a place
 * and a ping, and a button — halve the band below this and none of it reads.
 */
export const BROWSE_ROW_MIN_WIDTH = 300;

/**
 * Rows below which a single column is not worth keeping on a wide, short band.
 * At 844×390 one column shows **three** of the fleet's twelve possible rooms and
 * the band is 800 px wide with nothing in the other 400 — so the same trade the
 * doors and the roster already make (halve it, fill column-major) doubles what the
 * player can see without shrinking anything they read.
 */
export const BROWSE_COLUMN_THRESHOLD = 4;

/** The most rows the screen will lay out, however tall the band is. The deployed
 *  fleet's ceiling is 12 rooms (`docs/server-capacity.md`), and a list longer than
 *  the fleet can be is rects nobody will ever draw into. */
export const BROWSE_ROW_CAP = 12;

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
  /** Each roster row's trailing DIFFICULTY chip. **Read-only since a0-06** — the
   *  tier is the character's, shown beside the name rather than chosen (GDD §2.1
   *  amended 2026-08-07), so this rect is a place to draw and no longer a target
   *  the hit-test registers. Aligned to `seats`. */
  readonly seatChips: readonly Rect[];
  /** Each roster row's TEAM chip (TEAMS) — the side cycle, composed immediately
   *  left of the difficulty chip and kept clear of the row's body ({@link
   *  seatBodyEnd}). Aligned to `seats`; zero-extent below
   *  {@link SEAT_TEAM_CHIP_MIN}, which no row the roster splits into reaches. */
  readonly seatTeamChips: readonly Rect[];
  /** Each roster row's trailing **`?` control** — the codex dossier for that seat's
   *  character (a0-06). The far-right segment; zero-extent on a row too narrow to
   *  carry a legible glyph, where the long-press shortcut still reaches the same
   *  dossier. Aligned to `seats`. */
  readonly seatHelp: readonly Rect[];
  /** The MODE toggle (FFA / TEAMS), top-left of the roster (variable-slots E). */
  readonly modeToggle: Rect;
  /** The ABUNDANCE toggle (SCARCE / STANDARD / RICH), top-right of the roster. */
  readonly abundance: Rect;
  /**
   * **The SHIP block — eyebrow plus card — and the whole of it is the hit target**
   * that opens SHIP SELECT (u10-01). One block, because the lobby shows one hull:
   * the pick.
   */
  readonly shipPick: Rect;
  /** The eyebrow strip inside {@link shipPick} — `SHIP · TAP TO CHANGE`.
   *  Zero-extent on a block too short to carry it, where the card takes the lot. */
  readonly shipLabel: Rect;
  /** …and the card itself, the rect `classTileContent` is measured against — the
   *  same renderer SHIP SELECT draws its four tiles with. */
  readonly shipCard: Rect;
  /** The ARENA block, its eyebrow and its card — the twin of the three above, and
   *  the target that opens MAP SELECT. */
  readonly mapPick: Rect;
  readonly mapLabel: Rect;
  readonly mapCard: Rect;
  /** RUSH! / the countdown. */
  readonly rushButton: Rect;
  /** Whether this layout was built at thumb scale. */
  readonly isTouch: boolean;
  /** Whether the roster and the two picks sit side by side. */
  readonly twoColumn: boolean;
  /** Roster columns — 2 where one column of eight would fall under the thumb
   *  floor and the column is wide enough to halve ({@link placeSeats}). Seats
   *  fill column-major, so slot order still reads top-to-bottom. */
  readonly seatColumns: number;
  /** Whether the two summary cards sit side by side (`true`) or stacked. Side by
   *  side wherever the block is wide enough ({@link PICK_CARD_MIN_WIDTH}), because
   *  the height it gives back goes to the roster. */
  readonly pickRow: boolean;
}

/** What a tap landed on. Index-based, so the geometry never has to know what a
 *  seat or a hull *is* — the caller maps an index through the model's own order
 *  (`./lobby` CLASS_ORDER / seat slots), and the two can't drift. */
export type LobbyTarget =
  /** BACK — leaves the lobby for the main menu (u2 menu-back), the exit every
   *  screen carries. The footer beam's left-hand plate since u7-03. */
  | { readonly kind: 'leave' }
  /**
   * The row body — **the seat's CHARACTER cycle since a0-06**, and its
   * OPEN/BOT/CLOSED cycle before that.
   *
   * The body is where the row draws the character's NAME, so the tap that lands
   * on a name is the tap that changes it: the most direct mapping this row can
   * have, and the "existing tap-to-cycle gesture" the brief asks the character to
   * inherit (*"cycling seven names is the same gesture as cycling three tiers"*).
   * The state cycle did not lose a control for it — it has kept its own drawn,
   * labelled, leading one since u5, which is the discoverable one the developer
   * asked for and the reason the body was free to be re-pointed.
   *
   * A **closed** row is the exception, and it is a rule rather than a special
   * case: the body edits whatever the row is showing, and a closed row shows `OUT
   * OF THE MATCH` and no character, so a tap there re-opens the seat. Nothing that
   * worked on a shut door stopped working.
   */
  | { readonly kind: 'seat'; readonly index: number }
  /** The row's LEADING STATE control — the same OPEN/BOT/CLOSED cycle as the row
   *  body, drawn and named (u5). A distinct target rather than a second `seat`
   *  rect so the flow, the seam and the tests can talk about the *control* rather
   *  than about the row that happens to contain it. */
  | { readonly kind: 'seatState'; readonly index: number }
  /** The row's trailing **`?` control** — opens the codex dossier for that seat's
   *  character (a0-06). A tap, on every device: the hover and the long-press that
   *  reach the same hint are shortcuts, not the affordance (GDD §2.4 parity). */
  | { readonly kind: 'seatHelp'; readonly index: number }
  /** The row's TEAM chip — the side cycle, TEAMS only (n2). Laid out in FFA too
   *  (geometry stays mode-blind), where a tap on it is a model no-op. */
  | { readonly kind: 'seatTeamChip'; readonly index: number }
  /** The MODE toggle (variable-slots E). */
  | { readonly kind: 'mode' }
  /** The ABUNDANCE toggle (variable-slots E). */
  | { readonly kind: 'abundance' }
  /**
   * **The ship card — opens SHIP SELECT** (u10-01). It is not a pick: the lobby
   * shows one hull and there is nothing to choose between here, so the only thing
   * a press on it can mean is "show me the four". The pick itself is a
   * {@link ./ship-select} `ShipSelectTarget` on the screen this opens.
   */
  | { readonly kind: 'shipCard' }
  /** **The arena card — opens MAP SELECT.** Open to a guest as well as the host:
   *  the screen refuses the *pick*, never the *look* (`./lobby` `openMapSelect`). */
  | { readonly kind: 'mapCard' }
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
  let rosterBox: Rect;
  let shipColumn: Rect;
  let separator: Rect;
  let picks: PickBlocks;

  if (twoColumn) {
    // Roster left, the two summary cards right, **both spanning the whole band** —
    // the handoff's rule, and the reason the roster can hand every row a thumb.
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
    // **Stacked, always, in the two-column shape.** The picks column here is tall
    // and narrow (40% of the band, the full height of it), so halving its width
    // costs the ship card the thing this brief gave it: a 470px card lays GDD
    // §2.11's six stats out as one table-like row, and a 231px one folds them to
    // 3×2 — which is the phone layout, on a desktop, for no gain. Height is the
    // axis this column has to spare.
    picks = placePicks(shipColumn, metrics, false);
  } else {
    // One column: the roster, then the two summary cards under it.
    //
    // The roster asks for what eight thumb-sized rows and the strip above them
    // actually need, and is refused only by what the two cards must keep. Since
    // u10-01 that is **one** card's floor rather than two rows of tiles plus an
    // arena row — the whole of the breathing room the developer's report asks for,
    // handed to the list that had none.
    // The floor is computed for the arrangement the cards will REALLY take, not
    // for the best case: a band too narrow to halve stacks them, and a stacked pair
    // needs twice the height. Guessing the row here is how a 320px window ended up
    // reserving one block's worth of height for two.
    const row = pickRowFits(band.width, metrics);
    const blocks = row ? 1 : 2;
    const label = scaled(PICK_LABEL_HEIGHT, metrics);
    const picksFloor = Math.min(
      blocks * (CLASS_TILE_MIN + label) + (blocks - 1) * gap + BLOCK_GAP,
      band.height,
    );
    const rosterHeight = Math.max(0, Math.min(rosterWantedHeight(metrics), band.height - picksFloor));
    const picksY = band.y + rosterHeight + (rosterHeight > 0 ? BLOCK_GAP : 0);
    rosterBox = { x: band.x, y: band.y, width: band.width, height: rosterHeight };
    shipColumn = {
      x: band.x,
      y: picksY,
      width: band.width,
      height: Math.max(0, band.y + band.height - picksY),
    };
    separator = { x: band.x, y: band.y, width: 0, height: 0 };
    // **A row where it fits, in the one-column shape.** Here the block is wide and
    // short — the opposite of the two-column column — so width is what there is to
    // spend, and every pixel a row saves vertically goes to the roster, which is
    // the block the developer's report is ultimately about.
    picks = placePicks(shipColumn, metrics, true);
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
  // The three trailing segments are placed together, because they compete for one
  // budget and placing them separately is how the side chip fell off the notched
  // landscape phone (a0-06; {@link seatTrailing}).
  const trailing = seats.map((rect, i) => seatTrailing(rect, seatStates[i]!));
  const seatHelp = trailing.map((t) => t.help);
  const seatChips = trailing.map((t) => t.tier);
  const seatTeamChips = trailing.map((t) => t.team);

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
    seatHelp,
    modeToggle: controls.modeToggle,
    abundance: controls.abundance,
    shipPick: picks.shipPick,
    shipLabel: picks.shipLabel,
    shipCard: picks.shipCard,
    mapPick: picks.mapPick,
    mapLabel: picks.mapLabel,
    mapCard: picks.mapCard,
    rushButton,
    isTouch,
    twoColumn,
    seatColumns,
    pickRow: picks.pickRow,
  };
}

/**
 * Whether a block of `width` can be halved into two summary cards that still read
 * — {@link PICK_CARD_MIN_WIDTH} each, which is the width below which a hull card
 * cannot carry its name over a wrapped blurb.
 *
 * It is a named predicate rather than an inline comparison because **two places
 * have to agree about it**: the one-column branch reserves the picks' height
 * before they are placed, and that reservation is twice as large for a stacked
 * pair. The first cut inlined the test in `placePicks` alone, so a 320px window
 * reserved one block's worth of band and then stacked two blocks into it — 28px
 * cards, under every floor this file keeps.
 */
function pickRowFits(width: number, m: FrameMetrics): boolean {
  return (width - m.gap) / 2 >= PICK_CARD_MIN_WIDTH;
}

/** The six rects {@link placePicks} returns, plus the arrangement it settled on. */
interface PickBlocks {
  readonly shipPick: Rect;
  readonly shipLabel: Rect;
  readonly shipCard: Rect;
  readonly mapPick: Rect;
  readonly mapLabel: Rect;
  readonly mapCard: Rect;
  readonly pickRow: boolean;
}

/**
 * Divide the ship-select column between the **two summary cards** (u10-01): the
 * hull this client is flying and the arena this room is on.
 *
 * Side by side wherever both halves clear {@link PICK_CARD_MIN_WIDTH}, stacked
 * otherwise. The preference runs that way round because the height a row gives
 * back goes to the roster — which is what the developer's report is ultimately
 * about — and because two cards are the only things left competing for this
 * column, so there is no third block a wrong guess here could squeeze.
 *
 * Each block is an eyebrow strip over a card, and the block is **capped, then
 * centred** in the column: a card allowed to stretch to a desktop column's full
 * height reads as a banner rather than as the current pick.
 */
function placePicks(column: Rect, m: FrameMetrics, preferRow: boolean): PickBlocks {
  if (column.width <= 0 || column.height <= 0) {
    const empty: Rect = { x: column.x, y: column.y, width: 0, height: 0 };
    return {
      shipPick: empty,
      shipLabel: empty,
      shipCard: empty,
      mapPick: empty,
      mapLabel: empty,
      mapCard: empty,
      pickRow: false,
    };
  }

  const gap = m.gap;
  const rowWidth = (column.width - gap) / 2;
  const pickRow = preferRow && pickRowFits(column.width, m);
  const blockWidth = pickRow ? rowWidth : column.width;
  // Stacked, the two blocks split the column's height; in a row they each take all
  // of it. Capped either way, so a tall column leaves air rather than banners.
  const wanted = pickRow ? column.height : (column.height - gap) / 2;
  const blockHeight = Math.max(0, Math.min(wanted, PICK_CARD_MAX_HEIGHT + scaled(PICK_LABEL_HEIGHT, m)));
  const usedHeight = pickRow ? blockHeight : blockHeight * 2 + gap;
  const originY = column.y + Math.max(0, (column.height - usedHeight) / 2);

  const shipPick: Rect = { x: column.x, y: originY, width: blockWidth, height: blockHeight };
  const mapPick: Rect = pickRow
    ? { x: column.x + blockWidth + gap, y: originY, width: blockWidth, height: blockHeight }
    : { x: column.x, y: originY + blockHeight + gap, width: blockWidth, height: blockHeight };

  const ship = splitPick(shipPick, m);
  const map = splitPick(mapPick, m);
  return {
    shipPick,
    shipLabel: ship.label,
    shipCard: ship.card,
    mapPick,
    mapLabel: map.label,
    mapCard: map.card,
    pickRow,
  };
}

/**
 * One summary block, split into its eyebrow and its card.
 *
 * The eyebrow is what makes the card read as a control rather than a label
 * (*"each reads as a control that opens something — not as a dead label"*), so it
 * is drawn wherever the block can spare it — and **dropped whole** below that,
 * never clipped, the ladder every block on this screen keeps. A block that has lost
 * its eyebrow is still a thumb-sized target: the whole block is the hit rect
 * ({@link lobbyHitTest}), eyebrow or no eyebrow.
 */
function splitPick(block: Rect, m: FrameMetrics): { label: Rect; card: Rect } {
  const wanted = scaled(PICK_LABEL_HEIGHT, m);
  // The eyebrow may never cost the card its thumb floor: below that the strip goes
  // and the card takes the whole block.
  const labelHeight = block.height - wanted >= TOUCH_MIN ? wanted : 0;
  return {
    label: { x: block.x, y: block.y, width: block.width, height: labelHeight },
    card: {
      x: block.x,
      y: block.y + labelHeight,
      width: block.width,
      height: Math.max(0, block.height - labelHeight),
    },
  };
}

/** One of this file's reference metrics at the frame's plate scale — the widths
 *  that hold display type and therefore shrink with it. The roster's own segment
 *  widths deliberately do NOT (`../art/materials` `ROSTER`). */
function scaled(referencePx: number, m: FrameMetrics): number {
  return Math.max(0, Math.round(referencePx * m.plateScale));
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
/**
 * The whole trailing group of one roster row, placed in one pass: the `?`, the
 * tier chip, and the side chip, right to left *(a0-06)*.
 *
 * It is one function because they compete for one budget, and the first cut of
 * the `?` proved what happens when three functions each hold their own opinion
 * about how much room is left: the `?` took its 32px off the far right, the tier
 * chip measured from *its* left edge, and the side chip — measured last, from what
 * those two had already spent — fell to zero on the notched landscape phone. That
 * is a ratified mechanic silently disappearing to buy a new affordance, which is
 * the trade this file exists to make impossible.
 *
 * So the order of surrender is applied here and stated at {@link SEAT_HELP_WIDTH}:
 * the `?` shrinks and then drops, the tier chip shrinks to {@link SEAT_CHIP_MIN}
 * and never drops, and the side chip's {@link SEAT_TEAM_CHIP_MIN} and the body's
 * {@link SEAT_ROW_BODY_MIN} are never spent at all.
 */
function seatTrailing(seat: Rect, state: Rect): { help: Rect; tier: Rect; team: Rect } {
  const empty: Rect = { x: seat.x, y: seat.y, width: 0, height: 0 };
  if (seat.width <= 0 || seat.height <= 0) return { help: empty, tier: empty, team: empty };

  // Everything after the identity bar, the state control and the row body's own
  // absolute minimum. This is the budget; nothing below may exceed it.
  const room = seat.x + seat.width - seatBodyEnd(seat, state);

  let tier = Math.max(0, Math.min(SEAT_CHIP_WIDTH, seat.width * SEAT_CHIP_MAX_FRACTION - SEAT_CHIP_PAD));
  let help = Math.min(SEAT_HELP_WIDTH, seat.width * SEAT_HELP_MAX_FRACTION);
  if (help < SEAT_HELP_MIN) help = 0;

  /** What the side chip would be left with, given the two widths above. */
  const sideRoom = (): number =>
    room - tier - SEAT_CHIP_PAD - (help > 0 ? help + SEAT_CHIP_PAD : 0);

  const tierWant = tier;
  // 1. The `?` gives way first, shrinking toward its floor.
  if (sideRoom() < SEAT_TEAM_CHIP_MIN && help > 0) {
    help = Math.min(help, room - tier - 2 * SEAT_CHIP_PAD - SEAT_TEAM_CHIP_MIN);
  }
  // 2. Before the `?` is DROPPED, the tier chip shrinks toward its own floor to buy
  //    it back — a control that is gone is worse than a value whose word is fitted
  //    down, and the tier is a value.
  if (help > 0 && help < SEAT_HELP_MIN) {
    tier = Math.max(
      SEAT_CHIP_MIN,
      Math.min(tier, room - 2 * SEAT_CHIP_PAD - SEAT_HELP_MIN - SEAT_TEAM_CHIP_MIN),
    );
    help = Math.min(SEAT_HELP_WIDTH, room - tier - 2 * SEAT_CHIP_PAD - SEAT_TEAM_CHIP_MIN);
  }
  // 3. Only then is it dropped whole — and the tier takes its width back, because
  //    the row it was shrunk for is no longer being drawn. A row this narrow is
  //    below anything QA's matrix produces, and the dossier is the only one of the
  //    three with a second way in (the long-press).
  if (help < SEAT_HELP_MIN) {
    help = 0;
    tier = Math.max(SEAT_CHIP_MIN, Math.min(tierWant, room - SEAT_CHIP_PAD - SEAT_TEAM_CHIP_MIN));
  }
  tier = Math.max(0, Math.min(tier, room));

  const helpRect: Rect =
    help > 0
      ? { x: seat.x + seat.width - help, y: seat.y, width: help, height: seat.height }
      : empty;
  const tierRight = help > 0 ? helpRect.x - SEAT_CHIP_PAD : seat.x + seat.width;
  const tierRect: Rect =
    tier > 0 ? { x: tierRight - tier, y: seat.y, width: tier, height: seat.height } : empty;
  return { help: helpRect, tier: tierRect, team: teamChipRect(seat, tierRect, state) };
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
  // The two summary blocks (u10-01). The EYEBROW is inside the target, not beside
  // it: a caption reading `TAP TO CHANGE` that is not itself tappable would be a
  // control smaller than it looks, on the screen whose one rule is that a control
  // looks like what it does.
  if (hit(layout.shipPick, x, y)) return { kind: 'shipCard' };
  if (hit(layout.mapPick, x, y)) return { kind: 'mapCard' };
  // The MODE / ABUNDANCE toggles (variable-slots E) — above the roster rows.
  if (hit(layout.modeToggle, x, y)) return { kind: 'mode' };
  if (hit(layout.abundance, x, y)) return { kind: 'abundance' };
  for (let i = 0; i < layout.seats.length; i++) {
    // A row's own controls win over its body: the LEADING state control names and
    // cycles OPEN/BOT/CLOSED (u5), the trailing `?` opens the seat's codex dossier
    // (a0-06), and the team chip cycles the side (TEAMS); a tap anywhere else on
    // the row cycles the seat's CHARACTER. All three sit at the row's leading edge
    // and strictly right of its centre respectively, so the BODY between them —
    // what the hit-test contract taps — is never one of them.
    const stateControl = layout.seatStates[i];
    if (stateControl && hit(stateControl, x, y)) return { kind: 'seatState', index: i };
    const help = layout.seatHelp[i];
    if (help && hit(help, x, y)) return { kind: 'seatHelp', index: i };
    const teamChip = layout.seatTeamChips[i];
    if (teamChip && hit(teamChip, x, y)) return { kind: 'seatTeamChip', index: i };
    // The tier chip is NOT a target (a0-06): the difficulty is shown, not chosen,
    // so a tap that lands on it falls through to the row body's character cycle
    // rather than to a control that would have to refuse.
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

/**
 * How the JOIN screen's mode switch was seated (u17-01):
 *
 *  - `inline`  — sharing the top strip with the code cells beside it. Every
 *                landscape shape, including the developer's 390 px phone, and the
 *                one that costs the keypad nothing.
 *  - `stacked` — a row of its own above them, taken only where the band is too
 *                narrow to carry the switch and four readable cells side by side.
 *                That band is a TALL one by construction, so the height it spends
 *                here is height it had.
 */
export type JoinSwitchShape = 'inline' | 'stacked';

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
  /** The four code cells, left to right. Join screen, CODE mode. */
  readonly cells: readonly Rect[];
  /** The keypad, in `KEYPAD_KEYS` order: across a row, then down. */
  readonly keys: readonly Rect[];
  /** The two mode segments — BROWSE, ENTER ROOM CODE — leading the join screen's
   *  top strip, in `./lobby-browser` `JOIN_MODES` order. Identical rects in both
   *  modes: the switch is the one control on this screen that is always true. */
  readonly segments: readonly Rect[];
  /** Whether the switch shares the code cells' row (the ordinary case) or took a
   *  row of its own because the band was too narrow to seat both. */
  readonly segmentShape: JoinSwitchShape;
  /** The list's rows, in model order — column-major when there are two columns,
   *  exactly as the doors and the roster fill. Join screen, BROWSE mode. */
  readonly browseRows: readonly Rect[];
  /** Each row's JOIN button, nested at its trailing edge. Same length as
   *  {@link browseRows}; the row itself is a target too (they are one action). */
  readonly browseJoins: readonly Rect[];
  /** The strip the age stamp is drawn in — the trailing end of the top strip, the
   *  space the code cells occupy in the other mode. */
  readonly browseStamp: Rect;
  /** The whole list area, for the empty-list sentence and for the view's clip. */
  readonly browseList: Rect;
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
  /** One of the JOIN screen's two modes, in `./lobby-browser` `JOIN_MODES` order
   *  (u17-01). Live on both modes — the switch is how you get back. */
  | { readonly kind: 'segment'; readonly index: number }
  /** A row in the lobby browser — its JOIN button or its body, which are ONE
   *  action: the button is what the developer asked for and the row is what a
   *  thumb actually lands on, and a list where those did two things would be a
   *  list that punishes the imprecise tap it is designed for. */
  | { readonly kind: 'row'; readonly index: number }
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
    case 'segment':
      return `segment:${target.index}`;
    case 'row':
      return `row:${target.index}`;
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

  // The JOIN screen's two modes share one band: the switch leads its top strip in
  // both, the code cells take the rest of that strip in CODE mode, and the list
  // takes everything under it in BROWSE mode. Both are laid out every time.
  const join = placeJoinModes(middle, m);

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    eyebrow,
    message,
    doors,
    doorShape,
    ...placeCodeEntry(middle, join.cellsRow),
    segments: join.segments,
    segmentShape: join.shape,
    browseRows: join.rows,
    browseJoins: join.joins,
    browseStamp: join.stamp,
    browseList: join.list,
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
  mode: 'browse' | 'code' = 'code',
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
  // The mode switch is tested first and on BOTH modes: it is the one control the
  // join screen carries in every state, and nothing else is drawn over it.
  for (let i = 0; i < layout.segments.length; i++) {
    const rect = layout.segments[i];
    if (rect && hit(rect, x, y)) return { kind: 'segment', index: i };
  }
  if (mode === 'browse') {
    // A row's JOIN button and its body are one target (see `EntryTarget`), so the
    // button is not tested separately — it is drawn inside the rect that already
    // answers. BACK is the only other live control: the browse screen has nothing
    // to erase and nothing to submit.
    for (let i = 0; i < layout.browseRows.length; i++) {
      const rect = layout.browseRows[i];
      if (rect && hit(rect, x, y)) return { kind: 'row', index: i };
    }
    if (hit(layout.back, x, y)) return { kind: 'back' };
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
 * SOLO is the hero, and it is the only one: it is the door that always works
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
function placeCodeEntry(band: Rect, cellsRow: Rect): { cells: Rect[]; keys: Rect[] } {
  const rows = Math.ceil(KEYPAD_KEY_COUNT / KEYPAD_COLUMNS);

  // What the pad would like, and what the band can actually give it.
  const keyWidth = Math.max(
    0,
    Math.min(KEY_MAX, (band.width - (KEYPAD_COLUMNS - 1) * KEY_GAP) / KEYPAD_COLUMNS),
  );
  // The cells fill the row the switch left them — square, so the row's height is
  // a ceiling as much as its width is. The caller sized that row against the pad's
  // floor (see `placeJoinModes`), which is what keeps the rule this function has
  // always kept: **the keys win and the cells give**, because a code cell that is
  // a little small is still readable while a key too small to hit reliably makes
  // the screen unusable (GDD §2.4).
  const cellsWanted = Math.min(CODE_CELL_MAX, (cellsRow.width - 3 * CODE_CELL_GAP) / 4);
  const cellSize = Math.max(0, Math.min(cellsWanted, cellsRow.height));
  // The pad starts under the ROW, not under the cells: the switch is as tall as
  // the row it leads, so a cell squeezed narrow by a short band must not slide the
  // keypad up under it.
  const padTop = cellsRow.y + cellsRow.height + (cellsRow.height > 0 ? BLOCK_GAP : 0);
  const padHeight = Math.max(0, band.y + band.height - padTop);
  const keyHeight = Math.max(0, Math.min(KEY_MAX, rowHeight(padHeight, rows, KEY_GAP, KEY_MAX)));

  const cells: Rect[] = [];
  const cellsWidth = 4 * cellSize + 3 * CODE_CELL_GAP;
  const cellsX = cellsRow.x + (cellsRow.width - cellsWidth) / 2;
  const cellsY = cellsRow.y + Math.max(0, (cellsRow.height - cellSize) / 2);
  for (let i = 0; i < 4; i++) {
    cells.push({
      x: cellsX + i * (cellSize + CODE_CELL_GAP),
      y: cellsY,
      width: cellSize,
      height: cellSize,
    });
  }

  const keys: Rect[] = [];
  const padWidth = KEYPAD_COLUMNS * keyWidth + (KEYPAD_COLUMNS - 1) * KEY_GAP;
  const padX = band.x + (band.width - padWidth) / 2;
  for (let i = 0; i < KEYPAD_KEY_COUNT; i++) {
    keys.push({
      x: padX + (i % KEYPAD_COLUMNS) * (keyWidth + KEY_GAP),
      y: padTop + Math.floor(i / KEYPAD_COLUMNS) * (keyHeight + KEY_GAP),
      width: keyWidth,
      height: keyHeight,
    });
  }
  return { cells, keys };
}

/**
 * The JOIN screen's two modes, laid out over one band (u17-01).
 *
 * The switch leads the band's top strip in BOTH modes and at the SAME rect, which
 * is the whole point: the developer's ruling is that both ways in are offered and
 * neither is buried, and a control that moves when you use it is buried in the
 * other direction. What sits beside it is the mode's business — the code cells in
 * CODE, the age stamp in BROWSE — and what sits under it is the keypad or the
 * list. Only one mode is ever drawn, so the two overlap by design, exactly as the
 * doors and the keypad already do.
 *
 * The rows fill **column-major** on a band wide enough to halve, like every other
 * list in this file ({@link placeSeats}, {@link placeDoors}): the sorted order
 * still reads top-to-bottom, so the nearest room is the top-left row in both
 * shapes.
 */
function placeJoinModes(
  band: Rect,
  m: FrameMetrics,
): {
  segments: Rect[];
  shape: JoinSwitchShape;
  cellsRow: Rect;
  stamp: Rect;
  list: Rect;
  rows: Rect[];
  joins: Rect[];
} {
  const stripHeight = Math.max(0, Math.min(band.height, valueChipHeight(m)));
  const segmentGap = m.rowGap;
  const segmentWidth = Math.max(
    0,
    Math.min(
      Math.round(JOIN_SEGMENT_WIDTH * m.plateScale),
      (band.width - segmentGap) / 2,
    ),
  );
  const switchWidth = segmentWidth > 0 ? 2 * segmentWidth + segmentGap : 0;
  const besideWidth = Math.max(0, band.width - switchWidth - m.gutter);
  // Four cells at their floor plus their gaps: the least the code row can be worth
  // drawing beside the switch. Under it, the switch takes a row of its own.
  const cellsFloor = 4 * JOIN_SWITCH_MIN_CELLS + 3 * CODE_CELL_GAP;
  const inline = segmentWidth >= JOIN_SEGMENT_MIN * m.plateScale && besideWidth >= cellsFloor;

  const segments: Rect[] = [];
  for (let i = 0; i < 2; i++) {
    segments.push({
      x: band.x + i * (segmentWidth + segmentGap),
      y: band.y,
      width: segmentWidth,
      height: stripHeight,
    });
  }

  const belowStrip = band.y + stripHeight + m.gutter;
  const remaining = Math.max(0, band.y + band.height - belowStrip);
  const padRows = Math.ceil(KEYPAD_KEY_COUNT / KEYPAD_COLUMNS);
  const padFloor = padRows * KEY_MIN + (padRows - 1) * KEY_GAP;

  const cellsRow: Rect = inline
    ? { x: band.x + switchWidth + m.gutter, y: band.y, width: besideWidth, height: stripHeight }
    : {
        x: band.x,
        y: belowStrip,
        width: band.width,
        // Stacked, the cells take their old share of what is left: capped by the
        // pad's floor first and by 40% of the band second, so a very short band
        // gives the cells up rather than the keys.
        height: Math.max(
          0,
          Math.min(CODE_CELL_MAX, remaining - padFloor - BLOCK_GAP, remaining * 0.4),
        ),
      };

  // The stamp shares the strip with the switch where there is room beside it, and
  // takes a line of its own where there is not — the stacked band is the tall one,
  // so the line it costs is a line it has. The age is never dropped: a listing
  // that cannot say how old it is has broken the one promise this screen makes.
  const stampInline: Rect = {
    x: band.x + switchWidth + m.gutter,
    y: band.y,
    width: besideWidth,
    height: stripHeight,
  };
  // A line of its own is still a line of TYPE, and type has a floor (`TYPE_MIN`,
  // 11px — below it an Oxanium eyebrow stops being small and starts being a
  // smudge). Scaling this one linearly would have drawn a 6px strip on a 390px-
  // wide viewport and clipped the very sentence that keeps the screen honest.
  const stampLineHeight = Math.max(0, Math.min(remaining, Math.max(14, Math.round(20 * m.scale))));
  const stamp: Rect = inline
    ? stampInline
    : { x: band.x, y: belowStrip, width: band.width, height: stampLineHeight };
  const listTop = inline ? belowStrip : belowStrip + stampLineHeight + m.rowGap;
  const list: Rect = {
    x: band.x,
    y: listTop,
    width: band.width,
    height: Math.max(0, band.y + band.height - listTop),
  };

  const rows: Rect[] = [];
  const joins: Rect[] = [];
  const rowH = Math.max(0, Math.min(plateRowHeight(m), list.height));
  const rowGap = m.rowGap;
  const perColumn = rowH > 0 ? Math.max(0, Math.floor((list.height + rowGap) / (rowH + rowGap))) : 0;
  const halfWidth = Math.max(0, (list.width - m.gutter) / 2);
  const columns = perColumn < BROWSE_COLUMN_THRESHOLD && halfWidth >= BROWSE_ROW_MIN_WIDTH ? 2 : 1;
  const rowWidth = columns === 2 ? halfWidth : list.width;
  const count = Math.min(BROWSE_ROW_CAP, perColumn * columns);
  const pad = Math.max(2, Math.round(4 * m.scale));
  const joinWidth = Math.max(
    0,
    Math.min(Math.round(BROWSE_JOIN_WIDTH * m.plateScale), Math.max(0, rowWidth * 0.4)),
  );
  for (let i = 0; i < count; i++) {
    const column = Math.floor(i / perColumn);
    const rowIndex = i % perColumn;
    const rect: Rect = {
      x: list.x + column * (rowWidth + m.gutter),
      y: list.y + rowIndex * (rowH + rowGap),
      width: rowWidth,
      height: rowH,
    };
    rows.push(rect);
    joins.push({
      x: rect.x + rect.width - pad - joinWidth,
      y: rect.y + pad,
      width: joinWidth >= BROWSE_JOIN_MIN * m.plateScale ? joinWidth : 0,
      height: Math.max(0, rect.height - 2 * pad),
    });
  }

  return { segments, shape: inline ? 'inline' : 'stacked', cellsRow, stamp, list, rows, joins };
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
 *
 * **Exported since u10-01, and the lobby is no longer its caller.** The four
 * tiles live on {@link ./ship-select} now; this stayed here because everything it
 * is dimensioned by — {@link CLASS_TILE_MIN}, {@link CLASS_TILE_MAX},
 * {@link CLASS_TILE_MIN_WIDTH}, {@link classTileContent} — is here, and splitting a
 * placement from the constants that decide it is how two files end up with two
 * opinions about the same tile.
 */
export function placeClassTiles(
  out: Rect[],
  x: number,
  y: number,
  width: number,
  bandHeight: number,
  preferred: TileShape,
  /**
   * The tile height ceiling. {@link CLASS_TILE_MAX} is the LOBBY's number — it was
   * chosen while four tiles shared a column beside a roster and an arena row — and
   * SHIP SELECT is a whole screen with nothing else on it, so it passes a taller
   * one ({@link ./ship-select} `SHIP_TILE_MAX`). A cap, never a target: the tiles
   * still take the smaller of this and what the band can give.
   */
  max: number = CLASS_TILE_MAX,
): TileShape {
  const stackH = rowHeight(bandHeight, 4, ROW_GAP, max);
  const gridH = rowHeight(bandHeight, 2, ROW_GAP, max);
  const gridW = (width - ROW_GAP) / 2;
  const rowW = (width - 3 * ROW_GAP) / 4;

  const stackOk = stackH >= CLASS_TILE_MIN && width >= CLASS_TILE_MIN_WIDTH;
  const gridOk = gridH >= CLASS_TILE_MIN && gridW >= CLASS_TILE_MIN_WIDTH;
  const rowOk = Math.min(max, bandHeight) >= CLASS_TILE_MIN && rowW >= CLASS_TILE_MIN_WIDTH;

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
  const tileHeight = rowHeight(bandHeight, rows, ROW_GAP, max);
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

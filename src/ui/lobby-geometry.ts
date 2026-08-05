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
 * THE SHAPE, AND WHAT DECIDES IT
 * ---------------------------------------------------------------------------
 * Title across the top (wordmark left, room code right), RUSH! hung off the
 * bottom with room for its one-line hint, and the band between them divided
 * between the eight-seat roster and the four hull tiles. Three things flex:
 *
 *  - **Columns** ({@link TWO_COLUMN_MIN_WIDTH}): wide enough, and the roster
 *    goes left with the tiles beside it; narrow, and the tiles drop below.
 *  - **Roster columns** ({@link SEAT_ROW_LEGIBLE}): when eight rows would not
 *    be legible and the column can be halved, the roster becomes two columns of
 *    four — P1–P4 down the left, P5–P8 down the right.
 *  - **Tile arrangement** ({@link TileShape}): four stacked, a 2×2, or one row
 *    of four — whichever keeps a tile tall *and* wide enough to carry its name,
 *    its hull and its **stat grid** (u4, 2026-08-05 — pips AND numbers; GDD
 *    §2.5 / §2.11 amended). What a tile can hold at a given size, and in what
 *    order it gives things up, is {@link classTileContent}.
 *
 * All three are decided by the **content box's dimensions**, never by
 * `isTouch`: a tablet in landscape gets the same reading as a desktop of the
 * same width, and a desktop window dragged narrow gets the phone one. `isTouch`
 * is a *scale* input, not a layout input — it grows the tap targets (GDD §2.4
 * makes every menu a plain tap).
 *
 * ---------------------------------------------------------------------------
 * LANDSCAPE IS THE CASE THAT MATTERS
 * ---------------------------------------------------------------------------
 * Planet Rush is a landscape game — a phone held in portrait gets the ROTATE
 * overlay (`src/platform/orientation.ts`) — so **a phone on its side is the
 * primary mobile layout of this screen**, not a degenerate one. That handset is
 * short and wide (a 844×390 device with its notch insets leaves 718×337), which
 * is why the flex above is on the *arrangement* rather than on the sizes: two
 * roster columns of four and a 2×2 of tiles fit that band at full height, where
 * eight stacked rows and four stacked tiles would each be a quarter of one.
 *
 * Where something still has to give — the smallest portrait phones, which are
 * behind the ROTATE overlay anyway — the roster compresses and the tiles do
 * not: the roster is a list to *read* (its only tap is the host's difficulty
 * cycle), while the tiles and RUSH! are the two choices every player makes with
 * a thumb. The view then drops a row's detail line below 30px, and a tile gives
 * up its blurb (and, below that, its hull nickname) by the ladder in
 * {@link classTileContent} — **never its stats** at any size the layout will
 * actually produce — rather than clipping anything.
 *
 * Nothing is ever laid out outside {@link LobbyLayout.content}, which is itself
 * the viewport inset by the safe area — so a notch, a home indicator or a
 * rounded corner can never eat the room code (GDD §4.3 mobile gate).
 */

import type { Rect, Viewport } from '@platform/layout-registry';

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

/** Margin from the (safe) screen edge to the content box. */
export const LOBBY_PAD = 16;
/** Gap between the lobby's blocks (title / roster / tiles / button). */
export const BLOCK_GAP = 12;
/** Gap between two roster rows, and between two hull tiles. */
export const ROW_GAP = 6;

/** Title band: BACK on the far left, wordmark beside it, room code on the right. */
export const TITLE_HEIGHT = 52;
/** Room-code block width — `ROOM` over a 26px code, right-aligned. */
export const ROOM_CODE_WIDTH = 132;
/** BACK button width — the lobby's exit to the main menu (u2 menu-back), carved
 *  off the far left of the title band. Compact, so the wordmark and the room code
 *  keep their room; the same left-anchored corner every screen puts its exit in. */
export const LOBBY_BACK_WIDTH = 64;

/** Roster row height ceiling — rows are capped here and compress below it on a
 *  short screen; there is deliberately no floor (see the file header). */
export const SEAT_ROW_MAX = 44;
export const SEAT_ROW_MAX_TOUCH = 54;
/** Below this row height the roster splits into two columns of four rather than
 *  compressing eight rows into an unreadable stack. */
export const SEAT_ROW_LEGIBLE = 26;
/** …but only if the roster column is wide enough to halve. A 360 px column
 *  splits into two 177 px rows, which still hold a chip, a name and a tier. */
export const TWO_ROSTER_MIN_WIDTH = 360;

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
/** Below this per-card width a row of four would be too pinched, so the arena row
 *  drops to a 2×2 (only the narrowest portrait windows, all behind the ROTATE
 *  overlay). Low, because a preview + a name reads fine on a slim card. */
export const LOBBY_MAP_MIN_WIDTH = 60;
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

/** Height of the MODE/ABUNDANCE strip at the top of the roster. A plain tap
 *  (GDD §2.4), thumb-scaled like every other control. */
export const CONTROLS_HEIGHT = 30;
export const CONTROLS_HEIGHT_TOUCH = 38;
/** Widest a single toggle grows — the two split the roster width, capped so they
 *  read as controls, not banners, on a wide desktop roster column. */
export const CONTROL_MAX_WIDTH = 200;

/**
 * Width of the identity STRIPE down a roster row's leading edge — the trim that
 * carries the slot's player colour (style-guide §3 rule 2).
 *
 * It lives here rather than in the view since u5, because the row's leading edge
 * stopped being decoration the drawing code could place on its own: the STATE
 * control is laid out immediately right of the stripe, so the two are one piece
 * of geometry and the view reads both from this file.
 */
export const SEAT_STRIPE = 4;

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
 * width: `stripe | STATE | body | team chip | difficulty chip`.
 */
export const SEAT_STATE_WIDTH = 58;
/** …never more than this share of a narrow row. */
export const SEAT_STATE_MAX_FRACTION = 0.28;
/**
 * …and below this the control is dropped whole rather than drawn as a stub too
 * small to carry a word (the ladder `classTileContent` keeps for a hull tile: a
 * clipped affordance reads worse than none). No row the layout produces on any
 * profile in QA's matrix lands here — asserted in `./lobby-geometry.test.ts` —
 * and a row that did would fall back to the pre-u5 behaviour, where the row body
 * is still the cycle.
 */
export const SEAT_STATE_MIN = 34;
/**
 * The row BODY the state control must leave between itself and the trailing
 * chips. The body is still the seat-state cycle's tap target (u5 adds a control,
 * it does not take one away — a wide desktop row is a generous target and stays
 * one), so it may be squeezed by the new control but never closed by it.
 */
export const SEAT_ROW_BODY_MIN = 16;

/** Width of a roster row's trailing DIFFICULTY chip — the bot-tier cycle
 *  (EASY/MEDIUM/HARD). Carved off the RIGHT of the row in BOTH modes: it is the
 *  one slot-editor control every mode shares, so a bot's tier is reachable in FFA
 *  and TEAMS alike (n2 — the TEAMS lobby had lost it). A tap on the row's body
 *  still cycles the seat state; only the chip cycles the tier. */
export const SEAT_CHIP_WIDTH = 54;
/** The chip never eats more than this share of a (narrow) row, so the state-cycle
 *  body — and the row's centre, which the hit-test contract taps — stays clear. */
export const SEAT_CHIP_MAX_FRACTION = 0.4;
/** Inset of the chip from the row's edges. */
export const SEAT_CHIP_PAD = 3;

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
export const SEAT_TEAM_CHIP_WIDTH = 88;

/**
 * The share of a roster row the TEAM chip may never cross into — the row's own
 * body, which is the seat-state cycle's tap target.
 *
 * It used to be "strictly right of centre" (0.5), and that was affordable while
 * the chip said `TEAM A`. `FRIENDLY A` needs 76px including its padding (64px of
 * word at 11px Audiowide, measured), and the landscape phone's 221px row has only
 * 48 to the right of centre: the word would have spilled out of the chip drawn
 * around it. 0.36 leaves that row's chip 79px — the word fits at full size, with
 * the leading 80px of the row (80×19, the whole row height) still body. Every
 * wider form factor is bound by {@link SEAT_TEAM_CHIP_WIDTH} instead and never
 * reaches this clamp at all. `./lobby-geometry.test` asserts both halves.
 */
export const SEAT_TEAM_CHIP_MIN_BODY = 0.36;

/** RUSH! button: ≥56 px so it is a thumb target on every device (GDD §2.4). */
export const RUSH_HEIGHT = 56;
export const RUSH_HEIGHT_TOUCH = 64;
export const RUSH_WIDTH_MAX = 280;
/** Room left under the button for its one-line hint (`3 PLAYING · 5 BOTS`). */
export const RUSH_HINT_HEIGHT = 16;

/**
 * At or above this content width the lobby lays out in two columns.
 *
 * 700 rather than a round 720 for one specific device: **Planet Rush is a
 * landscape game** (`src/platform/orientation.ts` — a phone held in portrait
 * gets a ROTATE overlay), so the phone-in-landscape case is the *primary*
 * mobile layout, not an afterthought. A 844×390 handset with its notch insets
 * leaves 718 px of content width, and it is exactly the screen that needs the
 * two-column shape most: height is the scarce axis there, width is not.
 */
export const TWO_COLUMN_MIN_WIDTH = 700;
/** Share of the content width the roster column takes when there are two. */
export const ROSTER_COLUMN_FRACTION = 0.56;
/** Share of the middle band the hull tiles take in the one-column shape. */
export const CLASS_BLOCK_FRACTION = 0.42;

// ---------------------------------------------------------------------------
// The entry screen (./lobby-entry) — the door, and the keypad behind JOIN
// ---------------------------------------------------------------------------

/** Door buttons: ≥56 px for the same reason RUSH! is (GDD §2.4 — a plain tap). */
export const DOOR_HEIGHT = 56;
export const DOOR_HEIGHT_TOUCH = 64;
/** Room under each door for its one-line hint ("Seven bots, no connection…"). */
export const DOOR_HINT_HEIGHT = 18;
/** A door never runs the full width of a desktop — a 1920px-wide button reads as
 *  a banner, not a control. Capped, and centred in whatever is left. */
export const DOOR_WIDTH_MAX = 420;

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

/** The BACK / JOIN pair under the pad. */
export const ENTRY_ACTION_HEIGHT = 48;
export const ENTRY_ACTION_HEIGHT_TOUCH = 56;

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

/**
 * How the four hull tiles are arranged. The tile *height* is what carries the
 * role blurb (GDD §2.11), so a short band changes the arrangement rather than
 * squashing four tiles into unreadable strips:
 *
 *  - `stack` — four down a column. The desktop/two-column shape.
 *  - `grid`  — 2×2. The portrait-phone shape.
 *  - `row`   — four across, one row. The landscape-phone shape, where height is
 *              the scarce axis and width is not.
 */
export type TileShape = 'stack' | 'grid' | 'row';

/** Every rect the lobby draws in, for one viewport. */
export interface LobbyLayout {
  /** The safe, padded box everything else lives inside. */
  readonly content: Rect;
  /** Wordmark band (left of the room code). */
  readonly title: Rect;
  /** BACK — the lobby's exit to the main menu (u2 menu-back), carved off the far
   *  left of the title band; the wordmark sits to its right. */
  readonly leave: Rect;
  /** `ROOM` + the code, right-aligned inside the title band. */
  readonly roomCode: Rect;
  /** The eight roster rows, in slot order, top to bottom. */
  readonly seats: readonly Rect[];
  /** Each roster row's LEADING STATE control — the OPEN/BOT/CLOSED cycle, named
   *  (u5). Nested inside its {@link seats} row at the leading edge, right of the
   *  identity stripe, so the hit-test finds it *before* the row body. Aligned to
   *  `seats`; zero-extent on a row too narrow to carry a legible one. */
  readonly seatStates: readonly Rect[];
  /** Each roster row's trailing DIFFICULTY chip — the bot-tier cycle, in BOTH
   *  modes (n2). Nested inside its {@link seats} row on the right, so the hit-test
   *  checks it *before* the row body. Aligned to `seats`. */
  readonly seatChips: readonly Rect[];
  /** Each roster row's TEAM chip (TEAMS) — the side cycle, composed immediately
   *  left of the difficulty chip and kept right of the row centre (n2). Aligned to
   *  `seats`; zero-extent where a very narrow row cannot spare the width. */
  readonly seatTeamChips: readonly Rect[];
  /** The MODE toggle (FFA / TEAMS), top-left of the roster (variable-slots E). */
  readonly modeToggle: Rect;
  /** The ABUNDANCE toggle (SCARCE / STANDARD / RICH), top-right of the roster. */
  readonly abundance: Rect;
  /** The four hull tiles, in `CLASS_ORDER`. */
  readonly classOptions: readonly Rect[];
  /** The four arena cards, in `MAP_ORDER` (`./map-picker`). A row along the
   *  bottom of the middle band; the view draws them through the shared
   *  `MapPickerView`, so the registry-drawn previews come for free. */
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
  /** Roster columns — 2 on a screen too short for eight legible rows. Seats
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
   *  screen carries. Top-left of the title band. */
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
 * Space is handed out top-down and never taken back: title, then the button and
 * its hint off the bottom, then whatever is left is the middle band the roster
 * and the tiles divide. Every block is *capped*, never stretched past its cap,
 * so a rect can only ever be smaller than the room it was given — which is what
 * makes "nothing escapes `content`" true by construction rather than by luck.
 */
export function lobbyLayout(viewport: Viewport, options: LobbyLayoutOptions = {}): LobbyLayout {
  const isTouch = options.isTouch ?? false;
  const content = contentBox(viewport, options.insets);
  const twoColumn = content.width >= TWO_COLUMN_MIN_WIDTH;

  // --- Title band -----------------------------------------------------------
  const titleHeight = Math.min(TITLE_HEIGHT, content.height);
  const title: Rect = { x: content.x, y: content.y, width: content.width, height: titleHeight };
  // BACK — the lobby's exit, top-left of the title band (u2 menu-back). Capped to
  // the content width so a comically narrow box yields a shrunk-not-escaped rect.
  const leaveWidth = Math.max(0, Math.min(LOBBY_BACK_WIDTH, content.width));
  const leave: Rect = { x: content.x, y: content.y, width: leaveWidth, height: titleHeight };
  const codeWidth = Math.min(ROOM_CODE_WIDTH, content.width);
  const roomCode: Rect = {
    x: content.x + content.width - codeWidth,
    y: content.y,
    width: codeWidth,
    height: titleHeight,
  };

  // --- RUSH!, hung off the bottom edge with room for its hint ---------------
  const rushHeight = Math.min(
    isTouch ? RUSH_HEIGHT_TOUCH : RUSH_HEIGHT,
    Math.max(0, content.height - titleHeight),
  );
  const rushWidth = Math.min(RUSH_WIDTH_MAX, content.width);
  const hint = Math.min(RUSH_HINT_HEIGHT, Math.max(0, content.height - titleHeight - rushHeight));
  const rushButton: Rect = {
    x: content.x + (content.width - rushWidth) / 2,
    y: content.y + content.height - hint - rushHeight,
    width: rushWidth,
    height: rushHeight,
  };

  // --- The middle band ------------------------------------------------------
  const middle: Rect = {
    x: content.x,
    y: title.y + titleHeight + BLOCK_GAP,
    width: content.width,
    height: Math.max(0, rushButton.y - BLOCK_GAP - (title.y + titleHeight + BLOCK_GAP)),
  };

  // The arena row, hung off the BOTTOM of the middle band (above RUSH!). It is a
  // thumb *choice* (like the hull tiles), so it keeps a floor height and the
  // roster — a list — gives back the space; on a wide/tall screen it is capped so
  // it never balloons. The roster and the tiles then divide what is left (`upper`).
  const mapWanted = Math.max(middle.height * LOBBY_MAP_BAND_FRACTION, Math.min(LOBBY_MAP_ROW_MIN, middle.height / 2));
  const mapHeight = Math.max(0, Math.min(mapWanted, LOBBY_MAP_ROW_MAX, middle.height));
  const upperHeight = Math.max(0, middle.height - mapHeight - (mapHeight > 0 ? BLOCK_GAP : 0));
  const upper: Rect = { x: middle.x, y: middle.y, width: middle.width, height: upperHeight };
  const mapBand: Rect = {
    x: middle.x,
    y: middle.y + upperHeight + (mapHeight > 0 ? BLOCK_GAP : 0),
    width: middle.width,
    height: mapHeight,
  };

  const seats: Rect[] = [];
  const classOptions: Rect[] = [];
  const maps: Rect[] = [];
  let tileShape: TileShape;
  let rosterBox: Rect;

  if (twoColumn) {
    // Roster left, tiles right, both spanning the upper band.
    const rosterWidth = Math.max(0, upper.width * ROSTER_COLUMN_FRACTION - BLOCK_GAP / 2);
    const tilesX = upper.x + rosterWidth + BLOCK_GAP;
    const tilesWidth = Math.max(0, upper.x + upper.width - tilesX);
    rosterBox = { x: upper.x, y: upper.y, width: rosterWidth, height: upper.height };
    tileShape = placeTiles(classOptions, tilesX, upper.y, tilesWidth, upper.height, 'stack');
  } else {
    // One column: the tiles take a band off the bottom of the upper band, the
    // roster the rest. The tiles' band is at least tall enough for a 2×2 of
    // blurb-height tiles whenever half the band can spare it — below that
    // {@link placeTiles} switches to a single row rather than four strips.
    const wanted = Math.max(
      upper.height * CLASS_BLOCK_FRACTION,
      Math.min(2 * CLASS_TILE_MIN + ROW_GAP, upper.height / 2),
    );
    const tilesHeight = Math.max(0, Math.min(wanted, 2 * CLASS_TILE_MAX + ROW_GAP, upper.height));
    const rosterHeight = Math.max(0, upper.height - tilesHeight - BLOCK_GAP);
    rosterBox = { x: upper.x, y: upper.y, width: upper.width, height: rosterHeight };
    tileShape = placeTiles(
      classOptions,
      upper.x,
      upper.y + rosterHeight + BLOCK_GAP,
      upper.width,
      tilesHeight,
      'grid',
    );
  }

  // The MODE / ABUNDANCE strip is carved off the TOP of the roster box (never a
  // band of its own — see the constants header): the roster gives back the space,
  // the tiles and the arena cards keep their floors. The seats take what is left.
  const controls = placeControls(rosterBox, isTouch);
  const seatsBox: Rect = {
    x: rosterBox.x,
    y: rosterBox.y + controls.height + (controls.height > 0 ? ROW_GAP : 0),
    width: rosterBox.width,
    height: Math.max(0, rosterBox.height - controls.height - (controls.height > 0 ? ROW_GAP : 0)),
  };
  const seatColumns = placeSeats(seats, seatsBox, seatRowMax(isTouch));
  const seatStates = seats.map((rect) => stateRect(rect));
  const seatChips = seats.map((rect) => chipRect(rect));
  const seatTeamChips = seats.map((rect, i) => teamChipRect(rect, seatChips[i]!));
  const mapColumns = placeMaps(maps, mapBand);

  return {
    content,
    title,
    leave,
    roomCode,
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

/**
 * The MODE toggle (top-left of the roster) and the ABUNDANCE toggle (top-right),
 * splitting the roster width with a gap between. Capped in width so they read as
 * controls on a wide desktop column, and clamped to the roster's own height so a
 * comically short box yields zero-extent rather than a strip taller than its band.
 */
function placeControls(roster: Rect, isTouch: boolean): { modeToggle: Rect; abundance: Rect; height: number } {
  const height = Math.max(0, Math.min(isTouch ? CONTROLS_HEIGHT_TOUCH : CONTROLS_HEIGHT, roster.height));
  const width = Math.max(0, Math.min(CONTROL_MAX_WIDTH, (roster.width - BLOCK_GAP) / 2));
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
  const x = seat.x + SEAT_STRIPE + SEAT_CHIP_PAD;
  // Where the trailing chips' zone begins — the body has to fit before it.
  const bodyStart = seat.x + seat.width * SEAT_TEAM_CHIP_MIN_BODY;
  const room = Math.min(
    SEAT_STATE_WIDTH,
    seat.width * SEAT_STATE_MAX_FRACTION,
    bodyStart - SEAT_ROW_BODY_MIN - x,
  );
  const width = room >= SEAT_STATE_MIN ? room : 0;
  return {
    x,
    y: seat.y + SEAT_CHIP_PAD,
    width,
    height: width > 0 ? Math.max(0, seat.height - 2 * SEAT_CHIP_PAD) : 0,
  };
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
  const height = Math.max(0, seat.height - 2 * SEAT_CHIP_PAD);
  return { x: seat.x + seat.width - width - SEAT_CHIP_PAD, y: seat.y + SEAT_CHIP_PAD, width, height };
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
function teamChipRect(seat: Rect, diffChip: Rect): Rect {
  if (seat.width <= 0 || seat.height <= 0 || diffChip.width <= 0) {
    return { x: seat.x, y: seat.y, width: 0, height: 0 };
  }
  const right = diffChip.x - SEAT_CHIP_PAD;
  const bodyKeep = seat.x + seat.width * SEAT_TEAM_CHIP_MIN_BODY;
  const left = Math.max(bodyKeep + SEAT_CHIP_PAD, right - SEAT_TEAM_CHIP_WIDTH);
  const width = Math.max(0, right - left);
  return { x: left, y: diffChip.y, width, height: diffChip.height };
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

/** Every rect the entry screen draws in. Both screens are laid out every time —
 *  they cost a dozen rects, the view draws only the active one, and a layout
 *  that does not branch on state cannot be wrong for the state it is in. */
export interface EntryLayout {
  readonly content: Rect;
  /** Wordmark band. */
  readonly title: Rect;
  /** The one line under it: the prompt, or the failure (`./lobby-entry`). */
  readonly message: Rect;
  /** The three doors, in `DOOR_ORDER`. Home screen. */
  readonly doors: readonly Rect[];
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
 * Lay the entry screen out for a viewport.
 *
 * Same discipline as {@link lobbyLayout}: space is handed out top-down — title,
 * message, the action row off the bottom — and every block is *capped* rather
 * than stretched, so nothing can escape the content box by construction.
 *
 * Where the two screens compete for the same band, the **keys win and the cells
 * give**: a code cell that is a little small is still readable, while a key too
 * small to hit reliably makes the screen unusable (GDD §2.4).
 */
export function entryLayout(viewport: Viewport, options: LobbyLayoutOptions = {}): EntryLayout {
  const isTouch = options.isTouch ?? false;
  const content = contentBox(viewport, options.insets);

  const titleHeight = Math.min(TITLE_HEIGHT, content.height);
  const title: Rect = { x: content.x, y: content.y, width: content.width, height: titleHeight };
  const messageHeight = Math.min(DOOR_HINT_HEIGHT, Math.max(0, content.height - titleHeight));
  const message: Rect = {
    x: content.x,
    y: content.y + titleHeight,
    width: content.width,
    height: messageHeight,
  };

  // --- The action row, hung off the bottom ---------------------------------
  const actionHeight = Math.min(
    isTouch ? ENTRY_ACTION_HEIGHT_TOUCH : ENTRY_ACTION_HEIGHT,
    Math.max(0, content.height - titleHeight - messageHeight),
  );
  const actionsY = content.y + content.height - actionHeight;
  const actionWidth = Math.min(DOOR_WIDTH_MAX + 2 * BLOCK_GAP, content.width);
  const actionX = content.x + (content.width - actionWidth) / 2;
  // BACK and the erase key share the left half; JOIN takes the right, because it
  // is the one of the three that ends the screen.
  const third = Math.max(0, (actionWidth - 2 * ROW_GAP) / 3);
  const back: Rect = { x: actionX, y: actionsY, width: third, height: actionHeight };
  const erase: Rect = { x: actionX + third + ROW_GAP, y: actionsY, width: third, height: actionHeight };
  const submit: Rect = {
    x: actionX + 2 * (third + ROW_GAP),
    y: actionsY,
    width: third,
    height: actionHeight,
  };

  // --- The band both screens divide ----------------------------------------
  const middleY = message.y + messageHeight + BLOCK_GAP;
  const middle: Rect = {
    x: content.x,
    y: middleY,
    width: content.width,
    height: Math.max(0, actionsY - BLOCK_GAP - middleY),
  };

  // The home screen's own bottom controls, in the same band the join screen hangs
  // its action row from — the two screens never draw together, so these rects can
  // sit under the keypad's row and the hit test (which is told the live screen)
  // keeps them apart. BACK reuses the join screen's left-anchored `back` rect —
  // the exit every screen must carry (u2 menu-back) — so the button holds its
  // place as the screen changes; SETTINGS takes the remainder of the band.
  const settingsX = actionX + third + ROW_GAP;
  const settings: Rect = {
    x: settingsX,
    y: actionsY,
    width: Math.max(0, actionX + actionWidth - settingsX),
    height: actionHeight,
  };

  return {
    content,
    title,
    message,
    doors: placeDoors(middle, isTouch),
    ...placeCodeEntry(middle),
    back,
    erase,
    submit,
    settings,
    isTouch,
  };
}

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
 * The three doors, stacked and centred in the band, each with room for its hint
 * line underneath. Stacked on every device: three full-width-ish buttons down
 * the middle is the one arrangement that works identically on a 320px phone and
 * a 1920px desktop, and this is the screen where "it works everywhere" beats
 * "it uses the space".
 */
function placeDoors(band: Rect, isTouch: boolean): Rect[] {
  const count = 3;
  const hint = DOOR_HINT_HEIGHT;
  const wanted = isTouch ? DOOR_HEIGHT_TOUCH : DOOR_HEIGHT;
  // Compress the buttons — never the hint, which is what tells a player that
  // SOLO needs no connection (GDD §4.8 risk 6).
  const height = Math.max(
    0,
    Math.min(wanted, (band.height - (count - 1) * BLOCK_GAP) / count - hint),
  );
  const width = Math.min(DOOR_WIDTH_MAX, band.width);
  const block = height + hint;
  const total = count * block + (count - 1) * BLOCK_GAP;
  const top = band.y + Math.max(0, (band.height - total) / 2);
  const x = band.x + (band.width - width) / 2;
  const doors: Rect[] = [];
  for (let i = 0; i < count; i++) {
    doors.push({ x, y: top + i * (block + BLOCK_GAP), width, height });
  }
  return doors;
}

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

/** The viewport, inset by the safe area and then by {@link LOBBY_PAD}. Never
 *  negative: a comically small viewport yields a zero-extent box, not a
 *  backwards one. */
function contentBox(viewport: Viewport, insets?: Insets): Rect {
  const left = LOBBY_PAD + Math.max(0, insets?.left ?? 0);
  const right = LOBBY_PAD + Math.max(0, insets?.right ?? 0);
  const top = LOBBY_PAD + Math.max(0, insets?.top ?? 0);
  const bottom = LOBBY_PAD + Math.max(0, insets?.bottom ?? 0);
  const width = Math.max(0, viewport.width - left - right);
  const height = Math.max(0, viewport.height - top - bottom);
  return { x: left, y: top, width, height };
}

function seatRowMax(isTouch: boolean): number {
  return isTouch ? SEAT_ROW_MAX_TOUCH : SEAT_ROW_MAX;
}

/**
 * Lay the eight roster rows out inside `box`, in one column or — when eight
 * rows would not be legible and the box is wide enough to halve — two columns
 * of four. Seats fill **column-major**, so slot order still reads top to
 * bottom: P1–P4 down the left, P5–P8 down the right.
 *
 * Returns the column count it settled on.
 */
function placeSeats(out: Rect[], box: Rect, max: number): number {
  const single = rowHeight(box.height, LOBBY_SLOT_ROWS, ROW_GAP, max);
  const twoColumns = single < SEAT_ROW_LEGIBLE && box.width >= TWO_ROSTER_MIN_WIDTH;
  const columns = twoColumns ? 2 : 1;
  const perColumn = LOBBY_SLOT_ROWS / columns;
  const width = Math.max(0, (box.width - (columns - 1) * ROW_GAP) / columns);
  const height = rowHeight(box.height, perColumn, ROW_GAP, max);
  for (let i = 0; i < LOBBY_SLOT_ROWS; i++) {
    const column = Math.floor(i / perColumn);
    const row = i % perColumn;
    out.push({
      x: box.x + column * (width + ROW_GAP),
      y: box.y + row * (height + ROW_GAP),
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

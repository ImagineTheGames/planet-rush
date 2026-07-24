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
 *    of four — whichever keeps a tile tall *and* wide enough to carry its role
 *    blurb, which is the only reason the tile exists (GDD §2.11).
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
 * a thumb. The view then drops a row's detail line below 30px and a tile's
 * blurb below 64px rather than clipping either.
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

/** Title band: wordmark on the left, room code on the right. */
export const TITLE_HEIGHT = 52;
/** Room-code block width — `ROOM` over a 26px code, right-aligned. */
export const ROOM_CODE_WIDTH = 132;

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

/** Hull tile heights. 64 is the height the view needs to draw the role blurb —
 *  the blurb is the whole point of the tile (GDD §2.11), so it is defended by
 *  changing the tiles' *arrangement* before their height (see {@link TileShape}). */
export const CLASS_TILE_MIN = 64;
export const CLASS_TILE_MAX = 108;
/** Narrower than this a tile cannot carry a name over a wrapped blurb, so an
 *  arrangement that would produce one is rejected in favour of a taller shape. */
export const CLASS_TILE_MIN_WIDTH = 150;

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
  /** `ROOM` + the code, right-aligned inside the title band. */
  readonly roomCode: Rect;
  /** The eight roster rows, in slot order, top to bottom. */
  readonly seats: readonly Rect[];
  /** The four hull tiles, in `CLASS_ORDER`. */
  readonly classOptions: readonly Rect[];
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
  | { readonly kind: 'seat'; readonly index: number }
  | { readonly kind: 'class'; readonly index: number }
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

  const seats: Rect[] = [];
  const classOptions: Rect[] = [];
  let tileShape: TileShape;
  let rosterBox: Rect;

  if (twoColumn) {
    // Roster left, tiles right, both spanning the whole band.
    const rosterWidth = Math.max(0, middle.width * ROSTER_COLUMN_FRACTION - BLOCK_GAP / 2);
    const tilesX = middle.x + rosterWidth + BLOCK_GAP;
    const tilesWidth = Math.max(0, middle.x + middle.width - tilesX);
    rosterBox = { x: middle.x, y: middle.y, width: rosterWidth, height: middle.height };
    tileShape = placeTiles(classOptions, tilesX, middle.y, tilesWidth, middle.height, 'stack');
  } else {
    // One column: the tiles take a band off the bottom, the roster the rest.
    // The tiles' band is at least tall enough for a 2×2 of blurb-height tiles
    // whenever half the band can spare it — below that {@link placeTiles}
    // switches to a single row rather than handing back four strips.
    const wanted = Math.max(
      middle.height * CLASS_BLOCK_FRACTION,
      Math.min(2 * CLASS_TILE_MIN + ROW_GAP, middle.height / 2),
    );
    const tilesHeight = Math.max(0, Math.min(wanted, 2 * CLASS_TILE_MAX + ROW_GAP, middle.height));
    const rosterHeight = Math.max(0, middle.height - tilesHeight - BLOCK_GAP);
    rosterBox = { x: middle.x, y: middle.y, width: middle.width, height: rosterHeight };
    tileShape = placeTiles(
      classOptions,
      middle.x,
      middle.y + rosterHeight + BLOCK_GAP,
      middle.width,
      tilesHeight,
      'grid',
    );
  }

  const seatColumns = placeSeats(seats, rosterBox, seatRowMax(isTouch));

  return {
    content,
    title,
    roomCode,
    seats,
    classOptions,
    rushButton,
    isTouch,
    twoColumn,
    seatColumns,
    tileShape,
  };
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
  if (hit(layout.rushButton, x, y)) return { kind: 'rush' };
  for (let i = 0; i < layout.classOptions.length; i++) {
    const rect = layout.classOptions[i];
    if (rect && hit(rect, x, y)) return { kind: 'class', index: i };
  }
  for (let i = 0; i < layout.seats.length; i++) {
    const rect = layout.seats[i];
    if (rect && hit(rect, x, y)) return { kind: 'seat', index: i };
  }
  if (hit(layout.roomCode, x, y)) return { kind: 'roomCode' };
  return null;
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

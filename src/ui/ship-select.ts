/**
 * src/ui/ship-select.ts — the SHIP SELECT screen. OWNER: UI Engineer (brief
 * u10-01; the developer, 2026-08-07, over a screenshot of the live lobby: *"in
 * the lobby page select ship and select map need to open different pages, we
 * should only show 1 ship and 1 map in lobby because it's too cluttered now"*).
 *
 * The four hulls of GDD §2.11, each with **its full stat line — pips AND numbers**
 * (u4, ratified 2026-08-05; GDD §2.5 / §2.11 amended the same day), on a screen
 * with nothing else on it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCREEN AND NOT A TIDIER COLUMN
 * ---------------------------------------------------------------------------
 * The tiles were never *wrong* in the lobby; they were **outnumbered**. CREW
 * MUSTER carried eight roster rows, four hull tiles of six stats each and six
 * arena cards, and on a 390px phone the tiles' share of that was a 172×66 box —
 * which is why `./lobby-geometry` `classTileContent` has a four-rung priority
 * ladder and why the role blurb (GDD §2.11's own sentence about each hull) was
 * the first thing dropped on every phone in QA's matrix.
 *
 * Given the screen, the same tile is 592×200 on a desktop and 389×121 on a
 * landscape phone: the six stats lay out as **one table-like row** on both, the
 * blurb is drawn rather than dropped, and the comparison the pips exist for
 * finally happens at a size a player can make it at. Nothing about the tile's
 * content changed — this file lays out the identical {@link ShipClassOption}s the
 * lobby has published since u4, through the identical `classTileContent` ladder.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT OWN
 * ---------------------------------------------------------------------------
 * **Not the pick.** `./lobby` `selectShipClass` decides the hull and keeps every
 * refusal it has ever kept; `pickShipClass` is that plus the return to the roster.
 * This file resolves a tapped tile to an index and stops there, which is the same
 * split every other screen in this directory keeps.
 *
 * **Not the lock.** GDD §2.11 locks the hull at RUSH!; the model reports it
 * ({@link ShipSelectModel.locked}) so the tiles can look unavailable rather than
 * look live and then refuse, and the screen still OPENS while locked — a player
 * who cannot change their hull may still want to see what the four are.
 *
 * Same three-piece discipline as the rest of the directory: a pure, DOM-free model
 * with its layout co-located, and a thin Pixi view ({@link ./ship-select-view})
 * that draws exactly what this returns and decides nothing.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import type { ShipClass } from '@shared/types';
import { plateHeight } from '../art/materials';
import type { FrameMetrics, PlateRole, PlateState } from '../art/materials';
import { beamContent, gantryFrame } from './gantry';
import { hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';
import { CLASS_ORDER, CLASS_OPTIONS } from './lobby';
import type { ShipClassOption } from './lobby';
import { placeClassTiles } from './lobby-geometry';
import type { TileShape } from './lobby-geometry';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * The heading in the header beam. **The developer's own words for the screen**
 * (*"select ship … open different pages"*), and deliberately not an in-fiction
 * rename: GDD §4.7 register 2's clarity rule is explicit that the voice may rename
 * the *world* but not the *verb*, and this heading is what tells a player which of
 * the three lobby screens they are standing on.
 *
 * It lives here rather than in a draw call for the reason every other string on
 * this screen does — the copy sweep reads the models
 * (`docs/copy-sweep-industrial-voice.md`), and a string typed into a draw call is
 * a string nobody can find.
 */
export const SHIP_SELECT_TITLE = 'SHIP SELECT';

/** The eyebrow over the heading — the noun of work the hull actually is
 *  (GDD §2.11 tables the four as *classes*). */
export const SHIP_SELECT_EYEBROW = 'HULL CLASS';

/** The way out, in the navigation verb the whole shell uses (§4.7's fixed-string
 *  list: `BACK` is not the voice's to revisit). */
export const SHIP_SELECT_BACK_LABEL = 'BACK';

/**
 * The line under the heading, stating what the screen is for — and, once the
 * countdown has started, why the tiles are dead.
 *
 * The refusal half is the load-bearing one: GDD §2.11 locks the hull at RUSH! and
 * a screen full of tiles that quietly stop working is exactly the "looks live and
 * then refuses" failure this UI keeps a rule against. It names the reason first,
 * as §4.7's clarity rule requires of a refusal.
 */
export const SHIP_SELECT_HINT = 'PIPS COMPARE · NUMBERS ARE THE FIGURE';
export const SHIP_SELECT_LOCKED_HINT = 'HULL LOCKED — THE MATCH HAS STARTED';

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** What the wiring hands in: the pick, and whether it may still change. */
export interface ShipSelectState {
  /** The hull currently chosen — the tile drawn as selected. */
  readonly shipClass: ShipClass;
  /** True once the lobby is counting down (`./lobby` `classLocked`). */
  readonly locked: boolean;
}

/** Which control the pointer is over / holding, for the plate states. */
export interface ShipSelectPointer {
  readonly hover?: ShipSelectTarget | null;
  readonly press?: ShipSelectTarget | null;
}

/** One hull tile, as the view draws it. */
export interface ShipSelectTileView {
  /** The hull's whole option — name, hull nickname, blurb, and the six stat lines
   *  as pips AND numbers, straight off `./lobby` `CLASS_OPTIONS` (which reads them
   *  off the sim's own `SHIP_STATS`). Never rebuilt here. */
  readonly option: ShipClassOption;
  readonly selected: boolean;
  /** Dimmed: the lobby is locked and this is not the hull you are flying. */
  readonly dim: boolean;
  readonly state: PlateState;
  /**
   * The plate role. **Selected is `secondary`, unselected is `inert`, and neither
   * is ever `primary`** — the same pair the lobby's tiles wore, and for the same
   * reason: under Bone the primary is simply the brightest plate on screen, which
   * only works while there is exactly one, and on this screen that one is BACK.
   */
  readonly role: PlateRole;
}

/** The screen for one frame. */
export interface ShipSelectModel {
  readonly title: string;
  readonly eyebrow: string;
  readonly hint: string;
  readonly tiles: readonly ShipSelectTileView[];
  readonly shipClass: ShipClass;
  readonly locked: boolean;
  readonly backLabel: string;
  readonly backState: PlateState;
  /** BACK is this screen's one bright plate: it is the only thing here that is
   *  not a choice among equals, and `./gantry` `singlePrimary` needs exactly one. */
  readonly backRole: PlateRole;
}

/** Build the frame model. Pure: the view draws exactly this and decides nothing. */
export function shipSelectModel(
  state: ShipSelectState,
  pointer: ShipSelectPointer = {},
): ShipSelectModel {
  const stateOf = (target: ShipSelectTarget): PlateState =>
    sameShipTarget(pointer.press, target)
      ? 'press'
      : sameShipTarget(pointer.hover, target)
        ? 'hover'
        : 'rest';

  const tiles = CLASS_OPTIONS.map((option, index): ShipSelectTileView => {
    const selected = option.shipClass === state.shipClass;
    return {
      option,
      selected,
      dim: state.locked && !selected,
      state: stateOf({ kind: 'hull', index }),
      role: selected ? 'secondary' : 'inert',
    };
  });

  return {
    title: SHIP_SELECT_TITLE,
    eyebrow: SHIP_SELECT_EYEBROW,
    hint: state.locked ? SHIP_SELECT_LOCKED_HINT : SHIP_SELECT_HINT,
    tiles,
    shipClass: state.shipClass,
    locked: state.locked,
    backLabel: SHIP_SELECT_BACK_LABEL,
    backState: stateOf({ kind: 'back' }),
    backRole: 'primary',
  };
}

/** The plate roles this screen draws, in one list, so `./gantry` `singlePrimary`
 *  can be asserted against the screen rather than against a comment. */
export function shipSelectPlateRoles(model: ShipSelectModel): PlateRole[] {
  return [model.backRole, ...model.tiles.map((tile) => tile.role)];
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** What a tap on SHIP SELECT resolves to. Index-based, through
 *  {@link CLASS_ORDER}, so the geometry never has to know what a hull *is*. */
export type ShipSelectTarget =
  /** BACK — return to the roster with the pick exactly as it was
   *  (`./lobby` `closeLobbyScreen`). */
  | { readonly kind: 'back' }
  /** A hull tile — pick it and return (`./lobby` `pickShipClass`). */
  | { readonly kind: 'hull'; readonly index: number };

/** Whether two targets name the same control — structural, because the wiring
 *  hands back whatever the hit test returned and those are fresh objects every
 *  call (the same helper `./hangar` `sameHangarTarget` exists for). */
export function sameShipTarget(
  a: ShipSelectTarget | null | undefined,
  b: ShipSelectTarget | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'hull' && b.kind === 'hull' ? a.index === b.index : true;
}

/** A stable string key for a target — the wiring's hover/press bookkeeping. */
export function shipSelectTargetKey(target: ShipSelectTarget | null): string | null {
  if (!target) return null;
  return target.kind === 'back' ? 'back' : `hull:${target.index}`;
}

/** The hull a tile index names, or `undefined` — the one place an index becomes a
 *  {@link ShipClass}, so the tile drawn and the hull recorded cannot drift. */
export function shipClassAt(index: number): ShipClass | undefined {
  return CLASS_ORDER[index];
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface ShipSelectLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

/** Every rect this screen draws in, for one viewport. */
export interface ShipSelectLayout {
  readonly content: Rect;
  readonly header: Rect;
  readonly footer: Rect;
  /** The heading's strip inside the header beam. */
  readonly title: Rect;
  /** The band between the beams — the tiles, and the hint line above them. */
  readonly band: Rect;
  /** The one-line hint strip off the top of the band. */
  readonly hint: Rect;
  /** The four hull tiles, in {@link CLASS_ORDER}. */
  readonly tiles: readonly Rect[];
  /** How they are arranged — 2×2 wherever it holds (see {@link shipSelectLayout}). */
  readonly tileShape: TileShape;
  /** BACK, in the footer beam. */
  readonly back: Rect;
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/** BACK's width at the reference — the same footer plate the lobby's own BACK is
 *  ({@link ./lobby-geometry} `LOBBY_BACK_WIDTH`), so the way out is the same shape
 *  and the same size on the screen you left and the screen you are on. */
const BACK_WIDTH = 120;

/** The hint strip's height at the reference — one line of eyebrow type with air. */
const HINT_HEIGHT = 22;

/**
 * The tile height ceiling on THIS screen.
 *
 * `CLASS_TILE_MAX` (108) is the lobby's number and it was chosen while four tiles
 * shared a column with a roster and an arena row. Here they have the band, so the
 * cap only has to stop two rows of tiles from becoming two banners on a 4K
 * desktop — which 200 does, while still letting a 470px desktop band draw the role
 * blurb GDD §2.11 gives each hull at a size worth reading.
 */
export const SHIP_TILE_MAX = 200;

/**
 * Lay the screen out for a viewport.
 *
 * **2×2 is what this screen asks for**, on both form factors, and that is a
 * change of preference rather than of machinery: the lobby's column preferred a
 * `stack` because it was tall and narrow, and a full-width band is neither. Four
 * tiles in a 2×2 put every hull's stat row at the same size on the same screen,
 * which is the comparison the pips are for. {@link placeClassTiles} still has the
 * final say and still falls back the way it always has, so a band that cannot hold
 * a legible 2×2 gets the arrangement that fits rather than a squashed one.
 */
export function shipSelectLayout(
  viewport: Viewport,
  options: ShipSelectLayoutOptions = {},
): ShipSelectLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const { metrics } = frame;
  const title = beamContent(frame.header, metrics);

  const footerStrip = beamContent(frame.footer, metrics, 'footer');
  const backHeight = Math.max(0, Math.min(plateHeight('compact', metrics), footerStrip.height));
  const backWidth = Math.max(
    0,
    Math.min(Math.round(BACK_WIDTH * metrics.plateScale), footerStrip.width),
  );
  const back: Rect = {
    x: footerStrip.x,
    y: footerStrip.y + (footerStrip.height - backHeight) / 2,
    width: backWidth,
    height: backHeight,
  };

  const band = frame.band;
  // The hint gives way before the tiles do: it explains the grid, and a grid you
  // cannot read needs no explanation. Dropped whole rather than clipped.
  const hintHeight = Math.max(0, Math.min(Math.round(HINT_HEIGHT * metrics.plateScale), band.height / 4));
  const hint: Rect = { x: band.x, y: band.y, width: band.width, height: hintHeight };
  const tilesY = band.y + hintHeight + (hintHeight > 0 ? metrics.rowGap : 0);
  const tilesHeight = Math.max(0, band.y + band.height - tilesY);

  const tiles: Rect[] = [];
  const tileShape = placeClassTiles(
    tiles,
    band.x,
    tilesY,
    band.width,
    tilesHeight,
    'grid',
    SHIP_TILE_MAX,
  );

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    band,
    hint,
    tiles,
    tileShape,
    back,
    isTouch,
    metrics,
  };
}

/**
 * The target a tap at `(x, y)` hits, or `null`.
 *
 * BACK first, for the reason `lobbyHitTest` puts it first: it sits in a corner
 * clear of every other control, and a mis-hit toward the edge should favour
 * leaving over nothing.
 */
export function shipSelectHitTest(
  layout: ShipSelectLayout,
  x: number,
  y: number,
): ShipSelectTarget | null {
  if (hitRect(layout.back, x, y)) return { kind: 'back' };
  for (let i = 0; i < layout.tiles.length; i++) {
    const rect = layout.tiles[i];
    if (rect && hitRect(rect, x, y)) return { kind: 'hull', index: i };
  }
  return null;
}

/** The screen's layout-registry id: it owns the screen while it is up. */
export const SHIP_SELECT_ID = 'ship-select';

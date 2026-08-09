/**
 * src/ui/class-tile-view.ts — the hull tile, drawn. OWNER: UI Engineer.
 *
 * One hull, as a plate: its class name, its hull nickname, **its six stats as
 * pips AND numbers** (u4, ratified 2026-08-05: *"both pips and numbers"*; GDD §2.5
 * / §2.11 amended), and its role blurb — laid out by `./lobby-geometry`
 * `classTileContent` so a short tile drops a whole block rather than clipping one.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ITS OWN FILE (u10-01)
 * ---------------------------------------------------------------------------
 * It used to be two private methods on {@link ./lobby-view}, which was right while
 * the lobby was the only screen with hull tiles on it. It is not any more: u10-01
 * split the four tiles onto {@link ./ship-select-view} and left the lobby drawing
 * exactly **one** — the pick.
 *
 * Two screens drawing the same tile is precisely the situation where a second copy
 * gets made and then drifts, and the thing that would drift is the one rule this
 * tile exists to keep: *the figure and the pips are two renderings of one value*.
 * So there is one renderer, and both screens call it. Nothing here computes a stat:
 * `line.text` and `line.pips` both arrive on the model's `ShipStatLine`, derived
 * from a single read of the sim's own `SHIP_STATS` (`./lobby` `statLine`), so "four
 * pips beside a figure that means three" has no code path to arrive by.
 *
 * ---------------------------------------------------------------------------
 * THE FROZEN CONTRACT, WHERE IT COULD ONLY BE BROKEN HERE
 * ---------------------------------------------------------------------------
 *  - **Selection is a raised plate, not a hue** (u7-03 Gantry/Bone). The picked
 *    hull is `secondary` and the rest are `inert` — the handoff's own example of
 *    that role, *"a settings row, an unselected ship"*. Never `primary`: a screen
 *    gets exactly one bright plate (`./gantry` `singlePrimary`), and on both of
 *    this tile's screens that one is something else.
 *  - **No signal yellow and no threat red** (style-guide §2). A hull is neither ore
 *    nor damage; the pips ride the Bone value ramp (`./lobby` `STAT_PIP_COLORS`).
 *  - **Audiowide for the words, Oxanium for the figures** (§7), never crossed.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  TRACKING,
  drawPlate,
  plateTypeSize,
  trackingPx,
} from '../art/materials';
import type { FrameMetrics, PlateRole, PlateState } from '../art/materials';
import type { Rect } from '@platform/layout-registry';
import { STAT_PIP_COLORS } from './lobby';
import type { ShipClassOption } from './lobby';
import { STAT_COUNT, STAT_PIP_BAR, STAT_ROW_TEXT, classStatCell, classTileContent } from './lobby-geometry';
import type { ClassTileContent } from './lobby-geometry';
import { FONT_BODY, FONT_HEADING } from './typography';

// ---------------------------------------------------------------------------
// Reference type sizes, read off the handoff's ship-select screen
// ---------------------------------------------------------------------------

/** A hull tile: its class name, its hull nickname, its blurb, its stat cells. */
export const TILE_NAME_PX = 14;
export const TILE_HULL_PX = 10;
export const TILE_BLURB_PX = 11;
export const STAT_PX = 9;
/** …and the floor the stat grid keeps. Deliberately below the frame's `TYPE_MIN`
 *  (11px): that floor is right for a control's word and wrong for a six-cell grid
 *  — an 11px figure overflows the 10px text line `classStatCell` reserves and the
 *  pip bar is then drawn straight through it. 8px is the size this block has been
 *  legible at since u4. */
export const STAT_MIN_PX = 8;

/** Air between two pips of a stat bar (u4). */
const STAT_PIP_GAP = 1;
/**
 * A pip bar never spans more than this, so a stat on a wide tile reads as a bar
 * under its own figure rather than as a rule across the tile. Set to the widest
 * figure the six cells produce (`SPD 130%` measures 34px at Oxanium 9), so the bar
 * tracks the text it belongs to.
 */
const STAT_PIP_BAR_MAX_WIDTH = 36;

// ---------------------------------------------------------------------------
// The children
// ---------------------------------------------------------------------------

/** The Pixi children one tile owns. Created once per tile slot and reused: the
 *  two screens that draw tiles both redraw on state change, never per frame. */
export interface ClassTileNodes {
  readonly body: Graphics;
  readonly name: Text;
  readonly hull: Text;
  readonly blurb: Text;
  /** Every pip of every stat in ONE Graphics — 30 tiny rects redrawn together, so
   *  a tile costs one extra draw call rather than six. */
  readonly pips: Graphics;
  /** `SPD 130%` — one per stat, in the model's own stat order (u4). */
  readonly stats: Text[];
}

/** Build one tile's children and add them to `parent` in draw order. */
export function createClassTileNodes(parent: Container): ClassTileNodes {
  const body = new Graphics();
  const name = makeText('', FONT_HEADING, TILE_NAME_PX, MATERIAL_SHADES.bone);
  const hull = makeText('', FONT_BODY, TILE_HULL_PX, MATERIAL_SHADES.boneLo);
  const blurb = makeText('', FONT_BODY, TILE_BLURB_PX, MATERIAL_SHADES.boneLo);
  blurb.style.wordWrap = true;
  const pips = new Graphics();
  // One label+figure per stat. `letterSpacing: 0` (rather than the row's usual
  // tracking) is what buys `SPD 130%` its room in a 46px cell on a phone.
  const stats: Text[] = [];
  for (let i = 0; i < STAT_COUNT; i++) {
    const cell = makeText('', FONT_BODY, STAT_PX, MATERIAL_SHADES.boneLo);
    cell.style.letterSpacing = 0;
    stats.push(cell);
  }
  parent.addChild(body, name, hull, blurb, pips, ...stats);
  return { body, name, hull, blurb, pips, stats };
}

/** How one tile is drawn this frame. */
export interface ClassTilePaint {
  /** Drawn as the pick — brighter metal, brighter pips. */
  readonly selected: boolean;
  /** Dimmed: the choice is locked and this is not the hull being flown. */
  readonly dim: boolean;
  /** The plate role. Both call sites pass `selected ? 'secondary' : 'inert'`; it is
   *  a parameter so the rule is stated by the *model* rather than assumed here. */
  readonly role: PlateRole;
  /** Hover / press, for a screen that tracks a pointer over its tiles. */
  readonly state?: PlateState;
  readonly metrics: FrameMetrics;
}

/**
 * Draw one hull tile into `rect`.
 *
 * The priority ladder — name, then the stat grid, then the hull nickname, then the
 * blurb — belongs to `classTileContent` and is not re-decided here: this method
 * draws whatever it returns, and hides whatever it says does not fit. A block that
 * does not fit is dropped **whole**; a half-sentence and a half-visible stat row
 * both read worse than none.
 */
export function drawClassTile(
  nodes: ClassTileNodes,
  option: ShipClassOption,
  rect: Rect,
  paint: ClassTilePaint,
): void {
  const m = paint.metrics;
  nodes.body.clear();
  if (rect.width <= 0 || rect.height <= 0) {
    hideClassTile(nodes);
    return;
  }
  const content = classTileContent(rect);

  // No accent tick: a tile's content is a GRID that starts at its own 3px padding,
  // and the tick would land in the middle of the stat cells.
  drawPlate(
    nodes.body,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    paint.role,
    'compact',
    paint.state ?? 'rest',
    false,
  );

  const alpha = paint.dim ? 0.45 : 1;
  const namePx = plateTypeSize(TILE_NAME_PX, m);
  nodes.name.visible = true;
  nodes.name.text = option.name;
  nodes.name.style.fontSize = namePx;
  nodes.name.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, namePx);
  nodes.name.style.fill = paint.selected ? BONE.hi : MATERIAL_SHADES.bone;
  nodes.name.alpha = alpha;
  nodes.name.x = content.name.x;
  nodes.name.y = content.name.y;

  // The hull nickname (Quadfin…). Flavour the codex also carries, so it is the
  // block that gives way *before* the stats on the tightest tile.
  const hullPx = plateTypeSize(TILE_HULL_PX, m);
  nodes.hull.text = option.hull;
  nodes.hull.style.fontSize = hullPx;
  nodes.hull.style.letterSpacing = trackingPx(TRACKING.label, hullPx);
  nodes.hull.alpha = alpha;
  nodes.hull.x = content.hull.x;
  nodes.hull.y = content.hull.y;
  nodes.hull.visible = content.showHull;

  drawClassStats(nodes, option, content, paint.selected, alpha, m);

  // The role blurb (GDD §2.11). Hidden on a tile too short to hold it rather than
  // clipped — a half-sentence reads worse than none.
  const blurbPx = plateTypeSize(TILE_BLURB_PX, m);
  nodes.blurb.text = option.blurb;
  nodes.blurb.style.fontSize = blurbPx;
  nodes.blurb.alpha = alpha;
  nodes.blurb.style.wordWrapWidth = Math.max(20, content.blurb.width);
  nodes.blurb.x = content.blurb.x;
  nodes.blurb.y = content.blurb.y;
  // The layout reserves the blurb's band; how many WRAPPED lines the sentence
  // actually takes at this width is a measurement only Pixi can make, so the final
  // say is here — an overrunning blurb is dropped whole rather than run out of the
  // bottom of its own tile.
  nodes.blurb.visible = content.showBlurb && nodes.blurb.height <= content.blurb.height;
}

/**
 * The stat grid on one tile: per stat, its figure on a text line with its pip bar
 * directly beneath, in the model's own stat order (GDD §2.11's table).
 *
 * The two channels are deliberately redundant — the bar answers *"which of these
 * four is the fast one?"* across the tiles at a glance, the figure answers *"by how
 * much"* — and both are read off the same `ShipStatLine`, so they cannot drift
 * apart here.
 */
function drawClassStats(
  nodes: ClassTileNodes,
  option: ShipClassOption,
  content: ClassTileContent,
  selected: boolean,
  alpha: number,
  m: FrameMetrics,
): void {
  nodes.pips.clear();
  nodes.pips.alpha = alpha;
  nodes.pips.visible = content.showStats;
  // NOT `plateTypeSize`: see STAT_MIN_PX.
  const px = Math.max(STAT_MIN_PX, Math.round(STAT_PX * m.plateScale));

  for (let i = 0; i < nodes.stats.length; i++) {
    const cell = nodes.stats[i]!;
    const line = option.stats[i];
    if (!line || !content.showStats) {
      cell.visible = false;
      continue;
    }
    const box = classStatCell(content, i);
    cell.visible = true;
    cell.text = `${line.label} ${line.text}`;
    cell.style.fontSize = px;
    cell.style.fill = selected ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    cell.alpha = alpha;
    cell.x = box.x;
    cell.y = box.y;

    // The bar under the figure. Filled pips are the brightest metal on the picked
    // hull and one ramp step down on the others; the unfilled remainder is the
    // shaded end of the same ramp. No hue is spent on a stat readout — the same
    // treatment the settings screen's volume pips take.
    const barWidth = Math.min(box.width, STAT_PIP_BAR_MAX_WIDTH);
    const pipWidth = Math.max(
      1,
      (barWidth - (line.pipMax - 1) * STAT_PIP_GAP) / Math.max(1, line.pipMax),
    );
    const barY = box.y + STAT_ROW_TEXT;
    for (let p = 0; p < line.pipMax; p++) {
      const filled = p < line.pips;
      nodes.pips.rect(box.x + p * (pipWidth + STAT_PIP_GAP), barY, pipWidth, STAT_PIP_BAR).fill({
        color: filled
          ? selected
            ? STAT_PIP_COLORS.selected
            : STAT_PIP_COLORS.filled
          : STAT_PIP_COLORS.empty,
        alpha: 1,
      });
    }
  }
}

/** Draw nothing at all — a tile slot a layout no longer has a rect for. */
export function hideClassTile(nodes: ClassTileNodes): void {
  nodes.body.clear();
  nodes.pips.clear();
  nodes.name.visible = false;
  nodes.hull.visible = false;
  nodes.blurb.visible = false;
  nodes.pips.visible = false;
  for (const cell of nodes.stats) cell.visible = false;
}

function makeText(
  text: string,
  fontFamily: string,
  fontSize: number,
  fill: number,
  fontWeight: TextStyleFontWeight = 'normal',
): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, fontWeight, letterSpacing: 0 } });
}

/**
 * src/ui/hud-geometry.ts — the M2 HUD's screen geometry. OWNER: UI Engineer.
 *
 * Pure, PixiJS-free, and unit-tested: every rect the day-2 elements occupy on
 * screen is computed here, and the views ({@link ./hud}, {@link ./build-wheel-view})
 * only draw what these functions return.
 *
 * **Why this file exists.** Every positioned element registers its declared
 * anchor and its *actual* rendered rect with the layout registry
 * (`@platform/layout-registry`), and QA's layout contract asserts the second
 * sits inside the first. But that contract can only see elements the frozen
 * golden scene actually draws — the wheel opens at your station, the alarm fires
 * under sustained damage, and neither is happening in a screenshot of a ship two
 * seconds into a match. Keeping the geometry pure means the placement of those
 * elements is still asserted, headless, against the registry's own resolver, at
 * every device profile in both orientations (see ./hud-geometry.test.ts) —
 * rather than being trusted until someone opens a build wheel on a phone.
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * same convention the registry, the touch layer and the camera speak.
 */

import type { Rect } from '@platform/layout-registry';
import { WHEEL_HALO } from '../art/materials';
import type { HomeArrow } from './alarm';
import { hudMetrics, hudSpace, hudType, hullBarFill, scrimGround } from './instrument';
import { HEALTHBAR_MIN_FILL } from './healthbar';
import { collapsedRect } from './minimap';
import type { MinimapInsets } from './minimap';

/**
 * How far a readout's scrim reaches past the rule that closes it, reference px —
 * so the darkness starts before the type does rather than at its cap-height.
 *
 * It lives here rather than in {@link ./hud} because it is part of what an
 * element *draws*, and therefore part of the rect the layout registry records:
 * a0-24's clock/wheel clearance is measured against the strip's scrim, not
 * against its last baseline, and a test cannot check a number it cannot import.
 */
export const SCRIM_BLEED = 8;

// ---------------------------------------------------------------------------
// The Build & Upgrade wheel (GDD §2.5)
// ---------------------------------------------------------------------------

/** Reference wheel size as a fraction of the smaller viewport dimension. Big
 *  enough to hit with a thumb, small enough to leave the field readable behind
 *  it — the wheel is opened *at* your station, so the world under it is calm. */
export const WHEEL_SCALE = 0.36;
/** Clamp so the wheel is neither unreadable on a small phone nor absurd on a
 *  4K desktop. CSS px radius of the outer ring. */
export const WHEEL_MIN_RADIUS = 120;
export const WHEEL_MAX_RADIUS = 230;

/**
 * Outer-ring radius of the wheel for a viewport, CSS px — thumb-scale on a
 * phone, sane on a desktop (GDD §2.4 makes the wheel a touch target first).
 */
export function wheelRadius(viewportWidth: number, viewportHeight: number): number {
  return clamp(
    Math.min(viewportWidth, viewportHeight) * WHEEL_SCALE,
    WHEEL_MIN_RADIUS,
    WHEEL_MAX_RADIUS,
  );
}

// --- One wedge: is it thumb-sized, and do its words fit? (u7-02, a0-32) -----
//
// The Gantry/Bone pass puts four lines of text on a wedge — the name, what it
// spends on, the cost, and the count over its cap — inside a fixed radial
// space. On a 390 px phone that space is 95 px deep and ~115 px across, and a
// line that runs past it crosses a spoke into its neighbour. l2-02's copy
// overflowed its chrome for exactly this reason and only the phone profiles
// caught it, so the budget is computed here, in the pure layer, where a test can
// hold every worst-case string to it (./hud-geometry.test.ts).
//
// ── AND WHY THE BUDGET IS NOW A SHAPE AND NOT A WIDTH (a0-32) ──────────────
// u7-02 spent that budget as a CHORD — "how wide is the wedge at this radius" —
// and `wedgeChordWidth` was this file's answer to it. A chord is the whole
// question for the wedge at twelve o'clock: its words run left-to-right and the
// chord runs left-to-right with them. For the wedge at NINE o'clock it is the
// wrong axis. The words are not rotated — the point of a radial menu you can read
// is that its labels stay upright — so on the left-hand wedge a line of text
// extends along the RADIUS, and what stops it is the rim, which a chord says
// nothing about.
//
// That was the defect, exactly: `UPGRADE` measured 81 px against a chord budget
// of 127 px and passed, while hanging 10 px past the outer rim of a wheel that is
// only 140 px in radius, on the phone the developer photographed. So the budget
// is the SHAPE rather than one of its widths — an annular sector, and a box
// either fits inside it or does not. `wedgeChordWidth` is gone rather than kept
// beside it: a budget that is right for one wedge and silent about another is
// worse than no budget at all.

/** Clearance a wedge's words keep from the chrome around them, CSS px — the
 *  spokes on each side, and (since a0-32, which found out the hard way that it
 *  matters) the rim and the hub as well. */
export const WEDGE_TEXT_MARGIN = 4;

/** An annular sector: the ring between two radii, between two angles. The shape
 *  one wedge of the wheel actually is. Angles in radians, screen space (y down). */
export interface AnnularSector {
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** The angle the wedge is centred on — `segmentAngle(i)` (`./build-wheel`). */
  readonly angle: number;
  /** Half the wedge's angular width: `π / segments`. */
  readonly halfArc: number;
}

/** How far outside its sector a box reaches, CSS px and radians — all four
 *  numbers zero when it fits. Reported rather than a bare boolean so a failing
 *  test can say *which* edge it crossed and by how much. */
export interface SectorOverflow {
  /** Past the outer rim, CSS px. */
  readonly outer: number;
  /** Into the hub, CSS px. */
  readonly inner: number;
  /** Past the wedge's own spokes, radians (the worse of the two sides). */
  readonly arc: number;
  /** True when none of the above is positive. */
  readonly fits: boolean;
}

/**
 * By how much an axis-aligned box, in wheel-centre coordinates, escapes its
 * wedge.
 *
 * The box is assumed not to contain the wheel's centre — a label never does —
 * which is what lets the angular extent be read off the four corners: for a
 * convex region that excludes the origin, the extreme bearings are at vertices.
 * The radial extremes are not both at corners, though: the FARTHEST point is
 * always a corner, but the NEAREST is the ordinary point-to-rectangle distance,
 * which lands on an edge whenever the box straddles an axis through the centre.
 *
 * `margin` insets the shape before testing, so words stop short of the chrome
 * rather than touching it — the same clearance {@link wedgeChordWidth} spends.
 */
export function sectorOverflow(
  box: Rect,
  sector: AnnularSector,
  margin = WEDGE_TEXT_MARGIN,
): SectorOverflow {
  const x0 = box.x;
  const x1 = box.x + box.width;
  const y0 = box.y;
  const y1 = box.y + box.height;

  let far = 0;
  let widestArc = 0;
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    far = Math.max(far, Math.hypot(x, y));
    widestArc = Math.max(widestArc, Math.abs(angleDelta(Math.atan2(y, x), sector.angle)));
  }
  // Nearest point of the box to the centre: zero on each axis the box straddles.
  const nx = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0;
  const ny = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
  const near = Math.hypot(nx, ny);

  // A margin in px is a margin in px on the two radii; on the arc it is that same
  // clearance read as an angle at the radius where the box actually sits, which
  // is the honest conversion — 4 px of gap near the hub is a lot of degrees.
  const arcMargin = far > 0 ? margin / far : 0;
  const outer = Math.max(0, far - (sector.outerRadius - margin));
  const inner = Math.max(0, sector.innerRadius + margin - near);
  const arc = Math.max(0, widestArc - (sector.halfArc - arcMargin));
  return { outer, inner, arc, fits: outer <= 0 && inner <= 0 && arc <= 0 };
}

/** `a − b`, wrapped into `(−π, π]`. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * One wedge as a touch target: the arc it spans at its own mid-radius, and how
 * deep the ring is. GDD §2.4 makes the wheel a touch target first, and the
 * platform floor is 48 px on the shorter of the two — a wedge that is 200 px of
 * arc and 20 px deep is not a button, it is a hairline.
 */
export function wedgeHitTarget(
  viewportWidth: number,
  viewportHeight: number,
  segments: number,
  hubFraction: number,
): { arc: number; depth: number; min: number } {
  const outer = wheelRadius(viewportWidth, viewportHeight);
  const inner = outer * hubFraction;
  const mid = (outer + inner) / 2;
  const arc = segments > 0 ? (2 * Math.PI * mid) / segments : 0;
  const depth = outer - inner;
  return { arc, depth, min: Math.min(arc, depth) };
}

/** The platform floor for a tappable affordance, CSS px (GDD §2.4, §4.3 mobile). */
export const TOUCH_TARGET_MIN = 48;

/**
 * The wheel's **disc**: a `2r` square centred on the screen. The follow camera
 * keeps the local ship — and so the station it is docked at — at the viewport
 * centre, which is what GDD §2.2's "the wheel when near your own station"
 * resolves to in screen space.
 *
 * This is the rim, the wedges and their words — everything with an edge. It is
 * **not** what the layout registry records for `build-wheel`; that is
 * {@link wheelFootprint}, which is bigger, and the difference is what a0-100 was
 * filed for. Reach for this one when the question is about the wheel's *face*
 * (hit-testing, wedge geometry, the a0-24 clock clearance) and for
 * {@link wheelFootprint} when the question is about the pixels it occupies.
 */
export function wheelBounds(viewportWidth: number, viewportHeight: number): Rect {
  const r = wheelRadius(viewportWidth, viewportHeight);
  return { x: viewportWidth / 2 - r, y: viewportHeight / 2 - r, width: 2 * r, height: 2 * r };
}

/**
 * How far the wheel's DRAWN pixels reach past its rim, as a multiple of the
 * radius — the outermost halo band that is actually filled.
 *
 * ## Why this number exists (a0-100)
 *
 * `build-wheel-view`'s `drawRings` opens with the halo: a pool of void stepped
 * into `WHEEL_HALO.bands` nested fills, reaching zero coverage at
 * `WHEEL_HALO.fadeTo × r` and full coverage from `holdTo × r` inward — the
 * "no plates over gameplay" mechanism (`../art/materials` `WHEEL_HALO`). The
 * outermost band is drawn at zero alpha and skipped, so the largest circle the
 * view actually fills is the *second* one, at
 * `fadeTo + (holdTo − fadeTo) / bands` of the radius.
 *
 * That band is why QA's registry read `build-wheel` as **318.5 px** on a 798×384
 * phone where {@link wheelBounds} says 276.5: `getBounds()` measures what was
 * filled, alpha notwithstanding, and the gap between the two rects is 21 px on
 * every side. Everything that computed clearance against the disc was therefore
 * 21 px optimistic — and 21 px is the whole of the band the prompt had left.
 *
 * Derived from `WHEEL_HALO` rather than typed as a constant: the halo's shape is
 * `../art/materials`' to own, and a hand-copied 1.152 is exactly the drift this
 * file exists to prevent.
 */
export const WHEEL_HALO_SPAN =
  WHEEL_HALO.fadeTo + (WHEEL_HALO.holdTo - WHEEL_HALO.fadeTo) / WHEEL_HALO.bands;

/**
 * The wheel's **drawn footprint** — the rect the layout registry records for
 * `build-wheel` (and `upgrade-wheel`, which shares the square). The disc plus
 * the halo pool around it, {@link WHEEL_HALO_SPAN} of the radius.
 *
 * This is the rect another surface has to clear to be able to say, in the
 * registry's own numbers, that it does not share pixels with the wheel. The
 * outer halo bands are nearly transparent and a sentence laid over them would
 * still be legible — but "the words happened to stay readable in that frame" is
 * luck, not layout, and the instrument that arbitrates cannot be fed a rect
 * smaller than the one it measures.
 */
export function wheelFootprint(viewportWidth: number, viewportHeight: number): Rect {
  const r = wheelRadius(viewportWidth, viewportHeight) * WHEEL_HALO_SPAN;
  return { x: viewportWidth / 2 - r, y: viewportHeight / 2 - r, width: 2 * r, height: 2 * r };
}

// ---------------------------------------------------------------------------
// The upgrade panel (GDD §2.5 — where ship stats appear during a match)
// ---------------------------------------------------------------------------

/** Widest the upgrade panel ever gets, CSS px — past this the four rows stop
 *  reading as a table and start reading as scattered columns. */
export const PANEL_MAX_WIDTH = 360;
/** Clearance the panel keeps from the screen edges on a narrow phone. */
export const PANEL_EDGE_PAD = 12;
/** Panel chrome above and below the rows (title, column headers, ore hint). */
export const PANEL_CHROME_HEIGHT = 92;
/** One upgrade row's height, CSS px. */
export const PANEL_ROW_HEIGHT = 30;

/**
 * The upgrade panel's drawn size for a viewport and row count, CSS px.
 *
 * The width is clamped to the **viewport**, not only to {@link PANEL_MAX_WIDTH}:
 * a fixed 360 px table runs off the side of any phone narrower than that, and a
 * stat row the player cannot read is a spending decision they cannot make
 * (GDD §2.5, style-guide §9).
 */
export function panelSize(
  viewportWidth: number,
  viewportHeight: number,
  rowCount: number,
): { width: number; height: number } {
  const radius = wheelRadius(viewportWidth, viewportHeight);
  const width = Math.max(
    0,
    Math.min(PANEL_MAX_WIDTH, radius * 3, viewportWidth - 2 * PANEL_EDGE_PAD),
  );
  return { width, height: PANEL_CHROME_HEIGHT + rowCount * PANEL_ROW_HEIGHT };
}

/** The panel's drawn footprint — centred on the screen, behind the wheel's
 *  UPGRADE SHIP arrow (GDD §2.5). */
export function panelBounds(
  viewportWidth: number,
  viewportHeight: number,
  rowCount: number,
): Rect {
  const { width, height } = panelSize(viewportWidth, viewportHeight, rowCount);
  return {
    x: viewportWidth / 2 - width / 2,
    y: viewportHeight / 2 - height / 2,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// The banked-ore counter (GDD §2.2 — top-left) and the ground under it
// ---------------------------------------------------------------------------
//
// ## What a0-99 photographed, and what was actually wrong
//
// QA failed the top-left of both profiles: *"THE ORE COUNTER HAS NO PLATE, SCRIM
// OR PANEL BEHIND IT — the word ORE, the numeral, and a thin underline rule are
// drawn straight onto whatever the world put there"*, with a yellow ore crystal
// and a gold vein ring a few tens of pixels from the counter's own signal-yellow
// numeral.
//
// The counter DID have chrome, and it was the HUD's own: a `SCRIM.corner` scrim
// closed by a Bone rule ({@link ./instrument}, u7-07), the same treatment HOME
// and the wave clock wear. So this is not "no other readout has one either" —
// **every corner readout has the treatment, and the ore counter was drawing it
// on a rect coincident with its own type**: `drawOreChrome` sized the scrim to
// `max(labelWidth, numeralWidth) + 18` starting at the glyphs' own origin, so
// all 18 px of slack sat to the RIGHT of the type and none above, below or left
// of it.
//
// A scrim decays to nothing at every edge — that is what makes it a scrim rather
// than a panel — so a rect coincident with the type puts the type in the
// falloff. Measured on the shipped baseline at the desktop reference (42×54):
//
//   | where                    | coverage |
//   |--------------------------|----------|
//   | `ORE`, leading glyph     | 0.15     |
//   | `ORE`, mid               | 0.37     |
//   | banked numeral, leading  | 0.15     |
//   | the closing rule         | 0.09–0.40|
//   | the one point that peaks | 0.55     |
//
// against a constant whose own doc says 0.55 is *"enough that 11px Oxanium
// survives a lit asteroid passing under it, **and no more**"*. By that file's
// stated reasoning everything under 0.55 is not enough, and 0.55 was reached at
// a point no glyph was standing on. QA read the frame correctly: there was no
// ground there, whatever the draw call was named.
//
// ## The fix, and why the counter moved
//
// The ground is sized from {@link ../ui/instrument} `scrimGround`, so the
// scrim's PLATEAU — the region that actually holds `SCRIM.corner` — covers the
// two glyph boxes and the rule. The falloff has to go somewhere, and the only
// two places it can go are onto the type or into padding; a0-102 puts it into
// padding.
//
// It could not instead be bled outward past the group origin. `ore-hud`
// registers at `top-left` with margin {@link HUD_PAD}, and an element's
// registered footprint is what it DRAWS (`Hud.describeLayout` reads
// `getBounds()`), so a ground reaching left of the margin fails QA's layout
// contract on a real device — `tests/mobile/layout.spec.ts` failed on exactly
// that when the corner scrims were first written. So the ground keeps the corner
// and the type sits inside it: `ORE` starts a third of the ink box in from the
// margin instead of on it.
//
// The 18 px the cluster always carried is still 18 px; it is split either side of
// the type now ({@link ORE_RULE_OVERHANG}) instead of being spent entirely to the
// right, where nothing was reading.

/** The eyebrow above a corner readout (`ORE`, `HOME`), reference px. Here rather
 *  than in ./hud for {@link PROMPT_TYPE}'s reason: the ore counter's ground has
 *  to be sized before any text exists, so the geometry has to know the size. */
export const HUD_EYEBROW_TYPE = 11;

/** The banked ore total — the loudest number on the screen, reference px. */
export const ORE_BANK_TYPE = 22;

/** Air between the top of `ORE` and the top of the banked numeral, reference px —
 *  the eyebrow's leading. Was `TOTAL_LABEL_H` in ./hud; it moved here when the
 *  cluster's arrangement became a computed layout rather than two assignments. */
export const ORE_LABEL_LEADING = 14;

/** Air between the banked numeral and the rule that closes the cluster,
 *  reference px — the same gap the clock keeps ({@link CLOCK_RULE_GAP}). */
export const ORE_RULE_GAP = 4;

/** How far the closing rule overhangs the widest line of type, each side,
 *  reference px. Two of these is the 18 the cluster has always been drawn with. */
export const ORE_RULE_OVERHANG = 9;

/** The drawn thickness of the closing rule, CSS px — not scaled: a 1px edge is
 *  1px on every screen, exactly as `drawEdgeRule` draws it. */
export const ORE_RULE_THICKNESS = 1;

/** One drawn line of the counter, as measured by the view (real text metrics) —
 *  the same shape {@link ClockLine} takes, for the same reason. */
export interface OreLine {
  readonly width: number;
  readonly height: number;
}

/** Where the view puts the counter's two lines, its rule, and the ground under
 *  all three. Offsets are in the ore group's own space — origin at the ground's
 *  top-left, which the view pins to `(contentBox.x + HUD_PAD, HUD_PAD)`. */
export interface OreCounterLayout {
  /** The `ORE` eyebrow's box. */
  readonly label: Rect;
  /** The banked numeral's box. */
  readonly numeral: Rect;
  /** The Bone rule that closes the cluster, at its drawn thickness. */
  readonly rule: Rect;
  /** Everything the counter puts ink on — the union of the three above. This is
   *  the rect the ground has to hold at full coverage. */
  readonly ink: Rect;
  /** The scrim rect the view draws, `center`-anchored. Strictly larger than
   *  {@link ink} on all four sides; its plateau covers `ink` exactly. */
  readonly ground: Rect;
}

/** The smallest rect containing all of `rects` — the ore cluster's ink box, and
 *  nothing else needs it yet. */
function union(...rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Lay the top-left ore counter out from its two measured lines.
 *
 * `label` is `ORE` at the eyebrow size; `numeral` is the banked total at the bank
 * size. Both are measured by the caller (Pixi in the view, `font-metrics` in the
 * test) so the model and the screen agree about a number whose width changes
 * every time the player banks.
 */
export function oreCounterLayout(
  label: OreLine,
  numeral: OreLine,
  scale: HudScale,
): OreCounterLayout {
  const overhang = hudSpace(ORE_RULE_OVERHANG, scale);
  const widest = Math.max(label.width, numeral.width);

  // Ink space first, with the type's left edge at x = 0 and the label's top at
  // y = 0; the whole box is shifted into ground space at the end.
  const numeralY = hudSpace(ORE_LABEL_LEADING, scale);
  const ruleY = numeralY + numeral.height + hudSpace(ORE_RULE_GAP, scale);
  // The union of the three, computed rather than assumed: the rule is the widest,
  // leftmost and lowest of them at every size the HUD draws today, but "today" is
  // what a re-scaled eyebrow would quietly change, and the ground is only correct
  // if it is sized to everything the cluster actually inks.
  const ink = union(
    { x: 0, y: 0, width: label.width, height: label.height },
    { x: 0, y: numeralY, width: numeral.width, height: numeral.height },
    { x: -overhang, y: ruleY, width: widest + overhang * 2, height: ORE_RULE_THICKNESS },
  );

  // …then the ground that has to hold it, and the offset that puts the ground's
  // own top-left at the group origin so the cluster still hangs off the margin.
  const ground = scrimGround(ink);
  const dx = -ground.x;
  const dy = -ground.y;
  return {
    label: { x: dx, y: dy, width: label.width, height: label.height },
    numeral: { x: dx, y: dy + numeralY, width: numeral.width, height: numeral.height },
    rule: { x: ink.x + dx, y: dy + ruleY, width: ink.width, height: ORE_RULE_THICKNESS },
    ink: { x: ink.x + dx, y: ink.y + dy, width: ink.width, height: ink.height },
    ground: { x: 0, y: 0, width: ground.width, height: ground.height },
  };
}

// ---------------------------------------------------------------------------
// Your own station's HP (GDD §2.2 — top-right, in your player colour)
// ---------------------------------------------------------------------------

/** The HUD's corner margin, CSS px — and the `margin` of the anchors the corner
 *  elements register under, so the two can never drift apart. */
export const HUD_PAD = 16;

/** Own-station HP bar. Wide enough to read a quarter-core loss at arm's length on
 *  a phone (GDD §2.2). See {@link stationHpBounds} for why 140 is not free. */
export const HP_BAR_WIDTH = 140;
export const HP_BAR_HEIGHT = 10;
/** Thin shield overbar above it — shields stand in front of the core (GDD §2.5). */
export const SHIELD_BAR_HEIGHT = 4;
/** Air between the shield overbar and the core bar it stands in front of, CSS px. */
export const SHIELD_BAR_GAP = 2;
/**
 * The row above the bar that carries `HOME` and the `100/100` core value, CSS px:
 * one line of {@link ./hud} `TYPE.coreValue` ink (≈10 px at the 11 px floor) plus
 * four pixels of air under its baseline.
 *
 * That air is the point. The element is a stack of three things in a corner, and
 * the one that gets squeezed is the number: with the bar's top hard-coded at 16
 * the shield overbar landed **one pixel under the value's baseline**, so a station
 * with a generator standing drew a plasma line flush against the underside of
 * `100/100` and the numerals read as struck through. It is on `main`'s own frozen
 * baseline and in this brief's `before-*` evidence — a pre-existing defect this
 * pass found by shooting the corner at 5× rather than by reading the diff.
 */
export const HP_VALUE_ROW = 14;
/** The bar's top edge within the element, under the value row and the shield
 *  overbar that stands above it. Derived, never typed twice — the collision above
 *  is what a hand-picked number bought. */
export const HP_BAR_TOP = HP_VALUE_ROW + SHIELD_BAR_HEIGHT + SHIELD_BAR_GAP;

/**
 * The own-station HP element's drawn footprint: the right-aligned `HOME` label
 * stacked over the core bar, hugging the top-right corner (GDD §2.2).
 *
 * Vertical placement does not depend on the viewport height — the element hangs
 * from the top edge — so the height is not a parameter. `labelWidth` is the
 * measured text width of `HOME` / `HOME LOST`; the footprint is the union of the
 * label and the bar, since the registry records what was actually drawn.
 *
 * **The width is not free.** The element registers under `top-right`, whose zone
 * starts at the viewport's half-width line, so the bar must satisfy
 * `HP_BAR_WIDTH ≤ viewportWidth / 2 − HUD_PAD` — a 144 px budget on the 320 px
 * phone the game claims to run on (GDD §4.3). Widening the bar past that puts
 * own-station HP into the left half of the screen and breaks the anchor;
 * `hud-geometry.test.ts` pins it.
 */
/**
 * How tall the HOME cluster's **chrome** runs from the top of its group, CSS px —
 * the scrim's full depth, which is the bar plus the rule that closes it plus the
 * scrim's bleed below that rule.
 *
 * Extracted here (a0-74) because a second element now has to sit *under* HOME and
 * a hand-copied number would be the drift this whole file exists to prevent:
 * `./hud` `drawStationChrome` draws exactly this depth, and
 * `./zoom-control` starts exactly below it.
 */
export function stationChromeHeight(scale: number): number {
  const m = { scale };
  return HP_BAR_TOP + HP_BAR_HEIGHT + hudSpace(4, m) + hudSpace(SCRIM_BLEED, m);
}

export function stationHpBounds(viewportWidth: number, labelWidth = 0): Rect {
  const width = Math.max(HP_BAR_WIDTH, labelWidth);
  return {
    x: viewportWidth - HUD_PAD - width,
    y: HUD_PAD,
    width,
    height: HP_BAR_TOP + HP_BAR_HEIGHT,
  };
}

/**
 * The own-station CORE bar's track, in the HOME group's own local space.
 *
 * The group is registered `top-right` and positioned at the corner, so its origin
 * is the element's **right** edge and the bar runs back leftward from it — hence
 * the negative x. That is a placement fact about the corner, and it is the only
 * thing the right anchor was ever about: the *fill* inside this track starts at
 * `x` (the track's left edge) like every other hull bar on the screen
 * ({@link ./instrument} `hullBarFill`, a0-101).
 *
 * Returned as a rect rather than left as four numbers in `./hud` because the bar
 * is drawn three times a frame — track, core fill, and the repair shimmer over it
 * — and a hand-copied `-HP_BAR_WIDTH` in one of the three is exactly how the two
 * bars in a0-99 came to disagree.
 */
export function stationCoreBarTrack(): Rect {
  return { x: -HP_BAR_WIDTH, y: HP_BAR_TOP, width: HP_BAR_WIDTH, height: HP_BAR_HEIGHT };
}

/**
 * The thin shield overbar's track, in the same local space — the pooled shield HP
 * standing in front of the core (GDD §2.5), so it sits directly above the core
 * bar with {@link SHIELD_BAR_GAP} of air between them.
 *
 * A shield pool is a hull-like pool: it is health that is being shot, it drains,
 * and it is read at the same glance as the core under it. So it empties the same
 * way the core does (a0-101) — same left edge, same direction.
 */
export function stationShieldBarTrack(): Rect {
  const core = stationCoreBarTrack();
  return {
    x: core.x,
    y: core.y - SHIELD_BAR_HEIGHT - SHIELD_BAR_GAP,
    width: HP_BAR_WIDTH,
    height: SHIELD_BAR_HEIGHT,
  };
}

/**
 * The **drawn fill** of the own-station core bar for a core fraction — the rect
 * `./hud` paints in the player's colour, and the one the repair shimmer washes
 * over. Where the two bars of a0-99 disagreed, and therefore a value this
 * module hands out rather than a rect a draw loop invents.
 */
export function stationCoreBarFill(coreFraction: number): Rect {
  return livingBarFill(stationCoreBarTrack(), coreFraction);
}

/** The drawn fill of the shield overbar, by the same rule as the core under it. */
export function stationShieldBarFill(shieldFraction: number): Rect {
  return livingBarFill(stationShieldBarTrack(), shieldFraction);
}

/**
 * A station bar's fill: the fraction, floored so a **standing** pool never
 * renders as an empty track ([[healthbar]] `HEALTHBAR_MIN_FILL` — the field
 * report's "a living thing never shows empty", shared so the station and the
 * ships cannot answer it differently). A pool that is actually gone draws
 * nothing: on this bar, empty means the core is gone, exactly.
 */
function livingBarFill(track: Rect, fraction: number): Rect {
  if (!(fraction > 0)) return { x: track.x, y: track.y, width: 0, height: track.height };
  // Anchored at the track's LEFT edge, so the bar empties rightward — the one
  // direction every hull bar on the screen takes, argued at [[instrument]]
  // `hullBarFill` (Director, 2026-08-19, a0-101). This is the line a0-99
  // photographed running the other way.
  return hullBarFill(track, Math.max(HEALTHBAR_MIN_FILL, fraction));
}

// ---------------------------------------------------------------------------
// (Removed: the own-ship HULL readout that used to stack under HOME — field
// report v0.2, "I don't need to see hull on top right — it's already appearing
// on my ship." The over-ship bar (./healthbar-view) is the single truth for
// own-ship hull now, so this corner carries only `station-hp` again. Its geometry
// and layout test went with it; nothing references the old `HULL_*`/`hullHudBounds`.)

// ---------------------------------------------------------------------------
// The asteroid-wave clock (GDD §2.2 — top-centre) and the wheel under it
// ---------------------------------------------------------------------------
//
// ## The collision (a0-24)
//
// The clock strip is top-centred and the Build & Upgrade wheel is screen-centred
// (the follow camera holds the docked ship at the middle), and on a landscape
// phone the two meet. At 844×390 the wheel's radius is
// `clamp(min(844,390) × 0.36, 120, 230)` = **140.4 px**, so its footprint starts
// at y **54.6** — while the three-line strip, at the 0.75 frame scale, runs from
// the 16 px margin down to y ≈ **69**. The third line, `MATCH 0:10`, is drawn
// *under* the wheel (the wheel is the later child) and is half-eaten by the
// TURRET wedge. Neither element is misplaced on its own; they have simply never
// been asked to share 390 px of height.
//
// ## Which one yields, and why it is the clock
//
// **The clock.** The wheel is forbidden to move — its geometry, `u13-01`'s
// hit-test and `a0-21`'s arc all read off {@link wheelRadius} and
// {@link wheelBounds}, and a wheel that shifts or shrinks while open is a wheel
// whose wedges are no longer where the thumb learned they were. But "the clock
// yields" cannot mean "the clock is dropped", because the wave countdown is the
// number the build decision is being *made against*: choosing a turret with 12
// seconds left on the wave is a different choice from choosing it with 2:51.
//
// So the strip does not move out of the way, it **re-flows**: while the wheel is
// open on a viewport too short to hold both, the three stacked lines become one
// row — the same three readouts, the same words, the same colours, laid out
// left-to-right instead of top-to-bottom. That trades the one axis the screen has
// none of (height) for the one it has plenty of (844 px of width), keeps the
// element at the `top-center` placement GDD §2.2 puts in writing, and leaves
// every clock line fully legible instead of two-thirds of them.
//
// The strip stays stacked everywhere it fits — desktop never re-flows, and a
// phone re-flows only for as long as the wheel is actually open.
//
// The one metric that changes in the compact row is the scrim's bleed below the
// closing rule: a one-line strip does not need the 8 px of extra darkness a
// three-line stack does, and on the shortest landscape screen in the matrix
// (568×320, where the wheel's own 120 px minimum radius starts at y 40) those
// pixels are exactly the clearance that keeps the row clear of the disc.

/** Leading of the stacked strip's three lines from the group's top, reference px. */
export const CLOCK_LINE_LEADING: readonly number[] = [0, 20, 38];
/** Air between two readouts of the compact single-row strip, reference px. */
export const CLOCK_ROW_GAP = 12;
/** Scrim width beyond the widest line of the strip, reference px (half each side). */
export const CLOCK_CHROME_PAD_X = 24;
/** Air between the strip's last line and the rule that closes it, reference px. */
export const CLOCK_RULE_GAP = 4;
/** Clearance the strip keeps above the open wheel's footprint, CSS px. Small on
 *  purpose: this is the threshold that decides whether the strip re-flows, and a
 *  generous one would compact screens that do not need it. */
export const CLOCK_WHEEL_GAP = 4;

/** One drawn line of the clock, as measured by the view (real text metrics). */
export interface ClockLine {
  readonly width: number;
  readonly height: number;
}

/** Where the view puts each line, and the chrome behind them. All offsets are in
 *  the strip group's own space — origin at the top-centre of the strip, which the
 *  view pins to `(viewportWidth / 2, HUD_PAD)`. Lines are centre-anchored in x. */
export interface ClockLayout {
  /** True when the strip re-flowed to a single row to clear the open wheel. */
  readonly compact: boolean;
  /** Per input line, its centre-x and top-y in group space. */
  readonly lines: readonly { readonly x: number; readonly y: number }[];
  /** The scrim rect and the y of the rule inside it, in group space. */
  readonly chrome: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly ruleY: number;
  };
  /** The strip's drawn footprint in SCREEN space — what the registry would
   *  record, and the rect the clock/wheel clearance is asserted on (it must not
   *  overlap {@link wheelBounds}; see hud-geometry.test.ts). */
  readonly bounds: Rect;
}

/** The stacked strip: three centred lines, the form the HUD has always drawn. */
function stackedClock(lines: readonly ClockLine[], scale: HudScale): ClockLayout['chrome'] & {
  offsets: { x: number; y: number }[];
} {
  const offsets = lines.map((_, i) => ({
    x: 0,
    // Line 0 hangs from the group origin exactly; `hudSpace` floors at 2, so it
    // is spelled as a literal rather than run through the scale.
    y: i === 0 ? 0 : hudSpace(CLOCK_LINE_LEADING[i] ?? 0, scale),
  }));
  const widest = lines.reduce((w, l) => Math.max(w, l.width), 0);
  const width = widest + hudSpace(CLOCK_CHROME_PAD_X, scale);
  const last = lines.length - 1;
  const ruleY =
    (offsets[last]?.y ?? 0) + (lines[last]?.height ?? 0) + hudSpace(CLOCK_RULE_GAP, scale);
  return {
    offsets,
    x: -width / 2,
    y: 0,
    width,
    height: ruleY + hudSpace(SCRIM_BLEED, scale),
    ruleY,
  };
}

/** The compact strip: the same readouts in one row, for a short viewport with an
 *  open wheel. The scrim closes on the rule (no bleed) — see the note above. */
function rowClock(lines: readonly ClockLine[], scale: HudScale): ClockLayout['chrome'] & {
  offsets: { x: number; y: number }[];
} {
  const gap = hudSpace(CLOCK_ROW_GAP, scale);
  const span = lines.reduce((w, l) => w + l.width, 0) + gap * Math.max(0, lines.length - 1);
  const rowHeight = lines.reduce((h, l) => Math.max(h, l.height), 0);
  let cursor = -span / 2;
  const offsets = lines.map((l) => {
    // The three readouts are different type sizes (15/14/13 at the reference), so
    // the row centres each line box on the tallest rather than top-aligning them.
    //
    // Rounded, unlike the stacked form's zero offsets: a row shares one origin,
    // so a sub-pixel change in the match clock's width as its digits tick would
    // otherwise nudge the whole row sideways every second. Whole pixels also keep
    // 11px type off half-pixel boundaries, where it renders soft.
    const o = { x: Math.round(cursor + l.width / 2), y: Math.round((rowHeight - l.height) / 2) };
    cursor += l.width + gap;
    return o;
  });
  const width = span + hudSpace(CLOCK_CHROME_PAD_X, scale);
  const ruleY = rowHeight + hudSpace(CLOCK_RULE_GAP, scale);
  return { offsets, x: -width / 2, y: 0, width, height: ruleY, ruleY };
}

/** Just the frame scale, so the two builders above can be pure helpers. */
type HudScale = ReturnType<typeof hudMetrics>;

/**
 * Lay the wave clock out for a viewport, given the lines the view measured and
 * whether the Build & Upgrade wheel is open this frame.
 *
 * The strip stays in its stacked form unless it would run into the open wheel's
 * footprint, in which case it re-flows to a single row (see the note above).
 * `lines` are the drawn readouts in top-to-bottom / left-to-right order — the
 * view passes real text metrics, so a font swap that widens the wave name is
 * measured rather than assumed.
 */
export function waveClockLayout(
  viewportWidth: number,
  viewportHeight: number,
  lines: readonly ClockLine[],
  wheelOpen: boolean,
): ClockLayout {
  const scale = hudMetrics(viewportWidth, viewportHeight);
  const stacked = stackedClock(lines, scale);
  const wheelTop = wheelBounds(viewportWidth, viewportHeight).y;
  const compact = wheelOpen && HUD_PAD + stacked.height + CLOCK_WHEEL_GAP > wheelTop;
  const { offsets, ...chrome } = compact ? rowClock(lines, scale) : stacked;
  return {
    compact,
    lines: offsets,
    chrome,
    bounds: {
      x: viewportWidth / 2 + chrome.x,
      y: HUD_PAD + chrome.y,
      width: chrome.width,
      height: chrome.height,
    },
  };
}

// ---------------------------------------------------------------------------
// The peer-presence banner (a0-76 — who is still flying)
// ---------------------------------------------------------------------------

/** Clearance between the wave clock's scrim and the first presence line,
 *  reference px. Scaled with the frame like every other Gantry metric. */
export const PRESENCE_CLOCK_GAP = 6;
/** Leading between stacked presence lines, reference px. */
export const PRESENCE_LINE_LEADING = 15;

/** Where the presence banner's lines go, in SCREEN space. */
export interface PresenceBand {
  /** Centre-x of every line — the clock's own centre, so the two read as one
   *  column of match state rather than two unrelated readouts. */
  readonly x: number;
  /** Top-y of the first line. */
  readonly y: number;
  /** Distance from one line's top to the next. */
  readonly leading: number;
  /** The band's whole footprint — of the {@link shown} rows only. */
  readonly bounds: Rect;
  /**
   * **How many of the given rows there is room for**, top-down, before the band
   * would reach the open Build wheel.
   *
   * The banner is transient and the wheel is a thing the player is pressing right
   * now, so the wheel wins the pixels — but it wins them a row at a time rather
   * than all at once: a 1280×720 desktop with the wheel open has room for two
   * lines and not three, and answering that with silence would drop the newest
   * fact in the game to protect a wedge nothing was going to overlap. The rows
   * are newest-first ({@link ./peer-presence} `read`), so what is dropped is
   * always the oldest.
   */
  readonly shown: number;
  /** `shown > 0` — the banner draws at all this frame. */
  readonly fits: boolean;
}

/**
 * Lay the presence banner out under the wave clock, given the clock's own
 * layout and the measured height of each line the view is about to draw.
 *
 * Under the clock rather than anywhere else because that is where a player
 * already looks for match state (GDD §2.2 puts the wave clock top-centre), and
 * because every other region is spoken for: ore top-left, HOME top-right, the
 * wheel at the ship, the minimap bottom-right, the strip along the bottom.
 */
export function presenceBand(
  viewportWidth: number,
  viewportHeight: number,
  clock: ClockLayout,
  lines: readonly ClockLine[],
  wheelOpen: boolean,
): PresenceBand {
  const scale = hudMetrics(viewportWidth, viewportHeight);
  const leading = hudSpace(PRESENCE_LINE_LEADING, scale);
  const x = clock.bounds.x + clock.bounds.width / 2;
  const y = clock.bounds.y + clock.bounds.height + hudSpace(PRESENCE_CLOCK_GAP, scale);
  const wheelTop = wheelBounds(viewportWidth, viewportHeight).y;
  const spanOf = (n: number): number =>
    n <= 0 ? 0 : (n - 1) * leading + (lines[n - 1]?.height ?? 0);
  let shown = lines.length;
  while (shown > 0 && wheelOpen && y + spanOf(shown) + CLOCK_WHEEL_GAP > wheelTop) shown--;

  const widest = lines.slice(0, shown).reduce((w, l) => Math.max(w, l.width), 0);
  const height = spanOf(shown);
  const bounds: Rect = { x: x - widest / 2, y, width: widest, height };
  return { x, y, leading, bounds, shown, fits: shown > 0 };
}

// ---------------------------------------------------------------------------
// The onboarding prompt (GDD §2.10)
// ---------------------------------------------------------------------------

/** Horizontal padding inside the prompt panel at the 1280×720 reference — text
 *  box edge to panel edge on each side is half of this. Use {@link promptPad},
 *  which scales it with the HUD frame like every other Gantry metric. */
export const PROMPT_PAD_X = 40;
/** Vertical padding inside the prompt panel at the reference, CSS px. */
export const PROMPT_PAD_Y = 22;

/**
 * The prompt's padding at a given viewport — the reference numbers above run
 * through the HUD frame scale ({@link ./instrument} `hudSpace`).
 *
 * This is not tidiness: it is load-bearing on the wheel clearance. At 844×390 the
 * prompt's type scales to 12px and its line box to ~16px, so an UNSCALED 22px of
 * vertical padding would be more than the type it surrounds and would push a
 * one-line prompt 10px back up into the build wheel's bottom wedges — the exact
 * collision {@link promptBand} exists to end.
 */
export function promptPad(viewportWidth: number, viewportHeight: number): { x: number; y: number } {
  const m = hudMetrics(viewportWidth, viewportHeight);
  return { x: hudSpace(PROMPT_PAD_X, m), y: hudSpace(PROMPT_PAD_Y, m) };
}
/** The prompt's own edge. Since u7-07 the prompt wears a scrim rather than a
 *  stroked panel ({@link ./instrument} — no plates over gameplay), so nothing is
 *  drawn outside its rect any more and this term is zero. It is kept, named, and
 *  still subtracted from the wrap budget because it is the term that made the
 *  `full` + {@link HUD_PAD} claim true in the first place: if the prompt ever
 *  grows an edge again, the budget already pays for it. */
export const PROMPT_STROKE = 0;
/** Wrap floor, so a comically narrow viewport still wraps rather than clamping
 *  to zero. */
export const PROMPT_MIN_TEXT_WIDTH = 80;

/**
 * The band at the bottom of the screen the desktop controls strip owns, CSS px.
 *
 * Mirrors the strip's own drawing constants in {@link ./hud} (`STRIP_ROW` 18 +
 * `STRIP_PAD` 12) plus a hairline of air, so the prompt clears the bindings
 * legend rather than landing on it. **Desktop only** — GDD §2.2/§2.4 make the
 * strip desktop-only, and on touch the visible controls replace it, which is why
 * {@link promptBand} takes `isTouch` rather than reserving this everywhere.
 */
export const PROMPT_STRIP_RESERVE = 34;

/**
 * The width each side of a TOUCH screen the thumb controls own, CSS px.
 *
 * Mirrors `@platform/touch-visuals`' own placement — `EDGE_MARGIN` (28) +
 * `2 · R_STICK` (128) — which is the widest of the three things that can sit in a
 * bottom corner there: the left thrust stick's zone, and on the right either the
 * Manual aim zone (the same 128 px) or the narrower Auto-aim FIRE button (84 px).
 * Taking the widest means the prompt clears the thumb columns in **both** fire
 * modes without this file having to know which one is set — the same
 * mirror-a-platform-constant discipline {@link ./minimap} `MINIMAP_FIRE_COLUMN`
 * uses, and the same reason: the affordance geometry is platform's to own.
 */
export const PROMPT_THUMB_COLUMN = 156;

/** Air between the build wheel's drawn footprint and the top of the prompt band. */
export const PROMPT_WHEEL_GAP = 6;

/**
 * The onboarding prompt's type size, reference px — `./hud` `TYPE.prompt` reads
 * this rather than the other way round.
 *
 * It moved here (a0-100) because the band arithmetic now has to answer a
 * question it could not answer before: *is there room for a line of prompt at
 * all?* {@link promptWithdraws} is that question, it is asked before any text
 * has been measured, and a type size the geometry cannot see is a question it
 * cannot ask. One constant, in the module that reasons about it.
 */
export const PROMPT_TYPE = 16;

/**
 * Pixi's line box for one line of prompt type at this viewport, CSS px — the
 * scaled size times the ~1.3 leading a `Text` lays out with.
 *
 * Deliberately the same derivation `hud-geometry.test.ts` has used for the
 * prompt since u7-07, lifted out of the suite and into the module, because it is
 * now load-bearing on a *behaviour* ({@link promptWithdraws}) and not only on an
 * assertion. A model that lives in the test can disagree with the shipped rule;
 * this one cannot.
 */
export function promptLineBox(viewportWidth: number, viewportHeight: number): number {
  return Math.ceil(hudType(PROMPT_TYPE, hudMetrics(viewportWidth, viewportHeight)) * 1.3);
}

/** Air between the prompt and the minimap's collapsed corner square. */
export const PROMPT_MINIMAP_GAP = 8;

/**
 * The clear band the onboarding prompt lives in — **the answer to the collision
 * this brief was written around**, and the reason it is a function of the
 * viewport rather than the constant it replaces.
 *
 * ## What it replaces, and why the constant could not survive
 *
 * The prompt used to be centred on `PROMPT_CENTER_Y = 0.72` of the viewport
 * height: a single fraction, shared by every prompt on every screen. On a desktop
 * that lands in clear air. On a landscape phone it does not, and the numbers say
 * why — at 844×390:
 *
 *  - the build wheel is `clamp(min(844,390) × 0.36, 120, 230)` = **140 px** in
 *    radius, centred, so it spans **y 54.6 → 335.4** — 72% of the screen's height;
 *  - `0.72 × 390` = 280.8, so the prompt's band sat at **y 259 → 302**, entirely
 *    inside the wheel. The SPEND prompt fires *while the wheel is open* by design
 *    (GDD §2.10), so this is not an edge case: it is the prompt's normal state,
 *    and it covered the REPAIR REACTOR and RADAR wedges outright.
 *
 * There is **no clear horizontal band left on that screen**: the wave clock takes
 * y 16 → 70 at the top, the wheel takes 54.6 → 335.4, and the thumb controls take
 * the bottom corners from y 234 down. So the prompt cannot be *moved out* of the
 * wheel by picking a better fraction — that option does not exist at 390 px of
 * height, and pretending otherwise would have meant stealing from the wave clock
 * above or FIRE below, which the brief forbids.
 *
 * ## What it does instead
 *
 * Two changes, and they only work together:
 *
 * 1. **The prompt is bottom-anchored in the band under the wheel** rather than
 *    centred on a fraction of the screen. At 844×390 the band is y 341.4 → 374 —
 *    54.6 px of real estate that the fraction never reached — and a prompt at the
 *    HUD's own type scale is 33 px tall there, so it fits, clear of the wedges,
 *    clear of the strip's reserve, and clear of the thumb columns.
 * 2. **The prompt wraps to this band's width, not the screen's.** The band stops
 *    short of the thumb columns and of the minimap's collapsed square, so a long
 *    prompt breaks to a second line instead of running under a control. That is
 *    the trade, stated: a phone gets a taller prompt rather than a wider one.
 *
 * ## What a0-100 changed, and why "grows up into the wheel" had to go
 *
 * u7-07 shipped one more clause: when even the band could not hold the panel, the
 * panel kept its bottom edge and **grew up into the wheel**, on the argument that
 * the overlap was readable because the prompt wears a scrim ({@link ./instrument}
 * `SCRIM.prompt`) and the wedge reads through it. On QA's 798×384 capture that
 * clause is not a graceful degradation, it is the defect: the objective prompt's
 * first two lines crossed REPAIR REACTOR and RADAR, and the words stayed legible
 * only because that particular string happened to clear `0/1 BUILT` by 20 px.
 * The next string closes the gap, and nothing was arbitrating.
 *
 * Two things follow, and this function owns the first of them.
 *
 * 1. **The band is measured against the wheel's DRAWN footprint**
 *    ({@link wheelFootprint}), not its disc. The registry records 318.5 px where
 *    {@link wheelBounds} says 276.5 — the halo pool — so a band computed from the
 *    disc was 21 px optimistic, which on this screen was the whole band.
 * 2. **The band only exists while the wheel is up.** `wheelOpen` is a parameter
 *    rather than an assumption because the wheel is a thing the player opens and
 *    closes: reserving the space under it on every frame charged a closed wheel's
 *    rent forever, and on a landscape phone that meant a 32 px band for a 33 px
 *    prompt even with nothing on screen. Closed, the band is the whole safe area
 *    above the bottom margin, which is what {@link promptMaxHeight} always said
 *    it was.
 *
 * The panel can no longer leave this band in either state — {@link promptBounds}
 * clamps to it — so when the band cannot hold a prompt, the prompt is not drawn
 * short or drawn through the wedges. It **withdraws** ({@link promptWithdraws})
 * and comes back when the wheel closes. The wheel is what the player deliberately
 * opened; the prompt is ambient, and ambient yields.
 */
export function promptBand(
  viewportWidth: number,
  viewportHeight: number,
  isTouch: boolean,
  insets: MinimapInsets = {},
  wheelOpen = true,
): Rect {
  const left = HUD_PAD + Math.max(0, insets.left ?? 0);
  const right = viewportWidth - HUD_PAD - Math.max(0, insets.right ?? 0);

  // Vertical: under the wheel while one is up, above the strip (desktop) / the
  // bottom margin. With no wheel on screen there is nothing to clear and the
  // band is the whole safe area — the same ceiling `promptMaxHeight` reports.
  const bottom = promptBottom(viewportHeight, isTouch, insets);
  const wheel = wheelFootprint(viewportWidth, viewportHeight);
  const ceiling = wheelOpen ? wheel.y + wheel.height + PROMPT_WHEEL_GAP : HUD_PAD;
  const top = Math.min(bottom, ceiling);

  // Horizontal: centred, and no wider than twice its distance to the nearest
  // thing already living in that band — a thumb column, or the minimap's corner.
  const centerX = viewportWidth / 2;
  const map = collapsedRect({ width: viewportWidth, height: viewportHeight }, isTouch, insets);
  const thumb = isTouch ? PROMPT_THUMB_COLUMN : 0;
  const leftLimit = left + thumb;
  const rightLimit = Math.min(right - thumb, map.width > 0 ? map.x - PROMPT_MINIMAP_GAP : right);
  const half = Math.max(
    (PROMPT_MIN_TEXT_WIDTH + promptPad(viewportWidth, viewportHeight).x) / 2,
    Math.min(centerX - leftLimit, rightLimit - centerX),
  );

  return {
    x: centerX - half,
    y: top,
    width: half * 2,
    height: Math.max(0, bottom - top),
  };
}

/**
 * The width the prompt's text box wraps at, CSS px.
 *
 * **This is the whole reason the prompt can claim an anchor at all.** The prompt
 * is a sentence, and a sentence is intrinsically wider than any third-width band
 * in the anchor vocabulary — "Hold the FIRE button on the asteroid — your shots
 * chip the rock" is ~440 px on one line, wider than a 390 px portrait phone. So the
 * prompt does not get an anchor band; it gets the screen, and the contract it
 * signs is that it *never leaves* it (`full` + {@link HUD_PAD}, see
 * `Hud.describeLayout`).
 *
 * Wrapping here is what makes that contract true rather than hopeful — and since
 * u7-07 it makes a second promise true as well: the box is
 * {@link promptBand}'s width rather than the viewport's, so a wrapped prompt also
 * cannot run under a thumb stick or the minimap. `promptWidth = textWidth +
 * PROMPT_PAD_X + PROMPT_STROKE`, so wrapping at
 * `band − PROMPT_PAD_X − PROMPT_STROKE` lands the panel exactly on the band's
 * edge in the worst case and inside it in every other.
 */
export function promptWrapWidth(
  viewportWidth: number,
  viewportHeight: number,
  isTouch: boolean,
  insets: MinimapInsets = {},
): number {
  const band = promptBand(viewportWidth, viewportHeight, isTouch, insets);
  const pad = promptPad(viewportWidth, viewportHeight);
  return Math.max(PROMPT_MIN_TEXT_WIDTH, band.width - pad.x - PROMPT_STROKE);
}

/**
 * The onboarding prompt's drawn footprint: a panel sized to its (already
 * wrapped) text box, centred horizontally and hung from the bottom of
 * {@link promptBand}.
 *
 * `textWidth`/`textHeight` are the measured metrics of the wrapped text — the
 * registry records what was actually drawn, so the caller passes real numbers
 * rather than the ceiling. Feed {@link promptWrapWidth} to get the worst case.
 *
 * ## The band is a hard bound too, in both directions (a0-100)
 *
 * The height is clamped to {@link promptBand}'s, not only to the safe area, so
 * the panel cannot leave the band at the top either. That is what makes "the
 * prompt never intersects the wheel" true by construction rather than by
 * arithmetic that has to be re-checked every time a string changes: the band is
 * defined as the room *outside* {@link wheelFootprint}, and the rect returned
 * here is inside the band. A prompt whose measured text does not fit the clamp
 * is not squeezed into it — {@link promptWithdraws} says so first, and the view
 * does not draw it at all.
 *
 * ## The bottom edge is a hard bound, not a preference (a0-24)
 *
 * The panel hangs from the bottom of {@link promptBand}, so its bottom edge is
 * `viewportHeight − HUD_PAD − insets.bottom` for every prompt that fits. The
 * clamp that keeps an over-tall panel on screen used to be written
 * `y = max(HUD_PAD, bandBottom − height)`, and the comment claimed the panel
 * "grows upward into the wheel". It does not: pinning `y` at the top margin and
 * keeping the full height pushes the **bottom** edge to `HUD_PAD + height`, which
 * is past the band, past the safe-area inset and — for a tall enough panel — past
 * the viewport itself. A prompt cut off mid-sentence by the bottom of the screen
 * is the exact failure a0-24 was filed for, and it is length-dependent because
 * `height` is the wrapped text's height.
 *
 * So the bottom is clamped first and the top second: the panel keeps its bottom
 * edge on the safe-area line whatever its height, and only its **top** is allowed
 * to run up into the wheel (where the scrim makes it readable, u7-07). When even
 * that is not enough — a panel taller than the whole safe area — the top is held
 * at the HUD margin and {@link promptMaxHeight} is what the view should have
 * wrapped/shrunk against; the rect returned is still inside the screen, because a
 * clipped instruction is worse than a cramped one (GDD §2.10).
 */
export function promptBounds(
  viewportWidth: number,
  viewportHeight: number,
  textWidth: number,
  textHeight: number,
  isTouch = false,
  insets: MinimapInsets = {},
  wheelOpen = true,
): Rect {
  const band = promptBand(viewportWidth, viewportHeight, isTouch, insets, wheelOpen);
  const pad = promptPad(viewportWidth, viewportHeight);
  const width = Math.min(textWidth + pad.x + PROMPT_STROKE, band.width);
  const height = Math.min(
    textHeight + pad.y + PROMPT_STROKE,
    promptMaxHeight(viewportHeight, isTouch, insets),
    // The band, which is the wheel's clearance made a number (a0-100). Never
    // wider than the safe area above, so this is the binding clamp whenever a
    // wheel is open and the ceiling above whenever one is not.
    band.height,
  );
  const bottom = band.y + band.height;
  return {
    x: viewportWidth / 2 - width / 2,
    y: bottom - height,
    width,
    height,
  };
}

/**
 * Does the onboarding prompt have to withdraw from this screen — is there no
 * band left for it to be drawn in?
 *
 * ## The arbitration a0-100 asked for, in one predicate
 *
 * Two owned surfaces were sharing pixels on the narrowest supported width with
 * nothing deciding between them. This is the decision, and it goes against the
 * prompt: the build wheel is what the player deliberately opened and its wedges
 * carry the only numbers GDD §2.5 lets the wheel show, while a prompt is ambient
 * — it fires on a trigger nobody asked for. So while a wheel is up and the room
 * under it cannot hold one line of prompt at its own type scale, the prompt is
 * not drawn, not registered, and not counted as having fired.
 *
 * **Withdrawal is a deferral, not a discard.** `./onboarding` is told (its
 * `bandClear` signal), so the frame accrues no dwell and the prompt returns
 * intact the moment the wheel closes — `./hud` `updateOnboarding`. GDD §2.10's
 * "each fires once" is a promise about lessons learned, and a lesson nobody could
 * read was not learned.
 *
 * ## Two questions, one predicate
 *
 * `textHeight` is the measured height of the wrapped text, and passing it asks
 * the exact question — *does THIS panel fit?* Leaving it out substitutes one line
 * box ({@link promptLineBox}) and asks the screen-level one — *could ANY prompt
 * fit?* The view asks the first, because it has measured the string it is about
 * to draw; a test or a caller reasoning about a device profile asks the second,
 * because it is a property of the screen rather than of whichever sentence
 * happens to be eligible. The band's width does not depend on the wheel, so
 * wrapping is settled before either question is asked: what the wheel takes is
 * height, and height comes in line boxes.
 *
 * On the matrix the screen-level answer is `true` for exactly the landscape
 * phones — 798×384, 844×390, 915×412, 568×320 — where the wheel's footprint takes
 * 83% of the height and the room under it is about 11 px. Portrait phones and the
 * desktop keep their prompt with the wheel open, moved down by the halo they were
 * previously ignoring.
 */
export function promptWithdraws(
  viewportWidth: number,
  viewportHeight: number,
  isTouch: boolean,
  insets: MinimapInsets = {},
  wheelOpen = true,
  textHeight?: number,
): boolean {
  const band = promptBand(viewportWidth, viewportHeight, isTouch, insets, wheelOpen);
  const pad = promptPad(viewportWidth, viewportHeight);
  const ink = textHeight ?? promptLineBox(viewportWidth, viewportHeight);
  return band.height + 1e-6 < ink + pad.y + PROMPT_STROKE;
}

/**
 * The tallest the prompt panel may be on this screen, CSS px: the safe-area band
 * between the HUD's top margin and the bottom edge the panel hangs from.
 *
 * This is the number the view wraps and shrinks against, and the ceiling
 * {@link promptBounds} caps at — the two are one computation so a panel can never
 * be drawn taller than the rect the registry is handed. On a landscape phone with
 * no safe-area crop it is 358 px, which no authored prompt comes close to; it
 * bites when the visible viewport is cropped (a browser bar, a home indicator)
 * and the room under the wheel collapses.
 */
export function promptMaxHeight(
  viewportHeight: number,
  isTouch: boolean,
  insets: MinimapInsets = {},
): number {
  return Math.max(0, promptBottom(viewportHeight, isTouch, insets) - HUD_PAD);
}

/**
 * The line the prompt panel's bottom edge sits on, CSS px from the top of the
 * viewport — the HUD margin above the **visible** bottom, less the desktop
 * controls strip's reserve.
 *
 * `insets.bottom` is what makes this the *visible* bottom rather than the
 * canvas's. The HUD is laid out against the renderer's logical viewport, which on
 * a phone browser is taller than the region the player can see: a URL bar, a
 * home indicator, or a fullscreen transition crops the bottom off the canvas
 * without resizing it (`main.ts` `readViewport`). Everything anchored to the top
 * survives that; a bottom-anchored panel is drawn into the crop. Feeding the crop
 * in here is what puts the prompt back on screen — see `HudFrame.safeInsets`,
 * which `main.ts` now populates from the live visual viewport and the device's
 * own `env(safe-area-inset-*)`.
 */
function promptBottom(viewportHeight: number, isTouch: boolean, insets: MinimapInsets): number {
  const bottomInset = Math.max(0, insets.bottom ?? 0);
  return viewportHeight - HUD_PAD - bottomInset - (isTouch ? 0 : PROMPT_STRIP_RESERVE);
}

// ---------------------------------------------------------------------------
// The respawn countdown overlay ("RESPAWNING 3…", field request v0.2.2)
// ---------------------------------------------------------------------------

/** Horizontal padding inside the countdown panel at the 1280×720 reference, CSS
 *  px (text box edge to panel edge on each side is half of this). Use
 *  {@link respawnPad}, which scales it with the HUD frame. */
export const RESPAWN_PAD_X = 36;
/** Vertical padding inside the countdown panel at the reference, CSS px. */
export const RESPAWN_PAD_Y = 18;

/** The countdown's padding at a given viewport — the same frame scale the prompt
 *  takes ({@link promptPad}), so the two overlays are one family on a phone. */
export function respawnPad(viewportWidth: number, viewportHeight: number): { x: number; y: number } {
  const m = hudMetrics(viewportWidth, viewportHeight);
  return { x: hudSpace(RESPAWN_PAD_X, m), y: hudSpace(RESPAWN_PAD_Y, m) };
}
/** The countdown's own edge. Zero since u7-07, for the same reason the prompt's
 *  is ({@link PROMPT_STROKE}): the overlay wears a scrim rather than a stroked
 *  panel. Kept and still subtracted from the wrap budget, so the `full` +
 *  {@link HUD_PAD} claim survives the day an edge comes back. */
export const RESPAWN_STROKE = 0;
/** The countdown's vertical centre, as a fraction of viewport height. Dead centre
 *  — where the ship exploded and the camera stays (field request), and clear
 *  because a dead ship draws nothing under it. */
export const RESPAWN_CENTER_Y = 0.5;
/** Wrap floor, so a comically narrow viewport still wraps rather than clamping to
 *  zero. */
export const RESPAWN_MIN_TEXT_WIDTH = 80;

/**
 * The width the countdown's text box wraps at, CSS px — the same discipline as
 * {@link promptWrapWidth}. "RESPAWNING 3..." at a prominent type size is wider
 * than a third-width band, so the overlay takes the screen and signs the weaker,
 * keepable promise instead: it never leaves the HUD margin (`full` + {@link
 * HUD_PAD}, see `Hud.describeLayout`). Wrapping at
 * `W − 2·HUD_PAD − RESPAWN_PAD_X − RESPAWN_STROKE` makes the *stroked* panel land
 * exactly on that margin in the worst case and inside it otherwise.
 */
export function respawnWrapWidth(viewportWidth: number, viewportHeight = viewportWidth): number {
  return Math.max(
    RESPAWN_MIN_TEXT_WIDTH,
    viewportWidth - 2 * HUD_PAD - respawnPad(viewportWidth, viewportHeight).x - RESPAWN_STROKE,
  );
}

/**
 * The respawn countdown's drawn footprint: a panel sized to its (already wrapped)
 * text box, centred horizontally and on {@link RESPAWN_CENTER_Y}.
 *
 * `textWidth`/`textHeight` are the measured metrics of the drawn text — the
 * registry records what was actually drawn — so the caller passes real numbers;
 * feed {@link respawnWrapWidth} to get the worst case.
 */
export function respawnBounds(
  viewportWidth: number,
  viewportHeight: number,
  textWidth: number,
  textHeight: number,
): Rect {
  const pad = respawnPad(viewportWidth, viewportHeight);
  const width = textWidth + pad.x + RESPAWN_STROKE;
  const height = textHeight + pad.y + RESPAWN_STROKE;
  return {
    x: viewportWidth / 2 - width / 2,
    y: viewportHeight * RESPAWN_CENTER_Y - height / 2,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// The under-attack alarm (GDD §2.2 — a mechanic, not polish)
// ---------------------------------------------------------------------------

/** Stroke width of the threat-red screen frame, CSS px. */
export const ALARM_FRAME_STROKE = 4;
/** Inset of the frame's *path* from the viewport edge, CSS px. Half the stroke
 *  sits outside it, which is what puts the drawn frame flush with the screen. */
export const ALARM_FRAME_INSET = 2;

/** The alarm frame's drawn footprint. A centred stroke on a path inset by
 *  {@link ALARM_FRAME_INSET} lands the frame flush with the viewport edges —
 *  which is the point: it frames the *screen*, not a box inside it. */
export function alarmFrameBounds(viewportWidth: number, viewportHeight: number): Rect {
  const half = ALARM_FRAME_STROKE / 2;
  const x = ALARM_FRAME_INSET - half;
  const y = ALARM_FRAME_INSET - half;
  return {
    x,
    y,
    width: viewportWidth - 2 * ALARM_FRAME_INSET + ALARM_FRAME_STROKE,
    height: viewportHeight - 2 * ALARM_FRAME_INSET + ALARM_FRAME_STROKE,
  };
}

/** Screen-edge arrow triangle size, CSS px (tip length from the anchor point). */
export const ARROW_SIZE = 15;

/**
 * The screen-edge arrow's triangle, as a flat `[x0,y0, x1,y1, x2,y2]` polygon —
 * a tip pointing along `arrow.angle` with two swept-back corners behind it.
 * The view draws exactly this; the test measures exactly this.
 */
export function arrowPoly(arrow: HomeArrow, size: number = ARROW_SIZE): number[] {
  const cos = Math.cos(arrow.angle);
  const sin = Math.sin(arrow.angle);
  const tipX = arrow.x + cos * size;
  const tipY = arrow.y + sin * size;
  const backX = arrow.x - cos * size * 0.5;
  const backY = arrow.y - sin * size * 0.5;
  const nx = -sin * size * 0.7;
  const ny = cos * size * 0.7;
  return [tipX, tipY, backX + nx, backY + ny, backX - nx, backY - ny];
}

/** Axis-aligned bounds of a flat `[x,y, x,y, …]` polygon — the rect the arrow
 *  actually occupies, which is what the registry records. */
export function polyBounds(poly: readonly number[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    const x = poly[i] as number;
    const y = poly[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

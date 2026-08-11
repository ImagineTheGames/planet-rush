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
import type { HomeArrow } from './alarm';
import { hudMetrics, hudSpace } from './instrument';
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

// --- One wedge: is it thumb-sized, and do its words fit? (u7-02) ------------
//
// The Gantry/Bone pass puts four lines of text on a wedge — the name, what it
// spends on, the cost, and the count over its cap — inside a fixed radial
// space. On a 390 px phone that space is 95 px deep and ~115 px across, and a
// line that runs past it crosses a spoke into its neighbour. l2-02's copy
// overflowed its chrome for exactly this reason and only the phone profiles
// caught it, so the budget is computed here, in the pure layer, where a test can
// hold every worst-case string to it (./hud-geometry.test.ts).

/**
 * The width available to a wedge's words at a given radius, CSS px: the chord of
 * the wedge's arc there, less a margin so a line stops short of the spokes rather
 * than touching them.
 *
 * A radial menu narrows as it approaches the hub, which is why the word stack
 * hangs from the rim (where the arc is widest) rather than centring in the ring —
 * the *last* line of a four-line stack is the one this budget bites on.
 */
export function wedgeChordWidth(
  radiusAtLine: number,
  segments: number,
  margin = WEDGE_TEXT_MARGIN,
): number {
  if (segments <= 0 || radiusAtLine <= 0) return 0;
  const half = Math.PI / segments;
  return Math.max(0, 2 * radiusAtLine * Math.sin(half) - 2 * margin);
}

/** Clearance a wedge's words keep from the spoke on each side, CSS px. */
export const WEDGE_TEXT_MARGIN = 4;

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
 * The wheel's drawn footprint: a `2r` square centred on the screen. The follow
 * camera keeps the local ship — and so the station it is docked at — at the
 * viewport centre, which is what GDD §2.2's "the wheel when near your own
 * station" resolves to in screen space.
 */
export function wheelBounds(viewportWidth: number, viewportHeight: number): Rect {
  const r = wheelRadius(viewportWidth, viewportHeight);
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
export function stationHpBounds(viewportWidth: number, labelWidth = 0): Rect {
  const width = Math.max(HP_BAR_WIDTH, labelWidth);
  return {
    x: viewportWidth - HUD_PAD - width,
    y: HUD_PAD,
    width,
    height: HP_BAR_TOP + HP_BAR_HEIGHT,
  };
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
   *  record, and the rect the clock/wheel clearance is asserted on
   *  ({@link rectsIntersect} against {@link wheelBounds}). */
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

/** Do two rects overlap at all? Touching edges do not count as an overlap — the
 *  clock clearing the wheel by exactly zero is still clear. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
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

/** Air between the build wheel's bottom edge and the top of the prompt band. */
export const PROMPT_WHEEL_GAP = 6;

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
 * When even the band cannot hold the panel (a four-line prompt on a 320 px
 * screen), the panel keeps its bottom edge and grows up into the wheel — and
 * that overlap is now *readable*, because the prompt lost its opaque panel in the
 * same change ({@link ./instrument} `SCRIM.prompt`) and the wedge reads through
 * it. Degrading into transparency is the whole point of the material rule.
 */
export function promptBand(
  viewportWidth: number,
  viewportHeight: number,
  isTouch: boolean,
  insets: MinimapInsets = {},
): Rect {
  const left = HUD_PAD + Math.max(0, insets.left ?? 0);
  const right = viewportWidth - HUD_PAD - Math.max(0, insets.right ?? 0);

  // Vertical: under the wheel, above the strip (desktop) / the bottom margin.
  const wheel = wheelBounds(viewportWidth, viewportHeight);
  const bottom = promptBottom(viewportHeight, isTouch, insets);
  const top = Math.min(bottom, wheel.y + wheel.height + PROMPT_WHEEL_GAP);

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
): Rect {
  const band = promptBand(viewportWidth, viewportHeight, isTouch, insets);
  const pad = promptPad(viewportWidth, viewportHeight);
  const width = Math.min(textWidth + pad.x + PROMPT_STROKE, band.width);
  const height = Math.min(
    textHeight + pad.y + PROMPT_STROKE,
    promptMaxHeight(viewportHeight, isTouch, insets),
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

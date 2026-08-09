/**
 * src/ui/lobby-geometry.test.ts — the lobby's LAYOUT CONTRACT, headless.
 *
 * Same discipline as `./hud-geometry.test.ts`, for the same reason: QA's live
 * layout contract measures a frozen golden scene *inside a match*, so it never
 * sees the lobby at all. Every device profile in QA's matrix — portrait and
 * landscape, plus the two smallest phones the game claims to run on (GDD §4.3)
 * — is therefore asserted here, against the registry's own resolver and its own
 * containment verdict.
 *
 * What the assertions defend, in the order they'd bite on a real phone:
 *
 *  1. **Nothing escapes the safe content box.** A notch, a home indicator or a
 *     rounded corner must not be able to eat the room code the room is reading
 *     aloud, and the lobby declares `full` to the registry (`./lobby-view`).
 *  2. **Nothing overlaps.** Eight roster rows and four hull tiles are all tap
 *     targets; two rects that overlap are two taps that disagree.
 *  3. **A tap hits what it looks like it hits.** `lobbyHitTest` is tested
 *     against the same layout object the view draws from, never a second copy.
 *  4. **The thumb-scale promise, which u7-03 made much stronger.** RUSH! and
 *     BACK clear 48px on every viewport in the matrix, notch or none — including
 *     the ones whose footer beam is itself under the floor. And on a phone in
 *     LANDSCAPE, the orientation this screen is actually used in, **every control
 *     on every roster row** clears it: the row, its state control, its side chip
 *     and its difficulty chip. That last promise is what the layout was
 *     restructured for, so it is asserted per row and per control rather than
 *     sampled. The iPhone SE is the one device where that promise is deliberately
 *     NOT made, and it is asserted by name with the trade it takes instead.
 *  5. **The row-composition guarantees survived the move.** The difficulty chip's
 *     max-fraction, the row body staying tappable, and the side chip never being
 *     a stub — all re-derived at the narrowest row the layout now produces, and
 *     derived from the constants rather than restated as numbers, so widening a
 *     chip moves the assertion with it instead of quietly breaking a row.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { Rect, Viewport } from '@platform/layout-registry';
import { TOUCH_MIN, rosterRowHeight, frameMetrics } from '../art/materials';
import { CLASS_OPTIONS, LOBBY_SLOTS } from './lobby';
import {
  CLASS_HULL_LINE,
  CLASS_NAME_LINE,
  CLASS_TILE_COMPACT,
  CLASS_TILE_MIN,
  CLASS_TILE_MIN_WIDTH,
  CLASS_TILE_PAD,
  PICK_CARD_MIN_WIDTH,
  SEAT_CHIP_MAX_FRACTION,
  SEAT_CHIP_MIN,
  SEAT_HELP_MIN,
  SEAT_HELP_WIDTH,
  SEAT_CHIP_PAD,
  SEAT_CHIP_WIDTH,
  SEAT_ROW_BODY_MIN,
  SEAT_ROW_MIN_WIDTH,
  SEAT_STATE_MAX_FRACTION,
  SEAT_ROW_FULL_WIDTH,
  SEAT_STATE_MIN,
  SEAT_STRIPE,
  SEAT_TEAM_CHIP_MIN,
  SEAT_TEAM_CHIP_WIDTH,
  STAT_CELL_FLOOR,
  STAT_CELL_GAP,
  STAT_COUNT,
  TWO_COLUMN_MIN_WIDTH,
  TWO_ROSTER_MIN_WIDTH,
  classStatCell,
  classTileContent,
  lobbyHitTest,
  lobbyLayout,
  seatBodyEnd,
  statGridHeight,
} from './lobby-geometry';
import type { LobbyLayout } from './lobby-geometry';

interface Profile {
  readonly name: string;
  readonly vp: Viewport;
  /** Touch profiles are the phones and tablets; the desktops are not. */
  readonly touch: boolean;
}

const PROFILES: readonly Profile[] = [
  { name: 'iphone/portrait', vp: { width: 390, height: 844 }, touch: true },
  { name: 'iphone/landscape', vp: { width: 844, height: 390 }, touch: true },
  { name: 'pixel/portrait', vp: { width: 412, height: 915 }, touch: true },
  { name: 'pixel/landscape', vp: { width: 915, height: 412 }, touch: true },
  { name: 'ipad/portrait', vp: { width: 820, height: 1180 }, touch: true },
  { name: 'iphone-se/portrait', vp: { width: 375, height: 667 }, touch: true },
  { name: 'small/portrait', vp: { width: 320, height: 568 }, touch: true },
  { name: 'desktop', vp: { width: 1280, height: 800 }, touch: false },
  { name: 'desktop/wide', vp: { width: 1920, height: 1080 }, touch: false },
];

/**
 * The safe-area insets a notched handset reports, per orientation — portrait
 * loses the notch off the top and the home indicator off the bottom; landscape
 * loses the notch off whichever side it is on (both sides are tested at once,
 * which is the worst case) and a slimmer indicator off the bottom.
 */
const PORTRAIT_INSETS = { top: 47, right: 0, bottom: 34, left: 0 };
const LANDSCAPE_INSETS = { top: 0, right: 47, bottom: 21, left: 47 };

const insetsFor = (vp: Viewport) =>
  vp.width > vp.height ? LANDSCAPE_INSETS : PORTRAIT_INSETS;

const fmt = (r: Rect): string =>
  `{x:${r.x.toFixed(1)}, y:${r.y.toFixed(1)}, w:${r.width.toFixed(1)}, h:${r.height.toFixed(1)}}`;

function allRects(layout: LobbyLayout): Array<{ label: string; rect: Rect }> {
  return [
    { label: 'title', rect: layout.title },
    { label: 'roomCode', rect: layout.roomCode },
    { label: 'leave', rect: layout.leave },
    { label: 'rushHint', rect: layout.rushHint },
    { label: 'modeToggle', rect: layout.modeToggle },
    { label: 'abundance', rect: layout.abundance },
    ...layout.seats.map((rect, i) => ({ label: `seat[${i}]`, rect })),
    // ONE ship card and ONE arena card since u10-01 — the pick, twice. The four
    // hull tiles and the six arena cards are on their own screens now, with their
    // own containment suites (`./ship-select.test.ts`, `./map-select.test.ts`).
    { label: 'shipPick', rect: layout.shipPick },
    { label: 'mapPick', rect: layout.mapPick },
    { label: 'rushButton', rect: layout.rushButton },
  ];
  // NB: seatChips AND seatTeamChips are DELIBERATELY absent — they nest inside
  // their roster row (the row body cycles state, the difficulty chip cycles the
  // tier, the team chip cycles the side), so they overlap a seat by design and are
  // contained-checked separately (see the chip test). So are `header` / `footer`,
  // which are the BEAMS: a beam is structure and runs to the safe-area edge,
  // outside the page margin `content` is inset by (`./gantry`).
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

const center = (r: Rect): { x: number; y: number } => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/**
 * A point in a roster row's BODY zone — the strip between the row's LEADING state
 * control (u5) and the first pixel a trailing chip may occupy.
 *
 * It is DERIVED from the drawn rects, through the layout's own
 * {@link seatBodyEnd}, rather than restated here: the body used to be "the row's
 * leading 36%" because nothing else was ever laid out at the front of a row; u5
 * put a control there and u7-03 made the rule absolute, so a fraction would now
 * name a point on the control and call it the body. One geometry, never a second
 * copy of the arithmetic — the same discipline the hit test keeps.
 */
const bodyPoint = (layout: LobbyLayout, i: number): { x: number; y: number } => {
  const seat = layout.seats[i]!;
  const state = layout.seatStates[i]!;
  const left = state.width > 0 ? state.x + state.width : seat.x;
  const right = seatBodyEnd(seat, state);
  return { x: (left + right) / 2, y: seat.y + seat.height / 2 };
};

/** The widest side label the chip ever carries — `FRIENDLY A` — in CSS px at the
 *  chip's 11px Audiowide, measured in the studio container (`ENEMY B` is 50,
 *  `TEAM A` was 41). Geometry runs in node with no font to measure, so the number
 *  is stated here and the constant it justifies lives next door
 *  (`SEAT_TEAM_CHIP_WIDTH` = 88 = this + its padding, rounded up). */
const LONGEST_SIDE_LABEL_PX = 64;
/** Mirrors `lobby-view`'s own `TEAM_CHIP_LABEL_PAD` — the inset the word keeps. */
const TEAM_CHIP_LABEL_PAD = 6;
/** …and the row width at which the side chip can therefore hold that word at full
 *  size. DERIVED rather than stated: on a row of `W`, the side chip's right edge
 *  is `W − SEAT_HELP_WIDTH − SEAT_CHIP_PAD − SEAT_CHIP_WIDTH − SEAT_CHIP_PAD` and
 *  its left edge is {@link seatBodyEnd}, so `W` has to satisfy
 *  `W − ? − pad − tier − pad − (bar + stateFraction·W + body) ≥ word + 2·pad`.
 *
 *  **The `?` is in the numerator since a0-06**, and this is the honest half of
 *  adding a fifth segment: the row width at which the side word survives on ONE
 *  line went up by the `?` and its pad, so the split landscape phone stacks the
 *  word where before it just about did not. Both halves of the ratified
 *  `WORD + LETTER` grammar still survive (`lobby-view` `drawTeamChip`) — only the
 *  line break moved, on rows that were already stacking at the notch. */
const SIDE_WORD_ROW_WIDTH =
  (SEAT_HELP_WIDTH +
    SEAT_CHIP_PAD +
    SEAT_CHIP_WIDTH +
    SEAT_CHIP_PAD +
    SEAT_STRIPE +
    SEAT_ROW_BODY_MIN +
    LONGEST_SIDE_LABEL_PX +
    2 * TEAM_CHIP_LABEL_PAD) /
  (1 - SEAT_STATE_MAX_FRACTION);

// ---------------------------------------------------------------------------
// 1. Containment
// ---------------------------------------------------------------------------

describe('the lobby stays inside the screen it was given', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`keeps every rect inside the content box — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: touch });
      for (const { label, rect } of allRects(layout)) {
        expect(
          rectContains(layout.content, rect),
          `${label} ${fmt(rect)} escapes content ${fmt(layout.content)} on ${name}`,
        ).toBe(true);
      }
    });

    it(`honours the safe area — ${name}`, () => {
      // The one failure mode that is invisible on a simulator and obvious on a
      // real handset: a code drawn under the notch.
      const insets = insetsFor(vp);
      const layout = lobbyLayout(vp, { isTouch: touch, insets });
      expect(layout.content.y).toBeGreaterThanOrEqual(insets.top);
      expect(layout.content.x).toBeGreaterThanOrEqual(insets.left);
      expect(layout.content.x + layout.content.width).toBeLessThanOrEqual(
        vp.width - insets.right + 1e-9,
      );
      expect(layout.content.y + layout.content.height).toBeLessThanOrEqual(
        vp.height - insets.bottom + 1e-9,
      );
      for (const { label, rect } of allRects(layout)) {
        expect(
          rectContains(layout.content, rect),
          `${label} ${fmt(rect)} escapes the safe content box on ${name}`,
        ).toBe(true);
      }
    });

    it(`sits inside the "full" anchor it declares to the registry — ${name}`, () => {
      // `LobbyView.describeLayout` registers the content box under `full`; the
      // registry's own resolver and verdict function decide, not a re-derivation.
      const layout = lobbyLayout(vp, { isTouch: touch });
      expect(rectContains(resolveAnchor({ region: 'full' }, vp), layout.content)).toBe(true);
    });
  }

  it('degrades to zero-extent rather than to a backwards box on a tiny viewport', () => {
    const layout = lobbyLayout({ width: 10, height: 10 }, { isTouch: true });
    for (const { label, rect } of allRects(layout)) {
      expect(rect.width, label).toBeGreaterThanOrEqual(0);
      expect(rect.height, label).toBeGreaterThanOrEqual(0);
    }
    expect(layout.content.width).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Shape
// ---------------------------------------------------------------------------

describe('the roster and the hull tiles', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`lays out eight rows and four tiles without overlap — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: touch });
      expect(layout.seats).toHaveLength(LOBBY_SLOTS);
      // **ONE ship card and ONE arena card** (u10-01, the developer: *"we should
      // only show 1 ship and 1 map in lobby because it's too cluttered now"*).
      // Stated as the SHAPE of the layout rather than as a count of an array,
      // because that is what makes it un-regressable: there is no array here to
      // grow back to four, and the four hull tiles and six arena cards a reader
      // might look for live on `./ship-select` and `./map-select` instead.
      for (const [label, rect] of [
        ['ship card', layout.shipCard],
        ['arena card', layout.mapCard],
      ] as const) {
        expect(rect.width, `${label} missing on ${name}`).toBeGreaterThan(0);
        expect(rect.height, `${label} missing on ${name}`).toBeGreaterThan(0);
      }
      // …and each card sits inside its own pressable block, which is what the hit
      // test registers (the eyebrow strip is part of the control, not beside it).
      expect(rectContains(layout.shipPick, layout.shipCard), `ship card escapes its block on ${name}`).toBe(true);
      expect(rectContains(layout.mapPick, layout.mapCard), `arena card escapes its block on ${name}`).toBe(true);
      expect(rectContains(layout.shipPick, layout.shipLabel), `ship eyebrow escapes its block on ${name}`).toBe(true);
      expect(rectContains(layout.mapPick, layout.mapLabel), `arena eyebrow escapes its block on ${name}`).toBe(true);

      const rects = allRects(layout).filter((r) => r.label !== 'title');
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!;
          const b = rects[j]!;
          expect(
            overlaps(a.rect, b.rect),
            `${a.label} ${fmt(a.rect)} overlaps ${b.label} ${fmt(b.rect)} on ${name}`,
          ).toBe(false);
        }
      }
    });

    it(`draws the roster in slot order, down each column — ${name}`, () => {
      // One column on a tall screen, two of four on a short one — either way a
      // slot's row is below the slot before it *in its own column*, so the
      // roster reads P1…P8 rather than jumping about.
      const layout = lobbyLayout(vp, { isTouch: touch });
      const perColumn = layout.seats.length / layout.seatColumns;
      for (let i = 1; i < layout.seats.length; i++) {
        const seat = layout.seats[i]!;
        const previous = layout.seats[i - 1]!;
        if (i % perColumn === 0) {
          expect(seat.x, `column break at slot ${i} on ${name}`).toBeGreaterThan(previous.x);
          expect(seat.y).toBeCloseTo(layout.seats[0]!.y, 6);
        } else {
          expect(seat.y).toBeGreaterThan(previous.y);
          expect(seat.x).toBeCloseTo(previous.x, 6);
        }
        expect(seat.height).toBeCloseTo(layout.seats[0]!.height, 6);
      }
    });
  }

  it('splits into two columns only once there is width for them', () => {
    const wide = lobbyLayout({ width: 1280, height: 800 });
    const narrow = lobbyLayout({ width: 390, height: 844 }, { isTouch: true });

    expect(wide.twoColumn).toBe(true);
    // Roster on the left, the two summary cards on the right, both spanning the
    // same band.
    expect(wide.shipPick.x).toBeGreaterThan(wide.seats[0]!.x + wide.seats[0]!.width - 1);
    expect(wide.mapPick.x).toBeGreaterThan(wide.seats[0]!.x + wide.seats[0]!.width - 1);

    expect(narrow.twoColumn).toBe(false);
    // The cards go BELOW the roster in one column — and side by side wherever the
    // band can hold two (u10-01), because the height that buys goes to the roster,
    // which is what the developer's report is ultimately about.
    expect(narrow.shipPick.y).toBeGreaterThan(narrow.seats[7]!.y);
    expect(narrow.mapPick.y).toBeGreaterThan(narrow.seats[7]!.y);
  });

  it('gives the two cards a ROW where the band can hold one, and stacks them otherwise', () => {
    // A 390px phone in portrait: 364px of band, two ~176px halves — both over
    // PICK_CARD_MIN_WIDTH, so they sit side by side and the roster keeps the
    // height a stacked pair would have cost it.
    const phone = lobbyLayout({ width: 390, height: 844 }, { isTouch: true });
    expect(phone.pickRow).toBe(true);
    expect(phone.shipPick.width).toBeGreaterThanOrEqual(PICK_CARD_MIN_WIDTH);
    expect(phone.mapPick.y).toBeCloseTo(phone.shipPick.y, 6);
    expect(phone.mapPick.x).toBeGreaterThan(phone.shipPick.x);

    // …and a band too narrow to halve stacks them rather than producing two cards
    // no hull name fits on. Dropping to a stack is the fallback, never the default.
    const sliver = lobbyLayout({ width: 320, height: 900 });
    expect(sliver.band.width).toBeLessThan(2 * PICK_CARD_MIN_WIDTH);
    expect(sliver.pickRow).toBe(false);
    expect(sliver.mapPick.y).toBeGreaterThan(sliver.shipPick.y);
    expect(sliver.mapPick.x).toBeCloseTo(sliver.shipPick.x, 6);
  });

  it('is decided by BAND width, not by device — a narrow desktop window is a phone layout', () => {
    // The threshold is read against the band the frame resolved, not the raw
    // viewport: the Gantry margin is the handoff's 44 scaled, so a 600px window
    // has a 558px band and stays one column.
    const window600 = lobbyLayout({ width: 600, height: 900 });
    expect(window600.band.width).toBeLessThan(TWO_COLUMN_MIN_WIDTH);
    expect(window600.twoColumn).toBe(false);
    expect(lobbyLayout({ width: 1024, height: 700 }, { isTouch: true }).twoColumn).toBe(true);
  });

  it('bounds the ship-select column by the BAND, so nothing crowds the separator', () => {
    // The handoff's own rule for this screen, and the reason the arena row moved
    // out of the full width of the band into the right column: the roster gets
    // the whole band, the right column gets the whole band, and the 1px rule
    // between them has clear air on both sides at every width.
    for (const { name, vp, touch } of PROFILES) {
      const layout = lobbyLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      if (!layout.twoColumn) {
        expect(layout.separator.width, `separator drawn in one column on ${name}`).toBe(0);
        continue;
      }
      expect(layout.separator.width, `no separator on ${name}`).toBeGreaterThan(0);
      expect(layout.separator.y).toBeCloseTo(layout.band.y, 6);
      expect(layout.separator.height).toBeCloseTo(layout.band.height, 6);
      expect(layout.shipColumn.y).toBeCloseTo(layout.band.y, 6);
      expect(layout.shipColumn.height).toBeCloseTo(layout.band.height, 6);
      expect(rectContains(layout.band, layout.shipColumn), `ship column escapes band on ${name}`).toBe(true);
      // Nothing in the right column touches the rule…
      for (const rect of [layout.shipPick, layout.mapPick]) {
        expect(rect.x, `right column crowds the separator on ${name}`).toBeGreaterThanOrEqual(
          layout.separator.x + layout.separator.width - 1e-9,
        );
      }
      // …and nothing in the left one does either.
      for (const rect of layout.seats) {
        expect(rect.x + rect.width, `roster crowds the separator on ${name}`).toBeLessThanOrEqual(
          layout.separator.x + 1e-9,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Thumb scale
// ---------------------------------------------------------------------------

describe('thumb scale (GDD §2.4 — menus are plain taps)', () => {
  for (const { name, vp, touch } of PROFILES) {
    if (!touch) continue;
    it(`keeps the hull tiles, the arena cards and RUSH! thumb-sized — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: true, insets: insetsFor(vp) });
      // Both the hull tiles and the arena cards are thumb *choices*: once the map
      // row joined the roster and the tiles in one band, the tiles compress to a
      // thumb floor (the view drops the blurb, keeping the name + hull) rather than
      // vanishing — but they never go below a fingertip (p2 fit rule).
      expect(
        layout.shipCard.height,
        `hull card untappable on ${name}`,
      ).toBeGreaterThanOrEqual(CLASS_TILE_COMPACT);
      expect(layout.mapCard.width, `arena card untappable wide on ${name}`).toBeGreaterThanOrEqual(44);
      expect(layout.mapCard.height, `arena card untappable tall on ${name}`).toBeGreaterThanOrEqual(44);
      // The PRESSABLE block is bigger than either card — it carries the eyebrow —
      // so the thumb floor is met with room to spare on the thing a finger hits.
      expect(layout.shipPick.height, `ship block untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(layout.mapPick.height, `arena block untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      // RUSH! keeps the thumb floor on EVERY viewport, including the ones whose
      // footer beam is itself under it — a 390-wide phone in portrait resolves a
      // 28px beam, and the plate grows up into the gutter rather than shrinking.
      expect(layout.rushButton.height, `RUSH! untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(layout.leave.height, `BACK untappable on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(layout.rushButton.width).toBeGreaterThanOrEqual(150);
    });
  }

  it('keeps RUSH! and BACK at the thumb floor on every profile, notch or none', () => {
    for (const { name, vp, touch } of PROFILES) {
      for (const insets of [undefined, insetsFor(vp)]) {
        const layout = lobbyLayout(vp, insets ? { isTouch: touch, insets } : { isTouch: touch });
        const tag = insets ? 'with notch insets' : 'no insets';
        expect(layout.rushButton.height, `RUSH! on ${name} (${tag})`).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(layout.leave.height, `BACK on ${name} (${tag})`).toBeGreaterThanOrEqual(TOUCH_MIN);
        // …and the two never overlap, however little footer there is to share.
        expect(overlaps(layout.leave, layout.rushButton), `BACK hits RUSH! on ${name}`).toBe(false);
      }
    }
  });

  it('keeps the hull tiles at blurb height on a roomy screen (GDD §2.11)', () => {
    // The blurb is the point of the tile; on any device with real room — a desktop
    // and a comfortable phone in portrait — the tile keeps its full 64px so the
    // role text shows. The concession is only the tightest handsets (below).
    for (const { name, vp, touch } of PROFILES.filter(
      (p) => p.name === 'desktop' || p.name === 'iphone/portrait' || p.name === 'ipad/portrait',
    )) {
      const layout = lobbyLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      expect(layout.shipCard.height, `hull card blurb height on ${name}`).toBeGreaterThanOrEqual(
        CLASS_TILE_MIN,
      );
    }
  });

  /**
   * THE BAR THIS BRIEF SET, and the one it is easiest to lose silently.
   *
   * Planet Rush is a landscape game (`src/platform/orientation.ts`), so a phone on
   * its side is the layout a phone player actually meets — and this screen carries
   * more per row than anything else in the game. Every control on a roster row has
   * to clear the 48px thumb floor there, notch or no notch, or the screen only
   * works with a mouse.
   *
   * Three changes buy it and all three are asserted through their effect rather
   * than by name: the arena row moved into the right column (so the roster gets
   * the whole band), the rows abut (`ROSTER.gap` = 0), and a row's segments span
   * its full height instead of sitting inset in it.
   */
  it('gives every roster-row control the 48px thumb floor on a phone in LANDSCAPE', () => {
    const landscape = PROFILES.filter((p) => p.touch && p.vp.width > p.vp.height);
    expect(landscape.length, 'there are landscape phone profiles to assert').toBeGreaterThan(0);
    for (const { name, vp } of landscape) {
      for (const insets of [undefined, LANDSCAPE_INSETS]) {
        const layout = lobbyLayout(vp, insets ? { isTouch: true, insets } : { isTouch: true });
        const tag = insets ? 'with notch insets' : 'no insets';
        expect(layout.seatColumns, `roster columns on ${name} (${tag})`).toBe(2);
        for (let i = 0; i < layout.seats.length; i++) {
          const seat = layout.seats[i]!;
          expect(seat.height, `row ${i} under the thumb on ${name} (${tag})`).toBeGreaterThanOrEqual(
            TOUCH_MIN,
          );
          // …and its controls are the row's height, not the row's height minus a pad.
          for (const [label, rect] of [
            ['state', layout.seatStates[i]!],
            ['team chip', layout.seatTeamChips[i]!],
            ['tier chip', layout.seatChips[i]!],
            // The `?` codex control (a0-06) — the newest and narrowest segment,
            // and the one the row gives up first. It has to survive HERE, on the
            // landscape phone, or the developer's own device is the one device the
            // feature they asked for does not exist on.
            ['codex ?', layout.seatHelp[i]!],
          ] as const) {
            expect(rect.width, `${label} ${i} missing on ${name} (${tag})`).toBeGreaterThan(0);
            expect(
              rect.height,
              `${label} ${i} under the thumb on ${name} (${tag})`,
            ).toBeGreaterThanOrEqual(TOUCH_MIN);
          }
        }
        // The MODE / ORE chips above them are controls too.
        expect(layout.modeToggle.height, `MODE on ${name} (${tag})`).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(layout.abundance.height, `ORE on ${name} (${tag})`).toBeGreaterThanOrEqual(TOUCH_MIN);
        // …and the two thumb CHOICES beside the roster keep their floors.
        expect(layout.shipCard.height, `hull card on ${name} (${tag})`).toBeGreaterThanOrEqual(
          CLASS_TILE_COMPACT,
        );
        expect(layout.mapCard.height, `arena card on ${name} (${tag})`).toBeGreaterThanOrEqual(44);
        expect(layout.mapCard.width, `arena card on ${name} (${tag})`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('takes the READABLE trade on the SMALLEST phone in landscape — the iPhone SE', () => {
    // 375×667 is in QA's matrix, and under the landscape lock it hands the lobby a
    // 667×375 logical viewport whose 621px band is the tightest this screen ever
    // gets. It is the device that moved TWO_COLUMN_MIN_WIDTH (from 700 to 600 —
    // under the old threshold this fell to the stacked shape, where a 249px band
    // split three ways left the roster 74px for EIGHT rows), so it is asserted by
    // name.
    //
    // And it is the one device where the 48px promise is deliberately not made.
    // Halving its 369px roster would give 180px rows — under the width a row
    // needs to carry a side chip at all — so it stays in ONE column of full-width
    // rows: every control present and legible, at 25px rather than 48. A roster
    // that loses a control to gain a thumb has traded the wrong way round.
    const layout = lobbyLayout({ width: 667, height: 375 }, { isTouch: true });
    expect(layout.twoColumn).toBe(true);
    expect(layout.seatColumns).toBe(1);
    for (let i = 0; i < layout.seats.length; i++) {
      const seat = layout.seats[i]!;
      expect(seat.width, `SE row ${i} is a full-width row`).toBeGreaterThanOrEqual(
        SEAT_ROW_FULL_WIDTH,
      );
      expect(layout.seatStates[i]!.width, `SE state control ${i}`).toBeGreaterThanOrEqual(
        SEAT_STATE_MIN,
      );
      expect(layout.seatChips[i]!.width, `SE difficulty chip ${i}`).toBe(SEAT_CHIP_WIDTH);
      expect(layout.seatTeamChips[i]!.width, `SE side chip ${i}`).toBe(SEAT_TEAM_CHIP_WIDTH);
    }
  });

  // The tiles' ARRANGEMENT test moved with the tiles (u10-01): `stack` / `grid` /
  // `row` is now `./ship-select.test.ts`'s, because `placeClassTiles` is called
  // from there and the lobby has one card rather than four.

  it('sizes every control by the VIEWPORT, never by isTouch (u7-03)', () => {
    // `isTouch` used to choose between a desktop row height and a taller "touch"
    // one. It does not any more: the thumb floor is a property of the viewport,
    // not of the input device, so both readings of the same window are identical
    // and every control clears the floor on both. That is strictly stronger than
    // the old promise, which left a mouse-driven window on 44px rows.
    const vp: Viewport = { width: 412, height: 1400 };
    const pointer = lobbyLayout(vp);
    const thumb = lobbyLayout(vp, { isTouch: true });
    expect(thumb.seats[0]!.height).toBeCloseTo(pointer.seats[0]!.height, 6);
    expect(thumb.rushButton.height).toBeCloseTo(pointer.rushButton.height, 6);
    expect(pointer.seats[0]!.height).toBeGreaterThanOrEqual(TOUCH_MIN);
    // …and the cap is the frame's own row, the handoff's 64px surface floored at
    // the thumb, rather than a lobby literal.
    const cap = rosterRowHeight(frameMetrics(vp.width, vp.height));
    expect(pointer.seats[0]!.height).toBeLessThanOrEqual(cap + 1e-9);
  });

  it('compresses the roster — never the tiles — when the screen runs out', () => {
    // 320×568 (GDD §4.3) cannot hold eight thumb-scale rows *and* four tiles.
    // The stated priority: the roster is a list to read, the tiles are a choice.
    // This is a PORTRAIT window, behind the ROTATE overlay — the one place the
    // 48px promise above is deliberately not made.
    const layout = lobbyLayout({ width: 320, height: 568 }, { isTouch: true });
    expect(layout.seats[0]!.height).toBeLessThan(TOUCH_MIN);
    expect(layout.shipCard.height).toBeGreaterThanOrEqual(CLASS_TILE_MIN);
  });

  it('hands the roster the height the three tiles and five cards used to take (u10-01)', () => {
    // The point of the developer's report, measured. Before u10-01 the one-column
    // shape divided the band three ways — roster, a 2x2 of hull tiles, an arena row
    // — and the roster got what was left. It now shares with ONE row of two cards,
    // so on the phone the report was filed from, the roster is strictly taller and
    // its rows are strictly closer to the thumb floor than they were.
    //
    // Asserted against the floor and the wanted height rather than against a
    // remembered number: what must hold is that the roster is no longer the block
    // paying for the others, and a hard-coded 'was 45, is now 55' would fail on the
    // next frame-metric change for a reason that has nothing to do with this brief.
    const phone = lobbyLayout({ width: 390, height: 844 }, { isTouch: true });
    expect(phone.twoColumn).toBe(false);
    // Eight rows at the frame's own row height — the roster gets what it ASKS for
    // on this device now, which it did not before.
    const cap = rosterRowHeight(frameMetrics(390, 844));
    expect(phone.seats[0]!.height).toBeCloseTo(cap, 6);
    expect(phone.seats[0]!.height).toBeGreaterThanOrEqual(TOUCH_MIN);
    // …and the cards below it still clear their own floors, so the height did not
    // come out of them either.
    expect(phone.shipCard.height).toBeGreaterThanOrEqual(CLASS_TILE_COMPACT);
    expect(phone.mapCard.height).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// 3b. Inside a hull tile — six stats, as pips AND numbers, at phone scale
// ---------------------------------------------------------------------------
//
// u4 (ratified 2026-08-05, "both pips and numbers") put six stat cells on a tile
// that used to hold a name over a sentence. Four hulls' worth of that on a
// 390-wide handset is the hard case the brief named, and a layout verified only
// on desktop has shipped broken on this project before — so the ladder is
// asserted against the WHOLE device matrix here, portrait and landscape, rather
// than eyeballed once.

describe('the hull tile’s contents (u4 — pips and numbers, at every size)', () => {
  it('sizes CLASS_TILE_MIN so a minimum tile still carries name + hull + stats', () => {
    // The arrangement chooser (placeTiles) defends CLASS_TILE_MIN before it
    // defends anything else, so that number has to be the height of the tile's
    // whole IDENTITY block — otherwise "the tiles keep their floor" would be a
    // promise about a tile with nothing on it.
    const identity =
      2 * CLASS_TILE_PAD + CLASS_NAME_LINE + CLASS_HULL_LINE + statGridHeight(2);
    expect(identity).toBeLessThanOrEqual(CLASS_TILE_MIN);
    // …and three columns fit inside ANY tile the layout is willing to produce,
    // which is why 3 is the floor arrangement and there is no 2-column shape.
    const innerWidth = CLASS_TILE_MIN_WIDTH - 2 * CLASS_TILE_PAD;
    expect((innerWidth - 2 * STAT_CELL_GAP) / 3).toBeGreaterThanOrEqual(STAT_CELL_FLOOR);
    // The geometry mirrors the model's stat count rather than importing it (the
    // LOBBY_SLOT_ROWS discipline); this is the assertion that keeps them equal.
    for (const option of CLASS_OPTIONS) expect(option.stats).toHaveLength(STAT_COUNT);
  });

  for (const { name, vp, touch } of PROFILES) {
    it(`shows all six stats, inside the card and never overlapping — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      // ONE card since u10-01 — the pick. The other three hulls' tiles are
      // asserted the same way, on their own screen, in `./ship-select.test.ts`.
      for (const tile of [layout.shipCard]) {
        const t = 0;
        const content = classTileContent(tile);
        expect(content.showStats, `stats dropped on ${name} tile ${t} ${fmt(tile)}`).toBe(true);
        expect(content.statColumns * content.statRows).toBeGreaterThanOrEqual(STAT_COUNT);

        const cells: Rect[] = [];
        for (let i = 0; i < STAT_COUNT; i++) {
          const cell = classStatCell(content, i);
          expect(
            rectContains(tile, cell),
            `stat cell ${i} escapes ${name} tile ${t}: ${fmt(cell)} ⊄ ${fmt(tile)}`,
          ).toBe(true);
          for (let j = 0; j < cells.length; j++) {
            expect(overlaps(cells[j]!, cell), `stat cells ${j}/${i} overlap on ${name}`).toBe(false);
          }
          cells.push(cell);
        }
        // Every block the tile decided to draw stays inside it too — a name that
        // runs off a 44px tile is the same bug as a stat cell that does.
        for (const [label, rect] of [
          ['name', content.name],
          ['hull', content.hull],
          ['stats', content.stats],
          ['blurb', content.blurb],
        ] as const) {
          expect(
            rectContains(tile, rect),
            `${label} escapes ${name} tile ${t}: ${fmt(rect)} ⊄ ${fmt(tile)}`,
          ).toBe(true);
        }
      }
    });
  }

  it('lays the six across in ONE row when the tile is wide, 3×2 on a phone', () => {
    // A desktop `stack` tile is wide and reads like GDD §2.11's own table row…
    const desktop = lobbyLayout({ width: 1280, height: 800 });
    const wide = classTileContent(desktop.shipCard);
    expect(wide.statColumns).toBe(STAT_COUNT);
    expect(wide.statRows).toBe(1);
    expect(wide.showBlurb).toBe(true);

    // …and a phone tile folds to 3×2, which is what fits beside four of them.
    const phone = lobbyLayout({ width: 390, height: 844 }, { isTouch: true, insets: PORTRAIT_INSETS });
    const narrow = classTileContent(phone.shipCard);
    expect(narrow.statColumns).toBe(3);
    expect(narrow.statRows).toBe(2);
    expect(narrow.showStats).toBe(true);
  });

  it('gives up the blurb, then the hull nickname — keeping the stats', () => {
    // The stated ladder (see the geometry header): name, stats, hull, blurb. A
    // tile shrinking through the sizes loses them from the bottom, so each block
    // is monotone in height — nothing may reappear as the tile gets smaller —
    // and the blurb is never drawn without the two blocks above it.
    const width = 200;
    let sawFull = false;
    let sawStatsNoHull = false;
    let sawFallback = false;
    let previous: { stats: boolean; hull: boolean; blurb: boolean } | null = null;
    for (let height = 44; height <= 120; height += 1) {
      const box = { x: 0, y: 0, width, height };
      const content = classTileContent(box);

      expect(!content.showBlurb || (content.showHull && content.showStats), `blurb alone at ${height}px`).toBe(true);
      if (previous) {
        expect(content.showStats || !previous.stats, `stats un-shown at ${height}px`).toBe(true);
        expect(content.showHull || !previous.hull, `hull un-shown at ${height}px`).toBe(true);
        expect(content.showBlurb || !previous.blurb, `blurb un-shown at ${height}px`).toBe(true);
      }
      previous = { stats: content.showStats, hull: content.showHull, blurb: content.showBlurb };

      if (content.showBlurb) sawFull = true;
      else if (content.showStats && !content.showHull) sawStatsNoHull = true;
      else if (!content.showStats && !content.showHull) sawFallback = true;

      // Whatever it decided, the blocks it drew fit in the tile it was given.
      expect(rectContains(box, content.stats)).toBe(true);
      expect(rectContains(box, content.blurb)).toBe(true);
      expect(rectContains(box, content.hull)).toBe(true);
    }
    // All three regimes are reachable — the full tile, the phone tile that keeps
    // its stats and gives up its nickname, and the sub-floor tile that is too
    // short for either. Otherwise this test proves nothing.
    expect({ sawFull, sawStatsNoHull, sawFallback }).toEqual({
      sawFull: true,
      sawStatsNoHull: true,
      sawFallback: true,
    });
  });

  it('falls back to the pre-u4 card on a tile too NARROW for a legible grid', () => {
    // The one documented exception to "stats before the nickname". Height cannot
    // buy a narrow tile a grid, so it keeps its words instead of standing empty —
    // and it does so at every height, never blinking between the two readings.
    for (let height = 44; height <= 160; height += 4) {
      const content = classTileContent({ x: 0, y: 0, width: 100, height });
      expect(content.cellWidth, `cell at ${height}px`).toBeLessThan(STAT_CELL_FLOOR);
      expect(content.showStats, `grid drawn illegibly at ${height}px`).toBe(false);
      expect(content.showHull, `words given up for nothing at ${height}px`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Hit testing
// ---------------------------------------------------------------------------

describe('hit testing (a tap hits what it looks like it hits)', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`maps a tap back to the rect it was drawn in — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: touch });
      for (let i = 0; i < layout.seats.length; i++) {
        // The row BODY is what is left between the leading state control (u5) and
        // the trailing chips' zone. It stopped being "everything left of the
        // trailing chips, centre included" at u3 (the side chip carries
        // `FRIENDLY A`, which a 221px phone row cannot hold right of its centre)
        // and stopped starting at the row's edge at u5.
        const p = bodyPoint(layout, i);
        expect(lobbyHitTest(layout, p.x, p.y), `seat[${i}] on ${name}`).toEqual({
          kind: 'seat',
          index: i,
        });
      }
      // The two summary cards OPEN their screens; neither is a pick (u10-01).
      // Tested at the card's centre AND at the eyebrow's, because the eyebrow says
      // `CHANGE` and a caption that says CHANGE and is not itself pressable is a
      // control smaller than it looks.
      for (const [label, target, card, eyebrow] of [
        ['ship', { kind: 'shipCard' }, layout.shipCard, layout.shipLabel],
        ['arena', { kind: 'mapCard' }, layout.mapCard, layout.mapLabel],
      ] as const) {
        const c = center(card);
        expect(lobbyHitTest(layout, c.x, c.y), `${label} card on ${name}`).toEqual(target);
        if (eyebrow.height > 0) {
          const e = center(eyebrow);
          expect(lobbyHitTest(layout, e.x, e.y), `${label} eyebrow on ${name}`).toEqual(target);
        }
      }
      const rush = center(layout.rushButton);
      expect(lobbyHitTest(layout, rush.x, rush.y)).toEqual({ kind: 'rush' });
      const code = center(layout.roomCode);
      expect(lobbyHitTest(layout, code.x, code.y)).toEqual({ kind: 'roomCode' });
      // BACK — the lobby's exit to the main menu (u2 menu-back).
      const leave = center(layout.leave);
      expect(lobbyHitTest(layout, leave.x, leave.y), `leave on ${name}`).toEqual({ kind: 'leave' });
    });
  }

  it('keeps the lobby BACK exit in the FOOTER beam, clear of RUSH! and the hint (u2)', () => {
    // BACK moved out of the title band and into the footer beam with u7-03 —
    // where this set puts a screen's secondary action (settings' DONE is its
    // twin). What has to hold is unchanged: it is inside the safe content box, it
    // is the left-anchored exit, and it never collides with the screen's start
    // button or with the hint that explains a dim one.
    for (const { name, vp, touch } of PROFILES) {
      const layout = lobbyLayout(vp, { isTouch: touch });
      expect(rectContains(layout.content, layout.leave), `leave escapes content on ${name}`).toBe(true);
      expect(layout.leave.x, `leave is not left-anchored on ${name}`).toBeLessThan(
        layout.rushButton.x,
      );
      expect(overlaps(layout.leave, layout.rushButton), `leave overlaps RUSH! on ${name}`).toBe(false);
      expect(overlaps(layout.leave, layout.rushHint), `leave overlaps the hint on ${name}`).toBe(false);
      expect(overlaps(layout.leave, layout.roomCode), `leave overlaps room code on ${name}`).toBe(false);
      // …and the header beam still carries the heading and the code, side by side.
      expect(overlaps(layout.title, layout.roomCode), `heading overlaps code on ${name}`).toBe(false);
    }
  });

  it('returns null for a tap on nothing', () => {
    const layout = lobbyLayout({ width: 390, height: 844 }, { isTouch: true });
    expect(lobbyHitTest(layout, 1, 1)).toBeNull(); // outside the content box
    expect(lobbyHitTest(layout, 195, layout.title.y + layout.title.height - 1)).toBeNull();
  });

  it('never hits a zero-extent rect', () => {
    const layout = lobbyLayout({ width: 10, height: 10 });
    expect(lobbyHitTest(layout, 5, 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. The control strip and the row chips (variable-slots Milestone E)
// ---------------------------------------------------------------------------

describe('the MODE / ABUNDANCE strip and the per-row difficulty + team chips', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`taps the toggles and each row's chips, body vs chips kept apart — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: touch });

      // The two toggles map to their own targets when they have extent.
      if (layout.modeToggle.width > 0 && layout.modeToggle.height > 0) {
        const m = center(layout.modeToggle);
        expect(lobbyHitTest(layout, m.x, m.y), `mode toggle on ${name}`).toEqual({ kind: 'mode' });
      }
      if (layout.abundance.width > 0 && layout.abundance.height > 0) {
        const a = center(layout.abundance);
        expect(lobbyHitTest(layout, a.x, a.y), `abundance on ${name}`).toEqual({ kind: 'abundance' });
      }

      expect(layout.seatChips).toHaveLength(layout.seats.length);
      expect(layout.seatTeamChips).toHaveLength(layout.seats.length);
      for (let i = 0; i < layout.seats.length; i++) {
        const chip = layout.seatChips[i]!;
        const teamChip = layout.seatTeamChips[i]!;
        const seat = layout.seats[i]!;
        const mid = center(seat).x;
        const body = bodyPoint(layout, i);

        // Both chips nest inside the row and leave its LEADING zone clear — the
        // identity bar, whatever the state control took, and SEAT_ROW_BODY_MIN of
        // body (`seatBodyEnd`). That rule is ABSOLUTE since u7-03; it used to be
        // 36% of the row, which over-reserved on a narrow row and under-reserved
        // on a wide one.
        expect(rectContains(seat, chip), `difficulty chip ${i} escapes its row on ${name}`).toBe(true);
        expect(rectContains(seat, teamChip), `team chip ${i} escapes its row on ${name}`).toBe(true);
        expect(
          lobbyHitTest(layout, body.x, body.y),
          `row body ${i} on ${name}`,
        ).toEqual({ kind: 'seat', index: i });

        // The TIER chip — read-only since a0-06 (the difficulty is shown, not
        // chosen; GDD §2.1 amended). Right-anchored, never wider than its word
        // wants and never narrower than its floor — and NOT a target: a tap on it
        // falls through to the row body's character cycle rather than to a control
        // that would have to refuse.
        if (chip.width > 0 && chip.height > 0) {
          expect(chip.x, `tier chip ${i} left of centre on ${name}`).toBeGreaterThan(mid);
          expect(chip.width, `tier chip ${i} wider than its word on ${name}`).toBeLessThanOrEqual(
            Math.min(SEAT_CHIP_WIDTH, seat.width * SEAT_CHIP_MAX_FRACTION - SEAT_CHIP_PAD) + 1e-9,
          );
          expect(chip.width, `tier chip ${i} below its floor on ${name}`).toBeGreaterThanOrEqual(
            SEAT_CHIP_MIN - 1e-9,
          );
          const c = center(chip);
          expect(lobbyHitTest(layout, c.x, c.y), `tier chip ${i} is not a control on ${name}`).toEqual({
            kind: 'seat',
            index: i,
          });
        }

        // The `?` — the row's codex control (a0-06). A real target, right of the
        // tier chip, never overlapping it.
        const help = layout.seatHelp[i]!;
        if (help.width > 0 && help.height > 0) {
          expect(overlaps(help, chip), `codex ? ${i} overlaps the tier chip on ${name}`).toBe(false);
          const h = center(help);
          expect(lobbyHitTest(layout, h.x, h.y), `codex ? ${i} on ${name}`).toEqual({
            kind: 'seatHelp',
            index: i,
          });
        }

        // …and where the row is wide enough for it, the side chip SAYS the side at
        // full size (u3). The word is the whole feature — `FRIENDLY A` measures
        // 64px in the chip's 11px Audiowide — and `SIDE_WORD_ROW_WIDTH` is the row
        // width the composition needs for it, derived from the constants above
        // rather than restated. Every landscape profile clears it; a narrower row
        // scales the word down (`lobby-view` `fitLabel`) rather than dropping the
        // control, because a control the player cannot find is the worse failure.
        if (teamChip.width > 0 && teamChip.height > 0 && seat.width >= SIDE_WORD_ROW_WIDTH) {
          expect(
            teamChip.width,
            `team chip ${i} cannot hold "FRIENDLY A" on ${name}`,
          ).toBeGreaterThanOrEqual(LONGEST_SIDE_LABEL_PX + 2 * TEAM_CHIP_LABEL_PAD);
        }

        // The team chip — composed to the LEFT of the difficulty chip (TEAMS) —
        // cycles the side. It never enters the row's body zone and never overlaps
        // the difficulty chip, so editing one control never costs the other.
        if (teamChip.width > 0 && teamChip.height > 0) {
          expect(
            teamChip.x,
            `team chip ${i} eats into the row's body zone on ${name}`,
          ).toBeGreaterThanOrEqual(seatBodyEnd(seat, layout.seatStates[i]!) - 1e-9);
          expect(
            overlaps(teamChip, chip),
            `team chip ${i} overlaps tier chip on ${name}`,
          ).toBe(false);
          const t = center(teamChip);
          expect(lobbyHitTest(layout, t.x, t.y), `team chip ${i} on ${name}`).toEqual({
            kind: 'seatTeamChip',
            index: i,
          });
        }
      }
    });
  }

  it('never draws a side chip as a STUB, on any profile, notch or none', () => {
    // The honest guarantee, and it is two claims rather than one.
    //
    // A row wide enough for the composition holds `FRIENDLY A` on ONE line at
    // full size — every desktop, every tablet, and the roster's single-column
    // shape. A narrower one (the split landscape phone) cannot, so the chip
    // stacks the word over the letter instead (`lobby-view` `drawTeamChip`) and
    // needs only SEAT_TEAM_CHIP_MIN for that — which is what
    // SEAT_ROW_MIN_WIDTH is derived to keep, so no row the roster will ever split
    // into can reach the stub floor. Both halves of the ratified `WORD + LETTER`
    // grammar survive either way; only the line break moves.
    for (const { name, vp, touch } of PROFILES) {
      for (const insets of [undefined, insetsFor(vp)]) {
        const layout = lobbyLayout(vp, insets ? { isTouch: touch, insets } : { isTouch: touch });
        const tag = insets ? 'with notch insets' : 'no insets';
        for (let i = 0; i < layout.seats.length; i++) {
          const seat = layout.seats[i]!;
          const chip = layout.seatTeamChips[i]!;
          if (layout.seatChips[i]!.width <= 0) continue; // a row too short for any control
          expect(chip.width, `side chip is a stub on ${name} row ${i} (${tag})`).toBeGreaterThanOrEqual(
            SEAT_TEAM_CHIP_MIN,
          );
          if (seat.width >= SEAT_ROW_FULL_WIDTH) {
            expect(
              chip.width,
              `wide row still clips the side word on ${name} row ${i} (${tag})`,
            ).toBeGreaterThanOrEqual(LONGEST_SIDE_LABEL_PX + 2 * TEAM_CHIP_LABEL_PAD);
          }
        }
      }
    }
  });

  it('spends the `?` before the side chip, and the tier chip before dropping it (a0-06)', () => {
    // The first cut of the `?` paid for itself out of the wrong pocket: it took
    // its width off the far right, the tier chip measured from what it left, and
    // the side chip — measured last — fell to ZERO on the notched landscape phone.
    // A ratified mechanic (m10, u3: the developer could not read sides in a Teams
    // match) silently disappearing to buy a new affordance is the trade the
    // geometry exists to make impossible, so the order of surrender is pinned here
    // rather than left to the order three functions happen to run in.
    for (const { name, vp, touch } of PROFILES) {
      for (const insets of [undefined, insetsFor(vp)]) {
        const layout = lobbyLayout(vp, insets ? { isTouch: touch, insets } : { isTouch: touch });
        const tag = insets ? 'with notch insets' : 'no insets';
        for (let i = 0; i < layout.seats.length; i++) {
          const seat = layout.seats[i]!;
          const tier = layout.seatChips[i]!;
          const help = layout.seatHelp[i]!;
          const team = layout.seatTeamChips[i]!;
          if (tier.width <= 0) continue; // a row too short for any control at all

          // The tier chip NEVER drops — GDD §2.1 promises the difficulty is shown —
          // and never falls under its floor.
          expect(tier.width, `tier chip ${i} below its floor on ${name} (${tag})`).toBeGreaterThanOrEqual(
            SEAT_CHIP_MIN - 1e-9,
          );
          // The side chip keeps its minimum, always: it is spent for nothing.
          expect(team.width, `side chip ${i} spent on the ? on ${name} (${tag})`).toBeGreaterThanOrEqual(
            SEAT_TEAM_CHIP_MIN - 1e-9,
          );
          // The row body's absolute guarantee is untouched by all three.
          const bodyEnd = seatBodyEnd(seat, layout.seatStates[i]!);
          for (const [label, rect] of [
            ['tier chip', tier],
            ['side chip', team],
            ['codex ?', help],
          ] as const) {
            if (rect.width <= 0) continue;
            expect(rect.x, `${label} ${i} eats the row body on ${name} (${tag})`).toBeGreaterThanOrEqual(
              bodyEnd - 1e-9,
            );
            expect(
              rect.x + rect.width,
              `${label} ${i} escapes its row on ${name} (${tag})`,
            ).toBeLessThanOrEqual(seat.x + seat.width + 1e-9);
          }
          // …and where the `?` IS drawn it is a glyph, not a smudge.
          if (help.width > 0) {
            expect(help.width, `codex ? ${i} is a stub on ${name} (${tag})`).toBeGreaterThanOrEqual(
              SEAT_HELP_MIN - 1e-9,
            );
          }
        }
      }
    }
  });

  it('carries the `?` on EVERY profile QA tests, notch and all', () => {
    // The developer asked for the `?` by name and plays on a landscape phone, so
    // "it fits on a desktop" is not the claim worth making. This one is: there is
    // no device in the matrix where the control they asked for does not exist.
    for (const { name, vp, touch } of PROFILES) {
      for (const insets of [undefined, insetsFor(vp)]) {
        const layout = lobbyLayout(vp, insets ? { isTouch: touch, insets } : { isTouch: touch });
        const tag = insets ? 'with notch insets' : 'no insets';
        for (let i = 0; i < layout.seats.length; i++) {
          if (layout.seatChips[i]!.width <= 0) continue;
          expect(
            layout.seatHelp[i]!.width,
            `no codex ? on ${name} row ${i} (${tag})`,
          ).toBeGreaterThanOrEqual(SEAT_HELP_MIN - 1e-9);
        }
      }
    }
  });

  it('keeps SEAT_ROW_FULL_WIDTH reachable — the desktop roster holds the word on one line', () => {
    // …so the claim above is not vacuous.
    const desktop = lobbyLayout({ width: 1280, height: 800 });
    expect(desktop.seats[0]!.width).toBeGreaterThanOrEqual(SEAT_ROW_FULL_WIDTH);
    expect(desktop.seatTeamChips[0]!.width).toBe(SEAT_TEAM_CHIP_WIDTH);
  });

  it('derives the two-column roster threshold from the row it has to leave', () => {
    // TWO_ROSTER_MIN_WIDTH is not a taste: a halved column has to leave a row
    // that still carries its difficulty chip at full width and its state control
    // above SEAT_STATE_MIN. Both bounds are fractions of the row, so both give a
    // minimum row width — and the constant is two of those plus a gap.
    const chipNeeds = (SEAT_CHIP_WIDTH + SEAT_CHIP_PAD) / SEAT_CHIP_MAX_FRACTION;
    const stateNeeds = SEAT_STATE_MIN / SEAT_STATE_MAX_FRACTION;
    expect(SEAT_ROW_MIN_WIDTH).toBeGreaterThanOrEqual(Math.max(chipNeeds, stateNeeds));
    expect(TWO_ROSTER_MIN_WIDTH).toBeGreaterThanOrEqual(2 * SEAT_ROW_MIN_WIDTH);

    // …and a row at exactly that width really does keep both.
    const row: Rect = { x: 0, y: 0, width: SEAT_ROW_MIN_WIDTH, height: TOUCH_MIN };
    const chipWidth = Math.min(SEAT_CHIP_WIDTH, row.width * SEAT_CHIP_MAX_FRACTION - SEAT_CHIP_PAD);
    expect(chipWidth).toBeCloseTo(SEAT_CHIP_WIDTH, 6);
    expect(
      Math.min(SEAT_TEAM_CHIP_WIDTH, row.width * SEAT_STATE_MAX_FRACTION),
    ).toBeGreaterThanOrEqual(SEAT_STATE_MIN);
  });
});

// ---------------------------------------------------------------------------
// 6. The LEADING state control (u5) — the affordance, not the behaviour
// ---------------------------------------------------------------------------

/**
 * The developer's report was that **nothing showed**: *"theres no way visible way
 * to know that you can close slots right now."* The cycle itself worked, and had
 * worked every day the bug existed — so a test that cycles a seat and checks the
 * occupant would have passed throughout and caught none of it.
 *
 * These assertions are therefore about the CONTROL: that one is laid out per row,
 * where it is, that it is big enough to be a control rather than a smudge, and
 * that it took nothing from the two chips that were already there. What the
 * control SAYS, and when it goes dead, is the model's half (`./lobby.test.ts`);
 * that it is drawn as pixels a thumb can find is the mobile suite's
 * (`tests/mobile/slot-state.spec.ts`).
 */
describe('the seat-state control is DRAWN on every row (u5 — the affordance)', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`lays one out per row, leading, hittable, without moving a chip — ${name}`, () => {
      const layout = lobbyLayout(vp, { isTouch: touch });
      expect(layout.seatStates, `one control per row on ${name}`).toHaveLength(layout.seats.length);

      for (let i = 0; i < layout.seats.length; i++) {
        const seat = layout.seats[i]!;
        const control = layout.seatStates[i]!;
        const chip = layout.seatChips[i]!;
        const teamChip = layout.seatTeamChips[i]!;

        // 1. It EXISTS wherever the row can carry a control at ALL — stated as an
        //    equivalence with the difficulty chip rather than as an absolute,
        //    because the smallest PORTRAIT phones compress the roster until no row
        //    can carry any chip (the file header's rule: the roster is a list and
        //    it is what gives). Where they carry one, they carry this one: the
        //    state control is never the affordance a screen drops FIRST, which is
        //    what "the screen advertised its lesser controls and hid its main one"
        //    would look like as geometry.
        const carriesControls = chip.width > 0 && chip.height > 0;
        expect(
          control.width > 0 && control.height > 0,
          `row ${i} on ${name} carries a difficulty chip but no state control`,
        ).toBe(carriesControls);

        // Everything below is about the control the row actually has.
        if (!carriesControls) continue;

        // 2. It sits inside its ANCHOR — its own roster row — and at the row's
        //    LEADING edge, right of the identity stripe and left of everything
        //    else. "Leading" is the half of the shape that has to survive if the
        //    ratified design handoff lands later: this should be a re-skin.
        expect(
          rectContains(seat, control),
          `state control ${i} escapes its row on ${name}: ${fmt(control)} vs ${fmt(seat)}`,
        ).toBe(true);
        expect(control.x, `state control ${i} covers the identity stripe on ${name}`).toBeGreaterThanOrEqual(
          seat.x + SEAT_STRIPE,
        );
        expect(control.x, `state control ${i} is not leading on ${name}`).toBeLessThan(center(seat).x);

        // 3. It is a CONTROL, not a smudge: wide enough to carry `CLOSED` (the
        //    longest word it shows) and as tall as the row can spare, so it is a
        //    plain tap on every device (GDD §2.4).
        expect(
          control.width,
          `state control ${i} too narrow to name a state on ${name}`,
        ).toBeGreaterThanOrEqual(SEAT_STATE_MIN);
        expect(control.height, `state control ${i} thinner than its row on ${name}`).toBeGreaterThanOrEqual(
          seat.height - 8,
        );

        // 4. A tap on it resolves to it, through the SAME hit test the view drives
        //    — its drawn rect, never a second copy (GDD §2.4, the hit-test
        //    contract). It wins over the row body it nests in.
        const p = center(control);
        expect(lobbyHitTest(layout, p.x, p.y), `state control ${i} on ${name}`).toEqual({
          kind: 'seatState',
          index: i,
        });

        // 5. …and it cost the row's existing furniture NOTHING. This brief moves
        //    layout, so it has to prove it moved only what it meant to: neither
        //    trailing chip is touched, and the body between them survives.
        expect(overlaps(control, chip), `state control ${i} overlaps difficulty chip on ${name}`).toBe(false);
        expect(overlaps(control, teamChip), `state control ${i} overlaps team chip on ${name}`).toBe(false);
        expect(
          control.x + control.width,
          `state control ${i} eats the trailing chips' zone on ${name}`,
        ).toBeLessThanOrEqual(seatBodyEnd(seat, control) - SEAT_ROW_BODY_MIN + 1e-9);

        const body = bodyPoint(layout, i);
        expect(lobbyHitTest(layout, body.x, body.y), `row body ${i} on ${name}`).toEqual({
          kind: 'seat',
          index: i,
        });
      }
    });

    it(`keeps the control AND both chips on the notched, safe-area-inset screen — ${name}`, () => {
      // The narrowest roster row the game ever produces is a landscape phone's
      // WITH its notch insets applied (718→396px of roster, halved into two
      // columns of 195). That row is the one this brief could plausibly have
      // broken, so it is asserted rather than assumed.
      const layout = lobbyLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      for (let i = 0; i < layout.seats.length; i++) {
        const seat = layout.seats[i]!;
        const control = layout.seatStates[i]!;
        const chip = layout.seatChips[i]!;
        const teamChip = layout.seatTeamChips[i]!;
        if (chip.width <= 0 || chip.height <= 0) continue; // a row too short for any control
        expect(control.width, `no state control on inset row ${i} on ${name}`).toBeGreaterThan(0);
        expect(rectContains(seat, control), `inset state control ${i} escapes its row on ${name}`).toBe(true);
        expect(overlaps(control, chip), `inset state control ${i} hits difficulty chip on ${name}`).toBe(false);
        expect(overlaps(control, teamChip), `inset state control ${i} hits team chip on ${name}`).toBe(false);
        if (chip.width > 0) {
          expect(chip.x, `inset difficulty chip ${i} left of centre on ${name}`).toBeGreaterThan(center(seat).x);
        }
        if (teamChip.width > 0) {
          expect(
            teamChip.x,
            `inset team chip ${i} eats the row's body zone on ${name}`,
          ).toBeGreaterThanOrEqual(seatBodyEnd(seat, control) - 1e-9);
        }
        const body = bodyPoint(layout, i);
        expect(lobbyHitTest(layout, body.x, body.y), `inset row body ${i} on ${name}`).toEqual({
          kind: 'seat',
          index: i,
        });
      }
    });
  }

  // …and the equivalence above is only worth having because the orientation the
  // game is actually PLAYED in never reaches the compressed case. Planet Rush is
  // landscape (`src/platform/orientation.ts` rotates a portrait phone rather than
  // blocking it), so a landscape phone is the primary mobile layout of this
  // screen — and there, all eight rows carry a control, notch or no notch.
  for (const { name, vp, touch } of PROFILES.filter((p) => p.vp.width > p.vp.height)) {
    it(`gives all eight rows a control in LANDSCAPE, the orientation this screen is used in — ${name}`, () => {
      for (const insets of [undefined, insetsFor(vp)]) {
        const layout = lobbyLayout(vp, insets ? { isTouch: touch, insets } : { isTouch: touch });
        const tag = insets ? 'with notch insets' : 'no insets';
        for (let i = 0; i < layout.seats.length; i++) {
          const control = layout.seatStates[i]!;
          expect(control.width, `row ${i} has no state control on ${name} (${tag})`).toBeGreaterThanOrEqual(
            SEAT_STATE_MIN,
          );
          expect(control.height, `row ${i} state control is flat on ${name} (${tag})`).toBeGreaterThan(0);
          const p = center(control);
          expect(lobbyHitTest(layout, p.x, p.y), `row ${i} control on ${name} (${tag})`).toEqual({
            kind: 'seatState',
            index: i,
          });
        }
      }
    });
  }

  it('drops the control whole rather than drawing a stub on a row that cannot hold one', () => {
    // The documented fallback, and the reason the matrix above can assert
    // "always present": a row too narrow for a legible control yields zero extent
    // and the pre-u5 behaviour (the body is still the cycle), never a 12px button
    // with a clipped word in it. No profile in QA's matrix reaches this.
    const layout = lobbyLayout({ width: 210, height: 700 }, { isTouch: true });
    for (let i = 0; i < layout.seats.length; i++) {
      const control = layout.seatStates[i]!;
      expect(control.width === 0 || control.width >= SEAT_STATE_MIN, `row ${i}`).toBe(true);
      if (control.width === 0) {
        const p = center(layout.seats[i]!);
        expect(lobbyHitTest(layout, p.x, p.y)).toEqual({ kind: 'seat', index: i });
      }
    }
  });

  it('never hits a control on a zero-extent row', () => {
    const layout = lobbyLayout({ width: 10, height: 10 });
    for (const control of layout.seatStates) {
      expect(control.width).toBe(0);
      expect(control.height).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// u10-01 — what must NOT have moved, on the 390px phone the brief names
// ---------------------------------------------------------------------------
//
// The brief is explicit that two neighbours of the block that moved are out of
// scope: the seat-state control (u5) and the FRIENDLY / ENEMY labels (u3) were
// developer reports in their own right, and *"keep working exactly as they do"*.
// Both are per-ROW geometry, and what moved is the column beside the roster — so
// this is the assertion that the move stayed on its own side of the separator.
//
// 390 is the brief's own number. It is checked in BOTH the shapes a 390-wide
// handset produces: landscape (844×390 logical, which is what a held phone becomes
// under the landscape lock — `src/platform/orientation.ts`) and portrait-raw
// (390×844), which is the one-column shape.

describe('the roster is untouched at 390px (u10-01)', () => {
  for (const [tag, vp] of [
    ['landscape (the held phone, under the lock)', { width: 844, height: 390 }],
    ['portrait-raw (the one-column shape)', { width: 390, height: 844 }],
  ] as const) {
    it(`draws and hit-tests every row control — ${tag}`, () => {
      const layout = lobbyLayout(vp, { isTouch: true, insets: insetsFor(vp) });
      expect(layout.seats).toHaveLength(LOBBY_SLOTS);
      for (let i = 0; i < LOBBY_SLOTS; i++) {
        const seat = layout.seats[i]!;
        expect(seat.width, `row ${i} missing`).toBeGreaterThan(0);
        expect(seat.height, `row ${i} missing`).toBeGreaterThan(0);

        // …the u5 STATE control: drawn, inside its row, and the target a press on
        // it resolves to — not the row body behind it.
        const state = layout.seatStates[i]!;
        expect(state.width, `state control ${i} dropped`).toBeGreaterThan(0);
        expect(rectContains(seat, state), `state control ${i} escapes its row`).toBe(true);
        const sp = center(state);
        expect(lobbyHitTest(layout, sp.x, sp.y), `state control ${i} unhittable`).toEqual({
          kind: 'seatState',
          index: i,
        });

        // …the u3 SIDE chip, which carries `FRIENDLY A` / `ENEMY B`.
        const team = layout.seatTeamChips[i]!;
        expect(team.width, `side chip ${i} dropped`).toBeGreaterThanOrEqual(SEAT_TEAM_CHIP_MIN);
        expect(rectContains(seat, team), `side chip ${i} escapes its row`).toBe(true);
        const tp = center(team);
        expect(lobbyHitTest(layout, tp.x, tp.y), `side chip ${i} unhittable`).toEqual({
          kind: 'seatTeamChip',
          index: i,
        });

        // …and the row BODY still cycles the character between them.
        const bp = bodyPoint(layout, i);
        expect(lobbyHitTest(layout, bp.x, bp.y), `row body ${i} unhittable`).toEqual({
          kind: 'seat',
          index: i,
        });
      }
      // The MODE / YIELD strip above them, and the two footer plates, are all still
      // there and still theirs.
      expect(lobbyHitTest(layout, center(layout.modeToggle).x, center(layout.modeToggle).y)).toEqual({
        kind: 'mode',
      });
      expect(lobbyHitTest(layout, center(layout.abundance).x, center(layout.abundance).y)).toEqual({
        kind: 'abundance',
      });
      expect(lobbyHitTest(layout, center(layout.rushButton).x, center(layout.rushButton).y)).toEqual({
        kind: 'rush',
      });
      expect(lobbyHitTest(layout, center(layout.leave).x, center(layout.leave).y)).toEqual({
        kind: 'leave',
      });
    });
  }

  it('gives the roster MORE height than the four tiles and six cards left it', () => {
    // The developer's report, as a number. The landscape phone's roster column is
    // unchanged (it always spanned the band), so the measurable gain is the
    // one-column shape, where the roster used to divide the band with a 2x2 of hull
    // tiles AND an arena row and now shares it with one row of two cards.
    const layout = lobbyLayout({ width: 390, height: 844 }, { isTouch: true });
    // Every row clears the thumb floor, which is the promise the old three-way
    // split could not make on this device.
    for (let i = 0; i < LOBBY_SLOTS; i++) {
      expect(layout.seats[i]!.height, `row ${i} under the thumb`).toBeGreaterThanOrEqual(TOUCH_MIN);
    }
    // …and the roster's own block is more than half the band, which it was not.
    const rosterBottom = layout.seats[LOBBY_SLOTS - 1]!.y + layout.seats[LOBBY_SLOTS - 1]!.height;
    expect(rosterBottom - layout.band.y).toBeGreaterThan(layout.band.height * 0.5);
  });
});

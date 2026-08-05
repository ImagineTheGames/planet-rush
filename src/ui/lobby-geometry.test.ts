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
 *  4. **The thumb-scale promise.** On touch the hull tiles keep their blurb
 *     height and RUSH! keeps its thumb size on every phone in the matrix, and a
 *     phone in landscape — the orientation the game is actually played in —
 *     keeps its roster legible too (see the module header).
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { Rect, Viewport } from '@platform/layout-registry';
import { CLASS_ORDER, LOBBY_SLOTS } from './lobby';
import { MAP_ORDER } from './map-picker';
import {
  CLASS_TILE_COMPACT,
  CLASS_TILE_MIN,
  LOBBY_MAP_COUNT,
  LOBBY_PAD,
  RUSH_HEIGHT,
  SEAT_ROW_MAX,
  SEAT_ROW_MAX_TOUCH,
  SEAT_TEAM_CHIP_MIN_BODY,
  TWO_COLUMN_MIN_WIDTH,
  lobbyHitTest,
  lobbyLayout,
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
    { label: 'modeToggle', rect: layout.modeToggle },
    { label: 'abundance', rect: layout.abundance },
    ...layout.seats.map((rect, i) => ({ label: `seat[${i}]`, rect })),
    ...layout.classOptions.map((rect, i) => ({ label: `class[${i}]`, rect })),
    ...layout.maps.map((rect, i) => ({ label: `map[${i}]`, rect })),
    { label: 'rushButton', rect: layout.rushButton },
  ];
  // NB: seatChips AND seatTeamChips are DELIBERATELY absent — they nest inside
  // their roster row (the row body cycles state, the difficulty chip cycles the
  // tier, the team chip cycles the side), so they overlap a seat by design and are
  // contained-checked separately (see the chip test).
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

/** A point in a roster row's guaranteed BODY zone — its leading
 *  {@link SEAT_TEAM_CHIP_MIN_BODY} share, which no trailing chip may enter. This
 *  is what "the row is still tappable" means since the side chip grew to hold
 *  `FRIENDLY A` (u3); on every profile but the landscape phone the zone reaches
 *  past the row's centre anyway. */
const bodyPoint = (r: Rect): { x: number; y: number } => ({
  x: r.x + (r.width * SEAT_TEAM_CHIP_MIN_BODY) / 2,
  y: r.y + r.height / 2,
});

/** The widest side label the chip ever carries — `FRIENDLY A` — in CSS px at the
 *  chip's 11px Audiowide, measured in the studio container (`ENEMY B` is 50,
 *  `TEAM A` was 41). Geometry runs in node with no font to measure, so the number
 *  is stated here and the constant it justifies lives next door
 *  (`SEAT_TEAM_CHIP_WIDTH` = 88 = this + its padding, rounded up). */
const LONGEST_SIDE_LABEL_PX = 64;
/** Mirrors `lobby-view`'s own `TEAM_CHIP_LABEL_PAD` — the inset the word keeps. */
const TEAM_CHIP_LABEL_PAD = 6;

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
      expect(layout.classOptions).toHaveLength(CLASS_ORDER.length);
      // The arena row: one card per ratified map (p2 field rule; `MAP_ORDER`).
      expect(layout.maps).toHaveLength(LOBBY_MAP_COUNT);
      expect(LOBBY_MAP_COUNT).toBe(MAP_ORDER.length);

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
    const wide = lobbyLayout({ width: TWO_COLUMN_MIN_WIDTH + 2 * LOBBY_PAD, height: 800 });
    const narrow = lobbyLayout({ width: 390, height: 844 }, { isTouch: true });

    expect(wide.twoColumn).toBe(true);
    // Roster on the left, tiles on the right, both spanning the same band.
    expect(wide.classOptions[0]!.x).toBeGreaterThan(wide.seats[0]!.x + wide.seats[0]!.width - 1);
    expect(wide.classOptions.map((r) => r.x)).toEqual(Array(4).fill(wide.classOptions[0]!.x));

    expect(narrow.twoColumn).toBe(false);
    // Tiles below the roster, in a 2×2 grid: [0][1] over [2][3].
    expect(narrow.classOptions[0]!.y).toBeGreaterThan(narrow.seats[7]!.y);
    expect(narrow.classOptions[1]!.y).toBe(narrow.classOptions[0]!.y);
    expect(narrow.classOptions[2]!.y).toBeGreaterThan(narrow.classOptions[0]!.y);
    expect(narrow.classOptions[1]!.x).toBeGreaterThan(narrow.classOptions[0]!.x);
  });

  it('is decided by width, not by device — a narrow desktop window is a phone layout', () => {
    expect(lobbyLayout({ width: 600, height: 900 }).twoColumn).toBe(false);
    expect(lobbyLayout({ width: 1024, height: 700 }, { isTouch: true }).twoColumn).toBe(true);
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
        layout.classOptions[0]!.height,
        `hull tile untappable on ${name}`,
      ).toBeGreaterThanOrEqual(CLASS_TILE_COMPACT);
      for (let i = 0; i < layout.maps.length; i++) {
        expect(layout.maps[i]!.width, `arena card ${i} untappable wide on ${name}`).toBeGreaterThanOrEqual(44);
        expect(layout.maps[i]!.height, `arena card ${i} untappable tall on ${name}`).toBeGreaterThanOrEqual(44);
      }
      expect(layout.rushButton.height).toBeGreaterThanOrEqual(RUSH_HEIGHT);
      expect(layout.rushButton.width).toBeGreaterThanOrEqual(200);
    });
  }

  it('keeps the hull tiles at blurb height on a roomy screen (GDD §2.11)', () => {
    // The blurb is the point of the tile; on any device with real room — a desktop
    // and a comfortable phone in portrait — the tile keeps its full 64px so the
    // role text shows. The concession is only the tightest handsets (below).
    for (const { name, vp, touch } of PROFILES.filter(
      (p) => p.name === 'desktop' || p.name === 'iphone/portrait' || p.name === 'ipad/portrait',
    )) {
      const layout = lobbyLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      expect(layout.classOptions[0]!.height, `hull tile blurb height on ${name}`).toBeGreaterThanOrEqual(
        CLASS_TILE_MIN,
      );
    }
  });

  it('keeps the roster in two columns and everything tappable on a phone in LANDSCAPE', () => {
    // Planet Rush is a landscape game (src/platform/orientation.ts), so this is
    // the layout a phone player actually meets. With the arena row now sharing the
    // band, the roster — a list — compresses (its rows can dip below the legible
    // ceiling, the view drops the detail line), while the tiles and the map cards,
    // both thumb choices, stay tappable. The roster still splits into two columns
    // of four, so slot order reads down each column.
    for (const { name, vp } of PROFILES.filter((p) => p.touch && p.vp.width > p.vp.height)) {
      const layout = lobbyLayout(vp, { isTouch: true, insets: LANDSCAPE_INSETS });
      expect(layout.seatColumns, `roster columns on ${name}`).toBe(2);
      expect(layout.seats[0]!.height, `roster row on ${name}`).toBeGreaterThan(0);
      expect(layout.classOptions[0]!.height, `hull tile on ${name}`).toBeGreaterThanOrEqual(
        CLASS_TILE_COMPACT,
      );
      expect(layout.maps[0]!.height, `arena card on ${name}`).toBeGreaterThanOrEqual(44);
    }
  });

  it('changes the tiles’ ARRANGEMENT rather than squashing them', () => {
    // Tall and wide: four stacked down the right column.
    expect(lobbyLayout({ width: 1280, height: 800 }).tileShape).toBe('stack');
    // Tall and narrow: a 2×2 under the roster.
    expect(lobbyLayout({ width: 390, height: 844 }, { isTouch: true }).tileShape).toBe('grid');
    // Short and wide, one column: a single row of four — height is the scarce
    // axis, so the tiles spend width instead and keep their blurb.
    const short = lobbyLayout({ width: 690, height: 400 });
    expect(short.twoColumn).toBe(false);
    expect(short.tileShape).toBe('row');
    expect(short.classOptions[0]!.height).toBeGreaterThanOrEqual(CLASS_TILE_MIN);
    expect(short.classOptions.map((r) => r.y)).toEqual(Array(4).fill(short.classOptions[0]!.y));
  });

  it('grows the roster rows on touch, up to the touch cap', () => {
    // A tall portrait window, so the roster band has room for the rows to reach
    // their cap even with the arena row now sharing the middle — otherwise the
    // rows compress below both caps and the cap, not the device, stops binding.
    const vp: Viewport = { width: 412, height: 1400 };
    const desktop = lobbyLayout(vp);
    const thumb = lobbyLayout(vp, { isTouch: true });
    expect(desktop.seats[0]!.height).toBeLessThanOrEqual(SEAT_ROW_MAX);
    expect(thumb.seats[0]!.height).toBeLessThanOrEqual(SEAT_ROW_MAX_TOUCH);
    expect(thumb.seats[0]!.height).toBeGreaterThan(desktop.seats[0]!.height);
    expect(thumb.rushButton.height).toBeGreaterThan(desktop.rushButton.height);
  });

  it('compresses the roster — never the tiles — when the screen runs out', () => {
    // 320×568 (GDD §4.3) cannot hold eight thumb-scale rows *and* four tiles.
    // The stated priority: the roster is a list to read, the tiles are a choice.
    const layout = lobbyLayout({ width: 320, height: 568 }, { isTouch: true });
    expect(layout.seats[0]!.height).toBeLessThan(SEAT_ROW_MAX_TOUCH);
    expect(layout.classOptions[0]!.height).toBeGreaterThanOrEqual(CLASS_TILE_MIN);
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
        // The row BODY is its leading share — the part the chips are clamped out
        // of (SEAT_TEAM_CHIP_MIN_BODY). It stopped being "everything left of the
        // trailing chips, centre included" at u3: the side chip now carries
        // `FRIENDLY A`, which a 221px phone row cannot hold right of its centre.
        const p = bodyPoint(layout.seats[i]!);
        expect(lobbyHitTest(layout, p.x, p.y), `seat[${i}] on ${name}`).toEqual({
          kind: 'seat',
          index: i,
        });
      }
      for (let i = 0; i < layout.classOptions.length; i++) {
        const p = center(layout.classOptions[i]!);
        expect(lobbyHitTest(layout, p.x, p.y), `class[${i}] on ${name}`).toEqual({
          kind: 'class',
          index: i,
        });
      }
      for (let i = 0; i < layout.maps.length; i++) {
        const p = center(layout.maps[i]!);
        expect(lobbyHitTest(layout, p.x, p.y), `map[${i}] on ${name}`).toEqual({
          kind: 'map',
          index: i,
        });
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

  it('keeps the lobby BACK exit inside the title band, clear of the room code (u2)', () => {
    for (const { name, vp, touch } of PROFILES) {
      const layout = lobbyLayout(vp, { isTouch: touch });
      expect(rectContains(layout.content, layout.leave), `leave escapes content on ${name}`).toBe(true);
      expect(rectContains(layout.title, layout.leave), `leave escapes title band on ${name}`).toBe(true);
      expect(overlaps(layout.leave, layout.roomCode), `leave overlaps room code on ${name}`).toBe(false);
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
        const body = bodyPoint(seat);

        // Both chips nest inside the row and leave its LEADING share clear — the
        // row body stays tappable (n2). The guaranteed body is the row's first
        // SEAT_TEAM_CHIP_MIN_BODY, not "everything up to the centre": u3 widened
        // the side chip to hold `FRIENDLY A`, which the landscape phone's 221px
        // row cannot fit right of centre. Every wider profile still keeps its
        // centre body — asserted below where the row can afford it.
        expect(rectContains(seat, chip), `difficulty chip ${i} escapes its row on ${name}`).toBe(true);
        expect(rectContains(seat, teamChip), `team chip ${i} escapes its row on ${name}`).toBe(true);
        expect(
          lobbyHitTest(layout, body.x, body.y),
          `row body ${i} on ${name}`,
        ).toEqual({ kind: 'seat', index: i });

        // The difficulty chip — the shared control, present in BOTH modes — cycles
        // the bot's tier. Right-anchored, so a tap on it wins over the body.
        if (chip.width > 0 && chip.height > 0) {
          expect(chip.x, `difficulty chip ${i} left of centre on ${name}`).toBeGreaterThan(mid);
          const c = center(chip);
          expect(lobbyHitTest(layout, c.x, c.y), `difficulty chip ${i} on ${name}`).toEqual({
            kind: 'seatChip',
            index: i,
          });
        }

        // …and it is wide enough to actually SAY the side (u3). The word is the
        // whole feature — `FRIENDLY A` measures 64px in the chip's 11px Audiowide
        // (measured in-container, the same way the 88px constant was chosen) — so
        // a chip that cannot hold it is a chip that would draw the word over the
        // name beside it. Every profile that draws a chip at all must fit it.
        if (teamChip.width > 0 && teamChip.height > 0) {
          expect(
            teamChip.width,
            `team chip ${i} cannot hold "FRIENDLY A" on ${name}`,
          ).toBeGreaterThanOrEqual(LONGEST_SIDE_LABEL_PX + 2 * TEAM_CHIP_LABEL_PAD);
        }

        // The team chip — composed to the LEFT of the difficulty chip (TEAMS) —
        // cycles the side. It, too, stays right of centre and never overlaps the
        // difficulty chip, so editing one control never costs the other.
        if (teamChip.width > 0 && teamChip.height > 0) {
          expect(
            teamChip.x,
            `team chip ${i} eats into the row's body zone on ${name}`,
          ).toBeGreaterThanOrEqual(seat.x + seat.width * SEAT_TEAM_CHIP_MIN_BODY);
          expect(
            overlaps(teamChip, chip),
            `team chip ${i} overlaps difficulty chip on ${name}`,
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
});

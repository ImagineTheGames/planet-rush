/**
 * src/ui/hud-geometry.test.ts — the M2 HUD's LAYOUT CONTRACT, headless.
 *
 * QA's `tests/mobile/layout.spec.ts` asserts that every element the app
 * registers sits inside its declared anchor. It can only assert that for
 * elements the frozen golden scene actually *draws* — and the golden scene is a
 * ship two seconds into a match, so the Build & Upgrade wheel is closed, the
 * upgrade panel behind it is closed, and nothing has shot the player's station.
 * The three loudest M2 elements are therefore invisible to it.
 *
 * This file closes that hole from the other side: it takes the same geometry the
 * views draw with ({@link ./hud-geometry}), resolves the same anchor zones the
 * registry publishes (`resolveAnchor`), and applies the registry's own
 * containment test (`rectContains`) — across every device profile in QA's matrix,
 * in both orientations. Same "should" geometry, same verdict function, no Pixi.
 *
 * If one of these fails, the element is out of its anchor on a real phone; the
 * fix is the element's placement or (argued, in `Hud.describeLayout`) its anchor
 * — never the tolerance.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { homeArrow, ARROW_EDGE_INSET } from './alarm';
import { hudMetrics, hudType } from './instrument';
import { collapsedRect } from './minimap';
import type { MinimapInsets } from './minimap';
import {
  wheelBounds,
  panelBounds,
  panelSize,
  stationHpBounds,
  alarmFrameBounds,
  arrowPoly,
  polyBounds,
  ARROW_SIZE,
  PANEL_MAX_WIDTH,
  PANEL_EDGE_PAD,
  HUD_PAD,
  HP_BAR_WIDTH,
  HP_BAR_HEIGHT,
  HP_BAR_TOP,
  HP_VALUE_ROW,
  SHIELD_BAR_GAP,
  SHIELD_BAR_HEIGHT,
  promptBounds,
  promptBand,
  promptLineBox,
  promptMaxHeight,
  promptPad,
  promptWithdraws,
  promptWrapWidth,
  PROMPT_TYPE,
  PROMPT_WHEEL_GAP,
  wheelFootprint,
  WHEEL_HALO_SPAN,
  waveClockLayout,
  CLOCK_WHEEL_GAP,
  PROMPT_MIN_TEXT_WIDTH,
  PROMPT_STRIP_RESERVE,
  PROMPT_THUMB_COLUMN,
  respawnBounds,
  respawnWrapWidth,
  RESPAWN_CENTER_Y,
  wheelRadius,
  wedgeHitTarget,
  sectorOverflow,
  TOUCH_TARGET_MIN,
} from './hud-geometry';
import type { AnnularSector } from './hud-geometry';
import { describeViolation, exclusionViolations, LAYOUT_EXCLUSIONS } from './layout-exclusions';
import { textWidth } from './font-metrics';
import type { TypeSpec } from './font-metrics';
import { TRACKING, WHEEL_HALO, wheelMetrics } from '../art/materials';
import { buildWheelModel, segmentAngle, WHEEL_ORDER } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import {
  buildWedgeLines,
  capWords,
  fitWedgeStack,
  MIN_NAME_FIT_SCALE,
  scaleName,
  statWords,
  targetWords,
  upgradeWedgeLines,
  wedgeStackBoxes,
} from './wheel-stack';
import type { WedgeLine } from './wheel-stack';
import {
  upgradeWheelModel,
  upgradeWheelSlots,
  UPGRADE_LADDER,
  UpgradeTrack,
  WHEEL_TRACK_ORDER,
  STOCK_TIERS,
} from './upgrade-wheel';
import type { UpgradeLadder, UpgradeWheelSignals } from './upgrade-wheel';
import { ShipClass } from '@shared/types';
import { PromptId, resolvePromptText } from './onboarding';
import type { ControlScheme } from './settings';
import { WAVE_NAMES } from './wave-clock';
import { FireMode } from '@platform/actions';
import type { DeviceKind } from '@platform/actions';

// ---------------------------------------------------------------------------
// The device matrix — QA's playwright.config.ts profiles, both orientations,
// plus two narrow phones the matrix does not cover but real players carry.
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
  readonly vp: Viewport;
  /** What this profile IS, for the assertions whose answer depends on the device
   *  rather than only on the viewport: the phones carry thumb sticks and no
   *  controls strip, the desktop carries the strip and no sticks (GDD §2.2/§2.4). */
  readonly isTouch: boolean;
}

const PROFILES: readonly Profile[] = [
  { name: 'iphone/portrait', vp: { width: 390, height: 844 }, isTouch: true },
  { name: 'iphone/landscape', vp: { width: 844, height: 390 }, isTouch: true },
  // QA's a0-99/a0-100 capture, to the logical pixel. Not an emulation-matrix
  // profile: it is a real handset's landscape viewport once the browser chrome
  // has taken its cut, and it is the frame the objective prompt was drawn
  // through the build wheel on. In the matrix permanently now — the narrowest
  // width anyone has actually photographed this HUD at.
  { name: 'qa-phone/landscape', vp: { width: 798, height: 384 }, isTouch: true },
  { name: 'pixel/portrait', vp: { width: 412, height: 915 }, isTouch: true },
  { name: 'pixel/landscape', vp: { width: 915, height: 412 }, isTouch: true },
  { name: 'desktop', vp: { width: 1280, height: 800 }, isTouch: false },
  // Not in the emulation matrix; the smallest screens the game claims to run on
  // (GDD §4.3 "mobile-browser playability"). A thumb-scale overlay has to hold
  // here too, and the panel's viewport clamp exists because of this row.
  { name: 'iphone-se/portrait', vp: { width: 375, height: 667 }, isTouch: true },
  { name: 'small/portrait', vp: { width: 320, height: 568 }, isTouch: true },
  // …and the same device the way the landscape lock actually hands it over. This
  // is the one row in the matrix where the bottom band cannot hold a prompt; the
  // degradation is asserted by name below rather than left to be discovered.
  { name: 'small/landscape', vp: { width: 568, height: 320 }, isTouch: true },
];

/** The four upgrade tracks (GDD §2.5: power, engine, cargo, hull). */
const UPGRADE_ROWS = 4;

const FULL: AnchorSpec = { region: 'full', margin: 0 };

const fmt = (r: Rect): string =>
  `{x:${r.x.toFixed(1)}, y:${r.y.toFixed(1)}, w:${r.width.toFixed(1)}, h:${r.height.toFixed(1)}}`;

/** Do two rects overlap at all? Touching edges do not count as an overlap — the
 *  clock clearing the wheel by exactly zero is still clear. Lives here rather
 *  than in hud-geometry.ts because only this suite asks the question; the view
 *  draws the two rects, it never tests them against each other. */
function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** The registry's own verdict, with its own resolver — not a re-implementation. */
function withinAnchor(bounds: Rect, anchor: AnchorSpec, vp: Viewport): boolean {
  return rectContains(resolveAnchor(anchor, vp), bounds);
}

function expectWithin(bounds: Rect, anchor: AnchorSpec, vp: Viewport, label: string): void {
  const zone = resolveAnchor(anchor, vp);
  expect(
    withinAnchor(bounds, anchor, vp),
    `${label}: bounds ${fmt(bounds)} escape "${anchor.region}" zone ${fmt(zone)} ` +
      `for viewport ${vp.width}×${vp.height}`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// The Build & Upgrade wheel (GDD §2.5) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('build-wheel placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(wheelBounds(vp.width, vp.height), FULL, vp, 'build-wheel');
    });
  }

  it('is centred on the screen — where the follow camera puts your station', () => {
    // GDD §2.2: the wheel appears "near your own station". The camera keeps the
    // local ship centred, and the wheel opens only while docked at home, so
    // "near your station" is the screen centre.
    for (const { name, vp } of PROFILES) {
      const b = wheelBounds(vp.width, vp.height);
      expect(b.x + b.width / 2, name).toBeCloseTo(vp.width / 2, 6);
      expect(b.y + b.height / 2, name).toBeCloseTo(vp.height / 2, 6);
    }
  });

  it('is a thumb-scale target on every phone — never a pinprick, never the screen', () => {
    for (const { name, vp } of PROFILES) {
      const b = wheelBounds(vp.width, vp.height);
      const shortSide = Math.min(vp.width, vp.height);
      // Big enough to hit with a thumb…
      expect(b.width, `${name} too small`).toBeGreaterThanOrEqual(200);
      // …and never so big it swallows the shorter screen dimension whole.
      expect(b.width, `${name} too big`).toBeLessThan(shortSide);
    }
  });
});

describe('build-wheel drawn footprint (a0-100)', () => {
  it('is the halo, and the halo is what `build-wheel-view` actually fills', () => {
    // `WHEEL_HALO_SPAN` is the reason the registry reads 318.5 where `wheelBounds`
    // says 276.5, so it cannot be a number somebody measured off a screenshot. It
    // is re-derived here the way `drawRings` draws: the pool is stepped into
    // `bands` nested fills from `fadeTo × r` inward to `holdTo × r`, and band 0 is
    // laid out at zero alpha and SKIPPED (`if (alpha <= 0) continue`). So the
    // largest circle the view fills is band 1, and that is the outermost pixel the
    // wheel puts on the screen.
    const { bands, fadeTo, holdTo, peak } = WHEEL_HALO;
    const alphaOf = (i: number): number => {
      const outward = (bands - i) / bands;
      return peak * (1 - outward) * (1 - outward);
    };
    const radiusOf = (i: number): number => fadeTo + ((holdTo - fadeTo) * i) / bands;
    expect(alphaOf(0), 'band 0 is drawn at zero coverage and skipped').toBe(0);
    expect(alphaOf(1)).toBeGreaterThan(0);
    expect(WHEEL_HALO_SPAN).toBeCloseTo(radiusOf(1), 12);
    // …and it really is outside the rim, which is the whole point.
    expect(WHEEL_HALO_SPAN).toBeGreaterThan(1);
  });

  it('reproduces the rect QA read out of the registry on the phone that failed', () => {
    // a0-99's verdict, verbatim: `build-wheel` occupies (239.7, 32.7) 318.5×318.5
    // on a 798×384 phone. If this stops matching, the model here and the pixels
    // there have parted company and every clearance computed from it is a guess.
    const f = wheelFootprint(798, 384);
    expect(f.x).toBeCloseTo(239.7, 1);
    expect(f.y).toBeCloseTo(32.7, 1);
    expect(f.width).toBeCloseTo(318.5, 1);
    expect(f.height).toBeCloseTo(318.5, 1);
  });

  it('contains the disc, and stays inside the screen it is drawn on', () => {
    for (const { name, vp } of PROFILES) {
      const disc = wheelBounds(vp.width, vp.height);
      const foot = wheelFootprint(vp.width, vp.height);
      expect(rectContains(foot, disc), `${name}: the footprint must contain the disc`).toBe(true);
      // `full` + 0 is what `Hud.describeLayout` registers it under, and the halo
      // is part of what is drawn — so the anchor has to hold for the bigger rect.
      expectWithin(foot, FULL, vp, 'build-wheel (drawn footprint)');
    }
  });
});

// ---------------------------------------------------------------------------
// The upgrade WHEEL (GDD §2.5) — registered `full`, margin 0
// ---------------------------------------------------------------------------
//
// The upgrade screen was rebuilt from a table-panel into a radial wheel (field
// report v0.2), drawn by the same view as the Build wheel and so occupying the
// same centred `2r` square. Its DRAWN, registry-registered footprint is therefore
// `wheelBounds`, tested here as `upgrade-wheel`.

describe('upgrade-wheel placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(wheelBounds(vp.width, vp.height), FULL, vp, 'upgrade-wheel');
    });
  }

  it('shares the Build wheel\'s centred footprint — same component, same square', () => {
    for (const { name, vp } of PROFILES) {
      const b = wheelBounds(vp.width, vp.height);
      expect(b.x + b.width / 2, name).toBeCloseTo(vp.width / 2, 6);
      expect(b.y + b.height / 2, name).toBeCloseTo(vp.height / 2, 6);
    }
  });
});

// The old table-panel geometry (`panelSize`/`panelBounds`/`PANEL_ROW_HEIGHT`)
// still backs the platform pointer hit-test for the upgrade screen
// (`@platform/wheel-input`'s `hitPanel`), pending its companion migration to
// angular `hitWheel` selection now that the screen is radial. It no longer
// describes anything DRAWN, so it is exercised as a plain geometry contract
// rather than a placement one.
describe('upgrade hit-region geometry (legacy panel — platform hit-test)', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(panelBounds(vp.width, vp.height, UPGRADE_ROWS), FULL, vp, 'upgrade-panel');
    });
  }

  it('clamps its width to a narrow phone instead of running off the side', () => {
    const narrow = panelSize(320, 568, UPGRADE_ROWS);
    expect(narrow.width).toBe(320 - 2 * PANEL_EDGE_PAD);
    expect(narrow.width).toBeLessThan(PANEL_MAX_WIDTH);
  });

  it('never exceeds its readable maximum on a desktop', () => {
    expect(panelSize(2560, 1440, UPGRADE_ROWS).width).toBe(PANEL_MAX_WIDTH);
  });

  it('grows by exactly one row height per upgrade track', () => {
    const four = panelSize(1280, 800, 4).height;
    const five = panelSize(1280, 800, 5).height;
    expect(five - four).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Your own station's HP (GDD §2.2) — registered `top-right`, margin HUD_PAD
// ---------------------------------------------------------------------------

describe('station-hp placement', () => {
  const TOP_RIGHT: AnchorSpec = { region: 'top-right', margin: HUD_PAD };
  /** Measured width of the widest label the element ever draws ("HOME LOST" at
   *  11px Audiowide ≈ 62px). Generous on purpose: the assertion should survive a
   *  font swap, and the footprint is the union of the label and the bar. */
  const LABEL_WIDTH = 80;

  for (const { name, vp } of PROFILES) {
    it(`stays in the top-right corner at ${name}`, () => {
      expectWithin(stationHpBounds(vp.width, LABEL_WIDTH), TOP_RIGHT, vp, 'station-hp');
    });
  }

  it('hugs the right margin exactly — a corner element, not a floating box', () => {
    for (const { name, vp } of PROFILES) {
      const b = stationHpBounds(vp.width, LABEL_WIDTH);
      expect(b.x + b.width, name).toBeCloseTo(vp.width - HUD_PAD, 6);
      expect(b.y, name).toBeCloseTo(HUD_PAD, 6);
    }
  });

  it('never crosses the half-width line into the left half of the screen', () => {
    // This is the constraint that makes HP_BAR_WIDTH a decision rather than a
    // number. `top-right`'s zone starts at W/2, so the bar's budget is
    // W/2 − HUD_PAD: 144px on the narrowest screen the game claims (GDD §4.3),
    // against a 140px bar. Widen the bar and own-station HP silently leaves its
    // anchor — and because the day-2 HUD fields are not fed at runtime yet, QA's
    // layout contract cannot see it happen. This assertion is that guard.
    const narrowest = Math.min(...PROFILES.map((p) => p.vp.width));
    expect(narrowest).toBe(320);
    expect(HP_BAR_WIDTH).toBeLessThanOrEqual(narrowest / 2 - HUD_PAD);
  });

  it('leaves room for the shield overbar above the core bar', () => {
    // The shield overbar is drawn SHIELD_BAR_HEIGHT + SHIELD_BAR_GAP above the
    // core bar's top edge; that has to stay below the label, i.e. inside the
    // element's own footprint rather than poking out above y = HUD_PAD.
    expect(SHIELD_BAR_HEIGHT + SHIELD_BAR_GAP).toBeLessThanOrEqual(HP_BAR_TOP);
  });

  it('does not draw the shield overbar through the core VALUE', () => {
    // The regression this pins shipped on `main`: the overbar's top edge sat one
    // pixel under `100/100`'s baseline, so a station with a generator standing
    // struck its own number through. The value row owns the top of the element and
    // the overbar starts below it — with air, not flush.
    const overbarTop = HP_BAR_TOP - SHIELD_BAR_HEIGHT - SHIELD_BAR_GAP;
    expect(overbarTop).toBeGreaterThanOrEqual(HP_VALUE_ROW);
    // …and the whole stack still hangs inside the footprint the registry records.
    expect(stationHpBounds(1280).height).toBe(HP_BAR_TOP + HP_BAR_HEIGHT);
  });
});

// The own-ship HULL readout that used to stack under HOME was removed (field
// report v0.2 — the over-ship bar is the truth now), so its top-right placement
// block went with it. The corner now carries only `station-hp`, tested above.

// ---------------------------------------------------------------------------
// The wave clock vs the open wheel (a0-24) — two top-anchored things, one phone
// ---------------------------------------------------------------------------

describe('wave clock placement', () => {
  /** One line box at a reference type size, the same derivation the prompt's
   *  worst case uses: the HUD's own scaled size times Pixi's ~1.3 leading. */
  const lineBox = (vp: Viewport, referencePx: number): number =>
    Math.ceil(hudType(referencePx, hudMetrics(vp.width, vp.height)) * 1.3);

  /**
   * The three readouts as the view measures them. Widths are estimated from the
   * drawn type size and the longest string each line can carry, deliberately on
   * the generous side — a WIDER clock is the harder case for the row form, so an
   * over-estimate cannot make this test pass by accident.
   *
   *  - `WAVE 5/5 · <name>` — over the longest name in `WAVE_NAMES`, read from the
   *    clock's own module so a renamed wave is measured rather than assumed.
   *  - `FINAL WAVE` / `NEXT 12:00` — the longest the countdown line goes.
   *  - `MATCH 12:00`               — the longest the match clock goes.
   */
  const LONGEST_WAVE_LINE = `WAVE 5/5 · ${WAVE_NAMES.reduce((a, b) => (b.length > a.length ? b : a), '')}`;
  const CLOCK_STRINGS: readonly { chars: number; size: number }[] = [
    { chars: LONGEST_WAVE_LINE.length, size: 15 },
    { chars: 'FINAL WAVE'.length, size: 14 },
    { chars: 'MATCH 12:00'.length, size: 13 },
  ];
  /** Advance per character as a fraction of the em, for the widest face the HUD
   *  draws (Audiowide) plus its `name`-tier tracking. Audiowide's own average is
   *  ~0.72em; 0.85 is the ceiling this test holds the layout to. */
  const ADVANCE = 0.85;

  const lines = (vp: Viewport): { width: number; height: number }[] =>
    CLOCK_STRINGS.map(({ chars, size }) => {
      const px = hudType(size, hudMetrics(vp.width, vp.height));
      return { width: Math.ceil(chars * px * ADVANCE), height: lineBox(vp, size) };
    });

  it('NEVER INTERSECTS THE OPEN WHEEL — the clip a0-24 was filed with', () => {
    // The developer's capture: at 844×390 the wheel's footprint starts at y 54.6
    // and the stacked strip runs past it, so `MATCH 0:10` is drawn under the
    // TURRET wedge. The clock is what the build decision is being made against,
    // so the strip re-flows to one row rather than losing its third line.
    //
    // Asserted as a RULE, not as a picture: the strip's drawn rect and the
    // wheel's drawn rect do not overlap, on every profile in the matrix, in both
    // wheel states. A golden proves one string at one length; this proves the
    // rule for every screen we claim to run on.
    for (const { name, vp } of PROFILES) {
      const wheel = wheelBounds(vp.width, vp.height);
      const open = waveClockLayout(vp.width, vp.height, lines(vp), true);
      expect(
        rectsIntersect(open.bounds, wheel),
        `${name}: clock ${fmt(open.bounds)} overlaps the open wheel ${fmt(wheel)}`,
      ).toBe(false);
      // …and with the clearance the compact decision is taken on, so a strip that
      // merely grazes the disc still counts as a failure here.
      expect(open.bounds.y + open.bounds.height + CLOCK_WHEEL_GAP, name).toBeLessThanOrEqual(
        wheel.y + 1e-6,
      );
    }
  });

  it('stays inside the screen and under the HUD margin, in both forms', () => {
    for (const { name, vp } of PROFILES) {
      for (const wheelOpen of [false, true]) {
        const layout = waveClockLayout(vp.width, vp.height, lines(vp), wheelOpen);
        const label = `${name} / wheel=${wheelOpen ? 'open' : 'closed'}`;
        expect(layout.bounds.y, label).toBeGreaterThanOrEqual(HUD_PAD - 1e-6);
        expect(layout.bounds.x, label).toBeGreaterThanOrEqual(0);
        expect(layout.bounds.x + layout.bounds.width, label).toBeLessThanOrEqual(vp.width + 1e-6);
      }
    }
  });

  it('re-flows ONLY where the stack cannot fit — desktop is untouched', () => {
    // The compact row is a phone answer, and the assertion that keeps it one is
    // this: the desktop control never re-flows, in either wheel state, and no
    // profile re-flows while the wheel is closed. Pinning the SET of screens that
    // do means a change which compacts a new one fails here rather than shipping.
    const compactWhileOpen: string[] = [];
    for (const { name, vp } of PROFILES) {
      expect(
        waveClockLayout(vp.width, vp.height, lines(vp), false).compact,
        `${name}: the strip re-flowed with no wheel on screen`,
      ).toBe(false);
      if (waveClockLayout(vp.width, vp.height, lines(vp), true).compact) compactWhileOpen.push(name);
    }
    expect(compactWhileOpen, 'the short landscape viewports, and only those').toEqual([
      'iphone/landscape',
      'qa-phone/landscape',
      'pixel/landscape',
      'small/landscape',
    ]);
  });

  it('keeps all three readouts, in order, whichever form it takes', () => {
    // The whole point of re-flowing rather than dropping a line: the row carries
    // the same three readouts, left to right, in the stack's top-to-bottom order.
    const vp = { width: 844, height: 390 };
    const measured = lines(vp);
    const row = waveClockLayout(vp.width, vp.height, measured, true);
    expect(row.compact).toBe(true);
    expect(row.lines).toHaveLength(3);
    for (let i = 1; i < row.lines.length; i++) {
      expect(row.lines[i]!.x, `readout ${i} sits right of ${i - 1}`).toBeGreaterThan(
        row.lines[i - 1]!.x,
      );
    }
    // …and every one of them is inside the chrome that darkens it.
    for (let i = 0; i < row.lines.length; i++) {
      const half = measured[i]!.width / 2;
      expect(row.lines[i]!.x - half).toBeGreaterThanOrEqual(row.chrome.x - 1e-6);
      expect(row.lines[i]!.x + half).toBeLessThanOrEqual(row.chrome.x + row.chrome.width + 1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// The onboarding prompt (GDD §2.10) — registered `full`, margin HUD_PAD
// ---------------------------------------------------------------------------

describe('onboarding placement', () => {
  const FULL_PAD: AnchorSpec = { region: 'full', margin: HUD_PAD };

  /** Both device answers, because the band is different on each: desktop reserves
   *  the controls strip at the bottom, touch reserves the thumb columns at the
   *  sides. A prompt verified on one says nothing about the other. */
  const DEVICES: readonly { name: string; isTouch: boolean }[] = [
    { name: 'desktop-input', isTouch: false },
    { name: 'touch', isTouch: true },
  ];

  /** One line box of prompt type at this viewport — the HUD's own scaled 16px
   *  heading, times the ~1.3 leading Pixi lays a Text out with. Derived rather
   *  than pinned at 20, because the whole point of the frame scale is that a
   *  phone's prompt is smaller and the band arithmetic has to see that. */
  const lineBox = (vp: Viewport): number =>
    Math.ceil(hudType(16, hudMetrics(vp.width, vp.height)) * 1.3);

  /** The band's legibility floor: the narrowest it is ever allowed to be, however
   *  much of the screen the wheel, the sticks and the map have already taken. */
  const floorWidth = (vp: Viewport): number =>
    PROMPT_MIN_TEXT_WIDTH + promptPad(vp.width, vp.height).x;

  /** A worst-case prompt: text wrapped to the widest line the wrap allows, over
   *  enough lines to cover the longest authored string on the narrowest phone. */
  const worstCase = (vp: Viewport, isTouch: boolean, lines: number): { w: number; h: number } => ({
    w: promptWrapWidth(vp.width, vp.height, isTouch),
    h: lines * lineBox(vp),
  });

  for (const { name, vp } of PROFILES) {
    for (const dev of DEVICES) {
      it(`stays on screen and inside the HUD margin at ${name} / ${dev.name}`, () => {
        const { w, h } = worstCase(vp, dev.isTouch, 4);
        expectWithin(
          promptBounds(vp.width, vp.height, w, h, dev.isTouch),
          FULL_PAD,
          vp,
          'onboarding',
        );
      });
    }
  }

  it('lands exactly on its band at the wrap ceiling — the assertion that earns its keep', () => {
    // The prompt claims `full` + PAD *because* it is wrapped to fit inside it, and
    // since u7-07 it makes the stronger promise too: it fits the CLEAR BAND, which
    // is narrower. If the wrap budget ever stops paying for PROMPT_PAD_X and the
    // stroke, a prompt whose text reaches the ceiling registers wider than the band
    // it was measured for — and runs under a thumb stick on the one screen least
    // likely to be looked at by eye.
    for (const { name, vp } of PROFILES) {
      for (const dev of DEVICES) {
        const band = promptBand(vp.width, vp.height, dev.isTouch);
        const b = promptBounds(
          vp.width,
          vp.height,
          promptWrapWidth(vp.width, vp.height, dev.isTouch),
          20,
          dev.isTouch,
        );
        const label = `${name} / ${dev.name}`;
        expect(b.x, label).toBeGreaterThanOrEqual(band.x - 1e-6);
        expect(b.x + b.width, label).toBeLessThanOrEqual(band.x + band.width + 1e-6);
        expect(b.width, label).toBeCloseTo(band.width, 6);
      }
    }
  });

  it('hangs from the bottom of its band, clear of the strip and the safe margin', () => {
    for (const { name, vp } of PROFILES) {
      for (const dev of DEVICES) {
        const band = promptBand(vp.width, vp.height, dev.isTouch);
        const b = promptBounds(vp.width, vp.height, 200, 20, dev.isTouch);
        const label = `${name} / ${dev.name}`;
        expect(b.y + b.height, label).toBeCloseTo(band.y + band.height, 6);
        const reserve = dev.isTouch ? 0 : PROMPT_STRIP_RESERVE;
        expect(b.y + b.height, label).toBeLessThanOrEqual(vp.height - HUD_PAD - reserve + 1e-6);
      }
    }
  });

  it('CLEARS THE BUILD WHEEL at a one-line prompt — or withdraws, never between', () => {
    // The regression u7-07 was written for: at 844×390 the wheel spans y 54.6 →
    // 335.4 (72% of the screen) and the old `PROMPT_CENTER_Y = 0.72` put the
    // prompt at y 259 → 302, squarely over the REPAIR REACTOR and RADAR wedges —
    // and the SPEND prompt fires WHILE the wheel is open by design (GDD §2.10),
    // so that was its normal state, not an edge case.
    //
    // u7-07's answer had a third leg that a0-100 removed: where the band could
    // not hold the panel, the panel kept its bottom edge and GREW UP into the
    // wedges, on the argument that the scrim made the overlap readable. QA's
    // 798×384 capture is what that argument buys. So the two outcomes are now
    // exactly two — the prompt clears the wheel's drawn footprint, or it is not
    // drawn at all — and this pins the SET of screens that take the second one.
    //
    // Asserted per profile against the device class that profile ACTUALLY IS: the
    // phones are touch (no controls strip, thumb columns instead) and the desktop
    // is not.
    const withdrawn: string[] = [];
    for (const { name, vp, isTouch } of PROFILES) {
      const wheel = wheelFootprint(vp.width, vp.height);
      if (promptWithdraws(vp.width, vp.height, isTouch, {}, true)) {
        const band = promptBand(vp.width, vp.height, isTouch, {}, true);
        withdrawn.push(`${name} (band ${band.height.toFixed(1)}px, needs ${(lineBox(vp) + promptPad(vp.width, vp.height).y).toFixed(1)}px)`);
        continue;
      }
      const b = promptBounds(vp.width, vp.height, 200, lineBox(vp), isTouch, {}, true);
      expect(
        rectsIntersect(b, wheel),
        `${name}: prompt ${fmt(b)} overlaps the open wheel ${fmt(wheel)}`,
      ).toBe(false);
    }

    // …and the screens where it CANNOT clear, named. Every one is a landscape
    // phone, and the arithmetic is the same on each: the wheel's drawn footprint
    // is `WHEEL_HALO_SPAN × 2r` on a side, which on a 384px-tall screen is 318.5
    // of it, leaving about 11px between the footprint and the HUD margin for a
    // 33px prompt. There is no fourth option — above the wheel is the wave clock,
    // beside it are the thumb columns, and the type is already on `hudType`'s
    // floor — so the prompt withdraws until the wheel closes and comes back
    // whole. Pinning the SET here means a change that withdraws the prompt from a
    // NEW screen fails this test instead of quietly shipping.
    expect(withdrawn, 'the landscape phones, and only those').toEqual([
      'iphone/landscape (band 11.2px, needs 33.0px)',
      'qa-phone/landscape (band 10.7px, needs 33.0px)',
      'pixel/landscape (band 13.1px, needs 33.0px)',
      'small/landscape (band 0.0px, needs 33.0px)',
    ]);
  });

  it('keeps the prompt on every screen once the wheel is CLOSED — withdrawal is a deferral', () => {
    // The other half of "withdraw". A prompt that vanished on a landscape phone
    // for the rest of the match would not be an arbitration, it would be a
    // deletion — and the SPEND lesson would be the one it deleted, since that one
    // fires while the wheel is open by design. What the band reserves is the
    // OPEN wheel's footprint, and a closed wheel draws nothing and registers
    // nothing, so the whole safe area comes back the moment it shuts.
    for (const { name, vp, isTouch } of PROFILES) {
      expect(
        promptWithdraws(vp.width, vp.height, isTouch, {}, false),
        `${name}: the prompt has nowhere to go with no wheel on screen`,
      ).toBe(false);
      // …and it is a real band, not a sliver: room for the four-line worst case
      // the `full` + PAD assertions above are written against.
      const band = promptBand(vp.width, vp.height, isTouch, {}, false);
      expect(band.height, `${name}: closed-wheel band`).toBeGreaterThanOrEqual(
        4 * lineBox(vp) + promptPad(vp.width, vp.height).y,
      );
    }
  });

  it('clears the touch thumb columns — or falls back to the legibility floor, never between', () => {
    // The other half of the fix: the band stops short of the columns
    // `@platform/touch-visuals` puts the sticks / FIRE in, so the wrap can never
    // produce a line that reaches them.
    //
    // There is one screen where it CANNOT: a 390px-wide logical viewport has
    // 390 − 2·16 − 2·156 = 46px left between the two thumb columns, which is not a
    // prompt, it is a word. The floor wins there and the prompt is drawn over a
    // stick — deliberately, because a legible prompt over a stick beats an
    // illegible one beside it (GDD §2.10: a prompt the player cannot read is a
    // prompt that did not fire). What this asserts is that those are the only two
    // answers: fully clear, or exactly at the floor.
    for (const { name, vp } of PROFILES) {
      const band = promptBand(vp.width, vp.height, true);
      const clearsLeft = band.x >= HUD_PAD + PROMPT_THUMB_COLUMN - 1e-6;
      const clearsRight = band.x + band.width <= vp.width - HUD_PAD - PROMPT_THUMB_COLUMN + 1e-6;
      const atFloor = Math.abs(band.width - floorWidth(vp)) < 1e-6;
      expect(
        (clearsLeft && clearsRight) || atFloor,
        `${name}: band ${fmt(band)} neither clears the thumb columns nor sits at the floor`,
      ).toBe(true);
    }
  });

  it('clears the minimap\'s collapsed corner square — or falls back to the floor', () => {
    // The prompt and the corner map share the bottom band. The band is limited by
    // the map's own `collapsedRect` rather than by a copy of its numbers, so the
    // two cannot drift apart the day the map's size or its FIRE-column clearance
    // changes. Same two-answer rule as the thumb columns above.
    for (const { name, vp } of PROFILES) {
      for (const isTouch of [false, true]) {
        const band = promptBand(vp.width, vp.height, isTouch);
        const map = collapsedRect(vp, isTouch);
        const clears = band.x + band.width <= map.x + 1e-6;
        const atFloor = Math.abs(band.width - floorWidth(vp)) < 1e-6;
        expect(
          clears || atFloor,
          `${name} / touch=${isTouch}: band right ${(band.x + band.width).toFixed(1)} vs map left ${map.x.toFixed(1)}`,
        ).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // a0-24 — the bottom edge, for EVERY authored prompt and every safe area
  // -------------------------------------------------------------------------

  /**
   * Every string GDD §2.10 actually puts on screen, resolved through the action
   * layer for every device and both fire modes — because `{fire}` and `{build}`
   * are what make one template four strings of different lengths, and the brief
   * asks for the longest one in `./onboarding`, not the one in the screenshot.
   *
   * **Both control schemes too, since a0-33**: the copy branches on the seated
   * scheme now, and Tap Commander's wordings are the longest the game authors
   * ("Hold full — tap your own station to bank in its collection field, then
   * press BUILD to spend"). A sweep that only knew the stick sentences would be
   * measuring a screen no defaulted player is on.
   */
  const AUTHORED_PROMPTS: readonly { label: string; text: string }[] = (() => {
    const out: { label: string; text: string }[] = [];
    const devices: DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
    const schemes: ControlScheme[] = ['sticks', 'tap'];
    for (const id of Object.values(PromptId)) {
      for (const device of devices) {
        for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
          for (const scheme of schemes) {
            out.push({
              label: `${id}/${device}/${mode}/${scheme}`,
              text: resolvePromptText(id, device, mode, scheme),
            });
          }
        }
      }
    }
    return out;
  })();

  /**
   * Advance per character as a fraction of the em, generous for the widest face
   * the HUD draws. An OVER-estimate is the conservative direction here: it wraps
   * the prompt onto more lines than it will really take, so the panel this test
   * measures is taller than the one that ships.
   */
  const ADVANCE = 0.85;

  /** How tall the panel gets for one authored string on one screen: wrapped to
   *  the band, at the HUD's own scaled type, plus the panel's padding. */
  const panelHeight = (text: string, vp: Viewport, isTouch: boolean, insets: MinimapInsets): number => {
    const px = hudType(16, hudMetrics(vp.width, vp.height));
    const wrap = promptWrapWidth(vp.width, vp.height, isTouch, insets);
    const rows = Math.max(1, Math.ceil((text.length * px * ADVANCE) / wrap));
    return rows * Math.ceil(px * 1.3) + promptPad(vp.width, vp.height).y;
  };

  /**
   * The safe-area crops a real phone reports. Zero is every desktop and every
   * Playwright baseline — which is exactly why no golden caught a0-24. The rest
   * are a home indicator, a landscape notch, and a browser URL bar left standing
   * over the bottom of a canvas that was never resized (`main.ts` `readViewport`).
   */
  const BOTTOM_INSETS: readonly number[] = [0, 21, 34, 44, 88];

  it('KEEPS ITS BOTTOM EDGE INSIDE THE SAFE AREA — every prompt, every crop', () => {
    // The second clip a0-24 was filed with: the panel ran off the bottom of the
    // screen mid-sentence. It is a rule, not a picture — for every authored
    // string, on every profile, at every safe-area crop, the drawn panel's bottom
    // edge is inside the visible viewport with the HUD margin still to spare.
    for (const { name, vp, isTouch } of PROFILES) {
      for (const bottom of BOTTOM_INSETS) {
        const insets: MinimapInsets = { bottom };
        for (const { label, text } of AUTHORED_PROMPTS) {
          const h = panelHeight(text, vp, isTouch, insets);
          const b = promptBounds(vp.width, vp.height, 10_000, h - promptPad(vp.width, vp.height).y, isTouch, insets);
          const visibleBottom = vp.height - bottom;
          expect(
            b.y + b.height,
            `${name} / inset ${bottom} / ${label}: panel ${fmt(b)} past the safe area`,
          ).toBeLessThanOrEqual(visibleBottom - HUD_PAD + 1e-6);
          expect(b.y, `${name} / inset ${bottom} / ${label}: panel above the top margin`)
            .toBeGreaterThanOrEqual(HUD_PAD - 1e-6);
        }
      }
    }
  });

  it('never needs the height cap for authored copy — the cap is a guardrail', () => {
    // `promptBounds` clamps the panel to `promptMaxHeight`, which is what makes
    // the bottom edge unconditional. That clamp must never actually BITE for a
    // real prompt, because a capped panel is a panel the text overflows: if this
    // fails, the copy or the type has outgrown the screen and the answer is one
    // of those, not a taller clamp.
    for (const { name, vp, isTouch } of PROFILES) {
      for (const bottom of BOTTOM_INSETS) {
        const insets: MinimapInsets = { bottom };
        const cap = promptMaxHeight(vp.height, isTouch, insets);
        for (const { label, text } of AUTHORED_PROMPTS) {
          expect(
            panelHeight(text, vp, isTouch, insets),
            `${name} / inset ${bottom} / ${label}: needs more than the ${cap.toFixed(0)}px cap`,
          ).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('lifts off the bottom by exactly the safe-area inset', () => {
    // The inset is *consumed*, not merely tolerated: feeding a crop in moves the
    // panel up by that crop and nothing else.
    //
    // Asserted on the BOTTOM edge rather than the top since a0-100, because the
    // top is no longer the panel's free end. The panel is clamped to the band and
    // the band's ceiling is the open wheel's drawn footprint, so on a landscape
    // phone — where the band is ~11px and the panel is capped by it — a crop moves
    // the bottom edge up by the full inset and the top by whatever is left. The
    // bottom edge is the thing the inset is about: it is the line the player's
    // home indicator or browser bar is eating, and it is what a0-24 filed.
    //
    // Worth being exact about what this does and does not catch. The geometry
    // below already honoured an inset on `main`; what `main` did not have was
    // anyone PASSING one — `HudFrame`'s inset field was declared, read by this
    // file's callers, and written by nobody, so the prompt was laid out against
    // the uncropped canvas and drawn into the strip of it the player cannot see.
    // That wiring is `main.ts` `viewportInsets()`, and it is not reachable from a
    // headless test; this assertion pins the contract that wiring depends on.
    for (const { name, vp, isTouch } of PROFILES) {
      const flat = promptBounds(vp.width, vp.height, 200, 20, isTouch);
      const cropped = promptBounds(vp.width, vp.height, 200, 20, isTouch, { bottom: 40 });
      expect(
        flat.y + flat.height - (cropped.y + cropped.height),
        `${name}`,
      ).toBeCloseTo(40, 6);
    }
  });

  it('CANNOT be pushed off the bottom by its own height — the clamp that was inverted', () => {
    // The bug in the clamp itself. It read `y = max(HUD_PAD, bandBottom − height)`
    // and its comment claimed an over-tall panel "grows upward into the wheel".
    // It does the opposite: pinning `y` at the top margin while keeping the full
    // height puts the BOTTOM edge at `HUD_PAD + height`, past the band, past the
    // safe area and — for a tall enough panel — past the viewport. A prompt cut
    // off by the bottom of the screen is precisely a0-24's second capture, and it
    // is length-dependent because `height` is the wrapped text's height.
    //
    // Fed a panel taller than the whole screen, so the old clamp is the one that
    // would be reached: the rect still ends on the safe-area line.
    for (const { name, vp, isTouch } of PROFILES) {
      for (const bottom of [0, 44]) {
        const b = promptBounds(vp.width, vp.height, 400, vp.height * 3, isTouch, { bottom });
        const label = `${name} / inset ${bottom}`;
        expect(b.y + b.height, label).toBeLessThanOrEqual(vp.height - bottom - HUD_PAD + 1e-6);
        expect(b.y, label).toBeGreaterThanOrEqual(HUD_PAD - 1e-6);
        expect(b.height, `${label}: capped at the safe band`).toBeLessThanOrEqual(
          promptMaxHeight(vp.height, isTouch, { bottom }) + 1e-6,
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // a0-100 — the arbitration, driven from the layout registry
  // -------------------------------------------------------------------------
  //
  // ## What failed, in the registry's own numbers
  //
  // QA's a0-99 capture, 798×384, on the front door and under `?debug=1` alike:
  //
  //   onboarding  (232.9, 309)   332.2 × 59
  //   build-wheel (239.7,  32.7) 318.5 × 318.5
  //
  // — an intersection 318.5 wide and 42.3 tall, the WHOLE WIDTH of the wheel,
  // with the prompt's first two lines across the REPAIR REACTOR and RADAR wedges.
  // Both elements were inside their declared anchors (`full` + PAD and `full`),
  // so the registry's containment question answered "yes" twice while the two
  // surfaces shared pixels. Nothing was arbitrating between them.
  //
  // ## The 318.5 is the halo, and that is half the defect
  //
  // `wheelBounds(798, 384)` is 276.5 on a side — `clamp(384 × 0.36, 120, 230) × 2`.
  // The registry says 318.5, because `getBounds()` measures what was FILLED and
  // `build-wheel-view` fills the halo pool out to `WHEEL_HALO_SPAN × r` (see
  // hud-geometry `wheelFootprint`). Every clearance computed against the disc was
  // 21px a side optimistic, and 21px was the whole of the band the prompt had.
  //
  // ## Written against the registry, not against numbers copied out of it
  //
  // The entries below are `LayoutEntry`s — the same ids, anchors and `Rect`s
  // `Hud.describeLayout` hands the registry — and the verdict comes from
  // `./layout-exclusions` `exclusionViolations`, which is the same function the
  // live client's `?debug=1` surface can be pointed at. Nothing here re-states a
  // rule in test-local arithmetic: the table says which pairs may not touch, and
  // this asks it.
  const entriesFor = (
    vp: Viewport,
    isTouch: boolean,
    wheelOpen: boolean,
    text: { w: number; h: number },
  ): LayoutEntry[] => {
    const out: LayoutEntry[] = [];
    if (wheelOpen) {
      // Both wheels share the centred square (field report v0.2), and both are
      // registered `full` + 0 by `Hud.describeLayout`.
      const wheel = wheelFootprint(vp.width, vp.height);
      out.push({ id: 'build-wheel', anchor: FULL, bounds: wheel });
      out.push({ id: 'upgrade-wheel', anchor: FULL, bounds: wheel });
    }
    // An element that is not drawn is not registered — that is what makes
    // withdrawal a legal way to satisfy an exclusion rather than a dodge.
    if (!promptWithdraws(vp.width, vp.height, isTouch, {}, wheelOpen, text.h)) {
      out.push({
        id: 'onboarding',
        anchor: FULL_PAD,
        bounds: promptBounds(vp.width, vp.height, text.w, text.h, isTouch, {}, wheelOpen),
      });
    }
    return out;
  };

  /** The prompt's type as `./hud` styles it: Audiowide at the frame-scaled 16px,
   *  `TRACKING.label` — the same three numbers `makeText(FONT_HEADING,
   *  TYPE.prompt, …, 'label')` puts on the `Text`. */
  const promptSpec = (vp: Viewport): TypeSpec => ({
    face: 'heading',
    size: hudType(PROMPT_TYPE, hudMetrics(vp.width, vp.height)),
    tracking: TRACKING.label,
  });

  /** Greedily wrap `text` at `width` the way Pixi's word wrap does — break on
   *  spaces, never mid-word — and report the box it lays out in. Real per-glyph
   *  advances of the shipped fonts (`./font-metrics`), so this is what the engine
   *  will measure and not a per-character guess. The height is counted in
   *  `promptLineBox`es, the same conservative line box the shipped predicate
   *  spends, so the model and the rule cannot disagree. */
  const wrapped = (text: string, vp: Viewport, width: number): { w: number; h: number } => {
    const spec = promptSpec(vp);
    let lines = 1;
    let widest = 0;
    let line = '';
    for (const word of text.split(' ')) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && textWidth(next, spec) > width) {
        widest = Math.max(widest, textWidth(line, spec));
        lines++;
        line = word;
      } else {
        line = next;
      }
    }
    widest = Math.max(widest, textWidth(line, spec));
    return { w: Math.min(widest, width), h: lines * promptLineBox(vp.width, vp.height) };
  };

  /** Every sentence GDD §2.10 can put in the band: each prompt, in each control
   *  scheme, in each fire mode, with the bindings of each device resolved — the
   *  copy is the writer's and this brief may not shorten it, so the assertion has
   *  to hold for all of it rather than for the string that happened to be up. */
  const AUTHORED: readonly string[] = (() => {
    const out = new Set<string>();
    const devices: DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
    const schemes: ControlScheme[] = ['sticks', 'tap'];
    for (const id of Object.values(PromptId)) {
      for (const device of devices) {
        for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
          for (const scheme of schemes) out.add(resolvePromptText(id, device, mode, scheme));
        }
      }
    }
    return [...out];
  })();

  it('the onboarding band never intersects the build wheel', () => {
    // THE assertion this brief exists for. Every profile, every device class,
    // both wheel states, and every authored sentence at that screen's own wrap
    // width — because "the words stayed legible in that frame" is luck, and the
    // next string closes the gap.
    const violations: string[] = [];
    for (const { name, vp, isTouch } of PROFILES) {
      for (const wheelOpen of [false, true]) {
        const width = promptWrapWidth(vp.width, vp.height, isTouch);
        for (const text of AUTHORED) {
          const entries = entriesFor(vp, isTouch, wheelOpen, wrapped(text, vp, width));
          for (const v of exclusionViolations(entries)) {
            violations.push(
              `${name} / wheel=${wheelOpen ? 'open' : 'closed'} / "${text.slice(0, 32)}…": ` +
                describeViolation(v),
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the two viewports the brief names, in the registry numbers it quotes', () => {
    // The before/after the Definition of Done asks for, as arithmetic rather than
    // as a screenshot. `before` is what `main` computed — the band measured from
    // the DISC, the panel free to keep its bottom edge and grow up through the
    // wedges; `after` is what this branch computes.
    const worst = (vp: Viewport, isTouch: boolean): { w: number; h: number } => {
      const width = promptWrapWidth(vp.width, vp.height, isTouch);
      let box = { w: 0, h: 0 };
      for (const text of AUTHORED) {
        const b = wrapped(text, vp, width);
        if (b.h > box.h || (b.h === box.h && b.w > box.w)) box = b;
      }
      return box;
    };

    // --- QA's phone, 798×384, touch ----------------------------------------
    const phone: Viewport = { width: 798, height: 384 };
    const wheel = wheelFootprint(phone.width, phone.height);
    // The wheel is where it always was — it does not yield, and these are QA's
    // own numbers to the rounding: (239.7, 32.7) 318.5 × 318.5.
    expect(wheel.x).toBeCloseTo(239.7, 1);
    expect(wheel.y).toBeCloseTo(32.7, 1);
    expect(wheel.width).toBeCloseTo(318.5, 1);
    // BEFORE: the band was measured from the disc's bottom (330.2), the panel hung
    // from y 368 and grew up past the footprint's bottom edge at 351.3.
    expect(wheelBounds(phone.width, phone.height).y + wheelBounds(phone.width, phone.height).height)
      .toBeCloseTo(330.2, 1);
    expect(wheel.y + wheel.height).toBeCloseTo(351.3, 1);
    // AFTER: the prompt withdraws while the wheel is open, so it registers nothing
    // and the intersection is not small, it is absent.
    expect(promptWithdraws(phone.width, phone.height, true, {}, true, worst(phone, true).h)).toBe(true);
    expect(entriesFor(phone, true, true, worst(phone, true)).map((e) => e.id))
      .toEqual(['build-wheel', 'upgrade-wheel']);
    expect(exclusionViolations(entriesFor(phone, true, true, worst(phone, true)))).toEqual([]);
    // …and it is back, in full, the moment the wheel closes.
    expect(promptWithdraws(phone.width, phone.height, true, {}, false, worst(phone, true).h)).toBe(false);

    // --- Desktop, 1280×800, no touch ---------------------------------------
    const desk: Viewport = { width: 1280, height: 800 };
    const deskWheel = wheelFootprint(desk.width, desk.height);
    // BEFORE: the band's ceiling was the disc's bottom edge, y 630 + 6 = 636 —
    // 35px INSIDE the footprint, which ends at 665. A prompt tall enough to reach
    // its ceiling was drawn over the halo, and nothing said it could not.
    expect(wheelBounds(desk.width, desk.height).y + wheelBounds(desk.width, desk.height).height)
      .toBeCloseTo(630, 6);
    expect(deskWheel.y + deskWheel.height).toBeCloseTo(665.0, 1);
    // AFTER: the ceiling is the footprint's bottom plus the gap, and the desktop
    // keeps its prompt — it yields 35px of band, not the band.
    const deskBand = promptBand(desk.width, desk.height, false, {}, true);
    expect(deskBand.y).toBeCloseTo(deskWheel.y + deskWheel.height + PROMPT_WHEEL_GAP, 6);
    expect(promptWithdraws(desk.width, desk.height, false, {}, true, worst(desk, false).h)).toBe(false);
    const deskEntries = entriesFor(desk, false, true, worst(desk, false));
    expect(deskEntries.map((e) => e.id)).toEqual(['build-wheel', 'upgrade-wheel', 'onboarding']);
    expect(exclusionViolations(deskEntries)).toEqual([]);
  });

  it('the exclusion table is a table, and it is about the pairs it names', () => {
    // The rule this brief asked to be expressed as data rather than as a branch
    // in one screen's layout code. Two guards on that: every row carries the
    // argument for itself, and no row names an element twice (a pair excluded
    // from itself is a rule that can never be satisfied).
    for (const rule of LAYOUT_EXCLUSIONS) {
      expect(rule.a, `${rule.a} vs ${rule.b}`).not.toEqual(rule.b);
      expect(rule.why.length, `${rule.a} vs ${rule.b} carries no argument`).toBeGreaterThan(20);
    }
    // …and it really is checking, not vacuously passing: hand it the frame QA
    // photographed — the prompt where `main` put it, the wheel where it is — and
    // it must report the overlap QA reported.
    const before: LayoutEntry[] = [
      { id: 'onboarding', anchor: FULL_PAD, bounds: { x: 232.9, y: 309, width: 332.2, height: 59 } },
      { id: 'build-wheel', anchor: FULL, bounds: { x: 239.7, y: 32.7, width: 318.5, height: 318.5 } },
    ];
    const found = exclusionViolations(before);
    expect(found).toHaveLength(1);
    expect(found[0]!.overlap.width).toBeCloseTo(318.5, 1);
    // 42.2 from QA's ROUNDED rects; their own report says 42.3, which is what the
    // same subtraction gives on the unrounded ones (351.27 − 309.0). Asserted on
    // the numbers actually written down, so this stays checkable against the
    // verdict rather than against a recomputation of it.
    expect(found[0]!.overlap.height).toBeCloseTo(42.2, 1);
  });

  it('never collapses below a legible line, however crowded the screen', () => {
    // The floor that stops the band arithmetic from producing a two-word prompt on
    // a small screen: a band is never narrower than the wrap floor plus its own
    // padding, whatever the wheel and the thumb columns have taken.
    for (const { name, vp } of PROFILES) {
      for (const isTouch of [false, true]) {
        const band = promptBand(vp.width, vp.height, isTouch);
        expect(band.width, `${name} / touch=${isTouch}`).toBeGreaterThanOrEqual(
          floorWidth(vp) - 1e-6,
        );
        expect(promptWrapWidth(vp.width, vp.height, isTouch), `${name} / touch=${isTouch}`)
          .toBeGreaterThanOrEqual(PROMPT_MIN_TEXT_WIDTH);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The respawn countdown overlay (field request v0.2.2) — `full`, margin PAD
// ---------------------------------------------------------------------------

describe('respawn-countdown placement', () => {
  const FULL_PAD: AnchorSpec = { region: 'full', margin: HUD_PAD };

  /** A worst-case countdown: text wrapped to the widest line the wrap allows,
   *  over enough lines to cover "RESPAWNING N..." breaking on a narrow phone.
   *  Line box ≈ 30px at the countdown's 24px heading type. */
  const worstCase = (vp: Viewport, lines: number): { w: number; h: number } => ({
    w: respawnWrapWidth(vp.width),
    h: lines * 30,
  });

  for (const { name, vp } of PROFILES) {
    it(`stays on screen and inside the HUD margin at ${name}`, () => {
      const { w, h } = worstCase(vp, 2);
      expectWithin(respawnBounds(vp.width, vp.height, w, h), FULL_PAD, vp, 'respawn-countdown');
    });
  }

  it('lands exactly on the HUD margin at the wrap ceiling — the assertion that earns its keep', () => {
    // Same load-bearing check the prompt gets: if the wrap budget ever stops
    // paying for RESPAWN_PAD_X and the stroke, a countdown at the ceiling
    // registers wider than its own anchor zone on the narrowest phone.
    for (const { name, vp } of PROFILES) {
      const b = respawnBounds(vp.width, vp.height, respawnWrapWidth(vp.width), 30);
      expect(b.x, name).toBeCloseTo(HUD_PAD, 6);
      expect(b.x + b.width, name).toBeCloseTo(vp.width - HUD_PAD, 6);
    }
  });

  it('sits dead centre — the death location the camera stays on (field request)', () => {
    // The ship exploded here; a dead ship draws nothing under it, so centre is
    // clear and the overlay owns it.
    expect(RESPAWN_CENTER_Y).toBeCloseTo(0.5, 6);
    for (const { name, vp } of PROFILES) {
      const b = respawnBounds(vp.width, vp.height, 200, 30);
      const cy = b.y + b.height / 2;
      expect(cy, name).toBeCloseTo(vp.height / 2, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// The under-attack alarm frame (GDD §2.2) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('alarm-frame placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`frames the whole screen and nothing outside it at ${name}`, () => {
      const b = alarmFrameBounds(vp.width, vp.height);
      expectWithin(b, FULL, vp, 'alarm-frame');
      // It is a *screen* frame: flush with all four edges, not a box inside one.
      expect(b.x).toBeCloseTo(0, 6);
      expect(b.y).toBeCloseTo(0, 6);
      expect(b.width).toBeCloseTo(vp.width, 6);
      expect(b.height).toBeCloseTo(vp.height, 6);
    });
  }
});

// ---------------------------------------------------------------------------
// The screen-edge arrow home (GDD §2.2) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('alarm-arrow placement', () => {
  /** Home in 32 directions, far enough out that the arrow is always clamped to
   *  an edge — the case the element exists for. */
  const DIRECTIONS = Array.from({ length: 32 }, (_, i) => (i * Math.PI * 2) / 32);
  const FAR = 4000;

  for (const { name, vp } of PROFILES) {
    it(`never leaves the screen at ${name}, from any direction`, () => {
      const ship = { x: 0, y: 0 };
      for (const angle of DIRECTIONS) {
        const home = { x: Math.cos(angle) * FAR, y: Math.sin(angle) * FAR };
        const arrow = homeArrow(ship, home, vp, ARROW_EDGE_INSET);
        expect(arrow.onScreen, `${name} @${angle.toFixed(2)}rad`).toBe(false);
        const b = polyBounds(arrowPoly(arrow, ARROW_SIZE));
        expectWithin(b, FULL, vp, `alarm-arrow @${angle.toFixed(2)}rad`);
      }
    });
  }

  it('clears the safe-area inset by its own tip length, so a notch never eats it', () => {
    // The arrow is clamped ARROW_EDGE_INSET from each edge and its tip reaches
    // ARROW_SIZE past that anchor — the inset has to cover the tip or the point
    // of the triangle lands under a notch / home indicator (alarm.ts).
    expect(ARROW_EDGE_INSET).toBeGreaterThan(ARROW_SIZE);
  });

  it('is not drawn at all once home is on screen — the station is its own tell', () => {
    const vp: Viewport = { width: 844, height: 390 };
    const arrow = homeArrow({ x: 0, y: 0 }, { x: 20, y: 10 }, vp, ARROW_EDGE_INSET);
    expect(arrow.onScreen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The overlays do not collide with the anchors they are NOT claiming
// ---------------------------------------------------------------------------

describe('anchor honesty', () => {
  it('the wheel genuinely cannot fit a third-width band — which is why it is `full`', () => {
    // Documented in Hud.describeLayout: `center`/`top-center` zones are one
    // third of the viewport wide. A thumb-scale radial menu is wider than that
    // on every phone, so `full` is the honest region — not a convenience.
    // If this ever stops being true, revisit the anchor rather than keep `full`.
    const vp: Viewport = { width: 390, height: 844 };
    const centerZone = resolveAnchor({ region: 'center', margin: 0 }, vp);
    expect(wheelBounds(vp.width, vp.height).width).toBeGreaterThan(centerZone.width);
  });

  it('the alarm frame is by definition the whole viewport', () => {
    const vp: Viewport = { width: 412, height: 915 };
    const full = resolveAnchor(FULL, vp);
    const b = alarmFrameBounds(vp.width, vp.height);
    expect(b.width).toBeCloseTo(full.width, 6);
    expect(b.height).toBeCloseTo(full.height, 6);
  });
});

// ---------------------------------------------------------------------------
// The wedge, at the narrowest profile with the longest values (u7-02, a0-32)
// ---------------------------------------------------------------------------
//
// The Gantry/Bone pass puts FOUR lines on a wedge — the name, what it spends on,
// the cost, and the count over its cap — in a radial space that does not grow
// when they do. On a 390 px phone the wheel is 280 px across and one wedge is a
// 72° slice of it, so a line has ~100 px. l2-02 shipped copy that overflowed its
// chrome for exactly this reason, and only the phone profiles caught it.
//
// ── WHAT a0-32 CHANGED ABOUT THIS SUITE, AND WHY ──────────────────────────
// It used to compare a line's width against a CHORD of the wedge at that line's
// radius, over a conservative text metric — "a glyph is at most .82em of
// Audiowide". Both halves of that were wrong in a way that let a real defect
// through, and the developer found it on a phone instead:
//
//   · **The budget was the wrong axis.** The labels are not rotated with the
//     wheel — a radial menu you can read keeps them upright — so on the wedge at
//     NINE o'clock a line of text runs along the RADIUS. The chord says nothing
//     about the rim, and the rim is what `UPGRADE` was crossing: 81 px of word
//     against a 127 px chord budget, 10 px past the edge of a 140 px disc.
//   · **The metric was a guess.** `.82em` is generous for the average string and
//     not generous at all for `W` (1.002em) or `M` (.962em), and u14-01 moved
//     every advance in the game when it self-hosted the real faces.
//
// So the assertion is now the SHAPE — `sectorOverflow`, over the box each line
// actually occupies (`wheel-stack` `wedgeStackBoxes`), measured with the real
// per-glyph advances of the shipped fonts (`./font-metrics`). A golden proves one
// string at one size; this proves the rule, at every profile, in both selection
// states, on both wheels.

/**
 * The frame that makes every line as long as it can ever be at once: every cap
 * full (so every count is its widest), and a station cooling down from a repair
 * (so REPAIR REACTOR draws its longest string, the live two-digit countdown,
 * rather than a comfortable "+15 HP").
 *
 * The late-match three-digit hoard (`banked: 999`) stays, and is now a *slack*
 * rather than a load: since a0-03 the cost line is the bare cost, so the wallet
 * no longer widens it. Kept because the hub still prints that total and the
 * budget should keep being computed against the richest frame the wheel can be
 * opened in, not the one that happens to be narrowest.
 */
const WORST_CASE: BuildWheelSignals = {
  requested: true,
  docked: true,
  shipAlive: true,
  stationAlive: true,
  cargo: 0,
  banked: 999,
  turrets: 4,
  shields: 2,
  satellites: 1,
  coreHp: 40,
  maxCoreHp: 100,
  repairGate: 15,
};

describe('a wedge at 390 px, with its longest values (u7-02, a0-32)', () => {
  /** The narrowest profile the game claims, held in the play orientation. */
  const PHONE: Viewport = { width: 844, height: 390 };
  const SEGMENTS = WHEEL_ORDER.length;

  /**
   * Walk one wheel's real wedges and assert every drawn line is INSIDE THE WEDGE —
   * the annular sector between the hub and the rim, between this wedge's own two
   * spokes — as the box the line actually occupies, where the view actually puts
   * it, at the real advance widths of the shipped faces.
   *
   * `selected` runs the same walk with the wedge SELECTED (u16-01), where the
   * design grows the name 19/17. A wedge does not get wider when its name does,
   * and the 390 px phone — where the name is already down at 12 px because
   * Audiowide is the first thing a thumb reads — is where that stops being
   * obvious: on that profile the enlarged `UPGRADE` fits at NO radius, which is
   * why `fitWedgeStack` caps the growth rather than the wedge losing the word.
   */
  function assertWedgesFit(vp: Viewport, selected = false): void {
    const outer = wheelRadius(vp.width, vp.height);
    const m = wheelMetrics(outer);
    for (const [i, seg] of buildWheelModel(WORST_CASE).segments.entries()) {
      const angle = segmentAngle(i);
      const sector: AnnularSector = {
        innerRadius: outer * m.hub,
        outerRadius: outer,
        angle,
        halfArc: Math.PI / SEGMENTS,
      };
      const lines = buildWedgeLines(seg, m, selected);
      const fit = fitWedgeStack(lines, outer, m, angle, SEGMENTS);
      const { boxes } = wedgeStackBoxes(scaleName(lines, fit.nameScale), outer, m, angle, fit.radius);
      for (const box of boxes) {
        const o = sectorOverflow(box, sector);
        expect(
          o.fits,
          `${seg.id}/${box.slot}: "${box.text.replace('\n', ' ')}" is ${box.width.toFixed(0)}px wide and ` +
            `escapes its wedge — ${o.outer.toFixed(1)}px past the rim, ${o.inner.toFixed(1)}px into the hub, ` +
            `${((o.arc * 180) / Math.PI).toFixed(1)}° past a spoke`,
        ).toBe(true);
      }
      expect(
        fit.nameScale,
        `${seg.id}: the name had to come down ${((1 - fit.nameScale) * 100).toFixed(0)}% to fit — that is copy, not layout`,
      ).toBeGreaterThanOrEqual(MIN_NAME_FIT_SCALE);
    }
  }

  it('every line of every wedge fits, at the narrowest profile', () => {
    expect(wheelMetrics(wheelRadius(PHONE.width, PHONE.height)).copy).toBe('compact');
    assertWedgesFit(PHONE);
  });

  it('every line of every SELECTED wedge fits too, at the narrowest profile', () => {
    // The one that could have been skipped, and is the reason the size step is
    // made in `./wheel-stack` rather than scaled in the view: measured here, an
    // enlarged name that overflowed its wedge is a red test; scaled in the view it
    // would be a phone-only clip that only a golden could catch, on a screen the
    // goldens shoot with nothing selected.
    assertWedgesFit(PHONE, true);
  });

  for (const { name, vp } of PROFILES) {
    it(`[${name}] every line of every wedge fits`, () => {
      assertWedgesFit(vp);
    });

    it(`[${name}] …and still fits when the wedge is selected`, () => {
      assertWedgesFit(vp, true);
    });
  }

  it('the fix is the placement, and it only ever pulls the words INWARD', () => {
    // What a0-32 is allowed to move, stated as an assertion rather than as a
    // sentence in a header: the stack may hang nearer the hub than the design's
    // rim-anchored radius, and may never hang past it. Anything else on this
    // wheel — the disc, the spokes, the hit-test, the sweep — is ratified.
    for (const { name, vp } of PROFILES) {
      const outer = wheelRadius(vp.width, vp.height);
      const m = wheelMetrics(outer);
      for (const [i, seg] of buildWheelModel(WORST_CASE).segments.entries()) {
        const lines = buildWedgeLines(seg, m);
        const angle = segmentAngle(i);
        const design = wedgeStackBoxes(lines, outer, m, angle).centreRadius;
        const fit = fitWedgeStack(lines, outer, m, angle, SEGMENTS);
        expect(fit.radius, `${name}/${seg.id} hangs its words past the design radius`).toBeLessThanOrEqual(
          design + 1e-6,
        );
        // …and the view is handed that as a DELTA off its own measurement, so a
        // wedge that needs no fitting is not moved by a rounding difference
        // between two rulers. Never negative: this fix does not push words out.
        expect(fit.pullIn, `${name}/${seg.id} is pushed OUT, not pulled in`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the wedge at twelve o\'clock does not move at all — only the sideways ones did', () => {
    // The defect is a property of the wedges whose words run along the RADIUS.
    // TURRET's run along the chord, exactly as the old budget assumed, so if this
    // fix moved TURRET it would be moving something that was never broken.
    for (const { name, vp } of PROFILES) {
      const outer = wheelRadius(vp.width, vp.height);
      const m = wheelMetrics(outer);
      const turret = buildWheelModel(WORST_CASE).segments[0]!;
      expect(segmentAngle(0)).toBeCloseTo(-Math.PI / 2, 10);
      const lines = buildWedgeLines(turret, m);
      // `pullIn`, not the radius: zero here is the assertion that the SHIPPED
      // frame is byte-identical for this wedge, because zero is what the view
      // subtracts from its own measurement.
      expect(
        fitWedgeStack(lines, outer, m, segmentAngle(0), SEGMENTS).pullIn,
        `${name}: the top wedge moved, and it had no reason to`,
      ).toBe(0);
    }
  });

  it('the selected name really is bigger — the budget is not passing on a no-op', () => {
    // A fit test that passes because nothing changed is worth nothing. Both ends
    // of the profile ramp, so neither the stated desktop numbers nor the derived
    // phone ones can quietly stop growing.
    for (const vp of [{ width: 1280, height: 800 }, PHONE]) {
      const m = wheelMetrics(wheelRadius(vp.width, vp.height));
      const seg = buildWheelModel(WORST_CASE).segments[0]!;
      const resting = buildWedgeLines(seg, m).find((l) => l.slot === 'name')!;
      const chosen = buildWedgeLines(seg, m, true).find((l) => l.slot === 'name')!;
      expect(chosen.size).toBeGreaterThan(resting.size);
      expect(chosen.size / resting.size).toBeCloseTo(19 / 17, 10);
      // …and nothing else about the stack moved. The design grows the NAME.
      expect(buildWedgeLines(seg, m, true).map((l) => l.text)).toEqual(
        buildWedgeLines(seg, m).map((l) => l.text),
      );
      expect(buildWedgeLines(seg, m, true).filter((l) => l.slot !== 'name').map((l) => l.size)).toEqual(
        buildWedgeLines(seg, m).filter((l) => l.slot !== 'name').map((l) => l.size),
      );
    }
  });

  it('…and the wedge that cannot hold 19/17 still grows its name, by as much as it can', () => {
    // The one place `fitWedgeStack` caps the design: UPGRADE SHIP on a phone. It
    // must still read as SELECTED — a cap that quietly became "no growth at all"
    // would have deleted half of u16-01's tell rather than fitted it — and it must
    // still be a cap, or this test is asserting a branch nothing takes.
    const outer = wheelRadius(PHONE.width, PHONE.height);
    const m = wheelMetrics(outer);
    const i = WHEEL_ORDER.indexOf('upgrade');
    const seg = buildWheelModel(WORST_CASE).segments[i]!;
    const angle = segmentAngle(i);

    const resting = buildWedgeLines(seg, m);
    const chosen = buildWedgeLines(seg, m, true);
    const restingFit = fitWedgeStack(resting, outer, m, angle, SEGMENTS);
    const chosenFit = fitWedgeStack(chosen, outer, m, angle, SEGMENTS);

    expect(restingFit.nameScale, 'the resting name needs no cap').toBe(1);
    expect(chosenFit.nameScale, 'the selected name is capped by the wedge').toBeLessThan(1);

    const nameSize = (ls: readonly WedgeLine[], scale: number) =>
      ls.find((l) => l.slot === 'name')!.size * scale;
    expect(
      nameSize(chosen, chosenFit.nameScale),
      'a capped selection still draws a BIGGER name than a resting one',
    ).toBeGreaterThan(nameSize(resting, restingFit.nameScale));
  });

  it('the desktop profile takes the handoff\'s own numbers, not a scaled phone', () => {
    // The look is stated twice on purpose. At a desktop radius the wedge must be
    // drawing the handoff's 17/12/20/12 stack and its full copy — if this drifts,
    // the desktop screen has quietly become an upscaled phone.
    const m = wheelMetrics(wheelRadius(1280, 800));
    expect(m.copy).toBe('full');
    expect(m.name).toBeGreaterThanOrEqual(16);
    expect(m.cost).toBeGreaterThanOrEqual(19);
    const turret = buildWheelModel(WORST_CASE).segments.find((s) => s.id === 'turret')!;
    expect(capWords(turret, m)).toBe('4 / 4 BUILT');
  });

  it('the phone profile keeps the count, and spends the padding instead', () => {
    // What "compact" gives up is characters, never information: the count is
    // still there, and so is the target line — GDD §2.5 makes both load-bearing.
    const m = wheelMetrics(wheelRadius(390, 844));
    const turret = buildWheelModel(WORST_CASE).segments.find((s) => s.id === 'turret')!;
    expect(capWords(turret, m)).toBe('4/4 BUILT');
    expect(targetWords(turret)).toBe('YOUR STATION');
  });
});

describe('a wedge is a touch target first (GDD §2.4)', () => {
  for (const { name, vp } of PROFILES) {
    it(`[${name}] every wedge clears the 48 px floor in both directions`, () => {
      const m = wheelMetrics(wheelRadius(vp.width, vp.height));
      const t = wedgeHitTarget(vp.width, vp.height, WHEEL_ORDER.length, m.hub);
      expect(t.min, `wedge is ${t.arc.toFixed(0)}px of arc by ${t.depth.toFixed(0)}px deep`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_MIN,
      );
    });

    it(`[${name}] the hub BACK disc clears it too`, () => {
      const outer = wheelRadius(vp.width, vp.height);
      const m = wheelMetrics(outer);
      expect(2 * outer * m.hub).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// The UPGRADE wedge, at the narrowest profile with its longest values (u7-06)
// ---------------------------------------------------------------------------
//
// The upgrade wheel is the same radial control and takes the same four-slot
// stack (./wheel-stack), so it takes the same budget — but its hard case is a
// different one. The build wheel's is the count line; this wheel's is the STAT
// line, the densest text on any wheel in the game (`111% → 123%`, two formatted
// values and a glyph on one row), and it sits on this screen because a player
// comparing two upgrades reads it carefully.
//
// Two things make it fit where the build wheel's copy had to go compact, and
// both are worth stating because neither is a law:
//
//  1. the upgrade wheel has FOUR wedges to the build wheel's five, so a wedge is
//     a 90° slice rather than 72° and the arc under the words is wider; and
//  2. the ladder is DATA (`upgradeWheelModel` takes it as a parameter, and
//     p2-03's projectile tracks are due), so wedge count is not fixed.
//
// (2) is why the loop below runs a GROWN ladder as well as today's: the file
// promises new tracks appear "for free", and free has to include still fitting.

/** Every wedge on both levels of the upgrade wheel, for one frame. */
function upgradeWedgesOf(signals: UpgradeWheelSignals, ladder: UpgradeLadder, order: readonly UpgradeTrack[]) {
  return [false, true].flatMap((weaponOpen) => {
    const model = upgradeWheelModel({ ...signals, weaponOpen }, ladder, order);
    const count = upgradeWheelSlots(weaponOpen, ladder, order).length;
    return model.wedges.map((wedge) => ({ wedge, count, level: weaponOpen ? 'weapon' : 'main' }));
  });
}

/**
 * The frame that makes every upgrade line as long as it can be at once: the
 * HAULER (the widest class bases, so the biggest printed values), one tier off
 * the top of every ladder (so both a three-digit current AND a three-digit next
 * are printed side by side), and a late-match three-digit hoard, which prices
 * every track payable so no wedge drops out of the measurement. Since a0-41 the
 * hoard no longer widens the cost line — that is the price alone, and the price
 * comes from the ladder's top rung, which this frame is one tier below.
 */
const WORST_UPGRADE: UpgradeWheelSignals = {
  open: true,
  weaponOpen: false,
  shipClass: ShipClass.Hauler,
  tiers: {
    [UpgradeTrack.Power]: 2,
    [UpgradeTrack.Engine]: 2,
    [UpgradeTrack.Cargo]: 2,
    [UpgradeTrack.Hull]: 2,
    [UpgradeTrack.Speed]: 1,
  },
  ore: 999,
};

/**
 * Today's ladder with one more standalone track — a **fifth** main-wheel wedge,
 * the same 72° slice the build wheel already runs at every profile. The module
 * header promises new tracks appear "with no change to this file or the view",
 * and free has to include still fitting.
 *
 * ── THE TWO CEILINGS, MEASURED (for whoever grows this next) ────────────────
 * Growth is not unlimited, and the limits are worth writing down here rather
 * than discovering them in a screenshot:
 *
 *  1. **Seven main-wheel wedges.** At 390 px the WEAPON wedge's `OPEN ▸` is
 *     67 px at the phone profile's 16 px cost size, and a seventh of the wheel
 *     is a 59 px arc where that line sits. Six fit; seven needs a compact form
 *     for that line, or paging.
 *  2. **Four weapon tracks.** The WEAPON wedge draws one pip ROW per weapon
 *     track, so the sub-wheel growing pushes the main wheel's `OPEN ▸` inward
 *     to where the arc is narrowest — at four rows it lands at r≈50 on a phone
 *     and runs past it. p2-03's tracks are projectile tracks and so carry the
 *     WEAPON group, which makes this the ceiling that bites first: the third
 *     weapon track is the one to measure again.
 */
const GROWN_LADDER: UpgradeLadder = {
  ...UPGRADE_LADDER,
  ...(Object.fromEntries([
    ['shielding', { ...UPGRADE_LADDER[UpgradeTrack.Hull], label: 'SHIELDING' }],
  ]) as Record<string, unknown>),
} as unknown as UpgradeLadder;

/** The grown walk order: the weapon group stays contiguous and leading, exactly
 *  as `WHEEL_TRACK_ORDER` keeps it, so the collapse still finds one run. */
const GROWN_ORDER = [...WHEEL_TRACK_ORDER, 'shielding'] as unknown as UpgradeTrack[];

/** Tiers for the grown ladder: one off the top of every track, including the new
 *  one, so the longest current→next pair is printed on each. */
const GROWN_TIERS = { ...WORST_UPGRADE.tiers, shielding: 2 } as unknown as Record<string, number>;

describe('an upgrade wedge at 390 px, with its longest values (u7-06)', () => {
  function assertUpgradeWedgesFit(
    vp: Viewport,
    ladder: UpgradeLadder = UPGRADE_LADDER,
    order: readonly UpgradeTrack[] = WHEEL_TRACK_ORDER,
    tiersOver: Record<string, number> = {},
    selected = false,
  ): void {
    const outer = wheelRadius(vp.width, vp.height);
    const m = wheelMetrics(outer);
    const signals = { ...WORST_UPGRADE, tiers: { ...WORST_UPGRADE.tiers, ...tiersOver } as never };
    for (const { wedge, count, level } of upgradeWedgesOf(signals, ladder, order)) {
      const sector: AnnularSector = {
        innerRadius: outer * m.hub,
        outerRadius: outer,
        angle: wedge.angle,
        halfArc: Math.PI / count,
      };
      const lines = upgradeWedgeLines(wedge, m, selected);
      const fit = fitWedgeStack(lines, outer, m, wedge.angle, count);
      const { boxes } = wedgeStackBoxes(scaleName(lines, fit.nameScale), outer, m, wedge.angle, fit.radius);
      for (const box of boxes) {
        const o = sectorOverflow(box, sector);
        expect(
          o.fits,
          `${level}/${wedge.label}/${box.slot}: "${box.text.replace(/\n/g, ' ')}" is ${box.width.toFixed(0)}px ` +
            `wide and escapes a wedge of ${count} — ${o.outer.toFixed(1)}px past the rim, ` +
            `${o.inner.toFixed(1)}px into the hub, ${((o.arc * 180) / Math.PI).toFixed(1)}° past a spoke`,
        ).toBe(true);
      }
      expect(
        fit.nameScale,
        `${level}/${wedge.label}: the name had to come down ${((1 - fit.nameScale) * 100).toFixed(0)}% to fit`,
      ).toBeGreaterThanOrEqual(MIN_NAME_FIT_SCALE);
    }
  }

  for (const { name, vp } of PROFILES) {
    it(`[${name}] every line of every upgrade wedge fits`, () => {
      assertUpgradeWedgesFit(vp);
    });
  }

  for (const { name, vp } of PROFILES) {
    it(`[${name}] still fits when the ladder GROWS by a track (p2-03)`, () => {
      assertUpgradeWedgesFit(vp, GROWN_LADDER, GROWN_ORDER, GROWN_TIERS);
    });
  }

  // The selected wedge grows its name 19/17 on THIS wheel too since a0-51, so it
  // is held to the same budget as the Build wheel's selected name — including at
  // a grown ladder, where the extra track narrows every wedge and the enlarged
  // name has the least room it will ever have.
  for (const { name, vp } of PROFILES) {
    it(`[${name}] …and still fits when the wedge is SELECTED (a0-51)`, () => {
      assertUpgradeWedgesFit(vp, UPGRADE_LADDER, WHEEL_TRACK_ORDER, {}, true);
    });

    it(`[${name}] …selected, on a GROWN ladder — the narrowest wedge it will get`, () => {
      assertUpgradeWedgesFit(vp, GROWN_LADDER, GROWN_ORDER, GROWN_TIERS, true);
    });
  }

  it('the phone takes the compact stat line, the desktop the padded one', () => {
    // The compact form is what buys the headroom at a grown ladder; both say the
    // same two values, and neither drops one.
    const phone = wheelMetrics(wheelRadius(390, 844));
    const desktop = wheelMetrics(wheelRadius(1280, 800));
    expect(phone.copy).toBe('compact');
    expect(desktop.copy).toBe('full');
    const wedge = upgradeWheelModel({ ...WORST_UPGRADE, tiers: STOCK_TIERS }).wedges.find(
      (w) => w.label === 'ENGINE',
    )!;
    // The HAULER's stock engine (GDD §2.11) and what the first tier buys.
    expect(statWords(wedge, desktop)).toBe('85% → 98%');
    expect(statWords(wedge, phone)).toBe('85%→98%');
  });
});

describe('an upgrade wedge is a touch target first (GDD §2.4)', () => {
  // Both LEVELS: the main wheel's four wedges and the sub-wheel's two. The
  // sub-wheel is the easier case (a 180° slice), but it is a level a thumb lands
  // on during a live fight and so is asserted rather than assumed.
  for (const { name, vp } of PROFILES) {
    for (const weaponOpen of [false, true]) {
      const level = weaponOpen ? 'weapon sub-wheel' : 'main wheel';
      it(`[${name}] every ${level} wedge clears the 48 px floor in both directions`, () => {
        const m = wheelMetrics(wheelRadius(vp.width, vp.height));
        const count = upgradeWheelSlots(weaponOpen).length;
        const t = wedgeHitTarget(vp.width, vp.height, count, m.hub);
        expect(
          t.min,
          `${level}: ${count} wedges, ${t.arc.toFixed(0)}px of arc by ${t.depth.toFixed(0)}px deep`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
      });
    }
  }

  it('stays a target if the ladder grows by a track (p2-03)', () => {
    // Five main-wheel wedges — the build wheel's own count. The day a wedge
    // stops clearing the floor is the day the wheel needs paging, and this is
    // where that is found out.
    for (const { name, vp } of PROFILES) {
      const m = wheelMetrics(wheelRadius(vp.width, vp.height));
      const count = upgradeWheelSlots(false, GROWN_LADDER, GROWN_ORDER).length;
      // Five main-wheel wedges: the four of today plus SHIELDING, with the now
      // four-strong weapon run still collapsed into one WEAPON wedge.
      expect(count).toBe(5);
      expect(upgradeWheelSlots(true, GROWN_LADDER, GROWN_ORDER).length).toBe(2);
      const t = wedgeHitTarget(vp.width, vp.height, count, m.hub);
      expect(t.min, `${name}: ${t.arc.toFixed(0)}px arc × ${t.depth.toFixed(0)}px deep`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_MIN,
      );
    }
  });
});

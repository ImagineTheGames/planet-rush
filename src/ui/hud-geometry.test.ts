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
import type { AnchorSpec, Rect, Viewport } from '@platform/layout-registry';
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
  promptMaxHeight,
  promptPad,
  promptWrapWidth,
  waveClockLayout,
  CLOCK_WHEEL_GAP,
  PROMPT_MIN_TEXT_WIDTH,
  PROMPT_STRIP_RESERVE,
  PROMPT_THUMB_COLUMN,
  respawnBounds,
  respawnWrapWidth,
  RESPAWN_CENTER_Y,
  wheelRadius,
  wedgeChordWidth,
  wedgeHitTarget,
  TOUCH_TARGET_MIN,
} from './hud-geometry';
import { wheelMetrics } from '../art/materials';
import { buildWheelModel, WHEEL_ORDER } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import { buildWedgeLines, capWords, placeWedgeLines, statWords, targetWords, upgradeWedgeLines } from './wheel-stack';
import type { WedgeFace } from './wheel-stack';
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

  it('CLEARS THE BUILD WHEEL at a one-line prompt — the collision u7-07 was written for', () => {
    // The regression this brief names: at 844×390 the wheel spans y 54.6 → 335.4
    // (72% of the screen) and the old `PROMPT_CENTER_Y = 0.72` put the prompt at
    // y 259 → 302, squarely over the REPAIR REACTOR and RADAR wedges — and the
    // SPEND prompt fires WHILE the wheel is open by design (GDD §2.10), so that
    // was its normal state, not an edge case.
    //
    // Asserted per profile against the device class that profile ACTUALLY IS: the
    // phones are touch (no controls strip, thumb columns instead) and the desktop
    // is not. The cross-product is deliberately not asserted here — a 844×390
    // window driven by a keyboard has to pay for BOTH a 280px-tall wheel and the
    // strip's reserve, and 390px of height cannot cover both. The prompt degrades
    // there exactly as documented: it keeps its bottom edge, grows up into the
    // wheel, and the wedge reads through it (SCRIM.prompt). The `full` + PAD
    // assertion above still covers that case, which is the promise that matters.
    //
    // A one-line prompt is the case that has to be clean, because it is the case
    // that happens: every authored prompt fits one line of the band on every
    // profile in the matrix.
    const degraded: string[] = [];
    for (const { name, vp, isTouch } of PROFILES) {
      const wheel = wheelBounds(vp.width, vp.height);
      const b = promptBounds(vp.width, vp.height, 200, lineBox(vp), isTouch);
      if (b.y < wheel.y + wheel.height) {
        degraded.push(
          `${name} (prompt top ${b.y.toFixed(1)}, wheel bottom ${(wheel.y + wheel.height).toFixed(1)})`,
        );
      }
    }

    // …and the screens where it CANNOT clear, named. The band is the room left
    // between the wheel's bottom edge and the HUD margin; on a 320px-tall screen
    // the wheel's own 120px minimum radius (hud-geometry `WHEEL_MIN_RADIUS`) takes
    // 240 of those 320 px, leaving 18px for a 33px prompt. So the prompt keeps its
    // bottom edge and grows 9px up into the bottom wedges, and reads through them
    // (SCRIM.prompt). Pinning the SET here means a change that makes a second
    // screen degrade fails this test instead of quietly shipping.
    expect(degraded, 'exactly one profile in the matrix cannot hold a prompt under the wheel')
      .toEqual(['small/landscape (prompt top 271.0, wheel bottom 280.0)']);
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
   */
  const AUTHORED_PROMPTS: readonly { label: string; text: string }[] = (() => {
    const out: { label: string; text: string }[] = [];
    const devices: DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
    for (const id of Object.values(PromptId)) {
      for (const device of devices) {
        for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
          out.push({ label: `${id}/${device}/${mode}`, text: resolvePromptText(id, device, mode) });
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
      expect(flat.y - cropped.y, `${name}`).toBeCloseTo(40, 6);
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
// The wedge, at the narrowest profile with the longest values (u7-02)
// ---------------------------------------------------------------------------
//
// The Gantry/Bone pass puts FOUR lines on a wedge — the name, what it spends on,
// the cost, and the count over its cap — in a radial space that does not grow
// when they do. On a 390 px phone the wheel is 280 px across and one wedge is a
// 72° slice of it, so a line has ~100 px. l2-02 shipped copy that overflowed its
// chrome for exactly this reason, and only the phone profiles caught it.
//
// The oracle below is a *conservative* text metric, not a font: real advance
// widths for Audiowide and Oxanium at these sizes are narrower than these
// constants, so a string that passes here fits on the device with room to spare,
// and the goldens (tests/mobile/goldens.spec.ts) are what confirm the pixels.

/** Upper bound on a glyph's advance, as a fraction of the font size. Measured
 *  generously: Oxanium's widest digits and caps sit near .60em, Audiowide's near
 *  .82em. Tracking is added on top, per glyph, exactly as PixiJS applies it. */
const ADVANCE: Record<WedgeFace, number> = { numeral: 0.6, display: 0.82 };

function textWidth(s: string, size: number, tracking: number, face: WedgeFace): number {
  // The widest LINE of a wrapped string is what has to fit, not the whole string.
  const lines = s.split('\n');
  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, line.length * (size * ADVANCE[face] + size * tracking));
  }
  return widest;
}

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

describe('a wedge at 390 px, with its longest values (u7-02)', () => {
  /** The narrowest profile the game claims, held in the play orientation. */
  const PHONE: Viewport = { width: 844, height: 390 };
  const SEGMENTS = WHEEL_ORDER.length;

  /** Walk one wheel's real wedges and assert every drawn line fits the arc AT
   *  ITS OWN RADIUS — the bottom line sits where the wedge is narrowest, which is
   *  the whole reason this exists. */
  function assertWedgesFit(vp: Viewport): void {
    const outer = wheelRadius(vp.width, vp.height);
    const m = wheelMetrics(outer);
    for (const seg of buildWheelModel(WORST_CASE).segments) {
      const { placed, innerRadius } = placeWedgeLines(buildWedgeLines(seg, m), outer, m);
      for (const line of placed) {
        const budget = wedgeChordWidth(line.radius, SEGMENTS);
        const w = textWidth(line.text, line.size, line.tracking, line.face);
        expect(
          w,
          `${seg.id}/${line.slot}: "${line.text.replace('\n', ' ')}" is ${w.toFixed(0)}px at r=${line.radius.toFixed(0)}, where the wedge is only ${budget.toFixed(0)}px wide`,
        ).toBeLessThanOrEqual(budget);
      }
      // ...and the stack stays in the ring rather than running under the hub.
      expect(innerRadius, `${seg.id}: the stack runs past the hub`).toBeGreaterThanOrEqual(outer * m.hub);
    }
  }

  it('every line of every wedge fits, at the narrowest profile', () => {
    expect(wheelMetrics(wheelRadius(PHONE.width, PHONE.height)).copy).toBe('compact');
    assertWedgesFit(PHONE);
  });

  for (const { name, vp } of PROFILES) {
    it(`[${name}] every line of every wedge fits`, () => {
      assertWedgesFit(vp);
    });
  }

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
 * are printed side by side), and a late-match three-digit hoard so `cost/held`
 * is at its widest.
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
  ): void {
    const outer = wheelRadius(vp.width, vp.height);
    const m = wheelMetrics(outer);
    const signals = { ...WORST_UPGRADE, tiers: { ...WORST_UPGRADE.tiers, ...tiersOver } as never };
    for (const { wedge, count, level } of upgradeWedgesOf(signals, ladder, order)) {
      const { placed, innerRadius } = placeWedgeLines(upgradeWedgeLines(wedge, m), outer, m);
      for (const line of placed) {
        const budget = wedgeChordWidth(line.radius, count);
        const w = textWidth(line.text, line.size, line.tracking, line.face);
        expect(
          w,
          `${level}/${wedge.label}/${line.slot}: "${line.text.replace(/\n/g, ' ')}" is ${w.toFixed(0)}px ` +
            `at r=${line.radius.toFixed(0)}, where a wedge of ${count} is only ${budget.toFixed(0)}px wide`,
        ).toBeLessThanOrEqual(budget);
      }
      expect(
        innerRadius,
        `${level}/${wedge.label}: the stack runs past the hub`,
      ).toBeGreaterThanOrEqual(outer * m.hub);
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

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
import type { Point } from './alarm';
// a0-104's invariant is a claim about two modules at once — the geometry that
// decides whether the screen-edge arrow is drawn, and the trigger machine that
// decides whether the sentence naming it is shown. It is asserted here, where
// the geometry lives, because the failing half was geometric: the prompt was up
// in a screen state where its instruction could not be followed.
import { Onboarding } from './onboarding';
import type { OnboardingSignals } from './onboarding';
import { HUD_TRACKING, hudMetrics, hudSpace, hudType, scrimPlateau } from './instrument';
import { collapsedRect } from './minimap';
import { healthBarFill, healthBarModel, healthBarTrack } from './healthbar';
import type { Combatant } from './healthbar';
import { stationHpModel } from './station-hp';
import { zoomControlBounds } from './zoom-control';
import { affordanceRects, buildButtonRect } from '@platform/touch-visuals';
import { writeBadgeRect } from '../render/build-badge';
import { writePingRect } from '../net/ping-badge';
import { writeAffordanceRect } from '../render/fullscreen-affordance';
import type { MinimapInsets } from './minimap';
import {
  wheelBounds,
  panelBounds,
  panelSize,
  stationHpBounds,
  stationCoreBarTrack,
  stationCoreBarFill,
  stationShieldBarTrack,
  stationShieldBarFill,
  alarmFrameBounds,
  arrowPoly,
  polyBounds,
  ARROW_SIZE,
  arrowClearOfReadouts,
  stationChromeHeight,
  stationChromeWidth,
  PANEL_MAX_WIDTH,
  PANEL_EDGE_PAD,
  HUD_PAD,
  SCRIM_BLEED,
  HUD_EYEBROW_TYPE,
  ORE_BANK_TYPE,
  ORE_LABEL_LEADING,
  ORE_RULE_GAP,
  oreCounterLayout,
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
import type { AnnularSector, OreCounterLayout } from './hud-geometry';
import { contentBox } from './viewport';
import { pauseButtonRect } from './pause-menu';
import { exclusionViolations, LAYOUT_EXCLUSIONS } from './layout-exclusions';
// a0-115's keep-out: the rule that a world-anchored label is never drawn inside a
// fixed readout's rect, stated in the registry's own vocabulary next door.
import {
  HUD_READOUT_IDS,
  READOUT_KEEPOUT_PAD,
  labelRepeatsOwner,
  labelYieldsToReadouts,
  readoutRects,
  rectOverlap,
} from './layout-exclusions';
import type { PlacedLabel } from './layout-exclusions';
import {
  NAMEPLATE_FONT_SIZE,
  NAMEPLATE_KIND_ORDER,
  nameplateClusterClearance,
  nameplateRowLayout,
} from './nameplates-view';
import type { Nameplate } from './nameplates';

import { textHeight, textWidth } from './font-metrics';
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

/** How much clear air separates two rects — the largest per-axis gap between
 *  them, or 0 when they overlap. The measured form of `rectsIntersect` for the
 *  cases (a0-116) whose rule is a distance rather than a yes/no, and where the
 *  answer lands exactly on the boundary by construction. */
function clearAir(a: Rect, b: Rect): number {
  const x = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const y = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(0, Math.max(x, y));
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
// The banked-ore counter's GROUND (a0-102) — top-left, margin HUD_PAD
// ---------------------------------------------------------------------------
//
// a0-99 failed the top-left of both profiles: the counter drawn "straight onto
// whatever the world put there", with an ore-bearing asteroid under it and a gold
// vein ring a few tens of pixels from the counter's own signal-yellow numeral.
//
// Signal yellow IS ore (style-guide §2, RESERVED), so the counter and the rock it
// counts will always share a hue and the separation can only come from the
// ground. The reason the counter had none is not that the HUD has no treatment —
// it has one, and this counter was drawing it — but that the scrim was sized to
// the type's own box, and a scrim decays to nothing at its edges. See the header
// over `oreCounterLayout` for the measured coverage the shipped rect gave.
//
// So the assertion is not "a scrim is drawn". It is: **the part of the scrim that
// is actually dark covers every glyph and the rule**.

describe('the banked-ore counter', () => {
  /** `ORE` as ./hud styles it: Audiowide at the frame-scaled eyebrow size with
   *  the eyebrow tracking — the three numbers `makeText(FONT_HEADING,
   *  TYPE.eyebrow, …, 'eyebrow')` puts on the `Text`. */
  const labelSpec = (vp: Viewport): TypeSpec => ({
    face: 'heading',
    size: hudType(HUD_EYEBROW_TYPE, hudMetrics(vp.width, vp.height)),
    tracking: TRACKING.eyebrow,
  });

  /** …and the banked total: the body face at `bold`, the bank size, `name`
   *  tracking — `makeText(FONT_NUMERAL, TYPE.bank, …, 'name')`. */
  const bankSpec = (vp: Viewport): TypeSpec => ({
    face: 'bodyBold',
    size: hudType(ORE_BANK_TYPE, hudMetrics(vp.width, vp.height)),
    tracking: TRACKING.name,
  });

  const measure = (text: string, spec: TypeSpec) => ({
    width: textWidth(text, spec),
    height: textHeight(text, spec),
  });

  /** Every width the numeral takes across a match: the opening zero, a single
   *  figure, and on up to a bank nobody will reach. The counter's ground is sized
   *  from the number, so the number is what has to be swept. */
  const BANKED = ['0', '3', '48', '250', '1204', '99999'];

  const layoutFor = (vp: Viewport, banked: string): OreCounterLayout =>
    oreCounterLayout(
      measure('ORE', labelSpec(vp)),
      measure(banked, bankSpec(vp)),
      hudMetrics(vp.width, vp.height),
    );

  it('the ore counter is legible over any world behind it', () => {
    for (const { name, vp } of PROFILES) {
      for (const banked of BANKED) {
        const l = layoutFor(vp, banked);
        const where = `${name} / banked=${banked}`;

        // 1. There is a ground at all, and it is the counter's OWN — drawn inside
        //    the element, never bled out to the screen edge (`ore-hud` registers
        //    what it draws, so a ground past the margin fails QA's layout
        //    contract on a real device).
        expect(l.ground.width, `${where}: no ground`).toBeGreaterThan(0);
        expect(l.ground.height, `${where}: no ground`).toBeGreaterThan(0);
        expect(l.ground.x, `${where}: ground left of the group origin`).toBe(0);
        expect(l.ground.y, `${where}: ground above the group origin`).toBe(0);

        // 2. The part of it that is actually dark — the plateau where the scrim
        //    reaches the `SCRIM.corner` its own doc calls the least that survives
        //    a lit asteroid — covers the glyphs and the rule. Not the scrim rect:
        //    the rect is mostly falloff, and falloff is what a0-99 photographed.
        const plateau = scrimPlateau(l.ground, 'center');
        const inked: readonly [string, Rect][] = [
          ['the ORE eyebrow', l.label],
          ['the banked numeral', l.numeral],
          ['the closing rule', l.rule],
        ];
        for (const [what, r] of inked) {
          expect(
            rectContains(plateau, r, 1e-6),
            `${where}: ${what} ${fmt(r)} is outside the ground's full-strength ` +
              `plateau ${fmt(plateau)} — it would be drawn on the scrim's falloff, ` +
              `which is where the ore counter of a0-99 was drawn`,
          ).toBe(true);
        }

        // 3. …and every one of them is inside the drawn scrim too, which is what
        //    makes the cluster's registered footprint the ground rather than a
        //    glyph poking out of it.
        for (const [what, r] of inked) {
          expect(rectContains(l.ground, r, 1e-6), `${where}: ${what} escapes the scrim`).toBe(true);
        }
      }
    }
  });

  it('is the fix a0-102 filed — the shipped rect FAILED the assertion above', () => {
    // The reproduction, kept so "failing today" stays checkable after today.
    //
    // `Hud.drawOreChrome` sized the scrim as
    //   `width  = max(labelWidth, numeralWidth) + hudSpace(18)`
    //   `height = ruleY + hudSpace(SCRIM_BLEED)`
    // from the group origin — which is the type's own top-left. All the slack was
    // to the right of the type and none above, below or left of it.
    const vp = { width: 1280, height: 800 };
    const m = hudMetrics(vp.width, vp.height);
    const label = measure('ORE', labelSpec(vp));
    const numeral = measure('3', bankSpec(vp));
    const ruleY = hudSpace(ORE_LABEL_LEADING, m) + numeral.height + hudSpace(ORE_RULE_GAP, m);
    const shipped: Rect = {
      x: 0,
      y: 0,
      width: Math.max(label.width, numeral.width) + hudSpace(18, m),
      height: ruleY + hudSpace(SCRIM_BLEED, m),
    };
    const shippedPlateau = scrimPlateau(shipped, 'center');

    // The type started at the scrim's own corner, so the eyebrow was in the fade…
    expect(rectContains(shippedPlateau, { x: 0, y: 0, ...label }, 1e-6)).toBe(false);
    // …and so was the leading column of the numeral…
    expect(
      rectContains(
        shippedPlateau,
        { x: 0, y: hudSpace(ORE_LABEL_LEADING, m), ...numeral },
        1e-6,
      ),
    ).toBe(false);
    // …and so was the rule that closes the cluster.
    expect(
      rectContains(shippedPlateau, { x: 0, y: ruleY, width: shipped.width, height: 1 }, 1e-6),
    ).toBe(false);

    // The same three, against the ground this branch gives them.
    const fixed = layoutFor(vp, '3');
    const plateau = scrimPlateau(fixed.ground, 'center');
    expect(rectContains(plateau, fixed.label, 1e-6)).toBe(true);
    expect(rectContains(plateau, fixed.numeral, 1e-6)).toBe(true);
    expect(rectContains(plateau, fixed.rule, 1e-6)).toBe(true);
  });

  it('leaves the corner PAUSE BUTTON alone — the other tenant of this corner', () => {
    // The counter grew, and it grew into a corner that is not empty on touch:
    // `PAUSE_BUTTON_LEFT` is 72 *precisely* to be "past the top-left ORE block",
    // and an earlier cut of a0-102 (which kept a 9px rule overhang and then paid
    // the ground's third on top of it) put `ORE` two pixels off that button on a
    // landscape phone. The evidence shot caught it; this catches the next one.
    //
    // The assertion is on the counter's INK, not on its ground. The ground's outer
    // fade may pass under the button — it is drawn beneath it and reaches ~zero
    // coverage out there, so it covers nothing. A GLYPH under the button is the
    // failure.
    //
    // ## The bound, stated
    //
    // A cluster sized from its number has no width until you say how big the
    // number gets, so: **999**. Wheel prices run 1–14 (`src/sim/constants.ts`) and
    // a hold is at most `CARGO_CAP_MAX` = 8 an trip, so a four-figure bank is not
    // a state this economy reaches. `PAUSE_BUTTON_LEFT`'s own doc already assumed
    // it ("a two-to-three digit banked number"); this is that assumption made
    // checkable. If the economy ever does produce one, THIS test is what fails,
    // and the fix is to re-derive that constant — not to widen this bound.
    const WIDEST_BANK = '999';
    for (const { name, vp, isTouch } of PROFILES) {
      if (!isTouch) continue; // the button is the touch-only way in (pauseButtonVisible)
      const button = pauseButtonRect(vp);
      const box = contentBox({ width: vp.width, height: vp.height });
      for (const banked of [...BANKED.filter((b) => b.length <= 3), WIDEST_BANK]) {
        const l = layoutFor(vp, banked);
        const inkRight =
          box.x + HUD_PAD + Math.max(l.label.x + l.label.width, l.numeral.x + l.numeral.width);
        expect(
          inkRight,
          `${name} / banked=${banked}: the counter's type reaches x=${inkRight.toFixed(1)}, ` +
            `and the pause button starts at x=${button.x}`,
        ).toBeLessThanOrEqual(button.x);
      }
    }
  });

  it('keeps the whole cluster inside its top-left anchor, on every profile', () => {
    // The ground grew the element, so the thing to prove is that it grew INWARD:
    // `ore-hud` still sits inside `top-left` with margin HUD_PAD, and so does the
    // `banked-total` the same corner registers separately.
    const ANCHOR: AnchorSpec = { region: 'top-left', margin: HUD_PAD };
    for (const { name, vp } of PROFILES) {
      const box = contentBox({ width: vp.width, height: vp.height });
      for (const banked of BANKED) {
        const l = layoutFor(vp, banked);
        const at = (r: Rect): Rect => ({
          x: box.x + HUD_PAD + r.x,
          y: HUD_PAD + r.y,
          width: r.width,
          height: r.height,
        });
        expectWithin(at(l.ground), ANCHOR, vp, `${name} / banked=${banked}: ore-hud`);
        expectWithin(at(l.numeral), ANCHOR, vp, `${name} / banked=${banked}: banked-total`);
      }
    }
  });
});

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
// WHICH WAY A HULL BAR EMPTIES (a0-101)
// ---------------------------------------------------------------------------
//
// a0-99, desktop 1280x800, two crops of the same match: the station bar at
// `88/100` drew its missing twelve per cent as an empty dark block at the LEFT
// end with the fill anchored right, and the ship bar at `23/50` drew its missing
// part at the RIGHT with the fill anchored left. Two hull readouts, one screen,
// opposite directions. QA declined to rule on which was correct and was right
// not to: the station block sits under a right-aligned `HOME` label, so a right
// anchor there is arguable.
//
// The Director, 2026-08-19:
//
//   > Every hull bar empties rightward: fill anchored left, empty space on the
//   > right. The ship bar is already correct; the station bar moves.
//
// — because the ship bar is the one a player reads most often and under the most
// pressure, and left-anchored is the ordinary convention a player arrives with;
// and because a label's text alignment is a typographic choice, not a reason for
// the quantity beneath it to run the other way. Nothing else on the HUD takes
// its direction from the label above it.
//
// The ruling is about EVERY bar of this kind, not the two photographed, so this
// block is an ENUMERATION as much as an assertion. Every bar below is reached
// through the code the views actually draw with — the real model
// (`healthBarModel`, `stationHpModel`) turns hp into a fraction, and the geometry
// module turns that fraction into the rect that gets painted — so a view that
// went back to hand-rolling a rect would have to delete a function to escape it.
//
// The bars, and what each of them is:
//
//   own station CORE (HOME)      the loss condition, top-right      (./hud)
//   own station SHIELD overbar   the pooled shield in front of it   (./hud)
//   repair-shimmer wash          the patina over the core fill      (./hud)
//   own ship hull                the larger "mine" bar              (./healthbar-view)
//   enemy ship hull              the narrow bar                     (./healthbar-view)
//   own turret HP                narrow, in your colour             (./healthbar-view)
//   enemy turret HP              narrow, in theirs                  (./healthbar-view)
//   hostile wave unit HP         narrow, un-owned steel             (./healthbar-view)
//
// Deliberately NOT here, and why: a rival station's health is a damage RING on
// the station itself (GDD §2.2 as amended 2026-08-07, drawn in `src/render`), not
// a bar — a ring has no left end to empty from. The class-tile and settings
// readouts are discrete PIPS rather than a pool that drains, and they already
// fill left-to-right. The end-of-match XP bar is not health, and is already
// left-anchored.

describe('hull bars (a0-101)', () => {
  /** The camera-followed player, whose station and ship these bars belong to. */
  const LOCAL = 0;

  /** One enumerated bar: the steel track it is drawn in, and the coloured fill
   *  its own module produces for a given fraction of the pool. */
  interface HullBarCase {
    readonly id: string;
    readonly track: Rect;
    readonly fill: (fraction: number) => Rect;
  }

  /** An entity's screen placement — the bars are drawn in screen space, already
   *  projected, so any point clear of the viewport edges will do. */
  const AT_SCREEN = { pos: { x: 640, y: 400 }, radius: 14 } as const;

  /** A combat entity at `fraction` of its hull, in combat so that even a full
   *  one shows a bar (the visibility rule is ./healthbar.test.ts's subject). */
  function combatantAt(
    base: Omit<Combatant, 'hp' | 'maxHp' | 'inCombat'>,
    fraction: number,
  ): Combatant {
    return { ...base, maxHp: 70, hp: 70 * fraction, inCombat: true };
  }

  /** An over-entity bar, reached the way the view reaches it: the real model
   *  decides the bar exists and what its fill fraction is, then ./healthbar
   *  places the track and the fill inside it. */
  function entityBar(
    id: string,
    base: Omit<Combatant, 'hp' | 'maxHp' | 'inCombat'>,
  ): HullBarCase {
    const modelled = (fraction: number) => {
      const bars = healthBarModel([combatantAt(base, fraction)], LOCAL);
      expect(bars, `${id} should draw a bar at ${fraction}`).toHaveLength(1);
      return bars[0]!;
    };
    return { id, track: healthBarTrack(modelled(1)), fill: (f) => healthBarFill(modelled(f)) };
  }

  /** The station's pools, through the same model ./hud builds them from. */
  const coreAt = (fraction: number) => stationHpModel(LOCAL, 100 * fraction, 100, 0, 0);
  const shieldAt = (fraction: number) => stationHpModel(LOCAL, 100, 100, 60 * fraction, 60);

  const HULL_BARS: readonly HullBarCase[] = [
    {
      id: 'own station CORE (HOME)',
      track: stationCoreBarTrack(),
      fill: (f) => stationCoreBarFill(coreAt(f).coreFraction),
    },
    {
      id: 'own station SHIELD overbar',
      track: stationShieldBarTrack(),
      fill: (f) => stationShieldBarFill(shieldAt(f).shieldFraction),
    },
    {
      // The repair shimmer is a patina wash drawn OVER the core fill (field
      // report v0.2.2), so it is that same rect and inherits its direction — it
      // is listed on its own so a shimmer that drifted off the fill fails here
      // rather than only under a live repair.
      id: 'repair-shimmer wash over the core',
      track: stationCoreBarTrack(),
      fill: (f) => stationCoreBarFill(coreAt(f).coreFraction),
    },
    entityBar('own ship hull', { ...AT_SCREEN, owner: LOCAL, alive: true, local: true }),
    entityBar('enemy ship hull', { ...AT_SCREEN, owner: 1, alive: true }),
    entityBar('own turret HP', { ...AT_SCREEN, owner: LOCAL, alive: true, turret: true }),
    entityBar('enemy turret HP', { ...AT_SCREEN, owner: 1, alive: true, turret: true }),
    entityBar('hostile wave unit HP', { ...AT_SCREEN, owner: -1, alive: true }),
  ];

  it('every hull bar empties in the same direction', () => {
    // The enumeration is itself the deliverable, so pin it: a new hull bar has to
    // be added here — and take the ruling — rather than quietly pick a side.
    expect(HULL_BARS.map((b) => b.id)).toEqual([
      'own station CORE (HOME)',
      'own station SHIELD overbar',
      'repair-shimmer wash over the core',
      'own ship hull',
      'enemy ship hull',
      'own turret HP',
      'enemy turret HP',
      'hostile wave unit HP',
    ]);

    for (const bar of HULL_BARS) {
      const { id, track } = bar;
      expect(track.width, `${id}: a bar has a track to empty into`).toBeGreaterThan(0);

      // 0.46 is the ship crop (23/50) and 0.88 the station crop (88/100).
      for (const fraction of [0.12, 0.46, 0.5, 0.88]) {
        const fill = bar.fill(fraction);
        const where = `${id} @ ${fraction}`;

        // The fill starts at the track's LEFT edge — the ruling, in one line.
        expect(fill.x, `${where}: the fill starts at the track's LEFT edge`).toBeCloseTo(track.x, 6);
        // …so there is NO empty block at the left, and the missing part of the
        // pool reads as absence on the RIGHT. This pair is the a0-99 photograph.
        expect(fill.x - track.x, `${where}: no empty block at the LEFT end`).toBeCloseTo(0, 6);
        expect(
          track.x + track.width - (fill.x + fill.width),
          `${where}: the missing part shows at the RIGHT end`,
        ).toBeGreaterThan(0);

        // A fill is its track's own band — it never changes row or thickness.
        expect(fill.y, `${where}: same row as its track`).toBeCloseTo(track.y, 6);
        expect(fill.height, `${where}: same thickness as its track`).toBeCloseTo(track.height, 6);
        expect(fill.width, `${where}: a partial pool is a partial fill`).toBeLessThan(track.width);
      }

      // Taking damage retreats the RIGHT edge and leaves the left one alone —
      // the direction stated as motion rather than as a single frame.
      const full = bar.fill(1);
      const hurt = bar.fill(0.5);
      expect(full.width, `${id}: a full pool fills its whole track`).toBeCloseTo(track.width, 6);
      expect(hurt.x, `${id}: damage does not move the fill's left edge`).toBeCloseTo(full.x, 6);
      expect(hurt.x + hurt.width, `${id}: damage retreats the fill's right edge`).toBeLessThan(
        full.x + full.width,
      );
    }
  });

  it('shows the two bars a0-99 photographed side by side, agreeing', () => {
    // The crops themselves: the station at 88/100 and the own ship at 23/50, on
    // the 1280x800 desktop they were shot on. Both must put their missing part in
    // the same place — the right end — which is the whole of the complaint.
    const stationTrack = stationCoreBarTrack();
    const station = stationCoreBarFill(stationHpModel(LOCAL, 88, 100).coreFraction);
    const ship = healthBarModel(
      [{ ...AT_SCREEN, owner: LOCAL, alive: true, local: true, hp: 23, maxHp: 50, inCombat: false }],
      LOCAL,
    )[0]!;
    const shipTrack = healthBarTrack(ship);
    const shipFill = healthBarFill(ship);

    const gapAtLeft = (fill: Rect, track: Rect) => fill.x - track.x;
    const gapAtRight = (fill: Rect, track: Rect) => track.x + track.width - (fill.x + fill.width);

    expect(gapAtLeft(station, stationTrack), 'station 88/100: nothing empty at the left').toBeCloseTo(0, 6);
    expect(gapAtLeft(shipFill, shipTrack), 'ship 23/50: nothing empty at the left').toBeCloseTo(0, 6);
    expect(gapAtRight(station, stationTrack), 'station 88/100: the twelve per cent is at the right').toBeGreaterThan(0);
    expect(gapAtRight(shipFill, shipTrack), 'ship 23/50: the missing hull is at the right').toBeGreaterThan(0);
  });

  it('leaves the station bars where the corner put them', () => {
    // The ruling moves the FILL, not the element: the track still hangs off the
    // group's right-hand origin (that anchor belongs to the corner, not to the
    // bar), and the footprint the layout registry records is untouched.
    const core = stationCoreBarTrack();
    const shield = stationShieldBarTrack();
    expect(core.x + core.width).toBe(0);
    expect(core.width).toBe(HP_BAR_WIDTH);
    expect(core.height).toBe(HP_BAR_HEIGHT);
    expect(shield.x).toBe(core.x);
    expect(shield.width).toBe(core.width);
    expect(core.y - (shield.y + shield.height)).toBe(SHIELD_BAR_GAP);
    expect(stationHpBounds(1280).height).toBe(HP_BAR_TOP + HP_BAR_HEIGHT);
  });
});

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
                `${v.a} ${fmt(v.boundsA)} ∩ ${v.b} ${fmt(v.boundsB)} = ${fmt(v.overlap)} — ${v.why}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('which screens the WORST AUTHORED prompt actually costs, named rather than discovered', () => {
    // The screen-level pin above asks "could any prompt fit"; this asks the
    // question the player experiences — does the LONGEST sentence GDD §2.10 has
    // fit, on this screen, with the wheel open? The two answers differ, and the
    // difference is the honest cost of this fix, so it is written down rather
    // than left for a capture to find.
    //
    // What it costs: on 390×844 the objective prompt wraps to FOURTEEN lines,
    // because a 390px-wide portrait phone has 46px between its two thumb columns
    // and the band falls back to the legibility floor (80px of text). That is
    // 241px of panel against a 238px band — a three-pixel miss — so the prompt
    // waits for the wheel to close there too.
    //
    // What it buys, and it is much bigger than QA's capture: the small portrait
    // phones were the WORST offenders and nobody had photographed them. On
    // 320×568 that same panel ran 111px into the wheel's footprint and 93px into
    // the DISC — a third of the wheel's face under a wall of text — and on
    // 375×667 it ran 79px in. Those two were never a wedge or two clipped; they
    // were the wheel unusable.
    const worst = (vp: Viewport, isTouch: boolean): number => {
      const width = promptWrapWidth(vp.width, vp.height, isTouch);
      let tallest = 0;
      for (const text of AUTHORED) tallest = Math.max(tallest, wrapped(text, vp, width).h);
      return tallest;
    };
    const withdrawn = PROFILES.filter(({ vp, isTouch }) =>
      promptWithdraws(vp.width, vp.height, isTouch, {}, true, worst(vp, isTouch)),
    ).map(({ name }) => name);

    expect(withdrawn, 'the screens where the longest authored prompt waits for the wheel').toEqual([
      'iphone/portrait',
      'iphone/landscape',
      'qa-phone/landscape',
      'pixel/landscape',
      'iphone-se/portrait',
      'small/portrait',
      'small/landscape',
    ]);
    // …and the two that keep it, so a change that takes the prompt off a DESKTOP
    // is a failure here and not a shrug.
    expect(PROFILES.map(({ name }) => name).filter((n) => !withdrawn.includes(n)))
      .toEqual(['pixel/portrait', 'desktop']);
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

  it('every OTHER registered surface on QA\'s profile, held to the same intersection', () => {
    // The brief's second ask: having found two surfaces sharing pixels with
    // nothing arbitrating, check the rest of them rather than the one that was
    // photographed. Every element the client registers on a 798×384 in-match
    // frame whose rect this repo can compute without a browser, against the same
    // `wheelFootprint` the prompt is now held to.
    //
    // The answer is a SET, pinned, because "nothing else overlaps" is only worth
    // asserting if a new overlap fails here. Two do, and both are correct:
    //
    //  - `alarm-frame` IS the screen (`full` + 0, a stroked border flush with the
    //    viewport edges), so it contains every other element by construction. An
    //    exclusion rule naming it would be a rule against the alarm existing.
    //  - `respawn-countdown` is dead centre, and so is the wheel — but they can
    //    never be on screen together: the countdown draws only while the local
    //    ship is dead with a respawn pending, and a dead ship cannot dock or
    //    build (`./hud`, the display-list note above `respawnGroup`). Two rects
    //    that share pixels on no frame share no pixels.
    //
    // Everything else clears it outright, which is the result worth having: the
    // corner readouts, the touch affordances and the badges were all already
    // outside the wheel's DRAWN footprint, not merely outside its disc — so the
    // prompt was the only surface the halo's 21px a side was hiding.
    const W = 798;
    const H = 384;
    const wheel = wheelFootprint(W, H);
    const scratch = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 });
    const sticks = affordanceRects(true, FireMode.Manual, W, H);
    const auto = affordanceRects(true, FireMode.AutoAim, W, H);
    // A station off the right-hand edge, so the screen-edge arrow is drawn.
    const arrow = homeArrow({ x: 0, y: 0 }, { x: 900, y: 0 }, { width: W, height: H });

    const surfaces: ReadonlyArray<readonly [string, Rect | null]> = [
      ['station-hp', stationHpBounds(W, 40)],
      ['zoom-control', zoomControlBounds(W, H, true)],
      ['minimap', collapsedRect({ width: W, height: H }, true, {})],
      ['alarm-frame', alarmFrameBounds(W, H)],
      ['alarm-arrow', polyBounds(arrowPoly(arrow))],
      ['respawn-countdown', respawnBounds(W, H, respawnWrapWidth(W, H), 30)],
      ['touch-left-stick', sticks.leftStickZone],
      ['touch-aim-stick', sticks.aimZone],
      ['touch-fire-button', auto.fireButton],
      ['build-button', buildButtonRect(true, true, W, H)],
      ['build-badge', writeBadgeRect(90, 12, W, H, scratch())],
      ['net-ping', writePingRect(70, 12, W, H, scratch(), 20)],
      ['fullscreen-reenter', writeAffordanceRect(W, H, scratch())],
      // `onboarding` is absent on purpose: it withdraws here, which is the fix.
      ['onboarding', promptWithdraws(W, H, true, {}, true) ? null : promptBounds(W, H, 200, lineBox({ width: W, height: H }), true, {}, true)],
    ];

    const sharing = surfaces
      .filter(([, r]) => r !== null && rectsIntersect(r, wheel))
      .map(([id]) => id);
    expect(sharing, `against build-wheel ${fmt(wheel)}`).toEqual([
      'alarm-frame',
      'respawn-countdown',
    ]);
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
// The prompt that names the arrow, against the arrow (a0-104)
// ---------------------------------------------------------------------------
//
// a0-99 photographed both viewports mid-siege: the onboarding band read "Your
// station is under attack — Follow the arrow", the player's own station was the
// large lit object at centre-right of that same frame, and there was no arrow on
// either frame. QA named the two possible readings and would not pick between
// them without the frame it had not captured.
//
// The code picks. `HomeArrow.onScreen` is documented as *"the arrow is a pointer
// to somewhere you can't see; once you can see the station, the station is the
// tell and the arrow is clutter — the view hides it"* (./alarm.ts), the view does
// exactly that (`Hud.drawHomeArrow`: `if (visible.onScreen) return;`), and the
// case directly above this one pins it. So the arrow is CORRECTLY absent while
// home is on screen, and what was wrong is the sentence: it was shown in the one
// state where the thing it names cannot be followed.
//
// Which makes this the invariant, and it belongs in this file because it is a
// question about SCREEN GEOMETRY and not about copy: the words and the mark come
// up together or not at all. It is asserted here against the very function that
// decides the mark — not against a boolean a test made up — so it cannot pass by
// agreeing with a second, drifting copy of the visibility rule.
describe('the under-attack prompt and the mark it names', () => {
  /** Home in 32 directions, far enough out that the arrow is always clamped to
   *  an edge — the same sweep the placement cases above use. */
  const DIRECTIONS_32 = Array.from({ length: 32 }, (_, i) => (i * Math.PI * 2) / 32);

  /** The exact question the view asks before it draws (`Hud.drawHomeArrow`). */
  const arrowIsDrawn = (ship: Point, home: Point, vp: Viewport): boolean =>
    !homeArrow(ship, home, vp, ARROW_EDGE_INSET).onScreen;

  /**
   * One siege frame. Built as a typed value rather than inline at the call so
   * the machine is asked the real question — a signals object is what the HUD
   * hands it every tick (`Hud.updateOnboarding`).
   */
  const siege = (homeArrowUp: boolean): OnboardingSignals => ({
    nearAsteroid: false,
    cargo: 0,
    cargoCap: 2,
    underAttack: true,
    homeArrowUp,
    time: 1,
  });

  /** Every configuration a0-33's branch can resolve this sentence into. */
  const READINGS: ReadonlyArray<readonly [DeviceKind, FireMode, ControlScheme]> = [
    ['keyboard', FireMode.Manual, 'sticks'],
    ['touch', FireMode.AutoAim, 'sticks'],
    ['touch', FireMode.Manual, 'tap'],
    ['gamepad', FireMode.Manual, 'sticks'],
  ];

  it('the prompt never names an arrow that is not drawn', () => {
    // The premise, checked rather than assumed: this sentence really does name
    // the mark, in every reading the scheme/fire-mode branch can produce. If a
    // rewrite ever stops it naming the arrow, this whole gate is the wrong shape
    // and should be re-argued rather than quietly kept passing.
    for (const [device, mode, scheme] of READINGS) {
      const text = resolvePromptText(PromptId.UnderAttack, device, mode, scheme);
      expect(text.toLowerCase(), `${device}/${mode}/${scheme}`).toContain('arrow');
    }

    for (const { name, vp } of PROFILES) {
      // Home a long way out in 32 directions — the arrow is drawn — and home
      // within a few pixels of the ship — it is not. Same ship, same viewport,
      // same function the view calls.
      const ship = { x: 0, y: 0 };
      const homes: ReadonlyArray<readonly [string, Point]> = [
        ...DIRECTIONS_32.map(
          (a, i) => [`far@${i}`, { x: Math.cos(a) * 4000, y: Math.sin(a) * 4000 }] as const,
        ),
        ['on-screen/centre', { x: 0, y: 0 }],
        ['on-screen/near', { x: 20, y: 10 }],
        // a0-99's own frame: the station lit at centre-right, comfortably inside
        // the inset rect on the narrowest screen anyone has photographed.
        ['on-screen/centre-right', { x: vp.width / 2 - ARROW_EDGE_INSET - 1, y: 0 }],
      ];

      for (const [where, home] of homes) {
        const drawn = arrowIsDrawn(ship, home, vp);
        const shown = new Onboarding().update(siege(drawn));
        expect(shown === PromptId.UnderAttack, `${name} / ${where}: arrow drawn=${drawn}`).toBe(
          drawn,
        );
      }
    }
  });

  it('a siege the player never had to be told about does not retire the lesson', () => {
    // The other half of the gate, and the half that decides whether the lesson
    // survives at all. UNDER-ATTACK completes on a siege SURVIVED, and completion
    // is permanent across matches (`./onboarding-memory`). A siege fought with
    // home on screen shows nothing — so if it still completed the prompt, the
    // fix for a0-99 would be "the player is never taught the arrow", forever.
    //
    // `not.toBe` rather than `toBeNull`, deliberately: withholding this prompt
    // does not leave the band empty, it lets the next eligible one have it
    // (OBJECTIVE, here). That is the right outcome and worth pinning as one — the
    // claim is that the SIEGE sentence is absent, not that the HUD goes quiet.
    const ob = new Onboarding();
    expect(ob.update(siege(false))).not.toBe(PromptId.UnderAttack);
    expect(ob.update({ ...siege(false), underAttack: false })).not.toBe(PromptId.UnderAttack);
    expect(ob.isCompleted(PromptId.UnderAttack)).toBe(false);

    // …and the siege that DID need the arrow still teaches and still retires.
    expect(ob.update(siege(true))).toBe(PromptId.UnderAttack);
    expect(ob.update({ ...siege(true), underAttack: false })).not.toBe(PromptId.UnderAttack);
    expect(ob.isCompleted(PromptId.UnderAttack)).toBe(true);
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


// ---------------------------------------------------------------------------
// The screen-edge arrow against the readouts it rides past (a0-116)
// ---------------------------------------------------------------------------
//
// a0-111 failed the qa-phone on the very frame that settled a0-104: the alarm
// was up, the station was off-screen at a bearing that put the arrow on the top
// edge in the middle of it, and that is where GDD §2.2 puts the wave clock. The
// red triangle covered the `A` of WAVE and most of the `V`. QA: *"the arrow is
// doing its job and the words it is standing on are still guessable, so this is a
// legibility defect and not a broken control."*
//
// Both halves of that are the contract, and both are asserted below: the clock is
// left readable, and the arrow does not move a degree off its bearing to do it.
// It gives up RADIUS instead — every point on the ray from the ship to the
// station is the same bearing — which is what `arrowClearOfReadouts` does and
// what the header over it argues.
//
// The sweep is 1° for the whole circle on every profile, because the defect is a
// *bearing* defect: it fires on the fifth of the circle where a readout happens
// to be standing on the edge, and a case at one bearing proves nothing about the
// other 359.

describe('the screen-edge arrow and the readouts it rides past (a0-116)', () => {
  /** Every 1° of bearing, from a station far enough out that the arrow is always
   *  clamped rather than drawn in place. */
  const BEARINGS = Array.from({ length: 360 }, (_, i) => (i * Math.PI * 2) / 360);
  const FAR = 4000;

  /** The eyebrow / bank / clock type specs, as ./hud styles them — the same three
   *  `makeText` calls the counter's own cases above measure through. */
  const eyebrow = (vp: Viewport): TypeSpec => ({
    face: 'heading',
    size: hudType(HUD_EYEBROW_TYPE, hudMetrics(vp.width, vp.height)),
    tracking: TRACKING.eyebrow,
  });
  const bank = (vp: Viewport): TypeSpec => ({
    face: 'bodyBold',
    size: hudType(ORE_BANK_TYPE, hudMetrics(vp.width, vp.height)),
    tracking: TRACKING.name,
  });
  const box = (text: string, spec: TypeSpec) => ({
    width: textWidth(text, spec),
    height: textHeight(text, spec),
  });

  /** The clock's three lines at their widest, the same over-estimate
   *  `wave clock placement` uses — a wider clock is the harder case here too. */
  const clockLines = (vp: Viewport) => {
    const longest = `WAVE 5/5 · ${WAVE_NAMES.reduce((a, b) => (b.length > a.length ? b : a), '')}`;
    return (
      [
        { chars: longest.length, size: 15 },
        { chars: 'FINAL WAVE'.length, size: 14 },
        { chars: 'MATCH 12:00'.length, size: 13 },
      ] as const
    ).map(({ chars, size }) => {
      const px = hudType(size, hudMetrics(vp.width, vp.height));
      return {
        width: Math.ceil(chars * px * 0.85),
        height: Math.ceil(hudType(size, hudMetrics(vp.width, vp.height)) * 1.3),
      };
    });
  };

  /**
   * The readouts the arrow has to stay off, in CONTENT-BOX space — the four HUD
   * groups that carry a word or a number the player reads. This is `Hud`'s own
   * `readoutKeepOut()` list (a0-115's `HUD_READOUT_IDS`), computed here from the
   * elements' geometry functions instead of measured off the drawn groups,
   * because a sweep of 360 bearings across nine profiles has no Pixi in it. Two
   * readings of one list: the view's is the ink that was really laid down, this
   * one is what the same layout says it should be.
   *
   * `banked-total` is the numeral inside the ore counter's ground and needs no
   * row of its own. The minimap and the peer-presence banner are deliberately
   * NOT here: the minimap is a picture rather than a readout, and the banner is a
   * transient that is up on a handful of frames a match — both are noted in the
   * a0-116 PR as the next things to ask this question about, not answered here.
   */
  const readouts = (vp: Viewport, isTouch: boolean): { id: string; r: Rect }[] => {
    const b = contentBox(vp);
    const inner: Viewport = { width: b.width, height: b.height };
    const m = hudMetrics(b.width, b.height);
    // A single-figure bank — the counter at the width QA's stop was carrying.
    const ore = oreCounterLayout(box('ORE', eyebrow(inner)), box('3', bank(inner)), m);
    const out = [
      // `layout()` pins the ore group at (box.x + HUD_PAD, HUD_PAD) and the
      // ground's own origin is (0,0) there.
      {
        id: 'ore-hud',
        r: { x: HUD_PAD, y: HUD_PAD, width: ore.ground.width, height: ore.ground.height },
      },
      { id: 'wave-clock', r: waveClockLayout(b.width, b.height, clockLines(inner), false).bounds },
      // The HOME cluster's whole drawn footprint — its chrome, which is wider
      // and deeper than `stationHpBounds`' ink and is what the group's own
      // bounds report to `readoutKeepOut`. Not the ink: the cluster's closing
      // rule is drawn 3px under the bar, so an arrow cleared to the ink is an
      // arrow standing on the rule. The evidence bench is where that was found
      // out — see the a0-116 README.
      {
        id: 'station-hp',
        r: {
          x: b.width - HUD_PAD - stationChromeWidth(m.scale),
          y: HUD_PAD,
          width: stationChromeWidth(m.scale),
          height: stationChromeHeight(m.scale),
        },
      },
    ];
    const zoom = zoomControlBounds(b.width, b.height, isTouch);
    if (zoom) out.push({ id: 'zoom-control', r: zoom });
    return out;
  };

  /** The arrow as the view draws it: clamped to the content box, then pulled off
   *  the readouts. Returns both, because the case below is about the difference. */
  const shot = (vp: Viewport, isTouch: boolean, bearing: number) => {
    const b = contentBox(vp);
    const inner: Viewport = { width: b.width, height: b.height };
    const centre = { x: b.width / 2, y: b.height / 2 };
    const ro = readouts(vp, isTouch);
    const home = { x: Math.cos(bearing) * FAR, y: Math.sin(bearing) * FAR };
    const edge = homeArrow({ x: 0, y: 0 }, home, inner, ARROW_EDGE_INSET);
    const clear = arrowClearOfReadouts(edge, centre, ro.map((x) => x.r));
    return { b, inner, centre, ro, edge, clear };
  };

  it('the home arrow never lands on a readout', () => {
    for (const { name, vp, isTouch } of PROFILES) {
      // What it was: the sweep against the arrow as a0-111 photographed it, so
      // this case can never pass by asserting something that was never true.
      // These counts are the finding, in numbers, per profile.
      const before: string[] = [];
      let pulled = 0;

      for (const bearing of BEARINGS) {
        const { inner, centre, ro, edge, clear } = shot(vp, isTouch, bearing);
        const at = `${name} @${((bearing * 180) / Math.PI).toFixed(0)}°`;

        for (const { id, r } of ro) {
          if (rectsIntersect(polyBounds(arrowPoly(edge, ARROW_SIZE)), r)) before.push(`${id}${at}`);
        }

        // 1. THE FIX. The triangle the view fills does not touch a readout, and
        //    keeps READOUT_KEEPOUT_PAD of air from it — two runs of ink that end
        //    where the next begins read as one mark.
        const drawn = polyBounds(arrowPoly(clear, ARROW_SIZE));
        for (const { id, r } of ro) {
          expect(
            rectsIntersect(drawn, r),
            `${at}: the arrow ${fmt(drawn)} is drawn on "${id}" ${fmt(r)} — this is a0-111's ` +
              `frame, where the triangle covered the A of WAVE`,
          ).toBe(false);
          // Measured as AIR rather than as a second overlap test against a grown
          // rect: the yield lands the arrow exactly on the pad, and a strict
          // intersection at exactly the boundary is a coin toss in binary
          // floating point. The gap is the number the rule is about, so the gap
          // is what is asserted.
          expect(
            clearAir(drawn, r),
            `${at}: the arrow ${fmt(drawn)} is inside "${id}"'s ${READOUT_KEEPOUT_PAD}px of air`,
          ).toBeGreaterThanOrEqual(READOUT_KEEPOUT_PAD - 1e-9);
        }

        // 2. …and it did not buy that by lying about where home is. The angle is
        //    untouched, and the anchor is still ON the ray from the ship to the
        //    station: same bearing, to the last bit of the arithmetic.
        expect(clear.angle, `${at}: the arrow's angle moved`).toBe(edge.angle);
        expect(clear.onScreen, at).toBe(edge.onScreen);
        expect(clear.distance, at).toBe(edge.distance);
        const bore = Math.atan2(clear.y - centre.y, clear.x - centre.x);
        const off = bore - clear.angle;
        const drift = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
        expect(
          drift,
          `${at}: the arrow is ${((drift * 180) / Math.PI).toFixed(3)}° off its bearing`,
        ).toBeLessThan(1e-9);

        // 3. It yields INWARD, never outward — an arrow pushed the other way
        //    would leave the screen, which is the promise `full` + 0 makes.
        const rEdge = Math.hypot(edge.x - centre.x, edge.y - centre.y);
        const rClear = Math.hypot(clear.x - centre.x, clear.y - centre.y);
        expect(rClear, `${at}: the arrow moved outward`).toBeLessThanOrEqual(rEdge + 1e-9);
        expectWithin(drawn, FULL, inner, `alarm-arrow ${at}`);
        if (rEdge - rClear > 1e-9) pulled++;
      }

      // The other half of "failing today": on every profile the shipped arrow
      // really does land on a readout, so the sweep above is a fix and not a
      // tautology. 111 of 360 bearings on the qa-phone, 66 on the desktop.
      expect(
        before.length,
        `${name}: the unyielded arrow never hit a readout — this suite is asserting nothing`,
      ).toBeGreaterThan(0);
      expect(pulled, `${name}: nothing yielded`).toBeGreaterThan(0);
    }
  });

  it('the readouts never cover the ship, which is why the ray always has somewhere to go', () => {
    // The yield walks the arrow back down its own ray, so it terminates on the
    // near edge of whatever is in the way. That is only true while the ray's
    // ORIGIN — the ship, which the follow camera holds at the middle of the
    // content box — is outside every readout. It is: the readouts are corner and
    // top-edge chrome. `arrowClearOfReadouts` floors the radius at zero anyway,
    // and this is the case that keeps that floor theoretical rather than reached.
    for (const { name, vp, isTouch } of PROFILES) {
      const b = contentBox(vp);
      const centre = { x: b.width / 2, y: b.height / 2 };
      for (const { id, r } of readouts(vp, isTouch)) {
        const covers =
          centre.x > r.x - READOUT_KEEPOUT_PAD &&
          centre.x < r.x + r.width + READOUT_KEEPOUT_PAD &&
          centre.y > r.y - READOUT_KEEPOUT_PAD &&
          centre.y < r.y + r.height + READOUT_KEEPOUT_PAD;
        expect(covers, `${name}: "${id}" ${fmt(r)} covers the ship at ${centre.x},${centre.y}`).toBe(
          false,
        );
      }
    }
  });

  it('a0-111s own frame: the arrow stood on WAVE 1/5, and now stands under it', () => {
    // The bearing QA reported: the station off-screen almost straight ahead, so
    // the arrow lands on the top edge in the middle of it. Straight up is y-down
    // −90°, and it is the worst case for the clock rather than a lucky one — the
    // clock is centred on that column.
    const vp: Viewport = { width: 798, height: 384 };
    const { ro, edge, clear } = shot(vp, true, -Math.PI / 2);
    const clock = ro.find((x) => x.id === 'wave-clock')!.r;

    // BEFORE: the triangle is inside the clock's rect, over its first line.
    const was = polyBounds(arrowPoly(edge, ARROW_SIZE));
    expect(edge.x).toBeCloseTo(399, 6);
    expect(edge.y).toBeCloseTo(ARROW_EDGE_INSET, 6);
    expect(rectsIntersect(was, clock), `the frame a0-111 filed: ${fmt(was)} vs ${fmt(clock)}`).toBe(
      true,
    );
    // …and it is the FIRST line it is standing on, which is what made `WAVE` the
    // word that lost its A: the clock's lines start at its rect's top.
    expect(was.y).toBeLessThan(clock.y + 20);

    // AFTER: same column, same angle, pulled down the ray until the triangle
    // clears the strip by exactly the pad. The clock is not touched.
    const now = polyBounds(arrowPoly(clear, ARROW_SIZE));
    expect(clear.x).toBeCloseTo(edge.x, 6);
    expect(clear.angle).toBe(edge.angle);
    expect(now.y).toBeCloseTo(clock.y + clock.height + READOUT_KEEPOUT_PAD, 6);
    expect(rectsIntersect(now, clock)).toBe(false);
    // It is still an arrow at the top of the screen — 58px further down a 384px
    // viewport, in the same column, not a mark that has walked off to the ship.
    expect(clear.y - edge.y).toBeCloseTo(58, 6);
    expect(now.y).toBeLessThan(vp.height / 4);
  });
});

// ---------------------------------------------------------------------------
// The world-label keep-out (a0-115) — nothing lands in a readout
// ---------------------------------------------------------------------------
//
// a0-111 failed the top-left corner on 4 of 28 sampled camera positions: the grey
// word `ORE` and the teal nameplate `Rusty (EASY)` on the same pixels, the R of
// Rusty drawn across the E of ORE. Two pieces of TEXT in one rect — which is a
// different defect from the one a0-102 fixed. That brief gave the counter a
// ground so the *world* behind it could not swallow it; a ground is no use
// against something drawn in the HUD's own layer, and no use even when the
// readout wins the z-order, which it already does (`./hud`'s display list puts
// every corner group above the nameplate layer). Type is mostly holes: the label
// underneath shows through the counters and the sidebearings of a 22px numeral,
// and the eye reads two words rather than one word over a texture.
//
// The rule this suite holds the HUD to is therefore about placement, not paint,
// and it is deliberately NOT about the ore counter: the counter is where it is,
// and the next world-anchored thing will find it there too. It is driven off the
// registry's ids — `./layout-exclusions` `HUD_READOUT_IDS` — so the same
// assertion covers the wave clock (a0-116 is this exact collision on that
// element), the HOME cluster and the VIEW chip without a line of new test.

describe('the fixed readouts and the world labels that pass over them', () => {
  /** A nameplate's tokens, measured on the real face at the real size — Oxanium
   *  at 12px with `name` tracking, which is what {@link NAMEPLATE_FONT_SIZE} and
   *  the view's `Text` style spell. Same discipline as nameplates.test.ts. */
  const PLATE_TYPE = { face: 'body', size: NAMEPLATE_FONT_SIZE, tracking: HUD_TRACKING.name } as const;
  const tokenWidth = (text: string): number => (text.length > 0 ? textWidth(text, PLATE_TYPE) : 0);
  const PLATE_LINE = textHeight('Rusty', PLATE_TYPE);

  /**
   * The two plates that have to clear the corner, both of them real:
   *
   *  - `Rusty (EASY)` in FFA — the plate QA actually photographed inside the ore
   *    counter, character for character.
   *  - `ENEMY B Warden (BRUTAL)` in teams — the widest row the game can build
   *    (side tag first since a0-38), because a wider row is the harder case for
   *    "step aside without leaving your ship" and must not pass by being narrow.
   */
  const PLATES: readonly { readonly what: string; readonly side: string; readonly name: string; readonly suffix: string }[] = [
    { what: 'Rusty (EASY)', side: '', name: 'Rusty', suffix: '(EASY)' },
    { what: 'ENEMY B Warden (BRUTAL)', side: 'ENEMY B', name: 'Warden', suffix: '(BRUTAL)' },
  ];

  /** A ship-kind plate at a screen position, for the clearance the view floats the
   *  row by — read off the view's own function so the label's vertical extent here
   *  is the one it draws with, not a restatement of it. */
  const SHIP_RADIUS = 12;
  const shipPlate = (x: number, y: number): Nameplate => ({
    owner: 3,
    kind: 'ship',
    text: 'Rusty',
    suffix: '(EASY)',
    teamLabel: '',
    teamColor: 0xffffff,
    color: 0xffffff,
    x,
    y,
    radius: SHIP_RADIUS,
    alpha: 1,
    local: false,
  });

  /** The row a plate draws at `(x, y)`, in screen space: the rigid side/name/tag
   *  row from the view's own layout function, floated above the entity's health-bar
   *  cluster by the view's own clearance. */
  const rowAt = (
    plate: (typeof PLATES)[number],
    x: number,
    y: number,
  ): { left: number; right: number; top: number; bottom: number } => {
    const row = nameplateRowLayout(x, {
      side: tokenWidth(plate.side),
      name: tokenWidth(plate.name),
      suffix: tokenWidth(plate.suffix),
    });
    const bottom = y - nameplateClusterClearance(shipPlate(x, y));
    return { left: row.left, right: row.right, top: bottom - PLATE_LINE, bottom };
  };

  const asRect = (row: { left: number; right: number; top: number; bottom: number }): Rect => ({
    x: row.left,
    y: row.top,
    width: row.right - row.left,
    height: row.bottom - row.top,
  });

  /** A rect grown by the keep-out pad on all four sides — the air two runs of type
   *  need to read as two rather than as one word. */
  const pad = (r: Rect): Rect => ({
    x: r.x - READOUT_KEEPOUT_PAD,
    y: r.y - READOUT_KEEPOUT_PAD,
    width: r.width + 2 * READOUT_KEEPOUT_PAD,
    height: r.height + 2 * READOUT_KEEPOUT_PAD,
  });

  /** The counter's group-space layout pinned where `./hud` `layout()` pins the
   *  group — `(contentBox.x + HUD_PAD, HUD_PAD)`, the content box's top-left corner
   *  and never the screen's (a0-74). This is the rect the registry records as
   *  `ore-hud`, and QA measured it at 16,16 by 52.9×75 on the frame they failed. */
  const oreScreenRect = (layout: OreCounterLayout, contentX: number): Rect => ({
    x: contentX + HUD_PAD,
    y: HUD_PAD,
    width: layout.ground.width,
    height: layout.ground.height,
  });

  /** The clock's three readouts at their longest, the same estimate the a0-24
   *  clearance test uses — generous on purpose, since a wider strip is the harder
   *  keep-out and cannot make this pass by accident. */
  const CLOCK_LINES: readonly { chars: number; size: number }[] = [
    { chars: `WAVE 5/5 · ${WAVE_NAMES.reduce((a, b) => (b.length > a.length ? b : a), '')}`.length, size: 15 },
    { chars: 'FINAL WAVE'.length, size: 14 },
    { chars: 'MATCH 12:00'.length, size: 13 },
  ];

  /**
   * A frame's worth of readout registry entries for a profile, built from the same
   * geometry the views draw with — this is the "drive it from the registry rather
   * than hard-code the counter's corner" the brief asks for. Every id here is one
   * `./hud` `describeLayout` pushes (`wave-clock` excepted, and argued there and in
   * `HUD_READOUT_IDS`), and every rect is the element's DRAWN footprint.
   */
  const readoutEntries = (vp: Viewport, isTouch: boolean): LayoutEntry[] => {
    const box = contentBox(vp);
    const m = hudMetrics(box.width, box.height);
    const ore = oreCounterLayout(
      {
        width: textWidth('ORE', { face: 'heading', size: hudType(HUD_EYEBROW_TYPE, m), tracking: TRACKING.eyebrow }),
        height: textHeight('ORE', { face: 'heading', size: hudType(HUD_EYEBROW_TYPE, m), tracking: TRACKING.eyebrow }),
      },
      {
        // A four-figure bank: the counter is at its widest late in a match, which
        // is when the corner is most likely to be in the way.
        width: textWidth('1204', { face: 'bodyBold', size: hudType(ORE_BANK_TYPE, m), tracking: TRACKING.name }),
        height: textHeight('1204', { face: 'bodyBold', size: hudType(ORE_BANK_TYPE, m), tracking: TRACKING.name }),
      },
      m,
    );
    const clock = waveClockLayout(
      vp.width,
      vp.height,
      CLOCK_LINES.map(({ chars, size }) => {
        const px = hudType(size, m);
        return { width: Math.ceil(chars * px * 0.85), height: Math.ceil(px * 1.3) };
      }),
      false,
    );
    const zoom = zoomControlBounds(box.width, box.height, isTouch);
    const entries: LayoutEntry[] = [
      { id: 'ore-hud', anchor: { region: 'top-left', margin: HUD_PAD }, bounds: oreScreenRect(ore, box.x) },
      { id: 'wave-clock', anchor: { region: 'top-center', margin: HUD_PAD }, bounds: clock.bounds },
      { id: 'station-hp', anchor: { region: 'top-right', margin: HUD_PAD }, bounds: stationHpBounds(vp.width, 40) },
    ];
    if (zoom) {
      entries.push({
        id: 'zoom-control',
        anchor: { region: 'top-right', margin: HUD_PAD },
        bounds: { ...zoom, x: zoom.x + box.x },
      });
    }
    // Two things that are NOT readouts, carried through the same call so the
    // filter is exercised rather than assumed: a label passing over the minimap or
    // the controls strip is not a defect and must not be moved for one.
    entries.push({ id: 'minimap', anchor: { region: 'bottom-right', margin: HUD_PAD }, bounds: collapsedRect(vp, isTouch, {}) });
    entries.push({ id: 'alarm-frame', anchor: FULL, bounds: alarmFrameBounds(vp.width, vp.height) });
    return entries;
  };

  it('no world label is drawn inside a HUD readout', () => {
    // The sweep: a ship at every position on a 6px lattice over the whole
    // viewport, on every profile, both device answers, with both plates. QA
    // sampled 28 camera positions and 4 of them landed something in the counter;
    // this samples tens of thousands and asserts on all of them, which is the
    // point of doing it here rather than with a camera.
    const STEP = 6;
    let sampled = 0;
    let collided = 0;
    let stepped = 0;
    let withheld = 0;
    let maxStep = 0;

    for (const { name, vp, isTouch } of PROFILES) {
      const entries = readoutEntries(vp, isTouch);
      const readouts = readoutRects(entries);
      // The filter did its job: the minimap and the alarm frame are in the frame
      // and are not keep-outs, so a label may cross them freely.
      expect(readouts.length, `${name}: no readouts resolved out of the frame`).toBe(
        entries.filter((e) => HUD_READOUT_IDS.includes(e.id)).length,
      );

      for (const plate of PLATES) {
        for (let y = 0; y <= vp.height; y += STEP) {
          for (let x = 0; x <= vp.width; x += STEP) {
            const row = rowAt(plate, x, y);
            // The layer's own edge cull runs first and is unchanged: a row that
            // would spill off the canvas is not drawn at all, so it is not a
            // candidate for anything this rule has to say.
            if (row.left < 0 || row.top < 0 || row.right > vp.width || row.bottom > vp.height) continue;
            sampled++;

            // "In the way" is measured with the same pad the rule keeps, so a
            // plate that merely grazes a readout counts as a collision here too —
            // otherwise a legitimate step would look like a label moved for
            // nothing.
            const before = pad(asRect(row));
            const wasIn = readouts.some((r) => rectsIntersect(before, r));
            if (wasIn) collided++;

            const yielded = labelYieldsToReadouts(row, x, SHIP_RADIUS, readouts, vp.width);
            if (yielded.withheld) {
              // Standing down is a legal answer, and only when the label really
              // had nowhere to go: a plate that was already clear must never be
              // withheld.
              expect(wasIn, `${name} / ${plate.what} @ ${x},${y}: a clear label was withheld`).toBe(true);
              // There are exactly two reasons a plate can have nowhere to go, and
              // both are geometric facts about the frame rather than choices this
              // rule makes: the ship is in a readout's own column (the step is
              // horizontal, so a ship UNDER a readout has no side to step to), or
              // it is in a gap between two readouts narrower than its row — the
              // 844×390 landscape phone leaves 154px between the wave clock and
              // the HOME cluster, and `ENEMY B Warden (BRUTAL)` is 175.6px wide.
              // The single-readout case below pins the first exactly; here the
              // claim is only that a label is never withheld while it was clear.
              withheld++;
              continue;
            }
            if (yielded.dx !== 0) {
              stepped++;
              maxStep = Math.max(maxStep, Math.abs(yielded.dx));
              // It stepped aside, and it is still standing over the ship it names
              // — the bound that stops "yield" from turning into "caption the
              // wrong hull".
              expect(row.left + yielded.dx, `${name} / ${plate.what} @ ${x},${y}`).toBeLessThanOrEqual(x + SHIP_RADIUS + 1e-6);
              expect(row.right + yielded.dx, `${name} / ${plate.what} @ ${x},${y}`).toBeGreaterThanOrEqual(x - SHIP_RADIUS - 1e-6);
              // …and it stayed on the canvas, so a step never becomes a clip.
              expect(row.left + yielded.dx, `${name} / ${plate.what} @ ${x},${y}`).toBeGreaterThanOrEqual(-1e-6);
              expect(row.right + yielded.dx, `${name} / ${plate.what} @ ${x},${y}`).toBeLessThanOrEqual(vp.width + 1e-6);
            }

            // THE ASSERTION. Wherever the label ended up, it is not in a readout —
            // and not merely flush against one: the pad is the air two runs of
            // type need to be read as two.
            const after = asRect({ ...row, left: row.left + yielded.dx, right: row.right + yielded.dx });
            const padded = pad(after);
            for (let i = 0; i < readouts.length; i++) {
              const r = readouts[i]!;
              expect(
                rectsIntersect(padded, r),
                `${name} / ${plate.what}: a ship at (${x}, ${y}) draws its label at ` +
                  `${fmt(after)}, inside the readout ${fmt(r)} — ` +
                  `${yielded.dx === 0 ? 'it did not step aside at all' : `stepping ${yielded.dx.toFixed(1)}px was not enough`}`,
              ).toBe(false);
            }
          }
        }
      }
    }

    // Not vacuous: a real share of the sampled positions put a label in a readout
    // before the rule ran — QA found 4 in 28 by hand — and both answers the rule
    // has are actually taken.
    expect(sampled, 'nothing was sampled').toBeGreaterThan(10000);
    expect(collided, 'no sampled position collided — the sweep is not exercising the rule').toBeGreaterThan(200);
    expect(stepped + withheld).toBe(collided);
    expect(stepped, 'no label ever stepped aside — the rule only knows how to drop').toBeGreaterThan(0);
    expect(withheld, 'no label ever stood down — the floor of the rule is untested').toBeGreaterThan(0);
    // A step is bounded by construction — the furthest a plate can travel is the
    // distance from its own anchor to the far edge of its row, plus the hull's
    // radius. Asserted against that derivation rather than against a number, so a
    // longer name widens the bound honestly instead of failing here.
    const widestReach = Math.max(
      ...PLATES.map((p) => {
        const r = nameplateRowLayout(0, {
          side: tokenWidth(p.side),
          name: tokenWidth(p.name),
          suffix: tokenWidth(p.suffix),
        });
        return Math.max(-r.left, r.right);
      }),
    );
    expect(maxStep).toBeLessThanOrEqual(widestReach + SHIP_RADIUS + 1e-6);

    // WHICH answer a collision gets depends on how wide the readout is, and it is
    // worth being exact rather than hopeful about that, because "yield" sounds
    // like "move" and across the whole sweep it is mostly "stand down": the wave
    // clock and the HOME cluster are 140–300px wide and a plate can travel about
    // 50, so a ship dead behind either has nowhere to be. That is the right answer
    // there — a name 150px from its hull names the wrong hull — and it is not the
    // answer for the element this brief is about. Against the ore counter alone,
    // on the phone QA photographed, stepping aside is what almost always happens.
    const qa = PROFILES.find((p) => p.name === 'qa-phone/landscape')!;
    const counterOnly = readoutRects(readoutEntries(qa.vp, qa.isTouch), ['ore-hud']);
    expect(counterOnly).toHaveLength(1);
    let counterStepped = 0;
    let counterHeld = 0;
    let counterHeldMaxX = -Infinity;
    let counterStepMinX = Infinity;
    for (let y = 0; y <= qa.vp.height; y += STEP) {
      for (let x = 0; x <= qa.vp.width; x += STEP) {
        const row = rowAt(PLATES[0]!, x, y);
        if (row.left < 0 || row.top < 0 || row.right > qa.vp.width || row.bottom > qa.vp.height) continue;
        if (!counterOnly.some((r) => rectsIntersect(pad(asRect(row)), r))) continue;
        if (labelYieldsToReadouts(row, x, SHIP_RADIUS, counterOnly, qa.vp.width).withheld) {
          counterHeld++;
          counterHeldMaxX = Math.max(counterHeldMaxX, x);
        } else {
          counterStepped++;
          counterStepMinX = Math.min(counterStepMinX, x);
        }
      }
    }
    expect(counterStepped + counterHeld, 'the counter is never in the way at all').toBeGreaterThan(50);
    expect(counterStepped, 'no plate ever escaped the ore counter by stepping aside').toBeGreaterThan(0);
    // Where the line falls, exactly, on the element QA photographed: a ship clear
    // of the counter's own column keeps its name — every one of them — and a ship
    // behind the counter loses it, which is the case where there was never a
    // reading of the plate to preserve. `counterHeldMaxX` is the rightmost ship
    // that stood down and it is inside the counter; `counterStepMinX` is the
    // leftmost that stepped and it is outside.
    expect(counterHeldMaxX, 'a ship clear of the counter still lost its name').toBeLessThan(
      counterOnly[0]!.x + counterOnly[0]!.width,
    );
    expect(counterStepMinX, 'a ship under the counter kept a name it had no room for').toBeGreaterThan(
      counterOnly[0]!.x,
    );
  });

  it('the frame QA photographed, before and after', () => {
    // a0-111's own numbers, not a recomputation of them: the ore counter's
    // registered rect on the 798×384 phone was 16,16 by 52.9×75 logical, and the
    // largest nameplate intersection measured inside it was 20.3 × 16.
    const counter: Rect = { x: 16, y: 16, width: 52.9, height: 75 };
    const vp: Viewport = { width: 798, height: 384 };
    expect(oreScreenRect(
      oreCounterLayout(
        { width: textWidth('ORE', { face: 'heading', size: hudType(HUD_EYEBROW_TYPE, hudMetrics(vp.width, vp.height)), tracking: TRACKING.eyebrow }), height: 11 },
        { width: textWidth('3', { face: 'bodyBold', size: hudType(ORE_BANK_TYPE, hudMetrics(vp.width, vp.height)), tracking: TRACKING.name }), height: 22 },
        hudMetrics(vp.width, vp.height),
      ),
      contentBox(vp).x,
    ).x, 'the counter is pinned to the content box corner, as QA measured it').toBeCloseTo(counter.x, 6);

    // A `Rusty (EASY)` plate placed to reproduce that overlap exactly: its row
    // starts 20.3px inside the counter's right edge and its 16px line sits wholly
    // inside the counter's 75px depth.
    const plate = PLATES[0]!;
    const row0 = nameplateRowLayout(0, {
      side: 0,
      name: tokenWidth(plate.name),
      suffix: tokenWidth(plate.suffix),
    });
    // Put the row's left edge at 48.6 so it overlaps the counter by 20.3px.
    const x = 48.6 - row0.left;
    const row = { left: 48.6, right: 48.6 + row0.width, top: 40, bottom: 40 + 16 };

    // BEFORE: exactly the frame in the verdict — the two rects share 20.3 × 16.
    const overlapBefore = rectOverlap(asRect(row), counter)!;
    expect(overlapBefore.width, 'QA measured 20.3 logical px of shared width').toBeCloseTo(20.3, 1);
    expect(overlapBefore.height, 'and 16 of shared height — the whole label line').toBeCloseTo(16, 6);

    // AFTER: the label steps out to the counter's right edge plus the keep-out
    // pad, and shares nothing with it. It does NOT vanish — the ship at x is far
    // enough right that the row still stands over it.
    const yielded = labelYieldsToReadouts(row, x, SHIP_RADIUS, [counter], vp.width);
    expect(yielded.withheld, 'this plate had somewhere to go and should have gone there').toBe(false);
    expect(yielded.dx, 'flush past the counter, plus the pad').toBeCloseTo(
      counter.x + counter.width + READOUT_KEEPOUT_PAD - row.left,
      6,
    );
    const after = asRect({ ...row, left: row.left + yielded.dx, right: row.right + yielded.dx });
    expect(rectOverlap(after, counter), `label ${fmt(after)} still shares pixels with ${fmt(counter)}`).toBeNull();
    expect(after.x, 'and it clears the counter by the pad, not by a hair').toBeCloseTo(
      counter.x + counter.width + READOUT_KEEPOUT_PAD,
      6,
    );
    // …and it is still standing over the hull it names — the row overlaps the
    // ship's own span on screen, which is the bound the step is allowed up to.
    expect(after.x).toBeLessThanOrEqual(x + SHIP_RADIUS);
    expect(after.x + after.width).toBeGreaterThanOrEqual(x - SHIP_RADIUS);
  });

  it('a label that cannot step aside stands down, and only then', () => {
    // The floor of the rule, stated as its own case because it is the part that
    // could become a silent disappearance. A ship dead behind a wide readout has
    // no position that clears it while still standing over the hull, so its plate
    // is withheld — and the layer records the fact (nameplates-view
    // `WithheldNameplate`), which is what keeps this from being indistinguishable
    // from a rendering fault.
    const wide: Rect = { x: 0, y: 0, width: 400, height: 100 };
    const row = { left: 150, right: 250, top: 40, bottom: 56 };
    expect(labelYieldsToReadouts(row, 200, SHIP_RADIUS, [wide], 800)).toEqual({ dx: 0, withheld: true });

    // …and it is genuinely the reach that binds, not the readout: the same plate
    // beside a narrow readout steps out instead of standing down.
    const narrow: Rect = { x: 120, y: 0, width: 60, height: 100 };
    const out = labelYieldsToReadouts(row, 200, SHIP_RADIUS, [narrow], 800);
    expect(out.withheld).toBe(false);
    expect(out.dx).toBeCloseTo(narrow.x + narrow.width + READOUT_KEEPOUT_PAD - row.left, 6);

    // A step out of one readout is never a step into the next: with the wave clock
    // where the ore counter's exit would have put it, the plate stands down rather
    // than swapping which readout it is drawn through.
    const secondReadout: Rect = { x: 182, y: 0, width: 200, height: 100 };
    expect(labelYieldsToReadouts(row, 200, SHIP_RADIUS, [narrow, secondReadout], 800).withheld).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// a0-119 — one owner, two plates, and the pixels they were sharing
// ---------------------------------------------------------------------------
//
// QA, on a0-118's sweep, having confirmed all four of a0-111's fixes:
//
//   > **failed** — Not one of the four: two nameplates for the same owner are
//   > drawn on each other and neither can be read.
//
// The developer's own screenshot of 2026-08-19 has it: `Rusty (EASY)` printed
// twice, overlapping, one label across the other, on a station and a ship
// belonging to the same character.
//
// **Two plates for one owner is not the defect.** The field request that created
// this layer asked for both by name — *"I want to see player names over their
// stations and their ships"* — and a character genuinely has two things worth
// labelling. The defect is that the two collide and neither survives it, which
// happens on exactly the frames where the ship is at its own home.
//
// So the model here is the view's own placement loop, composed out of the same
// pure pieces the layer draws with — `nameplateRowLayout` for the rigid row,
// `nameplateClusterClearance` for how far it floats above its entity,
// `labelYieldsToReadouts` for the a0-115 step, `labelRepeatsOwner` for a0-119 —
// walked in `NAMEPLATE_KIND_ORDER`, which is the ruling about which of an owner's
// two plates keeps its pixels. Same discipline as the a0-115 block above: nothing
// is restated as a number a test can drift away from.
describe('one owner, two nameplates (a0-119)', () => {
  const PLATE_TYPE = { face: 'body', size: NAMEPLATE_FONT_SIZE, tracking: HUD_TRACKING.name } as const;
  const tokenWidth = (text: string): number => (text.length > 0 ? textWidth(text, PLATE_TYPE) : 0);
  const PLATE_LINE = textHeight('Rusty', PLATE_TYPE);

  /** The character in the screenshot, character for character — a bot seat, so
   *  the plate carries the recessive difficulty tag that made it as wide as it is. */
  const RUSTY = 3;
  /** A second seat, so the rule's SCOPE is exercised and not merely asserted: a
   *  rival's plate must never be dropped for crowding this one. */
  const SABLE = 5;

  const NAMES: Record<number, { name: string; suffix: string }> = {
    [RUSTY]: { name: 'Rusty', suffix: '(EASY)' },
    [SABLE]: { name: 'Sable', suffix: '(HARD)' },
  };

  /** Screen radii: a home is a big disc, a hull is not (GDD §2.2). These are the
   *  two numbers that decide how far apart the two rows float, and therefore the
   *  band of ship positions where they collide. */
  const STATION_RADIUS = 40;
  const SHIP_RADIUS = 12;

  const plate = (owner: number, kind: 'ship' | 'station', x: number, y: number): Nameplate => ({
    owner,
    kind,
    text: NAMES[owner]!.name,
    suffix: NAMES[owner]!.suffix,
    teamLabel: '',
    teamColor: 0xffffff,
    color: 0xffffff,
    x,
    y,
    radius: kind === 'station' ? STATION_RADIUS : SHIP_RADIUS,
    alpha: 1,
    local: false,
  });

  /** The rect a plate's row occupies at a given sideways step, screen space. */
  const rectFor = (p: Nameplate, dx: number): Rect => {
    const row = nameplateRowLayout(p.x, {
      side: tokenWidth(p.teamLabel),
      name: tokenWidth(p.text),
      suffix: tokenWidth(p.suffix),
    });
    const bottom = p.y - nameplateClusterClearance(p);
    return { x: row.left + dx, y: bottom - PLATE_LINE, width: row.width, height: PLATE_LINE };
  };

  interface Placement extends PlacedLabel {
    readonly kind: 'ship' | 'station';
  }
  interface Frame {
    readonly drawn: Placement[];
    readonly withheld: { owner: number; kind: string; reason: string }[];
  }

  /**
   * The view's placement loop for one frame, as pure geometry.
   *
   * `arbitrate` is the whole diff: with it OFF this is exactly what the layer did
   * before this brief — each row placed from its own entity and from nothing else
   * — and with it ON each plate also has to clear the plates already down for its
   * own owner. Keeping both behind one flag is what lets the BEFORE below be the
   * real before rather than a story about it.
   */
  const placeFrame = (
    plates: readonly Nameplate[],
    vp: Viewport,
    readouts: readonly Rect[] = [],
    arbitrate = true,
  ): Frame => {
    const drawn: Placement[] = [];
    const withheld: { owner: number; kind: string; reason: string }[] = [];
    for (const kind of NAMEPLATE_KIND_ORDER) {
      for (const p of plates) {
        if (p.kind !== kind) continue;
        const at = rectFor(p, 0);
        // The layer's own edge cull runs first and is untouched by this brief.
        if (at.x < 0 || at.y < 0 || at.x + at.width > vp.width || at.y + at.height > vp.height) {
          withheld.push({ owner: p.owner, kind: p.kind, reason: 'offscreen' });
          continue;
        }
        const yielded = labelYieldsToReadouts(
          { left: at.x, right: at.x + at.width, top: at.y, bottom: at.y + at.height },
          p.x,
          p.radius,
          readouts,
          vp.width,
        );
        if (yielded.withheld) {
          withheld.push({ owner: p.owner, kind: p.kind, reason: 'readout' });
          continue;
        }
        const rect = rectFor(p, yielded.dx);
        if (arbitrate && labelRepeatsOwner(p.owner, rect, drawn)) {
          withheld.push({ owner: p.owner, kind: p.kind, reason: 'duplicate' });
          continue;
        }
        drawn.push({ owner: p.owner, kind: p.kind, rect });
      }
    }
    return { drawn, withheld };
  };

  /**
   * Every pair of DRAWN plates that share pixels and an owner — the thing QA
   * photographed, and what this whole block exists to drive to zero.
   *
   * `pad` grows each rect before the test, which is the difference between the
   * two questions worth asking of a frame. At `0` it is *are these two on each
   * other* — the defect, literally. At {@link READOUT_KEEPOUT_PAD} it is what the
   * rule actually reacts to, because two runs of type that end where the next
   * begins read as one word (a0-115's argument, inherited whole).
   */
  const sameOwnerCollisions = (frame: Frame, pad = 0): { a: Placement; b: Placement; overlap: Rect }[] => {
    const grown = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });
    const out: { a: Placement; b: Placement; overlap: Rect }[] = [];
    for (let i = 0; i < frame.drawn.length; i++) {
      for (let j = i + 1; j < frame.drawn.length; j++) {
        const a = frame.drawn[i]!;
        const b = frame.drawn[j]!;
        if (a.owner !== b.owner) continue;
        const overlap = rectOverlap(grown(a.rect), b.rect);
        if (overlap) out.push({ a, b, overlap });
      }
    }
    return out;
  };

  it('no two nameplates for the same owner overlap', () => {
    // ── THE FRAME IN THE SCREENSHOT ────────────────────────────────────────
    // One character with a station and a ship on screen at once, the ship
    // hovering just above its own home — which is where a player spends the
    // opening of every match (GDD §2.3: you build at your station) and where the
    // developer's 2026-08-19 capture caught it.
    const vp: Viewport = { width: 1280, height: 800 };
    const home = plate(RUSTY, 'station', 640, 420);
    // 24px above its home: the offset at which the two rows land on exactly the
    // same baseline, because a station's row floats by `radius + 8` off a 40px
    // disc and a ship's by `radius + 5 + 4 + 3` off a 12px hull. It is the worst
    // case of the band, and the band either side of it is swept below.
    const hull = plate(RUSTY, 'ship', 640, 420 - 24);

    // BEFORE — the defect, measured rather than described. Both rows draw, they
    // are the SAME STRING, and they share pixels.
    const before = placeFrame([hull, home], vp, [], false);
    expect(before.drawn, 'both plates drew, as they did on the frame QA failed').toHaveLength(2);
    expect(before.drawn[0]!.rect.x, 'and they are the same row, so the collision is total').toBeCloseTo(
      before.drawn[1]!.rect.x,
      6,
    );
    const collided = sameOwnerCollisions(before);
    expect(collided, 'the reproduction is not reproducing anything').toHaveLength(1);
    // The overlap is the whole line, both ways: a full-height, full-width
    // intersection of two identical rows is precisely "neither can be read".
    expect(collided[0]!.overlap.height).toBeCloseTo(PLATE_LINE, 6);
    expect(collided[0]!.overlap.width).toBeCloseTo(before.drawn[0]!.rect.width, 6);

    // AFTER — one plate, and it is the STATION's (NAMEPLATE_KIND_ORDER). The ship's
    // stands down with a `duplicate` receipt rather than disappearing quietly.
    const after = placeFrame([hull, home], vp);
    expect(sameOwnerCollisions(after)).toEqual([]);
    expect(after.drawn).toHaveLength(1);
    expect(after.drawn[0]!.kind, 'the landmark keeps its name; the thing in motion yields').toBe('station');
    expect(after.withheld).toEqual([{ owner: RUSTY, kind: 'ship', reason: 'duplicate' }]);
    // Nothing was lost by dropping it: the plate that remains is the same word,
    // within a hull's width of where the dropped one wanted to be.
    expect(Math.abs(after.drawn[0]!.rect.x - collided[0]!.b.rect.x)).toBeLessThanOrEqual(SHIP_RADIUS);

    // ── THE WHOLE BAND, ON EVERY PROFILE ──────────────────────────────────
    // The screenshot is one position out of a continuum. A ship orbits, docks,
    // launches and dies at its own station all match, so the assertion has to be
    // about every offset, not about the one that was photographed. Sweep the hull
    // over a lattice around its home — and put a RIVAL's station and ship in the
    // same frame throughout, so the rule's scope is exercised: two plates for two
    // owners may crowd each other all they like, and this rule must not touch them.
    const STEP = 4;
    const SPAN = 140;
    let sampled = 0;
    let wouldCollide = 0;
    let wouldCrowd = 0;
    let dropped = 0;
    for (const { name, vp: profile } of PROFILES) {
      const cx = profile.width / 2;
      const cy = profile.height / 2;
      const rustyHome = plate(RUSTY, 'station', cx, cy);
      // The rival sits a plate-width to the left, close enough that its rows and
      // Rusty's cross constantly.
      const sableHome = plate(SABLE, 'station', cx - 70, cy - 30);
      const sableShip = plate(SABLE, 'ship', cx - 70, cy - 90);

      for (let dy = -SPAN; dy <= SPAN; dy += STEP) {
        for (let dx = -SPAN; dx <= SPAN; dx += STEP) {
          const rustyShip = plate(RUSTY, 'ship', cx + dx, cy + dy);
          const plates = [rustyShip, sableShip, rustyHome, sableHome];
          sampled++;

          const raw = placeFrame(plates, profile, [], false);
          // What the frame looked like before the rule: the pairs literally on
          // each other, and the wider set the rule reacts to (those plus the ones
          // separated by less than the keep-out pad).
          const rawHits = sameOwnerCollisions(raw);
          const rawCrowded = sameOwnerCollisions(raw, READOUT_KEEPOUT_PAD);
          if (rawHits.length > 0) wouldCollide++;
          if (rawCrowded.length > 0) wouldCrowd++;

          const frame = placeFrame(plates, profile);

          // THE ASSERTION. Whatever the hull is doing, no two plates for one owner
          // are in the same pixels.
          const hits = sameOwnerCollisions(frame);
          expect(
            hits.map((h) => `${h.a.kind}/${h.b.kind} ${fmt(h.overlap)}`),
            `${name}: a ship at (+${dx}, +${dy}) from its own home draws two plates for owner ${RUSTY} on each other`,
          ).toEqual([]);

          // A plate is dropped ONLY when it really would have repeated one — the
          // half of the rule that keeps "yield" from becoming "sometimes there is
          // no name". Every withheld plate this frame is a duplicate the raw pass
          // also saw.
          const dupes = frame.withheld.filter((w) => w.reason === 'duplicate');
          if (dupes.length > 0) dropped++;
          expect(
            dupes.length,
            `${name} @ (+${dx}, +${dy}): a plate stood down as a duplicate with nothing to duplicate`,
          ).toBeLessThanOrEqual(rawCrowded.length);
          // …and it is never the station's, and never a rival's: the ordering
          // ruling holds on every sample, not just on the staged frame above.
          for (const d of dupes) {
            expect(d.kind, `${name} @ (+${dx}, +${dy}): the landmark yielded`).toBe('ship');
          }
          // The rival is untouched throughout — both of Sable's plates are still
          // in the frame (they never collide with each other; their owner's two
          // marks are 60px apart by construction), whatever Rusty's hull is doing.
          expect(
            frame.drawn.filter((d) => d.owner === SABLE).length,
            `${name} @ (+${dx}, +${dy}): a rival's plate was dropped for crowding someone else's`,
          ).toBe(raw.drawn.filter((d) => d.owner === SABLE).length);
        }
      }
    }

    // Not vacuous, and worth being exact about how common this is: the collision
    // is not an exotic camera position like a0-115's, it is a hull near its home.
    expect(sampled, 'nothing was sampled').toBeGreaterThan(40000);
    expect(wouldCollide, 'no sampled offset collided — the sweep is not exercising the rule').toBeGreaterThan(1000);
    // Every frame the rule reacted to is a frame that was crowded, and every
    // crowded frame got a reaction: the rule is neither trigger-happy nor asleep.
    expect(dropped, 'the rule fired on a frame that was clear, or slept through one that was not').toBe(wouldCrowd);
    expect(wouldCrowd, 'the pad reacts to strictly more than bare overlap').toBeGreaterThanOrEqual(wouldCollide);
  });

  it('drops the plate only while the two are actually on each other', () => {
    // The other edge of the same rule, and the one that decides whether this is a
    // fix or a feature removal: a ship AWAY from its home keeps its own name. Walk
    // it straight up from the station and find where the plate comes back.
    const vp: Viewport = { width: 1280, height: 800 };
    const home = plate(RUSTY, 'station', 640, 420);
    const heldAt: number[] = [];
    for (let d = 0; d <= 200; d++) {
      const frame = placeFrame([plate(RUSTY, 'ship', 640, 420 - d), home], vp);
      if (frame.withheld.some((w) => w.reason === 'duplicate')) heldAt.push(d);
    }
    // A contiguous band, not a scatter — a plate that blinked in and out as the
    // ship crept upward would be the same illegibility in the time axis.
    expect(heldAt.length, 'the ship never lost its plate at all').toBeGreaterThan(4);
    expect(heldAt[heldAt.length - 1]! - heldAt[0]! + 1, 'the drop is not one contiguous band').toBe(
      heldAt.length,
    );
    // …and it is a small band. Most of the time a ship is nowhere near its home
    // and both plates are wanted, which is why "drop one of them always" was the
    // wrong answer to this brief.
    expect(heldAt.length, 'the ship loses its name over far too much of the field').toBeLessThan(60);
    // Sitting exactly ON the station is NOT in the band: a station's row floats
    // above a 40px disc and a ship's above a 12px hull, so at zero offset the two
    // are already 30-odd px apart. The collision is the approach, not the dock.
    expect(heldAt).not.toContain(0);

    // Far away, both plates draw and both are legible.
    const apart = placeFrame([plate(RUSTY, 'ship', 900, 200), home], vp);
    expect(apart.drawn).toHaveLength(2);
    expect(sameOwnerCollisions(apart)).toEqual([]);
  });

  it('a withheld station plate blocks nothing — it is not in the frame', () => {
    // The composition rule the a0-115 section states and this one inherits: the
    // blocker list is what was DRAWN, not what was wanted. A plate that stood down
    // is not in the frame, and a rule about two rects has nothing to say about one.
    //
    // Staged on the edge cull, which is the one way to withhold an owner's station
    // plate without withholding their ship's along with it — the two collide
    // precisely because they are in the same horizontal band, so no readout can
    // take one and leave the other, but the canvas edge can: the row is culled on
    // its own left edge, and the two rows have different left edges.
    const vp: Viewport = { width: 1280, height: 800 };
    // How far a row reaches left of the entity it names — asked of the geometry
    // rather than restated, so a longer name moves the staging honestly.
    const reachLeft = -rectFor(plate(RUSTY, 'station', 0, 400), 0).x;
    const homeX = reachLeft - 5; // its row's left edge lands at -5: culled
    const home = plate(RUSTY, 'station', homeX, 400);
    const hull = plate(RUSTY, 'ship', homeX + 40, 400 - 24);
    // The staging is only worth anything if the two WOULD have collided.
    expect(rectOverlap(rectFor(home, 0), rectFor(hull, 0)), 'the staged pair does not even overlap').not.toBeNull();

    const frame = placeFrame([hull, home], vp);
    expect(frame.withheld, 'the station plate should have been culled at the edge').toContainEqual({
      owner: RUSTY,
      kind: 'station',
      reason: 'offscreen',
    });
    expect(frame.drawn.map((d) => d.kind), 'the ship yielded to a plate that was never drawn').toEqual(['ship']);
    expect(sameOwnerCollisions(frame)).toEqual([]);

    // …and the control: slide the whole pair right so the station's row fits, and
    // the ordering ruling takes over again — the station draws, the ship yields.
    const shifted = placeFrame(
      [plate(RUSTY, 'ship', homeX + 240, 400 - 24), plate(RUSTY, 'station', homeX + 200, 400)],
      vp,
    );
    expect(shifted.drawn.map((d) => d.kind)).toEqual(['station']);
    expect(shifted.withheld).toEqual([{ owner: RUSTY, kind: 'ship', reason: 'duplicate' }]);
  });

  it('the two rules keep the same air between two runs of type', () => {
    // a0-119 is a0-115's keep-out with the blocker swapped, so it must not invent
    // a second idea of "clear". Two rows separated by exactly the pad are clear;
    // one pixel closer and they are not.
    const rect: Rect = { x: 100, y: 50, width: 80, height: 16 };
    const justClear: PlacedLabel = { owner: RUSTY, rect: { ...rect, x: rect.x + rect.width + READOUT_KEEPOUT_PAD } };
    const tooClose: PlacedLabel = { owner: RUSTY, rect: { ...rect, x: rect.x + rect.width + READOUT_KEEPOUT_PAD - 1 } };
    expect(labelRepeatsOwner(RUSTY, rect, [justClear])).toBe(false);
    expect(labelRepeatsOwner(RUSTY, rect, [tooClose])).toBe(true);
    // Another owner in the same pixels is not this rule's business.
    expect(labelRepeatsOwner(RUSTY, rect, [{ owner: SABLE, rect }])).toBe(false);
    // …and an empty frame is the common case, answered without touching anything.
    expect(labelRepeatsOwner(RUSTY, rect, [])).toBe(false);
  });
});
